import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight, Building2, Check, CircleHelp, Clock3, Eye, EyeOff,
  LogOut, Menu, MoreHorizontal, Plus, Search,
  Settings, Sparkles, UserRound, UsersRound, X,
} from 'lucide-react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, type User } from 'firebase/auth'
import { collection, doc, getDoc, onSnapshot, query as firestoreQuery, runTransaction, setDoc, where, increment } from 'firebase/firestore'
import { auth, db, isDemoMode, isFirebaseConfigured } from './lib/firebase'
import type { SeptemberAppointment } from './data/septemberAppointments'
import { ExecutiveDashboard } from './components/ExecutiveDashboard'
import { PartnerPreview } from './components/PartnerPreview'
import { PartnerPortal } from './components/PartnerPortal'
import { PartnerAccountsDialog } from './components/PartnerAccountsDialog'
import { SettlementGuideModal } from './components/SettlementGuideModal'
import { UpdateHistoryModal } from './components/UpdateHistoryModal'
import { NOVEMBER_D5_APPOINTMENTS_THROUGH } from './data/updateHistory'
import { CaseMergeChoiceModal, type CaseMergeChoice } from './components/CaseMergeChoiceModal'
import { CaseGroupSummary } from './components/CaseGroupSummary'
import { SalesChannelDetails, type SalesChannelRouteEdit } from './components/SalesChannelDetails'
import { saveSalesRouteCorrection } from './lib/salesRouteCorrectionSave'
import { canEditSalesRouteFor } from './lib/salesRouteCorrections'
import { SalesChannelReviewModal } from './components/SalesChannelReviewModal'
import { getSalesChannelReviewItems } from './lib/salesChannelReview'
import { SUBSCRIPTION_REVIEW_PARTNERS } from './lib/subscriptionPartners'
import { DeliveryScheduleField } from './components/DeliveryScheduleField'
import { PurchaseDates } from './components/PurchaseDates'
import { sortAccessRowsByVisits, type AccessCountDirection } from './lib/accessLogSorting'
import { buildPartnerPublication } from './lib/partnerPublication'
import { leadFromDocument } from './lib/leadDocument'
import { NOVEMBER_INVITATION_LABEL } from './lib/invitationCampaign'
import { parseSeptemberSource } from './lib/septemberSource'
import { buildPartnerPreview, canPreviewPartner, getPartnerPreviewMonths } from './lib/partnerPreview'
import { getDefaultExecutiveMonth, getExecutiveMonthLeads, getExecutiveMonths } from './lib/executiveMetrics'
import './AppView.css'
import { customerIdentityKey, maskCustomerName } from './lib/salesRaw'
import { getStoredSalesChannels } from './lib/salesChannels'
import { isApprovedSubscriptionReviewPartner } from './lib/salesChannelReview'
import { canonicalPartnerName } from './lib/partners'
import { commissionVerificationRequiredFor, expectedRebateFor, financialPendingAmountFor, isFinancialOwnerFor, isSubscriptionRebatePartner, lumpSumAmountFor, purchaseAmountSourceFor, salesRawAmountsFor, subscriptionRawAmountsFor, subscriptionAmountFor, totalPurchaseAmountFor } from './lib/salesFinance'
import { caseSharingDraftFor, caseSharingRevisionFor, resolveCaseSharing, type SharingBasis } from './lib/caseSharing'
import { caseBasisFor, caseBasisGroupsFor, financialCaseLeadFor, financialCaseLeadsFor } from './lib/caseBasis'
import { CaseSaveError, MAX_CASE_MEMBERS, caseLinkLeadFor, saveCaseCustomer, unlinkCaseCustomer } from './lib/caseSharingSave'
import { formatAmountInput, parseAmountInput } from './lib/amountInput'
import { allMemoEntriesFor, isBestCancellationMemo, managementMemoEntriesFor, memoEntriesForDisplay, memoHistoryRevisionFor } from './lib/memoHistory'
import { customerDisplayLabel, customerDisplayName, phoneLast4Display } from './lib/customerDisplay'
import { buildCommissionSettlementMetrics, deliveryDateValidationMessage } from './lib/commissionSettlement'
import { comparePurchaseAmounts, getVisiblePurchaseMembers, purchaseSortValue } from './lib/customerSorting'
import { buildCustomerCaseList } from './lib/customerCaseList'
import { buildSeptemberSyncPlan, canStartSeptemberSync, septemberExistingPatch } from './lib/septemberSync'
import { accountAccessError, checkedPartnerIdentity, SHARED_ACCOUNT_EMPLOYEE_NO, SHARED_ACCOUNT_MESSAGE } from './lib/accountAccess'
import { alternateSameIdPasswordForLogin, firebasePasswordForLogin, loginEmailFor, loginIdInputMessage, normalizeLoginId } from './lib/loginIdentity'
import { PARTNER_ACCOUNTS } from './lib/partnerIdentity'
import { loginFailureFor } from './lib/loginError'
import { STATUSES, type AppointmentType, type Lead, type LeadStatus, type MemoEntry, type PurchaseType, type VisitState } from './types'

type SortKey = 'customerName' | 'registeredAt' | 'partnerName' | 'manager' | 'visitDate' | 'status' | 'management' | 'updatedAt' | 'purchase'
type CaseEditorSaveOptions = { formBaseline: Lead; openingMembers: Lead[]; basis: SharingBasis }
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

const contactKey = customerIdentityKey
const rawRevisionFor = (lead: Lead) => JSON.stringify([lead.salesRawPeriods, lead.subscriptionRawPeriods])
const assignmentRevisionFor = (lead: Lead) => JSON.stringify([lead.status, lead.manager, lead.managerEmployeeNo])
const hasDualIntake = (lead: Lead, rows: Lead[]) => {
  const types = new Set(rows.filter(item => contactKey(item.customerName, item.phoneLast4) === contactKey(lead.customerName, lead.phoneLast4)).map(item => item.appointmentType))
  return types.has('상담예약(이업종)') && types.has('이업종제휴')
}
type ReferralReadiness = { sessionKey: string; serverConfirmed: boolean }
// Route displays and login alerts share the approved subscription commission scope.
const subscriptionReviewPartners = SUBSCRIPTION_REVIEW_PARTNERS

