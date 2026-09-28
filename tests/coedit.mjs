// 업무 본문 같이 쓰기 엔진(services/coedit · 0084) — 노드만(브라우저·서버 없음)
//
// 보는 것: ① 마크다운 → Yjs 심기 → 마크다운 왕복(편집기와 같은 스키마) ② 가짜 채널로 이은 둘이
// 동시에 써도 같은 글로 모이는지 · 끊긴 채 쓴 것을 hello가 메우는지 · 커서 ③ 늦게 온 사람이 스냅샷 +
// 기록으로 따라잡는지 ④ 접기(card_doc_compact 흉내) 뒤에도 글이 같은지 · 30초 안 된 기록은 안 접는지 ·
// 둘이 동시에 접으면 한 쪽만(upto는 앞으로만) ⑤ 두 번 심기 막기 ⑥ 거울(조용하면 · 같은 글이면 안 씀 ·
// 누가 비춰도 같은 글자)·판(세션 시작·끝 글 · 줄 수) · 담당 업무 도막(Y.Array 왕복 · 줄 단위) ·
// 통째로 갈기(한 트랜잭션 · 되돌리기 한 걸음) ⑦ 기록 실패·시간 초과 뒤 **같은 열쇠로** 다시 보내기
// ⑧ 배선(편집기 prop · yjs가 첫 화면·편집기 조각에 안 실리는지 · 0084 모양 · 옛 글 채우기)
//
// 되돌리기 검사(§3-5) — 2026-09-28에 실제로 걷어서 확인했다:
//   · core.loadDoc의 `for (const r of rows) Y.applyUpdate(...)` 줄을 걷으면 ③·④·⑦ 넷이 FAIL
//     (스냅샷 뒤 기록이 빠진다)
//   · core.createBatcher가 실패한 덩어리에 새 열쇠를 달게 하면(`head.key = makeKey()`) ⑦이 FAIL
//     (시간 초과 뒤 다시 보내기가 기록을 한 줄 더 만든다 — 4 !== 3)
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const Y = await import('yjs');
const { Awareness } = await import('y-protocols/awareness');
const C = await import(new URL('../src/services/coedit/core.js', import.meta.url).href);
const { bodySchema } = await import(new URL('../src/services/editorSchema.js', import.meta.url).href);
const { mdToDoc, docToMd } = await import(new URL('../src/services/markdown.js', import.meta.url).href);
const { seedRows } = await import(new URL('../scripts/seed-card-docs.mjs', import.meta.url).href);
const { stripActionSection, parseActionItems, ACTION_HEADING } = await import(new URL('../src/services/actionItems.js', import.meta.url).href);
const { ySyncPluginKey } = await import('@tiptap/y-tiptap');
const schema = bodySchema();

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 편집 흉내 — 첫 문단(또는 i번째 블록)의 글에 끼운다. 출처는 '내 편집'(REMOTE·DB가 아닌 것)
const LOCAL = 'editor';
const textAt = (ydoc, i = 0) => ydoc.getXmlFragment(C.FIELD).get(i).get(0);
const typeAt = (ydoc, i, pos, s) => ydoc.transact(() => textAt(ydoc, i).insert(pos, s), LOCAL);

// 가짜 채널 — 보낸 것을 **JSON으로 한 번 굴려서**(실제 Broadcast처럼) 나머지에게 늦게 준다.
// `down`이면 그 사람에게 가는 것·그 사람이 보내는 것을 버린다(끊김).
function bus() {
  const peers = [];
  let inflight = 0;
  const net = {
    down: new Set(),
    // 오가는 것이 다 닿을 때까지(윈도우의 setTimeout은 15ms씩 걸리기도 해서 시간으로 기다리지 않는다).
    // 모으기 타이머(5ms)도 있어서 두 번 연달아 비어 있어야 끝이다.
    async settle() {
      for (let quiet = 0, n = 0; quiet < 2 && n < 400; n++) { await sleep(20); quiet = inflight ? 0 : quiet + 1; }
    },
    join(name, ydoc, awareness) {
      const me = { name, ydoc };
      me.peer = C.createPeer({
        ydoc, awareness, throttleMs: 5, awarenessMs: 5,
        send: (event, payload) => {
          if (net.down.has(name)) return;
          const wire = JSON.stringify(payload);
          for (const p of peers) {
            if (p === me || net.down.has(p.name)) continue;
            inflight++;
            setTimeout(() => { inflight--; p.peer.receive(event, JSON.parse(wire)); }, 1);
          }
        },
      });
      peers.push(me);
      return me.peer;
    },
  };
  return net;
}

// 메모리 저장소 — 0084를 그대로 흉내 낸다: 심기는 먼저 넣은 쪽만 · 기록·판은 client_id가 같으면
// 한 번만 · 접기는 upto가 앞으로 갈 때만(30초 안 된 기록은 안 접는다) · 없는 id까지는 거절.
// `commitThenFail`: 넣기는 되었는데 답이 안 온 것(시간 초과) — 다시 보내기가 겹치지 않는지 본다.
function memStore() {
  const docs = new Map();
  const log = [];
  let seq = 0;
  const s = {
    clock: 1_000_000, docs, log, versions: [], failNextAppend: 0, commitThenFail: 0,
    async snapshot(id) { await null; const d = docs.get(id); return d ? { ...d } : null; },
    async rowsAfter(id, upto) { await null; return log.filter(r => r.card_id === id && r.id > upto).map(r => ({ id: r.id, data: r.data })); },
    async seed(id, state) { await null; if (docs.has(id)) return false; docs.set(id, { state, upto: 0 }); return true; },
    async append(id, data, key) {
      await null;
      assert.ok(key, '기록에는 열쇠가 붙는다');
      if (s.failNextAppend > 0) { s.failNextAppend--; throw new Error('네트워크'); }
      if (!log.some(r => r.key === key)) log.push({ id: ++seq, key, card_id: id, data, at: s.clock });
      if (s.commitThenFail > 0) { s.commitThenFail--; throw new Error('시간 초과(들어가기는 했다)'); }
    },
    async compact(id, pUpto, state) {
      await null;
      const cur = docs.get(id)?.upto;
      const top = Math.max(0, ...log.filter(r => r.card_id === id).map(r => r.id));
      if (pUpto > Math.max(cur ?? 0, top)) throw new Error('upto beyond log');
      const safe = Math.max(0, ...log.filter(r => r.card_id === id && r.id <= pUpto && r.at < s.clock - 30_000).map(r => r.id));
      if (cur != null && safe <= cur) return false;
      docs.set(id, { state, upto: safe });
      for (let i = log.length - 1; i >= 0; i--) if (log[i].card_id === id && log[i].id <= safe) log.splice(i, 1);
      return true;
    },
    async addVersion(id, v, key) { if (!s.versions.some(x => x.key === key)) s.versions.push({ id, key, ...v }); },
  };
  return s;
}

