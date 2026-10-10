import assert from 'node:assert/strict'
import { accountAccessError, checkedPartnerIdentity, SHARED_ACCOUNT_EMPLOYEE_NO, SHARED_ACCOUNT_MESSAGE } from '../src/lib/accountAccess.ts'
import { PARTNER_ACCOUNTS } from '../src/lib/partnerIdentity.ts'

const employeeNo = '13783'
const approvedProfile = { employeeNo, displayName: '테스트 직원', role: 'manager' }

assert.equal(SHARED_ACCOUNT_EMPLOYEE_NO, '1292')
assert.equal(SHARED_ACCOUNT_MESSAGE, '사용할 수 없는 계정입니다. 본인 ID로 로그인해주세요.')
assert.doesNotMatch(SHARED_ACCOUNT_MESSAGE, /1292|공용/, 'Login guidance must not mention the retired account')
assert.equal(accountAccessError('1292'), SHARED_ACCOUNT_MESSAGE, 'The shared account is denied before profile lookup')
assert.equal(accountAccessError('1292', { employeeNo: '1292', role: 'admin', active: true, approved: true }), SHARED_ACCOUNT_MESSAGE, 'No role or active flag can reactivate the shared account')
assert.equal(accountAccessError('1292', approvedProfile), SHARED_ACCOUNT_MESSAGE)
assert.match(accountAccessError(employeeNo) || '', /승인된 직원 정보가 없습니다/)
assert.match(accountAccessError(employeeNo, {}) || '', /일치하지 않습니다/)
assert.match(accountAccessError(employeeNo, { ...approvedProfile, employeeNo: '19447' }) || '', /일치하지 않습니다/)
assert.match(accountAccessError(employeeNo, { ...approvedProfile, employeeNo: 13783 }) || '', /일치하지 않습니다/, 'Employee numbers must match exactly, without numeric coercion')
assert.match(accountAccessError(employeeNo, { ...approvedProfile, employeeNo: ' 13783 ' }) || '', /일치하지 않습니다/)

for (const role of ['admin', 'store_manager', 'assistant_manager', 'manager']) {
  const profile = Object.freeze({ ...approvedProfile, role })
  assert.equal(accountAccessError(employeeNo, profile), null, `An approved legacy ${role} needs no new active flags`)
  assert.equal(profile.role, role, 'Validation must preserve the server-provided role')
  assert.equal(accountAccessError(employeeNo, { ...profile, disabled: false, active: true, approved: true, status: 'active' }), null)
}

for (const role of [undefined, null, '', '매니저', 'owner', 'demo', 1, ['manager']]) {
  assert.match(accountAccessError(employeeNo, { ...approvedProfile, role }) || '', /승인된 직원 권한이 없습니다/)
}

for (const blockedFields of [
  { disabled: true },
  { active: false },
  { approved: false },
  { status: 'inactive' },
  { status: 'disabled' },
  { status: 'suspended' },
]) {
  assert.match(accountAccessError(employeeNo, { ...approvedProfile, ...blockedFields }) || '', /사용이 중지된 계정/)
  assert.match(accountAccessError(employeeNo, { ...approvedProfile, role: 'admin', ...blockedFields }) || '', /사용이 중지된 계정/, 'Privileged roles cannot bypass account suspension')
}

const firstLoginProfile = Object.freeze({ ...approvedProfile, mustChangePassword: true })
assert.equal(accountAccessError(employeeNo, firstLoginProfile), null, 'An approved account can proceed to the separate first-login password flow')
assert.equal(firstLoginProfile.mustChangePassword, true, 'Validation must not clear the password-change requirement')
assert.deepEqual(approvedProfile, { employeeNo, displayName: '테스트 직원', role: 'manager' }, 'Validation must not alter approval data')

