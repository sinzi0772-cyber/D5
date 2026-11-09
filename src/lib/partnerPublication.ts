import type { Lead, LeadStatus } from '../types'
import { STATUSES } from '../types'
import { expectedSettlementMonthFor, isValidDeliveryDate } from './commissionSettlement'
import { buildPartnerPreview, getPartnerPreviewMonths, type PartnerPreviewCustomer, type PartnerPreviewModel, type PartnerPreviewSettlement, type PartnerSalesChannel } from './partnerPreview'
import { isSalesCommissionChannelEligible } from './salesRaw'
import { PARTNER_ACCOUNTS, partnerIdentityFor } from './partnerIdentity'

export const IWEDDING_PARTNER_ID = PARTNER_ACCOUNTS.iwedding.partnerId
export const IWEDDING_PARTNER_NAME = PARTNER_ACCOUNTS.iwedding.partnerName
export const MAX_PARTNER_PUBLICATION_BYTES = 750_000
export const MAX_PARTNER_PUBLICATION_CUSTOMERS = 2_000
const maxMonths = 120

/** Saved under /partnerViews/{partnerId}; contains no source customer documents. */
export interface PartnerPublication {
  schemaVersion: 1
  partnerId: string
  partnerName: string
  publishedAt: string
  months: PartnerPreviewModel[]
}

const rootKeys = ['schemaVersion', 'partnerId', 'partnerName', 'publishedAt', 'months']
const modelKeys = ['partnerName', 'intakeMonth', 'receiptCount', 'customerCount', 'completedCount', 'activeCount', 'completedExpectedCommission', 'undatedExpectedCommission', 'undatedCustomerCount', 'settlements', 'customers']
const customerKeys = ['key', 'label', 'registeredAt', 'status', 'deliveryScheduledDate', 'expectedCommission', 'expectedSettlementMonth']
const settlementKeys = ['month', 'expectedCommission', 'customerCount']
const channelKeys = ['kind', 'period', 'status', 'channel1', 'channel2']
const validIntakeMonth = (value: unknown): value is string => typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value)
const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_PARTNER_PUBLICATION_CUSTOMERS
const validFee = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const safeDisplayLabel = (value: unknown): value is string => typeof value === 'string' && /^(?:[^*\/\s\p{C}]\*\*|\*\*\*|미입력) \/ (?:\d{4}|미입력)$/u.test(value)
const monthIndex = (month: string) => { const [year, number] = month.split('-').map(Number); return year * 12 + number - 1 }
const encodedBytes = (value: PartnerPublication) => new TextEncoder().encode(JSON.stringify(value)).byteLength

function exactDataRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return keys.every(key => descriptors[key]?.enumerable === true && 'value' in descriptors[key])
}

function validPublishedAt(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !isValidDeliveryDate(value.slice(0, 10))) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}

function parseCustomer(value: unknown, index: number): PartnerPreviewCustomer | null {
  const enhanced = !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'basisRequired')
  const hasChannels = !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'salesChannels')
  const keys = enhanced ? [...customerKeys, 'basisRequired', 'basisReason'] : customerKeys
  if (!exactDataRecord(value, hasChannels ? [...keys, 'salesChannels'] : keys)) return null
  if (value.key !== `customer-${index + 1}` || !safeDisplayLabel(value.label)) return null
  if (value.registeredAt !== null && !isValidDeliveryDate(value.registeredAt)) return null
  if (typeof value.status !== 'string' || !STATUSES.includes(value.status as LeadStatus)) return null
  if (value.deliveryScheduledDate !== null && !isValidDeliveryDate(value.deliveryScheduledDate)) return null
  const completed = value.status === '구매완료'
  if (enhanced && (typeof value.basisRequired !== 'boolean' || value.basisReason !== (value.basisRequired ? '기준 고객 확인 필요' : null))) return null
  const required = enhanced && value.basisRequired === true
  let salesChannels: PartnerSalesChannel[] | undefined
  if (hasChannels) {
    if (required || !Array.isArray(value.salesChannels) || value.salesChannels.length < 1 || value.salesChannels.length > 240) return null
    salesChannels = []
    const seen = new Set<string>()
    for (const entry of value.salesChannels) {
      if (!exactDataRecord(entry, channelKeys) || entry.kind !== 'lumpSum' && entry.kind !== 'subscription') return null
      if (entry.period !== null && !validIntakeMonth(entry.period)) return null
      if (![entry.channel1, entry.channel2].every(label => typeof label === 'string' && label.length <= 200 && label.trim() === label && !/[\p{C}]/u.test(label))) return null
      const channel1 = entry.channel1 as string, channel2 = entry.channel2 as string
      const status = !channel1 || !channel2 ? 'unverified' : isSalesCommissionChannelEligible(channel1, channel2) ? 'eligible' : 'mismatch'
      if (entry.status !== status) return null
      const route: PartnerSalesChannel = { kind: entry.kind as PartnerSalesChannel['kind'], period: entry.period as string | null, status, channel1, channel2 }
      const key = JSON.stringify(route)
      if (seen.has(key)) return null
      seen.add(key); salesChannels.push(route)
    }
  }
  if (required && (value.expectedCommission !== null || value.deliveryScheduledDate !== null || value.expectedSettlementMonth !== null)) return null
  if (!required && (completed ? !validFee(value.expectedCommission) : value.expectedCommission !== null)) return null
  const expectedMonth = completed && !required ? expectedSettlementMonthFor({ deliveryScheduledDate: value.deliveryScheduledDate as string | undefined }) : null
  if (value.expectedSettlementMonth !== expectedMonth) return null
  return {
    key: value.key,
    label: value.label,
    registeredAt: value.registeredAt as string | null,
    status: value.status as LeadStatus,
    deliveryScheduledDate: value.deliveryScheduledDate as string | null,
    expectedCommission: value.expectedCommission as number | null,
    expectedSettlementMonth: expectedMonth,
    ...(enhanced ? { basisRequired: required, basisReason: required ? '기준 고객 확인 필요' as const : null } : {}),
    ...(salesChannels ? { salesChannels } : {}),
  }
}

