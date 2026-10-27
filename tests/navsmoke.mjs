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
ws.send(JSON.stringify({ id: 0, method: 'Browser.setDownloadBehavior', params: { behavior: 'deny' } }));   // 누른 내려받기(.ics·공유 이미지)가 사용자 다운로드 폴더에 쌓이지 않게(2026-10-22)
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
    hasDash: gnav.some(t => t === '업무 대시보드'),
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
check('탭 줄에 세로선이 없다(옛 앞 칸 선)', (await ev(`document.querySelectorAll('[data-tab-divider]').length`)) === 0);

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
// D8(UI 다듬기 2차 · PITFALLS 72-c) — 테마를 바꾸는 순간은 전환이 꺼져 바탕이 **그 자리에서** 새 색이다.
// 누른 그 스크립트 안에서 body 바탕을 읽는다 — 전환이 살아 있으면 막 시작한 전환의 첫 값(옛 라이트 색)이 나온다.
// **되돌리기**: layout.jsx ThemeMenuItem에서 classList.add('dc-theme-swap')을 지우면 깨진다.
const swap = await ev(`(() => {
  const b = [...document.body.children].flatMap(c => [...c.querySelectorAll('button')]).find(x => x.textContent.trim() === '다크 모드');
  if (!b) return null;
  const before = getComputedStyle(document.body).backgroundColor;
  b.click();
  return { before, after: getComputedStyle(document.body).backgroundColor, theme: document.documentElement.dataset.theme,
    canvas: getComputedStyle(document.documentElement).getPropertyValue('--app-canvas').trim() };
})()`);
await sleep(100);
const swapOff = await ev(`document.documentElement.classList.contains('dc-theme-swap')`);
check('테마를 바꾸는 순간 바탕이 바로 새 색이다(전환 얼룩 없음 · D8)',
  swap && swap.theme === 'dark' && swap.after !== swap.before
    && swap.after === `rgb(${(swap.canvas.match(/[0-9a-f]{2}/gi) || []).map(h => parseInt(h, 16)).join(', ')})` && swapOff === false, JSON.stringify({ swap, swapOff }));
await ev(`(() => { localStorage.setItem('theme','light'); document.documentElement.dataset.theme = 'light'; })()`);
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
// 바는 **두 벌이 겹쳐 있다**(사용자 결정 2026-09-18 · 목업 넷 중 '딥 인디고 채움').
// 업무 층이 오른쪽에서 왼쪽으로 덮으며 "넘어왔다"를 말한다 — 그래서 nav 안의 버튼은
// 언제나 열이고, **지금 모드의 층**만 눌리고 읽힌다. 세는 자리를 그 층으로 좁힌다.
const LAYER_JS = `const nav = document.querySelector('nav[data-tab-bar]');
  const mode = nav.dataset.tabBar;
  const layer = nav.querySelector(mode === 'work' ? '.tab-bar-work' : '.tab-bar-base');`;
const labelsOf = `[...layer.querySelectorAll('span')].map(s => s.textContent.trim()).filter(t => t && t.length <= 5)`;
// 지금 층의 버튼만 누른다 — 아래 깔린 층은 pointer-events가 꺼져 있어 사람 손가락에는
// 닿지 않는다(스크립트의 .click()은 그것을 무시하므로 검사가 층을 직접 골라야 한다).
const tapIn = (re) => ev(`(() => { ${LAYER_JS}
  const b = [...layer.querySelectorAll('button')].find(x => ${re}.test(x.textContent.trim()));
  b && b.click(); })()`);

const bar = await ev(`(() => {
  ${LAYER_JS}
  if (!nav) return { none: true };
  const r = nav.getBoundingClientRect();
  const work = nav.querySelector('.tab-bar-work'), base = nav.querySelector('.tab-bar-base');
  return {
    mode,
    labels: ${labelsOf},
    atBottom: Math.abs(r.bottom - window.innerHeight) <= 1,
    icons: layer.querySelectorAll('svg').length,
    emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(layer.textContent),
    clip: getComputedStyle(work).clipPath,
    hit: [getComputedStyle(base).pointerEvents, getComputedStyle(work).pointerEvents],
    navW: Math.round(r.width),
  };
})()`);
check('모바일 하단 탭바가 화면 아래 고정', bar.atBottom === true, JSON.stringify(bar));
// 프로젝트(업무 축)에서는 업무 바 5칸: 홈·프로젝트·내 업무·대시보드·팀 (A안, 2026-09-02)
check('업무 바 5칸(홈·프로젝트·내 업무·대시보드·팀)', bar.icons === 5 && bar.labels.includes('홈') && bar.labels.includes('프로젝트'), `svg ${bar.icons}개 · ${JSON.stringify(bar.labels)}`);
check('탭바에 이모지 없음(선 아이콘만)', bar.emoji === false);
// 업무 모드에서는 남색 층이 **다 펼쳐져** 있고 그 층만 눌린다.
// 되돌리기(§3-5): index.css의 `[data-tab-bar='work'] .tab-bar-work` 규칙을 지우면 여기서 깨진다.
check('업무 모드에서는 남색 층이 바를 다 덮는다', /^inset\(0px\)$/.test(bar.clip) && bar.hit[1] === 'auto' && bar.hit[0] === 'none',
  `${bar.clip} · ${JSON.stringify(bar.hit)}`);

// 홈으로 나가면 교회 바(홈·예배·말씀·모임·업무)로 통째로 바뀐다 — 겹을 안 늘리는 모드 전환
await tapIn('/^홈$/');
await sleep(600);
const churchBar = await ev(`(() => {
  ${LAYER_JS}
  const work = nav.querySelector('.tab-bar-work'), base = nav.querySelector('.tab-bar-base');
  return {
    mode,
    labels: ${labelsOf},
    clip: getComputedStyle(work).clipPath,
    hit: [getComputedStyle(base).pointerEvents, getComputedStyle(work).pointerEvents],
    navW: Math.round(nav.getBoundingClientRect().width),
  };
})()`);
check('홈에서는 교회 바(예배·말씀·모임·업무)', ['예배','말씀','모임','업무'].every(l => churchBar.labels.includes(l)), JSON.stringify(churchBar.labels));
// 남색 층은 **오른쪽 끝으로 접힌다**(왼쪽 안쪽 여백 = 바 폭). 그 한 값이 두 방향을 다 만든다 —
// 업무로 갈 때는 100%→0(오른쪽에서 왼쪽으로 덮고), 홈으로 올 때는 0→100%(왼쪽부터 원래 색이 드러난다).
check('홈으로 돌아오면 남색 층이 오른쪽 끝으로 접힌다',
  churchBar.clip === 'inset(0px 0px 0px 100%)' && churchBar.hit[0] === 'auto' && churchBar.hit[1] === 'none',
  `${churchBar.clip} · ${JSON.stringify(churchBar.hit)}`);

