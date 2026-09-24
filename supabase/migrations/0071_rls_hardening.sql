-- ============================================================================
-- 0071 — 스스로 올릴 수 없는 칸을 막는다 (보안 감사 2026-09-24)
-- ----------------------------------------------------------------------------
-- 라이브 DB에서 ROLLBACK 트랜잭션으로 재현한 구멍들이다. 전부 "정책이 행은 보는데
-- **칸은 안 본다**"는 같은 모양이라 한 파일에 모았다.
--
-- ① profiles — 자기 행 UPDATE(`profiles_update`)가 **모든 칸**을 열어 두었다.
--    · 미승인·환송 계정이 `approved = true, removed_at = null` 한 문장으로 스스로 승인됐다.
--    · `merged_into = <마스터 id>`도 한 문장으로 들어갔다(with check `id = effective_uid()`는
--      옛 행 기준이라 통과한다) → `effective_uid()`가 마스터가 되어 마스터의 알림·개인 표
--      셋이 열렸고, 서버의 승인 확인(`api/approval.js`)도 merged_into를 믿어 같이 뚫렸다.
--    `profiles_insert`도 `auth.uid() = id`만 봐서, 행이 없으면 approved = true로 넣을 수 있었다.
--    → BEFORE INSERT OR UPDATE 트리거가 **관리자·서버 문맥이 아니면** 그 칸들을 옛 값으로
--      되돌린다(INSERT면 비운다). **예외를 던지지 않는다** — 내 정보 저장(`updateMyProfile`
--      upsert)이 행을 통째로 보낼 수 있고, 거기서 저장이 실패하면 안 된다.
--      서버 문맥 = `auth.uid()`가 없는 자리: psql · 서비스 키 · 가입 트리거(`handle_new_user`).
--      `merge_profiles`는 마스터가 부르므로 `is_admin()`으로 통과한다.
--      **트리거 이름은 `trg_sync_profile_email`보다 이름순 앞이어야 한다**(같은 시점의 트리거는
--      이름순으로 돈다) — 여기서 email을 비우면 그 트리거가 auth.users에서 다시 채운다.
--      HANDOFF §5 "before update 트리거에서 new.X = old.X 금지"와 부딪치지 않는다 — 조건부라서
--      psql 백필(auth.uid() 없음)은 그대로 먹힌다.
--    덤으로 `profiles_insert`가 남긴 계정 id도 받는다 — 합친 계정의 내 정보 저장(upsert)이
--    INSERT 정책에 걸려 실패하고 있었다(0063은 update 쪽만 열었다 · 아래 본문).
--
-- ② 작성자 칸 — `cards.created_by`·`files.uploaded_by`·`comments.author_id`·`activity.actor_id`.
--    기본값이 auth.uid()이고 앱은 이 칸을 보내지 않는데(`cloud.js` insert 넷), 보내면 **남의 이름으로**
--    들어갔고 UPDATE로도 바꿀 수 있었다(삭제 자격이 이 칸을 본다 — 0063).
--    → 같은 방식의 가드 트리거: 비관리자 UPDATE면 옛 값 유지, INSERT에서 내 id(auth.uid()·
--      effective_uid() 둘 중 하나)가 아니면 auth.uid()로 바꾼다. insert with check에도 같은 조건을
--      `and`로 감싼다(트리거가 먼저 돌아 걸릴 일은 없다 — 트리거를 누가 지워도 남는 둘째 겹).
--    두 id를 다 내 것으로 보는 이유는 §6-34-i — 합친 계정의 기본값은 auth.uid()다.
--
-- ③ comments_update — 승인된 누구나 **남의 댓글**을 고칠 수 있었다. comments_delete와 같은 모양으로.
--
-- ④ people_insert — 순장이 `people(is_pastor = true, profile_id = <아무 계정>)`을 넣으면 0069의
--    `people_pastor_to_profile`이 그 계정을 교역자로 올렸다(→ can_edit_service). 명단 추가
--    (`roster.addPerson`)는 이름·생일·팀만 보낸다 — 비관리자는 교역자·계정 연결 없이만 넣는다.
--
-- ⑤ notifications — `actor_name`을 아무 글자('관리자')로 넣을 수 있었다. 로그인 문맥이면
--    트리거가 보낸 사람(effective_uid)의 표시 이름으로 덮는다. 서버 배치·가입 알림(0022)은
--    auth.uid()가 없어 그대로다. 딥링크 CHECK(0053)는 `'/\t/evil.com'`을 통과시켰다 —
--    브라우저의 URL 파서가 탭·줄바꿈을 지우고 `\`를 `/`로 읽어 `//evil.com`이 된다.
--    공백류와 역슬래시를 막는다(지금 77건 중 걸리는 것 0건 — 확인하고 넣었다).
--
-- ⑥ recount_card(uuid)·fix_profile_team_id(uuid) — anon까지 실행할 수 있었다. 부르는 곳은
--    security definer 트리거 함수(tg_recount_card · 0068/0069 트리거)뿐이라 소유자 권한으로
--    돈다 — 바깥 실행 권한을 걷어도 트리거는 그대로다.
--
-- ⑦ storage — `attachments` 버킷 읽기·쓰기와 `content-images` 올리기가 **로그인만** 봤다.
--    승인 전 계정은 앱 화면에 들어오지 못하므로(App.jsx 대기 화면) 앱 동작은 그대로다.
--
-- **정책 수를 늘리지 않는다**(§6-31-a) — 전부 `alter policy`로 있는 정책의 본문만 바꾼다.
-- `projects_delete`(0021 전원 삭제)는 사용자 결정이라 건드리지 않는다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── ① profiles: 승인·환송·합치기·이메일 칸 ──────────────────────────────────
create or replace function public.guard_profile_columns() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- 서비스 키·psql·가입 트리거(auth.uid() 없음)와 관리자(merge_profiles 포함)는 그대로 둔다
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.approved := false; new.approved_at := null; new.approved_by := null;
    new.removed_at := null; new.removed_by := null; new.merged_into := null;
    new.email := null;      -- trg_sync_profile_email(이름 차례상 뒤)이 auth.users에서 채운다
    return new;
  end if;
  new.approved    := old.approved;    new.approved_at := old.approved_at;
  new.approved_by := old.approved_by; new.removed_at  := old.removed_at;
  new.removed_by  := old.removed_by;  new.merged_into := old.merged_into;
  new.email       := old.email;
  return new;
