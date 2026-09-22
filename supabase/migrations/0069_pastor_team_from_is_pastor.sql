-- ============================================================================
-- 0069 — 계정의 '교역자' 소속은 직분 토글이 정한다 (2026-09-22 사용자 결정)
-- ----------------------------------------------------------------------------
-- 0068에서 명단 소속(`people.teams`)을 계정(`profile_teams`)으로 옮기게 했다. 그때
-- `교역자`도 명단 소속 칩에 잠깐 넣었는데, **사용자가 도로 뺐다** — 교역자는 직분이고
-- 명단의 '직분' 줄이 이미 맡고 있어서, 같은 글자가 두 줄에 서면 어느 쪽을 눌러야 하는지
-- 알 수 없기 때문이다(tests/roster가 실제로 그 모호함에 걸려 깨졌다).
--
-- 그러면 **계정 쪽 교역자는 누가 정하나.** 직분이다:
--   · `people.is_pastor = true`  → 계정 소속에 교역자를 붙인다.
--   · `people.is_pastor = false` → 계정 소속에서 교역자를 뗀다.
-- 이렇게 두면 명단 소속 칩에 교역자가 없어도 계정이 어긋난 채로 굳지 않는다.
-- 실제로 굳어 있던 자리다 — 배현민 계정이 교역자였는데 명단은 순장이었고(0068에서 고쳤다),
-- 임성빈은 진짜 교역자라 계정에 남아 있어야 한다.
--
-- **`is_roster_team`에서 교역자를 뺀다.** 그 함수는 "명단 소속 칩이 고를 수 있는 이름"이고
-- 교역자는 이제 아니다. 안 빼면 소속을 고칠 때마다 교역자가 조용히 지워진다 —
-- 명단 teams에는 그 이름이 없으니 트리거가 "뺀 것"으로 읽는다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ① 명단 소속 칩이 고를 수 있는 이름 — 교역자는 빠졌다(직분이 정한다)
create or replace function public.is_roster_team(team_name text)
returns boolean language sql immutable as $$
  select team_name like '%팀' or team_name in ('순장', '순원');
$$;

comment on function public.is_roster_team(text) is
  '명단 소속 칩으로 고를 수 있는 이름인가 — 임원진·교역자는 직분이라 빠진다(0069)';

-- ② 직분(is_pastor) → 계정 소속의 교역자
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
    return new;                                  -- 팀 표에 없으면 옮길 데가 없다
  end if;
  if new.is_pastor then
    insert into public.profile_teams (profile_id, team_id)
    values (new.profile_id, pastor_id)
    on conflict (profile_id, team_id) do nothing;
  else
    delete from public.profile_teams
     where profile_id = new.profile_id and team_id = pastor_id;
  end if;
  return new;
end;
$$;

comment on function public.sync_pastor_team() is
  '직분(people.is_pastor)이 계정 소속의 교역자를 정한다 — 명단 소속 칩에는 그 이름이 없다(0069)';

drop trigger if exists people_pastor_to_profile on public.people;
create trigger people_pastor_to_profile
  after insert or update of is_pastor, profile_id on public.people
  for each row execute function public.sync_pastor_team();

-- ③ 지금 것을 한 번 맞춘다. **이건 지우는 쪽으로도 도는 백필이지만 안전하다** —
--    교역자 여부는 is_pastor 한 칸이 진실이고, 그 칸은 명단 화면에서만 바뀐다.
update public.people set is_pastor = is_pastor where profile_id is not null;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select public.is_roster_team('교역자');   -- f
--   select public.is_roster_team('찬양팀'), public.is_roster_team('순장');   -- t, t
--
--   -- 계정 소속의 교역자와 직분이 같은가 (어긋난 행이 0이어야 한다)
--   select pe.name, pe.is_pastor,
--          exists (select 1 from public.profile_teams pt join public.teams t on t.id = pt.team_id
--                   where pt.profile_id = pe.profile_id and t.name = '교역자') as 계정교역자
--     from public.people pe where pe.profile_id is not null
--    order by pe.is_pastor desc, pe.name;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop trigger if exists people_pastor_to_profile on public.people;
--   drop function if exists public.sync_pastor_team();
--   create or replace function public.is_roster_team(team_name text)
--   returns boolean language sql immutable as $$
--     select team_name like '%팀' or team_name in ('순장', '순원', '교역자');
--   $$;
