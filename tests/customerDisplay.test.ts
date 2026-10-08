import assert from 'node:assert/strict'
import { customerDisplayLabel, customerDisplayName, phoneLast4Display } from '../src/lib/customerDisplay.ts'
import { customerIdentityKey, maskCustomerName } from '../src/lib/salesRaw.ts'

const nameCases: [unknown, string][] = [
  ['김상우', '김**'],
  ['김*호', '김**'],
  ['김**', '김**'],
  ['김', '김**'],
  ['김호', '김**'],
  [' 김 상 우 ', '김**'],
  ['\t김\n상우\u3000', '김**'],
  ['ＡＢＣ', 'A**'],
  ['김상우', '김**'],
  ['𠮷田', '𠮷**'],
  ['😀고객', '😀**'],
  ['*상우', '***'],
  ['＊상우', '***'],
  ['***', '***'],
  ['미입력', '미입력'],
  ['', '미입력'],
  [' \t\n ', '미입력'],
  [null, '미입력'],
  [undefined, '미입력'],
  [1234, '미입력'],
  [{ customerName: '김상우' }, '미입력'],
]
for (const [value, expected] of nameCases) {
  assert.equal(customerDisplayName(value), expected)
  assert.equal(customerDisplayName(customerDisplayName(value)), expected, 'Display masking must be idempotent')
}

const phoneCases: [unknown, string][] = [
  ['7188', '7188'],
  ['0252', '0252'],
  ['0000', '0000'],
  ['010-1234-0252', '0252'],
  ['123456789012', '9012'],
  [' 010 1234 0252 ', '0252'],
  ['•••• 0252', '0252'],
  ['０１０－１２３４－０２５２', '0252'],
  [1012340252, '0252'],
  ['123', '미입력'],
  ['abc', '미입력'],
  ['', '미입력'],
  [null, '미입력'],
  [undefined, '미입력'],
  [0, '미입력'],
  [-1234, '미입력'],
  [1234.5, '미입력'],
  [Number.NaN, '미입력'],
  [Number.POSITIVE_INFINITY, '미입력'],
  [Number.MAX_SAFE_INTEGER + 1, '미입력'],
  [{ phone: '010-1234-0252' }, '미입력'],
]
for (const [value, expected] of phoneCases) {
  assert.equal(phoneLast4Display(value), expected)
  assert.equal(phoneLast4Display(phoneLast4Display(value)), expected, 'Phone suffix display must be idempotent')
  assert.ok(expected === '미입력' || /^\d{4}$/.test(expected), 'Only the final four phone digits may be displayed')
}

const stored = { customerName: '김*호', phoneLast4: '0252' }
const original = structuredClone(stored)
const originalIdentity = customerIdentityKey(stored.customerName, stored.phoneLast4)
assert.equal(customerDisplayLabel(stored), '김** / 0252')
assert.deepEqual(stored, original, 'Display formatting must never mutate stored fields')
assert.equal(customerIdentityKey(stored.customerName, stored.phoneLast4), originalIdentity)
assert.equal(maskCustomerName('김상호'), '김*호', 'The internal RAW mask must not become the stronger display mask')
assert.equal(customerDisplayLabel({ customerName: '김상우', phoneLast4: '010-1234-7188' }), '김** / 7188')
assert.equal(customerDisplayLabel({ customerName: '', phoneLast4: '' }), '미입력 / 미입력')

const sameSuffixDifferentCustomers = [
  { customerName: '김*호', phoneLast4: '7188' },
  { customerName: '김*우', phoneLast4: '7188' },
]
assert.equal(customerDisplayLabel(sameSuffixDifferentCustomers[0]), customerDisplayLabel(sameSuffixDifferentCustomers[1]))
assert.notEqual(customerIdentityKey(sameSuffixDifferentCustomers[0].customerName, sameSuffixDifferentCustomers[0].phoneLast4), customerIdentityKey(sameSuffixDifferentCustomers[1].customerName, sameSuffixDifferentCustomers[1].phoneLast4), 'Same surname and suffix must not collapse existing internal customer matching keys')

console.log('customerDisplay: display-only name masking, Unicode, safe phone suffixes, idempotence and unchanged RAW matching passed')
