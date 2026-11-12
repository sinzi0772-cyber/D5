import assert from 'node:assert/strict'
import { caseBasisFor, caseBasisGroupsFor, financialCaseLeadFor, financialCaseLeadsFor } from '../src/lib/caseBasis'
import { leadFromDocument } from '../src/lib/leadDocument'
import { expectedRebateFor, financialTotalPurchaseAmountFor, totalPurchaseAmountFor } from '../src/lib/salesFinance'
import type { Lead } from '../src/types'

const makeLead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id, registeredAt: '2026-09-01', updatedAt: '2026-10-14T01:00:00.000Z',
  customerName: '김**', phoneLast4: '0123', gender: '미입력', partnerName: '아이웨딩',
  appointmentType: '이업종제휴', status: '구매완료', visitState: '방문',
  deliveryScheduledDate: '2026-10-31', manager: '수기 담당자', managerEmployeeNo: 'QA42',
  purchaseType: '일시불+구독', lumpSumAmount: 100000, subscriptionAmount: 200000,
  caseGroupId: 'pair', ...changes,
})
const rawLead = (id: string, changes: Partial<Lead> = {}): Lead => makeLead(id, {
  salesRawPeriods: {
    '2026-09': { period: '2026-09', sourceHash: `synthetic-${id}`, importedAt: '2026-10-14T01:00:00.000Z',
      orderCount: 1, confirmedOrderCount: 1, reservedOrderCount: 0,
      confirmedAmount: 100000, reservedAmount: 0, eligibleConfirmedAmount: 60000, eligibleReservedAmount: 0, returnAmount: 0,
      settlementBasisAmount: 100000 },
  },
  subscriptionRawPeriods: {
    '2026-09': { period: '2026-09', sourceHash: `synthetic-sub-${id}`, importedAt: '2026-10-14T01:00:00.000Z',
      itemCount: 1, confirmedItemCount: 1, pendingItemCount: 0, confirmedBasisAmount: 200000,
      pendingBasisAmount: 0, eligibleConfirmedBasisAmount: 120000, eligiblePendingBasisAmount: 0,
      includedStatuses: ['마감됨'], missingBasisItemCount: 0, rejectedProofItemCount: 0, settlementBasisAmount: 200000 },
  }, ...changes,
})
const eligibleLead = (id: string, changes: Partial<Lead> = {}): Lead => {
  const value = makeLead(id, changes)
  const raw = rawLead(id)
  return { ...value,
    salesRawPeriods: { '2026-09': { ...raw.salesRawPeriods!['2026-09'],
      confirmedAmount: value.lumpSumAmount || 0, eligibleConfirmedAmount: value.lumpSumAmount || 0,
      settlementBasisAmount: value.lumpSumAmount || 0 } },
    subscriptionRawPeriods: { '2026-09': { ...raw.subscriptionRawPeriods!['2026-09'],
      confirmedBasisAmount: value.subscriptionAmount || 0, eligibleConfirmedBasisAmount: value.subscriptionAmount || 0,
      settlementBasisAmount: value.subscriptionAmount || 0 } },
  }
}
const blank = (id: string, changes: Partial<Lead> = {}): Lead => makeLead(id, {
  purchaseType: '미선택', lumpSumAmount: undefined, subscriptionAmount: undefined,
  deliveryScheduledDate: undefined, status: '관리중', manager: undefined, managerEmployeeNo: undefined, ...changes,
})
const financialTotal = (leads: Lead[]) => financialCaseLeadsFor(leads).reduce((sum, lead) => sum + financialTotalPurchaseAmountFor(lead), 0)
const feeTotal = (leads: Lead[]) => financialCaseLeadsFor(leads).reduce((sum, lead) => sum + expectedRebateFor(lead), 0)
const a = rawLead('A')
const b = blank('B', { registeredAt: '2026-10-01' })
const originals = [a, b]
const before = JSON.stringify(originals)

assert.equal(caseBasisFor([]).status, 'empty')
assert.equal(caseBasisFor([blank('single', { caseGroupId: undefined })]).status, 'empty')
assert.equal(caseBasisFor([blank('A'), blank('B')]).status, 'empty', 'Equal empty originals form a genuine empty case')
for (const difference of [{ status: '취소' as const }, { deliveryScheduledDate: '2026-11-01' }, { managerEmployeeNo: 'QA43' }]) {
  assert.equal(caseBasisFor([blank('A'), blank('B', difference)]).status, 'unresolved', 'Different empty operational rows still require a whole-customer basis')
}
assert.equal(caseBasisFor([a]).status, 'unresolved', 'A grouped partial view cannot infer a missing B')
assert.equal(caseBasisFor([{ ...a, caseGroupId: undefined }]).basis?.id, 'A')
assert.equal(caseBasisFor(originals).basis?.id, 'A', 'A single financial side is the whole-customer basis')
assert.equal(financialTotal(originals), 300000)
assert.equal(feeTotal(originals), 5000, 'Current BEST evidence and each method rounding are retained')
assert.equal(caseBasisGroupsFor(originals).length, 1, 'Two originals form one logical customer')
assert.equal(caseBasisGroupsFor(originals)[0].registeredAt, '2026-09-01')

