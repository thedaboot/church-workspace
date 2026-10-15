// ============================================================================
// 먼저 그린 쓰기가 실패했을 때 되돌릴 칸 (UX 다듬기 α · 2026-10-15 · hooks/controllers.js가 쓴다)
// ----------------------------------------------------------------------------
// 컨트롤러는 화면을 먼저 바꾸고 클라우드는 뒤따른다. 예전에는 실패하면 토스트만 떠서 화면은 거짓말을 한 채
// 남았다(상태·순서·보관 · 지운 업무는 사라진 채). 실패하면 **내가 바꾼 칸만, 그 사이 아무도 다시 바꾸지 않았을 때만**
// 이전 값으로 돌린다 — 지금 값이 내가 쓴 값과 같아야 한다(그 사이 남·나의 다음 저장이 덮었으면 그대로 둔다).
// 업무 저장에서 되돌리는 칸은 '눌러서 바꾸는' 칸뿐이다. 제목·본문은 창이 들고 있는 초안·같이 쓰기 문서가 원본이라
// 스토어만 되돌리면 칸과 어긋난다(그 둘은 업무 창이 '못 간 칸'으로 기억했다가 다음 저장·'다시 시도'가 다시 보낸다 · 아래 createSaveRetry).
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

// ── 못 간 칸을 기억했다가 다시 보내기 (UX 다듬기 2차 A2 · 2026-10-15 · PITFALLS 59-b) ─────────────────────────
// 업무 창은 '바뀐 칸만' 보낸다 — 견주는 것은 **스토어의 지금 카드**다(modals.jsx commit). 그런데 저장이 실패해도 스토어에는 내가 쓴
// 값이 남아 있어서(상태·자리만 되돌린다 · 위 rollbackPatch), 다음 저장은 그 칸을 '안 바뀐 칸'으로 보고 다시 보내지 않았다 — 못 간 제목·본문이
// 화면에만 남았다가 새로 고치면 사라졌다. 그래서 실패한 칸을 **실패하기 전 값**과 같이 기억해 두고, 다음 저장(과 '다시 시도')은 그 값으로
// 견준다(begin의 base) — 바뀐 칸 셈·활동 기록·새 멘션·담당자 알림·하위 업무 셋 갈래 병합이 모두 '실패하기 전'부터 다시 센다.
// 성공하면 그 저장이 실어 간 칸만 지운다 — 이 저장보다 **나중에 시작한** 저장이 실패한 칸은 남긴다(seq).
// silent — 그 칸을 조용한 저장(본문 자동 저장 · 같이 쓰기 거울)으로 보냈었다. 본문이 그렇게 못 갔으면 다음 저장도 본문은 조용히
// 보낸다(본문 활동·멘션은 편집 세션 끝에 한 번 · controllers.handleSaveTask 머리말).
export function createSaveRetry() {
  let seq = 0;
  const failed = new Map();   // 칸 → { base, seq, silent }
  return {
    // 보내기 직전 — 견줄 카드(못 간 칸은 실패하기 전 값) · 이 저장의 번호 · 실어 가는 못 간 칸
    begin(cur) {
      const base = { ...cur };
      for (const [k, f] of failed) base[k] = f.base;
      return { seq: ++seq, base, carried: [...failed.keys()], silent: !!failed.get('content')?.silent };
    },
    // 끝났다 — keys는 이 저장이 보낸 칸. 남은 못 간 칸 수를 돌려준다
    settle(ticket, keys, ok, { silent = false } = {}) {
      if (ok) {
        for (const k of new Set([...(keys || []), ...ticket.carried])) {
          const f = failed.get(k);
          if (f && f.seq < ticket.seq) failed.delete(k);
        }
      } else {
        for (const k of keys || []) {
          const f = failed.get(k);
          failed.set(k, f ? { base: f.base, seq: Math.max(f.seq, ticket.seq), silent: f.silent || silent }
            : { base: ticket.base[k], seq: ticket.seq, silent });
        }
      }
      return failed.size;
    },
    size: () => failed.size,
    keys: () => [...failed.keys()],
  };
}

// ── 못 보낸 댓글 (UX 다듬기 2차 A1 · 2026-10-15 · PITFALLS 59-a) ─────────────────────────────────────────
// 댓글은 화면에 먼저 서고 서버가 뒤따른다(controllers.handleAddComment). 예전에는 서버 쓰기가 실패해도 보낸 것처럼 서 있다가 새로
// 고치면 말없이 사라졌다. 실패한 댓글을 여기에 업무별로 적어 두면 댓글 목록(comments.jsx)이 그 자리에 흐리게 세우고 '다시 보내기'를
// 단다. 다시 보내기는 같은 id로 다시 넣는다(cloud.addComment가 id를 그대로 쓴다 — 두 벌이 생기지 않는다). 실시간 재조회가 목록을
// 서버 것으로 갈아 끼워도 여기 적힌 것은 목록 끝에 다시 선다. 탭의 수명만 간다(새로 고치면 사라진다 — 서버에 없는 글이다).
// send — 부르는 쪽이 준 '다시 보내기'(Promise). version은 useSyncExternalStore의 스냅샷이다.
export function createFailedComments() {
  const byCard = new Map();   // 업무 id → Map(댓글 id → { comment, send, sending })
  const subs = new Set();
  let version = 0;
  const emit = () => { version++; subs.forEach(fn => { try { fn(); } catch (e) { console.warn('[comment] 구독 실패:', e); } }); };
  const entry = (cardId, id) => byCard.get(cardId)?.get(id) || null;
  const drop = (cardId, id) => {
    const m = byCard.get(cardId);
    if (!m?.delete(id)) return;
    if (!m.size) byCard.delete(cardId);
    emit();
  };
  return {
    add(cardId, comment, send) {
      if (!cardId || !comment?.id) return;
      if (!byCard.has(cardId)) byCard.set(cardId, new Map());
      byCard.get(cardId).set(comment.id, { comment, send, sending: false });
      emit();
    },
    list: (cardId) => [...(byCard.get(cardId)?.values() || [])].map(({ comment, sending }) => ({ comment, sending })),
    has: (cardId, id) => !!entry(cardId, id),
    // 다시 보내기 — 성공하면 빼고 true, 또 실패하면 그대로 두고 false. 보내는 동안 같은 것을 또 누르면 아무것도 안 한다.
    async resend(cardId, id) {
      const e = entry(cardId, id);
      if (!e || e.sending) return false;
      e.sending = true; emit();
      try {
        await e.send();
        drop(cardId, id);
        return true;
      } catch (err) {
        console.error('[cloud] 댓글 다시 보내기 실패:', err);
        if (entry(cardId, id) === e) { e.sending = false; emit(); }
        return false;
      }
    },
    drop,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    version: () => version,
  };
}
export const failedComments = createFailedComments();
