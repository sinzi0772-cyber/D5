import { handleCaseSharing } from '../server/case-sharing/handler'

export function POST(request: Request): Promise<Response> {
  return handleCaseSharing(request)
}
