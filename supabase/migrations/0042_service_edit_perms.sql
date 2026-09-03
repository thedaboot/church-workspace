-- ============================================================================
-- 0042 — 주보 작성·수정·삭제 자격 변경 (2026-09-03 사용자 결정)
-- ----------------------------------------------------------------------------
-- "주보는 회장, 미디어팀, 마스터/관리자만 수정·생성·삭제하고 나머지는 발행된 주보만 읽는다."
-- 0036의 마스터+교역자+회장에서 → 관리자(마스터 포함) + 회장 + **미디어팀**(명단 people.teams)으로.
-- 교역자는 빠진다. 정책(services_select·services_write)은 이 함수를 부르므로 함수만 갈아 끼운다.
-- ============================================================================
create or replace function public.can_edit_service()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_admin()
      or public.has_role('president')
      or exists (select 1 from public.people p
                 where p.id = public.my_person_id() and p.removed_at is null and '미디어팀' = any(p.teams));
$$;
