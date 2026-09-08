-- ============================================================================
-- 0056 — 실시간 발행에 sun_guides · attendance_guests 추가 (2026-09-09)
-- ----------------------------------------------------------------------------
-- 0049가 v2 표 아홉을 supabase_realtime에 넣었는데, 그 뒤에 생긴 두 표가 빠져 있었다:
--   · attendance_guests(0053) — 손님만 입력된 예배는 실시간 신호 없이 다음 진입에서야 반영됐다
--     (HANDOFF §6-9-ap). 참석 수(주보 상세·홈·내 순)가 낡는다.
--   · sun_guides(0039 · 0055에서 pinned) — 마스터가 가이드를 고정하거나 순장이 다시 만들어도
--     다른 사람 화면의 `groups:guide:*` 캐시가 그 화면이 떠 있는 동안 낡았다.
-- 클라이언트 짝은 services/liveV2.js TABLE_CACHE(표 → 캐시 접두)이고 tests/logcheck가 개수(11)를 못 박는다.
-- 0049와 같은 모양(멱등 — 이미 들어 있으면 건너뛴다). replica identity는 기본키(d) 그대로.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['sun_guides', 'attendance_guests'] loop
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
--     where pubname = 'supabase_realtime' and tablename in ('sun_guides','attendance_guests');
--   -- 두 줄
--
-- ── 되돌리기 ───────────────────────────────────────────────────────────────
--   alter publication supabase_realtime drop table public.sun_guides, public.attendance_guests;
--   (클라이언트 liveV2.TABLE_CACHE에서 두 줄과 logcheck의 11도 같이 되돌린다)
