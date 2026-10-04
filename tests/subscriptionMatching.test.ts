import assert from 'node:assert/strict'
import { parseSubscriptionRaw } from '../src/lib/subscriptionRaw.ts'
import { buildSubscriptionMatchPlan } from '../src/lib/subscriptionMatching.ts'
import type { Lead } from '../src/types.ts'

const columns = [
  'BEST주문번호', 'BEST주문라인번호', '구매고객명', '전화번호', '주문일자',
  '멤버십혜택기준금액', '주문상태', '판매경로1', '판매경로2',
  '경로판촉증빙승인여부', '계약상태', '물류상태', '취소일자', '해지접수일', '해지완료일',
]
const row = (order: string, line: string, changes: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    BEST주문번호: order, BEST주문라인번호: line, 구매고객명: '가*나', 전화번호: '0001', 주문일자: '2026-09-01',
    멤버십혜택기준금액: '100,000', 주문상태: '주문확정', 판매경로1: '고객인증서비스(웨딩)',
    판매경로2: '웨딩박람회(내부)', 경로판촉증빙승인여부: '', 계약상태: '', 물류상태: '',
    취소일자: '', 해지접수일: '', 해지완료일: '', ...changes,
  }
  return columns.map(column => values[column]).join('\t')
}
const raw = (...rows: string[]) => parseSubscriptionRaw([columns.join('\t'), ...rows].join('\n'), {
  confirmedStatuses: ['주문확정', '마감됨'], reservedStatuses: ['출하대기'], excludedStatuses: ['취소됨'],
})
const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id, registeredAt: '2026-09-01', customerName: '가*나', phoneLast4: '0001', gender: '미입력',
  appointmentType: '이업종제휴',
  partnerName: '업체 A', manager: '담당자', status: '관리중', visitState: '예정', updatedAt: '2026-10-01',
  lumpSumAmount: 80_000, subscriptionAmount: 90_000, note: '수기 메모',
  memoHistory: [{ id: 'manual', date: '2026-09-30', manager: '담당자', content: '보존' }], ...changes,
})

const existing = lead('one')
const before = JSON.stringify(existing)
const statuses = buildSubscriptionMatchPlan(raw(
  row('order-a', '1'),
  row('order-a', '2', { 주문상태: '마감됨', 멤버십혜택기준금액: '200,000', 계약상태: '정상', 물류상태: '인수' }),
  row('order-b', '1', { 주문상태: '출하대기', 멤버십혜택기준금액: '300,000' }),
  row('order-c', '1', { 주문상태: '취소됨', 멤버십혜택기준금액: '900,000', 취소일자: '2026-09-02' }),
), [existing])
assert.equal(statuses.matched.length, 1)
assert.equal(statuses.matched[0].leadId, 'one')
assert.equal(statuses.matched[0].partnerName, '업체 A')
assert.equal(statuses.matched[0].amounts.itemCount, 3)
assert.equal(statuses.matched[0].amounts.orderCount, 2)
assert.equal(statuses.matched[0].amounts.basisAmount, 600_000)
assert.equal(statuses.matched[0].amounts.confirmedBasisAmount, 300_000)
assert.equal(statuses.matched[0].amounts.pendingBasisAmount, 300_000)
assert.equal(statuses.matched[0].amounts.eligibleBasisAmount, 600_000)
assert.equal(statuses.matched[0].amounts.excludedBasisAmount, 900_000)
assert.equal(JSON.stringify(existing), before, 'Existing finances, status, manager and manual history remain untouched')

const exact = buildSubscriptionMatchPlan(raw(row('joint-identity', '1')), [
  lead('phone-only', { customerName: '다*라' }), lead('name-only', { phoneLast4: '0002' }),
])
assert.equal(exact.unmatched.length, 1)
assert.equal(exact.matched.length, 0)
assert.equal(exact.summary.held.basisAmount, 100_000)
assert.equal(exact.summary.matched.basisAmount, 0)

