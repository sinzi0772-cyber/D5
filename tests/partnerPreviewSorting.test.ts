import assert from 'node:assert/strict'
import {
  DEFAULT_CUSTOMER_SORT,
  DEFAULT_SETTLEMENT_SORT,
  nextPartnerCustomerSort,
  nextPartnerSettlementSort,
  sortPartnerCustomers,
  sortPartnerSettlements,
} from '../src/lib/partnerPreviewSorting.ts'
import type { PartnerCustomerSortKey, PartnerSortDirection } from '../src/lib/partnerPreviewSorting.ts'
import type { PartnerPreviewCustomer, PartnerPreviewSettlement } from '../src/lib/partnerPreview.ts'

const customer = (key: string, changes: Partial<PartnerPreviewCustomer> = {}): PartnerPreviewCustomer => Object.freeze({
  key, label: '김** / 0020', registeredAt: '2026-09-01', status: '관리중',
  deliveryScheduledDate: null, expectedSettlementMonth: null, expectedCommission: null, ...changes,
})
const keys = (rows: readonly PartnerPreviewCustomer[]) => rows.map(row => row.key)
const settlement = (month: string, customerCount: number, expectedCommission: number): PartnerPreviewSettlement => Object.freeze({ month, customerCount, expectedCommission })

assert.deepEqual(DEFAULT_CUSTOMER_SORT, { key: 'registeredAt', direction: 'desc' })
assert.deepEqual(DEFAULT_SETTLEMENT_SORT, { key: 'month', direction: 'asc' })
assert.equal(Object.isFrozen(DEFAULT_CUSTOMER_SORT), true)
assert.equal(Object.isFrozen(DEFAULT_SETTLEMENT_SORT), true)
const customerFirstDirections: Record<PartnerCustomerSortKey, PartnerSortDirection> = {
  label: 'asc', registeredAt: 'desc', status: 'asc', deliveryScheduledDate: 'asc',
  expectedSettlementMonth: 'asc', expectedCommission: 'desc',
}
for (const [key, direction] of Object.entries(customerFirstDirections) as [PartnerCustomerSortKey, PartnerSortDirection][]) {
  const differentKey = key === 'label' ? 'status' : 'label'
  assert.deepEqual(nextPartnerCustomerSort(Object.freeze({ key: differentKey, direction: 'desc' }), key), { key, direction })
  assert.deepEqual(nextPartnerCustomerSort(Object.freeze({ key, direction: 'asc' }), key), { key, direction: 'desc' })
  assert.deepEqual(nextPartnerCustomerSort(Object.freeze({ key, direction: 'desc' }), key), { key, direction: 'asc' })
}
for (const key of ['month', 'customerCount', 'expectedCommission'] as const) {
  const differentKey = key === 'month' ? 'customerCount' : 'month'
  assert.deepEqual(nextPartnerSettlementSort(Object.freeze({ key: differentKey, direction: 'asc' }), key), { key, direction: key === 'month' ? 'asc' : 'desc' })
  assert.deepEqual(nextPartnerSettlementSort(Object.freeze({ key, direction: 'asc' }), key), { key, direction: 'desc' })
  assert.deepEqual(nextPartnerSettlementSort(Object.freeze({ key, direction: 'desc' }), key), { key, direction: 'asc' })
}
assert.deepEqual(DEFAULT_CUSTOMER_SORT, { key: 'registeredAt', direction: 'desc' }, 'Toggles must not mutate defaults')
assert.deepEqual(DEFAULT_SETTLEMENT_SORT, { key: 'month', direction: 'asc' })

const customers = Object.freeze([
  customer('missing-1', { registeredAt: null }),
  customer('twenty', { registeredAt: '2026-09-20', deliveryScheduledDate: '2027-01-02', expectedSettlementMonth: '2027-03', expectedCommission: 20 }),
  customer('hundred', { label: '김** / 0100', registeredAt: '2026-10-01', status: '구매완료', deliveryScheduledDate: '2026-12-31', expectedSettlementMonth: '2027-02', expectedCommission: 100 }),
  customer('zero', { registeredAt: '2026-09-02', deliveryScheduledDate: '2026-10-01', expectedSettlementMonth: '2026-12', expectedCommission: 0 }),
  customer('missing-2', { registeredAt: null }),
])
const originalCustomers = JSON.stringify(customers)
assert.deepEqual(keys(sortPartnerCustomers(customers, DEFAULT_CUSTOMER_SORT)), ['hundred', 'twenty', 'zero', 'missing-1', 'missing-2'])
assert.deepEqual(keys(sortPartnerCustomers(customers, { key: 'registeredAt', direction: 'asc' })), ['zero', 'twenty', 'hundred', 'missing-1', 'missing-2'])
for (const key of ['deliveryScheduledDate', 'expectedSettlementMonth'] as const) {
  assert.deepEqual(keys(sortPartnerCustomers(customers, { key, direction: 'asc' })), ['zero', 'hundred', 'twenty', 'missing-1', 'missing-2'])
  assert.deepEqual(keys(sortPartnerCustomers(customers, { key, direction: 'desc' })), ['twenty', 'hundred', 'zero', 'missing-1', 'missing-2'])
}
assert.deepEqual(keys(sortPartnerCustomers(customers, { key: 'expectedCommission', direction: 'asc' })), ['zero', 'twenty', 'hundred', 'missing-1', 'missing-2'])
assert.deepEqual(keys(sortPartnerCustomers(customers, { key: 'expectedCommission', direction: 'desc' })), ['hundred', 'twenty', 'zero', 'missing-1', 'missing-2'])
assert.deepEqual(keys(sortPartnerCustomers(customers, { key: 'label', direction: 'asc' })), ['missing-1', 'twenty', 'zero', 'missing-2', 'hundred'], 'Masked suffixes use natural numeric order')
assert.deepEqual(keys(sortPartnerCustomers(customers, { key: 'label', direction: 'desc' })), ['hundred', 'missing-1', 'twenty', 'zero', 'missing-2'])
const statusCollator = new Intl.Collator('ko', { numeric: true })
for (const direction of ['asc', 'desc'] as const) {
  const sorted = sortPartnerCustomers(customers, { key: 'status', direction })
  assert.deepEqual(keys(sorted.filter(row => row.status === '관리중')), ['missing-1', 'twenty', 'zero', 'missing-2'], 'Equal statuses keep input order')
  const orderedStatuses = sorted.map(row => row.status)
  for (let index = 1; index < orderedStatuses.length; index++) {
    assert.ok(statusCollator.compare(orderedStatuses[index - 1], orderedStatuses[index]) * (direction === 'asc' ? 1 : -1) <= 0)
  }
}

