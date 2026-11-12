import type { Lead } from '../types'
import { canonicalPartnerName } from './partners'
import { completedSalesFor, confirmedSalesFor, expectedRebateBreakdownFor, financialPendingAmountFor, isSubscriptionRebatePartner, purchaseAmountSourceFor, registerCaseFinancialProjection, salesRawAmountsFor, subscriptionRawAmountsFor } from './salesFinance'
import type { CaseFinancialProjection, PurchaseAmountSource, SalesRawAmounts, SubscriptionRawAmounts } from './salesFinance'

export interface CaseBasisSelection {
  status: 'resolved' | 'empty' | 'unresolved'
  /** The chosen original row, not a persisted combination of member fields. */
  basis?: Lead
  candidates: Lead[]
  /** Present only after explicit purchase-amount merge consent for this full roster. */
  mergeMemberIds?: string[]
  reason: string
}

export interface CaseBasisGroup {
  key: string
  members: Lead[]
  selection: CaseBasisSelection
  /** Receipt month is fixed by the logical case's earliest registration. */
  registeredAt: string
}

type Kind = 'lumpSum' | 'subscription'
const kinds = ['lumpSum', 'subscription'] as const
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value && !value.includes('/')
const validAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const stableCompare = (a: Lead, b: Lead) => a.registeredAt.localeCompare(b.registeredAt) || a.id.localeCompare(b.id)
const amountKey = (kind: Kind) => kind === 'lumpSum' ? 'lumpSumAmount' : 'subscriptionAmount'
const sourceKey = (kind: Kind) => kind === 'lumpSum' ? 'lumpSumSourceId' : 'subscriptionSourceId'
const rawKey = (kind: Kind) => kind === 'lumpSum' ? 'salesRawPeriods' : 'subscriptionRawPeriods'
const partner = (lead: Lead) => canonicalPartnerName(lead.partnerName)

function enteredAmount(lead: Lead, kind: Kind): number | undefined {
  const direct = lead[amountKey(kind)]
  if (validAmount(direct)) return direct
  const type = kind === 'lumpSum' ? '일시불' : '구독'
  return lead.purchaseType === type && validAmount(lead.purchaseAmount) ? lead.purchaseAmount : undefined
}

function hasRaw(lead: Lead, kind: Kind): boolean {
  return Object.keys(lead[rawKey(kind)] || {}).length > 0
}

function hasFinancialData(lead: Lead): boolean {
  return kinds.some(kind => enteredAmount(lead, kind) !== undefined || hasRaw(lead, kind))
}

const activeKindsFor = (lead: Lead): Kind[] => kinds.filter(kind => enteredAmount(lead, kind) !== undefined || hasRaw(lead, kind))

function normalizeProjectedPurchase(lead: Lead): void {
  const lumpSum = enteredAmount(lead, 'lumpSum')
  const subscription = enteredAmount(lead, 'subscription')
  lead.lumpSumAmount = lumpSum
  lead.subscriptionAmount = subscription
  lead.purchaseType = lumpSum !== undefined && subscription !== undefined ? '일시불+구독' : lumpSum !== undefined ? '일시불' : subscription !== undefined ? '구독' : '미선택'
  lead.purchaseAmount = lumpSum !== undefined || subscription !== undefined ? (lumpSum || 0) + (subscription || 0) : undefined
}

/** A temporary calculation projection only. It never copies RAW into stored rows.
 * Legacy aliases may retain their actual source's evidence, but only when the
 * source is visible in this complete case, is direct, belongs to the same
 * company, and has exactly the same current amount. No external lookup occurs. */
