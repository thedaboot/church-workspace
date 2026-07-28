-- ============================================================================
-- 0011_linter_warnings.sql — Supabase 어드바이저 경고 정리
-- ----------------------------------------------------------------------------
-- 대시보드 Advisors > Warnings 에 뜨던 것들을 SQL로 고칠 수 있는 만큼 고친다.
--
--   (A) Function Search Path Mutable — public.set_updated_at
--   (B) Public Bucket Allows Listing — storage.content-images
--   (C) Public Can Execute SECURITY DEFINER Function — handle_new_user / is_admin
--                                                      / rls_auto_enable
--   (D) Leaked Password Protection — SQL로 못 바꾼다(아래 설명)
-- ============================================================================

-- ── (A) search_path 고정 ────────────────────────────────────────────────────
-- 트리거 함수라 위험도는 낮지만, search_path가 열려 있으면 같은 이름의 함수를
-- 다른 스키마에 심어 가로챌 수 있다는 지적이다. 고정해 두면 그만이다.
alter function public.set_updated_at() set search_path = public;

-- ── (B) 공개 버킷의 목록 조회 막기 ──────────────────────────────────────────
-- content-images는 public 버킷이라 /object/public/... 경로로 정책과 무관하게 읽힌다.
-- 그런데 storage.objects에 SELECT 정책까지 열려 있어서 list API로 버킷 안 파일을
-- 전부 훑을 수 있었다(누가 어떤 이미지를 올렸는지 목록으로 노출).
-- 정책을 지우면 목록만 막히고 이미지 표시는 그대로다 — 앱은 list를 쓰지 않는다.
drop policy if exists "content_images_public_read" on storage.objects;

-- ── (C) SECURITY DEFINER 함수의 실행 권한 ───────────────────────────────────
-- handle_new_user()는 auth.users 트리거 전용이다. 트리거의 EXECUTE 권한은
-- CREATE TRIGGER 시점에 검사하고 실행 때 다시 보지 않으므로, 전부 회수해도
-- 가입 트리거는 그대로 돈다.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- is_admin()은 RLS 정책(projects 삭제, cards/comments/files 삭제 등) 안에서 호출된다.
-- 정책 표현식은 질의하는 사용자 권한으로 평가되므로 authenticated의 EXECUTE는
-- 남겨야 한다. PUBLIC에서만 회수한다 → "Public Can Execute" 경고는 사라지고
-- "Signed-In Users Can Execute" 경고는 남는다(이건 의도한 설계다.
-- 로그인 사용자가 이 함수를 직접 불러도 "나는 관리자인가"만 알 수 있다).
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- rls_auto_enable()은 이 레포의 마이그레이션이 만든 함수가 아니다(대시보드/확장에서
-- 온 것으로 보인다). 무엇을 하는지 확인하지 않은 함수라 동작을 바꾸지 않는 선까지만
-- 손댄다: PUBLIC에서 회수하고 지금 접근 가능했던 authenticated에는 다시 부여한다.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public';
    execute 'grant execute on function public.rls_auto_enable() to authenticated';
  end if;
end $$;

-- ── (D) Leaked Password Protection ──────────────────────────────────────────
-- Auth 설정이라 SQL로 켤 수 없다(대시보드 Authentication > Policies).
-- 이 앱은 비밀번호 로그인을 쓰지 않는다 — 구글·카카오 OAuth만 켜져 있어서
-- 저장하는 비밀번호가 없다. 켜도 손해는 없지만 지금은 해당되는 사용자가 없다.
