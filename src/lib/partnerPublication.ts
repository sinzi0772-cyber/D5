import type { Lead, LeadStatus } from '../types'
import { STATUSES } from '../types'
import { expectedSettlementMonthFor, isValidDeliveryDate } from './commissionSettlement'
import { getExecutiveMonths } from './executiveMetrics'
import { buildPartnerPreview, type PartnerPreviewCustomer, type PartnerPreviewModel, type PartnerPreviewSettlement } from './partnerPreview'

/** One explicitly approved tenant. This is not a client-selectable company registry. */
export const IWEDDING_PARTNER_ID = 'iwedding'
export const IWEDDING_PARTNER_NAME = '(주)아이패밀리에스씨'
export const MAX_PARTNER_PUBLICATION_BYTES = 750_000
export const MAX_PARTNER_PUBLICATION_CUSTOMERS = 2_000
const maxMonths = 120

/** Saved under /partnerViews/{partnerId}; contains no source customer documents. */
export interface PartnerPublication {
  schemaVersion: 1
  partnerId: typeof IWEDDING_PARTNER_ID
  partnerName: typeof IWEDDING_PARTNER_NAME
  publishedAt: string
  months: PartnerPreviewModel[]
}

const rootKeys = ['schemaVersion', 'partnerId', 'partnerName', 'publishedAt', 'months']
const modelKeys = ['partnerName', 'intakeMonth', 'receiptCount', 'customerCount', 'completedCount', 'activeCount', 'completedExpectedCommission', 'undatedExpectedCommission', 'undatedCustomerCount', 'settlements', 'customers']
const customerKeys = ['key', 'label', 'registeredAt', 'status', 'deliveryScheduledDate', 'expectedCommission', 'expectedSettlementMonth']
const settlementKeys = ['month', 'expectedCommission', 'customerCount']
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
  if (!exactDataRecord(value, customerKeys)) return null
  if (value.key !== `customer-${index + 1}` || !safeDisplayLabel(value.label)) return null
  if (value.registeredAt !== null && !isValidDeliveryDate(value.registeredAt)) return null
  if (typeof value.status !== 'string' || !STATUSES.includes(value.status as LeadStatus)) return null
  if (value.deliveryScheduledDate !== null && !isValidDeliveryDate(value.deliveryScheduledDate)) return null
  const completed = value.status === '구매완료'
  if (completed ? !validFee(value.expectedCommission) : value.expectedCommission !== null) return null
  const expectedMonth = completed ? expectedSettlementMonthFor({ deliveryScheduledDate: value.deliveryScheduledDate as string | undefined }) : null
  if (value.expectedSettlementMonth !== expectedMonth) return null
  return {
    key: value.key,
    label: value.label,
    registeredAt: value.registeredAt as string | null,
    status: value.status as LeadStatus,
    deliveryScheduledDate: value.deliveryScheduledDate as string | null,
    expectedCommission: value.expectedCommission as number | null,
    expectedSettlementMonth: expectedMonth,
  }
}

function parseMonthModel(value: unknown): PartnerPreviewModel | null {
  if (!exactDataRecord(value, modelKeys) || value.partnerName !== IWEDDING_PARTNER_NAME || !validIntakeMonth(value.intakeMonth)) return null
  if (!Array.isArray(value.customers) || value.customers.length === 0 || value.customers.length > MAX_PARTNER_PUBLICATION_CUSTOMERS) return null
  if (!Array.isArray(value.settlements) || value.settlements.length > value.customers.length) return null
  for (const key of ['receiptCount', 'customerCount', 'completedCount', 'activeCount', 'undatedCustomerCount']) if (!validCount(value[key])) return null
  if (!validFee(value.completedExpectedCommission) || !validFee(value.undatedExpectedCommission)) return null
  const customers: PartnerPreviewCustomer[] = []
  const actualSettlements = new Map<string, PartnerPreviewSettlement>()
  let completedCustomers = 0, activeCustomers = 0, totalFee = 0, undatedFee = 0, undatedCustomers = 0
  for (const [index, item] of value.customers.entries()) {
    const customer = parseCustomer(item, index)
    if (!customer) return null
    customers.push(customer)
    if (customer.status === '관리중') activeCustomers++
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
  if ((value.completedCount as number) > completedCustomers || (value.activeCount as number) > activeCustomers || (value.completedCount as number) + (value.activeCount as number) > (value.receiptCount as number)) return null
  if ((completedCustomers === 0) !== (value.completedCount === 0)) return null
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
    partnerName: IWEDDING_PARTNER_NAME,
    intakeMonth: value.intakeMonth,
    receiptCount: value.receiptCount as number,
    customerCount: value.customerCount as number,
    completedCount: value.completedCount as number,
    activeCount: value.activeCount as number,
    completedExpectedCommission: totalFee,
    undatedExpectedCommission: undatedFee,
    undatedCustomerCount: undatedCustomers,
    settlements,
    customers,
  }
}

