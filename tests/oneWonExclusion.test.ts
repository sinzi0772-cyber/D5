import assert from 'node:assert/strict'
import { isOneWonSaleAmount, parseSalesRaw, SALES_COMMISSION_CHANNEL1, SALES_COMMISSION_CHANNEL2 } from '../src/lib/salesRaw'
import { parseSubscriptionRaw } from '../src/lib/subscriptionRaw'
import { buildSalesMatchPlan } from '../src/lib/salesMatching'
import { buildSubscriptionMatchPlan } from '../src/lib/subscriptionMatching'
import { aggregateSalesChannels, aggregateSubscriptionChannels, getStoredSalesChannels } from '../src/lib/salesChannels'

const wedding = SALES_COMMISSION_CHANNEL1, route = SALES_COMMISSION_CHANNEL2[0]
const tsv = (rows: readonly (readonly unknown[])[]) => rows.map(row => row.join('\t')).join('\n')
const lead = { id: 'synthetic-one-won', customerName: 'Alice', phoneLast4: '5678', gender: '미입력', registeredAt: '2026-10-01',
  updatedAt: '2026-11-01', partnerName: 'synthetic', appointmentType: '이업종제휴', status: '관리중', visitState: '미정' } as const
const salesHeader = ['주문번호', '고객명', '핸드폰번호', '판매금액', '판매경로1', '판매경로2', '주문확정여부', '원주문번호']
const sale = (id: string, amount: number, channel = route as string, state = '주문확정', original = '') => [id, 'Alice', '01012345678', amount, wedding, channel, state, original]
const oneOnly = parseSalesRaw(tsv([salesHeader, sale('one', 1), sale('wrong-one', 1, 'wrong')]))
assert.equal(oneOnly.orders.length, 2, 'Original rows stay available for audit')
assert(oneOnly.orders.every(row => row.saleAmount === 1 && !row.commissionEligible))
assert.equal(oneOnly.summary.excludedOneWonOrders, 2)
assert.equal(oneOnly.summary.saleAmount, 0)
assert.equal(oneOnly.summary.admittedSaleAmount, 0)
assert.equal(oneOnly.summary.admittedOrderCount, 0)
assert.equal(oneOnly.summary.ineligibleOrders, 0, 'Ignored one-won rows are not route mismatches')
assert.equal(oneOnly.issues.filter(issue => issue.code === 'one-won-sale-excluded').length, 2)
assert.equal(buildSalesMatchPlan(oneOnly, [lead]).matched.length, 0)
assert.equal(buildSalesMatchPlan(oneOnly, [lead]).excluded.length, 1)
const mixed = parseSalesRaw(tsv([salesHeader, sale('normal', 100), sale('one', 1), sale('unknown-one', 1, 'wrong', 'UNKNOWN')]))
const mixedBefore = JSON.stringify(mixed)
const mixedPlan = buildSalesMatchPlan(mixed, [lead])
assert.equal(mixedPlan.review.length, 0, 'An ignored one-won row cannot hold a valid sibling')
assert.equal(mixedPlan.matched[0].amounts.saleAmount, 100)
assert.equal(mixedPlan.matched[0].amounts.orderCount, 1)
assert.deepEqual(aggregateSalesChannels(mixed.orders), [{ channel1: wedding, channel2: route, orderCount: 1, amount: 100 }])
assert.equal(JSON.stringify(mixed), mixedBefore)
const withRefund = parseSalesRaw(tsv([salesHeader, sale('normal', 100), sale('refund', -1, route, '주문확정', 'normal')]))
assert.equal(withRefund.summary.saleAmount, 99, 'Negative one-won returns remain signed evidence')
assert.equal(withRefund.summary.excludedOneWonOrders, 0)
assert.equal(buildSalesMatchPlan(withRefund, [lead]).matched[0].amounts.saleAmount, 99)
assert.equal(aggregateSalesChannels(withRefund.orders)[0].amount, 99)
for (const value of [0, -1, 2, 100, null, undefined, '1']) assert.equal(isOneWonSaleAmount(value), false)
assert.equal(isOneWonSaleAmount(1), true)

