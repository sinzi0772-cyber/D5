import type { Lead } from '../types'
import { customerIdentityKey, isSalesCommissionChannelEligible } from './salesRaw'
import type { SubscriptionRawCustomer, SubscriptionRawItem, SubscriptionRawResult } from './subscriptionRaw'
import { partnerAppointmentExclusionReason } from './partnerAppointments'
import type { PartnerAppointmentExclusionReason } from './partnerAppointments'

export type SubscriptionMatchDisposition = 'matched' | 'unmatched' | 'ambiguous' | 'review' | 'excluded'
export type SubscriptionMatchReason = PartnerAppointmentExclusionReason
  | 'no-existing-customer'
  | 'duplicate-appointments-same-partner'
  | 'duplicate-appointments-different-partners'
  | 'excluded-items-not-counted'
  | 'missing-basis-items'
  | 'missing-all-basis-amounts'
  | 'raw-items-review-required'
  | 'rejected-proof-items-included'
  | 'ineligible-channel-items-excluded'

export interface SubscriptionMatchAmounts {
  itemCount: number
  orderCount: number
  knownBasisItems: number
  missingBasisItems: number
  confirmedItemCount: number
  pendingItemCount: number
  basisAmount: number
  eligibleBasisAmount: number
  confirmedBasisAmount: number
  pendingBasisAmount: number
  eligibleConfirmedBasisAmount: number
  eligiblePendingBasisAmount: number
  rejectedItemCount: number
  rejectedBasisAmount: number
  excludedItemCount: number
  excludedBasisAmount: number
}

/** A matching plan describes a possible import; it never changes a customer. */
export interface SubscriptionCustomerMatch {
  disposition: SubscriptionMatchDisposition
  identityKey: string
  customerName: string
  phoneLast4: string
  candidateLeadIds: string[]
  candidatePartnerNames: string[]
  leadId?: string
  partnerName?: string
  reasons: SubscriptionMatchReason[]
  admittedItems: SubscriptionRawItem[]
  amounts: SubscriptionMatchAmounts
}

export interface SubscriptionMatchSummary {
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
  admitted: SubscriptionMatchAmounts
  matched: SubscriptionMatchAmounts
  held: SubscriptionMatchAmounts
}

export interface SubscriptionMatchPlan {
  entries: SubscriptionCustomerMatch[]
  matched: SubscriptionCustomerMatch[]
  unmatched: SubscriptionCustomerMatch[]
  ambiguous: SubscriptionCustomerMatch[]
  review: SubscriptionCustomerMatch[]
  excluded: SubscriptionCustomerMatch[]
  summary: SubscriptionMatchSummary
}

const isAdmitted = (item: SubscriptionRawItem) => item.statusDisposition === 'confirmed' || item.statusDisposition === 'reserved'
const partnerIdentity = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ')
const isRejected = (item: SubscriptionRawItem) => item.isEvidenceRejected || item.evidenceApprovalStatus === '반려'

function emptyAmounts(): SubscriptionMatchAmounts {
  return {
    itemCount: 0, orderCount: 0, knownBasisItems: 0, missingBasisItems: 0,
    confirmedItemCount: 0, pendingItemCount: 0, basisAmount: 0, eligibleBasisAmount: 0,
    confirmedBasisAmount: 0, pendingBasisAmount: 0,
    eligibleConfirmedBasisAmount: 0, eligiblePendingBasisAmount: 0,
    rejectedItemCount: 0, rejectedBasisAmount: 0, excludedItemCount: 0, excludedBasisAmount: 0,
  }
}

function amountsFor(items: SubscriptionRawItem[]): SubscriptionMatchAmounts {
  const amounts = emptyAmounts()
  const orderKeys = new Set<string>()
  for (const item of items) {
    if (item.statusDisposition === 'excluded') {
      amounts.excludedItemCount += 1
      if (item.membershipBenefitBasisAmount !== null) amounts.excludedBasisAmount += item.membershipBenefitBasisAmount
      continue
    }
    if (!isAdmitted(item)) continue
    amounts.itemCount += 1
    // Reference namespaces distinguish BEST, LGE and contract-number fallback keys.
    orderKeys.add(`${item.itemReference.split(':')[0]}:${item.orderReference}`)
    if (item.statusDisposition === 'confirmed') amounts.confirmedItemCount += 1
    else amounts.pendingItemCount += 1
    if (isRejected(item)) amounts.rejectedItemCount += 1
    const amount = item.membershipBenefitBasisAmount
    if (amount === null) {
      // Blank component rows are counted as missing, never replaced by another price.
      amounts.missingBasisItems += 1
      continue
    }
    amounts.knownBasisItems += 1
    amounts.basisAmount += amount
    if (item.statusDisposition === 'confirmed') amounts.confirmedBasisAmount += amount
    else amounts.pendingBasisAmount += amount
    if (isRejected(item)) amounts.rejectedBasisAmount += amount
    // User-approved rule: rejected proof still counts for an eligible sales route.
    // Recheck the route itself rather than trusting a stale parser approval flag.
    const eligible = isSalesCommissionChannelEligible(item.channel1, item.channel2)
    if (eligible) {
      amounts.eligibleBasisAmount += amount
      if (item.statusDisposition === 'confirmed') amounts.eligibleConfirmedBasisAmount += amount
      else amounts.eligiblePendingBasisAmount += amount
    }
  }
  amounts.orderCount = orderKeys.size
  return amounts
}

