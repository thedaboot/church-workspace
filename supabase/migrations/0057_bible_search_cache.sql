-- ============================================================================
-- 0057 — 성경 AI 본문 검색 캐시 (2026-09-09 사용자 요청)
-- ----------------------------------------------------------------------------
-- "동일한 검색어로 검색했을 경우(다른 사용자가 검색했을 때에도 마찬가지) 이 결과는
-- 캐싱하여 AI로 안 쏘게끔." — 그래서 브라우저 안에 둘 수 없다. 지금 캐시는 탭 수명
-- 메모리 하나뿐이어서(services/bibleSearch.js `memo`) 새로고침하면 같은 말에 다시
-- 과금됐고, 옆 사람이 같은 말을 치면 또 나갔다.
--
-- **담는 것은 모델이 낸 구절 참조 문자열뿐이다.** 본문 글자는 넣지 않는다 —
-- resolveBibleHits가 public/bible/*.json에서 매번 붙이므로
--   · 성경 데이터를 갈아 끼워도 캐시가 낡지 않고,
--   · 지어낸 참조가 담겼더라도 읽을 때 파서(bibleRef)가 거른다.
-- 행 하나가 수십 바이트라 지우는 크론도 두지 않았다(물음의 가짓수가 이 규모에서
-- 문제가 되지 않는다). 커지면 그때 created_at으로 잘라내면 된다.
--
-- 열쇠는 `bibleSearch.normalizeQuery`의 결과다(앞뒤 공백 걷고 · 가운데 공백 한 칸 ·
-- 소문자). **열쇠를 만드는 자리는 그 함수 한 곳뿐이어야 한다** — 두 벌이 되면
-- 같은 말이 다른 행에 앉아 캐시가 반만 맞는다(§6-31-f가 비밀번호에서 밟은 함정).
--
-- 정책은 select/insert만 연다.
--   · update가 없는 이유: 같은 말의 답을 남이 덮어쓸 이유가 없다. 캐시 갱신이 아니라
--     **덮어쓰기 사고**만 가능해진다. 앱도 insert만 부른다(이미 있으면 23505를 삼킨다).
--   · delete는 마스터만: 답이 이상하게 굳으면 지울 길이 하나는 있어야 한다.
--     없으면 잘못 캐시된 물음이 영영 그대로다.
-- **실시간 발행(0049·0056)에는 넣지 않는다** — 이 표가 바뀌었다고 다시 그릴 화면이
-- 없다. 넣으면 liveV2의 TABLE_CACHE와 tests/logcheck의 V2_TABLES 숫자까지 세 자리를
-- 같이 고쳐야 한다(§6-9-ao).
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

create table if not exists public.bible_search_cache (
  query_norm text primary key check (char_length(query_norm) between 1 and 200),
  refs       jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.bible_search_cache enable row level security;

-- 가입 승인된 사람이면 읽는다(0022 is_approved — 이 레포의 '전원' 관용구)
create policy bible_search_cache_select on public.bible_search_cache
  for select using (public.is_approved());

-- 쓰기는 넣기만. 자기가 방금 물어본 답을 남들 몫으로 남기는 일이다
create policy bible_search_cache_insert on public.bible_search_cache
  for insert with check (public.is_approved());

-- 굳은 답을 지울 길 하나(마스터)
create policy bible_search_cache_delete on public.bible_search_cache
  for delete using (public.is_master());

comment on table public.bible_search_cache is
  '성경 AI 본문 검색 캐시 — 정규화한 물음 → 구절 참조 배열. 본문 글자는 담지 않는다(0057)';
comment on column public.bible_search_cache.refs is
  '모델이 낸 참조 문자열 배열(["빌립보서 4:6", …]). 화면 글자는 public/bible에서 붙인다';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select query_norm, jsonb_array_length(refs) n, created_at
--     from public.bible_search_cache order by created_at desc limit 20;
--   select count(*) from public.bible_search_cache;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- drop table if exists public.bible_search_cache;   -- 정책도 같이 사라진다
