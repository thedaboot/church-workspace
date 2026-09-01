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
    .select('id, name, birthday, teams, is_pastor, profile_id, note, removed_at')
    .order('name');
  if (!includeRemoved) q = q.is('removed_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
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
export async function fetchMyPerson() {
  if (!supabase) return null;
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('people')
    .select('id, name, birthday, teams, is_pastor, profile_id')
    .eq('profile_id', user.id).is('removed_at', null).maybeSingle();
  if (error) throw error;
  return data ?? null;
}
