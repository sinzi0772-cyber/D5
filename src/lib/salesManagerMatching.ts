/** The caller supplies only admitted sales rows after customer/order review. */
export interface SalesManagerOrderEvidence {
  seller: string
  saleAmount: number
  isReturnOrRefund?: boolean
}

export interface SalesManagerProfile {
  employeeNo: string
  displayName: string
  role: string
  active?: boolean
  disabled?: boolean
  approved?: boolean
}

export type SalesManagerMatchDisposition = 'matched' | 'ambiguous' | 'not-found' | 'missing'
export type SalesManagerMatchReason =
  | 'no-positive-sale-orders'
  | 'seller-missing'
  | 'staff-not-found'
  | 'staff-label-invalid'
  | 'staff-name-mismatch'
  | 'duplicate-staff-name'
  | 'duplicate-employee-number'
  | 'multiple-sales-managers'
  | 'unresolved-seller'

export interface SalesManagerCandidate {
  employeeNo: string
  displayName: string
}

/** Evidence contains staff identities/counts only, never source orders or customers. */
export interface SalesManagerMatch {
  disposition: SalesManagerMatchDisposition
  managerEmployeeNo?: string
  displayName?: string
  reasons: SalesManagerMatchReason[]
  evidence: {
    positiveOrderCount: number
    ignoredOrderCount: number
    sellerCount: number
    matchedSellerCount: number
    missingSellerCount: number
    unresolvedSellerCount: number
    matchedBy: ('employee-no' | 'full-name')[]
    managerCandidates: SalesManagerCandidate[]
  }
}

const allowedRoles = new Set(['manager', 'store_manager', 'assistant_manager'])
const clean = (value: string) => value.normalize('NFKC').trim()
const nameKey = (value: string) => clean(value).replace(/\s/g, '')
const employeeKey = (value: string) => clean(value).replace(/\s/g, '')
const maskedName = (value: string) => /[*＊]/.test(value)

type StaffLookup = {
  byEmployee: Map<string, SalesManagerCandidate[]>
  byName: Map<string, SalesManagerCandidate[]>
}

function staffLookup(profiles: readonly SalesManagerProfile[]): StaffLookup {
  const byEmployee = new Map<string, SalesManagerCandidate[]>()
  const byName = new Map<string, SalesManagerCandidate[]>()
  for (const profile of profiles) {
    // Legacy approved profiles may not have an active flag. Explicit revocation wins.
    if (!allowedRoles.has(profile.role) || profile.active === false || profile.disabled === true || profile.approved === false) continue
    const employeeNo = employeeKey(profile.employeeNo)
    const displayName = clean(profile.displayName)
    if (!/^\d+$/.test(employeeNo) || !displayName || maskedName(displayName)) continue
    const candidate = { employeeNo, displayName }
    const employeeEntries = byEmployee.get(employeeNo) || []
    if (employeeEntries.some(entry => nameKey(entry.displayName) === nameKey(displayName))) continue
    employeeEntries.push(candidate)
    byEmployee.set(employeeNo, employeeEntries)
    const nameEntries = byName.get(nameKey(displayName)) || []
    nameEntries.push(candidate)
    byName.set(nameKey(displayName), nameEntries)
  }
  return { byEmployee, byName }
}

type SellerMatch = {
  disposition: SalesManagerMatchDisposition
  candidates: SalesManagerCandidate[]
  reason?: SalesManagerMatchReason
  matchedBy?: 'employee-no' | 'full-name'
}