// 다시 '업무'를 누르면 보던 업무 화면(프로젝트)으로 돌아온다
await tapIn('/^업무$/');
await sleep(600);
const backBar = await ev(`(() => { ${LAYER_JS} return ${labelsOf}; })()`);
check("'업무'로 돌아오면 업무 바 + 보던 화면", backBar.includes('프로젝트'), JSON.stringify(backBar));
await tapIn('/내 업무/');
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

// ── 더보기에는 고른 해의 것만 — 보관 포함 (사용자 결정 2026-09-01) ──────────
// 지금 내년을 보고 있다: 더보기에는 내년 보관(p8)만 있어야 하고, 올해 프로젝트가
// 섞이면 안 된다(예전에는 모든 해의 진행 중이 연도 폴더로 들어갔다 — 대체된 결정).
// 되돌리기 검사: navParts.jsx useYearTabs의 archivedForYear에서 연도 조건을 빼거나 YearFolders의
// active에 다른 해를 다시 섞으면 두 번째 단정이 깨진다.
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('더보기')); b && b.click(); })()`);
await sleep(350);
const moreYear = await ev(`(() => {
  const pops = [...document.body.children].filter(c => typeof c.className === 'string' && c.className.includes('z-[90]'));
  const items = pops.flatMap(p => [...p.querySelectorAll('button')].map(b => b.textContent.trim()));
  // 보관 줄은 "제목" + "보관됨" 라벨이 한 버튼에 붙어 나온다 — 라벨을 떼고 센다
  return items.map(t => t.replace(/보관됨$/, '')).filter(t => /^프로젝트 [0-9]+$/.test(t));
})()`);
check('더보기에 그 해 보관 프로젝트가 있다', moreYear.includes('프로젝트 8'), JSON.stringify(moreYear));
check('더보기에 다른 해 프로젝트가 안 섞인다', moreYear.every(t => t === '프로젝트 8'), JSON.stringify(moreYear));
await send('Emulation.clearDeviceMetricsOverride');


// ── 화면을 바꾸면 스크롤 통이 맨 위로 (사용자 지적 2026-09-07) ───────────────
// "홈에서 업무 탭 누르면 대시보드 중간으로 가게 돼 있는데 그냥 가장 상단으로."
// 스크롤하는 상자는 App의 `main` 하나다 — 뷰가 리마운트돼도 그 통은 그대로라
// scrollTop이 남았다. 되돌리기 검사: App.jsx의 useLayoutEffect를 지우면 두 번째
// 단정(간 뒤 0)이 바로 깨진다. 첫 단정(가기 전 > 0)은 검사 자체가 의미 있는지를 본다 —
// 홈이 화면보다 짧으면 스크롤할 것이 없어 이 검사가 늘 통과해 버린다.
// 낮은 창(640)으로 본다 — 이 시드의 홈은 주보·QT·명단이 비어 카드가 한 장뿐이라
// 900px 창에서는 스크롤할 것이 없어 검사가 헛돈다.
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 640, deviceScaleFactor: 1, mobile: false });
const goto = async (label) => {
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); b && b.click(); })()`);
  await sleep(800);
};
const mainTop = () => ev(`document.querySelector('main').scrollTop`);
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1600);
await goto('홈');
await ev(`(() => { const m = document.querySelector('main'); m.scrollTop = Math.min(400, m.scrollHeight - m.clientHeight); })()`);
await sleep(300);
const scrolledHome = await mainTop();
check('홈이 스크롤될 만큼 길다(검사가 헛돌지 않게)', scrolledHome > 0, `scrollTop ${scrolledHome}`);
await goto('업무 대시보드');
const afterWork = await mainTop();
check('홈을 내려 읽다 업무로 가면 맨 위에서 열린다', afterWork === 0, `scrollTop ${afterWork}`);
// 교회 화면끼리도 같다 — 예배 목록을 내려 읽다 말씀으로 가면 위에서 시작한다
await goto('홈');
await ev(`(() => { const m = document.querySelector('main'); m.scrollTop = 300; })()`);
await sleep(250);
await goto('말씀');
check('교회 화면끼리 옮겨도 맨 위에서 열린다', (await mainTop()) === 0, String(await mainTop()));

