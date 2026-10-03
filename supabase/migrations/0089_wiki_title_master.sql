-- ============================================================================
-- 0089 — 위키 제목·소제목 고치기는 마스터만 (사용자 결정 2026-10-03)
-- ----------------------------------------------------------------------------
-- 제목도 wiki_edits 한 줄이다 — 열쇠가 `#`로 시작한다: 장 제목 `#title` · 블록 소제목 `#h:<블록 열쇠>`.
-- 문장 고치기(승인 전원)는 그대로 두고, `#` 줄만 is_master()일 때 넣고 고칠 수 있게 정책 안에서 and로 좁힌다
-- (permissive 정책은 OR라 새 정책을 더하면 넓어진다 — HANDOFF §5).
-- 앱은 마스터에게만 제목 칸을 세운다(views/wikiView.jsx) · 겹치기는 wikiCore.overlayTitles.
-- 코드보다 먼저 나가도 된다(정책만 좁힌다).
-- ============================================================================

begin;

alter policy wiki_edits_insert on public.wiki_edits
  with check (public.is_approved() and (left(item_key, 1) <> '#' or public.is_master()));

alter policy wiki_edits_update on public.wiki_edits
  using (public.is_approved() and (left(item_key, 1) <> '#' or public.is_master()))
  with check (public.is_approved() and (left(item_key, 1) <> '#' or public.is_master()));

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select policyname, qual, with_check from pg_policies where tablename = 'wiki_edits';
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   alter policy wiki_edits_insert on public.wiki_edits with check (public.is_approved());
--   alter policy wiki_edits_update on public.wiki_edits using (public.is_approved()) with check (public.is_approved());
