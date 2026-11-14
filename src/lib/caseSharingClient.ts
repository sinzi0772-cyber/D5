import type { User } from 'firebase/auth'
import { CaseSaveError, type SaveCaseCustomerInput, type UnlinkCaseCustomerInput } from './caseSharingSave'
import { caseFormChanges, caseMemberRevision, caseNewCustomerFields, type CaseSharingRequest } from './caseSharingRequest'

async function submitCaseChange(user: User, request: CaseSharingRequest, assertSession: () => void) {
  assertSession()
  const token = await user.getIdToken()
  assertSession()
  const response = await fetch('/api/case-sharing', { method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data || !Number.isInteger(data.changedCount)) {
    throw new CaseSaveError(typeof data?.code === 'string' ? data.code : 'CASE_SERVICE_ERROR',
      typeof data?.message === 'string' ? data.message : '묶음 저장 서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해주세요.')
  }
  return { changedCount: Number(data.changedCount), shared: data.shared === true }
}

export async function saveCaseCustomerOnServer(user: User, input: SaveCaseCustomerInput) {
  const original = input.original
  const members = await Promise.all(input.openingMembers.filter(member => !input.creating || member.id !== original.id).map(caseMemberRevision))
  const newCustomer = input.creating
    ? Object.fromEntries(caseNewCustomerFields.map(key => [key, input.draft[key]]))
    : undefined
  return submitCaseChange(user, {
    operation: 'save', leadId: original.id, members, targetIds: input.linkTargetIds ?? [], changes: caseFormChanges(input.draft, input.formBaseline),
    basis: { caseLeadId: input.basis?.caseLeadId, mergePurchaseAmounts: input.basis?.mergePurchaseAmounts }, newCustomer,
  }, input.assertSession)
}

export async function unlinkCaseCustomerOnServer(user: User, input: UnlinkCaseCustomerInput) {
  const members = await Promise.all(input.openingMembers.map(caseMemberRevision))
  return submitCaseChange(user, { operation: 'unlink', leadId: input.lead.id, members }, input.assertSession)
}
