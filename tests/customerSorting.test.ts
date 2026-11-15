import assert from 'node:assert/strict'
import { comparePurchaseAmounts, customerPurchaseSummaries, getVisiblePurchaseMembers, purchaseSortValue, sortCustomerRows } from '../src/lib/customerSorting.ts'
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
const fees = customerPurchaseSummaries(feeRows, feeRows)
assert.deepEqual([...fees], [['high-sale', { salesAmount: 10_000, commission: 40 }], ['high-fee', { salesAmount: 5_000, commission: 100 }], ['raw-zero', { salesAmount: 0, commission: 0 }]])
const orderedFees = (direction: 'asc' | 'desc') => sortCustomerRows(feeRows, new Set(), (a, b) => comparePurchaseAmounts(fees.get(a.id)?.commission ?? null, fees.get(b.id)?.commission ?? null, direction))
  .map(row => row.id)
assert.deepEqual(orderedFees('desc'), ['high-fee', 'high-sale', 'raw-zero', 'missing', 'couple-a', 'couple-b', 'canceled'])
assert.deepEqual(orderedFees('asc'), ['raw-zero', 'high-sale', 'high-fee', 'missing', 'couple-a', 'couple-b', 'canceled'])
const registrationRows = [
  lead('closed', { status: '상담 마감', registeredAt: '2026-09-05' }),
  lead('visit-canceled', { visitState: '일정취소', registeredAt: '2026-09-03' }),
  lead('excluded', { status: '취소', registeredAt: '2026-09-04' }),
  lead('canceled', { status: '취소', registeredAt: '2026-09-02' }),
  lead('purchased', { status: '구매완료', registeredAt: '2026-09-01' }),
]
const byRegistration = (direction: number) =>
  sortCustomerRows(registrationRows, new Set(['excluded']), (a, b) =>
    a.registeredAt.localeCompare(b.registeredAt) * direction,
  ).map(row => row.id)
assert.deepEqual(byRegistration(-1), ['excluded', 'visit-canceled', 'purchased', 'closed', 'canceled'])
assert.deepEqual(byRegistration(1), ['purchased', 'visit-canceled', 'excluded', 'canceled', 'closed'])
assert.deepEqual(registrationRows.map(row => row.id), ['closed', 'visit-canceled', 'excluded', 'canceled', 'purchased'])

const chosenFeeOwner = { ...highFee, caseGroupId: 'commission-case', caseBasisLeadId: highFee.id }
const chosenFeeMember = { ...missing, caseGroupId: 'commission-case', caseBasisLeadId: highFee.id }
assert.deepEqual([...customerPurchaseSummaries([chosenFeeMember], [chosenFeeOwner, chosenFeeMember])], [[missing.id, { salesAmount: 5_000, commission: 100 }]])
const differentPartner = { ...chosenFeeMember, partnerName: '다른 업체' }
assert.equal(customerPurchaseSummaries([differentPartner], [chosenFeeOwner, differentPartner]).size, 0)

console.log('customerSorting: numeric amounts, missing-last, valid RAW zero and filtered couple totals passed')
