// 홈 — 앱의 첫 화면(모바일 하단 바 첫 탭). 인사말 · 카드 넷(오늘의 QT · 이번 주 예배 ·
// 내 업무 · 내 순) · 카드마다의 이동 · 스켈레톤 · 빈 자리 · 375px · 다크.
//
// 홈은 자기 저장 자리가 없다 — 말씀(word_qt_schedule·word_qt_entries) · 예배
// (church_worship_v1) · 모임(church_groups_v1) · 업무(church_app_v4) **네 곳에 심고**
// 그것들이 한 화면에 모이는지를 본다. 클라우드에서는 같은 함수가 DB를 보고 RLS가
// 경계를 긋는다(HANDOFF §2-6 — 클라우드 경로는 사람이 확인한다).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = 9591;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'chome-'));
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
const check = (n, p, d = '') => {
  const line = `${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`;
  results.push(line);
  if (process.env.LIVE) console.log(line);
};

// ── 날짜 (앱과 같은 셈: 한국 시간 · UTC로 더하기) ───────────────────────────
const TODAY = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const shift = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const shortDayLabel = (iso) => `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일 (${WEEK[new Date(`${iso}T00:00:00Z`).getUTCDay()]})`;
const mdLabel = (iso) => `${+iso.slice(5, 7)}. ${+iso.slice(8, 10)}.`;
// 예배 날짜 표기(services/worship.js formatServiceDate) — 올해가 아니면 연도가 앞에 붙는다
const svcDate = (iso) => (Number(iso.slice(0, 4)) === new Date().getFullYear() ? '' : `${+iso.slice(0, 4)}년 `) + shortDayLabel(iso);
const Y = Number(TODAY.slice(0, 4));

// ── 가짜 데이터 네 벌 ───────────────────────────────────────────────────────
const TASKS = [
  { id: 't1', title: '수련회 예산 정리', status: '진행 중', due: shift(TODAY, 1) },
  { id: 't2', title: '주보 인쇄 맡기기', status: '시작 전', due: shift(TODAY, -2) },
  { id: 't3', title: '포스터 시안 만들기', status: '완료', due: shift(TODAY, 2) },
  { id: 't4', title: '단체 티셔츠 주문', status: '보류 중', due: shift(TODAY, 5) },
  { id: 't5', title: '남이 맡은 업무', status: '진행 중', due: TODAY, assignees: ['조해리'] },
];
const mkTask = (t) => ({
  id: t.id, projectId: 'p1', title: t.title, content: '', status: t.status,
  assignees: t.assignees || ['노준석'], teams: ['찬양팀'], startDate: '', dueDate: t.due,
  position: 0, author: '노준석', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
  comments: [], attachments: [], activityLog: [],
});
const APP = {
  currentUser: { name: '노준석', team: '임원진', teams: ['임원진'] },
  members: [],
  projects: { byId: { p1: { id: 'p1', title: '2026 하계 수련회', pinnedLinks: [] } }, allIds: ['p1'] },
  tasks: { byId: Object.fromEntries(TASKS.map(t => [t.id, mkTask(t)])), allIds: TASKS.map(t => t.id) },
};
const APP_NO_TASKS = { ...APP, tasks: { byId: {}, allIds: [] } };
// 내 업무를 다 끝낸 사람 — 카드는 남고 줄 자리에 상태 한 줄이 선다
const APP_ALL_DONE = {
  ...APP,
  tasks: {
    byId: Object.fromEntries(TASKS.map(t => [t.id, mkTask({ ...t, status: '완료' })])),
    allIds: TASKS.map(t => t.id),
  },
};

const QT = { [TODAY]: { passage_ref: '빌립보서 4:4-9', label: '항상 기뻐하라' } };
const ENTRIES = { [TODAY]: { body: '오늘 묵상 한 줄', shared: false } };

const WORSHIP = {
  services: [
    { id: 's0', kind: 'sunday', service_date: shift(TODAY, -7), status: 'published', title: '지난 주일', passage_ref: '', preacher: '' },
    { id: 's1', kind: 'sunday', service_date: shift(TODAY, 3), status: 'published', title: '흔들리지 않는 기쁨', passage_ref: '빌립보서 4:4-7', preacher: '김승찬' },
    { id: 's2', kind: 'sunday', service_date: shift(TODAY, 10), status: 'draft', title: '', passage_ref: '', preacher: '' },
  ],
};
// 앞으로 잡힌 것이 '작성 중' 하나뿐인 경우 — 발행 전 표시가 서야 한다
const WORSHIP_DRAFT = {
  services: [
    { id: 'd1', kind: '금요 열정 예배', service_date: shift(TODAY, 2), status: 'draft', title: '깨어 기도하라', passage_ref: '', preacher: '' },
  ],
};

