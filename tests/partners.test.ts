import assert from 'node:assert/strict'
import { canonicalPartnerName } from '../src/lib/partners.ts'

const official = '(주)아이패밀리에스씨'
for (const alias of [
  '아이웨딩', '(주)아이웨딩', '주식회사 아이웨딩', '㈜아이웨딩',
  '  (주) 아이웨딩  ', '아이 웨딩', '아이웨딩 주식회사',
  '아이패밀리에스씨', '(주)아이패밀리에스씨', '주식회사 아이패밀리에스씨',
  '㈜ 아이패밀리 에스씨', '（주）아이패밀리에스씨',
]) {
  assert.equal(canonicalPartnerName(alias), official, `Approved alias: ${alias}`)
}
assert.equal(canonicalPartnerName(official), official, 'Canonical naming is idempotent')

for (const unrelated of [
  '아이웨딩협력업체', '(주)아이웨딩협력업체', '아이웨딩(협력사)',
  '다른아이웨딩', '아이웨딩네트웍스', '아이패밀리에스씨협력사',
  '아이*웨딩', '익명 업체 A', '(주) 익명 업체 B', 'Company A',
]) {
  assert.equal(canonicalPartnerName(unrelated), unrelated.replace(/^\(주\)\s*/, '(주) '), `Do not infer an alias: ${unrelated}`)
}
assert.equal(canonicalPartnerName('  익명 업체 A  '), '익명 업체 A', 'Other names are only trimmed')
assert.equal(canonicalPartnerName(''), '')
assert.equal(canonicalPartnerName('   '), '')

for (const [input, expected] of [
  ['(주)아이니', '(주) 아이니'],
  ['(주) 아이니', '(주) 아이니'],
  ['(주)아이니웨딩네트웍스', '(주) 아이니웨딩네트웍스'],
  ['(주)  아이니웨딩네트웍스', '(주) 아이니웨딩네트웍스'],
  [' (주)\t아이티앤코 ', '(주) 아이티앤코'],
  ['(주)아이티앤코', '(주) 아이티앤코'],
  ['(주)아이니웨딩', '(주) 아이니웨딩'],
  ['(주)아이니 네트웍스', '(주) 아이니 네트웍스'],
  ['아이니웨딩네트웍스', '아이니웨딩네트웍스'],
  ['주식회사 아이니웨딩네트웍스', '주식회사 아이니웨딩네트웍스'],
  ['㈜아이니웨딩네트웍스', '㈜아이니웨딩네트웍스'],
  ['(주)', '(주)'],
]) {
  assert.equal(canonicalPartnerName(input), expected)
  assert.equal(canonicalPartnerName(expected), expected, 'Preferred spacing is idempotent')
}
assert.notEqual(canonicalPartnerName('(주)아이니웨딩네트웍스'), canonicalPartnerName('(주)아이니웨딩'), 'Different full company names remain distinct')
assert.notEqual(canonicalPartnerName('(주)아이니네트웍스'), canonicalPartnerName('(주)아이니 네트웍스'), 'Internal company-name spacing is not inferred')

console.log('partners: approved identities, exact full-name prefix spacing and idempotence passed')
