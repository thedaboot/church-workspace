-- ============================================================================
-- 0116 행사 일정 시간(사용자 승인 목업 ① 2026-10-19 — 시간을 메모에 '11시-12시'로 적고 있었다)
-- ----------------------------------------------------------------------------
-- events에 시작·종료 시각 두 칸(KST 벽시계 · time). 비면 지금처럼 하루 종일이다.
--   · 종료 시각만 있을 수는 없다(시작 시각이 있어야 한다)
--   · 하루 일정이면 종료 시각이 시작 시각보다 뒤여야 한다(종료 시각이 비면 내 달력은 1시간짜리로 본다 — services/events.js)
-- save_event에 두 인자를 **기본값 null로** 더한다. 옛 8인자 함수는 지운다 — 두 벌이 서면 PostgREST가 이름 인자로 고를 때 모호하다.
-- 기본값이 있어 이 파일이 코드보다 먼저 나가도 옛 앱(8인자 이름 호출)은 그대로 저장된다(시각은 null 그대로 — 옛 앱은 시각을 모른다).
-- **순서: 이 마이그레이션 → 코드**(새 앱이 p_start_time을 보내므로 먼저 나가면 저장이 PGRST202로 실패한다).
-- 되돌리기는 파일 맨 아래 주석.
-- ============================================================================

begin;

alter table public.events add column if not exists start_time time;
alter table public.events add column if not exists end_time time;
alter table public.events drop constraint if exists events_time_check;
alter table public.events add constraint events_time_check check (
  (end_time is null or start_time is not null)
  and (start_time is null or end_time is null or end_date > start_date or end_time > start_time)
);

drop function if exists public.save_event(uuid, text, date, date, text, text, text, uuid[]);
create or replace function public.save_event(
  p_id uuid, p_title text, p_start date, p_end date, p_kind text, p_place text, p_memo text, p_cards uuid[],
  p_start_time time default null, p_end_time time default null
) returns public.events
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.events;
begin
  if not (public.is_leader() or public.is_master()) then
    raise exception '행사 일정은 리더진만 바꿀 수 있어요' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_cards, '{}')) > 50 then
    raise exception '관련 업무가 너무 많아요' using errcode = '22023';
  end if;
  insert into public.events as e (id, title, start_date, end_date, kind, place, memo, start_time, end_time)
  values (coalesce(p_id, gen_random_uuid()), btrim(p_title), p_start, coalesce(p_end, p_start), coalesce(p_kind, 'event'),
          btrim(coalesce(p_place, '')), btrim(coalesce(p_memo, '')), p_start_time, case when p_start_time is null then null else p_end_time end)
  on conflict (id) do update set
    title = excluded.title, start_date = excluded.start_date, end_date = excluded.end_date,
    kind = excluded.kind, place = excluded.place, memo = excluded.memo,
    start_time = excluded.start_time, end_time = excluded.end_time
  returning * into r;

  delete from public.event_tasks where event_id = r.id;
  -- 있는 업무만(그 사이 영구 정리된 업무 id는 건너뛴다 · 고른 차례가 position)
  insert into public.event_tasks (event_id, card_id, position)
  select r.id, x.id, min(x.n)::int - 1
    from unnest(coalesce(p_cards, '{}')) with ordinality as x(id, n)
   where exists (select 1 from public.cards c where c.id = x.id)
   group by x.id;
  return r;
end $$;
comment on function public.save_event(uuid, text, date, date, text, text, text, uuid[], time, time) is
  '행사 한 건 + 관련 업무를 한 트랜잭션으로(넣기·고치기) — 리더진 + 마스터만(42501 · 0112) · 시각 두 칸(0116)';
revoke all on function public.save_event(uuid, text, date, date, text, text, text, uuid[], time, time) from public, anon;
grant execute on function public.save_event(uuid, text, date, date, text, text, text, uuid[], time, time) to authenticated, service_role;

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select count(*) from pg_proc where proname = 'save_event';   -- 1
--   리허설(begin … rollback): 리더 claims로 save_event(… p_start_time => '11:00', p_end_time => '12:00') → 행의 두 칸 ·
--   같은 날 종료 10:00 → 23514 · 8인자 이름 호출(옛 앱)도 통과
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   begin;
--   drop function if exists public.save_event(uuid, text, date, date, text, text, text, uuid[], time, time);
--   -- 0112의 8인자 save_event 본문을 그대로 다시 만든다(0112 파일의 함수 블록 + comment·revoke·grant)
--   alter table public.events drop constraint if exists events_time_check;
--   alter table public.events drop column if exists end_time, drop column if exists start_time;
--   commit;
