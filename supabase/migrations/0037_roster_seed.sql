-- ============================================================================
-- 0037 — v2 명단 시드 (2026-09-01 사용자가 준 명단 그대로) + leads_sun_of 보강
-- ----------------------------------------------------------------------------
-- · 사용자가 불러준 명단: 순 6개(51명) · 임원 6명 · 팀 4개 배정 · 동아리 5개.
--   전체 53명 = 기존 가입자 14(0035 백필) + 신규 39.
-- · **이름 매칭은 이 시드 한 번뿐이다**(0030 백필과 같은 판단 — 사람이 검수한
--   일회성 목록). 앱 런타임에서는 이름으로 사람을 잇지 않는다(§6-26).
--   동명이인이 없음을 확인했고, 아래 do 블록이 한 번 더 확인한다.
-- · 표시명 ≠ 실명 둘은 이름을 실명으로 고친다(말감이→임재훈 · 시온→이시온).
--   워크스페이스 표시명(profiles.display_name)은 건드리지 않는다.
-- · **순장은 자기 순의 구성원으로도 넣는다** — 출석 정책 leads_sun_of()가
--   group_members만 보므로, 빼면 순장이 자기 출석을 못 찍는다(예배 줄기 검수에서
--   발견). 정책 함수도 순장 본인을 통과시키게 보강한다(편성 화면이 순장을 멤버로
--   안 넣는 날이 와도 깨지지 않게).
-- · 독서모임·러닝은 명단을 동아리장만 안다 — 리더만 넣고 나머지는 앱에서 채운다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

-- ── 1. 표시명 ≠ 실명 정정 ────────────────────────────────────────────────────
update public.people p set name = '임재훈'
from public.profiles pr where pr.id = p.profile_id and pr.display_name = '말감이';
update public.people p set name = '이시온'
from public.profiles pr where pr.id = p.profile_id and pr.display_name = '시온';

-- ── 2. 신규 39명 ─────────────────────────────────────────────────────────────
insert into public.people (name, birthday, teams) values
  -- 꼬순
  ('강예은', '10-02', '{}'),
  ('류승우', '06-12', '{엔지니어팀}'),
  ('박시현', '11-06', '{엔지니어팀}'),
  ('임하정', '01-12', '{}'),
  ('조현재', '09-20', '{}'),
  -- 콩순
  ('천진영', '03-05', '{}'),
  ('강미정', '10-28', '{}'),
  ('김민준', '08-05', '{}'),
  ('김서진', '11-05', '{찬양팀}'),
  ('김영민', '04-10', '{}'),
  ('신유준', '11-06', '{}'),
  ('안병현', '02-10', '{찬양팀}'),
  ('주재영', '06-28', '{}'),
  -- 고구마순
  ('박성령', '02-16', '{찬양팀}'),
  ('박윤민', '03-31', '{엔지니어팀}'),
  ('이수빈', '06-11', '{찬양팀}'),
  ('조재우', '03-09', '{}'),
  ('주재은', '02-08', '{}'),
  ('허율',   '10-18', '{}'),
  ('남다율', null,    '{}'),
  -- 오순도순
  ('배현민', '07-16', '{}'),
  ('강서윤', '05-22', '{}'),
  ('김예은', '01-09', '{}'),
  ('류현호', '04-20', '{찬양팀}'),
  ('손채은', '02-28', '{엔지니어팀}'),
  ('송진석', '07-29', '{}'),
  ('신유지', '02-24', '{}'),
  -- 선착순
  ('류하영', '07-22', '{찬양팀}'),
  ('배현준', '10-24', '{찬양팀}'),
  ('이준원', '06-12', '{}'),
  ('이하빈', '03-09', '{}'),
  ('조은찬', '10-11', '{}'),
  ('박세원', null,    '{}'),
  -- TT순
  ('강꽃님', '08-12', '{}'),
  ('강라미', '01-23', '{}'),
  ('신유리', '08-07', '{}'),
  ('이하랑', '10-04', '{엔지니어팀}'),
  ('장제훈', '10-24', '{}'),
  ('윤현서', null,    '{}');

