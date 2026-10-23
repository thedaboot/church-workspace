import { useSyncExternalStore } from 'react';
import { store } from '../store/workspaceStore.js';
import { TaskService } from './domain.js';
import { guestStore, fetchPeople, fetchRoles } from './people.js';
import { isCloudEnabled, supabase, myUid } from './supabaseClient.js';
import { passAssignees, pairRoles, graduatesOf, buildHandovers, handoverRowsView } from './handover.js';
import { LEADERS } from './visibility.js';
import { LEAD_TEAMS } from '../components/roleBadge.js';

// ============================================================================
// 인수인계의 저장 자리 — 클라우드(0109 handovers · handover_plans)와 게스트 시연(localStorage) 두 갈래
// ----------------------------------------------------------------------------
// 규칙은 services/handover.js(순수), 화면은 components/handover.jsx와 홈 카드(views/homeView.jsx).
// 화면이 보는 모양은 한 벌이다 — useHandover()의 { overrides, grads, gradTo, notes, applied, seen, origName, fixedItems }.
//
// **클라우드**(v5 1묶음 C · 2026-10-17)
//   · 마스터: 명단(사람 · 올해·다음 해 직분) + handover_plans(고침) + handovers(기록)를 읽고, 고칠 때마다 계획을 저장한 뒤
//     인계 목록(buildHandovers)을 sync_handovers로 내려 둔다 — 그래야 넘기는 사람이 자기 줄을 읽는다. 탭을 열 때도 한 번 내린다
//     (명단 탭에서 다음 해 직분을 고친 뒤).
//   · 그 밖의 사람: RLS가 주는 줄만(넘기는 사람은 자기 것 · 인수자는 적용된 자기 것) — 홈 카드가 이것을 그린다(fixedItems).
//   · 전달 사항·업무는 write_handover, 인수자의 '확인'은 see_handover. 1월 1일 적용은 아침 크론(api/push.js → apply_handovers).
//   · 표가 아직 없으면(0109 전) 읽기가 실패하고 카드·탭 내용이 안 선다(오류 화면 없음 · §3-4).
// **게스트 시연**(시안 그대로 · `handoverOn()`): localStorage 한 키(`church_handover_v1`)와 시연 씨앗 · '1월 1일에 보일 화면
//   적용해 보기' · '화면 확인' · '처음으로' · `?demo=handover`. 실제 앱(클라우드)에는 이 버튼들이 없다.
//
// 게스트 씨앗(시연이 뜻이 있게): 2026 임원·팀장 + 2027 사용자가 정한 명단 · 나가는 임원의 진행 중 업무 · 1997년생 셋.
//   · 처음 여는 브라우저(명단 열쇠가 없을 때)에 한 번 — 단 **자동화 브라우저(navigator.webdriver)는 건너뛴다**
//     (게스트 스위트가 자기 명단을 심는다 · 씨앗이 끼면 줄 수가 달라진다).
//   · 주소에 `?demo=handover`가 있으면 언제나 처음 상태로 다시 심는다(시연을 되돌리는 길).
// ============================================================================

const KEY = 'church_handover_v1';
const roster = guestStore('church_roster_v1');
export const FROM_YEAR = Math.max(new Date().getFullYear(), 2026);
export const TO_YEAR = FROM_YEAR + 1;

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
// 클라우드에서는 브라우저에 남기지 않는다(줄은 DB가 원본 · 남의 전달 사항이 기기에 남지 않게)
let snap = isCloudEnabled() ? {} : read();
const subs = new Set();
const write = (next) => {
  snap = next;
  if (!isCloudEnabled()) try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 저장소가 막힌 브라우저 */ }
  subs.forEach(f => f());
};
export const updateHandover = (fn) => write({ ...snap, ...fn(snap) });
export const useHandover = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap);
// 게스트 시연인가 — 시연 전용 버튼·씨앗은 이것이 참일 때만
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
  try { if (localStorage.getItem('church_roster_v1')) return; } catch { return; }   // 저장소가 막힌 브라우저 — 모듈 머리에서 불려 던지면 화면 조각째 못 실린다
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

// 명단 한 벌 — 게스트는 localStorage, 클라우드는 마지막으로 읽은 것(마스터는 명단 전체 · 그 밖은 줄에 붙은 사람만)
export const guestRoster = () => (handoverOn()
  ? { people: roster.rows('people'), roles: roster.rows('people_roles') }
  : (snap.roster || { people: [], roles: [] }));

// ── 고치기(화면은 이것만 부른다 · 게스트는 localStorage, 클라우드는 계획 저장 → 목록 내리기) ──────────
export const setOverride = (key, id) => change(s => ({ overrides: { ...(s.overrides || {}), [key]: id || null } }));
export const setGrads = (ids) => change(() => ({ grads: ids }));
export const setGradTo = (gid, id) => change(s => ({ gradTo: { ...(s.gradTo || {}), [gid]: id || null } }));
function change(fn) {
  if (handoverOn()) { updateHandover(fn); return Promise.resolve(); }
  return cloudPlan(fn);
}

export async function saveNote(item, note, taskIds) {
  if (handoverOn()) {
    updateHandover(s => ({ notes: { ...(s.notes || {}), [item.id]: { note, taskIds, done: true } } }));
    return;
  }
  let rowId = snap.notes?.[item.id]?.rowId;
  if (!rowId && snap.master) { await cloudSync(); rowId = snap.notes?.[item.id]?.rowId; }
  if (!rowId) throw new Error('인계 줄이 아직 없어요');
  const { data, error } = await supabase.rpc('write_handover', { p_id: rowId, p_note: note, p_tasks: taskIds });
  if (error) throw error;
  putRows((snap.rows || []).map(r => (r.id === rowId ? { ...r, ...data } : r)));
}

