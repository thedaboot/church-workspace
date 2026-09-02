-- ============================================================================
-- 0039 — v2 4차 피드백 (2026-09-02): 순 편성 자격 · 동아리 정보 수정 · 순모임 가이드
-- ----------------------------------------------------------------------------
-- · can_manage_sun(): 마스터 + 관리자 + 올해 리더순장. 사용자 결정 2026-09-02
--   ("순 편성은 마스터/관리자/리더순장만 우선") — 0035의 교역자가 빠지고 관리자가 들어온다.
--   정책들은 이 함수를 부르므로 함수만 갈아 끼우면 된다.
-- · groups_update(동아리): 마스터·관리자·그 동아리 리더가 이름·설명을 고친다(0035는 마스터+리더).
-- · sun_guides: 주보 한 건당 순모임 가이드 한 벌. AI가 템플릿(주일 본문 · 말씀 요약 ·
--   포인트 3 · 오늘의 나눔 질문 3)을 채우고 사람이 다듬어 저장한다(services/sunGuide.js).
--   만드는 사람 = can_manage_sun(), 보는 사람 = 순장(leads_any_sun) + 만드는 사람.
--   body는 화면이 한 덩이로 읽고 쓰는 값이라 jsonb 한 칸(HANDOFF §2-1).
-- ============================================================================

create or replace function public.can_manage_sun()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_master() or public.is_admin() or public.has_role('lead_sunjang');
$$;

drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update using (
    (type = 'sun' and public.can_manage_sun())
    or (type = 'club' and (public.is_admin() or leader_person_id = public.my_person_id()))
  ) with check (
    (type = 'sun' and public.can_manage_sun())
    or (type = 'club' and (public.is_admin() or leader_person_id = public.my_person_id()))
  );

create table if not exists public.sun_guides (
  service_id  uuid primary key references public.services(id) on delete cascade,
  body        jsonb not null default '{}'::jsonb,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.sun_guides enable row level security;
drop policy if exists sun_guides_select on public.sun_guides;
create policy sun_guides_select on public.sun_guides
  for select using (public.leads_any_sun() or public.can_manage_sun());
drop policy if exists sun_guides_write on public.sun_guides;
create policy sun_guides_write on public.sun_guides
  for all using (public.can_manage_sun()) with check (public.can_manage_sun());
