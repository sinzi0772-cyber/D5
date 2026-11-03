import assert from 'node:assert/strict'
import type { Lead, SalesRawPeriod, SubscriptionRawPeriod } from '../src/types'
import { caseBasisFor, caseBasisGroupsFor, financialCaseLeadFor, financialCaseLeadsFor } from '../src/lib/caseBasis'
import { leadFromDocument } from '../src/lib/leadDocument'
import { buildCommissionSettlementMetrics } from '../src/lib/commissionSettlement'
import { buildPartnerPreview } from '../src/lib/partnerPreview'
import { commissionVerificationRequiredFor, completedSalesFor, confirmedSalesFor, expectedRebateBreakdownFor, expectedRebateFor, financialPendingAmountFor, financialTotalPurchaseAmountFor, purchaseAmountSourceFor, salesRawAmountsFor, subscriptionRawAmountsFor } from '../src/lib/salesFinance'

const makeLead = (id: string, fields: Partial<Lead> = {}): Lead => ({ id, caseGroupId: 'synthetic-pair', registeredAt: '2026-09-01',
  updatedAt: '2026-10-14T01:00:00.000Z', customerName: `${id}**`, phoneLast4: id === 'A' ? '0001' : '0002', gender: '미입력',
  partnerName: '아이웨딩', appointmentType: '이업종제휴', status: '구매완료', visitState: '방문', manager: `담당${id}`,
  managerEmployeeNo: `QA${id}`, deliveryScheduledDate: id === 'A' ? '2026-10-31' : '2026-11-30',
  purchaseType: '일시불', lumpSumAmount: id === 'A' ? 100000 : 200000, ...fields })
const sales = (fields: Partial<SalesRawPeriod> = {}): SalesRawPeriod => ({ period: '2026-09', sourceHash: 'synthetic-only', importedAt: '2026-10-14T01:00:00.000Z',
  orderCount: 2, confirmedOrderCount: 1, reservedOrderCount: 1, confirmedAmount: 60000, reservedAmount: 40000,
  eligibleConfirmedAmount: 30000, eligibleReservedAmount: 10000, returnAmount: 0, ...fields })
const subscription = (fields: Partial<SubscriptionRawPeriod> = {}): SubscriptionRawPeriod => ({ period: '2026-09', sourceHash: 'synthetic-only-sub', importedAt: '2026-10-14T01:00:00.000Z',
  itemCount: 2, confirmedItemCount: 1, pendingItemCount: 1, confirmedBasisAmount: 100000, pendingBasisAmount: 100000,
  eligibleConfirmedBasisAmount: 50000, eligiblePendingBasisAmount: 20000, includedStatuses: ['주문확정', '출하대기'], missingBasisItemCount: 0, rejectedProofItemCount: 0, ...fields })
const verified = (value: Lead): Lead => ({ ...value,
  ...(value.lumpSumAmount !== undefined ? { salesRawPeriods: { '2026-09': sales({ confirmedAmount: value.lumpSumAmount, reservedAmount: 0, eligibleConfirmedAmount: value.lumpSumAmount, eligibleReservedAmount: 0 }) } } : {}),
  ...(value.subscriptionAmount !== undefined ? { subscriptionRawPeriods: { '2026-09': subscription({ confirmedBasisAmount: value.subscriptionAmount, pendingBasisAmount: 0, eligibleConfirmedBasisAmount: value.subscriptionAmount, eligiblePendingBasisAmount: 0 }) } } : {}),
})
const projected = (members: Lead[], primary = 'A') => {
  const selection = caseBasisFor(members, primary, members.map(member => member.id).sort())
  assert.notEqual(selection.status, 'unresolved', selection.reason)
  const lead = financialCaseLeadFor(selection, members)
  assert.ok(lead)
  return lead
}
const stored = (members: Lead[], primary = 'A') => members.map(member => ({ ...member, caseBasisLeadId: primary, caseMergeMemberIds: members.map(item => item.id).sort() }))

