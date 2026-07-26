-- ============================================================================
-- 0008 — 한 사람이 여러 팀에 속할 수 있게 (예: 찬양팀 + 임원진)
--
-- 기존 것은 아무것도 바꾸지 않는다. 순수 추가:
--   - profiles.team_id 는 그대로 남아 "대표 팀"(아바타 색·기본 팀 보드)으로 계속 쓴다.
--   - 여러 팀은 이 조인 테이블에 담는다.
-- 그래서 이 마이그레이션을 적용하기 전 코드도, 적용한 뒤 코드도 둘 다 동작한다.
-- ============================================================================

create table if not exists public.profile_teams (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  team_id    uuid not null references public.teams(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, team_id)
);

alter table public.profile_teams enable row level security;

create index if not exists idx_profile_teams_profile on public.profile_teams(profile_id);
create index if not exists idx_profile_teams_team    on public.profile_teams(team_id);

-- 소속은 팀원 전체가 볼 수 있어야 한다(멘션·팀 보드에서 쓰임).
drop policy if exists "profile_teams read" on public.profile_teams;
create policy "profile_teams read" on public.profile_teams
  for select using (auth.role() = 'authenticated');

-- 쓰기는 본인 것만.
drop policy if exists "profile_teams write own" on public.profile_teams;
create policy "profile_teams write own" on public.profile_teams
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- 기존 대표 팀을 소속에도 한 번 채워 넣는다(중복은 무시).
insert into public.profile_teams (profile_id, team_id)
select p.id, p.team_id from public.profiles p where p.team_id is not null
on conflict do nothing;
