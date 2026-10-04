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
  assert.equal(canonicalPartnerName(unrelated), unrelated, `Do not infer an alias: ${unrelated}`)
}
assert.equal(canonicalPartnerName('  익명 업체 A  '), '익명 업체 A', 'Other names are only trimmed')
assert.equal(canonicalPartnerName(''), '')
assert.equal(canonicalPartnerName('   '), '')

console.log('partners: exact approved aliases, non-fuzzy naming and idempotence passed')
