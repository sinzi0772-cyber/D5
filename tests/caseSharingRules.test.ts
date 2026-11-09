import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Scoped synthetic interpreter of the actual local rule functions and allow expressions.
 * This is NOT the official Firestore compiler/emulator. It checks the exercised semantics,
 * with cached before/after document reads, without Firebase, credentials, or network access.
 */
type Data = Record<string, unknown>
type Database = Map<string, Data>
type Write = { path: string; data: Data | null }
type Auth = { uid: string; token: { email: string } } | null
type Evaluation = { allowed: boolean; accessCount: number; accesses: string[]; error?: string }

const rawMaps = new WeakMap<object, Data>()
function raw(value: unknown): unknown {
  return value && typeof value === 'object' ? rawMaps.get(value) || value : value
}
function stable(value: unknown): unknown {
  const current = raw(value)
  if (Array.isArray(current)) return current.map(stable)
  if (current && typeof current === 'object') return Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
  return current
}
const equal = (left: unknown, right: unknown) => JSON.stringify(stable(left)) === JSON.stringify(stable(right))

class RuleSet {
  readonly values: unknown[]
  constructor(values: unknown[]) { this.values = values.filter((value, index) => values.findIndex(item => equal(value, item)) === index) }
  size(): number { return this.values.length }
  union(other: RuleSet): RuleSet { return new RuleSet([...this.values, ...other.values]) }
}

declare global {
  interface Array<T> {
    size(): number
    hasAny(values: readonly unknown[]): boolean
    hasAll(values: readonly unknown[]): boolean
    hasOnly(values: readonly unknown[]): boolean
    toSet(): RuleSet
  }
  interface String {
    size(): number
    matches(pattern: string): boolean
    rulesReplace(pattern: string, replacement: string): string
  }
}

Object.defineProperties(Array.prototype, {
  size: { configurable: true, value: function (this: unknown[]) { return this.length } },
  hasAny: { configurable: true, value: function (this: unknown[], values: unknown[]) { return this.some(item => values.some(value => equal(item, value))) } },
  hasAll: { configurable: true, value: function (this: unknown[], values: unknown[]) { return values.every(value => this.some(item => equal(item, value))) } },
  hasOnly: { configurable: true, value: function (this: unknown[], values: unknown[]) { return this.every(item => values.some(value => equal(item, value))) } },
  toSet: { configurable: true, value: function (this: unknown[]) { return new RuleSet(this) } },
})
Object.defineProperties(String.prototype, {
  size: { configurable: true, value: function (this: string) { return this.length } },
  matches: { configurable: true, value: function (this: string, pattern: string) { return new RegExp(`^(?:${pattern})$`).test(String(this)) } },
  rulesReplace: { configurable: true, value: function (this: string, pattern: string, replacement: string) { return String(this).replace(new RegExp(pattern, 'g'), replacement) } },
})

function wrapped(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wrapped)
  if (!value || typeof value !== 'object') return value
  const data = value as Data
  const proxy = new Proxy(data, {
    get: (target, property) => {
      if (property === 'get') return (key: string, fallback: unknown) => wrapped(Object.prototype.hasOwnProperty.call(target, key) ? target[key] : fallback)
      if (property === 'keys') return () => Object.keys(target)
      if (property === 'diff') return (other: unknown) => ({ affectedKeys: () => {
        const before = raw(other) as Data
        return [...new Set([...Object.keys(target), ...Object.keys(before)])].filter(key => !equal(target[key], before[key]))
      } })
      if (typeof property !== 'string' || !Object.prototype.hasOwnProperty.call(target, property)) throw new Error(`Missing rule field: ${String(property)}`)
      return wrapped(target[property])
    },
  })
  rawMaps.set(proxy, data)
  return proxy
}

function isType(value: unknown, type: string): boolean {
  const current = raw(value)
  if (type === 'string') return typeof current === 'string'
  if (type === 'number') return typeof current === 'number'
  if (type === 'int') return typeof current === 'number' && Number.isInteger(current)
  if (type === 'list') return Array.isArray(current)
  if (type === 'map') return current !== null && typeof current === 'object' && !Array.isArray(current)
  throw new Error(`Unsupported rule type: ${type}`)
}

function blockEnd(source: string, opening: number): number {
  let depth = 1
  let quote = ''
  let lineComment = false
  for (let index = opening + 1; index < source.length; index++) {
    const char = source[index]
    if (lineComment) { if (char === '\n') lineComment = false; continue }
    if (quote) {
      if (char === '\\') index++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '/' && source[index + 1] === '/') { lineComment = true; index++; continue }
    if (char === "'" || char === '"') { quote = char; continue }
    if (char === '{') depth++
    else if (char === '}' && --depth === 0) return index
  }
  throw new Error('Unclosed local rule block')
}

function translated(source: string): string {
  const expression = '[A-Za-z_]\\w*(?:\\(\\))?(?:\\.[A-Za-z_]\\w*(?:\\(\\))?)*'
  return source
    .replace(/\b(getAfter|existsAfter|get|exists)\(\/databases\/\$\(database\)\/documents\/([A-Za-z]+)\/\$\(([^)]+)\)\)/g, (_all, method: string, collection: string, id: string) => `${method}(path('${collection}', ${id}))`)
    .replace(new RegExp(`(${expression})\\s+is\\s+(string|number|int|list|map)\\b`, 'g'), (_all, value: string, type: string) => `isType(${value}, '${type}')`)
    .replace(new RegExp(`(${expression})\\s+in\\s+(\\[[^\\]]*\\])`, 'g'), (_all, value: string, list: string) => `includes(${list}, ${value})`)
    .replace(/\.replace\(/g, '.rulesReplace(')
}