function projectedBasis(lead: Lead, members: readonly Lead[]): { lead?: Lead; reason?: string } {
  const projected = { ...lead, caseBasisLeadId: lead.id, caseMergeMemberIds: undefined }
  const activeKinds = activeKindsFor(lead)
  const ownKinds = activeKinds.filter(kind => !lead[sourceKey(kind)] || lead[sourceKey(kind)] === lead.id)
  const borrowedKinds = activeKinds.filter(kind => !ownKinds.includes(kind))
  if (!ownKinds.length && new Set(borrowedKinds.map(kind => lead[sourceKey(kind)])).size > 1) {
    return { reason: '서로 다른 원본 고객의 금액이 섞여 있습니다. 합산하지 않고 실제 원본 고객 한 명을 기준으로 선택해주세요.' }
  }
  for (const kind of kinds) {
    const value = enteredAmount(lead, kind)
    const id = lead[sourceKey(kind)]
    if (ownKinds.length && id !== undefined && id !== lead.id) {
      // Prior per-method sharing could leave A's own lump sum beside B's copied
      // subscription. The chosen original contributes ONLY its own methods;
      // these readonly removals never alter either saved original.
      projected[amountKey(kind)] = undefined
      projected[sourceKey(kind)] = undefined
      if (kind === 'lumpSum') projected.salesRawPeriods = undefined
      else projected.subscriptionRawPeriods = undefined
      continue
    }
    projected[amountKey(kind)] = value
    let evidence = lead
    if (id !== undefined && id !== lead.id) {
      const owner = members.find(member => member.id === id)
      if (!validId(id) || !owner || !partner(lead) || partner(owner) !== partner(lead)
        || owner[sourceKey(kind)] !== undefined && owner[sourceKey(kind)] !== owner.id
        || value !== enteredAmount(owner, kind)) {
        return { reason: '공유 금액의 원본 기준을 확인할 수 없습니다. 기준 고객을 확인해주세요.' }
      }
      evidence = owner
      if (enteredAmount(owner, kind) === undefined && !hasRaw(owner, kind)) return { reason: '공유 금액의 원본 고객에 해당 구매 방식의 입력 근거가 없습니다. 기준 고객을 확인해주세요.' }
      // A stale RAW is not transferred as if it were current evidence. Omitting
      // it retains the approved manual amount without unrelated eligibility.
      if (kind === 'lumpSum') projected.salesRawPeriods = salesRawAmountsFor(owner).current ? owner.salesRawPeriods : undefined
      else projected.subscriptionRawPeriods = subscriptionRawAmountsFor(owner).current ? owner.subscriptionRawPeriods : undefined
    } else if (id !== undefined && !validId(id)) {
      return { reason: '공유 금액의 기준 고객 정보가 올바르지 않습니다.' }
    }
    if (value === undefined && hasRaw(evidence, kind)) {
      const rawTotal = kind === 'lumpSum'
        ? (() => { const raw = salesRawAmountsFor(evidence); return raw.confirmed + raw.reserved + raw.tentative })()
        : (() => { const raw = subscriptionRawAmountsFor(evidence); return raw.confirmed + raw.pending })()
      if (rawTotal !== 0) return { reason: 'RAW 근거는 있지만 구매 금액이 미입력입니다. 기준 고객의 금액을 확인해주세요.' }
    }
    // The selected complete customer's two methods are calculated once. Empty
    // methods stay empty; no method is filled from another member.
    projected[sourceKey(kind)] = value !== undefined || hasRaw(evidence, kind) ? lead.id : undefined
  }
  // Clear legacy fallback totals before reconciling the methods that survived.
  // Otherwise an excluded borrowed method could reappear via purchaseAmount.
  projected.purchaseAmount = undefined
  normalizeProjectedPurchase(projected)
  return { lead: projected }
}

function economicSignature(lead: Lead): string {
  const rebate = expectedRebateBreakdownFor(lead)
  const sales = salesRawAmountsFor(lead)
  const currentRefund = sales.current ? Object.values(lead.salesRawPeriods || {}).reduce((sum, period) => sum + (Number.isFinite(period.returnAmount) ? period.returnAmount : 0), 0) : 0
  return JSON.stringify([
    partner(lead), enteredAmount(lead, 'lumpSum') ?? null, enteredAmount(lead, 'subscription') ?? null,
    lead.status, lead.deliveryScheduledDate || '', lead.managerEmployeeNo || lead.manager || '',
    rebate.lumpSumBasis, rebate.subscriptionBasis, rebate.lumpSumCommission, rebate.subscriptionCommission,
    confirmedSalesFor(lead), completedSalesFor(lead), financialPendingAmountFor(lead),
    currentRefund,
  ])
}

