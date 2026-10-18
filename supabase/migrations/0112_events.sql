-- ============================================================================
-- 0112 — 행사 일정(events · 사용자 승인 시안 mock/b2 · 2026-10-18)
-- ----------------------------------------------------------------------------
-- '전체 일정'의 '행사' 칸(components/events.jsx)에 서는 큰 일 — 예배 · 행사 · 수련회(이 차례 · 사용자 결정 2026-10-18).
-- 업무가 아니다: 담당자·상태·프로젝트가 없고 하루 종일 일정만 있다(시작일 ~ 종료일 · 장소 · 메모 · 종류 · 관련 업무).
--
-- 표
--   events(id · title · start_date · end_date · kind · place · memo · created_by · created_at · updated_at)
--     kind = service(예배) | event(행사) | retreat(수련회) · 종료일 ≥ 시작일 · 지우기는 행 삭제(휴지통에 넣지 않는다)
--   event_tasks(event_id · card_id · position)  관련 업무 — 행사가 지워져도, 업무가 지워져도(30일 크론 정리 포함) 줄이 따라 지워진다.
--     업무 제목은 카드 RLS가 거른다: 못 보는 업무(리더만·직접 선택·휴지통)는 화면이 '업무 링크' 중립 칩으로 그린다
--     (RichText.TaskRef · visibility.canSeeProject — 업무 id만 알 뿐 제목은 안 샌다).
--   event_feeds(id · owner unique · event_ids uuid[] ≤ 300)  내 달력 — 사람마다 **한 줄**(달마다 골라도 피드는 하나 · 사용자 승인).
--     0085 `calendar_feeds`와 같은 설계를 그대로 쓴다(그쪽은 project_id가 not null + unique(owner, project_id)라 칸을 빌려 쓰지
--     않고 표를 나란히 둔다): 고른 것은 배열 한 칸 · **쓰기는 서버만**(api/ics.js POST {eventFeed}) · 읽기는 본인 ·
--     주소는 줄 id + 서명(`/cal/<id>/<서명>.ics` — 같은 재작성 · 서명 열쇠 접두가 `calev:`라 프로젝트 피드와 섞이지 않는다).
--     지워진 행사 id는 배열에 남아도 GET이 events를 다시 읽어서 저절로 빠진다.
--
-- 정책(to authenticated · 판정 호출은 `(select …)` — 0101 · 0102의 결)
--   events · event_tasks  읽기 = 승인된 사람 모두(`is_approved()`) · 쓰기 = 리더진 + 마스터(`is_leader()` · `is_master()` —
--                         앱 판정 services/events.js canEditEvents와 같은 사람들 · 리더만 보는 프로젝트(0092)의 리더와 같은 함수)
--   event_feeds           읽기 = 본인(`effective_uid()` — 합친 계정은 남긴 계정 · 0061) · 쓰기 정책 없음(서버 키만)
--
-- 함수
--   save_event(id, title, start, end, kind, place, memo, cards uuid[]) → events 행
--     행사 한 건과 관련 업무를 **한 트랜잭션**으로 저장한다(id가 있으면 그 행을 고치고 없으면 그 id로 넣는다 — 앱이 uuid를 먼저
--     만들어 화면에 먼저 그린다). 관련 업무는 통째로 갈아 끼운다(§6-27 — 조인을 두 왕복으로 쓰면 겹친 저장이 깨진다).
--     security definer라 **리더진 + 마스터인지 함수가 직접 본다**(42501). definer인 이유: 고치는 사람이 못 보는 업무가 이미
--     걸려 있어도(지난해 리더 프로젝트·직접 선택) 그 줄을 지우지 않고 남기려면 업무가 있는지만 RLS 밖에서 봐야 한다.
--   행사 지우기는 표 delete 하나(정책이 리더진 + 마스터만 연다 · event_tasks는 cascade).
--
-- 실시간: events · event_tasks를 supabase_realtime에 넣는다(남이 넣은 행사가 바로 보이게) — 앱은 services/liveV2.js의 'events'
-- 신호를 받아 목록을 통째로 다시 읽는다(행 단위 병합 없음). event_feeds는 넣지 않는다(창을 열 때 한 번 묻는다 — 0085와 같다).
--
-- **순서: 이 마이그레이션 → 코드**(§3-4). 앱 첫 읽기(loadCloudState)는 이 표를 보지 않아 오류 화면은 없지만, 행사 칸이 빈 달력 +
-- '일정을 불러오지 못했어요' 토스트로 서고, **v2 실시간 채널(liveV2 `church-v2`)이 없는 표를 구독하다 통째로 오류로 끝날 수 있다**
-- (예배·모임·명단·홈 실시간까지 — PITFALLS 65-a). 반드시 이 파일 먼저.
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 표 ──────────────────────────────────────────────────────────────────────
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  start_date  date not null,
  end_date    date not null,
  kind        text not null default 'event' check (kind in ('service', 'event', 'retreat')),
  place       text not null default '' check (char_length(place) <= 200),
  memo        text not null default '' check (char_length(memo) <= 2000),
  created_by  uuid references public.profiles(id) on delete set null default public.effective_uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint events_span_check check (end_date >= start_date)
);
create index if not exists events_start_idx on public.events (start_date);
comment on table public.events is '행사 일정(예배 · 행사 · 수련회) — 읽기 승인 전원 · 쓰기 리더진 + 마스터(0112)';

create table if not exists public.event_tasks (
  event_id  uuid not null references public.events(id) on delete cascade,
  card_id   uuid not null references public.cards(id) on delete cascade,
  position  int  not null default 0,
  primary key (event_id, card_id)
);
create index if not exists event_tasks_card_idx on public.event_tasks (card_id);
comment on table public.event_tasks is '행사의 관련 업무 — 행사·업무 어느 쪽이 지워져도 따라 지워진다 · 쓰기는 save_event(0112)';

