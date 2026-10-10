export interface LoginFailure {
  message: string
  /** Only a bounded SDK-style code, never provider messages or request details. */
  code?: string
}

const credentialsMessage = 'ID 또는 비밀번호를 확인해주세요. 비밀번호는 대소문자를 구분합니다.'
const temporaryMessage = '로그인을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.'
const credentialCodes = new Set(['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'])
const networkCodes = new Set(['auth/network-request-failed', 'auth/timeout'])
const configurationCodes = new Set([
  'auth/invalid-api-key', 'auth/app-not-authorized', 'auth/operation-not-allowed',
  'auth/unauthorized-domain', 'auth/configuration-not-found',
])

/** Classify a failed request without changing credentials or reading error.message. */
export function loginFailureFor(error: unknown): LoginFailure {
  let candidate: unknown
  try {
    if (typeof error === 'object' && error !== null) candidate = (error as { code?: unknown }).code
  } catch {
    // An unfamiliar object or throwing property must not break the login screen.
  }
  const code = typeof candidate === 'string' && /^auth\/[a-z0-9-]{1,64}$/u.test(candidate) && !/[\r\n]/u.test(candidate) ? candidate : undefined
  if (!code) return { message: temporaryMessage }
  let message = temporaryMessage
  if (credentialCodes.has(code)) message = credentialsMessage
  else if (code === 'auth/user-disabled') message = '사용이 중지된 계정입니다. 관리자에게 문의해주세요.'
  else if (networkCodes.has(code)) message = '로그인 서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.'
  else if (code === 'auth/too-many-requests') message = '로그인 시도가 반복되어 잠시 제한되었습니다. 추가 시도를 멈추고 잠시 후 다시 시도해주세요.'
  else if (configurationCodes.has(code)) message = '로그인 연결 설정을 확인해야 합니다. 관리자에게 문의해주세요.'
  return { message, code }
}
