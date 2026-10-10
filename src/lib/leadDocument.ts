import type { AppointmentType, Lead, LeadStatus, MemoEntry, PurchaseType, SalesRawPeriod, SubscriptionRawPeriod, VisitState } from '../types'
import { canonicalPartnerName } from './partners'

const text = (value: unknown): string => typeof value === 'string' ? value : ''
const optionalText = (value: unknown): string | undefined => text(value) || undefined
const amount = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

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
  return {
    id,
    registeredAt: text(row.registeredAt), customerName: text(row.customerName), phoneLast4: text(row.phoneLast4),
    gender: row.gender === '남' || row.gender === '여' ? row.gender : '미입력',
    visitScheduledDate: optionalText(row.visitScheduledDate), deliveryScheduledDate: optionalText(row.deliveryScheduledDate),
    appointmentType: ['상담예약(이업종)', '이업종제휴'].includes(text(row.appointmentType)) ? row.appointmentType as AppointmentType : '미선택',
    appointmentSourceId: optionalText(row.appointmentSourceId), partnerName: canonicalPartnerName(text(row.partnerName)),
    billToCode: optionalText(row.billToCode), lgeSubchannel: optionalText(row.lgeSubchannel),
    manager: optionalText(row.manager), managerEmployeeNo: optionalText(row.managerEmployeeNo),
    plannerName: optionalText(row.plannerName), caseGroupId: optionalText(row.caseGroupId), status: normalizedLeadStatus(row.status),
    visitState: ['미정', '예정', '방문', '미방문', '일정취소'].includes(text(row.visitState)) ? row.visitState as VisitState : '미정',
    purchaseType, purchaseAmount: legacyAmount,
    lumpSumAmount: amount(row.lumpSumAmount) ?? (purchaseType === '일시불' ? legacyAmount : undefined),
    subscriptionAmount: amount(row.subscriptionAmount) ?? (purchaseType === '구독' ? legacyAmount : undefined),
    salesRawPeriods: record(row.salesRawPeriods) ? row.salesRawPeriods as Record<string, SalesRawPeriod> : undefined,
    subscriptionRawPeriods: record(row.subscriptionRawPeriods) ? row.subscriptionRawPeriods as Record<string, SubscriptionRawPeriod> : undefined,
    note: optionalText(row.note), memoHistory: Array.isArray(row.memoHistory) ? row.memoHistory as MemoEntry[] : [],
    updatedAt: text(row.updatedAt),
  }
}
