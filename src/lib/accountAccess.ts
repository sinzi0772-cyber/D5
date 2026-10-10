import { PARTNER_ACCOUNTS, type PartnerIdentity } from './partnerIdentity'

export const SHARED_ACCOUNT_EMPLOYEE_NO = '1292'
export const SHARED_ACCOUNT_MESSAGE = '사용할 수 없는 계정입니다. 본인 ID로 로그인해주세요.'

const approvedRoles = new Set(['admin', 'store_manager', 'assistant_manager', 'manager'])
const inactiveStatuses = new Set(['inactive', 'disabled', 'suspended'])

/** Client validation only; Firestore rules must independently enforce tenant access. */
export function checkedPartnerIdentity(loginId: string, profile?: Record<string, unknown>): PartnerIdentity | null {
  if (!profile || profile.role !== 'partner' || profile.active !== true || profile.approved !== true
    || profile.disabled === true || (typeof profile.status === 'string' && inactiveStatuses.has(profile.status))) return null
  if (typeof profile.partnerId !== 'string' || !Object.prototype.hasOwnProperty.call(PARTNER_ACCOUNTS, profile.partnerId)) return null
  const identity = PARTNER_ACCOUNTS[profile.partnerId]
  if (loginId !== identity.loginId || profile.loginId !== identity.loginId || profile.partnerName !== identity.partnerName) return null
  return identity
}

/** Validate server-provided approval without creating or changing a user's role. */
export function accountAccessError(employeeNo: string, profile?: Record<string, unknown>): string | null {
  if (employeeNo === SHARED_ACCOUNT_EMPLOYEE_NO) return SHARED_ACCOUNT_MESSAGE
  if (!profile) return '승인된 직원 정보가 없습니다. 관리자에게 문의해주세요.'
  if (profile.role === 'partner') {
    if (profile.disabled === true || profile.active === false || profile.approved === false
      || (typeof profile.status === 'string' && inactiveStatuses.has(profile.status))) return '사용이 중지된 계정입니다. 관리자에게 문의해주세요.'
    return checkedPartnerIdentity(employeeNo, profile) ? null : '승인된 업체 계정 정보가 일치하지 않습니다. 관리자에게 문의해주세요.'
  }
  if (profile.employeeNo !== employeeNo) return '로그인 사번과 승인된 직원 정보가 일치하지 않습니다. 관리자에게 문의해주세요.'
  if (
    profile.disabled === true
    || profile.active === false
    || profile.approved === false
    || (typeof profile.status === 'string' && inactiveStatuses.has(profile.status))
  ) return '사용이 중지된 계정입니다. 관리자에게 문의해주세요.'
  if (typeof profile.role !== 'string' || !approvedRoles.has(profile.role)) return '승인된 직원 권한이 없습니다. 관리자에게 문의해주세요.'
  return null
}
