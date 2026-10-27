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

// ── 내 쓰기가 아직 안 끝난 칸 (UX 감사 2026-10-27 · PITFALLS 70-a) ─────────────────────────────────────────
// 화면은 먼저 바뀌고 쓰기는 뒤따른다. 그런데 실시간 재조회(App.syncCard · 전체 재조회)는 **내 쓰기가 아직 서버에 안 닿은 칸**을 옛 값으로
// 읽어 온다 — 보드에서 카드를 끌어 놓으면 상태 저장의 에코가 옛 자리(position)를 들고 와 카드가 옛 칸으로 튀었다가 순서 저장이 끝나면
// 돌아왔다. 업무 창에서 칸을 빨리 두 번 바꾸면 앞 쓰기의 에코가 중간 값을 한 번 그렸다.
// 그래서 컨트롤러가 쓰기를 보낼 때 그 카드의 칸을 begin으로 적고, 쓰기가 끝나면(성공·실패) 끝내기를 부른다. 재조회는 읽기를 시작할 때
// now()를 받아 두었다가, 읽어 온 조각에서 **지금 쓰는 중이거나 읽기가 시작된 뒤에 끝난** 칸을 걷는다(mask) — 그 칸은 스토어(내가 그린 값)가
// 맞다. 읽기 도중에 끝난 쓰기는 그 읽기에 실렸는지 알 수 없어서 같이 걷는다(곧 그 쓰기의 에코가 온다).
// 걷는 것은 화면을 지키는 것뿐이다 — 실패한 쓰기는 끝내기 뒤에 부르는 쪽이 되돌린다(rollbackPatch).
export function createPendingFields() {
  let clock = 0;
  const open = new Map();   // 카드 id → Map(칸 → 쓰는 중인 수)
  const ended = new Map();  // 카드 id → Map(칸 → 마지막으로 끝난 시각(clock))
  const masked = (id, k, since) => !!open.get(id)?.get(k) || (ended.get(id)?.get(k) ?? -1) > since;
  return {
    now: () => clock,
    // 끝내기를 돌려준다 — 두 번 불러도 한 번
    begin(id, keys) {
      if (!id || !keys?.length) return () => {};
      if (!open.has(id)) open.set(id, new Map());
      const m = open.get(id);
      for (const k of keys) m.set(k, (m.get(k) || 0) + 1);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        clock++;
        if (!ended.has(id)) ended.set(id, new Map());
        for (const k of keys) {
          const n = (m.get(k) || 1) - 1;
          if (n > 0) m.set(k, n); else m.delete(k);
          ended.get(id).set(k, clock);
        }
        if (!m.size && open.get(id) === m) open.delete(id);
      };
    },
    // 서버에서 읽은 카드 조각 → 걷을 칸을 뺀 조각. local을 주면 빼는 대신 그 값을 넣는다(전체 재조회가 카드를 통째로 갈아 끼울 때).
    mask(patch, since, local = null) {
      if (!patch?.id || (!open.has(patch.id) && !ended.has(patch.id))) return patch;
      let out = null;
      for (const k of Object.keys(patch)) {
        if (k === 'id' || !masked(patch.id, k, since)) continue;
        out = out || { ...patch };
        if (local) out[k] = local[k]; else delete out[k];
      }
      return out || patch;
    },
    busy: (id) => open.has(id),
  };
}
export const pendingCardFields = createPendingFields();

// ── 목록 하나를 통째로 쓰는 토글을 줄 세우기 (UX 감사 2026-10-27 · PITFALLS 70-b) ─────────────────────────
// 동아리 모임 출석은 칩 하나를 눌러도 출석 배열 **전체**를 쓴다(groups.saveMeetingAttendance). 빨리 여러 번 누르면 쓰기가 겹쳐
// 늦게 닿은 옛 배열이 새 배열을 덮었고, 앞 쓰기가 실패하면 그 '이전 배열'로 되돌려서 뒤에 누른 것까지 지웠다.
// 열쇠(모임)마다 쓰기를 한 줄로 세우고, 쓰기는 **보낼 때의 지금 배열**(get)을 보낸다. 실패하면 **그 한 번 누른 것만** 되돌린다 —
// 그 사람의 칸이 아직 내가 누른 값일 때만(그 사이 다시 눌렀으면 둔다). 되돌린 배열은 줄의 다음 쓰기가 실어 간다.
// get(key) → 지금 배열 · set(key, arr) → 화면에 반영 · save(key, arr) → Promise · onFail(e, { key, item, on })
export function createSerialToggles({ get, set, save, onFail }) {
  const chains = new Map();
  const flip = (arr, item, on) => (on ? (arr.includes(item) ? arr : [...arr, item]) : arr.filter(x => x !== item));
  return {
    toggle(key, item) {
      const cur = get(key) || [];
      const on = !cur.includes(item);
      set(key, flip(cur, item, on));
      const run = async () => {
        try {
          await save(key, get(key) || []);
        } catch (e) {
          const now = get(key) || [];
          if (now.includes(item) === on) set(key, flip(now, item, !on));
          onFail?.(e, { key, item, on });
        }
      };
      const p = (chains.get(key) || Promise.resolve()).then(run);
      chains.set(key, p);
      return p.then(() => { if (chains.get(key) === p) chains.delete(key); });
    },
    busy: (key) => chains.has(key),
  };
}
