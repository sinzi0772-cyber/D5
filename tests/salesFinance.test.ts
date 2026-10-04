import assert from 'node:assert/strict'
import { completedSalesFor, confirmedSalesFor, expectedRebateFor, expectedSubscriptionRebateFor, isSubscriptionRebatePartner, salesRawAmountsFor } from '../src/lib/salesFinance.ts'

const lead = { id: 'fixture', customerName: '가*나', phoneLast4: '0001', registeredAt: '2026-09-01', updatedAt: '2026-10-04', gender: '미입력', partnerName: '(주)아이니웨딩네트웍스', status: '관리중', visitState: '미정', purchaseType: '일시불+구독', lumpSumAmount: 150000, subscriptionAmount: 10000, salesRawPeriods: { '2026-09': { period: '2026-09', sourceHash: 'fixture', importedAt: '2026-10-04', orderCount: 2, confirmedOrderCount: 1, reservedOrderCount: 1, confirmedAmount: 100000, reservedAmount: 50000, eligibleConfirmedAmount: 80000, eligibleReservedAmount: 40000, returnAmount: 0 } } } as const
assert.equal(expectedRebateFor(lead), 2550)
assert.equal(confirmedSalesFor(lead), 100000)
assert.equal(salesRawAmountsFor(lead).reserved, 50000)
assert.equal(expectedRebateFor({ ...lead, salesRawPeriods: undefined }), 150)
assert.equal(expectedRebateFor({ ...lead, lumpSumAmount: 160000 }), 150)
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
  assert.equal(expectedSubscriptionRebateFor({ ...eligiblePartner, subscriptionAmount: 300000 }), 0, 'New partner eligibility must not bypass stale RAW evidence checks')
}
for (const partnerName of ['베리굿웨딩컴퍼니협력사', '베리굿웨딩', '다른베리굿웨딩컴퍼니']) {
  assert.equal(isSubscriptionRebatePartner(partnerName), false, 'Similar company names must not be eligible automatically')
  assert.equal(expectedRebateFor({ ...subscription, partnerName }), 2400)
}
assert.equal(expectedRebateFor({ ...subscription, subscriptionAmount: 300000 }), 2400, 'Changed manual amount cannot reuse stale raw evidence')
assert.equal(expectedRebateFor({ ...subscription, lumpSumAmount: 150000 }), 4650, 'Subscription calculation preserves lump-sum basis')
const rejectedOnlySale = { ...subscription, status: '구매완료', lumpSumAmount: 0, salesRawPeriods: undefined, subscriptionRawPeriods: { '2026-09': { ...subscription.subscriptionRawPeriods['2026-09'], confirmedBasisAmount: 200000, pendingBasisAmount: 0, eligibleConfirmedBasisAmount: 200000, eligiblePendingBasisAmount: 0, rejectedProofItemCount: 2 } } } as const
assert.equal(completedSalesFor(rejectedOnlySale), 200000, 'Rejected promotion proof must not erase the actual completed sale')
assert.equal(confirmedSalesFor(rejectedOnlySale), 200000)
assert.equal(expectedSubscriptionRebateFor(rejectedOnlySale), 3000, 'Rejected proof must count in the approved partner commission')
assert.equal(expectedRebateFor(rejectedOnlySale), 3000)
assert.equal(expectedSubscriptionRebateFor({ ...rejectedOnlySale, partnerName: '목록 외 업체' }), 0, 'Rejected proof cannot bypass the approved partner list')
assert.equal(expectedSubscriptionRebateFor({ ...rejectedOnlySale, subscriptionAmount: 300000 }), 0, 'Rejected proof cannot reuse stale RAW amounts')
const completedPolicy = { ...lead, status: '구매완료', lumpSumAmount: 200000, salesRawPeriods: { '2026-09': { ...lead.salesRawPeriods['2026-09'], tentativeOrderCount: 1, tentativeAmount: 50000, eligibleTentativeAmount: 50000, completedStatuses: ['주문확정', '예약', '가예약'] } } } as const
assert.equal(salesRawAmountsFor(completedPolicy).current, true)
assert.equal(salesRawAmountsFor(completedPolicy).completed, 200000)
assert.equal(salesRawAmountsFor(completedPolicy).pending, 0, 'Completed reservations must not be shown as pending again')
assert.equal(completedSalesFor(completedPolicy), 210000)
assert.equal(confirmedSalesFor(completedPolicy), 110000, 'Original order-confirmed amount must not be forged by business completion')
assert.equal(expectedRebateFor(completedPolicy), 3550)
assert.equal(expectedRebateFor({ ...completedPolicy, lumpSumAmount: 250000 }), 150, 'Changed manual amount cannot reuse tentative raw commission evidence')
console.log('salesFinance tests passed')
