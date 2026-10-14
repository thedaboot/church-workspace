-- ============================================================================
-- 0102 — 정책은 로그인한 사람에게만 · 판정 함수 14개의 익명 EXECUTE 회수 (2026-10-14 · advisors 후속)
-- ----------------------------------------------------------------------------
-- 동작은 바꾸지 않는다. 0101이 남긴 경고 'anon이 security definer 함수를 부를 수 있다'(14)를 걷는다.
-- ① public 스키마에서 `to public`(익명 포함)이던 정책 108개를 `to authenticated`로 — 식은 그대로(0101 꼴).
--    익명은 원래 어떤 행도 못 봤다(판정 함수가 익명에게 늘 false · hidden_ids·effective_uid는 이미 익명 회수라 몇 표는
--    오류였다). 이제 익명에게는 걸리는 정책이 없어 RLS가 빈 결과를 준다 — 판정 함수를 부르지도 않는다.
-- ② 판정 함수 14개에서 public·anon EXECUTE를 걷는다(effective_uid · hidden_ids와 같은 꼴). authenticated · service_role은 그대로.
--    앱이 이 함수를 rpc로 부르는 곳(auth.jsx 자격 묻기 · api/ai.js 다붓이)은 모두 로그인한 세션이다.
-- 정책 수·이름·명령·식은 그대로다(§6-31-a) — 바뀌는 것은 대상 역할뿐. 다른 스키마(storage·realtime·cron)는 건드리지 않는다.
-- ============================================================================
begin;

-- ② 판정 함수 — 로그인한 사람·서버 키만
revoke execute on function
  public.can_check_all_attendance(), public.can_edit_meeting(uuid), public.can_edit_service(), public.can_manage_sun(),
  public.has_role(text), public.is_admin(), public.is_approved(), public.is_master(), public.is_officer(), public.is_pastor(),
  public.leads_any_sun(), public.leads_sun_of(uuid), public.my_person_id(), public.same_sun(uuid)
  from public, anon;
grant execute on function
  public.can_check_all_attendance(), public.can_edit_meeting(uuid), public.can_edit_service(), public.can_manage_sun(),
  public.has_role(text), public.is_admin(), public.is_approved(), public.is_master(), public.is_officer(), public.is_pastor(),
  public.leads_any_sun(), public.leads_sun_of(uuid), public.my_person_id(), public.same_sun(uuid)
  to authenticated, service_role;

