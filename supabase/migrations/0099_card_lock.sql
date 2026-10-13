-- ============================================================================
-- 0099 — 업무 잠금(비밀번호) · 누가 잠갔는지 (사용자 결정 2026-10-13 · 20차 묶음 ⑨)
-- ----------------------------------------------------------------------------
-- 시안 https://claude.ai/artifact/CYcKxtnnGp6miyJmDY9fgo 맨 아래 '⑨ 업무 잠금'. **진짜 잠금이다** — 첨부·참고 링크의
-- 비밀번호(0023·0053 · 화면 가림)와 다르다. 잠긴 업무의 본문·댓글·첨부·같이 쓰기·버전 기록·문서 임베딩·활동은
-- **서버(RLS)가** 막는다. 제목·상태·담당 팀·담당자·마감·하위 업무 칸(cards 행)은 그대로 모두에게 읽힌다.
--
-- 여는 사람(can_open_card) = 잠기지 않았거나 · 만든 사람(created_by — 남긴 계정 포함) · 마스터 · 비밀번호를 맞힌
-- 계정(card_unlocks — 한 번 맞히면 계속 열림). 관리자(마스터 아님)·교역자·리더는 열지 못한다.
--
-- 칸·표
--   cards.locked · locked_by · locked_at      잠금 여부와 누가 언제(화면 문구 없음 · DB에만 — 사용자 결정)
--   projects.visibility_by · visibility_at   '리더만 보기'(0092)를 누가 언제 바꿨나 — 트리거가 적는다(위조 못 함)
--   card_secrets(card_id, description, ai_summary, lock_hash, lock_salt)
--       잠긴 동안의 **본문 거울**과 비밀번호 해시. 잠그는 순간 cards.description·ai_summary(3줄 요약 고정 — 본문에서
--       나온 글이다)를 여기로 옮기고 cards 쪽은 ''·null로 비운다 — 그러면 검색(스토어)·실시간 cards 행·서버 키로 읽는
--       위키·다붓이·크론이 본문을 아예 못 본다. 풀 때 되돌린다.
--       **해시는 cards가 아니라 여기 있다**(지시서의 cards.lock_hash에서 옮겼다) — cards는 승인된 누구나 읽어서 해시와
--       소금이 같이 나가면 짧은 비밀번호는 오프라인으로 바로 풀리고 아래 시도 제한이 뜻을 잃는다. 읽기는 여는 사람만이고,
--       **칸 권한으로 lock_hash·lock_salt는 아예 안 준다**(select 권한이 card_id·description·ai_summary·updated_at 넷뿐).
--       쓰기는 여는 사람이 description·ai_summary만(거울 트리거가 쓴다) — 해시는 함수만 쓴다.
--   card_unlocks(card_id, profile_id, at)    맞힌 계정. 읽기는 본인 행만 · 쓰기는 함수만(정책 없음)
--   card_unlock_tries(card_id, profile_id, at)  시도 기록 — **같은 사람 같은 업무 1분에 5회까지**(정책 없음 · 함수만)
--
-- 해시 규칙은 services/viewPw.js와 같다(PITFALLS 31-f): hex(sha256(salt || pw)) · 소금은 uuid 글자. 다만 여기서는
-- **서버가** 계산한다(비교도 서버 — 해시가 브라우저로 안 나간다). 게스트(localStorage)만 viewPw.js로 같은 계산을 한다.
--
-- 함수(전부 security definer · search_path 고정 · anon 실행 회수)
--   can_open_card(uuid)       위 판정. 없는 id·null은 참(가릴 것이 없다)
--   locked_hidden_ids()       **나에게서 가릴 id 한 벌** — 내가 못 여는 잠긴 업무 · 그 댓글 · 그 첨부. 마스터면 빈 배열.
--                             정책은 0092의 hidden_ids처럼 `(select public.locked_hidden_ids())`로 **질의마다 한 번**(InitPlan ·
--                             PITFALLS 31-l ①). 서버 키(auth.uid() 없음)에는 잠긴 것 전부다.
--   lock_card(uuid, text)     만든 사람만. 처음이면 본문을 card_secrets로 옮기고 잠근다 · 이미 잠겼으면 비밀번호만 바꾼다(다시 설정).
--                             어느 쪽이든 맞힌 계정(card_unlocks)·시도 기록을 걷는다 — 바꾼 비밀번호를 모르는 사람은 다시 막힌다.
--   unlock_card(uuid, text)   비밀번호 확인(서버) → 맞으면 card_unlocks에 내 행 · 틀리면 false · 1분에 5번 넘으면 false
--   unlock_owner(uuid)        잠금 해제 — 만든 사람 또는 마스터. 본문을 cards로 되돌리고 card_secrets·맞힌 계정을 걷는다
--
-- 보호 트리거(0071·0092 방식 — 예외 대신 옛 값으로 되돌린다)
--   trg_cards_guard_lock     클라이언트(authenticated)는 locked·locked_by·locked_at을 못 바꾼다 — 바꾸는 길은 위 함수뿐.
--                            함수는 security definer라 그 안의 UPDATE는 current_user가 함수 주인이다(리허설로 확인) —
--                            그래서 통과 조건은 `current_user`다. auth.uid()로 가르면 함수 안에서도 사용자 id가 남아 막힌다.
--   trg_cards_lock_mirror    잠긴 업무에 클라이언트가 description·ai_summary를 쓰면 — 여는 사람이면 card_secrets로 옮기고,
--                            아니면 버린다 — cards 쪽은 그대로 ''·null. 앱(cloudSync)은 지금처럼 cards에 쓰고 이 트리거가
--                            거울을 card_secrets로 돌린다(옛 앱·통째 upsert도 본문을 cards에 흘리지 못한다). 빈 본문은 앱이
--                            null로 보내므로(cardPatch) '' → null도 '바뀜'으로 잡혀 card_secrets가 ''가 된다.
--   trg_projects_visibility_stamp  visibility가 바뀌면 visibility_by(남긴 계정)·visibility_at을 적는다 · 그 밖에는 두 칸을 옛 값으로
--                            (클라이언트가 두 칸을 위조하지 못한다). 0092의 guard(이름 순서상 먼저 돈다)가 되돌린 뒤에 본다.
--
-- 정책은 **늘리지 않는다**(§6-31-a) — 0092·0093이 만든 지금 본문 그대로에 `and coalesce(X <> all ((select
-- public.locked_hidden_ids())::uuid[]), true)`만 더한다. 새 표 셋은 정책이 처음 생기는 것이다(card_secrets 둘 ·
-- card_unlocks 하나 — 모두 그 표에만 걸린다).
--   comments(넷) · comment_reactions(셋 — 댓글 id) · files(넷 — 업무 갈래 안에서만) · activity(select만 — 잠긴 업무에서
--   상태를 바꾸는 사람의 활동 기록 쓰기는 막지 않는다 · 읽기만 여는 사람에게) · card_docs · card_doc_updates(둘) ·
--   card_doc_versions(둘) · doc_vec(업무·댓글·첨부 조각) · 같이 쓰기 채널 둘(coedit:<업무 id>) · storage attachments(읽기).
--   cards·card_teams·card_assignees·resource_links는 그대로(제목·칩·담당은 보인다 · 업무 링크는 업무 창에 없다 — §6-35).
-- 같이 쓰기 함수 셋(card_doc_seed·compact·baseline — security definer라 RLS 밖)은 맨 앞에 can_open_card 한 줄을 더한다.
--
-- 실시간: comments·files·activity·comment_reactions의 postgres_changes는 받는 사람의 SELECT 정책을 타서 잠긴 업무의 것이
-- 안 간다. cards 행은 그대로 가는데 description이 ''라 본문이 안 실린다. 잠그고 푸는 순간은 cards UPDATE(본문을 옮기며)라
-- 모두의 화면이 그 카드를 다시 읽는다(cloudSync.loadCardPatch가 card_secrets를 같이 읽는다 — 여는 사람에게만 행이 온다).
-- card_secrets·card_unlocks는 발행 목록에 넣지 않는다.
--
-- 남는 것: 드라이브 첨부는 링크를 이미 받은 사람에게 그대로 열린다(0023 한계 · 리더 프로젝트와 같다) · 잠그기 전에
-- 만든 알림의 미리보기(notifications.preview)와 다붓이 답 캐시는 그대로다(받는 사람 본인 것 · 캐시는 묶음 ⑧이 거른다).
--
-- **코드보다 먼저 나간다**(§3-4). 옛 앱은 locked를 모르고 '*'로 읽어 깨질 곳이 없다 — 잠긴 업무가 하나도 없으니 정책이
-- 바꾸는 결과도 없다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 칸 ──────────────────────────────────────────────────────────────────────
alter table public.cards add column if not exists locked boolean not null default false;
alter table public.cards add column if not exists locked_by uuid references public.profiles(id) on delete set null;
alter table public.cards add column if not exists locked_at timestamptz;
comment on column public.cards.locked is '업무 잠금(0099) — 참이면 본문·댓글·첨부·같이 쓰기·임베딩·활동이 여는 사람에게만 읽힌다. 바꾸는 길은 lock_card·unlock_owner뿐';
comment on column public.cards.locked_by is '잠근 사람(남긴 계정 · 0099) — 화면 문구 없음';
comment on column public.cards.locked_at is '잠근 시각(0099)';
create index if not exists cards_locked_idx on public.cards (id) where locked;

