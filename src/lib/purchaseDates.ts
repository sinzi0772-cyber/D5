import type { Lead } from '../types'

/** Only an explicit source sale date is a purchase date; never infer it from an order. */
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

export interface PurchaseDateSummary {
  kind: 'lumpSum' | 'subscription'
  label: '일시불' | '구독'
  dates: string[]
}

/** Stored dates are display metadata and never change money, status or settlement. */
export function purchaseDatesFor(lead: Pick<Lead, 'salesRawPeriods' | 'subscriptionRawPeriods'>): PurchaseDateSummary[] {
  const collect = (periods: unknown): string[] => {
    if (!periods || typeof periods !== 'object' || Array.isArray(periods)) return []
    const rows = Object.values(periods).flatMap(period => period && typeof period === 'object' && Array.isArray(period.saleDates)
      ? period.saleDates.map((saleDate: unknown) => ({ saleDate: typeof saleDate === 'string' ? saleDate : undefined })) : [])
    return saleDatesFromRows(rows)
  }
  return [
    { kind: 'lumpSum', label: '일시불', dates: collect(lead.salesRawPeriods) },
    { kind: 'subscription', label: '구독', dates: collect(lead.subscriptionRawPeriods) },
  ]
}
