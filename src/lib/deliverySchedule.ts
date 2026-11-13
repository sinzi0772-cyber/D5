import type { Lead } from '../types'

export type DeliveryScheduleLead = Pick<Lead, 'id' | 'deliveryScheduledDate' | 'lumpSumSourceId' | 'subscriptionSourceId' | 'salesRawPeriods' | 'subscriptionRawPeriods'>

/** Strict Gregorian calendar dates; input years are 0001 through 9999. */
export function isValidDeliveryDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]
}

export function isValidDeliveryMonth(value: unknown): value is string {
  return typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

export function isValidDeliverySchedule(value: unknown): value is string {
  return isValidDeliveryDate(value) || isValidDeliveryMonth(value)
}

const validRequestDates = (arrays: readonly (readonly string[] | undefined)[]): string[] =>
  [...new Set(arrays.flatMap(dates => Array.isArray(dates) ? dates : []).filter(date =>
    isValidDeliveryDate(date) && date !== '9999-12-31'
  ))].sort()

/** Evidence from this customer's own orders. Copied financial values do not supply a delivery date. */
export function rawDeliveryRequestDatesFor(lead: Partial<DeliveryScheduleLead>): { lumpSum: string[]; subscription: string[] } {
  return {
    lumpSum: lead.lumpSumSourceId && lead.lumpSumSourceId !== lead.id ? [] : validRequestDates(
      Object.values(lead.salesRawPeriods ?? {}).map(period => period?.lgeDeliveryRequestedDates)
    ),
    subscription: lead.subscriptionSourceId && lead.subscriptionSourceId !== lead.id ? [] : validRequestDates(
      Object.values(lead.subscriptionRawPeriods ?? {}).map(period => period?.deliveryRequestedDates)
    ),
  }
}

/** Keep manual input first. Different requested days in one month support month precision. */
export function deliveryScheduleFor(lead: Partial<DeliveryScheduleLead>): string | null {
  if (isValidDeliverySchedule(lead.deliveryScheduledDate)) return lead.deliveryScheduledDate
  const { lumpSum, subscription } = rawDeliveryRequestDatesFor(lead)
  const dates = [...new Set([...lumpSum, ...subscription])]
  if (!dates.length) return null
  if (dates.length === 1) return dates[0]
  const month = dates[0].slice(0, 7)
  return dates.every(date => date.slice(0, 7) === month) ? month : null
}
