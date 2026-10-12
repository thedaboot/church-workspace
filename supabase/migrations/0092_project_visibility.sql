-- ============================================================================
-- 0092 — 리더만 보는 프로젝트 (사용자 결정 2026-10-12 · docs/V2.md 결정 15를 뒤집는다)
-- ----------------------------------------------------------------------------
-- `projects.visibility` 'all'(기본) | 'leaders'. 'leaders'면 그 프로젝트와 안의 업무·댓글·반응·첨부·
-- 참고 링크·활동·담당 팀·담당자·같이 쓰기 기록·문서 임베딩이 **리더에게만** 읽힌다.
-- 리더 = 마스터·관리자(is_admin) · 교역자(is_pastor) · 그 해 임원진(is_officer — people_roles 올해 줄 ·
-- 0043 CHECK가 다섯 직분만 받는다). 순장은 아니다. `role_note`·'임원진' 팀은 본인이 고칠 수 있어 보지 않는다
-- (people_roles 쓰기는 관리자만 · people.is_pastor·profile_id도 관리자만 — 스스로 리더가 될 길이 없다).
--
-- 함수(전부 security definer · stable · search_path 고정 · anon 실행 회수)
--   is_leader()             나는 리더인가
--   can_see_project(uuid)   'leaders' 프로젝트가 **아니거나** 내가 리더다. 없는 id·null은 참(가릴 것이 없다)
--   can_see_card(uuid)      그 업무의 지금 프로젝트로 판정. 없는 id·null은 참 — 트리거·같이 쓰기 함수가 쓴다
--   hidden_ids()            **나에게서 가릴 id 한 벌**(리더면 빈 배열) — 리더 프로젝트 · 그 업무 · 그 업무의 댓글 ·
--                           그 업무의 첨부. 정책은 이것을 `(select public.hidden_ids())`로 불러 **질의마다 한 번**만
--                           계산한다(InitPlan). 줄마다 can_see_*를 부르면 doc_vec 468줄 count가 0.27~0.4초였다
--                           (리허설 실측 — 줄마다 security definer 왕복 셋). 비교는 `coalesce(칸 <> all(…), true)` —
--                           칸이 null이면 가릴 것이 없다.
--   leader_profile_ids()    리더 계정 id 배열(남긴 계정 · 환송 제외) — 앱의 알림 받는 사람·멘션 후보,
--                           서버 키 경로(api/push.js · api/ics.js)가 같은 판정을 쓴다
--
-- **업무가 원본이다.** files·activity·resource_links·doc_vec의 project_id는 업무를 옮겨도 따라가지 않아 낡을 수
-- 있다(doc_vec은 다음 크론까지) — 그래서 `coalesce(card_id, project_id)`처럼 업무 칸을 먼저 본다. hidden_ids는
-- 업무를 **지금** 프로젝트로 묶으므로, 업무를 옮기면 그 댓글·첨부·임베딩이 같이 따라간다.
--
-- 정책은 **늘리지 않는다**(§6-31-a — permissive는 OR라 느슨한 새 정책 하나가 전부를 연다). 있는 정책의
-- 본문만 `alter policy`로 바꾸고 0071이 만든 식은 그대로 둔 채 `and`만 더한다.
--   projects(select·update·delete) · cards(넷) · comments(넷) · files(넷 — **업무 첨부 갈래만**, 주보 갈래·CHECK는
--   그대로) · activity(둘) · card_teams·card_assignees·resource_links(넷씩) · comment_reactions(셋) ·
--   card_docs·card_doc_updates·card_doc_versions · doc_vec · realtime 같이 쓰기 채널 둘(`coedit:<업무 id>`) ·
--   storage `attachments`(읽기 — 경로 `<프로젝트>/<업무>/…`의 업무로).
-- projects_insert는 그대로 — 아래 트리거가 리더가 아닌 사람의 'leaders'를 'all'로 되돌린다.
--
-- 보호 트리거(0071 방식 — 예외 대신 옛 값으로 되돌린다 · 통과는 `auth.uid() is null or is_leader()`)
--   trg_projects_guard_visibility  리더가 아니면 visibility를 못 바꾼다(INSERT면 'all')
--   trg_cards_guard_project        리더가 아니면 업무를 리더 프로젝트로 넣거나 빼지 못한다(project_id 유지)
--   (리더 프로젝트에 새 업무 INSERT는 cards_insert의 with check가 42501로 막는다 — 되돌릴 옛 값이 없다)
-- 같이 쓰기 함수 셋(card_doc_seed·compact·baseline — security definer라 RLS를 안 탄다)은 몸통 맨 앞에
-- can_see_card를 하나 더한다.
--
-- 실시간(postgres_changes)은 받는 사람의 SELECT 정책을 본다 — 리더가 아니면 그 프로젝트·업무의 변경이 오지
-- 않는다. 그래서 '공개 → 리더만'은 리더 화면이 공개 채널에 알리고(cloud.announceProjectVisibility)
-- 받은 쪽이 다시 읽어 걷는다(cloudSync.subscribeWorkspace).
--
-- **코드보다 먼저 나간다**(§3-4). 옛 앱은 visibility를 모르고 '*'로 읽어 깨질 곳이 없다 — 지금 'leaders'인
-- 프로젝트가 하나도 없으니 정책이 바꾸는 결과도 없다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 칸 ──────────────────────────────────────────────────────────────────────
alter table public.projects add column if not exists visibility text not null default 'all';
alter table public.projects drop constraint if exists projects_visibility_check;
alter table public.projects add constraint projects_visibility_check check (visibility in ('all', 'leaders'));
comment on column public.projects.visibility is '보는 사람 — all(승인 전원) | leaders(마스터·관리자·교역자·그 해 임원진) (0092)';

