import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { CaseMergeChoiceModal } from '../src/components/CaseMergeChoiceModal.tsx'
import type { Lead } from '../src/types.ts'

const member = (id: string, customerName: string, phoneLast4: string, amount: number): Lead => ({
  id, customerName, phoneLast4, registeredAt: '2026-10-01', updatedAt: '2026-10-14',
  gender: '미입력', partnerName: '(주) 아이니웨딩네트웍스', status: '구매완료', visitState: '방문',
  purchaseType: '일시불', lumpSumAmount: amount, caseGroupId: 'synthetic-popup',
})
const members = [member('A', '가나다', '01000004101', 100000), member('B', '나다라', '01000004202', 200000)]
const before = JSON.stringify(members)
let calls = 0
const markup = renderToStaticMarkup(<CaseMergeChoiceModal members={members} initialBasisId="A" onClose={() => { calls += 1 }} onConfirm={() => { calls += 1 }} />)
assert.ok(markup.includes('role="dialog"'))
assert.ok(markup.includes('aria-modal="true"'))
assert.ok(markup.includes('aria-labelledby='))
assert.ok(markup.includes('aria-describedby='))
assert.ok(markup.includes('가** / 4101 고객 유지'))
assert.ok(markup.includes('나** / 4202 고객 유지'))
assert.equal(markup.includes('가나다'), false)
assert.equal(markup.includes('01000004101'), false)
assert.ok(markup.includes('100,000원'))
assert.ok(markup.includes('200,000원'))
assert.equal(markup.includes('300,000원'), false, 'First step must not silently sum the customers')
assert.ok(markup.includes('두 고객 합치기'))
assert.equal(markup.includes('구매금액도 합치시겠습니까?'), false, 'Additional purchase question is only opened after a merge choice')
assert.ok(markup.includes('원본 고객 기록·수기 입력·관리 이력은 삭제하지 않습니다'))
assert.ok(markup.includes('저장 전에는 고객 데이터가 변경되지 않습니다'))
assert.equal(calls, 0)
assert.equal(JSON.stringify(members), before)
const many = renderToStaticMarkup(<CaseMergeChoiceModal members={[...members, member('C', '다라마', '4303', 50000)]} disabled onClose={() => undefined} onConfirm={() => undefined} />)
assert.ok(many.includes('고객들 합치기'))
assert.ok(many.includes('disabled=""'))
const empty = renderToStaticMarkup(<CaseMergeChoiceModal members={[]} onClose={() => undefined} onConfirm={() => undefined} />)
assert.ok(empty.includes('묶을 고객을 먼저 선택해주세요'))
console.log('Case merge popup SSR: masked source choices, explicit second question, accessibility, no silent summing and no mutations passed')
