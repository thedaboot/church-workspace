-- 0021 프로젝트 삭제 개방 + 탭 순서 컬럼
--
-- (A) 프로젝트 삭제를 로그인 사용자 전체에 연다 (사용자 결정 2026-08-24).
--     0001부터 is_admin()만 지울 수 있었는데, 관리자 없이도 정리할 수 있게 열기로 했다.
--     화면의 삭제 확인(ConfirmPopover)은 그대로 두고, 다른 관리자 권한(팀 쓰기·요약
--     고정 배지)은 건드리지 않는다. HANDOFF §4.5 표도 같이 고쳤다.
--
-- (B) projects.position — 프로젝트 탭 순서(드래그로 정한 순서, 전원 공유).
--     cards.position은 아무도 안 채워서 함정이 됐지만(§6-24), 이 컬럼은 탭 드래그가
--     저장하고 셀렉터가 정렬 키로 쓴다. 같은 값이면 created_at으로 2차 정렬해
--     Postgres가 순서를 흔들지 못하게 한다.

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete using (auth.role() = 'authenticated');

alter table public.projects add column if not exists position int not null default 0;

-- 기존 프로젝트는 만들어진 순서를 그대로 순번으로 백필
update public.projects p set position = sub.rn
  from (select id, row_number() over (order by created_at) as rn
          from public.projects) sub
 where p.id = sub.id and p.position = 0;

-- 확인:
--   select polname, pg_get_expr(polqual, polrelid) from pg_policy
--     where polrelid = 'public.projects'::regclass and polcmd = 'd';
--   select name, position from public.projects order by position;
--
-- 되돌리기:
--   drop policy projects_delete on public.projects;
--   create policy projects_delete on public.projects for delete using (is_admin());
--   alter table public.projects drop column position;
