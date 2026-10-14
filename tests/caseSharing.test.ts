import assert from 'node:assert/strict'
import type { Lead, SalesRawPeriod } from '../src/types.ts'
import { CaseSharingError, caseSharingDraftFor, caseSharingRevisionFor, resolveCaseSharing } from '../src/lib/caseSharing.ts'
import { financialCaseLeadsFor } from '../src/lib/caseBasis.ts'
import { expectedRebateFor } from '../src/lib/salesFinance.ts'

const now = '2026-10-14T03:00:00.000Z'
const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({ id, customerName: '가**', phoneLast4: '0001', registeredAt: '2026-09-01', gender: '미입력', partnerName: '(주)다이렉트컴즈', appointmentType: '이업종제휴', status: '관리중', visitState: '예정', purchaseType: '미선택', caseGroupId: 'case-test', updatedAt: '2026-10-01T00:00:00.000Z', ...changes })
type Options = Partial<Parameters<typeof resolveCaseSharing>[0]>
const save = (members: Lead[], original = members[0], draft = original, options: Options = {}) => resolveCaseSharing({ members, original, draft, caseGroupId: 'case-test', actorId: 'test-actor', now, canManageAll: true, ...options })
const get = (result: ReturnType<typeof save>, id: string) => result.leads.find(member => member.id === id)!
const assertError = (code: string, run: () => unknown) => assert.throws(run, error => error instanceof CaseSharingError && error.code === code)
const raw: SalesRawPeriod = { period: '2026-09', sourceHash: 'synthetic', importedAt: now, orderCount: 1, confirmedOrderCount: 1, reservedOrderCount: 0, confirmedAmount: 100, reservedAmount: 0, eligibleConfirmedAmount: 40, eligibleReservedAmount: 0, returnAmount: 0 }
const a = lead('a', { manager: '담당 A', managerEmployeeNo: '101', purchaseType: '일시불+구독', lumpSumAmount: 100, subscriptionAmount: 20, salesRawPeriods: { '2026-09': raw }, note: 'A 개인 메모', status: '구매완료', deliveryScheduledDate: '2026-11-01' })
const b = lead('b', { manager: '담당 B', managerEmployeeNo: '102', purchaseType: '구독', subscriptionAmount: 80, note: 'B 개인 메모', deliveryScheduledDate: '2026-12-01' })
const originals = JSON.stringify([a, b])
assert.equal(caseSharingDraftFor(b, [a, b]).conflicts[0].kind, 'case', 'Conflicting whole records need one customer, not a per-kind mix')
const unresolved = save([a, b], b, { ...b, subscriptionAmount: 90 })
assert.equal(unresolved.conflicts.length, 1)
assert.deepEqual(unresolved.patches, [])
assert.equal(JSON.stringify(unresolved.leads), originals)
assertError('CASE_SHARING_MIXED_BASIS', () => save([a, b], b, b, { basis: { lumpSumLeadId: 'a', subscriptionLeadId: 'b' } }))

const aPreview = caseSharingDraftFor(b, [a, b], 'a').draft
assert.equal(aPreview.id, 'b')
assert.equal(aPreview.lumpSumAmount, 100)
assert.equal(aPreview.subscriptionAmount, 20, 'A full record is prefilled; B subscription is not added')
assert.equal(aPreview.managerEmployeeNo, '101')
assert.equal(aPreview.status, b.status)
assert.equal(aPreview.deliveryScheduledDate, b.deliveryScheduledDate)
assert.equal(aPreview.note, b.note)
const chosen = save([a, b], b, aPreview, { basis: { caseLeadId: 'a' }, formBaseline: aPreview })
for (const member of chosen.leads) assert.equal(member.caseBasisLeadId, 'a')
for (const key of ['lumpSumAmount', 'subscriptionAmount', 'purchaseAmount', 'purchaseType', 'manager', 'managerEmployeeNo', 'salesRawPeriods', 'subscriptionRawPeriods', 'lumpSumSourceId', 'subscriptionSourceId'] as const) {
  assert.deepEqual(get(chosen, 'a')[key], a[key], `Basis-only choice preserves original A ${key}`)
  assert.deepEqual(get(chosen, 'b')[key], b[key], `Basis-only choice preserves original B ${key}`)
}
assert.equal(get(chosen, 'b').caseSharingHistory?.[0].previous.subscriptionAmount, 80)
assert.equal(chosen.sharedChanged, true)
assert.equal(financialCaseLeadsFor(chosen.leads).length, 1)
assert.equal(financialCaseLeadsFor(chosen.leads)[0].subscriptionAmount, 20)
assert.equal(JSON.stringify([a, b]), originals, 'Originals and RAW never mutate')
const chosenB = save([a, b], b, b, { basis: { caseLeadId: 'b' } })
assert.equal(financialCaseLeadsFor(chosenB.leads)[0].lumpSumAmount, undefined, 'Choosing B never borrows A lump sum')
assert.equal(financialCaseLeadsFor(chosenB.leads)[0].subscriptionAmount, 80)

