// 홈 — 앱의 첫 화면(모바일 하단 바 첫 탭). 히어로(캐릭터 마크 · 공동체 이름 · 인사말 ·
// 태그라인) · 카드 넷(오늘의 QT · 이번 주 예배 · 내 업무 · 내 순) · 카드마다의 이동 ·
// 스켈레톤 · 빈 자리 · 375px · 다크.
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
// 홈 카드의 날짜 표기 — **두 자리 연도**다(사용자 결정 2026-09-03).
// views/homeView.jsx의 homeDueLabel·homeDateLabel과 같은 셈이어야 한다.
const mdLabel = (iso) => `${iso.slice(2, 4)}. ${+iso.slice(5, 7)}. ${+iso.slice(8, 10)}.`;
const svcDate = (iso) => `${iso.slice(2, 4)}년 ${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일 (${WEEK[new Date(`${iso}T00:00:00Z`).getUTCDay()]})`;
const Y = Number(TODAY.slice(0, 4));
// 인사말은 시각에 따라 바뀐다(views/homeView.jsx heroSlot) — 검사도 같은 경계로 기대값을
// 만든다. 시각을 박아 두면 밤 열한 시에 돌릴 때만 깨지는 검사가 된다.
const KST_HOUR = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }));
const wantGreeting = (KST_HOUR >= 6 && KST_HOUR < 10) ? '좋은 아침이에요, 노준석님'
  : (KST_HOUR >= 10 && KST_HOUR < 18) ? '노준석님, 기쁜 날이에요'
  : (KST_HOUR >= 18 && KST_HOUR < 23) ? '노준석님, 아름다운 밤이에요'
  : '고생이 많아요, 노준석님';

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
    greets: [0, 5, 6, 9, 10, 17, 18, 22, 23].map(h => m.heroGreeting(h, '노준석')),
    noNames: [7, 12, 20, 23].map(h => m.heroGreeting(h, '')),
    dates: ['2026-09-06', '2027-01-01', '2025-12-31', 'bad'].map(d => m.homeDateLabel(d)),
    dues: ['2026-09-04', '2027-01-01', ''].map(d => m.homeDueLabel(d)),
  };
})()`, true);
check('다가오는 예배 중 가장 이른 것이 선다', pure.ahead === 'b', String(pure.ahead));
check('오늘 예배는 아직 지나간 것이 아니다', pure.onDay === 'b', String(pure.onDay));
check('앞으로 잡힌 것이 없으면 가장 최근에 지난 예배', pure.past === 'a', String(pure.past));
check('날짜가 없는 행은 세지 않는다', pure.bad === null && pure.none === null, `${pure.bad}/${pure.none}`);
// 인사말은 시각으로 **네 구간**으로 갈린다(사용자 결정 2026-09-03).
// 경계가 어긋나면 아침 인사가 하루 종일 남는다 — 6·10·18·23시를 다 짚는다.
// (캐릭터는 시각과 무관한 한 장이다 — "홈에 딱 하나만")
const MORN = '좋은 아침이에요, 노준석님';
const DAY = '노준석님, 기쁜 날이에요';
const EVE = '노준석님, 아름다운 밤이에요';
const NIGHT = '고생이 많아요, 노준석님';
check('인사말은 한국 시간의 네 구간으로 갈린다',
  JSON.stringify(pure.greets) === JSON.stringify([
    NIGHT, NIGHT,   // 0시 · 5시
    MORN, MORN,     // 6시 · 9시
    DAY, DAY,       // 10시 · 17시
    EVE, EVE,       // 18시 · 22시
    NIGHT,          // 23시
  ]), JSON.stringify(pure.greets));
check('이름이 없으면 이름 자리를 비운 문장이다',
  JSON.stringify(pure.noNames) === JSON.stringify(['좋은 아침이에요', '기쁜 날이에요', '아름다운 밤이에요', '고생이 많아요']),
  JSON.stringify(pure.noNames));

// 날짜는 **두 자리 연도**다(사용자 결정 2026-09-03). 문자열을 그대로 쪼개므로 연도가
// 바뀌는 자리(12월 31일 → 1월 1일)에서도 하루가 밀리지 않는다.
check('카드 날짜는 두 자리 연도로 적는다',
  JSON.stringify(pure.dates) === JSON.stringify(['26년 9월 6일 (일)', '27년 1월 1일 (금)', '25년 12월 31일 (수)', '']),
  JSON.stringify(pure.dates));
check('마감 날짜도 두 자리 연도로, 없으면 미정',
  JSON.stringify(pure.dues) === JSON.stringify(['26. 9. 4.', '27. 1. 1.', '미정']), JSON.stringify(pure.dues));

// ── 1) 첫 화면이 홈이다 ─────────────────────────────────────────────────────
await enter();
const head = await ev(`(() => ({
  screen: !!document.querySelector('.home-screen'),
  greeting: document.querySelector('.home-greeting')?.textContent.trim() || '',
  date: document.querySelector('.home-date')?.textContent.trim() || '',
  skel: window.__sawSkel, skelN: window.__skelN,
}))()`);
check('앱을 열면 아무것도 누르지 않아도 홈이다', head.screen === true);
check('머리줄 인사말은 그 시각의 문구다', head.greeting === wantGreeting, `${head.greeting} / ${wantGreeting}`);
check('머리줄 날짜는 한국 시간 오늘이다', head.date === shortDayLabel(TODAY), `${head.date} / ${shortDayLabel(TODAY)}`);
check('기다리는 동안 같은 자리에 스켈레톤이 선다', head.skel === true && head.skelN === 4, `${head.skel}/${head.skelN}`);

// ── 1a) 두 번째 진입에는 스켈레톤이 없다 (services/cache.js · 사용자 요청 2026-09-03) ──
// "매번 스켈레톤이 아니라 캐시된 값이 먼저 보이게." 홈 → 다른 탭 → 홈으로 돌아올 때
// 캐시가 곧바로 그려져야 한다. **새로고침 없이** 오가야 하는 검사다 — 게스트 모드의
// 캐시는 메모리라(cache.js) 새로고침하면 사라지고, 그게 첫 진입과 같은 상태다.
await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '말씀')?.click()`);
await sleep(1000);
await goHome();
const again = await ev(`(() => ({
  skel: document.querySelectorAll('.home-loading').length,
  bones: document.querySelectorAll('.home-loading .dc-skeleton').length,
  cards: document.querySelectorAll('.home-card').length,
}))()`);
check('홈으로 돌아오면 스켈레톤 없이 곧바로 카드가 그려진다',
  again.skel === 0 && again.bones === 0 && again.cards === 4, JSON.stringify(again));

