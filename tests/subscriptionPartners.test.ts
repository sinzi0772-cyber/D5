import assert from 'node:assert/strict'
import { isSubscriptionRebatePartner, SUBSCRIPTION_REBATE_PARTNERS } from '../src/lib/subscriptionPartners.ts'

assert.equal(SUBSCRIPTION_REBATE_PARTNERS.length, 40)
for (const name of SUBSCRIPTION_REBATE_PARTNERS) {
  assert.equal(isSubscriptionRebatePartner(name), true, name)
  assert.equal(isSubscriptionRebatePartner(`  ${name.replace(/\s/g, '  ')}  `), true, 'Whitespace cannot change a company identity')
  assert.equal(isSubscriptionRebatePartner(`${name} 협력사`), false, 'Similar company names must not be added automatically')
}
for (const name of ['아이웨딩', '㈜아이패밀리에스씨', '(주) 아이니웨딩네트웍스', '(주)베리굿웨딩컴퍼니', '신한카드', '더리본', '브라이덜 휘']) {
  assert.equal(isSubscriptionRebatePartner(name), true, name)
}
for (const name of ['요즘웨딩', '아이티웨딩', '아이니웨딩', '다이렉트컴프', '다이렉트컴', '주식회사 팜투어', '트리아(TRIA)', '리안트', '아이티이', '지디스타일', '대구다이렉트웨딩준비', '대구허니문투어', '웨딩북 지점', '아이웨딩 협력사', '베리굿웨딩컴퍼니협력사']) {
  assert.equal(isSubscriptionRebatePartner(name), false, `Company outside the new exact list: ${name}`)
}
console.log('subscriptionPartners: all 40 approved rows, corporation/space normalization, approved alias, and unlisted/similar companies passed')
