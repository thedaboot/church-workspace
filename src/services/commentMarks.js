// ============================================================================
// 댓글 고정 · 해결 (v5 2묶음 '업무 편의' · 사용자 승인 시안 mock/b3 · 0114)
// ----------------------------------------------------------------------------
// 최상위 댓글에만 붙는 두 표시. 앱의 값은 댓글 줄의 칸 넷이다 — pinnedAt·pinnedBy · resolvedAt·resolvedBy(ISO · 표시 이름).
// 클라우드는 comments.pinned_at·pinned_by·resolved_at·resolved_by(0114)를 cloudSync.commentToApp이 이 모양으로 바꾼다.
// 게스트는 스토어(localStorage)에만 있다.
//
// 누가 바꾸나(사용자 결정 2026-10-18 — DB 함수 set_comment_pin·set_comment_resolved가 같은 판정을 직접 본다)
//   고정 = 그 댓글을 쓴 사람 · 그 업무의 담당자 · 마스터 · 관리자(canPin — 화면은 버튼을 세울지만 정한다)
//   해결 = 그 업무에 댓글을 쓸 수 있는 사람 누구나 · 잠긴 업무는 둘 다 막힌다(창이 댓글 자리째 비운다)
// 바꾸기는 화면 먼저(스토어) → 서버. 실패하면 **그 댓글의 그 칸만** 되돌리고 토스트(목록 통째로 되돌리지 않는다 — 그 사이
// 실시간 재조회가 목록을 갈아 끼웠을 수 있다). 성공하면 실시간 comments 갈래가 열린 업무를 다시 읽어 서버 값으로 맞춘다.
// 활동 기록 한 줄은 남기지 않는다.
// 고정 묶음은 **고정한 차례**(먼저 고정한 것이 위) · 나머지는 원래 차례(시간 순)다.
// 위 세 함수(splitPinned · withMark · canPin)는 순수다 — tests/logcheck-dash가 import 줄을 떼고 그대로 돌린다.
// ============================================================================
import { store } from '../store/workspaceStore.js';
import { showToast } from '../components/Toast.jsx';
import { failText } from './errorText.js';
import { commentPinCloud, commentResolveCloud } from './cloudSync.js';

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

// 고정할 수 있나 — 쓴 사람 · 업무 담당자 · 마스터 · 관리자(이름 대조는 댓글 수정·삭제의 '내 댓글' 판정과 같다 · 서버가 최종)
export function canPin({ comment, assignees = [], me = '', isMaster = false, isAdmin = false }) {
  if (!comment || comment.parentId) return false;
  if (isMaster || isAdmin) return true;
  return !!me && (comment.author === me || (assignees || []).includes(me));
}

const FAIL = {
  pinOn: '댓글을 고정하지 못했어요',
  pinOff: '고정을 해제하지 못했어요',
  resolveOn: '해결로 바꾸지 못했어요',
  resolveOff: '미해결로 바꾸지 못했어요',
};
const KEYS = ['pinnedAt', 'pinnedBy', 'resolvedAt', 'resolvedBy'];

// 화면 먼저 → (클라우드면) 서버. cloud가 거짓이면 게스트 — 스토어만.
export function markComment(cardId, id, what, by, { cloud = false } = {}) {
  const t = store.getState().tasks.byId[cardId];
  if (!t) return;
  const before = (t.comments || []).find(c => c.id === id);
  if (!before || before.parentId) return;
  store.dispatch({ type: 'SYNC_TASK', payload: { id: cardId, comments: withMark(t.comments, id, what, by) } });
  if (!cloud) return;
  const pin = 'pinned' in what;
  const on = pin ? !!what.pinned : !!what.resolved;
  (pin ? commentPinCloud(id, on) : commentResolveCloud(id, on)).catch((e) => {
    console.error('[cloud] 댓글 표시를 바꾸지 못했습니다:', e);
    // 그 댓글의 그 칸만 옛 값으로(지금 스토어 목록 위에서)
    const live = store.getState().tasks.byId[cardId];
    if (live) {
      const keys = pin ? KEYS.slice(0, 2) : KEYS.slice(2);
      const back = (live.comments || []).map(c => (c.id === id ? { ...c, ...Object.fromEntries(keys.map(k => [k, before[k] ?? null])) } : c));
      store.dispatch({ type: 'SYNC_TASK', payload: { id: cardId, comments: back } });
    }
    showToast(failText(FAIL[`${pin ? 'pin' : 'resolve'}${on ? 'On' : 'Off'}`], e));
  });
}