const duplicates = [rawLead('B', { registeredAt: '2026-10-01' }), a]
assert.equal(caseBasisFor(duplicates).basis?.id, 'A', 'Equivalent economic data uses a stable basis, not the newest row')
assert.equal(caseBasisFor([...duplicates].reverse()).basis?.id, 'A')
assert.equal(financialTotal(duplicates), 300000, 'Two equal independent RAW rows are not added')
assert.equal(feeTotal(duplicates), 5000)
assert.equal(caseBasisFor([makeLead('A'), makeLead('B')]).status, 'resolved', 'Equal independent manual values are also counted once')
const matchedRouteRaw = rawLead('A', {
  salesRawPeriods: { '2026-09': { ...a.salesRawPeriods!['2026-09'], eligibleConfirmedAmount: 100000 } },
  subscriptionRawPeriods: { '2026-09': { ...a.subscriptionRawPeriods!['2026-09'], eligibleConfirmedBasisAmount: 200000 } },
})
assert.equal(caseBasisFor([matchedRouteRaw, makeLead('B')]).status, 'unresolved', 'Equal sales with verified versus unverified commission evidence need an explicit basis')
const differentSettlementRaw = rawLead('B', {
  salesRawPeriods: { '2026-09': { ...a.salesRawPeriods!['2026-09'], settlementBasisAmount: 0 } },
})
assert.equal(caseBasisFor([a, differentSettlementRaw]).basis?.id, 'A', 'A settlement-only difference keeps the stable purchase basis')
assert.equal(feeTotal([a, differentSettlementRaw]), 5000, 'The stable basis supplies the one settlement amount')
assert.equal(caseBasisFor([differentSettlementRaw, makeLead('A')]).status, 'unresolved', 'Current RAW and manual-only purchases still require a basis choice')

for (const difference of [
  { lumpSumAmount: 100001 }, { subscriptionAmount: 200001 }, { status: '관리중' as const },
  { deliveryScheduledDate: '2026-11-01' }, { managerEmployeeNo: 'QA43' }, { partnerName: '(주)다이렉트컴즈' },
]) {
  const group = [a, rawLead('B', difference)]
  const selection = caseBasisFor(group)
  assert.equal(selection.status, 'unresolved', `Difference remains pending: ${Object.keys(difference)}`)
  assert.equal(selection.basis, undefined)
  assert.equal(financialCaseLeadsFor(group).length, 0, 'Pending is excluded, not represented as a zero-priced customer')
}

for (const routeEvidence of [
  { salesRawPeriods: { '2026-09': { ...a.salesRawPeriods!['2026-09'], eligibleConfirmedAmount: 0 } } },
  { subscriptionRawPeriods: { '2026-09': { ...a.subscriptionRawPeriods!['2026-09'], eligibleConfirmedBasisAmount: 0 } } },
]) {
  const group = [a, rawLead('B', routeEvidence)]
  assert.equal(caseBasisFor(group).basis?.id, 'A', 'Route-only differences do not change the equivalent financial basis')
  assert.equal(feeTotal(group), 5000, 'Equivalent BEST amounts still earn commission once')
}

const conflicting = [a, makeLead('B', { lumpSumAmount: 999999 })]
assert.equal(caseBasisFor(conflicting).status, 'unresolved')
const chosen = conflicting.map(member => ({ ...member, caseBasisLeadId: 'A' }))
assert.equal(caseBasisFor(chosen).basis?.id, 'A')
assert.equal(financialTotal(chosen), 300000)
assert.equal(feeTotal(chosen), 5000)
assert.equal(chosen[1].lumpSumAmount, 999999, 'The ignored manual original is never overwritten')
assert.equal(caseBasisFor([chosen[0], conflicting[1]]).status, 'unresolved', 'Partial metadata must not silently adopt one pointer')
assert.equal(caseBasisFor(chosen.map(member => ({ ...member, caseBasisLeadId: member.id }))).status, 'unresolved')
for (const badId of ['missing', '', 'invalid/id', ' A', 'x'.repeat(201)]) {
  assert.equal(caseBasisFor(conflicting.map(member => ({ ...member, caseBasisLeadId: badId }))).status, 'unresolved')
}
assert.equal(caseBasisFor(chosen, 'B').basis?.id, 'B', 'An explicit new choice can preview replacement of consistent old metadata')
assert.equal(caseBasisFor(chosen, 'missing').status, 'unresolved')
assert.equal(caseBasisFor([chosen[0]]).basis?.id, 'A', 'A visible stored basis is safe even when another member is filtered out')
assert.equal(caseBasisFor([{ ...chosen[1], caseBasisLeadId: 'A' }]).status, 'unresolved', 'A hidden basis never leaks into a subset')

