-- ============================================================================
-- 0110 — 지난해 리더는 지난해 '리더만 보기' 프로젝트를 계속 보고 고친다 (v5 1묶음 C · 사용자 결정 · 시안 승인 2026-10-17)
-- ----------------------------------------------------------------------------
-- 0092의 리더 판정은 '올해' 하나였다(is_leader() = 관리자·교역자·올해 임원 — 0107부터 올해 팀장까지). 그래서 1월 1일이 되면
-- 2026 임원이 2026 리더 프로젝트를 통째로 못 보게 된다. 이 파일은 리더 프로젝트를 **프로젝트 연도 기준**으로도 연다:
--   리더 프로젝트 x를 볼 수 있다 = is_leader()(올해 리더 — 지금과 같다) 또는 x.year가 내가 리더였던 해(my_leader_years())
-- '올해 리더는 지난 리더 프로젝트도 본다'는 그대로 둔다(지금 동작을 좁히지 않는다 · 결정이 필요하면 보고서).
-- 고치기도 같다 — 업무·댓글·첨부는 hidden_ids를, 프로젝트 행은 projects 정책을 타므로 둘을 같이 연다.
--
-- **이 파일은 0104(휴지통 · A)와 0105(보는 사람 직접 선택 · B) 뒤에 적용한다.** 둘이 각자 hidden_ids를 다시 쓰고(0104는 지운 것 ·
-- 0105는 'custom'), 0104가 projects 정책 셋을 다시 쓴다. 여기는 **두 파일의 몸통(2026-10-17 시점)을 합치고** 리더 갈래만
-- leader_hidden_project_ids()로 바꾼다. 0104·0105의 hidden_ids·can_see_project·projects 정책이 그 뒤에 또 바뀌면 이 파일도
-- 같이 맞춰야 한다(맞추지 않으면 뒤에 적용한 쪽이 이긴다 — 리허설로 행 수를 본다).
--
-- 함수
--   my_leader_years()            내가 리더 줄(비전 메이커 말고 아무 직분 · 팀장 포함)을 가진 해들 · 명단에 안 이어졌으면 빈 배열
--   leader_hidden_project_ids()  나에게 가릴 리더 프로젝트 id — 올해 리더면 빈 배열(지금과 같다), 아니면 내가 리더였던 해 것만 연다
--   hidden_ids()                 0104 + 0105 + 위 리더 갈래
--   can_see_project()            0105 + 연도 갈래(트리거·같이 쓰기 함수·lock_card가 부른다)
-- 정책(alter만 · 이름·명령·역할 그대로): projects_select · projects_update · projects_delete — 0104(select·update)·0101(delete) 식에
--   `OR (year = ANY ((SELECT my_leader_years())::integer[]))`만 더한다.
--   leader_profile_ids_for(y) · project_audiences()  (합칠 때 더함 2026-10-17) 리더 프로젝트의 볼 수 있는 계정 = 올해 리더 ∪ 그 프로젝트
--                                연도의 리더 — 알림 받는 사람·멘션 후보(앱 cloudSync)와 서버 키 경로(_leaders.audienceFor · 마감 임박 · 달력)가
--                                올해 리더에 더한다. 다붓이 캐시 꺼내기는 묻는 사람 세션의 hidden_ids로 본다(_wikiAsk.cachedAnswer).
--   휴지통 함수(0104)는 0105부터 can_see_project를 부르므로 지난해 리더도 그 프로젝트를 지우고 되살린다(따로 고치지 않는다).
-- 그대로 둔 것: 리더만 보기를 켜고 끄는 것(guard_project_visibility)과 업무를 리더 프로젝트로 옮기는 것(guard_card_project)은 올해 리더만이다.
--   서버 키에 '누구 몫인지 모르는' 자리(위키 장 · 공유 카드 · unseenCardIds)는 리더 프로젝트 전부를 걷는다(예전 그대로).
--
-- 순서: 0104 · 0105 · 0107 → 이 파일. 코드는 이 파일을 읽지 않는다(RLS만 바뀐다).
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

