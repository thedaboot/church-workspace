// 모바일 실제 터치 드래그 검증 — 길게 누르기 → 상태 칩에 놓기 / 옆 컬럼에 놓기
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4173';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = 9360;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cdpD-'));
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

// 손가락 하나로: 누르고(hold) → 천천히 이동 → 놓기
async function touchDrag(from, to, { hold = 320, steps = 14 } = {}) {
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) });
  await sleep(hold); // 길게 누르기 인식 대기 (센서 delay 200ms)
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * (i / steps);
    const y = from.y + (to.y - from.y) * (i / steps);
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x, y) });
    await sleep(28);
  }
  await sleep(180);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
}

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
await ev(readFileSync(join(import.meta.dirname, 'seed.js'), 'utf8'));

const reload = async () => {
  await send('Page.navigate', { url: URL_BASE + '/?p=p1' });
  await wait('Page.loadEventFired');
  await sleep(1300);
};
const geom = () => ev(`(() => {
  const card = document.querySelector('.board-card');
  const cr = card.getBoundingClientRect();
  const chips = [...document.querySelectorAll('button')].filter(b => /^(시작 전|진행 중|보류 중|완료)\\s*\\d+$/.test(b.textContent.trim().replace(/\\s+/g, ' ')));
  const chipBoxes = chips.map(c => { const r = c.getBoundingClientRect(); return { label: c.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  return { title: card.querySelector('span[class*="text-sm"]').textContent.trim(),
    card: { x: cr.left + cr.width / 2, y: cr.top + 26 }, chips: chipBoxes };
})()`);
const statusOf = (title) => ev(`(() => {
  const s = JSON.parse(localStorage.getItem('church_app_v4'));
  const t = Object.values(s.tasks.byId).find(x => x.title === ${JSON.stringify(title)});
  return { status: t.status, lastLog: t.activityLog.at(-1).action, logs: t.activityLog.length };
})()`);

// ── 1) 카드 → '완료' 상태 칩 ──
await reload();
let g = await geom();
check('상태 칩 4개 인식', g.chips.length === 4, g.chips.map(c => c.label).join(' | '));
const before = await statusOf(g.title);
const doneChip = g.chips.find(c => c.label.startsWith('완료'));
await touchDrag(g.card, doneChip);
let after = await statusOf(g.title);
check('터치 드래그 → 상태 칩에 놓기', after.status === '완료' && before.status !== '완료', `${before.status} → ${after.status}`);
check('칩 드롭도 활동 기록 남음', /완료/.test(after.lastLog), after.lastLog);

// ── 2) 카드 → 옆 컬럼(부분만 보이는 영역) ──
await reload();
g = await geom();
const b2 = await statusOf(g.title);
await touchDrag(g.card, { x: 360, y: g.card.y + 40 }); // 오른쪽 옆 컬럼 살짝 보이는 지점
after = await statusOf(g.title);
check('터치 드래그 → 옆 컬럼에 놓기', after.status !== b2.status, `${b2.status} → ${after.status}`);

// ── 3) 짧게 탭하면 드래그가 아니라 카드 열기 ──
await reload();
g = await geom();
const b3 = await statusOf(g.title);
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g.card.x, y: g.card.y, id: 1 }] });
await sleep(80);
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(800);
const tapped = await ev(`(() => ({ modal: !!document.querySelector('.fixed.inset-0.z-50') }))()`);
const s3 = await statusOf(g.title);
check('짧은 탭은 상세 열기(상태 안 바뀜)', s3.status === b3.status, `${b3.status} → ${s3.status}`);
check('짧은 탭으로 모달 열림', tapped.modal === true, `modal ${tapped.modal}`);

// ── 4) 세로 스와이프는 스크롤(드래그로 오인되지 않음) ──
await reload();
g = await geom();
const b4 = await statusOf(g.title);
const beforeScroll = await ev(`(() => { const c = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-y-auto') && d.className.includes('space-y-2.5')); return c ? c.scrollTop : -1; })()`);
const pt = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }];
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(g.card.x, g.card.y) });
for (let i = 1; i <= 10; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(g.card.x, g.card.y - i * 18) }); await sleep(16); }
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(700);
const s4 = await statusOf(g.title);
check('빠른 세로 스와이프는 상태를 바꾸지 않음', s4.status === b4.status, `${b4.status} → ${s4.status}`);

