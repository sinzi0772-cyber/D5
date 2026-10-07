import type { Lead } from '../types'
import { isSubscriptionRebatePartner } from './subscriptionPartners'

export { isSubscriptionRebatePartner } from './subscriptionPartners'

type FinancialLead = Pick<Lead, 'purchaseType' | 'purchaseAmount' | 'lumpSumAmount' | 'subscriptionAmount' | 'partnerName' | 'appointmentType' | 'salesRawPeriods' | 'subscriptionRawPeriods'>
const validAmount = (value?: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
export const lumpSumAmountFor = (lead: Pick<Lead, 'purchaseType' | 'purchaseAmount' | 'lumpSumAmount'>) => validAmount(lead.lumpSumAmount ?? (lead.purchaseType === '일시불' ? lead.purchaseAmount : undefined))
export const subscriptionAmountFor = (lead: Pick<Lead, 'purchaseType' | 'purchaseAmount' | 'subscriptionAmount'>) => validAmount(lead.subscriptionAmount ?? (lead.purchaseType === '구독' ? lead.purchaseAmount : undefined))
export const totalPurchaseAmountFor = (lead: FinancialLead) => lumpSumAmountFor(lead) + subscriptionAmountFor(lead)

export function salesRawAmountsFor(lead: FinancialLead) {
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

/** Use current RAW evidence or the approved manual amount of a partner appointment. */
export function expectedRebateFor(lead: FinancialLead): number {
  return expectedRebateBreakdownFor(lead).total
}

export function subscriptionRawAmountsFor(lead: FinancialLead) {
  const periods = Object.values(lead.subscriptionRawPeriods || {})
  const sum = (key: 'confirmedBasisAmount' | 'pendingBasisAmount' | 'eligibleConfirmedBasisAmount' | 'eligiblePendingBasisAmount') => periods.reduce((total, period) => total + (Number.isFinite(period[key]) ? period[key] : 0), 0)
  const confirmed = sum('confirmedBasisAmount')
  const pending = sum('pendingBasisAmount')
  const current = periods.length > 0 && subscriptionAmountFor(lead) === Math.max(0, confirmed + pending)
  return { current, confirmed, pending, eligibleConfirmed: current ? sum('eligibleConfirmedBasisAmount') : 0, eligiblePending: current ? sum('eligiblePendingBasisAmount') : 0 }
}

export interface PurchaseAmountSource {
  kind: 'raw' | 'manual' | 'empty'
  amount: number
  rawAmount: number | null
}

/** Report amount provenance without replacing a manually entered amount. */
export function purchaseAmountSourceFor(lead: FinancialLead, kind: 'lumpSum' | 'subscription'): PurchaseAmountSource {
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

const isManualPartnerAppointment = (lead: FinancialLead) => lead.appointmentType === '이업종제휴' || lead.appointmentType === '상담예약(이업종)'

function lumpSumCommissionBasisFor(lead: FinancialLead): number {
  const raw = salesRawAmountsFor(lead)
  if (raw.current) return Math.max(0, raw.eligibleConfirmed + raw.eligibleReserved + raw.eligibleTentative)
  // A mismatch is a manual amount, not permission to reuse an old RAW subtotal.
  return isManualPartnerAppointment(lead) ? lumpSumAmountFor(lead) : 0
}

function subscriptionCommissionBasisFor(lead: FinancialLead): number {
  if (!isSubscriptionRebatePartner(lead.partnerName)) return 0
  const raw = subscriptionRawAmountsFor(lead)
  if (raw.current) return Math.max(0, raw.eligibleConfirmed + raw.eligiblePending)
  return isManualPartnerAppointment(lead) ? subscriptionAmountFor(lead) : 0
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
  const lumpSumBasis = lumpSumCommissionBasisFor(lead)
  const subscriptionBasis = subscriptionCommissionBasisFor(lead)
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
  const raw = salesRawAmountsFor(lead)
  const subscription = subscriptionRawAmountsFor(lead)
  return (raw.current ? raw.confirmed : lead.status === '구매완료' ? lumpSumAmountFor(lead) : 0)
    + (subscription.current ? subscription.confirmed : lead.status === '구매완료' ? subscriptionAmountFor(lead) : 0)
}

/** Business completion is separate from original order confirmation or delivery. */
export function completedSalesFor(lead: Lead): number {
  const raw = salesRawAmountsFor(lead)
  const subscription = subscriptionRawAmountsFor(lead)
  return (raw.current ? raw.completed : lead.status === '구매완료' ? lumpSumAmountFor(lead) : 0)
    + (subscription.current ? subscription.confirmed : lead.status === '구매완료' ? subscriptionAmountFor(lead) : 0)
}
