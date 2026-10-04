import assert from 'node:assert/strict'
import { parseSalesRaw } from '../src/lib/salesRaw.ts'
import { buildSalesMatchPlan } from '../src/lib/salesMatching.ts'
import type { Lead } from '../src/types.ts'

const columns = ['주문번호', '고객명', '핸드폰번호', '판매금액', '결제금액', '주문확정여부', '판매경로1', '판매경로2', '원주문번호', '주문구분']
const row = (reference: string, changes: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    주문번호: reference, 고객명: '가*나', 핸드폰번호: '0001', 판매금액: '100,000', 결제금액: '20,000',
    주문확정여부: '주문확정', 판매경로1: '고객인증서비스(웨딩)', 판매경로2: '웨딩박람회(내부)',
    원주문번호: '', 주문구분: '판매주문', ...changes,
  }
  return columns.map(column => values[column]).join('\t')
}
const raw = (...rows: string[]) => parseSalesRaw([columns.join('\t'), ...rows].join('\n'))
const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id, registeredAt: '2026-09-01', customerName: '가*나', phoneLast4: '0001', gender: '미입력',
  appointmentType: '이업종제휴',
  partnerName: '업체 A', manager: '담당자', status: '관리중', visitState: '예정', updatedAt: '2026-10-01',
  note: '수기 메모', memoHistory: [{ id: 'manual', date: '2026-09-30', manager: '담당자', content: '보존' }], ...changes,
})

const originalLead = lead('one')
const originalJson = JSON.stringify(originalLead)
const admitted = buildSalesMatchPlan(raw(
  row('confirmed'),
  row('reserved', { 주문확정여부: '예약', 판매금액: '250,000' }),
  row('tentative', { 주문확정여부: '가예약', 판매금액: '900,000' }),
), [originalLead])
assert.equal(admitted.matched.length, 1)
assert.equal(admitted.matched[0].leadId, 'one')
assert.equal(admitted.matched[0].partnerName, '업체 A')
assert.equal(admitted.matched[0].amounts.saleAmount, 1_250_000)
assert.equal(admitted.matched[0].amounts.confirmedSaleAmount, 100_000)
assert.equal(admitted.matched[0].amounts.reservedSaleAmount, 250_000)
assert.equal(admitted.matched[0].amounts.tentativeSaleAmount, 900_000)
assert.equal(admitted.matched[0].amounts.tentativeEligibleSaleAmount, 900_000)
assert.equal(admitted.matched[0].amounts.tentativeOrderCount, 1)
assert.equal(admitted.matched[0].amounts.tentativeExpectedCommission, 18_000)
assert.equal(admitted.matched[0].amounts.expectedCommission, 25_000)
assert.equal(admitted.matched[0].admittedOrders.length, 3)
assert.deepEqual(admitted.matched[0].admittedOrders.map(order => order.orderStatus), ['확정', '예약', '가예약'])
assert.deepEqual(admitted.matched[0].reasons, [])
assert.equal(JSON.stringify(originalLead), originalJson, 'Existing manual fields are never mutated')

const exact = buildSalesMatchPlan(raw(row('identity')), [
  lead('phone-only', { customerName: '다*라' }), lead('name-only', { phoneLast4: '0002' }),
])
assert.equal(exact.unmatched.length, 1)
assert.deepEqual(exact.unmatched[0].candidateLeadIds, [])
assert.equal(exact.summary.matched.saleAmount, 0)
assert.equal(exact.summary.held.saleAmount, 100_000)

const noAppointment = buildSalesMatchPlan(raw(row('no-appointment')), [])
assert.equal(noAppointment.matched.length, 0, 'An eligible RAW sales route alone is not evidence of a partner referral')
assert.equal(noAppointment.unmatched.length, 1)
assert.equal(noAppointment.unmatched[0].leadId, undefined)
assert.equal(noAppointment.unmatched[0].partnerName, undefined)
assert.equal(noAppointment.summary.matched.saleAmount, 0)
assert.equal(noAppointment.summary.matched.expectedCommission, 0, 'Unmatched sales must not enter referral commission totals')

