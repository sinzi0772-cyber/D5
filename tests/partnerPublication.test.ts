import assert from 'node:assert/strict'
import { buildPartnerPublication, IWEDDING_PARTNER_ID, IWEDDING_PARTNER_NAME, MAX_PARTNER_PUBLICATION_BYTES, MAX_PARTNER_PUBLICATION_CUSTOMERS, parsePartnerPublication } from '../src/lib/partnerPublication.ts'
import { expectedRebateFor } from '../src/lib/salesFinance.ts'
import type { Lead } from '../src/types.ts'

const publishedAt = '2026-10-09T05:10:00.000Z'
const lead = (id: string, changes: Partial<Lead> = {}): Lead => {
  const value: Lead = {
  id, registeredAt: '2026-09-21', updatedAt: publishedAt,
  customerName: '김준수', phoneLast4: '01012340252', gender: '남',
  partnerName: IWEDDING_PARTNER_NAME, appointmentType: '이업종제휴',
  status: '구매완료', visitState: '방문', deliveryScheduledDate: '2026-09-30',
  purchaseType: '일시불+구독', lumpSumAmount: 20864000, subscriptionAmount: 1891000,
  manager: '비공개 담당자', managerEmployeeNo: '98765', plannerName: '비공개 플래너',
  note: '비공개 상담 메모', memoHistory: [{ id: 'private-memo', date: '2026-10-01', manager: '비공개 담당자', content: '비공개 상담 내용' }],
  ...changes,
  }
  // Publication privacy and month tests need eligible RAW evidence, not a manual fallback.
  return { ...value,
    salesRawPeriods: value.lumpSumAmount === undefined ? undefined : { '2026-09': {
      period: '2026-09', sourceHash: 'verified-lump-sum-fixture', importedAt: publishedAt,
      orderCount: 1, confirmedOrderCount: 1, reservedOrderCount: 0,
      confirmedAmount: value.lumpSumAmount, reservedAmount: 0,
      eligibleConfirmedAmount: value.lumpSumAmount, eligibleReservedAmount: 0, returnAmount: 0,
    } },
    subscriptionRawPeriods: value.subscriptionAmount === undefined ? undefined : { '2026-09': {
      period: '2026-09', sourceHash: 'verified-subscription-fixture', importedAt: publishedAt,
      itemCount: 1, confirmedItemCount: 1, pendingItemCount: 0,
      confirmedBasisAmount: value.subscriptionAmount, pendingBasisAmount: 0,
      eligibleConfirmedBasisAmount: value.subscriptionAmount, eligiblePendingBasisAmount: 0,
      includedStatuses: ['주문확정'], missingBasisItemCount: 0, rejectedProofItemCount: 0,
    } },
  }
}
const rows = Object.freeze([
  Object.freeze(lead('foreign-01099998888', { partnerName: '(주)다이렉트컴즈', customerName: '다른회사김영희', phoneLast4: '8888', registeredAt: '2026-08-31', caseGroupId: 'private-shared-case', lumpSumAmount: 99999999 })),
  Object.freeze(lead('own-later-private-id', { partnerName: '아이웨딩', registeredAt: '2026-09-01', caseGroupId: 'private-shared-case', deliveryScheduledDate: '2026-12-31' })),
  Object.freeze(lead('own-september-private-id')),
  Object.freeze(lead('own-undated', { phoneLast4: '0002', deliveryScheduledDate: undefined, lumpSumAmount: 1000000, subscriptionAmount: 0 })),
  Object.freeze(lead('own-active', { status: '관리중', phoneLast4: '0003', deliveryScheduledDate: '2026-10-15' })),
  Object.freeze(lead('own-october', { registeredAt: '2026-10-01', customerName: '이영희', phoneLast4: '0004', lumpSumAmount: 0, subscriptionAmount: 0 })),
])
const before = JSON.stringify(rows)
const publication = buildPartnerPublication(rows, IWEDDING_PARTNER_ID, publishedAt)
assert.equal(publication.schemaVersion, 1)
assert.equal(publication.partnerName, IWEDDING_PARTNER_NAME)
assert.equal(publication.partnerId, 'iwedding')
assert.deepEqual(publication.months.map(model => model.intakeMonth), ['2026-10', '2026-09'], 'Never publish a foreign registration month')
assert.equal(publication.months[1].customerCount, 4)
assert.equal(publication.months[1].basisRequiredCount, 1)
assert.equal(publication.months[1].completedCount, 2, 'The unresolved secondary display status does not add a completed category')
assert.equal(publication.months[1].activeCount, 1)
const pending = publication.months[1].customers.find(customer => customer.basisRequired)!
assert.equal(pending.registeredAt, '2026-09-01')
assert.equal(pending.expectedCommission, null)
assert.equal(pending.deliveryScheduledDate, null)
assert.equal(publication.months[1].completedExpectedCommission, expectedRebateFor(rows[2]) + expectedRebateFor(rows[3]))
assert.equal(publication.months[1].undatedExpectedCommission, 20000)
assert.equal(publication.months[1].customers.find(customer => customer.status === '관리중')?.expectedCommission, null)
assert.equal(publication.months[0].settlements[0].expectedCommission, 0, 'Dated zero-fee completed customers remain visible')
assert.deepEqual(parsePartnerPublication(publication, IWEDDING_PARTNER_ID), publication)
assert.notStrictEqual(parsePartnerPublication(publication, IWEDDING_PARTNER_ID), publication, 'Loader returns a fresh safe object, not a raw document')
assert.equal(JSON.stringify(rows), before)
assert(new TextEncoder().encode(JSON.stringify(publication)).byteLength < MAX_PARTNER_PUBLICATION_BYTES)
const serialized = JSON.stringify(publication)
for (const forbidden of ['customerName', 'phoneLast4', 'purchaseAmount', 'lumpSumAmount', 'subscriptionAmount', 'salesRawPeriods', 'subscriptionRawPeriods', 'manager', 'memoHistory', 'plannerName', 'note', '비공개', '김준수', '이영희', '01012340252', '8888', '다른회사', '다이렉트', 'private-id', 'private-shared-case', 'foreign-', '99999999']) assert.equal(serialized.includes(forbidden), false, forbidden)

