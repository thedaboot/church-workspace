-- ============================================================================
-- 0107 — 팀장 · 예배팀장 직분 · 태어난 연도 · 자리 겹침 막기 (v5 1묶음 C · 시안 승인 2026-10-17)
-- ----------------------------------------------------------------------------
-- ① people_roles에 '팀장'(role = 'team_lead')과 그 팀(`team`)을 연다. 팀은 팀장일 때만 있고 팀장이면 반드시 있다.
--    한 사람은 한 해에 팀 하나(기본 키 person_id·year·role 그대로). 한 팀에 팀장이 여럿이어도 막지 않는다.
--    팀 이름은 '…팀'이면 된다 — 기획팀처럼 config(teams 표)에 아직 없는 팀도 나중에 받을 수 있게 FK를 걸지 않는다.
--    **예배팀장**(role = 'worship_lead' · 사용자 결정 2026-10-17)도 연다 — 팀 칸이 없는 직분 하나다(찬양·엔지니어·워십에 걸친
--    예배 전반 · 특정 팀의 팀장이 아니다). 그래서 '팀장 ↔ 같은 팀 소속' 막기에 걸리지 않는다(찬양팀 소속 + 예배팀장 허용).
-- ② **팀장·예배팀장은 리더진이다**(사용자 결정 2026-10-16 · 10-17). is_leader()가 그해 팀장·예배팀장도 리더로 본다 — 이름·인자는 그대로(0092 ·
--    B 묶음의 정책이 부른다) 몸만 바꾼다. is_officer()는 '임원 다섯'만 남긴다(팀장·예배팀장·비전 메이커 제외 — 0094와 같은 뜻).
--    리더를 해마다 가르는 몸은 is_leader_for(연도) 하나다(0110이 '지난해 리더'에 같은 함수를 쓴다).
-- ③ people.birth_year — 졸업(한국 나이 31세가 되는 해 1월 1일 · 연도 − 출생연도 + 1 = 31)에 쓴다. 졸업은 표시뿐이고
--    워크스페이스 권한은 바뀌지 않는다(사용자 결정).
-- ④ 2026 팀장 옮기기(사용자 결정 2026-10-17): profiles.role_note의 'OO팀장' 낱말(OO팀이 teams 표의 '…팀')을 읽어
--    2026 people_roles에 team_lead + 팀으로 **한 번** 복사한다. role_note는 지우지 않는다(정리는 2027-01-01 인수인계 뒤 ·
--    HANDOFF 남은 일). 명단에 이어진 계정만 옮긴다 — 옮길 사람·못 옮기는 사람은 리허설 SQL이 먼저 보여 준다.
--    'OO'가 teams 표의 '…팀' 이름과 정확히 맞을 때만 옮긴다(2026-10-17 사용자 확인: 노준석 찬양 · 문진혁 엔지니어 · 박지호 웰컴 ·
--    시온 미디어). 리더팀장은 임원 직분 lead_team 그대로(옮기지 않는다). **예배팀장** 낱말은 2026 worship_lead로 옮긴다(조준환).
--    같은 사람에 이어진 계정이 둘이어도 people_roles는 사람당 한 줄(distinct on · 기본 키).
-- ⑤ 자리 겹침 막기(사용자 결정 2026-10-16): 순장 ↔ 순원(소속 칩 둘을 같이 들 수 없다) · 팀장 ↔ 같은 팀 소속.
--    화면이 칩을 비활성으로 두고(services/handover.js blockedSeats·blockedLeadTeams), 저장은 아래 트리거 둘이 막는다(23514).
--    **새로 생기는 겹침만** 막는다 — 지금 이미 겹친 행(④가 옮긴 2026 팀장이 그 팀 소속이기도 한 경우)은 그대로 두고,
--    그 사람의 다른 칸을 고쳐도 막히지 않는다. 팀장 ↔ 소속은 **올해 팀장 줄만** 본다(사용자 결정 2026-10-17) — 소속(people.teams)은
--    '지금'이라 다음 해 팀장은 지금 그 팀 팀원이어도 지정된다. 그해가 되는 1월 1일 아침 적용 단계(0109 apply_handovers)가 그 사람을
--    그 팀 소속에서 빼고 기록한다(handover_seat_log). 그 뒤로는 겹침이 새로 생기지 않게 이 트리거가 막는다. 지난해 줄은 기록이다.
--    ④의 복사는 트리거를 만들기 **전에** 한다(겹친 사람도 옮겨진다 · 리허설 '겹침' 목록).
--
-- 순서: 이 마이그레이션 → 코드. 코드가 먼저 나가도 오류 화면은 없다 — 명단은 birth_year·team을 '없어도 되는 칸'으로 읽고
-- (people.fetchPeople 폴백 · fetchRoles는 '*'), 팀장 칩·태어난 연도를 저장하는 순간만 '저장하지 못했어요'가 뜬다.
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── ① 팀장 직분 ─────────────────────────────────────────────────────────────
alter table public.people_roles add column if not exists team text;
comment on column public.people_roles.team is '팀장(role = team_lead)이 이끄는 팀 — 팀장일 때만 있다(0107)';