function matchSeller(seller: string, lookup: StaffLookup): SellerMatch {
  const value = clean(seller)
  if (!value) return { disposition: 'missing', candidates: [], reason: 'seller-missing' }
  const numbers = value.match(/\d+/g) || []
  if (numbers.length > 1) return { disposition: 'not-found', candidates: [], reason: 'staff-label-invalid' }
  if (numbers.length === 1) {
    const employeeNo = numbers[0]
    const candidates = lookup.byEmployee.get(employeeNo) || []
    // Permit only a staff number plus a literal name, conventional wrappers/labels.
    // Do not infer a match from a number embedded in arbitrary source text.
    const remainingName = value.replace(employeeNo, '').replace(/사번|판매사원|직원번호/g, '').replace(/[()\[\]{}:：/·,\-]/g, '').trim()
    if (/[\d]|[<>@;=]/.test(remainingName)) return { disposition: 'not-found', candidates: [], reason: 'staff-label-invalid' }
    if (!candidates.length) return { disposition: 'not-found', candidates: [], reason: 'staff-not-found' }
    if (candidates.length > 1) return { disposition: 'ambiguous', candidates, reason: 'duplicate-employee-number' }
    if (remainingName && (maskedName(remainingName) || nameKey(remainingName) !== nameKey(candidates[0].displayName))) {
      return { disposition: 'not-found', candidates: [], reason: 'staff-name-mismatch' }
    }
    return { disposition: 'matched', candidates, matchedBy: 'employee-no' }
  }
  if (maskedName(value)) return { disposition: 'not-found', candidates: [], reason: 'staff-name-mismatch' }
  const candidates = lookup.byName.get(nameKey(value)) || []
  if (!candidates.length) return { disposition: 'not-found', candidates: [], reason: 'staff-not-found' }
  if (candidates.length > 1) return { disposition: 'ambiguous', candidates, reason: 'duplicate-staff-name' }
  const employeeEntries = lookup.byEmployee.get(candidates[0].employeeNo) || []
  if (employeeEntries.length > 1) return { disposition: 'ambiguous', candidates: employeeEntries, reason: 'duplicate-employee-number' }
  return { disposition: 'matched', candidates, matchedBy: 'full-name' }
}

/**
 * Resolve exactly one approved sales manager across admitted positive sale rows.
 * Refunds, zero-value changes and component rows cannot reassign the original seller.
 * Staff numbers take precedence, but a supplied full name must also agree.
 * Name-only matching is exact/unique; partial or masked names are never expanded.
 */
export function matchSalesManagerForOrders(
  orders: readonly SalesManagerOrderEvidence[],
  profiles: readonly SalesManagerProfile[],
): SalesManagerMatch {
  const positive = orders.filter(order => Number.isFinite(order.saleAmount) && order.saleAmount > 0 && !order.isReturnOrRefund)
  const sellers = [...new Set(positive.map(order => clean(order.seller)))]
  const lookup = staffLookup(profiles)
  const results = sellers.map(seller => matchSeller(seller, lookup))
  const reasons = new Set<SalesManagerMatchReason>()
  const matchedBy = new Set<'employee-no' | 'full-name'>()
  const candidates = new Map<string, SalesManagerCandidate>()
  for (const result of results) {
    if (result.reason) reasons.add(result.reason)
    if (result.matchedBy) matchedBy.add(result.matchedBy)
    for (const candidate of result.candidates) candidates.set(`${candidate.employeeNo}|${nameKey(candidate.displayName)}`, { ...candidate })
  }
  const managerCandidates = [...candidates.values()].sort((a, b) => a.employeeNo.localeCompare(b.employeeNo, 'en', { numeric: true }) || a.displayName.localeCompare(b.displayName, 'ko'))
  const evidence: SalesManagerMatch['evidence'] = {
    positiveOrderCount: positive.length,
    ignoredOrderCount: orders.length - positive.length,
    sellerCount: sellers.length,
    matchedSellerCount: results.filter(result => result.disposition === 'matched').length,
    missingSellerCount: results.filter(result => result.disposition === 'missing').length,
    unresolvedSellerCount: results.filter(result => result.disposition !== 'matched').length,
    matchedBy: [...matchedBy], managerCandidates,
  }
  let disposition: SalesManagerMatchDisposition
  if (!positive.length) { disposition = 'missing'; reasons.add('no-positive-sale-orders') }
  else if (results.some(result => result.disposition === 'ambiguous') || managerCandidates.length > 1) {
    disposition = 'ambiguous'
    if (managerCandidates.length > 1 && results.filter(result => result.disposition === 'matched').length > 1) reasons.add('multiple-sales-managers')
  } else if (results.some(result => result.disposition === 'not-found')) disposition = 'not-found'
  else if (results.some(result => result.disposition === 'missing')) disposition = 'missing'
  else if (managerCandidates.length === 1) disposition = 'matched'
  else { disposition = 'not-found'; reasons.add('staff-not-found') }
  if (disposition !== 'matched' && evidence.matchedSellerCount > 0) reasons.add('unresolved-seller')
  return {
    disposition, reasons: [...reasons], evidence,
    ...(disposition === 'matched' ? { managerEmployeeNo: managerCandidates[0].employeeNo, displayName: managerCandidates[0].displayName } : {}),
  }
}
