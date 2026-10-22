import assert from 'node:assert/strict'
import { buildCustomerCaseList, type CustomerCaseFilters } from '../src/lib/customerCaseList.ts'
import type { Lead, LeadStatus } from '../src/types.ts'

const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id, registeredAt: '2026-10-01', updatedAt: '2026-10-19', customerName: id === 'A' ? '김**' : '이**', phoneLast4: id === 'A' ? '4101' : '4102',
  gender: '미입력', partnerName: '(주) 아이니웨딩네트웍스', status: '관리중', visitState: '미정', appointmentType: '이업종제휴', ...changes,
})
const statuses: readonly LeadStatus[] = ['관리중', '구매완료', '상담 마감', '취소']
const ids = (rows: readonly Lead[]) => rows.map(row => row.id)
const assertCase = (rows: readonly Lead[], filters: CustomerCaseFilters, selectedId: string | undefined, message: string) => {
  const result = buildCustomerCaseList(rows, rows, filters)
  assert.deepEqual(ids(result.rows), selectedId ? [selectedId] : [], message)
  assert.deepEqual(ids(result.members), selectedId ? ids(rows) : [], `${message}: all original visible members are retained only for included cases`)
  assert.equal(result.excludedRowIds.size, 0)
  if (selectedId) assert.strictEqual(result.rows[0], rows.find(row => row.id === selectedId), `${message}: the row is the exact selected original, not a projection or secondary`)
}

for (const statusA of statuses) for (const statusB of statuses) for (const selectedId of ['A', 'B']) {
  const rows = Object.freeze([
    Object.freeze(lead('A', { caseGroupId: 'status-pair', caseBasisLeadId: selectedId, status: statusA, manager: 'A 담당', visitState: '방문', purchaseType: '일시불', lumpSumAmount: 100000 })),
    Object.freeze(lead('B', { caseGroupId: 'status-pair', caseBasisLeadId: selectedId, status: statusB, manager: 'B 담당', visitState: '미방문', purchaseType: '일시불', lumpSumAmount: 200000 })),
  ])
  const before = JSON.stringify(rows)
  const selected = rows.find(row => row.id === selectedId)!
  const secondary = rows.find(row => row.id !== selectedId)!
  assertCase(rows, {}, selectedId, `${statusA}/${statusB}, basis ${selectedId}: one row without category filters`)
  for (const status of statuses) assertCase(rows, { status }, status === selected.status ? selectedId : undefined, `${statusA}/${statusB}, basis ${selectedId}: only selected status owns category ${status}`)
  assertCase(rows, { status: '전체', visitState: '전체' }, selectedId, 'All-category values remain unfiltered')
  assertCase(rows, { manager: selected.manager }, selectedId, 'Only the selected manager matches')
  assertCase(rows, { manager: secondary.manager }, undefined, 'An excluded manager cannot include the case')
  assertCase(rows, { manager: '미배정' }, undefined, 'An assigned selected customer is not unassigned')
  assertCase(rows, { visitState: selected.visitState }, selectedId, 'Only the selected visit state matches')
  assertCase(rows, { visitState: secondary.visitState }, undefined, 'An excluded visit state cannot include the case')
  assertCase(rows, { query: secondary.phoneLast4 }, selectedId, 'Searching a secondary keeps the selected row and both member names')
  assertCase(rows, { query: secondary.manager?.toLowerCase() }, selectedId, 'A secondary manager text match is a query match, not manager-category ownership')
  assertCase(rows, { query: secondary.phoneLast4, status: selected.status, manager: selected.manager, visitState: selected.visitState }, selectedId, 'Secondary query plus selected categories stays one complete visible group')
  assertCase(rows, { query: secondary.phoneLast4, visitState: secondary.visitState }, undefined, 'Secondary query never overrides selected category ownership')
  assertCase(rows, { query: 'no matching customer' }, undefined, 'Nonmatching query excludes the entire case')
  assert.equal(JSON.stringify(rows), before, 'Filtering frozen originals never changes names, status, amounts, dates or ownership metadata')
}

const emptyChosen = [
  lead('A', { caseGroupId: 'empty', caseBasisLeadId: 'A', status: '취소', manager: '   ', visitState: '일정취소' }),
  lead('B', { caseGroupId: 'empty', caseBasisLeadId: 'A', status: '관리중', manager: '제외 담당', visitState: '예정' }),
]
assertCase(emptyChosen, { status: '취소', manager: '미배정', visitState: '일정취소' }, 'A', 'An empty-money chosen customer still owns all category filters')
assertCase(emptyChosen, { status: '관리중' }, undefined, 'Missing chosen amount cannot restore the excluded managing customer')
assertCase(emptyChosen, { query: '4102' }, 'A', 'Secondary name/phone lookup preserves the chosen empty customer')

const mergedRows = [
  lead('A', { caseGroupId: 'merged', caseBasisLeadId: 'B', caseMergeMemberIds: ['A', 'B'], status: '구매완료', manager: '제외 담당', visitState: '방문', purchaseType: '일시불', lumpSumAmount: 100000 }),
  lead('B', { caseGroupId: 'merged', caseBasisLeadId: 'B', caseMergeMemberIds: ['A', 'B'], status: '상담 마감', manager: '기준 담당', visitState: '일정취소', purchaseType: '일시불', lumpSumAmount: 200000 }),
]
const mergedBefore = JSON.stringify(mergedRows)
assertCase(mergedRows, { status: '상담 마감', manager: '기준 담당', visitState: '일정취소', query: '4101' }, 'B', 'Money merging still has exactly one status/manager/visit basis')
assertCase(mergedRows, { status: '구매완료' }, undefined, 'Merged independent money does not merge operational categories')
assert.equal(JSON.stringify(mergedRows), mergedBefore, 'List filtering never adds or copies money into saved originals')

