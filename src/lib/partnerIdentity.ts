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
})
