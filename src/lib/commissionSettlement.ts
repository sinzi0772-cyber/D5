import type { Lead } from '../types'
import { expectedRebateFor } from './salesFinance'
import { caseBasisGroupsFor, financialCaseLeadFor } from './caseBasis'
import { canonicalPartnerName } from './partners'
import { deliveryScheduleFor, isValidDeliverySchedule, type DeliveryScheduleLead } from './deliverySchedule'

export { isValidDeliveryDate } from './deliverySchedule'

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
  /** Calculation projections only; editor callbacks must resolve original saved rows by ID. */
  leads: Lead[]
}

export interface CommissionSettlementMetrics {
  months: CommissionSettlementMonth[]
  basisRequiredCount: number
  basisRequiredLeads: Lead[]
  completedCustomerCount: number
  completedExpectedCommission: number
  scheduledCustomerCount: number
  scheduledExpectedCommission: number
  unscheduledCustomerCount: number
  unscheduledExpectedCommission: number
  /** Calculation projections only. Original RAW must never be persisted from this list. */
  unscheduledLeads: Lead[]
  unfinishedCustomerCount: number
  unfinishedExpectedCommission: number
}

const settlementDelayMonths = 2

function offsetMonth(value: string, months: number): string {
  const monthIndex = monthIndexFor(value) + months
  return String(Math.floor(monthIndex / 12)).padStart(4, '0') + '-' + String(monthIndex % 12 + 1).padStart(2, '0')
}

/** Planned delivery month + 2, not proof of receipt or a fixed settlement day. */
export function expectedSettlementMonthFor(lead: Partial<DeliveryScheduleLead>): string | null {
  const schedule = deliveryScheduleFor(lead)
  return schedule ? offsetMonth(schedule, settlementDelayMonths) : null
}

export function scheduledDeliveryMonthForSettlement(month: string): string {
  return offsetMonth(month, -settlementDelayMonths)
}

export function deliveryDateValidationMessage(lead: Pick<Lead, 'status'> & Partial<DeliveryScheduleLead>): string | null {
  const date = lead.deliveryScheduledDate
  if (date === undefined || date === null || date === '') {
    return lead.status === '구매완료' && !deliveryScheduleFor(lead) ? '구매완료 고객은 배송 예정일을 입력해주세요.' : null
  }
  return isValidDeliverySchedule(date) ? null : '배송 예정일을 YYYY-MM-DD 또는 YYYY-MM 형식으로 입력해주세요.'
}

export function caseSaveDeliveryError(original: Lead, draft: Lead, linking: boolean, creating: boolean): string | null {
  // A membership-only change can keep a legacy record's existing delivery data.
  if (linking && !creating && original.status === draft.status
    && !original.deliveryScheduledDate && !draft.deliveryScheduledDate) return null
  return deliveryDateValidationMessage(draft)
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
    basisRequiredCount: 0,
    basisRequiredLeads: [],
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
  const monthlyLeads = new Map<string, Lead[]>()
  // Resolve complete cases first. A company filter never elects another member.
  for (const group of caseBasisGroupsFor(leads)) {
    const visible = partnerName === undefined ? group.members : group.members.filter(member => canonicalPartnerName(member.partnerName) === canonicalPartnerName(partnerName))
    if (!visible.length) continue
    if (group.selection.status === 'unresolved') {
      result.basisRequiredCount++
      result.basisRequiredLeads.push(visible[0])
      continue
    }
    const lead = financialCaseLeadFor(group.selection, group.members)
    if (!lead || !visible.some(member => member.id === lead.id)) continue
    const fee = expectedRebateFor(lead)
    if (lead.status !== '구매완료') {
      result.unfinishedCustomerCount++
      result.unfinishedExpectedCommission += fee
      continue
    }
    result.completedCustomerCount++
    result.completedExpectedCommission += fee
    const month = expectedSettlementMonthFor(group.selection.basis ?? lead)
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
        const partner = canonicalPartnerName(lead.partnerName)
        const partnerMembers = byPartner.get(partner)
        if (partnerMembers) partnerMembers.push(lead)
        else byPartner.set(partner, [lead])
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
