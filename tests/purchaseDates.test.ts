import assert from 'node:assert/strict'
import { cashPurchaseDateEvidenceFor, normalizePurchaseDate, purchaseDatesFor, saleDateFromColumns, saleDatesFromRows, subscriptionPurchaseDateEvidenceFor } from '../src/lib/purchaseDates'
import { parseSalesRaw } from '../src/lib/salesRaw'
import { parseSubscriptionRaw } from '../src/lib/subscriptionRaw'
import type { Lead } from '../src/types'

assert.equal(normalizePurchaseDate('2026.10.3'), '2026-10-03')
assert.equal(normalizePurchaseDate('2026-02-30'), undefined)
assert.equal(normalizePurchaseDate('0000-10-03'), undefined)
assert.equal(saleDateFromColumns(name => ({ 판매일: '2026/10/3', 판매일자: '2026-10-03' } as Record<string, string>)[name] || ''), '2026-10-03')
assert.equal(saleDateFromColumns(name => ({ 판매일: '2026-10-03', 판매일자: '2026-10-04' } as Record<string, string>)[name] || ''), undefined)
assert.equal(saleDateFromColumns(name => ({ 판매일: '2026-02-30', 판매일자: '2026-10-03' } as Record<string, string>)[name] || ''), undefined)
assert.deepEqual(saleDatesFromRows([{ saleDate: '2026-10-04' }, { saleDate: '2026.10.3' }, { saleDate: '2026-10-04' }, {}, { saleDate: '2026-02-30' }]), ['2026-10-03', '2026-10-04'])

const salesHeaders = ['주문번호', '고객명', '핸드폰번호', '판매금액', '판매경로1', '판매경로2', '주문확정여부', '주문일자', '판매확정일']
const salesRow = ['synthetic-sale', '가**', '1234', '100000', '고객인증서비스(웨딩)', '웨딩박람회(내부)', '주문확정', '2026-10-01', '2026-10-02']
const tsv = (headers: string[], row: string[]) => [headers.join('\t'), row.join('\t')].join('\n')
const noSaleDate = parseSalesRaw(tsv(salesHeaders, salesRow))
assert.equal(noSaleDate.orders[0].saleDate, undefined, 'Do not substitute order or confirmation date')
for (const header of ['판매일', '판매일자']) {
  const withSaleDate = parseSalesRaw(tsv([...salesHeaders, header], [...salesRow, '2026.10.03']))
  assert.equal(withSaleDate.orders[0].saleDate, '2026-10-03')
  assert.deepEqual(withSaleDate.summary, noSaleDate.summary, 'Date metadata cannot change financial or review totals')
}
const invalidSaleDate = parseSalesRaw(tsv([...salesHeaders, '판매일'], [...salesRow, 'invalid']))
assert.equal(invalidSaleDate.orders[0].saleDate, undefined)
assert.deepEqual(invalidSaleDate.summary, noSaleDate.summary)

const subscriptionHeaders = ['구매고객명', '전화번호', '주문일자', '멤버십혜택기준금액', '주문상태', 'BEST주문번호', 'BEST주문라인번호']
const subscriptionRow = ['가**', '1234', '2026-10-01', '100000', '주문확정', 'synthetic-subscription', '1']
const noSubscriptionDate = parseSubscriptionRaw(tsv(subscriptionHeaders, subscriptionRow))
assert.equal(noSubscriptionDate.items[0].saleDate, undefined, 'Subscription order date is not its purchase date')
for (const header of ['판매일', '판매일자']) {
  const withSaleDate = parseSubscriptionRaw(tsv([...subscriptionHeaders, header], [...subscriptionRow, '2026/10/04']))
  assert.equal(withSaleDate.items[0].saleDate, '2026-10-04')
  assert.deepEqual(withSaleDate.summary, noSubscriptionDate.summary)
}

const cashOrder = noSaleDate.orders[0]
assert.deepEqual(cashPurchaseDateEvidenceFor([
  cashOrder,
  { ...cashOrder, saleDate: '2026-10-04' },
  { ...cashOrder, confirmedDate: '', orderDate: '2026-10-02' },
  { ...cashOrder, confirmedDate: '', orderDate: '2026-10-01' },
  { ...cashOrder, orderStatus: '예약', confirmedDate: '2026-10-06' },
  { ...cashOrder, isReturnOrRefund: true, confirmedDate: '2026-10-07' },
  { ...cashOrder, saleAmount: 1, confirmedDate: '2026-10-08' },
]), [
  { date: '2026-10-01', source: '주문일자' },
  { date: '2026-10-02', source: '판매확정일' },
  { date: '2026-10-04', source: '판매일' },
])
const subscriptionItem = noSubscriptionDate.items[0]
assert.deepEqual(subscriptionPurchaseDateEvidenceFor([
  subscriptionItem,
  { ...subscriptionItem, disposition: 'excluded', orderDate: '2026-10-02' },
  { ...subscriptionItem, disposition: 'reserved', orderDate: '2026-10-03' },
  { ...subscriptionItem, membershipBenefitBasisAmount: 1, orderDate: '2026-10-04' },
]), [{ date: '2026-10-01', source: '주문일자' }])
const lead = {
  salesRawPeriods: { first: { saleDates: ['2026-10-04', '2026-10-03', '2026-10-04', 'invalid'], importedAt: '2026-11-01', purchaseDateEvidence: [{ date: '2026-10-04', source: '판매확정일' }, { date: '2026-10-07', source: '주문일자' }, { date: '2026-02-30', source: '주문일자' }, { date: '2026-10-09', source: '배송일' }] } },
  subscriptionRawPeriods: { first: { saleDates: ['2026-10-05'] }, missing: { orderDate: '2026-10-02', importedAt: '2026-11-01' } },
} as unknown as Lead
assert.deepEqual(purchaseDatesFor(lead), [
  { kind: 'lumpSum', label: '일시불', evidence: [{ date: '2026-10-03', source: '판매일' }, { date: '2026-10-04', source: '판매일' }, { date: '2026-10-07', source: '주문일자' }] },
  { kind: 'subscription', label: '구독', evidence: [{ date: '2026-10-05', source: '판매일' }] },
])
assert.deepEqual(purchaseDatesFor({}).map(row => row.evidence), [[], []])
assert.deepEqual(purchaseDatesFor({ salesRawPeriods: [] } as unknown as Lead).map(row => row.evidence), [[], []])
console.log('Purchase dates: explicit sale columns, aliases, invalid/conflicting values, labeled confirmed and order dates, sorted distinct dates, and unchanged financial totals passed.')
