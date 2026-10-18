-- ============================================================================
-- 0114 — 댓글 고정 · 해결 (v5 2묶음 '업무 편의' · 사용자 승인 시안 mock/b3 · 2026-10-18)
-- ----------------------------------------------------------------------------
-- 업무 창 댓글의 **최상위 댓글**에만 붙는 두 표시. 고정한 댓글은 목록 맨 위 '고정한 댓글' 묶음(고정한 차례)에,
-- 해결한 댓글은 한 줄로 접힌다(화면은 modals/comments.jsx · 규칙은 services/commentMarks.js).
--
-- 칸(comments) — 넷 다 비어 있으면 표시 없음
--   pinned_at · pinned_by     고정한 때 · 고정한 사람(profiles · 합친 계정은 남긴 계정 = effective_uid())
--   resolved_at · resolved_by 해결로 바꾼 때 · 바꾼 사람
--
-- 누가 바꾸나(사용자 결정 2026-10-18)
--   고정 = 그 댓글을 쓴 사람 · 그 업무의 담당자 · 마스터 · 관리자
--   해결 = 그 업무에 댓글을 쓸 수 있는 사람 누구나(comments_insert와 같은 판정 — 승인 · 숨은 업무(hidden_ids)가 아님 ·
--          잠긴 업무(locked_hidden_ids)가 아님)
--   둘 다 **잠긴 업무에서는 막힌다**(다른 댓글 쓰기와 같은 locked_hidden_ids — 잠근 사람·연 사람·마스터만 통과).
--
-- 왜 함수인가: 남의 댓글 행은 update 정책(쓴 사람·관리자)이 막는다 — 정책을 넓히면 본문까지 열린다.
-- 그래서 칸 넷만 고치는 security definer 함수 둘(set_comment_pin · set_comment_resolved)로 열고, 함수가 판정을 직접 본다(42501).
-- 쓴 사람·관리자가 표 update로 칸을 직접 바꾸는 길은 보호 트리거가 조용히 옛 값으로 되돌린다(0099 guard_card_lock과 같은 결 —
-- 함수 안(current_user = 함수 주인) · 서버 키 · psql은 통과).
--
-- 실시간: comments는 이미 supabase_realtime에 있다(앱은 comments 갈래에서 열린 업무의 댓글을 다시 읽는다 — cloudSync.subscribeWorkspace).
-- 칸만 늘어나므로 발행 목록은 그대로다(아래 확인 줄).
--
-- **순서: 이 마이그레이션 → 코드**(§3-4). 코드는 댓글을 `select('*')`로 읽어 칸이 없으면 표시가 없을 뿐이지만, 고정·해결을 누르면
-- 함수가 없어 실패 토스트가 뜬다. 반드시 이 파일 먼저.
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 칸 ──────────────────────────────────────────────────────────────────────
alter table public.comments
  add column if not exists pinned_at   timestamptz,
  add column if not exists pinned_by   uuid references public.profiles(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null;
comment on column public.comments.pinned_at is '고정한 때(최상위 댓글만 · set_comment_pin — 0114)';
comment on column public.comments.resolved_at is '해결로 바꾼 때(최상위 댓글만 · set_comment_resolved — 0114)';

-- ── 보호 트리거 — 클라이언트는 칸 넷을 직접 못 바꾼다 ───────────────────────
create or replace function public.guard_comment_marks() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- 함수 안(current_user = 함수 주인) · 서버 키(service_role) · psql은 통과
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.pinned_at := null; new.pinned_by := null; new.resolved_at := null; new.resolved_by := null;
  else
    new.pinned_at := old.pinned_at; new.pinned_by := old.pinned_by;
    new.resolved_at := old.resolved_at; new.resolved_by := old.resolved_by;
  end if;
  return new;
end $$;
comment on function public.guard_comment_marks() is
  '클라이언트는 comments.pinned_*·resolved_*를 못 바꾼다 — 되돌리기만 하고 예외는 없다(0114 · set_comment_pin·set_comment_resolved만)';
-- 트리거 함수는 아무도 직접 부르지 않는다(0101과 같은 결)
revoke execute on function public.guard_comment_marks() from public, anon, authenticated;

drop trigger if exists trg_comments_guard_marks on public.comments;
create trigger trg_comments_guard_marks before insert or update of pinned_at, pinned_by, resolved_at, resolved_by on public.comments
  for each row execute function public.guard_comment_marks();

-- ── 판정 · 함수 ─────────────────────────────────────────────────────────────
-- 댓글을 쓸 수 있는 사람인가 — comments_insert와 같은 판정(승인 · 숨은 업무 아님 · 잠긴 업무 아님)
create or replace function public.can_comment_card(c uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_approved()
     and c is not null
     and coalesce(c <> all (public.hidden_ids()::uuid[]), true)
     and coalesce(c <> all (public.locked_hidden_ids()::uuid[]), true);
$$;
comment on function public.can_comment_card(uuid) is
  '이 업무에 댓글을 쓸 수 있나 — 승인 · hidden_ids 아님 · locked_hidden_ids 아님(comments_insert와 같은 판정 · 0114)';
revoke all on function public.can_comment_card(uuid) from public, anon;
grant execute on function public.can_comment_card(uuid) to authenticated, service_role;

create or replace function public.set_comment_pin(p_comment uuid, p_on boolean) returns public.comments
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.comments;
  me uuid := public.effective_uid();
begin
  select * into c from public.comments where id = p_comment;
  -- 못 보는 댓글과 없는 댓글을 가르지 않는다(있다는 것부터 알리지 않는다)
  if c.id is null or not public.can_comment_card(c.card_id) then
    raise exception '이 댓글을 바꿀 수 없어요' using errcode = '42501';
  end if;
  if c.parent_id is not null then
    raise exception '답글은 고정할 수 없어요' using errcode = '22023';
  end if;
  if not (c.author_id = any (array[auth.uid(), me])
          or exists (select 1 from public.card_assignees a
                      where a.card_id = c.card_id and a.profile_id = any (array[auth.uid(), me]))
          or public.is_master()
          or public.is_admin()) then
    raise exception '댓글은 쓴 사람·담당자·마스터·관리자만 고정할 수 있어요' using errcode = '42501';
  end if;
  update public.comments
     set pinned_at = case when p_on then coalesce(pinned_at, now()) end,
         pinned_by = case when p_on then coalesce(pinned_by, me) end
   where id = c.id
  returning * into c;
  return c;
end $$;
comment on function public.set_comment_pin(uuid, boolean) is
  '최상위 댓글 고정/해제 — 쓴 사람·담당자·마스터·관리자 · 잠긴 업무는 막힌다(42501 · 0114)';
revoke all on function public.set_comment_pin(uuid, boolean) from public, anon;
grant execute on function public.set_comment_pin(uuid, boolean) to authenticated, service_role;

create or replace function public.set_comment_resolved(p_comment uuid, p_on boolean) returns public.comments
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.comments;
  me uuid := public.effective_uid();
begin
  select * into c from public.comments where id = p_comment;
  if c.id is null or not public.can_comment_card(c.card_id) then
    raise exception '이 댓글을 바꿀 수 없어요' using errcode = '42501';
  end if;
  if c.parent_id is not null then
    raise exception '답글은 해결로 바꿀 수 없어요' using errcode = '22023';
  end if;
  update public.comments
     set resolved_at = case when p_on then coalesce(resolved_at, now()) end,
         resolved_by = case when p_on then coalesce(resolved_by, me) end
   where id = c.id
  returning * into c;
  return c;
end $$;
comment on function public.set_comment_resolved(uuid, boolean) is
  '최상위 댓글 해결/미해결 — 그 업무에 댓글을 쓸 수 있는 사람 · 잠긴 업무는 막힌다(42501 · 0114)';
revoke all on function public.set_comment_resolved(uuid, boolean) from public, anon;
grant execute on function public.set_comment_resolved(uuid, boolean) to authenticated, service_role;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select column_name from information_schema.columns where table_name = 'comments' and column_name ~ '^(pinned|resolved)_';   -- 넷
--   select tgname from pg_trigger where tgrelid = 'public.comments'::regclass and tgname = 'trg_comments_guard_marks';
--   select proname, prosecdef from pg_proc where proname in ('set_comment_pin', 'set_comment_resolved', 'can_comment_card');   -- 셋 다 t
--   select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'comments';                         -- 한 줄
--
--   -- RLS 흉내(롤백): 순원은 남의 댓글을 해결로는 바꾸고 고정은 못 한다 · 표 update로 칸을 바꾸면 되돌려진다
--   begin; set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<순원 uid>","role":"authenticated"}', true);
--   select resolved_at is not null from public.set_comment_resolved('<남의 최상위 댓글>', true);   -- t
--   select public.set_comment_pin('<남의 최상위 댓글>', true);                                      -- 거절(42501)
--   rollback;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- drop function if exists public.set_comment_resolved(uuid, boolean);
-- drop function if exists public.set_comment_pin(uuid, boolean);
-- drop function if exists public.can_comment_card(uuid);
-- drop trigger if exists trg_comments_guard_marks on public.comments;
-- drop function if exists public.guard_comment_marks();
-- alter table public.comments drop column if exists pinned_at, drop column if exists pinned_by,
--   drop column if exists resolved_at, drop column if exists resolved_by;
-- commit;
-- (코드도 같이 — services/cloud/board.js의 setCommentPin·setCommentResolved, cloudSync commentToApp의 네 칸, services/commentMarks.js의 클라우드 갈래)
