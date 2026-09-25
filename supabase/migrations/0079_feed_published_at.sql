-- ============================================================================
-- 0079 최근 활동에 섞는 업무 밖 움직임의 시각·사람 (사용자 결정 2026-09-25 · 목업 mockup-traces 4)
-- ----------------------------------------------------------------------------
-- 대시보드 '최근 활동'이 주보 발행 · 동아리 모임 일정 · 나눈 QT 묵상을 시간순으로 섞는다
-- (services/feedExtras.js · traces.extraFeedRows). 그러려면 "언제·누가"가 있어야 하는데:
--   · services에는 발행 시각이 없다 — updated_at은 고칠 때마다 밀린다(앱이 저장마다 now를 쓴다).
--     created_by도 비어 있다(라이브 3건 모두 null) → **published_at · published_by**를 더한다.
--   · group_meetings에는 만든 사람이 없다 → **created_by**(기본값 effective_uid())를 더한다.
--   · 알림 행(service_published · meeting_new)은 받는 사람마다 한 행이고 본인 것만 읽혀서 재료가 못 된다.
--
-- 발행 시각·사람은 **트리거가 채운다** — status가 'published'로 바뀌는 순간(또는 발행으로 들어오는 INSERT).
-- 로그인한 사람의 UPDATE는 그 밖의 때에 두 칸을 **조용히 옛 값으로 되돌린다**(0071 칸 가드와 같은 결 —
-- 오류는 내지 않는다). `auth.uid()`가 없으면(psql·서비스 키) 통과하므로 아래 백필은 그대로 먹힌다.
-- (PITFALLS: before update 트리거에서 무조건 `new.X = old.X`를 쓰면 그 칸을 고치는 UPDATE가 전부 무력화된다 —
--  그래서 auth.uid() 조건 안에서만 한다.)
--
-- 백필(근사값): 발행된 주보는 **발행 알림(service_published)의 가장 이른 created_at**, 없으면 updated_at.
-- 발행한 사람은 그 알림의 actor_name과 표시 이름이 **하나만** 맞는 계정. 모임을 잡은 사람은 meeting_new
-- 알림의 링크(g=<동아리>)·미리보기('이름 · 26. 9. 27.')가 맞는 것의 actor_name. 못 찾으면 null로 두고,
-- 화면은 사람을 모르는 줄을 세우지 않는다(거짓 문장이 된다).
-- services·group_meetings에는 updated_at 트리거가 없다(확인 2026-09-25) — cards의 트리거 함정과 무관하다.
--
-- **앱이 이 칸을 읽기 시작한다 — 이 마이그레이션이 먼저 나가야 한다(§3-4).** 다만 읽는 자리(feedExtras)는
-- 갈래마다 실패를 삼키므로, 먼저 나가도 대시보드는 그 줄들이 비는 것뿐이다(오류 화면 없음).
-- ============================================================================
begin;

alter table public.services add column if not exists published_at timestamptz;
alter table public.services add column if not exists published_by uuid references public.profiles(id) on delete set null;
alter table public.group_meetings add column if not exists created_by uuid references public.profiles(id) on delete set null
  default public.effective_uid();

create or replace function public.services_stamp_published()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := now();
    new.published_by := coalesce(public.effective_uid(), new.published_by);
  elsif tg_op = 'UPDATE' and auth.uid() is not null then
    -- 발행 순간이 아닌 때에 로그인한 사람이 두 칸을 바꾸지 못하게(되돌리기만 · 0071과 같은 결)
    new.published_at := old.published_at;
    new.published_by := old.published_by;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_services_stamp_published on public.services;
create trigger trg_services_stamp_published
  before insert or update on public.services
  for each row execute function public.services_stamp_published();

-- 백필 ① 주보 발행 시각·사람
with first_notice as (
  select distinct on (s.id) s.id as service_id, n.created_at, n.actor_name
    from public.services s
    join public.notifications n
      on n.kind = 'service_published' and n.link like '%s=' || s.id::text || '%'
   where s.status = 'published'
   order by s.id, n.created_at asc
), fill as (
  select s.id,
         coalesce(f.created_at, s.updated_at, s.created_at) as at,
         (select p.id from public.profiles p where p.display_name = f.actor_name
            and (select count(*) from public.profiles q where q.display_name = f.actor_name) = 1) as actor_id
    from public.services s
    left join first_notice f on f.service_id = s.id
   where s.status = 'published' and s.published_at is null
)
update public.services s
   set published_at = fill.at, published_by = fill.actor_id
  from fill
 where s.id = fill.id;

-- 백필 ② 모임을 잡은 사람
with first_notice as (
  select distinct on (m.id) m.id as meeting_id, n.actor_name
    from public.group_meetings m
    join public.notifications n
      on n.kind = 'meeting_new'
     and n.link like '%g=' || m.group_id::text || '%'
     and n.preview like '% · ' || to_char(m.meeting_date, 'YY. FMMM. FMDD.')
   where m.created_by is null
   order by m.id, n.created_at asc
)
update public.group_meetings m
   set created_by = (select p.id from public.profiles p where p.display_name = f.actor_name
                      and (select count(*) from public.profiles q where q.display_name = f.actor_name) = 1)
  from first_notice f
 where m.id = f.meeting_id and m.created_by is null;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select id, service_date, status, published_at, published_by from public.services order by service_date desc;
--   select id, group_id, meeting_date, created_by from public.group_meetings order by created_at desc;
--   select tgname from pg_trigger where tgrelid = 'public.services'::regclass and not tgisinternal;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop trigger if exists trg_services_stamp_published on public.services;
--   drop function if exists public.services_stamp_published();
--   alter table public.services drop column if exists published_at;
--   alter table public.services drop column if exists published_by;
--   alter table public.group_meetings drop column if exists created_by;
