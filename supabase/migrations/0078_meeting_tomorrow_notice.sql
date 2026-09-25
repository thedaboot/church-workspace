-- ============================================================================
-- 0078 동아리 모임 전날 알림 (사용자 결정 2026-09-25)
-- ----------------------------------------------------------------------------
-- 동아리 모임이 있으면 **그 전날** 11:30 KST 배치(api/push.js `?job=worship`의 두 번째 갈래)가
-- 그 동아리 구성원에게 '내일 {동아리 이름} 모임이 있어요'(앱 안 알림 + 푸시 · notifyText
-- meeting_tomorrow)를 보낸다. 당일 알림은 없다.
--
-- CHECK에 새 종류 `meeting_tomorrow`만 더한다(0077의 목록 + 하나).
-- **INSERT 정책은 건드리지 않는다** — 서버가 서비스 키로 넣어 RLS를 지나지 않는다(worship_today·
-- due_soon과 같다 · 0053). 정책에 넣으면 로그인한 아무나 남에게 '내일 모임이 있어요'를 보낼 수 있다.
--
-- 코드가 먼저 나가도 깨지지 않는다: 이 마이그레이션 전에는 배치의 INSERT가 CHECK에 걸려
-- `meeting` 갈래만 502로 끝나고, 같은 크론의 예배 당일 알림은 그대로 나간다.
-- ============================================================================
begin;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction',
                  'worship_today', 'service_published', 'note_shared',
                  'club_apply', 'club_accepted', 'meeting_new',
                  'approved', 'guide_pinned', 'meeting_tomorrow'));

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid='public.notifications'::regclass and conname = 'notifications_kind_check';
--
-- ── 되돌리기 (0077의 모양으로) ──────────────────────────────────────────────
--   delete from public.notifications where kind = 'meeting_tomorrow';
--   alter table public.notifications drop constraint if exists notifications_kind_check;
--   alter table public.notifications add constraint notifications_kind_check
--     check (kind in ('mention','reply','assign','due_soon','approval','reaction',
--                     'worship_today','service_published','note_shared',
--                     'club_apply','club_accepted','meeting_new','approved','guide_pinned'));
