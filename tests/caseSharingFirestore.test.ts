import assert from 'node:assert/strict'
import { CaseSharingFirestoreError, createCaseSharingStore, getCaseSharingProfile } from '../server/case-sharing/firestore'

type Row = Record<string, any>
const base = 'projects/d5-partner-desk/databases/(default)/documents'
const profileName = base + '/profiles/test-staff'
const leadName = base + '/referrals/lead-a'
const newName = base + '/referrals/new-lead'
const guardName = base + '/caseGroups/group-a'
const profile = { employeeNo: { stringValue: '12345' }, role: { stringValue: 'admin' }, active: { booleanValue: true } }
const authorization = { authorizedProfile: { uid: 'test-staff', employeeNo: '12345', role: 'admin' } }
const time = '2026-11-14T01:00:00.000000001Z'
const archive = { mapValue: { fields: {
  timestamp: { timestampValue: time },
  amount: { integerValue: '9007199254740993' },
  attachment: { referenceValue: base + '/example/reference' },
} } }
const row = { name: leadName, updateTime: time, fields: {
  caseGroupId: { stringValue: 'group-a' },
  note: { stringValue: 'original manual memo' },
  purchaseAmount: { integerValue: '1000000' },
  caseSharingHistory: { arrayValue: { values: [archive] } },
} }
const calls: { method: string; body: Row }[] = []
let mode: 'retry' | 'forbidden' | 'edit' | 'changed' | 'rollback' | 'exhausted' = 'retry'
let transactionNumber = 0
let commitCount = 0

const mockFetch: typeof fetch = async (url, init) => {
  assert.equal(typeof url, 'string')
  assert.match(String(url), /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/d5-partner-desk\/databases\/\(default\)\/documents:/)
  assert.equal(init?.redirect, 'error')
  assert.equal(init?.method, 'POST')
  assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer server-only-test')
  const method = String(url).slice(String(url).lastIndexOf(':') + 1)
  const body = JSON.parse(String(init?.body)) as Row
  calls.push({ method, body })
  const ok = (value: unknown) => Response.json(value)
  if (method === 'beginTransaction') return ok({ transaction: 'tx-' + ++transactionNumber })
  if (method === 'rollback') return ok({})
  if (method === 'runQuery') {
    assert.equal(body.structuredQuery.where.fieldFilter.value.stringValue, 'group-a')
    assert.equal(body.structuredQuery.limit, 9)
    const rows = mode === 'changed' && body.transaction ? [] : [{ document: row }, { readTime: time, done: true }]
    return ok(rows)
  }
  if (method === 'batchGet') {
    assert.equal(body.documents.length, 1)
    const name = body.documents[0]
    if (name === profileName) return ok([{ found: { name, updateTime: time, fields:
      mode === 'forbidden' && body.transaction ? { ...profile, mustChangePassword: { booleanValue: true } } : profile } }])
    if (name === newName || name === guardName) return ok([{ missing: name }])
    assert.equal(name, leadName)
    return ok([{ found: row }])
  }
  assert.equal(method, 'commit')
  commitCount++
  if (mode === 'exhausted' || mode === 'retry' && commitCount === 1) {
    return Response.json({ error: { status: 'ABORTED', message: 'sensitive' } }, { status: 409 })
  }
  return ok({ commitTime: time, writeResults: body.writes.map(() => ({ updateTime: time })) })
}

assert.equal((await getCaseSharingProfile('test-staff', 'server-only-test', mockFetch))?.role, 'admin')
await assert.rejects(getCaseSharingProfile('../other', 'server-only-test', mockFetch), { code: 'INVALID_DOCUMENT_ID' })

const store = createCaseSharingStore('server-only-test', mockFetch, authorization)
assert.equal((await store.getMembers('group-a')).length, 1)
const outcome = await store.transaction(async tx => {
  const source = await tx.getLead('lead-a')
  assert(source)
  assert.equal(source.purchaseAmount, 1_000_000)
  assert.equal(source.note, 'original manual memo')
  assert.equal(await tx.getLead('new-lead'), null)
  assert.equal(await tx.getGuard('group-a'), null)
  tx.updateLead('lead-a', {
    caseBasisLeadId: 'lead-a',
    caseSharingHistory: [...source.caseSharingHistory as unknown[], { at: time, by: 'test-staff', previous: { fee: 0.5 } }],
  })
  tx.createLead('new-lead', { caseGroupId: 'group-a' })
  tx.setGuard('group-a', { memberIds: ['lead-a', 'new-lead'], revision: 1, managerEmployeeNo: null })
  return 'saved'
})
assert.equal(outcome, 'saved')
assert.equal(commitCount, 2)
assert.deepEqual(calls.filter(call => call.method === 'beginTransaction')[1].body.options, { readWrite: { retryTransaction: 'tx-1' } })
assert.equal(calls.filter(call => call.method === 'runQuery' && call.body.transaction).length, 2)

const writes = calls.filter(call => call.method === 'commit').at(-1)!.body.writes
assert.deepEqual(writes[0].updateMask.fieldPaths, ['caseBasisLeadId', 'caseSharingHistory'])
assert.deepEqual(writes[0].currentDocument, { updateTime: time })
assert.deepEqual(writes[0].update.fields.caseSharingHistory.arrayValue.values[0], archive)
assert.deepEqual(writes[0].update.fields.caseSharingHistory.arrayValue.values[1].mapValue.fields.previous.mapValue.fields.fee, { doubleValue: 0.5 })
assert.equal(writes[0].update.fields.purchaseAmount, undefined)
assert.equal(writes[0].update.fields.note, undefined)
for (const write of writes.slice(1)) assert.deepEqual(write.currentDocument, { exists: false })

mode = 'forbidden'
await assert.rejects(store.transaction(async () => assert.fail('revoked staff cannot reach planning')), { code: 'ROLE_CHANGED', status: 403 })
assert.equal(commitCount, 2)
assert.equal(calls.at(-1)!.method, 'rollback')

mode = 'changed'
await assert.rejects(store.transaction(async () => assert.fail('changed roster cannot reach planning')), { code: 'ROSTER_CHANGED', status: 409 })
assert.equal(commitCount, 2)
assert.equal(calls.at(-1)!.method, 'rollback')

mode = 'rollback'
const badWork = new Error('application error')
await assert.rejects(store.transaction(async tx => {
  await tx.getLead('lead-a')
  tx.updateLead('lead-a', { note: 'staged only' })
  throw badWork
}), error => error === badWork)
assert.equal(commitCount, 2)
assert.equal(calls.at(-1)!.method, 'rollback')

mode = 'exhausted'
await assert.rejects(store.transaction(async tx => {
  await tx.getLead('lead-a')
  tx.updateLead('lead-a', { note: 'never committed' })
}), error => error instanceof CaseSharingFirestoreError && error.code === 'ABORTED' && !error.message.includes('sensitive'))
assert.equal(commitCount, 5)
assert.equal(calls.at(-1)!.method, 'rollback')
console.log('Case sharing trusted Firestore transaction verifies scope, eligibility, atomic masks, opaque audit fields, and bounded conflict handling.')
