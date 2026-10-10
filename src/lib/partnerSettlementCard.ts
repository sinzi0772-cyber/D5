import type { PartnerPreviewModel } from './partnerPreview'

export interface PartnerSettlementCard {
  selection: string
  expectedCommission: number
  customerCount: number
  options: Array<{ value: string; month: string | null }>
}

/** Select one saved settlement bucket; never substitute the all-month total. */
export function getPartnerSettlementCard(model: Readonly<PartnerPreviewModel>, requestedSelection?: string): PartnerSettlementCard {
  // The trusted model already supplies ascending, unique settlement months.
  // Copy option records instead of sorting or changing the saved buckets.
  const options: PartnerSettlementCard['options'] = model.settlements.map(bucket => ({ value: bucket.month, month: bucket.month }))
  if (model.undatedCustomerCount > 0) options.push({ value: 'undated', month: null })
  const selection = requestedSelection && options.some(option => option.value === requestedSelection) ? requestedSelection : options[0]?.value || ''
  if (selection === 'undated') return { selection, expectedCommission: model.undatedExpectedCommission, customerCount: model.undatedCustomerCount, options }
  const bucket = model.settlements.find(item => item.month === selection)
  return { selection, expectedCommission: bucket?.expectedCommission ?? 0, customerCount: bucket?.customerCount ?? 0, options }
}
