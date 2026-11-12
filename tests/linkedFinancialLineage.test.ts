import assert from 'node:assert/strict'
import { buildCommissionSettlementMetrics } from '../src/lib/commissionSettlement.ts'
import { purchaseSortValue } from '../src/lib/customerSorting.ts'
import { buildExecutiveMetrics, executiveTotalSalesFor } from '../src/lib/executiveMetrics.ts'
import { leadFromDocument } from '../src/lib/leadDocument.ts'
import { buildPartnerPreview } from '../src/lib/partnerPreview.ts'
import { buildPartnerPublication, IWEDDING_PARTNER_ID, IWEDDING_PARTNER_NAME, parsePartnerPublication } from '../src/lib/partnerPublication.ts'
import { caseBasisFor, financialCaseLeadFor } from '../src/lib/caseBasis.ts'
import { completedSalesFor, confirmedSalesFor, displayedPurchaseAmountFor, expectedRebateBreakdownFor, expectedRebateFor, financialPendingAmountFor, financialTotalPurchaseAmountFor, totalPurchaseAmountFor } from '../src/lib/salesFinance.ts'
import type { Lead } from '../src/types.ts'
const publishedAt = '2026-10-14T01:00:00.000Z'
const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id, registeredAt: '2026-09-01', updatedAt: publishedAt, customerName: '김**', phoneLast4: '0001', gender: '미입력',
  partnerName: IWEDDING_PARTNER_NAME, appointmentType: '이업종제휴', status: '구매완료', visitState: '방문', deliveryScheduledDate: '2026-09-30',
  caseGroupId: 'shared-case', manager: '공동 담당자', purchaseType: '일시불+구독', lumpSumAmount: 150000, subscriptionAmount: 200000, ...changes,
})
const owner = Object.freeze(lead('financial-owner', {
  caseBasisLeadId: 'financial-owner', lumpSumSourceId: 'financial-owner', subscriptionSourceId: 'financial-owner',
  salesRawPeriods: { '2026-09': { period: '2026-09', sourceHash: 'anonymous-sales', importedAt: publishedAt,
    orderCount: 2, confirmedOrderCount: 1, reservedOrderCount: 1, confirmedAmount: 100000, reservedAmount: 50000,
    eligibleConfirmedAmount: 80000, eligibleReservedAmount: 40000, returnAmount: 0, settlementBasisAmount: 100000 } },
  subscriptionRawPeriods: { '2026-09': { period: '2026-09', sourceHash: 'anonymous-subscription', importedAt: publishedAt,
    itemCount: 2, confirmedItemCount: 1, pendingItemCount: 1, confirmedBasisAmount: 150000, pendingBasisAmount: 50000,
    eligibleConfirmedBasisAmount: 100000, eligiblePendingBasisAmount: 50000, includedStatuses: ['마감됨', '출하대기'],
    missingBasisItemCount: 0, rejectedProofItemCount: 0, settlementBasisAmount: 150000 } },
}))
const verified = (value: Lead): Lead => ({ ...value,
  ...(value.lumpSumAmount !== undefined ? { salesRawPeriods: { '2026-09': { ...owner.salesRawPeriods!['2026-09'], confirmedAmount: value.lumpSumAmount, reservedAmount: 0, eligibleConfirmedAmount: value.lumpSumAmount, eligibleReservedAmount: 0, settlementBasisAmount: value.lumpSumAmount } } } : {}),
  ...(value.subscriptionAmount !== undefined ? { subscriptionRawPeriods: { '2026-09': { ...owner.subscriptionRawPeriods!['2026-09'], confirmedBasisAmount: value.subscriptionAmount, pendingBasisAmount: 0, eligibleConfirmedBasisAmount: value.subscriptionAmount, eligiblePendingBasisAmount: 0, settlementBasisAmount: value.subscriptionAmount } } } : {}),
})
const alias = Object.freeze(lead('financial-alias', { caseBasisLeadId: owner.id, lumpSumSourceId: owner.id, subscriptionSourceId: owner.id,
  deliveryScheduledDate: '2026-12-31', phoneLast4: '0002' }))
const third = Object.freeze(lead('financial-third', { caseBasisLeadId: owner.id, lumpSumSourceId: owner.id, subscriptionSourceId: owner.id,
  status: '취소', phoneLast4: '0003', deliveryScheduledDate: undefined }))
