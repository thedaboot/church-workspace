// 모바일에서 검색 / 알림 / 테마 전환이 실제로 닿는지
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const OUT = import.meta.dirname;
const PORT = 9451;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cmb-'));
const chrome = spawn((process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
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
const wait = async (m, to = 20000) => { const s = Date.now(); while (Date.now() - s < to) { const i = evs.findIndex(e => e.method === m); if (i >= 0) return evs.splice(i, 1)[0]; await sleep(50); } throw new Error(m); };
const ev = async (e, a = false) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, n + '.png'), Buffer.from(data, 'base64')); };
const results = [];
const check = (n, p, d = '') => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

const st = {
  currentUser: { name: '노준석', team: '찬양팀' },
  projects: { byId: { p1: { id: 'p1', title: '2026 하계 수련회', pinnedLinks: [] } }, allIds: ['p1'] },
  tasks: { byId: { t0: { id: 't0', projectId: 'p1', title: '수련회 포스터 시안', content: '', status: '진행 중',
    assignees: ['노준석'], teams: ['미디어팀'], startDate: '', dueDate: '2026-08-05', position: 0, author: '노준석',
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', comments: [], activityLog: [], attachments: [] } }, allIds: ['t0'] },
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','light')`);
await send('Page.navigate', { url: URL_BASE + '/?p=p1' });
await wait('Page.loadEventFired');
await sleep(1500);

// 1) 상단바 버튼 구성 (게스트 모드 = 알림 없음, 클라우드 모드에서만 종이 뜬다)
const bar = await ev(`(() => {
  // 프로젝트를 보고 있으면 제목이 h2가 아니라 '이름 수정' 버튼이다 → 검색 버튼으로 찾는다
  const top = [...document.querySelectorAll('div')].find(d => /md:hidden/.test(d.className||'') && d.querySelector('button[title="검색"]'));
  if (!top) return { none: true };
  return { titles: [...top.querySelectorAll('button')].map(b => b.title || b.getAttribute('aria-label') || '?') };
})()`);
check('모바일 상단바에 검색 버튼', bar.titles?.includes('검색'), JSON.stringify(bar));
check('게스트 모드라 알림 종은 없음(클라우드에서만 렌더)', !bar.titles?.includes('알림'), JSON.stringify(bar));

// 2) 검색: 아이콘 → 전체폭 오버레이 → 결과 클릭
await ev(`[...document.querySelectorAll('button[title="검색"]')].pop().click()`);
await sleep(450);
// 주의: 데스크톱 인라인 검색창도 DOM에 있다(hidden md:block → 폭 0).
// 실제로 보이는(폭이 있는) 입력만 골라야 한다.
const searchOpen = await ev(`(() => {
  const inps = [...document.querySelectorAll('input[placeholder*="검색"]')]
    .filter(i => i.getBoundingClientRect().width > 0);
  if (!inps.length) return { none: true };
  const inp = inps[0];
  const r = inp.getBoundingClientRect();
  return { visible: r.width > 200 && r.top >= 0, focused: document.activeElement === inp, width: Math.round(r.width) };
})()`);
check('검색 오버레이가 전체폭으로 열린다', searchOpen.visible === true && searchOpen.focused === true, JSON.stringify(searchOpen));
await shot('mob-search');
await ev(`(() => {
  const inp = [...document.querySelectorAll('input[placeholder*="검색"]')].find(i => i.getBoundingClientRect().width > 0);
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(inp, '포스터'); inp.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(600);
const hits = await ev(`(() => {
  const btns = [...document.querySelectorAll('button')].filter(b => /포스터/.test(b.textContent));
  return btns.length;
})()`);
check('검색 결과가 나온다', hits >= 1, `결과 버튼 ${hits}개`);
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
await sleep(350);

// 3) 테마: 하단 '내 정보' → 메뉴 → 다크 모드
await ev(`document.querySelector('div.md\\\\:hidden button[title="설정"]').click()`);
await sleep(450);
const pop = await ev(`(() => {
  const p = [...document.body.children].find(c => /z-\\[90\\]/.test(c.className || ''));
  if (!p) return { none: true };
  const r = p.getBoundingClientRect();
  return {
    items: [...p.querySelectorAll('button')].map(b => b.textContent.trim()),
    onScreen: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
    rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
    vh: window.innerHeight,
  };
})()`);
check('내 정보 메뉴가 화면 안에 온전히 뜬다', pop.onScreen === true, JSON.stringify(pop.rect) + ' / vh ' + pop.vh);
check('메뉴에 테마 전환 항목', pop.items?.some(t => /모드$/.test(t)), JSON.stringify(pop.items));
await shot('mob-profile-menu');
const themeBefore = await ev(`document.documentElement.dataset.theme`);
await ev(`(() => { const p=[...document.body.children].find(c=>/z-\\[90\\]/.test(c.className||''));
  if (!p) return 'no-popover';
  [...p.querySelectorAll('button')].find(b=>/모드$/.test(b.textContent.trim())).click(); return 'clicked'; })()`);
await sleep(500);
const themeAfter = await ev(`document.documentElement.dataset.theme`);
const stored = await ev(`localStorage.getItem('theme')`);
check('테마가 실제로 바뀐다', themeBefore === 'light' && themeAfter === 'dark', `${themeBefore} → ${themeAfter}`);
check('테마 선택이 저장된다', stored === 'dark', String(stored));
await sleep(300);
await shot('mob-dark-after-toggle');

// 4) 테마 전환은 메뉴를 닫지 않는다(라벨이 '라이트 모드'로 바뀜) → 그대로 다시 눌러 복귀
const labelNow = await ev(`(() => { const p=[...document.body.children].find(c=>/z-\\[90\\]/.test(c.className||''));
  return p ? [...p.querySelectorAll('button')].map(b=>b.textContent.trim()) : null; })()`);
check('테마 전환 후에도 메뉴는 열린 채 라벨이 뒤집힌다', labelNow?.includes('라이트 모드'), JSON.stringify(labelNow));
await ev(`(() => { const p=[...document.body.children].find(c=>/z-\\[90\\]/.test(c.className||''));
  if (!p) return 'no-popover';
  [...p.querySelectorAll('button')].find(b=>/모드$/.test(b.textContent.trim())).click(); return 'clicked'; })()`);
await sleep(450);
check('다시 라이트로 돌아온다', (await ev(`document.documentElement.dataset.theme`)) === 'light');

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 5).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
