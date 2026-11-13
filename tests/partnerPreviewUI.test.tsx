import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { PartnerPreview } from '../src/components/PartnerPreview.tsx'
import { buildPartnerPreview } from '../src/lib/partnerPreview.ts'
import type { Lead } from '../src/types.ts'

const rows: Lead[] = [{
  id: 'private-id', registeredAt: '2026-09-21', updatedAt: '2026-10-08',
  customerName: '김준수', phoneLast4: '01012340252', gender: '남',
  partnerName: '(주)다이렉트컴즈', appointmentType: '이업종제휴',
  status: '구매완료', visitState: '방문', deliveryScheduledDate: '2026-09-30',
  purchaseType: '일시불', lumpSumAmount: 20864000,
  salesRawPeriods: { '2026-09': {
    period: '2026-09', sourceHash: 'verified-route-ui-fixture', importedAt: '2026-10-08',
    orderCount: 1, confirmedOrderCount: 1, reservedOrderCount: 0,
    confirmedAmount: 20864000, reservedAmount: 0, settlementBasisAmount: 20864000, eligibleConfirmedAmount: 20864000, eligibleReservedAmount: 0, returnAmount: 0,
  } },
  manager: '비공개 담당자', managerEmployeeNo: '98765', note: '비공개 상담 메모',
}, {
  id: 'active-id', registeredAt: '2026-09-20', updatedAt: '2026-10-08',
  customerName: '박영희', phoneLast4: '0002', gender: '여',
  partnerName: '(주)다이렉트컴즈', appointmentType: '이업종제휴',
  status: '관리중', visitState: '예정', purchaseType: '일시불', lumpSumAmount: 98765432,
}]
const model = buildPartnerPreview(rows, '(주)다이렉트컴즈', '2026-09')
const before = JSON.stringify(model)
for (const customer of model.customers) Object.freeze(customer)
for (const settlement of model.settlements) Object.freeze(settlement)
Object.freeze(model.customers)
Object.freeze(model.settlements)
Object.freeze(model)
const markup = renderToStaticMarkup(<PartnerPreview model={model}/>)
for (const expected of ['김** / 0252', '박** / 0002', '2026년 11월 중순', '417,280원', '관리중']) assert.ok(markup.includes(expected), expected)
for (const forbidden of ['김준수', '박영희', '01012340252', 'private-id', 'active-id', '비공개', '98765', '20,864,000', '20864000', '98,765,432', '98765432', '총판매금액', '오늘 확인할 고객', '담당자별', 'TOP 3', '관리기록', '직원 접속']) assert.equal(markup.includes(forbidden), false, forbidden)
const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
assert.equal(buttons.length, 10, 'Nine local sorting controls and one dated month selection belong in this fixture')
const monthButtons = buttons.filter(([, attributes]) => /class="[^"]*\bpartner-preview-month-select\b/.test(attributes))
const sortButtons = buttons.filter(([, attributes]) => /class="[^"]*\bpartner-preview-sort-button\b/.test(attributes))
assert.equal(monthButtons.length, 1)
assert.equal(sortButtons.length, 9)
for (const [, attributes] of buttons) {
  assert.match(attributes, /type="button"/, 'Read-only selection must not submit a form')
  assert.match(attributes, /class="[^"]*\bpartner-preview-(?:month-select|sort-button)\b/, 'Only local selection and sorting controls are allowed')
}
for (const [, attributes] of monthButtons) {
  assert.match(attributes, /aria-label="2026년 11월 예상 수수료 보기"/)
  assert.match(attributes, /aria-pressed="true"/)
  assert.match(attributes, /aria-controls="[^"]+"/, 'The selected month is linked to its fee card')
}
const tables = [...markup.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/g)]
const settlementTable = tables.find(([, attributes]) => attributes.includes('aria-label="월별 예상 정산표"'))
const customerTable = tables.find(([, attributes]) => attributes.includes('aria-label="연결 고객 목록"'))
assert.ok(settlementTable, 'Monthly settlement table has an accessible name')
assert.ok(customerTable, 'Customer table has an accessible name')
const assertHeaders = (table: RegExpMatchArray, labels: string[], activeLabel: string, direction: 'ascending' | 'descending') => {
  const head = table[2].match(/<thead>([\s\S]*?)<\/thead>/)?.[1] || ''
  const headers = [...head.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)]
  assert.equal(headers.length, labels.length)
  for (const [index, [, attributes, content]] of headers.entries()) {
    const label = labels[index]
    assert.match(attributes, /scope="col"/)
    assert.ok(attributes.includes(`aria-sort="${label === activeLabel ? direction : 'none'}"`), `${label} exposes its initial sort direction`)
    const button = content.match(/<button\b([^>]*)>([\s\S]*?)<\/button>/)
    assert.ok(button, `${label} is a native keyboard-operable button`)
    assert.ok(button[1].includes(`aria-label="${label} 정렬"`), `${label} names its sorting action`)
    assert.ok(button[1].includes(`data-direction="${label === activeLabel ? direction === 'ascending' ? 'asc' : 'desc' : 'none'}"`))
    assert.match(button[1], /title="[^"]+"/, 'The next sort action has a tooltip')
    assert.equal(button[2], label, 'Direction indicators must not add noisy spoken arrow text')
  }
}
assertHeaders(settlementTable, ['정산월', '고객 수', '예상 수수료'], '정산월', 'ascending')
assertHeaders(customerTable, ['고객 / 연락처 뒷자리', '등록일', '상태', '배송예정일', '예상 정산월', '예상 수수료'], '등록일', 'descending')
assert.equal((markup.match(/<select\b/g) || []).length, 1, 'Only the read-only settlement selector is allowed')
assert.ok(markup.includes('aria-label="예상 수수료 정산월"'))
assert.equal(markup.includes('<form'), false, 'Preview must not offer saved-customer mutation forms')
assert.equal(markup.includes('<input'), false)
assert.equal(markup.includes('<textarea'), false)
assert.equal(JSON.stringify(model), before, 'Rendering display order must not mutate the safe projection')
const empty = renderToStaticMarkup(<PartnerPreview model={buildPartnerPreview(rows, '', '2026-09')}/>)
assert.ok(empty.includes('제휴업체를 선택해 주세요'))
assert.equal(empty.includes('김**'), false)
assert.equal(empty.includes('417,280원'), false)
const unknown = renderToStaticMarkup(<PartnerPreview model={buildPartnerPreview(rows, '다른 업체', '2026-09')}/>)
assert.ok(unknown.includes('선택한 접수월에 연결된 고객이 없습니다.'))
assert.equal(unknown.includes('김**'), false)
const pendingRows = [{ ...rows[0], caseGroupId: 'pending', lumpSumAmount: 100000 }, { ...rows[0], id: 'second-private', customerName: '박영희', phoneLast4: '4444', caseGroupId: 'pending', lumpSumAmount: 200000 }]
const pendingMarkup = renderToStaticMarkup(<PartnerPreview model={buildPartnerPreview(pendingRows, '(주)다이렉트컴즈', '2026-09')}/>)
assert.ok(pendingMarkup.includes('묶음 기준 미선택 1명'))
assert.ok(pendingMarkup.includes('확인 필요'))
assert.equal(pendingMarkup.includes('6,000원'), false, 'A+B fee must never be displayed')
assert.equal(pendingMarkup.includes('0원'), false, 'Pending basis is not presented as a real zero estimate')
assert.equal(pendingMarkup.includes('박** / 4444'), false, 'One safe display identity, not a second customer row')
const pendingTable = [...pendingMarkup.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/g)].find(([, attributes]) => attributes.includes('aria-label="연결 고객 목록"'))!
assert.equal((pendingTable[2].match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr\b/g) || []).length, 1)
const routeModel = { ...model, customers: [{ ...model.customers[0], salesChannels: [
  { kind: 'lumpSum' as const, period: '2026-09', status: 'mismatch' as const, channel1: '매장방문', channel2: '일반상담' },
  { kind: 'subscription' as const, period: '2026-09', status: 'eligible' as const, channel1: '고객인증서비스(웨딩)', channel2: '웨딩박람회(내부)' },
] }] }
const routeMarkup = renderToStaticMarkup(<PartnerPreview model={routeModel}/>)
for (const label of ['판매경로 · 경로 불일치', '매장방문', '일반상담', '경로 일치', '일시불', '구독']) assert(routeMarkup.includes(label))
assert.match(routeMarkup, /<details class="partner-preview-sales-channels has-mismatch">/)
assert(!routeMarkup.includes('<details open'), 'Sales route details stay compact until opened')
assert(!routeMarkup.includes('20,864,000'), 'Showing actual routes must not expose total sales amounts')
const invited = buildPartnerPreview([
  { ...rows[0], partnerName: '(주)아이니웨딩네트웍스', invitationCampaign: '2026-11-iniwedding' },
  { ...rows[1], partnerName: '(주)아이니웨딩네트웍스' },
], '(주) 아이니웨딩네트웍스', '2026-09')
const invitedMarkup = renderToStaticMarkup(<PartnerPreview model={invited} presentation="portal"/>)
assert.equal((invitedMarkup.match(/>11월 초대전<\/em>/g) || []).length, 1, 'Only the reviewed invitation customer receives a badge')
assert.match(invitedMarkup, /<td class=\"partner-preview-customer-label\">김\*\* \/ 0252<em class=\"invitation-campaign-badge\">11월 초대전<\/em><\/td>/)
assert.ok(!invitedMarkup.includes('11월 초대전 연결'))
console.log('partnerPreview UI tests passed: safe compact route details, masked customers, sorting and immutable models')
