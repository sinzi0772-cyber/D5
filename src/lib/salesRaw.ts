/** Sales imports retain masked names and phone suffixes only. Never store source rows. */
export type SalesRawOrderStatus = '확정' | '예약' | '가예약' | '기타'
export interface SalesRawIssue {
  severity: 'error' | 'warning'
  code: string
  rowNumber?: number
  message: string
}
export interface SalesRawOrder {
  rowNumber: number
  orderReference: string
  originalOrderReference: string
  identityKey: string
  customerName: string
  phoneLast4: string
  seller: string
  orderDate: string
  confirmedDate: string
  orderStatus: SalesRawOrderStatus
  orderStatusLabel: string
  orderCategory: string
  orderType: string
  saleAmount: number
  paymentAmount: number | null
  balanceAmount: number | null
  channel1: string
  channel2: string
  commissionEligible: boolean
  isReturnOrRefund: boolean
  hasReviewRequired: boolean
}
export interface SalesRawCustomer {
  identityKey: string
  customerName: string
  phoneLast4: string
  orders: SalesRawOrder[]
  saleAmount: number
  eligibleSaleAmount: number
  expectedCommission: number
  confirmedSaleAmount: number
  confirmedEligibleSaleAmount: number
  confirmedExpectedCommission: number
  reservedSaleAmount: number
  reservedEligibleSaleAmount: number
  tentativeSaleAmount: number
  tentativeEligibleSaleAmount: number
  admittedOrderCount: number
  admittedSaleAmount: number
  admittedEligibleSaleAmount: number
  admittedExpectedCommission: number
  pendingSaleAmount: number
  pendingEligibleSaleAmount: number
  unknownSaleAmount: number
  returnSaleAmount: number
  hasReviewRequired: boolean
}
export interface SalesRawSummary {
  inputRows: number
  acceptedOrders: number
  duplicateOrderRows: number
  conflictingOrders: number
  customerCount: number
  confirmedOrders: number
  reservedOrders: number
  tentativeOrders: number
  unknownStatusOrders: number
  returnOrders: number
  eligibleOrders: number
  ineligibleOrders: number
  saleAmount: number
  eligibleSaleAmount: number
  confirmedSaleAmount: number
  confirmedEligibleSaleAmount: number
  reservedSaleAmount: number
  reservedEligibleSaleAmount: number
  tentativeSaleAmount: number
  tentativeEligibleSaleAmount: number
  admittedOrderCount: number
  admittedSaleAmount: number
  admittedEligibleSaleAmount: number
  admittedExpectedCommission: number
  pendingSaleAmount: number
  expectedCommission: number
  confirmedExpectedCommission: number
  reviewCustomerCount: number
  errorCount: number
  warningCount: number
}
export interface SalesRawResult {
  orders: SalesRawOrder[]
  customers: SalesRawCustomer[]
  issues: SalesRawIssue[]
  summary: SalesRawSummary
}

export const SALES_COMMISSION_CHANNEL1 = '고객인증서비스(웨딩)'
export const SALES_COMMISSION_CHANNEL2 = ['웨딩박람회(내부)', '웨딩업체연결(수수료지급)'] as const

export function maskCustomerName(value: string): string {
  const clean = value.normalize('NFKC').trim().replace(/\s/g, '').replace(/[＊]/g, '*')
  if (!clean || clean.includes('*') || clean.length === 1) return clean
  if (clean.length === 2) return `${clean[0]}*`
  return `${clean[0]}*${clean.at(-1)}`
}

/** A phone suffix alone must never be used as a customer key. */
export function customerIdentityKey(name: string, phone: string): string {
  const maskedName = maskCustomerName(name)
  const suffix = phone.replace(/\D/g, '').slice(-4)
  return maskedName && !/^\*+$/.test(maskedName) && suffix.length === 4 ? `${maskedName}|${suffix}` : ''
}

export function isSalesCommissionChannelEligible(channel1: string, channel2: string): boolean {
  return channel1.trim() === SALES_COMMISSION_CHANNEL1
    && SALES_COMMISSION_CHANNEL2.some(value => value === channel2.trim())
}

