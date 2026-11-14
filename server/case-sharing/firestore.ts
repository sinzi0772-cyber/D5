import { accountAccessError } from '../../src/lib/accountAccess'
import { MAX_CASE_MEMBERS, type CaseGroupGuard } from '../../src/lib/caseSharing'
import type { CaseSharingStore, CaseSharingTransaction } from '../../src/lib/caseSharingSave'

const documents = 'projects/d5-partner-desk/databases/(default)/documents'
const firestoreURL = 'https://firestore.googleapis.com/v1/' + documents
const transactionAttempts = 3
const staffRoles = ['admin', 'store_manager', 'assistant_manager']

type Data = Record<string, unknown>
type FirestoreValue = Record<string, unknown>
type FirestoreFields = Record<string, FirestoreValue>
type FirestoreDocument = { name: string; fields?: FirestoreFields; updateTime: string }
type ExistingDocument = { data: Data; updateTime: string }
type Collection = 'referrals' | 'caseGroups' | 'profiles'
type Write = {
  update: { name: string; fields: FirestoreFields }
  updateMask?: { fieldPaths: string[] }
  currentDocument: { exists: false } | { updateTime: string }
}
type AuthorizedProfile = { uid: string; employeeNo: string; role: string }

export class CaseSharingFirestoreError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super('Firestore case save failed')
    this.name = 'CaseSharingFirestoreError'
    this.status = status
    this.code = code
  }
}

function malformedResponse(): never {
  throw new CaseSharingFirestoreError(502, 'INVALID_FIRESTORE_RESPONSE')
}

function documentName(collection: Collection, id: string) {
  if (!id || id.length > 200 || id.trim() !== id || id.includes('/') || id === '.' || id === '..') {
    throw new CaseSharingFirestoreError(400, 'INVALID_DOCUMENT_ID')
  }
  return documents + '/' + collection + '/' + id
}

function isObject(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Keep original wire values on decoded containers. Existing audit entries may
 * have nested fields from older versions, so copying them back must retain
 * Firestore types and integer precision even for fields the app does not use.
 */
function firestoreCodec() {
  const originalValues = new WeakMap<object, FirestoreValue>()
  const decodeFields = (fields: FirestoreFields = {}): Data => Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decode(value)]),
  )

  function decode(value: FirestoreValue): unknown {
    if ('nullValue' in value) return null
    if ('stringValue' in value) return value.stringValue
    if ('booleanValue' in value) return value.booleanValue
    if ('integerValue' in value || 'doubleValue' in value) return Number(value.integerValue ?? value.doubleValue)

    let decoded: object
    if ('mapValue' in value) {
      decoded = decodeFields((value.mapValue as { fields?: FirestoreFields }).fields)
    } else if ('arrayValue' in value) {
      decoded = ((value.arrayValue as { values?: FirestoreValue[] }).values ?? []).map(decode)
    } else if (typeof value.timestampValue === 'string') {
      const fractions = /[.]([0-9]{1,9})Z$/.exec(value.timestampValue)?.[1] ?? ''
      const seconds = Math.floor(Date.parse(value.timestampValue) / 1000)
      if (!Number.isFinite(seconds)) return malformedResponse()
      decoded = { seconds, nanoseconds: Number(fractions.padEnd(9, '0')) }
    } else {
      // Other wire types are not customer fields the app edits. Preserve them
      // if they appear in an old audit entry copied by the case save.
      decoded = { firestoreValue: value }
    }
    originalValues.set(decoded, value)
    return decoded
  }

  const encodeFields = (data: Data): FirestoreFields => Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, encode(value)]),
  )

  function encode(value: unknown): FirestoreValue {
    if (value === null) return { nullValue: null }
    if (typeof value === 'string') return { stringValue: value }
    if (typeof value === 'boolean') return { booleanValue: value }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
    }
    if (value && typeof value === 'object') {
      const original = originalValues.get(value)
      if (original) return original
      if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
      if (isObject(value)) return { mapValue: { fields: encodeFields(value) } }
    }
    throw new CaseSharingFirestoreError(400, 'UNSUPPORTED_FIELD_VALUE')
  }

  return { decodeFields, encodeFields }
}

