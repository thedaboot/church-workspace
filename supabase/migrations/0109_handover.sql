-- ============================================================================
-- 0109 — 인수인계 (v5 1묶음 C · 시안 승인 2026-10-17 · 화면은 멤버 관리 '인수인계' 탭 + 홈 카드)
-- ----------------------------------------------------------------------------
-- 흐름(사용자가 정한 차례): 다음 해 직분은 '청년 명단'의 그 해에 넣는다 → ① 직분 짝(자리로 자동 · 마스터가 덮어쓴다)
-- → ② 졸업(한국 나이 31세 자동 목록 · 마스터가 확정 · 인수자) → ③ 인계 내용(넘기는 사람이 전달 사항 · 인계할 업무)
-- → ④ 1월 1일 적용(아침 크론이 업무 담당자를 바꾸고 기록) → 인수자의 홈에 카드(누구에게서 · 전달 사항 · 업무 · 확인).
-- 짝·졸업·인계 묶기의 규칙은 앱의 순수 모듈 하나다(services/handover.js — pairRoles·graduatesOf·buildHandovers).
-- 마스터 화면이 그 결과(인계 목록)를 sync_handovers로 이 표에 내려 둔다 — 그래야 넘기는 사람이 자기 줄을 읽는다.
--
-- 표
--   handover_plans(year)   마스터의 고침 — 직분 짝 덮어쓰기(overrides) · 졸업 확정(grads · null이면 자동 목록) ·
--                          졸업자의 인수자(grad_to). 마스터만 읽고 쓴다.
--   handovers              인계 기록 한 건 = (해, 넘기는 사람, 인수자). 직분(slots · 'treasurer' · 'team_lead:찬양팀') ·
--                          졸업 · 전달 사항(note) · 업무(task_ids) · 쓴 때(written_at) · 적용한 때(applied_at · moves) · 본 때(seen_at).
--                          active=false는 짝이 바뀌어 지금 목록에서 빠졌지만 이미 쓴 줄(지우지 않는다 · 적용도 안 한다).
-- RLS(사용자 결정): 넘기는 사람은 자기 것 읽기·쓰기(쓰기는 write_handover 하나 — 전달 사항·업무만) · 인수자는 자기 것 읽기
--   (적용된 뒤부터 · 본 때는 see_handover) · 마스터는 전부. 새 정책은 `to authenticated` · 판정 호출은 `(select …)`(0101·0102).
-- 함수
--   sync_handovers(y, items)   마스터 — 인계 목록을 내려 둔다(있으면 고치고 · 빠진 줄은 안 쓴 것만 지우고 쓴 것은 active=false).
--                              그해 줄이 하나라도 적용됐으면 아무것도 안 한다.
--   write_handover(id, note, tasks)  넘기는 사람·마스터 — 적용 전에만
--   see_handover(id)           인수자 — 홈 카드 '확인'
--   apply_handovers()          **서버 키만**(아침 크론 · api/push.js) — 올해까지의 적용 안 된 줄을 적용한다: 업무 담당자를
--                              넘기는 사람 → 인수자로 바꾸고(card_assignees · 계정이 이어진 사람만) 무엇을 바꿨는지 moves에 남긴다.
--                              1월 1일 아침 08:00(KST) 크론이 처음 돈다 · 그날 실패해도 다음 날 아침에 다시 돈다(멱등).
--                              **먼저** 올해 팀장 줄의 사람을 그 팀 소속(people.teams)에서 뺀다(사용자 결정 2026-10-17 — 다음 해 팀장은
--                              지금 팀원이어도 지정되고, 그해부터 0107의 겸직 규칙이 맞게) · 뺀 것은 handover_seat_log에 남긴다.
--                              people.teams를 고치면 0068 트리거가 계정 소속(profile_teams)도 따라 뺀다. 매일 아침 돌지만 한 번 뺀 사람은
--                              다시 안 걸린다(멱등). **2026 줄은 건드리지 않는다** — 0107이 role_note에서 옮긴 지금의 팀장이라, 배포 다음
--                              아침에 소속이 갑자기 빠지면 안 된다(그 겹침은 0107 트리거도 남겨 둔다).
--   Vercel Hobby는 크론 두 자리뿐이라(vercel.json · api/push.js 머리말) 새 자리를 만들지 않고 08:00 갈래에 한 단계로 얹었다.
-- 졸업은 표시뿐이다 — 워크스페이스 권한은 바뀌지 않는다(사용자 결정 · 계정·승인 칸을 안 건드린다).
--
-- 순서: 0107(people.birth_year · people_roles.team) → 이 마이그레이션 → 코드. 코드가 먼저 나가도 오류 화면은 없다 —
-- 인수인계 탭·홈 카드는 이 표를 '없어도 되는 값'으로 읽고(services/handoverStore.js · 못 읽으면 카드가 안 선다), 크론은 rpc 실패를
-- 응답의 handover 칸에만 적는다.
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 표 ─────────────────────────────────────────────────────────────────────
create table if not exists public.handover_plans (
  year       int primary key check (year between 2000 and 2100),
  overrides  jsonb not null default '{}' check (jsonb_typeof(overrides) = 'object'),
  grads      uuid[] check (grads is null or cardinality(grads) <= 200),
  grad_to    jsonb not null default '{}' check (jsonb_typeof(grad_to) = 'object'),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.handover_plans is '인수인계 — 마스터의 고침(직분 짝 덮어쓰기 · 졸업 확정 · 졸업자의 인수자) · 마스터만(0109)';

create table if not exists public.handovers (
  id          uuid primary key default gen_random_uuid(),
  year        int not null check (year between 2000 and 2100),
  from_person uuid not null references public.people(id) on delete cascade,
  to_person   uuid references public.people(id) on delete set null,
  slots       text[] not null default '{}' check (cardinality(slots) <= 20),
  graduate    boolean not null default false,
  active      boolean not null default true,
  note        text not null default '' check (char_length(note) <= 4000),
  task_ids    uuid[] not null default '{}' check (cardinality(task_ids) <= 200),
  written_at  timestamptz,
  written_by  uuid references public.profiles(id) on delete set null,
  applied_at  timestamptz,
  moves       jsonb,
  seen_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint handovers_pair_key unique nulls not distinct (year, from_person, to_person)
);
create index if not exists handovers_to_idx on public.handovers (to_person) where to_person is not null;

-- 1월 1일에 팀장을 그 팀 소속에서 뺀 기록(apply_handovers만 쓴다 · 마스터만 읽는다)
create table if not exists public.handover_seat_log (
  id         uuid primary key default gen_random_uuid(),
  year       int not null,
  person_id  uuid not null references public.people(id) on delete cascade,
  team       text not null,
  removed_at timestamptz not null default now()
);
comment on table public.handover_seat_log is '그해 팀장이 된 사람을 그 팀 소속에서 뺀 기록 — 1월 1일 적용 단계(0109)';
comment on table public.handovers is
  '인계 기록 — 누가→누구 · 직분 · 전달 사항 · 업무 · 쓴 때 · 적용한 때 · 본 때(0109). 넘기는 사람·인수자(적용 뒤)·마스터만 읽는다';

alter table public.handover_plans enable row level security;
alter table public.handovers enable row level security;
alter table public.handover_seat_log enable row level security;
revoke all on public.handover_seat_log from anon, authenticated;
grant select on public.handover_seat_log to authenticated;
revoke all on public.handover_plans from anon;
revoke all on public.handovers from anon;
grant select, insert, update, delete on public.handover_plans to authenticated;
grant select, insert, update, delete on public.handovers to authenticated;

-- ── 정책 ────────────────────────────────────────────────────────────────────
create policy handover_plans_master on public.handover_plans for all to authenticated
  using ((select public.is_master())) with check ((select public.is_master()));

create policy handover_seat_log_master on public.handover_seat_log for select to authenticated
  using ((select public.is_master()));

create policy handovers_select on public.handovers for select to authenticated
  using ((select public.is_master())
         or from_person = (select public.my_person_id())
         or (to_person = (select public.my_person_id()) and applied_at is not null));
create policy handovers_master_write on public.handovers for insert to authenticated
  with check ((select public.is_master()));
create policy handovers_master_update on public.handovers for update to authenticated
  using ((select public.is_master())) with check ((select public.is_master()));
create policy handovers_master_delete on public.handovers for delete to authenticated
  using ((select public.is_master()));

-- ── 함수 ────────────────────────────────────────────────────────────────────
create or replace function public.sync_handovers(y int, items jsonb)
returns setof public.handovers
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_master() then raise exception 'master only' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(items, '[]')) <> 'array' or jsonb_array_length(coalesce(items, '[]')) > 200 then
    raise exception 'bad items' using errcode = '22023';
  end if;
  if not exists (select 1 from public.handovers h where h.year = y and h.applied_at is not null) then
    insert into public.handovers as h (year, from_person, to_person, slots, graduate, active)
    select distinct on (x."from", x."to") y, x."from", x."to", coalesce(x.slots, '{}'), coalesce(x.graduate, false), true
      from jsonb_to_recordset(coalesce(items, '[]')) as x("from" uuid, "to" uuid, slots text[], graduate boolean)
     where x."from" is not null
    on conflict on constraint handovers_pair_key
    do update set slots = excluded.slots, graduate = excluded.graduate, active = true;
    -- 지금 목록에 없는 줄 — 안 쓴 것은 지우고, 쓴 것은 남겨 둔다(짝을 되돌리면 다시 살아난다)
    with keep as (
      select x."from" as f, x."to" as t from jsonb_to_recordset(coalesce(items, '[]')) as x("from" uuid, "to" uuid)
    ), gone as (
      select h.id, h.written_at from public.handovers h
       where h.year = y and not exists (select 1 from keep k where k.f = h.from_person and k.t is not distinct from h.to_person)
    ), del as (
      delete from public.handovers h using gone g where h.id = g.id and g.written_at is null returning h.id
    )
    update public.handovers h set active = false from gone g where h.id = g.id and g.written_at is not null;
  end if;
  return query select * from public.handovers h where h.year = y order by h.created_at;
