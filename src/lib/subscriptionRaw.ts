import { customerIdentityKey, isSalesCommissionChannelEligible, maskCustomerName, readTsv } from './salesRaw'
import type { SalesRawIssue } from './salesRaw'

export type SubscriptionRawDisposition = 'confirmed' | 'reserved' | 'excluded' | 'review'
export interface SubscriptionRawOptions {
  /** Only exact status labels are admitted. Unknown labels are held for review. */
  confirmedStatuses?: readonly string[]
  reservedStatuses?: readonly string[]
  excludedStatuses?: readonly string[]
  /** Alternative allow-list; shipment waiting is represented as a pending amount. */
  includedStatuses?: readonly string[]
}
export interface SubscriptionRawItem {
  rowNumber: number
  itemReference: string
  orderReference: string
  lineReference: string
  identityKey: string
  customerName: string
  phoneLast4: string
  orderDate: string
  orderStatusLabel: string
  contractStatusLabel: string
  logisticsStatusLabel: string
  disposition: SubscriptionRawDisposition
  statusDisposition: SubscriptionRawDisposition
  membershipBenefitBasisAmount: number | null
  basisAmountMissing: boolean
  basisAmountInvalid: boolean
  quantity: number | null
  channel1: string
  channel2: string
  commissionChannelEligible: boolean
  evidenceApprovalStatus: string
  isEvidenceRejected: boolean
  hasReviewRequired: boolean
  hasBlockingIssue: boolean
}
export interface SubscriptionRawCustomer {
  identityKey: string
  customerName: string
  phoneLast4: string
  items: SubscriptionRawItem[]
  admittedItemCount: number
  admittedOrderCount: number
  confirmedBasisAmount: number
  reservedBasisAmount: number
  admittedBasisAmount: number
  admittedChannelEligibleBasisAmount: number
  excludedBasisAmount: number
  reviewBasisAmount: number
  includedMissingBasisItems: number
  includedInvalidBasisItems: number
  rejectedEvidenceItems: number
  hasReviewRequired: boolean
  hasBlockingIssue: boolean
}
export interface SubscriptionRawSummary {
  inputRows: number
  acceptedItems: number
  duplicateItemRows: number
  conflictingItems: number
  customerCount: number
  statusCounts: Record<string, number>
  confirmedItems: number
  reservedItems: number
  excludedItems: number
  reviewItems: number
  admittedItemCount: number
  admittedOrderCount: number
  confirmedBasisAmount: number
  reservedBasisAmount: number
  admittedBasisAmount: number
  admittedChannelEligibleBasisAmount: number
  excludedBasisAmount: number
  reviewBasisAmount: number
  includedMissingBasisItems: number
  includedInvalidBasisItems: number
  rejectedEvidenceItems: number
  errorCount: number
  warningCount: number
}
export interface SubscriptionRawResult {
  items: SubscriptionRawItem[]
  customers: SubscriptionRawCustomer[]
  issues: SalesRawIssue[]
  summary: SubscriptionRawSummary
}

const normalizeHeader = (value: string) => value.replace(/[\s\uFEFF"']/g, '')
function basisAmount(value: string): number | null {
  const clean = value.trim().replace(/[\s,₩원]/g, '')
  if (!/^\d+$/.test(clean)) return null
  const amount = Number(clean)
  return Number.isSafeInteger(amount) ? amount : null
}
function dateOnly(value: string): string {
  const match = value.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\s.*)?$/)
  if (!match) return ''
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  const instant = new Date(`${date}T00:00:00Z`)
  return Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== date ? '' : date
}

/**
 * Each subscription row is a product line, not a customer or a whole order.
 * The supplied membership-benefit basis is summed once per unique line; neither
 * 출하가 nor monthly charges nor a guessed quantity multiplier is used.
 * Partner eligibility and the commission percentage are evaluated after matching.
 */