const split = [
  makeLead('A', { subscriptionAmount: undefined, purchaseType: '일시불', purchaseAmount: 100000 }),
  eligibleLead('B', { lumpSumAmount: undefined, purchaseType: '구독', purchaseAmount: 200000 }),
]
assert.equal(caseBasisFor(split).status, 'unresolved', 'Per-method source choices cannot combine A and B into a new synthetic sale')
const subChoice = split.map(member => ({ ...member, caseBasisLeadId: 'B' }))
const subProjection = financialCaseLeadsFor(subChoice)[0]
assert.equal(subProjection.lumpSumAmount, undefined)
assert.equal(totalPurchaseAmountFor(subProjection), 200000, 'A whole basis never fills its empty method from A')
assert.equal(feeTotal(subChoice), 3000)

const alias = rawLead('B', {
  lumpSumSourceId: 'A', subscriptionSourceId: 'A',
  salesRawPeriods: { '2026-09': { ...a.salesRawPeriods!['2026-09'], eligibleConfirmedAmount: 100000 } },
  subscriptionRawPeriods: undefined,
})
const legacy = [a, alias].map(member => ({ ...member, caseBasisLeadId: 'B' }))
const aliasProjection = financialCaseLeadsFor(legacy)[0]
assert.equal(aliasProjection.id, 'B')
assert.equal(aliasProjection.lumpSumSourceId, 'B')
assert.equal(aliasProjection.subscriptionSourceId, 'B')
assert.equal(aliasProjection.salesRawPeriods?.['2026-09'].eligibleConfirmedAmount, 60000, 'Alias projection retains the valid source eligibility, not unrelated alias RAW')
assert.equal(aliasProjection.subscriptionRawPeriods?.['2026-09'].eligibleConfirmedBasisAmount, 120000)
assert.equal(financialTotal(legacy), 300000)
assert.equal(feeTotal(legacy), 5000)
assert.equal(alias.salesRawPeriods?.['2026-09'].eligibleConfirmedAmount, 100000, 'Projection never mutates alias RAW')

for (const badAlias of [
  { ...alias, lumpSumSourceId: 'missing' }, { ...alias, lumpSumAmount: 100001 },
  { ...alias, partnerName: '(주)다이렉트컴즈' },
]) assert.equal(caseBasisFor([a, badAlias], 'B').status, 'unresolved', 'Invalid legacy ownership cannot be promoted into manual money')
assert.equal(caseBasisFor([{ ...a, lumpSumSourceId: 'C' }, alias, rawLead('C')], 'B').status, 'unresolved', 'Source chains cannot silently transfer evidence')
assert.equal(caseBasisFor([{ ...alias, caseGroupId: undefined }]).status, 'unresolved', 'Unlinking an alias never resurrects a second independent sale')
assert.equal(caseBasisFor([
  blank('A', { subscriptionAmount: 200000, purchaseType: '구독' }),
  rawLead('B', { lumpSumAmount: undefined, lumpSumSourceId: 'A', subscriptionAmount: undefined, subscriptionRawPeriods: undefined }),
], 'B').status, 'unresolved', 'An unrelated source purchase method cannot validate this method alias')
assert.equal(caseBasisFor([rawLead('A', { lumpSumAmount: undefined }), blank('B')]).status, 'unresolved', 'Unentered nonzero RAW cannot masquerade as a zero sale')

const zero = makeLead('A', { lumpSumAmount: 0, subscriptionAmount: 0 })
assert.equal(caseBasisFor([zero, b]).status, 'resolved')
assert.equal(financialTotal([zero, b]), 0, 'An explicitly entered zero is a real resolved zero')
const blankChoice = caseBasisFor([a, b], 'B')
assert.equal(blankChoice.status, 'empty')
assert.equal(financialCaseLeadFor(blankChoice, [a, b])?.lumpSumAmount, undefined)
assert.equal(financialCaseLeadFor(blankChoice, [a, b])?.subscriptionAmount, undefined)

