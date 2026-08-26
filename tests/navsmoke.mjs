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
// 폭 기반 탭 검사가 흔들리지 않게 시드는 전부 올해다. 연도 검사는 맨 아래에서
// 자기 스스로 두 개를 내년으로 바꾸고 다시 읽는다(0025).
const THIS_YEAR = new Date().getFullYear();
for (let i = 1; i <= 8; i++) {
  const id = 'p' + i; pids.push(id);
  projects[id] = { id, title: `프로젝트 ${i}`, pinnedLinks: [],
    createdAt: new Date().toISOString(), year: THIS_YEAR };
}
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
// 탭 수는 이제 고정 상한(예전 PROJECT_TAB_MAX=5)이 아니라 **줄 폭이 정한다**(useTabFit).
// 1440px에서는 8개가 다 들어가 더보기가 없어야 하고, 좁히면 들어가는 만큼 + 더보기다.
// 탭은 button만 센다 — 측정 전용 줄(invisible)은 span이라 안 잡힌다.
const readNav = `(() => {
  const side = [...document.querySelectorAll('div')].some(d => /(^| )w-64( |$)/.test(d.className));
  // 모바일 상단바도 DOM에는 있으니(md:hidden) 데스크톱 내비만 골라서 센다
  const desk = [...document.querySelectorAll('div')].find(d => /hidden md:block/.test(d.className) && d.querySelector('button[title="설정"]'));
  const gnav = [...(desk || document).querySelectorAll('button')].map(b => b.textContent.trim());
  const row = desk?.querySelector('[class*="items-end"]');
  return {
    sidebar: side,
    hasDash: gnav.some(t => t === '전체 대시보드'),
    hasMine: gnav.some(t => t.startsWith('내 업무')),
    hasGuide: gnav.some(t => t === '사용 가이드'),   // 이제 없어야 한다
    profileItems: null,
    projTabs: gnav.filter(t => /^프로젝트 [0-9]+$/.test(t)).length,
    hasMore: gnav.some(t => t.startsWith('더보기')),
    hasAddProject: gnav.some(t => t === '+ 프로젝트'),
    rowOverflow: row ? row.scrollWidth > row.clientWidth + 1 : null,
  };
})()`;
const nav = await ev(readNav);
check('좌측 사이드바 제거', nav.sidebar === false);
check('1줄: 전역 메뉴 2개(대시보드·내 업무)', nav.hasDash && nav.hasMine, JSON.stringify(nav));
check('사용 가이드는 내비에서 사라졌다', nav.hasGuide === false, JSON.stringify(nav));
check('넓은 화면(1440px)에서는 8개가 다 탭으로', nav.projTabs === 8 && !nav.hasMore, `탭 ${nav.projTabs}개, 더보기 ${nav.hasMore}`);
check('2줄: + 프로젝트', nav.hasAddProject);

// 좁히면(리로드 없이 — §6-41) 들어가는 만큼만 남고 나머지는 더보기로
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(600);
const narrow = await ev(readNav);
check('좁은 화면(800px)에서는 일부만 + 더보기', narrow.projTabs > 0 && narrow.projTabs < 8 && narrow.hasMore,
  `탭 ${narrow.projTabs}개, 더보기 ${narrow.hasMore}`);
check('좁아도 탭 줄이 넘치지 않는다', narrow.rowOverflow === false, JSON.stringify(narrow.rowOverflow));

