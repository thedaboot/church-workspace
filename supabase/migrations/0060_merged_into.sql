-- ============================================================================
-- 0060 — 합쳐진 계정에 표를 남긴다 (2026-09-09)
-- ----------------------------------------------------------------------------
-- 0059가 만든 함정을 막는다. 합친 계정은 **환송 처리**로 남는데(행을 지우면 다시
-- 로그인해 새 프로필이 생겨 합친 일이 헛일이 된다 — 0059 머리말), 그러면 멤버 화면의
-- '환송한 사람' 구역에 앉고 거기에는 **'다시 초대하기'** 버튼이 있다. 그걸 누르면
-- 데이터가 하나도 없는(0059가 다 옮겼다) 빈 중복 계정이 되살아난다.
--
-- DB만 보면 **합쳐서 환송된 계정과 그냥 환송된 계정을 가를 수 없다** — 둘 다
-- `approved = false` + `removed_at`이고 `removed_by`도 마스터다. 그래서 칸 하나를 둔다.
--
-- 컬럼이 맞는 자리다(§2-1): 프로필과 언제나 같이 읽고, 값은 계정 하나에 하나뿐이다.
-- 자기 참조라 `on delete set null`이다 — 남긴 계정을 나중에 지워도(그럴 일은 없지만)
-- 이 칸 때문에 삭제가 막히지 않는다.
--
-- **백필**: 2026-09-09에 사용자가 이미 합친 셋을 이메일로 짚어 채운다. 그 셋은 데이터가
-- 0건임을 확인했고(담당자·댓글·반응·알림·푸시·노트·묵상·팀·활동·명단 전부), 살아남은
-- 계정은 각각 `jhm6154@naver.com`·`hoon000209@gmail.com`이다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists merged_into uuid references public.profiles(id) on delete set null;

comment on column public.profiles.merged_into is
  '이 계정이 합쳐져 들어간 계정. 값이 있으면 합쳐서 환송된 것이므로 다시 초대하지 않는다(0060)';

-- 0059의 함수에 이 한 줄을 더한다(나머지는 그대로다 — create or replace).
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
  -- 이미 합쳐진 계정을 남길 쪽으로 고르면, 그 계정으로 옮긴 것이 다시 갈린다
  if exists (select 1 from public.profiles where id = p_keep and merged_into is not null) then
    raise exception '이미 다른 계정으로 합쳐진 계정은 남길 수 없습니다' using errcode = '22023';
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
  -- 합쳐 들어간 계정을 가리키던 표는 새 주인으로 따라간다(합치기를 두 번 한 경우)
  update public.profiles set merged_into = p_keep where merged_into = p_drop;

  -- ── 지우는 계정은 환송 처리하고 **합쳐졌다는 표를 남긴다**(0060) ──────────
  update public.profiles
     set approved = false, removed_at = now(), removed_by = auth.uid(), merged_into = p_keep
   where id = p_drop;

  return moved || jsonb_build_object('keep', p_keep, 'dropped', p_drop);
end;
$$;

revoke all on function public.merge_profiles(uuid, uuid) from public, anon;
grant execute on function public.merge_profiles(uuid, uuid) to authenticated;

-- ── 백필: 2026-09-09에 사용자가 이미 합친 셋 ────────────────────────────────
-- 이메일로 짚는다 — id는 이 파일을 읽는 사람에게 아무것도 말해 주지 않는다.
update public.profiles d
   set merged_into = k.id
  from public.profiles k
 where k.email = 'jhm6154@naver.com'
   and d.email in ('jhm6154@gmail.com', 'jhm8004@snu.ac.kr')
   and d.removed_at is not null and d.merged_into is null;

update public.profiles d
   set merged_into = k.id
  from public.profiles k
 where k.email = 'hoon000209@gmail.com'
   and d.email = 'hoon_209@naver.com'
   and d.removed_at is not null and d.merged_into is null;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select d.email as 합쳐진, k.email as 남은
--     from public.profiles d join public.profiles k on k.id = d.merged_into
--    order by 2, 1;                                  -- 세 줄이어야 한다
--   select count(*) from public.profiles where merged_into is not null;   -- 3
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- alter table public.profiles drop column if exists merged_into;
-- (함수는 0059의 본문으로 create or replace 하면 된다 — merged_into 두 줄만 빼면 같다)
