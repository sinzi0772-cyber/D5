import { useMemo, useState } from 'react'
import { ArrowUpRight, CalendarDays, Truck } from 'lucide-react'
import { buildCommissionSettlementMetrics } from '../lib/commissionSettlement'
import { expectedRebateFor } from '../lib/salesFinance'
import { customerDisplayLabel } from '../lib/customerDisplay'
import type { Lead } from '../types'
import './MonthlyCommissionPanel.css'

const won = (amount: number) => `${Math.round(amount).toLocaleString('ko-KR')}원`
const monthLabel = (month: string) => { const [year, number] = month.split('-'); return `${year}년 ${Number(number)}월` }
const monthIndex = (month: string) => { const [year, number] = month.split('-').map(Number); return year * 12 + number - 1 }

function defaultSettlementMonth(months: readonly string[], currentMonth: string) {
  if (months.includes(currentMonth)) return currentMonth
  return months.find(month => monthIndex(month) > monthIndex(currentMonth)) || months.at(-1) || currentMonth
}

export function MonthlyCommissionPanel({ leads, partnerName, today, onSelectLead }: {
  leads: Lead[]
  partnerName?: string
  today: string
  onSelectLead: (lead: Lead) => void
}) {
  const [chosenMonth, setChosenMonth] = useState('')
  const metrics = useMemo(() => buildCommissionSettlementMetrics(leads, partnerName), [leads, partnerName])
  const currentMonth = today.slice(0, 7)
  const month = chosenMonth || defaultSettlementMonth(metrics.months.map(bucket => bucket.month), currentMonth)
  const months = [...new Set([currentMonth, month, ...metrics.months.map(bucket => bucket.month)])].sort((a, b) => monthIndex(a) - monthIndex(b))
  const selected = metrics.months.find(bucket => bucket.month === month)
  const partners = selected ? [...selected.partners].sort((a, b) => b.expectedCommission - a.expectedCommission || a.name.localeCompare(b.name, 'ko')) : []

  return <section className="monthly-commission" aria-label="월별 예상 정산 수수료">
    <header className="monthly-commission-heading">
      <div><span className="monthly-commission-eyebrow"><Truck size={14} aria-hidden="true"/>DELIVERY · SETTLEMENT</span><h3>월별 예상 정산 수수료</h3><p>접수월과 관계없이 구매완료 고객을 배송예정월의 익익월 중순으로 구분합니다. 실제 제품 수령월에 따라 정산월은 달라질 수 있습니다.</p></div>
      <label className="monthly-commission-period"><CalendarDays size={16} aria-hidden="true"/><span>예상 정산월</span><select aria-label="예상 정산월" value={month} onChange={event => setChosenMonth(event.target.value)}>{months.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label>
    </header>

    <div className="monthly-commission-summary">
      <div className="monthly-commission-selected" aria-live="polite"><span>{monthLabel(month)} 중순 예상</span><strong>{won(selected?.expectedCommission || 0)}</strong><small>{selected ? `구매완료 고객 ${selected.customerCount.toLocaleString('ko-KR')}명 · 연결 접수 ${selected.caseCount.toLocaleString('ko-KR')}건` : '이 정산월에 예정된 구매완료 고객이 없습니다.'}</small></div>
      <div className={`monthly-commission-undated${metrics.unscheduledCustomerCount > 0 ? ' needs-input' : ''}`}><span>배송예정일 미입력 · 정산월 미정</span><strong>{won(metrics.unscheduledExpectedCommission)}</strong><small>{metrics.unscheduledCustomerCount > 0 ? `구매완료 고객 ${metrics.unscheduledCustomerCount.toLocaleString('ko-KR')}명 · 배송일을 입력하면 정산월에 반영됩니다.` : metrics.completedCustomerCount > 0 ? '구매완료 고객의 배송예정일이 모두 입력되어 있습니다.' : '구매완료 고객이 없습니다.'}</small></div>
    </div>
    <p className="monthly-commission-note">배송일 입력 완료 {metrics.scheduledCustomerCount.toLocaleString('ko-KR')}명 · 월별 분류 합계 {won(metrics.scheduledExpectedCommission)} · 미입력 금액은 정산월별 합계에서 제외합니다.{metrics.unfinishedCustomerCount > 0 ? ` 구매완료 상태가 아닌 고객 ${metrics.unfinishedCustomerCount.toLocaleString('ko-KR')}명의 예상 수수료 ${won(metrics.unfinishedExpectedCommission)}도 월별 정산에서는 제외합니다.` : ''}</p>

    <details className="monthly-commission-details">
      <summary><i className="details-toggle-mark" aria-hidden="true"/><strong>선택 정산월 업체별 내역</strong><small>{partners.length.toLocaleString('ko-KR')}개 업체 · + / − 상세 보기</small></summary>
      <div className="monthly-commission-detail-body">
        {partners.length > 0 ? <div className="monthly-commission-table-scroll"><table className="monthly-commission-table"><caption>{monthLabel(month)} 중순 예상 · 예상 수수료 금액순</caption><thead><tr><th scope="col">제휴업체</th><th scope="col">구매완료 고객</th><th scope="col">연결 접수</th><th scope="col">예상 수수료</th></tr></thead><tbody>{partners.map(partner => <tr key={partner.name}><td>{partner.name || '업체 미입력'}</td><td>{partner.customerCount.toLocaleString('ko-KR')}명</td><td>{partner.caseCount.toLocaleString('ko-KR')}건</td><td className="monthly-commission-money">{won(partner.expectedCommission)}</td></tr>)}</tbody><tfoot><tr><th scope="row" colSpan={3}>선택 정산월 예상 수수료 합계</th><td className="monthly-commission-money">{won(selected?.expectedCommission || 0)}</td></tr></tfoot></table></div> : <p className="monthly-commission-empty">이 정산월에 예정된 수수료 내역이 없습니다. 구매완료 고객의 배송예정일을 입력해 주세요.</p>}
      </div>
    </details>

    {metrics.unscheduledCustomerCount > 0 ? <details className="monthly-commission-details monthly-commission-missing">
      <summary><i className="details-toggle-mark" aria-hidden="true"/><strong>배송예정일 입력이 필요한 고객</strong><small>{metrics.unscheduledCustomerCount.toLocaleString('ko-KR')}명 · + / − 상세 보기</small></summary>
      <div className="monthly-commission-detail-body"><div className="monthly-commission-table-scroll"><table className="monthly-commission-table monthly-commission-customers"><caption>고객을 누르면 배송예정일을 입력할 수 있습니다. 고객별 금액만 합산하며 연결 고객의 기존 정보는 유지합니다.</caption><thead><tr><th scope="col">고객 · 배송일 입력</th><th scope="col">제휴업체</th><th scope="col">담당자</th><th scope="col">예상 수수료</th></tr></thead><tbody>{metrics.unscheduledLeads.map(lead => <tr key={lead.id}><td><button type="button" className="monthly-commission-customer" aria-label={`${customerDisplayLabel(lead)} 배송예정일 입력`} title={`${customerDisplayLabel(lead)} 배송예정일 입력`} onClick={() => onSelectLead(lead)}><span>{customerDisplayLabel(lead)}<ArrowUpRight size={13} aria-hidden="true"/></span></button></td><td>{lead.partnerName || '업체 미입력'}</td><td>{lead.manager || '미배정'}</td><td className="monthly-commission-money">{won(expectedRebateFor(lead))}</td></tr>)}</tbody></table></div></div>
    </details> : null}
  </section>
}