const shared = Object.freeze([owner, alias, third])
const before = JSON.stringify(shared)
assert.equal(totalPurchaseAmountFor(alias), 350000, 'Original editor fields remain intact')
assert.equal(displayedPurchaseAmountFor(shared), 350000)
assert.equal(displayedPurchaseAmountFor([alias]), 0, 'A partial group cannot reelect an unseen source')
assert.equal(displayedPurchaseAmountFor([owner, lead('independent', { caseGroupId: undefined })]), 700000, 'Separate customers still sum normally')
assert.equal(financialTotalPurchaseAmountFor(alias), 0)
assert.deepEqual(expectedRebateBreakdownFor(owner), { lumpSumBasis: 100000, subscriptionBasis: 150000, lumpSumCommission: 2000, subscriptionCommission: 2250, total: 4250 })
assert.equal(expectedRebateFor(alias), 0)
assert.equal(confirmedSalesFor(owner), 250000)
assert.equal(completedSalesFor(owner), 250000)
assert.equal(financialPendingAmountFor(owner), 100000)
const executive = buildExecutiveMetrics(shared, '2026-09', '2026-10-14')
assert.equal(executive.current.cases, 1)
assert.equal(executive.current.customerCount, 1)
assert.equal(executive.current.completedCustomers, 1)
assert.equal(executive.current.sales, 250000)
assert.equal(executive.current.reservedSales, 100000)
assert.equal(executive.current.expectedCommission, 4250)
assert.equal(executiveTotalSalesFor(executive.current), 350000)
assert.equal(executive.current.basisRequiredCount, 0)
assert.equal(purchaseSortValue(alias, [...shared]), 350000)
assert.equal(purchaseSortValue(alias, [alias], shared), 350000, 'Resolve full case before status or display filtering')
assert.equal(purchaseSortValue(alias, [alias]), null, 'Incomplete source without full context remains pending')
const settlement = buildCommissionSettlementMetrics(shared)
assert.equal(settlement.completedCustomerCount, 1)
assert.equal(settlement.unfinishedCustomerCount, 0)
assert.equal(settlement.completedExpectedCommission, 4250)
assert.deepEqual(settlement.months.map(row => [row.month, row.customerCount, row.expectedCommission]), [['2026-11', 1, 4250]], 'Only the basis customer delivery date schedules money')
const preview = buildPartnerPreview(shared, IWEDDING_PARTNER_NAME, '2026-09')
assert.equal(preview.customerCount, 1)
assert.equal(preview.receiptCount, 1)
assert.equal(preview.customers.length, 1)
assert.equal(preview.completedExpectedCommission, 4250)
const publication = buildPartnerPublication(shared, IWEDDING_PARTNER_ID, publishedAt)
assert.deepEqual(parsePartnerPublication(publication, IWEDDING_PARTNER_ID), publication)
for (const forbidden of ['financial-owner', 'financial-alias', 'lumpSumSourceId', 'subscriptionSourceId', 'caseBasisLeadId', 'caseSharingHistory', 'anonymous-sales', 'anonymous-subscription']) assert.equal(JSON.stringify(publication).includes(forbidden), false)

const unequal = [verified(lead('A', { lumpSumAmount: 100000, subscriptionAmount: 0 })), verified(lead('B', { lumpSumAmount: 200000, subscriptionAmount: 0 }))]
assert.equal(caseBasisFor(unequal).status, 'unresolved')
assert.equal(displayedPurchaseAmountFor(unequal), 0)
const unresolved = buildExecutiveMetrics(unequal, '2026-09', '2026-10-14')
assert.equal(unresolved.current.customerCount, 1)
assert.equal(unresolved.current.expectedCommission, 0)
assert.equal(unresolved.current.basisRequiredCount, 1)
assert.equal(buildCommissionSettlementMetrics(unequal).basisRequiredCount, 1)
const pendingView = buildPartnerPreview(unequal, IWEDDING_PARTNER_NAME, '2026-09')
assert.equal(pendingView.customerCount, 1)
assert.equal(pendingView.basisRequiredCount, 1)
assert.equal(pendingView.customers[0].expectedCommission, null, 'Pending basis is not a valid zero fee')
assert.equal(pendingView.customers[0].expectedSettlementMonth, null)
assert.deepEqual(parsePartnerPublication(buildPartnerPublication(unequal, IWEDDING_PARTNER_ID, publishedAt), IWEDDING_PARTNER_ID)?.months[0], pendingView)
for (const selected of ['A', 'B']) {
  const chosen = unequal.map(member => ({ ...member, caseBasisLeadId: selected }))
  const expected = selected === 'A' ? 100000 : 200000
  assert.equal(displayedPurchaseAmountFor(chosen), expected)
  assert.equal(buildExecutiveMetrics(chosen, '2026-09', '2026-10-14').current.sales, expected)
  assert.equal(buildCommissionSettlementMetrics(chosen).completedExpectedCommission, expected * .02)
}
const split = [verified(lead('lump', { lumpSumAmount: 100000, subscriptionAmount: undefined })), verified(lead('sub', { lumpSumAmount: undefined, subscriptionAmount: 200000 }))]
assert.equal(caseBasisFor(split).status, 'unresolved', 'Never combine A cash and B subscription')
const chosenSplit = split.map(member => ({ ...member, caseBasisLeadId: 'lump' }))
assert.equal(displayedPurchaseAmountFor(chosenSplit), 100000)
assert.equal(buildExecutiveMetrics(chosenSplit, '2026-09', '2026-10-14').current.expectedCommission, 2000)
const equal = [verified(lead('same-A', { lumpSumAmount: 26, subscriptionAmount: 34 })), verified(lead('same-B', { lumpSumAmount: 26, subscriptionAmount: 34 }))]
assert.equal(displayedPurchaseAmountFor(equal), 60, 'Identical economic duplicate data is counted once')
assert.equal(buildCommissionSettlementMetrics(equal).completedExpectedCommission, 2, 'Round each method within one whole basis row')
assert.equal(buildCommissionSettlementMetrics(equal).completedCustomerCount, 1)
const sameGrossDifferentEligibility = [owner, lead('independent-raw-different', { caseBasisLeadId: undefined })].map(member => ({ ...member, caseBasisLeadId: undefined }))
assert.equal(caseBasisFor(sameGrossDifferentEligibility).status, 'unresolved', 'Equal gross values do not hide different RAW eligibility')