const SAMPLE = [
  '# 임원 선출',
  '## 준비물',
  '- 투표용지',
  '- [ ] 공지 올리기',
  '- [x] 장소 잡기',
  '1. 찬양',
  '2. 기도',
  '==형광== **굵게** *기울임* __밑줄__ ~~취소~~',
  '[안내 문서](https://example.com/a)',
  'https://example.com/pic.png',
  '---',
  '',
  '@노준석 확인 부탁',
  '\\# 글자 그대로',
].join('\n');

// 회의록 모양 — 본문 + 맨 아래 '청년별 담당 업무' 도막(writeActionSection이 적는 모양 그대로)
const ACT_MD = `## 회의 내용\n수련회 일정 논의\n\n### ${ACTION_HEADING}\n- @조해리 @박지호 · 조편성 방법 정하기 · 10월 5일까지\n- @찬양팀 · 콘티 공유`;

// ① 심기 → 마크다운 왕복 ──────────────────────────────────────────────────────
await check('마크다운 → Yjs 심기 → 마크다운이 같은 글이다(편집기 스키마)', async () => {
  for (const md of [SAMPLE, '', '한 줄', '### 셋째 제목\n본문', '5. 다섯부터\n6. 여섯']) {
    const d = new Y.Doc();
    Y.applyUpdate(d, C.seedState(md, schema));
    assert.strictEqual(C.docMarkdown(d), docToMd(mdToDoc(md)), `왕복이 편집기 경로와 다르다: ${JSON.stringify(md)}`);
  }
  const d = new Y.Doc();
  Y.applyUpdate(d, C.seedState(SAMPLE, schema));
  assert.strictEqual(C.docMarkdown(d), SAMPLE, '대표 글이 한 글자도 안 바뀐다');
  // base64 왕복
  const u = C.seedState(SAMPLE, schema);
  assert.deepStrictEqual(C.fromB64(C.toB64(u)), u);
});

// ② 둘이 동시에 ──────────────────────────────────────────────────────────────
await check('가짜 채널로 이은 둘이 동시에 써도 같은 글로 모인다 · 끊긴 채 쓴 것은 hello가 메운다', async () => {
  const seed = C.seedState('첫 줄\n둘째 줄', schema);
  const a = new Y.Doc(), b = new Y.Doc();
  Y.applyUpdate(a, seed, C.DB); Y.applyUpdate(b, seed, C.DB);
  const net = bus();
  const wa = new Awareness(a), wb = new Awareness(b);
  const pa = net.join('a', a, wa);
  const pb = net.join('b', b, wb);
  // 같은 자리에 동시에
  for (let i = 0; i < 20; i++) { typeAt(a, 0, 0, 'A'); typeAt(b, 0, 0, 'B'); if (i % 5 === 0) await sleep(2); }
  typeAt(a, 1, 0, '[a]'); typeAt(b, 1, 3, '[b]');
  await net.settle();
  assert.strictEqual(C.docMarkdown(a), C.docMarkdown(b), '둘이 같은 글이다');
  const md = C.docMarkdown(a);
  assert.strictEqual((md.match(/A/g) || []).length, 20, 'A 스무 자가 다 있다');
  assert.strictEqual((md.match(/B/g) || []).length, 20, 'B 스무 자가 다 있다');
  assert.ok(md.includes('[a]') && md.includes('[b]'));
  // b가 끊긴 채 쓴다 → 다시 붙어 hello
  net.down.add('b');
  typeAt(b, 1, 0, '끊김');
  typeAt(a, 0, 0, '그사이');
  await net.settle();
  assert.notStrictEqual(C.docMarkdown(a), C.docMarkdown(b), '끊긴 사이에는 다르다');
  net.down.delete('b');
  pb.hello();
  await net.settle();
  assert.strictEqual(C.docMarkdown(a), C.docMarkdown(b), 'hello 뒤에 다시 같다');
  assert.ok(C.docMarkdown(a).includes('끊김') && C.docMarkdown(a).includes('그사이'));
  pa.destroy(); pb.destroy(); wa.destroy(); wb.destroy();
});

await check('커서·이름(awareness)이 건너가고, 떠나면 지워진다', async () => {
  const a = new Y.Doc(), b = new Y.Doc();
  const wa = new Awareness(a), wb = new Awareness(b);
  const net = bus();
  const pa = net.join('a', a, wa); const pb = net.join('b', b, wb);
  wa.setLocalStateField('user', { name: '가', color: '#112233' });
  await net.settle();
  assert.deepStrictEqual(wb.getStates().get(a.clientID)?.user, { name: '가', color: '#112233' });
  const { removeAwarenessStates } = await import('y-protocols/awareness');
  removeAwarenessStates(wa, [a.clientID], 'local');
  pa.flush();
  await net.settle();
  assert.ok(!wb.getStates().has(a.clientID), '떠난 사람의 커서가 사라진다');
  pa.destroy(); pb.destroy(); wa.destroy(); wb.destroy();
});