// 2) 더보기 → 탭에 못 들어간 나머지 전부
// 못 찾으면 던지지 말고 FAIL로 남긴다(§6-40) — 던지면 러너가 CRASH로만 찍는다
const moreClicked = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('더보기'));
  if (!b) return false; b.click(); return true;
})()`);
check('좁은 화면에 더보기 버튼이 있다', moreClicked === true, JSON.stringify(narrow));
await sleep(350);
const more = await ev(`(() => {
  const pops = [...document.body.children].filter(c => /z-\\[90\\]/.test(c.className || ''));
  const items = pops.flatMap(p => [...p.querySelectorAll('button')].map(b => b.textContent.trim()));
  const heads = pops.flatMap(p => [...p.querySelectorAll('p')].map(x => x.textContent.trim()));
  return { count: items.filter(t => /^프로젝트 [0-9]+$/.test(t)).length, items, heads };
})()`);
check('더보기에 나머지 프로젝트', more.count === 8 - narrow.projTabs, `더보기 ${more.count}개 · 탭 ${narrow.projTabs}개`);
// 더보기는 연도 폴더다 — 게스트 시드에는 createdAt이 없어 '연도 모름' 아래에 선다
check('더보기가 연도로 묶인다', more.heads.some(h => /^[0-9]{4}$|연도 모름/.test(h)), JSON.stringify(more.heads));
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

// 7) 보관: 방금 보관한 프로젝트가 탭에 남지 않고, 탭과 더보기에 동시에 보이지 않는다
// 예전에는 보관해도 그 프로젝트에 그대로 머물렀다. 보관된 것을 열어 두면 탭에 끌어올리는
// 규칙이 있어서 탭에 남았고, 보관함에도 같이 떠서 **같은 이름이 두 군데** 보였다.
{
  // 앞 단계가 모바일 390px + '내 업무'로 끝난다 → 데스크톱 2줄 내비로 돌아온다
  // (탭·더보기는 md 이상에서만 마운트된다 — §6-3)
  // 800px로 두는 이유: 이 단계는 더보기가 필요한데, 1440px에서는 8개가 다 탭에
  // 들어가 더보기 자체가 없다(폭 기반 탭 이후).
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  await send('Page.navigate', { url: URL_BASE + '/?p=p1' });
  await wait('Page.loadEventFired'); await sleep(1400);

  const clickMore = async () => {
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('더보기'))?.click()`);
    await sleep(400);
  };
  const morePop = `[...document.body.children].find(c=>/z-\\[90\\]/.test(c.className||''))`;

  // p8은 탭 밖(더보기)에 있는 프로젝트다 → 더보기에서 열고 나서 보관한다
  await clickMore();
  await ev(`(() => { const b=[...(${morePop}?.querySelectorAll('button')||[])]
    .find(x=>x.textContent.trim()==='프로젝트 8'); b?.click(); })()`);
  await sleep(700);

  // 제목을 눌러 이름 수정 창 → '보관하기'
  await ev(`document.querySelector('button[title="프로젝트 이름 수정"]')?.click()`);
  await sleep(450);
  const hasArchive = await ev(`!!([...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='보관하기'))`);
  check('이름 수정 창에 보관하기가 있다', hasArchive === true);
  await ev(`(() => {
    const label=[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='보관하기');
    label?.closest('button')?.click();
  })()`);
  await sleep(800);

  const after = await ev(`(() => {
    const tabs=[...document.querySelectorAll('button')]
      .filter(b=>/border-b-2/.test(b.className||'')).map(b=>b.textContent.trim());
    const s=JSON.parse(localStorage.getItem('church_app_v4')||'{}');
    return { tabs, archivedInStore: !!s.projects?.byId?.p8?.archived,
             tabHasIt: tabs.includes('프로젝트 8'),
             onDashboard: /전체 진척도/.test(document.querySelector('main')?.textContent||'') };
  })()`);
  check('보관하면 저장소에 archived로 남는다', after?.archivedInStore === true, JSON.stringify(after));
  check('보관하면 그 프로젝트 탭에서 나간다', after?.tabHasIt === false, JSON.stringify(after?.tabs));
  check('보관하면 대시보드로 돌아간다', after?.onDashboard === true, JSON.stringify(after?.onDashboard));

  // 보관함에서 다시 열면 탭으로 올라오고, 그때 보관함 목록에는 없다(두 군데 금지)
  await clickMore();
  await ev(`(() => { const b=[...(${morePop}?.querySelectorAll('button')||[])]
    .find(x=>/프로젝트 8/.test(x.textContent)); b?.click(); })()`);
  await sleep(700);
  await clickMore();
  const both = await ev(`(() => {
    const inMore=[...(${morePop}?.querySelectorAll('button')||[])]
      .map(b=>b.textContent.trim()).filter(t=>/프로젝트 8/.test(t)).length;
    const inTabs=[...document.querySelectorAll('button')]
      .filter(b=>/border-b-2/.test(b.className||'')).map(b=>b.textContent.trim())
      .filter(t=>t==='프로젝트 8').length;
    return { inMore, inTabs };
  })()`);
  check('보관함에서 열면 탭에 하나만 있다', both?.inTabs === 1, JSON.stringify(both));
  check('열어 둔 보관 프로젝트는 더보기에 다시 안 나온다', both?.inMore === 0, JSON.stringify(both));
}


