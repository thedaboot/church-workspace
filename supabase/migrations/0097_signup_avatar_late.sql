-- ============================================================================
-- 0097 — 가입 트리거가 뒤늦게 온 카카오·구글 메타(사진·이름)를 받아 적는다 (2026-10-13)
-- ----------------------------------------------------------------------------
-- 라이브(2026-10-11 천진영 가입): auth.users 행이 07:23:32.93에 들어와 handle_new_user가 프로필을 만들 때
-- raw_user_meta_data에 아직 avatar_url이 없었고, identity(카카오 사진 포함)는 150ms 뒤(07:23:33.08)에
-- 붙었다. 그래서 profiles.avatar_url이 null로 남아 "기본 프로필로 바뀌어 있다"가 됐다. 10월 가입자 12명 중
-- 한 명만 그랬다 — 경쟁 조건이라 가끔 난다. 앱의 자가 복구(services/cloud/profiles.js ensureMyProfile)는
-- 빈 사진을 '본인이 기본으로 고름'으로 보고 건드리지 않으므로(2026-09-03 덮어쓰기 버그의 반대 방향) 트리거가
-- 메워야 한다.
--
-- 바뀌는 것: 트리거를 **after insert or update of raw_user_meta_data**로. UPDATE에서는 그 사람 프로필의
-- 사진·이름이 **비어 있고 프로필이 10분 안에 만들어졌을 때만** 채운다 — 가입 직후의 빈 칸만 메우고, 사용자가
-- 나중에 '기본으로'를 고른 null(cloudSync.js의 avatar_url = null)은 10분이 지나 있어 건드리지 않는다.
-- INSERT 경로는 0001 그대로(on conflict do nothing). 실행 권한은 0011대로 공개에서 걷혀 있다(그대로).
-- 되돌리는 SQL은 파일 맨 아래 주석.
-- ============================================================================

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (id, display_name, avatar_url)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      new.raw_user_meta_data ->> 'avatar_url'
    )
    on conflict (id) do nothing;
  else
    -- 메타가 뒤늦게 왔다 — 가입 직후(10분)의 빈 칸만 메운다
    update public.profiles p
       set avatar_url   = coalesce(p.avatar_url, new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
           display_name = coalesce(p.display_name, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
     where p.id = new.id
       and (p.avatar_url is null or p.display_name is null)
       and p.created_at > now() - interval '10 minutes';
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created';
--   -- … AFTER INSERT OR UPDATE OF raw_user_meta_data ON auth.users …
--   리허설(ROLLBACK 안): 10분 안에 만든 프로필의 avatar_url을 null로 두고 auth.users의 raw_user_meta_data를
--   같은 값으로 다시 set → 프로필에 사진이 선다 · created_at이 10분 넘은 행은 그대로.
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   0001_init.sql 91~112줄의 함수·트리거(after insert만)를 그대로 다시 돌린다.