/** Fail closed on a foreign tenant, unknown fields, unmasked data or invalid totals. */
export function parsePartnerPublication(value: unknown, expectedPartnerId: string): PartnerPublication | null {
  try {
    if (expectedPartnerId !== IWEDDING_PARTNER_ID || !exactDataRecord(value, rootKeys)) return null
    if (value.schemaVersion !== 1 || value.partnerId !== expectedPartnerId || value.partnerName !== IWEDDING_PARTNER_NAME || !validPublishedAt(value.publishedAt)) return null
    if (!Array.isArray(value.months) || value.months.length > maxMonths) return null
    const months: PartnerPreviewModel[] = []
    const seen = new Set<string>()
    let totalCustomers = 0
    for (const item of value.months) {
      const model = parseMonthModel(item)
      if (!model || seen.has(model.intakeMonth) || (months.length > 0 && model.intakeMonth >= months[months.length - 1].intakeMonth)) return null
      seen.add(model.intakeMonth)
      totalCustomers += model.customerCount
      if (totalCustomers > MAX_PARTNER_PUBLICATION_CUSTOMERS) return null
      months.push(model)
    }
    const result: PartnerPublication = { schemaVersion: 1, partnerId: IWEDDING_PARTNER_ID, partnerName: IWEDDING_PARTNER_NAME, publishedAt: value.publishedAt, months }
    return encodedBytes(result) <= MAX_PARTNER_PUBLICATION_BYTES ? result : null
  } catch {
    return null
  }
}

/** Trusted publisher only. Build from complete cases, then expose only one tenant. */
export function buildPartnerPublication(leads: readonly Lead[], partnerId: string, publishedAt: string): PartnerPublication {
  if (partnerId !== IWEDDING_PARTNER_ID) throw new RangeError('승인된 업체 ID가 아닙니다.')
  if (!validPublishedAt(publishedAt)) throw new RangeError('게시 시각은 올바른 ISO UTC 형식이어야 합니다.')
  const months: PartnerPreviewModel[] = []
  let totalCustomers = 0
  for (const month of getExecutiveMonths(leads)) {
    const model = buildPartnerPreview(leads, IWEDDING_PARTNER_NAME, month)
    if (!model.customerCount) continue
    totalCustomers += model.customerCount
    if (months.length >= maxMonths || totalCustomers > MAX_PARTNER_PUBLICATION_CUSTOMERS) throw new RangeError('업체 공개 문서가 허용 크기를 초과합니다. 분할 게시가 필요합니다.')
    months.push(model)
  }
  const publication: PartnerPublication = { schemaVersion: 1, partnerId: IWEDDING_PARTNER_ID, partnerName: IWEDDING_PARTNER_NAME, publishedAt, months }
  if (encodedBytes(publication) > MAX_PARTNER_PUBLICATION_BYTES) throw new RangeError('업체 공개 문서가 허용 크기를 초과합니다. 분할 게시가 필요합니다.')
  const validated = parsePartnerPublication(publication, partnerId)
  if (!validated) throw new TypeError('업체 공개 자료에 허용되지 않는 값이 있습니다.')
  return validated
}
