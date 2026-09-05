-- ============================================================================
-- 0049 — v2 표(예배·말씀·모임·명단)를 Realtime 발행에 넣는다 (2026-09-06)
-- ----------------------------------------------------------------------------
-- 증상: 남이 주보를 발행해도, 나눔을 올려도, 명단의 직분을 고쳐도 **그 화면에 머무는
--       동안은 영영 모른다.** 화면을 나갔다 들어와야 갱신되고, 그마저 첫 프레임은
--       옛 캐시다(services/cache.js의 stale-while-revalidate).
--
-- 원인: `supabase_realtime` 발행 목록에 v1 표 9개(activity·cards·comment_reactions·
--       comments·files·notifications·profiles·projects·resource_links)만 있고 v2 표는
--       하나도 없었다. 코드에도 이 표들의 구독이 0개다. 0018이 profiles에서 겪은
--       것과 같은 함정이다(§6-21-a — "캐시해 둔 조회 결과를 만들 때마다 이 표가
--       바뀌면 누가 알려주나를 같이 정한다").
--
-- 앱 쪽: `services/liveV2.js`가 채널 하나(`church-v2`)로 아래 표를 듣고, 표마다
--       정해진 **캐시 접두를 비운 뒤**(dropCache) 그 화면이 떠 있을 때만 재조회를
--       시킨다. 행 단위 리듀서를 만들지 않는다 — 이 표들은 화면이 통째로 다시 읽어도
--       싼 목록이고, 리듀서를 두면 표가 늘 때마다 두 벌을 고쳐야 한다.
--
-- ── RLS는 realtime에도 걸린다 ───────────────────────────────────────────────
-- 발행에 넣는다고 새로 노출되는 것은 없다. Realtime은 INSERT·UPDATE를 내보낼 때
-- 구독자의 토큰으로 그 표의 select 정책을 다시 돌린다(적용 시점의 라이브 정책):
--   services          select: is_approved() and (status='published' or can_edit_service())
--                     → **작성 중(draft) 주보는 편집 자격자에게만 간다**
--   attendance        select: is_approved()            (원래 승인 멤버 전원 공개)
--   service_notes     select: 본인 or (shared_to_sun and 같은 순)
--   qt_entries        select: 본인 or (shared and is_approved())
--                     → **비공개 묵상은 본인에게만 간다**
--   people/people_roles/groups/group_members  select: is_approved()
--   club_applications select: 본인 or 관리자 or 그 동아리 리더
-- 즉 전부 **지금 화면이 이미 조회할 수 있는 것과 같은 경계**다.
--
-- 하나만 다르다: **DELETE 이벤트는 RLS로 걸러지지 않고 replica identity(=기본키)만
-- 실려 나간다.** 여기 표들의 기본키는 uuid(또는 uuid 쌍)라 지워졌다는 사실과 id
-- 말고는 아무 내용도 나가지 않는다. 본문이 실려 나갈 수 있는 `replica identity full`은
-- **켜지 마세요** — 그 순간 지워진 비공개 묵상의 본문이 모두에게 나갑니다.
--
-- group_meetings는 일부러 뺐다 — 화면이 동아리 상세를 열 때만 읽고 캐시하지 않아서
-- (groupsView) 알려 줄 자리가 없다. 나중에 그 목록을 캐시하게 되면 같이 넣는다.
--
-- 적용 전 발행 목록(9): activity cards comment_reactions comments files
--                       notifications profiles projects resource_links
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'services', 'attendance', 'service_notes', 'qt_entries',
    'people', 'people_roles', 'groups', 'group_members', 'club_applications'
  ] loop
    -- 이미 들어 있는 표는 건너뛴다(멱등 — 두 번 돌려도 duplicate_object가 안 난다)
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── 확인 ───────────────────────────────────────────────────────────────────
--   select tablename from pg_publication_tables
--     where pubname = 'supabase_realtime' order by tablename;
--   -- 18개여야 한다(기존 9 + 위 9)
--
--   -- replica identity가 전부 기본키(d)인지 — full이면 지워진 행 본문이 나간다
--   select relname, relreplident from pg_class
--     where relnamespace = 'public'::regnamespace
--       and relname in ('services','attendance','service_notes','qt_entries',
--                       'people','people_roles','groups','group_members','club_applications');
--
-- ── 되돌리기 ───────────────────────────────────────────────────────────────
--   alter publication supabase_realtime drop table public.services, public.attendance,
--     public.service_notes, public.qt_entries, public.people, public.people_roles,
--     public.groups, public.group_members, public.club_applications;
