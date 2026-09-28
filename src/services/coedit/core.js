// ============================================================================
// 업무 본문 같이 쓰기 — **전송·저장과 무관한 순수 부분** (tests/coedit가 노드에서 돌린다)
// ----------------------------------------------------------------------------
// 전체 그림(0084 · services/coedit/index.js가 이것들을 잇는다):
//   · 문서 = Yjs 문서 하나. 두 칸이다:
//       `FIELD` 조각     편집기에 보이는 본문(Collaboration 확장이 여기에 붙는다)
//       `ACTIONS` 배열   '청년별 담당 업무' 항목(Y.Map 하나에 한 줄 · 안정된 id) — 편집기에는
//                        안 보이는 도막이라(actionItems.stripActionSection) 따로 둔다. 부품이
//                        마크다운을 거치지 않고 줄 단위로 고친다(addAction·updateAction·removeAction).
//     마크다운으로는 `fullMarkdown` = writeActionSection(본문, 항목) — 업무 창이 지금 저장하는 모양과 같다.
//   · 사람 사이 = Supabase Realtime Broadcast 비공개 채널 `coedit:<cardId>` — 여기서는
//     `send(event, payload)` 하나로만 본다(createPeer). 이벤트 넷:
//       u  내 편집(50ms씩 모아 Y.mergeUpdates) · s1 내 상태 벡터("내게 없는 것을 달라")
//       s2 s1에 대한 답(그 벡터 이후의 차이) · aw 커서·이름(y-protocols awareness)
//   · 남기기 = 추가만 하는 기록(`card_doc_updates`, 1초씩 모아 한 줄) + 스냅샷(`card_docs`).
//     여기서는 `store` 인터페이스로만 본다(createPersister · loadDoc) — 실제 것은 store.js.
//     **모든 쓰기는 다시 보내도 안전하다**: 기록·판은 클라이언트가 만든 열쇠(uuid)를 달고 가서
//     같은 열쇠는 DB가 한 번만 받는다(on conflict do nothing). 시간 초과 뒤 다시 보내면 **같은
//     덩어리를 같은 열쇠로** 보낸다(createBatcher) — 새 편집과 섞어 새 열쇠로 보내면 기록이 겹친다.
//   · 마크다운 거울 = 내가 고친 뒤 2초 조용하면 `cards.description`으로(createMirror) — 마지막으로
//     비춘 글과 같으면 쓰지 않는다. 같은 문서면 누가 비춰도 **같은 글자**다(docToMd가 결정적이다).
//     뷰어·AI·검색·알림은 여전히 그 글을 읽는다 — 같이 쓰기는 **편집하는 동안의 원본**일 뿐이다.
//
// 인코딩: 업데이트는 **base64 글자**로 다닌다(채널 JSON · DB text 칸 모두). 이유는 0084 머리말.
// ============================================================================
import * as Y from 'yjs';
import { encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON, updateYFragment, ySyncPluginKey } from '@tiptap/y-tiptap';
import { mdToDoc, docToMd } from '../markdown.js';
import { stripActionSection, parseActionItems, writeActionSection } from '../actionItems.js';

// Collaboration 확장의 기본 조각 이름 — 편집기(index.js)와 심기가 같은 이름을 써야 한다
export const FIELD = 'default';
export const ACTIONS = 'actions';
// 트랜잭션 출처 — 이 둘이 아니면 **내 편집**이다(편집기의 ySyncPluginKey · 되돌리기 관리자 등)
export const REMOTE = Symbol('coedit-remote');   // 채널로 받은 것
export const DB = Symbol('coedit-db');           // DB에서 읽은 것(스냅샷·기록·심기)
export const isLocal = (origin) => origin !== REMOTE && origin !== DB;

// 불러올 때 기록이 이보다 많으면 스냅샷으로 접는다(card_doc_compact)
export const COMPACT_ROWS = 50;
export const shouldCompact = (rowCount) => rowCount > COMPACT_ROWS;

export const newKey = () => globalThis.crypto.randomUUID();

// ── base64 ↔ 바이트 ─────────────────────────────────────────────────────────
// btoa/atob는 브라우저와 노드(16+) 둘 다 있다. String.fromCharCode(...큰 배열)은 스택을
// 넘기므로 잘라서 잇는다.
export function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
// 아무것도 담지 않은 업데이트([0,0]) — 보낼 까닭이 없다
const isEmptyUpdate = (u) => !u || u.length <= 2;

