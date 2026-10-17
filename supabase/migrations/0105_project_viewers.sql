-- ============================================================================
-- 0105 — 보는 사람 직접 선택 (v5 1묶음 B · 시안 승인 2026-10-17 · 0092 '리더만 보기'가 간 길 그대로)
-- ----------------------------------------------------------------------------
-- `projects.visibility`에 'custom'을 더한다. 'custom'이면 그 프로젝트와 안의 업무·댓글·반응·첨부·참고 링크·활동·
-- 담당 팀·담당자·같이 쓰기 기록·문서 임베딩이 **고른 사람과 마스터에게만** 읽힌다.
--   고른 사람 = project_viewers의 계정(합친 계정은 남긴 계정으로 본다 — 행이 옛 계정이어도 열린다)
--   마스터     = 업무 잠금(0099)처럼 늘 본다(사람이 떠나도 그 프로젝트를 되살릴 사람이 있어야 한다)
-- 정한 사람은 따로 보지 않는다 — 'custom'으로 바꾸는 순간 트리거가 그 사람을 고른 사람에 넣는다(아래 trg_projects_custom_self).
-- 팀 칩(viewer_teams)은 화면이 고른 차례를 기억하는 칸일 뿐이다 — 누가 보는지는 project_viewers 하나가 정한다.
--
-- **0092의 길을 그대로 쓴다** — 아래 셋을 고치면 hidden_ids()를 부르는 정책 전부(cards·comments·files·activity·
-- card_teams·card_assignees·resource_links·comment_reactions·같이 쓰기 표 셋·doc_vec·coedit 채널 둘·storage attachments)가
-- 저절로 'custom'도 거른다. 그래서 그 정책들은 한 글자도 안 고친다.
--   hidden_ids()        **0104 몸통(휴지통 갈래) 위에** 리더 프로젝트(리더가 아니면) ∪ 직접 고른 프로젝트(고른 사람·마스터가
--                       아니면) · 그 업무·댓글·첨부.
--                       여전히 질의마다 한 번(InitPlan · PITFALLS 31-l ①) — 나 · 리더인가 · 마스터인가를 맨 앞 me에서 한 번만 센다
--   can_see_project()   같은 판정(트리거·같이 쓰기 함수·lock_card가 부른다)
--   can_see_card()      업무의 **지금** 프로젝트로 can_see_project
--   trash_project · restore_card · restore_project · trash_list (0104 함수) — '보이는가'를 can_see_project로(0104는 'leaders'만 봤다)
--
-- **순서: 0104 → 이 파일**(합칠 때 맞춤 2026-10-17). 0104가 hidden_ids를 휴지통 갈래로 다시 쓰고 projects 정책 셋에
-- `deleted_at is null`을 넣었다 — 이 파일은 0104 몸통을 안고 가며, projects 정책은 alter하지 않는다(아래 restrictive 하나).
--
-- projects 표의 정책 셋(select·update·delete)은 칸을 바로 보는 식이라(`visibility <> 'leaders' or is_leader()`) hidden_ids를
-- 안 탄다. 그 식을 alter하지 않고 **restrictive 하나**를 더한다(PITFALLS 31-m의 예외 — 같은 회차에 다른 묶음(휴지통 A)이
-- projects 정책을 만질 수 있어서, 본문을 통째로 다시 쓰면 그쪽 변경을 덮는다). 'custom'이 아닌 행에는 언제나 참이다.
--
-- 표
--   project_viewers(project_id, profile_id, added_by, added_at)  고른 사람. 읽기는 그 프로젝트를 보는 사람 · 쓰기 정책 없음
--                                                               (set_project_viewers와 트리거만 쓴다)
--   projects.viewer_teams text[]                                  펼친 팀 칩(화면용 · 고른 차례)
--
-- 함수(전부 security definer · search_path 고정 · anon 회수)
--   is_project_viewer(uuid)     나는 그 프로젝트의 고른 사람인가 · 마스터면 참
--   project_audiences(uuid[])   좁혀진 프로젝트(leaders · custom)마다 **볼 수 있는 계정 id 배열**(남긴 계정 · 환송 제외) —
--                               앱의 알림 받는 사람·멘션 후보, 서버 키 경로(api/push.js · api/ics.js)가 같은 판정을 쓴다.
--                               leaders는 leader_profile_ids()와 같다. 로그인한 사람에게는 자기가 볼 수 있는 프로젝트 몫만 준다
--   set_project_viewers(uuid, uuid[], text[])  보는 사람을 'custom'으로 + 고른 사람 · 팀 칩을 한 번에(리더만 · 그 프로젝트를
--                               보는 사람만). 부른 사람은 언제나 남는다(화면의 '나는 못 뺀다'와 같다)
--
-- 보호 트리거
--   trg_projects_guard_visibility (0092 함수를 고친다) 리더가 아니면 visibility와 viewer_teams를 못 바꾼다(되돌린다)
--   trg_projects_visibility_stamp (0099 함수를 고친다) INSERT에서도 'custom'이면 누가·언제를 적는다
--   trg_projects_custom_self      (새) 'custom'이 되는 순간 바꾼 사람(남긴 계정)을 고른 사람에 넣는다 — 리더가 화면을 거치지
--                                 않고 visibility만 바꿔도 스스로 잠겨 나가지 않는다
--
-- 실시간: 0092와 같다 — 'custom'이 되거나 고른 사람이 바뀌면 바꾼 화면이 공개 채널에 id만 알리고(announceProjectVisibility)
-- 받은 쪽이 다시 읽는다(RLS가 걷는다). project_viewers는 발행 목록에 넣지 않는다.
--
-- **코드보다 먼저 나간다**(§3-4). 다만 코드가 먼저 나가도 오류 화면은 없다 — 앱은 project_viewers·project_audiences를
-- '없어도 되는 값'으로 읽고(cloudSync.loadCloudState), 못 읽으면 예전 '리더만 보기' 토글을 그대로 세운다(직접 선택 칸이 없다).
-- 지금 'custom'인 프로젝트가 하나도 없으니 이 파일이 바꾸는 결과도 없다(리허설로 확인 — 아래 '확인').
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 칸 · 표 ─────────────────────────────────────────────────────────────────
alter table public.projects drop constraint if exists projects_visibility_check;
alter table public.projects add constraint projects_visibility_check check (visibility in ('all', 'leaders', 'custom'));
comment on column public.projects.visibility is
  '보는 사람 — all(승인 전원) | leaders(마스터·관리자·교역자·그 해 임원진 · 0092) | custom(project_viewers + 마스터 · 0105)';

