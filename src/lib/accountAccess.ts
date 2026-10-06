export const SHARED_ACCOUNT_EMPLOYEE_NO = '1292'
export const SHARED_ACCOUNT_MESSAGE = '1292 공용 계정은 사용이 중지되었습니다. 본인 사번으로 로그인해주세요.'

const approvedRoles = new Set(['admin', 'store_manager', 'assistant_manager', 'manager'])
const inactiveStatuses = new Set(['inactive', 'disabled', 'suspended'])

/** Validate server-provided approval without creating or changing a user's role. */
export function accountAccessError(employeeNo: string, profile?: Record<string, unknown>): string | null {
  if (employeeNo === SHARED_ACCOUNT_EMPLOYEE_NO) return SHARED_ACCOUNT_MESSAGE
  if (!profile) return '승인된 직원 정보가 없습니다. 관리자에게 문의해주세요.'
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