alter table public.people_roles drop constraint people_roles_role_check;
alter table public.people_roles add constraint people_roles_role_check
  check (role in ('director', 'president', 'treasurer', 'lead_sunjang', 'lead_team', 'vision_maker', 'team_lead', 'worship_lead'));
alter table public.people_roles drop constraint if exists people_roles_team_check;
alter table public.people_roles add constraint people_roles_team_check
  check ((role = 'team_lead') = (team is not null)
         and (team is null or (team ~ '팀$' and char_length(team) between 2 and 20)));

-- ── ② 리더 판정 ─────────────────────────────────────────────────────────────
-- 그해 리더 = 관리자(마스터 포함) · 교역자 · 그해 임원 다섯 · 그해 팀장 · 그해 예배팀장. 비전 메이커 줄은 리더가 아니다(0094).
create or replace function public.is_leader_for(y int) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin() or public.is_pastor()
      or exists (select 1 from public.people_roles pr
                  where pr.person_id = public.my_person_id() and pr.year = y and pr.role <> 'vision_maker');
$$;
comment on function public.is_leader_for(int) is '그해(y) 리더인가 — 관리자·교역자·그해 임원·그해 팀장·그해 예배팀장(0107)';

-- 몸만 바꾼다(이름·인자 그대로 — 정책·트리거·api/_leaders.js가 부른다)
create or replace function public.is_leader() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_leader_for(public.kst_year());
$$;

-- 올해 임원(다섯)인가 — 팀장·예배팀장·비전 메이커 줄은 임원이 아니다
create or replace function public.is_officer()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.people_roles pr
    where pr.person_id = public.my_person_id() and pr.year = public.kst_year()
      and pr.role not in ('vision_maker', 'team_lead', 'worship_lead')
  );
$$;

revoke all on function public.is_leader_for(int) from public, anon;
grant execute on function public.is_leader_for(int) to authenticated, service_role;

-- ── ③ 태어난 연도 ───────────────────────────────────────────────────────────
alter table public.people add column if not exists birth_year int;
alter table public.people drop constraint if exists people_birth_year_check;
alter table public.people add constraint people_birth_year_check check (birth_year is null or birth_year between 1900 and 2100);
comment on column public.people.birth_year is '태어난 연도 — 졸업(한국 나이 31세가 되는 해 1월 1일) 표시에 쓴다 · 권한과 무관(0107)';

-- ── ④ 2026 팀장 옮기기(role_note → people_roles · 한 번) ────────────────────
-- 낱말 나누기는 aiPeople.splitRoleNote와 같은 결: '·' ',' '/'로 자르고, 괄호 안을 걷고, 끝의 '님'과 빈칸을 뗀다.
-- 한 사람이 팀장 낱말을 둘 적었으면 앞의 것 하나(기본 키가 한 해 한 팀이다) — 리허설이 그런 사람을 따로 보여 준다.
insert into public.people_roles (person_id, year, role, team)
select distinct on (pe.id) pe.id, 2026, 'team_lead', t.name
  from public.profiles pr
  join public.people pe on pe.profile_id = pr.id and pe.removed_at is null
  cross join lateral regexp_split_to_table(coalesce(pr.role_note, ''), '\s*[·,/]\s*') with ordinality as seg(word, n)
  join public.teams t on t.name like '%팀'
                     and regexp_replace(regexp_replace(regexp_replace(seg.word, '\([^)]*\)', '', 'g'), '님$', ''), '\s+', '', 'g')
                         = t.name || '장'
 where pr.removed_at is null and pr.merged_into is null
 order by pe.id, seg.n
on conflict (person_id, year, role) do nothing;

-- 예배팀장 — 팀 칸 없이(같은 낱말 나누기)
insert into public.people_roles (person_id, year, role)
select distinct pe.id, 2026, 'worship_lead'
  from public.profiles pr
  join public.people pe on pe.profile_id = pr.id and pe.removed_at is null
  cross join lateral regexp_split_to_table(coalesce(pr.role_note, ''), '\s*[·,/]\s*') as seg(word)
 where pr.removed_at is null and pr.merged_into is null
   and regexp_replace(regexp_replace(regexp_replace(seg.word, '\([^)]*\)', '', 'g'), '님$', ''), '\s+', '', 'g') = '예배팀장'
