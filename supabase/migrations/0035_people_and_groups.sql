-- ============================================================================
-- 0035 — v2 기반 ①: 명단(people) · 연도별 직분(people_roles) · 모임(groups)
--         (2026-09-01 그릴링 확정 — 스펙 정본은 docs/V2.md)
-- ----------------------------------------------------------------------------
-- 왜 이 모양인가:
--   · **명단과 계정을 가른다.** 청년 ~50명 중 가입자는 일부다(docs/AI.md — "워크
--     스페이스 가입자가 청년부 전부가 아니다"). 출석·순 편성의 사람 축은 계정
--     (profiles)이 아니라 명단(people)이고, 가입하면 people.profile_id로 잇는다.
--     §7의 '미가입자 명단' 보류 항목을 이 마이그레이션이 푼다.
--   · **계정 연결은 관리자가 화면에서 명시적으로 한다.** 이름 자동 매칭은 안 한다 —
--     이름으로 사람을 매다는 방식은 §6-26에서 이미 깨졌다(동명이인·개명).
--   · **순과 동아리는 한 벌(groups.type)이다.** 명단·리더·모임 부품을 두 번 만들지
--     않기 위해서다. 순은 연도별 편성(year)이라 개편해도 지난 출석이 그 시절 순
--     기준으로 남고, 동아리는 연도가 없다.
--   · **직분은 권한에 쓰이는 것만 구조화한다**(연도별 — 임원진은 해마다 바뀐다).
--     president(회장)·lead_sunjang(리더순장)·officer(임원). 교역자는 연도와 무관해서
--     people.is_pastor 불리언이다. 총무·팀장 같은 나머지 직함은 지금처럼
--     profiles.role_note 자유 텍스트(AI 호칭·표시용)로 남는다.
--   · 권한 표(docs/V2.md §1): 명단 관리 = 마스터+관리자 · 순 편성 = 마스터+교역자+
--     리더순장 · 동아리 개설·리더 지정 = 마스터만 · 동아리 수락 = 그 동아리 리더 ·
--     새신자 등록(미등록 출석자 추가) = 출석 체크 자격자. 화면만이 아니라 DB에서도
--     막는다(0029 전례).
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

-- ── 1. people — 명단 ─────────────────────────────────────────────────────────
create table public.people (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- 생일은 profiles.birthday와 같은 'MM-DD' 관례(0019) — 화면 부품을 같이 쓴다
  birthday    text,
  -- 사역 팀 표시용(여러 팀 가능). 워크스페이스의 팀 축은 여전히 profiles 쪽이고
  -- 이 값은 명단 화면 표시와 가입 시 참고용이다
  teams       text[] not null default '{}',
  is_pastor   boolean not null default false,
  -- 가입하면 관리자가 화면에서 잇는다. 한 계정은 한 사람에게만
  profile_id  uuid unique references public.profiles(id),
  note        text,
  removed_at  timestamptz,          -- 환송(profiles.removed_at과 같은 뜻) — 행은 남는다
  created_at  timestamptz not null default now()
);
alter table public.people add constraint people_birthday_mmdd
  check (birthday is null or birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
alter table public.people enable row level security;

-- ── 2. people_roles — 연도별 직분 (권한용 최소 집합) ─────────────────────────
create table public.people_roles (
  person_id  uuid not null references public.people(id) on delete cascade,
  year       int  not null,
  role       text not null check (role in ('president', 'lead_sunjang', 'officer')),
  primary key (person_id, year, role)
);
alter table public.people_roles enable row level security;

-- ── 3. groups — 모임(순·동아리 한 벌) ───────────────────────────────────────
create table public.groups (
  id                uuid primary key default gen_random_uuid(),
  type              text not null check (type in ('sun', 'club')),
  name              text not null,
  year              int,                        -- 순만. 동아리는 null
  leader_person_id  uuid references public.people(id),
  note              text,
  removed_at        timestamptz,
  created_at        timestamptz not null default now(),
  constraint groups_sun_needs_year check (type <> 'sun' or year is not null)
);
alter table public.groups enable row level security;

create table public.group_members (
  group_id   uuid not null references public.groups(id) on delete cascade,
  person_id  uuid not null references public.people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, person_id)
);
create index group_members_person on public.group_members (person_id);
alter table public.group_members enable row level security;

-- 동아리 가입 신청. 신청은 본인(가입자)만 하므로 person은 계정이 이어진 사람이다
create table public.club_applications (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  person_id   uuid not null references public.people(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users
);
-- 같은 동아리에 대기 신청은 한 건만
create unique index club_applications_one_pending
  on public.club_applications (group_id, person_id) where status = 'pending';
alter table public.club_applications enable row level security;

-- 모임 일정·출석(동아리 모임, 순모임). 출석은 person id 배열 jsonb —
-- 예배 출석과 달리 따로 조회·집계할 일이 적어 컬럼이 맞다(HANDOFF §2-1)
create table public.group_meetings (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  meeting_date date not null,
  title       text,
  attendance  jsonb not null default '[]',
  note        text,
  created_at  timestamptz not null default now()
);
create index group_meetings_group on public.group_meetings (group_id, meeting_date);
alter table public.group_meetings enable row level security;

-- ── 4. 권한 헬퍼 ─────────────────────────────────────────────────────────────
-- is_admin()·is_master()·is_approved()와 같은 모양(security definer + search_path
-- 고정 — 0011 어드바이저 경고를 다시 만들지 않는다).

-- 연도 판정은 한국 시간 기준(now()는 UTC라 연말연시에 하루 어긋난다)
create or replace function public.kst_year()
returns int language sql stable
as $$ select extract(year from (now() at time zone 'Asia/Seoul'))::int $$;

-- 내 명단 행(없으면 null — 계정은 있는데 명단에 안 이어진 사람)
create or replace function public.my_person_id()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select p.id from public.people p
  where p.profile_id = auth.uid() and p.removed_at is null;
$$;

create or replace function public.is_pastor()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.people p
    where p.profile_id = auth.uid() and p.is_pastor and p.removed_at is null
  );
$$;

-- 올해 그 직분인가
create or replace function public.has_role(r text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.people_roles pr
    where pr.person_id = public.my_person_id()
      and pr.year = public.kst_year() and pr.role = r
  );
$$;

-- 올해 임원인가(회장·리더순장·임원 아무 줄이나)
create or replace function public.is_officer()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.people_roles pr
    where pr.person_id = public.my_person_id() and pr.year = public.kst_year()
  );
