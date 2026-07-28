-- ============================================================================
-- 0010_card_updated_by.sql — 카드를 마지막으로 고친 사람
-- ----------------------------------------------------------------------------
-- 업무 세부 정보에 "작성: 임성빈 · 최근: 7월 28일"만 있어서, 작성자와 수정자가
-- 다를 때 누가 고쳤는지 알 수 없었다. created_by처럼 updated_by를 둔다.
--
-- 값은 앱이 넣지 않고 트리거가 채운다 — 저장 경로가 여러 개(수정 창·드래그·완료
-- 버튼·상태 옮기기)라 앱에서 채우면 한 곳을 빼먹는다. auth.uid()는 RLS와 같은
-- 세션 정보라 위조할 수 없다.
-- ============================================================================

alter table public.cards add column if not exists updated_by uuid references auth.users;

-- updated_at과 같은 트리거에서 함께 채운다(cards 전용).
create or replace function public.set_card_updated_meta()
returns trigger
language plpgsql
set search_path = public   -- 린터 경고(Function Search Path Mutable) 방지
as $$
begin
  new.updated_at = now();
  -- 서버 함수(service key)로 고치는 경우 auth.uid()가 null이다 → 그럴 때는 유지
  new.updated_by = coalesce(auth.uid(), old.updated_by);
  return new;
end;
$$;

drop trigger if exists trg_cards_updated_at on public.cards;
create trigger trg_cards_updated_meta
  before update on public.cards
  for each row execute function public.set_card_updated_meta();

-- 기존 행: 수정 이력을 모르니 작성자로 채우지 않고 비워 둔다(앱은 비면 '수정:'을
-- 표시하지 않고 작성자·생성일만 보여준다).
