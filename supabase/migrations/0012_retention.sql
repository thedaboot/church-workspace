-- ============================================================================
-- 0012_retention.sql — 알림·활동 기록 보존 기간 (pg_cron)
-- ----------------------------------------------------------------------------
-- 둘 다 지우는 코드가 없어서 계속 쌓이기만 한다. 읽은 알림은 며칠 지나면 아무도
-- 보지 않고, 활동 기록은 카드마다 수십 건씩 붙는다. 그리고 활동은 업무 창을 열 때
-- 카드 단위로 읽으므로, 오래된 행이 쌓이면 그 조회가 같이 무거워진다.
--
-- 정한 값:
--   · 읽은 알림  : 30일  (안 읽은 알림은 지우지 않는다)
--   · 활동 기록  : 6개월 (그보다 오래된 카드의 '활동 기록' 탭은 그만큼 비게 된다)
-- 기간을 바꾸려면 아래 interval 한 군데만 고치면 된다.
--
-- 시각은 UTC 기준이다(Supabase의 cron은 UTC로 돈다). 19:00 UTC = 04:00 KST —
-- 새벽에 돌게 잡았다.
-- ============================================================================

-- Supabase에서 pg_cron을 켜는 공식 절차. 이미 켜져 있으면 그대로 넘어간다.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

-- cron.schedule은 같은 이름으로 다시 부르면 기존 작업을 갱신한다(재적용 안전).
select cron.schedule(
  'purge-read-notifications',
  '0 19 * * *',
  $$delete from public.notifications where read and created_at < now() - interval '30 days'$$
);

select cron.schedule(
  'purge-old-activity',
  '30 19 * * 0',   -- 일요일 새벽에 한 번
  $$delete from public.activity where created_at < now() - interval '6 months'$$
);

-- 확인: select jobid, jobname, schedule, active from cron.job;
-- 되돌리기: select cron.unschedule('purge-read-notifications');
