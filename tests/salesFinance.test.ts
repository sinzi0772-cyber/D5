import assert from 'node:assert/strict'
import { completedSalesFor, confirmedSalesFor, expectedLumpSumRebateFor, expectedRebateBreakdownFor, expectedRebateFor, expectedSubscriptionRebateFor, isSubscriptionRebatePartner, purchaseAmountSourceFor, salesRawAmountsFor } from '../src/lib/salesFinance.ts'

const lead = { id: 'fixture', customerName: '가*나', phoneLast4: '0001', registeredAt: '2026-09-01', updatedAt: '2026-10-04', gender: '미입력', partnerName: '(주)아이니웨딩네트웍스', appointmentType: '이업종제휴', status: '관리중', visitState: '미정', purchaseType: '일시불+구독', lumpSumAmount: 150000, subscriptionAmount: 10000, salesRawPeriods: { '2026-09': { period: '2026-09', sourceHash: 'fixture', importedAt: '2026-10-04', orderCount: 2, confirmedOrderCount: 1, reservedOrderCount: 1, confirmedAmount: 100000, reservedAmount: 50000, eligibleConfirmedAmount: 80000, eligibleReservedAmount: 40000, returnAmount: 0 } } } as const
assert.equal(expectedRebateFor(lead), 2550)
assert.deepEqual(expectedRebateBreakdownFor(lead), { lumpSumBasis: 120000, subscriptionBasis: 10000, lumpSumCommission: 2400, subscriptionCommission: 150, total: 2550 })
assert.equal(confirmedSalesFor(lead), 100000)
assert.equal(salesRawAmountsFor(lead).reserved, 50000)
assert.equal(expectedRebateFor({ ...lead, salesRawPeriods: undefined }), 3150, 'A manual partner-appointment lump-sum amount uses the current entered amount')
assert.equal(expectedRebateFor({ ...lead, lumpSumAmount: 160000 }), 3350, 'Changed manual amount must not reuse the old RAW eligible amount')
assert.equal(expectedRebateFor({ ...lead, partnerName: '기타업체' }), 2400)
assert.equal(confirmedSalesFor({ ...lead, status: '구매완료' }), 110000)
const refund = { ...lead, lumpSumAmount: 75000, subscriptionAmount: 0, salesRawPeriods: { '2026-09': { ...lead.salesRawPeriods['2026-09'], confirmedAmount: -25000, reservedAmount: 100000, eligibleConfirmedAmount: -25000, eligibleReservedAmount: 100000 } } }
assert.equal(expectedRebateFor(refund), 1500)
assert.equal(confirmedSalesFor(refund), -25000)
assert.equal(salesRawAmountsFor(refund).confirmed + salesRawAmountsFor(refund).reserved, 75000)
const subscription = { ...lead, status: '관리중', subscriptionAmount: 200000, subscriptionRawPeriods: { '2026-09': { period: '2026-09', sourceHash: 'anonymous-subscription', importedAt: '2026-10-04', itemCount: 3, confirmedItemCount: 2, pendingItemCount: 1, confirmedBasisAmount: 150000, pendingBasisAmount: 50000, eligibleConfirmedBasisAmount: 100000, eligiblePendingBasisAmount: 50000, includedStatuses: ['주문확정', '마감됨', '출하대기'], missingBasisItemCount: 1, rejectedProofItemCount: 1 } } } as const
assert.equal(expectedRebateFor(subscription), 4650, 'Mixed lump-sum 2400 plus subscription eligible basis 2250')
assert.equal(confirmedSalesFor(subscription), 250000, 'Raw subscription confirmed basis counts without changing manual status')
assert.equal(expectedRebateFor({ ...subscription, partnerName: '기타업체' }), 2400)
assert.equal(expectedRebateFor({ ...subscription, partnerName: '(주)아이패밀리에스씨' }), 4650)
assert.equal(expectedRebateFor({ ...subscription, partnerName: '아이웨딩' }), 4650)
assert.equal(expectedRebateFor({ ...subscription, partnerName: '(주)아이패밀리에스씨협력업체' }), 2400)
for (const partnerName of ['주식회사 베리굿웨딩컴퍼니', '(주)베리굿웨딩컴퍼니', '㈜베리굿웨딩컴퍼니', '베리굿웨딩컴퍼니']) {
  const eligiblePartner = { ...subscription, partnerName }
  assert.equal(isSubscriptionRebatePartner(partnerName), true)
  assert.equal(expectedSubscriptionRebateFor(eligiblePartner), 2250, 'Only eligible membership basis is subject to subscription commission')
  assert.equal(expectedRebateFor(eligiblePartner), 4650, 'Adding the subscription partner must preserve lump-sum commission')
  assert.equal(expectedSubscriptionRebateFor({ ...eligiblePartner, subscriptionAmount: 300000 }), 4500, 'A current manual amount replaces, rather than reuses, stale RAW evidence for a partner appointment')
}
for (const partnerName of ['베리굿웨딩컴퍼니협력사', '베리굿웨딩', '다른베리굿웨딩컴퍼니']) {
  assert.equal(isSubscriptionRebatePartner(partnerName), false, 'Similar company names must not be eligible automatically')
  assert.equal(expectedRebateFor({ ...subscription, partnerName }), 2400)
}
assert.equal(expectedRebateFor({ ...subscription, subscriptionAmount: 300000 }), 6900, 'Changed manual amount cannot reuse stale raw evidence')
assert.equal(expectedRebateFor({ ...subscription, lumpSumAmount: 150000 }), 4650, 'Subscription calculation preserves lump-sum basis')
const rejectedOnlySale = { ...subscription, status: '구매완료', lumpSumAmount: 0, salesRawPeriods: undefined, subscriptionRawPeriods: { '2026-09': { ...subscription.subscriptionRawPeriods['2026-09'], confirmedBasisAmount: 200000, pendingBasisAmount: 0, eligibleConfirmedBasisAmount: 200000, eligiblePendingBasisAmount: 0, rejectedProofItemCount: 2 } } } as const
assert.equal(completedSalesFor(rejectedOnlySale), 200000, 'Rejected promotion proof must not erase the actual completed sale')
assert.equal(confirmedSalesFor(rejectedOnlySale), 200000)
assert.equal(expectedSubscriptionRebateFor(rejectedOnlySale), 3000, 'Rejected proof must count in the approved partner commission')
assert.equal(expectedRebateFor(rejectedOnlySale), 3000)
assert.equal(expectedSubscriptionRebateFor({ ...rejectedOnlySale, partnerName: '목록 외 업체' }), 0, 'Rejected proof cannot bypass the approved partner list')
assert.equal(expectedSubscriptionRebateFor({ ...rejectedOnlySale, subscriptionAmount: 300000 }), 4500, 'A current manual amount must not reuse stale RAW amounts')
const completedPolicy = { ...lead, status: '구매완료', lumpSumAmount: 200000, salesRawPeriods: { '2026-09': { ...lead.salesRawPeriods['2026-09'], tentativeOrderCount: 1, tentativeAmount: 50000, eligibleTentativeAmount: 50000, completedStatuses: ['주문확정', '예약', '가예약'] } } } as const
assert.equal(salesRawAmountsFor(completedPolicy).current, true)
assert.equal(salesRawAmountsFor(completedPolicy).completed, 200000)
assert.equal(salesRawAmountsFor(completedPolicy).pending, 0, 'Completed reservations must not be shown as pending again')
assert.equal(completedSalesFor(completedPolicy), 210000)
assert.equal(confirmedSalesFor(completedPolicy), 110000, 'Original order-confirmed amount must not be forged by business completion')
assert.equal(expectedRebateFor(completedPolicy), 3550)
assert.equal(expectedRebateFor({ ...completedPolicy, lumpSumAmount: 250000 }), 5150, 'Changed manual amount cannot reuse tentative raw commission evidence')

