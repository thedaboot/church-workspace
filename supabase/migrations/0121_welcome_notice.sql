-- ============================================================================
-- 0121 — 새가족 알림(welcome_new · 사용자 결정 2026-10-21)
-- ----------------------------------------------------------------------------
-- 새가족 QR로 정보가 들어오면(0120 submit_welcome_card) **새가족 탭을 보고 고칠 수 있는 사람 전부**에게 알림 —
-- 웰컴팀 소속 · 리더진(관리자·교역자·그 해 직분, 비전 메이커 빼고) = can_see_welcome()과 같은 사람들.
--   문구(services/notifyText.js · 사용자 확정): '새가족 OO님이 정보를 남겼어요' · 아래 줄 = 유입 경로.
--   누르면 모임 > 새가족 탭이 열리고 그 카드 창이 뜬다(link '/?p=groups&tab=welcome&wc=<카드 id>').
--   알림 설정 '모임 > 새가족'으로 끈다(notif_slot에 한 줄 — 화면 표 services/notifyPrefs.js NOTIF_GROUPS와 같은 표 ·
--   받는 사람에게만 그 칩이 보인다). 끈 사람에게는 넣지 않는다(0113 BEFORE INSERT 트리거가 그대로 거른다).
--
-- 받는 사람 한 벌은 welcome_recipients() — can_see_welcome()을 '나'가 아니라 **모든 계정**에 대해 푼 것이다(두 판정이 같은
-- 갈래를 본다: 관리자 email · 명단 is_pastor · 그 해 people_roles(비전 메이커 빼고) · 명단 teams의 '웰컴팀' · 승인된 계정만 ·
-- 합친 계정은 남긴 쪽만). 웹 푸시는 앱이 아니라 서버가 보낸다 — 보낸 새가족은 로그인이 없다. 정보 화면이 api/push에
-- { welcome: 카드 id }를 한 번 부르면, 서버가 **방금 들어온(10분 안) · 아직 안 보낸** 카드만 골라(pushed_at으로 한 번만)
-- 이 함수가 넣은 알림 줄의 받는 사람에게 보낸다.
--
-- 순서: 이 마이그레이션 → 코드. 되돌리기는 파일 맨 아래 주석.
-- ============================================================================

begin;

alter table public.welcome_cards add column if not exists pushed_at timestamptz;

-- 알림 종류 — 0113 목록 + welcome_new
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction',
                  'worship_today', 'service_published', 'note_shared',
                  'club_apply', 'club_accepted', 'meeting_new',
                  'approved', 'guide_pinned', 'meeting_tomorrow', 'assignee_comment', 'lock_reset', 'feedback_fixed',
                  'welcome_new'));

-- kind → {갈래, 항목} — 0113 표 + welcome_new(모임 > 새가족) · services/notifyPrefs.js NOTIF_GROUPS와 같은 표(tests/logcheck-sec)
create or replace function public.notif_slot(k text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case k
    when 'reply'             then array['task', 'comment']
    when 'reaction'          then array['task', 'comment']
    when 'assignee_comment'  then array['task', 'comment']
    when 'mention'           then array['task', 'mention']
    when 'assign'            then array['task', 'assign']
    when 'due_soon'          then array['task', 'due']
    when 'lock_reset'        then array['task']
    when 'worship_today'     then array['worship', 'today']
    when 'service_published' then array['worship', 'published']
    when 'note_shared'       then array['worship', 'note']
    when 'club_apply'        then array['group', 'apply']
    when 'club_accepted'     then array['group', 'accepted']
    when 'meeting_new'       then array['group', 'new']
    when 'meeting_tomorrow'  then array['group', 'tomorrow']
    when 'guide_pinned'      then array['group', 'guide']
    when 'welcome_new'       then array['group', 'welcome']
    when 'approval'          then array['join']
    when 'approved'          then array['join']
  end
$$;

-- 새가족 탭을 보는 사람 전부(계정 id) — can_see_welcome()의 갈래를 모든 계정에 대해
create or replace function public.welcome_recipients()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select pr.id from public.profiles pr
   where pr.approved and pr.merged_into is null and pr.removed_at is null
     and (
       exists (select 1 from public.admins a where lower(a.email) = lower(coalesce(pr.email, '')))
       or exists (
         select 1 from public.people p
          where p.profile_id = pr.id and p.removed_at is null
            and (p.is_pastor or '웰컴팀' = any(p.teams)
                 or exists (select 1 from public.people_roles r
                             where r.person_id = p.id and r.year = public.kst_year() and r.role <> 'vision_maker'))
       )
     );
$$;
revoke all on function public.welcome_recipients() from public, anon, authenticated;

-- 새가족 QR 화면 — 0120 함수에 알림 넣기를 더한다(나머지는 그대로)
create or replace function public.submit_welcome_card(p_name text, p_phone text, p_how text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_how text := nullif(left(btrim(coalesce(p_how, '')), 20), '');
  v_id uuid;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then raise exception 'bad_name' using errcode = '22023'; end if;
  if char_length(v_digits) < 9 or char_length(v_digits) > 15 then raise exception 'bad_phone' using errcode = '22023'; end if;
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
$$;
revoke all on function public.submit_welcome_card(text, text, text, text) from public;
grant execute on function public.submit_welcome_card(text, text, text, text) to anon, authenticated;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select count(*) from public.welcome_recipients();
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_kind_check';   -- welcome_new 포함
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   delete from public.notifications where kind = 'welcome_new';
--   (0120의 submit_welcome_card · 0113의 notif_slot · 0113의 notifications_kind_check를 다시 실행)
--   drop function if exists public.welcome_recipients();
--   alter table public.welcome_cards drop column if exists pushed_at;
