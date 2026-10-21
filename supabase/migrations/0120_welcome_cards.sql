-- ============================================================================
-- 0120 — 새가족 정착 카드(welcome_cards) · 새가족 정보 받기 · 새신자 등록 · 순 배정 (v5 4묶음 · 사용자 승인 시안 mock/b5 2026-10-21)
-- ----------------------------------------------------------------------------
-- 모임 > '새가족' 탭의 보드 한 칸 = 카드 한 장이다. 칸(stage)은 그 사람이 마지막으로 마친 일이다:
--   visit1 첫 방문 완료 → visit2 재방문 완료 → contact 컨택 완료 → register 등록 완료 → meet 교육 완료(새신자 교육 · 여러 회)
--   → sun 배정 완료 → settled 정착 완료 · hold 보류(보드 위 한 줄). 단계는 손으로 아무 칸으로나 옮긴다("아닐 수도 있어").
--
-- 누가 보나: 웰컴팀 소속 · 리더진(is_leader — 관리자·교역자·그 해 직분, 비전 메이커 빼고) — can_see_welcome().
--   카드 읽기·쓰기는 그 사람들만(RLS). 연락처가 들어 있어 승인된 청년 전체에게 열지 않는다.
--
-- 쓰기 길 셋은 **함수**다(security definer — 부르는 사람이 people·group_members를 직접 쓸 권한이 없어도 된다):
--   submit_welcome_card(name, phone, how, note)  — 새가족 QR 화면. **로그인 없이**(anon) 부른다. 길이·형식을 보고,
--       10분에 30장을 넘으면 받지 않는다(장난 입력 막기 · 화면은 '잠시 뒤 다시').
--   welcome_register(card)  — 새신자 등록: 청년 명단(people)에 한 줄 + newcomer_at = 오늘(KST · 0119). 카드에 person_id.
--       이미 등록한 카드면 그 사람 id를 그대로 돌려준다(두 번 눌러도 사람이 둘 생기지 않는다).
--       같은 이름이 명단에 있어도 잇지 않는다(§6-26 — 이름으로 사람을 매달지 않는다 · 동명이인은 새 줄).
--   welcome_assign_sun(card, group)  — 순 배정: 순 편성과 같은 칸(group_members). 그 해 다른 순에 있으면 옮긴다.
--       순 편성 화면의 넣기·옮기기와 같은 결과다(넣기가 먼저 — 빼기만 되고 넣기가 막히는 반쪽을 남기지 않는다).
-- 순 이름은 카드에 적지 않는다 — 화면은 언제나 group_members에서 읽는다(순 편성에서 옮기면 카드에도 그대로).
--
-- 순서: 이 마이그레이션 → 코드(코드가 표·함수를 부른다 — 먼저 나가면 새가족 탭이 읽기 실패로 선다).
-- 되돌리기는 파일 맨 아래 주석.
-- ============================================================================

begin;

create table if not exists public.welcome_cards (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 40),
  phone         text check (phone is null or char_length(phone) <= 20),
  how           text check (how is null or char_length(how) <= 20),
  note          text check (note is null or char_length(note) <= 500),
  stage         text not null default 'visit1'
                check (stage in ('visit1', 'visit2', 'contact', 'register', 'meet', 'sun', 'settled', 'hold')),
  position      integer not null default 0,
  visits        date[] not null default '{}',
  contact_by    text,
  contact_at    date,
  owner         text,
  registered_at date,
  meets         date[] not null default '{}',
  settled_at    date,
  person_id     uuid references public.people(id) on delete set null,
  created_at    timestamptz not null default now()
);
comment on table public.welcome_cards is '새가족 정착 카드 — 모임 > 새가족 탭(0120)';
create index if not exists welcome_cards_created_idx on public.welcome_cards (created_at);

-- 웰컴팀 소속 · 리더진
create or replace function public.can_see_welcome()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_approved() and (
    public.is_leader()
    or exists (select 1 from public.people p where p.id = public.my_person_id() and '웰컴팀' = any(p.teams))
  );
$$;

