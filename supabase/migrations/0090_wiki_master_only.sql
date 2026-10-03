-- ============================================================================
-- 0090 — 위키 고치기는 마스터만 · 자주 묻는 질문 장도 마스터만 본다 (사용자 결정 2026-10-04)
-- ----------------------------------------------------------------------------
-- 0088은 '함께 쓰는 곳'이라 승인된 사람 누구나 문장을 고치게 했고, 0089는 제목 줄(`#`)만 마스터로 좁혔다.
-- 이제 문장까지 전부 마스터만 넣고 고친다 — `#` 구분은 필요 없어져 정책을 is_master() 하나로 바꾼다.
-- 자주 묻는 질문 장(wiki_pages id 'faq' · api/_wikiBuild.js faqPage)은 물어본 질문을 그대로 싣는 자리라
-- 마스터만 읽는다. 그 장에 사람이 적은 답(wiki_edits page_id 'faq')도 같이 좁힌다.
-- 앱은 마스터에게만 ✎ 수정을 세우고, 마스터가 아니면 장 목록·다붓이 링크에서 그 장을 뺀다(views/wikiView.jsx ·
-- wikiCore.visiblePages). 다붓이 근거는 묻는 사람 세션(RLS)으로 읽으니 마스터가 아니면 그 장이 근거에 안 선다.
-- 코드보다 먼저 나가도 된다(정책만 좁힌다 — 마스터가 아니면 저장이 거절되고 장이 목록에서 빠진다).
-- ============================================================================

begin;

alter policy wiki_edits_insert on public.wiki_edits
  with check (public.is_master());

alter policy wiki_edits_update on public.wiki_edits
  using (public.is_master())
  with check (public.is_master());

alter policy wiki_edits_select on public.wiki_edits
  using (public.is_approved() and (page_id <> 'faq' or public.is_master()));

alter policy wiki_pages_select on public.wiki_pages
  using (public.is_approved() and (id <> 'faq' or public.is_master()));

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select tablename, policyname, qual, with_check from pg_policies where tablename in ('wiki_pages', 'wiki_edits') order by 1, 2;
-- ── 되돌리기(0089 상태로) ────────────────────────────────────────────────────
--   alter policy wiki_edits_insert on public.wiki_edits with check (public.is_approved() and (left(item_key, 1) <> '#' or public.is_master()));
--   alter policy wiki_edits_update on public.wiki_edits
--     using (public.is_approved() and (left(item_key, 1) <> '#' or public.is_master()))
--     with check (public.is_approved() and (left(item_key, 1) <> '#' or public.is_master()));
--   alter policy wiki_edits_select on public.wiki_edits using (public.is_approved());
--   alter policy wiki_pages_select on public.wiki_pages using (public.is_approved());
