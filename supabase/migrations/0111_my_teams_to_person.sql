-- ============================================================================
-- 0111 — '내 정보'(설정)에서 고친 소속을 명단에도 (사용자 지적 2026-10-18)
-- ----------------------------------------------------------------------------
-- 소속은 두 군데에 있다: 명단 `people.teams`(관리자·순장이 고친다)와 계정 `profile_teams`(설정 '내 정보').
-- 지금까지는 명단 → 계정 한 방향뿐이었다(0068 sync_person_teams). 그래서 설정에서 고친 소속은 명단에 안 갔고,
-- 명단의 자리 겹침 막기(0107 — 순장 ↔ 순원 · 올해 팀장 ↔ 같은 팀)도 설정에는 없었다("멤버 관리에서는 막히는데 설정에서는 된다").
--
-- set_my_person_teams(p_teams): 내게 이어진 명단 사람(my_person_id · 합친 계정은 남긴 계정 — 0061)의 people.teams를
-- p_teams 중 **명단이 고를 수 있는 이름**(is_roster_team — '…팀'·순장·순원·교역자)으로, 고른 차례 그대로 바꾼다.
-- 임원진처럼 명단이 못 고르는 것은 계정 쪽(profile_teams)에만 남는다(앱이 그대로 쓴다).
--   · 겹침은 people의 트리거(0107 guard_people_seats)가 그대로 막는다(23514) — 화면도 같은 판정(handover.blockedSeats)으로 칩을 막는다.
--   · people.teams가 바뀌면 0068 트리거가 profile_teams의 명단 이름 줄을 다시 쓴다 — 앱이 곧이어 profile_teams 전체를 쓰므로 결과는 같다.
--   · 명단에 이어지지 않은 계정은 아무 일도 하지 않는다(null 반환).
--   · '순장' 소속 칩은 권한이 아니다(순 권한은 groups의 순장 칸) — 본인이 바꿔도 권한은 그대로다.
--
-- 순서: 이 마이그레이션 → 코드. 코드가 먼저 나가도 오류 화면은 없다 — 함수가 없으면 앱이 명단 쪽 쓰기를 건너뛴다(지금처럼).
-- 되돌리기: drop function if exists public.set_my_person_teams(text[]);
-- ============================================================================

begin;

create or replace function public.set_my_person_teams(p_teams text[])
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  me uuid := public.my_person_id();
  picked text[];
begin
  if me is null then return null; end if;
  select coalesce(array_agg(t order by ord), '{}') into picked
    from (select distinct on (t) t, ord
            from unnest(coalesce(p_teams, '{}')) with ordinality as u(t, ord)
           where public.is_roster_team(t)
           order by t, ord) s;
  update public.people set teams = picked
   where id = me and coalesce(teams, '{}') is distinct from picked;
  return me;
end $$;

comment on function public.set_my_person_teams(text[]) is
  '설정(내 정보)에서 고친 소속을 내 명단 사람에게 — 명단 이름만 · 겹침은 0107 트리거가 막는다(0111)';

revoke all on function public.set_my_person_teams(text[]) from public, anon;
grant execute on function public.set_my_person_teams(text[]) to authenticated;

commit;