type TsvRecord = { fields: string[]; line: number }
export function readTsv(text: string): { records: TsvRecord[]; issues: SalesRawIssue[] } {
  const records: TsvRecord[] = []
  const issues: SalesRawIssue[] = []
  let fields: string[] = [], value = '', quoted = false, closed = false, line = 1, startLine = 1
  const pushField = () => { fields.push(value); value = ''; closed = false }
  const pushRecord = () => {
    pushField()
    if (fields.some(field => field.trim())) records.push({ fields, line: startLine })
    fields = []
    startLine = line + 1
  }
  const source = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { value += '"'; index += 1 }
      else if (char === '"') { quoted = false; closed = true }
      else if (char === '\r') { if (source[index + 1] === '\n') index += 1; value += '\n'; line += 1 }
      else { value += char; if (char === '\n') line += 1 }
      continue
    }
    if (char === '\t') { pushField(); continue }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      pushRecord(); line += 1; continue
    }
    if (char === '"' && !value.trim() && !closed) { value = ''; quoted = true; continue }
    if (closed && char.trim()) {
      issues.push({ severity: 'error', code: 'invalid-quoted-field', rowNumber: startLine, message: '닫힌 따옴표 뒤에 잘못된 텍스트가 있습니다.' })
      closed = false
    }
    value += char
  }
  if (quoted) issues.push({ severity: 'error', code: 'unterminated-quote', rowNumber: startLine, message: '따옴표로 감싼 필드가 끝나지 않았습니다. 원본 전체를 다시 붙여넣어 주세요.' })
  if (value || fields.length) pushRecord()
  return { records, issues }
}

const normalizeHeader = (value: string) => value.replace(/[\s\uFEFF"']/g, '')
function money(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parentheses = /^\(.*\)$/.test(trimmed)
  const cleaned = trimmed.replace(/[\s,₩원()]/g, '')
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null
  const number = Number(cleaned) * (parentheses ? -1 : 1)
  return Number.isSafeInteger(number) ? number : null
}
function dateOnly(value: string): string {
  if (!value.trim()) return ''
  const match = value.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\s.*)?$/)
  if (!match) return ''
  const [, year, month, day] = match
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const instant = new Date(`${date}T00:00:00Z`)
  return Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== date ? '' : date
}
const orderState = (label: string): SalesRawOrderStatus => label === '주문확정' || label === '확정' ? '확정' : label === '예약' ? '예약' : label === '가예약' ? '가예약' : '기타'

/**
 * Amounts use 판매금액, not 결제금액. Confirmed, reserved and tentative orders are
 * admitted by the store's completed-sale policy, while their source statuses and
 * amounts stay separate. Inclusion does not prove delivery or final settlement.
 */