// ── 상단 검색 결과 판 (2026-09-25 검색 결과 감사) ─────────────────────────────
// 결과 판은 칸 폭을 따르는데(matchWidth) 좁은 데스크톱에서 칸이 54~310px로 줄어든다 — 판이
// 글자 하나 폭의 기둥이 됐다. 320px 아래로 줄이지 않고 화면 안에 가둔다(minWidth).
// 되돌리기 검사: searchBox.jsx SearchBox의 `minWidth: 320`을 지우면 첫 단정이 깨진다.
const deskSearch = async (w, q) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired'); await sleep(1400);
  await ev(`(() => { const inp = [...document.querySelectorAll('input[placeholder*="검색"]')].find(i => i.getBoundingClientRect().width > 0);
    inp.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(q)});
    inp.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(600);
};
const searchList = `(() => {
  const inp = [...document.querySelectorAll('input[placeholder*="검색"]')].find(i => i.getBoundingClientRect().width > 0);
  const list = [...document.body.children].find(c => String(c.className || '').includes('z-[80]'));
  if (!list) return { none: true };
  const b = list.getBoundingClientRect();
  return { inputW: Math.round(inp.getBoundingClientRect().width), w: Math.round(b.width), l: Math.round(b.left), r: Math.round(b.right),
    t: Math.round(b.top), b: Math.round(b.bottom), vw: innerWidth, vh: innerHeight, n: list.querySelectorAll('button').length,
    active: document.activeElement === inp ? 'input' : (list.contains(document.activeElement) ? 'list:' + document.activeElement.textContent.trim().slice(0, 12) : document.activeElement.tagName) };
})()`;
// 칸은 1024부터다(그 밑은 돋보기 버튼 · 아래 51-a) — 1024에서 칸이 약 160px라 여전히 320 바닥이 일한다.
for (const w of [1024, 1440]) {
  await deskSearch(w, '프로젝트');
  const sl = await ev(searchList);
  check(`검색 결과 판이 좁은 칸에서도 320px 폭(${w}px)`, sl.w >= 320 && sl.n >= 8, JSON.stringify(sl));
  check(`검색 결과 판이 화면 안에 선다(${w}px)`, sl.l >= 0 && sl.r <= sl.vw && sl.b <= sl.vh, JSON.stringify(sl));
}
// 키보드로 결과 열기 — 판이 body 포털이라 Tab으로는 닿지 않는다. ↓로 들어가 ↑↓로 옮기고 Enter로 연다.
// 되돌리기 검사: SearchBox의 onKeyDown={onInputKey}를 지우면 첫 단정이 깨진다.
{
  const key = async (k, code) => {
    // Enter는 text가 있어야 버튼이 눌린다(keypress → click)
    await send('Input.dispatchKeyEvent', k === 'Enter' ? { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, text: '\r' }
      : { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
    await sleep(120);
  };
  await send('Page.bringToFront');
  await key('ArrowDown', 40);
  const k1 = (await ev(searchList)).active;
  await key('ArrowDown', 40);
  const k2 = (await ev(searchList)).active;
  await key('ArrowUp', 38); await key('ArrowUp', 38);
  const k3 = (await ev(searchList)).active;
  check('검색 칸에서 ↓로 결과 첫 줄에 들어간다', k1 === 'list:프로젝트 1', String(k1));
  check('↑↓로 결과 줄을 옮기고 첫 줄에서 ↑는 칸으로', k2 === 'list:프로젝트 2' && k3 === 'input', `${k2} → ${k3}`);
  await key('ArrowDown', 40); await key('ArrowDown', 40);
  await key('Enter', 13);
  await sleep(500);
  const went = await ev(`({ p: new URLSearchParams(location.search).get('p'), list: [...document.body.children].some(c => String(c.className || '').includes('z-[80]')) })`);
  check('결과 줄에서 Enter로 그 프로젝트가 열리고 판이 닫힌다', went.p === 'p2' && !went.list, JSON.stringify(went));
}

// ── 검색 결과가 없어요 · 관련된 업무 내용 (사용자 결정 G-a 2026-09-25) ───────────────
// '검색 결과가 없어요'는 그 문구가 서는 자리(판)의 가로·세로 가운데다. 뜻 검색 구역('관련된 업무 내용')은
// 클라우드에서만 선다 — 게스트에서는 구역도 없고 질문 임베딩(/api/ai)도 나가지 않는다(디바운스 뒤까지 본다).
// 판의 최대 높이는 두 구역이 들어가도록 360px.
// 되돌리기 검사: SearchResults의 `none` 문구에서 text-center를 지우면 첫 단정이, useRelated의
// `semanticOn() &&`를 지우면(게스트에서도 묻는다) 둘째 단정이 깨진다.
{
  await deskSearch(1440, '없');   // 한 글자 — 결과 판은 아직 없다(두 글자부터)
  await ev(`(() => { const inp = [...document.querySelectorAll('input[placeholder*="검색"]')].find(i => i.getBoundingClientRect().width > 0);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '없는말없는말');
    inp.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  // 뜻 검색 디바운스(400ms) 앞뒤를 50ms마다 훑는다 — 한 번이라도 구역(뼈대 포함)이 서면 걸린다
  const everRelated = await ev(`(async () => { let seen = false; for (let i = 0; i < 16; i++) { if (document.querySelector('.search-related')) seen = true; await new Promise(r => setTimeout(r, 50)); } return seen; })()`, true);
  const none = await ev(`(() => {
    const list = [...document.body.children].find(c => String(c.className || '').includes('z-[80]'));
    const p = list?.querySelector('.search-none');
    if (!p) return { found: false };
    const cs = getComputedStyle(list);
    const L = list.getBoundingClientRect();
    const box = { l: L.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), r: L.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
      t: L.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop), b: L.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom) };
    const range = document.createRange(); range.selectNodeContents(p); const g = range.getBoundingClientRect();
    return { found: true, text: p.textContent.trim(), dx: +Math.abs((g.left + g.right) / 2 - (box.l + box.r) / 2).toFixed(1),
      dy: +Math.abs((g.top + g.bottom) / 2 - (box.t + box.b) / 2).toFixed(1),
      related: !!document.querySelector('.search-related'), maxH: cs.maxHeight,
      ai: performance.getEntriesByType('resource').filter(e => /\\/api\\/ai/.test(e.name)).length };
  })()`);
  check("데스크톱 검색: '검색 결과가 없어요'가 판의 가로·세로 가운데에 선다", none.found && none.text === '검색 결과가 없어요' && none.dx <= 1 && none.dy <= 1, JSON.stringify(none));
  check('게스트에서는 관련된 업무 내용 구역도 /api/ai 요청도 없다', none.found && !none.related && !everRelated && none.ai === 0, JSON.stringify({ ...none, everRelated }));
  check('데스크톱 검색 결과 판의 최대 높이는 360px', none.maxH === '360px', JSON.stringify(none));
}


// ── 화면 전환 모션 (사용자 요청 2026-09-07) ─────────────────────────────────
// 교회 축(홈·예배·말씀·모임)끼리 옮길 때만 방향이 있다 — 탭 차례로 오른쪽이면
// 오른쪽에서(dc-nav-fwd), 왼쪽이면 왼쪽에서(dc-nav-back) 들어온다. 업무 축은 지금
// 그대로다(드래그가 있는 화면 위에 transform 조상을 만들지 않는다 — docs/PITFALLS.md §6-1).
// 되돌리기 검사: App.jsx의 navClass를 빈 문자열로 두면 앞의 두 단정이 깨진다.
const screenCls = () => ev(`(() => {
  const el = document.querySelector('main .app-screen');
  if (!el) return null;
  const cs = getComputedStyle(el);
  const inner = el.querySelector('.dc-screen');
  return {
    cls: [...el.classList].filter(k => k.startsWith('dc-')).join(' '),
    anim: cs.animationName, dur: cs.animationDuration,
    inner: inner ? getComputedStyle(inner).animationName : null,
  };
})()`);
await goto('홈');
await goto('모임');
const fwd = await screenCls();
check('탭 차례로 오른쪽이면 오른쪽에서 들어온다',
  fwd && fwd.cls === 'dc-nav dc-nav-fwd' && fwd.anim === 'dc-nav-fwd' && fwd.dur === '0.26s',
  JSON.stringify(fwd));
// 방향이 도는 동안 화면 자체의 세로 등장은 페이드만 남는다(대각선으로 들어오지 않게)
check('방향 전환 중에는 화면 등장이 페이드만 남는다',
  fwd && fwd.inner === 'dc-screen-fade', JSON.stringify(fwd));
await goto('예배');
const back = await screenCls();
check('탭 차례로 왼쪽이면 왼쪽에서 들어온다',
  back && back.cls === 'dc-nav dc-nav-back' && back.anim === 'dc-nav-back', JSON.stringify(back));
// D4 빈도 사다리(UI 다듬기 2차 · PITFALLS 72-a) — 처음 들어간 화면은 제 길이, 이미 들어가 본 화면으로 돌아오면
// 화면·줄·카드 등장이 150ms · 순번 지연 0(hooks/quickEnter.js가 Web Animations로 고친다 — 계산 스타일은 그대로다).
// **되돌리기**: App.jsx의 quickEnter 호출을 지우면 '다시 온 화면' 단정이 깨진다.
const enterTiming = () => ev(`(() => {
  const el = document.querySelector('main .app-screen');
  return el ? el.getAnimations({ subtree: true }).filter(a => /^dc-(nav-|screen-|row-in|card-in|fade-in)/.test(a.animationName))
    .map(a => { const t = a.effect.getTiming(); return { n: a.animationName, d: t.duration, w: t.delay }; }) : null;
})()`);
{
  await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1600);
  await goto('예배');
  const once = await enterTiming();
  await goto('홈');   // 첫 화면(홈)으로 돌아온다 — 카드마다 40ms 순번이 걸린 화면이다
  const again = await enterTiming();
  check('처음 들어간 화면은 등장이 제 길이다(D4)', !!once?.length && once.some(a => a.d > 150), JSON.stringify(once));
  check('이미 들어가 본 화면으로 돌아오면 등장이 150ms · 순번 없음(D4 · 홈 카드 포함)',
    !!again?.length && again.some(a => a.n === 'dc-card-in') && again.every(a => a.d === 150 && a.w === 0), JSON.stringify(again));
}
await goto('업무 대시보드');
const work = await screenCls();
check('업무 축 화면에는 방향 전환이 붙지 않는다',
  work && work.cls === '' && work.anim === 'none' && work.inner === 'dc-screen-in', JSON.stringify(work));