export function parseSubscriptionRaw(text: string, options: SubscriptionRawOptions = {}): SubscriptionRawResult {
  const confirmedStatuses = options.confirmedStatuses ?? options.includedStatuses?.filter(value => value !== '출하대기' && value !== '예약') ?? ['주문확정']
  const reservedStatuses = options.reservedStatuses ?? options.includedStatuses?.filter(value => value === '출하대기' || value === '예약') ?? ['예약']
  const excludedStatuses = options.excludedStatuses ?? ['취소됨', '취소', '가예약']
  const parsed = readTsv(text)
  const issues = [...parsed.issues]
  const header = parsed.records.shift()
  const columns = header?.fields.map(normalizeHeader) || []
  const inputRows = parsed.records.length
  const byReference = new Map<string, { item: SubscriptionRawItem; signature: string }>()
  const conflicts = new Set<string>()
  const blockedIdentities = new Set<string>()
  let duplicateItemRows = 0
  const required = ['구매고객명', '전화번호', '주문일자', '멤버십혜택기준금액', '주문상태']
  const missing = required.filter(name => !columns.includes(name))
  if (!header || missing.length) issues.push({ severity: 'error', code: 'missing-columns', message: `구독 원본의 필수 열이 없습니다: ${missing.join(', ') || '제목 행'}` })
  if (columns.some((name, index) => name && columns.indexOf(name) !== index)) issues.push({ severity: 'error', code: 'duplicate-columns', message: '중복된 열 제목이 있어 원본 열을 구분할 수 없습니다.' })
  const referencePairs = [['BEST주문번호', 'BEST주문라인번호'], ['LGE주문번호', 'LGE주문라인번호'], ['계약번호', 'CSMS계약라인번호']] as const
  if (!referencePairs.some(pair => pair.every(name => columns.includes(name)))) issues.push({ severity: 'error', code: 'missing-line-columns', message: '주문번호와 제품 라인번호의 조합이 없어 중복 구독을 확인할 수 없습니다.' })

  if (!issues.some(issue => issue.severity === 'error' && issue.rowNumber === undefined)) for (const record of parsed.records) {
    const rowNumber = record.line
    if (record.fields.length !== columns.length) {
      issues.push({ severity: 'error', code: 'column-count', rowNumber, message: `열 개수가 제목과 다릅니다. 제목 ${columns.length}열, 해당 행 ${record.fields.length}열입니다.` })
      continue
    }
    if (issues.some(issue => issue.severity === 'error' && issue.rowNumber === rowNumber)) continue
    const field = (name: string) => (record.fields[columns.indexOf(name)] || '').trim()
    const identityKey = customerIdentityKey(field('구매고객명'), field('전화번호'))
    const pairIndex = referencePairs.findIndex(pair => pair.every(name => field(name)))
    const pair = referencePairs[pairIndex]
    const orderReference = pair ? field(pair[0]) : ''
    const lineReference = pair ? field(pair[1]) : ''
    const itemReference = pair ? `${pairIndex}:${orderReference}|${lineReference}` : ''
    if (!identityKey) issues.push({ severity: 'error', code: 'invalid-identity', rowNumber, message: '고객명과 전화번호 뒷 4자리를 함께 확인할 수 없습니다. 전화번호만으로 고객을 매칭하지 않습니다.' })
    if (!itemReference) issues.push({ severity: 'error', code: 'missing-item-reference', rowNumber, message: '주문번호와 제품 라인번호가 없어 중복 구독을 확인할 수 없습니다.' })
    if (!identityKey || !itemReference) {
      if (identityKey) blockedIdentities.add(identityKey)
      continue
    }

    const orderStatusLabel = field('주문상태')
    const contractStatusLabel = field('계약상태')
    const logisticsStatusLabel = field('물류상태')
    const explicitlyCanceled = /취소|해지|철회/.test(contractStatusLabel) || !!field('취소일자') || !!field('해지완료일')
    let disposition: SubscriptionRawDisposition = explicitlyCanceled || excludedStatuses.includes(orderStatusLabel)
      ? 'excluded' : confirmedStatuses.includes(orderStatusLabel)
        ? 'confirmed' : reservedStatuses.includes(orderStatusLabel) ? 'reserved' : 'review'
    const statusDisposition = disposition
    const basisAmountMissing = !field('멤버십혜택기준금액')
    const membershipBenefitBasisAmount = basisAmount(field('멤버십혜택기준금액'))
    const basisAmountInvalid = !basisAmountMissing && membershipBenefitBasisAmount === null
    const orderDate = dateOnly(field('주문일자'))
    let hasBlockingIssue = disposition === 'review'
    if (membershipBenefitBasisAmount === null && disposition !== 'excluded') {
      issues.push({ severity: 'warning', code: basisAmountMissing ? 'missing-basis-amount' : 'invalid-basis-amount', rowNumber, message: basisAmountMissing
        ? '멤버십혜택 기준금액이 비어 있어 해당 라인은 금액 합산에서 제외합니다. 다른 금액이나 0원으로 대신 계산하지 않습니다.'
        : '멤버십혜택 기준금액이 유효한 음수 아닌 정수 금액이 아닙니다. 다른 금액으로 대신 계산하지 않습니다.' })
      disposition = 'review'
      hasBlockingIssue ||= basisAmountInvalid
    }
    if (!orderDate && disposition !== 'excluded') {
      issues.push({ severity: 'warning', code: 'invalid-order-date', rowNumber, message: '주문일자를 읽을 수 없어 자동 반영에서 보류합니다.' })
      disposition = 'review'
      hasBlockingIssue = true
    }
    if (field('해지접수일') && !field('해지완료일') && disposition !== 'excluded') {
      issues.push({ severity: 'warning', code: 'pending-termination', rowNumber, message: '해지 접수 기록이 있어 실제 계약 상태를 확인해야 합니다.' })
      disposition = 'review'
      hasBlockingIssue = true
    }
    if (disposition === 'review' && (statusDisposition === 'review' || hasBlockingIssue)) issues.push({ severity: 'warning', code: 'review-required', rowNumber, message: '주문 상태와 기준금액을 확인해야 하므로 자동 반영에서 보류합니다.' })
    const quantityText = field('수량')
    const quantity = /^\d+$/.test(quantityText) && Number.isSafeInteger(Number(quantityText)) && Number(quantityText) > 0 ? Number(quantityText) : null
    if (quantityText && quantity === null) issues.push({ severity: 'warning', code: 'invalid-quantity', rowNumber, message: '수량을 읽을 수 없습니다. 표시된 멤버십혜택 기준금액만 사용합니다.' })
    const evidenceApprovalStatus = field('경로판촉증빙승인여부')
    const isEvidenceRejected = /반려|거절|불승인/.test(evidenceApprovalStatus)
    const item: SubscriptionRawItem = {
      rowNumber, itemReference, orderReference, lineReference, identityKey,
      customerName: maskCustomerName(field('구매고객명')), phoneLast4: field('전화번호').replace(/\D/g, '').slice(-4),
      orderDate, orderStatusLabel, contractStatusLabel, logisticsStatusLabel, disposition, statusDisposition,
      membershipBenefitBasisAmount, basisAmountMissing, basisAmountInvalid, quantity, channel1: field('판매경로1'), channel2: field('판매경로2'),
      // Proof rejection is retained for reference, not used to exclude commission.
      commissionChannelEligible: isSalesCommissionChannelEligible(field('판매경로1'), field('판매경로2')),
      evidenceApprovalStatus, isEvidenceRejected, hasReviewRequired: disposition === 'review', hasBlockingIssue,
    }
    // Comparison signatures never leave this runtime or get persisted with the result.
    const signature = JSON.stringify(record.fields.map(value => value.trim()))
    const previous = byReference.get(itemReference)
    if (previous) {
      duplicateItemRows += 1
      if (previous.signature !== signature) {
        conflicts.add(itemReference)
        blockedIdentities.add(identityKey)
        blockedIdentities.add(previous.item.identityKey)
        issues.push({ severity: 'error', code: 'conflicting-item-reference', rowNumber, message: `같은 제품 라인의 내용이 ${previous.item.rowNumber}행과 다릅니다. 해당 라인은 자동 반영에서 보류합니다.` })
      } else issues.push({ severity: 'warning', code: 'duplicate-item', rowNumber, message: `같은 제품 라인이 ${previous.item.rowNumber}행에 이미 있어 한 번만 집계합니다.` })
    } else byReference.set(itemReference, { item, signature })
  }

  const items = [...byReference.values()].map(entry => entry.item).filter(item => !conflicts.has(item.itemReference))
  const customerMap = new Map<string, SubscriptionRawCustomer>()
  for (const item of items) {
    let customer = customerMap.get(item.identityKey)
    if (!customer) {
      customer = {
        identityKey: item.identityKey, customerName: item.customerName, phoneLast4: item.phoneLast4, items: [],
        admittedItemCount: 0, admittedOrderCount: 0, confirmedBasisAmount: 0, reservedBasisAmount: 0,
        admittedBasisAmount: 0, admittedChannelEligibleBasisAmount: 0, excludedBasisAmount: 0, reviewBasisAmount: 0,
        includedMissingBasisItems: 0, includedInvalidBasisItems: 0, rejectedEvidenceItems: 0, hasReviewRequired: false, hasBlockingIssue: false,
      }
      customerMap.set(item.identityKey, customer)
    }
    customer.items.push(item)
    const amount = item.membershipBenefitBasisAmount ?? 0
    if (item.disposition === 'confirmed') customer.confirmedBasisAmount += amount
    else if (item.disposition === 'reserved') customer.reservedBasisAmount += amount
    else if (item.disposition === 'excluded') customer.excludedBasisAmount += amount
    else customer.reviewBasisAmount += amount
    if (item.disposition === 'confirmed' || item.disposition === 'reserved') {
      customer.admittedItemCount += 1
      customer.admittedBasisAmount += amount
      if (item.commissionChannelEligible) customer.admittedChannelEligibleBasisAmount += amount
    }
    customer.hasReviewRequired ||= item.hasReviewRequired
    customer.hasBlockingIssue ||= item.hasBlockingIssue || blockedIdentities.has(item.identityKey)
    if (item.statusDisposition === 'confirmed' || item.statusDisposition === 'reserved') {
      if (item.basisAmountMissing) customer.includedMissingBasisItems += 1
      if (item.basisAmountInvalid) customer.includedInvalidBasisItems += 1
    }
    if (item.isEvidenceRejected) customer.rejectedEvidenceItems += 1
  }
  const customers = [...customerMap.values()]
  const statusCounts: Record<string, number> = {}
  for (const item of items) statusCounts[item.orderStatusLabel || '(빈 값)'] = (statusCounts[item.orderStatusLabel || '(빈 값)'] || 0) + 1
  for (const customer of customers) customer.admittedOrderCount = new Set(customer.items.filter(item => item.disposition === 'confirmed' || item.disposition === 'reserved').map(item => `${item.itemReference.split(':')[0]}:${item.orderReference}`)).size
  const sum = (key: 'admittedItemCount' | 'admittedOrderCount' | 'confirmedBasisAmount' | 'reservedBasisAmount' | 'admittedBasisAmount' | 'admittedChannelEligibleBasisAmount' | 'excludedBasisAmount' | 'reviewBasisAmount' | 'includedMissingBasisItems' | 'includedInvalidBasisItems' | 'rejectedEvidenceItems') => customers.reduce((total, customer) => total + customer[key], 0)
  return { items, customers, issues, summary: {
    inputRows, acceptedItems: items.length, duplicateItemRows, conflictingItems: conflicts.size, customerCount: customers.length, statusCounts,
    confirmedItems: items.filter(item => item.disposition === 'confirmed').length,
    reservedItems: items.filter(item => item.disposition === 'reserved').length,
    excludedItems: items.filter(item => item.disposition === 'excluded').length,
    reviewItems: items.filter(item => item.disposition === 'review').length,
    admittedItemCount: sum('admittedItemCount'), admittedOrderCount: sum('admittedOrderCount'),
    confirmedBasisAmount: sum('confirmedBasisAmount'), reservedBasisAmount: sum('reservedBasisAmount'), admittedBasisAmount: sum('admittedBasisAmount'),
    admittedChannelEligibleBasisAmount: sum('admittedChannelEligibleBasisAmount'), excludedBasisAmount: sum('excludedBasisAmount'), reviewBasisAmount: sum('reviewBasisAmount'),
    includedMissingBasisItems: sum('includedMissingBasisItems'), includedInvalidBasisItems: sum('includedInvalidBasisItems'), rejectedEvidenceItems: sum('rejectedEvidenceItems'),
    errorCount: issues.filter(issue => issue.severity === 'error').length, warningCount: issues.filter(issue => issue.severity === 'warning').length,
  } }
}
