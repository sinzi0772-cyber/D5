import { useMemo, useState } from 'react'
import { ArrowUpRight, CheckCircle2, Clock3, Printer, UsersRound, X } from 'lucide-react'
import { buildExecutiveMetrics, executiveTotalSalesFor, getExecutiveMonthLeads, getTopCommissionPartners, getTopReferralPartners, type ExecutivePeriodSummary } from '../lib/executiveMetrics'
import { customerDisplayLabel } from '../lib/customerDisplay'
import type { Lead } from '../types'
import { MonthlyCommissionPanel } from './MonthlyCommissionPanel'
import './ExecutiveDashboard.css'

type SortColumn = 'name' | 'cases' | 'expectedCommission' | 'active' | 'completed' | 'closed' | 'canceled' | 'sales' | 'salesProgress' | 'managementRecords'
type PerformanceRow = ExecutivePeriodSummary & { name: string }
type Queue = 'unassigned' | 'overdue' | 'stale' | 'canceled' | 'closed'
const won = (amount: number) => `${Math.round(amount).toLocaleString('ko-KR')}원`
const salesProgressLabel = (row: PerformanceRow, kind: 'partner' | 'manager') => `${kind === 'partner' ? '접수' : '배정'} ${row.cases.toLocaleString('ko-KR')}건 중 구매완료 ${row.completed.toLocaleString('ko-KR')}건`
const financialDefinitions = '총판매금액은 기존 판매금액과 대기금액을 합산합니다. 일시불 주문확정·예약·가예약 판매금액과 구독 주문확정·마감됨·출하대기의 멤버십혜택 기준금액을 반영하며 원본 주문단계는 보존합니다. 실제 납품·정산 완료를 뜻하지 않습니다.'
const performanceColumnHelp = (key: SortColumn) => key === 'completed'
  ? '고객의 구매완료 상태 기준입니다. 연결된 일시불 주문확정·예약·가예약은 영업 판매완료로 반영하며, 신랑·신부 연결 접수는 1건으로 집계합니다.'
  : key === 'sales' ? '기존 판매금액과 대기금액을 합산한 총판매금액입니다. 일시불과 구독(출하대기 포함)을 반영하며 수기 금액과 원본 주문단계의 기존 집계 기준은 유지합니다.'
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

