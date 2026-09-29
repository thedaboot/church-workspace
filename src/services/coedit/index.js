// ============================================================================
// 업무 본문 같이 쓰기 — 여는 곳 하나 (0084 · 순수 부분은 core.js)
// ----------------------------------------------------------------------------
// **업무 창이 여는 곳은 modals/coedit.jsx의 useCoedit 하나다**(2026-09-28). 모양:
//
//   const { openCoedit } = await import('../services/coedit/index.js');   // 늦게 — yjs가 첫 화면에 안 실린다
//   const co = await openCoedit({ cardId, user: { id, name, color: '#rrggbb' }, markdown: task.content,
//     onMirror: (md) => …조용한 저장(handleSaveTask silentContent — 활동·멘션 없음),
//     onVersion: ({ startMd, endMd }) => …세션 끝 한 번(handleContentSession — 활동 한 줄 · 새 멘션만) });
//   <MarkdownEditor collab={co.collab} … />       // value는 무시된다 · 문서는 co.ydoc이 원본
//   co.actions.read() / add(item) / update(id, patch) / remove(id) / replace(items)   // 담당 업무 부품
//   co.replaceAll(md)       // AI 다듬기 · '이 버전으로 되돌리기' — 한 트랜잭션 · 되돌리기 한 걸음
//   // 닫을 때: 편집기를 먼저 내리고 co.destroy()(업무 창은 한 박자 미룬다)
//
// awareness의 내 상태(2026-09-29 · 보기/수정 나눔): `user`({ id, name, color, avatar } — 열자마자 싣는다, 보기 화면에는
// 편집기가 없다) · `editing`(업무 창이 수정 화면일 때만 true — 창이 싣는다) · `line`(커서가 선 마크다운 줄 — 편집기
// 확장이 싣는다 · 초점이 없으면 null) · `cursor`(이름표 커서 — y-tiptap). 보는 쪽은 view.facesFrom으로 읽는다.
//
// onMirror는 **기존 저장 길**로 보내야 한다(바뀐 칸만 · 실시간 반영이 그 길에 붙어 있다). 마지막으로 비춘
// 글과 같으면 부르지 않는다. 판(card_doc_versions)은 여기서 직접 넣고(줄 수 셈 포함), onVersion은
// 화면이 멘션·활동을 세션당 한 번 하라고 부른다.
//
// `divergedAtOpen` — 열 때 description과 Yjs 문서의 글이 달랐나(심었다 읽은 모양끼리 — core.normalizeMarkdown).
// 같이 쓰기 밖의 길(옛 앱을 아직 쓰는 사람)이 description을 고치면 Yjs가 모르고, 다음 거울이 그것을 덮는다.
// 업무 창은 `adoptCheck(cards.updated_at)`이 참일 때만 한 번 `replaceAll(description)`로 받아들인다(아래 · useCoedit).
//
// 순서(0084 설계): 채널에 먼저 붙고 → DB(스냅샷 + 그 뒤 기록)를 읽고 → 둘 다 되면 hello.
// 채널이 먼저인 까닭은 읽는 사이에 남이 쓴 것을 놓치지 않기 위해서다(받은 것은 그대로 적용 —
// Yjs는 앞 조각이 아직 없으면 기다렸다가 붙인다).
//
// 다시 붙으면(SUBSCRIBED가 또 오면) DB를 한 번 더 읽고 hello를 다시 한다. 폰이 잠든 사이에
// 남이 쓰고 **떠나 버렸으면** 채널로는 받을 길이 없고 DB에만 있기 때문이다 — 그걸 안 읽고
// 거울을 쓰면 남의 글이 빠진 마크다운으로 description을 덮는다.
// ============================================================================
import * as Y from 'yjs';
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { Extension } from '@tiptap/core';
import { supabase as defaultClient } from '../supabaseClient.js';
import { bodySchema } from '../editorSchema.js';
import {
  FIELD, ACTIONS, REMOTE, toB64, newKey, createPeer, createPersister, createMirror, loadDoc, shouldCompact, isCompactor,
  fullMarkdown, normalizeMarkdown, caretLine, readActions, addAction, updateAction, removeAction, replaceActions, replaceAll,
} from './core.js';
import { supabaseStore } from './store.js';

export const coeditTopic = (cardId) => `coedit:${cardId}`;

// '버전 기록' 탭 — 판 목록만 읽는다(같이 쓰기를 열지 않아도 된다)
export const loadVersions = (cardId, client = defaultClient) => supabaseStore(client).versions(cardId);
const EVENTS = ['u', 's1', 's2', 'aw'];

