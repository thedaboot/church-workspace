-- ============================================================================
-- 0023 — 엑셀 첨부 비밀번호 (사용자 결정 2026-08-25)
-- ----------------------------------------------------------------------------
-- 엑셀처럼 아무나 보면 곤란한 첨부에 비밀번호를 걸 수 있게 한다.
--
-- **이것은 화면을 가리는 잠금이다. 파일 자체를 잠그지 않는다.**
-- 사용자가 두 갈래(진짜로 막기 / 화면만 가리기) 중 화면 가림을 골랐다. 이유를
-- 남겨 둔다 — 진짜로 막으려면 그 파일이 공개가 아니어야 하는데, 엑셀 '펼쳐보기'는
-- 마이크로소프트 뷰어가 **공개로 닿을 수 있는 주소**를 받아야 동작한다. 즉
-- 진짜 잠금과 펼쳐보기는 동시에 가질 수 없다.
--
-- 그래서 화면 문구에 '암호화'라는 말을 쓰지 않는다. 주소를 직접 아는 사람은
-- 그대로 열 수 있다 — 같이 일하는 사람들 사이에서 **실수로 여는 것**을 막는
-- 수준이고, 그 이상으로 읽히게 만들면 안 된다.
--
-- 해시로 두는 이유: 평문을 두면 files를 읽을 수 있는 모든 사람이 눈으로 본다.
-- 다만 files의 SELECT는 승인된 사람 전체에 열려 있으므로 **해시도 읽힌다** —
-- 짧은 비밀번호는 오프라인에서 금방 맞춰진다. 위 문단과 같은 한계다.
-- ============================================================================

alter table public.files add column if not exists view_pw text;   -- sha-256(salt + pw), 앱에서 계산
alter table public.files add column if not exists view_pw_salt text;
alter table public.files add column if not exists view_pw_by uuid references auth.users;

comment on column public.files.view_pw is
  '화면 가림용 비밀번호 해시. 파일 자체를 잠그지 않는다 — 0023 주석 참고';

-- ── 확인 ───────────────────────────────────────────────────────────────────
--   \d public.files
--   select id, name, (view_pw is not null) as 잠김 from files order by created_at desc limit 10;

-- ── 되돌리기 ───────────────────────────────────────────────────────────────
-- alter table public.files
--   drop column if exists view_pw,
--   drop column if exists view_pw_salt,
--   drop column if exists view_pw_by;
