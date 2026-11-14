import assert from 'node:assert/strict'
import { buildPartnerPreview, canPreviewPartner } from '../src/lib/partnerPreview.ts'
import { expectedRebateFor } from '../src/lib/salesFinance.ts'
import type { Lead } from '../src/types.ts'

const lead = (id: string, changes: Partial<Lead> = {}): Lead => {
  const value: Lead = {
  id, customerName: '김준수', phoneLast4: '01012340252', gender: '남',
  registeredAt: '2026-09-04', updatedAt: '2026-10-07',
  partnerName: '(주)다이렉트컴즈', appointmentType: '이업종제휴',
  status: '구매완료', visitState: '방문', purchaseType: '일시불+구독',
  lumpSumAmount: 20864000, subscriptionAmount: 1891000,
  manager: '비공개 담당자', managerEmployeeNo: '12345',
  plannerName: '비공개 플래너', note: '비공개 메모',
  memoHistory: [{ id: 'memo', date: '2026-09-06', manager: '비공개 담당자', content: '비공개 상담내용' }],
  ...changes,
  }
  // Privacy, category and month tests use purchases with verified RAW settlement basis.
  return { ...value,
    salesRawPeriods: value.lumpSumAmount === undefined ? undefined : { '2026-09': {
      period: '2026-09', sourceHash: 'verified-lump-sum-fixture', importedAt: '2026-10-07',
      orderCount: 1, confirmedOrderCount: 1, reservedOrderCount: 0,
      confirmedAmount: value.lumpSumAmount, reservedAmount: 0, settlementBasisAmount: value.lumpSumAmount,
      eligibleConfirmedAmount: value.lumpSumAmount, eligibleReservedAmount: 0, returnAmount: 0,
    } },
    subscriptionRawPeriods: value.subscriptionAmount === undefined ? undefined : { '2026-09': {
      period: '2026-09', sourceHash: 'verified-subscription-fixture', importedAt: '2026-10-07',
      itemCount: 1, confirmedItemCount: 1, pendingItemCount: 0,
      confirmedBasisAmount: value.subscriptionAmount, pendingBasisAmount: 0, settlementBasisAmount: value.subscriptionAmount,
      eligibleConfirmedBasisAmount: value.subscriptionAmount, eligiblePendingBasisAmount: 0,
      includedStatuses: ['마감됨'], missingBasisItemCount: 0, rejectedProofItemCount: 0,
    } },
  }
}

for (const role of ['admin', 'store_manager', 'assistant_manager', 'manager']) assert.equal(canPreviewPartner(role), true)
for (const role of [null, undefined, {}, 1, 'partner', 'demo_admin', '', 'ADMIN', ' admin ']) assert.equal(canPreviewPartner(role), false)

