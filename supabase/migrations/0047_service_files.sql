-- ============================================================================
-- 0047 — 주보에 송폼(파일) 붙이기 (2026-09-05 사용자 결정 · 검토 결론은 HANDOFF §1.3)
-- ----------------------------------------------------------------------------
-- 찬양 콘티의 송폼 PDF를 주보에 붙인다. **표를 새로 만들지 않는다** — 첨부는 이미
-- files 한 벌이 있고, 드라이브로 나르는 길(멱등 열쇠·3MB 갈래·타임아웃 뒤 확인)도
-- 한 벌이다. 그것을 두 벌로 두면 고칠 때마다 한쪽만 고쳐진다(§6-29의 되풀이).
-- 그래서 바뀌는 것은 **축 하나**다: files 행의 주인이 카드냐 주보냐.
--
--   · files.service_id — nullable. card_id와 **배타**다(둘 중 정확히 하나).
--   · services.drive_folder_id — 0026이 cards에 한 것과 같은 자리. 드라이브는
--     `더다붓 워크스페이스/예배/<YYYY-MM-DD>/`이고 id를 적어 두 번째부터 재사용한다.
--     Apps Script는 고칠 것이 없다 — folderFor가 path 배열로 멱등하게 판다(v7).
--   · files RLS 넷을 **갈래로 가른다.** 지금은 승인 멤버 전원이 files를 읽고 쓴다
--     (업무 첨부는 그게 맞다 — 워크스페이스는 다 같이 본다). 그대로 두면 **작성 중인
--     주보에 붙인 송폼이 아무에게나 보이고**, 주보를 못 쓰는 사람도 붙이고 지울 수
--     있다. 주보 갈래만 services의 경계(can_edit_service / status='published')를
--     그대로 물려받게 한다.
--
-- ── card_id의 on delete를 set null → cascade로 바꾼다 ────────────────────────
-- **배타 CHECK 때문에 반드시 같이 가야 하는 변경이다.** 0001의 files_card_id_fkey가
-- `on delete set null`이라, 업무를 지우면 그 첨부 행의 card_id가 null이 되는데
-- service_id도 null이므로 새 CHECK에 걸린다 → **업무 삭제 자체가 23514로 죽는다**
-- (cloud.deleteCard는 카드를 먼저 지우고 파일 행을 그 뒤에 지운다 — 그 사이가 딱
-- 이 순간이다). cascade면 그 상태가 아예 생기지 않는다.
-- 잃는 것도 없다: `set null`이 만들던 "주인 없는 파일 행 + 드라이브에 남은 실체"가
-- 정확히 §6-29-d가 유실이라고 부른 그 상태이고, 앱은 지금도 카드를 지우기 **전에**
-- 파일 목록을 읽어 두었다가 드라이브를 휴지통으로 보낸다(deleteCard·deleteProject
-- 둘 다). 행이 먼저 사라져도 그 정리는 그대로 돈다.
--
-- 적용 전 확인(238건 전부 card_id가 있다 → 배타 CHECK를 그대로 통과한다):
--   select count(*) filter (where card_id is null) from public.files;   -- 0
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

-- ── 1. files에 주보 축 ──────────────────────────────────────────────────────
alter table public.files
  add column if not exists service_id uuid references public.services(id) on delete cascade;

comment on column public.files.service_id is
  '이 파일이 붙은 주보(0047 · 송폼). card_id와 배타 — 둘 중 정확히 하나가 채워진다';

create index if not exists idx_files_service_id on public.files(service_id);

-- ── 2. card_id는 cascade로 (위 머리말의 이유 — 배타 CHECK와 한 몸이다) ──────
alter table public.files drop constraint if exists files_card_id_fkey;
alter table public.files add constraint files_card_id_fkey
  foreign key (card_id) references public.cards(id) on delete cascade;

-- ── 3. 배타 CHECK ───────────────────────────────────────────────────────────
-- 업무 첨부이거나 주보 송폼이거나, 둘 중 하나다. "둘 다"도 "둘 다 아님"도 막는다 —
-- 둘 다 아닌 행은 어느 화면에도 안 나오면서 드라이브에는 실체가 남는 유령이다.
alter table public.files drop constraint if exists files_owner_exactly_one;
alter table public.files add constraint files_owner_exactly_one
  check ((card_id is null) <> (service_id is null));