// ③ 늦게 온 사람 ──────────────────────────────────────────────────────────────
await check('늦게 온 사람이 스냅샷 + 기록으로 따라잡는다', async () => {
  const store = memStore();
  const a = new Y.Doc();
  const r = await C.loadDoc({ ydoc: a, store, cardId: 'c1', markdown: '첫 줄', schema });
  assert.strictEqual(r.seeded, true, '처음 연 사람이 심는다');
  const per = C.createPersister({ ydoc: a, store, cardId: 'c1', delay: 3 });
  typeAt(a, 0, 3, ' 더함');
  await sleep(10);
  typeAt(a, 0, 0, '맨앞 ');
  await per.flush();
  assert.ok(store.log.length >= 1, '기록이 남는다');
  const late = new Y.Doc();
  const r2 = await C.loadDoc({ ydoc: late, store, cardId: 'c1', markdown: '다른 글(무시돼야 한다)', schema });
  assert.strictEqual(r2.seeded, false);
  assert.strictEqual(C.docMarkdown(late), C.docMarkdown(a), '늦게 온 사람의 글 = 쓴 사람의 글');
  assert.strictEqual(C.docMarkdown(late), '맨앞 첫 줄 더함');
  assert.strictEqual(r2.upto, store.log[store.log.length - 1].id, 'upto는 읽은 마지막 기록');
  per.destroy();
});

// ④ 접기 ─────────────────────────────────────────────────────────────────────
await check('접기(card_doc_compact) 뒤에도 글이 같다 · 30초 안 된 기록은 남긴다 · 덜 본 상태는 거절', async () => {
  const store = memStore();
  const a = new Y.Doc();
  await C.loadDoc({ ydoc: a, store, cardId: 'c2', markdown: SAMPLE, schema });
  const per = C.createPersister({ ydoc: a, store, cardId: 'c2', delay: 1 });
  for (let i = 0; i < 60; i++) { typeAt(a, 0, 0, String(i % 10)); await per.flush(); }
  assert.strictEqual(store.log.length, 60);
  const before = C.docMarkdown(a);
  const b = new Y.Doc();
  const r = await C.loadDoc({ ydoc: b, store, cardId: 'c2', schema });
  assert.ok(C.shouldCompact(r.rowCount), '50줄 넘게 읽으면 접는다');
  assert.ok(!C.shouldCompact(50));
  // 방금 쓴 기록(30초 안)은 접히지 않는다 — 커밋 차례가 id 차례와 다를 수 있다(0084 머리말)
  assert.strictEqual(await store.compact('c2', r.upto, C.toB64(Y.encodeStateAsUpdate(b))), false, '접을 만큼 오래된 것이 없다');
  assert.strictEqual(store.log.length, 60, '30초 안 된 기록은 남는다');
  store.clock += 31_000;
  assert.strictEqual(await store.compact('c2', r.upto, C.toB64(Y.encodeStateAsUpdate(b))), true);
  assert.strictEqual(store.log.length, 0, '다 접혔다');
  assert.strictEqual(store.docs.get('c2').upto, r.upto);
  const c = new Y.Doc();
  await C.loadDoc({ ydoc: c, store, cardId: 'c2', schema });
  assert.strictEqual(C.docMarkdown(c), before, '접은 뒤에 연 글 = 접기 전 글');
  // 덜 본 상태(옛 upto)로는 못 덮는다 · 아직 없는 id까지는 거절
  typeAt(a, 0, 0, 'X'); await per.flush(); store.clock += 31_000;
  assert.strictEqual(await store.compact('c2', store.log.at(-1).id, C.toB64(Y.encodeStateAsUpdate(a))), true);
  assert.strictEqual(await store.compact('c2', 3, C.toB64(Y.encodeStateAsUpdate(c))), false, '덜 본 상태는 거절');
  await assert.rejects(store.compact('c2', 99999, 'AAAA'), /beyond/);
  per.destroy();
});

await check('둘이 동시에 접어도 한 쪽만 · upto는 앞으로만 · 글은 그대로', async () => {
  const store = memStore();
  const w = new Y.Doc();
  await C.loadDoc({ ydoc: w, store, cardId: 'c5', markdown: '글', schema });
  const per = C.createPersister({ ydoc: w, store, cardId: 'c5', delay: 1 });
  for (let i = 0; i < 55; i++) { typeAt(w, 0, 0, 'k'); await per.flush(); }
  const want = C.docMarkdown(w);
  const x = new Y.Doc(), y = new Y.Doc();
  const [rx, ry] = await Promise.all([C.loadDoc({ ydoc: x, store, cardId: 'c5', schema }), C.loadDoc({ ydoc: y, store, cardId: 'c5', schema })]);
  store.clock += 31_000;
  const res = await Promise.all([
    store.compact('c5', rx.upto, C.toB64(Y.encodeStateAsUpdate(x))),
    store.compact('c5', ry.upto, C.toB64(Y.encodeStateAsUpdate(y))),
  ]);
  assert.deepStrictEqual(res.sort(), [false, true], '같은 upto로 둘이 접으면 한 번만 된다');
  // 그사이 새 기록 → 앞선 쪽만 접힌다 · 뒤처진 upto(옛 값)는 거절
  typeAt(w, 0, 0, 'n'); await per.flush(); store.clock += 31_000;
  const z = new Y.Doc(); const rz = await C.loadDoc({ ydoc: z, store, cardId: 'c5', schema });
  assert.strictEqual(await store.compact('c5', rx.upto, C.toB64(Y.encodeStateAsUpdate(x))), false, '옛 upto로는 못 덮는다');
  assert.strictEqual(await store.compact('c5', rz.upto, C.toB64(Y.encodeStateAsUpdate(z))), true);
  assert.strictEqual(store.docs.get('c5').upto, rz.upto);
  const fresh = new Y.Doc(); await C.loadDoc({ ydoc: fresh, store, cardId: 'c5', schema });
  assert.strictEqual(C.docMarkdown(fresh), 'n' + want);
  per.destroy();
});

