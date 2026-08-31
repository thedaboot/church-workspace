-- ============================================================================
-- 0034_fix_completed_at_backfill.sql — 0033의 백필이 한 일을 바로잡는다
-- ----------------------------------------------------------------------------
-- 0033을 라이브에 적용해 보니 백필이 **한 건도 채우지 못했고**, 그러면서 완료된
-- 카드 28건의 `updated_at`을 오늘로 밀어 버렸다. 원인이 둘이다.
--
-- ① **트리거가 내 UPDATE를 덮었다.** 0033의 set_card_updated_meta에 이렇게 썼다:
--
--      if   new.status = 'done' and old.status <> 'done' then new.completed_at = now();
--      elsif new.status <> 'done' and old.status = 'done' then new.completed_at = null;
--      else new.completed_at = old.completed_at;      -- ← 이 줄
--
--    백필 UPDATE는 done → done이라 마지막 갈래로 떨어졌고, old.completed_at이
--    아직 null이라 방금 넣은 값을 null로 되돌렸다.
--
--    **그 else는 애초에 필요가 없었다.** before update 트리거의 NEW는 SET에 없는
--    컬럼이 이미 old 값이다 — 가만히 두면 done → done에서 completed_at은 저절로
--    유지된다. 명시적으로 대입하는 순간 "이 컬럼을 직접 고치는 UPDATE"까지
--    무력화된다(백필·손보정·앞으로의 마이그레이션 전부). 그 줄을 뺀다.
--
-- ② **updated_at은 무조건 now()다.** 0010이 일부러 그렇게 만들었고(저장 경로가
--    여러 개라 앱에 맡기지 않는다) 그건 맞다. 그러니 값을 손보는 UPDATE를 돌릴
--    때는 **트리거를 잠깐 끄고** 돌려야 한다. 0033은 그러지 않았다.
--
-- 되살리기: 28건의 원래 updated_at은 되돌릴 수 없다(덮어썼다). activity에 남은
-- 마지막 기록 시각으로 **추정**해서 넣는다 — 오늘로 두는 것보다 훨씬 가깝고,
-- 실제 사건에서 나온 값이다. 활동 기록이 없으면 created_at으로 떨어진다.
-- (기록을 남기지 않는 저장 — 값이 안 바뀐 저장·카드 순서 드래그·첨부 개수 트리거 —
--  은 활동에 안 남으므로 그만큼은 이르게 잡힐 수 있다. updated_by는 안 덮였다:
--  psql로 돌리면 auth.uid()가 null이라 0010이 old 값을 유지한다.)
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

-- ── ① 트리거 함수 고치기 — else 갈래를 뺀다 ─────────────────────────────────
create or replace function public.set_card_updated_meta()
returns trigger
language plpgsql
set search_path = public   -- 린터 경고(Function Search Path Mutable) 방지
as $$
begin
  new.updated_at = now();
  -- 서버 함수(service key)로 고치는 경우 auth.uid()가 null이다 → 그럴 때는 유지
  new.updated_by = coalesce(auth.uid(), old.updated_by);

  -- 끝낸 시각(0033). **두 전환에서만** 손댄다.
  -- done → done은 아무 대입도 하지 않는다 — NEW가 이미 old 값을 들고 있으므로
  -- 완료된 업무의 제목·첨부를 고쳐도 끝낸 날은 그대로고, completed_at을 직접
  -- 고치는 UPDATE(백필 등)도 그 값이 살아남는다(0034가 고친 자리).
  if new.status = 'done' and old.status <> 'done' then
    new.completed_at = now();
  elsif new.status <> 'done' and old.status = 'done' then
    new.completed_at = null;
  end if;

  return new;
end;
$$;

-- ── ② 백필 다시 — 트리거를 끄고 돌린다 ──────────────────────────────────────
alter table public.cards disable trigger trg_cards_updated_meta;

with last_event as (
  select card_id, max(created_at) as at
    from public.activity where card_id is not null group by card_id
),
done_log as (
  -- 완료로 **들어온** 기록만. `'완료'(으)로`가 그 방향이다
  -- (`'완료'에서 …(으)로`는 완료에서 나간 기록이라 안 걸린다).
  select card_id, max(created_at) as at
    from public.activity
   where action like '%''완료''(으)로 변경했습니다.%'
   group by card_id
)
update public.cards c
   set completed_at = coalesce(d.at, l.at, c.created_at),
       -- 0033의 백필이 오늘로 밀어 버린 값을 추정치로 되돌린다
       updated_at   = greatest(coalesce(l.at, c.created_at), c.created_at)
  from (select id from public.cards where status = 'done') t
  left join done_log   d on d.card_id = t.id
  left join last_event l on l.card_id = t.id
 where c.id = t.id;

alter table public.cards enable trigger trg_cards_updated_meta;

-- ============================================================================
-- 되돌리기:
--   -- 함수는 0033의 본문으로 (else 갈래를 되살린다 — 권하지 않는다)
--   alter table public.cards disable trigger trg_cards_updated_meta;
--   update public.cards set completed_at = null where status = 'done';
--   alter table public.cards enable trigger trg_cards_updated_meta;
--   -- updated_at은 이미 덮인 값이라 되돌릴 원본이 없다
-- ============================================================================