create or replace function public.my_leader_years() returns int[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct pr.year order by pr.year), '{}')
    from public.people_roles pr
   where pr.person_id = public.my_person_id() and pr.role <> 'vision_maker';
$$;
comment on function public.my_leader_years() is '내가 리더 줄(비전 메이커 말고 · 팀장 포함)을 가진 해들 — 지난해 리더 프로젝트를 여는 데 쓴다(0110)';

-- 리더 프로젝트가 없으면 판정 함수를 부르지 않는다(0092 · 31-l ①)
create or replace function public.leader_hidden_project_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  with lp as (select x.id, x.year from public.projects x where x.visibility = 'leaders'),
       me as (select public.is_leader() as leader, public.my_leader_years() as years where exists (select 1 from lp))
  select coalesce((select array_agg(lp.id) from lp, me where not me.leader and not (lp.year = any (me.years))), '{}');
$$;

-- 0104(지운 것) + 0105(custom) + 리더 갈래(연도). 질의마다 한 번(InitPlan). 0105가 0104 몸통 위에 custom을 더한 것과 같은 꼴이다.
create or replace function public.hidden_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  with nar as (select x.id from public.projects x where x.visibility = 'custom'),
       me  as (select array[auth.uid(), public.effective_uid()] as ids, public.is_master() as master
                where exists (select 1 from nar)),
       hp  as (select unnest(public.leader_hidden_project_ids()) as id
               union
               select nar.id from nar, me
                where not me.master
                  and not exists (select 1 from public.project_viewers v left join public.profiles pv on pv.id = v.profile_id
                                   where v.project_id = nar.id
                                     and (v.profile_id = any (me.ids) or pv.merged_into = any (me.ids)))
               union
               select x.id from public.projects x where x.deleted_at is not null),
       hc  as (select k.id from public.cards k
                where k.deleted_at is not null or k.project_id in (select id from hp))
  select case when not exists (select 1 from hp) and not exists (select 1 from hc) then '{}'::uuid[]
              else array(select id from hp
                         union all select id from hc
                         union all select c.id from public.comments c join hc on hc.id = c.card_id
                         union all select f.id from public.files f join hc on hc.id = f.card_id) end;
$$;

-- 0105 몸통 + 연도 갈래
create or replace function public.can_see_project(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p is null
      or not exists (select 1 from public.projects x where x.id = p and x.visibility in ('leaders', 'custom'))
      or exists (select 1 from public.projects x where x.id = p and x.visibility = 'leaders'
                  and (public.is_leader() or x.year = any (public.my_leader_years())))
      or exists (select 1 from public.projects x where x.id = p and x.visibility = 'custom' and public.is_project_viewer(x.id));
$$;

-- 알림 받는 사람 · 멘션 후보(합칠 때 더함 2026-10-17 · 사용자 요청) — 리더 프로젝트의 볼 수 있는 계정에 **그해 리더**를 더한다.
-- 그해(y) 리더 줄(비전 메이커 말고 · 팀장 포함 — my_leader_years와 같은 줄)을 가진 계정(남긴 계정 · 환송 제외)
create or replace function public.leader_profile_ids_for(y int) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct p.id order by p.id), '{}')
    from public.profiles p
    join public.people pe on pe.profile_id = p.id and pe.removed_at is null
    join public.people_roles pr on pr.person_id = pe.id
   where (auth.uid() is null or public.is_approved())
     and p.merged_into is null and p.removed_at is null
     and pr.year = y and pr.role <> 'vision_maker';
$$;
comment on function public.leader_profile_ids_for(int) is '그해(y) 리더 줄을 가진 계정 — 지난해 리더 프로젝트의 알림 받는 사람·멘션 후보(0110)';