// ── 담당 업무 항목(Y.Array<Y.Map>) ───────────────────────────────────────────
// 칸은 parseActionItems가 돌려주는 그대로 + id. names는 배열 값 하나로 통째 바꾼다(한 줄의
// 사람 목록을 둘이 동시에 고치는 일은 드물고, 그때는 나중 것이 이긴다 — 줄 단위 병합은 된다).
const ITEM_FIELDS = ['names', 'name', 'what', 'dueText', 'dueDate', 'raw'];
const sameVal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function itemMap(item) {
  const m = new Y.Map();
  m.set('id', item.id || newKey());
  for (const k of ITEM_FIELDS) if (item[k] !== undefined) m.set(k, item[k]);
  return m;
}
function patchMap(m, patch) {
  for (const k of ITEM_FIELDS) if (k in patch && !sameVal(m.get(k), patch[k])) m.set(k, patch[k]);
}
const actionsOf = (ydoc) => ydoc.getArray(ACTIONS);
const indexOfId = (arr, id) => arr.toArray().findIndex(m => m.get('id') === id);

export const readActions = (ydoc) => actionsOf(ydoc).toArray().map(m => m.toJSON());
export function addAction(ydoc, item, index = null, origin = undefined) {
  const id = item.id || newKey();
  ydoc.transact(() => {
    const arr = actionsOf(ydoc);
    arr.insert(index == null ? arr.length : Math.max(0, Math.min(index, arr.length)), [itemMap({ ...item, id })]);
  }, origin);
  return id;
}
export function updateAction(ydoc, id, patch, origin = undefined) {
  let hit = false;
  ydoc.transact(() => {
    const arr = actionsOf(ydoc);
    const i = indexOfId(arr, id);
    if (i >= 0) { patchMap(arr.get(i), patch); hit = true; }
  }, origin);
  return hit;
}
export function removeAction(ydoc, id, origin = undefined) {
  let hit = false;
  ydoc.transact(() => {
    const arr = actionsOf(ydoc);
    const i = indexOfId(arr, id);
    if (i >= 0) { arr.delete(i, 1); hit = true; }
  }, origin);
  return hit;
}
// 목록 통째로 — **id가 같은 줄은 칸만 고친다**(그 줄을 남이 동시에 고친 것이 살아남는다).
// id가 없는 항목은 새 줄이다. 순서도 맞춘다(Y.Array에는 옮기기가 없어 지우고 다시 넣는다).
export function replaceActions(ydoc, items, origin = undefined) {
  ydoc.transact(() => {
    const arr = actionsOf(ydoc);
    const want = (items || []).map(it => ({ ...it, id: it.id || newKey() }));
    const keep = new Set(want.map(w => w.id));
    for (let i = arr.length - 1; i >= 0; i--) if (!keep.has(arr.get(i).get('id'))) arr.delete(i, 1);
    want.forEach((w, i) => {
      const cur = i < arr.length ? arr.get(i) : null;
      if (cur && cur.get('id') === w.id) { patchMap(cur, w); return; }
      const j = indexOfId(arr, w.id);
      if (j >= 0) { const old = arr.get(j).toJSON(); arr.delete(j, 1); arr.insert(i, [itemMap({ ...old, ...w })]); }
      else arr.insert(i, [itemMap(w)]);
    });
  }, origin);
}

// ── 마크다운 ↔ Yjs ──────────────────────────────────────────────────────────
// 심기: 마크다운 → (본문: 도막을 걷은 글 → 편집기 문서 → 조각) + (항목: parseActionItems → 배열).
// **스키마는 편집기와 같은 것**(services/editorSchema.bodySchema) — 다르면 편집기가 심은 노드를 버린다.
export function seedState(markdown, schema) {
  const md = String(markdown ?? '');
  const doc = prosemirrorJSONToYDoc(schema, mdToDoc(stripActionSection(md)), FIELD);
  const items = parseActionItems(md);
  if (items.length) replaceActions(doc, items);
  return Y.encodeStateAsUpdate(doc);
}
export const docJSON = (ydoc) => yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(FIELD));
export const docMarkdown = (ydoc) => docToMd(docJSON(ydoc));
// 저장하는 모양 그대로(본문 + 맨 아래 담당 업무 도막) — 거울·판이 이것을 쓴다
export const fullMarkdown = (ydoc) => writeActionSection(docMarkdown(ydoc), readActions(ydoc));