$$;

-- 순 편성 자격: 마스터 + 교역자 + 리더순장 (docs/V2.md 권한 표)
create or replace function public.can_manage_sun()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_master() or public.is_pastor() or public.has_role('lead_sunjang');
$$;

-- 전체 출석 체크 자격: 관리자 + 교역자 + 올해 임원
create or replace function public.can_check_all_attendance()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_admin() or public.is_pastor() or public.is_officer();
$$;

-- 내가 올해 어느 순이든 순장인가 (새신자 등록 자격에 쓴다)
create or replace function public.leads_any_sun()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.groups g
    where g.type = 'sun' and g.year = public.kst_year()
      and g.leader_person_id = public.my_person_id() and g.removed_at is null
  );
$$;

-- 그 사람이 올해 내 순의 순원인가 (순장의 '자기 순만' 출석 체크에 쓴다)
create or replace function public.leads_sun_of(pid uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.groups g
    join public.group_members gm on gm.group_id = g.id
    where g.type = 'sun' and g.year = public.kst_year()
      and g.leader_person_id = public.my_person_id() and g.removed_at is null
      and gm.person_id = pid
  );
$$;

do $$
declare fn text;
begin
  foreach fn in array array['kst_year()', 'my_person_id()', 'is_pastor()',
    'has_role(text)', 'is_officer()', 'can_manage_sun()',
    'can_check_all_attendance()', 'leads_any_sun()', 'leads_sun_of(uuid)'] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
-- 읽기는 승인 멤버 전체(결정 15 — 스태프/일반 구분 없음). 쓰기는 권한 표대로.

create policy people_select on public.people
  for select using (public.is_approved());
-- 새신자 등록(미등록 출석자 추가)은 출석 체크 자격자도 할 수 있어야 한다
create policy people_insert on public.people
  for insert with check (
    public.is_admin() or public.can_check_all_attendance() or public.leads_any_sun()
  );
create policy people_update on public.people
  for update using (public.is_admin()) with check (public.is_admin());
create policy people_delete on public.people
  for delete using (public.is_admin());

create policy people_roles_select on public.people_roles
  for select using (public.is_approved());
create policy people_roles_write on public.people_roles
  for all using (public.is_admin()) with check (public.is_admin());

create policy groups_select on public.groups
  for select using (public.is_approved());
create policy groups_insert on public.groups
  for insert with check (
    (type = 'sun' and public.can_manage_sun())
    or (type = 'club' and public.is_master())
  );
