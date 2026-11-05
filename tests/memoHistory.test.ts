import assert from 'node:assert/strict'
import { allMemoEntriesFor, managementMemoEntriesFor, latestManagementMemoDateFor, memoHistoryRevisionFor, isBestCancellationMemo } from '../src/lib/memoHistory'
import { buildExecutiveMetrics } from '../src/lib/executiveMetrics'
import type { Lead, MemoEntry } from '../src/types'

const system: MemoEntry = { id: 'best-cancel-source-1', date: '2026-11-03', manager: 'BEST 원본 확인', content: '원본에서 일시불 주문 취소 확인. 실제 취소일 미확인.' }
const human: MemoEntry = { id: 'human', date: '2026-10-20', manager: '담당자', content: '고객 연락' }
const base: Lead = { id: 'customer', registeredAt: '2026-10-01', customerName: '가**', phoneLast4: '1234', gender: '미입력', partnerName: '(주)다이렉트컴즈', appointmentType: '이업종제휴', manager: '담당자', status: '관리중', visitState: '미정', updatedAt: '2026-10-20T00:00:00.000Z', memoHistory: [human], note: human.content }
const appended: Lead = { ...base, memoHistory: [human, system] }
assert.equal(isBestCancellationMemo(system), true)
assert.equal(isBestCancellationMemo(human), false)
assert.deepEqual(allMemoEntriesFor(appended), [human, system], 'All original records stay visible')
assert.deepEqual(managementMemoEntriesFor(appended), [human], 'Automatic source import is not a customer contact')
assert.equal(latestManagementMemoDateFor(appended), human.date)
assert.equal(managementMemoEntriesFor(appended).at(-1)?.date, managementMemoEntriesFor(base).at(-1)?.date, 'Management column sort retains the last human entry')
assert.notEqual(memoHistoryRevisionFor(appended), memoHistoryRevisionFor(base), 'Background audit append must invalidate an open editor even without updatedAt change')
assert.equal(appended.updatedAt, base.updatedAt)

const before = buildExecutiveMetrics([base], '2026-10', '2026-11-03')
const after = buildExecutiveMetrics([appended], '2026-10', '2026-11-03')
assert.deepEqual(after.current, before.current, 'Contact count, financial and status metrics must stay unchanged')
assert.deepEqual(after.previous, before.previous)
assert.deepEqual(after.partners, before.partners)
assert.deepEqual(after.managers, before.managers)
assert.deepEqual(after.actions.stale.map(item => item.id), before.actions.stale.map(item => item.id), 'Automatic imports must not reset the 7-day contact queue')
assert.deepEqual(after.actions.stale.map(item => item.id), [base.id])

const legacy: Lead = { ...base, memoHistory: [], note: '기존 수기 메모', updatedAt: '2026-10-02T03:00:00.000Z' }
const legacyAppend = { ...legacy, memoHistory: [system] }
assert.equal(allMemoEntriesFor(legacyAppend).length, 2)
assert.equal(allMemoEntriesFor(legacyAppend)[0].content, legacy.note)
assert.equal(managementMemoEntriesFor(legacyAppend).length, 1)
assert.equal(latestManagementMemoDateFor(legacyAppend), '2026-10-02')
assert.deepEqual(buildExecutiveMetrics([legacyAppend], '2026-10', '2026-11-03').current, buildExecutiveMetrics([legacy], '2026-10', '2026-11-03').current)

const onlySystem: Lead = { ...base, memoHistory: [system], note: undefined }
assert.deepEqual(allMemoEntriesFor(onlySystem), [system])
assert.deepEqual(managementMemoEntriesFor(onlySystem), [])
assert.equal(latestManagementMemoDateFor(onlySystem), undefined)
assert.equal(buildExecutiveMetrics([onlySystem], '2026-10', '2026-11-03').current.managementRecords, 0)
const oldTabCopy = { ...onlySystem, note: system.content }
assert.deepEqual(allMemoEntriesFor(oldTabCopy), [system], 'A copied system note cannot reappear as a fake legacy contact')
assert.deepEqual(managementMemoEntriesFor(oldTabCopy), [])
assert.equal(latestManagementMemoDateFor(oldTabCopy), undefined)
assert.equal(buildExecutiveMetrics([oldTabCopy], '2026-10', '2026-11-03').current.managementRecords, 0)
assert.deepEqual(buildExecutiveMetrics([oldTabCopy], '2026-10', '2026-11-03').actions.stale.map(item => item.id), [base.id])
assert.equal(managementMemoEntriesFor({ ...base, memoHistory: [], note: '   ' }).length, 0)
console.log('PASS memo history: cancellation records remain visible without altering human activity, legacy notes or metrics')

