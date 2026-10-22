import type { ReactNode } from 'react'
import type { Lead } from '../types'
import { customerDisplayLabel } from '../lib/customerDisplay'

interface CaseGroupSummaryProps {
  members: readonly Lead[]
  activeLeadId: string
  basisLabel?: string
  basisLeadId?: string
  amountMode: 'pending' | 'single' | 'merged'
  pendingReason?: string
  staged: boolean
  choiceOpen: boolean
  disabled: boolean
  onChoose?: () => void
  onSelectMember?: (member: Lead) => void
  onUnlink?: () => void
  unlinkBusy: boolean
  children: ReactNode
}

/** Display only: choice and save behavior remain owned by the editor. */
export function CaseGroupSummary({ members, activeLeadId, basisLabel, basisLeadId, amountMode, pendingReason, staged, choiceOpen, disabled, onChoose, onSelectMember, onUnlink, unlinkBusy, children }: CaseGroupSummaryProps) {
  const pending = amountMode === 'pending'
  const memberStatus = (member: Lead) => !pending && basisLeadId && member.id !== basisLeadId ? '집계 제외' : member.status
  return <section className={`linked-case case-group-summary${pending ? ' case-group-pending' : ''}`} aria-label="묶음 고객 요약">
    <header><h3>묶음 고객</h3><span>1명으로 집계</span></header>
    <div className="case-group-members" aria-label="묶인 고객">
      {members.map(member => onSelectMember
        ? <button type="button" key={member.id} className={member.id === activeLeadId ? 'active' : ''} aria-pressed={member.id === activeLeadId} disabled={disabled || unlinkBusy} onClick={() => onSelectMember(member)}><span>{customerDisplayLabel(member)}</span><small title={`원본 상태: ${member.status}`}>{memberStatus(member)}</small></button>
        : <span className="case-group-member" key={member.id}><strong>{customerDisplayLabel(member)}</strong><small title={`원본 상태: ${member.status}`}>{memberStatus(member)}</small></span>)}
    </div>
    <div className="case-group-treatment">
      <dl aria-live="polite"><div><dt>기준 고객</dt><dd>{pending ? '선택 필요' : basisLabel || '미정'}</dd></div><div><dt>구매금액</dt><dd>{pending ? '선택 후 반영' : amountMode === 'merged' ? '구매금액 합산' : '기준 고객 금액 유지'}</dd></div></dl>
      <button type="button" className="case-group-change" aria-label="묶음 처리 선택" aria-haspopup="dialog" aria-expanded={choiceOpen} disabled={!onChoose || disabled || unlinkBusy} onClick={onChoose}>{pending ? '선택하기' : '선택 변경'}</button>
    </div>
    {pending ? <p className="case-group-warning" role="status">{pendingReason || '기준 고객을 선택해주세요.'}</p> : null}
    {!onChoose ? <p className="case-group-help">선택 변경은 관리자에게 요청해주세요.</p> : staged ? <p className="case-group-help">변경사항 저장 시 반영됩니다.</p> : null}
    <details className="case-original-values">
      <summary>원본 기록 {members.length}개 · 더보기</summary>
      <p>원본·수기 입력·이력은 보존합니다. 정산은 기준 고객의 상태·배송일을 따릅니다.</p>
      {children}
      {onUnlink ? <button type="button" className="unlink-case" disabled={disabled || unlinkBusy} onClick={onUnlink}>{unlinkBusy ? '해제 중...' : members.length === 2 ? '두 고객 연결 해제' : '이 고객만 연결 해제'}</button> : null}
    </details>
  </section>
}
