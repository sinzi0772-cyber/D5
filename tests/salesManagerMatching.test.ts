import assert from 'node:assert/strict'
import { matchSalesManagerForOrders } from '../src/lib/salesManagerMatching.ts'
import type { SalesManagerProfile } from '../src/lib/salesManagerMatching.ts'

const profiles: SalesManagerProfile[] = [
  { employeeNo: '101', displayName: '가나다', role: 'manager', active: true },
  { employeeNo: '102', displayName: '라마바', role: 'store_manager' },
  { employeeNo: '103', displayName: '사아자', role: 'assistant_manager', active: true },
  { employeeNo: '104', displayName: '비활성', role: 'manager', active: false },
  { employeeNo: '105', displayName: '차단됨', role: 'manager', disabled: true },
  { employeeNo: '106', displayName: '비승인', role: 'manager', approved: false },
  { employeeNo: '107', displayName: '시스템', role: 'admin', active: true },
]
const row = (seller: string, saleAmount = 100_000, isReturnOrRefund = false) => ({ seller, saleAmount, isReturnOrRefund })
const match = (...rows: ReturnType<typeof row>[]) => matchSalesManagerForOrders(rows, profiles)
const originalProfiles = JSON.stringify(profiles)

const nameOnly = match(row(' 가나다 '), row('가 나 다'))
assert.equal(nameOnly.disposition, 'matched')
assert.equal(nameOnly.managerEmployeeNo, '101')
assert.equal(nameOnly.displayName, '가나다')
assert.deepEqual(nameOnly.evidence.matchedBy, ['full-name'])
assert.equal(nameOnly.evidence.positiveOrderCount, 2)

for (const label of ['101', '가나다 (101)', '101 가나다', '사번: 101 가나다', '판매사원 가나다 [101]']) {
  const result = match(row(label))
  assert.equal(result.disposition, 'matched', label)
  assert.equal(result.managerEmployeeNo, '101')
  assert.deepEqual(result.evidence.matchedBy, ['employee-no'])
}
assert.equal(match(row('라마바(101)')).disposition, 'not-found', 'A known number does not override a conflicting name')
assert.ok(match(row('라마바(101)')).reasons.includes('staff-name-mismatch'))
assert.equal(match(row('가*다(101)')).disposition, 'not-found', 'Masked names are not expanded even next to a number')
assert.equal(match(row('가*다')).disposition, 'not-found')
assert.equal(match(row('가나')).disposition, 'not-found', 'A partial name never matches')
assert.equal(match(row('가나다 101 / 102')).disposition, 'not-found')
assert.equal(match(row('라마바')).managerEmployeeNo, '102')
assert.equal(match(row('사아자')).managerEmployeeNo, '103')

for (const label of ['비활성', '104', '차단됨', '105', '비승인', '106', '시스템', '107']) {
  assert.equal(match(row(label)).disposition, 'not-found', label)
}

const duplicateNames = matchSalesManagerForOrders([row('가나다')], [
  ...profiles, { employeeNo: '108', displayName: '가나다', role: 'manager', active: true },
])
assert.equal(duplicateNames.disposition, 'ambiguous')
assert.ok(duplicateNames.reasons.includes('duplicate-staff-name'))
assert.equal(duplicateNames.managerEmployeeNo, undefined)
assert.equal(matchSalesManagerForOrders([row('101 가나다')], [
  ...profiles, { employeeNo: '108', displayName: '가나다', role: 'manager' },
]).managerEmployeeNo, '101', 'An exact employee number resolves otherwise duplicated names')
const conflictingNumber = matchSalesManagerForOrders([row('가나다')], [
  ...profiles, { employeeNo: '101', displayName: '다른이름', role: 'manager' },
])
assert.equal(conflictingNumber.disposition, 'ambiguous')
assert.ok(conflictingNumber.reasons.includes('duplicate-employee-number'))
assert.equal(matchSalesManagerForOrders([row('가나다')], [...profiles, { ...profiles[0] }]).disposition, 'matched', 'Duplicate views of one staff identity are deduplicated')

const multipleSellers = match(row('가나다'), row('라마바'))
assert.equal(multipleSellers.disposition, 'ambiguous')
assert.ok(multipleSellers.reasons.includes('multiple-sales-managers'))
assert.equal(multipleSellers.managerEmployeeNo, undefined)
const sameStaffDifferentLabel = match(row('101'), row('가나다'))
assert.equal(sameStaffDifferentLabel.disposition, 'matched')
assert.deepEqual(sameStaffDifferentLabel.evidence.matchedBy, ['employee-no', 'full-name'])

const originalSellerWins = match(row('가나다'), row('라마바', -20_000, true), row('라마바', 20_000, true), row('사아자', 0))
assert.equal(originalSellerWins.managerEmployeeNo, '101', 'Refund staff and zero-value changes never change seller')
assert.equal(originalSellerWins.evidence.ignoredOrderCount, 3)
assert.equal(match(row('라마바', -20_000)).disposition, 'missing')
assert.equal(match(row('라마바', 0)).disposition, 'missing')
assert.equal(match(row('라마바', Number.NaN)).disposition, 'missing')
assert.equal(match(row('라마바', Number.POSITIVE_INFINITY)).disposition, 'missing')
assert.equal(match().disposition, 'missing')
assert.ok(match().reasons.includes('no-positive-sale-orders'))

const missingSeller = match(row('가나다'), row(''))
assert.equal(missingSeller.disposition, 'missing')
assert.equal(missingSeller.managerEmployeeNo, undefined)
assert.ok(missingSeller.reasons.includes('seller-missing'))
assert.ok(missingSeller.reasons.includes('unresolved-seller'))
const unknownSeller = match(row('가나다'), row('알수없음'))
assert.equal(unknownSeller.disposition, 'not-found')
assert.equal(unknownSeller.managerEmployeeNo, undefined)
assert.equal(unknownSeller.evidence.unresolvedSellerCount, 1)

const input = [row('가나다')]
const originalOrders = JSON.stringify(input)
const privacy = matchSalesManagerForOrders(input, profiles)
assert.deepEqual(Object.keys(privacy.evidence).sort(), ['ignoredOrderCount', 'managerCandidates', 'matchedBy', 'matchedSellerCount', 'missingSellerCount', 'positiveOrderCount', 'sellerCount', 'unresolvedSellerCount'].sort())
assert.equal(JSON.stringify(input), originalOrders)
assert.equal(JSON.stringify(profiles), originalProfiles)

console.log('salesManagerMatching: exact approved staff, number/name consistency, multiple sellers, refund exclusions, privacy and immutable inputs passed')
