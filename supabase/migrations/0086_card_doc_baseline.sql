-- 0086 — 같이 쓰기 버전 기록의 **기준 판** (2026-09-29 · 두 사람 실측에서 나온 것)
-- ----------------------------------------------------------------------------
-- 같이 쓰기 전에 이미 본문이 있던 업무는, 처음 고친 사람의 판이 목록 맨 아래에서 `처음 작성한 본문`으로 서고
-- 고친 곳 보기도 빈 글과 견줘 전부 '추가'로 보였다 — 원래 본문이 기록에 없어서다. 그래서 문서를 처음 여는
-- 순간 **원래 본문을 기준 판 한 줄**로 남긴다(kind = 'baseline').
--   · 판이 하나라도 있으면 넣지 않는다 · 두 사람이 동시에 열어도 한 줄(client_id를 업무 id에서 만든다 + on conflict)
--   · 주인은 그 본문을 마지막으로 저장한 사람(updated_by, 없으면 만든 사람) · 시각은 그 저장 시각 — 클라이언트가
--     남의 이름으로 쓸 수 없으니(0084 insert 정책) security definer 함수 하나로만 넣는다.
-- 목록 뒷말은 기준 판만 `처음 작성한 본문`이다(services/coedit/view.js versionLabel).
begin;

alter table public.card_doc_versions add column if not exists kind text not null default 'session'
  check (kind in ('session', 'baseline'));

create or replace function public.card_doc_baseline(p_card uuid, p_md text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  if coalesce(btrim(p_md), '') = '' then return false; end if;
  if exists (select 1 from public.card_doc_versions where card_id = p_card) then return false; end if;
  insert into public.card_doc_versions(client_id, card_id, by, at, md, added, removed, kind)
  select md5('baseline:' || c.id::text)::uuid, c.id, coalesce(c.updated_by, c.created_by), c.updated_at, p_md,
         (select count(*) from regexp_split_to_table(p_md, E'\n') l where btrim(l) <> ''), 0, 'baseline'
    from public.cards c where c.id = p_card
  on conflict (client_id) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.card_doc_baseline(uuid, text) from public, anon;
grant execute on function public.card_doc_baseline(uuid, text) to authenticated;

commit;

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- drop function if exists public.card_doc_baseline(uuid, text);
-- delete from public.card_doc_versions where kind = 'baseline';
-- alter table public.card_doc_versions drop column if exists kind;
-- commit;
