import assert from 'node:assert/strict'
import type { Lead } from '../src/types.ts'
import { CaseSharingError, caseSharingDraftFor, type CaseGroupGuard } from '../src/lib/caseSharing.ts'
import { leadFromDocument } from '../src/lib/leadDocument.ts'
import { financialCaseLeadsFor } from '../src/lib/caseBasis.ts'
import {
  CaseSaveError,
  saveCaseCustomerWithStore,
  unlinkCaseCustomerWithStore,
  type CaseSharingStore,
  type CaseSharingTransaction,
  type SaveCaseCustomerInput,
  type UnlinkCaseCustomerInput,
} from '../src/lib/caseSharingSave.ts'

type Document = Record<string, unknown>
const clone = <T>(value: T): T => structuredClone(value)
const groupId = 'case-test'
const actorId = 'synthetic-actor'
const actorEmployeeNo = '111'
const lead = (id: string, changes: Partial<Lead> = {}): Lead => leadFromDocument(id, {
  id, customerName: '가**', phoneLast4: '0001', registeredAt: '2026-09-01', gender: '미입력',
  partnerName: '(주)다이렉트컴즈', appointmentType: '이업종제휴', status: '관리중', visitState: '예정',
  purchaseType: '미선택', manager: '담당 A', managerEmployeeNo: actorEmployeeNo,
  caseGroupId: groupId, updatedAt: '2026-10-01T00:00:00.000Z', ...changes,
})
const documentFor = ({ id: _id, ...data }: Lead): Document => data
const guardFor = (members: Lead[], changes: Partial<CaseGroupGuard> = {}): CaseGroupGuard => ({
  memberIds: members.map(member => member.id).sort(), revision: 5,
  managerEmployeeNo: actorEmployeeNo, ...changes,
})

function assertDefinedPayload(value: unknown): void {
  assert.notEqual(value, undefined, 'Store writes must expose null clears rather than undefined or SDK sentinels')
  if (Array.isArray(value)) value.forEach(assertDefinedPayload)
  else if (value && typeof value === 'object') Object.values(value).forEach(assertDefinedPayload)
}

/** Synthetic documents only. Every transaction stages writes and commits after a successful callback. */
class MemoryStore implements CaseSharingStore {
  readonly leads = new Map<string, Document>()
  readonly guards = new Map<string, CaseGroupGuard>()
  readonly events: string[] = []
  committedWrites = 0
  failCommit = false
  beforeTransaction?: () => void

  constructor(members: Lead[], guards: [string, CaseGroupGuard][] = []) {
    for (const member of members) this.leads.set(member.id, clone(documentFor(member)))
    for (const [id, guard] of guards) this.guards.set(id, clone(guard))
  }

  snapshot(): string {
    return JSON.stringify({
      leads: [...this.leads].sort(([a], [b]) => a.localeCompare(b)),
      guards: [...this.guards].sort(([a], [b]) => a.localeCompare(b)),
    })
  }

  async getLead(id: string): Promise<Document | null> {
    this.events.push(`outside:lead:${id}`)
    return clone(this.leads.get(id) || null)
  }

  async getGuard(id: string): Promise<CaseGroupGuard | null> {
    this.events.push(`outside:guard:${id}`)
    return clone(this.guards.get(id) || null)
  }

  async getMembers(id: string): Promise<{ id: string; data: Document }[]> {
    this.events.push(`outside:members:${id}`)
    return [...this.leads].filter(([, data]) => data.caseGroupId === id)
      .map(([leadId, data]) => ({ id: leadId, data: clone(data) }))
  }

