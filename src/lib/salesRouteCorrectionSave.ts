import { collection, doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore'
import type { SalesRouteCorrection, SalesRouteTarget } from '../types'
import { SALES_RAW_ROUTE_PAIRS } from '../data/salesRouteCatalog'
import { leadFromDocument } from './leadDocument'
import { getStoredSalesChannels } from './salesChannels'
import { canEditSalesRouteFor, isOwnSalesRoute, isSalesRouteChoice, latestSalesRouteCorrectionFor, readSalesRouteCorrectionLedger, salesRouteTargetFor, sameSalesRouteTarget } from './salesRouteCorrections'

export interface SaveSalesRouteCorrectionInput {
  leadId: string
  target: SalesRouteTarget
  correctedChannel1: string
  correctedChannel2: string
  expectedCorrection?: SalesRouteCorrection
  actorId: string
  actorEmployeeNo?: string
  canManageAll: boolean
  assertSession: () => void
}

const validId = (id: string) => typeof id === 'string' && id.length > 0 && id.length <= 200 && id.trim() === id && !id.includes('/')

/** Build a narrow write from the same authoritative snapshot read in the transaction. */
export function salesRouteCorrectionWriteFor(row: Record<string, unknown>, input: SaveSalesRouteCorrectionInput,
  eventId: string, changedAt: string, timestamp: unknown) {
  const { leadId, target, actorId, actorEmployeeNo, canManageAll, correctedChannel1, correctedChannel2 } = input
  if (!isSalesRouteChoice(correctedChannel1) || !isSalesRouteChoice(correctedChannel2)) throw new Error('판매경로 1과 2를 선택해주세요.')
  const lead = leadFromDocument(leadId, row)
  if (!canEditSalesRouteFor(lead, { canManageAll, employeeNo: actorEmployeeNo }) || !isOwnSalesRoute(lead, target.kind)) {
    throw new Error('이 고객의 원본 판매경로를 수정할 권한이 없습니다.')
  }
  const currentTarget = getStoredSalesChannels(lead).map(route => salesRouteTargetFor(lead, route)).find(route => sameSalesRouteTarget(route, target))
  if (!currentTarget) throw new Error('판매 원본이 변경되었습니다. 최신 판매경로를 확인해주세요.')

  const ledger = readSalesRouteCorrectionLedger(row.salesRouteCorrections)
  if (!ledger) throw new Error('판매경로 수정 이력을 읽을 수 없습니다. 관리자에게 확인해주세요.')
  const previous = latestSalesRouteCorrectionFor(lead, currentTarget)
  if (previous?.id !== input.expectedCorrection?.id) throw new Error('이미 다른 판매경로가 저장되었습니다. 최신 내용을 확인해주세요.')
  const isOriginalPair = currentTarget.channel1 === correctedChannel1 && currentTarget.channel2 === correctedChannel2
  if (!isOriginalPair && !SALES_RAW_ROUTE_PAIRS[currentTarget.kind].some(([first, second]) => first === correctedChannel1 && second === correctedChannel2)) {
    throw new Error('판매 RAW에 있는 판매경로 조합을 선택해주세요.')
  }
  if (previous?.correctedChannel1 === correctedChannel1 && previous.correctedChannel2 === correctedChannel2) return { correction: previous }

  const revision = ledger.revision + 1
  const correction: SalesRouteCorrection = { ...currentTarget, id: eventId, correctedChannel1, correctedChannel2, changedAt, changedBy: actorId }
  const event = { ...currentTarget, correctedChannel1, correctedChannel2, changedAt: timestamp, changedBy: actorId, revision }
  return { correction, update: { salesRouteCorrections: { revision, latestId: eventId, entries: { ...ledger.entries, [eventId]: event } } } }
}

export async function saveSalesRouteCorrection(db: Firestore, input: SaveSalesRouteCorrectionInput): Promise<SalesRouteCorrection> {
  input.assertSession()
  if (!validId(input.leadId) || !validId(input.actorId)) throw new Error('수정할 고객과 직원 계정을 확인해주세요.')
  const referrals = collection(db, 'referrals')
  const ref = doc(referrals, input.leadId)
  const eventId = doc(referrals).id
  return runTransaction(db, async transaction => {
    input.assertSession()
    const snapshot = await transaction.get(ref)
    input.assertSession()
    if (!snapshot.exists()) throw new Error('판매경로를 수정할 고객을 찾을 수 없습니다.')
    const result = salesRouteCorrectionWriteFor(snapshot.data(), input, eventId, new Date().toISOString(), serverTimestamp())
    if (result.update) transaction.update(ref, result.update)
    return result.correction
  })
}