// 채널 — 비공개(0084의 realtime.messages 정책) · 내 것은 안 받는다(self: false)
// **나간 사람은 채널 presence로 안다**(2026-09-29 두 사람 실측) — awareness는 30초 동안 소식이 없어야 사람을 지워서,
// 고치던 사람이 브라우저를 끄거나 폰을 잠그면 `수정 중`이 32초 남았다. presence는 소켓이 끊기는 순간 서버가
// leave를 보낸다 → 그 clientID의 awareness를 바로 지운다. 다시 붙으면 hello·다음 awareness 소식이 되살린다.
function channelProvider({ client, topic, onMessage, onSubscribed, presenceKey, onLeave }) {
  const ch = client.channel(topic, { config: { private: true, broadcast: { self: false }, presence: { key: String(presenceKey) } } });
  for (const event of EVENTS) ch.on('broadcast', { event }, ({ payload }) => onMessage(event, payload));
  ch.on('presence', { event: 'leave' }, ({ key }) => { const id = Number(key); if (Number.isFinite(id)) onLeave?.(id); });
  let status = 'INIT';
  let warned = false;
  const start = async () => {
    // 비공개 채널은 소켓에 로그인 토큰이 실려 있어야 붙는다
    try { await client.realtime.setAuth(); } catch (e) { console.warn('[coedit] 실시간 인증 실패:', e); }
    ch.subscribe((s, err) => {
      status = s;
      if (s === 'SUBSCRIBED') { ch.track({ at: Date.now() }).catch?.(() => {}); onSubscribed(); }
      else if ((s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') && !warned) {
        // 정책(0084)이 없거나 승인 전이면 여기로 온다 — 혼자 쓰기와 저장은 그대로 된다
        warned = true;
        console.warn(`[coedit] 채널 ${topic}: ${s}`, err || '');
      }
    });
  };
  start();
  return {
    get status() { return status; },
    send(event, payload) {
      if (status !== 'SUBSCRIBED') return;          // 안 붙었으면 버린다 — 다시 붙을 때 hello가 메운다
      ch.send({ type: 'broadcast', event, payload }).catch?.(() => {});
    },
    destroy: () => client.removeChannel(ch),
  };
}

// 남의 커서 이름표 — 그 사람 색 알약 안에 14px 얼굴(사진 · 없거나 깨지면 첫 글자) + 이름(흰 글자).
// 모양은 index.css `.collaboration-carets__*`. 색은 CollaborationCaret이 #rrggbb만 넘긴다(아니면 transparent).
function caretRender(user) {
  const color = /^#[0-9a-f]{6}$/i.test(user?.color || '') ? user.color : PALETTE_FALLBACK;
  const caret = document.createElement('span');
  caret.classList.add('collaboration-carets__caret');
  caret.style.borderColor = color;
  const label = document.createElement('div');
  label.classList.add('collaboration-carets__label');
  label.style.backgroundColor = color;
  const face = document.createElement('span');
  face.classList.add('collaboration-carets__face');
  const initial = () => { face.textContent = (user?.name || '?')[0]; };
  if (user?.avatar) {
    const img = document.createElement('img');
    img.alt = '';
    img.onerror = () => { img.remove(); initial(); };
    img.src = user.avatar;
    face.appendChild(img);
  } else initial();
  label.append(face, document.createTextNode(user?.name || ''));
  caret.append(label);
  return caret;
}
const PALETTE_FALLBACK = '#5b55c9';

// 커서가 선 마크다운 줄 번호를 awareness `line`에 싣는다(core.caretLine) — 보기 화면이 편집기 없이 그 줄에
// 얼굴을 세운다. 선택이 움직일 때마다 재면 긴 본문에서 무거우니 120ms에 한 번, 바뀌었을 때만.
// **초점이 없으면 null**이다 — 이름표 커서(y-tiptap)가 초점을 잃으면 걷히는 것과 같게(제목 칸에 가 있는 사람의 줄을
// 본문에 남기지 않는다). 편집기가 내려가면(수정 완료) 걷는다. 확장 하나를 편집기가 다시 설 때마다 같이 쓴다.
function caretLineExtension(awareness) {
  let timer = null;
  let last;
  const publish = (editor) => {
    timer = null;
    if (editor.isDestroyed) return;
    const line = editor.isFocused ? caretLine(editor.state.doc, editor.state.selection.head) : null;
    if (line === last) return;
    last = line;
    awareness.setLocalStateField('line', line);
  };
  const soon = (editor) => { if (!timer) timer = setTimeout(() => publish(editor), 120); };
  return Extension.create({
    name: 'coeditCaretLine',
    onSelectionUpdate() { soon(this.editor); },
    onUpdate() { soon(this.editor); },
    onFocus() { soon(this.editor); },
    onBlur() { soon(this.editor); },
    onDestroy() {
      clearTimeout(timer); timer = null; last = undefined;
      if (awareness.getLocalState()) awareness.setLocalStateField('line', null);
    },
  });
}

export async function openCoedit({
  cardId, user = {}, markdown = '', onMirror, onVersion, client = defaultClient,
}) {
  if (!client) throw new Error('같이 쓰기는 클라우드 모드에서만 돼요');
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const store = supabaseStore(client);
  const schema = bodySchema();

  let loaded = false;
  let upto = 0;                       // 내가 DB에서 읽어 **문서에 들어 있다고 아는** 마지막 기록 id
  let peer = null;
  let joins = 0;
  const inbox = [];                   // peer가 서기 전에 온 메시지
  const provider = channelProvider({
    client, topic: coeditTopic(cardId),
    presenceKey: ydoc.clientID,
    onLeave: (id) => { if (id !== ydoc.clientID && awareness.getStates().has(id)) removeAwarenessStates(awareness, [id], 'presence-leave'); },
    onMessage: (e, p) => (peer ? peer.receive(e, p) : inbox.push([e, p])),
    // 처음 붙은 것은 hello만(읽기는 아래에서 이미 한다) · 그 뒤에 또 붙으면 다시 읽고 hello
    onSubscribed: () => {
      joins += 1;
      if (!loaded) return;
      if (joins === 1) peer.hello(); else catchUp();
    },
  });
  let mirror = null;
  peer = createPeer({
    ydoc, awareness, send: (e, p) => provider.send(e, p),
    // 보낸 사람 clientID → 그 사람(awareness의 user.id) — 판의 editors(0087)
    onRemote: (c) => { const uid = awareness.getStates().get(c)?.user?.id; if (uid && uid !== user.id) mirror?.noteRemote(uid); },
  });
  for (const [e, p] of inbox.splice(0)) peer.receive(e, p);

  // 처음 읽기 — 스냅샷이 없으면 마크다운에서 심는다(두 번 심기 막기는 core.loadDoc)
  const first = await loadDoc({ ydoc, store, cardId, markdown, schema });
  upto = first.upto;
  loaded = true;
  // 심었다 읽은 모양끼리 견준다(core.normalizeMarkdown 머리말) — 날것끼리면 옛 글은 늘 '다르다'다
  const divergedAtOpen = fullMarkdown(ydoc) !== normalizeMarkdown(markdown, schema);
  if (provider.status === 'SUBSCRIBED') peer.hello();
  // 기준 판(0086) — 같이 쓰기 전부터 있던 본문을 판 목록 맨 아래 한 줄로(판이 이미 있으면 DB가 거른다).
  // 없으면 처음 고친 사람의 판이 `처음 작성한 본문`으로 서고, 고친 곳 보기가 빈 글과 견줬다(두 사람 실측).
  store.baseline(cardId, fullMarkdown(ydoc)).catch(e => console.warn('[coedit] 기준 판 남기기 실패:', e));

  // 접기 — upto는 앞으로만 간다(0084). false = 누가 이미 그만큼 접었다 → 할 일 없음
  if (shouldCompact(first.rowCount)) {
    store.compact(cardId, upto, toB64(Y.encodeStateAsUpdate(ydoc))).catch(e => console.warn('[coedit] 접기 실패:', e));
  }

  let catching = null;
  function catchUp() {
    if (catching) return catching;
    catching = (async () => {
      try {
        const r = await loadDoc({ ydoc, store, cardId, markdown, schema, seed: false });
        upto = Math.max(upto, r.upto);
      } catch (e) { console.warn('[coedit] 다시 읽기 실패:', e); }
      peer.hello();
    })().finally(() => { catching = null; });
    return catching;
  }

  const persister = createPersister({ ydoc, store, cardId });
  mirror = createMirror({
    ydoc,
    onMirror: (md) => { try { onMirror?.(md); } catch (e) { console.warn('[coedit] 거울 쓰기 실패:', e); } },
    onVersion: (v) => {
      store.addVersion(cardId, { md: v.endMd, added: v.added, removed: v.removed, editors: [...new Set([user.id, ...(v.others || [])].filter(Boolean))] }, newKey())
        .catch(e => console.warn('[coedit] 판 남기기 실패:', e));
      try { onVersion?.(v); } catch (e) { console.warn('[coedit] 세션 끝 처리 실패:', e); }
    },
  });

  // 받은 편집이 있었는데 그 사람이 떠나면 — 그 사람이 1초 모으기를 다 못 남겼을 수 있다.
  // 남은 사람 중 한 명(clientID가 가장 작은)이 **지금 상태 전체를 기록 한 줄로** 남긴다.
  // 스냅샷을 덮지 않는 까닭: 덮기는 upto가 앞으로 갈 때만 된다(0084) — 추가는 누구와도 겹치지 않는다.
  let gotRemote = false;
  const onDocUpdate = (_u, origin) => { if (origin === REMOTE) gotRemote = true; };
  ydoc.on('update', onDocUpdate);
  const onAwareness = ({ removed }) => {
    if (!gotRemote || !removed.some(id => id !== ydoc.clientID)) return;
    if (!isCompactor(ydoc.clientID, awareness.getStates().keys())) return;
    gotRemote = false;
    store.append(cardId, toB64(Y.encodeStateAsUpdate(ydoc)), newKey())
      .catch(e => console.warn('[coedit] 떠난 사람 몫 남기기 실패:', e));
  };
  awareness.on('update', onAwareness);

  // 창을 닫는 순간 — 모아 둔 것을 지금 보낸다(보장은 아니다: 탭이 닫히면 요청이 끊길 수 있다)
  const flushAll = () => { peer.flush(); mirror.flush(); return persister.flush(); };
  const onHide = () => { flushAll(); };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);

  // **편집기가 없어도 얼굴이 선다** — 업무 창의 보기 화면은 편집기를 띄우지 않고 이 문서에 들어온다(2026-09-29).
  // 예전에는 CollaborationCaret이 편집기를 만들 때 user를 실었다. `editing`(수정 화면인가)은 업무 창이,
  // `line`(커서 줄)은 아래 caretLineExtension이 싣는다.
  awareness.setLocalStateField('user', user);

  const collab = {
    ydoc, awareness, user,
    extensions: [
      // 되돌리기는 이 확장의 것(Yjs UndoManager — **내 편집만** 물린다). StarterKit의 undoRedo는
      // MarkdownEditor가 collab일 때 끈다.
      Collaboration.configure({ document: ydoc, field: FIELD }),
      CollaborationCaret.configure({ provider: { awareness }, user, render: caretRender }),
      caretLineExtension(awareness),
    ],
  };

  let destroyed = false;
  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
    const done = flushAll();
    // 떠난다고 알린다 — 남들 화면에서 내 커서가 30초 동안 남아 있지 않게
    removeAwarenessStates(awareness, [ydoc.clientID], 'local');
    peer.flush();                     // 모아 둔 커서 타이머를 기다리지 않고 지금
    await done.catch(() => {});
    ydoc.off('update', onDocUpdate);
    awareness.off('update', onAwareness);
    mirror.destroy();
    persister.destroy();
    peer.destroy();
    awareness.destroy();
    provider.destroy();
  }

  // description을 받아들여도 되나(열 때 달랐을 때만 묻는다 · 업무 창 useCoedit) — **셋 다** 맞아야 한다:
  //   ① 열 때 달랐다  ② 지금 문서에 나 말고 아무도 없다(누가 쓰는 중이면 그 사람의 거울이 아직 안 갔을
  //   뿐이다 — 받아들이면 그 사람이 막 친 글이 그 사람 화면에서 지워진다)  ③ 카드가 문서보다 늦게
  //   바뀌었다(cards.updated_at > 마지막 기록) — 같이 쓰기 밖의 길(옛 앱)이 본문을 고쳤다는 뜻이다.
  //   거꾸로(문서가 더 새것)면 거울이 못 갔을 뿐이다(탭이 닫혀 끊겼다) — 다음 거울이 description을 맞춘다.
  async function adoptCheck(cardUpdatedAt) {
    if (!divergedAtOpen) return false;
    if ([...awareness.getStates().keys()].some(id => id !== ydoc.clientID)) return false;
    const at = await store.latestAt(cardId).catch(() => null);
    const card = Date.parse(cardUpdatedAt || '');
    return Number.isFinite(card) && (!at || card > Date.parse(at));
  }

  return {
    ydoc, awareness, provider, collab, destroy, flush: flushAll, divergedAtOpen, adoptCheck,
    markdown: () => fullMarkdown(ydoc),
    replaceAll: (md) => replaceAll(ydoc, md, schema),
    actions: {
      read: () => readActions(ydoc),
      add: (item, index) => addAction(ydoc, item, index),
      update: (id, patch) => updateAction(ydoc, id, patch),
      remove: (id) => removeAction(ydoc, id),
      replace: (items) => replaceActions(ydoc, items),
      // 바뀌면 다시 그리라고 — 받은 편집도 온다
      observe: (fn) => { const a = ydoc.getArray(ACTIONS); const h = () => fn(readActions(ydoc)); a.observeDeep(h); return () => a.unobserveDeep(h); },
    },
  };
}