create policy groups_update on public.groups
  for update using (
    (type = 'sun' and public.can_manage_sun())
    or (type = 'club' and (public.is_master() or leader_person_id = public.my_person_id()))
  ) with check (
    (type = 'sun' and public.can_manage_sun())
    or (type = 'club' and (public.is_master() or leader_person_id = public.my_person_id()))
  );
create policy groups_delete on public.groups
  for delete using (
    (type = 'sun' and public.can_manage_sun())
    or (type = 'club' and public.is_master())
  );

create policy group_members_select on public.group_members
  for select using (public.is_approved());
-- 순 편성은 편성 자격자, 동아리 명단은 마스터 또는 그 동아리 리더
create policy group_members_write on public.group_members
  for all using (
    exists (
      select 1 from public.groups g where g.id = group_id and (
        (g.type = 'sun' and public.can_manage_sun())
        or (g.type = 'club' and (public.is_master() or g.leader_person_id = public.my_person_id()))
      )
    )
  ) with check (
    exists (
      select 1 from public.groups g where g.id = group_id and (
        (g.type = 'sun' and public.can_manage_sun())
        or (g.type = 'club' and (public.is_master() or g.leader_person_id = public.my_person_id()))
      )
    )
  );

-- 신청은 본인만 · 결정(수락/거절)은 그 동아리 리더나 마스터 · 취소는 본인
create policy club_applications_select on public.club_applications
  for select using (
    person_id = public.my_person_id() or public.is_admin()
    or exists (
      select 1 from public.groups g
      where g.id = group_id and g.leader_person_id = public.my_person_id()
    )
  );
create policy club_applications_insert on public.club_applications
  for insert with check (public.is_approved() and person_id = public.my_person_id());
create policy club_applications_update on public.club_applications
  for update using (
    public.is_master()
    or exists (
      select 1 from public.groups g
      where g.id = group_id and g.leader_person_id = public.my_person_id()
    )
  );
create policy club_applications_delete on public.club_applications
  for delete using (person_id = public.my_person_id() or public.is_master());

create policy group_meetings_select on public.group_meetings
  for select using (public.is_approved());
create policy group_meetings_write on public.group_meetings
  for all using (
    public.is_admin()
    or exists (
      select 1 from public.groups g
      where g.id = group_id and g.leader_person_id = public.my_person_id()
    )
  ) with check (
    public.is_admin()
    or exists (
      select 1 from public.groups g
      where g.id = group_id and g.leader_person_id = public.my_person_id()
    )
  );

-- ── 6. 백필 — 기존 가입자 15명을 명단으로 ───────────────────────────────────
-- 직분은 그대로 승계(사용자 결정 2026-09-01). 교역자·회장·리더순장은 role_note로
-- 딱 한 번 맞춘다(0030의 백필과 같은 방식 — 이후 개명과 무관). 임원(officer) 줄과
-- 미가입 청년 ~34명·순 편성은 사용자가 명단을 주면 0037 시드로 넣는다.
insert into public.people (name, profile_id, birthday, is_pastor)
select pr.display_name, pr.id, pr.birthday, coalesce(pr.role_note, '') like '%교역자%'
from public.profiles pr
where pr.removed_at is null;

insert into public.people_roles (person_id, year, role)
select p.id, 2026, 'president'
from public.people p join public.profiles pr on pr.id = p.profile_id
where pr.role_note like '%회장%';

insert into public.people_roles (person_id, year, role)
select p.id, 2026, 'lead_sunjang'
from public.people p join public.profiles pr on pr.id = p.profile_id
where pr.role_note like '%리더순장%';

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select count(*) from people;                             -- 승인 가입자 수(≈15)
--   select name from people where is_pastor;                 -- 임성빈
--   select p.name, r.role from people_roles r join people p on p.id = r.person_id;
--   -- 양민혁 president · 정민경 lead_sunjang (year 2026)
--   -- 승인 대기자 흉내(0022의 확인 절차대로 트랜잭션 + rollback):
--   --   select count(*) from people;  -- 0이어야 한다

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- drop table if exists public.group_meetings;
-- drop table if exists public.club_applications;
-- drop table if exists public.group_members;
-- drop table if exists public.groups;
-- drop table if exists public.people_roles;
-- drop table if exists public.people;
-- drop function if exists public.leads_sun_of(uuid);
-- drop function if exists public.leads_any_sun();
-- drop function if exists public.can_check_all_attendance();
-- drop function if exists public.can_manage_sun();
-- drop function if exists public.is_officer();
-- drop function if exists public.has_role(text);
-- drop function if exists public.is_pastor();
-- drop function if exists public.my_person_id();
-- drop function if exists public.kst_year();