// ⑤ 두 번 심기 ───────────────────────────────────────────────────────────────
await check('두 사람이 동시에 처음 열어도 한 벌만 심는다', async () => {
  const store = memStore();
  const md = '# 제목\n- 하나\n- 둘';
  const a = new Y.Doc(), b = new Y.Doc();
  const [ra, rb] = await Promise.all([
    C.loadDoc({ ydoc: a, store, cardId: 'c3', markdown: md, schema }),
    C.loadDoc({ ydoc: b, store, cardId: 'c3', markdown: md, schema }),
  ]);
  assert.deepStrictEqual([ra.seeded, rb.seeded].sort(), [false, true], '한 사람만 이긴다');
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  assert.strictEqual(C.docMarkdown(a), md, '합쳐도 본문이 두 번 찍히지 않는다');
  assert.strictEqual(C.docMarkdown(b), md);
  // 막기가 없으면 어떻게 되나 — 둘이 따로 심은 것을 합치면 두 벌이다(이 검사가 무엇을 막는지)
  const x = new Y.Doc(), y = new Y.Doc();
  Y.applyUpdate(x, C.seedState(md, schema)); Y.applyUpdate(y, C.seedState(md, schema));
  Y.applyUpdate(x, Y.encodeStateAsUpdate(y));
  assert.notStrictEqual(C.docMarkdown(x), md, '(대조) 따로 심으면 합칠 때 겹친다');
});

// ⑥ 거울 · 판 ─────────────────────────────────────────────────────────────────
await check('내가 고치면 조용할 때 거울 한 번 · 세션이 끝나면 판 한 번(시작·끝 글 · 줄 수) · 받은 편집만으로는 안 쓴다', async () => {
  const a = new Y.Doc();
  Y.applyUpdate(a, C.seedState('처음', schema), C.DB);
  const mirrors = [], versions = [];
  const m = C.createMirror({ ydoc: a, idleMs: 15, sessionMs: 60, onMirror: (md) => mirrors.push(md), onVersion: (v) => versions.push(v) });
  // 받은 편집
  const other = new Y.Doc(); Y.applyUpdate(other, Y.encodeStateAsUpdate(a));
  other.transact(() => textAt(other, 0).insert(2, '남'), LOCAL);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(other), C.REMOTE);
  await sleep(30);
  assert.deepStrictEqual(mirrors, [], '받은 편집만으로는 거울을 안 쓴다');
  assert.strictEqual(m.inSession, false);
  typeAt(a, 0, 0, '나');
  typeAt(a, 0, 0, '나');
  assert.strictEqual(m.inSession, true);
  assert.deepStrictEqual(mirrors, [], '치는 동안에는 안 쓴다');
  for (let i = 0; i < 50 && !mirrors.length; i++) await sleep(10);
  assert.deepStrictEqual(mirrors, ['나나처음남'], '조용해지면 한 번');
  for (let i = 0; i < 50 && !versions.length; i++) await sleep(10);
  assert.deepStrictEqual(versions, [{ startMd: '처음남', endMd: '나나처음남', added: 1, removed: 1 }], '세션 시작 글 = 첫 편집 직전(받은 편집 포함) · 줄 수');
  // 고쳤다가 되돌려 같은 글이면 판도 거울도 없다 · 닫을 때(flush) 남은 거울을 지금 쓴다
  typeAt(a, 0, 0, 'Z');
  a.transact(() => textAt(a, 0).delete(0, 1), LOCAL);
  m.flush();
  assert.strictEqual(versions.length, 1, '같은 글로 돌아오면 판 없음');
  assert.strictEqual(mirrors.length, 1, '마지막으로 비춘 글과 같으면 거울을 안 쓴다');
  typeAt(a, 0, 0, '끝');
  m.flush();
  assert.strictEqual(mirrors.at(-1), '끝나나처음남', '닫을 때 거울을 바로 쓴다');
  assert.strictEqual(versions.length, 2);
  m.destroy();
});

await check('같은 문서면 누가 비춰도 같은 글자다(동시 편집 뒤 · 서식 · 담당 업무 포함)', async () => {
  const a = new Y.Doc(), b = new Y.Doc();
  const seed = C.seedState(ACT_MD, schema);
  Y.applyUpdate(a, seed, C.DB); Y.applyUpdate(b, seed, C.DB);
  const net = bus(); const pa = net.join('a', a, null); const pb = net.join('b', b, null);
  a.transact(() => textAt(a, 1).insert(0, '굵게', { bold: {} }), LOCAL);
  b.transact(() => textAt(b, 1).insert(0, '형광', { highlight: {} }), LOCAL);
  C.updateAction(a, C.readActions(a)[0].id, { what: '조편성 확정' }, LOCAL);
  C.addAction(b, { names: ['박지호'], what: '장소 예약', dueText: '', dueDate: '' }, null, LOCAL);
  await net.settle();
  const ma = C.fullMarkdown(a), mb = C.fullMarkdown(b);
  assert.strictEqual(ma, mb, '두 사람의 거울 글이 한 글자도 안 다르다');
  assert.ok(/\*\*굵게\*\*/.test(ma) && /==형광==/.test(ma), ma);
  assert.ok(ma.includes('조편성 확정') && ma.includes('@박지호 · 장소 예약'), ma);
  pa.destroy(); pb.destroy();
});

