import type { CaseSharingHistory, Lead, PurchaseType } from '../types'
import { customerDisplayLabel } from './customerDisplay'
import { canonicalPartnerName } from './partners'
import { caseBasisFor, financialCaseLeadFor } from './caseBasis'

export interface SharingBasis {
  caseLeadId?: string
  mergePurchaseAmounts?: boolean
  managerLeadId?: string
  lumpSumLeadId?: string
  subscriptionLeadId?: string
}

export interface CaseGroupGuard {
  memberIds: string[]
  revision: number
  managerEmployeeNo: string | null
  basisLeadId?: string | null
  mergeMemberIds?: string[] | null
  updatedAt?: string
  updatedBy?: string
}

export interface CaseSharingConflict {
  kind: 'case' | 'manager' | 'lumpSum' | 'subscription'
  message: string
  candidates: { leadId: string; label: string; value: string }[]
}

export class CaseSharingError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CaseSharingError'
    this.code = code
  }
}

type FinanceKind = 'lumpSum' | 'subscription'
type SharingInput = {
  members: readonly Lead[]
  original: Lead
  draft: Lead
  formBaseline?: Lead
  caseGroupId: string
  basis?: SharingBasis
  actorId: string
  now: string
  canManageAll: boolean
}

const financeKinds = ['lumpSum', 'subscription'] as const
const sharedKeys = ['manager', 'managerEmployeeNo', 'purchaseType', 'purchaseAmount', 'lumpSumAmount', 'subscriptionAmount', 'lumpSumSourceId', 'subscriptionSourceId'] as const
const protectedDraftKeys = new Set<string>([...sharedKeys, 'salesRawPeriods', 'subscriptionRawPeriods', 'caseSharingHistory', 'caseGroupId', 'caseBasisLeadId', 'caseMergeMemberIds', 'updatedAt'])
const amountKey = (kind: FinanceKind) => kind === 'lumpSum' ? 'lumpSumAmount' : 'subscriptionAmount'
const sourceKey = (kind: FinanceKind) => kind === 'lumpSum' ? 'lumpSumSourceId' : 'subscriptionSourceId'
const validAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value && !value.includes('/')
const managerPair = (lead: Lead) => [lead.manager || '', lead.managerEmployeeNo || ''] as const
const assignmentKey = (lead: Lead) => JSON.stringify(managerPair(lead))
const partnerFor = (lead: Lead) => canonicalPartnerName(lead.partnerName)

function amountFor(lead: Lead, kind: FinanceKind): number | undefined {
  const direct = lead[amountKey(kind)]
  if (validAmount(direct)) return direct
  const singleType = kind === 'lumpSum' ? '일시불' : '구독'
  return lead.purchaseType === singleType && validAmount(lead.purchaseAmount) ? lead.purchaseAmount : undefined
}

function hasRaw(lead: Lead, kind: FinanceKind): boolean {
  return Object.keys((kind === 'lumpSum' ? lead.salesRawPeriods : lead.subscriptionRawPeriods) || {}).length > 0
}

function independentSource(lead: Lead, kind: FinanceKind): boolean {
  const owner = lead[sourceKey(kind)]
  return (!owner || owner === lead.id) && (amountFor(lead, kind) !== undefined || hasRaw(lead, kind))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]))
  return value
}

/** Includes personal fields too: a stale form must not replace a newer memo or date. */
export function caseSharingRevisionFor(lead: Lead): string {
  return JSON.stringify(stableValue(lead))
}

function fail(code: string, message: string): never {
  throw new CaseSharingError(code, message)
}

