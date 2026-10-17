-- ============================================================================
-- 0108 — 사람마다 프로젝트 탭 차례 `profiles.tab_order` (v5 1묶음 C · 시안 승인 2026-10-17)
-- ----------------------------------------------------------------------------
-- 탭을 끌면 **그 사람의 탭 줄만** 바뀐다(옛 끌기는 모두의 projects.position을 고쳤다 · 0021). 차례는 프로젝트 id 배열이고
-- 차례가 곧 탭 순서다. 한 번도 끈 적 없으면 빈 배열이고 그때 탭 줄은 모두의 position 순이다(services/tabRank.applyTabOrder).
-- 지운 프로젝트의 id가 남아도 괜찮다 — 탭 줄은 지금 있는 것만 고른다. 외래 키를 걸지 않는 이유도 그것이다(배열이라 걸 수도 없다).
--
-- 저장 자리: 계정 행 한 칸(기기를 옮겨도 따라온다 · §3-1 — 계정과 늘 같이 읽고 항목이 하나다). 앱의 겉(tabOrder.js
-- useTabOrder·setTabOrder)은 그대로이고 안만 이 칸으로 바뀐다. 게스트는 지금처럼 브라우저 한 칸(tab_order_v1).
--
-- **본인만 고친다**: profiles_update(본인)·profiles_update_admin(관리자) 두 정책이 행을 열어 두므로, 칸 가드 트리거가
-- '남의 tab_order를 바꾸는 update'를 거절한다(42501). 합친 계정은 남긴 계정 행에 쓴다(0061 effective_uid —
-- 앱은 myUid()로 그 행을 고친다). auth.uid()가 없으면(psql·서버 키) 통과한다(0071 칸 가드와 같은 결).
--
-- 순서: 이 마이그레이션 → 코드. 코드가 먼저 나가도 오류 화면은 없다 — 앱은 profiles를 '*'로 읽어 칸이 없으면 브라우저 한 칸을
-- 그대로 쓰고, 저장이 실패하면 콘솔에만 남긴다(이번 화면의 차례는 그대로).
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

alter table public.profiles add column if not exists tab_order uuid[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_tab_order_check;
alter table public.profiles add constraint profiles_tab_order_check check (cardinality(tab_order) <= 500);
comment on column public.profiles.tab_order is '내 프로젝트 탭 차례(프로젝트 id 배열 · 빈 배열 = 모두의 position 순) — 본인만 고친다(0108)';

create or replace function public.guard_tab_order() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and new.tab_order is distinct from old.tab_order
     and not (new.id = any (array[auth.uid(), public.effective_uid()])) then
    raise exception '탭 차례는 본인만 고칠 수 있어요' using errcode = '42501';
  end if;
  return new;
end $$;

comment on function public.guard_tab_order() is 'profiles.tab_order는 본인(합친 계정이면 남긴 계정)만 바꾼다 — 남이면 42501(0108)';

drop trigger if exists trg_profiles_tab_order on public.profiles;
create trigger trg_profiles_tab_order before update of tab_order on public.profiles
  for each row execute function public.guard_tab_order();

-- 트리거 함수는 RPC로 부를 일이 없다(0101 ①)
revoke execute on function public.guard_tab_order() from public, anon, authenticated;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select column_name, data_type, column_default from information_schema.columns
--    where table_name = 'profiles' and column_name = 'tab_order';
--   select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_profiles_tab_order';
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- drop trigger if exists trg_profiles_tab_order on public.profiles;
-- drop function if exists public.guard_tab_order();
-- alter table public.profiles drop constraint if exists profiles_tab_order_check;
-- alter table public.profiles drop column if exists tab_order;
-- commit;
