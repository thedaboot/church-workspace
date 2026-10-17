-- ============================================================================
-- 0104 — 휴지통 · 복원 (사용자 승인 시안 2026-10-17 · v5 1묶음 A)
-- ----------------------------------------------------------------------------
-- 업무·프로젝트를 지우면 행을 지우지 않고 **지운 표시**만 남긴다. 30일 동안 휴지통에서 보고 '복원'으로 되살린다.
-- 30일이 지나면 아침 크론(api/push.js → api/_trash.js purgeTrash · 서버 키)이 예전 삭제와 같은 순서로 정리한다
-- (준비물 읽기 → 행 삭제 · cascade → 첨부 행 → 드라이브 폴더째 휴지통, 실패하면 파일 단위 · Storage 실체 삭제).
--
-- 칸
--   cards.deleted_at · deleted_by       지운 때 · 지운 사람(남긴 계정 — effective_uid). null이면 살아 있는 업무
--   projects.deleted_at · deleted_by    같은 뜻. 프로젝트를 지우면 **프로젝트 행에만** 표시한다 — 안의 업무는 프로젝트가
--                                       가려지면서 같이 가려지고(hidden_ids), 복원하면 같이 돌아온다. 그 전에 따로 지운
--                                       업무는 자기 표시를 그대로 지닌다(휴지통에 따로 선다).
--
-- 평소 조회에서 빼는 정책 — **정책은 늘리지 않는다**(§6-31-a · 0092와 같은 길)
--   hidden_ids()   0092의 '나에게서 가릴 id 한 벌'에 **휴지통**을 더한다: 지운 프로젝트 · 지운 업무 · 지운 프로젝트의 업무 ·
--                  그 업무들의 댓글 · 첨부. 이 함수를 부르는 정책(댓글·첨부·활동·담당 팀·담당자·참고 링크·반응·같이 쓰기·
--                  doc_vec·같이 쓰기 채널·storage)이 고치지 않고 그대로 휴지통을 가린다. 리더 갈래(0092)는 한 글자도 그대로다.
--   cards   select·update(using/with check)·insert(with check)에 `deleted_at is null` — 업무 정책은 hidden_ids를
--           project_id로만 견주어서, 지운 업무 자신은 칸으로 가린다. with check에 넣었으므로 클라이언트가 update로
--           deleted_at을 직접 적을 수 없다(지우는 길은 아래 함수뿐).
--   projects select·update(using/with check)·insert(with check)에 `deleted_at is null` — 같은 이유.
--   delete 정책은 그대로 — 이 마이그레이션 전에 캐시된 옛 앱이 지우는 길(행 삭제)이 그대로 돈다. 지운 행은 select에서
--           가려지므로 클라이언트가 휴지통의 행을 영구 삭제할 길은 없다(정리는 서버 키뿐).
--   판정 호출은 0101 꼴 `(select …)` · 대상 역할은 0102의 authenticated 그대로(alter policy는 역할을 바꾸지 않는다).
--
-- 함수(전부 security definer · search_path 고정 · anon 실행 회수 · authenticated·service_role만)
--   trash_card(uuid)       업무를 휴지통으로. 지울 수 있는 사람은 cards_delete와 같다(만든 사람 · 관리자) + 그 업무가 나에게
--                          보여야 한다. 이미 휴지통이면 그대로(멱등) → 지운 때(timestamptz)
--   trash_project(uuid)    프로젝트를 휴지통으로. projects_delete와 같다(승인 전원 · 리더 프로젝트는 리더만) → 지운 때
--   restore_card(uuid)     지운 사람(두 id 모두) · 마스터만. 프로젝트가 휴지통에 있으면 'no-project'(앱이 '프로젝트를 먼저
--                          복원해주세요'를 띄운다) · 되살리면 'ok'
--   restore_project(uuid)  지운 사람 · 마스터만 → 'ok'. 안의 업무(따로 지운 것 제외)가 같이 돌아온다
--   trash_list()           휴지통 줄(30일 안 · 나에게 보이는 프로젝트의 것만 · 리더 프로젝트는 리더에게만). 승인 전원이 보고
--                          '복원' 버튼만 위 판정으로 갈린다(시안). 업무 줄은 담당 팀 이름 · 프로젝트 줄은 남은 업무 수.
--
-- 트리거: set_card_updated_meta(0010·0033·0034)가 **지운 표시만 바뀐 update**에서는 updated_at·updated_by를 건드리지 않는다
--   — 지웠다 되살린 업무가 '방금 고친 업무'(2주 방치 · 최근 정렬)로 바뀌지 않게.
--
-- 실시간: 지운 업무·프로젝트의 UPDATE는 받는 사람의 SELECT 정책에 걸려 오지 않는다. 그래서 지운 화면이
--   `workspace-all` 채널에 id만 알리고(cloud.announceTrashed · 0092의 project-visibility와 같은 길) 받은 쪽이 그 업무를
--   다시 읽어(없으면 지운다) · 프로젝트면 전체를 다시 읽는다. 복원은 행이 다시 보이므로 평소 UPDATE로 온다.
--
-- **코드보다 먼저 나가는 것이 맞지만, 늦어도 오류 화면은 뜨지 않는다**(§3-4): 앱은 새 칸을 select·filter로 읽지 않는다
--   (가리기는 RLS가 한다). 지우기·휴지통·복원은 함수를 부르고, 함수가 없으면(PGRST202 · 42883) 지우기는 예전 행 삭제로
--   되돌아가고 휴지통 입구는 서지 않는다. 서버 키 경로(크론·위키·다붓이·달력·공유 카드)는 칸이 없으면(42703) 거를 것이
--   없다고 보고 그대로 돈다(api/_trash.js trashedIds).
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다. 리허설(BEGIN … ROLLBACK)은 레포 밖(0092·0099와 같은 관례).
-- ============================================================================

begin;

-- ── 칸 ──────────────────────────────────────────────────────────────────────
alter table public.cards    add column if not exists deleted_at timestamptz;
alter table public.cards    add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
alter table public.projects add column if not exists deleted_at timestamptz;
alter table public.projects add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
comment on column public.cards.deleted_at is '휴지통에 넣은 때 — null이면 살아 있다 · 30일 뒤 아침 크론이 정리한다 (0104)';
comment on column public.cards.deleted_by is '휴지통에 넣은 사람(남긴 계정) — 복원은 이 사람과 마스터만 (0104)';
comment on column public.projects.deleted_at is '휴지통에 넣은 때 — null이면 살아 있다 · 안의 업무는 hidden_ids로 같이 가려진다 (0104)';
comment on column public.projects.deleted_by is '휴지통에 넣은 사람(남긴 계정) — 복원은 이 사람과 마스터만 (0104)';

-- 휴지통 줄·정리 크론이 읽는 자리(지운 행은 몇 안 된다 — 부분 색인)
create index if not exists cards_deleted_at_idx    on public.cards (deleted_at)    where deleted_at is not null;
create index if not exists projects_deleted_at_idx on public.projects (deleted_at) where deleted_at is not null;

-- ── 가릴 id 한 벌(0092)에 휴지통을 더한다 ───────────────────────────────────
-- 리더 갈래는 0092 그대로(리더면 리더 프로젝트를 가리지 않는다). 휴지통 갈래는 **누구에게나**(마스터·리더 포함) —
-- 지운 것은 평소 화면에서 모두에게 빠지고 휴지통 창(trash_list)에서만 보인다.
-- is_leader()는 리더 프로젝트가 있을 때만 한 번 부른다(me CTE · 0092의 '공개면 is_leader까지 가지 않는다'와 같은 뜻).
create or replace function public.hidden_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  with lp0 as (select id from public.projects where visibility = 'leaders'),
       me  as (select case when exists (select 1 from lp0) then public.is_leader() else true end as leader),
       hp  as (select id from lp0, me where not me.leader
               union
               select id from public.projects where deleted_at is not null),
       hc  as (select k.id from public.cards k
                where k.deleted_at is not null or k.project_id in (select id from hp))
  select case when not exists (select 1 from hp) and not exists (select 1 from hc) then '{}'::uuid[]
              else array(select id from hp
                         union all select id from hc
                         union all select c.id from public.comments c join hc on hc.id = c.card_id
                         union all select f.id from public.files f join hc on hc.id = f.card_id) end;
$$;

-- ── 지운 표시만 바뀐 update는 '고친 때'를 밀지 않는다 ─────────────────────────
-- 0034 본문 그대로 + 맨 앞 한 갈래. 휴지통 함수는 deleted_at·deleted_by 둘만 바꾼다.
create or replace function public.set_card_updated_meta()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    return new;
  end if;

  new.updated_at = now();
  -- 서버 함수(service key)로 고치는 경우 auth.uid()가 null이다 → 그럴 때는 유지
  new.updated_by = coalesce(auth.uid(), old.updated_by);

  -- 끝낸 시각(0033). **두 전환에서만** 손댄다(0034).
  if new.status = 'done' and old.status <> 'done' then
    new.completed_at = now();
  elsif new.status <> 'done' and old.status = 'done' then
    new.completed_at = null;
  end if;

  return new;
end;
$$;

-- ── 휴지통에 넣기 · 되살리기 ─────────────────────────────────────────────────
create or replace function public.trash_card(p_card uuid) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare k record;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  select id, created_by, project_id, deleted_at into k from public.cards where id = p_card for update;
  if not found then raise exception 'no card' using errcode = 'P0002'; end if;
  if k.deleted_at is not null then return k.deleted_at; end if;
  -- cards_delete와 같은 사람(만든 사람 — 두 id · 관리자)
  if not (coalesce(k.created_by = any (array[auth.uid(), public.effective_uid()]), false) or public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- 나에게 안 보이는 프로젝트(리더 · 휴지통)의 업무는 못 지운다
  if k.project_id = any (public.hidden_ids()) then raise exception 'not visible' using errcode = '42501'; end if;
  update public.cards set deleted_at = now(), deleted_by = public.effective_uid() where id = p_card;
  return now();
end $$;

create or replace function public.trash_project(p_project uuid) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  select id, visibility, deleted_at into p from public.projects where id = p_project for update;
  if not found then raise exception 'no project' using errcode = 'P0002'; end if;
  if p.deleted_at is not null then return p.deleted_at; end if;
  -- projects_delete와 같다(승인 전원 · 리더 프로젝트는 리더만)
  if p.visibility = 'leaders' and not public.is_leader() then raise exception 'not visible' using errcode = '42501'; end if;
  update public.projects set deleted_at = now(), deleted_by = public.effective_uid() where id = p_project;
  return now();
end $$;

-- 되살리는 사람: 지운 사람(합친 계정의 두 id) · 마스터
create or replace function public.restore_card(p_card uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare k record;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  select c.id, c.deleted_at, c.deleted_by, x.deleted_at as project_deleted_at, x.visibility
    into k from public.cards c join public.projects x on x.id = c.project_id
   where c.id = p_card for update of c;
  if not found then raise exception 'no card' using errcode = 'P0002'; end if;
  if k.deleted_at is null then return 'ok'; end if;
  if not (coalesce(k.deleted_by = any (array[auth.uid(), public.effective_uid()]), false) or public.is_master()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if k.visibility = 'leaders' and not public.is_leader() then raise exception 'not visible' using errcode = '42501'; end if;
  if k.project_deleted_at is not null then return 'no-project'; end if;
  update public.cards set deleted_at = null, deleted_by = null where id = p_card;
  return 'ok';
end $$;

create or replace function public.restore_project(p_project uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  select id, visibility, deleted_at, deleted_by into p from public.projects where id = p_project for update;
  if not found then raise exception 'no project' using errcode = 'P0002'; end if;
  if p.deleted_at is null then return 'ok'; end if;
  if not (coalesce(p.deleted_by = any (array[auth.uid(), public.effective_uid()]), false) or public.is_master()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p.visibility = 'leaders' and not public.is_leader() then raise exception 'not visible' using errcode = '42501'; end if;
  update public.projects set deleted_at = null, deleted_by = null where id = p_project;
  return 'ok';
end $$;

-- 휴지통 줄 — 30일 안 · 지운 차례(최근 먼저). 리더 프로젝트(의 업무)는 리더에게만.
-- 업무 줄의 project_title은 그 업무의 프로젝트(그 프로젝트도 휴지통일 수 있다 — 앱이 '프로젝트를 먼저 복원' 토스트로 받는다).
create or replace function public.trash_list()
returns table (kind text, id uuid, title text, project_id uuid, project_title text,
               deleted_at timestamptz, deleted_by uuid, teams text[], task_count int)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select public.is_approved() as ok, public.is_leader() as leader),
       since as (select now() - interval '30 days' as t)
  select 'project', p.id, p.name, p.id, p.name, p.deleted_at, p.deleted_by, '{}'::text[],
         (select count(*)::int from public.cards k where k.project_id = p.id and k.deleted_at is null)
    from public.projects p, me, since
   where me.ok and p.deleted_at is not null and p.deleted_at > since.t
     and (p.visibility <> 'leaders' or me.leader)
  union all
  select 'card', c.id, c.title, c.project_id, x.name, c.deleted_at, c.deleted_by,
         coalesce((select array_agg(t.name order by t.name) from public.card_teams ct join public.teams t on t.id = ct.team_id
                    where ct.card_id = c.id), '{}'::text[]),
         0
    from public.cards c join public.projects x on x.id = c.project_id, me, since
   where me.ok and c.deleted_at is not null and c.deleted_at > since.t
     and (x.visibility <> 'leaders' or me.leader)
  order by 6 desc;
$$;

revoke all on function public.trash_card(uuid) from public, anon;
revoke all on function public.trash_project(uuid) from public, anon;
revoke all on function public.restore_card(uuid) from public, anon;
revoke all on function public.restore_project(uuid) from public, anon;
revoke all on function public.trash_list() from public, anon;
grant execute on function public.trash_card(uuid) to authenticated, service_role;
grant execute on function public.trash_project(uuid) to authenticated, service_role;
grant execute on function public.restore_card(uuid) to authenticated, service_role;
grant execute on function public.restore_project(uuid) to authenticated, service_role;
grant execute on function public.trash_list() to authenticated, service_role;

-- ── 정책: 본문만 조인다(§6-31-a) — 0101 식 그대로 + `deleted_at is null` ─────────
alter policy cards_select on public.cards
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)
          AND deleted_at IS NULL));
alter policy cards_insert on public.cards
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND ((created_by = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin()))
          AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)
          AND deleted_at IS NULL));
