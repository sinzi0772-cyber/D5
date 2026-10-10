import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// This tool does not publish rules, deploy websites, reset credentials, or write
// original customer documents. The exact reviewed rules must already be live.
const PROJECT_ID = 'd5-partner-desk'
const LOGIN_ID = 'E90227'
const EMAIL = 'e90227@d5.local'
const USER_ID = 'partner-iwedding-e90227'
const PARTNER_ID = 'iwedding'
const PARTNER_NAME = '(주)아이패밀리에스씨'
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const privateRoot = realpathSync(resolve(workspace, 'private-output'))
const database = `projects/${PROJECT_ID}/databases/(default)`
const documents = `${database}/documents`
const profilePath = `${documents}/profiles/${USER_ID}`
const publicationPath = `${documents}/partnerViews/${PARTNER_ID}`
const sourcePath = `${documents}/adminSources/septemberAppointments`
const releaseName = `projects/${PROJECT_ID}/releases/cloud.firestore`
const profileMask = ['active', 'approved', 'provisioningStage', 'updatedAt']
const requestOptions = { skipLog: { body: true, resBody: true, queryParams: true }, resolveOnHTTPError: true, timeout: 30_000 }

class ActivationError extends Error {
  constructor(code, details = {}) { super(code); this.code = code; this.details = details }
}

