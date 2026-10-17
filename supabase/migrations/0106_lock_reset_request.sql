-- ============================================================================
-- 0106 — 잠긴 업무 비밀번호 재설정 요청 (v5 1묶음 B · 시안 승인 2026-10-17 · 0099·0100 업무 잠금의 뒤)
-- ----------------------------------------------------------------------------
-- 잠긴 업무를 못 여는 사람이 잠금 판의 `비밀번호를 까먹었어요` → 확인 → 요청한다. 요청은 누가·언제로 남고(card_lock_requests),
-- 마스터에게 앱 안 알림(kind 'lock_reset') + 푸시(앱이 돌려받은 마스터 id로 /api/push)가 간다. 마스터는 그 업무 보기 화면 위 한 줄에서
-- `새 비밀번호 설정`(잠그기와 같은 두 칸) → 해시를 바꾼다(card_secrets · 0099의 규칙 그대로 hex(sha256(소금‖비밀번호))).
--
-- 표
--   card_lock_requests(card_id, profile_id, at)  요청. 읽기는 본인 행 · 마스터는 전부. 쓰기 정책 없음(함수·트리거만)
--
-- 함수(security definer · search_path 고정 · anon 회수)
--   request_lock_reset(uuid) → uuid[]   못 여는 사람만 요청한다(안 잠겼거나 열 수 있으면 빈 배열). 그 사람의 첫 요청이면
--                                       마스터(남긴 계정 · 환송 제외 · 본인 제외)마다 알림 한 줄을 넣고 그 id를 돌려준다 —
--                                       앱이 그 id로 푸시를 부탁한다. 이미 요청했으면 빈 배열(알림을 두 번 보내지 않는다)
--   reset_card_lock(uuid, text) → bool  마스터만. 새 해시 · 시도 기록을 걷는다. **맞혀 둔 계정(card_unlocks)은 그대로**
--                                       (시안 결정 — 잊은 사람만 새 비밀번호를 받는다 · 다시 설정과 다르다(0099 lock_card는 걷는다))
--
-- 트리거(요청이 낡으면 저절로 걷는다)
--   trg_card_secrets_clear_requests  비밀번호가 바뀌면(reset_card_lock · 만든 사람의 다시 설정) 그 업무의 요청 전부
--   trg_cards_clear_requests         잠금이 풀리면(unlock_owner) 그 업무의 요청 전부
--   trg_card_unlocks_clear_request   맞혀서 열리면 그 사람의 요청
--
-- 알림 종류 'lock_reset'은 **CHECK만** 넓힌다 — INSERT 정책에는 넣지 않는다(함수가 넣는 서버 쪽 종류다 · 넣으면 로그인한 누구나
-- 마스터에게 가짜 요청 알림을 만들 수 있다 · 0103의 due_soon·meeting_tomorrow와 같은 이유). 미리보기는 비운다(잠긴 업무 · 0100 트리거도 비운다).
-- 알림 문구는 앱이 정한다(services/notifyText.js — 아직 사용자 확인 전인 문구는 services/pendingCopy.js 한 곳에 모았다).
--
-- **코드보다 먼저 나간다**(§3-4). 코드가 먼저 나가도 오류 화면은 없다 — 업무 창이 요청 표를 못 읽으면 `비밀번호를 까먹었어요`를
-- 세우지 않고(modals.jsx), 마스터 한 줄도 서지 않는다. 옛 앱은 'lock_reset' 알림을 멘션 문구로 보여 준다(notifLine의 기본 갈래).
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 표 ──────────────────────────────────────────────────────────────────────
create table if not exists public.card_lock_requests (
  card_id    uuid not null references public.cards(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  at         timestamptz not null default now(),
  primary key (card_id, profile_id)
);
comment on table public.card_lock_requests is '잠긴 업무 비밀번호 재설정 요청 — 누가(남긴 계정)·언제(0106). 쓰기는 request_lock_reset·트리거만';
alter table public.card_lock_requests enable row level security;
revoke all on public.card_lock_requests from anon, authenticated;
grant select on public.card_lock_requests to authenticated;

drop policy if exists card_lock_requests_select on public.card_lock_requests;
create policy card_lock_requests_select on public.card_lock_requests for select to authenticated
  using (profile_id = any (array[(select auth.uid()), (select public.effective_uid())]) or (select public.is_master()));

-- ── 알림 종류 (CHECK만 · 0103 목록 + lock_reset) ─────────────────────────────
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction',
                  'worship_today', 'service_published', 'note_shared',
                  'club_apply', 'club_accepted', 'meeting_new',
                  'approved', 'guide_pinned', 'meeting_tomorrow', 'assignee_comment', 'lock_reset'));