const activeB = get(chosen, 'b')
const baseline = caseSharingDraftFor(activeB, chosen.leads).draft
const edited = save(chosen.leads, activeB, { ...baseline, lumpSumAmount: 150 }, { formBaseline: baseline })
for (const member of edited.leads) {
  assert.equal(member.lumpSumAmount, 150)
  assert.equal(member.subscriptionAmount, member.id === 'a' ? 20 : 80, 'Untouched other-method originals are retained')
  assert.equal(member.lumpSumSourceId, 'a')
  assert.equal(member.subscriptionSourceId, undefined)
}
assert.deepEqual(get(edited, 'a').salesRawPeriods, a.salesRawPeriods)
assert.equal(get(edited, 'b').salesRawPeriods, undefined, 'Actual edits do not copy RAW')
assert.equal(get(edited, 'b').caseSharingHistory?.[1].previous.subscriptionAmount, 80, 'Before explicit shared edit the old B manual value is audited')
assert.equal(financialCaseLeadsFor(edited.leads).reduce((sum, member) => sum + expectedRebateFor(member), 0), 3 + 0, 'Changed lump sum becomes manual once; small subscription rounding stays exact')
const explicitManager = save(chosen.leads, activeB, { ...baseline, manager: '담당 C', managerEmployeeNo: '103' }, { formBaseline: baseline })
assert.ok(explicitManager.leads.every(member => member.managerEmployeeNo === '103'))
assert.equal(get(explicitManager, 'b').subscriptionAmount, 80, 'Assignment-only edits preserve financial originals')
assertError('CASE_SHARING_MANAGER_FORBIDDEN', () => save(chosen.leads, activeB, { ...baseline, manager: '무단', managerEmployeeNo: '999' }, { formBaseline: baseline, canManageAll: false }))
assertError('CASE_SHARING_BASIS_FORBIDDEN', () => save([a, b], b, aPreview, { formBaseline: aPreview, basis: { caseLeadId: 'a' }, canManageAll: false }))
const legacyBlank = lead('blank')
const legacyPreview = caseSharingDraftFor(legacyBlank, [a, legacyBlank]).draft
assertError('CASE_SHARING_BASIS_FORBIDDEN', () => save([a, legacyBlank], legacyBlank, { ...legacyPreview, lumpSumAmount: 150 }, { formBaseline: legacyPreview, canManageAll: false }))

const personal = save([a, b], b, { ...b, note: '충돌 중 메모' })
assert.equal(get(personal, 'b').note, '충돌 중 메모')
assert.equal(get(personal, 'b').subscriptionAmount, 80)
assert.equal(get(personal, 'a').caseSharingHistory, undefined)
assert.equal(personal.sharedChanged, false)
const repeated = save(chosen.leads, activeB, baseline, { formBaseline: baseline, basis: { caseLeadId: 'a' } })
assert.deepEqual(repeated.patches, [], 'Unchanged explicit basis never appends another audit')

const foreign = lead('foreign', { partnerName: '다른 업체', purchaseType: '일시불', lumpSumAmount: 900 })
const foreignBasis = save([a, foreign], a, a, { basis: { caseLeadId: 'foreign' } })
assert.equal(get(foreignBasis, 'a').lumpSumAmount, 100)
assert.equal(financialCaseLeadsFor(foreignBasis.leads)[0].partnerName, '다른 업체')
assertError('CASE_SHARING_CROSS_PARTNER_EDIT', () => save(foreignBasis.leads, get(foreignBasis, 'a'), { ...get(foreignBasis, 'a'), lumpSumAmount: 500 }))
const samePartner = lead('alias-company', { partnerName: '아이웨딩', purchaseType: '일시불', lumpSumAmount: 10 })
const canonical = lead('canonical-company', { partnerName: '(주)아이패밀리에스씨', caseBasisLeadId: samePartner.id })
const canonicalMembers = [{ ...samePartner, caseBasisLeadId: samePartner.id }, canonical]
const canonicalPreview = caseSharingDraftFor(canonical, canonicalMembers).draft
assert.equal(get(save(canonicalMembers, canonical, { ...canonicalPreview, lumpSumAmount: 15 }, { formBaseline: canonicalPreview }), canonical.id).lumpSumAmount, 15)

