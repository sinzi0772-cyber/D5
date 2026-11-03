import type { Lead, SalesChannelSummary } from '../types'
import { isOneWonSaleAmount, isSalesCommissionChannelEligible } from './salesRaw'
import type { SalesRawOrder } from './salesRaw'
import type { SubscriptionRawItem } from './subscriptionRaw'

export type SalesChannelStatus = 'eligible' | 'mismatch' | 'unverified'
export interface StoredSalesChannel extends SalesChannelSummary {
  kind: 'lumpSum' | 'subscription'
  period: string | null
  /** Route status describes the original orders, never a manually edited amount. */
  status: SalesChannelStatus
  amountCurrent: boolean
}

const maxRoutes = 100
const validMonth = (value: string) => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): string | null => typeof value === 'string' && value.length <= 200 && !/[\p{C}]/u.test(value) ? value.trim() : null
const signedTotal = (values: unknown[]) => values.every(value => value === undefined || finite(value))
  ? values.reduce<number>((sum, value) => sum + (finite(value) ? value : 0), 0) : null

export function salesChannelStatusFor(channel1: string, channel2: string): SalesChannelStatus {
  if (!channel1.trim() || !channel2.trim()) return 'unverified'
  return isSalesCommissionChannelEligible(channel1, channel2) ? 'eligible' : 'mismatch'
}

interface SourceRoute {
  channel1: string
  channel2: string
  orderKey: string
  amount: number | null
}

/** Input must be the validated, deduplicated matcher result. Order keys are
 * runtime-only; a detail import whose key is a line hash reports source rows. */
function aggregate(routes: readonly SourceRoute[], withItems: boolean): SalesChannelSummary[] {
  const groups = new Map<string, { channel1: string; channel2: string; keys: Set<string>; itemCount: number; amount: number | null }>()
  for (const route of routes) {
    if (isOneWonSaleAmount(route.amount)) continue
    const channel1 = text(route.channel1) ?? ''
    const channel2 = text(route.channel2) ?? ''
    const key = JSON.stringify([channel1, channel2])
    let group = groups.get(key)
    if (!group) {
      group = { channel1, channel2, keys: new Set(), itemCount: 0, amount: 0 }
      groups.set(key, group)
    }
    group.keys.add(route.orderKey)
    group.itemCount += 1
    group.amount = group.amount === null || !finite(route.amount) ? null : group.amount + route.amount
    if (!finite(group.amount)) group.amount = null
  }
  return [...groups.values()]
    .sort((a, b) => a.channel1.localeCompare(b.channel1, 'ko') || a.channel2.localeCompare(b.channel2, 'ko'))
    .map(group => ({ channel1: group.channel1, channel2: group.channel2, orderCount: group.keys.size,
      ...(withItems ? { itemCount: group.itemCount } : {}), amount: group.amount }))
}

/** Sale amounts occur once per admitted source row, never multiplied by quantity. */
export function aggregateSalesChannels(orders: readonly SalesRawOrder[]): SalesChannelSummary[] {
  return aggregate(orders.filter(order => ['확정', '예약', '가예약'].includes(order.orderStatus))
    .map(order => ({ channel1: order.channel1, channel2: order.channel2, orderKey: order.orderReference, amount: order.saleAmount })), false)
}

export function aggregateSubscriptionChannels(items: readonly SubscriptionRawItem[]): SalesChannelSummary[] {
  return aggregate(items.filter(item => item.statusDisposition === 'confirmed' || item.statusDisposition === 'reserved')
    .map(item => ({ channel1: item.channel1, channel2: item.channel2,
      orderKey: `${item.itemReference.split(':')[0]}:${item.orderReference}`, amount: item.membershipBenefitBasisAmount })), true)
}

function parsedChannels(value: unknown): SalesChannelSummary[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxRoutes) return null
  const result: SalesChannelSummary[] = []
  for (const item of value) {
    if (!record(item)) return null
    const channel1 = text(item.channel1), channel2 = text(item.channel2)
    if (channel1 === null || channel2 === null || !count(item.orderCount)
      || item.itemCount !== undefined && !count(item.itemCount)
      || item.amount !== null && !finite(item.amount)) return null
    result.push({ channel1, channel2, orderCount: item.orderCount,
      ...(item.itemCount !== undefined ? { itemCount: item.itemCount as number } : {}), amount: item.amount as number | null })
  }
  return result
}

type RouteLead = Pick<Lead, 'purchaseType' | 'purchaseAmount' | 'lumpSumAmount' | 'subscriptionAmount' | 'salesRawPeriods' | 'subscriptionRawPeriods'>
const entered = (lead: RouteLead, kind: StoredSalesChannel['kind']): number => {
  const amount = kind === 'lumpSum' ? lead.lumpSumAmount ?? (lead.purchaseType === '일시불' ? lead.purchaseAmount : undefined)
    : lead.subscriptionAmount ?? (lead.purchaseType === '구독' ? lead.purchaseAmount : undefined)
  return finite(amount) && amount >= 0 ? amount : 0
}

/** Display-only reader. Older totals never imply an invented route label.
 * Unknown or malformed metadata remains visibly unverified. No fee is changed. */
export function getStoredSalesChannels(lead: RouteLead): StoredSalesChannel[] {
  const result: StoredSalesChannel[] = []
  for (const kind of ['lumpSum', 'subscription'] as const) {
    const source = kind === 'lumpSum' ? lead.salesRawPeriods : lead.subscriptionRawPeriods
    const periods = record(source) ? Object.entries(source).filter(([month, period]) => validMonth(month) && record(period)) : []
    const amountsFor = (period: Record<string, unknown>) => kind === 'lumpSum'
      ? signedTotal([period.confirmedAmount, period.reservedAmount, period.tentativeAmount])
      : signedTotal([period.confirmedBasisAmount, period.pendingBasisAmount])
    const total = signedTotal(periods.map(([, period]) => amountsFor(period as unknown as Record<string, unknown>)))
    const amountCurrent = periods.length > 0 && total !== null && entered(lead, kind) === Math.max(0, total)
    if (!periods.length && entered(lead, kind) > 0 && !isOneWonSaleAmount(entered(lead, kind))) {
      result.push({ kind, period: null, channel1: '', channel2: '', orderCount: 0,
        amount: entered(lead, kind), status: 'unverified', amountCurrent: false })
    }
    for (const [month, untyped] of periods.sort(([a], [b]) => b.localeCompare(a))) {
      const period = untyped as unknown as Record<string, unknown>
      const channels = parsedChannels(period.channels)
      const amount = amountsFor(period)
      const legacy: SalesChannelSummary = { channel1: '', channel2: '', orderCount: count(period.orderCount) ? period.orderCount : 0,
        ...(kind === 'subscription' && count(period.itemCount) ? { itemCount: period.itemCount } : {}), amount }
      for (const route of channels ?? [legacy]) if (!isOneWonSaleAmount(route.amount)) result.push({ ...route, kind, period: month, amountCurrent,
        status: channels ? salesChannelStatusFor(route.channel1, route.channel2) : 'unverified' })
    }
  }
  return result
}
