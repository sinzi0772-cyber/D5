export type LeadStatus = '관리중' | '구매완료' | '상담 마감' | '취소'
export type VisitState = '미정' | '예정' | '방문' | '미방문' | '일정취소'
export type PurchaseType = '미선택' | '일시불' | '구독' | '일시불+구독'
export type AppointmentType = '미선택' | '상담예약(이업종)' | '이업종제휴'
export type InvitationCampaign = '2026-11-iniwedding'

export interface MemoEntry {
  id: string
  date: string
  manager: string
  content: string
}

/** Prior manual fields are retained when a linked case adopts shared values. */
export interface CaseSharingHistory {
  at: string
  by: string
  reason: 'group-share'
  previous: {
    manager?: string
    managerEmployeeNo?: string
    purchaseType?: PurchaseType
    purchaseAmount?: number
    lumpSumAmount?: number
    subscriptionAmount?: number
    lumpSumSourceId?: string
    subscriptionSourceId?: string
    caseBasisLeadId?: string
    caseMergeMemberIds?: string[]
  }
}

/** Actual source routes grouped without customer details or order identifiers. */
export interface SalesChannelSummary {
  channel1: string
  channel2: string
  orderCount: number
  itemCount?: number
  /** Null means at least one component amount is missing. Never substitute zero. */
  amount: number | null
}

export interface SalesRouteTarget {
  kind: 'lumpSum' | 'subscription'
  period: string | null
  channel1: string
  channel2: string
  sourceRevision: string
}

/** Staff-confirmed route details stored independently of the BEST order. */
export interface SalesRouteCorrection extends SalesRouteTarget {
  id: string
  correctedChannel1: string
  correctedChannel2: string
  changedAt: string
  changedBy: string
}

export interface PurchaseDateEvidence {
  date: string
  source: '판매일' | '판매확정일' | '주문일자'
}

/** Customer-level RAW totals. Source phone numbers and order identifiers are not stored. */
export interface SalesRawPeriod {
  period: string
  sourceHash: string
  importedAt: string
  /** Valid explicit 판매일/판매일자 values from admitted source orders. */
  saleDates?: readonly string[]
  purchaseDateEvidence?: readonly PurchaseDateEvidence[]
  /** Valid LGE배송요청일 values from admitted cash detail lines. */
  lgeDeliveryRequestedDates?: readonly string[]
  orderCount: number
  confirmedOrderCount: number
  reservedOrderCount: number
  tentativeOrderCount?: number
  confirmedAmount: number
  reservedAmount: number
  tentativeAmount?: number
  /** Signed sales total from original 주문상태=매출 rows. Missing until verified. */
  settlementBasisAmount?: number
  eligibleConfirmedAmount: number
  eligibleReservedAmount: number
  eligibleTentativeAmount?: number
  /** Original order stages remain distinct; these stages count as business sales. */
  completedStatuses?: readonly string[]
  returnAmount: number
  channels?: readonly SalesChannelSummary[]
}

/** Subscription amounts use membership-benefit basis, not monthly fees or shipment prices. */
export interface SubscriptionRawPeriod {
  period: string
  sourceHash: string
  importedAt: string
  /** Valid explicit 판매일/판매일자 values from admitted source product lines. */
  saleDates?: readonly string[]
  purchaseDateEvidence?: readonly PurchaseDateEvidence[]
  /** Valid 배송요청일 values from admitted subscription product lines. */
  deliveryRequestedDates?: readonly string[]
  itemCount: number
  confirmedItemCount: number
  pendingItemCount: number
  confirmedBasisAmount: number
  pendingBasisAmount: number
  /** Membership basis from original 주문상태=마감됨 rows. Missing until verified. */
  settlementBasisAmount?: number
  eligibleConfirmedBasisAmount: number
  eligiblePendingBasisAmount: number
  includedStatuses: readonly string[]
  missingBasisItemCount: number
  /** Reference count only: rejected proof is included in eligible-route commission. */
  rejectedProofItemCount: number
  channels?: readonly SalesChannelSummary[]
}

interface LinkedSettlementSource {
  leadId: string
  caseGroupId: string
  memberIds: string[]
}

export interface LinkedCashReview {
  period: string
  sourceHash: string
  confirmedAmount: number
  settlementBasisAmount?: number
}

interface LinkedCashSettlementReview {
  reviewedAt: string
  partnerName: string
  linkedSource: LinkedSettlementSource & {
    cashRoute: LinkedCashReview & { settlementBasisAmount: number }
  }
}

/** A verified portion of subscription RAW when the saved sales amount differs. */
interface ReviewedSubscriptionAmount {
  period: string
  sourceHash: string
  enteredAmount: number
  confirmedBasisAmount: number
  pendingBasisAmount: number
  settlementBasisAmount: number
  reviewedAt: string
  partnerName: string
  linkedSource?: LinkedSettlementSource & { cashRoute?: LinkedCashReview }
}

/** Both approval methods live under the same protected Firestore field. */
export type SubscriptionSettlementReview = (ReviewedSubscriptionAmount & { cashOnly?: LinkedCashSettlementReview })
  | (Partial<Record<keyof ReviewedSubscriptionAmount, never>> & { cashOnly: LinkedCashSettlementReview })

export interface Lead {
  id: string
  registeredAt: string
  customerName: string
  phoneLast4: string
  bestCustomerNumber?: string
  gender: '남' | '여' | '미입력'
  visitScheduledDate?: string
  deliveryScheduledDate?: string
  appointmentType?: AppointmentType
  appointmentSourceId?: string
  invitationCampaign?: InvitationCampaign
  partnerName: string
  billToCode?: string
  lgeSubchannel?: string
  manager?: string
  managerEmployeeNo?: string
  plannerName?: string
  caseGroupId?: string
  /** Whole-customer basis for one logical case; original member fields are retained. */
  caseBasisLeadId?: string
  /** Explicit full roster consenting to monetary merging. Absence never adds A+B. */
  caseMergeMemberIds?: string[]
  status: LeadStatus
  visitState: VisitState
  purchaseType?: PurchaseType
  purchaseAmount?: number
  lumpSumAmount?: number
  subscriptionAmount?: number
  /** Missing means an independent legacy purchase; an alias contributes no money. */
  lumpSumSourceId?: string
  subscriptionSourceId?: string
  caseSharingHistory?: CaseSharingHistory[]
  salesRawPeriods?: Record<string, SalesRawPeriod>
  subscriptionRawPeriods?: Record<string, SubscriptionRawPeriod>
  subscriptionSettlementReview?: SubscriptionSettlementReview
  salesRouteCorrections?: SalesRouteCorrection[]
  note?: string
  memoHistory?: MemoEntry[]
  updatedAt: string
}

export const STATUSES: LeadStatus[] = ['관리중', '구매완료', '상담 마감', '취소']
