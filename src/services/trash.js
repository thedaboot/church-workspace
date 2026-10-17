// 휴지통(시안 2026-10-16) — 지운 업무·프로젝트를 30일 동안 두고 '복원'으로 되살린다.
//
// **게스트 시안의 저장 자리다.** 브라우저 한 칸(`trash_v1`)에 지운 순간의 모습을 통째로 둔다 — 업무는 카드 하나
// (댓글·활동·첨부까지 · 스토어의 지금 카드 · §6-22), 프로젝트는 프로젝트 + 그 안의 업무 전부. 지우기 경로의
// 되돌리기 토스트·스토어 되돌리기 기록(controllers.handleDeleteTask · workspaceStore undo)은 그대로다 —
// 거기서 되살린 것은 스토어에 다시 있으므로 목록에서 저절로 빠진다(useTrashItems가 스토어를 같이 본다).
// 클라우드에는 아직 없다 — 진짜는 cards·projects의 지운 표시(deleted_at·deleted_by) + 30일 뒤 정리가 맡는다.
//
// 복원할 수 있는 사람: 지운 사람과 마스터(canRestore). 게스트는 마스터로 친다(auth의 기본값).
import { useSyncExternalStore, useMemo } from 'react';
import { store, useStore } from '../store/workspaceStore.js';
import { isCloudEnabled } from './supabaseClient.js';

const KEY = 'trash_v1';
export const TRASH_DAYS = 30;
const DAY_MS = 86400000;

const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
};
const fresh = (list, now = Date.now()) => list.filter(it => {
  const t = Date.parse(it?.deletedAt || '');
  return Number.isFinite(t) && now - t < TRASH_DAYS * DAY_MS;
});

let items = [];
let seeded = false;
const subs = new Set();
const emit = () => subs.forEach(fn => fn());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* 비공개 모드 */ } };

// ── 시연용 씨앗 — 처음 여는 게스트 화면이 비어 있지 않게 ───────────────────────────────
// 칸이 아예 없을 때만 심는다(지운 것을 다 복원해 빈 칸이 되면 다시 심지 않는다 — 그때는 빈 배열이 저장돼 있다).
// 지금 스토어의 프로젝트에 업무 셋을 걸고, 지운 프로젝트 하나(업무 둘)를 둔다. 언제 심는지는 아래 boot
// (`trash_seed`='1'이면 저장된 워크스페이스가 있어도 심는다 — 시안 화면 찍기용).
const ago = (d, h = 0) => new Date(Date.now() - d * DAY_MS - h * 3600000).toISOString();
function seedItems() {
  const st = store.getState();
  const me = st.currentUser?.name || '홍길동';
  const projects = (st.projects?.allIds || []).map(id => st.projects.byId[id]).filter(p => p && !p.archived);
  const p1 = projects[0], p2 = projects[1] || projects[0];
  const card = (id, projectId, title, extra = {}) => ({
    id, projectId, title, status: '시작 전', assignees: [], teams: [], content: '', startDate: '', dueDate: '',
    author: me, createdAt: ago(40), updatedAt: ago(3), completedAt: '', comments: [], activityLog: [], attachments: [], ...extra,
  });
  const out = [];
  if (p1) {
    out.push({ id: 'tr_seed1', kind: 'task', refId: 'seed_t1', title: '수련회 장소 답사 일정표', projectId: p1.id, projectTitle: p1.title,
      deletedAt: ago(1, 3), deletedBy: me,
      snap: card('seed_t1', p1.id, '수련회 장소 답사 일정표', { teams: ['임원진'], content: '답사 후보 두 곳 · 이동 시간 정리' }) });
    out.push({ id: 'tr_seed2', kind: 'task', refId: 'seed_t2', title: '포스터 시안 B', projectId: p1.id, projectTitle: p1.title,
      deletedAt: ago(5), deletedBy: '김하늘',
      snap: card('seed_t2', p1.id, '포스터 시안 B', { teams: ['미디어팀'], status: '진행 중' }) });
  }
  if (p2) {
    out.push({ id: 'tr_seed3', kind: 'task', refId: 'seed_t3', title: '초청 문자 문구', projectId: p2.id, projectTitle: p2.title,
      deletedAt: ago(12), deletedBy: me,
      snap: card('seed_t3', p2.id, '초청 문자 문구', { teams: ['새가족팀'], subtasks: [{ id: 'seed_s1', title: '초안', done: true }] }) });
  }
  const gp = { id: 'seed_p1', title: '2026 가을 체육대회', pinnedLinks: [], position: 99, createdAt: ago(60), year: Number(new Date().getFullYear()) };
  out.push({ id: 'tr_seed4', kind: 'project', refId: gp.id, title: gp.title, projectId: gp.id, projectTitle: gp.title,
    deletedAt: ago(20), deletedBy: '박지호',
    snap: { project: gp, tasks: [card('seed_t4', gp.id, '장소 대관 문의', { teams: ['임원진'] }), card('seed_t5', gp.id, '팀 나누기', { teams: ['임원진'] })] } });
  return out;
}

