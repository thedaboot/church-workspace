// ============================================================================
// 휴지통(0104 · 사용자 승인 시안 2026-10-17) — 지운 업무·프로젝트를 30일 동안 두고 '복원'으로 되살린다.
// ----------------------------------------------------------------------------
// 규칙(30일 · 복원할 수 있는 사람 · 줄 모양)은 services/trashItems.js 한 벌이다.
//
// **클라우드**: 원본은 DB다(cards·projects의 deleted_at·deleted_by — 0104). 지우기는 controllers·projectView가
//   cloudSync.cardTrashCloud·projectTrashCloud를 부르고, 여기는 휴지통 줄(trash_list)을 들고 있다가 복원(restore_card·
//   restore_project)한다. 줄은 처음 볼 때 · 내가 지운 뒤 · 창을 열 때 · 남이 지웠다는 알림(broadcast)을 받을 때 다시 읽는다.
//   복원하면 그 업무·프로젝트를 다시 읽어 스토어에 얹는다(App이 setTrashReload로 넘긴 재조회 — 첨부·댓글까지).
// **게스트**: 브라우저 한 칸(`trash_v1`)에 지운 순간의 모습을 통째로 둔다(업무는 카드 하나 · 프로젝트는 프로젝트 + 안의 업무).
//   검사 스위트가 이 길을 탄다. 시연 씨앗은 없다(시안 브랜치에만 있었다).
// 지우기 경로의 되돌리기 토스트·스토어 되돌리기(controllers.handleDeleteTask)는 그대로다 — 거기서 되살린 것은 스토어에 다시
// 있으므로 목록에서 저절로 빠진다(useTrashItems가 스토어를 같이 본다).
// ============================================================================
import { useSyncExternalStore, useMemo, useEffect } from 'react';
import { store, useStore } from '../store/workspaceStore.js';
import { isCloudEnabled } from './supabaseClient.js';
import { fresh, itemFromSnap } from './trashItems.js';
import * as cloudSync from './cloudSync.js';

export { TRASH_DAYS, canRestore } from './trashItems.js';

const KEY = 'trash_v1';

const readGuest = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
};
const saveGuest = () => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* 비공개 모드 */ } };

let items = [];
let booted = false;
const subs = new Set();
const emit = () => subs.forEach(fn => fn());

function boot() {
  if (booted) return;
  booted = true;
  if (isCloudEnabled()) { refreshTrash(); return; }
  const saved = readGuest();
  items = fresh(saved);
  if (items.length !== saved.length) saveGuest();   // 30일 지난 것은 지운다
}

// 클라우드 줄을 다시 읽는다. 겹쳐 부르면 마지막 것만 앉는다. 못 읽으면 지난 줄을 그대로 둔다(입구가 깜빡이지 않게).
let readSeq = 0;
export function refreshTrash() {
  if (!isCloudEnabled()) return Promise.resolve();
  const seq = ++readSeq;
  return cloudSync.trashListCloud()
    .then(list => { if (seq === readSeq) { items = list; emit(); } })
    .catch(e => console.warn('[trash] 휴지통 읽기 실패:', e?.message || e));
}

// 복원한 뒤 스토어를 채우는 길 — App이 넘긴다(클라우드 전체 재조회). 없으면 다음 재조회 때 따라온다.
let reloadAfterRestore = null;
export function setTrashReload(fn) {
  reloadAfterRestore = fn;
  return () => { if (reloadAfterRestore === fn) reloadAfterRestore = null; };
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getSnapshot = () => { boot(); return items; };

// ── 게스트: 지운 순간의 모습을 넣는다(클라우드는 DB가 표시한다 — 부르지 않는다) ───────────
function push(item) {
  boot();
  items = [item, ...items.filter(it => it.refId !== item.refId)];
  saveGuest(); emit();
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

// 되살린다 → 'ok' | 'no-project'(업무의 프로젝트가 휴지통에 있다 — 프로젝트부터 복원해야 한다). 클라우드 실패는 던진다.
export async function restoreTrash(item) {
  if (isCloudEnabled()) {
    const r = await cloudSync.restoreTrashCloud(item.kind, item.refId);
    if (r === 'no-project') return r;
    items = items.filter(it => it.id !== item.id);
    emit();
    await reloadAfterRestore?.();
    refreshTrash();
    return 'ok';
  }
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
  saveGuest(); emit();
  return 'ok';
}

// 지금 휴지통에 있는 것(최근에 지운 것부터) — 스토어에 다시 있는 것(되돌리기로 살아난 것 · 남이 복원한 것)은 뺀다.
// 줄은 화면 모양(teams · taskCount)으로 고쳐 준다.
export function useTrashItems() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const projects = useStore(s => s.projects.byId);
  const tasks = useStore(s => s.tasks.byId);
  return useMemo(() => fresh(list)
    .filter(it => (it.kind === 'project' ? !projects[it.refId] : !tasks[it.refId]))
    .map(it => (it.snap ? itemFromSnap(it) : it))
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))), [list, projects, tasks]);
}

// 창을 열 때 한 번 더 읽는다(남이 지운 것 · 30일이 지난 것)
export function useTrashRefresh() {
  useEffect(() => { refreshTrash(); }, []);
}
