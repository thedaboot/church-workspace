-- ============================================================================
-- 0093 — 동아리 모임에 활동 보고서(파일) 붙이기 (2026-10-12 사용자 결정 · 20차 묶음 ④)
-- ----------------------------------------------------------------------------
-- 지난 모임마다 '활동 보고서' 파일 줄을 둔다(시안 https://claude.ai/artifact/CYcKxtnnGp6miyJmDY9fgo 4-C).
-- **표를 새로 만들지 않는다** — 0047(주보 송폼)과 같은 판단이다. 첨부는 files 한 벌이 있고
-- 드라이브로 나르는 길(멱등 열쇠 · 3MB 갈래 · 되돌리기 · 편집 사본)도 한 벌이다(§6-29-u).
-- 바뀌는 것은 **축 하나**다: files 행의 주인이 업무냐 주보냐 **모임이냐**.
--
--   · files.meeting_id — nullable. card_id·service_id와 **배타**다(셋 중 정확히 하나).
--     모임을 지우면 행도 같이 간다(cascade — 0047이 card_id를 cascade로 바꾼 것과 같은 이유:
--     set null이면 셋 다 null인 행이 생겨 배타 CHECK에 걸려 모임 삭제가 23514로 죽는다).
--     드라이브 실체는 앱이 모임을 지운 뒤 폴더째 휴지통으로 보낸다(groups.deleteMeeting).
--   · group_meetings.drive_folder_id — 0026(cards)·0047(services)과 같은 자리. 드라이브는
--     `더다붓 워크스페이스/모임/<동아리 이름>/<YYYY-MM-DD>/`이고 id를 적어 두 번째부터 재사용한다.
--     Apps Script는 고칠 것이 없다 — folderFor가 path 배열로 멱등하게 판다(v7 · docs/APPS_SCRIPT.md).
--   · files RLS — **기존 정책 넷은 건드리지 않는다**(20차 묶음 ③의 0092가 업무 갈래를 `alter policy`로
--     조인다 — 같은 정책을 두 파일이 고치면 나중에 적용한 쪽이 앞의 것을 지운다). 대신 모임 갈래를 따로 둔다:
--       permissive 둘 — 모임 행만 보는 읽기(승인된 사람) · 쓰기(관리자 또는 그 동아리장)
--       restrictive 셋 — 모임 행의 insert·update·delete는 **언제나** 관리자 또는 그 동아리장
--     restrictive가 필요한 이유(PITFALLS §6-31-m): 지금의 업무 갈래 조건은 `service_id is null`이라 **모임 행도 그 갈래로
--     통과한다**(permissive는 OR이다 — HANDOFF §5). 그대로 두면 승인된 누구나 남의 모임에 보고서를
--     붙이거나(files_insert) 모임 행을 업무로 옮겨 붙일 수 있다(files_update). restrictive는 AND로
--     걸리므로 기존 정책을 고치지 않고 모임 행만 좁힌다 — `meeting_id is null`인 행(업무·주보)에는
--     언제나 참이라 그 갈래들은 지금과 똑같다. 0092가 업무 갈래를 `card_id is not null`로 조여 모임
--     행이 그쪽을 못 지나게 되면 permissive 둘이 모임 행의 길이 된다 — 둘 중 어느 쪽이 먼저 오든 같다.
--     판정은 0035 group_meetings_write와 **같은 식**이다(is_admin() 또는 그 그룹의 leader_person_id =
--     my_person_id()) — 화면의 `canManageClub`(마스터 · 관리자 · 동아리장)이 그 거울이다.
--
-- 실시간: files는 이미 발행 목록에 있고(0049 이전부터) group_meetings는 일부러 빠져 있다(0049 머리말 —
-- 모임 목록은 캐시하지 않고 동아리 상세를 열 때 읽는다). 여기서 바꾸지 않는다.
--
-- 적용 전 확인(배타 CHECK를 세 갈래로 바꿔도 지금 행은 그대로 통과한다):
--   select count(*) from public.files where (card_id is null) = (service_id is null);   -- 0
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 1. files에 모임 축 ──────────────────────────────────────────────────────
alter table public.files
  add column if not exists meeting_id uuid references public.group_meetings(id) on delete cascade;

comment on column public.files.meeting_id is
  '이 파일이 붙은 동아리 모임(0093 · 활동 보고서). card_id·service_id와 배타 — 셋 중 정확히 하나가 채워진다';

create index if not exists idx_files_meeting_id on public.files(meeting_id);

-- ── 2. 배타 CHECK를 세 갈래로 ───────────────────────────────────────────────
-- 업무 첨부 · 주보 파일 · 모임 보고서 중 하나다. "둘 이상"도 "하나도 없음"도 막는다(0047과 같은 이유 —
-- 주인 없는 행은 어느 화면에도 안 나오면서 드라이브에는 실체가 남는 유령이다).
alter table public.files drop constraint if exists files_owner_exactly_one;
alter table public.files add constraint files_owner_exactly_one
  check (num_nonnulls(card_id, service_id, meeting_id) = 1);

-- ── 3. group_meetings.drive_folder_id (0026·0047과 같은 자리) ───────────────
alter table public.group_meetings add column if not exists drive_folder_id text;

comment on column public.group_meetings.drive_folder_id is
  '드라이브의 이 모임 폴더(모임/<동아리>/<YYYY-MM-DD>). 첫 보고서 업로드 때 채워지고 그 뒤로 재사용된다';

-- ── 4. 모임을 고칠 수 있는가 — 0035 group_meetings_write와 같은 식 ──────────
-- 정책 다섯이 같은 판정을 쓰므로 함수 한 벌로 둔다(0035의 헬퍼들과 같은 모양 — security definer +
-- search_path 고정. groups·group_meetings 읽기는 어차피 승인된 사람에게 열려 있다).
create or replace function public.can_edit_meeting(p_meeting uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_admin() or exists (
    select 1 from public.group_meetings m
    join public.groups g on g.id = m.group_id
    where m.id = p_meeting and g.leader_person_id = public.my_person_id()
  );
$$;

-- ── 5. files — 모임 갈래 정책(기존 넷은 그대로 · 위 머리말) ─────────────────
drop policy if exists files_meeting_select on public.files;
create policy files_meeting_select on public.files
  for select using (
    files.meeting_id is not null
    and public.is_approved() and auth.role() = 'authenticated'
  );

drop policy if exists files_meeting_write on public.files;
create policy files_meeting_write on public.files
  for all using (
    files.meeting_id is not null
    and public.is_approved() and public.can_edit_meeting(files.meeting_id)
  ) with check (
    files.meeting_id is not null
    and public.is_approved() and public.can_edit_meeting(files.meeting_id)
  );

-- restrictive — 모임 행의 쓰기는 어느 permissive를 지나왔든 이 판정을 또 지난다.
-- update는 **양쪽을 다 본다**(0047과 같은 이유 — using만 걸면 업무 첨부를 골라 남의 모임으로
-- 옮겨 붙이고, check만 걸면 모임 보고서를 업무로 빼 갈 수 있다).
drop policy if exists files_meeting_guard_insert on public.files;
create policy files_meeting_guard_insert on public.files
  as restrictive for insert with check (
    files.meeting_id is null or public.can_edit_meeting(files.meeting_id)
  );

drop policy if exists files_meeting_guard_update on public.files;
create policy files_meeting_guard_update on public.files
  as restrictive for update using (
    files.meeting_id is null or public.can_edit_meeting(files.meeting_id)
  ) with check (
    files.meeting_id is null or public.can_edit_meeting(files.meeting_id)
  );

drop policy if exists files_meeting_guard_delete on public.files;
create policy files_meeting_guard_delete on public.files
  as restrictive for delete using (
    files.meeting_id is null or public.can_edit_meeting(files.meeting_id)
  );

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   \d public.files
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'files_owner_exactly_one';
--   select policyname, permissive, cmd from pg_policies
--    where schemaname='public' and tablename='files' order by policyname;   -- 4 + 모임 5
--
--   -- 트랜잭션 + rollback(0022·0045·0047과 같은 방식 · 실데이터는 남기지 않는다):
--   begin; set local role authenticated;
--     select set_config('request.jwt.claims', '{"sub":"<일반 멤버 uuid>","email":"x@y.z"}', true);
--     insert into public.files (meeting_id, name, uploaded_by) values ('<남의 모임 id>', 't', '<그 uuid>');  -- 42501
--   rollback;

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- drop policy if exists files_meeting_guard_delete on public.files;
-- drop policy if exists files_meeting_guard_update on public.files;
-- drop policy if exists files_meeting_guard_insert on public.files;
-- drop policy if exists files_meeting_write on public.files;
-- drop policy if exists files_meeting_select on public.files;
-- drop function if exists public.can_edit_meeting(uuid);
-- -- (모임 보고서 행이 남아 있으면 먼저 지워야 한다 — 두 갈래 CHECK에 걸린다. 드라이브 실체는 scripts/drive_check.mjs 밖이다)
-- delete from public.files where meeting_id is not null;
-- alter table public.files drop constraint if exists files_owner_exactly_one;
-- alter table public.files add constraint files_owner_exactly_one
--   check ((card_id is null) <> (service_id is null));
-- alter table public.files drop column if exists meeting_id;
-- alter table public.group_meetings drop column if exists drive_folder_id;
-- commit;