const noAppointment = buildSubscriptionMatchPlan(raw(row('no-appointment', '1')), [])
assert.equal(noAppointment.matched.length, 0, 'An eligible RAW sales route alone is not evidence of a partner referral')
assert.equal(noAppointment.unmatched.length, 1)
assert.equal(noAppointment.unmatched[0].leadId, undefined)
assert.equal(noAppointment.unmatched[0].partnerName, undefined)
assert.equal(noAppointment.summary.matched.basisAmount, 0)
assert.equal(noAppointment.summary.matched.eligibleBasisAmount, 0, 'Unmatched subscriptions must not enter referral commission totals')

for (const appointmentType of ['이업종제휴', '상담예약(이업종)'] as const) {
  const manual = lead(`manual-${appointmentType}`, { appointmentType, appointmentSourceId: undefined })
  const manualBefore = JSON.stringify(manual)
  const eligibleAppointment = buildSubscriptionMatchPlan(raw(row(`type-${appointmentType}`, '1')), [manual])
  assert.equal(eligibleAppointment.matched.length, 1, 'Both explicit partner types also qualify for manual appointments')
  assert.equal(eligibleAppointment.summary.matched.basisAmount, 100_000)
  assert.equal(JSON.stringify(manual), manualBefore, 'Matching never fills in a manual source identifier')
}
for (const appointmentType of [undefined, '미선택', '일반상담', '상담예약 (이업종)']) {
  const nonPartner = lead('non-partner', { appointmentType: appointmentType as Lead['appointmentType'] })
  const nonPartnerBefore = JSON.stringify(nonPartner)
  const excludedAppointment = buildSubscriptionMatchPlan(raw(row('not-partner', '1')), [nonPartner])
  assert.equal(excludedAppointment.excluded.length, 1, String(appointmentType))
  assert.equal(excludedAppointment.matched.length, 0)
  assert.equal(excludedAppointment.excluded[0].leadId, undefined)
  assert.equal(excludedAppointment.excluded[0].partnerName, undefined)
  assert.ok(excludedAppointment.excluded[0].reasons.includes(appointmentType === undefined ? 'missing-appointment-type' : 'non-partner-appointment-type'))
  assert.equal(excludedAppointment.summary.matched.basisAmount, 0)
  assert.equal(excludedAppointment.summary.matched.eligibleBasisAmount, 0)
  assert.equal(JSON.stringify(nonPartner), nonPartnerBefore, 'Excluded appointment data remains untouched')
}
const mixedAppointmentTypes = buildSubscriptionMatchPlan(raw(row('mixed-appointment-types', '1')), [existing, lead('general-duplicate', { appointmentType: '미선택' })])
assert.equal(mixedAppointmentTypes.ambiguous.length, 1, 'A valid type must not silently select one of duplicate customer records')
assert.equal(mixedAppointmentTypes.matched.length, 0)

const normalized = buildSubscriptionMatchPlan(raw(row('normalized', '1', {
  구매고객명: ' 가 ＊ 나 ', 전화번호: '000-0000-0001',
})), [existing])
assert.equal(normalized.matched.length, 1)

const samePartner = buildSubscriptionMatchPlan(raw(row('duplicate-appointment', '1')), [existing, lead('second')])
assert.equal(samePartner.ambiguous.length, 1)
assert.ok(samePartner.ambiguous[0].reasons.includes('duplicate-appointments-same-partner'))
assert.equal(samePartner.ambiguous[0].leadId, undefined)
const differentPartner = buildSubscriptionMatchPlan(raw(row('duplicate-partner', '1')), [existing, lead('second', { partnerName: '업체 B' })])
assert.ok(differentPartner.ambiguous[0].reasons.includes('duplicate-appointments-different-partners'))
const repeatedView = buildSubscriptionMatchPlan(raw(row('one-document', '1')), [existing, existing])
assert.equal(repeatedView.matched.length, 1)
const invalidExisting = buildSubscriptionMatchPlan(raw(row('invalid-existing', '1')), [lead('invalid', { phoneLast4: '123' })])
assert.equal(invalidExisting.summary.existingInvalidIdentityCount, 1)
assert.equal(invalidExisting.unmatched.length, 1)

