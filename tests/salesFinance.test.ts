import assert from 'node:assert/strict'
import { commissionVerificationRequiredFor, completedSalesFor, confirmedSalesFor, expectedLumpSumRebateFor, expectedRebateBreakdownFor, expectedRebateFor, expectedSubscriptionRebateFor, isSubscriptionRebatePartner, purchaseAmountSourceFor, salesRawAmountsFor, totalPurchaseAmountFor } from '../src/lib/salesFinance.ts'
import { getStoredSalesChannels } from '../src/lib/salesChannels'

const lead = { id: 'fixture', customerName: '가*나', phoneLast4: '0001', registeredAt: '2026-09-01', updatedAt: '2026-10-04', gender: '미입력', partnerName: '(주)아이니웨딩네트웍스', appointmentType: '이업종제휴', status: '관리중', visitState: '미정', purchaseType: '일시불+구독', lumpSumAmount: 150000, subscriptionAmount: 10000, salesRawPeriods: { '2026-09': { period: '2026-09', sourceHash: 'fixture', importedAt: '2026-10-04', orderCount: 2, confirmedOrderCount: 1, reservedOrderCount: 1, confirmedAmount: 100000, reservedAmount: 50000, eligibleConfirmedAmount: 80000, eligibleReservedAmount: 40000, returnAmount: 0, settlementBasisAmount: 100000 } } } as const
assert.equal(expectedRebateFor(lead), 2000)
assert.deepEqual(expectedRebateBreakdownFor(lead), { lumpSumBasis: 100000, subscriptionBasis: 0, lumpSumCommission: 2000, subscriptionCommission: 0, total: 2000 })
assert.equal(confirmedSalesFor(lead), 100000)
assert.equal(salesRawAmountsFor(lead).reserved, 50000)
assert.equal(expectedRebateFor({ ...lead, salesRawPeriods: undefined }), 0, 'A partner appointment alone does not verify a sale for manual amounts')
assert.equal(expectedRebateFor({ ...lead, lumpSumAmount: 160000 }), 0, 'Changed manual amount must not reuse old RAW or earn commission without verification')
assert.equal(expectedRebateFor({ ...lead, partnerName: '기타업체' }), 2000)
assert.equal(confirmedSalesFor({ ...lead, status: '구매완료' }), 110000)
const refund = { ...lead, lumpSumAmount: 75000, subscriptionAmount: 0, salesRawPeriods: { '2026-09': { ...lead.salesRawPeriods['2026-09'], confirmedAmount: -25000, reservedAmount: 100000, eligibleConfirmedAmount: -25000, eligibleReservedAmount: 100000, settlementBasisAmount: -25000 } } }
assert.equal(expectedRebateFor(refund), 0)
assert.equal(confirmedSalesFor(refund), -25000)
assert.equal(salesRawAmountsFor(refund).confirmed + salesRawAmountsFor(refund).reserved, 75000)
const subscription = { ...lead, status: '관리중', subscriptionAmount: 200000, subscriptionRawPeriods: { '2026-09': { period: '2026-09', sourceHash: 'anonymous-subscription', importedAt: '2026-10-04', itemCount: 3, confirmedItemCount: 2, pendingItemCount: 1, confirmedBasisAmount: 150000, pendingBasisAmount: 50000, eligibleConfirmedBasisAmount: 100000, eligiblePendingBasisAmount: 50000, includedStatuses: ['주문확정', '마감됨', '출하대기'], missingBasisItemCount: 1, rejectedProofItemCount: 1, settlementBasisAmount: 150000 } } } as const
assert.equal(expectedRebateFor(subscription), 4250, 'Only the payable source statuses contribute to commission even when the current BEST total is higher')
assert.equal(confirmedSalesFor(subscription), 250000, 'Raw subscription confirmed basis counts without changing manual status')
assert.equal(expectedRebateFor({ ...subscription, partnerName: '기타업체' }), 2000)
assert.equal(expectedRebateFor({ ...subscription, partnerName: '(주)아이패밀리에스씨' }), 4250)
assert.equal(expectedRebateFor({ ...subscription, partnerName: '아이웨딩' }), 4250)
assert.equal(expectedRebateFor({ ...subscription, partnerName: '(주)아이패밀리에스씨협력업체' }), 2000)
for (const partnerName of ['주식회사 베리굿웨딩컴퍼니', '(주)베리굿웨딩컴퍼니', '㈜베리굿웨딩컴퍼니', '베리굿웨딩컴퍼니']) {
  const eligiblePartner = { ...subscription, partnerName }
  assert.equal(isSubscriptionRebatePartner(partnerName), true)
  assert.equal(expectedSubscriptionRebateFor(eligiblePartner), 2250, 'The approved partner receives commission on the current membership basis')
  assert.equal(expectedRebateFor(eligiblePartner), 4250, 'Adding the subscription partner must preserve lump-sum commission')
  assert.equal(expectedSubscriptionRebateFor({ ...eligiblePartner, subscriptionAmount: 300000 }), 0, 'A manual subscription amount requires matching BEST evidence')
}
for (const partnerName of ['베리굿웨딩컴퍼니협력사', '베리굿웨딩', '다른베리굿웨딩컴퍼니']) {
  assert.equal(isSubscriptionRebatePartner(partnerName), false, 'Similar company names must not be eligible automatically')
  assert.equal(expectedRebateFor({ ...subscription, partnerName }), 2000)
}
assert.equal(expectedRebateFor({ ...subscription, subscriptionAmount: 300000 }), 2000, 'Unverified manual subscription does not remove verified lump-sum commission')
assert.equal(expectedRebateFor({ ...subscription, lumpSumAmount: 150000 }), 4250, 'Subscription calculation preserves lump-sum basis')
const rejectedOnlySale = { ...subscription, status: '구매완료', lumpSumAmount: 0, salesRawPeriods: undefined, subscriptionRawPeriods: { '2026-09': { ...subscription.subscriptionRawPeriods['2026-09'], confirmedBasisAmount: 200000, pendingBasisAmount: 0, eligibleConfirmedBasisAmount: 200000, eligiblePendingBasisAmount: 0, rejectedProofItemCount: 2, settlementBasisAmount: 200000 } } } as const
assert.equal(completedSalesFor(rejectedOnlySale), 200000, 'Rejected promotion proof must not erase the actual completed sale')
assert.equal(confirmedSalesFor(rejectedOnlySale), 200000)
assert.equal(expectedSubscriptionRebateFor(rejectedOnlySale), 3000, 'Rejected proof must count in the approved partner commission')
assert.equal(expectedRebateFor(rejectedOnlySale), 3000)
assert.equal(expectedSubscriptionRebateFor({ ...rejectedOnlySale, partnerName: '목록 외 업체' }), 0, 'Rejected proof cannot bypass the approved partner list')
assert.equal(expectedSubscriptionRebateFor({ ...rejectedOnlySale, subscriptionAmount: 300000 }), 0, 'Rejected-proof policy does not bypass manual amount verification')
const completedPolicy = { ...lead, status: '구매완료', lumpSumAmount: 200000, salesRawPeriods: { '2026-09': { ...lead.salesRawPeriods['2026-09'], tentativeOrderCount: 1, tentativeAmount: 50000, eligibleTentativeAmount: 50000, completedStatuses: ['주문확정', '예약', '가예약'] } } } as const
assert.equal(salesRawAmountsFor(completedPolicy).current, true)
assert.equal(salesRawAmountsFor(completedPolicy).completed, 200000)
assert.equal(salesRawAmountsFor(completedPolicy).pending, 0, 'Completed reservations must not be shown as pending again')
assert.equal(completedSalesFor(completedPolicy), 210000)
assert.equal(confirmedSalesFor(completedPolicy), 110000, 'Original order-confirmed amount must not be forged by business completion')
assert.equal(expectedRebateFor(completedPolicy), 2000)
assert.equal(expectedRebateFor({ ...completedPolicy, lumpSumAmount: 250000 }), 0, 'Changed manual amount cannot reuse tentative RAW evidence or the full unverified amount')