-- ── 판정 함수 ───────────────────────────────────────────────────────────────
create or replace function public.is_leader() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin() or public.is_pastor() or public.is_officer();
$$;

-- 아래 둘은 '리더 프로젝트가 아니다'를 먼저 본다 — 공개 프로젝트면 is_leader()까지 가지 않는다
create or replace function public.can_see_project(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p is null
      or not exists (select 1 from public.projects x where x.id = p and x.visibility = 'leaders')
      or public.is_leader();
$$;

create or replace function public.can_see_card(c uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select c is null
      or not exists (select 1 from public.cards k join public.projects x on x.id = k.project_id
                      where k.id = c and x.visibility = 'leaders')
      or public.is_leader();
$$;

-- RLS 밖에서 모은다 — 정책 안에서 comments를 다시 읽으면 안 보이는 댓글이 빠져서 '가릴 것 없음'으로 뒤집힌다
create or replace function public.hidden_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  with lp as (select id from public.projects where visibility = 'leaders'),
       lc as (select k.id from public.cards k join lp on lp.id = k.project_id)
  select case when not exists (select 1 from lp) or public.is_leader() then '{}'::uuid[]
              else array(select id from lp
                         union all select id from lc
                         union all select c.id from public.comments c join lc on lc.id = c.card_id
                         union all select f.id from public.files f join lc on lc.id = f.card_id) end;
$$;

-- 리더 계정 id(남긴 계정만 · 환송 제외). 관리자는 admins의 이메일을 profiles.email(가입 트리거가 채운다)로 잇는다.
-- 승인된 사람이나 서버(auth.uid() 없음 — 서비스 키)만 받는다.
create or replace function public.leader_profile_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(p.id order by p.id), '{}')
    from public.profiles p
   where (auth.uid() is null or public.is_approved())
     and p.merged_into is null and p.removed_at is null
     and (exists (select 1 from public.admins a where lower(a.email) = lower(coalesce(p.email, '')))
       or exists (select 1 from public.people pe
                   where pe.profile_id = p.id and pe.is_pastor and pe.removed_at is null)
       or exists (select 1 from public.people pe join public.people_roles pr on pr.person_id = pe.id
                   where pe.profile_id = p.id and pe.removed_at is null and pr.year = public.kst_year()));
$$;

revoke all on function public.is_leader() from public, anon;
revoke all on function public.can_see_project(uuid) from public, anon;
revoke all on function public.can_see_card(uuid) from public, anon;
revoke all on function public.hidden_ids() from public, anon;
revoke all on function public.leader_profile_ids() from public, anon;
grant execute on function public.is_leader() to authenticated, service_role;
grant execute on function public.can_see_project(uuid) to authenticated, service_role;
grant execute on function public.can_see_card(uuid) to authenticated, service_role;
grant execute on function public.hidden_ids() to authenticated, service_role;
grant execute on function public.leader_profile_ids() to authenticated, service_role;

-- ── 보호 트리거 ─────────────────────────────────────────────────────────────
create or replace function public.guard_project_visibility() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.is_leader() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.visibility := 'all';
  else
    new.visibility := old.visibility;
  end if;
  return new;
end $$;

comment on function public.guard_project_visibility() is
  '리더가 아니면 projects.visibility를 못 바꾼다 — 되돌리기만 하고 예외는 없다(0092)';

drop trigger if exists trg_projects_guard_visibility on public.projects;
create trigger trg_projects_guard_visibility before insert or update of visibility on public.projects
  for each row execute function public.guard_project_visibility();

-- projects를 직접 읽지 않는다 — 트리거는 부른 사람 권한이라 리더 프로젝트 행이 RLS에 가려 '없음'으로 읽힌다.
-- can_see_project(security definer)가 그 판정을 RLS 밖에서 한다.
create or replace function public.guard_card_project() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or new.project_id is not distinct from old.project_id or public.is_leader() then
    return new;
  end if;
  if not public.can_see_project(old.project_id) or not public.can_see_project(new.project_id) then
    new.project_id := old.project_id;
  end if;
  return new;
end $$;

comment on function public.guard_card_project() is
  '리더가 아니면 업무를 리더 프로젝트로 넣거나 빼지 못한다 — project_id를 되돌린다(0092)';

drop trigger if exists trg_cards_guard_project on public.cards;
create trigger trg_cards_guard_project before update of project_id on public.cards
  for each row execute function public.guard_card_project();

-- ── 정책: 본문만 조인다(§6-31-a) ─────────────────────────────────────────────
-- 아래 `coalesce(X <> all ((select public.hidden_ids())::uuid[]), true)` = "X가 나에게서 가릴 id가 아니다"
-- projects — 칸을 바로 본다
alter policy projects_select on public.projects
  using (public.is_approved() and auth.role() = 'authenticated'
         and (visibility <> 'leaders' or (select public.is_leader())));
alter policy projects_update on public.projects
  using (public.is_approved() and auth.role() = 'authenticated'
         and (visibility <> 'leaders' or (select public.is_leader())))
  with check (public.is_approved() and auth.role() = 'authenticated'
         and (visibility <> 'leaders' or (select public.is_leader())));
alter policy projects_delete on public.projects
  using (public.is_approved() and auth.role() = 'authenticated'
         and (visibility <> 'leaders' or (select public.is_leader())));

-- cards — 업무의 지금 프로젝트로
alter policy cards_select on public.cards
  using (public.is_approved() and auth.role() = 'authenticated'
         and coalesce(project_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy cards_insert on public.cards
  with check (
    public.is_approved() and auth.role() = 'authenticated'
    and (created_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
    and coalesce(project_id <> all ((select public.hidden_ids())::uuid[]), true)
  );
alter policy cards_update on public.cards
  using (public.is_approved() and auth.role() = 'authenticated'
         and coalesce(project_id <> all ((select public.hidden_ids())::uuid[]), true))
  with check (public.is_approved() and auth.role() = 'authenticated'
         and coalesce(project_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy cards_delete on public.cards
  using (public.is_approved()
         and (created_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
         and coalesce(project_id <> all ((select public.hidden_ids())::uuid[]), true));

-- comments
alter policy comments_select on public.comments
  using (public.is_approved() and auth.role() = 'authenticated'
         and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy comments_insert on public.comments
  with check (
    public.is_approved() and auth.role() = 'authenticated'
    and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
    and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true)
  );
alter policy comments_update on public.comments
  using (public.is_approved() and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
         and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true))
  with check (public.is_approved() and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
         and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy comments_delete on public.comments
  using (public.is_approved() and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
         and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));

-- files — 업무 첨부 갈래(service_id is null)에만 감싼다. 주보 갈래는 한 글자도 그대로다.
-- (0047의 CHECK와 갈래 모양은 건드리지 않는다 · 모임 갈래는 다른 정책이 따로 연다)
alter policy files_select on public.files
  using (public.is_approved() and auth.role() = 'authenticated'
         and ((service_id is null and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true))
              or exists (select 1 from public.services s
                          where s.id = files.service_id and (s.status = 'published' or public.can_edit_service()))));
alter policy files_insert on public.files
  with check (
    public.is_approved() and auth.role() = 'authenticated'
    and ((service_id is null and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true))
         or public.can_edit_service())
    and (uploaded_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
  );
alter policy files_update on public.files
  using (public.is_approved() and auth.role() = 'authenticated'
         and ((service_id is null and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true))
              or public.can_edit_service()))
  with check (public.is_approved() and auth.role() = 'authenticated'
         and ((service_id is null and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true))
              or public.can_edit_service()));
alter policy files_delete on public.files
  using (public.is_approved() and
         case when service_id is null
              then coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true)
                   and (uploaded_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
              else public.can_edit_service() end);

-- activity
alter policy activity_select on public.activity
  using (public.is_approved() and auth.role() = 'authenticated'
         and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true));
alter policy activity_insert on public.activity
  with check (
    public.is_approved() and auth.role() = 'authenticated'
    and (actor_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
    and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true)
  );

-- card_teams · card_assignees
alter policy card_teams_select on public.card_teams
  using (public.is_approved() and auth.role() = 'authenticated' and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy card_teams_insert on public.card_teams
  with check (public.is_approved() and auth.role() = 'authenticated' and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy card_teams_update on public.card_teams
  using (public.is_approved() and auth.role() = 'authenticated' and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true))
  with check (public.is_approved() and auth.role() = 'authenticated' and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy card_teams_delete on public.card_teams
  using (public.is_approved() and auth.role() = 'authenticated' and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));

alter policy card_assignees_select on public.card_assignees
  using (public.is_approved() and auth.role() = 'authenticated' and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy card_assignees_insert on public.card_assignees
  with check (public.is_approved() and auth.role() = 'authenticated' and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy card_assignees_update on public.card_assignees
  using (public.is_approved() and auth.role() = 'authenticated' and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true))
  with check (public.is_approved() and auth.role() = 'authenticated' and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy card_assignees_delete on public.card_assignees
  using (public.is_approved() and auth.role() = 'authenticated' and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));

-- resource_links — 주인은 프로젝트이거나 업무다(0058 배타 CHECK)
alter policy resource_links_select on public.resource_links
  using (public.is_approved() and auth.role() = 'authenticated'
         and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true));
alter policy resource_links_insert on public.resource_links
  with check (public.is_approved() and auth.role() = 'authenticated'
         and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true));
alter policy resource_links_update on public.resource_links
  using (public.is_approved() and auth.role() = 'authenticated'
         and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true))
  with check (public.is_approved() and auth.role() = 'authenticated'
         and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true));
