-- ============================================================================
-- 0004_content_images.sql — 본문(카드 상세) 이미지 붙여넣기용 공개 버킷
-- ----------------------------------------------------------------------------
-- 첨부(attachments, private)와 달리 본문 이미지는 RichText가 <img src>로
-- 바로 렌더해야 하므로 공개(public read) 버킷 'content-images'를 쓴다.
--   · public read (누구나 URL로 열람)
--   · authenticated insert (로그인 사용자만 업로드)
--   · 경로 규칙: `${auth.uid()}/${uuid}.<ext>`  (본인 폴더에만 업로드)
--   · 10MB 제한, 이미지 mime만 허용
-- 라이브 DB에는 이미 적용되어 있고, 이 파일은 재현 가능성을 위한 기록이다.
-- ============================================================================

-- ── (A) Storage 버킷 (public, 10MB, 이미지 mime만) ───────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-images', 'content-images', true, 10485760,
  array['image/png','image/jpeg','image/jpg','image/gif','image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── (B) storage.objects 정책 (idempotent) ────────────────────────────────
-- create policy는 IF NOT EXISTS를 지원하지 않으므로 duplicate_object를 삼킨다.

-- 공개 읽기(anon 포함)
do $$
begin
  create policy "content_images_public_read"
    on storage.objects for select to public
    using (bucket_id = 'content-images');
exception when duplicate_object then null;
end $$;

-- 로그인 사용자가 자기 폴더(첫 경로 세그먼트 = uid)에만 업로드
do $$
begin
  create policy "content_images_insert_own"
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'content-images'
      and (storage.foldername(name))[1] = auth.uid()::text
    );
exception when duplicate_object then null;
end $$;

-- 업로더 본인 또는 관리자만 삭제
do $$
begin
  create policy "content_images_delete_owner_or_admin"
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'content-images'
      and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
    );
exception when duplicate_object then null;
end $$;
