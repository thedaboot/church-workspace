-- ============================================================================
-- 0036 — v2 기반 ②: 예배(services·attendance·service_notes) · 말씀(qt_schedule·
--         qt_entries·bible_state)  (2026-09-01 그릴링 확정 — 정본은 docs/V2.md)
-- ----------------------------------------------------------------------------
-- 왜 이 모양인가:
--   · **주보 한 건과 언제나 같이 읽고 쓰는 것(임사자·찬양·광고)은 jsonb 컬럼이다**
--     (HANDOFF §2-1 — 조인은 왕복이 두 번이라 저장이 겹치면 깨진다). 따로 조회·
--     집계할 것은 출석(attendance)뿐이라 그것만 조인 테이블이다.
--   · **예배 종류(kind)는 'sunday'가 기본**(매주 · 주보·출석 대상)이고, 금요 열정·
--     성탄절 같은 이벤트성 예배는 필요할 때 한 건씩 자유 이름으로 만든다(결정 14).
--   · **작성 중(draft) 주보는 편집 자격자에게만 보인다** — 발행해야 전체 공개(결정 5).
--   · **출석의 사람 축은 people이다**(0035). 순장은 자기 순만, 임원·교역자·관리자는
--     전체 — DB에서도 막는다(0029 전례).
--   · **QT 잔디·묵상은 남의 것을 볼 수 없다**(결정 10 — 순장도 순원 잔디를 못 본다).
--     '나누기'를 켠 글만 전체 공개(결정 11). 예배 노트는 기본 본인, '내 순에 공유'를
--     켜면 올해 같은 순 사람만(결정 7). RLS가 그 경계 그 자체다.
--   · 성경 본문은 DB가 아니라 정적 파일(public/bible/*.json — 개역한글, 저작권 만료).
--     DB에는 사용자 상태(bible_state)만 둔다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

-- ── 1. services — 예배(주보) ────────────────────────────────────────────────
create table public.services (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'sunday',   -- 'sunday' 외에는 이벤트성 자유 이름
  service_date    date not null,
  status          text not null default 'draft' check (status in ('draft', 'published')),
  title           text,                             -- 설교 제목
  passage_ref     text,                             -- 본문 구절(예: '이사야 32:9-20')
  preacher        text,                             -- 설교자(자유 텍스트 — 외부 강사도 온다)
  roles           jsonb not null default '[]',      -- 임사자 [{role, person_id?, name}]
  songs           jsonb not null default '[]',      -- 찬양 [{title, link?}]
  notices         jsonb not null default '[]',      -- 광고 [{title, body}]
  attendance_note text,                             -- 출석 메모
  created_by      uuid references auth.users,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- 주일 4부는 한 날짜에 한 건
create unique index services_one_sunday on public.services (service_date) where kind = 'sunday';
create index services_by_date on public.services (service_date desc);
alter table public.services enable row level security;

-- 주보 편집 자격: 회장 + 교역자 + 마스터 (docs/V2.md 권한 표)
create or replace function public.can_edit_service()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_master() or public.is_pastor() or public.has_role('president');
$$;
revoke all on function public.can_edit_service() from public;
grant execute on function public.can_edit_service() to authenticated;

create policy services_select on public.services
  for select using (
    public.is_approved() and (status = 'published' or public.can_edit_service())
  );
create policy services_write on public.services
  for all using (public.can_edit_service()) with check (public.can_edit_service());

-- ── 2. attendance — 예배 출석 ───────────────────────────────────────────────
-- 행이 있으면 출석. 지우면 취소. 누가 체크했는지 남긴다(집계·되짚기용, 화면 노출 아님)
create table public.attendance (
  service_id  uuid not null references public.services(id) on delete cascade,
  person_id   uuid not null references public.people(id) on delete cascade,
  checked_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (service_id, person_id)
);
create index attendance_person on public.attendance (person_id);
alter table public.attendance enable row level security;

create policy attendance_select on public.attendance
  for select using (public.is_approved());
-- 전체 자격자(관리자·교역자·올해 임원)거나, 그 사람이 올해 내 순의 순원일 때
create policy attendance_insert on public.attendance
  for insert with check (
    public.is_approved()
    and (public.can_check_all_attendance() or public.leads_sun_of(person_id))
  );
create policy attendance_delete on public.attendance
  for delete using (
    public.is_approved()
    and (public.can_check_all_attendance() or public.leads_sun_of(person_id))
  );

-- ── 3. service_notes — 예배 노트 ────────────────────────────────────────────
create table public.service_notes (
  id            uuid primary key default gen_random_uuid(),
  service_id    uuid not null references public.services(id) on delete cascade,
  profile_id    uuid not null default auth.uid() references public.profiles(id),
  body          text not null default '',
  shared_to_sun boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (service_id, profile_id)                    -- 예배당 노트 하나
);
alter table public.service_notes enable row level security;

-- 두 가입자가 올해 같은 순인가(순장은 명단에 없어도 그 순 소속으로 본다).
-- ponytail: 공유 판정은 '올해' 순 기준 하나다 — 지난 해 노트를 그때 순으로 가르는
-- 정밀함이 필요해지면 그때 연도 인자를 받는다.
create or replace function public.same_sun(other_profile uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  with mine as (
    select g.id from public.groups g
    left join public.group_members gm on gm.group_id = g.id
    join public.people p on p.id in (gm.person_id, g.leader_person_id)
    where g.type = 'sun' and g.year = public.kst_year() and g.removed_at is null
      and p.profile_id = auth.uid()
  ),
  theirs as (
    select g.id from public.groups g
    left join public.group_members gm on gm.group_id = g.id
    join public.people p on p.id in (gm.person_id, g.leader_person_id)
    where g.type = 'sun' and g.year = public.kst_year() and g.removed_at is null
      and p.profile_id = other_profile
  )
  select exists (select 1 from mine m join theirs t on m.id = t.id);
$$;
revoke all on function public.same_sun(uuid) from public;
grant execute on function public.same_sun(uuid) to authenticated;

create policy service_notes_select on public.service_notes
  for select using (
    profile_id = auth.uid()
    or (shared_to_sun and public.is_approved() and public.same_sun(profile_id))
  );
create policy service_notes_write on public.service_notes
  for all using (profile_id = auth.uid() and public.is_approved())
  with check (profile_id = auth.uid() and public.is_approved());

-- ── 4. qt_schedule — 매일성경 본문 일정 (마스터가 월 단위 붙여넣기) ─────────
-- 해설·묵상 콘텐츠는 성서유니온 저작물이라 싣지 않는다. 구절 참조만.
create table public.qt_schedule (
  qt_date     date primary key,
  passage_ref text not null,
  label       text                                   -- 그날 제목(있으면)
);
alter table public.qt_schedule enable row level security;

create policy qt_schedule_select on public.qt_schedule
  for select using (public.is_approved());
create policy qt_schedule_write on public.qt_schedule
  for all using (public.is_master()) with check (public.is_master());

-- ── 5. qt_entries — 내 묵상 기록 ────────────────────────────────────────────
create table public.qt_entries (
  id          uuid primary key default gen_random_uuid(),
  qt_date     date not null,
  profile_id  uuid not null default auth.uid() references public.profiles(id),
  body        text not null default '',
  shared      boolean not null default false,        -- 켜면 그날 나눔 피드에 전체 공개
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (qt_date, profile_id)
);
create index qt_entries_mine on public.qt_entries (profile_id, qt_date desc);
alter table public.qt_entries enable row level security;

create policy qt_entries_select on public.qt_entries
  for select using (
    profile_id = auth.uid() or (shared and public.is_approved())
  );
create policy qt_entries_write on public.qt_entries
  for all using (profile_id = auth.uid() and public.is_approved())
  with check (profile_id = auth.uid() and public.is_approved());

-- ── 6. bible_state — 성경 읽기 상태(이어읽기·북마크) ────────────────────────
create table public.bible_state (
  profile_id  uuid primary key default auth.uid() references public.profiles(id),
  last_ref    text,                                  -- 마지막 위치(예: 'gen 3')
  bookmarks   jsonb not null default '[]',           -- [{ref, label?, at}]
  updated_at  timestamptz not null default now()
);
alter table public.bible_state enable row level security;

create policy bible_state_own on public.bible_state
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.is_approved());

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select tablename, policyname, cmd from pg_policies where schemaname='public'
--     and tablename in ('services','attendance','service_notes','qt_schedule',
--                       'qt_entries','bible_state') order by tablename;
--   -- draft 주보가 일반 멤버에게 안 보이는지(0022 방식 — 트랜잭션 + rollback):
--   --   begin; set local role authenticated;
--   --   select set_config('request.jwt.claims', '{"sub":"<일반 멤버 uuid>","email":"x@y.z"}', true);
--   --   insert 시도(막혀야 한다) · select count(*) from services where status='draft'; -- 0
--   --   rollback;

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- drop table if exists public.bible_state;
-- drop table if exists public.qt_entries;
-- drop table if exists public.qt_schedule;
-- drop table if exists public.service_notes;
-- drop function if exists public.same_sun(uuid);
-- drop table if exists public.attendance;
-- drop table if exists public.services;
-- drop function if exists public.can_edit_service();
