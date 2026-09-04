import { supabase } from './supabaseClient.js';
import { fetchPeople, fetchRoles, fetchGroups, fetchGroupMembers, guestStore } from './people.js';
import { generateId } from '../utils.js';

// ============================================================================
// v2 명단(people) 쓰기 계층 — 멤버 화면의 '명단' 구역이 쓴다 (docs/V2.md §1 결정 1·13)
// ----------------------------------------------------------------------------
// 읽기는 services/people.js 한 벌을 그대로 쓴다(다시 만들지 않는다). 여기는 그 위에
// **관리자가 손을 대는 길**만 얹는다: 사람 추가·수정 · 환송/되돌리기 · 계정 연결 ·
// 직분 지정(people_roles 연도별 · people.is_pastor).
//
// **계정 연결은 사람이 눈으로 골라서 한다.** 이름이 같아도 자동으로 연결하지 않는다 —
// 이름으로 사람을 매다는 방식은 §6-26에서 이미 깨졌다(동명이인·개명). 0037 시드가
// 이름으로 연결한 것은 사람이 검수한 일회성 목록이고, 앱 런타임에는 그 길이 없다.
//
// **행을 지우는 길은 두지 않는다.** 출석(attendance)이 person_id로 매달려 있어서
// 지우면 지난 기록이 같이 사라진다. 환송은 removed_at을 찍을 뿐이고, 되돌리면
// 그대로 돌아온다(profiles의 환송·다시 초대와 같은 규칙).
//
// 권한의 진실은 RLS다(0035 — people 쓰기 = is_admin, people_roles 쓰기 = is_admin).
// 화면은 그걸 비출 뿐이고, 어긋나면 DB가 이긴다. 막히면 토스트로 알린다(failText).
//
// **게스트 모드(supabase 없음)에서는 localStorage가 클라우드 자리를 대신한다** —
// services/worship.js와 같은 방식이다. 그래야 브라우저 스위트가 이 화면을 실제로
// 눌러 볼 수 있다(tests/roster.mjs). 클라우드 경로(RLS·실데이터)는 사람이
// 확인해야 한다 — HANDOFF §2-6.
// ============================================================================

const COLS = 'id, name, birthday, teams, is_pastor, profile_id, note, removed_at';

// 직분 — 사용자가 정한 여섯이다(2026-09-05): 교역자 · 부장 · 회장 · 총무 · 리더순장 ·
// 리더팀장. 화면의 칩도 이 순서다. 교역자만 연도와 무관한 명단 속성(people.is_pastor)이고
// 나머지 다섯은 연도별(people_roles — 임원진이 해마다 바뀐다).
//
// 0043 전에는 부장·총무·리더팀장 자리가 `officer`(임원) 한 값이었다 — 네 사람이 같은
// 배지를 나눠 써서 누가 무엇인지 화면에서 알 수 없었다. 0043이 값을 갈랐고 `officer`는
// 사라졌다. **권한은 그대로다**: DB의 is_officer()는 그 해 줄이 있는지만 보고 값을 보지
// 않는다(0035) — 새 값들도 임원과 같은 자리를 맡는다.
// 팀장 같은 나머지 직함은 지금처럼 role_note 자유 텍스트다.
export const ROLE_LABEL = {
  director: '부장', president: '회장', treasurer: '총무',
  lead_sunjang: '리더순장', lead_team: '리더팀장',
};
export const YEAR_ROLES = ['director', 'president', 'treasurer', 'lead_sunjang', 'lead_team'];
export const PASTOR_LABEL = '교역자';

// ── 순수 헬퍼 (브라우저 없이도 검사된다 — tests/roster.mjs 앞부분) ───────────

// 공백을 지우고 비교한다 — 검색창(layout.jsx SearchResults)과 같은 규칙이다.
const norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, '');

// 0035의 people_birthday_mmdd 체크와 **같은 식**이다. 화면이 먼저 걸러도 DB가
// 다시 본다 — 두 식이 어긋나면 저장이 조용히 막힌다.
export const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