const source = readFileSync(resolve('firestore.rules'), 'utf8')
const functions: string[] = []
const functionPattern = /function\s+(\w+)\(([^)]*)\)\s*\{/g
let functionMatch: RegExpExecArray | null
while ((functionMatch = functionPattern.exec(source))) {
  const opening = functionPattern.lastIndex - 1
  const ending = blockEnd(source, opening)
  functions.push(`function ${functionMatch[1]}(${functionMatch[2]}) { ${translated(source.slice(opening + 1, ending))} }`)
  functionPattern.lastIndex = ending + 1
}
assert.ok(functions.length >= 25, 'The tests must interpret actual local rule functions rather than copied policy logic')

const rules = new Map<string, { variable: string; operations: string[]; expression: string }[]>()
const matchPattern = /match\s+\/([A-Za-z]+)\/\{(\w+)\}\s*\{/g
let match: RegExpExecArray | null
while ((match = matchPattern.exec(source))) {
  const opening = matchPattern.lastIndex - 1
  const ending = blockEnd(source, opening)
  const allows = [...source.slice(opening + 1, ending).matchAll(/allow\s+([a-z, ]+):\s*if\s+([\s\S]*?);/g)]
  rules.set(match[1], allows.map(allow => ({ variable: match![2], operations: allow[1].split(',').map(value => value.trim()), expression: translated(allow[2]) })))
  matchPattern.lastIndex = ending + 1
}
assert.ok(rules.has('caseGroups') && rules.has('referrals') && rules.has('partnerViews'))

function evaluate(database: Database, after: Database, documentPath: string, operation: string, auth: Auth): Evaluation {
  const [collection, id] = documentPath.split('/')
  const accesses = new Set<string>()
  const read = (snapshot: Database, phase: string, key: string) => {
    accesses.add(`${phase}:${key}`)
    return snapshot.has(key) ? { data: wrapped(snapshot.get(key)) } : null
  }
  const context: Data = {
    database: 'synthetic', path: (name: string, key: string) => `${name}/${key}`, isType,
    includes: (values: unknown[], value: unknown) => values.some(item => equal(item, value)),
    request: wrapped({ auth, resource: { data: after.get(documentPath) || {} } }),
    resource: wrapped({ data: database.get(documentPath) || {} }),
    get: (key: string) => read(database, 'before', key),
    getAfter: (key: string) => read(after, 'after', key),
    exists: (key: string) => { accesses.add(`before:${key}`); return database.has(key) },
    existsAfter: (key: string) => { accesses.add(`after:${key}`); return after.has(key) },
  }
  let failure: string | undefined
  let allowed = false
  const operationGroup = operation === 'get' || operation === 'list' ? 'read' : 'write'
  const candidates = (rules.get(collection) || []).filter(rule => rule.operations.includes(operation) || rule.operations.includes(operationGroup))
  for (const rule of candidates) {
    context[rule.variable] = id
    try {
      const run = new Function('context', `with (context) { ${functions.join('\n')} return Boolean(${rule.expression}); }`)
      if (run(context)) { allowed = true; break }
    } catch (error) { failure = error instanceof Error ? error.message : String(error) }
  }
  return { allowed, accessCount: accesses.size, accesses: [...accesses], ...(failure ? { error: failure } : {}) }
}

function postState(database: Database, writes: Write[]): Database {
  const after = new Map([...database].map(([path, data]) => [path, structuredClone(data)]))
  for (const write of writes) {
    if (write.data === null) after.delete(write.path)
    else after.set(write.path, structuredClone(write.data))
  }
  return after
}

let checked = 0
function assertBatch(name: string, database: Database, writes: Write[], auth: Auth, expected: boolean): Evaluation[] {
  const after = postState(database, writes)
  const evaluations = writes.map(write => evaluate(database, after, write.path, write.data === null ? 'delete' : database.has(write.path) ? 'update' : 'create', auth))
  assert.equal(evaluations.every(result => result.allowed), expected, `${name}: ${JSON.stringify(evaluations)}`)
  for (const result of evaluations) assert.ok(result.accessCount <= 10, `${name}: synthetic cached accesses exceed per-operation budget`)
  const batchAccesses = new Set(evaluations.flatMap(result => result.accesses))
  assert.ok(batchAccesses.size <= 20, `${name}: synthetic cached accesses exceed transaction budget`)
  checked++
  return evaluations
}

const authFor = (uid: string, email = `${uid}@synthetic.local`): Auth => ({ uid, token: { email } })
const admin = authFor('admin')
const manager = authFor('manager')
const partner = authFor('partner', 'e90227@d5.local')
const iniPartner = authFor('ini-partner', 'e75351@d5.local')
const iniProfile = { role: 'partner', active: true, approved: true, loginId: 'E75351', partnerId: 'iniwedding', partnerName: '(주) 아이니웨딩네트웍스', mustChangePassword: false }
const profiles: [string, Data][] = [
  ['profiles/admin', { role: 'admin', employeeNo: '1000', active: true, approved: true }],
  ['profiles/store', { role: 'store_manager', employeeNo: '1001', active: true, approved: true }],
  ['profiles/assistant', { role: 'assistant_manager', employeeNo: '1002', active: true, approved: true }],
  ['profiles/manager', { role: 'manager', employeeNo: '111', active: true, approved: true }],
  ['profiles/special', { role: 'admin', employeeNo: '1292', active: true, approved: true }],
  ['profiles/disabled', { role: 'admin', employeeNo: '1003', disabled: true, active: true, approved: true }],
  ['profiles/partner', { role: 'partner', employeeNo: '1292', active: true, approved: true, loginId: 'E90227', partnerId: 'iwedding', partnerName: '(주)아이패밀리에스씨', mustChangePassword: false }],
  ['profiles/ini-partner', iniProfile],
]
const caseId = 'case-test'
const now = '2026-10-13T03:00:00.000Z'
const referral = (id: string, changes: Data = {}): Data => ({
  customerName: '가**', phoneLast4: '0001', partnerName: '(주)다이렉트컴즈',
  appointmentType: '이업종제휴', status: '관리중', visitState: '예정', manager: '담당 A', managerEmployeeNo: '111',
  caseGroupId: caseId, caseBasisLeadId: 'owner', purchaseType: '일시불', purchaseAmount: 100, lumpSumAmount: 100, subscriptionAmount: null,
  lumpSumSourceId: id, subscriptionSourceId: null, caseSharingHistory: [],
  createdBy: 'admin', updatedAt: now, updatedBy: 'admin', ...changes,
})
const guard = (ids: string[], changes: Data = {}): Data => ({ memberIds: ids, revision: 5, managerEmployeeNo: '111', basisLeadId: ids.includes('owner') ? 'owner' : null, updatedAt: now, updatedBy: 'admin', ...changes })
const owner = referral('owner')
const alias = referral('alias', { lumpSumSourceId: 'owner' })
const seed = (...entries: [string, Data][]): Database => new Map([...profiles, ...entries])
const base = seed(['referrals/owner', owner], ['referrals/alias', alias], [`caseGroups/${caseId}`, guard(['owner', 'alias'])])
const priceWrites = (uid: string): Write[] => [
  { path: 'referrals/owner', data: { ...owner, lumpSumAmount: 150, purchaseAmount: 150, updatedBy: uid } },
  { path: 'referrals/alias', data: { ...alias, lumpSumAmount: 150, purchaseAmount: 150, updatedBy: uid } },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6, updatedBy: uid }) },
]

