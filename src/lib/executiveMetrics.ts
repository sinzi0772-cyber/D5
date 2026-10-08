import type { Lead } from '../types'
import { completedSalesFor, expectedRebateFor, salesRawAmountsFor, subscriptionRawAmountsFor } from './salesFinance'

export interface ExecutivePeriodSummary {
  /** Intake cases, with linked bride/groom customers counted once. */
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
  conversionRate: number
  managementRecords: number
}

export interface ExecutivePartnerSummary extends ExecutivePeriodSummary {
  name: string
}

/** Display aggregate only: preserve confirmed/completed and pending bases separately. */
export const executiveTotalSalesFor = (row: Pick<ExecutivePeriodSummary, 'sales' | 'reservedSales'>): number => row.sales + row.reservedSales

/** Rank positive expected commissions without changing the underlying company summaries. */
export const getTopCommissionPartners = (rows: readonly ExecutivePartnerSummary[]): ExecutivePartnerSummary[] => rows
  .filter(row => row.expectedCommission > 0)
  .sort((a, b) => b.expectedCommission - a.expectedCommission || executiveTotalSalesFor(b) - executiveTotalSalesFor(a) || a.name.localeCompare(b.name, 'ko'))
  .slice(0, 3)

export interface ExecutiveManagerSummary extends ExecutivePeriodSummary {
  name: string
  assigned: number
}

export interface ExecutiveMetrics {
  month: string
  previousMonth: string
  current: ExecutivePeriodSummary
  previous: ExecutivePeriodSummary
  /** Managing customers in the selected intake month and partner scope. */
  actions: {
    unassigned: Lead[]
    overdue: Lead[]
    stale: Lead[]
  }
  partners: ExecutivePartnerSummary[]
  managers: ExecutiveManagerSummary[]
}

interface ReferralCase {
  id: string
  intakeDate: string
  leads: Lead[]
}

const dayInMilliseconds = 86_400_000

const dateOnly = (value?: string): string => {
  const date = value?.slice(0, 10) || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : ''
}

const validMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
const memoCount = (lead: Lead) => lead.memoHistory?.length || (lead.note?.trim() ? 1 : 0)

const groupCases = (leads: readonly Lead[]): ReferralCase[] => {
  const groups = new Map<string, Lead[]>()
  for (const lead of leads) {
    const id = lead.caseGroupId ? `case:${lead.caseGroupId}` : `lead:${lead.id}`
    const members = groups.get(id)
    if (members) members.push(lead)
    else groups.set(id, [lead])
  }
  return [...groups].map(([id, members]) => {
    const sorted = [...members].sort((a, b) => {
      const aDate = dateOnly(a.registeredAt) || '9999-99-99'
      const bDate = dateOnly(b.registeredAt) || '9999-99-99'
      return aDate.localeCompare(bDate) || a.id.localeCompare(b.id)
    })
    return { id, intakeDate: dateOnly(sorted[0]?.registeredAt), leads: sorted }
  })
}

const casesForMonth = (cases: readonly ReferralCase[], month: string) => cases.filter(item => item.intakeDate.startsWith(`${month}-`))

const casesForPartner = (cases: readonly ReferralCase[], partnerName?: string): ReferralCase[] => partnerName
  ? cases.map(item => ({ ...item, leads: item.leads.filter(lead => lead.partnerName === partnerName) })).filter(item => item.leads.length > 0)
  : [...cases]

const summarizeCases = (cases: readonly ReferralCase[]): ExecutivePeriodSummary => {
  const result: ExecutivePeriodSummary = {
    cases: cases.length,
    customerCount: 0,
    completed: 0,
    active: 0,
    closed: 0,
    canceled: 0,
    completedCustomers: 0,
    sales: 0,
    reservedSales: 0,
    expectedCommission: 0,
    missingAmounts: 0,
    conversionRate: 0,
    managementRecords: 0,
  }
  for (const item of cases) {
    // Exclusive case outcomes keep the conversion denominator consistent.
    if (item.leads.some(lead => lead.status === '구매완료')) result.completed++
    else if (item.leads.some(lead => lead.status === '관리중')) result.active++
    else if (item.leads.some(lead => lead.status === '상담 마감')) result.closed++
    else result.canceled++

    for (const lead of item.leads) {
      result.customerCount++
      result.managementRecords += memoCount(lead)
      const raw = salesRawAmountsFor(lead)
      const subscription = subscriptionRawAmountsFor(lead)
      const saleAmount = completedSalesFor(lead)
      result.sales += saleAmount
      if (raw.current) result.reservedSales += raw.pending
      if (subscription.current) result.reservedSales += subscription.pending
      // Imports set customer completion separately; original RAW stages remain
      // unchanged. Business-completed reservations are not counted as pending.
      // Expected commission uses the same eligibility and rounding as customer
      // purchase information; manual customer status is not a RAW order stage.
      result.expectedCommission += expectedRebateFor(lead)
      if (lead.status !== '구매완료') continue
      result.completedCustomers++
      if (saleAmount === 0) result.missingAmounts++
    }
  }
  result.conversionRate = result.cases ? result.completed / result.cases * 100 : 0
  return result
}

