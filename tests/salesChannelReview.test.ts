import assert from 'node:assert/strict'
import type { Lead, SalesChannelSummary } from '../src/types'
import { getSalesChannelReviewItems, isApprovedSubscriptionReviewPartner } from '../src/lib/salesChannelReview'

const approved = ['(주) 합성웨딩', '합성2', '합성3', '합성4', '합성5', '합성6', '합성7']
const admin = { role: 'admin' }
const manager = { role: 'manager', employeeNo: 'M1', displayName: '동명이인' }
const route = (amount: number | null = 100000, changes: Partial<SalesChannelSummary> = {}): SalesChannelSummary => ({
  channel1: '고객인증서비스(웨딩)', channel2: '웨딩매장행사', orderCount: 1, amount, ...changes,
})
const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id, registeredAt: '2026-10-01', updatedAt: '2026-11-01', customerName: '김준수', phoneLast4: '01012345678',
  gender: '미입력', partnerName: '(주) 합성웨딩', appointmentType: '이업종제휴', status: '구매완료', visitState: '방문',
  manager: '동명이인', managerEmployeeNo: 'M1', purchaseType: '일시불+구독', lumpSumAmount: 100000, subscriptionAmount: 100000,
  salesRawPeriods: { '2026-10': { period: '2026-10', sourceHash: 'PRIVATE-SALES-HASH', importedAt: '2026-11-01',
    orderCount: 1, confirmedOrderCount: 1, reservedOrderCount: 0, confirmedAmount: 100000, reservedAmount: 0,
    eligibleConfirmedAmount: 0, eligibleReservedAmount: 0, returnAmount: 0, channels: [route()] } },
  subscriptionRawPeriods: { '2026-10': { period: '2026-10', sourceHash: 'PRIVATE-SUB-HASH', importedAt: '2026-11-01',
    itemCount: 1, confirmedItemCount: 1, pendingItemCount: 0, confirmedBasisAmount: 100000, pendingBasisAmount: 0,
    eligibleConfirmedBasisAmount: 0, eligiblePendingBasisAmount: 0, includedStatuses: ['주문확정'],
    missingBasisItemCount: 0, rejectedProofItemCount: 0, channels: [route()] } }, ...changes,
})
const original = lead('source')
const before = JSON.stringify(original)
const items = getSalesChannelReviewItems([original], admin, approved)
assert.equal(items.length, 2)
assert.equal(items[0].customerLabel, '김** / 5678')
assert(items.every(item => item.intakeDate === original.registeredAt && item.status === 'mismatch'))
assert(items.every(item => item.leadId === original.id && item.channel2 === '웨딩매장행사' && item.managerLabel === '동명이인'))
assert(!JSON.stringify(items).includes('김준수') && !JSON.stringify(items).includes('01012345678'))
for (const privateField of ['PRIVATE', 'sourceHash', 'orderReference', '"amount":']) assert(!JSON.stringify(items).includes(privateField))
assert.deepEqual(getSalesChannelReviewItems([original], manager, approved), items)
assert.equal(getSalesChannelReviewItems([original], { ...manager, employeeNo: 'M2' }, approved).length, 0, 'Matching staff names never bypass a different employee number')
assert.equal(getSalesChannelReviewItems([original], { ...manager, employeeNo: undefined }, approved).length, 0)
assert.equal(getSalesChannelReviewItems([lead('legacy', { managerEmployeeNo: undefined })], manager, approved).length, 0, 'Name-only assignments require administrator review')
for (const role of ['partner', '데모 관리자', 'staff', '']) assert.equal(getSalesChannelReviewItems([original], { role }, approved).length, 0)
for (const role of ['admin', 'store_manager', 'assistant_manager']) assert.equal(getSalesChannelReviewItems([original], { role }, approved).length, 2)
assert.equal(getSalesChannelReviewItems([original], admin, []).length, 1, 'No supplied list never falls back to the broader financial partner list')
assert(isApprovedSubscriptionReviewPartner('주식회사 합성웨딩', approved))
assert(!isApprovedSubscriptionReviewPartner('합성웨딩협력사', approved))
assert(!isApprovedSubscriptionReviewPartner('주식회사 더블유와이피코리아', approved))
assert.equal(getSalesChannelReviewItems([lead('outside', { partnerName: '주식회사 더블유와이피코리아' })], admin, approved).length, 1, 'Only the outside vendor lump-sum route remains in review')
for (const appointmentType of [undefined, '미선택'] as const) assert.equal(getSalesChannelReviewItems([lead('ordinary', { appointmentType })], admin, approved).length, 0)

const replaceRoutes = (value: Lead, channels: SalesChannelSummary[]): Lead => ({
  ...value, salesRawPeriods: { '2026-10': { ...value.salesRawPeriods!['2026-10'], channels } },
  subscriptionRawPeriods: { '2026-10': { ...value.subscriptionRawPeriods!['2026-10'], channels } },
})
assert.equal(getSalesChannelReviewItems([replaceRoutes(original, [route(1)])], admin, approved).length, 0)
assert.equal(getSalesChannelReviewItems([replaceRoutes(original, [route(100)])], admin, approved).length, 2)
assert.equal(getSalesChannelReviewItems([replaceRoutes(original, [route(null)])], admin, approved).length, 2, 'Known wrong paths need review even when membership basis is missing')
const partialRoutes = getSalesChannelReviewItems([replaceRoutes(original, [route(100, { channel2: '' })])], admin, approved)
assert.equal(partialRoutes.length, 2)
assert(partialRoutes.every(item => item.status === 'unverified' && item.unverifiedReason === 'missing-route'
  && item.period === '2026-10' && item.channel1 === '고객인증서비스(웨딩)' && item.channel2 === ''))
