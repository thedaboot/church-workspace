import { supabase } from './supabaseClient.js';
import { fetchPeople, fetchGroups, fetchGroupMembers, fetchMyPerson, fetchRoles } from './people.js';
import { generateId } from '../utils.js';

// ============================================================================
// v2 예배 — 주보(services) · 출석(attendance) · 내 예배 노트(service_notes)
// ----------------------------------------------------------------------------
// 스펙 정본은 docs/V2.md §1(결정 4·5·6·7·14)·§2, 저장 자리는 0036이다.
//
// **RLS가 권한의 진실이고 화면은 그걸 비춘다.** 여기 있는 판정 함수(worshipPerms)는
// 0035·0036의 can_edit_service()·can_check_all_attendance()·leads_sun_of()를 그대로
// 옮긴 것이다 — 버튼을 감추는 용도이지 막는 용도가 아니다. 어긋나면 DB가 이긴다.
//
// 명단·순 편성은 people.js 한 벌을 쓴다(다시 만들지 않는다). 이 파일은 그 위에
// 예배 화면이 필요로 하는 것만 얹는다: 주보 읽기·쓰기, 출석 토글, 내 노트 upsert.
//
// **게스트 모드(supabase 없음)에서는 localStorage가 클라우드 자리를 대신한다** —
// 워크스페이스가 게스트에서 `church_app_v4`를 보는 것과 같은 방식이다. 그래야
// 브라우저 스위트가 이 화면을 실제로 눌러 볼 수 있다(tests/worship.mjs). 클라우드
// 경로(RLS·실데이터)는 사람이 확인해야 한다 — HANDOFF §2-6.
// ============================================================================

const COLS = 'id, kind, service_date, status, title, passage_ref, preacher, roles, songs, notices, attendance_note, created_at, updated_at';

export const SUNDAY_KIND = 'sunday';
export const SUNDAY_LABEL = '주일 4부 젊은이 예배';
export const UNASSIGNED = '순 미지정';

// ── 게스트 시드 (클라우드가 없을 때의 저장 자리) ────────────────────────────
const GUEST_KEY = 'church_worship_v1';
const guestAll = () => {
  try { return JSON.parse(localStorage.getItem(GUEST_KEY)) || {}; } catch { return {}; }
};
const guestRows = (table) => guestAll()[table] || [];
const guestSet = (table, rows) => {
  try { localStorage.setItem(GUEST_KEY, JSON.stringify({ ...guestAll(), [table]: rows })); } catch { /* 사파리 비공개 모드 */ }
};

// ── 순수 헬퍼 (브라우저 없이도 검사된다) ────────────────────────────────────

// 종류 이름. 'sunday'만 상수고 나머지는 만든 사람이 적은 이름 그대로다(결정 14).
export const kindLabel = (kind) => (kind === SUNDAY_KIND ? SUNDAY_LABEL : (kind || '예배'));