end $$;

create or replace function public.write_handover(p_id uuid, p_note text, p_tasks uuid[])
returns public.handovers
language plpgsql security definer set search_path = public, pg_temp as $$
declare saved public.handovers;
begin
  update public.handovers h
     set note = left(coalesce(p_note, ''), 4000), task_ids = coalesce(p_tasks, '{}'),
         written_at = now(), written_by = public.effective_uid()
   where h.id = p_id and h.applied_at is null and h.active
     and (public.is_master() or h.from_person = public.my_person_id())
  returning * into saved;
  if not found then raise exception 'not yours or already applied' using errcode = '42501'; end if;
  return saved;
end $$;

create or replace function public.see_handover(p_id uuid)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare seen timestamptz;
begin
  update public.handovers h set seen_at = coalesce(h.seen_at, now())
   where h.id = p_id and h.applied_at is not null and h.to_person = public.my_person_id()
  returning h.seen_at into seen;
  if not found then raise exception 'not yours' using errcode = '42501'; end if;
  return seen;
end $$;

-- 서버 키만(아침 크론). 계정은 합친 계정이면 남긴 계정으로 본다(0059). 이미 그 업무의 담당자면 넣지 않는다.
create or replace function public.apply_handovers()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  fp uuid; tp uuid; cid uuid;
  mv jsonb;
  n int := 0; moved int := 0; seats int := 0;
