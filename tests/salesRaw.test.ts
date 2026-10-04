import assert from 'node:assert/strict'
import { customerIdentityKey, isSalesCommissionChannelEligible, maskCustomerName, parseSalesRaw } from '../src/lib/salesRaw.ts'

const headers = ['주문번호', '고객명', '핸드폰번호', '판매금액', '결제금액', '잔액', '판매경로 1', '판매경로 2', '주문확정 여부', '주문 구분', '주문유형', '원주문번호', '주문일자', '판매확정일']
const escape = (value: string) => /["\t\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
const makeRow = (reference: string, changes: Partial<Record<string, string>> = {}) => headers.map(name => escape(({
  주문번호: reference, 고객명: '이준호', 핸드폰번호: '010-0000-2601', 판매금액: '1,000,000', 결제금액: '700,000', 잔액: '300,000',
  '판매경로 1': '고객인증서비스(웨딩)', '판매경로 2': '웨딩박람회(내부)', '주문확정 여부': '주문확정', '주문 구분': '판매주문',
  주문유형: '판매', 원주문번호: '', 주문일자: '2026-09-10', 판매확정일: '2026-09-11', ...changes,
} as Record<string, string>)[name] || '')).join('\t')
const tsv = (...rows: string[]) => `${headers.map(escape).join('\t')}\r\n${rows.join('\r\n')}\r\n`

assert.equal(maskCustomerName(' 이 준 호 '), '이*호')
assert.equal(maskCustomerName('이*호'), '이*호')
assert.equal(maskCustomerName('홍길'), '홍*')
assert.equal(customerIdentityKey('이준호', '010-0000-2601'), '이*호|2601')
assert.notEqual(customerIdentityKey('이준호', '2601'), customerIdentityKey('이준호', '2602'))
assert.notEqual(customerIdentityKey('이준호', '2601'), customerIdentityKey('김민호', '2601'))
assert.equal(customerIdentityKey('***', '2601'), '')
assert.equal(customerIdentityKey('이*호', '12'), '')
assert.equal(isSalesCommissionChannelEligible('고객인증서비스(웨딩)', '웨딩업체연결(수수료지급)'), true)
assert.equal(isSalesCommissionChannelEligible('고객인증서비스(웨딩)', '웨딩박람회(내부)'), true)
assert.equal(isSalesCommissionChannelEligible('고객인증서비스', '웨딩박람회(내부)'), false)
assert.equal(isSalesCommissionChannelEligible('고객인증서비스(웨딩)', '웨딩박람회(외부)'), false)

const repeated = makeRow('example-1')
const result = parseSalesRaw(tsv(
  repeated, repeated,
  makeRow('example-2', { 판매금액: '500,000', '주문확정 여부': '예약', 고객명: '이*호' }),
  makeRow('example-3', { 판매금액: '200,000', '주문확정 여부': '가예약' }),
  makeRow('example-4', { 판매금액: '-100,000', '주문 구분': '반품주문', 주문유형: '반품', 원주문번호: 'example-1' }),
  makeRow('example-5', { 고객명: '김민호', 판매금액: '900,000', '판매경로 2': '기타' }),
))
assert.equal(result.summary.inputRows, 6)
assert.equal(result.orders.length, 5)
assert.equal(result.customers.length, 2)
assert.equal(result.summary.duplicateOrderRows, 1)
assert.equal(result.summary.confirmedOrders, 3)
assert.equal(result.summary.reservedOrders, 1)
assert.equal(result.summary.tentativeOrders, 1)
assert.equal(result.summary.returnOrders, 1)
assert.equal(result.summary.errorCount, 0)
const customer = result.customers.find(customer => customer.identityKey === '이*호|2601')!
assert.equal(customer.saleAmount, 1_600_000)
assert.equal(customer.pendingSaleAmount, 700_000)
assert.equal(customer.confirmedSaleAmount, 900_000)
assert.equal(customer.expectedCommission, 32_000)
assert.equal(customer.confirmedExpectedCommission, 18_000)
assert.equal(customer.reservedSaleAmount, 500_000)
assert.equal(customer.tentativeSaleAmount, 200_000)
assert.equal(customer.admittedOrderCount, 4)
assert.equal(customer.admittedSaleAmount, 1_600_000)
assert.equal(customer.admittedExpectedCommission, 32_000)
assert.equal(customer.hasReviewRequired, true)
assert.equal(result.summary.expectedCommission, 32_000)
assert.equal(result.summary.saleAmount, 2_500_000)
assert.equal(result.customers.find(customer => customer.customerName === '김*호')?.expectedCommission, 0)
assert.equal(JSON.stringify(result).includes('010-0000-2601'), false)
assert.equal(JSON.stringify(result).includes('이준호'), false)

const permittedStatuses = parseSalesRaw(tsv(
  makeRow('permitted-confirmed'),
  makeRow('permitted-reserved', { '주문확정 여부': '예약', 판매금액: '500,000' }),
  makeRow('permitted-tentative', { '주문확정 여부': '가예약', 판매금액: '200,000' }),
))
assert.deepEqual(permittedStatuses.orders.map(order => order.orderStatus), ['확정', '예약', '가예약'])
assert.equal(permittedStatuses.summary.admittedOrderCount, 3)
assert.equal(permittedStatuses.summary.admittedSaleAmount, 1_700_000)
assert.equal(permittedStatuses.summary.admittedEligibleSaleAmount, 1_700_000)
assert.equal(permittedStatuses.summary.admittedExpectedCommission, 34_000)
assert.equal(permittedStatuses.summary.confirmedSaleAmount, 1_000_000)
assert.equal(permittedStatuses.summary.reservedSaleAmount, 500_000)
assert.equal(permittedStatuses.summary.tentativeSaleAmount, 200_000)
assert.equal(permittedStatuses.summary.reviewCustomerCount, 0)

const multiline = tsv(makeRow('example-multiline')).replace('판매경로 1', '"판매경로\n1"').replace('주문확정 여부', '"주문확정\n여부"')
assert.equal(parseSalesRaw(multiline).summary.acceptedOrders, 1)
const escaped = parseSalesRaw(tsv(makeRow('example-quoted', { '주문 구분': '판매\n"주문"' })))
assert.equal(escaped.orders[0].orderCategory, '판매\n"주문"')

const conflicts = parseSalesRaw(tsv(makeRow('example-conflict'), makeRow('example-conflict', { 판매금액: '2,000,000' })))
assert.equal(conflicts.summary.conflictingOrders, 1)
assert.equal(conflicts.orders.length, 0)
assert.ok(conflicts.issues.some(issue => issue.code === 'conflicting-order-reference'))
assert.ok(parseSalesRaw(tsv(makeRow('example-missing', { 주문번호: '' }))).issues.some(issue => issue.code === 'missing-order-reference'))
assert.ok(parseSalesRaw(tsv(makeRow('example-invalid', { 판매금액: '잘못된 금액' }))).issues.some(issue => issue.code === 'invalid-sale-amount'))
assert.ok(parseSalesRaw(tsv(makeRow('example-phone', { 핸드폰번호: '123' }))).issues.some(issue => issue.code === 'invalid-identity'))
assert.ok(parseSalesRaw(tsv('too\tfew')).issues.some(issue => issue.code === 'column-count'))
assert.ok(parseSalesRaw('고객명\t전화번호\n이*호\t2601').issues.some(issue => issue.code === 'missing-columns'))
assert.ok(parseSalesRaw(tsv(makeRow('example-incomplete')).replace('example-incomplete', '"example-incomplete')).issues.some(issue => issue.code === 'unterminated-quote'))
const unknown = parseSalesRaw(tsv(makeRow('example-unknown', { '주문확정 여부': '확인필요', 판매확정일: '2026-02-30' })))
assert.equal(unknown.customers[0].unknownSaleAmount, 1_000_000)
assert.equal(unknown.customers[0].confirmedSaleAmount, 0)
assert.ok(unknown.issues.some(issue => issue.code === 'invalid-date'))
console.log('Sales RAW: quoted TSV, customer identity, duplicate/conflicting orders, exact commission channels, sale amounts, pending statuses, returns, and privacy checks passed.')
