import assert from 'node:assert/strict'
import { buildPartnerPublication, IWEDDING_PARTNER_ID, IWEDDING_PARTNER_NAME, MAX_PARTNER_PUBLICATION_BYTES, MAX_PARTNER_PUBLICATION_CUSTOMERS, parsePartnerPublication } from '../src/lib/partnerPublication.ts'
import { expectedRebateFor } from '../src/lib/salesFinance.ts'
import type { Lead } from '../src/types.ts'

const publishedAt = '2026-10-09T05:10:00.000Z'
const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id, registeredAt: '2026-09-21', updatedAt: publishedAt,
  customerName: '김준수', phoneLast4: '01012340252', gender: '남',
  partnerName: IWEDDING_PARTNER_NAME, appointmentType: '이업종제휴',
  status: '구매완료', visitState: '방문', deliveryScheduledDate: '2026-09-30',
  purchaseType: '일시불+구독', lumpSumAmount: 20864000, subscriptionAmount: 1891000,
  manager: '비공개 담당자', managerEmployeeNo: '98765', plannerName: '비공개 플래너',
  note: '비공개 상담 메모', memoHistory: [{ id: 'private-memo', date: '2026-10-01', manager: '비공개 담당자', content: '비공개 상담 내용' }],
  ...changes,
})
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
assert.deepEqual(publication.months.map(model => model.intakeMonth), ['2026-10', '2026-09', '2026-08'])
assert.equal(publication.months[2].customers[0].registeredAt, '2026-09-01', 'Later own-company member remains in the complete linked case original August intake')
assert.equal(publication.months[2].settlements[0].month, '2027-02')
assert.equal(publication.months[1].customerCount, 3)
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

const empty = buildPartnerPublication(rows.filter(row => row.partnerName === '(주)다이렉트컴즈'), IWEDDING_PARTNER_ID, publishedAt)
assert.deepEqual(empty.months, [])
assert.deepEqual(parsePartnerPublication(empty, IWEDDING_PARTNER_ID), empty)
assert.throws(() => buildPartnerPublication(Array.from({ length: MAX_PARTNER_PUBLICATION_CUSTOMERS + 1 }, (_, index) => lead(`too-large-${index}`)), IWEDDING_PARTNER_ID, publishedAt), /허용 크기/)
assert.deepEqual(buildPartnerPublication([...rows, { ...rows[2], lumpSumAmount: 99999999 }], IWEDDING_PARTNER_ID, publishedAt), publication, 'Repeated source document cannot inflate safe publication')
console.log('partnerPublication tests passed: approved tenant, safe allowlist, linked intake months, immutable fees, strict loader and document size limits')
