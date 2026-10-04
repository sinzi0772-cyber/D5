import assert from 'node:assert/strict'
import { buildExecutiveMetrics, getDefaultExecutiveMonth, getExecutiveMonthLeads, getExecutiveMonths } from '../src/lib/executiveMetrics.ts'
import type { Lead, SalesRawPeriod } from '../src/types.ts'

const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id,
  registeredAt: '2026-09-10',
  customerName: id,
  phoneLast4: '1234',
  gender: '미입력',
  partnerName: '(주)다이렉트컴즈',
  status: '관리중',
  visitState: '미정',
  updatedAt: '2026-09-10T00:00:00Z',
  ...changes,
})

const rows = [
  lead('couple-first', { caseGroupId: 'couple', registeredAt: '2026-08-31', manager: 'A', status: '취소', purchaseType: '일시불', purchaseAmount: 99_000 }),
  lead('couple-later', { caseGroupId: 'couple', registeredAt: '2026-09-01', manager: 'B', status: '구매완료', purchaseType: '일시불+구독', lumpSumAmount: 1_000_000, subscriptionAmount: 2_000_000 }),
  lead('finished', { manager: 'A', status: '구매완료', partnerName: '대상 아닌 업체', purchaseType: '구독', purchaseAmount: 1_000_000 }),
  lead('finished-no-amount', { manager: 'A', status: '구매완료' }),
  lead('active-amount', { manager: 'A', purchaseType: '일시불', purchaseAmount: 8_000_000, visitScheduledDate: '2026-10-02', memoHistory: [{ id: 'm1', date: '2026-10-01', manager: 'A', content: '연락' }] }),
  lead('closed', { manager: 'A', status: '상담 마감' }),
  lead('canceled', { manager: 'A', status: '취소' }),
  lead('unassigned', { registeredAt: '2026-09-26', visitScheduledDate: '2026-10-01' }),
  lead('already-visited', { manager: 'B', visitScheduledDate: '2026-09-30', visitState: '방문', note: '확인', updatedAt: '2026-10-02T23:00:00Z' }),
  lead('schedule-canceled', { manager: 'B', visitScheduledDate: '2026-09-30', visitState: '일정취소', memoHistory: [{ id: 'm2', date: '2026-09-26', manager: 'B', content: '변경' }] }),
]

const metrics = buildExecutiveMetrics(rows, '2026-09', '2026-10-03')
assert.equal(metrics.current.cases, 8)
assert.equal(metrics.current.customerCount, 8)
assert.equal(metrics.current.completed, 2)
assert.equal(metrics.current.active, 4)
assert.equal(metrics.current.closed, 1)
assert.equal(metrics.current.canceled, 1)
assert.equal(metrics.current.conversionRate, 25)
assert.equal(metrics.current.sales, 1_000_000, 'Only completed customer amounts are sales')
assert.equal(metrics.current.expectedCommission, 0, 'Subscription partner eligibility matters')
assert.equal(metrics.current.missingAmounts, 1)
assert.equal(metrics.previous.cases, 1, 'Cross-month linked group belongs only to earliest intake month')
assert.equal(metrics.previous.customerCount, 2)
assert.equal(metrics.previous.completed, 1, 'One completed member makes one completed case')
assert.equal(metrics.previous.canceled, 0, 'Case outcome categories are exclusive')
assert.equal(metrics.previous.sales, 3_000_000)
assert.equal(metrics.previous.expectedCommission, 30_000, 'Unverified manual lump-sum money has no commission basis')
assert.equal(metrics.current.reservedSales, 0)
assert.deepEqual(metrics.actions.unassigned.map(item => item.id), ['unassigned'])
assert.deepEqual(metrics.actions.overdue.map(item => item.id), ['unassigned', 'active-amount'])
assert.deepEqual(metrics.actions.stale.map(item => item.id).sort(), ['schedule-canceled', 'unassigned'])
assert.equal(metrics.partners.reduce((total, item) => total + item.cases, 0), metrics.current.cases)
assert.equal(metrics.managers.find(item => item.name === 'A')?.assigned, 5)
assert.equal(metrics.current.managementRecords, 3)
assert.equal(getExecutiveMonthLeads(rows, '2026-08').length, 2)
assert.deepEqual(getExecutiveMonths(rows), ['2026-09', '2026-08'])
assert.equal(getDefaultExecutiveMonth(rows, '2026-10-03'), '2026-09')
assert.equal(getDefaultExecutiveMonth([], '2026-10-03'), '2026-10')
assert.equal(buildExecutiveMetrics([], '2026-01', '2026-10-03').previousMonth, '2025-12')
assert.equal(buildExecutiveMetrics([], '2026-10', '2026-10-03').current.conversionRate, 0)
assert.throws(() => buildExecutiveMetrics(rows, '2026-13', '2026-10-03'), RangeError)
assert.throws(() => buildExecutiveMetrics(rows, '2026-10', '2026-02-30'), RangeError)