for (const appointmentType of ['이업종제휴', '상담예약(이업종)'] as const) {
  const manual = lead(`manual-${appointmentType}`, { appointmentType, appointmentSourceId: undefined })
  const manualBefore = JSON.stringify(manual)
  const eligibleAppointment = buildSalesMatchPlan(raw(row(`type-${appointmentType}`)), [manual])
  assert.equal(eligibleAppointment.matched.length, 1, 'Both explicit partner types also qualify for manual appointments')
  assert.equal(eligibleAppointment.summary.matched.saleAmount, 100_000)
  assert.equal(JSON.stringify(manual), manualBefore, 'Matching never fills in a manual source identifier')
}
for (const appointmentType of [undefined, '미선택', '일반상담', '상담예약 (이업종)']) {
  const nonPartner = lead('non-partner', { appointmentType: appointmentType as Lead['appointmentType'] })
  const nonPartnerBefore = JSON.stringify(nonPartner)
  const excludedAppointment = buildSalesMatchPlan(raw(row('not-partner')), [nonPartner])
  assert.equal(excludedAppointment.excluded.length, 1, String(appointmentType))
  assert.equal(excludedAppointment.matched.length, 0)
  assert.equal(excludedAppointment.excluded[0].leadId, undefined)
  assert.equal(excludedAppointment.excluded[0].partnerName, undefined)
  assert.ok(excludedAppointment.excluded[0].reasons.includes(appointmentType === undefined ? 'missing-appointment-type' : 'non-partner-appointment-type'))
  assert.equal(excludedAppointment.summary.matched.saleAmount, 0)
  assert.equal(excludedAppointment.summary.matched.expectedCommission, 0)
  assert.equal(JSON.stringify(nonPartner), nonPartnerBefore, 'Excluded appointment data remains untouched')
}
const mixedAppointmentTypes = buildSalesMatchPlan(raw(row('mixed-appointment-types')), [originalLead, lead('general-duplicate', { appointmentType: '미선택' })])
assert.equal(mixedAppointmentTypes.ambiguous.length, 1, 'A valid type must not silently select one of duplicate customer records')
assert.equal(mixedAppointmentTypes.matched.length, 0)

const normalization = buildSalesMatchPlan(raw(row('normalized', { 고객명: ' 가 ＊ 나 ', 핸드폰번호: '000-0000-0001' })), [originalLead])
assert.equal(normalization.matched.length, 1)

const samePartner = buildSalesMatchPlan(raw(row('same-partner')), [originalLead, lead('second')])
assert.equal(samePartner.ambiguous.length, 1)
assert.ok(samePartner.ambiguous[0].reasons.includes('duplicate-appointments-same-partner'))
assert.equal(samePartner.matched.length, 0)
assert.equal(samePartner.ambiguous[0].leadId, undefined)
const differentPartner = buildSalesMatchPlan(raw(row('different-partner')), [originalLead, lead('second', { partnerName: '업체 B' })])
assert.ok(differentPartner.ambiguous[0].reasons.includes('duplicate-appointments-different-partners'))
assert.deepEqual(differentPartner.ambiguous[0].candidatePartnerNames, ['업체 A', '업체 B'])

const repeatedView = buildSalesMatchPlan(raw(row('repeated-view')), [originalLead, originalLead])
assert.equal(repeatedView.matched.length, 1)
const invalidExisting = buildSalesMatchPlan(raw(row('invalid-existing')), [lead('invalid', { phoneLast4: '123' })])
assert.equal(invalidExisting.summary.existingInvalidIdentityCount, 1)
assert.equal(invalidExisting.unmatched.length, 1)

const tentativeOnly = buildSalesMatchPlan(raw(row('tentative-only', { 주문확정여부: '가예약' })), [originalLead])
assert.equal(tentativeOnly.matched.length, 1)
assert.equal(tentativeOnly.summary.admittedCustomerCount, 1)
assert.equal(tentativeOnly.summary.admitted.saleAmount, 100_000)
assert.equal(tentativeOnly.summary.matched.tentativeSaleAmount, 100_000)
const unknownOnly = buildSalesMatchPlan(raw(row('unknown-only', { 주문확정여부: '확인중' })), [originalLead])
assert.equal(unknownOnly.review.length, 1)
const mixedUnknown = buildSalesMatchPlan(raw(row('known'), row('unknown', { 주문확정여부: '확인중' })), [originalLead])
assert.equal(mixedUnknown.review.length, 1)
assert.equal(mixedUnknown.matched.length, 0, 'A partially known customer must not be automatically finalized')
assert.equal(mixedUnknown.review[0].amounts.saleAmount, 100_000)
assert.ok(mixedUnknown.review[0].reasons.includes('unknown-status-orders-excluded'))