function validateMembers(members: readonly Lead[], selectedId: string): void {
  if (!members.length || members.length > 8) fail('CASE_SHARING_MEMBER_LIMIT', '연결 고객은 1명부터 최대 8명까지 함께 저장할 수 있습니다.')
  const ids = new Set<string>()
  for (const member of members) {
    if (!validId(member.id) || ids.has(member.id) || typeof member.partnerName !== 'string') fail('CASE_SHARING_INVALID_MEMBER', '연결 고객 구성을 다시 확인해주세요.')
    ids.add(member.id)
    if (member.caseSharingHistory !== undefined && member.caseSharingHistory !== null && !Array.isArray(member.caseSharingHistory)) fail('CASE_SHARING_INVALID_HISTORY', '기존 공유 이력을 확인할 수 없습니다.')
    if (member.manager !== undefined && typeof member.manager !== 'string' || member.managerEmployeeNo !== undefined && typeof member.managerEmployeeNo !== 'string') fail('CASE_SHARING_INVALID_MANAGER', '담당자 정보를 다시 확인해주세요.')
    for (const kind of financeKinds) {
      const value = member[amountKey(kind)]
      const owner = member[sourceKey(kind)]
      if (value !== undefined && value !== null && !validAmount(value)) fail('CASE_SHARING_INVALID_AMOUNT', '구매 금액은 0 이상의 올바른 숫자로 입력해주세요.')
      if (owner !== undefined && !validId(owner)) fail('CASE_SHARING_INVALID_SOURCE', '공유 금액의 기준 고객 정보가 올바르지 않습니다.')
    }
    if (member.caseBasisLeadId !== undefined && !validId(member.caseBasisLeadId)) fail('CASE_SHARING_INVALID_BASIS', '묶음 고객의 기준 정보를 다시 확인해주세요.')
    if (member.caseMergeMemberIds !== undefined && (!Array.isArray(member.caseMergeMemberIds) || member.caseMergeMemberIds.length < 2 || member.caseMergeMemberIds.length > 8
      || member.caseMergeMemberIds.some(id => !validId(id)) || new Set(member.caseMergeMemberIds).size !== member.caseMergeMemberIds.length
      || JSON.stringify(member.caseMergeMemberIds) !== JSON.stringify([...member.caseMergeMemberIds].sort()))) fail('CASE_SHARING_INVALID_MERGE', '구매금액 합산 동의 고객 구성을 다시 확인해주세요.')
    if (member.purchaseAmount !== undefined && member.purchaseAmount !== null && !validAmount(member.purchaseAmount)) fail('CASE_SHARING_INVALID_AMOUNT', '구매 금액은 0 이상의 올바른 숫자로 입력해주세요.')
  }
  if (!ids.has(selectedId)) fail('CASE_SHARING_SELECTED_MISSING', '선택한 고객이 연결 구성에 없습니다. 다시 열어 확인해주세요.')
}

function validateSources(members: readonly Lead[], allowDetachedAlias: boolean): void {
  const byId = new Map(members.map(member => [member.id, member]))
  for (const member of members) for (const kind of financeKinds) {
    const ownerId = member[sourceKey(kind)]
    if (!ownerId || ownerId === member.id) continue
    const owner = byId.get(ownerId)
    if (!owner) {
      if (allowDetachedAlias) continue
      fail('CASE_SHARING_SOURCE_MISSING', '공유 금액의 기준 고객이 연결 구성에 없습니다. 기존 정보를 확인해주세요.')
    }
    if (!partnerFor(member) || partnerFor(member) !== partnerFor(owner)) fail('CASE_SHARING_CROSS_PARTNER_SOURCE', '서로 다른 제휴업체의 구매 금액은 공유할 수 없습니다.')
    if (owner[sourceKey(kind)] && owner[sourceKey(kind)] !== owner.id) fail('CASE_SHARING_SOURCE_CHAIN', '공유 금액은 실제 금액을 보유한 기준 고객을 직접 참조해야 합니다.')
    if (!independentSource(owner, kind)) fail('CASE_SHARING_SOURCE_EMPTY', '공유 금액의 기준 고객에 원본 금액이나 RAW 근거가 없습니다.')
  }
}

/** Older callers may supply per-kind IDs, but they can never mix customers. */
export function wholeCaseBasisId(basis?: SharingBasis): string | undefined {
  const ids = [basis?.caseLeadId, basis?.managerLeadId, basis?.lumpSumLeadId, basis?.subscriptionLeadId].filter((id): id is string => id !== undefined)
  if (ids.some(id => !validId(id))) fail('CASE_SHARING_INVALID_BASIS', '묶음 고객의 기준 고객을 다시 선택해주세요.')
  if (new Set(ids).size > 1) fail('CASE_SHARING_MIXED_BASIS', 'A 고객과 B 고객의 자료를 섞을 수 없습니다. 기준 고객 한 명을 선택해주세요.')
  return ids[0]
}

