import type { PartnerPreviewModel } from '../lib/partnerPreview'
import './PartnerPreview.css'

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`
const count = (value: number) => value.toLocaleString('ko-KR')
const monthLabel = (month: string) => { const [year, number] = month.split('-'); return `${year}년 ${Number(number)}월` }
const dateLabel = (date: string | null) => date ? date.replace(/-/g, '.') : '미정'

/** Accepts only the safe projection; no saved documents or staff-only callbacks. */
export function PartnerPreview({ model }: { model: PartnerPreviewModel }) {
  return <section className="partner-preview" aria-label="업체용 화면 미리보기">
    <header className="partner-preview-heading">
      <div><span className="partner-preview-eyebrow">PARTNER VIEW</span><h2>{model.partnerName || '제휴업체를 선택해 주세요'}</h2><p>{monthLabel(model.intakeMonth)} 접수 · 연결 고객은 최초 접수월 기준</p></div>
    </header>

    {model.partnerName ? <>
      <div className="partner-preview-stats">
        <div><span>접수</span><strong>{count(model.receiptCount)}<small>건</small></strong><p>고객 {count(model.customerCount)}명</p></div>
        <div><span>구매완료</span><strong>{count(model.completedCount)}<small>건</small></strong><p>관리중 {count(model.activeCount)}건</p></div>
        <div className="partner-preview-fee"><span>구매완료 예상 수수료</span><strong>{won(model.completedExpectedCommission)}</strong><p>정산월별 금액은 아래에서 확인</p></div>
      </div>

      <section className="partner-preview-settlement" aria-label="업체 월별 예상 정산">
        <div className="partner-preview-section-heading"><h3>월별 예상 정산</h3><p>배송예정월의 익익월 중순 · 실제 수령월에 따라 변동</p></div>
        {model.settlements.length > 0 ? <ul className="partner-preview-months">{model.settlements.map(bucket => <li key={bucket.month}><span>{monthLabel(bucket.month)} 중순 <small>{count(bucket.customerCount)}명</small></span><strong>{won(bucket.expectedCommission)}</strong></li>)}</ul> : <p className="partner-preview-empty">예상 정산월이 정해진 고객이 없습니다.</p>}
        {model.undatedCustomerCount > 0 ? <p className="partner-preview-undated">배송예정일 미입력 {count(model.undatedCustomerCount)}명 · {won(model.undatedExpectedCommission)}은 정산월 미정</p> : null}
      </section>

      <section className="partner-preview-customers" aria-label="자사 연결 고객 현황">
        <div className="partner-preview-section-heading"><h3>연결 고객</h3><small>등록일 최신순</small></div>
        {model.customers.length > 0 ? <div className="partner-preview-table-scroll"><table>
          <thead><tr><th scope="col">고객 / 연락처 뒷자리</th><th scope="col">등록일</th><th scope="col">상태</th><th scope="col">배송예정일</th><th scope="col">예상 정산월</th><th scope="col">예상 수수료</th></tr></thead>
          <tbody>{model.customers.map(customer => <tr key={customer.key}><td className="partner-preview-customer-label">{customer.label}</td><td>{dateLabel(customer.registeredAt)}</td><td><span className={`partner-preview-status${customer.status === '구매완료' ? ' completed' : ''}`}>{customer.status}</span></td><td>{dateLabel(customer.deliveryScheduledDate)}</td><td>{customer.expectedSettlementMonth ? `${monthLabel(customer.expectedSettlementMonth)} 중순` : customer.status === '구매완료' ? '배송일 확인 필요' : '—'}</td><td className="partner-preview-customer-fee">{customer.expectedCommission === null ? '—' : won(customer.expectedCommission)}</td></tr>)}</tbody>
        </table></div> : <p className="partner-preview-empty">선택한 접수월에 연결된 고객이 없습니다.</p>}
      </section>
    </> : <p className="partner-preview-empty">상단에서 업체를 선택하면 해당 업체의 고객만 표시합니다.</p>}
  </section>
}