-- 이름이 하나뿐인지 확인 — 아래가 전부 이름으로 잇기 때문이다
do $$ begin
  if exists (select 1 from public.people where removed_at is null
             group by name having count(*) > 1) then
    raise exception '동명이인이 있습니다 — 이름 시드를 계속할 수 없습니다';
  end if;
end $$;

-- ── 3. 기존 인원 생일·팀 (명단 기준) ─────────────────────────────────────────
update public.people set birthday = '02-13', teams = '{엔지니어팀}'        where name = '김윤주';
update public.people set birthday = '08-25', teams = '{찬양팀}'            where name = '조해리';
update public.people set birthday = '01-23', teams = '{미디어팀}'          where name = '강희라';
update public.people set birthday = '09-03', teams = '{엔지니어팀}'        where name = '문진혁';
update public.people set birthday = '08-07', teams = '{웰컴팀}'            where name = '박지호';
update public.people set birthday = '02-09', teams = '{찬양팀}'            where name = '임재훈';
update public.people set birthday = '07-19', teams = '{찬양팀,미디어팀}'   where name = '이시온';
update public.people set birthday = '05-05', teams = '{찬양팀}'            where name = '정민경';
update public.people set birthday = '05-26', teams = '{찬양팀}'            where name = '노준석';
update public.people set birthday = '10-23', teams = '{찬양팀}'            where name = '조준환';
update public.people set birthday = '10-15', teams = '{찬양팀}'            where name = '김승찬';
update public.people set birthday = '03-04', teams = '{웰컴팀,미디어팀}'   where name = '양민혁';
update public.people set birthday = '10-05'                                where name = '신효진';

-- 계정이 이어진 사람은 워크스페이스 생일도 채운다 — **비어 있는 칸만**(있는 값은
-- 사용자가 정한 것일 수 있으니 덮지 않는다). 대시보드·달력 생일(0019)이 이 값을 본다.
update public.profiles pr set birthday = p.birthday
from public.people p
where p.profile_id = pr.id and pr.birthday is null and p.birthday is not null;

-- ── 4. 임원 2026 (officer — president·lead_sunjang은 0035에서 승계됨) ────────
insert into public.people_roles (person_id, year, role)
select id, 2026, 'officer' from public.people
where name in ('조준환', '조해리', '박지호', '신효진')
on conflict do nothing;

-- ── 5. 순 6개 + 구성원(순장 포함) ────────────────────────────────────────────
insert into public.groups (type, name, year, leader_person_id) values
  ('sun', '꼬순',     2026, (select id from public.people where name = '김윤주')),
  ('sun', '콩순',     2026, (select id from public.people where name = '천진영')),
  ('sun', '고구마순', 2026, (select id from public.people where name = '김승찬')),
  ('sun', '오순도순', 2026, (select id from public.people where name = '배현민')),
  ('sun', '선착순',   2026, (select id from public.people where name = '임재훈')),
  ('sun', 'TT순',     2026, (select id from public.people where name = '노준석'));

create temp table seed_sun (sun text, member text) on commit drop;
insert into seed_sun values
  ('꼬순','김윤주'),('꼬순','강예은'),('꼬순','강희라'),('꼬순','류승우'),('꼬순','박시현'),('꼬순','임하정'),('꼬순','조해리'),('꼬순','조현재'),
  ('콩순','천진영'),('콩순','강미정'),('콩순','김민준'),('콩순','김서진'),('콩순','김영민'),('콩순','신유준'),('콩순','안병현'),('콩순','양민혁'),('콩순','주재영'),
  ('고구마순','김승찬'),('고구마순','문진혁'),('고구마순','박성령'),('고구마순','박윤민'),('고구마순','이수빈'),('고구마순','조재우'),('고구마순','주재은'),('고구마순','허율'),('고구마순','남다율'),
  ('오순도순','배현민'),('오순도순','강서윤'),('오순도순','김예은'),('오순도순','류현호'),('오순도순','박지호'),('오순도순','손채은'),('오순도순','송진석'),('오순도순','신유지'),
  ('선착순','임재훈'),('선착순','류하영'),('선착순','배현준'),('선착순','이시온'),('선착순','이준원'),('선착순','이하빈'),('선착순','정민경'),('선착순','조은찬'),('선착순','박세원'),
  ('TT순','노준석'),('TT순','강꽃님'),('TT순','강라미'),('TT순','신유리'),('TT순','이하랑'),('TT순','장제훈'),('TT순','조준환'),('TT순','윤현서');