assert.equal(getSalesChannelReviewItems([replaceRoutes(original, [route(100, { channel2: '웨딩업체연결(수수료지급)' })])], admin, approved).length, 0)
assert.equal(getSalesChannelReviewItems([replaceRoutes(original, [route(), route()])], admin, approved).length, 2, 'Duplicate stored paths do not create duplicate popup rows')
const legacyMetadata = { ...original, salesRawPeriods: { '2026-10': { ...original.salesRawPeriods!['2026-10'], channels: undefined } }, subscriptionRawPeriods: undefined }
const legacyItems = getSalesChannelReviewItems([legacyMetadata], admin, approved)
assert.equal(legacyItems.length, 2)
assert(legacyItems.every(item => item.status === 'unverified' && item.unverifiedReason === 'missing-route' && !item.channel1 && !item.channel2))
assert.deepEqual(legacyItems.map(item => item.period), ['2026-10', null])

const manualOnly = { salesRawPeriods: undefined, subscriptionRawPeriods: undefined }
const canceled = lead('canceled', { ...manualOnly, registeredAt: '2026-09-27', status: '취소' })
const completed = lead('completed', { ...manualOnly, registeredAt: '2026-09-24', status: '구매완료' })
const manualItems = getSalesChannelReviewItems([canceled, completed], manager, approved)
assert.equal(manualItems.length, 4, 'Both manually recorded purchase kinds require review regardless of customer status')
assert(manualItems.every(item => item.status === 'unverified' && item.period === null))
assert.deepEqual([...new Set(manualItems.map(item => item.intakeDate))].sort(), ['2026-09-24', '2026-09-27'])
assert.equal(getSalesChannelReviewItems([canceled, completed], { ...manager, employeeNo: 'M2' }, approved).length, 0)
assert.equal(getSalesChannelReviewItems([completed], admin, []).length, 1, 'Subscription scope also applies to manual amounts')
assert.equal(getSalesChannelReviewItems([{ ...completed, lumpSumAmount: 1, subscriptionAmount: 1 }], admin, approved).length, 0, 'One-won manual amounts are excluded')

const revisedAmount = getSalesChannelReviewItems([{ ...original, lumpSumAmount: 150000 }], admin, approved)
assert.equal(revisedAmount.length, 3, 'A separate unknown balance is reviewable alongside the known mismatch')
assert(revisedAmount.some(item => item.kind === 'lumpSum' && item.status === 'unverified' && item.unverifiedReason === 'amount-discrepancy' && !item.period))
assert.equal(getSalesChannelReviewItems([{ ...original, lumpSumAmount: 50000 }], admin, approved).length, 2, 'A known mismatch already covers a reduced manual amount')

const unknownLumpSum = legacyMetadata.salesRawPeriods['2026-10']
const multipleMonths = { ...legacyMetadata, salesRawPeriods: { '2026-10': unknownLumpSum,
  '2026-11': { ...unknownLumpSum, period: '2026-11' } } }
const multipleItems = getSalesChannelReviewItems([multipleMonths], admin, approved)
assert.equal(multipleItems.length, 2, 'Unverified routes in multiple months share one review row per purchase kind')
assert.deepEqual(multipleItems.find(item => item.kind === 'lumpSum')?.periods, ['2026-11', '2026-10'])

const owner = lead('owner', { caseGroupId: 'pair', caseBasisLeadId: 'alias' })
const alias = lead('alias', { caseGroupId: 'pair', caseBasisLeadId: 'alias', lumpSumSourceId: 'owner', subscriptionSourceId: 'owner', managerEmployeeNo: 'M2' })
assert.equal(getSalesChannelReviewItems([owner, alias], admin, approved).length, 2, 'Shared aliases never duplicate source orders')
assert.equal(getSalesChannelReviewItems([alias], admin, approved).length, 0, 'An unavailable owner is never replaced by an alias copy')
assert.equal(getSalesChannelReviewItems([owner, alias], { ...manager, employeeNo: 'M2' }, approved).length, 0, 'Alias assignment does not expose another original owner order')
const independent = lead('independent', { caseGroupId: 'pair', caseBasisLeadId: 'owner', managerEmployeeNo: 'M2' })
const independentItems = getSalesChannelReviewItems([owner, independent], admin, approved)
assert.equal(independentItems.length, 4, 'Independent original orders remain separate even with an explicit financial basis')
assert.equal(new Set(independentItems.map(item => item.caseKey)).size, 1, 'Popup grouping does not add customer purchase amounts')
assert.equal(getSalesChannelReviewItems([owner, independent], manager, approved).length, 2)
assert.equal(getSalesChannelReviewItems([owner, independent], { ...manager, employeeNo: 'M2' }, approved).length, 2)
assert.deepEqual(getSalesChannelReviewItems([original, original], admin, approved), items)
assert.deepEqual(getSalesChannelReviewItems([original], admin, approved).map(item => item.key), items.map(item => item.key))
assert.notDeepEqual(getSalesChannelReviewItems([lead('source', { managerEmployeeNo: 'M2' })], admin, approved).map(item => item.key), items.map(item => item.key))
assert.notDeepEqual(getSalesChannelReviewItems([replaceRoutes(original, [route(200000)])], admin, approved).map(item => item.key), items.map(item => item.key))
assert.equal(JSON.stringify(original), before)
console.log('salesChannelReview: explicit subscription scope, real route mismatches, one-won exclusion, assigned staff, source-owner deduplication, safe dismissal keys and immutable originals passed')
