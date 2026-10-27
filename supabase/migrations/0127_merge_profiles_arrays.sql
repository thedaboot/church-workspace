-- ============================================================================
-- 0127 — 계정 합치기가 업무 문서 버전의 '같이 고친 사람'(card_doc_versions.editors uuid[])도 옮긴다(2026-10-27)
-- ----------------------------------------------------------------------------
-- 0126은 한 칸짜리 참조만 옮겼다 — 배열 칸(0087 editors)은 남아, 2026-10-25 김승찬 합치기 뒤 버전 한 줄이 옛 계정을
-- 가리켰다(사용자 요청으로 확인). 함수는 0126 그대로에 한 줄을 더하고, 이미 합친 계정들의 남은 값도 옮긴다.
-- 순서: 이 마이그레이션 → 코드(코드는 바뀌지 않는다).
-- ============================================================================
begin;

CREATE OR REPLACE FUNCTION public.merge_profiles(p_keep uuid, p_drop uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  moved jsonb := '{}'::jsonb;
  n integer;
begin
  if not public.is_master() then
    raise exception '계정 합치기는 마스터만 할 수 있습니다' using errcode = '42501';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception '남길 계정과 합칠 계정이 서로 달라야 합니다' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_keep) then
    raise exception '남길 계정을 찾지 못했습니다' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_drop) then
    raise exception '합칠 계정을 찾지 못했습니다' using errcode = '22023';
  end if;
  -- 이미 합쳐진 계정을 남길 쪽으로 고르면, 그 계정으로 옮긴 것이 다시 갈린다
  if exists (select 1 from public.profiles where id = p_keep and merged_into is not null) then
    raise exception '이미 다른 계정으로 합쳐진 계정은 남길 수 없습니다' using errcode = '22023';
  end if;

  -- ── 겹치면 버리는 것들(유니크·PK가 있는 표) ───────────────────────────────
  delete from public.profile_teams d
   where d.profile_id = p_drop
     and exists (select 1 from public.profile_teams k
                  where k.profile_id = p_keep and k.team_id = d.team_id);
  update public.profile_teams set profile_id = p_keep where profile_id = p_drop;

  delete from public.card_assignees d
   where d.profile_id = p_drop
     and exists (select 1 from public.card_assignees k
                  where k.profile_id = p_keep and k.card_id = d.card_id);
  update public.card_assignees set profile_id = p_keep where profile_id = p_drop;
  get diagnostics n = row_count;
  moved := moved || jsonb_build_object('card_assignees', n);

  delete from public.comment_reactions d
   where d.user_id = p_drop
     and exists (select 1 from public.comment_reactions k
                  where k.user_id = p_keep and k.comment_id = d.comment_id and k.kind = d.kind);
  update public.comment_reactions set user_id = p_keep where user_id = p_drop;

  delete from public.service_notes d
   where d.profile_id = p_drop
     and exists (select 1 from public.service_notes k
                  where k.profile_id = p_keep and k.service_id = d.service_id);
  update public.service_notes set profile_id = p_keep where profile_id = p_drop;
  get diagnostics n = row_count;
  moved := moved || jsonb_build_object('service_notes', n);

  delete from public.qt_entries d
   where d.profile_id = p_drop
     and exists (select 1 from public.qt_entries k
                  where k.profile_id = p_keep and k.qt_date = d.qt_date);
  update public.qt_entries set profile_id = p_keep where profile_id = p_drop;
  get diagnostics n = row_count;
  moved := moved || jsonb_build_object('qt_entries', n);

  -- 성경 읽기 상태는 계정마다 한 줄(PK) — 남기는 쪽에 이미 있으면 그것을 남긴다
  delete from public.bible_state where profile_id = p_drop
    and exists (select 1 from public.bible_state where profile_id = p_keep);
  update public.bible_state set profile_id = p_keep where profile_id = p_drop;

  -- 명단 연결(UNIQUE). 남기는 계정이 이미 명단에 붙어 있으면 그것을 남기고, 버리는
  -- 계정 쪽 연결만 끊는다 — 그때는 **명단 행이 둘**이라는 뜻이므로 화면이 알려 준다.
  if exists (select 1 from public.people where profile_id = p_keep and removed_at is null) then
    update public.people set profile_id = null where profile_id = p_drop;
    moved := moved || jsonb_build_object('people_kept_existing', true);
  else
    update public.people set profile_id = p_keep where profile_id = p_drop;
    moved := moved || jsonb_build_object('people_relinked', true);
  end if;

  -- ── 그냥 옮기는 것들(겹칠 수 없는 표) ─────────────────────────────────────
  update public.push_subscriptions set profile_id = p_keep where profile_id = p_drop;
  update public.notifications set recipient_id = p_keep where recipient_id = p_drop;
  update public.comments set author_id = p_keep where author_id = p_drop;
  get diagnostics n = row_count;
  moved := moved || jsonb_build_object('comments', n);

  update public.cards set created_by = p_keep where created_by = p_drop;
  update public.cards set updated_by = p_keep where updated_by = p_drop;
  update public.cards set ai_summary_by = p_keep where ai_summary_by = p_drop;
  update public.projects set created_by = p_keep where created_by = p_drop;
  update public.resource_links set created_by = p_keep where created_by = p_drop;
  update public.resource_links set view_pw_by = p_keep where view_pw_by = p_drop;
  update public.files set uploaded_by = p_keep where uploaded_by = p_drop;
  update public.files set view_pw_by = p_keep where view_pw_by = p_drop;
  update public.activity set actor_id = p_keep where actor_id = p_drop;
  update public.services set created_by = p_keep where created_by = p_drop;
  update public.attendance set checked_by = p_keep where checked_by = p_drop;
  update public.sun_guides set created_by = p_keep where created_by = p_drop;
  update public.sun_guides set pinned_by = p_keep where pinned_by = p_drop;
  update public.club_applications set decided_by = p_keep where decided_by = p_drop;
  update public.attendance_guests set created_by = p_keep where created_by = p_drop;
  update public.profiles set approved_by = p_keep where approved_by = p_drop;
  update public.profiles set removed_by = p_keep where removed_by = p_drop;
  -- 합쳐 들어간 계정을 가리키던 표는 새 주인으로 따라간다(합치기를 두 번 한 경우)
  update public.profiles set merged_into = p_keep where merged_into = p_drop;

  -- ── 0126: 0060 뒤에 생긴 칸(감사 2026-10-23 — 합친 뒤 잠금 해제가 풀리고 · 버린 계정의 달력 구독이 죽고 · 피드백 이력이 안 보였다) ──
  delete from public.card_unlocks d where d.profile_id = p_drop
     and exists (select 1 from public.card_unlocks k where k.profile_id = p_keep and k.card_id = d.card_id);
  update public.card_unlocks set profile_id = p_keep where profile_id = p_drop;
  delete from public.card_lock_requests d where d.profile_id = p_drop
     and exists (select 1 from public.card_lock_requests k where k.profile_id = p_keep and k.card_id = d.card_id);
  update public.card_lock_requests set profile_id = p_keep where profile_id = p_drop;
  delete from public.project_viewers d where d.profile_id = p_drop
     and exists (select 1 from public.project_viewers k where k.profile_id = p_keep and k.project_id = d.project_id);
  update public.project_viewers set profile_id = p_keep where profile_id = p_drop;
  update public.project_viewers set added_by = p_keep where added_by = p_drop;
  delete from public.calendar_feeds d where d.owner = p_drop
     and exists (select 1 from public.calendar_feeds k where k.owner = p_keep and k.project_id is not distinct from d.project_id);
  update public.calendar_feeds set owner = p_keep where owner = p_drop;
  delete from public.event_feeds where owner = p_drop and exists (select 1 from public.event_feeds where owner = p_keep);
  update public.event_feeds set owner = p_keep where owner = p_drop;
  update public.cards set deleted_by = p_keep where deleted_by = p_drop;
  update public.cards set locked_by = p_keep where locked_by = p_drop;
  update public.projects set deleted_by = p_keep where deleted_by = p_drop;
  update public.projects set visibility_by = p_keep where visibility_by = p_drop;
  update public.comments set pinned_by = p_keep where pinned_by = p_drop;
  update public.comments set resolved_by = p_keep where resolved_by = p_drop;
  update public.card_doc_updates set by = p_keep where by = p_drop;
  update public.card_doc_versions set by = p_keep where by = p_drop;
  update public.feedback set sender_id = p_keep where sender_id = p_drop;
  update public.feedback set status_by = p_keep where status_by = p_drop;
  update public.events set created_by = p_keep where created_by = p_drop;
  update public.group_meetings set created_by = p_keep where created_by = p_drop;
  update public.services set published_by = p_keep where published_by = p_drop;
  update public.handovers set written_by = p_keep where written_by = p_drop;
  update public.handover_plans set updated_by = p_keep where updated_by = p_drop;
  update public.wiki_edits set edited_by = p_keep where edited_by = p_drop;
  update public.dabooti_facts set told_by = p_keep where told_by = p_drop;
  update public.club_reports set saved_by = p_keep where saved_by = p_drop;
  update public.club_reports set submitted_by = p_keep where submitted_by = p_drop;
  update public.client_errors set profile_id = p_keep where profile_id = p_drop;
  update public.admin_audit set actor_id = p_keep where actor_id = p_drop;
  -- 0127: 배열 칸 — 겹치면 하나로
  update public.card_doc_versions
     set editors = (select array_agg(distinct x) from unnest(array_replace(editors, p_drop, p_keep)) x)
   where p_drop = any(editors);

  -- ── 지우는 계정은 환송 처리하고 **합쳐졌다는 표를 남긴다**(0060) ──────────
  update public.profiles
     set approved = false, removed_at = now(), removed_by = auth.uid(), merged_into = p_keep
   where id = p_drop;

  return moved || jsonb_build_object('keep', p_keep, 'dropped', p_drop);
end;
$function$;

-- 이미 합친 계정들(merged_into)의 남은 값
update public.card_doc_versions v
   set editors = (select array_agg(distinct coalesce(p.merged_into, x)) from unnest(v.editors) x left join public.profiles p on p.id = x)
 where exists (select 1 from unnest(v.editors) x join public.profiles p on p.id = x where p.merged_into is not null);

commit;
