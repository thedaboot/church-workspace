// ============================================================================
// 휴지통 규칙 한 벌(0104 · import 0 — 앱 services/trash.js · 서버 api/_trash.js · tests/logcheck-live가 같이 본다)
// ----------------------------------------------------------------------------
//   TRASH_DAYS          30일 — DB의 trash_list와 아침 정리(purgeTrash)가 같은 값이다
//   fresh(list, now)    30일 안의 줄만
//   canRestore(...)     '복원' 버튼 — 지운 사람과 마스터만(DB restore_card·restore_project와 같은 판정)
//   itemsFromRows(...)  DB trash_list 줄 → 화면 줄(게스트 localStorage 줄과 같은 모양)
//   isMissingRpc(err)   함수가 아직 없는 DB(0104 전)인가 — 지우기는 예전 행 삭제로, 휴지통은 빈 채로 떨어진다
//   dropTrashed(...)    서버 키로 통째로 읽은 원본에서 휴지통 것을 걷는다(위키·다붓이·임베딩·마감 알림)
//   purgePlan(...)      30일 지난 것 — 지울 프로젝트 · 업무 · 첨부 행과 드라이브 정리 차례
//
// 화면 줄 모양: { id, kind: 'task'|'project', refId, title, projectId, projectTitle, deletedAt, deletedBy(이름),
//   deletedById(클라우드만), teams(업무), taskCount(프로젝트), snap(게스트만 — 되살릴 모습) }
// ============================================================================

export const TRASH_DAYS = 30;
const DAY_MS = 86400000;

export const fresh = (list, now = Date.now()) => (list || []).filter(it => {
  const t = Date.parse(it?.deletedAt || '');
  return Number.isFinite(t) && now - t < TRASH_DAYS * DAY_MS;
});

// me: 내 이름(게스트) · myIds: 내 계정 id들(클라우드 — 합친 계정의 두 id) · isMaster
// 클라우드 줄은 id로만 본다(이름이 같은 두 사람을 가르지 못한다) · 게스트 줄은 이름으로
export function canRestore(item, { me = '', myIds = [], isMaster = false } = {}) {
  if (isMaster) return true;
  if (!item) return false;
  if (item.deletedById) return myIds.filter(Boolean).includes(item.deletedById);
  return !!me && item.deletedBy === me;
}

// rows: trash_list() 줄 · nameOf: 계정 id → 표시 이름(합친 계정은 남긴 이름)
export function itemsFromRows(rows, nameOf = () => '') {
  return (rows || []).map(r => {
    const kind = r.kind === 'project' ? 'project' : 'task';
    return {
      id: `${kind}:${r.id}`, kind, refId: r.id, title: r.title || '',
      projectId: r.project_id || null, projectTitle: r.project_title || '',
      deletedAt: r.deleted_at || '', deletedBy: (r.deleted_by && nameOf(r.deleted_by)) || '', deletedById: r.deleted_by || null,
      teams: kind === 'task' ? (r.teams || []) : [], taskCount: kind === 'project' ? Number(r.task_count) || 0 : 0,
    };
  });
}

// 게스트 줄(지운 순간의 모습을 통째로 든다) → 화면 줄
export function itemFromSnap(it) {
  if (!it) return it;
  const isProject = it.kind === 'project';
  return { ...it, teams: isProject ? [] : (it.snap?.teams || []), taskCount: isProject ? (it.snap?.tasks || []).length : 0 };
}

// PostgREST: 스키마 캐시에 없는 함수 PGRST202 · Postgres: 42883(undefined_function)
export const isMissingRpc = (err) => ['PGRST202', '42883'].includes(String(err?.code || ''));
// 칸이 아직 없다(0104 전) — 서버 키 경로가 '거를 것 없음'으로 받는다
export const isMissingColumn = (err) => ['42703', 'PGRST204'].includes(String(err?.code || ''));

// trashed: { projects: Set, cards: Set } — 지운 프로젝트 · 따로 지운 업무
// 업무는 자기 표시나 프로젝트 표시로 빠지고, 댓글·첨부는 빠진 업무를 따라간다(첨부의 project_id만 있는 줄은 프로젝트로).
export function dropTrashed({ projects = [], cards = [], comments = [], files = [] } = {}, trashed = null) {
  const tp = trashed?.projects || new Set();
  const tc = trashed?.cards || new Set();
  if (!tp.size && !tc.size) return { projects, cards, comments, files, gone: new Set() };
  const gone = new Set(cards.filter(c => tc.has(c.id) || tp.has(c.project_id)).map(c => c.id));
  return {
    projects: projects.filter(p => !tp.has(p.id)),
    cards: cards.filter(c => !gone.has(c.id)),
    comments: comments.filter(c => !gone.has(c.card_id)),
    files: files.filter(f => !(f.card_id ? gone.has(f.card_id) : tp.has(f.project_id))),
    gone,
  };
}

// 30일 지난 것의 정리 차례(서버 키 · api/_trash.js가 읽고 지운다)
//   projects: [{ id, deleted_at, drive_folder_id }] · cards: [{ id, project_id, deleted_at, drive_folder_id }] — 지운 것과 그 프로젝트 안의 것
//   → { projectIds, cardIds(따로 지울 업무 — 지울 프로젝트 안의 것은 cascade가 맡는다), fileCardIds(첨부 행을 모을 업무 전부),
//       projectFolders: [{ projectId, folderId, cardFolders: [{ cardId, folderId }] }], cardFolders: [{ cardId, folderId }] }
export function purgePlan({ projects = [], cards = [] } = {}, now = Date.now(), days = TRASH_DAYS) {
  const cut = now - days * DAY_MS;
  const old = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) && t <= cut; };
  const dueProjects = projects.filter(p => old(p.deleted_at));
  const pset = new Set(dueProjects.map(p => p.id));
  const inProject = cards.filter(c => pset.has(c.project_id));
  const alone = cards.filter(c => !pset.has(c.project_id) && old(c.deleted_at));
  return {
    projectIds: [...pset],
    cardIds: alone.map(c => c.id),
    fileCardIds: [...inProject, ...alone].map(c => c.id),
    projectFolders: dueProjects.map(p => ({
      projectId: p.id, folderId: p.drive_folder_id || null,
      cardFolders: inProject.filter(c => c.project_id === p.id).map(c => ({ cardId: c.id, folderId: c.drive_folder_id || null })),
    })),
    cardFolders: alone.map(c => ({ cardId: c.id, folderId: c.drive_folder_id || null })),
  };
}
