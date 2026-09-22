-- ============================================================================
-- 0067 — 명단에서 고친 생일이 달력에 바로 선다 (2026-09-22 사용자 요청)
-- ----------------------------------------------------------------------------
-- 사용자 요청: "청년 명단에서 정보 수정하면 달력이나 프로필이 나와야 하는 곳에는 바로
-- 등록될 수 있게끔. DB의 싱크를 맞추려고."
--
-- **무엇이 어긋나 있었나.** 생일은 두 곳에 있다 — `people.birthday`(명단 54명, 미가입자
-- 포함 · 0035)와 `profiles.birthday`(계정 · 0019). 달력은 `profiles`를 읽는데(스토어의
-- members = 프로필이고 거기에 사진·다녀간 시각이 같이 있다) **명단 화면은 people을 쓴다.**
-- 그래서 명단에서 생일을 고쳐도 달력은 옛 값을 그렸다. 2026-09-21에 여덟 명을 손으로
-- 백필했는데, 그건 그때 한 번 맞춘 것이지 다음에 또 어긋난다.
--
-- **왜 트리거인가**(화면에서 두 번 쓰지 않고). 명단을 고치는 길이 하나가 아니다 —
-- 명단 화면·가입 승인·나중에 생길 무엇이든 people을 쓰면 같이 맞아야 한다. 화면마다
-- 한 줄씩 넣으면 언젠가 빠뜨리고, 그 빠뜨림은 "달력이 이상하다"로만 보인다.
-- 0048(touch_last_seen)과 같은 판단이다: 여러 자리에서 일어나는 일은 DB에서 한 번 본다.
--
-- **방향은 한쪽뿐이다: people → profiles.** 반대로 잇지 않는다 —
--   · 이름은 일부러 다르다. 계정 표시 이름은 본인이 정하고(꽃님·진우·현민스), 명단
--     이름은 본명이다(강꽃님·문진우·배현민). 한쪽으로 덮으면 사용자가 정한 이름이
--     사라진다(§4.5의 '둘 중 하나만 넣으면 어긋난다'와 같은 함정).
--   · 사진은 profiles에만 있다(OAuth가 준다). 명단은 profile_id로 이어 보여 준다.
--   · 생일만이 **명단이 원본**이다 — 미가입자 것도 있어야 해서 people에 있는 칸이다.
--
-- security definer인 이유: 명단을 고치는 사람(관리자·순장)이 남의 profiles 행을 고칠
-- 권한은 없다. 경계는 people 쪽 RLS가 이미 보고 있고, 여기서는 그 결과를 옮기기만 한다.
-- search_path를 고정한다 — definer 함수가 호출자의 경로를 타면 남의 함수가 끼어든다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

create or replace function public.sync_person_birthday()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 이어진 계정이 없으면 옮길 데가 없다(미가입 청년 — 명단에만 남는다)
  if new.profile_id is null then
    return new;
  end if;
  -- 빈 값으로 덮지 않는다. 명단에서 생일을 지운 것과 '아직 안 적었다'를 가를 길이
  -- 없어서, 지우는 일은 사람이 계정 쪽에서 직접 하게 둔다(잘못 지우면 달력에서 사라진다).
  if new.birthday is null then
    return new;
  end if;
  update public.profiles p
     set birthday = new.birthday
   where p.id = new.profile_id
     and p.birthday is distinct from new.birthday;
  return new;
end;
$$;

comment on function public.sync_person_birthday() is
  '명단(people)에서 고친 생일을 이어진 계정(profiles)에 옮긴다 — 달력이 profiles를 읽는다(0067)';

drop trigger if exists people_birthday_to_profile on public.people;
create trigger people_birthday_to_profile
  after insert or update of birthday, profile_id on public.people
  for each row execute function public.sync_person_birthday();

-- 지금까지 어긋나 있던 것을 한 번 맞춘다(2026-09-21에 손으로 넣은 것과 같은 일이다).
-- 계정 쪽이 비어 있을 때만 채운다 — 계정에 이미 값이 있으면 그쪽이 더 최근일 수 있다.
update public.profiles p
   set birthday = pe.birthday
  from public.people pe
 where pe.profile_id = p.id
   and pe.birthday is not null
   and p.birthday is null;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select tgname, tgenabled from pg_trigger where tgrelid = 'public.people'::regclass;
--   -- people_birthday_to_profile | O
--
--   -- 이어진 계정 중 생일이 어긋난 행 (0이어야 한다)
--   select count(*) from public.people pe join public.profiles p on p.id = pe.profile_id
--    where pe.birthday is not null and p.birthday is distinct from pe.birthday;
--
--   -- 실제로 옮겨지는지 (되돌린다)
--   begin;
--     update public.people set birthday = '01-01' where name = '노준석';
--     select birthday from public.profiles p join public.people pe on pe.profile_id = p.id
--      where pe.name = '노준석';   -- 01-01
--   rollback;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop trigger if exists people_birthday_to_profile on public.people;
--   drop function if exists public.sync_person_birthday();
--   (백필한 생일은 되돌리지 않는다 — 그 값들은 맞는 값이다)
