-- ============================================================================
-- 0009_cleanup.sql — 안 쓰는 컬럼 정리 · 활동 로그 고아 행 · 팀 쓰기 권한
-- ----------------------------------------------------------------------------
-- (A) DROP COLUMN은 되돌릴 수 없다. 그래서 컬럼마다 "정말 비어 있는지" 먼저 세고,
--     비어 있을 때만 지운다. 값이 있으면 그 컬럼은 그대로 남기고 넘어간다
--     (마이그레이션 전체를 세우지 않는다 — 남아 있는 컬럼이 곧 "확인이 필요한 것"이다).
-- (B) activity에 FK가 없어 카드를 지워도 활동 행이 남는다 → 고아 행 정리 + cascade.
-- (C) teams.name은 앱의 매핑 키(teamNameToId)인데 로그인한 누구나 바꿀 수 있었다 → 관리자만.
--
-- 앱 코드와 함께 배포해야 한다: projects.description을 지우므로 createProject가
-- 그 컬럼을 더 이상 넣지 않아야 한다(같은 커밋에서 수정).
-- ============================================================================

-- ── (A) 안 쓰는 컬럼 — 비어 있는 것만 지운다 ────────────────────────────────
-- 팀 색은 앱의 config.js에 하드코딩돼 있고 이 컬럼을 읽지 않는다
do $$ begin
  if not exists (select 1 from public.teams where color is not null)
  then execute 'alter table public.teams drop column if exists color';
  else raise notice 'teams.color에 값이 있어 남겨둡니다'; end if;
end $$;

-- 보관(archive) 기능이 없다
do $$ begin
  if not exists (select 1 from public.projects where archived)
  then execute 'alter table public.projects drop column if exists archived';
  else raise notice 'projects.archived가 true인 행이 있어 남겨둡니다'; end if;
end $$;

-- 프로젝트 설명은 항상 빈 문자열로만 들어갔고 화면에 나오지 않는다
do $$ begin
  if not exists (select 1 from public.projects where coalesce(description, '') <> '')
  then execute 'alter table public.projects drop column if exists description';
  else raise notice 'projects.description에 값이 있어 남겨둡니다'; end if;
end $$;

-- 활동 payload는 항상 '{}'
do $$ begin
  if not exists (select 1 from public.activity where payload <> '{}'::jsonb)
  then execute 'alter table public.activity drop column if exists payload';
  else raise notice 'activity.payload에 값이 있어 남겨둡니다'; end if;
end $$;

-- 남겨두는 것:
--   cards.position       — 지금은 전부 0이지만 수동 정렬을 붙일 자리
--   profiles.avatar_url  — 가입 트리거(handle_new_user)가 채운다. 지우려면 트리거도 함께
--   projects.drive_folder_id, files.drive_file_id / web_view_link / source
--                        — 구글 드라이브 이관이 보류 상태(docs/DRIVE.md)

-- ── (B) 활동 로그: 고아 행 정리 + cascade ────────────────────────────────────
delete from public.activity a
where a.card_id is not null
  and not exists (select 1 from public.cards c where c.id = a.card_id);

delete from public.activity a
where a.project_id is not null
  and not exists (select 1 from public.projects p where p.id = a.project_id);

alter table public.activity
  drop constraint if exists activity_card_id_fkey,
  add constraint activity_card_id_fkey
    foreign key (card_id) references public.cards(id) on delete cascade;

alter table public.activity
  drop constraint if exists activity_project_id_fkey,
  add constraint activity_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete cascade;

-- 활동은 이제 카드 단위로만 읽는다(업무 창을 열 때) → 그 조회에 맞춘 인덱스
create index if not exists idx_activity_card_created on public.activity(card_id, created_at);

-- ── (C) teams 쓰기는 관리자만 ────────────────────────────────────────────────
drop policy if exists teams_insert on public.teams;
drop policy if exists teams_update on public.teams;
create policy teams_insert on public.teams
  for insert with check (public.is_admin());
create policy teams_update on public.teams
  for update using (public.is_admin()) with check (public.is_admin());

-- ── (D) 보존 기간 → 0012_retention.sql ──────────────────────────────────────
-- notifications·activity는 계속 쌓이기만 한다. pg_cron으로 걸어 두었다.
