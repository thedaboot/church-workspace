-- ============================================================================
-- 0076 — 가입이 승인되면 본인에게 알림 (2026-09-25)
-- ----------------------------------------------------------------------------
-- 관리자가 '멤버' 화면에서 수락하면(views/membersView.jsx) 수락된 사람에게 알림 한 건
-- `approved`를 넣는다. 문구는 services/notifyText.js의 SYSTEM_TEXT('가입이 승인되었어요')이고
-- 푸시는 cloud.insertNotifications가 늘 하듯 같이 부탁한다(승인 전 계정은 대개 구독이 없어
-- 앱 안 알림만 남는다 — 대기 화면은 services/auth.jsx가 승인을 지켜보다 저절로 넘긴다).
--
-- 0017·0022가 가르쳐 준 대로 **체크 제약과 INSERT 정책을 같이** 고친다.
-- INSERT 정책에는 `approved`를 **관리자만** 넣을 수 있게 따로 건다 — 아무 승인 사용자나
-- 남에게 '가입이 승인되었어요'를 보낼 수 있으면 안 된다. 나머지 종류는 0053 그대로다.
--
-- 코드가 먼저 나가도 깨지지 않는다: 이 마이그레이션 전에는 알림 INSERT가 체크 제약에
-- 걸려 실패하고, membersView는 그 실패를 콘솔에만 남긴다(수락 자체는 이미 끝났다).
-- ============================================================================

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction',
                  'worship_today', 'service_published', 'note_shared',
                  'club_apply', 'club_accepted', 'meeting_new',
                  'approved'));

drop policy if exists "notifications_insert_authenticated" on public.notifications;
create policy "notifications_insert_authenticated"
  on public.notifications for insert to authenticated
  with check (
    public.is_approved()
    and (
      kind in ('mention', 'reply', 'assign', 'reaction',
               'service_published', 'note_shared', 'club_apply', 'club_accepted', 'meeting_new')
      or (kind = 'approved' and public.is_admin())
    )
    and (preview is null or char_length(preview) <= 200)
    and char_length(actor_name) <= 100
  );

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid='public.notifications'::regclass and conname = 'notifications_kind_check';
--   select policyname, cmd, with_check from pg_policies
--     where tablename = 'notifications' and policyname = 'notifications_insert_authenticated';

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   delete from public.notifications where kind = 'approved';
--   alter table public.notifications drop constraint if exists notifications_kind_check;
--   alter table public.notifications add constraint notifications_kind_check
--     check (kind in ('mention','reply','assign','due_soon','approval','reaction',
--                     'worship_today','service_published','note_shared',
--                     'club_apply','club_accepted','meeting_new'));
--   drop policy if exists "notifications_insert_authenticated" on public.notifications;
--   create policy "notifications_insert_authenticated" on public.notifications for insert to authenticated
--     with check (public.is_approved()
--       and kind in ('mention','reply','assign','reaction',
--                    'service_published','note_shared','club_apply','club_accepted','meeting_new')
--       and (preview is null or char_length(preview) <= 200)
--       and char_length(actor_name) <= 100);
