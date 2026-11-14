import type { Lead } from '../types'
import { expectedRebateFor, financialTotalPurchaseAmountFor, salesRawAmountsFor, subscriptionRawAmountsFor } from './salesFinance'
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
  if (lead.status === '취소' || !getVisiblePurchaseMembers(lead, visibleLeads).length) return null
  const group = caseBasisGroupsFor(completeLeads).find(item => item.members.some(member => member.id === lead.id))
  if (!group || !group.selection.basis || canonicalPartnerName(group.selection.basis.partnerName) !== canonicalPartnerName(lead.partnerName)) return null
  const basis = financialCaseLeadFor(group.selection, group.members)
  if (!basis || basis.status === '취소') return null
  const total = financialTotalPurchaseAmountFor(basis)
  return total > 0 || salesRawAmountsFor(basis).current || subscriptionRawAmountsFor(basis).current ? total : null
}

/** Resolve each complete case once, then attribute fees only to a visible row of its company. */
export function expectedCommissionByCustomer(visibleRows: readonly Lead[], completeLeads: readonly Lead[]): Map<string, number> {
  const visible = new Map(visibleRows.map(lead => [lead.id, lead]))
  const amounts = new Map<string, number>()
  for (const group of caseBasisGroupsFor(completeLeads)) {
    if (!group.members.some(member => visible.has(member.id))) continue
    const basis = financialCaseLeadFor(group.selection, group.members)
    if (!basis || basis.status === '취소' || (!financialTotalPurchaseAmountFor(basis)
      && !salesRawAmountsFor(basis).current && !subscriptionRawAmountsFor(basis).current)) continue
    const commission = expectedRebateFor(basis)
    const company = canonicalPartnerName(basis.partnerName)
    for (const member of group.members) {
      const row = visible.get(member.id)
      if (row && row.status !== '취소' && canonicalPartnerName(row.partnerName) === company) amounts.set(row.id, commission)
    }
  }
  return amounts
}

/** Missing values remain at the bottom in both directions; equal amounts retain row order. */
export function comparePurchaseAmounts(left: number | null, right: number | null, direction: PurchaseSortDirection): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return (left - right) * (direction === 'asc' ? 1 : -1)
}