export default function App() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'전체' | LeadStatus>('전체')
  const [managerFilter, setManagerFilter] = useState('전체 담당자')
  const [visitFilter, setVisitFilter] = useState<'전체' | VisitState>('전체')
  const [sort, setSort] = useState<{key: SortKey; direction: 'asc' | 'desc'}>({ key: 'registeredAt', direction: 'desc' })
  const [partnerFilter, setPartnerFilter] = useState('전체 제휴업체')
  const [chosenIntakeMonth, setChosenIntakeMonth] = useState('')
  const [chosenPreviewMonth, setChosenPreviewMonth] = useState('')
  const [workspaceView, setWorkspaceView] = useState<'staff' | 'partner'>('staff')
  const [previewPartner, setPreviewPartner] = useState('')
  const [active, setActive] = useState<Lead | null>(null)
  const [openMemoOnDrawer, setOpenMemoOnDrawer] = useState(false)
  const [openSalesRouteLeadId, setOpenSalesRouteLeadId] = useState('')
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState('')
  const [currentUser, setCurrentUser] = useState<AppUser | null>(isDemoMode ? { id: 'demo', loginId: 'demo', name: 'D5 관리자', role: '데모 관리자', mustChangePassword: false } : null)
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured)
  const [authError, setAuthError] = useState('')
  const [dataReady, setDataReady] = useState(isDemoMode)
  const [dataError, setDataError] = useState('')
  const [serverConfirmed, setServerConfirmed] = useState(false)
  const [usageRows, setUsageRows] = useState<UsageRow[]>([])
  const [accessCountSort, setAccessCountSort] = useState<AccessCountDirection>(null)
  const [settlementGuideOpen, setSettlementGuideOpen] = useState(false)
  const [partnerAccountsOpen, setPartnerAccountsOpen] = useState(false)
  const closePartnerAccounts = useCallback(() => setPartnerAccountsOpen(false), [])
  const [updateHistoryOpen, setUpdateHistoryOpen] = useState(false)
  const closeUpdateHistory = useCallback(() => setUpdateHistoryOpen(false), [])
  const [salesReviewOpen, setSalesReviewOpen] = useState(false)
  const [salesReviewShownSession, setSalesReviewShownSession] = useState('')
  const closeSalesReview = useCallback(() => setSalesReviewOpen(false), [])
  const closeSettlementGuide = useCallback(() => setSettlementGuideOpen(false), [])
  const [septemberSource, setSeptemberSource] = useState<readonly SeptemberAppointment[] | null>(null)
  const publishedRevision = useRef(new Map<string, string>())
  const referralReadiness = useRef<ReferralReadiness | null>(null)
  const septemberSyncRun = useRef<{ readiness: ReferralReadiness } | null>(null)
  const sessionKey = JSON.stringify([currentUser?.id, currentUser?.loginId, currentUser?.role, currentUser?.mustChangePassword, currentUser?.partnerId])
  const latestSessionKey = useRef(sessionKey)
  latestSessionKey.current = sessionKey
  const salesReviewReady = Boolean(authReady && dataReady && serverConfirmed && !dataError && currentUser && !currentUser.mustChangePassword && canPreviewPartner(currentUser.role) && workspaceView === 'staff' && referralReadiness.current?.sessionKey === sessionKey && referralReadiness.current.serverConfirmed)
  const salesReviewItems = useMemo(() => salesReviewReady && currentUser ? getSalesChannelReviewItems(leads, { role: currentUser.role, employeeNo: currentUser.loginId, displayName: currentUser.name }, subscriptionReviewPartners) : [], [salesReviewReady, leads, currentUser?.role, currentUser?.loginId, currentUser?.name])
  useEffect(() => { setSalesReviewOpen(false); setSalesReviewShownSession(''); setUpdateHistoryOpen(false); setPartnerAccountsOpen(false) }, [sessionKey])
  useEffect(() => {
    if (!salesReviewReady || !salesReviewItems.length) { setSalesReviewOpen(false); return }
    if (salesReviewShownSession !== sessionKey) { setSalesReviewOpen(true); setSalesReviewShownSession(sessionKey) }
  }, [salesReviewReady, salesReviewItems.length, salesReviewShownSession, sessionKey])
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
      publishedRevision.current.clear()
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
      const publishedAt = new Date().toISOString()
      await Promise.all(Object.values(PARTNER_ACCOUNTS).map(async ({ partnerId }) => {
        try {
          const publication = buildPartnerPublication(leads, partnerId, publishedAt)
          const content = JSON.stringify(publication.months)
          if (publishedRevision.current.get(partnerId) === content) return
          await setDoc(doc(firestoreDb, 'partnerViews', partnerId), publication)
          if (latestSessionKey.current === ownSession) publishedRevision.current.set(partnerId, content)
        } catch {
          if (latestSessionKey.current === ownSession) setToast('업체 자료 게시본을 갱신하지 못했습니다. 관리자 권한을 확인해 주세요.')
        }
      }))
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
  const partners = useMemo(() => [...new Set(leads.map(l => canonicalPartnerName(l.partnerName)))].filter(Boolean), [leads])
  const previewPartners = useMemo(() => [...new Set(partners.map(canonicalPartnerName))].sort((a, b) => a.localeCompare(b, 'ko')), [partners])
  const intakeMonth = chosenIntakeMonth || getDefaultExecutiveMonth(leads, today)
  const intakeMonths = useMemo(() => [...new Set([today.slice(0, 7), intakeMonth, ...getExecutiveMonths(leads)])].sort().reverse(), [leads, intakeMonth])
  const intakeLeads = useMemo(() => getExecutiveMonthLeads(leads, intakeMonth), [leads, intakeMonth])
  const partnerPreviewAvailable = canPreviewPartner(currentUser?.role)
  const isPartnerPreview = partnerPreviewAvailable && workspaceView === 'partner'
  const partnerPreviewMonths = useMemo(() => getPartnerPreviewMonths(leads, previewPartner), [leads, previewPartner])
  const partnerPreviewMonth = partnerPreviewMonths.includes(chosenPreviewMonth) ? chosenPreviewMonth
    : partnerPreviewMonths.includes(intakeMonth) ? intakeMonth : partnerPreviewMonths[0] || today.slice(0, 7)
  const workspaceMonth = isPartnerPreview ? partnerPreviewMonth : intakeMonth
  const workspaceMonths = isPartnerPreview ? (partnerPreviewMonths.length ? partnerPreviewMonths : [partnerPreviewMonth]) : intakeMonths
  const partnerPreviewModel = useMemo(() => isPartnerPreview ? buildPartnerPreview(leads, previewPartner, partnerPreviewMonth) : null, [isPartnerPreview, leads, previewPartner, partnerPreviewMonth])
  const managerNames = useMemo(() => [...new Set([...managers.filter(m => m.role === '매니저').map(m => m.name), ...leads.flatMap(l => l.manager ? [l.manager] : [])])], [leads])
  const metricLeads = useMemo(() => getExecutiveMonthLeads(leads, intakeMonth, partnerFilter === '전체 제휴업체' ? undefined : partnerFilter), [leads, intakeMonth, partnerFilter])
  const latestRegisteredAt = useMemo(() => metricLeads.reduce((latest, lead) => lead.registeredAt > latest ? lead.registeredAt : latest, ''), [metricLeads])
  const intakePeriodLabel = !isDemoMode && intakeMonth === NOVEMBER_D5_APPOINTMENTS_THROUGH.slice(0, 7)
    && !leads.some(lead => lead.registeredAt.startsWith(intakeMonth) && lead.registeredAt > NOVEMBER_D5_APPOINTMENTS_THROUGH)
    ? `${formatDate(NOVEMBER_D5_APPOINTMENTS_THROUGH)} 접수분까지` : `${formatMonth(intakeMonth)} 접수 기준`
  const filteredModel = useMemo(() => {
    const model = buildCustomerCaseList(leads, intakeLeads, {
      query, status: statusFilter,
      partnerName: partnerFilter === '전체 제휴업체' ? undefined : partnerFilter,
      manager: managerFilter === '전체 담당자' ? undefined : managerFilter,
      visitState: visitFilter,
    })
    if (sort.key === 'purchase') {
      const amounts = new Map(model.rows.map(lead => [lead.id, purchaseSortValue(lead, model.members, leads)]))
      return { ...model, rows: model.rows.sort((a, b) => comparePurchaseAmounts(amounts.get(a.id) ?? null, amounts.get(b.id) ?? null, sort.direction)) }
    }
    const stringSortKey = sort.key
    const value = (lead: Lead) => {
      const values: Record<Exclude<SortKey, 'purchase'>, string> = { customerName: lead.customerName, registeredAt: lead.registeredAt, partnerName: lead.partnerName, manager: lead.manager || '', visitDate: lead.visitScheduledDate || '', status: lead.status, management: managementMemoEntriesFor(lead).at(-1)?.date || '', updatedAt: lead.updatedAt }
      return values[stringSortKey]
    }
    return { ...model, rows: model.rows.sort((a, b) => value(a).localeCompare(value(b), 'ko', { numeric: true }) * (sort.direction === 'asc' ? 1 : -1)) }
  }, [intakeLeads, leads, query, statusFilter, partnerFilter, managerFilter, visitFilter, sort])
  const filtered = filteredModel.members
  const visibleRows = filteredModel.rows
  const caseCount = useMemo(() => caseBasisGroupsFor(metricLeads).length, [metricLeads])
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
  const sortedAccessRows = useMemo(() => sortAccessRowsByVisits(accessRows, accessCountSort), [accessRows, accessCountSort])
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
  const canViewPartnerAccounts = Boolean(currentUser?.role === 'admin' && currentUser.loginId === '12784' && auth?.currentUser?.uid === currentUser.id)

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
  const saveLeadSalesRoute = async (leadId: string, edit: SalesChannelRouteEdit) => {
    const actor = currentUser
    if (!actor || !db || !dataReady || !serverConfirmed || dataError || creating || active?.id !== leadId) {
      throw new Error('최신 고객 정보를 불러온 뒤 다시 저장해주세요.')
    }
    const ownSession = sessionKey
    const correction = await saveSalesRouteCorrection(db, {
      ...edit, leadId, actorId: actor.id, actorEmployeeNo: actor.role === 'manager' ? actor.loginId : undefined,
      canManageAll, assertSession: () => {
        if (latestSessionKey.current !== ownSession || auth?.currentUser?.uid !== actor.id) throw new Error('로그인 상태가 변경되었습니다.')
      },
    })
    if (latestSessionKey.current !== ownSession) return
    setLeads(previous => previous.map(lead => lead.id === leadId && !lead.salesRouteCorrections?.some(entry => entry.id === correction.id)
      ? { ...lead, salesRouteCorrections: [...(lead.salesRouteCorrections ?? []), correction] } : lead))
    notify('판매경로를 저장했습니다.')
  }
  const saveLead = async (lead: Lead, linkTargetId?: string, options?: CaseEditorSaveOptions): Promise<boolean> => {
    const deliveryError = deliveryDateValidationMessage(lead)
    if (deliveryError) { notify(deliveryError); return false }
    const original = active?.id === lead.id ? active : lead
    const openingMembers = options?.openingMembers || (original.caseGroupId ? leads.filter(item => item.caseGroupId === original.caseGroupId) : [original])
    const formBaseline = options?.formBaseline || original
    const canonicalPartner = creating ? partners.find(partner => partnerKey(partner) === partnerKey(lead.partnerName)) : undefined
    const managerBasisId = options?.basis.caseLeadId || options?.basis.managerLeadId
    const managerBasis = managerBasisId ? openingMembers.find(item => item.id === managerBasisId) : undefined
    const managerEmployeeNo = !canManageAll ? original.managerEmployeeNo
      : lead.manager === formBaseline.manager ? formBaseline.managerEmployeeNo
        : managerBasis?.manager === lead.manager ? managerBasis?.managerEmployeeNo
          : managers.find(manager => manager.name === lead.manager)?.employeeNo
    const sanitized: Lead = {
      ...lead,
      ...(creating ? { partnerName: canonicalPartnerName(canonicalPartner || lead.partnerName), customerName: maskName(lead.customerName), phoneLast4: last4(lead.phoneLast4) } : {}),
      manager: !canManageAll ? original.manager : lead.manager,
      managerEmployeeNo,
    }
    try {
      if (isFirebaseConfigured) {
        if (!db || !currentUser || !dataReady || !serverConfirmed || dataError) throw new Error('서버 확인이 끝난 뒤 다시 저장해주세요.')
        const actor = currentUser
        const ownSession = sessionKey
        const result = await saveCaseCustomer(db, {
          original, draft: sanitized, formBaseline, openingMembers, creating, linkTargetId,
          actorId: actor.id, actorEmployeeNo: actor.loginId, canManageAll, basis: options?.basis,
          assertSession: () => {
            if (latestSessionKey.current !== ownSession || auth?.currentUser?.uid !== actor.id) throw new Error('로그인 상태가 변경되어 저장을 중단했습니다.')
          },
        })
        setActive(null); setCreating(false); setOpenMemoOnDrawer(false)
        notify(linkTargetId ? original.caseGroupId ? '고객을 묶음에 추가했습니다.' : '접수건이 연결되었습니다.' : result.shared ? '묶음 고객의 담당자·판매금액이 함께 저장되었습니다.' : '고객 정보가 저장되었습니다.')
        return true
      }
      const linkTarget = linkTargetId ? leads.find(item => item.id === linkTargetId) : undefined
      if (linkTargetId && !linkTarget) throw new Error('연결할 고객을 다시 선택해주세요.')
      const caseGroupId = original.caseGroupId || (linkTarget ? linkTarget.caseGroupId || `case-${linkTarget.id}` : undefined)
      const now = new Date().toISOString()
      if (caseGroupId) {
        const members = openingMembers
        for (const member of members) {
          const fresh = leads.find(item => item.id === member.id)
          if (fresh && caseSharingRevisionFor(fresh) !== caseSharingRevisionFor(member)) throw new Error('연결 고객이 변경되었습니다. 다시 열어 확인해주세요.')
        }
        const selected = linkTarget && !creating ? caseLinkLeadFor(original, sanitized, formBaseline) : sanitized
        const linkingMembers = members.map(member => ({
          ...(member.id === selected.id ? { ...selected, updatedAt: now } : member),
          caseGroupId, caseBasisLeadId: undefined, caseMergeMemberIds: undefined,
        }))
        const linkingSelected = linkingMembers.find(member => member.id === sanitized.id)!
        const plan = linkTarget ? options?.basis.caseLeadId
          ? resolveCaseSharing({ members: linkingMembers, original: linkingSelected, draft: linkingSelected, formBaseline: linkingSelected, caseGroupId, basis: options.basis, actorId: 'demo', now, canManageAll })
          : undefined
          : resolveCaseSharing({ members, original, draft: sanitized, formBaseline, caseGroupId, basis: options?.basis, actorId: 'demo', now, canManageAll })
        if (plan?.conflicts.length) throw new CaseSaveError('CASE_SAVE_CONFLICT', '기존 수기 값이 달라 기준 고객 선택이 필요합니다.', plan.conflicts)
        const linkedMembers = plan?.leads || linkingMembers
        const byId = new Map(linkedMembers.map(member => [member.id, { ...member, caseGroupId }]))
        setLeads(previous => {
          const updated = previous.map(member => byId.get(member.id) || member)
          return updated.some(member => member.id === sanitized.id) ? updated : [byId.get(sanitized.id)!, ...updated]
        })
      } else {
        setLeads(previous => previous.some(member => member.id === sanitized.id)
          ? previous.map(member => member.id === sanitized.id ? { ...sanitized, updatedAt: now } : member)
          : [{ ...sanitized, updatedAt: now }, ...previous])
      }
      setActive(null); setCreating(false); setOpenMemoOnDrawer(false); notify(linkTargetId ? original.caseGroupId ? '고객을 묶음에 추가했습니다.' : '접수건이 연결되었습니다.' : '고객 정보가 저장되었습니다.')
      return true
    } catch (error) {
      notify(error instanceof CaseSaveError || error instanceof Error && !isFirebaseConfigured ? error.message : '저장하지 못했습니다. 연결 고객의 변경 여부와 서버 권한을 확인해주세요.')
      return false
    }
  }
  const unlinkCase = async (lead: Lead, openingMembers?: Lead[]): Promise<boolean> => {
    if (!lead.caseGroupId || !canManageAll) return false
    const members = openingMembers || leads.filter(item => item.caseGroupId === lead.caseGroupId)
    if (members.length < 2) return false
    try {
      if (isFirebaseConfigured) {
        if (!db || !currentUser || !dataReady || !serverConfirmed || dataError) throw new Error('서버 확인이 끝난 뒤 다시 시도해주세요.')
        const actor = currentUser, ownSession = sessionKey
        await unlinkCaseCustomer(db, { lead, openingMembers: members, actorId: actor.id, canManageAll,
          assertSession: () => { if (latestSessionKey.current !== ownSession || auth?.currentUser?.uid !== actor.id) throw new Error('로그인 상태가 변경되었습니다.') },
        })
      } else {
        const toUnlink = members.length === 2 ? members : [lead]
        const ids = new Set(toUnlink.map(member => member.id))
        const remaining = members.filter(member => !ids.has(member.id))
        const remainingBasisId = remaining[0]?.caseBasisLeadId
        const retainBasis = Boolean(remainingBasisId && remaining.some(member => member.id === remainingBasisId)
          && remaining.every(member => member.caseBasisLeadId === remainingBasisId))
        const remainingIds = new Set(remaining.map(member => member.id))
        // Ownership is retained; splitting a shared display does not create new sales.
        setLeads(previous => previous.map(member => ids.has(member.id)
          ? { ...member, caseGroupId: undefined, caseBasisLeadId: undefined, caseMergeMemberIds: undefined }
          : remainingIds.has(member.id) ? { ...member, caseBasisLeadId: retainBasis ? member.caseBasisLeadId : undefined, caseMergeMemberIds: undefined } : member))
      }
      setActive(null); setOpenMemoOnDrawer(false); notify('접수건 연결이 해제되었습니다.')
      return true
    } catch (error) {
      notify(error instanceof CaseSaveError ? error.message : '연결을 해제하지 못했습니다. 최신 고객 정보를 확인해주세요.')
      return false
    }
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
        <div className="page-heading"><div>{isDemoMode&&<div className="demo-notice"><span>DEMO</span><strong>데모 모드</strong><p>표시된 고객은 예시 데이터이며 변경사항은 운영 DB에 저장되지 않습니다.</p></div>}<p className="eyebrow">PARTNER REFERRAL CRM</p><h1>{isPartnerPreview ? '연결 고객, 한눈에.' : '좋은 인연을, 놓치지 않도록.'}</h1><p>{isPartnerPreview ? '업체별 고객 진행 현황과 예상 정산을 확인하세요.' : '제휴업체 소개 고객의 접수부터 방문, 상담, 계약까지 한곳에서 관리하세요.'}</p></div><div className="heading-actions">{!isPartnerPreview && salesReviewReady && salesReviewItems.length > 0 ? <button type="button" className="btn sales-review-open" aria-haspopup="dialog" aria-expanded={salesReviewOpen} onClick={() => setSalesReviewOpen(true)}>판매경로 점검 {salesReviewItems.length}개</button> : null}{canViewPartnerAccounts && !isPartnerPreview ? <button type="button" className="btn secondary" aria-haspopup="dialog" aria-expanded={partnerAccountsOpen} onClick={() => setPartnerAccountsOpen(true)}><Building2 size={16}/>업체 계정</button> : null}<button type="button" className="btn secondary" aria-haspopup="dialog" aria-expanded={updateHistoryOpen} onClick={() => setUpdateHistoryOpen(true)}><Clock3 size={16}/>업데이트 내역</button><button type="button" className="btn guide-button" aria-haspopup="dialog" aria-expanded={settlementGuideOpen} onClick={()=>setSettlementGuideOpen(true)}><CircleHelp size={16}/>제휴·정산 안내</button>{canManageAll && !isPartnerPreview ? <button className="btn primary" onClick={() => { setActive(blankLead()); setCreating(true); setOpenMemoOnDrawer(false) }}><Plus size={18}/>신규 고객 등록</button> : null}{isFirebaseConfigured&&<button className="btn secondary" onClick={()=>auth&&signOut(auth)}><LogOut size={16}/>로그아웃</button>}</div></div>

        {dataError&&<div className="data-alert"><CircleHelp size={18}/><div><strong>데이터를 불러오지 못했습니다.</strong><span>{dataError}</span></div><button onClick={()=>window.location.reload()}>다시 시도</button></div>}

        <div className="workspace-view-controls">
          {partnerPreviewAvailable ? <div className="workspace-view-switch" role="group" aria-label="조회 화면 선택">
            <button type="button" aria-pressed={!isPartnerPreview} onClick={() => { setWorkspaceView('staff'); setActive(null); setCreating(false); setOpenMemoOnDrawer(false) }}>직원 관리</button>
            <button type="button" aria-pressed={isPartnerPreview} onClick={() => { setWorkspaceView('partner'); setActive(null); setCreating(false); setOpenMemoOnDrawer(false) }}>업체 화면 미리보기</button>
          </div> : <strong>월별 고객 현황</strong>}
          <div className="workspace-period-controls">
            {isPartnerPreview ? <label>제휴업체<select aria-label="미리보기 제휴업체" value={previewPartner} onChange={event => { setPreviewPartner(event.target.value); setChosenPreviewMonth('') }}><option value="">업체를 선택하세요</option>{previewPartners.map(partner => <option key={partner} value={partner}>{partner}</option>)}</select></label> : null}
            <label>접수월<select aria-label="공통 접수월" value={workspaceMonth} onChange={event => isPartnerPreview ? setChosenPreviewMonth(event.target.value) : setChosenIntakeMonth(event.target.value)}>{workspaceMonths.map(month => <option key={month} value={month}>{formatMonth(month)}</option>)}</select></label>
          </div>
        </div>
        {isPartnerPreview ? <div className="partner-preview-workspace">
          <p className="partner-preview-notice">직원용 업체 화면 미리보기입니다.</p>
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
                <div className="access-log-scroll"><table className="access-log-table"><thead><tr><th>사용자</th><th>사번</th><th>직책</th><th>최초 접속</th><th>최근 접속</th><th scope="col" aria-sort={accessCountSort === 'asc' ? 'ascending' : accessCountSort === 'desc' ? 'descending' : 'none'}><button type="button" className={`sort-header ${accessCountSort ? 'active' : ''}`} aria-label={`접속 횟수 ${accessCountSort === 'desc' ? '오름차순' : '내림차순'} 정렬`} onClick={() => setAccessCountSort(current => current === 'desc' ? 'asc' : 'desc')}>접속 횟수<span aria-hidden="true">{accessCountSort === 'asc' ? '↑' : accessCountSort === 'desc' ? '↓' : '↕'}</span></button></th></tr></thead><tbody>{sortedAccessRows.map(row=><tr key={row.employeeNo}><td>{row.displayName}</td><td>{row.employeeNo}</td><td>{roleLabel(row.role)}</td><td>{formatDateTime(row.usage?.firstSeenAt)}</td><td>{formatDateTime(row.usage?.lastSeenAt)}</td><td>{row.usage?.visitCount||0}회</td></tr>)}</tbody></table>{accessRows.length===0&&<p className="access-log-empty">승인된 사용자 정보를 불러오는 중입니다.</p>}</div>
              </details>
              </section>
            </details>}
          </div>
        </details>

        <div className="panel customer-panel" ref={customerPanelRef}>
          <div className="panel-head"><div><div className="customer-panel-title"><h2 ref={customerHeadingRef} tabIndex={-1}>{selectedManager ? `${selectedManager} 담당 고객` : '고객 접수 현황'}</h2>{selectedManager && <button type="button" className="manager-view-reset" onClick={resetCustomerFilters}>전체 담당자 보기</button>}</div><span>{intakePeriodLabel} · {selectedManager ? `담당 접수 ${visibleRows.length}건 · 고객 ${visibleRows.length}명` : latestRegisteredAt ? `접수 ${caseCount}건 · 고객 ${caseCount}명` : '등록된 고객이 없습니다'}</span></div><div className="panel-search search"><Search size={17}/><input aria-label="고객 검색" placeholder="고객명 또는 휴대폰 뒷자리 검색" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button type="button" aria-label="검색어 지우기" onClick={() => setQuery('')}><X size={15}/></button>}</div></div>
          <div className="filters">
            <label className="filter-field"><span>제휴업체</span><select aria-label="제휴업체 필터" value={partnerFilter} onChange={e => setPartnerFilter(e.target.value)}><option>전체 제휴업체</option>{partners.map(p => <option key={p}>{p}</option>)}</select></label>
            <label className="filter-field"><span>담당 매니저</span><select aria-label="담당 매니저 필터" value={managerFilter} onChange={e => setManagerFilter(e.target.value)}><option>전체 담당자</option><option>미배정</option>{managerNames.map(name => <option key={name}>{name}</option>)}</select></label>
            <label className="filter-field"><span>현재 상태</span><select aria-label="현재 상태 필터" value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}><option>전체</option>{STATUSES.map(status => <option key={status}>{status}</option>)}</select></label>
            <label className="filter-field"><span>방문 여부</span><select aria-label="방문 여부 필터" value={visitFilter} onChange={e => setVisitFilter(e.target.value as typeof visitFilter)}><option>전체</option><option>미정</option><option>예정</option><option>방문</option><option>미방문</option><option>일정취소</option></select></label>
          </div>
          <div className="filter-summary"><div className="active-filters">{!query && partnerFilter === '전체 제휴업체' && managerFilter === '전체 담당자' && statusFilter === '전체' && visitFilter === '전체' && <span className="filter-hint">선택한 접수월의 고객을 표시합니다</span>}{query && <button onClick={() => setQuery('')}>검색: {query}<X size={12}/></button>}{partnerFilter !== '전체 제휴업체' && <button onClick={() => setPartnerFilter('전체 제휴업체')}>{partnerFilter}<X size={12}/></button>}{managerFilter !== '전체 담당자' && <button onClick={() => setManagerFilter('전체 담당자')}>{managerFilter}<X size={12}/></button>}{statusFilter !== '전체' && <button onClick={() => setStatusFilter('전체')}>{statusFilter}<X size={12}/></button>}{visitFilter !== '전체' && <button onClick={() => setVisitFilter('전체')}>{visitFilter}<X size={12}/></button>}</div><div className="filter-result"><strong>{visibleRows.length}</strong>건 · 고객 {visibleRows.length}명{(query || partnerFilter !== '전체 제휴업체' || managerFilter !== '전체 담당자' || statusFilter !== '전체' || visitFilter !== '전체') && <button onClick={resetCustomerFilters}>전체 초기화</button>}</div></div>
          <div className="table-wrap"><table><thead><tr><th><SortHeader label="고객" column="customerName" sort={sort} onSort={sortBy}/></th><th><SortHeader label="등록일" column="registeredAt" sort={sort} onSort={sortBy}/></th><th><SortHeader label="제휴업체" column="partnerName" sort={sort} onSort={sortBy}/></th><th><SortHeader label="담당 매니저" column="manager" sort={sort} onSort={sortBy}/></th><th><SortHeader label="방문 일정" column="visitDate" sort={sort} onSort={sortBy}/></th><th><SortHeader label="현재 상태" column="status" sort={sort} onSort={sortBy}/></th><th aria-sort={sort.key === 'purchase' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><SortHeader label="구매 정보" column="purchase" sort={sort} onSort={sortBy}/></th><th><SortHeader label="관리 내용" column="management" sort={sort} onSort={sortBy}/></th><th/></tr></thead><tbody>{visibleRows.map(l => {
            // Financial totals use only members visible under the current access scope and filters.
            const members = getVisiblePurchaseMembers(l, filtered)
            return <tr key={l.id} onClick={() => { setActive(l); setCreating(false); setOpenMemoOnDrawer(false) }}><td><div className="customer"><span>{customerDisplayName(l.customerName).slice(0,1)}</span><div><strong className="customer-labels">{(l.caseGroupId ? members : [l]).map(member => <span key={member.id}>
              {customerDisplayLabel(member)}
              {member.invitationCampaign ? <em className="invitation-campaign-badge">{NOVEMBER_INVITATION_LABEL}</em> : null}
            </span>)}</strong>{l.caseGroupId && <em className="case-badge">{leads.filter(member => member.caseGroupId === l.caseGroupId).length === 2 ? '신랑/신부' : '연결 고객 함께 관리'}</em>}<DuplicateIntakeHelp lead={l} leads={leads}/></div></div></td><td>{formatDate(l.registeredAt)}</td><td><div className="partner"><strong>{l.partnerName}</strong>{l.plannerName && <small>플래너 {l.plannerName}</small>}{l.appointmentType&&l.appointmentType!=='미선택'&&<em className="appointment-type">{l.appointmentType}</em>}</div></td><td>{l.manager ? <span className="manager"><i>{l.manager.slice(-2,-1)}</i>{l.manager}</span> : <span className="unassigned">미배정</span>}</td><td><div className="date-cell">{formatDate(l.visitScheduledDate)}<small>{l.visitState}</small></div></td><td><span className={`badge ${filteredModel.excludedRowIds.has(l.id) ? 'gray' : statusTone[l.status]}`} title={filteredModel.excludedRowIds.has(l.id) ? `원본 상태: ${l.status}` : undefined}><i/>{filteredModel.excludedRowIds.has(l.id) ? '집계 제외' : l.status}</span></td><td>{l.status === '취소' ? <span className="purchase-empty">—</span> : <PurchaseSummary members={members} completeMembers={l.caseGroupId ? leads.filter(member => member.caseGroupId === l.caseGroupId) : [l]}/>}</td><td><ManagementSummary lead={l} members={l.caseGroupId ? leads.filter(member => member.caseGroupId === l.caseGroupId) : [l]} onOpenCancellation={member=>{setActive(member);setCreating(false);setOpenMemoOnDrawer(true)}} onOpen={()=>{setActive(l);setCreating(false);setOpenMemoOnDrawer(true)}}/></td><td><button className="more"><MoreHorizontal size={18}/></button></td></tr>
          })}</tbody></table>{visibleRows.length === 0 && <div className="empty"><Search/><h3>검색 결과가 없습니다</h3><p>필터나 검색어를 바꿔보세요.</p></div>}</div>
          <div className="panel-foot"><span>{formatMonth(intakeMonth)} · 접수 {visibleRows.length}건 · 고객 {visibleRows.length}명</span><span><i className="privacy-dot"/>민감정보 최소 수집 적용</span></div>
        </div>
        </>}
      </section>
    </main>

    {!isPartnerPreview && active && <LeadDrawer key={active.id} lead={active} linkedLeads={active.caseGroupId ? leads.filter(lead => lead.caseGroupId === active.caseGroupId) : []} allLeads={leads} onSelectLinked={member=>{setActive(member);setOpenMemoOnDrawer(false)}} partners={partners} creating={creating} canManageAll={canManageAll} openMemoInitially={openMemoOnDrawer}
      openSalesRouteInitially={openSalesRouteLeadId === active.id}
      onSaveSalesRoute={!creating && serverConfirmed && canEditSalesRouteFor(active, { canManageAll, employeeNo: currentUser.role === 'manager' ? currentUser.loginId : undefined })
        ? edit => saveLeadSalesRoute(active.id, edit) : undefined}
      onClose={() => { setActive(null); setCreating(false); setOpenMemoOnDrawer(false); setOpenSalesRouteLeadId('') }} onSave={saveLead} onUnlink={unlinkCase} remoteChanged={!creating && Boolean(leads.find(item => item.id === active.id && (item.updatedAt !== active.updatedAt || item.caseGroupId !== active.caseGroupId || rawRevisionFor(item) !== rawRevisionFor(active) || assignmentRevisionFor(item) !== assignmentRevisionFor(active) || memoHistoryRevisionFor(item) !== memoHistoryRevisionFor(active))))}/>}
    {settlementGuideOpen ? <SettlementGuideModal audience={isPartnerPreview ? 'partner' : 'staff'} onClose={closeSettlementGuide}/> : null}
    {canViewPartnerAccounts && !isPartnerPreview && partnerAccountsOpen ? <PartnerAccountsDialog onClose={closePartnerAccounts}/> : null}
    {updateHistoryOpen ? <UpdateHistoryModal onClose={closeUpdateHistory}/> : null}
    {salesReviewOpen && !updateHistoryOpen && !partnerAccountsOpen && salesReviewShownSession === sessionKey && salesReviewReady && salesReviewItems.length > 0 ? <SalesChannelReviewModal items={salesReviewItems} onClose={closeSalesReview} onSelectLead={leadId => { const lead = leads.find(item => item.id === leadId); if (!lead) return; setSalesReviewOpen(false); setActive(lead); setOpenSalesRouteLeadId(lead.id); setCreating(false); setOpenMemoOnDrawer(false) }}/> : null}
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

