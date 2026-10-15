// ============================================================================
// 업무 창을 '어디를 보며' 여나 · 지금 열린 업무 (UX 다듬기 α · 2026-10-15)
// ----------------------------------------------------------------------------
// 알림 종·검색은 App의 onOpenTask/onSearchSelect로 업무 창을 연다 — 그 길은 업무 하나만 넘긴다(App.jsx는 건드리지 않는다).
// 그래서 열기 **직전에** 여기에 '이 업무는 이 댓글을 보며 열어라'를 적어 두고(setTaskFocus), 창이 열리며 읽는다
// (peekTaskFocus — 렌더에서 읽어도 되게 순수 · 지우는 것은 효과에서 clearTaskFocus). 5초가 지난 것은 버린다 —
// 적어 놓고 못 연 것(업무를 못 찾음)이 나중에 손으로 연 창에 붙지 않게.
// 창은 열릴 때·닫힐 때 noteTaskOpen을 부른다 — 알림 종이 그 업무의 안 읽은 알림을 읽음으로 하고(D4),
// 그 업무에 새 알림이 오면 토스트 없이 읽음으로 둔다(D3).
// 순수 판정(findFocusComment · notifFocusHint · wantsComments · notifArrival · easeOutQuint)은 tests/logcheck-task가 본다.
// ============================================================================

const FOCUS_TTL_MS = 5000;
let pending = null;   // { cardId, hint, at }

// hint: { kind: 'mention'|'reply'|'reaction'|'comment', commentId?, actor?, preview? }
export function setTaskFocus(cardId, hint) {
  pending = cardId && hint ? { cardId, hint, at: Date.now() } : null;
}
export function peekTaskFocus(cardId, now = Date.now()) {
  if (!pending || !cardId || pending.cardId !== cardId || now - pending.at > FOCUS_TTL_MS) return null;
  return pending.hint;
}
export function clearTaskFocus(cardId) {
  if (pending && (!cardId || pending.cardId === cardId)) pending = null;
}

// ── 지금 열린 업무 ──
let openId = null;
const openListeners = new Set();
export function noteTaskOpen(id) {
  openId = id || null;
  if (openId) openListeners.forEach(fn => { try { fn(openId); } catch (e) { console.warn('[task] 열림 알림 실패:', e); } });
}
export const openTaskId = () => openId;
export function onTaskOpen(fn) {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}

// ── 순수 판정 ──
// 댓글에서 생기는 알림만 댓글 자리로 연다. 멘션은 본문 멘션일 수도 있어서 미리보기가 댓글과 맞을 때만 댓글로 간다.
const FOCUS_KINDS = ['mention', 'reply', 'reaction'];
export function notifFocusHint(n) {
  if (!n?.card_id || !FOCUS_KINDS.includes(n.kind)) return null;
  return { kind: n.kind, actor: n.actor_name || '', preview: n.preview || '' };
}
// 찾기 전에도 댓글 칸을 펴도 되는가 — 답글·반응·댓글 검색은 늘 댓글 이야기다(멘션은 찾아야 안다)
export const wantsComments = (hint) => !!hint && (hint.kind === 'reply' || hint.kind === 'reaction' || hint.kind === 'comment');

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// 보여 줄 댓글 id. commentId가 있으면 그것(있을 때만) · 없으면 미리보기(알림은 댓글 앞 80자 · cloudSync.previewOf)로 시작하는 댓글 중
// 가장 최근 것 — 멘션·답글은 보낸 사람의 댓글을 먼저, 반응은 내 댓글이라 보낸 사람으로 거르지 않는다.
export function findFocusComment(comments, hint) {
  if (!hint || !Array.isArray(comments)) return null;
  if (hint.commentId) return comments.some(c => c?.id === hint.commentId) ? hint.commentId : null;
  const pv = flat(hint.preview);
  if (!pv) return null;
  const hits = comments.filter(c => c?.id && flat(c.text).startsWith(pv));
  const byActor = hint.kind !== 'reaction' && hint.actor ? hits.filter(c => c.author === hint.actor) : [];
  const pick = byActor.length ? byActor : hits;
  return pick.length ? pick[pick.length - 1].id : null;
}

// 실시간으로 온 새 알림 — 그 업무 창이 지금 열려 있으면 토스트 없이 읽음('quiet'), 아니면 토스트('toast')
export const notifArrival = (row, openCardId) => (row?.card_id && row.card_id === openCardId ? 'quiet' : 'toast');

// ── 움직임 ──
// 앱 곡선(index.css `--ease-out-quint` = cubic-bezier(.16, 1, .3, 1))의 JS 짝 — 스크롤 위치는 CSS 전환이 안 걸린다
export const easeOutQuint = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 5);
export const SCROLL_MS = 420;
const running = new WeakMap();
// 통(box)의 scrollTop을 top으로 — 움직임 줄이기면 바로. 같은 통의 앞선 움직임은 끊는다.
export function scrollBoxTo(box, top, { reduce = false, ms = SCROLL_MS } = {}) {
  if (!box) return;
  cancelAnimationFrame(running.get(box) || 0);
  const to = Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight));
  const from = box.scrollTop;
  if (reduce || Math.abs(to - from) < 2) { box.scrollTop = to; return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = easeOutQuint((now - t0) / ms);
    box.scrollTop = from + (to - from) * k;
    if (k < 1) running.set(box, requestAnimationFrame(step));
    else running.delete(box);
  };
  running.set(box, requestAnimationFrame(step));
}
