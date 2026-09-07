-- ============================================================================
-- 0053 — 10차 피드백 묶음의 저장 자리 (2026-09-07)
-- ----------------------------------------------------------------------------
-- 네 가지가 한 파일에 있다. 전부 컬럼 추가·정책 확장이라 되돌리기가 서로 독립적이다.
--
-- ① attendance_guests — 미등록 출석자를 **명단에 올리지 않고** 그 예배의 손님으로만 남긴다.
--    사용자 결정 2026-09-07: "바로 청년 명단에 올리게끔 하지는 말아줘. 청년 명단 등록은
--    마스터가 너한테 얘기할 때만." 예전에는 '미등록 출석자 추가'가 people에 행을 만들고
--    순장이면 자기 순에 넣었다(0050). 그 길은 화면에서 걷고(worshipAttendance), 손님은
--    이 표에 이름만 남긴다. 지울 수도 있어야 하므로 행 단위 표다(jsonb 한 칸에 두면
--    두 사람이 동시에 지우고 추가할 때 마지막 것만 남는다 — HANDOFF §6-27).
--    자격은 출석을 체크할 수 있는 사람(0052와 같은 경계 — 전체 자격자 + 순장) · 발행된 주보.
--
-- ② notifications — v2 알림 종류 다섯 + `link`(앱 안 딥링크).
--    지금까지 알림은 업무(card_id·project_id)로만 갈 수 있었다. 예배·모임 알림은 갈 곳이
--    `/?p=worship&s=<id>` 같은 우리 주소라 그 한 칸을 둔다(외부 주소는 못 넣게 CHECK).
--    · worship_today   — 예배 당일 11:30 KST 배치(api/push.js · 서버만 만든다 → INSERT 정책에 없음)
--    · service_published — 주보 발행(발행한 사람 → 승인 멤버 전원)
--    · note_shared     — 예배 노트를 순에 공유(쓴 사람 → 순장)
--    · club_apply      — 동아리 가입 신청(신청자 → 동아리장)
--    · club_accepted   — 가입 수락(동아리장 → 신청자)
--    · meeting_new     — 동아리 모임 생성(만든 사람 → 그 동아리 구성원)
--    approval·due_soon·worship_today는 서버/트리거만 만든다(0022의 판단 그대로).
--
-- ③ resource_links.view_pw* — 참고 링크에도 첨부(0023)와 같은 **화면 가림용 비밀번호**.
--    구글 문서·시트 링크를 앱 안에서 열어 편집할 수 있게 하면서(DocEmbed) "암호도 기존처럼"
--    (사용자 2026-09-07). 파일 자체를 잠그는 것이 아니다 — 0023 주석과 같은 한계.
--
-- ④ services.cue_sheet — 주보 말씀 구역의 큐시트 링크 한 칸(jsonb: {url, title, view_pw, view_pw_salt}).
--    구글 문서 링크 하나와 그 비밀번호라 컬럼(jsonb)이 맞다(HANDOFF §2-1). 쓰기는 services_write 그대로.
-- ============================================================================

-- ── ① attendance_guests ─────────────────────────────────────────────────────
create table if not exists public.attendance_guests (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references public.services(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists attendance_guests_service on public.attendance_guests (service_id);
alter table public.attendance_guests enable row level security;

create policy attendance_guests_select on public.attendance_guests
  for select using (public.is_approved());
-- 발행된 주보 + 출석을 체크할 수 있는 사람(0052 set_attendance_note와 같은 경계)
create policy attendance_guests_insert on public.attendance_guests
  for insert with check (
    public.is_approved()
    and (public.can_check_all_attendance() or public.leads_any_sun())
    and exists (select 1 from public.services s where s.id = service_id and s.status = 'published')
  );
create policy attendance_guests_delete on public.attendance_guests
  for delete using (
    public.is_approved()
    and (public.can_check_all_attendance() or public.leads_any_sun())
  );
comment on table public.attendance_guests is
  '예배의 미등록 출석자(손님). 명단(people)에 올리지 않는다 — 명단 등록은 마스터가 따로(0053)';

-- ── ② notifications: v2 종류 + link ─────────────────────────────────────────
alter table public.notifications add column if not exists link text;
alter table public.notifications drop constraint if exists notifications_link_check;
alter table public.notifications add constraint notifications_link_check
  check (link is null or (link like '/%' and link not like '//%' and char_length(link) <= 300));

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction',
                  'worship_today', 'service_published', 'note_shared',
                  'club_apply', 'club_accepted', 'meeting_new'));

drop policy if exists "notifications_insert_authenticated" on public.notifications;
create policy "notifications_insert_authenticated"
  on public.notifications for insert to authenticated
  with check (
    public.is_approved()
    and kind in ('mention', 'reply', 'assign', 'reaction',
                 'service_published', 'note_shared', 'club_apply', 'club_accepted', 'meeting_new')
    and (preview is null or char_length(preview) <= 200)
    and char_length(actor_name) <= 100
  );

-- ── ③ resource_links 비밀번호(0023과 같은 세 칸) ────────────────────────────
alter table public.resource_links add column if not exists view_pw text;
alter table public.resource_links add column if not exists view_pw_salt text;
alter table public.resource_links add column if not exists view_pw_by uuid references auth.users(id) on delete set null;
comment on column public.resource_links.view_pw is
  '화면 가림용 비밀번호 해시(sha-256(salt+pw), 앱에서 계산). 링크 자체를 잠그지 않는다 — 0023과 같은 한계';

-- ── ④ services.cue_sheet ────────────────────────────────────────────────────
alter table public.services add column if not exists cue_sheet jsonb;
comment on column public.services.cue_sheet is
  '큐시트 링크 한 칸 {url, title, view_pw, view_pw_salt}. 구글 문서 링크를 앱 안(DocEmbed)에서 연다(0053)';

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid='public.notifications'::regclass and conname in ('notifications_kind_check','notifications_link_check');
--   select policyname, cmd from pg_policies where tablename in ('attendance_guests','notifications') order by 1;
--   select column_name from information_schema.columns where table_name='resource_links' and column_name like 'view_pw%';
--   select column_name from information_schema.columns where table_name='services' and column_name='cue_sheet';

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop table if exists public.attendance_guests;
--   alter table public.notifications drop column if exists link;
--   alter table public.notifications drop constraint if exists notifications_kind_check;
--   alter table public.notifications add constraint notifications_kind_check
--     check (kind in ('mention','reply','assign','due_soon','approval','reaction'));
--   drop policy if exists "notifications_insert_authenticated" on public.notifications;
--   create policy "notifications_insert_authenticated" on public.notifications for insert to authenticated
--     with check (kind in ('mention','reply','assign','reaction') and (preview is null or char_length(preview) <= 200) and char_length(actor_name) <= 100);
--   alter table public.resource_links drop column if exists view_pw, drop column if exists view_pw_salt, drop column if exists view_pw_by;
--   alter table public.services drop column if exists cue_sheet;
