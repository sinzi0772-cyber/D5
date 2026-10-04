import assert from 'node:assert/strict'
import { comparePurchaseAmounts, getVisiblePurchaseMembers, purchaseSortValue } from '../src/lib/customerSorting.ts'
import type { Lead } from '../src/types.ts'

const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id, registeredAt: '2026-09-01', customerName: '가*나', phoneLast4: '0001', gender: '미입력',
  partnerName: '업체 A', status: '관리중', visitState: '미정', updatedAt: '2026-10-01', ...changes,
})
const ten = lead('ten', { purchaseType: '일시불', lumpSumAmount: 10 })
const hundred = lead('hundred', { purchaseType: '일시불+구독', lumpSumAmount: 60, subscriptionAmount: 40 })
const missing = lead('missing')
const zero = lead('raw-zero', { purchaseType: '일시불', lumpSumAmount: 0, salesRawPeriods: {
  '2026-09': {
    period: '2026-09', sourceHash: 'anonymous-zero', importedAt: '2026-10-04', orderCount: 1,
    confirmedOrderCount: 1, reservedOrderCount: 0, confirmedAmount: 0, reservedAmount: 0,
    eligibleConfirmedAmount: 0, eligibleReservedAmount: 0, returnAmount: 0,
  },
} })
const values = [missing, ten, hundred, zero]
const sorted = (direction: 'asc' | 'desc') => [...values].sort((a, b) => comparePurchaseAmounts(purchaseSortValue(a, values), purchaseSortValue(b, values), direction)).map(row => row.id)
assert.deepEqual(sorted('desc'), ['hundred', 'ten', 'raw-zero', 'missing'])
assert.deepEqual(sorted('asc'), ['raw-zero', 'ten', 'hundred', 'missing'])
assert.equal(purchaseSortValue(zero, values), 0)
assert.equal(purchaseSortValue(missing, values), null)
assert.equal(purchaseSortValue(lead('manual-zero', { purchaseType: '일시불', lumpSumAmount: 0 }), []), null)

const coupleA = lead('couple-a', { caseGroupId: 'couple', purchaseType: '일시불', lumpSumAmount: 10 })
const coupleB = lead('couple-b', { caseGroupId: 'couple', purchaseType: '구독', subscriptionAmount: 90 })
const other = lead('other', { purchaseType: '일시불', lumpSumAmount: 999 })
assert.equal(purchaseSortValue(coupleA, [coupleA, coupleB, other]), 100)
assert.equal(purchaseSortValue(coupleB, [coupleA, coupleB, other]), 100)
assert.equal(purchaseSortValue(coupleA, [coupleA, other]), 10, 'Filtered-out linked member must not affect sort value')
assert.deepEqual(getVisiblePurchaseMembers(coupleA, [coupleA, other]).map(row => row.id), ['couple-a'])
assert.equal(purchaseSortValue(coupleA, [coupleA, coupleA, coupleB]), 100, 'Repeated views of a document are counted once')
assert.equal(purchaseSortValue(other, [coupleA, coupleB]), null, 'Out-of-scope individual cannot supply an amount')
assert.equal(comparePurchaseAmounts(null, null, 'desc'), 0)
assert.equal(comparePurchaseAmounts(100, 100, 'asc'), 0)
assert.equal(comparePurchaseAmounts(100, null, 'desc'), -1)
assert.equal(comparePurchaseAmounts(null, 100, 'asc'), 1)

console.log('customerSorting: numeric amounts, missing-last, valid RAW zero and filtered couple totals passed')
