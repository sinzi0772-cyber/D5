import assert from 'node:assert/strict'
import { buildCommissionSettlementMetrics, deliveryDateValidationMessage, expectedSettlementMonthFor, isValidDeliveryDate } from '../src/lib/commissionSettlement.ts'
import { expectedRebateFor } from '../src/lib/salesFinance.ts'
import type { Lead } from '../src/types.ts'

const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id, customerName: '가*나', phoneLast4: '0001', gender: '미입력',
  registeredAt: '2026-09-01', updatedAt: '2026-10-07',
  partnerName: '(주)다이렉트컴즈', appointmentType: '이업종제휴',
  status: '구매완료', visitState: '방문', purchaseType: '일시불',
  lumpSumAmount: 1000000, ...changes,
})

for (const date of ['2024-02-29', '2000-02-29', '1900-02-28', '2026-04-30', '2026-10-07', '2026-12-31', '9999-12-31']) {
  assert.equal(isValidDeliveryDate(date), true)
}
for (const date of [undefined, null, 0, 123, {}, [], new Date(), '', '0000-01-01', '2026-2-07', '2026-02-7', '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026/10/07', '2026-10-07T00:00:00Z', ' 2026-10-07', '2026-10-07 ']) {
  assert.equal(isValidDeliveryDate(date), false)
}
for (const [date, month] of [['2026-01-31', '2026-03'], ['2024-02-29', '2024-04'], ['2026-10-07', '2026-12'], ['2026-11-30', '2027-01'], ['2026-12-31', '2027-02'], ['9999-12-31', '10000-02']]) {
  assert.equal(expectedSettlementMonthFor({ deliveryScheduledDate: date }), month)
}
assert.equal(expectedSettlementMonthFor({}), null)
assert.equal(expectedSettlementMonthFor({ deliveryScheduledDate: '2026-02-30' }), null)
assert.equal(deliveryDateValidationMessage({ status: '구매완료' }), '구매완료 고객은 배송 예정일을 입력해주세요.')
assert.ok(deliveryDateValidationMessage({ status: '구매완료', deliveryScheduledDate: '' }))
assert.ok(deliveryDateValidationMessage({ status: '구매완료', deliveryScheduledDate: '2026-02-30' }))
assert.equal(deliveryDateValidationMessage({ status: '구매완료', deliveryScheduledDate: '2024-02-29' }), null)
for (const status of ['관리중', '상담 마감', '취소'] as const) {
  assert.equal(deliveryDateValidationMessage({ status }), null)
  assert.equal(deliveryDateValidationMessage({ status, deliveryScheduledDate: '' }), null)
  assert.equal(deliveryDateValidationMessage({ status, deliveryScheduledDate: '2026-10-07' }), null)
  assert.ok(deliveryDateValidationMessage({ status, deliveryScheduledDate: '2026-02-30' }))
}

const rows = [
  lead('december', { deliveryScheduledDate: '2026-12-31' }),
  lead('january-a', { deliveryScheduledDate: '2026-01-31', lumpSumAmount: 2000000, caseGroupId: 'linked-case' }),
  lead('january-b', { deliveryScheduledDate: '2026-01-02', partnerName: '(주)아이패밀리에스씨', purchaseType: '구독', lumpSumAmount: 0, subscriptionAmount: 1000000, caseGroupId: 'linked-case' }),
  lead('february-linked', { deliveryScheduledDate: '2026-02-01', lumpSumAmount: 3000000, caseGroupId: 'linked-case' }),
  lead('leap-zero', { deliveryScheduledDate: '2024-02-29', lumpSumAmount: 0 }),
  lead('missing-date', { lumpSumAmount: 500000 }),
  lead('invalid-date', { deliveryScheduledDate: '2026-02-30', lumpSumAmount: 600000 }),
  lead('missing-date-zero', { lumpSumAmount: 0 }),
  lead('unfinished', { status: '관리중', deliveryScheduledDate: '2026-03-01', lumpSumAmount: 700000 }),
  lead('closed', { status: '상담 마감', deliveryScheduledDate: '2026-05-01', lumpSumAmount: 800000 }),
  lead('canceled', { status: '취소', lumpSumAmount: 900000 }),
]
const immutableRows = Object.freeze(rows.map(row => Object.freeze(row)))
const before = JSON.stringify(immutableRows)
const metrics = buildCommissionSettlementMetrics(immutableRows)
assert.deepEqual(metrics.months.map(row => row.month), ['2024-04', '2026-03', '2026-04', '2027-02'])
assert.equal(metrics.completedCustomerCount, 8)
assert.equal(metrics.completedExpectedCommission, 157000)
assert.equal(metrics.scheduledCustomerCount, 5)
assert.equal(metrics.scheduledExpectedCommission, 135000)
assert.equal(metrics.unscheduledCustomerCount, 3)
assert.equal(metrics.unscheduledExpectedCommission, 22000)
assert.deepEqual(metrics.unscheduledLeads.map(row => row.id), ['missing-date', 'invalid-date', 'missing-date-zero'])
assert.equal(metrics.unfinishedCustomerCount, 3)
assert.equal(metrics.unfinishedExpectedCommission, 48000)
assert.equal(metrics.scheduledExpectedCommission + metrics.unscheduledExpectedCommission, metrics.completedExpectedCommission)
assert.equal(metrics.completedExpectedCommission + metrics.unfinishedExpectedCommission, immutableRows.reduce((sum, row) => sum + expectedRebateFor(row), 0), 'Classification must not change existing fee calculations')
const march = metrics.months.find(row => row.month === '2026-03')!
assert.equal(march.customerCount, 2)
assert.equal(march.caseCount, 1)
assert.equal(march.expectedCommission, 55000)
assert.equal(march.partners.reduce((sum, row) => sum + row.caseCount, 0), 2, 'Each involved company owns its own customer in a shared case')
assert.equal(march.partners.find(row => row.name === '(주)다이렉트컴즈')?.expectedCommission, 40000)
assert.equal(march.partners.find(row => row.name === '(주)아이패밀리에스씨')?.expectedCommission, 15000)
assert.equal(metrics.months.find(row => row.month === '2026-04')?.caseCount, 1, 'A linked customer in another planned month stays visible in that month')
assert.equal(metrics.months[0].expectedCommission, 0, 'A dated zero-fee completed customer must not be dropped')
assert.equal(metrics.months[0].customerCount, 1)
for (const month of metrics.months) {
  assert.equal(month.partners.reduce((sum, row) => sum + row.expectedCommission, 0), month.expectedCommission)
  assert.equal(month.partners.reduce((sum, row) => sum + row.customerCount, 0), month.customerCount)
  assert.equal(month.leads.reduce((sum, row) => sum + expectedRebateFor(row), 0), month.expectedCommission)
  assert.ok(month.leads.every(row => row.status === '구매완료'))
  for (const member of month.leads) assert.strictEqual(member, immutableRows.find(row => row.id === member.id), 'Keep the original saved customer object')
}
assert.equal(metrics.months.reduce((sum, row) => sum + row.expectedCommission, 0), metrics.scheduledExpectedCommission)
assert.equal(metrics.months.reduce((sum, row) => sum + row.customerCount, 0), metrics.scheduledCustomerCount)
assert.equal(JSON.stringify(immutableRows), before, 'Do not mutate saved dates, amounts, statuses, managers or memos')