alter table public.projects add column if not exists viewer_teams text[] not null default '{}';
alter table public.projects drop constraint if exists projects_viewer_teams_check;
alter table public.projects add constraint projects_viewer_teams_check check (cardinality(viewer_teams) <= 30);
comment on column public.projects.viewer_teams is '보는 사람 직접 선택에서 펼친 팀 칩(화면용 · 고른 차례 · 0105) — 누가 보는지는 project_viewers가 정한다';

create table if not exists public.project_viewers (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_by   uuid references public.profiles(id) on delete set null,
  added_at   timestamptz not null default now(),
  primary key (project_id, profile_id)
);
create index if not exists project_viewers_profile_idx on public.project_viewers (profile_id);
comment on table public.project_viewers is '보는 사람 직접 선택(0105) — visibility = custom인 프로젝트를 보는 계정. 쓰기는 set_project_viewers·트리거만';
alter table public.project_viewers enable row level security;
revoke all on public.project_viewers from anon, authenticated;
grant select on public.project_viewers to authenticated;

-- ── 판정 함수 ───────────────────────────────────────────────────────────────
-- 고른 사람 행이 합친 계정(옛 id)이어도 남긴 계정으로 들어온 사람에게 열린다(0061 effective_uid와 같은 뜻)
create or replace function public.is_project_viewer(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_master()
      or exists (select 1 from public.project_viewers v left join public.profiles pv on pv.id = v.profile_id
                  where v.project_id = p
                    and (v.profile_id = any (array[auth.uid(), public.effective_uid()])
                         or pv.merged_into = any (array[auth.uid(), public.effective_uid()])));
$$;

-- 0092 몸통 + custom 갈래. 공개 프로젝트면 판정 함수까지 가지 않는다(앞의 not exists)
create or replace function public.can_see_project(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p is null
      or not exists (select 1 from public.projects x where x.id = p and x.visibility in ('leaders', 'custom'))
      or exists (select 1 from public.projects x where x.id = p and x.visibility = 'leaders' and public.is_leader())
      or exists (select 1 from public.projects x where x.id = p and x.visibility = 'custom' and public.is_project_viewer(x.id));
$$;

-- 업무의 지금 프로젝트로 본다. 없는 업무·null은 참(가릴 것이 없다 — 0092와 같다)
create or replace function public.can_see_card(c uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select c is null
      or coalesce((select public.can_see_project(k.project_id) from public.cards k where k.id = c), true);
$$;

-- RLS 밖에서 모은다(31-l ②). **0104(휴지통)의 몸통 위에** custom 갈래를 더한다 — 0092 몸통으로 덮으면 휴지통 업무의
-- 댓글·첨부가 도로 보인다(PITFALLS 61-b). 휴지통 갈래는 누구에게나(마스터·리더 포함) · 좁혀진 프로젝트가 없으면 판정 함수를
-- 부르지 않는다(me가 빈 줄 — 0092처럼).
create or replace function public.hidden_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  with nar as (select x.id, x.visibility from public.projects x where x.visibility in ('leaders', 'custom')),
       me  as (select array[auth.uid(), public.effective_uid()] as ids, public.is_leader() as leader, public.is_master() as master
                where exists (select 1 from nar)),
       hp  as (select nar.id from nar, me
                where (nar.visibility = 'leaders' and not me.leader)
                   or (nar.visibility = 'custom' and not me.master
                       and not exists (select 1 from public.project_viewers v left join public.profiles pv on pv.id = v.profile_id
                                        where v.project_id = nar.id
                                          and (v.profile_id = any (me.ids) or pv.merged_into = any (me.ids))))
               union
               select x.id from public.projects x where x.deleted_at is not null),
       hc  as (select k.id from public.cards k
                where k.deleted_at is not null or k.project_id in (select id from hp))
  select case when not exists (select 1 from hp) and not exists (select 1 from hc) then '{}'::uuid[]
              else array(select id from hp
                         union all select id from hc
                         union all select c.id from public.comments c join hc on hc.id = c.card_id
                         union all select f.id from public.files f join hc on hc.id = f.card_id) end;
$$;

-- 휴지통 함수(0104)의 '보이는 프로젝트인가'를 can_see_project 하나로 — 0104는 'leaders'만 봐서, 고르지 않은 사람도 직접 선택
-- 프로젝트의 휴지통 줄(제목)을 보고 id로 지우거나 되살릴 수 있었다. 판정을 한 함수에 두면 뒤 마이그레이션(0110 지난해 리더)이
-- can_see_project만 고쳐도 휴지통이 따라간다. 나머지 몸통은 0104 그대로(trash_card는 hidden_ids를 봐서 그대로 둔다).
create or replace function public.trash_project(p_project uuid) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  select id, visibility, deleted_at into p from public.projects where id = p_project for update;
  if not found then raise exception 'no project' using errcode = 'P0002'; end if;
  if p.deleted_at is not null then return p.deleted_at; end if;
  -- projects_delete와 같다(승인 전원 · 좁혀진 프로젝트는 볼 수 있는 사람만)
  if not public.can_see_project(p_project) then raise exception 'not visible' using errcode = '42501'; end if;
  update public.projects set deleted_at = now(), deleted_by = public.effective_uid() where id = p_project;
  return now();
end $$;

create or replace function public.restore_card(p_card uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare k record;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  select c.id, c.project_id, c.deleted_at, c.deleted_by, x.deleted_at as project_deleted_at
    into k from public.cards c join public.projects x on x.id = c.project_id
   where c.id = p_card for update of c;
  if not found then raise exception 'no card' using errcode = 'P0002'; end if;
  if k.deleted_at is null then return 'ok'; end if;
  if not (coalesce(k.deleted_by = any (array[auth.uid(), public.effective_uid()]), false) or public.is_master()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.can_see_project(k.project_id) then raise exception 'not visible' using errcode = '42501'; end if;
  if k.project_deleted_at is not null then return 'no-project'; end if;
  update public.cards set deleted_at = null, deleted_by = null where id = p_card;
  return 'ok';
end $$;

create or replace function public.restore_project(p_project uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  select id, deleted_at, deleted_by into p from public.projects where id = p_project for update;
  if not found then raise exception 'no project' using errcode = 'P0002'; end if;
  if p.deleted_at is null then return 'ok'; end if;
  if not (coalesce(p.deleted_by = any (array[auth.uid(), public.effective_uid()]), false) or public.is_master()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project) then raise exception 'not visible' using errcode = '42501'; end if;
  update public.projects set deleted_at = null, deleted_by = null where id = p_project;
  return 'ok';
end $$;

-- 휴지통 줄 — 0104 몸통 · 보이는 프로젝트의 것만(can_see_project — 리더만 · 직접 선택 모두)
create or replace function public.trash_list()
returns table (kind text, id uuid, title text, project_id uuid, project_title text,
               deleted_at timestamptz, deleted_by uuid, teams text[], task_count int)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select public.is_approved() as ok),
       since as (select now() - interval '30 days' as t)
  select 'project', p.id, p.name, p.id, p.name, p.deleted_at, p.deleted_by, '{}'::text[],
         (select count(*)::int from public.cards k where k.project_id = p.id and k.deleted_at is null)
    from public.projects p, me, since
   where me.ok and p.deleted_at is not null and p.deleted_at > since.t
     and public.can_see_project(p.id)
  union all
  select 'card', c.id, c.title, c.project_id, x.name, c.deleted_at, c.deleted_by,
         coalesce((select array_agg(t.name order by t.name) from public.card_teams ct join public.teams t on t.id = ct.team_id
                    where ct.card_id = c.id), '{}'::text[]),
         0
    from public.cards c join public.projects x on x.id = c.project_id, me, since
   where me.ok and c.deleted_at is not null and c.deleted_at > since.t
     and public.can_see_project(x.id)
  order by 6 desc;
$$;

-- 좁혀진 프로젝트마다 볼 수 있는 계정(남긴 계정 · 환송 제외). 서버 키(auth.uid() 없음)는 전부, 로그인한 사람은 자기가 보는 것만.
create or replace function public.project_audiences(ps uuid[] default null)
returns table (project_id uuid, profile_ids uuid[])
language sql stable security definer set search_path = public, pg_temp as $$
  with pj as (
    select x.id, x.visibility from public.projects x
     where x.visibility in ('leaders', 'custom')
       and (ps is null or x.id = any (ps))
       and (auth.uid() is null
            or (public.is_approved() and coalesce(x.id <> all ((select public.hidden_ids())::uuid[]), true)))
  ),
  masters as (
    select p.id from public.profiles p
     where p.merged_into is null and p.removed_at is null
       and exists (select 1 from public.admins a where a.is_master and lower(a.email) = lower(coalesce(p.email, '')))
  )
  select pj.id,
         case when pj.visibility = 'leaders' then public.leader_profile_ids()
              else coalesce((select array_agg(distinct u.id order by u.id) from (
                       select coalesce(pr.merged_into, pr.id) as id
                         from public.project_viewers v join public.profiles pr on pr.id = v.profile_id
                        where v.project_id = pj.id and pr.removed_at is null
                       union select m.id from masters m) u), '{}'::uuid[]) end
    from pj;
$$;

-- 보는 사람을 직접 선택으로 + 고른 사람 · 팀 칩을 한 번에(왕복 한 번 — §6-27 겹쳐 저장해도 마지막 것이 남을 뿐).
-- 리더만 부른다(자물쇠가 리더에게만 서는 것과 같은 판정 · 0092). 부른 사람(남긴 계정)은 언제나 남는다.
-- 환송·합쳐진 계정은 넣지 않는다(화면 후보에도 없다). 돌려주는 것은 고친 프로젝트 행(누가·언제는 트리거가 적은 값).
create or replace function public.set_project_viewers(p uuid, ids uuid[], teams text[] default '{}')
returns public.projects
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me  uuid := public.effective_uid();
  saved public.projects;
begin
  if not public.is_approved() or me is null then raise exception 'not approved' using errcode = '42501'; end if;
  if not public.is_leader() then raise exception 'not a leader' using errcode = '42501'; end if;
  if not public.can_see_project(p) then raise exception 'not visible' using errcode = '42501'; end if;
  update public.projects set visibility = 'custom', viewer_teams = coalesce(teams, '{}') where id = p returning * into saved;
  if not found then raise exception 'no project' using errcode = 'P0002'; end if;
  delete from public.project_viewers v
   where v.project_id = p and v.profile_id <> me and not (v.profile_id = any (coalesce(ids, '{}')));
  insert into public.project_viewers (project_id, profile_id, added_by)
  select p, pr.id, me from public.profiles pr
   where (pr.id = any (coalesce(ids, '{}')) or pr.id = me) and pr.merged_into is null and pr.removed_at is null
  on conflict (project_id, profile_id) do nothing;
  return saved;
end $$;

revoke all on function public.is_project_viewer(uuid) from public, anon;
revoke all on function public.project_audiences(uuid[]) from public, anon;
revoke all on function public.set_project_viewers(uuid, uuid[], text[]) from public, anon;
grant execute on function public.is_project_viewer(uuid) to authenticated, service_role;
grant execute on function public.project_audiences(uuid[]) to authenticated, service_role;
grant execute on function public.set_project_viewers(uuid, uuid[], text[]) to authenticated;

-- ── 보호 트리거 ─────────────────────────────────────────────────────────────
-- 0092 몸통 + viewer_teams. 리더가 아니면 둘 다 옛 값(INSERT면 'all' · 빈 배열)
create or replace function public.guard_project_visibility() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.is_leader() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.visibility := 'all';
    new.viewer_teams := '{}';
  else
    new.visibility := old.visibility;
    new.viewer_teams := old.viewer_teams;
  end if;
  return new;
end $$;

comment on function public.guard_project_visibility() is
  '리더가 아니면 projects.visibility·viewer_teams를 못 바꾼다 — 되돌리기만 하고 예외는 없다(0092 · 0105)';

drop trigger if exists trg_projects_guard_visibility on public.projects;
create trigger trg_projects_guard_visibility before insert or update of visibility, viewer_teams on public.projects
  for each row execute function public.guard_project_visibility();

-- 0099 몸통 — INSERT 갈래만 'leaders' → 'all'이 아닌 것
create or replace function public.stamp_project_visibility() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.visibility <> 'all' then
      new.visibility_by := public.effective_uid(); new.visibility_at := now();
    else
      new.visibility_by := null; new.visibility_at := null;
    end if;
  elsif new.visibility is distinct from old.visibility then
    new.visibility_by := public.effective_uid(); new.visibility_at := now();
  else
    new.visibility_by := old.visibility_by; new.visibility_at := old.visibility_at;
  end if;
  return new;
end $$;

-- 'custom'이 되는 순간 바꾼 사람을 고른 사람에 넣는다(로그인 문맥만 · 서버 키·psql은 그대로)
create or replace function public.ensure_custom_viewer() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := public.effective_uid();
begin
  if me is not null and new.visibility = 'custom' and (tg_op = 'INSERT' or old.visibility is distinct from 'custom') then
    insert into public.project_viewers (project_id, profile_id, added_by) values (new.id, me, me)
    on conflict (project_id, profile_id) do nothing;
  end if;
  return null;
end $$;

comment on function public.ensure_custom_viewer() is
  '보는 사람이 custom이 되는 순간 바꾼 사람(남긴 계정)을 project_viewers에 넣는다 — 스스로 잠겨 나가지 않게(0105)';

drop trigger if exists trg_projects_custom_self on public.projects;
create trigger trg_projects_custom_self after insert or update of visibility on public.projects
  for each row execute function public.ensure_custom_viewer();

-- 트리거 함수는 RPC로 부를 일이 없다(0101 ①)
revoke execute on function public.ensure_custom_viewer() from public, anon, authenticated;
revoke execute on function public.guard_project_visibility() from public, anon, authenticated;
revoke execute on function public.stamp_project_visibility() from public, anon, authenticated;

-- ── 정책 ────────────────────────────────────────────────────────────────────
-- 새 표 — 그 표에만 걸린다(처음 만드는 것)
drop policy if exists project_viewers_select on public.project_viewers;
create policy project_viewers_select on public.project_viewers for select to authenticated
  using ((select public.is_approved()) and coalesce(project_id <> all ((select public.hidden_ids())::uuid[]), true));

-- projects — restrictive 하나(머리말). 'custom'이 아닌 행에는 언제나 참이라 0092·0101·0102의 식이 그대로 산다.
-- with check는 바꾸기 **전** 판정이라(InitPlan) 'all → custom'을 막지 않는다 — 바꾼 사람은 트리거가 고른 사람에 넣는다.
drop policy if exists projects_custom_guard on public.projects;
create policy projects_custom_guard on public.projects as restrictive for all to authenticated
  using (visibility <> 'custom' or coalesce(id <> all ((select public.hidden_ids())::uuid[]), true))
  with check (visibility <> 'custom' or coalesce(id <> all ((select public.hidden_ids())::uuid[]), true));

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select visibility, count(*) from projects group by 1;                                  -- custom 0
--   select proname, prosecdef from pg_proc where proname in ('is_project_viewer','project_audiences','set_project_viewers',
--     'can_see_project','can_see_card','hidden_ids','ensure_custom_viewer');                -- 트리거 함수 빼고 t
--   select prosrc like '%deleted_at is not null%' and prosrc like '%custom%' from pg_proc where proname = 'hidden_ids';  -- t(휴지통 + custom)
--   select policyname, permissive, cmd, roles from pg_policies where tablename in ('projects','project_viewers');
--     -- projects_custom_guard RESTRICTIVE ALL {authenticated} · project_viewers_select SELECT {authenticated}
--   select tgname from pg_trigger where tgname in ('trg_projects_guard_visibility','trg_projects_visibility_stamp','trg_projects_custom_self');
--   -- 리허설: 레포 밖 SQL(보고에 경로) — 이 파일 본문을 begin/commit 줄 없이 붙인 바깥 begin … rollback 안에서
--   --   만든 사람(리더) · 고른 사람 · 고르지 않은 회원 · 마스터로 업무·댓글·첨부·활동·doc_vec·project_viewers 행 수와 RPC 권한을 본다.
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   begin;
--   update public.projects set visibility = 'all' where visibility = 'custom';   -- psql(서버 문맥)에서 — 보호 트리거를 지난다
--   drop policy if exists projects_custom_guard on public.projects;
--   drop trigger if exists trg_projects_custom_self on public.projects;
--   drop function if exists public.ensure_custom_viewer();
--   -- guard_project_visibility · stamp_project_visibility는 0092 · 0099의 몸통으로 다시 create or replace하고
--   --   trg_projects_guard_visibility를 `before insert or update of visibility`로 다시 만든다
--   -- can_see_project · can_see_card는 0092의 몸통으로, hidden_ids는 0104의 몸통으로(0092로 덮으면 휴지통이 풀린다),
--   --   trash_project · restore_card · restore_project · trash_list는 0104의 몸통으로 다시 create or replace
--   drop function if exists public.set_project_viewers(uuid, uuid[], text[]);
--   drop function if exists public.project_audiences(uuid[]);
--   drop function if exists public.is_project_viewer(uuid);
--   drop table if exists public.project_viewers;
--   alter table public.projects drop constraint if exists projects_viewer_teams_check;
--   alter table public.projects drop column if exists viewer_teams;
--   alter table public.projects drop constraint if exists projects_visibility_check;
--   alter table public.projects add constraint projects_visibility_check check (visibility in ('all', 'leaders'));
--   commit;
