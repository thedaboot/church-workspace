-- ============================================================================
-- 0029 — 관리자 지정·해제는 마스터만 (사용자 결정 2026-08-26)
-- ----------------------------------------------------------------------------
-- 0028이 `admins`의 insert/delete/update를 `is_admin()`에 열어 두었다. 그러면
-- **관리자가 다른 관리자를 마음대로 만들고 지울 수 있다** — 권한이 스스로 번진다.
--
-- 사용자가 정한 경계:
--   · 마스터  : AI 기능(요약 고정·고치기) + 관리자 지정·해제
--   · 관리자  : 멤버 관리(가입 수락·환송) + 업무 삭제
--
-- 마스터를 마스터가 지정하는 것도 같은 정책으로 막힌다(update가 마스터 전용).
-- 자기 자신은 여전히 지울 수 없다(0022) — 마지막 관리자가 사라지는 것을 막는다.
-- ============================================================================

drop policy if exists admins_insert on public.admins;
drop policy if exists admins_update on public.admins;
drop policy if exists admins_delete on public.admins;

create policy admins_insert on public.admins
  for insert with check (public.is_master());
create policy admins_update on public.admins
  for update using (public.is_master()) with check (public.is_master());
create policy admins_delete on public.admins
  for delete using (
    public.is_master()
    and lower(email) <> lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- 목록 보기는 관리자 전체에 남긴다 — 누가 관리자인지는 관리자끼리 볼 수 있어야
-- '멤버 관리' 화면이 반쪽이 되지 않는다(고치는 것만 마스터다).

-- ── 확인 ───────────────────────────────────────────────────────────────────
--   select policyname, cmd, qual, with_check from pg_policies
--     where schemaname='public' and tablename='admins';

-- ── 되돌리기 ───────────────────────────────────────────────────────────────
-- drop policy if exists admins_insert on public.admins;
-- drop policy if exists admins_update on public.admins;
-- drop policy if exists admins_delete on public.admins;
-- create policy admins_insert on public.admins for insert with check (public.is_admin());
-- create policy admins_update on public.admins for update using (public.is_admin()) with check (public.is_admin());
-- create policy admins_delete on public.admins for delete using (
--   public.is_admin() and lower(email) <> lower(coalesce(auth.jwt() ->> 'email','')));
