-- D5 Partner Desk production schema
-- Supabase SQL Editor에서 전체 실행하세요. 기존 초기 스키마 위에서도 다시 실행할 수 있습니다.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'store_manager', 'assistant_manager', 'manager');
exception when duplicate_object then null;
end $$;
alter type public.app_role add value if not exists 'store_manager';
alter type public.app_role add value if not exists 'assistant_manager';

do $$ begin
  create type public.lead_status as enum ('관리중','구매완료','취소');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.visit_state as enum ('미정','예정','방문','미방문','일정취소');
exception when duplicate_object then null;
end $$;
alter type public.visit_state add value if not exists '일정취소';

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_no text unique,
  display_name text not null,
  role public.app_role not null default 'manager',
  position_label text,
  organization text not null default 'LG전자 플래그십 D5',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists employee_no text;
alter table public.profiles add column if not exists position_label text;
alter table public.profiles add column if not exists organization text not null default 'LG전자 플래그십 D5';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
create unique index if not exists profiles_employee_no_key on public.profiles(employee_no) where employee_no is not null;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  registered_at date not null default current_date,
  customer_name_masked text not null check (char_length(customer_name_masked) <= 20),
  phone_last4 text not null check (phone_last4 ~ '^[0-9]{4}$'),
  gender text not null default '미입력' check (gender in ('남','여','미입력')),
  visit_scheduled_date date,
  partner_name text not null,
  bill_to_code text,
  lge_subchannel text,
  assigned_manager_id uuid references public.profiles(id),
  manager_employee_no text,
  manager_name text,
  planner_name text,
  status public.lead_status not null default '관리중',
  visit_state public.visit_state not null default '미정',
  note text,
  memo_history jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.referrals add column if not exists manager_employee_no text;
create index if not exists referrals_registered_at_idx on public.referrals (registered_at desc);
create index if not exists referrals_assigned_manager_idx on public.referrals (assigned_manager_id);
create index if not exists referrals_manager_employee_no_idx on public.referrals (manager_employee_no);
create index if not exists referrals_partner_name_idx on public.referrals (partner_name);
create index if not exists referrals_updated_at_idx on public.referrals (updated_at desc);

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  referral_id uuid,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  actor_id uuid references auth.users(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_referral_idx on public.activity_logs(referral_id, created_at desc);

create or replace function public.can_manage_all()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role::text in ('admin','store_manager','assistant_manager')
  );
$$;
revoke all on function public.can_manage_all() from public;
grant execute on function public.can_manage_all() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text = 'admin');
$fn$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.current_employee_no()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select employee_no from public.profiles where id = auth.uid();
$$;
revoke all on function public.current_employee_no() from public;
grant execute on function public.current_employee_no() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists referrals_set_updated_at on public.referrals;
create trigger referrals_set_updated_at
before update on public.referrals
for each row execute procedure public.set_updated_at();

create or replace function public.protect_referral_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.can_manage_all() and (
    new.registered_at is distinct from old.registered_at or
    new.customer_name_masked is distinct from old.customer_name_masked or
    new.phone_last4 is distinct from old.phone_last4 or
    new.gender is distinct from old.gender or
    new.partner_name is distinct from old.partner_name or
    new.bill_to_code is distinct from old.bill_to_code or
    new.lge_subchannel is distinct from old.lge_subchannel or
    new.assigned_manager_id is distinct from old.assigned_manager_id or
    new.manager_employee_no is distinct from old.manager_employee_no or
    new.manager_name is distinct from old.manager_name or
    new.planner_name is distinct from old.planner_name
  ) then
    raise exception '배정된 매니저는 고객 기본정보와 담당자를 변경할 수 없습니다.' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists referrals_protect_identity on public.referrals;
create trigger referrals_protect_identity
before update on public.referrals
for each row execute procedure public.protect_referral_identity();

create or replace function public.log_referral_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_logs(referral_id, action, actor_id, before_data, after_data)
  values (
    coalesce(new.id, old.id),
    tg_op,
    auth.uid(),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists referrals_activity_log on public.referrals;
create trigger referrals_activity_log
after insert or update or delete on public.referrals
for each row execute procedure public.log_referral_change();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, employee_no, display_name, role, position_label)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'employee_no',''),
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    'manager',
    coalesce(nullif(new.raw_user_meta_data->>'position_label',''), '매니저')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.referrals enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists "read own profile or admin" on public.profiles;
drop policy if exists "update own profile name only" on public.profiles;
drop policy if exists "authenticated reads staff directory" on public.profiles;
drop policy if exists "management updates profiles" on public.profiles;
create policy "authenticated reads staff directory"
on public.profiles for select to authenticated
using (true);
create policy "management updates profiles"
on public.profiles for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admin reads all; manager reads assigned" on public.referrals;
drop policy if exists "admin creates referrals" on public.referrals;
drop policy if exists "admin updates all; manager updates assigned" on public.referrals;
drop policy if exists "admin deletes referrals" on public.referrals;
drop policy if exists "management or assigned manager reads" on public.referrals;
drop policy if exists "management creates referrals" on public.referrals;
drop policy if exists "management or assigned manager updates" on public.referrals;
drop policy if exists "management deletes referrals" on public.referrals;

create policy "management or assigned manager reads"
on public.referrals for select to authenticated
using (
  public.can_manage_all()
  or assigned_manager_id = auth.uid()
  or manager_employee_no = public.current_employee_no()
);
create policy "management creates referrals"
on public.referrals for insert to authenticated
with check (public.can_manage_all() and created_by = auth.uid());
create policy "management or assigned manager updates"
on public.referrals for update to authenticated
using (
  public.can_manage_all()
  or assigned_manager_id = auth.uid()
  or manager_employee_no = public.current_employee_no()
)
with check (
  public.can_manage_all()
  or assigned_manager_id = auth.uid()
  or manager_employee_no = public.current_employee_no()
);
create policy "management deletes referrals"
on public.referrals for delete to authenticated
using (public.can_manage_all());

drop policy if exists "management reads logs" on public.activity_logs;
create policy "management reads logs"
on public.activity_logs for select to authenticated
using (public.can_manage_all() or actor_id = auth.uid());

revoke all on public.profiles, public.referrals, public.activity_logs from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.referrals to authenticated;
grant select on public.activity_logs to authenticated;

-- 최초 관리자 설정 예시:
-- 1) Authentication > Users에서 계정 생성 (이메일: 12784@d5.local)
-- 2) 생성된 UUID를 아래 AUTH_USER_UUID에 넣어 실행
-- update public.profiles
-- set employee_no='12784', display_name='D5 관리자', role='admin', position_label='관리자'
-- where id='AUTH_USER_UUID';