// ── 5) 카드 레이아웃: 마감일이 오른쪽 끝, ⇄는 상단 ──
const layout = await ev(`(() => {
  const card = document.querySelector('.board-card');
  const cr = card.getBoundingClientRect();
  // 핸드오프 카드: 푸터 오른쪽의 D-day 배지(D-13 / 오늘 / 3일 지남 / 8. 13.)
  // 주의: 이 문자열은 템플릿 리터럴이라 \d가 그냥 d로 죽는다 → [0-9]로 쓴다
  const due = [...card.querySelectorAll('span')].find(d => /^(D-[0-9]+|오늘|[0-9]+일 지남|[0-9]+[.] [0-9]+[.])$/.test(d.textContent.trim()));
  const btn = card.querySelector('button[title="상태 옮기기"]');
  if (!due || !btn) return { error: !due ? '마감일 없음' : '버튼 없음' };
  const dr = due.getBoundingClientRect(), br = btn.getBoundingClientRect();
  return {
    dueRightGap: Math.round(cr.right - dr.right),   // 카드 우측 여백(패딩만큼이면 우측 정렬)
    btnAboveDue: br.bottom < dr.top,                 // 버튼이 마감일보다 위
    btnRightGap: Math.round(cr.right - br.right),
  };
})()`);
check('마감일이 카드 오른쪽 끝에 정렬', !layout.error && layout.dueRightGap <= 16, JSON.stringify(layout));
check('상태 옮기기 버튼이 상단으로 이동', layout.btnAboveDue === true, `btnAboveDue ${layout.btnAboveDue}`);