const partnerIdentity = PARTNER_ACCOUNTS.iwedding
assert.deepEqual(partnerIdentity, { loginId: 'E90227', partnerId: 'iwedding', partnerName: '(주)아이패밀리에스씨' })
assert.equal(Object.isFrozen(PARTNER_ACCOUNTS), true)
assert.equal(Object.isFrozen(partnerIdentity), true)
const partnerProfile = Object.freeze({ ...partnerIdentity, role: 'partner', active: true, approved: true, mustChangePassword: true })
const partnerBefore = JSON.stringify(partnerProfile)
assert.equal(accountAccessError('E90227', partnerProfile), null, 'Only the explicitly approved and active company profile may enter the separate partner flow')
assert.strictEqual(checkedPartnerIdentity('E90227', partnerProfile), partnerIdentity, 'Validated identity is the immutable trusted mapping, not arbitrary profile fields')
assert.equal(Object.prototype.hasOwnProperty.call(partnerProfile, 'employeeNo'), false, 'Company access does not require or derive a staff employee number')
assert.equal(partnerProfile.mustChangePassword, true, 'The separate first-login password requirement remains set')
assert.deepEqual(Object.keys(checkedPartnerIdentity('E90227', partnerProfile)!).sort(), ['loginId', 'partnerId', 'partnerName'], 'Identity output contains only the three approved tenant fields')

for (const changes of [
  { loginId: undefined }, { loginId: 'e90227' }, { loginId: ' E90227 ' }, { loginId: 'E90228' }, { loginId: 90227 },
  { partnerId: undefined }, { partnerId: '' }, { partnerId: 'IWEDDING' }, { partnerId: 'iwedding ' }, { partnerId: 'other-company' },
  { partnerId: '__proto__' }, { partnerId: 'constructor' }, { partnerId: 'toString' },
  { partnerName: undefined }, { partnerName: '아이웨딩' }, { partnerName: '아이패밀리에스씨' },
  { partnerName: '(주)아이패밀리에스씨 ' }, { partnerName: '(주)아이패밀리에스씨협력업체' },
  { active: undefined }, { active: 'true' }, { active: 1 },
  { approved: undefined }, { approved: 'true' }, { approved: 1 },
]) {
  const invalid = { ...partnerProfile, ...changes }
  assert.equal(checkedPartnerIdentity('E90227', invalid), null, 'Missing, coerced, unknown or noncanonical company fields must fail closed')
  assert.match(accountAccessError('E90227', invalid) || '', /승인된 업체 계정 정보가 일치하지 않습니다/)
}
for (const loginId of ['e90227', ' E90227 ', 'E90228', '90227', '', 'QA12345']) {
  assert.equal(checkedPartnerIdentity(loginId, partnerProfile), null, 'Login identity must match exact normalized uppercase approved ID')
  assert.notEqual(accountAccessError(loginId, partnerProfile), null)
}
assert.equal(checkedPartnerIdentity('E90227'), null)
assert.equal(checkedPartnerIdentity('E90227', { ...partnerProfile, loginId: undefined, employeeNo: 'E90227' }), null, 'Staff employeeNo must not substitute for an approved partner loginId')
assert.strictEqual(checkedPartnerIdentity('E90227', { ...partnerProfile, employeeNo: 'unused-staff-field' }), partnerIdentity, 'Unused employeeNo cannot alter the trusted partner identity')

for (const blockedFields of [
  { disabled: true }, { active: false }, { approved: false },
  { status: 'inactive' }, { status: 'disabled' }, { status: 'suspended' },
]) {
  const stoppedPartner = { ...partnerProfile, ...blockedFields }
  assert.equal(checkedPartnerIdentity('E90227', stoppedPartner), null)
  assert.match(accountAccessError('E90227', stoppedPartner) || '', /사용이 중지된 계정/, 'Staged or suspended company profiles must not be activated by a local validator')
}
assert.equal(accountAccessError('E90227', { ...partnerProfile, disabled: false, status: 'active' }), null)
for (const role of ['admin', 'store_manager', 'assistant_manager', 'manager', 'company', '', undefined]) {
  assert.equal(checkedPartnerIdentity('E90227', { ...partnerProfile, role }), null, 'Staff and unknown roles never produce a company identity')
}
assert.equal(accountAccessError(SHARED_ACCOUNT_EMPLOYEE_NO, partnerProfile), SHARED_ACCOUNT_MESSAGE, 'A company profile cannot bypass retired-account denial')
assert.equal(JSON.stringify(partnerProfile), partnerBefore, 'Company validation does not change approval, activation, mapping or password-change flags')
assert.deepEqual(PARTNER_ACCOUNTS.iwedding, { loginId: 'E90227', partnerId: 'iwedding', partnerName: '(주)아이패밀리에스씨' })

console.log('accountAccess: exact approved partner identity and staged rejection, shared account denial, unchanged staff roles, inactive flags and immutable profiles passed')
