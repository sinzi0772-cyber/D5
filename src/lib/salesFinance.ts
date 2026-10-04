import type { Lead } from '../types'
import { isSubscriptionRebatePartner } from './subscriptionPartners'

export { isSubscriptionRebatePartner } from './subscriptionPartners'

type FinancialLead = Pick<Lead, 'purchaseType' | 'purchaseAmount' | 'lumpSumAmount' | 'subscriptionAmount' | 'partnerName' | 'salesRawPeriods' | 'subscriptionRawPeriods'>
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

/** Lump-sum commission requires the eligible-channel evidence from the sales RAW. */
export function expectedRebateFor(lead: FinancialLead): number {
  const raw = salesRawAmountsFor(lead)
  const subscription = subscriptionCommissionBasisFor(lead) * 0.015
  return Math.round(Math.max(0, raw.eligibleConfirmed + raw.eligibleReserved + raw.eligibleTentative) * 0.02 + subscription)
}

export function subscriptionRawAmountsFor(lead: FinancialLead) {
  const periods = Object.values(lead.subscriptionRawPeriods || {})
  const sum = (key: 'confirmedBasisAmount' | 'pendingBasisAmount' | 'eligibleConfirmedBasisAmount' | 'eligiblePendingBasisAmount') => periods.reduce((total, period) => total + (Number.isFinite(period[key]) ? period[key] : 0), 0)
  const confirmed = sum('confirmedBasisAmount')
  const pending = sum('pendingBasisAmount')
  const current = periods.length > 0 && subscriptionAmountFor(lead) === Math.max(0, confirmed + pending)
  return { current, confirmed, pending, eligibleConfirmed: current ? sum('eligibleConfirmedBasisAmount') : 0, eligiblePending: current ? sum('eligiblePendingBasisAmount') : 0 }
}

function subscriptionCommissionBasisFor(lead: FinancialLead): number {
  if (!isSubscriptionRebatePartner(lead.partnerName)) return 0
  const raw = subscriptionRawAmountsFor(lead)
  // Stale RAW evidence must not turn into unrestricted manual commission.
  return Object.keys(lead.subscriptionRawPeriods || {}).length
    ? Math.max(0, raw.eligibleConfirmed + raw.eligiblePending)
    : subscriptionAmountFor(lead)
}

export const expectedSubscriptionRebateFor = (lead: FinancialLead) => Math.round(subscriptionCommissionBasisFor(lead) * 0.015)

export function expectedLumpSumRebateFor(lead: FinancialLead): number {
  const raw = salesRawAmountsFor(lead)
  return Math.round(Math.max(0, raw.eligibleConfirmed + raw.eligibleReserved + raw.eligibleTentative) * 0.02)
}

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
