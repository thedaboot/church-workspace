-- ============================================================================
-- 0081 주보 표지 사진 (사용자 결정 2026-09-26 · 목업 mockup-followup 2 · mockup-grace 2)
-- ----------------------------------------------------------------------------
-- 주보마다 사진 한 장을 표지로 올린다 — 예배 목록 카드 · 주보 상세 머리 · 넘기면서 보기 표지 ·
-- 공개 보기(api/service-view)에 깔린다. **주보 종이(PDF)에는 싣지 않는다**(공식 문서 — §7 캐릭터 컷과 같은 선).
--
-- 저장 자리 둘:
--   · 사진 파일 — 주보 첨부와 **같은 길**(files 표 · 그 주보의 드라이브 폴더 `예배/<날짜>` ·
--     cloud.uploadServiceFile). 갈래만 `files.kind = 'cover'`로 가른다(0054의 check에 더한다).
--     주보당 한 장이다 — 새로 올리면 앱이 옛 표지를 지운다(행 먼저, 드라이브는 휴지통 · deleteAttachment).
--     유일 인덱스는 두지 않는다: 새 행을 넣은 **뒤에** 옛 행을 지우므로(올리다 실패해도 옛 표지가 남게)
--     잠깐 두 행이 겹치고, 읽는 쪽은 가장 최근 한 장을 쓴다(serviceView.coverMap).
--     RLS는 0047·0071 그대로다(service_id 갈래 = can_edit_service · 읽기는 발행본 또는 편집 자격).
--   · 보일 부분 — `services.cover_focus_y` 0~1 한 칸. 목록 카드 비율(343:76) 틀을 사진 위에서 위아래로만
--     끌어 고른 값이고, 그리는 쪽은 `object-position: 50% {y*100}%` 한 줄이다(가로는 늘 폭을 다 채운다).
--     새 사진을 올리면 앱이 .5로 되돌린다. 사진을 지워도 값은 둔다(다음 업로드가 되돌린다).
--
-- **앱이 이 칸을 읽기 시작한다 — 이 마이그레이션이 먼저 나가야 한다(HANDOFF §3-4).**
-- 예배 목록 조회(worship.js COLS)에 cover_focus_y가 들어가서, 칸이 없으면 예배 목록이 못 읽음 자리가 된다.
-- ============================================================================
begin;

alter table public.files drop constraint if exists files_kind_check;
alter table public.files add constraint files_kind_check
  check (kind is null or kind in ('songform', 'cuesheet', 'cover'));
comment on column public.files.kind is
  '주보 파일의 갈래 — songform(송폼) · cuesheet(큐시트) · cover(표지 사진 · 주보당 한 장 · 0081). 업무 첨부는 null(0054)';

alter table public.services add column if not exists cover_focus_y real not null default 0.5;
alter table public.services drop constraint if exists services_cover_focus_y_check;
alter table public.services add constraint services_cover_focus_y_check
  check (cover_focus_y >= 0 and cover_focus_y <= 1);
comment on column public.services.cover_focus_y is
  '표지 사진의 보일 세로 위치 0~1 — object-position: 50% {값*100}% (0081)';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'files_kind_check';
--   -- ... 'songform', 'cuesheet', 'cover' ...
--   select column_name, data_type, column_default, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'services' and column_name = 'cover_focus_y';
--   -- real · 0.5 · NO
--   select count(*) from public.services where cover_focus_y <> 0.5;   -- 0

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   (먼저 앱을 되돌린다 — worship.js COLS가 cover_focus_y를 읽는다)
--   delete from public.files where kind = 'cover';     -- 드라이브 실체는 scripts/drive_check.mjs로 정리
--   alter table public.files drop constraint if exists files_kind_check;
--   alter table public.files add constraint files_kind_check check (kind is null or kind in ('songform', 'cuesheet'));
--   alter table public.services drop column if exists cover_focus_y;
