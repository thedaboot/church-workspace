-- ============================================================================
-- 0070 — 대표 팀(profiles.team_id)도 소속을 따라간다 (2026-09-22 사용자 지적)
-- ----------------------------------------------------------------------------
-- 사용자 지적: "교역자에서 빼달라니까. 업무 대시보드의 가입한 사람 쪽에서도 보이잖아."
-- 0068·0069로 `profile_teams`는 맞췄는데도 현민스가 "교역자 · 순장"으로 떴다.
--
-- **소속이 있는 자리가 셋이었다.**
--   ① `people.teams`     text[]  — 명단(미가입자 포함). 관리자·순장이 고친다.
--   ② `profile_teams`    조인 표 — 계정의 여러 소속(0008). 0068이 ①에서 옮긴다.
--   ③ `profiles.team_id` uuid    — **대표 팀**(0008이 "그대로 남긴다"고 한 칸).
--                                  아바타 색과 기본 팀 보드가 이걸 본다.
-- ①②만 맞추고 ③을 안 건드려서, 현민스의 대표 팀이 교역자로 굳은 채 화면에 남았다.
--
-- 그래서 트리거 둘이 ③까지 같이 본다:
--   · 소속이 바뀌었는데 대표 팀이 **명단이 고를 수 있는 이름인데 지금 소속에 없으면**
--     → 지금 소속의 첫 번째로 옮긴다(소속이 비었으면 비운다).
--   · **명단이 못 고르는 대표 팀(임원진)은 건드리지 않는다** — 0068과 같은 울타리다.
--   · 교역자는 직분이 정한다(0069) — is_pastor가 꺼지면 대표 팀에서도 뺀다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- 대표 팀을 지금 소속에 맞춘다. 부르는 쪽(트리거 둘)이 profile_teams를 먼저 고친 뒤 부른다.
create or replace function public.fix_profile_team_id(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cur text;
  first_id uuid;
begin
  select t.name into cur
    from public.profiles p join public.teams t on t.id = p.team_id
   where p.id = p_profile;
  -- 대표 팀이 비어 있거나, 명단이 못 고르는 이름(임원진)이면 그대로 둔다
  if cur is null or not public.is_roster_team(cur) then
    -- 교역자만은 직분이 정하므로 여기서도 본다(0069)
    if cur is distinct from '교역자' then
      return;
    end if;
  end if;
  -- 지금 이 사람의 소속 중 명단이 고를 수 있는 것이 대표 팀이면 그대로 둔다
  if exists (
    select 1 from public.profile_teams pt join public.teams t on t.id = pt.team_id
     where pt.profile_id = p_profile and t.name = cur
  ) then
    return;
  end if;
  -- 아니면 지금 소속의 첫 번째로 옮긴다(이름 차례). 소속이 비었으면 비운다.
  select pt.team_id into first_id
    from public.profile_teams pt join public.teams t on t.id = pt.team_id
   where pt.profile_id = p_profile
   order by t.name limit 1;
  update public.profiles set team_id = first_id where id = p_profile;
end;
$$;

comment on function public.fix_profile_team_id(uuid) is
  '대표 팀(profiles.team_id)을 지금 소속에 맞춘다 — 임원진처럼 명단이 못 고르는 것은 그대로 둔다(0070)';

-- 소속 트리거에 한 줄 더한다
create or replace function public.sync_person_teams()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.profile_id is null then
    return new;
  end if;
  delete from public.profile_teams pt
   using public.teams t
   where pt.profile_id = new.profile_id
     and t.id = pt.team_id
     and public.is_roster_team(t.name)
     and not (t.name = any (coalesce(new.teams, '{}')));
  insert into public.profile_teams (profile_id, team_id)
  select new.profile_id, t.id
    from public.teams t
   where t.name = any (coalesce(new.teams, '{}'))
     and public.is_roster_team(t.name)
  on conflict (profile_id, team_id) do nothing;
  perform public.fix_profile_team_id(new.profile_id);     -- 0070
  return new;
end;
$$;

-- 직분 트리거도 마찬가지 — 교역자를 뗐으면 대표 팀에서도 빠져야 한다
create or replace function public.sync_pastor_team()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pastor_id uuid;
begin
  if new.profile_id is null then
    return new;
  end if;
  select id into pastor_id from public.teams where name = '교역자';
  if pastor_id is null then
    return new;
  end if;
  if new.is_pastor then
    insert into public.profile_teams (profile_id, team_id)
    values (new.profile_id, pastor_id)
    on conflict (profile_id, team_id) do nothing;
  else
    delete from public.profile_teams
     where profile_id = new.profile_id and team_id = pastor_id;
  end if;
  perform public.fix_profile_team_id(new.profile_id);     -- 0070
  return new;
end;
$$;

-- 지금 어긋난 것을 맞춘다(트리거를 태운다). 임원진 대표 팀은 위 함수가 그대로 둔다.
update public.people set teams = teams where profile_id is not null;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   -- 대표 팀이 소속에 없는 사람 (임원진은 빼고 — 0이어야 한다)
--   select p.display_name, t.name 대표팀,
--          array_agg(t2.name order by t2.name) filter (where t2.name is not null) 소속
--     from public.profiles p
--     join public.teams t on t.id = p.team_id
--     left join public.profile_teams pt on pt.profile_id = p.id
--     left join public.teams t2 on t2.id = pt.team_id
--    where p.merged_into is null and public.is_roster_team(t.name)
--    group by 1,2
--   having not (t.name = any(coalesce(array_agg(t2.name) filter (where t2.name is not null),'{}')));
--
--   -- 현민스 (대표 팀이 순장이어야 한다)
--   select p.display_name, t.name from public.profiles p
--     left join public.teams t on t.id = p.team_id where p.display_name = '현민스';
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   (0068·0069의 함수에서 `perform public.fix_profile_team_id(...)` 줄을 빼고
--    drop function if exists public.fix_profile_team_id(uuid); — 옮겨진 대표 팀은
--    되돌리지 않는다. 그 값들은 맞는 값이다.)
