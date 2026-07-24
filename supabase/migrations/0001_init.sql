-- ============================================================================
-- 0001_init.sql — Church Workspace 클라우드 백엔드 초기 스키마
-- ----------------------------------------------------------------------------
-- 상태·관계 데이터는 Supabase(Postgres)에 저장하고, 파일 실체는 관리자 구글
-- 드라이브에 두며 DB에는 참조(files)만 보관한다. 모든 테이블 RLS 활성화.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 공통 트리거 함수: updated_at 자동 갱신
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- admins — 관리자 이메일 화이트리스트 (정책 없음 = 일반 접근 전면 차단)
-- ============================================================================
create table if not exists public.admins (
  email text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- 의도적으로 어떤 정책도 만들지 않는다 → anon/authenticated 모두 접근 불가.
-- is_admin()은 security definer라 RLS를 우회해 이 테이블을 조회할 수 있다.

create trigger trg_admins_updated_at
  before update on public.admins
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- is_admin() — 현재 JWT의 이메일이 admins에 있는지 (대소문자 무시)
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ============================================================================
-- teams
-- ============================================================================
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.teams enable row level security;

create trigger trg_teams_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

-- ============================================================================
-- profiles — auth.users 1:1, 가입 시 트리거로 자동 생성
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  team_id uuid references public.teams,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create index if not exists idx_profiles_team_id on public.profiles(team_id);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 신규 가입 시 프로필 자동 생성 (raw_user_meta_data의 full_name/name 사용)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- projects
-- ============================================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  archived boolean not null default false,
  created_by uuid default auth.uid() references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;

create index if not exists idx_projects_created_by on public.projects(created_by);
create index if not exists idx_projects_archived on public.projects(archived);

create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ============================================================================
-- resource_links
-- ============================================================================
create table if not exists public.resource_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects on delete cascade,
  title text not null,
  url text not null,
  created_by uuid default auth.uid() references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.resource_links enable row level security;

create index if not exists idx_resource_links_project_id on public.resource_links(project_id);

create trigger trg_resource_links_updated_at
  before update on public.resource_links
  for each row execute function public.set_updated_at();

-- ============================================================================
-- cards — 칸반 카드(작업). start_date 포함(프론트에 시작일 기능 존재).
-- ============================================================================
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  start_date date,
  due_date date,
  assignees text[],
  position double precision not null default 0,
  created_by uuid default auth.uid() references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cards enable row level security;

create index if not exists idx_cards_project_id on public.cards(project_id);
create index if not exists idx_cards_status on public.cards(status);
create index if not exists idx_cards_created_by on public.cards(created_by);

create trigger trg_cards_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

-- ============================================================================
-- card_teams — 카드 ↔ 팀 다대다 (프론트 task.teams가 배열)
-- ============================================================================
create table if not exists public.card_teams (
  card_id uuid references public.cards on delete cascade,
  team_id uuid references public.teams on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (card_id, team_id)
);
alter table public.card_teams enable row level security;

create index if not exists idx_card_teams_card_id on public.card_teams(card_id);
create index if not exists idx_card_teams_team_id on public.card_teams(team_id);

create trigger trg_card_teams_updated_at
  before update on public.card_teams
  for each row execute function public.set_updated_at();

-- ============================================================================
-- comments — parent_id로 답글(대댓글) 지원
-- ============================================================================
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references public.cards on delete cascade,
  parent_id uuid references public.comments on delete cascade,
  author_id uuid default auth.uid() references auth.users,
  body text not null,
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.comments enable row level security;

create index if not exists idx_comments_card_id on public.comments(card_id);
create index if not exists idx_comments_parent_id on public.comments(parent_id);
create index if not exists idx_comments_author_id on public.comments(author_id);

create trigger trg_comments_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- ============================================================================
-- files — 드라이브 파일 참조 (실체는 드라이브, DB엔 메타/링크만)
-- ============================================================================
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects on delete cascade,
  card_id uuid references public.cards on delete set null,
  drive_file_id text not null,
  name text not null,
  mime_type text,
  web_view_link text,
  uploaded_by uuid default auth.uid() references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.files enable row level security;

create index if not exists idx_files_project_id on public.files(project_id);
create index if not exists idx_files_card_id on public.files(card_id);

create trigger trg_files_updated_at
  before update on public.files
  for each row execute function public.set_updated_at();

-- ============================================================================
-- activity — 활동 로그
-- ============================================================================
create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,
  card_id uuid,
  actor_id uuid default auth.uid(),
  action text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.activity enable row level security;

create index if not exists idx_activity_project_id on public.activity(project_id);
create index if not exists idx_activity_card_id on public.activity(card_id);

create trigger trg_activity_updated_at
  before update on public.activity
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RLS 정책
--   SELECT     : 로그인 사용자 전체 허용 (admins 제외)
--   INSERT/UPD : 로그인 사용자 허용 (profiles는 본인만)
--   DELETE     : projects → is_admin만 / cards·comments·files·resource_links →
--                작성 본인 또는 is_admin
-- ============================================================================

-- teams
create policy teams_select on public.teams
  for select using (auth.role() = 'authenticated');
create policy teams_insert on public.teams
  for insert with check (auth.role() = 'authenticated');
create policy teams_update on public.teams
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- profiles (본인만 insert/update)
create policy profiles_select on public.profiles
  for select using (auth.role() = 'authenticated');
create policy profiles_insert on public.profiles
  for insert with check (auth.uid() = id);
create policy profiles_update on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- projects
create policy projects_select on public.projects
  for select using (auth.role() = 'authenticated');
create policy projects_insert on public.projects
  for insert with check (auth.role() = 'authenticated');
create policy projects_update on public.projects
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy projects_delete on public.projects
  for delete using (public.is_admin());

-- resource_links
create policy resource_links_select on public.resource_links
  for select using (auth.role() = 'authenticated');
create policy resource_links_insert on public.resource_links
  for insert with check (auth.role() = 'authenticated');
create policy resource_links_update on public.resource_links
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy resource_links_delete on public.resource_links
  for delete using (created_by = auth.uid() or public.is_admin());

-- cards
create policy cards_select on public.cards
  for select using (auth.role() = 'authenticated');
create policy cards_insert on public.cards
  for insert with check (auth.role() = 'authenticated');
create policy cards_update on public.cards
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy cards_delete on public.cards
  for delete using (created_by = auth.uid() or public.is_admin());

-- card_teams (조인 테이블 — 로그인 사용자 전체 관리 허용)
create policy card_teams_select on public.card_teams
  for select using (auth.role() = 'authenticated');
create policy card_teams_insert on public.card_teams
  for insert with check (auth.role() = 'authenticated');
create policy card_teams_update on public.card_teams
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy card_teams_delete on public.card_teams
  for delete using (auth.role() = 'authenticated');

-- comments
create policy comments_select on public.comments
  for select using (auth.role() = 'authenticated');
create policy comments_insert on public.comments
  for insert with check (auth.role() = 'authenticated');
create policy comments_update on public.comments
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy comments_delete on public.comments
  for delete using (author_id = auth.uid() or public.is_admin());

-- files
create policy files_select on public.files
  for select using (auth.role() = 'authenticated');
create policy files_insert on public.files
  for insert with check (auth.role() = 'authenticated');
create policy files_update on public.files
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy files_delete on public.files
  for delete using (uploaded_by = auth.uid() or public.is_admin());

-- activity (로그인 사용자 조회/기록)
create policy activity_select on public.activity
  for select using (auth.role() = 'authenticated');
create policy activity_insert on public.activity
  for insert with check (auth.role() = 'authenticated');

-- ============================================================================
-- Realtime 발행 등록
-- ============================================================================
alter publication supabase_realtime add table
  public.projects, public.cards, public.comments, public.resource_links, public.files;