// ⑥-2 담당 업무 도막 ───────────────────────────────────────────────────────────
await check('담당 업무 도막은 편집기 본문 밖의 Y.Array로 — 왕복 · 줄 단위 고치기 · 둘이 다른 줄을 고치면 둘 다', async () => {
  const d = new Y.Doc();
  Y.applyUpdate(d, C.seedState(ACT_MD, schema));
  assert.strictEqual(C.docMarkdown(d), stripActionSection(ACT_MD), '편집기 본문에는 도막이 없다');
  assert.ok(!C.docMarkdown(d).includes(ACTION_HEADING));
  const items = C.readActions(d);
  assert.strictEqual(items.length, 2);
  assert.ok(items.every(it => typeof it.id === 'string' && it.id.length > 8), '줄마다 안정된 id');
  assert.deepStrictEqual(items.map(({ id, ...rest }) => rest), parseActionItems(ACT_MD), '칸은 parseActionItems 그대로');
  assert.strictEqual(C.fullMarkdown(d), ACT_MD, '본문 + 도막 = 원래 글');
  // 줄 단위 고치기 — 마크다운을 거치지 않는다
  const [first, second] = items;
  assert.strictEqual(C.updateAction(d, first.id, { dueDate: '2026-10-09', dueText: '' }), true);
  assert.strictEqual(C.removeAction(d, second.id), true);
  const nid = C.addAction(d, { names: [], what: '회계 보고', dueText: '', dueDate: '' }, 0);
  assert.deepStrictEqual(C.readActions(d).map(x => x.id), [nid, first.id], '넣은 자리 · 지운 줄');
  assert.ok(C.fullMarkdown(d).endsWith(`### ${ACTION_HEADING}\n- 회계 보고\n- @조해리 @박지호 · 조편성 방법 정하기 · 10월 9일까지`), C.fullMarkdown(d));
  assert.strictEqual(C.updateAction(d, 'no-such', { what: 'x' }), false);
  // 통째로(부품이 목록을 한 번에 줄 때) — id가 같은 줄은 칸만 고친다
  C.replaceActions(d, [{ ...C.readActions(d)[1], what: '조편성 확정' }]);
  assert.deepStrictEqual(C.readActions(d).map(x => [x.id, x.what]), [[first.id, '조편성 확정']]);
  // 둘이 다른 줄을 동시에
  const a = new Y.Doc(), b = new Y.Doc();
  const seed = C.seedState(ACT_MD, schema); Y.applyUpdate(a, seed); Y.applyUpdate(b, seed);
  const [i1, i2] = C.readActions(a);
  C.updateAction(a, i1.id, { what: '가 고침' }, LOCAL);
  C.updateAction(b, i2.id, { what: '나 고침' }, LOCAL);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  assert.deepStrictEqual(C.readActions(a).map(x => x.what), ['가 고침', '나 고침']);
  assert.strictEqual(C.fullMarkdown(a), C.fullMarkdown(b));
  // 도막이 없는 글은 배열도 비고, 거울 글에도 도막이 안 붙는다
  const plain = new Y.Doc(); Y.applyUpdate(plain, C.seedState('그냥 글', schema));
  assert.deepStrictEqual(C.readActions(plain), []);
  assert.strictEqual(C.fullMarkdown(plain), '그냥 글');
});

await check('통째로 갈기(AI 다듬기 · 이 버전으로 되돌리기) — 한 트랜잭션 · 되돌리기 한 걸음 · 같은 줄 id는 살린다', async () => {
  const d = new Y.Doc();
  Y.applyUpdate(d, C.seedState(ACT_MD, schema), C.DB);
  const keepId = C.readActions(d)[0].id;
  const um = new Y.UndoManager(d.getXmlFragment(C.FIELD), { trackedOrigins: new Set([ySyncPluginKey]) });
  let txs = 0; const count = (tr) => { if (tr.changed.size) txs++; };
  d.on('afterTransaction', count);
  const next = `# 새 제목\n- 다듬은 목록\n\n### ${ACTION_HEADING}\n- @조해리 @박지호 · 조편성 방법 정하기 · 10월 5일까지\n- 새 일`;
  C.replaceAll(d, next, schema);
  d.off('afterTransaction', count);
  assert.strictEqual(txs, 1, '트랜잭션 한 번');
  assert.strictEqual(C.fullMarkdown(d), next);
  assert.strictEqual(C.readActions(d)[0].id, keepId, '내용이 같은 줄은 id가 그대로');
  um.undo();
  assert.strictEqual(C.docMarkdown(d), stripActionSection(ACT_MD), '되돌리기 한 번에 본문이 돌아온다');
  // 남에게는 편집 한 번으로 퍼진다
  const peer = new Y.Doc(); Y.applyUpdate(peer, Y.encodeStateAsUpdate(d));
  assert.strictEqual(C.fullMarkdown(peer), C.fullMarkdown(d));
});

await check('줄 차이 셈(판 목록의 N줄 추가 · M줄 제거)', async () => {
  assert.deepStrictEqual(C.lineDiffCounts('', 'a\nb'), { added: 2, removed: 0 }, '처음 작성');
  assert.deepStrictEqual(C.lineDiffCounts('a\nb\nc', 'a\nX\nc\nd'), { added: 2, removed: 1 });
  assert.deepStrictEqual(C.lineDiffCounts('a\nb', 'a\nb'), { added: 0, removed: 0 });
  assert.deepStrictEqual(C.lineDiffCounts('a\nb\nc', 'c\na'), { added: 1, removed: 2 }, '순서가 바뀐 줄');
  assert.deepStrictEqual(C.lineDiffCounts('x', ''), { added: 0, removed: 1 });
});