function PurchaseSummary({members,completeMembers}:{members:Lead[];completeMembers:Lead[]}) {
  const selection = caseBasisFor(completeMembers)
  const financial = financialCaseLeadFor(selection, completeMembers)
  const visibleBasis = financial && members.some(member => canonicalPartnerName(member.partnerName) === canonicalPartnerName(financial.partnerName)) ? financial : undefined
  if (selection.status === 'unresolved' || financial && !visibleBasis) return <div className="purchase-summary purchase-basis-required"><strong>기준 고객 선택 필요</strong><em>묶음 1명 · 금액·수수료 미합산</em></div>
  if (!visibleBasis || visibleBasis.status === '취소') return <span className="purchase-empty">—</span>
  const raw = salesRawAmountsFor(visibleBasis), subscription = subscriptionRawAmountsFor(visibleBasis)
  const total = totalPurchaseAmountFor(visibleBasis)
  const expectedCommission = expectedRebateFor(visibleBasis)
  const settlement = buildCommissionSettlementMetrics([visibleBasis])
  const reserved = financialPendingAmountFor(visibleBasis)
  if (!total && !raw.current && !subscription.current) return <span className="purchase-empty">—</span>
  const manualAmount = (['lumpSum', 'subscription'] as const).some(kind => purchaseAmountSourceFor(visibleBasis, kind).kind === 'manual' && purchaseAmountSourceFor(visibleBasis, kind).amount > 0)
  const verificationRequired = commissionVerificationRequiredFor(visibleBasis)
  const channelSources = selection.mergeMemberIds ? completeMembers.filter(member => selection.mergeMemberIds!.includes(member.id)) : [visibleBasis]
  const channels = channelSources.flatMap(member => getStoredSalesChannels(member).filter(row => row.kind === 'lumpSum' || isApprovedSubscriptionReviewPartner(member.partnerName, SUBSCRIPTION_REVIEW_PARTNERS)))
  const channelMismatch = channels.some(row => row.status === 'mismatch')
  const channelUnknown = channels.some(row => row.status === 'unverified')
  const missingAppointmentType = visibleBasis.appointmentType !== '이업종제휴' && visibleBasis.appointmentType !== '상담예약(이업종)' && manualAmount
  return <div className="purchase-summary"><span>{formatWon(total)}</span>{reserved > 0 && <em>예약·출하대기 {formatWon(reserved)} 포함</em>}<small>예상 제휴 수수료 {formatWon(expectedCommission)}</small>{channelMismatch && <em className="sales-channel-indicator mismatch">판매경로 불일치</em>}{channelUnknown && !verificationRequired && <em>판매경로 확인 필요</em>}{verificationRequired && <em>판매 원본 확인 필요</em>}{settlement.months.filter(row => row.expectedCommission > 0).map(row => <em className="purchase-settlement-known" key={row.month}>{row.month.replace('-', '.')} 중순 정산 예상 {formatWon(row.expectedCommission)}</em>)}{settlement.unscheduledCustomerCount > 0 ? <em>배송일 미입력 · 정산월 미정 {formatWon(settlement.unscheduledExpectedCommission)}</em> : null}{settlement.unfinishedExpectedCommission > 0 ? <em>기준 고객 구매완료 전 {formatWon(settlement.unfinishedExpectedCommission)}</em> : null}{completeMembers.length > 1 && <em>묶음 1명 · {selection.mergeMemberIds ? "구매금액 합산 · " : ""}{customerDisplayLabel(visibleBasis)} 기준 1회 반영</em>}{manualAmount && <em>수기 입력 반영</em>}{missingAppointmentType && <em>제휴 접수 유형 확인 필요</em>}</div>
}