export function ExecutiveDashboard({ leads, partnerLabel, month, onSelectLead, onSelectManager }: { leads: Lead[]; partnerLabel: string; month: string; onSelectLead: (lead: Lead) => void; onSelectManager: (name: string) => void }) {
  const today = koreanToday()
  const [queue, setQueue] = useState<Queue | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const selectedPartner = partnerLabel === '전체 제휴업체' ? undefined : partnerLabel
  const metrics = useMemo(() => buildExecutiveMetrics(leads, month, today, selectedPartner), [leads, month, today, selectedPartner])
  const cohort = useMemo(() => getExecutiveMonthLeads(leads, month, selectedPartner), [leads, month, selectedPartner])
  const { current, previous, actions } = metrics
  const queueRows = queue === 'canceled' ? cohort.filter(lead => lead.status === '취소')
    : queue === 'closed' ? cohort.filter(lead => lead.status === '상담 마감')
    : queue ? actions[queue] : []
  const uniqueActionCustomers = new Set([...actions.unassigned, ...actions.overdue, ...actions.stale].map(lead => lead.id)).size
  const sortedPartners = [...metrics.partners].sort((a, b) => executiveTotalSalesFor(b) - executiveTotalSalesFor(a) || b.completed - a.completed || b.cases - a.cases || a.name.localeCompare(b.name, 'ko'))
  const topCommissionPartners = getTopCommissionPartners(metrics.partners)
  const topReferralPartners = getTopReferralPartners(metrics.partners)
  const sortedManagers = metrics.managers.filter(row => row.name !== '미배정').sort((a, b) => b.completed - a.completed || executiveTotalSalesFor(b) - executiveTotalSalesFor(a) || b.cases - a.cases || a.name.localeCompare(b.name, 'ko'))
  const showQueue = (value: Queue) => { setQueue(value); setDetailsOpen(true) }

  return <section className="exec-dashboard" aria-label="제휴 운영 성과 요약">
    <header className="exec-heading">
      <div><span className="exec-eyebrow">MONTHLY OVERVIEW</span><h2>월별 제휴 현황</h2></div>
      <div className="exec-controls"><button type="button" className="exec-print" onClick={() => window.print()}><Printer size={16} aria-hidden="true"/>출력</button></div>
    </header>
    <div className="exec-scope"><span>{partnerLabel} · {monthLabel(month)} 접수 기준</span><span>연결 고객은 최초 접수월에 1건으로 집계</span></div>

    <div className="exec-kpis">
      <Kpi label="접수" value={current.cases.toLocaleString('ko-KR')} unit="건" icon={<UsersRound size={19}/>} change={countChange(current.cases, previous.cases, '건')} note={`고객 ${current.customerCount}명`}/>
      <Kpi label="관리중" value={current.active.toLocaleString('ko-KR')} unit="건" icon={<Clock3 size={19}/>} change={countChange(current.active, previous.active, '건')}/>
      <Kpi label="구매완료" value={current.completed.toLocaleString('ko-KR')} unit="건" icon={<CheckCircle2 size={19}/>} change={countChange(current.completed, previous.completed, '건')}/>
      <Kpi label="총판매금액" value={Math.round(executiveTotalSalesFor(current)).toLocaleString('ko-KR')} unit="원" icon={<ArrowUpRight size={19}/>} change={countChange(executiveTotalSalesFor(current), executiveTotalSalesFor(previous), '원')} note="일시불 + 구독(출하대기 포함)" sales/>
    </div>
    <div className="exec-status-note" aria-label="선택 접수월 종료 상태">
      <button type="button" onClick={() => showQueue('closed')}>상담마감 <strong>{current.closed}건</strong><ArrowUpRight size={13} aria-hidden="true"/></button>
      <button type="button" onClick={() => showQueue('canceled')}>취소 <strong>{current.canceled}건</strong><ArrowUpRight size={13} aria-hidden="true"/></button>
    </div>

    <MonthlyCommissionPanel leads={leads} partnerName={selectedPartner} today={today} onSelectLead={onSelectLead}/>

    <details className="exec-details exec-month-details" open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}>
    <summary><i className="details-toggle-mark" aria-hidden="true"/><strong>월별 상세 보기</strong><small>확인할 고객 · 업체·담당자 성과</small></summary>
    <div className="exec-month-detail-body">

    <div className="exec-section-head"><div><h3>확인할 고객</h3><p>{monthLabel(month)} 접수 고객 · 항목을 누르면 목록을 확인합니다.</p></div><span>{uniqueActionCustomers ? `${uniqueActionCustomers}명 확인 필요` : '확인 필요 고객 없음'}</span></div>
    <div className="exec-actions">
      <ActionCard label="담당자 미배정" value={actions.unassigned.length} note="담당자를 정해 첫 상담을 시작하세요" action="unassigned" selected={queue} onSelect={setQueue} color="amber"/>
      <ActionCard label="방문일 경과 · 미처리" value={actions.overdue.length} note="방문 여부와 다음 일정을 확인하세요" action="overdue" selected={queue} onSelect={setQueue} color="rose"/>
      <ActionCard label="7일 이상 관리 공백" value={actions.stale.length} note="다음 연락과 관리메모를 남겨주세요" action="stale" selected={queue} onSelect={setQueue} color="teal"/>
    </div>
    <p className="exec-footnote">한 고객이 여러 확인 항목에 포함될 수 있습니다.</p>

    {queue ? <section className="exec-drilldown" aria-label={queueInfo[queue].title}>
      <header><div><h4>{queueInfo[queue].title} <span>{queueRows.length}명</span></h4><p>{queueInfo[queue].note}</p></div><button type="button" onClick={() => setQueue(null)} aria-label="확인 고객 목록 닫기"><X size={18}/></button></header>
      {queueRows.length ? <div className="exec-drill-scroll"><table><thead><tr><th>고객</th><th>제휴업체</th><th>담당자</th><th>방문 예정일</th><th>최근 관리메모</th></tr></thead><tbody>{queueRows.map(lead => <tr key={lead.id}><td><button type="button" className="exec-customer-link" onClick={() => onSelectLead(lead)}>{customerDisplayLabel(lead)}<ArrowUpRight size={14} aria-hidden="true"/></button></td><td>{lead.partnerName || '미입력'}</td><td>{lead.manager || '미배정'}</td><td>{lead.visitScheduledDate?.replaceAll('-', '.') || '미정'}</td><td>{latestMemoDate(lead)?.replaceAll('-', '.') || '기록 없음'}</td></tr>)}</tbody></table></div> : <p className="exec-empty">해당하는 고객이 없습니다.</p>}
    </section> : null}

    <div className="exec-highlights">
      <section className="exec-highlight exec-highlight-referral" aria-label="접수 많은 업체 TOP 3"><header><div><h3>접수 많은 업체</h3><p>{monthLabel(month)} 접수 · 접수 건수순</p></div><span>TOP 3</span></header><Ranking rows={topReferralPartners} kind="referral"/></section>
      <section className="exec-highlight"><header><div><h3>업체 판매</h3><p>{monthLabel(month)} 접수 · 총판매금액 순</p></div><span>TOP 3</span></header><Ranking rows={sortedPartners.slice(0, 3)} kind="partner"/></section>
      <section className="exec-highlight exec-highlight-commission"><header><div><h3>업체 예상 수수료</h3><p>{monthLabel(month)} 접수 · 정산월 전체 합계</p></div><span>TOP 3</span></header><Ranking rows={topCommissionPartners} kind="commission"/></section>
      <section className="exec-highlight"><header><div><h3>담당자 판매</h3><p>{monthLabel(month)} 접수 · 구매완료 건수 순, 동률은 총판매금액 순</p></div><span>TOP 3</span></header><Ranking rows={sortedManagers.slice(0, 3)} kind="manager" onSelectManager={onSelectManager}/></section>
    </div>

    <PerformanceTable title="업체별 상세 성과" rows={metrics.partners} month={month} kind="partner"/>
    <PerformanceTable title="담당자별 상세 성과" rows={sortedManagers} month={month} kind="manager" onSelectManager={onSelectManager}/>
    <p className="exec-footer" title={financialDefinitions}>총판매금액은 일시불과 구독(출하대기 포함)을 합산합니다. 접수월 기준 성과로 실제 납품·정산 완료 금액과 다릅니다.</p>
    </div>
    </details>
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
function Kpi({ label, value, unit, icon, change, note, sales = false }: { label: string; value: string; unit: string; icon: React.ReactNode; change: { text: string; tone: 'up' | 'down' | 'neutral' }; note?: string; sales?: boolean }) {
  return <article className={`exec-kpi${sales ? ' exec-kpi-sales' : ''}`}><div className="exec-kpi-label"><span>{label}</span><i className="exec-kpi-icon" aria-hidden="true">{icon}</i></div><div className="exec-kpi-value"><strong>{value}<small>{unit}</small></strong></div><span className="exec-change" data-tone={change.tone}>{change.text}</span>{note ? <p className="exec-kpi-note">{note}</p> : null}</article>
}
function ActionCard({ label, value, note, action, selected, onSelect, color }: { label: string; value: number; note: string; action: Queue; selected: Queue | null; onSelect: (action: Queue | null) => void; color: string }) {
  return <button type="button" className="exec-action" data-tone={color} aria-pressed={selected === action} onClick={() => onSelect(selected === action ? null : action)}><span className="exec-action-label"><Clock3 size={16}/>{label}</span><strong className="exec-action-count">{value}<small>명</small></strong><span className="exec-action-note">{note}</span><ArrowUpRight className="exec-action-arrow" size={19}/></button>
}
function ManagerLink({ name, onSelect }: { name: string; onSelect: (name: string) => void }) {
  return <button type="button" className="exec-manager-link" aria-label={`${name} 담당 고객 보기`} title="선택한 접수월의 담당 고객 보기" onClick={() => onSelect(name)}><span>{name}</span><ArrowUpRight size={14} aria-hidden="true"/></button>
}
function Ranking({ rows, kind, onSelectManager }: { rows: PerformanceRow[]; kind: 'partner' | 'commission' | 'manager' | 'referral'; onSelectManager?: (name: string) => void }) {
  const emptyMessage = kind === 'commission' ? '선택한 접수월의 예상 수수료가 없습니다.'
    : kind === 'referral' ? '선택한 접수월에 등록된 업체 접수가 없습니다.'
    : `선택한 접수월의 ${kind === 'partner' ? '업체' : '담당자'} 데이터가 없습니다.`
  return rows.length > 0 ? <div className="exec-ranking-list">{rows.map((row, index) => <div className="exec-ranking" key={row.name}>
    <span>{index + 1}</span>
    <div className="exec-ranking-identity">
      {kind === 'manager' && onSelectManager ? <ManagerLink name={row.name} onSelect={onSelectManager}/> : <strong title={row.name}>{row.name}</strong>}
      <small>{kind === 'referral' ? `구매완료 ${row.completed.toLocaleString('ko-KR')}건` : salesProgressLabel(row, kind === 'manager' ? 'manager' : 'partner')}</small>
    </div>
    <div className="exec-ranking-value">{kind === 'manager' ? <strong>{row.completed}<small>건 성공</small></strong>
      : kind === 'referral' ? <strong>{row.cases.toLocaleString('ko-KR')}<small>건 접수</small></strong>
      : <strong>{won(kind === 'commission' ? row.expectedCommission : executiveTotalSalesFor(row))}</strong>}
    </div>
  </div>)}</div> : <p className="exec-empty">{emptyMessage}</p>
}
function PerformanceTable({ title, rows, month, kind, onSelectManager }: { title: string; rows: PerformanceRow[]; month: string; kind: 'partner' | 'manager'; onSelectManager?: (name: string) => void }) {
  const [sort, setSort] = useState<{ key: SortColumn; direction: 'asc' | 'desc' }>({ key: 'cases', direction: 'desc' })
  const columns: { key: SortColumn; label: string }[] = [
    { key: 'name', label: kind === 'partner' ? '제휴업체' : '담당자' }, { key: 'cases', label: kind === 'partner' ? '접수' : '배정 접수' },
    ...(kind === 'partner' ? [{ key: 'expectedCommission' as const, label: '예상 수수료' }] : []),
    { key: 'active', label: '관리중' }, { key: 'completed', label: '구매완료' }, { key: 'closed', label: '상담마감' }, { key: 'canceled', label: '취소' }, { key: 'salesProgress', label: kind === 'partner' ? '판매 / 접수' : '판매 / 배정' }, { key: 'sales', label: '총판매금액' }, { key: 'managementRecords', label: '관리기록' },
  ]
  const totalCommission = rows.reduce((total, row) => total + row.expectedCommission, 0)
  const sorted = [...rows].sort((a, b) => {
    const result = sort.key === 'name' ? a.name.localeCompare(b.name, 'ko') : sort.key === 'salesProgress' ? a.completed - b.completed || a.cases - b.cases : sort.key === 'sales' ? executiveTotalSalesFor(a) - executiveTotalSalesFor(b) : a[sort.key] - b[sort.key]
    return result * (sort.direction === 'asc' ? 1 : -1) || a.name.localeCompare(b.name, 'ko')
  })
  return <details className="exec-details">
    <summary><i className="details-toggle-mark" aria-hidden="true"/><strong>{title}</strong><small>{rows.length}{kind === 'partner' ? '개 업체' : '명'} · + / − 상세 보기</small></summary>
    <div className="exec-detail-body">
      <p title={financialDefinitions}>{monthLabel(month)} 접수 기준 · 열 제목을 눌러 정렬{kind === 'manager' ? ' · 담당자를 눌러 해당 월 고객 보기' : ' · 예상 수수료는 정산월 전체 합계'}</p>
      <div className="exec-table-scroll"><table className="exec-table">
        <thead><tr>{columns.map(column => <th key={column.key} aria-sort={sort.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
          <button type="button" title={performanceColumnHelp(column.key)} className={`exec-sort-button${sort.key === column.key ? ' active' : ''}`} onClick={() => setSort(current => ({ key: column.key, direction: current.key === column.key && current.direction === 'desc' ? 'asc' : 'desc' }))}>{column.label}<span aria-hidden="true">{sort.key === column.key ? sort.direction === 'asc' ? '↑' : '↓' : '↕'}</span></button>
        </th>)}</tr></thead>
        <tbody>{sorted.map(row => <tr key={row.name}>{columns.map(column => <td key={column.key} className={column.key === 'expectedCommission' ? 'exec-commission-cell' : undefined}>{column.key === 'name' ? kind === 'manager' && onSelectManager ? <ManagerLink name={row.name} onSelect={onSelectManager}/> : row.name : column.key === 'sales' ? won(executiveTotalSalesFor(row)) : column.key === 'expectedCommission' ? won(row[column.key]) : column.key === 'salesProgress' ? <span className="exec-sales-progress" title={salesProgressLabel(row, kind)} aria-label={salesProgressLabel(row, kind)}>{row.completed.toLocaleString('ko-KR')}건 / {row.cases.toLocaleString('ko-KR')}건</span> : `${row[column.key]}건`}</td>)}</tr>)}</tbody>
        {kind === 'partner' ? <tfoot><tr><th scope="row" colSpan={2}>예상 수수료 합계</th><td className="exec-commission-cell">{won(totalCommission)}</td><td colSpan={columns.length - 3}/></tr></tfoot> : null}
      </table></div>
      {rows.length === 0 ? <p className="exec-empty">선택한 접수월의 데이터가 없습니다.</p> : null}
    </div>
  </details>
}
