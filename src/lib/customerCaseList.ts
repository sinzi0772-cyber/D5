import type { Lead, LeadStatus, VisitState } from '../types'
import { caseBasisGroupsFor } from './caseBasis'
import { customerDisplayLabel, phoneLast4Display } from './customerDisplay'
import { canonicalPartnerName } from './partners'

export interface CustomerCaseFilters {
  query?: string
  status?: LeadStatus | '전체'
  partnerName?: string
  manager?: string
  visitState?: VisitState | '전체'
}
export interface CustomerCaseList {
  members: Lead[]
  rows: Lead[]
  excludedRowIds: Set<string>
}

/** Resolve complete groups before filtering. The selected original owns categories;
 * secondary records stay available for names, editor navigation and original data. */
export function buildCustomerCaseList(completeLeads: readonly Lead[], cohortLeads: readonly Lead[], filters: CustomerCaseFilters = {}): CustomerCaseList {
  const result: CustomerCaseList = { members: [], rows: [], excludedRowIds: new Set() }
  const cohortIds = new Set(cohortLeads.map(member => member.id))
  const term = filters.query?.trim().toLowerCase() || ''
  const matchesQuery = (member: Lead) => !term || [customerDisplayLabel(member), phoneLast4Display(member.phoneLast4), member.partnerName, member.manager]
    .some(value => value?.toLowerCase().includes(term))
  const matchesCategory = (member: Lead) => (!filters.status || filters.status === '전체' || member.status === filters.status)
    && (filters.manager === undefined || (filters.manager === '미배정' ? !member.manager?.trim() : member.manager === filters.manager))
    && (!filters.visitState || filters.visitState === '전체' || member.visitState === filters.visitState)
  const categorySelected = Boolean(filters.status && filters.status !== '전체' || filters.manager !== undefined || filters.visitState && filters.visitState !== '전체')
  for (const group of caseBasisGroupsFor(completeLeads)) {
    const visible = group.members.filter(member => cohortIds.has(member.id)
      && (filters.partnerName === undefined || canonicalPartnerName(member.partnerName) === canonicalPartnerName(filters.partnerName)))
    if (!visible.length) continue
    const basis = group.selection.status === 'unresolved' ? undefined : group.selection.basis
    if (basis) {
      const scopedBasis = visible.find(member => member.id === basis.id)
      // A company/partial view cannot substitute a secondary row for a hidden basis.
      if ((!scopedBasis && categorySelected) || (scopedBasis && !matchesCategory(scopedBasis)) || !visible.some(matchesQuery)) continue
      const row = scopedBasis || visible[0]
      result.members.push(...visible)
      result.rows.push(row)
      if (!scopedBasis) result.excludedRowIds.add(row.id)
    } else {
      // No selection yet: preserve the existing provisional original-row filter.
      const matching = visible.filter(member => matchesQuery(member) && matchesCategory(member))
      if (!matching.length) continue
      result.members.push(...matching)
      result.rows.push(matching[0])
    }
  }
  return result
}
