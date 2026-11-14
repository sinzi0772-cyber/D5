import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { handleCaseSharing } from '../server/case-sharing/handler'
import { caseMemberRevision } from '../src/lib/caseSharingRequest'
import { leadFromDocument } from '../src/lib/leadDocument'
import { caseBasisGroupsFor, financialCaseLeadFor } from '../src/lib/caseBasis'

type Data = Record<string, unknown>
type Value = { stringValue: string } | { integerValue: string } | { booleanValue: boolean } | { nullValue: null }
  | { arrayValue: { values: Value[] } } | { mapValue: { fields: Fields } }
type Fields = Record<string, Value>
type Write = { update: { name: string; fields: Fields }; updateMask?: { fieldPaths: string[] }; currentDocument: { exists?: false; updateTime?: string } }

const base = 'projects/d5-partner-desk/databases/(default)/documents'
const uid = 'synthetic-staff'
const email = '67890@d5.local'
const now = Math.floor(Date.now() / 1000)
const timestamp = '2026-11-14T01:00:00.000Z'
const team = 'sinzi0772-5729s-projects'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = publicKey.export({ type: 'spki', format: 'pem' })
const jwt = (claims: Data) => {
  const message = [{ kid: 'synthetic-key', alg: 'RS256' }, claims].map(item => Buffer.from(JSON.stringify(item)).toString('base64url')).join('.')
  return message + '.' + sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url')
}
const firebaseToken = jwt({ iss: 'https://securetoken.google.com/d5-partner-desk', aud: 'd5-partner-desk', sub: uid,
  email, iat: now, exp: now + 60, auth_time: now - 10 })
const vercelToken = jwt({ iss: 'https://oidc.vercel.com', aud: 'https://vercel.com/' + team,
  sub: 'owner:' + team + ':project:d5-partner-desk:environment:production',
  owner_id: 'team_3JwHqeu7Kcsp7Luxsx8AmJzu', project_id: 'prj_8iB1WkdvXAu51amnWmXthbhvp5UA',
  environment: 'production', iat: now, nbf: now - 10, exp: now + 60 })

function wrap(value: unknown): Value {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return { integerValue: String(value) }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(wrap) } }
  return { mapValue: { fields: fieldsFor(value as Data) } }
}
const fieldsFor = (data: Data): Fields => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, wrap(value)]))

function unwrap(value: Value): unknown {
  if ('mapValue' in value) return dataFor(value.mapValue.fields)
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(unwrap)
  if ('integerValue' in value) return Number(value.integerValue)
  return Object.values(value)[0]
}
const dataFor = (fields: Fields): Data => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, unwrap(value)]))

const records = new Map<string, Fields>()
const fullName = (id: string) => base + '/referrals/' + id
const rowFor = (name: string) => ({ name, updateTime: timestamp, fields: records.get(name) })
const fromStore = (id: string) => leadFromDocument(id, dataFor(records.get(fullName(id))!))
const revisionsOf = (ids: string[]) => Promise.all(ids.map(id => caseMemberRevision(fromStore(id))))
const memo = (id: string, content: string) => ({ id, date: '2026-11-14', manager: '스태프', content })
let role = 'admin'
let disableDuringTransaction = false
let commits = 0
let rollbacks = 0
const visited: string[] = []

const mockFetch: typeof fetch = async (input, options) => {
  const url = new URL(String(input))
  visited.push(url.hostname)
  if (url.hostname === 'www.googleapis.com') return Response.json({ 'synthetic-key': key }, { headers: { 'cache-control': 'max-age=60' } })
  if (url.hostname === 'identitytoolkit.googleapis.com') {
    assert.equal(JSON.parse(String(options?.body)).idToken, firebaseToken)
    return Response.json({ users: [{ localId: uid, email, validSince: String(now - 100) }] })
  }
  if (url.hostname === 'sts.googleapis.com') {
    assert.equal(JSON.parse(String(options?.body)).subjectToken, vercelToken)
    return Response.json({ access_token: 'synthetic-federated-token' })
  }
  if (url.hostname === 'iamcredentials.googleapis.com') return Response.json({ accessToken: 'synthetic-firestore-token' })
  assert.equal(url.hostname, 'firestore.googleapis.com')
  assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer synthetic-firestore-token')
  assert(url.pathname.startsWith('/v1/' + base + ':'))
  const method = url.pathname.split(':').at(-1)
  const body = JSON.parse(String(options?.body))
  if (method === 'beginTransaction') return Response.json({ transaction: 'synthetic-transaction-id' })
  if (method === 'rollback') { rollbacks++; return Response.json({}) }
  if (method === 'batchGet') {
    assert.equal(body.documents.length, 1)
    const name = body.documents[0]
    if (name === base + '/profiles/' + uid) return Response.json([{ found: { name, updateTime: timestamp,
      fields: fieldsFor({ employeeNo: '67890', role, mustChangePassword: !!(disableDuringTransaction && body.transaction) }) } }])
    return Response.json([records.has(name) ? { found: rowFor(name) } : { missing: name }])
  }
  if (method === 'runQuery') {
    const caseId = body.structuredQuery.where.fieldFilter.value.stringValue
    const rows = [...records].filter(([name, fields]) => name.startsWith(base + '/referrals/') && dataFor(fields).caseGroupId === caseId)
    return Response.json(rows.map(([name]) => ({ document: rowFor(name) })))
  }
  assert.equal(method, 'commit')
  assert.equal(body.transaction, 'synthetic-transaction-id')
  for (const { update, updateMask, currentDocument } of body.writes as Write[]) {
    if (records.has(update.name)) {
      assert.equal(currentDocument.updateTime, timestamp)
      assert.deepEqual(updateMask?.fieldPaths, Object.keys(update.fields))
      records.set(update.name, { ...records.get(update.name), ...update.fields })
    } else {
      assert.deepEqual(currentDocument, { exists: false })
      records.set(update.name, update.fields)
    }
  }
  commits++
  return Response.json({ writeResults: body.writes.map(() => ({ updateTime: timestamp })) })
}

