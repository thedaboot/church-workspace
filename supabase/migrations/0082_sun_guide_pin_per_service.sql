-- ============================================================================
-- 0082 — 순모임 가이드 고정은 주보마다 (사용자 결정 2026-09-25)
-- ----------------------------------------------------------------------------
-- 0055는 "고정은 한 번에 하나"였다 — 새 주보의 가이드를 고정하면 함수가 다른 주보의
-- 고정을 먼저 풀었다. 사용자: "한 날짜에 하나씩 고정하는 방식이 아니었던가? …
-- 다른 주보 고정 못 풀게!" — 가이드는 이미 주보마다 한 행이라, 고정은 **그 주보의
-- 확정본**이라는 뜻이 된다.
--
-- ① 한 번에 하나를 박던 부분 유니크 인덱스를 걷는다.
-- ② set_sun_guide_pinned가 다른 행을 끄지 않는다(자격 판정·42501·P0002는 그대로).
-- ③ **최종본 보관**(사용자: "고정되고 수정된 최종본만 DB에 저장해 두고, 나중에 쓸 일이
--    있을 수 있으니"). sun_guide_finals에 주보당 한 행 — 고정된 상태로 들어가거나
--    고정된 채 고쳐질 때마다 트리거가 그 본문으로 덮는다. 고정을 풀어도, 다시 만들어
--    본문이 바뀌어도 보관본은 남는다(다시 고정하면 그때의 본문으로 덮인다).
--    쓰기 정책은 두지 않는다 — 트리거(security definer)만 쓴다. 읽기는 원본과 같은 경계.
--
-- 고정 알림(0077 pin_notified_at)은 그대로 **가이드당 한 번**이다 — 풀었다 다시 걸어도 안 간다.
-- 화면이 처음 여는 한 벌은 '고정된 것 중 가장 최근 주보'로 바뀐다(services/sunGuide.js).
-- ============================================================================
begin;

drop index if exists public.sun_guides_one_pinned;

create or replace function public.set_sun_guide_pinned(p_service_id uuid, p_on boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_approved() then
    raise exception '승인된 멤버만 순모임 가이드를 고정할 수 있습니다' using errcode = '42501';
  end if;
  if not public.is_master() then
    raise exception '순모임 가이드 고정은 마스터만 할 수 있습니다' using errcode = '42501';
  end if;

  if p_on then
    update public.sun_guides
       set pinned = true, pinned_at = now(), pinned_by = auth.uid()
     where service_id = p_service_id;
  else
    update public.sun_guides
       set pinned = false, pinned_at = null, pinned_by = null
     where service_id = p_service_id;
  end if;

  if not found then
    raise exception '순모임 가이드를 찾지 못했습니다' using errcode = 'P0002';
  end if;

  return p_on;
end;
$$;

comment on function public.set_sun_guide_pinned(uuid, boolean) is
  '순모임 가이드 고정 스위치 — 마스터만. 주보마다 따로(다른 주보의 고정은 건드리지 않는다, 0082)';

create table if not exists public.sun_guide_finals (
  service_id uuid primary key references public.services(id) on delete cascade,
  body       jsonb not null,
  pinned_at  timestamptz,
  saved_at   timestamptz not null default now()
);
alter table public.sun_guide_finals enable row level security;
drop policy if exists sun_guide_finals_select on public.sun_guide_finals;
create policy sun_guide_finals_select on public.sun_guide_finals
  for select using (public.is_approved() and (public.leads_any_sun() or public.can_manage_sun()));

create or replace function public.keep_sun_guide_final()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.pinned then
    insert into public.sun_guide_finals (service_id, body, pinned_at, saved_at)
    values (new.service_id, new.body, new.pinned_at, now())
    on conflict (service_id) do update
      set body = excluded.body, pinned_at = excluded.pinned_at, saved_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sun_guides_keep_final on public.sun_guides;
create trigger trg_sun_guides_keep_final
  after insert or update of pinned, body on public.sun_guides
  for each row execute function public.keep_sun_guide_final();

-- 지금 고정된 행은 바로 보관한다
insert into public.sun_guide_finals (service_id, body, pinned_at, saved_at)
select service_id, body, pinned_at, now() from public.sun_guides where pinned
on conflict (service_id) do nothing;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select indexname from pg_indexes where indexname = 'sun_guides_one_pinned';   -- 0행
--   select service_id, pinned_at, saved_at from public.sun_guide_finals;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- (고정된 행이 둘 이상이면 인덱스가 다시 안 걸린다 — 하나만 남기고 푼 뒤에)
--   drop trigger if exists trg_sun_guides_keep_final on public.sun_guides;
--   drop function if exists public.keep_sun_guide_final();
--   drop table if exists public.sun_guide_finals;
--   create unique index sun_guides_one_pinned on public.sun_guides (pinned) where pinned;
--   그리고 0055의 set_sun_guide_pinned 본문(켤 때 다른 행을 먼저 끈다)을 다시 만든다.
