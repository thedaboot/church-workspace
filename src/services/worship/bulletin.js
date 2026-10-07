// ============================================================================
// 예배 — 주보 읽기·쓰기·발행 · 알림 두 가지(발행 · 노트 공유 · 0053)
// ----------------------------------------------------------------------------
// 게스트 모드(supabase 없음)는 localStorage 'church_worship_v1'이 클라우드 자리를 대신한다(worship.js 머리말).
// ============================================================================
import { supabase } from '../supabaseClient.js';
import { fetchGroups, fetchGroupMembers, fetchMyPerson, guestStore } from '../people.js';
import { insertNotifications, getMyProfile } from '../cloud.js';
import { unwrap } from '../cloud/core.js';
import { SUNDAY_KIND, kindLabel } from '../serviceView.js';
import { generateId } from '../../utils.js';
import { COLS, formatServiceDate, serviceYear, noteSharedLink } from './pure.js';

const { rows: guestRows, set: guestSet } = guestStore('church_worship_v1');

// 작성 중(draft)은 편집 자격자에게만 온다 — 화면이 아니라 RLS가 거른다(0036).
export async function fetchServices({ columns = COLS } = {}) {
  if (!supabase) return [...guestRows('services')].sort((a, b) => String(b.service_date).localeCompare(String(a.service_date)));
  return unwrap(await supabase.from('services').select(columns).order('service_date', { ascending: false })) ?? [];
}

export async function createService({ kind = SUNDAY_KIND, serviceDate }) {
  const row = { kind: (kind || SUNDAY_KIND).trim() || SUNDAY_KIND, service_date: serviceDate, status: 'draft' };
  if (!supabase) {
    const made = { id: generateId(), roles: [], songs: [], notices: [], title: '', passage_ref: '', preacher: '', praise_leader: '', praise_playlist_url: '', attendance_note: '', created_at: new Date().toISOString(), ...row };
    guestSet('services', [...guestRows('services'), made]);
    return made;
  }
  return unwrap(await supabase.from('services').insert(row).select(COLS).single());
}

export async function saveService(id, patch) {
  if (!supabase) {
    const rows = guestRows('services').map(s => (s.id === id ? { ...s, ...patch } : s));
    guestSet('services', rows);
    return rows.find(s => s.id === id);
  }
  return unwrap(await supabase.from('services')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select(COLS).single());
}

export const publishService = (id) => saveService(id, { status: 'published' });

// ── 알림 (0053) ─────────────────────────────────────────────────────────────
// 두 알림 다 **본 흐름을 막지 않는다** — 실패는 삼키고 콘솔에만 남긴다. 주보가 발행됐는데
// "발행하지 못했어요"라고 말하면 사람이 다시 누르고, 그러면 알림이 두 번 간다.
// 받는 사람 목록은 앱이 만들고 본인 제외는 cloud.insertNotifications가 한다(§6-29).

// 승인된 멤버 전원의 profile id. `approved` 컬럼이 원본이고 환송한 사람은 `removed_at`이
// 찍혀 있다(cloud.listMembersAdmin의 select와 같은 모양 · 0022).
async function approvedProfileIds() {
  if (!supabase) return [];
  const data = unwrap(await supabase.from('profiles')
    .select('id').eq('approved', true).is('removed_at', null));
  return (data ?? []).map(r => r.id);
}

// 발행 순간 — 승인 멤버 전원에게. 딥링크는 그 주보 상세다(entryQuery의 약속 `?p=worship&s=`).
export async function notifyServicePublished(service) {
  if (!supabase || !service?.id) return 0;
  try {
    const [ids, me] = await Promise.all([approvedProfileIds(), getMyProfile()]);
    if (!ids.length) return 0;
    return await insertNotifications(ids, {
      kind: 'service_published',
      actorName: me?.display_name || '누군가',
      preview: service.title || kindLabel(service.kind),
      link: `/?p=worship&s=${service.id}`,
    });
  } catch (e) {
    console.error('[worship] 주보 발행 알림 실패:', e);
    return 0;
  }
}

// 노트를 순에 공유로 **바꾸는 순간** — 그 해 내 순의 순장 한 사람에게. 이미 공유 상태에서
// 다시 저장하는 것은 알림이 아니다(부르는 쪽이 false→true일 때만 부른다).
// 내가 그 순의 순장이면 알릴 사람이 없다. 링크 모양은 pure.noteSharedLink 머리말.
// 서로 기대지 않는 셋(내 명단 행 · 그 해 순 · 내 프로필)은 한 번에 묻고, 순장은 그 한 사람만 묻는다
// (명단 전체를 읽지 않는다 · 명단 목록과 같은 조건 — 내보낸 사람은 뺀다).
export async function notifyNoteShared(service) {
  if (!supabase || !service?.id) return 0;
  try {
    const [me, groups, profile] = await Promise.all([
      fetchMyPerson(), fetchGroups('sun', serviceYear(service.service_date)), getMyProfile(),
    ]);
    if (!me?.id || !groups.length) return 0;
    const members = await fetchGroupMembers(groups.map(g => g.id));
    const mine = groups.find(g => g.leader_person_id === me.id)
      || groups.find(g => members.some(m => m.group_id === g.id && m.person_id === me.id));
    if (!mine?.leader_person_id || mine.leader_person_id === me.id) return 0;
    const leader = unwrap(await supabase.from('people').select('profile_id')
      .eq('id', mine.leader_person_id).is('removed_at', null).maybeSingle());
    if (!leader?.profile_id) return 0;              // 순장이 아직 가입 전이면 받을 계정이 없다
    return await insertNotifications([leader.profile_id], {
      kind: 'note_shared',
      actorName: profile?.display_name || me.name || '누군가',
      preview: formatServiceDate(service.service_date),
      link: noteSharedLink(service.id),
    });
  } catch (e) {
    console.error('[worship] 노트 공유 알림 실패:', e);
    return 0;
  }
}

export async function removeService(id) {
  if (!supabase) { guestSet('services', guestRows('services').filter(s => s.id !== id)); return; }
  unwrap(await supabase.from('services').delete().eq('id', id));
}
