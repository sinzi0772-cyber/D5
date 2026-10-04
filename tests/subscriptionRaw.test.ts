import assert from 'node:assert/strict'
import { parseSubscriptionRaw } from '../src/lib/subscriptionRaw.ts'

const headers = ['구매 고객명', '전화번호', '주문일자', '수량', '멤버십혜택 기준금액', '출하가', '주문상태', '계약상태', '취소일자', '해지접수일', '해지완료일', 'BEST 주문번호', 'BEST주문 라인번호', 'LGE 주문번호', 'LGE주문 라인번호', '판매경로1', '판매경로2', '경로판촉증빙 승인여부', '인수자명', '기본주소']
const escape = (value: string) => /["\t\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
const row = (order: string, line: string, changes: Partial<Record<string, string>> = {}) => headers.map(name => escape(({
  '구매 고객명': '이준호', 전화번호: '010-0000-2601', 주문일자: '2026-09-10', 수량: '1',
  '멤버십혜택 기준금액': '1,000,000', 출하가: '9,000,000', 주문상태: '주문확정', 계약상태: '', 취소일자: '', 해지접수일: '', 해지완료일: '',
  'BEST 주문번호': order, 'BEST주문 라인번호': line, 'LGE 주문번호': '', 'LGE주문 라인번호': '',
  판매경로1: '고객인증서비스(웨딩)', 판매경로2: '웨딩박람회(내부)', '경로판촉증빙 승인여부': '', 인수자명: '원본수신자', 기본주소: '원본주소', ...changes,
} as Record<string, string>)[name] || '')).join('\t')
const tsv = (...rows: string[]) => `${headers.map(escape).join('\t')}\r\n${rows.join('\r\n')}\r\n`
const options = { confirmedStatuses: ['주문확정', '마감됨'], reservedStatuses: ['출하대기'], excludedStatuses: ['취소됨'] }

const duplicate = row('sample-order', '1')
const parsed = parseSubscriptionRaw(tsv(
  duplicate, duplicate,
  row('sample-order', '2', { '멤버십혜택 기준금액': '500,000', 수량: '2' }),
  row('sample-closed', '1', { 주문상태: '마감됨', '멤버십혜택 기준금액': '200,000' }),
  row('sample-pending', '1', { 주문상태: '출하대기', '멤버십혜택 기준금액': '100,000' }),
  row('sample-canceled', '1', { 주문상태: '취소됨', '멤버십혜택 기준금액': '' }),
  row('sample-accessory', '1', { '멤버십혜택 기준금액': '' }),
), options)
assert.equal(parsed.summary.inputRows, 7)
assert.equal(parsed.summary.acceptedItems, 6)
assert.equal(parsed.summary.duplicateItemRows, 1)
assert.equal(parsed.summary.confirmedItems, 3)
assert.equal(parsed.summary.reservedItems, 1)
assert.equal(parsed.summary.excludedItems, 1)
assert.equal(parsed.summary.reviewItems, 1)
assert.equal(parsed.summary.admittedBasisAmount, 1_800_000)
assert.equal(parsed.summary.confirmedBasisAmount, 1_700_000)
assert.equal(parsed.summary.reservedBasisAmount, 100_000)
assert.equal(parsed.summary.admittedOrderCount, 3)
assert.equal(parsed.summary.includedMissingBasisItems, 1)
assert.equal(parsed.summary.includedInvalidBasisItems, 0)
assert.equal(parsed.customers[0].identityKey, '이*호|2601')
assert.equal(parsed.customers[0].hasBlockingIssue, false)
assert.equal(parsed.items.find(item => item.itemReference.endsWith('|2'))?.membershipBenefitBasisAmount, 500_000)
assert.equal(parsed.items.find(item => item.orderReference === 'sample-accessory')?.membershipBenefitBasisAmount, null)
for (const privateValue of ['이준호', '010-0000-2601', '원본수신자', '원본주소', '9,000,000']) assert.equal(JSON.stringify(parsed).includes(privateValue), false)

const conservative = parseSubscriptionRaw(tsv(row('sample-closed', '1', { 주문상태: '마감됨' }), row('sample-pending', '1', { 주문상태: '출하대기' })))
assert.equal(conservative.summary.admittedBasisAmount, 0)
assert.equal(conservative.summary.reviewItems, 2)
assert.equal(parseSubscriptionRaw(tsv(row('sample-closed', '1', { 주문상태: '마감됨' }), row('sample-pending', '1', { 주문상태: '출하대기' })), { includedStatuses: ['마감됨', '출하대기'] }).summary.admittedBasisAmount, 2_000_000)

const rejected = parseSubscriptionRaw(tsv(row('sample-rejected', '1', { '경로판촉증빙 승인여부': '반려' })), options)
assert.equal(rejected.summary.admittedBasisAmount, 1_000_000)
assert.equal(rejected.summary.admittedChannelEligibleBasisAmount, 1_000_000)
assert.equal(rejected.summary.rejectedEvidenceItems, 1)
assert.equal(rejected.items[0].commissionChannelEligible, true)
const rejectedWrongRoute = parseSubscriptionRaw(tsv(row('sample-rejected-wrong-route', '1', { '경로판촉증빙 승인여부': '반려', 판매경로2: '일반판매' })), options)
assert.equal(rejectedWrongRoute.summary.admittedChannelEligibleBasisAmount, 0, 'Including rejected proof must not admit an ineligible route')

const conflicts = parseSubscriptionRaw(tsv(row('sample-conflict', '1'), row('sample-conflict', '1', { '멤버십혜택 기준금액': '2,000,000' }), row('sample-valid', '1')), options)
assert.equal(conflicts.summary.conflictingItems, 1)
assert.equal(conflicts.summary.admittedBasisAmount, 1_000_000)
assert.equal(conflicts.customers[0].hasBlockingIssue, true)
assert.ok(conflicts.issues.some(issue => issue.code === 'conflicting-item-reference'))

const wrongName = parseSubscriptionRaw(tsv(row('sample-person-a', '1'), row('sample-person-b', '1', { '구매 고객명': '김민호' })), options)
assert.equal(wrongName.summary.customerCount, 2)
const wrongPhone = parseSubscriptionRaw(tsv(row('sample-person-a', '1'), row('sample-person-b', '1', { 전화번호: '2602' })), options)
assert.equal(wrongPhone.summary.customerCount, 2)

const invalid = parseSubscriptionRaw(tsv(row('sample-invalid', '1', { '멤버십혜택 기준금액': '-100' })), options)
assert.equal(invalid.summary.admittedBasisAmount, 0)
assert.equal(invalid.summary.includedInvalidBasisItems, 1)
assert.equal(invalid.customers[0].hasBlockingIssue, true)
assert.ok(invalid.issues.some(issue => issue.code === 'invalid-basis-amount'))
assert.ok(parseSubscriptionRaw(tsv(row('sample-phone', '1', { 전화번호: '12' })), options).issues.some(issue => issue.code === 'invalid-identity'))
assert.ok(parseSubscriptionRaw(tsv(row('', '')), options).issues.some(issue => issue.code === 'missing-item-reference'))
assert.ok(parseSubscriptionRaw(tsv(row('sample-date', '1', { 주문일자: '2026-02-30' })), options).items[0].hasBlockingIssue)
assert.equal(parseSubscriptionRaw(tsv(row('sample-cancel-date', '1', { 취소일자: '2026-09-12' })), options).summary.admittedBasisAmount, 0)
assert.equal(parseSubscriptionRaw(tsv(row('sample-terminate', '1', { 계약상태: '해지완료' })), options).summary.admittedBasisAmount, 0)
assert.equal(parseSubscriptionRaw(tsv(row('sample-termination-pending', '1', { 해지접수일: '2026-09-12' })), options).items[0].hasBlockingIssue, true)

const fallback = parseSubscriptionRaw(tsv(row('', '', { 'LGE 주문번호': 'sample-lge', 'LGE주문 라인번호': '1' })), options)
assert.equal(fallback.summary.acceptedItems, 1)
assert.equal(fallback.items[0].itemReference, '1:sample-lge|1')
const multiline = tsv(row('sample-multiline', '1')).replace('멤버십혜택 기준금액', '"멤버십혜택\n기준금액"')
assert.equal(parseSubscriptionRaw(multiline, options).summary.admittedBasisAmount, 1_000_000)
assert.ok(parseSubscriptionRaw('구매 고객명\t전화번호\n이*호\t2601').issues.some(issue => issue.code === 'missing-columns'))
assert.ok(parseSubscriptionRaw(tsv('too\tfew')).issues.some(issue => issue.code === 'column-count'))
console.log('Subscription RAW: product-line deduplication, membership basis, explicit status policy, cancellation/rejected evidence, missing amounts, matching identities, and privacy checks passed.')
