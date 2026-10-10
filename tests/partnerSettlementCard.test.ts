import assert from 'node:assert/strict'
import type { PartnerPreviewModel } from '../src/lib/partnerPreview'
import { getPartnerSettlementCard } from '../src/lib/partnerSettlementCard'

const model: PartnerPreviewModel = {
  partnerName: '테스트 업체', intakeMonth: '2026-09', receiptCount: 4, customerCount: 4,
  completedCount: 4, activeCount: 0, completedExpectedCommission: 7734,
  undatedExpectedCommission: 4000, undatedCustomerCount: 1,
  settlements: [
    { month: '2026-11', expectedCommission: 1234, customerCount: 1 },
    { month: '2026-12', expectedCommission: 2500, customerCount: 2 },
  ],
  customers: [],
}
for (const bucket of model.settlements) Object.freeze(bucket)
Object.freeze(model.settlements)
Object.freeze(model.customers)
Object.freeze(model)
const before = JSON.stringify(model)
const earliest = getPartnerSettlementCard(model)
assert.deepEqual(earliest, {
  selection: '2026-11', expectedCommission: 1234, customerCount: 1,
  options: [{ value: '2026-11', month: '2026-11' }, { value: '2026-12', month: '2026-12' }, { value: 'undated', month: null }],
})
assert.notEqual(earliest.expectedCommission, model.completedExpectedCommission, 'A monthly card must not display the all-month total')
assert.notEqual(earliest.options[0], model.settlements[0], 'Option records are copied')
assert.equal(getPartnerSettlementCard(model, '2026-12').expectedCommission, 2500)
assert.equal(getPartnerSettlementCard(model, '2026-12').customerCount, 2)
assert.equal(getPartnerSettlementCard(model, 'undated').expectedCommission, 4000)
assert.equal(getPartnerSettlementCard(model, 'undated').customerCount, 1)
for (const requested of ['', '2025-01', '2026-13', 'all', '전체', 'undated-other']) assert.equal(getPartnerSettlementCard(model, requested).selection, '2026-11', 'A stale or unknown selection falls back to the earliest dated bucket')
assert.equal(JSON.stringify(model), before, 'Selection must not change dates, amounts, state, counts or option order in the source')

const zeroFee: PartnerPreviewModel = { ...model, settlements: [{ month: '2026-10', expectedCommission: 0, customerCount: 1 }], undatedCustomerCount: 0, undatedExpectedCommission: 0 }
assert.deepEqual(getPartnerSettlementCard(zeroFee), {
  selection: '2026-10', expectedCommission: 0, customerCount: 1,
  options: [{ value: '2026-10', month: '2026-10' }],
}, 'An eligible month with zero fee still remains selectable')
assert.equal(getPartnerSettlementCard(zeroFee, 'undated').selection, '2026-10', 'No undated option when the undated customer count is zero')

const undatedOnly: PartnerPreviewModel = { ...model, settlements: [] }
assert.deepEqual(getPartnerSettlementCard(undatedOnly, '2026-12'), {
  selection: 'undated', expectedCommission: 4000, customerCount: 1,
  options: [{ value: 'undated', month: null }],
}, 'With no dated months, the separate undated bucket is the default')
assert.equal(getPartnerSettlementCard({ ...undatedOnly, undatedExpectedCommission: 0 }).customerCount, 1)

const empty: PartnerPreviewModel = { ...model, settlements: [], undatedExpectedCommission: 99999, undatedCustomerCount: 0 }
assert.deepEqual(getPartnerSettlementCard(empty), { selection: '', expectedCommission: 0, customerCount: 0, options: [] }, 'An empty selection never substitutes any aggregate or an orphan undated amount')
assert.deepEqual(getPartnerSettlementCard(empty, 'undated'), getPartnerSettlementCard(empty))
const switched: PartnerPreviewModel = { ...model, settlements: [{ month: '2027-02', expectedCommission: 700, customerCount: 1 }], undatedCustomerCount: 0, undatedExpectedCommission: 0 }
assert.equal(getPartnerSettlementCard(switched, earliest.selection).selection, '2027-02', 'A props/month/company switch must resolve the old selection against the new model')
assert.equal(getPartnerSettlementCard(switched, '2026-12').expectedCommission, 700)

console.log('Partner settlement card: per-month selection, separate undated bucket, zero-fee months, stale selection and immutable source tests passed.')
