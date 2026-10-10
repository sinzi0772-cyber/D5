import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import './SettlementGuideModal.css'

const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function SettlementGuideModal({ onClose }: { onClose: () => void }) {
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
            <h2>제휴 접수·정산 기준 안내</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </header>
        <div className="guide-intro">
          <span>고객 접수방법 2가지</span>
          <strong>이업종제휴 접수를 우선으로 확인해주세요.</strong>
        </div>
        <div className="guide-types">
          <article className="primary">
            <b>01</b>
            <div>
              <strong>이업종제휴 <em>우선 접수</em></strong>
              <p>제휴업체가 고객을 매장에 직접 연결해 접수하는 방식입니다.</p>
              <a href="https://newbest.lge.com" target="_blank" rel="noreferrer">이업종제휴 접수 주소 <span>newbest.lge.com →</span></a>
            </div>
          </article>
          <article>
            <b>02</b>
            <div>
              <strong>상담예약(이업종)</strong>
              <p>고객이 전용 URL을 통해 직접 상담을 접수하는 방식입니다.</p>
            </div>
          </article>
        </div>
        <div className="guide-policy">
          <h3>LG 제휴 수수료 정산 기준</h3>
          <ul>
            <li>
              <strong>연결 매장과 구매 매장이 같아야 합니다.</strong>
              <span>업체가 A지점으로 연결한 고객은 A지점에서 구매해야 정산 대상입니다.</span>
            </li>
            <li>
              <strong>다른 지점에서 구매하면 정산 대상이 아닙니다.</strong>
              <span>A지점으로 연결됐지만 B지점에서 구매한 경우에는 제외됩니다.</span>
            </li>
            <li>
              <strong>비교 방문 매장이 2곳 이상이면 각각 접수해야 합니다.</strong>
              <span>업체등록과 고객등록(URL 접수), 두 가지 방법으로 매장별 접수를 남겨야 합니다.</span>
            </li>
            <li>
              <strong>제품 수령월 기준 익익월 중순에 입금됩니다.</strong>
              <span>제휴 수수료는 고객이 제품을 받은 달로부터 두 달 뒤 중순에 정산됩니다.</span>
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
