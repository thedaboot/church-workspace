// ============================================================================
// 업무 창의 수정 판정 — 정말 바뀐 게 있나 · 서버에 보낼 칸 · 하위 업무 셋 갈래 병합
// ----------------------------------------------------------------------------
// import 0개 — 노드 검사가 베껴 들인다(tests/_load.mjs). 부르는 쪽은 utils.js(바렐)를 문다.
// ============================================================================

// ── 업무 창에서 정말 바뀐 게 있나 (2026-09-22 사용자 요청) ──────────────────
// `닫기`를 누를 때 물어볼지 정하는 판정이다. **깃발(dirty=true)이 아니라 값을 견준다** —
// 깃발은 커서를 한 번 옮기거나 같은 값을 다시 골라도 서고, 그러면 안 고친 사람에게도
// 창이 떠서 금방 성가신 것이 된다(그렇게 되면 사람은 창을 안 읽고 누른다).
//
// 보는 칸은 **수정 폼이 실제로 고치는 것들뿐**이다. 댓글·활동·첨부는 수정 모드 밖에서
// 따로 저장되므로 여기 넣으면 남이 댓글을 달았을 때 "고쳤다"가 된다.
export const TASK_EDIT_KEYS = ['title', 'content', 'status', 'dueDate', 'startDate',
  'assignees', 'teams', 'subtasks', 'dependsOn'];

// 견주기 전에 모양을 맞춘다: 없는 값은 빈 글, 배열은 그대로(순서도 뜻이 있다 —
// 하위 업무와 담당자는 사람이 정한 차례다), 하위 업무는 id를 빼고 본다(만들 때마다
// 새로 생기는 값이라 그것까지 견주면 아무것도 안 바꿔도 다르다고 나온다).
const editShape = (v, key) => {
  if (key === 'subtasks') {
    return (Array.isArray(v) ? v : []).map(t => [t?.title || '', !!t?.done, t?.assignee || '', t?.due || '']);
  }
  if (Array.isArray(v)) return v;
  return v == null ? '' : v;
};

const editChanged = (now, was, k) =>
  JSON.stringify(editShape(now?.[k], k)) !== JSON.stringify(editShape(was?.[k], k));

// `was`는 **수정을 누른 순간의 스냅숏**이다(2026-09-25 감사 S3) — 실시간으로 바뀌는 카드와
// 견주면 남이 하위 업무를 체크한 것만으로 "고친 게 있다"가 되어 안 고친 사람에게도 창이 떴다.
export function taskEditDirty(now, was) {
  if (!now || !was) return false;
  return TASK_EDIT_KEYS.some(k => editChanged(now, was, k));
}

// ── 서버에 보낼 칸 (2026-09-28 · 바뀐 칸만 저장) ─────────────────────────────
// 저장은 예전에 카드의 모든 칸을 통째로 덮어썼다(cardPatch). 그런데 수정 모드 동안에는 실시간
// 반영을 멈춰 두었으므로(옛 App.jsx isEditingRef) 옛 병합(mergeTaskEdit — 지웠다)의 live가 '수정을 누른 순간'에 멈춰 있고,
// 그래서 **내가 안 건드린 칸까지 그 순간의 값으로 되돌렸다**(B가 바꾼 상태가 A의 제목 저장으로 풀렸다).
// 이제 저장은 이전 카드(was)에서 바뀐 칸만 보낸다 — 안 바뀐 칸은 서버의 값을 건드리지 않는다.
const SAVE_EXTRA_KEYS = ['position', 'projectId'];
export function taskChangedKeys(now, was) {
  if (!was) return null;                            // 새 업무 — 전부 보낸다
  return [...TASK_EDIT_KEYS, ...SAVE_EXTRA_KEYS].filter(k => editChanged(now, was, k));
}

// 하위 업무 셋 갈래 병합 — base(내가 보던 것) → mine(내가 고친 것), theirs(지금 서버).
// 하위 업무는 한 칸(jsonb 배열)이라 칸 단위로는 둘이 서로 다른 줄을 체크해도 한쪽이 풀린다.
// 그래서 **줄(id) 단위로** 합친다: 내가 바꾼 줄·더한 줄·지운 줄만 내 것, 나머지는 서버 것.
// 차례는 내 차례를 따르고, 서버에만 새로 생긴 줄은 뒤에 붙인다. id가 없는 옛 줄은 제목으로 가른다.
const subKey = (s) => (s?.id ? `id:${s.id}` : `t:${String(s?.title || '').trim()}`);
const subSame = (a, b) => JSON.stringify(editShape([a], 'subtasks')) === JSON.stringify(editShape([b], 'subtasks'));
export function mergeSubtasks(base, mine, theirs) {
  const B = new Map((base || []).map(s => [subKey(s), s]));
  const M = new Map((mine || []).map(s => [subKey(s), s]));
  const T = new Map((theirs || []).map(s => [subKey(s), s]));
  const out = [];
  for (const [k, m] of M) {
    const b = B.get(k), t = T.get(k);
    if (!b) { out.push(m); continue; }             // 내가 더한 줄
    if (!t) { if (!subSame(m, b)) out.push(m); continue; }   // 서버에서 지운 줄 — 내가 고쳤으면 살린다
    out.push(subSame(m, b) ? t : m);               // 내가 안 고쳤으면 서버 것
  }
  for (const [k, t] of T) if (!M.has(k) && !B.has(k)) out.push(t);   // 서버에만 새로 생긴 줄
  return out;
}
