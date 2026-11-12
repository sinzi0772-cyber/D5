import assert from 'node:assert/strict'
import { getCaseBasisReviewDetails } from '../src/lib/caseBasisReview'
import type { Lead } from '../src/types'

const generic = '기준 정보가 다릅니다. 고객 선택 전까지 금액·수수료는 제외됩니다.'
const operational = '판매 금액은 미입력이지만 담당자·상태·배송일 정보가 다릅니다. 기준 고객을 선택해주세요.'
const lead = (id: string, extra: Partial<Lead> = {}): Lead => ({
  id, registeredAt: '2026-10-01', updatedAt: '2026-11-01', customerName: '김**', phoneLast4: '0001',
  gender: '미입력', partnerName: '아이웨딩', appointmentType: '이업종제휴', status: '관리중', visitState: '미정', ...extra,
})
const review = (changes: Partial<Lead>, reason = generic) => getCaseBasisReviewDetails([lead('A'), lead('B', changes)], reason)
assert.deepEqual(review({ manager: '다른 담당자' }, operational).differences, ['담당자'])
assert.deepEqual(review({ status: '상담 마감' }, operational).differences, ['상태'])
assert.deepEqual(review({ deliveryScheduledDate: '2026-12-31' }, operational).differences, ['배송일'])
assert.equal(review({ manager: '다른 담당자', status: '구매완료', deliveryScheduledDate: '2026-12-31' }, operational).summary, '담당자·상태·배송일 다름')
assert.deepEqual(review({ deliveryScheduledDate: '2026-02-30' }).differences, [], 'Malformed dates are unknown, never fabricated valid date differences')
assert.deepEqual(getCaseBasisReviewDetails([lead('A', { status: '구매완료', lumpSumAmount: 100 }), lead('B', { status: '구매완료', lumpSumAmount: 200 })], generic).differences, ['판매금액'], 'A price difference alone does not invent a separate evidence difference')
assert.deepEqual(getCaseBasisReviewDetails([lead('A', { status: '관리중', lumpSumAmount: 100 }), lead('B', { status: '구매완료', lumpSumAmount: 100 })], generic).differences, ['상태'], 'A status difference alone does not invent different source order evidence')

assert(review({ lumpSumAmount: 0 }).differences.includes('판매금액'), 'Missing money remains distinct from an explicit zero')
const normalizedLegacy = [lead('A', { purchaseType: '일시불', purchaseAmount: 100 }), lead('B', { purchaseType: '일시불', lumpSumAmount: 100 })]
assert.deepEqual(getCaseBasisReviewDetails(normalizedLegacy, generic).differences, [], 'Single-method legacy values compare with their normalized direct value')
assert(getCaseBasisReviewDetails([lead('A', { purchaseType: '일시불+구독', purchaseAmount: 100 }), lead('B', { lumpSumAmount: 100 })], generic).differences.includes('판매금액'), 'A combined legacy amount cannot be guessed into one purchase method')
assert.deepEqual(getCaseBasisReviewDetails([lead('A', { managerEmployeeNo: 'QA1', manager: '표시 A' }), lead('B', { managerEmployeeNo: 'QA1', manager: '표시 B' })], generic).differences, [], 'Employee number has the same precedence as the basis signature')
assert.deepEqual(review({ partnerName: '(주)아이패밀리에스씨' }).differences, [], 'Approved company aliases compare canonically')
assert(review({ partnerName: '다른 업체' }).differences.includes('제휴업체'))

const raw = { '2026-10': { period: '2026-10', sourceHash: 'synthetic', importedAt: '2026-11-01',
  orderCount: 1, confirmedOrderCount: 1, reservedOrderCount: 0, confirmedAmount: 100, reservedAmount: 0,
  eligibleConfirmedAmount: 100, eligibleReservedAmount: 0, returnAmount: 0, settlementBasisAmount: 100 } }
const evidenceMembers = [lead('A', { purchaseType: '일시불', lumpSumAmount: 100, salesRawPeriods: raw }), lead('B', { purchaseType: '일시불', lumpSumAmount: 100 })]
const before = JSON.stringify(evidenceMembers)
assert.deepEqual(getCaseBasisReviewDetails(evidenceMembers, generic).differences, ['수수료 근거'], 'Equal entered prices can still carry different verified order evidence')
assert.equal(JSON.stringify(evidenceMembers), before, 'Review never changes source prices, RAW, basis metadata, or original members')

for (const reason of [
  '묶음 고객의 기준 정보가 서로 다릅니다. 기준 고객을 다시 선택해주세요.',
  '선택된 기준 고객을 현재 묶음에서 확인할 수 없습니다. 기준 고객을 다시 선택해주세요.',
  '구매금액 합산 동의 정보가 현재 전체 묶음과 일치하지 않습니다. 다시 선택해주세요.',
  '공유 금액의 원본 기준을 확인할 수 없습니다. 기준 고객을 확인해주세요.',
]) {
  assert.deepEqual(getCaseBasisReviewDetails(evidenceMembers, reason), { month: '2026-10', differences: [], summary: reason.slice(0, reason.indexOf('. ') + 1) }, 'Metadata and roster failures retain their actual first cause instead of inventing a money conflict')
}
assert.equal(getCaseBasisReviewDetails(evidenceMembers, 'RAW 근거는 있지만 구매 금액이 미입력입니다. 기준 고객의 금액을 확인해주세요.').summary, '원본 주문은 있으나 구매금액이 미입력입니다.')
assert.equal(getCaseBasisReviewDetails(evidenceMembers, '묶음 고객 구성을 다시 확인해주세요.').summary, '묶음 고객 구성을 다시 확인해주세요.')
assert.equal(getCaseBasisReviewDetails([lead('A', { registeredAt: '2026-10-02' }), lead('B', { registeredAt: '2026-09-30' })], generic).month, '2026-09')
assert.equal(getCaseBasisReviewDetails([lead('A', { registeredAt: '2026-02-30' })], generic).month, '')
assert.equal(getCaseBasisReviewDetails([], '').summary, '기준 고객 확인 필요')
assert.deepEqual(getCaseBasisReviewDetails([lead('A'), lead('B')], generic).differences, [])
console.log('caseBasisReview: exact differing fields, legacy zero/missing, verified evidence, metadata reasons, receipt month and immutable originals passed')