function parseMonthModel(value: unknown, partnerName: string): PartnerPreviewModel | null {
  const enhanced = !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'basisRequiredCount')
  if (!exactDataRecord(value, enhanced ? [...modelKeys, 'basisRequiredCount'] : modelKeys) || value.partnerName !== partnerName || !validIntakeMonth(value.intakeMonth)) return null
  if (enhanced && !validCount(value.basisRequiredCount)) return null
  if (!Array.isArray(value.customers) || value.customers.length === 0 || value.customers.length > MAX_PARTNER_PUBLICATION_CUSTOMERS) return null
  if (!Array.isArray(value.settlements) || value.settlements.length > value.customers.length) return null
  for (const key of ['receiptCount', 'customerCount', 'completedCount', 'activeCount', 'undatedCustomerCount']) if (!validCount(value[key])) return null
  if (!validFee(value.completedExpectedCommission) || !validFee(value.undatedExpectedCommission)) return null
  const customers: PartnerPreviewCustomer[] = []
  const actualSettlements = new Map<string, PartnerPreviewSettlement>()
  let completedCustomers = 0, completedStatuses = 0, activeCustomers = 0
  let selectedCompletedStatuses = 0, selectedActiveCustomers = 0
  let totalFee = 0, undatedFee = 0, undatedCustomers = 0, basisRequiredCount = 0
  for (const [index, item] of value.customers.entries()) {
    const customer = parseCustomer(item, index)
    if (!customer) return null
    if (enhanced !== (customer.basisRequired !== undefined)) return null
    customers.push(customer)
    if (customer.basisRequired) basisRequiredCount++
    if (customer.status === '구매완료') completedStatuses++
    if (customer.status === '관리중') activeCustomers++
    if (!customer.basisRequired && customer.status === '구매완료') selectedCompletedStatuses++
    if (!customer.basisRequired && customer.status === '관리중') selectedActiveCustomers++
    if (customer.expectedCommission === null) continue
    completedCustomers++
    totalFee += customer.expectedCommission
    if (customer.expectedSettlementMonth === null) {
      undatedCustomers++
      undatedFee += customer.expectedCommission
      continue
    }
    const bucket = actualSettlements.get(customer.expectedSettlementMonth)
    if (bucket) {
      bucket.expectedCommission += customer.expectedCommission
      bucket.customerCount++
    } else actualSettlements.set(customer.expectedSettlementMonth, { month: customer.expectedSettlementMonth, expectedCommission: customer.expectedCommission, customerCount: 1 })
  }
  if (value.customerCount !== customers.length || !value.receiptCount || (value.receiptCount as number) > customers.length) return null
  if (enhanced) {
    // Older enhanced schema-1 documents counted the visible secondary status
    // on basis-required rows. Accept that complete old pair for compatibility,
    // but always return selected-only categories. Never accept a mixed pair.
    const selectedCounts = value.completedCount === selectedCompletedStatuses && value.activeCount === selectedActiveCustomers
    const legacyCounts = value.completedCount === completedStatuses && value.activeCount === activeCustomers
    if (value.receiptCount !== customers.length || !(selectedCounts || legacyCounts) || value.basisRequiredCount !== basisRequiredCount) return null
  } else {
    if ((value.completedCount as number) > completedCustomers || (value.activeCount as number) > activeCustomers || (value.completedCount as number) + (value.activeCount as number) > (value.receiptCount as number)) return null
    if ((completedCustomers === 0) !== (value.completedCount === 0)) return null
  }
  if (value.completedExpectedCommission !== totalFee || value.undatedExpectedCommission !== undatedFee || value.undatedCustomerCount !== undatedCustomers) return null
  const expectedSettlements = [...actualSettlements.values()].sort((a, b) => monthIndex(a.month) - monthIndex(b.month))
  if (value.settlements.length !== expectedSettlements.length) return null
  const settlements: PartnerPreviewSettlement[] = []
  for (const [index, item] of value.settlements.entries()) {
    const expected = expectedSettlements[index]
    if (!exactDataRecord(item, settlementKeys) || item.month !== expected.month || item.expectedCommission !== expected.expectedCommission || item.customerCount !== expected.customerCount) return null
    settlements.push({ month: expected.month, expectedCommission: expected.expectedCommission, customerCount: expected.customerCount })
  }
  return {
    partnerName,
    intakeMonth: value.intakeMonth,
    receiptCount: value.receiptCount as number,
    customerCount: value.customerCount as number,
    completedCount: enhanced ? selectedCompletedStatuses : value.completedCount as number,
    activeCount: enhanced ? selectedActiveCustomers : value.activeCount as number,
    completedExpectedCommission: totalFee,
    undatedExpectedCommission: undatedFee,
    undatedCustomerCount: undatedCustomers,
    ...(enhanced ? { basisRequiredCount } : {}),
    settlements,
    customers,
  }
}

