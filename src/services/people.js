import { supabase, myUid } from './supabaseClient.js';

// ============================================================================
// v2 명단(people)·모임(groups) 읽기 계층 — 예배·모임 줄기가 같이 쓴다 (docs/V2.md §2)
// ----------------------------------------------------------------------------
// 워크스페이스 스토어에 넣지 않는 이유는 presence.js와 같다 — LOAD_STATE가 상태를
// 통째로 갈아치우는 흐름에 새 축(명단)을 섞지 않는다. 여기는 **읽기만** 있다.
// 쓰기(명단 수정·순 편성·출석)는 각 화면의 서비스가 자기 표에 직접 한다.
//
// 게스트 모드(supabase null)에서는 전부 빈 값이다 — 브라우저 스위트는 이 화면들의
// 존재만 볼 수 있고 데이터 경로는 클라우드에서 사람이 확인해야 한다(HANDOFF §3-6).
//
// 사람을 이름으로 매칭하지 않는다(§6-26) — 연결은 people.profile_id 하나다.
// ============================================================================

// 이름 순서는 한 군데서 정한다 — 화면마다 다르면 같은 사람이 자리를 옮겨 다닌다.
// localeCompare('ko')라야 한글이 ㄱㄴㄷ으로 선다(기본 정렬은 유니코드 코드포인트라
// 겹받침·한자 이름에서 어긋난다). 모임(groups.js)·예배(worship.js)가 같이 쓴다 —
// groups.js가 worship.js를 import하므로 둘 다 부를 수 있는 이 파일에 둔다(순환 방지).
export const byName = (a, b) =>
  String(a?.name || '').localeCompare(String(b?.name || ''), 'ko');

// 명단 전체. removed_at이 있는 사람은 기본으로 뺀다(내용은 남기고 목록에서만).
export async function fetchPeople({ includeRemoved = false } = {}) {
  if (!supabase) return [];
  let q = supabase.from('people')
    // gender는 호칭('형제'·'자매')이 보는 칸이다(0064) — **여기서 빠지면 화면이 조용히
    // 전부 '청년'으로 남는다**(honorific의 null 갈래로 떨어진다).
    .select('id, name, birthday, teams, gender, is_pastor, sun_exempt, profile_id, note, removed_at, profiles:profile_id(display_name)')
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

// ── 호칭 ──────────────────────────────────────────────────────────────────
// 규칙은 순수 모듈 honorific.js 한 벌이다(서버·공개 보기도 같은 것을 부른다). 앱은 여기서 가져간다.
export { HONORIFIC, honorific, honorificsOf } from './honorific.js';

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

// 내 명단 행(로그인 계정과 이어진 사람). 없으면 null — 아직 관리자가 안 이어 주었다.
export async function fetchMyPerson() {
  if (!supabase) return null;
  // **합친 계정이면 남긴 계정의 id로 찾는다**(0061) — 그 계정으로 들어와도 같은 명단 행이다
  const uid = await myUid();
  if (!uid) return null;
  const { data, error } = await supabase.from('people')
    .select('id, name, birthday, teams, is_pastor, sun_exempt, profile_id, profiles:profile_id(display_name)')
    .eq('profile_id', uid).is('removed_at', null).maybeSingle();
  if (error) throw error;
  return data ? withDisplayName(data) : null;
}
