import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import type { Lead } from '../types'
import { caseBasisFor, financialCaseLeadFor } from '../lib/caseBasis'
import { customerDisplayLabel } from '../lib/customerDisplay'
import { totalPurchaseAmountFor } from '../lib/salesFinance'
import './CaseMergeChoiceModal.css'

export type CaseMergeChoice = { caseLeadId: string; mergePurchaseAmounts: boolean }

interface CaseMergeChoiceModalProps {
  members: readonly Lead[]
  initialBasisId?: string
  initialMergeMemberIds?: readonly string[]
  disabled?: boolean
  onClose: () => void
  /** Stages a choice in the parent form. This modal never writes customer data. */
  onConfirm: (choice: CaseMergeChoice) => void
}

const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const won = (amount: number) => `${new Intl.NumberFormat('ko-KR').format(amount)}원`
const hasEnteredAmount = (lead: Lead) => lead.lumpSumAmount !== undefined || lead.subscriptionAmount !== undefined || lead.purchaseAmount !== undefined
const amountLabel = (lead?: Lead) => lead ? hasEnteredAmount(lead) ? won(totalPurchaseAmountFor(lead)) : '금액 미입력' : '기준 선택 필요'

export function CaseMergeChoiceModal({ members, initialMergeMemberIds, disabled = false, onClose, onConfirm }: CaseMergeChoiceModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const radioName = useId()
  const mergeHelpId = useId()
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  // Neither the caller's active row nor a previous selection grants new consent.
  const [primaryId, setPrimaryId] = useState('')
  const [mergePurchaseAmounts, setMergePurchaseAmounts] = useState(false)

  const beforeSelection = caseBasisFor(members)
  const beforeLead = financialCaseLeadFor(beforeSelection, members)
  const candidates = members.map(member => {
    const selection = caseBasisFor(members, member.id, null)
    return { member, selection, projection: financialCaseLeadFor(selection, members) }
  })
  const primary = candidates.find(candidate => candidate.member.id === primaryId)
  const mergeSelection = primary ? caseBasisFor(members, primaryId, members.map(member => member.id).sort()) : undefined
  const mergedLead = mergeSelection ? financialCaseLeadFor(mergeSelection, members) : undefined
  const canMerge = !!mergedLead && mergeSelection?.status !== 'unresolved'
  const afterLead = mergePurchaseAmounts ? mergedLead : primary?.projection
  const afterSelection = mergePurchaseAmounts ? mergeSelection : primary?.selection
  const canApply = !disabled && !!primary && !!afterLead && afterSelection?.status !== 'unresolved'

  useEffect(() => {
    if (typeof document === 'undefined') return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const body = document.body
    const previousOverflow = body.style.getPropertyValue('overflow')
    const previousOverflowPriority = body.style.getPropertyPriority('overflow')
    const background = Array.from(body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlayRef.current && !['SCRIPT', 'STYLE'].includes(element.tagName))
      .map(element => ({ element, inert: element.getAttribute('inert') }))
    body.style.setProperty('overflow', 'hidden')
    background.forEach(({ element }) => element.setAttribute('inert', ''))
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
      if (!controls.length) {
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
      background.forEach(({ element, inert }) => inert === null ? element.removeAttribute('inert') : element.setAttribute('inert', inert))
      if (previousOverflow) body.style.setProperty('overflow', previousOverflow, previousOverflowPriority)
      else body.style.removeProperty('overflow')
      if (opener?.isConnected) opener.focus()
    }
  }, [onClose])

  const confirm = () => {
    if (canApply) onConfirm({ caseLeadId: primaryId, mergePurchaseAmounts })
  }

  const modal = (
    <div ref={overlayRef} className="case-merge-overlay">
      <button type="button" className="case-merge-scrim" tabIndex={-1} onClick={onClose} aria-label="묶음 처리 선택 닫기" />
      <section ref={dialogRef} className="case-merge-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <header>
          <h2 id={titleId}>고객 묶기</h2>
          <button ref={closeButtonRef} type="button" className="case-merge-close" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </header>
        <div className="case-merge-content">
          <p id={descriptionId} className="case-merge-description">담당자·상태·배송일 기준을 선택하세요.</p>
          {initialMergeMemberIds && initialMergeMemberIds.length > 1 ? <p className="case-merge-current">현재 금액 합산 중 · {amountLabel(beforeLead)}</p> : null}
          <fieldset className="case-merge-candidates" disabled={disabled}>
            <legend>기준 고객</legend>
            {candidates.map(({ member, selection, projection }) => (
              <label key={member.id} className={`case-merge-candidate${primaryId === member.id ? ' selected' : ''}`}>
                <input type="radio" name={radioName} aria-label={customerDisplayLabel(member)} checked={primaryId === member.id} disabled={!projection || selection.status === 'unresolved'} onChange={() => { setPrimaryId(member.id); setMergePurchaseAmounts(false) }} />
                <span><strong>{customerDisplayLabel(member)}</strong><small>{member.manager || '담당자 미지정'} · {member.status}</small></span>
                <b>{amountLabel(projection)}</b>
                {selection.status === 'unresolved' ? <em>{selection.reason}</em> : null}
              </label>
            ))}
          </fieldset>
          {!members.length ? <p className="case-merge-warning" role="status">묶을 고객을 먼저 선택해주세요.</p> : null}
          <label className="case-merge-extra">
            <input type="checkbox" aria-label="구매금액도 합산" aria-describedby={mergeHelpId} checked={mergePurchaseAmounts} disabled={disabled || !canMerge} onChange={event => setMergePurchaseAmounts(event.target.checked)} />
            <span><strong>구매금액도 합산 <small>선택</small></strong><small id={mergeHelpId}>미선택 시 기준 고객 금액 유지</small></span>
          </label>
          {primary && mergeSelection?.status === 'unresolved' ? <p className="case-merge-warning" role="status">금액 합산 불가: {mergeSelection.reason}</p> : null}
          <div className="case-merge-result" aria-live="polite" aria-atomic="true"><span>적용 금액</span><strong>{primary ? amountLabel(afterLead) : '고객을 선택해주세요'}</strong></div>
          {primary ? <p className="case-merge-delivery">배송예정일 {primary.member.deliveryScheduledDate || '미입력'}</p> : null}
          <p className="case-merge-save-note">원본 기록은 보존됩니다. 선택 후 ‘변경사항 저장’을 눌러주세요.</p>
        </div>
        <footer>
          <button type="button" className="case-merge-secondary" onClick={onClose}>취소</button>
          <button type="button" className="case-merge-primary" disabled={!canApply} onClick={confirm}><Check size={16} />선택 적용</button>
        </footer>
      </section>
    </div>
  )
  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}
