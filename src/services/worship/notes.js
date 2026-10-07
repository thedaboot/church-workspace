// ============================================================================
// 예배 — 내 예배 노트(service_notes · 0036) 읽기·쓰기·공유 바꾸기
// ----------------------------------------------------------------------------
// 남의 노트는 모임 화면 소관이다(groups.js). 합친 계정이면 남긴 계정의 id로 읽고 쓴다(myUid · 0061).
// ============================================================================
import { supabase, myUid } from '../supabaseClient.js';
import { guestStore } from '../people.js';
import { unwrap } from '../cloud/core.js';

const { rows: guestRows, set: guestSet } = guestStore('church_worship_v1');

// ── 내 예배 노트 ────────────────────────────────────────────────────────────
// 예배당 한 건(unique). 기본은 나만 보고, '내 순에 공유'를 켜면 올해 같은 순만 본다.
// 남의 노트는 이 화면에 오지 않는다 — 모임 화면 소관이다(결정 7).

// **합친 계정이면 남긴 계정의 id다**(0061 · supabaseClient) — 그 계정으로 들어와도
// 노트가 갈리지 않는다. 예전에는 여기 자기 uid를 쓰는 한 벌이 따로 있었다.

export async function fetchMyNote(serviceId) {
  if (!supabase) return guestRows('service_notes').find(n => n.service_id === serviceId) || null;
  const uid = await myUid();
  if (!uid) return null;
  return unwrap(await supabase.from('service_notes')
    .select('id, body, shared_to_sun').eq('service_id', serviceId).eq('profile_id', uid).maybeSingle()) ?? null;
}

// 내 예배 노트 전부 — 예배 화면의 '내 예배 노트' 모아 보기(2026-09-25).
// **profile_id로 반드시 거른다.** service_notes의 읽기 정책(0036·0061)은 `내 것 OR (같은 순에
// 공유된 것)`이라, 거르지 않으면 순원이 공유한 노트까지 '내 노트'로 섞여 온다. 쓰기는 내 것만이다.
// 합친 계정이면 남긴 계정의 id다(myUid · effective_uid와 같은 규칙).
// 빈 노트·템플릿만 남은 노트를 거르고 주보와 잇는 것은 serviceView.myNoteRows(순수)의 몫이다.
export async function fetchMyNotes() {
  if (!supabase) return guestRows('service_notes').map(n => ({ ...n }));
  const uid = await myUid();
  if (!uid) return [];
  return unwrap(await supabase.from('service_notes')
    .select('id, service_id, body, shared_to_sun, updated_at').eq('profile_id', uid)) ?? [];
}

export async function saveMyNote(serviceId, { body = '', sharedToSun = false }) {
  if (!supabase) {
    const rows = guestRows('service_notes').filter(n => n.service_id !== serviceId);
    const made = { service_id: serviceId, body, shared_to_sun: sharedToSun };
    guestSet('service_notes', [...rows, made]);
    return made;
  }
  const uid = await myUid();
  if (!uid) return null;
  return unwrap(await supabase.from('service_notes')
    .upsert({ service_id: serviceId, profile_id: uid, body, shared_to_sun: sharedToSun, updated_at: new Date().toISOString() },
      { onConflict: 'service_id,profile_id' })
    .select('id, body, shared_to_sun').single());
}

// 공유 상태만 바꾼다 — **글은 건드리지 않는다.**
//   setNoteShared(serviceId, shared) → 갱신된 행 { id?, body, shared_to_sun } | null
// 노트가 없으면 아무것도 만들지 않고 null을 준다(공유할 글이 없으니 뜻이 없다).
// 이 함수는 예배 화면의 노트 구역과 **모임 화면의 '공유된 노트' 목록이 같이 쓴다** —
// 그쪽에서 내 비공개 노트를 그 자리에서 공유로 바꿀 때도 이 한 벌을 부르면 된다.
// RLS(0036 service_notes_write)가 profile_id = auth.uid()로 자기 것만 허용한다.
export async function setNoteShared(serviceId, shared) {
  const cur = await fetchMyNote(serviceId);
  if (!cur) return null;
  return saveMyNote(serviceId, { body: cur.body || '', sharedToSun: !!shared });
}