const clone = () => JSON.parse(JSON.stringify(publication))
function invalid(change: (value: any) => void) { const value = clone(); change(value); assert.equal(parsePartnerPublication(value, IWEDDING_PARTNER_ID), null) }
for (const id of ['', 'other-partner', 'IWEDDING', '../iwedding', 'E90227']) {
  assert.equal(parsePartnerPublication(publication, id), null)
  assert.throws(() => buildPartnerPublication(rows, id, publishedAt))
}
for (const date of ['', '2026-10-09', '2026-02-30T00:00:00.000Z', '2026-10-09T25:00:00.000Z', '2026-10-09T00:00:00Z', '2026-10-09T09:00:00.000+09:00']) assert.throws(() => buildPartnerPublication(rows, IWEDDING_PARTNER_ID, date))
for (const value of [null, undefined, [], 'publication', 0, {}, new Date(), Object.create({ schemaVersion: 1 })]) assert.equal(parsePartnerPublication(value, IWEDDING_PARTNER_ID), null)
invalid(value => { value.role = 'admin' })
invalid(value => { value.partnerId = 'other-partner' })
invalid(value => { value.partnerName = '(주)다이렉트컴즈' })
invalid(value => { value.schemaVersion = 2 })
invalid(value => { value.publishedAt = 'not-a-date' })
invalid(value => { delete value.publishedAt })
invalid(value => { value.months[0].lumpSumAmount = 99999999 })
invalid(value => { value.months[0].partnerName = '(주)다이렉트컴즈' })
invalid(value => { value.months[0].intakeMonth = '2026-13' })
invalid(value => { value.months[0].customerCount++ })
invalid(value => { value.months[0].receiptCount = 2 })
invalid(value => { value.months[1].completedExpectedCommission++ })
invalid(value => { value.months[1].undatedCustomerCount++ })
invalid(value => { value.months[1].undatedExpectedCommission++ })
invalid(value => { value.months[0].customers[0].label = '김준수 / 0252' })
invalid(value => { value.months[0].customers[0].label = '김** / 01012340252' })
invalid(value => { value.months[0].customers[0].customerName = '김준수' })
invalid(value => { value.months[0].customers[0].key = 'own-october' })
invalid(value => { value.months[0].customers[0].expectedCommission = -1 })
invalid(value => { value.months[0].customers[0].expectedSettlementMonth = '2026-10' })
invalid(value => { value.months[0].customers[0].deliveryScheduledDate = '2026-02-30' })
invalid(value => { value.months[0].customers[0].registeredAt = '2026-02-30' })
invalid(value => { value.months[1].customers.find((customer: any) => customer.status === '관리중').expectedCommission = 1 })
invalid(value => { value.months[0].settlements[0].saleAmount = 99999999 })
invalid(value => { value.months[0].settlements[0].expectedCommission = 1 })
invalid(value => { value.months[0].settlements[0].customerCount++ })
invalid(value => { value.months.push(value.months[0]) })
invalid(value => { value.months.reverse() })
invalid(value => { value.months[0].customers[0].status = 'unknown' })
const getter = clone()
Object.defineProperty(getter, 'publishedAt', { enumerable: true, get() { throw new Error('Do not invoke an untrusted getter') } })
assert.equal(parsePartnerPublication(getter, IWEDDING_PARTNER_ID), null)
const symbol = clone(); symbol[Symbol('private')] = 'secret'; assert.equal(parsePartnerPublication(symbol, IWEDDING_PARTNER_ID), null)

