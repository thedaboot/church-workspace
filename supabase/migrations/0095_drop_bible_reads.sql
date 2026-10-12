-- ============================================================================
-- 0095 — '이번 주 이 장을 본 사람'을 뺀다 (0080 되돌리기 · 사용자 결정 2026-10-12)
-- ----------------------------------------------------------------------------
-- 성경 읽기 장 머리의 얼굴 셋 + '+N' · 그 판 · '나도 나누기' 토글(판 아래 · 내 정보) · 5초 펼침 기록 ·
-- 11:30 배치 끝의 지난주 정리를 통째로 뺐다(20차 묶음 ⑤). HANDOFF §7의 '성경 장 보기는 예외' 줄을
-- 이 결정이 뒤집었다. QT 나눔(qt_entries.shared · 0036)은 그대로다 — 이 파일은 그쪽을 건드리지 않는다.
--
-- **순서는 상관없다.** 코드가 먼저 나가면 이 표·칸을 읽고 쓰는 곳이 없어 아무 일도 없다. 이 파일이
-- 먼저 들어가도 옛 클라이언트는 조용히 떨어진다(얼굴 자리가 안 서고 · 토글은 켬으로 보이고 · 끄면
-- 토스트 하나 · 11:30 배치는 delete 실패를 로그에만 남긴다 — 0080 머리말 '실패는 조용하다').
--
-- 이 표·칸을 가리키는 함수·뷰·트리거는 없다(grep — 계정 합치기 0059·0060은 bible_state를 행째 옮길 뿐
-- 칸 이름을 쓰지 않고, bible_reads는 옮기지 않았다).
-- 실시간 발행(0049·0056)에도 넣은 적이 없다.
--
-- 되돌리기: 0080_bible_reads.sql을 그대로 다시 돌린다(표·인덱스·정책 셋·share_reads 칸 · 모두 if not exists).
--   지운 줄과 켬/끔 값은 돌아오지 않는다 — 다들 켬(기본값)으로 다시 선다.
--   클라이언트는 이 커밋의 앞 커밋(services/bibleReads.js · services/word.js의 읽은 장·나도 나누기 ·
--   components/wordBible.jsx의 ChapterReaders · modals/settings.jsx의 토글 · api/push.js dropLastWeekReads)에서 가져온다.
-- ============================================================================

begin;

drop table if exists public.bible_reads;                         -- 정책·인덱스도 같이 사라진다
alter table public.bible_state drop column if exists share_reads;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select to_regclass('public.bible_reads');                                   -- null
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='bible_state' and column_name='share_reads';   -- 0행
