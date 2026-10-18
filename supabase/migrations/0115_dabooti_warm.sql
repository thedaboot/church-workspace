-- ============================================================================
-- 0115 — 다붓이 아침 미리 답하기 행(via 'warm') (v5 2묶음 · 다붓이 답변 속도 · 2026-10-18)
-- ----------------------------------------------------------------------------
-- 8시 크론(api/push.js runWiki → api/_wikiAsk.js warmCache)이 위키 빌드 뒤에 최근 14일 여러 번 물은 질문을 서버 키로 다시 답해
-- 답 캐시 행으로 남긴다 — 아침 첫 물음도 모델 없이 바로 간다(캐시는 날을 넘겨도 쓴다 · wikiCore.cacheFresh).
-- 그 행은 사람이 물은 것도(ask) 아침 고리의 다시 묻기(nightly)도 아니라 via에 'warm'을 더한다 — 코드는 묶음 세기 · 열린 질문 ·
-- 짝 · 아침 고리에서 그 행을 뺀다(wikiCore.isAskRow · faq.openGroups · _wikiAsk.pairFrom/reaskTodo).
-- 표·정책은 그대로(서버만 · 0088). CHECK 하나만 바꾼다.
--
-- 순서: 이 마이그레이션 → 코드. 코드가 먼저 나가도 오류 화면은 없다 — warm 행 넣기만 CHECK에 걸려 실패하고(크론 응답 warm.failed)
-- 나머지(날을 넘긴 캐시 · 근거 먼저)는 그대로 돈다.
-- 되돌리기: delete from public.dabooti_questions where via = 'warm'; 뒤 아래 CHECK를 ('ask', 'nightly')로.
-- ============================================================================

begin;

alter table public.dabooti_questions drop constraint if exists dabooti_questions_via_check;
alter table public.dabooti_questions add constraint dabooti_questions_via_check check (via in ('ask', 'nightly', 'warm'));

comment on column public.dabooti_questions.via is 'ask 사람이 물음 · nightly 아침 고리 다시 묻기 · warm 아침 미리 답하기(캐시 행 · 0115)';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'dabooti_questions_via_check';
--   select via, count(*) from public.dabooti_questions group by via;