/** Fail closed on a foreign tenant, unknown fields, unmasked data or invalid totals. */
export function parsePartnerPublication(value: unknown, expectedPartnerId: string): PartnerPublication | null {
  try {
    const identity = partnerIdentityFor(expectedPartnerId)
    if (!identity || !exactDataRecord(value, rootKeys)) return null
    if (value.schemaVersion !== 1 || value.partnerId !== identity.partnerId || value.partnerName !== identity.partnerName || !validPublishedAt(value.publishedAt)) return null
    if (!Array.isArray(value.months) || value.months.length > maxMonths) return null
    const months: PartnerPreviewModel[] = []
    const seen = new Set<string>()
    let totalCustomers = 0
    for (const item of value.months) {
      const model = parseMonthModel(item, identity.partnerName)
      if (!model || seen.has(model.intakeMonth) || (months.length > 0 && model.intakeMonth >= months[months.length - 1].intakeMonth)) return null
      seen.add(model.intakeMonth)
      totalCustomers += model.customerCount
      if (totalCustomers > MAX_PARTNER_PUBLICATION_CUSTOMERS) return null
      months.push(model)
    }
    const result: PartnerPublication = { schemaVersion: 1, partnerId: identity.partnerId, partnerName: identity.partnerName, publishedAt: value.publishedAt, months }
    return encodedBytes(result) <= MAX_PARTNER_PUBLICATION_BYTES ? result : null
  } catch {
    return null
  }
}

/** Trusted publisher only. Build from complete cases, then expose only one tenant. */
export function buildPartnerPublication(leads: readonly Lead[], partnerId: string, publishedAt: string): PartnerPublication {
  const identity = partnerIdentityFor(partnerId)
  if (!identity) throw new RangeError('승인된 업체 ID가 아닙니다.')
  const { partnerName } = identity
  if (!validPublishedAt(publishedAt)) throw new RangeError('게시 시각은 올바른 ISO UTC 형식이어야 합니다.')
  const months: PartnerPreviewModel[] = []
  let totalCustomers = 0
  for (const month of getPartnerPreviewMonths(leads, partnerName)) {
    const model = buildPartnerPreview(leads, partnerName, month)
    if (!model.customerCount) continue
    totalCustomers += model.customerCount
    if (months.length >= maxMonths || totalCustomers > MAX_PARTNER_PUBLICATION_CUSTOMERS) throw new RangeError('업체 공개 문서가 허용 크기를 초과합니다. 분할 게시가 필요합니다.')
    months.push(model)
  }
  const publication: PartnerPublication = { schemaVersion: 1, partnerId, partnerName, publishedAt, months }
  if (encodedBytes(publication) > MAX_PARTNER_PUBLICATION_BYTES) throw new RangeError('업체 공개 문서가 허용 크기를 초과합니다. 분할 게시가 필요합니다.')
  const validated = parsePartnerPublication(publication, partnerId)
  if (!validated) throw new TypeError('업체 공개 자료에 허용되지 않는 값이 있습니다.')
  return validated
}
