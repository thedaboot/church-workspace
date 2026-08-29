-- 0031 · 엑셀 첨부의 '구글 시트로 변환한 사본' id
--
-- 왜 사본이 필요한가:
-- 구글은 .xlsx를 **열어볼 때 게을리 변환**한다. 그래서 갓 올린 파일은
-- docs.google.com/spreadsheets/<id>/preview 가 "Google Docs에 오류가 발생했습니다"를
-- 낸다(45초 뒤에도 그랬다 — utils.SHEET_READY_MS 주석). 우리는 그 30분을 못 기다려서
-- 앱이 직접 표를 그렸는데(SheetView), 사용자가 구글이 그리는 화면을 원했다
-- (사용자 결정 2026-08-29 — "그냥 이 스프레드시트 뷰 그대로 보여주고 싶다").
--
-- Apps Script가 업로드 직후 Drive.Files.copy로 **네이티브 구글 시트 사본**을 만든다.
-- 변환이 그 순간 끝나 있으므로 기다릴 것이 없다. 원본 .xlsx는 그대로 둔다 —
-- 내려받기와 '새 탭에서 열기'는 원본을 주고, 첨부 내용 검색도 원본을 읽는다.
-- 원본을 버리면 구글 변환에서 미묘하게 달라진 것을 되돌릴 길이 없다(결산 파일에는
-- 도장 스캔과 회계식 서식이 들어 있다).
--
-- 값이 없으면(변환 실패·옛 첨부·엑셀이 아닌 파일) 앱은 예전 길로 떨어진다.
alter table public.files add column if not exists preview_file_id text;

comment on column public.files.preview_file_id is
  '엑셀 첨부를 구글 시트로 변환한 사본의 드라이브 id. 미리보기 전용이고 원본은 drive_file_id다.';

-- 되돌리기:
--   alter table public.files drop column if exists preview_file_id;
--   (드라이브에 남은 변환 사본은 scripts/drive_check.mjs --fix 로 정리한다)
