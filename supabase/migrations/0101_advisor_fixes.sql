-- ============================================================================
-- 0101 — Supabase 점검(advisors) 보완 (2026-10-14)
-- ----------------------------------------------------------------------------
-- 동작은 바꾸지 않는다. 권한 위생 둘 + 함수 search_path 셋 + 정책 116개를 같은 뜻의 빠른 꼴로.
-- ① 트리거·이벤트 트리거 함수(security definer 12개)는 RPC로 부를 일이 없다 → anon·authenticated의
--    EXECUTE를 걷는다. 트리거는 발동할 때 EXECUTE 권한을 보지 않으므로 그대로 돈다.
-- ② reorder_clubs는 로그인한 사람만 부른다(안에서 is_approved()로 거르지만 anon까지 열어 둘 이유가 없다).
--    정책 판정 함수(is_admin·is_approved·can_see_card …)는 anon에게도 남긴다 — 정책 대부분이 `to public`이라
--    걷으면 anon 요청이 빈 결과 대신 권한 오류가 난다. 익명에게는 늘 false라 새는 것도 없다.
-- ③ search_path가 비어 있던 함수 셋(is_roster_team · kst_year · touch_last_seen)에 public, pg_temp를 박는다.
-- ④ 정책 116개(119개 중) — 정책 안의 auth.uid()·auth.role()·auth.jwt()와 인자 없는 판정 함수(is_approved · is_admin ·
--    is_master · effective_uid · my_person_id …, 모두 STABLE · 호출한 사람만 본다)를 (select …)로 감싸 행마다가 아니라
--    쿼리마다 한 번 계산하게 한다(advisor auth_rls_initplan). 뜻은 같다. 실측: 승인 회원의 activity 최근 200개
--    383ms — is_approved()가 1,658행마다 프로필을 다시 읽었다. hidden_ids()·locked_hidden_ids()는 이미 감싸져 있었다.
--    0100까지 라이브의 pg_policies에서 기계로 만든 alter policy라 정책 수·이름·대상 역할·명령은 그대로다(§6-31-a).
-- 안 한 것: 여러 permissive 정책 합치기(80 · 뜻이 바뀔 수 있어 설계가 필요) · 외래 키 색인(32 · 작은 표 · 정보) ·
--   정책 없는 RLS 표 셋(card_unlock_tries·dabooti_evals·dabooti_questions — 서버 키 전용이라 의도) ·
--   유출 비밀번호 보호(비밀번호 로그인을 쓰지 않는다 · 대시보드 설정).
-- ============================================================================
begin;

-- ① 트리거 함수
revoke execute on function
  public.blank_locked_preview(), public.handle_new_user(), public.keep_sun_guide_final(),
  public.notifications_actor_name(), public.notify_admins_on_signup(), public.rls_auto_enable(),
  public.services_stamp_published(), public.sync_pastor_team(), public.sync_person_birthday(),
  public.sync_person_teams(), public.sync_profile_email(), public.tg_recount_card()
  from public, anon, authenticated;

-- ② 로그인한 사람만
revoke execute on function public.reorder_clubs(uuid[]) from public, anon;
grant execute on function public.reorder_clubs(uuid[]) to authenticated;

-- ③ search_path
alter function public.is_roster_team(text) set search_path = public, pg_temp;
alter function public.kst_year() set search_path = public, pg_temp;
alter function public.touch_last_seen() set search_path = public, pg_temp;

-- ④ 정책 116개 — 판정 호출을 (select …)로
alter policy activity_insert on public.activity
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND ((actor_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin())) AND COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy activity_select on public.activity
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy admins_delete on public.admins
  using (((select is_master()) AND (lower(email) <> lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text)))));
alter policy admins_insert on public.admins
  with check ((select is_master()));
alter policy admins_select on public.admins
  using ((select is_admin()));
alter policy admins_update on public.admins
  using ((select is_master()))
  with check ((select is_master()));
alter policy attendance_delete on public.attendance
  using (((select is_approved()) AND ((select can_check_all_attendance()) OR leads_sun_of(person_id))));
alter policy attendance_insert on public.attendance
  with check (((select is_approved()) AND ((select can_check_all_attendance()) OR leads_sun_of(person_id))));
alter policy attendance_select on public.attendance
  using ((select is_approved()));
alter policy attendance_guests_delete on public.attendance_guests
  using (((select is_approved()) AND ((select can_check_all_attendance()) OR (select leads_any_sun()))));
alter policy attendance_guests_insert on public.attendance_guests
  with check (((select is_approved()) AND ((select can_check_all_attendance()) OR (select leads_any_sun())) AND (EXISTS ( SELECT 1
   FROM services s
  WHERE ((s.id = attendance_guests.service_id) AND (s.status = 'published'::text))))));
