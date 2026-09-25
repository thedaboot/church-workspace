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

// ── 모바일 검색 판: '검색 결과가 없어요'는 판의 가운데 · 게스트에는 뜻 검색 구역이 없다 (G-a 2026-09-25) ──
// 되돌리기 검사: SearchResults의 `none` 문구에서 text-center를 지우면 첫 단정이 깨진다.
{
  await ev(`[...document.querySelectorAll('button[title="검색"]')].pop().click()`);
  await sleep(450);
  await ev(`(() => {
    const inp = [...document.querySelectorAll('input[placeholder*="검색"]')].find(i => i.getBoundingClientRect().width > 0);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '없는말없는말');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const everRelated = await ev(`(async () => { let seen = false; for (let i = 0; i < 18; i++) { if (document.querySelector('.search-related')) seen = true; await new Promise(r => setTimeout(r, 50)); } return seen; })()`, true);
  const none = await ev(`(() => {
    const p = document.querySelector('.search-none');
    if (!p) return { found: false };
    const panel = p.closest('.fixed > div');
    const cs = getComputedStyle(panel);
    const P = panel.getBoundingClientRect();
    const l = P.left + parseFloat(cs.paddingLeft), r = P.right - parseFloat(cs.paddingRight);
    const area = p.parentElement.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(p); const g = range.getBoundingClientRect();
    return { found: true, dx: +Math.abs((g.left + g.right) / 2 - (l + r) / 2).toFixed(1),
      dy: +Math.abs((g.top + g.bottom) / 2 - (area.top + area.bottom) / 2).toFixed(1),
      related: !!document.querySelector('.search-related'),
      ai: performance.getEntriesByType('resource').filter(e => /\\/api\\/ai/.test(e.name)).length };
  })()`);
  check("모바일 검색: '검색 결과가 없어요'가 판의 가로·세로 가운데에 선다", none.found && none.dx <= 1 && none.dy <= 1, JSON.stringify(none));
  check('모바일 검색: 게스트에서는 관련된 업무 내용 구역도 /api/ai 요청도 없다', none.found && !none.related && !everRelated && none.ai === 0, JSON.stringify({ ...none, everRelated }));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  await sleep(350);
}

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

// ── 모바일 입력 글자 크기 (선언한 크기 그대로여야 한다) ──
// 예전에는 index.css가 모바일 전체를 `font-size:16px !important`로 덮었다(iOS 자동 확대
// 방지). 그 탓에 11~13px로 설계된 칸이 12px 라벨보다 커 보이고 text-2xl 제목 입력은
// 도리어 16px로 줄었다(사용자 지적). 지금은 viewport의 maximum-scale=1이 확대를 막는다.
// 이 검사가 무너지면 그 !important 규칙이 되살아난 것이다(§6-9-d).
{
  await send('Page.navigate', { url: URL_BASE + '/?p=p1&t=t0' });
  await wait('Page.loadEventFired'); await sleep(1400);
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='수정'); b&&b.click(); })()`);
  await sleep(1200);
  // 본문 편집기(tiptap)는 lazy 청크라 차가운 dev 서버에서 늦게 붙는다 — 재기 전에 기다린다(병렬 실행 때 흔들림)
  for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('.tiptap')`)); i++) await sleep(150);
  const sizes = await ev(`(() => {
    const px = el => el ? Math.round(parseFloat(getComputedStyle(el).fontSize)) : null;
    const byPh = ph => [...document.querySelectorAll('input,textarea')].find(el => (el.placeholder||'').includes(ph));
    return {
      title: px(byPh('업무 제목')),
      assignee: px(byPh('멤버 이름') || byPh('추가')),
      depends: px(document.querySelector('select')),
      subtask: px(byPh('포스터 시안')),
      body: px(document.querySelector('.tiptap')),
      forced16: [...document.querySelectorAll('input,textarea,select')]
        .filter(el => el.type !== 'file' && Math.round(parseFloat(getComputedStyle(el).fontSize)) === 16).length,
    };
  })()`);
  check('제목 입력이 모바일 제목 크기(20px)', sizes.title === 20, JSON.stringify(sizes));
  check('담당자 입력이 12px', sizes.assignee === 12, JSON.stringify(sizes));
  // 이 시드에는 같은 프로젝트에 다른 업무가 없어 선행 업무 select가 그려지지 않는다
  // (있으면 11px여야 한다). 아래 forced16이 select까지 통째로 지킨다.
  check('선행 업무 선택이 11px', sizes.depends === null || sizes.depends === 11, JSON.stringify(sizes));
  check('하위 업무 입력이 13px', sizes.subtask === 13, JSON.stringify(sizes));
  check('본문 에디터가 14px', sizes.body === 14, JSON.stringify(sizes));
  check('16px로 강제된 입력이 없다', sizes.forced16 === 0, `16px인 입력 ${sizes.forced16}개`);
}

// ── 화면 뿌리가 '보이는 창'을 따라간다 (사용자 신고 2026-09-18 · §6-9-aa-4) ──────
// 아이폰은 키보드가 올라와도 레이아웃 뷰포트(=100dvh)를 줄이지 않고 **보이는 창만**
// 줄인 뒤 위로 민다. 뿌리가 100dvh로 남아 있으면 위쪽이 화면 밖으로 밀려 나가고,
// main 위끝에 붙어 있던 노트 서식 바가 천장에 걸린다. 그래서 뿌리 높이를 브라우저가
// 말해 주는 visualViewport.height로 **따라가게만** 둔다(상수를 계산하지 않는다).
// 헤드리스에는 키보드가 없어 두 값이 같다 — 여기서 보는 것은 **배선**이다: 변수가
// 실제로 걸려 있고 뿌리가 그 값을 쓰는가.
// **되돌리기**(§3-5): App.jsx의 `h-[var(--app-vh,100dvh)]`를 `h-dvh`로 되돌리면 깨진다.
{
  // 값을 **흔들어 본다**. 헤드리스에는 키보드가 없어 `100dvh`와 보이는 창이 같은 값이라,
  // 그냥 높이만 재면 `h-dvh`로 되돌려도 통과한다(그렇게 한 번 새어 나갔다).
  const vh = await ev(`(() => {
    const root = document.querySelector('#root > div');
    const de = document.documentElement;
    const before = de.style.getPropertyValue('--app-vh');
    const vv = Math.round(window.visualViewport.height);
    const h = () => Math.round(root.getBoundingClientRect().height);
    de.style.setProperty('--app-vh', (vv - 137) + 'px');
    const shrunk = h();
    if (before) de.style.setProperty('--app-vh', before); else de.style.removeProperty('--app-vh');
    return { set: before.trim(), vv, shrunk, back: h() };
  })()`);
  check('화면 뿌리 높이가 보이는 창을 따라간다',
    vh.set === `${vh.vv}px` && vh.shrunk === vh.vv - 137 && vh.back === vh.vv, JSON.stringify(vh));
}

// ── 모바일 검색 패널: 결과가 많아도 마지막 줄까지 보인다 (2026-09-25 검색 결과 감사) ─────
// 업무 40개가 걸리는 시드로 패널을 열고 목록을 끝까지 내린 뒤, **마지막 줄의 한가운데와 아래끝에서
// 실제로 그 줄이 눌리는지**(elementFromPoint)를 본다 — 탭바가 위에 깔려 있거나 보이는 창 밖이면 깨진다.
//  ① 가로 폰(667×375): 패널이 상단바 상자(flex 항목 z-20)의 쌓임 맥락에 갇혀 탭바(z-40) 밑에 깔렸다.
//     되돌리기 검사: layout.jsx SearchBox(icon)의 createPortal을 걷으면 ①이 깨진다.
//  ② 키보드(아이폰 흉내 — 레이아웃 뷰포트는 그대로, 보이는 창만 300px 줄인다): 목록 높이가
//     70dvh라 키보드가 올라와도 줄지 않아 마지막 결과가 키보드 밑에 남았다.
//     되돌리기 검사: 목록의 max-h를 `max-h-[70dvh]`로 되돌리면 ②가 깨진다.
{
  const many = { currentUser: st.currentUser, projects: st.projects, tasks: { byId: {}, allIds: [] } };
  for (let i = 0; i < 40; i++) {
    const id = 'm' + i;
    many.tasks.byId[id] = { ...st.tasks.byId.t0, id, title: `수련회 준비 ${i}`, position: i };
    many.tasks.allIds.push(id);
  }
  const openSearch = async (w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(many))})`);
    await send('Page.navigate', { url: URL_BASE + '/' }); await wait('Page.loadEventFired'); await sleep(1400);
    await ev(`[...document.querySelectorAll('button[title="검색"]')].pop().click()`); await sleep(400);
    await ev(`(() => { const inp = document.activeElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '수련회');
      inp.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(600);
  };
  const lastRow = `(() => {
    const inp = document.activeElement;
    const list = inp?.tagName === 'INPUT' && [...inp.closest('.fixed').querySelectorAll('div')].find(d => /overflow-y-auto/.test(d.className));
    if (!list) return { none: true };
    list.scrollTop = 1e6;
    const rows = [...list.querySelectorAll('button, p')];
    const last = rows[rows.length - 1];
    const r = last.getBoundingClientRect();
    const vis = window.visualViewport.height;
    const x = r.left + r.width / 2;
    const hitMid = last.contains(document.elementFromPoint(x, r.top + r.height / 2));
    const hitBottom = last.contains(document.elementFromPoint(x, r.bottom - 2));
    return { text: last.textContent.trim().slice(0, 16), top: Math.round(r.top), bottom: Math.round(r.bottom), vis, hitMid, hitBottom,
      scrolled: list.scrollTop > 0 };
  })()`;
  await openSearch(667, 375);
  const land = await ev(lastRow);
  check('가로 폰: 검색 결과 마지막 줄이 탭바에 가리지 않는다', land.scrolled && land.hitMid && land.hitBottom && land.bottom <= land.vis, JSON.stringify(land));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(300);

  await openSearch(375, 667);
  await ev(`(() => { const vv = window.visualViewport; const h = vv.height - 300;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => h });
    vv.dispatchEvent(new Event('resize')); })()`);
  await sleep(300);
  const kb = await ev(lastRow);
  check('키보드가 올라와도 검색 결과 마지막 줄이 보이는 창 안에 온다', kb.scrolled && kb.bottom <= kb.vis, JSON.stringify(kb));
  await ev(`delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize'))`);
  // ③ 키보드의 '검색'(Enter)은 키보드를 내리고(칸의 포커스를 놓는다) 결과는 그대로 둔다.
  //    되돌리기 검사: 모바일 칸의 onKeyDown을 지우면 ③이 깨진다.
  await send('Page.bringToFront');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(250);
  const ent = await ev(`(() => { const inp = [...document.querySelectorAll('input[placeholder*="검색"]')].find(i => i.getBoundingClientRect().width > 0);
    return { focused: document.activeElement === inp, hint: inp?.enterKeyHint, rows: inp ? inp.closest('.fixed').querySelectorAll('button').length : 0 }; })()`);
  check('모바일 검색 칸의 Enter는 키보드를 내리고 결과는 남긴다', ent.focused === false && ent.hint === 'search' && ent.rows > 8, JSON.stringify(ent));
  // ④ 내려 본 뒤 검색어를 바꾸면 새 결과는 맨 위부터 선다(목록 상자가 스크롤 위치를 물려받았다).
  //    되돌리기 검사: SearchBox의 scrollTop = 0 useLayoutEffect를 지우면 ④가 깨진다.
  const top = await ev(`(async () => {
    const inp = [...document.querySelectorAll('input[placeholder*="검색"]')].find(i => i.getBoundingClientRect().width > 0);
    const list = [...inp.closest('.fixed').querySelectorAll('div')].find(d => /overflow-y-auto/.test(d.className));
    list.scrollTop = 1e6;
    const before = list.scrollTop;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '수련회 준비');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    return { before, after: list.scrollTop, more: list.scrollHeight > list.clientHeight };
  })()`, true);
  check('검색어를 바꾸면 결과 목록이 맨 위부터 선다', top.before > 0 && top.after === 0 && top.more, JSON.stringify(top));
}

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 5).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