alter policy cards_update on public.cards
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)
          AND deleted_at IS NULL))
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)
          AND deleted_at IS NULL));

alter policy projects_select on public.projects
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader))
          AND deleted_at IS NULL));
alter policy projects_insert on public.projects
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND deleted_at IS NULL));
alter policy projects_update on public.projects
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader))
          AND deleted_at IS NULL))
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader))
          AND deleted_at IS NULL));

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public' and column_name in ('deleted_at', 'deleted_by') order by 1, 2;   -- cards 둘 · projects 둘
--   select proname, prosecdef from pg_proc where proname in ('trash_card','trash_project','restore_card','restore_project','trash_list');  -- 다섯 다 t
--   select count(*) from pg_policies;                                                     -- 적용 전과 같은 수(늘리지 않았다)
--   select polname, pg_get_expr(polqual, polrelid) like '%deleted_at IS NULL%' from pg_policy
--    where polname in ('cards_select','cards_update','projects_select','projects_update');  -- 넷 다 t
--   select count(*) from cards where deleted_at is not null;                              -- 0(적용 직후)
--   리허설은 레포 밖 SQL(BEGIN … ROLLBACK · 역할별 set local role authenticated + request.jwt.claims).
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   먼저 휴지통에 남은 것을 정할 것 — 칸을 걷으면 지운 표시가 사라져 **휴지통의 업무·프로젝트가 화면에 되살아난다**.
--   정말 지울 것이면 걷기 전에 서버 키로 api/_trash.js purgeTrash({ days: 0 })를 한 번 부르거나 손으로 지운다.
--   begin;
--   alter policy cards_select on public.cards using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
--     AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
--   alter policy cards_insert on public.cards with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
--     AND ((created_by = ANY (ARRAY[(select auth.uid()), (select effective_uid())])) OR (select is_admin()))
--     AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
--   alter policy cards_update on public.cards
--     using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)))
--     with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND COALESCE((project_id <> ALL (( SELECT hidden_ids() AS hidden_ids)::uuid[])), true)));
--   alter policy projects_select on public.projects using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
--     AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader))));
--   alter policy projects_insert on public.projects with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)));
--   alter policy projects_update on public.projects
--     using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader))))
--     with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text) AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader))));
--   -- hidden_ids는 0092 본문으로 create or replace(휴지통 갈래만 빠진다) · set_card_updated_meta는 0034 본문으로
--   drop function if exists public.trash_list();
--   drop function if exists public.restore_project(uuid);
--   drop function if exists public.restore_card(uuid);
--   drop function if exists public.trash_project(uuid);
--   drop function if exists public.trash_card(uuid);
--   drop index if exists public.cards_deleted_at_idx;
--   drop index if exists public.projects_deleted_at_idx;
--   alter table public.cards drop column if exists deleted_by;
--   alter table public.cards drop column if exists deleted_at;
--   alter table public.projects drop column if exists deleted_by;
--   alter table public.projects drop column if exists deleted_at;
--   commit;
