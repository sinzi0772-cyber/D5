import type { Lead } from './types'

export const demoLeads: Lead[] = [
  { id:'demo-001', registeredAt:'2026-09-15', customerName:'김*모', phoneLast4:'0001', gender:'미입력', visitScheduledDate:'2026-09-20', partnerName:'데모 제휴업체 A', manager:'백현승', plannerName:'예시 플래너', status:'관리중', visitState:'예정', updatedAt:'2026-09-15T09:00:00+09:00' },
  { id:'demo-002', registeredAt:'2026-09-14', customerName:'이*객', phoneLast4:'0002', gender:'미입력', visitScheduledDate:'2026-09-21', partnerName:'데모 제휴업체 B', manager:'한동민', status:'관리중', visitState:'예정', updatedAt:'2026-09-14T09:00:00+09:00' },
  { id:'demo-003', registeredAt:'2026-09-13', customerName:'박*시', phoneLast4:'0003', gender:'미입력', partnerName:'데모 제휴업체 A', manager:'', status:'관리중', visitState:'미정', updatedAt:'2026-09-13T09:00:00+09:00' },
  { id:'demo-004', registeredAt:'2026-09-12', customerName:'최*용', phoneLast4:'0004', gender:'미입력', visitScheduledDate:'2026-09-18', partnerName:'데모 제휴업체 C', manager:'김민범', status:'구매완료', visitState:'방문', updatedAt:'2026-09-12T09:00:00+09:00' },
  { id:'demo-005', registeredAt:'2026-09-11', customerName:'정*자', phoneLast4:'0005', gender:'미입력', partnerName:'데모 제휴업체 B', manager:'복기철', status:'취소', visitState:'일정취소', updatedAt:'2026-09-11T09:00:00+09:00' },
]
