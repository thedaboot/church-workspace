// ============================================================================
// 예배 — 명단·자격 · 출석 · 손님(0053) · 출석 수 · 출석 메모(0052)
// ----------------------------------------------------------------------------
// 판정(worshipPerms · groupRoster)은 pure.js, 여기는 읽기·쓰기만 한다.
// ============================================================================
import { supabase } from '../supabaseClient.js';
import { fetchPeople, fetchGroups, fetchGroupMembers, fetchMyPerson, fetchRoles, guestStore } from '../people.js';
import { unwrap } from '../cloud/core.js';
import { generateId } from '../../utils.js';
import { worshipPerms } from './pure.js';

const { all: guestAll, rows: guestRows, set: guestSet } = guestStore('church_worship_v1');

// ── 명단 · 자격 ─────────────────────────────────────────────────────────────

// 그 예배 날짜의 연도 순 편성. 순은 해마다 다시 짜므로 '올해'가 아니라 그 예배의 해다.
//
// **직분(people_roles)도 같이 싣는다**(2026-09-06) — 주보 보기가 이름 뒤에 호칭을 붙이는데
// (people.js honorific: 교역자 '전도사님' · 부장 '부장님' · 나머지 '청년'), 부장은 명단
// 속성이 아니라 그 해의 직분 줄이라 여기서 읽어야 안다. 조회 한 번이 늘고, 출석 명단과
// 같은 캐시에 들어간다.
export async function fetchRoster(year) {
  if (!supabase) {
    const groups = guestRows('groups').filter(g => g.type === 'sun' && (!year || g.year === year));
    const ids = new Set(groups.map(g => g.id));
    return {
      people: guestRows('people').filter(p => !p.removed_at),
      groups,
      members: guestRows('group_members').filter(m => ids.has(m.group_id)),
      roles: guestRows('people_roles').filter(r => !year || r.year === year),
    };
  }
  const [people, groups, roles] = await Promise.all([fetchPeople(), fetchGroups('sun', year), fetchRoles(year)]);
  const members = await fetchGroupMembers(groups.map(g => g.id));
  return { people, groups, members, roles };
}

// 화면이 쓸 자격 한 벌. 마스터·관리자는 로그인 계정 속성이라 호출부(useAuth)가 준다.
// 게스트 모드에는 로그인이 없다 — 시드의 me가 그 자리를 대신하고, 기본은 전부 허용이다
// (게스트에서 isAdmin·isMaster가 true인 것과 같은 취급).
export async function fetchWorshipPerms(year, { isMaster = false, isAdmin = false } = {}) {
  if (!supabase) {
    return { canEdit: true, canCheckAll: true, ledGroupIds: [], canCheck: true, ...(guestAll().me || {}) };
  }
  const [myPerson, roles, groups] = await Promise.all([fetchMyPerson(), fetchRoles(year), fetchGroups('sun', year)]);
  const myRoles = myPerson ? roles.filter(r => r.person_id === myPerson.id).map(r => r.role) : [];
  const ledGroupIds = myPerson ? groups.filter(g => g.leader_person_id === myPerson.id).map(g => g.id) : [];
  return worshipPerms({ isMaster, isAdmin, myPerson, myRoles, ledGroupIds });
}

// ── 미등록 출석자 = 그 예배의 손님 (0053) ──────────────────────────────────
// **명단(people)에 올리지 않는다**(사용자 결정 2026-09-07: "바로 청년 명단에 올리게끔 하지는
// 말아줘. 청년 명단 등록은 마스터가 너한테 얘기할 때만"). 예전에는 `addRosterPerson` +
// `addToSun`(0050)으로 people·group_members에 행을 만들었는데, 출석을 부르다 잘못 적은
// 이름 하나가 그대로 청년 명단에 남았다 — 지우는 길도 이 화면에는 없었다.
// 지금은 `attendance_guests`에 이름만 남기고 × 하나로 지운다. 손님은 **언제나 출석**이라
// 출석 행(attendance)도 따로 만들지 않는다 — 명단 사람이 아니라서 person_id가 없다.
export async function fetchGuests(serviceId) {
  if (!supabase) {
    return guestRows('attendance_guests')
      .filter(g => g.service_id === serviceId)
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }
  return unwrap(await supabase.from('attendance_guests')
    .select('id, service_id, name, created_at').eq('service_id', serviceId).order('created_at')) ?? [];
}

export async function addGuest(serviceId, name) {
  const clean = String(name || '').trim();
  if (!clean || !serviceId) return null;
  if (!supabase) {
    const made = { id: generateId(), service_id: serviceId, name: clean, created_at: new Date().toISOString() };
    guestSet('attendance_guests', [...guestRows('attendance_guests'), made]);
    return made;
  }
  return unwrap(await supabase.from('attendance_guests')
    .insert({ service_id: serviceId, name: clean })
    .select('id, service_id, name, created_at').single());
}

export async function removeGuest(id) {
  if (!id) return;
  if (!supabase) {
    guestSet('attendance_guests', guestRows('attendance_guests').filter(g => g.id !== id));
    return;
  }
  unwrap(await supabase.from('attendance_guests').delete().eq('id', id));
}

