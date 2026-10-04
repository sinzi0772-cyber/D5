const I_WEDDING_CANONICAL_PARTNER = '(주)아이패밀리에스씨'

/** Compare an entire company name, allowing only spaces and corporation wrappers. */
function exactCompanyKey(value: string): string {
  return value.normalize('NFKC').trim()
    .replace(/^(?:주식회사|\(주\))\s*/, '')
    .replace(/\s*(?:주식회사|\(주\))$/, '')
    .replace(/\s+/g, '')
}

/** Only the explicitly approved company aliases are renamed. No fuzzy matching. */
export function canonicalPartnerName(name: string): string {
  const key = exactCompanyKey(name)
  return key === '아이웨딩' || key === '아이패밀리에스씨'
    ? I_WEDDING_CANONICAL_PARTNER : name.trim()
}
