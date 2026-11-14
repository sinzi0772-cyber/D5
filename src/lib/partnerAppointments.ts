import type { AppointmentType } from '../types'

export const partnerAppointmentTypes = ['이업종제휴', '상담예약(이업종)'] as const

export function partnerAppointmentLabel(type: typeof partnerAppointmentTypes[number]): string {
  return type === '상담예약(이업종)' ? '상담예약 (이업종)' : type
}

export type PartnerAppointmentExclusionReason = 'missing-appointment-type' | 'non-partner-appointment-type'

/** A sales route is not referral evidence; only these saved appointment types qualify. */
export function isPartnerAppointmentType(value: unknown): value is Exclude<AppointmentType, '미선택'> {
  return partnerAppointmentTypes.some(type => type === value)
}

/** A manual partner appointment is valid without an imported source identifier. */
export function partnerAppointmentExclusionReason(value: unknown): PartnerAppointmentExclusionReason | undefined {
  if (isPartnerAppointmentType(value)) return undefined
  return value === undefined || value === null || value === '' ? 'missing-appointment-type' : 'non-partner-appointment-type'
}
