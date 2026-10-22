/** Accept a compact pasted/typed date without guessing missing parts or today. */
export function normalizeDeliveryDateInput(value: string): string {
  const trimmed = value.trim()
  return /^\d{8}$/.test(trimmed) ? `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}` : trimmed
}
