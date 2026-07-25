-- ============================================================================
-- 0005_notifications.sql — @멘션 알림
-- ----------------------------------------------------------------------------
-- 댓글·업무 상세 내용에서 @표시명으로 멘션되면 대상자에게 알림 행이 생긴다.
-- INSERT는 "멘션한 사람"이 "상대의 알림 행"을 만들어야 하므로 authenticated 전체에
-- 열어두되, with check로 kind와 preview 길이를 제한해 남용 여지를 줄인다.
-- 읽기·수정·삭제는 본인(recipient_id = auth.uid()) 것만 가능.
-- ============================================================================

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users on delete cascade,
  actor_name   text not null,
  kind         text not null default 'mention' check (kind in ('mention')),
  card_id      uuid,
  project_id   uuid,
  preview      text,
  read         boolean not null default false,
  created_at   timestamptz default now()
);

create index if not exists notifications_recipient_read_idx
  on public.notifications (recipient_id, read);
create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);

alter table public.notifications enable row level security;

-- create policy는 IF NOT EXISTS를 지원하지 않으므로 duplicate_object를 삼킨다.
do $$
begin
  create policy "notifications_select_own"
    on public.notifications for select to authenticated
    using (recipient_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "notifications_update_own"
    on public.notifications for update to authenticated
    using (recipient_id = auth.uid())
    with check (recipient_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "notifications_delete_own"
    on public.notifications for delete to authenticated
    using (recipient_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- 멘션 생성자는 남의 recipient_id로 insert해야 하므로 대상 제한 없음.
-- 대신 종류와 preview 길이를 제한한다.
do $$
begin
  create policy "notifications_insert_authenticated"
    on public.notifications for insert to authenticated
    with check (
      kind = 'mention'
      and (preview is null or char_length(preview) <= 200)
      and char_length(actor_name) <= 100
    );
exception when duplicate_object then null;
end $$;

-- Realtime 발행에 추가 (이미 추가돼 있으면 무시)
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;
