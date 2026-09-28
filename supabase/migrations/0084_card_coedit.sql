-- ============================================================================
-- 0084 — 업무 본문 같이 쓰기의 저장 자리 (Yjs 기록 + 스냅샷 + 판 · 비공개 채널 권한)
-- ----------------------------------------------------------------------------
-- 엔진은 services/coedit/(core.js 순수 · store.js 이 표들 · index.js 채널). **화면에는 아직 안 붙었다.**
-- `cards.description`(마크다운)은 그대로 원본 글이다 — 뷰어·AI·검색·알림이 그 글을 읽는다.
-- 같이 쓰는 동안의 원본은 Yjs 문서이고, 고친 사람이 2초 조용하면 그 글을 description으로 비춘다.
--
-- 표 셋
--   · card_doc_updates — **추가만 하는 기록.** 클라이언트가 1초씩 모은 자기 편집을 한 줄로 넣는다.
--     고치기·지우기 정책이 없다 — 지우는 것은 접기 함수(card_doc_compact) 하나뿐이다.
--   · card_docs — 스냅샷(카드당 한 줄). `upto` = 이 상태에 들어 있는 마지막 기록 id.
--     불러오기는 스냅샷 + `id > upto`인 기록이다. 쓰기 정책이 없다 — 함수 둘로만 쓴다:
--       card_doc_seed    처음 열 때 마크다운에서 심은 상태를 **먼저 넣은 쪽만** 스냅샷으로
--                        (on conflict do nothing · 진 쪽은 자기 것을 버리고 이긴 쪽을 읽는다 —
--                        둘 다 심으면 같은 글이 두 벌로 합쳐져 본문이 두 번 찍힌다)
--       card_doc_compact 스냅샷을 덮고 그 아래 기록을 **한 트랜잭션에서** 지운다
--   · card_doc_versions — 편집 세션(60초 조용하거나 닫을 때)마다 그 글이 달라졌으면 마크다운 한 판
--     + 세션 시작 글과의 줄 차이(added·removed — 목록의 'N줄 추가 · M줄 제거').
--
-- **클라이언트 쓰기는 전부 다시 보내도 안전하다**(사용자 요구 2026-09-28 — 동시성·멱등).
--   · 기록·판은 클라이언트가 만든 `client_id uuid unique`를 달고 on conflict do nothing으로 간다.
--     시간 초과 뒤 클라이언트는 **같은 덩어리를 같은 열쇠로** 다시 보낸다(core.createBatcher) —
--     Yjs는 겹쳐도 괜찮지만 기록이 불어나면 안 된다.
--   · 심기는 먼저 넣은 쪽만 · 접기는 upto가 앞으로 갈 때만(둘이 동시에 접으면 뒤 것은 false).
--
-- **업데이트는 bytea가 아니라 base64 text다.** supabase-js(PostgREST JSON)로 bytea를 넣고 읽으면
-- `\x…` 16진 글자로 오가서 크기가 두 배이고, 넣을 때와 읽을 때의 모양을 따로 맞춰야 한다
-- (RPC 인자도 마찬가지). 채널(Broadcast)도 JSON이라 어차피 base64로 싣는다 — 한 벌로 둔다(1.33배).
--
-- **접기의 `upto`는 30초 뒤로 물린다.** bigserial id는 넣을 때 매겨지지만 커밋 차례는 다를 수 있다
-- (101번이 102번보다 늦게 커밋). 읽는 쪽이 102까지 보고 102로 접으면, 그 순간 아직 안 보이던
-- 101이 스냅샷에 없는 채로 지워진다. 그래서 함수가 `upto`를 **30초 넘게 지난 기록까지**로 줄인다
-- (더 작은 upto는 안전하다 — 스냅샷에 이미 든 기록을 다시 적용해도 Yjs에서는 아무 일도 없다).
-- 같은 까닭으로 클라이언트가 가진 것보다 큰 upto(아직 없는 id)는 거절한다 — 그 아래로 나중에
-- 들어올 기록을 불러오기가 건너뛴다.
--
-- 비공개 채널 `coedit:<cardId>`(Realtime Authorization): realtime.messages에 **그 접두만** 보는 정책
-- 둘(읽기·보내기)을 둔다. 지금 이 표에 다른 정책이 없고 기존 채널(workspace-all 등)은 공개
-- 채널이라 이 정책을 타지 않는다 — 아무것도 바뀌지 않는다. permissive OR이므로(§6-31-a) 나중에
-- 정책을 더할 때도 접두로 갈라 둔다.
--
-- 권한은 cards와 같다: 승인된 사람 전원 읽기·쓰기(0022 `is_approved()`). 기록·판의 '누가'는
-- 본인만(0071 cards_insert와 같은 식 — auth.uid() 또는 합친 계정의 effective_uid()).
-- **실시간 발행(supabase_realtime)에는 넣지 않는다** — 사람 사이는 Broadcast가 나른다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

