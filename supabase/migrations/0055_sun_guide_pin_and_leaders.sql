-- ============================================================================
-- 0055 — 순모임 가이드를 켜면서 (2026-09-08 사용자 결정): 순장도 만들고 · 마스터가 고정
-- ----------------------------------------------------------------------------
-- 사용자: "어떤 주보를 기준으로 만들건지 마스터 or 관리자 or 리더 순장 or 순장들이
-- 선택하게 하고 … 만들어지면 마스터는 그 요약 고정 기능처럼 고정을 할 수 있게 해서,
-- 해당 가이드만 볼 수 있게끔(캐싱 구조)."
--
-- 두 가지가 바뀐다.
--
-- (A) **만드는 사람이 순장까지 넓어진다.** 0039는 쓰기를 can_manage_sun()(마스터·관리자·
--     리더순장)에만 열어서, 정작 가이드를 들고 모임을 진행하는 순장은 읽기만 됐다.
--     읽기(0039 sun_guides_select)는 이미 `leads_any_sun() or can_manage_sun()`이라
--     쓰기를 그 경계에 맞춘다 — 보는 사람 = 만드는 사람이다.
--
-- (B) **고정은 마스터만.** 3줄 요약의 '고정'과 같은 뜻이다(HANDOFF §4.4 —
--     `canPin = isMaster`): AI는 돈이 들고 워크스페이스 전체에 남는 글을 만들어서,
--     "모두가 이걸 본다"는 결정은 관리자를 늘리는 것과 별개라는 사용자 판단이다.
--     고정된 가이드는 화면이 기본으로 여는 한 벌이고, **그 행은 마스터 말고는 못 고친다** —
--     아니면 순장 한 사람이 다시 만들기를 눌러 모두가 보는 글을 갈아 끼울 수 있다.
--
-- **왜 정책만으로는 부족한가.** '고정은 한 번에 하나'는 행 하나를 보는 RLS로는 말할 수
-- 없다(다른 행을 같이 꺼야 한다). 그래서 0052 set_attendance_note()와 같은 길이다:
-- 자격과 불변식을 함수 하나가 들고 있고, 화면은 그 함수만 부른다. 표에는 부분 유니크
-- 인덱스를 하나 더 얹어 **함수를 우회해도 두 개가 고정되지 않게** 못을 박는다.
--
-- 되돌리기는 파일 맨 아래.
-- ============================================================================

-- ── (A) 칸 세 개 ────────────────────────────────────────────────────────────
-- pinned_by는 DB에만 남는다 — 화면에는 **고정한 사람 이름을 붙이지 않는다**(§4.4의
-- ai_summary_by와 같은 판단: 이름이 붙으면 글보다 누가 손댔는지를 먼저 보게 된다).
alter table public.sun_guides
  add column if not exists pinned    boolean not null default false,
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references public.profiles(id);

-- 고정은 한 번에 하나. 부분 인덱스라 pinned = false인 행들은 색인에 들어가지 않는다.
create unique index if not exists sun_guides_one_pinned
  on public.sun_guides (pinned) where pinned;

-- ── (B) 쓰기 정책 — 순장까지, 다만 고정된 행은 마스터만 ─────────────────────
-- `is_approved()`는 0051이 넣은 승인 게이트다(빼면 미승인 계정이 다시 들어온다).
-- 마지막 줄이 두 가지를 한꺼번에 막는다:
--   · USING  (옛 행)   — 고정된 행을 마스터 아닌 사람이 update/delete 하지 못한다.
--   · CHECK  (새 행)   — 마스터 아닌 사람이 pinned = true인 행을 써 넣지 못한다.
--                        (즉 update … set pinned = true 로 스스로 고정할 수 없다)
-- 이 정책은 FOR ALL이라 SELECT에도 걸리는데, 조건이 sun_guides_select보다 **좁아서**
-- permissive OR로 읽기가 넓어지지 않는다(§6-31-a에서 두 번 물린 자리다) — 순장은
-- 고정된 가이드를 select 정책으로 그대로 읽는다.
drop policy if exists sun_guides_write on public.sun_guides;
create policy sun_guides_write on public.sun_guides
  for all using (
    public.is_approved()
    and (public.can_manage_sun() or public.leads_any_sun())
    and (not pinned or public.is_master())
  ) with check (
    public.is_approved()
    and (public.can_manage_sun() or public.leads_any_sun())
    and (not pinned or public.is_master())
  );