assertBatch('admin linked atomic share', base, priceWrites('admin'), admin, true)
assertBatch('same employee guarded finance', base, priceWrites('manager'), manager, true)
const legacyA = { ...owner, caseBasisLeadId: null }
const legacyB = { ...alias, lumpSumAmount: 200, purchaseAmount: 200, lumpSumSourceId: 'alias', caseBasisLeadId: null }
const legacy = seed(['referrals/owner', legacyA], ['referrals/alias', legacyB], [`caseGroups/${caseId}`, guard(['owner', 'alias'], { basisLeadId: null })])
const basisWrites = [
  { path: 'referrals/owner', data: { ...legacyA, caseBasisLeadId: 'owner' } },
  { path: 'referrals/alias', data: { ...legacyB, caseBasisLeadId: 'owner' } },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6 }) },
]
assertBatch('basis-only admin save keeps A100 B200 originals', legacy, basisWrites, admin, true)
assertBatch('basis-only manager cannot establish basis', legacy, basisWrites.map(write => ({ ...write, data: { ...write.data, updatedBy: 'manager' } })), manager, false)
assertBatch('basis change without guard bump denied', legacy, basisWrites.slice(0, 2), admin, false)
assertBatch('one member missing chosen basis denied', legacy, [basisWrites[0], basisWrites[2]], admin, false)
assertBatch('guard basis must be current member', legacy, [
  ...basisWrites.slice(0, 2).map(write => ({ ...write, data: { ...write.data, caseBasisLeadId: 'outside' } })),
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6, basisLeadId: 'outside' }) },
], admin, false)
assertBatch('legacy manager finance needs established basis', legacy, [
  { path: 'referrals/owner', data: { ...legacyA, lumpSumAmount: 150, purchaseAmount: 150, updatedBy: 'manager' } },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6, basisLeadId: null, updatedBy: 'manager' }) },
], manager, false)
assertBatch('linked price requires guard bump', base, [priceWrites('admin')[0]], admin, false)
assertBatch('linked manager requires guard bump', base, [{ path: 'referrals/owner', data: { ...owner, manager: '담당 B', managerEmployeeNo: '222' } }], admin, false)
const personalResult = assertBatch('ordinary manager personal status and note needs no guard', base, [{ path: 'referrals/alias', data: { ...alias, status: '구매완료', note: '개인 메모', updatedBy: 'manager' } }], manager, true)
assert.ok(personalResult[0].accesses.every(path => path === 'before:profiles/manager'))
assertBatch('ordinary manager cannot reassign own employee', base, [{ path: 'referrals/alias', data: { ...alias, managerEmployeeNo: '222' } }], manager, false)
assertBatch('ordinary manager cannot rename assignment', base, [{ path: 'referrals/alias', data: { ...alias, manager: '다른 담당' } }], manager, false)
const foreign = referral('foreign', { managerEmployeeNo: '222', manager: '담당 B' })
assertBatch('ordinary manager cannot take foreign referral', seed(['referrals/foreign', foreign]), [{ path: 'referrals/foreign', data: { ...foreign, managerEmployeeNo: '111', manager: '담당 A' } }], manager, false)
const foreignGuard = seed(['referrals/owner', owner], [`caseGroups/${caseId}`, guard(['owner'], { managerEmployeeNo: '222' })])
assertBatch('ordinary manager cannot update another employee guard', foreignGuard, [{ path: `caseGroups/${caseId}`, data: guard(['owner'], { revision: 6, managerEmployeeNo: '222', updatedBy: 'manager' }) }], manager, false)

