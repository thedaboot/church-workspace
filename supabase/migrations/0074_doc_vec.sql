-- ============================================================================
-- 0074 — 업무·댓글·첨부 임베딩 (pgvector · 배치 E4 · 2026-09-25)
-- ----------------------------------------------------------------------------
-- 검색은 아직 `String.includes()`라 **첨부 내용·댓글·지난 프로젝트**의 뜻을 못 본다
-- (HANDOFF §2 "짚어둔 것"). 0073(bible_vec)과 같은 모양으로 그 셋을 조각마다 벡터로 둔다.
-- **이 파일은 뒷단만이다** — 검색 화면은 품질을 잰 뒤 목업으로(HANDOFF §2 "다음" 5).
--
-- 무엇을 넣나 (api/_docsync.js가 만든다 · 서버 키로만 쓴다)
--   · card    — '프로젝트명 / 업무 제목' + 본문(마크다운 링크·강조만 걷는다 · 청년별 담당 업무 도막은 그대로)
--   · comment — '업무 제목 · 댓글: 본문'
--   · file    — '업무 제목 · 첨부: 파일명' + files.text_excerpt(사진은 `[사진] ` 캡션 그대로)
--   긴 글은 약 1200자 조각(chunk 0, 1, …)으로 문단 경계에서 자르고 조금 겹친다. 머리줄은 조각마다 붙는다.
--   **넣지 않는 것**: 주보에 딸린 첨부(files.service_id — 작성 중 주보의 파일은 편집자만 본다.
--   is_approved() 하나로 읽는 이 표에 넣으면 그 발췌가 전원에게 샌다) · 발췌가 빈 첨부 ·
--   개인 표(service_notes·qt_entries — 공유 규칙이 사람마다 달라 이 표의 '승인된 전원' 읽기와 맞지 않는다).
--
-- 칸
--   · kind + 원본 FK 셋 중 **정확히 하나** — 원본이 지워지면 on delete cascade로 같이 사라진다
--     (업무를 지우면 댓글·첨부도 cascade로 지워지므로 그 벡터까지 따라간다). 동기화 스크립트가 지울 것은
--     "원본은 있는데 조각이 줄어든 것"뿐이다.
--   · source_id — coalesce(card_id, comment_id, file_id)를 **생성 칸**으로 둔다. (kind, source_id, chunk)
--     하나로 유일성을 걸어 upsert(on conflict)의 열쇠로 쓴다 — FK 칸 셋에 각각 부분 유일 인덱스를
--     거는 것보다 열쇠가 하나라 PostgREST의 onConflict가 그대로 먹는다.
--   · project_id — 결과를 프로젝트로 묶거나 거를 자리(업무가 다른 프로젝트로 옮기면 동기화가 고친다).
--     FK는 걸지 않는다 — 프로젝트가 지워지면 cards가 cascade로 지워지고 이 행도 따라간다.
--   · body — 임베딩한 글 그대로(결과 줄을 그릴 때 원본을 다시 읽지 않게).
--   · body_hash — **임베딩한 글의 sha256**(updated_at이 아니다). 카드는 담당자·상태만 바뀌어도
--     updated_at이 밀려서(trg_cards_updated_meta) 그걸 열쇠로 삼으면 매번 다시 임베딩한다.
--   · vec — gemini-embedding-001 · 768차원 · 단위 길이(0073과 한 벌 · api/ai.js EMBED_MODEL·EMBED_DIM·unitVec).
--
-- **벡터 인덱스를 만들지 않는다**(0073과 같은 판단). 2026-09-25 라이브 기준 원본이 업무 84 · 댓글 77 ·
-- 첨부 250(업무에 달린 것)이라 조각이 500개 안팎이다 — 전수 비교가 1ms대다. 유일성 제약이 만드는
-- btree 하나만 있다. 크기는 롤백 안에서 잰 값을 NOTES-E4.md에 적었다.
--
-- 권한
--   · 읽기는 승인된 사람(is_approved). 원본 셋(cards·comments·files)의 select 정책도 is_approved()이고
--     (files는 주보 첨부만 더 좁다 — 위에서 뺐다), 첨부의 view_pw(0023)는 **화면 가림**이라
--     text_excerpt는 이미 승인된 사람이 읽을 수 있다 — 이 표가 새로 여는 것은 없다.
--   · **쓰기는 서버 키만**(api/_docsync.js — 8시 크론 · ?job=embed · scripts/embed-docs.mjs).
--     쓰기 정책을 두지 않고, 표 권한에서도 뺀다(둘째 겹).
--   · match_docs는 **security invoker** — 부르는 사람의 RLS가 그대로 걸린다. anon은 실행도 못 한다.
--   · 실시간 발행에는 넣지 않는다(0073과 같다).
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

