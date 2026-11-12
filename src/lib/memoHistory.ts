import type { Lead, MemoEntry } from '../types'

export const BEST_CANCELLATION_MEMO_PREFIX = 'best-cancel-'
type MemoLead = Pick<Lead, 'memoHistory' | 'note' | 'updatedAt' | 'manager'>

export const isBestCancellationMemo = (entry: Pick<MemoEntry, 'id'>): boolean =>
  typeof entry.id === 'string' && entry.id.startsWith(BEST_CANCELLATION_MEMO_PREFIX)

const partialCancellation = /(?:부분|일부)(?:\s*(?:품목|항목|주문))?\s*취소/u
const explicitFullCancellation = /(?:전체|전부|전량|전액|완전)\s*(?:주문\s*)?취소/u
// The original importer counts source lines by customer, purchase kind and period.
const mixedSourceCancellation = /^BEST 주문 취소 확인 · (?:일시불|구독) · [^\r\n]+\r?\n취소 항목 [1-9]\d*건 · 확정·(?:예약|출하대기) 항목 [1-9]\d*건\(같은 원본\)\.(?:\r?\n|$)/u

/** Display a full cancellation without changing the stored audit or staff notes. */
export function memoEntriesForDisplay(entries: readonly MemoEntry[]): MemoEntry[] {
  return entries.flatMap(entry => {
    if (!isBestCancellationMemo(entry)) return [entry]
    if (partialCancellation.test(entry.content)) {
      const full = entry.content.split(/\r?\n|[;,]\s*|\s+[·/]\s+/u)
        .filter(part => explicitFullCancellation.test(part) && !partialCancellation.test(part))
        .map(part => part.trim())
      return full.length ? [{ ...entry, content: full.join('\n') }] : []
    }
    return mixedSourceCancellation.test(entry.content) && !explicitFullCancellation.test(entry.content) ? [] : [entry]
  })
}

const hasLegacyHumanNote = (lead: MemoLead): boolean => Boolean(lead.note?.trim()
  && !(lead.memoHistory || []).some(entry => isBestCancellationMemo(entry) && entry.content === lead.note))

const legacyMemoFor = (lead: MemoLead): MemoEntry => ({
  id: 'legacy', date: lead.updatedAt.slice(0, 10), manager: lead.manager || '미배정', content: lead.note || '',
})

/** System audit records stay visible without hiding an older single-field note. */
export function allMemoEntriesFor(lead: MemoLead): MemoEntry[] {
  const history = lead.memoHistory || []
  if (!history.length) return lead.note ? [legacyMemoFor(lead)] : []
  return !history.some(entry => !isBestCancellationMemo(entry)) && hasLegacyHumanNote(lead)
    ? [legacyMemoFor(lead), ...history] : history
}

/** A BEST import is not a customer contact or a staff management round. */
export function managementMemoEntriesFor(lead: MemoLead): MemoEntry[] {
  const human = (lead.memoHistory || []).filter(entry => !isBestCancellationMemo(entry))
  return human.length ? human : hasLegacyHumanNote(lead) ? [legacyMemoFor(lead)] : []
}

export function latestManagementMemoDateFor(lead: MemoLead): string | undefined {
  return managementMemoEntriesFor(lead).map(entry => entry.date).filter(Boolean).sort().at(-1)
}

/** Detect a background audit append even when personal updatedAt is preserved. */
export function memoHistoryRevisionFor(lead: MemoLead): string {
  return JSON.stringify([lead.note || '', (lead.memoHistory || []).map(entry => [entry.id, entry.date, entry.manager, entry.content])])
}

