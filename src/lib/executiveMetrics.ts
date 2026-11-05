import type { Lead } from '../types'
import { managementMemoEntriesFor } from './memoHistory'
import { completedSalesFor, expectedRebateFor, financialPendingAmountFor, totalPurchaseAmountFor } from './salesFinance'
import { caseBasisGroupsFor, financialCaseLeadFor } from './caseBasis'
import { canonicalPartnerName } from './partners'

export interface ExecutivePeriodSummary {
  /** One linked case is one customer, regardless of the number of source records. */
  cases: number
  customerCount: number
  completed: number
  active: number
  closed: number
  canceled: number
  completedCustomers: number
  sales: number
  reservedSales: number
  expectedCommission: number
  missingAmounts: number
  basisRequiredCount: number
  conversionRate: number
  managementRecords: number
}
export interface ExecutivePartnerSummary extends ExecutivePeriodSummary { name: string }
export interface ExecutiveManagerSummary extends ExecutivePeriodSummary { name: string; assigned: number }
export interface ExecutiveMetrics {
  month: string
  previousMonth: string
  current: ExecutivePeriodSummary
  previous: ExecutivePeriodSummary
  actions: { unassigned: Lead[]; overdue: Lead[]; stale: Lead[] }
  partners: ExecutivePartnerSummary[]
  managers: ExecutiveManagerSummary[]
}
export const executiveTotalSalesFor = (row: Pick<ExecutivePeriodSummary, 'sales' | 'reservedSales'>): number => row.sales + row.reservedSales
export const getTopReferralPartners = (rows: readonly ExecutivePartnerSummary[]): ExecutivePartnerSummary[] => rows
  .filter(row => row.cases > 0 && row.name.trim().length > 0 && row.name.trim() !== '업체 미입력')
  .sort((a, b) => b.cases - a.cases || a.name.localeCompare(b.name, 'ko')).slice(0, 3)
export const getTopCommissionPartners = (rows: readonly ExecutivePartnerSummary[]): ExecutivePartnerSummary[] => rows
  .filter(row => row.expectedCommission > 0)
  .sort((a, b) => b.expectedCommission - a.expectedCommission || executiveTotalSalesFor(b) - executiveTotalSalesFor(a) || a.name.localeCompare(b.name, 'ko')).slice(0, 3)

type ResolvedCase = ReturnType<typeof caseBasisGroupsFor>[number]
type ScopedCase = ResolvedCase & { visibleMembers: Lead[] }
const dayInMilliseconds = 86_400_000
const dateOnly = (value?: string): string => {
  const date = value?.slice(0, 10) || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : ''
}
const validMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
const memoCount = (lead: Lead) => managementMemoEntriesFor(lead).length
const groupCases = (leads: readonly Lead[]): ScopedCase[] => caseBasisGroupsFor(leads).map(group => ({ ...group, visibleMembers: group.members }))
const casesForMonth = (cases: readonly ScopedCase[], month: string) => cases.filter(item => dateOnly(item.registeredAt).startsWith(`${month}-`))
const casesForPartner = (cases: readonly ScopedCase[], partnerName?: string): ScopedCase[] => partnerName
  ? cases.map(item => ({ ...item, visibleMembers: item.members.filter(lead => canonicalPartnerName(lead.partnerName) === canonicalPartnerName(partnerName)) })).filter(item => item.visibleMembers.length > 0)
  : [...cases]
const visibleBasis = (item: ScopedCase) => item.selection.basis && item.visibleMembers.some(lead => lead.id === item.selection.basis?.id) ? item.selection.basis : undefined
const financialBasis = (item: ScopedCase) => visibleBasis(item) ? financialCaseLeadFor(item.selection, item.members) : undefined
/** Once chosen, the original basis owns the case's operational categories too.
 * A company-scoped view must not re-elect an excluded or foreign member. */
const operationalLead = (item: ScopedCase): Lead | undefined => {
  if (item.selection.status !== 'unresolved') return visibleBasis(item)
  // Preserve the existing queue until the user resolves a conflicting group.
  return (['구매완료', '관리중', '상담 마감', '취소'] as const)
    .map(status => item.visibleMembers.find(lead => lead.status === status)).find(Boolean)
}
const statusFor = (item: ScopedCase) => operationalLead(item)?.status

