import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { getCaseSharingAccessToken, verifyFirebaseIdToken } from '../server/case-sharing/identity.ts'

const project = 'd5-partner-desk'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const exported = publicKey.export({ format: 'pem', type: 'spki' }).toString()
const now = Math.floor(Date.now() / 1000)
const email = 'test@example.invalid'
const uid = 'synthetic-staff-1'

function jwt(claims: Record<string, unknown>, header = { alg: 'RS256', kid: 'synthetic-key' }) {
  const input = [header, claims].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
  return input + '.' + sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')
}

const authClaims = { sub: uid, email, aud: project, iss: 'https://securetoken.google.com/' + project, iat: now - 100, exp: now + 100, auth_time: now - 120 }
const firebaseToken = jwt(authClaims)
const requests: string[] = []
const verifiedUser = { localId: uid, email, validSince: String(authClaims.auth_time), disabled: false }
const authFetch = (user: Record<string, unknown> = verifiedUser, lookupStatus = 200): typeof fetch => async (url, options) => {
  const target = new URL(String(url))
  requests.push(target.pathname)
  if (target.hostname === 'www.googleapis.com') return Response.json({ 'synthetic-key': exported })
  assert.equal(target.hostname, 'identitytoolkit.googleapis.com')
  assert.equal(target.pathname, '/v1/accounts:lookup')
  assert(target.searchParams.get('key'))
  assert.equal(JSON.parse(String(options?.body)).idToken, firebaseToken)
  return Response.json(lookupStatus === 200 ? { users: [user] } : user, { status: lookupStatus })
}

assert.deepEqual(await verifyFirebaseIdToken(firebaseToken, authFetch()), { uid, email })
assert.deepEqual(requests, ['/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', '/v1/accounts:lookup'])
requests.length = 0
await assert.rejects(verifyFirebaseIdToken(jwt({ ...authClaims, aud: 'another-project' }), authFetch()), { code: 'INVALID_AUTH' })
await assert.rejects(verifyFirebaseIdToken(jwt({ ...authClaims, exp: now - 1 }), authFetch()), { code: 'INVALID_AUTH' })
await assert.rejects(verifyFirebaseIdToken(jwt(authClaims, { alg: 'HS256', kid: 'synthetic-key' }), authFetch()), { code: 'INVALID_AUTH' })
assert.deepEqual(requests, [])
const [header, claims, signature] = firebaseToken.split('.')
const invalidSignature = (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1)
await assert.rejects(verifyFirebaseIdToken([header, claims, invalidSignature].join('.'), authFetch()), { code: 'INVALID_AUTH' })
assert.deepEqual(requests, ['/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'])
await assert.rejects(verifyFirebaseIdToken(firebaseToken, authFetch({ ...verifiedUser, validSince: String(now - 1) })), { code: 'INVALID_AUTH' })
await assert.rejects(verifyFirebaseIdToken(firebaseToken, authFetch({ ...verifiedUser, disabled: true })), { code: 'INVALID_AUTH' })
await assert.rejects(verifyFirebaseIdToken(firebaseToken, authFetch({ ...verifiedUser, email: 'other@example.invalid' })), { code: 'INVALID_AUTH' })
await assert.rejects(verifyFirebaseIdToken(firebaseToken, authFetch({ error: { message: 'USER_DISABLED' } }, 400)), { code: 'INVALID_AUTH' })
await assert.rejects(verifyFirebaseIdToken(firebaseToken, authFetch({ error: { message: 'service down' } }, 503)), { code: 'FIREBASE_AUTH_UNAVAILABLE' })

const team = 'sinzi0772-5729s-projects'
const oidcClaims = {
  iss: 'https://oidc.vercel.com/' + team,
  aud: 'https://vercel.com/' + team,
  sub: 'owner:' + team + ':project:' + project + ':environment:production',
  environment: 'production',
  owner_id: 'team_3JwHqeu7Kcsp7Luxsx8AmJzu',
  project_id: 'prj_8iB1WkdvXAu51amnWmXthbhvp5UA',
  nbf: now - 1,
  exp: now + 100,
}
const oidcToken = jwt(oidcClaims)
const exchange: typeof fetch = async (url, options) => {
  const target = new URL(String(url))
  const body = JSON.parse(String(options?.body))
  if (target.hostname === 'sts.googleapis.com') {
    assert.equal(target.pathname, '/v1/token')
    assert.equal(body.subjectToken, oidcToken)
    assert.equal(body.audience, '//iam.googleapis.com/projects/336806163815/locations/global/workloadIdentityPools/d5-case-save-prod/providers/vercel-d5-prod')
    return Response.json({ access_token: 'test-federated-token' })
  }
  assert.equal(target.hostname, 'iamcredentials.googleapis.com')
  assert.equal(target.pathname, '/v1/projects/-/serviceAccounts/d5-case-save@d5-partner-desk.iam.gserviceaccount.com:generateAccessToken')
  assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-federated-token')
  assert.deepEqual(body, { scope: ['https://www.googleapis.com/auth/datastore'], lifetime: '600s' })
  return Response.json({ accessToken: 'test-datastore-token' })
}
assert.equal(await getCaseSharingAccessToken(oidcToken, exchange), 'test-datastore-token')
for (const claims of [
  { ...oidcClaims, environment: 'preview' },
  { ...oidcClaims, owner_id: 'another-team' },
  { ...oidcClaims, project_id: 'another-project' },
  { ...oidcClaims, iss: 'https://oidc.example.invalid' },
]) {
  let network = false
  await assert.rejects(getCaseSharingAccessToken(jwt(claims), async () => {
    network = true
    throw new Error('unexpected network')
  }), { code: 'WORKLOAD_IDENTITY_UNAVAILABLE' })
  assert.equal(network, false)
}
await assert.rejects(getCaseSharingAccessToken(oidcToken, async () => Response.json({}, { status: 503 })), { code: 'WORKLOAD_IDENTITY_UNAVAILABLE' })
console.log('Firebase signature, account revocation, deployment scoping, and minimal OAuth exchange verified.')