// ── 1b) 히어로 (사용자 피드백 2026-09-02 "너무 휑하다" → 09-03 "밍밍하다" → "하나만") ──
// 랜딩 히어로: 큰 인사말 + 날짜 칩 한 줄 · 태그라인 · **캐릭터 한 장**.
// 컷은 화면 전체에 **다섯 장**이다 — 히어로 하나 + 쇼케이스 넷. 그 이상이면 무리로
// 돌아간 것이다(사용자 결정 "캐릭터는 홈에 딱 하나만" + 쇼케이스 블록은 예외).
//
// **원본보다 크게 그리지 않는지**를 dpr까지 곱해서 본다 — 원본이 200px 남짓뿐이라
// 레티나에서 CSS 140px로 두면 280 디바이스 px로 늘어나 흐려진다(사용자 지적
// 2026-09-03 "화질이 구려 보인다"). 그래서 재는 값은 `CSS 높이 × dpr`이다.
// **naturalHeight는 밀도가 이미 나뉜 값이다.** srcset의 `2x` 서술자로 고른 파일은
// 336px짜리여도 naturalHeight가 168로 보고된다(규격) — 브라우저가 CSS 픽셀로 환산해
// 준다. 그래서 여기에 dpr을 곱하면 안 된다. 잰다: `CSS 높이 ≤ naturalHeight`.
// 실제 디바이스 픽셀은 그 두 배이고, @2x 파일이 그만큼 크다.
const cutInfo = `(() => {
  const dpr = window.devicePixelRatio || 1;
  const all = [...document.querySelectorAll('img[src*="/chars/"]')];
  return {
    count: all.length,
    srcs: all.map(c => c.getAttribute('src')),
    drawn: all.every(c => c.complete && c.naturalWidth > 0),
    // 화면 배율에 맞는 파일을 실제로 받았는가 (2x 화면이면 currentSrc가 @2x여야 한다)
    picked: all.map(c => (c.currentSrc || '').split('/').pop()),
    hasSet: all.every(c => (c.getAttribute('srcset') || '').includes('@2x.webp 2x')),
    // 그려지는 크기가 받은 파일(밀도 보정 후)보다 큰 것들 = 늘려 그린 것들
    upscaled: all.filter(c => Math.round(c.getBoundingClientRect().height) > c.naturalHeight + 1)
      .map(c => (c.currentSrc || '').split('/').pop() + ' ' + Math.round(c.getBoundingClientRect().height) + '/' + c.naturalHeight),
    sized: all.every(c => c.getAttribute('width') && c.getAttribute('height')),
    dpr,
  };
})()`;
const hero = await ev(`(() => {
  const one = document.querySelector('.home-cut');
  const t = (s) => document.querySelector(s)?.textContent.trim() || '';
  return {
    cuts: ${cutInfo},
    heroSrc: one?.getAttribute('src') || '',
    heroEager: one?.getAttribute('loading') || '',
    heroDecode: one?.getAttribute('decoding') || '',
    tagline: t('.home-tagline'), greeting: t('.home-greeting'),
    fontPx: Math.round(parseFloat(getComputedStyle(document.querySelector('.home-greeting')).fontSize)),
    glow: !!document.querySelector('.home-hero-glow'),
    glowBg: document.querySelector('.home-hero-glow') ? getComputedStyle(document.querySelector('.home-hero-glow')).backgroundImage : '',
    name: !!document.querySelector('.home-hero-name'),
    mark: t('.home-mark'),
    logos: [...document.querySelectorAll('.home-mark-logo')].map(i => ({
      src: i.getAttribute('src'), drawn: i.complete && i.naturalWidth > 0,
      shown: i.getBoundingClientRect().height > 1,
    })),
  };
})()`);
check('히어로 캐릭터는 sparkle-wave 한 장이다',
  hero.heroSrc === '/chars/sparkle-wave.webp', hero.heroSrc);
check('컷은 화면 전체에 다섯 장(히어로 1 + 쇼케이스 4)이고 다 그려진다',
  hero.cuts.count === 5 && hero.cuts.drawn === true, `${hero.cuts.count}장 / drawn ${hero.cuts.drawn}`);
