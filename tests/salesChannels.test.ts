import assert from 'node:assert/strict'
import { aggregateSalesChannels, aggregateSubscriptionChannels, getStoredSalesChannels, salesChannelStatusFor } from '../src/lib/salesChannels'
import type { SalesRawOrder } from '../src/lib/salesRaw'
import type { SubscriptionRawItem } from '../src/lib/subscriptionRaw'
import type { Lead } from '../src/types'

const wedding = '고객인증서비스(웨딩)'
const fair = '웨딩박람회(내부)'
const connection = '웨딩업체연결(수수료지급)'
const sale = (orderReference: string, saleAmount: number, changes: Partial<SalesRawOrder> = {}): SalesRawOrder => ({
  rowNumber: 2, orderReference, originalOrderReference: '', identityKey: 'PRIVATE-IDENTITY', customerName: 'PRIVATE-NAME', phoneLast4: 'PRIVATE-PHONE',
  seller: 'PRIVATE-SELLER', orderDate: '2026-10-01', confirmedDate: '2026-10-01', orderStatus: '확정', orderStatusLabel: '주문확정',
  orderCategory: '판매주문', orderType: '', saleAmount, paymentAmount: null, balanceAmount: null,
  channel1: wedding, channel2: fair, commissionEligible: true, isReturnOrRefund: false, hasReviewRequired: false, ...changes,
})
const item = (itemReference: string, amount: number | null, changes: Partial<SubscriptionRawItem> = {}): SubscriptionRawItem => ({
  rowNumber: 2, itemReference, orderReference: 'PRIVATE-ORDER', lineReference: 'PRIVATE-LINE', identityKey: 'PRIVATE-IDENTITY', customerName: 'PRIVATE-NAME',
  phoneLast4: 'PRIVATE-PHONE', orderDate: '2026-10-01', orderStatusLabel: '주문확정', contractStatusLabel: '', logisticsStatusLabel: '',
  disposition: 'confirmed', statusDisposition: 'confirmed', membershipBenefitBasisAmount: amount, basisAmountMissing: amount === null, basisAmountInvalid: false,
  quantity: 50, channel1: wedding, channel2: connection, commissionChannelEligible: true, evidenceApprovalStatus: '', isEvidenceRejected: false,
  hasReviewRequired: false, hasBlockingIssue: false, ...changes,
})
const sales = [sale('PRIVATE-ORDER-1', 100000), sale('PRIVATE-ORDER-2', 30000, { orderStatus: '예약' }),
  sale('PRIVATE-ORDER-3', -10000, { isReturnOrRefund: true }), sale('PRIVATE-ORDER-4', 50000, { channel2: '다른 경로', commissionEligible: true }),
  sale('PRIVATE-ORDER-5', 999999, { orderStatus: '기타' })]
const before = JSON.stringify(sales)
const cash = aggregateSalesChannels(sales)
assert.deepEqual(cash.find(route => route.channel2 === fair), { channel1: wedding, channel2: fair, orderCount: 3, amount: 120000 })
assert.deepEqual(cash.find(route => route.channel2 === '다른 경로'), { channel1: wedding, channel2: '다른 경로', orderCount: 1, amount: 50000 })
assert.equal(JSON.stringify(sales), before)
assert(!JSON.stringify(cash).includes('PRIVATE'))
const subscriptions = [item('BEST:1', 100000), item('BEST:2', 20000, { statusDisposition: 'reserved' }),
  item('LGE:1', null), item('BEST:3', 999999, { statusDisposition: 'excluded' }), item('BEST:4', 1000, { channel1: '', channel2: '' })]
const sub = aggregateSubscriptionChannels(subscriptions)
assert.deepEqual(sub.find(route => route.channel2 === connection), { channel1: wedding, channel2: connection, orderCount: 2, itemCount: 3, amount: null })
assert.equal(sub.find(route => route.channel1 === '')?.amount, 1000)
assert(!JSON.stringify(sub).includes('PRIVATE'))
assert.equal(salesChannelStatusFor(wedding, fair), 'eligible')
assert.equal(salesChannelStatusFor(wedding, connection), 'eligible')
assert.equal(salesChannelStatusFor(wedding, '웨딩박람회(외부)'), 'mismatch')
assert.equal(salesChannelStatusFor('고객인증서비스', fair), 'mismatch')
assert.equal(salesChannelStatusFor(wedding, ''), 'unverified')

