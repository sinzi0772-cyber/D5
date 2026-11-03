import type { Lead } from '../types'
import { canonicalPartnerName } from './partners'
import { isValidDeliveryDate } from './commissionSettlement'
import { expectedRebateBreakdownFor, salesRawAmountsFor, subscriptionRawAmountsFor } from './salesFinance'

export interface CaseBasisReviewDetails {
  /** Earliest valid original receipt month; empty means the month is unknown. */
  month: string
  differences: string[]
  summary: string
}

const validAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const enteredAmount = (lead: Lead, kind: 'lumpSum' | 'subscription'): number | null => {
  const direct = kind === 'lumpSum' ? lead.lumpSumAmount : lead.subscriptionAmount
  if (validAmount(direct)) return direct
  const type = kind === 'lumpSum' ? '일시불' : '구독'
  return lead.purchaseType === type && validAmount(lead.purchaseAmount) ? lead.purchaseAmount : null
}
const dateOnly = (value?: string): string => {
  const date = typeof value === 'string' ? value.slice(0, 10) : ''
  return isValidDeliveryDate(date) ? date : ''
}
const hasDifference = (values: readonly unknown[]): boolean => new Set(values.map(value => JSON.stringify(value))).size > 1
const shortReason = (value: string): string => {
  const reason = value.trim()
  if (reason.startsWith('RAW 근거는 있지만 구매 금액이 미입력입니다.')) return '원본 주문은 있으나 구매금액이 미입력입니다.'
  const firstSentenceEnd = reason.indexOf('. ')
  return (firstSentenceEnd === -1 ? reason : reason.slice(0, firstSentenceEnd + 1)) || '기준 고객 확인 필요'
}

/** Explain differences only. This never elects a basis, merges money, or writes a lead. */
export function getCaseBasisReviewDetails(members: readonly Lead[], reason: string): CaseBasisReviewDetails {
  const dates = members.map(member => dateOnly(member.registeredAt)).filter(Boolean).sort()
  const month = dates[0]?.slice(0, 7) || ''
  const genericConflict = reason.startsWith('기준 정보가 다릅니다.')
    || reason.startsWith('판매 금액은 미입력이지만 담당자·상태·배송일 정보가 다릅니다.')
  if (!genericConflict) return { month, differences: [], summary: shortReason(reason) }

  const differences: string[] = []
  if (hasDifference(members.map(member => [enteredAmount(member, 'lumpSum'), enteredAmount(member, 'subscription')]))) differences.push('판매금액')
  if (hasDifference(members.map(member => member.managerEmployeeNo || member.manager || ''))) differences.push('담당자')
  if (hasDifference(members.map(member => member.status))) differences.push('상태')
  if (hasDifference(members.map(member => dateOnly(member.deliveryScheduledDate)))) differences.push('배송일')
  if (hasDifference(members.map(member => canonicalPartnerName(member.partnerName)))) differences.push('제휴업체')

  const evidence = members.map(member => {
    // Compare each original's own possible basis, not its current excluded-member role.
    const calculation = { ...member, caseBasisLeadId: member.id }
    const rebate = expectedRebateBreakdownFor(calculation)
    const sales = salesRawAmountsFor(calculation)
    const subscription = subscriptionRawAmountsFor(calculation)
    const currentRefund = sales.current ? Object.values(member.salesRawPeriods || {}).reduce((sum, period) => sum + (Number.isFinite(period.returnAmount) ? period.returnAmount : 0), 0) : 0
    return [
      sales.current, subscription.current,
      rebate.lumpSumBasis, rebate.subscriptionBasis,
      sales.confirmed, sales.reserved, sales.tentative, sales.completed, sales.pending,
      subscription.confirmed, subscription.pending, currentRefund,
    ]
  })
  if (hasDifference(evidence)) differences.push('수수료 근거')
  return { month, differences, summary: differences.length ? `${differences.join('·')} 다름` : shortReason(reason) }
}
