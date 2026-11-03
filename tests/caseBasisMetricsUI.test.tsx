import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExecutiveDashboard } from '../src/components/ExecutiveDashboard.tsx'
import { MonthlyCommissionPanel } from '../src/components/MonthlyCommissionPanel.tsx'
import type { Lead } from '../src/types.ts'

const lead = (id: string, amount: number): Lead => ({ id, registeredAt: '2026-09-01', updatedAt: '2026-10-14',
  customerName: '김**', phoneLast4: '0001', gender: '미입력', partnerName: '(주)아이패밀리에스씨', appointmentType: '이업종제휴',
  status: '구매완료', visitState: '방문', caseGroupId: 'one-customer', purchaseType: '일시불', lumpSumAmount: amount,
  deliveryScheduledDate: '2026-09-30', salesRawPeriods: { '2026-09': {
    period: '2026-09', sourceHash: 'synthetic-eligible-sales', importedAt: '2026-10-14', orderCount: 1,
    confirmedOrderCount: 1, reservedOrderCount: 0, confirmedAmount: amount, reservedAmount: 0,
    eligibleConfirmedAmount: amount, eligibleReservedAmount: 0, returnAmount: 0,
  } } })
const pending = [lead('A', 100000), lead('B', 200000)]
const before = JSON.stringify(pending)
const dashboard = renderToStaticMarkup(<ExecutiveDashboard leads={pending} partnerLabel="전체 제휴업체" month="2026-09" onSelectLead={() => undefined} onSelectManager={() => undefined}/>)
assert.ok(dashboard.includes('고객 1명'))
assert.ok(dashboard.includes('묶음 기준 미선택 1명'))
assert.ok(dashboard.includes('기준 확인 필요'))
assert.equal(dashboard.includes('300,000'), false)
assert.equal(dashboard.includes('6,000원'), false)
const monthly = renderToStaticMarkup(<MonthlyCommissionPanel leads={pending} today="2026-10-14" onSelectLead={() => undefined}/>)
assert.ok(monthly.includes('전체 접수월 · 기준 확인 필요 1묶음'))
assert.ok(monthly.includes('기준 확인 필요'))
assert.equal(monthly.includes('<strong>0원</strong>'), false, 'Pending group cannot be mistaken for a known zero forecast')
const resolved = pending.map(member => ({ ...member, caseBasisLeadId: 'A' }))
const chosen = renderToStaticMarkup(<MonthlyCommissionPanel leads={resolved} today="2026-10-14" onSelectLead={() => undefined}/>)
assert.ok(chosen.includes('2,000원'))
assert.ok(chosen.includes('구매완료 1명'))
assert.equal(chosen.includes('6,000원'), false)
assert.equal(JSON.stringify(pending), before)
console.log('caseBasis metrics UI: one customer, whole basis fee, explicit pending warning and no source mutation passed')