function caseConflict(candidates: readonly Lead[], message?: string): CaseSharingConflict {
  return { kind: 'case', message: message || '묶음 고객의 자료가 다릅니다. 합산하지 않고 사용할 기준 고객 한 명을 선택해주세요.',
    candidates: candidates.map(lead => ({ leadId: lead.id, label: customerDisplayLabel(lead),
      value: `${lead.manager || '담당 미정'} · 일시불 ${amountFor(lead, 'lumpSum')?.toLocaleString('ko-KR') ?? '미입력'}${amountFor(lead, 'lumpSum') === undefined ? '' : '원'} · 구독 ${amountFor(lead, 'subscription')?.toLocaleString('ko-KR') ?? '미입력'}${amountFor(lead, 'subscription') === undefined ? '' : '원'}` })) }
}

function reconcilePurchase(lead: Lead): void {
  const lumpSum = amountFor(lead, 'lumpSum')
  const subscription = amountFor(lead, 'subscription')
  // Preserve legacy single-method values before changing the purchase type.
  lead.lumpSumAmount = lumpSum
  lead.subscriptionAmount = subscription
  const purchaseType: PurchaseType = lumpSum !== undefined && subscription !== undefined ? '일시불+구독' : lumpSum !== undefined ? '일시불' : subscription !== undefined ? '구독' : '미선택'
  lead.purchaseType = purchaseType
  lead.purchaseAmount = lumpSum !== undefined || subscription !== undefined ? (lumpSum || 0) + (subscription || 0) : undefined
}

function previousSharing(lead: Lead): CaseSharingHistory['previous'] {
  const previous: CaseSharingHistory['previous'] = {}
  for (const key of sharedKeys) if (lead[key] !== undefined) Object.assign(previous, { [key]: lead[key] })
  if (lead.caseBasisLeadId !== undefined) previous.caseBasisLeadId = lead.caseBasisLeadId
  if (lead.caseMergeMemberIds !== undefined) previous.caseMergeMemberIds = [...lead.caseMergeMemberIds]
  return previous
}

function changedPatch(original: Lead, next: Lead): Partial<Lead> {
  const patch: Partial<Lead> = {}
  for (const key of new Set([...Object.keys(original), ...Object.keys(next)])) {
    if (key === 'id') continue
    if (JSON.stringify(stableValue(original[key as keyof Lead])) !== JSON.stringify(stableValue(next[key as keyof Lead]))) Object.assign(patch, { [key]: next[key as keyof Lead] })
  }
  return patch
}

/** Readonly whole-customer prefill. Never copies one method from each customer. */
export function caseSharingDraftFor(lead: Lead, members: readonly Lead[], preferredCaseLeadId?: string, mergePurchaseAmounts?: boolean): { draft: Lead; conflicts: CaseSharingConflict[] } {
  const all = members.some(member => member.id === lead.id) ? members : [...members, lead]
  validateMembers(all, lead.id)
  const choice = caseBasisFor(all, preferredCaseLeadId, mergePurchaseAmounts === undefined ? undefined : mergePurchaseAmounts ? all.map(member => member.id).sort() : null)
  const draft = { ...lead }
  if (choice.status === 'unresolved') return { draft, conflicts: [caseConflict(choice.candidates, choice.reason)] }
  const basis = choice.basis
  if (basis && partnerFor(basis) === partnerFor(lead)) {
    // A merge preview may contain the aggregate numbers, but only a deliberate
    // edit relative to the identical form baseline writes any purchase field.
    const projected = financialCaseLeadFor(choice, all) || basis
    for (const key of sharedKeys) Object.assign(draft, { [key]: projected[key] })
    // Projection self-owner markers are not persistence instructions. Keep the
    // real source pointers for methods surviving this whole-customer view.
    for (const kind of financeKinds) draft[sourceKey(kind)] = amountFor(projected, kind) !== undefined || hasRaw(projected, kind) ? basis[sourceKey(kind)] : undefined
    draft.caseBasisLeadId = basis.id
    draft.caseMergeMemberIds = choice.mergeMemberIds ? [...choice.mergeMemberIds] : undefined
  }
  return { draft, conflicts: [] }
}

