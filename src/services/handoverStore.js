import { useSyncExternalStore } from 'react';
import { store } from '../store/workspaceStore.js';
import { TaskService } from './domain.js';
import { guestStore } from './people.js';
import { isCloudEnabled } from './supabaseClient.js';
import { passAssignees } from './handover.js';
import { LEADERS } from './visibility.js';

// ============================================================================
// 인수인계(가칭) 시안의 저장 자리 — **게스트 전용**(2026-10-16 · 마이그레이션 없음)
// ----------------------------------------------------------------------------
// 규칙은 services/handover.js(순수), 화면은 components/handover.jsx와 홈 카드(views/homeView.jsx).
// 여기는 localStorage 한 키(`church_handover_v1`)와 시연용 시드뿐이다. 클라우드에서는 아무것도 하지 않는다.
//
// 시드(시연이 뜻이 있게): 2026 임원·팀장 + 2027 사용자가 정한 명단 · 나가는 임원의 진행 중 업무 · 1997년생 셋.
//   · 처음 여는 브라우저(명단 열쇠가 없을 때)에 한 번 — 단 **자동화 브라우저(navigator.webdriver)는 건너뛴다**
//     (게스트 스위트가 자기 명단을 심는다 · 시드가 끼면 줄 수가 달라진다).
//   · 주소에 `?demo=handover`가 있으면 언제나 처음 상태로 다시 심는다(시연을 되돌리는 길).
// '1월 1일 적용'은 시연용 버튼이 흉내 낸다 — 고른 업무의 담당자를 바꾸고, 받는 사람 홈에 카드가 선다.
// '받는 사람 화면 확인'는 게스트 currentUser 이름을 그 사람으로 바꿔 홈을 연다(되돌리기는 같은 판의 '처음으로').
// ============================================================================

const KEY = 'church_handover_v1';
const roster = guestStore('church_roster_v1');
export const FROM_YEAR = Math.max(new Date().getFullYear(), 2026);
export const TO_YEAR = FROM_YEAR + 1;

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
let snap = read();
const subs = new Set();
const write = (next) => {
  snap = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 저장소가 막힌 브라우저 */ }
  subs.forEach(f => f());
};
export const updateHandover = (fn) => write({ ...snap, ...fn(snap) });
export const useHandover = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap);
export const handoverOn = () => !isCloudEnabled();