// reduced-motion에서 전부 해제된다(§4.2)
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await goto('홈');
await goto('말씀');
const rmNav = await screenCls();
check('reduced-motion에서 화면 전환 모션이 꺼진다',
  rmNav && rmNav.anim === 'none' && rmNav.inner === 'none', JSON.stringify(rmNav));
await send('Emulation.setEmulatedMedia', { features: [] });
await send('Emulation.clearDeviceMetricsOverride');

// 탭 줄 내 차례(시안 2026-10-16 · services/tabRank.js · tabOrder.js — 옛 '앞 칸'을 대신한다).
// 끈 적이 없으면 모두의 position 순 · 누구든 탭을 끌면 **그 사람의 차례(tab_order_v1)만** 바뀌고 모두의 position은 그대로다 ·
// 내 차례에 아직 없는 프로젝트(새로 생긴 것)는 맨 뒤 · 폰 하단 '프로젝트'는 고른 해의 탭 순서 첫 것을 연다.
// **되돌리기**: tabRank.applyTabOrder가 자리 없는 것을 앞에 붙이면 '새 프로젝트는 맨 뒤'가, moveTab이 setTabOrder 대신
// 옛 saveTabOrder(position 쓰기)로 가면 '남의 순서는 그대로'가 깨진다.
{
  const s2 = JSON.parse(JSON.stringify(st));
  // p1은 작년 것(position 맨 앞) — 폰 '프로젝트' 버튼이 이걸 열면 안 된다
  s2.projects.byId.p1.year = THIS_YEAR - 1;
  pids.forEach((pid, i) => { s2.projects.byId[pid].position = i + 1; });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(s2))}); localStorage.removeItem('tab_year');
    localStorage.removeItem('tab_order_v1')`);
  await send('Page.navigate', { url: URL_BASE + '/?p=p2' });
  await wait('Page.loadEventFired'); await sleep(1500);
  const readDesk = `(() => {
    const desk = [...document.querySelectorAll('div')].find(d => /hidden md:block/.test(d.className) && d.querySelector('button[title="설정"]'));
    const row = desk && desk.querySelector('[class*="items-end"][class*="border-t"]');
    if (!row) return null;
    const seq = [...row.children].filter(el => el.matches('button'))
      .map(el => el.textContent.trim().replace(/^프로젝트 /, 'p'))
      .filter(t => /^p[0-9]+$/.test(t));
    const btn = (n) => [...row.querySelectorAll('button')].find(b => b.textContent.trim() === '프로젝트 ' + n);
    return { seq: seq.join(' '), drag2: btn(2)?.draggable, drag7: btn(7)?.draggable };
  })()`;
  const shared = await ev(readDesk);
  check('끈 적이 없으면 모두의 position 순(작년 p1은 없다) · 어느 탭이든 끈다',
    shared?.seq === 'p2 p3 p4 p5 p6 p7 p8' && shared.drag2 === true && shared.drag7 === true, JSON.stringify(shared));
  // 내 차례 — 그대로 서고, 자리 없는 것은 뒤에 position 순
  await ev(`localStorage.setItem('tab_order_v1', JSON.stringify(['p6', 'p3', 'p2']))`);
  await send('Page.navigate', { url: URL_BASE + '/?p=p2' });
  await wait('Page.loadEventFired'); await sleep(1500);
  const mineTabs = await ev(readDesk);
  check('내 차례가 앞 · 자리 없는 것은 뒤에 position 순', mineTabs?.seq === 'p6 p3 p2 p4 p5 p7 p8', JSON.stringify(mineTabs));
  // 끌면 내 차례만 바뀐다(모두의 position은 그대로)
  const dragRes = await ev(`(async () => {
    const desk = [...document.querySelectorAll('div')].find(d => /hidden md:block/.test(d.className) && d.querySelector('button[title="설정"]'));
    const btn = (n) => [...desk.querySelectorAll('button')].find(b => b.textContent.trim() === '프로젝트 ' + n);
    const pos = () => JSON.stringify(Object.values(JSON.parse(localStorage.getItem('church_app_v4')).projects.byId).map(p => [p.id, p.position ?? 0]));
    const before = pos();
    const dt = new DataTransfer();
    btn(7).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 50));
    btn(6).dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    btn(6).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    btn(7).dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 500));
    return { order: localStorage.getItem('tab_order_v1'), same: before === pos() };
  })()`, true);
  check('끌면 내 차례가 바뀐다(앞으로 끌면 놓은 탭 앞 · 다른 해 p1도 자리를 얻는다)',
    dragRes?.order === JSON.stringify(['p7', 'p6', 'p3', 'p2', 'p1', 'p4', 'p5', 'p8']) && (await ev(readDesk))?.seq === 'p7 p6 p3 p2 p4 p5 p8', JSON.stringify(dragRes));
  check('내가 끌어도 모두의 position은 그대로', dragRes?.same === true, JSON.stringify(dragRes));
  // 새 프로젝트(내 차례에 자리 없음)는 맨 뒤 — position이 맨 앞(0)이어도
  await ev(`window.__store.dispatch({ type: 'ADD_PROJECT', payload: { id: 'p9', title: '프로젝트 9', pinnedLinks: [], position: 0, createdAt: new Date().toISOString(), year: ${THIS_YEAR} } })`);
  await sleep(500);
  check('아직 자리 없는 새 프로젝트는 내 줄 맨 뒤', (await ev(readDesk))?.seq === 'p7 p6 p3 p2 p4 p5 p8 p9', JSON.stringify(await ev(readDesk)));
  // 다른 사람(내 차례가 없는 브라우저)은 모두의 순서를 본다 — 내 끌기가 남의 줄을 바꾸지 않았다
  await sleep(400);
  await ev(`localStorage.setItem('tab_order_mine_backup', localStorage.getItem('tab_order_v1')); localStorage.removeItem('tab_order_v1')`);
  await send('Page.navigate', { url: URL_BASE + '/?p=p2' });
  await wait('Page.loadEventFired'); await sleep(1500);
  check('남(차례 없음)의 줄은 모두의 순서 그대로 — 내 끌기가 바꾸지 않았다', (await ev(readDesk))?.seq === 'p9 p2 p3 p4 p5 p6 p7 p8', JSON.stringify(await ev(readDesk)));
  await ev(`window.__store.dispatch({ type: 'DELETE_PROJECT', payload: 'p9' }); localStorage.setItem('tab_order_v1', localStorage.getItem('tab_order_mine_backup'))`);
  await sleep(500);

  // 폰 — 같은 내 차례 · 하단 '프로젝트'가 고른 해의 첫 것을 연다
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: URL_BASE + '/?p=p2' });
  await wait('Page.loadEventFired'); await sleep(1400);
  const mob = await ev(`(() => {
    const top = [...document.querySelectorAll('div')].find(d => /(^| )md:hidden( |$)/.test(d.className) && d.querySelector('.scrollbar-hide'));
    const row = top && top.querySelector('.scrollbar-hide');
    if (!row) return null;
    const seq = [...row.children].filter(el => el.matches('button'))
      .map(el => el.textContent.trim().replace(/^프로젝트 /, 'p'))
      .filter(t => /^p[0-9]+$/.test(t));
    return { seq: seq.join(' '), divs: row.querySelectorAll('[data-tab-divider]').length };
  })()`);
  check('폰도 같은 내 차례 · 세로선 없음', mob?.seq === 'p7 p6 p3 p2 p4 p5 p8' && mob.divs === 0, JSON.stringify(mob));
  await send('Page.navigate', { url: URL_BASE + '/' });
  await wait('Page.loadEventFired'); await sleep(1400);
  await tapIn('/^업무/'); await sleep(500);
  await tapIn('/^프로젝트/'); await sleep(700);
  const opened = await ev(`(() => { const b = document.querySelector('button[title="프로젝트 이름 수정"]'); return b ? b.textContent.trim() : null; })()`);
  check("폰 하단 '프로젝트'는 고른 해의 탭 순서 첫 것(내 차례)을 연다", opened === '프로젝트 7', String(opened));
  // 마지막으로 본 것이 고른 해에 있으면 그것
  await ev(`(() => { const b = [...document.querySelectorAll('.scrollbar-hide button')].find(x => x.textContent.trim() === '프로젝트 4'); b && b.click(); })()`);
  await sleep(500);
  await tapIn('/^내 업무/'); await sleep(500);
  await tapIn('/^프로젝트/'); await sleep(700);
  const reopened = await ev(`(() => { const b = document.querySelector('button[title="프로젝트 이름 수정"]'); return b ? b.textContent.trim() : null; })()`);
  check("폰 하단 '프로젝트'는 마지막으로 본 것(고른 해)을 다시 연다", reopened === '프로젝트 4', String(reopened));
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.clearDeviceMetricsOverride');
}

// ── 반응형 점검 후속(2026-10-14 · PITFALLS 49-b·49-f) ─────────────────────────────────────────
// ① 데스크톱 상단 검색 칸의 돌아가는 안내 글자 — 그라데이션 머리 위 반투명 칸이라 faint(약 2.6:1)는 묻혔다. 두 테마에서 4.5:1 이상.
//    **되돌리기**: searchBox.jsx 데스크톱 SearchHint의 tone="text-fg-muted"를 걷으면(faint) 깨진다.
{
  const lum = `const lum=(c)=>{const v=c.map(x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)});return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2]};`;
  for (const theme of ['light', 'dark']) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await ev(`localStorage.setItem('theme', '${theme}')`);
    await send('Page.navigate', { url: URL_BASE + '/?p=home' }); await wait('Page.loadEventFired'); await sleep(1200);
    const hint = await ev(`(() => { ${lum}
      const span = [...document.querySelectorAll('span[data-hint]')].find(s => s.offsetParent && s.getBoundingClientRect().top < 80);
      if (!span) return null;
      const input = span.parentElement.querySelector('input');
      // 칸 뒤 바탕은 앱 바탕(--app-canvas)으로 어림한다(머리 그라데이션은 그 위에 옅게 깔린다)
      // 계산값이 oklab(… / .6) 같은 꼴로 올 수 있어(surface/60) 1px 캔버스에 겹쳐 칠해 sRGB로 읽는다
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true });
      const paint = (...cs) => { g.clearRect(0, 0, 1, 1); for (const c of cs) { g.fillStyle = c; g.fillRect(0, 0, 1, 1); } const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
      const canvasColor = getComputedStyle(document.documentElement).getPropertyValue('--app-canvas').trim();
      const field = paint(canvasColor, getComputedStyle(input).backgroundColor);
      const fg = paint(canvasColor, getComputedStyle(span).color);
      const a = lum(fg), b = lum(field);
      return { color: getComputedStyle(span).color, ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 };
    })()`);
    check(`데스크톱 검색 칸 안내 글자(${theme}): 칸 위에서 4.5:1 이상`, !!hint && hint.ratio >= 4.5, JSON.stringify(hint));
  }
  await ev(`localStorage.removeItem('theme')`);
}
// ② 알림 종 판 — 좁은 폰(SE 375 · 폴드 겉화면 344)에서는 화면 폭 - 32px로 서고 좌우 16px(앱 거터)이 같다. 데스크톱은 360px(UI 다듬기 2026-10-26 — 320에서 넓혔다) 그대로 종 오른쪽 끝에.
//    종은 클라우드에서만 서서 게스트 화면에는 없다 — 앱과 같은 react로 NotificationBell을 직접 그려 잰다(폰 상단바 자리 · 오른쪽에서 56px).
//    **되돌리기**: notificationBell.jsx 판 클래스의 `max-sm:w-[calc(100vw-2rem)]!`나 gap 16을 걷으면 왼쪽 8~9px · 오른쪽 23~47px로 깨진다.
{
  const bellAt = (w, h, mobile) => (async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await sleep(300);
    return ev(`(async () => {
      const main = await (await fetch('/src/main.jsx')).text();
      const reactUrl = main.match(/"(\\/node_modules\\/\\.vite\\/deps\\/react\\.js\\?v=[^"]+)"/)?.[1];
      const clientUrl = main.match(/"(\\/node_modules\\/\\.vite\\/deps\\/react-dom_client\\.js\\?v=[^"]+)"/)?.[1];
      if (!reactUrl || !clientUrl) return null;
      const R = await import(reactUrl), C = await import(clientUrl);
      const React = R.default ?? R, createRoot = (C.default ?? C).createRoot;
      const { NotificationBell } = await import('/src/components/notificationBell.jsx');
      const host = document.createElement('div'); host.id = 'bell-host';
      host.style.cssText = 'position:fixed;top:4px;right:56px;z-index:200';
      document.body.appendChild(host);
      const root = createRoot(host);
      root.render(React.createElement(NotificationBell, {}));
      await new Promise(r => setTimeout(r, 300));
      const btn = host.querySelector('button[title="알림"]');
      btn.click();
      await new Promise(r => setTimeout(r, 400));
      const panel = [...host.querySelectorAll('div')].find(d => d.style.position === 'fixed');
      const out = panel ? (() => { const r = panel.getBoundingClientRect(), b = btn.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(innerWidth - r.right), width: Math.round(r.width), bellRight: Math.round(b.right) }; })() : null;
      root.unmount(); host.remove();
      return out;
    })()`, true);
  })();
  for (const [w, label] of [[375, 'SE 375'], [344, '폴드 겉화면 344']]) {
    const p = await bellAt(w, 740, true);
    check(`알림 판(${label}): 좌우 16px 거터가 같다`, !!p && Math.abs(p.left - 16) <= 1 && Math.abs(p.right - 16) <= 1, JSON.stringify(p));
  }
  const d = await bellAt(1440, 900, false);
  check('알림 판(데스크톱 1440): 360px 그대로 종 오른쪽 끝에 맞춘다', !!d && d.width === 360 && Math.abs((d.left + d.width) - d.bellRight) <= 1, JSON.stringify(d));
  await send('Emulation.clearDeviceMetricsOverride');

  // M19(UI 다듬기 2차 · PITFALLS 76-c): 새 알림이 **올 때만** 종이 흔들리고(.dc-bell-ring) 숫자가 톡(.dc-badge-pop) — 처음 그릴 때·모두 읽음으로 줄 때는 아니다.
  // 게스트 종(guest)을 앱과 같은 react로 직접 그리고 브라우저 알림 목록(opsDemo)에 한 줄을 넣는다.
  // **되돌리기**: notificationBell.jsx useBellRing의 첫 기준(`seen.current === null`이면 적기만)을 지우면 '처음' 단정이, BellTrigger의 key를 지우면 '두 번째 알림' 단정이 깨진다.
  const ring = await ev(`(async () => {
    const main = await (await fetch('/src/main.jsx')).text();
    const reactUrl = main.match(/"(\\/node_modules\\/\\.vite\\/deps\\/react\\.js\\?v=[^"]+)"/)?.[1];
    const clientUrl = main.match(/"(\\/node_modules\\/\\.vite\\/deps\\/react-dom_client\\.js\\?v=[^"]+)"/)?.[1];
    if (!reactUrl || !clientUrl) return null;
    const R = await import(reactUrl), C = await import(clientUrl);
    const React = R.default ?? R, createRoot = (C.default ?? C).createRoot;
    const { NotificationBell } = await import('/src/components/notificationBell.jsx');
    const { setGuestNotifs } = await import('/src/services/opsDemo.js');
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;top:4px;right:56px;z-index:200';
    document.body.appendChild(host);
    const root = createRoot(host);
    // 그리기 전에 안 읽은 줄 하나를 깔아 둔다 — 처음 그릴 때 이미 있던 안 읽은 알림으로는 흔들리지 않아야 한다
    setGuestNotifs(list => [{ id: 'm19-0', kind: 'mention', actor_name: '임성빈', preview: '이미 있던 알림', created_at: new Date().toISOString(), read: false }, ...list]);
    root.render(React.createElement(NotificationBell, { guest: true }));
    const nap = (ms) => new Promise(r => setTimeout(r, ms));
    const look = () => { const b = host.querySelector('button[title="알림"]'), svg = b?.querySelector('svg'), n = b?.querySelector('span');
      return { svg: svg?.getAttribute('class') || '', anim: svg ? getComputedStyle(svg).animationName : '', badge: n?.className.includes('dc-badge-pop') || false, num: n?.textContent || '' }; };
    await nap(300);
    const first = look();
    const add = (id) => setGuestNotifs(list => [{ id, kind: 'mention', actor_name: '김은지', preview: '새 알림', created_at: new Date().toISOString(), read: false }, ...list]);
    add('m19-a'); await nap(80);
    const one = look(), svgOne = host.querySelector('button[title="알림"] svg');
    add('m19-b'); await nap(80);
    const two = look(), remounted = host.querySelector('button[title="알림"] svg') !== svgOne;
    await nap(800);
    const svgDone = host.querySelector('button[title="알림"] svg');
    setGuestNotifs(list => list.map(x => ({ ...x, read: true }))); await nap(80);
    const read = look(), sameAfterRead = host.querySelector('button[title="알림"] svg') === svgDone;
    setGuestNotifs(list => list.filter(x => !String(x.id).startsWith('m19-')));
    root.unmount(); host.remove();
    return { first, one, two, remounted, read, sameAfterRead };
  })()`, true);
  check('M19 알림 종: 처음 그릴 때는 흔들리지 않는다(안 읽은 알림이 있어도)', !!ring && !/dc-bell-ring/.test(ring.first.svg) && !ring.first.badge && ring.first.num !== '', JSON.stringify(ring?.first));
  check('M19 새 알림이 오면 종이 흔들리고(.7s · 축 위 8%) 숫자가 톡', !!ring && /dc-bell-ring/.test(ring.one.svg) && ring.one.anim === 'dc-bell-ring' && ring.one.badge, JSON.stringify(ring?.one));
  check('M19 또 오면 처음부터 다시 흔들린다(새로 붙는다)', !!ring && /dc-bell-ring/.test(ring.two.svg) && ring.remounted, JSON.stringify({ two: ring?.two, re: ring?.remounted }));
  check('M19 모두 읽음으로 줄 때는 흔들리지 않는다(숫자 없음 · 종은 그대로)', !!ring && ring.read.num === '' && ring.sameAfterRead, JSON.stringify({ read: ring?.read, same: ring?.sameAfterRead }));
}

// ── 아이패드 세로 상단 바(768~1023 · 시안 승인 2026-10-14 · PITFALLS 51-a) ─────────────────────────────
// 다붓이 알약(151px)과 46px로 눌린 찾기 칸이 메뉴('전체 일정')를 덮던 자리 — 이 폭에서는 폰과 같은 다붓이 얼굴 버튼(36px · 물음표 컷)과
// 돋보기 버튼(폰과 같은 찾기 판)이고 메뉴 글자는 그대로다. 줄의 버튼마다 가운데 점이 자기 것인지(elementFromPoint)·서로 겹치지 않는지 두 테마로 본다.
// 1024부터는 알약 + 찾기 칸 그대로. **되돌리기**: layout.jsx TopNav의 `narrow`를 false로 두면 768~1023의 단정이 깨진다.
{
  const topRow = `(() => {
    const nav = [...document.querySelectorAll('div')].find(d => /hidden md:block/.test(d.className) && d.querySelector('button[title="설정"]'));
    const row = nav.firstElementChild;
    const items = [...row.querySelectorAll('button,input')].filter(b => b.offsetParent);
    const name = (b) => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim().slice(0, 12);
    const bx = items.map(b => b.getBoundingClientRect());
    const covered = items.filter((b, i) => { const r = bx[i]; const el = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return !(el && (el === b || b.contains(el))); }).map(name);
    const overlaps = [];
    for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) if (bx[i].left < bx[j].right - 0.5 && bx[j].left < bx[i].right - 0.5) overlaps.push(name(items[i]) + '×' + name(items[j]));
    const face = row.querySelector('button[aria-label="다붓이에게 물어보기"]'); const fr = face?.getBoundingClientRect();
    return { covered, overlaps, labels: items.filter(b => /^(홈|예배|말씀|모임|업무 대시보드|내 업무|전체 일정)/.test(b.textContent.trim())).length,
      face: fr ? Math.round(fr.width) + 'x' + Math.round(fr.height) : null, cut: !!face?.querySelector('img.dab-face[src*="question"]'),
      pill: !!row.querySelector('.dab-pill'), searchBtn: !!row.querySelector('button[title="검색"]'), inputs: document.querySelectorAll('input[placeholder*="검색"]').length };
  })()`;
  for (const theme of ['light', 'dark']) {
    await ev(`localStorage.setItem('theme', '${theme}')`);
    for (const w of [768, 820, 1023, 1024]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired'); await sleep(1200);
      const r = await ev(topRow);
      check(`상단 바 ${w}(${theme}): 메뉴 일곱 글자 그대로 · 버튼끼리 안 겹치고 가운데 점이 자기 것`, r.labels === 7 && r.covered.length === 0 && r.overlaps.length === 0, JSON.stringify(r));
      if (w < 1024) {
        check(`상단 바 ${w}(${theme}): 다붓이 얼굴 버튼 36px(물음표 컷) · 돋보기 · 알약·찾기 칸 없음`, r.face === '36x36' && r.cut && r.searchBtn && !r.pill && r.inputs === 0, JSON.stringify(r));
        await ev(`document.querySelector('button[title="검색"]')?.click()`); await sleep(400);
        await ev(`(() => { const i = document.activeElement; if (i?.tagName !== 'INPUT') return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '프로젝트'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await sleep(500);
        const p = await ev(`(() => { const i = document.activeElement; const panel = i?.tagName === 'INPUT' ? i.closest('.fixed > div') : null;
          if (!panel) return { panel: false, active: document.activeElement?.tagName };
          const r = panel.getBoundingClientRect();
          return { panel: true, l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), vw: innerWidth, vh: innerHeight,
            rows: [...panel.querySelectorAll('button')].filter(b => /프로젝트 \\d/.test(b.textContent)).length }; })()`);
        check(`상단 바 ${w}(${theme}): 돋보기 → 찾기 판이 화면 안에 다 열리고 칸에 초점 · 결과`, p.panel && p.l >= 0 && p.r <= p.vw && p.t >= 0 && p.b <= p.vh && p.rows > 0, JSON.stringify(p));
      } else {
        check(`상단 바 ${w}(${theme}): 1024부터는 알약 + 찾기 칸 그대로`, r.pill && !r.searchBtn && r.inputs === 1 && !r.face, JSON.stringify(r));
      }
    }
  }
  await ev(`localStorage.removeItem('theme')`);
  await send('Emulation.clearDeviceMetricsOverride');
}

