import assert from 'node:assert/strict'
import { buildExecutiveMetrics, getDefaultExecutiveMonth, getExecutiveMonthLeads, getExecutiveMonths } from '../src/lib/executiveMetrics.ts'
import type { Lead } from '../src/types.ts'

const lead = (id: string, changes: Partial<Lead> = {}): Lead => ({
  id,
  registeredAt: '2026-09-10',
  customerName: id,
  phoneLast4: '1234',
  gender: '미입력',
  partnerName: '(주)다이렉트컴즈',
  status: '관리중',
  visitState: '미정',
  updatedAt: '2026-09-10T00:00:00Z',
  ...changes,
})

const rows = [
  lead('couple-first', { caseGroupId: 'couple', registeredAt: '2026-08-31', manager: 'A', status: '취소', purchaseType: '일시불', purchaseAmount: 99_000 }),
  lead('couple-later', { caseGroupId: 'couple', registeredAt: '2026-09-01', manager: 'B', status: '구매완료', purchaseType: '일시불+구독', lumpSumAmount: 1_000_000, subscriptionAmount: 2_000_000 }),
  lead('finished', { manager: 'A', status: '구매완료', partnerName: '대상 아닌 업체', purchaseType: '구독', purchaseAmount: 1_000_000 }),
  lead('finished-no-amount', { manager: 'A', status: '구매완료' }),
  lead('active-amount', { manager: 'A', purchaseType: '일시불', purchaseAmount: 8_000_000, visitScheduledDate: '2026-10-02', memoHistory: [{ id: 'm1', date: '2026-10-01', manager: 'A', content: '연락' }] }),
  lead('closed', { manager: 'A', status: '상담 마감' }),
  lead('canceled', { manager: 'A', status: '취소' }),
  lead('unassigned', { registeredAt: '2026-09-26', visitScheduledDate: '2026-10-01' }),
  lead('already-visited', { manager: 'B', visitScheduledDate: '2026-09-30', visitState: '방문', note: '확인', updatedAt: '2026-10-02T23:00:00Z' }),
  lead('schedule-canceled', { manager: 'B', visitScheduledDate: '2026-09-30', visitState: '일정취소', memoHistory: [{ id: 'm2', date: '2026-09-26', manager: 'B', content: '변경' }] }),
]

const metrics = buildExecutiveMetrics(rows, '2026-09', '2026-10-03')
assert.equal(metrics.current.cases, 8)
assert.equal(metrics.current.customerCount, 8)
assert.equal(metrics.current.completed, 2)
assert.equal(metrics.current.active, 4)
assert.equal(metrics.current.closed, 1)
assert.equal(metrics.current.canceled, 1)
assert.equal(metrics.current.conversionRate, 25)
assert.equal(metrics.current.sales, 1_000_000, 'Only completed customer amounts are sales')
assert.equal(metrics.current.expectedCommission, 0, 'Subscription partner eligibility matters')
assert.equal(metrics.current.missingAmounts, 1)
assert.equal(metrics.previous.cases, 1, 'Cross-month linked group belongs only to earliest intake month')
assert.equal(metrics.previous.customerCount, 2)
assert.equal(metrics.previous.completed, 1, 'One completed member makes one completed case')
assert.equal(metrics.previous.canceled, 0, 'Case outcome categories are exclusive')
assert.equal(metrics.previous.sales, 3_000_000)
assert.equal(metrics.previous.expectedCommission, 50_000)
assert.deepEqual(metrics.actions.unassigned.map(item => item.id), ['unassigned'])
assert.deepEqual(metrics.actions.overdue.map(item => item.id), ['unassigned', 'active-amount'])
assert.deepEqual(metrics.actions.stale.map(item => item.id).sort(), ['schedule-canceled', 'unassigned'])
assert.equal(metrics.partners.reduce((total, item) => total + item.cases, 0), metrics.current.cases)
assert.equal(metrics.managers.find(item => item.name === 'A')?.assigned, 5)
assert.equal(metrics.current.managementRecords, 3)
assert.equal(getExecutiveMonthLeads(rows, '2026-08').length, 2)
assert.deepEqual(getExecutiveMonths(rows), ['2026-09', '2026-08'])
assert.equal(getDefaultExecutiveMonth(rows, '2026-10-03'), '2026-09')
assert.equal(getDefaultExecutiveMonth([], '2026-10-03'), '2026-10')
assert.equal(buildExecutiveMetrics([], '2026-01', '2026-10-03').previousMonth, '2025-12')
assert.equal(buildExecutiveMetrics([], '2026-10', '2026-10-03').current.conversionRate, 0)
assert.throws(() => buildExecutiveMetrics(rows, '2026-13', '2026-10-03'), RangeError)
assert.throws(() => buildExecutiveMetrics(rows, '2026-10', '2026-02-30'), RangeError)

const crossPartnerCouple = [
  lead('first-partner-a', { caseGroupId: 'cross-partner', registeredAt: '2026-08-31', partnerName: 'A 업체' }),
  lead('later-partner-b', { caseGroupId: 'cross-partner', registeredAt: '2026-09-01', partnerName: 'B 업체', status: '구매완료', purchaseType: '일시불', purchaseAmount: 1_000_000 }),
  lead('active-partner-b', { registeredAt: '2026-09-10', partnerName: 'B 업체' }),
]
const partnerBAugust = buildExecutiveMetrics(crossPartnerCouple, '2026-08', '2026-10-03', 'B 업체')
const partnerBSeptember = buildExecutiveMetrics(crossPartnerCouple, '2026-09', '2026-10-03', 'B 업체')
assert.equal(partnerBAugust.current.cases, 1, 'Partner B keeps the complete group original August cohort')
assert.equal(partnerBAugust.current.customerCount, 1, 'Partner filter includes only its own customer')
assert.equal(partnerBAugust.current.completed, 1)
assert.equal(partnerBAugust.current.sales, 1_000_000)
assert.equal(partnerBAugust.current.expectedCommission, 20_000)
assert.equal(partnerBSeptember.current.cases, 1, 'The later linked member does not become a new September case')
assert.equal(partnerBSeptember.current.completed, 0)
assert.equal(partnerBSeptember.previous.cases, 1)
assert.deepEqual(getExecutiveMonthLeads(crossPartnerCouple, '2026-08', 'B 업체').map(item => item.id), ['later-partner-b'])
assert.deepEqual(getExecutiveMonthLeads(crossPartnerCouple, '2026-09', 'B 업체').map(item => item.id), ['active-partner-b'])
assert.deepEqual(partnerBAugust.actions.unassigned.map(item => item.id), ['active-partner-b'], 'Action queues respect partner scope across intake months')
assert.deepEqual(partnerBAugust.actions.stale.map(item => item.id), ['active-partner-b'])

console.log('Executive metrics: cohort, grouping, sales, commission, and action queues passed.')
