-- ============================================================================
-- 0002_profile_selfheal.sql — 프로필 백필 (자가 복구 후속 보정)
-- ----------------------------------------------------------------------------
-- 배경: on_auth_user_created 트리거(0001_init.sql)가 환경에 따라 발화하지 않아
--       auth.users는 있는데 public.profiles 행이 없는 사례가 관찰됨.
--       그 결과 프로필 저장·데이터 로드가 연쇄 실패했다.
--
-- 조치: (1) 아래 백필로 누락된 프로필을 일괄 생성한다.
--       (2) 클라이언트도 loadCloudState()/updateMyProfile()에서 자기 행을
--           upsert 하도록 자가 복구 로직을 병행한다(코드 측 방어).
--
-- 주의: auth.users 스키마 ALTER는 권한상 불가하므로 넣지 않는다.
--       이 파일은 이미 라이브 DB에 수동 적용된 조치의 재현 가능 기록이다.
-- ============================================================================

insert into public.profiles (id, display_name, avatar_url)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
  u.raw_user_meta_data ->> 'avatar_url'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;