alter policy attendance_guests_select on public.attendance_guests
  using ((select is_approved()));
alter policy bible_search_cache_delete on public.bible_search_cache
  using ((select is_master()));
alter policy bible_search_cache_insert on public.bible_search_cache
  with check ((select is_approved()));
alter policy bible_search_cache_select on public.bible_search_cache
  using ((select is_approved()));
alter policy bible_state_own on public.bible_state
  using ((profile_id = (select effective_uid())))
  with check (((profile_id = (select effective_uid())) AND (select is_approved())));
alter policy bible_vec_select on public.bible_vec
  using ((select is_approved()));
alter policy calendar_feeds_select on public.calendar_feeds
  using ((owner = (select effective_uid())));
alter policy card_assignees_delete on public.card_assignees
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy card_assignees_insert on public.card_assignees
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy card_assignees_select on public.card_assignees
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy card_assignees_update on public.card_assignees
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)))
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy card_doc_updates_insert on public.card_doc_updates
  with check (((select is_approved()) AND (by = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy card_doc_updates_select on public.card_doc_updates
  using (((select is_approved()) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy card_doc_versions_insert on public.card_doc_versions
  with check (((select is_approved()) AND (by = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy card_doc_versions_select on public.card_doc_versions
  using (((select is_approved()) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy card_docs_select on public.card_docs
  using (((select is_approved()) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy card_secrets_select on public.card_secrets
  using (((select is_approved()) AND can_open_card(card_id)));
alter policy card_secrets_update on public.card_secrets
  using (((select is_approved()) AND can_open_card(card_id)))
  with check (((select is_approved()) AND can_open_card(card_id)));
alter policy card_teams_delete on public.card_teams
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy card_teams_insert on public.card_teams
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy card_teams_select on public.card_teams
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy card_teams_update on public.card_teams
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)))
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy card_unlocks_select on public.card_unlocks
  using ((profile_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])));
alter policy cards_delete on public.cards
  using (((select is_approved()) AND ((created_by = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin())) AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy cards_insert on public.cards
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND ((created_by = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin())) AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy cards_select on public.cards
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy cards_update on public.cards
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)))
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy club_applications_delete on public.club_applications
  using (((person_id = (select my_person_id())) OR (select is_master())));
alter policy club_applications_insert on public.club_applications
  with check (((select is_approved()) AND (person_id = (select my_person_id()))));
alter policy club_applications_select on public.club_applications
  using (((person_id = (select my_person_id())) OR (select is_admin()) OR (EXISTS ( SELECT 1
   FROM groups g
  WHERE ((g.id = club_applications.group_id) AND (g.leader_person_id = (select my_person_id())))))));
alter policy club_applications_update on public.club_applications
  using (((select is_master()) OR (EXISTS ( SELECT 1
   FROM groups g
  WHERE ((g.id = club_applications.group_id) AND (g.leader_person_id = (select my_person_id())))))));
alter policy comment_reactions_delete on public.comment_reactions
  using (((user_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) AND COALESCE((comment_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((comment_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy comment_reactions_insert on public.comment_reactions
  with check (((select is_approved()) AND (user_id = (select effective_uid())) AND COALESCE((comment_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((comment_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy comment_reactions_select on public.comment_reactions
  using (((select is_approved()) AND COALESCE((comment_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((comment_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy comments_delete on public.comments
  using (((select is_approved()) AND ((author_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin())) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy comments_insert on public.comments
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND ((author_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin())) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy comments_select on public.comments
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy comments_update on public.comments
  using (((select is_approved()) AND ((author_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin())) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)))
  with check (((select is_approved()) AND ((author_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin())) AND COALESCE((card_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy dabooti_facts_delete on public.dabooti_facts
  using ((select is_master()));
alter policy dabooti_facts_insert on public.dabooti_facts
  with check ((select is_master()));
alter policy dabooti_facts_select on public.dabooti_facts
  using ((select is_master()));
alter policy dabooti_facts_update on public.dabooti_facts
  using ((select is_master()))
  with check ((select is_master()));
alter policy doc_vec_select on public.doc_vec
  using (((select is_approved()) AND COALESCE((COALESCE(card_id, comment_id, file_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((COALESCE(card_id, comment_id, file_id) <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)));
alter policy files_delete on public.files
  using (((select is_approved()) AND
CASE
    WHEN (service_id IS NULL) THEN (COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true) AND ((uploaded_by = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin())))
    ELSE (select can_edit_service())
END));
alter policy files_insert on public.files
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND (((service_id IS NULL) AND COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)) OR (select can_edit_service())) AND ((uploaded_by = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin()))));
alter policy files_meeting_select on public.files
  using (((meeting_id IS NOT NULL) AND (select is_approved()) AND ((select auth.role()) = 'authenticated'::text)));
alter policy files_meeting_write on public.files
  using (((meeting_id IS NOT NULL) AND (select is_approved()) AND can_edit_meeting(meeting_id)))
  with check (((meeting_id IS NOT NULL) AND (select is_approved()) AND can_edit_meeting(meeting_id)));
alter policy files_select on public.files
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND (((service_id IS NULL) AND COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)) OR (EXISTS ( SELECT 1
   FROM services s
  WHERE ((s.id = files.service_id) AND ((s.status = 'published'::text) OR (select can_edit_service()))))))));
alter policy files_update on public.files
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND (((service_id IS NULL) AND COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)) OR (select can_edit_service()))))
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND (((service_id IS NULL) AND COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true) AND COALESCE((card_id <> ALL (( SELECT locked_hidden_ids() AS locked_hidden_ids)::uuid[])), true)) OR (select can_edit_service()))));
alter policy group_meetings_select on public.group_meetings
  using ((select is_approved()));
alter policy group_meetings_write on public.group_meetings
  using (((select is_admin()) OR (EXISTS ( SELECT 1
   FROM groups g
  WHERE ((g.id = group_meetings.group_id) AND (g.leader_person_id = (select my_person_id())))))))
  with check (((select is_admin()) OR (EXISTS ( SELECT 1
   FROM groups g
  WHERE ((g.id = group_meetings.group_id) AND (g.leader_person_id = (select my_person_id())))))));
alter policy group_members_select on public.group_members
  using ((select is_approved()));
alter policy group_members_sun_leader_insert on public.group_members
  with check (((select is_approved()) AND (select leads_any_sun()) AND (EXISTS ( SELECT 1
   FROM groups g
  WHERE ((g.id = group_members.group_id) AND (g.type = 'sun'::text) AND (g.year = (select kst_year())) AND (g.removed_at IS NULL) AND (g.leader_person_id = (select my_person_id())))))));
alter policy group_members_write on public.group_members
  using ((EXISTS ( SELECT 1
   FROM groups g
  WHERE ((g.id = group_members.group_id) AND (((g.type = 'sun'::text) AND (select can_manage_sun())) OR ((g.type = 'club'::text) AND ((select is_admin()) OR (g.leader_person_id = (select my_person_id())))))))))
  with check ((EXISTS ( SELECT 1
   FROM groups g
  WHERE ((g.id = group_members.group_id) AND (((g.type = 'sun'::text) AND (select can_manage_sun())) OR ((g.type = 'club'::text) AND ((select is_admin()) OR (g.leader_person_id = (select my_person_id())))))))));
alter policy groups_delete on public.groups
  using ((((type = 'sun'::text) AND (select can_manage_sun())) OR ((type = 'club'::text) AND (select is_master()))));
alter policy groups_insert on public.groups
  with check ((((type = 'sun'::text) AND (select can_manage_sun())) OR ((type = 'club'::text) AND (select is_master()))));
alter policy groups_select on public.groups
  using ((select is_approved()));
alter policy groups_update on public.groups
  using ((((type = 'sun'::text) AND (select can_manage_sun())) OR ((type = 'club'::text) AND ((select is_admin()) OR (leader_person_id = (select my_person_id()))))))
  with check ((((type = 'sun'::text) AND (select can_manage_sun())) OR ((type = 'club'::text) AND ((select is_admin()) OR (leader_person_id = (select my_person_id()))))));
alter policy notifications_delete_own on public.notifications
  using ((recipient_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])));
alter policy notifications_insert_authenticated on public.notifications
  with check (((select is_approved()) AND ((kind = ANY (ARRAY['mention'::text, 'reply'::text, 'assign'::text, 'reaction'::text, 'service_published'::text, 'note_shared'::text, 'club_apply'::text, 'club_accepted'::text, 'meeting_new'::text, 'guide_pinned'::text])) OR ((kind = 'approved'::text) AND (select is_admin()))) AND ((preview IS NULL) OR (char_length(preview) <= 200)) AND (char_length(actor_name) <= 100)));
alter policy notifications_select_own on public.notifications
  using ((recipient_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])));
alter policy notifications_update_own on public.notifications
  using ((recipient_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])))
  with check ((recipient_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])));
alter policy people_delete on public.people
  using ((select is_admin()));
alter policy people_insert on public.people
  with check (((select is_admin()) OR ((select is_approved()) AND ((select can_check_all_attendance()) OR (select leads_any_sun())) AND (NOT is_pastor) AND (profile_id IS NULL))));
alter policy people_select on public.people
  using ((select is_approved()));
alter policy people_update on public.people
  using ((select is_admin()))
  with check ((select is_admin()));
alter policy people_roles_select on public.people_roles
  using ((select is_approved()));
alter policy people_roles_write on public.people_roles
  using ((select is_admin()))
  with check ((select is_admin()));
alter policy "profile_teams read" on public.profile_teams
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)));
alter policy "profile_teams write own" on public.profile_teams
  using (((select is_approved()) AND (profile_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())]))))
  with check (((select is_approved()) AND (profile_id = (select effective_uid()))));
alter policy profiles_insert on public.profiles
  with check ((id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])));
alter policy profiles_select on public.profiles
  using (((id = (select auth.uid())) OR (select is_approved())));
alter policy profiles_update on public.profiles
  using ((id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])))
  with check ((id = (select effective_uid())));
alter policy profiles_update_admin on public.profiles
  using ((select is_admin()))
  with check ((select is_admin()));
alter policy projects_delete on public.projects
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader))));
alter policy projects_insert on public.projects
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)));
alter policy projects_select on public.projects
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader))));
alter policy projects_update on public.projects
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader))))
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader))));
alter policy push_subscriptions_delete_own on public.push_subscriptions
  using ((profile_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])));
