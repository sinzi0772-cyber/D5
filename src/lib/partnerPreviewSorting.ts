import type { PartnerPreviewCustomer, PartnerPreviewSettlement } from './partnerPreview'

export type PartnerSortDirection = 'asc' | 'desc'
export type PartnerCustomerSortKey = 'label' | 'registeredAt' | 'status' | 'deliveryScheduledDate' | 'expectedSettlementMonth' | 'expectedCommission'
export type PartnerSettlementSortKey = 'month' | 'customerCount' | 'expectedCommission'

export interface PartnerSort<Key extends string> {
  key: Key
  direction: PartnerSortDirection
}

export const DEFAULT_CUSTOMER_SORT: Readonly<PartnerSort<PartnerCustomerSortKey>> = Object.freeze({ key: 'registeredAt', direction: 'desc' })
export const DEFAULT_SETTLEMENT_SORT: Readonly<PartnerSort<PartnerSettlementSortKey>> = Object.freeze({ key: 'month', direction: 'asc' })

const customerText = new Intl.Collator('ko', { numeric: true })
const directionMultiplier = (direction: PartnerSortDirection) => direction === 'asc' ? 1 : -1
const compareDates = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1

function compareNullable<Value>(left: Value | null, right: Value | null, direction: PartnerSortDirection, compare: (a: Value, b: Value) => number): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return compare(left, right) * directionMultiplier(direction)
}

export function nextPartnerCustomerSort(current: Readonly<PartnerSort<PartnerCustomerSortKey>>, key: PartnerCustomerSortKey): PartnerSort<PartnerCustomerSortKey> {
  const direction = current.key === key
    ? current.direction === 'asc' ? 'desc' : 'asc'
    : key === 'registeredAt' || key === 'expectedCommission' ? 'desc' : 'asc'
  return { key, direction }
}

export function nextPartnerSettlementSort(current: Readonly<PartnerSort<PartnerSettlementSortKey>>, key: PartnerSettlementSortKey): PartnerSort<PartnerSettlementSortKey> {
  const direction = current.key === key
    ? current.direction === 'asc' ? 'desc' : 'asc'
    : key === 'month' ? 'asc' : 'desc'
  return { key, direction }
}

/** Sort only the safe display projection; nullable dashes stay last in both directions. */
export function sortPartnerCustomers(rows: readonly PartnerPreviewCustomer[], sort: Readonly<PartnerSort<PartnerCustomerSortKey>>): PartnerPreviewCustomer[] {
  return [...rows].sort((left, right) => {
    switch (sort.key) {
      case 'label':
      case 'status':
        return customerText.compare(left[sort.key], right[sort.key]) * directionMultiplier(sort.direction)
      case 'expectedCommission':
        return compareNullable(left.expectedCommission, right.expectedCommission, sort.direction, (a, b) => a - b)
      default:
        return compareNullable(left[sort.key], right[sort.key], sort.direction, compareDates)
    }
  })
}

/** Dated monthly totals are already calculated by the preview model. */
export function sortPartnerSettlements(rows: readonly PartnerPreviewSettlement[], sort: Readonly<PartnerSort<PartnerSettlementSortKey>>): PartnerPreviewSettlement[] {
  return [...rows].sort((left, right) => sort.key === 'month'
    ? compareDates(left.month, right.month) * directionMultiplier(sort.direction)
    : (left[sort.key] - right[sort.key]) * directionMultiplier(sort.direction))
}
