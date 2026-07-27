// 모든 화면 × 데이터 상태 × 화면폭을 돌면서 ErrorBoundary가 뜨는지 / 콘솔 오류가 나는지
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:5173';
const OUT = import.meta.dirname;
const PORT = 9461;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cerr-'));
const chrome = spawn((process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
async function tg() { for (let i = 0; i < 40; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find(x => x.type === 'page'); if (p?.webSocketDebuggerUrl) return p; } catch {} await sleep(250); } throw new Error('fail'); }
const page = await tg();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const evs = []; let logs = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value || a.description || JSON.stringify(a.preview || {})).join(' ').slice(0, 400));
  else if (m.method === 'Runtime.exceptionThrown') logs.push('THROWN ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 400));
  else if (m.method) evs.push(m);
});
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const wait = async (m, to = 20000) => { const s = Date.now(); while (Date.now() - s < to) { const i = evs.findIndex(e => e.method === m); if (i >= 0) return evs.splice(i, 1)[0]; await sleep(50); } throw new Error(m); };
const ev = async (e, a = false) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description }; return r.result.value; };
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, n + '.png'), Buffer.from(data, 'base64')); };

const task = (i, over = {}) => ({
  id: 't' + i, projectId: 'p1', title: '업무 ' + i, content: '내용 ' + i, status: ['시작 전', '진행 중', '보류 중', '완료'][i % 4],
  assignees: i % 3 ? ['노준석'] : [], teams: i % 2 ? ['찬양팀'] : [], startDate: '', dueDate: '2026-08-0' + (i % 9 + 1),
  position: i, author: '노준석', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
  comments: [], activityLog: [], attachments: [], ...over,
});

const STATES = {
  '데이터 있음': {
    currentUser: { name: '노준석', team: '찬양팀' },
    projects: { byId: { p1: { id: 'p1', title: '2026 하계 수련회', pinnedLinks: [{ id: 'l1', title: '기획안', url: 'https://e.com' }] }, p2: { id: 'p2', title: '새신자 초청 주일', pinnedLinks: [] } }, allIds: ['p1', 'p2'] },
    tasks: { byId: Object.fromEntries([0, 1, 2, 3, 4].map(i => ['t' + i, task(i)])), allIds: ['t0', 't1', 't2', 't3', 't4'] },
  },
  '완전 빈 상태': {
    currentUser: { name: '노준석', team: '찬양팀' },
    projects: { byId: {}, allIds: [] },
    tasks: { byId: {}, allIds: [] },
  },
  '프로젝트 8개': {
    currentUser: { name: '노준석', team: '' },
    projects: { byId: Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['p' + (i + 1), { id: 'p' + (i + 1), title: '프로젝트 ' + (i + 1), pinnedLinks: [] }])), allIds: Array.from({ length: 8 }, (_, i) => 'p' + (i + 1)) },
    tasks: { byId: { t0: task(0) }, allIds: ['t0'] },
  },
  '팀 없는 업무만': {
    currentUser: { name: '노', team: '교역자' },
    projects: { byId: { p1: { id: 'p1', title: 'P', pinnedLinks: [] } }, allIds: ['p1'] },
    tasks: { byId: { t0: task(0, { teams: [], assignees: [], dueDate: '', title: '팀·담당자·마감 없음' }) }, allIds: ['t0'] },
  },
};

const VIEWS = [
  ['대시보드', '/', null],
  ['내 업무', '/', `[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('내 업무'))?.click()`],
  
  ['프로젝트 보드', '/?p=p1', null],
  ['프로젝트 캘린더', '/?p=p1', `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='캘린더')?.click()`],
  ['업무 상세', '/?p=p1', `document.querySelector('.board-card')?.click()`],
  ['업무 수정', '/?p=p1', `(async()=>{document.querySelector('.board-card')?.click();await new Promise(r=>setTimeout(r,700));[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='수정')?.click();})()`],
  // title로 정확히 집는다 — 텍스트로 찾으면 마감 리스트 행 버튼이 먼저 걸려 팀 보드로 못 간다
  ['팀 보드', '/', `document.querySelector('main button[title="찬양팀 보드로"]')?.click()`],
  ['팀 보드(교역자)', '/', `document.querySelector('main button[title="교역자 보드로"]')?.click()`],
];

await send('Page.enable'); await send('Runtime.enable');
const bad = [];

for (const [stateName, st] of Object.entries(STATES)) {
  for (const [w, h, label] of [[1440, 900, 'desk'], [390, 844, 'mob']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: label === 'mob' });
    await send('Emulation.setTouchEmulationEnabled', { enabled: label === 'mob', maxTouchPoints: 5 });
    await send('Page.navigate', { url: URL_BASE });
    await wait('Page.loadEventFired');
    await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','light')`);
    for (const [viewName, path, action] of VIEWS) {
      logs = [];
      await send('Page.navigate', { url: URL_BASE + path });
      await wait('Page.loadEventFired');
      await sleep(1100);
      if (action) await ev(action, action.startsWith('(async'));
      await sleep(action ? 900 : 400);
      const boundary = await ev(`(() => {
        const h3 = [...document.querySelectorAll('h3')].find(e => /렌더링 중 오류/.test(e.textContent));
        if (!h3) return null;
        return h3.parentElement.querySelector('p')?.textContent || '(메시지 없음)';
      })()`);
      const key = `${stateName} / ${label} / ${viewName}`;
      if (boundary) { bad.push(`ERRBOUND  ${key}\n          ${boundary}`); await shot(`err-${label}-${viewName.replace(/ /g, '')}-${stateName.replace(/ /g, '')}`); }
      const real = logs.filter(l => !/favicon|Failed to load resource|manifest/i.test(l));
      if (real.length) bad.push(`CONSOLE   ${key}\n          ${real.slice(0, 3).join('\n          ')}`);
    }
  }
}

console.log(bad.length ? bad.join('\n') : '전 화면 이상 없음 (' + Object.keys(STATES).length * 2 * VIEWS.length + '가지 조합)');
ws.close(); chrome.kill(); process.exit(bad.length ? 1 : 0);