const tiedCustomers = Object.freeze([customer('tie-1'), customer('tie-2'), customer('tie-3')])
for (const key of Object.keys(customerFirstDirections) as PartnerCustomerSortKey[]) {
  for (const direction of ['asc', 'desc'] as const) {
    const sorted = sortPartnerCustomers(tiedCustomers, { key, direction })
    assert.deepEqual(keys(sorted), ['tie-1', 'tie-2', 'tie-3'])
    assert.notEqual(sorted, tiedCustomers)
    assert.equal(sorted[0], tiedCustomers[0], 'Sorting must preserve row identity and values')
  }
}
const safeDisplayOnly = Object.freeze([
  Object.freeze({ ...customer('masked-100', { label: '김** / 0100' }), get customerName(): string { throw new Error('Do not read original name') } }),
  Object.freeze({ ...customer('masked-20'), get phoneLast4(): string { throw new Error('Do not read original phone') } }),
])
assert.deepEqual(keys(sortPartnerCustomers(safeDisplayOnly, { key: 'label', direction: 'asc' })), ['masked-20', 'masked-100'])
assert.equal(JSON.stringify(customers), originalCustomers, 'Frozen input rows and order remain unchanged')

const settlements = Object.freeze([
  settlement('2027-01', 20, 100), settlement('2026-12', 100, 20), settlement('2027-02', 0, 0),
])
const originalSettlements = JSON.stringify(settlements)
const months = (rows: readonly PartnerPreviewSettlement[]) => rows.map(row => row.month)
assert.deepEqual(months(sortPartnerSettlements(settlements, DEFAULT_SETTLEMENT_SORT)), ['2026-12', '2027-01', '2027-02'])
assert.deepEqual(months(sortPartnerSettlements(settlements, { key: 'month', direction: 'desc' })), ['2027-02', '2027-01', '2026-12'])
assert.deepEqual(months(sortPartnerSettlements(settlements, { key: 'customerCount', direction: 'asc' })), ['2027-02', '2027-01', '2026-12'])
assert.deepEqual(months(sortPartnerSettlements(settlements, { key: 'customerCount', direction: 'desc' })), ['2026-12', '2027-01', '2027-02'])
assert.deepEqual(months(sortPartnerSettlements(settlements, { key: 'expectedCommission', direction: 'asc' })), ['2027-02', '2026-12', '2027-01'])
assert.deepEqual(months(sortPartnerSettlements(settlements, { key: 'expectedCommission', direction: 'desc' })), ['2027-01', '2026-12', '2027-02'])
const tiedSettlements = Object.freeze([settlement('2027-01', 20, 100), settlement('2027-01', 20, 100), settlement('2027-01', 20, 100)])
for (const key of ['month', 'customerCount', 'expectedCommission'] as const) {
  for (const direction of ['asc', 'desc'] as const) {
    const sorted = sortPartnerSettlements(tiedSettlements, { key, direction })
    assert.notEqual(sorted, tiedSettlements)
    sorted.forEach((row, index) => assert.equal(row, tiedSettlements[index], 'Equal totals keep input order and identity'))
  }
}
assert.equal(JSON.stringify(settlements), originalSettlements, 'Already calculated monthly totals remain unchanged')
const emptyCustomers: readonly PartnerPreviewCustomer[] = Object.freeze([])
const emptySettlements: readonly PartnerPreviewSettlement[] = Object.freeze([])
assert.notEqual(sortPartnerCustomers(emptyCustomers, DEFAULT_CUSTOMER_SORT), emptyCustomers)
assert.notEqual(sortPartnerSettlements(emptySettlements, DEFAULT_SETTLEMENT_SORT), emptySettlements)
console.log('partnerPreviewSorting: defaults, toggle direction, masked text, dates, numeric values, null-last, stable ties and immutable inputs passed')
