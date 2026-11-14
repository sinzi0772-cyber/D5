import { CaseSaveError, MAX_CASE_MEMBERS, saveCaseCustomerWithStore, unlinkCaseCustomerWithStore, type CaseSharingStore } from '../../src/lib/caseSharingSave'
import { caseSharingDraftFor } from '../../src/lib/caseSharing'
import { caseEditableFields, caseMemberRevision, caseNewCustomerFields, type CaseSharingRequest } from '../../src/lib/caseSharingRequest'
import { leadFromDocument } from '../../src/lib/leadDocument'
import { canonicalPartnerName } from '../../src/lib/partners'
import { isPartnerAppointmentType } from '../../src/lib/partnerAppointments'
import { maskCustomerName } from '../../src/lib/salesRaw'
import { isValidDeliveryDate } from '../../src/lib/deliverySchedule'
import { accountAccessError } from '../../src/lib/accountAccess'
import { isBestCancellationMemo } from '../../src/lib/memoHistory'
import { normalizeLoginId } from '../../src/lib/loginIdentity'
import { STATUSES, type Lead, type MemoEntry } from '../../src/types'
import { CaseSharingFirestoreError, createCaseSharingStore, getCaseSharingProfile } from './firestore'
import { CaseSharingIdentityError, getCaseSharingAccessToken, verifyFirebaseIdToken } from './identity'

const roles = ['admin', 'store_manager', 'assistant_manager']
const allowedValues: Record<string, readonly string[]> = {
  status: STATUSES,
  visitState: ['미정', '예정', '방문', '미방문', '일정취소'],
  purchaseType: ['미선택', '일시불', '구독', '일시불+구독'],
}
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !value.includes('/') && !/[\x00-\x1f]/.test(value)
const hasOnly = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key))

function validChanges(value: unknown): boolean {
  if (!isRecord(value) || !hasOnly(value, caseEditableFields)) return false
  return Object.entries(value).every(([key, entry]) => {
    if (key === 'appointmentType') return isPartnerAppointmentType(entry)
    if (key === 'memoHistory') return Array.isArray(entry) && entry.length <= 1000 && entry.every(item =>
      isRecord(item) && hasOnly(item, ['id', 'date', 'manager', 'content'])
      && isId(item.id) && ['date', 'manager', 'content'].every(field => typeof item[field] === 'string'))
    if (entry === null) return !['status', 'visitState'].includes(key)
    if (key.endsWith('Amount')) return typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0
    if (typeof entry !== 'string') return false
    return allowedValues[key]?.includes(entry) ?? (entry.length <= 10000)
  })
}

function preservedMemoUpdate(previous: readonly MemoEntry[], next: readonly MemoEntry[]): MemoEntry[] {
  const originals = new Map(previous.map(entry => [entry.id, entry]))
  const revisions = new Map(next.map(entry => [entry.id, entry]))
  if (revisions.size !== next.length || previous.some(entry => !revisions.has(entry.id))
    || next.some(entry => isBestCancellationMemo(entry) && !originals.has(entry.id))) {
    throw new CaseSaveError('CASE_SAVE_MEMO_HISTORY', '기존 관리메모를 보존할 수 없습니다. 상세 화면을 다시 열어 확인해주세요.')
  }
  return next.map(entry => {
    const original = originals.get(entry.id)
    if (!original) return entry
    return isBestCancellationMemo(original) ? original : { ...original, content: entry.content }
  })
}

