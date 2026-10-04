export type PartnerAppointmentExclusionReason = 'missing-appointment-type' | 'non-partner-appointment-type'

/** A sales route is not referral evidence; only these saved appointment types qualify. */
export function isPartnerAppointmentType(value: unknown): value is '이업종제휴' | '상담예약(이업종)' {
  return value === '이업종제휴' || value === '상담예약(이업종)'
}

/** A manual partner appointment is valid without an imported source identifier. */
export function partnerAppointmentExclusionReason(value: unknown): PartnerAppointmentExclusionReason | undefined {
  if (isPartnerAppointmentType(value)) return undefined
  return value === undefined || value === null || value === '' ? 'missing-appointment-type' : 'non-partner-appointment-type'
}
