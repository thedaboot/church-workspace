// 동시 편집 실측 — 로컬 vite(클라우드 모드, 라이브 Supabase) + 헤드리스 크롬 둘(검증하나=A, 검증둘=B) (+ C: A의 두 번째 창).
// node e2e.mjs <state.json> <origin>
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS_DIR; if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (p, name) => { if (!SHOTS) return; const { data } = await p.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, name + '.png'), Buffer.from(data, 'base64')); };
import { createClient } from '@supabase/supabase-js';

const st = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const ORIGIN = process.argv[3] || 'http://localhost:4605';
const REF = new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0];
const KEY = `sb-${REF}-auth-token`;
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); console.log(results.at(-1)); };
const errors = [];
const offline = { from: 0, to: 0 };
const logErr = (m) => errors.push({ t: Date.now(), m });

async function launch(port, tag) {
  const prof = mkdtempSync(join(tmpdir(), 'e2e-' + tag + '-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); } catch {} if (!target) await sleep(250); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') logErr(`[${tag}] ${d.params.exceptionDetails?.exception?.description?.split('\n')[0] || d.params.exceptionDetails?.text}`);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logErr(`[${tag}] console.error ${d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`[${tag}] ` + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const waitFor = async (expr, timeout = 8000, every = 40) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { try { if (await ev(expr)) return Date.now() - t0; } catch {} await sleep(every); }
    return -1;
  };
  return { tag, send, ev, waitFor, kill: () => { try { ws.close(); } catch {} try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} proc.kill(); } };
}

const H = {
  faces: `[...document.querySelectorAll('[data-face]')].map(e => e.dataset.face + (e.hasAttribute('data-editing') ? '*' : ''))`,
  pill: `(document.querySelector('[data-presence-pill]')?.textContent || '').trim()`,
  click: (label) => `(() => { const b = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === ${JSON.stringify(label)} && b.offsetParent); if (!b.length) return false; b[b.length - 1].click(); return true; })()`,
  ed: `document.querySelector('.ProseMirror')?.editor`,
  endOf: (txt) => `(() => { const ed = document.querySelector('.ProseMirror')?.editor; let at = null; ed.state.doc.descendants((n, pos) => { if (at == null && n.isTextblock && n.textContent.includes(${JSON.stringify(txt)})) at = pos + n.nodeSize - 1; }); return at; })()`,
  text: `document.querySelector('.ProseMirror')?.editor?.getText() || ''`,
  json: `JSON.stringify(document.querySelector('.ProseMirror')?.editor?.getJSON() || null)`,
  viewText: `(() => { const box = document.querySelector('[data-view-body]') || [...document.querySelectorAll('[data-line]')][0]?.parentElement; return box ? box.textContent : ''; })()`,
};

async function open(p, user) {
  await p.send('Page.navigate', { url: ORIGIN + '/' });
  await p.waitFor(`document.readyState === 'complete'`, 15000);
  await p.ev(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(user.session))}); true`);
  await p.send('Page.navigate', { url: `${ORIGIN}/?p=${st.projectId}&t=${st.cardId}` });
  const ms = await p.waitFor(`!!document.querySelector('[data-coedit-faces]') && [...document.querySelectorAll('[data-face]')].length > 0`, 25000);
  await p.send('Page.bringToFront');
  return ms;
}
async function type(p, txt, gap = 25) { for (const ch of txt) { await p.send('Input.insertText', { text: ch }); if (gap) await sleep(gap); } }
async function focusEnd(p, lineText) {
  const ok = await p.ev(`(() => { const ed = ${H.ed}; const at = ${H.endOf(lineText)}; if (at == null) return false; ed.commands.focus(at); return true; })()`);
  const f = await p.waitFor(`(() => { const ed = ${H.ed}; const at = ${H.endOf(lineText)}; return !!document.activeElement?.closest?.('.ProseMirror') && ed.state.selection.from === at; })()`, 3000, 20);
  await sleep(60);
  return ok && f >= 0;
}
const dbCard = async () => (await db.from('cards').select('title, status, description').eq('id', st.cardId).single()).data;
async function waitDb(pred, timeout = 12000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { const c = await dbCard(); if (pred(c)) return Date.now() - t0; await sleep(250); } return -1; }

