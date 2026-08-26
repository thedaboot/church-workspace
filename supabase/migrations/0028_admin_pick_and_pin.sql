-- ============================================================================
-- 0028 — 관리자를 가입자 목록에서 고른다 + 마스터 관리자 (사용자 결정 2026-08-26)
-- ----------------------------------------------------------------------------
-- 두 가지 요청이 한 뿌리에서 나왔다.
--
-- ① **관리자를 이메일로 타이핑해서 넣는 것이 불편하다.** 가입한 사람 목록에서
--    골라야 맞다 — "현재 내가 저 두 메일을 쓰고 있어서 어차피 노준석이잖아".
--    그런데 `profiles`에 이메일이 없어서(0022 주석) 목록에서 고를 수가 없었다.
--    → `profiles.email`을 두고 `auth.users`에서 백필한다. 이제 사람을 고르면
--    그 사람의 이메일이 `admins`에 들어간다. `admins.email`은 그대로 원본이고
--    `is_admin()`도 그대로다 — 화면이 고르는 방식만 바뀐다.
--
-- ② **AI 관련 기능은 마스터 관리자만.** 관리자가 늘어나도 3줄 요약 고정·고치기
--    같은 AI 기능은 joshua052698@gmail.com · lordjoshua@naver.com만 한다
--    ("나는 관리자 중의 관리자 마스터"). AI는 돈이 드는 기능이고 워크스페이스
--    전체에 남는 글을 만든다 — 관리자를 늘리는 것과 이건 별개의 결정이다.
--    → `admins.is_master`. 기본값 false이고 그 둘만 true로 시작한다.
--
-- 한 사람이 계정을 여럿 쓰면(구글·카카오) `admins`에 행이 둘이다. 그건 그대로
-- 둔다 — `is_admin()`이 JWT의 이메일 하나만 보므로, 어느 쪽으로 들어와도
-- 관리자이려면 둘 다 있어야 한다(§4.5).
-- ============================================================================

-- ── 1. profiles.email ──────────────────────────────────────────────────────
alter table public.profiles add column if not exists email text;

update public.profiles p
set email = lower(u.email)
from auth.users u
where u.id = p.id and (p.email is distinct from lower(u.email));

create index if not exists profiles_email_idx on public.profiles (lower(email));

-- 가입 순간에도 채워지게 — 트리거가 프로필을 만드는 경로가 있으면 거기서도 온다.
-- 앱의 ensureMyProfile도 같이 넣는다(코드 쪽).
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is null then
    select lower(u.email) into new.email from auth.users u where u.id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_profile_email on public.profiles;
create trigger trg_sync_profile_email
  before insert on public.profiles
  for each row execute function public.sync_profile_email();

-- ── 2. admins.is_master ────────────────────────────────────────────────────
alter table public.admins add column if not exists is_master boolean not null default false;

update public.admins set is_master = true
where lower(email) in ('joshua052698@gmail.com', 'lordjoshua@naver.com');

-- 마스터인지 묻는 함수. is_admin()과 같은 모양(security definer + search_path).
create or replace function public.is_master()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and a.is_master
  );
$$;

revoke all on function public.is_master() from public;
grant execute on function public.is_master() to authenticated;

-- admins UPDATE 정책 — 관리자가 이 값을 켜고 끌 수 있어야 한다.
-- 0022는 select/insert/delete만 열어 두었다.
drop policy if exists admins_update on public.admins;
create policy admins_update on public.admins
  for update using (public.is_admin()) with check (public.is_admin());

-- ── 확인 ───────────────────────────────────────────────────────────────────
--   select display_name, email from profiles where email is null;   -- 0행이어야 한다
--   select email, is_master from admins;
--   -- joshua052698@gmail.com · lordjoshua@naver.com 만 true

-- ── 되돌리기 ───────────────────────────────────────────────────────────────
-- drop trigger if exists trg_sync_profile_email on public.profiles;
-- drop function if exists public.sync_profile_email();
-- drop function if exists public.is_master();
-- drop policy if exists admins_update on public.admins;
-- alter table public.admins drop column if exists is_master;
-- drop index if exists profiles_email_idx;
-- alter table public.profiles drop column if exists email;
