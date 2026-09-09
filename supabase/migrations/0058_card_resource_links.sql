-- ============================================================================
-- 0058 — 참고 링크를 업무(카드)에도 (2026-09-09 사용자 요청)
-- ----------------------------------------------------------------------------
-- "아직 업무에 엑셀 링크 추가해두면 해당 링크로 미리보기 가능, 그리고 해당 파일
-- 수정까지 할 수 있는 구조가 안 갖춰져있는 것 같아."
--
-- 실제로 없던 것은 **카드 단위 자리** 하나입니다. 미리보기와 편집은 이미 됩니다 —
-- `docEmbedSrc`가 구글 문서·시트·슬라이드 주소를 `/edit`으로 바꿔 앱 안 창(DocEmbed)에
-- 띄우고, 비밀번호도 참고 링크에 이미 붙어 있습니다(0053). 그런데 링크를 다는 자리가
-- **프로젝트 헤더뿐**이어서 "이 업무의 시트"를 업무에 붙일 수 없었습니다.
--
-- **왜 조인 테이블을 늘리지 않고 `resource_links`에 축을 더하는가**(§2-1과 어긋나 보이는
-- 자리라 적어 둡니다). §2-1의 기준대로면 "카드와 언제나 같이 읽고 항목이 몇 개뿐"이라
-- `cards`의 jsonb 컬럼이 맞습니다. 그런데 참고 링크에는 **화면 가림 비밀번호 세 칸**
-- (`view_pw`·`_salt`·`_by`)과 `created_by`가 붙어 있고, 그 규칙은 이미 두 벌인 것을
-- 겨우 참고 링크 하나로 모아 둔 상태입니다(§6-31-f). jsonb로 새로 만들면 **세 벌**이
-- 되고, 화면(PinnedLinkChip·PwPrompt)과 서비스(setLinkPassword)도 갈라집니다.
-- 같은 표에 축을 하나 더하면 조회(`listAllLinks`)·실시간·비밀번호·RLS가 그대로 한 벌입니다.
--
-- 배타 CHECK는 0047의 `files_owner_exactly_one`과 같은 모양입니다 — 한 링크는 프로젝트의
-- 것이거나 카드의 것이고, 둘 다이거나 둘 다 아닐 수는 없습니다.
--
-- **RLS는 손대지 않습니다.** 0001의 네 정책이 그대로 카드 링크에도 적용됩니다
-- (select·insert·update는 로그인한 사람, delete는 만든 사람 또는 관리자). 카드가 지워지면
-- 링크도 같이 사라져야 하므로 FK는 `on delete cascade`입니다(프로젝트 축과 같습니다).
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있습니다.
-- ============================================================================

begin;

alter table public.resource_links
  add column if not exists card_id uuid references public.cards(id) on delete cascade;

-- 옛 행은 전부 프로젝트 링크다(card_id가 null) — 백필할 것이 없다.
alter table public.resource_links drop constraint if exists resource_links_owner_exactly_one;
alter table public.resource_links add constraint resource_links_owner_exactly_one
  check ((project_id is null) <> (card_id is null));

create index if not exists idx_resource_links_card_id on public.resource_links(card_id);

comment on column public.resource_links.card_id is
  '업무(카드) 단위 참고 링크. project_id와 배타 — 한 링크는 프로젝트의 것이거나 카드의 것이다(0058)';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   \d+ public.resource_links
--   select count(*) filter (where project_id is not null) as 프로젝트,
--          count(*) filter (where card_id is not null)    as 업무
--     from public.resource_links;
--   -- 배타 CHECK가 실제로 막는지(둘 다 넣으면 23514):
--   -- insert into public.resource_links (project_id, card_id, title, url)
--   --   values ('...','...','x','https://x'); → 실패해야 정상
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- delete from public.resource_links where card_id is not null;   -- 카드 링크를 버린다
-- alter table public.resource_links drop constraint if exists resource_links_owner_exactly_one;
-- drop index if exists idx_resource_links_card_id;
-- alter table public.resource_links drop column if exists card_id;
-- commit;