const owned = lead('root', { caseBasisLeadId: 'copy', purchaseType: '일시불', lumpSumAmount: 100, lumpSumSourceId: 'root' })
const copy = lead('copy', { caseBasisLeadId: 'copy', purchaseType: '일시불', lumpSumAmount: 100, lumpSumSourceId: 'root' })
assert.equal(caseSharingDraftFor(copy, [owned, copy]).conflicts.length, 0)
assertError('CASE_SHARING_ALIAS_BASIS_EDIT', () => save([owned, copy], copy, { ...copy, lumpSumAmount: 150 }))
const oldMixedA = lead('old-a', { purchaseType: '일시불+구독', lumpSumAmount: 100, subscriptionAmount: 200, lumpSumSourceId: 'old-a', subscriptionSourceId: 'old-d', caseBasisLeadId: 'old-a' })
const oldMixedD = lead('old-d', { purchaseType: '일시불+구독', lumpSumAmount: 100, subscriptionAmount: 200, lumpSumSourceId: 'old-a', subscriptionSourceId: 'old-d', caseBasisLeadId: 'old-a' })
const oldMembers = [oldMixedA, oldMixedD]
const cleanPreview = caseSharingDraftFor(oldMixedD, oldMembers).draft
assert.equal(cleanPreview.lumpSumAmount, 100)
assert.equal(cleanPreview.subscriptionAmount, undefined, 'Old A/B per-kind mixture is not reintroduced by the editor')
const oldEdited = save(oldMembers, oldMixedD, { ...cleanPreview, lumpSumAmount: 150 }, { formBaseline: cleanPreview })
assert.equal(get(oldEdited, 'old-d').subscriptionAmount, 200, 'Editing A own lump leaves D original subscription untouched')
assert.equal(get(oldEdited, 'old-a').subscriptionSourceId, 'old-d')
assert.equal(financialCaseLeadsFor(oldEdited.leads)[0].subscriptionAmount, undefined)
assert.equal(financialCaseLeadsFor(oldEdited.leads)[0].purchaseAmount, 150, 'Only A own edited method is counted, never A150 plus D200')
const noRawOwner = lead('no-raw', { caseBasisLeadId: 'no-raw', purchaseType: '일시불', lumpSumAmount: 100, lumpSumSourceId: 'no-raw' })
const rawAlias = lead('raw-alias', { caseBasisLeadId: 'no-raw', purchaseType: '일시불', lumpSumAmount: 100, lumpSumSourceId: 'no-raw', salesRawPeriods: { '2026-09': raw } })
assertError('CASE_SHARING_RAW_ALIAS_CLEAR', () => save([noRawOwner, rawAlias], noRawOwner, { ...noRawOwner, lumpSumAmount: undefined, purchaseAmount: undefined, purchaseType: '미선택' }))
const zeroed = save([noRawOwner, rawAlias], noRawOwner, { ...noRawOwner, lumpSumAmount: 0 })
assert.equal(get(zeroed, 'raw-alias').lumpSumSourceId, 'no-raw')
assert.deepEqual(get(zeroed, 'raw-alias').salesRawPeriods, rawAlias.salesRawPeriods)
assert.equal(financialCaseLeadsFor(zeroed.leads)[0].lumpSumAmount, 0, 'Zero clears value without resurrecting subordinate RAW')
assertError('CASE_SHARING_INVALID_MEMBER', () => save([b, b]))
assertError('CASE_SHARING_MEMBER_LIMIT', () => save(Array.from({ length: 9 }, (_, i) => lead(`member-${i}`))))
assert.equal(save(Array.from({ length: 8 }, (_, i) => lead(`member-${i}`))).conflicts.length, 0)
assertError('CASE_SHARING_INVALID_AMOUNT', () => save([lead('negative', { lumpSumAmount: -1 })]))
assertError('CASE_SHARING_INVALID_SOURCE', () => save([lead('bad-id', { lumpSumSourceId: 'bad/source' })]))
assertError('CASE_SHARING_INVALID_BASIS', () => save([lead('bad-basis', { caseBasisLeadId: 'bad/source' })]))
assertError('CASE_SHARING_INVALID_AUDIT', () => save([b], b, b, { actorId: '' }))
assertError('CASE_SHARING_INVALID_AUDIT', () => save([b], b, b, { now: 'invalid' }))
assertError('CASE_SHARING_INVALID_HISTORY', () => save([lead('bad-history', { caseSharingHistory: {} as never })]))
assert.notEqual(caseSharingRevisionFor(a), caseSharingRevisionFor({ ...a, caseBasisLeadId: 'b' }))
assert.notEqual(caseSharingRevisionFor(a), caseSharingRevisionFor({ ...a, note: '새 메모' }))
const sumA = lead('sum-a', { purchaseType: '일시불', lumpSumAmount: 100, manager: '담당 A', managerEmployeeNo: '101' })
const sumB = lead('sum-b', { purchaseType: '일시불', lumpSumAmount: 200, manager: '담당 B', managerEmployeeNo: '102' })
const sumMembers = [sumA, sumB]
const sumPreview = caseSharingDraftFor(sumB, sumMembers, sumA.id, true).draft
assert.equal(sumPreview.lumpSumAmount, 300)
const sumChoice = save(sumMembers, sumB, sumPreview, { formBaseline: sumPreview, basis: { caseLeadId: sumA.id, mergePurchaseAmounts: true } })
assert.deepEqual(sumChoice.leads.map(member => member.lumpSumAmount), [100, 200], 'Merge agreement is metadata-only; original A/B prices remain')
assert.ok(sumChoice.leads.every(member => JSON.stringify(member.caseMergeMemberIds) === JSON.stringify(['sum-a', 'sum-b'])))
assert.equal(financialCaseLeadsFor(sumChoice.leads)[0].lumpSumAmount, 300)
const sumCurrent = get(sumChoice, sumB.id)
const sumBaseline = caseSharingDraftFor(sumCurrent, sumChoice.leads).draft
assert.equal(sumBaseline.lumpSumAmount, 300)
const replacedSum = save(sumChoice.leads, sumCurrent, { ...sumBaseline, lumpSumAmount: 350 }, { formBaseline: sumBaseline })
assert.equal(financialCaseLeadsFor(replacedSum.leads)[0].lumpSumAmount, 350, 'An explicit aggregate price replacement shares one source and dedups it')
assert.deepEqual(replacedSum.leads.map(member => member.lumpSumAmount), [350, 350])
assert.equal(get(replacedSum, sumB.id).caseSharingHistory?.at(-1)?.previous.lumpSumAmount, 200)
const sumRepeated = save(sumChoice.leads, sumCurrent, sumBaseline, { formBaseline: sumBaseline, basis: { caseLeadId: sumA.id, mergePurchaseAmounts: true } })
assert.deepEqual(sumRepeated.patches, [], 'Repeated identical merge choice does not rewrite or append history')
const sumNo = save(sumChoice.leads, sumCurrent, sumBaseline, { formBaseline: sumBaseline, basis: { caseLeadId: sumB.id, mergePurchaseAmounts: false } })
assert.ok(sumNo.leads.every(member => member.caseMergeMemberIds === undefined))
assert.deepEqual(sumNo.leads.map(member => member.lumpSumAmount), [100, 200])
assert.equal(financialCaseLeadsFor(sumNo.leads)[0].lumpSumAmount, 200)
assertError('CASE_SHARING_MERGE_BASIS_REQUIRED', () => save(sumMembers, sumB, sumB, { basis: { mergePurchaseAmounts: true } }))
assertError('CASE_SHARING_BASIS_FORBIDDEN', () => save(sumMembers, sumB, sumPreview, { formBaseline: sumPreview, basis: { caseLeadId: sumA.id, mergePurchaseAmounts: true }, canManageAll: false }))
assertError('CASE_SHARING_BASIS_FORBIDDEN', () => save(sumChoice.leads, sumCurrent, sumBaseline, { formBaseline: sumBaseline, basis: { caseLeadId: sumA.id, mergePurchaseAmounts: false }, canManageAll: false }))
assertError('CASE_SHARING_CROSS_PARTNER_MERGE', () => save([sumA, foreign], sumA, sumA, { basis: { caseLeadId: sumA.id, mergePurchaseAmounts: true } }))
const spacingA = { ...sumA, partnerName: '(주)아이니웨딩네트웍스' }
const spacingB = { ...sumB, partnerName: '(주) 아이니웨딩네트웍스' }
assert.equal(save([spacingA, spacingB], spacingB, spacingB, { basis: { caseLeadId: spacingA.id, mergePurchaseAmounts: true } }).conflicts.length, 0, 'Prefix spacing is one approved company without source renaming')
assert.notEqual(caseSharingRevisionFor(sumA), caseSharingRevisionFor({ ...sumA, caseMergeMemberIds: ['sum-a', 'sum-b'] }))
console.log('caseSharing: explicit money merge/no-merge, one customer, metadata-only originals, aggregate replacement, aliases, RAW/history and permissions passed')