const a = makeLead('A'), b = makeLead('B')
const originals = [a, b], before = JSON.stringify(originals)
assert.equal(caseBasisFor(originals).status, 'unresolved', 'Conflicting originals never sum without explicit consent')
assert.equal(caseBasisFor(originals, 'A', null).mergeMemberIds, undefined)
assert.equal(financialTotalPurchaseAmountFor(financialCaseLeadFor(caseBasisFor(originals, 'A', null), originals)!), 100000)
const sum = projected(originals)
assert.equal(financialTotalPurchaseAmountFor(sum), 300000)
assert.deepEqual(expectedRebateBreakdownFor(sum), { lumpSumBasis: 0, subscriptionBasis: 0, lumpSumCommission: 0, subscriptionCommission: 0, total: 0 }, 'Merge consent does not prove the sales routes of two manual amounts')
assert.equal(commissionVerificationRequiredFor(sum), true)
assert.equal(sum.managerEmployeeNo, 'QAA')
assert.equal(sum.deliveryScheduledDate, a.deliveryScheduledDate)
assert.equal(sum.status, a.status)
assert.equal(sum.salesRawPeriods, undefined, 'Aggregate evidence must not be fabricated into serializable RAW')
assert.equal(sum.subscriptionRawPeriods, undefined)
assert.equal(caseBasisGroupsFor(stored(originals)).length, 1)
assert.equal(financialCaseLeadsFor(stored(originals)).length, 1)
assert.equal(expectedRebateFor(financialCaseLeadsFor(stored(originals))[0]), 0)
assert.equal(JSON.stringify(originals), before, 'Preview never changes the two original prices, managers or dates')

const split = [verified(makeLead('A')), verified(makeLead('B', { purchaseType: '구독', lumpSumAmount: undefined, subscriptionAmount: 200000 }))]
assert.equal(financialTotalPurchaseAmountFor(projected(split)), 300000)
assert.equal(expectedRebateFor(projected(split)), 5000, 'Different independent methods combine only after consent')
const rawMixed = [makeLead('A', { salesRawPeriods: { '2026-09': sales() } }), makeLead('B')]
const rawBefore = JSON.stringify(rawMixed)
const rawSum = projected(rawMixed)
assert.equal(expectedRebateFor(rawSum), 800, 'Only the verified 40,000 RAW basis earns fees; the manual 200,000 remains in sales only')
assert.equal(commissionVerificationRequiredFor(rawSum), true)
assert.equal(financialPendingAmountFor(rawSum), 40000)
assert.equal(confirmedSalesFor(rawSum), 260000)
assert.equal(completedSalesFor(rawSum), 260000)
assert.equal(salesRawAmountsFor(rawSum).current, false, 'Mixed manual and RAW sources are not a fabricated fully-current RAW')
assert.equal(salesRawAmountsFor(rawSum).reserved, 40000)
assert.equal(purchaseAmountSourceFor(rawSum, 'lumpSum').amount, 300000)
assert.equal(JSON.stringify(rawMixed), rawBefore)

const allRaw = [makeLead('A', { salesRawPeriods: { '2026-09': sales() } }), makeLead('B', {
  lumpSumAmount: 200000, salesRawPeriods: { '2026-09': sales({ confirmedAmount: 120000, reservedAmount: 80000, eligibleConfirmedAmount: 0, eligibleReservedAmount: 0 }) },
})]
const allRawSum = projected(allRaw)
assert.equal(salesRawAmountsFor(allRawSum).current, true)
assert.equal(expectedRebateFor(allRawSum), 800, 'Verified ineligible RAW never promotes to eligible manual total')
assert.equal(financialPendingAmountFor(allRawSum), 120000)
assert.equal(confirmedSalesFor(allRawSum), 180000)
assert.deepEqual(purchaseAmountSourceFor(allRawSum, 'lumpSum'), { kind: 'raw', amount: 300000, rawAmount: 300000 })
const rawSub = [makeLead('A', { purchaseType: '구독', lumpSumAmount: undefined, subscriptionAmount: 200000, subscriptionRawPeriods: { '2026-09': subscription() } }),
  makeLead('B', { purchaseType: '구독', lumpSumAmount: undefined, subscriptionAmount: 100000 })]
const rawSubSum = projected(rawSub)
assert.equal(expectedRebateFor(rawSubSum), 1050, 'Only the 70,000 eligible RAW subscription basis earns fees, without admitting the manual amount')
assert.equal(subscriptionRawAmountsFor(rawSubSum).pending, 100000)
assert.equal(financialPendingAmountFor(rawSubSum), 100000)