const ineligible = buildSalesMatchPlan(raw(row('ineligible', { 판매경로2: '다른 경로' })), [originalLead])
assert.equal(ineligible.matched[0].amounts.saleAmount, 100_000)
assert.equal(ineligible.matched[0].amounts.eligibleSaleAmount, 0)
assert.equal(ineligible.matched[0].amounts.expectedCommission, 0)

const validReturn = buildSalesMatchPlan(raw(
  row('original'), row('refund', { 판매금액: '-25,000', 주문구분: '반품주문', 원주문번호: 'original' }),
), [originalLead])
assert.equal(validReturn.matched.length, 1)
assert.equal(validReturn.matched[0].amounts.saleAmount, 75_000)
assert.equal(validReturn.matched[0].amounts.expectedCommission, 1_500)
assert.equal(validReturn.matched[0].amounts.returnSaleAmount, -25_000)

const missingOriginal = buildSalesMatchPlan(raw(row('missing-original', { 판매금액: '-25,000', 주문구분: '반품주문', 원주문번호: 'absent' })), [originalLead])
assert.equal(missingOriginal.review.length, 1)
assert.ok(missingOriginal.review[0].reasons.includes('return-original-order-missing'))
assert.equal(missingOriginal.matched.length, 0)
const tentativeOriginal = buildSalesMatchPlan(raw(
  row('tentative-original', { 주문확정여부: '가예약' }), row('refund', { 판매금액: '-25,000', 원주문번호: 'tentative-original' }),
), [originalLead])
assert.equal(tentativeOriginal.matched.length, 1)
assert.equal(tentativeOriginal.matched[0].amounts.saleAmount, 75_000)
assert.equal(tentativeOriginal.matched[0].amounts.tentativeSaleAmount, 100_000)
assert.equal(tentativeOriginal.matched[0].amounts.confirmedSaleAmount, -25_000)
assert.equal(tentativeOriginal.matched[0].amounts.expectedCommission, 1_500)
assert.deepEqual(tentativeOriginal.matched[0].reasons, [])
const otherIdentityOriginal = buildSalesMatchPlan(raw(
  row('other-person', { 고객명: '다*라', 핸드폰번호: '0002' }), row('refund', { 판매금액: '-25,000', 원주문번호: 'other-person' }),
), [originalLead])
assert.equal(otherIdentityOriginal.review.length, 1)
const routeMismatch = buildSalesMatchPlan(raw(
  row('original'), row('refund', { 판매금액: '-25,000', 원주문번호: 'original', 판매경로2: '웨딩업체연결(수수료지급)' }),
), [originalLead])
assert.equal(routeMismatch.review.length, 1)
assert.ok(routeMismatch.review[0].reasons.includes('return-route-mismatch'))
const positiveReturn = buildSalesMatchPlan(raw(
  row('original'), row('refund', { 판매금액: '25,000', 주문구분: '반품주문', 원주문번호: 'original' }),
), [originalLead])
assert.equal(positiveReturn.review.length, 1)
assert.ok(positiveReturn.review[0].reasons.includes('return-amount-not-negative'))
const excessReturn = buildSalesMatchPlan(raw(
  row('original'), row('refund-one', { 판매금액: '-75,000', 원주문번호: 'original' }),
  row('refund-two', { 판매금액: '-50,000', 원주문번호: 'original' }),
), [originalLead])
assert.equal(excessReturn.review.length, 1)
assert.ok(excessReturn.review[0].reasons.includes('return-exceeds-original-amount'))
assert.ok(excessReturn.review[0].reasons.includes('negative-customer-total'))

const noDuplicateOrder = buildSalesMatchPlan(raw(row('repeat-order'), row('repeat-order')), [originalLead])
assert.equal(noDuplicateOrder.matched[0].amounts.orderCount, 1)
assert.equal(noDuplicateOrder.matched[0].amounts.saleAmount, 100_000)

console.log('salesMatching: exact identities, appointment ambiguity, admitted statuses, returns and immutable records passed')
