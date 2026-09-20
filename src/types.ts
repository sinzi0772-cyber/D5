export type LeadStatus = '관리중' | '구매완료' | '취소'
export type VisitState = '미정' | '예정' | '방문' | '미방문' | '일정취소'

export interface MemoEntry {
  id: string
  date: string
  manager: string
  content: string
}

export interface Lead {
  id: string
  registeredAt: string
  customerName: string
  phoneLast4: string
  gender: '남' | '여' | '미입력'
  visitScheduledDate?: string
  partnerName: string
  billToCode?: string
  lgeSubchannel?: string
  manager?: string
  plannerName?: string
  caseGroupId?: string
  status: LeadStatus
  visitState: VisitState
  note?: string
  memoHistory?: MemoEntry[]
  updatedAt: string
}

export const STATUSES: LeadStatus[] = ['관리중', '구매완료', '취소']