function firestoreReader(token: string, fetchImpl: typeof fetch) {
  const codec = firestoreCodec()

  async function request(endpoint: string, body: Data): Promise<unknown> {
    const response = await fetchImpl(firestoreURL + endpoint, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    })
    let result: unknown
    try {
      result = await response.json()
    } catch {
      if (response.ok) return malformedResponse()
    }
    if (!response.ok) {
      const error = isObject(result) && isObject(result.error) ? result.error : null
      const code = error && typeof error.status === 'string' && /^[A-Z_]+$/.test(error.status) ? error.status : 'FIRESTORE_REQUEST_FAILED'
      throw new CaseSharingFirestoreError(response.status, code)
    }
    return result
  }

  function parseDocument(document: unknown, name: string): ExistingDocument {
    const parsed = document as FirestoreDocument
    if (!isObject(document) || parsed.name !== name || typeof parsed.updateTime !== 'string'
      || (parsed.fields !== undefined && !isObject(parsed.fields))) return malformedResponse()
    return { data: codec.decodeFields(parsed.fields), updateTime: parsed.updateTime }
  }

  async function getDocument(name: string, transaction?: string): Promise<ExistingDocument | null> {
    const result = await request(':batchGet', { documents: [name], ...(transaction ? { transaction } : {}) })
    if (!Array.isArray(result) || result.length !== 1 || !isObject(result[0])) return malformedResponse()
    if (result[0].missing === name && result[0].found === undefined) return null
    return parseDocument(result[0].found, name)
  }

  async function queryMembers(caseId: string, transaction?: string) {
    documentName('caseGroups', caseId)
    const result = await request(':runQuery', {
      structuredQuery: {
        from: [{ collectionId: 'referrals' }],
        where: { fieldFilter: { field: { fieldPath: 'caseGroupId' }, op: 'EQUAL', value: { stringValue: caseId } } },
        limit: MAX_CASE_MEMBERS + 1,
      },
      ...(transaction ? { transaction } : {}),
    })
    if (!Array.isArray(result)) return malformedResponse()
    const ids = new Set<string>()
    const referrals = []
    for (const row of result) {
      if (!isObject(row) || row.skippedResults) return malformedResponse()
      if (row.document === undefined) continue
      const name = (row.document as FirestoreDocument).name
      const prefix = documents + '/referrals/'
      if (typeof name !== 'string' || !name.startsWith(prefix)) return malformedResponse()
      const id = name.slice(prefix.length)
      if (documentName('referrals', id) !== name || ids.has(id)) return malformedResponse()
      ids.add(id)
      const existing = parseDocument(row.document, name)
      if (existing.data.caseGroupId !== caseId) return malformedResponse()
      referrals.push({ id, ...existing })
    }
    return referrals
  }

  return { codec, request, getDocument, queryMembers }
}

export async function getCaseSharingProfile(uid: string, token: string, fetchImpl: typeof fetch = fetch): Promise<Data | null> {
  const reader = firestoreReader(token, fetchImpl)
  return (await reader.getDocument(documentName('profiles', uid)))?.data ?? null
}

function matchesAuthorizedProfile(profile: Data | undefined, expected: AuthorizedProfile): boolean {
  return profile?.role === expected.role && staffRoles.includes(expected.role)
    && !profile.mustChangePassword && accountAccessError(expected.employeeNo, profile) === null
}

