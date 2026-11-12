// Observed path pairs from the September and October 2026 BEST sales exports.
const commonPairs = [
  ['고객인증서비스(웨딩)', '웨딩매장행사'],
  ['고객인증서비스(웨딩)', '웨딩박람회(내부)'],
  ['고객인증서비스(웨딩)', '웨딩박람회(외부)'],
  ['고객인증서비스(웨딩)', '웨딩업체연결(수수료지급)'],
  ['군인', '군인(웨딩)'],
  ['기업체', '소상공인'],
  ['오픈', '신규오픈'],
  ['이업종', '부동산'],
  ['임원할인', '부사장이하'],
  ['임원할인', '사장이상'],
  ['지점특화', '상권공략'],
  ['지점특화', '핀셋'],
] as const

export const SALES_RAW_ROUTE_PAIRS = {
  lumpSum: [...commonPairs, ['기타', '기타'], ['연결판매', '서비스']],
  subscription: [...commonPairs, ['인테리어', '한샘(가구)'], ['임직원', '임직원']],
} as const
