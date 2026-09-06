-- ============================================================================
-- 0052 — 출석 메모를 순장도 남길 수 있게 (2026-09-06 사용자 결정)
-- ----------------------------------------------------------------------------
-- 사용자: "출석 메모는 주보를 편집하는 건 아니라고 생각해서." (docs/V2.md §5 결정 대기 ⑱)
--
-- **무엇이 막혀 있었나.** 메모의 저장 자리가 주보 행의 한 칸(`services.attendance_note`,
-- 0036)이라 저장 경로가 `update services` → `services_write`(= `can_edit_service()`)다.
-- 순장은 그 자격이 없으니 한 글자도 남지 않았고, 그래서 회차 9-c는 **화면에서 메모 칸을
-- 감췄다**(worshipAttendance의 `perms.canEdit` 게이트). 이제 반대로 연다.
--
-- **왜 정책이 아니라 rpc인가.** RLS는 행 단위다 — `services`에 UPDATE 정책을 하나 더
-- 붙이면(permissive는 OR · §6-31-a) 순장이 그 행의 **모든 칸**을 고칠 수 있게 된다.
-- 설교 제목도 발행 상태도 같이 열리는 셈이다. 컬럼 단위로 좁히는 길은 컬럼 권한
-- (`grant update (attendance_note)`)인데, RLS 정책과 컬럼 권한을 한 표에서 섞으면
-- "왜 막혔는가"를 두 군데서 읽어야 한다. 그래서 **그 한 칸만 쓰는 함수 하나**를 두고
-- 자격을 함수 안에서 묻는다(0048 `touch_last_seen()`이 값을 인자로 받지 않는 것과 같은
-- 취지 — 함수가 경계를 들고 있다).
--
-- **자격 = 출석을 만질 수 있는 사람.** 전체 출석 자격자(`can_check_all_attendance()` —
-- 관리자·교역자·리더순장 · 0045)와 순장(`leads_any_sun()`)이다. 화면의 게이트도 같은
-- 값이다(worshipAttendance의 `perms.canCheck`). 주보만 쓰는 사람(미디어팀)은 애초에
-- 출석 화면에 들어가지 못하므로(`canAttend = perms.canCheck && …`) 여기서 잃는 것이 없다.
--
-- **발행된 주보만.** 출석 자체가 발행 뒤에만 열린다(worship.js `attendanceVisible`).
-- 작성 중인 주보의 메모는 지금도 주보 편집 자격자가 `services_write`로 쓴다 — 그 길은
-- 건드리지 않는다.
--
-- security definer라 `services_write`를 우회한다. 그래서 **딱 한 칸만** update하고,
-- 자격을 통과하지 못하면 42501로 던진다(화면이 이미 그 코드를 사람 말로 바꾼다).
-- ============================================================================

create or replace function public.set_attendance_note(p_service_id uuid, p_note text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text;
begin
  if not public.is_approved() then
    raise exception '승인된 멤버만 출석 메모를 남길 수 있습니다' using errcode = '42501';
  end if;
  if not (public.can_check_all_attendance() or public.leads_any_sun()) then
    raise exception '출석을 체크할 수 있는 사람만 출석 메모를 남길 수 있습니다' using errcode = '42501';
  end if;

  update public.services
     set attendance_note = p_note,
         updated_at = now()
   where id = p_service_id
     and status = 'published'
  returning attendance_note into v_note;

  if not found then
    -- 지워졌거나 아직 발행 전이다. 화면은 이 코드를 '이미 지워졌어요'로 읽는다.
    raise exception '발행된 주보를 찾지 못했습니다' using errcode = 'P0002';
  end if;

  return v_note;
end;
$$;

comment on function public.set_attendance_note(uuid, text) is
  '발행된 주보의 attendance_note 한 칸만 쓴다 — 출석을 체크할 수 있는 사람(전체 자격자 + 순장)이면 통과. services_write(can_edit_service)를 우회하되 다른 칸은 못 만진다(0052)';

-- EXECUTE는 Postgres 기본이 PUBLIC이다 — 로그인 안 한 호출은 자격 판정에서 42501이지만
-- 부를 수 있는 자리를 남길 이유가 없다(0048과 같은 마무리).
revoke execute on function public.set_attendance_note(uuid, text) from public;
revoke execute on function public.set_attendance_note(uuid, text) from anon;
grant execute on function public.set_attendance_note(uuid, text) to authenticated;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_functiondef('public.set_attendance_note(uuid,text)'::regprocedure);
--   -- 순장 계정으로(0022 방식 — 트랜잭션 + rollback):
--   --   begin; set local role authenticated;
--   --   select set_config('request.jwt.claims','{"sub":"<순장 uuid>"}', true);
--   --   select public.set_attendance_note('<발행된 주보 uuid>', '검사');   -- '검사'
--   --   select public.set_attendance_note('<작성 중 주보 uuid>', '검사');  -- P0002
--   --   rollback;
--   -- 아무 자격도 없는 멤버는 42501이어야 한다.

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop function if exists public.set_attendance_note(uuid, text);
--   (클라이언트도 같이 되돌려야 한다 — worship.js saveAttendanceNote가 이 함수를 부른다)
