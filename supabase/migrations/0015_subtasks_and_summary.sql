-- ============================================================================
-- 0015_subtasks_and_summary.sql — 하위 업무(체크리스트) · 고정한 AI 요약
-- ----------------------------------------------------------------------------
-- 둘 다 cards에 붙는 컬럼이라 한 파일로 묶는다.
--
-- 1) cards.subtasks — 하위 업무 체크리스트. 조인 테이블을 만들지 않았다:
--    · 항목이 카드당 몇 개뿐이고 언제나 카드와 함께 읽고 쓴다(따로 조회할 일이 없다)
--    · 컬럼 하나면 RLS·실시간 라우팅·목록 조회 함수가 늘지 않는다
--    · 컬럼 통째 쓰기라 저장이 겹쳐도 마지막 것이 남을 뿐 깨지지 않는다
--      (0013에서 담당자를 조인 테이블로 옮겼다가 겹친 저장이 duplicate key로
--       깨졌던 것과 반대 성질이다 — 그 교훈으로 여기는 컬럼을 골랐다)
--    모양: [{ "id": "...", "title": "...", "done": false }]  순서는 배열 순서.
--
-- 2) cards.ai_summary — '이 요약 고정'으로 남긴 3줄 요약.
--    요약은 기본적으로 각자 브라우저 메모리에만 캐시된다. 잘 나온 것을 사람들이
--    같이 보게 하려면 어딘가에 저장해야 하고, 그 자리가 여기다. 고정은 관리자만
--    할 수 있다(앱에서 막는다 — 전원이 덮어쓰면 마지막 사람 것만 남는다).
--    ai_summary_by는 누가 고정했는지 화면에 적기 위한 것이다.
-- ============================================================================

alter table public.cards
  add column if not exists subtasks jsonb not null default '[]'::jsonb,
  add column if not exists ai_summary text,
  add column if not exists ai_summary_at timestamptz,
  add column if not exists ai_summary_by uuid references public.profiles on delete set null;

-- 배열이 아닌 값이 들어가면 앱이 .map에서 죽는다. DB에서 막는다.
alter table public.cards
  drop constraint if exists cards_subtasks_is_array;
alter table public.cards
  add constraint cards_subtasks_is_array check (jsonb_typeof(subtasks) = 'array');

-- 되돌리기:
--   alter table public.cards drop constraint cards_subtasks_is_array;
--   alter table public.cards drop column subtasks, drop column ai_summary,
--                            drop column ai_summary_at, drop column ai_summary_by;
