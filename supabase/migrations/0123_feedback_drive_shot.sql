-- ============================================================================
-- 0123 — 피드백 화면 사진을 구글 드라이브에 (사용자 요청 2026-10-22)
-- ----------------------------------------------------------------------------
-- 피드백 전송은 글 줄을 먼저 넣고(창이 바로 닫힌다), 화면 사진은 그 뒤에 드라이브 `더다붓 워크스페이스/피드백`에 올린다.
-- 다 올라가면 그 드라이브 파일 id를 이 줄에 적는다 — 보낸 사람은 feedback을 고칠 수 없어서(0113 · 넣기만) 정의자 함수 하나로 연다.
-- 관리자 메뉴는 shot_drive_id가 있으면 드라이브 그림 주소로, 없으면 예전처럼 Storage 'feedback'(shot_path)으로 그린다.
--
--   feedback.shot_drive_id text   드라이브 파일 id(없으면 null)
--   set_feedback_shot(id, drive)  보낸 사람 본인 줄 · 아직 비었을 때만 · id 모양 검사 — 아니면 아무것도 안 한다(멱등)
-- 순서: 이 마이그레이션 → 코드(코드가 먼저면 사진 적기만 실패해 콘솔 경고 · 글은 들어간다). 되돌리기는 맨 아래.
-- ============================================================================

begin;

alter table public.feedback add column if not exists shot_drive_id text
  check (shot_drive_id is null or shot_drive_id ~ '^[A-Za-z0-9_-]{10,}$');

create or replace function public.set_feedback_shot(p_id uuid, p_drive text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.feedback set shot_drive_id = p_drive
  where id = p_id and shot_drive_id is null and p_drive ~ '^[A-Za-z0-9_-]{10,}$'
    and sender_id in (auth.uid(), public.effective_uid());
$$;
comment on function public.set_feedback_shot(uuid, text) is '피드백 화면 사진의 드라이브 id를 적는다 — 보낸 사람 본인 줄 · 비었을 때만(0123)';
revoke all on function public.set_feedback_shot(uuid, text) from public, anon;
grant execute on function public.set_feedback_shot(uuid, text) to authenticated, service_role;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   리허설(begin … rollback): 보낸 사람 claims로 자기 줄에 적힘 · 두 번째는 그대로 · 남의 줄은 0행
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   begin; drop function if exists public.set_feedback_shot(uuid, text); alter table public.feedback drop column if exists shot_drive_id; commit;