begin
  -- ① 올해 팀장을 그 팀 소속에서 뺀다(겸직 규칙이 그해부터 맞게) · 기록
  with hit as (
    select r2.person_id, r2.team from public.people_roles r2 join public.people p on p.id = r2.person_id
     where r2.role = 'team_lead' and r2.year = public.kst_year() and r2.year > 2026   -- 2026 줄은 0107이 role_note에서 옮긴 기록 — 소속은 사람이 정한다
       and r2.team = any (coalesce(p.teams, '{}'))
  ), upd as (
    update public.people p set teams = array_remove(p.teams, hit.team) from hit where p.id = hit.person_id returning p.id
  ), logged as (
    insert into public.handover_seat_log (year, person_id, team) select public.kst_year(), hit.person_id, hit.team from hit returning 1
  )
  select count(*) into seats from logged;

  -- ② 인계 줄 적용
  for r in select h.* from public.handovers h
            where h.applied_at is null and h.active and h.year <= public.kst_year()
            order by h.year, h.created_at
            for update loop
    mv := '[]'::jsonb;
    select coalesce(p.merged_into, p.id) into fp from public.people pe join public.profiles p on p.id = pe.profile_id where pe.id = r.from_person;
    select coalesce(p.merged_into, p.id) into tp from public.people pe join public.profiles p on p.id = pe.profile_id where pe.id = r.to_person;
    if fp is not null and tp is not null and fp <> tp then
      foreach cid in array r.task_ids loop
        if exists (select 1 from public.card_assignees a where a.card_id = cid and a.profile_id = fp) then
          delete from public.card_assignees a where a.card_id = cid and a.profile_id = fp;
          insert into public.card_assignees (card_id, profile_id) values (cid, tp) on conflict do nothing;
          mv := mv || jsonb_build_object('card', cid, 'from', fp, 'to', tp);
          moved := moved + 1;
        end if;
      end loop;
    end if;
    update public.handovers set applied_at = now(), moves = mv where id = r.id;
    n := n + 1;
    fp := null; tp := null;
  end loop;
  return jsonb_build_object('applied', n, 'moved', moved, 'seats', seats);
end $$;

revoke all on function public.sync_handovers(int, jsonb) from public, anon;
revoke all on function public.write_handover(uuid, text, uuid[]) from public, anon;
revoke all on function public.see_handover(uuid) from public, anon;
revoke all on function public.apply_handovers() from public, anon, authenticated;
grant execute on function public.sync_handovers(int, jsonb) to authenticated;
grant execute on function public.write_handover(uuid, text, uuid[]) to authenticated;
grant execute on function public.see_handover(uuid) to authenticated;
grant execute on function public.apply_handovers() to service_role;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select tablename, policyname, roles, cmd from pg_policies where tablename in ('handovers', 'handover_plans') order by 1, 2;
--   select proname, proacl from pg_proc where proname in ('sync_handovers', 'write_handover', 'see_handover', 'apply_handovers');
--   리허설(BEGIN … ROLLBACK · 넘기는 사람 쓰기 · 인수자 읽기 · 남의 줄 거절)은 레포 밖 — 보고서의 경로.
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- (적용한 업무 담당자를 되돌리려면 먼저: handovers.moves의 card·from·to로 card_assignees를 거꾸로 고친다)
-- begin;
-- drop function if exists public.apply_handovers();
-- drop function if exists public.see_handover(uuid);
-- drop function if exists public.write_handover(uuid, text, uuid[]);
-- drop function if exists public.sync_handovers(int, jsonb);
-- drop table if exists public.handovers;
-- drop table if exists public.handover_plans;
-- drop table if exists public.handover_seat_log;   -- (뺀 소속을 되돌리려면 먼저 이 표로 people.teams에 다시 넣는다)
-- commit;