function parseRequest(value: unknown): CaseSharingRequest | null {
  if (!isRecord(value)) return null
  if (value.operation === 'check') return hasOnly(value, ['operation']) ? { operation: 'check' } : null
  if (!isId(value.leadId) || !Array.isArray(value.members) || value.members.length < 1 || value.members.length > MAX_CASE_MEMBERS) return null
  if (value.members.some(member => !isRecord(member) || !hasOnly(member, ['id', 'revision'])
    || !isId(member.id) || typeof member.revision !== 'string' || !/^[0-9a-f]{64}$/.test(member.revision))) return null
  const ids = new Set(value.members.map(member => member.id as string))
  if (ids.size !== value.members.length) return null
  if (value.operation === 'unlink') {
    return ids.size >= 2 && ids.has(value.leadId) && hasOnly(value, ['operation', 'leadId', 'members']) ? value as unknown as CaseSharingRequest : null
  }
  if (value.operation !== 'save' || !hasOnly(value, ['operation', 'leadId', 'members', 'targetIds', 'basis', 'changes', 'newCustomer'])) return null
  if (!Array.isArray(value.targetIds) || value.targetIds.length >= MAX_CASE_MEMBERS || new Set(value.targetIds).size !== value.targetIds.length
    || value.targetIds.some(id => !isId(id) || !ids.has(id) || id === value.leadId)) return null
  if (!isRecord(value.basis) || !hasOnly(value.basis, ['caseLeadId', 'mergePurchaseAmounts'])
    || value.basis.caseLeadId !== undefined && (!isId(value.basis.caseLeadId) || value.basis.caseLeadId !== value.leadId && !ids.has(value.basis.caseLeadId))
    || value.basis.mergePurchaseAmounts !== undefined && (typeof value.basis.mergePurchaseAmounts !== 'boolean' || !value.basis.caseLeadId)
    || value.targetIds.length > 0 && !value.basis.caseLeadId || !validChanges(value.changes)) return null
  if (value.newCustomer !== undefined) {
    const item = value.newCustomer
    if (value.targetIds.length === 0 || ids.has(value.leadId) || !isRecord(item) || !hasOnly(item, caseNewCustomerFields)
      || Object.values(item).some(entry => typeof entry !== 'string' || entry.length > 200)
      || typeof item.customerName !== 'string' || !item.customerName.trim() || typeof item.partnerName !== 'string' || !item.partnerName.trim()
      || typeof item.phoneLast4 !== 'string' || !/^\d{4}$/.test(item.phoneLast4)
      || !isValidDeliveryDate(item.registeredAt) || !['남', '여', '미입력'].includes(String(item.gender))) return null
  } else if (ids.size < 2 || !ids.has(value.leadId)) return null
  return value as unknown as CaseSharingRequest
}

