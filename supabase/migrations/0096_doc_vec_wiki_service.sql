-- ============================================================================
-- 0096 — doc_vec에 위키 장 · 주보 (20차 ② · 2026-10-12 · 다붓이 검색 모드)
-- ----------------------------------------------------------------------------
-- 다붓이는 묻는 사람이 볼 수 있는 기록 전부(약 6만 토큰)를 모델에 싣는다(통째 모드). 검색 모드
-- (api/_wikiAsk.js · 환경변수 DABOOTI_RETRIEVE=1)는 질문을 임베딩해 match_docs로 가까운 기록만 고른다 —
-- 그런데 doc_vec에는 업무 · 댓글 · 첨부(0074)만 있어서 **위키 장과 주보(광고)**가 뜻 찾기에 안 걸렸다.
-- 두 종류를 더한다(api/_docsync.js가 크론에서 만든다 · 글은 다붓이 근거와 같은 글 — api/_wiki/evidence.js).
--   · wiki    — 위키 장 하나(사람이 고친 글 겹침). 원본 칸 page_id(text — wiki_pages.id가 text다). 자주 묻는 질문 장(faq)은
--               넣지 않는다(마스터만 읽는 장 · 아래 doc_vec_no_faq가 둘째 겹).
--   · service — 발행된 주보 하나(설교 · 찬양 · 광고 + 딸린 파일 이름). 원본 칸 service_id. 작성 중 주보는 넣지 않는다
--               (services_select는 발행본만 모두에게 연다 — is_approved() 하나로 읽는 이 표에 넣으면 샌다).
--   사람 줄 · QT · 오늘 줄은 넣지 않는다 — 검색 모드가 늘 싣는다(작고 질문마다 쓰인다).
--
-- 바뀌는 것
--   · source_id: uuid → **text** 생성 칸(coalesce(card_id::text, comment_id::text, file_id::text, service_id::text, page_id)).
--     page_id가 text라 uuid로는 못 잇는다. (kind, source_id, chunk) 유일 제약은 그대로 다시 건다 — PostgREST onConflict 열쇠가 같다.
--     있던 행의 source_id는 생성 칸이 다시 채운다(uuid 글자 그대로라 api/_docsync.js의 열쇠 비교가 그대로 맞는다).
--   · match_docs: 돌려주는 칸 끝에 page_id · service_id. **kinds를 안 주면(null) 예전 세 종류만** — 상단 검색의
--     '관련된 업무 내용'(services/semantic.js · vecSearch.relatedTasks)은 업무로 묶는 길이라 위키·주보 행이 끼면 자리만 먹는다.
--     다붓이는 kinds를 다섯 다 준다. 칸 모양이 바뀌어 create or replace가 안 되므로 지우고 다시 만든다.
--   · 권한은 0074 그대로(읽기 is_approved · 쓰기 서버 키만 · invoker). 위키 장(faq 빼고)·발행된 주보는 원본 표도 승인된 사람이
--     모두 읽는다 — 이 표가 새로 여는 것은 없다.
--
-- 순서: **이 마이그레이션 → 코드 푸시**(§3-4). 코드가 먼저 나가도 _docsync는 page_id 칸이 없으면 두 종류를 건너뛴다.
-- 적용 뒤 첫 크론(또는 `node scripts/embed-docs.mjs --kind=wiki,service`)이 조각 약 40개를 만든다(글 약 6만 자 · 1센트 아래).
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

alter table public.doc_vec drop constraint doc_vec_source_chunk;
alter table public.doc_vec drop constraint doc_vec_one_source;
alter table public.doc_vec drop constraint doc_vec_kind_check;
alter table public.doc_vec drop column source_id;

alter table public.doc_vec add column service_id uuid references public.services(id) on delete cascade;
alter table public.doc_vec add column page_id text references public.wiki_pages(id) on delete cascade;
alter table public.doc_vec add column source_id text
  generated always as (coalesce(card_id::text, comment_id::text, file_id::text, service_id::text, page_id)) stored;