export function createCaseSharingStore(
  token: string,
  fetchImpl: typeof fetch = fetch,
  options: { authorizedProfile?: AuthorizedProfile } = {},
): CaseSharingStore {
  const { codec, request, getDocument, queryMembers } = firestoreReader(token, fetchImpl)
  const observedRosters = new Map<string, string[]>()

  async function transaction<T>(work: (tx: CaseSharingTransaction) => Promise<T>): Promise<T> {
    let previousTransaction: string | undefined
    for (let attempt = 0; attempt < transactionAttempts; attempt++) {
      let transactionId: string | undefined
      try {
        const begin = await request(':beginTransaction', {
          options: { readWrite: previousTransaction ? { retryTransaction: previousTransaction } : {} },
        })
        if (!isObject(begin) || typeof begin.transaction !== 'string' || !begin.transaction) return malformedResponse()
        transactionId = begin.transaction

        if (options.authorizedProfile) {
          const live = await getDocument(documentName('profiles', options.authorizedProfile.uid), transactionId)
          if (!matchesAuthorizedProfile(live?.data, options.authorizedProfile)) {
            throw new CaseSharingFirestoreError(403, 'ROLE_CHANGED')
          }
        }

        const reads = new Map<string, ExistingDocument | null>()
        const writes = new Map<string, Write>()
        for (const [caseId, observed] of observedRosters) {
          const referrals = await queryMembers(caseId, transactionId)
          const latest = referrals.map(({ id }) => id).sort()
          if (latest.length !== observed.length || latest.some((id, index) => id !== observed[index])) {
            throw new CaseSharingFirestoreError(409, 'ROSTER_CHANGED')
          }
          for (const { id, ...existing } of referrals) reads.set(documentName('referrals', id), existing)
        }

        async function read(name: string): Promise<Data | null> {
          if (writes.size) throw new CaseSharingFirestoreError(500, 'READ_AFTER_WRITE')
          if (!reads.has(name)) reads.set(name, await getDocument(name, transactionId))
          return reads.get(name)?.data ?? null
        }

        function stage(name: string, data: Data, operation: 'create' | 'update' | 'set') {
          const snapshot = reads.get(name)
          if (snapshot === undefined || writes.has(name)) throw new CaseSharingFirestoreError(500, 'INVALID_WRITE_ORDER')
          if ((operation === 'create' && snapshot) || (operation === 'update' && !snapshot)) {
            throw new CaseSharingFirestoreError(409, 'DOCUMENT_CHANGED')
          }
          const fieldPaths = Object.keys(data)
          if (!fieldPaths.length || fieldPaths.some(key => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key))) {
            throw new CaseSharingFirestoreError(500, 'INVALID_WRITE_MASK')
          }
          writes.set(name, {
            update: { name, fields: codec.encodeFields(data) },
            ...(snapshot ? { updateMask: { fieldPaths } } : {}),
            currentDocument: snapshot ? { updateTime: snapshot.updateTime } : { exists: false },
          })
        }

        const outcome = await work({
          getLead: id => read(documentName('referrals', id)),
          getGuard: async id => await read(documentName('caseGroups', id)) as CaseGroupGuard | null,
          createLead: (id, data) => stage(documentName('referrals', id), data, 'create'),
          updateLead: (id, data) => stage(documentName('referrals', id), data, 'update'),
          setGuard: (id, guard) => stage(documentName('caseGroups', id), { ...guard }, 'set'),
        })

        if (!writes.size) {
          await request(':rollback', { transaction: transactionId }).catch(() => undefined)
          return outcome
        }
        const commit = await request(':commit', { transaction: transactionId, writes: [...writes.values()] })
        if (!isObject(commit) || !Array.isArray(commit.writeResults) || commit.writeResults.length !== writes.size) {
          return malformedResponse()
        }
        return outcome
      } catch (error) {
        const retry = error instanceof CaseSharingFirestoreError && error.code === 'ABORTED' && attempt + 1 < transactionAttempts
        if (!retry) {
          if (transactionId) await request(':rollback', { transaction: transactionId }).catch(() => undefined)
          throw error
        }
        previousTransaction = transactionId
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)))
      }
    }
    throw new CaseSharingFirestoreError(409, 'ABORTED')
  }

  return {
    getLead: async id => (await getDocument(documentName('referrals', id)))?.data ?? null,
    getGuard: async id => ((await getDocument(documentName('caseGroups', id)))?.data ?? null) as CaseGroupGuard | null,
    getMembers: async id => {
      const rows = await queryMembers(id)
      observedRosters.set(id, rows.map(row => row.id).sort())
      return rows.map(({ id, data }) => ({ id, data }))
    },
    transaction,
  }
}
