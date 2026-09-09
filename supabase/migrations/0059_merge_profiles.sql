-- ============================================================================
-- 0059 — 한 사람의 여러 계정 합치기 (2026-09-09 사용자 요청)
-- ----------------------------------------------------------------------------
-- "한 사람이 여러 계정으로 들어오는 경우, 통합을 시켜야 함. 문진혁, 임재훈 청년 기준으로."
--
-- 구글로 한 번, 카카오로 한 번 가입하면 `auth.users`가 둘이고 `profiles`도 둘이 된다.
-- 그때 그 사람의 데이터는 **두 축으로 갈린다**:
--   · 명단 축(`people.id`) — 출석·순 소속·직분·동아리. **갈리지 않는다**
--   · 계정 축(`profiles.id`) — 업무 담당자·댓글·반응·알림·푸시·노트·묵상·성경 상태·팀.
--     이쪽이 계정마다 따로 쌓인다
-- 게다가 `people.profile_id`가 UNIQUE라 **한쪽 계정만** 명단에 붙고, 붙지 않은 계정으로
-- 로그인하면 `my_person_id()`가 null이어서 순장·교역자 자격이 통째로 사라진다
-- (0035의 권한 헬퍼 아홉이 그 함수를 부른다).
--
-- 그래서 이 함수가 하는 일은 **계정 축을 한쪽으로 옮기는 것**이다. 명단 축은 건드리지
-- 않는다 — 거기는 애초에 갈려 있지 않다.
--
-- **왜 정책이 아니라 rpc인가**(0052와 같은 사정). 남의 댓글·담당자 행을 다른 계정으로
-- 재지정하는 것은 클라이언트 RLS로 할 수 없다. `security definer` 함수 안에서 자격을
-- 먼저 보고(마스터만) 한 트랜잭션으로 옮긴다.
--
-- **겹치는 행은 버린다.** 두 계정이 같은 카드의 담당자이거나 같은 주보에 노트를 썼으면
-- 유니크 제약에 걸린다(아래 표). 그때는 **남기는 계정의 것을 남기고 버리는 계정의 것을
-- 지운다** — 합치는 사람이 "어느 쪽을 남길지" 이미 고른 것이므로 그 뜻을 따른다.
--   · profile_teams (profile_id, team_id)      · card_assignees (card_id, profile_id)
--   · comment_reactions (comment_id, user_id, kind)
--   · service_notes (service_id, profile_id)   · qt_entries (qt_date, profile_id)
--   · bible_state (profile_id PK)              · people (profile_id UNIQUE)
--
-- **지우는 계정의 profiles 행은 지우지 않는다.** `auth.users`는 그대로 남으므로 지워도
-- 그 사람은 다시 로그인해 새 프로필을 만들 수 있고(0001의 handle_new_user), 그러면 합친
-- 일이 헛일이 된다. 대신 **환송 처리**한다(approved=false + removed_at) — 그 계정으로
-- 들어오면 '승인을 기다려주세요' 화면만 보이고 데이터는 남기는 계정에 다 있다.
--
-- **`admins`는 이메일 축이라 건드리지 않는다**(0028 주석의 판단 그대로). 합친 뒤에도
-- 두 이메일이 남으므로, 지운 쪽을 관리자에서 빼고 싶으면 멤버 화면에서 따로 한다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다 — **행을 다시 갈라 놓을 수는 없다**(어느 행이
-- 어느 계정에서 왔는지 남기지 않는다). 되돌리기는 함수를 지우는 것까지다.
-- ============================================================================

begin;