const hiddenRows = [
  lead('A', { caseGroupId: 'hidden', caseBasisLeadId: 'A', status: '취소', manager: '기준 담당', visitState: '일정취소', partnerName: '기준 업체', purchaseType: '일시불', lumpSumAmount: 100000 }),
  lead('B', { caseGroupId: 'hidden', caseBasisLeadId: 'A', status: '관리중', visitState: '예정', partnerName: '자사 업체', purchaseType: '일시불', lumpSumAmount: 200000 }),
]
const hiddenBefore = JSON.stringify(hiddenRows)
for (const [cohort, scope] of [
  [[hiddenRows[1]], {}],
  [hiddenRows, { partnerName: '자사 업체' }],
] as const) {
  for (const filters of [{}, { status: '전체', visitState: '전체' }, { query: '4102' }]) {
    const result = buildCustomerCaseList(hiddenRows, cohort, { ...scope, ...filters })
    assert.deepEqual(ids(result.rows), ['B'], 'A partial/own-company view keeps its original receipt row when no category is selected')
    assert.deepEqual(ids(result.members), ['B'], 'A hidden basis must not leak through the returned visible members')
    assert.deepEqual([...result.excludedRowIds], ['B'], 'The own receipt row is explicitly excluded from operational categories')
    assert.strictEqual(result.rows[0], hiddenRows[1])
  }
  for (const filters of [{ status: '관리중' }, { status: '취소' }, { manager: '미배정' }, { manager: '기준 담당' }, { visitState: '예정' }, { visitState: '일정취소' }] satisfies CustomerCaseFilters[]) {
    const result = buildCustomerCaseList(hiddenRows, cohort, { ...scope, ...filters })
    assert.deepEqual(result.rows, [], 'Neither the secondary categories nor hidden basis categories can include a scoped receipt')
    assert.deepEqual(result.members, [])
    assert.equal(result.excludedRowIds.size, 0)
  }
  assert.deepEqual(buildCustomerCaseList(hiddenRows, cohort, { ...scope, query: '기준 담당' }).rows, [], 'A query must not inspect the hidden original manager')
}
assert.equal(JSON.stringify(hiddenRows), hiddenBefore, 'Company and cohort scope never change or reveal the hidden original')

const spacedRows = [
  lead('A', { caseGroupId: 'spacing', caseBasisLeadId: 'B', partnerName: '(주)아이니웨딩네트웍스', purchaseType: '일시불', lumpSumAmount: 100000 }),
  lead('B', { caseGroupId: 'spacing', caseBasisLeadId: 'B', partnerName: '(주) 아이니웨딩네트웍스', purchaseType: '일시불', lumpSumAmount: 200000 }),
]
for (const partnerName of ['(주)아이니웨딩네트웍스', '(주) 아이니웨딩네트웍스']) assertCase(spacedRows, { partnerName, query: '4101' }, 'B', 'Canonical company spacing includes the complete same-company case without re-electing the query match')
assertCase(spacedRows, { partnerName: '(주)아이니앤코' }, undefined, 'Different full company names remain distinct')

const unresolved = [
  lead('A', { caseGroupId: 'pending', status: '취소', manager: 'A 담당', visitState: '방문', purchaseType: '일시불', lumpSumAmount: 100000 }),
  lead('B', { caseGroupId: 'pending', status: '관리중', visitState: '미방문', purchaseType: '일시불', lumpSumAmount: 200000 }),
]
const unresolvedBefore = JSON.stringify(unresolved)
const unresolvedAll = buildCustomerCaseList(unresolved, unresolved)
assert.deepEqual(ids(unresolvedAll.rows), ['A'], 'Unresolved legacy groups retain their first matching original-row representative')
assert.deepEqual(ids(unresolvedAll.members), ['A', 'B'])
for (const filters of [{ status: '관리중' }, { manager: '미배정' }, { visitState: '미방문' }, { query: '4102' }]) {
  const result = buildCustomerCaseList(unresolved, unresolved, filters as CustomerCaseFilters)
  assert.deepEqual(ids(result.rows), ['B'], 'Before a basis choice, existing provisional original-row category filtering remains available')
  assert.deepEqual(ids(result.members), ['B'], 'Legacy provisional filters keep only currently matching originals')
  assert.equal(result.excludedRowIds.size, 0)
}
assert.deepEqual(buildCustomerCaseList(unresolved, unresolved, { query: '4102', status: '취소' }).rows, [], 'Legacy query/category matches must belong to the same original')
assert.equal(JSON.stringify(unresolved), unresolvedBefore)

const single = lead('single', { manager: '담당', status: '구매완료', visitState: '방문' })
assertCase([single], { status: '구매완료', manager: '담당', visitState: '방문' }, 'single', 'Unlinked single customers retain ordinary category behavior')
assert.deepEqual(buildCustomerCaseList([single], []).rows, [], 'No cohort records means no receipts or categories')
assert.deepEqual(buildCustomerCaseList([], []).members, [])

console.log('Customer case list: 32 selected-status combinations, basis-only manager/visit filters, secondary queries, empty/merged money modes, hidden scoped basis, canonical company spacing, provisional fallback and immutable originals passed.')
