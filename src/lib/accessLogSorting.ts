export type AccessCountDirection = 'asc' | 'desc' | null

interface AccessCountRow {
  employeeNo: string
  usage?: { visitCount?: number }
}

/** Display-only ordering. Null preserves the existing recent-access order. */
export function sortAccessRowsByVisits<Row extends AccessCountRow>(rows: readonly Row[], direction: AccessCountDirection): Row[] {
  if (direction === null) return [...rows]
  return [...rows].sort((left, right) => ((left.usage?.visitCount || 0) - (right.usage?.visitCount || 0)) * (direction === 'asc' ? 1 : -1)
    || left.employeeNo.localeCompare(right.employeeNo, 'ko', { numeric: true }))
}
