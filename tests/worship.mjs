// 예배 줄기 — 주보 목록·상세(말씀/담당자/찬양/광고) · 작성·발행 · 출석 체크 · 내 예배 노트
//
// 게스트 모드에는 클라우드가 없어서 화면이 비어 있는 것이 정상이다. 그래서 예배 서비스
// 계층(services/worship.js)이 게스트에서 보는 자리(localStorage 'church_worship_v1')에
// 가짜 주보·명단을 심고, 화면을 실제로 눌러 본다. 자격(회장·순장·일반)은 시드의 me가
// 말한다 — 클라우드에서는 RLS가 같은 경계를 긋는다(0035·0036).
//
// **시드 날짜는 오늘 기준 상대값이다.** 출석 진입이 '예배 날짜가 지난 뒤'로 잠겼기
// 때문에(사용자 결정 2026-09-01), 달을 못 박으면 검사를 도는 시기에 따라 답이 달라진다.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = 9573;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cwor-'));
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
const byText = (t) => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(t)})`;
const check = (n, p, d = '') => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
// 화면이 그려질 때까지 기다린다. 고정 sleep만으로는 흔들린다 — 개발 서버가 처음
// 변환하는 청크(마크다운 편집기는 tiptap을 통째로 물고 온다)는 첫 진입에서 몇 초가
// 걸리고, 그동안 `querySelector(...).click()`은 null·undefined에 걸려 스위트가 통째로
// 죽는다(검사 하나가 FAIL 나는 것과 달리 결과가 아예 안 나온다).
const waitFor = async (expr, to = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < to) { if (await ev(expr)) return true; await sleep(120); }
  return false;
};
const HAS_CARD = `!!document.querySelector('.worship-card')`;
const HAS_DETAIL = `!!document.querySelector('.worship-detail .worship-tabpanel')`;
const HAS_EDIT = `!!${byText('수정')}`;
const HAS_ATT = `!!document.querySelector('.worship-att-open')`;

// ── 가짜 주보·명단 ──────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');
const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const PAST1 = shift(-3);      // 지난 주일 — 출석을 만질 수 있는 주보
const PAST2 = shift(-10);
const SOON = shift(4);        // 아직 오지 않은 예배 — 발행해도 출석은 안 열린다
// 순 편성은 그 예배 날짜의 연도 것을 쓴다(worship.serviceYear) — s1 기준으로 맞춘다
const Y = Number(PAST1.slice(0, 4));

const seed = {
  people: [
    { id: 'p1', name: '김윤주', profile_id: 'u1' },
    { id: 'p2', name: '천진영', profile_id: null },
    { id: 'p3', name: '김승찬', profile_id: null },
    { id: 'p4', name: '배현민', profile_id: null },
    { id: 'p5', name: '임재훈', profile_id: null },
    { id: 'p6', name: '노준석', profile_id: 'u2' },
    { id: 'p7', name: '조해리', profile_id: null },
    { id: 'p8', name: '양민혁', profile_id: null },
  ],
  groups: [
    { id: 'g1', type: 'sun', name: '꼬순', year: Y, leader_person_id: 'p1' },
    { id: 'g2', type: 'sun', name: 'TT순', year: Y, leader_person_id: 'p6' },
  ],
  group_members: [
    { group_id: 'g1', person_id: 'p2' }, { group_id: 'g1', person_id: 'p3' },
    { group_id: 'g2', person_id: 'p4' }, { group_id: 'g2', person_id: 'p5' },
  ],
  services: [
    { id: 's1', kind: 'sunday', service_date: PAST1, status: 'published',
      title: '흔들리지 않는 기쁨', passage_ref: '이사야 32:9-20', preacher: '임성빈 전도사님',
      roles: [{ role: '대표기도', personId: 'p1', name: '김윤주' }, { role: '헌금봉헌', personId: null, name: '한상록 강사님' }],
      songs: [{ title: '주 은혜임을', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, { title: '나의 반석이신 하나님' }],
      notices: [{ title: '겨울 수련회 신청', body: '1월 20일까지 순장에게 신청해주세요' }],
      attendance_note: '' },
    { id: 's2', kind: '금요 열정 예배', service_date: PAST2, status: 'published',
      title: '깨어 기도하라', passage_ref: '주보 특별 순서', preacher: '양민혁 회장',
      roles: [], songs: [], notices: [] },
    { id: 's3', kind: 'sunday', service_date: SOON, status: 'draft',
      title: '', passage_ref: '', preacher: '', roles: [], songs: [], notices: [] },
  ],
  attendance: [{ service_id: 's1', person_id: 'p2' }],
  service_notes: [],
};

const plant = (me) => `(() => {
  const s = ${JSON.stringify(JSON.stringify(seed))};
  const g = JSON.parse(s);
  ${me ? `g.me = ${JSON.stringify(me)};` : ''}
  localStorage.setItem('church_worship_v1', JSON.stringify(g));
  localStorage.setItem('theme', 'light');
})()`;

// 데스크톱 상단 '예배'로 들어간다(회차 3 IA 재편 전의 임시 진입로 — docs/V2.md §3)
const GO = `(() => {
  const b = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === '예배')[0];
  if (!b) return false; b.click(); return true;
})()`;
// React가 듣는 것은 네이티브 setter가 아니라 input 이벤트다 — 값과 이벤트를 같이 준다
const typeIn = (sel, v, tag = 'HTMLInputElement') => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  Object.getOwnPropertyDescriptor(${tag}.prototype, 'value').set.call(el, ${JSON.stringify(v)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`;
// 본문 선택 — 책은 자동완성 입력칸, 장·절은 숫자 그리드 팝오버(둘 다 우리 부품이다)
const typeBook = (v) => typeIn('.worship-book input', v);
const firstBook = `document.querySelector('.worship-book-list button')`;
const openNum = (label) => `document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`;
const pickNum = (n) => `[...document.querySelectorAll('.worship-num-pop button')]
  .find(b => b.textContent.trim() === ${JSON.stringify(String(n))}).click()`;
// 팝오버 바깥을 눌러서 닫는다(바깥 판정에 body 포털로 나간 팝오버 자신도 들어 있다)
const clickAway = `document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`;
// 토큰 색을 실제로 그려 보고 견준다 — 테마가 바뀌어도 이 비교는 그대로 선다
const tokenColor = (name) => `(() => {
  const el = document.createElement('span');
  el.style.background = 'var(${name})';
  document.body.appendChild(el);
  const c = getComputedStyle(el).backgroundColor;
  el.remove();
  return c;
})()`;

// 빈 상태 — 마크(SVG 선 그리기)와 함께 남는 공간의 세로·가로 가운데인지 잰다.
// 내용(마크 + 글자)을 감싼 상자의 가운데와 빈 상태 칸의 가운데가 같아야 한다.
// 캐릭터 컷을 잠깐 얹었다가 걷어냈다(사용자 결정 2026-09-03 — 홈 말고는 캐릭터 없음).
//
// 그리고 **그 칸이 남는 공간을 실제로 차지하는지**도 같이 잰다(fill = 화면 감싸개의
// 끝과 스크롤 박스 바닥 사이). 46vh 고정값이던 때는 칸 안에서는 가운데였지만 칸이
// 화면보다 작아서 **아래로 250~270px이 통째로 비었다**(사용자 지적 2026-09-02).
// 칸 자신의 아래를 재면 안 된다 — 상세 화면은 그 아래에 노트가 오므로 늘 0이 나온다.
const EMPTY = `(() => {
  const box = document.querySelector('.worship-empty');
  if (!box) return null;
  const b = box.getBoundingClientRect();
  const main = document.querySelector('main');
  const kids = [...box.children].map(k => k.getBoundingClientRect());
  const top = Math.min(...kids.map(k => k.top)), bottom = Math.max(...kids.map(k => k.bottom));
  const left = Math.min(...kids.map(k => k.left)), right = Math.max(...kids.map(k => k.right));
  return {
    mark: !!box.querySelector('svg'),
    marks: box.querySelectorAll('svg').length,
    chars: box.querySelectorAll('img[src*="/chars/"]').length,
    h: Math.round(b.height), vh: innerHeight,
    dy: Math.round((top + bottom) / 2 - (b.top + b.bottom) / 2),
    dx: Math.round((left + right) / 2 - (b.left + b.right) / 2),
    fill: Math.round(main.getBoundingClientRect().bottom - parseFloat(getComputedStyle(main).paddingBottom)
      - box.closest('.worship-list, .worship-detail').getBoundingClientRect().bottom),
    scroll: main.scrollHeight - main.clientHeight,
    text: box.innerText.trim(),
  };
})()`;
// 문턱이 0.35인 이유: 상세 화면의 빈 탭은 아래에 '내 예배 노트'(서식 바 + 편집기)가
// 실제로 자리를 차지한다 — 그래도 화면의 3분의 1은 넘어야 '넓은 빈 자리'다.
const centered = (e) => !!e && e.mark === true && e.h >= e.vh * 0.35 && Math.abs(e.dy) <= 2 && Math.abs(e.dx) <= 2;
// 남는 공간을 차지했나 — 화면이 스크롤 박스 바닥까지 닿고(빈 자리가 아래에 남지 않고),
// 그렇다고 넘쳐서 스크롤이 생기지도 않아야 한다(감싸개의 pb까지 세야 딱 맞는다)
const fills = (e) => !!e && e.fill >= 0 && e.fill <= 4 && e.scroll <= 0;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
await ev(plant(null));
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
await sleep(1500);

// ── 0) 순수 로직 — 화면 없이도 맞아야 하는 것들 ─────────────────────────────
const pure = await ev(`(async () => {
  const m = await import('/src/services/worship.js');
  const perms = (o) => { const p = m.worshipPerms(o); return [p.canEdit, p.canCheckAll, p.canCheck]; };
  const att = (status, date) => m.attendanceOpen({ status, service_date: date }, '2026-09-01');
  return {
    sunOnSat: m.nextSundayDate(new Date(2026, 8, 5)),     // 토 → 다음날
    sunOnSun: m.nextSundayDate(new Date(2026, 8, 6)),     // 주일 당일은 그날
    date: m.formatServiceDate('2026-09-06'),
    dateOtherYear: m.formatServiceDate('2025-12-25'),
    label: [m.kindLabel('sunday'), m.kindLabel('금요 열정 예배')],
    plain: perms({}),
    president: perms({ myRoles: ['president'] }),
    pastor: perms({ myPerson: { is_pastor: true } }),
    officer: perms({ myRoles: ['officer'] }),
    master: perms({ isMaster: true }),
    admin: perms({ isAdmin: true }),
    media: perms({ myPerson: { teams: ['미디어팀'] } }),
    otherTeam: perms({ myPerson: { teams: ['찬양팀'] } }),
    sunjang: perms({ ledGroupIds: ['g1'] }),
    attPast: att('published', '2026-08-30'),
    attToday: att('published', '2026-09-01'),
    attFuture: att('published', '2026-09-06'),
    attDraft: att('draft', '2026-08-30'),
    kstShape: /^\\d{4}-\\d{2}-\\d{2}$/.test(m.kstToday()),
    toggleMine: m.canToggleGroup({ canCheckAll: false, ledGroupIds: ['g1'] }, 'g1'),
    toggleOther: m.canToggleGroup({ canCheckAll: false, ledGroupIds: ['g1'] }, 'g2'),
    toggleUnassigned: m.canToggleGroup({ canCheckAll: false, ledGroupIds: ['g1'] }, null),
    // 순장(한결)은 가나다순으로는 맨 뒤인데도 맨 앞이어야 하고, 나머지는 준 순서가
    // 아니라 가나다순이어야 한다. '순 미지정'도 같다.
    // 유튜브 주소에서 재생목록·영상 id 뽑기. **호스트가 유튜브가 아니면 null**이라야
    // 한다 — 이 값이 그대로 서버 함수로 가기 때문에 여기가 열린 프록시를 막는 문이다.
    listWatch: m.youtubeListId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLl2Yb-KJTF0ZqPJnQ8bT9'),
    listPlain: m.youtubeListId('https://www.youtube.com/playlist?list=PLl2Yb-KJTF0ZqPJnQ8bT9'),
    listShort: m.youtubeListId('https://youtu.be/dQw4w9WgXcQ?list=PLl2Yb-KJTF0ZqPJnQ8bT9'),
    listNoScheme: m.youtubeListId('www.youtube.com/playlist?list=PLl2Yb-KJTF0ZqPJnQ8bT9'),
    listBadHost: m.youtubeListId('https://evil.example.com/playlist?list=PLl2Yb-KJTF0ZqPJnQ8bT9'),
    listNone: m.youtubeListId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    listJunk: [m.youtubeListId(''), m.youtubeListId('그냥 글자'), m.youtubeListId('https://www.youtube.com/playlist?list=short')],
    vidWatch: m.youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij'),
    vidShort: m.youtubeVideoId('https://youtu.be/dQw4w9WgXcQ'),
    vidShorts: m.youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    vidBadHost: m.youtubeVideoId('https://vimeo.com/watch?v=dQw4w9WgXcQ'),
    vidBadId: m.youtubeVideoId('https://www.youtube.com/watch?v=short'),
    watchUrl: m.youtubeWatchUrl('dQw4w9WgXcQ'),
    // 가져온 곡 붙이기 — 같은 영상은 한 번만(두 번 가져와도 겹치지 않아야 한다)
    merged: m.mergeSongs(
      [{ title: '주 은혜임을', link: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }, { title: '손으로 적은 곡' }],
      [{ title: '이미 있는 곡', link: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
        { title: '새 곡', link: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' },
        { title: '같은 새 곡', link: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' }],
    ).map(s => s.title),
    buckets: m.groupRoster({
      people: [{ id: 'a', name: '한결' }, { id: 'b', name: '나리' }, { id: 'c', name: '가온' },
        { id: 'd', name: '정후' }, { id: 'e', name: '다솔' }],
      groups: [{ id: 'g1', name: '꼬순', leader_person_id: 'a' }],
      members: [{ group_id: 'g1', person_id: 'b' }, { group_id: 'g1', person_id: 'c' }],
    }).map(g => [g.name, g.people.map(p => p.name).join(',')]),
  };
})()`, true);
check('다가오는 주일 — 토요일이면 다음 날', pure.sunOnSat === '2026-09-06', pure.sunOnSat);
check('다가오는 주일 — 주일 당일은 그날', pure.sunOnSun === '2026-09-06', pure.sunOnSun);
// 연도는 **늘 두 자리로** 붙는다(사용자 결정 2026-09-03 — 지난 예배를 훑을 때 어느
// 해인지가 카드마다 달라 헷갈렸다)
check('날짜 표기 — 두 자리 연도 + 요일', pure.date === '26년 9월 6일 (일)', pure.date);
check('지난 해 예배도 같은 모양', pure.dateOtherYear === '25년 12월 25일 (목)', pure.dateOtherYear);
check('종류 이름 — sunday는 주일 4부 젊은이 예배, 나머지는 적은 그대로',
  pure.label[0] === '주일 4부 젊은이 예배' && pure.label[1] === '금요 열정 예배', JSON.stringify(pure.label));
