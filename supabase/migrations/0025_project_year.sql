-- ============================================================================
-- 0025 — 프로젝트 연도를 손으로 정한다 (사용자 결정 2026-08-26)
-- ----------------------------------------------------------------------------
-- 0014는 "보관함은 created_at으로 연도를 묶는다 — 연도 컬럼을 따로 두지 않는다"로
-- 정했었다. 그 판단이 **해가 바뀌기 전에 미리 만드는 프로젝트**를 못 견딘다.
-- 실제로 `2027 더다붓 사역기획`과 `2027 동계 수련회`가 2026-08-23에 만들어져
-- 2026 폴더에 들어가 있었다(사용자 지적).
--
-- 백필 규칙: **이름이 네 자리 숫자로 시작하면 그 해**, 아니면 만든 해.
-- 지금 이름 규칙이 이미 `2026 하계 수련회`처럼 연도로 시작하므로, 이 한 줄로
-- 열한 개 중 아홉 개가 저절로 맞고 2027 둘도 제자리로 간다.
-- 앞으로 만들 때도 앱이 같은 규칙으로 먼저 채우고, 이름 수정 창에서 고칠 수 있다.
--
-- 범위를 2000~2100으로 자른다 — 이름이 숫자로 시작하는데 연도가 아닌 경우
-- (`3월 심방`처럼)를 연도로 오해하지 않게. 네 자리라 대부분 걸러지지만
-- 값 자체가 화면의 폴더 이름이 되므로 한 번 더 막는다.
-- ============================================================================

alter table public.projects add column if not exists year int;

update public.projects
set year = coalesce(
  -- 이름 앞의 네 자리 숫자(2000~2100)
  nullif(regexp_replace(substring(name from '^\s*([0-9]{4})'), '[^0-9]', '', 'g'), '')::int,
  extract(year from created_at at time zone 'Asia/Seoul')::int
)
where year is null;

-- 범위 밖은 만든 해로 되돌린다
update public.projects
set year = extract(year from created_at at time zone 'Asia/Seoul')::int
where year is null or year < 2000 or year > 2100;

alter table public.projects alter column year set not null;
alter table public.projects add constraint projects_year_range check (year between 2000 and 2100);

-- ── 확인 ───────────────────────────────────────────────────────────────────
--   select year, name from projects order by year desc, position;
--   -- 2027: '2027 더다붓 사역기획', '2027 동계 수련회'
--   -- 2026: 나머지 아홉 개
--   select count(*) from projects where year is null;   -- 0

-- ── 되돌리기 ───────────────────────────────────────────────────────────────
-- alter table public.projects drop constraint if exists projects_year_range;
-- alter table public.projects drop column if exists year;
-- (앱은 year가 없으면 created_at의 해로 떨어지므로 예전처럼 동작한다)