check('어느 컷도 받은 파일보다 크게 그려지지 않는다(dpr · currentSrc 기준)',
  hero.cuts.upscaled.length === 0, `dpr ${hero.cuts.dpr} / ${JSON.stringify(hero.cuts.upscaled)}`);
check('컷마다 1x·2x srcset이 걸려 있다', hero.cuts.hasSet === true, JSON.stringify(hero.cuts.picked));
check('컷마다 width·height가 적혀 있다(그림이 늦게 와도 아래가 밀리지 않는다)',
  hero.cuts.sized === true);
check('히어로 컷은 미루지 않고 받는다', hero.heroEager === 'eager' && hero.heroDecode === 'async',
  `${hero.heroEager}/${hero.heroDecode}`);
check('인사말은 디스플레이급 크기다', hero.fontPx >= 34, `${hero.fontPx}px`);
check('태그라인이 사용자가 정한 문구다',
  hero.tagline === '정답게, 매우 가깝게 붙어 함께 걷는 공동체', hero.tagline);
check("'더다붓' 글씨는 빠졌다(사용자 요청 2026-09-03)", hero.name === false);
check('배경 글로우는 토큰으로 만든다(생색을 박아 두지 않는다)',
  hero.glow === true && hero.glowBg.includes('gradient'), hero.glowBg.slice(0, 60));
// 발문은 글자가 아니라 로고다(사용자 요청 2026-09-03). 헤더와 같은 자산 두 장을 두고
// `dark:`로 가르므로 DOM에는 둘이 있고 그중 하나만 보인다.
check('발문은 THE DABOOT MINISTRY 글자가 아니라 로고 그림이다',
  hero.mark === '' && hero.logos.length === 2 && hero.logos.every(l => l.drawn)
  && hero.logos.filter(l => l.shown).length === 1,
  `'${hero.mark}' / ${JSON.stringify(hero.logos)}`);

// 인사말과 날짜는 **데스크톱에서 반드시 한 줄**이고 글자 밑선이 같다. 히어로는
// 가운데 정렬이다(랜딩) — 카드 줄의 왼쪽에 맞추지 않는다.
const heroWide = await ev(`(() => {
  const g = document.querySelector('.home-greeting').getBoundingClientRect();
  const d = document.querySelector('.home-date').getBoundingClientRect();
  const s = document.querySelector('.home-screen').getBoundingClientRect();
  const t = document.querySelector('.home-hero-text').getBoundingClientRect();
  const c = document.querySelector('.home-cut').getBoundingClientRect();
  return {
    sameRow: d.left >= g.right - 1 && Math.abs(d.bottom - g.bottom) < g.height,
    offCenter: Math.round(Math.abs((t.left + t.right) / 2 - (s.left + s.right) / 2)),
    cutOff: Math.round(Math.abs((c.left + c.right) / 2 - (s.left + s.right) / 2)),
    cutBelow: c.top >= t.bottom - 1,
  };
})()`);
check('데스크톱은 인사말 오른쪽에 날짜가 같은 줄로 선다', heroWide.sameRow === true, JSON.stringify(heroWide));
check('히어로는 가운데 정렬이다', heroWide.offCenter <= 2 && heroWide.cutOff <= 2, JSON.stringify(heroWide));
check('캐릭터는 글 아래에 앉는다', heroWide.cutBelow === true, JSON.stringify(heroWide));

// ── 2) 카드 넷 ──────────────────────────────────────────────────────────────
const order = await cardClasses();
check('카드가 넷, docs/V2.md §3 차례로 선다',
  JSON.stringify(order) === '["home-qt","home-worship","home-tasks","home-sun"]', JSON.stringify(order));

const qt = await ev(`(() => ({
  ref: document.querySelector('.home-qt-ref')?.textContent.trim() || '',
  first: document.querySelector('.home-qt-first')?.textContent.trim() || '',
  done: document.querySelector('.home-qt-done')?.textContent.trim() || '',
}))()`);
check('오늘의 QT — 초점은 오늘 구절', qt.ref === '빌립보서 4:4-9', JSON.stringify(qt));
// 메타 한 줄 = **성경 본문 첫 절**(bible.js) + 묵상을 썼으면 그 한 마디.
// 구절 번호만 있으면 이 자리가 비었고, 칩으로 줄을 따로 쌓으면 읽을 순서가 흐려진다.
check('오늘의 QT — 메타 줄에 본문 첫 절이 온다',
  qt.first.includes('주 안에서') || qt.first.includes('기뻐하라'), qt.first);
check('묵상을 쓴 날에는 메타 줄 끝에 한 마디가 붙는다',
  qt.done === '· 묵상 기록함' && qt.first.endsWith('· 묵상 기록함'), `${qt.done} / ${qt.first}`);

const worship = await ev(`(() => {
  const c = document.querySelector('.home-worship');
  return {
    all: c ? c.innerText.replace(/\\n+/g, ' | ') : '',
    title: document.querySelector('.home-worship-title')?.textContent.trim() || '',
    sub: document.querySelector('.home-worship-sub')?.textContent.trim() || '',
    draft: !!document.querySelector('.home-worship-draft'),
  };
})()`);
check('이번 주 예배 — 초점은 설교 제목', worship.title === '흔들리지 않는 기쁨', worship.title);
// 메타 한 줄 — 예배 종류 · 날짜 · (있으면) 담당자·찬양 수. 칩으로 쌓지 않는다.
check('메타 줄에 예배 종류와 날짜가 한 줄로',
  worship.sub === `주일 4부 젊은이 예배 · ${svcDate(shift(TODAY, 3))}`,
  `${worship.sub} / 주일 4부 젊은이 예배 · ${svcDate(shift(TODAY, 3))}`);
