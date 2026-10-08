import { useMemo, useState } from 'react'
import { ArrowUpRight, CalendarDays, CheckCircle2, Clock3, Printer, TrendingUp, UsersRound, X } from 'lucide-react'
import { buildExecutiveMetrics, getDefaultExecutiveMonth, getExecutiveMonthLeads, getExecutiveMonths, getTopCommissionPartners, type ExecutivePeriodSummary } from '../lib/executiveMetrics'
import { customerDisplayLabel } from '../lib/customerDisplay'
import type { Lead } from '../types'
import { MonthlyCommissionPanel } from './MonthlyCommissionPanel'
import './ExecutiveDashboard.css'

type SortColumn = 'name' | 'cases' | 'expectedCommission' | 'active' | 'completed' | 'closed' | 'canceled' | 'sales' | 'reservedSales' | 'salesProgress' | 'managementRecords'
type PerformanceRow = ExecutivePeriodSummary & { name: string }
type Queue = 'unassigned' | 'overdue' | 'stale' | 'canceled' | 'closed'
const won = (amount: number) => `${Math.round(amount).toLocaleString('ko-KR')}원`
const salesProgressLabel = (row: PerformanceRow, kind: 'partner' | 'manager') => `${kind === 'partner' ? '접수' : '배정'} ${row.cases.toLocaleString('ko-KR')}건 중 구매완료 ${row.completed.toLocaleString('ko-KR')}건`
const financialDefinitions = '일시불 주문확정·예약·가예약은 영업 판매완료로 집계하며 원본 주문단계는 보존합니다. 판매 기준금액은 일시불 판매금액과 구독 주문확정·마감됨의 멤버십혜택 기준금액 합계입니다. 구독 출하대기는 별도 표시하며, 실제 납품·정산 완료를 뜻하지 않습니다.'
const performanceColumnHelp = (key: SortColumn) => key === 'completed'
  ? '고객의 구매완료 상태 기준입니다. 연결된 일시불 주문확정·예약·가예약은 영업 판매완료로 반영하며, 신랑·신부 연결 접수는 1건으로 집계합니다.'
  : key === 'sales' ? '일시불 주문확정·예약·가예약의 판매금액과 구독 주문확정·마감됨의 멤버십혜택 기준금액 합계입니다. 구독 출하대기는 제외하며 원본 주문단계는 보존합니다.'
  : key === 'reservedSales' ? '구독 출하대기의 멤버십혜택 기준금액입니다. 판매 기준금액과 구분해 표시하며 예상 수수료에는 포함합니다.'
  : key === 'expectedCommission' ? '이 업체에 연결된 고객의 일시불·대상 구독 예상 수수료 합계입니다. 고객 목록과 동일한 기준으로 계산하며 수기 금액과 구독 출하대기를 반영합니다. 실제 정산 확정액은 아닙니다.'
  : key === 'salesProgress' ? '고객의 구매완료 접수건수로 정렬하며, 같으면 접수·배정 건수로 정렬합니다. RAW 상품·주문 건수가 아닙니다.'
  : undefined