// '5-26' · '05-26' · '0526' 을 전부 '05-26'으로 받는다. 빈 값은 비운 것이다.
// 세 자리(예: '526')는 1월 26일인지 5월 26일인지 알 수 없어 받지 않는다.
export function parseBirthday(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: true, value: null };
  const parts = raw.split(/[^0-9]+/).filter(Boolean);
  let mm, dd;
  if (parts.length === 2) { [mm, dd] = parts; }
  else if (parts.length === 1 && parts[0].length === 4) { mm = parts[0].slice(0, 2); dd = parts[0].slice(2); }
  else return { ok: false, value: null };
  const value = `${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  return MMDD.test(value) ? { ok: true, value } : { ok: false, value: null };
}

export function searchPeople(people, q) {
  const s = norm(q);
  if (!s) return people || [];
  return (people || []).filter(p => norm(p.name).includes(s));
}

// 아직 명단에 연결되지 않은 계정. 환송했거나 승인 대기인 계정은 후보가 아니다.
export function unlinkedProfiles(profiles, people) {
  const taken = new Set((people || []).map(p => p.profile_id).filter(Boolean));
  return (profiles || []).filter(pr => pr && pr.approved && !pr.removed_at && !taken.has(pr.id));
}

// 계정 연결 칸이 무엇을 그려야 하나 — **"후보가 없다"와 "모두 연결됐다"는 다른 말이다.**
// 예전 화면은 `candidates.length === 0`을 "가입한 계정이 모두 명단에 이어져 있어요"로
// 읽었는데 그게 거짓이었다(사용자 지적 2026-09-05). 두 가지가 겹쳐 있었다:
//   ① 승인 대기·환송한 계정은 **후보가 아니면서 명단에 연결되어 있지도 않다** —
//      라이브에 실제로 그런 계정이 있다(환송한 계정 하나, people 행 없음).
//   ② 계정 목록(profiles)이 아직 안 왔을 때도 빈 배열이라 같은 문장이 떴다.
// 그래서 '아직 받는 중'과 '연결할 수 있는 후보가 없다'를 갈라 돌려준다. 화면은 앞의 것에
// 스켈레톤을, 뒤의 것에 사실만 말하는 문구를 놓는다.
export function accountLinkState({ profiles, people, ready = true } = {}) {
  if (!ready) return { status: 'loading', candidates: [] };
  const candidates = unlinkedProfiles(profiles, people);
  return { status: candidates.length ? 'pick' : 'none', candidates };
}

// person_id → ['꼬순', …]. 한 사람이 두 순에 있을 일은 없지만 배열로 둔다.
export function sunNames(suns, groupMembers) {
  const nameById = new Map((suns || []).map(g => [g.id, g.name]));
  const out = new Map();
  for (const gm of groupMembers || []) {
    const name = nameById.get(gm.group_id);
    if (!name) continue;
    out.set(gm.person_id, [...(out.get(gm.person_id) || []), name]);
  }
  return out;
}

// person_id → Set('president' …). 그 해의 줄만 들어온다(fetchRoles가 연도로 거른다).
export function rolesByPerson(roles) {
  const out = new Map();
  for (const r of roles || []) {
    if (!out.has(r.person_id)) out.set(r.person_id, new Set());
    out.get(r.person_id).add(r.role);
  }
  return out;
}

// 화면에 붙는 직분 배지. 교역자가 먼저고 그다음이 그 해의 직분이다.
export function personBadges(person, roleSet) {
  const out = person?.is_pastor ? [PASTOR_LABEL] : [];
  for (const r of YEAR_ROLES) if (roleSet?.has(r)) out.push(ROLE_LABEL[r]);
  return out;
}

// ── 게스트 저장 자리 ────────────────────────────────────────────────────────
const cloudOn = () => !!supabase;
const { rows: guestRows, set: guestSet } = guestStore('church_roster_v1');
const guestPatch = (id, patch) => {
  const rows = guestRows('people').map(p => (p.id === id ? { ...p, ...patch } : p));
  guestSet('people', rows);
  return rows.find(p => p.id === id) || null;
};

// 게스트에서는 profiles도 여기에 있다 — 클라우드에서는 멤버 화면이 이미 읽어 둔
// cloud.listMembersAdmin()의 결과를 그대로 쓴다(같은 목록을 두 번 조회하지 않는다).
export const guestProfiles = () => guestRows('profiles');

// ── 읽기 (people.js 위에 얹는다) ────────────────────────────────────────────
// 환송한 사람도 같이 받는다 — '환송한 사람' 구역에서 되돌릴 수 있어야 한다.
export async function loadRoster(year) {
  if (!cloudOn()) {
    const people = [...guestRows('people')].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
    const suns = guestRows('groups').filter(g => g.type === 'sun' && !g.removed_at && (!g.year || g.year === year));
    const ids = new Set(suns.map(g => g.id));
    return {
      people,
      roles: guestRows('people_roles').filter(r => r.year === year),
      suns,
      groupMembers: guestRows('group_members').filter(gm => ids.has(gm.group_id)),
    };
  }
  const [people, roles, suns] = await Promise.all([
    fetchPeople({ includeRemoved: true }),
    fetchRoles(year),
    fetchGroups('sun', year),
  ]);
  const groupMembers = await fetchGroupMembers(suns.map(g => g.id));
  return { people, roles, suns, groupMembers };
}

// ── 쓰기 ────────────────────────────────────────────────────────────────────
const one = async (q) => { const { data, error } = await q; if (error) throw error; return data; };

export async function addPerson({ name, birthday = null, teams = [] }) {
  const row = { name: String(name || '').trim(), birthday: birthday || null, teams: teams || [] };
  if (!cloudOn()) {
    const made = {
      id: generateId(), is_pastor: false, profile_id: null, note: null,
      removed_at: null, created_at: new Date().toISOString(), ...row,
    };
    guestSet('people', [...guestRows('people'), made]);
    return made;
  }
  return one(supabase.from('people').insert(row).select(COLS).single());
}

// 이름·생일·팀·note만 고친다. 계정 연결·직분은 각자의 길이 따로 있다.
export async function updatePerson(id, patch) {
  const next = {};
  for (const k of ['name', 'birthday', 'teams', 'note']) if (k in patch) next[k] = patch[k];
  if (!Object.keys(next).length) return null;
  if (!cloudOn()) return guestPatch(id, next);
  return one(supabase.from('people').update(next).eq('id', id).select(COLS).single());
}

// 환송·되돌리기. 행은 지우지 않는다(출석이 매달려 있다 — 파일 머리말).
export async function setRemoved(id, removed) {
  const patch = { removed_at: removed ? new Date().toISOString() : null };
  if (!cloudOn()) return guestPatch(id, patch);
  return one(supabase.from('people').update(patch).eq('id', id).select(COLS).single());
}

// 계정 연결·해제. profileId가 null이면 해제다.
export async function linkProfile(personId, profileId) {
  const patch = { profile_id: profileId || null };
  if (!cloudOn()) return guestPatch(personId, patch);
  return one(supabase.from('people').update(patch).eq('id', personId).select(COLS).single());
}

// 교역자는 연도와 무관한 명단 속성이다(docs/V2.md §1 직분 구조).
export async function setPastor(personId, on) {
  const patch = { is_pastor: !!on };
  if (!cloudOn()) return guestPatch(personId, patch);
  return one(supabase.from('people').update(patch).eq('id', personId).select(COLS).single());
}

// 부장·회장·총무·리더순장·리더팀장은 **연도별**이다 — 임원진이 해마다 바뀐다.
export async function setYearRole(personId, year, role, on) {
  if (!YEAR_ROLES.includes(role)) throw new Error(`모르는 직분: ${role}`);
  const row = { person_id: personId, year, role };
  if (!cloudOn()) {
    const rows = guestRows('people_roles').filter(r =>
      !(r.person_id === personId && r.year === year && r.role === role));
    guestSet('people_roles', on ? [...rows, row] : rows);
    return row;
  }
  if (on) return one(supabase.from('people_roles').upsert(row).select('person_id, year, role').single());
  const { error } = await supabase.from('people_roles').delete().match(row);
  if (error) throw error;
  return null;
}
