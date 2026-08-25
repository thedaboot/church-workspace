// 데스크톱 마우스 드래그 회귀 — PointerSensor → MouseSensor 교체 후 확인
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4173';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = 9361;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cdpDD-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
async function tg() { for (let i = 0; i < 40; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find(x => x.type === 'page'); if (p?.webSocketDebuggerUrl) return p; } catch {} await sleep(250); } throw new Error('fail'); }
const page = await tg();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const evs = []; const logs = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value || a.description).join(' '));
  else if (m.method) evs.push(m);
});
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const wait = async (m, to = 25000) => { const s = Date.now(); while (Date.now() - s < to) { const i = evs.findIndex(e => e.method === m); if (i >= 0) return evs.splice(i, 1)[0]; await sleep(50); } throw new Error(m); };
const ev = async (e, a = false) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const results = [];
const check = (n, p, d = '') => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
await ev(readFileSync(join(import.meta.dirname, 'seed.js'), 'utf8'));

const reload = async () => {
  await send('Page.navigate', { url: URL_BASE + '/?p=p1' });
  await wait('Page.loadEventFired');
  await sleep(1300);
};
const statusOf = (title) => ev(`(() => {
  const s = JSON.parse(localStorage.getItem('church_app_v4'));
  const t = Object.values(s.tasks.byId).find(x => x.title === ${JSON.stringify(title)});
  return { status: t.status, lastLog: t.activityLog.at(-1).action };
})()`);

await reload();
const dg = await ev(`(() => {
  const card = document.querySelector('.board-card');
  const cr = card.getBoundingClientRect();
  const heads = [...document.querySelectorAll('h3')].filter(h => /^(시작 전|진행 중|보류 중|완료)/.test(h.textContent.trim()));
  const target = heads.find(h => h.textContent.trim().startsWith('완료'));
  const tr = target.getBoundingClientRect();
  return { title: card.querySelector('span[class*="text-sm"]').textContent.trim(), heads: heads.length,
    from: { x: cr.left + cr.width / 2, y: cr.top + 26 }, to: { x: tr.left + tr.width / 2, y: tr.bottom + 140 } };
})()`);
const before = await statusOf(dg.title);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dg.from.x, y: dg.from.y, button: 'left', clickCount: 1 });
for (let i = 1; i <= 16; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left',
    x: dg.from.x + (dg.to.x - dg.from.x) * (i / 16), y: dg.from.y + (dg.to.y - dg.from.y) * (i / 16) });
  await sleep(25);
}
await sleep(150);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dg.to.x, y: dg.to.y, button: 'left', clickCount: 1 });
await sleep(800);
const after = await statusOf(dg.title);
check('데스크톱 마우스 드래그 → 컬럼 이동', after.status === '완료' && before.status !== '완료', `${before.status} → ${after.status}`);
check('데스크톱 드래그도 활동 기록', /완료/.test(after.lastLog || ''), after.lastLog);

// 짧은 클릭은 상세 열기 (드래그와 구분)
await reload();
const opened = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const card = document.querySelector('.board-card');
  const r = card.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + 26 };
})()`, true);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: opened.x, y: opened.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: opened.x, y: opened.y, button: 'left', clickCount: 1 });
await sleep(800);
check('데스크톱 클릭은 상세 열기', await ev(`!!document.querySelector('.fixed.inset-0.z-50')`), '');
// 핸드오프는 데스크톱 카드에도 우상단 ⇄ 를 둔다(드래그 말고도 옮길 수 있어야 한다)
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(400);
check('데스크톱 카드에도 상태 옮기기 버튼이 보인다', await ev(`(() => {
  const b = document.querySelector('.board-card button[title="상태 옮기기"]');
  return !!b && b.getBoundingClientRect().width > 0;
})()`), '');


// ── 같은 상태 안에서 순서 바꾸기 (0024) ────────────────────────────────────
// 되돌리기 검사: boards.jsx의 'card:' 드롭 갈래를 빼면 아래 두 단정이 깨진다.
await reload();
const colProbe = `(() => {
  const cards = [...document.querySelectorAll('.board-card')];
  const byX = new Map();
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    const key = Math.round(r.left / 10);
    if (!byX.has(key)) byX.set(key, []);
    byX.get(key).push({ title: c.querySelector('span[class*="text-sm"]').textContent.trim(),
      x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
  }
  for (const [, arr] of byX) if (arr.length >= 2) return { found: true, cards: arr };
  return { found: false, count: cards.length };
})()`;
const col = await ev(colProbe);
check('카드가 둘 이상인 컬럼이 있다', col.found === true, JSON.stringify(col).slice(0, 140));
if (col.found) {
  const a = col.cards[0], b = col.cards[1];
  const from = { x: a.x, y: a.top + 26 };
  const to = { x: b.x, y: b.bottom - 6 };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 16; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left',
      x: from.x + (to.x - from.x) * (i / 16), y: from.y + (to.y - from.y) * (i / 16) });
    await sleep(25);
  }
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  await sleep(900);
  const now = await ev(colProbe);
  const beforeOrder = col.cards.map(c => c.title);
  const afterOrder = now.found ? now.cards.map(c => c.title) : [];
  check('같은 상태 안에서 순서가 바뀐다', afterOrder.length >= 2 && afterOrder[0] !== beforeOrder[0],
    `${JSON.stringify(beforeOrder)} → ${JSON.stringify(afterOrder)}`);
  const saved = await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('church_app_v4'));
    const ps = Object.values(s.tasks.byId).map(t => t.position ?? 0);
    return { anyNonZero: ps.some(p => p > 0), positions: ps };
  })()`);
  check('바뀐 순서가 저장된다(position)', saved.anyNonZero === true, JSON.stringify(saved));
}

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
