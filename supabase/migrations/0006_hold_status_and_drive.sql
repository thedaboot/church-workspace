-- ============================================================================
-- 0006_hold_status_and_drive.sql
-- ----------------------------------------------------------------------------
-- (A) 업무 상태에 '보류 중'(DB 'hold') 추가
-- (B) 개인 구글 드라이브 연동을 위한 최소 구조 — 프로젝트별 드라이브 폴더 참조
--     파일 실체를 드라이브로 옮길 때 files.source='drive'로 바꾸고
--     drive_file_id/web_view_link만 채우면 앱은 그대로 동작한다(읽기 경로 분기됨).
-- ============================================================================

-- ── (A) cards.status: 'hold' 허용 ────────────────────────────────────────
alter table public.cards drop constraint if exists cards_status_check;
alter table public.cards add constraint cards_status_check
  check (status in ('todo', 'doing', 'hold', 'done'));

-- ── (B) 드라이브 마이그레이션 구조 ────────────────────────────────────────
-- 프로젝트 = 드라이브의 폴더 1개. 소유자가 폴더를 만들고 ID만 여기에 적으면 된다.
alter table public.projects add column if not exists drive_folder_id text;

-- files.source는 0003에서 ('storage','drive') 체크로 이미 만들어져 있다.
-- 드라이브로 옮긴 파일은 storage_path가 비고 drive_file_id/web_view_link가 채워진다.
create index if not exists idx_files_source on public.files(source);
