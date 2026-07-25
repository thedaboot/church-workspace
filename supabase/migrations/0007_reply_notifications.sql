-- ============================================================================
-- 0007_reply_notifications.sql — 답글 알림
-- ----------------------------------------------------------------------------
-- 내 댓글에 누가 답글을 달면 알림이 오게 kind에 'reply'를 추가한다.
-- INSERT 정책도 같이 넓혀야 한다(정책의 with check가 kind='mention'으로 고정돼 있었음).
-- ============================================================================

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply'));

drop policy if exists "notifications_insert_authenticated" on public.notifications;
create policy "notifications_insert_authenticated"
  on public.notifications for insert to authenticated
  with check (
    kind in ('mention', 'reply')
    and (preview is null or char_length(preview) <= 200)
    and char_length(actor_name) <= 100
  );
