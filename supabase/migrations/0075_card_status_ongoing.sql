-- ============================================================================
-- 0075 — 업무 상태 '상시'(DB 'ongoing') (2026-09-25 · 사용자가 목업에서 고름)
-- ----------------------------------------------------------------------------
-- 마감 없이 계속 살아 있고 수시로 여는 업무(순번표·현황표·양식·메뉴얼)의 자리.
-- 라이브에 12-27 · 12-31 같은 가짜 마감을 넣어 버틴 업무가 있었다 — 그 날짜가 '지연'·'이번 주'
-- 셈을 거짓으로 만든다(HANDOFF §7 '마감일 필수화'와 같은 이유).
--
-- 앱: config.STATUS_DB의 '상시' ↔ 'ongoing'. 보드 칸이 아니라 칸 위 한 줄이고, 상시로 바꾸면
-- 앱이 start_date·due_date를 지운다(services/domain.js). 이 파일은 **값만 허용**한다 — 기존 행은
-- 건드리지 않는다(가짜 마감을 단 업무를 상시로 옮길지는 사람이 고른다).
--
-- completed_at 트리거(0034)는 'done'만 보므로 그대로다. api/push.js의 마감 알림은 due_date로
-- 고르므로 날짜가 빈 상시는 저절로 빠진다.
-- ============================================================================
begin;

alter table public.cards drop constraint if exists cards_status_check;
alter table public.cards add constraint cards_status_check
  check (status in ('todo', 'doing', 'hold', 'done', 'ongoing'));

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'cards_status_check';
--     → CHECK ((status = ANY (ARRAY['todo'::text, 'doing'::text, 'hold'::text, 'done'::text, 'ongoing'::text])))
--   select status, count(*) from public.cards group by 1 order by 1;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- (상시 행이 있으면 먼저 다른 상태로 옮긴다 — 안 그러면 제약을 다시 걸 때 실패한다)
-- update public.cards set status = 'todo' where status = 'ongoing';
-- alter table public.cards drop constraint if exists cards_status_check;
-- alter table public.cards add constraint cards_status_check
--   check (status in ('todo', 'doing', 'hold', 'done'));
