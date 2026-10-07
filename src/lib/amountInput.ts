const wonNumberFormat = new Intl.NumberFormat('ko-KR')

/** Format whole-won amounts for display without changing the stored number. */
export function formatAmountInput(value?: number): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? wonNumberFormat.format(value)
    : ''
}

/** Invalid text has no value so callers can preserve the previous amount. */
export function parseAmountInput(text: string): { valid: boolean; value?: number } {
  const digits = text.trim().replace(/[,\s₩원]/g, '')
  if (!digits) return { valid: true, value: undefined }
  if (!/^\d+$/.test(digits)) return { valid: false }

  const value = Number(digits)
  return Number.isSafeInteger(value) && value >= 0
    ? { valid: true, value }
    : { valid: false }
}
