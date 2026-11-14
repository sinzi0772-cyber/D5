import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { SalesChannelReviewModal } from '../src/components/SalesChannelReviewModal.tsx'
import { groupSalesChannelReviewItems, type SalesChannelReviewItem } from '../src/lib/salesChannelReview.ts'

const mismatch: SalesChannelReviewItem = {
  key: 'mismatch', caseKey: 'case:fixture', leadId: 'a', status: 'mismatch',
  customerLabel: '가** / 3101', partnerName: '테스트 업체', kind: 'subscription',
  intakeDate: '2026-09-18', period: '2026-10', channel1: '고객인증서비스(웨딩)',
  channel2: '웨딩매장행사', managerLabel: '테스트 담당',
}
const unknown: SalesChannelReviewItem = {
  ...mismatch, key: 'unknown', leadId: 'b', status: 'unverified',
  customerLabel: '나** / 3102', kind: 'lumpSum', intakeDate: '2026-09-24',
  period: '2026-10', channel1: '', channel2: '',
}
const multipleMonths: SalesChannelReviewItem = {
  ...unknown, key: 'multiple-months', leadId: 'c', customerLabel: '다** / 3103',
  intakeDate: '2026-09-27', period: null, periods: ['2026-09', '2026-10'],
}

const markup = renderToStaticMarkup(<SalesChannelReviewModal cards={groupSalesChannelReviewItems([unknown, mismatch, multipleMonths])} onClose={() => undefined} onSelectLead={() => undefined}/>)
assert.ok(markup.includes('role="dialog"') && markup.includes('판매경로 점검 · 3개'))
const mismatchGroup = markup.match(/<section[^>]+aria-label="경로 불일치">([\s\S]+?)<\/section>/)?.[1] || ''
const unverifiedGroup = markup.match(/<section[^>]+aria-label="경로 확인 필요">([\s\S]+?)<\/section>/)?.[1] || ''
assert.ok(mismatchGroup.includes('<h3>경로 불일치 1건</h3>') && mismatchGroup.includes('가** / 3101'))
assert.ok(mismatchGroup.includes('<dt>판매경로 1</dt>') && mismatchGroup.includes('<dt>판매경로 2</dt>'))
assert.ok(mismatchGroup.includes('class="different">웨딩매장행사') && mismatchGroup.includes('구독 · 2026.10'))
assert.ok(unverifiedGroup.includes('<h3>경로 확인 필요 2건</h3>') && unverifiedGroup.includes('나** / 3102') && unverifiedGroup.includes('다** / 3103'))
assert.ok(unverifiedGroup.includes('접수일 <time dateTime="2026-09-24">2026.09.24</time>'))
assert.ok(unverifiedGroup.includes('확정 주문의 판매경로를 원본에서 확인해주세요.'))
assert.ok(markup.includes('제휴업체가 연결한 구매완료 고객의 확정 주문을 점검합니다.'))
assert.ok(unverifiedGroup.includes('일시불 · 2026.09, 2026.10') && unverifiedGroup.includes('미확인'))
assert.ok(!unverifiedGroup.includes('class="different"') && !unverifiedGroup.includes('가** / 3101'))
assert.equal((markup.match(/고객 상세 확인/g) || []).length, 3)
const onlyUnverified = renderToStaticMarkup(<SalesChannelReviewModal cards={groupSalesChannelReviewItems([unknown])} onClose={() => undefined} onSelectLead={() => undefined}/>)
assert.ok(!onlyUnverified.includes('경로 불일치') && onlyUnverified.includes('경로 확인 필요 1건'))
const sameRoute = { ...mismatch, key: 'same-cash-route', kind: 'lumpSum' as const }
const pairs = Object.freeze([Object.freeze(mismatch), Object.freeze(sameRoute)])
const combined = groupSalesChannelReviewItems(pairs)
const combinedMarkup = renderToStaticMarkup(<SalesChannelReviewModal cards={combined} onClose={() => undefined} onSelectLead={() => undefined}/>)
assert.equal(combined.length, 1)
assert.ok(combinedMarkup.includes('판매경로 점검 · 1개') && combinedMarkup.includes('경로 불일치 1건'))
assert.ok(combinedMarkup.includes('일시불·구독 · 2026.10'))
assert.equal((combinedMarkup.match(/고객 상세 확인/g) ?? []).length, 1)
assert.equal((combinedMarkup.match(/웨딩매장행사/g) ?? []).length, 1)

for (const other of [
  { ...sameRoute, leadId: 'another-saved-record' },
  { ...sameRoute, period: '2026-11' },
  { ...sameRoute, channel2: '다른 판매경로' },
  { ...sameRoute, staffRoute: { channel1: '직원 경로 1', channel2: '직원 경로 2' } },
]) assert.equal(groupSalesChannelReviewItems([mismatch, other]).length, 2)
assert.equal(groupSalesChannelReviewItems([unknown, { ...unknown, key: 'unknown-subscription', kind: 'subscription' }]).length, 2)

console.log('Sales route popup combines matching cash and subscription cards and preserves separate findings')