alter policy push_subscriptions_insert_own on public.push_subscriptions
  with check ((profile_id = (select effective_uid())));
alter policy push_subscriptions_select_own on public.push_subscriptions
  using ((profile_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])));
alter policy push_subscriptions_update_own on public.push_subscriptions
  using ((profile_id = ANY (ARRAY[(select auth.uid()), (select effective_uid())])))
  with check ((profile_id = (select effective_uid())));
alter policy qt_entries_delete_master on public.qt_entries
  using ((select is_master()));
alter policy qt_entries_select on public.qt_entries
  using (((profile_id = (select effective_uid())) OR (shared AND (select is_approved()))));
alter policy qt_entries_write on public.qt_entries
  using (((profile_id = (select effective_uid())) AND (select is_approved())))
  with check (((profile_id = (select effective_uid())) AND (select is_approved())));
alter policy qt_schedule_select on public.qt_schedule
  using ((select is_approved()));
alter policy qt_schedule_write on public.qt_schedule
  using ((select is_master()))
  with check ((select is_master()));
alter policy resource_links_delete on public.resource_links
  using (((select is_approved()) AND ((created_by = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin())) AND COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy resource_links_insert on public.resource_links
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy resource_links_select on public.resource_links
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy resource_links_update on public.resource_links
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)))
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((COALESCE(card_id, project_id) <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
alter policy service_notes_select on public.service_notes
  using (((profile_id = (select effective_uid())) OR (shared_to_sun AND (select is_approved()) AND same_sun(profile_id))));
alter policy service_notes_write on public.service_notes
  using (((profile_id = (select effective_uid())) AND (select is_approved())))
  with check (((profile_id = (select effective_uid())) AND (select is_approved())));
alter policy services_select on public.services
  using (((select is_approved()) AND ((status = 'published'::text) OR (select can_edit_service()))));
alter policy services_write on public.services
  using (((select is_approved()) AND (select can_edit_service())))
  with check (((select is_approved()) AND (select can_edit_service())));
alter policy sun_guide_finals_select on public.sun_guide_finals
  using (((select is_approved()) AND ((select leads_any_sun()) OR (select can_manage_sun()))));
alter policy sun_guides_select on public.sun_guides
  using (((select is_approved()) AND ((select leads_any_sun()) OR (select can_manage_sun()))));
alter policy sun_guides_write on public.sun_guides
  using (((select is_approved()) AND ((select can_manage_sun()) OR (select leads_any_sun())) AND ((NOT pinned) OR (select is_master()))))
  with check (((select is_approved()) AND ((select can_manage_sun()) OR (select leads_any_sun())) AND ((NOT pinned) OR (select is_master()))));
alter policy teams_insert on public.teams
  with check (((select is_approved()) AND (select is_admin())));
alter policy teams_select on public.teams
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)));
alter policy teams_update on public.teams
  using (((select is_approved()) AND (select is_admin())))
  with check (((select is_approved()) AND (select is_admin())));
alter policy wiki_edits_insert on public.wiki_edits
  with check ((select is_master()));
alter policy wiki_edits_select on public.wiki_edits
  using (((select is_approved()) AND ((page_id <> ALL (ARRAY['faq'::text, 'learned'::text])) OR (select is_master()))));
alter policy wiki_edits_update on public.wiki_edits
  using ((select is_master()))
  with check ((select is_master()));
alter policy wiki_pages_select on public.wiki_pages
  using (((select is_approved()) AND ((id <> ALL (ARRAY['faq'::text, 'learned'::text])) OR (select is_master()))));

commit;