  async transaction<T>(work: (transaction: CaseSharingTransaction) => Promise<T>): Promise<T> {
    const beforeTransaction = this.beforeTransaction
    this.beforeTransaction = undefined
    beforeTransaction?.()
    const nextLeads = new Map([...this.leads].map(([id, data]) => [id, clone(data)]))
    const nextGuards = new Map([...this.guards].map(([id, guard]) => [id, clone(guard)]))
    const readLeadIds = new Set<string>()
    const readGuardIds = new Set<string>()
    let writesStarted = false
    let writeCount = 0
    const read = (event: string) => {
      assert.equal(writesStarted, false, 'All transaction reads must precede the first write')
      this.events.push(event)
    }
    const write = (event: string, payload: unknown) => {
      assertDefinedPayload(payload)
      writesStarted = true
      writeCount += 1
      this.events.push(event)
    }
    const transaction: CaseSharingTransaction = {
      getLead: async id => {
        read(`transaction:lead:${id}`)
        readLeadIds.add(id)
        return clone(nextLeads.get(id) || null)
      },
      getGuard: async id => {
        read(`transaction:guard:${id}`)
        readGuardIds.add(id)
        return clone(nextGuards.get(id) || null)
      },
      createLead: (id, payload) => {
        assert.ok(readLeadIds.has(id), 'Creation must first confirm document absence in the transaction')
        assert.equal(nextLeads.has(id), false, 'Creation must never overwrite an existing lead')
        write(`transaction:create:${id}`, payload)
        nextLeads.set(id, clone(payload))
      },
      updateLead: (id, payload) => {
        assert.ok(readLeadIds.has(id), 'Every updated lead must first be read in the transaction')
        assert.ok(nextLeads.has(id), 'An update must never recreate a missing lead')
        write(`transaction:update:${id}`, payload)
        nextLeads.set(id, { ...nextLeads.get(id), ...clone(payload) })
      },
      setGuard: (id, guard) => {
        assert.ok(readGuardIds.has(id), 'Every guard write must first read that guard')
        write(`transaction:guard-write:${id}`, guard)
        nextGuards.set(id, clone(guard))
      },
    }
    const result = await work(transaction)
    if (this.failCommit) throw new CaseSaveError('CASE_SAVE_COMMIT_FAILED', 'synthetic staged commit rejected')
    this.leads.clear()
    this.guards.clear()
    for (const [id, data] of nextLeads) this.leads.set(id, data)
    for (const [id, guard] of nextGuards) this.guards.set(id, guard)
    this.committedWrites += writeCount
    return result
  }
}

function saveInput(original: Lead, draft = original, openingMembers: Lead[] = [original], changes: Partial<SaveCaseCustomerInput> = {}): SaveCaseCustomerInput {
  return {
    original, draft, formBaseline: original, openingMembers, creating: false,
    actorId, actorEmployeeNo, canManageAll: true, assertSession: () => {}, ...changes,
  }
}

function unlinkInput(member: Lead, openingMembers: Lead[], changes: Partial<UnlinkCaseCustomerInput> = {}): UnlinkCaseCustomerInput {
  return { lead: member, openingMembers, actorId, canManageAll: true, assertSession: () => {}, ...changes }
}

async function rejectsWithoutMutation(store: MemoryStore, run: () => Promise<unknown>, code?: string): Promise<void> {
  const before = store.snapshot()
  const beforeWrites = store.committedWrites
  await assert.rejects(run, error => error instanceof CaseSaveError && typeof error.code === 'string' && (!code || error.code === code))
  assert.equal(store.snapshot(), before, 'Rejected plans leave every synthetic document and guard untouched')
  assert.equal(store.committedWrites, beforeWrites)
}

