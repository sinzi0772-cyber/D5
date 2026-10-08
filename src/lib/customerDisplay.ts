import type { Lead } from '../types'

/** Display-only masking. Stored names and RAW matching keys must remain unchanged. */
export function customerDisplayName(value: unknown): string {
  if (typeof value !== 'string') return '미입력'
  const clean = value.normalize('NFKC').trim().replace(/\s/g, '')
  if (!clean || clean === '미입력') return '미입력'
  const first = Array.from(clean)[0]
  return first === '*' ? '***' : `${first}**`
}

/** Always shows just four digits, even if an unexpected full phone number is supplied. */
export function phoneLast4Display(value: unknown): string {
  const text = typeof value === 'string'
    ? value.normalize('NFKC')
    : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : ''
  const digits = text.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : '미입력'
}

export function customerDisplayLabel(lead: Pick<Lead, 'customerName' | 'phoneLast4'>): string {
  return `${customerDisplayName(lead.customerName)} / ${phoneLast4Display(lead.phoneLast4)}`
}