invalid(value => { value.months[1].basisRequiredCount++ })
invalid(value => { value.months[1].customers.find((customer: any) => customer.basisRequired).basisReason = '다른 업체 원본 이름' })
invalid(value => { value.months[1].customers.find((customer: any) => customer.basisRequired).expectedCommission = 0 })
invalid(value => { value.months[1].customers.find((customer: any) => customer.basisRequired).deliveryScheduledDate = '2026-09-30' })
invalid(value => { delete value.months[1].customers[0].basisReason })
const legacy = JSON.parse(JSON.stringify(buildPartnerPublication([lead('legacy')], IWEDDING_PARTNER_ID, publishedAt)))
for (const model of legacy.months) { delete model.basisRequiredCount; for (const customer of model.customers) { delete customer.basisRequired; delete customer.basisReason; delete customer.salesChannels } }
assert.deepEqual(parsePartnerPublication(legacy, IWEDDING_PARTNER_ID), legacy, 'Strict older schema-1 publications remain readable without new confirmation fields')
const channelLead = lead('route-proof', { purchaseType: '일시불', lumpSumAmount: 100000, subscriptionAmount: undefined })
channelLead.salesRawPeriods!['2026-09'].channels = [{ channel1: '고객인증서비스(웨딩)', channel2: '웨딩업체연결(수수료지급)', orderCount: 1, amount: 100000 }]
const channelPublication = buildPartnerPublication([channelLead], IWEDDING_PARTNER_ID, publishedAt)
assert.deepEqual(parsePartnerPublication(channelPublication, IWEDDING_PARTNER_ID), channelPublication)
assert.deepEqual(Object.keys(channelPublication.months[0].customers[0].salesChannels![0]).sort(), ['kind', 'period', 'status', 'channel1', 'channel2'].sort())
for (const mutate of [
  (route: any) => { route.amount = 100000 },
  (route: any) => { route.orderCount = 1 },
  (route: any) => { route.ownerId = 'private-source' },
  (route: any) => { route.status = 'mismatch' },
  (route: any) => { route.kind = 'cash' },
  (route: any) => { route.period = '2026-13' },
  (route: any) => { route.channel1 = 'a'.repeat(201) },
  (route: any) => { route.channel2 = '줄바꿈\n경로' },
  (route: any) => { route.channel2 = '  웨딩박람회(내부)' },
]) {
  const tampered = JSON.parse(JSON.stringify(channelPublication)); mutate(tampered.months[0].customers[0].salesChannels[0])
  assert.equal(parsePartnerPublication(tampered, IWEDDING_PARTNER_ID), null, 'Route fields are bounded and route verdict cannot be spoofed')
}
const duplicateRoutes = JSON.parse(JSON.stringify(channelPublication))
duplicateRoutes.months[0].customers[0].salesChannels.push(duplicateRoutes.months[0].customers[0].salesChannels[0])
assert.equal(parsePartnerPublication(duplicateRoutes, IWEDDING_PARTNER_ID), null)
invalid(value => { value.months[1].customers.find((customer: any) => customer.basisRequired).salesChannels = channelPublication.months[0].customers[0].salesChannels })
const oldRouteFree = JSON.parse(JSON.stringify(channelPublication)); delete oldRouteFree.months[0].customers[0].salesChannels
assert.deepEqual(parsePartnerPublication(oldRouteFree, IWEDDING_PARTNER_ID), oldRouteFree, 'A prior publication without route metadata remains readable')

