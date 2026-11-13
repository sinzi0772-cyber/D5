import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { collection, getDocsFromServer, query, where } from 'firebase/firestore'
import { X } from 'lucide-react'
import { checkedPartnerIdentity } from '../lib/accountAccess'
import { db } from '../lib/firebase'
import { loginIdInputMessage, normalizeLoginId } from '../lib/loginIdentity'
import { partnerIdentityFor } from '../lib/partnerIdentity'
import './PartnerAccountsDialog.css'

interface PartnerAccountRow {
  key: string
  partnerName: string
  loginId: string
  active: boolean
}

type AccountsLoad = { status: 'loading' } | { status: 'error' } | { status: 'ready'; accounts: PartnerAccountRow[] }

function accountFor(key: string, profile: Record<string, unknown>): PartnerAccountRow | undefined {
  if (profile.role !== 'partner' || typeof profile.partnerId !== 'string' || typeof profile.loginId !== 'string') return
  const identity = partnerIdentityFor(profile.partnerId)
  const loginId = normalizeLoginId(profile.loginId)
  if (!identity || identity.partnerName !== profile.partnerName || loginIdInputMessage(profile.loginId) || loginId.length > 64) return
  return { key, partnerName: identity.partnerName, loginId, active: checkedPartnerIdentity(loginId, profile) !== null }
}

export function PartnerAccountsDialog({ onClose }: { onClose: () => void }) {
  const [load, setLoad] = useState<AccountsLoad>({ status: 'loading' })
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const footerButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const firestore = db
    if (!firestore) { setLoad({ status: 'error' }); return }
    const request = query(collection(firestore, 'profiles'), where('role', '==', 'partner'))
    let open = true
    async function loadAccounts() {
      try {
        const snapshot = await getDocsFromServer(request)
        if (!open) return
        const accounts = snapshot.docs.map(doc => accountFor(doc.id, doc.data()))
          .filter((account): account is PartnerAccountRow => account !== undefined)
          .sort((a, b) => a.partnerName.localeCompare(b.partnerName, 'ko') || a.loginId.localeCompare(b.loginId))
        setLoad({ status: 'ready', accounts })
      } catch {
        if (open) setLoad({ status: 'error' })
      }
    }
    void loadAccounts()
    return () => { open = false }
  }, [])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.getPropertyValue('overflow')
    const previousPriority = document.body.style.getPropertyPriority('overflow')
    document.body.style.setProperty('overflow', 'hidden')
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const active = document.activeElement
      const boundary = event.shiftKey ? closeButton.current : footerButton.current
      if (!dialog.current?.contains(active) || active === boundary) {
        event.preventDefault()
        const next = event.shiftKey ? footerButton.current : closeButton.current
        next?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (previousOverflow) document.body.style.setProperty('overflow', previousOverflow, previousPriority)
      else document.body.style.removeProperty('overflow')
      if (opener?.isConnected) opener.focus()
    }
  }, [onClose])

  const modal = <div className="partner-accounts-overlay">
    <button className="partner-accounts-scrim" type="button" tabIndex={-1} aria-label="업체 계정 닫기" onClick={onClose}/>
    <section ref={dialog} className="partner-accounts-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><h2 id={titleId}>업체 계정</h2><button ref={closeButton} type="button" aria-label="닫기" onClick={onClose}><X size={20}/></button></header>
      <div className="partner-accounts-body" aria-busy={load.status === 'loading'}>
        {load.status === 'loading' ? <p role="status">업체 계정을 불러오는 중입니다.</p>
          : load.status === 'error' ? <p role="alert">업체 계정을 불러오지 못했습니다.</p>
          : load.accounts.length === 0 ? <p role="status">표시할 업체 계정이 없습니다.</p>
          : <table>
            <thead><tr><th scope="col">업체명</th><th scope="col">ID</th><th scope="col">상태</th></tr></thead>
            <tbody>{load.accounts.map(account => <tr key={account.key}>
              <th scope="row">{account.partnerName}</th><td className="partner-account-id">{account.loginId}</td>
              <td><span className={`partner-account-state${account.active ? ' active' : ''}`}>{account.active ? '활성' : '중지'}</span></td>
            </tr>)}</tbody>
          </table>}
      </div>
      <footer><button ref={footerButton} type="button" className="btn primary" onClick={onClose}>닫기</button></footer>
    </section>
  </div>
  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}