check('발행된 주보에는 작성 중 표시가 없다', worship.draft === false);

const mine = await ev(`(() => ({
  count: document.querySelector('.home-task-count')?.textContent.trim() || '',
  rows: [...document.querySelectorAll('.home-task-row')].map(r => r.innerText.replace(/\\n+/g, ' | ')),
  late: getComputedStyle(document.querySelectorAll('.home-task-row')[0].firstElementChild).color,
  soon: getComputedStyle(document.querySelectorAll('.home-task-row')[1].firstElementChild).color,
}))()`);
check('내 업무 — 완료가 아닌 것만 센다(남의 업무는 빼고)', mine.count === '3건', mine.count);
check('가까운 마감이 마감 순으로 (최대 세 줄)',
  mine.rows.length === 3
  && mine.rows[0].includes(mdLabel(shift(TODAY, -2))) && mine.rows[0].includes('주보 인쇄 맡기기')
  && mine.rows[1].includes(mdLabel(shift(TODAY, 1))) && mine.rows[1].includes('수련회 예산 정리'),
  JSON.stringify(mine.rows));
check('마감이 지난 줄은 색으로 갈린다', mine.late !== mine.soon, `${mine.late} / ${mine.soon}`);

const sun = await ev(`(() => ({
  name: document.querySelector('.home-sun-name')?.textContent.trim() || '',
  leader: document.querySelector('.home-sun-leader')?.textContent.trim() || '',
  meta: document.querySelector('.home-sun-meta')?.textContent.trim() || '',
}))()`);
check('내 순 — 초점은 순 이름 + 순장(같은 줄)',
  sun.name === '꼬순' && sun.leader === '순장 김윤주', JSON.stringify(sun));
// 메타 한 줄 — 인원 · 지난 주일 참석 · 공유 노트. 우리 순의 사실만 말한다.
check('내 순 — 메타 줄에 인원과 지난 주일 참석이 한 줄로',
  sun.meta.startsWith('3명') && sun.meta.includes('지난 주일') && sun.meta.includes('참석'), sun.meta);

// ── 2b) 카드 넷이 같은 구조·같은 높이인가 (사용자 지적 2026-09-03) ──────────
// "내 업무가 쌓이면 카드가 계속 커지고, 오늘의 QT·내 순은 아래가 빈다." 이제 카드마다
// 제목 줄 + 본문 자리 + 꼬리 한 줄이고 높이가 같다. 업무를 여섯 건 심어도 카드는
// 자라지 않고 마지막 줄이 '+3건 더'로 접힌다.
const cardBox = `(() => {
  const cs = [...document.querySelectorAll('.home-card')];
  return {
    h: cs.map(c => Math.round(c.getBoundingClientRect().height)),
    rows: document.querySelectorAll('.home-task-row').length,
    more: document.querySelector('.home-tasks-more')?.textContent.trim() || '',
    grew: cs.some(c => c.scrollHeight > c.clientHeight + 1),
  };
})()`;
const box3 = await ev(cardBox);
// 카드는 **내용만큼만** 서고 같은 행의 둘만 서로 높이를 맞춘다(사용자 지적 2026-09-03,
// 두 번 — 고정 min-height를 걸었더니 줄이 둘뿐인 카드 아래가 통째로 비었다).
// 위아래 패딩이 같아야 아래가 남아 보이지 않는다.
const pad = await ev(`(() => [...document.querySelectorAll('.home-card')].map(c => {
  const r = c.getBoundingClientRect();
  const head = c.querySelector('.home-card-head').getBoundingClientRect();
  const kids = [...c.querySelectorAll('.home-card-meta, .home-task-row, .home-tasks-more, .home-tasks-clear')]
    .map(e => e.getBoundingClientRect()).filter(x => x.height > 0);
  const last = Math.max(...kids.map(x => x.bottom));
  return { top: Math.round(head.top - r.top), bottom: Math.round(r.bottom - last) };
}))()`);
// 행의 높이를 정하는 카드(그 행에서 가장 높은 것)는 위아래 패딩이 같아야 한다.
// 같은 행의 낮은 카드는 늘어나므로 아래에 여백이 남는다 — 그것은 items-stretch의
// 몫이고, 대신 **위보다 좁아지는 일은 없어야** 한다(아래가 답답해 보이면 안 된다).
const rowPad = [[0, 1], [2, 3]].map(([a, b]) => {
  const tall = box3.h[a] >= box3.h[b] ? a : b;
  return { tall: Math.abs(pad[tall].bottom - pad[tall].top), other: pad[a === tall ? b : a] };
});
check('행 높이를 정하는 카드의 위아래 패딩이 같고, 늘어난 카드도 좁아지지 않는다',
  rowPad.every(r => r.tall <= 4 && r.other.bottom >= r.other.top - 1),
  JSON.stringify({ pad, rowPad }));

