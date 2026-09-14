-- ============================================================================
-- 0065 — bible_state.recent_searches: 성경 읽기의 최근 검색어 (2026-09-14 요청)
-- ----------------------------------------------------------------------------
-- 사용자 요청(9차 개선): "검색창에 [최근 검색어] 기능 추가. 검색어 클릭 시 바로 검색
-- 실행, 삭제 기능 포함. 사용자당 최대 30개 노출, 가장 최근 검색어가 최상단에 위치,
-- 30개 넘어가면 가장 오래된 것 자동으로 삭제."
--
-- **왜 서버인가.** "사용자당"이 요구다. 그리고 같은 화면의 이어읽기(last_ref)·북마크·
-- 형광펜이 이미 이 행에 있다(0036·0038) — 검색어만 브라우저에 두면 폰과 노트북이
-- 서로 다른 목록을 보게 되고, 그 화면에서 저장 자리가 둘로 갈린다.
--
-- 컬럼이 맞는 자리다(HANDOFF §3-1): 성경 화면이 이 행을 **이미 한 번에 읽고 쓴다**
-- (services/word.js의 bible_state 읽기·upsert 한 벌). 조인 표를 만들면 그 화면의
-- 왕복이 둘로 갈리고, 검색어를 따로 조회·집계할 이유는 없다. 0038의 highlights가
-- 같은 판단으로 jsonb 배열이다.
--
-- 모양은 **최신이 앞**인 배열이다: [{ q, at }, …]. 상한 30·중복 제거·오래된 것 버리기는
-- **클라이언트가 한다**(services/word.js) — 화면이 이미 배열 전체를 들고 다시 쓰는
-- 구조라 DB 트리거를 둘 이유가 없고, 트리거를 두면 잘리는 규칙이 두 곳으로 갈린다.
-- 상한을 어긴 배열이 들어와도 손해는 그 사람 목록이 길어지는 것뿐이다(제약을 걸지
-- 않는 이유 — 30이라는 숫자는 화면 결정이지 데이터 무결성이 아니다).
--
-- **정책은 그대로다.** bible_state의 RLS는 0036이 만들고 0061이 `effective_uid()`로
-- 옮긴 **행 단위**(profile_id) 하나뿐이라, 컬럼이 늘어도 경계가 달라지지 않는다.
-- 실시간(0049)도 그대로다 — `replica identity`는 건드리지 않는다(§5).
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

alter table public.bible_state
  add column if not exists recent_searches jsonb not null default '[]';

comment on column public.bible_state.recent_searches is
  '최근 검색어 — [{q, at}] 최신이 앞. 상한 30·중복 제거는 services/word.js가 한다(0065)';

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='bible_state'
--      and column_name='recent_searches';
--   -- recent_searches | jsonb | NO | '[]'::jsonb
--
--   select count(*) from public.bible_state where recent_searches is null;   -- 0
--
--   select tablename, policyname, cmd from pg_policies
--    where schemaname='public' and tablename='bible_state';
--   -- bible_state | bible_state_own | ALL   (0061 그대로)
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   alter table public.bible_state drop column if exists recent_searches;
--   (클라이언트도 같이 — services/word.js의 bible_state 읽기·upsert와
--    components/wordBible.jsx의 최근 검색어 줄이 이 칸을 본다)
