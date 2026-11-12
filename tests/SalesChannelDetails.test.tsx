import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { SalesChannelDetails } from '../src/components/SalesChannelDetails.tsx'
import { getStoredSalesChannels } from '../src/lib/salesChannels.ts'
import { salesRouteTargetFor } from '../src/lib/salesRouteCorrections.ts'
import { SALES_COMMISSION_CHANNEL1, SALES_COMMISSION_CHANNEL2 } from '../src/lib/salesRaw.ts'
import type { Lead } from '../src/types.ts'

const lead: Lead = {
  id: 'owner', customerName: '가**', phoneLast4: '3101', registeredAt: '2026-11-08', updatedAt: '2026-11-08',
  gender: '미입력', partnerName: '(주)아이패밀리에스씨', visitState: '미정', status: '구매완료', purchaseType: '일시불', lumpSumAmount: 1000,
  salesRawPeriods: { '2026-11': {
    period: '2026-11', sourceHash: 'fixture', importedAt: '2026-11-08',
    orderCount: 1, confirmedOrderCount: 1, reservedOrderCount: 0, confirmedAmount: 1000, reservedAmount: 0,
    eligibleConfirmedAmount: 0, eligibleReservedAmount: 0, returnAmount: 0,
    channels: [{ channel1: '고객인증서비스(일반)', channel2: '웨딩매장행사', orderCount: 1, amount: 1000 }],
  } },
}
const correction = {
  ...salesRouteTargetFor(lead, getStoredSalesChannels(lead)[0]), id: 'correction-1',
  correctedChannel1: SALES_COMMISSION_CHANNEL1, correctedChannel2: SALES_COMMISSION_CHANNEL2[0],
  changedAt: '2026-11-12T00:00:00.000Z', changedBy: 'tester',
}
const owner: Lead = { ...lead, salesRouteCorrections: [correction] }
const alias: Lead = { ...lead, id: 'alias', customerName: '나**', phoneLast4: '3102', lumpSumSourceId: owner.id }
const onSaveRoute = async () => undefined
const markup = renderToStaticMarkup(<SalesChannelDetails members={[owner, alias]} editableLeadId={owner.id} onSaveRoute={onSaveRoute} initiallyOpen />)
assert.match(markup, /<details[^>]+open/)
assert.match(markup, /판매경로 2<\/dt><dd>웨딩매장행사/)
assert.match(markup, /직원 확인 2<\/dt><dd>웨딩박람회\(내부\)/)
assert.match(markup, /경로 불일치/)
assert.equal((markup.match(/>판매경로 수정<\/button>/g) || []).length, 1)
for (const editableLeadId of [undefined, alias.id]) {
  const readOnly = renderToStaticMarkup(<SalesChannelDetails members={[owner, alias]} editableLeadId={editableLeadId} onSaveRoute={onSaveRoute} />)
  assert.doesNotMatch(readOnly, /판매경로 수정/)
}
console.log('Sales route details keep source routes and staff confirmation separate, with editing scoped to the original')
