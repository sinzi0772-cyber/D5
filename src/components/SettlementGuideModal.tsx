import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { SALES_COMMISSION_CHANNEL1, SALES_COMMISSION_CHANNEL2 } from '../lib/salesRaw'
import './SettlementGuideModal.css'

const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function SettlementGuideModal({ onClose, audience = 'staff' }: { onClose: () => void; audience?: 'staff' | 'partner' }) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (typeof document === 'undefined') return

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const body = document.body
    const previousOverflow = body.style.getPropertyValue('overflow')
    const previousOverflowPriority = body.style.getPropertyPriority('overflow')
    body.style.setProperty('overflow', 'hidden')
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter(control => control.tabIndex >= 0 && !control.closest('[hidden], [inert]') && control.getClientRects().length > 0)
      if (controls.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const activeIndex = controls.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault()
        controls[controls.length - 1].focus()
      } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === controls.length - 1)) {
        event.preventDefault()
        controls[0].focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      if (previousOverflow) body.style.setProperty('overflow', previousOverflow, previousOverflowPriority)
      else body.style.removeProperty('overflow')
      if (opener?.isConnected) opener.focus()
    }
  }, [onClose])

  const modal = (
    <div className="guide-overlay">
      <button type="button" className="guide-scrim" tabIndex={-1} onClick={onClose} aria-label="제휴·정산 안내 닫기" />
      <section ref={dialogRef} className="guide-modal" role="dialog" aria-modal="true" aria-label="제휴 접수 및 정산 안내" tabIndex={-1}>
        <header>
          <div>
            <span>PARTNER GUIDE</span>
            <h2>제휴·정산 안내</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </header>
        <div className="guide-intro">
          <span>고객 접수</span>
          <strong>이업종제휴 접수를 우선 이용해 주세요.</strong>
        </div>
        <div className="guide-types">
          <article className="primary">
            <b>01</b>
            <div>
              <strong>이업종제휴 <em>우선 접수</em></strong>
              <p>업체가 매장에 고객을 직접 연결</p>
              <a href="https://newbest.lge.com" target="_blank" rel="noreferrer">이업종제휴 접수 주소 <span>newbest.lge.com →</span></a>
            </div>
          </article>
          <article>
            <b>02</b>
            <div>
              <strong>상담예약(이업종)</strong>
              <p>고객이 전용 URL로 직접 접수</p>
            </div>
          </article>
        </div>
        <div className="guide-policy">
          <h3>정산 기준</h3>
          <ul>
            <li>
              <strong>제휴 연결 주문의 판매 RAW 기준</strong>
              <span>일시불 ‘매출·주문확정’, 구독 ‘마감됨·주문확정’을 예상 수수료에 반영합니다.</span>
              <span>구독 수수료는 대상 제휴업체에 적용합니다.</span>
            </li>
            {audience === 'staff' ? <li>
              <strong>판매경로 점검 기준</strong>
              <span>판매경로 1: {SALES_COMMISSION_CHANNEL1}</span>
              <span>판매경로 2: {SALES_COMMISSION_CHANNEL2.join(' 또는 ')}</span>
            </li> : null}
            <li>
              <strong>접수한 매장에서 구매 시 정산</strong>
              <span>다른 지점에서 구매하면 제외됩니다.</span>
            </li>
            <li>
              <strong>2곳 이상 비교 방문 시 매장별 접수</strong>
              <span>각 매장에 업체등록과 고객 URL 접수를 모두 남겨주세요.</span>
            </li>
            <li>
              <strong>제품 수령월의 익익월 중순 입금</strong>
              <span>예: 10월 수령 → 12월 중순 정산</span>
            </li>
          </ul>
        </div>
        <footer>
          <button type="button" className="btn primary" onClick={onClose}><Check size={16} />확인했습니다</button>
        </footer>
      </section>
    </div>
  )

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}