for (const [name, sourceId, partnerName] of [
  ['new external alias denied', 'external', owner.partnerName],
  ['new cross-company alias denied', 'owner', '다른 업체'],
] as const) {
  const newAlias = referral('new-alias', { lumpSumSourceId: sourceId, partnerName })
  assertBatch(name, seed(...base, ['referrals/external', referral('external')]), [
    { path: 'referrals/new-alias', data: newAlias },
    { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias', 'new-alias'], { revision: 6 }) },
  ], admin, false)
}
const middle = referral('middle', { lumpSumSourceId: 'owner' })
assertBatch('new alias source chain denied', seed(...base, ['referrals/middle', middle]), [
  { path: 'referrals/new-alias', data: referral('new-alias', { lumpSumSourceId: 'middle' }) },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias', 'middle', 'new-alias'], { revision: 6 }) },
], admin, false)
assertBatch('new valid direct alias allowed', base, [
  { path: 'referrals/new-alias', data: referral('new-alias', { lumpSumSourceId: 'owner' }) },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias', 'new-alias'], { revision: 6 }) },
], admin, true)
const canonicalOwner = referral('owner', { partnerName: '아이웨딩' })
assertBatch('approved canonical partner alias allowed', seed(['referrals/owner', canonicalOwner], [`caseGroups/${caseId}`, guard(['owner'])]), [
  { path: 'referrals/alias', data: referral('alias', { partnerName: '（주）아이패밀리에스씨', lumpSumSourceId: 'owner' }) },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6 }) },
], admin, true)

// Corporation-prefix spacing is a comparison rule only: a shared price write
// retains each source record's full original partnerName instead of renaming it.
for (const company of ['아이니웨딩네트웍스', '아이티앤코']) {
  for (const [ownerName, aliasName] of [[`(주)${company}`, `(주) ${company}`], [`(주) ${company}`, `(주)${company}`]]) {
    const companyOwner = referral('owner', { partnerName: ownerName })
    const companyAlias = referral('alias', { partnerName: aliasName, lumpSumSourceId: 'owner' })
    const companyBase = seed(['referrals/owner', companyOwner], ['referrals/alias', companyAlias], [`caseGroups/${caseId}`, guard(['owner', 'alias'])])
    const writes: Write[] = [
      { path: 'referrals/owner', data: { ...companyOwner, lumpSumAmount: 150, purchaseAmount: 150, updatedBy: 'manager' } },
      { path: 'referrals/alias', data: { ...companyAlias, lumpSumAmount: 150, purchaseAmount: 150, updatedBy: 'manager' } },
      { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6, updatedBy: 'manager' }) },
    ]
    assertBatch(`${company} prefix-spacing share allowed without original renaming`, companyBase, writes, manager, true)
    const saved = postState(companyBase, writes)
    assert.equal(saved.get('referrals/owner')!.partnerName, ownerName)
    assert.equal(saved.get('referrals/alias')!.partnerName, aliasName)
    assert.equal(companyBase.get('referrals/owner')!.partnerName, ownerName, 'Synthetic source remains untouched')
    assert.equal(companyBase.get('referrals/alias')!.partnerName, aliasName, 'Synthetic source remains untouched')
    assertBatch(`${company} ordinary manager cannot persist a display-only rename`, companyBase, [
      { path: 'referrals/owner', data: { ...companyOwner, partnerName: aliasName, updatedBy: 'manager' } },
    ], manager, false)
  }
  for (const differentName of [`(주) ${company}협력사`, `(주) ${company.slice(0, 2)} ${company.slice(2)}`, `㈜${company}`, `주식회사 ${company}`]) {
    const companyOwner = referral('owner', { partnerName: `(주)${company}` })
    assertBatch(`${company} distinct full name and unapproved wrapper cannot share`, seed(['referrals/owner', companyOwner], [`caseGroups/${caseId}`, guard(['owner'])]), [
      { path: 'referrals/alias', data: referral('alias', { partnerName: differentName, lumpSumSourceId: 'owner' }) },
      { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6 }) },
    ], admin, false)
  }
}
const canonicalRuleName = (value: string): string => new Function('value', 'includes', `${functions.join('\n')} return canonicalCasePartner(value);`)(value, (values: unknown[], candidate: unknown) => values.some(item => equal(item, candidate)))
assert.equal(canonicalRuleName(' (주) '), '(주)', 'A bare corporation marker gains no trailing space')
assert.equal(canonicalRuleName('(주)아이니웨딩네트웍스'), '(주) 아이니웨딩네트웍스')
assert.equal(canonicalRuleName('(주)    아이티앤코'), '(주) 아이티앤코')
assert.equal(canonicalRuleName('(주)아이패밀리에스씨'), '(주)아이패밀리에스씨', 'Approved tenant contract keeps its exact canonical name')

