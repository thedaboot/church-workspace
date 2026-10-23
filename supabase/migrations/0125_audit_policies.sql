-- ============================================================================
-- 0125 — 전체 감사 2026-10-23의 권한·데이터 결정(사용자 결정 2026-10-23 · '권장대로')
-- ----------------------------------------------------------------------------
-- ① 모임 보고서 파일(엑셀 — 계좌가 든다 · 영수증)은 그 모임을 고칠 수 있는 사람 · 마스터 · 총무만 본다.
--    club_reports_select와 같은 판정. files_select(업무 첨부 갈래)가 meeting_id 행도 통과시켜서 permissive 하나를 좁히는 것으로는
--    안 막힌다 — restrictive 하나를 둔다(files_meeting_guard_* 셋과 같은 모양).
-- ② 새가족 QR: 같은 전화번호(숫자만)가 같은 날(KST) 또 오면 새 카드·알림 없이 그 카드 id를 돌려준다 · 전체 10분 30장은 그대로.
-- ③ 보는 사람 직접 선택(set_project_viewers): 보는 사람 밖으로 간 그 프로젝트 알림의 미리보기(업무 제목)를 비운다 · 지금 남은 것도 한 번.
-- ④ my_leader_years(): 올해까지만 — 다음 해 직분만 있는 사람이 그해 '리더만' 프로젝트를 미리 보고 고치던 것.
-- ⑤ 프로젝트 행 지우기(REST)는 마스터, 또는 만든 사람의 빈 프로젝트만 — 앱은 0104부터 휴지통(trash_project)을 쓰고
--    행 지우기는 복제 실패 정리(빈 프로젝트)뿐이다. 30일 정리는 서버 키라 영향이 없다.
-- 순서: 이 마이그레이션 → 코드(코드는 이 파일에 기대지 않는다).
-- ============================================================================

begin;

-- ① ---------------------------------------------------------------------------
drop policy if exists files_meeting_guard_select on public.files;
create policy files_meeting_guard_select on public.files as restrictive for select to authenticated
  using (meeting_id is null or public.can_edit_meeting(meeting_id) or (select public.is_master()) or (select public.has_role('treasurer')));

-- ② ---------------------------------------------------------------------------
create or replace function public.submit_welcome_card(p_name text, p_phone text, p_how text default null::text, p_note text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_how text := nullif(left(btrim(coalesce(p_how, '')), 20), '');
  v_id uuid;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then raise exception 'bad_name' using errcode = '22023'; end if;
  if char_length(v_digits) < 9 or char_length(v_digits) > 15 then raise exception 'bad_phone' using errcode = '22023'; end if;
  -- 같은 번호 · 같은 날이면 그 카드(두 번 누른 것 · 되풀이 접수) — 새 카드도 알림도 없다
  select id into v_id from public.welcome_cards
   where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_digits
     and (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
   order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.welcome_cards where created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'too_many' using errcode = '53400';
  end if;
  insert into public.welcome_cards (name, phone, how, note, visits)
  values (v_name, left(btrim(p_phone), 20), v_how,
          nullif(left(btrim(coalesce(p_note, '')), 500), ''), array[(now() at time zone 'Asia/Seoul')::date])
  returning id into v_id;
  -- 알림 — actor_name = 새가족 이름(문구 '새가족 OO님이 …' · 로그인이 없어 0071 트리거가 덮지 않는다) · 끈 사람은 0113 트리거가 거른다
  insert into public.notifications (recipient_id, actor_name, kind, preview, link)
  select rid, left(v_name, 100), 'welcome_new', v_how, '/?p=groups&tab=welcome&wc=' || v_id
    from public.welcome_recipients() as rid;
  return v_id;
end;
$function$;

-- ③ ---------------------------------------------------------------------------
create or replace function public.scrub_project_previews(p uuid)
 returns void language sql security definer set search_path to 'public', 'pg_temp' as $$
  update public.notifications n set preview = null
   where n.preview is not null
     and (n.project_id = p or n.card_id in (select c.id from public.cards c where c.project_id = p))
     and not exists (select 1 from public.project_audiences(array[p]) a where n.recipient_id = any (a.profile_ids));
$$;
revoke all on function public.scrub_project_previews(uuid) from public, anon, authenticated;

create or replace function public.set_project_viewers(p uuid, ids uuid[], teams text[] default '{}'::text[])
 returns projects
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  me  uuid := public.effective_uid();
  saved public.projects;
begin
  if not public.is_approved() or me is null then raise exception 'not approved' using errcode = '42501'; end if;
  if not public.is_leader() then raise exception 'not a leader' using errcode = '42501'; end if;
  if not public.can_see_project(p) then raise exception 'not visible' using errcode = '42501'; end if;
  update public.projects set visibility = 'custom', viewer_teams = coalesce(teams, '{}') where id = p returning * into saved;
  if not found then raise exception 'no project' using errcode = 'P0002'; end if;
  delete from public.project_viewers v
   where v.project_id = p and v.profile_id <> me and not (v.profile_id = any (coalesce(ids, '{}')));
  insert into public.project_viewers (project_id, profile_id, added_by)
  select p, pr.id, me from public.profiles pr
   where (pr.id = any (coalesce(ids, '{}')) or pr.id = me) and pr.merged_into is null and pr.removed_at is null
  on conflict (project_id, profile_id) do nothing;
  perform public.scrub_project_previews(p);   -- 0125 ③
  return saved;
end $function$;

select public.scrub_project_previews(id) from public.projects where visibility = 'custom';

-- ④ ---------------------------------------------------------------------------
create or replace function public.my_leader_years()
 returns integer[]
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(array_agg(distinct pr.year order by pr.year), '{}')
    from public.people_roles pr
   where pr.person_id = public.my_person_id() and pr.role <> 'vision_maker' and pr.year <= public.kst_year();
$function$;

-- ⑤ ---------------------------------------------------------------------------
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete to authenticated
  using ((select public.is_approved()) and ((select auth.role()) = 'authenticated')
    and ((visibility <> 'leaders') or (select public.is_leader()) or (year = any ((select public.my_leader_years())::integer[])))
    and ((select public.is_master())
      or (created_by = (select public.effective_uid()) and not exists (select 1 from public.cards c where c.project_id = projects.id))));

commit;

-- ── 되돌리기 ───────────────────────────────────────────────────────────────────
--   drop policy files_meeting_guard_select on public.files;
--   submit_welcome_card · set_project_viewers · my_leader_years · projects_delete는 0121·0105·0110·0110의 정의로
--   drop function public.scrub_project_previews(uuid);
