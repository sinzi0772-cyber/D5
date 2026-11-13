import type { Lead } from '../types'
import { purchaseDatesFor } from '../lib/purchaseDates'
import './PurchaseDates.css'

export function PurchaseDates({ lead }: { lead: Lead }) {
  const rows = purchaseDatesFor(lead).filter(row => row.evidence.length > 0)
  if (!rows.length) return null

  return <section className="purchase-dates" aria-label="BEST 판매일자">
    <strong className="purchase-dates-heading">BEST 판매일자</strong>
    <dl>{rows.map(row => <div key={row.kind}>
      <dt>{row.label}</dt>
      <dd>{row.evidence.map(({ date, source }, index) => <span className="purchase-date-value" key={`${date}:${source}`}>
        <time dateTime={date}>{date.replaceAll('-', '.')}</time>
        {source !== '판매일' ? <small> ({source})</small> : null}
        {index < row.evidence.length - 1 ? ', ' : null}
      </span>)}</dd>
    </div>)}</dl>
  </section>
}