/** Months are based on the earliest valid registration across the complete linked case. */
export const getExecutiveMonths = (leads: readonly Lead[]): string[] => [...new Set(groupCases(leads)
  .filter(item => item.intakeDate)
  .map(item => item.intakeDate.slice(0, 7)))].sort().reverse()

export const getDefaultExecutiveMonth = (leads: readonly Lead[], today: string): string => getExecutiveMonths(leads)[0] || dateOnly(today).slice(0, 7)

/** Includes every member of cases whose earliest registration is in this intake month. */
export const getExecutiveMonthLeads = (leads: readonly Lead[], month: string, partnerName?: string): Lead[] => casesForMonth(casesForPartner(groupCases(leads), partnerName), month).flatMap(item => item.leads)

const previousMonthFor = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 7)
}

const latestManagementDate = (lead: Lead) => {
  const memoDates = (lead.memoHistory || []).map(memo => dateOnly(memo.date)).filter(Boolean).sort()
  if (memoDates.length) return memoDates.at(-1)!
  if (lead.note?.trim()) return dateOnly(lead.updatedAt) || dateOnly(lead.registeredAt)
  return dateOnly(lead.registeredAt)
}

export const buildExecutiveMetrics = (leads: readonly Lead[], month: string, today: string, partnerName?: string): ExecutiveMetrics => {
  if (!validMonth(month)) throw new RangeError('접수월은 YYYY-MM 형식이어야 합니다.')
  const todayDate = dateOnly(today)
  if (!todayDate) throw new RangeError('기준일은 유효한 YYYY-MM-DD 날짜여야 합니다.')

  // Determine the intake date before applying partner scope. A linked case must
  // not move to a later month when a partner only owns its later member.
  const cases = casesForPartner(groupCases(leads), partnerName)
  const monthCases = casesForMonth(cases, month)
  const previousMonth = previousMonthFor(month)
  const managingLeads = monthCases.flatMap(item => item.leads).filter(lead => lead.status === '관리중')
  const todayTime = new Date(`${todayDate}T00:00:00Z`).getTime()
  const overdue = managingLeads.filter(lead => {
    const visitDate = dateOnly(lead.visitScheduledDate)
    return visitDate && visitDate < todayDate && lead.visitState !== '방문' && lead.visitState !== '일정취소'
  }).sort((a, b) => (a.visitScheduledDate || '').localeCompare(b.visitScheduledDate || ''))
  const stale = managingLeads.filter(lead => {
    const lastDate = latestManagementDate(lead)
    if (!lastDate) return false
    return todayTime - new Date(`${lastDate}T00:00:00Z`).getTime() >= 7 * dayInMilliseconds
  }).sort((a, b) => latestManagementDate(a).localeCompare(latestManagementDate(b)))

  const partners = new Map<string, ReferralCase[]>()
  for (const item of monthCases) {
    // Each company owns only its customers' financial amounts. A cross-company
    // linked case appears in every involved company row, so case counts must
    // not be summed; financial totals still reconcile with the overall total.
    for (const name of new Set(item.leads.map(lead => lead.partnerName))) {
      const scopedCase = { ...item, leads: item.leads.filter(lead => lead.partnerName === name) }
      const groups = partners.get(name)
      if (groups) groups.push(scopedCase)
      else partners.set(name, [scopedCase])
    }
  }

  const managers = new Map<string, Lead[]>()
  for (const item of monthCases) {
    for (const lead of item.leads) {
      const name = lead.manager?.trim() || '미배정'
      const members = managers.get(name)
      if (members) members.push(lead)
      else managers.set(name, [lead])
    }
  }

  return {
    month,
    previousMonth,
    current: summarizeCases(monthCases),
    previous: summarizeCases(casesForMonth(cases, previousMonth)),
    actions: {
      unassigned: managingLeads.filter(lead => !lead.manager?.trim()),
      overdue,
      stale,
    },
    partners: [...partners].map(([name, groups]) => ({ name: name.trim() || '업체 미입력', ...summarizeCases(groups) }))
      .sort((a, b) => executiveTotalSalesFor(b) - executiveTotalSalesFor(a) || b.completed - a.completed || b.cases - a.cases || a.name.localeCompare(b.name, 'ko')),
    // Connected cases can be shared by managers; these rows should not be summed.
    managers: [...managers].map(([name, members]) => ({ name, assigned: members.length, ...summarizeCases(groupCases(members)) }))
      .sort((a, b) => executiveTotalSalesFor(b) - executiveTotalSalesFor(a) || b.completed - a.completed || b.assigned - a.assigned || a.name.localeCompare(b.name, 'ko')),
  }
}
