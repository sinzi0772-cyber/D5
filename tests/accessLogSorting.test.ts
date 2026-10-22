import assert from 'node:assert/strict'
import { sortAccessRowsByVisits } from '../src/lib/accessLogSorting.ts'

const row = (employeeNo: string, visits?: number) => Object.freeze({ employeeNo, label: `직원 ${employeeNo}`, ...(visits === undefined ? {} : { usage: Object.freeze({ visitCount: visits }) }) })
const rows = Object.freeze([row('30', 2), row('2', 10), row('10', 21), row('50', 0), row('4'), row('3', 2), Object.freeze({ employeeNo: '60', label: '횟수 미입력', usage: Object.freeze({}) })])
const ids = (values: readonly { employeeNo: string }[]) => values.map(value => value.employeeNo)
const before = JSON.stringify(rows)

assert.deepEqual(ids(sortAccessRowsByVisits(rows, null)), ids(rows), 'Unselected sort preserves the existing recent-access order')
assert.deepEqual(ids(sortAccessRowsByVisits(rows, 'desc')), ['10', '2', '3', '30', '4', '50', '60'], 'Counts sort numerically, not lexically; equal counts use numeric employee IDs')
assert.deepEqual(ids(sortAccessRowsByVisits(rows, 'asc')), ['4', '50', '60', '3', '30', '2', '10'], 'Missing usage or count is equivalent to zero')
for (const direction of [null, 'desc', 'asc', 'desc', 'asc'] as const) {
  const sorted = sortAccessRowsByVisits(rows, direction)
  assert.notEqual(sorted, rows, 'Sorting returns a fresh display array')
  for (const item of sorted) assert.equal(item, rows.find(original => original.employeeNo === item.employeeNo), 'Original row identity and values are unchanged')
  assert.equal(JSON.stringify(rows), before, 'Frozen source array and nested usage are not mutated')
}
assert.deepEqual(sortAccessRowsByVisits([], 'asc'), [])
assert.deepEqual(sortAccessRowsByVisits([], 'desc'), [])
assert.deepEqual(sortAccessRowsByVisits([], null), [])
assert.deepEqual(sortAccessRowsByVisits([rows[0]], 'asc'), [rows[0]])
assert.deepEqual(sortAccessRowsByVisits([rows[0]], 'desc'), [rows[0]])
console.log('PASS accessLogSorting: default order, numeric both directions, tie IDs, missing counts, immutability, empty and single rows')
