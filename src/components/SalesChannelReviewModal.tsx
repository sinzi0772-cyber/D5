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

  return createPortal(<div className="sales-review-overlay">
    <button type="button" className="sales-review-scrim" tabIndex={-1} aria-label="판매경로 점검 닫기" onClick={onClose}/>
    <section className="sales-review-modal" role="dialog" aria-modal="true" aria-labelledby="sales-review-title" aria-describedby="sales-review-description" ref={dialog} tabIndex={-1}>
      <header><div><span><AlertCircle size={16} aria-hidden="true"/>판매경로 점검 · {items.length}개</span><h2 id="sales-review-title">웨딩업체 연결 주문의 판매경로를 확인해주세요</h2></div><button type="button" ref={closeButton} aria-label="닫기" onClick={onClose}><X size={20}/></button></header>
      <div className="sales-review-body">
        <p id="sales-review-description">제휴업체가 연결한 고객인데, 매장 주문의 판매경로가 수수료 지급 경로와 다르게 등록돼 있습니다.</p>
        <p className="sales-review-note">해당 주문의 판매경로를 매장 전산에서 확인해주세요.</p>
        <details className="sales-review-expected"><summary>수수료 지급 경로 보기</summary><dl><div><dt>판매경로 1</dt><dd>{SALES_COMMISSION_CHANNEL1}</dd></div><div><dt>판매경로 2</dt><dd>{SALES_COMMISSION_CHANNEL2.join(' 또는 ')}</dd></div></dl></details>
        <ul className="sales-review-items">{items.map(item => <li key={item.key}>
          <div className="sales-review-item-heading"><div><strong>{item.customerLabel}</strong><span>{item.partnerName}</span></div><span>{item.kind === 'lumpSum' ? '일시불' : '구독'}{item.period ? ' · '+item.period.replace('-', '.') : ''}</span></div>
          <p className="sales-review-manager">담당 {item.managerLabel || '미배정'}</p>
          <dl><div><dt>등록된 경로 1</dt><dd className={item.channel1 !== SALES_COMMISSION_CHANNEL1 ? 'different' : ''}>{item.channel1}</dd></div><div><dt>등록된 경로 2</dt><dd className={!SALES_COMMISSION_CHANNEL2.some(channel => channel === item.channel2) ? 'different' : ''}>{item.channel2}</dd></div></dl>
          <button type="button" className="sales-review-customer" onClick={() => onSelectLead(item.leadId)}>고객 상세 확인<ArrowUpRight size={14} aria-hidden="true"/></button>
        </li>)}</ul>
      </div>
      <footer><span>미해결 건은 다음 로그인에도 안내합니다.</span><button type="button" className="btn primary" onClick={onClose}>확인했습니다</button></footer>
    </section>
  </div>, document.body)
}