const missingComponent = buildSubscriptionMatchPlan(raw(
  row('set', '1', { 멤버십혜택기준금액: '250,000' }),
  row('set', '2', { 멤버십혜택기준금액: '' }),
), [existing])
assert.equal(missingComponent.matched.length, 1)
assert.equal(missingComponent.matched[0].amounts.basisAmount, 250_000)
assert.equal(missingComponent.matched[0].amounts.knownBasisItems, 1)
assert.equal(missingComponent.matched[0].amounts.missingBasisItems, 1)
assert.equal(missingComponent.matched[0].amounts.itemCount, 2)
assert.equal(missingComponent.matched[0].amounts.orderCount, 1)
assert.ok(missingComponent.matched[0].reasons.includes('missing-basis-items'))
const missingAll = buildSubscriptionMatchPlan(raw(row('missing-all', '1', { 멤버십혜택기준금액: '' })), [existing])
assert.equal(missingAll.review.length, 1)
assert.ok(missingAll.review[0].reasons.includes('missing-all-basis-amounts'))
const explicitZero = buildSubscriptionMatchPlan(raw(row('explicit-zero', '1', { 멤버십혜택기준금액: '0' })), [existing])
assert.equal(explicitZero.matched.length, 1)
assert.equal(explicitZero.matched[0].amounts.knownBasisItems, 1)

const rejected = buildSubscriptionMatchPlan(raw(
  row('accepted', '1'),
  row('rejected', '1', { 멤버십혜택기준금액: '500,000', 경로판촉증빙승인여부: '반려' }),
  row('not-eligible', '1', { 멤버십혜택기준금액: '400,000', 판매경로2: '다른 경로' }),
), [existing])
assert.equal(rejected.matched[0].amounts.basisAmount, 1_000_000)
assert.equal(rejected.matched[0].amounts.eligibleBasisAmount, 600_000)
assert.equal(rejected.matched[0].amounts.rejectedItemCount, 1)
assert.equal(rejected.matched[0].amounts.rejectedBasisAmount, 500_000)
assert.ok(rejected.matched[0].reasons.includes('rejected-proof-items-included'))
assert.ok(rejected.matched[0].reasons.includes('ineligible-channel-items-excluded'))

