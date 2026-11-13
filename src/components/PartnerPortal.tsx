import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleHelp, LogOut } from 'lucide-react'
import { signOut } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { checkedPartnerIdentity } from '../lib/accountAccess'
import { buildPartnerPortalModel, parsePartnerPublication, type PartnerPublication } from '../lib/partnerPublication'
import { PartnerPreview } from './PartnerPreview'
import { SettlementGuideModal } from './SettlementGuideModal'
import './PartnerPortal.css'

/** Real company sessions never receive staff Lead documents or staff controls. */
export function PartnerPortal({ userId, loginId, partnerId }: { userId: string; loginId: string; partnerId: string }) {
  const [publication, setPublication] = useState<PartnerPublication | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [settlementGuideOpen, setSettlementGuideOpen] = useState(false)
  const closeSettlementGuide = useCallback(() => setSettlementGuideOpen(false), [])

  useEffect(() => {
    setPublication(null); setError(''); setLoading(true)
    if (!db || !auth || auth.currentUser?.uid !== userId) { setError('로그인 연결을 확인해 주세요.'); setLoading(false); return }
    const firestoreDb = db
    const firebaseAuth = auth
    let active = true
    let stopPublication: (() => void) | null = null
    const sameSession = () => active && firebaseAuth.currentUser?.uid === userId
    const clearPublication = (message: string) => {
      stopPublication?.(); stopPublication = null
      setPublication(null); setError(message); setLoading(false)
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
          setPublication(null); setError('서버 연결을 확인해 주세요.'); setLoading(false); return
        }
        const next = published.exists() ? parsePartnerPublication(published.data(), identity.partnerId) : null
        if (!next) { setPublication(null); setError('업체 자료가 아직 게시되지 않았습니다. 관리자에게 확인해 주세요.'); setLoading(false); return }
        setPublication(next)
        setError(''); setLoading(false)
      }, () => { if (sameSession()) clearPublication('업체 자료 조회 권한을 확인해 주세요.') })
    }, () => { if (sameSession()) clearPublication('업체 계정 권한을 확인하지 못했습니다.') })
    return () => { active = false; stopPublication?.(); stopProfile() }
  }, [userId, loginId, partnerId])

  const model = useMemo(() => publication?.months.length ? buildPartnerPortalModel(publication) : null, [publication])
  return <main className="partner-portal">
    <header className="partner-portal-toolbar">
      <div>
        <span>D5 PARTNER DESK</span>
        <h1>{publication?.partnerName || '제휴 고객 현황'}</h1>
        <p>연결 고객 · 월별 예상 수수료</p>
      </div>
      <div>
        <button type="button" className="guide-button" aria-haspopup="dialog" aria-expanded={settlementGuideOpen} onClick={() => setSettlementGuideOpen(true)}><CircleHelp size={16}/>제휴·정산 안내</button>
        <button type="button" onClick={() => auth && signOut(auth)}><LogOut size={16}/>로그아웃</button>
      </div>
    </header>
    {loading ? <p role="status">업체 자료를 확인하는 중입니다.</p> : error ? <p className="partner-portal-error" role="alert">{error}</p> : null}
    {model ? <PartnerPreview model={model} presentation="portal"/> : publication && !loading && !error ? <section className="partner-preview partner-preview-portal"><p>연결 고객 자료가 없습니다.</p></section> : null}
    {settlementGuideOpen ? <SettlementGuideModal onClose={closeSettlementGuide} audience="partner"/> : null}
  </main>
}