const foreign = lead('foreign-owner', { partnerName: '(주)다이렉트컴즈', caseBasisLeadId: 'foreign-owner', registeredAt: '2026-08-31', lumpSumAmount: 99999999, subscriptionAmount: 0, customerName: '비밀이름', phoneLast4: '9876', deliveryScheduledDate: '2026-12-31' })
const ownCompany = lead('own-company', { caseBasisLeadId: 'foreign-owner', registeredAt: '2026-09-01', lumpSumAmount: 26, subscriptionAmount: 34 })
const cross = [foreign, ownCompany]
const crossExecutive = buildExecutiveMetrics(cross, '2026-08', '2026-10-14')
assert.equal(crossExecutive.current.customerCount, 1)
assert.equal(crossExecutive.partners.reduce((sum, row) => sum + row.expectedCommission, 0), crossExecutive.current.expectedCommission)
assert.equal(buildExecutiveMetrics(cross, '2026-08', '2026-10-14', IWEDDING_PARTNER_NAME).current.expectedCommission, 0)
assert.equal(buildCommissionSettlementMetrics(cross, IWEDDING_PARTNER_NAME).completedExpectedCommission, 0)
const crossPublication = buildPartnerPublication(cross, IWEDDING_PARTNER_ID, publishedAt)
assert.deepEqual(crossPublication.months.map(model => model.intakeMonth), ['2026-09'], 'Foreign intake month is never published')
assert.equal(crossPublication.months[0].basisRequiredCount, 1)
assert.equal(crossPublication.months[0].customers[0].expectedCommission, null)
for (const forbidden of ['foreign-owner', '비밀', '9876', '99999999', '2026-08', '2026-12', '다이렉트']) assert.equal(JSON.stringify(crossPublication).includes(forbidden), false)
assert.equal(purchaseSortValue(ownCompany, cross, cross), null, 'Foreign financial values never sort an own-company customer')

const chosenAlias = shared.map(member => ({ ...member, caseBasisLeadId: alias.id }))
const aliasFinancial = financialCaseLeadFor(caseBasisFor(chosenAlias), chosenAlias)!
assert.equal(expectedRebateFor(aliasFinancial), 4250, 'A selected legacy alias uses only equal, direct, same-company owner RAW evidence')
assert.equal(buildCommissionSettlementMetrics(chosenAlias).months[0].month, '2027-02', 'Explicit basis date changes settlement; it is not an additional bucket')
const unlinked = shared.map(member => ({ ...member, caseGroupId: undefined }))
assert.equal(buildExecutiveMetrics(unlinked, '2026-09', '2026-10-14').current.expectedCommission, 4250, 'Unlinking cannot convert aliases into new purchases')
assert.equal(expectedRebateFor({ ...owner, lumpSumAmount: 160000 }), 2250, 'A changed cash amount needs BEST verification; the current subscription remains payable')
assert.equal(expectedRebateFor({ ...owner, lumpSumAmount: 0, subscriptionAmount: 0 }), 0)
assert.equal(confirmedSalesFor({ ...owner, lumpSumAmount: 75000, subscriptionAmount: 0, salesRawPeriods: { '2026-09': { ...owner.salesRawPeriods!['2026-09'], confirmedAmount: -25000, reservedAmount: 100000, eligibleConfirmedAmount: -25000, eligibleReservedAmount: 100000, settlementBasisAmount: -25000 } } }), -25000, 'Signed refund subtotals remain intact')
for (const member of shared) {
  const reloaded = leadFromDocument(member.id, JSON.parse(JSON.stringify(member)))
  assert.equal(financialTotalPurchaseAmountFor(reloaded), financialTotalPurchaseAmountFor(member))
  assert.equal(expectedRebateFor(reloaded), expectedRebateFor(member))
}
assert.equal(JSON.stringify(shared), before, 'Original A/B RAW, dates, amount fields and source history never mutate during projection')
console.log('linkedFinancialLineage: one customer/whole basis, no A+B, pending conflicts, chosen RAW/date, privacy and original preservation passed')
