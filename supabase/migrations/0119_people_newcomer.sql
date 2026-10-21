-- ============================================================================
-- 0119 — 새신자 표시(people.newcomer_at · 사용자 결정 2026-10-21)
-- ----------------------------------------------------------------------------
-- 연말 보고(관리자 메뉴 · services/yearReport.js)의 '새신자'를 **명단에 들어온 날이 아니라 이 칸**으로 센다.
-- 처음에는 '그해 청년 명단에 새로 추가된 사람(첫 이관 날 제외)'으로 셌는데, 첫 이관(2026-09-01) 뒤에 들어온 셋 중
-- 문진우·김우한은 새신자가 아니고 문정원만 새신자였다(사용자 확인 2026-10-21) — 들어온 날로는 가를 수 없다.
--   newcomer_at date — 새신자로 온 날(null = 새신자 아님). 연말 보고는 newcomer_at이 그해인 사람을 센다.
-- 쓰기는 people의 기존 정책 그대로(명단을 고칠 수 있는 사람). 데이터: 문정원 = 명단에 들어온 날(2026-10-19 KST).
-- 순서: 이 마이그레이션 → 코드(코드가 이 칸을 읽는다 — 먼저 나가면 연말 보고 읽기가 실패해 '다시 시도'가 선다).
-- 되돌리기는 파일 맨 아래 주석.
-- ============================================================================

begin;

alter table public.people add column if not exists newcomer_at date;
comment on column public.people.newcomer_at is '새신자로 온 날(null = 새신자 아님) — 연말 보고의 새신자 수(0119)';

update public.people set newcomer_at = (created_at at time zone 'Asia/Seoul')::date
 where name = '문정원' and removed_at is null and newcomer_at is null;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select name, newcomer_at from public.people where newcomer_at is not null;   -- 문정원 | 2026-10-19
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   alter table public.people drop column if exists newcomer_at;
