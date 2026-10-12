-- ============================================================================
-- 0094 — 직분 '비전 메이커'(vision_maker) (20차 ② · 2026-10-12 · 사용자 결정)
-- ----------------------------------------------------------------------------
-- 비전 메이커 = 청년부 간사. 청년들의 꿈과 청년부가 돌아가는 상황을 보고 업무·비전을 조언하는 사람이다.
-- **청년이 아니고 교역자도 아니고 임원진도 아니다**(첫 사람: 김우한 집사님 — 데이터는 레포 밖 SQL로 사용자가 넣는다).
--
-- 저장 자리: 다른 직분처럼 **그해 people_roles 줄**(role = 'vision_maker'). 고른 이유 —
--   · 명단 화면이 직분 칩을 people_roles로 그리고 해마다 다시 정한다(임원진과 같은 흐름 · services/roster.js YEAR_ROLES).
--   · people에 칸을 더하면 명단 쓰기·게스트 저장·호칭 셋을 같이 고쳐야 한다(§3-2 — 저장 계층만 바꾸는 길을 먼저).
--   · 순 편성에서는 people.sun_exempt(0040)로 빠진다(부장님·전도사님과 같다 · 출석 '안 온 사람'에도 안 센다).
-- 권한: people_roles 줄은 **아무 권한도 주지 않는다**. has_role(r)은 값을 보고, 줄만 보는 is_officer()(0035 · 0045 뒤로
--   부르는 곳 없음 — pg_policy 0 · 함수 0)는 비전 메이커를 빼도록 고친다 — 임원이 아니라는 결정을 함수에도 남긴다.
-- 부를 때: '이름 집사님'(api/_wikiAsk.js STAFF_CALL — 다붓이 사람 줄 · 호칭). 화면 칩 글자는 '비전 메이커'(services/roster.js).
--
-- 순서: 이 마이그레이션 → 데이터 SQL(사람 · 직분 줄 · 위키 '자주 쓰는 말') → 코드 푸시. 코드가 먼저 나가면 명단 화면의
-- '비전 메이커' 칩을 눌러도 CHECK에 막혀 '직분을 지정하지 못했어요'가 뜬다(그 밖은 그대로 돈다).
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

alter table public.people_roles drop constraint people_roles_role_check;
alter table public.people_roles add constraint people_roles_role_check
  check (role in ('director', 'president', 'treasurer', 'lead_sunjang', 'lead_team', 'vision_maker'));

-- 올해 임원인가 — 비전 메이커 줄은 임원이 아니다
create or replace function public.is_officer()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.people_roles pr
    where pr.person_id = public.my_person_id() and pr.year = public.kst_year() and pr.role <> 'vision_maker'
  );
$$;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'people_roles_role_check';
--   select prosrc from pg_proc where proname = 'is_officer';
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- delete from public.people_roles where role = 'vision_maker';
-- alter table public.people_roles drop constraint people_roles_role_check;
-- alter table public.people_roles add constraint people_roles_role_check
--   check (role in ('director', 'president', 'treasurer', 'lead_sunjang', 'lead_team'));
-- create or replace function public.is_officer()
-- returns boolean language sql stable security definer set search_path = public, pg_temp
-- as $$
--   select exists (
--     select 1 from public.people_roles pr
--     where pr.person_id = public.my_person_id() and pr.year = public.kst_year()
--   );
-- $$;
-- commit;
