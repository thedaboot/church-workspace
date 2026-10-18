-- ============================================================================
-- 0113 — 관리자 메뉴 · 피드백 전송 · 알림 종류별 설정(v5 2묶음 · 사용자 승인 시안 mock/b3 · 2026-10-18)
-- ----------------------------------------------------------------------------
-- 화면: components/opsDesk.jsx(관리자 메뉴 — **마스터만**) · components/feedbackSend.jsx(피드백 전송 — 모두) ·
-- components/notificationBell.jsx('알림 설정'). 앱 쪽 읽기·쓰기는 services/ops.js · services/notifOff.js · services/errorReport.js.
--
-- 표
--   feedback(id · sender_id · body · shot_path · route · ua · viewport · build · status · created_at · status_at · status_by · notified_at)
--     status = new(새 피드백) | checking(확인 중) | resolved(해결). 넣기 = 승인된 본인(본인 칸 · 상태 new · 사진은 본인 폴더) ·
--     읽기 = 본인 행 + 마스터 · **상태는 set_feedback_status(마스터)만** 바꾼다(update 정책 없음). 한 사람 한 시간 10건(트리거).
--   storage 'feedback' 버킷(비공개 · 5MB · webp/jpeg) — 경로 `<보낸 사람 id>/<uuid>.webp`. 올리기 = 승인된 본인 폴더 · 읽기 = 마스터.
--   client_errors(지문 · 문구 · 맨 위 프레임 · 스택 · 화면 · ua · 빌드 · 사람 · 날짜 · count · first_seen · last_seen)
--     한 줄 = (지문 · 사람 · 빌드 · 화면 · ua · 날짜(KST)) — 같은 줄이 또 나면 count만 오른다(report_client_error upsert).
--     읽기 = 마스터 · 쓰기 정책 없음(함수만).
--   ai_timings(at · question · gather_ms · answer_ms · total_ms · cached) — 다붓이 답 하나에 한 줄(api/ai.js handleAsk가 서버 키로 넣는다).
--     **묻는 사람 칸이 없다**(누가 물었는지 견주지 않는다 · HANDOFF §8). 읽기 = 마스터.
--   admin_audit(at · actor_id · kind · action · target_id · target_label · detail) — 관리 기록. 트리거가 넣는다(아래). 읽기 = 마스터.
--     kind = lock(업무 잠금·풀기) | visibility(프로젝트 보는 사람) | trash(업무·프로젝트 삭제·복원) | approve(가입 승인) | role(직분)
--     **로그인한 사람이 한 일만** 남긴다(auth.uid()가 없으면 — 크론의 인수인계·psql·서버 키 — 남기지 않는다).
--   profiles.notif_off text[] — 끈 알림(갈래 'task' · 항목 'task.mention' · services/notifyPrefs.js 표 한 벌). 본인만 고친다(트리거).
--
-- 알림 끄기는 **넣는 자리와 푸시 둘 다** 거른다
--   · notifications BEFORE INSERT 트리거(trg_notifications_off)가 받는 사람의 notif_off로 막힌 종류면 행을 넣지 않는다(return null) —
--     앱(insertNotifications) · 서버 배치(api/push.js) · DB 함수(request_lock_reset · 가입 알림 트리거) 세 길이 모두 이 표를 지난다.
--   · api/push.js loadTargets가 같은 표(notifyPrefs.notifAllowed)로 받는 사람을 다시 거른다 — 앱이 넣은 뒤 부탁하는 푸시 ·
--     DB 함수가 돌려준 id로 부탁하는 푸시(lock_reset) · 배치의 푸시가 모두 loadTargets를 지난다.
--   · 표 밖 종류(아래 'feedback_fixed' — 보내 주신 피드백이 해결됐어요)는 언제나 간다(사용자 결정 2026-10-18).
--   · notif_slot()의 표는 services/notifyPrefs.js NOTIF_GROUPS와 같아야 한다 — tests/logcheck-sec가 두 표를 견준다.
--
-- 함수(security definer · search_path 고정 · anon 회수)
--   set_feedback_status(uuid, text) → uuid     마스터만. 상태를 바꾸고, 처음 '해결'이 될 때 보낸 사람에게 알림
--                                               'feedback_fixed' 한 줄을 넣고 그 사람 id를 돌려준다(앱이 그 id로 푸시를 부탁한다 ·
--                                               두 번째 해결부터는 null — 알림을 두 번 보내지 않는다)
--   report_client_error(fp, msg, frame, stack, route, ua, build) → bool   승인된 사람만 · 사람마다 10분에 20줄 · 하루 전체 3000줄 상한
--   notif_slot(text) → text[] · notif_allowed(text, text[]) → bool   (immutable · 트리거와 확인용)
--
-- 알림 종류 'feedback_fixed'는 **CHECK만** 넓힌다 — INSERT 정책에는 넣지 않는다(함수가 넣는 종류 · 0106 lock_reset과 같은 이유).
--
-- **순서: 이 마이그레이션 → 코드**(§3-4). 코드가 먼저 나가도 오류 화면은 없다 — 앱 첫 읽기(loadCloudState)는 이 표들을 보지 않고
-- profiles를 '*'로 읽는다(notif_off가 없으면 브라우저 값). 다만 먼저 나가면 피드백 보내기 · 상태 바꾸기가 실패 토스트로 끝나고,
-- 관리자 메뉴는 '불러오지 못했어요'로 서고, 화면 오류 보고는 조용히 빠지고, 다붓이 답 시간은 안 남는다(api/ai.js가 삼킨다).
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 알림 종류별 설정 ─────────────────────────────────────────────────────────
alter table public.profiles add column if not exists notif_off text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_notif_off_check;
alter table public.profiles add constraint profiles_notif_off_check check (cardinality(notif_off) <= 40);
comment on column public.profiles.notif_off is '끈 알림 — 갈래(task) · 항목(task.mention) · services/notifyPrefs.js 표 · 본인만 고친다(0113)';