const third = referral('third', { purchaseType: '미선택', purchaseAmount: null, lumpSumAmount: null, lumpSumSourceId: null })
const three = seed(['referrals/owner', owner], ['referrals/alias', alias], ['referrals/third', third], [`caseGroups/${caseId}`, guard(['owner', 'alias', 'third'])])
const ownerUnlink: Write[] = [
  { path: 'referrals/owner', data: { ...owner, caseGroupId: null, caseBasisLeadId: null } },
  { path: 'referrals/alias', data: { ...alias, caseBasisLeadId: null } },
  { path: 'referrals/third', data: { ...third, caseBasisLeadId: null } },
  { path: `caseGroups/${caseId}`, data: guard(['alias', 'third'], { revision: 6 }) },
]
assertBatch('owner unlink retains remaining aliases external source', three, ownerUnlink, admin, true)
const afterUnlink = postState(three, ownerUnlink)
assert.equal(afterUnlink.get('referrals/alias')!.lumpSumSourceId, 'owner')
assertBatch('unchanged external pointer allows later personal edit', afterUnlink, [{ path: 'referrals/alias', data: { ...alias, caseBasisLeadId: null, note: '분리된 기준 고객' } }], manager, true)
const detachedAlias = { ...alias, caseGroupId: null, caseBasisLeadId: null }
assertBatch('detached alias cannot rewrite physical amount as own sale', seed(['referrals/alias', detachedAlias]), [{ path: 'referrals/alias', data: { ...detachedAlias, lumpSumAmount: 250, purchaseAmount: 250 } }], admin, false)
assertBatch('guard cannot silently omit still-grouped old member', three, [{ path: `caseGroups/${caseId}`, data: guard(['alias', 'third'], { revision: 6 }) }], admin, false)
assertBatch('established manager alias cannot become self owner', base, [
  { path: 'referrals/alias', data: { ...alias, lumpSumSourceId: 'alias', updatedBy: 'manager' } },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6, updatedBy: 'manager' }) },
], manager, false)
assertBatch('manager cannot clear only one alias source', base, [
  { path: 'referrals/alias', data: { ...alias, lumpSumAmount: null, purchaseAmount: null, lumpSumSourceId: null, purchaseType: '미선택', updatedBy: 'manager' } },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6, updatedBy: 'manager' }) },
], manager, false)
assertBatch('manager all-clear owner and aliases allowed', base, [
  ...[['owner', owner], ['alias', alias]].map(([id, data]) => ({ path: `referrals/${id}`, data: { ...(data as Data), lumpSumAmount: null, purchaseAmount: null, lumpSumSourceId: null, purchaseType: '미선택', updatedBy: 'manager' } })),
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6, updatedBy: 'manager' }) },
], manager, true)
const rawAlias = { ...alias, salesRawPeriods: { '2026-09': { confirmedAmount: 100 } } }
assertBatch('all-clear cannot promote retained own RAW on an established alias', seed(['referrals/owner', owner], ['referrals/alias', rawAlias], [`caseGroups/${caseId}`, guard(['owner', 'alias'])]), [
  { path: 'referrals/owner', data: { ...owner, lumpSumAmount: null, purchaseAmount: null, lumpSumSourceId: null, purchaseType: '미선택', updatedBy: 'manager' } },
  { path: 'referrals/alias', data: { ...rawAlias, lumpSumAmount: null, purchaseAmount: null, lumpSumSourceId: null, purchaseType: '미선택', updatedBy: 'manager' } },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6, updatedBy: 'manager' }) },
], manager, false)

const unknownHistory = [{ unknownLegacy: 'preserve' }]
const withHistory = seed(['referrals/owner', { ...owner, caseSharingHistory: unknownHistory }], ['referrals/alias', alias], [`caseGroups/${caseId}`, guard(['owner', 'alias'])])
const newEntry = { at: now, by: 'admin', reason: 'group-share', previous: { lumpSumAmount: 100 } }
assertBatch('history deletion denied', withHistory, [
  { path: 'referrals/owner', data: { ...owner, caseSharingHistory: [] } },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6 }) },
], admin, false)
assertBatch('old unknown raw history preserved and appended', withHistory, [
  { path: 'referrals/owner', data: { ...owner, caseSharingHistory: [...unknownHistory, newEntry] } },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6 }) },
], admin, true)
assertBatch('legacy null history permits initial append', seed(['referrals/owner', { ...owner, caseSharingHistory: null }], ['referrals/alias', alias], [`caseGroups/${caseId}`, guard(['owner', 'alias'])]), [
  { path: 'referrals/owner', data: { ...owner, caseSharingHistory: [newEntry] } },
  { path: `caseGroups/${caseId}`, data: guard(['owner', 'alias'], { revision: 6 }) },
], admin, true)
assertBatch('grouped delete without guard removal denied', base, [{ path: 'referrals/alias', data: null }], admin, false)
assertBatch('grouped delete with guard removal allowed', base, [
  { path: 'referrals/alias', data: null },
  { path: `caseGroups/${caseId}`, data: guard(['owner'], { revision: 6 }) },
], admin, true)

