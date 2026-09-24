-- ============================================================================
-- 0072 — 첨부 이름을 NFC로 맞춘다 (2026-09-24)
-- ----------------------------------------------------------------------------
-- 맥(사파리·파인더)에서 고른 파일은 이름의 한글이 자모로 풀린 **NFD**로 온다. 앱이 그대로
-- files.name에 넣어서, 눈에는 같은 '주보.pdf'인데 검색에 같은 글자를 쳐도 안 걸렸다
-- (라이브 15행 확인). 새로 올리는 파일은 cloud.uploadOwnedFile이 NFC로 저장하고 검색도
-- 양쪽을 NFC로 비교한다 — 여기서는 이미 들어간 행만 맞춘다.
--
-- **cards의 updated 트리거를 끄고 돌린다.** files에는 trg_recount_card_files(0016)가 있어
-- files UPDATE마다 그 카드를 UPDATE하고, 그러면 trg_cards_updated_meta(0010)가 카드의
-- updated_at을 지금으로 민다 — 이름 글자 모양만 바꿨는데 카드 10장이 '방금 수정'으로 뜬다.
-- (0034의 백필과 같은 방식이다.) files 자신의 updated_at은 트리거대로 지금이 된다.
--
-- **되돌릴 수 없다.** NFC로 합친 뒤에는 어느 행이 원래 NFD였는지 남지 않는다 — 글자로는
-- 같은 이름이라 되돌릴 까닭도 없다.
-- ============================================================================

begin;

alter table public.cards disable trigger trg_cards_updated_meta;

update public.files set name = normalize(name, NFC) where name <> normalize(name, NFC);

alter table public.cards enable trigger trg_cards_updated_meta;

commit;

-- 확인(0이어야 한다):
--   select count(*) from public.files where name <> normalize(name, NFC);
-- 트리거가 다시 켜졌는지(tgenabled = 'O'):
--   select tgname, tgenabled from pg_trigger where tgname = 'trg_cards_updated_meta';
