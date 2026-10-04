import type { Lead } from '../types'
import { customerIdentityKey, isSalesCommissionChannelEligible } from './salesRaw'
import type { SalesRawCustomer, SalesRawOrder, SalesRawResult } from './salesRaw'
import { partnerAppointmentExclusionReason } from './partnerAppointments'
import type { PartnerAppointmentExclusionReason } from './partnerAppointments'

export type SalesMatchDisposition = 'matched' | 'unmatched' | 'ambiguous' | 'review' | 'excluded'
export type SalesMatchReason = PartnerAppointmentExclusionReason
  | 'no-existing-customer'
  | 'duplicate-appointments-same-partner'
  | 'duplicate-appointments-different-partners'
  | 'unknown-status-orders-excluded'
  | 'return-amount-not-negative'
  | 'return-original-order-missing'
  | 'return-route-mismatch'
  | 'return-exceeds-original-amount'
  | 'negative-customer-total'

export interface SalesMatchAmounts {
  orderCount: number
  confirmedOrderCount: number
  reservedOrderCount: number
  tentativeOrderCount: number
  saleAmount: number
  eligibleSaleAmount: number
  expectedCommission: number
  confirmedSaleAmount: number
  confirmedEligibleSaleAmount: number
  confirmedExpectedCommission: number
  reservedSaleAmount: number
  reservedEligibleSaleAmount: number
  reservedExpectedCommission: number
  tentativeSaleAmount: number
  tentativeEligibleSaleAmount: number
  tentativeExpectedCommission: number
  returnOrderCount: number
  returnSaleAmount: number
}

/** A plan describes possible writes; it never edits customers or their manual records. */
export interface SalesCustomerMatch {
  disposition: SalesMatchDisposition
  identityKey: string
  customerName: string
  phoneLast4: string
  candidateLeadIds: string[]
  candidatePartnerNames: string[]
  leadId?: string
  partnerName?: string
  reasons: SalesMatchReason[]
  admittedOrders: SalesRawOrder[]
  amounts: SalesMatchAmounts
}

export interface SalesMatchSummary {
  rawCustomerCount: number
  admittedCustomerCount: number
  matchedCustomers: number
  unmatchedCustomers: number
  ambiguousCustomers: number
  reviewCustomers: number
  excludedCustomers: number
  existingInvalidIdentityCount: number
  parserErrorCount: number
  parserWarningCount: number
  admitted: SalesMatchAmounts
  matched: SalesMatchAmounts
  held: SalesMatchAmounts
}

export interface SalesMatchPlan {
  entries: SalesCustomerMatch[]
  matched: SalesCustomerMatch[]
  unmatched: SalesCustomerMatch[]
  ambiguous: SalesCustomerMatch[]
  review: SalesCustomerMatch[]
  excluded: SalesCustomerMatch[]
  summary: SalesMatchSummary
}

const isAdmitted = (order: SalesRawOrder) => order.orderStatus === '확정' || order.orderStatus === '예약' || order.orderStatus === '가예약'
const partnerIdentity = (partner: string) => partner.normalize('NFKC').trim().replace(/\s+/g, ' ')

function amountsFor(orders: SalesRawOrder[]): SalesMatchAmounts {
  const amounts: SalesMatchAmounts = {
    orderCount: orders.length, confirmedOrderCount: 0, reservedOrderCount: 0, tentativeOrderCount: 0,
    saleAmount: 0, eligibleSaleAmount: 0, expectedCommission: 0,
    confirmedSaleAmount: 0, confirmedEligibleSaleAmount: 0, confirmedExpectedCommission: 0,
    reservedSaleAmount: 0, reservedEligibleSaleAmount: 0, reservedExpectedCommission: 0,
    tentativeSaleAmount: 0, tentativeEligibleSaleAmount: 0, tentativeExpectedCommission: 0,
    returnOrderCount: 0, returnSaleAmount: 0,
  }
  for (const order of orders) {
    const eligible = isSalesCommissionChannelEligible(order.channel1, order.channel2)
    amounts.saleAmount += order.saleAmount
    if (eligible) amounts.eligibleSaleAmount += order.saleAmount
    if (order.orderStatus === '확정') {
      amounts.confirmedOrderCount += 1
      amounts.confirmedSaleAmount += order.saleAmount
      if (eligible) amounts.confirmedEligibleSaleAmount += order.saleAmount
    } else if (order.orderStatus === '예약') {
      amounts.reservedOrderCount += 1
      amounts.reservedSaleAmount += order.saleAmount
      if (eligible) amounts.reservedEligibleSaleAmount += order.saleAmount
    } else if (order.orderStatus === '가예약') {
      amounts.tentativeOrderCount += 1
      amounts.tentativeSaleAmount += order.saleAmount
      if (eligible) amounts.tentativeEligibleSaleAmount += order.saleAmount
    }
    if (order.isReturnOrRefund || order.saleAmount < 0) {
      amounts.returnOrderCount += 1
      amounts.returnSaleAmount += order.saleAmount
    }
  }
  amounts.expectedCommission = Math.round(amounts.eligibleSaleAmount * 0.02)
  amounts.confirmedExpectedCommission = Math.round(amounts.confirmedEligibleSaleAmount * 0.02)
  amounts.reservedExpectedCommission = Math.round(amounts.reservedEligibleSaleAmount * 0.02)
  amounts.tentativeExpectedCommission = Math.round(amounts.tentativeEligibleSaleAmount * 0.02)
  return amounts
}

