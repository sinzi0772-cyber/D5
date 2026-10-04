import { canonicalPartnerName } from './partners'

/** The user-approved subscription commission list. Do not infer similar companies. */
export const SUBSCRIPTION_REBATE_PARTNERS = [
  '(주)아이니웨딩네트웍스',
  '(주)아이패밀리에스씨',
  '주식회사 베리굿웨딩컴퍼니',
  '주식회사 와이즈웨딩',
  '(주) 아이티앤코',
  '주식회사 웨딩프렌즈',
  '주식회사 에브리플래닛',
  '찰스 커뮤니케이션',
  '리안트(LIANT)',
  '비위드케이',
  '아이티이(ITE)',
  '썸웨드',
  '(주) 고구마',
  '웨딩로드',
  '대구다이렉트웨딩준비 대구허니문투어',
  '누리웨딩',
  '라엘웨딩',
  '제이웨딩',
  '(주)웨딩크라우드',
  '짠순이',
  '더리본 주식회사',
  '홍스(S)웨딩투게더',
  '비에이치 무역',
  '주식회사 컬러인웨딩',
  '주식회사 더블유와이피코리아',
  '주식회사 메이크마이웨딩',
  '(주)웨딩북',
  '(주)다이렉트컴즈',
  '신한카드 주식회사',
  '주식회사 더베스트컴퍼니',
  '주식회사 이안컴퍼니',
  '주식회사 함웨딩',
  '주식회사 광주웨딩스퀘어',
  '라에스웨딩',
  '시스템컴퍼니',
  '주식회사 브라이덜 휘',
  '주식회사 호텔리츠',
  '지디스타일 안산점',
  '(주) 에이더블유',
  '더블유앤코',
] as const

const partnerKey = (name: string) => canonicalPartnerName(name).normalize('NFKC').trim().toLowerCase()
  .replace(/^(?:주식회사|\(주\))\s*/, '')
  .replace(/\s*(?:주식회사|\(주\))$/, '')
  .replace(/\s+/g, '')
const approvedKeys = new Set<string>(SUBSCRIPTION_REBATE_PARTNERS.map(partnerKey))

/** Spaces/corporation wrappers and the explicitly approved 아이웨딩 alias are allowed. */
export const isSubscriptionRebatePartner = (name: string) => approvedKeys.has(partnerKey(name))
