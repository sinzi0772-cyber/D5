import type { SeptemberAppointment } from '../data/septemberAppointments'
import type { Lead } from '../types'
import { customerIdentityKey } from './salesRaw'

export function canStartSeptemberSync(input: {
  role: string
  mustChangePassword: boolean
  dataReady: boolean
  serverConfirmed: boolean
  dataError: string
  isDemoMode: boolean
}): boolean {
  return ['admin', 'store_manager', 'assistant_manager'].includes(input.role)
    && !input.mustChangePassword
    && input.dataReady
    && input.serverConfirmed
    && !input.dataError
    && !input.isDemoMode
}

const isMissing = (value: unknown): boolean => value === undefined || value === null
  || (typeof value === 'string' && value.trim() === '')

function existingIdentity(existing: Record<string, unknown>): string {
  if (typeof existing.customerName !== 'string' || typeof existing.phoneLast4 !== 'string') return ''
  return customerIdentityKey(existing.customerName, existing.phoneLast4)
}

/** Recheck the transaction's current record before filling only absent source fields. */
export function septemberExistingPatch(
  source: SeptemberAppointment,
  existing: Record<string, unknown>,
): Record<string, unknown> | null {
  const sourceIdentity = customerIdentityKey(source.customerName, source.phoneLast4)
  if (!sourceIdentity || isMissing(source.sourceId) || existingIdentity(existing) !== sourceIdentity) return null
  if (!isMissing(existing.appointmentSourceId) && existing.appointmentSourceId !== source.sourceId) return null

  const patch: Record<string, unknown> = {}
  if (isMissing(existing.appointmentSourceId)) patch.appointmentSourceId = source.sourceId
  if (isMissing(existing.appointmentType) || existing.appointmentType === '미선택') {
    patch.appointmentType = source.appointmentType
  }
  if (isMissing(existing.visitScheduledDate) && !isMissing(source.visitScheduledDate)) {
    patch.visitScheduledDate = source.visitScheduledDate
  }
  return patch
}

export function buildSeptemberSyncPlan(
  sources: readonly SeptemberAppointment[],
  leads: readonly Lead[],
): {
  entries: Array<{ source: SeptemberAppointment; targetId: string; kind: 'existing' | 'new' }>
  skipped: number
} {
  const sourceIdCounts = new Map<string, number>()
  for (const source of sources) sourceIdCounts.set(source.sourceId, (sourceIdCounts.get(source.sourceId) || 0) + 1)

  const proposals: Array<{ source: SeptemberAppointment; targetId: string; kind: 'existing' | 'new' }> = []
  let skipped = 0
  for (const source of sources) {
    const identity = customerIdentityKey(source.customerName, source.phoneLast4)
    if (!identity || isMissing(source.sourceId) || sourceIdCounts.get(source.sourceId) !== 1) {
      skipped++
      continue
    }

    const targetId = `appointment-202609-${source.sourceId}`
    const sourceMatches = leads.filter(lead => lead.appointmentSourceId === source.sourceId)
    const deterministicMatches = leads.filter(lead => lead.id === targetId)
    if (sourceMatches.length > 1 || deterministicMatches.length > 1
      || (sourceMatches.length === 1 && deterministicMatches.length === 1 && sourceMatches[0].id !== deterministicMatches[0].id)) {
      skipped++
      continue
    }

    let existing = sourceMatches[0] || deterministicMatches[0]
    if (!existing) {
      const legacyMatches = leads.filter(lead => (
        customerIdentityKey(lead.customerName, lead.phoneLast4) === identity
        && lead.registeredAt === source.registeredAt
        && (isMissing(lead.visitScheduledDate) || lead.visitScheduledDate === source.visitScheduledDate)
        && (isMissing(lead.appointmentType) || lead.appointmentType === '미선택' || lead.appointmentType === source.appointmentType)
      ))
      if (legacyMatches.length > 1) {
        skipped++
        continue
      }
      existing = legacyMatches[0]
    }

    if (existing) {
      if (isMissing(existing.id) || septemberExistingPatch(source, { ...existing }) === null) {
        skipped++
        continue
      }
      proposals.push({ source, targetId: existing.id, kind: 'existing' })
    } else {
      proposals.push({ source, targetId, kind: 'new' })
    }
  }

  // Resolve reuse after matching all sources so input order cannot pick a legacy row.
  const targetCounts = new Map<string, number>()
  for (const entry of proposals) targetCounts.set(entry.targetId, (targetCounts.get(entry.targetId) || 0) + 1)
  const entries = proposals.filter(entry => targetCounts.get(entry.targetId) === 1)
  return { entries, skipped: skipped + proposals.length - entries.length }
}