const summarizeCases = (cases: readonly ScopedCase[]): ExecutivePeriodSummary => {
  const result: ExecutivePeriodSummary = { cases: cases.length, customerCount: cases.length, completed: 0, active: 0, closed: 0, canceled: 0,
    completedCustomers: 0, sales: 0, reservedSales: 0, expectedCommission: 0, missingAmounts: 0, basisRequiredCount: 0, conversionRate: 0, managementRecords: 0 }
  for (const item of cases) {
    const status = statusFor(item)
    if (status === '구매완료') { result.completed++; result.completedCustomers++ }
    else if (status === '관리중') result.active++
    else if (status === '상담 마감') result.closed++
    else if (status === '취소') result.canceled++
    result.managementRecords += item.visibleMembers.reduce((sum, lead) => sum + memoCount(lead), 0)
    if (item.selection.status === 'unresolved') { result.basisRequiredCount++; continue }
    const basis = financialBasis(item)
    if (!basis) continue
    result.sales += completedSalesFor(basis)
    result.reservedSales += financialPendingAmountFor(basis)
    result.expectedCommission += expectedRebateFor(basis)
    if (basis.status === '구매완료' && totalPurchaseAmountFor(basis) === 0) result.missingAmounts++
  }
  result.conversionRate = result.cases ? result.completed / result.cases * 100 : 0
  return result
}
/** Group resolution always precedes date, company or manager filtering. */
export const getExecutiveMonths = (leads: readonly Lead[]): string[] => [...new Set(groupCases(leads).map(item => dateOnly(item.registeredAt)).filter(Boolean).map(date => date.slice(0, 7)))].sort().reverse()
export const getDefaultExecutiveMonth = (leads: readonly Lead[], today: string): string => getExecutiveMonths(leads)[0] || dateOnly(today).slice(0, 7)
/** Source members remain available to the editor; never use this subset to elect a new basis. */
export const getExecutiveMonthLeads = (leads: readonly Lead[], month: string, partnerName?: string): Lead[] => casesForMonth(casesForPartner(groupCases(leads), partnerName), month).flatMap(item => item.visibleMembers)
/** Operational drilldown uses one original document per customer, not one per RAW row. */
export const getExecutiveMonthCaseLeads = (leads: readonly Lead[], month: string, partnerName?: string): Lead[] => casesForMonth(casesForPartner(groupCases(leads), partnerName), month)
  .flatMap(item => { const lead = operationalLead(item); return lead ? [lead] : [] })
const previousMonthFor = (month: string) => { const [year, number] = month.split('-').map(Number); return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7) }
const latestManagementDate = (lead: Lead) => {
  const managementMemos = managementMemoEntriesFor(lead)
  const memoDates = managementMemos.map(memo => dateOnly(memo.date)).filter(Boolean).sort()
  return memoDates.at(-1) || (managementMemos.length && lead.note?.trim() ? dateOnly(lead.updatedAt) : '') || dateOnly(lead.registeredAt)
}
export const buildExecutiveMetrics = (leads: readonly Lead[], month: string, today: string, partnerName?: string): ExecutiveMetrics => {
  if (!validMonth(month)) throw new RangeError('접수월은 YYYY-MM 형식이어야 합니다.')
  const todayDate = dateOnly(today)
  if (!todayDate) throw new RangeError('기준일은 유효한 YYYY-MM-DD 날짜여야 합니다.')
  const cases = casesForPartner(groupCases(leads), partnerName)
  const monthCases = casesForMonth(cases, month)
  const previousMonth = previousMonthFor(month)
  // One task entry per linked customer; retain the selected original record for editing.
  const managingLeads = monthCases.flatMap(item => { const lead = operationalLead(item); return lead?.status === '관리중' ? [lead] : [] })
  const todayTime = new Date(`${todayDate}T00:00:00Z`).getTime()
  const overdue = managingLeads.filter(lead => { const date = dateOnly(lead.visitScheduledDate); return date && date < todayDate && lead.visitState !== '방문' && lead.visitState !== '일정취소' })
    .sort((a, b) => (a.visitScheduledDate || '').localeCompare(b.visitScheduledDate || ''))
  const stale = managingLeads.filter(lead => { const date = latestManagementDate(lead); return date && todayTime - new Date(`${date}T00:00:00Z`).getTime() >= 7 * dayInMilliseconds })
    .sort((a, b) => latestManagementDate(a).localeCompare(latestManagementDate(b)))
  const partners = new Map<string, ScopedCase[]>()
  const managers = new Map<string, ScopedCase[]>()
  for (const item of monthCases) {
    for (const name of new Set(item.visibleMembers.map(lead => canonicalPartnerName(lead.partnerName)))) {
      const scoped = { ...item, visibleMembers: item.visibleMembers.filter(lead => canonicalPartnerName(lead.partnerName) === name) }
      const bucket = partners.get(name); if (bucket) bucket.push(scoped); else partners.set(name, [scoped])
    }
    const assignedMembers = item.selection.status === 'unresolved' ? item.visibleMembers : [visibleBasis(item)].filter((lead): lead is Lead => Boolean(lead))
    for (const name of new Set(assignedMembers.map(lead => lead.manager?.trim() || '미배정'))) {
      const scoped = item.selection.status === 'unresolved'
        ? { ...item, visibleMembers: item.visibleMembers.filter(lead => (lead.manager?.trim() || '미배정') === name) }
        : item
      const bucket = managers.get(name); if (bucket) bucket.push(scoped); else managers.set(name, [scoped])
    }
  }
  return {
    month, previousMonth, current: summarizeCases(monthCases), previous: summarizeCases(casesForMonth(cases, previousMonth)),
    actions: { unassigned: managingLeads.filter(lead => !lead.manager?.trim()), overdue, stale },
    // A cross-company case may appear in both count rows, but money belongs only to its one basis company.
    partners: [...partners].map(([name, groups]) => ({ name: name.trim() || '업체 미입력', ...summarizeCases(groups) }))
      .sort((a, b) => executiveTotalSalesFor(b) - executiveTotalSalesFor(a) || b.completed - a.completed || b.cases - a.cases || a.name.localeCompare(b.name, 'ko')),
    managers: [...managers].map(([name, groups]) => ({ name, assigned: groups.length, ...summarizeCases(groups) }))
      .sort((a, b) => executiveTotalSalesFor(b) - executiveTotalSalesFor(a) || b.completed - a.completed || b.assigned - a.assigned || a.name.localeCompare(b.name, 'ko')),
  }
}