const crossPartnerCouple = [
  lead('first-partner-a', { caseGroupId: 'cross-partner', registeredAt: '2026-08-31', partnerName: 'A 업체' }),
  lead('later-partner-b', { caseGroupId: 'cross-partner', registeredAt: '2026-09-01', partnerName: 'B 업체', status: '구매완료', purchaseType: '일시불', purchaseAmount: 1_000_000 }),
  lead('active-partner-b', { registeredAt: '2026-09-10', partnerName: 'B 업체' }),
]
const partnerBAugust = buildExecutiveMetrics(crossPartnerCouple, '2026-08', '2026-10-03', 'B 업체')
const partnerBSeptember = buildExecutiveMetrics(crossPartnerCouple, '2026-09', '2026-10-03', 'B 업체')
assert.equal(partnerBAugust.current.cases, 1, 'Partner B keeps the complete group original August cohort')
assert.equal(partnerBAugust.current.customerCount, 1, 'Partner filter includes only its own customer')
assert.equal(partnerBAugust.current.completed, 1)
assert.equal(partnerBAugust.current.sales, 1_000_000)
assert.equal(partnerBAugust.current.expectedCommission, 0, 'Manual lump-sum amount alone does not prove an eligible sales route')
assert.equal(partnerBSeptember.current.cases, 1, 'The later linked member does not become a new September case')
assert.equal(partnerBSeptember.current.completed, 0)
assert.equal(partnerBSeptember.previous.cases, 1)
assert.deepEqual(getExecutiveMonthLeads(crossPartnerCouple, '2026-08', 'B 업체').map(item => item.id), ['later-partner-b'])
assert.deepEqual(getExecutiveMonthLeads(crossPartnerCouple, '2026-09', 'B 업체').map(item => item.id), ['active-partner-b'])
assert.deepEqual(partnerBAugust.actions.unassigned.map(item => item.id), ['active-partner-b'], 'Action queues respect partner scope across intake months')
assert.deepEqual(partnerBAugust.actions.stale.map(item => item.id), ['active-partner-b'])

const rawPeriod = (changes: Partial<SalesRawPeriod> = {}): SalesRawPeriod => ({
  period: '2026-09',
  sourceHash: 'anonymous-fixture',
  importedAt: '2026-10-04T00:00:00Z',
  orderCount: 2,
  confirmedOrderCount: 1,
  reservedOrderCount: 1,
  confirmedAmount: 2_000_000,
  reservedAmount: 1_000_000,
  eligibleConfirmedAmount: 2_000_000,
  eligibleReservedAmount: 1_000_000,
  returnAmount: 0,
  ...changes,
})

const rawRows = [
  lead('raw-active', {
    manager: 'A', purchaseType: '일시불+구독', lumpSumAmount: 3_000_000, subscriptionAmount: 1_000_000,
    salesRawPeriods: { '2026-09': rawPeriod() },
    memoHistory: [{ id: 'raw-note', date: '2026-09-15', manager: 'A', content: '수기 관리 보존' }],
  }),
  lead('raw-completed', {
    manager: 'B', status: '구매완료', purchaseType: '일시불+구독', lumpSumAmount: 3_000_000, subscriptionAmount: 1_000_000,
    salesRawPeriods: { '2026-09': rawPeriod({ eligibleConfirmedAmount: 500_000, eligibleReservedAmount: 0 }) },
  }),
  lead('raw-route-ineligible', {
    manager: 'B', status: '취소', purchaseType: '일시불', lumpSumAmount: 3_000_000,
    salesRawPeriods: { '2026-09': rawPeriod({ eligibleConfirmedAmount: 0, eligibleReservedAmount: 0 }) },
  }),
  lead('raw-manually-changed', {
    manager: 'B', status: '구매완료', purchaseType: '일시불', lumpSumAmount: 4_000_000,
    salesRawPeriods: { '2026-09': rawPeriod() },
  }),
]
const rawBefore = JSON.stringify(rawRows)
const rawMetrics = buildExecutiveMetrics(rawRows, '2026-09', '2026-10-04')
assert.equal(rawMetrics.current.sales, 11_000_000, 'RAW confirmed orders count independently of customer status; reservation amounts do not')
assert.equal(rawMetrics.current.reservedSales, 3_000_000, 'Only current RAW evidence contributes separate reservation money')
assert.equal(rawMetrics.current.expectedCommission, 85_000, 'Eligible RAW confirmed and reserved bases count once; completed subscriptions are preserved')
assert.equal(rawMetrics.current.completed, 2, 'RAW financial evidence does not change manual outcome counts')
assert.equal(rawMetrics.current.active, 1)
assert.equal(rawMetrics.current.canceled, 1)
assert.equal(rawMetrics.current.completedCustomers, 2)
assert.equal(rawMetrics.current.managementRecords, 1)
assert.equal(rawMetrics.managers.find(row => row.name === 'A')?.sales, 2_000_000)
assert.equal(rawMetrics.managers.find(row => row.name === 'A')?.reservedSales, 1_000_000)
assert.equal(rawMetrics.managers.find(row => row.name === 'A')?.expectedCommission, 60_000, 'Noncompleted subscription is not counted as a completed commission')
assert.equal(rawMetrics.partners.reduce((total, row) => total + row.sales, 0), rawMetrics.current.sales)
assert.equal(rawMetrics.partners.reduce((total, row) => total + row.reservedSales, 0), rawMetrics.current.reservedSales)
assert.equal(rawMetrics.partners.reduce((total, row) => total + row.expectedCommission, 0), rawMetrics.current.expectedCommission)
assert.equal(JSON.stringify(rawRows), rawBefore, 'Metrics do not mutate manual manager, status, amounts, or memo records')

