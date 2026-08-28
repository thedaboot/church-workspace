-- ============================================================================
-- 0030 — AI가 볼 두 가지: 사람의 역할, 첨부 파일의 텍스트 (2026-08-28)
-- ----------------------------------------------------------------------------
-- ① profiles.role_note
--    AI가 사람을 부를 때 "OOO 청년" 대신 "조해리 총무님"이라고 부르게 하는 값이다.
--    지금까지는 `services/ai.js`의 ORG_CONTEXT에 손으로 적은 표였는데 두 가지가 나빴다:
--      · 표시명으로 사람을 매달아서 **개명하면 끊긴다**(말감이 → 임재훈 예정).
--      · 이 레포는 공개다. id로 매달면 교인 uuid가 공개 레포에 올라간다.
--    행에 붙여 두면 개명해도 따라가고, 코드에는 아무 개인 정보도 안 남는다.
--
--    팀은 이미 profiles.team_id + profile_teams에 있으므로 여기 적지 않는다.
--    겸직(조해리 = 찬양팀 + 임원진)도 그쪽이 이미 담고 있다. 다만 정민경·시온의
--    '찬양팀 베이스'처럼 profile_teams에 안 들어간 겸업은 역할 문구가 담는다.
--
-- ② files.text_excerpt
--    첨부 파일에서 뽑은 텍스트 앞부분(2000자 상한). 업로드하는 순간 브라우저가
--    이미 쥐고 있는 바이트로 뽑으므로 **추가 다운로드가 없다**. 요약 프롬프트와
--    검색이 같이 읽는다. 사진은 뽑을 게 없어 그냥 비어 있다(232건 중 228건이 사진).
--    지난 파일은 백필하지 않는다 — 드라이브에서 232개를 다시 받는 것은 Egress를
--    늘리는 일이라(HANDOFF §1.3), 사람이 미리보기로 여는 김에 채운다.
--
-- 둘 다 **없어도 앱이 도는 값**이다(null이면 그 줄을 프롬프트에서 뺀다).
-- 그래서 RLS 정책은 건드리지 않는다 — 두 표의 기존 select 정책이 그대로 덮는다.
-- ============================================================================

alter table public.profiles add column if not exists role_note text;
alter table public.files    add column if not exists text_excerpt text;

comment on column public.profiles.role_note is
  'AI가 이 사람을 부를 때 쓰는 직함·역할. 예: "총무 · 회계 · 찬양팀 여자 싱어"';
comment on column public.files.text_excerpt is
  '첨부에서 뽑은 텍스트 앞부분(2000자 상한). 사진은 비어 있다.';

-- ── 역할 백필 (2026-08-28 사용자가 불러준 것) ───────────────────────────────
-- 지금 표시명으로 한 번만 맞춘다. 이후 개명은 값이 행에 남아 있으므로 무관하다.
update public.profiles set role_note = v.role
from (values
  ('임성빈', '담당 교역자(전도사님)'),
  ('신효진', '부장님'),
  ('양민혁', '청년부 회장 · 여러 팀을 섬기는 팀원'),
  ('정민경', '리더순장 · 찬양팀 베이스'),
  ('조준환', '예배팀장 · 찬양팀 남자 싱어'),
  ('조해리', '총무 · 회계 · 찬양팀 여자 싱어'),
  ('박지호', '리더팀장 · 웰컴팀장'),
  ('노준석', '순장 · 찬양팀장'),
  ('김승찬', '순장 · 찬양팀 일렉(팀에서 유일)'),
  ('말감이', '순장 · 찬양팀 남자 싱어'),
  ('시온',   '미디어팀장 · 찬양팀 베이스'),
  ('김윤주', '순장'),
  ('문진혁', '엔지니어팀장')
) as v(name, role)
where public.profiles.display_name = v.name;

-- ── 확인 ───────────────────────────────────────────────────────────────────
--   select display_name, role_note from public.profiles
--     where removed_at is null order by display_name;
--   -- 13행에 값이 있어야 한다(강희라는 역할이 없어 null이 맞다)
--   select count(*) from public.files where text_excerpt is not null;  -- 0 (아직 안 쌓임)

-- ── 되돌리기 ───────────────────────────────────────────────────────────────
-- alter table public.profiles drop column if exists role_note;
-- alter table public.files    drop column if exists text_excerpt;
