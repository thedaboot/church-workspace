-- ============================================================================
-- 0013_card_assignees.sql — 담당자를 표시명이 아니라 프로필로 붙인다
-- ----------------------------------------------------------------------------
-- 문제: cards.assignees는 표시명 text[]이고, 프로필 이름을 바꾸는 경로
-- (profiles.display_name)는 이 배열을 건드리지 않는다. 그런데 '내 업무'는
-- assignees.includes(currentUser.name)으로 거른다(selectors.js). 그래서 설정에서
-- 이름을 한 번 고치면 그 사람이 맡은 카드가 전부 남의 것이 됐다. 오타로 넣은
-- 이름도 아무의 목록에도 안 잡히는 유령 담당자로 남았다.
--
-- 해결: card_teams와 같은 모양의 조인 테이블. 카드는 사람을 id로 가리키고,
-- 표시명은 읽을 때 profiles에서 파생한다 → 이름을 바꾸면 따라온다.
--
-- cards.assignees 컬럼은 남긴다(0008이 profiles.team_id를 남긴 것과 같은 이유).
--   · 롤백 여지: 코드를 되돌리면 그대로 동작한다
--   · 프로필이 삭제되면 조인 행은 cascade로 사라지는데, 그때 "누구였는지"가
--     아무 데도 안 남는 것을 막는다
-- 앱은 두 곳에 다 쓰고 읽기는 조인 테이블을 먼저 본다(비어 있으면 컬럼으로 폴백 —
-- 이 마이그레이션 전 코드와 섞여도 담당자가 사라지지 않게).
--
-- Realtime 발행에는 넣지 않는다. 담당자 저장은 항상 cards UPDATE와 같이 일어나서
-- (updateCard가 카드 행도 함께 쓴다) cards 이벤트가 이미 신호가 된다.
-- card_teams도 같은 이유로 발행하지 않는다. HANDOFF §5의 23번 참고 — 구독에 표를
-- 새로 추가하면 기본이 '전체 재조회'라 오히려 더 무거워진다.
-- ============================================================================

create table if not exists public.card_assignees (
  card_id uuid not null references public.cards on delete cascade,
  profile_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (card_id, profile_id)
);
alter table public.card_assignees enable row level security;

create index if not exists idx_card_assignees_card_id on public.card_assignees(card_id);
create index if not exists idx_card_assignees_profile_id on public.card_assignees(profile_id);

create trigger trg_card_assignees_updated_at
  before update on public.card_assignees
  for each row execute function public.set_updated_at();

-- 정책은 card_teams와 같게 둔다(로그인 사용자가 관리). 카드를 고칠 수 있는 사람이
-- 담당자도 고칠 수 있어야 하고, cards.update 정책이 이미 그렇다.
create policy card_assignees_select on public.card_assignees
  for select using (auth.role() = 'authenticated');
create policy card_assignees_insert on public.card_assignees
  for insert with check (auth.role() = 'authenticated');
create policy card_assignees_update on public.card_assignees
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy card_assignees_delete on public.card_assignees
  for delete using (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- 백필 — 표시명이 프로필과 정확히 일치하는 것만 옮긴다.
-- 일치하지 않는 이름(오타, 가입하지 않은 사람)은 옮기지 않고 cards.assignees에
-- 그대로 남는다. 앱은 조인 행이 없으면 컬럼으로 폴백하므로 화면에서 사라지지는
-- 않는다. 아래 확인 쿼리로 어떤 이름이 남았는지 볼 수 있다.
-- ----------------------------------------------------------------------------
insert into public.card_assignees (card_id, profile_id)
select c.id, p.id
from public.cards c
cross join lateral unnest(coalesce(c.assignees, '{}')) as a(name)
join public.profiles p on p.display_name = a.name
on conflict do nothing;

-- 확인: 프로필과 못 이어진 담당자 이름 (있으면 오타이거나 미가입자)
--   select distinct a.name
--   from public.cards c
--   cross join lateral unnest(coalesce(c.assignees, '{}')) as a(name)
--   left join public.profiles p on p.display_name = a.name
--   where p.id is null;
--
-- 되돌리기: drop table public.card_assignees;
--   (cards.assignees가 남아 있으므로 앱 코드만 되돌리면 그대로 동작한다)
