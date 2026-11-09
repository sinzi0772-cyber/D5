export interface PartnerIdentity {
  readonly loginId: string
  readonly partnerId: string
  readonly partnerName: string
}

/** Explicit, approved tenant mappings only. Contains no passwords or credentials. */
export const PARTNER_ACCOUNTS: Readonly<Record<string, PartnerIdentity>> = Object.freeze({
  iwedding: Object.freeze({
    loginId: 'E90227',
    partnerId: 'iwedding',
    partnerName: '(주)아이패밀리에스씨',
  }),
  iniwedding: Object.freeze({
    loginId: 'E75351',
    partnerId: 'iniwedding',
    partnerName: '(주) 아이니웨딩네트웍스',
  }),
})

export function partnerIdentityFor(partnerId: string): PartnerIdentity | undefined {
  return Object.prototype.hasOwnProperty.call(PARTNER_ACCOUNTS, partnerId) ? PARTNER_ACCOUNTS[partnerId] : undefined
}
