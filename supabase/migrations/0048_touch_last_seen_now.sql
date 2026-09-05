-- ============================================================================
-- 0048 — 다녀간 시각을 **서버 시계로** 찍는다 (2026-09-06)
-- ----------------------------------------------------------------------------
-- 증상(사용자 2026-09-05): "특정 인물이 1분 전에 업무를 수정했다고 뜨는데, 그 사람
-- 현황을 보면 4분 전에 떠났다고 뜬다." 실제로 라이브에서 박지호 님의
-- `activity.created_at`(15:58:34)이 `profiles.last_seen_at`(15:54:49)보다 **225초 뒤**였다.
--
-- 원인이 둘이었고 이 마이그레이션은 그중 **시계**를 고친다:
--   · `activity.created_at`은 컬럼 기본값이라 **DB의 now()** 다.
--   · `last_seen_at`은 브라우저가 `new Date().toISOString()`으로 만들어 보냈다 —
--     **그 사람 기기의 시계**다. 두 값이 한 화면에서 나란히 비교되는데(활동 피드의
--     'N분 전' vs 멤버 목록의 'N분 전 다녀감') 기준 시계가 다르면 몇 분씩 어긋난다.
--     이 앱은 기기 시계가 어긋나는 것을 이미 알고 있다(`cloud.withClockSkewRetry`).
--
-- 그래서 시각을 **클라이언트가 정하지 않게** 한다. 값을 인자로 받지 않는 것이 핵심이다 —
-- 받는 순간 다시 기기 시계가 들어온다.
--
-- security invoker(기본)로 두는 이유: `profiles_update` 정책이 이미
-- `auth.uid() = id`라서 자기 행만 고칠 수 있다. definer로 올리면 그 정책을 우회하는
-- 함수가 하나 더 생기는데, 여기서 얻을 것이 없다.
-- ============================================================================

create or replace function public.touch_last_seen()
returns timestamptz
language sql
volatile
as $$
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid()
  returning last_seen_at;
$$;

comment on function public.touch_last_seen() is
  '내 profiles.last_seen_at을 서버 시계(now())로 찍는다. 시각을 인자로 받지 않는다 — 받으면 다시 기기 시계가 들어온다(0048)';

-- 함수의 EXECUTE는 Postgres 기본이 PUBLIC이라 anon도 부를 수 있다 — 로그인 안 한
-- 호출은 auth.uid()가 null이라 0행이지만, 부를 수 있는 자리를 남길 이유가 없다.
revoke execute on function public.touch_last_seen() from public;
revoke execute on function public.touch_last_seen() from anon;
grant execute on function public.touch_last_seen() to authenticated;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select public.touch_last_seen();          -- 로그인한 세션에서 timestamptz 1행
--   select last_seen_at from profiles where id = auth.uid();

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop function if exists public.touch_last_seen();
--   (클라이언트는 함수가 없으면 예전처럼 update로 떨어진다 — cloud.touchLastSeen)