-- ── 4. services.drive_folder_id (0026의 cards와 같은 자리) ──────────────────
alter table public.services add column if not exists drive_folder_id text;

comment on column public.services.drive_folder_id is
  '드라이브의 이 주보 폴더(예배/<YYYY-MM-DD>). 첫 송폼 업로드 때 채워지고 그 뒤로 재사용된다';

-- ── 5. files RLS 넷을 갈래로 가른다 ─────────────────────────────────────────
-- 업무 갈래(service_id is null)는 **지금 식 그대로**다. 주보 갈래만 services의
-- 경계를 물려받는다. 정책은 permissive 한 벌이라 갈래를 or로 잇지 않고 and로
-- 감싼다 — 새 정책을 따로 더하면 업무 갈래의 넓은 조건이 주보 갈래까지 열어 준다.

drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (
    public.is_approved() and auth.role() = 'authenticated'
    and (
      files.service_id is null
      or exists (
        select 1 from public.services s
        where s.id = files.service_id
          and (s.status = 'published' or public.can_edit_service())
      )
    )
  );

drop policy if exists files_insert on public.files;
create policy files_insert on public.files
  for insert with check (
    public.is_approved() and auth.role() = 'authenticated'
    and (files.service_id is null or public.can_edit_service())
  );

-- update는 **양쪽을 다 본다.** using만 걸면 업무 첨부(누구나 쓴다)를 골라
-- service_id를 남의 주보로 옮겨 붙일 수 있다.
drop policy if exists files_update on public.files;
create policy files_update on public.files
  for update using (
    public.is_approved() and auth.role() = 'authenticated'
    and (files.service_id is null or public.can_edit_service())
  ) with check (
    public.is_approved() and auth.role() = 'authenticated'
    and (files.service_id is null or public.can_edit_service())
  );

-- 업무 첨부는 올린 사람·관리자, 송폼은 주보를 쓰는 사람.
drop policy if exists files_delete on public.files;
create policy files_delete on public.files
  for delete using (
    public.is_approved()
    and (
      case when files.service_id is null
        then (files.uploaded_by = auth.uid() or public.is_admin())
        else public.can_edit_service()
      end
    )
  );

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   \d public.files
--   \d public.services
--   select policyname, cmd, qual, with_check from pg_policies
--    where schemaname='public' and tablename='files' order by policyname;
--
--   -- 배타 CHECK가 실제로 막는가(트랜잭션 + rollback — 0022·0045와 같은 방식):
--   begin;
--     insert into public.files (name) values ('둘 다 없음');            -- 23514
--   rollback;
--
--   -- 업무를 지워도 23514가 나지 않는가(cascade가 도는가):
--   begin;
--     delete from public.cards where id = '<아무 카드 id>';             -- 통과해야 한다
--   rollback;
--
--   -- 작성 중 주보의 송폼은 못 읽는가(일반 멤버로):
--   begin; set local role authenticated;
--     select set_config('request.jwt.claims', '{"sub":"<일반 멤버 uuid>","email":"x@y.z"}', true);
--     select count(*) from public.files where service_id is not null;   -- 발행본 것만
--   rollback;

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
-- begin;
-- drop policy if exists files_select on public.files;
-- create policy files_select on public.files
--   for select using (public.is_approved() and auth.role() = 'authenticated');
-- drop policy if exists files_insert on public.files;
-- create policy files_insert on public.files
--   for insert with check (public.is_approved() and auth.role() = 'authenticated');
-- drop policy if exists files_update on public.files;
-- create policy files_update on public.files
--   for update using (public.is_approved() and auth.role() = 'authenticated')
--            with check (public.is_approved() and auth.role() = 'authenticated');
-- drop policy if exists files_delete on public.files;
-- create policy files_delete on public.files
--   for delete using (public.is_approved() and (uploaded_by = auth.uid() or public.is_admin()));
-- alter table public.files drop constraint if exists files_owner_exactly_one;
-- alter table public.files drop constraint if exists files_card_id_fkey;
-- alter table public.files add constraint files_card_id_fkey
--   foreign key (card_id) references public.cards(id) on delete set null;
-- -- (송폼 행이 남아 있으면 먼저 지워야 한다 — card_id가 null인 행이 되기 때문)
-- alter table public.files drop column if exists service_id;
-- alter table public.services drop column if exists drive_folder_id;
-- commit;
