-- ============================================================================
-- 0088 — 더다붓 위키 + 다붓이에게 물어보기 (16차 · 목업 LKarXC8WVahATdEuyivvRp v12)
-- ----------------------------------------------------------------------------
-- 표 셋:
--   · wiki_pages        장 하나에 한 줄. 화면이 그리는 블록(blocks jsonb)을 **서버가 통째로** 쓴다
--                       (api/_wiki.js — 매일 8시 크론 · scripts/wiki-build.mjs). 원본이 그대로면
--                       src_hash가 같아 다시 모으지 않는다. 함께 쓰는 글(kind='human')은 처음 한 번만 심는다.
--   · wiki_edits        사람이 고친 문장. (장, 문장 열쇠)마다 한 줄 — 다음 날 다시 모아도 **덮지 않는다**
--                       (화면과 서버가 블록 위에 겹쳐 그린다 · services/wikiCore.overlayEdits).
--                       before(고치기 전 글)는 위키 글쓰기 프롬프트의 '사람이 고친 예'가 된다(자가 개선).
--                       빈 글자 = 그 줄을 지웠다.
--   · dabooti_questions 다붓이에게 물어본 글과 답. **누가 물었는지 칸이 없다**(익명 · 사용자 반대 없음 2026-10-03).
--                       몰랐던 질문·나쁨 표시는 위키 '자주 묻는 질문'에 서서 사람이 답을 적고,
--                       검증이 걸러 낸 문장(dropped)은 다음 답의 '하지 말 것' 예가 된다.
--
-- 정책
--   · wiki_pages: 읽기 is_approved() · 쓰기 정책 없음(서버 키만)
--   · wiki_edits: 읽기·쓰기 is_approved() — 위키는 함께 쓰는 곳이라 누구나 고친다. 지우기 정책은 없다
--                 (되돌리는 것도 고치기다). 고친 사람·때는 트리거가 세션에서 정한다(남의 이름으로 못 쓴다 —
--                 0071 guard_author_column은 update에서 옛 사람을 지켜 버려 여기에 맞지 않는다).
--   · dabooti_questions: 정책 없음(서버 키만 — 질문 글에 개인 사정이 섞일 수 있다)
-- 실시간 발행에는 넣지 않는다 — 위키는 열 때 한 번 읽는다.
--
-- **코드보다 먼저 나가야 한다**(HANDOFF §3-4). 첫 읽기 loadCloudState는 이 표를 보지 않아
-- 다른 화면에는 영향이 없다(없으면 위키 화면만 읽기 실패 자리가 선다).
-- ============================================================================

begin;

create table if not exists public.wiki_pages (
  id           text primary key check (length(id) between 1 and 120),
  grp          text not null,
  title        text not null,
  kind         text not null check (kind in ('human', 'auto')),
  position     int  not null default 0,
  source       text,
  source_count int  not null default 0,
  blocks       jsonb not null default '[]'::jsonb,
  src_hash     text,
  built_at     timestamptz,
  updated_at   timestamptz not null default now()
);

create trigger trg_wiki_pages_updated_at
  before update on public.wiki_pages
  for each row execute function public.set_updated_at();

alter table public.wiki_pages enable row level security;
create policy wiki_pages_select on public.wiki_pages for select using (public.is_approved());

create table if not exists public.wiki_edits (
  page_id    text not null references public.wiki_pages(id) on delete cascade,
  item_key   text not null check (length(item_key) between 1 and 200),
  block_key  text,
  text       text not null check (length(text) <= 2000),
  before     text check (length(before) <= 2000),
  edited_by  uuid references public.profiles(id) on delete set null,
  edited_at  timestamptz not null default now(),
  primary key (page_id, item_key)
);

create or replace function public.wiki_edits_stamp() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- 세션이 있으면 언제나 그 사람이다(서버 키·psql은 넘긴 값을 그대로 둔다)
  if auth.uid() is not null then
    new.edited_by := public.effective_uid();
  end if;
  new.edited_at := now();
  return new;
end $$;

create trigger trg_wiki_edits_stamp
  before insert or update on public.wiki_edits
  for each row execute function public.wiki_edits_stamp();

alter table public.wiki_edits enable row level security;
create policy wiki_edits_select on public.wiki_edits for select using (public.is_approved());
create policy wiki_edits_insert on public.wiki_edits for insert with check (public.is_approved());
create policy wiki_edits_update on public.wiki_edits for update using (public.is_approved()) with check (public.is_approved());

create table if not exists public.dabooti_questions (
  id         uuid primary key default gen_random_uuid(),
  question   text not null check (length(question) <= 500),
  norm       text not null,
  status     text not null check (status in ('answered', 'unknown', 'refused', 'failed')),
  answer     jsonb,
  dropped    jsonb not null default '[]'::jsonb,
  feedback   text check (feedback in ('good', 'bad')),
  via        text not null default 'ask' check (via in ('ask', 'nightly')),
  created_at timestamptz not null default now()
);

create index if not exists idx_dabooti_questions_norm on public.dabooti_questions(norm, created_at desc);

alter table public.dabooti_questions enable row level security;

comment on table public.wiki_pages is '더다붓 위키 장 — 블록은 서버가 쓴다(api/_wiki.js) · 0088';
comment on table public.wiki_edits is '위키에서 사람이 고친 문장 — 다시 모아도 덮지 않는다 · before는 자가 개선 예시 · 0088';
comment on table public.dabooti_questions is '다붓이에게 물어본 글(익명) — 몰랐던 질문·걸러 낸 문장으로 다붓이를 고친다 · 서버만 · 0088';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select tablename, policyname, cmd from pg_policies where schemaname='public'
--    and tablename in ('wiki_pages','wiki_edits','dabooti_questions') order by 1, 2;
--   -- wiki_edits insert/select/update · wiki_pages select (dabooti_questions는 0줄)
--   select tgname from pg_trigger where tgrelid in ('public.wiki_pages'::regclass, 'public.wiki_edits'::regclass) and not tgisinternal;
--
--   -- RLS 흉내(롤백): 고친 사람은 몸통이 아니라 세션이 정한다
--   begin; set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<내 uid>","role":"authenticated"}', true);
--   insert into public.wiki_edits(page_id, item_key, text, edited_by) values ('intro', 't', 'x', '<남의 uid>');
--   select edited_by from public.wiki_edits where item_key = 't';   -- 내 uid
--   insert into public.dabooti_questions(question, norm, status) values ('q', 'q', 'unknown');   -- 거절
--   rollback;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop table if exists public.dabooti_questions;
--   drop table if exists public.wiki_edits;
--   drop function if exists public.wiki_edits_stamp();
--   drop table if exists public.wiki_pages;
--   (코드도 같이 — api/_wiki.js · api/ai.js의 { ask } 갈래 · api/push.js 8시 크론의 위키 갈래 ·
--    views/wikiView.jsx · layout.jsx의 다붓이 입구 · App.jsx GLOBAL_MENUS의 'wiki')