// 초점 한 줄 + 메타 한 줄이다(사용자 지적 2026-09-03 — 줄바꿈이 너무 많았다).
// 초점은 굵고 크고, 메타는 그보다 작다 — 눈이 어디에 먼저 닿을지가 정해져 있어야 한다.
const focusMeta = await ev(`(() => [...document.querySelectorAll('.home-card')]
  .filter(c => c.querySelector('.home-card-focus'))
  .map(c => {
    const f = c.querySelector('.home-card-focus'), m = c.querySelector('.home-card-meta');
    const fs = getComputedStyle(f), ms = getComputedStyle(m);
    return {
      lines: [Math.round(f.getBoundingClientRect().height / parseFloat(fs.lineHeight)),
              Math.round(m.getBoundingClientRect().height / parseFloat(ms.lineHeight))],
      bigger: parseFloat(fs.fontSize) > parseFloat(ms.fontSize) + 2,
      bold: Number(fs.fontWeight) >= 700,
    };
  }))()`);
check('카드 본문은 초점 한 줄 + 메타 한 줄이다',
  focusMeta.length === 3 && focusMeta.every(c => c.lines[0] === 1 && c.lines[1] === 1),
  JSON.stringify(focusMeta.map(c => c.lines)));
check('초점 줄이 메타 줄보다 크고 굵다',
  focusMeta.every(c => c.bigger && c.bold), JSON.stringify(focusMeta));
check('같은 행의 두 카드가 서로 높이를 맞춘다(행끼리는 달라도 된다)',
  Math.abs(box3.h[0] - box3.h[1]) <= 2 && Math.abs(box3.h[2] - box3.h[3]) <= 2, JSON.stringify(box3.h));
check('카드 안에서 내용이 넘치지 않는다', box3.grew === false);

// 업무 여섯 건 — 줄은 셋까지, 나머지는 '+3건 더'
const SIX = Array.from({ length: 6 }, (_, i) => ({
  id: `x${i}`, title: `여섯 중 ${i + 1}번째 업무`, status: '진행 중', due: shift(TODAY, i - 1),
}));
await enter({ app: { ...APP, tasks: { byId: Object.fromEntries(SIX.map(t => [t.id, mkTask(t)])), allIds: SIX.map(t => t.id) } } });
const box6 = await ev(cardBox);
check('업무가 여섯 건이어도 그 행이 더 자라지 않는다(줄 상한이 막는다)',
  Math.abs(box6.h[2] - box6.h[3]) <= 2 && box6.h[2] <= box3.h[2] + 24,
  `${JSON.stringify(box6.h)} / 3건 ${JSON.stringify(box3.h)}`);
check("줄은 셋까지 서고 나머지는 '+3건 더'로 접힌다",
  box6.rows === 3 && box6.more === '+3건 더', `${box6.rows}줄 / ${box6.more}`);
await enter();

// 화살표는 **제목 줄 안, 오른쪽 끝**에 있다(사용자 지적 2026-09-03 — 카드마다 높이가
// 달랐다). 버튼은 내용을 세로 가운데에 놓는 상자를 갖고 있어서, 같은 행의 옆 카드가
// 더 높으면 늘어난 카드의 제목 줄이 통째로 내려간다. flex-col + justify-start로 막는다.
const arrowRow = await ev(`(() => {
  const cards = [...document.querySelectorAll('.home-card')];
  return {
    // 화살표가 그 카드의 제목 줄과 같은 줄인가 (제목 줄 top과의 차)
    offHead: cards.map(c => {
      const h = c.querySelector('.home-card-head').getBoundingClientRect();
      const g = c.querySelector('.home-card-go').getBoundingClientRect();
      return Math.round((g.top + g.bottom) / 2 - (h.top + h.bottom) / 2);
    }),
    // 카드 위 끝에서 화살표까지의 거리 — 네 카드가 같아야 한다
    fromTop: cards.map(c => Math.round(c.querySelector('.home-card-go').getBoundingClientRect().top
      - c.getBoundingClientRect().top)),
    // 같은 행(세로로 겹치는) 두 카드의 화살표 y가 같은가
    rowSame: (() => {
      const gy = cards.map(c => Math.round(c.querySelector('.home-card-go').getBoundingClientRect().top));
      const cy = cards.map(c => Math.round(c.getBoundingClientRect().top));
      const bad = [];
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
        if (Math.abs(cy[i] - cy[j]) <= 2 && Math.abs(gy[i] - gy[j]) > 1) bad.push([gy[i], gy[j]]);
      }
      return bad;
    })(),
  };
})()`);
check('화살표는 카드 제목 줄과 같은 줄에 있다',
  arrowRow.offHead.every(v => Math.abs(v) <= 1), JSON.stringify(arrowRow.offHead));
check('네 카드의 화살표가 카드 위 끝에서 같은 거리에 있다',
  new Set(arrowRow.fromTop).size === 1, JSON.stringify(arrowRow.fromTop));
check('같은 행 카드의 화살표 높이가 같다', arrowRow.rowSame.length === 0, JSON.stringify(arrowRow.rowSame));

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
// 발행 전 표시는 메타 줄 **머리**에 붙는다(칩으로 줄을 따로 쌓지 않는다)
check('작성 중인 주보에는 발행 전 표시가 붙고 종류 이름은 그대로다',
  variant.draft.startsWith('작성 중') && variant.kind === true, JSON.stringify(variant));
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
  empty.greeting === wantGreeting
  && empty.empty === '예배 · 말씀 · 모임 소식이 아직 올라오지 않았어요', JSON.stringify(empty));