alter table public.projects add column if not exists visibility_by uuid references public.profiles(id) on delete set null;
alter table public.projects add column if not exists visibility_at timestamptz;
comment on column public.projects.visibility_by is '보는 사람(0092 visibility)을 마지막으로 바꾼 사람(남긴 계정 · 0099 트리거가 적는다)';
comment on column public.projects.visibility_at is '보는 사람을 마지막으로 바꾼 시각(0099)';

-- ── 표 ──────────────────────────────────────────────────────────────────────
create table if not exists public.card_secrets (
  card_id     uuid primary key references public.cards(id) on delete cascade,
  description text not null default '',
  ai_summary  text,
  lock_hash   text not null,
  lock_salt   text not null,
  updated_at  timestamptz not null default now()
);
comment on table public.card_secrets is '잠긴 업무의 본문 거울과 비밀번호 해시(0099) — 읽기는 여는 사람만 · 해시 두 칸은 칸 권한으로 안 준다';
alter table public.card_secrets enable row level security;

create table if not exists public.card_unlocks (
  card_id    uuid not null references public.cards(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  at         timestamptz not null default now(),
  primary key (card_id, profile_id)
);
comment on table public.card_unlocks is '잠긴 업무의 비밀번호를 맞힌 계정(남긴 계정 · 0099) — 쓰기는 unlock_card만';
alter table public.card_unlocks enable row level security;

create table if not exists public.card_unlock_tries (
  card_id    uuid not null references public.cards(id) on delete cascade,
  profile_id uuid not null,
  at         timestamptz not null default now()
);
create index if not exists card_unlock_tries_idx on public.card_unlock_tries (card_id, profile_id, at);
comment on table public.card_unlock_tries is '비밀번호 시도 기록(0099) — 같은 사람 같은 업무 1분에 5회까지 · 함수만 읽고 쓴다(정책 없음)';
alter table public.card_unlock_tries enable row level security;

-- 칸 권한 — 해시 두 칸은 아무에게도 안 준다(여는 사람에게도). 시도 기록은 표째로 안 준다.
revoke all on public.card_secrets from anon, authenticated;
grant select (card_id, description, ai_summary, updated_at) on public.card_secrets to authenticated;
grant update (description, ai_summary, updated_at) on public.card_secrets to authenticated;
revoke all on public.card_unlocks from anon, authenticated;
grant select on public.card_unlocks to authenticated;
revoke all on public.card_unlock_tries from anon, authenticated;

-- ── 판정 함수 ───────────────────────────────────────────────────────────────
create or replace function public.can_open_card(c uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select c is null
      or not exists (select 1 from public.cards k where k.id = c and k.locked)
      or exists (select 1 from public.cards k where k.id = c
                  and k.created_by = any (array[auth.uid(), public.effective_uid()]))
      or exists (select 1 from public.card_unlocks u where u.card_id = c
                  and u.profile_id = any (array[auth.uid(), public.effective_uid()]))
      or public.is_master();
$$;

-- RLS 밖에서 모은다 — 정책 안에서 comments를 다시 읽으면 안 보이는 댓글이 빠져서 '가릴 것 없음'으로 뒤집힌다(31-l ②)
create or replace function public.locked_hidden_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  with lk as (
    select k.id from public.cards k
     where k.locked
       and not coalesce(k.created_by = any (array[auth.uid(), public.effective_uid()]), false)
       and not exists (select 1 from public.card_unlocks u where u.card_id = k.id
                        and u.profile_id = any (array[auth.uid(), public.effective_uid()])))
  select case when not exists (select 1 from lk) or public.is_master() then '{}'::uuid[]
              else array(select id from lk
                         union all select c.id from public.comments c join lk on lk.id = c.card_id
                         union all select f.id from public.files f join lk on lk.id = f.card_id) end;
$$;

-- ── 잠그기 · 열기 · 풀기 ────────────────────────────────────────────────────
-- 해시 = hex(sha256(소금 || 비밀번호)) — services/viewPw.js와 같은 규칙(PITFALLS 31-f)
create or replace function public.lock_card(c uuid, pw text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k    record;
  salt text := gen_random_uuid()::text;
  h    text;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  if coalesce(pw, '') = '' then raise exception 'empty password' using errcode = '22023'; end if;
  select id, created_by, locked, description, ai_summary into k from public.cards where id = c for update;
  if not found then raise exception 'no card' using errcode = 'P0002'; end if;
  if not coalesce(k.created_by = any (array[auth.uid(), public.effective_uid()]), false) then
    raise exception 'not the author' using errcode = '42501';
  end if;
  if not public.can_see_card(c) then raise exception 'not visible' using errcode = '42501'; end if;
  h := encode(sha256(convert_to(salt || pw, 'UTF8')), 'hex');
  if k.locked then
    -- 다시 설정 — 본문 거울은 그대로, 비밀번호만
    insert into public.card_secrets (card_id, description, ai_summary, lock_hash, lock_salt)
    values (c, '', null, h, salt)
    on conflict (card_id) do update set lock_hash = excluded.lock_hash, lock_salt = excluded.lock_salt, updated_at = now();
  else
    insert into public.card_secrets (card_id, description, ai_summary, lock_hash, lock_salt)
    values (c, coalesce(k.description, ''), k.ai_summary, h, salt)
    on conflict (card_id) do update set description = excluded.description, ai_summary = excluded.ai_summary,
      lock_hash = excluded.lock_hash, lock_salt = excluded.lock_salt, updated_at = now();
    update public.cards
       set locked = true, locked_by = public.effective_uid(), locked_at = now(), description = '', ai_summary = null
     where id = c;
  end if;
  delete from public.card_unlocks where card_id = c;
  delete from public.card_unlock_tries where card_id = c;
  return true;
end $$;

create or replace function public.unlock_card(c uuid, pw text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me    uuid := public.effective_uid();
  tries int;
  h     text;
  salt  text;
begin
  if not public.is_approved() or me is null then return false; end if;
  if public.can_open_card(c) then return true; end if;   -- 안 잠겼거나 이미 열 수 있다
  delete from public.card_unlock_tries where at < now() - interval '1 minute';
  select count(*) into tries from public.card_unlock_tries
   where card_id = c and profile_id = me and at > now() - interval '1 minute';
  if tries >= 5 then return false; end if;
  insert into public.card_unlock_tries (card_id, profile_id) values (c, me);
  select lock_hash, lock_salt into h, salt from public.card_secrets where card_id = c;
  if h is null or encode(sha256(convert_to(coalesce(salt, '') || coalesce(pw, ''), 'UTF8')), 'hex') <> h then
    return false;
  end if;
  insert into public.card_unlocks (card_id, profile_id) values (c, me)
  on conflict (card_id, profile_id) do update set at = now();
  return true;
end $$;

create or replace function public.unlock_owner(c uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k    record;
  d    text;
  s    text;
  have boolean;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  select id, created_by, locked into k from public.cards where id = c for update;
  if not found then raise exception 'no card' using errcode = 'P0002'; end if;
  if not (coalesce(k.created_by = any (array[auth.uid(), public.effective_uid()]), false) or public.is_master()) then
    raise exception 'not the author' using errcode = '42501';
  end if;
  if not k.locked then return true; end if;
  select description, ai_summary, true into d, s, have from public.card_secrets where card_id = c;
  if coalesce(have, false) then
    update public.cards set locked = false, locked_by = null, locked_at = null, description = d, ai_summary = s where id = c;
  else
    update public.cards set locked = false, locked_by = null, locked_at = null where id = c;
  end if;
  delete from public.card_secrets where card_id = c;
  delete from public.card_unlocks where card_id = c;
  delete from public.card_unlock_tries where card_id = c;
  return true;
end $$;

revoke all on function public.can_open_card(uuid) from public, anon;
revoke all on function public.locked_hidden_ids() from public, anon;
revoke all on function public.lock_card(uuid, text) from public, anon;
revoke all on function public.unlock_card(uuid, text) from public, anon;
revoke all on function public.unlock_owner(uuid) from public, anon;
grant execute on function public.can_open_card(uuid) to authenticated, service_role;
grant execute on function public.locked_hidden_ids() to authenticated, service_role;
grant execute on function public.lock_card(uuid, text) to authenticated;
grant execute on function public.unlock_card(uuid, text) to authenticated;
grant execute on function public.unlock_owner(uuid) to authenticated;

-- ── 보호 트리거 ─────────────────────────────────────────────────────────────
create or replace function public.guard_card_lock() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- 잠금 함수 안(current_user = 함수 주인) · 서버 키(service_role) · psql은 통과
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.locked := false; new.locked_by := null; new.locked_at := null;
  else
    new.locked := old.locked; new.locked_by := old.locked_by; new.locked_at := old.locked_at;
  end if;
  return new;
end $$;

comment on function public.guard_card_lock() is
  '클라이언트는 cards.locked·locked_by·locked_at을 못 바꾼다 — 되돌리기만 하고 예외는 없다(0099 · lock_card·unlock_owner만)';

drop trigger if exists trg_cards_guard_lock on public.cards;
create trigger trg_cards_guard_lock before insert or update of locked, locked_by, locked_at on public.cards
  for each row execute function public.guard_card_lock();

-- 부른 사람 권한으로 card_secrets를 고친다(여는 사람만 update 정책을 지난다 — 못 여는 사람의 글은 그냥 버려진다)
create or replace function public.mirror_locked_card() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if not new.locked or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.description is distinct from old.description or new.ai_summary is distinct from old.ai_summary then
    if public.can_open_card(new.id) then
      update public.card_secrets
         set description = case when new.description is distinct from old.description then coalesce(new.description, '') else description end,
             ai_summary  = case when new.ai_summary is distinct from old.ai_summary then new.ai_summary else ai_summary end,
             updated_at  = now()
       where card_id = new.id;
    end if;
    new.description := old.description;
    new.ai_summary := old.ai_summary;
  end if;
  return new;
end $$;

comment on function public.mirror_locked_card() is
  '잠긴 업무의 본문·요약 쓰기를 card_secrets로 돌린다(여는 사람만) — cards 쪽은 비운 채로(0099)';

drop trigger if exists trg_cards_lock_mirror on public.cards;
create trigger trg_cards_lock_mirror before update of description, ai_summary on public.cards
  for each row execute function public.mirror_locked_card();

create or replace function public.stamp_project_visibility() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.visibility = 'leaders' then
      new.visibility_by := public.effective_uid(); new.visibility_at := now();
    else
      new.visibility_by := null; new.visibility_at := null;
    end if;
  elsif new.visibility is distinct from old.visibility then
    new.visibility_by := public.effective_uid(); new.visibility_at := now();
  else
    new.visibility_by := old.visibility_by; new.visibility_at := old.visibility_at;
  end if;
  return new;
end $$;

comment on function public.stamp_project_visibility() is
  '보는 사람(visibility)이 바뀌면 누가·언제를 적는다 · 그 밖에는 두 칸을 옛 값으로(0099)';

drop trigger if exists trg_projects_visibility_stamp on public.projects;
create trigger trg_projects_visibility_stamp before insert or update on public.projects
  for each row execute function public.stamp_project_visibility();

-- ── 새 표의 정책(처음 만드는 것 · 그 표에만 걸린다) ─────────────────────────
drop policy if exists card_secrets_select on public.card_secrets;
create policy card_secrets_select on public.card_secrets for select to authenticated
  using (public.is_approved() and public.can_open_card(card_id));
drop policy if exists card_secrets_update on public.card_secrets;
create policy card_secrets_update on public.card_secrets for update to authenticated
  using (public.is_approved() and public.can_open_card(card_id))
  with check (public.is_approved() and public.can_open_card(card_id));
drop policy if exists card_unlocks_select on public.card_unlocks;
create policy card_unlocks_select on public.card_unlocks for select to authenticated
  using (profile_id = any (array[auth.uid(), public.effective_uid()]));

-- ── 있는 정책: 본문만 조인다(§6-31-a) — 0092·0093이 만든 지금 식 + `and` 하나 ─────
-- 아래 `coalesce(X <> all ((select public.locked_hidden_ids())::uuid[]), true)` = "X가 나에게서 잠긴 id가 아니다"
alter policy comments_select on public.comments
  using (public.is_approved() and auth.role() = 'authenticated'
         and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true)
         and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true));
alter policy comments_insert on public.comments
  with check (
    public.is_approved() and auth.role() = 'authenticated'
    and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
    and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true)
    and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true)
  );
alter policy comments_update on public.comments
  using (public.is_approved() and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
         and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true)
         and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true))
  with check (public.is_approved() and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
         and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true)
         and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true));
