import assert from 'node:assert/strict'
import { parseSalesRaw } from '../src/lib/salesRaw'
import { parseSubscriptionRaw } from '../src/lib/subscriptionRaw'
import { cashSettlementBasisFor, subscriptionSettlementBasisFor } from '../src/lib/settlementBasis'

const tsv = (rows: (string | number)[][]) => rows.map(row => row.join('\t')).join('\n')
const cashHeader = ['주문번호', '고객명', '핸드폰번호', '판매금액', '판매경로1', '판매경로2', '주문확정여부', '원본주문상태']
const cash = (id: string, amount: number, status: string, original: string) => [id, '김*수', '0001', amount, '', '', status, original]
const cashRows = parseSalesRaw(tsv([cashHeader,
  cash('cash-sale', 100_000, '주문확정', '매출'),
  cash('cash-confirmed', 70_000, '주문확정', '주문확정'),
  cash('cash-reserved', 10_000, '예약', '예약'),
  cash('cash-refund', -20_000, '주문확정', '매출'),
  cash('cash-one', 1, '주문확정', '매출'),
])).orders
assert.equal(cashSettlementBasisFor(cashRows), 150_000)
assert.equal(cashSettlementBasisFor([cashRows[1]]), 70_000)
assert.equal(cashSettlementBasisFor([{ ...cashRows[0], sourceOrderStatus: undefined }]), undefined)

const subscription = (id: string, amount: number, status: string, cancellation = '') => [id, 1, '김*수', '0001', '2026-09-21', amount, status, cancellation]
const subscriptions = parseSubscriptionRaw(tsv([
  ['BEST주문번호', 'BEST주문라인번호', '구매고객명', '전화번호', '주문일자', '멤버십혜택기준금액', '주문상태', '취소일자'],
  subscription('sub-closed', 200_000, '마감됨'),
  subscription('sub-shipped', 100_000, '출고됨'),
  subscription('sub-confirmed', 70_000, '주문확정'),
  subscription('sub-pending', 30_000, '출하대기'),
  subscription('sub-canceled', 10_000, '마감됨', '2026-09-23'),
  subscription('sub-one', 1, '마감됨'),
]), { confirmedStatuses: ['마감됨', '출고됨', '주문확정'], reservedStatuses: ['출하대기'] }).items
assert.equal(subscriptionSettlementBasisFor(subscriptions), 270_000)
assert.equal(subscriptionSettlementBasisFor(subscriptions.slice(1)), 70_000)
console.log('Settlement basis: exact RAW statuses, signed returns, cancellation, and one-won exclusions passed')
