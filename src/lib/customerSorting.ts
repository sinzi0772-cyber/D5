import type { Lead } from '../types'
import { salesRawAmountsFor, subscriptionRawAmountsFor, totalPurchaseAmountFor } from './salesFinance'

export type PurchaseSortDirection = 'asc' | 'desc'

/** Never pull linked customer amounts from outside the caller's visible/filter scope. */
export function getVisiblePurchaseMembers(lead: Lead, visibleLeads: Lead[]): Lead[] {
  return visibleLeads.filter(member => lead.caseGroupId
    ? member.caseGroupId === lead.caseGroupId
    : member.id === lead.id)
}

/** Null is the displayed dash; an imported, verified zero is a real 0원 amount. */
export function purchaseSortValue(lead: Lead, visibleLeads: Lead[]): number | null {
  const members = [...new Map(getVisiblePurchaseMembers(lead, visibleLeads).map(member => [member.id, member])).values()]
  const total = members.reduce((sum, member) => sum + totalPurchaseAmountFor(member), 0)
  return total > 0 || members.some(member => salesRawAmountsFor(member).current || subscriptionRawAmountsFor(member).current) ? total : null
}

/** Missing values remain at the bottom in both directions; equal amounts retain row order. */
export function comparePurchaseAmounts(left: number | null, right: number | null, direction: PurchaseSortDirection): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return (left - right) * (direction === 'asc' ? 1 : -1)
}