const A = await launch(9711, 'A'), B = await launch(9712, 'B');
let C = null;
try {
  // ── 1. 동시 입장 감지 ────────────────────────────────────────────────────
  const tO = Date.now();
  const [aOpen, bOpen] = await Promise.all([open(A, st.users[0]), open(B, st.users[1])]);
  const viewDefault = await A.ev(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '수정' && b.offsetParent) && !document.querySelector('.ProseMirror')`);
  check('두 사람이 새 업무를 동시에 연다(보기 모드 기본)', aOpen >= 0 && bOpen >= 0 && viewDefault, `A ${aOpen}ms · B ${bOpen}ms`);
  const seenB = await A.waitFor(`${H.faces}.some(f => f.startsWith('검증둘'))`, 8000);
  const seenA = await B.waitFor(`${H.faces}.some(f => f.startsWith('검증하나'))`, 8000);
  check('동시 입장: 서로의 얼굴이 뜬다', seenB >= 0 && seenA >= 0, `연 뒤 ${Date.now() - tO}ms 안 · A=${JSON.stringify(await A.ev(H.faces))} B=${JSON.stringify(await B.ev(H.faces))}`);
  await sleep(1500);
  const docs = (await db.from('card_docs').select('card_id').eq('card_id', st.cardId)).data || [];
  const base = (await db.from('card_doc_versions').select('kind').eq('card_id', st.cardId)).data || [];
  const occurA = await A.ev(`(document.body.innerText.match(/첫째 항목/g) || []).length`);
  const occurB = await B.ev(`(document.body.innerText.match(/첫째 항목/g) || []).length`);
  check('동시에 처음 열어도 문서는 한 번만 심긴다(본문이 두 겹이 되지 않는다)', docs.length === 1 && occurA === 1 && occurB === 1, `card_docs ${docs.length} · A ${occurA} · B ${occurB}`);
  check('동시에 처음 열어도 기준 판은 한 줄', base.filter(v => v.kind === 'baseline').length === 1 && base.length === 1, JSON.stringify(base));

  // ── 2. 수정 중 파악 ──────────────────────────────────────────────────────
  await B.ev(H.click('수정'));
  await B.waitFor(`!!(${H.ed})`, 15000);
  const tE = Date.now();
  const pillMs = await A.waitFor(`${H.pill}.includes('검증둘님이 수정 중') && ${H.faces}.includes('검증둘*')`, 8000);
  check('수정 중: A 보기 화면에 "검증둘님이 수정 중" + 얼굴 연필', pillMs >= 0, `${pillMs >= 0 ? Date.now() - tE : -1}ms · pill="${await A.ev(H.pill)}"`);

  // ── 3. 줄 표시 ───────────────────────────────────────────────────────────
  await focusEnd(B, '셋째 항목');
  const markMs = await A.waitFor(`(() => { const m = document.querySelector('[data-line-mark="검증둘"]'); const t = document.querySelector('[data-line-tint]'); if (!m || !t) return false; const line = document.querySelector('[data-line="' + t.getAttribute('data-line-tint') + '"]'); return !!line && line.textContent.includes('셋째 항목'); })()`, 8000);
  const markFit = await A.ev(`(() => { const m = document.querySelector('[data-line-mark="검증둘"]'); if (!m) return null; const r = m.getBoundingClientRect(); let box = m.parentElement; while (box && getComputedStyle(box).overflow === 'visible') box = box.parentElement; const b = box.getBoundingClientRect(); return { right: Math.round(r.right), boxRight: Math.round(b.right), w: Math.round(r.width) }; })()`);
  check('줄 표시: B 커서 줄(셋째 항목)에 사진 표시', markMs >= 0, `${markMs}ms`);
  await shot(A, 'A-view-B-editing');
  check('줄 표시 사진이 잘리지 않는다', !!markFit && markFit.right <= markFit.boxRight && markFit.w >= 16, JSON.stringify(markFit));

  // ── 4. 바로 반영(B가 친 글이 A 보기 화면에) ───────────────────────────────
  const t4 = Date.now();
  await type(B, ' 가나다', 30);
  const liveMs = await A.waitFor(`document.body.innerText.includes('셋째 항목 가나다')`, 8000, 20);
  check('바로 반영: B 입력이 A 보기 화면에', liveMs >= 0, `마지막 글자 뒤 ${liveMs >= 0 ? Date.now() - t4 - 7 * 30 : -1}ms 정도`);

  // 커서를 빼면 줄 표시가 사라지고 알약은 남는다
  await B.ev(`(${H.ed}).commands.blur(); document.activeElement?.blur?.(); true`);
  const unmark = await A.waitFor(`!document.querySelector('[data-line-mark="검증둘"]') && ${H.pill}.includes('수정 중')`, 8000);
  check('커서를 빼면 줄 표시만 사라진다(수정 중은 남는다)', unmark >= 0, `${unmark}ms`);

  // ── 5. 동시 입력 — 다른 줄 ───────────────────────────────────────────────
  await A.ev(H.click('수정'));
  await A.waitFor(`!!(${H.ed})`, 15000);
  await A.waitFor(`(${H.text}).includes('가나다')`, 5000);
  await focusEnd(A, '첫째 항목'); await focusEnd(B, '둘째 항목');
  await Promise.all([type(A, ' a1a2a3a4a5a6a7a8', 15), type(B, ' b1b2b3b4b5b6b7b8', 15)]);
  await sleep(1500);
  const [ja, jb] = [await A.ev(H.json), await B.ev(H.json)];
  const ta = await A.ev(H.text);
  await shot(A, 'A-edit-with-B-caret'); await shot(B, 'B-edit-with-A-caret');
  check('동시 입력(다른 줄): 두 화면 문서가 같다', ja === jb, ja === jb ? '' : `A=${ta.slice(0, 200)} | B=${(await B.ev(H.text)).slice(0, 200)}`);
  check('동시 입력(다른 줄): 둘 다 남는다', ta.includes('첫째 항목 a1a2a3a4a5a6a7a8') && ta.includes('b1b2b3b4b5b6b7b8'), ta.slice(0, 160));

  // ── 6. 동시 입력 — 같은 자리 ─────────────────────────────────────────────
  await focusEnd(A, '마무리'); await focusEnd(B, '마무리');
  await Promise.all([type(A, 'XAXAXA', 10), type(B, 'YBYBYB', 10)]);
  await sleep(1500);
  const [ja2, jb2, ta2] = [await A.ev(H.json), await B.ev(H.json), await A.ev(H.text)];
  check('동시 입력(같은 자리): 두 화면 문서가 같다', ja2 === jb2);
  check('동시 입력(같은 자리): 각자 친 글이 흩어지지 않고 둘 다 남는다', ta2.includes('XAXAXA') && ta2.includes('YBYBYB'), ta2.split('\n').find(l => l.includes('마무리')));

  // ── 7. 지우는 줄에 동시에 입력 ─────────────────────────────────────────────
  await A.ev(`(() => { const ed = ${H.ed}; ed.commands.focus(${H.endOf('첫 문단')}); return true; })()`);
  await focusEnd(B, '첫 문단');
  await Promise.all([
    A.ev(`(() => { const ed = ${H.ed}; let from = null, to = null; ed.state.doc.descendants((n, pos) => { if (from == null && n.isTextblock && n.textContent.includes('첫 문단')) { from = pos; to = pos + n.nodeSize; } }); ed.chain().deleteRange({ from, to }).run(); return true; })()`),
    type(B, ' 지우는중입력', 5),
  ]);
  await sleep(1500);
  const [ja3, jb3] = [await A.ev(H.json), await B.ev(H.json)];
  check('지우는 줄에 동시에 입력: 두 화면 문서가 같다(깨지지 않는다)', ja3 === jb3, (await A.ev(H.text)).slice(0, 120));

  // ── 8. 필드 동시 수정 — A 제목 · B 상태 ───────────────────────────────────
  await Promise.all([
    A.ev(`(() => { const i = document.querySelector('input[name="title"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; i.focus(); set.call(i, '동시편집 검증 업무(제목 바꿈)'); i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); return true; })()`),
    B.ev(H.click('진행 중')),
  ]);
  const fieldsMs = await waitDb(c => c.title === '동시편집 검증 업무(제목 바꿈)' && c.status === 'doing', 10000);
  check('필드 동시 수정: DB에 제목과 상태가 둘 다 남는다', fieldsMs >= 0, JSON.stringify(await dbCard().then(c => ({ title: c.title, status: c.status }))));
  const bothUi = await A.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '진행 중' && /shadow-soft/.test(b.className))`, 6000)
    >= 0 && await B.waitFor(`document.querySelector('input[name="title"]')?.value === '동시편집 검증 업무(제목 바꿈)'`, 6000) >= 0;
  check('필드 동시 수정: 두 화면에 서로의 값이 보인다', bothUi);

  // ── 9. 저장 반영(description 거울) ─────────────────────────────────────────
  const mirrorMs = await waitDb(c => ['a1a2a3a4a5a6a7a8', 'b1b2b3b4b5b6b7b8', 'XAXAXA', 'YBYBYB', '가나다'].every(s => (c.description || '').includes(s)), 15000);
  check('저장 반영: description에 두 사람 글이 다 들어간다', mirrorMs >= 0, `${mirrorMs}ms (손 뗀 뒤)`);

  // ── 10. 끊겼다 다시 붙기 ──────────────────────────────────────────────────
  offline.from = Date.now();
  await B.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(1500);
  await focusEnd(A, '셋째 항목'); await type(A, ' ONA', 20);
  await focusEnd(B, '셋째 항목'); await type(B, ' OFFB', 20);
  await sleep(2500);
  const leaked = (await B.ev(H.text)).includes('ONA');
  await B.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const reconMs = await B.waitFor(`(${H.text}).includes('ONA')`, 30000, 100);
  const aHas = await A.waitFor(`(${H.text}).includes('OFFB')`, 30000, 100);
  await sleep(1000);
  offline.to = Date.now() + 3000;
  check('끊겼다 다시 붙기: 오프라인 동안은 정말 끊겨 있었다(실험 유효)', !leaked, leaked ? '오프라인 흉내가 소켓을 안 끊었다' : '');
  check('끊겼다 다시 붙기: 다시 붙으면 서로의 글이 합쳐진다', reconMs >= 0 && aHas >= 0 && (await A.ev(H.json)) === (await B.ev(H.json)), `B가 A 글 받음 ${reconMs}ms · A가 B 글 받음 ${aHas}ms`);

  // ── 11. 늦게 들어온 셋째 창(C = A의 두 번째 창) ─────────────────────────────
  C = await launch(9713, 'C');
  await open(C, st.users[0]);
  const aMd = await A.ev(H.text);
  const lateMs = await C.waitFor(`['ONA', 'OFFB', 'XAXAXA', 'a1a2a3a4a5a6a7a8'].every(s => document.body.innerText.includes(s))`, 12000);
  check('늦게 들어온 사람이 지금 본문을 그대로 본다', lateMs >= 0, `${lateMs}ms`);

  // ── 12. 닫는 순간 막 친 글 ────────────────────────────────────────────────
  await focusEnd(B, '마무리'); await type(B, ' LASTWORDS', 5);
  await B.ev(H.click('닫기'));
  const lastA = await A.waitFor(`(${H.text}).includes('LASTWORDS')`, 8000);
  const lastDb = await waitDb(c => (c.description || '').includes('LASTWORDS'), 12000);
  check('닫는 순간 막 친 글이 남는다(다른 화면·DB)', lastA >= 0 && lastDb >= 0, `A ${lastA}ms · DB ${lastDb}ms`);
  const goneMs = await A.waitFor(`!${H.faces}.some(f => f.startsWith('검증둘'))`, 10000);
  check('닫으면 B 얼굴·수정 중이 사라진다', goneMs >= 0 && !(await C.ev(H.pill)).includes('검증둘'), `${goneMs}ms`);

  // ── 13. 버전 기록 · 서식 diff · 되돌리기 ─────────────────────────────────────
  const vB = await db.from('card_doc_versions').select('id, by, md, added, removed').eq('card_id', st.cardId).order('at');
  check('B의 편집 세션이 버전 한 줄로 남는다', (vB.data || []).filter(v => v.by === st.users[1].id).length === 1, `${(vB.data || []).length}줄`);
  // A: 형광펜을 뺀다 → 수정 완료
  await A.ev(`(() => { const ed = ${H.ed}; let from = null; ed.state.doc.descendants((n, pos) => { if (from == null && n.isText && n.text.includes('형광펜')) from = pos + n.text.indexOf('형광펜'); }); ed.chain().focus().setTextSelection({ from, to: from + 3 }).unsetHighlight().run(); return true; })()`);
  await sleep(300);
  await A.ev(H.click('수정 완료'));
  const vA = await (async () => { for (let i = 0; i < 40; i++) { const r = await db.from('card_doc_versions').select('id, by, md').eq('card_id', st.cardId).eq('by', st.users[0].id).order('at', { ascending: false }).limit(1); if (r.data?.[0] && !r.data[0].md.includes('==형광펜==')) return r.data[0]; await sleep(300); } return null; })();
  check('수정 완료 → A의 버전이 남는다(형광펜 뺀 본문)', !!vA);
  await A.ev(H.click('버전 기록'));
  await A.waitFor(`document.querySelectorAll('[data-version-row]').length >= 2`, 8000);
  const rows = await A.ev(`[...document.querySelectorAll('[data-version-row]')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())`);
  const eds = (await db.from('card_doc_versions').select('by, editors, kind').eq('card_id', st.cardId).eq('kind', 'session')).data || [];
  check('판마다 그 사이에 같이 고친 사람이 실린다(editors)', eds.length >= 2 && eds.every(v => v.editors.includes(v.by)) && eds.some(v => v.editors.length === 2), JSON.stringify(eds.map(v => v.editors.length)));
  check('목록에 "○○○ 외 1명"이 선다', rows.some(r => /외 1명/.test(r)), JSON.stringify(rows));
  check('버전 기록 목록에 두 사람이 사진·이름·줄 수로 선다', rows.some(r => r.includes('검증하나')) && rows.some(r => r.includes('검증둘')) && rows.every(r => /줄 추가|줄 제거|처음 작성한 본문/.test(r)), JSON.stringify(rows));
  await A.ev(`(() => { document.querySelector('[data-version-row="${vA?.id}"]')?.click(); return true; })()`);
  await A.waitFor(`!!document.querySelector('[data-version-diff]')`, 5000);
  const diff = await A.ev(`(() => { const rows = [...document.querySelectorAll('[data-diff]')]; const hl = (r) => [...r.querySelectorAll('mark')].some(m => m.textContent.includes('형광펜')); const del = rows.filter(r => r.dataset.diff === 'del' && r.textContent.includes('형광펜')); const add = rows.filter(r => r.dataset.diff === 'add' && r.textContent.includes('형광펜')); return { del: del.length, delMark: del.some(hl), add: add.length, addMark: add.some(hl), raw: rows.some(r => r.textContent.includes('==')) }; })()`);
  await shot(A, 'A-diff');
  check('서식 diff: "형광펜" 글자가 이전 판에서는 칠해져 있고 이후 판에서는 아니다(원문 표기 없음)', diff.del >= 1 && diff.delMark && diff.add >= 1 && !diff.addMark && !diff.raw, JSON.stringify(diff));
  // 되돌리기: 가장 오래된 판(처음 본문)으로
  const first = (await db.from('card_doc_versions').select('id, md, kind').eq('card_id', st.cardId).eq('kind', 'baseline').limit(1)).data[0];
  const baseRow = await A.ev(`[...document.querySelectorAll('[data-version-row]')].find(r => r.dataset.versionRow === '${first?.id}')?.textContent || ''`);
  check('기준 판(원래 본문)이 목록에 "처음 작성한 본문"으로 선다', !!first && baseRow.includes('처음 작성한 본문'), baseRow);
  await A.ev(`(() => { document.querySelector('[data-version-row="${first.id}"]')?.click(); return true; })()`);
  await A.waitFor(`!!document.querySelector('[data-version-diff]')`, 5000);
  await A.ev(H.click('이 버전으로 되돌리기'));
  const norm = (s) => String(s || '').replace(/\r/g, '').trim();
  const restMs = await waitDb(c => norm(c.description) === norm(first.md), 15000);
  const cMs = await C.waitFor(`!document.body.innerText.includes('LASTWORDS') && !document.body.innerText.includes('ONA')`, 10000);
  check('이 버전으로 되돌리기: DB 본문이 그 판과 같아진다', restMs >= 0, `${restMs}ms`);
  check('이 버전으로 되돌리기: 다른 창(C)에도 바로 퍼진다', cMs >= 0, `${cMs}ms`);
  // 같은 판으로 한 번 더 — 오류 없이 그대로
  await A.ev(H.click('버전 기록'));
  await A.ev(`(() => { document.querySelector('[data-version-row="${first.id}"]')?.click(); return true; })()`);
  await A.waitFor(`!!document.querySelector('[data-version-diff]')`, 5000);
  await A.ev(H.click('이 버전으로 되돌리기'));
  await sleep(3000);
  check('같은 판으로 두 번 되돌려도 그대로(오류 없음)', norm((await dbCard()).description) === norm(first.md));

  // ── 14. 새로고침 직후 다시 들어오기 ─────────────────────────────────────────
  await A.send('Page.reload');
  await A.waitFor(`!!document.querySelector('[data-coedit-faces]')`, 25000);
  const reMs = await A.waitFor(`document.body.innerText.includes('첫째 항목') && !document.body.innerText.includes('LASTWORDS')`, 10000);
  check('새로고침 뒤 다시 들어와도 본문이 같다', reMs >= 0);

  // ── 15. 수정 중인 사람이 브라우저를 끄면 ────────────────────────────────────
  await A.waitFor(`!${H.faces}.some(f => f.startsWith('검증둘'))`, 5000);
  const bReady = await (async () => { await open(B, st.users[1]); return Date.now(); })();
  const joinMs = await A.waitFor(`${H.faces}.some(f => f.startsWith('검증둘'))`, 10000, 20);
  check('들어오는 사람 감지: B 창이 뜬 뒤 A 화면에 얼굴이 뜬다(3초 안)', joinMs >= 0 && joinMs <= 3000, `${joinMs}ms`);
  await B.ev(H.click('수정'));
  await B.waitFor(`!!(${H.ed})`, 15000);
  await A.waitFor(`${H.pill}.includes('검증둘님이 수정 중')`, 8000);
  const tk = Date.now();
  B.kill();
  const killMs = await A.waitFor(`!${H.pill}.includes('검증둘') && !${H.faces}.some(f => f.startsWith('검증둘'))`, 45000, 250);
  check('수정 중인 사람이 브라우저를 끄면 표시가 사라진다(10초 안)', killMs >= 0 && Date.now() - tk <= 10000 + 1000, `${killMs >= 0 ? Date.now() - tk : -1}ms`);
} catch (e) {
  check('하니스 예외 없이 끝까지', false, e.message);
} finally {
  A.kill(); B.kill(); C?.kill();
  console.log('\n' + results.join('\n'));
  const real = errors.filter(e => !(e.t >= offline.from && e.t <= offline.to && /Failed to fetch|ERR_INTERNET_DISCONNECTED|network/i.test(e.m)));
  console.log(real.length ? '\n콘솔 오류:\n' + [...new Set(real.map(e => e.m))].join('\n') : `\n콘솔 오류 없음(오프라인 흉내 동안의 네트워크 실패 ${errors.length - real.length}건은 뺐다)`);
  process.exit(results.some(r => r.startsWith('FAIL')) || real.length ? 1 : 0);
}
