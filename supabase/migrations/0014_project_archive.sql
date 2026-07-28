-- ============================================================================
-- 0014_project_archive.sql — 프로젝트 보관 (projects.archived 복구)
-- ----------------------------------------------------------------------------
-- 0009에서 "안 쓰는 컬럼 정리"로 지웠던 컬럼을 되살린다. 지운 것이 성급했다:
-- 끝난 프로젝트(작년 수련회 등)를 숨길 방법이 없어서 상단 탭에 영구히 남고,
-- 데스크톱 탭은 5개 제한이라 새 프로젝트가 '더보기' 안으로 밀린다.
--
-- 연도별 관리는 컬럼을 더 두지 않는다 — projects.created_at으로 묶으면 된다.
-- 보관함에서 연도별로 보여주는 것은 앱이 한다.
-- ============================================================================

alter table public.projects
  add column if not exists archived boolean not null default false;

-- 목록 조회가 보관 여부로 갈리므로 인덱스를 둔다(0009에서 같이 지웠던 것)
create index if not exists idx_projects_archived on public.projects(archived);

-- 되돌리기: alter table public.projects drop column archived;