const rounding = [eligibleLead('A', { lumpSumAmount: 26, subscriptionAmount: 34 }), eligibleLead('B', { lumpSumAmount: 26, subscriptionAmount: 34 })]
assert.equal(financialTotal(rounding), 60)
assert.equal(feeTotal(rounding), 2, 'Round each method once, not once for each original member')
const legacySingleMethod = makeLead('single', { caseGroupId: undefined, lumpSumAmount: undefined, subscriptionAmount: undefined, purchaseType: '일시불', purchaseAmount: 123456 })
assert.equal(financialTotal([legacySingleMethod]), 123456, 'Normalizing a projection preserves an original legacy single-method amount')

const mixedRoots = [
  eligibleLead('A', { lumpSumAmount: 100000, subscriptionAmount: 200000, lumpSumSourceId: 'A', subscriptionSourceId: 'D' }),
  eligibleLead('D', { lumpSumAmount: 100000, subscriptionAmount: 200000, lumpSumSourceId: 'A', subscriptionSourceId: 'D' }),
  eligibleLead('alias', { lumpSumAmount: 100000, subscriptionAmount: 200000, lumpSumSourceId: 'A', subscriptionSourceId: 'D' }),
]
const mixedBefore = JSON.stringify(mixedRoots)
assert.equal(caseBasisFor(mixedRoots).status, 'unresolved', 'Old per-method roots are not one combined invoice')
assert.equal(caseBasisFor(mixedRoots, 'alias').status, 'unresolved', 'A mixed-root alias cannot become a whole original basis')
assert.equal(financialTotal(mixedRoots.map(member => ({ ...member, caseBasisLeadId: 'A' }))), 100000, 'Choosing original A counts only A own lump sum, never copied D subscription')
assert.equal(financialTotal(mixedRoots.map(member => ({ ...member, caseBasisLeadId: 'D' }))), 200000, 'Choosing original D counts only D own subscription, never copied A lump sum')
assert.equal(feeTotal(mixedRoots.map(member => ({ ...member, caseBasisLeadId: 'A' }))), 2000)
assert.equal(feeTotal(mixedRoots.map(member => ({ ...member, caseBasisLeadId: 'D' }))), 3000)
assert.equal(JSON.stringify(mixedRoots), mixedBefore, 'Readonly exclusion of borrowed methods does not remove saved source values')
const legacyPersonalDifferences = [a, { ...alias, status: '취소' as const, deliveryScheduledDate: '2027-01-01', managerEmployeeNo: 'OTHER' }]
assert.equal(caseBasisFor(legacyPersonalDifferences).basis?.id, 'A', 'A known single original root wins over alias-only personal differences')
assert.equal(financialTotal(legacyPersonalDifferences), 300000)
assert.equal(feeTotal(legacyPersonalDifferences), 5000)
const explicitAlias = legacyPersonalDifferences.map(member => ({ ...member, caseBasisLeadId: 'B' }))
assert.equal(financialCaseLeadsFor(explicitAlias)[0].status, '취소', 'An explicit safe alias basis still retains its chosen personal status')
assert.equal(financialCaseLeadsFor(explicitAlias)[0].deliveryScheduledDate, '2027-01-01')
assert.equal(caseBasisGroupsFor([...originals, makeLead('standalone', { caseGroupId: undefined })]).length, 2)
assert.equal(caseBasisGroupsFor([a, a, b])[0].members.length, 2, 'Repeated query copies of a saved ID do not inflate the logical case')
assert.equal(caseBasisFor([a, { ...a }]).status, 'unresolved', 'Duplicate IDs cannot evade complete-case checks')

for (const value of ['missing', 'invalid/id', '', 42, {}, []]) {
  const parsed = leadFromDocument('A', { ...a, caseBasisLeadId: value })
  assert.equal(caseBasisFor([parsed, { ...b, caseBasisLeadId: parsed.caseBasisLeadId }]).status, 'unresolved', 'Invalid basis metadata is preserved as a pending condition during reload')
}
const history = leadFromDocument('A', { ...a, caseBasisLeadId: 'A', caseSharingHistory: [{
  at: '2026-10-14T01:00:00.000Z', by: 'qa-actor', reason: 'group-share', previous: { caseBasisLeadId: 'B', lumpSumAmount: 400000 },
}] })
assert.equal(history.caseBasisLeadId, 'A')
assert.equal(history.caseSharingHistory?.[0].previous.caseBasisLeadId, 'B')
assert.equal(JSON.stringify(originals), before, 'Resolution and projection do not mutate either original customer')

console.log('caseBasis: whole-customer selection, no A+B, pending differences, explicit choice, safe legacy RAW, scopes, zero, rounding and reload tests passed')