// ── 모바일: 같은 상태 안에서 순서 바꾸기 (0024) ────────────────────────────
// 데스크톱과 같은 조작이 터치에서도 되어야 한다. 그리고 **세로 스크롤을 죽이지
// 않는 것**이 여기서 더 중요하다 — 카드가 드롭 대상이 되면서 손가락이 카드 위를
// 지나가는 일이 잦아졌다(위 '빠른 세로 스와이프' 단정이 그 방어다).
await reload();
const colProbe = `(() => {
  const cards = [...document.querySelectorAll('.board-card')];
  const byX = new Map();
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (r.width < 10 || r.bottom < 0) continue;
    const key = Math.round(r.left / 10);
    if (!byX.has(key)) byX.set(key, []);
    byX.get(key).push({ title: c.querySelector('span[class*="text-sm"]').textContent.trim(),
      x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
  }
  for (const [, arr] of byX) if (arr.length >= 2) return { found: true, cards: arr.slice(0, 6) };
  return { found: false, count: cards.length };
})()`;
const mcol = await ev(colProbe);
check('모바일에서 카드가 둘 이상인 컬럼이 있다', mcol.found === true, JSON.stringify(mcol).slice(0, 120));
if (mcol.found) {
  const a = mcol.cards[0], b = mcol.cards[1];
  await touchDrag({ x: a.x, y: a.top + 24 }, { x: b.x, y: b.bottom - 6 });
  const now = await ev(colProbe);
  const before = mcol.cards.map(c => c.title);
  const after = now.found ? now.cards.map(c => c.title) : [];
  check('모바일 터치 드래그로 같은 상태 안 순서가 바뀐다',
    after.length >= 2 && after[0] !== before[0], `${JSON.stringify(before.slice(0,3))} → ${JSON.stringify(after.slice(0,3))}`);
  const saved = await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('church_app_v4'));
    const ps = Object.values(s.tasks.byId).map(t => t.position ?? 0);
    return { anyNonZero: ps.some(p => p > 0) };
  })()`);
  check('모바일에서도 순서가 저장된다', saved.anyNonZero === true, JSON.stringify(saved));
}

// 컬럼 안 세로 스크롤이 살아 있는지 — 카드가 드롭 대상이 된 뒤에도
await reload();
const scrolled = await ev(`(() => {
  const col = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 40 && d.querySelector('.board-card'));
  if (!col) return { found: false };
  const before = col.scrollTop;
  col.scrollTop = 120;
  const after = col.scrollTop;
  col.scrollTop = before;
  return { found: true, moved: after > before };
})()`);
check('컬럼 안 세로 스크롤이 살아 있다', scrolled.found === false || scrolled.moved === true, JSON.stringify(scrolled));

// ── 모바일 프로젝트 탭 줄: 길게 눌러 순서 바꾸기 ───────────────────────────
// 데스크톱은 네이티브 draggable로 이미 됐고, 모바일은 **가로 스크롤**과 부딪히지 않게
// 길게 누르기로 시작한다(TouchSensor delay). 세 가지를 본다:
//   ① 길게 눌러 뒤로 끌면 놓은 탭 **뒤**로 간다(§6-12-a — 앞에만 끼우면 제자리다)
//   ② 짧게 누르면 여전히 그 프로젝트로 이동한다(드래그가 탭 누르기를 먹지 않는다)
//   ③ 탭 줄의 가로 스크롤이 살아 있다(x-scroll-lock)
await ev(`(() => {
  const s = JSON.parse(localStorage.getItem('church_app_v4'));
  s.projects.byId.p1.title = '탭 하나';
  s.projects.byId.p2 = { id: 'p2', title: '탭 둘', pinnedLinks: [] };
  s.projects.byId.p3 = { id: 'p3', title: '탭 셋', pinnedLinks: [] };
  s.projects.allIds = ['p1', 'p2', 'p3'];
  localStorage.setItem('church_app_v4', JSON.stringify(s));
})()`);
await reload();
const tabRow = `(() => {
  const row = [...document.querySelectorAll('div')].find(d => /x-scroll-lock/.test(d.className || ''));
  if (!row) return { found: false };
  const tabs = [...row.querySelectorAll('button')]
    .filter(b => /^탭 (하나|둘|셋)$/.test(b.textContent.trim()))
    .map(b => { const r = b.getBoundingClientRect();
      return { title: b.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const order = Object.values(JSON.parse(localStorage.getItem('church_app_v4')).projects.byId)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(p => p.title);
  return { found: true, tabs, order, scrollable: row.scrollWidth > row.clientWidth };
})()`;
const t0 = await ev(tabRow);
check('모바일 탭 줄에 프로젝트 탭 3개', t0.found && t0.tabs.length === 3, JSON.stringify(t0.tabs?.map(t => t.title)));
if (t0.found && t0.tabs.length === 3) {
  // ① 첫 탭을 세 번째 탭 위로 — 뒤로 끌었으므로 '탭 셋' **뒤**여야 한다
  await touchDrag(t0.tabs[0], t0.tabs[2], { hold: 520, steps: 12 });
  const t1 = await ev(tabRow);
  check('길게 눌러 끌면 탭 순서가 바뀐다', t1.order.join() !== t0.order.join(), `${t0.order} → ${t1.order}`);
  check('뒤로 끌면 놓은 탭 뒤에 들어간다(제자리로 안 돌아온다)',
    t1.order.join() === ['탭 둘', '탭 셋', '탭 하나'].join(), JSON.stringify(t1.order));
  // ② 짧게 누르면 그대로 그 프로젝트로 이동한다
  const target = t1.tabs.find(t => t.title === '탭 둘');
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target.x, y: target.y, id: 1 }] });
  await sleep(70);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
  const moved = await ev(`new URLSearchParams(location.search).get('p')`);
  const t2 = await ev(tabRow);
  check('짧게 누르면 그 프로젝트로 이동한다', moved === 'p2', `p=${moved}`);
  check('짧은 탭은 순서를 바꾸지 않는다', t2.order.join() === t1.order.join(), JSON.stringify(t2.order));
  // ③ 탭 줄 가로 스크롤(x-scroll-lock)이 살아 있다
  const rowScroll = await ev(`(() => {
    const row = [...document.querySelectorAll('div')].find(d => /x-scroll-lock/.test(d.className || ''));
    if (!row) return { found: false };
    if (row.scrollWidth <= row.clientWidth) return { found: true, noOverflow: true };
    const before = row.scrollLeft; row.scrollLeft = 60; const after = row.scrollLeft; row.scrollLeft = before;
    return { found: true, moved: after > before };
  })()`);
  check('탭 줄 가로 스크롤이 살아 있다', rowScroll.found && (rowScroll.noOverflow || rowScroll.moved), JSON.stringify(rowScroll));
}

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
