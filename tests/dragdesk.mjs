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


// ── 상시 줄 (0075 · 사용자가 목업에서 고른 C안) ────────────────────────────
// 상시는 칸이 아니라 네 칸 **위 한 줄**이다. 카드를 줄에 놓으면 상시(날짜가 지워진다),
// 줄의 칩을 칸에 놓으면 그 상태. 공용 시드에 상시 한 건('예배 순번표')이 있다.
// 되돌리기 검사: boards.jsx의 `if (raw === ONGOING_DROP)` 갈래를 빼면 '카드를 줄에 놓으면 상시'가 깨진다.
{
  const drag = async (from, to) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 16; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left',
        x: from.x + (to.x - from.x) * (i / 16), y: from.y + (to.y - from.y) * (i / 16) });
      await sleep(25);
    }
    await sleep(150);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
    await sleep(900);
  };
  const taskOf = (title) => ev(`(() => {
    const s = JSON.parse(localStorage.getItem('church_app_v4'));
    const t = Object.values(s.tasks.byId).find(x => x.title === ${JSON.stringify(title)});
    return t ? { status: t.status, dueDate: t.dueDate || '', startDate: t.startDate || '' } : null;
  })()`);
  await reload();
  const row = await ev(`(() => {
    const r = document.querySelector('[data-ongoing-row]');
    if (!r) return null;
    const chips = [...r.querySelectorAll('.ongoing-chip')];
    const heads = [...document.querySelectorAll('h3')].map(h => h.textContent.trim()).filter(t => /^(시작 전|진행 중|보류 중|완료|상시)$/.test(t));
    const rr = r.getBoundingClientRect();
    const firstCol = document.querySelector('.board-card')?.getBoundingClientRect();
    return { pill: r.firstElementChild.textContent.trim(), chips: chips.map(c => c.textContent.trim()), heads,
      aboveCols: !!firstCol && rr.bottom <= firstCol.top, noDate: chips.every(c => !/D-|지남|\\d+\\. \\d+\\./.test(c.textContent)) };
  })()`);
  check('상시 줄이 칸 위에 서고 머리에 `상시 1`', !!row && row.pill === '상시 1' && row.aboveCols, JSON.stringify(row));
  check('상시는 다섯째 칸이 아니다', !!row && row.heads.length === 4 && !row.heads.includes('상시'), JSON.stringify(row?.heads));
  check('상시 칩은 제목 + 얼굴(날짜 없음)', !!row && row.chips.length === 1 && row.chips[0].startsWith('예배 순번표') && row.noDate, JSON.stringify(row?.chips));

  // 카드 → 상시 줄 (셀렉터를 못 찾으면 던지지 않고 FAIL로 남긴다 · PITFALLS §6-40)
  const c = await ev(`(() => {
    const card = document.querySelector('.board-card'); const row = document.querySelector('[data-ongoing-row]');
    if (!card || !row) return null;
    const cr = card.getBoundingClientRect(), rr = row.getBoundingClientRect();
    return { title: card.querySelector('span[class*="text-sm"]').textContent.trim(),
      from: { x: cr.left + cr.width / 2, y: cr.top + 26 }, to: { x: rr.right - 40, y: rr.top + rr.height / 2 } };
  })()`);
  if (c) await drag(c.from, c.to);
  const moved = c ? await taskOf(c.title) : null;
  check('카드를 상시 줄에 놓으면 상시가 되고 날짜가 지워진다', moved?.status === '상시' && !moved.dueDate && !moved.startDate, JSON.stringify(moved));
  check('줄의 머리가 `상시 2`로', await ev(`document.querySelector('[data-ongoing-row]')?.firstElementChild.textContent.trim() || null`) === '상시 2', '');

  // 칩끼리 순서 바꾸기(사용자 요청 2026-09-25) — 둘째 칩을 첫째 칩 위에 놓으면 앞으로 온다.
  // 되돌리기 검사: OngoingChip의 `useDroppable({ id: \`card:${task.id}\` })`를 빼면 줄 빈 자리(⓪)로
  // 떨어져 맨 끝에 남고 이 단정이 깨진다.
  const chipOrder = () => ev(`[...document.querySelectorAll('.ongoing-chip')].map(c => c.title)`);
  const before = await chipOrder();
  const sw = await ev(`(() => {
    const cs = [...document.querySelectorAll('.ongoing-chip')];
    if (cs.length < 2) return null;
    const a = cs[0].getBoundingClientRect(), b = cs[1].getBoundingClientRect();
    return { from: { x: b.left + 20, y: b.top + b.height / 2 }, to: { x: a.left + 12, y: a.top + a.height / 2 } };
  })()`);
  if (sw) await drag(sw.from, sw.to);
  const after = await chipOrder();
  check('상시 칩을 다른 칩 위에 놓으면 그 자리로 순서가 바뀐다',
    !!sw && before?.length === 2 && after?.[0] === before[1] && after?.[1] === before[0], JSON.stringify({ before, after }));

  // 칩 → '진행 중' 칸 머리 바로 아래
  const k = await ev(`(() => {
    const chip = [...document.querySelectorAll('.ongoing-chip')].find(x => x.textContent.includes('예배 순번표'));
    const head = [...document.querySelectorAll('h3')].find(x => x.textContent.trim() === '진행 중');
    if (!chip || !head) return null;
    const cr = chip.getBoundingClientRect(), h = head.getBoundingClientRect();
    return { from: { x: cr.left + 20, y: cr.top + cr.height / 2 }, to: { x: h.left + 20, y: h.bottom + 60 } };
  })()`);
  if (k) await drag(k.from, k.to);
  const back = await taskOf('예배 순번표');
  check('상시 칩을 칸에 놓으면 그 상태가 된다', !!k && back?.status === '진행 중', JSON.stringify(back));

  // 짧게 누르면 업무 창
  const chip2 = await ev(`(() => { const el = document.querySelector('.ongoing-chip'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
  if (chip2) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: chip2.x, y: chip2.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: chip2.x, y: chip2.y, button: 'left', clickCount: 1 });
    await sleep(800);
  }
  check('상시 칩을 누르면 업무 창이 열린다', !!chip2 && await ev(`!!document.querySelector('.fixed.inset-0.z-50')`), '');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(400);
}


// ── 같은 컬럼 맨 밑으로 옮기기 ─────────────────────────────────────────────
// 컬럼의 빈 자리(마지막 카드 아래)에 놓으면 맨 밑으로 간다. 예전에는 같은 상태면
// 그냥 돌아가서 **맨 밑으로 못 옮겼다**(사용자 지적).
// 공용 시드는 컬럼마다 카드가 서른 장 넘어 화면 끝까지 차 있다 — 빈 자리가 없어서
// 이 상황을 재현할 수 없다. 그래서 이 검사만 카드 셋짜리 시드를 쓴다.
// 되돌리기 검사: boards.jsx의 `if (isChip && task.status === target) return;`을
// `if (task.status === target) return;`으로 되돌리면 마지막 단정이 깨진다.
{
  const mkT = (n, due) => ({ id: 'z' + n, projectId: 'p1', title: '짧은 업무 ' + n, content: 'x',
    status: '시작 전', assignees: ['노준석'], teams: ['찬양팀'], startDate: '', dueDate: due,
    position: n, author: '노준석', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    comments: [], activityLog: [], attachments: [] });
  const small = {
    currentUser: { name: '노준석', team: '임원진' },
    projects: { byId: { p1: { id: 'p1', title: '짧은 프로젝트', pinnedLinks: [] } }, allIds: ['p1'] },
    tasks: { byId: { z1: mkT(1, '2026-08-10'), z2: mkT(2, '2026-08-11'), z3: mkT(3, '2026-08-12') },
             allIds: ['z1', 'z2', 'z3'] },
  };
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(small))})`);
  await reload();
  const probe = `(() => {
    const cards = [...document.querySelectorAll('.board-card')];
    const list = cards.map(c => {
      const r = c.getBoundingClientRect();
      return { title: c.querySelector('span[class*="text-sm"]').textContent.trim(),
        x: Math.round(r.left + r.width / 2), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }).filter(c => c.title.startsWith('짧은 업무'));
    return { list };
  })()`;
  const before = await ev(probe);
  check('짧은 시드에서 카드 셋이 보인다', before.list.length === 3, JSON.stringify(before.list.map(c => c.title)));
  if (before.list.length === 3) {
    const first = before.list[0], last = before.list[2];
    const empty = await ev(`(() => {
      const x = ${last.x};
      for (let y = ${last.bottom} + 8; y < window.innerHeight - 20; y += 8) {
        const el = document.elementFromPoint(x, y);
        if (!el || el.closest('.board-card')) continue;
        if (!el.closest('[class*="overflow-x-auto"]')) break;
        return { x, y };
      }
      return null;
    })()`);
    check('컬럼에 빈 자리가 있다', !!empty, JSON.stringify(empty));
    if (empty) {
      const from = { x: first.x, y: first.top + 26 };
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 16; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left',
          x: from.x + (empty.x - from.x) * (i / 16), y: from.y + (empty.y - from.y) * (i / 16) });
        await sleep(25);
      }
      await sleep(150);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: empty.x, y: empty.y, button: 'left', clickCount: 1 });
      await sleep(900);
      const after = await ev(probe);
      const names = after.list.map(c => c.title);
      check('빈 자리에 놓으면 **맨 밑**으로 간다', names.length === 3 && names[2] === first.title,
        `${first.title} → ${JSON.stringify(names)}`);
    }
  }
}

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
