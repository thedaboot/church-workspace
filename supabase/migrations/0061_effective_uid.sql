-- ============================================================================
-- 0061 — 합친 계정으로 들어와도 **그 사람으로** 있게 (2026-09-10 사용자 요구)
-- ----------------------------------------------------------------------------
-- "합쳐진 계정 아무거나로 들어와도 그 사람은 그 최종 계정으로 남겨지는 거지?" →
-- 0060까지는 **아니었다.** 합친 계정은 환송 처리라 그 계정으로 로그인하면 '승인을
-- 기다려주세요' 화면만 봤고, 관리자가 승인하면 데이터 없는 빈 중복이 되살아났다.
-- 사용자 요구: "그 계정으로 해도 합쳐진 계정으로 남을 수 있게끔."
--
-- **한 줄 함수 하나로 푼다.** `effective_uid()` = 내가 합쳐 들어간 계정이 있으면 그것,
-- 없으면 나. 그리고 '이 사람이 누구인가'를 판정하는 자리에서 `auth.uid()` 대신 그것을
-- 본다:
--   · `is_approved()`  — 합친 계정도 승인된 것으로 본다(남긴 계정이 승인돼 있으면).
--                        그래야 로그인이 막히지 않는다
--   · `my_person_id()` — 명단 축으로 이어진다. 순 소속·순장 자격·교역자·직분·출석이
--                        그대로 살아난다(0035의 권한 헬퍼 아홉이 이 함수를 본다)
--   · 개인 표 셋(service_notes · qt_entries · bible_state) — 예배 노트·묵상·성경 읽기
--                        상태가 **남긴 계정의 것 하나**로 모인다. 이 셋만 고치는 이유는
--                        `(사람, 날짜)`가 유일해야 하는 표라, 놔두면 어느 계정으로
--                        들어왔는지에 따라 노트가 두 벌로 갈린다
--
-- **손대지 않는 것**: 댓글(`comments.author_id`)·담당자(`card_assignees`)·활동 기록은
-- 각자의 계정 id로 남는다. 그건 "누가 눌렀나"의 기록이고, **화면에 보이는 이름·사진은
-- 클라이언트가 합친 계정의 것으로 풀어 준다**(cloudSync의 표 · 같은 회차). 그래서 남들
-- 눈에는 언제나 한 사람이다.
--
-- **완전히 한 계정으로 만들려면** '내 정보 → 연결된 계정'(Supabase linkIdentity)으로
-- 두 로그인 방법을 한 계정에 붙이는 것이 정본이다. 이미 따로 가입한 뒤에는 그 길이
-- 막히므로, 이 마이그레이션이 그 자리를 메운다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- 내가 합쳐 들어간 계정이 있으면 그것, 없으면 나. **합치기는 한 단계만 따라간다** —
-- 0060이 합칠 때 옛 표를 새 주인으로 옮기므로 사슬이 생기지 않는다(그래도 재귀로 두면
-- 값이 정해지지 않는 위험만 늘어난다).
create or replace function public.effective_uid()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((select p.merged_into from public.profiles p where p.id = auth.uid()), auth.uid());
$$;
revoke all on function public.effective_uid() from public, anon;
grant execute on function public.effective_uid() to authenticated;

-- ── is_approved: 합친 계정도 통과한다(남긴 계정이 승인돼 있으면) ─────────────
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = public.effective_uid() and p.approved
  ) or public.is_admin();
$$;

-- ── my_person_id: 명단 축으로 이어진다 ──────────────────────────────────────
create or replace function public.my_person_id()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select p.id from public.people p
   where p.profile_id = public.effective_uid() and p.removed_at is null
   limit 1;
$$;

-- ── 개인 표 셋 — 노트·묵상·성경 상태는 남긴 계정 하나로 모인다 ──────────────
-- 정책 본문만 바꾼다(표·컬럼은 그대로). 읽기의 '내 것' 갈래와 쓰기의 주인 판정에서
-- auth.uid() → effective_uid()로 옮기는 것이 전부다.
drop policy if exists service_notes_select on public.service_notes;
create policy service_notes_select on public.service_notes
  for select using (
    profile_id = public.effective_uid()
    or (shared_to_sun and public.is_approved() and public.same_sun(profile_id))
  );
drop policy if exists service_notes_write on public.service_notes;
create policy service_notes_write on public.service_notes
  for all using (profile_id = public.effective_uid() and public.is_approved())
  with check (profile_id = public.effective_uid() and public.is_approved());

drop policy if exists qt_entries_select on public.qt_entries;
create policy qt_entries_select on public.qt_entries
  for select using (
    profile_id = public.effective_uid() or (shared and public.is_approved())
  );
drop policy if exists qt_entries_write on public.qt_entries;
create policy qt_entries_write on public.qt_entries
  for all using (profile_id = public.effective_uid() and public.is_approved())
  with check (profile_id = public.effective_uid() and public.is_approved());

drop policy if exists bible_state_own on public.bible_state;
create policy bible_state_own on public.bible_state
  for all using (profile_id = public.effective_uid())
  with check (profile_id = public.effective_uid() and public.is_approved());

comment on function public.effective_uid() is
  '합친 계정이면 남긴 계정의 id, 아니면 auth.uid(). 사람 판정은 이 값을 본다(0061)';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   -- 합친 계정으로 들어온 것처럼 흉내 내어(롤백 트랜잭션) 사람 판정이 이어지는지:
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     '{"sub":"<합친 계정 id>","email":"<그 이메일>","role":"authenticated"}', true);
--   select public.effective_uid() as eff, public.is_approved() as ok,
--          public.my_person_id() as person, public.leads_any_sun() as 순장;
--   rollback;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- 세 함수를 0022·0035의 본문으로 create or replace 하고(effective_uid 대신 auth.uid()),
-- 위 다섯 정책도 auth.uid()로 되돌린 뒤 `drop function public.effective_uid();`