// ── 5b) 랜딩 쇼케이스 (사용자 요청 2026-09-03) ──────────────────────────────
// 카드 넷 아래 네 블록(예배 · 말씀 · 모임 · 업무). **카드가 하나도 없는 날에도 선다** —
// 여기는 '오늘 무엇이 있는지'가 아니라 '여기서 무엇을 할 수 있는지'를 말하는 자리다.
// 화면 밖에서는 안 보이는 것이 정상이라(스크롤로 내려올 때 한 번 나타난다) 먼저
// 굴려 놓고 묻는다.
const showAt = async () => {
  await ev(`document.querySelector('.home-show').scrollIntoView({ block: 'center' })`);
  await sleep(900);
  return ev(`(() => {
    const items = [...document.querySelectorAll('.home-show-item')];
    return {
      keys: items.map(b => [...b.classList].find(k => k.startsWith('home-show-') && k !== 'home-show-item')),
      shown: items.filter(b => Number(getComputedStyle(b).opacity) > 0.9).length,
      cuts: items.map(b => b.querySelector('.home-show-cut')?.getAttribute('src') || ''),
      drawn: items.every(b => { const i = b.querySelector('.home-show-cut'); return i && i.complete && i.naturalWidth > 0; }),
      titles: items.map(b => b.querySelector('.home-show-name')?.textContent.trim() || ''),
      descs: items.map(b => (b.querySelector('.home-show-desc')?.textContent || '').replace(/\s+/g, ' ').trim()),
      motions: items.map(b => b.querySelectorAll('.home-mo').length),
      // 차례는 컷 → 제목 → 설명이다. 모션 그래픽은 **뺐다**(사용자 결정 2026-09-03).
      order: items.every(b => {
        const q = (k) => b.querySelector(k).getBoundingClientRect();
        const cut = q('.home-show-cut'), name = q('.home-show-name'), desc = q('.home-show-desc');
        return name.top >= cut.bottom - 1 && desc.top >= name.bottom - 1;
      }),
      motions: items.map(b => b.querySelectorAll('.home-mo').length),
      cols: getComputedStyle(document.querySelector('.home-show-grid')).gridTemplateColumns.split(' ').filter(Boolean).length,
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`);
};
const show = await showAt();
check('쇼케이스는 예배 · 말씀 · 모임 · 업무 네 블록이다',
  JSON.stringify(show.keys) === '["home-show-worship","home-show-word","home-show-groups","home-show-work"]',
  JSON.stringify(show.keys));
check('스크롤로 내려오면 네 블록이 다 나타난다', show.shown === 4, `${show.shown}장`);
check('블록마다 캐릭터 컷이 있고 히어로 컷과 겹치지 않는다',
  show.drawn === true && show.cuts.every(c => c.includes('/chars/'))
  && !show.cuts.includes(hero.heroSrc), `${JSON.stringify(show.cuts)} / 히어로 ${hero.heroSrc}`);
// 문구는 사용자가 준 그대로여야 한다(2026-09-03) — 임의로 다듬으면 안 된다
check('블록의 제목·설명이 사용자가 준 문구 그대로다',
  JSON.stringify(show.titles) === '["예배","말씀","모임","업무"]'
  && JSON.stringify(show.descs) === JSON.stringify([
    '이번 주 주보를 확인하고 예배 중 예배 노트를 남겨요',
    '오늘 QT 본문을 읽고 묵상을 기록해요',
    '우리 순, 우리 동아리의 명단과 순모임 가이드를 확인해요',
    '내가 맡은 업무와 프로젝트를 이어서 진행해요',
  ]), JSON.stringify(show.descs));
// 모션 그래픽은 되살리지 말 것(사용자 결정 2026-09-03 — 글을 읽는 자리다)
check('블록에 모션 그래픽이 없다', show.motions.every(n => n === 0), JSON.stringify(show.motions));
check('블록의 차례는 컷 → 제목 → 설명이다', show.order === true, String(show.order));

// 눌러서 가는 것이 **hover 없이도** 보인다(§8) — 위 카드 넷과 같은 화살표다.
const showGo = await ev(`(() => {
  const arrows = [...document.querySelectorAll('.home-show-go')];
  return {
    n: arrows.length,
    visible: arrows.every(a => { const r = a.getBoundingClientRect();
      return r.width > 6 && r.height > 6 && Number(getComputedStyle(a).opacity) > 0.3; }),
    // transition에 all이 걸려 있으면 안 된다(§6-17-b) — 자리까지 전이되어 미끄러진다
    props: [...new Set([...document.querySelectorAll('.home-show-item')]
      .map(b => getComputedStyle(b).transitionProperty))],
  };
})()`);
check('블록마다 화살표가 hover 없이 보인다', showGo.n === 4 && showGo.visible === true, JSON.stringify(showGo));
check('블록의 전이 대상이 all이 아니다(§6-17-b)',
  showGo.props.every(p => !p.includes('all')), JSON.stringify(showGo.props));