function matchCustomer(customer: SubscriptionRawCustomer, candidates: Lead[]): SubscriptionCustomerMatch {
  const admittedItems = customer.items.filter(isAdmitted)
  const amounts = amountsFor(customer.items)
  const reasons: SubscriptionMatchReason[] = []
  if (amounts.excludedItemCount) reasons.push('excluded-items-not-counted')
  if (amounts.missingBasisItems) reasons.push('missing-basis-items')
  if (amounts.rejectedItemCount) reasons.push('rejected-proof-items-included')
  if (admittedItems.some(item => !isSalesCommissionChannelEligible(item.channel1, item.channel2))) reasons.push('ineligible-channel-items-excluded')
  const needsReview = customer.hasBlockingIssue || customer.items.some(item => item.hasBlockingIssue || item.statusDisposition === 'review')
  if (needsReview) reasons.push('raw-items-review-required')
  const entry: SubscriptionCustomerMatch = {
    disposition: 'excluded', identityKey: customer.identityKey, customerName: customer.customerName,
    phoneLast4: customer.phoneLast4, candidateLeadIds: candidates.map(lead => lead.id),
    candidatePartnerNames: [...new Set(candidates.map(lead => lead.partnerName))],
    reasons, admittedItems, amounts,
  }
  const appointmentExclusion = candidates.length === 1
    ? partnerAppointmentExclusionReason(candidates[0].appointmentType) : undefined
  if (appointmentExclusion) {
    reasons.push(appointmentExclusion)
    // A known customer alone does not prove an inter-industry partner appointment.
    return entry
  }
  if (needsReview) {
    entry.disposition = 'review'
  } else if (!admittedItems.length) {
    // Canceled-only customers are excluded, without resetting any existing manual amount.
    entry.disposition = 'excluded'
  } else if (!amounts.knownBasisItems) {
    reasons.push('missing-all-basis-amounts')
    entry.disposition = 'review'
  } else if (candidates.length > 1) {
    reasons.push(new Set(candidates.map(lead => partnerIdentity(lead.partnerName))).size > 1
      ? 'duplicate-appointments-different-partners' : 'duplicate-appointments-same-partner')
    entry.disposition = 'ambiguous'
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

function combineAmounts(entries: SubscriptionCustomerMatch[]): SubscriptionMatchAmounts {
  const amounts = emptyAmounts()
  for (const entry of entries) for (const key of Object.keys(amounts) as (keyof SubscriptionMatchAmounts)[]) {
    amounts[key] += entry.amounts[key]
  }
  return amounts
}

/**
 * Match masked name AND last four phone digits. Do not choose between multiple
 * appointment records, infer a partner from a seller, or create a missing customer.
 * The unique candidate must have an explicit saved partner appointment type.
 * The percentage and partner eligibility are evaluated only after this exact match.
 */
export function buildSubscriptionMatchPlan(raw: SubscriptionRawResult, leads: Lead[]): SubscriptionMatchPlan {
  const byIdentity = new Map<string, Lead[]>()
  let existingInvalidIdentityCount = 0
  for (const lead of leads) {
    const key = customerIdentityKey(lead.customerName, lead.phoneLast4)
    if (!key) { existingInvalidIdentityCount += 1; continue }
    const candidates = byIdentity.get(key) || []
    if (!candidates.some(candidate => candidate.id === lead.id)) candidates.push(lead)
    byIdentity.set(key, candidates)
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
      admittedCustomerCount: entries.filter(entry => entry.amounts.itemCount > 0).length,
      matchedCustomers: matched.length, unmatchedCustomers: unmatched.length,
      ambiguousCustomers: ambiguous.length, reviewCustomers: review.length, excludedCustomers: excluded.length,
      existingInvalidIdentityCount, parserErrorCount: raw.summary.errorCount, parserWarningCount: raw.summary.warningCount,
      admitted: combineAmounts(entries), matched: combineAmounts(matched),
      held: combineAmounts([...unmatched, ...ambiguous, ...review]),
    },
  }
}