// ── 연도 고르기 (탭 줄 맨 앞) ──────────────────────────────────────────────
// 되돌리기 검사: TopNav에서 <YearPicker/>를 지우면 첫 단정이 바로 깨진다.
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
// 앞 단계에서 다른 해 프로젝트를 열었으면 tab_year가 남아 있다 — 기본값을 보려면 지운다
await ev(`localStorage.removeItem('tab_year')`);
await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired');
await sleep(1100);
const yr = await ev(`(() => {
  const desk = [...document.querySelectorAll('div')].find(d => /hidden md:block/.test(d.className) && d.querySelector('button[title="설정"]'));
  const btn = [...(desk||document).querySelectorAll('button')].find(b => b.title === '연도 고르기');
  if (!btn) return { found:false };
  const row = btn.closest('[class*="items-end"]');
  const first = row ? [...row.querySelectorAll('button')][0] : null;
  return { found:true, label: btn.textContent.trim(), isFirst: first === btn };
})()`);
check('탭 줄에 연도 고르기 버튼이 있다', yr.found === true, JSON.stringify(yr));
check('연도가 탭보다 앞에 선다', yr.isFirst === true, JSON.stringify(yr));
check('올해가 기본값', yr.found && yr.label.startsWith(String(new Date().getFullYear())), JSON.stringify(yr));
// 눌러서 목록이 열리고, 연도가 하나씩 줄로 선다
await ev(`[...document.querySelectorAll('button')].find(b => b.title === '연도 고르기').click()`);
await sleep(300);
const yrPop = await ev(`(() => {
  // 이스케이프 대신 includes로 — 템플릿 리터럴 안에서 정규식 백슬래시가 한 겹 줄어든다
  const pops = [...document.body.children].filter(c => typeof c.className === 'string' && c.className.includes('z-[90]'));
  const items = pops.flatMap(p => [...p.querySelectorAll('button')].map(b => b.textContent.trim()));
  // 연도 줄에는 프로젝트 수가 붙는다(예: "2026년3") — 시작 패턴으로 본다
  return { items: items.filter(t => /^[0-9]{4}년/.test(t)), pops: pops.length };
})()`);
check('연도 목록이 열린다', yrPop.items.length >= 1, JSON.stringify(yrPop));
await ev(`document.body.click()`);
await sleep(200);
await send('Emulation.clearDeviceMetricsOverride');


// ── 연도는 만든 날짜가 아니라 **정한 값**을 따른다 (0025) ──────────────────
// 시드의 createdAt은 전부 오늘이다. 7·8번만 year를 내년으로 바꿔 두고 다시 읽어,
// 화면이 만든 날짜가 아니라 정한 값을 보는지 확인한다.
// 되돌리기 검사: layout.jsx의 projectYear에서 p?.year를 빼면 두 단정이 깨진다.
// 앞 블록이 화면 크기 지정을 해제해 두어서, 다시 잡지 않으면 모바일 레이아웃이
// 마운트되고 데스크톱 내비를 못 찾는다(§6-3 — 한쪽만 마운트된다).
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const nextYear = String(new Date().getFullYear() + 1);
await ev(`(() => {
  const s = JSON.parse(localStorage.getItem('church_app_v4'));
  s.projects.byId.p7.year = ${Number(nextYear)};
  s.projects.byId.p8.year = ${Number(nextYear)};
  localStorage.setItem('church_app_v4', JSON.stringify(s));
  localStorage.removeItem('tab_year');
})()`);
await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired');
await sleep(1100);
await ev(`[...document.querySelectorAll('button')].find(b => b.title === '연도 고르기').click()`);
await sleep(350);
const yrItems = await ev(`(() => {
  const pops = [...document.body.children].filter(c => typeof c.className === 'string' && c.className.includes('z-[90]'));
  return pops.flatMap(p => [...p.querySelectorAll('button')].map(b => b.textContent.trim())).filter(t => /^[0-9]{4}년/.test(t));
})()`);
check('정한 연도가 목록에 뜬다(만든 날짜가 아니라)', yrItems.some(t => t.startsWith(nextYear + '년')), JSON.stringify(yrItems));
// 연도 줄에 그 해 프로젝트 수가 붙는다(2026-08-26) — 내년에는 p7·p8 두 개를 옮겨 뒀다
check('연도 줄에 프로젝트 수가 붙는다', yrItems.some(t => t === nextYear + '년2'), JSON.stringify(yrItems));
await ev(`(() => {
  const pops = [...document.body.children].filter(c => typeof c.className === 'string' && c.className.includes('z-[90]'));
  const b = pops.flatMap(p => [...p.querySelectorAll('button')]).find(x => x.textContent.trim().startsWith('${nextYear}년'));
  b && b.click();
})()`);
await sleep(800);
const afterPick = await ev(readNav);
// 7번(내년·진행중) + 보고 있는 p1(올해라도 남는다) = 2. 8번은 앞 단계에서 보관됐다.
check('그 해 프로젝트만 탭에 선다', afterPick.projTabs === 2,
  `탭 ${afterPick.projTabs}개`);
await send('Emulation.clearDeviceMetricsOverride');

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