create table if not exists public.card_doc_updates (
  id        bigserial primary key,
  client_id uuid not null unique,                                          -- 클라이언트가 만든 열쇠(다시 보내도 한 줄)
  card_id   uuid not null references public.cards(id) on delete cascade,
  data      text not null check (char_length(data) between 4 and 4000000),   -- base64 Yjs 업데이트
  by        uuid default public.effective_uid() references public.profiles(id) on delete set null,
  at        timestamptz not null default now()
);
create index if not exists idx_card_doc_updates_card on public.card_doc_updates(card_id, id);

create table if not exists public.card_docs (
  card_id    uuid primary key references public.cards(id) on delete cascade,
  state      text not null check (char_length(state) between 4 and 8000000),  -- base64 Yjs 상태
  upto       bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.card_doc_versions (
  id        bigserial primary key,
  client_id uuid not null unique,                                          -- 클라이언트가 만든 열쇠(다시 보내도 한 판)
  card_id   uuid not null references public.cards(id) on delete cascade,
  by        uuid default public.effective_uid() references public.profiles(id) on delete set null,
  at        timestamptz not null default now(),
  md        text not null,
  added     int not null default 0 check (added >= 0),                     -- 목록의 'N줄 추가 · M줄 제거'
  removed   int not null default 0 check (removed >= 0)                    -- (core.lineDiffCounts · 세션 시작 글과 끝 글)
);
create index if not exists idx_card_doc_versions_card on public.card_doc_versions(card_id, at desc);

alter table public.card_doc_updates enable row level security;
alter table public.card_docs enable row level security;
alter table public.card_doc_versions enable row level security;

create policy card_doc_updates_select on public.card_doc_updates
  for select using (public.is_approved());
create policy card_doc_updates_insert on public.card_doc_updates
  for insert with check (public.is_approved() and by = any (array[auth.uid(), public.effective_uid()]));

create policy card_docs_select on public.card_docs
  for select using (public.is_approved());

create policy card_doc_versions_select on public.card_doc_versions
  for select using (public.is_approved());
create policy card_doc_versions_insert on public.card_doc_versions
  for insert with check (public.is_approved() and by = any (array[auth.uid(), public.effective_uid()]));

-- ── 심기: 먼저 넣은 쪽만 ─────────────────────────────────────────────────────
create or replace function public.card_doc_seed(p_card uuid, p_state text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  insert into public.card_docs(card_id, state, upto) values (p_card, p_state, 0)
  on conflict (card_id) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ── 접기: 스냅샷 덮기 + 그 아래 기록 지우기(한 트랜잭션) ───────────────────────
-- **upto는 앞으로만 간다.** 둘이 동시에 접어도 안전하다: 스냅샷 줄을 `for update`로 잡고(줄이 아직
-- 없을 때를 위해 카드 단위 권고 잠금도 같이) 뒤에 온 쪽은 앞쪽이 쓴 upto를 보고 판단한다 —
-- 같거나 뒤처진 upto면 아무것도 안 하고 false. 지우는 것은 **저장한 upto 이하**뿐이다.
-- 앞으로 간 쪽의 상태는 옛 스냅샷 + 자기 upto까지의 기록이라 앞쪽 스냅샷(더 작은 upto)을 다 품는다.
create or replace function public.card_doc_compact(p_card uuid, p_upto bigint, p_state text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  cur  bigint;
  top  bigint;
  safe bigint;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('card_doc_compact:' || p_card::text, 0));
  select upto into cur from public.card_docs where card_id = p_card for update;
  select max(id) into top from public.card_doc_updates where card_id = p_card;
  -- 아직 없는 id까지 접는다고 하면 거절(그 아래로 나중에 들어올 기록을 불러오기가 건너뛴다)
  if p_upto > greatest(coalesce(cur, 0), coalesce(top, 0)) then
    raise exception 'upto % is beyond the log', p_upto using errcode = '22023';
  end if;
  -- 커밋 차례가 id 차례와 다를 수 있어서 30초 넘게 지난 기록까지만(머리말)
  select coalesce(max(id), 0) into safe from public.card_doc_updates
   where card_id = p_card and id <= p_upto and at < now() - interval '30 seconds';
  if cur is not null and safe <= cur then return false; end if;
  insert into public.card_docs(card_id, state, upto, updated_at) values (p_card, p_state, safe, now())
  on conflict (card_id) do update set state = excluded.state, upto = excluded.upto, updated_at = now();
  delete from public.card_doc_updates where card_id = p_card and id <= safe;
  return true;
end $$;

revoke all on function public.card_doc_seed(uuid, text) from public, anon;
revoke all on function public.card_doc_compact(uuid, bigint, text) from public, anon;
grant execute on function public.card_doc_seed(uuid, text) to authenticated;
grant execute on function public.card_doc_compact(uuid, bigint, text) to authenticated;

-- ── 비공개 채널 coedit:<cardId> — 승인된 사람만 듣고 보낸다 ────────────────────
create policy coedit_channel_read on realtime.messages
  for select to authenticated
  using (left(realtime.topic(), 7) = 'coedit:' and realtime.messages.extension in ('broadcast', 'presence') and public.is_approved());
create policy coedit_channel_write on realtime.messages
  for insert to authenticated
  with check (left(realtime.topic(), 7) = 'coedit:' and realtime.messages.extension in ('broadcast', 'presence') and public.is_approved());

comment on table public.card_doc_updates is '업무 본문 같이 쓰기 — Yjs 업데이트 기록(base64 · 추가만 · 접기 함수가 지운다) (0084)';
comment on table public.card_docs is '업무 본문 같이 쓰기 — 스냅샷(base64 Yjs 상태 · upto까지의 기록을 담는다) (0084)';
comment on table public.card_doc_versions is '업무 본문 같이 쓰기 — 편집 세션마다 마크다운 한 판 (0084)';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select tablename, policyname, cmd from pg_policies
--    where (schemaname = 'public' and tablename like 'card_doc%') or (schemaname = 'realtime' and tablename = 'messages')
--    order by 1, 2;
--   -- card_doc_updates select·insert · card_docs select · card_doc_versions select·insert · messages coedit 둘
--   select proname, prosecdef from pg_proc where proname in ('card_doc_seed', 'card_doc_compact');   -- 둘 다 t
--   select count(*) from pg_publication_tables where tablename like 'card_doc%';   -- 0
--   -- 옛 글 채우기(미리 보기): node scripts/seed-card-docs.mjs --dry-run
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   begin;
--   drop policy if exists coedit_channel_read on realtime.messages;
--   drop policy if exists coedit_channel_write on realtime.messages;
--   drop function if exists public.card_doc_compact(uuid, bigint, text);
--   drop function if exists public.card_doc_seed(uuid, text);
--   drop table if exists public.card_doc_versions;
--   drop table if exists public.card_docs;
--   drop table if exists public.card_doc_updates;
--   commit;
--   -- cards.description은 이 파일이 건드리지 않았다 — 되돌려도 글은 그대로다
