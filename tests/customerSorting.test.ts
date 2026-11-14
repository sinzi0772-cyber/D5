import assert from 'node:assert/strict'
import { comparePurchaseAmounts, expectedCommissionByCustomer, getVisiblePurchaseMembers, purchaseSortValue } from '../src/lib/customerSorting.ts'
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
const canceled = lead('canceled', { status: '취소', purchaseType: '일시불', lumpSumAmount: 999 })
assert.equal(purchaseSortValue(canceled, [...values, canceled]), null)
assert.equal(purchaseSortValue(lead('manual-zero', { purchaseType: '일시불', lumpSumAmount: 0 }), []), null)

const coupleA = lead('couple-a', { caseGroupId: 'couple', purchaseType: '일시불', lumpSumAmount: 10 })
const coupleB = lead('couple-b', { caseGroupId: 'couple', purchaseType: '구독', subscriptionAmount: 90 })
const other = lead('other', { purchaseType: '일시불', lumpSumAmount: 999 })
assert.equal(purchaseSortValue(coupleA, [coupleA, coupleB, other]), null, 'Different A/B whole rows require a basis; never add cash and subscription')
assert.equal(purchaseSortValue(coupleB, [coupleA, coupleB, other]), null)
assert.equal(purchaseSortValue(coupleA, [coupleA, other]), null, 'A partial linked group cannot elect the only visible member')
assert.deepEqual(getVisiblePurchaseMembers(coupleA, [coupleA, other]).map(row => row.id), ['couple-a'])
assert.equal(purchaseSortValue(coupleA, [coupleA, coupleA, coupleB]), null, 'Repeated views cannot conceal a basis conflict')
const chosen = [coupleA, coupleB].map(member => ({ ...member, caseBasisLeadId: coupleA.id }))
assert.equal(purchaseSortValue(chosen[1], chosen, chosen), 10, 'The selected whole A row is used, not A+B')
assert.equal(purchaseSortValue(chosen[1], [chosen[1]], chosen), 10, 'Resolve complete group before applying a display filter')
const canceledBasis = [{ ...chosen[0], status: '취소' as const }, chosen[1]]
assert.equal(purchaseSortValue(canceledBasis[1], [canceledBasis[1]], canceledBasis), null, 'A canceled case basis hides purchase info for a secondary row')
const canceledPeer = [chosen[0], { ...chosen[1], status: '취소' as const }]
assert.equal(purchaseSortValue(canceledPeer[0], canceledPeer), 10, 'A canceled secondary customer does not hide the active basis')
assert.equal(purchaseSortValue(other, [coupleA, coupleB]), null, 'Out-of-scope individual cannot supply an amount')
assert.equal(comparePurchaseAmounts(null, null, 'desc'), 0)
assert.equal(comparePurchaseAmounts(100, 100, 'asc'), 0)
assert.equal(comparePurchaseAmounts(100, null, 'desc'), -1)
assert.equal(comparePurchaseAmounts(null, 100, 'asc'), 1)


const feeLead = (id: string, amount: number, settlementBasisAmount: number) => lead(id, {
  purchaseType: '일시불', lumpSumAmount: amount,
  salesRawPeriods: { '2026-09': { ...zero.salesRawPeriods!['2026-09'], confirmedAmount: amount, settlementBasisAmount } },
})
const highSale = feeLead('high-sale', 10_000, 2_000)
const highFee = feeLead('high-fee', 5_000, 5_000)
const feeRows = [highSale, highFee, zero, missing, canceled, coupleA, coupleB]
const fees = expectedCommissionByCustomer(feeRows, feeRows)
assert.deepEqual([...fees], [['high-sale', 40], ['high-fee', 100], ['raw-zero', 0]])
const orderedFees = (direction: 'asc' | 'desc') => [...feeRows]
  .sort((a, b) => comparePurchaseAmounts(fees.get(a.id) ?? null, fees.get(b.id) ?? null, direction))
  .map(row => row.id)
assert.deepEqual(orderedFees('desc'), ['high-fee', 'high-sale', 'raw-zero', 'missing', 'canceled', 'couple-a', 'couple-b'])
assert.deepEqual(orderedFees('asc'), ['raw-zero', 'high-sale', 'high-fee', 'missing', 'canceled', 'couple-a', 'couple-b'])
const chosenFeeOwner = { ...highFee, caseGroupId: 'commission-case', caseBasisLeadId: highFee.id }
const chosenFeeMember = { ...missing, caseGroupId: 'commission-case', caseBasisLeadId: highFee.id }
assert.deepEqual([...expectedCommissionByCustomer([chosenFeeMember], [chosenFeeOwner, chosenFeeMember])], [[missing.id, 100]])
const differentPartner = { ...chosenFeeMember, partnerName: '다른 업체' }
assert.equal(expectedCommissionByCustomer([differentPartner], [chosenFeeOwner, differentPartner]).size, 0)

console.log('customerSorting: numeric amounts, missing-last, valid RAW zero and filtered couple totals passed')
