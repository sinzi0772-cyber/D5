import { useCallback, useEffect, useState } from 'react'
import { CircleHelp, LogOut, RefreshCw } from 'lucide-react'
import { signOut } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { checkedPartnerIdentity } from '../lib/accountAccess'
import { parsePartnerPublication, type PartnerPublication } from '../lib/partnerPublication'
import { PartnerPreview } from './PartnerPreview'
import { SettlementGuideModal } from './SettlementGuideModal'
import './PartnerPortal.css'

/** Real company sessions never receive staff Lead documents or staff controls. */
export function PartnerPortal({ userId, loginId, partnerId }: { userId: string; loginId: string; partnerId: string }) {
  const [publication, setPublication] = useState<PartnerPublication | null>(null)
  const [month, setMonth] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkedAt, setCheckedAt] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [settlementGuideOpen, setSettlementGuideOpen] = useState(false)
  const closeSettlementGuide = useCallback(() => setSettlementGuideOpen(false), [])

  useEffect(() => {
    setPublication(null); setMonth(''); setCheckedAt(''); setError(''); setLoading(true)
    if (!db || !auth || auth.currentUser?.uid !== userId) { setError('로그인 연결을 확인해 주세요.'); setLoading(false); return }
    const firestoreDb = db
    const firebaseAuth = auth
    let active = true
    let stopPublication: (() => void) | null = null
    const sameSession = () => active && firebaseAuth.currentUser?.uid === userId
    const clearPublication = (message: string) => {
      stopPublication?.(); stopPublication = null
      setPublication(null); setCheckedAt(''); setError(message); setLoading(false)
    }
    const stopProfile = onSnapshot(doc(firestoreDb, 'profiles', userId), { includeMetadataChanges: true }, snapshot => {
      if (!sameSession()) return
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
        clearPublication('서버에서 업체 권한을 확인하는 중입니다.'); return
      }
      const profile = snapshot.exists() ? snapshot.data() : undefined
      const identity = checkedPartnerIdentity(loginId, profile)
      if (!identity || identity.partnerId !== partnerId || profile?.mustChangePassword) {
        clearPublication('업체 계정 승인을 확인해 주세요.')
        void signOut(firebaseAuth).catch(() => undefined)
        return
      }
      if (stopPublication) return
      setLoading(true); setError('')
      stopPublication = onSnapshot(doc(firestoreDb, 'partnerViews', identity.partnerId), { includeMetadataChanges: true }, published => {
        if (!sameSession()) return
        if (published.metadata.fromCache || published.metadata.hasPendingWrites) {
          setPublication(null); setCheckedAt(''); setError('서버 연결을 확인해 주세요.'); setLoading(false); return
        }
        const next = published.exists() ? parsePartnerPublication(published.data(), identity.partnerId) : null
        if (!next) { setPublication(null); setCheckedAt(''); setError('업체 자료가 아직 게시되지 않았습니다. 관리자에게 확인해 주세요.'); setLoading(false); return }
        setPublication(next)
        setCheckedAt(new Date().toISOString())
        setMonth(current => next.months.some(model => model.intakeMonth === current) ? current : next.months[0]?.intakeMonth || '')
        setError(''); setLoading(false)
      }, () => { if (sameSession()) clearPublication('업체 자료 조회 권한을 확인해 주세요.') })
    }, () => { if (sameSession()) clearPublication('업체 계정 권한을 확인하지 못했습니다.') })
    return () => { active = false; stopPublication?.(); stopProfile() }
  }, [userId, loginId, partnerId, refresh])

  const selected = publication?.months.find(model => model.intakeMonth === month)
  const stamp = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  return <main className="partner-portal">
    <header className="partner-portal-toolbar"><div><span>D5 PARTNER DESK</span><h1>{publication?.partnerName || '제휴 고객 현황'}</h1><p>연결 고객 · 월별 예상 수수료</p></div><div><button type="button" className="guide-button" aria-haspopup="dialog" aria-expanded={settlementGuideOpen} onClick={() => setSettlementGuideOpen(true)}><CircleHelp size={16}/>제휴·정산 안내</button><button type="button" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16}/>자료 확인</button><button type="button" onClick={() => auth && signOut(auth)}><LogOut size={16}/>로그아웃</button></div></header>
    {publication ? <div className="partner-portal-period"><label>접수월<select aria-label="업체 접수월" value={month} onChange={event => setMonth(event.target.value)}>{publication.months.map(model => <option key={model.intakeMonth} value={model.intakeMonth}>{model.intakeMonth.replace('-', '년 ')}월</option>)}</select></label></div> : null}
    {loading ? <p role="status">업체 자료를 확인하는 중입니다.</p> : error ? <p className="partner-portal-error" role="alert">{error}</p> : null}
    {selected ? <PartnerPreview model={selected} presentation="portal"/> : publication && !loading && !error ? <section className="partner-preview partner-preview-portal"><p>연결 고객 자료가 없습니다.</p></section> : null}
    {publication ? <details className="partner-portal-info"><summary>자료 갱신 정보</summary><div><span>자료 갱신 {stamp(publication.publishedAt)}</span>{checkedAt ? <span>서버 확인 {stamp(checkedAt)}</span> : null}</div><p className="partner-portal-note">관리자가 전체 고객 자료를 확인하면 업체 자료가 갱신됩니다. ‘자료 확인’은 최신 게시본을 조회합니다.</p></details> : null}
    {settlementGuideOpen ? <SettlementGuideModal onClose={closeSettlementGuide}/> : null}
  </main>
}
