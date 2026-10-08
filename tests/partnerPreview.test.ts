import assert from 'node:assert/strict'
import { buildPartnerPreview, canPreviewPartner } from '../src/lib/partnerPreview.ts'
import { expectedRebateFor } from '../src/lib/salesFinance.ts'
import type { Lead } from '../src/types.ts'

const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id, customerName: '김준수', phoneLast4: '01012340252', gender: '남',
  registeredAt: '2026-09-04', updatedAt: '2026-10-07',
  partnerName: '(주)다이렉트컴즈', appointmentType: '이업종제휴',
  status: '구매완료', visitState: '방문', purchaseType: '일시불+구독',
  lumpSumAmount: 20864000, subscriptionAmount: 1891000,
  manager: '비공개 담당자', managerEmployeeNo: '12345',
  plannerName: '비공개 플래너', note: '비공개 메모',
  memoHistory: [{ id: 'memo', date: '2026-09-06', manager: '비공개 담당자', content: '비공개 상담내용' }],
  ...changes,
})

for (const role of ['admin', 'store_manager', 'assistant_manager', 'manager']) assert.equal(canPreviewPartner(role), true)
for (const role of [null, undefined, {}, 1, 'partner', 'demo_admin', '', 'ADMIN', ' admin ']) assert.equal(canPreviewPartner(role), false)

const rows = Object.freeze([
  Object.freeze(lead('source-김준수-01012340252', { deliveryScheduledDate: '2026-09-30', caseGroupId: 'same-case' })),
  Object.freeze(lead('other-member', { registeredAt: '2026-10-01', partnerName: '(주)아이패밀리에스씨', caseGroupId: 'same-case', deliveryScheduledDate: '2026-12-31' })),
  Object.freeze(lead('unplanned', { customerName: '박영희', phoneLast4: '5555', lumpSumAmount: 1000000, subscriptionAmount: 0 })),
  Object.freeze(lead('active', { status: '관리중', customerName: '이도연', phoneLast4: '6666', deliveryScheduledDate: '2026-09-10' })),
  Object.freeze(lead('other-company', { partnerName: '다른 업체', customerName: '배선영', phoneLast4: '7777', deliveryScheduledDate: '2026-09-15' })),
  Object.freeze(lead('october', { registeredAt: '2026-10-02', phoneLast4: '8888', deliveryScheduledDate: '2026-10-10' })),
])
const before = JSON.stringify(rows)
const direct = buildPartnerPreview(rows, '(주)다이렉트컴즈', '2026-09')
assert.equal(direct.customerCount, 3)
assert.equal(direct.receiptCount, 3)
assert.equal(direct.completedCount, 2)
assert.equal(direct.activeCount, 1)
assert.equal(direct.completedExpectedCommission, expectedRebateFor(rows[0]) + expectedRebateFor(rows[2]))
assert.deepEqual(direct.settlements, [{ month: '2026-11', expectedCommission: 445645, customerCount: 1 }])
assert.equal(direct.undatedExpectedCommission, 20000)
assert.equal(direct.undatedCustomerCount, 1)
assert.equal(direct.customers.find(customer => customer.label.startsWith('김'))?.label, '김** / 0252')
assert.equal(direct.customers.find(customer => customer.status === '관리중')?.expectedCommission, null)
assert.equal(direct.customers.find(customer => customer.status === '관리중')?.expectedSettlementMonth, null)
assert.equal(direct.settlements.reduce((sum, bucket) => sum + bucket.expectedCommission, 0) + direct.undatedExpectedCommission, direct.completedExpectedCommission)
assert.deepEqual(direct.customers.map(customer => Object.keys(customer).sort()), direct.customers.map(() => ['key', 'label', 'registeredAt', 'status', 'deliveryScheduledDate', 'expectedCommission', 'expectedSettlementMonth'].sort()))
const serialized = JSON.stringify(direct)
for (const forbidden of ['lumpSumAmount', 'subscriptionAmount', 'purchaseAmount', 'purchaseType', 'salesRawPeriods', 'subscriptionRawPeriods', 'customerName', 'phoneLast4', 'manager', 'memoHistory', 'plannerName', 'note', 'source-김준수', '김준수', '01012340252', '비공개', '7777', '8888']) assert.equal(serialized.includes(forbidden), false, `Do not project ${forbidden}`)
assert.equal(JSON.stringify(rows), before)
assert.deepEqual(buildPartnerPreview([...rows, { ...rows[0], lumpSumAmount: 99999999 }], '(주)다이렉트컴즈', '2026-09'), direct, 'Duplicated saved IDs retain first source and cannot inflate fees')

const family = buildPartnerPreview(rows, '(주)아이패밀리에스씨', '2026-09')
assert.equal(family.customerCount, 1, 'Company with later linked member inherits whole-case earliest intake month')
assert.equal(family.customers[0].registeredAt, '2026-10-01')
assert.equal(family.settlements[0].month, '2027-02', 'Forecast is delivery month + 2, not intake month + 2')
assert.equal(buildPartnerPreview(rows, '(주)아이패밀리에스씨', '2026-10').customerCount, 0)
assert.deepEqual(buildPartnerPreview(rows, '아이웨딩', '2026-09'), family, 'Only approved canonical aliases match')
const aliasRows = [lead('alias', { partnerName: '아이웨딩', deliveryScheduledDate: '2026-11-05' })]
assert.equal(buildPartnerPreview(aliasRows, '(주)아이패밀리에스씨', '2026-09').customerCount, 1)
for (const company of ['', '  ', '전체 제휴업체', '다이렉트', '알 수 없는 업체']) assert.equal(buildPartnerPreview(rows, company, '2026-09').customerCount, 0)
for (const month of ['', '2026-9', '2026-00', '2026-13', '0000-01', 'unknown']) assert.equal(buildPartnerPreview(rows, '(주)다이렉트컴즈', month).customerCount, 0)
assert.equal(buildPartnerPreview(rows, '(주)다이렉트컴즈', '2026-10').customerCount, 1)
const zero = buildPartnerPreview([lead('zero', { lumpSumAmount: 0, subscriptionAmount: 0, deliveryScheduledDate: '2026-09-30' })], '(주)다이렉트컴즈', '2026-09')
assert.equal(zero.settlements[0].customerCount, 1, 'Zero-fee completed customer remains visible')
assert.equal(zero.settlements[0].expectedCommission, 0)
const invalid = buildPartnerPreview([lead('invalid', { deliveryScheduledDate: '2026-02-30' })], '(주)다이렉트컴즈', '2026-09')
assert.equal(invalid.customers[0].deliveryScheduledDate, null)
assert.equal(invalid.customers[0].expectedSettlementMonth, null)
assert.equal(invalid.undatedCustomerCount, 1)
console.log('partnerPreview tests passed: exact staff capability, canonical company/month scope, linked cases, safe projection, preserved fees and planned settlement')
