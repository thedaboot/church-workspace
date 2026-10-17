// ============================================================================
// 프로젝트 '표' · '간트' 보기의 순수 규칙 (시안 mock/b3 · v5 2묶음 '업무 편의')
// ----------------------------------------------------------------------------
// import가 없다 — 노드에서 그대로 돈다(tests/logcheck-dash). 화면은 components/taskTable.jsx · components/gantt.jsx.
//
// 표: 칸(열) 목록 · 정렬(빈 값은 방향과 상관없이 언제나 맨 아래 — '마감 미정'이 오름차순 맨 위에 서면
//     가장 급한 줄이 밀려난다) · 걸러내기(상태 · 담당자 — 팀은 프로젝트 화면의 팀 칩이 이미 거른다).
// 간트: 업무 기간(시작일이 없으면 마감일 하루 · 달력과 같은 규칙) · 데스크톱 범위(달 단위 — 첫 업무가 선
//     달 1일 ~ 마지막 업무가 끝나는 달 말일, 오늘이 늘 안에) · 폰 4주 창(주일 시작 · 한 주씩 민다) ·
//     띠 자리(창 밖으로 걸친 쪽은 잘렸다고 표시) · 선행 업무 잇는 선(두 띠가 다 창 안에 있을 때만).
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

// ── 간트 ──────────────────────────────────────────────────────────────────
const DAY = 86400000;
const toT = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fromT = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (iso, n) => fromT(toT(iso) + n * DAY);
export const diffDays = (a, b) => Math.round((toT(b) - toT(a)) / DAY);   // b - a
const isIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// 업무 기간 — 달력(calendar.jsx spanOf)과 같다: 시작일이 없으면 마감일 하루 · 뒤집혀 있으면 바로 세운다
export function ganttSpan(t) {
  const end = isIso(t?.dueDate) ? t.dueDate : (isIso(t?.startDate) ? t.startDate : null);
  const start = isIso(t?.startDate) ? t.startDate : end;
  if (!end) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

// 간트에 서는 업무(기간이 있는 것 · 상시 제외)를 시작일 → 마감일 → 원래 차례로
export function ganttRows(tasks) {
  return (tasks || [])
    .map((t, i) => ({ t, i, s: ganttSpan(t) }))
    .filter(r => r.s && r.t.status !== '상시')
    .sort((a, b) => ko(a.s.start, b.s.start) || ko(a.s.end, b.s.end) || a.i - b.i)
    .map(r => ({ task: r.t, ...r.s }));
}

// 데스크톱 범위 — 달 단위. 업무가 없으면 이번 달 하나.
export function ganttRange(rows, today) {
  let lo = today, hi = today;
  for (const r of rows || []) { if (r.start < lo) lo = r.start; if (r.end > hi) hi = r.end; }
  const from = `${lo.slice(0, 7)}-01`;
  const y = +hi.slice(0, 4), m = +hi.slice(5, 7);
  const to = fromT(Date.UTC(y, m, 0));   // 그 달 말일
  return { from, to, days: diffDays(from, to) + 1 };
}

// 폰 4주 창 — 그 날이 든 주의 주일부터 28일
export const WINDOW_DAYS = 28;
export function weekStart(iso) {
  const wd = new Date(toT(iso)).getUTCDay();
  return addDays(iso, -wd);
}

// 띠 자리 — 창(from부터 days일) 안에 걸치는 줄만. left·width는 날 칸 단위.
export function placeBars(rows, from, days) {
  const last = addDays(from, days - 1);
  const out = [];
  (rows || []).forEach((r, row) => {
    if (r.end < from || r.start > last) return;
    const left = Math.max(0, diffDays(from, r.start));
    const right = Math.min(days - 1, diffDays(from, r.end));
    out.push({ ...r, row, left, width: right - left + 1, clipL: r.start < from, clipR: r.end > last });
  });
  return out;
}

// 선행 업무 잇는 선 — 선행(앞)의 끝 → 이 업무의 시작. 두 띠가 다 창 안에 있고 잘리지 않은 쪽끼리만.
export function depLinks(bars) {
  const byId = new Map(bars.map(b => [b.task.id, b]));
  const out = [];
  for (const b of bars) {
    for (const pid of b.task.dependsOn || []) {
      const p = byId.get(pid);
      if (!p || p.clipR || b.clipL) continue;
      out.push({ from: p, to: b });
    }
  }
  return out;
}