function response(body: object, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function failure(status: number, code: string, message: string): Response {
  return response({ code, message }, status)
}

async function loadMembers(store: CaseSharingStore, request: Exclude<CaseSharingRequest, { operation: 'check' }>): Promise<Lead[]> {
  return Promise.all(request.members.map(async ({ id, revision }) => {
    const data = await store.getLead(id)
    if (!data) throw new CaseSaveError('CASE_SAVE_CUSTOMER_MISSING', '고객 정보가 삭제되었습니다. 화면을 다시 열어 확인해주세요.')
    const lead = leadFromDocument(id, data)
    if ((await caseMemberRevision(lead)).revision !== revision) {
      throw new CaseSaveError('CASE_SAVE_STALE_CUSTOMER', '고객 정보가 변경되었습니다. 상세 화면을 다시 열어 확인해주세요.')
    }
    return lead
  }))
}

async function changeCase(
  store: CaseSharingStore,
  payload: Exclude<CaseSharingRequest, { operation: 'check' }>,
  actorId: string,
  employeeNo: string,
) {
  const members = await loadMembers(store, payload)
  const creating = payload.operation === 'save' && !!payload.newCustomer
  const original = creating
    ? leadFromDocument(payload.leadId, { ...payload.newCustomer, status: '관리중', visitState: '미정' })
    : members.find(member => member.id === payload.leadId)!
  const assertSession = () => {} // The REST adapter checks the authorized profile again in the transaction.

  if (payload.operation === 'unlink') {
    return unlinkCaseCustomerWithStore(store, { lead: original, openingMembers: members, actorId, canManageAll: true, assertSession })
  }
  if (!payload.targetIds.length && !original.caseGroupId) {
    throw new CaseSaveError('CASE_SAVE_INVALID_GROUP', '연결할 접수건 정보를 다시 확인해주세요.')
  }
  const existingMembers = original.caseGroupId ? members.filter(member => member.caseGroupId === original.caseGroupId) : [original]
  const choice = payload.targetIds.length ? undefined : payload.basis.caseLeadId
  const baseline = caseSharingDraftFor(original, existingMembers, choice, choice ? payload.basis.mergePurchaseAmounts : undefined).draft
  const draft = { ...baseline }
  for (const [key, value] of Object.entries(payload.changes)) {
    const next = key === 'memoHistory' ? preservedMemoUpdate(original.memoHistory ?? [], value as MemoEntry[]) : value ?? undefined
    Object.assign(draft, { [key]: next })
  }
  if (creating) {
    draft.customerName = maskCustomerName(draft.customerName)
    draft.partnerName = canonicalPartnerName(draft.partnerName)
  }
  return saveCaseCustomerWithStore(store, { original, draft, formBaseline: baseline, openingMembers: creating ? [...members, original] : members,
    creating, linkTargetIds: payload.targetIds, basis: payload.basis, actorId, actorEmployeeNo: employeeNo, canManageAll: true, assertSession })
}

export async function handleCaseSharing(request: Request): Promise<Response> {
  if (request.method !== 'POST') return failure(405, 'INVALID_METHOD', '저장 요청 방식을 확인해주세요.')
  const token = request.headers.get('authorization')?.match(/^Bearer ([\w.-]{1,8192})$/i)?.[1]
  if (!token) return failure(401, 'INVALID_AUTH', '다시 로그인한 뒤 저장해주세요.')
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return failure(415, 'INVALID_REQUEST', '저장 요청을 확인해주세요.')

  try {
    let value: unknown
    try {
      const text = await request.text()
      if (text.length > 256_000) return failure(413, 'INVALID_REQUEST', '저장할 입력 내용이 너무 깁니다.')
      value = JSON.parse(text)
    } catch {
      return failure(400, 'INVALID_REQUEST', '저장 요청을 확인해주세요.')
    }
    const payload = parseRequest(value)
    if (!payload) return failure(400, 'INVALID_REQUEST', '묶을 고객과 입력 내용을 다시 확인해주세요.')
    const { uid, email } = await verifyFirebaseIdToken(token)
    const employeeNo = email.endsWith('@d5.local') ? normalizeLoginId(email.slice(0, -9)) : ''
    if (!employeeNo || !isId(uid)) return failure(403, 'CASE_FORBIDDEN', '고객 연결을 저장할 권한이 없습니다.')
    const accessToken = await getCaseSharingAccessToken(request.headers.get('x-vercel-oidc-token') ?? '')
    const profile = await getCaseSharingProfile(uid, accessToken)
    const role = profile?.role
    if (typeof role !== 'string' || !roles.includes(role) || profile?.mustChangePassword || accountAccessError(employeeNo, profile ?? undefined)) {
      return failure(403, 'CASE_FORBIDDEN', '고객 연결을 저장할 권한이 없습니다.')
    }
    if (payload.operation === 'check') return response({ ready: true })
    const store = createCaseSharingStore(accessToken, fetch, { authorizedProfile: { uid, employeeNo, role } })
    return response(await changeCase(store, payload, uid, employeeNo))
  } catch (error) {
    if (error instanceof CaseSaveError) return failure(409, error.code, error.message)
    if (error instanceof CaseSharingIdentityError && error.code === 'INVALID_AUTH') return failure(401, error.code, '다시 로그인한 뒤 저장해주세요.')
    if (error instanceof CaseSharingFirestoreError) {
      if (error.code === 'ROLE_CHANGED') return failure(403, error.code, '저장 권한이 변경되었습니다. 다시 로그인해주세요.')
      if (['ABORTED', 'ROSTER_CHANGED', 'DOCUMENT_CHANGED', 'FAILED_PRECONDITION'].includes(error.code)) {
        return failure(409, 'CASE_CHANGED', '저장 중 고객 정보가 변경되었습니다. 상세 화면을 다시 열어 확인해주세요.')
      }
    }
    const code = error instanceof CaseSharingFirestoreError || error instanceof CaseSharingIdentityError ? error.code : 'CASE_SERVICE_ERROR'
    console.error('Case sharing service failed', code)
    return failure(503, 'CASE_SERVICE_ERROR', '묶음 저장 서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해주세요.')
  }
}
