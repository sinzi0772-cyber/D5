export function bestCustomerNumberFromRaw(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{10}$/.test(value) ? value : undefined
}