// 통째로 갈기 — AI 다듬기 · '이 버전으로 되돌리기'. **한 트랜잭션**이라 남에게는 편집 한 번으로
// 퍼지고, 출처를 편집기와 같은 ySyncPluginKey로 달아서 Collaboration의 되돌리기(UndoManager —
// 그 출처만 따라간다)에서 **한 걸음**으로 물릴 수 있다. 조각은 통째로 지우지 않고 달라진 곳만
// 고친다(updateYFragment) — 남이 같은 순간 치던 문단이 그대로면 그 사람의 커서가 안 튄다.
// 항목은 줄 내용이 같으면 그 줄(id)을 살린다.
export function replaceAll(ydoc, markdown, schema, origin = ySyncPluginKey) {
  const md = String(markdown ?? '');
  const node = schema.nodeFromJSON(mdToDoc(stripActionSection(md)));
  const before = readActions(ydoc);
  const items = parseActionItems(md).map(it => {
    const same = before.find(b => b.what === it.what && sameVal(b.names, it.names));
    return same ? { ...it, id: same.id } : it;
  });
  ydoc.transact(() => {
    updateYFragment(ydoc, ydoc.getXmlFragment(FIELD), node, { mapping: new Map(), isOMark: new Map() });
    replaceActions(ydoc, items);
  }, origin);
}

// ── 줄 차이 셈 — 판 목록의 `2줄 추가 · 1줄 제거` ──────────────────────────────
// 같은 앞·뒤를 걷고 가운데를 LCS로 잰다. 본문은 길어야 수백 줄이라 충분하다 — 너무 크면
// (가운데가 2000×2000 넘게) 줄 모음의 차이로 어림한다(순서는 안 보지만 셈은 틀리지 않는다).
export function lineDiffCounts(before, after) {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');
  if (before === '' || before == null) a.length = 0;
  if (after === '' || after == null) b.length = 0;
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const x = a.slice(s, ea), y = b.slice(s, eb);
  if (!x.length || !y.length) return { added: y.length, removed: x.length };
  let common;
  if (x.length * y.length > 4_000_000) {
    const bag = new Map();
    for (const l of x) bag.set(l, (bag.get(l) || 0) + 1);
    common = 0;
    for (const l of y) { const n = bag.get(l) || 0; if (n) { common++; bag.set(l, n - 1); } }
  } else {
    let prev = new Array(y.length + 1).fill(0);
    for (let i = 1; i <= x.length; i++) {
      const cur = new Array(y.length + 1).fill(0);
      for (let j = 1; j <= y.length; j++) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      prev = cur;
    }
    common = prev[y.length];
  }
  return { added: y.length - common, removed: x.length - common };
}

// ── 모아 보내기 ─────────────────────────────────────────────────────────────
// 업데이트를 `delay`ms 모아 Y.mergeUpdates 한 덩어리로 **봉하고**(열쇠 하나) `flush(update, key)`로
// 넘긴다. flush가 거절하면(false를 돌려주거나 던지면) **그 덩어리를 그 열쇠 그대로** 쥐고 있다가
// 다시 보낸다 — 시간 초과는 '안 들어갔다'가 아니라 '모른다'라서, 새 편집과 섞어 새 열쇠로 보내면
// 이미 들어간 것이 한 번 더 들어간다. 그사이 새 편집은 다음 덩어리가 된다. 덩어리는 차례대로 간다.
export function createBatcher({ delay, flush, timers = globalThis, makeKey = newKey }) {
  let pending = [];
  const sealed = [];
  let timer = null;
  let running = null;
  const seal = () => {
    if (!pending.length) return;
    sealed.push({ key: makeKey(), update: pending.length === 1 ? pending[0] : Y.mergeUpdates(pending) });
    pending = [];
  };
  const schedule = (ms) => { if (!timer) timer = timers.setTimeout(() => { timer = null; run(); }, ms); };
  const run = () => (running ||= (async () => {
    seal();
    while (sealed.length) {
      const head = sealed[0];
      let ok = false;
      try { ok = (await flush(head.update, head.key)) !== false; } catch (e) { console.warn('[coedit] 보내기 실패 — 같은 덩어리를 다시 보낸다:', e); }
      if (!ok) { schedule(delay * 3); return; }
      sealed.shift();
      seal();
    }
  })().finally(() => { running = null; }));
  return {
    push(u) { pending.push(u); schedule(delay); },
    // 지금 바로(창 닫기·끝내기) — 도는 중이면 그것이 끝난 뒤 남은 것까지
    async flush() {
      if (timer) { timers.clearTimeout(timer); timer = null; }
      await run();
      if (pending.length) await run();
    },
    get size() { return pending.length + sealed.length; },
    cancel() { if (timer) timers.clearTimeout(timer); timer = null; pending = []; sealed.length = 0; },
  };
}