const rows = Object.freeze([
  Object.freeze(lead('source-김준수-01012340252', { deliveryScheduledDate: '2026-09-30', caseGroupId: 'same-case', caseBasisLeadId: 'source-김준수-01012340252' })),
  Object.freeze(lead('other-member', { registeredAt: '2026-10-01', partnerName: '(주)아이패밀리에스씨', caseGroupId: 'same-case', caseBasisLeadId: 'source-김준수-01012340252', deliveryScheduledDate: '2026-12-31' })),
  Object.freeze(lead('unplanned', { customerName: '박영희', phoneLast4: '5555', lumpSumAmount: 1000000, subscriptionAmount: 0 })),
  Object.freeze(lead('active', { status: '관리중', customerName: '이도연', phoneLast4: '6666', deliveryScheduledDate: '2026-09-10' })),
  Object.freeze(lead('other-company', { partnerName: '다른 업체', customerName: '배선영', phoneLast4: '7777', deliveryScheduledDate: '2026-09-15' })),
  Object.freeze(lead('october', { registeredAt: '2026-10-02', phoneLast4: '8888', deliveryScheduledDate: '2026-10-10' })),
])
const before = JSON.stringify(rows)
const direct = buildPartnerPreview(rows, '(주)다이렉트컴즈', '2026-09')
assert.equal(direct.customerCount, 3)
assert.equal(direct.receiptCount, 3)
assert.equal(direct.completedCount, 2)
assert.equal(direct.activeCount, 1)
assert.equal(direct.completedExpectedCommission, expectedRebateFor(rows[0]) + expectedRebateFor(rows[2]))
assert.deepEqual(direct.settlements, [{ month: '2026-11', expectedCommission: 445645, customerCount: 1 }])
assert.equal(direct.undatedExpectedCommission, 20000)
assert.equal(direct.undatedCustomerCount, 1)
assert.equal(direct.customers.find(customer => customer.label.startsWith('김'))?.label, '김** / 0252')
assert.equal(direct.customers.find(customer => customer.status === '관리중')?.expectedCommission, null)
assert.equal(direct.customers.find(customer => customer.status === '관리중')?.expectedSettlementMonth, null)
assert.equal(direct.settlements.reduce((sum, bucket) => sum + bucket.expectedCommission, 0) + direct.undatedExpectedCommission, direct.completedExpectedCommission)
assert.deepEqual(direct.customers.map(customer => Object.keys(customer).sort()), direct.customers.map(customer => ['key', 'label', 'registeredAt', 'status', 'deliveryScheduledDate', 'expectedCommission', 'expectedSettlementMonth', 'basisRequired', 'basisReason', ...(customer.salesChannels ? ['salesChannels'] : [])].sort()))
const serialized = JSON.stringify(direct)
for (const forbidden of ['lumpSumAmount', 'subscriptionAmount', 'purchaseAmount', 'purchaseType', 'salesRawPeriods', 'subscriptionRawPeriods', 'customerName', 'phoneLast4', 'manager', 'memoHistory', 'plannerName', 'note', 'source-김준수', '김준수', '01012340252', '비공개', '7777', '8888']) assert.equal(serialized.includes(forbidden), false, `Do not project ${forbidden}`)
assert.equal(JSON.stringify(rows), before)
assert.deepEqual(buildPartnerPreview([...rows, { ...rows[0], lumpSumAmount: 99999999 }], '(주)다이렉트컴즈', '2026-09'), direct, 'Duplicated saved IDs retain first source and cannot inflate fees')

const family = buildPartnerPreview(rows, '(주)아이패밀리에스씨', '2026-10')
assert.equal(family.customerCount, 1, 'Own-company intake date cannot disclose another company earlier month')
assert.equal(family.customers[0].registeredAt, '2026-10-01')
assert.equal(family.settlements.length, 0, 'Foreign financial basis is not reselected through tenant scope')
assert.equal(family.customers[0].expectedCommission, null)
assert.equal(family.customers[0].deliveryScheduledDate, null)
assert.equal(family.basisRequiredCount, 1)
assert.equal(family.completedCount, 0, 'A foreign selected basis cannot make the visible secondary customer a completed category')
assert.equal(family.activeCount, 0)
assert.equal(buildPartnerPreview(rows, '(주)아이패밀리에스씨', '2026-09').customerCount, 0)
assert.deepEqual(buildPartnerPreview(rows, '아이웨딩', '2026-10'), family, 'Only approved canonical aliases match')
const aliasRows = [lead('alias', { partnerName: '아이웨딩', deliveryScheduledDate: '2026-11-05' })]
assert.equal(buildPartnerPreview(aliasRows, '(주)아이패밀리에스씨', '2026-09').customerCount, 1)
for (const company of ['', '  ', '전체 제휴업체', '다이렉트', '알 수 없는 업체']) assert.equal(buildPartnerPreview(rows, company, '2026-09').customerCount, 0)
for (const month of ['', '2026-9', '2026-00', '2026-13', '0000-01', 'unknown']) assert.equal(buildPartnerPreview(rows, '(주)다이렉트컴즈', month).customerCount, 0)
assert.equal(buildPartnerPreview(rows, '(주)다이렉트컴즈', '2026-10').customerCount, 1)
const zero = buildPartnerPreview([lead('zero', { lumpSumAmount: 0, subscriptionAmount: 0, deliveryScheduledDate: '2026-09-30' })], '(주)다이렉트컴즈', '2026-09')
assert.equal(zero.settlements[0].customerCount, 1, 'Zero-fee completed customer remains visible')
assert.equal(zero.settlements[0].expectedCommission, 0)
const invalid = buildPartnerPreview([lead('invalid', { deliveryScheduledDate: '2026-02-30' })], '(주)다이렉트컴즈', '2026-09')
assert.equal(invalid.customers[0].deliveryScheduledDate, null)
assert.equal(invalid.customers[0].expectedSettlementMonth, null)
assert.equal(invalid.undatedCustomerCount, 1)