const roundingFixture = (lumpSumBasis: number, subscriptionBasis: number) => ({
  ...subscription,
  lumpSumAmount: lumpSumBasis,
  subscriptionAmount: subscriptionBasis,
  salesRawPeriods: { '2026-09': {
    ...lead.salesRawPeriods['2026-09'], confirmedAmount: lumpSumBasis, reservedAmount: 0,
    eligibleConfirmedAmount: lumpSumBasis, eligibleReservedAmount: 0,
  } },
  subscriptionRawPeriods: { '2026-09': {
    ...subscription.subscriptionRawPeriods['2026-09'], confirmedBasisAmount: subscriptionBasis, pendingBasisAmount: 0,
    eligibleConfirmedBasisAmount: subscriptionBasis, eligiblePendingBasisAmount: 0,
  } },
})
const bothMethodsRoundUp = roundingFixture(26, 34)
assert.deepEqual(expectedRebateBreakdownFor(bothMethodsRoundUp), { lumpSumBasis: 26, subscriptionBasis: 34, lumpSumCommission: 1, subscriptionCommission: 1, total: 2 }, 'The whole-won component amounts must add up to the displayed total')
const bothMethodsRoundDown = roundingFixture(24, 32)
assert.equal(expectedRebateFor(bothMethodsRoundDown), 0, 'Two amounts below half a won must not produce a combined rounded commission')
for (const [basis, expected] of [[24, 0], [25, 1], [26, 1], [100000025, 2000001]]) {
  assert.equal(expectedLumpSumRebateFor(roundingFixture(basis, 0)), expected, 'Lump-sum boundaries use the exact 2 / 100 ratio')
}
for (const [basis, expected] of [[99, 1], [100, 2], [101, 2], [100000100, 1500002]]) {
  assert.equal(expectedSubscriptionRebateFor(roundingFixture(0, basis)), expected, 'Subscription boundaries use the exact 3 / 200 ratio')
}
for (const status of ['관리중', '구매완료', '상담 마감', '취소'] as const) {
  const statusLead = { ...bothMethodsRoundUp, status }
  assert.equal(expectedRebateFor(statusLead), 2, 'Expected commission is independent of a manually managed customer outcome')
  assert.equal(expectedRebateFor(statusLead), expectedLumpSumRebateFor(statusLead) + expectedSubscriptionRebateFor(statusLead))
}
assert.equal(expectedRebateBreakdownFor({ ...bothMethodsRoundUp, lumpSumAmount: 27 }).lumpSumBasis, 27, 'The common breakdown uses the current manual amount, not the stale RAW subtotal')
assert.equal(expectedRebateBreakdownFor({ ...bothMethodsRoundUp, subscriptionAmount: 35 }).subscriptionBasis, 35, 'The common breakdown uses the current manual amount, not the stale RAW subtotal')
assert.equal(expectedRebateBreakdownFor({ ...bothMethodsRoundUp, partnerName: '목록 외 업체' }).subscriptionBasis, 0, 'The common breakdown must still enforce the approved subscription partner list')
assert.equal(expectedSubscriptionRebateFor({ ...bothMethodsRoundUp, subscriptionRawPeriods: undefined }), 1, 'The existing permitted manual subscription fallback is preserved')

