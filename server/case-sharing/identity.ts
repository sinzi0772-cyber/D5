import { createPublicKey, verify } from 'node:crypto'
import { firebaseProject, firebaseWebApiKey } from '../../src/lib/firebasePublicConfig'

const firebaseIssuer = `https://securetoken.google.com/${firebaseProject}`
const certificatesUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
const vercelTeam = 'sinzi0772-5729s-projects'
const vercelTeamId = 'team_3JwHqeu7Kcsp7Luxsx8AmJzu'
const vercelProjectId = 'prj_8iB1WkdvXAu51amnWmXthbhvp5UA'
const vercelIssuer = 'https://oidc.vercel.com'
const vercelAudience = `https://vercel.com/${vercelTeam}`
const vercelSubject = `owner:${vercelTeam}:project:${firebaseProject}:environment:production`
const identityProvider = '//iam.googleapis.com/projects/336806163815/locations/global/workloadIdentityPools/d5-case-save-prod/providers/vercel-d5-prod'
const serviceAccount = `d5-case-save@${firebaseProject}.iam.gserviceaccount.com`
const impersonationUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateAccessToken`
const jwtFormat = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

type JsonObject = Record<string, unknown>
type IdentityErrorCode = 'INVALID_AUTH' | 'FIREBASE_AUTH_UNAVAILABLE' | 'WORKLOAD_IDENTITY_UNAVAILABLE'

export class CaseSharingIdentityError extends Error {
  readonly code: IdentityErrorCode

  constructor(code: IdentityErrorCode) {
    super(code)
    this.code = code
    this.name = 'CaseSharingIdentityError'
  }
}

const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
const isSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function decodePart(part: string): JsonObject {
  const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  if (!isObject(value)) throw new Error('Invalid JWT object')
  return value
}

function parseJwt(token: unknown, errorCode: IdentityErrorCode) {
  if (typeof token !== 'string' || token.length > 8192 || !jwtFormat.test(token)) throw new CaseSharingIdentityError(errorCode)
  const [header, payload, signature] = token.split('.')
  try {
    const jwtHeader = decodePart(header)
    if (jwtHeader.alg !== 'RS256') throw new Error('Invalid JWT algorithm')
    return { header: jwtHeader, claims: decodePart(payload), input: `${header}.${payload}`, signature }
  } catch {
    throw new CaseSharingIdentityError(errorCode)
  }
}

async function fetchJson(fetchImpl: typeof fetch, url: string, init: RequestInit, errorCode: IdentityErrorCode) {
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(6000) })
    if (!response.ok) throw new Error('Identity request failed')
    const body: unknown = await response.json()
    if (!isObject(body)) throw new Error('Invalid identity response')
    return { response, body }
  } catch {
    throw new CaseSharingIdentityError(errorCode)
  }
}

let firebaseCertificates: { keys: Map<string, string>; expires: number } | undefined
let loadingFirebaseCertificates: Promise<Map<string, string>> | undefined

async function loadFirebaseCertificates(fetchImpl: typeof fetch) {
  const { response, body } = await fetchJson(fetchImpl, certificatesUrl, {}, 'FIREBASE_AUTH_UNAVAILABLE')
  const keys = new Map(Object.entries(body).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  if (!keys.size) throw new CaseSharingIdentityError('FIREBASE_AUTH_UNAVAILABLE')
  if (fetchImpl === fetch) {
    const seconds = Number(response.headers.get('cache-control')?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1] ?? 0)
    const age = Number(response.headers.get('age') ?? 0)
    const lifetime = Math.max(0, Math.min(seconds, 3600) - (Number.isFinite(age) && age > 0 ? age : 0))
    firebaseCertificates = { keys, expires: Date.now() + lifetime * 1000 }
  }
  return keys
}

async function certificatesFor(fetchImpl: typeof fetch) {
  if (fetchImpl !== fetch) return loadFirebaseCertificates(fetchImpl)
  if (firebaseCertificates && firebaseCertificates.expires > Date.now()) return firebaseCertificates.keys
  loadingFirebaseCertificates ??= loadFirebaseCertificates(fetchImpl).finally(() => { loadingFirebaseCertificates = undefined })
  return loadingFirebaseCertificates
}

async function checkFirebaseAccount(token: string, uid: string, email: string, authTime: number, fetchImpl: typeof fetch) {
  const url = new URL('https://identitytoolkit.googleapis.com/v1/accounts:lookup')
  url.searchParams.set('key', firebaseWebApiKey)
  let response: Response
  let body: unknown
  try {
    response = await fetchImpl(url.href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({ idToken: token }),
    })
    body = await response.json()
  } catch {
    throw new CaseSharingIdentityError('FIREBASE_AUTH_UNAVAILABLE')
  }
  if (!response.ok) {
    const error = isObject(body) && isObject(body.error) ? body.error.message : null
    const invalidAccount = typeof error === 'string'
      && /^(?:INVALID_ID_TOKEN|INVALID_USER_TOKEN|TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|CREDENTIAL_TOO_OLD_LOGIN_AGAIN)(?:$|\b)/.test(error)
    throw new CaseSharingIdentityError(invalidAccount ? 'INVALID_AUTH' : 'FIREBASE_AUTH_UNAVAILABLE')
  }

  if (!isObject(body) || !Array.isArray(body.users) || body.users.length !== 1 || !isObject(body.users[0])) {
    throw new CaseSharingIdentityError('INVALID_AUTH')
  }
  const user: JsonObject = body.users[0]
  const validSince = typeof user.validSince === 'string' && /^\d+$/.test(user.validSince) ? Number(user.validSince) : user.validSince
  if (user.localId !== uid || user.email !== email || user.disabled === true
      || validSince !== undefined && (!isSeconds(validSince) || authTime < validSince)) {
    throw new CaseSharingIdentityError('INVALID_AUTH')
  }
}

export async function verifyFirebaseIdToken(token: string, fetchImpl: typeof fetch = fetch): Promise<{ uid: string; email: string }> {
  const { header, claims, input, signature } = parseJwt(token, 'INVALID_AUTH')
  const now = Math.floor(Date.now() / 1000)
  const { sub, aud, iss, exp, iat, auth_time: authTime, nbf, email } = claims
  if (typeof header.kid !== 'string' || !header.kid || header.kid.length > 256
    || iss !== firebaseIssuer || aud !== firebaseProject || typeof sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sub)
    || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)
    || !isSeconds(exp) || exp <= now || !isSeconds(iat) || iat > now || !isSeconds(authTime) || authTime > iat
    || nbf !== undefined && (!isSeconds(nbf) || nbf > now)) throw new CaseSharingIdentityError('INVALID_AUTH')

  const certificate = (await certificatesFor(fetchImpl)).get(header.kid)
  if (!certificate) throw new CaseSharingIdentityError('INVALID_AUTH')

  let valid: boolean
  try {
    valid = verify('RSA-SHA256', Buffer.from(input), createPublicKey(certificate), Buffer.from(signature, 'base64url'))
  } catch {
    throw new CaseSharingIdentityError('FIREBASE_AUTH_UNAVAILABLE')
  }
  if (!valid) throw new CaseSharingIdentityError('INVALID_AUTH')
  await checkFirebaseAccount(token, sub, email, authTime, fetchImpl)
  return { uid: sub, email }
}

function checkedAccessToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_./+~=-]{1,8192}$/.test(value)) {
    throw new CaseSharingIdentityError('WORKLOAD_IDENTITY_UNAVAILABLE')
  }
  return value
}

export async function getCaseSharingAccessToken(oidcToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { claims } = parseJwt(oidcToken, 'WORKLOAD_IDENTITY_UNAVAILABLE')
  const now = Math.floor(Date.now() / 1000)
  if (claims.iss !== vercelIssuer && claims.iss !== `${vercelIssuer}/${vercelTeam}`
    || claims.aud !== vercelAudience || claims.sub !== vercelSubject || claims.owner_id !== vercelTeamId
    || claims.project_id !== vercelProjectId || claims.environment !== 'production'
    || !isSeconds(claims.exp) || claims.exp <= now || !isSeconds(claims.nbf) || claims.nbf > now) {
    throw new CaseSharingIdentityError('WORKLOAD_IDENTITY_UNAVAILABLE')
  }
  // Google STS verifies the signature and repeats the deployment scope checks.
  const federated = await fetchJson(fetchImpl, 'https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      audience: identityProvider,
      subjectToken: oidcToken,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    }),
  }, 'WORKLOAD_IDENTITY_UNAVAILABLE')
  const credentials = await fetchJson(fetchImpl, impersonationUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${checkedAccessToken(federated.body.access_token)}`,
    },
    body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/datastore'], lifetime: '600s' }),
  }, 'WORKLOAD_IDENTITY_UNAVAILABLE')
  return checkedAccessToken(credentials.body.accessToken)
}
