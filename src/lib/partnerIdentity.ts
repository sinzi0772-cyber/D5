export interface PartnerTenant {
  readonly partnerId: string
  readonly partnerName: string
}

export interface PartnerIdentity extends PartnerTenant {
  readonly loginId: string
}

/** Public company identifiers. Login IDs come from approved server profiles. */
export const PARTNER_ACCOUNTS: Readonly<Record<string, PartnerTenant>> = Object.freeze({
  iwedding: Object.freeze({
    partnerId: 'iwedding',
    partnerName: '(주)아이패밀리에스씨',
  }),
  iniwedding: Object.freeze({
    partnerId: 'iniwedding',
    partnerName: '(주) 아이니웨딩네트웍스',
  }),
  weddingcloud: Object.freeze({
    partnerId: 'weddingcloud',
    partnerName: '(주) 웨딩크라우드',
  }),
  itwedding: Object.freeze({
    partnerId: 'itwedding',
    partnerName: '(주) 아이티앤코',
  }),
  // Retain the existing Firebase document ID for the WiseWedding account.
  'wisewedding-weddingfriends': Object.freeze({
    partnerId: 'wisewedding-weddingfriends',
    partnerName: '주식회사 와이즈웨딩',
  }),
})

export function partnerIdentityFor(partnerId: string): PartnerTenant | undefined {
  return Object.prototype.hasOwnProperty.call(PARTNER_ACCOUNTS, partnerId) ? PARTNER_ACCOUNTS[partnerId] : undefined
}
