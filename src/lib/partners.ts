const I_WEDDING_CANONICAL_PARTNER = '(주)아이패밀리에스씨'

/** Compare an entire company name, allowing only spaces and corporation wrappers. */
function exactCompanyKey(value: string): string {
  return value.normalize('NFKC').trim()
    .replace(/^(?:주식회사|\(주\))\s*/, '')
    .replace(/\s*(?:주식회사|\(주\))$/, '')
    .replace(/\s+/g, '')
}

/** Approved aliases keep their existing tenant identity. Other company names
 * only standardize whitespace directly after the leading corporation marker;
 * the full company name is retained, without fuzzy or prefix-name matching. */
export function canonicalPartnerName(name: string): string {
  const key = exactCompanyKey(name)
  if (key === '아이웨딩' || key === '아이패밀리에스씨') return I_WEDDING_CANONICAL_PARTNER
  if (key === '웨딩크라우드') return '(주) 웨딩크라우드'
  const trimmed = name.trim()
  return trimmed === '(주)' ? trimmed : trimmed.replace(/^\(주\)\s*/, '(주) ')
}
