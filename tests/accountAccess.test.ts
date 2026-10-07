import assert from 'node:assert/strict'
import { accountAccessError, SHARED_ACCOUNT_EMPLOYEE_NO, SHARED_ACCOUNT_MESSAGE } from '../src/lib/accountAccess.ts'

const employeeNo = '13783'
const approvedProfile = { employeeNo, displayName: '테스트 직원', role: 'manager' }

assert.equal(SHARED_ACCOUNT_EMPLOYEE_NO, '1292')
assert.equal(SHARED_ACCOUNT_MESSAGE, '사용할 수 없는 계정입니다. 본인 사번으로 로그인해주세요.')
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

console.log('accountAccess: shared account denial, exact identity, server-approved roles, inactive flags and immutable legacy profiles passed')
