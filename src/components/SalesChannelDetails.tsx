import type { Lead } from '../types'
import { customerDisplayLabel } from '../lib/customerDisplay'
import { getStoredSalesChannels } from '../lib/salesChannels'
import { isApprovedSubscriptionReviewPartner } from '../lib/salesChannelReview'
import { SUBSCRIPTION_REVIEW_PARTNERS } from '../lib/subscriptionPartners'
import './SalesChannelDetails.css'

const statusLabel = { eligible: '경로 일치', mismatch: '경로 불일치', unverified: '확인 필요' } as const

/** Read-only source routes. Selecting a customer never edits a store's order. */
export function SalesChannelDetails({ members }: { members: readonly Lead[] }) {
  const rows = members.flatMap(member => getStoredSalesChannels(member).filter(row => row.kind === 'lumpSum' || isApprovedSubscriptionReviewPartner(member.partnerName, SUBSCRIPTION_REVIEW_PARTNERS)).map(row => ({ ...row, customer: customerDisplayLabel(member), memberId: member.id })))
  if (!rows.length) return null
  const status = rows.some(row => row.status === 'mismatch') ? 'mismatch' : rows.some(row => row.status === 'unverified') ? 'unverified' : 'eligible'
  return <details className="sales-channel-details">
    <summary><strong>판매경로</strong><span className={`sales-channel-state ${status}`}>{statusLabel[status]}</span></summary>
    <div className="sales-channel-records">
      {rows.map((row, index) => <article key={`${row.memberId}-${row.kind}-${row.period}-${index}`}>
        <header><strong>{row.kind === 'lumpSum' ? '일시불' : '구독'}{row.period ? ` · ${row.period.replace('-', '.')}` : ''}{members.length > 1 ? ` · ${row.customer}` : ''}</strong><span className={`sales-channel-state ${row.status}`}>{statusLabel[row.status]}</span></header>
        <dl><div><dt>판매경로 1</dt><dd>{row.channel1 || '미확인'}</dd></div><div><dt>판매경로 2</dt><dd>{row.channel2 || '미확인'}</dd></div></dl>
        {row.status === 'unverified' ? <p>원본 판매경로 확인이 필요합니다.</p> : !row.amountCurrent ? <p>입력 금액과 원본 금액이 달라 수수료 확인이 필요합니다.</p> : null}
      </article>)}
    </div>
  </details>
}
