-- ============================================================================
-- 0068 — 명단에서 고친 소속이 계정에도 선다 (2026-09-22 사용자 요청)
-- ----------------------------------------------------------------------------
-- 사용자 지적: "현민스는 교역자도 아닌데, 전에 순장·순원이 없었어서 그걸로 설정해둔
-- 상태이거든." 라이브를 보니 정확히 그랬다 — `people.teams`는 `{순장}`인데
-- `profile_teams`는 `교역자`였다. 그리고 **`teams` 표에 순장·순원 행이 아예 없어서**
-- 계정 쪽은 그 값을 가질 수조차 없었다.
--
-- 소속도 생일(0067)과 같은 모양으로 두 곳에 있다:
--   · `people.teams`      text[] — 명단(54명, 미가입자 포함). 관리자·순장이 고친다.
--   · `profile_teams`     조인 표 — 계정. 대시보드 '팀별 남은 업무'·멘션·팀 보드가 읽는다.
-- 명단에서 고쳐도 계정은 옛 값을 들고 있었다. **명단이 원본**이고 여기서 계정으로 옮긴다.
--
-- ── 손대는 범위를 좁힌다 (이게 이 파일의 핵심이다) ──────────────────────────
-- 계정에는 **명단 화면이 고를 수 없는 소속**도 있다 — `임원진`이 그렇다(라이브에서
-- 박지호·신효진·양민혁·정민경·조준환·조해리가 갖고 있다). 명단이 그 칩을 안 가지므로
-- 명단을 그대로 계정에 복사하면 **임원진이 통째로 지워진다.**
-- 그래서 이 트리거는 `managed`(명단이 고를 수 있는 것)에 대해서만 맞추고 나머지는
-- 손대지 않는다. managed = 이름이 '팀'으로 끝나는 것 + 순장·순원·교역자.
--
-- ── 일괄 백필은 하지 않는다 ────────────────────────────────────────────────
-- 지금 어긋난 사람이 몇 있는데(시온은 명단에만 찬양팀, 꽃님·양민혁은 계정에만 웰컴팀·
-- 워십팀), 어느 쪽이 맞는지는 **사람이 알아야 하는 것**이다. 한쪽으로 밀어 버리면
-- 진짜 소속이 조용히 사라진다. 트리거는 **앞으로 명단을 고칠 때**부터 돈다.
-- 예외로 사용자가 짚은 배현민 한 행만 여기서 다시 저장해 트리거를 태운다.
--
-- security definer인 이유는 0067과 같다 — 명단을 고치는 사람이 남의 profile_teams를
-- 고칠 권한은 없다. 경계는 people 쪽 RLS가 이미 보고, 여기서는 결과를 옮기기만 한다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ① 계정이 가질 수 있게 순장·순원 팀 행을 만든다(없을 때만).
--    이름은 CONFIG.TEAMS(config.js)와 **글자까지 같아야** 한다 — 화면은 이름으로 견준다.
insert into public.teams (name)
select v.name from (values ('순장'), ('순원')) as v(name)
 where not exists (select 1 from public.teams t where t.name = v.name);

-- ② 명단이 고를 수 있는 소속인가 — 트리거와 아래 확인 SQL이 같은 규칙을 본다.
create or replace function public.is_roster_team(team_name text)
returns boolean language sql immutable as $$
  select team_name like '%팀' or team_name in ('순장', '순원', '교역자');
$$;

comment on function public.is_roster_team(text) is
  '명단 화면의 소속 칩으로 고를 수 있는 이름인가 — 임원진처럼 아닌 것은 트리거가 손대지 않는다(0068)';

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
  -- 명단이 고를 수 있는 것 중 **명단에 없는 것**을 뗀다(임원진 같은 것은 그대로 둔다)
  delete from public.profile_teams pt
   using public.teams t
   where pt.profile_id = new.profile_id
     and t.id = pt.team_id
     and public.is_roster_team(t.name)
     and not (t.name = any (coalesce(new.teams, '{}')));
  -- 명단에 있는데 계정에 없는 것을 붙인다. teams 표에 없는 이름은 조용히 넘어간다
  -- (칩 목록에 새 이름이 생겼는데 표 행을 안 만든 경우 — 그때는 ①처럼 행을 먼저 만든다).
  insert into public.profile_teams (profile_id, team_id)
  select new.profile_id, t.id
    from public.teams t
   where t.name = any (coalesce(new.teams, '{}'))
     and public.is_roster_team(t.name)
  on conflict (profile_id, team_id) do nothing;
  return new;
end;
$$;

comment on function public.sync_person_teams() is
  '명단(people.teams)에서 고친 소속을 계정(profile_teams)에 옮긴다 — 명단이 못 고르는 것(임원진)은 손대지 않는다(0068)';

drop trigger if exists people_teams_to_profile on public.people;
create trigger people_teams_to_profile
  after insert or update of teams, profile_id on public.people
  for each row execute function public.sync_person_teams();

-- ③ 사용자가 짚은 한 행만 다시 저장해 트리거를 태운다(계정의 '교역자'가 '순장'이 된다).
--    나머지 어긋난 사람은 **일부러 두었다** — 어느 쪽이 맞는지 사람이 정한다.
update public.people set teams = teams where name = '배현민';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select tgname from pg_trigger where tgrelid='public.people'::regclass and not tgisinternal;
--   -- people_birthday_to_profile · people_teams_to_profile
--
--   -- 배현민 계정이 순장으로 바뀌었나 (교역자가 없어야 한다)
--   select p.display_name, array_agg(t.name order by t.name)
--     from public.people pe join public.profiles p on p.id = pe.profile_id
--     left join public.profile_teams pt on pt.profile_id = p.id
--     left join public.teams t on t.id = pt.team_id
--    where pe.name = '배현민' group by 1;
--
--   -- 아직 어긋난 사람 보기(명단이 고를 수 있는 것만 견준다)
--   select p.display_name, pe.teams 명단,
--          array_agg(t.name order by t.name) filter (where public.is_roster_team(t.name)) 계정
--     from public.people pe join public.profiles p on p.id = pe.profile_id
--     left join public.profile_teams pt on pt.profile_id = p.id
--     left join public.teams t on t.id = pt.team_id
--    group by 1, 2 order by 1;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop trigger if exists people_teams_to_profile on public.people;
--   drop function if exists public.sync_person_teams();
--   drop function if exists public.is_roster_team(text);
--   (순장·순원 teams 행과 옮겨진 소속은 되돌리지 않는다 — 그 값들은 맞는 값이다)