async function main(): Promise<void> {
  const a = lead('a', { purchaseType: '일시불+구독', lumpSumAmount: 100, subscriptionAmount: 20, note: 'A 메모', status: '구매완료', deliveryScheduledDate: '2026-11-01' })
  const b = lead('b', { purchaseType: '구독', subscriptionAmount: 80, manager: '담당 B', managerEmployeeNo: '222', note: 'B 메모', deliveryScheduledDate: '2026-12-01' })
  const members = [a, b]
  const originalGuard = guardFor(members, { managerEmployeeNo: null })
  const store = new MemoryStore(members, [[groupId, originalGuard]])
  const preview = caseSharingDraftFor(b, members, 'a').draft
  const basisInput = () => saveInput(b, preview, members, { formBaseline: preview, basis: { caseLeadId: 'a' } })
  await rejectsWithoutMutation(store, () => saveCaseCustomerWithStore(store, saveInput(b, { ...b, subscriptionAmount: 90 }, members)), 'CASE_SAVE_SHARING_CONFLICT')
  await rejectsWithoutMutation(store, () => saveCaseCustomerWithStore(store, saveInput(b, b, members, { basis: { lumpSumLeadId: 'a', subscriptionLeadId: 'b' } })), 'CASE_SHARING_MIXED_BASIS')
  const selected = await saveCaseCustomerWithStore(store, basisInput())
  assert.equal(selected.changedCount, 2)
  assert.equal(store.guards.get(groupId)!.basisLeadId, 'a')
  assert.equal(store.guards.get(groupId)!.revision, 6)
  for (const member of members) {
    const saved = store.leads.get(member.id)!
    assert.equal(saved.caseBasisLeadId, 'a')
    for (const key of ['purchaseType', 'purchaseAmount', 'lumpSumAmount', 'subscriptionAmount', 'manager', 'managerEmployeeNo', 'note', 'deliveryScheduledDate', 'salesRawPeriods', 'subscriptionRawPeriods'] as const) assert.deepEqual(saved[key], member[key], `Basis choice preserves ${member.id}.${key}`)
    assert.equal((saved.caseSharingHistory as Document[]).length, 1)
  }
  const savedMembers = [...store.leads].map(([id, data]) => leadFromDocument(id, data))
  const currentB = savedMembers.find(member => member.id === 'b')!
  const baseline = caseSharingDraftFor(currentB, savedMembers).draft
  await saveCaseCustomerWithStore(store, saveInput(currentB, { ...baseline, lumpSumAmount: 150 }, savedMembers, { formBaseline: baseline }))
  for (const member of members) {
    assert.equal(store.leads.get(member.id)!.lumpSumAmount, 150)
    assert.equal(store.leads.get(member.id)!.subscriptionAmount, member.id === 'a' ? 20 : 80)
    assert.equal(store.leads.get(member.id)!.lumpSumSourceId, 'a')
    assert.equal(store.leads.get(member.id)!.subscriptionSourceId, undefined)
  }
  assert.equal(((store.leads.get('b')!.caseSharingHistory as Document[])[1].previous as Document).subscriptionAmount, 80)
  assert.equal(store.leads.get('b')!.managerEmployeeNo, '222')
  assert.equal(store.leads.get('b')!.note, 'B 메모')
  assert.equal(store.leads.get('b')!.deliveryScheduledDate, '2026-12-01')

  const unknown = { unknownLegacy: 'preserve', nested: { source: 'untouched' } }
  const historyStore = new MemoryStore(members, [[groupId, originalGuard]])
  historyStore.leads.set('a', { ...historyStore.leads.get('a'), caseSharingHistory: [unknown] })
  const historyMembers = [leadFromDocument('a', historyStore.leads.get('a')!), b]
  await saveCaseCustomerWithStore(historyStore, { ...basisInput(), openingMembers: historyMembers })
  assert.deepEqual((historyStore.leads.get('a')!.caseSharingHistory as Document[])[0], unknown)
  const invalidHistory = new MemoryStore(members, [[groupId, originalGuard]])
  invalidHistory.leads.set('a', { ...documentFor(a), caseSharingHistory: { invalid: 'not-array' } })
  await rejectsWithoutMutation(invalidHistory, () => saveCaseCustomerWithStore(invalidHistory, { ...basisInput(), openingMembers: [leadFromDocument('a', invalidHistory.leads.get('a')!), b] }), 'CASE_SAVE_INVALID_HISTORY')

  const personalStore = new MemoryStore(members, [[groupId, originalGuard]])
  await saveCaseCustomerWithStore(personalStore, saveInput(b, { ...b, note: '기준 미정 중 개인 메모', status: '구매완료', deliveryScheduledDate: '2026-12-12' }, [b]))
  assert.equal(personalStore.leads.get('b')!.note, '기준 미정 중 개인 메모')
  assert.equal(personalStore.leads.get('b')!.subscriptionAmount, 80)
  assert.deepEqual(personalStore.leads.get('a'), documentFor(a))
  assert.deepEqual(personalStore.guards.get(groupId), originalGuard)
  assert.equal(personalStore.events.some(event => event.includes(':members:') || event.includes(':guard:')), false)
  const blank = lead('blank')
  const legacy = new MemoryStore([a, blank], [[groupId, guardFor([a, blank])]])
  const legacyBaseline = caseSharingDraftFor(blank, [a, blank]).draft
  await rejectsWithoutMutation(legacy, () => saveCaseCustomerWithStore(legacy, saveInput(blank, { ...legacyBaseline, lumpSumAmount: 150 }, [a, blank], { formBaseline: legacyBaseline, canManageAll: false })), 'CASE_SHARING_BASIS_FORBIDDEN')
  const established = [a, blank].map(member => ({ ...member, caseBasisLeadId: 'a' }))
  const establishedStore = new MemoryStore(established, [[groupId, guardFor(established, { basisLeadId: 'a' })]])
  const establishedBaseline = caseSharingDraftFor(established[1], established).draft
  await saveCaseCustomerWithStore(establishedStore, saveInput(established[1], { ...establishedBaseline, lumpSumAmount: 160 }, established, { formBaseline: establishedBaseline, canManageAll: false }))
  assert.equal(establishedStore.leads.get('a')!.lumpSumAmount, 160)
  assert.equal(establishedStore.leads.get('blank')!.lumpSumAmount, 160)

  const soloA = { ...a, caseGroupId: undefined }
  const soloB = { ...b, caseGroupId: undefined }
  const linkStore = new MemoryStore([soloA, soloB])
  await saveCaseCustomerWithStore(linkStore, saveInput(soloB, soloB, [soloA, soloB], { linkTargetId: 'a' }))
  for (const member of [soloA, soloB]) {
    const saved = linkStore.leads.get(member.id)!
    assert.equal(saved.caseGroupId, 'case-a')
    assert.equal(saved.caseBasisLeadId ?? null, null)
    assert.equal(saved.lumpSumAmount, member.lumpSumAmount)
    assert.equal(saved.subscriptionAmount, member.subscriptionAmount)
    assert.equal(saved.managerEmployeeNo, member.managerEmployeeNo)
    assert.equal(saved.caseSharingHistory, undefined)
  }
  assert.equal(linkStore.guards.get('case-a')!.basisLeadId, null)
  const joining = lead('joining', { caseGroupId: undefined, purchaseType: '일시불', lumpSumAmount: 900 })
  const basisLinkStore = new MemoryStore([...established, joining], [[groupId, guardFor(established, { basisLeadId: 'a' })]])
  await saveCaseCustomerWithStore(basisLinkStore, saveInput(joining, joining, [...established, joining], { linkTargetId: 'a' }))
  assert.equal(basisLinkStore.leads.get('joining')!.caseBasisLeadId, 'a')
  assert.equal(basisLinkStore.leads.get('joining')!.lumpSumAmount, 900)

  const originalPair = members.map(member => ({ ...member, caseBasisLeadId: 'a' }))
  const orderedGuard = { ...originalGuard, updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: actorId }
  const reorderedGuard = {
    updatedBy: orderedGuard.updatedBy, updatedAt: orderedGuard.updatedAt,
    managerEmployeeNo: orderedGuard.managerEmployeeNo,
    revision: orderedGuard.revision, memberIds: orderedGuard.memberIds,
  }
  const reorderedSave = new MemoryStore(members, [[groupId, orderedGuard]])
  reorderedSave.beforeTransaction = () => reorderedSave.guards.set(groupId, reorderedGuard)
  await saveCaseCustomerWithStore(reorderedSave, basisInput())
  assert.equal(reorderedSave.guards.get(groupId)!.basisLeadId, 'a', 'Field order changes do not block saving the selected basis')

  const reorderedUnlink = new MemoryStore(members, [[groupId, orderedGuard]])
  reorderedUnlink.beforeTransaction = () => reorderedUnlink.guards.set(groupId, reorderedGuard)
  await unlinkCaseCustomerWithStore(reorderedUnlink, unlinkInput(b, members))
  assert.deepEqual(reorderedUnlink.guards.get(groupId)!.memberIds, [], 'Field order changes do not block unlinking')

  const concurrentUnlink = new MemoryStore(members, [[groupId, orderedGuard]])
  concurrentUnlink.beforeTransaction = () => concurrentUnlink.guards.set(groupId, { ...reorderedGuard, revision: orderedGuard.revision + 1 })
  await assert.rejects(() => unlinkCaseCustomerWithStore(concurrentUnlink, unlinkInput(b, members)),
    error => error instanceof CaseSaveError && error.code === 'CASE_SAVE_STALE_GROUP')
  assert.equal(concurrentUnlink.committedWrites, 0, 'A real revision change still prevents writes')

  const unlinkStore = new MemoryStore(originalPair, [[groupId, guardFor(originalPair, { managerEmployeeNo: null, basisLeadId: 'a' })]])
  await unlinkCaseCustomerWithStore(unlinkStore, unlinkInput(originalPair[1], originalPair))
  for (const member of originalPair) {
    assert.equal(unlinkStore.leads.get(member.id)!.caseGroupId, null)
    assert.equal(unlinkStore.leads.get(member.id)!.caseBasisLeadId, null)
    assert.equal(unlinkStore.leads.get(member.id)!.lumpSumAmount, member.lumpSumAmount)
    assert.equal(unlinkStore.leads.get(member.id)!.subscriptionAmount, member.subscriptionAmount)
  }
  const alias = lead('alias', { caseBasisLeadId: 'a', purchaseType: '일시불', lumpSumAmount: 100, lumpSumSourceId: 'a' })
  const third = lead('third', { caseBasisLeadId: 'a' })
  const three = [{ ...a, caseBasisLeadId: 'a', lumpSumSourceId: 'a' }, alias, third]
  const unlinkOwner = new MemoryStore(three, [[groupId, guardFor(three, { basisLeadId: 'a' })]])
  const unlinkResult = await unlinkCaseCustomerWithStore(unlinkOwner, unlinkInput(three[0], three))
  assert.equal(unlinkResult.changedCount, 3)
  assert.equal(unlinkOwner.leads.get('alias')!.lumpSumSourceId, 'a')
  for (const member of three) assert.equal(unlinkOwner.leads.get(member.id)!.caseBasisLeadId, null)
  assert.equal(unlinkOwner.guards.get(groupId)!.basisLeadId, null)
  assert.deepEqual(unlinkOwner.guards.get(groupId)!.memberIds, ['alias', 'third'])

  for (const [name, change, code] of [
    ['stale', (target: MemoryStore) => target.leads.set('a', { ...documentFor(a), note: '다른 곳 변경' }), 'CASE_SAVE_STALE_CUSTOMER'],
    ['deleted', (target: MemoryStore) => target.leads.delete('a'), 'CASE_SAVE_CUSTOMER_MISSING'],
    ['guard drift', (target: MemoryStore) => target.guards.set(groupId, { ...originalGuard, revision: 6 }), 'CASE_SAVE_STALE_GROUP'],
  ] as const) {
    const target = new MemoryStore(members, [[groupId, originalGuard]])
    target.beforeTransaction = () => { change(target) }
    await assert.rejects(() => saveCaseCustomerWithStore(target, basisInput()), error => error instanceof CaseSaveError && error.code === code, name)
    assert.equal(target.committedWrites, 0)
  }
  const failure = new MemoryStore(members, [[groupId, originalGuard]])
  failure.failCommit = true
  await rejectsWithoutMutation(failure, () => saveCaseCustomerWithStore(failure, basisInput()), 'CASE_SAVE_COMMIT_FAILED')
  const malformed = new MemoryStore(established, [[groupId, guardFor(established, { basisLeadId: 'not-member' })]])
  await rejectsWithoutMutation(malformed, () => saveCaseCustomerWithStore(malformed, saveInput(established[1], establishedBaseline, established, { formBaseline: establishedBaseline, basis: { caseLeadId: 'a' } })), 'CASE_SAVE_INVALID_GUARD')
  const mismatch = new MemoryStore(originalPair, [[groupId, originalGuard]])
  await rejectsWithoutMutation(mismatch, () => saveCaseCustomerWithStore(mismatch, saveInput(originalPair[1], originalPair[1], originalPair, { basis: { caseLeadId: 'a' } })), 'CASE_SAVE_BASIS_INCONSISTENT')
  let checks = 0
  const session = new MemoryStore(members, [[groupId, originalGuard]])
  await assert.rejects(() => saveCaseCustomerWithStore(session, { ...basisInput(), assertSession: () => { if (++checks > 1) throw new CaseSharingError('CASE_SHARING_SESSION_CHANGED', 'synthetic session changed') } }), error => error instanceof CaseSharingError)
  assert.equal(session.committedWrites, 0)
  const mergeA = lead('merge-a', { purchaseType: '일시불', lumpSumAmount: 100, note: '수기 A' })
  const mergeB = lead('merge-b', { purchaseType: '일시불', lumpSumAmount: 200, note: '수기 B' })
  const mergeMembers = [mergeA, mergeB]
  const mergeGuard = guardFor(mergeMembers)
  const mergeStore = new MemoryStore(mergeMembers, [[groupId, mergeGuard]])
  const mergePreview = caseSharingDraftFor(mergeB, mergeMembers, mergeA.id, true).draft
  const mergeInput = saveInput(mergeB, mergePreview, mergeMembers, { formBaseline: mergePreview, basis: { caseLeadId: mergeA.id, mergePurchaseAmounts: true } })
  await saveCaseCustomerWithStore(mergeStore, mergeInput)
  assert.equal(mergeStore.leads.get(mergeA.id)!.lumpSumAmount, 100)
  assert.equal(mergeStore.leads.get(mergeB.id)!.lumpSumAmount, 200)
  assert.deepEqual(mergeStore.guards.get(groupId)!.mergeMemberIds, ['merge-a', 'merge-b'])
  const mergedSaved = [...mergeStore.leads].map(([id, data]) => leadFromDocument(id, data))
  assert.equal(financialCaseLeadsFor(mergedSaved)[0].lumpSumAmount, 300)
  const mergedB = mergedSaved.find(member => member.id === mergeB.id)!
  const mergedBaseline = caseSharingDraftFor(mergedB, mergedSaved).draft
  const managerReplacement = new MemoryStore(mergedSaved, [[groupId, guardFor(mergedSaved, { basisLeadId: mergeA.id, mergeMemberIds: [mergeA.id, mergeB.id], revision: 6 })]])
  await saveCaseCustomerWithStore(managerReplacement, saveInput(mergedB, { ...mergedBaseline, lumpSumAmount: 350 }, mergedSaved, { formBaseline: mergedBaseline, canManageAll: false }))
  const replacedMembers = [...managerReplacement.leads].map(([id, data]) => leadFromDocument(id, data))
  assert.equal(financialCaseLeadsFor(replacedMembers)[0].lumpSumAmount, 350)
  assert.ok(replacedMembers.every(member => member.lumpSumSourceId === mergeA.id && member.lumpSumAmount === 350))
  assert.equal(managerReplacement.guards.get(groupId)!.revision, 7)
  assert.deepEqual(managerReplacement.guards.get(groupId)!.mergeMemberIds, [mergeA.id, mergeB.id])
  assert.equal(replacedMembers.find(member => member.id === mergeB.id)!.caseSharingHistory?.at(-1)?.previous.lumpSumAmount, 200)
  const beforeReplay = mergeStore.snapshot()
  const replayWrites = mergeStore.committedWrites
  await saveCaseCustomerWithStore(mergeStore, saveInput(mergedB, mergedBaseline, mergedSaved, { formBaseline: mergedBaseline, basis: { caseLeadId: mergeA.id, mergePurchaseAmounts: true } }))
  assert.equal(mergeStore.snapshot(), beforeReplay)
  assert.equal(mergeStore.committedWrites, replayWrites)
  await rejectsWithoutMutation(mergeStore, () => saveCaseCustomerWithStore(mergeStore, saveInput(mergedB, mergedBaseline, mergedSaved, { formBaseline: mergedBaseline, basis: { caseLeadId: mergeA.id, mergePurchaseAmounts: false }, canManageAll: false })), 'CASE_SHARING_BASIS_FORBIDDEN')
  await saveCaseCustomerWithStore(mergeStore, saveInput(mergedB, mergedBaseline, mergedSaved, { formBaseline: mergedBaseline, basis: { caseLeadId: mergeB.id, mergePurchaseAmounts: false } }))
  assert.equal(mergeStore.leads.get(mergeA.id)!.lumpSumAmount, 100)
  assert.equal(mergeStore.leads.get(mergeB.id)!.lumpSumAmount, 200)
  assert.equal(mergeStore.leads.get(mergeB.id)!.caseMergeMemberIds, null)
  assert.equal(mergeStore.guards.get(groupId)!.mergeMemberIds, null)

  const soloMergeA = { ...mergeA, caseGroupId: undefined }
  const soloMergeB = { ...mergeB, caseGroupId: undefined }
  const atomicLink = new MemoryStore([soloMergeA, soloMergeB])
  const linkPreview = caseSharingDraftFor(soloMergeB, [soloMergeA, soloMergeB], soloMergeA.id, true).draft
  await saveCaseCustomerWithStore(atomicLink, saveInput(soloMergeB, linkPreview, [soloMergeA, soloMergeB], { linkTargetId: soloMergeA.id, formBaseline: linkPreview, basis: { caseLeadId: soloMergeA.id, mergePurchaseAmounts: true } }))
  assert.equal(atomicLink.leads.get(soloMergeA.id)!.lumpSumAmount, 100)
  assert.equal(atomicLink.leads.get(soloMergeB.id)!.lumpSumAmount, 200)
  assert.ok([...atomicLink.leads.values()].every(data => data.caseBasisLeadId === soloMergeA.id))
  assert.deepEqual(atomicLink.guards.get(`case-${soloMergeA.id}`)!.mergeMemberIds, [soloMergeA.id, soloMergeB.id])
  assert.equal(atomicLink.events.filter(event => event.startsWith('transaction:guard-write:')).length, 1, 'Link plus mode selection commits exactly one guarded transaction')
  const newOriginal = lead('merge-new', { caseGroupId: undefined, manager: undefined, managerEmployeeNo: undefined })
  const newDraft = { ...newOriginal, purchaseType: '일시불' as const, lumpSumAmount: 250, manager: '새 담당', managerEmployeeNo: '333' }
  const newLink = new MemoryStore([soloMergeA])
  await saveCaseCustomerWithStore(newLink, saveInput(newOriginal, newDraft, [soloMergeA, newOriginal], { creating: true, linkTargetId: soloMergeA.id, basis: { caseLeadId: soloMergeA.id, mergePurchaseAmounts: true } }))
  assert.equal(newLink.leads.get(newOriginal.id)!.lumpSumAmount, 250, 'Genuinely entered new source prices survive atomic linking')
  assert.equal(newLink.leads.get(newOriginal.id)!.managerEmployeeNo, '333')
  assert.equal(newLink.leads.get(soloMergeA.id)!.lumpSumAmount, 100)
  assert.equal(financialCaseLeadsFor([...newLink.leads].map(([id, data]) => leadFromDocument(id, data)))[0].lumpSumAmount, 350)

  const expanded = mergedSaved
  const expandedJoining = lead('merge-third', { caseGroupId: undefined, purchaseType: '일시불', lumpSumAmount: 400 })
  const expandingStore = new MemoryStore([...expanded, expandedJoining], [[groupId, guardFor(expanded, { basisLeadId: mergeA.id, mergeMemberIds: [mergeA.id, mergeB.id] })]])
  await saveCaseCustomerWithStore(expandingStore, saveInput(expandedJoining, expandedJoining, [...expanded, expandedJoining], { linkTargetId: mergeA.id }))
  for (const data of expandingStore.leads.values()) assert.equal(data.caseMergeMemberIds ?? null, null, 'A prior merge agreement never silently expands to another person')
  assert.equal(expandingStore.guards.get(groupId)!.mergeMemberIds, null)
  assert.deepEqual([...expandingStore.leads.values()].map(data => data.lumpSumAmount), [100, 200, 400])
  assert.deepEqual(((expandingStore.leads.get(mergeA.id)!.caseSharingHistory as Document[]).at(-1)!.previous as Document).caseMergeMemberIds, [mergeA.id, mergeB.id])
  const unlinkMerged = new MemoryStore(mergedSaved, [[groupId, guardFor(mergedSaved, { basisLeadId: mergeA.id, mergeMemberIds: [mergeA.id, mergeB.id] })]])
  await unlinkCaseCustomerWithStore(unlinkMerged, unlinkInput(mergedB, mergedSaved))
  for (const data of unlinkMerged.leads.values()) assert.equal(data.caseMergeMemberIds, null)
  assert.equal(unlinkMerged.guards.get(groupId)!.mergeMemberIds, null)

  const foreignMerge = { ...soloMergeB, partnerName: '다른 업체' }
  const foreignMergeStore = new MemoryStore([soloMergeA, foreignMerge])
  await rejectsWithoutMutation(foreignMergeStore, () => saveCaseCustomerWithStore(foreignMergeStore, saveInput(foreignMerge, foreignMerge, [soloMergeA, foreignMerge], { linkTargetId: soloMergeA.id, basis: { caseLeadId: soloMergeA.id, mergePurchaseAmounts: true } })), 'CASE_SHARING_CROSS_PARTNER_MERGE')
  const mergeCommitFailure = new MemoryStore(mergeMembers, [[groupId, mergeGuard]])
  mergeCommitFailure.failCommit = true
  await rejectsWithoutMutation(mergeCommitFailure, () => saveCaseCustomerWithStore(mergeCommitFailure, mergeInput), 'CASE_SAVE_COMMIT_FAILED')
  const mergeRace = new MemoryStore(mergeMembers, [[groupId, mergeGuard]])
  mergeRace.beforeTransaction = () => mergeRace.guards.set(groupId, { ...mergeGuard, revision: 6 })
  await assert.rejects(() => saveCaseCustomerWithStore(mergeRace, mergeInput), error => error instanceof CaseSaveError && error.code === 'CASE_SAVE_STALE_GROUP')
  assert.equal(mergeRace.committedWrites, 0)
  console.log('caseSharingSave: whole-basis/explicit merge, atomic links/new record edits, original preservation, mode invalidation, idempotence, permissions and race failures passed')
}

void main().catch(error => { console.error(error); process.exitCode = 1 })
