-- ============================================================================
-- 0032_comment_reactions.sql — 댓글 반응(하트·따봉·체크) (사용자 결정 2026-08-30)
-- ----------------------------------------------------------------------------
-- 정한 것:
--   · 한 사람이 세 종류를 **모두** 누를 수 있지만 같은 종류는 한 번뿐이다
--     → 기본키를 (comment_id, user_id, kind)로 둔다. 다시 누르면 그 행을 지운다.
--   · **누가 눌렀는지**를 따로 조회해야 하므로(개수를 누르면 얼굴·이름 목록)
--     컬럼이 아니라 조인 테이블이다(§2-1의 기준 — "따로 조회·집계할 이유").
--   · `comments.like_count` 같은 집계 컬럼은 **두지 않는다.** 두면 트리거로
--     맞춰야 하고, 어긋나는 순간 화면의 숫자와 목록이 다른 말을 한다.
--     반응은 업무 창을 열 때 그 카드 것만 읽으므로(§6-20) 클라이언트가 센다.
--   · 반응은 취소가 흔하다 → INSERT/DELETE 두 문장뿐이고 UPDATE 정책은 두지 않는다
--     (행 안에 고칠 값이 없다). 조인 테이블을 "전부 지우고 전부 넣기"로 맞추다
--     23505를 맞은 것(§6-27)과 달리 여기는 한 행씩만 오간다.
--
-- user_id는 comments.author_id와 같은 모양으로 `default auth.uid()`다 —
-- 클라이언트는 comment_id와 kind만 보내고, 주인은 DB가 정한다(위조 불가).
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

create table if not exists public.comment_reactions (
  comment_id uuid not null references public.comments on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles on delete cascade,
  kind       text not null check (kind in ('heart', 'thumbsup', 'check')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, kind)
);
alter table public.comment_reactions enable row level security;

-- 읽기는 언제나 댓글 묶음으로 온다(카드 하나의 댓글 전부) → 기본키 앞자리가 곧 색인이다.
-- user_id 색인은 프로필이 지워질 때의 cascade가 본다(안 그러면 전체 스캔).
create index if not exists idx_comment_reactions_user_id on public.comment_reactions(user_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- 승인된 사용자만 읽기·쓰기(0022의 is_approved() 패턴 — 이 마이그레이션은 0022
-- 뒤에 오므로 처음부터 감싸서 만든다. 0022의 do 블록은 지난 정책만 감쌌다).
-- **지우기는 자기 행만** — 남의 반응을 취소할 수 있으면 안 된다.
create policy comment_reactions_select on public.comment_reactions
  for select using (public.is_approved());
create policy comment_reactions_insert on public.comment_reactions
  for insert with check (public.is_approved() and user_id = auth.uid());
create policy comment_reactions_delete on public.comment_reactions
  for delete using (user_id = auth.uid());

-- ── Realtime ───────────────────────────────────────────────────────────────
-- 반응은 업무 창 안에서만 보이는 값이라 comments·files와 같은 결로 라우팅한다 —
-- **열려 있는 창일 때만** 상세를 다시 읽는다(cloudSync.subscribeWorkspace).
-- 구독에 표를 새로 넣으면 기본이 전체 재조회이므로(§6-21) 라우팅에 같이 적었다.
-- 기본키가 세 컬럼이라 DELETE payload에도 comment_id가 실린다(replica identity
-- default = PK). 다만 card_id는 어느 쪽에도 없어서, comments의 DELETE와 마찬가지로
-- "지금 열려 있는 카드"로 본다.
do $$
begin
  alter publication supabase_realtime add table public.comment_reactions;
exception when duplicate_object then null;
end $$;

-- ── 알림 종류에 reaction 추가 ──────────────────────────────────────────────
-- 0007·0017이 가르쳐 준 것: 체크 제약과 INSERT 정책의 with check가 **둘 다** kind를
-- 열거하므로 양쪽을 같이 넓혀야 한다. 한쪽만 고치면 알림이 RLS로 조용히 막힌다.
-- reaction은 사람이 만드는 알림이라(멘션·답글·담당자와 같다) INSERT 정책에도 넣는다.
-- due_soon·approval은 그대로 뺀 채 둔다 — 서버·트리거가 만드는 것이다.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction'));

drop policy if exists "notifications_insert_authenticated" on public.notifications;
create policy "notifications_insert_authenticated"
  on public.notifications for insert to authenticated
  with check (
    kind in ('mention', 'reply', 'assign', 'reaction')
    and (preview is null or char_length(preview) <= 200)
    and char_length(actor_name) <= 100
  );

-- ── 확인 ───────────────────────────────────────────────────────────────────
--   \d public.comment_reactions
--   select policyname, cmd, qual, with_check from pg_policies
--     where schemaname='public' and tablename='comment_reactions';
--   -- select: is_approved() / insert: is_approved() and user_id = auth.uid()
--   -- delete: user_id = auth.uid()
--   select tablename from pg_publication_tables
--     where pubname='supabase_realtime' order by tablename;
--   -- comment_reactions가 목록에 있어야 한다(= cloud.subscribeAll이 듣는 목록과 같아야 한다)
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
--
--   -- 남의 반응은 못 지운다(트랜잭션 안에서 → ROLLBACK)
--   begin;
--     set local role authenticated;
--     select set_config('request.jwt.claims', '{"sub":"<내 uuid>"}', true);
--     delete from comment_reactions where user_id <> '<내 uuid>';  -- 0행이어야 한다
--   rollback;

-- ── 되돌리기 ───────────────────────────────────────────────────────────────
-- alter publication supabase_realtime drop table public.comment_reactions;
-- drop table if exists public.comment_reactions;
-- alter table public.notifications drop constraint if exists notifications_kind_check;
-- alter table public.notifications add constraint notifications_kind_check
--   check (kind in ('mention', 'reply', 'assign', 'due_soon', 'approval'));
-- drop policy if exists "notifications_insert_authenticated" on public.notifications;
-- create policy "notifications_insert_authenticated"
--   on public.notifications for insert to authenticated
--   with check (
--     kind in ('mention', 'reply', 'assign')
--     and (preview is null or char_length(preview) <= 200)
--     and char_length(actor_name) <= 100
--   );
