import { collection, doc, getDocFromServer, getDocsFromServer, query, runTransaction, where, type Firestore } from 'firebase/firestore'
import type { Lead } from '../types'
import { leadFromDocument } from './leadDocument'
import { caseSaveDeliveryError } from './commissionSettlement'
import { canonicalPartnerName } from './partners'
import { isPartnerAppointmentType } from './partnerAppointments'
import { CaseSharingError, MAX_CASE_MEMBERS, caseSharingRevisionFor, resolveCaseSharing, wholeCaseBasisId, type CaseGroupGuard, type CaseSharingConflict, type SharingBasis } from './caseSharing'

export { MAX_CASE_MEMBERS } from './caseSharing'

export interface SaveCaseCustomerInput {
  original: Lead
  draft: Lead
  formBaseline: Lead
  openingMembers: readonly Lead[]
  creating: boolean
  linkTargetId?: string
  linkTargetIds?: readonly string[]
  actorId: string
  actorEmployeeNo: string
  canManageAll: boolean
  basis?: SharingBasis
  assertSession: () => void
}

export interface UnlinkCaseCustomerInput {
  lead: Lead
  openingMembers: readonly Lead[]
  actorId: string
  canManageAll: boolean
  assertSession: () => void
}

export class CaseSaveError extends Error {
  readonly code: string
  readonly conflicts?: CaseSharingConflict[]
  constructor(code: string, message: string, conflicts?: CaseSharingConflict[]) {
    super(message)
    this.name = 'CaseSaveError'
    this.code = code
    this.conflicts = conflicts
  }
}

type Data = Record<string, unknown>
export interface CaseSharingTransaction {
  getLead: (id: string) => Promise<Data | null>
  getGuard: (caseId: string) => Promise<CaseGroupGuard | null>
  createLead: (id: string, payload: Data) => void
  updateLead: (id: string, payload: Data) => void
  setGuard: (caseId: string, guard: CaseGroupGuard) => void
}

/** This seam supports synthetic tests without initializing a Firebase app. */
export interface CaseSharingStore {
  getLead: (id: string) => Promise<Data | null>
  getGuard: (caseId: string) => Promise<CaseGroupGuard | null>
  getMembers: (caseId: string) => Promise<{ id: string; data: Data }[]>
  transaction: <T>(work: (transaction: CaseSharingTransaction) => Promise<T>) => Promise<T>
}

