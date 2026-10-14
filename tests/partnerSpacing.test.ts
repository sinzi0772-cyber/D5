import assert from 'node:assert/strict'
import type { Lead } from '../src/types'
import { canonicalPartnerName } from '../src/lib/partners'
import { leadFromDocument } from '../src/lib/leadDocument'
import { buildExecutiveMetrics, getExecutiveMonthLeads } from '../src/lib/executiveMetrics'
import { buildCommissionSettlementMetrics } from '../src/lib/commissionSettlement'
import { buildPartnerPreview } from '../src/lib/partnerPreview'
import { caseBasisFor } from '../src/lib/caseBasis'
import { expectedRebateFor } from '../src/lib/salesFinance'

const company = '(주) 아이니웨딩네트웍스'
const lead = (id: string, partnerName: string, amount: number): Lead => ({
  id, customerName: '가**', phoneLast4: '0001', gender: '미입력',
  registeredAt: '2026-10-10', updatedAt: '2026-10-14T00:00:00.000Z',
  partnerName, appointmentType: '이업종제휴', status: '구매완료',
  deliveryScheduledDate: '2026-10-20', visitState: '방문', manager: '합성 담당',
  purchaseType: '일시불+구독', lumpSumAmount: amount, subscriptionAmount: amount / 2,
  note: '보존할 수기 메모',
})
const rows = Object.freeze([
  Object.freeze(lead('spacing-a', '(주)아이니웨딩네트웍스', 100000)),
  Object.freeze(lead('spacing-b', company, 200000)),
  Object.freeze(lead('other-full-company', '(주)아이니웨딩', 70000)),
])
const before = JSON.stringify(rows)
const combined = buildExecutiveMetrics(rows, '2026-10', '2026-10-14', company)
assert.equal(combined.current.cases, 2, 'Company-name consolidation must not merge independent customers')
assert.equal(combined.partners.length, 1)
assert.equal(combined.partners[0].name, company)
assert.equal(combined.current.sales, 450000)
assert.equal(combined.current.expectedCommission, 8250)
assert.deepEqual(getExecutiveMonthLeads(rows, '2026-10', '(주)아이니웨딩네트웍스').map(row => row.id), ['spacing-a', 'spacing-b'])
const allCompanies = buildExecutiveMetrics(rows, '2026-10', '2026-10-14')
assert.equal(allCompanies.partners.length, 2, 'Similar but different full company names stay separate')
const monthly = buildCommissionSettlementMetrics(rows)
assert.equal(monthly.months.length, 1)
assert.equal(monthly.months[0].partners.length, 2)
const companyBucket = monthly.months[0].partners.find(row => row.name === company)!
assert.equal(companyBucket.customerCount, 2)
assert.equal(companyBucket.expectedCommission, 8250)
const view = buildPartnerPreview(rows, '(주)아이니웨딩네트웍스', '2026-10')
assert.equal(view.partnerName, company)
assert.equal(view.customerCount, 2)
assert.equal(view.settlements[0].expectedCommission, 8250)
assert.equal(JSON.stringify(rows), before, 'Names, prices, dates and manual notes remain original')

for (const spelling of ['(주)아이니웨딩네트웍스', '(주)  아이니웨딩네트웍스']) {
  const source = Object.freeze({ ...rows[0], partnerName: spelling })
  const original = JSON.stringify(source)
  const mapped = leadFromDocument(source.id, source)
  assert.equal(mapped.partnerName, company)
  assert.equal(expectedRebateFor(mapped), expectedRebateFor(source))
  assert.equal(mapped.note, source.note)
  assert.equal(mapped.lumpSumAmount, source.lumpSumAmount)
  assert.equal(mapped.subscriptionAmount, source.subscriptionAmount)
  assert.equal(JSON.stringify(source), original, 'Reading a document never renames the stored source')
}
const couple = [lead('couple-a', '(주)아이티앤코', 100000), lead('couple-b', '(주) 아이티앤코', 100000)]
  .map(row => ({ ...row, caseGroupId: 'same-company-couple' }))
assert.equal(caseBasisFor(couple).status, 'resolved', 'Prefix spacing alone is not a financial conflict')
assert.equal(buildExecutiveMetrics(couple, '2026-10', '2026-10-14').current.customerCount, 1)
assert.equal(buildExecutiveMetrics(couple, '2026-10', '2026-10-14').partners[0].name, '(주) 아이티앤코')
assert.equal(canonicalPartnerName('(주)아이니'), '(주) 아이니')
assert.notEqual(canonicalPartnerName('(주)아이니'), company, 'Do not truncate or infer a partial company alias')
console.log('partner spacing: one company option identity, combined metrics, original values and tenant contract preserved')
