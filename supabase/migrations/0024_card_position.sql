-- ============================================================================
-- 0024 — 같은 상태 안에서도 업무 카드 순서를 정한다 (사용자 요청 2026-08-25)
-- ----------------------------------------------------------------------------
-- 지금까지 보드 컬럼 안 순서는 **마감일 순**이었다(dashboardParts.byDue).
-- 같은 상태 안에서 손으로 순서를 바꾸려면 저장할 자리가 필요하다.
--
-- `cards.position` 컬럼은 0001부터 있었는데 **아무도 채우지 않아 전부 0이었다**
-- (HANDOFF §6-24). 그대로 정렬 키로 쓰면 값이 다 같아서 Postgres가 순서를
-- 보장하지 않고, 카드가 새로고침할 때마다 뒤바뀐다. 그래서 백필이 먼저다.
--
-- 백필 순서는 **지금 화면에 보이는 순서 그대로**다 — 마감일 오름차순(미정은 뒤),
-- 같으면 만든 시각. 이렇게 해야 이 마이그레이션 직후 화면이 하나도 안 움직인다.
-- 0021이 projects.position에 한 것과 같은 방식이다.
--
-- 순서는 (프로젝트, 상태)마다 따로 매긴다 — 카드가 다른 상태로 옮겨가면 그쪽
-- 컬럼의 순서를 새로 받는다. 앱이 옮길 때 그 컬럼 전체를 다시 매긴다.
-- ============================================================================

update public.cards c
set position = s.rn
from (
  select id,
         row_number() over (
           partition by project_id, status
           order by due_date asc nulls last, created_at asc
         ) as rn
  from public.cards
) s
where c.id = s.id and c.position is distinct from s.rn;

-- 값이 없던 행이 남지 않게(이론상 없지만 방어)
update public.cards set position = 0 where position is null;

-- ── 확인 ───────────────────────────────────────────────────────────────────
--   select project_id, status, count(*), count(distinct position)
--   from cards group by 1,2 having count(*) <> count(distinct position);
--   -- 위 결과가 0행이면 (프로젝트, 상태)마다 순서가 겹치지 않는다
--   select title, status, position from cards where project_id = '<uuid>' order by status, position;

-- ── 되돌리기 ───────────────────────────────────────────────────────────────
-- update public.cards set position = 0;
-- (컬럼 자체는 0001부터 있던 것이라 지우지 않는다 — 앱이 정렬 2차 키로 byDue를
--  그대로 들고 있어서, 전부 0이어도 예전과 같은 순서로 보인다)