check('일반 멤버는 작성도 출석도 못 한다', JSON.stringify(pure.plain) === '[false,false,false]', JSON.stringify(pure.plain));
check('회장은 주보 작성 + 전체 출석', JSON.stringify(pure.president) === '[true,true,true]', JSON.stringify(pure.president));
// 0042 — 주보 자격에서 교역자가 빠지고 **미디어팀**이 들어왔다(사용자 결정 2026-09-03)
check('교역자는 전체 출석만(주보는 이제 못 쓴다)',
  JSON.stringify(pure.pastor) === '[false,true,true]', JSON.stringify(pure.pastor));
check('미디어팀은 주보를 쓴다(명단 teams 갈래)',
  pure.media[0] === true && pure.otherTeam[0] === false,
  JSON.stringify([pure.media, pure.otherTeam]));
check('관리자는 주보 작성 + 전체 출석', JSON.stringify(pure.admin) === '[true,true,true]', JSON.stringify(pure.admin));
check('임원은 전체 출석만(주보 작성은 아니다)', JSON.stringify(pure.officer) === '[false,true,true]', JSON.stringify(pure.officer));
check('마스터는 주보 작성', pure.master[0] === true, JSON.stringify(pure.master));
check('순장은 출석만, 그것도 전체는 아니다', JSON.stringify(pure.sunjang) === '[false,false,true]', JSON.stringify(pure.sunjang));
check('순장은 자기 순만 만진다', pure.toggleMine === true && pure.toggleOther === false, `${pure.toggleMine}/${pure.toggleOther}`);
check("'순 미지정'은 전체 자격자만 만진다", pure.toggleUnassigned === false);
check('순장은 편성 명단에 없어도 자기 순에 선다', pure.buckets[0][1].startsWith('한결'), JSON.stringify(pure.buckets));
check('순 안 순서는 순장 먼저, 나머지는 가나다순', pure.buckets[0][1] === '한결,가온,나리', JSON.stringify(pure.buckets));
check("어느 순에도 없는 사람은 '순 미지정'으로, 거기도 가나다순",
  JSON.stringify(pure.buckets[1]) === '["순 미지정","다솔,정후"]', JSON.stringify(pure.buckets));
check('출석은 발행된 뒤 · 예배 날짜가 지난(오늘 포함) 뒤에만 연다',
  pure.attPast === true && pure.attToday === true && pure.attFuture === false && pure.attDraft === false,
  `과거${pure.attPast}/오늘${pure.attToday}/미래${pure.attFuture}/작성중${pure.attDraft}`);
check('오늘은 한국 시간으로 잰다', pure.kstShape === true);
check('유튜브 재생목록 id — watch·playlist·youtu.be·스킴 없는 주소에서 다 뽑는다',
  pure.listWatch === 'PLl2Yb-KJTF0ZqPJnQ8bT9' && pure.listPlain === 'PLl2Yb-KJTF0ZqPJnQ8bT9'
  && pure.listShort === 'PLl2Yb-KJTF0ZqPJnQ8bT9' && pure.listNoScheme === 'PLl2Yb-KJTF0ZqPJnQ8bT9',
  JSON.stringify([pure.listWatch, pure.listPlain, pure.listShort, pure.listNoScheme]));
check('유튜브가 아닌 주소·재생목록 없는 주소·엉뚱한 글자는 null',
  pure.listBadHost === null && pure.listNone === null && pure.listJunk.every(v => v === null),
  JSON.stringify([pure.listBadHost, pure.listNone, pure.listJunk]));
check('유튜브 영상 id — watch·youtu.be·shorts에서 뽑고 남의 호스트·엉뚱한 id는 null',
  pure.vidWatch === 'dQw4w9WgXcQ' && pure.vidShort === 'dQw4w9WgXcQ' && pure.vidShorts === 'dQw4w9WgXcQ'
  && pure.vidBadHost === null && pure.vidBadId === null,
  JSON.stringify([pure.vidWatch, pure.vidShort, pure.vidShorts, pure.vidBadHost, pure.vidBadId]));