-- ── 함수 ────────────────────────────────────────────────────────────────────
create or replace function public.request_lock_reset(c uuid) returns uuid[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me      uuid := public.effective_uid();
  k       record;
  n       int;
  masters uuid[];
begin
  if not public.is_approved() or me is null then raise exception 'not approved' using errcode = '42501'; end if;
  select id, locked, project_id into k from public.cards where id = c;
  if not found then raise exception 'no card' using errcode = 'P0002'; end if;
  if not public.can_see_card(c) then raise exception 'not visible' using errcode = '42501'; end if;
  if not k.locked or public.can_open_card(c) then return '{}'::uuid[]; end if;
  insert into public.card_lock_requests (card_id, profile_id) values (c, me)
  on conflict (card_id, profile_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return '{}'::uuid[]; end if;
  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[]) into masters
    from public.profiles p
   where p.merged_into is null and p.removed_at is null and p.id <> me
     and exists (select 1 from public.admins a where a.is_master and lower(a.email) = lower(coalesce(p.email, '')));
  -- actor_name은 0071 트리거가 보낸 사람(effective_uid)의 표시 이름으로 덮는다 · 미리보기는 0100 트리거도 비운다
  insert into public.notifications (recipient_id, actor_name, kind, card_id, project_id, preview)
  select m, '누군가', 'lock_reset', c, k.project_id, null from unnest(masters) m;
  return masters;
end $$;

create or replace function public.reset_card_lock(c uuid, pw text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k    record;
  salt text := gen_random_uuid()::text;
  h    text;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  if not public.is_master() then raise exception 'not master' using errcode = '42501'; end if;
  if coalesce(pw, '') = '' then raise exception 'empty password' using errcode = '22023'; end if;
  select id, locked into k from public.cards where id = c for update;
  if not found then raise exception 'no card' using errcode = 'P0002'; end if;
  if not k.locked then return false; end if;
  h := encode(sha256(convert_to(salt || pw, 'UTF8')), 'hex');
  update public.card_secrets set lock_hash = h, lock_salt = salt, updated_at = now() where card_id = c;
  if not found then
    insert into public.card_secrets (card_id, description, ai_summary, lock_hash, lock_salt) values (c, '', null, h, salt);
  end if;
  delete from public.card_unlock_tries where card_id = c;
  return true;
end $$;

revoke all on function public.request_lock_reset(uuid) from public, anon;
revoke all on function public.reset_card_lock(uuid, text) from public, anon;
grant execute on function public.request_lock_reset(uuid) to authenticated;
grant execute on function public.reset_card_lock(uuid, text) to authenticated;

-- ── 낡은 요청 걷기 ──────────────────────────────────────────────────────────
create or replace function public.clear_lock_requests() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'card_unlocks' then
    delete from public.card_lock_requests where card_id = new.card_id and profile_id = new.profile_id;
  else
    delete from public.card_lock_requests where card_id = new.card_id;
  end if;
  return null;
end $$;

comment on function public.clear_lock_requests() is
  '비밀번호가 바뀌면 그 업무의 재설정 요청을, 맞혀서 열리면 그 사람의 요청을 걷는다(0106) — 잠금이 풀릴 때는 clear_lock_requests_unlocked';

-- card_secrets·card_unlocks 둘 다 card_id 칸이다 — 함수 하나가 표 이름으로 가른다(cards는 id라 아래 함수가 따로)
drop trigger if exists trg_card_secrets_clear_requests on public.card_secrets;
create trigger trg_card_secrets_clear_requests after update of lock_hash on public.card_secrets
  for each row when (new.lock_hash is distinct from old.lock_hash) execute function public.clear_lock_requests();
drop trigger if exists trg_card_unlocks_clear_request on public.card_unlocks;
create trigger trg_card_unlocks_clear_request after insert on public.card_unlocks
  for each row execute function public.clear_lock_requests();

create or replace function public.clear_lock_requests_unlocked() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.card_lock_requests where card_id = new.id;
  return null;
end $$;
drop trigger if exists trg_cards_clear_requests on public.cards;
create trigger trg_cards_clear_requests after update of locked on public.cards
  for each row when (old.locked and not new.locked) execute function public.clear_lock_requests_unlocked();

revoke execute on function public.clear_lock_requests() from public, anon, authenticated;
revoke execute on function public.clear_lock_requests_unlocked() from public, anon, authenticated;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check';   -- lock_reset 포함
--   select with_check from pg_policies where policyname = 'notifications_insert_authenticated';   -- lock_reset 없음(0103 그대로)
--   select proname, prosecdef from pg_proc where proname in ('request_lock_reset','reset_card_lock','clear_lock_requests',
--     'clear_lock_requests_unlocked');                                                            -- 넷 다 t
--   select tgname from pg_trigger where tgname in ('trg_card_secrets_clear_requests','trg_card_unlocks_clear_request','trg_cards_clear_requests');
--   -- 리허설: 레포 밖 SQL(보고에 경로) — 바깥 begin … rollback 안에서 만든 사람이 잠그고 · 못 여는 사람이 요청(마스터 알림 · 두 번째는 빈 배열)
--   --   · 다른 회원은 그 요청을 못 본다 · 마스터 아닌 사람의 reset_card_lock은 42501 · 마스터가 설정하면 요청이 걷히고 새 비밀번호로 열린다.
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   begin;
--   delete from public.notifications where kind = 'lock_reset';
--   alter table public.notifications drop constraint if exists notifications_kind_check;
--   alter table public.notifications add constraint notifications_kind_check
--     check (kind in ('mention','reply','assign','due_soon','approval','reaction',
--                     'worship_today','service_published','note_shared',
--                     'club_apply','club_accepted','meeting_new','approved','guide_pinned','meeting_tomorrow','assignee_comment'));
--   drop trigger if exists trg_cards_clear_requests on public.cards;
--   drop trigger if exists trg_card_unlocks_clear_request on public.card_unlocks;
--   drop trigger if exists trg_card_secrets_clear_requests on public.card_secrets;
--   drop function if exists public.clear_lock_requests_unlocked();
--   drop function if exists public.clear_lock_requests();
--   drop function if exists public.reset_card_lock(uuid, text);
--   drop function if exists public.request_lock_reset(uuid);
--   drop table if exists public.card_lock_requests;
--   commit;
