import assert from 'node:assert/strict'
import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CaseGroupSummary } from '../src/components/CaseGroupSummary'
import type { Lead } from '../src/types'

const members: Lead[] = [
  { id: 'qa-A', customerName: '가나다', phoneLast4: '01000004101', registeredAt: '2026-10-01', updatedAt: '2026-10-19', gender: '미입력', partnerName: '합성 업체', appointmentType: '이업종제휴', status: '상담 마감', visitState: '방문', lumpSumAmount: 100000 },
  { id: 'qa-B', customerName: '나다라', phoneLast4: '01000004202', registeredAt: '2026-11-08', updatedAt: '2026-11-09', gender: '미입력', partnerName: '합성 업체', appointmentType: '미선택', status: '관리중', visitState: '미정', lumpSumAmount: 200000 },
]
const before = JSON.stringify(members)
let calls = 0
const callback = () => { calls += 1 }
const render = (extra: Partial<ComponentProps<typeof CaseGroupSummary>> = {}) => renderToStaticMarkup(
  <CaseGroupSummary members={members} activeLeadId="qa-A" basisLabel="가** / 4101" amountMode="merged" staged={false} choiceOpen={false} disabled={false} unlinkBusy={false} onChoose={callback} onSelectMember={callback} onUnlink={callback} {...extra}>
    <div className="case-original-record">원본 금액 100,000원 · 200,000원</div>
  </CaseGroupSummary>,
)
const html = render()
assert.equal((html.match(/aria-label="묶음 고객 요약"/g) || []).length, 1)
assert(html.includes('1명으로 집계') && html.includes('구매금액 합산'))
assert(html.includes('가** / 4101') && html.includes('나** / 4202'))
assert(html.includes('접수일 <time dateTime="2026-10-01">2026.10.01</time> · 이업종제휴'))
assert(html.includes('접수일 <time dateTime="2026-11-08">2026.11.08</time></small>'))
assert(!html.includes('접수 방식 미확인'))
assert(!html.includes('미선택'))
const mixedMethods = render({ members: [
  { ...members[0], appointmentType: '상담예약(이업종)' },
  { ...members[1], appointmentType: undefined },
] })
assert(mixedMethods.includes('접수일 <time dateTime="2026-10-01">2026.10.01</time> · 상담예약 (이업종)'))
assert(mixedMethods.includes('접수일 <time dateTime="2026-11-08">2026.11.08</time></small>'))
assert(!html.includes('가나다') && !html.includes('01000004101'))
assert(html.includes('aria-pressed="true"') && html.includes('aria-pressed="false"'))
assert(html.includes('aria-label="묶음 처리 선택"') && html.includes('선택 변경'))
assert(!html.includes('고객 추가'))
assert.match(render({ onAddMember: callback }), /<button type="button" class="case-group-add">고객 추가<\/button>/)
assert.match(render({ onAddMember: callback, disabled: true }), /class="case-group-add" disabled="">고객 추가/)
assert.match(render({ onAddMember: callback, unlinkBusy: true }), /class="case-group-add" disabled="">고객 추가/)
assert.match(html, /<details class="case-original-values">/)
assert(!html.includes('<details open'))
assert(html.includes('원본 기록 2개 · 더보기') && html.includes('두 고객 연결 해제'))
assert(!html.includes('class="case-group-warning"'))
assert(render({ staged: true }).includes('변경사항 저장 시 반영됩니다'))
const pending = render({ amountMode: 'pending', pendingReason: '서로 다른 금액입니다. 기준을 선택해주세요.' })
assert(pending.includes('선택하기') && pending.includes('선택 필요'))
assert(pending.includes('role="status"') && pending.includes('서로 다른 금액입니다. 기준을 선택해주세요.'))
const readonly = render({ onChoose: undefined, onUnlink: undefined })
assert(readonly.includes('선택 변경은 관리자에게 요청해주세요'))
assert.match(readonly, /aria-label="묶음 처리 선택"[^>]*disabled=""/)
assert(!readonly.includes('두 고객 연결 해제'))
const linking = render({ onSelectMember: undefined })
assert(linking.includes('class="case-group-member"') && !linking.includes('aria-pressed='))
assert(linking.includes('접수일 <time dateTime="2026-11-08">2026.11.08</time></small>'))
assert(render({ amountMode: 'single' }).includes('기준 고객 금액 유지'))
const selected = render({ basisLeadId: 'qa-A' })
assert.equal((selected.match(/>집계 제외<\/small>/g) || []).length, 1)
assert(selected.includes('title="원본 상태: 관리중">집계 제외'))
assert(selected.includes('title="원본 상태: 상담 마감">상담 마감'))
assert(!render({ amountMode: 'pending', basisLeadId: 'qa-A' }).includes('집계 제외'))
assert(!render().includes('집계 제외'))
assert(render({ onSelectMember: undefined, basisLeadId: 'qa-B' }).includes('title="원본 상태: 상담 마감">집계 제외'))
assert.equal(calls, 0)
assert.equal(JSON.stringify(members), before)
console.log('Case group summary: one compact card, masked member navigation, current choice, collapsed originals, explicit warnings, permission guards and immutable inputs passed')