const refunds = [makeLead('A', { lumpSumAmount: 0, salesRawPeriods: { '2026-09': sales({ confirmedAmount: -100, reservedAmount: 0, eligibleConfirmedAmount: -100, eligibleReservedAmount: 0, returnAmount: 100 }) } }),
  verified(makeLead('B', { lumpSumAmount: 300 }))]
assert.equal(expectedRebateFor(projected(refunds)), 4, 'Signed RAW refunds offset the combined eligible basis before method rounding')
assert.equal(confirmedSalesFor(projected(refunds)), 200)
assert.equal(refunds[0].salesRawPeriods!['2026-09'].returnAmount, 100)

const aliases = [makeLead('A', { salesRawPeriods: { '2026-09': sales() } }), makeLead('B', { lumpSumAmount: 100000, lumpSumSourceId: 'A', salesRawPeriods: undefined })]
assert.equal(financialTotalPurchaseAmountFor(projected(aliases)), 100000, 'Already shared source aliases do not double the invoice')
assert.equal(expectedRebateFor(projected(aliases)), 800, 'Alias does not turn partially eligible source RAW into full manual commission')
const editedShared = stored([makeLead('A', { lumpSumAmount: 350000, lumpSumSourceId: 'A' }), makeLead('B', { lumpSumAmount: 350000, lumpSumSourceId: 'A' })])
assert.equal(financialTotalPurchaseAmountFor(financialCaseLeadsFor(editedShared)[0]), 350000, 'A subsequent shared total edit remains one 350,000 purchase, never 700,000')
assert.equal(expectedRebateFor(financialCaseLeadsFor(editedShared)[0]), 0, 'Sharing an edited manual amount does not verify its sales routes')
const mixedRootAliases = [makeLead('A', { purchaseType: '일시불+구독', subscriptionAmount: 200000, subscriptionSourceId: 'B' }),
  makeLead('B', { purchaseType: '일시불+구독', lumpSumAmount: 100000, lumpSumSourceId: 'A', subscriptionAmount: 200000 })]
assert.equal(financialTotalPurchaseAmountFor(projected(mixedRootAliases)), 300000, 'Explicit merge may combine two direct per-method roots without double-counting their copied methods')

const round = [verified(makeLead('A', { purchaseType: '일시불+구독', lumpSumAmount: 24, subscriptionAmount: 32 })), verified(makeLead('B', { purchaseType: '일시불+구독', lumpSumAmount: 24, subscriptionAmount: 32 }))]
assert.deepEqual(expectedRebateBreakdownFor(projected(round)), { lumpSumBasis: 48, subscriptionBasis: 64, lumpSumCommission: 1, subscriptionCommission: 1, total: 2 }, 'Explicit merge rounds once per combined method, not once per original')
const zeros = [makeLead('A', { lumpSumAmount: 0 }), makeLead('B', { lumpSumAmount: 0 })]
assert.equal(caseBasisFor(zeros, 'A', ['A', 'B']).status, 'resolved')
assert.equal(financialTotalPurchaseAmountFor(projected(zeros)), 0)
assert.equal(expectedRebateFor(projected(zeros)), 0)
const blanks = [makeLead('A', { purchaseType: '미선택', lumpSumAmount: undefined }), makeLead('B', { purchaseType: '미선택', lumpSumAmount: undefined })]
assert.equal(caseBasisFor(blanks, 'A', ['A', 'B']).status, 'empty')
const unsafeCombined = [makeLead('A', { lumpSumAmount: Number.MAX_SAFE_INTEGER }), makeLead('B', { purchaseType: '구독', lumpSumAmount: undefined, subscriptionAmount: 1 })]
assert.equal(caseBasisFor(unsafeCombined, 'A', ['A', 'B']).status, 'unresolved', 'Individually safe methods must not produce an unsafe combined gross total')

