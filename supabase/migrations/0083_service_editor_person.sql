-- 0083 — 주보 작성·발행에 **조준환 한 사람**을 더한다 (사용자 결정 2026-09-27)
-- ----------------------------------------------------------------------------
-- 규칙(찬양팀장 등)이 아니라 사람 하나라서 명단 칸을 새로 만들지 않고 명단 id를 적는다 —
-- 칸을 만들면 그 칸을 누가 고치는가가 또 경계가 된다. 앱 쪽 거울은 services/worship.js
-- `SERVICE_EDITOR_PEOPLE`(둘이 어긋나면 버튼만 서고 저장이 막힌다). 0045 본문에 한 줄을 더한 것이다.
create or replace function public.can_edit_service()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_admin()
      or public.has_role('president')
      or public.is_pastor()
      or exists (select 1 from public.people p
                 where p.id = public.my_person_id() and p.removed_at is null and '미디어팀' = any(p.teams))
      or public.my_person_id() = 'd2a6ea3d-aa9a-41ce-a6e8-7c43728402b0'::uuid;   -- 조준환
$$;

-- ── 되돌리기 (0045 본문) ──────────────────────────────────────────────────────
-- create or replace function public.can_edit_service()
-- returns boolean language sql stable security definer set search_path = public, pg_temp
-- as $$
--   select public.is_admin()
--       or public.has_role('president')
--       or public.is_pastor()
--       or exists (select 1 from public.people p
--                  where p.id = public.my_person_id() and p.removed_at is null and '미디어팀' = any(p.teams));
-- $$;
