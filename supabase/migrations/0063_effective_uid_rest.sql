-- ============================================================================
-- 0063 — 합친 계정의 **나머지** auth.uid() 자리도 effective_uid()로 (감사 2026-09-11)
-- ----------------------------------------------------------------------------
-- 0061은 다섯 정책과 함수 둘(is_approved·my_person_id)만 옮기고 나머지 `auth.uid()`
-- 자리를 그대로 뒀다. 그래서 합친 계정으로 로그인하면 **알림 벨이 거의 비고**,
-- '내 순에 공유된 노트'가 0건이고, **옛 댓글·업무·첨부·링크 삭제**와 **반응 토글**과
-- **다녀간 시각 찍기**가 조용히 실패했다. 여기서 그 자리를 한 번에 덮는다.
-- (첨부 업로드·드라이브 미리보기 403은 서버 키로 도는 경로라 RLS가 아니다 —
--  `api/drive.js`·`api/drive-file.js`가 `merged_into`를 따라 읽는 것으로 같이 고쳤다.)
--
-- **규칙 셋으로 정리한다.**
--   · "내 것인가"를 보는 자리(using)는 **두 id를 다 내 것으로 본다** —
--     `in (auth.uid(), public.effective_uid())`. 합치기 전후로 같은 사람의 행이
--     두 id에 갈려 있다(0059는 댓글·업무·첨부의 '누가 눌렀나' 칸을 일부러 안 옮겼다).
--     한쪽만 보면 **옛 것이 안 지워지거나 새 것이 안 지워진다** — 둘 다 실제로 겪는다.
--   · **주인을 새로 적는 자리**(insert의 with check · 내 정보 · 소속 · 푸시 구독)는
--     `public.effective_uid()` 하나로 모은다. 그래야 다음부터는 갈리지 않는다.
--   · 알림 '읽음' 표시처럼 **주인을 안 건드리는 update**의 with check는 using과 같다.
--
-- **`profiles_insert`는 그대로 둔다** — 가입 순간 자기 행을 만드는 자리라
-- `auth.uid() = id`가 아니면 아무도 첫 행을 못 만든다.
--
-- **정책 수를 늘리지 않는다**(§6-31-a — permissive는 OR라서 느슨한 정책 하나가
-- 엄한 정책을 무력화한다). 전부 `alter policy`로 **있는 정책의 본문만** 바꾼다.
-- `effective_uid()`는 0061에 있다 — 여기서 다시 만들지 않는다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 1. 사람 판정 함수 셋 ────────────────────────────────────────────────────
-- same_sun: '내 순에 공유된 노트'가 0건이던 이유. 내 쪽(mine)만 옮긴다 —
-- 상대 쪽(other_profile)은 부르는 정책이 넘겨주는 값이고 이미 남긴 계정의 id다.
create or replace function public.same_sun(other_profile uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  with mine as (
    select g.id from public.groups g
    left join public.group_members gm on gm.group_id = g.id
    join public.people p on p.id in (gm.person_id, g.leader_person_id)
    where g.type = 'sun' and g.year = public.kst_year() and g.removed_at is null
      and p.profile_id = public.effective_uid()
  ),
  theirs as (
    select g.id from public.groups g
    left join public.group_members gm on gm.group_id = g.id
    join public.people p on p.id in (gm.person_id, g.leader_person_id)
    where g.type = 'sun' and g.year = public.kst_year() and g.removed_at is null
      and p.profile_id = other_profile
  )
  select exists (select 1 from mine m join theirs t on m.id = t.id);
$$;

-- is_pastor: 0035의 헬퍼 아홉 중 my_person_id를 안 거치는 유일한 하나라 혼자 남아 있었다.
create or replace function public.is_pastor()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.people p
    where p.profile_id = public.effective_uid() and p.is_pastor and p.removed_at is null
  );
$$;