const groupsSeed = (personId) => ({
  people: [
    { id: 'p1', name: '김윤주', profile_id: 'u1' },
    { id: 'p2', name: '천진영', profile_id: null },
    { id: 'p6', name: '노준석', profile_id: 'u2' },
  ],
  groups: [{ id: 'g1', type: 'sun', name: '꼬순', year: Y, leader_person_id: 'p1' }],
  group_members: [
    { group_id: 'g1', person_id: 'p1' }, { group_id: 'g1', person_id: 'p2' }, { group_id: 'g1', person_id: 'p6' },
  ],
  me: { personId, isMaster: false, roles: [] },
});
const GROUPS = groupsSeed('p6');

const plant = (o = {}) => {
  const v = { app: APP, qt: QT, entries: ENTRIES, worship: WORSHIP, groups: GROUPS, theme: 'light', ...o };
  return `(() => {
    localStorage.clear();
    const v = JSON.parse(${JSON.stringify(JSON.stringify(v))});
    localStorage.setItem('church_app_v4', JSON.stringify(v.app));
    if (v.qt) localStorage.setItem('word_qt_schedule', JSON.stringify(v.qt));
    if (v.entries) localStorage.setItem('word_qt_entries', JSON.stringify(v.entries));
    if (v.worship) localStorage.setItem('church_worship_v1', JSON.stringify(v.worship));
    if (v.groups) localStorage.setItem('church_groups_v1', JSON.stringify(v.groups));
    localStorage.setItem('theme', v.theme);
  })()`;
};
const enter = async (o) => {
  await ev(plant(o));
  await send('Page.navigate', { url: URL_BASE });
  await wait('Page.loadEventFired');
  await sleep(1500);
};
// 데스크톱 상단의 '홈'. 로고 버튼은 이미지뿐이라 글자로 찾으면 걸리지 않는다.
const goHome = async () => {
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '홈').click()`);
  await sleep(900);
};
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim() ?? null`);
const cardClasses = () => ev(`[...document.querySelectorAll('.home-card')].map(c => [...c.classList].find(k => k.startsWith('home-') && k !== 'home-card'))`);