create or replace function public.merge_profiles(p_keep uuid, p_drop uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  moved jsonb := '{}'::jsonb;
  n integer;
begin
  if not public.is_master() then
    raise exception '계정 합치기는 마스터만 할 수 있습니다' using errcode = '42501';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception '남길 계정과 합칠 계정이 서로 달라야 합니다' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_keep) then
    raise exception '남길 계정을 찾지 못했습니다' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_drop) then
    raise exception '합칠 계정을 찾지 못했습니다' using errcode = '22023';
  end if;

  -- ── 겹치면 버리는 것들(유니크·PK가 있는 표) ───────────────────────────────
  delete from public.profile_teams d
   where d.profile_id = p_drop
     and exists (select 1 from public.profile_teams k
                  where k.profile_id = p_keep and k.team_id = d.team_id);
  update public.profile_teams set profile_id = p_keep where profile_id = p_drop;

  delete from public.card_assignees d
   where d.profile_id = p_drop
     and exists (select 1 from public.card_assignees k
                  where k.profile_id = p_keep and k.card_id = d.card_id);
  update public.card_assignees set profile_id = p_keep where profile_id = p_drop;
  get diagnostics n = row_count;
  moved := moved || jsonb_build_object('card_assignees', n);

  delete from public.comment_reactions d
   where d.user_id = p_drop
     and exists (select 1 from public.comment_reactions k
                  where k.user_id = p_keep and k.comment_id = d.comment_id and k.kind = d.kind);
  update public.comment_reactions set user_id = p_keep where user_id = p_drop;

  delete from public.service_notes d
   where d.profile_id = p_drop
     and exists (select 1 from public.service_notes k
                  where k.profile_id = p_keep and k.service_id = d.service_id);
  update public.service_notes set profile_id = p_keep where profile_id = p_drop;
  get diagnostics n = row_count;
  moved := moved || jsonb_build_object('service_notes', n);

  delete from public.qt_entries d
   where d.profile_id = p_drop
     and exists (select 1 from public.qt_entries k
                  where k.profile_id = p_keep and k.qt_date = d.qt_date);
  update public.qt_entries set profile_id = p_keep where profile_id = p_drop;
  get diagnostics n = row_count;
  moved := moved || jsonb_build_object('qt_entries', n);

  -- 성경 읽기 상태는 계정마다 한 줄(PK) — 남기는 쪽에 이미 있으면 그것을 남긴다
  delete from public.bible_state where profile_id = p_drop
    and exists (select 1 from public.bible_state where profile_id = p_keep);
  update public.bible_state set profile_id = p_keep where profile_id = p_drop;

  -- 명단 연결(UNIQUE). 남기는 계정이 이미 명단에 붙어 있으면 그것을 남기고, 버리는
  -- 계정 쪽 연결만 끊는다 — 그때는 **명단 행이 둘**이라는 뜻이므로 화면이 알려 준다.
  if exists (select 1 from public.people where profile_id = p_keep and removed_at is null) then
    update public.people set profile_id = null where profile_id = p_drop;
    moved := moved || jsonb_build_object('people_kept_existing', true);
  else
    update public.people set profile_id = p_keep where profile_id = p_drop;
    moved := moved || jsonb_build_object('people_relinked', true);
  end if;

  -- ── 그냥 옮기는 것들(겹칠 수 없는 표) ─────────────────────────────────────
  update public.push_subscriptions set profile_id = p_keep where profile_id = p_drop;
  update public.notifications set recipient_id = p_keep where recipient_id = p_drop;
  update public.comments set author_id = p_keep where author_id = p_drop;
  get diagnostics n = row_count;
  moved := moved || jsonb_build_object('comments', n);

  update public.cards set created_by = p_keep where created_by = p_drop;
  update public.cards set updated_by = p_keep where updated_by = p_drop;
  update public.cards set ai_summary_by = p_keep where ai_summary_by = p_drop;
  update public.projects set created_by = p_keep where created_by = p_drop;
  update public.resource_links set created_by = p_keep where created_by = p_drop;
  update public.resource_links set view_pw_by = p_keep where view_pw_by = p_drop;
  update public.files set uploaded_by = p_keep where uploaded_by = p_drop;
  update public.files set view_pw_by = p_keep where view_pw_by = p_drop;
  update public.activity set actor_id = p_keep where actor_id = p_drop;
  update public.services set created_by = p_keep where created_by = p_drop;
  update public.attendance set checked_by = p_keep where checked_by = p_drop;
  update public.sun_guides set created_by = p_keep where created_by = p_drop;
  update public.sun_guides set pinned_by = p_keep where pinned_by = p_drop;
  update public.club_applications set decided_by = p_keep where decided_by = p_drop;
  update public.attendance_guests set created_by = p_keep where created_by = p_drop;
  update public.profiles set approved_by = p_keep where approved_by = p_drop;
  update public.profiles set removed_by = p_keep where removed_by = p_drop;

  -- ── 지우는 계정은 환송 처리한다(행은 남긴다 — 머리말) ─────────────────────
  update public.profiles
     set approved = false, removed_at = now(), removed_by = auth.uid()
   where id = p_drop;

  return moved || jsonb_build_object('keep', p_keep, 'dropped', p_drop);
end;
$$;

revoke all on function public.merge_profiles(uuid, uuid) from public, anon;
grant execute on function public.merge_profiles(uuid, uuid) to authenticated;

comment on function public.merge_profiles(uuid, uuid) is
  '한 사람의 두 계정을 합친다(마스터만) — 계정 축 참조를 p_keep으로 옮기고 p_drop은 환송 처리(0059)';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   -- 합칠 후보 보기(같은 이름이 둘):
--   select display_name, count(*), array_agg(id) from public.profiles
--    where removed_at is null group by 1 having count(*) > 1;
--   -- 합친 뒤:
--   select id, display_name, approved, removed_at from public.profiles where id in ('<keep>', '<drop>');
--   select count(*) from public.card_assignees where profile_id = '<drop>';   -- 0이어야 한다
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- **옮긴 행은 다시 갈라 놓을 수 없다**(어느 행이 어느 계정에서 왔는지 남기지 않는다).
-- 되돌리는 것은 함수와, 환송 처리한 계정을 되살리는 것까지다:
--   drop function if exists public.merge_profiles(uuid, uuid);
--   update public.profiles set approved = true, removed_at = null, removed_by = null where id = '<drop>';
