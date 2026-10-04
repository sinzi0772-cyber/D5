import assert from 'node:assert/strict'
import type { SeptemberAppointment } from '../src/data/septemberAppointments.ts'
import type { Lead } from '../src/types.ts'
import { buildSeptemberSyncPlan, canStartSeptemberSync, septemberExistingPatch } from '../src/lib/septemberSync.ts'

const source = (changes: Partial<SeptemberAppointment> = {}): SeptemberAppointment => ({
  sourceId: 'test-a', registeredAt: '2026-09-01', visitScheduledDate: '2026-09-02',
  appointmentType: '이업종제휴', customerName: '가*나', phoneLast4: '0001',
  partnerName: '테스트 업체', appointmentStatus: '완료', ...changes,
})
const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id, registeredAt: '2026-09-01', customerName: '가*나', phoneLast4: '0001', gender: '미입력',
  partnerName: '수기 업체', status: '관리중', visitState: '예정', updatedAt: '2026-10-01', ...changes,
})
const ready = {
  role: 'admin', mustChangePassword: false, dataReady: true,
  serverConfirmed: true, dataError: '', isDemoMode: false,
}
for (const role of ['admin', 'store_manager', 'assistant_manager']) {
  assert.equal(canStartSeptemberSync({ ...ready, role }), true)
}
for (const role of ['manager', 'staff', '', 'ADMIN']) {
  assert.equal(canStartSeptemberSync({ ...ready, role }), false, `Unprivileged role ${role}`)
}
for (const overrides of [
  { mustChangePassword: true }, { dataReady: false }, { serverConfirmed: false },
  { dataError: '권한 오류' }, { dataError: ' ' }, { isDemoMode: true },
]) {
  assert.equal(canStartSeptemberSync({ ...ready, ...overrides }), false)
}
assert.equal(canStartSeptemberSync({ ...ready, serverConfirmed: false }), false, 'Cached or pending-write snapshots cannot authorize automatic import')

const sample = source()
const newPlan = buildSeptemberSyncPlan([sample], [])
assert.deepEqual(newPlan, { entries: [{ source: sample, targetId: 'appointment-202609-test-a', kind: 'new' }], skipped: 0 })

const legacy = lead('manual')
assert.equal(buildSeptemberSyncPlan([sample], [legacy]).entries[0].targetId, 'manual')
const normalized = lead('normalized', { customerName: ' 가 ＊ 나 ', phoneLast4: '000-0000-0001' })
assert.equal(buildSeptemberSyncPlan([sample], [normalized]).entries[0].targetId, 'normalized')
for (const changes of [
  { customerName: '다*라' }, { phoneLast4: '0002' }, { registeredAt: '2026-09-03' },
  { visitScheduledDate: '2026-09-03' }, { appointmentType: '상담예약(이업종)' as const },
]) {
  assert.equal(buildSeptemberSyncPlan([sample], [lead('unrelated', changes)]).entries[0].kind, 'new', 'Legacy linking requires all matching evidence')
}
for (const appointmentType of [undefined, '미선택', sample.appointmentType]) {
  const plan = buildSeptemberSyncPlan([sample], [lead('eligible', { appointmentType, visitScheduledDate: sample.visitScheduledDate })])
  assert.equal(plan.entries[0].kind, 'existing')
}

const duplicateLegacy = buildSeptemberSyncPlan([sample], [legacy, lead('duplicate')])
assert.deepEqual(duplicateLegacy, { entries: [], skipped: 1 }, 'Duplicate masked identities cannot be resolved by list order')
const conflictingLegacy = buildSeptemberSyncPlan([sample], [lead('linked-elsewhere', { appointmentSourceId: 'test-other' })])
assert.deepEqual(conflictingLegacy, { entries: [], skipped: 1 }, 'A compatible legacy row already linked to another source is held')
const duplicateSource = buildSeptemberSyncPlan([sample], [
  lead('linked-a', { appointmentSourceId: sample.sourceId }), lead('linked-b', { appointmentSourceId: sample.sourceId }),
])
assert.deepEqual(duplicateSource, { entries: [], skipped: 1 })
assert.deepEqual(buildSeptemberSyncPlan([sample, source({ partnerName: '다른 테스트 업체' })], []), { entries: [], skipped: 2 }, 'Repeated source IDs are held')

const manuallyEdited = lead('appointment-202609-test-a', {
  appointmentType: '상담예약(이업종)', visitScheduledDate: '2026-10-10',
})
const deterministicPlan = buildSeptemberSyncPlan([sample], [manuallyEdited])
assert.deepEqual(deterministicPlan, { entries: [{ source: sample, targetId: manuallyEdited.id, kind: 'existing' }], skipped: 0 })
assert.deepEqual(septemberExistingPatch(sample, { ...manuallyEdited }), { appointmentSourceId: sample.sourceId }, 'Deterministic existing records retain manual type and date')
const sourceLinked = lead('already-linked', {
  appointmentSourceId: sample.sourceId, appointmentType: '상담예약(이업종)', visitScheduledDate: '2026-10-10',
})
assert.equal(buildSeptemberSyncPlan([sample], [sourceLinked, legacy]).entries[0].targetId, sourceLinked.id, 'An explicit source ID takes precedence over a legacy identity')
assert.deepEqual(septemberExistingPatch(sample, { ...sourceLinked }), {}, 'An existing explicit type and date are not rewritten')
assert.deepEqual(buildSeptemberSyncPlan([sample], [sourceLinked, manuallyEdited]), { entries: [], skipped: 1 }, 'Two authoritative targets for one source are held')
for (const changes of [
  { appointmentSourceId: 'test-other' }, { customerName: '다*라' }, { phoneLast4: '0002' },
]) {
  assert.deepEqual(buildSeptemberSyncPlan([sample], [lead('appointment-202609-test-a', changes)]), { entries: [], skipped: 1 }, 'A conflicting deterministic target cannot be recreated or overwritten')
}
assert.deepEqual(buildSeptemberSyncPlan([sample], [lead('linked', { appointmentSourceId: sample.sourceId, customerName: '다*라' })]), { entries: [], skipped: 1 }, 'Source IDs cannot bypass the identity check')

