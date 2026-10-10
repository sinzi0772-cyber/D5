import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Deliberately scoped: never enumerate staff accounts or change existing passwords.
const PROJECT_ID = 'd5-partner-desk'
const LOGIN_ID = 'E90227'
const EMAIL = 'e90227@d5.local'
const PARTNER_ID = 'iwedding'
const PARTNER_NAME = '(주)아이패밀리에스씨'
const NEW_UID = 'partner-iwedding-e90227'
const MAX_DOCUMENT_BYTES = 750_000
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const privateRoot = realpathSync(resolve(workspace, 'private-output'))
const database = `projects/${PROJECT_ID}/databases/(default)`
const documents = `${database}/documents`
const quietRequest = { skipLog: { body: true, resBody: true, queryParams: true }, resolveOnHTTPError: true, timeout: 30_000 }

class PreparationError extends Error {
  constructor(code, details = {}) { super(code); this.code = code; this.details = details }
}

function optionsFrom(args) {
  const options = {
    mode: '', passwordStdin: false,
    tools: 'private-output/firebase-admin-tools/node_modules/firebase-tools',
    publicationModule: 'private-output/partner-publication.verify.cjs',
    mapperModule: 'private-output/lead-document.verify.cjs',
    sourceModule: 'private-output/september-source.verify.cjs',
  }
  const paths = { '--firebase-tools': 'tools', '--publication-module': 'publicationModule', '--mapper-module': 'mapperModule', '--source-module': 'sourceModule' }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--inspect' || arg === '--prepare') {
      if (options.mode) throw new PreparationError('ONE_EXPLICIT_MODE_REQUIRED')
      options.mode = arg.slice(2)
    } else if (arg === '--password-stdin') options.passwordStdin = true
    else if (paths[arg]) {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new PreparationError('MISSING_MODULE_PATH')
      options[paths[arg]] = value
    } else throw new PreparationError('UNKNOWN_ARGUMENT')
  }
  if (!options.mode || (options.mode === 'inspect' && options.passwordStdin)) throw new PreparationError('EXPLICIT_SAFE_MODE_REQUIRED')
  return options
}

function privatePath(value) {
  const path = realpathSync(resolve(workspace, value))
  const child = relative(privateRoot, path)
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new PreparationError('MODULE_OUTSIDE_PRIVATE_OUTPUT')
  return path
}

function encodeValue(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFields(value) } }
  throw new PreparationError('UNSUPPORTED_DOCUMENT_VALUE')
}

function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]))
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') throw new PreparationError('INVALID_FIRESTORE_VALUE')
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value || 'doubleValue' in value) {
    const number = Number(value.integerValue ?? value.doubleValue)
    if (!Number.isFinite(number) || ('integerValue' in value && !Number.isSafeInteger(number))) throw new PreparationError('INVALID_FIRESTORE_NUMBER')
    return number
  }
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
  throw new PreparationError('UNSUPPORTED_FIRESTORE_VALUE')
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}

function checkedDocumentSize(value) {
  // REST encoding is larger than the saved document; stay below both budgets.
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_DOCUMENT_BYTES || Buffer.byteLength(JSON.stringify(encodeFields(value)), 'utf8') > 950_000) throw new PreparationError('DOCUMENT_TOO_LARGE')
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function assertStagedProfile(profile) {
  const allowed = ['role', 'active', 'approved', 'loginId', 'partnerId', 'partnerName', 'displayName', 'mustChangePassword', 'createdAt', 'updatedAt', 'provisioningStage']
  if (!profile || typeof profile !== 'object' || Object.keys(profile).some(key => !allowed.includes(key))
    || profile.role !== 'partner' || profile.loginId !== LOGIN_ID || profile.partnerId !== PARTNER_ID || profile.partnerName !== PARTNER_NAME
    || profile.active !== false || profile.approved !== false || profile.mustChangePassword !== true) throw new PreparationError('EXISTING_PROFILE_NOT_APPROVED_INACTIVE_PARTNER')
}

async function readPassword() {
  if (process.stdin.isTTY) throw new PreparationError('PASSWORD_REQUIRES_NON_ECHOED_STDIN')
  const buffers = []
  let length = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > 256) throw new PreparationError('PASSWORD_INPUT_TOO_LONG')
    buffers.push(buffer)
  }
  const joined = Buffer.concat(buffers)
  let password = joined.toString('utf8').replace(/\r?\n$/, '')
  joined.fill(0)
  for (const buffer of buffers) buffer.fill(0)
  if (password.length < 6 || /[\r\n\u0000]/.test(password)) { password = ''; throw new PreparationError('PASSWORD_INPUT_INVALID') }
  return password
}