-- ── (C) 고정 스위치 ─────────────────────────────────────────────────────────
-- security definer라 위 정책을 우회한다. 그래서 **고정 세 칸만** 만지고, 자격을 통과하지
-- 못하면 42501로 던진다(화면이 이미 그 코드를 사람 말로 바꾼다 — services/errorText.js).
-- 켤 때는 다른 행을 **먼저** 끈다 — 순서를 바꾸면 위의 유니크 인덱스에 걸린다.
create or replace function public.set_sun_guide_pinned(p_service_id uuid, p_on boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_approved() then
    raise exception '승인된 멤버만 순모임 가이드를 고정할 수 있습니다' using errcode = '42501';
  end if;
  if not public.is_master() then
    raise exception '순모임 가이드 고정은 마스터만 할 수 있습니다' using errcode = '42501';
  end if;

  if p_on then
    update public.sun_guides
       set pinned = false, pinned_at = null, pinned_by = null
     where pinned and service_id <> p_service_id;

    update public.sun_guides
       set pinned = true, pinned_at = now(), pinned_by = auth.uid()
     where service_id = p_service_id;
  else
    update public.sun_guides
       set pinned = false, pinned_at = null, pinned_by = null
     where service_id = p_service_id;
  end if;

  if not found then
    -- 그 주보의 가이드가 없거나 지워졌다. 화면은 이 코드를 '이미 지워졌어요'로 읽는다.
    raise exception '순모임 가이드를 찾지 못했습니다' using errcode = 'P0002';
  end if;

  return p_on;
end;
$$;

comment on function public.set_sun_guide_pinned(uuid, boolean) is
  '순모임 가이드 고정 스위치 — 마스터만. 켜면 다른 행의 고정을 먼저 끈다(고정은 한 번에 하나, 0055)';

-- EXECUTE 기본값은 PUBLIC이다(0048·0052와 같은 마무리)
revoke execute on function public.set_sun_guide_pinned(uuid, boolean) from public;
revoke execute on function public.set_sun_guide_pinned(uuid, boolean) from anon;
grant  execute on function public.set_sun_guide_pinned(uuid, boolean) to authenticated;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select policyname, cmd, qual, with_check from pg_policies where tablename='sun_guides';
--   \df public.set_sun_guide_pinned
--   select indexdef from pg_indexes where tablename='sun_guides';
--
--   -- 순장 계정으로(0022 방식 — 트랜잭션 + rollback):
--   --   begin; set local role authenticated;
--   --   select set_config('request.jwt.claims','{"sub":"<순장 uuid>"}', true);
--   --   insert into sun_guides(service_id, body) values ('<주보 uuid>','{"a":1}');   -- 통과(A)
--   --   select public.set_sun_guide_pinned('<주보 uuid>', true);                     -- 42501(B)
--   --   rollback;
--   -- 마스터로 고정한 뒤 다시 순장으로:
--   --   update sun_guides set body = '{"b":2}' where service_id = '<고정된 주보>';   -- 0행(USING)
--   --   update sun_guides set pinned = true where service_id = '<다른 주보>';        -- 42501(CHECK)

-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop function if exists public.set_sun_guide_pinned(uuid, boolean);
--   drop index if exists public.sun_guides_one_pinned;
--   alter table public.sun_guides drop column if exists pinned,
--     drop column if exists pinned_at, drop column if exists pinned_by;
--   drop policy if exists sun_guides_write on public.sun_guides;
--   create policy sun_guides_write on public.sun_guides
--     for all using (public.is_approved() and public.can_manage_sun())
--     with check (public.is_approved() and public.can_manage_sun());       -- 0051의 모양