on conflict (person_id, year, role) do nothing;

-- ── ⑤ 자리 겹침 막기 ────────────────────────────────────────────────────────
-- 팀장 줄이 생기거나 팀이 바뀔 때 — 그 사람이 지금 그 팀 소속이면 막는다(올해 줄만 · 다음 해 줄은 1월 1일 적용이 소속을 뺀다)
create or replace function public.guard_team_lead_seat() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.role = 'team_lead' and new.year = public.kst_year()
     and (tg_op = 'INSERT' or new.team is distinct from old.team or new.person_id is distinct from old.person_id)
     and exists (select 1 from public.people p where p.id = new.person_id and new.team = any (coalesce(p.teams, '{}'))) then
    raise exception '팀장은 같은 팀의 소속일 수 없어요 (%)', new.team using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_people_roles_team_lead_seat on public.people_roles;
create trigger trg_people_roles_team_lead_seat before insert or update on public.people_roles
  for each row execute function public.guard_team_lead_seat();

-- 소속이 바뀔 때 — 순장·순원을 새로 같이 들었거나, 올해 이끄는 팀을 새로 소속으로 들었으면 막는다
create or replace function public.guard_people_seats() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  was text[] := case when tg_op = 'UPDATE' then coalesce(old.teams, '{}') else '{}' end;
  now_ text[] := coalesce(new.teams, '{}');
begin
  if '순장' = any (now_) and '순원' = any (now_) and not ('순장' = any (was) and '순원' = any (was)) then
    raise exception '순장과 순원을 같이 지정할 수 없어요' using errcode = '23514';
  end if;
  if exists (select 1 from public.people_roles r
              where r.person_id = new.id and r.role = 'team_lead' and r.year = public.kst_year()
                and r.team = any (now_) and not (r.team = any (was))) then
    raise exception '팀장은 같은 팀의 소속일 수 없어요' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_people_seats on public.people;
create trigger trg_people_seats before insert or update of teams on public.people
  for each row execute function public.guard_people_seats();

-- 트리거 함수는 RPC로 부를 일이 없다(0101 ①)
revoke execute on function public.guard_team_lead_seat() from public, anon, authenticated;
revoke execute on function public.guard_people_seats() from public, anon, authenticated;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint where conname in ('people_roles_role_check', 'people_roles_team_check');
--   select pe.name, r.team from public.people_roles r join public.people pe on pe.id = r.person_id
--    where r.role = 'team_lead' and r.year = 2026 order by r.team, pe.name;           -- ④에서 옮긴 줄
--   select prosrc from pg_proc where proname in ('is_leader', 'is_leader_for', 'is_officer');
--   리허설(BEGIN … ROLLBACK)은 레포 밖 — 보고서의 경로.
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- drop trigger if exists trg_people_seats on public.people;
-- drop trigger if exists trg_people_roles_team_lead_seat on public.people_roles;
-- drop function if exists public.guard_people_seats();
-- drop function if exists public.guard_team_lead_seat();
-- delete from public.people_roles where role in ('team_lead', 'worship_lead');
-- alter table public.people_roles drop constraint if exists people_roles_team_check;
-- alter table public.people_roles drop constraint people_roles_role_check;
-- alter table public.people_roles add constraint people_roles_role_check
--   check (role in ('director', 'president', 'treasurer', 'lead_sunjang', 'lead_team', 'vision_maker'));
-- alter table public.people_roles drop column if exists team;
-- alter table public.people drop constraint if exists people_birth_year_check;
-- alter table public.people drop column if exists birth_year;
-- -- (is_officer는 0094 몸통으로)
-- create or replace function public.is_officer()
-- returns boolean language sql stable security definer set search_path = public, pg_temp
-- as $$ select exists (select 1 from public.people_roles pr
--   where pr.person_id = public.my_person_id() and pr.year = public.kst_year() and pr.role <> 'vision_maker'); $$;
-- create or replace function public.is_leader() returns boolean
-- language sql stable security definer set search_path = public, pg_temp as $$
--   select public.is_admin() or public.is_pastor() or public.is_officer(); $$;
-- -- 0110을 먼저 되돌린 뒤에 지운다(0110의 함수가 is_leader_for를 부른다)
-- drop function if exists public.is_leader_for(int);
-- commit;