create or replace function public.guard_notif_off() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and new.notif_off is distinct from old.notif_off
     and not (new.id = any (array[auth.uid(), public.effective_uid()])) then
    raise exception '알림 설정은 본인만 고칠 수 있어요' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_notif_off on public.profiles;
create trigger trg_profiles_notif_off before update of notif_off on public.profiles
  for each row execute function public.guard_notif_off();

-- kind → {갈래, 항목} (항목이 없으면 {갈래}) · 표 밖이면 null — services/notifyPrefs.js NOTIF_GROUPS와 같은 표
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
    when 'approval'          then array['join']
    when 'approved'          then array['join']
  end
$$;

create or replace function public.notif_allowed(k text, off text[]) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select case
    when public.notif_slot(k) is null then true
    when (public.notif_slot(k))[1] = any (coalesce(off, '{}')) then false
    when array_length(public.notif_slot(k), 1) = 2
         and ((public.notif_slot(k))[1] || '.' || (public.notif_slot(k))[2]) = any (coalesce(off, '{}')) then false
    else true
  end
$$;

create or replace function public.notifications_respect_off() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  off text[];
begin
  select p.notif_off into off from public.profiles p where p.id = new.recipient_id;
  if not public.notif_allowed(new.kind, off) then return null; end if;   -- 끈 종류 — 넣지 않는다
  return new;
end $$;
comment on function public.notifications_respect_off() is '받는 사람이 끈 종류의 알림은 넣지 않는다(profiles.notif_off · 0113)';
drop trigger if exists trg_notifications_off on public.notifications;
create trigger trg_notifications_off before insert on public.notifications
  for each row execute function public.notifications_respect_off();

-- ── 알림 종류 (CHECK만 · 0106 목록 + feedback_fixed) ─────────────────────────
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction',
                  'worship_today', 'service_published', 'note_shared',
                  'club_apply', 'club_accepted', 'meeting_new',
                  'approved', 'guide_pinned', 'meeting_tomorrow', 'assignee_comment', 'lock_reset', 'feedback_fixed'));