for (const roster of [[], ['A'], ['A', 'A'], ['B', 'A'], ['A', 'missing'], ['A', 'B', 'missing'], ['A', 'invalid/id']]) {
  assert.equal(caseBasisFor(originals, 'A', roster).status, 'unresolved', `Invalid full roster cannot sum: ${roster}`)
}
for (const bad of [
  [a, { ...b, partnerName: '(주)다이렉트컴즈' }],
  [a, { ...b, lumpSumSourceId: 'external' }],
  [a, { ...b, lumpSumSourceId: 'A' }],
  [{ ...a, lumpSumSourceId: 'B' }, { ...b, lumpSumSourceId: 'A' }],
  [{ ...a, lumpSumAmount: undefined, salesRawPeriods: { '2026-09': sales() } }, b],
]) assert.equal(caseBasisFor(bad, 'A', ['A', 'B']).status, 'unresolved', 'Foreign/missing/chained/ambiguous evidence cannot create a zero or duplicate merge')
const metadata = stored(originals)
assert.equal(caseBasisFor([metadata[0]]).status, 'unresolved', 'Partial merged group never silently calculates only one member')
assert.equal(caseBasisFor([metadata[0], { ...metadata[1], caseMergeMemberIds: undefined }]).status, 'unresolved')
assert.equal(caseBasisFor(metadata.map(member => ({ ...member, caseMergeMemberIds: ['B', 'A'] }))).status, 'unresolved')
const restoredSingle = caseBasisFor(metadata, 'B', null)
assert.equal(restoredSingle.mergeMemberIds, undefined)
assert.equal(financialTotalPurchaseAmountFor(financialCaseLeadFor(restoredSingle, metadata)!), 200000, 'No-merge override returns one selected original without deleting saved merge metadata')
assert.deepEqual(metadata[0].caseMergeMemberIds, ['A', 'B'])
for (const value of ['', 42, {}, ['A'], ['A', 42], ['A', 'A'], ['B', 'A']]) {
  const parsed = metadata.map(member => leadFromDocument(member.id, { ...member, caseMergeMemberIds: value }))
  assert.notEqual(parsed[0].caseMergeMemberIds, undefined, 'Bad explicit metadata remains detectable during reload')
  assert.equal(caseBasisFor(parsed).status, 'unresolved')
}
for (const value of ['', ' ', ' A', 'A ', 'invalid/source', 'x'.repeat(201), 0, false, {}, []]) {
  const malformed = [leadFromDocument('A', a), leadFromDocument('B', { ...b, lumpSumSourceId: value })]
  assert.equal(malformed[1].lumpSumSourceId, 'invalid/case-source')
  assert.equal(caseBasisFor(malformed, 'A', ['A','B']).status, 'unresolved', 'Reloaded malformed cash alias cannot become independent money during an explicit merge')
  const malformedSubscription = [leadFromDocument('A', a), leadFromDocument('B', { ...b, purchaseType: '구독', lumpSumAmount: undefined, subscriptionAmount: 200000, subscriptionSourceId: value })]
  assert.equal(caseBasisFor(malformedSubscription, 'A', ['A','B']).status, 'unresolved', 'Reloaded malformed subscription alias also remains pending')
}
for (const cleared of [undefined, null]) {
  const legacyIndependent = [leadFromDocument('A', { ...a, lumpSumSourceId: cleared }), leadFromDocument('B', { ...b, lumpSumSourceId: cleared })]
  assert.equal(financialTotalPurchaseAmountFor(projected(legacyIndependent)), 300000, 'Valid legacy absent source IDs remain independent after explicit merge consent')
}

const savedRawMerge = stored(rawMixed)
const settlement = buildCommissionSettlementMetrics(savedRawMerge)
assert.equal(settlement.completedCustomerCount, 1)
assert.equal(settlement.months[0].month, '2026-12', 'The primary delivery date controls the one merged settlement month')
assert.equal(settlement.months[0].expectedCommission, 800)
const partnerView = buildPartnerPreview(savedRawMerge, '아이웨딩', '2026-09')
assert.equal(partnerView.customerCount, 1)
assert.equal(partnerView.customers.length, 1)
assert.equal(partnerView.completedExpectedCommission, 800)
const safePartnerJson = JSON.stringify(partnerView)
for (const forbidden of ['caseMergeMemberIds', 'caseBasisLeadId', 'salesRawPeriods', 'sourceHash', 'QA', 'lumpSumAmount']) assert.equal(safePartnerJson.includes(forbidden), false)
assert.equal(JSON.stringify(originals), before)
console.log('caseMerge: explicit consent, full roster, source deduplication, RAW eligibility/refunds/pending, one primary calendar, rounding, reload and partner privacy passed')
