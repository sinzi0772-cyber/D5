import type { SeptemberAppointment } from '../data/septemberAppointments'

export interface SeptemberSourceDocument {
  schemaVersion: 1
  sources: readonly SeptemberAppointment[]
}

const sourceKeys = ['sourceId', 'registeredAt', 'visitScheduledDate', 'appointmentType', 'customerName', 'phoneLast4', 'partnerName', 'appointmentStatus']
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const calendarDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Protected admin input, never a public fallback or a client-editable source. */
export function parseSeptemberSource(value: unknown): readonly SeptemberAppointment[] | null {
  if (!record(value) || value.schemaVersion !== 1 || Object.keys(value).some(key => !['schemaVersion', 'sources'].includes(key))) return null
  if (!Array.isArray(value.sources) || value.sources.length > 1000) return null
  const ids = new Set<string>()
  const result: SeptemberAppointment[] = []
  for (const row of value.sources) {
    if (!record(row) || Object.keys(row).length !== sourceKeys.length || sourceKeys.some(key => typeof row[key] !== 'string')) return null
    if (Object.keys(row).some(key => !sourceKeys.includes(key))) return null
    if (!row.sourceId || (row.sourceId as string).length > 128 || ids.has(row.sourceId as string)) return null
    if (!calendarDate(row.registeredAt) || !calendarDate(row.visitScheduledDate) || !/^\d{4}$/.test(row.phoneLast4 as string)) return null
    if (!['상담예약(이업종)', '이업종제휴'].includes(row.appointmentType as string)) return null
    if (!row.customerName || (row.customerName as string).length > 60 || !row.partnerName || (row.partnerName as string).length > 180) return null
    if ((row.appointmentStatus as string).length > 40) return null
    ids.add(row.sourceId as string)
    result.push({
      sourceId: row.sourceId as string, registeredAt: row.registeredAt, visitScheduledDate: row.visitScheduledDate,
      appointmentType: row.appointmentType as SeptemberAppointment['appointmentType'], customerName: row.customerName as string,
      phoneLast4: row.phoneLast4 as string, partnerName: row.partnerName as string, appointmentStatus: row.appointmentStatus as string,
    })
  }
  return result
}
