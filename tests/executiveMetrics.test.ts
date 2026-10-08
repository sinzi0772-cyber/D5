import assert from 'node:assert/strict'
import { buildExecutiveMetrics, getDefaultExecutiveMonth, getExecutiveMonthLeads, getExecutiveMonths, getTopCommissionPartners } from '../src/lib/executiveMetrics.ts'
import { expectedRebateFor } from '../src/lib/salesFinance.ts'
import type { Lead, SalesRawPeriod } from '../src/types.ts'

const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id,
  registeredAt: '2026-09-10',
  customerName: id,
  phoneLast4: '1234',
  gender: '미입력',
  partnerName: '(주)다이렉트컴즈',
  appointmentType: '이업종제휴',
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
assert.equal(metrics.current.expectedCommission, 160_000, 'Manual partner-appointment lump-sum amounts are included while ineligible subscription partners remain excluded')
assert.equal(metrics.current.missingAmounts, 1)
assert.equal(metrics.previous.cases, 1, 'Cross-month linked group belongs only to earliest intake month')
assert.equal(metrics.previous.customerCount, 2)
assert.equal(metrics.previous.completed, 1, 'One completed member makes one completed case')
assert.equal(metrics.previous.canceled, 0, 'Case outcome categories are exclusive')
assert.equal(metrics.previous.sales, 3_000_000)
assert.equal(metrics.previous.expectedCommission, 51_980, 'Manual partner-appointment amounts are preserved and calculated per customer')
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
assert.equal(partnerBAugust.current.expectedCommission, 20_000, 'A manual lump-sum partner appointment is calculated from its own current amount')
assert.equal(partnerBSeptember.current.cases, 1, 'The later linked member does not become a new September case')
assert.equal(partnerBSeptember.current.completed, 0)
assert.equal(partnerBSeptember.previous.cases, 1)
assert.deepEqual(getExecutiveMonthLeads(crossPartnerCouple, '2026-08', 'B 업체').map(item => item.id), ['later-partner-b'])
assert.deepEqual(getExecutiveMonthLeads(crossPartnerCouple, '2026-09', 'B 업체').map(item => item.id), ['active-partner-b'])
assert.deepEqual(partnerBAugust.actions.unassigned.map(item => item.id), ['active-partner-b'], 'Action queues respect partner scope across intake months')
assert.deepEqual(partnerBAugust.actions.stale.map(item => item.id), ['active-partner-b'])

const allPartnersAugust = buildExecutiveMetrics(crossPartnerCouple, '2026-08', '2026-10-03')
assert.equal(allPartnersAugust.current.cases, 1, 'A cross-company connected case still counts only once overall')
assert.equal(allPartnersAugust.partners.reduce((sum, row) => sum + row.cases, 0), 2, 'Each involved company has one participating case, so company case counts are not additive')
assert.equal(allPartnersAugust.partners.find(row => row.name === 'A 업체')?.sales, 0, 'The first intake company must not receive another company customer sales')
assert.equal(allPartnersAugust.partners.find(row => row.name === 'A 업체')?.expectedCommission, 0)
const partnerBAugustRow = allPartnersAugust.partners.find(row => row.name === 'B 업체')!
const { name: partnerBName, ...partnerBAmounts } = partnerBAugustRow
assert.equal(partnerBName, 'B 업체')
assert.deepEqual(partnerBAmounts, partnerBAugust.current, 'The company row and its filtered dashboard must include exactly the same customers and financial amounts')
assert.equal(allPartnersAugust.partners.reduce((sum, row) => sum + row.sales, 0), allPartnersAugust.current.sales)
assert.equal(allPartnersAugust.partners.reduce((sum, row) => sum + row.expectedCommission, 0), allPartnersAugust.current.expectedCommission)

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
assert.equal(rawMetrics.current.expectedCommission, 180_000, 'Expected commission uses current RAW bases and current manual amounts without reusing stale RAW evidence')
assert.equal(rawMetrics.current.completed, 2, 'RAW financial evidence does not change manual outcome counts')
assert.equal(rawMetrics.current.active, 1)
assert.equal(rawMetrics.current.canceled, 1)
assert.equal(rawMetrics.current.completedCustomers, 2)
assert.equal(rawMetrics.current.managementRecords, 1)
assert.equal(rawMetrics.managers.find(row => row.name === 'A')?.sales, 2_000_000)
assert.equal(rawMetrics.managers.find(row => row.name === 'A')?.reservedSales, 1_000_000)
assert.equal(rawMetrics.managers.find(row => row.name === 'A')?.expectedCommission, 75_000, 'Expected manual subscription commission is independent of customer completion')
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