-- ── 피드백 ──────────────────────────────────────────────────────────────────
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references public.profiles(id) on delete cascade default public.effective_uid(),
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  shot_path   text check (shot_path is null or char_length(shot_path) <= 200),
  route       text not null default '' check (char_length(route) <= 300),
  ua          text not null default '' check (char_length(ua) <= 300),
  viewport    text not null default '' check (char_length(viewport) <= 20),
  build       text not null default '' check (char_length(build) <= 40),
  status      text not null default 'new' check (status in ('new', 'checking', 'resolved')),
  created_at  timestamptz not null default now(),
  status_at   timestamptz,
  status_by   uuid references public.profiles(id) on delete set null,
  notified_at timestamptz
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_sender_idx on public.feedback (sender_id, created_at desc);
comment on table public.feedback is '피드백 전송 — 넣기 승인된 본인 · 읽기 본인 + 마스터 · 상태는 set_feedback_status(마스터)만(0113)';
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant select, insert on public.feedback to authenticated;

drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback for select to authenticated
  using (sender_id = any (array[(select auth.uid()), (select public.effective_uid())]) or (select public.is_master()));
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert to authenticated
  with check ((select public.is_approved())
    and sender_id = (select public.effective_uid())
    and status = 'new' and status_at is null and status_by is null and notified_at is null
    and (shot_path is null or split_part(shot_path, '/', 1) = sender_id::text));