const sortedMemberIds = (members: readonly Lead[]) => members.map(member => member.id).sort()
function validMergeRoster(ids: unknown, members: readonly Lead[]): ids is string[] {
  return Array.isArray(ids) && ids.length >= 2 && ids.length <= 8 && ids.every(validId)
    && new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(sortedMemberIds(members))
}

/** Explicit A+B calculation only. Each independent original contributes once per
 * method; shared aliases do not create another sale. Evidence is held in a
 * WeakMap, never fabricated into RAW fields or added to persisted documents. */
function mergedProjection(basis: Lead, members: readonly Lead[], ids: readonly string[]): { lead?: Lead; reason?: string } {
  if (!validMergeRoster(ids, members)) return { reason: '구매금액 합산에 동의한 전체 고객 구성이 현재 묶음과 다릅니다. 다시 선택해주세요.' }
  if (!partner(basis) || members.some(member => partner(member) !== partner(basis))) return { reason: '서로 다른 업체의 구매금액은 합산할 수 없습니다. 고객만 묶거나 같은 업체의 고객을 선택해주세요.' }
  const roots: Record<Kind, Lead[]> = { lumpSum: [], subscription: [] }
  for (const kind of kinds) {
    const seen = new Set<string>()
    for (const member of members) {
      if (!activeKindsFor(member).includes(kind)) continue
      const ownerId = member[sourceKey(kind)] || member.id
      const owner = members.find(candidate => candidate.id === ownerId)
      if (!validId(ownerId) || !owner || owner[sourceKey(kind)] !== undefined && owner[sourceKey(kind)] !== owner.id
        || !activeKindsFor(owner).includes(kind) || enteredAmount(member, kind) !== enteredAmount(owner, kind)) {
        return { reason: '합산 대상 구매금액의 실제 원본 고객을 확인할 수 없습니다. 외부 원본·서로 다른 공유 금액을 먼저 확인해주세요.' }
      }
      if (seen.has(ownerId)) continue
      const entered = enteredAmount(owner, kind)
      const raw = kind === 'lumpSum' ? salesRawAmountsFor(owner) : subscriptionRawAmountsFor(owner)
      const rawTotal = kind === 'lumpSum'
        ? (raw as SalesRawAmounts).confirmed + (raw as SalesRawAmounts).reserved + (raw as SalesRawAmounts).tentative
        : (raw as SubscriptionRawAmounts).confirmed + (raw as SubscriptionRawAmounts).pending
      if (entered === undefined && rawTotal !== 0) return { reason: 'RAW 구매 근거가 있지만 입력 금액이 없습니다. 원본 금액을 확인한 후 합산해주세요.' }
      seen.add(ownerId)
      roots[kind].push(owner)
    }
  }
  const salesRaw: SalesRawAmounts = { current: roots.lumpSum.length > 0, confirmed: 0, reserved: 0, tentative: 0,
    completed: 0, pending: 0, eligibleConfirmed: 0, eligibleReserved: 0, eligibleTentative: 0 }
  const subscriptionRaw: SubscriptionRawAmounts = { current: roots.subscription.length > 0, confirmed: 0, pending: 0, eligibleConfirmed: 0, eligiblePending: 0 }
  const amounts: Record<Kind, number | undefined> = { lumpSum: roots.lumpSum.length ? 0 : undefined, subscription: roots.subscription.length ? 0 : undefined }
  const bases: Record<Kind, number> = { lumpSum: 0, subscription: 0 }
  const sourceInfo: Record<Kind, PurchaseAmountSource[]> = { lumpSum: [], subscription: [] }
  let pendingAmount = 0, confirmedSales = 0, completedSales = 0
  for (const kind of kinds) for (const owner of roots[kind]) {
    // Manual completion follows the chosen primary customer's personal state.
    // RAW stages retain their own factual confirmed/pending/refund evidence.
    const calculation = { ...owner, caseBasisLeadId: owner.id, status: basis.status }
    if (kind === 'lumpSum') {
      calculation.subscriptionAmount = undefined
      calculation.subscriptionRawPeriods = undefined
      calculation.subscriptionSourceId = undefined
      calculation.purchaseType = '일시불'
    } else {
      calculation.lumpSumAmount = undefined
      calculation.salesRawPeriods = undefined
      calculation.lumpSumSourceId = undefined
      calculation.purchaseType = '구독'
    }
    calculation[amountKey(kind)] = enteredAmount(owner, kind) ?? 0
    calculation.purchaseAmount = calculation[amountKey(kind)]
    const amount = calculation[amountKey(kind)]!
    amounts[kind] = (amounts[kind] || 0) + amount
    if (!Number.isFinite(amounts[kind]) || amounts[kind]! > Number.MAX_SAFE_INTEGER) return { reason: '합산 구매금액이 올바른 계산 범위를 초과합니다. 원본 금액을 확인해주세요.' }
    sourceInfo[kind].push(purchaseAmountSourceFor(calculation, kind))
    pendingAmount += financialPendingAmountFor(calculation)
    confirmedSales += confirmedSalesFor(calculation)
    completedSales += completedSalesFor(calculation)
    const rebate = expectedRebateBreakdownFor(calculation)
    if (kind === 'lumpSum') {
      const raw = salesRawAmountsFor(calculation)
      salesRaw.current &&= raw.current
      if (raw.current) {
        for (const key of ['confirmed', 'reserved', 'tentative', 'completed', 'pending', 'eligibleConfirmed', 'eligibleReserved', 'eligibleTentative'] as const) salesRaw[key] += raw[key]
        // Refunds remain signed until the combined method basis is clamped.
        bases.lumpSum += raw.confirmed + raw.reserved + raw.tentative
      } else bases.lumpSum += rebate.lumpSumBasis
    } else {
      const raw = subscriptionRawAmountsFor(calculation)
      subscriptionRaw.current &&= raw.current
      if (raw.current) {
        for (const key of ['confirmed', 'pending', 'eligibleConfirmed', 'eligiblePending'] as const) subscriptionRaw[key] += raw[key]
        if (isSubscriptionRebatePartner(calculation.partnerName)) bases.subscription += raw.confirmed + raw.pending
      } else bases.subscription += rebate.subscriptionBasis
    }
  }
  const summarySource = (kind: Kind): PurchaseAmountSource => {
    const entries = sourceInfo[kind]
    const rawEntries = entries.filter(entry => entry.rawAmount !== null)
    return { kind: !entries.length ? 'empty' : entries.every(entry => entry.kind === 'raw') ? 'raw' : 'manual',
      amount: amounts[kind] || 0, rawAmount: rawEntries.length ? rawEntries.reduce((sum, entry) => sum + entry.rawAmount!, 0) : null }
  }
  const totals: CaseFinancialProjection = {
    lumpSumBasis: Math.max(0, bases.lumpSum), subscriptionBasis: Math.max(0, bases.subscription), salesRaw, subscriptionRaw,
    pendingAmount, confirmedSales, completedSales, lumpSumSource: summarySource('lumpSum'), subscriptionSource: summarySource('subscription'),
  }
  if ((amounts.lumpSum || 0) + (amounts.subscription || 0) > Number.MAX_SAFE_INTEGER) return { reason: '합산 총판매금액이 올바른 계산 범위를 초과합니다. 원본 금액을 확인해주세요.' }
  if (Object.values(totals).some(value => typeof value === 'number' && !Number.isFinite(value))) return { reason: '합산 수수료 근거를 계산할 수 없습니다. 원본 자료를 확인해주세요.' }
  const projected: Lead = { ...basis, caseBasisLeadId: basis.id, caseMergeMemberIds: [...ids],
    lumpSumAmount: amounts.lumpSum, subscriptionAmount: amounts.subscription,
    lumpSumSourceId: amounts.lumpSum !== undefined ? basis.id : undefined, subscriptionSourceId: amounts.subscription !== undefined ? basis.id : undefined,
    salesRawPeriods: undefined, subscriptionRawPeriods: undefined }
  projected.purchaseAmount = undefined
  normalizeProjectedPurchase(projected)
  return { lead: registerCaseFinancialProjection(projected, totals) }
}