function save(fields: Data, token = firebaseToken) {
  return handleCaseSharing(new Request('https://d5-partner-desk.vercel.app/api/case-sharing', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'x-vercel-oidc-token': vercelToken, 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  }))
}

function seed(id: string, amount: number, changes: Data = {}) {
  records.set(fullName(id), fieldsFor({ customerName: '가**', phoneLast4: '1234', partnerName: '아이웨딩', gender: '미입력',
    registeredAt: '2026-11-12', deliveryScheduledDate: '2026-11-14', appointmentType: '이업종제휴', status: '구매완료',
    visitState: '방문', purchaseType: '일시불', lumpSumAmount: amount, managerEmployeeNo: '67890',
    note: '기존 메모', memoHistory: [memo('prior-' + id, '기존 메모')], bestCustomerNumber: '9876543210', ...changes }))
}

const originalFetch = globalThis.fetch
globalThis.fetch = mockFetch
try {
  assert.equal((await save({ operation: 'check' }, '')).status, 401)
  assert.equal((await save({ operation: 'check' }, 'bad.token.rejected')).status, 401)
  assert.equal(visited.length, 0)
  role = 'manager'
  assert.equal((await save({ operation: 'check' })).status, 403)
  role = 'admin'
  assert.deepEqual(await (await save({ operation: 'check' })).json(), { ready: true })
  assert.equal(commits, 0)

  const ids = Array.from({ length: 8 }, (_, i) => 'bulk-' + i)
  ids.forEach((id, i) => seed(id, (i + 1) * 1_000))
  const bulk = { operation: 'save', leadId: ids[0], targetIds: ids.slice(1), members: await revisionsOf(ids),
    basis: { caseLeadId: ids[3], mergePurchaseAmounts: false }, changes: {} }

  disableDuringTransaction = true
  assert.equal((await save(bulk)).status, 403)
  assert.equal(commits, 0)
  assert.equal(rollbacks, 1)
  assert(ids.every(id => !fromStore(id).caseGroupId))
  disableDuringTransaction = false

  const saved = await save(bulk)
  assert.equal(saved.status, 200, await saved.clone().text())
  assert.equal((await saved.json()).changedCount, 8)
  const [group] = caseBasisGroupsFor(ids.map(fromStore))
  assert.equal(group.members.length, 8)
  assert.equal(financialCaseLeadFor(group.selection, group.members)?.lumpSumAmount, 4_000)
  ids.forEach((id, i) => {
    assert.equal(fromStore(id).lumpSumAmount, (i + 1) * 1_000)
    assert.deepEqual(fromStore(id).memoHistory, [memo('prior-' + id, '기존 메모')])
    assert.equal(fromStore(id).bestCustomerNumber, '9876543210')
    assert.equal(fromStore(id).caseGroupId, group.members[0].caseGroupId)
  })
  const stale = await save(bulk)
  assert.equal(stale.status, 409)
  assert.equal(commits, 1)

  seed('existing', 120_000)
  const linkedRegistration = { operation: 'save', leadId: 'new-customer', targetIds: ['existing'],
    members: await revisionsOf(['existing']), basis: { caseLeadId: 'existing', mergePurchaseAmounts: false },
    newCustomer: { customerName: '가나다', phoneLast4: '9988', partnerName: '아이웨딩', gender: '미입력', registeredAt: '2026-11-13' } }
  assert.equal((await save({ ...linkedRegistration, changes: {} })).status, 409)
  for (const appointmentType of ['미선택', '기타', null]) {
    assert.equal((await save({ ...linkedRegistration, changes: { appointmentType } })).status, 400)
  }
  const pair = await save({ ...linkedRegistration,
    changes: { appointmentType: '상담예약(이업종)', note: '새 메모', memoHistory: [memo('first-memo', '새 메모')] } })
  assert.equal(pair.status, 200, await pair.clone().text())
  assert.equal(fromStore('new-customer').customerName, '가*다')
  assert.equal(fromStore('new-customer').note, '새 메모')
  assert.equal(fromStore('new-customer').appointmentType, '상담예약(이업종)')
  assert.equal(fromStore('existing').lumpSumAmount, 120_000)

  seed('third', 30_000)
  const added = await save({ operation: 'save', leadId: 'existing', targetIds: ['third'],
    members: await revisionsOf(['existing', 'new-customer', 'third']),
    basis: { caseLeadId: 'existing', mergePurchaseAmounts: true },
    changes: { note: '새로 추가한 메모', memoHistory: [...fromStore('existing').memoHistory!, memo('append-existing', '새로 추가한 메모')] } })
  assert.equal(added.status, 200, await added.clone().text())
  const appendedGroups = caseBasisGroupsFor(['existing', 'new-customer', 'third'].map(fromStore))
  assert.equal(appendedGroups.length, 1)
  assert.equal(financialCaseLeadFor(appendedGroups[0].selection, appendedGroups[0].members)?.lumpSumAmount, 150_000)
  assert.equal(fromStore('existing').lumpSumAmount, 120_000)
  assert.equal(fromStore('existing').memoHistory?.length, 2)
  assert.equal(fromStore('third').note, '기존 메모')
  assert.equal(commits, 3)
  console.log('Case sharing API verifies authentication, server role recheck, eight-row atomic save, stale-save refusal, new-customer link, and append to existing group with manual edit.')
} finally {
  globalThis.fetch = originalFetch
}