await send('Page.enable'); await send('Runtime.enable');
// 스켈레톤은 게스트에서 한 프레임만 서 있다(localStorage는 곧바로 답한다) — 지나간
// 뒤에 물어보면 언제나 없다. 문서가 만들어지기 전에 감시자를 심어 두고 나중에 묻는다.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__sawSkel = false; window.__skelN = 0;
    const ob = new MutationObserver(() => {
      const el = document.querySelector('.home-loading');
      if (!el) return;
      window.__sawSkel = true;
      window.__skelN = el.querySelectorAll('.dc-skeleton').length;
      ob.disconnect();
    });
    // 이 스크립트는 문서가 만들어지기 **전에** 돈다 — documentElement는 아직 null이다
    ob.observe(document, { childList: true, subtree: true });
    setTimeout(() => ob.disconnect(), 8000);
  `,
});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');

// ── 0) 순수 로직 — 어느 예배가 '이번 주 예배'인가 ───────────────────────────
const pure = await ev(`(async () => {
  const m = await import('/src/views/homeView.jsx');
  const list = [
    { id: 'a', service_date: '2026-08-23' },
    { id: 'b', service_date: '2026-09-06' },
    { id: 'c', service_date: '2026-09-13' },
    { id: 'x', service_date: '' },
  ];
  return {
    ahead: m.pickService(list, '2026-09-02')?.id || null,
    onDay: m.pickService(list, '2026-09-06')?.id || null,
    past: m.pickService([list[0]], '2026-09-02')?.id || null,
    bad: m.pickService([list[3]], '2026-09-02'),
    none: m.pickService([], '2026-09-02'),
  };
})()`, true);
check('다가오는 예배 중 가장 이른 것이 선다', pure.ahead === 'b', String(pure.ahead));
check('오늘 예배는 아직 지나간 것이 아니다', pure.onDay === 'b', String(pure.onDay));
check('앞으로 잡힌 것이 없으면 가장 최근에 지난 예배', pure.past === 'a', String(pure.past));
check('날짜가 없는 행은 세지 않는다', pure.bad === null && pure.none === null, `${pure.bad}/${pure.none}`);

// ── 1) 첫 화면이 홈이다 ─────────────────────────────────────────────────────
await enter();
const head = await ev(`(() => ({
  screen: !!document.querySelector('.home-screen'),
  greeting: document.querySelector('.home-greeting')?.textContent.trim() || '',
  date: document.querySelector('.home-date')?.textContent.trim() || '',
  skel: window.__sawSkel, skelN: window.__skelN,
}))()`);
check('앱을 열면 아무것도 누르지 않아도 홈이다', head.screen === true);
check('머리줄에 이름이 있다', head.greeting === '노준석님, 안녕하세요', head.greeting);
check('머리줄 날짜는 한국 시간 오늘이다', head.date === shortDayLabel(TODAY), `${head.date} / ${shortDayLabel(TODAY)}`);
check('기다리는 동안 같은 자리에 스켈레톤이 선다', head.skel === true && head.skelN === 4, `${head.skel}/${head.skelN}`);

// ── 2) 카드 넷 ──────────────────────────────────────────────────────────────
const order = await cardClasses();
check('카드가 넷, docs/V2.md §3 차례로 선다',
  JSON.stringify(order) === '["home-qt","home-worship","home-tasks","home-sun"]', JSON.stringify(order));

const qt = await ev(`(() => ({
  ref: document.querySelector('.home-qt-ref')?.textContent.trim() || '',
  label: document.querySelector('.home-qt-label')?.textContent.trim() || '',
  done: document.querySelector('.home-qt-done')?.textContent.trim() || '',
}))()`);
check('오늘의 QT — 오늘 구절과 제목', qt.ref === '빌립보서 4:4-9' && qt.label === '항상 기뻐하라', JSON.stringify(qt));
check('묵상을 쓴 날에는 기록 상태가 붙는다', qt.done === '오늘 묵상을 기록했어요', qt.done);

const worship = await ev(`(() => {
  const c = document.querySelector('.home-worship');
  return {
    all: c ? c.innerText.replace(/\\n+/g, ' | ') : '',
    title: document.querySelector('.home-worship-title')?.textContent.trim() || '',
    sub: document.querySelector('.home-worship-sub')?.textContent.trim() || '',
    draft: !!document.querySelector('.home-worship-draft'),
  };
})()`);
check('이번 주 예배 — 다가오는 주보의 날짜·제목',
  worship.title === '흔들리지 않는 기쁨' && worship.all.includes('주일 4부 젊은이 예배')
  && worship.all.includes(svcDate(shift(TODAY, 3))), `${worship.all} / ${svcDate(shift(TODAY, 3))}`);
check('구절과 설교자가 한 줄로', worship.sub === '빌립보서 4:4-7 · 김승찬', worship.sub);
check('발행된 주보에는 작성 중 표시가 없다', worship.draft === false);

const mine = await ev(`(() => ({
  count: document.querySelector('.home-task-count')?.textContent.trim() || '',
  rows: [...document.querySelectorAll('.home-task-row')].map(r => r.innerText.replace(/\\n+/g, ' | ')),
  late: getComputedStyle(document.querySelectorAll('.home-task-row')[0].firstElementChild).color,
  soon: getComputedStyle(document.querySelectorAll('.home-task-row')[1].firstElementChild).color,
}))()`);
check('내 업무 — 완료가 아닌 것만 센다(남의 업무는 빼고)', mine.count === '3건', mine.count);
check('가까운 마감 두 건이 마감 순으로',
  mine.rows.length === 2
  && mine.rows[0].includes(mdLabel(shift(TODAY, -2))) && mine.rows[0].includes('주보 인쇄 맡기기')
  && mine.rows[1].includes(mdLabel(shift(TODAY, 1))) && mine.rows[1].includes('수련회 예산 정리'),
  JSON.stringify(mine.rows));
check('마감이 지난 줄은 색으로 갈린다', mine.late !== mine.soon, `${mine.late} / ${mine.soon}`);

const sun = await ev(`(() => ({
  name: document.querySelector('.home-sun-name')?.textContent.trim() || '',
  leader: document.querySelector('.home-sun-leader')?.textContent.trim() || '',
  count: document.querySelector('.home-sun-count')?.textContent.trim() || '',
}))()`);
check('내 순 — 이름·순장·인원',
  sun.name === '꼬순' && sun.leader === '순장 김윤주' && sun.count === '3명', JSON.stringify(sun));

// 카드를 여는 표시는 hover 없이 언제나 보인다(§8 — 터치 기기에는 hover가 없다)
const arrows = await ev(`(() => [...document.querySelectorAll('.home-card')].map(c => {
  const s = c.querySelector('svg');
  if (!s) return 'no-svg';
  const r = s.getBoundingClientRect();
  return (r.width > 6 && r.height > 6 && Number(getComputedStyle(s).opacity) > 0.3) ? 'ok' : 'hidden';
}))()`);
check('카드를 여는 표시가 hover 없이 보인다', arrows.every(a => a === 'ok'), JSON.stringify(arrows));

// ── 3) 카드마다의 이동 ──────────────────────────────────────────────────────
await ev(`document.querySelector('.home-qt').click()`); await sleep(1200);
const toWord = await ev(`(() => { const t = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  return t.includes('QT') && t.includes('성경 읽기'); })()`);
check('오늘의 QT를 누르면 말씀으로 간다', toWord === true);
await goHome();

await ev(`document.querySelector('.home-worship').click()`); await sleep(1200);
check('이번 주 예배를 누르면 예배로 간다', (await ev(`!!document.querySelector('.worship-list')`)) === true);
await goHome();

await ev(`document.querySelector('.home-tasks button').click()`); await sleep(1000);
check('내 업무 머리를 누르면 내 업무 목록으로 간다',
  (await ev(`document.body.innerText.includes('노준석님의 업무')`)) === true);
await goHome();

await ev(`document.querySelector('.home-sun').click()`); await sleep(1200);
check('내 순을 누르면 모임으로 간다', (await ev(`!!document.querySelector('.groups-screen')`)) === true);
await goHome();

await ev(`document.querySelectorAll('.home-task-row')[0].click()`); await sleep(900);
const modal = await ev(`(() => {
  const m = document.querySelector('.fixed.inset-0.z-50');
  return { open: !!m, title: m ? m.innerText.includes('주보 인쇄 맡기기') : false };
})()`);
check('업무 줄을 누르면 그 업무 창이 열린다', modal.open === true && modal.title === true, JSON.stringify(modal));

// ── 4) 안 쓴 날 · 작성 중 주보 · 명단에 안 이어진 계정 ──────────────────────
await enter({ app: APP_ALL_DONE, entries: null, worship: WORSHIP_DRAFT, groups: groupsSeed(null) });
const variant = await ev(`(() => ({
  cards: [...document.querySelectorAll('.home-card')].map(c => [...c.classList].find(k => k.startsWith('home-') && k !== 'home-card')),
  ref: document.querySelector('.home-qt-ref')?.textContent.trim() || '',
  done: !!document.querySelector('.home-qt-done'),
  draft: document.querySelector('.home-worship-draft')?.textContent.trim() || '',
  kind: document.querySelector('.home-worship')?.innerText.includes('금요 열정 예배'),
  count: document.querySelector('.home-task-count')?.textContent.trim() || '',
  clear: document.querySelector('.home-tasks-clear')?.textContent.trim() || '',
  rows: document.querySelectorAll('.home-task-row').length,
}))()`);
check('묵상을 안 쓴 날에는 상태 줄을 두지 않는다', variant.ref === '빌립보서 4:4-9' && variant.done === false, JSON.stringify(variant));
check('작성 중인 주보에는 발행 전 표시가 붙고 종류 이름은 그대로다',
  variant.draft === '작성 중' && variant.kind === true, JSON.stringify(variant));
check('명단에 안 이어진 계정에는 내 순 카드가 없다',
  JSON.stringify(variant.cards) === '["home-qt","home-worship","home-tasks"]', JSON.stringify(variant.cards));
check('맡은 업무를 다 끝냈으면 줄 자리에 상태 한 줄',
  variant.count === '0건' && variant.rows === 0 && variant.clear === '다 정리되었어요', JSON.stringify(variant));

// ── 5) 아무것도 없을 때 (게스트 · 클라우드 꺼짐) ────────────────────────────
await enter({ app: APP_NO_TASKS, qt: null, entries: null, worship: null, groups: null });
const empty = await ev(`(() => ({
  cards: document.querySelectorAll('.home-card').length,
  greeting: document.querySelector('.home-greeting')?.textContent.trim() || '',
  empty: document.querySelector('.home-empty')?.textContent.trim() || '',
  boom: !!document.querySelector('.error-boundary') || document.body.innerText.includes('문제가 생겼어요'),
}))()`);
check('데이터가 하나도 없어도 홈이 깨지지 않는다', empty.cards === 0 && empty.boom === false, JSON.stringify(empty));
check('인사말은 남고 빈 자리는 한 줄이다',
  empty.greeting === '노준석님, 안녕하세요'
  && empty.empty === '예배 · 말씀 · 모임 소식이 아직 올라오지 않았어요', JSON.stringify(empty));

// ── 6) 폭 — 데스크톱 2열 · 375px 1열 ────────────────────────────────────────
await enter();
const cols = (sel) => ev(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  return e ? getComputedStyle(e).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
})()`);
const wideCols = await cols('.home-cards');
const sameWidth = await ev(`(() => {
  const s = document.querySelector('.home-screen').getBoundingClientRect();
  const c = document.querySelector('.home-cards').getBoundingClientRect();
  return [Math.round(c.left - s.left), Math.round(s.right - c.right)];
})()`);
check('데스크톱은 2열', wideCols === 2, String(wideCols));
check('카드 줄이 화면 폭을 그대로 쓴다(따로 좁히지 않는다)',
  JSON.stringify(sameWidth) === '[0,0]', JSON.stringify(sameWidth));