check('영상 주소는 watch?v= 모양으로 저장된다', pure.watchUrl === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', pure.watchUrl);
check('가져온 곡은 뒤에 붙고 같은 영상은 한 번만 들어간다',
  JSON.stringify(pure.merged) === '["주 은혜임을","손으로 적은 곡","새 곡"]', JSON.stringify(pure.merged));

// 화면에 뜰 날짜 글자는 서비스가 만든 것과 견준다(시드가 상대 날짜라서)
const DL = await ev(`(async () => {
  const m = await import('/src/services/worship.js');
  return { p1: m.formatServiceDate(${JSON.stringify(PAST1)}), p2: m.formatServiceDate(${JSON.stringify(PAST2)}) };
})()`, true);

// ── 1) 목록 ─────────────────────────────────────────────────────────────────
check('데스크톱 상단에 예배 진입로가 있다', (await ev(GO)) === true);
await waitFor(HAS_CARD); await sleep(400);
const list = await ev(`(() => {
  const root = document.querySelector('.worship-list');
  return {
    open: !!root,
    width: root ? Math.round(root.getBoundingClientRect().width) : 0,
    parent: root ? Math.round(root.parentElement.getBoundingClientRect().width) : 0,
    chips: [...document.querySelectorAll('.worship-kind-chip')].map(c => c.textContent.trim()),
    cards: [...document.querySelectorAll('.worship-card')].map(c => c.innerText.replace(/\\n+/g, ' | ')),
    drafts: document.querySelector('.worship-drafts-open')?.textContent.trim() || null,
    newBtn: !!document.querySelector('.worship-new-open'),
    draftBadges: document.querySelectorAll('.worship-card .worship-draft-badge').length,
  };
})()`);
check('예배 화면이 열린다', list.open === true);
check('레이아웃은 대시보드와 같은 폭을 쓴다(가운데 좁은 기둥이 아니다)',
  list.width >= list.parent - 1 && list.width > 900, `${list.width}px / 부모 ${list.parent}px`);
check('종류 칩 세 개', JSON.stringify(list.chips) === '["전체","주일예배","그 밖의 예배"]', JSON.stringify(list.chips));
check('목록은 발행본만, 최신순', list.cards.length === 2 && (list.cards[0] || '').includes(DL.p1), JSON.stringify(list.cards));
const card0 = list.cards[0] || '';
check('카드에 종류·날짜·설교 제목·본문·설교자',
  card0.includes('주일 4부 젊은이 예배') && card0.includes('흔들리지 않는 기쁨')
  && card0.includes('이사야 32:9-20') && card0.includes('임성빈 전도사님'), card0);
check('발행본에는 작성 중 배지가 없다', list.draftBadges === 0, String(list.draftBadges));

// 카드는 **두 줄**이다(사용자 지적 2026-09-03 — 줄바꿈이 많아 무엇을 봐야 할지 모른다).
// 첫 줄은 설교 제목, 둘째 줄은 날짜·종류·본문·설교자를 가운뎃점으로 이은 한 줄이다.
const shape = await ev(`(() => {
  const cards = [...document.querySelectorAll('.worship-card')];
  const c = cards[0];
  const title = c.querySelector('.worship-card-title');
  const meta = c.querySelector('.worship-card-meta');
  const lines = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
  return {
    blocks: c.children.length,
    title: title.textContent.trim(),
    meta: meta.textContent.trim(),
    titleLines: lines(title), metaLines: lines(meta),
    sameRow: Math.abs(title.getBoundingClientRect().top - meta.getBoundingClientRect().top) > 4,
    heights: cards.map(x => Math.round(x.getBoundingClientRect().height)),
    fontSize: parseFloat(getComputedStyle(title).fontSize),
  };
})()`);
check('카드는 제목 한 줄 + 메타 한 줄이다',
  shape.blocks === 2 && shape.titleLines === 1 && shape.metaLines === 1 && shape.sameRow === true,
  JSON.stringify(shape));
check('메타 한 줄에 날짜 · 종류 · 본문 · 설교자가 가운뎃점으로 이어진다',
  shape.meta === `${DL.p1} · 주일 4부 젊은이 예배 · 본문 이사야 32:9-20 · 임성빈 전도사님`, shape.meta);
check('제목이 초점이다(15px 이상 · 굵게)', shape.fontSize >= 15, String(shape.fontSize));
check('카드 높이가 줄마다 같다', new Set(shape.heights).size === 1, JSON.stringify(shape.heights));
check('편집 자격자에게 새 주보 · 작성 중 줄', list.newBtn === true && list.drafts === '작성 중 1', `${list.newBtn}/${list.drafts}`);

await ev(`[...document.querySelectorAll('.worship-kind-chip')].find(c => c.textContent.trim() === '그 밖의 예배').click()`);
await sleep(300);
const other = await ev(`[...document.querySelectorAll('.worship-card')].map(c => [
  c.querySelector('.worship-card-title').textContent.trim(),
  c.querySelector('.worship-card-meta').textContent.trim()])`);
check('종류 칩으로 거른다',
  other.length === 1 && other[0][0] === '깨어 기도하라' && other[0][1].includes('금요 열정 예배'),
  JSON.stringify(other));
await ev(`[...document.querySelectorAll('.worship-kind-chip')].find(c => c.textContent.trim() === '전체').click()`);
await sleep(250);

await ev(`document.querySelector('.worship-drafts-open').click()`);
await sleep(350);
const draftList = await ev(`(() => ({
  cards: [...document.querySelectorAll('.worship-card')].map(c => c.innerText.replace(/\\n+/g, ' | ')),
  badges: document.querySelectorAll('.worship-card .worship-draft-badge').length,
}))()`);
check('작성 중 줄로 임시저장 목록에 들어간다', draftList.cards.length === 1 && draftList.badges === 1, JSON.stringify(draftList));

// 빈 목록 — 작성 중 + '그 밖의 예배'는 한 건도 없다(작성 중인 것은 주일예배뿐)
await ev(`[...document.querySelectorAll('.worship-kind-chip')].find(c => c.textContent.trim() === '그 밖의 예배').click()`);
await sleep(400);
const emptyList = await ev(EMPTY);
check('빈 목록은 마크와 함께 남는 공간의 가운데에 선다', centered(emptyList), JSON.stringify(emptyList));
check('빈 목록 칸이 남는 공간을 그대로 차지한다(아래가 통째로 비지 않는다)',
  fills(emptyList), JSON.stringify(emptyList));
check("빈 목록 문구는 지금 보고 있는 줄을 따른다", emptyList?.text === '작성 중인 주보가 아직 없어요', JSON.stringify(emptyList?.text));
await ev(`[...document.querySelectorAll('.worship-kind-chip')].find(c => c.textContent.trim() === '전체').click()`);
await sleep(300);

// 작성 중인 주보에는 출석 진입이 없다 — 발행 전이기 때문(자격과는 별개)
await ev(`document.querySelector('.worship-card').click()`); await sleep(1000);
const draftDetail = await ev(`(() => ({
  att: !!document.querySelector('.worship-att-open'),
  toolbar: [...document.querySelectorAll('.worship-detail > div:first-child button')].map(b => b.textContent.trim()),
}))()`);
check('작성 중인 주보에는 출석 진입이 없다(발행 전)', draftDetail.att === false, JSON.stringify(draftDetail));
check('상시 도구 줄 — 확정 왼쪽 / 나가기 오른쪽',
  JSON.stringify(draftDetail.toolbar) === '["발행하기","목록으로"]', JSON.stringify(draftDetail.toolbar));
// 수정은 **머리줄 오른쪽의 채운 버튼**이다(사용자 지적 2026-09-03: 눈에 안 띈다)
const editBtn = await ev(`(() => {
  const b = document.querySelector('.worship-edit-open');
  if (!b) return null;
  const head = document.querySelector('.worship-detail header');
  const cs = getComputedStyle(b);
  return {
    inHead: !!head && head.contains(b),
    right: Math.round(head.getBoundingClientRect().right - b.getBoundingClientRect().right),
    text: b.textContent.trim(),
    accent: cs.backgroundColor === ${tokenColor('--app-accent')},
    icon: !!b.querySelector('svg'),
  };
})()`);
check('수정은 머리줄 오른쪽에서 accent 채운 버튼이다',
  !!editBtn && editBtn.inHead === true && editBtn.right <= 1 && editBtn.text === '수정'
  && editBtn.accent === true && editBtn.icon === true, JSON.stringify(editBtn));

// 빈 탭 — 갓 만든 주보는 네 탭이 전부 비어 있다. 전부 같은 빈 상태 한 벌을 쓴다.
const emptyWord = await ev(EMPTY);
check('빈 말씀 탭도 마크와 함께 가운데', centered(emptyWord) && emptyWord.text === '설교 제목과 본문 구절을 아직 적지 않았어요',
  JSON.stringify(emptyWord));
check('마크는 새로 그리지 않고 기존 SVG 선 그리기 한 장이다',
  emptyWord?.marks === 1 && (await ev(`document.querySelectorAll('.worship-empty svg path.dc-draw').length`)) === 3,
  JSON.stringify(emptyWord?.marks));
const emptyTabs = [];
for (const t of ['담당자', '찬양', '광고']) {
  await ev(`[...document.querySelectorAll('.worship-tab')].find(x => x.textContent.trim() === ${JSON.stringify(t)}).click()`);
  await sleep(300);
  emptyTabs.push(await ev(EMPTY));
}
check('담당자·찬양·광고 빈 탭도 같은 자리·같은 마크',
  emptyTabs.every(centered) && emptyTabs.map(e => e.text).join('|') === '담당자를 아직 정하지 않았어요|찬양을 아직 정하지 않았어요|광고를 아직 적지 않았어요',
  JSON.stringify(emptyTabs.map(e => [e && e.text, e && e.dy, e && e.dx])));
check('빈 탭 칸도 탭 줄 아래 남는 공간을 그대로 차지한다',
  emptyTabs.every(fills), JSON.stringify(emptyTabs.map(e => [e && e.fill, e && e.scroll])));
// 목록으로 돌아오면 목록은 다시 발행본만 보여 준다(ServiceList가 새로 선다)
await ev(`${byText('목록으로')}.click()`); await sleep(700);

// ── 2) 상세 — 네 탭 ─────────────────────────────────────────────────────────
await ev(`document.querySelector('.worship-card').click()`);
await sleep(1400);
const detail = await ev(`(() => {
  const head = document.querySelector('.worship-detail header');
  const att = document.querySelector('.worship-att-open');
  return {
    open: !!document.querySelector('.worship-detail'),
    tabs: [...document.querySelectorAll('.worship-tab')].map(t => t.textContent.trim()),
    panel: document.querySelector('.worship-tabpanel')?.innerText || '',
    verses: document.querySelectorAll('.worship-verse').length,
    att: !!att,
    attInHead: !!(att && head && head.contains(att)),
    attRight: att ? Math.round(head.getBoundingClientRect().right - att.getBoundingClientRect().right) : -1,
    editRight: (() => {
      const e = document.querySelector('.worship-edit-open');
      return e && head ? Math.round(head.getBoundingClientRect().right - e.getBoundingClientRect().right) : -1;
    })(),
    bodyWidth: Math.round(document.querySelector('.worship-passage')?.getBoundingClientRect().width || 0),
    note: !!document.querySelector('.worship-note'),
  };
})()`);
check('상세에 탭 네 개', JSON.stringify(detail.tabs) === '["말씀","담당자","찬양","광고"]', JSON.stringify(detail.tabs));
check('말씀 탭에 제목·구절·설교자',
  detail.panel.includes('흔들리지 않는 기쁨') && detail.panel.includes('이사야 32:9-20') && detail.panel.includes('임성빈 전도사님'),
  detail.panel.slice(0, 80));
check('구절만 정하면 본문이 펼쳐진다(개역한글)', detail.verses === 12, `${detail.verses}절`);
check('본문 열은 읽는 폭을 지킨다', detail.bodyWidth > 300 && detail.bodyWidth <= 674, `${detail.bodyWidth}px`);
// 출석 체크와 수정이 머리줄 오른쪽에 나란히 선다 — 맨 오른쪽은 **수정**이다
// (사용자 지적 2026-09-03: 수정이 눈에 안 띈다 → 채운 버튼으로 머리줄로 올렸다)
check('출석 체크와 수정이 머리줄 오른쪽에 나란히 선다',
  detail.att === true && detail.attInHead === true && detail.editRight <= 1
  && detail.attRight > detail.editRight && detail.attRight <= 110,
  `att ${detail.attRight}px / edit ${detail.editRight}px`);
check('내 예배 노트', detail.note === true);

const tabClick = (n) => ev(`[...document.querySelectorAll('.worship-tab')].find(t => t.textContent.trim() === ${JSON.stringify(n)}).click()`);
await tabClick('담당자'); await sleep(300);
const roles = await ev(`[...document.querySelectorAll('.worship-role-row')].map(x => x.innerText.replace(/\\n+/g, ' | '))`);
check('담당자에 이름이 뜬다(명단 연결 · 자유 이름 둘 다)',
  roles.length === 2 && roles[0].includes('김윤주') && roles[0].includes('대표기도') && roles[1].includes('한상록 강사님'),
  JSON.stringify(roles));

await tabClick('찬양'); await sleep(300);
const songs = await ev(`(() => ({
  text: document.querySelector('.worship-tabpanel').innerText.replace(/\\n+/g, ' | '),
  blank: [...document.querySelectorAll('.worship-tabpanel a')].map(a => a.target),
}))()`);
check('찬양 목록 · 링크는 새 탭', songs.text.includes('주 은혜임을') && songs.text.includes('나의 반석이신 하나님')
  && JSON.stringify(songs.blank) === '["_blank"]', JSON.stringify(songs));
// 링크가 있으면 **제목 자체가 링크**다(예전에는 오른쪽 끝의 '듣기'가 따로 있었다)
const songLink = await ev(`(() => {
  const a = document.querySelector('.worship-song-link');
  if (!a) return null;
  return { text: a.textContent.trim(), accent: getComputedStyle(a).color === ${tokenColor('--app-accent-text')},
    icons: a.querySelectorAll('svg').length, plain: [...document.querySelectorAll('.worship-song-view')]
      .filter(li => !li.querySelector('a')).map(li => li.textContent.trim().replace(/^\\d+/, '')) };
})()`);
check('링크가 있는 찬양은 제목이 링크색으로 서고 아이콘이 붙는다',
  !!songLink && songLink.text.includes('주 은혜임을') && songLink.accent === true && songLink.icons === 1,
  JSON.stringify(songLink));
check('링크가 없는 찬양은 그냥 글자다',
  !!songLink && songLink.plain.length === 1 && songLink.plain[0] === '나의 반석이신 하나님', JSON.stringify(songLink && songLink.plain));

await tabClick('광고'); await sleep(300);
const notices = await ev(`document.querySelector('.worship-tabpanel').innerText.replace(/\\n+/g, ' | ')`);
check('광고는 순번 목록', notices.includes('1') && notices.includes('겨울 수련회 신청') && notices.includes('1월 20일까지'), notices);
// 광고 한 건은 **카드 한 장**이다 — 제목이 굵고, 본문은 두 줄에서 접힌다(넘칠 때만
// 펼치기가 붙는다 · 사용자 지적 2026-09-03)
const noticeCard = await ev(`(() => {
  const card = document.querySelector('.worship-notice-card');
  if (!card) return null;
  const title = card.querySelector('.worship-notice-title');
  const body = card.querySelector('.worship-notice-body');
  return {
    boxed: getComputedStyle(card).borderTopWidth !== '0px',
    bold: Number(getComputedStyle(title).fontWeight) >= 700,
    clamp: getComputedStyle(body).webkitLineClamp || getComputedStyle(body).getPropertyValue('-webkit-line-clamp'),
    more: !!card.querySelector('.worship-notice-more'),
    body: body.textContent.trim(),
  };
})()`);
check('광고는 카드 한 장 · 제목이 굵다',
  !!noticeCard && noticeCard.boxed === true && noticeCard.bold === true, JSON.stringify(noticeCard));
check('짧은 광고에는 펼치기가 붙지 않는다(누를 것이 없는 버튼을 두지 않는다)',
  !!noticeCard && noticeCard.more === false && noticeCard.clamp === '2', JSON.stringify(noticeCard));

// 못 읽는 구절은 손대지 않고 글자 그대로 둔다
await ev(`${byText('목록으로')}.click()`); await sleep(700);
await ev(`[...document.querySelectorAll('.worship-card')][1].click()`); await sleep(1200);
const raw = await ev(`(() => ({ text: document.querySelector('.worship-tabpanel').innerText, verses: document.querySelectorAll('.worship-verse').length }))()`);
check('못 읽는 구절은 적은 글자 그대로', raw.text.includes('주보 특별 순서') && raw.verses === 0, JSON.stringify(raw));
await ev(`${byText('목록으로')}.click()`); await sleep(700);

// ── 3) 출석 체크 ────────────────────────────────────────────────────────────
await ev(`document.querySelector('.worship-card').click()`); await sleep(1200);
await waitFor(HAS_ATT); await ev(`document.querySelector('.worship-att-open').click()`); await sleep(700);
const att = await ev(`(() => ({
  open: !!document.querySelector('.worship-attendance'),
  total: document.querySelector('.att-total')?.innerText.replace(/\\s+/g, ' ') || '',
  groups: [...document.querySelectorAll('.att-group-head')].map(h => h.innerText.replace(/\\s+/g, ' ')),
  chips: document.querySelectorAll('.att-chip').length,
  on: [...document.querySelectorAll('.att-chip')].filter(c => c.getAttribute('aria-pressed') === 'true').map(c => c.textContent.trim()),
  order: [...document.querySelectorAll('.worship-attendance section')]
    .filter(s => s.querySelector('.att-group-head'))
    .map(s => [...s.querySelectorAll('.att-chip')].map(c => c.textContent.trim())),
}))()`);
check('출석 화면이 열린다', att.open === true);
check('상단 집계 전체 n/m', att.total === '전체 1/8', att.total);
check('순별 목록 + 순 미지정 묶음',
  att.groups.length === 3 && att.groups[0].includes('꼬순 1/3') && att.groups[2].includes('순 미지정 0/2'), JSON.stringify(att.groups));
check('이미 체크된 사람이 켜져 있다', JSON.stringify(att.on) === '["천진영"]', JSON.stringify(att.on));
// 순장(김윤주·노준석)이 맨 앞, 나머지는 가나다순 — 시드가 준 순서와 다르다
// (꼬순은 천진영·김승찬 순으로, 순 미지정은 조해리·양민혁 순으로 심었다)
check('순 안 사람 칩은 순장 먼저 · 나머지는 가나다순',
  JSON.stringify(att.order) === JSON.stringify([['김윤주', '김승찬', '천진영'], ['노준석', '배현민', '임재훈'], ['양민혁', '조해리']]),
  JSON.stringify(att.order));

const head0 = `document.querySelectorAll('.att-group-head')[0]`;
await ev(`${head0}.click()`); await sleep(300);
const folded = await ev(`(() => ({ chips: document.querySelectorAll('.att-chip').length, open: ${head0}.getAttribute('aria-expanded') }))()`);
await ev(`${head0}.click()`); await sleep(300);
const unfolded = await ev(`document.querySelectorAll('.att-chip').length`);
check('순별로 접힌다', folded.chips === att.chips - 3 && folded.open === 'false', JSON.stringify(folded));
check('다시 펼쳐진다', unfolded === att.chips, `${unfolded}/${att.chips}`);

await ev(`[...document.querySelectorAll('.att-chip')].find(c => c.textContent.trim() === '김윤주').click()`);
await sleep(500);
const toggled = await ev(`(() => ({
  pressed: [...document.querySelectorAll('.att-chip')].find(c => c.textContent.trim() === '김윤주').getAttribute('aria-pressed'),
  total: document.querySelector('.att-total').innerText.replace(/\\s+/g, ' '),
  head: document.querySelectorAll('.att-group-head')[0].innerText.replace(/\\s+/g, ' '),
  stored: JSON.parse(localStorage.getItem('church_worship_v1')).attendance.length,
}))()`);
check('사람 칩을 누르면 출석이 켜진다', toggled.pressed === 'true' && toggled.stored === 2, JSON.stringify(toggled));
check('집계가 같이 오른다(전체 · 순별)', toggled.total === '전체 2/8' && toggled.head.includes('꼬순 2/3'), JSON.stringify(toggled));

await ev(`[...document.querySelectorAll('.att-chip')].find(c => c.textContent.trim() === '김윤주').click()`);
await sleep(500);
const off = await ev(`(() => ({ total: document.querySelector('.att-total').innerText.replace(/\\s+/g, ' '), stored: JSON.parse(localStorage.getItem('church_worship_v1')).attendance.length }))()`);
check('다시 누르면 출석이 취소된다', off.total === '전체 1/8' && off.stored === 1, JSON.stringify(off));

await ev(`document.querySelector('.att-add-open').click()`); await sleep(300);
await ev(typeIn('input[aria-label="미등록 출석자 이름"]', '한새싹'));
await sleep(200);
await ev(`${byText('추가')}.click()`); await sleep(700);
const added = await ev(`(() => ({
  total: document.querySelector('.att-total').innerText.replace(/\\s+/g, ' '),
  groups: [...document.querySelectorAll('.att-group-head')].map(h => h.innerText.replace(/\\s+/g, ' ')),
  on: [...document.querySelectorAll('.att-chip')].some(c => c.textContent.trim() === '한새싹' && c.getAttribute('aria-pressed') === 'true'),
}))()`);
check('미등록 출석자를 그 자리에서 명단에 올리고 출석 처리',
  added.total === '전체 2/9' && added.on === true && added.groups[2].includes('순 미지정 1/3'), JSON.stringify(added));

// 출석 메모는 자동 저장(디바운스)
await ev(typeIn('textarea[aria-label="출석 메모"]', '오늘은 새신자가 한 명 왔어요', 'HTMLTextAreaElement'));
await sleep(1600);
const noteSaved = await ev(`(() => ({
  text: JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.id === 's1').attendance_note,
  state: document.querySelector('.worship-attendance .worship-save-state')?.textContent.trim() || '',
}))()`);
check('출석 메모가 저절로 저장된다', noteSaved.text === '오늘은 새신자가 한 명 왔어요', String(noteSaved.text));
check('출석 메모도 같은 저장 라벨을 쓴다', noteSaved.state === '저장되었어요', noteSaved.state);

// ── 4) 내 예배 노트 ─────────────────────────────────────────────────────────
// **말씀의 내 묵상과 같은 구조**다(사용자 결정 2026-09-03): 편집기 아래
// `[저장] … [나만 보기 | 순에 공유하기]`. 글은 저장 버튼으로만 나가고(빈 노트는 저장할
// 것이 없어 잠긴다), 공유는 **저장된 노트의 상태만** 그 자리에서 바꾼다.
await ev(`${byText('주보로')}.click()`); await sleep(1200);
await waitFor(`!!document.querySelector('.worship-note .tiptap')`);
const noteIdle = await ev(`(() => ({
  save: document.querySelector('.worship-note-save').disabled,
  share: [...document.querySelectorAll('.worship-note button[aria-pressed]')].every(b => b.disabled),
  labels: [...document.querySelectorAll('.worship-note button[aria-pressed]')].map(b => b.textContent.trim()),
}))()`);
check('빈 노트에서는 저장할 것이 없다(버튼 잠김)', noteIdle.save === true, String(noteIdle.save));
check('저장한 노트가 없으면 공유 세그먼트도 잠긴다', noteIdle.share === true, String(noteIdle.share));
// 세그먼트는 **고를 것의 이름**을 그대로 둔다 — 바뀐 결과를 말하는 것은 옆의 초록
// 칩이다('나만 볼게요' / '우리 순에 공유할게요' · 사용자 정정 2026-09-03)
check("공유 세그먼트 라벨은 '나만 보기 | 순에 공유하기'",
  JSON.stringify(noteIdle.labels) === '["나만 보기","순에 공유하기"]', JSON.stringify(noteIdle.labels));


// 노트 칸은 **업무 본문과 같은 편집기**다 — 맨 textarea가 아니라 서식 바가 붙은
// 마크다운 편집기이고, 저장되는 값은 그대로 마크다운 문자열이다.
const noteEditor = await ev(`(() => ({
  tiptap: !!document.querySelector('.worship-note .tiptap'),
  textarea: !!document.querySelector('.worship-note textarea'),
  bar: [...document.querySelectorAll('.worship-note button[title]')]
    .map(b => b.title).filter(t => ['굵게', '형광펜', '제목 1', '체크리스트'].includes(t)).length,
}))()`);
check('내 예배 노트가 업무 본문과 같은 마크다운 편집기다',
  noteEditor.tiptap === true && noteEditor.textarea === false, JSON.stringify(noteEditor));
check('노트에도 서식 바가 같이 온다(굵게·형광펜·제목·체크리스트)', noteEditor.bar === 4, String(noteEditor.bar));

// **빈 자리를 눌러도 글이 써진다** — 글자가 있는 자리를 정확히 눌러야 커서가 잡히면
// 아래 여백을 누른 사람은 아무 일도 안 일어난 것으로 안다(§6 · MarkdownEditor의 focusEnd)
await ev(`(() => {
  // 클릭 대상은 .tiptap을 감싼 상자다(그 상자에 onMouseDown이 걸려 있다) — 바깥
  // 감싸개에 보내면 이벤트가 안쪽으로 내려가지 않는다(버블은 바깥으로만 흐른다)
  const box = document.querySelector('.worship-note-editor .tiptap').parentElement;
  const r = box.getBoundingClientRect();
  box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true,
    clientX: r.right - 12, clientY: r.bottom - 6 }));
})()`);
await sleep(300);
check('편집기 빈 자리를 눌러도 커서가 잡힌다',
  (await ev(`!!document.activeElement && !!document.activeElement.closest('.worship-note .tiptap')`)) === true);

await ev(`document.querySelector('.worship-note .tiptap').focus()`);
await send('Input.insertText', { text: '기쁨은 상황이 아니라 붙드시는 손에서 온다' });
await sleep(500);
const beforeSave = await ev(`(() => ({
  rows: JSON.parse(localStorage.getItem('church_worship_v1')).service_notes.length,
  can: !document.querySelector('.worship-note-save').disabled,
  share: [...document.querySelectorAll('.worship-note button[aria-pressed]')].every(b => b.disabled),
}))()`);
check('글을 쓰면 저장 버튼이 열린다(아직 저장은 안 됐다)',
  beforeSave.rows === 0 && beforeSave.can === true, JSON.stringify(beforeSave));
check('저장 전에는 공유가 잠겨 있다(공유할 것이 아직 없다)', beforeSave.share === true, String(beforeSave.share));

await ev(`document.querySelector('.worship-note-save').click()`); await sleep(900);
const noteRow = await ev(`(() => {
  const rows = JSON.parse(localStorage.getItem('church_worship_v1')).service_notes;
  return { n: rows.length, body: rows[0]?.body || '', shared: rows[0]?.shared_to_sun,
    again: document.querySelector('.worship-note-save').disabled,
    share: [...document.querySelectorAll('.worship-note button[aria-pressed]')].every(b => b.disabled),
    state: document.querySelector('.worship-note .worship-save-state')?.textContent.trim() || '' };
})()`);
check('내 예배 노트가 예배당 한 건으로 저장된다', noteRow.n === 1 && noteRow.body.startsWith('기쁨은'), JSON.stringify(noteRow));
check("노트는 발행이 없으니 '임시'가 붙지 않는다", noteRow.state === '저장되었어요', noteRow.state);
check('저장한 뒤에는 다시 눌릴 것이 없다', noteRow.again === true, String(noteRow.again));
check('저장하고 나면 공유 세그먼트가 열린다', noteRow.share === false, String(noteRow.share));
check('저장만으로는 공유되지 않는다(기본은 나만 보기)', noteRow.shared !== true, String(noteRow.shared));

// 공유는 **그 자리에서** 저장된다(묵상과 같다) — 글은 건드리지 않는다
await ev(`document.querySelectorAll('.worship-note button[aria-pressed]')[1].click()`);   // 공유 쪽(라벨과 무관하게 자리로)
await sleep(900);
const shareRow = await ev(`(() => {
  const rows = JSON.parse(localStorage.getItem('church_worship_v1')).service_notes;
  return { shared: rows[0]?.shared_to_sun, body: rows[0]?.body || '',
    chip: document.querySelector('.worship-note [data-share-chip]')?.textContent.trim() || '',
    pressed: [...document.querySelectorAll('.worship-note button[aria-pressed]')]
      .map(b => b.getAttribute('aria-pressed')) };
})()`);
check("'순에 공유하기'를 누르면 그 자리에서 저장된다",
  shareRow.shared === true && shareRow.body.startsWith('기쁨은'), JSON.stringify(shareRow));
check('공유 칩이 확정형으로 말한다', shareRow.chip === '우리 순에 공유할게요', shareRow.chip);
check('고른 쪽이 눌린 상태로 남는다', JSON.stringify(shareRow.pressed) === '["false","true"]', JSON.stringify(shareRow.pressed));
const shareLabels = await ev(`[...document.querySelectorAll('.worship-note button[aria-pressed]')]
  .map(b => b.textContent.trim())`);
check('세그먼트 라벨은 고른 뒤에도 그대로다(바뀌는 것은 칩이다)',
  JSON.stringify(shareLabels) === '["나만 보기","순에 공유하기"]', JSON.stringify(shareLabels));

// 되돌리면 칩도 되돌아 말한다 — 글은 그대로 남는다(services의 setNoteShared)
await ev(`document.querySelectorAll('.worship-note button[aria-pressed]')[0].click()`);   // 나만 보기 쪽
await sleep(900);
const backRow = await ev(`(() => {
  const rows = JSON.parse(localStorage.getItem('church_worship_v1')).service_notes;
  return { shared: rows[0]?.shared_to_sun, body: rows[0]?.body || '',
    chip: document.querySelector('.worship-note [data-share-chip]')?.textContent.trim() || '' };
})()`);
check("'나만 보기'로 되돌리면 칩이 '나만 볼게요'다",
  backRow.shared === false && backRow.chip === '나만 볼게요' && backRow.body.startsWith('기쁨은'),
  JSON.stringify(backRow));

// 서비스 계약 — setNoteShared(serviceId, shared)는 **글을 건드리지 않고** 공유만 바꾸고,
// 노트가 없으면 아무것도 만들지 않는다(모임 화면이 같은 함수를 쓴다)
const contract = await ev(`(async () => {
  const m = await import('/src/services/worship.js');
  const back = await m.setNoteShared('s1', true);
  const rows = JSON.parse(localStorage.getItem('church_worship_v1')).service_notes;
  const none = await m.setNoteShared('s2', true);
  return { back, stored: rows.find(r => r.service_id === 's1'), none,
    thumb: m.youtubeThumb('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    thumbBad: m.youtubeThumb('https://vimeo.com/watch?v=dQw4w9WgXcQ') };
})()`, true);
check('setNoteShared는 공유만 바꾸고 글은 그대로 둔다',
  contract.back?.shared_to_sun === true && contract.back?.body.startsWith('기쁨은')
  && contract.stored?.shared_to_sun === true, JSON.stringify(contract.back));
check('노트가 없는 주보에는 아무것도 만들지 않는다(null)', contract.none === null, JSON.stringify(contract.none));
check('썸네일 주소는 키 없이 만들어진다',
  contract.thumb === 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' && contract.thumbBad === null,
  JSON.stringify([contract.thumb, contract.thumbBad]));

// ── 5) 만들기 → 바로 수정 화면 ──────────────────────────────────────────────
await ev(`${byText('목록으로')}.click()`); await sleep(700);
await ev(`document.querySelector('.worship-new-open').click()`); await sleep(120);
// '뚝 하고 나온다'는 지적(2026-09-03) — 생성기는 §4.2의 등장 토큰을 탄다
const newAnim = await ev(`(() => {
  const el = document.querySelector('.worship-new');
  const cs = getComputedStyle(el);
  return { name: cs.animationName, dur: cs.animationDuration, props: cs.animationTimingFunction };
})()`);
check('새 주보 생성기는 등장 애니메이션을 탄다(뚝 나오지 않는다)',
  newAnim.name !== 'none' && newAnim.name !== '' && parseFloat(newAnim.dur) > 0, JSON.stringify(newAnim));
await sleep(300);
const expectLabel = await ev(`(async () => {
  const m = await import('/src/services/worship.js');
  const v = m.nextSundayDate();
  const [y, mo, d] = v.split('-').map(Number);
  const wd = new Date(y, mo - 1, d).toLocaleDateString('ko-KR', { weekday: 'short' });
  return y + '. ' + mo + '. ' + d + '. (' + wd + ')';
})()`, true);
const form = await ev(`(() => {
  const box = document.querySelector('.worship-new');
  const ctl = [...box.querySelectorAll('button, input')].filter(e => e.className.includes('worship-kind-pick')
    || box.querySelector('.worship-new-date').contains(e) || e.className.includes('worship-new-make'));
  return {
    dateBtn: document.querySelector('.worship-new-date button')?.textContent.trim() || '',
    nativeDate: !!box.querySelector('input[type="date"]'),
    kind: box.querySelector('.worship-kind-pick')?.textContent.trim() || '',
    nameBox: !!box.querySelector('input[aria-label="예배 이름"]'),
    canMake: !box.querySelector('.worship-new-make').disabled,
    rows: new Set(ctl.map(e => Math.round(e.getBoundingClientRect().top))).size,
    h: Math.round(box.getBoundingClientRect().height),
  };
})()`);
check('날짜는 업무의 날짜 픽커로 고른다(브라우저 기본 date 칸이 아니다)',
  form.nativeDate === false && form.dateBtn === expectLabel, `${form.dateBtn} / ${expectLabel}`);
check('종류는 주일 4부 젊은이 예배가 기본 — 이름 칸은 다른 예배를 고를 때만 나온다',
  form.kind.startsWith('주일 4부 젊은이 예배') && form.nameBox === false, `${form.kind} / 이름칸 ${form.nameBox}`);
check('데스크톱에서는 종류·날짜·만들기가 한 줄이다',
  form.rows === 1 && form.h <= 70, `${form.rows}줄 / ${form.h}px`);
check('기본값이 채워져 있어 한 번 눌러 만들 수 있다', form.canMake === true, String(form.canMake));

await ev(`document.querySelector('.worship-kind-pick').click()`);
await sleep(300);
const kinds = await ev(`[...document.querySelectorAll('.worship-kind-list button')].map(b => b.textContent.trim())`);
check('종류 피커에 주일 예배와 다른 예배 두 줄',
  JSON.stringify(kinds) === '["주일 4부 젊은이 예배","다른 예배…"]', JSON.stringify(kinds));
await ev(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
await sleep(250);

// 달력에서 다음 달 15일로 옮긴다 — 픽커가 실제로 값을 바꾸는지 보고,
// 뒤의 '발행해도 날짜 전이면 출석이 안 열린다'를 검사할 미래 날짜를 만든다
await ev(`document.querySelector('.worship-new-date button').click()`); await sleep(300);
const cal = await ev(`(() => ({ days: document.querySelectorAll('.worship-new-date .grid-cols-7 button').length }))()`);
check('날짜 픽커가 달력을 편다', cal.days > 28, `${cal.days}칸`);
// 패널이 **카드 밑으로 깔리지 않아야** 한다 — 카드마다 등장 애니메이션(transform)으로
// 쌓임 문맥이 생겨서 절대 위치 패널이 그 아래로 들어갔다(사용자 스크린샷 2026-09-03).
// 패널 rect 안의 점에서 실제로 무엇이 잡히는지를 본다.
const zOrder = await ev(`(() => {
  const panel = document.querySelector('.worship-new-date .absolute');
  if (!panel) return null;
  const r = panel.getBoundingClientRect();
  // 패널과 **겹치는** 카드를 찾아 그 겹친 영역의 가운데를 찍는다 — 패널 아래쪽 빈
  // 자리를 찍으면 z-순서와 무관하게 늘 패널이 잡혀서 검사가 아무것도 못 본다
  const card = [...document.querySelectorAll('.worship-card')].find(c => {
    const b = c.getBoundingClientRect();
    return r.bottom > b.top && r.top < b.bottom && r.right > b.left && r.left < b.right;
  });
  if (!card) return { overlapsCard: false };
  const b = card.getBoundingClientRect();
  const x = Math.round((Math.max(r.left, b.left) + Math.min(r.right, b.right)) / 2);
  const y = Math.round((Math.max(r.top, b.top) + Math.min(r.bottom, b.bottom)) / 2);
  const el = document.elementFromPoint(x, y);
  return { overlapsCard: true, inPanel: !!el && panel.contains(el),
    onCard: !!el && !!el.closest('.worship-card'), at: [x, y] };
})()`);
check('날짜 픽커 패널이 주보 카드 위로 뜬다',
  !!zOrder && zOrder.overlapsCard === true && zOrder.inPanel === true && zOrder.onCard === false,
  JSON.stringify(zOrder));
await ev(`document.querySelectorAll('.worship-new-date .absolute > div:first-child button')[1].click()`); await sleep(250);
await ev(`[...document.querySelectorAll('.worship-new-date .grid-cols-7 button')].find(b => b.textContent.trim() === '15').click()`);
await sleep(300);
const afterPick = await ev(`document.querySelector('.worship-new-date button').textContent.trim()`);
check('달력에서 고른 날짜가 그대로 들어간다', /\. 15\. \(/.test(afterPick), afterPick);

// 이벤트성 예배 — 종류 피커에서 '다른 예배…'를 고를 때만 이름 칸이 나온다
await ev(`document.querySelector('.worship-kind-pick').click()`); await sleep(250);
await ev(`[...document.querySelectorAll('.worship-kind-list button')].find(b => b.textContent.trim() === '다른 예배…').click()`);
await sleep(300);
const otherPick = await ev(`(() => ({
  box: !!document.querySelector('input[aria-label="예배 이름"]'),
  blocked: document.querySelector('.worship-new-make').disabled,
  kind: document.querySelector('.worship-kind-pick').textContent.trim(),
}))()`);
check('다른 예배를 고르면 이름 칸이 나오고, 이름을 적기 전에는 만들 수 없다',
  otherPick.box === true && otherPick.blocked === true && otherPick.kind.startsWith('다른 예배'),
  JSON.stringify(otherPick));
await ev(typeIn('input[aria-label="예배 이름"]', '성탄절 예배'));
await sleep(200);
await ev(`${byText('만들기')}.click()`); await sleep(1300);
const made = await ev(`(() => ({
  detail: !!document.querySelector('.worship-detail'),
  badge: !!document.querySelector('.worship-draft-badge'),
  toolbar: [...document.querySelectorAll('.worship-detail > div:first-child button')].map(b => b.textContent.trim()),
  titleBox: !!document.querySelector('input[aria-label="설교 제목"]'),
  kind: JSON.parse(localStorage.getItem('church_worship_v1')).services.filter(s => s.kind === '성탄절 예배').length,
  future: JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.kind === '성탄절 예배')?.service_date
    > new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
}))()`);
check('이벤트성 예배는 종류 이름을 자유로 적는다', made.kind === 1, String(made.kind));
check('고른 날짜(다음 달 15일)로 만들어진다', made.future === true, String(made.future));
check('만들면 목록이 아니라 그 주보의 수정 화면으로 바로 간다',
  made.detail === true && made.badge === true && made.titleBox === true, JSON.stringify(made));
// 편집 확정(저장·삭제)은 **머리줄 오른쪽**으로 갔고, 도구 줄에는 나가기만 남는다
// (모바일은 화면 아래 고정 줄 · 사용자 결정 2026-09-03)
check("편집 중 도구 줄에는 나가기만 남는다(자동 저장이라 '취소'가 없다)",
  JSON.stringify(made.toolbar) === '["목록으로"]', JSON.stringify(made.toolbar));
const editBar = await ev(`(() => {
  const head = document.querySelector('.worship-detail header');
  const save = document.querySelector('.worship-save');
  const chip = document.querySelector('.worship-detail header .worship-save-state');
  const del = [...document.querySelectorAll('.worship-detail header button')].find(b => b.textContent.trim() === '삭제');
  const bar = document.querySelector('.worship-edit-bar');
  return {
    saveInHead: !!save && !!head && head.contains(save),
    chipInHead: !!chip, delInHead: !!del,
    order: [...document.querySelectorAll('.worship-detail header button')].map(b => b.textContent.trim()),
    barHidden: !!bar && getComputedStyle(bar).display === 'none',
    barFixed: !!bar && getComputedStyle(bar).position === 'fixed',
    chips: document.querySelectorAll('.worship-detail .worship-save-state').length,
  };
})()`);
check('편집 중 저장·삭제·저장 상태 칩이 머리줄 오른쪽에 선다',
  editBar.saveInHead === true && editBar.chipInHead === true && editBar.delInHead === true
  && JSON.stringify(editBar.order) === '["저장","삭제"]', JSON.stringify(editBar));
check('데스크톱에서는 아래 고정 줄이 뜨지 않는다(모바일 것이다)',
  editBar.barHidden === true && editBar.barFixed === true && editBar.chips === 1, JSON.stringify(editBar));

// 삭제 확인은 두 줄이다 — 무엇이 사라지는지 먼저 말하고 신중하라고 덧붙인다
// (사용자 결정 2026-09-03)
await ev(`${byText('삭제')}.click()`); await sleep(400);
const askService = await ev(`document.body.innerText`);
check('주보 삭제 확인은 두 줄로 묻는다',
  askService.includes('이 주보를 삭제할까요?') && askService.includes('모든 내용이 같이 사라지니 신중하게 선택해주세요'),
  askService.includes('이 주보를 삭제할까요?') ? '두 번째 줄 없음' : '첫 줄 없음');
await ev(`(() => {
  const b = [...document.body.querySelectorAll('button')].filter(x => x.textContent.trim() === '취소');
  b[b.length - 1].click();
})()`);
await sleep(300);

// ── 6) 말씀 — 구절은 범위로 고르고, 저장은 저절로 ──────────────────────────
await ev(typeIn('input[aria-label="설교 제목"]', '다시 세우시는 손'));
await sleep(1700);
const autoSaved = await ev(`(() => {
  const el = document.querySelector('.worship-save-state');
  return {
    title: JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.kind === '성탄절 예배').title,
    state: el?.textContent.trim() || '',
    bg: el ? getComputedStyle(el).backgroundColor : '',
    green: ${tokenColor('--app-tag-green')},
  };
})()`);
check('편집 중에는 누르지 않아도 저장된다', autoSaved.title === '다시 세우시는 손', String(autoSaved.title));
check("저장 상태가 머리 쪽에 보인다 — 발행 전이면 '임시 저장되었어요'",
  autoSaved.state === '임시 저장되었어요', autoSaved.state);
check('저장 라벨은 연한 초록 칩이다', autoSaved.bg === autoSaved.green, `${autoSaved.bg} / ${autoSaved.green}`);

// 본문 선택은 전부 우리 부품이다 — 네이티브 select도, 글자로 적는 칸도 없다
check('본문 선택에 네이티브 select가 없다',
  (await ev(`!document.querySelector('input[aria-label="본문 구절"]')
    && document.querySelectorAll('.worship-passage-pick select').length === 0
    && !!document.querySelector('input[aria-label="본문 선택"]')`)) === true);

// 칸 이름이 붙어 있다 — 자리 글만 있으면 '흔들리지 않는 기쁨'이 무엇의 예시인지
// 알 수 없었다(사용자 지적 2026-09-02)
const fields = await ev(`(() => {
  const box = document.querySelector('.worship-word-edit');
  return {
    labels: [...box.querySelectorAll('.worship-field-label')].map(l => l.textContent.trim()),
    // 데스크톱은 두 칸 grid, 모바일은 한 칸(세로 스택)
    cols: getComputedStyle(box).gridTemplateColumns.split(' ').length,
  };
})()`);
check('말씀 편집 칸에 이름이 붙는다 — 설교 제목 · 설교자 · 본문 구절',
  JSON.stringify(fields.labels) === '["설교 제목","설교자","본문 구절"]', JSON.stringify(fields.labels));
check('데스크톱에서는 두 칸 grid로 선다', fields.cols === 2, `${fields.cols}칸`);

// 책 칸의 화살표는 눌리는 버튼이다 — 장·절 화살표는 눌리는데 이것만 장식이었다
// (사용자 지적 2026-09-02 "화살표가 동작하지 않는다"). el.click()으로는 재현되지
// 않는다 — onMouseDown으로 듣기 때문에 실제 마우스처럼 mousedown을 보낸다(§6-0).
await ev(`(() => {
  const a = document.querySelector('.worship-book-arrow');
  const r = a.getBoundingClientRect();
  for (const t of ['mousedown', 'mouseup', 'click']) a.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: r.x + 4, clientY: r.y + 4 }));
})()`);
await sleep(400);
const arrowOpen = await ev(`document.querySelectorAll('.worship-book-list button').length`);
check('책 칸의 화살표를 누르면 책 목록이 열린다', arrowOpen > 0, `${arrowOpen}권`);
await ev(clickAway); await sleep(250);

// 약칭으로도 걸린다 — '엡'은 에베소서의 약칭이고 이름에는 그 글자가 없다
await ev(typeBook('엡')); await sleep(400);
const abbrHit = await ev(`(() => ({
  n: document.querySelectorAll('.worship-book-list button').length,
  first: ${firstBook}?.textContent.trim() || '',
}))()`);
check('책 이름을 치면 자동완성이 뜨고 약칭도 걸린다',
  abbrHit.n === 1 && abbrHit.first === '에베소서', JSON.stringify(abbrHit));

await ev(typeBook('이사야')); await sleep(400);
await ev(`${firstBook}.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
await sleep(900);
await ev(openNum('시작 장')); await sleep(300);
await ev(pickNum(32)); await sleep(500);
await ev(openNum('시작 절')); await sleep(300);
await ev(pickNum(9)); await sleep(400);
await ev(openNum('끝 절')); await sleep(300);
await ev(pickNum(20)); await sleep(1700);
const picked = await ev(`(() => ({
  ref: JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.kind === '성탄절 예배').passage_ref,
  verses: document.querySelectorAll('.worship-verse').length,
  labels: [...document.querySelectorAll('.worship-num')].map(b => b.textContent.trim()),
}))()`);
check('고른 범위가 지금까지와 같은 구절 문자열로 저장된다', picked.ref === '이사야 32:9-20', String(picked.ref));
check('편집 중에도 고른 범위의 본문이 아래에 펼쳐진다', picked.verses === 12, `${picked.verses}절`);
check('고른 장·절이 칸에 그대로 선다',
  JSON.stringify(picked.labels) === '["32장","9절","32장","20절"]', JSON.stringify(picked.labels));

// 칸이 열 폭을 남기지 않는다 — 예전에는 폭 고정 칸들이 왼쪽 1/3에만 몰려 있었다
// (오른쪽에 남는 것은 '까지' 글자만큼이다)
const spread = await ev(`(() => {
  const box = document.querySelector('.worship-passage-pick');
  const b = box.getBoundingClientRect();
  const kids = [...box.children].map(k => k.getBoundingClientRect());
  return { w: Math.round(b.width), n: document.querySelectorAll('.worship-num').length, kids: kids.length,
    left: Math.round(Math.min(...kids.map(k => k.left)) - b.left),
    right: Math.round(b.right - Math.max(...kids.map(k => k.right))),
    rows: new Set(kids.map(k => Math.round(k.top))).size };
})()`);
check('본문 선택 칸이 열 폭을 채운다(데스크톱 한 줄 · 오른쪽에 빈 자리가 남지 않는다)',
  spread.n === 4 && spread.kids === 3 && spread.rows === 1 && spread.left <= 2 && spread.right <= 2,
  JSON.stringify(spread));

// 장·절 팝오버는 body 포털이라 어디에 있든 잘리지 않는다(§6-1)
await ev(openNum('끝 장')); await sleep(350);
await waitFor(`!!document.querySelector('.worship-num-pop')`, 4000);
const pop = await ev(`(() => {
  const p = document.querySelector('.worship-num-pop');
  if (!p) return { inBody: false, first: '', fits: false };
  const r = p.getBoundingClientRect();
  return {
    inBody: p.parentElement === document.body,
    first: p.querySelector('button').textContent.trim(),
    fits: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
  };
})()`);
check('끝은 시작보다 앞설 수 없다', pop.first === '32', `끝 장 첫 항목 ${pop.first}`);
check('장·절 팝오버는 body 포털이고 화면 안에 들어온다',
  pop.inBody === true && pop.fits === true, JSON.stringify(pop));
await ev(clickAway); await sleep(300);

// 처음 열 때 자리가 튀지 않는다 — 자리는 두 번 잡힌다(누를 때 추정 높이 · 그려진 뒤
// 실제 높이). 화면을 낮춰 그 둘이 갈리는 자리를 만들고, 열자마자 rAF 프레임마다 top을
// 본다. **보이는 프레임의 top은 전부 같아야** 한다(추정 자리가 한 프레임도 그려지면 안 된다).
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 420, deviceScaleFactor: 1, mobile: false });
await sleep(700);
const jump = await ev(`(async () => {
  window.scrollTo(0, 0);
  const btn = document.querySelector('button[aria-label="끝 절"]');
  const anchor = btn.getBoundingClientRect();
  btn.click();
  const frames = [];
  for (let i = 0; i < 8; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const p = document.querySelector('.worship-num-pop');
    if (!p) { frames.push(null); continue; }
    const cs = getComputedStyle(p);
    frames.push({ top: cs.top, vis: cs.visibility, h: p.offsetHeight });
  }
  const shown = frames.filter(f => f && f.vis !== 'hidden');
  return { tops: [...new Set(shown.map(f => f.top))], shown: shown.length,
    h: frames[frames.length - 1]?.h, gap: Math.round(innerHeight - anchor.bottom), est: 210 };
})()`, true);
check('피커는 처음 열릴 때도 제자리에서 나타난다(위에서 떨어지지 않는다)',
  jump.tops.length === 1 && jump.shown >= 5, JSON.stringify(jump));
check('추정 높이와 실제 높이가 실제로 갈리는 자리에서 쟀다',
  jump.h < 210 && jump.gap < 210 + 8, JSON.stringify(jump));
await ev(clickAway); await sleep(250);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);

await ev(typeIn('input[aria-label="설교자"]', '임성빈 전도사님')); await sleep(300);
const holders = await ev(`(() => ({
  preacher: document.querySelector('input[aria-label="설교자"]').placeholder,
  ok: !!document.querySelector('input[aria-label="설교 제목"]'),
}))()`);
check('설교자 자리 글은 임성빈 전도사님', holders.preacher.includes('임성빈 전도사님'), holders.preacher);

// ── 7) 담당자 — 이름 칸 하나로 명단 고르기와 자유 이름 ──────────────────────
await tabClick('담당자'); await sleep(250);
check("'명단에서 고르기' 별도 칸이 없다",
  (await ev(`!document.querySelector('select[aria-label="명단에서 고르기"]')`)) === true);

await ev(`${byText('담당자 추가')}.click()`); await sleep(300);
await ev(typeIn('input[aria-label="역할"]', '광고'));
await ev(typeIn('input[aria-label="이름"]', '조해'));
await sleep(400);
const sugg = await ev(`(() => ({
  n: document.querySelectorAll('.worship-person-list button').length,
  first: document.querySelector('.worship-person-list button')?.innerText.trim() || '',
  avatar: !!document.querySelector('.worship-person-list button span'),
}))()`);
check('이름을 치면 명단 자동완성이 뜬다(사진 원 + 이름)',
  sugg.n === 1 && sugg.first.includes('조해리') && sugg.avatar === true, JSON.stringify(sugg));
await ev(`document.querySelector('.worship-person-list button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
await sleep(1700);
const rolePicked = await ev(`JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.kind === '성탄절 예배').roles`);
check('목록에서 고르면 명단 사람이 연결된다',
  rolePicked.length === 1 && rolePicked[0].personId === 'p7' && rolePicked[0].name === '조해리' && rolePicked[0].role === '광고',
  JSON.stringify(rolePicked));

await ev(`${byText('담당자 추가')}.click()`); await sleep(300);
await ev(`(() => {
  const rows = document.querySelectorAll('.worship-role-edit');
  const last = rows[rows.length - 1];
  const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set(last.querySelector('input[aria-label="역할"]'), '특송');
  set(last.querySelector('input[aria-label="이름"]'), '한상록 강사님');
})()`);
await sleep(1700);
const freeName = await ev(`JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.kind === '성탄절 예배').roles`);
check('명단에 없는 이름은 글자 그대로 남는다',
  freeName.length === 2 && freeName[1].name === '한상록 강사님' && !freeName[1].personId, JSON.stringify(freeName));

// 방향키·Enter로도 고른다
await ev(`${byText('담당자 추가')}.click()`); await sleep(300);
await ev(`(() => {
  const rows = document.querySelectorAll('.worship-role-edit');
  const el = rows[rows.length - 1].querySelector('input[aria-label="이름"]');
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '김승');
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(400);
await ev(`(() => {
  const rows = document.querySelectorAll('.worship-role-edit');
  const el = rows[rows.length - 1].querySelector('input[aria-label="이름"]');
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(1700);
const byKey = await ev(`JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.kind === '성탄절 예배').roles`);
check('방향키·Enter로도 고를 수 있다',
  byKey.length === 3 && byKey[2].personId === 'p3' && byKey[2].name === '김승찬', JSON.stringify(byKey.slice(2)));

// 삭제 확인은 **무엇을 지우는지**를 말한다 — '이 담당자 줄을'이 아니라 '이 담당자를'
// (사용자 결정 2026-09-03). 조사는 이름에 맞춘다(담당자를 · 찬양을 · 광고를).
await ev(`document.querySelector('button[aria-label="담당자 삭제"]').click()`); await sleep(400);
const askRole = await ev(`document.body.innerText.includes('이 담당자를 삭제할까요?')`);
check("담당자 삭제 확인은 '이 담당자를 삭제할까요?'", askRole === true, String(askRole));
await ev(`(() => {
  const b = [...document.body.querySelectorAll('button')].filter(x => x.textContent.trim() === '취소');
  b[b.length - 1].click();
})()`);
await sleep(300);

// ── 7-b) 찬양 — 유튜브 재생목록에서 가져오기 ────────────────────────────────
// 게스트·로컬 vite에는 /api/yt가 없다. 그때 화면이 하는 일은 **토스트 한 줄**이고
// 콘솔에 오류를 남기지 않는다(고장이 아니라 환경이다 — worship.js의 quiet).
await tabClick('찬양'); await sleep(300);
const songImport = await ev(`(() => ({
  box: !!document.querySelector('input[aria-label="유튜브 재생목록 주소"]'),
  btn: document.querySelector('.worship-song-pull')?.textContent.trim() || '',
  blocked: document.querySelector('.worship-song-pull')?.disabled,
}))()`);
check('찬양 편집에 유튜브 재생목록 가져오기 칸이 있다(빈 칸이면 눌리지 않는다)',
  songImport.box === true && songImport.btn.includes('유튜브 재생목록에서 가져오기') && songImport.blocked === true,
  JSON.stringify(songImport));

await ev(typeIn('input[aria-label="유튜브 재생목록 주소"]', 'https://vimeo.com/playlist?list=PLnotyoutube1234'));
await sleep(250);
await ev(`document.querySelector('.worship-song-pull').click()`); await sleep(600);
const badUrl = await ev(`document.querySelector('[role="status"]')?.innerText.trim() || ''`);
// 실패 문구는 **무엇을 못 했는지 + 왜**가 같이 있어야 한다(사용자 지시 2026-09-03)
check('유튜브가 아닌 주소를 붙이면 무엇을 못 했는지와 이유를 같이 말한다',
  badUrl.includes('재생목록을 가져오지 못했어요') && badUrl.includes('유튜브 재생목록 링크가 아니에요'), badUrl);

await ev(typeIn('input[aria-label="유튜브 재생목록 주소"]', 'https://www.youtube.com/playlist?list=PLl2Yb-KJTF0Zq'));
await sleep(250);
await ev(`document.querySelector('.worship-song-pull').click()`); await sleep(900);
const noApi = await ev(`(() => ({
  toast: document.querySelector('[role="status"]')?.innerText.trim() || '',
  songs: (JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.kind === '성탄절 예배').songs || []).length,
}))()`);
check('가져올 수 없는 환경이면 그 이유를 말한다(게스트 모드)',
  noApi.toast.includes('재생목록을 가져오지 못했어요') && noApi.toast.includes('게스트 모드')
  && noApi.songs === 0, JSON.stringify(noApi));

// 받침이 있는 이름에는 '을'이 붙는다(errorText의 objectParticle 한 벌을 쓴다)
await ev(`${byText('찬양 추가')}.click()`); await sleep(350);
await ev(`document.querySelector('button[aria-label="찬양 삭제"]').click()`); await sleep(400);
const askSong = await ev(`document.body.innerText.includes('이 찬양을 삭제할까요?')`);
check("확인 문구의 조사는 이름에 맞춘다 — '이 찬양을 삭제할까요?'", askSong === true, String(askSong));
await ev(`(() => {
  const b = [...document.body.querySelectorAll('button')].filter(x => x.textContent.trim() === '삭제');
  b[b.length - 1].click();
})()`);
await sleep(700);
check('확인을 누르면 그 줄이 지워진다',
  (await ev(`document.querySelectorAll('.worship-song-row').length`)) === 0);

// 광고 자리 글
await tabClick('광고'); await sleep(250);
await ev(`${byText('광고 추가')}.click()`); await sleep(300);
const noticeHolders = await ev(`(() => ({
  title: document.querySelector('input[aria-label="광고 제목"]').placeholder,
  body: document.querySelector('textarea[aria-label="광고 내용"]').placeholder,
}))()`);
check('광고 자리 글은 겨울 수련회 · 1월 20일',
  noticeHolders.title.includes('겨울 수련회 신청') && noticeHolders.body.includes('1월 20일까지 순장에게 신청해주세요'),
  JSON.stringify(noticeHolders));

// ── 8) 저장 · 발행 ──────────────────────────────────────────────────────────
await ev(`${byText('저장')}.click()`); await sleep(1000);
const saved = await ev(`(() => {
  const row = JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.kind === '성탄절 예배');
  return { title: row.title, ref: row.passage_ref,
    editBtn: !!document.querySelector('.worship-edit-open'),
    toolbar: [...document.querySelectorAll('.worship-detail > div:first-child button')].map(b => b.textContent.trim()),
    shown: [...document.querySelectorAll('.worship-role-row')].map(x => x.innerText.replace(/\\n+/g, ' | ')) };
})()`);
check('저장하면 보기 모드로 돌아간다',
  JSON.stringify(saved.toolbar) === '["발행하기","목록으로"]' && saved.title === '다시 세우시는 손'
  && saved.editBtn === true, JSON.stringify([saved.toolbar, saved.editBtn]));

await tabClick('담당자'); await sleep(300);
const shownRoles = await ev(`[...document.querySelectorAll('.worship-role-row')].map(x => x.innerText.replace(/\\n+/g, ' | '))`);
check('저장한 담당자가 그대로 보인다',
  shownRoles.length === 3 && shownRoles[0].includes('조해리') && shownRoles[1].includes('한상록 강사님'), JSON.stringify(shownRoles));

await ev(`${byText('발행하기')}.click()`); await sleep(400);
await ev(`(() => {
  const btns = [...document.body.querySelectorAll('button')].filter(b => b.textContent.trim() === '발행하기');
  btns[btns.length - 1].click();
})()`);
await sleep(900);
const published = await ev(`(() => ({
  badge: !!document.querySelector('.worship-draft-badge'),
  toolbar: [...document.querySelectorAll('.worship-detail > div:first-child button')].map(b => b.textContent.trim()),
  att: !!document.querySelector('.worship-att-open'),
  status: JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.kind === '성탄절 예배').status,
}))()`);
check('발행하면 작성 중 배지가 사라지고 전체 공개가 된다',
  published.status === 'published' && published.badge === false && !published.toolbar.includes('발행하기'), JSON.stringify(published));
check('발행해도 예배 날짜 전이면 출석 진입이 없다', published.att === false, JSON.stringify(published));

// 발행된 주보를 고칠 때는 저장이 곧 공개본에 반영된다 — 거기에 '임시'라고 쓰면 거짓말이다
await ev(`${byText('수정')}.click()`); await sleep(500);
await tabClick('말씀'); await sleep(300);
// 글자가 실제로 달라져야 React가 onChange를 흘린다(같은 값이면 아무 일도 안 일어난다)
await ev(typeIn('input[aria-label="설교 제목"]', '다시 세우시는 손을 붙들고')); await sleep(1700);
const pubSave = await ev(`(() => {
  const el = document.querySelector('.worship-save-state');
  return { state: el?.textContent.trim() || '', bg: el ? getComputedStyle(el).backgroundColor : '',
    green: ${tokenColor('--app-tag-green')} };
})()`);
check("발행본을 고칠 때는 '임시'가 빠진다", pubSave.state === '저장되었어요', pubSave.state);
check('발행본 저장 라벨도 같은 초록 칩', pubSave.bg === pubSave.green, `${pubSave.bg} / ${pubSave.green}`);
await ev(`${byText('저장')}.click()`); await sleep(800);

// ── 9) 자격 없는 사람 · 순장 ────────────────────────────────────────────────
await ev(plant({ canEdit: false, canCheckAll: false, ledGroupIds: [], canCheck: false }));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1400);
await ev(GO); await sleep(1200);
const plain = await ev(`(() => ({
  cards: document.querySelectorAll('.worship-card').length,
  newBtn: !!document.querySelector('.worship-new-open'),
  drafts: !!document.querySelector('.worship-drafts-open'),
}))()`);
check('자격이 없으면 새 주보·작성 중 줄이 없다', plain.newBtn === false && plain.drafts === false, JSON.stringify(plain));
await ev(`document.querySelector('.worship-card').click()`); await sleep(1200);
const plainDetail = await ev(`(() => ({
  att: !!document.querySelector('.worship-att-open'),
  toolbar: [...document.querySelectorAll('.worship-detail > div:first-child button')].map(b => b.textContent.trim()),
  note: !!document.querySelector('.worship-note'),
}))()`);
check('자격이 없으면 출석 체크 진입 버튼 자체가 없다', plainDetail.att === false, JSON.stringify(plainDetail));
check('자격이 없어도 발행된 주보와 내 노트는 본다',
  JSON.stringify(plainDetail.toolbar) === '["목록으로"]' && plainDetail.note === true, JSON.stringify(plainDetail));

await ev(plant({ canEdit: false, canCheckAll: false, ledGroupIds: ['g1'], canCheck: true }));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1400);
await ev(GO); await sleep(1200);
await ev(`document.querySelector('.worship-card').click()`); await sleep(1200);
await waitFor(HAS_ATT); await ev(`document.querySelector('.worship-att-open').click()`); await sleep(700);
const sunjang = await ev(`(() => {
  const secs = [...document.querySelectorAll('.worship-attendance section')];
  return secs.slice(0, 3).map(s => [s.querySelector('.att-group-head')?.innerText.replace(/\\s+/g, ' ').replace(/ \\d+\\/\\d+$/, ''),
    [...s.querySelectorAll('.att-chip')].every(c => !c.disabled)]);
})()`);
check('순장은 자기 순만 누를 수 있고 다른 순은 보이되 비활성',
  JSON.stringify(sunjang) === '[["꼬순",true],["TT순",false],["순 미지정",false]]', JSON.stringify(sunjang));

// ── 10) 다크 모드 훑기 ──────────────────────────────────────────────────────
// 글자가 배경에 묻히지 않는지, 테마를 안 따라가는 팔레트를 쓰지 않는지만 본다
// (자세한 것은 tests/themefit.mjs 소관 — 여기는 예배 화면만).
const PROBE = `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c || '');
    if (!m) return null;
    const [r, g, b, a] = m[1].split(',').map(v => parseFloat(v));
    return { r, g, b, a: a === undefined ? 1 : a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };
  const BANNED = {
    'rgb(239, 68, 68)': 'red-500', 'rgb(220, 38, 38)': 'red-600',
    'rgb(34, 197, 94)': 'green-500', 'rgb(22, 163, 74)': 'green-600',
    'rgb(59, 130, 246)': 'blue-500', 'rgb(37, 99, 235)': 'blue-600',
    'rgb(234, 179, 8)': 'yellow-500', 'rgb(249, 115, 22)': 'orange-500',
  };
  const low = [], banned = [];
  for (const el of document.querySelectorAll('main *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.15) continue;
    for (const [prop, key] of [[cs.color, 'color'], [cs.backgroundColor, 'bg'], [cs.borderTopColor, 'border']]) {
      const hit = BANNED[prop];
      if (hit && !(key === 'border' && cs.borderTopWidth === '0px')) banned.push(hit + '/' + key);
    }
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.4) continue;
    const cr = ratio(fg, bgOf(el));
    if (cr < 2.0) low.push((el.textContent || '').trim().slice(0, 20) + ' ' + Math.round(cr * 100) / 100);
  }
  return { low: low.slice(0, 5), lowCount: low.length, banned: banned.slice(0, 5), bannedCount: banned.length,
    x: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth) };
})()`;

await ev(plant(null));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
await ev(`document.documentElement.setAttribute('data-theme', 'dark')`);
await sleep(1400);
await ev(GO); await waitFor(HAS_CARD); await sleep(400);
const darkList = await ev(PROBE);
check('다크 — 목록에서 글자가 배경에 묻히지 않는다', darkList.lowCount === 0, JSON.stringify(darkList.low));
check('다크 — 목록이 테마를 안 따르는 팔레트를 쓰지 않는다', darkList.bannedCount === 0, JSON.stringify(darkList.banned));
await ev(`document.querySelector('.worship-card').click()`); await waitFor(HAS_DETAIL); await sleep(500);
const darkDetail = await ev(PROBE);
check('다크 — 주보 본문이 읽힌다', darkDetail.lowCount === 0, JSON.stringify(darkDetail.low));
check('다크 — 가로로 넘치지 않는다', darkDetail.x === 0, `${darkDetail.x}px`);
await waitFor(HAS_EDIT);
await ev(`${byText('수정')}.click()`); await sleep(1200);
const darkEdit = await ev(PROBE);
check('다크 — 편집 화면(본문 선택 · 담당자 칸)도 읽힌다',
  darkEdit.lowCount === 0 && darkEdit.bannedCount === 0, JSON.stringify([darkEdit.low, darkEdit.banned]));

// 네이티브 select를 걷어낸 이유가 이것이다 — 팝오버는 테마를 따라간다
await ev(openNum('시작 장')); await sleep(400);
await waitFor(`!!document.querySelector('.worship-num-pop')`, 4000);
const darkPop = await ev(`(() => {
  const p = document.querySelector('.worship-num-pop');
  if (!p) return { bg: 'none', surface: 'x' };
  return { bg: getComputedStyle(p).backgroundColor, surface: ${tokenColor('--app-surface')} };
})()`);
check('다크 — 장·절 팝오버도 앱 표면색을 따른다', darkPop.bg === darkPop.surface, JSON.stringify(darkPop));
await ev(clickAway); await sleep(250);

await ev(`${byText('저장')}.click()`); await sleep(900);
await ev(`document.documentElement.setAttribute('data-theme', 'light')`); await sleep(300);

// ── 11) 모바일 375px ────────────────────────────────────────────────────────
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await sleep(800);
const mobDetail = await ev(`(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  att: !!document.querySelector('.worship-att-open'),
  verses: document.querySelectorAll('.worship-verse').length,
}))()`);
check('모바일 375px — 주보 상세가 가로로 넘치지 않는다', mobDetail.overflow <= 0, `넘침 ${mobDetail.overflow}px`);
check('모바일에서도 머리줄 출석 체크와 본문이 그대로 선다',
  mobDetail.att === true && mobDetail.verses === 12, JSON.stringify(mobDetail));

await ev(`${byText('수정')}.click()`); await sleep(900);
const mobEdit = await ev(`(() => {
  const pick = document.querySelector('.worship-passage-pick');
  const kids = [...pick.children].map(k => k.getBoundingClientRect());
  const box = pick.getBoundingClientRect();
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    selects: document.querySelectorAll('.worship-passage-pick select').length,
    nums: document.querySelectorAll('.worship-num').length,
    book: !!document.querySelector('input[aria-label="본문 선택"]'),
    rows: new Set(kids.map(k => Math.round(k.top))).size,
    narrowest: Math.round(Math.min(...kids.map(k => k.width))), w: Math.round(box.width),
    cols: getComputedStyle(document.querySelector('.worship-word-edit')).gridTemplateColumns.split(' ').length,
  };
})()`);
check('모바일 375px — 본문 선택이 가로로 넘치지 않는다',
  mobEdit.overflow <= 0 && mobEdit.selects === 0 && mobEdit.nums === 4 && mobEdit.book === true,
  JSON.stringify(mobEdit));
check('모바일 375px — 말씀 칸은 한 칸으로 쌓이고 본문 선택도 줄마다 폭을 다 쓴다',
  mobEdit.cols === 1 && mobEdit.rows === 3 && mobEdit.narrowest >= mobEdit.w - 1,
  JSON.stringify(mobEdit));

// 좁은 화면에서도 팝오버가 잘리지 않아야 한다 — 이게 body 포털을 쓰는 이유다
await ev(openNum('끝 절')); await sleep(400);
await waitFor(`!!document.querySelector('.worship-num-pop')`, 4000);
const mobPop = await ev(`(() => {
  const p = document.querySelector('.worship-num-pop');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
    bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight };
})()`);
check('모바일 375px — 장·절 팝오버가 화면 밖으로 잘리지 않는다',
  !!mobPop && mobPop.left >= 0 && mobPop.right <= mobPop.vw && mobPop.top >= 0 && mobPop.bottom <= mobPop.vh,
  JSON.stringify(mobPop));
await ev(clickAway); await sleep(250);
await ev(`${byText('목록으로')}.click()`); await sleep(800);
const mobList = await ev(`(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  cards: document.querySelectorAll('.worship-card').length,
}))()`);
check('모바일 375px — 목록도 한 줄로 선다', mobList.overflow <= 0 && mobList.cards === 2, JSON.stringify(mobList));

// 새 주보 생성기 — 데스크톱은 한 줄, 모바일은 두 줄까지다(사용자 결정 2026-09-02)
await ev(`document.querySelector('.worship-new-open').click()`); await sleep(500);
const mobNew = await ev(`(() => {
  const box = document.querySelector('.worship-new');
  const ctl = [box.querySelector('.worship-kind-pick'), box.querySelector('.worship-new-date button'), box.querySelector('.worship-new-make')];
  return { rows: new Set(ctl.map(e => Math.round(e.getBoundingClientRect().top))).size,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`);
check('모바일 375px — 새 주보 생성기는 두 줄까지', mobNew.rows <= 2 && mobNew.overflow <= 0, JSON.stringify(mobNew));
await ev(`${byText('취소')}.click()`); await sleep(300);

await ev(`document.querySelector('.worship-card').click()`); await sleep(1200);
await waitFor(HAS_ATT); await ev(`document.querySelector('.worship-att-open').click()`); await sleep(800);
const mob = await ev(`(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  chips: document.querySelectorAll('.att-chip').length,
}))()`);
check('모바일 375px에서 출석 화면이 가로로 넘치지 않는다', mob.overflow <= 0, `넘침 ${mob.overflow}px`);
check('모바일에서도 사람 칩이 그대로 선다', mob.chips === 8, String(mob.chips));
await send('Emulation.clearDeviceMetricsOverride');

// ── 주보의 본문 구절 → 성경 읽기 (App.jsx openBible → WordView initialRef) ───────
await ev(`${byText('주보로')}.click()`); await sleep(700);
const bibleLink = await ev(`document.querySelector('.worship-open-bible')?.textContent || ''`);
await ev(`document.querySelector('.worship-open-bible')?.click()`); await sleep(1500);
const biblePlace = await ev(`(document.querySelector('.bible-place')?.textContent || '').replace(/\\s+/g, ' ').trim()`);
check('주보의 본문 구절을 누르면 성경 읽기의 그 장이 열린다', bibleLink === '이사야 32:9-20' && biblePlace === '이사야 32장', `${bibleLink} → ${biblePlace}`);


// ── 12) 발행본이 하나도 없는 목록 · 캐릭터는 어디에도 없다 ─────────────────
// 캐릭터 컷을 잠깐 얹었다가 전부 걷어냈다(사용자 결정 2026-09-03: "홈 제외하고는
// 캐릭터 넣지 말라"). 그래서 이 화면 어디에도 /chars/ 그림이 없어야 한다.
const rePlant = (o) => `(() => {
  const g = JSON.parse(localStorage.getItem('church_worship_v1')) || {};
  Object.assign(g, ${JSON.stringify(o)});
  localStorage.setItem('church_worship_v1', JSON.stringify(g));
})()`;
// 다시 들어오는 길은 **업무 대시보드**를 거친다 — 홈은 지금 다른 회차에서 고치는
// 중이고, 그 화면이 콘솔에 오류를 내면 우리 '콘솔 오류 0'이 같이 무너진다.
const reopen = async () => { await ev(`${byText('업무 대시보드')}.click()`); await sleep(700); await ev(GO); await sleep(900); };
const CHARS = `document.querySelectorAll('main img[src*="/chars/"]').length`;

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await ev(rePlant({ services: [{ id: 'd1', kind: 'sunday', service_date: SOON, status: 'draft',
  title: '', passage_ref: '', preacher: '', roles: [], songs: [], notices: [] }] }));
await reopen();
const noneYet = await ev(EMPTY);
check('발행된 주보가 하나도 없으면 마크와 함께 그렇게 말한다',
  noneYet?.text === '발행된 주보가 아직 없어요' && centered(noneYet) && fills(noneYet),
  JSON.stringify(noneYet));
check('목록에 캐릭터 그림이 없다', (await ev(CHARS)) === 0 && noneYet?.chars === 0, String(noneYet?.chars));

// 상세·출석까지 훑어도 캐릭터는 없다(출석 화면에 잠깐 얹었던 두 컷도 걷어냈다)
await ev(rePlant({
  services: [{ id: 'c1', kind: 'sunday', service_date: PAST1, status: 'published', title: '함께 드리는 예배',
    passage_ref: '', preacher: '', roles: [], songs: [], notices: [], attendance_note: '' }],
  people: [{ id: 'q1', name: '김윤주', profile_id: null }, { id: 'q2', name: '천진영', profile_id: null }],
  groups: [{ id: 'gq', type: 'sun', name: '꼬순', year: Y, leader_person_id: 'q1' }],
  group_members: [{ group_id: 'gq', person_id: 'q2' }],
  attendance: [{ service_id: 'c1', person_id: 'q1' }, { service_id: 'c1', person_id: 'q2' }],
}));
await reopen();
await waitFor(HAS_CARD);
await ev(`document.querySelector('.worship-card').click()`); await waitFor(HAS_DETAIL); await sleep(400);
const detailChars = await ev(CHARS);
await waitFor(HAS_ATT); await ev(`document.querySelector('.worship-att-open').click()`); await sleep(800);
const attChars = await ev(`(() => ({ chars: ${CHARS}, cut: document.querySelectorAll('.att-cut').length,
  total: document.querySelector('.att-total')?.innerText.replace(/\\s+/g, ' ') || '' }))()`);
check('주보 상세·출석 화면에도 캐릭터 그림이 없다',
  detailChars === 0 && attChars.chars === 0 && attChars.cut === 0, JSON.stringify([detailChars, attChars]));
check('다 불러도(전체 2/2) 그림 하나 늘지 않는다', attChars.total === '전체 2/2', attChars.total);

// ── 13) 두 번째 진입은 캐시부터 그린다 ─────────────────────────────────────
// "매번 스켈레톤이 아니라 캐시된 값이 먼저 보이게"(사용자 요청 2026-09-03).
// 게스트에서는 캐시가 메모리에만 있으므로(services/cache.js) 새로고침 없이 화면을
// 오갈 때 그 효과가 보인다 — 첫 진입에서 캐시를 채우고, 홈으로 나갔다 다시 들어온다.
await ev(plant(null));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1400);
await ev(GO); await waitFor(HAS_CARD);
await ev(`document.querySelector('.worship-card').click()`); await waitFor(HAS_DETAIL);
await waitFor(HAS_ATT); await ev(`document.querySelector('.worship-att-open').click()`); await sleep(800);
await ev(`${byText('주보로')}.click()`); await sleep(500);
await ev(`${byText('목록으로')}.click()`); await sleep(500);
await ev(`${byText('업무 대시보드')}.click()`); await sleep(900);

const frames = await ev(`(async () => {
  ${byText('예배')}.click();
  const out = [];
  for (let i = 0; i < 10; i++) {
    await new Promise(r => requestAnimationFrame(r));
    out.push([document.querySelectorAll('.worship-loading').length, document.querySelectorAll('.worship-card').length]);
  }
  return out;
})()`, true);
check('두 번째 진입은 스켈레톤 없이 캐시된 목록을 바로 그린다',
  frames.every(f => f[0] === 0) && frames.slice(0, 3).some(f => f[1] === 2),
  JSON.stringify(frames.slice(0, 4)));

// 지난번에 열어 본 주보는 명단·출석도 캐시에서 먼저 온다(빈 목록이 한 번 스치지 않게)
const attFrames = await ev(`(async () => {
  document.querySelector('.worship-card').click();
  let btn = null;
  for (let i = 0; i < 60 && !btn; i++) { await new Promise(r => requestAnimationFrame(r)); btn = document.querySelector('.worship-att-open'); }
  if (!btn) return null;
  btn.click();
  const out = [];
  for (let i = 0; i < 6; i++) {
    await new Promise(r => requestAnimationFrame(r));
    out.push([document.querySelectorAll('.att-chip').length,
      (document.querySelector('.att-total')?.innerText || '').replace(/\s+/g, ' ')]);
  }
  return out;
})()`, true);
check('지난번에 열어 본 주보는 명단·출석을 캐시에서 먼저 그린다',
  Array.isArray(attFrames) && attFrames.every(f => f[0] === 8) && attFrames[0][1] === '전체 1/8',
  JSON.stringify(attFrames && attFrames.slice(0, 3)));

// ── 14) 편집 탭 반응형 · 썸네일 · 모바일 고정 도구 줄 ──────────────────────
// 편집 화면을 다섯 폭에서 훑는다(사용자 요청 2026-09-03). 재는 것은 세 가지다:
// 가로 넘침 0 · 칸이 화면 밖으로 나가지 않음 · 칸이 짜부라지지 않음(60px 미만 금지).
await ev(plant(null));
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1400);
await ev(GO); await waitFor(HAS_CARD);
await ev(`document.querySelector('.worship-card').click()`); await waitFor(HAS_DETAIL);
await waitFor(HAS_EDIT);
await ev(`document.querySelector('.worship-edit-open').click()`); await sleep(900);

const RESP = `(() => {
  const panel = document.querySelector('.worship-tabpanel');
  if (!panel) return null;
  const els = [...panel.querySelectorAll('input, textarea, button.worship-num, .worship-song-linkbox')]
    .filter(e => e.getBoundingClientRect().width > 0);
  const w = (e) => Math.round(e.getBoundingClientRect().width);
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    n: els.length,
    narrow: els.length ? Math.min(...els.map(w)) : 0,
    outside: els.filter(e => e.getBoundingClientRect().right > innerWidth - 2).length,
  };
})()`;

const respRows = [];
for (const width of [375, 414, 768, 1024, 1440]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await sleep(450);
  for (const tab of ['말씀', '담당자', '찬양', '광고']) {
    await tabClick(tab); await sleep(320);
    const r = await ev(RESP);
    respRows.push([width, tab, r && r.overflow, r && r.narrow, r && r.outside, r && r.n]);
  }
}
const respBad = respRows.filter(r => !(r[2] <= 0 && r[3] >= 60 && r[4] === 0 && r[5] > 0));
check('편집 탭 네 개가 375·414·768·1024·1440에서 넘치지 않고 칸이 짜부라지지 않는다',
  respBad.length === 0, JSON.stringify(respBad.length ? respBad : respRows.filter(r => r[0] === 375)));

// 모바일에서는 저장·삭제가 **화면 아래 고정 줄**에 있고 하단 탭바 위에 앉는다
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await sleep(600);
const mobBar = await ev(`(() => {
  const bar = document.querySelector('.worship-edit-bar');
  if (!bar) return null;
  const cs = getComputedStyle(bar);
  const r = bar.getBoundingClientRect();
  return {
    shown: cs.display !== 'none', fixed: cs.position === 'fixed',
    buttons: [...bar.querySelectorAll('button')].map(b => b.textContent.trim()),
    bottomGap: Math.round(innerHeight - r.bottom),
    full: Math.round(r.width) === innerWidth,
    headSave: !!document.querySelector('.worship-save') && getComputedStyle(document.querySelector('.worship-save')).display === 'none',
  };
})()`);
check('모바일에서는 저장·삭제가 화면 아래 고정 줄에 있다',
  !!mobBar && mobBar.shown === true && mobBar.fixed === true && mobBar.full === true
  && JSON.stringify(mobBar.buttons) === '["저장","삭제"]', JSON.stringify(mobBar));
check('고정 줄은 하단 탭바 위에 앉고, 머리줄 버튼은 모바일에서 숨는다',
  !!mobBar && mobBar.bottomGap >= 60 && mobBar.headSave === true, JSON.stringify(mobBar));

// ── 찬양 썸네일 — 키 없이 뜨는 공개 주소(i.ytimg.com) ─────────────────────
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);
await tabClick('찬양'); await sleep(400);
const editThumb = await ev(`(() => {
  const rows = [...document.querySelectorAll('.worship-song-row')];
  return rows.map(r => {
    const img = r.querySelector('img.worship-song-thumb');
    return img ? [img.getAttribute('src'), img.getAttribute('loading'), Math.round(img.getBoundingClientRect().width)]
      : [!!r.querySelector('.worship-song-thumb-fallback') ? 'fallback' : null];
  });
})()`);
check('편집 줄에도 작은 썸네일이 붙고, 링크가 없으면 음표로 떨어진다',
  editThumb.length === 2 && editThumb[0][0] === 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg'
  && editThumb[0][1] === 'lazy' && editThumb[1][0] === 'fallback', JSON.stringify(editThumb));

await ev(`${byText('저장')}.click()`); await sleep(1000);
await tabClick('찬양'); await sleep(400);
const viewThumb = await ev(`(() => {
  const rows = [...document.querySelectorAll('.worship-song-view')];
  const img = rows[0]?.querySelector('img.worship-song-thumb');
  const a = rows[0]?.querySelector('a.worship-song-link');
  return {
    src: img?.getAttribute('src') || null, lazy: img?.getAttribute('loading') || null,
    size: img ? [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)] : null,
    href: a?.getAttribute('href') || null, target: a?.getAttribute('target') || null,
    fallback: !!rows[1]?.querySelector('.worship-song-thumb-fallback'),
  };
})()`);
check('보기 목록의 곡 줄에 64x36 썸네일이 붙는다',
  viewThumb.src === 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' && viewThumb.lazy === 'lazy'
  && JSON.stringify(viewThumb.size) === '[64,36]', JSON.stringify(viewThumb));
check('제목을 누르면 그 유튜브 영상이 새 탭으로 열린다',
  viewThumb.href === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' && viewThumb.target === '_blank',
  JSON.stringify([viewThumb.href, viewThumb.target]));
check('링크 없는 곡은 썸네일 자리에 음표가 앉는다', viewThumb.fallback === true, String(viewThumb.fallback));
await send('Emulation.clearDeviceMetricsOverride');

// 예배 노트와 말씀 묵상은 **같은 부품**을 쓴다(사용자 재강조 2026-09-03).
// 지역 사본을 다시 만들면 두 화면이 조용히 갈라지므로 소스로 못 박는다.
const sameParts = await ev(`(async () => {
  const one = async (u) => (await fetch(u)).text();
  const [wor, word] = await Promise.all([one('/src/components/worshipDetail.jsx'), one('/src/views/wordView.jsx')]);
  const has = (t) => t.includes('/src/components/ShareToggle.jsx');
  const local = (t) => /function ShareToggle\\s*\\(/.test(t);
  return { worImports: has(wor), wordImports: has(word), worLocal: local(wor), wordLocal: local(word) };
})()`, true);
check('예배 노트와 말씀 묵상이 같은 공유 부품을 import한다',
  sameParts.worImports === true && sameParts.wordImports === true, JSON.stringify(sameParts));
check('어느 화면에도 지역 사본이 남아 있지 않다',
  sameParts.worLocal === false && sameParts.wordLocal === false, JSON.stringify(sameParts));

check('콘솔 오류 0', logs.length === 0, logs.slice(0, 3).join(' / '));

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
