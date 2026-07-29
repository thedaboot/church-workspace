-- ============================================================================
-- 0017_push_notifications.sql — 알림 종류 확장(assign·due_soon) + 웹 푸시 구독
-- ----------------------------------------------------------------------------
-- 지금까지 알림은 멘션·답글 두 종류였고 앱 안에서만 떴다. 그래서 나에게 업무가
-- 배정돼도 아무 신호가 없었고, 마감이 다가오는 것도 대시보드를 열어야 알았다.
-- 청년부가 이 앱을 매일 열지는 않으니 앱 밖으로 닿는 길(웹 푸시)이 필요하다.
--
--   assign   : 담당자로 새로 붙었을 때. 사람이 만든다(handleSaveTask).
--   due_soon : 오늘·내일 마감인데 완료가 아닌 카드. 하루 한 번 도는 배치가 만든다
--              (Vercel Cron → api/push.js). 사람이 만들 일이 없으므로 INSERT
--              정책에서는 **제외**한다 — 서버(service key)는 RLS를 우회한다.
--
-- 0007이 'reply'를 추가할 때 배운 것: 체크 제약과 INSERT 정책의 with check가
-- 둘 다 kind를 열거하므로 **양쪽을 같이 넓혀야 한다.** 한쪽만 고치면 RLS로 막힌다.
-- ============================================================================

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'assign', 'due_soon'));

-- due_soon은 빼 둔다(위 설명 참고). 로그인 사용자가 만들 수 있는 것은 셋뿐이다.
drop policy if exists "notifications_insert_authenticated" on public.notifications;
create policy "notifications_insert_authenticated"
  on public.notifications for insert to authenticated
  with check (
    kind in ('mention', 'reply', 'assign')
    and (preview is null or char_length(preview) <= 200)
    and char_length(actor_name) <= 100
  );

-- ----------------------------------------------------------------------------
-- push_subscriptions — 브라우저 푸시 구독. 한 사람이 기기마다 하나씩 가진다.
--
-- endpoint에 unique를 걸고 upsert(on conflict do update)로 넣는다. 같은 기기가
-- 다시 구독하는 일은 흔하고(권한 재요청, 키 갱신, 앱 재설치), 그때 중복으로
-- 깨지면 안 된다. 조인 테이블을 "전부 지우고 전부 넣기"로 맞추다 23505를 맞은
-- 것과 같은 이유다(HANDOFF §5의 29번).
--
-- 기기가 바뀌면 endpoint가 그대로인데 주인이 달라질 수 있으므로(공용 PC) 갱신
-- 시 profile_id도 같이 덮는다.
-- ----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_profile_id
  on public.push_subscriptions(profile_id);

alter table public.push_subscriptions enable row level security;

create trigger trg_push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

-- 본인 행만. 발송은 서버가 service key로 하므로(남의 구독을 읽어야 한다) 정책을
-- 넓힐 필요가 없다.
do $$
begin
  create policy push_subscriptions_select_own on public.push_subscriptions
    for select to authenticated using (profile_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy push_subscriptions_insert_own on public.push_subscriptions
    for insert to authenticated with check (profile_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy push_subscriptions_update_own on public.push_subscriptions
    for update to authenticated
    using (profile_id = auth.uid()) with check (profile_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy push_subscriptions_delete_own on public.push_subscriptions
    for delete to authenticated using (profile_id = auth.uid());
exception when duplicate_object then null;
end $$;

-- 확인:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.notifications'::regclass and conname like '%kind%';
--   select polname, pg_get_expr(polwithcheck, polrelid) from pg_policy
--     where polrelid = 'public.notifications'::regclass and polname like '%insert%';
--   \d public.push_subscriptions
--   select count(*) from public.push_subscriptions;
--
-- 되돌리기:
--   drop table public.push_subscriptions;
--   alter table public.notifications drop constraint notifications_kind_check;
--   alter table public.notifications add constraint notifications_kind_check
--     check (kind in ('mention', 'reply'));
--   -- 0007의 INSERT 정책 본문으로 되돌린다(kind in ('mention','reply')).