// ⑦ 기록 실패 → 다시 ────────────────────────────────────────────────────────
await check('기록 쓰기가 실패해도 편집이 사라지지 않는다 · 다시 보낼 때는 같은 덩어리를 같은 열쇠로', async () => {
  const store = memStore();
  const a = new Y.Doc();
  await C.loadDoc({ ydoc: a, store, cardId: 'c4', markdown: '글', schema });
  const per = C.createPersister({ ydoc: a, store, cardId: 'c4', delay: 2 });
  store.failNextAppend = 1;
  const warn = console.warn; console.warn = () => {};
  typeAt(a, 0, 1, '하나');
  await per.flush();
  assert.strictEqual(store.log.length, 0);
  assert.strictEqual(per.pending, 1, '실패한 덩어리를 쥐고 있다');
  typeAt(a, 0, 0, '둘');
  await per.flush();
  assert.strictEqual(store.log.length, 2, '실패한 덩어리 먼저, 새 편집은 다음 덩어리로');
  // 들어가기는 했는데 답이 안 왔다(시간 초과) → 다시 보내도 한 줄
  store.commitThenFail = 1;
  typeAt(a, 0, 0, '셋');
  await per.flush();
  assert.strictEqual(store.log.length, 3);
  assert.strictEqual(per.pending, 1, '답을 못 받았으니 쥐고 있다');
  await per.flush();
  console.warn = warn;
  assert.strictEqual(per.pending, 0);
  assert.strictEqual(store.log.length, 3, '같은 열쇠라 두 번 들어가지 않는다');
  const b = new Y.Doc();
  await C.loadDoc({ ydoc: b, store, cardId: 'c4', schema });
  assert.strictEqual(C.docMarkdown(b), '셋둘글하나');
  // 받은 것(REMOTE)·읽은 것(DB)은 남기지 않는다
  Y.applyUpdate(a, C.seedState('남의 것', schema), C.REMOTE);
  await per.flush();
  assert.strictEqual(store.log.length, 3, '받은 편집은 보낸 사람이 남긴다');
  per.destroy();
  // 판도 열쇠가 같으면 한 번
  await store.addVersion('c4', { md: 'x', added: 1, removed: 0 }, 'k1');
  await store.addVersion('c4', { md: 'x', added: 1, removed: 0 }, 'k1');
  assert.strictEqual(store.versions.length, 1);
  // 모아 보내기 — 열쇠는 덩어리마다 하나(다시 보낼 때 같은 것)
  const keys = [];
  let fail = true;
  const bt = C.createBatcher({ delay: 1, flush: (_u, k) => { keys.push(k); if (fail) { fail = false; return false; } return true; } });
  bt.push(new Uint8Array([0, 0])); await bt.flush(); await bt.flush();
  assert.strictEqual(keys.length, 2); assert.strictEqual(keys[0], keys[1], '같은 덩어리 = 같은 열쇠');
  bt.cancel();
  assert.strictEqual(C.isCompactor(3, [3, 5, 9]), true);
  assert.strictEqual(C.isCompactor(5, [3, 5, 9]), false, '떠난 사람 몫은 가장 작은 clientID 한 사람이 남긴다');
});

// ⑧ 배선 ─────────────────────────────────────────────────────────────────────
await check('배선 — 편집기 prop · 조각 · 0084 모양 · 옛 글 채우기', async () => {
  const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const ed = src('../src/components/MarkdownEditor.jsx');
  assert.ok(/collab = null,/.test(ed), 'collab은 기본 꺼짐');
  assert.ok(/\.\.\.bodyExtensions\(\{ undoRedo: !collab \}\)/.test(ed) && /\.\.\.\(collab \? collab\.extensions : \[\]\)/.test(ed), '같이 쓰기면 되돌리기를 끄고 확장을 끼운다');
  assert.ok(/content: collab \? undefined : mdToDoc\(value\)/.test(ed) && /if \(!editor \|\| collab\) return;/.test(ed), '같이 쓰기면 value를 안 본다');
  assert.ok(!/from 'yjs'|y-protocols|y-tiptap|extension-collaboration/.test(ed), '편집기 조각은 yjs를 직접 부르지 않는다(여는 쪽이 늦게 받는다)');
  const vite = src('../vite.config.js');
  const eager = vite.slice(vite.indexOf('const EAGER_VENDORS'), vite.indexOf('];', vite.indexOf('const EAGER_VENDORS')));
  assert.ok(!/yjs|y-protocols|y-tiptap|collaboration/.test(eager), 'yjs를 첫 화면 벤더에 넣지 않는다');
  // 붙기 전까지는 아무 화면도 coedit를 정적으로 부르지 않는다
  const idx = src('../src/services/coedit/index.js');
  assert.ok(/private: true, broadcast: \{ self: false \}/.test(idx) && /`coedit:\$\{cardId\}`/.test(idx), '채널은 비공개 coedit:<id>');
  const mig = src('../supabase/migrations/0084_card_coedit.sql');
  const sql = mig.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  for (const t of ['card_doc_updates', 'card_docs', 'card_doc_versions']) {
    assert.ok(new RegExp(`${t}_select on public\\.${t}\\s+for select using \\(public\\.is_approved\\(\\)\\)`).test(sql), `${t} 읽기는 승인된 전원`);
    assert.ok(new RegExp(`references public\\.cards\\(id\\) on delete cascade`).test(sql));
  }
  assert.ok(!/create policy[^;]*for (update|delete|all)\b/.test(sql), 'update·delete 정책 없음 — 지우기는 접기 함수만');
  assert.strictEqual((sql.match(/client_id uuid not null unique/g) || []).length, 2, '기록·판은 클라이언트 열쇠로 한 번만');
  assert.ok(/added     int not null default 0/.test(sql) && /removed   int not null default 0/.test(sql), '판에 줄 수');
  assert.ok(/where card_id = p_card for update;/.test(sql) && /if cur is not null and safe <= cur then return false;/.test(sql), '접기는 스냅샷 줄을 잡고 upto는 앞으로만');
  assert.ok(!/card_docs_insert/.test(sql), '스냅샷 표에는 넣기 정책도 없다(함수 둘로만)');
  assert.ok(/security definer/.test(sql) && /pg_advisory_xact_lock/.test(sql) && /interval '30 seconds'/.test(sql), '접기는 definer · 잠금 · 30초');
  assert.ok(/on conflict \(card_id\) do nothing/.test(sql), '심기는 먼저 넣은 쪽만');
  assert.ok((sql.match(/left\(realtime\.topic\(\), 7\) = 'coedit:'/g) || []).length === 2, '채널 정책은 coedit 접두만(읽기·보내기)');
  assert.ok(!/supabase_realtime/.test(sql), '실시간 발행에 넣지 않는다');
  assert.ok(/-- ── 되돌리기/.test(mig) && /drop table if exists public\.card_doc_updates/.test(mig));
  // 옛 글 채우기 — 본문이 있고 스냅샷이 없는 카드만 · 심는 식은 앱과 같다
  const rows = seedRows([{ id: 'x', description: SAMPLE }, { id: 'y', description: '' }, { id: 'z', description: '있음' }, { id: 'w', description: '   ' }], ['z'], schema);
  assert.deepStrictEqual(rows.map(r => r.card_id), ['x']);
  const d = new Y.Doc(); Y.applyUpdate(d, C.fromB64(rows[0].state));
  assert.strictEqual(C.docMarkdown(d), SAMPLE);
  assert.strictEqual(rows[0].upto, 0);
});


