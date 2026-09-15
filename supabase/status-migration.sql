-- 기존 Supabase 프로젝트의 현재 상태를 3가지로 단순화합니다.
-- Supabase SQL Editor에서 한 번 실행하세요.

begin;

alter table public.referrals alter column status drop default;
alter table public.referrals alter column status type text using status::text;

update public.referrals
set status = case
  when status in ('계약완료', '구매완료') then '구매완료'
  when status in ('종결', '취소') then '취소'
  else '관리중'
end;

drop type public.lead_status;
create type public.lead_status as enum ('관리중', '구매완료', '취소');

alter table public.referrals
  alter column status type public.lead_status using status::public.lead_status,
  alter column status set default '관리중';

commit;