const sharedFields = ['manager', 'managerEmployeeNo', 'purchaseType', 'purchaseAmount', 'lumpSumAmount', 'subscriptionAmount', 'lumpSumSourceId', 'subscriptionSourceId', 'caseBasisLeadId', 'caseMergeMemberIds', 'caseSharingHistory'] as const
const personalFields = ['visitScheduledDate', 'deliveryScheduledDate', 'appointmentType', 'status', 'visitState', 'note', 'memoHistory'] as const
const createFields = ['registeredAt', 'customerName', 'phoneLast4', 'gender', 'partnerName', 'billToCode', 'lgeSubchannel', 'plannerName', ...personalFields, ...sharedFields] as const
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 && !value.includes('/')
const idsFor = (members: readonly Lead[]) => members.map(member => member.id).sort()
const sameIds = (left: readonly string[], right: readonly string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
function fail(code: string, message: string): never { throw new CaseSaveError(code, message) }
const priceFor = (lead: Lead, kind: 'lumpSum' | 'subscription') => {
  const value = kind === 'lumpSum' ? lead.lumpSumAmount : lead.subscriptionAmount
  const fallback = lead.purchaseType === (kind === 'lumpSum' ? '일시불' : '구독') ? lead.purchaseAmount : undefined
  const amount = value ?? fallback
  return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : undefined
}
const assignmentChanged = (draft: Lead, baseline: Lead) => (draft.manager || '') !== (baseline.manager || '') || (draft.managerEmployeeNo || '') !== (baseline.managerEmployeeNo || '')
const financialChanged = (draft: Lead, baseline: Lead) => draft.purchaseType !== baseline.purchaseType || priceFor(draft, 'lumpSum') !== priceFor(baseline, 'lumpSum') || priceFor(draft, 'subscription') !== priceFor(baseline, 'subscription')
const hasBasis = (basis?: SharingBasis) => {
  try { return Boolean(wholeCaseBasisId(basis)) }
  catch (error) { if (error instanceof CaseSharingError) throw new CaseSaveError(error.code, error.message); throw error }
}

function validateRoster(members: readonly Lead[]): void {
  const ids = idsFor(members)
  if (!ids.length || ids.length > MAX_CASE_MEMBERS || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) fail('CASE_SAVE_INVALID_MEMBERS', `연결 고객은 최대 ${MAX_CASE_MEMBERS}명까지 저장할 수 있습니다. 고객 구성을 다시 확인해주세요.`)
}

function validateGuard(guard: CaseGroupGuard | null): void {
  if (!guard) return
  if (!Array.isArray(guard.memberIds) || guard.memberIds.length > MAX_CASE_MEMBERS || guard.memberIds.some(id => !validId(id))
    || new Set(guard.memberIds).size !== guard.memberIds.length || !Number.isSafeInteger(guard.revision) || guard.revision < 0
    || guard.managerEmployeeNo !== null && !validId(guard.managerEmployeeNo)
    || guard.basisLeadId !== undefined && guard.basisLeadId !== null && (!validId(guard.basisLeadId) || !guard.memberIds.includes(guard.basisLeadId))
    || guard.mergeMemberIds !== undefined && guard.mergeMemberIds !== null && (!guard.basisLeadId || !validMergeIds(guard.mergeMemberIds) || !sameValue(guard.mergeMemberIds, [...guard.memberIds].sort()))) fail('CASE_SAVE_INVALID_GUARD', '연결 고객의 공유 정보를 확인할 수 없습니다. 관리자에게 문의해주세요.')
}

const validMergeIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length >= 2 && ids.length <= MAX_CASE_MEMBERS
  && ids.every(validId) && new Set(ids).size === ids.length && sameValue(ids, [...ids].sort())

function persistedMergeFor(members: readonly Lead[], guard?: CaseGroupGuard | null): string[] | null {
  const merge = members[0]?.caseMergeMemberIds || null
  if (members.some(member => !sameValue(member.caseMergeMemberIds || null, merge))
    || merge && (!validMergeIds(merge) || !sameValue(merge, idsFor(members)))
    || guard && !sameValue(guard.mergeMemberIds || null, merge)) fail('CASE_SAVE_MERGE_INCONSISTENT', '구매금액 합산 동의 고객 구성이 변경되었습니다. 상세 화면을 다시 열어 확인해주세요.')
  return merge ? [...merge] : null
}

function persistedBasisFor(members: readonly Lead[], guard?: CaseGroupGuard | null): string | null {
  const ids = new Set(members.map(member => member.caseBasisLeadId || null))
  if (ids.size > 1) fail('CASE_SAVE_BASIS_INCONSISTENT', '묶음 고객의 기준 정보가 일치하지 않습니다. 관리자에게 확인해주세요.')
  const basis = members[0]?.caseBasisLeadId || null
  const merge = persistedMergeFor(members, guard)
  if (merge && !basis || basis && !members.some(member => member.id === basis) || guard && (guard.basisLeadId || null) !== basis) {
    fail('CASE_SAVE_BASIS_INCONSISTENT', '묶음 고객의 기준 정보가 변경되었습니다. 상세 화면을 다시 열어 확인해주세요.')
  }
  return basis
}

function assertFresh(raw: Data | null, baseline: Lead): Lead {
  if (!raw) fail('CASE_SAVE_CUSTOMER_MISSING', '고객 정보가 삭제되었습니다. 새로고침 후 확인해주세요.')
  for (const key of ['lumpSumSourceId', 'subscriptionSourceId', 'caseBasisLeadId'] as const) {
    if (raw[key] !== undefined && raw[key] !== null && !validId(raw[key])) fail('CASE_SAVE_INVALID_SOURCE', '공유 금액의 원본 고객 정보가 올바르지 않습니다. 기존 정보를 확인해주세요.')
  }
  if (raw.caseMergeMemberIds !== undefined && raw.caseMergeMemberIds !== null && !validMergeIds(raw.caseMergeMemberIds)) fail('CASE_SAVE_INVALID_SOURCE', '구매금액 합산 동의 고객 구성을 확인할 수 없습니다.')
  const current = leadFromDocument(baseline.id, raw)
  if (caseSharingRevisionFor(current) !== caseSharingRevisionFor(baseline)) fail('CASE_SAVE_STALE_CUSTOMER', '다른 곳에서 고객 정보가 변경되었습니다. 상세 화면을 다시 열어 확인해주세요.')
  return current
}

function guardEmployeeNo(members: readonly Lead[]): string | null {
  const first = members[0]?.managerEmployeeNo
  return first && members.every(member => member.managerEmployeeNo === first) ? first : null
}

function payloadForPatch(patch: Partial<Lead>, fields: readonly (keyof Lead)[]): Data {
  const payload: Data = {}
  for (const key of fields) if (Object.prototype.hasOwnProperty.call(patch, key)) payload[key] = patch[key] === undefined ? null : patch[key]
  return payload
}

function selectionAudit(before: Lead, actorId: string, now: string): NonNullable<Lead['caseSharingHistory']>[number] {
  const previous: NonNullable<Lead['caseSharingHistory']>[number]['previous'] = {}
  for (const key of sharedFields) if (key !== 'caseSharingHistory' && before[key] !== undefined) Object.assign(previous, { [key]: before[key] })
  return { at: now, by: actorId, reason: 'group-share', previous }
}

function ownPatch(original: Lead, draft: Lead, canManageAll: boolean, formBaseline: Lead): Partial<Lead> {
  const fields: readonly (keyof Lead)[] = [...personalFields,
    ...(canManageAll && assignmentChanged(draft, formBaseline) ? ['manager', 'managerEmployeeNo'] as const : [])]
  const patch: Partial<Lead> = {}
  for (const key of fields) if (!sameValue(original[key], draft[key])) Object.assign(patch, { [key]: draft[key] })
  if (financialChanged(draft, formBaseline)) {
    const lumpSum = priceFor(draft, 'lumpSum') !== priceFor(formBaseline, 'lumpSum') ? priceFor(draft, 'lumpSum') : priceFor(original, 'lumpSum')
    const subscription = priceFor(draft, 'subscription') !== priceFor(formBaseline, 'subscription') ? priceFor(draft, 'subscription') : priceFor(original, 'subscription')
    // Editing one kind must not turn the other kind's readonly preview into
    // owned money. Keep totals/types consistent with the actual saved values.
    const purchaseType = lumpSum !== undefined && subscription !== undefined ? '일시불+구독' : lumpSum !== undefined ? '일시불'
      : subscription !== undefined ? '구독' : draft.purchaseType !== formBaseline.purchaseType ? draft.purchaseType || '미선택' : original.purchaseType || '미선택'
    Object.assign(patch, { purchaseType, lumpSumAmount: lumpSum, subscriptionAmount: subscription,
      purchaseAmount: lumpSum !== undefined || subscription !== undefined ? (lumpSum || 0) + (subscription || 0) : undefined })
  }
  return patch
}

/** Preview only edits entered on the selected original, excluding readonly group-prefill values. */
export function caseLinkLeadFor(original: Lead, draft: Lead, baseline: Lead): Lead {
  return { ...original, ...ownPatch(original, draft, true, baseline) }
}

function createPayload(lead: Lead, actorId: string, now: string): Data {
  const payload: Data = {}
  for (const key of createFields) if (lead[key] !== undefined) payload[key] = lead[key]
  return { ...payload, createdBy: actorId, createdAt: now, updatedBy: actorId, updatedAt: now }
}

function newOwnValues(input: SaveCaseCustomerInput): Lead {
  const initial = { ...input.draft, manager: input.original.manager, managerEmployeeNo: input.original.managerEmployeeNo,
    purchaseType: input.original.purchaseType, purchaseAmount: input.original.purchaseAmount, lumpSumAmount: input.original.lumpSumAmount,
    subscriptionAmount: input.original.subscriptionAmount, lumpSumSourceId: undefined, subscriptionSourceId: undefined,
    caseSharingHistory: undefined, caseBasisLeadId: undefined, caseMergeMemberIds: undefined, salesRawPeriods: undefined, subscriptionRawPeriods: undefined }
  return { ...initial, ...ownPatch(input.original, input.draft, true, input.formBaseline) }
}

/** Linking preserves old ownership. A present alias owner must remain valid. */
function assertLinkSourceIntegrity(members: readonly Lead[]): void {
  const byId = new Map(members.map(member => [member.id, member]))
  for (const member of members) for (const kind of ['lumpSum', 'subscription'] as const) {
    const key = kind === 'lumpSum' ? 'lumpSumSourceId' : 'subscriptionSourceId'
    const source = member[key]
    if (!source || source === member.id) continue
    const owner = byId.get(source)
    // Unchanged aliases can retain an owner outside a new group after unlink.
    if (!owner) continue
    const raw = kind === 'lumpSum' ? owner.salesRawPeriods : owner.subscriptionRawPeriods
    if (!canonicalPartnerName(member.partnerName) || canonicalPartnerName(member.partnerName) !== canonicalPartnerName(owner.partnerName)
      || owner[key] && owner[key] !== owner.id
      || priceFor(owner, kind) === undefined && !Object.keys(raw || {}).length
      || priceFor(member, kind) !== priceFor(owner, kind)) {
      fail('CASE_SAVE_LINK_SOURCE_CONFLICT', '기존 공유 금액의 기준 고객 관계를 유지할 수 없습니다. 연결 전에 금액과 기준 고객을 확인해주세요.')
    }
  }
}

function assertDetachedAliasEdit(original: Lead, draft: Lead, baseline: Lead): void {
  for (const kind of ['lumpSum', 'subscription'] as const) {
    const owner = kind === 'lumpSum' ? original.lumpSumSourceId : original.subscriptionSourceId
    if (owner && owner !== original.id && priceFor(draft, kind) !== priceFor(baseline, kind)) fail('CASE_SAVE_DETACHED_SOURCE', '연결을 해제한 공유 금액은 기준 고객을 확인한 뒤 변경해주세요. 기존 매출의 소유 관계는 유지됩니다.')
  }
}

function sdkStore(db: Firestore): CaseSharingStore {
  const leadRef = (id: string) => doc(db, 'referrals', id)
  const guardRef = (id: string) => doc(db, 'caseGroups', id)
  return {
    getLead: async id => { const snapshot = await getDocFromServer(leadRef(id)); return snapshot.exists() ? snapshot.data() : null },
    getGuard: async id => { const snapshot = await getDocFromServer(guardRef(id)); return snapshot.exists() ? snapshot.data() as CaseGroupGuard : null },
    getMembers: async id => { const snapshot = await getDocsFromServer(query(collection(db, 'referrals'), where('caseGroupId', '==', id))); return snapshot.docs.map(item => ({ id: item.id, data: item.data() })) },
    transaction: work => runTransaction(db, transaction => work({
      getLead: async id => { const snapshot = await transaction.get(leadRef(id)); return snapshot.exists() ? snapshot.data() : null },
      getGuard: async id => { const snapshot = await transaction.get(guardRef(id)); return snapshot.exists() ? snapshot.data() as CaseGroupGuard : null },
      createLead: (id, payload) => { transaction.set(leadRef(id), payload) },
      updateLead: (id, payload) => { transaction.update(leadRef(id), payload) },
      setGuard: (id, guard) => { transaction.set(guardRef(id), { ...guard }) },
    })),
  }
}

/** Use only a supplied Firestore instance; this module does not initialize apps. */
export function saveCaseCustomer(db: Firestore, input: SaveCaseCustomerInput): Promise<{ changedCount: number; shared: boolean }> {
  return saveCaseCustomerWithStore(sdkStore(db), input)
}

export async function saveCaseCustomerWithStore(store: CaseSharingStore, input: SaveCaseCustomerInput): Promise<{ changedCount: number; shared: boolean }> {
  input.assertSession()
  if (!validId(input.original.id) || input.draft.id !== input.original.id || input.formBaseline.id !== input.original.id || !validId(input.actorId) || !input.canManageAll && !validId(input.actorEmployeeNo)) fail('CASE_SAVE_INVALID_INPUT', '저장할 고객 정보를 다시 확인해주세요.')
  const targetIds = input.linkTargetIds ?? (input.linkTargetId ? [input.linkTargetId] : [])
  const linking = targetIds.length > 0
  if (input.linkTargetIds && input.linkTargetId || targetIds.length >= MAX_CASE_MEMBERS
    || new Set(targetIds).size !== targetIds.length || targetIds.some(id => !validId(id) || id === input.original.id)) {
    fail('CASE_SAVE_INVALID_LINK', '묶을 고객과 접수 기록 구성을 다시 확인해주세요.')
  }
  if ((input.creating || input.draft.appointmentType !== input.formBaseline.appointmentType)
    && !isPartnerAppointmentType(input.draft.appointmentType)) {
    fail('CASE_SAVE_INVALID_APPOINTMENT_TYPE', '이업종제휴 또는 상담예약 (이업종)을 선택해주세요.')
  }
  const deliveryError = caseSaveDeliveryError(input.original, input.draft, linking, input.creating)
  if (deliveryError) fail('CASE_SAVE_INVALID_DELIVERY', deliveryError)
  for (const value of [input.draft.purchaseAmount, input.draft.lumpSumAmount, input.draft.subscriptionAmount]) {
    if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail('CASE_SAVE_INVALID_AMOUNT', '구매 금액은 0 이상의 올바른 숫자로 입력해주세요.')
  }
  if ((input.creating || linking) && !input.canManageAll) fail('CASE_SAVE_FORBIDDEN', '고객 등록과 연결에는 관리자 권한이 필요합니다.')
  if (!input.canManageAll && assignmentChanged(input.draft, input.formBaseline)) fail('CASE_SAVE_MANAGER_FORBIDDEN', '담당자 변경은 관리자 권한이 필요합니다.')
  if (input.basis?.mergePurchaseAmounts !== undefined && (typeof input.basis.mergePurchaseAmounts !== 'boolean' || !input.basis.caseLeadId)) fail('CASE_SHARING_MERGE_BASIS_REQUIRED', '구매금액 합산 여부와 기준 고객을 함께 선택해주세요.')
  if (input.basis?.mergePurchaseAmounts !== undefined && !input.canManageAll) fail('CASE_SHARING_BASIS_FORBIDDEN', '묶음 고객의 구매금액 합산 선택은 관리자 권한이 필요합니다.')
  const now = new Date().toISOString()
  const personalOnly = !linking && !hasBasis(input.basis) && (!input.original.caseGroupId || !financialChanged(input.draft, input.formBaseline) && !assignmentChanged(input.draft, input.formBaseline))
  if (personalOnly) {
    if (!input.original.caseGroupId) assertDetachedAliasEdit(input.original, input.draft, input.formBaseline)
    return store.transaction(async transaction => {
      input.assertSession()
      const raw = await transaction.getLead(input.original.id)
      input.assertSession()
      if (input.creating) {
        if (raw) fail('CASE_SAVE_CUSTOMER_EXISTS', '이미 등록된 고객입니다. 상세 화면을 다시 열어 확인해주세요.')
        // A new standalone record cannot inject RAW, lineage or shared history.
        const initial = newOwnValues(input)
        transaction.createLead(initial.id, createPayload(initial, input.actorId, now))
        return { changedCount: 1, shared: false }
      }
      const current = assertFresh(raw, input.original)
      if (!input.canManageAll && current.managerEmployeeNo !== input.actorEmployeeNo) fail('CASE_SAVE_CUSTOMER_PERMISSION', '본인에게 배정된 고객만 저장할 수 있습니다.')
      const patch = ownPatch(current, input.draft, input.canManageAll, input.formBaseline)
      const payload = payloadForPatch(patch, input.original.caseGroupId ? personalFields : [...personalFields, ...sharedFields])
      if (!Object.keys(payload).length) return { changedCount: 0, shared: false }
      input.assertSession()
      transaction.updateLead(current.id, { ...payload, updatedAt: now, updatedBy: input.actorId })
      return { changedCount: 1, shared: false }
    })
  }

  const targetRows = await Promise.all(targetIds.map(id => store.getLead(id)))
  input.assertSession()
  const targets = targetRows.map((data, index) => {
    if (!data) fail('CASE_SAVE_LINK_TARGET_MISSING', '연결할 고객이 삭제되었습니다. 다시 선택해주세요.')
    return leadFromDocument(targetIds[index], data)
  })
  const groupedTargets = targets.filter(target => target.caseGroupId)
  if (groupedTargets.length > 1 || (groupedTargets.length && input.original.caseGroupId)) {
    fail('CASE_SAVE_ALREADY_LINKED', '다른 묶음에 속한 고객은 해당 연결을 해제한 뒤 추가해주세요.')
  }
  const caseId = input.original.caseGroupId || groupedTargets[0]?.caseGroupId || (targets.length ? `case-${targets[0].id}` : undefined)
  if (!validId(caseId)) fail('CASE_SAVE_INVALID_GROUP', '연결할 접수건 정보를 다시 확인해주세요.')
  const initialGuard = await store.getGuard(caseId)
  input.assertSession()
  validateGuard(initialGuard)
  let groupIds: string[]
  let groupMembers: Lead[]
  if (input.canManageAll) {
    const rows = await store.getMembers(caseId)
    input.assertSession()
    groupMembers = rows.map(row => leadFromDocument(row.id, row.data))
    groupIds = idsFor(groupMembers)
    if (initialGuard && !sameIds(initialGuard.memberIds, groupIds)) fail('CASE_SAVE_STALE_GROUP', '연결 고객 구성이 변경되었습니다. 상세 화면을 다시 열어 확인해주세요.')
  } else {
    if (!initialGuard || initialGuard.managerEmployeeNo !== input.actorEmployeeNo || !initialGuard.memberIds.length) fail('CASE_SAVE_GROUP_PERMISSION', '전체 연결 고객의 저장 권한을 확인할 수 없습니다. 관리자에게 연결 정보를 확인해주세요.')
    groupIds = [...initialGuard.memberIds]
    groupMembers = input.openingMembers.filter(member => groupIds.includes(member.id))
    if (!sameIds(idsFor(groupMembers), groupIds) || groupMembers.some(member => member.caseGroupId !== caseId || member.managerEmployeeNo !== input.actorEmployeeNo)) fail('CASE_SAVE_GROUP_PERMISSION', '연결 고객 전체가 본인에게 배정된 접수건만 함께 저장할 수 있습니다.')
  }
  persistedBasisFor(groupMembers, initialGuard)
  groupMembers.push(...targets.filter(target => !target.caseGroupId))
  const selectedIds = new Set(targetIds)
  const openingGroup = input.openingMembers.filter(member => member.caseGroupId === caseId || selectedIds.has(member.id))
  if (!sameIds(idsFor(openingGroup), idsFor(groupMembers))) fail('CASE_SAVE_STALE_GROUP', '화면을 연 뒤 연결 고객 구성이 변경되었습니다. 상세 화면을 다시 열어 확인해주세요.')
  const baselineById = new Map(input.openingMembers.map(member => [member.id, member]))
  baselineById.set(input.original.id, input.original)
  for (const member of groupMembers) {
    const baseline = baselineById.get(member.id)
    if (!baseline || caseSharingRevisionFor(member) !== caseSharingRevisionFor(baseline)) fail('CASE_SAVE_STALE_CUSTOMER', '연결 고객의 정보가 변경되었습니다. 상세 화면을 다시 열어 확인해주세요.')
  }
  const finalIds = [...new Set([...idsFor(groupMembers), input.original.id])].sort()
  validateRoster(finalIds.map(id => baselineById.get(id)!))

  return store.transaction(async transaction => {
    input.assertSession()
    const freshGuard = await transaction.getGuard(caseId)
    const freshRows = await Promise.all(finalIds.map(async id => ({ id, data: await transaction.getLead(id) })))
    input.assertSession()
    validateGuard(freshGuard)
    if (caseSharingRevisionFor(freshGuard) !== caseSharingRevisionFor(initialGuard)) fail('CASE_SAVE_STALE_GROUP', '저장 중 연결 고객 구성이 변경되었습니다. 다시 확인해주세요.')
    const currentMembers = freshRows.map(row => {
      if (row.id === input.original.id && input.creating) {
        if (row.data) fail('CASE_SAVE_CUSTOMER_EXISTS', '이미 등록된 고객입니다. 상세 화면을 다시 열어 확인해주세요.')
        return { ...input.original }
      }
      const baseline = baselineById.get(row.id)
      if (!baseline) fail('CASE_SAVE_INVALID_MEMBERS', '전체 연결 고객의 기준 정보를 확인할 수 없습니다.')
      const current = assertFresh(row.data, baseline)
      if (!input.canManageAll && current.managerEmployeeNo !== input.actorEmployeeNo) fail('CASE_SAVE_GROUP_PERMISSION', '다른 담당자의 연결 고객은 함께 저장할 수 없습니다.')
      return current
    })
    const existingGroup = currentMembers.filter(member => member.caseGroupId === caseId)
    const existingBasisId = persistedBasisFor(existingGroup, freshGuard)
    if (linking) {
      // Apply real selected-record edits first. Basis-prefill values identical
      // to formBaseline are not edits and never overwrite this original.
      assertDetachedAliasEdit(input.original, input.draft, input.formBaseline)
      const currentSelected = currentMembers.find(member => member.id === input.original.id)!
      const selectedPatch = ownPatch(currentSelected, input.draft, true, input.formBaseline)
      const selected = input.creating ? newOwnValues(input) : { ...currentSelected, ...selectedPatch }
      let linkedMembers: Lead[] = currentMembers.map(member => ({ ...(member.id === selected.id ? selected : member), caseGroupId: caseId,
        caseBasisLeadId: existingBasisId || undefined, caseMergeMemberIds: undefined }))
      assertLinkSourceIntegrity(linkedMembers)
      if (hasBasis(input.basis)) {
        try {
          // The freshly linked primary record is its own baseline. The popup
          // applies only the selected basis/merge metadata in this transaction.
          const linkedSelected = linkedMembers.find(member => member.id === selected.id)!
          const plan = resolveCaseSharing({ members: linkedMembers, original: linkedSelected, draft: linkedSelected, formBaseline: linkedSelected,
            caseGroupId: caseId, basis: input.basis, actorId: input.actorId, now, canManageAll: true })
          if (plan.conflicts.length) throw new CaseSaveError('CASE_SAVE_SHARING_CONFLICT', '기존 값을 유지했습니다. 고객 연결 기준을 다시 선택해주세요.', plan.conflicts)
          linkedMembers = plan.leads
        } catch (error) {
          if (error instanceof CaseSharingError) throw new CaseSaveError(error.code, error.message)
          throw error
        }
      }
      let changedCount = 0
      input.assertSession()
      for (const member of linkedMembers) {
        const isSelected = member.id === input.original.id
        const payload = isSelected ? payloadForPatch(selectedPatch, [...personalFields, ...sharedFields]) : {}
        const before = currentMembers.find(item => item.id === member.id)!
        if (before.caseGroupId !== caseId) payload.caseGroupId = caseId
        const metadataChanged = before.caseBasisLeadId !== member.caseBasisLeadId || !sameValue(before.caseMergeMemberIds, member.caseMergeMemberIds)
        if (before.caseBasisLeadId !== member.caseBasisLeadId) payload.caseBasisLeadId = member.caseBasisLeadId || null
        if (!sameValue(before.caseMergeMemberIds, member.caseMergeMemberIds)) payload.caseMergeMemberIds = member.caseMergeMemberIds || null
        if (metadataChanged) {
          const rawHistory = freshRows.find(row => row.id === member.id)?.data?.caseSharingHistory
          if (rawHistory !== undefined && rawHistory !== null && !Array.isArray(rawHistory)) fail('CASE_SAVE_INVALID_HISTORY', '기존 공유 이력을 보존할 수 없습니다. 관리자에게 원본 이력을 확인해주세요.')
          member.caseSharingHistory = [...(before.caseSharingHistory || []), selectionAudit(before, input.actorId, now)]
          payload.caseSharingHistory = [...(Array.isArray(rawHistory) ? rawHistory : []), selectionAudit(before, input.actorId, now)]
        }
        if (isSelected && input.creating) {
          transaction.createLead(member.id, { ...createPayload(member, input.actorId, now), caseGroupId: caseId, caseBasisLeadId: member.caseBasisLeadId || null, caseMergeMemberIds: member.caseMergeMemberIds || null })
          changedCount++
        } else if (Object.keys(payload).length) {
          transaction.updateLead(member.id, { ...payload, updatedAt: now, updatedBy: input.actorId })
          changedCount++
        }
      }
      transaction.setGuard(caseId, { memberIds: finalIds, revision: (freshGuard?.revision || 0) + 1,
        managerEmployeeNo: guardEmployeeNo(linkedMembers), basisLeadId: persistedBasisFor(linkedMembers), mergeMemberIds: persistedMergeFor(linkedMembers), updatedAt: now, updatedBy: input.actorId })
      return { changedCount, shared: hasBasis(input.basis) }
    }
    let result: ReturnType<typeof resolveCaseSharing>
    try {
      result = resolveCaseSharing({ members: currentMembers, original: currentMembers.find(member => member.id === input.original.id)!, draft: input.draft,
        formBaseline: input.formBaseline, caseGroupId: caseId, basis: input.basis, actorId: input.actorId, now, canManageAll: input.canManageAll })
    } catch (error) {
      if (error instanceof CaseSharingError) throw new CaseSaveError(error.code, error.message)
      throw error
    }
    if (result.conflicts.length) throw new CaseSaveError('CASE_SAVE_SHARING_CONFLICT', '기존 값을 유지했습니다. 공유할 기준 고객을 먼저 선택해주세요.', result.conflicts)
    const membershipChanged = !sameIds(groupIds, finalIds) || currentMembers.some(member => member.caseGroupId !== caseId)
    const planById = new Map(result.patches.map(item => [item.id, item.patch]))
    const rawById = new Map(freshRows.map(row => [row.id, row.data]))
    let changedCount = 0
    input.assertSession()
    for (const member of result.leads) {
      const selected = member.id === input.original.id
      const payload = payloadForPatch(planById.get(member.id) || {}, selected ? [...personalFields, ...sharedFields] : sharedFields)
      if (Object.prototype.hasOwnProperty.call(payload, 'caseSharingHistory')) {
        const rawHistory = rawById.get(member.id)?.caseSharingHistory
        if (rawHistory !== undefined && rawHistory !== null && !Array.isArray(rawHistory)) fail('CASE_SAVE_INVALID_HISTORY', '기존 공유 이력을 보존할 수 없습니다. 관리자에게 원본 이력을 확인해주세요.')
        const previousCount = currentMembers.find(item => item.id === member.id)!.caseSharingHistory?.length || 0
        const appended = member.caseSharingHistory?.slice(previousCount) || []
        payload.caseSharingHistory = [...(Array.isArray(rawHistory) ? rawHistory : []), ...appended]
      }
      if (currentMembers.find(item => item.id === member.id)!.caseGroupId !== caseId) payload.caseGroupId = caseId
      if (selected && input.creating) {
        transaction.createLead(member.id, { ...createPayload(member, input.actorId, now), caseGroupId: caseId })
        changedCount++
      } else if (Object.keys(payload).length) {
        transaction.updateLead(member.id, { ...payload, updatedAt: now, updatedBy: input.actorId })
        changedCount++
      }
    }
    if (!freshGuard || membershipChanged || result.sharedChanged) transaction.setGuard(caseId, {
      memberIds: finalIds, revision: (freshGuard?.revision || 0) + 1, managerEmployeeNo: guardEmployeeNo(result.leads), basisLeadId: persistedBasisFor(result.leads), mergeMemberIds: persistedMergeFor(result.leads), updatedAt: now, updatedBy: input.actorId,
    })
    return { changedCount, shared: membershipChanged || result.sharedChanged }
  })
}

export function unlinkCaseCustomer(db: Firestore, input: UnlinkCaseCustomerInput): Promise<{ changedCount: number }> {
  return unlinkCaseCustomerWithStore(sdkStore(db), input)
}

export async function unlinkCaseCustomerWithStore(store: CaseSharingStore, input: UnlinkCaseCustomerInput): Promise<{ changedCount: number }> {
  input.assertSession()
  if (!input.canManageAll) fail('CASE_SAVE_FORBIDDEN', '접수건 연결 해제에는 관리자 권한이 필요합니다.')
  if (!validId(input.actorId) || !validId(input.lead.id)) fail('CASE_SAVE_INVALID_INPUT', '저장 사용자와 고객 정보를 다시 확인해주세요.')
  const caseId = input.lead.caseGroupId
  if (!validId(caseId)) fail('CASE_SAVE_INVALID_GROUP', '연결된 접수건을 다시 확인해주세요.')
  const initialGuard = await store.getGuard(caseId)
  const rows = await store.getMembers(caseId)
  input.assertSession()
  validateGuard(initialGuard)
  const members = rows.map(row => leadFromDocument(row.id, row.data))
  validateRoster(members)
  persistedBasisFor(members, initialGuard)
  const opening = input.openingMembers.filter(member => member.caseGroupId === caseId)
  if (!sameIds(idsFor(opening), idsFor(members)) || !members.some(member => member.id === input.lead.id)
    || initialGuard && !sameIds(initialGuard.memberIds, idsFor(members))) fail('CASE_SAVE_STALE_GROUP', '연결 고객 구성이 변경되었습니다. 상세 화면을 다시 열어 확인해주세요.')
  const baselineById = new Map(opening.map(member => [member.id, member]))
  baselineById.set(input.lead.id, input.lead)
  const now = new Date().toISOString()
  return store.transaction(async transaction => {
    input.assertSession()
    const freshGuard = await transaction.getGuard(caseId)
    const freshRows = await Promise.all(members.map(async member => ({ id: member.id, data: await transaction.getLead(member.id) })))
    input.assertSession()
    validateGuard(freshGuard)
    if (caseSharingRevisionFor(freshGuard) !== caseSharingRevisionFor(initialGuard)) fail('CASE_SAVE_STALE_GROUP', '저장 중 연결 고객 구성이 변경되었습니다. 다시 확인해주세요.')
    const current = freshRows.map(row => assertFresh(row.data, baselineById.get(row.id)!))
    const previousBasis = persistedBasisFor(current, freshGuard)
    const removed = current.length <= 2 ? current : current.filter(member => member.id === input.lead.id)
    const removedIds = new Set(removed.map(member => member.id))
    const remaining = current.filter(member => !removedIds.has(member.id))
    const nextBasis = previousBasis && remaining.some(member => member.id === previousBasis) ? previousBasis : null
    const clearRemaining = remaining.filter(member => (!nextBasis && member.caseBasisLeadId) || member.caseMergeMemberIds)
    input.assertSession()
    const preserveAudit = (member: Lead): Data => {
      if (!member.caseMergeMemberIds) return {}
      const rawHistory = freshRows.find(row => row.id === member.id)?.data?.caseSharingHistory
      if (rawHistory !== undefined && rawHistory !== null && !Array.isArray(rawHistory)) fail('CASE_SAVE_INVALID_HISTORY', '기존 공유 이력을 보존할 수 없습니다.')
      return { caseSharingHistory: [...(Array.isArray(rawHistory) ? rawHistory : []), selectionAudit(member, input.actorId, now)] }
    }
    for (const member of removed) transaction.updateLead(member.id, { caseGroupId: null, caseBasisLeadId: null, caseMergeMemberIds: null, ...preserveAudit(member), updatedAt: now, updatedBy: input.actorId })
    for (const member of clearRemaining) transaction.updateLead(member.id, { caseBasisLeadId: nextBasis, caseMergeMemberIds: null, ...preserveAudit(member), updatedAt: now, updatedBy: input.actorId })
    transaction.setGuard(caseId, { memberIds: idsFor(remaining), revision: (freshGuard?.revision || 0) + 1, managerEmployeeNo: guardEmployeeNo(remaining), basisLeadId: nextBasis, mergeMemberIds: null, updatedAt: now, updatedBy: input.actorId })
    return { changedCount: removed.length + clearRemaining.length }
  })
}