alter policy comments_delete on public.comments
  using (public.is_approved() and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
         and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true)
         and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true));

-- comment_reactions — card_id 칸이 없다. locked_hidden_ids에 댓글 id가 들어 있다
alter policy comment_reactions_select on public.comment_reactions
  using (public.is_approved() and coalesce(comment_id <> all ((select public.hidden_ids())::uuid[]), true)
         and coalesce(comment_id <> all ((select public.locked_hidden_ids())::uuid[]), true));
alter policy comment_reactions_insert on public.comment_reactions
  with check (public.is_approved() and user_id = public.effective_uid()
              and coalesce(comment_id <> all ((select public.hidden_ids())::uuid[]), true)
              and coalesce(comment_id <> all ((select public.locked_hidden_ids())::uuid[]), true));
alter policy comment_reactions_delete on public.comment_reactions
  using (user_id = any (array[auth.uid(), public.effective_uid()])
         and coalesce(comment_id <> all ((select public.hidden_ids())::uuid[]), true)
         and coalesce(comment_id <> all ((select public.locked_hidden_ids())::uuid[]), true));

-- files — 업무 첨부 갈래(service_id is null) 안에만 더한다. 주보 갈래·모임 갈래(0093의 정책 다섯)·CHECK는 그대로.
-- 모임 행은 card_id가 null이라 coalesce(…, true)로 그대로 지난다.
alter policy files_select on public.files
  using (public.is_approved() and auth.role() = 'authenticated'
         and ((service_id is null and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true)
               and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true))
              or exists (select 1 from public.services s
                          where s.id = files.service_id and (s.status = 'published' or public.can_edit_service()))));
