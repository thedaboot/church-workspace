-- ============================================================================
-- 0085 — 내 달력 구독 (calendar_feeds · 사용자 결정 2026-09-28 · 목업 v3)
-- ----------------------------------------------------------------------------
-- 프로젝트 달력의 `내 달력`에서 고른 업무를 폰·구글 달력에 **구독 주소**로 넣는다(api/ics.js ·
-- services/calendarFeed.js). 한 사람 · 한 프로젝트에 **한 줄**이고, 고른 업무는 id 배열 한 칸이다.
--   · 왜 조인 표가 아니라 배열인가(HANDOFF §3-1): 고른 것은 늘 통째로 읽고 통째로 쓴다(따로 집계할
--     일이 없다). 조인이면 저장이 두 왕복이라 체크를 빠르게 여러 번 누르면 겹쳐서 깨진다(§6-27).
--     배열 한 칸은 **upsert 한 번**(on conflict (owner, project_id))이라 같은 요청이 두 번 와도,
--     순서가 뒤섞인 요청이 와도 마지막 것 하나로 모인다(클라이언트가 저장을 줄 세운다).
--   · 주소는 이 줄의 id + 서버 비밀에서 가른 서명이다 — 고른 것을 바꿔도 **id가 그대로라 주소도 그대로**다.
--     만료가 없다(달력 앱이 몇 시간마다 다시 읽는다). 끊는 길은 계정 승인이 풀리는 것이다(GET이 매번 본다).
--   · 업무가 지워지면 배열에 id가 남지만 GET이 `id = any(card_ids) and project_id = 이 줄의 프로젝트`로
--     읽어서 저절로 빠진다(다른 프로젝트로 옮긴 업무도 같다). 프로젝트가 지워지면 줄도 같이 지운다.
--
-- 정책
--   · 읽기: 본인만(`owner = effective_uid()` — 합친 계정은 남긴 계정 · 0061)
--   · **쓰기는 서버만**(서비스 키 · api/ics.js POST). insert/update/delete 정책을 두지 않는다 —
--     서버가 ① 승인 ② 업무가 그 프로젝트의 것인지 ③ 개수 상한(300)을 본 뒤에 쓴다. 본인 쓰기를 열면
--     그 셋을 건너뛴 줄(남의 프로젝트 업무 id·수천 개)이 들어올 길이 생기고, 쓰는 자리가 둘이 된다.
--     owner도 서버가 세션에서 정한다(요청 몸통의 값을 믿지 않는다).
-- **실시간 발행(0049·0056)에는 넣지 않는다** — 창을 열 때 한 번 묻는다.
--
-- **코드보다 먼저 나가야 한다**(HANDOFF §3-4). 없으면 `내 달력`을 누를 때 실패 토스트가 뜬다
-- (앱 첫 읽기 `loadCloudState`는 이 표를 보지 않는다 — 다른 화면에는 영향이 없다).
-- ============================================================================

begin;

create table if not exists public.calendar_feeds (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references public.profiles(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  card_ids    uuid[] not null default '{}' check (cardinality(card_ids) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner, project_id)
);

create index if not exists idx_calendar_feeds_project on public.calendar_feeds(project_id);

create trigger trg_calendar_feeds_updated_at
  before update on public.calendar_feeds
  for each row execute function public.set_updated_at();

alter table public.calendar_feeds enable row level security;

create policy calendar_feeds_select on public.calendar_feeds
  for select using (owner = public.effective_uid());

comment on table public.calendar_feeds is
  '내 달력 구독 — 한 사람·한 프로젝트에 한 줄 · 고른 업무 id 배열. 쓰기는 서버(api/ics.js)만 · 주소는 id + 서명(0085)';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select column_name, data_type, column_default from information_schema.columns
--    where table_schema='public' and table_name='calendar_feeds' order by ordinal_position;
--   select policyname, cmd from pg_policies where schemaname='public' and tablename='calendar_feeds';
--   -- calendar_feeds_select SELECT (하나뿐)
--   select conname from pg_constraint where conrelid='public.calendar_feeds'::regclass;
--   -- pkey · owner_project_id_key(unique) · owner_fkey · project_id_fkey · card_ids_check
--   select 1 from pg_publication_tables where tablename='calendar_feeds';   -- 0줄(실시간 밖)
--
--   -- RLS 흉내(롤백): 로그인한 사람은 쓰지 못한다
--   begin; set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<내 uid>","role":"authenticated"}', true);
--   insert into public.calendar_feeds(owner, project_id) values ('<내 uid>', '<프로젝트 id>');   -- 거절(정책 없음)
--   rollback;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop table if exists public.calendar_feeds;   -- 정책·인덱스·트리거도 같이 사라진다
--   (코드도 같이 — api/ics.js의 POST {project}·GET ?f= 갈래, vercel.json의 /cal/ 재작성,
--    components/calendarFeed.jsx와 calendar.jsx 머리의 `내 달력` 버튼)
