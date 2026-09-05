-- ============================================================================
-- 0045 — 자격 다섯 자리 손보기 (2026-09-05 사용자 결정)
-- ----------------------------------------------------------------------------
-- 사용자 결정 다섯을 한 번에 옮긴다. 전부 **함수·정책만** 바뀐다 — 표도 컬럼도 새로
-- 생기지 않는다. 정책들은 이 함수들을 부르므로 함수를 갈아 끼우면 그 자리가 다 따라온다
-- (0039·0042가 쓴 방식 그대로).
--
--  1. **주보에 교역자가 돌아온다.** 0042가 "회장 + 미디어팀 + 관리자"로 좁히면서 교역자를
--     뺐는데, 교역자도 주보를 쓴다는 결정이다. 0042의 세 갈래에 is_pastor()를 더한다.
--  2. **전체 출석 체크를 리더순장으로 좁힌다.** 지금은 is_officer() — "올해 people_roles
--     줄이 하나라도 있으면"이라 0043으로 갈라진 다섯 직분(부장·회장·총무·리더순장·
--     리더팀장)이 전부 전체 출석을 만졌다. 이제 관리자 + 교역자 + **리더순장**뿐이다.
--     순장이 자기 순을 만지는 길(leads_sun_of)은 그대로다.
--     → 딸린 자리 하나: people_insert(새신자 등록)가 이 함수를 부르므로 미등록 출석자를
--       그 자리에서 명단에 올릴 수 있는 사람도 같이 좁아진다(관리자·교역자·리더순장·순장).
--       출석을 못 하는 사람이 출석자를 만들 수는 없으니 이게 맞다.
--  3. **순 편성에 교역자를 넣는다.** 0035에 있던 is_pastor()가 0039에서 빠졌던 자리다
--     (그때 결정은 "마스터/관리자/리더순장만 **우선**"). 이제 넷이다.
--  4. **동아리 멤버 추가·제거를 관리자까지.** group_members_write의 동아리 갈래가
--     is_master()라 관리자는 이름·설명(groups_update는 0039에서 이미 is_admin())은 고치면서
--     사람은 못 넣었다. 그 두 자리의 경계를 맞춘다. 동아리 **개설·리더 지정**은
--     여전히 마스터만이다(groups_insert·groups_delete — 건드리지 않는다).
--  5. **묵상 삭제를 마스터에게 연다.** qt_entries_write는 `for all`에 본인 행만이라
--     남의 나눔은 아무도 못 지웠다. 지우는 정책 한 줄을 따로 더한다(permissive라 OR로
--     붙는다) — 공유 해제가 아니라 **그 사람의 그날 묵상 행 자체**가 없어진다.
--     화면(wordView 나눔 피드)도 마스터에게만 그 버튼을 보인다.
--
-- **is_officer()는 지우지 않는다.** 이 마이그레이션 뒤로 부르는 곳이 없지만(확인:
-- `grep -rn is_officer supabase src` → 주석·문서뿐), 함수를 지우면 되돌릴 때 다시 만들어야
-- 하고 되돌리는 SQL이 길어진다. 남겨 두되 **새로 쓰지는 않는다** — 0043이 직분을 다섯으로
-- 가른 뒤로 "줄이 있는가"만 보는 판정은 쓸 자리가 없다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 1. 주보 작성·발행·수정·삭제 = 관리자 + 회장 + 미디어팀 + 교역자 ─────────
-- (0042 본문에 is_pastor() 한 줄만 더한 것이다. services_select·services_write가 부른다)
create or replace function public.can_edit_service()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_admin()
      or public.has_role('president')
      or public.is_pastor()
      or exists (select 1 from public.people p
                 where p.id = public.my_person_id() and p.removed_at is null and '미디어팀' = any(p.teams));
$$;

-- ── 2. 전체 출석 체크 = 관리자 + 교역자 + 리더순장 ──────────────────────────
-- attendance_insert·attendance_delete·people_insert가 부른다.
create or replace function public.can_check_all_attendance()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_admin() or public.is_pastor() or public.has_role('lead_sunjang');
$$;

