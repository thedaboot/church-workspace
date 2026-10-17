// ============================================================================
// 댓글 고정 · 해결 (시안 mock/b3 · v5 2묶음 '업무 편의')
// ----------------------------------------------------------------------------
// 최상위 댓글에만 붙는 두 표시. 값은 댓글 줄의 칸 넷이다 — pinnedAt·pinnedBy · resolvedAt·resolvedBy(ISO · 표시 이름).
// **지금은 스토어(게스트는 localStorage)에만 있다** — 시안이라 서버에 칸이 없다. 실제로 붙일 때 필요한 것:
//   · 0112 이후 마이그레이션: comments에 pinned_at timestamptz · pinned_by uuid · resolved_at timestamptz · resolved_by uuid
//   · 누가 바꾸나: 그 업무를 볼 수 있는 사람 누구나(댓글 쓰기와 같은 판정) — 남의 댓글 본문은 못 고치므로
//     칸 넷만 바꾸는 security definer 함수(set_comment_mark(comment_id, pinned, resolved))로 연다(행 update 정책을 넓히지 않는다)
//   · 업무 잠금(0099)이면 막는다 · 실시간 comments 갈래가 이미 그 행을 다시 읽는다 · 활동 기록 한 줄('댓글을 고정했습니다.' 꼴)은 사용자 결정
// 고정 묶음은 **고정한 차례**(먼저 고정한 것이 위) · 나머지는 원래 차례(시간 순)다.
// ============================================================================
import { store } from '../store/workspaceStore.js';

// 최상위 댓글을 고정 묶음과 나머지로 가른다(답글은 둘 다에서 빠진다 — 원 댓글을 따라간다)
export function splitPinned(comments) {
  const top = (comments || []).filter(c => !c.parentId);
  const pinned = top.filter(c => c.pinnedAt).sort((a, b) => String(a.pinnedAt).localeCompare(String(b.pinnedAt)));
  return { pinned, rest: top.filter(c => !c.pinnedAt) };
}

// 한 댓글의 표시를 바꾼 목록 — what: { pinned?: bool, resolved?: bool } · 답글이면 그대로
export function withMark(comments, id, what, by, now = new Date().toISOString()) {
  return (comments || []).map(c => {
    if (c.id !== id || c.parentId) return c;
    const next = { ...c };
    if ('pinned' in what) Object.assign(next, what.pinned ? { pinnedAt: now, pinnedBy: by } : { pinnedAt: null, pinnedBy: null });
    if ('resolved' in what) Object.assign(next, what.resolved ? { resolvedAt: now, resolvedBy: by } : { resolvedAt: null, resolvedBy: null });
    return next;
  });
}

export function markComment(cardId, id, what, by) {
  const t = store.getState().tasks.byId[cardId];
  if (!t) return;
  store.dispatch({ type: 'SYNC_TASK', payload: { id: cardId, comments: withMark(t.comments, id, what, by) } });
}
