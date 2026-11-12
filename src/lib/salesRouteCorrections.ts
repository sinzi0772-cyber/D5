import type { Lead, SalesRouteCorrection, SalesRouteTarget } from '../types'
import type { StoredSalesChannel } from './salesChannels'

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const validMonth = (value: unknown): value is string => typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value)
const validKind = (value: unknown): value is SalesRouteTarget['kind'] => value === 'lumpSum' || value === 'subscription'
const validRevision = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{16}$/.test(value)
const validEventId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9]{20}$/.test(value)
const validPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 200 && value.trim() === value && !/[\p{C}]/u.test(value)

export const isSalesRouteChoice = (value: unknown): value is string => validPath(value) && value.length > 0

export function isOwnSalesRoute(lead: Lead, kind: SalesRouteTarget['kind']): boolean {
  const owner = kind === 'lumpSum' ? lead.lumpSumSourceId : lead.subscriptionSourceId
  return owner === undefined || owner === lead.id
}

export function canEditSalesRouteFor(lead: Lead, viewer: { canManageAll: boolean; employeeNo?: string }): boolean {
  return viewer.canManageAll || Boolean(viewer.employeeNo && lead.managerEmployeeNo === viewer.employeeNo)
}

export function salesRouteTargetFor(lead: Lead, route: StoredSalesChannel): SalesRouteTarget {
  const periods = route.kind === 'lumpSum' ? lead.salesRawPeriods : lead.subscriptionRawPeriods
  const source = route.period ? periods?.[route.period] : undefined
  // Match the exact source revision even when its path labels have not changed.
  const facts = JSON.stringify([lead.id, source?.sourceHash, route.amount, route.orderCount, route.itemCount, route.amountCurrent])
  let hash = 0xcbf29ce484222325n
  for (const char of facts) hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 0x100000001b3n)
  return { kind: route.kind, period: route.period, channel1: route.channel1, channel2: route.channel2, sourceRevision: hash.toString(16).padStart(16, '0') }
}

export function sameSalesRouteTarget(left: SalesRouteTarget, right: SalesRouteTarget): boolean {
  return left.kind === right.kind && left.period === right.period && left.channel1 === right.channel1
    && left.channel2 === right.channel2 && left.sourceRevision === right.sourceRevision
}

export function latestSalesRouteCorrectionFor(lead: Lead, target: SalesRouteTarget): SalesRouteCorrection | undefined {
  const corrections = lead.salesRouteCorrections ?? []
  for (let index = corrections.length - 1; index >= 0; index--) {
    if (sameSalesRouteTarget(corrections[index], target)) return corrections[index]
  }
}

function timestampText(value: unknown): string | undefined {
  const date = typeof value === 'string' ? new Date(value)
    : record(value) && typeof value.toDate === 'function' ? value.toDate() : undefined
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

export function readSalesRouteCorrectionLedger(value: unknown): {
  revision: number
  entries: Record<string, unknown>
  corrections: SalesRouteCorrection[]
} | null {
  if (value === undefined) return { revision: 0, entries: {}, corrections: [] }
  if (!record(value) || !record(value.entries) || !validEventId(value.latestId)
    || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1) return null
  const revisions = Object.entries(value.entries).map(([id, entry]) => {
    if (!validEventId(id) || !record(entry) || !validKind(entry.kind) || entry.period !== null && !validMonth(entry.period)
      || !validPath(entry.channel1) || !validPath(entry.channel2) || !validRevision(entry.sourceRevision)
      || !isSalesRouteChoice(entry.correctedChannel1) || !isSalesRouteChoice(entry.correctedChannel2)
      || typeof entry.changedBy !== 'string' || !entry.changedBy || typeof entry.revision !== 'number') return null
    const changedAt = timestampText(entry.changedAt)
    if (!changedAt) return null
    const correction: SalesRouteCorrection = {
      id, kind: entry.kind, period: entry.period, channel1: entry.channel1, channel2: entry.channel2, sourceRevision: entry.sourceRevision,
      correctedChannel1: entry.correctedChannel1, correctedChannel2: entry.correctedChannel2, changedAt, changedBy: entry.changedBy,
    }
    return { revision: entry.revision, correction }
  })
  if (revisions.some(entry => entry === null) || revisions.length !== value.revision) return null
  const ordered = revisions.filter(entry => entry !== null).sort((left, right) => left.revision - right.revision)
  if (ordered.some((entry, index) => entry.revision !== index + 1) || ordered.at(-1)?.correction.id !== value.latestId) return null
  return { revision: value.revision, entries: value.entries, corrections: ordered.map(entry => entry.correction) }
}