const eightIds = Array.from({ length: 8 }, (_, index) => `member-${index}`)
const eightDocs: [string, Data][] = eightIds.map(id => [`referrals/${id}`, referral(id, { caseBasisLeadId: eightIds[0], lumpSumSourceId: eightIds[0] })])
const eight = seed(...eightDocs, [`caseGroups/${caseId}`, guard(eightIds, { basisLeadId: eightIds[0] })])
const budget = assertBatch('eight-member cached source reads fit guard budget', eight, [{ path: `caseGroups/${caseId}`, data: guard(eightIds, { revision: 6, basisLeadId: eightIds[0] }) }], admin, true)[0]
assert.equal(budget.accesses.filter(path => path.startsWith('after:referrals/')).length, 8)
assert.equal(budget.accessCount, 9, 'Eight cached member reads plus one cached profile read')
const eightOwnerUnlink = assertBatch('eight-member owner unlink also fits cached guard budget', eight, [
  { path: `referrals/${eightIds[0]}`, data: { ...eight.get(`referrals/${eightIds[0]}`), caseGroupId: null, caseBasisLeadId: null } },
  ...eightIds.slice(1).map(id => ({ path: `referrals/${id}`, data: { ...eight.get(`referrals/${id}`), caseBasisLeadId: null } })),
  { path: `caseGroups/${caseId}`, data: guard(eightIds.slice(1), { revision: 6 }) },
], admin, true).at(-1)!
assert.equal(eightOwnerUnlink.accessCount, 9, 'Seven retained post-members plus one removed post-member and the profile')
assertBatch('nine-member guard denied', seed(...eight, ['referrals/ninth', referral('ninth')]), [{ path: `caseGroups/${caseId}`, data: guard([...eightIds, 'ninth'], { revision: 6 }) }], admin, false)
const replacementIds = Array.from({ length: 8 }, (_, index) => `replacement-${index}`)
assertBatch('arbitrary guard replacement with union over eight denied', seed(...eight, ...replacementIds.map(id => [`referrals/${id}`, referral(id)] as [string, Data])), [{
  path: `caseGroups/${caseId}`, data: guard(replacementIds, { revision: 6 }),
}], admin, false)
assertBatch('duplicate guard members denied', base, [{ path: `caseGroups/${caseId}`, data: guard(['owner', 'owner'], { revision: 6 }) }], admin, false)
assertBatch('listed post member must have matching case group', seed(['referrals/owner', { ...owner, caseGroupId: 'another-case' }], [`caseGroups/${caseId}`, guard(['owner'])]), [{ path: `caseGroups/${caseId}`, data: guard(['owner'], { revision: 6 }) }], admin, false)
assertBatch('missing listed post member denied', seed([`caseGroups/${caseId}`, guard(['missing'])]), [{ path: `caseGroups/${caseId}`, data: guard(['missing'], { revision: 6 }) }], admin, false)
const initialGuardSeed = seed(['referrals/owner', owner])
assertBatch('valid initial guard create allowed', initialGuardSeed, [{ path: `caseGroups/${caseId}`, data: guard(['owner'], { revision: 1 }) }], admin, true)

for (const uid of ['store', 'assistant']) assertBatch(`${uid} retains privileged linked save`, base, priceWrites(uid), authFor(uid), true)
for (const auth of [authFor('special'), authFor('disabled'), partner, iniPartner, null]) {
  assertBatch('excluded employee, disabled, partner and unauthenticated cannot mutate referrals', base, [{ path: 'referrals/owner', data: { ...owner, note: '권한 밖 수정' } }], auth, false)
}
const iweddingView = { schemaVersion: 1, partnerId: 'iwedding', partnerName: '(주)아이패밀리에스씨', publishedAt: now, months: [] }
const iniView = { ...iweddingView, partnerId: 'iniwedding', partnerName: iniProfile.partnerName }
const views = seed(['partnerViews/iwedding', iweddingView], ['partnerViews/iniwedding', iniView], ['partnerViews/other', { partnerId: 'other' }], ['referrals/owner', owner], [`caseGroups/${caseId}`, guard(['owner'])], ['usage/admin', {}], ['adminSources/source', {}])
for (const [auth, own, other] of [[partner, 'iwedding', 'iniwedding'], [iniPartner, 'iniwedding', 'iwedding']] as const) {
  assert.equal(evaluate(views, views, `partnerViews/${own}`, 'get', auth).allowed, true)
  assert.equal(evaluate(views, views, `partnerViews/${own}`, 'list', auth).allowed, false, 'Partners cannot list, even for their own document')
  for (const path of [`partnerViews/${other}`, 'partnerViews/other', 'referrals/owner', `caseGroups/${caseId}`, 'usage/admin', 'adminSources/source']) {
    assert.equal(evaluate(views, views, path, 'get', auth).allowed, false, `Partner read scope: ${path}`)
  }
}
assert.equal(evaluate(views, views, 'partnerViews/iniwedding', 'list', admin).allowed, true, 'Authorized staff retain publication list access')
assert.equal(evaluate(views, views, 'partnerViews/iniwedding', 'get', authFor('ini-partner', 'e90227@d5.local')).allowed, false, 'Tenant profile must match token email')
for (const change of [{ partnerId: 'iwedding' }, { partnerName: iweddingView.partnerName }, { loginId: 'E90227' }, { approved: false }, { active: false }, { mustChangePassword: true }]) {
  const invalid = new Map(views)
  invalid.set('profiles/ini-partner', { ...iniProfile, ...change })
  assert.equal(evaluate(invalid, invalid, 'partnerViews/iniwedding', 'get', iniPartner).allowed, false, 'Invalid or not-ready profile cannot read publication')
}
for (const publication of [iweddingView, iniView]) {
  const path = `partnerViews/${publication.partnerId}`
  assertBatch('admin can publish a matching tenant view', seed(), [{ path, data: publication }], admin, true)
  assertBatch('partner cannot edit a tenant view', views, [{ path, data: publication }], iniPartner, false)
}
assertBatch('admin cannot publish a cross-tenant name', views, [{ path: 'partnerViews/iniwedding', data: { ...iniView, partnerName: iweddingView.partnerName } }], admin, false)
assertBatch('admin cannot publish an unknown tenant', views, [{ path: 'partnerViews/other', data: { ...iniView, partnerId: 'other' } }], admin, false)
assertBatch('partner cannot switch tenant profile', views, [{ path: 'profiles/ini-partner', data: { ...iniProfile, partnerId: 'iwedding' } }], iniPartner, false)
for (const path of ['referrals/owner', `caseGroups/${caseId}`, 'usage/admin']) assert.equal(evaluate(views, views, path, 'get', authFor('special')).allowed, false, `Employee 1292 remains excluded: ${path}`)
assert.equal(evaluate(views, views, 'profiles/special', 'get', authFor('special')).allowed, true, 'The excluded employee may still read their own profile')