const subHeader = ['BEST주문번호', 'BEST주문라인번호', '구매고객명', '전화번호', '주문일자', '멤버십혜택기준금액', '주문상태', '판매경로1', '판매경로2']
const item = (line: string, amount: number, channel = route as string, state = '주문확정') => ['sub', line, 'Alice', '01012345678', '2026-10-01', amount, state, wedding, channel]
const sub = parseSubscriptionRaw(tsv([subHeader, item('normal', 100), item('one', 1), item('wrong-one', 1, 'wrong', 'UNKNOWN')]))
const subBefore = JSON.stringify(sub)
assert.equal(sub.items.length, 3)
assert.equal(sub.items[1].membershipBenefitBasisAmount, 1)
assert.equal(sub.summary.excludedOneWonItems, 2)
assert.equal(sub.summary.admittedBasisAmount, 100)
assert.equal(sub.summary.admittedItemCount, 1)
assert.equal(sub.summary.admittedOrderCount, 1)
assert.equal(sub.summary.reviewItems, 0)
assert.equal(sub.summary.excludedBasisAmount, 2, 'Ignored source amounts remain auditable')
const subPlan = buildSubscriptionMatchPlan(sub, [lead])
assert.equal(subPlan.review.length, 0)
assert.equal(subPlan.matched[0].amounts.basisAmount, 100)
assert.equal(subPlan.matched[0].amounts.itemCount, 1)
assert.equal(subPlan.matched[0].amounts.excludedItemCount, 2)
assert.equal(subPlan.matched[0].amounts.excludedBasisAmount, 2)
assert.deepEqual(aggregateSubscriptionChannels(sub.items), [{ channel1: wedding, channel2: route, orderCount: 1, itemCount: 1, amount: 100 }])
assert.equal(JSON.stringify(sub), subBefore)
const subOnly = parseSubscriptionRaw(tsv([subHeader, item('one', 1)]))
assert.equal(buildSubscriptionMatchPlan(subOnly, [lead]).matched.length, 0)
assert.equal(buildSubscriptionMatchPlan(subOnly, [lead]).excluded.length, 1)
const cached = JSON.parse(JSON.stringify(subOnly))
cached.items[0].commissionChannelEligible = true
cached.customers[0].items[0].commissionChannelEligible = true
assert.equal(buildSubscriptionMatchPlan(cached, [lead]).summary.matched.eligibleBasisAmount, 0, 'Cached flags cannot admit one-won rows')

const period = { period: '2026-10', sourceHash: 'synthetic', importedAt: '2026-11-01', orderCount: 1,
  confirmedOrderCount: 1, reservedOrderCount: 0, confirmedAmount: 1, reservedAmount: 0, eligibleConfirmedAmount: 1,
  eligibleReservedAmount: 0, returnAmount: 0, channels: [{ channel1: wedding, channel2: 'wrong', orderCount: 1, amount: 1 }] }
const stored = { purchaseType: '일시불', lumpSumAmount: 1, salesRawPeriods: { '2026-10': period } } as const
const storedBefore = JSON.stringify(stored)
assert.deepEqual(getStoredSalesChannels(stored), [])
assert.deepEqual(getStoredSalesChannels({ purchaseType: '일시불', purchaseAmount: 1 }), [])
assert.deepEqual(getStoredSalesChannels({ ...stored, salesRawPeriods: { '2026-10': { ...period, channels: undefined } } }), [])
assert.equal(JSON.stringify(stored), storedBefore, 'Original stored/manual one-won values are retained')
const negative = { ...stored, lumpSumAmount: 0, salesRawPeriods: { '2026-10': { ...period, confirmedAmount: -1,
  channels: [{ channel1: wedding, channel2: route, orderCount: 1, amount: -1 }] } } }
assert.equal(getStoredSalesChannels(negative)[0].amount, -1)
console.log('oneWonExclusion: original source audit, exact positive-one filtering, cached matchers, mixed customers, signed refunds, route metadata and manual preservation passed')
