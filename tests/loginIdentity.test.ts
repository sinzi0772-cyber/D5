import assert from 'node:assert/strict'
import { alternateSameIdPasswordForLogin, firebasePasswordForLogin, loginEmailFor, loginIdInputMessage, normalizeLoginId } from '../src/lib/loginIdentity.ts'
import { accountAccessError, SHARED_ACCOUNT_EMPLOYEE_NO, SHARED_ACCOUNT_MESSAGE } from '../src/lib/accountAccess.ts'

const normalizationCases = Object.freeze([
  ['00042', '00042'], ['1234', '1234'], ['0', '0'],
  ['qa12345', 'QA12345'], ['QA12345', 'QA12345'], ['e00042', 'E00042'],
  ['a1B2c3', 'A1B2C3'], ['  qa_12-345\t\n', 'QA12345'],
  ['e 00-042', 'E00042'], ['한글qa１２123', 'QA123'],
  ['ßKſＱＡ１２', ''], ['ＱqＡa١１1ß', 'QA1'],
  ['', ''], ['  -_@.!\n', ''], ['한글', ''],
] as const)
for (const input of ['e', 'E', 'e00042', 'E00042', 'a1B2c3', '00042', '  qa12345  ']) assert.equal(loginIdInputMessage(input), null)
for (const input of ['', '   ']) assert.match(loginIdInputMessage(input) || '', /ID를 입력/)
for (const input of ['ㄷ90227', '12ㄷ34', '한글', 'ＱＡ123', 'qa-123', 'qa_123', 'qa 123', 'e@d5.local', 'a\nb']) assert.match(loginIdInputMessage(input) || '', /영문과 숫자/, 'Malformed or composing characters cannot be discarded into another account')
assert.equal(loginEmailFor('e00042'), loginEmailFor('E00042'), 'ID letter casing selects exactly the same Firebase identity')
for (const [input, expected] of normalizationCases) {
  assert.equal(normalizeLoginId(input), expected, 'ASCII identity normalization')
  assert.equal(normalizeLoginId(normalizeLoginId(input)), expected, 'Identity normalization is idempotent')
  assert.match(normalizeLoginId(input), /^[A-Z0-9]*$/, 'Non-ASCII symbols must not become accepted ID characters')
}
assert.equal(loginEmailFor('QA12345'), 'qa12345@d5.local', 'Letter prefixes must survive Firebase email creation')
assert.equal(loginEmailFor('e00042'), 'e00042@d5.local', 'Uppercase display identity maps to its lowercase Firebase identity')
assert.equal(loginEmailFor('  QA-12 345 '), 'qa12345@d5.local')
assert.equal(loginEmailFor('00042'), '00042@d5.local', 'Leading zeroes must never be numerically coerced away')
assert.equal(normalizeLoginId('한글!'), '', 'Only rejected characters yield an empty ID for the caller local guard')

// Synthetic fixtures only; no actual staff/account password is used or stored.
const legacyCases = Object.freeze([
  ['1234', '1234', 'D51234'],
  ['00042', '00042', 'D500042'],
  ['0', '0', 'D50'],
  [' 1234 ', '1234', 'D51234'],
  ['1234', 'synthetic-custom-password', 'synthetic-custom-password'],
  ['1234', '1234 ', '1234 '],
  ['1234', 'D51234', 'D51234'],
  ['1234', '42', '42'],
  ['QA12345', 'QA12345', 'QA12345'],
  ['qa12345', 'qa12345', 'qa12345'],
  ['qa12345', 'QA12345', 'QA12345'],
  ['QA12345', '  synthetic custom password  ', '  synthetic custom password  '],
  ['E00042', '00042', '00042'],
  ['QA12345', 'D5QA12345', 'D5QA12345'],
  ['', '', ''],
  ['', 'synthetic-custom-password', 'synthetic-custom-password'],
] as const)
const before = JSON.stringify(legacyCases)
for (const [id, password, expected] of legacyCases) {
  assert.equal(firebasePasswordForLogin(id, password), expected, 'Only numeric same-ID legacy passwords get the compatibility prefix')
}
assert.equal(JSON.stringify(legacyCases), before, 'Identity helpers never mutate input fixtures')

const temporaryCases = [
  ['E00042', 'E00042', 'e00042'],
  ['E00042', 'e00042', 'E00042'],
  ['e00042', 'e00042', 'E00042'],
  ['E000421', 'e000421', 'E000421'],
  ['E00042', 'e00043', undefined],
  ['E00042', 'e00042 ', undefined],
  ['E00042', 'e00042\n', undefined],
  ['E00042', 'ｅ00042', undefined],
  ['E00042', 'Synthetic-Custom-Case09', undefined],
  ['QA12345', 'qa12345', undefined],
  ['00042', '00042', undefined],
] as const
for (const [id, password, expected] of temporaryCases) {
  assert.equal(alternateSameIdPasswordForLogin(id, password), expected)
}
assert.equal(firebasePasswordForLogin('E00042', 'e00042'), 'e00042', 'Try the original password first')

for (const role of ['admin', 'store_manager', 'assistant_manager', 'manager']) {
  const profile = Object.freeze({ employeeNo: 'QA12345', role, approved: true })
  assert.equal(accountAccessError(normalizeLoginId('qa12345'), profile), null, 'Existing server-approved staff roles retain exact identity validation')
  assert.deepEqual(profile, { employeeNo: 'QA12345', role, approved: true }, 'No account approval or role may be changed by identity helpers')
}
for (const role of ['partner', 'owner', 'company', '']) {
  assert.match(accountAccessError('QA12345', { employeeNo: 'QA12345', role }) || '', /승인된 (직원 권한|업체 계정 정보)/, 'Alphanumeric support alone must not add partner/company authorization')
}
assert.match(accountAccessError('QA12345') || '', /승인된 직원 정보가 없습니다/, 'An ID format alone cannot create or approve an account')
assert.match(accountAccessError('QA12345', { employeeNo: '12345', role: 'manager' }) || '', /일치하지 않습니다/, 'Letter prefixes cannot be silently dropped during profile approval')
assert.equal(accountAccessError(normalizeLoginId(SHARED_ACCOUNT_EMPLOYEE_NO)), SHARED_ACCOUNT_MESSAGE, 'The retired numeric shared account remains blocked')

console.log('Login identity: ASCII IDs, leading zeroes, numeric legacy prefix, legacy same-ID ASCII casing, exact custom passwords and unchanged staff approval guards passed.')