const lead = { purchaseType: '일시불+구독', lumpSumAmount: 170000, subscriptionAmount: 121000,
  salesRawPeriods: { '2026-10': { period: '2026-10', sourceHash: 'PRIVATE-HASH', importedAt: '2026-11-01', orderCount: 4,
    confirmedOrderCount: 3, reservedOrderCount: 1, confirmedAmount: 140000, reservedAmount: 30000,
    eligibleConfirmedAmount: 90000, eligibleReservedAmount: 30000, returnAmount: -10000, channels: cash } },
  subscriptionRawPeriods: { '2026-10': { period: '2026-10', sourceHash: 'PRIVATE-HASH', importedAt: '2026-11-01', itemCount: 4,
    confirmedItemCount: 3, pendingItemCount: 1, confirmedBasisAmount: 101000, pendingBasisAmount: 20000,
    eligibleConfirmedBasisAmount: 100000, eligiblePendingBasisAmount: 20000, includedStatuses: ['주문확정', '출하대기'], missingBasisItemCount: 1,
    rejectedProofItemCount: 0, channels: sub } },
} as const
const leadBefore = JSON.stringify(lead)
const stored = getStoredSalesChannels(lead)
assert.equal(stored.filter(route => route.kind === 'lumpSum' && route.status === 'eligible').length, 1)
assert.equal(stored.filter(route => route.kind === 'lumpSum' && route.status === 'mismatch').length, 1)
assert(stored.every(route => route.amountCurrent))
assert(!getStoredSalesChannels({ ...lead, lumpSumAmount: 180000 }).find(route => route.kind === 'lumpSum')?.amountCurrent)
assert.equal(getStoredSalesChannels({ ...lead, lumpSumAmount: 180000 }).find(route => route.kind === 'lumpSum' && route.channel2 === fair)?.amount, 120000, 'A stale route displays its original source amount, never the edited manual total')
const legacy = getStoredSalesChannels({ ...lead, salesRawPeriods: { '2026-10': { ...lead.salesRawPeriods['2026-10'], channels: undefined } } })
assert.equal(legacy.find(route => route.kind === 'lumpSum')?.status, 'unverified')
assert.equal(legacy.find(route => route.kind === 'lumpSum')?.channel1, '')
const malformed = { ...lead, salesRawPeriods: { '2026-10': { ...lead.salesRawPeriods['2026-10'], channels: [{ channel1: wedding, channel2: fair, orderCount: -1, amount: 100, status: 'eligible' }] } } } as unknown as Lead
assert.equal(getStoredSalesChannels(malformed).find(route => route.kind === 'lumpSum')?.status, 'unverified')
const forged = { ...lead, salesRawPeriods: { '2026-10': { ...lead.salesRawPeriods['2026-10'], channels: [{ channel1: wedding, channel2: '다른 경로', orderCount: 1, amount: 100, status: 'eligible' }] } } } as unknown as Lead
assert.equal(getStoredSalesChannels(forged).find(route => route.kind === 'lumpSum')?.status, 'mismatch', 'Never trust a stored eligibility flag')
assert.deepEqual(getStoredSalesChannels({ purchaseType: '일시불', purchaseAmount: 123456 }), [{ kind: 'lumpSum', period: null, channel1: '', channel2: '', orderCount: 0, amount: 123456, status: 'unverified', amountCurrent: false }])
assert.deepEqual(getStoredSalesChannels({ purchaseType: '미선택' }), [])
assert.equal(JSON.stringify(lead), leadBefore)
assert(!JSON.stringify(stored).includes('PRIVATE'))
console.log('salesChannels: actual route mixtures, signed amounts, subscription components, missing evidence, stale manual totals, safe stored metadata and immutable inputs passed')