// ⑨ 업무 창 화면의 순수 부분(services/coedit/view.js · 2026-09-28) ─────────────────
// 되돌리기 검사(§3-5 · 2026-09-28 실제로 걷어 확인): versionLabel에서 `.filter(Boolean)`을 빼면
// '0인 쪽은 뺀다'가, PALETTE에 '#3f6fc4'보다 밝은 색(예: '#5b8def')을 넣으면 대비가 FAIL.
const V = await import(new URL('../src/services/coedit/view.js', import.meta.url).href);
await check('얼굴·이름표 색 — 흰 글자 대비 4.5:1 이상 · 사람마다 고정 · 서로 다른 색', () => {
  const lum = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const c of V.PALETTE) {
    assert.ok(/^#[0-9a-f]{6}$/.test(c), `${c}는 #rrggbb여야 한다(CollaborationCaret이 그 모양만 받는다)`);
    const ratio = 1.05 / (lum(c) + 0.05);
    assert.ok(ratio >= 4.5, `${c} — 흰 글자 대비 ${ratio.toFixed(2)}`);
  }
  assert.strictEqual(new Set(V.PALETTE).size, V.PALETTE.length, '같은 색이 두 번');
  assert.ok(V.PALETTE.length >= 6, '색이 너무 적으면 두 사람이 같은 색이 되기 쉽다');
  const id = '6f1c2d3e-0000-4000-8000-000000000001';
  assert.strictEqual(V.userColor(id), V.userColor(id), '같은 사람은 같은 색');
  assert.ok(V.PALETTE.includes(V.userColor(id)) && V.PALETTE.includes(V.userColor('')), '늘 팔레트 안');
});
await check("판 목록 뒷말 — '2줄 추가 · 1줄 제거' · 0인 쪽은 뺀다 · 가장 오래된 판은 '처음 작성한 본문'", () => {
  assert.strictEqual(V.versionLabel({ added: 2, removed: 1 }), '2줄 추가 · 1줄 제거');
  assert.strictEqual(V.versionLabel({ added: 3, removed: 0 }), '3줄 추가');
  assert.strictEqual(V.versionLabel({ added: 0, removed: 4 }), '4줄 제거');
  assert.strictEqual(V.versionLabel({ added: 0, removed: 0 }), '');
  assert.strictEqual(V.versionLabel({ added: 9, removed: 9 }, true), '처음 작성한 본문');
});
await check("판 시각 — '오늘 오후 3:12' · '어제 오전 9:05' · 같은 해는 날짜 · 다른 해는 해까지", () => {
  const now = new Date(2026, 8, 28, 22, 0);
  assert.strictEqual(V.versionTime(new Date(2026, 8, 28, 15, 12), now), '오늘 오후 3:12');
  assert.strictEqual(V.versionTime(new Date(2026, 8, 28, 0, 7), now), '오늘 오전 12:07');
  assert.strictEqual(V.versionTime(new Date(2026, 8, 27, 9, 5), now), '어제 오전 9:05');
  assert.strictEqual(V.versionTime(new Date(2026, 8, 25, 12, 30), now), '9월 25일 오후 12:30');
  assert.strictEqual(V.versionTime(new Date(2025, 11, 31, 23, 59), now), '2025년 12월 31일 오후 11:59');
  assert.strictEqual(V.versionTime('없는 날'), '');
});
await check('고친 곳 보기 — 줄 차이(같은·더한·뺀 줄) · 셈이 판 목록과 같다 · 바로 앞 판 → 이 판', () => {
  const rows = V.lineDiff('가\n나\n다\n라', '가\n나2\n다\n라\n마');
  assert.deepStrictEqual(rows.map(r => `${r.op}:${r.text}`), ['same:가', 'add:나2', 'del:나', 'same:다', 'same:라', 'add:마']);
  // 셈은 엔진의 lineDiffCounts와 같다(목록의 'N줄 추가 · M줄 제거'를 누르면 그만큼이 보인다)
  const pairs = [['', 'a\nb'], ['a\nb\nc', 'a\nc'], [SAMPLE, SAMPLE.replace('수련회', '가을 수련회') + '\n더한 줄'], ['x', '']];
  for (const [a, b] of pairs) {
    const r = V.lineDiff(a, b);
    const c = C.lineDiffCounts(a, b);
    assert.deepStrictEqual({ added: r.filter(x => x.op === 'add').length, removed: r.filter(x => x.op === 'del').length }, c, JSON.stringify([a.slice(0, 20), b.slice(0, 20)]));
    assert.strictEqual(r.filter(x => x.op !== 'del').map(x => x.text).join('\n'), b, '더한 줄 + 같은 줄 = 뒤 글');
  }
  const versions = [{ id: 3, md: '가\n나\n다' }, { id: 2, md: '가\n다' }, { id: 1, md: '가' }];   // 최신이 앞
  assert.deepStrictEqual(V.versionDiff(versions, 0).map(r => r.op), ['same', 'add', 'same'], '바로 앞 판에서');
  assert.deepStrictEqual(V.versionDiff(versions, 2).map(r => `${r.op}:${r.text}`), ['add:가'], '가장 오래된 판은 빈 글에서');
  assert.deepStrictEqual(V.versionDiff(versions, 9), []);
});
await check('머리줄 얼굴 — awareness에서 · 나 먼저 · 같은 사람은 한 번 · 이름 없는 상태는 뺀다', () => {
  const states = new Map([
    [7, { user: { id: 'u2', name: '조해리', color: '#c0392b' } }],
    [5, { user: { id: 'me', name: '노준석', color: '#2f6fb5' } }],
    [9, { user: { id: 'u2', name: '조해리', color: '#c0392b' } }],     // 같은 사람의 둘째 창
    [4, {}],                                                          // 아직 이름을 안 실은 창
    [8, { user: { id: 'u3', name: '이시온' } }],
  ]);
  const f = V.facesFrom(states, 5);
  assert.deepStrictEqual(f.map(x => x.name), ['노준석', '조해리', '이시온']);
  assert.ok(f[0].me && !f[1].me);
  assert.strictEqual(f[2].color, V.userColor('u3'), '색이 없으면 id로 고른다');
  assert.deepStrictEqual(V.facesFrom(null, 1), []);
});
await check('열 때 달랐나(divergedAtOpen)는 심었다 읽은 모양끼리 견준다 — 옛 글의 표기 차이만으로는 다르지 않다', () => {
  const legacy = '**==강조==**\n* 별 목록\n1) 번호';   // 옛 저장이 남긴 표기 — 심었다 읽으면 ==**강조**== · - · 1.
  const d = new Y.Doc(); Y.applyUpdate(d, C.seedState(legacy, schema));
  assert.notStrictEqual(C.fullMarkdown(d), legacy, '(전제) 날것끼리는 다르다');
  assert.strictEqual(C.fullMarkdown(d), C.normalizeMarkdown(legacy, schema), '같은 글이면 같다');
  assert.notStrictEqual(C.fullMarkdown(d), C.normalizeMarkdown(legacy + '\n다른 줄', schema), '글이 다르면 다르다');
});
await check('업무 창 배선 — 엔진은 늦게 받고 · 거울은 조용히 · 세션 끝에 한 번 · 게스트는 800ms', () => {
  const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const modals = src('../src/modals/modals.jsx'), ui = src('../src/modals/coedit.jsx'), view = src('../src/services/coedit/view.js');
  assert.ok(!/^import[^\n]*coedit\/(index|core|store)\.js/m.test(modals) && !/^import[^\n]*coedit\/(index|core|store)\.js/m.test(ui), '업무 창은 엔진을 정적으로 부르지 않는다');
  assert.ok(/import\('\.\.\/services\/coedit\/index\.js'\)/.test(ui), '엔진은 import()로 늦게');
  assert.ok(!/^import /m.test(view), 'view.js는 import 0(첫 조각에 실린다)');
  assert.ok(/onMirror: \(md\) => commit\(\{ content: md \}, \{ silentContent: true \}\)/.test(modals), '거울은 조용한 저장(활동·멘션은 세션 끝)');
  assert.ok(/onVersion: \(\{ startMd, endMd \}\) => onSessionRef\.current\?\.\(cardId, startMd, endMd\)/.test(modals), '세션 끝에 한 번');
  const ctrl = src('../src/hooks/controllers.js');
  assert.ok(/skipContent: silentContent/.test(ctrl) && /!silentContent && \(oldData\?\.content/.test(ctrl), '조용한 저장은 본문 기록·멘션을 만들지 않는다');
  assert.ok(/newMentionsOnly\(endMd, startMd, currentUser\.name\)/.test(ctrl), '세션 끝에는 새 멘션만');
  assert.ok(/export const BODY_IDLE_MS = 800;/.test(modals) && /export const NAME_IDLE_MS = 600;/.test(modals), '게스트 본문 800ms · 제목 600ms');
  assert.ok(/card\?\.content \|\| ''/.test(ui) && /cardWritePromise\(cardId\)/.test(ui), '새로 만든 업무는 카드 행이 들어간 뒤에 연다');
  assert.ok(/co\.adoptCheck\(live\.updatedAt\)/.test(ui) && /if \(!adopting\) cb\.current\.onVersion/.test(ui), '받아들이기는 엔진이 셋을 보고 · 그 세션은 활동을 안 남긴다');
});

if (failed) { console.log(`\n${failed} FAIL`); process.exit(1); }
process.exit(0);   // awareness의 점검 타이머가 남아 있어도 끝낸다
