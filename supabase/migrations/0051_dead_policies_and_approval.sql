-- ============================================================================
-- 0051 — 죽은 storage 정책 정리 + 주보·순모임 가이드에 '승인' 조건 (2026-09-06)
-- ----------------------------------------------------------------------------
-- 라이브 DB만 읽어 보고 잡아낸 두 가지다. 화면에서는 아무 증상이 없어서(둘 다
-- **더 열어 주는** 쪽으로 어긋나 있다) 검증 스위트로는 절대 안 보인다.
--
-- ── (A) storage.objects의 마이그레이션에 없는 수동 정책 5개 ──────────────────
-- 대시보드에서 손으로 만든 뒤 0003·0004로 다시 적으면서 이름만 바뀐 쌍둥이들이다.
-- pg_policies로 확인한 짝(정책 본문이 글자 그대로 같다):
--   attachments_select ≡ attachments_select_authenticated   using (bucket_id = 'attachments')
--   attachments_insert ≡ attachments_insert_authenticated   with check (bucket_id = 'attachments')
--   attachments_delete ≡ attachments_delete_owner_or_admin  using (bucket_id = 'attachments'
--                                                                  and (owner_id = auth.uid() or is_admin()))
-- 남는 쪽이 글자 그대로 같으므로 지워도 **권한이 1비트도 안 바뀐다.**
--
-- 나머지 둘은 쌍둥이가 아니라 **0004를 무력화하고 있었다.** RLS 정책은 같은 명령끼리
-- OR로 합쳐지므로, 조건이 느슨한 정책 하나가 붙으면 엄한 정책은 있으나 마나다.
--   content_images_insert       with check (bucket_id = 'content-images')            ← 버킷만 본다
--   content_images_insert_own   with check (bucket_id = ... and foldername[1] = uid) ← 0004의 '본인 폴더에만'
-- 앞의 것 때문에 로그인한 사람은 **남의 폴더 경로로도** 본문 이미지를 올릴 수 있었다.
--   content_images_delete            using (... owner_id = uid or is_admin())
--   content_images_delete_owner_or_admin  using (... foldername[1] = uid or is_admin())  ← 0004
-- 0004에 대응 정책이 있으므로 같이 지운다. 지우기 전에 확인한 것: content-images의
-- 18개 오브젝트 전부 owner_id = foldername[1]이라(0행 불일치) 남는 정책만으로 지금
-- 있는 파일을 그대로 지울 수 있다. 업로드 경로는 `${auth.uid()}/<uuid>.<ext>`
-- (cloud.js uploadContentImage)라 0004의 with check를 그대로 통과한다.
--
-- 'content_images_public_read'가 라이브에 없는 것은 정상이다 — 0011이 일부러 지웠다
-- (공개 버킷 목록 조회 차단). 공개 읽기는 storage의 public 엔드포인트가 처리한다.
--
-- ── (B) 승인 안 된 계정이 작성 중 주보를 읽을 수 있었다 ─────────────────────
-- `services_write`는 FOR ALL이라 **SELECT도 포함**한다. 그런데 조건이
-- `can_edit_service()` 하나뿐이라, `services_select`가 걸어 둔 `is_approved()`가
-- permissive OR로 무력화됐다. 즉 가입 승인을 아직 안 받은 회장·교역자·미디어팀 계정이
-- draft 주보를 읽을 수 있었다(0022가 승인 게이트를 만든 뜻과 어긋난다).
-- `sun_guides_select`·`sun_guides_write`(0039)도 같은 모양이라 같이 고친다.
--
-- 재현(적용 전): 미승인 프로필 + 올해 '회장'·'리더순장' 직분 → set local role authenticated
--   → select from services where status='draft'  → 1행,  sun_guides → 1행
-- 적용 뒤 같은 재현 → 둘 다 0행.
--
-- `is_approved()`는 관리자면 참이므로(0022) 관리자 경로는 그대로다.
-- ============================================================================

-- ── (A) 쌍둥이·구멍 정책 정리 ───────────────────────────────────────────────
drop policy if exists "attachments_select"     on storage.objects;
drop policy if exists "attachments_insert"     on storage.objects;
drop policy if exists "attachments_delete"     on storage.objects;
drop policy if exists "content_images_insert"  on storage.objects;
drop policy if exists "content_images_delete"  on storage.objects;

-- ── (B) 승인 게이트 ─────────────────────────────────────────────────────────
drop policy if exists services_write on public.services;
create policy services_write on public.services
  for all using (public.is_approved() and public.can_edit_service())
  with check (public.is_approved() and public.can_edit_service());

drop policy if exists sun_guides_select on public.sun_guides;
create policy sun_guides_select on public.sun_guides
  for select using (
    public.is_approved() and (public.leads_any_sun() or public.can_manage_sun())
  );

drop policy if exists sun_guides_write on public.sun_guides;
create policy sun_guides_write on public.sun_guides
  for all using (public.is_approved() and public.can_manage_sun())
  with check (public.is_approved() and public.can_manage_sun());

-- 확인:
--   select policyname, cmd, qual, with_check from pg_policies where schemaname='storage';
--   select policyname, cmd, qual, with_check from pg_policies
--    where tablename in ('services','sun_guides');