const crossStatusRefund = buildExecutiveMetrics([
  lead('cross-status-refund', {
    purchaseType: '일시불', lumpSumAmount: 900_000,
    salesRawPeriods: { '2026-09': rawPeriod({
      confirmedAmount: -100_000, reservedAmount: 1_000_000,
      eligibleConfirmedAmount: -100_000, eligibleReservedAmount: 1_000_000,
      returnAmount: -100_000,
    }) },
  }),
], '2026-09', '2026-10-04')
assert.equal(crossStatusRefund.current.sales, -100_000, 'Signed confirmed return offsets remain visible outside reserved sales')
assert.equal(crossStatusRefund.current.reservedSales, 1_000_000)
assert.equal(crossStatusRefund.current.expectedCommission, 18_000, 'Eligible confirmed returns offset eligible reservations before commission is calculated')

const subscriptionRows = [lead('subscription-active', {
  manager: 'A', partnerName: '(주)아이패밀리에스씨', purchaseType: '구독', subscriptionAmount: 3000000,
  subscriptionRawPeriods: { '2026-09': {
    period: '2026-09', sourceHash: 'anonymous-subscription', importedAt: '2026-10-04',
    itemCount: 3, confirmedItemCount: 2, pendingItemCount: 1,
    confirmedBasisAmount: 2000000, pendingBasisAmount: 1000000,
    eligibleConfirmedBasisAmount: 1500000, eligiblePendingBasisAmount: 1000000,
    includedStatuses: ['주문확정', '마감됨', '출하대기'], missingBasisItemCount: 1, rejectedProofItemCount: 1,
  } },
})]
const subscriptionBefore = JSON.stringify(subscriptionRows)
const subscriptionMetrics = buildExecutiveMetrics(subscriptionRows, '2026-09', '2026-10-04')
assert.equal(subscriptionMetrics.current.sales, 2000000)
assert.equal(subscriptionMetrics.current.reservedSales, 1000000)
assert.equal(subscriptionMetrics.current.expectedCommission, 37500)
assert.equal(subscriptionMetrics.current.active, 1)
assert.equal(subscriptionMetrics.current.completed, 0, 'Subscription RAW does not change manually managed purchase completion')
assert.equal(subscriptionMetrics.managers[0].expectedCommission, 37500)
assert.equal(subscriptionMetrics.partners[0].expectedCommission, 37500)
assert.equal(JSON.stringify(subscriptionRows), subscriptionBefore)

const completionRows = [lead('business-completed', {
  status: '구매완료', manager: '판매 담당', managerEmployeeNo: '10001', purchaseType: '일시불', lumpSumAmount: 3500000,
  salesRawPeriods: { '2026-09': rawPeriod({ tentativeOrderCount: 1, tentativeAmount: 500000, eligibleTentativeAmount: 500000, completedStatuses: ['주문확정', '예약', '가예약'] }) },
})]
const completionBefore = JSON.stringify(completionRows)
const completionMetrics = buildExecutiveMetrics(completionRows, '2026-09', '2026-10-04')
assert.equal(completionMetrics.current.completed, 1)
assert.equal(completionMetrics.current.sales, 3500000, 'All three business-completed order stages count toward the sale basis')
assert.equal(completionMetrics.current.reservedSales, 0, 'Reservation and tentative bases are not counted twice as pending')
assert.equal(completionMetrics.current.expectedCommission, 70000)
assert.equal(completionMetrics.managers[0].name, '판매 담당')
assert.equal(completionMetrics.managers[0].assigned, 1)
assert.equal(completionMetrics.managers[0].sales, 3500000)
assert.equal(JSON.stringify(completionRows), completionBefore)

console.log('Executive metrics: cohort, grouping, lump-sum/subscription confirmed and pending bases, commission, and action queues passed.')
