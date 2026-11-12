import type { Lead } from '../types'
import { purchaseDatesFor } from '../lib/purchaseDates'
import './PurchaseDates.css'

export function PurchaseDates({ lead }: { lead: Lead }) {
  const rows = purchaseDatesFor(lead)
  return <section className="purchase-dates" aria-label="구매일(판매일자)">
    <div className="purchase-dates-heading"><strong>구매일(판매일자)</strong><small>BEST 기준</small></div>
    {rows.length ? <dl>{rows.map(row => <div key={row.kind}>
      <dt>{row.label}</dt>
      <dd>{row.evidence.length ? row.evidence.map(({ date, source }, index) => <span className="purchase-date-value" key={`${date}:${source}`}>
        <time dateTime={date}>{date.replaceAll('-', '.')}</time>
        {source !== '판매일' ? <small> ({source})</small> : null}
        {index < row.evidence.length - 1 ? ', ' : null}
      </span>) : '미확인'}</dd>
    </div>)}</dl> : <p>미확인</p>}
  </section>
}
