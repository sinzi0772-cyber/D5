import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight, Building2, Check, CircleHelp, Clock3,
  LogOut, Menu, MoreHorizontal, Plus, Search,
  Settings, Sparkles, UserRound, UsersRound, X,
} from 'lucide-react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, type User } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, query as firestoreQuery, setDoc, where, writeBatch, deleteField } from 'firebase/firestore'
import { auth, db, isDemoMode, isFirebaseConfigured } from './lib/firebase'
import { STATUSES, type Lead, type LeadStatus, type MemoEntry, type VisitState } from './types'

type SortKey = 'customerName' | 'registeredAt' | 'partnerName' | 'manager' | 'visitDate' | 'status' | 'management' | 'updatedAt'
type Staff = { employeeNo: string; name: string; role: '매니저' | '지점장' | '부지점장' }
const managers: Staff[] = [
  {
    "employeeNo": "19447",
    "name": "백현승",
    "role": "매니저"
  },
  {
    "employeeNo": "19653",
    "name": "한동민",
    "role": "매니저"
  },
  {
    "employeeNo": "19010",
    "name": "왕세훈",
    "role": "매니저"
  },
  {
    "employeeNo": "19407",
    "name": "김민범",
    "role": "매니저"
  },
  {
    "employeeNo": "19348",
    "name": "복기철",
    "role": "매니저"
  },
  {
    "employeeNo": "16798",
    "name": "오원석",
    "role": "매니저"
  },
  {
    "employeeNo": "18322",
    "name": "안동수",
    "role": "매니저"
  },
  {
    "employeeNo": "17399",
    "name": "김대식",
    "role": "매니저"
  },
  {
    "employeeNo": "18554",
    "name": "이지민",
    "role": "매니저"
  },
  {
    "employeeNo": "18534",
    "name": "장세웅",
    "role": "매니저"
  },
  {
    "employeeNo": "17838",
    "name": "김대웅",
    "role": "매니저"
  },
  {
    "employeeNo": "19459",
    "name": "강혁훈",
    "role": "매니저"
  },
  {
    "employeeNo": "18327",
    "name": "소영호",
    "role": "매니저"
  },
  {
    "employeeNo": "16855",
    "name": "장형철",
    "role": "매니저"
  },
  {
    "employeeNo": "18501",
    "name": "권혁민",
    "role": "매니저"
  },
  {
    "employeeNo": "17348",
    "name": "변진호",
    "role": "매니저"
  },
  {
    "employeeNo": "13783",
    "name": "우길수",
    "role": "매니저"
  },
  {
    "employeeNo": "13965",
    "name": "박준덕",
    "role": "매니저"
  },
  {
    "employeeNo": "12237",
    "name": "이동진",
    "role": "지점장"
  },
  {
    "employeeNo": "11768",
    "name": "백도현",
    "role": "부지점장"
  },
  {
    "employeeNo": "13026",
    "name": "강동화",
    "role": "부지점장"
  },
  {
    "employeeNo": "13839",
    "name": "오인탁",
    "role": "부지점장"
  },
  {
    "employeeNo": "13240",
    "name": "김지성",
    "role": "부지점장"
  },
  {
    "employeeNo": "14826",
    "name": "김종현",
    "role": "부지점장"
  }
]
type AppUser = { id: string; loginId: string; name: string; role: string; mustChangePassword: boolean }
const appUserFromSession = (user: User): AppUser => ({
  id: user.uid,
  loginId: user.email?.split('@')[0] || '',
  name: user.displayName || user.email?.split('@')[0] || 'D5 사용자',
  role: 'manager',
  mustChangePassword: false,
})
const roleLabel = (role: string) => ({ admin: '관리자', store_manager: '지점장', assistant_manager: '부지점장', manager: '매니저' }[role] || role)
const statusTone: Record<LeadStatus, string> = { 관리중: 'indigo', 구매완료: 'green', 취소: 'gray' }
const normalizeStatus = (value: string): LeadStatus => value === '구매완료' || value === '계약완료' ? '구매완료' : value === '취소' || value === '종결' ? '취소' : '관리중'

const today = new Date().toISOString().slice(0, 10)
const blankLead = (): Lead => ({
  id: crypto.randomUUID(), registeredAt: today, customerName: '', phoneLast4: '', gender: '미입력',
  partnerName: '', status: '관리중', visitState: '미정', manager: '', updatedAt: new Date().toISOString(),
})
const maskName = (value: string) => {
  const clean = value.trim().replace(/\s/g, '')
  if (!clean) return ''
  if (clean.includes('*')) return clean
  if (clean.length === 1) return clean
  if (clean.length === 2) return `${clean[0]}*`
  return `${clean[0]}*${clean.at(-1)}`
}
const last4 = (value: string) => value.replace(/\D/g, '').slice(-4)
const formatDate = (date?: string) => date ? date.replaceAll('-', '.') : '—'
const partnerKey = (value: string) => value.trim().toLowerCase().replace(/주식회사|\(주\)|㈜/g, '').replace(/[\s·._-]/g, '')
const partnerMatchScore = (candidate: string, input: string) => {
  const candidateKey = partnerKey(candidate)
  const inputKey = partnerKey(input)
  if (!inputKey) return 1
  if (candidateKey === inputKey) return 100
  if (candidateKey.startsWith(inputKey)) return 90
  if (candidateKey.includes(inputKey)) return 80
  if (inputKey.includes(candidateKey)) return 70
  const rows = Array.from({ length: inputKey.length + 1 }, (_, index) => index)
  for (let i = 1; i <= candidateKey.length; i++) {
    let diagonal = rows[0]
    rows[0] = i
    for (let j = 1; j <= inputKey.length; j++) {
      const previous = rows[j]
      rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, diagonal + (candidateKey[i - 1] === inputKey[j - 1] ? 0 : 1))
      diagonal = previous
    }
  }
  const similarity = 1 - rows[inputKey.length] / Math.max(candidateKey.length, inputKey.length)
  return similarity >= 0.5 ? Math.round(similarity * 60) : 0
}
const memoEntriesFor = (lead: Lead): MemoEntry[] => lead.memoHistory?.length ? lead.memoHistory : (lead.note ? [{ id: 'legacy', date: lead.updatedAt.slice(0,10), manager: lead.manager || '미배정', content: lead.note }] : [])
const collapseCases = (rows: Lead[]) => {
  const seen = new Set<string>()
  return rows.filter(lead => {
    if (!lead.caseGroupId) return true
    if (seen.has(lead.caseGroupId)) return false
    seen.add(lead.caseGroupId)
    return true
  })
}