alter policy resource_links_delete on public.resource_links
  using (public.is_approved() and (created_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin())
         and coalesce(coalesce(card_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true));

-- comment_reactions — card_id 칸이 없다. hidden_ids에 댓글 id가 들어 있다
alter policy comment_reactions_select on public.comment_reactions
  using (public.is_approved() and coalesce(comment_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy comment_reactions_insert on public.comment_reactions
  with check (public.is_approved() and user_id = public.effective_uid()
              and coalesce(comment_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy comment_reactions_delete on public.comment_reactions
  using (user_id = any (array[auth.uid(), public.effective_uid()])
         and coalesce(comment_id <> all ((select public.hidden_ids())::uuid[]), true));

-- 같이 쓰기 표 셋(0084)
alter policy card_docs_select on public.card_docs
  using (public.is_approved() and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy card_doc_updates_select on public.card_doc_updates
  using (public.is_approved() and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy card_doc_updates_insert on public.card_doc_updates
  with check (public.is_approved() and by = any (array[auth.uid(), public.effective_uid()])
              and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy card_doc_versions_select on public.card_doc_versions
  using (public.is_approved() and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));
alter policy card_doc_versions_insert on public.card_doc_versions
  with check (public.is_approved() and by = any (array[auth.uid(), public.effective_uid()])
              and coalesce(card_id <> all ((select public.hidden_ids())::uuid[]), true));

-- doc_vec(0074) — 댓글·첨부 줄은 card_id가 비어 있다. 한 줄의 주인 하나(업무 · 댓글 · 첨부 · 마지막에 프로젝트)로 본다
alter policy doc_vec_select on public.doc_vec
  using (public.is_approved()
         and coalesce(coalesce(card_id, comment_id, file_id, project_id) <> all ((select public.hidden_ids())::uuid[]), true));

-- 같이 쓰기 채널 `coedit:<업무 id>`(0084) — 글자로 견준다(형 변환이 없어 모양이 틀린 주제도 오류가 아니다).
-- 대문자로 바꾼 주제는 다른 채널이라(리더 화면은 소문자 id로 연다) 아무것도 듣지 못한다.
alter policy coedit_channel_read on realtime.messages
  using (left(realtime.topic(), 7) = 'coedit:' and realtime.messages.extension in ('broadcast', 'presence') and public.is_approved()
         and substr(realtime.topic(), 8) <> all ((select public.hidden_ids())::text[]));
alter policy coedit_channel_write on realtime.messages
  with check (left(realtime.topic(), 7) = 'coedit:' and realtime.messages.extension in ('broadcast', 'presence') and public.is_approved()
         and substr(realtime.topic(), 8) <> all ((select public.hidden_ids())::text[]));

-- 레거시 Storage `attachments`(드라이브가 안 될 때의 자리 · 2026-10-12 객체 0개 · storage_path가 있는 첨부 0건) —
-- 경로가 `<프로젝트>/<업무>/<열쇠>-<이름>`(업무)·`services/<주보>/…`(주보)이고 둘째 도막이 업무 id다. 올리기·지우기는
-- 그대로 둔다(읽을 수 없는 자리에 올려 봐야 못 본다).
alter policy attachments_select_authenticated on storage.objects
  using (bucket_id = 'attachments' and public.is_approved()
         and coalesce((storage.foldername(name))[2] <> all ((select public.hidden_ids())::text[]), true));

-- ── 같이 쓰기 함수 셋 — security definer라 RLS를 안 탄다. 맨 앞에 can_see_card 한 줄 ─────
create or replace function public.card_doc_seed(p_card uuid, p_state text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  if not public.can_see_card(p_card) then raise exception 'not visible' using errcode = '42501'; end if;
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
--   select visibility, count(*) from projects group by 1;                                -- all N
--   select proname, prosecdef from pg_proc where proname in ('is_leader','can_see_project','can_see_card',
--     'hidden_ids','leader_profile_ids');                                                 -- 다섯 다 t
--   select count(*) from pg_policies;                                                     -- 적용 전과 같은 수(늘리지 않았다)
--   select tgname from pg_trigger where tgname in ('trg_projects_guard_visibility','trg_cards_guard_project');
--   -- 리허설: begin; \i 이 파일(begin/commit 줄 빼고); update projects set visibility = 'leaders' where id = …;
--   --   set local role authenticated;
--   --   select set_config('request.jwt.claims', '{"sub":"<uuid>","email":"<메일>","role":"authenticated"}', true);
--   --   리더/비리더로 count(*) 비교 → rollback;
--   --   **update는 claims를 비운 뒤에** — 비리더 claims가 남아 있으면 위 트리거가 'leaders'를 'all'로 되돌린다.
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   begin;
--   alter policy projects_select on public.projects using (public.is_approved() and auth.role() = 'authenticated');
--   alter policy projects_update on public.projects using (public.is_approved() and auth.role() = 'authenticated')
--     with check (public.is_approved() and auth.role() = 'authenticated');
--   alter policy projects_delete on public.projects using (public.is_approved() and auth.role() = 'authenticated');
--   alter policy cards_select on public.cards using (public.is_approved() and auth.role() = 'authenticated');
--   alter policy cards_insert on public.cards with check (public.is_approved() and auth.role() = 'authenticated'
--     and (created_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()));
--   alter policy cards_update on public.cards using (public.is_approved() and auth.role() = 'authenticated')
--     with check (public.is_approved() and auth.role() = 'authenticated');
--   alter policy cards_delete on public.cards using (public.is_approved()
--     and (created_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()));
--   alter policy comments_select on public.comments using (public.is_approved() and auth.role() = 'authenticated');
--   alter policy comments_insert on public.comments with check (public.is_approved() and auth.role() = 'authenticated'
--     and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()));
--   alter policy comments_update on public.comments
--     using (public.is_approved() and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()))
--     with check (public.is_approved() and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()));
--   alter policy comments_delete on public.comments
--     using (public.is_approved() and (author_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()));
--   alter policy files_select on public.files using (public.is_approved() and auth.role() = 'authenticated'
--     and ((service_id is null) or exists (select 1 from public.services s
--          where s.id = files.service_id and (s.status = 'published' or public.can_edit_service()))));
--   alter policy files_insert on public.files with check (public.is_approved() and auth.role() = 'authenticated'
--     and (service_id is null or public.can_edit_service())
--     and (uploaded_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()));
--   alter policy files_update on public.files
--     using (public.is_approved() and auth.role() = 'authenticated' and (service_id is null or public.can_edit_service()))
--     with check (public.is_approved() and auth.role() = 'authenticated' and (service_id is null or public.can_edit_service()));
--   alter policy files_delete on public.files using (public.is_approved() and case when service_id is null
--     then (uploaded_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()) else public.can_edit_service() end);
--   alter policy activity_select on public.activity using (public.is_approved() and auth.role() = 'authenticated');
--   alter policy activity_insert on public.activity with check (public.is_approved() and auth.role() = 'authenticated'
--     and (actor_id = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()));
--   -- card_teams·card_assignees 넷씩: select·delete using / insert with check / update 둘 다 =
--   --   (public.is_approved() and auth.role() = 'authenticated')
--   alter policy resource_links_select on public.resource_links using (public.is_approved() and auth.role() = 'authenticated');
--   alter policy resource_links_insert on public.resource_links with check (public.is_approved() and auth.role() = 'authenticated');
--   alter policy resource_links_update on public.resource_links using (public.is_approved() and auth.role() = 'authenticated')
--     with check (public.is_approved() and auth.role() = 'authenticated');
--   alter policy resource_links_delete on public.resource_links
--     using (public.is_approved() and (created_by = any (array[auth.uid(), public.effective_uid()]) or public.is_admin()));
--   alter policy comment_reactions_select on public.comment_reactions using (public.is_approved());
--   alter policy comment_reactions_insert on public.comment_reactions with check (public.is_approved() and user_id = public.effective_uid());
--   alter policy comment_reactions_delete on public.comment_reactions using (user_id = any (array[auth.uid(), public.effective_uid()]));
--   alter policy card_docs_select on public.card_docs using (public.is_approved());
--   alter policy card_doc_updates_select on public.card_doc_updates using (public.is_approved());
--   alter policy card_doc_updates_insert on public.card_doc_updates
--     with check (public.is_approved() and by = any (array[auth.uid(), public.effective_uid()]));
--   alter policy card_doc_versions_select on public.card_doc_versions using (public.is_approved());
--   alter policy card_doc_versions_insert on public.card_doc_versions
--     with check (public.is_approved() and by = any (array[auth.uid(), public.effective_uid()]));
--   alter policy doc_vec_select on public.doc_vec using (public.is_approved());
--   alter policy coedit_channel_read on realtime.messages using (left(realtime.topic(), 7) = 'coedit:'
--     and realtime.messages.extension in ('broadcast', 'presence') and public.is_approved());
--   alter policy coedit_channel_write on realtime.messages with check (left(realtime.topic(), 7) = 'coedit:'
--     and realtime.messages.extension in ('broadcast', 'presence') and public.is_approved());
--   alter policy attachments_select_authenticated on storage.objects using (bucket_id = 'attachments' and public.is_approved());
--   -- 같이 쓰기 함수 셋은 0084·0086의 몸통으로 다시 create or replace(can_see_card 줄만 빠진다)
--   drop trigger if exists trg_cards_guard_project on public.cards;
--   drop trigger if exists trg_projects_guard_visibility on public.projects;
--   drop function if exists public.guard_card_project();
--   drop function if exists public.guard_project_visibility();
--   drop function if exists public.leader_profile_ids();
--   drop function if exists public.hidden_ids();
--   drop function if exists public.can_see_card(uuid);
--   drop function if exists public.can_see_project(uuid);
--   drop function if exists public.is_leader();
--   alter table public.projects drop column if exists visibility;
--   commit;
