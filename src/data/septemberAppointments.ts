/** Actual source rows are held in the protected adminSources collection. */
export type SeptemberAppointment = {
  sourceId: string
  registeredAt: string
  visitScheduledDate: string
  appointmentType: '상담예약(이업종)' | '이업종제휴'
  customerName: string
  phoneLast4: string
  partnerName: string
  appointmentStatus: string
}
