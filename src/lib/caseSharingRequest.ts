import type { Lead } from '../types'
import { caseSharingRevisionFor, type SharingBasis } from './caseSharing'

export const caseEditableFields = [
  'appointmentType', 'visitScheduledDate', 'deliveryScheduledDate', 'status', 'visitState', 'note', 'memoHistory',
  'manager', 'managerEmployeeNo', 'purchaseType', 'purchaseAmount', 'lumpSumAmount', 'subscriptionAmount',
] as const

export const caseNewCustomerFields = ['registeredAt', 'customerName', 'phoneLast4', 'gender', 'partnerName', 'billToCode', 'lgeSubchannel', 'plannerName'] as const

type CasePatch = Partial<Record<typeof caseEditableFields[number], unknown>>
type CaseNewCustomer = Partial<Pick<Lead, typeof caseNewCustomerFields[number]>>

export interface CaseMemberRevision {
  id: string
  revision: string
}

export type CaseSharingRequest =
  | { operation: 'check' }
  | { operation: 'unlink'; leadId: string; members: readonly CaseMemberRevision[] }
  | { operation: 'save'; leadId: string; members: readonly CaseMemberRevision[]; targetIds: readonly string[];
      basis: SharingBasis; changes: CasePatch; newCustomer?: CaseNewCustomer }

export async function caseMemberRevision(lead: Lead): Promise<CaseMemberRevision> {
  const bytes = new TextEncoder().encode(caseSharingRevisionFor(lead))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const revision = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  return { id: lead.id, revision }
}

export function caseFormChanges(draft: Lead, baseline: Lead): CasePatch {
  const changes: CasePatch = {}
  for (const key of caseEditableFields) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(baseline[key])) changes[key] = draft[key] ?? null
  }
  return changes
}
