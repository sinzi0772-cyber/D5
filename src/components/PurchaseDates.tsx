import type { Lead } from '../types'
import { purchaseDatesFor } from '../lib/purchaseDates'
import './PurchaseDates.css'

export function PurchaseDates({ lead }: { lead: Lead }) {
  const rows = purchaseDatesFor(lead)
  return <section className="purchase-dates" aria-label="구매일(판매일자)">
    <div className="purchase-dates-heading"><strong>구매일(판매일자)</strong><small>BEST 기준</small></div>
    {rows.length ? <dl>{rows.map(row => <div key={row.kind}><dt>{row.label}</dt><dd>{row.dates.length ? row.dates.map(date => date.replaceAll('-', '.')).join(', ') : '미확인'}</dd></div>)}</dl> : <p>미확인</p>}
  </section>
}
