-- ============================================================================
-- 0122 — 총무도 모든 동아리의 모임·활동 보고서를 다룬다 (사용자 결정 2026-10-22)
-- ----------------------------------------------------------------------------
-- 총무(조해리)가 지난 동아리 보고서를 모두 올린다 — 올릴 모임이 아직 없으면 모임부터 만들어야 해서
-- 모임(만들기 · 지우기 · 출석)과 보고서(파일 칸 0093 · 작성 화면 0117 · 사진 버킷)를 같이 연다.
-- 동아리 명단 · 이름 · 신청 수락은 그대로(관리자 · 그 동아리장).
--
--   can_edit_meeting(meeting)   + 올해 총무 · **동아리 모임만**(순 모임은 아니다) — 0093·0117의 정책이 모두 이 함수를 부른다
--   group_meetings_write        + 올해 총무 · 동아리만
-- 앱: services/groups.canMeetClub · components/clubDetail(모임 구역) · api/drive.mayGrantEditors(구글 사본 편집자).
-- 순서: 이 마이그레이션 → 코드(코드가 먼저 나가면 총무가 누른 저장이 RLS로 실패 토스트 — 오류 화면은 없다).
-- ============================================================================

begin;

create or replace function public.can_edit_meeting(p_meeting uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_admin() or exists (
    select 1 from public.group_meetings m
    join public.groups g on g.id = m.group_id
    where m.id = p_meeting
      and (g.leader_person_id = public.my_person_id() or (g.type = 'club' and public.has_role('treasurer')))
  );
$$;

alter policy group_meetings_write on public.group_meetings
  using ((select public.is_admin()) or exists (
    select 1 from public.groups g
    where g.id = group_meetings.group_id
      and (g.leader_person_id = (select public.my_person_id()) or (g.type = 'club' and (select public.has_role('treasurer'))))))
  with check ((select public.is_admin()) or exists (
    select 1 from public.groups g
    where g.id = group_meetings.group_id
      and (g.leader_person_id = (select public.my_person_id()) or (g.type = 'club' and (select public.has_role('treasurer'))))));

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   리허설(begin … rollback): 총무 claims로 다른 동아리에 모임 insert · club_reports upsert 통과 ·
--   순 모임 insert는 42501 · 일반 청년 claims로 동아리 모임 insert는 42501
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   can_edit_meeting은 0093 본문으로, group_meetings_write는 총무 줄을 뺀 위 식으로 다시 alter.
