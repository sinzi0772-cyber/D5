import type { Lead } from '../types'
import { expectedRebateFor } from './salesFinance'

export interface CommissionSettlementPartner {
  name: string
  expectedCommission: number
  customerCount: number
  /** Cross-company connected cases may appear once in each involved company. */
  caseCount: number
}

export interface CommissionSettlementMonth {
  month: string
  expectedCommission: number
  customerCount: number
  caseCount: number
  partners: CommissionSettlementPartner[]
  leads: Lead[]
}

export interface CommissionSettlementMetrics {
  months: CommissionSettlementMonth[]
  completedCustomerCount: number
  completedExpectedCommission: number
  scheduledCustomerCount: number
  scheduledExpectedCommission: number
  unscheduledCustomerCount: number
  unscheduledExpectedCommission: number
  unscheduledLeads: Lead[]
  unfinishedCustomerCount: number
  unfinishedExpectedCommission: number
}

/** Strict Gregorian calendar dates; input years are 0001 through 9999. */
export function isValidDeliveryDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]
}

/** Planned delivery month + 2, not proof of receipt or a fixed settlement day. */
export function expectedSettlementMonthFor(lead: Pick<Lead, 'deliveryScheduledDate'>): string | null {
  if (!isValidDeliveryDate(lead.deliveryScheduledDate)) return null
  const [year, month] = lead.deliveryScheduledDate.split('-').map(Number)
  const monthIndex = year * 12 + month - 1 + 2
  return String(Math.floor(monthIndex / 12)).padStart(4, '0') + '-' + String(monthIndex % 12 + 1).padStart(2, '0')
}

export function deliveryDateValidationMessage(lead: Pick<Lead, 'status' | 'deliveryScheduledDate'>): string | null {
  const date = lead.deliveryScheduledDate
  if (date === undefined || date === null || date === '') {
    return lead.status === '구매완료' ? '구매완료 고객은 배송 예정일을 입력해주세요.' : null
  }
  return isValidDeliveryDate(date) ? null : '배송 예정일을 YYYY-MM-DD 형식의 올바른 날짜로 입력해주세요.'
}

const caseCountFor = (leads: readonly Lead[]) => new Set(leads.map(lead => lead.caseGroupId ? 'case:' + lead.caseGroupId : 'lead:' + lead.id)).size
const feeFor = (leads: readonly Lead[]) => leads.reduce((sum, lead) => sum + expectedRebateFor(lead), 0)
const monthIndexFor = (month: string) => {
  const [year, number] = month.split('-').map(Number)
  return year * 12 + number - 1
}

/** Classify saved customers only; no registration-month filter or guessed delivery dates. */
export function buildCommissionSettlementMetrics(leads: readonly Lead[], partnerName?: string): CommissionSettlementMetrics {
  const result: CommissionSettlementMetrics = {
    months: [],
    completedCustomerCount: 0,
    completedExpectedCommission: 0,
    scheduledCustomerCount: 0,
    scheduledExpectedCommission: 0,
    unscheduledCustomerCount: 0,
    unscheduledExpectedCommission: 0,
    unscheduledLeads: [],
    unfinishedCustomerCount: 0,
    unfinishedExpectedCommission: 0,
  }
  const seen = new Set<string>()
  const monthlyLeads = new Map<string, Lead[]>()
  for (const lead of leads) {
    // A Firestore document is counted once; different linked customer IDs remain separate.
    if (seen.has(lead.id)) continue
    seen.add(lead.id)
    if (partnerName !== undefined && lead.partnerName !== partnerName) continue
    const fee = expectedRebateFor(lead)
    if (lead.status !== '구매완료') {
      result.unfinishedCustomerCount++
      result.unfinishedExpectedCommission += fee
      continue
    }
    result.completedCustomerCount++
    result.completedExpectedCommission += fee
    const month = expectedSettlementMonthFor(lead)
    if (!month) {
      result.unscheduledCustomerCount++
      result.unscheduledExpectedCommission += fee
      result.unscheduledLeads.push(lead)
      continue
    }
    result.scheduledCustomerCount++
    result.scheduledExpectedCommission += fee
    const members = monthlyLeads.get(month)
    if (members) members.push(lead)
    else monthlyLeads.set(month, [lead])
  }
  result.months = [...monthlyLeads]
    .sort(([a], [b]) => monthIndexFor(a) - monthIndexFor(b))
    .map(([month, members]) => {
      const byPartner = new Map<string, Lead[]>()
      for (const lead of members) {
        const partnerMembers = byPartner.get(lead.partnerName)
        if (partnerMembers) partnerMembers.push(lead)
        else byPartner.set(lead.partnerName, [lead])
      }
      return {
        month,
        expectedCommission: feeFor(members),
        customerCount: members.length,
        caseCount: caseCountFor(members),
        partners: [...byPartner].map(([name, partnerMembers]) => ({
          name: name.trim() || '업체 미입력',
          expectedCommission: feeFor(partnerMembers),
          customerCount: partnerMembers.length,
          caseCount: caseCountFor(partnerMembers),
        })).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
        leads: members,
      }
    })
  return result
}