const mergedIds = ['alias', 'owner']
const mergeWrites: Write[] = [
  { path: 'referrals/owner', data: { ...legacyA, caseBasisLeadId: 'owner', caseMergeMemberIds: mergedIds } },
  { path: 'referrals/alias', data: { ...legacyB, caseBasisLeadId: 'owner', caseMergeMemberIds: mergedIds } },
  { path: `caseGroups/${caseId}`, data: guard(mergedIds, { revision: 6, mergeMemberIds: mergedIds }) },
]
assertBatch('explicit admin sum choice preserves independent A100/B200', legacy, mergeWrites, admin, true)
const merged = postState(legacy, mergeWrites)
assert.equal(merged.get('referrals/owner')!.lumpSumAmount, 100)
assert.equal(merged.get('referrals/alias')!.lumpSumAmount, 200)
assertBatch('manager cannot establish merged mode', legacy, mergeWrites.map(write => ({ ...write, data: { ...write.data, updatedBy: 'manager' } })), manager, false)
assertBatch('merged metadata without guard bump denied', legacy, mergeWrites.slice(0, 2), admin, false)
assertBatch('sum choice must mirror every member', legacy, [mergeWrites[0], mergeWrites[2]], admin, false)
assertBatch('sum choice cannot list subset roster', legacy, mergeWrites.map(write => ({ ...write, data: { ...write.data, ...(write.path.startsWith('referrals/') ? { caseMergeMemberIds: ['owner'] } : { mergeMemberIds: ['owner'] }) } })), admin, false)
assertBatch('sum choice must be sorted unique full roster', legacy, mergeWrites.map(write => ({ ...write, data: { ...write.data, ...(write.path.startsWith('referrals/') ? { caseMergeMemberIds: ['owner', 'alias'] } : { mergeMemberIds: ['owner', 'alias'] }) } })), admin, false)
assertBatch('sum choice needs primary basis', legacy, mergeWrites.map(write => ({ ...write, data: { ...write.data, ...(write.path.startsWith('referrals/') ? { caseBasisLeadId: null } : { basisLeadId: null }) } })), admin, false)
assertBatch('sum choice cannot cross company', seed(['referrals/owner', legacyA], ['referrals/alias', { ...legacyB, partnerName: '다른 업체' }], [`caseGroups/${caseId}`, guard(mergedIds, { basisLeadId: null })]), mergeWrites.map(write => write.path === 'referrals/alias' ? { ...write, data: { ...write.data, partnerName: '다른 업체' } } : write), admin, false)
assertBatch('manager established sum price edit retains mode', merged, [
  { path: 'referrals/owner', data: { ...merged.get('referrals/owner'), lumpSumAmount: 350, purchaseAmount: 350, lumpSumSourceId: 'owner', updatedBy: 'manager' } },
  { path: 'referrals/alias', data: { ...merged.get('referrals/alias'), lumpSumAmount: 350, purchaseAmount: 350, lumpSumSourceId: 'owner', updatedBy: 'manager' } },
  { path: `caseGroups/${caseId}`, data: guard(mergedIds, { revision: 7, mergeMemberIds: mergedIds, updatedBy: 'manager' }) },
], manager, true)
const clearMergeWrites = mergeWrites.map(write => ({ ...write, data: { ...write.data,
  ...(write.path.startsWith('referrals/') ? { caseMergeMemberIds: null } : { revision: 7, mergeMemberIds: null }) } }))
