import assert from 'node:assert/strict'
import { loginFailureFor } from '../src/lib/loginError'

const credentials = 'ID 또는 비밀번호를 확인해주세요. 비밀번호는 대소문자를 구분합니다.'
for (const code of ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email']) {
  assert.deepEqual(loginFailureFor({ code }), { message: credentials, code })
}
assert.deepEqual(loginFailureFor({ code: 'auth/user-disabled' }), { message: '사용이 중지된 계정입니다. 관리자에게 문의해주세요.', code: 'auth/user-disabled' })
for (const code of ['auth/network-request-failed', 'auth/timeout']) {
  const failure = loginFailureFor({ code })
  assert.match(failure.message, /연결/)
  assert.doesNotMatch(failure.message, /비밀번호/)
  assert.equal(failure.code, code)
}
const rateLimited = loginFailureFor({ code: 'auth/too-many-requests' })
assert.match(rateLimited.message, /추가 시도를 멈추고/)
assert.doesNotMatch(rateLimited.message, /비밀번호/)
assert.equal(rateLimited.code, 'auth/too-many-requests')
for (const code of ['auth/invalid-api-key', 'auth/app-not-authorized', 'auth/operation-not-allowed', 'auth/unauthorized-domain', 'auth/configuration-not-found']) {
  const failure = loginFailureFor({ code })
  assert.match(failure.message, /연결 설정/)
  assert.equal(failure.code, code)
}

const temporary = '로그인을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.'
assert.deepEqual(loginFailureFor({ code: 'auth/unfamiliar-safe-code' }), { message: temporary, code: 'auth/unfamiliar-safe-code' })
assert.equal(loginFailureFor({ code: `auth/${'a'.repeat(64)}` }).code, `auth/${'a'.repeat(64)}`)
for (const code of [undefined, null, 1, ['auth/timeout'], {}, '', 'auth/', 'Auth/timeout', 'auth/TIMEOUT', 'firestore/permission-denied', 'auth/<script>', 'auth/timeout\n', 'auth/timeout\r', 'auth/timeout extra', 'auth/비밀', `auth/${'a'.repeat(65)}`]) {
  assert.deepEqual(loginFailureFor({ code }), { message: temporary }, 'Malformed or foreign codes must not be echoed')
}
for (const error of [undefined, null, 0, true, 'auth/timeout', Symbol('synthetic')]) assert.deepEqual(loginFailureFor(error), { message: temporary })

const syntheticDetails = Object.freeze({ code: 'auth/network-request-failed', message: 'synthetic-secret-value', request: Object.freeze({ body: 'synthetic-private-body' }) })
const before = JSON.stringify(syntheticDetails)
const result = loginFailureFor(syntheticDetails)
assert.equal(JSON.stringify(syntheticDetails), before, 'Classification never changes the provider object or request')
assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|synthetic-private/)
const providerError = Object.assign(new Error('synthetic-untrusted-provider-message'), { code: 'auth/invalid-credential' })
assert.deepEqual(loginFailureFor(providerError), { message: credentials, code: 'auth/invalid-credential' })
const unreadMessage = { code: 'auth/timeout', get message(): never { throw new Error('Message must never be read') } }
assert.equal(loginFailureFor(unreadMessage).code, 'auth/timeout')
const unreadCode = { get code(): never { throw new Error('Unfamiliar code access') } }
assert.deepEqual(loginFailureFor(unreadCode), { message: temporary }, 'A throwing object is safely classified without rethrowing')

console.log('Login error classification: credential, network, rate-limit, configuration, safe-code and non-disclosure tests passed.')
