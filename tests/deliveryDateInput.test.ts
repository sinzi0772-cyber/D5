import assert from 'node:assert/strict'
import { normalizeDeliveryDateInput } from '../src/lib/deliveryDateInput.ts'
import { isValidDeliveryDate, expectedSettlementMonthFor } from '../src/lib/commissionSettlement.ts'

for (const [input, expected] of [['', ''], ['2026', '2026'], ['202610', '2026-10'], ['2026-10-', '2026-10-'], ['2026-10-22', '2026-10-22'], ['20261022', '2026-10-22'], [' 20261022 ', '2026-10-22'], ['00010101', '0001-01-01'], ['99991231', '9999-12-31']]) {
  assert.equal(normalizeDeliveryDateInput(input), expected)
}
for (const input of ['20260229', '20260431', '00000101', '20261301', '202610', 'not-a-date']) assert.equal(isValidDeliveryDate(normalizeDeliveryDateInput(input)), false)
assert.equal(isValidDeliveryDate(normalizeDeliveryDateInput('20240229')), true)
assert.equal(expectedSettlementMonthFor({ deliveryScheduledDate: normalizeDeliveryDateInput('20261022') }), '2026-12')
assert.equal(expectedSettlementMonthFor({ deliveryScheduledDate: normalizeDeliveryDateInput('20261122') }), '2027-01')