-- 한 사람 한 시간 10건(서버 키·psql은 그대로)
create or replace function public.feedback_rate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and (select count(*) from public.feedback f
       where f.sender_id = new.sender_id and f.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many feedback' using errcode = '54000';
  end if;
  return new;
end $$;
drop trigger if exists trg_feedback_rate on public.feedback;
create trigger trg_feedback_rate before insert on public.feedback for each row execute function public.feedback_rate();

create or replace function public.set_feedback_status(f uuid, s text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r  record;
  me uuid := public.effective_uid();
begin
  if not public.is_master() then raise exception 'not master' using errcode = '42501'; end if;
  if s is null or s not in ('new', 'checking', 'resolved') then raise exception 'bad status' using errcode = '22023'; end if;
  select id, sender_id, body, notified_at into r from public.feedback where id = f for update;
  if not found then raise exception 'no feedback' using errcode = 'P0002'; end if;
  update public.feedback set status = s, status_at = now(), status_by = me where id = f;
  if s = 'resolved' and r.notified_at is null then
    -- 표 밖 종류라 notif_off가 막지 않는다(사용자 결정 — 해결 알림은 항상 받는다) · actor_name은 0071 트리거가 덮어도 문구에 안 쓴다
    insert into public.notifications (recipient_id, actor_name, kind, preview)
    values (r.sender_id, '더다붓', 'feedback_fixed', nullif(left(btrim(r.body), 80), ''));
    update public.feedback set notified_at = now() where id = f;
    return r.sender_id;
  end if;
  return null;
end $$;

-- 화면 사진 버킷(비공개)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', false, 5242880, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists feedback_shots_insert_own on storage.objects;
create policy feedback_shots_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'feedback' and (select public.is_approved())
    and (storage.foldername(name))[1] = any (array[(select auth.uid())::text, (select public.effective_uid())::text]));
drop policy if exists feedback_shots_select_master on storage.objects;
create policy feedback_shots_select_master on storage.objects for select to authenticated
  using (bucket_id = 'feedback' and (select public.is_master()));

-- ── 앱 내 오류 ──────────────────────────────────────────────────────────────
create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  k           text not null unique,
  day         date not null,
  fingerprint text not null,
  message     text not null,
  top_frame   text not null default '',
  stack       text not null default '',
  route       text not null default '',
  ua          text not null default '',
  build       text not null default '',
  profile_id  uuid references public.profiles(id) on delete set null,
  count       integer not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists client_errors_last_idx on public.client_errors (last_seen desc);
create index if not exists client_errors_profile_idx on public.client_errors (profile_id, last_seen desc);
create index if not exists client_errors_day_idx on public.client_errors (day);
comment on table public.client_errors is '앱 내 오류 — 한 줄 = (지문·사람·빌드·화면·ua·날짜) · count가 오른다 · 읽기 마스터 · 쓰기 report_client_error만(0113)';
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
grant select on public.client_errors to authenticated;
drop policy if exists client_errors_select on public.client_errors;
create policy client_errors_select on public.client_errors for select to authenticated using ((select public.is_master()));

create or replace function public.report_client_error(fp text, msg text, frame text, stk text, rt text, agent text, bld text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.effective_uid();
  d  date := (now() at time zone 'Asia/Seoul')::date;
  f  text := left(btrim(coalesce(fp, '')), 300);
  m  text := left(btrim(coalesce(msg, '')), 300);
begin
  if me is null or not public.is_approved() then return false; end if;
  if f = '' or m = '' then return false; end if;
  if (select count(*) from public.client_errors e where e.profile_id = me and e.last_seen > now() - interval '10 minutes') >= 20 then return false; end if;
  if (select count(*) from public.client_errors e where e.day = d) >= 3000 then return false; end if;
  insert into public.client_errors (k, day, fingerprint, message, top_frame, stack, route, ua, build, profile_id)
  values (md5(concat_ws('|', f, me::text, left(coalesce(bld, ''), 40), left(coalesce(rt, ''), 300), left(coalesce(agent, ''), 300), d::text)),
          d, f, m, left(coalesce(frame, ''), 200), left(coalesce(stk, ''), 2000), left(coalesce(rt, ''), 300),
          left(coalesce(agent, ''), 300), left(coalesce(bld, ''), 40), me)
  on conflict (k) do update set count = public.client_errors.count + 1, last_seen = now(),
    message = excluded.message, stack = excluded.stack, top_frame = excluded.top_frame;
  return true;
end $$;

-- ── 다붓이 답변 속도 ─────────────────────────────────────────────────────────
create table if not exists public.ai_timings (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  question   text not null check (char_length(question) <= 300),
  gather_ms  integer not null check (gather_ms >= 0),
  answer_ms  integer not null check (answer_ms >= 0),
  total_ms   integer not null check (total_ms >= 0),
  cached     boolean not null default false
);
create index if not exists ai_timings_at_idx on public.ai_timings (at desc);
comment on table public.ai_timings is '다붓이 답 시간 — 묻는 사람 칸 없음 · 넣기 서버 키(api/ai.js) · 읽기 마스터(0113)';
alter table public.ai_timings enable row level security;
revoke all on public.ai_timings from anon, authenticated;
grant select on public.ai_timings to authenticated;
drop policy if exists ai_timings_select on public.ai_timings;
create policy ai_timings_select on public.ai_timings for select to authenticated using ((select public.is_master()));

-- ── 관리 기록 ──────────────────────────────────────────────────────────────
create table if not exists public.admin_audit (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     uuid references public.profiles(id) on delete set null,
  kind         text not null check (kind in ('lock', 'visibility', 'trash', 'approve', 'role')),
  action       text not null,
  target_id    uuid,
  target_label text not null default '',
  detail       jsonb not null default '{}'
);
create index if not exists admin_audit_at_idx on public.admin_audit (at desc);
comment on table public.admin_audit is '관리 기록 — 트리거가 넣는다(로그인한 사람이 한 일만) · 읽기 마스터(0113)';
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;
grant select on public.admin_audit to authenticated;
drop policy if exists admin_audit_select on public.admin_audit;
create policy admin_audit_select on public.admin_audit for select to authenticated using ((select public.is_master()));

create or replace function public.audit_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid;
  r  record;
  nm text;
begin
  if auth.uid() is null then return null; end if;   -- 크론(인수인계)·psql·서버 키는 남기지 않는다
  me := public.effective_uid();
  if tg_table_name = 'cards' then
    if new.locked is distinct from old.locked then
      insert into public.admin_audit (actor_id, kind, action, target_id, target_label, detail)
      values (me, 'lock', case when new.locked then 'lock' else 'unlock' end, new.id, coalesce(new.title, ''), jsonb_build_object('project', new.project_id));
    end if;
    if new.deleted_at is distinct from old.deleted_at then
      insert into public.admin_audit (actor_id, kind, action, target_id, target_label, detail)
      values (me, 'trash', case when new.deleted_at is null then 'restore_card' else 'trash_card' end, new.id, coalesce(new.title, ''), jsonb_build_object('project', new.project_id));
    end if;
  elsif tg_table_name = 'projects' then
    if new.visibility is distinct from old.visibility then
      insert into public.admin_audit (actor_id, kind, action, target_id, target_label, detail)
      values (me, 'visibility', 'visibility', new.id, coalesce(new.name, ''), jsonb_build_object('from', old.visibility, 'to', new.visibility));
    end if;
    if new.deleted_at is distinct from old.deleted_at then
      insert into public.admin_audit (actor_id, kind, action, target_id, target_label)
      values (me, 'trash', case when new.deleted_at is null then 'restore_project' else 'trash_project' end, new.id, coalesce(new.name, ''));
    end if;
  elsif tg_table_name = 'profiles' then
    if new.approved and not coalesce(old.approved, false) then
      insert into public.admin_audit (actor_id, kind, action, target_id, target_label)
      values (me, 'approve', 'approve', new.id, coalesce(new.display_name, ''));
    end if;
  elsif tg_table_name = 'people_roles' then
    if tg_op = 'DELETE' then r := old; else r := new; end if;
    -- upsert가 같은 줄을 다시 쓰면(팀이 그대로) 남기지 않는다
    if tg_op = 'UPDATE' and new.team is not distinct from old.team then return null; end if;
    select p.name into nm from public.people p where p.id = r.person_id;
    insert into public.admin_audit (actor_id, kind, action, target_id, target_label, detail)
    values (me, 'role', case when tg_op = 'DELETE' then 'role_remove' else 'role_add' end, r.person_id, coalesce(nm, ''),
            jsonb_build_object('role', r.role, 'team', r.team, 'year', r.year));
  end if;
  return null;
end $$;
comment on function public.audit_change() is '관리 기록 — 잠금·보는 사람·삭제/복원·가입 승인·직분(로그인한 사람이 한 일만 · 0113)';

drop trigger if exists trg_cards_audit on public.cards;
create trigger trg_cards_audit after update of locked, deleted_at on public.cards
  for each row execute function public.audit_change();
drop trigger if exists trg_projects_audit on public.projects;
create trigger trg_projects_audit after update of visibility, deleted_at on public.projects
  for each row execute function public.audit_change();
drop trigger if exists trg_profiles_audit on public.profiles;
create trigger trg_profiles_audit after update of approved on public.profiles
  for each row execute function public.audit_change();
drop trigger if exists trg_people_roles_audit on public.people_roles;
create trigger trg_people_roles_audit after insert or update or delete on public.people_roles
  for each row execute function public.audit_change();

-- ── 권한 ────────────────────────────────────────────────────────────────────
revoke all on function public.set_feedback_status(uuid, text) from public, anon;
revoke all on function public.report_client_error(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.set_feedback_status(uuid, text) to authenticated;
grant execute on function public.report_client_error(text, text, text, text, text, text, text) to authenticated;
-- 트리거 함수는 RPC로 부를 일이 없다(0101 ①)
revoke execute on function public.guard_notif_off() from public, anon, authenticated;
revoke execute on function public.notifications_respect_off() from public, anon, authenticated;
revoke execute on function public.feedback_rate() from public, anon, authenticated;
revoke execute on function public.audit_change() from public, anon, authenticated;

-- ── 보존 기간 — 오류·답 시간은 90일 · 관리 기록은 1년(0012와 같은 크론 · 같은 이름이면 갱신) ─────────
select cron.schedule(
  'purge-ops-logs',
  '45 19 * * *',
  $$delete from public.client_errors where last_seen < now() - interval '90 days';
    delete from public.ai_timings where at < now() - interval '90 days';
    delete from public.admin_audit where at < now() - interval '1 year'$$
);

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check';   -- feedback_fixed 포함
--   select with_check from pg_policies where policyname = 'notifications_insert_authenticated';   -- feedback_fixed 없음(0103 그대로)
--   select tablename, policyname, cmd from pg_policies where tablename in ('feedback','client_errors','ai_timings','admin_audit')
--      or policyname like 'feedback_shots%';                                                       -- 일곱
--   select tgname from pg_trigger where tgname in ('trg_profiles_notif_off','trg_notifications_off','trg_feedback_rate',
--     'trg_cards_audit','trg_projects_audit','trg_profiles_audit','trg_people_roles_audit');      -- 일곱
--   select public.notif_allowed('mention', '{task.mention}'), public.notif_allowed('feedback_fixed', '{task,worship,group,join}');  -- f, t
--   select id, public, file_size_limit from storage.buckets where id = 'feedback';                -- f, 5242880
--   -- 리허설: 레포 밖 SQL(보고에 경로) — 바깥 begin … rollback 안에서 본인 피드백 넣기 · 남의 칸으로 넣기 거절 · 회원은 남의 피드백 0줄 ·
--   --   마스터 해결 → 알림 한 줄 · 두 번째는 null · 회원의 set_feedback_status 42501 · 끈 종류 알림은 안 들어감 · 오류 보고 upsert count 2 ·
--   --   잠금·보는 사람·직분이 관리 기록에 남음 · 회원은 관리 기록·오류·답 시간 0줄.
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   begin;
--   select cron.unschedule('purge-ops-logs');
--   drop trigger if exists trg_people_roles_audit on public.people_roles;
--   drop trigger if exists trg_profiles_audit on public.profiles;
--   drop trigger if exists trg_projects_audit on public.projects;
--   drop trigger if exists trg_cards_audit on public.cards;
--   drop function if exists public.audit_change();
--   drop table if exists public.admin_audit;
--   drop table if exists public.ai_timings;
--   drop function if exists public.report_client_error(text, text, text, text, text, text, text);
--   drop table if exists public.client_errors;
--   drop policy if exists feedback_shots_select_master on storage.objects;
--   drop policy if exists feedback_shots_insert_own on storage.objects;
--   -- 버킷은 안의 사진을 먼저 지워야 지워진다: delete from storage.objects where bucket_id = 'feedback'; delete from storage.buckets where id = 'feedback';
--   drop function if exists public.set_feedback_status(uuid, text);
--   drop trigger if exists trg_feedback_rate on public.feedback;
--   drop function if exists public.feedback_rate();
--   drop table if exists public.feedback;
--   delete from public.notifications where kind = 'feedback_fixed';
--   alter table public.notifications drop constraint if exists notifications_kind_check;
--   alter table public.notifications add constraint notifications_kind_check
--     check (kind in ('mention','reply','assign','due_soon','approval','reaction',
--                     'worship_today','service_published','note_shared',
--                     'club_apply','club_accepted','meeting_new','approved','guide_pinned','meeting_tomorrow','assignee_comment','lock_reset'));
--   drop trigger if exists trg_notifications_off on public.notifications;
--   drop function if exists public.notifications_respect_off();
--   drop function if exists public.notif_allowed(text, text[]);
--   drop function if exists public.notif_slot(text);
--   drop trigger if exists trg_profiles_notif_off on public.profiles;
--   drop function if exists public.guard_notif_off();
--   alter table public.profiles drop constraint if exists profiles_notif_off_check;
--   alter table public.profiles drop column if exists notif_off;
--   commit;
