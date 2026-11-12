import type { AppointmentType, CaseSharingHistory, Lead, LeadStatus, MemoEntry, PurchaseType, SalesRawPeriod, SubscriptionRawPeriod, VisitState } from '../types'
import { canonicalPartnerName } from './partners'
import { invitationCampaignFor } from './invitationCampaign'
import { readSalesRouteCorrectionLedger } from './salesRouteCorrections'

const text = (value: unknown): string => typeof value === 'string' ? value : ''
const optionalText = (value: unknown): string | undefined => text(value) || undefined
const amount = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const sourceId = (value: unknown): string | undefined => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !value.includes('/') ? value : undefined
// A malformed explicit current source must not be reclassified as an
// independent purchase. Historical allowlist parsing above remains unchanged.
const leadSourceId = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined
  const id = sourceId(value)
  return id && id.trim() === id ? id : 'invalid/case-source'
}
// Invalid explicit basis metadata must remain detectable, rather than silently
// becoming an automatic basis choice after document parsing.
const caseBasisId = (value: unknown): string | undefined => value === undefined || value === null ? undefined : typeof value === 'string' ? value : 'invalid/case-basis'
// Bad explicit merge metadata must remain pending after reload, not disappear.
const caseMergeIds = (value: unknown): string[] | undefined => value === undefined || value === null ? undefined : Array.isArray(value)
  ? value.map(id => typeof id === 'string' ? id : 'invalid/case-merge') : ['invalid/case-merge']
const optionalPurchaseType = (value: unknown): PurchaseType | undefined => ['미선택', '일시불', '구독', '일시불+구독'].includes(text(value)) ? value as PurchaseType : undefined

/** Preserve only the documented prior manual fields, never arbitrary source data. */
function sharingHistory(value: unknown): CaseSharingHistory[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry): CaseSharingHistory[] => {
    if (!record(entry) || !optionalText(entry.at) || !optionalText(entry.by) || entry.reason !== 'group-share' || !record(entry.previous)) return []
    const previous = entry.previous
    return [{
      at: text(entry.at), by: text(entry.by), reason: 'group-share',
      previous: Object.fromEntries(Object.entries({
        manager: optionalText(previous.manager), managerEmployeeNo: optionalText(previous.managerEmployeeNo),
        purchaseType: optionalPurchaseType(previous.purchaseType), purchaseAmount: amount(previous.purchaseAmount),
        lumpSumAmount: amount(previous.lumpSumAmount), subscriptionAmount: amount(previous.subscriptionAmount),
        lumpSumSourceId: sourceId(previous.lumpSumSourceId), subscriptionSourceId: sourceId(previous.subscriptionSourceId),
        caseBasisLeadId: sourceId(previous.caseBasisLeadId),
        caseMergeMemberIds: caseMergeIds(previous.caseMergeMemberIds),
      }).filter(([, field]) => field !== undefined)),
    }]
  })
}

export function normalizedLeadStatus(value: unknown): LeadStatus {
  if (value === '구매완료' || value === '계약완료') return '구매완료'
  if (value === '상담마감' || value === '상담 마감' || value === '마감') return '상담 마감'
  if (value === '취소' || value === '종결') return '취소'
  return '관리중'
}

/** One staff-document mapper shared by the app and the trusted publication tool. */
export function leadFromDocument(id: string, row: Record<string, unknown>): Lead {
  const purchaseType: PurchaseType = ['일시불', '구독', '일시불+구독'].includes(text(row.purchaseType)) ? row.purchaseType as PurchaseType : '미선택'
  const legacyAmount = amount(row.purchaseAmount)
  const partnerName = canonicalPartnerName(text(row.partnerName))
  const invitationCampaign = invitationCampaignFor(row.invitationCampaign, partnerName)
  return {
    id,
    registeredAt: text(row.registeredAt), customerName: text(row.customerName), phoneLast4: text(row.phoneLast4),
    gender: row.gender === '남' || row.gender === '여' ? row.gender : '미입력',
    visitScheduledDate: optionalText(row.visitScheduledDate), deliveryScheduledDate: optionalText(row.deliveryScheduledDate),
    appointmentType: ['상담예약(이업종)', '이업종제휴'].includes(text(row.appointmentType)) ? row.appointmentType as AppointmentType : '미선택',
    appointmentSourceId: optionalText(row.appointmentSourceId), partnerName,
    ...(invitationCampaign ? { invitationCampaign } : {}),
    billToCode: optionalText(row.billToCode), lgeSubchannel: optionalText(row.lgeSubchannel),
    manager: optionalText(row.manager), managerEmployeeNo: optionalText(row.managerEmployeeNo),
    plannerName: optionalText(row.plannerName), caseGroupId: optionalText(row.caseGroupId), caseBasisLeadId: caseBasisId(row.caseBasisLeadId), caseMergeMemberIds: caseMergeIds(row.caseMergeMemberIds), status: normalizedLeadStatus(row.status),
    visitState: ['미정', '예정', '방문', '미방문', '일정취소'].includes(text(row.visitState)) ? row.visitState as VisitState : '미정',
    purchaseType, purchaseAmount: legacyAmount,
    lumpSumAmount: amount(row.lumpSumAmount) ?? (purchaseType === '일시불' ? legacyAmount : undefined),
    subscriptionAmount: amount(row.subscriptionAmount) ?? (purchaseType === '구독' ? legacyAmount : undefined),
    lumpSumSourceId: leadSourceId(row.lumpSumSourceId), subscriptionSourceId: leadSourceId(row.subscriptionSourceId),
    caseSharingHistory: sharingHistory(row.caseSharingHistory),
    salesRawPeriods: record(row.salesRawPeriods) ? row.salesRawPeriods as Record<string, SalesRawPeriod> : undefined,
    subscriptionRawPeriods: record(row.subscriptionRawPeriods) ? row.subscriptionRawPeriods as Record<string, SubscriptionRawPeriod> : undefined,
    ...(row.salesRouteCorrections === undefined ? {} : { salesRouteCorrections: readSalesRouteCorrectionLedger(row.salesRouteCorrections)?.corrections }),
    note: optionalText(row.note), memoHistory: Array.isArray(row.memoHistory) ? row.memoHistory as MemoEntry[] : [],
    updatedAt: text(row.updatedAt),
  }
}