export default function App() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'전체' | LeadStatus>('전체')
  const [managerFilter, setManagerFilter] = useState('전체 담당자')
  const [visitFilter, setVisitFilter] = useState<'전체' | VisitState>('전체')
  const [sort, setSort] = useState<{key: SortKey; direction: 'asc' | 'desc'}>({ key: 'updatedAt', direction: 'desc' })
  const [partnerFilter, setPartnerFilter] = useState('전체 제휴업체')
  const [active, setActive] = useState<Lead | null>(null)
  const [openMemoOnDrawer, setOpenMemoOnDrawer] = useState(false)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState('')
  const [currentUser, setCurrentUser] = useState<AppUser | null>(isDemoMode ? { id: 'demo', loginId: 'demo', name: 'D5 관리자', role: '데모 관리자', mustChangePassword: false } : null)
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured)
  const [dataReady, setDataReady] = useState(isDemoMode)
  const [dataError, setDataError] = useState('')

  useEffect(() => {
    if (!auth || !db) return
    const firestoreDb = db
    return onAuthStateChanged(auth, async firebaseUser => {
      if (!firebaseUser) { setCurrentUser(null); setAuthReady(true); return }
      const baseUser = appUserFromSession(firebaseUser)
      try {
        const profileRef = doc(firestoreDb, 'profiles', firebaseUser.uid)
        let profileSnapshot = await getDoc(profileRef)
        if (!profileSnapshot.exists()) {
          const staff = managers.find(member => member.employeeNo === baseUser.loginId)
          const isAdmin = baseUser.loginId === '12784'
          const isStoreAdmin = baseUser.loginId === '1292'
          await setDoc(profileRef, {
            employeeNo: baseUser.loginId,
            displayName: isAdmin ? 'D5 관리자' : (isStoreAdmin ? 'D5 지점 관리자' : (staff?.name || baseUser.loginId)),
            role: isAdmin ? 'admin' : (isStoreAdmin ? 'store_manager' : 'manager'),
            positionLabel: isAdmin ? '관리자' : (isStoreAdmin ? '지점 관리자' : '매니저'),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          profileSnapshot = await getDoc(profileRef)
        }
        const profile = profileSnapshot.data()
        setCurrentUser({ ...baseUser, name: String(profile?.displayName || baseUser.name), role: String(profile?.role || 'manager'), mustChangePassword: Boolean(profile?.mustChangePassword) })
      } catch (error) {
        setDataError(error instanceof Error ? error.message : '사용자 권한을 확인하지 못했습니다.')
        setCurrentUser(baseUser)
      } finally {
        setAuthReady(true)
      }
    })
  }, [])


  useEffect(() => {
    if (!db || !currentUser || currentUser.mustChangePassword) return
    let activeRequest = true
    setDataReady(false); setDataError('')
    const canReadAll = ['admin', 'store_manager', 'assistant_manager'].includes(currentUser.role)
    const referrals = collection(db, 'referrals')
    const request = canReadAll ? getDocs(referrals) : getDocs(firestoreQuery(referrals, where('managerEmployeeNo', '==', currentUser.loginId)))
    request.then(snapshot => {
      if (!activeRequest) return
      setLeads(snapshot.docs.map(item => {
        const row = item.data()
        return {
          id: item.id, registeredAt: row.registeredAt, customerName: row.customerName,
          phoneLast4: row.phoneLast4, gender: row.gender, visitScheduledDate: row.visitScheduledDate || undefined,
          partnerName: row.partnerName, billToCode: row.billToCode || undefined, lgeSubchannel: row.lgeSubchannel || undefined,
          manager: row.manager || undefined, plannerName: row.plannerName || undefined, caseGroupId: row.caseGroupId || undefined, status: normalizeStatus(row.status),
          visitState: row.visitState, note: row.note || undefined, memoHistory: row.memoHistory || [], updatedAt: row.updatedAt,
        } as Lead
      }))
      setDataReady(true)
    }).catch(error => {
      if (!activeRequest) return
      setDataError(error instanceof Error ? error.message : '데이터를 불러오지 못했습니다.')
      setDataReady(true)
    })
    return () => { activeRequest = false }
  }, [currentUser?.id, currentUser?.mustChangePassword])

  const partners = useMemo(() => [...new Set(leads.map(l => l.partnerName))].filter(Boolean), [leads])
  const managerNames = useMemo(() => [...new Set([...managers.filter(m => m.role === '매니저').map(m => m.name), ...leads.flatMap(l => l.manager ? [l.manager] : [])])], [leads])
  const metricLeads = useMemo(() => partnerFilter === '전체 제휴업체' ? leads : leads.filter(lead => lead.partnerName === partnerFilter), [leads, partnerFilter])
  const latestRegisteredAt = useMemo(() => metricLeads.reduce((latest, lead) => lead.registeredAt > latest ? lead.registeredAt : latest, ''), [metricLeads])
  const filtered = useMemo(() => {
    const result = leads.filter(l => {
      const term = query.toLowerCase()
      const hit = !term || [l.customerName, l.phoneLast4, l.partnerName, l.manager].some(v => v?.toLowerCase().includes(term))
      return hit
        && (statusFilter === '전체' || l.status === statusFilter)
        && (partnerFilter === '전체 제휴업체' || l.partnerName === partnerFilter)
        && (managerFilter === '전체 담당자' || (managerFilter === '미배정' ? !l.manager : l.manager === managerFilter))
        && (visitFilter === '전체' || l.visitState === visitFilter)
    })
    const value = (lead: Lead) => {
      const values: Record<SortKey, string> = { customerName: lead.customerName, registeredAt: lead.registeredAt, partnerName: lead.partnerName, manager: lead.manager || '', visitDate: lead.visitScheduledDate || '', status: lead.status, management: memoEntriesFor(lead).at(-1)?.date || '', updatedAt: lead.updatedAt }
      return values[sort.key]
    }
    return result.sort((a, b) => value(a).localeCompare(value(b), 'ko', { numeric: true }) * (sort.direction === 'asc' ? 1 : -1))
  }, [leads, query, statusFilter, partnerFilter, managerFilter, visitFilter, sort])
  const visibleRows = useMemo(() => collapseCases(filtered), [filtered])
  const caseCount = useMemo(() => collapseCases(metricLeads).length, [metricLeads])
  const newCount = metricLeads.filter(l => l.status === '관리중').length
  const completedCount = metricLeads.filter(l => l.status === '구매완료').length
  const canceledCount = metricLeads.filter(l => l.status === '취소').length
  const partnerStats = useMemo(() => {
    const groups = new Map<string, { name: string; total: number; active: number; completed: number; canceled: number }>()
    const caseIds = new Set<string>()
    for (const lead of metricLeads) {
      const name = lead.partnerName?.trim() || '업체명 미입력'
      const row = groups.get(name) || { name, total: 0, active: 0, completed: 0, canceled: 0 }
      const caseId = `${name}:${lead.caseGroupId || lead.id}`
      if (!caseIds.has(caseId)) { row.total++; caseIds.add(caseId) }
      if (lead.status === '구매완료') row.completed++
      else if (lead.status === '취소') row.canceled++
      else row.active++
      groups.set(name, row)
    }
    return [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ko'))
  }, [metricLeads])
  const canManageAll = Boolean(currentUser && ['admin', 'store_manager', 'assistant_manager', '데모 관리자'].includes(currentUser.role))

  const notify = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(''), 2800) }
  const sortBy = (key: SortKey) => setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))
  const saveLead = async (lead: Lead, linkTargetId?: string) => {
    const canonicalPartner = partners.find(partner => partnerKey(partner) === partnerKey(lead.partnerName))
    const linkTarget = linkTargetId ? leads.find(item => item.id === linkTargetId && item.id !== lead.id) : undefined
    if (linkTargetId && !linkTarget) { notify('연결할 기존 고객을 다시 선택해주세요.'); return }
    const caseGroupId = linkTarget ? linkTarget.caseGroupId || `case-${linkTarget.id}` : lead.caseGroupId
    const sanitized = { ...lead, caseGroupId, partnerName: canonicalPartner || lead.partnerName.trim(), customerName: maskName(lead.customerName), phoneLast4: last4(lead.phoneLast4), updatedAt: new Date().toISOString() }
    if (isFirebaseConfigured && db && currentUser) {
      const managerEmployeeNo = managers.find(manager => manager.name === sanitized.manager)?.employeeNo || null
      const payload = Object.fromEntries(Object.entries({
        registeredAt: sanitized.registeredAt, customerName: sanitized.customerName,
        phoneLast4: sanitized.phoneLast4, gender: sanitized.gender, visitScheduledDate: sanitized.visitScheduledDate || null,
        partnerName: sanitized.partnerName, billToCode: sanitized.billToCode || null, lgeSubchannel: sanitized.lgeSubchannel || null,
        manager: sanitized.manager || null, managerEmployeeNo, plannerName: sanitized.plannerName || null,
        ...(caseGroupId ? { caseGroupId } : {}),
        status: sanitized.status, visitState: sanitized.visitState, note: sanitized.note || null, memoHistory: sanitized.memoHistory || [],
        ...(creating ? { createdBy: currentUser.id, createdAt: sanitized.updatedAt } : {}),
        updatedBy: currentUser.id, updatedAt: sanitized.updatedAt,
      }).filter(([, value]) => value !== undefined))
      try {
        if (linkTarget && !linkTarget.caseGroupId) {
          const batch = writeBatch(db)
          batch.set(doc(db, 'referrals', sanitized.id), payload, { merge: true })
          batch.update(doc(db, 'referrals', linkTarget.id), { caseGroupId })
          await batch.commit()
        } else {
          await setDoc(doc(db, 'referrals', sanitized.id), payload, { merge: true })
        }
      } catch (error) {
        notify(`저장하지 못했습니다: ${error instanceof Error ? error.message : 'Firebase 오류'}`); return
      }
    }
    setLeads(prev => {
      const withLinked = linkTarget && !linkTarget.caseGroupId ? prev.map(item => item.id === linkTarget.id ? { ...item, caseGroupId } : item) : prev
      return withLinked.some(x => x.id === sanitized.id) ? withLinked.map(x => x.id === sanitized.id ? sanitized : x) : [sanitized, ...withLinked]
    })
    setActive(null); setCreating(false); setOpenMemoOnDrawer(false); notify('고객 정보가 저장되었습니다')
  }
  const unlinkCase = async (lead: Lead) => {
    if (!lead.caseGroupId || !canManageAll) return
    const members = leads.filter(item => item.caseGroupId === lead.caseGroupId)
    if (members.length < 2) return
    const toUnlink = members.length === 2 ? members : [lead]
    if (isFirebaseConfigured && db) {
      try {
        const batch = writeBatch(db)
        for (const item of toUnlink) batch.update(doc(db, 'referrals', item.id), { caseGroupId: deleteField() })
        await batch.commit()
      } catch (error) {
        notify(`연결을 해제하지 못했습니다: ${error instanceof Error ? error.message : 'Firebase 오류'}`)
        return
      }
    }
    const ids = new Set(toUnlink.map(item => item.id))
    setLeads(prev => prev.map(item => ids.has(item.id) ? { ...item, caseGroupId: undefined } : item))
    setActive(null); setOpenMemoOnDrawer(false); notify('접수건 연결이 해제되었습니다')
  }
  if (!isFirebaseConfigured && !isDemoMode) return <SetupRequired/>
  if (!authReady) return <div className="loading-screen"><div className="brand-mark">D5</div><p>안전하게 연결하는 중...</p></div>
  if (!currentUser) return <LoginScreen/>
  if (currentUser.mustChangePassword) return <PasswordChangeScreen onComplete={() => setCurrentUser(user => user ? { ...user, mustChangePassword: false } : user)}/>
  if (!dataReady) return <div className="loading-screen"><div className="brand-mark">D5</div><p>안전하게 연결하는 중...</p></div>

  return <div className="app-shell">

    <main>
      <section className="content">
        <div className="page-heading"><div>{isDemoMode&&<div className="demo-notice"><span>DEMO</span><strong>데모 모드</strong><p>표시된 고객은 예시 데이터이며 변경사항은 운영 DB에 저장되지 않습니다.</p></div>}<p className="eyebrow">PARTNER REFERRAL CRM</p><h1>좋은 인연을, 놓치지 않도록.</h1><p>제휴업체 소개 고객의 접수부터 방문, 상담, 계약까지 한곳에서 관리하세요.</p></div><div className="heading-actions">{canManageAll&&<button className="btn primary" onClick={() => { setActive(blankLead()); setCreating(true); setOpenMemoOnDrawer(false) }}><Plus size={18}/>신규 고객 등록</button>}{isFirebaseConfigured&&<button className="btn secondary" onClick={()=>auth&&signOut(auth)}><LogOut size={16}/>로그아웃</button>}</div></div>

        {dataError&&<div className="data-alert"><CircleHelp size={18}/><div><strong>데이터를 불러오지 못했습니다.</strong><span>{dataError}</span></div><button onClick={()=>window.location.reload()}>다시 시도</button></div>}

        <details className="metrics-panel">
          <summary className="metrics-toggle"><span className="metrics-toggle-mark" aria-hidden="true"/><strong>관리지표</strong><small>{partnerFilter === '전체 제휴업체' ? '전체 제휴업체' : partnerFilter} · 접수 {caseCount}건</small></summary>
          <div className="metrics-panel-body">
            <div className="metrics" aria-label="고객 관리지표">
              <Metric label={partnerFilter === '전체 제휴업체' ? '제휴업체 접수 고객' : `${partnerFilter} 접수 고객`} value={caseCount} note={`고객 ${metricLeads.length}명 · 같은 접수건은 1건`} icon={<UsersRound/>} tone="dark"/>
              <Metric label="관리중" value={newCount} note="현재 관리 고객" icon={<Clock3/>} tone="amber"/>
              <Metric label="구매완료" value={completedCount} note="구매 완료 고객" icon={<Check/>} tone="teal"/>
              <Metric label="취소" value={canceledCount} note="관리 종료 고객" icon={<X/>} tone="red"/>
            </div>
            <div className="partner-stats">
              <div className="partner-stats-heading"><strong>업체별 관리 현황</strong><span>접수는 연결 고객을 1건으로, 상태는 고객별로 집계</span></div>
              <div className="partner-stats-scroll">
                <table className="partner-stats-table"><thead><tr><th>제휴업체</th><th>접수건</th><th>관리중 고객</th><th>구매완료 고객</th><th>취소 고객</th></tr></thead><tbody>
                  {partnerStats.map(row => <tr key={row.name}><td>{row.name}</td><td>{row.total}건</td><td>{row.active}건</td><td>{row.completed}건</td><td>{row.canceled}건</td></tr>)}
                </tbody></table>
                {partnerStats.length === 0 && <p className="partner-stats-empty">집계할 고객이 없습니다.</p>}
              </div>
            </div>
          </div>
        </details>

        <div className="panel">
          <div className="panel-head"><div><h2>고객 접수 현황</h2><span>{latestRegisteredAt ? `데이터 기준일 ${formatDate(latestRegisteredAt)} · ${partnerFilter === '전체 제휴업체' ? '전체' : partnerFilter} 접수 ${caseCount}건 · 고객 ${metricLeads.length}명` : '등록된 고객 데이터가 없습니다'}</span></div><div className="panel-search search"><Search size={17}/><input aria-label="고객 검색" placeholder="고객명 또는 휴대폰 뒷자리 검색" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button type="button" aria-label="검색어 지우기" onClick={() => setQuery('')}><X size={15}/></button>}</div></div>
          <div className="filters">
            <label className="filter-field"><span>제휴업체</span><select aria-label="제휴업체 필터" value={partnerFilter} onChange={e => setPartnerFilter(e.target.value)}><option>전체 제휴업체</option>{partners.map(p => <option key={p}>{p}</option>)}</select></label>
            <label className="filter-field"><span>담당 매니저</span><select aria-label="담당 매니저 필터" value={managerFilter} onChange={e => setManagerFilter(e.target.value)}><option>전체 담당자</option><option>미배정</option>{managerNames.map(name => <option key={name}>{name}</option>)}</select></label>
            <label className="filter-field"><span>현재 상태</span><select aria-label="현재 상태 필터" value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}><option>전체</option>{STATUSES.map(status => <option key={status}>{status}</option>)}</select></label>
            <label className="filter-field"><span>방문 여부</span><select aria-label="방문 여부 필터" value={visitFilter} onChange={e => setVisitFilter(e.target.value as typeof visitFilter)}><option>전체</option><option>미정</option><option>예정</option><option>방문</option><option>미방문</option><option>일정취소</option></select></label>
          </div>
          <div className="filter-summary"><div className="active-filters">{!query && partnerFilter === '전체 제휴업체' && managerFilter === '전체 담당자' && statusFilter === '전체' && visitFilter === '전체' && <span className="filter-hint">전체 고객을 표시하고 있습니다</span>}{query && <button onClick={() => setQuery('')}>검색: {query}<X size={12}/></button>}{partnerFilter !== '전체 제휴업체' && <button onClick={() => setPartnerFilter('전체 제휴업체')}>{partnerFilter}<X size={12}/></button>}{managerFilter !== '전체 담당자' && <button onClick={() => setManagerFilter('전체 담당자')}>{managerFilter}<X size={12}/></button>}{statusFilter !== '전체' && <button onClick={() => setStatusFilter('전체')}>{statusFilter}<X size={12}/></button>}{visitFilter !== '전체' && <button onClick={() => setVisitFilter('전체')}>{visitFilter}<X size={12}/></button>}</div><div className="filter-result"><strong>{visibleRows.length}</strong>건 · 고객 {filtered.length}명{(query || partnerFilter !== '전체 제휴업체' || managerFilter !== '전체 담당자' || statusFilter !== '전체' || visitFilter !== '전체') && <button onClick={() => { setQuery(''); setPartnerFilter('전체 제휴업체'); setManagerFilter('전체 담당자'); setStatusFilter('전체'); setVisitFilter('전체') }}>전체 초기화</button>}</div></div>
          <div className="table-wrap"><table><thead><tr><th><SortHeader label="고객" column="customerName" sort={sort} onSort={sortBy}/></th><th><SortHeader label="등록일" column="registeredAt" sort={sort} onSort={sortBy}/></th><th><SortHeader label="제휴업체" column="partnerName" sort={sort} onSort={sortBy}/></th><th><SortHeader label="담당 매니저" column="manager" sort={sort} onSort={sortBy}/></th><th><SortHeader label="방문 일정" column="visitDate" sort={sort} onSort={sortBy}/></th><th><SortHeader label="현재 상태" column="status" sort={sort} onSort={sortBy}/></th><th><SortHeader label="관리 내용" column="management" sort={sort} onSort={sortBy}/></th><th/></tr></thead><tbody>{visibleRows.map(l => <tr key={l.id} onClick={() => { setActive(l); setCreating(false); setOpenMemoOnDrawer(false) }}><td><div className="customer"><span>{l.customerName.slice(0,1)}</span><div><strong>{l.caseGroupId ? filtered.filter(member => member.caseGroupId === l.caseGroupId).map(member => member.customerName).join(' · ') : l.customerName}</strong><small>{l.caseGroupId ? filtered.filter(member => member.caseGroupId === l.caseGroupId).map(member => member.phoneLast4).join(' / ') : `•••• ${l.phoneLast4}`}</small>{l.caseGroupId && <em className="case-badge">같은 접수 1건</em>}</div></div></td><td>{formatDate(l.registeredAt)}</td><td><div className="partner"><strong>{l.partnerName}</strong>{l.plannerName && <small>플래너 {l.plannerName}</small>}</div></td><td>{l.manager ? <span className="manager"><i>{l.manager.slice(-2,-1)}</i>{l.manager}</span> : <span className="unassigned">미배정</span>}</td><td><div className="date-cell">{formatDate(l.visitScheduledDate)}<small>{l.visitState}</small></div></td><td><span className={`badge ${statusTone[l.status]}`}><i/>{l.status}</span></td><td><ManagementSummary lead={l} onOpen={()=>{setActive(l);setCreating(false);setOpenMemoOnDrawer(true)}}/></td><td><button className="more"><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table>{visibleRows.length === 0 && <div className="empty"><Search/><h3>검색 결과가 없습니다</h3><p>필터나 검색어를 바꿔보세요.</p></div>}</div>
          <div className="panel-foot"><span>접수 {visibleRows.length}건 · 고객 {filtered.length}명 표시</span><span><i className="privacy-dot"/>민감정보 최소 수집 적용</span></div>
        </div>
      </section>
    </main>

    {active && <LeadDrawer lead={active} linkedLeads={active.caseGroupId ? leads.filter(lead => lead.caseGroupId === active.caseGroupId) : []} allLeads={leads} onSelectLinked={setActive} partners={partners} creating={creating} canManageAll={canManageAll} openMemoInitially={openMemoOnDrawer} onClose={() => { setActive(null); setCreating(false); setOpenMemoOnDrawer(false) }} onSave={saveLead} onUnlink={unlinkCase}/>}
    {toast && <div className="toast"><Check size={17}/>{toast}</div>}
  </div>
}

function SortHeader({label,column,sort,onSort}:{label:string,column:SortKey,sort:{key:SortKey;direction:'asc'|'desc'},onSort:(key:SortKey)=>void}) {
  const active = sort.key === column
  return <button className={`sort-header ${active ? 'active' : ''}`} onClick={() => onSort(column)} aria-label={`${label} ${active && sort.direction === 'asc' ? '내림차순' : '오름차순'} 정렬`}>{label}<span>{active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>
}

function Metric({label,value,note,icon,tone}:{label:string,value:number,note:string,icon:React.ReactNode,tone:string}) {
  return <div className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}<small>건</small></strong><p>{note}</p></div><ArrowUpRight size={17}/></div>
}

function ManagementSummary({lead,onOpen}:{lead:Lead,onOpen:()=>void}) {
  const entries = memoEntriesFor(lead)
  const visible = entries.slice(-2)
  const firstRound = entries.length - visible.length + 1
  return <div className="management-cell"><div className="management-actions">{visible.map((entry,index)=><button type="button" className="management-chip" key={entry.id} onClick={event=>{event.stopPropagation();onOpen()}}><span>✓ {firstRound+index}회차 · 관리</span><small>{formatDate(entry.date)}</small></button>)}<button type="button" className="management-add" onClick={event=>{event.stopPropagation();onOpen()}}>+ 관리 기록 추가</button></div></div>
}

function LeadDrawer({lead,linkedLeads,allLeads,onSelectLinked,partners,creating,canManageAll,openMemoInitially,onClose,onSave,onUnlink}:{lead:Lead,linkedLeads:Lead[],allLeads:Lead[],onSelectLinked:(lead:Lead)=>void,partners:string[],creating:boolean,canManageAll:boolean,openMemoInitially:boolean,onClose:()=>void,onSave:(l:Lead,linkTargetId?:string)=>void,onUnlink:(lead:Lead)=>Promise<void>}) {
  const [form, setForm] = useState(lead)
  const [manualManager, setManualManager] = useState(Boolean(lead.manager && !managers.some(m => m.name === lead.manager)))
  const [memoOpen, setMemoOpen] = useState(openMemoInitially)
  const [linkExisting, setLinkExisting] = useState(false)
  const [linkTargetId, setLinkTargetId] = useState('')
  const [linkSearch, setLinkSearch] = useState('')
  const [unlinkBusy, setUnlinkBusy] = useState(false)
  useEffect(() => {
    setForm(lead)
    setManualManager(Boolean(lead.manager && !managers.some(m => m.name === lead.manager)))
    setMemoOpen(openMemoInitially)
    setLinkExisting(false)
    setLinkTargetId('')
    setLinkSearch('')
    setUnlinkBusy(false)
  }, [lead, openMemoInitially])
  const update = (key: keyof Lead, value: string) => setForm(f => ({...f,[key]:value}))
  const partnerSuggestions = useMemo(() => partners.map(partner => ({ partner, score: partnerMatchScore(partner, form.partnerName) })).filter(item => item.score > 0).sort((a,b) => b.score - a.score || a.partner.localeCompare(b.partner, 'ko')).slice(0, 12).map(item => item.partner), [partners, form.partnerName])
  const linkChoices = allLeads.filter(item => item.id !== lead.id && [item.customerName, item.phoneLast4, item.partnerName].some(value => value?.toLowerCase().includes(linkSearch.trim().toLowerCase()))).slice(0, 30)
  const unlinkSelected = async () => {
    const scope = linkedLeads.length === 2 ? '두 고객의 연결을 해제' : `${lead.customerName} 고객만 이 접수건에서 분리`
    if (!window.confirm(`${scope}할까요? 고객별 담당자·상태·관리메모는 유지됩니다. 저장하지 않은 화면 수정사항은 사라집니다.`)) return
    setUnlinkBusy(true)
    await onUnlink(lead)
    setUnlinkBusy(false)
  }
  const memoEntries: MemoEntry[] = form.memoHistory || (form.note ? [{ id: 'legacy', date: form.updatedAt.slice(0,10), manager: form.manager || '미배정', content: form.note }] : [])
  return <><button className="drawer-scrim" onClick={onClose}/><aside className="drawer">
    <div className="drawer-head"><div><span>{creating ? 'NEW REFERRAL' : 'CUSTOMER DETAIL'}</span><h2>{creating ? '신규 고객 등록' : `${lead.customerName} 고객`}</h2></div><button onClick={onClose}><X/></button></div>
    {!creating && <div className="identity"><div>{lead.customerName.slice(0,1)}</div><section><strong>{lead.customerName}</strong><span>{lead.phoneLast4}</span></section><span className={`badge ${statusTone[form.status]}`}><i/>{form.status}</span></div>}
    {linkedLeads.length > 1 && <div className="linked-case"><strong>같은 접수 1건 · 고객 {linkedLeads.length}명</strong><p>고객별 상태와 관리 내용은 각각 저장됩니다.</p><div>{linkedLeads.map(member => <button type="button" className={member.id === lead.id ? 'active' : ''} key={member.id} onClick={() => onSelectLinked(member)}><span>{member.customerName} · {member.phoneLast4}</span><small>{member.status}</small></button>)}</div>{canManageAll && <button type="button" className="unlink-case" disabled={unlinkBusy} onClick={unlinkSelected}>{unlinkBusy ? '해제 중...' : linkedLeads.length === 2 ? '두 고객 연결 해제' : '이 고객만 연결 해제'}</button>}</div>}
    <form onSubmit={e => {e.preventDefault(); if (linkExisting && !linkTargetId) return; onSave(form, linkExisting ? linkTargetId : undefined)}}>
      <fieldset><legend>기본 정보</legend><div className="form-grid">
        <label>등록일자<input type="date" required disabled={!creating} value={form.registeredAt} onChange={e=>update('registeredAt',e.target.value)}/></label>
        <label>성별<select disabled={!creating} value={form.gender} onChange={e=>update('gender',e.target.value)}><option>미입력</option><option>남</option><option>여</option></select></label>
        <label>고객명 <small>자동 마스킹</small><input required disabled={!creating} placeholder="예: 박수정 → 박*정" value={form.customerName} onChange={e=>update('customerName',e.target.value)}/></label>
        <label>휴대폰 뒷 4자리<input required disabled={!creating} inputMode="numeric" maxLength={4} pattern="[0-9]{4}" placeholder="4240" value={form.phoneLast4} onChange={e=>update('phoneLast4',last4(e.target.value))}/></label>
      </div></fieldset>
      {canManageAll && (creating || !lead.caseGroupId) && <fieldset className="case-link-fieldset"><legend>같은 접수건 연결</legend><label className="case-link-check"><input type="checkbox" checked={linkExisting} onChange={e=>{setLinkExisting(e.target.checked);setLinkTargetId('')}}/><span>이 고객을 기존 접수건과 묶기</span></label><small>신랑·신부 등 같은 접수건은 목록과 접수건 수에서 1건으로 표시됩니다. 고객별 상태와 관리메모는 따로 유지됩니다.</small>{linkExisting && <div className="case-link-picker"><label>기존 고객 찾기<input placeholder="고객명·휴대폰 뒷자리·제휴업체 검색" value={linkSearch} onChange={e=>{setLinkSearch(e.target.value);setLinkTargetId('')}}/></label><label>연결할 고객<select required value={linkTargetId} onChange={e=>setLinkTargetId(e.target.value)}><option value="">고객을 선택하세요</option>{linkChoices.map(item=><option key={item.id} value={item.id}>{item.customerName} · {item.phoneLast4} · {item.partnerName}</option>)}</select></label></div>}</fieldset>}
      <fieldset><legend>제휴 정보</legend><label>BILL To Name · 제휴업체명<input required disabled={!creating} list="partner-options" autoComplete="off" placeholder="판매 로우의 제휴업체 검색 또는 신규 입력" value={form.partnerName} onChange={e=>update('partnerName',e.target.value)} onBlur={e=>{const match=partners.find(partner=>partnerKey(partner)===partnerKey(e.target.value));if(match)update('partnerName',match)}}/><datalist id="partner-options">{partnerSuggestions.map(partner=><option key={partner} value={partner}/>)}</datalist><small>비슷한 기존 업체가 먼저 표시되며, 목록에 없는 업체명도 신규 저장할 수 있습니다.</small></label><label>플래너명<input disabled={!creating} placeholder="선택 입력" value={form.plannerName||''} onChange={e=>update('plannerName',e.target.value)}/></label></fieldset>
      <fieldset><legend>일정 정보</legend><label>매장방문 예정일<input type="date" value={form.visitScheduledDate||''} onChange={e=>update('visitScheduledDate',e.target.value)}/></label></fieldset>
      <fieldset><legend>진행 관리</legend><div className="form-grid"><label>담당 매니저<select disabled={!canManageAll} value={manualManager ? '__manual__' : form.manager||''} onChange={e=>{if(e.target.value==='__manual__'){setManualManager(true);update('manager','')}else{setManualManager(false);update('manager',e.target.value)}}}><option value="__manual__">직접입력</option><option value="">미배정</option>{managers.filter(m=>m.role==='매니저').map(m=><option key={m.employeeNo} value={m.name}>{m.name}</option>)}</select>{manualManager && canManageAll && <input className="manual-manager" autoFocus placeholder="담당자 이름 직접입력" value={form.manager||''} onChange={e=>update('manager',e.target.value)}/>}</label><label>현재 상태<select value={form.status} onChange={e=>update('status',e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></label><label>방문 여부<select value={form.visitState} onChange={e=>update('visitState',e.target.value as VisitState)}><option>미정</option><option>예정</option><option>방문</option><option>미방문</option><option>일정취소</option></select></label></div><button type="button" className="memo-open" onClick={()=>setMemoOpen(true)}><span><Clock3 size={18}/><b>관리메모</b></span><small>{memoEntries.length ? memoEntries.length+'건의 관리 이력' : '접촉 내용과 다음 계획을 기록하세요'}</small><i>보기 →</i></button></fieldset>
      <div className="drawer-actions"><button type="button" className="btn secondary" onClick={onClose}>취소</button><button className="btn primary" type="submit"><Check size={17}/>{creating ? '고객 등록' : '변경사항 저장'}</button></div>
    </form>
  </aside>{memoOpen&&<MemoModal lead={form} manager={form.manager||'미배정'} entries={memoEntries} onChange={entries=>setForm(f=>({...f,memoHistory:entries,note:entries.at(-1)?.content||''}))} onClose={()=>setMemoOpen(false)}/>}</>
}

function MemoModal({lead,manager,entries,onChange,onClose}:{lead:Lead,manager:string,entries:MemoEntry[],onChange:(entries:MemoEntry[])=>void,onClose:()=>void}) {
  const [editingId,setEditingId]=useState<string|null>(null)
  const [draft,setDraft]=useState('')
  const startNew=()=>{setEditingId('new');setDraft('')}
  const startEdit=(entry:MemoEntry)=>{setEditingId(entry.id);setDraft(entry.content)}
  const save=()=>{
    if(!draft.trim())return
    const next=editingId==='new'
      ? [...entries,{id:crypto.randomUUID(),date:today,manager:manager||'미배정',content:draft.trim()}]
      : entries.map(entry=>entry.id===editingId?{...entry,content:draft.trim()}:entry)
    onChange(next);setEditingId(null);setDraft('')
  }
  return <div className="memo-overlay"><button className="memo-scrim" onClick={onClose} aria-label="관리메모 닫기"/><section className="memo-modal" role="dialog" aria-modal="true" aria-label="고객 관리메모"><header><div><span>CARE HISTORY</span><h2>고객 관리 진행 내용</h2></div><p>접촉 내용과 다음 관리 계획을 기록하세요.</p><button onClick={onClose}><X size={18}/></button></header><div className="memo-customer"><div><small>고객명</small><strong>{lead.customerName}</strong></div><div><small>휴대폰 뒷자리</small><strong>{lead.phoneLast4}</strong></div><button className="btn primary" onClick={startNew}><Plus size={15}/>관리메모 추가</button></div>{entries.length===0&&editingId!=='new'?<div className="memo-empty"><Clock3/><strong>등록된 관리메모가 없습니다</strong><span>첫 접촉 내용을 기록해보세요.</span><button className="btn secondary" onClick={startNew}>첫 메모 작성</button></div>:<div className="memo-list">{entries.map((entry,index)=><article className="memo-row" key={entry.id}><div className="memo-round"><strong>{index+1}회차</strong><span>관리중</span></div><div className="memo-meta"><strong>{entry.manager}</strong><span>{formatDate(entry.date)}</span></div><div className="memo-content"><small>관리 내용</small><p>{entry.content}</p></div><button onClick={()=>startEdit(entry)}>내용 수정하기 →</button></article>)}</div>}{editingId&&<div className="memo-editor"><label>{editingId==='new'?'새 관리메모':'관리메모 수정'}<textarea autoFocus rows={4} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="고객 접촉 내용과 다음 계획을 입력하세요."/></label><div><button className="btn secondary" onClick={()=>setEditingId(null)}>취소</button><button className="btn primary" onClick={save}><Check size={15}/>메모 저장</button></div></div>}</section></div>
}

function SetupRequired() {
  return <div className="login-screen"><div className="login-card setup-card"><div className="login-logo"><div className="brand-mark">D5</div><div><strong>Partner Desk</strong><span>LG전자 플래그십 D5</span></div></div><p className="eyebrow">DEPLOYMENT SETUP</p><h1>운영 연결이 필요합니다</h1><p className="login-copy">고객정보 보호를 위해 데이터베이스가 연결되지 않은 배포에서는 화면을 열지 않습니다.</p><div className="setup-steps"><span>1</span><p>Vercel에 Firebase 웹 앱 환경변수를 등록하세요.</p><span>2</span><p>환경변수 등록 후 다시 배포하세요.</p></div></div></div>
}

function PasswordChangeScreen({onComplete}:{onComplete:()=>void}) {
  const [password,setPassword]=useState('')
  const [confirmPassword,setConfirmPassword]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const save=async(e:React.FormEvent)=>{
    e.preventDefault(); setError('')
    if(password.length<10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)){setError('영문과 숫자를 포함해 10자 이상 입력해주세요.');return}
    if(password!==confirmPassword){setError('새 비밀번호가 서로 일치하지 않습니다.');return}
    if(!auth?.currentUser || !db){setError('Firebase 연결을 확인해주세요.');return}
    setBusy(true)
    try {
      await updatePassword(auth.currentUser,password)
      const now=new Date().toISOString()
      await setDoc(doc(db,'profiles',auth.currentUser.uid),{mustChangePassword:false,passwordChangedAt:now,updatedAt:now},{merge:true})
      onComplete()
    } catch {
      setError('비밀번호를 변경하지 못했습니다. 다시 로그인한 후 시도해주세요.')
    } finally { setBusy(false) }
  }
  return <div className="login-screen"><div className="login-card"><div className="login-logo"><div className="brand-mark">D5</div><div><strong>Partner Desk</strong><span>LG전자 플래그십 D5</span></div></div><p className="eyebrow">FIRST LOGIN</p><h1>새 비밀번호 설정</h1><p className="login-copy">초기 비밀번호를 본인만 아는 비밀번호로 변경해주세요.</p><form onSubmit={save}><label>새 비밀번호<input type="password" autoComplete="new-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="영문·숫자 포함 10자 이상"/></label><label>새 비밀번호 확인<input type="password" autoComplete="new-password" required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="한 번 더 입력"/></label>{error&&<p className="login-error">{error}</p>}<button className="btn primary" disabled={busy}>{busy?'변경 중...':'비밀번호 변경'}</button><button type="button" className="btn secondary" onClick={()=>auth&&signOut(auth)}>다른 계정으로 로그인</button></form><div className="login-safe"><Sparkles size={15}/> 최초 로그인 보안 설정</div></div></div>
}
function LoginScreen() {
  const [loginId,setLoginId]=useState('')
  const [password,setPassword]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const login=async(e:React.FormEvent)=>{
    e.preventDefault(); setError(''); setBusy(true)
    if(!auth){setError('Firebase 연결이 필요합니다.');setBusy(false);return}
    const firebasePassword = password === loginId ? `D5${loginId}` : password
    try { await signInWithEmailAndPassword(auth, loginId+'@d5.local',firebasePassword) }
    catch { setError('접속번호 또는 비밀번호를 확인해주세요.') }
    setBusy(false)
  }
  return <div className="login-screen"><div className="login-card"><div className="login-logo"><div className="brand-mark">D5</div><div><strong>Partner Desk</strong><span>LG전자 플래그십 D5</span></div></div><p className="eyebrow">SECURE WORKSPACE</p><h1>D5 제휴고객 관리</h1><p className="login-copy">승인된 관리자와 매니저만 접속할 수 있습니다.</p><form onSubmit={login}><label>접속번호<input inputMode="numeric" required value={loginId} onChange={e=>setLoginId(e.target.value.replace(/\D/g,''))} placeholder="사번 또는 관리번호"/></label><label>비밀번호<input type="password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="비밀번호"/></label>{error&&<p className="login-error">{error}</p>}<button className="btn primary" disabled={busy}>{busy?'접속 중...':'로그인'}</button></form><div className="login-safe"><Sparkles size={15}/> Firebase 보안 인증</div></div></div>
}

