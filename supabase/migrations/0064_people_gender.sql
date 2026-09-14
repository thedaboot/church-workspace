-- ============================================================================
-- 0064 — people.gender: 주보·홈의 호칭을 '청년'에서 '형제/자매'로 (2026-09-14 요청)
-- ----------------------------------------------------------------------------
-- 사용자 요청(9차 개선): "주보 내 명칭 수정: 'OOO 청년' → 'OOO 형제/자매'로 변경.
-- 변경을 위해 사용자 프로필에 성별 컬럼 추가 (각 청년별로 노준석 형제가 직접 입력).
-- 대표기도, 헌금 봉헌, 찬양 인도 명칭도 동일하게 적용."
--
-- **왜 profiles가 아니라 people인가.** 호칭을 붙이는 것은 `services/people.js`의
-- honorific 한 벌이고, 그 함수가 보는 축은 **명단**(people)이다 — 명단에 없는 이름은
-- 애초에 호칭을 안 붙인다(객원 인도자·외부 강사). 계정(profiles)에 두면 가입하지 않은
-- 청년(53명 중 다수)에게 호칭이 영영 안 붙는다. 0035가 명단과 계정을 가른 이유 그대로다.
--
-- 컬럼이 맞는 자리다(HANDOFF §3-1): 명단 사람과 **언제나 같이 읽고**, 값은 한 사람에
-- 하나뿐이며, 성별만 따로 조회·집계할 일이 없다.
--
-- **nullable이다**(사용자 결정 2026-09-14). 53명을 다 채우기 전에도 화면은 돌아야 하고,
-- 비어 있는 동안은 지금과 같은 '청년'으로 부른다(`services/people.js` HONORIFIC.youth).
-- not null + 기본값 '형제'로 백필하면 고치기 전까지 자매를 형제라고 부르게 된다.
--
-- 값은 'm'·'f' 두 글자다. 화면 글자('형제'·'자매')를 DB에 넣지 않는 이유는 팀 표와
-- 같다 — 부르는 말이 바뀌면 데이터가 아니라 `HONORIFIC`만 고치면 된다.
--
-- **정책은 그대로다.** people의 RLS는 0035·0045가 만든 **행 단위**라 컬럼이 늘어도
-- 경계가 달라지지 않는다. 컬럼 단위 권한은 이 레포에 쓰지 않는다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

alter table public.people add column if not exists gender text;

alter table public.people drop constraint if exists people_gender_check;
alter table public.people add constraint people_gender_check
  check (gender is null or gender in ('m', 'f'));

comment on column public.people.gender is
  '성별 — ''m''=형제 · ''f''=자매 · null=아직 모름(그때는 ''청년''으로 부른다). '
  '화면 글자는 services/people.js의 HONORIFIC이 정한다(0064)';

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='people' and column_name='gender';
--   -- gender | text | YES
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.people'::regclass and conname='people_gender_check';
--
--   select count(*) filter (where gender is null) as 아직,
--          count(*) filter (where gender = 'm')   as 형제,
--          count(*) filter (where gender = 'f')   as 자매
--     from public.people where removed_at is null;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   alter table public.people drop constraint if exists people_gender_check;
--   alter table public.people drop column if exists gender;
--   (클라이언트도 같이 — services/people.js honorific·honorificsOf, services/roster.js,
--    components/roster.jsx의 성별 칩이 이 칸을 본다)
