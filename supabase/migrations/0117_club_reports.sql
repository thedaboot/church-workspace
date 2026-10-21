-- ============================================================================
-- 0117 — 동아리 활동 보고서 작성 · 지원비 지급 (v5 3묶음 첫 묶음 · 사용자 승인 시안 mock/b4 · 2026-10-21)
-- ----------------------------------------------------------------------------
-- 화면: components/meetingReportForm.jsx(작성 화면 — 지난 모임의 '보고서 작성') · components/clubReportBoard.jsx(모임 > 동아리
-- '보고서 현황' — 마스터 · 총무) · 관리자 메뉴 '연말 보고'(마스터 · 이 파일과 무관 — 있는 표를 읽는다). 앱 쪽은 services/clubReport.js.
--
-- 사용자 결정 2026-10-21:
--   · 보고서의 원본은 **앱 안 작성 화면**이다 — 저장할 때마다 양식(src/assets/club-report-template.xlsx) 그대로 엑셀을 새로 만들어
--     그 모임의 보고서 칸(files · 0093)에 올린다. 그 파일 id를 file_id에 적어 다음 저장 때 갈아 끼운다.
--   · 상태 셋: 미제출(보고서 없음) · 작성 중(저장만) · 제출 완료(submitted_at) — 동아리장이 '제출'을 누른다.
--   · 지원비는 **모임마다** 참석자 × 5,000원 · 지급 체크도 모임마다 · 체크는 **마스터 · 총무만**(set_support_paid 하나).
--
-- 표
--   club_reports(meeting_id PK)  글 칸 넷(활동 내용 · 차기 활동계획 · 지원비 사용내용 · 계좌) · 사진 두 묶음(jsonb [{path,w,h,name}] —
--                                 club-reports 버킷의 경로) · file_id(마지막으로 만든 엑셀) · 저장·제출 때와 사람.
--     읽기 = 그 모임을 고칠 수 있는 사람(can_edit_meeting — 관리자 · 그 동아리장) + 마스터 + 총무(계좌가 있어 구성원에게는 열지 않는다)
--     쓰기 = can_edit_meeting
--   club_support_payments(meeting_id PK)  지급한 때 · 사람. 읽기 = 마스터 · 총무 · 그 모임을 고칠 수 있는 사람 · 쓰기 정책 없음(함수만).
--   storage 'club-reports'(비공개 · 10MB · 사진만) — 경로 `<meeting_id>/<uuid>.jpg`. 올리기·지우기 = can_edit_meeting · 읽기 = + 마스터 · 총무.
-- 함수
--   set_support_paid(meeting, paid)   마스터 · 총무만(42501) — 지급이면 한 줄(멱등), 아니면 지운다.
--   club_report_meeting(name)         storage 경로의 첫 칸을 uuid로(아니면 null) — 정책이 형 변환에서 터지지 않게.
--
-- 순서: 이 마이그레이션 → 코드. 코드가 먼저 나가도 오류 화면은 없다 — services/clubReport.js가 두 표를 '없어도 되는 값'으로 읽는다
-- (작성 내용이 없으면 미제출 · 저장은 실패 토스트). 새 정책은 `to authenticated` · 판정 호출은 `(select …)`(0101·0102).
-- 되돌리기는 파일 맨 아래 주석.
-- ============================================================================

begin;

-- ── 작성 내용 ────────────────────────────────────────────────────────────────
create table if not exists public.club_reports (
  meeting_id   uuid primary key references public.group_meetings(id) on delete cascade,
  activity     text not null default '' check (char_length(activity) <= 4000),
  plan         text not null default '' check (char_length(plan) <= 2000),
  usage        text not null default '' check (char_length(usage) <= 2000),
  account      text not null default '' check (char_length(account) <= 200),
  photos       jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 20),
  receipts     jsonb not null default '[]'::jsonb check (jsonb_typeof(receipts) = 'array' and jsonb_array_length(receipts) <= 20),
  file_id      uuid references public.files(id) on delete set null,
  saved_at     timestamptz,
  saved_by     uuid,
  submitted_at timestamptz,
  submitted_by uuid,
  updated_at   timestamptz not null default now()
);
comment on table public.club_reports is
  '동아리 모임 활동 보고서의 원본(앱 안 작성 화면 · 0117) — 엑셀은 저장할 때마다 이것으로 새로 만든다(file_id)';