/** Resolve a complete logical case before applying company, date, status or
 * assignment filters. Adding independent amounts requires explicit full-roster
 * consent; a normal basis is never maximized, added or chosen by recency. */
export function caseBasisFor(members: readonly Lead[], preferredId?: string, preferredMergeIds?: readonly string[] | null): CaseBasisSelection {
  const ordered = [...members].sort(stableCompare)
  const candidates = ordered.filter(hasFinancialData)
  const unresolved = (reason: string): CaseBasisSelection => ({ status: 'unresolved', candidates: candidates.length ? candidates : ordered, reason })
  if (!ordered.length) return { status: 'empty', candidates: [], reason: '고객 정보가 없습니다.' }
  if (ordered.some(member => !validId(member.id)) || new Set(ordered.map(member => member.id)).size !== ordered.length) return unresolved('묶음 고객 구성을 다시 확인해주세요.')

  let mergeMemberIds: string[] | undefined
  if (preferredMergeIds !== null) {
    if (preferredMergeIds !== undefined) {
      if (!validMergeRoster(preferredMergeIds, ordered)) return unresolved('구매금액 합산에 동의한 전체 고객 구성을 다시 확인해주세요.')
      mergeMemberIds = [...preferredMergeIds]
    } else if (ordered.some(member => member.caseMergeMemberIds !== undefined)) {
      const stored = ordered[0].caseMergeMemberIds
      if (!validMergeRoster(stored, ordered) || ordered.some(member => JSON.stringify(member.caseMergeMemberIds) !== JSON.stringify(stored))
        || !ordered[0].caseGroupId || ordered.some(member => member.caseGroupId !== ordered[0].caseGroupId)) {
        return unresolved('구매금액 합산 동의 정보가 현재 전체 묶음과 일치하지 않습니다. 다시 선택해주세요.')
      }
      mergeMemberIds = [...stored]
    }
  }

  let explicitId = preferredId
  if (explicitId === undefined) {
    const hasMetadata = ordered.some(member => member.caseBasisLeadId !== undefined)
    if (hasMetadata) {
      const ids = new Set(ordered.map(member => member.caseBasisLeadId))
      if (ids.size !== 1) return unresolved('묶음 고객의 기준 정보가 서로 다릅니다. 기준 고객을 다시 선택해주세요.')
      explicitId = ordered[0].caseBasisLeadId
    }
  }
  if (explicitId !== undefined) {
    const basis = ordered.find(member => member.id === explicitId)
    if (!validId(explicitId) || !basis) return unresolved('선택된 기준 고객을 현재 묶음에서 확인할 수 없습니다. 기준 고객을 다시 선택해주세요.')
    const projection = mergeMemberIds ? mergedProjection(basis, ordered, mergeMemberIds) : projectedBasis(basis, ordered)
    if (!projection.lead) return unresolved(projection.reason!)
    return { status: (mergeMemberIds ? ordered.some(hasFinancialData) : hasFinancialData(basis)) ? 'resolved' : 'empty', basis, candidates: ordered, mergeMemberIds,
      reason: mergeMemberIds ? '구매금액 합산에 동의한 원본 금액만 더합니다. 이미 공유된 금액은 한 번만 반영합니다.' : '선택한 기준 고객의 데이터를 한 번만 반영합니다.' }
  }
  if (mergeMemberIds) return unresolved('구매금액을 합산할 때는 담당자·상태·배송일을 유지할 기준 고객을 함께 선택해주세요.')
  if (ordered.length === 1 && ordered[0].caseGroupId) return unresolved('묶음의 다른 고객을 확인할 수 없습니다. 전체 고객과 기준 정보를 확인해주세요.')
  if (!candidates.length) {
    const operationalSignatures = new Set(ordered.map(member => JSON.stringify([
      partner(member), member.status, member.deliveryScheduledDate || '', member.managerEmployeeNo || member.manager || '',
    ])))
    if (operationalSignatures.size > 1) return unresolved('판매 금액은 미입력이지만 담당자·상태·배송일 정보가 다릅니다. 기준 고객을 선택해주세요.')
    const basis = ordered[0]
    const projection = projectedBasis(basis, ordered)
    if (!projection.lead) return unresolved(projection.reason!)
    return { status: 'empty', basis, candidates: ordered, reason: '입력된 판매 금액이 없습니다.' }
  }
  // Existing direct lineage to one original is stronger than alias members'
  // personal status/calendar. It identifies one already-owned invoice, not an
  // arbitrary largest/newest member. Independent financial rows cannot qualify.
  const roots = new Set(candidates.flatMap(candidate => activeKindsFor(candidate).map(kind => candidate[sourceKey(kind)] || candidate.id)))
  const hasAliases = candidates.some(candidate => activeKindsFor(candidate).some(kind => candidate[sourceKey(kind)] && candidate[sourceKey(kind)] !== candidate.id))
  if (hasAliases && roots.size === 1) {
    const rootId = [...roots][0]
    const root = ordered.find(member => member.id === rootId)
    if (root && partner(root) && candidates.every(candidate => partner(candidate) === partner(root)
      && activeKindsFor(candidate).every(kind => (candidate[sourceKey(kind)] || candidate.id) === root.id
        && enteredAmount(candidate, kind) === enteredAmount(root, kind)))) {
      const projection = projectedBasis(root, ordered)
      if (projection.lead) return { status: 'resolved', basis: root, candidates, reason: '기존 공유 관계의 실제 원본 고객을 한 번만 반영합니다.' }
    }
  }
  const projected = candidates.map(candidate => projectedBasis(candidate, ordered))
  const invalid = projected.find(item => !item.lead)
  if (invalid) return unresolved(invalid.reason!)
  const signatures = new Set(projected.map(item => economicSignature(item.lead!)))
  if (signatures.size > 1) return unresolved('기준 정보가 다릅니다. 고객 선택 전까지 금액·수수료는 제외됩니다.')
  return { status: 'resolved', basis: candidates[0], candidates, reason: candidates.length === 1 ? '금액이 입력된 고객 한 명을 기준으로 반영합니다.' : '동일한 판매 데이터를 한 번만 반영합니다.' }
}

