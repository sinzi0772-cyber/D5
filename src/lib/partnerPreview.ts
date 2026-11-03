import type { Lead, LeadStatus } from '../types'
import { expectedSettlementMonthFor, isValidDeliveryDate } from './commissionSettlement'
import { customerDisplayLabel } from './customerDisplay'
import { canonicalPartnerName } from './partners'
import { expectedRebateFor } from './salesFinance'
import { caseBasisGroupsFor, financialCaseLeadFor } from './caseBasis'
import { isApprovedSubscriptionReviewPartner } from './salesChannelReview'
import { SUBSCRIPTION_REVIEW_PARTNERS } from './subscriptionPartners'
import { getStoredSalesChannels } from './salesChannels'

/** Only actual route labels are exposed; order identities and amounts stay private. */
export interface PartnerSalesChannel {
  kind: 'lumpSum' | 'subscription'
  period: string | null
  status: 'eligible' | 'mismatch' | 'unverified'
  channel1: string
  channel2: string
}

/** Internal preview is not an authorization boundary. */
export function canPreviewPartner(role: unknown): boolean { return typeof role === 'string' && ['admin', 'store_manager', 'assistant_manager', 'manager'].includes(role) }
/** Explicit safe projection: no source IDs, RAW, sales amounts, managers or foreign-company fields. */
export interface PartnerPreviewCustomer {
  key: string
  label: string
  registeredAt: string | null
  status: LeadStatus
  deliveryScheduledDate: string | null
  expectedCommission: number | null
  expectedSettlementMonth: string | null
  /** Optional for existing published schema-1 documents. New publications always include these. */
  basisRequired?: boolean
  basisReason?: '기준 고객 확인 필요' | null
  salesChannels?: PartnerSalesChannel[]
}
export interface PartnerPreviewSettlement { month: string; expectedCommission: number; customerCount: number }
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
  basisRequiredCount?: number
  settlements: PartnerPreviewSettlement[]
  customers: PartnerPreviewCustomer[]
}
const validMonth = (month: string) => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month)
const monthIndex = (month: string) => { const [year, number] = month.split('-').map(Number); return year * 12 + number - 1 }
const safeDate = (value?: string) => { const date = typeof value === 'string' ? value.slice(0, 10) : ''; return isValidDeliveryDate(date) ? date : null }
const ownStatusFor = (members: readonly Lead[]): LeadStatus => members.some(lead => lead.status === '구매완료') ? '구매완료' : members.some(lead => lead.status === '관리중') ? '관리중' : members.some(lead => lead.status === '상담 마감') ? '상담 마감' : '취소'

function ownSalesChannels(basis: Lead, members: readonly Lead[], mergeIds: readonly string[] | undefined, partner: string): PartnerSalesChannel[] {
  const selected = mergeIds ? members.filter(member => mergeIds.includes(member.id)) : [basis]
  const routes = new Map<string, PartnerSalesChannel>()
  for (const member of selected) {
    if (canonicalPartnerName(member.partnerName) !== partner) continue
    const kinds = (['lumpSum', 'subscription'] as const).filter(kind => {
      const direct = kind === 'lumpSum' ? member.lumpSumAmount : member.subscriptionAmount
      const raw = kind === 'lumpSum' ? member.salesRawPeriods : member.subscriptionRawPeriods
      return direct !== undefined || Object.keys(raw || {}).length > 0 || member.purchaseType === (kind === 'lumpSum' ? '일시불' : '구독') && member.purchaseAmount !== undefined
    })
    const ownKinds = kinds.filter(kind => !member[kind === 'lumpSum' ? 'lumpSumSourceId' : 'subscriptionSourceId'] || member[kind === 'lumpSum' ? 'lumpSumSourceId' : 'subscriptionSourceId'] === member.id)
    for (const kind of kinds) {
      if (kind === 'subscription' && !isApprovedSubscriptionReviewPartner(partner, SUBSCRIPTION_REVIEW_PARTNERS)) continue
      const sourceKey = kind === 'lumpSum' ? 'lumpSumSourceId' : 'subscriptionSourceId'
      const sourceId = member[sourceKey]
      if (!mergeIds && ownKinds.length && sourceId && sourceId !== member.id) continue
      const owner = !sourceId || sourceId === member.id ? member : members.find(candidate => candidate.id === sourceId)
      if (!owner || canonicalPartnerName(owner.partnerName) !== partner || owner[sourceKey] && owner[sourceKey] !== owner.id) continue
      for (const row of getStoredSalesChannels(owner).filter(row => row.kind === kind)) {
        const route: PartnerSalesChannel = { kind: row.kind, period: row.period, status: row.status, channel1: row.channel1, channel2: row.channel2 }
        routes.set(JSON.stringify(route), route)
      }
    }
  }
  return [...routes.values()]
}