end $$;

comment on function public.guard_profile_columns() is
  '비관리자는 자기 프로필의 승인·환송·합치기·이메일 칸을 못 바꾼다 — 되돌리기만 하고 예외는 없다(0071)';

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before insert or update on public.profiles
  for each row execute function public.guard_profile_columns();

-- 합친 계정의 '내 정보' 저장이 **라이브에서 실패하고 있었다**(같은 감사에서 재현). 저장은
-- `updateMyProfile`의 upsert(id = 남긴 계정 · 0063)인데, ON CONFLICT DO UPDATE도 INSERT 정책의
-- with check를 **먼저** 본다 — `auth.uid() = id`라 42501. 남긴 계정 id도 받는다. 그 행은 언제나
-- 이미 있어서 새 행이 생길 일은 없고(PK), 위 트리거가 승인 칸을 막는다.
alter policy profiles_insert on public.profiles
  with check (id = any (array[auth.uid(), public.effective_uid()]));

-- ── ② 작성자 칸 ─────────────────────────────────────────────────────────────
-- 칸 이름은 트리거 인자로 받는다(표 넷이 같은 규칙). jsonb를 거쳐 읽고 쓴다 —
-- plpgsql은 `new.<변수>`를 못 쓴다.
create or replace function public.guard_author_column() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  col  text := tg_argv[0];
  cur  uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  keep uuid;
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    keep := (to_jsonb(old) ->> col)::uuid;
    if cur is distinct from keep then
      new := jsonb_populate_record(new, jsonb_build_object(col, keep));
    end if;
    return new;
  end if;
  if cur is null or not (cur = any (array[auth.uid(), public.effective_uid()])) then
    new := jsonb_populate_record(new, jsonb_build_object(col, auth.uid()));
  end if;
  return new;
