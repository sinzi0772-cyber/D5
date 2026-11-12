import type { InvitationCampaign } from '../types'
import { PARTNER_ACCOUNTS } from './partnerIdentity'
import { canonicalPartnerName } from './partners'

const novemberInvitation: InvitationCampaign = '2026-11-iniwedding'
export const NOVEMBER_INVITATION_LABEL = '11월 초대전 연결'

/** Explicitly assigned from the reviewed invitation roster. */
export function invitationCampaignFor(value: unknown, partnerName: string): InvitationCampaign | undefined {
  return value === novemberInvitation && canonicalPartnerName(partnerName) === PARTNER_ACCOUNTS.iniwedding.partnerName
    ? novemberInvitation
    : undefined
}
