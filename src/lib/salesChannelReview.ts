import type { Lead } from '../types'
import { customerDisplayLabel } from './customerDisplay'
import { canonicalPartnerName } from './partners'
import { getStoredSalesChannels, type StoredSalesChannel } from './salesChannels'
import { latestSalesRouteCorrectionFor, salesRouteTargetFor } from './salesRouteCorrections'
import { isOneWonSaleAmount } from './salesRaw'

export interface SalesChannelReviewViewer {
  role: string
  employeeNo?: string
  displayName?: string
}

export interface SalesChannelReviewItem {
  key: string
  /** Groups review rows without combining or changing their source purchases. */
  caseKey: string
  leadId: string
  customerLabel: string
  intakeDate: string
  partnerName: string
  kind: 'lumpSum' | 'subscription'
  status: 'mismatch' | 'unverified'
  period: string | null
  periods?: readonly string[]
  unverifiedReason?: 'missing-route' | 'confirmed-route-unclear'
  channel1: string
  channel2: string
  managerLabel: string
  staffRoute?: { channel1: string; channel2: string }
}

const administrators = new Set(['admin', 'store_manager', 'assistant_manager'])
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const partnerKey = (value: string) => canonicalPartnerName(value).normalize('NFKC').trim().toLowerCase()
  .replace(/^(?:주식회사|\(주\))\s*/, '').replace(/\s*(?:주식회사|\(주\))$/, '').replace(/\s+/g, '')

/** Explicit caller policy only. The broader financial partner list is never a default. */
export function isApprovedSubscriptionReviewPartner(name: string, approvedList: readonly string[]): boolean {
  const key = partnerKey(name)
  return Boolean(key) && approvedList.some(value => typeof value === 'string' && partnerKey(value) === key)
}

/** A stable UI dismissal key, not an authorization or financial identifier. */
function fingerprint(value: unknown): string {
  let hash = 0xcbf29ce484222325n
  for (const character of JSON.stringify(value)) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n)
  return hash.toString(16).padStart(16, '0')
}

function viewerCanReview(lead: Lead, viewer: SalesChannelReviewViewer): boolean {
  if (administrators.has(viewer.role)) return true
  if (viewer.role !== 'manager') return false
  const employeeNo = text(viewer.employeeNo)
  // A name match is not sufficient evidence that two staff accounts are the same person.
  return Boolean(employeeNo) && text(lead.managerEmployeeNo) === employeeNo
}

function hasRouteEvidence(route: StoredSalesChannel): boolean {
  return route.orderCount > 0 || (route.itemCount ?? 0) > 0 || (route.amount !== null && route.amount !== 0)
}

function confirmedCohortFor(lead: Lead, kind: SalesChannelReviewItem['kind'], period: string) {
  const cash = kind === 'lumpSum' ? lead.salesRawPeriods?.[period] : undefined
  const subscription = kind === 'subscription' ? lead.subscriptionRawPeriods?.[period] : undefined
  const amount = cash?.confirmedAmount ?? subscription?.confirmedBasisAmount
  const count = cash?.confirmedOrderCount ?? subscription?.confirmedItemCount
  if (amount === undefined || !Number.isFinite(amount) || amount <= 1
    || count === undefined || !Number.isSafeInteger(count) || count <= 0) return undefined
  const mixed = cash
    ? cash.reservedOrderCount > 0 || (cash.tentativeOrderCount ?? 0) > 0 || cash.orderCount > count
      || cash.reservedAmount !== 0 || (cash.tentativeAmount ?? 0) !== 0
    : subscription!.pendingItemCount > 0 || subscription!.itemCount > count || subscription!.pendingBasisAmount !== 0
  const allConfirmedEligible = cash
    ? cash.returnAmount === 0 && cash.eligibleConfirmedAmount === amount
    : subscription!.missingBasisItemCount === 0 && subscription!.eligibleConfirmedBasisAmount === amount
  return { mixed, allConfirmedEligible }
}

function commonPath(routes: readonly StoredSalesChannel[], key: 'channel1' | 'channel2'): string {
  const path = routes[0]?.[key] ?? ''
  return routes.every(route => route[key] === path) ? path : ''
}

function staffRouteFor(lead: Lead, routes: readonly StoredSalesChannel[]): SalesChannelReviewItem['staffRoute'] {
  const corrections = routes.map(route => {
    const target = salesRouteTargetFor(lead, route)
    return target ? latestSalesRouteCorrectionFor(lead, target) : undefined
  })
  const first = corrections[0]
  if (!first || corrections.some(correction => correction?.correctedChannel1 !== first.correctedChannel1
    || correction.correctedChannel2 !== first.correctedChannel2)) return undefined
  return { channel1: first.correctedChannel1, channel2: first.correctedChannel2 }
}

/** Read-only review of actual stored order routes. A financial basis selection
 * cannot turn an independent original order into a copied purchase. Shared
 * aliases are skipped; their direct source owner supplies the one review row.
 * Independent owners retain their assignments and share only the caseKey. */
