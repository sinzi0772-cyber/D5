import { useEffect, useId, useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import type { Lead } from '../types'
import { deliveryDateValidationMessage, expectedSettlementMonthFor, isValidDeliveryDate } from '../lib/commissionSettlement'
import { normalizeDeliveryDateInput } from '../lib/deliveryDateInput'
import { normalizeLgeDeliveryRequestedDate } from '../lib/salesRaw'

/** A locale-independent text field, with the browser calendar as an optional picker. */
export function DeliveryScheduleField({ lead, onChange }: { lead: Lead; onChange: (date: string) => void }) {
  const id = useId()
  const textRef = useRef<HTMLInputElement>(null)
  const calendarRef = useRef<HTMLInputElement>(null)
  const date = lead.deliveryScheduledDate || ''
  const valid = isValidDeliveryDate(date)
  const deliveryError = deliveryDateValidationMessage(lead)
  const settlementMonth = expectedSettlementMonthFor(lead)
  const requestedDates = [...new Set(Object.values(lead.salesRawPeriods ?? {}).flatMap(period =>
    Array.isArray(period?.lgeDeliveryRequestedDates) ? period.lgeDeliveryRequestedDates : []
  ).map(normalizeLgeDeliveryRequestedDate).filter((value): value is string => value !== undefined))].sort()
  const helpId = `${id}-help`
  const invalidMessage = '올바른 날짜를 YYYY-MM-DD 형식으로 입력해주세요.'

  useEffect(() => { textRef.current?.setCustomValidity(date && !valid ? invalidMessage : '') }, [date, valid])

  const openCalendar = () => {
    try {
      if (calendarRef.current?.showPicker) { calendarRef.current.showPicker(); return }
    } catch { /* Text entry remains available when the browser disallows its picker. */ }
    textRef.current?.focus()
  }

  return <div className="delivery-schedule-field">
    <label htmlFor={id}>배송예정일 <small className="delivery-required">{lead.status === '구매완료' ? '필수 입력' : '구매완료 시 필수'}</small></label>
    <div className="delivery-date-control">
      <input ref={textRef} id={id} type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
        aria-label="배송예정일" aria-describedby={helpId} required={lead.status === '구매완료'}
        aria-invalid={Boolean(deliveryError && date)} placeholder="YYYY-MM-DD" maxLength={10}
        pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" value={date}
        onChange={event => {
          const next = normalizeDeliveryDateInput(event.target.value)
          event.target.setCustomValidity(next && !isValidDeliveryDate(next) ? invalidMessage : '')
          onChange(next)
        }}/>
      <button type="button" className="delivery-calendar-button" aria-label="배송예정일 달력 열기" onClick={openCalendar}><CalendarDays size={16} aria-hidden="true"/></button>
      <input ref={calendarRef} className="delivery-native-calendar" type="date" tabIndex={-1} aria-hidden="true"
        min="0001-01-01" max="9999-12-31" value={valid ? date : ''} onChange={event => onChange(event.target.value)}/>
    </div>
    <small id={helpId} className={deliveryError ? 'delivery-schedule-help delivery-schedule-error' : 'delivery-schedule-help'}>{deliveryError || (settlementMonth ? `${settlementMonth.replace('-', '.')} 중순 정산 예상${lead.status === '구매완료' ? '' : ' · 구매완료 처리 후 월별 집계'}` : '배송월의 익익월 중순 정산 예상')}</small>
    <small className="delivery-schedule-help">수령월에 따라 정산월이 달라질 수 있습니다.</small>
    {requestedDates.length > 0 && <small className="delivery-schedule-help">
      일시불 LGE 배송요청일 {requestedDates.map((value, index) => <span key={value}>{index > 0 ? ", " : null}<time dateTime={value}>{value.replaceAll('-', '.')}</time></span>)}
    </small>}
  </div>
}
