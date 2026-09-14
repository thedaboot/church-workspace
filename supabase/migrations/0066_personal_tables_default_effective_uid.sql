-- ============================================================================
-- 0066 — 개인 표 셋의 profile_id 기본값도 effective_uid()로 (감사 2026-09-14)
-- ----------------------------------------------------------------------------
-- 9차 개선 회차의 '합친 계정 경로 점검'에서 나온 **덫 하나**를 미리 없앤다.
--
-- `service_notes`·`qt_entries`·`bible_state`는 세 가지가 어긋나 있었다:
--   · 정책(0061)은 `profile_id = effective_uid()`를 요구한다
--   · 컬럼 기본값은 0036이 만든 `auth.uid()` 그대로였다
--   · 클라이언트는 셋 다 `myUid()`(= effective_uid rpc)로 **값을 직접 넣는다**
-- 그래서 **지금은 아무도 안 아프다** — 기본값이 쓰이는 경로가 없기 때문이다.
--
-- 문제는 다음 사람이다. 셋 중 어느 표든 `profile_id`를 빼고 insert하는 코드가 한 줄
-- 생기면, 합친 계정에서만 기본값 `auth.uid()`(버린 계정 id)가 들어가 `with check`에
-- 걸린다. 화면에는 "저장하지 못했어요"만 뜨고, **합치지 않은 사람에게는 멀쩡히 된다** —
-- §6-34-i와 §6-34-f에서 두 번 겪은 바로 그 모양이다(그때는 첨부 업로드와 알림이었다).
-- 기본값을 정책과 같은 함수로 맞춰 두면 그 길이 애초에 닫힌다.
--
-- **`auth.uid()`가 남는 자리는 그대로 둔다.** `activity.actor_id`·`comments.author_id`·
-- `files.uploaded_by`·`cards.created_by`·`resource_links.created_by`·`sun_guides.created_by`·
-- `attendance.checked_by`·`attendance_guests.created_by`·`projects.created_by`는 '누가 했나'를
-- 적는 칸이고, 0059가 합칠 때 **일부러 안 옮겼다**(그 순간 그 계정이 한 일은 사실이다).
-- 그쪽은 정책이 `in (auth.uid(), effective_uid())`로 두 id를 다 나로 보고(0063),
-- 화면은 `isMyUid`가 같은 규칙을 쓴다. 기본값을 바꾸면 그 사실 기록이 흐려진다.
--
-- 정책·인덱스·실시간(0049)은 건드리지 않는다. `effective_uid()`는 0061에 있고
-- `security definer`라 기본값 자리에서도 돈다(revoke는 anon에만 걸려 있다).
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

alter table public.service_notes alter column profile_id set default public.effective_uid();
alter table public.qt_entries    alter column profile_id set default public.effective_uid();
alter table public.bible_state   alter column profile_id set default public.effective_uid();

comment on function public.effective_uid() is
  '합쳐 들어간 계정이 있으면 남긴 계정 id, 없으면 내 id. 개인 표 셋(service_notes·'
  'qt_entries·bible_state)의 정책과 **기본값**이 둘 다 이것을 본다(0061 · 0066)';

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select table_name, column_name, column_default
--     from information_schema.columns
--    where table_schema='public' and column_name='profile_id'
--      and table_name in ('service_notes','qt_entries','bible_state');
--   -- 셋 다 effective_uid()
--
--   -- '누가 했나' 칸은 auth.uid() 그대로여야 한다(0059의 판단)
--   select table_name, column_name from information_schema.columns
--    where table_schema='public' and column_default like '%auth.uid%' order by table_name;
--   -- activity.actor_id · attendance.checked_by · attendance_guests.created_by ·
--   -- cards.created_by · comments.author_id · files.uploaded_by · projects.created_by ·
--   -- resource_links.created_by · sun_guides.created_by   (아홉 줄)
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   alter table public.service_notes alter column profile_id set default auth.uid();
--   alter table public.qt_entries    alter column profile_id set default auth.uid();
--   alter table public.bible_state   alter column profile_id set default auth.uid();