const categoryRows = [
  lead('own-complete'),
  lead('own-active-selected', { status: '관리중' }),
  lead('own-complete-secondary', { caseGroupId: 'foreign-active-group', caseBasisLeadId: 'foreign-active-basis' }),
  lead('foreign-active-basis', { caseGroupId: 'foreign-active-group', caseBasisLeadId: 'foreign-active-basis', partnerName: '다른 업체', status: '관리중' }),
  lead('own-active-secondary', { caseGroupId: 'foreign-complete-group', caseBasisLeadId: 'foreign-complete-basis', status: '관리중' }),
  lead('foreign-complete-basis', { caseGroupId: 'foreign-complete-group', caseBasisLeadId: 'foreign-complete-basis', partnerName: '다른 업체' }),
]
const categoryOriginal = JSON.stringify(categoryRows)
const categoryPublication = buildPartnerPublication(categoryRows, IWEDDING_PARTNER_ID, publishedAt)
assert.equal(categoryPublication.months[0].customerCount, 4)
assert.equal(categoryPublication.months[0].basisRequiredCount, 2)
assert.equal(categoryPublication.months[0].completedCount, 1)
assert.equal(categoryPublication.months[0].activeCount, 1)
assert.deepEqual(parsePartnerPublication(categoryPublication, IWEDDING_PARTNER_ID), categoryPublication)
const olderEnhanced = JSON.parse(JSON.stringify(categoryPublication))
olderEnhanced.months[0].completedCount = 2
olderEnhanced.months[0].activeCount = 2
assert.deepEqual(parsePartnerPublication(olderEnhanced, IWEDDING_PARTNER_ID), categoryPublication,
  'Old enhanced schema-1 publications remain readable and normalize to selected-only categories')
assert.equal(olderEnhanced.months[0].completedCount, 2, 'Safe loading never mutates the source publication')
for (const [completedCount, activeCount] of [[2, 1], [1, 2], [0, 1], [1, 0], [3, 2], [2, 3]]) {
  const tampered = JSON.parse(JSON.stringify(categoryPublication))
  Object.assign(tampered.months[0], { completedCount, activeCount })
  assert.equal(parsePartnerPublication(tampered, IWEDDING_PARTNER_ID), null, 'Mixed/invalid status totals cannot pass the exact-pair allowlist')
}
for (const status of ['구매완료', '관리중', '상담 마감', '취소'] as const) {
  const chosenRows = [
    lead('chosen', { caseGroupId: 'chosen-group', caseBasisLeadId: 'chosen', status }),
    lead('excluded', { caseGroupId: 'chosen-group', caseBasisLeadId: 'chosen', status: status === '관리중' ? '구매완료' : '관리중' }),
  ]
  const safe = buildPartnerPublication(chosenRows, IWEDDING_PARTNER_ID, publishedAt)
  assert.equal(safe.months[0].customerCount, 1)
  assert.equal(safe.months[0].completedCount, status === '구매완료' ? 1 : 0)
  assert.equal(safe.months[0].activeCount, status === '관리중' ? 1 : 0)
  assert.deepEqual(parsePartnerPublication(safe, IWEDDING_PARTNER_ID), safe)
}
assert.equal(JSON.stringify(categoryRows), categoryOriginal, 'Preview/publication must not rewrite any original status')

const empty = buildPartnerPublication(rows.filter(row => row.partnerName === '(주)다이렉트컴즈'), IWEDDING_PARTNER_ID, publishedAt)
assert.deepEqual(empty.months, [])
assert.deepEqual(parsePartnerPublication(empty, IWEDDING_PARTNER_ID), empty)
assert.throws(() => buildPartnerPublication(Array.from({ length: MAX_PARTNER_PUBLICATION_CUSTOMERS + 1 }, (_, index) => lead(`too-large-${index}`)), IWEDDING_PARTNER_ID, publishedAt), /허용 크기/)
assert.deepEqual(buildPartnerPublication([...rows, { ...rows[2], lumpSumAmount: 99999999 }], IWEDDING_PARTNER_ID, publishedAt), publication, 'Repeated source document cannot inflate safe publication')
console.log('partnerPublication tests passed: approved tenant, safe allowlist, linked intake months, immutable fees, strict loader and document size limits')
