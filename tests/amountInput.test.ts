import assert from 'node:assert/strict'
import { formatAmountInput, parseAmountInput } from '../src/lib/amountInput.ts'

const validCases: [string, number | undefined][] = [
  ['', undefined],
  ['   ', undefined],
  ['0', 0],
  ['0000', 0],
  ['00012', 12],
  ['1234', 1234],
  ['1,234', 1234],
  [' 1,234 ', 1234],
  ['1 234', 1234],
  ['₩1,234', 1234],
  ['1,234원', 1234],
  [' ₩ 12,345 원 ', 12345],
]
for (const [text, value] of validCases) {
  assert.deepEqual(parseAmountInput(text), { valid: true, value }, text)
}

for (const text of ['-1', '-0', '+1', '1.0', '0.5', '1e3', '1E3', 'abc', '1abc', 'Infinity', 'NaN', '1/2', '12₩x', '１２３']) {
  assert.deepEqual(parseAmountInput(text), { valid: false }, text)
}

assert.deepEqual(parseAmountInput('9,007,199,254,740,991원'), { valid: true, value: Number.MAX_SAFE_INTEGER })
assert.deepEqual(parseAmountInput('9007199254740992'), { valid: false })
assert.deepEqual(parseAmountInput('999999999999999999999999999999999999999999999999'), { valid: false })
assert.deepEqual(parseAmountInput('₩ 원, \t\n'), { valid: true, value: undefined })

const formatCases: [number | undefined, string][] = [
  [undefined, ''],
  [0, '0'],
  [1, '1'],
  [999, '999'],
  [1000, '1,000'],
  [123456789, '123,456,789'],
  [Number.MAX_SAFE_INTEGER, '9,007,199,254,740,991'],
  [-1, ''],
  [1.5, ''],
  [Number.NaN, ''],
  [Number.POSITIVE_INFINITY, ''],
  [Number.MAX_SAFE_INTEGER + 1, ''],
]
for (const [value, text] of formatCases) assert.equal(formatAmountInput(value), text)
assert.equal(formatAmountInput(null as unknown as number), '')
assert.equal(formatAmountInput('1234' as unknown as number), '')

const stored = { amount: 1234567 }
assert.equal(formatAmountInput(stored.amount), '1,234,567')
assert.equal(stored.amount, 1234567, 'Formatting must not change the stored numeric amount')
for (const value of [0, 1, 1234, 123456789, Number.MAX_SAFE_INTEGER]) {
  assert.deepEqual(parseAmountInput(formatAmountInput(value)), { valid: true, value }, 'Display formatting must round-trip to the same whole-won value')
}

console.log('amountInput: whole-won formatting, optional inputs, decorations, invalid text and safe-integer boundaries passed')