export function getSalesChannelReviewItems(
  leads: readonly Lead[],
  viewer: SalesChannelReviewViewer,
  approvedSubscriptionPartners: readonly string[],
): SalesChannelReviewItem[] {
  if (!administrators.has(viewer.role) && viewer.role !== 'manager') return []
  const byId = new Map<string, Lead>()
  for (const lead of leads) if (!byId.has(lead.id)) byId.set(lead.id, lead)
  const candidates = new Map<string, { item: Omit<SalesChannelReviewItem, 'key'>; facts: unknown[] }>()
  for (const lead of byId.values()) {
    const partner = partnerKey(lead.partnerName)
    if (lead.status !== '구매완료' || !partner || partner === '제휴사' || partner === '제휴업체확인필요'
      || !viewerCanReview(lead, viewer)
      || lead.appointmentType !== '이업종제휴' && lead.appointmentType !== '상담예약(이업종)') continue
    const routes = getStoredSalesChannels(lead)
    const common = {
      caseKey: text(lead.caseGroupId) ? 'case:' + lead.caseGroupId : 'lead:' + lead.id,
      leadId: lead.id,
      customerLabel: customerDisplayLabel(lead),
      intakeDate: lead.registeredAt,
      partnerName: canonicalPartnerName(lead.partnerName),
      managerLabel: text(lead.manager) || '미배정',
    }
    for (const kind of ['lumpSum', 'subscription'] as const) {
      if (kind === 'subscription' && !isApprovedSubscriptionReviewPartner(lead.partnerName, approvedSubscriptionPartners)) continue
      const sourceId = kind === 'lumpSum' ? lead.lumpSumSourceId : lead.subscriptionSourceId
      if (sourceId !== undefined && sourceId !== lead.id) continue
      const ownRoutes = routes.filter(route => route.kind === kind && !isOneWonSaleAmount(route.amount))
      const periods = kind === 'lumpSum' ? lead.salesRawPeriods : lead.subscriptionRawPeriods
      // These facts stay inside the fingerprint; the popup receives no sales amount or order reference.
      const factsFor = (route: StoredSalesChannel) => [route.period ? text(periods?.[route.period]?.sourceHash) : '',
        route.amount, route.orderCount, route.itemCount ?? null, route.amountCurrent]
      const routesByPeriod = new Map<string, StoredSalesChannel[]>()
      for (const route of ownRoutes) {
        if (!route.period || !hasRouteEvidence(route)) continue
        const stored = routesByPeriod.get(route.period) ?? []
        stored.push(route)
        routesByPeriod.set(route.period, stored)
      }
      const mismatches: StoredSalesChannel[] = []
      const missingRoutes: StoredSalesChannel[] = []
      let confirmedRouteUnclear = false
      for (const [period, periodRoutes] of routesByPeriod) {
        const cohort = confirmedCohortFor(lead, kind, period)
        if (!cohort) continue
        const problems = periodRoutes.filter(route => route.status !== 'eligible')
        if (!problems.length) continue
        const pathCount = new Set(periodRoutes.map(route => JSON.stringify([route.channel1, route.channel2]))).size
        if (cohort.mixed && pathCount > 1) {
          // Legacy monthly summaries can mix confirmed and pending routes.
          if (cohort.allConfirmedEligible && periodRoutes.every(route => route.status !== 'unverified' && route.amount !== null && route.amount >= 0)) continue
          confirmedRouteUnclear = true
          missingRoutes.push(...problems)
          continue
        }
        for (const route of problems) (route.status === 'mismatch' ? mismatches : missingRoutes).push(route)
      }
      for (const route of mismatches) {
        const identity = JSON.stringify([lead.id, kind, route.period, route.channel1, route.channel2])
        let candidate = candidates.get(identity)
        if (!candidate) {
          candidate = { item: { ...common, kind, status: 'mismatch', period: route.period,
            channel1: route.channel1, channel2: route.channel2, staffRoute: staffRouteFor(lead, [route]) }, facts: [] }
          candidates.set(identity, candidate)
        }
        candidate.facts.push(factsFor(route))
      }

      if (!missingRoutes.length) continue

      const knownPeriods = [...new Set(missingRoutes.flatMap(route => route.period ? [route.period] : []))].sort().reverse()
      candidates.set(JSON.stringify([lead.id, kind, 'unverified']), {
        item: { ...common, kind, status: 'unverified', period: knownPeriods.length === 1 ? knownPeriods[0] : null,
          ...(knownPeriods.length > 1 ? { periods: knownPeriods } : {}),
          unverifiedReason: confirmedRouteUnclear ? 'confirmed-route-unclear' : 'missing-route',
          channel1: confirmedRouteUnclear ? '' : commonPath(missingRoutes, 'channel1'),
          channel2: confirmedRouteUnclear ? '' : commonPath(missingRoutes, 'channel2'),
          staffRoute: confirmedRouteUnclear ? undefined : staffRouteFor(lead, missingRoutes) },
        facts: missingRoutes.map(route => [route.period, route.channel1, route.channel2, ...factsFor(route)]),
      })
    }
  }
  return [...candidates.entries()].map(([identity, { item, facts }]) => {
    const owner = byId.get(item.leadId)!
    const sourceFacts = [...new Set(facts.map(value => JSON.stringify(value)))].sort()
    return { ...item, key: 'sales-route-' + fingerprint([identity, item.caseKey, text(owner.managerEmployeeNo), text(owner.manager), sourceFacts]) }
  }).sort((a, b) => a.partnerName.localeCompare(b.partnerName, 'ko') || a.customerLabel.localeCompare(b.customerLabel, 'ko')
    || a.kind.localeCompare(b.kind) || (b.period || '').localeCompare(a.period || '') || a.channel1.localeCompare(b.channel1, 'ko') || a.channel2.localeCompare(b.channel2, 'ko'))
}
