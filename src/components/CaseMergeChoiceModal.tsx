import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Check, GitMerge, X } from 'lucide-react'
import type { Lead } from '../types'
import { caseBasisFor, financialCaseLeadFor } from '../lib/caseBasis'
import { customerDisplayLabel } from '../lib/customerDisplay'
import { lumpSumAmountFor, subscriptionAmountFor, totalPurchaseAmountFor } from '../lib/salesFinance'
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

export function CaseMergeChoiceModal({ members, initialBasisId, initialMergeMemberIds, disabled = false, onClose, onConfirm }: CaseMergeChoiceModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const basisSelectId = useId()
  const radioName = useId()
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [step, setStep] = useState<'choose' | 'retain' | 'merge'>('choose')
  const [primaryId, setPrimaryId] = useState(() => members.some(member => member.id === initialBasisId) ? initialBasisId! : members[0]?.id || '')
  // No yes/no default: adding purchase amounts requires a separate user choice.
  const [mergePurchaseAmounts, setMergePurchaseAmounts] = useState<boolean | null>(null)

  // The initial representative is only a visible form default. It must not
  // resolve an existing pending group before the user has made a choice.
  const beforeSelection = caseBasisFor(members)
  const beforeLead = financialCaseLeadFor(beforeSelection, members)
  const candidates = members.map(member => {
    const selection = caseBasisFor(members, member.id, null)
    return { member, selection, projection: financialCaseLeadFor(selection, members) }
  })
  const primary = candidates.find(candidate => candidate.member.id === primaryId)
  const mergeSelection = caseBasisFor(members, primaryId, members.map(member => member.id).sort())
  const mergedLead = financialCaseLeadFor(mergeSelection, members)
  const isMerge = step === 'merge'
  const selectedMerge = isMerge && mergePurchaseAmounts === true
  const afterLead = selectedMerge ? mergedLead : primary?.projection
  const afterSelection = selectedMerge ? mergeSelection : primary?.selection
  const choiceMade = step === 'retain' || isMerge && mergePurchaseAmounts !== null
  const canApply = !disabled && choiceMade && !!primary && !!afterLead && afterSelection?.status !== 'unresolved'
  const mergeLabel = members.length > 2 ? '고객들 합치기' : '두 고객 합치기'

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

  useEffect(() => {
    if (step !== 'choose') dialogRef.current?.focus()
  }, [step])

  const returnToChoices = () => {
    setStep('choose')
    setMergePurchaseAmounts(null)
  }
  const confirm = () => {
    if (canApply) onConfirm({ caseLeadId: primaryId, mergePurchaseAmounts: selectedMerge })
  }

  const modal = (
    <div ref={overlayRef} className="case-merge-overlay">
      <button type="button" className="case-merge-scrim" tabIndex={-1} onClick={onClose} aria-label="묶음 처리 선택 닫기" />
      <section ref={dialogRef} className="case-merge-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <header>
          <div><span>묶음 고객 · 1명으로 관리</span><h2 id={titleId}>{step === 'choose' ? '어떻게 처리할까요?' : isMerge ? '구매금액도 합치시겠습니까?' : '이 고객의 정보를 유지할까요?'}</h2></div>
          <button ref={closeButtonRef} type="button" className="case-merge-close" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </header>
        <div className="case-merge-content">
          <p id={descriptionId} className="case-merge-description">어떤 선택이든 고객은 1명으로 집계합니다. 원본 고객 기록·수기 입력·관리 이력은 삭제하지 않습니다.</p>
          {initialMergeMemberIds && initialMergeMemberIds.length > 1 ? <p className="case-merge-note">현재 구매금액 합산 선택이 있습니다. 아래에서 다시 선택하기 전에는 기존 선택을 변경하지 않습니다.</p> : null}
          {step === 'choose' ? <>
            <div className="case-merge-candidates">
              {candidates.map(({ member, selection, projection }) => (
                <button key={member.id} type="button" className="case-merge-candidate" disabled={disabled || !projection || selection.status === 'unresolved'} onClick={() => { setPrimaryId(member.id); setMergePurchaseAmounts(false); setStep('retain') }}>
                  <span><strong>{customerDisplayLabel(member)} 고객 유지</strong><small>이 고객의 구매금액·담당자·상태·배송일을 기준으로 사용</small></span>
                  <b>{amountLabel(projection)}</b>
                  {selection.status === 'unresolved' ? <em>{selection.reason}</em> : null}
                </button>
              ))}
              <button type="button" className="case-merge-candidate case-merge-combine" disabled={disabled || members.length < 2} onClick={() => { setMergePurchaseAmounts(null); setStep('merge') }}><span><strong><GitMerge size={17} />{mergeLabel}</strong><small>다음 단계에서 구매금액 합산 여부를 별도로 선택</small></span></button>
            </div>
            {!members.length ? <p className="case-merge-warning" role="status">묶을 고객을 먼저 선택해주세요.</p> : null}
          </> : <>
            {isMerge ? <>
              <label className="case-merge-basis" htmlFor={basisSelectId}>담당자·상태·배송일 기준 고객
                <select id={basisSelectId} value={primaryId} disabled={disabled} onChange={event => setPrimaryId(event.target.value)}>
                  {candidates.map(({ member, projection }) => <option key={member.id} value={member.id} disabled={!projection}>{customerDisplayLabel(member)}</option>)}
                </select>
                <small>표시된 고객의 정보를 기준으로 사용합니다. 다른 고객의 개인 기록은 보존됩니다.</small>
              </label>
              <fieldset className="case-merge-amount-choice" disabled={disabled}>
                <legend>구매금액 처리 방법 <span>직접 선택해주세요</span></legend>
                <label className={mergePurchaseAmounts === false ? 'selected' : ''}><input type="radio" name={radioName} checked={mergePurchaseAmounts === false} disabled={!primary?.projection} onChange={() => setMergePurchaseAmounts(false)} /><span><strong>고객만 합치기</strong><small>구매금액은 기준 고객의 금액만 유지합니다.</small></span><b>{amountLabel(primary?.projection)}</b></label>
                <label className={mergePurchaseAmounts === true ? 'selected' : ''}><input type="radio" name={radioName} checked={mergePurchaseAmounts === true} disabled={!mergedLead || mergeSelection.status === 'unresolved'} onChange={() => setMergePurchaseAmounts(true)} /><span><strong>고객·구매금액 합치기</strong><small>각 원본 고객의 독립적인 구매금액을 합칩니다.</small></span><b>{amountLabel(mergedLead)}</b></label>
              </fieldset>
              {mergeSelection.status === 'unresolved' ? <p className="case-merge-warning" role="status">금액 합산 불가: {mergeSelection.reason}</p> : null}
              <p className="case-merge-note">이미 공유된 동일 원본 금액은 한 번만 반영합니다. 합산할 금액을 임의로 추정하거나 가장 큰 값으로 선택하지 않습니다.</p>
            </> : <p className="case-merge-retain"><strong>{primary ? customerDisplayLabel(primary.member) : '기준 고객'} 고객 유지</strong><span>다른 고객의 금액을 더하지 않습니다. 담당자·상태·배송일은 선택한 고객을 기준으로 사용합니다.</span></p>}
            <div className="case-merge-preview" aria-live="polite" aria-atomic="true">
              <h3>선택 적용 후 미리보기</h3>
              <dl><div><dt>적용 전 묶음 총판매금액</dt><dd>{amountLabel(beforeLead)}</dd></div><div className="case-merge-after"><dt>적용 후 총판매금액</dt><dd>{choiceMade ? amountLabel(afterLead) : '처리 방법을 선택해주세요'}</dd></div><div><dt>고객 수</dt><dd>1명 <small>원본 기록 {members.length}개 보존</small></dd></div></dl>
              {choiceMade && afterLead ? <p className="case-merge-breakdown">일시불 {won(lumpSumAmountFor(afterLead))} · 구독 {won(subscriptionAmountFor(afterLead))}</p> : null}
              {choiceMade && primary ? <p className="case-merge-operation"><strong>{selectedMerge ? '고객·구매금액 합산' : isMerge ? '고객만 합치기 · 금액 미합산' : '선택 고객 유지 · 금액 미합산'}</strong><span>정보 기준: {customerDisplayLabel(primary.member)} · {primary.member.manager || '담당자 미지정'} · {primary.member.status} · 배송 {primary.member.deliveryScheduledDate || '미입력'}</span></p> : null}
              {afterSelection?.status === 'unresolved' ? <p className="case-merge-warning">{afterSelection.reason}</p> : null}
            </div>
          </>}
          <p className="case-merge-save-note">‘선택 적용’은 편집 중인 화면에만 반영됩니다. 변경사항 저장 전에는 고객 데이터가 변경되지 않습니다.</p>
        </div>
        <footer>
          {step === 'choose' ? <button type="button" className="case-merge-secondary" onClick={onClose}>취소</button> : <button type="button" className="case-merge-secondary" disabled={disabled} onClick={returnToChoices}><ArrowLeft size={15} />다시 선택</button>}
          {step !== 'choose' ? <button type="button" className="case-merge-primary" disabled={!canApply} onClick={confirm}><Check size={16} />선택 적용</button> : null}
        </footer>
      </section>
    </div>
  )
  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}