alter table public.club_reports enable row level security;
drop policy if exists club_reports_select on public.club_reports;
create policy club_reports_select on public.club_reports for select to authenticated
  using ((select public.is_approved()) and (
    (select public.can_edit_meeting(meeting_id)) or (select public.is_master()) or (select public.has_role('treasurer'))));
drop policy if exists club_reports_write on public.club_reports;
create policy club_reports_write on public.club_reports for all to authenticated
  using ((select public.is_approved()) and (select public.can_edit_meeting(meeting_id)))
  with check ((select public.is_approved()) and (select public.can_edit_meeting(meeting_id)));

-- ── 지원비 지급 ──────────────────────────────────────────────────────────────
create table if not exists public.club_support_payments (
  meeting_id uuid primary key references public.group_meetings(id) on delete cascade,
  paid_at    timestamptz not null default now(),
  paid_by    uuid
);
comment on table public.club_support_payments is
  '동아리 모임 지원비 지급 체크(모임마다 · 0117) — 넣고 지우기는 set_support_paid(마스터 · 총무)만';

alter table public.club_support_payments enable row level security;
drop policy if exists club_support_payments_select on public.club_support_payments;
create policy club_support_payments_select on public.club_support_payments for select to authenticated
  using ((select public.is_approved()) and (
    (select public.is_master()) or (select public.has_role('treasurer')) or (select public.can_edit_meeting(meeting_id))));

create or replace function public.set_support_paid(p_meeting uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_approved() and (public.is_master() or public.has_role('treasurer'))) then
    raise exception '지원비 지급은 마스터와 총무만 체크할 수 있어요' using errcode = '42501';
  end if;
  if p_paid then
    insert into public.club_support_payments (meeting_id, paid_by) values (p_meeting, public.effective_uid())
    on conflict (meeting_id) do nothing;
  else
    delete from public.club_support_payments where meeting_id = p_meeting;
  end if;
end $$;
comment on function public.set_support_paid(uuid, boolean) is '동아리 모임 지원비 지급 체크 — 마스터 · 총무만(42501 · 0117)';
revoke all on function public.set_support_paid(uuid, boolean) from public, anon;
grant execute on function public.set_support_paid(uuid, boolean) to authenticated, service_role;

-- ── 사진 버킷(비공개) ────────────────────────────────────────────────────────
create or replace function public.club_report_meeting(p_name text)
returns uuid language plpgsql immutable set search_path = public, pg_temp as $$
begin
  return (split_part(p_name, '/', 1))::uuid;
exception when others then
  return null;
end $$;
revoke all on function public.club_report_meeting(text) from public, anon;
grant execute on function public.club_report_meeting(text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-reports', 'club-reports', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists club_reports_photos_insert on storage.objects;
create policy club_reports_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'club-reports' and (select public.is_approved())
    and public.can_edit_meeting(public.club_report_meeting(name)));
drop policy if exists club_reports_photos_delete on storage.objects;
create policy club_reports_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'club-reports' and (select public.is_approved())
    and public.can_edit_meeting(public.club_report_meeting(name)));
drop policy if exists club_reports_photos_select on storage.objects;
create policy club_reports_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'club-reports' and (select public.is_approved()) and (
    (select public.is_master()) or (select public.has_role('treasurer'))
    or public.can_edit_meeting(public.club_report_meeting(name))));

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select tablename, policyname, cmd from pg_policies where tablename in ('club_reports', 'club_support_payments');   -- 3줄
--   select policyname from pg_policies where schemaname = 'storage' and policyname like 'club_reports_photos_%';        -- 3줄
--   select id, public, file_size_limit from storage.buckets where id = 'club-reports';                                   -- f, 10485760
--   리허설(begin … rollback): 동아리장 claims로 club_reports upsert 통과 · 다른 동아리 모임은 42501(RLS) ·
--   구성원 claims로 select 0행 · 총무 claims로 set_support_paid → 한 줄 · 구성원 claims로 set_support_paid → 42501
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   begin;
--   drop policy if exists club_reports_photos_insert on storage.objects;
--   drop policy if exists club_reports_photos_delete on storage.objects;
--   drop policy if exists club_reports_photos_select on storage.objects;
--   -- 버킷은 안의 사진을 먼저 지워야 지워진다: delete from storage.objects where bucket_id = 'club-reports'; delete from storage.buckets where id = 'club-reports';
--   drop function if exists public.set_support_paid(uuid, boolean);
--   drop function if exists public.club_report_meeting(text);
--   drop table if exists public.club_support_payments;
--   drop table if exists public.club_reports;
--   commit;
