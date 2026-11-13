import { useEffect, useId, useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import type { Lead } from '../types'
import { deliveryDateValidationMessage, expectedSettlementMonthFor, isValidDeliveryDate } from '../lib/commissionSettlement'
import { normalizeDeliveryDateInput } from '../lib/deliveryDateInput'
import { deliveryScheduleFor, isValidDeliverySchedule, rawDeliveryRequestDatesFor } from '../lib/deliverySchedule'

/** A locale-independent text field, with the browser calendar as an optional picker. */
export function DeliveryScheduleField({ lead, onChange }: { lead: Lead; onChange: (date: string) => void }) {
  const id = useId()
  const textRef = useRef<HTMLInputElement>(null)
  const calendarRef = useRef<HTMLInputElement>(null)
  const date = lead.deliveryScheduledDate || ''
  const valid = isValidDeliveryDate(date)
  const deliveryError = deliveryDateValidationMessage(lead)
  const settlementMonth = expectedSettlementMonthFor(lead)
  const schedule = deliveryScheduleFor(lead)
  const { lumpSum, subscription } = rawDeliveryRequestDatesFor(lead)
  const sourceMonths = new Set([...lumpSum, ...subscription].map(value => value.slice(0, 7)))
  const helpId = `${id}-help`
  const invalidMessage = '배송예정일은 YYYY-MM 또는 YYYY-MM-DD로 입력해주세요.'

  useEffect(() => { textRef.current?.setCustomValidity(date && !isValidDeliverySchedule(date) ? invalidMessage : '') }, [date])

  const openCalendar = () => {
    try {
      if (calendarRef.current?.showPicker) { calendarRef.current.showPicker(); return }
    } catch { /* Text entry remains available when the browser disallows its picker. */ }
    textRef.current?.focus()
  }

  const dateLabel = (value: string) => value.length === 7
    ? value.slice(0, 4) + '년 ' + Number(value.slice(5)) + '월'
    : value.replaceAll('-', '.')

  return <div className="delivery-schedule-field">
    <label htmlFor={id}>배송예정일 {lead.status === '구매완료' && !schedule && <small className="delivery-required">필수 입력</small>}</label>
    <div className="delivery-date-control">
      <input ref={textRef} id={id} type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
        aria-label="배송예정일" aria-describedby={helpId} required={lead.status === '구매완료' && !schedule}
        aria-invalid={Boolean(deliveryError && date)} placeholder="YYYY-MM 또는 YYYY-MM-DD" maxLength={10}
        pattern="[0-9]{4}-[0-9]{2}(-[0-9]{2})?" value={date}
        onChange={event => {
          const next = normalizeDeliveryDateInput(event.target.value)
          event.target.setCustomValidity(next && !isValidDeliverySchedule(next) ? invalidMessage : '')
          onChange(next)
        }}/>
      <button type="button" className="delivery-calendar-button" aria-label="배송예정일 달력 열기" onClick={openCalendar}><CalendarDays size={16} aria-hidden="true"/></button>
      <input ref={calendarRef} className="delivery-native-calendar" type="date" tabIndex={-1} aria-hidden="true"
        min="0001-01-01" max="9999-12-31" value={valid ? date : ''} onChange={event => onChange(event.target.value)}/>
    </div>
    <small id={helpId} className={deliveryError ? 'delivery-schedule-help delivery-schedule-error' : 'delivery-schedule-help'}>{deliveryError || (settlementMonth ? `${settlementMonth.replace('-', '.')} 중순 정산 예상${lead.status === '구매완료' ? '' : ' · 구매완료 처리 후 월별 집계'}` : '배송월의 익익월 중순 정산 예상')}</small>
    <small className="delivery-schedule-help">수령월에 따라 정산월이 달라질 수 있습니다.</small>
    {!date && schedule && <small className="delivery-schedule-help">{schedule.length === 7 ? '배송예정월' : '배송예정일'} <time dateTime={schedule}>{dateLabel(schedule)}</time></small>}
    {sourceMonths.size > 1 && !date && <small className="delivery-schedule-help">배송요청월이 서로 다릅니다.</small>}
    {([['일시불 LGE 배송요청일', lumpSum], ['구독 배송요청일', subscription]] as const).map(([label, dates]) => dates.length > 0 &&
      <small key={label} className="delivery-schedule-help">{label} {dates.map((value, index) =>
        <span key={value}>{index > 0 && ', '}<time dateTime={value}>{dateLabel(value)}</time></span>)}</small>)}
  </div>
}
