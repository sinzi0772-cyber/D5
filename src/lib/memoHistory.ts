import type { Lead, MemoEntry } from '../types'

export const BEST_CANCELLATION_MEMO_PREFIX = 'best-cancel-'
type MemoLead = Pick<Lead, 'memoHistory' | 'note' | 'updatedAt' | 'manager'>

export const isBestCancellationMemo = (entry: Pick<MemoEntry, 'id'>): boolean =>
  typeof entry.id === 'string' && entry.id.startsWith(BEST_CANCELLATION_MEMO_PREFIX)

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