/** Calculates atomic-write patches; never touches a database or mutates inputs. */
export function resolveCaseSharing(input: SharingInput): { leads: Lead[]; patches: { id: string; patch: Partial<Lead> }[]; conflicts: CaseSharingConflict[]; sharedChanged: boolean } {
  const { members, original, draft, caseGroupId, actorId, now, canManageAll } = input
  if (!validId(actorId) || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) fail('CASE_SHARING_INVALID_AUDIT', '저장 사용자와 시간을 확인할 수 없습니다.')
  validateMembers(members, original.id)
  if (draft.id !== original.id || input.formBaseline && input.formBaseline.id !== original.id || !validId(caseGroupId)) fail('CASE_SHARING_INVALID_DRAFT', '저장할 고객과 연결 기준을 다시 확인해주세요.')
  validateMembers([draft], draft.id)
  const baseline = input.formBaseline || original
  const explicitManager = assignmentKey(draft) !== assignmentKey(baseline)
  const editedKinds = financeKinds.filter(kind => amountFor(draft, kind) !== amountFor(baseline, kind))
  const explicitFinance = editedKinds.length > 0 || draft.purchaseType !== baseline.purchaseType
  const preferredId = wholeCaseBasisId(input.basis)
  const mergeMode = input.basis?.mergePurchaseAmounts
  if (mergeMode !== undefined && typeof mergeMode !== 'boolean') fail('CASE_SHARING_INVALID_MERGE', '구매금액 합산 여부를 다시 선택해주세요.')
  if (mergeMode !== undefined && !input.basis?.caseLeadId) fail('CASE_SHARING_MERGE_BASIS_REQUIRED', '구매금액 합산 여부와 기준 고객을 함께 선택해주세요.')
  if (mergeMode !== undefined && !canManageAll) fail('CASE_SHARING_BASIS_FORBIDDEN', '묶음 고객의 구매금액 합산 선택은 관리자 권한이 필요합니다.')
  const preferredMerge = mergeMode === undefined ? undefined : mergeMode ? members.map(member => member.id).sort() : null
  const next = members.map(member => ({ ...member }))
  const selected = next.find(member => member.id === original.id)!
  for (const key of new Set([...Object.keys(original), ...Object.keys(draft)])) {
    if (!protectedDraftKeys.has(key) && key !== 'id') Object.assign(selected, { [key]: draft[key as keyof Lead] })
  }
  if (explicitManager && !canManageAll) fail('CASE_SHARING_MANAGER_FORBIDDEN', '담당자 변경은 관리자 권한이 필요합니다.')
  const choice = caseBasisFor(members, preferredId, preferredMerge)
  if (mergeMode === true && (members.length < 2 || members.some(member => !partnerFor(member) || partnerFor(member) !== partnerFor(members[0])))) fail('CASE_SHARING_CROSS_PARTNER_MERGE', '서로 다른 제휴업체의 구매금액은 합산할 수 없습니다.')
  if (choice.status === 'unresolved' && (preferredId || explicitFinance || explicitManager)) {
    return { leads: members.map(member => ({ ...member })), patches: [], conflicts: [caseConflict(choice.candidates, choice.reason)], sharedChanged: false }
  }
  // Personal edits do not require financial resolution or synchronize readonly
  // prefills. Persisted source/RAW/original amounts remain untouched.
  const basis = choice.basis
  if ((preferredId || explicitFinance || explicitManager) && !basis) fail('CASE_SHARING_INVALID_BASIS', '묶음 고객의 기준 고객을 먼저 선택해주세요.')
  if (!canManageAll && basis && (preferredId || mergeMode !== undefined || explicitFinance || explicitManager) && members.some(member => member.caseBasisLeadId !== basis.id
    || JSON.stringify(member.caseMergeMemberIds) !== JSON.stringify(choice.mergeMemberIds))) {
    fail('CASE_SHARING_BASIS_FORBIDDEN', '묶음 고객의 기준 선택은 관리자 권한이 필요합니다.')
  }
  if (basis && (preferredId || mergeMode !== undefined || explicitFinance || explicitManager)) {
    for (const member of next) {
      member.caseBasisLeadId = basis.id
      member.caseMergeMemberIds = choice.mergeMemberIds ? [...choice.mergeMemberIds] : undefined
    }
  }
  if (basis && (explicitFinance || explicitManager)) {
    const company = partnerFor(basis)
    if (!company || partnerFor(draft) !== company) fail('CASE_SHARING_CROSS_PARTNER_EDIT', '다른 제휴업체의 기준 자료는 이 고객에서 수정할 수 없습니다. 기준 고객을 열어 수정해주세요.')
    validateSources(members, false)
    // Alias copies may be a readonly basis, but changing them may not promote
    // old mirrored money to a new purchase or split a stable RAW owner.
    if (editedKinds.some(kind => basis[sourceKey(kind)] && basis[sourceKey(kind)] !== basis.id)) {
      fail('CASE_SHARING_ALIAS_BASIS_EDIT', '공유 금액의 원본 고객을 기준으로 선택한 뒤 수정해주세요. 기존 매출의 소유 관계는 유지됩니다.')
    }
    if (explicitManager) for (const member of next) {
      member.manager = draft.manager || undefined
      member.managerEmployeeNo = draft.managerEmployeeNo || undefined
    }
    if (explicitFinance) {
      const owner = next.find(member => member.id === basis.id)!
      // Only explicit numeric edits are propagated. The untouched method's
      // original/manual data is retained; readonly case projection chooses
      // one complete owner and never sums the other customer's method.
      const recipients = next.filter(member => partnerFor(member) === company)
      for (const member of recipients) {
        member.lumpSumAmount = amountFor(member, 'lumpSum')
        member.subscriptionAmount = amountFor(member, 'subscription')
      }
      for (const kind of editedKinds) {
        const amount = amountFor(draft, kind)
        if (amount === undefined && !hasRaw(basis, kind) && members.some(member => member.id !== basis.id
          && member[sourceKey(kind)] === basis.id && hasRaw(member, kind))) {
          fail('CASE_SHARING_RAW_ALIAS_CLEAR', '원본 매출 근거가 남아 있어 공유 기준을 지울 수 없습니다. 금액을 0원으로 입력하면 기준 고객 관계를 유지합니다.')
        }
        owner[amountKey(kind)] = amount
        owner[sourceKey(kind)] = amount !== undefined || hasRaw(basis, kind) ? basis.id : undefined
        for (const member of next) {
          if (partnerFor(member) !== company || member.id === basis.id) continue
          member[amountKey(kind)] = amount
          member[sourceKey(kind)] = owner[sourceKey(kind)]
        }
      }
      for (const member of recipients) {
        member.purchaseAmount = undefined
        // The full chosen owner's two methods are used together. B's unrelated
        // subscription is never added to A's lump sum.
        reconcilePurchase(member)
      }
      validateSources(next, false)
    }
  }
  let sharedChanged = false
  const patches: { id: string; patch: Partial<Lead> }[] = []
  for (const member of next) {
    const before = members.find(item => item.id === member.id)!
    const sharedChange = sharedKeys.some(key => JSON.stringify(before[key]) !== JSON.stringify(member[key])) || before.caseBasisLeadId !== member.caseBasisLeadId
      || JSON.stringify(before.caseMergeMemberIds) !== JSON.stringify(member.caseMergeMemberIds)
    if (sharedChange) {
      sharedChanged = true
      member.caseSharingHistory = [...(before.caseSharingHistory || []), { at: now, by: actorId, reason: 'group-share', previous: previousSharing(before) }]
    }
    const patch = changedPatch(before, member)
    if (Object.keys(patch).length) {
      member.updatedAt = now
      patches.push({ id: member.id, patch: { ...patch, updatedAt: now } })
    }
  }
  return { leads: next, patches, conflicts: [], sharedChanged }
}