/** No other company's registration date can create a tenant month option. */
export function getPartnerPreviewMonths(leads: readonly Lead[], partnerName: string): string[] {
  const partner = canonicalPartnerName(partnerName)
  if (!partner) return []
  return [...new Set(caseBasisGroupsFor(leads).flatMap(group => {
    const dates = group.members.filter(lead => canonicalPartnerName(lead.partnerName) === partner).map(lead => safeDate(lead.registeredAt)).filter((date): date is string => date !== null).sort()
    return dates[0] ? [dates[0].slice(0, 7)] : []
  }))].sort().reverse()
}

/**
 * Resolve the complete case before any tenant/month filtering. Each case is one
 * customer; the whole chosen row supplies money/status/delivery, never A + B.
 * A tenant cohort uses only that tenant's own intake dates. A foreign basis is
 * redacted rather than substituted with another financial row.
 */
export function buildPartnerPreview(leads: readonly Lead[], partnerName: string, month: string): PartnerPreviewModel {
  const partner = canonicalPartnerName(partnerName)
  const result: PartnerPreviewModel = { partnerName: partner, intakeMonth: month, receiptCount: 0, customerCount: 0, completedCount: 0, activeCount: 0,
    completedExpectedCommission: 0, undatedExpectedCommission: 0, undatedCustomerCount: 0, basisRequiredCount: 0, settlements: [], customers: [] }
  if (!partner || !validMonth(month)) return result
  const selected = caseBasisGroupsFor(leads).flatMap(group => {
    const own = group.members.filter(lead => canonicalPartnerName(lead.partnerName) === partner)
    if (!own.length) return []
    const ownDates = own.map(lead => safeDate(lead.registeredAt)).filter((date): date is string => date !== null).sort()
    if (!ownDates[0]?.startsWith(`${month}-`)) return []
    const basis = group.selection.basis
    const ownBasis = basis && canonicalPartnerName(basis.partnerName) === partner ? basis : undefined
    const financial = ownBasis ? financialCaseLeadFor(group.selection, group.members) : undefined
    const required = group.selection.status === 'unresolved' || !ownBasis
    const identity = ownBasis || [...own].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.id.localeCompare(b.id))[0]
    const salesChannels = !required && ownBasis ? ownSalesChannels(ownBasis, group.members, group.selection.mergeMemberIds, partner) : undefined
    return [{ identity, financial, required, salesChannels, status: ownBasis?.status || ownStatusFor(own), ownDate: ownDates[0] }]
  }).sort((a, b) => b.ownDate.localeCompare(a.ownDate) || a.identity.id.localeCompare(b.identity.id))
  const settlements = new Map<string, PartnerPreviewSettlement>()
  for (const [index, item] of selected.entries()) {
    const { identity, financial, required, salesChannels, status, ownDate } = item
    const completed = status === '구매완료'
    const fee = !required && financial && financial.status === '구매완료' ? expectedRebateFor(financial) : null
    const date = required ? null : isValidDeliveryDate((financial || identity).deliveryScheduledDate) ? (financial || identity).deliveryScheduledDate! : null
    const expectedMonth = fee !== null ? expectedSettlementMonthFor({ deliveryScheduledDate: date || undefined }) : null
    result.customers.push({ key: `customer-${index + 1}`, label: customerDisplayLabel(identity), registeredAt: ownDate, status,
      deliveryScheduledDate: date, expectedCommission: fee, expectedSettlementMonth: expectedMonth,
      basisRequired: required, basisReason: required ? '기준 고객 확인 필요' : null,
      ...(salesChannels?.length ? { salesChannels } : {}) })
    if (required) result.basisRequiredCount!++
    // Required/redacted rows retain their own visible status, but no selected
    // tenant basis exists to classify this logical customer. In particular, a
    // secondary member must not create another company's status-category count.
    if (!required && completed) result.completedCount++
    else if (!required && status === '관리중') result.activeCount++
    if (fee === null) continue
    result.completedExpectedCommission += fee
    if (!expectedMonth) { result.undatedExpectedCommission += fee; result.undatedCustomerCount++; continue }
    const bucket = settlements.get(expectedMonth)
    if (bucket) { bucket.expectedCommission += fee; bucket.customerCount++ }
    else settlements.set(expectedMonth, { month: expectedMonth, expectedCommission: fee, customerCount: 1 })
  }
  result.receiptCount = result.customerCount = selected.length
  result.settlements = [...settlements.values()].sort((a, b) => monthIndex(a.month) - monthIndex(b.month))
  return result
}