const legacyConfirmationOnly = { ...subscription,
  salesRawPeriods: { '2026-09': { ...lead.salesRawPeriods['2026-09'], settlementBasisAmount: undefined } },
  subscriptionRawPeriods: { '2026-09': { ...subscription.subscriptionRawPeriods['2026-09'], settlementBasisAmount: undefined } },
}
assert.equal(expectedRebateFor(legacyConfirmationOnly), 0, 'Legacy confirmed totals alone cannot establish a payable source status')
assert.equal(commissionVerificationRequiredFor(legacyConfirmationOnly), true)
assert.equal(totalPurchaseAmountFor(legacyConfirmationOnly), 350000, 'Missing settlement evidence keeps the gross total intact')
const zeroSettlement = { ...legacyConfirmationOnly,
  salesRawPeriods: { '2026-09': { ...lead.salesRawPeriods['2026-09'], settlementBasisAmount: 0 } },
  subscriptionRawPeriods: { '2026-09': { ...subscription.subscriptionRawPeriods['2026-09'], settlementBasisAmount: 0 } },
}
assert.equal(expectedRebateFor(zeroSettlement), 0)
assert.equal(commissionVerificationRequiredFor(zeroSettlement), false, 'An explicit verified zero needs no status evidence review')

const roundingFixture = (lumpSumBasis: number, subscriptionBasis: number) => ({
  ...subscription,
  lumpSumAmount: lumpSumBasis,
  subscriptionAmount: subscriptionBasis,
  salesRawPeriods: { '2026-09': {
    ...lead.salesRawPeriods['2026-09'], confirmedAmount: lumpSumBasis, reservedAmount: 0,
    eligibleConfirmedAmount: lumpSumBasis, eligibleReservedAmount: 0, settlementBasisAmount: lumpSumBasis,
  } },
  subscriptionRawPeriods: { '2026-09': {
    ...subscription.subscriptionRawPeriods['2026-09'], confirmedBasisAmount: subscriptionBasis, pendingBasisAmount: 0,
    eligibleConfirmedBasisAmount: subscriptionBasis, eligiblePendingBasisAmount: 0, settlementBasisAmount: subscriptionBasis,
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
assert.equal(expectedRebateBreakdownFor({ ...bothMethodsRoundUp, lumpSumAmount: 27 }).lumpSumBasis, 0, 'The common breakdown excludes a manual amount that differs from verified RAW')
assert.equal(expectedRebateBreakdownFor({ ...bothMethodsRoundUp, subscriptionAmount: 35 }).subscriptionBasis, 0, 'Subscription uses the same strict current-RAW requirement')
assert.equal(expectedRebateBreakdownFor({ ...bothMethodsRoundUp, partnerName: '목록 외 업체' }).subscriptionBasis, 0, 'The common breakdown must still enforce the approved subscription partner list')
assert.equal(expectedSubscriptionRebateFor({ ...bothMethodsRoundUp, subscriptionRawPeriods: undefined }), 0, 'A manually entered amount alone does not verify a subscription purchase')

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
const mismatchedRoute = { channel1: '고객인증서비스(웨딩)', channel2: '웨딩매장행사', orderCount: 1 }
const verifiedMismatchedRoutes = { ...bothMethodsRoundUp,
  salesRawPeriods: { '2026-09': { ...bothMethodsRoundUp.salesRawPeriods['2026-09'], eligibleConfirmedAmount: 0, channels: [{ ...mismatchedRoute, amount: 26 }] } },
  subscriptionRawPeriods: { '2026-09': { ...bothMethodsRoundUp.subscriptionRawPeriods['2026-09'], eligibleConfirmedBasisAmount: 0, channels: [{ ...mismatchedRoute, amount: 34 }] } },
}
assert.equal(expectedRebateFor(verifiedMismatchedRoutes), 2, 'Both current BEST purchase methods retain commission when the routes need review')
assert.deepEqual(getStoredSalesChannels(verifiedMismatchedRoutes).map(route => route.status), ['mismatch', 'mismatch'])
assert.equal(expectedRebateFor({ ...verifiedMismatchedRoutes, lumpSumAmount: 100000, subscriptionAmount: 200000 }), 0, 'Changed amounts still require matching BEST purchase evidence')
assert.equal(commissionVerificationRequiredFor(verifiedMismatchedRoutes), false, 'Known route mismatches do not make a current purchase amount unverified')
assert.equal(commissionVerificationRequiredFor(bothMethodsRoundUp), false)
assert.equal(commissionVerificationRequiredFor({ ...bothMethodsRoundUp, lumpSumAmount: 27 }), true)
assert.equal(commissionVerificationRequiredFor({ ...bothMethodsRoundUp, subscriptionAmount: 35 }), true)
assert.equal(commissionVerificationRequiredFor({ ...bothMethodsRoundUp, subscriptionRawPeriods: undefined, partnerName: '목록 외 업체' }), false, 'An excluded subscription partner does not require amount verification for that method')
assert.equal(purchaseAmountSourceFor(verifiedMismatchedRoutes, 'lumpSum').kind, 'raw')
assert.equal(purchaseAmountSourceFor(verifiedMismatchedRoutes, 'subscription').kind, 'raw')
for (const appointmentType of ['이업종제휴', '상담예약(이업종)'] as const) {
  const manualFixture = { ...lead, appointmentType, partnerName: '(주)다이렉트컴즈', lumpSumAmount: 20864000, subscriptionAmount: 1891000, salesRawPeriods: undefined, subscriptionRawPeriods: undefined }
  const before = JSON.stringify(manualFixture)
  assert.deepEqual(expectedRebateBreakdownFor(manualFixture), { lumpSumBasis: 0, subscriptionBasis: 0, lumpSumCommission: 0, subscriptionCommission: 0, total: 0 })
  assert.equal(commissionVerificationRequiredFor(manualFixture), true)
  assert.equal(totalPurchaseAmountFor(manualFixture), 22755000, 'Excluding unverified fees must preserve the manually entered sales total')
  assert.deepEqual(purchaseAmountSourceFor(manualFixture, 'lumpSum'), { kind: 'manual', amount: 20864000, rawAmount: null })
  assert.deepEqual(purchaseAmountSourceFor(manualFixture, 'subscription'), { kind: 'manual', amount: 1891000, rawAmount: null })
  assert.equal(JSON.stringify(manualFixture), before, 'Calculation and provenance checks must not replace manually entered amounts')
}
console.log('salesFinance tests passed')
