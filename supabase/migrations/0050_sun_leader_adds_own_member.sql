-- ============================================================================
-- 0050 — 순장이 자기 순에 사람을 넣을 수 있게 (2026-09-06)
-- ----------------------------------------------------------------------------
-- **왜 필요한가 — 순장의 '미등록 출석자 추가'가 반만 되고 있다.**
-- 결정 6(docs/V2.md)은 출석 화면에서 새신자를 그 자리에 올릴 수 있게 했고, 0035의
-- `people_insert`도 그래서 `leads_any_sun()`을 넣어 두었다. 그런데 출석은
-- `attendance_insert`가 `can_check_all_attendance() or leads_sun_of(person_id)`로 막는다 —
-- `leads_sun_of`는 **그 사람이 내 순의 순원인가**를 묻는데, 갓 만든 사람은 어느 순에도
-- 없다. 그래서 순장 계정에서는 사람만 만들어지고 출석은 42501로 튕겼다(순장 계정으로
-- 재현 2026-09-06). 화면은 '명단에는 올렸지만 출석으로 표시하지 못했어요'라고 말한다.
--
-- 화면이 하려는 일은 "새신자를 **내 순에** 올리고 출석을 찍는다"인데, 그 첫 걸음을
-- 여는 정책이 없다. `group_members_write`(0035 · 0045가 마지막으로 갈아 끼움)의 순 갈래는
-- `can_manage_sun()`(마스터·관리자·교역자·리더순장)이라 **평순장은 자기 순에도 사람을
-- 못 넣는다.**
--
-- **경계는 딱 그만큼만 연다.** 편성 자격(순 만들기·순장 지정·연도 개편·남의 순 편집)은
-- 그대로 `can_manage_sun()`이다. 여기서 더하는 것은 INSERT 하나이고, 조건도 셋이다:
--   · 그 순(`type = 'sun'`)의 **올해**(`kst_year()`) 행이고 살아 있을 것(`removed_at is null`)
--   · 그 순의 순장이 **나**일 것(`leader_person_id = my_person_id()`)
--   · 출석을 체크할 수 있는 사람일 것 — `leads_any_sun()`이 이미 그 뜻이다
-- 빼는 것(DELETE)·옮기는 것(UPDATE)은 열지 않는다. 순장이 순원을 **내보내는** 일은
-- 편성이지 출석이 아니다(사용자 결정이 필요한 자리라 여기서 넓히지 않는다).
--
-- 정책은 permissive라 `group_members_write`와 OR로 붙는다 — 기존 자격자는 그대로다.
--
-- **적용 순서: DB 먼저, 코드는 그대로 두어도 안전하다.** 이 정책이 없으면 코드
-- (worshipView addPerson → worship.addToSun)가 42501을 받고 기존 문구로 떨어질 뿐이다
-- (명단에는 올라간다 — 지금과 같다).
-- ============================================================================

create policy group_members_sun_leader_insert on public.group_members
  for insert with check (
    public.is_approved()
    and public.leads_any_sun()
    and exists (
      select 1 from public.groups g
      where g.id = group_id
        and g.type = 'sun'
        and g.year = public.kst_year()
        and g.removed_at is null
        and g.leader_person_id = public.my_person_id()
    )
  );

comment on policy group_members_sun_leader_insert on public.group_members is
  '순장이 자기 순(올해)에 사람을 넣는다 — 미등록 출석자 추가의 첫 걸음(0035 attendance_insert의 leads_sun_of가 이 행을 본다). 빼기·옮기기는 열지 않는다';

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select policyname, cmd, with_check from pg_policies
--    where tablename = 'group_members' order by policyname;
--   -- 순장 계정으로(0022 방식 — 트랜잭션 + rollback):
--   --   begin; set local role authenticated;
--   --   select set_config('request.jwt.claims','{"sub":"<순장 uuid>"}', true);
--   --   insert into people (name) values ('검사새싹') returning id;      -- 1줄
--   --   insert into group_members (group_id, person_id)
--   --     values ('<그 순 uuid>', '<위 id>');                            -- 1줄
--   --   insert into attendance (service_id, person_id)
--   --     values ('<주보 uuid>', '<위 id>');                             -- 1줄
--   --   insert into group_members (group_id, person_id)
--   --     values ('<남의 순 uuid>', '<위 id>');                          -- 42501이어야 한다
--   --   rollback;

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- drop policy if exists group_members_sun_leader_insert on public.group_members;