function DuplicateIntakeHelp({lead,leads}:{lead:Lead,leads:Lead[]}) {
  if (!hasDualIntake(lead, leads)) return null
  return <span className="duplicate-intake-help" title="동일 고객의 두 접수 경로입니다. 정산 확인용 원본을 유지합니다."><CircleHelp size={11}/>두 방식 중복 접수</span>
}


function ManagementSummary({lead,members,onOpen,onOpenCancellation}:{lead:Lead;members:Lead[];onOpen:()=>void;onOpenCancellation:(member:Lead)=>void}) {
  const entries = managementMemoEntriesFor(lead)
  const visible = entries.slice(-2)
  const firstRound = entries.length - visible.length + 1
  const cancellationMembers = members.map(member => ({ member, count: memoEntriesForDisplay(allMemoEntriesFor(member)).filter(isBestCancellationMemo).length })).filter(item => item.count > 0)
  return <div className="management-cell"><div className="management-actions">{visible.map((entry,index)=><button type="button" className="management-chip" key={entry.id} onClick={event=>{event.stopPropagation();onOpen()}}><span>✓ {firstRound+index}회차 · 관리</span><small>{formatDate(entry.date)}</small></button>)}{cancellationMembers.map(({member,count})=><button type="button" className="management-chip management-cancellation" key={member.id} onClick={event=>{event.stopPropagation();onOpenCancellation(member)}}><span>주문 취소 기록 {count}건</span>{members.length > 1 ? <small>{customerDisplayLabel(member)}</small> : null}</button>)}<button type="button" className="management-add" onClick={event=>{event.stopPropagation();onOpen()}}>+ 관리 기록 추가</button></div></div>
}