// 호버에서 살짝 떠오르고 화살표가 오른쪽으로 미끄러진다
const hoverAt = async (on) => {
  const box = await ev(`(() => { const r = document.querySelector('.home-show-worship').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 20) }; })()`);
  await send('Input.dispatchMouseEvent', on
    ? { type: 'mouseMoved', x: box.x, y: box.y }
    : { type: 'mouseMoved', x: 2, y: 2 });
  await sleep(420);
  // 테일윈드 4의 translate 유틸리티는 **transform이 아니라 `translate` 속성**을 쓴다 —
  // transform만 읽으면 값이 바뀌어도 내내 matrix(1,0,0,1,0,0)으로 보인다(실측).
  return ev(`(() => {
    const c = getComputedStyle(document.querySelector('.home-show-worship'));
    const a = getComputedStyle(document.querySelector('.home-show-worship .home-show-go'));
    return { card: c.translate + '|' + c.transform, arrow: a.translate + '|' + a.transform,
      cardTr: c.transitionProperty, arrowTr: a.transitionProperty };
  })()`);
};
const hoverOff = await hoverAt(false);
const hoverOn = await hoverAt(true);
check('호버에서 블록이 떠오르고 화살표가 미끄러진다',
  hoverOn.card !== hoverOff.card && hoverOn.arrow !== hoverOff.arrow,
  `카드 ${hoverOff.card} → ${hoverOn.card} / 화살표 ${hoverOff.arrow} → ${hoverOn.arrow}`);
// 값만 바뀌고 전이가 안 걸리면 툭 튄다 — 전이 목록에 translate가 있어야 한다
check('호버 전이가 translate에 걸려 있다',
  hoverOn.cardTr.includes('translate') && hoverOn.arrowTr.includes('translate'),
  `${hoverOn.cardTr} / ${hoverOn.arrowTr}`);
await hoverAt(false);

// 설명은 **사용자가 정한 자리**에서 두 줄로 나뉜다(1440). 두 도막을 각자 span으로
// 감싸 두었으니 두 span이 서로 다른 줄에 있는지만 보면 된다.
const showLines = await ev(`(() => [...document.querySelectorAll('.home-show-item')].map(b => {
  const a = b.querySelector('.home-show-l1').getBoundingClientRect();
  const c = b.querySelector('.home-show-l2').getBoundingClientRect();
  return { two: c.top >= a.bottom - 1, a: Math.round(a.height), c: Math.round(c.height) };
}))()`);
check('1440에서 설명이 정한 자리에서 두 줄로 나뉜다',
  showLines.every(l => l.two === true), JSON.stringify(showLines));
check('1440px에서 4열이고 가로로 넘치지 않는다', show.cols === 4 && show.over <= 0, `${show.cols}열 / 넘침 ${show.over}px`);
check('섹션 제목이 사용자가 정한 문구다',
  (await ev(`document.querySelector('.home-show-title')?.textContent.trim()`)) === '더다붓 워크스페이스에서 할 수 있는 것');

// 블록을 누르면 그 화면으로 간다. '업무'는 업무 대시보드다(하단 바가 업무 모드로 바뀐다).
await ev(`document.querySelector('.home-show-word').click()`); await sleep(1200);
const showToWord = await ev(`(() => { const t = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  return t.includes('QT') && t.includes('성경 읽기'); })()`);
check('쇼케이스 블록을 누르면 그 화면으로 간다', showToWord === true);
await goHome();
await ev(`document.querySelector('.home-show').scrollIntoView({ block: 'center' })`); await sleep(500);
await ev(`document.querySelector('.home-show-work').click()`); await sleep(1200);
check("'업무' 블록은 업무 대시보드로 간다",
  (await ev(`document.body.innerText.includes('업무 대시보드') || !!document.querySelector('.kpi-grid')`)) === true);
await goHome();

// 소식이 하나도 없는 날 — 카드는 없어도 쇼케이스는 남는다
await enter({ app: APP_NO_TASKS, qt: null, entries: null, worship: null, groups: null });
const showEmpty = await showAt();
check('소식이 없는 날에도 쇼케이스는 선다',
  showEmpty.keys.length === 4 && showEmpty.shown === 4, JSON.stringify(showEmpty.keys));