export function caseBasisGroupsFor(leads: readonly Lead[]): CaseBasisGroup[] {
  const groups = new Map<string, Lead[]>()
  const seenIds = new Set<string>()
  for (const lead of leads) {
    // Repeated render/query results for the same saved document are not another
    // original customer. Retain the first row without merging its field values.
    if (seenIds.has(lead.id)) continue
    seenIds.add(lead.id)
    const key = lead.caseGroupId ? `case:${lead.caseGroupId}` : `lead:${lead.id}`
    const members = groups.get(key)
    if (members) members.push(lead)
    else groups.set(key, [lead])
  }
  return [...groups].map(([key, input]) => {
    const members = [...input].sort(stableCompare)
    return { key, members, selection: caseBasisFor(members), registeredAt: members[0].registeredAt }
  })
}

/** One calculation projection per customer, including an explicitly consented
 * money merge, or undefined while its basis/roster/evidence is pending. */
export function financialCaseLeadFor(selection: CaseBasisSelection, members: readonly Lead[]): Lead | undefined {
  if (selection.status === 'unresolved' || !selection.basis) return undefined
  const chosen = members.find(member => member.id === selection.basis!.id)
  if (!chosen) return undefined
  // Return the registered object itself; spreading it would discard its
  // nonserializable merge evidence and promote partial RAW to manual total.
  return (selection.mergeMemberIds ? mergedProjection(chosen, members, selection.mergeMemberIds) : projectedBasis(chosen, members)).lead
}

export function financialCaseLeadsFor(leads: readonly Lead[]): Lead[] {
  return caseBasisGroupsFor(leads).flatMap(group => {
    const projection = financialCaseLeadFor(group.selection, group.members)
    return projection ? [projection] : []
  })
}