alter table public.doc_vec add constraint doc_vec_kind_check
  check (kind in ('card', 'comment', 'file', 'wiki', 'service'));
-- 원본은 정확히 하나이고, kind가 가리키는 칸이 그 하나다
alter table public.doc_vec add constraint doc_vec_one_source check (
  num_nonnulls(card_id, comment_id, file_id, service_id, page_id) = 1
  and (kind <> 'card'    or card_id    is not null)
  and (kind <> 'comment' or comment_id is not null)
  and (kind <> 'file'    or file_id    is not null)
  and (kind <> 'service' or service_id is not null)
  and (kind <> 'wiki'    or page_id    is not null)
);
alter table public.doc_vec add constraint doc_vec_no_faq check (page_id is distinct from 'faq');
alter table public.doc_vec add constraint doc_vec_source_chunk unique (kind, source_id, chunk);

drop function if exists public.match_docs(extensions.halfvec, int, text[]);
-- 질문 벡터 하나 → 가까운 조각 k개(0074와 같다). kinds가 null이면 업무 · 댓글 · 첨부만(상단 검색 — 위 머리말).
create function public.match_docs(q extensions.halfvec(768), k int default 20, kinds text[] default null)
returns table (kind text, card_id uuid, comment_id uuid, file_id uuid, project_id uuid, chunk int, body text, score real, page_id text, service_id uuid)
language sql stable security invoker
set search_path = public, extensions, pg_temp
as $$
  select t.kind, coalesce(t.card_id, c.card_id, f.card_id), t.comment_id, t.file_id, t.project_id, t.chunk, t.body, t.score, t.page_id, t.service_id
    from (
      select d.kind, d.card_id, d.comment_id, d.file_id, d.project_id, d.chunk, d.body, d.page_id, d.service_id,
             (1 - (d.vec <=> q))::real as score, (d.vec <=> q) as dist
        from public.doc_vec d
       where (kinds is null and d.kind in ('card', 'comment', 'file')) or d.kind = any (kinds)
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
--   select kind, count(*), count(distinct source_id) from public.doc_vec group by 1 order by 1;
--     → 적용 직후는 card · comment · file 그대로(크론이 돈 뒤 wiki 약 28장 · service 발행 주보 수)
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'doc_vec_one_source';
--   select kind, page_id, service_id, left(body, 30), score
--     from public.match_docs((select vec from public.doc_vec where kind = 'wiki' limit 1), 3, array['wiki', 'service']);
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- delete from public.doc_vec where kind in ('wiki', 'service');
-- drop function if exists public.match_docs(extensions.halfvec, int, text[]);
-- alter table public.doc_vec drop constraint doc_vec_source_chunk;
-- alter table public.doc_vec drop constraint doc_vec_one_source;
-- alter table public.doc_vec drop constraint doc_vec_no_faq;
-- alter table public.doc_vec drop constraint doc_vec_kind_check;
-- alter table public.doc_vec drop column source_id;
-- alter table public.doc_vec drop column page_id;
-- alter table public.doc_vec drop column service_id;
-- alter table public.doc_vec add column source_id uuid generated always as (coalesce(card_id, comment_id, file_id)) stored;
-- alter table public.doc_vec add constraint doc_vec_kind_check check (kind in ('card', 'comment', 'file'));
-- alter table public.doc_vec add constraint doc_vec_one_source check (
--   num_nonnulls(card_id, comment_id, file_id) = 1
--   and (kind <> 'card' or card_id is not null) and (kind <> 'comment' or comment_id is not null) and (kind <> 'file' or file_id is not null));
-- alter table public.doc_vec add constraint doc_vec_source_chunk unique (kind, source_id, chunk);
-- -- match_docs는 0074의 create or replace 문단을 그대로 다시 돌린다(칸 여덟 · kinds null이면 전부)
-- -- revoke execute … from public, anon; grant execute … to authenticated, service_role;  (0074와 같다)
-- commit;
