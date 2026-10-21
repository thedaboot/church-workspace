-- ============================================================================
-- 0118 — set_support_paid 거절 문구(사용자 결정 2026-10-21)
-- ----------------------------------------------------------------------------
-- 0117의 거절 문구 '지원비 지급은 마스터와 총무만 체크할 수 있어요' → '지원비 지급은 총무만 체크할 수 있어요'.
-- 마스터라는 직분은 없고(앱 운영 계정이다), 마스터는 어차피 체크할 수 있어 거절 문구에 적을 까닭이 없다. 판정은 그대로(마스터 · 총무).
-- 본문은 문구 한 줄만 다르다. 순서 무관(코드는 이 문구를 읽지 않고 토스트 이유로만 보인다).
-- 되돌리기: 0117 파일의 set_support_paid 블록을 다시 실행한다.
-- ============================================================================

begin;

create or replace function public.set_support_paid(p_meeting uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_approved() and (public.is_master() or public.has_role('treasurer'))) then
    raise exception '지원비 지급은 총무만 체크할 수 있어요' using errcode = '42501';
  end if;
  if p_paid then
    insert into public.club_support_payments (meeting_id, paid_by) values (p_meeting, public.effective_uid())
    on conflict (meeting_id) do nothing;
  else
    delete from public.club_support_payments where meeting_id = p_meeting;
  end if;
end $$;
comment on function public.set_support_paid(uuid, boolean) is '동아리 모임 지원비 지급 체크 — 마스터 · 총무만(42501 · 0117 · 문구 0118)';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select prosrc ~ '총무만 체크' from pg_proc where proname = 'set_support_paid';   -- t