insert into public.group_members (group_id, person_id)
select g.id, p.id
from seed_sun s
join public.groups g on g.type = 'sun' and g.year = 2026 and g.name = s.sun
join public.people p on p.name = s.member;

-- ── 6. 동아리 5개 + 구성원(동아리장 포함) ────────────────────────────────────
insert into public.groups (type, name, leader_person_id, note) values
  ('club', '통통',     (select id from public.people where name = '노준석'), '통기타 동아리'),
  ('club', '말씀읽기', (select id from public.people where name = '김승찬'), null),
  ('club', '독서모임', (select id from public.people where name = '김승찬'), '명단은 동아리장이 채운다'),
  ('club', '러닝',     (select id from public.people where name = '신유리'), '명단은 동아리장이 채운다'),
  ('club', '서부버튼', (select id from public.people where name = '임재훈'), '보드게임 동아리');

create temp table seed_club (club text, member text) on commit drop;
insert into seed_club values
  ('통통','노준석'),('통통','류승우'),('통통','정민경'),('통통','김승찬'),('통통','김윤주'),('통통','이준원'),('통통','임재훈'),('통통','조준환'),('통통','천진영'),('통통','조해리'),('통통','배현준'),('통통','강희라'),
  ('말씀읽기','김승찬'),('말씀읽기','강꽃님'),('말씀읽기','노준석'),('말씀읽기','박윤민'),('말씀읽기','손채은'),('말씀읽기','안병현'),('말씀읽기','김윤주'),('말씀읽기','이하랑'),('말씀읽기','임하정'),('말씀읽기','임재훈'),('말씀읽기','조준환'),('말씀읽기','조해리'),
  ('독서모임','김승찬'),
  ('러닝','신유리'),
  ('서부버튼','임재훈'),('서부버튼','노준석'),('서부버튼','김민준'),('서부버튼','양민혁'),('서부버튼','김승찬'),('서부버튼','이시온'),('서부버튼','김윤주'),('서부버튼','조재우'),('서부버튼','조준환'),('서부버튼','박지호'),('서부버튼','조해리'),('서부버튼','배현준'),('서부버튼','류현호');

insert into public.group_members (group_id, person_id)
select g.id, p.id
from seed_club s
join public.groups g on g.type = 'club' and g.name = s.club
join public.people p on p.name = s.member;

-- ── 7. leads_sun_of 보강 — 순장 본인도 자기 순으로 본다 ─────────────────────
-- 0036의 출석 정책이 이 함수를 쓴다. 순장이 group_members에 없어도(편성 화면이
-- 빠뜨려도) 자기 자신은 찍을 수 있어야 한다.
create or replace function public.leads_sun_of(pid uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.groups g
    left join public.group_members gm on gm.group_id = g.id and gm.person_id = pid
    where g.type = 'sun' and g.year = public.kst_year()
      and g.leader_person_id = public.my_person_id() and g.removed_at is null
      and (gm.person_id is not null or g.leader_person_id = pid)
  );
$$;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select count(*) from people where removed_at is null;               -- 53
--   select count(*) from groups where type='sun';                       -- 6
--   select count(*) from groups where type='club';                      -- 5
--   select g.name, count(*) from group_members gm join groups g on g.id=gm.group_id
--     where g.type='sun' group by g.name;   -- 꼬순8 콩순9 고구마순9 오순도순8 선착순9 TT순8
--   select p.name, r.role from people_roles r join people p on p.id=r.person_id
--     order by r.role, p.name;              -- officer 4 + president 1 + lead_sunjang 1

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- delete from public.group_members;
-- delete from public.groups;
-- delete from public.people_roles where role = 'officer';
-- delete from public.people where profile_id is null;
-- (기존 14명의 name·birthday·teams와 profiles.birthday 갱신, leads_sun_of는 0035 판으로
--  손으로 되돌린다)
