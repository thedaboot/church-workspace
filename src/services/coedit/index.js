// ============================================================================
// 업무 본문 같이 쓰기 — 여는 곳 하나 (0084 · 순수 부분은 core.js)
// ----------------------------------------------------------------------------
// **화면에는 아직 안 붙었다**(엔진만). 붙일 때의 모양:
//
//   const { openCoedit } = await import('../services/coedit/index.js');   // 늦게 — yjs가 첫 화면에 안 실린다
//   const co = await openCoedit({ cardId, user: { name, color: '#rrggbb' }, markdown: task.content,
//     onMirror: (md) => cardUpsertCloud({ ...task, content: md }, false, { changed: ['content'] }),
//     onVersion: ({ startMd, endMd, added, removed }) => {
//       // 새 멘션만: cloudSync.newMentionsOnly(endMd, startMd, 내 이름) · 활동 기록은 여기서 한 줄
//     } });
//   <MarkdownEditor collab={co.collab} … />       // value는 무시된다 · 문서는 co.ydoc이 원본
//   co.actions.read() / add(item) / update(id, patch) / remove(id) / replace(items)   // 담당 업무 부품
//   co.replaceAll(md)       // AI 다듬기 · '이 버전으로 되돌리기' — 한 트랜잭션 · 되돌리기 한 걸음
//   // 닫을 때: 편집기를 먼저 내리고 await co.destroy()
//
// onMirror는 **기존 저장 길**로 보내야 한다(활동·실시간 반영이 그 길에 붙어 있다). 마지막으로 비춘
// 글과 같으면 부르지 않는다. 판(card_doc_versions)은 여기서 직접 넣고(줄 수 셈 포함), onVersion은
// 화면이 멘션·활동을 세션당 한 번 하라고 부른다.
//
// `divergedAtOpen` — 열 때 description과 Yjs 문서의 글이 달랐나. 같이 쓰기 밖의 길(옛 저장·다른
// 화면)이 description을 고치면 Yjs가 모르고, 다음 거울이 그것을 덮는다. 붙일 때 그 길들을
// `replaceAll`로 돌리거나, 이 값으로 사람에게 물을지 화면이 정한다(미결 — 엔진은 판단하지 않는다).
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
import { supabase as defaultClient } from '../supabaseClient.js';
import { bodySchema } from '../editorSchema.js';
import {
  FIELD, ACTIONS, REMOTE, toB64, newKey, createPeer, createPersister, createMirror, loadDoc, shouldCompact, isCompactor,
  fullMarkdown, readActions, addAction, updateAction, removeAction, replaceActions, replaceAll,
} from './core.js';
import { supabaseStore } from './store.js';

export const coeditTopic = (cardId) => `coedit:${cardId}`;
const EVENTS = ['u', 's1', 's2', 'aw'];

// 채널 — 비공개(0084의 realtime.messages 정책) · 내 것은 안 받는다(self: false)
function channelProvider({ client, topic, onMessage, onSubscribed }) {
  const ch = client.channel(topic, { config: { private: true, broadcast: { self: false } } });
  for (const event of EVENTS) ch.on('broadcast', { event }, ({ payload }) => onMessage(event, payload));
  let status = 'INIT';
  let warned = false;
  const start = async () => {
    // 비공개 채널은 소켓에 로그인 토큰이 실려 있어야 붙는다
    try { await client.realtime.setAuth(); } catch (e) { console.warn('[coedit] 실시간 인증 실패:', e); }
    ch.subscribe((s, err) => {
      status = s;
      if (s === 'SUBSCRIBED') onSubscribed();
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
    onMessage: (e, p) => (peer ? peer.receive(e, p) : inbox.push([e, p])),
    // 처음 붙은 것은 hello만(읽기는 아래에서 이미 한다) · 그 뒤에 또 붙으면 다시 읽고 hello
    onSubscribed: () => {
      joins += 1;
      if (!loaded) return;
      if (joins === 1) peer.hello(); else catchUp();
    },
  });
  peer = createPeer({ ydoc, awareness, send: (e, p) => provider.send(e, p) });
  for (const [e, p] of inbox.splice(0)) peer.receive(e, p);

  // 처음 읽기 — 스냅샷이 없으면 마크다운에서 심는다(두 번 심기 막기는 core.loadDoc)
  const first = await loadDoc({ ydoc, store, cardId, markdown, schema });
  upto = first.upto;
  loaded = true;
  const divergedAtOpen = fullMarkdown(ydoc) !== String(markdown ?? '');
  if (provider.status === 'SUBSCRIBED') peer.hello();

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
  const mirror = createMirror({
    ydoc,
    onMirror: (md) => { try { onMirror?.(md); } catch (e) { console.warn('[coedit] 거울 쓰기 실패:', e); } },
    onVersion: (v) => {
      store.addVersion(cardId, { md: v.endMd, added: v.added, removed: v.removed }, newKey())
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

  const collab = {
    ydoc, awareness, user,
    extensions: [
      // 되돌리기는 이 확장의 것(Yjs UndoManager — **내 편집만** 물린다). StarterKit의 undoRedo는
      // MarkdownEditor가 collab일 때 끈다.
      Collaboration.configure({ document: ydoc, field: FIELD }),
      CollaborationCaret.configure({ provider: { awareness }, user }),
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

  return {
    ydoc, awareness, provider, collab, destroy, flush: flushAll, divergedAtOpen,
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
