import { useState } from 'react'
import type { Lead, SalesRouteCorrection, SalesRouteTarget } from '../types'
import { customerDisplayLabel } from '../lib/customerDisplay'
import { getStoredSalesChannels, type StoredSalesChannel } from '../lib/salesChannels'
import { isApprovedSubscriptionReviewPartner } from '../lib/salesChannelReview'
import { SALES_RAW_ROUTE_PAIRS } from '../data/salesRouteCatalog'
import { isOwnSalesRoute, latestSalesRouteCorrectionFor, salesRouteTargetFor } from '../lib/salesRouteCorrections'
import { SUBSCRIPTION_REVIEW_PARTNERS } from '../lib/subscriptionPartners'
import './SalesChannelDetails.css'

export interface SalesChannelRouteEdit {
  target: SalesRouteTarget
  correctedChannel1: string
  correctedChannel2: string
  expectedCorrection?: SalesRouteCorrection
}

const statusLabel = { eligible: '경로 일치', mismatch: '경로 불일치', unverified: '확인 필요' } as const

type RouteDraft = Omit<SalesChannelRouteEdit, 'target'>
type SaveRoute = (edit: SalesChannelRouteEdit) => Promise<void>

function SalesChannelRecord({ row, title, target, correction, onSaveRoute }: {
  row: StoredSalesChannel
  title: string
  target: SalesRouteTarget
  correction?: SalesRouteCorrection
  onSaveRoute?: SaveRoute
}) {
  const [draft, setDraft] = useState<RouteDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const currentChannel1 = correction?.correctedChannel1 ?? row.channel1
  const currentChannel2 = correction?.correctedChannel2 ?? row.channel2
  const pairs: Array<readonly [string, string]> = [...SALES_RAW_ROUTE_PAIRS[row.kind]]
  if (row.channel1 && row.channel2) pairs.push([row.channel1, row.channel2])
  const channel1Options = [...new Set(pairs.map(([channel1]) => channel1))]
  const channel2OptionsFor = (channel1: string) => [...new Set(pairs.filter(([first]) => first === channel1).map(([, second]) => second))]
  const channel2Options = draft ? channel2OptionsFor(draft.correctedChannel1) : []
  const stale = draft && draft.expectedCorrection?.id !== correction?.id
  const available = Boolean(!stale && draft && channel2Options.includes(draft.correctedChannel2) &&
    (draft.correctedChannel1 !== currentChannel1 || draft.correctedChannel2 !== currentChannel2))

  const start = () => {
    setError('')
    const correctedChannel1 = channel1Options.includes(currentChannel1) ? currentChannel1 : ''
    setDraft({
      correctedChannel1,
      correctedChannel2: channel2OptionsFor(correctedChannel1).includes(currentChannel2) ? currentChannel2 : '',
      expectedCorrection: correction,
    })
  }
  const save = async () => {
    if (!onSaveRoute || !draft || !available || saving) return
    setError('')
    setSaving(true)
    try {
      await onSaveRoute({ target, ...draft })
      setDraft(null)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '판매경로를 저장하지 못했습니다. 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  return <article>
    <header><strong>{title}</strong><span className={`sales-channel-state ${row.status}`}>{statusLabel[row.status]}</span></header>
    <dl aria-label="BEST 원본 판매경로"><div><dt>판매경로 1</dt><dd>{row.channel1 || '미확인'}</dd></div><div><dt>판매경로 2</dt><dd>{row.channel2 || '미확인'}</dd></div></dl>
    {correction && <dl className="sales-channel-confirmed"><div><dt>직원 확인 1</dt><dd>{correction.correctedChannel1}</dd></div><div><dt>직원 확인 2</dt><dd>{correction.correctedChannel2}</dd></div></dl>}
    {row.status === 'unverified' ? <p>원본 판매경로 확인이 필요합니다.</p> : !row.amountCurrent ? <p>입력 금액과 판매 원본 금액이 다릅니다.</p> : null}
    {onSaveRoute && (draft ? <div className="sales-channel-route-edit">
      <div className="sales-channel-route-fields">
        <label>판매경로 1<select value={draft.correctedChannel1} disabled={saving || Boolean(stale)} onChange={event => {
          const correctedChannel1 = event.target.value
          setDraft({ ...draft, correctedChannel1,
            correctedChannel2: channel2OptionsFor(correctedChannel1).includes(draft.correctedChannel2) ? draft.correctedChannel2 : '',
          })
        }}>
          <option value="">경로를 선택해주세요</option>
          {channel1Options.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label>판매경로 2<select value={draft.correctedChannel2} disabled={saving || Boolean(stale) || !draft.correctedChannel1} onChange={event => setDraft({ ...draft, correctedChannel2: event.target.value })}>
          <option value="">경로를 선택해주세요</option>
          {channel2Options.map(value => <option key={value}>{value}</option>)}
        </select></label>
      </div>
      <div className="sales-channel-route-actions"><button type="button" className="btn secondary" disabled={saving} onClick={() => setDraft(null)}>취소</button><button type="button" className="btn primary" disabled={!available || saving} onClick={save}>{saving ? '저장 중…' : '판매경로 저장'}</button></div>
      {stale && !saving ? <p role="alert">판매경로가 수정됐습니다. 취소한 뒤 다시 열어주세요.</p> : error && <p role="alert">{error}</p>}
    </div> : <div className="sales-channel-route-actions"><button type="button" className="btn secondary" aria-label={`${title} 판매경로 수정`} onClick={start}>판매경로 수정</button></div>)}
  </article>
}

export function SalesChannelDetails({ members, basisId, approvedOrderRoutes = [], editableLeadId, onSaveRoute, initiallyOpen }: {
  members: readonly Lead[]
  basisId?: string
  approvedOrderRoutes?: ReadonlyArray<{ source: Lead; row: StoredSalesChannel }>
  editableLeadId?: string
  onSaveRoute?: SaveRoute
  initiallyOpen?: boolean
}) {
  const rows = members.flatMap(member => getStoredSalesChannels(member)
    .filter(row => row.kind === 'lumpSum' || isApprovedSubscriptionReviewPartner(member.partnerName, SUBSCRIPTION_REVIEW_PARTNERS))
    .filter(row => member.id !== basisId || row.period !== null || !approvedOrderRoutes.some(approved => approved.row.kind === row.kind))
    .map(original => {
      const approved = approvedOrderRoutes.find(({ source, row }) => source.id === member.id && row.kind === original.kind
        && row.period === original.period && row.channel1 === original.channel1 && row.channel2 === original.channel2)
      return { member, row: approved?.row ?? original, target: salesRouteTargetFor(member, original) }
    }))
  if (!rows.length) return null
  const status = rows.some(({ row }) => row.status === 'mismatch') ? 'mismatch'
    : rows.some(({ row }) => row.status === 'unverified') ? 'unverified' : 'eligible'
  return <details className="sales-channel-details" open={initiallyOpen || undefined}>
    <summary><strong>판매경로</strong><span className={`sales-channel-state ${status}`}>{statusLabel[status]}</span></summary>
    <div className="sales-channel-records">
      {rows.map(({ member, row, target }, index) => {
        const title = [row.kind === 'lumpSum' ? '일시불' : '구독', row.period?.replace('-', '.'),
          members.length > 1 ? customerDisplayLabel(member) : undefined].filter(Boolean).join(' · ')
        return <SalesChannelRecord key={`${member.id}-${target.sourceRevision}-${index}`} row={row} title={title} target={target}
          correction={latestSalesRouteCorrectionFor(member, target)}
          onSaveRoute={member.id === editableLeadId && isOwnSalesRoute(member, row.kind) ? onSaveRoute : undefined}/>
      })}
    </div>
  </details>
}
