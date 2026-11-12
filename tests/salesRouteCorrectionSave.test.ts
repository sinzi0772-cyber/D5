import assert from 'node:assert/strict'
import type { SalesRawPeriod } from '../src/types'
import { caseSharingRevisionFor } from '../src/lib/caseSharing'
import { leadFromDocument } from '../src/lib/leadDocument'
import { expectedRebateFor } from '../src/lib/salesFinance'
import { getStoredSalesChannels } from '../src/lib/salesChannels'
import { salesRouteCorrectionWriteFor } from '../src/lib/salesRouteCorrectionSave'
import { latestSalesRouteCorrectionFor, salesRouteTargetFor } from '../src/lib/salesRouteCorrections'

const id = 'a'
const now = '2026-11-12T03:00:00.000Z'
const raw: SalesRawPeriod = {
  period: '2026-10', sourceHash: 'best-a', importedAt: now, orderCount: 1, confirmedOrderCount: 1,
  reservedOrderCount: 0, confirmedAmount: 600_000, reservedAmount: 0, eligibleConfirmedAmount: 0,
  eligibleReservedAmount: 0, returnAmount: 0,
  channels: [{ channel1: '고객인증서비스(웨딩)', channel2: '웨딩매장행사', orderCount: 1, amount: 600_000 }],
}
const document = {
  registeredAt: '2026-10-22', customerName: '합**', phoneLast4: '9000', partnerName: '(주) 아이니웨딩네트웍스',
  managerEmployeeNo: 'QA-1', appointmentType: '이업종제휴', status: '구매완료', purchaseType: '일시불+구독',
  lumpSumAmount: 600_000, subscriptionAmount: 400_000, salesRawPeriods: { '2026-10': raw }, updatedAt: now,
}
const lead = leadFromDocument(id, document)
const targets = getStoredSalesChannels(lead).map(route => salesRouteTargetFor(lead, route))
const rawTarget = targets.find(target => target.kind === 'lumpSum')!
const manualTarget = targets.find(target => target.kind === 'subscription')!
assert.equal(manualTarget.period, null)

const input = {
  leadId: id, target: rawTarget, actorId: 'staff-qa', actorEmployeeNo: 'QA-1', canManageAll: false,
  correctedChannel1: '고객인증서비스(웨딩)', correctedChannel2: '웨딩박람회(내부)', assertSession: () => {},
}
const firstId = 'Z'.repeat(20)
const first = salesRouteCorrectionWriteFor(document, input, firstId, now, { toDate: () => new Date(now) })
assert.deepEqual(Object.keys(first.update ?? {}), ['salesRouteCorrections'])
const saved = { ...document, ...first.update }
const savedLead = leadFromDocument(id, saved)
assert.deepEqual(latestSalesRouteCorrectionFor(savedLead, rawTarget), first.correction)
assert.equal(latestSalesRouteCorrectionFor(savedLead, manualTarget), undefined)
assert.deepEqual(savedLead.salesRawPeriods, lead.salesRawPeriods)
assert.equal(expectedRebateFor(savedLead), expectedRebateFor(lead))
assert.equal(caseSharingRevisionFor(savedLead), caseSharingRevisionFor(lead))

assert.throws(() => salesRouteCorrectionWriteFor(saved, input, 'Y'.repeat(20), now, now), /이미 다른 판매경로/)
assert.equal(salesRouteCorrectionWriteFor(saved, { ...input, expectedCorrection: first.correction }, 'Y'.repeat(20), now, now).update, undefined)
assert.throws(() => salesRouteCorrectionWriteFor({ ...document, managerEmployeeNo: 'QA-2' }, input, firstId, now, now), /권한/)
assert.throws(() => salesRouteCorrectionWriteFor({ ...document, lumpSumSourceId: 'shared-owner' }, { ...input, canManageAll: true }, firstId, now, now), /권한/)
assert.throws(() => salesRouteCorrectionWriteFor({ ...document, salesRawPeriods: { '2026-10': { ...raw, sourceHash: 'best-b' } } }, input, firstId, now, now), /원본이 변경/)
assert.throws(() => salesRouteCorrectionWriteFor(document, { ...input, correctedChannel2: '' }, firstId, now, now), /판매경로 1과 2/)
assert.throws(() => salesRouteCorrectionWriteFor(document, { ...input, correctedChannel2: '부사장이하' }, firstId, now, now), /판매 RAW/)
assert.throws(() => salesRouteCorrectionWriteFor(document, { ...input, correctedChannel1: '임직원', correctedChannel2: '임직원' }, firstId, now, now), /판매 RAW/)

const secondId = 'A'.repeat(20)
const second = salesRouteCorrectionWriteFor(saved, { ...input, target: manualTarget }, secondId, now, now)
const secondSaved = leadFromDocument(id, { ...saved, ...second.update })
assert.deepEqual(secondSaved.salesRouteCorrections?.map(correction => correction.id), [firstId, secondId])
assert.equal(latestSalesRouteCorrectionFor(secondSaved, rawTarget)?.id, firstId)
assert.equal(latestSalesRouteCorrectionFor(secondSaved, manualTarget)?.id, secondId)
assert.equal(expectedRebateFor(secondSaved), expectedRebateFor(lead))
assert.throws(() => salesRouteCorrectionWriteFor({ ...saved, subscriptionAmount: 1 }, { ...input, target: manualTarget }, secondId, now, now), /원본이 변경/)

console.log('sales route corrections preserve BEST data, settlement and unrelated customer editing')