assertBatch('admin may explicitly return sum to one primary without changing prices', merged, clearMergeWrites, admin, true)
assertBatch('manager cannot clear established sum mode', merged, clearMergeWrites.map(write => ({ ...write, data: { ...write.data, updatedBy: 'manager' } })), manager, false)
assertBatch('guard only silent sum-clear denied', merged, [clearMergeWrites[2]], admin, false)
const memberExpanded = referral('new-member', { caseBasisLeadId: 'owner', lumpSumAmount: 400, purchaseAmount: 400 })
assertBatch('roster expansion cannot reuse old merge approval', merged, [
  { path: 'referrals/new-member', data: memberExpanded },
  { path: `caseGroups/${caseId}`, data: guard(['alias', 'new-member', 'owner'], { revision: 7, mergeMemberIds: mergedIds }) },
], admin, false)
assertBatch('roster expansion explicitly clears old merge approval', merged, [
  ...clearMergeWrites.slice(0, 2),
  { path: 'referrals/new-member', data: memberExpanded },
  { path: `caseGroups/${caseId}`, data: guard(['alias', 'new-member', 'owner'], { revision: 7, mergeMemberIds: null }) },
], admin, true)
assertBatch('standalone creation cannot inject sum metadata', seed(), [{ path: 'referrals/standalone', data: referral('standalone', { caseGroupId: null, caseBasisLeadId: null, caseMergeMemberIds: mergedIds }) }], admin, false)
const eightMerge = seed(...eightDocs.map(([path, data]) => [path, { ...data, caseMergeMemberIds: eightIds }] as [string, Data]), [`caseGroups/${caseId}`, guard(eightIds, { basisLeadId: eightIds[0], mergeMemberIds: eightIds })])
const mergeBudget = assertBatch('eight-member merge uses cached primary and fits guard budget', eightMerge, [{ path: `caseGroups/${caseId}`, data: guard(eightIds, { revision: 6, basisLeadId: eightIds[0], mergeMemberIds: eightIds }) }], admin, true)[0]
assert.equal(mergeBudget.accessCount, 9)
assert.equal(mergeBudget.accesses.filter(path => path.startsWith('after:referrals/')).length, 8)
const mergedReplacement = [
  { path: 'referrals/owner', data: { ...merged.get('referrals/owner'), lumpSumAmount: 350, purchaseAmount: 350, lumpSumSourceId: 'owner', updatedBy: 'manager' } },
  { path: 'referrals/alias', data: { ...merged.get('referrals/alias'), lumpSumAmount: 350, purchaseAmount: 350, lumpSumSourceId: 'owner', updatedBy: 'manager' } },
  { path: `caseGroups/${caseId}`, data: guard(mergedIds, { revision: 7, mergeMemberIds: mergedIds, updatedBy: 'manager' }) },
]
assertBatch('approved merged transfer still requires guard bump', merged, mergedReplacement.slice(0, 2), manager, false)
assertBatch('approved merged transfer cannot use other primary', merged, mergedReplacement.map(write => write.path.startsWith('referrals/')
  ? { ...write, data: { ...write.data, caseBasisLeadId: 'alias', lumpSumSourceId: 'alias' } }
  : { ...write, data: { ...write.data, basisLeadId: 'alias' } }), manager, false)
assertBatch('approved merged transfer cannot inject external owner', merged, mergedReplacement.map(write => write.path === 'referrals/alias'
  ? { ...write, data: { ...write.data, lumpSumSourceId: 'external' } } : write), manager, false)
assertBatch('approved merged transfer cannot cross company', merged, mergedReplacement.map(write => write.path === 'referrals/alias'
  ? { ...write, data: { ...write.data, partnerName: '다른 업체' } } : write), manager, false)
const staleApproval = new Map(merged)
staleApproval.set(`caseGroups/${caseId}`, guard(mergedIds, { revision: 6, mergeMemberIds: null }))
assertBatch('stale guard approval is not a merge-transfer grant', staleApproval, mergedReplacement, manager, false)
const newlyForgedApproval = mergedReplacement.map(write => ({ ...write, data: { ...write.data,
  ...(write.path.startsWith('referrals/') ? {} : { revision: 6 }) } }))
assertBatch('new forged merge approval cannot promote prior independent source', legacy, newlyForgedApproval, manager, false)
const eightIndependentMerge = seed(...eightDocs.map(([path, data]) => [path, { ...data,
  lumpSumSourceId: path.split('/')[1], caseMergeMemberIds: eightIds }] as [string, Data]),
  [`caseGroups/${caseId}`, guard(eightIds, { basisLeadId: eightIds[0], mergeMemberIds: eightIds })])
const eightTransfers = assertBatch('eight independent merged originals replace total within full batch budget', eightIndependentMerge, [
  ...eightIds.map(id => ({ path: `referrals/${id}`, data: { ...eightIndependentMerge.get(`referrals/${id}`),
    lumpSumAmount: 900, purchaseAmount: 900, lumpSumSourceId: eightIds[0], updatedBy: 'manager' } })),
  { path: `caseGroups/${caseId}`, data: guard(eightIds, { revision: 6, basisLeadId: eightIds[0], mergeMemberIds: eightIds, updatedBy: 'manager' }) },
], manager, true)
assert.equal(new Set(eightTransfers.flatMap(result => result.accesses)).size, 11)
console.log(`caseSharingRules: ${checked} synthetic actual-body rule fixtures passed; cached eight-member merge guard accesses=${mergeBudget.accessCount}. Not an official Firestore compiler/emulator.`)