function returnReviewReasons(orders: SalesRawOrder[]): SalesMatchReason[] {
  const reasons = new Set<SalesMatchReason>()
  const originals = new Map(orders.filter(order => !order.isReturnOrRefund && order.saleAmount > 0).map(order => [order.orderReference, order]))
  const returnedByOriginal = new Map<string, number>()
  for (const order of orders) {
    if (!order.isReturnOrRefund && order.saleAmount >= 0) continue
    if (order.saleAmount >= 0) reasons.add('return-amount-not-negative')
    const original = originals.get(order.originalOrderReference)
    if (!original || original.identityKey !== order.identityKey) {
      reasons.add('return-original-order-missing')
      continue
    }
    if (order.channel1.trim() !== original.channel1.trim() || order.channel2.trim() !== original.channel2.trim()) {
      reasons.add('return-route-mismatch')
    }
    const returned = (returnedByOriginal.get(original.orderReference) || 0) + Math.abs(Math.min(order.saleAmount, 0))
    returnedByOriginal.set(original.orderReference, returned)
    if (returned > original.saleAmount) reasons.add('return-exceeds-original-amount')
  }
  if (orders.reduce((total, order) => total + order.saleAmount, 0) < 0) reasons.add('negative-customer-total')
  return [...reasons]
}

function matchCustomer(customer: SalesRawCustomer, candidates: Lead[]): SalesCustomerMatch {
  const admittedOrders = customer.orders.filter(isAdmitted)
  const reasons: SalesMatchReason[] = []
  const hasUnknownStatus = customer.orders.some(order => order.orderStatus === '기타')
  if (hasUnknownStatus) reasons.push('unknown-status-orders-excluded')
  const entry: SalesCustomerMatch = {
    disposition: 'excluded', identityKey: customer.identityKey, customerName: customer.customerName,
    phoneLast4: customer.phoneLast4, candidateLeadIds: candidates.map(lead => lead.id),
    candidatePartnerNames: [...new Set(candidates.map(lead => lead.partnerName))], reasons,
    admittedOrders, amounts: amountsFor(admittedOrders),
  }
  const appointmentExclusion = candidates.length === 1
    ? partnerAppointmentExclusionReason(candidates[0].appointmentType) : undefined
  if (appointmentExclusion) {
    reasons.push(appointmentExclusion)
    // Do not turn a general/legacy record into a referral merely because identity agrees.
    return entry
  }
  if (!admittedOrders.length) {
    if (hasUnknownStatus) entry.disposition = 'review'
    return entry
  }
  const returnReasons = returnReviewReasons(admittedOrders)
  reasons.push(...returnReasons)
  if (candidates.length > 1) {
    reasons.push(new Set(candidates.map(lead => partnerIdentity(lead.partnerName))).size > 1
      ? 'duplicate-appointments-different-partners'
      : 'duplicate-appointments-same-partner')
    entry.disposition = 'ambiguous'
  } else if (hasUnknownStatus || returnReasons.length) {
    entry.disposition = 'review'
  } else if (!candidates.length) {
    reasons.push('no-existing-customer')
    entry.disposition = 'unmatched'
  } else {
    entry.disposition = 'matched'
    entry.leadId = candidates[0].id
    entry.partnerName = candidates[0].partnerName
  }
  return entry
}

function combineAmounts(entries: SalesCustomerMatch[]): SalesMatchAmounts {
  const total = amountsFor([])
  // Sum already-rounded customer commissions, matching one customer-level write per entry.
  for (const entry of entries) for (const key of Object.keys(total) as (keyof SalesMatchAmounts)[]) {
    total[key] += entry.amounts[key]
  }
  return total
}

/**
 * Both masked name and phone suffix must agree. We do not infer a partner from a seller,
 * fall back to one identity field, create missing customers, or choose among appointments.
 * A unique customer must also have an explicit saved partner appointment type.
 * The same source order cannot be credited to several existing records.
 */
export function buildSalesMatchPlan(raw: SalesRawResult, leads: Lead[]): SalesMatchPlan {
  const byIdentity = new Map<string, Lead[]>()
  let existingInvalidIdentityCount = 0
  for (const lead of leads) {
    const identity = customerIdentityKey(lead.customerName, lead.phoneLast4)
    if (!identity) { existingInvalidIdentityCount += 1; continue }
    const candidates = byIdentity.get(identity) || []
    // A repeated view of one document is not a second appointment.
    if (!candidates.some(candidate => candidate.id === lead.id)) candidates.push(lead)
    byIdentity.set(identity, candidates)
  }
  const entries = raw.customers.map(customer => matchCustomer(customer, byIdentity.get(customer.identityKey) || []))
  const matched = entries.filter(entry => entry.disposition === 'matched')
  const unmatched = entries.filter(entry => entry.disposition === 'unmatched')
  const ambiguous = entries.filter(entry => entry.disposition === 'ambiguous')
  const review = entries.filter(entry => entry.disposition === 'review')
  const excluded = entries.filter(entry => entry.disposition === 'excluded')
  return {
    entries, matched, unmatched, ambiguous, review, excluded,
    summary: {
      rawCustomerCount: entries.length,
      admittedCustomerCount: entries.filter(entry => entry.amounts.orderCount > 0).length,
      matchedCustomers: matched.length, unmatchedCustomers: unmatched.length,
      ambiguousCustomers: ambiguous.length, reviewCustomers: review.length, excludedCustomers: excluded.length,
      existingInvalidIdentityCount, parserErrorCount: raw.summary.errorCount, parserWarningCount: raw.summary.warningCount,
      admitted: combineAmounts(entries), matched: combineAmounts(matched),
      held: combineAmounts([...unmatched, ...ambiguous, ...review]),
    },
  }
}