const secondSource = source({ sourceId: 'test-b' })
assert.deepEqual(buildSeptemberSyncPlan([sample, secondSource], [legacy]), { entries: [], skipped: 2 }, 'Two sources cannot reuse one legacy target')
assert.deepEqual(buildSeptemberSyncPlan([secondSource, sample], [legacy]), { entries: [], skipped: 2 }, 'Reordering sources cannot choose which one claims a legacy target')
for (const changes of [{ customerName: '***' }, { phoneLast4: '123' }, { sourceId: '' }]) {
  assert.deepEqual(buildSeptemberSyncPlan([source(changes)], []), { entries: [], skipped: 1 }, 'Invalid source identities or IDs cannot create data')
}

assert.deepEqual(septemberExistingPatch(sample, { customerName: '가*나', phoneLast4: '0001' }), {
  appointmentSourceId: 'test-a', appointmentType: '이업종제휴', visitScheduledDate: '2026-09-02',
}, 'Existing records receive only missing source fields, never new-record defaults')
assert.deepEqual(septemberExistingPatch(source({ visitScheduledDate: '' }), {
  customerName: '가*나', phoneLast4: '0001', appointmentSourceId: 'test-a', appointmentType: '이업종제휴',
}), {}, 'An absent source date does not manufacture a null or default date')
for (const missing of [undefined, null, '', ' ']) {
  assert.deepEqual(septemberExistingPatch(sample, {
    customerName: '가*나', phoneLast4: '0001', appointmentSourceId: missing,
    appointmentType: missing, visitScheduledDate: missing,
  }), { appointmentSourceId: 'test-a', appointmentType: '이업종제휴', visitScheduledDate: '2026-09-02' })
}
assert.deepEqual(septemberExistingPatch(sample, {
  customerName: '가*나', phoneLast4: '0001', appointmentSourceId: 'test-a',
  appointmentType: '미선택', visitScheduledDate: '2026-10-10',
}), { appointmentType: '이업종제휴' })

for (const existing of [
  { customerName: '다*라', phoneLast4: '0001' },
  { customerName: '가*나', phoneLast4: '0002' },
  { customerName: '가*나', phoneLast4: '123' },
  { customerName: '가*나', phoneLast4: '0001', appointmentSourceId: 'test-other' },
  { customerName: '가*나', phoneLast4: '0001', appointmentSourceId: 42 },
  { customerName: 42, phoneLast4: '0001' },
  {},
]) {
  assert.equal(septemberExistingPatch(sample, existing), null, 'Fresh transaction records must still have the expected identity and source ID')
}
const stalePlan = buildSeptemberSyncPlan([sample], [legacy])
assert.equal(stalePlan.entries[0].targetId, legacy.id)
assert.equal(septemberExistingPatch(sample, { ...legacy, appointmentSourceId: 'test-other' }), null, 'A source link changed after planning prevents the write')
assert.equal(septemberExistingPatch(sample, { ...legacy, phoneLast4: '0002' }), null, 'An identity changed after planning prevents the write')

const manualRecord: Record<string, unknown> = {
  ...lead('manual-fields'), appointmentType: '상담예약(이업종)', visitScheduledDate: '2026-10-10',
  registeredAt: '2026-08-01', gender: '여', manager: '수기 담당', managerEmployeeNo: 'test-manager',
  plannerName: '수기 플래너', caseGroupId: 'manual-group', status: '구매완료', visitState: '방문',
  purchaseType: '일시불+구독', purchaseAmount: 90, lumpSumAmount: 60, subscriptionAmount: 30,
  billToCode: 'manual-code', lgeSubchannel: 'manual-channel', note: '수기 메모',
  memoHistory: [{ id: 'manual', date: '2026-10-01', manager: '수기 담당', content: '보존' }],
  salesRawPeriods: { test: { sourceHash: 'manual-sales', confirmedAmount: 60 } },
  subscriptionRawPeriods: { test: { sourceHash: 'manual-subscription', confirmedBasisAmount: 30 } },
  createdBy: 'manual-user', createdAt: '2026-08-01', updatedBy: 'manual-user', updatedAt: '2026-10-01',
  unknownManualField: { retain: true },
}
const manualBefore = JSON.stringify(manualRecord)
const manualPatch = septemberExistingPatch(sample, manualRecord)
assert.deepEqual(manualPatch, { appointmentSourceId: sample.sourceId })
const merged = { ...manualRecord, ...manualPatch }
for (const field of Object.keys(manualRecord)) {
  assert.deepEqual(merged[field], manualRecord[field], `Manual field ${field} remains unchanged`)
}
assert.equal(JSON.stringify(manualRecord), manualBefore, 'Producing a patch does not mutate transaction data')

const sources = Object.freeze([Object.freeze(sample), Object.freeze(secondSource)])
const leads = Object.freeze([Object.freeze(legacy), Object.freeze(sourceLinked)])
const inputsBefore = JSON.stringify({ sources, leads })
buildSeptemberSyncPlan(sources, leads)
septemberExistingPatch(sample, Object.freeze({ ...legacy }))
assert.equal(JSON.stringify({ sources, leads }), inputsBefore, 'Planning and patch construction are pure')

console.log('septemberSync: server gates, safe matching, stale conflicts and immutable manual data passed')