// Category membership follows only the one chosen customer, even when all
// linked originals retain their independent status and amount records.
for (const chosenStatus of ['구매완료', '관리중', '상담 마감', '취소'] as const) {
  for (const otherStatus of ['구매완료', '관리중', '상담 마감', '취소'] as const) {
    for (const mergeAmounts of [false, true]) {
      const members = [
        lead('chosen', { caseGroupId: 'chosen-case', caseBasisLeadId: 'chosen', status: chosenStatus,
          ...(mergeAmounts ? { caseMergeMemberIds: ['chosen', 'secondary'] } : {}) }),
        lead('secondary', { caseGroupId: 'chosen-case', caseBasisLeadId: 'chosen', status: otherStatus,
          ...(mergeAmounts ? { caseMergeMemberIds: ['chosen', 'secondary'] } : {}) }),
      ]
      const original = JSON.stringify(members)
      const model = buildPartnerPreview(members, '(주)다이렉트컴즈', '2026-09')
      assert.equal(model.customerCount, 1)
      assert.equal(model.customers[0].status, chosenStatus)
      assert.equal(model.completedCount, chosenStatus === '구매완료' ? 1 : 0)
      assert.equal(model.activeCount, chosenStatus === '관리중' ? 1 : 0)
      assert.equal(model.basisRequiredCount, 0)
      assert.equal(JSON.stringify(members), original, 'Category exclusion must not change original status, amount or history')
    }
  }
}
const unresolved = buildPartnerPreview([
  lead('unresolved-complete', { caseGroupId: 'needs-selection', status: '구매완료' }),
  lead('unresolved-active', { caseGroupId: 'needs-selection', status: '관리중' }),
], '(주)다이렉트컴즈', '2026-09')
assert.equal(unresolved.customerCount, 1)
assert.equal(unresolved.basisRequiredCount, 1)
assert.equal(unresolved.completedCount, 0, 'No unchosen original supplies a category while basis selection is required')
assert.equal(unresolved.activeCount, 0)
assert.equal(unresolved.customers[0].status, '구매완료', 'Own visible status remains compatible without inventing a selected basis')
for (const ownStatus of ['구매완료', '관리중'] as const) {
  for (const foreignStatus of ['구매완료', '관리중', '상담 마감', '취소'] as const) {
    for (const amountsEntered of [false, true]) {
      const amounts: Partial<Lead> = amountsEntered ? {} : { purchaseType: '미선택', lumpSumAmount: undefined, subscriptionAmount: undefined, purchaseAmount: undefined }
      const model = buildPartnerPreview([
        lead('foreign-selected', { caseGroupId: 'foreign-selected-case', caseBasisLeadId: 'foreign-selected', partnerName: '다른 업체', status: foreignStatus, ...amounts }),
        lead('own-secondary', { caseGroupId: 'foreign-selected-case', caseBasisLeadId: 'foreign-selected', status: ownStatus, ...amounts }),
      ], '(주)다이렉트컴즈', '2026-09')
      assert.equal(model.customerCount, 1)
      assert.equal(model.customers[0].status, ownStatus, 'Do not disclose selected foreign status')
      assert.equal(model.completedCount, 0)
      assert.equal(model.activeCount, 0)
      assert.equal(model.completedExpectedCommission, 0)
      assert.equal(model.customers[0].expectedCommission, null)
      assert.equal(model.customers[0].deliveryScheduledDate, null)
    }
  }
}
const routeLead = lead('route-own', { partnerName: '아이웨딩', purchaseType: '일시불', subscriptionAmount: undefined, lumpSumAmount: 100000 })
routeLead.salesRawPeriods!['2026-09'].channels = [
  { channel1: '고객인증서비스(웨딩)', channel2: '웨딩박람회(내부)', orderCount: 1, amount: 60000 },
  { channel1: '매장방문', channel2: '일반상담', orderCount: 1, amount: 40000 },
]
const routeBefore = JSON.stringify(routeLead)
const routeModel = buildPartnerPreview([routeLead], '아이웨딩', '2026-09')
assert.deepEqual(routeModel.customers[0].salesChannels, [
  { kind: 'lumpSum', period: '2026-09', status: 'eligible', channel1: '고객인증서비스(웨딩)', channel2: '웨딩박람회(내부)' },
  { kind: 'lumpSum', period: '2026-09', status: 'mismatch', channel1: '매장방문', channel2: '일반상담' },
])
for (const forbidden of ['amountCurrent', 'orderCount', 'sourceHash', '60000', '40000']) assert.equal(JSON.stringify(routeModel.customers[0].salesChannels).includes(forbidden), false)
assert.equal(JSON.stringify(routeLead), routeBefore)
const unused = { ...routeLead, id: 'unused', caseGroupId: 'route-group', caseBasisLeadId: 'route-own', salesRawPeriods: { '2026-09': { ...routeLead.salesRawPeriods!['2026-09'], channels: [{ channel1: '표시하지 않는 원본 경로', channel2: '별도 경로', orderCount: 1, amount: 100000 }] } } }
const selectedRoutes = buildPartnerPreview([{ ...routeLead, caseGroupId: 'route-group', caseBasisLeadId: 'route-own' }, unused], '아이웨딩', '2026-09')
assert.equal(JSON.stringify(selectedRoutes).includes('표시하지 않는 원본 경로'), false, 'Unselected originals cannot supply displayed routes')
const mergedRoutes = buildPartnerPreview([{ ...routeLead, caseGroupId: 'route-group', caseBasisLeadId: 'route-own', caseMergeMemberIds: ['route-own', 'unused'] }, { ...unused, caseMergeMemberIds: ['route-own', 'unused'] }], '아이웨딩', '2026-09')
assert.equal(mergedRoutes.customers[0].salesChannels?.length, 3, 'Only explicit monetary merge exposes both own originals route evidence')
const redactedRoutes = buildPartnerPreview([{ ...routeLead, caseGroupId: 'foreign-route', caseBasisLeadId: 'foreign-basis' }, { ...unused, id: 'foreign-basis', partnerName: '다른 업체', caseGroupId: 'foreign-route', caseBasisLeadId: 'foreign-basis' }], '아이웨딩', '2026-09')
assert.equal(redactedRoutes.customers[0].salesChannels, undefined)