export async function markSeen(item) {
  if (handoverOn()) { updateHandover(s => ({ seen: { ...(s.seen || {}), [item.id]: true } })); return; }
  const rowId = snap.notes?.[item.id]?.rowId;
  if (!rowId) return;
  const { data, error } = await supabase.rpc('see_handover', { p_id: rowId });
  if (error) throw error;
  putRows((snap.rows || []).map(r => (r.id === rowId ? { ...r, seen_at: data || new Date().toISOString() } : r)));
}

// ── 클라우드 ───────────────────────────────────────────────────────────────
const ROW_COLS = '*, fp:from_person(id, name, profile_id, profiles:profile_id(display_name)), tp:to_person(id, name, profile_id, profiles:profile_id(display_name))';
const personOf = (j) => (j ? { id: j.id, name: j.profiles?.display_name?.trim() || j.name, profile_id: j.profile_id, removed_at: null } : null);

// 줄 → 화면 모양(notes · applied · seen · fixedItems) — 순수 handover.handoverRowsView(logcheck-v2가 본다)
const putRows = (rows) => write({ ...snap, rows, ...handoverRowsView(rows, TO_YEAR) });

// 지금 계획·명단으로 인계 목록을 만든다(화면의 useHandoverModel과 같은 식)
function liveItems(st = snap) {
  const roles = st.roster?.roles || [];
  // 다음 해 직분이 아직 하나도 없으면 인계할 것이 없다 — 1월에 연 앱이 FROM·TO를 한 해 앞(2027→2028)으로 잡아
  // 그해 직분자 전원에게 '받는 사람 미정' 인계 카드가 1년 내내 섰다(감사 2026-10-23)
  if (!roles.some(r => r.year === TO_YEAR)) return [];
  const people = (st.roster?.people || []).filter(p => !p.removed_at);
  const pairs = pairRoles(roles.filter(r => r.year === FROM_YEAR), roles.filter(r => r.year === TO_YEAR), st.overrides || {}, LEAD_TEAMS, { toYear: TO_YEAR });
  const grads = st.grads ?? graduatesOf(people, TO_YEAR).map(p => p.id);
  return buildHandovers(pairs, grads, st.gradTo || {});
}

async function cloudSync() {
  if (!snap.master || snap.applied) return;
  const items = liveItems().map(it => ({ from: it.from, to: it.to, slots: it.slots, graduate: it.graduate }));
  const { data, error } = await supabase.rpc('sync_handovers', { y: TO_YEAR, items });
  if (error) throw error;
  const others = (snap.rows || []).filter(r => r.year !== TO_YEAR);
  putRows([...others, ...(data || [])]);
}

async function cloudPlan(fn) {
  const next = { ...snap, ...fn(snap) };
  write(next);
  const uid = await myUid();
  const { error } = await supabase.from('handover_plans').upsert({
    year: TO_YEAR, overrides: next.overrides || {}, grads: next.grads ?? null, grad_to: next.gradTo || {},
    updated_by: uid, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  await cloudSync();
}

// 읽기 — master면 명단·계획까지. 같은 때 두 번 부르면 앞의 것을 기다린다. 실패는 snap.error로만(던지지 않는다)
let loading = null;
export function loadHandover({ master = false } = {}) {
  if (handoverOn()) return Promise.resolve();
  if (loading && (!master || loading.master)) return loading.p;
  const p = (async () => {
    try {
      const uid = await myUid();
      const rowsQ = supabase.from('handovers').select(ROW_COLS).order('created_at');
      if (!master) {
        const { data, error } = await rowsQ;
        if (error) throw error;
        const people = new Map();
        for (const r of data || []) for (const j of [r.fp, r.tp]) if (j) people.set(j.id, personOf(j));
        write({ ...snap, cloud: true, uid, master: false, loaded: true, error: null,
          roster: { people: [...people.values()], roles: [] }, rows: data || [], ...handoverRowsView(data || [], TO_YEAR) });
        return;
      }
      const [rowsRes, planRes, people, rolesFrom, rolesTo] = await Promise.all([
        rowsQ,
        supabase.from('handover_plans').select('*').eq('year', TO_YEAR).maybeSingle(),
        fetchPeople({ includeRemoved: true, withBirthYear: true }),
        fetchRoles(FROM_YEAR), fetchRoles(TO_YEAR),
      ]);
      if (rowsRes.error) throw rowsRes.error;
      if (planRes.error) throw planRes.error;
      const plan = planRes.data || {};
      write({ ...snap, cloud: true, uid, master: true, loaded: true, error: null,
        roster: { people, roles: [...rolesFrom, ...rolesTo] }, rows: rowsRes.data || [],
        overrides: plan.overrides || {}, grads: plan.grads ?? null, gradTo: plan.grad_to || {},
        ...handoverRowsView(rowsRes.data || [], TO_YEAR) });
      await cloudSync();
    } catch (e) {
      console.warn('[handover] 인수인계를 읽지 못했어요:', e?.message || e);
      write({ ...snap, cloud: true, loaded: true, error: e });
    } finally { loading = null; }
  })();
  loading = { master, p };
  return p;
}

// 내 명단 id(클라우드 = 내 계정에 이어진 사람 · 게스트 = 이름이 같은 사람)
export const myPersonIds = (people, meName) => (handoverOn()
  ? people.filter(p => p.name === meName).map(p => p.id)
  : people.filter(p => p.profile_id && p.profile_id === snap.uid).map(p => p.id));
