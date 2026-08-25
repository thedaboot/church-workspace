-- ============================================================================
-- 0022 — 가입 승인 + 관리자 표 일원화 (사용자 결정 2026-08-25)
-- ----------------------------------------------------------------------------
-- 지금까지는 구글·카카오 계정만 있으면 **누구나** 들어와서 전부 읽고 쓸 수 있었다
-- (RLS가 대부분 `auth.role() = 'authenticated'`에 열려 있다). 교회 내부 내용이
-- 담긴 화면이라 승인 절차를 넣는다.
--
-- 정한 것:
--   · 승인 전에는 **아무것도** 못 본다 — 화면만 가리지 않고 DB에서 막는다.
--     화면에서만 감추면 실제로는 열려 있는 것이고(§4.4의 요약 고정이 그 상태다),
--     그러면 승인을 넣는 값이 사라진다.
--   · 관리자 원본은 `admins` 표 **하나**. `VITE_ADMIN_EMAILS`는 코드에서 뺀다 —
--     빌드 시점에 박히는 값이라, 환경변수가 원본인 한 관리자를 한 명 늘릴 때마다
--     재배포가 필요하고 화면에서 지정하는 기능과 양립할 수 없다.
--   · '내보내기'는 접근만 끊는다. 지난 댓글·기록의 이름은 그대로 남는다 —
--     comments.author_id / cards.created_by / files.uploaded_by가 auth.users를
--     cascade 없이 참조하므로, 계정을 지우려 하면 뭔가 쓴 적 있는 사람은 애초에
--     삭제 자체가 막힌다.
--
-- **정책 이름을 짐작하지 않는다.** 첫 판은 모든 표의 SELECT 정책이 `<표>_select`
-- 라고 가정했는데, 실제로는 `profile_teams read`(SELECT)와 `profile_teams write
-- own`(ALL)처럼 다른 이름이 있었다. 그대로 돌렸으면 drop이 아무것도 못 지우고
-- 새 정책만 하나 더 생겨서 **OR로 합쳐져 아무것도 막지 못했을 것이다**(조용히).
-- 그래서 pg_policies를 읽어 **있는 정책의 조건을 감싸는** 방식으로 바꿨다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

-- ── 1. profiles.approved ───────────────────────────────────────────────────
-- **기존 가입자는 전원 승인 상태로 백필한다.** 이게 빠지면 배포되는 순간
-- 지금 쓰고 있는 사람이 전부 잠긴다.
alter table public.profiles add column if not exists approved boolean not null default false;
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approved_by uuid references auth.users;

update public.profiles set approved = true, approved_at = coalesce(approved_at, now())
where approved = false;

-- 앞으로 가입하는 사람은 승인 대기다(컬럼 기본값 false 그대로).

-- ── 2. is_approved() ───────────────────────────────────────────────────────
-- is_admin()과 같은 모양(security definer + search_path 고정 — 0011의 어드바이저
-- 경고를 다시 만들지 않는다). 관리자는 자기 승인 여부와 무관하게 통과한다 —
-- 관리자가 승인을 못 받아 잠기면 아무도 아무것도 승인할 수 없다.
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approved
  ) or public.is_admin();
$$;

revoke all on function public.is_approved() from public;
grant execute on function public.is_approved() to authenticated;

-- ── 3. 있는 정책의 조건을 감싼다 ───────────────────────────────────────────
-- 대상: 워크스페이스 내용 표. 제외하는 것과 이유 —
--   admins             : 아래 5에서 따로 연다(관리자만)
--   notifications      : 본인 수신 행만(0005). 승인 대기자가 자기 알림을 읽는 것은
--                        무해하고, 여기를 막으면 승인 흐름 자체가 안 보인다
--   push_subscriptions : 본인 행만(0017)
--   profiles           : 아래 4에서 따로(승인 대기자도 **자기 행**은 읽어야 한다)
--
-- **목록을 먼저 확정한다.** `for r in select ... from pg_policies loop alter policy`
-- 로 두면 커서가 **방금 고친 정책을 다시 읽어** 조건을 무한히 겹쳐 감싸고 멈추지
-- 않는다(리허설에서 5분을 넘겨 죽었다). jsonb로 한 번에 모아 두고 그 위를 돈다.
do $$
declare
  snap jsonb;
  r jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           't', tablename, 'p', policyname, 'q', qual, 'c', with_check)), '[]'::jsonb)
    into snap
  from pg_policies
  where schemaname = 'public'
    and tablename in ('projects','cards','comments','files','resource_links',
                      'teams','card_teams','card_assignees','profile_teams','activity')
    -- 이미 감싼 것은 건너뛴다(이 마이그레이션을 두 번 돌려도 안전하게)
    and coalesce(qual, '') not like '%is_approved%'
    and coalesce(with_check, '') not like '%is_approved%';

  for r in select * from jsonb_array_elements(snap) loop
    -- USING (SELECT·UPDATE·DELETE·ALL)
    if r->>'q' is not null then
      execute format('alter policy %I on public.%I using (public.is_approved() and (%s))',
                     r->>'p', r->>'t', r->>'q');
    end if;
    -- WITH CHECK (INSERT·UPDATE·ALL)
    if r->>'c' is not null then
      execute format('alter policy %I on public.%I with check (public.is_approved() and (%s))',
                     r->>'p', r->>'t', r->>'c');
    end if;
  end loop;
end $$;

-- ── 4. profiles ────────────────────────────────────────────────────────────
-- 승인 대기자도 **자기 행은 읽어야** 한다 — 안 그러면 로그인한 본인이 "나는 승인
-- 대기인가"를 알 수 없어서 화면에 무엇을 띄울지 정하지 못한다. 관리자는 대기자
-- 전원을 봐야 한다(is_approved()가 관리자를 통과시킨다).
alter policy profiles_select on public.profiles
  using (id = auth.uid() or public.is_approved());

