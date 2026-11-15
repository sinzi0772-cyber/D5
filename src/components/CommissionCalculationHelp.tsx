import type { Lead } from '../types'
import { EXPECTED_COMMISSION_PERCENT, expectedRebateBreakdownFor, isSubscriptionRebatePartner, lumpSumAmountFor, manualCommissionBasisUsedFor, subscriptionAmountFor } from '../lib/salesFinance'
import './CommissionCalculationHelp.css'

const formatWon = (value: number) => `${value.toLocaleString('ko-KR')}원`

export function CommissionCalculationHelp({ lead }: { lead: Lead }) {
  const breakdown = expectedRebateBreakdownFor(lead)
  const methods = [
    { label: '일시불', entered: lumpSumAmountFor(lead), basis: breakdown.lumpSumBasis, fee: breakdown.lumpSumCommission,
      rate: EXPECTED_COMMISSION_PERCENT.lumpSum, applicable: true, manual: manualCommissionBasisUsedFor(lead, 'lumpSum') },
    { label: '구독', entered: subscriptionAmountFor(lead), basis: breakdown.subscriptionBasis, fee: breakdown.subscriptionCommission,
      rate: EXPECTED_COMMISSION_PERCENT.subscription, applicable: isSubscriptionRebatePartner(lead.partnerName),
      manual: manualCommissionBasisUsedFor(lead, 'subscription') },
  ].filter(method => method.entered > 0 || method.basis > 0)
  if (!methods.length) return null

  return <details className="commission-calculation-help" onClick={event => event.stopPropagation()}>
    <summary>수수료 계산 도움말</summary>
    <dl>{methods.map(({ label, basis, fee, rate, applicable, manual }) => <div key={label}>
      <dt>{label}</dt>
      <dd>{basis > 0 ? <>{formatWon(basis)} × {rate}% = <b>{formatWon(fee)}</b>{manual ? ' · 수기 입력 기준' : ''}</>
        : <>{formatWon(fee)} · {applicable ? '정산 기준액 미반영' : '수수료 대상 업체 아님'}</>}</dd>
    </div>)}</dl>
    <p>구매 방식별로 확인된 판매 원본을 우선 적용합니다. 수기 입력 기준 금액은 실제 정산액과 다를 수 있습니다.</p>
  </details>
}