const direct = buildCommissionSettlementMetrics(immutableRows, '(주)다이렉트컴즈')
assert.equal(direct.completedCustomerCount, 7)
assert.equal(direct.completedExpectedCommission, 142000)
assert.equal(direct.scheduledExpectedCommission, 120000)
assert.equal(direct.unscheduledExpectedCommission, 22000)
assert.equal(direct.unfinishedExpectedCommission, 48000)
for (const month of direct.months) {
  const overallPartner = metrics.months.find(row => row.month === month.month)!.partners.find(row => row.name === '(주)다이렉트컴즈')!
  assert.equal(month.expectedCommission, overallPartner.expectedCommission)
  assert.equal(month.customerCount, overallPartner.customerCount)
  assert.equal(month.caseCount, overallPartner.caseCount)
  assert.ok(month.leads.every(row => row.partnerName === '(주)다이렉트컴즈'))
}
const family = buildCommissionSettlementMetrics(immutableRows, '(주)아이패밀리에스씨')
assert.equal(family.completedCustomerCount, 1)
assert.equal(family.scheduledExpectedCommission, 15000)
assert.deepEqual(family.months.map(row => row.month), ['2026-03'], 'Delivery forecasts must not use registration month')
assert.equal(family.unscheduledCustomerCount, 0)
assert.equal(family.unfinishedCustomerCount, 0)
assert.equal(buildCommissionSettlementMetrics(immutableRows, '없는 업체').completedCustomerCount, 0)
assert.deepEqual(buildCommissionSettlementMetrics([]).months, [])
assert.deepEqual(buildCommissionSettlementMetrics([...immutableRows, { ...rows[0], deliveryScheduledDate: '2027-04-01', lumpSumAmount: 9000000 }]), metrics, 'Count a repeated document ID once; retain the first saved record')

const roundingCustomers = ['rounding-a', 'rounding-b'].map(id => lead(id, { deliveryScheduledDate: '2026-06-01', purchaseType: '일시불+구독', lumpSumAmount: 26, subscriptionAmount: 34, caseGroupId: 'rounding-case' }))
const roundingMetrics = buildCommissionSettlementMetrics(roundingCustomers)
assert.equal(roundingMetrics.months[0].expectedCommission, 4, 'Sum already-rounded customer commissions instead of rerounding merged bases')
assert.equal(roundingMetrics.months[0].customerCount, 2)
assert.equal(roundingMetrics.months[0].caseCount, 1)
const manualAmount = lead('manual-preserved', { deliveryScheduledDate: '2026-09-07', purchaseType: '일시불+구독', lumpSumAmount: 20864000, subscriptionAmount: 1891000, manager: '수기 담당', note: '수기 메모' })
const manualBefore = JSON.stringify(manualAmount)
assert.equal(buildCommissionSettlementMetrics([manualAmount]).months[0].expectedCommission, 445645)
assert.equal(buildCommissionSettlementMetrics([manualAmount]).months[0].month, '2026-11')
assert.equal(JSON.stringify(manualAmount), manualBefore)
assert.deepEqual(buildCommissionSettlementMetrics([lead('before-year-maximum', { deliveryScheduledDate: '9999-09-01' }), lead('year-maximum', { deliveryScheduledDate: '9999-12-31' })]).months.map(row => row.month), ['9999-11', '10000-02'], 'Chronological order survives year rollover at the input-year boundary')

console.log('commissionSettlement tests passed: strict calendar, planned month + 2, completion/unknown scopes, linked cases, company totals and immutable fee amounts')
