-- ============================================================================
-- 0073 — 성경 절 임베딩 (pgvector · 배치 E1 · 2026-09-24)
-- ----------------------------------------------------------------------------
-- 지금 뜻 검색(services/bibleSearch.js)은 제미나이에게 **구절 참조만** 받아 온다. 모델이
-- 외운 것에 기대므로 잘 알려진 절로 쏠리고, 본문을 직접 보고 고르지는 않는다. 절마다
-- 벡터를 한 번 만들어 두면 질문 하나를 임베딩해 전수 비교로 가까운 절을 고를 수 있다.
-- **이 파일은 뒷단만이다** — 화면은 그대로이고, 기존 AI 검색과 질의 30개로 나란히 재서
-- (scripts/compare-bible-search.mjs) 이겨야 폴백으로 내린다(HANDOFF §2 "다음").
--
-- 칸
--   · ref   — '창세기 1:1'(bibleRef.formatRef의 모양). 사람이 읽는 라벨이자 parseRef가 다시
--             읽는 모양이라 열쇠로 삼았다. 기계 열쇠(`gen 1:1`)는 book·chapter·verse로 만든다.
--   · body  — 개역한글 본문 그대로(public/bible). 결과 줄을 그리려고 책 파일을 다시 받지 않게.
--   · vec   — gemini-embedding-001 · 768차원 · **단위 길이로 맞춘 뒤** 넣는다(768차원 출력은
--             정규화되어 오지 않는다 — 질문 쪽도 api/ai.js에서 똑같이 맞춘다).
--             `halfvec`(성분당 2바이트 · 유효 숫자 3자리 남짓)이라 벡터 하나가 약 1.5kB다 —
--             `vector`(4바이트)의 절반이다. 순위가 흔들리는지는 비교 스크립트로 본다.
--   '(없음)'·'(N절에 포함되어 있음)'처럼 편집 표기만 있는 36절은 넣지 않는다(scripts/embed-bible.mjs).
--
-- **인덱스를 만들지 않는다.** 31,103절(편집 표기를 빼면 31,067행)은 전수 비교로 충분하다 —
-- 라이브 DB에 같은 크기의 무작위 행을 넣고 롤백으로 재 보니 표가 **62MB**, top-30 한 번이
-- psql 왕복 포함 **0.09~0.22초**였다(캐시가 식은 첫 호출만 3초). 무료 등급 500MB에서 HNSW
-- 인덱스는 데이터만큼 더 먹고, 근사 검색이라 재현율도 잃는다. 행이 몇 배로 늘면(통합 검색 · E4)
-- 그때 다시 잰다.
--
-- 권한
--   · 읽기는 승인된 사람(0022 is_approved — 이 레포의 '전원' 관용구).
--   · **쓰기는 서비스 키만**(색인 스크립트). 쓰기 정책을 두지 않고, 표 권한에서도 뺀다(둘째 겹).
--   · match_bible은 **security invoker** — 부르는 사람의 RLS가 그대로 걸린다. 미승인·익명은
--     빈 결과다. anon에게는 실행 권한도 주지 않는다.
--   · 실시간 발행(0049·0056)에는 넣지 않는다 — 바뀌어도 다시 그릴 화면이 없다(0057과 같은 판단).
--
-- 확장은 `extensions` 스키마에 둔다(Supabase 관례 — public을 더럽히지 않는다). 그래서 함수의
-- search_path에 extensions를 넣어야 `<=>` 연산자가 보인다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

create extension if not exists vector with schema extensions;

create table if not exists public.bible_vec (
  book    text not null,                 -- public/bible/index.json의 id ('gen')
  chapter int  not null check (chapter >= 1),
  verse   int  not null check (verse >= 1),
  ref     text primary key,              -- '창세기 1:1'
  body    text not null,
  vec     extensions.halfvec(768) not null
);

alter table public.bible_vec enable row level security;

create policy bible_vec_select on public.bible_vec
  for select using (public.is_approved());

-- 쓰기 정책은 없다. 표 권한에서도 빼 둔다 — 누가 정책을 잘못 더해도 클라이언트가 못 쓴다
revoke insert, update, delete, truncate on public.bible_vec from anon, authenticated;

comment on table public.bible_vec is
  '성경 절 임베딩 — gemini-embedding-001 768차원(단위 길이). 인덱스 없이 전수 비교(0073)';

-- 질문 벡터 하나 → 가까운 절 k개. q도 단위 길이여야 한다(api/ai.js의 embed가 맞춘다).
-- score는 코사인 유사도(1 − 코사인 거리)다. k는 1~100으로 가둔다.
create or replace function public.match_bible(q extensions.halfvec(768), k int default 30)
returns table (ref text, book text, chapter int, verse int, body text, score real)
language sql stable security invoker
set search_path = public, extensions, pg_temp
as $$
  select b.ref, b.book, b.chapter, b.verse, b.body, (1 - (b.vec <=> q))::real as score
    from public.bible_vec b
   order by b.vec <=> q
   limit least(greatest(coalesce(k, 30), 1), 100);
$$;

revoke execute on function public.match_bible(extensions.halfvec, int) from public, anon;
grant execute on function public.match_bible(extensions.halfvec, int) to authenticated, service_role;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select count(*), pg_size_pretty(pg_total_relation_size('public.bible_vec')) from public.bible_vec;
--   select ref, score from public.match_bible((select vec from public.bible_vec where ref = '요한복음 3:16'), 5);
--     → 첫 줄이 요한복음 3:16이고 score ≈ 1이어야 한다
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- drop function if exists public.match_bible(extensions.halfvec, int);
-- drop table if exists public.bible_vec;            -- 정책도 같이 사라진다
-- drop extension if exists vector;                  -- 다른 표가 vector를 쓰기 시작했으면 지우지 말 것