end $$;

comment on function public.guard_author_column() is
  '작성자 칸(트리거 인자)을 비관리자가 남의 id로 넣거나 바꾸지 못하게 한다(0071)';

drop trigger if exists trg_cards_guard_author on public.cards;
create trigger trg_cards_guard_author before insert or update of created_by on public.cards
  for each row execute function public.guard_author_column('created_by');
drop trigger if exists trg_files_guard_author on public.files;
create trigger trg_files_guard_author before insert or update of uploaded_by on public.files
  for each row execute function public.guard_author_column('uploaded_by');
drop trigger if exists trg_comments_guard_author on public.comments;
create trigger trg_comments_guard_author before insert or update of author_id on public.comments
  for each row execute function public.guard_author_column('author_id');
-- activity에는 UPDATE 정책이 없다(덧붙이기만 하는 기록) — INSERT만 본다
drop trigger if exists trg_activity_guard_author on public.activity;
create trigger trg_activity_guard_author before insert on public.activity
  for each row execute function public.guard_author_column('actor_id');

-- insert with check — 0022가 감싼 본문(+0047의 files 갈래)을 그대로 두고 `and`만 더한다
alter policy cards_insert on public.cards
  with check (
    public.is_approved() and auth.role() = 'authenticated'
    and (created_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
  );
alter policy files_insert on public.files
  with check (
    public.is_approved() and auth.role() = 'authenticated'
    and (service_id is null or public.can_edit_service())
    and (uploaded_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
  );
alter policy comments_insert on public.comments
  with check (
    public.is_approved() and auth.role() = 'authenticated'
    and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
  );
alter policy activity_insert on public.activity
  with check (
    public.is_approved() and auth.role() = 'authenticated'
    and (actor_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
  );

-- ── ③ 댓글 고치기는 쓴 사람(두 id)·관리자만 — comments_delete(0063)와 같은 모양 ─
alter policy comments_update on public.comments
  using (public.is_approved() and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()))
  with check (public.is_approved() and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()));

-- ── ④ 명단 추가: 비관리자는 교역자·계정 연결 없이만 ─────────────────────────
alter policy people_insert on public.people
  with check (
    public.is_admin()
    or (
      public.is_approved()
      and (public.can_check_all_attendance() or public.leads_any_sun())
      and not is_pastor
      and profile_id is null
    )
  );

-- ── ⑤ 알림: 보낸 사람 이름은 DB가 적는다 · 딥링크 CHECK 조이기 ────────────────
create or replace function public.notifications_actor_name() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  nm text;
begin
  -- 서버 배치(api/push.js)·가입 알림(0022 notify_admins_on_signup)은 auth.uid()가 없다
  if auth.uid() is null then
    return new;
  end if;
  select nullif(btrim(p.display_name), '') into nm
    from public.profiles p where p.id = public.effective_uid();
  new.actor_name := left(coalesce(nm, new.actor_name), 100);
  return new;
end $$;

comment on function public.notifications_actor_name() is
  '로그인 문맥의 알림 INSERT는 actor_name을 보낸 사람(effective_uid)의 표시 이름으로 덮는다(0071)';

drop trigger if exists trg_notifications_actor_name on public.notifications;
create trigger trg_notifications_actor_name before insert on public.notifications
  for each row execute function public.notifications_actor_name();

alter table public.notifications drop constraint if exists notifications_link_check;
alter table public.notifications add constraint notifications_link_check
  check (link is null or (link like '/%' and link not like '//%' and link !~ '[\s\\]'
                          and char_length(link) <= 300));

-- ── ⑥ 아무도 직접 부르지 않는 함수 둘 ───────────────────────────────────────
revoke execute on function public.recount_card(uuid) from public, anon, authenticated;
revoke execute on function public.fix_profile_team_id(uuid) from public, anon, authenticated;

-- ── ⑦ storage: 승인 게이트 ──────────────────────────────────────────────────
alter policy "attachments_select_authenticated" on storage.objects
  using (bucket_id = 'attachments' and public.is_approved());
alter policy "attachments_insert_authenticated" on storage.objects
  with check (bucket_id = 'attachments' and public.is_approved());
alter policy "content_images_insert_own" on storage.objects
  with check (
    bucket_id = 'content-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   -- 트리거 여섯(프로필 가드가 이메일 트리거보다 이름순 앞)
--   select tgrelid::regclass, tgname from pg_trigger
--    where tgname in ('trg_profiles_guard','trg_sync_profile_email','trg_cards_guard_author',
--                     'trg_files_guard_author','trg_comments_guard_author','trg_activity_guard_author',
--                     'trg_notifications_actor_name') order by 1, 2;
--   -- 정책 본문(정책 수는 그대로여야 한다)
--   select tablename, policyname, qual, with_check from pg_policies
--    where policyname in ('profiles_insert','cards_insert','files_insert','comments_insert','activity_insert',
--                         'comments_update','people_insert','attachments_select_authenticated',
--                         'attachments_insert_authenticated','content_images_insert_own');
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_link_check';
--   -- anon·authenticated가 빠져 있어야 한다
--   select oid::regprocedure, proacl from pg_proc where proname in ('recount_card','fix_profile_team_id');
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop trigger if exists trg_profiles_guard on public.profiles;
--   drop function if exists public.guard_profile_columns();
--   alter policy profiles_insert on public.profiles with check (auth.uid() = id);
--   drop trigger if exists trg_cards_guard_author on public.cards;
--   drop trigger if exists trg_files_guard_author on public.files;
--   drop trigger if exists trg_comments_guard_author on public.comments;
--   drop trigger if exists trg_activity_guard_author on public.activity;
--   drop function if exists public.guard_author_column();
--   drop trigger if exists trg_notifications_actor_name on public.notifications;
--   drop function if exists public.notifications_actor_name();
--   alter policy cards_insert on public.cards with check (public.is_approved() and auth.role() = 'authenticated');
--   alter policy files_insert on public.files with check (public.is_approved() and auth.role() = 'authenticated' and (service_id is null or public.can_edit_service()));
--   alter policy comments_insert on public.comments with check (public.is_approved() and auth.role() = 'authenticated');
--   alter policy activity_insert on public.activity with check (public.is_approved() and auth.role() = 'authenticated');
--   alter policy comments_update on public.comments using (public.is_approved() and auth.role() = 'authenticated') with check (public.is_approved() and auth.role() = 'authenticated');
--   alter policy people_insert on public.people with check (public.is_admin() or public.can_check_all_attendance() or public.leads_any_sun());
--   alter table public.notifications drop constraint if exists notifications_link_check;
--   alter table public.notifications add constraint notifications_link_check
--     check (link is null or (link like '/%' and link not like '//%' and char_length(link) <= 300));
--   grant execute on function public.recount_card(uuid) to public, anon, authenticated;
--   grant execute on function public.fix_profile_team_id(uuid) to public, anon, authenticated;
--   alter policy "attachments_select_authenticated" on storage.objects using (bucket_id = 'attachments');
--   alter policy "attachments_insert_authenticated" on storage.objects with check (bucket_id = 'attachments');
--   alter policy "content_images_insert_own" on storage.objects
--     with check (bucket_id = 'content-images' and (storage.foldername(name))[1] = auth.uid()::text);
