import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight, Building2, Check, CircleHelp, Clock3, Eye, EyeOff,
  LogOut, Menu, MoreHorizontal, Plus, Search,
  Settings, Sparkles, UserRound, UsersRound, X,
} from 'lucide-react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, type User } from 'firebase/auth'
import { collection, doc, getDoc, onSnapshot, query as firestoreQuery, runTransaction, setDoc, where, writeBatch, deleteField, increment } from 'firebase/firestore'
import { auth, db, isDemoMode, isFirebaseConfigured } from './lib/firebase'
import type { SeptemberAppointment } from './data/septemberAppointments'
import { ExecutiveDashboard } from './components/ExecutiveDashboard'
import { PartnerPreview } from './components/PartnerPreview'
import { PartnerPortal } from './components/PartnerPortal'
import { SettlementGuideModal } from './components/SettlementGuideModal'
import { buildPartnerPublication, IWEDDING_PARTNER_ID } from './lib/partnerPublication'
import { leadFromDocument } from './lib/leadDocument'
import { parseSeptemberSource } from './lib/septemberSource'
import { buildPartnerPreview, canPreviewPartner } from './lib/partnerPreview'
import { getDefaultExecutiveMonth, getExecutiveMonthLeads, getExecutiveMonths } from './lib/executiveMetrics'
import './AppView.css'
import { customerIdentityKey, maskCustomerName } from './lib/salesRaw'
import { canonicalPartnerName } from './lib/partners'
import { expectedRebateFor, isSubscriptionRebatePartner, lumpSumAmountFor, purchaseAmountSourceFor, salesRawAmountsFor, subscriptionRawAmountsFor, subscriptionAmountFor, totalPurchaseAmountFor } from './lib/salesFinance'
import { formatAmountInput, parseAmountInput } from './lib/amountInput'
import { customerDisplayLabel, customerDisplayName, phoneLast4Display } from './lib/customerDisplay'
import { buildCommissionSettlementMetrics, deliveryDateValidationMessage, expectedSettlementMonthFor } from './lib/commissionSettlement'
import { comparePurchaseAmounts, getVisiblePurchaseMembers, purchaseSortValue } from './lib/customerSorting'
import { buildSeptemberSyncPlan, canStartSeptemberSync, septemberExistingPatch } from './lib/septemberSync'
import { accountAccessError, checkedPartnerIdentity, SHARED_ACCOUNT_EMPLOYEE_NO, SHARED_ACCOUNT_MESSAGE } from './lib/accountAccess'
import { firebasePasswordForLogin, loginEmailFor, loginIdInputMessage, normalizeLoginId } from './lib/loginIdentity'
import { PARTNER_ACCOUNTS } from './lib/partnerIdentity'
import { loginFailureFor } from './lib/loginError'
import { STATUSES, type AppointmentType, type Lead, type LeadStatus, type MemoEntry, type PurchaseType, type VisitState } from './types'

type SortKey = 'customerName' | 'registeredAt' | 'partnerName' | 'manager' | 'visitDate' | 'status' | 'management' | 'updatedAt' | 'purchase'
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
const approvedStaff = [
  ...managers.map(member => ({ employeeNo: member.employeeNo, displayName: member.name, role: member.role === '지점장' ? 'store_manager' : member.role === '부지점장' ? 'assistant_manager' : 'manager' })),
]
type AppUser = { id: string; loginId: string; name: string; role: string; mustChangePassword: boolean; partnerId?: string; partnerName?: string }
type UsageRow = { userId: string; employeeNo: string; displayName: string; role: string; firstSeenAt: string; lastSeenAt: string; lastSeenDate: string; visitCount: number }
const appUserFromSession = (user: User): AppUser => ({
  id: user.uid,
  loginId: user.email?.split('@')[0]?.toUpperCase() || '',
  name: user.displayName || user.email?.split('@')[0] || 'D5 사용자',
  role: 'manager',
  mustChangePassword: false,
})
const roleLabel = (role: string) => ({ admin: '관리자', store_manager: '지점장', assistant_manager: '부지점장', manager: '매니저' }[role] || role)
const statusTone: Record<LeadStatus, string> = { 관리중: 'indigo', 구매완료: 'green', '상담 마감': 'violet', 취소: 'gray' }
const normalizeStatus = (value: string): LeadStatus => value === '구매완료' || value === '계약완료' ? '구매완료' : value === '상담마감' || value === '상담 마감' || value === '마감' ? '상담 마감' : value === '취소' || value === '종결' ? '취소' : '관리중'

