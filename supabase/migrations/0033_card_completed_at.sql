-- ============================================================================
-- 0033_card_completed_at.sql — 업무를 끝낸 시각 (사용자 결정 2026-08-31)
-- ----------------------------------------------------------------------------
-- 왜 컬럼이 필요한가:
--   마감 목록의 '끝낸 업무' 구간을 **최근에 끝낸 것부터** 세우기로 했는데(사용자
--   결정), 정렬 기준이 화면에 안 보이면 목록이 "날짜가 왔다갔다" 하는 것으로 읽힌다
--   (실제 지적 2026-08-31 — 왼쪽 날짜 칸은 마감일이고 정렬은 updated_at이었다).
--   그래서 날짜 칸에 **끝낸 날**을 보여주고 그 값으로 정렬한다.
--
--   `updated_at`으로 대신할 수 없다: 완료된 업무에 첨부를 하나 올리거나(0016의
--   file_count 트리거가 카드를 건드린다) 제목을 고치면 updated_at이 그때로 바뀐다.
--   그 값을 '끝낸 날'이라고 부르면 칸이 거짓말을 한다.
--
-- 값은 앱이 넣지 않고 **트리거가 채운다** — 0010과 같은 판단이다. 저장 경로가
-- 여러 개다(수정 창 · 보드 드래그 · 목록의 완료 버튼 · 상태 칩 · 모바일 상태 옮기기)
-- 라서 앱에서 채우면 한 곳을 빼먹는다. 0010의 set_card_updated_meta에 얹는다 —
-- cards의 before update 트리거를 둘로 나누면 실행 순서가 이름순이 되어 헷갈린다.
--
-- 규칙:
--   · done이 아니던 것이 done이 되면  → completed_at = now()
--   · done이던 것이 done이 아니게 되면 → completed_at = null (되돌리기)
--   · done → done (제목·첨부 수정 등)  → **그대로 둔다**(끝낸 날은 안 바뀐다)
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

alter table public.cards add column if not exists completed_at timestamptz;

create or replace function public.set_card_updated_meta()
returns trigger
language plpgsql
set search_path = public   -- 린터 경고(Function Search Path Mutable) 방지
as $$
begin
  new.updated_at = now();
  -- 서버 함수(service key)로 고치는 경우 auth.uid()가 null이다 → 그럴 때는 유지
  new.updated_by = coalesce(auth.uid(), old.updated_by);

  -- 끝낸 시각(0033). done으로 들어올 때만 찍고, done에서 나갈 때 비운다.
  -- done → done은 손대지 않는다 — 완료된 업무의 제목을 고쳐도 끝낸 날은 그날이다.
  if new.status = 'done' and old.status <> 'done' then
    new.completed_at = now();
  elsif new.status <> 'done' and old.status = 'done' then
    new.completed_at = null;
  else
    new.completed_at = old.completed_at;
  end if;

  return new;
end;
$$;

-- INSERT로 바로 완료 상태인 카드가 들어올 수도 있다(가져오기·복제). before update
-- 트리거는 그것을 못 보므로 INSERT용을 따로 둔다 — 여기서는 updated_by를 건드리지
-- 않는다(created_by가 이미 그 사람이다).
create or replace function public.set_card_completed_on_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'done' and new.completed_at is null then
    new.completed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cards_completed_insert on public.cards;
create trigger trg_cards_completed_insert
  before insert on public.cards
  for each row execute function public.set_card_completed_on_insert();

-- ── 기존 완료 업무 백필 ─────────────────────────────────────────────────────
-- 언제 끝냈는지 아는 방법이 두 가지다. 정확한 쪽부터 쓴다:
--   ① activity에 남은 "상태를 …'완료'(으)로 변경했습니다." 기록의 시각 —
--      실제로 완료로 옮긴 순간이다. 여러 번 오갔으면 **가장 마지막** 것.
--   ② 그 기록이 없으면(6개월 보존에 지워졌거나 0009 이전) updated_at.
-- 새 컬럼이라 이미 값이 있는 행은 없지만, 다시 돌려도 안전하게 is null로 좁힌다.
update public.cards c
set completed_at = coalesce(
  (select max(a.created_at) from public.activity a
    where a.card_id = c.id and a.action like '%''완료''(으)로 변경했습니다.%'),
  c.updated_at
)
where c.status = 'done' and c.completed_at is null;

-- 정렬이 이 컬럼을 본다(끝낸 업무만 · 내림차순). 부분 색인이면 done이 아닌 행은
-- 색인에 들어가지 않아 작다.
create index if not exists idx_cards_completed_at
  on public.cards(completed_at desc) where status = 'done';

-- ============================================================================
-- 되돌리기:
--   drop trigger if exists trg_cards_completed_insert on public.cards;
--   drop function if exists public.set_card_completed_on_insert();
--   drop index if exists public.idx_cards_completed_at;
--   alter table public.cards drop column if exists completed_at;
--   -- set_card_updated_meta는 0010의 본문으로 되돌린다(completed_at 세 갈래를 뺀다)
-- ============================================================================