-- ① 정책 108개 — 대상 역할만 authenticated로
alter policy activity_insert on public.activity to authenticated;
alter policy activity_select on public.activity to authenticated;
alter policy admins_delete on public.admins to authenticated;
alter policy admins_insert on public.admins to authenticated;
alter policy admins_select on public.admins to authenticated;
alter policy admins_update on public.admins to authenticated;
alter policy attendance_delete on public.attendance to authenticated;
alter policy attendance_insert on public.attendance to authenticated;
alter policy attendance_select on public.attendance to authenticated;
alter policy attendance_guests_delete on public.attendance_guests to authenticated;
alter policy attendance_guests_insert on public.attendance_guests to authenticated;
alter policy attendance_guests_select on public.attendance_guests to authenticated;
alter policy bible_search_cache_delete on public.bible_search_cache to authenticated;
alter policy bible_search_cache_insert on public.bible_search_cache to authenticated;
alter policy bible_search_cache_select on public.bible_search_cache to authenticated;
alter policy bible_state_own on public.bible_state to authenticated;
alter policy bible_vec_select on public.bible_vec to authenticated;
alter policy calendar_feeds_select on public.calendar_feeds to authenticated;
alter policy card_assignees_delete on public.card_assignees to authenticated;
alter policy card_assignees_insert on public.card_assignees to authenticated;
alter policy card_assignees_select on public.card_assignees to authenticated;
alter policy card_assignees_update on public.card_assignees to authenticated;
alter policy card_doc_updates_insert on public.card_doc_updates to authenticated;
alter policy card_doc_updates_select on public.card_doc_updates to authenticated;
alter policy card_doc_versions_insert on public.card_doc_versions to authenticated;
alter policy card_doc_versions_select on public.card_doc_versions to authenticated;
alter policy card_docs_select on public.card_docs to authenticated;
alter policy card_teams_delete on public.card_teams to authenticated;
alter policy card_teams_insert on public.card_teams to authenticated;
alter policy card_teams_select on public.card_teams to authenticated;
alter policy card_teams_update on public.card_teams to authenticated;
alter policy cards_delete on public.cards to authenticated;
alter policy cards_insert on public.cards to authenticated;
alter policy cards_select on public.cards to authenticated;
alter policy cards_update on public.cards to authenticated;
alter policy club_applications_delete on public.club_applications to authenticated;
alter policy club_applications_insert on public.club_applications to authenticated;
alter policy club_applications_select on public.club_applications to authenticated;
alter policy club_applications_update on public.club_applications to authenticated;
alter policy comment_reactions_delete on public.comment_reactions to authenticated;
alter policy comment_reactions_insert on public.comment_reactions to authenticated;
alter policy comment_reactions_select on public.comment_reactions to authenticated;
alter policy comments_delete on public.comments to authenticated;
alter policy comments_insert on public.comments to authenticated;
alter policy comments_select on public.comments to authenticated;
alter policy comments_update on public.comments to authenticated;
alter policy dabooti_facts_delete on public.dabooti_facts to authenticated;
alter policy dabooti_facts_insert on public.dabooti_facts to authenticated;
alter policy dabooti_facts_select on public.dabooti_facts to authenticated;
alter policy dabooti_facts_update on public.dabooti_facts to authenticated;
alter policy doc_vec_select on public.doc_vec to authenticated;
alter policy files_delete on public.files to authenticated;
alter policy files_insert on public.files to authenticated;
alter policy files_meeting_guard_delete on public.files to authenticated;
alter policy files_meeting_guard_insert on public.files to authenticated;
alter policy files_meeting_guard_update on public.files to authenticated;
alter policy files_meeting_select on public.files to authenticated;
alter policy files_meeting_write on public.files to authenticated;
alter policy files_select on public.files to authenticated;
alter policy files_update on public.files to authenticated;
alter policy group_meetings_select on public.group_meetings to authenticated;
alter policy group_meetings_write on public.group_meetings to authenticated;
alter policy group_members_select on public.group_members to authenticated;
alter policy group_members_sun_leader_insert on public.group_members to authenticated;
alter policy group_members_write on public.group_members to authenticated;
alter policy groups_delete on public.groups to authenticated;
alter policy groups_insert on public.groups to authenticated;
alter policy groups_select on public.groups to authenticated;
alter policy groups_update on public.groups to authenticated;
alter policy people_delete on public.people to authenticated;
alter policy people_insert on public.people to authenticated;
alter policy people_select on public.people to authenticated;
alter policy people_update on public.people to authenticated;
alter policy people_roles_select on public.people_roles to authenticated;
alter policy people_roles_write on public.people_roles to authenticated;
alter policy "profile_teams read" on public.profile_teams to authenticated;
alter policy "profile_teams write own" on public.profile_teams to authenticated;
alter policy profiles_insert on public.profiles to authenticated;
alter policy profiles_select on public.profiles to authenticated;
alter policy profiles_update on public.profiles to authenticated;
alter policy profiles_update_admin on public.profiles to authenticated;
alter policy projects_delete on public.projects to authenticated;
alter policy projects_insert on public.projects to authenticated;
alter policy projects_select on public.projects to authenticated;
alter policy projects_update on public.projects to authenticated;
alter policy qt_entries_delete_master on public.qt_entries to authenticated;
alter policy qt_entries_select on public.qt_entries to authenticated;
alter policy qt_entries_write on public.qt_entries to authenticated;
alter policy qt_schedule_select on public.qt_schedule to authenticated;
alter policy qt_schedule_write on public.qt_schedule to authenticated;
alter policy resource_links_delete on public.resource_links to authenticated;
alter policy resource_links_insert on public.resource_links to authenticated;
alter policy resource_links_select on public.resource_links to authenticated;
alter policy resource_links_update on public.resource_links to authenticated;
alter policy service_notes_select on public.service_notes to authenticated;
alter policy service_notes_write on public.service_notes to authenticated;
alter policy services_select on public.services to authenticated;
alter policy services_write on public.services to authenticated;
alter policy sun_guide_finals_select on public.sun_guide_finals to authenticated;
alter policy sun_guides_select on public.sun_guides to authenticated;
alter policy sun_guides_write on public.sun_guides to authenticated;
alter policy teams_insert on public.teams to authenticated;
alter policy teams_select on public.teams to authenticated;
alter policy teams_update on public.teams to authenticated;
alter policy wiki_edits_insert on public.wiki_edits to authenticated;
alter policy wiki_edits_select on public.wiki_edits to authenticated;
alter policy wiki_edits_update on public.wiki_edits to authenticated;
alter policy wiki_pages_select on public.wiki_pages to authenticated;

commit;
