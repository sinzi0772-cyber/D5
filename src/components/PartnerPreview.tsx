import { useId, useMemo, useState, type ReactNode } from 'react'
import type { PartnerPreviewModel, PartnerSalesChannel } from '../lib/partnerPreview'
import { isApprovedSubscriptionReviewPartner } from '../lib/salesChannelReview'
import { SUBSCRIPTION_REVIEW_PARTNERS } from '../lib/subscriptionPartners'
import { getPartnerSettlementCard } from '../lib/partnerSettlementCard'
import { NOVEMBER_INVITATION_LABEL } from '../lib/invitationCampaign'
import {
  DEFAULT_CUSTOMER_SORT, DEFAULT_SETTLEMENT_SORT, nextPartnerCustomerSort, nextPartnerSettlementSort,
  sortPartnerCustomers, sortPartnerSettlements,
  type PartnerCustomerSortKey, type PartnerSettlementSortKey, type PartnerSort, type PartnerSortDirection,
} from '../lib/partnerPreviewSorting'
import './PartnerPreview.css'

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`
const count = (value: number) => value.toLocaleString('ko-KR')
const monthLabel = (month: string) => { const [year, number] = month.split('-'); return `${year}년 ${Number(number)}월` }
const dateLabel = (date: string | null) => {
  if (!date) return '미정'
  return date.length === 7 ? monthLabel(date) : date.replaceAll('-', '.')
}

const customerColumns: readonly { key: PartnerCustomerSortKey; label: string }[] = [
  { key: 'label', label: '고객 / 연락처 뒷자리' }, { key: 'registeredAt', label: '등록일' },
  { key: 'status', label: '상태' }, { key: 'deliveryScheduledDate', label: '배송예정일' },
  { key: 'expectedSettlementMonth', label: '예상 정산월' }, { key: 'expectedCommission', label: '예상 수수료' },
]
const settlementColumns: readonly { key: PartnerSettlementSortKey; label: string }[] = [
  { key: 'month', label: '정산월' }, { key: 'customerCount', label: '고객 수' }, { key: 'expectedCommission', label: '예상 수수료' },
]
const customerSortCaptions: Record<PartnerCustomerSortKey, Record<PartnerSortDirection, string>> = {
  label: { asc: '고객명 가나다순', desc: '고객명 역순' },
  registeredAt: { asc: '등록일 오래된순', desc: '등록일 최신순' },
  status: { asc: '상태 가나다순', desc: '상태 역순' },
  deliveryScheduledDate: { asc: '배송예정일 빠른순', desc: '배송예정일 늦은순' },
  expectedSettlementMonth: { asc: '정산월 빠른순', desc: '정산월 늦은순' },
  expectedCommission: { asc: '수수료 낮은순', desc: '수수료 높은순' },
}

function SortColumn({ label, direction, nextDirection, onSort }: {
  label: string; direction: PartnerSortDirection | null; nextDirection: PartnerSortDirection; onSort: () => void
}) {
  return <th scope="col" aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}>
    <button type="button" className="partner-preview-sort-button" data-direction={direction || 'none'} aria-label={`${label} 정렬`} title={nextDirection === 'asc' ? '오름차순으로 정렬' : '내림차순으로 정렬'} onClick={onSort}>{label}</button>
  </th>
}

function CustomerSalesChannels({ channels: allChannels, partnerName }: { channels?: readonly PartnerSalesChannel[]; partnerName: string }) {
  const channels = allChannels?.filter(channel => channel.kind === 'lumpSum' || isApprovedSubscriptionReviewPartner(partnerName, SUBSCRIPTION_REVIEW_PARTNERS))
  if (!channels?.length) return null
  const mismatch = channels.some(channel => channel.status === 'mismatch')
  const unverified = channels.some(channel => channel.status === 'unverified')
  const label = mismatch ? '경로 불일치' : unverified ? '확인 필요' : '경로 일치'
  return <details className={`partner-preview-sales-channels${mismatch ? ' has-mismatch' : ''}`}>
    <summary>판매경로 · {label}</summary>
    {channels.map((channel, index) => <div key={index}>
      <strong>{channel.kind === 'lumpSum' ? '일시불' : '구독'}{channel.period ? ` · ${monthLabel(channel.period)}` : ''}<span>{channel.status === 'eligible' ? '경로 일치' : channel.status === 'mismatch' ? '경로 불일치' : '확인 필요'}</span></strong>
      <dl><div><dt>경로 1</dt><dd>{channel.channel1 || '미확인'}</dd></div><div><dt>경로 2</dt><dd>{channel.channel2 || '미확인'}</dd></div></dl>
    </div>)}
  </details>
}

/** Accepts only the safe projection; no saved documents or staff-only callbacks. */
export function PartnerPreview({ model, presentation = 'preview', intakeMonthControl }: {
  model: PartnerPreviewModel
  presentation?: 'preview' | 'portal'
  intakeMonthControl?: ReactNode
}) {
  const [requestedSettlement, setRequestedSettlement] = useState('')
  const [customerSort, setCustomerSort] = useState<PartnerSort<PartnerCustomerSortKey>>(DEFAULT_CUSTOMER_SORT)
  const [settlementSort, setSettlementSort] = useState<PartnerSort<PartnerSettlementSortKey>>(DEFAULT_SETTLEMENT_SORT)
  const customers = useMemo(() => sortPartnerCustomers(model.customers, customerSort), [model.customers, customerSort])
  const settlements = useMemo(() => sortPartnerSettlements(model.settlements, settlementSort), [model.settlements, settlementSort])
  const feeCardId = useId()
  const feeCard = getPartnerSettlementCard(model, requestedSettlement)
  const groupMonthControls = presentation === 'portal' && Boolean(intakeMonthControl)
  const hasSettlementMonths = feeCard.options.length > 0
  const settlementMonthControl = (hasSettlementMonths || groupMonthControls) ? (
    <label className={groupMonthControls ? undefined : 'partner-preview-fee-period'}>
      <span>정산월</span>
      <select aria-label="예상 수수료 정산월" value={feeCard.selection} disabled={!hasSettlementMonths} onChange={event => setRequestedSettlement(event.target.value)}>
        {hasSettlementMonths
          ? feeCard.options.map(option => <option key={option.value} value={option.value}>{option.month ? monthLabel(option.month) : '정산월 미정'}</option>)
          : <option value="">정산 내역 없음</option>}
      </select>
    </label>
  ) : null
  const SectionHeading = presentation === 'portal' ? 'h2' : 'h3'
  const feeCaption = feeCard.selection === 'undated'
    ? `배송예정일 입력 필요 · 고객 ${count(feeCard.customerCount)}명`
    : feeCard.selection
      ? `${monthLabel(feeCard.selection)} 중순 예상 · 고객 ${count(feeCard.customerCount)}명`
      : '예정된 수수료 없음'
  return <section className={`partner-preview${presentation === 'portal' ? ' partner-preview-portal' : ''}`} aria-label={presentation === 'portal' ? '업체 고객 현황' : '업체용 화면 미리보기'}>
    <header className="partner-preview-heading">
      <div><span className="partner-preview-eyebrow">PARTNER VIEW</span><h2>{model.partnerName || '제휴업체를 선택해 주세요'}</h2><p>{monthLabel(model.intakeMonth)} 접수 · 묶음은 최초 접수월 기준</p></div>
    </header>

    {model.partnerName ? <>
      {groupMonthControls ? <div className="partner-portal-period" role="group" aria-label="조회 기준 월">
        {intakeMonthControl}
        {settlementMonthControl}
      </div> : null}
      <div className="partner-preview-stats">
        <div><span>접수</span><strong>{count(model.receiptCount)}<small>건</small></strong><p>고객 {count(model.customerCount)}명</p></div>
        <div><span>판매 건수</span><strong>{count(model.completedCount)}<small>건</small></strong><p>관리중 {count(model.activeCount)}건</p></div>
        <div className="partner-preview-fee" id={feeCardId} aria-label="월별 예상 수수료">
          <div className="partner-preview-fee-heading">
            <span>예상 수수료</span>
            {groupMonthControls ? null : settlementMonthControl}
          </div>
          <strong aria-live="polite">{model.basisRequiredCount && !hasSettlementMonths ? '기준 확인 필요' : won(feeCard.expectedCommission)}</strong>
          <p>{feeCaption}</p>
        </div>
      </div>
      {(model.basisRequiredCount || 0) > 0 ? <p className="partner-preview-undated" role="status">묶음 기준 미선택 {count(model.basisRequiredCount!)}명 · 예상 수수료 제외</p> : null}

      <section className="partner-preview-settlement" aria-label="업체 월별 예상 정산">
        <div className="partner-preview-section-heading"><SectionHeading>월별 예상 정산</SectionHeading><p>배송예정월의 익익월 중순 · 실제 수령월에 따라 변동</p></div>
        {feeCard.options.length > 0 ? <div className="partner-preview-settlement-table"><table aria-label="월별 예상 정산표">
          <thead><tr>{settlementColumns.map(column => <SortColumn key={column.key} label={column.label} direction={settlementSort.key === column.key ? settlementSort.direction : null} nextDirection={nextPartnerSettlementSort(settlementSort, column.key).direction} onSort={() => setSettlementSort(current => nextPartnerSettlementSort(current, column.key))}/>)}</tr></thead>
          <tbody>
            {settlements.map(bucket => <tr key={bucket.month} className={feeCard.selection === bucket.month ? 'is-selected' : undefined}>
              <th scope="row"><button type="button" className="partner-preview-month-select" aria-label={`${monthLabel(bucket.month)} 예상 수수료 보기`} aria-pressed={feeCard.selection === bucket.month} aria-controls={feeCardId} onClick={() => setRequestedSettlement(bucket.month)}>{monthLabel(bucket.month)} 중순</button></th>
              <td>{count(bucket.customerCount)}명</td><td><strong>{won(bucket.expectedCommission)}</strong></td>
            </tr>)}
            {model.undatedCustomerCount > 0 ? <tr className={`partner-preview-undated-row${feeCard.selection === 'undated' ? ' is-selected' : ''}`}>
              <th scope="row"><button type="button" className="partner-preview-month-select partner-preview-undated" aria-label="정산월 미정 예상 수수료 보기" aria-pressed={feeCard.selection === 'undated'} aria-controls={feeCardId} onClick={() => setRequestedSettlement('undated')}>정산월 미정<small>배송예정일 미입력</small></button></th>
              <td>{count(model.undatedCustomerCount)}명</td><td><strong>{won(model.undatedExpectedCommission)}</strong></td>
            </tr> : null}
          </tbody>
        </table></div> : <p className="partner-preview-empty">예상 정산 수수료가 없습니다.</p>}
      </section>

      <section className="partner-preview-customers" aria-label="자사 연결 고객 현황">
        <div className="partner-preview-section-heading"><SectionHeading>연결 고객</SectionHeading><small aria-live="polite">{customerSortCaptions[customerSort.key][customerSort.direction]}</small></div>
        {customers.length > 0 ? <div className="partner-preview-table-scroll"><table aria-label="연결 고객 목록">
          <thead><tr>{customerColumns.map(column => <SortColumn key={column.key} label={column.label} direction={customerSort.key === column.key ? customerSort.direction : null} nextDirection={nextPartnerCustomerSort(customerSort, column.key).direction} onSort={() => setCustomerSort(current => nextPartnerCustomerSort(current, column.key))}/>)}</tr></thead>
          <tbody>{customers.map(customer => <tr key={customer.key}><td className="partner-preview-customer-label">
            {customer.label}
            {customer.invitationCampaign ? <em className="invitation-campaign-badge">{NOVEMBER_INVITATION_LABEL}</em> : null}
          </td><td>{dateLabel(customer.registeredAt)}</td><td><span className={`partner-preview-status${customer.status === '구매완료' ? ' completed' : ''}`}>{customer.status}</span></td><td>{dateLabel(customer.deliveryScheduledDate)}</td><td>{customer.basisRequired ? '기준 고객 확인 필요' : customer.expectedSettlementMonth ? `${monthLabel(customer.expectedSettlementMonth)} 중순` : customer.status === '구매완료' ? '배송일 확인 필요' : '—'}</td><td className="partner-preview-customer-fee">{customer.basisRequired ? '확인 필요' : customer.expectedCommission === null ? '—' : won(customer.expectedCommission)}<CustomerSalesChannels partnerName={model.partnerName} channels={customer.salesChannels}/></td></tr>)}</tbody>
        </table></div> : <p className="partner-preview-empty">선택한 접수월에 연결된 고객이 없습니다.</p>}
      </section>
    </> : <p className="partner-preview-empty">업체를 선택해 주세요.</p>}
  </section>
}
