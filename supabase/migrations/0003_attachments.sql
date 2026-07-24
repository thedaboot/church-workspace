-- ============================================================================
-- 0003_attachments.sql — 카드 첨부 파일 (Supabase Storage, private 버킷)
-- ----------------------------------------------------------------------------
-- 저장소: private 버킷 'attachments' (25MB 제한). files 테이블엔 참조만 보관.
-- 라이브 DB에는 수동 적용되어 있고, 이 파일은 재현 가능성을 위한 기록이다.
--
-- 주의(배포자용): files 테이블 컬럼 ALTER(아래 blockA)는 라이브에 아직
--                적용되지 않았을 수 있으므로 배포 시 함께 실행할 것.
-- ============================================================================

-- ── (A) files 스키마 보정 ────────────────────────────────────────────────
alter table public.files alter column drive_file_id drop not null;
alter table public.files add column if not exists storage_path text;
alter table public.files add column if not exists size_bytes bigint;
alter table public.files add column if not exists source text not null default 'storage'
  check (source in ('storage', 'drive'));

-- ── (B) Storage 버킷 (private, 25MB) ─────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)
on conflict (id) do nothing;

-- ── (C) storage.objects 정책 3개 (idempotent) ───────────────────────────
-- create policy는 IF NOT EXISTS를 지원하지 않으므로 duplicate_object를 삼킨다.
do $$
begin
  create policy "attachments_select_authenticated"
    on storage.objects for select to authenticated
    using (bucket_id = 'attachments');
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "attachments_insert_authenticated"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'attachments');
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "attachments_delete_owner_or_admin"
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'attachments'
      and (owner_id = auth.uid()::text or public.is_admin())
    );
exception when duplicate_object then null;
end $$;

-- ── (D) teams 시드 (재현성용 — 7팀) ──────────────────────────────────────
insert into public.teams (name) values
  ('웰컴팀'), ('워십팀'), ('찬양팀'), ('엔지니어팀'), ('미디어팀'), ('임원진'), ('교역자')
on conflict (name) do nothing;