// ── 시드 ────────────────────────────────────────────────────────────────────
const P = (id, name, birth_year, teams = [], gender = null) => ({
  id: `hv-${id}`, name, birthday: null, birth_year, teams, gender, is_pastor: false, profile_id: null,
  note: null, removed_at: null, created_at: '2026-01-04T00:00:00Z',
});
const PEOPLE = [
  P('osj', '오세진', 1988, [], 'm'),
  P('yde', '윤다은', 1999, ['웰컴팀'], 'f'),
  P('msy', '문서연', 1997, [], 'f'),
  P('jmk', '정민경', 1998, ['순장'], 'f'),
  P('bhw', '배현우', 1998, ['미디어팀'], 'm'),
  P('smj', '송미정', 1984, [], 'f'),
  // 팀장은 그 팀의 소속(팀원)으로 두지 않는다(사용자 결정 2026-10-16 · handover.seatsValid)
  P('njs', '노준석', 2000, [], 'm'),
  P('cyn', '최유나', 1997, [], 'f'),
  P('kyj', '김윤주', 2001, [], 'f'),
  P('hjm', '한지민', 1999, [], 'f'),
  P('jhr', '조해리', 2000, [], 'f'),
  P('cjy', '천진영', 1999, ['순장'], 'f'),
  P('lhb', '이하빈', 2002, [], 'f'),
  P('pjh', '박지호', 2001, [], 'm'),
  P('kdy', '강도윤', 1997, ['미디어팀'], 'm'),
  P('lsj', '이서준', 1996, ['찬양팀'], 'm'),
  P('swh', '서우현', 2003, ['웰컴팀'], 'm'),
];
const R = (id, year, role, team) => ({ person_id: `hv-${id}`, year, role, ...(team ? { team } : {}) });
const ROLES = (y0, y1) => [
  R('osj', y0, 'director'), R('yde', y0, 'president'), R('msy', y0, 'treasurer'),
  R('jmk', y0, 'lead_sunjang'), R('bhw', y0, 'lead_team'), R('smj', y0, 'vision_maker'),
  R('njs', y0, 'team_lead', '찬양팀'), R('cyn', y0, 'team_lead', '워십팀'),
  R('kyj', y0, 'team_lead', '엔지니어팀'), R('hjm', y0, 'team_lead', '미디어팀'),
  // 다음 해 — 사용자가 정한 명단(부장·비전 메이커 미정 · 리더팀장은 고르지 않는다 · 순장 미선출)
  R('jmk', y1, 'president'), R('jhr', y1, 'treasurer'), R('cjy', y1, 'lead_sunjang'),
  R('njs', y1, 'team_lead', '찬양팀'), R('lhb', y1, 'team_lead', '워십팀'),
  R('kyj', y1, 'team_lead', '엔지니어팀'), R('pjh', y1, 'team_lead', '기획팀'),
];
const TASKS = [
  ['임원', '2027 임원 수련회 장소 알아보기', '진행 중', '윤다은', '2026-12-20'],
  ['임원', '새가족 환영회 일정 정리', '시작 전', '윤다은', '2026-12-27'],
  ['임원', '10월 임원 회의 정리', '완료', '윤다은', '2026-10-10'],
  ['회계', '12월 회계 결산', '진행 중', '문서연', '2026-12-31'],
  ['회계', '교회 카드 영수증 정리', '보류 중', '문서연', '2026-12-15'],
  ['임원', '2027 순 편성 초안', '진행 중', '정민경', '2026-12-13'],
  ['임원', '팀장 모임 회의록 정리', '시작 전', '배현우', '2026-11-30'],
  ['성탄', '성탄 워십 안무 연습', '진행 중', '최유나', '2026-12-20'],
  ['성탄', '청년부 사진 아카이브 정리', '진행 중', '강도윤', '2026-12-31'],
];
const PROJECTS = { 임원: `${FROM_YEAR} 임원 업무`, 회계: `${FROM_YEAR} 회계`, 성탄: `${FROM_YEAR} 성탄 예배` };

function seed() {
  const names = new Set(roster.rows('people').map(p => p.name));
  roster.set('people', [...roster.rows('people'), ...PEOPLE.filter(p => !names.has(p.name))]);
  // 같은 이름이 이미 있으면 그 사람의 id로 줄을 단다
  const idOf = new Map(roster.rows('people').map(p => [p.name, p.id]));
  const byHv = new Map(PEOPLE.map(p => [p.id, idOf.get(p.name) || p.id]));
  const keep = roster.rows('people_roles').filter(r => r.year !== FROM_YEAR && r.year !== TO_YEAR);
  roster.set('people_roles', [...keep, ...ROLES(FROM_YEAR, TO_YEAR).map(r => ({ ...r, person_id: byHv.get(r.person_id) }))]);
  // 태어난 해가 비어 있는 같은 이름의 사람에게 시드의 해를 얹는다
  roster.set('people', roster.rows('people').map(p => {
    const s = PEOPLE.find(x => x.name === p.name);
    return s && !p.birth_year ? { ...p, birth_year: s.birth_year } : p;
  }));

  // 업무 — 프로젝트 셋(임원·회계는 리더만 보기)과 진행 중 업무. 시드한 것만 다시 심는다(seedIds)
  const st = store.getState();
  const old = new Set(snap.seedIds || []);
  const projects = { byId: { ...st.projects.byId }, allIds: st.projects.allIds.filter(id => !old.has(id)) };
  const tasks = { byId: { ...st.tasks.byId }, allIds: st.tasks.allIds.filter(id => !old.has(id)) };
  for (const id of old) { delete projects.byId[id]; delete tasks.byId[id]; }
  const seedIds = [];
  const pid = {};
  let pos = Math.max(0, ...Object.values(projects.byId).map(p => p.position ?? 0));
  for (const [k, title] of Object.entries(PROJECTS)) {
    const id = `hv-proj-${k}`;
    pid[k] = id; seedIds.push(id);
    projects.byId[id] = { id, title, pinnedLinks: [], position: ++pos, createdAt: '2026-01-04T00:00:00Z', year: FROM_YEAR,
      ...(k === '성탄' ? {} : { visibility: LEADERS }) };
    projects.allIds.push(id);
  }
  TASKS.forEach(([k, title, status, who, due], i) => {
    const t = { ...TaskService.create({ projectId: pid[k], title, status, assignees: [who], teams: [], content: '', dueDate: due }, who), id: `hv-task-${i}` };
    seedIds.push(t.id);
    tasks.byId[t.id] = t;
    tasks.allIds.push(t.id);
  });
  store.dispatch({ type: 'LOAD_STATE', payload: { ...st, projects, tasks } });
  try { localStorage.setItem('church_app_v4', JSON.stringify(store.getState())); } catch { /* 위와 같다 */ }
  const name = snap.origName || st.currentUser?.name || '';
  write({ v: 1, seeded: true, seedIds, overrides: {}, grads: null, gradTo: {}, notes: {}, applied: null, seen: {}, origName: null });
  if (name) store.dispatch({ type: 'UPDATE_USER', payload: { name } });
}

