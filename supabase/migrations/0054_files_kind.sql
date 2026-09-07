-- ============================================================================
-- 0054 — files.kind: 주보에 붙는 파일의 갈래 (2026-09-08)
-- ----------------------------------------------------------------------------
-- 주보 파일은 0047까지 **송폼** 하나였다(`files.service_id`). 사용자가 큐시트를 링크뿐 아니라
-- **파일로도** 붙이고 싶다고 해서(2026-09-08) 같은 표·같은 업로드 한 벌(cloud.uploadOwnedFile →
-- uploadServiceFile)을 쓰고 갈래만 한 칸으로 가른다. 별도 표를 두지 않는 이유는 HANDOFF §2-1 —
-- 송폼과 큐시트는 언제나 주보와 같이 읽고 쓰는 첨부이고, 다른 것은 "어느 줄에 서느냐"뿐이다.
--
-- 값: 'songform'(기본 — 0047 이후의 모든 주보 파일이 이 뜻이었다) · 'cuesheet'.
-- 업무 첨부(card_id)는 null로 둔다 — 그쪽은 갈래가 없다.
-- RLS는 그대로다(0047의 주보 갈래 정책이 service_id를 보므로 kind는 자격에 영향이 없다).
-- ============================================================================

alter table public.files add column if not exists kind text
  check (kind is null or kind in ('songform', 'cuesheet'));
comment on column public.files.kind is
  '주보 파일의 갈래 — songform(송폼) · cuesheet(큐시트). 업무 첨부는 null(0054)';

-- 지금까지의 주보 파일은 전부 송폼이었다
update public.files set kind = 'songform' where service_id is not null and kind is null;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select kind, count(*) from public.files where service_id is not null group by 1;
--   -- 송폼 N · cuesheet 0

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   alter table public.files drop column if exists kind;
--   (클라이언트도 같이 — worship.js fetchServiceFiles/uploadServiceFile가 kind를 읽고 쓴다)
