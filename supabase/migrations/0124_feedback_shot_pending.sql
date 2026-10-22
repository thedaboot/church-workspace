-- ============================================================================
-- 0124 — 피드백 화면 사진 '올라가는 중' 표시 (사용자 지적 2026-10-22)
-- ----------------------------------------------------------------------------
-- 0123부터 글 줄을 먼저 넣고 사진은 뒤에서 드라이브에 올린다. 그 사이 관리자 메뉴를 열면 '화면 스크린샷 미첨부'로 섰다가
-- 조금 뒤에 사진이 들어왔다. 넣을 때 사진이 올 것인지(shot_pending)를 같이 적고, 관리자 메뉴는 그동안 스켈레톤을 둔다.
--
--   feedback.shot_pending boolean   넣을 때 사진이 뒤따르면 true(본인이 넣는다 · 정책은 그대로 — 칸 제한이 없다)
--   set_feedback_shot(id, drive)    drive가 있으면 적고, null이면 '못 올렸다'로 표시만 내린다 · 둘 다 pending을 false로
-- 순서: 이 마이그레이션 → 코드. 되돌리기는 맨 아래.
-- ============================================================================

begin;

alter table public.feedback add column if not exists shot_pending boolean not null default false;

create or replace function public.set_feedback_shot(p_id uuid, p_drive text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.feedback
     set shot_drive_id = coalesce(p_drive, shot_drive_id), shot_pending = false
   where id = p_id and shot_drive_id is null
     and (p_drive is null or p_drive ~ '^[A-Za-z0-9_-]{10,}$')
     and sender_id in (auth.uid(), public.effective_uid());
$$;
comment on function public.set_feedback_shot(uuid, text) is '피드백 화면 사진의 드라이브 id를 적는다(null이면 못 올렸다) — 본인 줄 · 비었을 때만 · 올라가는 중 표시를 내린다(0123 · 0124)';

commit;

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   0123의 set_feedback_shot 본문으로 다시 create or replace · alter table public.feedback drop column if exists shot_pending;
