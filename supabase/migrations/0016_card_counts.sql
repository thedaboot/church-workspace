-- ============================================================================
-- 0016_card_counts.sql — 카드에 댓글 수 · 첨부 수 (트리거로 유지)
-- ----------------------------------------------------------------------------
-- 목록 화면에서 카드를 열지 않고도 "대화가 있나 / 파일이 붙었나"를 알아야 한다.
-- 그런데 댓글은 업무 창을 열 때만 읽는다(HANDOFF §5의 22번) — 개수를 보려고 전체
-- 댓글을 다시 읽으면 예전 구조로 되돌아간다. 그래서 개수만 카드에 들고 있는다.
--
-- 첨부는 지금도 초기 로드가 전부 읽지만(listAllFiles) 같은 컬럼으로 통일한다.
-- 목록 조회에서 files를 안 읽어도 되게 되는 길이 열리고, 세는 자리가 한 곳이 된다.
--
-- 앱이 계산해서 넣지 않는다. 실시간·여러 사람이 동시에 쓰는 환경에서 앱이 세면
-- 금방 어긋난다. 트리거가 DB 안에서 유지하므로 어느 경로로 들어와도 맞는다.
-- ============================================================================

alter table public.cards
  add column if not exists comment_count integer not null default 0,
  add column if not exists file_count integer not null default 0;

-- 한 카드의 개수를 실제 행 수로 다시 센다(증감이 아니라 재계산 — 어긋나도 자기 회복).
create or replace function public.recount_card(p_card_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.cards c set
    comment_count = (select count(*) from public.comments m where m.card_id = p_card_id),
    file_count    = (select count(*) from public.files f where f.card_id = p_card_id)
  where c.id = p_card_id;
$$;

-- comments·files의 INSERT/DELETE/UPDATE 후 그 카드를 다시 센다.
-- DELETE payload에는 new가 없고, UPDATE로 card_id가 옮겨가는 경우도 있어 양쪽을 본다.
create or replace function public.tg_recount_card()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' or tg_op = 'UPDATE') and old.card_id is not null then
    perform public.recount_card(old.card_id);
  end if;
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') and new.card_id is not null then
    perform public.recount_card(new.card_id);
  end if;
  return null;   -- AFTER 트리거이므로 반환값은 쓰이지 않는다
end;
$$;

drop trigger if exists trg_recount_card_comments on public.comments;
create trigger trg_recount_card_comments
  after insert or update or delete on public.comments
  for each row execute function public.tg_recount_card();

drop trigger if exists trg_recount_card_files on public.files;
create trigger trg_recount_card_files
  after insert or update or delete on public.files
  for each row execute function public.tg_recount_card();

-- 지금 있는 카드들을 한 번 맞춘다
update public.cards c set
  comment_count = (select count(*) from public.comments m where m.card_id = c.id),
  file_count    = (select count(*) from public.files f where f.card_id = c.id);

-- 확인:
--   select id, title, comment_count, file_count from public.cards order by created_at;
-- 어긋났을 때 전부 다시 세기: 위 update 문을 다시 실행하면 된다.
--
-- 되돌리기:
--   drop trigger trg_recount_card_comments on public.comments;
--   drop trigger trg_recount_card_files on public.files;
--   drop function public.tg_recount_card();
--   drop function public.recount_card(uuid);
--   alter table public.cards drop column comment_count, drop column file_count;
