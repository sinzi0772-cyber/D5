import { isOneWonSaleAmount, type SalesRawOrder } from './salesRaw'
import type { SubscriptionRawItem } from './subscriptionRaw'

/** Confirmation alone does not identify the original 매출 status. */
export function cashSettlementBasisFor(orders: readonly SalesRawOrder[]): number | undefined {
  const confirmed = orders.filter(order => order.orderStatus === '확정' && !isOneWonSaleAmount(order.saleAmount))
  if (confirmed.some(order => !order.sourceOrderStatus)) return undefined
  const amount = confirmed.reduce((sum, order) => sum + (order.sourceOrderStatus === '매출' ? order.saleAmount : 0), 0)
  return Number.isSafeInteger(amount) ? amount : undefined
}

export function subscriptionSettlementBasisFor(items: readonly SubscriptionRawItem[]): number | undefined {
  const closed = items.filter(item => item.disposition === 'confirmed' && item.orderStatusLabel === '마감됨' && !isOneWonSaleAmount(item.membershipBenefitBasisAmount))
  if (closed.some(item => item.membershipBenefitBasisAmount === null || item.membershipBenefitBasisAmount < 0)) return undefined
  const amount = closed.reduce((sum, item) => sum + (item.membershipBenefitBasisAmount ?? 0), 0)
  return Number.isSafeInteger(amount) ? amount : undefined
}