// ── 사람 사이(전송 무관) ────────────────────────────────────────────────────
// send(event, payload)는 채널 쪽이 준다. 받은 것은 receive(event, payload)로 넣는다.
// hello()는 **채널에 붙을 때마다**(처음·다시 붙음) 부른다 — 끊긴 사이의 차이를 서로 채운다.
export function createPeer({ ydoc, awareness, send, throttleMs = 50, awarenessMs = 200, timers = globalThis }) {
  const out = createBatcher({ delay: throttleMs, timers, flush: (u) => { send('u', { u: toB64(u) }); } });
  const onUpdate = (u, origin) => { if (isLocal(origin)) out.push(u); };
  ydoc.on('update', onUpdate);

  // 커서는 선택이 바뀔 때마다 움직여서 그대로 보내면 채널 한도(초당 메시지)를 먼저 먹는다 —
  // 내 상태만 `awarenessMs`에 한 번, 마지막 것만 보낸다.
  let awTimer = null;
  const sendAwareness = () => {
    awTimer = null;
    send('aw', { u: toB64(encodeAwarenessUpdate(awareness, [ydoc.clientID])) });
  };
  const onAwareness = ({ added, updated, removed }, origin) => {
    if (origin === REMOTE) return;
    const mine = [...added, ...updated, ...removed].includes(ydoc.clientID);
    if (mine && !awTimer) awTimer = timers.setTimeout(sendAwareness, awarenessMs);
  };
  awareness?.on('update', onAwareness);

  const sv = () => ({ sv: toB64(Y.encodeStateVector(ydoc)) });
  return {
    hello() { send('s1', { ...sv(), reply: true }); if (awareness) sendAwareness(); },
    receive(event, payload) {
      try {
        if (event === 'u' || event === 's2') Y.applyUpdate(ydoc, fromB64(payload.u), REMOTE);
        else if (event === 's1') {
          const diff = Y.encodeStateAsUpdate(ydoc, fromB64(payload.sv));
          if (!isEmptyUpdate(diff)) send('s2', { u: toB64(diff) });
          // 새로 온 사람에게는 내 벡터도 준다 — 그 사람이 끊긴 채 쓴 것을 내가 받는다
          if (payload.reply) { send('s1', { ...sv(), reply: false }); if (awareness) sendAwareness(); }
        } else if (event === 'aw' && awareness) applyAwarenessUpdate(awareness, fromB64(payload.u), REMOTE);
      } catch (e) {
        console.warn('[coedit] 받은 메시지를 적용하지 못했어요:', event, e);
      }
    },
    // 지금 바로 — 모아 둔 편집과 커서(떠난다는 알림 포함)를 같이
    flush() {
      if (awTimer) { timers.clearTimeout(awTimer); sendAwareness(); }
      return out.flush();
    },
    destroy() {
      ydoc.off('update', onUpdate);
      awareness?.off('update', onAwareness);
      if (awTimer) timers.clearTimeout(awTimer);
      out.cancel();
    },
  };
}

// ── DB에서 불러오기 ─────────────────────────────────────────────────────────
// store 인터페이스(store.js가 Supabase로 구현 · 검사는 메모리로):
//   snapshot(cardId) → { state, upto } | null
//   rowsAfter(cardId, upto) → [{ id, data }]   (id 오름차순)
//   seed(cardId, stateB64) → true(내 것이 스냅샷이 됐다) | false(누가 먼저 심었다)
//   append(cardId, dataB64, key) · addVersion(cardId, { md, added, removed }, key)   — key = 클라이언트 uuid,
//     같은 key는 한 번만 들어간다(다시 보내도 안전)
//   compact(cardId, upto, stateB64) → true | false(이미 그만큼 접혀 있다 — upto는 앞으로만 간다)
//
// **두 번 심기 막기**: 스냅샷도 기록도 없으면 마크다운에서 심는데, 둘이 동시에 처음 열면
// 둘 다 심는다 — 그러면 같은 글이 두 벌(서로 다른 clientID의 삽입)로 합쳐져 본문이 두 번 찍힌다.
// 그래서 심은 것을 **먼저 스냅샷으로 넣어 보고**(on conflict do nothing) 이긴 쪽만 쓴다.
// 진 쪽은 자기 것을 버리고 이긴 쪽을 다시 읽는다.
export async function loadDoc({ ydoc, store, cardId, markdown, schema, seed = true }) {
  const snap = await store.snapshot(cardId);
  const rows = await store.rowsAfter(cardId, snap?.upto ?? 0);
  if (!snap && !rows.length && seed) {
    const state = seedState(markdown, schema);
    if (await store.seed(cardId, toB64(state))) {
      Y.applyUpdate(ydoc, state, DB);
      return { upto: 0, rowCount: 0, seeded: true };
    }
    return loadDoc({ ydoc, store, cardId, markdown, schema, seed: false });
  }
  // 한 트랜잭션으로 — 편집기가 중간 모양을 그리지 않게
  ydoc.transact(() => {
    if (snap) Y.applyUpdate(ydoc, fromB64(snap.state), DB);
    for (const r of rows) Y.applyUpdate(ydoc, fromB64(r.data), DB);
  }, DB);
  const upto = rows.length ? rows[rows.length - 1].id : (snap?.upto ?? 0);
  return { upto, rowCount: rows.length, seeded: false };
}

