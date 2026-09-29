-- 0087 — 판마다 **그 사이에 고친 사람 전부** (2026-09-29 · 두 사람 실측)
-- ----------------------------------------------------------------------------
-- 판은 한 사람의 편집 세션이 끝날 때의 본문이라, 그 세션 동안 **다른 사람이 같이 친 글**도 그 판에 들어간다.
-- 그런데 목록에는 세션을 끝낸 사람 한 명만 서서 남의 글까지 그 사람이 고친 것으로 읽혔다(A의 판에 B가 친 네 줄).
-- 세션 동안 편집을 보낸 사람(채널 메시지에 실린 보낸 이)을 모아 editors에 싣는다 — 목록은 `검증하나 외 1명`.
-- by(세션을 끝낸 사람)는 그대로 두고 editors는 by를 포함한다. 옛 판은 빈 배열(= by 한 사람).
begin;
alter table public.card_doc_versions add column if not exists editors uuid[] not null default '{}'
  check (cardinality(editors) <= 50);
commit;

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- alter table public.card_doc_versions drop column if exists editors;