alter policy files_insert on public.files
  with check (
    public.is_approved() and auth.role() = 'authenticated'
    and ((service_id is null and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true)
          and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true))
         or public.can_edit_service())
    and (uploaded_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
  );
alter policy files_update on public.files
  using (public.is_approved() and auth.role() = 'authenticated'
         and ((service_id is null and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true)
               and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true))
              or public.can_edit_service()))
  with check (public.is_approved() and auth.role() = 'authenticated'
         and ((service_id is null and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true)
               and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true))
              or public.can_edit_service()));
alter policy files_delete on public.files
  using (public.is_approved() and
         case when service_id is null
              then coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true)
                   and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true)
                   and (uploaded_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
              else public.can_edit_service() end);

-- activity — 읽기만. 쓰기(activity_insert)는 그대로: 잠긴 업무의 상태를 옮기는 사람도 기록은 남긴다(못 읽을 뿐)
alter policy activity_select on public.activity
  using (public.is_approved() and auth.role() = 'authenticated'
         and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true)
         and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true));

-- 같이 쓰기 표 셋(0084)
alter policy card_docs_select on public.card_docs
  using (public.is_approved() and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true)
         and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true));
alter policy card_doc_updates_select on public.card_doc_updates
  using (public.is_approved() and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true)
         and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true));