// 주보별 출석 수 — 목록 카드의 '출석 N명'이 쓴다(발행된 지난 예배만 그린다).
// **카드마다 세지 않는다**: 표 두 개를 통째로 한 번씩 읽어 service_id로 센다(주보 수 × 50행
// 수준이라 목록 한 번에 조회 두 번이면 끝난다 — §6-20의 '개수를 따로 세는 경로'와 같은 판단).
//
// `since`('YYYY-MM-DD')를 주면 **그 날짜 이후 주보의 출석만** 센다(2026-09-24). 홈·모임은
// 출석이 든 가장 최근 주일 하나만 찾으므로(groups.attendanceSunday) 해가 갈수록 커지는 표
// 전체가 필요 없다. 거르는 것은 주보 날짜라 `services!inner(service_date)`로 붙여 걸러 낸다
// (최근 주보 id를 먼저 읽어 `.in()`으로 하면 왕복이 하나 는다). 예배 목록은 지난 주보마다
// '출석 N명'을 그리므로 since 없이 전체를 센다.
export async function fetchAttendanceCounts({ since = '' } = {}) {
  let rows;
  if (!supabase) {
    rows = [...guestRows('attendance'), ...guestRows('attendance_guests')];
    if (since) {
      const recent = new Set(guestRows('services').filter(s => String(s?.service_date || '') >= since).map(s => s.id));
      rows = rows.filter(r => recent.has(r?.service_id));
    }
  } else {
    const count = (table) => (since
      ? supabase.from(table).select('service_id, services!inner(service_date)').gte('services.service_date', since)
      : supabase.from(table).select('service_id'));
    const [att, gst] = await Promise.all([count('attendance'), count('attendance_guests')]);
    rows = [...(unwrap(att) ?? []), ...(unwrap(gst) ?? [])];
  }
  const out = {};
  for (const r of rows) { if (r?.service_id) out[r.service_id] = (out[r.service_id] || 0) + 1; }
  return out;
}

// ── 출석 ────────────────────────────────────────────────────────────────────
// 행이 있으면 출석, 지우면 취소(0036). 화면은 낙관적으로 먼저 바꾸고 실패하면 되돌린다.

export async function fetchAttendance(serviceId) {
  if (!supabase) return guestRows('attendance').filter(a => a.service_id === serviceId).map(a => a.person_id);
  const data = unwrap(await supabase.from('attendance').select('person_id').eq('service_id', serviceId));
  return (data ?? []).map(r => r.person_id);
}

// **"이미 출석"은 실패가 아니다**(§6의 23505 항목과 같은 판단). PK가 (service_id,
// person_id)라 두 번 찍으면 23505가 나는데, 넣으려던 상태는 이미 참이다. 예전에는
// 화면이 켠 칩을 도로 끄고 '표시하지 못했어요'라고 말했다 — DB에는 있는데 화면만
// 없다고 하는, 정확히 반대로 된 답이었다(2026-09-06 지적). upsert + ignoreDuplicates가
// 그 왕복을 아예 없앤다(존재하면 아무 일도 하지 않는다).
export async function checkIn(serviceId, personId) {
  if (!supabase) {
    const rows = guestRows('attendance').filter(a => !(a.service_id === serviceId && a.person_id === personId));
    guestSet('attendance', [...rows, { service_id: serviceId, person_id: personId }]);
    return;
  }
  unwrap(await supabase.from('attendance').upsert(
    { service_id: serviceId, person_id: personId },
    { onConflict: 'service_id,person_id', ignoreDuplicates: true },
  ));
}

export async function checkOut(serviceId, personId) {
  if (!supabase) {
    guestSet('attendance', guestRows('attendance').filter(a => !(a.service_id === serviceId && a.person_id === personId)));
    return;
  }
  unwrap(await supabase.from('attendance').delete().eq('service_id', serviceId).eq('person_id', personId));
}

// ── 출석 메모 (0052) ────────────────────────────────────────────────────────
// 저장 자리는 주보 행의 한 칸(`services.attendance_note` · 0036)이지만 **주보를 쓰는
// 길로 가지 않는다.** `update services`는 `services_write`(= can_edit_service)라
// 순장에게 42501이었고, 그래서 회차 9-c는 메모 칸을 아예 감췄다. 사용자 결정
// (2026-09-06: "출석 메모는 주보를 편집하는 건 아니라고 생각해서")으로 순장에게 여는데,
// 정책을 하나 더 붙이면 permissive OR라 그 행의 **모든 칸**이 열린다(§6-31-a).
// 그래서 0052가 **그 한 칸만 쓰는 rpc**를 두고 자격을 함수 안에서 묻는다 —
// 출석을 체크할 수 있는 사람(전체 자격자 + 순장)이고 주보가 발행되어 있을 때다.
// 화면의 게이트(worshipAttendance의 `perms.canCheck`)와 같은 경계다.
//
// 게스트에는 rpc가 없다 — localStorage의 그 행을 그대로 고친다(다른 저장과 같은 방식).
export async function saveAttendanceNote(serviceId, note) {
  const text = String(note ?? '');
  if (!supabase) {
    const rows = guestRows('services').map(s => (s.id === serviceId ? { ...s, attendance_note: text } : s));
    guestSet('services', rows);
    return text;
  }
  const data = unwrap(await supabase.rpc('set_attendance_note', { p_service_id: serviceId, p_note: text }));
  return data ?? text;
}