-- touch_last_seen: '오늘 다녀간 사람'이 합친 계정에게만 안 찍혔다. security invoker
-- 그대로 두고(아래 profiles_update가 남긴 계정 행을 허락한다) 대상 행만 옮긴다.
create or replace function public.touch_last_seen()
returns timestamptz
language sql
volatile
as $$
  update public.profiles
     set last_seen_at = now()
   where id = public.effective_uid()
  returning last_seen_at;
$$;

-- ── 2. 알림 (0005) ──────────────────────────────────────────────────────────
-- 벨이 비어 보이던 자리. insert 정책('남에게 보내는' 알림)은 건드리지 않는다.
alter policy "notifications_select_own" on public.notifications
  using (recipient_id in (auth.uid(), public.effective_uid()));
alter policy "notifications_update_own" on public.notifications
  using (recipient_id in (auth.uid(), public.effective_uid()))
  with check (recipient_id in (auth.uid(), public.effective_uid()));
alter policy "notifications_delete_own" on public.notifications
  using (recipient_id in (auth.uid(), public.effective_uid()));

-- ── 3. 내가 남긴 것 지우기 (0001 · 0047) ────────────────────────────────────
-- 0022가 `is_approved() and (…)`로 감싼 뒤의 본문을 그대로 유지한다 —
-- 감싼 것을 벗기면 승인 절차가 이 네 자리에서만 뚫린다.
alter policy comments_delete on public.comments
  using (public.is_approved() and (author_id in (auth.uid(), public.effective_uid()) or public.is_admin()));
alter policy cards_delete on public.cards
  using (public.is_approved() and (created_by in (auth.uid(), public.effective_uid()) or public.is_admin()));
alter policy resource_links_delete on public.resource_links
  using (public.is_approved() and (created_by in (auth.uid(), public.effective_uid()) or public.is_admin()));
-- files_delete는 0047이 업무 첨부/주보 송폼으로 갈라 뒀다 — 업무 갈래만 옮긴다.
alter policy files_delete on public.files
  using (
    public.is_approved()
    and (
      case when files.service_id is null
        then (files.uploaded_by in (auth.uid(), public.effective_uid()) or public.is_admin())
        else public.can_edit_service()
      end
    )
  );

-- ── 4. 댓글 반응 (0032) ─────────────────────────────────────────────────────
-- **컬럼 기본값도 같이 옮긴다.** 클라이언트는 comment_id와 kind만 보내고 주인은 DB가
-- 정한다 — 기본값이 auth.uid()인 채로 정책만 effective_uid()로 올리면 합친 계정은
-- **반응을 아예 못 남긴다**(insert가 with check에 걸린다).
alter table public.comment_reactions alter column user_id set default public.effective_uid();
alter policy comment_reactions_insert on public.comment_reactions
  with check (public.is_approved() and user_id = public.effective_uid());
alter policy comment_reactions_delete on public.comment_reactions
  using (user_id in (auth.uid(), public.effective_uid()));

-- ── 5. 푸시 구독 (0017) ─────────────────────────────────────────────────────
-- 기기당 한 행이고 endpoint가 unique다. 합치기 전에 그 기기로 구독했다면 행이
-- 옛 id로 남아 있으므로 **읽기·지우기·갱신 대상 판정**은 두 id를 다 보고,
-- 갱신·생성으로 적히는 주인은 남긴 계정 하나다.
alter policy push_subscriptions_select_own on public.push_subscriptions
  using (profile_id in (auth.uid(), public.effective_uid()));
alter policy push_subscriptions_insert_own on public.push_subscriptions
  with check (profile_id = public.effective_uid());
alter policy push_subscriptions_update_own on public.push_subscriptions
  using (profile_id in (auth.uid(), public.effective_uid()))
  with check (profile_id = public.effective_uid());
alter policy push_subscriptions_delete_own on public.push_subscriptions
  using (profile_id in (auth.uid(), public.effective_uid()));