-- 0105 몸통 + 리더 갈래에 그 프로젝트 연도의 리더(leader_profile_ids_for(x.year)). 앱(cloudSync leaderAud) · 서버 키(api/_leaders.audienceFor ·
-- api/push.js 마감 임박 · api/ics.js 달력)가 올해 리더(leader_profile_ids)에 이 줄을 더한다(visibility.leaderAudience).
create or replace function public.project_audiences(ps uuid[] default null)
returns table (project_id uuid, profile_ids uuid[])
language sql stable security definer set search_path = public, pg_temp as $$
  with pj as (
    select x.id, x.visibility, x.year from public.projects x
     where x.visibility in ('leaders', 'custom')
       and (ps is null or x.id = any (ps))
       and (auth.uid() is null
            or (public.is_approved() and coalesce(x.id <> all ((select public.hidden_ids())::uuid[]), true)))
  ),
  masters as (
    select p.id from public.profiles p
     where p.merged_into is null and p.removed_at is null
       and exists (select 1 from public.admins a where a.is_master and lower(a.email) = lower(coalesce(p.email, '')))
  )
  select pj.id,
         case when pj.visibility = 'leaders'
              then array(select distinct u from unnest(public.leader_profile_ids() || public.leader_profile_ids_for(pj.year)) as t(u) order by u)
              else coalesce((select array_agg(distinct u.id order by u.id) from (
                       select coalesce(pr.merged_into, pr.id) as id
                         from public.project_viewers v join public.profiles pr on pr.id = v.profile_id
                        where v.project_id = pj.id and pr.removed_at is null
                       union select m.id from masters m) u), '{}'::uuid[]) end
    from pj;
$$;

revoke all on function public.my_leader_years() from public, anon;
revoke all on function public.leader_hidden_project_ids() from public, anon;
grant execute on function public.my_leader_years() to authenticated, service_role;
grant execute on function public.leader_hidden_project_ids() to authenticated, service_role;
revoke all on function public.leader_profile_ids_for(int) from public, anon;
grant execute on function public.leader_profile_ids_for(int) to authenticated, service_role;

-- projects — 0104(select·update) · 0101(delete) 식에 연도 갈래 하나
alter policy projects_select on public.projects
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader) OR (year = ANY ((SELECT my_leader_years())::integer[])))
          AND deleted_at IS NULL));
alter policy projects_update on public.projects
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader) OR (year = ANY ((SELECT my_leader_years())::integer[])))
          AND deleted_at IS NULL))
  with check (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader) OR (year = ANY ((SELECT my_leader_years())::integer[])))
          AND deleted_at IS NULL));
alter policy projects_delete on public.projects
  using (((select is_approved()) AND ((select auth.role()) = 'authenticated'::text)
          AND ((visibility <> 'leaders'::text) OR ( SELECT is_leader() AS is_leader) OR (year = ANY ((SELECT my_leader_years())::integer[])))));

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select policyname, qual from pg_policies where tablename = 'projects' and policyname in ('projects_select','projects_update','projects_delete');
--   select prosrc from pg_proc where proname in ('hidden_ids', 'can_see_project', 'leader_hidden_project_ids');
--   select project_id, cardinality(profile_ids) from project_audiences() order by 2 desc;     -- 리더 프로젝트 줄은 올해 리더 수 이상
--   리허설(2026 팀장 · 일반 회원 · 2026 임원(2027 직분 없음)을 2027년으로 흉내 · 마스터가 보는 리더 프로젝트 수)은 레포 밖 — 보고서의 경로.
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- -- hidden_ids · can_see_project는 0104·0105를 합친 몸통(리더 갈래 = `not public.is_leader()`)으로 다시 create or replace
-- -- projects_select · projects_update는 0104의 식, projects_delete는 0101의 식으로 다시 alter policy
-- -- project_audiences는 0105의 몸통으로 다시 create or replace
-- drop function if exists public.leader_profile_ids_for(int);
-- drop function if exists public.leader_hidden_project_ids();
-- drop function if exists public.my_leader_years();
-- commit;
