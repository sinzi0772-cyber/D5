import type { Lead, PurchaseDateEvidence } from '../types'
import type { SalesRawOrder } from './salesRaw'
import type { SubscriptionRawItem } from './subscriptionRaw'

/** Validate calendar dates before displaying source evidence. */
export function normalizePurchaseDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\s.*)?$/)
  if (!match || match[1] === '0000') return undefined
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  const instant = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === date ? date : undefined
}

/** Conflicting or malformed sale-date aliases remain unknown. */
export function saleDateFromColumns(field: (name: string) => string): string | undefined {
  const values = ['판매일', '판매일자'].map(field).filter(value => value.trim())
  if (!values.length) return undefined
  const normalized = values.map(normalizePurchaseDate)
  return normalized.every(value => value !== undefined && value === normalized[0]) ? normalized[0] : undefined
}

/** Callers pass only the source rows admitted for the corresponding purchase. */
export function saleDatesFromRows(rows: readonly { saleDate?: string }[]): string[] {
  return [...new Set(rows.map(row => normalizePurchaseDate(row.saleDate)).filter((date): date is string => date !== undefined))].sort()
}

const dateSources = ['판매일', '판매확정일', '주문일자'] as const

function distinctDateEvidence(values: readonly unknown[]): PurchaseDateEvidence[] {
  const byDate = new Map<string, PurchaseDateEvidence>()
  for (const value of values) {
    if (!value || typeof value !== 'object' || !('date' in value) || !('source' in value)) continue
    const date = normalizePurchaseDate(value.date)
    const source = dateSources.find(candidate => candidate === value.source)
    if (!date || !source) continue
    const existing = byDate.get(date)
    if (!existing || dateSources.indexOf(source) < dateSources.indexOf(existing.source)) byDate.set(date, { date, source })
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

function dateEvidenceFor(row: { saleDate?: string; confirmedDate?: string; orderDate: string }): PurchaseDateEvidence[] {
  const values = [row.saleDate, row.confirmedDate, row.orderDate]
  for (const [index, source] of dateSources.entries()) {
    const date = normalizePurchaseDate(values[index])
    if (date) return [{ date, source }]
  }
  return []
}

/** Record the actual source column for confirmed purchases. */
export function cashPurchaseDateEvidenceFor(orders: readonly SalesRawOrder[]): PurchaseDateEvidence[] {
  return distinctDateEvidence(orders.filter(order => order.orderStatus === '확정' && order.saleAmount > 1 && !order.isReturnOrRefund).flatMap(dateEvidenceFor))
}

export function subscriptionPurchaseDateEvidenceFor(items: readonly SubscriptionRawItem[]): PurchaseDateEvidence[] {
  return distinctDateEvidence(items.filter(item => item.disposition === 'confirmed' && (item.membershipBenefitBasisAmount ?? 0) > 1).flatMap(dateEvidenceFor))
}

export interface PurchaseDateSummary {
  kind: 'lumpSum' | 'subscription'
  label: '일시불' | '구독'
  evidence: PurchaseDateEvidence[]
}

/** Stored dates are display metadata and never change money, status or settlement. */
export function purchaseDatesFor(lead: Pick<Lead, 'salesRawPeriods' | 'subscriptionRawPeriods'>): PurchaseDateSummary[] {
  const collect = (periods: unknown): PurchaseDateEvidence[] => {
    if (!periods || typeof periods !== 'object' || Array.isArray(periods)) return []
    const evidence = Object.values(periods).flatMap(period => {
      if (!period || typeof period !== 'object') return []
      const explicit = Array.isArray(period.saleDates) ? period.saleDates.map((date: unknown) => ({ date, source: '판매일' })) : []
      return [...explicit, ...(Array.isArray(period.purchaseDateEvidence) ? period.purchaseDateEvidence : [])]
    })
    return distinctDateEvidence(evidence)
  }
  return [
    { kind: 'lumpSum', label: '일시불', evidence: collect(lead.salesRawPeriods) },
    { kind: 'subscription', label: '구독', evidence: collect(lead.subscriptionRawPeriods) },
  ]
}
