/** Validate the finished input before canonicalization; never discard a letter into a different account. */
export const loginIdInputMessage = (value: string): string | null => {
  const entered = value.trim()
  if (!entered) return 'ID를 입력해주세요.'
  if (!/^[A-Za-z0-9]+$/.test(entered)) return 'ID는 영문과 숫자로 입력해주세요. 한글 입력 상태라면 한/영 키를 확인해주세요.'
  return null
}

/** Login IDs use only ASCII letters/digits; preserve digit prefixes and leading zeros. */
export const normalizeLoginId = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

/** Existing Firebase accounts use case-insensitive, lowercase local email identities. */
export const loginEmailFor = (loginId: string): string => `${normalizeLoginId(loginId).toLowerCase()}@d5.local`

/**
 * Preserve custom passwords exactly. The existing numeric shortcut remains;
 * ASCII casing compatibility for temporary same-ID passwords is explicit opt-in.
 */
export const firebasePasswordForLogin = (loginId: string, password: string, approvedTemporaryLoginIds: readonly string[] = []): string => {
  const normalized = normalizeLoginId(loginId)
  if (/^\d+$/.test(normalized) && password === normalized) return `D5${normalized}`
  if (approvedTemporaryLoginIds.includes(normalized) && /^[A-Za-z0-9]+$/.test(password) && password.toUpperCase() === normalized) return normalized
  return password
}
