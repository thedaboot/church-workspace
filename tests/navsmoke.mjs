// 재디자인 스모크 — 상단 2줄 내비 / 프로필 메뉴 / 더보기 / 모바일 탭바 / 멘션 방향키 스크롤
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = 9441;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cnav-'));
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
  else if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || 'exception');
  else if (m.method) evs.push(m);
});
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const wait = async (m, to = 20000) => { const s = Date.now(); while (Date.now() - s < to) { const i = evs.findIndex(e => e.method === m); if (i >= 0) return evs.splice(i, 1)[0]; await sleep(50); } throw new Error(m); };
const ev = async (e, a = false) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const results = [];
const check = (n, p, d = '') => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

// 프로젝트 8개 = 탭 5개 + 더보기 3개, 멤버 12명 = 멘션 목록 스크롤
const MEMBERS = ['강민수', '김승찬', '김윤주', '노준석', '문진혁', '박지호', '배현민', '양민혁', '이시온', '임재훈', '정민경', '조해리'];
const projects = {}; const pids = [];
for (let i = 1; i <= 8; i++) { const id = 'p' + i; pids.push(id); projects[id] = { id, title: `프로젝트 ${i}`, pinnedLinks: [] }; }
const byId = {}; const allIds = [];
for (let i = 0; i < 6; i++) {
  const id = 't' + i;
  // 게스트 모드의 멘션 후보 = 현재 사용자 + 모든 담당자 → 담당자를 흩뿌려 목록을 길게
  byId[id] = { id, projectId: 'p1', title: `업무 ${i}`, content: '내용', status: '시작 전',
    assignees: MEMBERS.slice(i * 2, i * 2 + 2), teams: ['찬양팀'], startDate: '', dueDate: '2026-08-1' + i, position: i,
    author: '노준석', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
    comments: [], activityLog: [], attachments: [] };
  allIds.push(id);
}
const st = {
  currentUser: { name: '노준석', team: '찬양팀' },
  members: MEMBERS.map(n => ({ id: n, name: n, team: '찬양팀' })),
  projects: { byId: projects, allIds: pids },
  tasks: { byId, allIds },
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','light')`);
await send('Page.navigate', { url: URL_BASE + '/?p=p1' });
await wait('Page.loadEventFired');
await sleep(1500);

// 1) 사이드바 사라짐 / 상단 2줄 내비
const nav = await ev(`(() => {
  const side = [...document.querySelectorAll('div')].some(d => /(^| )w-64( |$)/.test(d.className));
  // 모바일 상단바도 DOM에는 있으니(md:hidden) 데스크톱 내비만 골라서 센다
  const desk = [...document.querySelectorAll('div')].find(d => /hidden md:block/.test(d.className) && d.querySelector('button[title="설정"]'));
  const gnav = [...(desk || document).querySelectorAll('button')].map(b => b.textContent.trim());
  return {
    sidebar: side,
    hasDash: gnav.some(t => t === '전체 대시보드'),
    hasMine: gnav.some(t => t.startsWith('내 업무')),
    hasGuide: gnav.some(t => t === '사용 가이드'),   // 이제 없어야 한다
    profileItems: null,
    projTabs: gnav.filter(t => /^프로젝트 [0-9]+$/.test(t)).length,
    hasMore: gnav.some(t => t.startsWith('더보기')),
    hasAddProject: gnav.some(t => t === '+ 프로젝트'),
  };
})()`);
check('좌측 사이드바 제거', nav.sidebar === false);
check('1줄: 전역 메뉴 2개(대시보드·내 업무)', nav.hasDash && nav.hasMine, JSON.stringify(nav));
check('사용 가이드는 내비에서 사라졌다', nav.hasGuide === false, JSON.stringify(nav));
check('2줄: 프로젝트 탭 5개 + 더보기', nav.projTabs === 5 && nav.hasMore, `탭 ${nav.projTabs}개, 더보기 ${nav.hasMore}`);
check('2줄: + 프로젝트', nav.hasAddProject);

// 2) 더보기 → 나머지 프로젝트 3개
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('더보기')).click()`);
await sleep(350);
const more = await ev(`(() => {
  const pops = [...document.body.children].filter(c => /z-\\[90\\]/.test(c.className || ''));
  const items = pops.flatMap(p => [...p.querySelectorAll('button')].map(b => b.textContent.trim()));
  return { count: items.filter(t => /^프로젝트 [0-9]+$/.test(t)).length, items };
})()`);
check('더보기에 나머지 프로젝트', more.count === 3, JSON.stringify(more.items));
await ev(`(() => { const b=[...document.body.querySelectorAll('button')].find(x=>x.textContent.trim()==='프로젝트 8'); b && b.click(); })()`);
await sleep(600);
const active = await ev(`(() => {
  const on = [...document.querySelectorAll('button')].find(b => /border-fg($| )/.test(b.className));
  return on ? on.textContent.trim() : null;
})()`);
check('더보기에서 고른 프로젝트가 활성 탭', active === '프로젝트 8', String(active));

// 3) 프로필 메뉴 (사이드바 하단에 있던 것들)
await send('Page.navigate', { url: URL_BASE + '/?p=p1' });
await wait('Page.loadEventFired'); await sleep(1300);
await ev(`document.querySelector('button[title="설정"]').click()`);
await sleep(350);
const menu = await ev(`(() => {
  const pops = [...document.body.children].filter(c => /z-\\[90\\]/.test(c.className || ''));
  return pops.flatMap(p => [...p.querySelectorAll('button')].map(b => b.textContent.trim()));
})()`);
check('프로필 메뉴에 설정·테마 ', menu.includes('설정') && menu.some(t => /모드$/.test(t)), JSON.stringify(menu));
check('프로필 메뉴에도 가이드 없음', !menu.includes('사용 가이드'), JSON.stringify(menu));
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
await sleep(250);

// 4) 멘션 방향키 → 활성 항목이 목록 안에 보이게 스크롤
await ev(`document.querySelector('.board-card').click()`);
await sleep(700);
const typed = await ev(`(() => {
  const ta = [...document.querySelectorAll('textarea')].pop();
  if (!ta) return false;
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '@');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
check('댓글창에 @ 입력', typed === true);
await sleep(400);
const beforeList = await ev(`(() => {
  const box = [...document.querySelectorAll('div')].find(d => /max-h-48/.test(d.className) && d.querySelector('button'));
  if (!box) return null;
  return { items: box.querySelectorAll('button').length, scrollTop: box.scrollTop, canScroll: box.scrollHeight > box.clientHeight };
})()`);
check('멘션 목록이 스크롤될 만큼 길다', !!beforeList && beforeList.canScroll, JSON.stringify(beforeList));
// 아래로 이동 (6개 목록의 마지막 항목은 max-h-48 밖이라 스크롤이 필요하다)
for (let i = 0; i < 5; i++) {
  await ev(`(() => { const ta=[...document.querySelectorAll('textarea')].pop();
    ta.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})); })()`);
  await sleep(90);
}
const afterList = await ev(`(() => {
  const box = [...document.querySelectorAll('div')].find(d => /max-h-48/.test(d.className) && d.querySelector('button'));
  if (!box) return null;
  const btns = [...box.querySelectorAll('button')];
  // 'hover:bg-surface-hover'도 걸리므로 접두사 없는 클래스만 활성으로 본다
  const act = btns.findIndex(b => /(^| )bg-surface-hover( |$)/.test(b.className));
  const bb = act >= 0 ? btns[act].getBoundingClientRect() : null;
  const cb = box.getBoundingClientRect();
  return { scrollTop: Math.round(box.scrollTop), activeIdx: act,
           visible: bb ? (bb.top >= cb.top - 1 && bb.bottom <= cb.bottom + 1) : null };
})()`);
check('방향키로 내려가면 목록이 스크롤된다', !!afterList && afterList.scrollTop > 0, JSON.stringify(afterList));
check('활성 항목이 목록 안에 보인다', afterList?.visible === true, JSON.stringify(afterList));

// 5) 모바일 하단 탭바
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL_BASE + '/?p=p1' });
await wait('Page.loadEventFired'); await sleep(1400);
const bar = await ev(`(() => {
  const nav = document.querySelector('nav');
  if (!nav) return { none: true };
  const r = nav.getBoundingClientRect();
  return {
    labels: [...nav.querySelectorAll('span')].map(s => s.textContent.trim()).filter(t => t && t.length <= 5),
    atBottom: Math.abs(r.bottom - window.innerHeight) <= 1,
    icons: nav.querySelectorAll('svg').length,
    emoji: /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u.test(nav.textContent),
  };
})()`);
check('모바일 하단 탭바가 화면 아래 고정', bar.atBottom === true, JSON.stringify(bar));
check('탭 4개(아이콘 4개)', bar.icons === 4, `svg ${bar.icons}개`);
check('탭바에 이모지 없음(선 아이콘만)', bar.emoji === false);
await ev(`(() => { const n=document.querySelector('nav'); const b=[...n.querySelectorAll('button')].find(x=>/내 업무/.test(x.textContent)); b.click(); })()`);
await sleep(700);
const title = await ev(`document.querySelector('main h2')?.textContent.trim() || document.querySelector('h2')?.textContent.trim()`);
check('탭바로 내 업무 이동', /내 업무|노준석/.test(title || ''), String(title));

// 6) 아이콘 획 두께 규칙
const stroke = await ev(`(() => {
  const all = [...document.querySelectorAll('svg.lucide')];
  const widths = [...new Set(all.map(s => getComputedStyle(s).strokeWidth))];
  return { count: all.length, widths };
})()`);
check('lucide 아이콘 획이 1.4px로 통일', stroke.widths.every(w => w === '1.4px' || w === '2px'), JSON.stringify(stroke));

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