const commissionStatusRows = (['관리중', '구매완료', '상담 마감', '취소'] as const).map((status, index) => lead(`commission-status-${index}`, {
  status, manager: `담당 ${index}`, purchaseType: '일시불+구독', lumpSumAmount: 26, subscriptionAmount: 34,
  salesRawPeriods: { '2026-09': rawPeriod({ confirmedAmount: 26, reservedAmount: 0, eligibleConfirmedAmount: 26, eligibleReservedAmount: 0 }) },
  subscriptionRawPeriods: { '2026-09': {
    period: '2026-09', sourceHash: 'anonymous-rounding-subscription', importedAt: '2026-10-07',
    itemCount: 1, confirmedItemCount: 1, pendingItemCount: 0,
    confirmedBasisAmount: 34, pendingBasisAmount: 0, eligibleConfirmedBasisAmount: 34, eligiblePendingBasisAmount: 0,
    includedStatuses: ['주문확정'], missingBasisItemCount: 0, rejectedProofItemCount: 0,
  } },
}))
const commissionStatusBefore = JSON.stringify(commissionStatusRows)
const commissionStatusMetrics = buildExecutiveMetrics(commissionStatusRows, '2026-09', '2026-10-07')
assert.equal(commissionStatusMetrics.current.expectedCommission, 8, 'Every customer status uses whole-won component commissions, matching the purchase list')
assert.equal(commissionStatusMetrics.current.expectedCommission, commissionStatusRows.reduce((sum, item) => sum + expectedRebateFor(item), 0))
assert.ok(commissionStatusMetrics.managers.every(item => item.expectedCommission === 2), 'Manager totals use the same expected commission function')
assert.equal(commissionStatusMetrics.partners.reduce((sum, item) => sum + item.expectedCommission, 0), 8)
assert.equal(commissionStatusMetrics.current.completed, 1, 'Expected commission must not rewrite manually managed outcomes')
assert.equal(commissionStatusMetrics.current.active, 1)
assert.equal(commissionStatusMetrics.current.closed, 1)
assert.equal(commissionStatusMetrics.current.canceled, 1)
assert.equal(commissionStatusMetrics.current.sales, 240, 'Verified RAW sales remain separate from manually managed outcomes')
assert.equal(JSON.stringify(commissionStatusRows), commissionStatusBefore)

const linkedCommissionRows = commissionStatusRows.slice(0, 2).map(item => ({ ...item, caseGroupId: 'anonymous-rounding-couple' }))
const linkedCommissionMetrics = buildExecutiveMetrics(linkedCommissionRows, '2026-09', '2026-10-07')
assert.equal(linkedCommissionMetrics.current.cases, 1, 'Linked bride and groom still make one intake case')
assert.equal(linkedCommissionMetrics.current.customerCount, 2)
assert.equal(linkedCommissionMetrics.current.expectedCommission, 4, 'A linked case adds already-rounded customer commissions, rather than rerounding merged bases')
assert.equal(linkedCommissionMetrics.current.expectedCommission, linkedCommissionRows.reduce((sum, item) => sum + expectedRebateFor(item), 0))
assert.ok(linkedCommissionMetrics.managers.every(item => item.expectedCommission === 2), 'Different managers retain their own customer commission only')

const crossCompanyFinancialRows = linkedCommissionRows.map((item, index) => ({
  ...item,
  partnerName: index === 0 ? '(주)다이렉트컴즈' : '(주)아이패밀리에스씨',
  registeredAt: index === 0 ? '2026-09-30' : '2026-10-01',
  subscriptionAmount: 50,
  subscriptionRawPeriods: { '2026-09': {
    ...item.subscriptionRawPeriods!['2026-09'], itemCount: 2, pendingItemCount: 1,
    pendingBasisAmount: 16, eligiblePendingBasisAmount: 16,
  } },
}))
const crossCompanyFinancialBefore = JSON.stringify(crossCompanyFinancialRows)
const crossCompanyFinancialMetrics = buildExecutiveMetrics(crossCompanyFinancialRows, '2026-09', '2026-10-07')
assert.equal(crossCompanyFinancialMetrics.current.cases, 1)
assert.equal(crossCompanyFinancialMetrics.current.customerCount, 2)
assert.equal(crossCompanyFinancialMetrics.partners.length, 2)
for (const row of crossCompanyFinancialMetrics.partners) {
  const filteredCompany = buildExecutiveMetrics(crossCompanyFinancialRows, '2026-09', '2026-10-07', row.name)
  const { name, ...summary } = row
  assert.deepEqual(summary, filteredCompany.current, `${name} company row must match its filtered dashboard`)
  assert.equal(row.sales, 60, 'Only this company customer sales belong in its row')
  assert.equal(row.reservedSales, 16, 'Only this company customer pending subscription amount belongs in its row')
  assert.equal(row.expectedCommission, 2, 'Only this company customer rounded commission belongs in its row')
  assert.equal(buildExecutiveMetrics(crossCompanyFinancialRows, '2026-10', '2026-10-07', row.name).current.cases, 0, 'Filtering must retain the complete linked case original intake month')
}
for (const key of ['sales', 'reservedSales', 'expectedCommission', 'customerCount', 'managementRecords'] as const) {
  assert.equal(crossCompanyFinancialMetrics.partners.reduce((sum, row) => sum + row[key], 0), crossCompanyFinancialMetrics.current[key], `Company ${key} totals must reconcile with the overall total`)
}
assert.equal(JSON.stringify(crossCompanyFinancialRows), crossCompanyFinancialBefore, 'Company scoping must not mutate customer records')

