import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { UPDATE_HISTORY } from '../data/updateHistory'
import './UpdateHistoryModal.css'

export function UpdateHistoryModal({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.getPropertyValue('overflow')
    const previousPriority = document.body.style.getPropertyPriority('overflow')
    document.body.style.setProperty('overflow', 'hidden')
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [])
        .filter(control => control.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      if (!first) { event.preventDefault(); dialog.current?.focus(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (previousOverflow) document.body.style.setProperty('overflow', previousOverflow, previousPriority)
      else document.body.style.removeProperty('overflow')
      if (opener?.isConnected) opener.focus()
    }
  }, [onClose])

  const modal = <div className="update-history-overlay">
    <button className="update-history-scrim" type="button" tabIndex={-1} aria-label="업데이트 내역 닫기" onClick={onClose}/>
    <section ref={dialog} className="update-history-modal" role="dialog" aria-modal="true" aria-labelledby="update-history-title" tabIndex={-1}>
      <header><h2 id="update-history-title">업데이트 내역</h2><button ref={closeButton} type="button" aria-label="닫기" onClick={onClose}><X size={20}/></button></header>
      <ol>{UPDATE_HISTORY.map(item => <li key={item.date + ':' + item.summary}><time dateTime={item.date}>{item.date.replaceAll('-', '.')}</time><span>{item.summary}</span></li>)}</ol>
      <footer><button type="button" className="btn primary" onClick={onClose}>닫기</button></footer>
    </section>
  </div>
  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}