assert.deepEqual(purchaseAmountSourceFor(lead, 'lumpSum'), { kind: 'raw', amount: 150000, rawAmount: 150000 })
assert.deepEqual(purchaseAmountSourceFor(lead, 'subscription'), { kind: 'manual', amount: 10000, rawAmount: null })
assert.deepEqual(purchaseAmountSourceFor({ ...lead, lumpSumAmount: 160000 }, 'lumpSum'), { kind: 'manual', amount: 160000, rawAmount: 150000 })
assert.deepEqual(purchaseAmountSourceFor({ ...subscription, subscriptionAmount: 300000 }, 'subscription'), { kind: 'manual', amount: 300000, rawAmount: 200000 })
for (const kind of ['lumpSum', 'subscription'] as const) {
  assert.deepEqual(purchaseAmountSourceFor(roundingFixture(0, 0), kind), { kind: 'raw', amount: 0, rawAmount: 0 }, 'A current imported zero remains an explicitly verified RAW amount')
  const empty = { ...lead, lumpSumAmount: undefined, subscriptionAmount: undefined, salesRawPeriods: undefined, subscriptionRawPeriods: undefined }
  assert.deepEqual(purchaseAmountSourceFor(empty, kind), { kind: 'empty', amount: 0, rawAmount: null })
  const manualZero = { ...empty, lumpSumAmount: 0, subscriptionAmount: 0 }
  assert.deepEqual(purchaseAmountSourceFor(manualZero, kind), { kind: 'manual', amount: 0, rawAmount: null }, 'An explicitly entered manual zero is not a missing amount')
  const replacedRawZero = { ...roundingFixture(10, 10), lumpSumAmount: 0, subscriptionAmount: 0 }
  assert.deepEqual(purchaseAmountSourceFor(replacedRawZero, kind), { kind: 'manual', amount: 0, rawAmount: 10 }, 'An explicitly entered zero remains manual when it differs from an existing RAW amount')
  const purchaseType: '일시불' | '구독' = kind === 'lumpSum' ? '일시불' : '구독'
  const legacyZero = { ...empty, purchaseType, purchaseAmount: 0 }
  assert.deepEqual(purchaseAmountSourceFor(legacyZero, kind), { kind: 'manual', amount: 0, rawAmount: null }, 'A valid single-method legacy zero is a manual amount')
  const legacyPositive = { ...legacyZero, purchaseAmount: 1 }
  assert.deepEqual(purchaseAmountSourceFor(legacyPositive, kind), { kind: 'manual', amount: 1, rawAmount: null })
  const combinedLegacyZero = { ...empty, purchaseAmount: 0 }
  assert.deepEqual(purchaseAmountSourceFor(combinedLegacyZero, kind), { kind: 'empty', amount: 0, rawAmount: null }, 'A combined legacy total cannot identify an individual purchase-method amount')
  for (const value of [undefined, null, NaN, Infinity, -1, '0']) {
    const invalidDirect = { ...empty, lumpSumAmount: value, subscriptionAmount: value } as unknown as Parameters<typeof purchaseAmountSourceFor>[0]
    assert.deepEqual(purchaseAmountSourceFor(invalidDirect, kind), { kind: 'empty', amount: 0, rawAmount: null }, 'Missing, null, nonfinite, negative and nonnumeric direct values remain empty')
    const invalidLegacy = { ...legacyZero, purchaseAmount: value } as unknown as Parameters<typeof purchaseAmountSourceFor>[0]
    assert.deepEqual(purchaseAmountSourceFor(invalidLegacy, kind), { kind: 'empty', amount: 0, rawAmount: null }, 'Missing, null and invalid legacy values remain empty')
  }
  const nullDirectWithLegacyZero = { ...legacyZero, lumpSumAmount: null, subscriptionAmount: null } as unknown as Parameters<typeof purchaseAmountSourceFor>[0]
  assert.deepEqual(purchaseAmountSourceFor(nullDirectWithLegacyZero, kind), { kind: 'manual', amount: 0, rawAmount: null }, 'A null direct field still permits a valid single-method legacy zero fallback')
  assert.equal(expectedRebateFor(manualZero), 0, 'Source classification must not create commission from a zero amount')
}
for (const appointmentType of [undefined, '미선택'] as const) {
  const unprovenManual = { ...subscription, appointmentType, salesRawPeriods: undefined, subscriptionRawPeriods: undefined }
  assert.equal(expectedRebateFor(unprovenManual), 0, 'Manual amounts must not create referral commission without an explicit partner appointment')
  assert.equal(expectedRebateFor({ ...unprovenManual, salesRawPeriods: subscription.salesRawPeriods, lumpSumAmount: 160000 }), 0, 'Stale RAW cannot bypass the partner-appointment gate')
}
const verifiedIneligibleRoutes = { ...bothMethodsRoundUp,
  salesRawPeriods: { '2026-09': { ...bothMethodsRoundUp.salesRawPeriods['2026-09'], eligibleConfirmedAmount: 0 } },
  subscriptionRawPeriods: { '2026-09': { ...bothMethodsRoundUp.subscriptionRawPeriods['2026-09'], eligibleConfirmedBasisAmount: 0 } },
}
assert.equal(expectedRebateFor(verifiedIneligibleRoutes), 0, 'A current RAW amount with an ineligible route must never fall back to the full manual amount')
assert.equal(purchaseAmountSourceFor(verifiedIneligibleRoutes, 'lumpSum').kind, 'raw')
assert.equal(purchaseAmountSourceFor(verifiedIneligibleRoutes, 'subscription').kind, 'raw')
for (const appointmentType of ['이업종제휴', '상담예약(이업종)'] as const) {
  const manualFixture = { ...lead, appointmentType, partnerName: '(주)다이렉트컴즈', lumpSumAmount: 20864000, subscriptionAmount: 1891000, salesRawPeriods: undefined, subscriptionRawPeriods: undefined }
  const before = JSON.stringify(manualFixture)
  assert.deepEqual(expectedRebateBreakdownFor(manualFixture), { lumpSumBasis: 20864000, subscriptionBasis: 1891000, lumpSumCommission: 417280, subscriptionCommission: 28365, total: 445645 })
  assert.equal(JSON.stringify(manualFixture), before, 'Calculation and provenance checks must not replace manually entered amounts')
}
console.log('salesFinance tests passed')