create table if not exists public.doc_vec (
  id         bigserial primary key,
  kind       text not null check (kind in ('card', 'comment', 'file')),
  card_id    uuid references public.cards(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  file_id    uuid references public.files(id) on delete cascade,
  source_id  uuid generated always as (coalesce(card_id, comment_id, file_id)) stored,
  project_id uuid,
  chunk      int not null default 0 check (chunk >= 0),
  body       text not null,
  body_hash  text not null,
  vec        extensions.halfvec(768) not null,
  updated_at timestamptz not null default now(),
  -- 원본은 정확히 하나이고, kind가 가리키는 칸이 그 하나다
  constraint doc_vec_one_source check (
    num_nonnulls(card_id, comment_id, file_id) = 1
    and (kind <> 'card'    or card_id    is not null)
    and (kind <> 'comment' or comment_id is not null)
    and (kind <> 'file'    or file_id    is not null)
  ),
  constraint doc_vec_source_chunk unique (kind, source_id, chunk)
);

alter table public.doc_vec enable row level security;

create policy doc_vec_select on public.doc_vec
  for select using (public.is_approved());

-- 쓰기 정책은 없다. 표 권한에서도 빼 둔다 — 누가 정책을 잘못 더해도 클라이언트가 못 쓴다
revoke insert, update, delete, truncate on public.doc_vec from anon, authenticated;

comment on table public.doc_vec is
  '업무·댓글·첨부 조각 임베딩 — gemini-embedding-001 768차원(단위 길이). 인덱스 없이 전수 비교(0074)';

-- 질문 벡터 하나 → 가까운 조각 k개. q는 단위 길이여야 한다(api/ai.js의 embed가 맞춘다).
-- score는 코사인 유사도(1 − 코사인 거리). k는 1~100으로 가둔다. kinds로 종류를 거른다(null이면 전부).
-- card_id는 **그 조각이 속한 업무**다 — 댓글·첨부 조각은 원본 행에서 업무를 찾아 붙인다(열 때 쓸 자리).
-- 가까운 k개를 먼저 고른 뒤에 잇는다(원본 조인은 k행만).
create or replace function public.match_docs(q extensions.halfvec(768), k int default 20, kinds text[] default null)
returns table (kind text, card_id uuid, comment_id uuid, file_id uuid, project_id uuid, chunk int, body text, score real)
language sql stable security invoker
set search_path = public, extensions, pg_temp
as $$
  select t.kind, coalesce(t.card_id, c.card_id, f.card_id), t.comment_id, t.file_id, t.project_id, t.chunk, t.body, t.score
    from (
      select d.kind, d.card_id, d.comment_id, d.file_id, d.project_id, d.chunk, d.body,
             (1 - (d.vec <=> q))::real as score, (d.vec <=> q) as dist
        from public.doc_vec d
       where kinds is null or d.kind = any (kinds)
       order by d.vec <=> q
       limit least(greatest(coalesce(k, 20), 1), 100)
    ) t
    left join public.comments c on c.id = t.comment_id
    left join public.files f on f.id = t.file_id
   order by t.dist;
$$;

revoke execute on function public.match_docs(extensions.halfvec, int, text[]) from public, anon;
grant execute on function public.match_docs(extensions.halfvec, int, text[]) to authenticated, service_role;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select kind, count(*), count(distinct source_id), sum(length(body))
--     from public.doc_vec group by 1 order by 1;
--   select pg_size_pretty(pg_total_relation_size('public.doc_vec'));
--   select kind, left(body, 40), score from public.match_docs((select vec from public.doc_vec order by id limit 1), 5);
--     → 첫 줄이 그 조각 자신이고 score ≈ 1이어야 한다
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- drop function if exists public.match_docs(extensions.halfvec, int, text[]);
-- drop table if exists public.doc_vec;              -- 정책도 같이 사라진다
-- (vector 확장은 0073의 bible_vec이 쓰므로 지우지 않는다)
