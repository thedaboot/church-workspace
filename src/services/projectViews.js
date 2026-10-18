// ============================================================================
// 프로젝트 '표' 보기의 순수 규칙 (v5 2묶음 '업무 편의' · 사용자 승인 시안 mock/b3 · 2026-10-18)
// ----------------------------------------------------------------------------
// import가 없다 — 노드에서 그대로 돈다(tests/logcheck-dash). 화면은 components/taskTable.jsx.
// 간트는 뺐다(사용자 결정 2026-10-18 — 캘린더가 같은 일을 한다).
//
// 표: 칸(열) 목록 · 정렬(빈 값은 방향과 상관없이 언제나 맨 아래 — '마감 미정'이 오름차순 맨 위에 서면
//     가장 급한 줄이 밀려난다) · 걸러내기(상태 · 담당자 — 팀은 프로젝트 화면의 팀 칩이 이미 거른다).
// ============================================================================

// 표의 칸 — [열쇠, 머리 글자]. 제목은 언제나 첫 칸이고 고를 수 없다(폰은 제목 + 고른 두 칸).
export const TABLE_COLS = [
  ['title', '제목'],
  ['status', '상태'],
  ['teams', '팀'],
  ['assignees', '담당자'],
  ['startDate', '시작일'],
  ['dueDate', '마감일'],
  ['subtasks', '하위 업무'],
];
export const PHONE_COL_CHOICES = TABLE_COLS.filter(([k]) => k !== 'title').map(([k]) => k);
export const PHONE_COLS_DEFAULT = ['assignees', 'dueDate'];

const STATUS_ORDER = ['시작 전', '진행 중', '보류 중', '완료', '상시'];
const ko = (a, b) => String(a).localeCompare(String(b), 'ko');

// 정렬 값 — null이면 '값 없음'(언제나 맨 아래)
export function sortValue(t, key) {
  switch (key) {
    case 'title': return String(t?.title || '').trim() || null;
    case 'status': { const i = STATUS_ORDER.indexOf(t?.status); return i < 0 ? null : i; }
    case 'teams': return (t?.teams || [])[0] || null;
    case 'assignees': return (t?.assignees || [])[0] || null;
    case 'startDate': case 'dueDate': return /^\d{4}-\d{2}-\d{2}$/.test(String(t?.[key] || '')) ? t[key] : null;
    case 'subtasks': {
      const list = t?.subtasks || [];
      if (!list.length) return null;
      return list.filter(s => s.done).length / list.length;
    }
    default: return null;
  }
}

// 안정 정렬(같은 값은 원래 차례 — 보드의 position 순) · 빈 값은 맨 아래
export function sortTasks(list, key, dir = 'asc') {
  const rows = (list || []).map((t, i) => ({ t, i, v: sortValue(t, key) }));
  const sign = dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    if (a.v == null && b.v == null) return a.i - b.i;
    if (a.v == null) return 1;
    if (b.v == null) return -1;
    const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : ko(a.v, b.v);
    return c ? c * sign : a.i - b.i;
  });
  return rows.map(r => r.t);
}

// 같은 칸을 다시 누르면 오름 → 내림 → 정렬 없음(보드 차례)
export function nextSort(cur, key) {
  if (!cur || cur.key !== key) return { key, dir: 'asc' };
  if (cur.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

// 걸러내기 — 빈 목록은 '전부'. 담당자 없음은 '' 하나로 고른다.
export function filterTasks(list, { statuses = [], assignees = [] } = {}) {
  return (list || []).filter(t => {
    if (statuses.length && !statuses.includes(t.status)) return false;
    if (assignees.length) {
      const a = t.assignees || [];
      if (!(a.length ? a.some(n => assignees.includes(n)) : assignees.includes(''))) return false;
    }
    return true;
  });
}

// 이 목록에 나오는 담당자(이름순) — 담당자 없는 업무가 있으면 맨 뒤에 ''
export function assigneesOf(list) {
  const set = new Set();
  let none = false;
  for (const t of list || []) {
    const a = t.assignees || [];
    if (!a.length) none = true;
    a.forEach(n => set.add(n));
  }
  return [...[...set].sort(ko), ...(none ? [''] : [])];
}