// ── 5c) 쇼케이스가 폭마다 예쁘게 서는가 (사용자 요청 2026-09-03) ───────────
// 다섯 폭에서 본다: 넘침 0 · 열 수 · 블록 안 요소가 가운데 · 모션 부품이 서로 안 겹침.
// 모션 상자는 고정 높이라 어느 폭에서도 잘리거나 이웃을 밀지 않아야 한다.
const showFit = async (w, mobile) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await sleep(700);
  await ev(`document.querySelector('.home-show').scrollIntoView({ block: 'center' })`);
  await sleep(400);
  return ev(`(() => {
    const items = [...document.querySelectorAll('.home-show-item')];
    const mid = (r) => (r.left + r.right) / 2;
    return {
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cols: getComputedStyle(document.querySelector('.home-show-grid')).gridTemplateColumns.split(' ').filter(Boolean).length,
      // 컷·제목·문장의 가운데가 블록의 가운데와 같은가
      offCenter: Math.max(...items.map(b => {
        const r = b.getBoundingClientRect();
        return Math.max(...['.home-show-cut', '.home-show-name', '.home-show-desc']
          .map(k => Math.abs(mid(b.querySelector(k).getBoundingClientRect()) - mid(r))));
      })).toFixed(1),
      // 글이 블록 밖으로 나가지 않았는가
      clipped: items.filter(b => {
        const r = b.getBoundingClientRect(), d = b.querySelector('.home-show-desc').getBoundingClientRect();
        return d.left < r.left - 0.5 || d.right > r.right + 0.5 || d.bottom > r.bottom + 0.5;
      }).length,
      cutH: [...new Set(items.map(b => Math.round(b.querySelector('.home-show-cut').getBoundingClientRect().height)))],
    };
  })()`);
};
await enter();
for (const [w, mobile, wantCols] of [[375, true, 1], [414, true, 1], [768, false, 2], [1024, false, 2], [1440, false, 4]]) {
  const f = await showFit(w, mobile);
  check(`쇼케이스 ${w}px — 넘침 없이 ${wantCols}열로 선다`,
    f.over <= 0 && f.cols === wantCols, `${f.cols}열 / 넘침 ${f.over}px`);
  check(`쇼케이스 ${w}px — 블록 안 요소가 가운데이고 글이 안 잘린다`,
    Number(f.offCenter) <= 2 && f.clipped === 0 && f.cutH.length === 1 && f.cutH[0] === 96,
    `중심차 ${f.offCenter}px / 잘림 ${f.clipped} / 컷 ${JSON.stringify(f.cutH)}`);
}
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);

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
const mob = await ev(`(() => {
  const dpr = window.devicePixelRatio || 1;
  const all = [...document.querySelectorAll('img[src*="/chars/"]')];
  const t = document.querySelector('.home-hero-text').getBoundingClientRect();
  const one = document.querySelector('.home-cut').getBoundingClientRect();
  return {
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cards: document.querySelectorAll('.home-card').length,
    wide: [...document.querySelectorAll('.home-card')].some(c => c.getBoundingClientRect().right > window.innerWidth + 0.5),
    cuts: all.length,
    // 컷의 rect로 잰다 - 담는 상자는 블록이라 내용과 무관하게 폭이 꽉 차서, 그것으로
    // 재면 컷이 화면을 넘어도 언제나 0으로 나온다.
    // (이 주석에 역따옴표를 쓰지 말 것 - 이 블록 전체가 템플릿 문자열이라 거기서 끊긴다)
    cutOver: (() => {
      const r = all.map(c => c.getBoundingClientRect());
      return Math.round(Math.max(Math.max(...r.map(x => x.right)) - window.innerWidth, -Math.min(...r.map(x => x.left))));
    })(),
    // 레티나에서 받은 파일보다 크게 그려지는 컷 (naturalHeight는 밀도 보정된 값)
    upscaled: all.filter(c => Math.round(c.getBoundingClientRect().height) > c.naturalHeight + 1)
      .map(c => (c.currentSrc || '').split('/').pop() + ' ' + Math.round(c.getBoundingClientRect().height) + '/' + c.naturalHeight),
    retina: all.every(c => (c.currentSrc || '').includes('@2x.webp')),
    cutBelow: one.top >= t.bottom - 1,
    dpr,
  };
})()`);
const mobCols = await cols('.home-cards');
check('모바일 375px — 가로로 넘치지 않는다', mob.over <= 0, `넘침 ${mob.over}px`);
check('모바일 375px — 카드가 한 줄에 하나씩', mobCols === 1 && mob.cards === 4 && mob.wide === false, `${mobCols}열 / ${mob.cards}장`);
const showCols = await cols('.home-show-grid');
check('모바일 375px — 쇼케이스는 한 줄에 하나씩', showCols === 1, `${showCols}열`);
check('모바일 375px — 컷 다섯 장이 가로로 넘치지 않는다',
  mob.cuts === 5 && mob.cutOver <= 0 && mob.cutBelow === true,
  `${mob.cuts}장 / 넘침 ${mob.cutOver}px`);
// 레티나(dpr 2)가 진짜 시험대다 — 원본이 200px 남짓이라 여기서 넘기면 흐려진다
check('레티나에서는 @2x 컷을 받고, 받은 파일보다 크게 그리지 않는다',
  mob.retina === true && mob.upscaled.length === 0,
  `dpr ${mob.dpr} / @2x ${mob.retina} / ${JSON.stringify(mob.upscaled)}`);
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
    // 히어로는 카드가 아니라 **화면 바탕** 위에 선다 — 배경은 body에서 잰다
    page: { bg: getComputedStyle(document.body).backgroundColor, fg: '' },
    greeting: grab('.home-greeting'), tagline: grab('.home-tagline'), chip: grab('.home-date'),
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
// 히어로는 카드 밖(화면 바탕 위)이라 따로 잰다 — 여기서 색을 박아 두면 다크에서
// 인사말이 바탕에 묻힌다(캐릭터 그림은 투명 배경이라 그대로 얹힌다).
const dh = [
  ['인사말', contrast(darkPaint.greeting.fg, darkPaint.page.bg)],
  ['태그라인', contrast(darkPaint.tagline.fg, darkPaint.page.bg)],
  ['날짜 칩', contrast(darkPaint.chip.fg, darkPaint.chip.bg)],
];
check('다크에서도 히어로 글자가 바탕에 묻히지 않는다', dh.every(([, v]) => v >= 2),
  dh.map(([n, v]) => `${n} ${v.toFixed(1)}`).join(' · '));
check('다크에서 히어로 글자도 색을 바꾼다(토큰을 쓴다)',
  darkPaint.greeting.fg !== lightPaint.greeting.fg && darkPaint.tagline.fg !== lightPaint.tagline.fg,
  `${lightPaint.greeting?.fg} → ${darkPaint.greeting?.fg}`);

await send('Emulation.clearDeviceMetricsOverride');
check('콘솔 오류 0', logs.length === 0, logs.slice(0, 3).join(' / '));

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