function privatePath(value) {
  const path = realpathSync(resolve(workspace, value))
  const child = relative(privateRoot, path)
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new ActivationError('MODULE_OUTSIDE_PRIVATE_OUTPUT')
  return path
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') throw new ActivationError('INVALID_FIRESTORE_VALUE')
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value || 'doubleValue' in value) {
    const number = Number(value.integerValue ?? value.doubleValue)
    if (!Number.isFinite(number) || ('integerValue' in value && !Number.isSafeInteger(number))) throw new ActivationError('INVALID_FIRESTORE_NUMBER')
    return number
  }
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
  throw new ActivationError('UNSUPPORTED_FIRESTORE_VALUE')
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function assertCompanyProfile(profile) {
  const allowed = ['role', 'active', 'approved', 'loginId', 'partnerId', 'partnerName', 'displayName', 'mustChangePassword', 'createdAt', 'updatedAt', 'provisioningStage', 'passwordChangedAt']
  if (!profile || Object.keys(profile).some(key => !allowed.includes(key))
    || profile.role !== 'partner' || profile.loginId !== LOGIN_ID || profile.partnerId !== PARTNER_ID || profile.partnerName !== PARTNER_NAME
    || profile.displayName !== PARTNER_NAME || typeof profile.mustChangePassword !== 'boolean'
    || typeof profile.active !== 'boolean' || typeof profile.approved !== 'boolean') throw new ActivationError('PROFILE_NOT_EXACT_APPROVED_COMPANY_MAPPING')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !['--inspect', '--activate'].includes(args[0])) throw new ActivationError('ONE_EXPLICIT_MODE_REQUIRED')
  const mode = args[0].slice(2)
  if (process.env.FIREBASE_TOKEN || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) throw new ActivationError('ONLY_APPROVED_OFFICIAL_GOOGLE_LOGIN_ALLOWED')
  const requireLocal = createRequire(import.meta.url)
  const toolsPath = privatePath('private-output/firebase-admin-tools/node_modules/firebase-tools')
  const requireTools = createRequire(resolve(toolsPath, 'package.json'))
  if (requireTools('./package.json').version !== '15.33.0') throw new ActivationError('UNREVIEWED_FIREBASE_TOOLS_VERSION')
  const { logger } = requireTools('./lib/logger.js')
  logger.clear(); logger.silent = true
  for (const method of ['log', 'debug', 'info', 'warn', 'error']) logger[method] = () => undefined
  const { getGlobalDefaultAccount } = requireTools('./lib/auth.js')
  const { requireAuth } = requireTools('./lib/requireAuth.js')
  const { Client } = requireTools('./lib/apiv2.js')
  const account = getGlobalDefaultAccount()
  if (!account?.user || !account.tokens) throw new ActivationError('OFFICIAL_ADMIN_LOGIN_REQUIRED')
  await requireAuth({ project: PROJECT_ID, user: account.user, tokens: account.tokens, nonInteractive: true }, true)
  const { parsePartnerPublication } = requireLocal(privatePath('private-output/partner-publication.verify.cjs'))
  const { parseSeptemberSource } = requireLocal(privatePath('private-output/lead-document.verify.cjs'))
  if (typeof parsePartnerPublication !== 'function' || typeof parseSeptemberSource !== 'function') throw new ActivationError('REVIEWED_PARSE_MODULES_REQUIRED')
  const normalizeRules = value => value.replace(/\r\n/g, '\n')
  const expectedRules = normalizeRules(readFileSync(resolve(workspace, 'firestore.rules'), 'utf8'))
  if (!expectedRules || Buffer.byteLength(expectedRules, 'utf8') > 250_000) throw new ActivationError('REVIEWED_LOCAL_RULES_REQUIRED')
  const rulesHash = createHash('sha256').update(expectedRules).digest('hex')
  const authClient = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', auth: true })
  const firestoreClient = new Client({ urlPrefix: 'https://firestore.googleapis.com', auth: true })
  const rulesClient = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', auth: true })
  const resourceClient = new Client({ urlPrefix: 'https://cloudresourcemanager.googleapis.com', auth: true })

  async function request(client, method, path, body) {
    const result = method === 'get' ? await client.get(path, { ...requestOptions }) : await client.post(path, body, { ...requestOptions })
    if (result.status < 200 || result.status >= 300) throw new ActivationError('SCOPED_API_REQUEST_FAILED', { httpStatus: result.status })
    return result.body
  }
  const permissions = ['firebaseauth.users.get', 'firebaseauth.users.update', 'datastore.entities.get', 'datastore.entities.update', 'firebaserules.releases.get', 'firebaserules.rulesets.get']
  const permissionResult = await request(resourceClient, 'post', `/v1/projects/${PROJECT_ID}:testIamPermissions`, { permissions })
  if (!permissions.every(permission => permissionResult.permissions?.includes(permission))) throw new ActivationError('TARGET_PROJECT_ACTIVATION_PERMISSIONS_REQUIRED')

  async function verifyLiveRules() {
    const release = await request(rulesClient, 'get', `/v1/${releaseName}`)
    if (release.name !== releaseName || typeof release.rulesetName !== 'string' || !release.rulesetName.startsWith(`projects/${PROJECT_ID}/rulesets/`) || !/^[A-Za-z0-9_-]+$/.test(release.rulesetName.split('/').at(-1))) throw new ActivationError('LIVE_RULES_RELEASE_NOT_EXACT')
    const ruleset = await request(rulesClient, 'get', `/v1/${release.rulesetName}`)
    const files = ruleset.source?.files
    if (ruleset.name !== release.rulesetName || !Array.isArray(files) || files.length !== 1 || files[0].name !== 'firestore.rules' || typeof files[0].content !== 'string'
      || normalizeRules(files[0].content) !== expectedRules) throw new ActivationError('LIVE_RULES_DO_NOT_MATCH_REVIEWED_LOCAL_RULES')
    return release.rulesetName
  }
  async function lookup() {
    const result = await request(authClient, 'post', `/v1/projects/${PROJECT_ID}/accounts:lookup`, { localId: [USER_ID] })
    const users = result.users
    if (!Array.isArray(users) || users.length !== 1 || users[0].localId !== USER_ID || users[0].email !== EMAIL
      || (Object.hasOwn(users[0], 'disabled') && typeof users[0].disabled !== 'boolean')) throw new ActivationError('AUTH_ACCOUNT_NOT_EXACT')
    // Like the official Admin SDK UserRecord, an omitted default false is an
    // enabled account. Staging still requires an explicit true before writes.
    return { ...users[0], disabled: users[0].disabled === true }
  }
  async function getDocument(path) {
    const result = await request(firestoreClient, 'get', `/v1/${path}`)
    if (result.name !== path || typeof result.updateTime !== 'string' || !result.updateTime) throw new ActivationError('DOCUMENT_PRECONDITION_NOT_EXACT')
    return { document: result, data: decodeFields(result.fields || {}) }
  }
  const [authAccount, savedProfile, savedPublication, savedSource, initialRuleset] = await Promise.all([
    lookup(), getDocument(profilePath), getDocument(publicationPath), getDocument(sourcePath), verifyLiveRules(),
  ])
  assertCompanyProfile(savedProfile.data)
  const publication = parsePartnerPublication(savedPublication.data, PARTNER_ID)
  const sources = parseSeptemberSource(savedSource.data)
  if (!publication || !sources || sources.length !== 141) throw new ActivationError('PREPARED_COMPANY_PUBLICATION_OR_SOURCE_INVALID')
  const alreadyActive = savedProfile.data.active === true && savedProfile.data.approved === true && authAccount.disabled === false
  const stagedInactive = savedProfile.data.active === false && savedProfile.data.approved === false && savedProfile.data.mustChangePassword === true && savedProfile.data.provisioningStage === 'prepared-inactive' && authAccount.disabled === true
  if (!alreadyActive && !stagedInactive) throw new ActivationError('ACCOUNT_STATE_NOT_COMPATIBLE_NO_CHANGES_MADE')
  const summary = {
    mode, projectId: PROJECT_ID, loginId: LOGIN_ID, partnerId: PARTNER_ID,
    liveRulesMatch: true, reviewedRulesHash: rulesHash,
    companyCustomerCount: publication.months.reduce((count, month) => count + month.customerCount, 0), sourceRowCount: sources.length,
    alreadyActive, rawReferralWrites: 0, staffAccountWrites: 0, sourceWrites: 0, publicationWrites: 0,
    passwordResets: 0, rulesWrites: 0, websiteDeployments: 0,
  }
  if (mode === 'inspect' || alreadyActive) {
    console.log(JSON.stringify({ ...summary, writes: 0, accountActivated: alreadyActive, readyToActivate: stagedInactive }))
    return
  }

  let expectedActiveProfile = null
  let activeProfile = null
  async function updateProfileFlags(before, active, approved, provisioningStage) {
    const patch = { active, approved, provisioningStage, updatedAt: new Date().toISOString() }
    if (active && approved) expectedActiveProfile = { ...before.data, ...patch }
    const fields = {
      active: { booleanValue: active }, approved: { booleanValue: approved },
      provisioningStage: { stringValue: provisioningStage }, updatedAt: { stringValue: patch.updatedAt },
    }
    const result = await request(firestoreClient, 'post', `/v1/${database}/documents:commit`, {
      writes: [{ update: { name: profilePath, fields }, updateMask: { fieldPaths: profileMask }, currentDocument: { updateTime: before.document.updateTime } }],
    })
    if (!Array.isArray(result.writeResults) || result.writeResults.length !== 1) throw new ActivationError('PROFILE_COMMIT_NOT_CONFIRMED')
    const readback = await getDocument(profilePath)
    const expected = { ...before.data, ...patch }
    assertCompanyProfile(readback.data)
    if (stableJson(readback.data) !== stableJson(expected)) throw new ActivationError('PROFILE_READBACK_NOT_EXACT')
    return readback
  }

  // The profile becomes ready while Auth remains disabled. This cannot issue a
  // login session. Enabling Auth is deliberately the final mutation.
  if (await verifyLiveRules() !== initialRuleset) throw new ActivationError('LIVE_RULES_CHANGED_DURING_INSPECTION')
  let profileRolledBack = false
  async function rollbackOnlyWhenVerifiedDisabled() {
    const currentAuth = await lookup()
    if (currentAuth.disabled !== true) return false
    const currentProfile = await getDocument(profilePath)
    assertCompanyProfile(currentProfile.data)
    if (currentProfile.data.active === false && currentProfile.data.approved === false && currentProfile.data.mustChangePassword === true && currentProfile.data.provisioningStage === 'prepared-inactive') return true
    const expected = activeProfile?.data || expectedActiveProfile
    if (!expected || stableJson(currentProfile.data) !== stableJson(expected)
      || (activeProfile && currentProfile.document.updateTime !== activeProfile.document.updateTime)) throw new ActivationError('PROFILE_CHANGED_ROLLBACK_REQUIRES_REVIEW')
    await updateProfileFlags(currentProfile, false, false, 'prepared-inactive')
    profileRolledBack = true
    return true
  }
  try {
    activeProfile = await updateProfileFlags(savedProfile, true, true, 'active')
    if (await verifyLiveRules() !== initialRuleset) throw new ActivationError('LIVE_RULES_CHANGED_BEFORE_AUTH_ENABLE')
    const stillDisabled = await lookup()
    if (stillDisabled.disabled !== true) throw new ActivationError('AUTH_ACCOUNT_CHANGED_BEFORE_ENABLE')
    const currentProfile = await getDocument(profilePath)
    if (currentProfile.document.updateTime !== activeProfile.document.updateTime || stableJson(currentProfile.data) !== stableJson(activeProfile.data)) throw new ActivationError('PROFILE_CHANGED_BEFORE_AUTH_ENABLE')
    try {
      const enabled = await request(authClient, 'post', `/v1/projects/${PROJECT_ID}/accounts:update`, { localId: USER_ID, disableUser: false })
      if (enabled.localId !== USER_ID) throw new ActivationError('AUTH_ENABLE_RESPONSE_NOT_EXACT')
    } catch (error) {
      // Resolve a lost response by lookup only. Never reset credentials or
      // blindly repeat the mutation when the account state is unknown.
      const recovered = await lookup()
      if (recovered.disabled !== false) throw error
    }
    const finalAuth = await lookup()
    if (finalAuth.disabled !== false) throw new ActivationError('AUTH_ENABLE_NOT_CONFIRMED')
    const finalProfile = await getDocument(profilePath)
    assertCompanyProfile(finalProfile.data)
    if (stableJson(finalProfile.data) !== stableJson(activeProfile.data)) throw new ActivationError('FINAL_PROFILE_CHANGED_REVIEW_REQUIRED')
    await verifyLiveRules()
    console.log(JSON.stringify({ ...summary, profileDocumentWrites: 1, authEnableWrites: 1, accountActivated: true, mustChangePassword: true, readbackVerified: true }))
  } catch (error) {
    try {
      if (!await rollbackOnlyWhenVerifiedDisabled()) throw new ActivationError('AUTH_STATE_ENABLED_OR_UNKNOWN_NO_AUTOMATIC_ROLLBACK')
    } catch {
      throw new ActivationError('ACTIVATION_STATE_REQUIRES_ADMIN_REVIEW_NO_WIDE_WRITES', { profileRolledBack })
    }
    throw new ActivationError(error instanceof ActivationError ? error.code : 'AUTH_ENABLE_FAILED', { profileRolledBack, accountActivated: false })
  }
}

main().catch(error => {
  const safe = error instanceof ActivationError ? { error: error.code, ...error.details } : { error: 'ACTIVATION_FAILED_NO_SECRET_DETAILS_LOGGED' }
  console.error(JSON.stringify({ ...safe, projectId: PROJECT_ID, loginId: LOGIN_ID }))
  process.exitCode = 1
})