const rejectedOnlySale = buildSubscriptionMatchPlan(raw(row('rejected-only', '1', { 경로판촉증빙승인여부: '반려' })), [existing])
assert.equal(rejectedOnlySale.matched.length, 1, 'Rejected promotion proof does not block an exactly matched sale')
assert.equal(rejectedOnlySale.matched[0].amounts.confirmedBasisAmount, 100_000, 'Actual sales completion uses sale basis, not commission approval')
assert.equal(rejectedOnlySale.matched[0].amounts.eligibleBasisAmount, 100_000, 'Rejected proof is included for an eligible route')
assert.equal(rejectedOnlySale.matched[0].amounts.rejectedItemCount, 1)
const rejectedPendingSale = buildSubscriptionMatchPlan(raw(row('rejected-pending', '1', { 경로판촉증빙승인여부: '반려', 주문상태: '출하대기' })), [existing])
assert.equal(rejectedPendingSale.matched[0].amounts.eligiblePendingBasisAmount, 100_000)
const rejectedUnmatched = buildSubscriptionMatchPlan(raw(row('rejected-unmatched', '1', { 경로판촉증빙승인여부: '반려' })), [])
assert.equal(rejectedUnmatched.unmatched.length, 1)
assert.equal(rejectedUnmatched.summary.matched.eligibleBasisAmount, 0, 'Unmatched rejected sales remain excluded')
const rejectedDuplicate = buildSubscriptionMatchPlan(raw(row('rejected-duplicate', '1', { 경로판촉증빙승인여부: '반려' })), [existing, lead('duplicate')])
assert.equal(rejectedDuplicate.ambiguous.length, 1)
assert.equal(rejectedDuplicate.summary.matched.eligibleBasisAmount, 0, 'Rejected proof cannot bypass duplicate appointment checks')
const staleRejectedFlags = raw(row('rejected-old-flags', '1', { 경로판촉증빙승인여부: '반려' }))
staleRejectedFlags.items[0].commissionChannelEligible = false
assert.equal(buildSubscriptionMatchPlan(staleRejectedFlags, [existing]).matched[0].amounts.eligibleBasisAmount, 100_000, 'The current route policy overrides an old approval-only parser flag')
const rejectedCanceledSale = buildSubscriptionMatchPlan(raw(row('rejected-canceled', '1', { 경로판촉증빙승인여부: '반려', 주문상태: '취소됨', 취소일자: '2026-09-02' })), [existing])
assert.equal(rejectedCanceledSale.matched.length, 0, 'An actual canceled sale must remain excluded, even when proof is rejected')
assert.equal(rejectedCanceledSale.excluded.length, 1)
assert.equal(rejectedCanceledSale.summary.matched.confirmedBasisAmount, 0)

const canceledOnly = buildSubscriptionMatchPlan(raw(row('canceled', '1', { 주문상태: '취소됨', 취소일자: '2026-09-02' })), [existing])
assert.equal(canceledOnly.excluded.length, 1)
assert.equal(canceledOnly.summary.admittedCustomerCount, 0)
assert.equal(canceledOnly.summary.matched.basisAmount, 0)
const inconsistentCancel = buildSubscriptionMatchPlan(raw(row('cancel-date', '1', { 취소일자: '2026-09-02' })), [existing])
assert.equal(inconsistentCancel.excluded.length, 1)

const malformed = buildSubscriptionMatchPlan(raw(
  row('good', '1'), row('malformed', '1', { 멤버십혜택기준금액: 'not-a-price' }),
), [existing])
assert.equal(malformed.review.length, 1)
assert.equal(malformed.matched.length, 0)
const unknown = buildSubscriptionMatchPlan(raw(row('unknown', '1', { 주문상태: '확인중' })), [existing])
assert.equal(unknown.review.length, 1)
const termination = buildSubscriptionMatchPlan(raw(row('termination', '1', { 해지접수일: '2026-09-03' })), [existing])
assert.equal(termination.review.length, 1)
const badDate = buildSubscriptionMatchPlan(raw(row('bad-date', '1', { 주문일자: 'not-a-date' })), [existing])
assert.equal(badDate.review.length, 1)

const duplicateLine = buildSubscriptionMatchPlan(raw(row('same', '1'), row('same', '1')), [existing])
assert.equal(duplicateLine.matched[0].amounts.itemCount, 1)
assert.equal(duplicateLine.matched[0].amounts.basisAmount, 100_000)
const twoProductLines = buildSubscriptionMatchPlan(raw(row('same-order', '1'), row('same-order', '2')), [existing])
assert.equal(twoProductLines.matched[0].amounts.itemCount, 2)
assert.equal(twoProductLines.matched[0].amounts.orderCount, 1)
assert.equal(twoProductLines.matched[0].amounts.basisAmount, 200_000)
const conflict = buildSubscriptionMatchPlan(raw(
  row('conflict', '1'), row('conflict', '1', { 멤버십혜택기준금액: '500,000' }), row('other', '1'),
), [existing])
assert.equal(conflict.review.length, 1)
assert.equal(conflict.matched.length, 0, 'One conflicted product line holds the whole customer')

console.log('subscriptionMatching: exact identities, known product bases, excluded cancellations, evidence rejection and immutable records passed')
