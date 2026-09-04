-- ============================================================================
-- 0043 — 직분을 여섯으로 가른다: 교역자 · 부장 · 회장 · 총무 · 리더순장 · 리더팀장
-- ----------------------------------------------------------------------------
-- 사용자 지시(2026-09-05): "교역자, 회장, 리더순장, 리더팀장, 총무 이렇게 역할을
-- 구분해주고 … 조준환, 박지호는 리더팀장, 조해리는 총무로" + 뒤이어 "부장을 하나 더
-- 넣고 신효진은 부장으로".
--
-- 왜:
--   · 0035·0037의 `officer`(임원)는 **네 사람이 한 칩을 나눠 쓰던 자리**였다. 화면에서
--     누가 무엇인지 알 수 없었다(조준환·박지호·조해리·신효진이 전부 '임원' 배지).
--     이제 리더팀장·총무·부장으로 갈라 이름과 자리가 맞는다.
--   · **`officer`는 값에서 완전히 사라진다.** 네 줄 전부 새 값으로 옮기므로 남는 행이
--     없다(아래 do 블록이 확인한다).
--   · **권한은 그대로다.** `is_officer()`는 "그 해 people_roles 줄이 하나라도 있는가"만
--     본다(0035) — 값을 보지 않으므로 새 네 값도 임원과 같은 자리를 그대로 맡는다.
--     예배 전체 출석 체크(`can_check_all_attendance`)·순 편성 자격(`can_manage_sun`)의
--     판정이 바뀌지 않는다. docs/V2.md §1 권한 표의 '임원'은 이제 이 다섯 값
--     (부장·회장·총무·리더순장·리더팀장)을 뜻한다.
--   · **순 편성 제외는 이 값과 무관하다.** 신효진·임성빈이 순원·순장 후보에서 빠지는
--     것은 `people.sun_exempt` 한 칸이 정한다(0040) — 역할 값에 걸려 있지 않으므로
--     신효진이 officer에서 director로 옮겨도 그 제외는 그대로다.
--   · 교역자는 여기 없다 — 연도와 무관한 명단 속성이다(`people.is_pastor` · 0035).
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 1. 체크를 잠깐 뗀다 ─────────────────────────────────────────────────────
-- 순서가 중요하다: 옛 체크는 새 값을 막고(update가 실패), 새 체크는 옛 값이 남은 채로는
-- 걸리지 않는다(add constraint가 실패). 떼고 → 옮기고 → 새로 건다.
alter table public.people_roles drop constraint people_roles_role_check;

-- ── 2. 남은 임원 네 줄을 제 자리로 ──────────────────────────────────────────
-- 이름으로 잡는다 — 0037이 동명이인이 없음을 확인했고 이 넷은 계정이 연결된 사람이다.
update public.people_roles r set role = 'lead_team'
where r.role = 'officer'
  and r.person_id in (select id from public.people where name in ('조준환', '박지호'));

update public.people_roles r set role = 'treasurer'
where r.role = 'officer'
  and r.person_id in (select id from public.people where name = '조해리');

-- 부장 — 0040 주석이 이미 "신효진·임성빈은 부장님·전도사님"이라고 적어 둔 그 자리다.
update public.people_roles r set role = 'director'
where r.role = 'officer'
  and r.person_id in (select id from public.people where name = '신효진');

-- ── 3. 새 값 목록을 건다 ────────────────────────────────────────────────────
alter table public.people_roles add constraint people_roles_role_check
  check (role in ('director', 'president', 'treasurer', 'lead_sunjang', 'lead_team'));

-- ── 4. 확인 — officer가 한 줄도 남지 않아야 한다 ────────────────────────────
do $$ declare left_over int; moved int; begin
  select count(*) into left_over from public.people_roles where role = 'officer';
  if left_over > 0 then
    raise exception '옮기지 못한 임원 줄이 %개 남았습니다 — 이름을 확인하세요', left_over;
  end if;
  select count(*) into moved from public.people_roles
   where role in ('director', 'treasurer', 'lead_team');
  if moved <> 4 then
    raise exception '새 직분이 4줄이어야 하는데 %줄입니다', moved;
  end if;
end $$;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select p.name, r.year, r.role from public.people_roles r
--     join public.people p on p.id = r.person_id order by r.role, p.name;
--   -- 2026: 신효진 director · 조준환·박지호 lead_team · 정민경 lead_sunjang ·
--   --       양민혁 president · 조해리 treasurer
--   select name from public.people where is_pastor;          -- 임성빈(교역자)
--   select name from public.people where sun_exempt;         -- 신효진 · 임성빈(0040 그대로)

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- alter table public.people_roles drop constraint people_roles_role_check;
-- alter table public.people_roles add constraint people_roles_role_check
--   check (role in ('president', 'lead_sunjang', 'officer'));
-- update public.people_roles set role = 'officer'
--   where role in ('director', 'treasurer', 'lead_team');
-- commit;