-- ── 6. 내 정보 · 소속 (0001 · 0008) — §6-34-g를 닫는다 ──────────────────────
-- 화면에 보이는 것은 남긴 계정인데 저장은 자기 행으로 갔다(사용자 결정 2026-09-10에
-- 적어만 뒀던 자리). 이제 저장도 남긴 계정 행으로 간다.
-- **profiles_insert는 손대지 않는다**(가입 순간 자기 행을 만드는 자리).
alter policy profiles_update on public.profiles
  using (id in (auth.uid(), public.effective_uid()))
  with check (id = public.effective_uid());
alter policy "profile_teams write own" on public.profile_teams
  using (public.is_approved() and (profile_id in (auth.uid(), public.effective_uid())))
  with check (public.is_approved() and (profile_id = public.effective_uid()));

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   -- 정책 수가 늘지 않았나(§6-31-a) · 본문이 실제로 옮겨졌나:
--   select tablename, policyname, qual, with_check from pg_policies
--    where schemaname = 'public'
--      and tablename in ('notifications','comments','cards','files','resource_links',
--                        'comment_reactions','push_subscriptions','profiles','profile_teams')
--    order by 1, 2;
--   select pg_get_functiondef('public.same_sun(uuid)'::regprocedure);
--   select pg_get_functiondef('public.is_pastor()'::regprocedure);
--   select pg_get_functiondef('public.touch_last_seen()'::regprocedure);
--   select column_default from information_schema.columns
--    where table_name = 'comment_reactions' and column_name = 'user_id';
--
--   -- 합친 계정으로 들어온 것처럼 흉내 내어(롤백 트랜잭션):
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     '{"sub":"<합친 계정 id>","email":"<그 이메일>","role":"authenticated"}', true);
--   select public.effective_uid(), public.is_pastor();
--   select count(*) from public.notifications;          -- 벨에 뜰 줄
--   rollback;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- 세 함수를 0036(same_sun) · 0035(is_pastor) · 0048(touch_last_seen)의 본문으로
-- create or replace 하고, 위 정책들을 auth.uid()로 되돌린다(alter policy로 같은 자리에):
--   alter policy "notifications_select_own" on public.notifications using (recipient_id = auth.uid());
--   alter policy "notifications_update_own" on public.notifications using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
--   alter policy "notifications_delete_own" on public.notifications using (recipient_id = auth.uid());
--   alter policy comments_delete on public.comments using (public.is_approved() and (author_id = auth.uid() or public.is_admin()));
--   alter policy cards_delete on public.cards using (public.is_approved() and (created_by = auth.uid() or public.is_admin()));
--   alter policy resource_links_delete on public.resource_links using (public.is_approved() and (created_by = auth.uid() or public.is_admin()));
--   alter policy files_delete on public.files using (public.is_approved() and (case when files.service_id is null then (files.uploaded_by = auth.uid() or public.is_admin()) else public.can_edit_service() end));
--   alter table public.comment_reactions alter column user_id set default auth.uid();
--   alter policy comment_reactions_insert on public.comment_reactions with check (public.is_approved() and user_id = auth.uid());
--   alter policy comment_reactions_delete on public.comment_reactions using (user_id = auth.uid());
--   alter policy push_subscriptions_select_own on public.push_subscriptions using (profile_id = auth.uid());
--   alter policy push_subscriptions_insert_own on public.push_subscriptions with check (profile_id = auth.uid());
--   alter policy push_subscriptions_update_own on public.push_subscriptions using (profile_id = auth.uid()) with check (profile_id = auth.uid());
--   alter policy push_subscriptions_delete_own on public.push_subscriptions using (profile_id = auth.uid());
--   alter policy profiles_update on public.profiles using (auth.uid() = id) with check (auth.uid() = id);
--   alter policy "profile_teams write own" on public.profile_teams using (public.is_approved() and (profile_id = auth.uid())) with check (public.is_approved() and (profile_id = auth.uid()));