const reviewedRouteBasis: Lead = { ...routeLead, caseGroupId: 'approved-route-case', caseBasisLeadId: routeLead.id,
  purchaseType: '일시불+구독', subscriptionAmount: 200_000, salesRawPeriods: undefined }
const reviewedRouteSource: Lead = { ...routeLead, id: 'approved-source', caseGroupId: reviewedRouteBasis.caseGroupId,
  caseBasisLeadId: reviewedRouteBasis.id, purchaseType: '미선택', lumpSumAmount: undefined,
  subscriptionRawPeriods: { '2026-09': {
    period: '2026-09', sourceHash: 'approved-subscription-source', importedAt: '2026-11-14',
    itemCount: 1, confirmedItemCount: 1, pendingItemCount: 0, confirmedBasisAmount: 200_000, pendingBasisAmount: 0,
    settlementBasisAmount: 200_000, eligibleConfirmedBasisAmount: 200_000, eligiblePendingBasisAmount: 0,
    includedStatuses: ['주문확정'], missingBasisItemCount: 0, rejectedProofItemCount: 0,
    channels: [{ channel1: '고객인증서비스(웨딩)', channel2: '웨딩박람회(내부)', orderCount: 1, amount: 200_000 }],
  } },
}
reviewedRouteBasis.subscriptionSettlementReview = {
  period: '2026-09', sourceHash: 'approved-subscription-source', enteredAmount: 200_000,
  confirmedBasisAmount: 200_000, pendingBasisAmount: 0, settlementBasisAmount: 200_000,
  reviewedAt: '2026-11-14', partnerName: '(주)아이패밀리에스씨',
  linkedSource: { leadId: reviewedRouteSource.id, caseGroupId: reviewedRouteBasis.caseGroupId!,
    memberIds: [reviewedRouteBasis.id, reviewedRouteSource.id].sort(),
    cashRoute: { period: '2026-09', sourceHash: 'verified-lump-sum-fixture', confirmedAmount: 100_000 },
  },
}
const linkedRouteView = (basis: Lead, source: Lead) => buildPartnerPreview([basis, source], '아이웨딩', '2026-09').customers[0]
const linkedRouteCustomer = linkedRouteView(reviewedRouteBasis, reviewedRouteSource)
assert.equal(linkedRouteCustomer.expectedCommission, 3_000, 'Cash route confirmation alone cannot change settlement')
const review = reviewedRouteBasis.subscriptionSettlementReview!
const linkedSource = review.linkedSource!
const cashReviewedBasis = { ...reviewedRouteBasis, deliveryScheduledDate: '2026-12-04',
  subscriptionSettlementReview: { ...review, linkedSource: { ...linkedSource,
    cashRoute: { ...linkedSource.cashRoute!, settlementBasisAmount: 100_000 },
  } },
}
const reviewedCashCustomer = linkedRouteView(cashReviewedBasis, reviewedRouteSource)
assert.equal(reviewedCashCustomer.expectedCommission, 5_000)
assert.equal(reviewedCashCustomer.expectedSettlementMonth, '2027-02')
assert.equal(linkedRouteView({ ...cashReviewedBasis, lumpSumAmount: 100_001 }, reviewedRouteSource).expectedCommission, 3_000)
const cashPeriod = reviewedRouteSource.salesRawPeriods!['2026-09']
for (const failedEvidence of [
  { ...cashPeriod, sourceHash: 'another-workbook' },
  { ...cashPeriod, settlementBasisAmount: 90_000 },
  { ...cashPeriod, returnAmount: 1_000 },
  { ...cashPeriod, confirmedOrderCount: 0 },
]) {
  const failedSource = { ...reviewedRouteSource, salesRawPeriods: { '2026-09': failedEvidence } }
  assert.equal(linkedRouteView(cashReviewedBasis, failedSource).expectedCommission, 3_000, 'Changed cash evidence cannot enter settlement')
}
assert.equal(expectedRebateFor(cashReviewedBasis), 0, 'A protected linked review applies only through its complete chosen case')
assert.equal(buildPartnerPreview([cashReviewedBasis,reviewedRouteSource, {
  ...reviewedRouteSource,id:'another-member', salesRawPeriods: undefined, subscriptionRawPeriods: undefined,
}], '아이웨딩', '2026-09').customers[0].expectedCommission, 0, 'A changed group roster invalidates the approval')
assert.deepEqual(linkedRouteCustomer.salesChannels?.map(row => [row.kind, row.status]), [
  ['lumpSum', 'eligible'], ['lumpSum', 'mismatch'], ['subscription', 'eligible'],
])
for (const forbidden of ['approved-source', 'sourceHash', 'orderCount', '200000']) {
  assert.equal(JSON.stringify(linkedRouteCustomer.salesChannels).includes(forbidden), false)
}
const invalidCash = { ...reviewedRouteBasis, lumpSumAmount: 100_001 }
assert.deepEqual(linkedRouteView(invalidCash, reviewedRouteSource).salesChannels?.map(row => [row.kind, row.status]), [
  ['lumpSum', 'unverified'], ['subscription', 'eligible'],
])
const invalidSubscription = { ...reviewedRouteBasis, subscriptionAmount: 200_001 }
assert.deepEqual(linkedRouteView(invalidSubscription, reviewedRouteSource).salesChannels?.map(row => row.status), ['unverified', 'unverified'])
const foreignSource = { ...reviewedRouteSource, partnerName: '다른 업체' }
assert.deepEqual(linkedRouteView(reviewedRouteBasis, foreignSource).salesChannels?.map(row => row.status), ['unverified', 'unverified'])

assert.equal(JSON.stringify(redactedRoutes).includes('표시하지 않는 원본 경로'), false, 'Foreign selected route evidence is never disclosed')
console.log('partnerPreview tests passed: exact tenant scope, selected route evidence, no amounts/foreign paths, preserved fees and originals')