function boot() {
  if (seeded) return;
  seeded = true;
  if (isCloudEnabled()) { items = []; return; }
  const saved = read();
  // 씨앗은 **시연 데이터 게스트**(MockFactory가 채운 워크스페이스 — `demo` 표시 · 저장된 뒤에도 남는다)에게만, 메모리에만 —
  // 무언가 지우거나 복원하면 그때 같이 저장된다. 검사 스위트는 demo 없는 자기 워크스페이스를 심으므로 씨앗이 없다
  // (처음엔 '저장된 워크스페이스가 없을 때'로 갈랐는데, 시연 데이터가 첫 화면에서 곧바로 저장되면서 새로 고치면 씨앗이 사라졌다).
  let auto = !!store.getState().demo;
  try { auto = auto || localStorage.getItem('trash_seed') === '1'; } catch { /* 그대로 */ }
  if (saved == null && auto) { items = seedItems(); return; }
  items = fresh(saved || []);
  if (saved && items.length !== saved.length) save();   // 30일 지난 것은 지운다
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getSnapshot = () => { boot(); return items; };

// 지운 것 하나를 휴지통에 넣는다 — 같은 것이 이미 있으면(되돌렸다가 또 지움) 새 것 하나로.
function push(item) {
  boot();
  items = [item, ...items.filter(it => it.refId !== item.refId)];
  save(); emit();
}

export function trashTask(task, by) {
  if (!task?.id || isCloudEnabled()) return;
  const p = store.getState().projects.byId[task.projectId];
  push({ id: `tr_${task.id}_${Date.now()}`, kind: 'task', refId: task.id, title: task.title || '', projectId: task.projectId || null,
    projectTitle: p?.title || '', deletedAt: new Date().toISOString(), deletedBy: by || '', snap: task });
}

export function trashProject(project, tasks, by) {
  if (!project?.id || isCloudEnabled()) return;
  push({ id: `tr_${project.id}_${Date.now()}`, kind: 'project', refId: project.id, title: project.title || '', projectId: project.id,
    projectTitle: project.title || '', deletedAt: new Date().toISOString(), deletedBy: by || '', snap: { project, tasks: tasks || [] } });
}

export const canRestore = (item, me, isMaster) => !!isMaster || (!!me && item?.deletedBy === me);

// 되살린다 → 'ok' | 'no-project'(업무의 프로젝트가 지금 없다 — 프로젝트부터 복원해야 한다)
export function restoreTrash(item) {
  const st = store.getState();
  if (item.kind === 'project') {
    const { project, tasks = [] } = item.snap || {};
    if (project && !st.projects.byId[project.id]) store.dispatch({ type: 'ADD_PROJECT', payload: project });
    tasks.forEach(t => { if (!store.getState().tasks.byId[t.id]) store.dispatch({ type: 'UPSERT_TASK', payload: t }); });
  } else {
    if (!st.projects.byId[item.snap?.projectId]) return 'no-project';
    if (!st.tasks.byId[item.snap.id]) store.dispatch({ type: 'UPSERT_TASK', payload: item.snap });
  }
  items = items.filter(it => it.id !== item.id);
  save(); emit();
  return 'ok';
}

// 지금 휴지통에 있는 것(최근에 지운 것부터) — 스토어에 다시 있는 것(되돌리기로 살아난 것)은 뺀다
export function useTrashItems() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const projects = useStore(s => s.projects.byId);
  const tasks = useStore(s => s.tasks.byId);
  return useMemo(() => fresh(list)
    .filter(it => (it.kind === 'project' ? !projects[it.refId] : !tasks[it.refId]))
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))), [list, projects, tasks]);
}