-- ── 3. 순 편성 = 마스터 + 관리자 + 리더순장 + 교역자 ────────────────────────
-- groups_insert·groups_update·groups_delete·group_members_write·sun_guides_*가 부른다.
-- is_master()를 남겨 두는 이유: 마스터는 admins의 한 행이라 is_admin()에 이미 포함되지만
-- 0035·0039가 둘을 나란히 적어 왔다(읽는 사람이 "마스터는 되는가"를 안 되짚게).
create or replace function public.can_manage_sun()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_master() or public.is_admin() or public.is_pastor()
      or public.has_role('lead_sunjang');
$$;

-- ── 4. 동아리 멤버 추가·제거 = 관리자(마스터 포함) + 그 동아리장 ────────────
-- 순 갈래는 그대로다. 동아리 갈래의 is_master()만 is_admin()으로.
drop policy if exists group_members_write on public.group_members;
create policy group_members_write on public.group_members
  for all using (
    exists (
      select 1 from public.groups g where g.id = group_id and (
        (g.type = 'sun' and public.can_manage_sun())
        or (g.type = 'club' and (public.is_admin() or g.leader_person_id = public.my_person_id()))
      )
    )
  ) with check (
    exists (
      select 1 from public.groups g where g.id = group_id and (
        (g.type = 'sun' and public.can_manage_sun())
        or (g.type = 'club' and (public.is_admin() or g.leader_person_id = public.my_person_id()))
      )
    )
  );

-- 동아리 이름·설명(groups_update)은 0039가 이미 is_admin()이다 — 여기서 손대지 않는다.
-- 확인만 하고 어긋나면 멈춘다(정책 본문이 조용히 옛것으로 돌아가 있으면 여기서 걸린다).
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'groups' and policyname = 'groups_update'
      and qual like '%is_admin()%'
  ) then
    raise exception 'groups_update의 동아리 갈래가 is_admin()이 아닙니다 — 0039를 확인하세요';
  end if;
end $$;

-- ── 5. 묵상(qt_entries) 삭제를 마스터도 ─────────────────────────────────────
-- qt_entries_write(본인 행 for all)는 그대로 두고 삭제 한 줄만 더한다. permissive 정책은
-- OR로 붙으므로 본인 삭제 · 마스터 삭제 둘 다 통과한다.
drop policy if exists qt_entries_delete_master on public.qt_entries;
create policy qt_entries_delete_master on public.qt_entries
  for delete using (public.is_master());

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select proname, pg_get_functiondef(oid) from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('can_edit_service','can_check_all_attendance','can_manage_sun');
--   select tablename, policyname, cmd, qual from pg_policies
--    where schemaname='public' and tablename in ('group_members','qt_entries') order by 1,2;
--   -- 마스터가 아닌 사람은 남의 묵상을 못 지운다(0022 방식 — 트랜잭션 + rollback):
--   --   begin; set local role authenticated;
--   --   select set_config('request.jwt.claims', '{"sub":"<일반 멤버 uuid>","email":"x@y.z"}', true);
--   --   delete from qt_entries where profile_id <> auth.uid();   -- 0행
--   --   rollback;

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- create or replace function public.can_edit_service()
-- returns boolean language sql stable security definer set search_path = public, pg_temp
-- as $$
--   select public.is_admin()
--       or public.has_role('president')
--       or exists (select 1 from public.people p
--                  where p.id = public.my_person_id() and p.removed_at is null and '미디어팀' = any(p.teams));
-- $$;
-- create or replace function public.can_check_all_attendance()
-- returns boolean language sql stable security definer set search_path = public, pg_temp
-- as $$ select public.is_admin() or public.is_pastor() or public.is_officer(); $$;
-- create or replace function public.can_manage_sun()
-- returns boolean language sql stable security definer set search_path = public, pg_temp
-- as $$ select public.is_master() or public.is_admin() or public.has_role('lead_sunjang'); $$;
-- drop policy if exists group_members_write on public.group_members;
-- create policy group_members_write on public.group_members
--   for all using (
--     exists (select 1 from public.groups g where g.id = group_id and (
--       (g.type = 'sun' and public.can_manage_sun())
--       or (g.type = 'club' and (public.is_master() or g.leader_person_id = public.my_person_id()))))
--   ) with check (
--     exists (select 1 from public.groups g where g.id = group_id and (
--       (g.type = 'sun' and public.can_manage_sun())
--       or (g.type = 'club' and (public.is_master() or g.leader_person_id = public.my_person_id()))))
--   );
-- drop policy if exists qt_entries_delete_master on public.qt_entries;
-- commit;
