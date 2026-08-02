-- 0018 새로 가입한 사람이 열려 있는 다른 화면에도 바로 보이게 한다
--
-- 증상: 강희라 님이 가입해서 자기를 담당자로 지정했는데, 그 전에 열어 둔 다른 사람 화면의
--       활동 기록에 "알 수 없음님이 담당자를 강희라로 변경했습니다"로 떴다.
--
-- 원인: 앱의 프로필 id→이름 표(cloudSync.profileIdToName)는 loadCloudState()에서 한 번만
--       만들어지는데, profiles가 Realtime 발행 목록에 없어서 새 가입을 알 방법이 없었다.
--       그래서 그 탭은 새로 온 사람을 영영 모른다(새로고침 전까지).
--
-- 이름표만 어긋나는 것이 아니다. 같은 표를 담당자·멘션이 같이 쓴다:
--   - cardToApp의 assigneeNames가 모르는 id를 걸러내서, 조인에 그 사람만 있으면 목록이
--     비고 옛 cards.assignees 컬럼으로 폴백한다 → 담당자가 딴 사람으로 보인다
--   - 담당자 선택기·멘션 자동완성 목록에 그 사람이 없다
--   - 그 상태에서 카드를 저장하면 assigneeIdsOf가 그 사람의 id를 못 찾아 조인에서 빠진다
--     → **방금 지정한 담당자가 조용히 지워진다**
--
-- profiles의 SELECT 정책은 authenticated 전체라 Realtime이 로그인 사용자에게 전달한다.
-- 앱은 이 이벤트를 전체 재조회(onFullReload)로 받는다 — profiles 변경은 가입·이름 수정
-- 뿐이라 드물다.
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

-- 확인:
--   select tablename from pg_publication_tables
--     where pubname = 'supabase_realtime' order by tablename;
--
-- 되돌리기:
--   alter publication supabase_realtime drop table public.profiles;