// ── UX 다듬기 β (2026-10-15 · PITFALLS 55) — 첫 페인트 로고 · 늦게 싣는 화면 미리 받기 · 켜진 탭 다시 누르기 · 푸시 제자리 열기 ──
// 되돌리기: index.html #root를 비우면 ①이, App의 prefetchViewsIdle 효과를 지우면 ②의 한가할 때가, mobileNav의 onPointerDown을
// 지우면 ②의 누르는 순간이, mobileNav go의 scrollMainTop을 지우면 ③이, App의 서비스 워커 message 효과를 지우면 ④가 깨진다.
{
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))})`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // ① 번들이 오기 전 첫 그림 — main.jsx를 막고 index.html만으로 그린다(테마 스크립트는 돈다)
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*main.jsx*'] });
  for (const theme of ['light', 'dark']) {
    await ev(`localStorage.setItem('theme', '${theme}')`);
    await send('Page.navigate', { url: URL_BASE + '/' }); await wait('Page.loadEventFired'); await sleep(500);
    const b = await ev(`(() => { const s = document.querySelector('#root .boot-splash'); if (!s) return null;
      const img = [...s.querySelectorAll('img')].find(i => i.getBoundingClientRect().height > 0); const r = img?.getBoundingClientRect();
      return { imgs: s.querySelectorAll('img').length, which: img?.className, h: r && Math.round(r.height), cx: r && Math.round(r.left + r.width / 2), cy: r && Math.round(r.top + r.height / 2),
        vw: innerWidth, vh: innerHeight, bg: getComputedStyle(s).backgroundColor, pulse: img && getComputedStyle(img).animationName, loaded: !!img?.complete && img.naturalWidth > 0 }; })()`);
    const bg = theme === 'dark' ? 'rgb(27, 26, 23)' : 'rgb(246, 245, 242)';
    check(`첫 페인트(${theme}): 번들 전부터 로고 하나 — 3rem · 화면 가운데 · 바탕 = canvas · 숨쉬기`,
      !!b && b.imgs === 2 && b.which === `boot-${theme}` && b.h === 48 && Math.abs(b.cx - b.vw / 2) <= 1 && Math.abs(b.cy - b.vh / 2) <= 1 && b.bg === bg && b.pulse === 'boot-pulse' && b.loaded, JSON.stringify(b));
  }
  await send('Network.setBlockedURLs', { urls: [] });
  await ev(`localStorage.setItem('theme', 'light')`);
  // ② 늦게 싣는 화면 — 한가할 때 미리 받는다 · 폰 하단 탭은 누르는 순간 받는다
  const chunks = `['worshipView', 'wordView', 'groupsView', 'membersView', 'wikiView'].filter(n => performance.getEntriesByType('resource').some(e => e.name.includes('/views/' + n + '.jsx')))`;
  await send('Page.navigate', { url: URL_BASE + '/' }); await wait('Page.loadEventFired'); await sleep(4000);
  const idle = await ev(chunks);
  const gone = await ev(`!document.querySelector('.boot-splash')`);
  check('첫 화면이 선 뒤 한가할 때 다섯 화면 조각을 미리 받는다 · 첫 그림은 앱이 걷는다', idle.length === 5 && gone, JSON.stringify({ idle, gone }));
  // ②-b 미리 받은 탭은 처음 열어도 비지 않는다(PITFALLS 69-a — lazy를 거치면 React가 폴백 뒤 300ms 늦게 드러냈다).
  // **되돌리기**: App의 lazyView를 옛 `lazy(() => …)`로 돌리면 깨진다(첫 글자가 300ms 뒤 · 기다림 뼈대가 선다).
  const firstOpen = await ev(`new Promise(res => {
    const b = [...document.querySelectorAll('nav[data-tab-bar] button')].find(x => x.textContent.trim() === '예배');
    const t0 = performance.now(); let wait = false; b.click();
    const tick = () => {
      const t = performance.now() - t0; const scr = document.querySelector('main .app-screen');
      if (document.querySelector('[data-screen-wait]')) wait = true;
      if ((scr?.innerText || '').trim().length > 0) return res({ ms: Math.round(t), wait });
      if (t > 1500) return res({ ms: null, wait });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`, true);
  check('미리 받은 예배 탭은 처음 열어도 바로 선다(150ms 안 · 기다림 뼈대 없음)', firstOpen.ms !== null && firstOpen.ms < 150 && !firstOpen.wait, JSON.stringify(firstOpen));
  const noIdle = await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestIdleCallback = () => 0; window.cancelIdleCallback = () => {};' });
  await send('Page.navigate', { url: URL_BASE + '/' }); await wait('Page.loadEventFired'); await sleep(2500);
  const before = await ev(chunks);
  await ev(`(() => { const b = [...document.querySelectorAll('nav[data-tab-bar] button')].find(x => x.textContent.trim() === '예배'); b?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); })()`);
  await sleep(800);
  const after = await ev(chunks);
  const still = await ev(`document.querySelector('nav[data-tab-bar] button')?.closest('nav')?.dataset.tabBar`);
  check("하단 '예배'를 누르는 순간(pointerdown) 그 조각을 받는다 — 화면은 아직 그대로",
    !before.includes('worshipView') && after.includes('worshipView') && !after.includes('wordView'), JSON.stringify({ before, after, still }));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: noIdle.identifier });
  // ③ 켜진 탭을 다시 누르면 맨 위로 — quint로 미끄러지고(중간에 멈춰 있지 않다) · 움직임 줄이기면 바로
  await send('Page.navigate', { url: URL_BASE + '/' }); await wait('Page.loadEventFired'); await sleep(1500);
  const homeTab = `[...document.querySelectorAll('nav[data-tab-bar] button')].find(x => x.textContent.trim() === '홈')`;
  const retap = (reduce) => ev(`(async () => {
    const w = ms => new Promise(r => setTimeout(r, ms));
    const m = document.querySelector('main'); m.firstElementChild.style.paddingBottom = '3000px'; m.scrollTop = 1500; await w(50);
    const from = m.scrollTop;
    ${homeTab}.click();
    const now = m.scrollTop; await w(120); const mid = m.scrollTop; await w(700); const end = m.scrollTop;
    return { from, now, mid, end, menu: document.querySelector('nav[data-tab-bar]').dataset.tabBar };
  })()`, true);
  const r1 = await retap(false);
  check('켜진 탭(홈)을 다시 누르면 맨 위로 미끄러진다(누른 순간은 그대로 · 중간 · 끝 0)',
    r1.from >= 1400 && r1.now === r1.from && r1.mid > 0 && r1.mid < r1.from && r1.end === 0, JSON.stringify(r1));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const r2 = await retap(true);
  await send('Emulation.setEmulatedMedia', { features: [] });
  check('움직임 줄이기면 누르는 순간 맨 위', r2.from >= 1400 && r2.now === 0 && r2.end === 0, JSON.stringify(r2));
  // ④ 앱이 떠 있는 동안 누른 푸시 — 워커의 { open } 메시지를 제자리에서 열고 답한다(새로 불러오지 않는다)
  const push = (url) => ev(`(async () => {
    window.__stay = window.__stay || Math.random();
    const mark = window.__stay;
    const ch = new MessageChannel(); let got = null; ch.port1.onmessage = (e) => { got = e.data; };
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { open: location.origin + ${JSON.stringify(url)} }, ports: [ch.port2] }));
    await new Promise(r => setTimeout(r, 700));
    return { got, same: window.__stay === mark, url: location.search, open: !!document.querySelector('.fixed.z-50'), title: document.querySelector('.fixed.z-50 h2')?.textContent || '' };
  })()`, true);
  const p1 = await push('/?p=p1&t=t2');
  check('푸시(업무)는 새로 불러오지 않고 그 업무 창을 연다 · { ok: true }',
    p1.got?.ok === true && p1.same && p1.open && p1.url.includes('t=t2'), JSON.stringify(p1));
  await ev(`[...document.querySelectorAll('.fixed.z-50 button')].find(b => b.textContent.trim() === '닫기')?.click()`); await sleep(500);
  const p2 = await push('/?p=p1&t=nope');
  const p3 = await push('/s/t/abc');
  check('못 여는 주소(없는 업무 · 공유 주소)는 { ok: false } — 워커가 예전처럼 navigate',
    p2.got?.ok === false && p3.got?.ok === false && p2.same && p3.same, JSON.stringify({ p2, p3 }));
  await ev(`localStorage.removeItem('theme')`);
  await send('Emulation.clearDeviceMetricsOverride');
}

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