const commissionRankingRow = (name: string, expectedCommission: number, sales: number) => Object.freeze({
  ...crossCompanyFinancialMetrics.partners[0], name, expectedCommission, sales,
})
const rankingRows = Object.freeze([
  commissionRankingRow('수수료 없는 업체', 0, 999999),
  commissionRankingRow('음수 수수료 업체', -1, 999999),
  commissionRankingRow('9원 업체', 9, 9),
  commissionRankingRow('100원 업체', 100, 100),
  commissionRankingRow('나 업체', 50, 200),
  commissionRankingRow('가 업체', 50, 200),
  commissionRankingRow('판매금액 우선 업체', 50, 300),
])
const rankingBefore = JSON.stringify(rankingRows)
const commissionTop3 = getTopCommissionPartners(rankingRows)
assert.equal(commissionTop3.length, 3, 'The commission ranking includes at most three companies')
assert.deepEqual(commissionTop3.map(row => row.name), ['100원 업체', '판매금액 우선 업체', '가 업체'], 'Sort numeric commission descending, then sales descending and Korean name ascending')
assert.ok(commissionTop3.every(row => row.expectedCommission > 0), 'Zero and negative commissions must not enter the ranking')
assert.deepEqual(getTopCommissionPartners(rankingRows.slice(0, 2)), [], 'No positive commission produces an empty ranking')
assert.deepEqual(getTopCommissionPartners(rankingRows.slice(2, 3)), [rankingRows[2]], 'A single positive company remains visible without padding')
assert.deepEqual(getTopCommissionPartners(rankingRows.slice(4, 6)).map(row => row.name), ['가 업체', '나 업체'], 'Equal commission and sales use stable Korean-name order')
assert.equal(JSON.stringify(rankingRows), rankingBefore, 'Ranking must not reorder or mutate its immutable input')
assert.strictEqual(commissionTop3[0], rankingRows[3], 'Ranked companies keep the original exact financial summary objects')
for (const row of getTopCommissionPartners(crossCompanyFinancialMetrics.partners)) {
  const original = crossCompanyFinancialMetrics.partners.find(item => item.name === row.name)!
  assert.strictEqual(row, original, 'The TOP3 card and company details use exactly the same metric row')
  assert.equal(row.expectedCommission, original.expectedCommission)
  assert.equal(row.sales, original.sales)
}

for (const status of ['관리중', '구매완료', '상담 마감', '취소'] as const) {
  const manualSubscription = lead(`manual-subscription-${status}`, { status, manager: '담당', purchaseType: '구독', subscriptionAmount: 100 })
  const manualMetrics = buildExecutiveMetrics([manualSubscription], '2026-09', '2026-10-07')
  assert.equal(manualMetrics.current.expectedCommission, expectedRebateFor(manualSubscription), 'Permitted manual subscription estimates must match purchase information for every customer status')
  assert.equal(manualMetrics.current.expectedCommission, 2)
  assert.equal(manualMetrics.current.sales, status === '구매완료' ? 100 : 0, 'The existing manual sales-completion rule stays unchanged')
  assert.equal(manualMetrics.current.completed, status === '구매완료' ? 1 : 0)
}

for (const appointmentType of [undefined, '미선택'] as const) {
  const unprovenManual = lead('unproven-manual', { appointmentType, status: '구매완료', purchaseType: '일시불+구독', lumpSumAmount: 1000000, subscriptionAmount: 1000000 })
  const unprovenMetrics = buildExecutiveMetrics([unprovenManual], '2026-09', '2026-10-07')
  assert.equal(unprovenMetrics.current.expectedCommission, 0, 'The dashboard must not create manual referral commission for a non-partner appointment')
  assert.equal(unprovenMetrics.current.sales, 2000000, 'Existing customer sale reporting is independent of referral commission eligibility')
}

console.log('Executive metrics: cohort, grouping, lump-sum/subscription confirmed and pending bases, commission, and action queues passed.')