// ── 내 편집을 기록으로 ──────────────────────────────────────────────────────
// **내 것만** 남긴다 — 받은 것은 보낸 사람이 남긴다. 보낸 사람이 남기기 전에 떠나 버린
// 경우는 index.js가 '누가 떠나면 남은 사람 중 하나가 지금 상태를 기록 한 줄로 남긴다'로 메운다.
export function createPersister({ ydoc, store, cardId, delay = 1000, timers = globalThis, makeKey }) {
  const b = createBatcher({ delay, timers, makeKey, flush: (u, key) => store.append(cardId, toB64(u), key) });
  const onUpdate = (u, origin) => { if (isLocal(origin)) b.push(u); };
  ydoc.on('update', onUpdate);
  return {
    flush: () => b.flush(),
    get pending() { return b.size; },
    destroy() { ydoc.off('update', onUpdate); },
  };
}

// ── 마크다운 거울 + 판(version) ─────────────────────────────────────────────
// 내 편집이 있고 `idleMs` 조용하면 onMirror(md) — **마지막으로 비춘 글과 같으면 안 쓴다**.
// 받은 편집만 있는 사람은 쓰지 않는다(쓴 사람이 쓴다). 한 **편집 세션**은 첫 편집부터
// `sessionMs` 조용할 때까지이고, 끝날 때 세션 시작 때의 글과 달라졌으면
// onVersion({ startMd, endMd, added, removed }) 한 번 — 화면은 이것으로 **새 멘션만** 알리고
// (cloudSync.newMentionsOnly(endMd, startMd)) 활동 기록을 세션당 한 줄 남긴다. md는 fullMarkdown
// (본문 + 담당 업무 도막)이다.
// 세션 시작 글은 **첫 편집이 적용되기 직전**에 잰다(beforeTransaction) — 그 사이에 받은
// 남의 편집은 시작 글에 들어가 있어서, 내 세션의 판이 남의 글 때문에 서지 않는다.
export function createMirror({ ydoc, onMirror, onVersion, idleMs = 2000, sessionMs = 60000, timers = globalThis, markdownOf = fullMarkdown }) {
  let mirrored = markdownOf(ydoc);
  let sessionStart = null;           // null = 세션 밖
  let idleT = null, sessionT = null;
  const mirror = () => {
    idleT = null;
    const md = markdownOf(ydoc);
    if (md !== mirrored) { mirrored = md; onMirror?.(md); }
  };
  const endSession = () => {
    sessionT = null;
    if (idleT) { timers.clearTimeout(idleT); mirror(); }
    if (sessionStart === null) return;
    const md = markdownOf(ydoc);
    const start = sessionStart;
    sessionStart = null;
    if (md !== start) onVersion?.({ startMd: start, endMd: md, ...lineDiffCounts(start, md) });
  };
  const before = (tr) => {
    if (sessionStart === null && isLocal(tr.origin)) sessionStart = markdownOf(ydoc);
  };
  const after = (tr) => {
    if (!isLocal(tr.origin) || !tr.changed.size) return;
    if (idleT) timers.clearTimeout(idleT);
    idleT = timers.setTimeout(mirror, idleMs);
    if (sessionT) timers.clearTimeout(sessionT);
    sessionT = timers.setTimeout(endSession, sessionMs);
  };
  ydoc.on('beforeTransaction', before);
  ydoc.on('afterTransaction', after);
  return {
    // 창을 닫을 때 — 남은 거울과 판을 지금 쓴다
    flush() { if (sessionT) timers.clearTimeout(sessionT); endSession(); },
    get inSession() { return sessionStart !== null; },
    destroy() {
      ydoc.off('beforeTransaction', before);
      ydoc.off('afterTransaction', after);
      if (idleT) timers.clearTimeout(idleT);
      if (sessionT) timers.clearTimeout(sessionT);
    },
  };
}

// 누가 떠났을 때 지금 상태를 남길 사람 — 남은 사람 중 clientID가 가장 작은 한 사람(모두가 같은
// 답을 내므로 따로 정하지 않아도 한 사람만 쓴다)
export const isCompactor = (myId, clientIds) => [...clientIds].every(id => id >= myId);
