// ============================================================================
// 먼저 그린 쓰기가 실패했을 때 되돌릴 칸 (UX 다듬기 α · 2026-10-15 · hooks/controllers.js가 쓴다)
// ----------------------------------------------------------------------------
// 컨트롤러는 화면을 먼저 바꾸고 클라우드는 뒤따른다. 예전에는 실패하면 토스트만 떠서 화면은 거짓말을 한 채
// 남았다(상태·순서·보관 · 지운 업무는 사라진 채). 실패하면 **내가 바꾼 칸만, 그 사이 아무도 다시 바꾸지 않았을 때만**
// 이전 값으로 돌린다 — 지금 값이 내가 쓴 값과 같아야 한다(그 사이 남·나의 다음 저장이 덮었으면 그대로 둔다).
// 업무 저장에서 되돌리는 칸은 '눌러서 바꾸는' 칸뿐이다. 제목·본문은 창이 들고 있는 초안·같이 쓰기 문서가 원본이라
// 스토어만 되돌리면 칸과 어긋난다(그 둘은 다음 저장이 다시 보낸다).
// ============================================================================

export const ROLLBACK_KEYS = ['status', 'position'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// wrote — 내가 보낸 카드 · prev — 보내기 전 카드 · live — 지금 스토어의 카드. 돌릴 칸이 없으면 null.
export function rollbackPatch({ wrote, prev, live, keys = ROLLBACK_KEYS }) {
  if (!wrote?.id || !prev || !live) return null;
  const patch = {};
  for (const k of keys) {
    if (same(wrote[k], prev[k])) continue;      // 바꾸지 않은 칸
    if (!same(live[k], wrote[k])) continue;     // 그 사이 다른 값이 들어왔다
    patch[k] = prev[k];
  }
  return Object.keys(patch).length ? { id: wrote.id, ...patch } : null;
}

// ── 지운 업무를 잠깐 붙들기 (PITFALLS 54-b) ─────────────────────────────────────────
// 업무를 지우면 화면에서는 바로 빠지고 '되돌리기' 토스트가 뜬다 — 서버 삭제(run)는 ms 뒤에 보낸다. 되돌리면(cancel) 아무것도
// 보내지 않은 셈이다. 붙들고 있는 동안:
//   · 스토어를 지켜보다 그 업무가 다시 들어오면(실시간 카드 1건 SYNC_TASK · 전체 재조회 LOAD_STATE — 서버에는 아직 있다) 바로 다시
//     뺀다. 스토어 알림은 같은 흐름에서 차례로 불리고 리액트는 그 뒤에 그리므로 되살아난 모습이 그려지지 않는다.
//     구독은 붙든 것이 있을 때만 붙어 있다.
//   · 페이지를 떠나면(pagehide) 붙든 것을 바로 보낸다(flush).
// store는 workspaceStore 모양(getState · subscribe · dispatch)이면 된다 — 노드 검사가 가짜를 넣는다(tests/logcheck-task).
export function createDeleteHold({ store, ms, win = typeof window !== 'undefined' ? window : null }) {
  const pending = new Map();   // 업무 id → { timer, run }
  let unguard = null;
  const flush = () => { for (const id of [...pending.keys()]) commit(id); };
  const guard = () => {
    if (unguard) return;
    const unsub = store.subscribe(() => {
      const byId = store.getState().tasks.byId;
      for (const id of pending.keys()) if (byId[id]) store.dispatch({ type: 'DELETE_TASK', payload: id });
    });
    win?.addEventListener('pagehide', flush);
    unguard = () => { unsub(); win?.removeEventListener('pagehide', flush); unguard = null; };
  };
  // 붙든 것을 놓는다 — 붙들고 있었으면 true
  const cancel = (id) => {
    const p = pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    pending.delete(id);
    if (!pending.size) unguard?.();
    return true;
  };
  function commit(id) {
    const p = pending.get(id);
    if (!p || !cancel(id)) return;
    p.run();
  }
  return {
    hold(id, run) {
      cancel(id);
      pending.set(id, { timer: setTimeout(() => commit(id), ms), run });
      guard();
    },
    cancel,
    flush,
    has: (id) => pending.has(id),
    get guarded() { return !!unguard; },
  };
}