create table if not exists public.event_feeds (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null unique references public.profiles(id) on delete cascade,
  event_ids   uuid[] not null default '{}' check (cardinality(event_ids) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.event_feeds is '행사 내 달력 구독 — 사람마다 한 줄 · 고른 행사 id 배열. 쓰기는 서버(api/ics.js)만 · 주소는 id + 서명(0112)';

drop trigger if exists trg_events_updated_at on public.events;
create trigger trg_events_updated_at before update on public.events
  for each row execute function public.set_updated_at();
drop trigger if exists trg_event_feeds_updated_at on public.event_feeds;
create trigger trg_event_feeds_updated_at before update on public.event_feeds
  for each row execute function public.set_updated_at();

-- ── 정책 ────────────────────────────────────────────────────────────────────
alter table public.events enable row level security;
alter table public.event_tasks enable row level security;
alter table public.event_feeds enable row level security;
revoke all on public.events, public.event_tasks, public.event_feeds from anon;
-- 내 달력 줄은 서버만 쓴다(0085와 같다) — 표 권한부터 닫는다
revoke insert, update, delete on public.event_feeds from authenticated;

create policy events_select on public.events for select to authenticated
  using ((select public.is_approved()));
create policy events_insert on public.events for insert to authenticated
  with check ((select public.is_leader()) or (select public.is_master()));
create policy events_update on public.events for update to authenticated
  using ((select public.is_leader()) or (select public.is_master()))
  with check ((select public.is_leader()) or (select public.is_master()));
create policy events_delete on public.events for delete to authenticated
  using ((select public.is_leader()) or (select public.is_master()));

create policy event_tasks_select on public.event_tasks for select to authenticated
  using ((select public.is_approved()));
create policy event_tasks_insert on public.event_tasks for insert to authenticated
  with check ((select public.is_leader()) or (select public.is_master()));
create policy event_tasks_update on public.event_tasks for update to authenticated
  using ((select public.is_leader()) or (select public.is_master()))
  with check ((select public.is_leader()) or (select public.is_master()));
create policy event_tasks_delete on public.event_tasks for delete to authenticated
  using ((select public.is_leader()) or (select public.is_master()));

create policy event_feeds_select on public.event_feeds for select to authenticated
  using (owner = (select public.effective_uid()));

-- ── 함수 ────────────────────────────────────────────────────────────────────
create or replace function public.save_event(
  p_id uuid, p_title text, p_start date, p_end date, p_kind text, p_place text, p_memo text, p_cards uuid[]
) returns public.events
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.events;
begin
  if not (public.is_leader() or public.is_master()) then
    raise exception '행사 일정은 리더진만 바꿀 수 있어요' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_cards, '{}')) > 50 then
    raise exception '관련 업무가 너무 많아요' using errcode = '22023';
  end if;
  insert into public.events as e (id, title, start_date, end_date, kind, place, memo)
  values (coalesce(p_id, gen_random_uuid()), btrim(p_title), p_start, coalesce(p_end, p_start), coalesce(p_kind, 'event'),
          btrim(coalesce(p_place, '')), btrim(coalesce(p_memo, '')))
  on conflict (id) do update set
    title = excluded.title, start_date = excluded.start_date, end_date = excluded.end_date,
    kind = excluded.kind, place = excluded.place, memo = excluded.memo
  returning * into r;

  delete from public.event_tasks where event_id = r.id;
  -- 있는 업무만(그 사이 영구 정리된 업무 id는 건너뛴다 · 고른 차례가 position)
  insert into public.event_tasks (event_id, card_id, position)
  select r.id, x.id, min(x.n)::int - 1
    from unnest(coalesce(p_cards, '{}')) with ordinality as x(id, n)
   where exists (select 1 from public.cards c where c.id = x.id)
   group by x.id;
  return r;
end $$;
comment on function public.save_event(uuid, text, date, date, text, text, text, uuid[]) is
  '행사 한 건 + 관련 업무를 한 트랜잭션으로(넣기·고치기) — 리더진 + 마스터만(42501 · 0112)';
revoke all on function public.save_event(uuid, text, date, date, text, text, text, uuid[]) from public, anon;
grant execute on function public.save_event(uuid, text, date, date, text, text, text, uuid[]) to authenticated, service_role;

-- ── 실시간 ──────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['events', 'event_tasks'] loop
    if not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select tablename, policyname, cmd, roles from pg_policies where tablename in ('events', 'event_tasks', 'event_feeds') order by 1, 2;
--   -- events 넷 · event_tasks 넷 · event_feeds 하나(select) — 전부 {authenticated}
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'event%';   -- events · event_tasks
--
--   -- RLS 흉내(롤백): 순원은 읽기만 · 리더는 save_event · 내 달력 줄은 아무도 못 쓴다
--   begin; set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<순원 uid>","role":"authenticated"}', true);
--   select count(*) from public.events;                                      -- 읽힌다
--   insert into public.events (title, start_date, end_date) values ('x', '2026-12-01', '2026-12-01');   -- 거절(42501)
--   select public.save_event(null, 'x', '2026-12-01', null, 'event', '', '', '{}');                      -- 거절(42501)
--   rollback;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- alter publication supabase_realtime drop table public.events, public.event_tasks;
-- drop function if exists public.save_event(uuid, text, date, date, text, text, text, uuid[]);
-- drop table if exists public.event_feeds;
-- drop table if exists public.event_tasks;
-- drop table if exists public.events;
-- commit;
-- (코드도 같이 — api/ics.js의 POST {eventFeed}·GET 행사 갈래, services/cloud/events.js, services/eventStore.js의 클라우드 갈래,
--  services/liveV2.js의 events 두 줄)
