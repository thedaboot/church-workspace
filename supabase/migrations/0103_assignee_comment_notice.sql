-- ============================================================================
-- 0103 — 담당한 업무에 달린 댓글 알림 `assignee_comment` (2026-10-15 · UX 다듬기 2차 D9)
-- ----------------------------------------------------------------------------
-- 누가 업무에 댓글·답글을 달면 그 업무의 담당자에게 '○○님이 내가 담당한 업무에 댓글을 남겼어요'(앱 안 알림 + 푸시 ·
-- services/notifyText.js) — 댓글 쓴 사람 본인과, 같은 댓글로 이미 멘션·답글 알림을 받는 사람은 뺀다(cloudSync.notifyComment).
-- 미리보기는 다른 댓글 알림처럼 댓글 앞 80자 · 누르면 그 댓글로 연다(modals/taskFocus.js). 잠긴 업무의 미리보기는 0100 트리거가 비운다.
--
-- 0017·0022·0076이 가르쳐 준 대로 **CHECK와 INSERT 정책을 같이** 넓힌다 — 한쪽만 넓히면 알림이 RLS에 조용히 막힌다.
-- 사람이 만드는 알림이라 INSERT 정책의 '아무 승인 회원' 갈래에 넣는다(mention·reply·reaction과 같다).
-- 정책은 alter만(이름·명령·역할 그대로 · 0101의 `(select …)` 꼴 그대로 · §6-31-a). 넓히기만 하므로 지금 라이브 앱은 그대로 돈다 —
-- 이 마이그레이션이 먼저 나가고 코드가 뒤따른다(코드가 먼저 나가면 이 종류의 INSERT만 CHECK에 걸려 콘솔에 남고, 같은 댓글의
-- 멘션·답글 알림은 그 앞에서 이미 들어간다).
-- ============================================================================
begin;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction',
                  'worship_today', 'service_published', 'note_shared',
                  'club_apply', 'club_accepted', 'meeting_new',
                  'approved', 'guide_pinned', 'meeting_tomorrow', 'assignee_comment'));

alter policy notifications_insert_authenticated on public.notifications
  with check (((select is_approved()) AND ((kind = ANY (ARRAY['mention'::text, 'reply'::text, 'assign'::text, 'reaction'::text, 'service_published'::text, 'note_shared'::text, 'club_apply'::text, 'club_accepted'::text, 'meeting_new'::text, 'guide_pinned'::text, 'assignee_comment'::text])) OR ((kind = 'approved'::text) AND (select is_admin()))) AND ((preview IS NULL) OR (char_length(preview) <= 200)) AND (char_length(actor_name) <= 100)));

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid='public.notifications'::regclass and conname = 'notifications_kind_check';
--   select policyname, roles, with_check from pg_policies
--     where tablename = 'notifications' and policyname = 'notifications_insert_authenticated';
--
-- ── 되돌리기 (0101·0078의 모양으로) ─────────────────────────────────────────
--   delete from public.notifications where kind = 'assignee_comment';
--   alter table public.notifications drop constraint if exists notifications_kind_check;
--   alter table public.notifications add constraint notifications_kind_check
--     check (kind in ('mention','reply','assign','due_soon','approval','reaction',
--                     'worship_today','service_published','note_shared',
--                     'club_apply','club_accepted','meeting_new','approved','guide_pinned','meeting_tomorrow'));
--   alter policy notifications_insert_authenticated on public.notifications
--     with check (((select is_approved()) AND ((kind = ANY (ARRAY['mention'::text, 'reply'::text, 'assign'::text, 'reaction'::text, 'service_published'::text, 'note_shared'::text, 'club_apply'::text, 'club_accepted'::text, 'meeting_new'::text, 'guide_pinned'::text])) OR ((kind = 'approved'::text) AND (select is_admin()))) AND ((preview IS NULL) OR (char_length(preview) <= 200)) AND (char_length(actor_name) <= 100)));