async function main() {
  const options = optionsFrom(process.argv.slice(2))
  if (process.env.FIREBASE_TOKEN || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) throw new PreparationError('ONLY_APPROVED_OFFICIAL_GOOGLE_LOGIN_ALLOWED')
  const toolsPath = privatePath(options.tools)
  const requireTools = createRequire(resolve(toolsPath, 'package.json'))
  if (requireTools('./package.json').version !== '15.33.0') throw new PreparationError('UNREVIEWED_FIREBASE_TOOLS_VERSION')
  // apiv2 can otherwise log fetch options on network errors, including secrets.
  // Disable every CLI logger path before any authentication or API request.
  const { logger } = requireTools('./lib/logger.js')
  logger.clear()
  logger.silent = true
  for (const method of ['log', 'debug', 'info', 'warn', 'error']) logger[method] = () => undefined
  const { getGlobalDefaultAccount } = requireTools('./lib/auth.js')
  const { requireAuth } = requireTools('./lib/requireAuth.js')
  const { Client } = requireTools('./lib/apiv2.js')
  const account = getGlobalDefaultAccount()
  if (!account?.user || !account.tokens) throw new PreparationError('OFFICIAL_ADMIN_LOGIN_REQUIRED')
  await requireAuth({ project: PROJECT_ID, user: account.user, tokens: account.tokens, nonInteractive: true }, true)

  const requireLocal = createRequire(import.meta.url)
  const publicationModule = requireLocal(privatePath(options.publicationModule))
  const mapperModule = requireLocal(privatePath(options.mapperModule))
  const sourceModule = requireLocal(privatePath(options.sourceModule))
  const { buildPartnerPublication, parsePartnerPublication } = publicationModule
  const { leadFromDocument, parseSeptemberSource } = mapperModule
  if ([buildPartnerPublication, parsePartnerPublication, leadFromDocument, parseSeptemberSource].some(fn => typeof fn !== 'function')) throw new PreparationError('PREPARED_MODULE_EXPORTS_REQUIRED')
  const source = { schemaVersion: 1, sources: sourceModule.septemberAppointments }
  if (!parseSeptemberSource(source)) throw new PreparationError('INVALID_PROTECTED_SOURCE')
  checkedDocumentSize(source)

  const authClient = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', auth: true })
  const firestoreClient = new Client({ urlPrefix: 'https://firestore.googleapis.com', auth: true })
  const resourceClient = new Client({ urlPrefix: 'https://cloudresourcemanager.googleapis.com', auth: true })
  async function request(client, method, path, body, optionalNotFound = false) {
    const result = method === 'get' ? await client.get(path, { ...quietRequest }) : await client.post(path, body, { ...quietRequest })
    if (optionalNotFound && result.status === 404) return null
    if (result.status < 200 || result.status >= 300) throw new PreparationError('SCOPED_API_REQUEST_FAILED', { httpStatus: result.status })
    return result.body
  }
  const requiredPermissions = ['firebaseauth.users.get', 'firebaseauth.users.create', 'datastore.entities.get', 'datastore.entities.list', 'datastore.entities.create', 'datastore.entities.update']
  const permissionResult = await request(resourceClient, 'post', `/v1/projects/${PROJECT_ID}:testIamPermissions`, { permissions: requiredPermissions })
  if (!requiredPermissions.every(permission => permissionResult.permissions?.includes(permission))) throw new PreparationError('TARGET_PROJECT_ADMIN_PERMISSIONS_REQUIRED')

  async function lookup() {
    const body = await request(authClient, 'post', `/v1/projects/${PROJECT_ID}/accounts:lookup`, { email: [EMAIL] })
    const users = body.users || []
    if (!Array.isArray(users) || users.length > 1 || users.some(user => user.email !== EMAIL || typeof user.localId !== 'string')) throw new PreparationError('ACCOUNT_LOOKUP_NOT_EXACT')
    return users[0] || null
  }
  const existingAuth = await lookup()
  const uid = existingAuth?.localId || NEW_UID
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new PreparationError('UNSAFE_ACCOUNT_UID')
  const profilePath = `${documents}/profiles/${uid}`
  const publicationPath = `${documents}/partnerViews/${PARTNER_ID}`
  const sourcePath = `${documents}/adminSources/septemberAppointments`
  const [existingProfile, existingPublication, existingSource] = await Promise.all([
    request(firestoreClient, 'get', `/v1/${profilePath}`, undefined, true),
    request(firestoreClient, 'get', `/v1/${publicationPath}`, undefined, true),
    request(firestoreClient, 'get', `/v1/${sourcePath}`, undefined, true),
  ])
  for (const [document, expectedPath] of [[existingProfile, profilePath], [existingPublication, publicationPath], [existingSource, sourcePath]]) {
    if (document && (document.name !== expectedPath || typeof document.updateTime !== 'string')) throw new PreparationError('DOCUMENT_PRECONDITION_NOT_EXACT')
  }
  if (existingAuth) {
    if (existingAuth.disabled !== true) throw new PreparationError('EXISTING_ACCOUNT_NOT_DISABLED_NO_CHANGES_MADE')
    assertStagedProfile(existingProfile ? decodeFields(existingProfile.fields || {}) : null)
  } else if (existingProfile) throw new PreparationError('EXISTING_PROFILE_WITHOUT_MATCHING_AUTH')
  if (existingPublication && !parsePartnerPublication(decodeFields(existingPublication.fields || {}), PARTNER_ID)) throw new PreparationError('EXISTING_PUBLICATION_NOT_SAFE_FOR_TARGET')
  if (existingSource) {
    const decoded = decodeFields(existingSource.fields || {})
    if (!parseSeptemberSource(decoded) || stableJson(decoded.sources) !== stableJson(source.sources)) throw new PreparationError('EXISTING_PROTECTED_SOURCE_DIFFERS_NO_OVERWRITE')
  }

  const leads = []
  let nextPageToken = ''
  do {
    const query = { pageSize: '1000' }
    if (nextPageToken) query.pageToken = nextPageToken
    const body = await firestoreClient.get(`/v1/${documents}/referrals`, { ...quietRequest, queryParams: query })
    if (body.status !== 200 || !Array.isArray(body.body.documents || [])) throw new PreparationError('REFERRAL_READ_FAILED')
    for (const document of body.body.documents || []) {
      if (typeof document.name !== 'string' || !document.name.startsWith(`${documents}/referrals/`)) throw new PreparationError('REFERRAL_OUTSIDE_TARGET_PROJECT')
      const id = document.name.slice(`${documents}/referrals/`.length)
      if (!id || id.includes('/')) throw new PreparationError('INVALID_REFERRAL_ID')
      leads.push(leadFromDocument(id, decodeFields(document.fields || {})))
      if (leads.length > 20_000) throw new PreparationError('REFERRAL_REVIEW_LIMIT_EXCEEDED')
    }
    nextPageToken = body.body.nextPageToken || ''
  } while (nextPageToken)
  const publishedAt = new Date().toISOString()
  const publication = buildPartnerPublication(leads, PARTNER_ID, publishedAt)
  if (!parsePartnerPublication(publication, PARTNER_ID)) throw new PreparationError('PUBLICATION_VALIDATION_FAILED')
  checkedDocumentSize(publication)
  const summary = {
    mode: options.mode, projectId: PROJECT_ID, loginId: LOGIN_ID, partnerId: PARTNER_ID,
    existingAccount: !!existingAuth, existingAccountPreserved: !!existingAuth,
    sourceAlreadyProtected: !!existingSource, sourceRowCount: source.sources.length,
    companyMonthCount: publication.months.length,
    companyCustomerCount: publication.months.reduce((count, month) => count + month.customerCount, 0),
    rawReferralWrites: 0, staffAccountWrites: 0, passwordResets: 0, rulesDeployments: 0, accountActivated: false,
  }
  if (options.mode === 'inspect') {
    console.log(JSON.stringify({ ...summary, writes: 0, readyToPrepare: true }))
    return
  }

  let createdAccount = false
  if (!existingAuth) {
    if (!options.passwordStdin) throw new PreparationError('NEW_ACCOUNT_PASSWORD_STDIN_REQUIRED')
    let password = await readPassword()
    const createBody = { localId: NEW_UID, email: EMAIL, password, displayName: PARTNER_NAME, disabled: true, emailVerified: false }
    password = ''
    try {
      // Same project-scoped create endpoint used by the official Admin SDK.
      const created = await request(authClient, 'post', `/v1/projects/${PROJECT_ID}/accounts`, createBody)
      if (created.localId !== NEW_UID) throw new PreparationError('CREATED_ACCOUNT_UID_NOT_EXACT')
      createdAccount = true
    } catch (error) {
      // A lost HTTP response must not cause a password reset or a second identity.
      const recovered = await lookup()
      if (!recovered || recovered.localId !== NEW_UID || recovered.disabled !== true) throw error
      createdAccount = true
    } finally { delete createBody.password }
    const check = await lookup()
    if (!check || check.localId !== NEW_UID || check.disabled !== true) throw new PreparationError('CREATED_ACCOUNT_NOT_SAFELY_DISABLED', { createdAccount })
  }

  const profile = existingProfile ? decodeFields(existingProfile.fields || {}) : {
    role: 'partner', loginId: LOGIN_ID, partnerId: PARTNER_ID, partnerName: PARTNER_NAME,
    displayName: PARTNER_NAME, active: false, approved: false, mustChangePassword: true,
    createdAt: publishedAt, updatedAt: publishedAt, provisioningStage: 'prepared-inactive',
  }
  assertStagedProfile(profile)
  const writes = [
    { update: { name: publicationPath, fields: encodeFields(publication) }, currentDocument: existingPublication ? { updateTime: existingPublication.updateTime } : { exists: false } },
  ]
  if (!existingSource) writes.push({ update: { name: sourcePath, fields: encodeFields(source) }, currentDocument: { exists: false } })
  if (!existingProfile) writes.push({ update: { name: profilePath, fields: encodeFields(profile) }, currentDocument: { exists: false } })
  // One atomic Firestore commit. Source/profile are create-only; a concurrent
  // edit makes the commit fail instead of overwriting someone else's changes.
  const committed = await request(firestoreClient, 'post', `/v1/${database}/documents:commit`, { writes })
  if (!Array.isArray(committed.writeResults) || committed.writeResults.length !== writes.length) throw new PreparationError('PREPARATION_COMMIT_NOT_CONFIRMED', { createdAccount })
  const [savedProfile, savedPublication, savedSource, savedAuth] = await Promise.all([
    request(firestoreClient, 'get', `/v1/${profilePath}`),
    request(firestoreClient, 'get', `/v1/${publicationPath}`),
    request(firestoreClient, 'get', `/v1/${sourcePath}`),
    lookup(),
  ])
  for (const [document, expectedPath] of [[savedProfile, profilePath], [savedPublication, publicationPath], [savedSource, sourcePath]]) {
    if (!document || document.name !== expectedPath || typeof document.updateTime !== 'string') throw new PreparationError('PREPARATION_READBACK_PATH_NOT_EXACT', { createdAccount })
  }
  const readbackProfile = decodeFields(savedProfile.fields || {})
  const readbackPublication = decodeFields(savedPublication.fields || {})
  const readbackSource = decodeFields(savedSource.fields || {})
  assertStagedProfile(readbackProfile)
  if (stableJson(readbackProfile) !== stableJson(profile)
    || !parsePartnerPublication(readbackPublication, PARTNER_ID) || stableJson(readbackPublication) !== stableJson(publication)
    || !parseSeptemberSource(readbackSource) || stableJson(readbackSource) !== stableJson(source)
    || !savedAuth || savedAuth.localId !== uid || savedAuth.disabled !== true) throw new PreparationError('PREPARATION_READBACK_NOT_EXACT', { createdAccount })
  console.log(JSON.stringify({ ...summary, createdAccount, firestoreDocumentWrites: writes.length, sourceProtected: true, profilePreparedInactive: true, companyPublicationPrepared: true, readbackVerified: true }))
}

main().catch(error => {
  // Never echo provider exceptions, credential-bearing requests or customer rows.
  const safe = error instanceof PreparationError ? { error: error.code, ...error.details } : { error: 'PREPARATION_FAILED_NO_SECRET_DETAILS_LOGGED' }
  console.error(JSON.stringify({ ...safe, projectId: PROJECT_ID, loginId: LOGIN_ID, accountActivated: false }))
  process.exitCode = 1
})
