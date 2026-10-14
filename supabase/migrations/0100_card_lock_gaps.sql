-- ============================================================================
-- 0100 — 업무 잠금(0099)의 남은 틈 셋 (2026-10-14 · 20차 묶음 ⑪)
-- ----------------------------------------------------------------------------
-- ① 하위 업무 — 0099는 cards.subtasks를 그대로 두어 API로 읽혔다(화면만 판으로 가림). 본문처럼 card_secrets로 옮긴다.
--    card_secrets.subtasks 칸 · lock_card가 옮기고 cards 쪽은 '[]' · unlock_owner가 되돌린다 · 거울 트리거가 subtasks 쓰기도
--    card_secrets로 돌린다(여는 사람만 · 못 여는 사람의 글은 버려진다). 앱은 card_secrets 행의 subtasks를 얹는다(cardLock.withSecret).
-- ② 위키 원본 행 — 잠그는 순간 그 업무를 가리키는 블록을 wiki_pages.blocks에서 걷고, 그 장의 뜻 찾기 조각(doc_vec 위키)을 지운다.
--    다음 아침 빌드도 잠긴 업무를 빼므로(gather.dropLocked) 같은 결과를 앞당길 뿐이다. 풀면 다음 빌드에 돌아온다.
--    블록 판정은 업무 id 글자가 블록 JSON에 있나(wikiCore.blockCardIds와 같은 뜻 — uuid라 겹칠 일이 없다).
-- ③ 알림 미리보기 — 잠긴 업무의 알림(notifications.preview)은 비워 넣는다(트리거) · 잠그는 순간 있던 미리보기도 비운다.
--    푸시 본문은 이미 서버가 비운다(api/push.js pushPreview · 20차 ⑩).
-- 정책은 늘리지 않는다(§6-31-a) — card_secrets 칸 권한에 subtasks만 더한다.
-- ============================================================================
begin;

alter table public.card_secrets add column if not exists subtasks jsonb not null default '[]'::jsonb;
grant select (subtasks) on public.card_secrets to authenticated;
grant update (subtasks) on public.card_secrets to authenticated;

-- 이미 잠긴 업무(0099 때 잠근 것)의 하위 업무를 옮긴다
update public.card_secrets s set subtasks = c.subtasks
  from public.cards c where c.id = s.card_id and c.locked and c.subtasks <> '[]'::jsonb;
update public.cards set subtasks = '[]'::jsonb where locked and subtasks <> '[]'::jsonb;

