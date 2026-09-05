-- ============================================================================
-- 0046 — 찬양 재생목록 주소 (2026-09-05 사용자 결정 · 0044의 짝)
-- ----------------------------------------------------------------------------
-- "찬양 구성의 경우에는 유튜브 플레이리스트로 가져오고 …" — 지금은 재생목록에서
-- **곡만** 뽑아 오고 그 재생목록 자체는 어디에도 남지 않는다. 그래서 보기 화면에서
-- '오늘 찬양을 통째로 틀기'가 안 된다(곡을 하나씩 눌러야 한다).
--
-- 저장 자리가 `services.songs`(곡 배열)일 수 없는 이유는 0044와 같다 — 곡이 아니라
-- **찬양 섹션에 매달리는 값**이다. 인도자 옆 칸이 맞다.
--
-- 저장되는 모양은 언제나 `https://www.youtube.com/playlist?list=<id>`다(코드의
-- `youtubePlaylistUrl`). 사람이 붙이는 주소는 'watch?v=…&list=…'일 때가 많은데
-- 그대로 두면 '재생목록 열기'가 첫 곡 재생으로 튄다.
--
-- 번호가 0045가 아닌 이유: 0045는 같은 회차에서 서버 자격 함수(can_edit_service ·
-- can_check_all_attendance)를 고치는 자리로 이미 잡혀 있다.
--
-- RLS·권한은 0044와 같은 이유로 손대지 않는다 — services 정책 둘이 행 단위이고
-- (services_select · services_write) grant도 테이블 단위라 새 컬럼이 그대로 덮인다.
-- ============================================================================

alter table public.services add column if not exists praise_playlist_url text;

comment on column public.services.praise_playlist_url is
  '찬양 재생목록 주소(youtube.com/playlist?list=…). 곡을 가져온 재생목록을 그대로 남겨 보기에서 한 번에 연다';

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   \d services      -- praise_leader · praise_playlist_url 둘 다 text | nullable

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- alter table public.services drop column if exists praise_playlist_url;