-- 쓰기는 본인 행이면 승인 전에도 허용한다 — ensureMyProfile이 가입 순간에 이름·
-- 사진을 채운다. 그걸 막으면 승인 화면에 이름조차 못 띄운다. (profiles_insert /
-- profiles_update는 이미 본인 행 조건이라 그대로 둔다.)

-- 관리자가 남의 approved를 바꿀 수 있어야 한다. 같은 명령의 정책이 여럿이면
-- OR로 합쳐지므로 본인 행 정책은 그대로 남는다.
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- ── 5. admins를 화면에서 다룰 수 있게 연다 ─────────────────────────────────
-- 0001은 admins에 정책을 하나도 두지 않았다(= 일반 접근 전면 차단).
-- is_admin()이 security definer라 RLS를 우회해 읽으므로 DB는 그대로 돌지만,
-- 화면에서 관리자를 지정·해제하려면 관리자에게만 열어야 한다.
-- 자기 자신을 지우는 것은 막는다 — 마지막 관리자가 스스로를 지우면 되돌릴 길이 없다.
drop policy if exists admins_select on public.admins;
drop policy if exists admins_insert on public.admins;
drop policy if exists admins_delete on public.admins;
create policy admins_select on public.admins
  for select using (public.is_admin());
create policy admins_insert on public.admins
  for insert with check (public.is_admin());
create policy admins_delete on public.admins
  for delete using (
    public.is_admin()
    and lower(email) <> lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- ── 6. 승인 요청 알림 ──────────────────────────────────────────────────────
-- 대기가 생겨도 아무도 모르면 기다리는 사람은 영영 기다린다.
-- 0017이 가르쳐 준 대로 **체크 제약과 INSERT 정책을 같이** 본다.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'assign', 'due_soon', 'approval'));

-- approval은 사람이 만드는 알림이 아니다(가입 순간 트리거가 만든다).
-- 그래서 INSERT 정책(`notifications_insert_authenticated`)에는 **넣지 않는다** —
-- 넣어 두면 로그인 사용자가 관리자에게 가짜 승인 요청을 보낼 수 있다.
-- due_soon을 뺀 것과 같은 판단이다.

-- 새 프로필이 생기면(=가입) 관리자 전원에게 알림 한 건씩.
-- **컬럼 이름을 짐작하지 않는다**: 수신자는 `recipient_id`(user_id 아님)이고
-- 프로필의 이름 컬럼은 `display_name`(name 아님)이며, profiles에는 email이 없어서
-- 관리자를 찾으려면 auth.users를 거쳐야 한다. 첫 판은 셋 다 틀렸고, 함수가
-- 예외를 삼키는 구조라 **알림이 조용히 한 건도 안 생겼을 것이다.**
create or replace function public.notify_admins_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.approved then return new; end if;   -- 백필·관리자 직접 추가는 조용히
  insert into public.notifications (recipient_id, kind, actor_name)
  select p.id, 'approval', left(coalesce(new.display_name, '새로 오신 분'), 100)
  from public.profiles p
  join auth.users u on u.id = p.id
  join public.admins a on lower(a.email) = lower(u.email)
  where p.id <> new.id;
  return new;
exception when others then
  -- 알림이 실패해도 가입 자체는 되어야 한다
  return new;
end $$;

drop trigger if exists trg_notify_admins_on_signup on public.profiles;
create trigger trg_notify_admins_on_signup
  after insert on public.profiles
  for each row execute function public.notify_admins_on_signup();

-- ── 확인 ───────────────────────────────────────────────────────────────────
--   select count(*) filter (where approved) as 승인, count(*) as 전체 from profiles;
--   -- 15 / 15 여야 한다(백필)
--   select tablename, policyname, cmd, qual from pg_policies
--     where schemaname='public' and qual like '%is_approved%' order by tablename;
--   -- projects·cards·comments·files·resource_links·teams·card_teams·
--   -- card_assignees·profile_teams·activity 전부 걸려 있어야 한다
--   select email from admins;
--   -- 승인 안 된 사람으로 흉내내기(트랜잭션 안에서 → ROLLBACK)
--   begin;
--     set local role authenticated;
--     select set_config('request.jwt.claims', '{"sub":"<대기자 uuid>","email":"x@y.z"}', true);
--     select count(*) from cards;      -- 0이어야 한다
--     select count(*) from profiles;   -- 1이어야 한다(자기 행만)
--   rollback;

-- ── 되돌리기 ───────────────────────────────────────────────────────────────
-- drop trigger if exists trg_notify_admins_on_signup on public.profiles;
-- drop function if exists public.notify_admins_on_signup();
-- alter table public.notifications drop constraint if exists notifications_kind_check;
-- alter table public.notifications add constraint notifications_kind_check
--   check (kind in ('mention','reply','assign','due_soon'));
-- drop policy if exists profiles_update_admin on public.profiles;
-- drop policy if exists admins_select on public.admins;
-- drop policy if exists admins_insert on public.admins;
-- drop policy if exists admins_delete on public.admins;
-- alter policy profiles_select on public.profiles using (auth.role() = 'authenticated');
-- -- 감싼 조건을 걷어낸다: pg_policies에서 qual/with_check을 읽어
-- -- 'public.is_approved() AND (' 껍데기를 벗기면 된다. 손으로 하는 편이 안전하다.
-- drop function if exists public.is_approved();
-- alter table public.profiles drop column if exists approved,
--   drop column if exists approved_at, drop column if exists approved_by;