await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await sleep(900);
const mob = await ev(`(() => ({
  over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  cards: document.querySelectorAll('.home-card').length,
  wide: [...document.querySelectorAll('.home-card')].some(c => c.getBoundingClientRect().right > window.innerWidth + 0.5),
}))()`);
const mobCols = await cols('.home-cards');
check('모바일 375px — 가로로 넘치지 않는다', mob.over <= 0, `넘침 ${mob.over}px`);
check('모바일 375px — 카드가 한 줄에 하나씩', mobCols === 1 && mob.cards === 4 && mob.wide === false, `${mobCols}열 / ${mob.cards}장`);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// ── 7) 다크 — 색을 박아 두지 않았는가 ───────────────────────────────────────
// "예쁜가"가 아니라 **읽을 수 있는가**만 본다(themefit·groups와 같은 기준 2.0).
const paint = () => ev(`(() => {
  const grab = (s) => { const e = document.querySelector(s); if (!e) return null;
    const c = getComputedStyle(e); return { bg: c.backgroundColor, fg: c.color }; };
  return {
    card: grab('.home-card'), ref: grab('.home-qt-ref'), title: grab('.home-worship-title'),
    count: grab('.home-task-count'), sun: grab('.home-sun-name'), date: grab('.home-date'),
    done: grab('.home-qt-done'),
  };
})()`);
const lum = (s) => {
  const [r, g, b] = (String(s).match(/[\d.]+/g) || ['0', '0', '0']).slice(0, 3)
    .map(v => { const x = Number(v) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const lightPaint = await paint();
await enter({ theme: 'dark' });
const darkPaint = await paint();
check('다크에서 카드가 색을 바꾼다(토큰을 쓴다)',
  !!darkPaint.card && darkPaint.card.bg !== lightPaint.card.bg && darkPaint.ref.fg !== lightPaint.ref.fg,
  `${lightPaint.card?.bg} → ${darkPaint.card?.bg}`);
const dc = [
  ['오늘 구절', contrast(darkPaint.ref.fg, darkPaint.card.bg)],
  ['설교 제목', contrast(darkPaint.title.fg, darkPaint.card.bg)],
  ['업무 건수', contrast(darkPaint.count.fg, darkPaint.card.bg)],
  ['순 이름', contrast(darkPaint.sun.fg, darkPaint.card.bg)],
  ['기록 상태', contrast(darkPaint.done.fg, darkPaint.card.bg)],
];
check('다크에서도 카드 글자가 배경에 묻히지 않는다', dc.every(([, v]) => v >= 2),
  dc.map(([n, v]) => `${n} ${v.toFixed(1)}`).join(' · '));

await send('Emulation.clearDeviceMetricsOverride');
check('콘솔 오류 0', logs.length === 0, logs.slice(0, 3).join(' / '));

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
