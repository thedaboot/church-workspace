-- ============================================================================
-- 0077 순모임 가이드 고정 알림 (사용자 요청 2026-09-25)
-- ----------------------------------------------------------------------------
-- 마스터가 가이드를 고정하면 그 해 순장들에게 '이번 예배 순모임 가이드가 도착했어요!'
-- (앱 안 알림 + 푸시 · services/sunGuide.js notifyGuidePinned · notifyText guide_pinned).
--
-- ① notifications: 새 종류 `guide_pinned`를 CHECK와 INSERT 정책에 더한다(0076의 목록 + 하나).
--    INSERT 정책은 0076의 몸 그대로이고(`approved`는 관리자만) 목록에 한 줄만 붙었다.
-- ② sun_guides.pin_notified_at: 한 가이드에 알림을 **한 번만** 보내는 칸. 고정을 풀었다 다시
--    걸어도 두 번 가지 않는다. 앱은 `where pin_notified_at is null`인 UPDATE로 이 칸을 차지하고
--    행이 돌아올 때만 보낸다(알림 표는 받는 사람만 읽을 수 있어 '보냈는지'를 거기서 못 본다).
--    쓰기는 기존 sun_guides_write 정책 그대로다(고정된 행은 마스터만 — 0055).
--    기존 행은 비워 둔다 — 지금 고정돼 있는 가이드를 다시 고정하면 그때 한 번 간다.
-- ============================================================================
begin;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction',
                  'worship_today', 'service_published', 'note_shared',
                  'club_apply', 'club_accepted', 'meeting_new',
                  'approved', 'guide_pinned'));

drop policy if exists "notifications_insert_authenticated" on public.notifications;
create policy "notifications_insert_authenticated"
  on public.notifications for insert to authenticated
  with check (
    public.is_approved()
    and (
      kind in ('mention', 'reply', 'assign', 'reaction',
               'service_published', 'note_shared', 'club_apply', 'club_accepted', 'meeting_new',
               'guide_pinned')
      or (kind = 'approved' and public.is_admin())
    )
    and (preview is null or char_length(preview) <= 200)
    and char_length(actor_name) <= 100
  );

alter table public.sun_guides add column if not exists pin_notified_at timestamptz;
comment on column public.sun_guides.pin_notified_at is
  '고정 알림을 보낸 때 — 비어 있을 때만 채우는 UPDATE로 차지해 한 가이드에 한 번만 보낸다(0077)';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid='public.notifications'::regclass and conname = 'notifications_kind_check';
--   select with_check from pg_policies where policyname = 'notifications_insert_authenticated';
--   select column_name from information_schema.columns
--     where table_name = 'sun_guides' and column_name = 'pin_notified_at';
--
-- ── 되돌리기 (0076의 모양으로 — 아래는 0053 모양이라 'approved' 줄을 다시 붙여야 한다) ──
--   alter table public.sun_guides drop column if exists pin_notified_at;
--   alter table public.notifications drop constraint if exists notifications_kind_check;
--   alter table public.notifications add constraint notifications_kind_check
--     check (kind in ('mention','reply','assign','due_soon','approval','reaction',
--                     'worship_today','service_published','note_shared','club_apply','club_accepted','meeting_new'));
--   drop policy if exists "notifications_insert_authenticated" on public.notifications;
--   create policy "notifications_insert_authenticated" on public.notifications for insert to authenticated
--     with check (public.is_approved()
--       and kind in ('mention','reply','assign','reaction','service_published','note_shared','club_apply','club_accepted','meeting_new')
--       and (preview is null or char_length(preview) <= 200) and char_length(actor_name) <= 100);
