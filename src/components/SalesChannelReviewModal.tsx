import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ArrowUpRight, X } from 'lucide-react'
import { SALES_COMMISSION_CHANNEL1, SALES_COMMISSION_CHANNEL2 } from '../lib/salesRaw'
import type { SalesChannelReviewItem } from '../lib/salesChannelReview'
import './SalesChannelReviewModal.css'

const focusable = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export function SalesChannelReviewModal({ items, onClose, onSelectLead }: {
  items: readonly SalesChannelReviewItem[]
  onClose: () => void
  onSelectLead: (leadId: string) => void
}) {
  const dialog = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>(focusable) || []).filter(element => element.getClientRects().length > 0)
      const first = elements[0], last = elements.at(-1)
      if (!first) { event.preventDefault(); dialog.current?.focus(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus()
    }
  }, [onClose])

  const groups = [
    { status: 'mismatch', label: '경로 불일치', rows: items.filter(item => item.status === 'mismatch') },
    { status: 'unverified', label: '경로 확인 필요', rows: items.filter(item => item.status === 'unverified') },
  ]
  const modal = <div className="sales-review-overlay">
    <button type="button" className="sales-review-scrim" tabIndex={-1} aria-label="판매경로 점검 닫기" onClick={onClose}/>
    <section className="sales-review-modal" role="dialog" aria-modal="true" aria-labelledby="sales-review-title" aria-describedby="sales-review-description" ref={dialog} tabIndex={-1}>
      <header><div><span><AlertCircle size={16} aria-hidden="true"/>판매경로 점검 · {items.length}개</span><h2 id="sales-review-title">웨딩업체 연결 주문의 판매경로를 확인해주세요</h2></div><button type="button" ref={closeButton} aria-label="닫기" onClick={onClose}><X size={20}/></button></header>
      <div className="sales-review-body">
        <p id="sales-review-description">제휴업체가 연결한 구매완료 고객의 확정 주문을 점검합니다. 예상 수수료는 일시불 ‘매출·주문확정’, 구독 ‘마감됨·주문확정’을 기준으로 계산합니다.</p>
        <details className="sales-review-expected"><summary>판매경로 점검 기준 보기</summary><dl><div><dt>판매경로 1</dt><dd>{SALES_COMMISSION_CHANNEL1}</dd></div><div><dt>판매경로 2</dt><dd>{SALES_COMMISSION_CHANNEL2.join(' 또는 ')}</dd></div></dl></details>
        {groups.map(({ status, label, rows }) => rows.length > 0 && <section className="sales-review-group" key={status} aria-label={label}>
          <h3>{label} {rows.length}건</h3>
          <ul className="sales-review-items">{rows.map(item => {
            const unverified = status === 'unverified'
            const months = item.periods || (item.period ? [item.period] : [])
            const saleMonths = months.map(month => month.replace('-', '.')).join(', ')
            return <li className={unverified ? 'sales-review-unverified' : undefined} key={item.key}>
              <div className="sales-review-item-heading"><div><strong>{item.customerLabel}</strong><span>{item.partnerName}</span></div><span>{item.kind === 'lumpSum' ? '일시불' : '구독'}{saleMonths ? ' · '+saleMonths : ''}</span></div>
              <p className="sales-review-manager">담당 {item.managerLabel || '미배정'}{item.intakeDate ? <> · 접수일 <time dateTime={item.intakeDate}>{item.intakeDate.replaceAll('-', '.')}</time></> : null}</p>
              {unverified && <p className="sales-review-reason">확정 주문의 판매경로를 원본에서 확인해주세요.</p>}
              <dl><div><dt>판매경로 1</dt><dd className={!unverified && item.channel1 !== SALES_COMMISSION_CHANNEL1 ? 'different' : undefined}>{item.channel1 || '미확인'}</dd></div><div><dt>판매경로 2</dt><dd className={!unverified && !SALES_COMMISSION_CHANNEL2.some(channel => channel === item.channel2) ? 'different' : undefined}>{item.channel2 || '미확인'}</dd></div>{item.staffRoute && <><div><dt>수기 경로 1</dt><dd>{item.staffRoute.channel1}</dd></div><div><dt>수기 경로 2</dt><dd>{item.staffRoute.channel2}</dd></div></>}</dl>
              <button type="button" className="sales-review-customer" onClick={() => onSelectLead(item.leadId)}>고객 상세 확인<ArrowUpRight size={14} aria-hidden="true"/></button>
            </li>
          })}</ul>
        </section>)}
      </div>
      <footer><span>미해결 건은 다음 로그인에도 안내합니다.</span><button type="button" className="btn primary" onClick={onClose}>확인했습니다</button></footer>
    </section>
  </div>
  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}
