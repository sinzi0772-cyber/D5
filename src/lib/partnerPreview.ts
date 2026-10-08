import type { Lead, LeadStatus } from '../types'
import { expectedSettlementMonthFor, isValidDeliveryDate } from './commissionSettlement'
import { customerDisplayLabel } from './customerDisplay'
import { getExecutiveMonthLeads } from './executiveMetrics'
import { canonicalPartnerName } from './partners'
import { expectedRebateFor } from './salesFinance'

/** This internal preview is not a partner login or an authorization boundary. */
export function canPreviewPartner(role: unknown): boolean {
  return typeof role === 'string' && ['admin', 'store_manager', 'assistant_manager', 'manager'].includes(role)
}

/** Explicit projection: never spread saved customer documents into partner UI. */
export interface PartnerPreviewCustomer {
  key: string
  label: string
  registeredAt: string | null
  status: LeadStatus
  deliveryScheduledDate: string | null
  expectedCommission: number | null
  expectedSettlementMonth: string | null
}

export interface PartnerPreviewSettlement {
  month: string
  expectedCommission: number
  customerCount: number
}

export interface PartnerPreviewModel {
  partnerName: string
  intakeMonth: string
  receiptCount: number
  customerCount: number
  completedCount: number
  activeCount: number
  completedExpectedCommission: number
  undatedExpectedCommission: number
  undatedCustomerCount: number
  settlements: PartnerPreviewSettlement[]
  customers: PartnerPreviewCustomer[]
}

const validMonth = (month: string) => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month)
const monthIndex = (month: string) => { const [year, number] = month.split('-').map(Number); return year * 12 + number - 1 }
const caseKey = (lead: Lead) => lead.caseGroupId ? `case:${lead.caseGroupId}` : `lead:${lead.id}`
const safeDate = (value?: string) => {
  const date = typeof value === 'string' ? value.slice(0, 10) : ''
  return isValidDeliveryDate(date) ? date : null
}

/**
 * Staff-only display preview. Real partner access requires a separate trusted,
 * company-scoped data source; this function does not grant Firestore access.
 * Empty company/month input must never fall back to all customer documents.
 */
export function buildPartnerPreview(leads: readonly Lead[], partnerName: string, month: string): PartnerPreviewModel {
  const partner = canonicalPartnerName(partnerName)
  const result: PartnerPreviewModel = {
    partnerName: partner,
    intakeMonth: month,
    receiptCount: 0,
    customerCount: 0,
    completedCount: 0,
    activeCount: 0,
    completedExpectedCommission: 0,
    undatedExpectedCommission: 0,
    undatedCustomerCount: 0,
    settlements: [],
    customers: [],
  }
  if (!partner || !validMonth(month)) return result

  // Keep first saved document once, normalize only explicitly approved aliases,
  // then scope the complete linked case by its original intake month.
  const seen = new Set<string>()
  const uniqueLeads = leads.filter(lead => {
    if (seen.has(lead.id)) return false
    seen.add(lead.id)
    return true
  }).map(lead => {
    const name = canonicalPartnerName(lead.partnerName)
    return name === lead.partnerName ? lead : { ...lead, partnerName: name }
  })
  const customers = getExecutiveMonthLeads(uniqueLeads, month, partner)
    .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt) || a.id.localeCompare(b.id))
  const cases = new Map<string, Lead[]>()
  const settlements = new Map<string, PartnerPreviewSettlement>()
  for (const [index, lead] of customers.entries()) {
    const group = cases.get(caseKey(lead))
    if (group) group.push(lead)
    else cases.set(caseKey(lead), [lead])
    const completed = lead.status === '구매완료'
    const fee = completed ? expectedRebateFor(lead) : null
    const expectedMonth = completed ? expectedSettlementMonthFor(lead) : null
    result.customers.push({
      key: `customer-${index + 1}`,
      label: customerDisplayLabel(lead),
      registeredAt: safeDate(lead.registeredAt),
      status: lead.status,
      deliveryScheduledDate: isValidDeliveryDate(lead.deliveryScheduledDate) ? lead.deliveryScheduledDate : null,
      expectedCommission: fee,
      expectedSettlementMonth: expectedMonth,
    })
    if (fee === null) continue
    result.completedExpectedCommission += fee
    if (!expectedMonth) {
      result.undatedExpectedCommission += fee
      result.undatedCustomerCount++
      continue
    }
    const bucket = settlements.get(expectedMonth)
    if (bucket) {
      bucket.expectedCommission += fee
      bucket.customerCount++
    } else settlements.set(expectedMonth, { month: expectedMonth, expectedCommission: fee, customerCount: 1 })
  }
  result.receiptCount = cases.size
  result.customerCount = customers.length
  for (const members of cases.values()) {
    if (members.some(lead => lead.status === '구매완료')) result.completedCount++
    else if (members.some(lead => lead.status === '관리중')) result.activeCount++
  }
  result.settlements = [...settlements.values()].sort((a, b) => monthIndex(a.month) - monthIndex(b.month))
  return result
}