-- 잠그는 순간 위키·알림에서 그 업무를 걷는다(② ③) — lock_card 안에서만 부른다
create or replace function public.scrub_locked_card(c uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pages text[];
begin
  -- ponytail: 블록 JSON에서 업무 id 글자를 찾는다 — 걷은 장은 다음 아침 빌드가 다시 쓴다
  select array_agg(id) into pages from public.wiki_pages where position(c::text in blocks::text) > 0;
  if pages is not null then
    update public.wiki_pages p
       set blocks = (select coalesce(jsonb_agg(b order by o), '[]'::jsonb)
                       from jsonb_array_elements(p.blocks) with ordinality t(b, o)
                      where position(c::text in b::text) = 0)
     where p.id = any (pages);
    delete from public.doc_vec where page_id = any (pages);
  end if;
  update public.notifications set preview = null where card_id = c and preview is not null;
end $$;
revoke all on function public.scrub_locked_card(uuid) from public, anon, authenticated;

create or replace function public.lock_card(c uuid, pw text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k    record;
  salt text := gen_random_uuid()::text;
  h    text;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  if coalesce(pw, '') = '' then raise exception 'empty password' using errcode = '22023'; end if;
  select id, created_by, locked, description, ai_summary, subtasks into k from public.cards where id = c for update;
  if not found then raise exception 'no card' using errcode = 'P0002'; end if;
  if not coalesce(k.created_by = any (array[auth.uid(), public.effective_uid()]), false) then
    raise exception 'not the author' using errcode = '42501';
  end if;
  if not public.can_see_card(c) then raise exception 'not visible' using errcode = '42501'; end if;
  h := encode(sha256(convert_to(salt || pw, 'UTF8')), 'hex');
  if k.locked then
    -- 다시 설정 — 본문 거울은 그대로, 비밀번호만
    insert into public.card_secrets (card_id, description, ai_summary, lock_hash, lock_salt)
    values (c, '', null, h, salt)
    on conflict (card_id) do update set lock_hash = excluded.lock_hash, lock_salt = excluded.lock_salt, updated_at = now();
  else
    insert into public.card_secrets (card_id, description, ai_summary, subtasks, lock_hash, lock_salt)
    values (c, coalesce(k.description, ''), k.ai_summary, coalesce(k.subtasks, '[]'::jsonb), h, salt)
    on conflict (card_id) do update set description = excluded.description, ai_summary = excluded.ai_summary,
      subtasks = excluded.subtasks, lock_hash = excluded.lock_hash, lock_salt = excluded.lock_salt, updated_at = now();
    update public.cards
       set locked = true, locked_by = public.effective_uid(), locked_at = now(), description = '', ai_summary = null,
           subtasks = '[]'::jsonb
     where id = c;
    perform public.scrub_locked_card(c);
  end if;
  delete from public.card_unlocks where card_id = c;
  delete from public.card_unlock_tries where card_id = c;
  return true;
end $$;

create or replace function public.unlock_owner(c uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k    record;
  d    text;
  s    text;
  st   jsonb;
  have boolean;
begin
  if not public.is_approved() then raise exception 'not approved' using errcode = '42501'; end if;
  select id, created_by, locked into k from public.cards where id = c for update;
  if not found then raise exception 'no card' using errcode = 'P0002'; end if;
  if not (coalesce(k.created_by = any (array[auth.uid(), public.effective_uid()]), false) or public.is_master()) then
    raise exception 'not the author' using errcode = '42501';
  end if;
  if not k.locked then return true; end if;
  select description, ai_summary, subtasks, true into d, s, st, have from public.card_secrets where card_id = c;
  if coalesce(have, false) then
    update public.cards set locked = false, locked_by = null, locked_at = null, description = d, ai_summary = s,
                            subtasks = coalesce(st, '[]'::jsonb) where id = c;
  else
    update public.cards set locked = false, locked_by = null, locked_at = null where id = c;
  end if;
  delete from public.card_secrets where card_id = c;
  delete from public.card_unlocks where card_id = c;
  delete from public.card_unlock_tries where card_id = c;
  return true;
end $$;

create or replace function public.mirror_locked_card() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if not new.locked or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.description is distinct from old.description or new.ai_summary is distinct from old.ai_summary
     or new.subtasks is distinct from old.subtasks then
    if public.can_open_card(new.id) then
      update public.card_secrets
         set description = case when new.description is distinct from old.description then coalesce(new.description, '') else description end,
             ai_summary  = case when new.ai_summary is distinct from old.ai_summary then new.ai_summary else ai_summary end,
             subtasks    = case when new.subtasks is distinct from old.subtasks then coalesce(new.subtasks, '[]'::jsonb) else subtasks end,
             updated_at  = now()
       where card_id = new.id;
    end if;
    new.description := old.description;
    new.ai_summary := old.ai_summary;
    new.subtasks := old.subtasks;
  end if;
  return new;
end $$;

comment on function public.mirror_locked_card() is
  '잠긴 업무의 본문·요약·하위 업무 쓰기를 card_secrets로 돌린다(여는 사람만) — cards 쪽은 비운 채로(0099 · 0100)';

drop trigger if exists trg_cards_lock_mirror on public.cards;
create trigger trg_cards_lock_mirror before update of description, ai_summary, subtasks on public.cards
  for each row execute function public.mirror_locked_card();

-- ③ 잠긴 업무의 새 알림은 미리보기 없이
create or replace function public.blank_locked_preview() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.card_id is not null and new.preview is not null
     and exists (select 1 from public.cards k where k.id = new.card_id and k.locked) then
    new.preview := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_notifications_locked_preview on public.notifications;
create trigger trg_notifications_locked_preview before insert or update of preview, card_id on public.notifications
  for each row execute function public.blank_locked_preview();

commit;

-- 되돌리기:
--   update public.cards c set subtasks = s.subtasks from public.card_secrets s where s.card_id = c.id;
--   drop trigger trg_notifications_locked_preview on public.notifications; drop function public.blank_locked_preview();
--   0099의 lock_card · unlock_owner · mirror_locked_card · trg_cards_lock_mirror를 다시 실행 · drop function public.scrub_locked_card(uuid);
--   alter table public.card_secrets drop column subtasks;
