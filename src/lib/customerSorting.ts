import type { Lead } from '../types'
import { financialTotalPurchaseAmountFor, salesRawAmountsFor, subscriptionRawAmountsFor } from './salesFinance'
import { caseBasisGroupsFor, financialCaseLeadFor } from './caseBasis'
import { canonicalPartnerName } from './partners'

export type PurchaseSortDirection = 'asc' | 'desc'

/** Never pull linked customer amounts from outside the caller's visible/filter scope. */
export function getVisiblePurchaseMembers(lead: Lead, visibleLeads: Lead[]): Lead[] {
  return visibleLeads.filter(member => lead.caseGroupId
    ? member.caseGroupId === lead.caseGroupId
    : member.id === lead.id)
}

/** Null is the displayed dash; an imported, verified zero is a real 0원 amount. */
export function purchaseSortValue(lead: Lead, visibleLeads: Lead[], completeLeads: readonly Lead[] = visibleLeads): number | null {
  if (!getVisiblePurchaseMembers(lead, visibleLeads).length) return null
  const group = caseBasisGroupsFor(completeLeads).find(item => item.members.some(member => member.id === lead.id))
  if (!group || !group.selection.basis || canonicalPartnerName(group.selection.basis.partnerName) !== canonicalPartnerName(lead.partnerName)) return null
  const basis = financialCaseLeadFor(group.selection, group.members)
  if (!basis) return null
  const total = financialTotalPurchaseAmountFor(basis)
  return total > 0 || salesRawAmountsFor(basis).current || subscriptionRawAmountsFor(basis).current ? total : null
}

/** Missing values remain at the bottom in both directions; equal amounts retain row order. */
export function comparePurchaseAmounts(left: number | null, right: number | null, direction: PurchaseSortDirection): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return (left - right) * (direction === 'asc' ? 1 : -1)
}
