import { handleCaseSharing } from '../server/generated/case-sharing.mjs'

export function POST(request) {
  return handleCaseSharing(request)
}
