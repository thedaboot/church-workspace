-- ============================================================================
-- 0044 — 찬양 인도자 (2026-09-05 사용자 결정)
-- ----------------------------------------------------------------------------
-- "찬양 구성 … 순서는 바꿀 수 있는 형태가 좋을 것 같고 인도자도 넣어주면 좋을 듯!
--  찬양팀의 이름은 Re:born 워십이라 고정해줘도 나쁘지 않겠다. 인도자는 격주로 바뀐다."
--
-- **왜 컬럼인가.** `services.songs`는 곡 배열 jsonb `[{title, link?}]`(0036)라 곡이 아니라
-- **찬양 섹션에 매달리는 값**을 둘 자리가 없다. 곡마다 인도자가 다른 것이 아니라 그 주
-- 찬양 전체를 한 사람이 인도하므로 주보 행의 칸이 맞다(HANDOFF §2-1 — 주보 한 건과
-- 언제나 같이 읽고 쓴다). 팀 이름은 고정값이라 DB에 두지 않는다(코드 상수 `PRAISE_TEAM`).
--
-- **왜 person_id가 아니라 text인가.** `services.roles`(담당자)·`services.preacher`와 같은
-- 이유다 — 명단에 없는 사람(객원 인도자)도 적을 수 있어야 하고, 주보는 그 시점의 이름을
-- 남기는 문서다. 화면은 명단 자동완성으로 거들되 저장되는 것은 이름 글자다.
--
-- **RLS는 손대지 않는다.** `services`의 정책 둘은 행 단위다 —
--   services_select : is_approved() and (status = 'published' or can_edit_service())
--   services_write  : can_edit_service()  (0036 + 0042)
-- 컬럼 목록이 없으므로 새 칸도 그대로 덮이고, 권한도 테이블 단위 grant(authenticated에
-- SELECT/INSERT/UPDATE/DELETE)라 컬럼을 더해도 다시 grant할 것이 없다.
-- 적용 전 확인: information_schema.role_table_grants에 테이블 단위 줄이 있음을 봤다.
-- ============================================================================

alter table public.services add column if not exists praise_leader text;

comment on column public.services.praise_leader is
  '찬양 인도자 이름(자유 텍스트 — 명단에 없는 사람도 적는다). 팀 이름은 코드 상수 Re:born 워십';

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   \d services                                   -- praise_leader | text | nullable
--   select policyname, cmd, qual, with_check from pg_policies where tablename = 'services';
--   -- 자격 없는 사람이 못 쓰는지(0022 방식 — 트랜잭션 + rollback):
--   --   begin; set local role authenticated;
--   --   select set_config('request.jwt.claims','{"sub":"<일반 멤버 uuid>"}', true);
--   --   update services set praise_leader = 'x';   -- 0줄이어야 한다
--   --   rollback;

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- **코드(services/worship.js의 COLS)에서 이 칸을 먼저 빼고 배포한 뒤에** 지운다 —
-- 돌아가는 앱이 없는 칸을 select하면 주보 목록이 통째로 42703으로 안 온다.
-- alter table public.services drop column if exists praise_leader;
