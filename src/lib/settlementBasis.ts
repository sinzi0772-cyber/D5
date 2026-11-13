import { isOneWonSaleAmount, type SalesRawOrder } from './salesRaw'
import type { SubscriptionRawItem } from './subscriptionRaw'

/** The original status distinguishes commissionable sales from other confirmed records. */
export function cashSettlementBasisFor(orders: readonly SalesRawOrder[]): number | undefined {
  const confirmed = orders.filter(order => order.orderStatus === '확정' && !isOneWonSaleAmount(order.saleAmount))
  if (confirmed.some(order => !order.sourceOrderStatus)) return undefined
  const amount = confirmed.reduce((sum, order) => sum + (order.sourceOrderStatus === '매출' || order.sourceOrderStatus === '주문확정' ? order.saleAmount : 0), 0)
  return Number.isSafeInteger(amount) ? amount : undefined
}

export function subscriptionSettlementBasisFor(items: readonly SubscriptionRawItem[]): number | undefined {
  const confirmed = items.filter(item => item.disposition === 'confirmed'
    && (item.orderStatusLabel === '마감됨' || item.orderStatusLabel === '주문확정')
    && !isOneWonSaleAmount(item.membershipBenefitBasisAmount))
  if (confirmed.some(item => item.membershipBenefitBasisAmount === null || item.membershipBenefitBasisAmount < 0)) return undefined
  const amount = confirmed.reduce((sum, item) => sum + (item.membershipBenefitBasisAmount ?? 0), 0)
  return Number.isSafeInteger(amount) ? amount : undefined
}