export function parseSalesRaw(text: string): SalesRawResult {
  const parsed = readTsv(text)
  const issues = [...parsed.issues]
  const header = parsed.records.shift()
  const inputRows = parsed.records.length
  const ordersByReference = new Map<string, { order: SalesRawOrder; signature: string }>()
  const conflicts = new Set<string>()
  let duplicateOrderRows = 0
  const columns = header?.fields.map(normalizeHeader) || []
  const required = ['주문번호', '고객명', '핸드폰번호', '판매금액', '판매경로1', '판매경로2', '주문확정여부']
  const missing = required.filter(name => !columns.includes(name))
  if (!header || missing.length) issues.push({ severity: 'error', code: 'missing-columns', message: `판매 원본의 필수 열이 없습니다: ${missing.join(', ') || '제목 행'}` })
  if (columns.some((name, index) => name && columns.indexOf(name) !== index)) issues.push({ severity: 'error', code: 'duplicate-columns', message: '중복된 열 제목이 있어 원본 열을 구분할 수 없습니다.' })
  const hasStructuralError = issues.some(issue => issue.severity === 'error' && issue.rowNumber === undefined)
  if (!hasStructuralError) for (const record of parsed.records) {
    const rowNumber = record.line
    if (record.fields.length !== columns.length) {
      issues.push({ severity: 'error', code: 'column-count', rowNumber, message: `열 개수가 제목과 다릅니다. 제목 ${columns.length}열, 해당 행 ${record.fields.length}열입니다.` })
      continue
    }
    if (issues.some(issue => issue.severity === 'error' && issue.rowNumber === rowNumber)) continue
    const field = (name: string) => (record.fields[columns.indexOf(name)] || '').trim()
    const identityKey = customerIdentityKey(field('고객명'), field('핸드폰번호'))
    const orderReference = field('주문번호')
    const saleAmount = money(field('판매금액'))
    if (!identityKey) issues.push({ severity: 'error', code: 'invalid-identity', rowNumber, message: '고객명과 휴대폰 뒷 4자리를 함께 확인할 수 없습니다. 전화번호만으로 고객을 매칭하지 않습니다.' })
    if (!orderReference) issues.push({ severity: 'error', code: 'missing-order-reference', rowNumber, message: '주문번호가 없어 중복 판매를 확인할 수 없습니다.' })
    if (saleAmount === null) issues.push({ severity: 'error', code: 'invalid-sale-amount', rowNumber, message: '판매금액이 비어 있거나 유효한 정수 금액이 아닙니다.' })
    if (!identityKey || !orderReference || saleAmount === null) continue
    const beforeIssueCount = issues.length
    const statusLabel = field('주문확정여부')
    const orderStatus = orderState(statusLabel)
    const orderCategory = field('주문구분')
    const orderType = field('주문유형')
    const isReturnOrRefund = /반품|반환|환불/.test(`${orderCategory} ${orderType}`) || saleAmount < 0
    if (orderStatus === '기타') issues.push({ severity: 'warning', code: 'unknown-order-status', rowNumber, message: '알 수 없는 주문 상태입니다. 확정 매출과 분리하여 확인합니다.' })
    if (isReturnOrRefund) issues.push({ severity: 'warning', code: 'return-or-refund', rowNumber, message: '반품·환불 또는 음수 판매금액입니다. 원주문과 실제 반품액을 확인해야 합니다.' })
    if (isReturnOrRefund && saleAmount > 0) issues.push({ severity: 'warning', code: 'positive-return-amount', rowNumber, message: '반품·환불 행인데 금액이 양수입니다. 부호를 추정하여 변경하지 않습니다.' })
    const orderDate = dateOnly(field('주문일자'))
    const confirmedDate = dateOnly(field('판매확정일'))
    for (const [name, normalized] of [['주문일자', orderDate], ['판매확정일', confirmedDate]]) {
      if (field(name) && !normalized) issues.push({ severity: 'warning', code: 'invalid-date', rowNumber, message: `${name}를 유효한 날짜로 읽을 수 없습니다.` })
    }
    const optionalMoney = (name: string) => {
      const amount = money(field(name))
      if (field(name) && amount === null) issues.push({ severity: 'warning', code: 'invalid-optional-amount', rowNumber, message: `${name}를 읽을 수 없습니다. 수수료는 판매금액을 사용합니다.` })
      return amount
    }
    const paymentAmount = optionalMoney('결제금액')
    const balanceAmount = optionalMoney('잔액')
    const order: SalesRawOrder = {
      rowNumber, orderReference, originalOrderReference: field('원주문번호'), identityKey,
      customerName: maskCustomerName(field('고객명')), phoneLast4: field('핸드폰번호').replace(/\D/g, '').slice(-4),
      seller: field('판매사원'), orderDate, confirmedDate, orderStatus, orderStatusLabel: statusLabel,
      orderCategory, orderType, saleAmount, paymentAmount, balanceAmount,
      channel1: field('판매경로1'), channel2: field('판매경로2'),
      commissionEligible: isSalesCommissionChannelEligible(field('판매경로1'), field('판매경로2')),
      isReturnOrRefund, hasReviewRequired: orderStatus === '기타' || isReturnOrRefund || issues.length > beforeIssueCount,
    }
    // Runtime comparison only: signatures and source rows never appear in returned results.
    const signature = JSON.stringify(record.fields.map(value => value.trim()))
    const previous = ordersByReference.get(orderReference)
    if (previous) {
      duplicateOrderRows += 1
      if (previous.signature !== signature) {
        conflicts.add(orderReference)
        issues.push({ severity: 'error', code: 'conflicting-order-reference', rowNumber, message: `같은 주문번호의 내용이 ${previous.order.rowNumber}행과 다릅니다. 해당 주문은 자동 반영에서 보류합니다.` })
      } else issues.push({ severity: 'warning', code: 'duplicate-order', rowNumber, message: `같은 주문이 ${previous.order.rowNumber}행에 이미 있어 한 번만 집계합니다.` })
    } else ordersByReference.set(orderReference, { order, signature })
  }
  const orders = [...ordersByReference.values()].map(entry => entry.order).filter(order => !conflicts.has(order.orderReference))
  const customersByIdentity = new Map<string, SalesRawCustomer>()
  for (const order of orders) {
    let customer = customersByIdentity.get(order.identityKey)
    if (!customer) {
      customer = {
        identityKey: order.identityKey, customerName: order.customerName, phoneLast4: order.phoneLast4, orders: [],
        saleAmount: 0, eligibleSaleAmount: 0, expectedCommission: 0, confirmedSaleAmount: 0,
        confirmedEligibleSaleAmount: 0, confirmedExpectedCommission: 0, pendingSaleAmount: 0,
        pendingEligibleSaleAmount: 0, unknownSaleAmount: 0, returnSaleAmount: 0, hasReviewRequired: false,
        reservedSaleAmount: 0, reservedEligibleSaleAmount: 0, tentativeSaleAmount: 0, tentativeEligibleSaleAmount: 0,
        admittedOrderCount: 0, admittedSaleAmount: 0, admittedEligibleSaleAmount: 0, admittedExpectedCommission: 0,
      }
      customersByIdentity.set(order.identityKey, customer)
    }
    customer.orders.push(order)
    customer.saleAmount += order.saleAmount
    if (order.commissionEligible) customer.eligibleSaleAmount += order.saleAmount
    if (order.orderStatus === '확정') {
      customer.confirmedSaleAmount += order.saleAmount
      if (order.commissionEligible) customer.confirmedEligibleSaleAmount += order.saleAmount
    } else if (order.orderStatus === '예약' || order.orderStatus === '가예약') {
      customer.pendingSaleAmount += order.saleAmount
      if (order.commissionEligible) customer.pendingEligibleSaleAmount += order.saleAmount
      if (order.orderStatus === '예약') {
        customer.reservedSaleAmount += order.saleAmount
        if (order.commissionEligible) customer.reservedEligibleSaleAmount += order.saleAmount
      } else {
        customer.tentativeSaleAmount += order.saleAmount
        if (order.commissionEligible) customer.tentativeEligibleSaleAmount += order.saleAmount
      }
    } else customer.unknownSaleAmount += order.saleAmount
    if (order.isReturnOrRefund) customer.returnSaleAmount += order.saleAmount
    customer.hasReviewRequired ||= order.hasReviewRequired
  }
  const customers = [...customersByIdentity.values()]
  for (const customer of customers) {
    customer.expectedCommission = Math.round(customer.eligibleSaleAmount * 0.02)
    customer.confirmedExpectedCommission = Math.round(customer.confirmedEligibleSaleAmount * 0.02)
    customer.admittedOrderCount = customer.orders.filter(order => order.orderStatus !== '기타').length
    customer.admittedSaleAmount = customer.confirmedSaleAmount + customer.reservedSaleAmount + customer.tentativeSaleAmount
    customer.admittedEligibleSaleAmount = customer.confirmedEligibleSaleAmount + customer.reservedEligibleSaleAmount + customer.tentativeEligibleSaleAmount
    customer.admittedExpectedCommission = Math.round(customer.admittedEligibleSaleAmount * 0.02)
  }
  const sum = (key: 'saleAmount' | 'eligibleSaleAmount' | 'confirmedSaleAmount' | 'confirmedEligibleSaleAmount' | 'pendingSaleAmount' | 'expectedCommission' | 'confirmedExpectedCommission' | 'reservedSaleAmount' | 'reservedEligibleSaleAmount' | 'tentativeSaleAmount' | 'tentativeEligibleSaleAmount' | 'admittedOrderCount' | 'admittedSaleAmount' | 'admittedEligibleSaleAmount' | 'admittedExpectedCommission') => customers.reduce((total, customer) => total + customer[key], 0)
  const summary: SalesRawSummary = {
    inputRows, acceptedOrders: orders.length, duplicateOrderRows, conflictingOrders: conflicts.size, customerCount: customers.length,
    confirmedOrders: orders.filter(order => order.orderStatus === '확정').length,
    reservedOrders: orders.filter(order => order.orderStatus === '예약').length,
    tentativeOrders: orders.filter(order => order.orderStatus === '가예약').length,
    unknownStatusOrders: orders.filter(order => order.orderStatus === '기타').length,
    returnOrders: orders.filter(order => order.isReturnOrRefund).length,
    eligibleOrders: orders.filter(order => order.commissionEligible).length,
    ineligibleOrders: orders.filter(order => !order.commissionEligible).length,
    saleAmount: sum('saleAmount'), eligibleSaleAmount: sum('eligibleSaleAmount'), confirmedSaleAmount: sum('confirmedSaleAmount'),
    confirmedEligibleSaleAmount: sum('confirmedEligibleSaleAmount'), pendingSaleAmount: sum('pendingSaleAmount'),
    expectedCommission: sum('expectedCommission'), confirmedExpectedCommission: sum('confirmedExpectedCommission'),
    reservedSaleAmount: sum('reservedSaleAmount'), reservedEligibleSaleAmount: sum('reservedEligibleSaleAmount'),
    tentativeSaleAmount: sum('tentativeSaleAmount'), tentativeEligibleSaleAmount: sum('tentativeEligibleSaleAmount'),
    admittedOrderCount: sum('admittedOrderCount'), admittedSaleAmount: sum('admittedSaleAmount'),
    admittedEligibleSaleAmount: sum('admittedEligibleSaleAmount'), admittedExpectedCommission: sum('admittedExpectedCommission'),
    reviewCustomerCount: customers.filter(customer => customer.hasReviewRequired).length,
    errorCount: issues.filter(issue => issue.severity === 'error').length,
    warningCount: issues.filter(issue => issue.severity === 'warning').length,
  }
  return { orders, customers, issues, summary }
}