const today = new Date().toISOString().slice(0, 10)
const blankLead = (): Lead => ({
  id: crypto.randomUUID(), registeredAt: today, customerName: '', phoneLast4: '', gender: '미입력',
  partnerName: '', appointmentType: '미선택', status: '관리중', visitState: '미정', purchaseType: '미선택', manager: '', updatedAt: new Date().toISOString(),
})
const maskName = maskCustomerName
const last4 = (value: string) => value.replace(/\D/g, '').slice(-4)
const formatDate = (date?: string) => date ? date.replaceAll('-', '.') : '—'
const formatDateTime = (value?: string) => value ? new Date(value).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '기록 없음'
const partnerKey = (value: string) => canonicalPartnerName(value).trim().toLowerCase().replace(/주식회사|\(주\)|㈜/g, '').replace(/[\s·._-]/g, '')
const formatWon = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const formatMonth = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`
const enteredAmountFor = (lead: Lead, kind: 'lumpSum' | 'subscription') => kind === 'lumpSum'
  ? lead.lumpSumAmount ?? (lead.purchaseType === '일시불' ? lead.purchaseAmount : undefined)
  : lead.subscriptionAmount ?? (lead.purchaseType === '구독' ? lead.purchaseAmount : undefined)
const hasEnteredAmount = (value?: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0
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
const contactKey = customerIdentityKey
const rawRevisionFor = (lead: Lead) => JSON.stringify([lead.salesRawPeriods, lead.subscriptionRawPeriods])
const assignmentRevisionFor = (lead: Lead) => JSON.stringify([lead.status, lead.manager, lead.managerEmployeeNo])
const hasDualIntake = (lead: Lead, rows: Lead[]) => {
  const types = new Set(rows.filter(item => contactKey(item.customerName, item.phoneLast4) === contactKey(lead.customerName, lead.phoneLast4)).map(item => item.appointmentType))
  return types.has('상담예약(이업종)') && types.has('이업종제휴')
}
type ReferralReadiness = { sessionKey: string; serverConfirmed: boolean }

export default function App() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'전체' | LeadStatus>('전체')
  const [managerFilter, setManagerFilter] = useState('전체 담당자')
  const [visitFilter, setVisitFilter] = useState<'전체' | VisitState>('전체')
  const [sort, setSort] = useState<{key: SortKey; direction: 'asc' | 'desc'}>({ key: 'registeredAt', direction: 'desc' })
  const [partnerFilter, setPartnerFilter] = useState('전체 제휴업체')
  const [chosenIntakeMonth, setChosenIntakeMonth] = useState('')
  const [workspaceView, setWorkspaceView] = useState<'staff' | 'partner'>('staff')
  const [previewPartner, setPreviewPartner] = useState('')
  const [active, setActive] = useState<Lead | null>(null)
  const [openMemoOnDrawer, setOpenMemoOnDrawer] = useState(false)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState('')
  const [currentUser, setCurrentUser] = useState<AppUser | null>(isDemoMode ? { id: 'demo', loginId: 'demo', name: 'D5 관리자', role: '데모 관리자', mustChangePassword: false } : null)
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured)
  const [authError, setAuthError] = useState('')
  const [dataReady, setDataReady] = useState(isDemoMode)
  const [dataError, setDataError] = useState('')
  const [serverConfirmed, setServerConfirmed] = useState(false)
  const [usageRows, setUsageRows] = useState<UsageRow[]>([])
  const [settlementGuideOpen, setSettlementGuideOpen] = useState(false)
  const closeSettlementGuide = useCallback(() => setSettlementGuideOpen(false), [])
  const [septemberSource, setSeptemberSource] = useState<readonly SeptemberAppointment[] | null>(null)
  const publishedRevision = useRef('')
  const referralReadiness = useRef<ReferralReadiness | null>(null)
  const septemberSyncRun = useRef<{ readiness: ReferralReadiness } | null>(null)
  const sessionKey = JSON.stringify([currentUser?.id, currentUser?.loginId, currentUser?.role, currentUser?.mustChangePassword, currentUser?.partnerId])
  const latestSessionKey = useRef(sessionKey)
  latestSessionKey.current = sessionKey
  const customerPanelRef = useRef<HTMLDivElement>(null)
  const customerHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!auth || !db) return
    const firestoreDb = db
    const firebaseAuth = auth
    let active = true
    let revision = 0
    const unsubscribe = onAuthStateChanged(firebaseAuth, async firebaseUser => {
      const currentRevision = ++revision
      const isCurrentSession = () => active && currentRevision === revision && firebaseAuth.currentUser?.uid === firebaseUser?.uid
      setCurrentUser(null)
      setLeads([])
      setUsageRows([])
      setSeptemberSource(null)
      setServerConfirmed(false)
      referralReadiness.current = null
      publishedRevision.current = ''
      setActive(null)
      setCreating(false)
      setQuery('')
      setManagerFilter('전체 담당자')
      setPartnerFilter('전체 제휴업체')
      setStatusFilter('전체')
      setVisitFilter('전체')
      setChosenIntakeMonth('')
      setWorkspaceView('staff')
      setPreviewPartner('')
      if (!firebaseUser) { setAuthReady(true); return }
      setAuthReady(false)
      const baseUser = appUserFromSession(firebaseUser)
      let denialMessage = ''
      try {
        if (baseUser.loginId === SHARED_ACCOUNT_EMPLOYEE_NO) {
          denialMessage = SHARED_ACCOUNT_MESSAGE
          throw new Error(denialMessage)
        }
        const profileRef = doc(firestoreDb, 'profiles', firebaseUser.uid)
        const profileSnapshot = await getDoc(profileRef)
        if (!isCurrentSession()) return
        const profile = profileSnapshot.exists() ? profileSnapshot.data() : undefined
        const accessError = accountAccessError(baseUser.loginId, profile)
        if (accessError) { denialMessage = accessError; throw new Error(accessError) }
        setAuthError('')
        const partner = checkedPartnerIdentity(baseUser.loginId, profile)
        setCurrentUser({ ...baseUser, name: String(profile?.displayName || baseUser.name), role: String(profile?.role), mustChangePassword: Boolean(profile?.mustChangePassword), ...(partner ? { partnerId: partner.partnerId, partnerName: partner.partnerName } : {}) })
      } catch {
        if (!isCurrentSession()) return
        setAuthError(denialMessage || '사용자 권한을 확인하지 못했습니다. 다시 로그인해주세요.')
        setCurrentUser(null)
        await signOut(firebaseAuth).catch(() => undefined)
      } finally {
        if (active && currentRevision === revision) setAuthReady(true)
      }
    })
    return () => { active = false; revision++; unsubscribe() }
  }, [])


  useEffect(() => {
    const readiness: ReferralReadiness = { sessionKey, serverConfirmed: false }
    referralReadiness.current = readiness
    septemberSyncRun.current = null
    setServerConfirmed(false)
    if (!db || !currentUser || currentUser.mustChangePassword || !canPreviewPartner(currentUser.role)) { setLeads([]); return }
    let active = true
    setDataReady(false); setDataError(''); setLeads([])
    const canReadAll = ['admin', 'store_manager', 'assistant_manager'].includes(currentUser.role)
    const referrals = collection(db, 'referrals')
    const request = canReadAll ? referrals : firestoreQuery(referrals, where('managerEmployeeNo', '==', currentUser.loginId))
    const unsubscribe = onSnapshot(request, { includeMetadataChanges: true }, snapshot => {
      if (!active) return
      readiness.serverConfirmed = !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites
      setServerConfirmed(readiness.serverConfirmed)
      setLeads(snapshot.docs.map(item => leadFromDocument(item.id, item.data())))
      setDataError(''); setDataReady(true)
    }, error => {
      if (!active) return
      readiness.serverConfirmed = false
      setServerConfirmed(false)
      setLeads([])
      setDataError(error instanceof Error ? error.message : '데이터를 동기화하지 못했습니다.')
      setDataReady(true)
    })
    return () => { active = false; readiness.serverConfirmed = false; unsubscribe() }
  }, [currentUser?.id, currentUser?.loginId, currentUser?.role, currentUser?.mustChangePassword])
  useEffect(() => {
    if (!db || !currentUser || currentUser.mustChangePassword || !canPreviewPartner(currentUser.role) || isDemoMode || currentUser.loginId === '12784') return
    const firestoreDb = db
    const recordUsage = async () => {
      const usageRef = doc(firestoreDb, 'usage', currentUser.id)
      const existing = await getDoc(usageRef)
      const now = new Date().toISOString()
      await setDoc(usageRef, {
        userId: currentUser.id,
        employeeNo: currentUser.loginId,
        displayName: currentUser.name,
        role: currentUser.role,
        lastSeenAt: now,
        lastSeenDate: today,
        visitCount: increment(1),
        ...(!existing.exists() ? { firstSeenAt: now } : {}),
      }, { merge: true })
    }
    recordUsage().catch(() => undefined)
  }, [currentUser?.id, currentUser?.role, currentUser?.loginId, currentUser?.mustChangePassword])

  useEffect(() => {
    setSeptemberSource(null)
    if (!db || !currentUser || currentUser.mustChangePassword || !['admin', 'store_manager', 'assistant_manager'].includes(currentUser.role)) return
    let active = true
    const ownSession = sessionKey
    getDoc(doc(db, 'adminSources', 'septemberAppointments')).then(snapshot => {
      if (!active || latestSessionKey.current !== ownSession) return
      const sources = snapshot.exists() ? parseSeptemberSource(snapshot.data()) : null
      if (sources) setSeptemberSource(sources)
      else setToast('보호된 9월 자료가 준비되지 않아 자동 갱신을 보류했습니다.')
    }).catch(() => { if (active && latestSessionKey.current === ownSession) setToast('9월 자료의 관리자 조회 권한을 확인해 주세요.') })
    return () => { active = false }
  }, [sessionKey])

  useEffect(() => {
    if (!db || !currentUser || !septemberSource || !canStartSeptemberSync({ role: currentUser.role, mustChangePassword: currentUser.mustChangePassword, dataReady, serverConfirmed, dataError, isDemoMode })) return
    const readiness = referralReadiness.current
    if (!readiness || !readiness.serverConfirmed || readiness.sessionKey !== sessionKey || septemberSyncRun.current?.readiness === readiness) return
    const run = { readiness }
    septemberSyncRun.current = run
    const firestoreDb = db
    const plan = buildSeptemberSyncPlan(septemberSource, leads)
    const currentById = new Map(leads.map(lead => [lead.id, lead]))
    const entries = plan.entries.filter(entry => {
      if (entry.kind === 'new') return true
      const existing = currentById.get(entry.targetId)
      if (!existing) return false
      const patch = septemberExistingPatch(entry.source, { ...existing })
      return patch !== null && Object.keys(patch).length > 0
    })
    const stopped = new Error('서버 연결이나 로그인 상태가 변경되어 RAW 갱신을 중단했습니다.')
    const assertReady = () => {
      if (referralReadiness.current !== readiness || !readiness.serverConfirmed || latestSessionKey.current !== readiness.sessionKey || auth?.currentUser?.uid !== currentUser.id) throw stopped
    }
    const syncSeptemberAppointments = async () => {
      const now = new Date().toISOString()
      let writes = 0
      for (const entry of entries) {
        assertReady()
        const { source, targetId, kind } = entry
        // Read the target again inside a transaction. A stale or empty list must
        // never turn an existing customer's manual fields into import defaults.
        const changed = await runTransaction(firestoreDb, async transaction => {
          assertReady()
          const target = doc(firestoreDb, 'referrals', targetId)
          const existing = await transaction.get(target)
          assertReady()
          if (existing.exists()) {
            const current = existing.data()
            const patch = septemberExistingPatch(source, current)
            if (!patch || !Object.keys(patch).length) return 0
            // UI normalization is not evidence for a legacy match. Recheck raw
            // type/date values if this target has no authoritative source link.
            if (current.appointmentSourceId !== source.sourceId && targetId !== `appointment-202609-${source.sourceId}`) {
              const freshPlan = buildSeptemberSyncPlan([source], [{ ...current, id: targetId } as Lead])
              if (!freshPlan.entries.some(entry => entry.kind === 'existing' && entry.targetId === targetId)) return 0
            }
            transaction.set(target, patch, { merge: true })
            return 1
          }
          // A record deleted after the snapshot must stay deleted.
          if (kind !== 'new') return 0
          transaction.set(target, {
            registeredAt: source.registeredAt,
            customerName: source.customerName,
            phoneLast4: source.phoneLast4,
            gender: '미입력',
            visitScheduledDate: source.visitScheduledDate || null,
            appointmentType: source.appointmentType,
            appointmentSourceId: source.sourceId,
            partnerName: source.partnerName || '제휴업체 확인 필요',
            billToCode: null,
            lgeSubchannel: '이업종_혼수(H)',
            manager: null,
            managerEmployeeNo: null,
            plannerName: null,
            status: source.appointmentStatus === '취소' ? '취소' : '관리중',
            visitState: source.appointmentStatus === '취소' ? '일정취소' : '방문',
            purchaseType: '미선택',
            purchaseAmount: null,
            lumpSumAmount: null,
            subscriptionAmount: null,
            note: null,
            memoHistory: [],
            createdBy: currentUser.id,
            createdAt: now,
            updatedBy: currentUser.id,
            updatedAt: now,
          })
          return 1
        })
        // Transaction callbacks may retry; count only the committed result.
        writes += changed
      }
      assertReady()
      setToast(plan.skipped > 0 ? `9월 약속 로우 ${writes}건 갱신 · 중복 또는 불일치 ${plan.skipped}건은 기존 기록 보호를 위해 제외했습니다.` : writes > 0 ? `9월 약속 로우 ${writes}건을 안전하게 갱신했습니다.` : '9월 약속 로우가 이미 최신 상태입니다.')
      window.setTimeout(() => setToast(''), 3200)
    }
    syncSeptemberAppointments().catch(error => {
      if (septemberSyncRun.current === run) septemberSyncRun.current = null
      if (error === stopped || latestSessionKey.current !== readiness.sessionKey) return
      setToast(`9월 로우를 갱신하지 못했습니다: ${error instanceof Error ? error.message : 'Firebase 오류'}`)
      window.setTimeout(() => setToast(''), 4200)
    })
  }, [currentUser?.id, currentUser?.role, currentUser?.mustChangePassword, dataReady, serverConfirmed, dataError, leads, septemberSource])

  useEffect(() => {
    if (!db || !currentUser || !['admin', 'store_manager', 'assistant_manager'].includes(currentUser.role) || currentUser.mustChangePassword || !dataReady || !serverConfirmed || dataError || isDemoMode) return
    const ownSession = sessionKey
    const firestoreDb = db
    const timer = window.setTimeout(async () => {
      if (latestSessionKey.current !== ownSession || auth?.currentUser?.uid !== currentUser.id || !referralReadiness.current?.serverConfirmed) return
      try {
        const publication = buildPartnerPublication(leads, IWEDDING_PARTNER_ID, new Date().toISOString())
        const content = JSON.stringify(publication.months)
        if (publishedRevision.current === content) return
        await setDoc(doc(firestoreDb, 'partnerViews', IWEDDING_PARTNER_ID), publication)
        if (latestSessionKey.current === ownSession) publishedRevision.current = content
      } catch {
        if (latestSessionKey.current === ownSession) setToast('업체 자료 게시본을 갱신하지 못했습니다. 관리자 권한을 확인해 주세요.')
      }
    }, 800)
    return () => window.clearTimeout(timer)
  }, [sessionKey, leads, dataReady, serverConfirmed, dataError])

  useEffect(() => {
    if (!db || !currentUser || currentUser.mustChangePassword || !canPreviewPartner(currentUser.role)) {
      setUsageRows([]); return
    }
    const unsubscribeUsage = onSnapshot(collection(db, 'usage'), snapshot => setUsageRows(snapshot.docs.map(item => item.data() as UsageRow)))
    return unsubscribeUsage
  }, [currentUser?.id, currentUser?.role, currentUser?.mustChangePassword])
  const partners = useMemo(() => [...new Set(leads.map(l => l.partnerName))].filter(Boolean), [leads])
  const previewPartners = useMemo(() => [...new Set(partners.map(canonicalPartnerName))].sort((a, b) => a.localeCompare(b, 'ko')), [partners])
  const intakeMonth = chosenIntakeMonth || getDefaultExecutiveMonth(leads, today)
  const intakeMonths = useMemo(() => [...new Set([today.slice(0, 7), intakeMonth, ...getExecutiveMonths(leads)])].sort().reverse(), [leads, intakeMonth])
  const intakeLeads = useMemo(() => getExecutiveMonthLeads(leads, intakeMonth), [leads, intakeMonth])
  const partnerPreviewAvailable = canPreviewPartner(currentUser?.role)
  const isPartnerPreview = partnerPreviewAvailable && workspaceView === 'partner'
  const partnerPreviewModel = useMemo(() => isPartnerPreview ? buildPartnerPreview(leads, previewPartner, intakeMonth) : null, [isPartnerPreview, leads, previewPartner, intakeMonth])
  const managerNames = useMemo(() => [...new Set([...managers.filter(m => m.role === '매니저').map(m => m.name), ...leads.flatMap(l => l.manager ? [l.manager] : [])])], [leads])
  const metricLeads = useMemo(() => getExecutiveMonthLeads(leads, intakeMonth, partnerFilter === '전체 제휴업체' ? undefined : partnerFilter), [leads, intakeMonth, partnerFilter])
  const latestRegisteredAt = useMemo(() => metricLeads.reduce((latest, lead) => lead.registeredAt > latest ? lead.registeredAt : latest, ''), [metricLeads])
  const filtered = useMemo(() => {
    const result = intakeLeads.filter(l => {
      const term = query.toLowerCase()
      const hit = !term || [customerDisplayLabel(l), phoneLast4Display(l.phoneLast4), l.partnerName, l.manager].some(v => v?.toLowerCase().includes(term))
      return hit
        && (statusFilter === '전체' || l.status === statusFilter)
        && (partnerFilter === '전체 제휴업체' || l.partnerName === partnerFilter)
        && (managerFilter === '전체 담당자' || (managerFilter === '미배정' ? !l.manager : l.manager === managerFilter))
        && (visitFilter === '전체' || l.visitState === visitFilter)
    })
    if (sort.key === 'purchase') {
      const amounts = new Map(result.map(lead => [lead.id, purchaseSortValue(lead, result)]))
      return result.sort((a, b) => comparePurchaseAmounts(amounts.get(a.id) ?? null, amounts.get(b.id) ?? null, sort.direction))
    }
    const stringSortKey = sort.key
    const value = (lead: Lead) => {
      const values: Record<Exclude<SortKey, 'purchase'>, string> = { customerName: lead.customerName, registeredAt: lead.registeredAt, partnerName: lead.partnerName, manager: lead.manager || '', visitDate: lead.visitScheduledDate || '', status: lead.status, management: memoEntriesFor(lead).at(-1)?.date || '', updatedAt: lead.updatedAt }
      return values[stringSortKey]
    }
    return result.sort((a, b) => value(a).localeCompare(value(b), 'ko', { numeric: true }) * (sort.direction === 'asc' ? 1 : -1))
  }, [intakeLeads, query, statusFilter, partnerFilter, managerFilter, visitFilter, sort])
  const visibleRows = useMemo(() => collapseCases(filtered), [filtered])
  const caseCount = useMemo(() => collapseCases(metricLeads).length, [metricLeads])
  const dateBefore = (days: number) => {
    const value = new Date()
    value.setHours(0, 0, 0, 0)
    value.setDate(value.getDate() - days)
    const offset = value.getTimezoneOffset() * 60000
    return new Date(value.getTime() - offset).toISOString().slice(0, 10)
  }
  const recent7Start = dateBefore(6)
  const recent30Start = dateBefore(29)
  const accessRows = useMemo(() => {
    const usageByEmployeeNo = new Map(usageRows.map(row => [row.employeeNo, row]))
    return approvedStaff.map(profile => ({ ...profile, usage: usageByEmployeeNo.get(profile.employeeNo) })).sort((a, b) => (b.usage?.lastSeenAt || '').localeCompare(a.usage?.lastSeenAt || '') || a.employeeNo.localeCompare(b.employeeNo, 'ko', { numeric: true }))
  }, [usageRows])
  const trackedUsageRows = useMemo(() => {
    const employeeNos = new Set(approvedStaff.map(profile => profile.employeeNo))
    return usageRows.filter(row => employeeNos.has(row.employeeNo))
  }, [usageRows])
  const profileCount = approvedStaff.length
  const loginExperienceCount = accessRows.filter(row => row.usage).length
  const recent7Users = trackedUsageRows.filter(row => row.lastSeenDate >= recent7Start).length
  const recent30Users = trackedUsageRows.filter(row => row.lastSeenDate >= recent30Start).length
  const totalLoginCount = trackedUsageRows.reduce((total, row) => total + (row.visitCount || 0), 0)
  const neverAccessedCount = Math.max(profileCount - loginExperienceCount, 0)
  const usageMessage = profileCount === 0
    ? '승인된 직원 명단을 확인하는 중입니다.'
    : recent7Users > 0
      ? `최근 7일 ${recent7Users}명이 접속했습니다. 기록 없음 ${neverAccessedCount}명을 확인해주세요.`
      : `저장된 접속 기록이 없습니다. 운영 배포 이후부터 실제 기록이 집계됩니다.`
  const canManageAll = Boolean(currentUser && ['admin', 'store_manager', 'assistant_manager', '데모 관리자'].includes(currentUser.role))

  const notify = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(''), 2800) }
  const resetCustomerFilters = () => { setQuery(''); setPartnerFilter('전체 제휴업체'); setManagerFilter('전체 담당자'); setStatusFilter('전체'); setVisitFilter('전체') }
  const openManagerView = (name: string) => {
    resetCustomerFilters()
    setManagerFilter(name)
    window.requestAnimationFrame(() => {
      customerPanelRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
      customerHeadingRef.current?.focus({ preventScroll: true })
    })
  }
  const selectedManager = managerFilter !== '전체 담당자' && managerFilter !== '미배정' ? managerFilter : null
  const sortBy = (key: SortKey) => setSort(current => ({ key, direction: current.key === key ? (current.direction === 'asc' ? 'desc' : 'asc') : key === 'purchase' ? 'desc' : 'asc' }))
  const saveLead = async (lead: Lead, linkTargetId?: string) => {
    const deliveryError = deliveryDateValidationMessage(lead)
    if (deliveryError) { notify(deliveryError); return }
    if (!creating) {
      const latest = leads.find(item => item.id === lead.id)
      const original = active?.id === lead.id ? active : lead
      if (!latest || (latest.updatedAt !== lead.updatedAt || latest.caseGroupId !== lead.caseGroupId || rawRevisionFor(latest) !== rawRevisionFor(lead) || assignmentRevisionFor(latest) !== assignmentRevisionFor(original))) {
        notify('다른 곳에서 고객 정보가 변경되었습니다. 상세 화면을 다시 열어 확인해주세요.')
        setActive(null)
        return
      }
    }
    const canonicalPartner = partners.find(partner => partnerKey(partner) === partnerKey(lead.partnerName))
    const linkTarget = linkTargetId ? leads.find(item => item.id === linkTargetId && item.id !== lead.id) : undefined
    if (linkTargetId && !linkTarget) { notify('연결할 기존 고객을 다시 선택해주세요.'); return }
    const caseGroupId = linkTarget ? linkTarget.caseGroupId || `case-${linkTarget.id}` : lead.caseGroupId
    const sanitized = { ...lead, caseGroupId, partnerName: canonicalPartnerName(canonicalPartner || lead.partnerName), customerName: maskName(lead.customerName), phoneLast4: last4(lead.phoneLast4), updatedAt: new Date().toISOString() }
    if (isFirebaseConfigured && db && currentUser) {
      const managerEmployeeNo = managers.find(manager => manager.name === sanitized.manager)?.employeeNo || null
      const payload = Object.fromEntries(Object.entries({
        registeredAt: sanitized.registeredAt, customerName: sanitized.customerName,
        phoneLast4: sanitized.phoneLast4, gender: sanitized.gender, visitScheduledDate: sanitized.visitScheduledDate || null,
        ...(sanitized.deliveryScheduledDate !== undefined ? { deliveryScheduledDate: sanitized.deliveryScheduledDate || null } : {}),
        appointmentType: sanitized.appointmentType || '미선택',
        partnerName: sanitized.partnerName, billToCode: sanitized.billToCode || null, lgeSubchannel: sanitized.lgeSubchannel || null,
        manager: sanitized.manager || null, managerEmployeeNo, plannerName: sanitized.plannerName || null,
        ...(caseGroupId ? { caseGroupId } : {}),
        status: sanitized.status, visitState: sanitized.visitState, purchaseType: sanitized.purchaseType || '미선택',
        purchaseAmount: hasEnteredAmount(enteredAmountFor(sanitized, 'lumpSum')) || hasEnteredAmount(enteredAmountFor(sanitized, 'subscription')) ? totalPurchaseAmountFor(sanitized) : null,
        lumpSumAmount: hasEnteredAmount(enteredAmountFor(sanitized, 'lumpSum')) ? lumpSumAmountFor(sanitized) : null,
        subscriptionAmount: hasEnteredAmount(enteredAmountFor(sanitized, 'subscription')) ? subscriptionAmountFor(sanitized) : null, note: sanitized.note || null, memoHistory: sanitized.memoHistory || [],
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
    if (!isFirebaseConfigured) setLeads(prev => {
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
    if (!isFirebaseConfigured) setLeads(prev => prev.map(item => ids.has(item.id) ? { ...item, caseGroupId: undefined } : item))
    setActive(null); setOpenMemoOnDrawer(false); notify('접수건 연결이 해제되었습니다')
  }
  if (!isFirebaseConfigured && !isDemoMode) return <SetupRequired/>
  if (!authReady) return <div className="loading-screen"><div className="brand-mark">D5</div><p>안전하게 연결하는 중...</p></div>
  if (!currentUser) return <LoginScreen accountError={authError} onLoginStart={() => setAuthError('')}/>
  if (currentUser.mustChangePassword) return <PasswordChangeScreen key={currentUser.id} onComplete={userId => setCurrentUser(user => user?.id === userId && auth?.currentUser?.uid === userId ? { ...user, mustChangePassword: false } : user)}/>
  if (currentUser.role === 'partner') return currentUser.partnerId ? <PartnerPortal userId={currentUser.id} loginId={currentUser.loginId} partnerId={currentUser.partnerId}/> : <div className="loading-screen"><p>업체 연결 정보를 확인해 주세요.</p><button onClick={() => auth && signOut(auth)}>로그아웃</button></div>
  if (!dataReady) return <div className="loading-screen"><div className="brand-mark">D5</div><p>안전하게 연결하는 중...</p></div>

  return <div className="app-shell">

    <main>
      <section className="content">
        <div className="page-heading"><div>{isDemoMode&&<div className="demo-notice"><span>DEMO</span><strong>데모 모드</strong><p>표시된 고객은 예시 데이터이며 변경사항은 운영 DB에 저장되지 않습니다.</p></div>}<p className="eyebrow">PARTNER REFERRAL CRM</p><h1>{isPartnerPreview ? '연결 고객, 한눈에.' : '좋은 인연을, 놓치지 않도록.'}</h1><p>{isPartnerPreview ? '업체별 고객 진행 현황과 예상 정산을 확인하세요.' : '제휴업체 소개 고객의 접수부터 방문, 상담, 계약까지 한곳에서 관리하세요.'}</p></div><div className="heading-actions"><button type="button" className="btn guide-button" aria-haspopup="dialog" aria-expanded={settlementGuideOpen} onClick={()=>setSettlementGuideOpen(true)}><CircleHelp size={16}/>제휴·정산 안내</button>{canManageAll && !isPartnerPreview ? <button className="btn primary" onClick={() => { setActive(blankLead()); setCreating(true); setOpenMemoOnDrawer(false) }}><Plus size={18}/>신규 고객 등록</button> : null}{isFirebaseConfigured&&<button className="btn secondary" onClick={()=>auth&&signOut(auth)}><LogOut size={16}/>로그아웃</button>}</div></div>

        {dataError&&<div className="data-alert"><CircleHelp size={18}/><div><strong>데이터를 불러오지 못했습니다.</strong><span>{dataError}</span></div><button onClick={()=>window.location.reload()}>다시 시도</button></div>}

        <div className="workspace-view-controls">
          {partnerPreviewAvailable ? <div className="workspace-view-switch" role="group" aria-label="조회 화면 선택">
            <button type="button" aria-pressed={!isPartnerPreview} onClick={() => { setWorkspaceView('staff'); setActive(null); setCreating(false); setOpenMemoOnDrawer(false) }}>직원 관리</button>
            <button type="button" aria-pressed={isPartnerPreview} onClick={() => { setWorkspaceView('partner'); setActive(null); setCreating(false); setOpenMemoOnDrawer(false) }}>업체 화면 미리보기</button>
          </div> : <strong>월별 고객 현황</strong>}
          <div className="workspace-period-controls">
            {isPartnerPreview ? <label>제휴업체<select aria-label="미리보기 제휴업체" value={previewPartner} onChange={event => setPreviewPartner(event.target.value)}><option value="">업체를 선택하세요</option>{previewPartners.map(partner => <option key={partner} value={partner}>{partner}</option>)}</select></label> : null}
            <label>접수월<select aria-label="공통 접수월" value={intakeMonth} onChange={event => setChosenIntakeMonth(event.target.value)}>{intakeMonths.map(month => <option key={month} value={month}>{formatMonth(month)}</option>)}</select></label>
          </div>
        </div>
        {isPartnerPreview ? <div className="partner-preview-workspace">
          <p className="partner-preview-notice">직원용 미리보기입니다. 실제 업체 계정 로그인은 아직 연결되지 않았습니다.</p>
          {partnerPreviewModel ? <PartnerPreview model={partnerPreviewModel}/> : null}
        </div> : <>
        <details className="metrics-panel">
          <summary className="metrics-toggle"><span className="metrics-toggle-mark" aria-hidden="true"/><strong>관리지표</strong><small>{formatMonth(intakeMonth)} · {partnerFilter === '전체 제휴업체' ? '전체 제휴업체' : partnerFilter} · 접수 {caseCount}건</small></summary>
          <div className="metrics-panel-body">
            <ExecutiveDashboard leads={leads} month={intakeMonth} partnerLabel={partnerFilter} onSelectLead={lead => { setActive(lead); setCreating(false); setOpenMemoOnDrawer(false) }} onSelectManager={openManagerView}/>
            {currentUser && <details className="usage-insight-details">
              <summary><i className="details-toggle-mark" aria-hidden="true"/><strong>직원 접속 기록</strong><span>기간 누적 · 접속 사용자 {loginExperienceCount}명</span></summary>
              <section className="usage-insight">
              <div className="usage-insight-title"><div><span>SITE ACCESS INSIGHT</span><h3>직원 접속 기록</h3></div><p>승인된 직원의 실제 로그인 기록만 보여줍니다.</p></div>
              <div className="usage-banner"><span>사용 흐름</span><strong>{usageMessage}</strong></div>
              <div className="usage-metrics">
                <UsageMetric label="로그인 기록" value={loginExperienceCount} suffix={`/${profileCount}명`} note="접속기록 기능 적용 이후 기준"/>
                <UsageMetric label="최근 7일 사용자" value={recent7Users} suffix="명" note="마지막 접속일 기준"/>
                <UsageMetric label="최근 30일 사용자" value={recent30Users} suffix="명" note="마지막 접속일 기준"/>
                <UsageMetric label="누적 로그인" value={totalLoginCount} suffix="회" note="기록 기능 적용 이후 합계"/>
              </div>
              <details className="access-log-details">
                <summary><i className="details-toggle-mark" aria-hidden="true"/><strong>사용자별 접속기록</strong><span>전체 {profileCount}명 · 기록 확인</span></summary>
                <div className="access-log-scroll"><table className="access-log-table"><thead><tr><th>사용자</th><th>사번</th><th>직책</th><th>최초 접속</th><th>최근 접속</th><th>접속 횟수</th></tr></thead><tbody>{accessRows.map(row=><tr key={row.employeeNo}><td>{row.displayName}</td><td>{row.employeeNo}</td><td>{roleLabel(row.role)}</td><td>{formatDateTime(row.usage?.firstSeenAt)}</td><td>{formatDateTime(row.usage?.lastSeenAt)}</td><td>{row.usage?.visitCount||0}회</td></tr>)}</tbody></table>{accessRows.length===0&&<p className="access-log-empty">승인된 사용자 정보를 불러오는 중입니다.</p>}</div>
              </details>
              </section>
            </details>}
          </div>
        </details>

        <div className="panel customer-panel" ref={customerPanelRef}>
          <div className="panel-head"><div><div className="customer-panel-title"><h2 ref={customerHeadingRef} tabIndex={-1}>{selectedManager ? `${selectedManager} 담당 고객` : '고객 접수 현황'}</h2>{selectedManager && <button type="button" className="manager-view-reset" onClick={resetCustomerFilters}>전체 담당자 보기</button>}</div><span>{formatMonth(intakeMonth)} 접수 기준 · {selectedManager ? `담당 접수 ${visibleRows.length}건 · 고객 ${filtered.length}명` : latestRegisteredAt ? `접수 ${caseCount}건 · 고객 ${metricLeads.length}명` : '등록된 고객이 없습니다'}</span></div><div className="panel-search search"><Search size={17}/><input aria-label="고객 검색" placeholder="고객명 또는 휴대폰 뒷자리 검색" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button type="button" aria-label="검색어 지우기" onClick={() => setQuery('')}><X size={15}/></button>}</div></div>
          <div className="filters">
            <label className="filter-field"><span>제휴업체</span><select aria-label="제휴업체 필터" value={partnerFilter} onChange={e => setPartnerFilter(e.target.value)}><option>전체 제휴업체</option>{partners.map(p => <option key={p}>{p}</option>)}</select></label>
            <label className="filter-field"><span>담당 매니저</span><select aria-label="담당 매니저 필터" value={managerFilter} onChange={e => setManagerFilter(e.target.value)}><option>전체 담당자</option><option>미배정</option>{managerNames.map(name => <option key={name}>{name}</option>)}</select></label>
            <label className="filter-field"><span>현재 상태</span><select aria-label="현재 상태 필터" value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}><option>전체</option>{STATUSES.map(status => <option key={status}>{status}</option>)}</select></label>
            <label className="filter-field"><span>방문 여부</span><select aria-label="방문 여부 필터" value={visitFilter} onChange={e => setVisitFilter(e.target.value as typeof visitFilter)}><option>전체</option><option>미정</option><option>예정</option><option>방문</option><option>미방문</option><option>일정취소</option></select></label>
          </div>
          <div className="filter-summary"><div className="active-filters">{!query && partnerFilter === '전체 제휴업체' && managerFilter === '전체 담당자' && statusFilter === '전체' && visitFilter === '전체' && <span className="filter-hint">선택한 접수월의 고객을 표시합니다</span>}{query && <button onClick={() => setQuery('')}>검색: {query}<X size={12}/></button>}{partnerFilter !== '전체 제휴업체' && <button onClick={() => setPartnerFilter('전체 제휴업체')}>{partnerFilter}<X size={12}/></button>}{managerFilter !== '전체 담당자' && <button onClick={() => setManagerFilter('전체 담당자')}>{managerFilter}<X size={12}/></button>}{statusFilter !== '전체' && <button onClick={() => setStatusFilter('전체')}>{statusFilter}<X size={12}/></button>}{visitFilter !== '전체' && <button onClick={() => setVisitFilter('전체')}>{visitFilter}<X size={12}/></button>}</div><div className="filter-result"><strong>{visibleRows.length}</strong>건 · 고객 {filtered.length}명{(query || partnerFilter !== '전체 제휴업체' || managerFilter !== '전체 담당자' || statusFilter !== '전체' || visitFilter !== '전체') && <button onClick={resetCustomerFilters}>전체 초기화</button>}</div></div>
          <div className="table-wrap"><table><thead><tr><th><SortHeader label="고객" column="customerName" sort={sort} onSort={sortBy}/></th><th><SortHeader label="등록일" column="registeredAt" sort={sort} onSort={sortBy}/></th><th><SortHeader label="제휴업체" column="partnerName" sort={sort} onSort={sortBy}/></th><th><SortHeader label="담당 매니저" column="manager" sort={sort} onSort={sortBy}/></th><th><SortHeader label="방문 일정" column="visitDate" sort={sort} onSort={sortBy}/></th><th><SortHeader label="현재 상태" column="status" sort={sort} onSort={sortBy}/></th><th aria-sort={sort.key === 'purchase' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><SortHeader label="구매 정보" column="purchase" sort={sort} onSort={sortBy}/></th><th><SortHeader label="관리 내용" column="management" sort={sort} onSort={sortBy}/></th><th/></tr></thead><tbody>{visibleRows.map(l => {
            // Financial totals use only members visible under the current access scope and filters.
            const members = getVisiblePurchaseMembers(l, filtered)
            return <tr key={l.id} onClick={() => { setActive(l); setCreating(false); setOpenMemoOnDrawer(false) }}><td><div className="customer"><span>{customerDisplayName(l.customerName).slice(0,1)}</span><div><strong className="customer-labels">{(l.caseGroupId ? members : [l]).map(member => <span key={member.id}>{customerDisplayLabel(member)}</span>)}</strong>{l.caseGroupId && <em className="case-badge">{leads.filter(member => member.caseGroupId === l.caseGroupId).length === 2 ? '신랑/신부' : '연결 고객 함께 관리'}</em>}<DuplicateIntakeHelp lead={l} leads={leads}/></div></div></td><td>{formatDate(l.registeredAt)}</td><td><div className="partner"><strong>{l.partnerName}</strong>{l.plannerName && <small>플래너 {l.plannerName}</small>}{l.appointmentType&&l.appointmentType!=='미선택'&&<em className="appointment-type">{l.appointmentType}</em>}</div></td><td>{l.manager ? <span className="manager"><i>{l.manager.slice(-2,-1)}</i>{l.manager}</span> : <span className="unassigned">미배정</span>}</td><td><div className="date-cell">{formatDate(l.visitScheduledDate)}<small>{l.visitState}</small></div></td><td><span className={`badge ${statusTone[l.status]}`}><i/>{l.status}</span></td><td><PurchaseSummary members={members}/></td><td><ManagementSummary lead={l} onOpen={()=>{setActive(l);setCreating(false);setOpenMemoOnDrawer(true)}}/></td><td><button className="more"><MoreHorizontal size={18}/></button></td></tr>
          })}</tbody></table>{visibleRows.length === 0 && <div className="empty"><Search/><h3>검색 결과가 없습니다</h3><p>필터나 검색어를 바꿔보세요.</p></div>}</div>
          <div className="panel-foot"><span>{formatMonth(intakeMonth)} · 접수 {visibleRows.length}건 · 고객 {filtered.length}명</span><span><i className="privacy-dot"/>민감정보 최소 수집 적용</span></div>
        </div>
        </>}
      </section>
    </main>

    {!isPartnerPreview && active && <LeadDrawer lead={active} linkedLeads={active.caseGroupId ? leads.filter(lead => lead.caseGroupId === active.caseGroupId) : []} allLeads={leads} onSelectLinked={setActive} partners={partners} creating={creating} canManageAll={canManageAll} openMemoInitially={openMemoOnDrawer} onClose={() => { setActive(null); setCreating(false); setOpenMemoOnDrawer(false) }} onSave={saveLead} onUnlink={unlinkCase} remoteChanged={!creating && Boolean(leads.find(item => item.id === active.id && (item.updatedAt !== active.updatedAt || item.caseGroupId !== active.caseGroupId || rawRevisionFor(item) !== rawRevisionFor(active) || assignmentRevisionFor(item) !== assignmentRevisionFor(active))))}/>}
    {settlementGuideOpen ? <SettlementGuideModal onClose={closeSettlementGuide}/> : null}
    {!isPartnerPreview && toast ? <div className="toast"><Check size={17}/>{toast}</div> : null}
  </div>
}

function SortHeader({label,column,sort,onSort}:{label:string,column:SortKey,sort:{key:SortKey;direction:'asc'|'desc'},onSort:(key:SortKey)=>void}) {
  const active = sort.key === column
  const nextDirection = active ? (sort.direction === 'asc' ? 'desc' : 'asc') : column === 'purchase' ? 'desc' : 'asc'
  return <button className={`sort-header ${active ? 'active' : ''}`} onClick={() => onSort(column)} aria-label={`${label} ${nextDirection === 'desc' ? '내림차순' : '오름차순'} 정렬`}>{label}<span>{active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>
}
function UsageMetric({label,value,suffix,note}:{label:string,value:number,suffix:string,note:string}) {
  return <div className="usage-metric"><span>{label}</span><strong>{value}<small>{suffix}</small></strong><p>{note}</p></div>
}

function PurchaseSummary({members}:{members:Lead[]}) {
  const uniqueMembers = [...new Map(members.map(member => [member.id, member])).values()]
  const rawByMember = uniqueMembers.map(member => salesRawAmountsFor(member))
  const subscriptionByMember = uniqueMembers.map(member => subscriptionRawAmountsFor(member))
  const total = uniqueMembers.reduce((sum, member) => sum + totalPurchaseAmountFor(member), 0)
  const expectedCommission = uniqueMembers.reduce((sum, member) => sum + expectedRebateFor(member), 0)
  const settlement = buildCommissionSettlementMetrics(uniqueMembers)
  const reserved = rawByMember.reduce((sum, raw) => sum + (raw.current ? raw.pending : 0), 0) + subscriptionByMember.reduce((sum, raw) => sum + (raw.current ? raw.pending : 0), 0)
  if (!total && !rawByMember.some(raw => raw.current) && !subscriptionByMember.some(raw => raw.current)) return <span className="purchase-empty">—</span>
  const manualAmount = uniqueMembers.some(member => (['lumpSum', 'subscription'] as const).some(kind => purchaseAmountSourceFor(member, kind).kind === 'manual' && purchaseAmountSourceFor(member, kind).amount > 0))
  const missingAppointmentType = uniqueMembers.some(member => (lumpSumAmountFor(member) > 0 || subscriptionAmountFor(member) > 0) && member.appointmentType !== '이업종제휴' && member.appointmentType !== '상담예약(이업종)' && (purchaseAmountSourceFor(member, 'lumpSum').kind === 'manual' || purchaseAmountSourceFor(member, 'subscription').kind === 'manual'))
  return <div className="purchase-summary"><span>{formatWon(total)}</span>{reserved > 0 && <em>예약·출하대기 {formatWon(reserved)} 포함</em>}<small>예상 제휴 수수료 총액 {formatWon(expectedCommission)}</small>{settlement.months.filter(row => row.expectedCommission > 0).map(row => <em className="purchase-settlement-known" key={row.month}>{row.month.replace('-', '.')} 중순 정산 예상 {formatWon(row.expectedCommission)}</em>)}{settlement.unscheduledCustomerCount > 0 ? <em>배송일 미입력 · 정산월 미정 {formatWon(settlement.unscheduledExpectedCommission)}</em> : null}{settlement.unfinishedExpectedCommission > 0 ? <em>구매완료 외 상태 {formatWon(settlement.unfinishedExpectedCommission)}</em> : null}{manualAmount && <em>수기 입력 반영</em>}{missingAppointmentType && <em>제휴 접수 유형 확인 필요</em>}</div>
}

function DuplicateIntakeHelp({lead,leads}:{lead:Lead,leads:Lead[]}) {
  if (!hasDualIntake(lead, leads)) return null
  return <span className="duplicate-intake-help" title="동일한 이름과 연락처가 상담예약(이업종)과 이업종제휴에 각각 접수되었습니다. 정산 확인을 위해 두 기록을 모두 유지합니다."><CircleHelp size={11}/>두 방식 중복 접수</span>
}


function ManagementSummary({lead,onOpen}:{lead:Lead,onOpen:()=>void}) {
  const entries = memoEntriesFor(lead)
  const visible = entries.slice(-2)
  const firstRound = entries.length - visible.length + 1
  return <div className="management-cell"><div className="management-actions">{visible.map((entry,index)=><button type="button" className="management-chip" key={entry.id} onClick={event=>{event.stopPropagation();onOpen()}}><span>✓ {firstRound+index}회차 · 관리</span><small>{formatDate(entry.date)}</small></button>)}<button type="button" className="management-add" onClick={event=>{event.stopPropagation();onOpen()}}>+ 관리 기록 추가</button></div></div>
}

function MoneyInput({label,kind,lead,onChange}:{label:string;kind:'lumpSum'|'subscription';lead:Lead;onChange:(value?:number)=>void}) {
  const value = enteredAmountFor(lead, kind)
  const source = purchaseAmountSourceFor(lead, kind)
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const descriptionId = `${kind}-amount-source`
  const sourceLabel = source.kind === 'raw' ? 'RAW 일치' : source.kind === 'manual' ? '수기 입력' : '미입력'
  const description = source.kind === 'raw'
    ? '현재 금액이 연결된 RAW 합계와 일치합니다. 같은 금액을 수기로 다시 입력한 과거 이력은 별도로 기록되지 않습니다.'
    : source.kind === 'manual' ? source.rawAmount === null ? 'RAW 자료와 연결되지 않은 직접 입력 내역입니다. 현재 입력한 금액을 사용합니다.' : `RAW ${formatWon(source.rawAmount)}과 다른 직접 입력 내역입니다. 현재 입력값을 우선 사용합니다.`
    : '원 단위 금액을 입력해주세요.'
  useEffect(() => { setInvalid(false); inputRef.current?.setCustomValidity('') }, [value])
  return <label className="money-field"><span className="money-label">{label}<small id={descriptionId} className={`amount-source ${source.kind}`} title={description}>{sourceLabel}</small></span><span className="money-input-wrap"><input ref={inputRef} aria-label={label} aria-describedby={descriptionId} aria-invalid={invalid} type="text" inputMode="numeric" autoComplete="off" placeholder="예: 3,000,000" value={formatAmountInput(value)} onChange={event => {
    const parsed = parseAmountInput(event.target.value)
    setInvalid(!parsed.valid)
    event.target.setCustomValidity(parsed.valid ? '' : '원 단위의 숫자 금액을 입력해주세요.')
    if (parsed.valid) onChange(parsed.value)
  }}/><span className="currency-unit" aria-hidden="true">원</span></span>{invalid && <small className="amount-input-error">원 단위 숫자로 입력해주세요.</small>}</label>
}

function CustomerNameField({ lead, creating, onChange }: { lead: Lead; creating: boolean; onChange: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const visibleValue = creating && editing ? lead.customerName : lead.customerName ? customerDisplayName(lead.customerName) : ''
  return <label className="customer-name-field">고객명 <small>보호 표시</small><input aria-label="고객명" required disabled={!creating} autoComplete="off" placeholder="전달받은 고객명 입력" value={visibleValue} onFocus={() => setEditing(creating)} onBlur={() => setEditing(false)} onChange={event => onChange(event.target.value)}/>{creating ? <small className="customer-name-help">등록 시 전달받은 이름을 입력해 주세요. 입력을 마치면 첫 글자만 표시합니다.</small> : null}</label>
}

function DeliveryScheduleField({ lead, onChange }: { lead: Lead; onChange: (date: string) => void }) {
  const settlementMonth = expectedSettlementMonthFor(lead)
  const deliveryError = deliveryDateValidationMessage(lead)
  return <label className="delivery-schedule-field">배송예정일 <small className="delivery-required">{lead.status === '구매완료' ? '필수 입력' : '구매완료 시 필수'}</small><input type="date" aria-label="배송예정일" aria-describedby="delivery-schedule-help" required={lead.status === '구매완료'} aria-invalid={Boolean(deliveryError && lead.deliveryScheduledDate)} value={lead.deliveryScheduledDate || ''} onChange={event => onChange(event.target.value)}/><small id="delivery-schedule-help" className={deliveryError ? 'delivery-schedule-help delivery-schedule-error' : 'delivery-schedule-help'}>{deliveryError || (settlementMonth ? `${settlementMonth.replace('-', '.')} 중순 정산 예상${lead.status === '구매완료' ? '' : ' · 구매완료 처리 후 월별 집계'}` : '배송예정월의 익익월 중순으로 예상 정산합니다.')}</small><small className="delivery-schedule-help">실제 정산은 제품 수령월 기준이며 예정일 변경 시 예상 정산월도 바뀝니다.</small></label>
}

function LeadDrawer({lead,linkedLeads,allLeads,onSelectLinked,partners,creating,canManageAll,openMemoInitially,onClose,onSave,onUnlink,remoteChanged}:{lead:Lead,linkedLeads:Lead[],allLeads:Lead[],onSelectLinked:(lead:Lead)=>void,partners:string[],creating:boolean,canManageAll:boolean,openMemoInitially:boolean,onClose:()=>void,onSave:(l:Lead,linkTargetId?:string)=>void,onUnlink:(lead:Lead)=>Promise<void>,remoteChanged:boolean}) {
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
  const linkChoices = allLeads.filter(item => item.id !== lead.id && [customerDisplayLabel(item), item.partnerName].some(value => value?.toLowerCase().includes(linkSearch.trim().toLowerCase()))).slice(0, 30)
  const unlinkSelected = async () => {
    const scope = linkedLeads.length === 2 ? '두 고객의 연결을 해제' : `${customerDisplayLabel(lead)} 고객만 이 접수건에서 분리`
    if (!window.confirm(`${scope}할까요? 고객별 담당자·상태·관리메모는 유지됩니다. 저장하지 않은 화면 수정사항은 사라집니다.`)) return
    setUnlinkBusy(true)
    await onUnlink(lead)
    setUnlinkBusy(false)
  }
  const memoEntries: MemoEntry[] = form.memoHistory || (form.note ? [{ id: 'legacy', date: form.updatedAt.slice(0,10), manager: form.manager || '미배정', content: form.note }] : [])
  const dualIntake = hasDualIntake(lead, allLeads)
  return <><button className="drawer-scrim" onClick={onClose}/><aside className="drawer">
    <div className="drawer-head"><div><span>{creating ? 'NEW REFERRAL' : 'CUSTOMER DETAIL'}</span><h2>{creating ? '신규 고객 등록' : `${customerDisplayLabel(lead)} 고객`}</h2></div><button onClick={onClose}><X/></button></div>
    {!creating && <div className="identity"><div>{customerDisplayName(lead.customerName).slice(0,1)}</div><section><strong>{customerDisplayLabel(lead)}</strong><span>고객 식별정보</span></section><span className={`badge ${statusTone[form.status]}`}><i/>{form.status}</span></div>}
    {dualIntake && <div className="duplicate-intake-notice"><CircleHelp size={17}/><div><strong>두 가지 접수 방식이 모두 확인됩니다.</strong><p>동일한 이름과 연락처가 `상담예약(이업종)`과 `이업종제휴`에 각각 등록되어 있습니다. 제휴 수수료 정산 확인을 위해 두 기록을 삭제하거나 합치지 않고 별도로 유지합니다.</p></div></div>}
    {linkedLeads.length > 1 && <div className="linked-case"><strong>{linkedLeads.length === 2 ? '신랑/신부' : '연결 고객 함께 관리'} · 고객 {linkedLeads.length}명</strong><p>고객별 상태와 관리 내용은 각각 저장됩니다.</p><div>{linkedLeads.map(member => <button type="button" className={member.id === lead.id ? 'active' : ''} key={member.id} onClick={() => onSelectLinked(member)}><span>{customerDisplayLabel(member)}</span><small>{member.status}</small></button>)}</div>{canManageAll && <button type="button" className="unlink-case" disabled={unlinkBusy} onClick={unlinkSelected}>{unlinkBusy ? '해제 중...' : linkedLeads.length === 2 ? '두 고객 연결 해제' : '이 고객만 연결 해제'}</button>}</div>}
    {remoteChanged && <div className="drawer-sync-warning">다른 사용자가 이 고객 정보를 변경했습니다. 화면을 닫고 다시 열어 최신 내용을 확인해주세요.</div>}
    <form onSubmit={e => {e.preventDefault(); if (linkExisting && !linkTargetId) return; onSave(form, linkExisting ? linkTargetId : undefined)}}>
      <fieldset><legend>기본 정보</legend><div className="form-grid">
        <label>등록일자<input type="date" required disabled={!creating} value={form.registeredAt} onChange={e=>update('registeredAt',e.target.value)}/></label>
        <label>성별<select disabled={!creating} value={form.gender} onChange={e=>update('gender',e.target.value)}><option>미입력</option><option>남</option><option>여</option></select></label>
        <CustomerNameField key={`${form.id}-customer-name`} lead={form} creating={creating} onChange={name=>update('customerName',name)}/>
        <label>휴대폰 뒷 4자리<input required disabled={!creating} inputMode="numeric" maxLength={4} pattern="[0-9]{4}" placeholder="4240" value={creating ? form.phoneLast4 : phoneLast4Display(form.phoneLast4)} onChange={e=>update('phoneLast4',last4(e.target.value))}/></label>
      </div></fieldset>
      <fieldset><legend>약속 유형</legend><label>접수 방식<select value={form.appointmentType||'미선택'} onChange={e=>update('appointmentType',e.target.value as AppointmentType)}><option value="미선택">미선택</option><option value="이업종제휴">이업종제휴</option><option value="상담예약(이업종)">상담예약(이업종)</option></select></label><div className="appointment-help">{form.appointmentType==='상담예약(이업종)'?'고객이 전용 URL을 통해 직접 접수한 상담입니다.':form.appointmentType==='이업종제휴'?'제휴업체가 고객을 매장에 직접 연결한 우선 접수 방식입니다.':'접수 경로에 맞는 약속 유형을 선택하세요.'}</div></fieldset>
      {canManageAll && (creating || !lead.caseGroupId) && <fieldset className="case-link-fieldset"><legend>같은 접수건 연결</legend><label className="case-link-check"><input type="checkbox" checked={linkExisting} onChange={e=>{setLinkExisting(e.target.checked);setLinkTargetId('')}}/><span>이 고객을 기존 접수건과 묶기</span></label><small>신랑·신부 등 같은 접수건은 목록과 접수건 수에서 1건으로 표시됩니다. 고객별 상태와 관리메모는 따로 유지됩니다.</small>{linkExisting && <div className="case-link-picker"><label>기존 고객 찾기<input placeholder="고객명·휴대폰 뒷자리·제휴업체 검색" value={linkSearch} onChange={e=>{setLinkSearch(e.target.value);setLinkTargetId('')}}/></label><label>연결할 고객<select required value={linkTargetId} onChange={e=>setLinkTargetId(e.target.value)}><option value="">고객을 선택하세요</option>{linkChoices.map(item=><option key={item.id} value={item.id}>{customerDisplayLabel(item)} · {item.partnerName} · {formatDate(item.registeredAt)}</option>)}</select></label></div>}</fieldset>}
      <fieldset><legend>제휴 정보</legend><label>BILL To Name · 제휴업체명<input required disabled={!creating} list="partner-options" autoComplete="off" placeholder="판매 로우의 제휴업체 검색 또는 신규 입력" value={form.partnerName} onChange={e=>update('partnerName',e.target.value)} onBlur={e=>{const match=partners.find(partner=>partnerKey(partner)===partnerKey(e.target.value));if(match)update('partnerName',match)}}/><datalist id="partner-options">{partnerSuggestions.map(partner=><option key={partner} value={partner}/>)}</datalist><small>비슷한 기존 업체가 먼저 표시되며, 목록에 없는 업체명도 신규 저장할 수 있습니다.</small></label><label>플래너명<input disabled={!creating} placeholder="선택 입력" value={form.plannerName||''} onChange={e=>update('plannerName',e.target.value)}/></label></fieldset>
      <fieldset><legend>일정 정보</legend><div className="form-grid"><label>매장방문 예정일<input type="date" value={form.visitScheduledDate||''} onChange={e=>update('visitScheduledDate',e.target.value)}/></label><DeliveryScheduleField lead={form} onChange={date=>update('deliveryScheduledDate',date)}/></div></fieldset>
      <fieldset><legend>구매 정보</legend><label>구매 방식<select value={form.purchaseType||'미선택'} onChange={e=>{const purchaseType=e.target.value as PurchaseType;setForm(current=>({...current,purchaseType,lumpSumAmount:purchaseType.includes('일시불')?lumpSumAmountFor(current):undefined,subscriptionAmount:purchaseType.includes('구독')?subscriptionAmountFor(current):undefined,purchaseAmount:undefined}))}}><option value="미선택">미선택</option><option value="일시불">일시불</option><option value="구독">구독</option><option value="일시불+구독">일시불+구독</option></select></label><div className="form-grid purchase-amount-grid">{form.purchaseType?.includes('일시불') && <MoneyInput key={`${form.id}-lumpSum`} label="일시불 금액" kind="lumpSum" lead={form} onChange={value=>setForm(current=>({...current,lumpSumAmount:value,purchaseAmount:undefined}))}/>} {form.purchaseType?.includes('구독') && <MoneyInput key={`${form.id}-subscription`} label="구독 금액" kind="subscription" lead={form} onChange={value=>setForm(current=>({...current,subscriptionAmount:value,purchaseAmount:undefined}))}/>}</div>{form.purchaseType&&form.purchaseType!=='미선택'&&<div className={`rebate-preview ${subscriptionAmountFor(form)>0&&!isSubscriptionRebatePartner(form.partnerName)?'ineligible':''}`}><span>예상 제휴 수수료</span><strong>{formatWon(expectedRebateFor(form))}</strong><small>RAW 일치 금액은 원본의 대상 판매경로를 적용하고, 직접 입력한 내역은 입력값을 기준으로 계산합니다. 실제 납품·연결 매장·정산은 별도 확인합니다.{subscriptionAmountFor(form)>0&&!isSubscriptionRebatePartner(form.partnerName)?' 구독 금액은 제휴 수수료 대상 업체에만 반영됩니다.':''}</small></div>}</fieldset>
      <fieldset><legend>진행 관리</legend><div className="form-grid"><label>담당 매니저<select disabled={!canManageAll} value={manualManager ? '__manual__' : form.manager||''} onChange={e=>{if(e.target.value==='__manual__'){setManualManager(true);update('manager','')}else{setManualManager(false);update('manager',e.target.value)}}}><option value="__manual__">직접입력</option><option value="">미배정</option>{managers.filter(m=>m.role==='매니저').map(m=><option key={m.employeeNo} value={m.name}>{m.name}</option>)}</select>{manualManager && canManageAll && <input className="manual-manager" autoFocus placeholder="담당자 이름 직접입력" value={form.manager||''} onChange={e=>update('manager',e.target.value)}/>}</label><label>현재 상태<select value={form.status} onChange={e=>update('status',e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></label><label>방문 여부<select value={form.visitState} onChange={e=>update('visitState',e.target.value as VisitState)}><option>미정</option><option>예정</option><option>방문</option><option>미방문</option><option>일정취소</option></select></label></div><button type="button" className="memo-open" onClick={()=>setMemoOpen(true)}><span><Clock3 size={18}/><b>관리메모</b></span><small>{memoEntries.length ? memoEntries.length+'건의 관리 이력' : '접촉 내용과 다음 계획을 기록하세요'}</small><i>보기 →</i></button></fieldset>
      <div className="drawer-actions"><button type="button" className="btn secondary" onClick={onClose}>취소</button><button className="btn primary" type="submit" disabled={remoteChanged}><Check size={17}/>{creating ? '고객 등록' : '변경사항 저장'}</button></div>
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
  return <div className="memo-overlay"><button className="memo-scrim" onClick={onClose} aria-label="관리메모 닫기"/><section className="memo-modal" role="dialog" aria-modal="true" aria-label="고객 관리메모"><header><div><span>CARE HISTORY</span><h2>고객 관리 진행 내용</h2></div><p>접촉 내용과 다음 관리 계획을 기록하세요.</p><button onClick={onClose}><X size={18}/></button></header><div className="memo-customer"><div><small>고객 식별정보</small><strong>{customerDisplayLabel(lead)}</strong></div><div><small>연락처 표시</small><strong>뒷 4자리만 표시</strong></div><button className="btn primary" onClick={startNew}><Plus size={15}/>관리메모 추가</button></div>{entries.length===0&&editingId!=='new'?<div className="memo-empty"><Clock3/><strong>등록된 관리메모가 없습니다</strong><span>첫 접촉 내용을 기록해보세요.</span><button className="btn secondary" onClick={startNew}>첫 메모 작성</button></div>:<div className="memo-list">{entries.map((entry,index)=><article className="memo-row" key={entry.id}><div className="memo-round"><strong>{index+1}회차</strong><span>관리중</span></div><div className="memo-meta"><strong>{entry.manager}</strong><span>{formatDate(entry.date)}</span></div><div className="memo-content"><small>관리 내용</small><p>{entry.content}</p></div><button onClick={()=>startEdit(entry)}>내용 수정하기 →</button></article>)}</div>}{editingId&&<div className="memo-editor"><label>{editingId==='new'?'새 관리메모':'관리메모 수정'}<textarea autoFocus rows={4} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="고객 접촉 내용과 다음 계획을 입력하세요."/></label><div><button className="btn secondary" onClick={()=>setEditingId(null)}>취소</button><button className="btn primary" onClick={save}><Check size={15}/>메모 저장</button></div></div>}</section></div>
}

function SetupRequired() {
  return <div className="login-screen"><div className="login-card setup-card"><div className="login-logo"><div className="brand-mark">D5</div><div><strong>Partner Desk</strong><span>LG전자 플래그십 D5</span></div></div><p className="eyebrow">DEPLOYMENT SETUP</p><h1>운영 연결이 필요합니다</h1><p className="login-copy">고객정보 보호를 위해 데이터베이스가 연결되지 않은 배포에서는 화면을 열지 않습니다.</p><div className="setup-steps"><span>1</span><p>Vercel에 Firebase 웹 앱 환경변수를 등록하세요.</p><span>2</span><p>환경변수 등록 후 다시 배포하세요.</p></div></div></div>
}

function PasswordChangeScreen({onComplete}:{onComplete:(userId:string)=>void}) {
  const [password,setPassword]=useState('')
  const [confirmPassword,setConfirmPassword]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const save=async(e:React.FormEvent)=>{
    e.preventDefault(); setError('')
    if (busy) return
    if(password.length<10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)){setError('영문과 숫자를 포함해 10자 이상 입력해주세요.');return}
    if(password!==confirmPassword){setError('새 비밀번호가 서로 일치하지 않습니다.');return}
    if(!auth?.currentUser || !db){setError('Firebase 연결을 확인해주세요.');return}
    const firebaseAuth = auth
    const targetUser = firebaseAuth.currentUser
    const firestoreDb = db
    if (!targetUser) return
    const sameSession = () => mounted.current && firebaseAuth.currentUser === targetUser
    setBusy(true)
    try {
      await updatePassword(targetUser,password)
      if (!sameSession()) return
      const now=new Date().toISOString()
      await setDoc(doc(firestoreDb,'profiles',targetUser.uid),{mustChangePassword:false,passwordChangedAt:now,updatedAt:now},{merge:true})
      if (!sameSession()) return
      setPassword(''); setConfirmPassword('')
      onComplete(targetUser.uid)
    } catch {
      if (sameSession()) setError('비밀번호를 변경하지 못했습니다. 다시 로그인한 후 시도해주세요.')
    } finally { if (mounted.current) setBusy(false) }
  }
  return <div className="login-screen"><div className="login-card"><div className="login-logo"><div className="brand-mark">D5</div><div><strong>Partner Desk</strong><span>LG전자 플래그십 D5</span></div></div><p className="eyebrow">FIRST LOGIN</p><h1>새 비밀번호 설정</h1><p className="login-copy">초기 비밀번호를 본인만 아는 비밀번호로 변경해주세요.</p><form onSubmit={save}><label>새 비밀번호<input type="password" autoComplete="new-password" required disabled={busy} value={password} onChange={e=>setPassword(e.target.value)} placeholder="영문·숫자 포함 10자 이상"/></label><label>새 비밀번호 확인<input type="password" autoComplete="new-password" required disabled={busy} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="한 번 더 입력"/></label>{error ? <p className="login-error" role="alert">{error}</p> : null}<button className="btn primary" disabled={busy}>{busy?'변경 중...':'비밀번호 변경'}</button><button type="button" className="btn secondary" disabled={busy} onClick={()=>auth&&signOut(auth)}>다른 계정으로 로그인</button></form><div className="login-safe"><Sparkles size={15}/> 최초 로그인 보안 설정</div></div></div>
}
function LoginScreen({accountError,onLoginStart}:{accountError:string;onLoginStart:()=>void}) {
  const loginIdInput = useRef<HTMLInputElement>(null)
  const [password,setPassword]=useState('')
  const [error,setError]=useState('')
  const [failureCode,setFailureCode]=useState<string | undefined>()
  const [showPassword,setShowPassword]=useState(false)
  const [busy,setBusy]=useState(false)
  const idComposing = useRef(false)
  const login=async(e:React.FormEvent)=>{
    e.preventDefault()
    if (busy || idComposing.current) return
    setError(''); setFailureCode(undefined); onLoginStart()
    const loginId = loginIdInput.current?.value || ''
    const inputMessage = loginIdInputMessage(loginId)
    if (inputMessage) { setError(inputMessage); return }
    const normalizedId = normalizeLoginId(loginId.trim())
    if(normalizedId===SHARED_ACCOUNT_EMPLOYEE_NO){setError(SHARED_ACCOUNT_MESSAGE);return}
    setBusy(true)
    if(!auth){setError('Firebase 연결이 필요합니다.');setBusy(false);return}
    const firebasePassword = firebasePasswordForLogin(normalizedId, password, [PARTNER_ACCOUNTS.iwedding.loginId])
    try { await signInWithEmailAndPassword(auth, loginEmailFor(normalizedId),firebasePassword) }
    catch (error) { const failure = loginFailureFor(error); setError(failure.message); setFailureCode(failure.code) }
    setBusy(false)
  }
  return <div className="login-screen"><div className="login-card"><div className="login-logo"><div className="brand-mark">D5</div><div><strong>Partner Desk</strong><span>LG전자 플래그십 D5</span></div></div><p className="eyebrow">SECURE WORKSPACE</p><h1>D5 제휴고객 관리</h1><p className="login-copy">ID와 비밀번호로 로그인해주세요.</p><form onSubmit={login}><label htmlFor="login-id">ID<input ref={loginIdInput} id="login-id" name="loginId" aria-label="ID" aria-describedby="login-id-help" type="text" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" required defaultValue="" onCompositionStart={() => { idComposing.current = true }} onCompositionEnd={() => { idComposing.current = false }} onBlur={() => { idComposing.current = false }} onKeyDown={event => { if (event.key === 'Enter' && (idComposing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault() }} placeholder="ID를 입력하세요"/><small id="login-id-help" className="login-id-help">ID는 영문·숫자이며 대소문자를 구분하지 않습니다.</small></label><label>비밀번호<input id="login-password" aria-label="비밀번호" type={showPassword ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="기존 비밀번호"/></label><div className="login-password-options"><span>현재 업체 임시 비밀번호는 E/e를 구분하지 않습니다.<br/>일반 비밀번호는 대소문자를 구분합니다.</span><button type="button" className="login-password-toggle" aria-controls="login-password" aria-pressed={showPassword} aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={14}/> : <Eye size={14}/>}<span>{showPassword ? '숨기기' : '보기'}</span></button></div>{(error||accountError) ? <p className="login-error" role="alert">{error||accountError}{error && failureCode ? <small className="login-error-code">{failureCode}</small> : null}</p> : null}<button className="btn primary" disabled={busy}>{busy?'접속 중...':'로그인'}</button></form><div className="login-safe"><Sparkles size={15}/> Firebase 보안 인증</div></div></div>
}