function MoneyInput({label,kind,lead,onChange}:{label:string;kind:'lumpSum'|'subscription';lead:Lead;onChange:(value?:number)=>void}) {
  const value = enteredAmountFor(lead, kind)
  const source = purchaseAmountSourceFor(lead, kind)
  const shared = !isFinancialOwnerFor(lead, kind)
  const merged = Boolean(lead.caseMergeMemberIds?.length)
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const descriptionId = `${kind}-amount-source`
  const sourceLabel = merged ? '묶음 총액' : shared ? '묶음 공유' : source.kind === 'raw' ? 'BEST 기준' : source.kind === 'manual' ? '수기 입력' : '미입력'
  const description = merged ? '선택한 묶음 총액입니다. 수정 후 저장하면 함께 반영됩니다.' : shared ? '기준 고객의 금액을 함께 사용합니다.' : source.kind === 'raw'
    ? 'BEST 판매 금액과 일치합니다.'
    : source.kind === 'manual' ? source.rawAmount === null ? '직접 입력한 금액을 사용합니다.' : `원본 ${formatWon(source.rawAmount)} · 입력한 금액 우선`
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
  return <label className="customer-name-field">고객명 <small>보호 표시</small><input aria-label="고객명" required disabled={!creating} autoComplete="off" placeholder="전달받은 고객명 입력" value={visibleValue} onFocus={() => setEditing(creating)} onBlur={() => setEditing(false)} onChange={event => onChange(event.target.value)}/>{creating ? <small className="customer-name-help">입력 후 첫 글자만 표시됩니다.</small> : null}</label>
}