const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`
const koreanToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const queueInfo: Record<Queue, { title: string; note: string }> = {
  unassigned: { title: '담당자 미배정', note: '관리중 고객 가운데 담당자가 정해지지 않은 고객입니다.' },
  overdue: { title: '방문일 경과 · 미처리', note: '예정일이 지났지만 방문 완료나 일정 취소로 처리되지 않은 관리중 고객입니다.' },
  stale: { title: '7일 이상 관리 공백', note: '마지막 관리메모 이후 7일 이상 지난 관리중 고객입니다. 메모가 없으면 등록일을 기준으로 합니다.' },
  canceled: { title: '취소 고객 확인', note: '선택한 접수월의 취소 고객입니다. 고객을 누르면 관리메모에서 종료 사유를 확인할 수 있습니다.' },
  closed: { title: '상담마감 고객 확인', note: '선택한 접수월의 상담마감 고객입니다. 상담마감은 구매 실패와 구분해 표시합니다.' },
}

export function ExecutiveDashboard({ leads, partnerLabel, onSelectLead, onSelectManager }: { leads: Lead[]; partnerLabel: string; onSelectLead: (lead: Lead) => void; onSelectManager: (name: string) => void }) {
  const today = koreanToday()
  const [chosenMonth, setChosenMonth] = useState('')
  const [queue, setQueue] = useState<Queue | null>(null)
  const months = useMemo(() => [...new Set([today.slice(0, 7), chosenMonth, ...getExecutiveMonths(leads)].filter(Boolean))].sort().reverse(), [leads, today, chosenMonth])
  const month = chosenMonth || getDefaultExecutiveMonth(leads, today)
  const selectedPartner = partnerLabel === '전체 제휴업체' ? undefined : partnerLabel
  const metrics = useMemo(() => buildExecutiveMetrics(leads, month, today, selectedPartner), [leads, month, today, selectedPartner])
  const cohort = useMemo(() => getExecutiveMonthLeads(leads, month, selectedPartner), [leads, month, selectedPartner])
  const { current, previous, actions } = metrics
  const newest = leads.filter(lead => !selectedPartner || lead.partnerName === selectedPartner).reduce((date, lead) => lead.registeredAt > date ? lead.registeredAt : date, '')
  const queueRows = queue === 'canceled' ? cohort.filter(lead => lead.status === '취소')
    : queue === 'closed' ? cohort.filter(lead => lead.status === '상담 마감')
    : queue ? actions[queue] : []
  const uniqueActionCustomers = new Set([...actions.unassigned, ...actions.overdue, ...actions.stale].map(lead => lead.id)).size
  const completedWithAmount = current.completed > 0 && current.missingAmounts > 0
  const sortedPartners = [...metrics.partners].sort((a, b) => b.sales - a.sales || b.completed - a.completed || b.cases - a.cases || a.name.localeCompare(b.name, 'ko'))
  const topCommissionPartners = getTopCommissionPartners(metrics.partners)
  const sortedManagers = metrics.managers.filter(row => row.name !== '미배정').sort((a, b) => b.completed - a.completed || b.sales - a.sales || b.cases - a.cases || a.name.localeCompare(b.name, 'ko'))

  return <section className="exec-dashboard" aria-label="제휴 운영 성과 요약">
    <header className="exec-heading">
      <div><span className="exec-eyebrow">PARTNER PERFORMANCE</span><h2>제휴 성과, 한눈에</h2><p>접수에서 판매까지, 성과와 놓치고 있는 고객을 함께 확인하세요.</p></div>
      <div className="exec-controls"><label className="exec-period"><CalendarDays size={16}/><span>접수월</span><select aria-label="관리지표 접수월" value={month} onChange={event => { setChosenMonth(event.target.value); setQueue(null) }}>{months.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label><button type="button" className="exec-print" onClick={() => window.print()}><Printer size={16}/>출력</button></div>
    </header>
    <div className="exec-scope"><span>{partnerLabel} · {monthLabel(month)} 접수 기준</span><span>{newest ? `최근 접수일 ${newest.replaceAll('-', '.')}` : '등록된 고객 없음'}</span><span>선택 접수월 전체 예상 수수료 <strong>{won(current.expectedCommission)}</strong></span></div>

    <MonthlyCommissionPanel leads={leads} partnerName={selectedPartner} today={today} onSelectLead={onSelectLead}/>

    <div className="exec-kpis">
      <Kpi label="접수" value={current.cases.toLocaleString('ko-KR')} unit="건" icon={<UsersRound size={19}/>} change={countChange(current.cases, previous.cases, '건')} note={`연결 고객을 1건으로 · 고객 ${current.customerCount}명`}/>
      <Kpi label="구매완료" value={current.completed.toLocaleString('ko-KR')} unit="건" icon={<CheckCircle2 size={19}/>} change={countChange(current.completed, previous.completed, '건')} note="선택월 접수 중 구매완료된 접수"/>
      <Kpi label="접수 대비 구매완료" value={current.cases ? current.completed.toLocaleString('ko-KR') : '—'} unit={current.cases ? '건' : ''} denominator={current.cases || undefined} icon={<TrendingUp size={19}/>} change={{ text: current.cases ? `접수 ${current.cases.toLocaleString('ko-KR')}건 중 구매완료 ${current.completed.toLocaleString('ko-KR')}건` : '선택월 접수 없음', tone: 'neutral' }} note="구매완료 / 접수 · 실제 건수로 확인"/>
      <Kpi label="판매·구독 기준금액" value={Math.round(current.sales).toLocaleString('ko-KR')} unit="원" icon={<ArrowUpRight size={19}/>} change={countChange(current.sales, previous.sales, '원')} note={completedWithAmount ? `구매완료 고객 ${current.missingAmounts}명 금액 미입력` : '일시불 판매금액 + 구독 멤버십혜택 기준금액'} sales/>
    </div>
    <p className="exec-footnote">일시불 주문확정·예약·가예약은 영업 판매완료에 포함하며 실제 납품·정산과는 구분합니다. 구독 출하대기 기준금액 {won(current.reservedSales)}은 판매 기준금액에서 제외하고 예상 수수료에만 포함합니다. 구독은 지정 업체만 수수료 대상이며 선택월 접수 기준으로 구매월 매출과는 다릅니다.</p>
    <div className="exec-outcomes" aria-label="선택 접수월 진행 상태">
      <div className="exec-outcome" data-tone="active"><span>관리중</span><strong>{current.active}<small>건</small></strong></div>
      <div className="exec-outcome" data-tone="success"><span>구매완료</span><strong>{current.completed}<small>건</small></strong></div>
      <div className="exec-outcome" data-tone="closed"><span>상담마감</span><strong>{current.closed}<small>건</small></strong></div>
      <div className="exec-outcome" data-tone="canceled"><span>취소</span><strong>{current.canceled}<small>건</small></strong></div>
    </div>

    <div className="exec-section-head"><div><h3>오늘 확인할 고객</h3><p>모든 접수월의 관리중 고객 · 항목을 누르면 해당 고객을 확인할 수 있습니다.</p></div><span>{uniqueActionCustomers ? `${uniqueActionCustomers}명 확인 필요` : '확인 필요 고객 없음'}</span></div>
    <div className="exec-actions">
      <ActionCard label="담당자 미배정" value={actions.unassigned.length} note="담당자를 정해 첫 상담을 시작하세요" action="unassigned" selected={queue} onSelect={setQueue} color="amber"/>
      <ActionCard label="방문일 경과 · 미처리" value={actions.overdue.length} note="방문 여부와 다음 일정을 확인하세요" action="overdue" selected={queue} onSelect={setQueue} color="rose"/>
      <ActionCard label="7일 이상 관리 공백" value={actions.stale.length} note="다음 연락과 관리메모를 남겨주세요" action="stale" selected={queue} onSelect={setQueue} color="teal"/>
    </div>
    <p className="exec-footnote">한 고객이 여러 확인 항목에 포함될 수 있습니다.</p>

    {queue && <section className="exec-drilldown" aria-label={queueInfo[queue].title}>
      <header><div><h4>{queueInfo[queue].title} <span>{queueRows.length}명</span></h4><p>{queueInfo[queue].note}</p></div><button type="button" onClick={() => setQueue(null)} aria-label="확인 고객 목록 닫기"><X size={18}/></button></header>
      {queueRows.length ? <div className="exec-drill-scroll"><table><thead><tr><th>고객</th><th>제휴업체</th><th>담당자</th><th>방문 예정일</th><th>최근 관리메모</th></tr></thead><tbody>{queueRows.map(lead => <tr key={lead.id}><td><button type="button" className="exec-customer-link" onClick={() => onSelectLead(lead)}>{customerDisplayLabel(lead)}<ArrowUpRight size={14} aria-hidden="true"/></button></td><td>{lead.partnerName || '미입력'}</td><td>{lead.manager || '미배정'}</td><td>{lead.visitScheduledDate?.replaceAll('-', '.') || '미정'}</td><td>{latestMemoDate(lead)?.replaceAll('-', '.') || '기록 없음'}</td></tr>)}</tbody></table></div> : <p className="exec-empty">해당하는 고객이 없습니다.</p>}
    </section>}

    <div className="exec-highlights">
      <section className="exec-highlight"><header><div><h3>성과를 만드는 제휴업체</h3><p>선택 접수월 · 판매 기준금액 순, 같으면 구매완료 순</p></div><span>TOP 3</span></header><Ranking rows={sortedPartners.slice(0, 3)} kind="partner"/></section>
      <section className="exec-highlight exec-highlight-commission"><header><div><h3>업체별 예상 수수료</h3><p>선택 접수월 · 정산월 전체 합계 · 금액순</p></div><span>TOP 3</span></header><Ranking rows={topCommissionPartners} kind="commission"/></section>
      <section className="exec-highlight"><header><div><h3>담당자별 판매 성과</h3><p>구매완료 건수 순 · 동률은 판매 기준금액 순 · 이름을 누르면 담당 고객 보기</p></div><span>TOP 3</span></header><Ranking rows={sortedManagers.slice(0, 3)} kind="manager" onSelectManager={onSelectManager}/></section>
    </div>
    <section className="exec-closure-strip"><strong>개별 고객의 종료 결과</strong><button type="button" onClick={() => setQueue('canceled')}>취소 고객 <b>{cohort.filter(lead => lead.status === '취소').length}명</b><ArrowUpRight size={14}/></button><button type="button" onClick={() => setQueue('closed')}>상담마감 고객 <b>{cohort.filter(lead => lead.status === '상담 마감').length}명</b><ArrowUpRight size={14}/></button><span>종료 사유는 고객별 관리메모에서 확인</span></section>

    <PerformanceTable title="업체별 상세 성과" rows={metrics.partners} month={month} kind="partner"/>
    <PerformanceTable title="담당자별 상세 성과" rows={sortedManagers} month={month} kind="manager" onSelectManager={onSelectManager}/>
    <p className="exec-footer" title={financialDefinitions}>연결된 신랑·신부는 접수·상태·판매 성과에서 1건으로 집계합니다. 일부라도 구매완료면 구매완료, 관리중이면 관리중을 우선합니다. 연결된 일시불 RAW의 주문확정·예약·가예약은 구매완료로 반영하며 원본 주문단계와 고객별 관리메모·연결기록은 유지됩니다.</p>
  </section>
}

function latestMemoDate(lead: Lead) {
  return lead.memoHistory?.length ? [...lead.memoHistory].map(entry => entry.date).sort().at(-1) : lead.note ? lead.updatedAt.slice(0, 10) : undefined
}
const signed = (value: number) => `${value > 0 ? '+' : ''}${Number(value.toFixed(1)).toLocaleString('ko-KR')}`
const tone = (value: number): 'up' | 'down' | 'neutral' => value > 0 ? 'up' : value < 0 ? 'down' : 'neutral'
function countChange(current: number, previous: number, unit: string) {
  const difference = current - previous
  return { text: difference ? `전월 대비 ${signed(difference)}${unit}` : `전월과 동일 · ${previous.toLocaleString('ko-KR')}${unit}`, tone: tone(difference) }
}
function Kpi({ label, value, unit, icon, change, note, sales = false, denominator }: { label: string; value: string; unit: string; icon: React.ReactNode; change: { text: string; tone: 'up' | 'down' | 'neutral' }; note: string; sales?: boolean; denominator?: number }) {
  return <article className={`exec-kpi${sales ? ' exec-kpi-sales' : ''}${denominator !== undefined ? ' exec-kpi-progress' : ''}`}><div className="exec-kpi-label"><span>{label}</span><i className="exec-kpi-icon">{icon}</i></div><div className="exec-kpi-value"><strong>{value}<small>{unit}</small>{denominator !== undefined && <span className="exec-kpi-denominator"> / {denominator.toLocaleString('ko-KR')}<small>건</small></span>}</strong></div><span className="exec-change" data-tone={change.tone}>{change.text}</span><p className="exec-kpi-note">{note}</p></article>
}
function ActionCard({ label, value, note, action, selected, onSelect, color }: { label: string; value: number; note: string; action: Queue; selected: Queue | null; onSelect: (action: Queue | null) => void; color: string }) {
  return <button type="button" className="exec-action" data-tone={color} aria-pressed={selected === action} onClick={() => onSelect(selected === action ? null : action)}><span className="exec-action-label"><Clock3 size={16}/>{label}</span><strong className="exec-action-count">{value}<small>명</small></strong><span className="exec-action-note">{note}</span><ArrowUpRight className="exec-action-arrow" size={19}/></button>
}
function ManagerLink({ name, onSelect }: { name: string; onSelect: (name: string) => void }) {
  return <button type="button" className="exec-manager-link" aria-label={`${name} 담당 고객 보기`} title="전체 기간의 담당 고객 보기" onClick={() => onSelect(name)}><span>{name}</span><ArrowUpRight size={14} aria-hidden="true"/></button>
}
function Ranking({ rows, kind, onSelectManager }: { rows: PerformanceRow[]; kind: 'partner' | 'commission' | 'manager'; onSelectManager?: (name: string) => void }) {
  return rows.length ? <div className="exec-ranking-list">{rows.map((row, index) => <div className="exec-ranking" key={row.name}><span>{index + 1}</span><div className="exec-ranking-identity">{kind === 'manager' && onSelectManager ? <ManagerLink name={row.name} onSelect={onSelectManager}/> : <strong title={row.name}>{row.name}</strong>}<small>{salesProgressLabel(row, kind === 'manager' ? 'manager' : 'partner')}</small></div><div className="exec-ranking-value">{kind === 'manager' ? <strong>{row.completed}<small>건 성공</small></strong> : <strong>{won(kind === 'commission' ? row.expectedCommission : row.sales)}</strong>}</div></div>)}</div> : <p className="exec-empty">{kind === 'commission' ? '선택한 접수월의 예상 수수료가 없습니다.' : `선택한 접수월의 ${kind === 'partner' ? '업체' : '담당자'} 데이터가 없습니다.`}</p>
}
function PerformanceTable({ title, rows, month, kind, onSelectManager }: { title: string; rows: PerformanceRow[]; month: string; kind: 'partner' | 'manager'; onSelectManager?: (name: string) => void }) {
  const [sort, setSort] = useState<{ key: SortColumn; direction: 'asc' | 'desc' }>({ key: 'cases', direction: 'desc' })
  const columns: { key: SortColumn; label: string }[] = [
    { key: 'name', label: kind === 'partner' ? '제휴업체' : '담당자' }, { key: 'cases', label: kind === 'partner' ? '접수' : '배정 접수' },
    ...(kind === 'partner' ? [{ key: 'expectedCommission' as const, label: '예상 수수료' }] : []),
    { key: 'active', label: '관리중' }, { key: 'completed', label: '구매완료' }, { key: 'closed', label: '상담마감' }, { key: 'canceled', label: '취소' }, { key: 'salesProgress', label: kind === 'partner' ? '판매 / 접수' : '판매 / 배정' }, { key: 'sales', label: '판매 기준금액' }, { key: 'reservedSales', label: '구독 출하대기 금액' }, { key: 'managementRecords', label: '관리기록' },
  ]
  const totalCommission = rows.reduce((total, row) => total + row.expectedCommission, 0)
  const sorted = [...rows].sort((a, b) => {
    const result = sort.key === 'name' ? a.name.localeCompare(b.name, 'ko') : sort.key === 'salesProgress' ? a.completed - b.completed || a.cases - b.cases : a[sort.key] - b[sort.key]
    return result * (sort.direction === 'asc' ? 1 : -1) || a.name.localeCompare(b.name, 'ko')
  })
  return <details className="exec-details">
    <summary><i className="details-toggle-mark" aria-hidden="true"/><strong>{title}</strong><small>{rows.length}{kind === 'partner' ? '개 업체' : '명'} · + / − 상세 보기</small></summary>
    <div className="exec-detail-body">
      <h4>{title}</h4>
      <p title={financialDefinitions}>{monthLabel(month)} 접수 기준 · 열 제목을 누르면 정렬됩니다. 일시불 주문확정·예약·가예약은 판매완료에 포함하며 구독 출하대기는 별도 표시합니다.{kind === 'manager' ? ' 담당자 이름을 누르면 전체 기간의 담당 고객을 봅니다. 같은 접수를 함께 맡으면 담당자마다 1건씩 표시하며, 관리기록은 배정 고객의 메모 건수입니다.' : ' 예상 수수료는 해당 업체 고객의 금액만 합산하며 실제 정산 확정액과는 다릅니다.'}</p>
      <div className="exec-table-scroll"><table className="exec-table">
        <thead><tr>{columns.map(column => <th key={column.key} aria-sort={sort.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
          <button type="button" title={performanceColumnHelp(column.key)} className={`exec-sort-button${sort.key === column.key ? ' active' : ''}`} onClick={() => setSort(current => ({ key: column.key, direction: current.key === column.key && current.direction === 'desc' ? 'asc' : 'desc' }))}>{column.label}<span aria-hidden="true">{sort.key === column.key ? sort.direction === 'asc' ? '↑' : '↓' : '↕'}</span></button>
        </th>)}</tr></thead>
        <tbody>{sorted.map(row => <tr key={row.name}>{columns.map(column => <td key={column.key} className={column.key === 'expectedCommission' ? 'exec-commission-cell' : undefined}>{column.key === 'name' ? kind === 'manager' && onSelectManager ? <ManagerLink name={row.name} onSelect={onSelectManager}/> : row.name : column.key === 'sales' || column.key === 'reservedSales' || column.key === 'expectedCommission' ? won(row[column.key]) : column.key === 'salesProgress' ? <span className="exec-sales-progress" title={salesProgressLabel(row, kind)} aria-label={salesProgressLabel(row, kind)}>{row.completed.toLocaleString('ko-KR')}건 / {row.cases.toLocaleString('ko-KR')}건</span> : `${row[column.key]}건`}</td>)}</tr>)}</tbody>
        {kind === 'partner' ? <tfoot><tr><th scope="row" colSpan={2}>예상 수수료 합계</th><td className="exec-commission-cell">{won(totalCommission)}</td><td colSpan={columns.length - 3}/></tr></tfoot> : null}
      </table></div>
      {!rows.length && <p className="exec-empty">선택한 접수월의 데이터가 없습니다.</p>}
    </div>
  </details>
}
