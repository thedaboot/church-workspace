-- ============================================================================
-- 0027 — '내보낸 사람'과 '아직 승인 안 한 사람'을 가른다 (사용자 지적 2026-08-26)
-- ----------------------------------------------------------------------------
-- 0022는 `approved` 하나로 둘을 겸했다. 그래서 **환송한 사람이 다시 '승인을
-- 기다리는 사람'으로 올라왔다** — 관리자가 방금 내보낸 사람을 다시 수락하라고
-- 화면이 조르는 꼴이다.
--
-- `removed_at`이 차 있으면 '내보낸 사람'이고, 비어 있으면서 approved가 false면
-- '아직 승인 안 한 사람'이다.
--
-- **프로필 행을 지우지 않는 이유**: `profiles.id`가 `auth.users`를 참조하므로
-- 행을 지워도 계정은 남는다. 그 사람이 다시 로그인하면 `ensureMyProfile`이 행을
-- 새로 만들고 **다시 승인 대기로 올라온다** — 지운 의미가 없다. 계정 자체를
-- 지우려면 뭔가 쓴 적 있는 사람은 애초에 삭제가 막히고(§4.5), 지난 댓글·기록의
-- 작성자도 함께 사라진다. 그래서 '접근을 끊고 기억한다'가 실제로 되는 유일한
-- 방식이다(사용자가 0022 때 고른 것과 같은 판단이다).
-- ============================================================================

alter table public.profiles add column if not exists removed_at timestamptz;
alter table public.profiles add column if not exists removed_by uuid references auth.users;

comment on column public.profiles.removed_at is
  '환송한 시각. 차 있으면 승인 대기 목록에 다시 올라오지 않는다 — 0027 주석';

-- 이미 내보낸 사람이 있으면(승인이 한 번 됐다가 풀린 사람) 지금 시각으로 채운다.
-- approved_at이 있는데 approved가 false면 "승인됐다가 풀렸다" = 내보낸 것이다.
update public.profiles
set removed_at = coalesce(removed_at, now())
where not approved and approved_at is not null;

-- ── 확인 ───────────────────────────────────────────────────────────────────
--   select display_name, approved, approved_at is not null as 승인이력,
--          removed_at is not null as 내보냄
--   from profiles order by removed_at nulls last, approved, created_at;

-- ── 되돌리기 ───────────────────────────────────────────────────────────────
-- alter table public.profiles drop column if exists removed_at, drop column if exists removed_by;
