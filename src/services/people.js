import { supabase } from './supabaseClient.js';

// ============================================================================
// v2 명단(people)·모임(groups) 읽기 계층 — 예배·모임 줄기가 같이 쓴다 (docs/V2.md §2)
// ----------------------------------------------------------------------------
// 워크스페이스 스토어에 넣지 않는 이유는 presence.js와 같다 — LOAD_STATE가 상태를
// 통째로 갈아치우는 흐름에 새 축(명단)을 섞지 않는다. 여기는 **읽기만** 있다.
// 쓰기(명단 수정·순 편성·출석)는 각 화면의 서비스가 자기 표에 직접 한다.
//
// 게스트 모드(supabase null)에서는 전부 빈 값이다 — 브라우저 스위트는 이 화면들의
// 존재만 볼 수 있고 데이터 경로는 클라우드에서 사람이 확인해야 한다(HANDOFF §2-6).
//
// 사람을 이름으로 매칭하지 않는다(§6-26) — 연결은 people.profile_id 하나다.
// ============================================================================

// 명단 전체. removed_at이 있는 사람은 기본으로 뺀다(내용은 남기고 목록에서만).
export async function fetchPeople({ includeRemoved = false } = {}) {
  if (!supabase) return [];
  let q = supabase.from('people')
    .select('id, name, birthday, teams, is_pastor, sun_exempt, profile_id, note, removed_at, profiles:profile_id(display_name)')
    .order('name');
  if (!includeRemoved) q = q.is('removed_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(withDisplayName);
}

// 계정이 이어진 사람은 **계정 표시명**으로 부른다(사용자 결정 2026-09-03 — 명단의 '임재훈'은
// 앱 안에서 '말감이'다). 명단에 적힌 이름은 roster_name으로 남겨 명단 관리가 볼 수 있게 한다.
// 순장·동아리장·출석 칩·홈 등 사람 이름을 그리는 자리는 전부 fetchPeople을 거치므로 여기 한 곳이면 된다.
function withDisplayName(p) {
  const { profiles, ...rest } = p;
  const shown = profiles?.display_name?.trim();
  return { ...rest, roster_name: p.name, name: shown || p.name };
}

// ── 호칭 (사용자 결정 2026-09-06) ───────────────────────────────────────────
// 주보 발행본과 홈에서는 이름 뒤에 호칭을 붙인다. 세 갈래다:
//   · 교역자(`people.is_pastor`)            → 'OOO 전도사님'
//   · 그 해 부장(`people_roles.role`)       → 'OOO 부장님'
//   · 그 밖의 명단 사람                     → 'OOO 청년'
// **명단에 없는 이름은 그대로 둔다** — 객원 인도자·외부 강사는 우리가 아는 것이 없어서
// '청년'이라고 부를 근거가 없다. 설교자(`services.preacher`)는 자유 텍스트라 아예
// 이 길을 타지 않는다(이미 '임성빈 전도사님'처럼 적는다).
//
// 호칭은 **보기에서만** 붙인다 — 편집 화면의 입력칸은 이름 그대로다(저장되는 값이
// 이름이라야 명단 자동완성·person 연결이 계속 맞는다).
export const HONORIFIC = { pastor: '전도사님', director: '부장님', youth: '청년' };
const DIRECTOR = 'director';

export function honorific(name, info) {
  const clean = String(name || '').trim();
  if (!clean || !info) return clean;
  if (info.isPastor) return `${clean} ${HONORIFIC.pastor}`;
  if ((info.roles || []).includes(DIRECTOR)) return `${clean} ${HONORIFIC.director}`;
  return `${clean} ${HONORIFIC.youth}`;
}

// 명단 + 그 해 직분 → `(name, personId?) => '홍길동 청년'` 한 벌.
// **id가 있으면 id로 찾는다**(담당자 줄은 personId를 들고 있다). 이름만 있는 자리
// (찬양 인도자 — 0044는 글자 하나다)는 이름으로 찾는데, 계정 표시명으로 덮인 이름
// (`withDisplayName`)과 명단에 적힌 이름(`roster_name`) 둘 다 열쇠로 둔다. 같은 이름이
// 둘이면 **먼저 나온 사람**이다 — 이름만 가지고는 더 가릴 수 없다.
export function honorificsOf(people = [], roles = []) {
  const roleBy = new Map();
  for (const r of roles || []) {
    if (!r?.person_id || !r?.role) continue;
    if (!roleBy.has(r.person_id)) roleBy.set(r.person_id, []);
    roleBy.get(r.person_id).push(r.role);
  }
  const byId = new Map();
  const byName = new Map();
  for (const p of people || []) {
    if (!p?.id) continue;
    const info = { isPastor: !!p.is_pastor, roles: roleBy.get(p.id) || [] };
    byId.set(p.id, info);
    for (const key of [p.name, p.roster_name]) {
      const k = String(key || '').trim();
      if (k && !byName.has(k)) byName.set(k, info);
    }
  }
  return (name, personId = null) =>
    honorific(name, (personId && byId.get(personId)) || byName.get(String(name || '').trim()) || null);
}

// 올해(또는 지정 연도) 직분 — [{ person_id, year, role }]
export async function fetchRoles(year) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('people_roles')
    .select('person_id, year, role').eq('year', year);
  if (error) throw error;
  return data ?? [];
}

// 모임 목록. type: 'sun' | 'club'. 순은 연도를 함께 거른다.
export async function fetchGroups(type, year) {
  if (!supabase) return [];
  let q = supabase.from('groups')
    .select('id, type, name, year, leader_person_id, note')
    .eq('type', type).is('removed_at', null).order('name');
  if (type === 'sun' && year) q = q.eq('year', year);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// 모임 구성원 — group id 배열을 받아 한 번에 [{ group_id, person_id }]
export async function fetchGroupMembers(groupIds) {
  if (!supabase || !groupIds?.length) return [];
  const { data, error } = await supabase.from('group_members')
    .select('group_id, person_id').in('group_id', groupIds);
  if (error) throw error;
  return data ?? [];
}

// 내 명단 행(로그인 계정과 이어진 사람). 없으면 null — 아직 관리자가 안 이었다.
// 게스트 저장 자리(클라우드가 없을 때) — 서비스마다 localStorage 한 키에 표들을 둔다.
// 키는 서비스별로 따로다(church_worship_v1 · church_groups_v1 · church_roster_v1).
// ponytail: 한 키로 합치지 않는다 — 시드의 `me`(자격) 모양이 서비스마다 달라 겹치면
// 서로 덮어쓴다. 게스트에서 한 명단을 셋이 같이 봐야 할 때 합친다.
export function guestStore(key) {
  const all = () => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
  const rows = (table) => all()[table] || [];
  const set = (table, list) => {
    try { localStorage.setItem(key, JSON.stringify({ ...all(), [table]: list })); } catch { /* 사파리 비공개 모드 */ }
  };
  return { all, rows, set };
}

export async function fetchMyPerson() {
  if (!supabase) return null;
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('people')
    .select('id, name, birthday, teams, is_pastor, sun_exempt, profile_id, profiles:profile_id(display_name)')
    .eq('profile_id', user.id).is('removed_at', null).maybeSingle();
  if (error) throw error;
  return data ? withDisplayName(data) : null;
}
