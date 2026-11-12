import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { CaseMergeChoiceModal } from '../src/components/CaseMergeChoiceModal.tsx'
import type { Lead } from '../src/types.ts'

const member = (id: string, customerName: string, phoneLast4: string, amount?: number): Lead => ({
  id, customerName, phoneLast4, registeredAt: '2026-10-01', updatedAt: '2026-10-19',
  gender: '미입력', partnerName: '(주) 아이니웨딩네트웍스', status: '구매완료', visitState: '방문',
  purchaseType: '일시불', lumpSumAmount: amount, caseGroupId: 'synthetic-popup',
})
const members = [member('A', '가나다', '01000004101', 100000), { ...member('B', '나다라', '01000004202', 200000), registeredAt: '2026-11-08', updatedAt: '2026-11-09' }]
const before = JSON.stringify(members)
let calls = 0
const markup = renderToStaticMarkup(<CaseMergeChoiceModal members={members} initialBasisId="A" onClose={() => { calls += 1 }} onConfirm={() => { calls += 1 }} />)
assert.ok(markup.includes('role="dialog"') && markup.includes('aria-modal="true"'))
assert.ok(markup.includes('aria-labelledby=') && markup.includes('aria-describedby='))
assert.ok(markup.includes('고객 묶기'))
assert.equal((markup.match(/type="radio"/g) || []).length, 2)
assert.equal((markup.match(/type="checkbox"/g) || []).length, 1)
assert.equal(markup.includes('checked=""'), false, 'No selected basis or implicit money-merge consent, even when initialBasisId is provided')
assert.ok(markup.includes('aria-label="가** / 4101"') && markup.includes('aria-label="나** / 4202"'))
assert.ok(markup.includes('접수일 <time dateTime="2026-10-01">2026.10.01</time>') && markup.includes('접수일 <time dateTime="2026-11-08">2026.11.08</time>'))
const candidateDescription = markup.match(/aria-label="나\*\* \/ 4202" aria-describedby="([^"]+)"/)?.[1]
assert.ok(candidateDescription && markup.includes(`<small id="${candidateDescription}">접수일 <time dateTime="2026-11-08">`))
assert.equal(markup.includes('가나다'), false)
assert.equal(markup.includes('01000004101'), false)
assert.ok(markup.includes('100,000원') && markup.includes('200,000원'))
assert.equal(markup.includes('300,000원'), false, 'No summation without an explicit checkbox choice')
assert.ok(markup.includes('aria-label="구매금액도 합산"'))
assert.match(markup, /type="checkbox"[^>]*disabled=""/, 'Money merge waits for a valid selected basis')
assert.match(markup, /class="case-merge-primary" disabled=""/, 'Confirm waits for a customer selection')
assert.ok(markup.includes('미선택 시 기준 고객 금액 유지'))
assert.ok(markup.includes('고객을 선택해주세요'))
assert.ok(markup.includes('원본 기록은 보존됩니다') && markup.includes('변경사항 저장'))
for (const removed of ['두 고객 합치기', '어떻게 처리할까요?', '다시 선택', '다음 단계', '구매금액도 합치시겠습니까?']) assert.equal(markup.includes(removed), false)
assert.equal(calls, 0)
assert.equal(JSON.stringify(members), before)
const many = renderToStaticMarkup(<CaseMergeChoiceModal members={[...members, member('C', '다라마', '4303', 50000)]} disabled onClose={() => undefined} onConfirm={() => undefined} />)
assert.equal((many.match(/type="radio"/g) || []).length, 3)
assert.ok(many.includes('<fieldset class="case-merge-candidates" disabled=""'))
assert.ok(many.includes('기록 3개를 고객 1명으로 묶습니다.') && many.includes('전체 3개 기록'))
const amounts = renderToStaticMarkup(<CaseMergeChoiceModal members={[member('zero', '가나다', '4101', 0), member('missing', '나다라', '4202')]} onClose={() => undefined} onConfirm={() => undefined} />)
assert.ok(amounts.includes('<b>0원</b>') && amounts.includes('<b>금액 미입력</b>'), 'Zero and missing remain distinct')
const mergedMembers = members.map(item => ({ ...item, caseBasisLeadId: 'A', caseMergeMemberIds: ['A', 'B'] }))
const current = renderToStaticMarkup(<CaseMergeChoiceModal members={mergedMembers} initialMergeMemberIds={['A', 'B']} onClose={() => undefined} onConfirm={() => undefined} />)
assert.ok(current.includes('현재 금액 합산 중') && current.includes('300,000원'))
assert.equal(current.includes('checked=""'), false, 'A stored merge does not grant fresh merge consent')
const expanded = renderToStaticMarkup(<CaseMergeChoiceModal members={[...mergedMembers, member('C', '다라마', '4303', 50000)]} initialMergeMemberIds={['A', 'B']} onClose={() => undefined} onConfirm={() => undefined} />)
assert.ok(expanded.includes('현재 금액 합산 중 · 300,000원') && expanded.includes('전체 3개 기록'))
assert.ok(!expanded.includes('350,000원') && !expanded.includes('checked=""'), 'Adding a record requires fresh consent before changing the sum')
const empty = renderToStaticMarkup(<CaseMergeChoiceModal members={[]} onClose={() => undefined} onConfirm={() => undefined} />)
assert.ok(empty.includes('묶을 고객을 먼저 선택해주세요'))
assert.match(empty, /class="case-merge-primary" disabled=""/)
console.log('Single-screen case popup: masked unselected customer radios, opt-in money checkbox, blocked implicit confirmation, zero versus missing, saved-merge context, no source mutation passed')
