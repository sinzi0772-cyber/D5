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
  manager: '비공개 담당자', managerEmployeeNo: '98765', note: '비공개 상담 메모',
}, {
  id: 'active-id', registeredAt: '2026-09-20', updatedAt: '2026-10-08',
  customerName: '박영희', phoneLast4: '0002', gender: '여',
  partnerName: '(주)다이렉트컴즈', appointmentType: '이업종제휴',
  status: '관리중', visitState: '예정', purchaseType: '일시불', lumpSumAmount: 98765432,
}]
const markup = renderToStaticMarkup(<PartnerPreview model={buildPartnerPreview(rows, '(주)다이렉트컴즈', '2026-09')}/>)
for (const expected of ['김** / 0252', '박** / 0002', '2026년 11월 중순', '417,280원', '관리중']) assert.ok(markup.includes(expected), expected)
for (const forbidden of ['김준수', '박영희', '01012340252', 'private-id', 'active-id', '비공개', '98765', '20,864,000', '20864000', '98,765,432', '98765432', '총판매금액', '오늘 확인할 고객', '담당자별', 'TOP 3', '관리기록', '직원 접속']) assert.equal(markup.includes(forbidden), false, forbidden)
assert.equal(markup.includes('<button'), false, 'Preview must not offer saved-customer mutations')
assert.equal(markup.includes('<input'), false)
assert.ok(markup.includes('<th scope="col">예상 수수료</th>'))
const empty = renderToStaticMarkup(<PartnerPreview model={buildPartnerPreview(rows, '', '2026-09')}/>)
assert.ok(empty.includes('제휴업체를 선택해 주세요'))
assert.equal(empty.includes('김**'), false)
assert.equal(empty.includes('417,280원'), false)
const unknown = renderToStaticMarkup(<PartnerPreview model={buildPartnerPreview(rows, '다른 업체', '2026-09')}/>)
assert.ok(unknown.includes('선택한 접수월에 연결된 고객이 없습니다.'))
assert.equal(unknown.includes('김**'), false)
console.log('partnerPreview UI tests passed: masked customers, fee-only output, read-only controls and empty-company isolation')
