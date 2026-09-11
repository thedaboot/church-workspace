-- ============================================================================
-- 0062 — qt_entries.title: 묵상 노트의 제목 (2026-09-11)
-- ----------------------------------------------------------------------------
-- 사용자 요청: 묵상 노트에도 **제목 칸**을 둔다. 예배 노트 종이에는 설교 제목이 머리로
-- 서는데(주보의 `services.title`), 묵상은 혼자 읽고 쓰는 글이라 그 자리가 늘 비어 있어
-- 구절만 큰 글자로 올라왔다. 이제 쓴 사람이 직접 제목을 단다.
--
-- 컬럼이 맞는 자리다(HANDOFF §3-1): 묵상과 **언제나 같이 읽고 쓰고**, 값은 그 사람의
-- 그날 묵상 하나에 하나뿐이다. 조인 표를 두면 왕복이 둘로 갈려 저장이 겹칠 때 깨진다.
--
-- `not null default ''`인 이유: 화면이 늘 문자열을 기대한다(빈 제목 = 제목 없음 = 종이
-- 머리에 구절만). null과 ''를 가르면 같은 뜻이 두 모양이 되고, 읽는 자리마다 `?? ''`를
-- 또 적어야 한다. 기존 행은 전부 ''로 채워진다 — 백필이 따로 없는 이유다.
--
-- **정책은 그대로다.** qt_entries의 RLS는 0036이 만들고 0045·0061이 고쳤는데 전부
-- **행 단위**(`profile_id = effective_uid()` · `shared and is_approved()`)라 컬럼이
-- 하나 늘어도 경계가 달라지지 않는다. 컬럼 단위 권한은 이 레포에 쓰지 않는다.
--
-- 실시간(0049)도 그대로다 — qt_entries는 이미 발행 목록에 있고, `replica identity`는
-- 건드리지 않는다(§5의 'replica identity full은 켜지 마세요').
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

alter table public.qt_entries add column if not exists title text not null default '';

comment on column public.qt_entries.title is
  '묵상 노트의 제목 — 종이 머리에 구절 위로 선다. 빈 글자면 구절만 올라온다(0062)';

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'qt_entries' and column_name = 'title';
--   -- title | text | NO | ''::text
--
--   select count(*) from public.qt_entries where title is null;   -- 0
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   alter table public.qt_entries drop column if exists title;
--   (클라이언트도 같이 — services/word.js의 읽기·upsert·나눔 피드 조회가 title을 본다)