function LeadDrawer({lead,linkedLeads,allLeads,onSelectLinked,partners,creating,canManageAll,openMemoInitially,openSalesRouteInitially,onSaveSalesRoute,onClose,onSave,onUnlink,remoteChanged}:{lead:Lead,linkedLeads:Lead[],allLeads:Lead[],onSelectLinked:(lead:Lead)=>void,partners:string[],creating:boolean,canManageAll:boolean,openMemoInitially:boolean,openSalesRouteInitially:boolean,onSaveSalesRoute?:(edit:SalesChannelRouteEdit)=>Promise<void>,onClose:()=>void,onSave:(l:Lead,linkTargetId?:string,options?:CaseEditorSaveOptions)=>Promise<boolean>,onUnlink:(lead:Lead,openingMembers?:Lead[])=>Promise<boolean>,remoteChanged:boolean}) {
  // The parent keys the editor by customer id. These are immutable opening
  // baselines, not live props: a sibling update must not silently reset a draft.
  const [initial] = useState(() => {
    const members = linkedLeads.length > 1 ? linkedLeads : [lead]
    try { return { ...caseSharingDraftFor(lead, members), members, error: '' } }
    catch (error) { return { draft: lead, conflicts: [], members, error: error instanceof Error ? error.message : '공유 기준 고객을 확인해주세요.' } }
  })
  const [form, setForm] = useState(initial.draft)
  const [openingMembers, setOpeningMembers] = useState(initial.members)
  const formBaseline = useRef(initial.draft)
  const [basis, setBasis] = useState<SharingBasis>({})
  const [caseChoiceOpen, setCaseChoiceOpen] = useState(false)
  const closeCaseChoice = useCallback(() => setCaseChoiceOpen(false), [])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [manualManager, setManualManager] = useState(Boolean(initial.draft.manager && !managers.some(m => m.name === initial.draft.manager)))
  const [memoOpen, setMemoOpen] = useState(openMemoInitially)
  const [linkExisting, setLinkExisting] = useState(false)
  const [linkTargetId, setLinkTargetId] = useState('')
  const [linkSearch, setLinkSearch] = useState('')
  const [unlinkBusy, setUnlinkBusy] = useState(false)
  useEffect(() => { if (openMemoInitially) setMemoOpen(true) }, [openMemoInitially])
  const update = (key: keyof Lead, value: string) => setForm(f => ({...f,[key]:value}))
  const sharedMode = Boolean(lead.caseGroupId)
  const chooseLinkTarget = (id: string) => {
    setLinkTargetId(''); setBasis({}); setSaveError(''); setOpeningMembers(initial.members)
    if (!id) return
    const target = allLeads.find(member => member.id === id)
    if (!target || initial.members.some(member => member.id === id) || sharedMode && target.caseGroupId) return
    const linked = target.caseGroupId ? allLeads.filter(member => member.caseGroupId === target.caseGroupId) : [target]
    const members = [...initial.members, ...linked]
    if (members.length > MAX_CASE_MEMBERS) {
      setSaveError(`한 묶음에는 최대 ${MAX_CASE_MEMBERS}건까지 연결할 수 있습니다.`)
      return
    }
    setLinkTargetId(id); setOpeningMembers(members)
  }
  const startLink = () => {
    setLinkExisting(true); setLinkSearch(''); setSaveError('')
  }
  const cancelLink = () => {
    setLinkExisting(false); setLinkTargetId(''); setOpeningMembers(initial.members); setBasis({}); setSaveError('')
  }
  const previewCaseId = lead.caseGroupId || (linkTargetId ? allLeads.find(member => member.id === linkTargetId)?.caseGroupId || `case-${linkTargetId}` : `case-${lead.id}`)
  const linkingMode = linkExisting && Boolean(linkTargetId)
  const hasCaseChoice = sharedMode || linkingMode
  const choiceMembers = linkingMode ? openingMembers.map(member => member.id === lead.id
    ? creating ? form : caseLinkLeadFor(lead, form, formBaseline.current)
    : member) : openingMembers
  const mergeOverride = basis.mergePurchaseAmounts === undefined ? undefined : basis.mergePurchaseAmounts ? openingMembers.map(member => member.id).sort() : null
  let sharingPreview: ReturnType<typeof resolveCaseSharing> | undefined
  let sharingError = initial.error
  try { if (sharedMode && !linkingMode) sharingPreview = resolveCaseSharing({ members: openingMembers, original: lead, draft: form, formBaseline: formBaseline.current,
    caseGroupId: previewCaseId, basis, actorId: 'preview', now: new Date().toISOString(), canManageAll }) }
  catch (error) { sharingError = error instanceof Error ? error.message : '공유 기준 고객을 확인해주세요.' }
  const wholeCaseSelection = hasCaseChoice ? caseBasisFor(choiceMembers, basis.caseLeadId, mergeOverride) : undefined
  const openingGroupIds = new Set(openingMembers.flatMap(member => member.caseGroupId ? [member.caseGroupId] : []))
  const membershipChanged = [...openingGroupIds].some(groupId => {
    const expectedIds = openingMembers.filter(member => member.caseGroupId === groupId).map(member => member.id).sort()
    const currentIds = allLeads.filter(member => member.caseGroupId === groupId).map(member => member.id).sort()
    return JSON.stringify(currentIds) !== JSON.stringify(expectedIds)
  })
  const siblingChanged = openingMembers.some(member => {
    if (creating && member.id === lead.id) return false
    const fresh = allLeads.find(item => item.id === member.id)
    return !fresh || caseSharingRevisionFor(fresh) !== caseSharingRevisionFor(member)
  })
  const editorChanged = Boolean(remoteChanged || siblingChanged || membershipChanged)
  const chooseCaseBasis = (choice: CaseMergeChoice) => {
    if (editorChanged || saving) { setSaveError('고객 정보가 변경되어 선택을 적용하지 않았습니다. 다시 열어 확인해주세요.'); return }
    try {
      if (linkingMode) {
        setBasis(choice); setSaveError(''); closeCaseChoice(); return
      }
      const pendingEdits: Partial<Lead> = {}
      for (const key of ['manager', 'managerEmployeeNo', 'purchaseType', 'purchaseAmount', 'lumpSumAmount', 'subscriptionAmount'] as const) {
        if (JSON.stringify(form[key]) !== JSON.stringify(formBaseline.current[key])) Object.assign(pendingEdits, { [key]: form[key] })
      }
      const preview = caseSharingDraftFor(lead, openingMembers, choice.caseLeadId, choice.mergePurchaseAmounts)
      if (preview.conflicts.length) { setSaveError(preview.conflicts[0].message); return }
      const values: Partial<Lead> = {}
      for (const key of ['manager', 'managerEmployeeNo', 'purchaseType', 'purchaseAmount', 'lumpSumAmount', 'subscriptionAmount', 'lumpSumSourceId', 'subscriptionSourceId', 'caseBasisLeadId', 'caseMergeMemberIds'] as const) Object.assign(values, { [key]: preview.draft[key] })
      // Selecting a basis is not a money edit. Keep all personal fields and
      // original opening rows, and compare later edits to the chosen view.
      formBaseline.current = { ...formBaseline.current, ...values }
      setForm(current => ({ ...current, ...values, ...pendingEdits }))
      const manager = Object.prototype.hasOwnProperty.call(pendingEdits, 'manager') ? pendingEdits.manager : preview.draft.manager
      setManualManager(Boolean(manager && !managers.some(member => member.name === manager)))
      setBasis(choice); setSaveError(''); closeCaseChoice()
    } catch (error) { setSaveError(error instanceof Error ? error.message : '기준 고객을 확인해주세요.') }
  }
  const partnerSuggestions = useMemo(() => partners.map(partner => ({ partner, score: partnerMatchScore(partner, form.partnerName) })).filter(item => item.score > 0).sort((a,b) => b.score - a.score || a.partner.localeCompare(b.partner, 'ko')).slice(0, 12).map(item => item.partner), [partners, form.partnerName])
  const existingMemberIds = new Set(initial.members.map(member => member.id))
  const linkQuery = linkSearch.trim().toLowerCase()
  const linkChoices = linkExisting ? allLeads.filter(item => !existingMemberIds.has(item.id) && (!sharedMode || !item.caseGroupId)
    && (item.id === linkTargetId || [customerDisplayLabel(item), item.partnerName].some(value => value?.toLowerCase().includes(linkQuery))))
    .sort((left, right) => Number(right.id === linkTargetId) - Number(left.id === linkTargetId)).slice(0, 30) : []
  const linkPicker = linkExisting && <div className="case-link-picker">
    <label>기존 고객 찾기<input placeholder="고객명·휴대폰 뒷자리·제휴업체 검색" value={linkSearch} onChange={event => setLinkSearch(event.target.value)} disabled={saving || editorChanged}/></label>
    <label>{sharedMode ? '추가할 고객' : '연결할 고객'}<select aria-label={sharedMode ? '추가할 고객' : '연결할 고객'} required value={linkTargetId} onChange={event => chooseLinkTarget(event.target.value)} disabled={saving || editorChanged}>
      <option value="">{linkChoices.length ? '고객을 선택하세요' : '검색 결과가 없습니다'}</option>
      {linkChoices.map(item => <option key={item.id} value={item.id}>{customerDisplayLabel(item)} · {item.partnerName} · {formatDate(item.registeredAt)}{item.caseGroupId ? ' · 묶음' : ''}</option>)}
    </select></label>
    {sharedMode && <button type="button" className="btn secondary case-link-cancel" disabled={saving} onClick={cancelLink}>고객 추가 취소</button>}
  </div>
  const unlinkSelected = async () => {
    const scope = linkedLeads.length === 2 ? '두 고객의 연결을 해제' : `${customerDisplayLabel(lead)} 고객만 이 접수건에서 분리`
    if (!window.confirm(`${scope}할까요? 고객별 담당자·상태·관리메모는 유지됩니다. 저장하지 않은 화면 수정사항은 사라집니다.`)) return
    setUnlinkBusy(true)
    await onUnlink(lead, initial.members)
    setUnlinkBusy(false)
  }
  const memoEntries = allMemoEntriesFor(form)
  const managementMemoCount = managementMemoEntriesFor(form).length
  const cancellationMemoCount = memoEntriesForDisplay(memoEntries).filter(isBestCancellationMemo).length
  const linkingPreviewMembers = choiceMembers.map(member => ({ ...member, caseGroupId: previewCaseId, caseBasisLeadId: basis.caseLeadId, caseMergeMemberIds: mergeOverride || undefined }))
  const feePreviewMembers = linkingMode ? linkingPreviewMembers : sharedMode ? sharingPreview && !sharingPreview.conflicts.length ? sharingPreview.leads : openingMembers : [form]
  const previewBasisPending = hasCaseChoice && (!basis.caseLeadId && linkingMode || caseBasisFor(feePreviewMembers, basis.caseLeadId, mergeOverride).status === 'unresolved')
  const previewFinancialLeads = financialCaseLeadsFor(feePreviewMembers).filter(member => canonicalPartnerName(member.partnerName) === canonicalPartnerName(form.partnerName))
  const previewCommission = previewFinancialLeads.reduce((sum, member) => sum + expectedRebateFor(member), 0)
  const previewVerificationRequired = previewFinancialLeads.some(commissionVerificationRequiredFor)
  const caseFinancialEdited = (['manager', 'managerEmployeeNo', 'purchaseType', 'purchaseAmount', 'lumpSumAmount', 'subscriptionAmount'] as const).some(key => JSON.stringify(form[key]) !== JSON.stringify(formBaseline.current[key]))
  const needsCaseChoice = canManageAll && !basis.caseLeadId && (linkingMode || sharedMode && wholeCaseSelection?.status === 'unresolved' && caseFinancialEdited)
  const dualIntake = hasDualIntake(lead, allLeads)
  const salesRouteMembers = (hasCaseChoice ? openingMembers : [creating ? form : lead]).map(member => {
    const current = allLeads.find(item => item.id === member.id)
    return current ? { ...member, salesRouteCorrections: current.salesRouteCorrections } : member
  })
  return <><button className="drawer-scrim" onClick={onClose}/><aside className="drawer">
    <div className="drawer-head"><div><span>{creating ? 'NEW REFERRAL' : 'CUSTOMER DETAIL'}</span><h2>{creating ? '신규 고객 등록' : `${customerDisplayLabel(lead)} 고객`}</h2>
      {!creating && lead.invitationCampaign ? <em className="invitation-campaign-badge">{NOVEMBER_INVITATION_LABEL}</em> : null}
    </div><button onClick={onClose}><X/></button></div>
    {!creating && !hasCaseChoice && <div className="identity"><div>{customerDisplayName(lead.customerName).slice(0,1)}</div><section><strong>{customerDisplayLabel(lead)}</strong>{lead.bestCustomerNumber ? <small className="customer-best-number">고객번호 {lead.bestCustomerNumber}</small> : <span>고객 식별정보</span>}</section><span className={`badge ${statusTone[form.status]}`}><i/>{form.status}</span></div>}
    {dualIntake && <div className="duplicate-intake-notice"><CircleHelp size={17}/><div><strong>두 방식 중복 접수</strong><p>이업종제휴 · 상담예약(이업종)</p></div></div>}
    {editorChanged && <div className="drawer-sync-warning" role="alert">다른 사용자가 이 고객 또는 연결 고객 정보를 변경했습니다. 화면을 닫고 다시 열어 최신 내용을 확인해주세요.</div>}
    <form onSubmit={async e => {e.preventDefault(); if (saving || editorChanged || caseChoiceOpen || linkExisting && !linkTargetId) return; if (needsCaseChoice) { setCaseChoiceOpen(true); return } setSaving(true); setSaveError(''); try { const saved = await onSave(form, linkExisting ? linkTargetId : undefined, {formBaseline:formBaseline.current, openingMembers, basis}); if (!saved) setSaveError(sharedMode ? '저장하지 않았습니다. 기준 고객 선택과 최신 연결 정보를 확인해주세요.' : '저장하지 않았습니다. 최신 고객 정보와 연결 대상을 확인해주세요.') } finally {setSaving(false)}}}>
      {hasCaseChoice && <CaseGroupSummary key={lead.id} members={openingMembers} activeLeadId={lead.id}
        basisLabel={wholeCaseSelection?.basis ? customerDisplayLabel(wholeCaseSelection.basis) : undefined} basisLeadId={wholeCaseSelection?.basis?.id}
        amountMode={wholeCaseSelection?.status === 'unresolved' || linkingMode && !basis.caseLeadId ? 'pending' : wholeCaseSelection?.mergeMemberIds ? 'merged' : 'single'}
        pendingReason={wholeCaseSelection?.reason} staged={Boolean(basis.caseLeadId)} choiceOpen={caseChoiceOpen} disabled={saving || editorChanged || linkExisting && !linkTargetId}
        onChoose={canManageAll ? () => setCaseChoiceOpen(true) : undefined}
        onAddMember={canManageAll && sharedMode && !linkExisting && initial.members.length < MAX_CASE_MEMBERS ? startLink : undefined}
        onSelectMember={sharedMode && !linkExisting ? onSelectLinked : undefined}
        onUnlink={linkedLeads.length > 1 && canManageAll && !linkExisting ? unlinkSelected : undefined} unlinkBusy={unlinkBusy}>
        {openingMembers.map(member => <div className="case-original-record" key={member.id}><strong>{customerDisplayLabel(member)}</strong><small>접수일 <time dateTime={member.registeredAt}>{formatDate(member.registeredAt)}</time></small><span>일시불 {enteredAmountFor(member, 'lumpSum') === undefined ? '미입력' : formatWon(lumpSumAmountFor(member))} · 구독 {enteredAmountFor(member, 'subscription') === undefined ? '미입력' : formatWon(subscriptionAmountFor(member))}</span><small>담당자 {member.manager || '미배정'} · {member.status} · 배송 {formatDate(member.deliveryScheduledDate)}</small></div>)}
      </CaseGroupSummary>}
      {sharedMode && linkPicker}
      {(saveError || sharingError) && <p className="case-share-error" role="alert">{saveError || sharingError}</p>}
      <CaseSharingHistoryView lead={lead}/>
      <fieldset><legend>기본 정보</legend><div className="form-grid">
        <label>등록일자<input type="date" required disabled={!creating} value={form.registeredAt} onChange={e=>update('registeredAt',e.target.value)}/></label>
        <label>성별<select disabled={!creating} value={form.gender} onChange={e=>update('gender',e.target.value)}><option>미입력</option><option>남</option><option>여</option></select></label>
        <CustomerNameField key={`${form.id}-customer-name`} lead={form} creating={creating} onChange={name=>update('customerName',name)}/>
        <label>휴대폰 뒷 4자리<input required disabled={!creating} inputMode="numeric" maxLength={4} pattern="[0-9]{4}" placeholder="4240" value={creating ? form.phoneLast4 : phoneLast4Display(form.phoneLast4)} onChange={e=>update('phoneLast4',last4(e.target.value))}/></label>
      </div></fieldset>
      <fieldset><legend>약속 유형</legend><label>접수 방식<select value={form.appointmentType||'미선택'} onChange={e=>update('appointmentType',e.target.value as AppointmentType)}><option value="미선택">미선택</option><option value="이업종제휴">이업종제휴</option><option value="상담예약(이업종)">상담예약(이업종)</option></select></label><div className="appointment-help">{form.appointmentType==='상담예약(이업종)'?'고객 직접 접수':form.appointmentType==='이업종제휴'?'업체 소개 접수':'접수 방식을 선택하세요.'}</div></fieldset>
      {canManageAll && !sharedMode && <fieldset className="case-link-fieldset"><legend>같은 접수건 연결</legend>
        <label className="case-link-check"><input type="checkbox" checked={linkExisting} onChange={event => event.target.checked ? startLink() : cancelLink()}/><span>이 고객을 기존 접수건과 묶기</span></label>
        <small>묶음은 1건으로 집계합니다. 원본 기록은 유지됩니다.</small>{linkPicker}
      </fieldset>}
      <fieldset><legend>제휴 정보</legend><label>BILL To Name · 제휴업체명<input required disabled={!creating} list="partner-options" autoComplete="off" placeholder="판매 로우의 제휴업체 검색 또는 신규 입력" value={form.partnerName} onChange={e=>update('partnerName',e.target.value)} onBlur={e=>{const match=partners.find(partner=>partnerKey(partner)===partnerKey(e.target.value));if(match)update('partnerName',match)}}/><datalist id="partner-options">{partnerSuggestions.map(partner=><option key={partner} value={partner}/>)}</datalist><small>기존 업체 검색 또는 신규 입력</small></label><label>플래너명<input disabled={!creating} placeholder="선택 입력" value={form.plannerName||''} onChange={e=>update('plannerName',e.target.value)}/></label></fieldset>
      <fieldset><legend>일정 정보</legend><div className="form-grid"><label>매장방문 예정일<input type="date" value={form.visitScheduledDate||''} onChange={e=>update('visitScheduledDate',e.target.value)}/></label><DeliveryScheduleField lead={form} onChange={date=>update('deliveryScheduledDate',date)}/></div>{!creating ? <PurchaseDates lead={form}/> : null}</fieldset>
      <fieldset><legend>구매 정보</legend><label>구매 방식<select value={form.purchaseType||'미선택'} onChange={e=>{const purchaseType=e.target.value as PurchaseType;setForm(current=>({...current,purchaseType,lumpSumAmount:purchaseType.includes('일시불')?lumpSumAmountFor(current):undefined,subscriptionAmount:purchaseType.includes('구독')?subscriptionAmountFor(current):undefined,purchaseAmount:undefined}))}}><option value="미선택">미선택</option><option value="일시불">일시불</option><option value="구독">구독</option><option value="일시불+구독">일시불+구독</option></select></label><div className="form-grid purchase-amount-grid">{form.purchaseType?.includes('일시불') && <MoneyInput key={`${form.id}-lumpSum`} label="일시불 금액" kind="lumpSum" lead={form} onChange={value=>setForm(current=>({...current,lumpSumAmount:value,purchaseAmount:undefined}))}/>} {form.purchaseType?.includes('구독') && <MoneyInput key={`${form.id}-subscription`} label="구독 금액" kind="subscription" lead={form} onChange={value=>setForm(current=>({...current,subscriptionAmount:value,purchaseAmount:undefined}))}/>}</div>{form.purchaseType&&form.purchaseType!=='미선택'&&<div className={`rebate-preview ${subscriptionAmountFor(form)>0&&!isSubscriptionRebatePartner(form.partnerName)?'ineligible':''}`}><span>예상 제휴 수수료</span><strong>{previewBasisPending ? '기준 고객 선택 필요' : formatWon(previewCommission)}</strong><small>제휴 연결이 확인된 판매 원본을 반영합니다.{previewVerificationRequired ? ' 판매 원본 금액을 확인해주세요.' : ''}{subscriptionAmountFor(form)>0&&!isSubscriptionRebatePartner(form.partnerName)?' 구독은 대상 업체만 반영됩니다.':''}</small></div>}</fieldset>
      <SalesChannelDetails members={salesRouteMembers} editableLeadId={!remoteChanged && !saving && onSaveSalesRoute ? lead.id : undefined}
        onSaveRoute={onSaveSalesRoute} initiallyOpen={openSalesRouteInitially}/>
      <fieldset><legend>진행 관리</legend><div className="form-grid"><label>담당 매니저<select disabled={!canManageAll} value={manualManager ? '__manual__' : form.manager||''} onChange={e=>{if(e.target.value==='__manual__'){setManualManager(true);update('manager','')}else{setManualManager(false);update('manager',e.target.value)}}}><option value="__manual__">직접입력</option><option value="">미배정</option>{managers.filter(m=>m.role==='매니저').map(m=><option key={m.employeeNo} value={m.name}>{m.name}</option>)}</select>{manualManager && canManageAll && <input className="manual-manager" autoFocus placeholder="담당자 이름 직접입력" value={form.manager||''} onChange={e=>update('manager',e.target.value)}/>}</label><label>현재 상태<select value={form.status} onChange={e=>update('status',e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></label><label>방문 여부<select value={form.visitState} onChange={e=>update('visitState',e.target.value as VisitState)}><option>미정</option><option>예정</option><option>방문</option><option>미방문</option><option>일정취소</option></select></label></div><button type="button" className="memo-open" onClick={()=>setMemoOpen(true)}><span><Clock3 size={18}/><b>관리메모</b></span><small>{cancellationMemoCount ? '관리 '+managementMemoCount+'건 · 주문 취소 '+cancellationMemoCount+'건' : managementMemoCount ? managementMemoCount+'건의 관리 이력' : '접촉 내용과 다음 계획을 기록하세요'}</small><i>보기 →</i></button></fieldset>
      <div className="drawer-actions"><button type="button" className="btn secondary" onClick={onClose}>취소</button><button className="btn primary" type="submit" disabled={editorChanged || saving || unlinkBusy}><Check size={17}/>{saving ? '저장 중...' : creating ? '고객 등록' : '변경사항 저장'}</button></div>
    </form>
  </aside>{caseChoiceOpen && <CaseMergeChoiceModal members={choiceMembers} initialBasisId={basis.caseLeadId || lead.caseBasisLeadId || lead.id} initialMergeMemberIds={wholeCaseSelection?.mergeMemberIds} disabled={editorChanged || saving || !canManageAll} onClose={closeCaseChoice} onConfirm={chooseCaseBasis}/>}
  {memoOpen&&<MemoModal lead={form} manager={form.manager||'미배정'} entries={memoEntries} onChange={entries=>setForm(f=>({...f,memoHistory:entries,note:entries.filter(entry=>!isBestCancellationMemo(entry)).at(-1)?.content??f.note}))} onClose={()=>setMemoOpen(false)}/>}</>
}

function CaseSharingHistoryView({lead}:{lead:Lead}) {
  if (!lead.caseSharingHistory?.length) return null
  return <details className="case-sharing-history"><summary>기준·공유 변경 이력 · 보존된 수기 값 {lead.caseSharingHistory.length}건</summary><p>공유 전에 저장되어 있던 금액과 담당자를 보관합니다.</p>{lead.caseSharingHistory.map((entry,index)=>{
    const previous = entry.previous
    const lumpSum = previous.lumpSumAmount ?? (previous.purchaseType === '일시불' ? previous.purchaseAmount : undefined)
    const subscription = previous.subscriptionAmount ?? (previous.purchaseType === '구독' ? previous.purchaseAmount : undefined)
    return <div key={`${entry.at}-${index}`}><small>{formatDateTime(entry.at)}</small><span>담당자 {previous.manager || '미배정'}</span><span>일시불 {lumpSum === undefined ? '미입력' : formatWon(lumpSum)} · 구독 {subscription === undefined ? '미입력' : formatWon(subscription)}</span></div>
  })}</details>
}

function MemoModal({lead,manager,entries,onChange,onClose}:{lead:Lead,manager:string,entries:MemoEntry[],onChange:(entries:MemoEntry[])=>void,onClose:()=>void}) {
  const [editingId,setEditingId]=useState<string|null>(null)
  const [draft,setDraft]=useState('')
  const displayedEntries = memoEntriesForDisplay(entries)
  const startNew=()=>{setEditingId('new');setDraft('')}
  const startEdit=(entry:MemoEntry)=>{if(isBestCancellationMemo(entry))return;setEditingId(entry.id);setDraft(entry.content)}
  const save=()=>{
    if(!draft.trim())return
    const next=editingId==='new'
      ? [...entries,{id:crypto.randomUUID(),date:today,manager:manager||'미배정',content:draft.trim()}]
      : entries.map(entry=>entry.id===editingId?{...entry,content:draft.trim()}:entry)
    onChange(next);setEditingId(null);setDraft('')
  }
  return <div className="memo-overlay"><button className="memo-scrim" onClick={onClose} aria-label="관리메모 닫기"/><section className="memo-modal" role="dialog" aria-modal="true" aria-label="고객 관리메모"><header><div><span>CARE HISTORY</span><h2>고객 관리 진행 내용</h2></div><p>접촉 내용과 다음 관리 계획을 기록하세요.</p><button onClick={onClose}><X size={18}/></button></header><div className="memo-customer"><div><small>고객 식별정보</small><strong>{customerDisplayLabel(lead)}</strong></div><div><small>연락처 표시</small><strong>뒷 4자리만 표시</strong></div><button className="btn primary" onClick={startNew}><Plus size={15}/>관리메모 추가</button></div>{displayedEntries.length===0&&editingId!=='new'?<div className="memo-empty"><Clock3/><strong>등록된 관리메모가 없습니다</strong><span>첫 접촉 내용을 기록해보세요.</span><button className="btn secondary" onClick={startNew}>첫 메모 작성</button></div>:<div className="memo-list">{displayedEntries.map((entry,index)=>{const system=isBestCancellationMemo(entry);const round=displayedEntries.slice(0,index+1).filter(item=>!isBestCancellationMemo(item)).length;return <article className={`memo-row${system?" memo-system-record":""}`} key={entry.id}><div className="memo-round"><strong>{system?"주문 취소":round+"회차"}</strong><span>{system?"BEST 확인":"관리중"}</span></div><div className="memo-meta"><strong>{entry.manager}</strong><span>{formatDate(entry.date)}</span></div><div className="memo-content"><small>{system?"주문 기록":"관리 내용"}</small><p>{entry.content}</p></div>{system?null:<button onClick={()=>startEdit(entry)}>내용 수정하기 →</button>}</article>})}</div>}{editingId&&<div className="memo-editor"><label>{editingId==='new'?'새 관리메모':'관리메모 수정'}<textarea autoFocus rows={4} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="고객 접촉 내용과 다음 계획을 입력하세요."/></label><div><button className="btn secondary" onClick={()=>setEditingId(null)}>취소</button><button className="btn primary" onClick={save}><Check size={15}/>메모 저장</button></div></div>}</section></div>
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
    const email = loginEmailFor(normalizedId)
    const firebasePassword = firebasePasswordForLogin(normalizedId, password)
    try {
      try {
        await signInWithEmailAndPassword(auth, email, firebasePassword)
      } catch (error) {
        const alternate = alternateSameIdPasswordForLogin(normalizedId, password)
        const code = loginFailureFor(error).code
        if (!alternate || (code !== 'auth/invalid-credential' && code !== 'auth/wrong-password')) throw error
        await signInWithEmailAndPassword(auth, email, alternate)
      }
    } catch (error) {
      const failure = loginFailureFor(error)
      setError(failure.message); setFailureCode(failure.code)
    } finally { setBusy(false) }
  }
  return <div className="login-screen"><div className="login-card"><div className="login-logo"><div className="brand-mark">D5</div><div><strong>Partner Desk</strong><span>LG전자 플래그십 D5</span></div></div><p className="eyebrow">SECURE WORKSPACE</p><h1>D5 제휴고객 관리</h1><p className="login-copy">ID와 비밀번호로 로그인해주세요.</p><form onSubmit={login}><label htmlFor="login-id">ID<input ref={loginIdInput} id="login-id" name="loginId" aria-label="ID" aria-describedby="login-id-help" type="text" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" required defaultValue="" onCompositionStart={() => { idComposing.current = true }} onCompositionEnd={() => { idComposing.current = false }} onBlur={() => { idComposing.current = false }} onKeyDown={event => { if (event.key === 'Enter' && (idComposing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault() }} placeholder="ID를 입력하세요"/><small id="login-id-help" className="login-id-help">영문·숫자, 대소문자 구분 없음</small></label><label>비밀번호<input id="login-password" aria-label="비밀번호" type={showPassword ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="기존 비밀번호"/></label><div className="login-password-options"><button type="button" className="login-password-toggle" aria-controls="login-password" aria-pressed={showPassword} aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={14}/> : <Eye size={14}/>}<span>{showPassword ? '숨기기' : '보기'}</span></button></div>{(error||accountError) ? <p className="login-error" role="alert">{error||accountError}{error && failureCode ? <small className="login-error-code">{failureCode}</small> : null}</p> : null}<button className="btn primary" disabled={busy}>{busy?'접속 중...':'로그인'}</button></form><div className="login-safe"><Sparkles size={15}/> Firebase 보안 인증</div></div></div>
}