// 다가오는 주일. 오늘이 주일이면 오늘이다 — 주일 아침에 주보를 만들면서
// 다음 주 날짜가 기본값이면 매번 고쳐야 한다.
export function nextSundayDate(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

// '2026-09-06' → '9월 6일 (일)'. 올해가 아니면 연도를 앞에 붙인다.
// 날짜 문자열을 그대로 쪼갠다 — new Date('2026-09-06')은 UTC 자정이라 시간대에 따라
// 하루가 밀린다(0019의 'MM-DD' 관례와 같은 이유).
export function formatServiceDate(iso, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const [y, mo, day] = [+m[1], +m[2], +m[3]];
  const w = WEEKDAY[new Date(y, mo - 1, day).getDay()];
  return `${y === now.getFullYear() ? '' : `${y}년 `}${mo}월 ${day}일 (${w})`;
}

export const serviceYear = (iso) => Number(String(iso || '').slice(0, 4)) || new Date().getFullYear();

// 오늘(한국 시간). 브라우저 로컬 시간으로 재면 검사 기계의 시간대에 따라 답이 달라진다
// — 'sv-SE' 로케일이 곧 'YYYY-MM-DD'다(word.js가 같은 한 줄을 쓴다).
export const kstToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

// 출석을 만질 수 있는 주보인가 — **발행됐고 예배 날짜가 지난(오늘 포함)** 것만이다.
// 작성 중인 주보나 아직 오지 않은 예배에는 출석 진입 자체가 없다(사용자 결정).
// ISO 날짜는 글자 순서가 곧 시간 순서라 그대로 견준다.
export function attendanceOpen(service, today = kstToday()) {
  if (!service || service.status !== 'published') return false;
  const d = String(service.service_date || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today;
}

// 자격 판정 — 0035·0036의 함수와 같은 식이다.
//   주보 작성·발행 = 마스터 + 교역자 + 올해 회장            (can_edit_service)
//   출석 전체      = 관리자 + 교역자 + 올해 임원 아무 역할  (can_check_all_attendance)
//   출석 자기 순   = 올해 그 순의 순장                      (leads_sun_of)
export function worshipPerms({ isMaster = false, isAdmin = false, myPerson = null, myRoles = [], ledGroupIds = [] } = {}) {
  const roles = myRoles || [];
  const pastor = !!myPerson?.is_pastor;
  const canEdit = !!isMaster || pastor || roles.includes('president');
  const canCheckAll = !!isAdmin || pastor || roles.length > 0;
  const led = ledGroupIds || [];
  return { canEdit, canCheckAll, ledGroupIds: led, canCheck: canCheckAll || led.length > 0 };
}

// 그 순을 내가 체크할 수 있나. '순 미지정'(groupId 없음)은 전체 자격자만 만진다.
export const canToggleGroup = (perms, groupId) =>
  !!perms?.canCheckAll || (!!groupId && (perms?.ledGroupIds || []).includes(groupId));

// 순별로 묶은 명단. 순장은 편성 명단에 없어도 자기 순에 세운다(0036 same_sun과 같다).
// 어느 순에도 없는 사람은 맨 끝 '순 미지정' 묶음으로 — 새신자가 여기로 들어온다.
export function groupRoster({ people = [], groups = [], members = [] } = {}) {
  const byId = new Map(people.map(p => [p.id, p]));
  const placed = new Set();
  const buckets = groups.map(g => {
    const ids = members.filter(m => m.group_id === g.id).map(m => m.person_id);
    if (g.leader_person_id) ids.unshift(g.leader_person_id);
    const seen = new Set();
    const list = [];
    for (const id of ids) {
      if (seen.has(id) || !byId.has(id)) continue;
      seen.add(id); placed.add(id); list.push(byId.get(id));
    }
    return { id: g.id, name: g.name, leaderPersonId: g.leader_person_id, people: list };
  });
  const rest = people.filter(p => !placed.has(p.id));
  if (rest.length) buckets.push({ id: null, name: UNASSIGNED, leaderPersonId: null, people: rest });
  return buckets;
}

// 묶음별 (출석/전체) — 상단 집계와 순 머리줄이 같은 셈을 쓴다.
export const countPresent = (list = [], present) => list.filter(p => present?.has(p.id)).length;

// ── 주보 ────────────────────────────────────────────────────────────────────

// 작성 중(draft)은 편집 자격자에게만 온다 — 화면이 아니라 RLS가 거른다(0036).
export async function fetchServices() {
  if (!supabase) return [...guestRows('services')].sort((a, b) => String(b.service_date).localeCompare(String(a.service_date)));
  const { data, error } = await supabase.from('services').select(COLS).order('service_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createService({ kind = SUNDAY_KIND, serviceDate }) {
  const row = { kind: (kind || SUNDAY_KIND).trim() || SUNDAY_KIND, service_date: serviceDate, status: 'draft' };
  if (!supabase) {
    const made = { id: generateId(), roles: [], songs: [], notices: [], title: '', passage_ref: '', preacher: '', attendance_note: '', created_at: new Date().toISOString(), ...row };
    guestSet('services', [...guestRows('services'), made]);
    return made;
  }
  const { data, error } = await supabase.from('services').insert(row).select(COLS).single();
  if (error) throw error;
  return data;
}

export async function saveService(id, patch) {
  if (!supabase) {
    const rows = guestRows('services').map(s => (s.id === id ? { ...s, ...patch } : s));
    guestSet('services', rows);
    return rows.find(s => s.id === id);
  }
  const { data, error } = await supabase.from('services')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select(COLS).single();
  if (error) throw error;
  return data;
}

export const publishService = (id) => saveService(id, { status: 'published' });

export async function removeService(id) {
  if (!supabase) { guestSet('services', guestRows('services').filter(s => s.id !== id)); return; }
  const { error } = await supabase.from('services').delete().eq('id', id);
  if (error) throw error;
}

// ── 명단 · 자격 ─────────────────────────────────────────────────────────────

// 그 예배 날짜의 연도 순 편성. 순은 해마다 다시 짜므로 '올해'가 아니라 그 예배의 해다.
export async function fetchRoster(year) {
  if (!supabase) {
    const groups = guestRows('groups').filter(g => g.type === 'sun' && (!year || g.year === year));
    const ids = new Set(groups.map(g => g.id));
    return {
      people: guestRows('people').filter(p => !p.removed_at),
      groups,
      members: guestRows('group_members').filter(m => ids.has(m.group_id)),
    };
  }
  const [people, groups] = await Promise.all([fetchPeople(), fetchGroups('sun', year)]);
  const members = await fetchGroupMembers(groups.map(g => g.id));
  return { people, groups, members };
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

// 명단에 없는 사람을 그 자리에서 올린다(결정 6). 출석 자격자면 RLS가 통과시킨다(0035).
export async function addRosterPerson(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  if (!supabase) {
    const made = { id: generateId(), name: clean, teams: [], is_pastor: false, profile_id: null };
    guestSet('people', [...guestRows('people'), made]);
    return made;
  }
  const { data, error } = await supabase.from('people').insert({ name: clean })
    .select('id, name, birthday, teams, is_pastor, profile_id').single();
  if (error) throw error;
  return data;
}

// ── 출석 ────────────────────────────────────────────────────────────────────
// 행이 있으면 출석, 지우면 취소(0036). 화면은 낙관적으로 먼저 바꾸고 실패하면 되돌린다.

export async function fetchAttendance(serviceId) {
  if (!supabase) return guestRows('attendance').filter(a => a.service_id === serviceId).map(a => a.person_id);
  const { data, error } = await supabase.from('attendance').select('person_id').eq('service_id', serviceId);
  if (error) throw error;
  return (data ?? []).map(r => r.person_id);
}

export async function checkIn(serviceId, personId) {
  if (!supabase) {
    const rows = guestRows('attendance').filter(a => !(a.service_id === serviceId && a.person_id === personId));
    guestSet('attendance', [...rows, { service_id: serviceId, person_id: personId }]);
    return;
  }
  const { error } = await supabase.from('attendance').insert({ service_id: serviceId, person_id: personId });
  if (error) throw error;
}

export async function checkOut(serviceId, personId) {
  if (!supabase) {
    guestSet('attendance', guestRows('attendance').filter(a => !(a.service_id === serviceId && a.person_id === personId)));
    return;
  }
  const { error } = await supabase.from('attendance').delete().eq('service_id', serviceId).eq('person_id', personId);
  if (error) throw error;
}

// ── 내 예배 노트 ────────────────────────────────────────────────────────────
// 예배당 한 건(unique). 기본은 나만 보고, '내 순에 공유'를 켜면 올해 같은 순만 본다.
// 남의 노트는 이 화면에 오지 않는다 — 모임 화면 소관이다(결정 7).

async function myUid() {
  const { data: { user } = {} } = await supabase.auth.getUser();
  return user?.id || null;
}

export async function fetchMyNote(serviceId) {
  if (!supabase) return guestRows('service_notes').find(n => n.service_id === serviceId) || null;
  const uid = await myUid();
  if (!uid) return null;
  const { data, error } = await supabase.from('service_notes')
    .select('id, body, shared_to_sun').eq('service_id', serviceId).eq('profile_id', uid).maybeSingle();
  if (error) throw error;
  return data ?? null;
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
  const { data, error } = await supabase.from('service_notes')
    .upsert({ service_id: serviceId, profile_id: uid, body, shared_to_sun: sharedToSun, updated_at: new Date().toISOString() },
      { onConflict: 'service_id,profile_id' })
    .select('id, body, shared_to_sun').single();
  if (error) throw error;
  return data;
}