alter table public.welcome_cards enable row level security;
drop policy if exists welcome_cards_all on public.welcome_cards;
create policy welcome_cards_all on public.welcome_cards for all
  using ((select public.can_see_welcome())) with check ((select public.can_see_welcome()));

-- 새가족 QR 화면(로그인 없음)
create or replace function public.submit_welcome_card(p_name text, p_phone text, p_how text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_id uuid;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then raise exception 'bad_name' using errcode = '22023'; end if;
  if char_length(v_digits) < 9 or char_length(v_digits) > 15 then raise exception 'bad_phone' using errcode = '22023'; end if;
  if (select count(*) from public.welcome_cards where created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'too_many' using errcode = '53400';
  end if;
  insert into public.welcome_cards (name, phone, how, note, visits)
  values (v_name, left(btrim(p_phone), 20), nullif(left(btrim(coalesce(p_how, '')), 20), ''),
          nullif(left(btrim(coalesce(p_note, '')), 500), ''), array[(now() at time zone 'Asia/Seoul')::date])
  returning id into v_id;
  return v_id;
end;
$$;

-- 새신자 등록 — 명단 한 줄 + newcomer_at
create or replace function public.welcome_register(p_card uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.welcome_cards;
  v_person uuid;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.can_see_welcome() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into c from public.welcome_cards where id = p_card for update;
  if not found then raise exception 'no_card' using errcode = 'P0002'; end if;
  if c.person_id is not null then return c.person_id; end if;
  insert into public.people (name, newcomer_at) values (btrim(c.name), v_today) returning id into v_person;
  update public.welcome_cards set person_id = v_person, registered_at = coalesce(registered_at, v_today) where id = p_card;
  return v_person;
end;
$$;

-- 순 배정 — 순 편성과 같은 칸
create or replace function public.welcome_assign_sun(p_card uuid, p_group uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.welcome_cards;
  g public.groups;
begin
  if not public.can_see_welcome() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into c from public.welcome_cards where id = p_card;
  if not found or c.person_id is null then raise exception 'not_registered' using errcode = 'P0002'; end if;
  select * into g from public.groups where id = p_group;
  if not found or g.type <> 'sun' or g.removed_at is not null or g.year <> public.kst_year() then
    raise exception 'bad_sun' using errcode = '22023';
  end if;
  insert into public.group_members (group_id, person_id) values (p_group, c.person_id) on conflict do nothing;
  delete from public.group_members gm
   using public.groups o
   where gm.person_id = c.person_id and gm.group_id = o.id and o.id <> p_group
     and o.type = 'sun' and o.year = g.year;
end;
$$;

revoke all on function public.submit_welcome_card(text, text, text, text) from public;
grant execute on function public.submit_welcome_card(text, text, text, text) to anon, authenticated;
revoke all on function public.welcome_register(uuid) from public;
grant execute on function public.welcome_register(uuid) to authenticated;
revoke all on function public.welcome_assign_sun(uuid, uuid) from public;
grant execute on function public.welcome_assign_sun(uuid, uuid) to authenticated;
-- Supabase 기본 권한이 새 함수를 anon에게도 열어 둔다(public에서 걷어도 남는다) — 로그인 없는 쪽은 submit_welcome_card만
revoke execute on function public.welcome_register(uuid) from anon;
revoke execute on function public.welcome_assign_sun(uuid, uuid) from anon;
revoke execute on function public.can_see_welcome() from anon;
grant execute on function public.can_see_welcome() to authenticated;
-- 로그인 없는 쪽(anon)은 표를 직접 만지지 못한다 — 새가족 정보는 위 함수로만 들어온다(Supabase 기본 권한이 새 표를 anon에게도 열어 둔다)
revoke all on public.welcome_cards from anon;
grant select, insert, update, delete on public.welcome_cards to authenticated;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select stage, count(*) from public.welcome_cards group by 1;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop function if exists public.welcome_assign_sun(uuid, uuid);
--   drop function if exists public.welcome_register(uuid);
--   drop function if exists public.submit_welcome_card(text, text, text, text);
--   drop table if exists public.welcome_cards;
--   drop function if exists public.can_see_welcome();