export function ensureHandoverDemo() {
  if (!handoverOn() || typeof window === 'undefined') return;
  let force = false;
  try { force = new URLSearchParams(window.location.search).get('demo') === 'handover'; } catch { /* 옛 브라우저 */ }
  if (force) {
    seed();
    // 주소의 표식은 한 번만 — 새로 고칠 때마다 시연이 처음으로 돌아가지 않게
    try { const u = new URL(window.location.href); u.searchParams.delete('demo'); window.history.replaceState(window.history.state, '', u); } catch { /* 위와 같다 */ }
    return;
  }
  if (snap.seeded || navigator.webdriver) return;
  if (localStorage.getItem('church_roster_v1')) return;
  seed();
}

// ── 1월 1일 적용(시연) ──────────────────────────────────────────────────────
// items: 화면이 만든 인계 목록 · nameOf: id → 이름 · 업무 담당자를 바꾸고 무엇을 바꿨는지 남긴다(처음으로 되돌릴 때)
export function applyHandover(items, nameOf) {
  const st = store.getState();
  const moves = [];
  for (const it of items) {
    if (!it.to) continue;
    for (const tid of snap.notes?.[it.id]?.taskIds || []) {
      const t = st.tasks.byId[tid];
      if (!t) continue;
      moves.push({ id: tid, before: t.assignees || [] });
      store.dispatch({ type: 'UPSERT_TASK', payload: { ...t, assignees: passAssignees(t.assignees, nameOf(it.from), nameOf(it.to)), updatedAt: new Date().toISOString() } });
    }
  }
  updateHandover(() => ({ applied: { at: new Date().toISOString(), items, moves }, seen: {} }));
}

export function resetHandover() {
  const st = store.getState();
  for (const m of snap.applied?.moves || []) {
    const t = st.tasks.byId[m.id];
    if (t) store.dispatch({ type: 'UPSERT_TASK', payload: { ...t, assignees: m.before } });
  }
  if (snap.origName) store.dispatch({ type: 'UPDATE_USER', payload: { name: snap.origName } });
  updateHandover(() => ({ applied: null, seen: {}, origName: null }));
}

// 받는/나가는 사람 화면 확인 — 게스트 currentUser 이름만 바꾼다(권한은 게스트라 그대로)
export function viewAs(name) {
  const cur = store.getState().currentUser?.name || '';
  updateHandover(s => ({ origName: s.origName ?? cur }));
  store.dispatch({ type: 'UPDATE_USER', payload: { name } });
}
export function viewBack() {
  if (snap.origName != null) store.dispatch({ type: 'UPDATE_USER', payload: { name: snap.origName } });
  updateHandover(() => ({ origName: null }));
}

// 명단 한 벌(게스트) — 홈 카드가 이름·직분을 읽는다
export const guestRoster = () => ({ people: roster.rows('people'), roles: roster.rows('people_roles') });
