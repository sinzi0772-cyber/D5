import type { Lead } from '../types'
import { isSubscriptionRebatePartner } from './subscriptionPartners'
import { financialCaseLeadsFor } from './caseBasis'
import { canonicalPartnerName } from './partners'

export { isSubscriptionRebatePartner } from './subscriptionPartners'

type FinancialLead = Pick<Lead, 'id' | 'purchaseType' | 'purchaseAmount' | 'lumpSumAmount' | 'subscriptionAmount' | 'lumpSumSourceId' | 'subscriptionSourceId' | 'caseBasisLeadId' | 'partnerName' | 'appointmentType' | 'salesRawPeriods' | 'subscriptionRawPeriods' | 'subscriptionSettlementReview'>
export interface SalesRawAmounts {
  current: boolean
  confirmed: number
  reserved: number
  tentative: number
  completed: number
  pending: number
  eligibleConfirmed: number
  eligibleReserved: number
  eligibleTentative: number
}
export interface SubscriptionRawAmounts {
  current: boolean
  confirmed: number
  pending: number
  eligibleConfirmed: number
  eligiblePending: number
}
/** Nonserializable calculation context. Never a saved Lead field or fabricated RAW. */
export interface CaseFinancialProjection {
  lumpSumBasis: number
  subscriptionBasis: number
  salesRaw: SalesRawAmounts
  subscriptionRaw: SubscriptionRawAmounts
  pendingAmount: number
  confirmedSales: number
  completedSales: number
  lumpSumSource: PurchaseAmountSource
  subscriptionSource: PurchaseAmountSource
  commissionVerificationRequired: boolean
}
const caseFinancialProjections = new WeakMap<object, CaseFinancialProjection>()
export function registerCaseFinancialProjection(lead: Lead, totals: CaseFinancialProjection): Lead {
  caseFinancialProjections.set(lead, totals)
  return lead
}
const validAmount = (value?: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
export const lumpSumAmountFor = (lead: Pick<Lead, 'purchaseType' | 'purchaseAmount' | 'lumpSumAmount'>) => validAmount(lead.lumpSumAmount ?? (lead.purchaseType === '일시불' ? lead.purchaseAmount : undefined))
export const subscriptionAmountFor = (lead: Pick<Lead, 'purchaseType' | 'purchaseAmount' | 'subscriptionAmount'>) => validAmount(lead.subscriptionAmount ?? (lead.purchaseType === '구독' ? lead.purchaseAmount : undefined))
export const totalPurchaseAmountFor = (lead: FinancialLead) => lumpSumAmountFor(lead) + subscriptionAmountFor(lead)

/** An explicit alias displays shared amounts but never creates another purchase. */
export function isFinancialOwnerFor(lead: Pick<Lead, 'id' | 'lumpSumSourceId' | 'subscriptionSourceId' | 'caseBasisLeadId'>, kind: 'lumpSum' | 'subscription'): boolean {
  if (lead.caseBasisLeadId && lead.caseBasisLeadId !== lead.id) return false
  const sourceId = kind === 'lumpSum' ? lead.lumpSumSourceId : lead.subscriptionSourceId
  return sourceId === undefined || sourceId === lead.id
}

export const financialLumpSumAmountFor = (lead: FinancialLead) => isFinancialOwnerFor(lead, 'lumpSum') ? lumpSumAmountFor(lead) : 0
export const financialSubscriptionAmountFor = (lead: FinancialLead) => isFinancialOwnerFor(lead, 'subscription') ? subscriptionAmountFor(lead) : 0
export const financialTotalPurchaseAmountFor = (lead: FinancialLead) => financialLumpSumAmountFor(lead) + financialSubscriptionAmountFor(lead)

/** One amount per case; pending choices contribute no amount. Independent
 * originals are added only by the explicit, validated full-roster merge model. */
export function displayedPurchaseAmountFor(leads: readonly Lead[]): number {
  return financialCaseLeadsFor(leads).reduce((sum, lead) => sum + totalPurchaseAmountFor(lead), 0)
}

export function salesRawAmountsFor(lead: FinancialLead): SalesRawAmounts {
  const projection = caseFinancialProjections.get(lead)
  if (projection) return { ...projection.salesRaw }
  const periods = Object.values(lead.salesRawPeriods || {})
  const sum = (key: 'confirmedAmount' | 'reservedAmount' | 'tentativeAmount' | 'eligibleConfirmedAmount' | 'eligibleReservedAmount' | 'eligibleTentativeAmount') => periods.reduce((total, period) => total + (typeof period[key] === 'number' && Number.isFinite(period[key]) ? period[key] : 0), 0)
  // Preserve signed subtotals: a confirmed refund may offset a reserved order.
  const confirmed = sum('confirmedAmount')
  const reserved = sum('reservedAmount')
  const tentative = sum('tentativeAmount')
  const completedReservations = periods.reduce((total, period) => total + (period.completedStatuses?.includes('예약') ? period.reservedAmount || 0 : 0) + (period.completedStatuses?.includes('가예약') ? period.tentativeAmount || 0 : 0), 0)
  // A manual amount change must not retain an unrelated RAW commission basis.
  const current = periods.length > 0 && lumpSumAmountFor(lead) === Math.max(0, confirmed + reserved + tentative)
  return {
    current,
    confirmed,
    reserved,
    tentative,
    completed: confirmed + completedReservations,
    pending: reserved + tentative - completedReservations,
    eligibleConfirmed: current ? sum('eligibleConfirmedAmount') : 0,
    eligibleReserved: current ? sum('eligibleReservedAmount') : 0,
    eligibleTentative: current ? sum('eligibleTentativeAmount') : 0,
  }
}

/** Commission uses current RAW rows in the payable source status. */
export function expectedRebateFor(lead: FinancialLead): number {
  return expectedRebateBreakdownFor(lead).total
}

export function subscriptionRawAmountsFor(lead: FinancialLead): SubscriptionRawAmounts {
  const projection = caseFinancialProjections.get(lead)
  if (projection) return { ...projection.subscriptionRaw }
  const periods = Object.values(lead.subscriptionRawPeriods || {})
  const sum = (key: 'confirmedBasisAmount' | 'pendingBasisAmount' | 'eligibleConfirmedBasisAmount' | 'eligiblePendingBasisAmount') => periods.reduce((total, period) => total + (Number.isFinite(period[key]) ? period[key] : 0), 0)
  const confirmed = sum('confirmedBasisAmount')
  const pending = sum('pendingBasisAmount')
  const current = periods.length > 0 && subscriptionAmountFor(lead) === Math.max(0, confirmed + pending)
  return { current, confirmed, pending, eligibleConfirmed: current ? sum('eligibleConfirmedBasisAmount') : 0, eligiblePending: current ? sum('eligiblePendingBasisAmount') : 0 }
}

/** Only the original owner's current RAW evidence contributes pending money. */
export function financialPendingAmountFor(lead: FinancialLead): number {
  const projection = caseFinancialProjections.get(lead)
  if (projection) return projection.pendingAmount
  const raw = salesRawAmountsFor(lead)
  const subscription = subscriptionRawAmountsFor(lead)
  return (isFinancialOwnerFor(lead, 'lumpSum') && raw.current ? raw.pending : 0)
    + (isFinancialOwnerFor(lead, 'subscription') && subscription.current ? subscription.pending : 0)
}

export interface PurchaseAmountSource {
  kind: 'raw' | 'manual' | 'empty'
  amount: number
  rawAmount: number | null
}

/** Report amount provenance without replacing a manually entered amount. */
export function purchaseAmountSourceFor(lead: FinancialLead, kind: 'lumpSum' | 'subscription'): PurchaseAmountSource {
  const projection = caseFinancialProjections.get(lead)
  if (projection) return { ...(kind === 'lumpSum' ? projection.lumpSumSource : projection.subscriptionSource) }
  const amount = kind === 'lumpSum' ? lumpSumAmountFor(lead) : subscriptionAmountFor(lead)
  const enteredAmount = kind === 'lumpSum'
    ? lead.lumpSumAmount ?? (lead.purchaseType === '일시불' ? lead.purchaseAmount : undefined)
    : lead.subscriptionAmount ?? (lead.purchaseType === '구독' ? lead.purchaseAmount : undefined)
  const hasEnteredAmount = typeof enteredAmount === 'number' && Number.isFinite(enteredAmount) && enteredAmount >= 0
  const hasRaw = Object.keys((kind === 'lumpSum' ? lead.salesRawPeriods : lead.subscriptionRawPeriods) || {}).length > 0
  let current: boolean
  let rawAmount: number | null
  if (kind === 'lumpSum') {
    const raw = salesRawAmountsFor(lead)
    current = raw.current
    rawAmount = hasRaw ? Math.max(0, raw.confirmed + raw.reserved + raw.tentative) : null
  } else {
    const raw = subscriptionRawAmountsFor(lead)
    current = raw.current
    rawAmount = hasRaw ? Math.max(0, raw.confirmed + raw.pending) : null
  }
  return { kind: current ? 'raw' : hasEnteredAmount ? 'manual' : 'empty', amount, rawAmount }
}

/** Verify the entered total and the original status breakdown before estimating commission. */
export function commissionVerificationRequiredFor(lead: FinancialLead): boolean {
  const projection = caseFinancialProjections.get(lead)
  if (projection) return projection.commissionVerificationRequired
  return isFinancialOwnerFor(lead, 'lumpSum') && lumpSumAmountFor(lead) > 0 && (!salesRawAmountsFor(lead).current
    || Object.values(lead.salesRawPeriods || {}).some(period => period.confirmedOrderCount > 0 && !Number.isSafeInteger(period.settlementBasisAmount)))
    || isFinancialOwnerFor(lead, 'subscription') && isSubscriptionRebatePartner(lead.partnerName) && subscriptionAmountFor(lead) > 0 && (!subscriptionRawAmountsFor(lead).current
    || Object.values(lead.subscriptionRawPeriods || {}).some(period => period.confirmedItemCount > 0 && !validSubscriptionSettlementBasis(period.settlementBasisAmount)))
}

const validSubscriptionSettlementBasis = (amount: number | undefined): amount is number => typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0

/** A review applies only to its exact entered amount and unchanged original evidence. */
function reviewedSubscriptionSettlementBasisFor(lead: FinancialLead): number {
  const review = lead.subscriptionSettlementReview
  if (!review || typeof review.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(review.period)
    || typeof review.sourceHash !== 'string' || !review.sourceHash || typeof review.reviewedAt !== 'string' || !Number.isFinite(Date.parse(review.reviewedAt))
    || review.partnerName !== canonicalPartnerName(lead.partnerName)
    || review.enteredAmount <= 0 || review.enteredAmount !== subscriptionAmountFor(lead)) return 0
  const period = lead.subscriptionRawPeriods?.[review.period]
  if (!period || period.period !== review.period || period.sourceHash !== review.sourceHash
    || period.confirmedBasisAmount !== review.confirmedBasisAmount || period.pendingBasisAmount !== review.pendingBasisAmount
    || !validSubscriptionSettlementBasis(period.settlementBasisAmount) || period.settlementBasisAmount !== review.settlementBasisAmount
    || !validSubscriptionSettlementBasis(review.confirmedBasisAmount) || !validSubscriptionSettlementBasis(review.pendingBasisAmount)
    || review.settlementBasisAmount > review.confirmedBasisAmount) return 0
  return period.settlementBasisAmount
}

/** Preserve signed cash RAW subtotals until the logical case is totaled. */
export function signedCommissionBasisFor(lead: FinancialLead, kind: 'lumpSum' | 'subscription'): number {
  const projection = caseFinancialProjections.get(lead)
  if (projection) return kind === 'lumpSum' ? projection.lumpSumBasis : projection.subscriptionBasis
  if (!isFinancialOwnerFor(lead, kind)) return 0
  if (kind === 'lumpSum') {
    if (!salesRawAmountsFor(lead).current) return 0
    return Object.values(lead.salesRawPeriods || {}).reduce((total, { settlementBasisAmount }) =>
      total + (typeof settlementBasisAmount === 'number' && Number.isSafeInteger(settlementBasisAmount) ? settlementBasisAmount : 0), 0)
  }
  if (!isSubscriptionRebatePartner(lead.partnerName)) return 0
  if (!subscriptionRawAmountsFor(lead).current) return reviewedSubscriptionSettlementBasisFor(lead)
  return Object.values(lead.subscriptionRawPeriods || {}).reduce((total, { settlementBasisAmount }) =>
    total + (validSubscriptionSettlementBasis(settlementBasisAmount) ? settlementBasisAmount : 0), 0)
}

export interface ExpectedRebateBreakdown {
  lumpSumBasis: number
  subscriptionBasis: number
  lumpSumCommission: number
  subscriptionCommission: number
  total: number
}

/** Round each purchase method to whole won before adding customer and case totals. */
export function expectedRebateBreakdownFor(lead: FinancialLead): ExpectedRebateBreakdown {
  const lumpSumBasis = Math.max(0, signedCommissionBasisFor(lead, 'lumpSum'))
  const subscriptionBasis = signedCommissionBasisFor(lead, 'subscription')
  const lumpSumCommission = Math.round(lumpSumBasis * 2 / 100)
  const subscriptionCommission = Math.round(subscriptionBasis * 3 / 200)
  return {
    lumpSumBasis,
    subscriptionBasis,
    lumpSumCommission,
    subscriptionCommission,
    total: lumpSumCommission + subscriptionCommission,
  }
}

export const expectedSubscriptionRebateFor = (lead: FinancialLead) => expectedRebateBreakdownFor(lead).subscriptionCommission
export const expectedLumpSumRebateFor = (lead: FinancialLead) => expectedRebateBreakdownFor(lead).lumpSumCommission

export function confirmedSalesFor(lead: Lead): number {
  const projection = caseFinancialProjections.get(lead)
  if (projection) return projection.confirmedSales
  const raw = salesRawAmountsFor(lead)
  const subscription = subscriptionRawAmountsFor(lead)
  return (isFinancialOwnerFor(lead, 'lumpSum') ? raw.current ? raw.confirmed : lead.status === '구매완료' ? lumpSumAmountFor(lead) : 0 : 0)
    + (isFinancialOwnerFor(lead, 'subscription') ? subscription.current ? subscription.confirmed : lead.status === '구매완료' ? subscriptionAmountFor(lead) : 0 : 0)
}

/** Business completion is separate from original order confirmation or delivery. */
export function completedSalesFor(lead: Lead): number {
  const projection = caseFinancialProjections.get(lead)
  if (projection) return projection.completedSales
  const raw = salesRawAmountsFor(lead)
  const subscription = subscriptionRawAmountsFor(lead)
  return (isFinancialOwnerFor(lead, 'lumpSum') ? raw.current ? raw.completed : lead.status === '구매완료' ? lumpSumAmountFor(lead) : 0 : 0)
    + (isFinancialOwnerFor(lead, 'subscription') ? subscription.current ? subscription.confirmed : lead.status === '구매완료' ? subscriptionAmountFor(lead) : 0 : 0)
}