alter policy card_doc_updates_insert on public.card_doc_updates
  with check (public.is_approved() and by = any (array[auth.uid(), public.effective_uid()])
              and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true)
              and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true));
alter policy card_doc_versions_select on public.card_doc_versions
  using (public.is_approved() and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true)
         and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true));
alter policy card_doc_versions_insert on public.card_doc_versions
  with check (public.is_approved() and by = any (array[auth.uid(), public.effective_uid()])
              and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true)
              and coalesce(card_id <> all ((select public.locked_hidden_ids())::uuid[]), true));

-- doc_vec(0074 · 0096) — 업무·댓글·첨부 조각만(위키 장·주보 조각은 셋 다 비어 그대로 지난다)
alter policy doc_vec_select on public.doc_vec
  using (public.is_approved()
         and coalesce(coalesce(card_id, comment_id, file_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true)
         and coalesce(coalesce(card_id, comment_id, file_id) <> all ((select public.locked_hidden_ids())::uuid[]), true));

-- 같이 쓰기 채널 `coedit:<업무 id>`(0084 · 0092) — 글자로 견준다
alter policy coedit_channel_read on realtime.messages
  using (left(realtime.topic(), 7) = 'coedit:' and realtime.messages.extension in ('broadcast', 'presence') and public.is_approved()
         and substr(realtime.topic(), 8) <> all ((select public.hidden_ids())::text[])
         and substr(realtime.topic(), 8) <> all ((select public.locked_hidden_ids())::text[]));
alter policy coedit_channel_write on realtime.messages
  with check (left(realtime.topic(), 7) = 'coedit:' and realtime.messages.extension in ('broadcast', 'presence') and public.is_approved()
         and substr(realtime.topic(), 8) <> all ((select public.hidden_ids())::text[])
         and substr(realtime.topic(), 8) <> all ((select public.locked_hidden_ids())::text[]));

-- 레거시 Storage `attachments`(객체 0개) — 경로 둘째 도막이 업무 id
alter policy attachments_select_authenticated on storage.objects
  using (bucket_id = 'attachments' and public.is_approved()
         and coalesce((storage.foldername(name))[2] <> all ((select public.hidden_ids())::text[]), true)
         and coalesce((storage.foldername(name))[2] <> all ((select public.locked_hidden_ids())::text[]), true));

-- ── 같이 쓰기 함수 셋 — 0092 몸통 그대로 + can_open_card 한 줄 ─────────────
create or replace function public.card_doc_seed(p_card uuid, p_state text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  if not public.can_see_card(p_card) then raise exception 'not visible' using errcode = '42501'; end if;
  if not public.can_open_card(p_card) then raise exception 'locked' using errcode = '42501'; end if;
  insert into public.card_docs(card_id, state, upto) values (p_card, p_state, 0)
  on conflict (card_id) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.card_doc_compact(p_card uuid, p_upto bigint, p_state text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  cur  bigint;
  top  bigint;
  safe bigint;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  if not public.can_see_card(p_card) then raise exception 'not visible' using errcode = '42501'; end if;
  if not public.can_open_card(p_card) then raise exception 'locked' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('card_doc_compact:' || p_card::text, 0));
  select upto into cur from public.card_docs where card_id = p_card for update;
  select max(id) into top from public.card_doc_updates where card_id = p_card;
  -- 아직 없는 id까지 접는다고 하면 거절(그 아래로 나중에 들어올 기록을 불러오기가 건너뛴다)
  if p_upto > greatest(coalesce(cur, 0), coalesce(top, 0)) then
    raise exception 'upto % is beyond the log', p_upto using errcode = '22023';
  end if;
  -- 커밋 차례가 id 차례와 다를 수 있어서 30초 넘게 지난 기록까지만(0084 머리말)
  select coalesce(max(id), 0) into safe from public.card_doc_updates
   where card_id = p_card and id <= p_upto and at < now() - interval '30 seconds';
  if cur is not null and safe <= cur then return false; end if;
  insert into public.card_docs(card_id, state, upto, updated_at) values (p_card, p_state, safe, now())
  on conflict (card_id) do update set state = excluded.state, upto = excluded.upto, updated_at = now();
  delete from public.card_doc_updates where card_id = p_card and id <= safe;
  return true;
end $$;

create or replace function public.card_doc_baseline(p_card uuid, p_md text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  if not public.can_see_card(p_card) then raise exception 'not visible' using errcode = '42501'; end if;
  if not public.can_open_card(p_card) then raise exception 'locked' using errcode = '42501'; end if;
  if coalesce(btrim(p_md), '') = '' then return false; end if;
  if exists (select 1 from public.card_doc_versions where card_id = p_card) then return false; end if;
  insert into public.card_doc_versions(client_id, card_id, by, at, md, added, removed, kind)
  select md5('baseline:' || c.id::text)::uuid, c.id, coalesce(c.updated_by, c.created_by), c.updated_at, p_md,
         (select count(*) from regexp_split_to_table(p_md, E'\n') l where btrim(l) <> ''), 0, 'baseline'
    from public.cards c where c.id = p_card
  on conflict (client_id) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select count(*) from cards where locked;                                             -- 0
--   select proname, prosecdef from pg_proc where proname in ('can_open_card','locked_hidden_ids','lock_card',
--     'unlock_card','unlock_owner');                                                     -- 다섯 다 t
--   select count(*) from pg_policies;                                                    -- 적용 전 + 3(새 표 둘의 정책 셋)
--   select tgname from pg_trigger where tgname in ('trg_cards_guard_lock','trg_cards_lock_mirror','trg_projects_visibility_stamp');
--   -- 리허설: begin; 이 파일 **본문을 begin/commit 줄 없이** 붙여 넣는다(\i로 이 파일을 넣으면 안의 commit이 바깥 트랜잭션을 닫는다);
--   --   잠그기는 만든 사람 claims로 select lock_card(…);
--   --   set local role authenticated; select set_config('request.jwt.claims', '{"sub":"<uuid>","email":"<메일>","role":"authenticated"}', true);
--   --   만든 사람 / 맞힌 사람 / 못 맞힌 사람 / 마스터로 comments·files·doc_vec·activity·card_secrets count → rollback;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   begin;
--   update public.cards c set description = s.description, ai_summary = s.ai_summary from public.card_secrets s where s.card_id = c.id;
--   -- (위 update는 trg_cards_lock_mirror를 지나므로 psql — current_user가 postgres인 자리 — 에서 돌린다)
--   -- 정책 열넷 + 채널 둘 + storage 하나를 0092의 식(각 줄의 locked_hidden_ids 줄만 뺀 것)으로 다시 alter policy:
--   --   comments(넷) · comment_reactions(셋) · files(넷) · activity_select · card_docs_select · card_doc_updates(둘) ·
--   --   card_doc_versions(둘) · doc_vec_select · coedit_channel_read/write · attachments_select_authenticated
--   -- 같이 쓰기 함수 셋은 0092의 몸통으로 다시 create or replace(can_open_card 줄만 빠진다)
--   drop trigger if exists trg_projects_visibility_stamp on public.projects;
--   drop trigger if exists trg_cards_lock_mirror on public.cards;
--   drop trigger if exists trg_cards_guard_lock on public.cards;
--   drop function if exists public.stamp_project_visibility();
--   drop function if exists public.mirror_locked_card();
--   drop function if exists public.guard_card_lock();
--   drop function if exists public.unlock_owner(uuid);
--   drop function if exists public.unlock_card(uuid, text);
--   drop function if exists public.lock_card(uuid, text);
--   drop table if exists public.card_unlock_tries;
--   drop table if exists public.card_unlocks;
--   drop table if exists public.card_secrets;
--   drop function if exists public.locked_hidden_ids();
--   drop function if exists public.can_open_card(uuid);
--   alter table public.projects drop column if exists visibility_at;
--   alter table public.projects drop column if exists visibility_by;
--   drop index if exists public.cards_locked_idx;
--   alter table public.cards drop column if exists locked_at;
--   alter table public.cards drop column if exists locked_by;
--   alter table public.cards drop column if exists locked;
--   commit;
