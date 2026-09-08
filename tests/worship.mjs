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
import { mkdtempSync, readFileSync } from 'node:fs';
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

// 출석 메모 한 벌의 상태 — 읽기/편집 어느 모드인지, 도구 줄에 무엇이 어떤 순서로
// 서는지, 그리고 **실제로 주보 행에 남았는지**까지 한 번에 본다.
// `right`는 취소가 그 줄의 오른쪽 끝에 붙어 있는지다(§8 · 0이면 딱 붙어 있다).
const NOTE_STATE = `(() => ({
  read: !!document.querySelector('.att-note-read'),
  readText: document.querySelector('.att-note-read')?.textContent.trim() || '',
  box: !!document.querySelector('.att-note-box'),
  saveOff: document.querySelector('.att-note-save')?.disabled ?? null,
  cancel: !!document.querySelector('.att-note-cancel'),
  order: [...document.querySelectorAll('.att-note-tools button')].map(b => b.textContent.trim()),
  right: (() => {
    const c = document.querySelector('.att-note-cancel'); const t = document.querySelector('.att-note-tools');
    return c && t ? Math.round(t.getBoundingClientRect().right - c.getBoundingClientRect().right) : null;
  })(),
  state: document.querySelector('.worship-attendance .worship-save-state')?.textContent.trim() || '',
  stored: JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.id === 's1').attendance_note,
}))()`;

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
    // 호칭 세 갈래를 화면에서 다 볼 수 있게 심는다(사용자 결정 2026-09-06):
    // 교역자(is_pastor) '전도사님' · 그 해 부장(people_roles) '부장님' · 나머지 '청년'.
    { id: 'p8', name: '양민혁', profile_id: null, is_pastor: true },
  ],
  // 부장은 명단 속성이 아니라 **그 해 직분 줄**이다(0043) — worship.fetchRoster가 읽는다
  people_roles: [{ person_id: 'p7', year: Y, role: 'director' }],
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
      roles: [{ role: '대표기도', personId: 'p1', name: '김윤주' },
        { role: '말씀', personId: 'p8', name: '양민혁' },
        { role: '헌금봉헌', personId: null, name: '한상록 강사님' }],
      songs: [{ title: '주 은혜임을', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, { title: '나의 반석이신 하나님' }],
      praise_leader: '조해리', praise_playlist_url: 'https://www.youtube.com/playlist?list=PLl2Yb-KJTF0Zq',
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
  // 주보에 붙는 파일(0047) — files 표를 업무 첨부와 같이 쓴다. 게스트에는 드라이브가 없어
  // 행만 남고 바이트는 메모리에 있다(services/worship.js의 guestBytes).
  // **f1에는 일부러 kind가 없다** — 0054 이전에 심긴 행(옛 주보·게스트 시드)이 그 모양이고,
  // 화면이 그것을 송폼으로 읽어야 한다. f2는 큐시트 갈래라 말씀 탭에만 선다.
  files: [
    { id: 'f1', service_id: 's1', name: '2026-09-06 송폼.pdf', size_bytes: 1048576, mime_type: 'application/pdf', source: 'local' },
    { id: 'f2', service_id: 's1', kind: 'cuesheet', name: '9월 6일 큐시트.pdf', size_bytes: 524288, mime_type: 'application/pdf', source: 'local' },
  ],
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
// 상세 화면의 빈 탭은 아래에 '내 예배 노트'(서식 바 + 편집기)가 실제로 자리를 차지한다.
// **문턱을 0.35에서 0.2로 낮췄다**(2026-09-08) — 노트가 빈 칸이 아니라 템플릿(도막
// 다섯 · services/noteTemplate.js)으로 시작하면서 그 칸이 200px 남짓 길어졌고,
// 1440x900에서 갓 만든 주보는 둘이 함께 이상적인 높이를 가질 수 없다. 빈 자리는
// 여전히 마크와 함께 상자 한가운데에 서고 바닥값(FILL_MIN 200px)은 지킨다.
const centered = (e) => !!e && e.mark === true && e.h >= e.vh * 0.2 && Math.abs(e.dy) <= 2 && Math.abs(e.dx) <= 2;
// 남는 공간을 차지했나 — 화면이 스크롤 박스 바닥까지 닿고(빈 자리가 아래에 남지 않고),
// 그렇다고 넘쳐서 스크롤이 생기지도 않아야 한다(감싸개의 pb까지 세야 딱 맞는다).
// **바닥값에 닿았을 때는 예외다**(2026-09-08) — 남는 자리가 FILL_MIN(200px)보다 작으면
// 빈 상태를 더 찌그러뜨리지 않고 그만큼 스크롤이 생기는 것이 설계다(worshipDetail의
// FILL_MIN 주석). 그때도 **아래로 빈 자리가 남는 것**은 여전히 실패다.
const fills = (e) => {
  if (!e) return false;
  if (e.h <= 201) return e.fill <= 0;
  return e.fill >= 0 && e.fill <= 4 && e.scroll <= 0;
};

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
  // 출석은 이제 **날짜가 아니라 시각**으로 열린다(그날 13:30 KST · ATTEND_OPEN_HM)
  const att = (status, date, now = '2026-09-01 14:00:00') => m.attendanceOpen({ status, service_date: date }, now);
  return {
    sunOnSat: m.nextSundayDate(new Date(2026, 8, 5)),     // 토 → 다음날
    sunOnSun: m.nextSundayDate(new Date(2026, 8, 6)),     // 주일 당일은 그날
    date: m.formatServiceDate('2026-09-06'),
    dateOtherYear: m.formatServiceDate('2025-12-25'),
    label: [m.kindLabel('sunday'), m.kindLabel('금요 열정 예배')],
    plain: perms({}),
    president: perms({ myRoles: ['president'] }),
    pastor: perms({ myPerson: { is_pastor: true } }),
    treasurer: perms({ myRoles: ['treasurer'] }),
    master: perms({ isMaster: true }),
    admin: perms({ isAdmin: true }),
    media: perms({ myPerson: { teams: ['미디어팀'] } }),
    otherTeam: perms({ myPerson: { teams: ['찬양팀'] } }),
    sunjang: perms({ ledGroupIds: ['g1'] }),
    leadSunjang: perms({ myRoles: ['lead_sunjang'] }),
    attPast: att('published', '2026-08-30'),
    attToday: att('published', '2026-09-01'),
    attBefore: att('published', '2026-09-01', '2026-09-01 09:00:00'),   // 예배 전(13:30 전)
    attSharp: att('published', '2026-09-01', '2026-09-01 13:30:00'),    // 정각이면 열린다
    attFuture: att('published', '2026-09-06'),
    attDraft: att('draft', '2026-08-30'),
    openHm: m.ATTEND_OPEN_HM,
    // 화면 진입은 '발행되었는가'까지만 본다 — 예배 전에도 명단을 미리 훑는다
    visPub: m.attendanceVisible({ status: 'published', service_date: '2026-09-06' }),
    visDraft: m.attendanceVisible({ status: 'draft', service_date: '2026-08-30' }),
    playlistUrl: m.youtubePlaylistUrl('PLl2Yb-KJTF0Zq'),
    kstShape: /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(m.kstNow()),
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
    // 찬양팀 이름은 고정값이라 DB가 아니라 코드 상수다(0044 · 사용자 결정 2026-09-05)
    praiseTeam: m.PRAISE_TEAM,
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
    // 교역자·부장 묶음(2026-09-07). 부장은 **그 해 직분 줄**이고 교역자는 명단 속성이다.
    // 순에 편성된 부장(다솔)은 순에도 그대로 서고, 어느 순에도 없는 두 사람은
    // '순 미지정'이 아니라 자기 묶음에 선다.
    headed: m.groupRoster({
      people: [{ id: 'a', name: '한결' }, { id: 'b', name: '나리' },
        { id: 'p', name: '임성빈', is_pastor: true },
        { id: 'd', name: '신효진' }, { id: 'e', name: '다솔' }, { id: 'f', name: '정후' }],
      groups: [{ id: 'g1', name: '꼬순', leader_person_id: 'a' }],
      members: [{ group_id: 'g1', person_id: 'b' }, { group_id: 'g1', person_id: 'e' }],
      roles: [{ person_id: 'd', role: 'director' }, { person_id: 'e', role: 'director' }],
    }).map(g => [g.id === null ? 'null' : g.id, g.name, g.people.map(p => p.name).join(',')]),
    // 그 묶음들은 **전체 자격자만** 만진다 — 순장에게는 자기 순뿐이다
    toggleHead: [m.canToggleGroup({ canCheckAll: false, ledGroupIds: ['pastor', 'director'] }, 'pastor'),
      m.canToggleGroup({ canCheckAll: false, ledGroupIds: ['pastor'] }, 'director'),
      m.canToggleGroup({ canCheckAll: true }, 'pastor')],
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
// **2026-09-05 규칙**: 주보 = 관리자·교역자·회장·미디어팀 / 전체 출석 = 관리자·교역자·리더순장.
// 회장은 주보를 쓰지만 남의 순 출석까지 만지지는 않는다(자기 순 순장이면 그 순만).
check('회장은 주보 작성 · 전체 출석은 아니다', JSON.stringify(pure.president) === '[true,false,false]', JSON.stringify(pure.president));
// 0042에서 빠졌던 교역자가 **주보로 돌아왔다**(사용자 결정 2026-09-05)
check('교역자는 주보도 쓰고 전체 출석도 한다',
  JSON.stringify(pure.pastor) === '[true,true,true]', JSON.stringify(pure.pastor));
check('미디어팀은 주보를 쓴다(명단 teams 갈래)',
  pure.media[0] === true && pure.otherTeam[0] === false,
  JSON.stringify([pure.media, pure.otherTeam]));
check('관리자는 주보 작성 + 전체 출석', JSON.stringify(pure.admin) === '[true,true,true]', JSON.stringify(pure.admin));
// 0043이 임원을 다섯으로 갈랐고, 2026-09-05에 **전체 출석이 리더순장 하나로 좁혀졌다**
// (예전에는 '그 해 직분 줄이 있으면 누구나'라 총무·부장·리더팀장까지 전원을 만졌다).
check('총무 같은 다른 직분은 주보도 전체 출석도 아니다', JSON.stringify(pure.treasurer) === '[false,false,false]', JSON.stringify(pure.treasurer));
check('리더순장만 전체 출석(주보 작성은 아니다)', JSON.stringify(pure.leadSunjang) === '[false,true,true]', JSON.stringify(pure.leadSunjang));
check('마스터는 주보 작성 + 전체 출석', JSON.stringify(pure.master) === '[true,true,true]', JSON.stringify(pure.master));
check('순장은 출석만, 그것도 전체는 아니다', JSON.stringify(pure.sunjang) === '[false,false,true]', JSON.stringify(pure.sunjang));
check('순장은 자기 순만 만진다', pure.toggleMine === true && pure.toggleOther === false, `${pure.toggleMine}/${pure.toggleOther}`);
check("'순 미지정'은 전체 자격자만 만진다", pure.toggleUnassigned === false);
check('순장은 편성 명단에 없어도 자기 순에 선다', pure.buckets[0][1].startsWith('한결'), JSON.stringify(pure.buckets));
check('순 안 순서는 순장 먼저, 나머지는 가나다순', pure.buckets[0][1] === '한결,가온,나리', JSON.stringify(pure.buckets));
check("어느 순에도 없는 사람은 '순 미지정'으로, 거기도 가나다순",
  JSON.stringify(pure.buckets[1]) === '["순 미지정","다솔,정후"]', JSON.stringify(pure.buckets));
// 신효진 부장·임성빈 교역자가 '순 미지정'에 들어가 있던 자리다(사용자 지적 2026-09-07).
// **되돌리기**: groupRoster에서 heads를 앞에 붙이지 않거나 headed를 빼면 이 셋이 깨진다.
check('전도사님·부장님 묶음이 순 묶음 위에 선다',
  JSON.stringify(pure.headed.slice(0, 2)) === '[["pastor","전도사님","임성빈"],["director","부장님","다솔,신효진"]]',
  JSON.stringify(pure.headed));
check('순에 편성된 부장은 그 순에도 그대로 선다',
  JSON.stringify(pure.headed[2]) === '["g1","꼬순","한결,나리,다솔"]', JSON.stringify(pure.headed));
check("교역자·부장은 '순 미지정'에서 빠진다(거기 남는 것은 정후뿐)",
  JSON.stringify(pure.headed[3]) === '["null","순 미지정","정후"]' && pure.headed.length === 4,
  JSON.stringify(pure.headed));
check('전도사님·부장님 묶음은 전체 자격자만 만진다',
  JSON.stringify(pure.toggleHead) === '[false,false,true]', JSON.stringify(pure.toggleHead));
check('출석은 발행된 뒤 · 예배가 시작한(그날 13:30 KST) 뒤에만 연다',
  pure.attPast === true && pure.attToday === true && pure.attFuture === false && pure.attDraft === false,
  `과거${pure.attPast}/오늘${pure.attToday}/미래${pure.attFuture}/작성중${pure.attDraft}`);
check('같은 날이라도 13:30 전에는 안 열리고, 정각이면 열린다',
  pure.attBefore === false && pure.attSharp === true && pure.openHm === '13:30',
  `${pure.attBefore}/${pure.attSharp}/${pure.openHm}`);
// 진입과 체크는 다른 문이다 — 예배 전에도 화면은 들어가서 명단을 미리 본다
check('출석 화면 진입은 발행 여부만 본다(예배 전이어도 들어간다)',
  pure.visPub === true && pure.visDraft === false, `${pure.visPub}/${pure.visDraft}`);
check('재생목록 주소는 playlist?list= 한 모양으로 저장된다',
  pure.playlistUrl === 'https://www.youtube.com/playlist?list=PLl2Yb-KJTF0Zq', pure.playlistUrl);
check('지금 시각은 한국 시간으로 잰다(날짜+시각 한 글자열)', pure.kstShape === true);
// 찬양팀은 하나뿐이라 주보마다 적을 값이 아니다 — 바뀌는 것은 인도자뿐이다
check("찬양팀 이름은 서비스 계층의 고정 상수 'Re:born 워십'", pure.praiseTeam === 'Re:born 워십', String(pure.praiseTeam));
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

// ── 0-b) 유튜브 제목 다듬기 (2026-09-08) ────────────────────────────────────
// "유튜브 링크로 가져오면 제목 부분이 가끔 볼드 처리되는 경우가 있다"(사용자 보고).
// 우리 화면은 제목을 <input>과 평범한 <span>에만 넣으므로 마크다운 굵게가 될 길이 없다 —
// **글자 자체가 다른 글자**다(유니코드 수학 알파벳 · 전각). CSS로는 못 되돌리고, 받는
// 자리에서 NFKC로 접는 수밖에 없다(services/titleText.js).
// **되돌리기**: titleText.js에서 `.normalize('NFKC')`를 빼면 아래 두 줄이 바로 깨진다.
const titles = await ev(`(async () => {
  const m = await import('/src/services/titleText.js');
  const bold = '\\u{1D5EA}\\u{1D5FC}\\u{1D5FF}\\u{1D600}\\u{1D5F5}\\u{1D5F6}\\u{1D5FD} \\u{1D7ED}';  // 수학 볼드 Worship 1
  const wide = '\\uFF37\\uFF4F\\uFF52\\uFF53\\uFF48\\uFF49\\uFF50';                                   // 전각 Worship
  return {
    boldRaw: bold, bold: m.cleanTitle(bold),
    wide: m.cleanTitle(wide),
    korean: m.cleanTitle('주 은혜임을'),
    zero: m.cleanTitle('주\\u200B은혜\\uFEFF임을\\uFE0F'),
    spaces: m.cleanTitle('  주  은혜임을\\n(Live) '),
    junk: [m.cleanTitle(null), m.cleanTitle(undefined), m.cleanTitle('')],
  };
})()`, true);
check('굵어 보이는 수학 알파벳 제목이 평범한 글자로 내려온다',
  titles.bold === 'Worship 1' && titles.boldRaw !== 'Worship 1', `${titles.boldRaw} → ${titles.bold}`);
check('전각 글자도 같이 접힌다', titles.wide === 'Worship', titles.wide);
check('한글 제목은 그대로 둔다', titles.korean === '주 은혜임을', titles.korean);
check('눈에 안 보이는 글자(폭 없는 공백·변이 선택자)는 턴다', titles.zero === '주은혜임을', titles.zero);
check('줄바꿈·연달은 공백은 한 칸으로 접고 앞뒤를 턴다', titles.spaces === '주 은혜임을 (Live)', JSON.stringify(titles.spaces));
check('빈 값도 빈 글자다(undefined가 글자로 새지 않는다)',
  JSON.stringify(titles.junk) === '["","",""]', JSON.stringify(titles.junk));

// 함수가 맞아도 부르지 않으면 그대로다 — 두 자리 모두 소스로 못 박는다.
// **앱에서도 한 번 더 접는 이유**: 배포된 서버가 앱보다 낡을 수 있어서, 정규화가 서버에만
// 있으면 옛 서버가 도는 동안 굵은 제목이 그대로 들어온다.
const ytSrc = readFileSync(new URL('../api/yt.js', import.meta.url), 'utf8');
check("서버(api/yt.js)가 titleText의 cleanTitle을 들여다 쓴다",
  /import \{ cleanTitle \} from '\.\.\/src\/services\/titleText\.js';/.test(ytSrc),
  ytSrc.split('\n').find(l => l.includes('titleText')) || 'import 없음');
check('서버는 RSS 길과 Data API 길 둘 다에서 제목을 다듬는다',
  /cleanTitle\(decode\(title\)\)/.test(ytSrc) && /const title = cleanTitle\(sn\.title\)/.test(ytSrc)
  && /cleanTitle\(JSON\.parse\(text\)\.title\)/.test(ytSrc),
  JSON.stringify([/cleanTitle\(decode\(title\)\)/.test(ytSrc), /const title = cleanTitle\(sn\.title\)/.test(ytSrc),
    /cleanTitle\(JSON\.parse\(text\)\.title\)/.test(ytSrc)]));
const wSrc = readFileSync(new URL('../src/services/worship.js', import.meta.url), 'utf8');
check('앱도 받은 제목을 다시 다듬는다(옛 서버가 도는 동안의 안전망)',
  /cleanTitle\(v\.title\)/.test(wSrc) && /return cleanTitle\(title\);/.test(wSrc),
  JSON.stringify([/cleanTitle\(v\.title\)/.test(wSrc), /return cleanTitle\(title\);/.test(wSrc)]));

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

// 메타는 **어느 폭에서도 한 줄이고 글자가 잘리지 않는다**(사용자 지적 2026-09-05:
// 520px 카드에서 '임성빈 전도사님'만 다음 줄로 내려갔다 · 재강조 "가독성이 중요해서
// 줄바꿈 안 되게끔"). 규칙은 접는 것도 자르는 것도 아니라 **덜 중요한 도막을 빼는
// 것**이다 — 남는 순서는 날짜·본문 > 설교자 > 종류이고, 자리는 카드 폭이 정한다
// (컨테이너 쿼리 · index.css의 .worship-card-meta).
//
// 재는 폭에 1536이 있는 이유: 카드는 1·2·3열로 서고 **열이 늘어나는 자리에서 카드가
// 좁아진다.** 화면 폭만 훑으면 그 구간을 지나친다.
const META_AT = `(() => {
  const cards = [...document.querySelectorAll('.worship-card')];
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rows: cards.map(c => {
      const m = c.querySelector('.worship-card-meta');
      const cs = getComputedStyle(m);
      return {
        w: Math.round(m.getBoundingClientRect().width),
        lines: Math.round(m.getBoundingClientRect().height / parseFloat(cs.lineHeight)),
        clip: m.scrollWidth - m.clientWidth,
        shown: m.innerText.replace(/\s+/g, ' ').trim(),
      };
    }),
  };
})()`;
const metaAt = {};
for (const w of [375, 768, 1024, 1440, 1536]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 });
  await sleep(450);
  metaAt[w] = await ev(META_AT);
}
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(450);
const metaBad = Object.entries(metaAt).filter(([, v]) => !v || !v.rows.length || v.overflow > 0
  || v.rows.some(r => r.lines !== 1 || r.clip > 0));
check('카드 메타는 375~1536 어디서도 한 줄이고 글자가 잘리지 않는다',
  metaBad.length === 0, JSON.stringify(metaBad.length ? metaBad : metaAt));
const metaDates = [DL.p1, DL.p2];
check('어느 폭에서도 날짜와 본문은 남는다',
  Object.values(metaAt).every(v => v.rows.every((r, i) => r.shown.startsWith(metaDates[i]) && r.shown.includes('본문 '))),
  JSON.stringify(Object.entries(metaAt).map(([w, v]) => [w, v.rows.map(r => r.shown)])));
// 규칙(도막 빼기)을 다 걸어도 **남는 도막이 칸보다 긴 값**이 올 수 있다(아주 긴 책
// 이름을 두 군데 적은 구절 같은 것). 그때도 줄은 늘지 않고 말줄임으로 끝난다 —
// 사용자 요구는 "절대 두 줄로 꺾이지 않는 것"이다(2026-09-05). 주보를 하나 더 심으면
// 목록 개수를 세는 다른 검사가 흔들리므로, 그 자리 글자만 잠깐 길게 바꿔 재고 되돌린다.
const longMeta = await ev(`(() => {
  const m = document.querySelector('.worship-card-meta');
  const ref = m.querySelector('.worship-meta-ref');
  if (!ref) return null;
  const keep = ref.textContent;
  ref.textContent = '본문 데살로니가전서 5:12-28 · 데살로니가후서 3:1-18 · 요한계시록 22:1-21 · 사도행전 27:13-44 · 역대하 34:1-33';
  const cs = getComputedStyle(m);
  const r = {
    lines: Math.round(m.getBoundingClientRect().height / parseFloat(cs.lineHeight)),
    clip: m.scrollWidth - m.clientWidth,
  };
  ref.textContent = keep;
  return r;
})()`);
check('규칙을 다 걸어도 남는 긴 값은 말줄임으로 끝난다(두 줄이 되지 않는다)',
  !!longMeta && longMeta.lines === 1 && longMeta.clip > 0, JSON.stringify(longMeta));
check('좁아지면 종류 → 설교자 순으로 빠진다',
  metaAt[375].rows[0].shown === `${DL.p1} · 본문 이사야 32:9-20`
  && metaAt[1024].rows[0].shown === `${DL.p1} · 본문 이사야 32:9-20 · 임성빈 전도사님`
  && metaAt[1440].rows[0].shown === `${DL.p1} · 주일 4부 젊은이 예배 · 본문 이사야 32:9-20 · 임성빈 전도사님`,
  JSON.stringify([metaAt[375].rows[0].shown, metaAt[1024].rows[0].shown, metaAt[1440].rows[0].shown]));
check('편집 자격자에게 새 주보 · 작성 중 줄', list.newBtn === true && list.drafts === '작성 중인 주보 1건', `${list.newBtn}/${list.drafts}`);

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
    // 머리줄이 카드가 된 뒤로는 콘텐츠 상자 오른쪽이 기준이다(안쪽 여백만큼 들어와 선다)
    right: Math.round(head.getBoundingClientRect().right - (parseFloat(getComputedStyle(head).paddingRight) || 0) - b.getBoundingClientRect().right),
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
// 곡도 인도자도 없으면 팀 줄조차 서지 않는다 — 팀 이름만 남겨 두면 '찬양을 정해 뒀다'로 읽힌다
await ev(`[...document.querySelectorAll('.worship-tab')].find(x => x.textContent.trim() === '찬양').click()`);
await sleep(300);
check('아무것도 정하지 않은 찬양 탭에는 팀 줄이 서지 않는다',
  (await ev(`!document.querySelector('.worship-praise-head')`)) === true);
// 목록으로 돌아오면 목록은 다시 발행본만 보여 준다(ServiceList가 새로 선다)
await ev(`${byText('목록으로')}.click()`); await sleep(700);

// ── 2) 상세 — 네 탭 ─────────────────────────────────────────────────────────
await ev(`document.querySelector('.worship-card').click()`);
await sleep(1400);
const detail = await ev(`(() => {
  const head = document.querySelector('.worship-detail header');
  const att = document.querySelector('.worship-att-open');
  const headRight = head ? head.getBoundingClientRect().right - (parseFloat(getComputedStyle(head).paddingRight) || 0) : 0;
  return {
    open: !!document.querySelector('.worship-detail'),
    tabs: [...document.querySelectorAll('.worship-tab')].map(t => t.textContent.trim()),
    panel: document.querySelector('.worship-tabpanel')?.innerText || '',
    verses: document.querySelectorAll('.worship-verse').length,
    att: !!att,
    attInHead: !!(att && head && head.contains(att)),
    // 머리줄이 상자(카드)가 된 뒤로 오른쪽 끝은 **콘텐츠 상자**다 — 안쪽 여백만큼
    // 안으로 들어와 서는 것이 맞다(2026-09-07)
    attRight: att ? Math.round(headRight - att.getBoundingClientRect().right) : -1,
    editRight: (() => {
      const e = document.querySelector('.worship-edit-open');
      return e && head ? Math.round(headRight - e.getBoundingClientRect().right) : -1;
    })(),
    bodyWidth: Math.round(document.querySelector('.worship-passage')?.getBoundingClientRect().width || 0),
    panelWidth: Math.round(document.querySelector('.worship-tabpanel')?.getBoundingClientRect().width || 0),
    bodyCols: (() => {
      const c = document.querySelector('.worship-passage-cols');
      return c ? Number(getComputedStyle(c).columnCount) || 1 : 0;
    })(),
    verseWidth: Math.round(document.querySelector('.worship-verse')?.getBoundingClientRect().width || 0),
    note: !!document.querySelector('.worship-note'),
  };
})()`);
check('상세에 탭 네 개', JSON.stringify(detail.tabs) === '["말씀","담당자","찬양","광고"]', JSON.stringify(detail.tabs));
check('말씀 탭에 제목·구절·설교자',
  detail.panel.includes('흔들리지 않는 기쁨') && detail.panel.includes('이사야 32:9-20') && detail.panel.includes('임성빈 전도사님'),
  detail.panel.slice(0, 80));
check('구절만 정하면 본문이 펼쳐진다(개역한글)', detail.verses === 12, `${detail.verses}절`);
// 본문 상자는 **트랙을 다 쓴다**(§6-9-k — max-w는 그리드 트랙 안에 빈 띠를 만든다).
// 42rem 상한이 있던 때는 1440에서 672px에 멈춰 오른쪽 726px이 통째로 비었다
// (사용자 요청 2026-09-06 "말씀 나오는 부분도 반응형 잘 적용되게"). 대신 넓어지면
// **두 단으로 흐르게** 해서 한 줄이 1400px을 가로지르지 않게 한다.
check('본문 상자가 탭 판 폭을 다 쓴다(1440)',
  Math.abs(detail.bodyWidth - detail.panelWidth) <= 1 && detail.bodyWidth > 1000,
  `본문 ${detail.bodyWidth}px / 판 ${detail.panelWidth}px`);
check('넓은 화면에서는 두 단으로 나뉘고 한 단은 읽는 폭을 지킨다',
  detail.bodyCols === 2 && detail.verseWidth > 300 && detail.verseWidth <= 720,
  `${detail.bodyCols}단 / 한 단 ${detail.verseWidth}px`);
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
  roles.length === 3 && roles[0].includes('김윤주') && roles[0].includes('대표기도') && roles[2].includes('한상록 강사님'),
  JSON.stringify(roles));
// **이름 뒤에 호칭이 붙는다**(사용자 결정 2026-09-06 · services/people.js honorific):
// 교역자 '전도사님' · 그 해 부장 '부장님' · 나머지 명단 사람 '청년'.
// 명단에 없는 객원(한상록 강사님)은 아는 것이 없으니 **적은 글자 그대로** 둔다.
check('담당자 이름 뒤에 호칭이 붙는다(청년 · 전도사님 · 객원은 그대로)',
  roles[0].includes('김윤주 청년') && roles[1].includes('양민혁 전도사님')
  && roles[2].includes('한상록 강사님') && !roles[2].includes('청년'),
  JSON.stringify(roles));

await tabClick('찬양'); await sleep(300);
const songs = await ev(`(() => ({
  text: document.querySelector('.worship-tabpanel').innerText.replace(/\\n+/g, ' | '),
  blank: [...document.querySelectorAll('.worship-tabpanel a')].map(a => a.target),
}))()`);
check('찬양 목록 · 링크는 새 탭', songs.text.includes('주 은혜임을') && songs.text.includes('나의 반석이신 하나님')
  && songs.blank.length === 2 && songs.blank.every(t => t === '_blank'), JSON.stringify(songs));
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

// 찬양 머리 한 줄 — **팀 이름은 고정, 인도자는 주보마다**(0044 · 사용자 결정 2026-09-05).
// 곡 목록 **앞**에 서야 한다(누가 인도하는지를 먼저 읽는다).
const praiseView = await ev(`(() => {
  const head = document.querySelector('.worship-praise-head');
  const first = document.querySelector('.worship-song-view');
  if (!head) return null;
  return {
    team: head.querySelector('.worship-praise-team')?.textContent.trim() || '',
    leader: head.querySelector('.worship-praise-leader')?.textContent.trim() || '',
    beforeList: !!first && head.getBoundingClientRect().bottom <= first.getBoundingClientRect().top,
    // 한 줄인가 — 팀 이름과 인도자가 같은 줄에 선다(윗변이 같다)
    sameLine: (() => {
      const tops = [...head.children].map(k => Math.round(k.getBoundingClientRect().top));
      return tops.length >= 2 && tops.every(t => Math.abs(t - tops[0]) <= 4);
    })(),
    links: head.querySelectorAll('a').length,
    playlist: (() => {
      const a = head.querySelector('.worship-praise-playlist');
      return a ? [a.textContent.trim(), a.getAttribute('href'), a.getAttribute('target')] : null;
    })(),
  };
})()`);
check('발행본 찬양 탭에 팀 이름과 인도자가 곡 목록 앞 한 줄로 선다',
  !!praiseView && praiseView.team === 'Re:born 워십' && praiseView.leader === '· 인도 조해리 부장님'
  && praiseView.beforeList === true && praiseView.links === 1,
  JSON.stringify(praiseView));
// 인도자도 담당자와 같은 호칭 규칙이다 — 조해리는 올해 부장(people_roles)이라 '부장님'
check('찬양 인도자 이름에도 호칭이 붙는다', praiseView.leader === '· 인도 조해리 부장님', praiseView.leader);
// 곡을 가져온 재생목록은 주보에 남아, 보기에서 **한 번에 틀 수 있다**(0046)
check('재생목록을 가져왔으면 그 줄에서 재생목록을 통째로 연다',
  JSON.stringify(praiseView.playlist) === JSON.stringify(['재생목록 열기', 'https://www.youtube.com/playlist?list=PLl2Yb-KJTF0Zq', '_blank']),
  JSON.stringify(praiseView.playlist));

// 송폼 — 주보에 붙은 파일(0047). **보기 화면에는 줄만 선다**: 올리기 버튼도 삭제도
// 수정 화면 것이다(담당자·찬양·광고와 같은 문법). 파일 줄 모양은 업무 첨부와 한 벌이다.
const formView = await ev(`(() => {
  const sec = document.querySelector('.worship-songforms');
  if (!sec) return null;
  const row = sec.querySelector('.worship-songform-row');
  const lastSong = [...document.querySelectorAll('.worship-song-view')].pop();
  return {
    label: sec.innerText.split('\\n')[0].trim(),
    add: !!sec.querySelector('.worship-songform-add'),
    rows: sec.querySelectorAll('.worship-songform-row').length,
    name: row?.querySelector('.worship-songform-name')?.textContent.trim() || '',
    meta: row?.querySelector('.worship-songform-meta')?.textContent.trim() || '',
    open: !!row?.querySelector('.worship-songform-open'),
    del: !!row?.querySelector('button[aria-label$="삭제"]'),
    afterSongs: !!lastSong && sec.getBoundingClientRect().top >= lastSong.getBoundingClientRect().bottom - 1,
  };
})()`);
check('발행본 찬양 탭 아래에 송폼 줄이 선다(이름 · 크기 · 미리보기)',
  !!formView && formView.label === '송폼' && formView.rows === 1
  && formView.name === '2026-09-06 송폼.pdf' && formView.meta === '1.0 MB'
  && formView.open === true && formView.afterSongs === true, JSON.stringify(formView));
check('보기 화면의 송폼에는 올리기·삭제가 없다',
  formView.add === false && formView.del === false, JSON.stringify(formView));
// **갈래로 갈린다**(0054) — 같은 주보에 붙은 큐시트 파일은 찬양 탭에 안 섞이고,
// kind가 없는 옛 행(f1)은 송폼으로 읽힌다.
// **되돌리기**: worshipDetail의 filesOfKind(files, SONGFORM)를 files로 되돌리면 두 줄이 선다.
check('송폼 줄에 큐시트 파일이 섞이지 않는다(kind로 갈린다)',
  formView.rows === 1 && formView.name === '2026-09-06 송폼.pdf'
  && (await ev(`!document.querySelector('.worship-songforms .worship-cue-file-row')`)) === true,
  JSON.stringify(formView));

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
// 전도사님(임성빈 자리의 양민혁)·부장님(그 해 director 조해리)이 **맨 위 두 묶음**이고,
// 그 둘이 빠지면서 '순 미지정'은 빌 사람이 없어 아예 그려지지 않는다(2026-09-07).
check('전도사님·부장님 묶음이 순 묶음 위에 선다',
  att.groups.length === 4 && att.groups[0].includes('전도사님 0/1') && att.groups[1].includes('부장님 0/1')
  && att.groups[2].includes('꼬순 1/3') && att.groups[3].includes('TT순 0/3'), JSON.stringify(att.groups));
check('이미 체크된 사람이 켜져 있다', JSON.stringify(att.on) === '["천진영"]', JSON.stringify(att.on));
// 순장(김윤주·노준석)이 맨 앞, 나머지는 가나다순 — 시드가 준 순서와 다르다
// (꼬순은 천진영·김승찬 순으로 심었다)
check('순 안 사람 칩은 순장 먼저 · 나머지는 가나다순',
  JSON.stringify(att.order) === JSON.stringify([['양민혁'], ['조해리'], ['김윤주', '김승찬', '천진영'], ['노준석', '배현민', '임재훈']]),
  JSON.stringify(att.order));

const sunHead = `[...document.querySelectorAll('.att-group-head')].find(h => h.innerText.includes('꼬순'))`;
await ev(`${sunHead}?.click()`); await sleep(300);
const folded = await ev(`(() => ({ chips: document.querySelectorAll('.att-chip').length, open: ${sunHead}?.getAttribute('aria-expanded') }))()`);
await ev(`${sunHead}?.click()`); await sleep(300);
const unfolded = await ev(`document.querySelectorAll('.att-chip').length`);
check('순별로 접힌다', folded.chips === att.chips - 3 && folded.open === 'false', JSON.stringify(folded));
check('다시 펼쳐진다', unfolded === att.chips, `${unfolded}/${att.chips}`);

await ev(`[...document.querySelectorAll('.att-chip')].find(c => c.textContent.trim() === '김윤주').click()`);
await sleep(500);
const toggled = await ev(`(() => ({
  pressed: [...document.querySelectorAll('.att-chip')].find(c => c.textContent.trim() === '김윤주').getAttribute('aria-pressed'),
  total: document.querySelector('.att-total').innerText.replace(/\\s+/g, ' '),
  head: ${sunHead}?.innerText.replace(/\\s+/g, ' '),
  stored: JSON.parse(localStorage.getItem('church_worship_v1')).attendance.length,
}))()`);
check('사람 칩을 누르면 출석이 켜진다', toggled.pressed === 'true' && toggled.stored === 2, JSON.stringify(toggled));
check('집계가 같이 오른다(전체 · 순별)', toggled.total === '전체 2/8' && String(toggled.head).includes('꼬순 2/3'), JSON.stringify(toggled));

await ev(`[...document.querySelectorAll('.att-chip')].find(c => c.textContent.trim() === '김윤주').click()`);
await sleep(500);
const off = await ev(`(() => ({ total: document.querySelector('.att-total').innerText.replace(/\\s+/g, ' '), stored: JSON.parse(localStorage.getItem('church_worship_v1')).attendance.length }))()`);
check('다시 누르면 출석이 취소된다', off.total === '전체 1/8' && off.stored === 1, JSON.stringify(off));

// 미등록 출석자는 **명단에 올리지 않는다**(0053 · 사용자 결정 2026-09-07). 손님 표에만
// 이름이 남고 사람 칩이 되지 않으며, 분모(전체 n/m)는 그대로다.
// **되돌리기**: worship.addGuest가 people에 넣게 하면 people 9명이 되어 이 검사가 깨진다.
await ev(`document.querySelector('.att-add-open').click()`); await sleep(300);
await ev(typeIn('input[aria-label="미등록 출석자 이름"]', '한새싹'));
await sleep(200);
await ev(`${byText('추가')}.click()`); await sleep(700);
const added = await ev(`(() => {
  const g = JSON.parse(localStorage.getItem('church_worship_v1'));
  return {
    total: document.querySelector('.att-total').innerText.replace(/\\s+/g, ' '),
    guests: [...document.querySelectorAll('.att-guest')].map(c => c.textContent.trim()),
    people: g.people.length,
    rows: (g.attendance_guests || []).map(x => [x.service_id, x.name]),
    attendance: (g.attendance || []).length,
    chip: [...document.querySelectorAll('.att-chip')].some(c => c.textContent.trim() === '한새싹'),
    field: document.querySelector('input[aria-label="미등록 출석자 이름"]')?.value,
  };
})()`);
check('미등록 출석자는 그 예배의 손님으로만 남는다(명단에 올리지 않는다)',
  added.people === 8 && JSON.stringify(added.rows) === JSON.stringify([['s1', '한새싹']])
  && added.attendance === 1 && added.chip === false, JSON.stringify(added));
check('손님 칩이 서고 상단에 손님 수가 붙는다',
  JSON.stringify(added.guests) === '["한새싹"]' && added.total === '전체 1/8 · 손님 1', JSON.stringify(added));
check('잇달아 적을 수 있게 칸만 비운다', added.field === '', JSON.stringify(added.field));

// 지우기는 확인 팝오버 없이 바로다(알림 지우기와 같은 판단 · §8)
await ev(`document.querySelector('.att-guest-del')?.click()`); await sleep(700);
const gone = await ev(`(() => ({
  guests: document.querySelectorAll('.att-guest').length,
  rows: (JSON.parse(localStorage.getItem('church_worship_v1')).attendance_guests || []).length,
  total: document.querySelector('.att-total').innerText.replace(/\\s+/g, ' '),
}))()`);
check('손님은 ×로 바로 지워진다', gone.guests === 0 && gone.rows === 0 && gone.total === '전체 1/8', JSON.stringify(gone));

// 출석 메모 — **노트처럼 저장하고 수정한다**(사용자 요청 2026-09-08: "출석 메모도 노트처럼
// 저장하고 수정할 수 있는 구조로. 지금은 저장이 된다 해도 저장의 기능을 제대로 하고 있는지를
// 모르겠음"). 예전에는 디바운스 자동 저장이라 편집기 한 칸만 서 있었고, 저장 표시는 잠깐
// 켜졌다 사라져서 화면에 '저장된 상태'라는 것이 남지 않았다.
// **되돌리기**: worshipAttendance에 디바운스 자동 저장을 되살리면 '저장' 버튼이 없어 깨진다.
const noteEmpty = await ev(NOTE_STATE);
check('메모가 없으면 편집기가 바로 열린다(빈 읽기 상자를 세우지 않는다)',
  noteEmpty.box === true && noteEmpty.read === false && noteEmpty.cancel === false, JSON.stringify(noteEmpty));
check('바뀐 것이 없으면 저장이 잠겨 있다', noteEmpty.saveOff === true, String(noteEmpty.saveOff));
await ev(typeIn('.att-note-box', '오늘은 새신자가 한 명 왔어요', 'HTMLTextAreaElement'));
await sleep(400);
const noteTyped = await ev(NOTE_STATE);
check('적으면 저장이 열리고, 누르기 전에는 나가지 않는다',
  noteTyped.saveOff === false && noteTyped.stored === '', JSON.stringify(noteTyped));
await ev(`document.querySelector('.att-note-save').click()`); await sleep(900);
const noteSaved = await ev(NOTE_STATE);
check('저장을 눌러야 그 주보에 남는다', noteSaved.stored === '오늘은 새신자가 한 명 왔어요', String(noteSaved.stored));
check('저장하면 읽기 모드로 서고 도구 줄은 수정 하나다',
  noteSaved.read === true && noteSaved.readText === '오늘은 새신자가 한 명 왔어요'
  && JSON.stringify(noteSaved.order) === '["수정"]', JSON.stringify(noteSaved));
check('출석 메모도 같은 저장 라벨을 쓴다', noteSaved.state === '저장되었어요', noteSaved.state);

await ev(`document.querySelector('.att-note-edit').click()`); await sleep(350);
const noteEditing = await ev(NOTE_STATE);
check('수정을 누르면 편집기가 열리고 저장은 다시 잠긴다(아직 고친 것이 없다)',
  noteEditing.box === true && noteEditing.read === false && noteEditing.saveOff === true
  && JSON.stringify(noteEditing.order) === '["저장","취소"]', JSON.stringify(noteEditing));
check('취소는 그 줄의 오른쪽 끝이다(§8 확정 왼쪽 / 나가기 오른쪽)', noteEditing.right === 0, String(noteEditing.right));
await ev(typeIn('.att-note-box', '고쳐 적은 메모', 'HTMLTextAreaElement')); await sleep(350);
await ev(`document.querySelector('.att-note-cancel').click()`); await sleep(500);
const noteCancelled = await ev(NOTE_STATE);
check('취소하면 저장된 글로 돌아간다',
  noteCancelled.read === true && noteCancelled.readText === '오늘은 새신자가 한 명 왔어요'
  && noteCancelled.stored === '오늘은 새신자가 한 명 왔어요', JSON.stringify(noteCancelled));

// **비운 메모도 사람이 뜻한 저장이다** — 잘못 적은 줄을 지우는 길이 있어야 한다.
// 그래서 잠그는 조건은 '바뀐 것이 없을 때'뿐이고 '빈 글일 때'가 아니다(내 예배 노트와 다른 점).
await ev(`document.querySelector('.att-note-edit').click()`); await sleep(350);
await ev(typeIn('.att-note-box', '', 'HTMLTextAreaElement')); await sleep(350);
const noteEmptying = await ev(NOTE_STATE);
check('메모를 비워도 저장을 누를 수 있다', noteEmptying.saveOff === false, String(noteEmptying.saveOff));
await ev(`document.querySelector('.att-note-save').click()`); await sleep(900);
const noteCleared = await ev(NOTE_STATE);
check('비운 메모가 저장되면 읽기 상자 대신 편집기가 선다',
  noteCleared.stored === '' && noteCleared.read === false && noteCleared.box === true, JSON.stringify(noteCleared));

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
    read: !!document.querySelector('.worship-note-read'),
    readText: document.querySelector('.worship-note-read')?.innerText.trim() || '',
    editor: !!document.querySelector('.worship-note .tiptap'),
    editBtn: document.querySelector('.worship-note-edit')?.textContent.trim() || '',
    saveBtn: !!document.querySelector('.worship-note-save'),
    share: [...document.querySelectorAll('.worship-note button[aria-pressed]')].every(b => b.disabled),
    state: document.querySelector('.worship-note .worship-save-state')?.textContent.trim() || '' };
})()`);
check('내 예배 노트가 예배당 한 건으로 저장된다', noteRow.n === 1 && noteRow.body.includes('기쁨은'), JSON.stringify(noteRow));
check("노트는 발행이 없으니 '임시'가 붙지 않는다", noteRow.state === '저장되었어요', noteRow.state);
// **저장하면 읽기 모드로 돌아간다**(2026-09-07 · QT 묵상과 같은 패턴). 예전에는 편집기가
// 계속 열려 있어서 "쓴 것인지 고치는 중인지"가 화면에 없었다.
// **되돌리기**: MyNote의 editing 상태를 없애면(늘 편집기) 아래 셋이 깨진다.
check('저장하면 읽기 모드로 돌아간다(편집기 대신 본문)',
  noteRow.read === true && noteRow.editor === false && noteRow.saveBtn === false, JSON.stringify(noteRow));
check('읽기 모드에는 저장한 글이 그대로 보인다', noteRow.readText.includes('기쁨은'), noteRow.readText);
check("고치려면 '수정'을 누른다", noteRow.editBtn === '수정', noteRow.editBtn);
check('저장하고 나면 공유 세그먼트가 열린다', noteRow.share === false, String(noteRow.share));
check('저장만으로는 공유되지 않는다(기본은 나만 보기)', noteRow.shared !== true, String(noteRow.shared));

// 수정 → 취소는 **고치던 글을 버리고** 읽기 모드로 돌아간다(§8: 확정 왼쪽 / 나가기 오른쪽)
await ev(`document.querySelector('.worship-note-edit')?.click()`); await sleep(700);
await waitFor(`!!document.querySelector('.worship-note .tiptap')`);
const editing = await ev(`(() => {
  const tools = [...document.querySelector('.worship-note-tools').querySelectorAll('button')]
    .map(b => b.textContent.trim()).filter(t => ['저장', '취소', '수정'].includes(t));
  return { editor: !!document.querySelector('.worship-note .tiptap'), read: !!document.querySelector('.worship-note-read'), tools };
})()`);
check("'수정'을 누르면 편집기가 열린다", editing.editor === true && editing.read === false, JSON.stringify(editing));
check('편집 중 도구 줄은 저장 왼쪽 · 취소 오른쪽',
  JSON.stringify(editing.tools) === '["저장","취소"]', JSON.stringify(editing.tools));
await ev(`document.querySelector('.worship-note .tiptap')?.focus()`);
await send('Input.insertText', { text: '버릴 글' });
await sleep(400);
await ev(`document.querySelector('.worship-note-cancel')?.click()`); await sleep(500);
const canceled = await ev(`(() => ({
  read: !!document.querySelector('.worship-note-read'),
  text: document.querySelector('.worship-note-read')?.innerText.trim() || '',
  body: JSON.parse(localStorage.getItem('church_worship_v1')).service_notes[0]?.body || '',
}))()`);
check('취소하면 고치던 글을 버리고 읽기 모드로 돌아간다',
  canceled.read === true && !canceled.text.includes('버릴 글') && !canceled.body.includes('버릴 글'),
  JSON.stringify(canceled));

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
  shareRow.shared === true && shareRow.body.includes('기쁨은'), JSON.stringify(shareRow));
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
  backRow.shared === false && backRow.chip === '나만 볼게요' && backRow.body.includes('기쁨은'),
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
  contract.back?.shared_to_sun === true && contract.back?.body.includes('기쁨은')
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
// 생성기는 **짜임이 있는 카드**다(사용자 지적 2026-09-08 · 375px 스크린샷 "뒤죽박죽으로
// 읽힌다"). 종류는 팝오버 한 칸이 아니라 말씀·성경 리더와 같은 **세그먼트**이고, 칸마다
// 이름표가 앉는다(종류 / 이름 / 날짜 — 사용법 안내가 아니라 칸 이름이다 · §8).
// **되돌리기**: 세그먼트를 팝오버로 되돌리면 `.worship-kind-opt`가 없어 아래가 통째로 깨진다.
const form = await ev(`(() => {
  const box = document.querySelector('.worship-new');
  const ctl = [box.querySelector('.worship-kind-seg'), box.querySelector('.worship-new-date button'),
    box.querySelector('.worship-new-make'), box.querySelector('.worship-new-cancel')];
  const opts = [...box.querySelectorAll('.worship-kind-opt')];
  const bottom = (e) => Math.round(e.getBoundingClientRect().bottom);
  return {
    dateBtn: document.querySelector('.worship-new-date button')?.textContent.trim() || '',
    nativeDate: !!box.querySelector('input[type="date"]'),
    kinds: opts.map(o => o.textContent.trim()),
    // 글자가 상자 밖으로 넘치면(잘리면) scrollWidth가 clientWidth보다 크다
    clipped: opts.filter(o => o.scrollWidth - o.clientWidth > 1).map(o => o.textContent.trim()),
    picked: opts.filter(o => o.getAttribute('aria-pressed') === 'true').map(o => o.dataset.kind),
    labels: [...box.querySelectorAll('.labeled-field > span:first-child')].map(s => s.textContent.trim()),
    nameBox: !!box.querySelector('input[aria-label="예배 이름"]'),
    canMake: !box.querySelector('.worship-new-make').disabled,
    // 한 줄인지는 **컨트롤의 아랫변**으로 본다 — 이름표가 위에 붙는 칸과 안 붙는 버튼이
    // 섞여 있어서 윗변은 원래 다르다(items-end로 아래를 맞춘다)
    rows: new Set(ctl.map(bottom)).size,
    order: ctl.map(e => Math.round(e.getBoundingClientRect().left)),
    cancelGap: Math.round(box.getBoundingClientRect().right
      - box.querySelector('.worship-new-cancel').getBoundingClientRect().right),
    h: Math.round(box.getBoundingClientRect().height),
  };
})()`);
check('날짜는 업무의 날짜 픽커로 고른다(브라우저 기본 date 칸이 아니다)',
  form.nativeDate === false && form.dateBtn === expectLabel, `${form.dateBtn} / ${expectLabel}`);
check('종류는 세그먼트 두 칸이고 라벨이 온전히 보인다(잘리지 않는다)',
  JSON.stringify(form.kinds) === '["주일예배","다른 예배"]' && form.clipped.length === 0,
  `${JSON.stringify(form.kinds)} / 잘림 ${JSON.stringify(form.clipped)}`);
check('주일예배가 기본 — 이름 칸은 다른 예배를 고를 때만 나온다',
  JSON.stringify(form.picked) === '["sunday"]' && form.nameBox === false,
  `${JSON.stringify(form.picked)} / 이름칸 ${form.nameBox}`);
check('칸마다 이름표가 앉는다', JSON.stringify(form.labels) === '["종류","날짜"]', JSON.stringify(form.labels));
check('데스크톱에서는 종류·날짜·만들기·취소가 한 줄이다',
  form.rows === 1 && form.h <= 100, `${form.rows}줄 / ${form.h}px`);
// 상시 도구 줄은 확정 왼쪽 / 나가기 오른쪽(§8) — 만들기가 날짜 바로 옆, 취소는 카드 오른쪽 끝
check('만들기는 날짜 옆이고 취소는 카드 오른쪽 끝이다',
  form.order[1] < form.order[2] && form.order[2] < form.order[3] && form.cancelGap <= 16,
  `${JSON.stringify(form.order)} / 오른쪽 여백 ${form.cancelGap}px`);
check('기본값이 채워져 있어 한 번 눌러 만들 수 있다', form.canMake === true, String(form.canMake));

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

// 이벤트성 예배 — 세그먼트의 '다른 예배'를 고를 때만 이름 칸이 나온다
await ev(`[...document.querySelectorAll('.worship-kind-opt')].find(b => b.dataset.kind === 'other').click()`);
await sleep(350);
const otherPick = await ev(`(() => {
  const box = document.querySelector('.worship-new');
  const name = box.querySelector('input[aria-label="예배 이름"]');
  return {
    box: !!name,
    focused: document.activeElement === name,
    blocked: box.querySelector('.worship-new-make').disabled,
    picked: [...box.querySelectorAll('.worship-kind-opt')]
      .filter(o => o.getAttribute('aria-pressed') === 'true').map(o => o.dataset.kind),
    labels: [...box.querySelectorAll('.labeled-field > span:first-child')].map(s => s.textContent.trim()),
    rows: new Set([box.querySelector('.worship-kind-seg'), name, box.querySelector('.worship-new-date button'),
      box.querySelector('.worship-new-make'), box.querySelector('.worship-new-cancel')]
      .map(e => Math.round(e.getBoundingClientRect().bottom))).size,
  };
})()`);
check('다른 예배를 고르면 이름 칸이 나오고, 이름을 적기 전에는 만들 수 없다',
  otherPick.box === true && otherPick.blocked === true && JSON.stringify(otherPick.picked) === '["other"]',
  JSON.stringify(otherPick));
check('이름 칸이 나오면 커서가 그리로 간다', otherPick.focused === true, String(otherPick.focused));
check('이름 칸에도 이름표가 앉고 데스크톱에서는 여전히 한 줄이다',
  JSON.stringify(otherPick.labels) === '["종류","이름","날짜"]' && otherPick.rows === 1,
  `${JSON.stringify(otherPick.labels)} / ${otherPick.rows}줄`);
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
// 큐시트 세 칸이 말씀 탭 마지막 줄로 들어왔다(0053 · 2026-09-07)
check('말씀 편집 칸에 이름이 붙는다 — 설교 제목 · 설교자 · 본문 구절 · 큐시트',
  JSON.stringify(fields.labels) === '["설교 제목","설교자","본문 구절","큐시트 링크","큐시트 제목"]',
  JSON.stringify(fields.labels));
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

// ── 7-c) 찬양 — 고정 팀명 + 인도자 (0044 · 사용자 결정 2026-09-05) ──────────
// 팀 이름은 못 고치는 글자(상수)이고, 주보마다 바뀌는 것은 인도자 하나다.
// 인도자 칸은 **담당자 줄과 같은 부품**이라 명단 자동완성이 그대로 붙는다.
const praiseEdit = await ev(`(() => {
  const box = document.querySelector('.worship-praise-edit');
  if (!box) return null;
  return {
    team: box.querySelector('.worship-praise-team')?.textContent.trim() || '',
    teamEditable: !!box.querySelector('.worship-praise-team input, .worship-praise-team textarea'),
    label: box.innerText,
    field: !!box.querySelector('input[aria-label="이름"]'),
    aboveImport: (() => {
      const imp = document.querySelector('.worship-song-import');
      return !!imp && box.getBoundingClientRect().bottom <= imp.getBoundingClientRect().top;
    })(),
  };
})()`);
check('찬양 편집 머리에 고정 팀명과 인도자 칸이 있다(팀 이름은 고칠 수 없다)',
  !!praiseEdit && praiseEdit.team === 'Re:born 워십' && praiseEdit.teamEditable === false
  && praiseEdit.label.includes('인도자') && praiseEdit.field === true && praiseEdit.aboveImport === true,
  JSON.stringify(praiseEdit));

await ev(typeIn('.worship-praise-edit input[aria-label="이름"]', '김승'));
await sleep(400);
const praiseSugg = await ev(`(() => ({
  n: document.querySelectorAll('.worship-praise-edit .worship-person-list button').length,
  first: document.querySelector('.worship-praise-edit .worship-person-list button')?.innerText.trim() || '',
}))()`);
check('인도자 칸도 담당자와 같은 명단 자동완성을 쓴다',
  praiseSugg.n === 1 && praiseSugg.first.includes('김승찬'), JSON.stringify(praiseSugg));
await ev(`document.querySelector('.worship-praise-edit .worship-person-list button')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
await sleep(1700);
const praiseSaved = await ev(`(() => {
  const row = JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.kind === '성탄절 예배');
  return { leader: row.praise_leader, songs: (row.songs || []).length,
    avatar: !!document.querySelector('.worship-praise-edit .worship-person span[class*="w-5"]') };
})()`);
// 저장되는 것은 **이름 글자**다(0044는 text 칸) — 담당자처럼 personId를 따로 두지 않는다
check('인도자를 고르면 그 이름이 주보에 저절로 저장된다',
  praiseSaved.leader === '김승찬' && praiseSaved.songs === 0, JSON.stringify(praiseSaved));

// ── 7-d) 송폼 — 주보에 붙는 파일 (0047 · HANDOFF §1.3의 검토 결론) ──────────
// 저장 자리(files.service_id)와 드라이브 길은 업무 첨부와 한 벌이다 — 그쪽은
// tests/drivesync.mjs가 소스로 본다. 여기서 보는 것은 **화면**이다: 수정 화면에
// 올리기 버튼이 서고, 고른 파일이 바로 줄로 들어오고, 지울 때 제 이름을 부른다.
const formEdit = await ev(`(() => {
  const sec = document.querySelector('.worship-songforms');
  if (!sec) return null;
  return {
    text: sec.innerText.replace(/\\s+/g, ' ').trim(),
    add: sec.querySelector('.worship-songform-add')?.textContent.trim() || '',
    input: !!sec.querySelector('input[type=file]'),
    rows: sec.querySelectorAll('.worship-songform-row').length,
    belowSongs: (() => {
      const add = document.querySelector('.worship-add-card');   // '찬양 추가' 점선 카드
      return !!add && sec.getBoundingClientRect().top >= add.getBoundingClientRect().bottom - 1;
    })(),
  };
})()`);
check('수정 화면 찬양 탭 아래에 송폼 올리기 버튼이 선다',
  !!formEdit && formEdit.add === '파일 올리기' && formEdit.input === true
  && formEdit.rows === 0 && formEdit.belowSongs === true, JSON.stringify(formEdit));
// 붙은 파일이 없어도 **안내 줄을 두지 않는다**(§8) — 라벨과 버튼이 전부다
check('붙은 파일이 없어도 사용법 안내 줄이 붙지 않는다',
  formEdit.text === '송폼 파일 올리기', JSON.stringify(formEdit.text));

// 파일을 고른다. 게스트에는 드라이브가 없어 행만 localStorage에 남는다.
await ev(`(() => {
  const el = document.querySelector('.worship-songforms input[type=file]');
  const dt = new DataTransfer();
  dt.items.add(new File(['%PDF-1.4 song form'], '성탄절 송폼.pdf', { type: 'application/pdf' }));
  el.files = dt.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(900);
const formAdded = await ev(`(() => {
  const rows = [...document.querySelectorAll('.worship-songform-row')];
  const g = JSON.parse(localStorage.getItem('church_worship_v1'));
  const svc = g.services.find(s => s.kind === '성탄절 예배');
  return {
    rows: rows.length,
    name: rows[0]?.querySelector('.worship-songform-name')?.textContent.trim() || '',
    del: !!rows[0]?.querySelector('button[aria-label$="삭제"]'),
    stored: (g.files || []).filter(f => f.service_id === svc.id).map(f => f.name),
    // 업무 축(card_id)으로 새지 않는다 — files 한 표를 둘이 나눠 쓴다(0047 배타 CHECK)
    cardAxis: (g.files || []).some(f => f.card_id),
  };
})()`);
check('고른 파일이 바로 줄로 들어오고 주보 축(service_id)으로 저장된다',
  formAdded.rows === 1 && formAdded.name === '성탄절 송폼.pdf'
  && JSON.stringify(formAdded.stored) === '["성탄절 송폼.pdf"]' && formAdded.cardAxis === false,
  JSON.stringify(formAdded));
check('수정 화면에서는 그 줄에 삭제가 붙는다', formAdded.del === true, JSON.stringify(formAdded));

// 삭제 확인 문구 — 담당자·찬양·광고와 같은 톤이다('이 OO을(를) 삭제할까요?')
await ev(`document.querySelector('.worship-songform-row button[aria-label$="삭제"]').click()`);
await sleep(400);
const askForm = await ev(`document.body.innerText.includes('이 송폼을 삭제할까요?')`);
check("확인 문구는 '이 송폼을 삭제할까요?'", askForm === true, String(askForm));
// 확인창은 body 포털이라(§6-1) 문구를 짚어 그 안의 '삭제'를 누른다
await ev(`(() => {
  const p = [...document.querySelectorAll('p')].find(x => x.textContent.trim() === '이 송폼을 삭제할까요?');
  [...p.parentElement.querySelectorAll('button')].pop().click();
})()`);
await sleep(700);
const formGone = await ev(`(() => {
  const g = JSON.parse(localStorage.getItem('church_worship_v1'));
  const svc = g.services.find(s => s.kind === '성탄절 예배');
  return { rows: document.querySelectorAll('.worship-songform-row').length,
    stored: (g.files || []).filter(f => f.service_id === svc.id).length };
})()`);
check('지우면 화면에서도 저장 자리에서도 사라진다',
  formGone.rows === 0 && formGone.stored === 0, JSON.stringify(formGone));

// ── 7-e) 큐시트 파일 — 링크 옆에 파일도 (0054 · 사용자 요구 2026-09-08) ────
// 큐시트는 이제 **링크로도 파일로도** 붙는다. 저장 자리는 송폼과 같은 files 표이고
// 갈래만 `kind='cuesheet'`다(0054) — 업로드 길은 그대로 하나다(§6-29-u).
// 여기서 보는 것은 화면이다: 수정 화면 말씀 탭에 고르기 버튼이 서고, 고른 파일이
// 큐시트 갈래로 담기고, 좁은 화면에서 링크 두 칸과 파일 줄이 어긋나지 않는지.
await tabClick('말씀'); await sleep(400);
const cueEdit = await ev(`(() => {
  const box = document.querySelector('.worship-cue-edit');
  if (!box) return null;
  const sec = box.querySelector('.worship-cue-files');
  return {
    label: box.querySelector('.worship-cue-label')?.textContent.trim() || '',
    add: sec?.querySelector('.worship-cue-file-add')?.textContent.trim() || '',
    accept: sec?.querySelector('input[type=file]')?.getAttribute('accept') || '',
    rows: box.querySelectorAll('.worship-cue-file-row').length,
    // 링크 두 칸 **아래**에 파일 줄이 선다
    below: (() => {
      const last = [...box.querySelectorAll('.worship-cue-fields > .worship-field')].pop();
      return !!sec && !!last && sec.getBoundingClientRect().top >= last.getBoundingClientRect().bottom - 1;
    })(),
    // 라벨과 버튼 말고는 아무 줄도 없다(§8 안내 줄 금지)
    text: sec ? sec.innerText.replace(/\\s+/g, ' ').trim() : '',
  };
})()`);
check('수정 화면 말씀 탭에 큐시트 파일 고르기 버튼이 선다',
  !!cueEdit && cueEdit.label === '큐시트' && cueEdit.add === '파일 올리기'
  && cueEdit.rows === 0 && cueEdit.below === true, JSON.stringify(cueEdit));
check('큐시트 파일 칸은 PDF·사진뿐 아니라 문서도 받는다',
  cueEdit.accept.includes('.pdf') && cueEdit.accept.includes('image/*')
  && cueEdit.accept.includes('.docx') && cueEdit.accept.includes('.pptx'), cueEdit.accept);
check('붙은 큐시트 파일이 없어도 사용법 안내 줄이 붙지 않는다',
  cueEdit.text === '파일 파일 올리기', JSON.stringify(cueEdit.text));

// 고른다 — 게스트에는 드라이브가 없어 행만 localStorage에 남는다.
// **되돌리기**: uploadServiceFile에 kind를 안 실으면 이 파일이 송폼으로 저장되어 아래가 깨진다.
await ev(`(() => {
  const el = document.querySelector('.worship-cue-files input[type=file]');
  const dt = new DataTransfer();
  dt.items.add(new File(['%PDF-1.4 cue sheet'], '성탄절 큐시트.pdf', { type: 'application/pdf' }));
  el.files = dt.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(900);
const cueAdded = await ev(`(() => {
  const g = JSON.parse(localStorage.getItem('church_worship_v1'));
  const svc = g.services.find(s => s.kind === '성탄절 예배');
  const mine = (g.files || []).filter(f => f.service_id === svc.id);
  return {
    rows: document.querySelectorAll('.worship-cue-file-row').length,
    name: document.querySelector('.worship-cue-file-name')?.textContent.trim() || '',
    del: !!document.querySelector('.worship-cue-file-row button[aria-label$="삭제"]'),
    stored: mine.map(f => [f.name, f.kind || null]),
    // 찬양 탭의 송폼 줄에는 안 선다 — 갈래가 갈랐다
    songforms: (() => { const sec = document.querySelector('.worship-songforms'); return sec ? sec.querySelectorAll('.worship-songform-row').length : -1; })(),
  };
})()`);
check('고른 큐시트 파일이 files 행에 service_id + kind:cuesheet로 담긴다',
  cueAdded.rows === 1 && cueAdded.name === '성탄절 큐시트.pdf'
  && JSON.stringify(cueAdded.stored) === '[["성탄절 큐시트.pdf","cuesheet"]]'
  && cueAdded.del === true, JSON.stringify(cueAdded));

// 375·414·768·1440 — 링크 두 칸은 **같은 폭**이고, 좁으면 한 열로 쌓이고 파일 줄이 그 아래다.
// 고아 줄도 없다(§6-9-z). **되돌리기**: '큐시트 링크' Field에 wide를 되돌리면 1440에서 두 칸 폭이 갈린다.
const CUE_FIT = `(() => {
  const box = document.querySelector('.worship-cue-edit');
  const grid = box && box.querySelector('.worship-cue-fields');
  if (!grid) return null;
  const fields = [...grid.querySelectorAll(':scope > .worship-field')];
  const head = box.querySelector('.worship-cue-files > div');
  const lines = new Map();
  for (const k of (head ? head.children : [])) {
    const r = k.getBoundingClientRect();
    if (r.width <= 0) continue;
    const key = Math.round((r.top + r.bottom) / 16);
    lines.set(key, (lines.get(key) || 0) + 1);
  }
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    widths: fields.map(f => Math.round(f.getBoundingClientRect().width)),
    // 칸 안의 input이 제 열 폭을 꽉 채우는가
    gaps: fields.map(f => Math.round(f.getBoundingClientRect().width - f.querySelector('input').getBoundingClientRect().width)),
    rows: new Set(fields.map(f => Math.round(f.getBoundingClientRect().top))).size,
    headLines: [...lines.values()],
  };
})()`;
const cueFit = [];
for (const width of [375, 414, 768, 1440]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await sleep(420);
  cueFit.push([width, await ev(CUE_FIT)]);
}
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(420);
const cueFitBad = cueFit.filter(([w, r]) => !r
  || r.overflow > 0                                        // 가로로 넘치지 않는다
  || r.gaps.some(g => g > 1)                               // 칸이 열 폭을 다 쓴다
  || Math.abs(r.widths[0] - r.widths[1]) > 1               // 링크·제목이 같은 폭이다
  || r.cols !== (w < 640 ? 1 : 2)                          // 좁으면 한 열, 넓으면 두 열
  || r.rows !== (w < 640 ? 2 : 1)
  || r.headLines.some(n => n < 2));                        // 파일 줄 머리에 고아가 없다
check('큐시트 링크·제목 칸이 375·414·768·1440에서 열 폭을 꽉 채우고 고아 줄이 없다',
  cueFitBad.length === 0, JSON.stringify(cueFitBad.length ? cueFitBad : cueFit));

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

// 저장하고 보기로 돌아오면 큐시트 카드에 방금 붙인 파일이 서고 **고르기 버튼은 없다**
// (담당자·찬양·광고와 같은 문법 — 붙이고 지우는 것은 수정 화면 것이다).
await tabClick('말씀'); await sleep(400);
const cueViewNew = await ev(`(() => {
  const box = document.querySelector('.worship-cue');
  return {
    card: !!box,
    add: !!document.querySelector('.worship-cue-file-add'),
    rows: box ? box.querySelectorAll('.worship-cue-file-row').length : -1,
    name: box?.querySelector('.worship-cue-file-name')?.textContent.trim() || '',
    del: !!box?.querySelector('.worship-cue-file-row button[aria-label$="삭제"]'),
    // 링크는 안 붙였으니 링크 줄은 없다 — 파일만으로도 카드가 선다
    link: !!box?.querySelector('.worship-cue-row'),
  };
})()`);
check('보기 화면 큐시트에는 파일 줄만 서고 올리기·삭제가 없다',
  cueViewNew.card === true && cueViewNew.add === false && cueViewNew.rows === 1
  && cueViewNew.name === '성탄절 큐시트.pdf' && cueViewNew.del === false
  && cueViewNew.link === false, JSON.stringify(cueViewNew));

await tabClick('담당자'); await sleep(300);
const shownRoles = await ev(`[...document.querySelectorAll('.worship-role-row')].map(x => x.innerText.replace(/\\n+/g, ' | '))`);
check('저장한 담당자가 그대로 보인다',
  shownRoles.length === 3 && shownRoles[0].includes('조해리') && shownRoles[1].includes('한상록 강사님'), JSON.stringify(shownRoles));

// 곡이 하나도 없어도 인도자를 정했으면 팀 줄은 선다(빈 상태는 그 아래 그대로)
await tabClick('찬양'); await sleep(350);
const praiseOnly = await ev(`(() => {
  const head = document.querySelector('.worship-praise-head');
  const empty = document.querySelector('.worship-empty');
  return {
    team: head?.querySelector('.worship-praise-team')?.textContent.trim() || null,
    leader: head?.querySelector('.worship-praise-leader')?.textContent.trim() || null,
    empty: empty ? empty.innerText.trim() : null,
    order: !!head && !!empty && head.getBoundingClientRect().bottom <= empty.getBoundingClientRect().top,
  };
})()`);
check('곡이 없어도 인도자를 정했으면 팀 줄이 서고 빈 상태는 그 아래 그대로',
  praiseOnly.team === 'Re:born 워십' && praiseOnly.leader === '· 인도 김승찬 청년'
  && praiseOnly.empty === '찬양을 아직 정하지 않았어요' && praiseOnly.order === true,
  JSON.stringify(praiseOnly));

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
// 2026-09-05 전에는 예배 전이면 진입 자체가 없었다. 지금은 **들어가서 명단을 미리 보되
// 체크가 잠긴다**(그날 13:30 KST부터 열린다).
check('발행하면 예배 전이라도 출석 화면에 들어갈 수 있다', published.att === true, JSON.stringify(published));

await ev(`document.querySelector('.worship-att-open').click()`); await sleep(800);
const notYet = await ev(`(() => ({
  open: !!document.querySelector('.worship-attendance'),
  badge: document.querySelector('.att-not-yet')?.textContent.trim() || '',
  chips: document.querySelectorAll('.att-chip').length,
  locked: [...document.querySelectorAll('.att-chip')].every(c => c.disabled),
  addLocked: document.querySelector('.att-add-open')?.disabled,
}))()`);
check('예배 전에는 명단은 보이되 체크가 잠기고 그 이유를 말한다',
  notYet.open === true && notYet.chips > 0 && notYet.locked === true
  && notYet.badge === '아직 예배 전이에요' && notYet.addLocked === true, JSON.stringify(notYet));
await ev(`${byText('주보로')}.click()`); await sleep(700);
await waitFor(HAS_DETAIL); await waitFor(HAS_EDIT);

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

// 송폼도 같다 — 발행본에 붙은 파일은 읽고 열 수 있고, 붙이거나 지울 수는 없다.
// 화면이 감추는 것이고 경계는 RLS다(0047의 files_insert·files_delete가 can_edit_service).
await ev(`[...document.querySelectorAll('.worship-tab')].find(t => t.textContent.trim() === '찬양').click()`);
await sleep(350);
const plainForm = await ev(`(() => {
  const sec = document.querySelector('.worship-songforms');
  if (!sec) return null;
  return { rows: sec.querySelectorAll('.worship-songform-row').length,
    open: !!sec.querySelector('.worship-songform-open'),
    add: !!sec.querySelector('.worship-songform-add'),
    input: !!sec.querySelector('input[type=file]'),
    del: !!sec.querySelector('button[aria-label$="삭제"]') };
})()`);
check('자격이 없으면 송폼은 읽고 열기만 — 올리기 칸도 삭제도 없다',
  !!plainForm && plainForm.rows === 1 && plainForm.open === true
  && plainForm.add === false && plainForm.input === false && plainForm.del === false,
  JSON.stringify(plainForm));

await ev(plant({ canEdit: false, canCheckAll: false, ledGroupIds: ['g1'], canCheck: true }));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1400);
await ev(GO); await sleep(1200);
await ev(`document.querySelector('.worship-card').click()`); await sleep(1200);
await waitFor(HAS_ATT); await ev(`document.querySelector('.worship-att-open').click()`); await sleep(700);
const sunjang = await ev(`(() => {
  const secs = [...document.querySelectorAll('.worship-attendance section')].filter(s => s.querySelector('.att-group-head'));
  return secs.map(s => [s.querySelector('.att-group-head').innerText.replace(/\\s+/g, ' ').replace(/ \\d+\\/\\d+$/, ''),
    [...s.querySelectorAll('.att-chip')].every(c => !c.disabled)]);
})()`);
// 전도사님·부장님 묶음도 남의 순과 같다 — 순장은 자기 순 청년만 만진다(0053)
check('순장은 자기 순만 누를 수 있고 나머지는 보이되 비활성',
  JSON.stringify(sunjang) === '[["전도사님",false],["부장님",false],["꼬순",true],["TT순",false]]', JSON.stringify(sunjang));

// **순장도 출석 메모를 남긴다**(사용자 결정 2026-09-06: "출석 메모는 주보를 편집하는
// 건 아니라고 생각해서"). 잠깐 주보 편집 자격자에게만 세웠던 칸이다 — 저장 자리가 주보
// 행이라(services.attendance_note → saveService → can_edit_service) 순장이 쓰면 한 글자도
// 안 남았기 때문이다. 지금은 **그 한 칸만 쓰는 rpc**로 간다(0052 set_attendance_note)라
// 화면 게이트도 출석 자격(canCheck)과 같다.
const sunjangNote = await ev(`(() => ({
  box: !!document.querySelector('.att-note-box'),
  head: document.body.innerText.includes('출석 메모'),
}))()`);
check('순장도 출석 메모 칸이 선다', sunjangNote.box === true && sunjangNote.head === true,
  JSON.stringify(sunjangNote));
// 칸만 서고 저장이 안 되면 예전과 같은 상태다 — 실제로 주보 행에 남는지까지 본다
await ev(typeIn('.att-note-box', '순장이 남긴 메모', 'HTMLTextAreaElement'));
await sleep(400);
await ev(`document.querySelector('.att-note-save').click()`); await sleep(900);
const sunjangSaved = await ev(NOTE_STATE);
check('순장이 쓴 메모가 그 주보에 저장되고 읽기 모드로 선다',
  sunjangSaved.stored === '순장이 남긴 메모' && sunjangSaved.state === '저장되었어요'
  && sunjangSaved.read === true, JSON.stringify(sunjangSaved));

// **순장이 올린 사람도 명단·순 편성을 건드리지 않는다**(0053 · 사용자 결정 2026-09-07).
// 예전에는 people에 행을 만들고 순장이면 자기 순(group_members)에까지 넣었다(0050) —
// 출석을 부르다 잘못 적은 이름이 그대로 청년 명단에 남았고 지우는 길이 화면에 없었다.
// **되돌리기**: worshipView의 addGuest를 addRosterPerson+addToSun 길로 되돌리면 깨진다.
await ev(`document.querySelector('.att-add-open').click()`); await sleep(300);
await ev(typeIn('input[aria-label="미등록 출석자 이름"]', '한새싹'));
await sleep(200);
await ev(`${byText('추가')}.click()`); await sleep(900);
const sunAdd = await ev(`(() => {
  const g = JSON.parse(localStorage.getItem('church_worship_v1'));
  const secs = [...document.querySelectorAll('.worship-attendance section')].filter(s => s.querySelector('.att-group-head'));
  const sun = secs.find(s => s.querySelector('.att-group-head').innerText.includes('꼬순'));
  return {
    people: g.people.length,
    members: (g.group_members || []).length,
    rows: (g.attendance_guests || []).map(x => x.name),
    guests: [...document.querySelectorAll('.att-guest')].map(c => c.textContent.trim()),
    canDelete: [...document.querySelectorAll('.att-guest-del')].every(b => !b.disabled),
    head: sun?.querySelector('.att-group-head')?.innerText.replace(/\\s+/g, ' ') || '',
  };
})()`);
check('순장이 올려도 명단·순 편성은 그대로다',
  sunAdd.people === 8 && sunAdd.members === 4 && sunAdd.head.includes('꼬순 1/3'), JSON.stringify(sunAdd));
check('그 예배의 손님으로만 서고 순장도 지울 수 있다',
  JSON.stringify(sunAdd.rows) === '["한새싹"]' && JSON.stringify(sunAdd.guests) === '["한새싹"]'
  && sunAdd.canDelete === true, JSON.stringify(sunAdd));

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

// 노트 도구 줄 — 375에서 공유 토글만 다음 줄 **오른쪽 끝**에 혼자 서서 저장 버튼과
// 어긋나던 자리다(사용자 지적 2026-09-07). 지금은 의도된 두 줄이고, 둘째 줄의 토글이
// **왼쪽부터 폭을 채운다**. 640 위에서는 한 줄이다.
// **되돌리기**: NOTE_TOOLS를 `flex flex-wrap` + 토글 `shrink-0`으로 되돌리면 깨진다.
const TOOLS_AT = `(() => {
  const row = document.querySelector('.worship-note-tools');
  const t = row && row.querySelector('.share-toggle');
  const first = row && row.querySelector('button');
  if (!row || !t || !first) return null;
  const r = row.getBoundingClientRect(), tr = t.getBoundingClientRect(), fr = first.getBoundingClientRect();
  return {
    sameRow: Math.round(tr.top) < Math.round(fr.bottom) - 2,
    leftGap: Math.round(tr.left - r.left),
    rightGap: Math.round(r.right - tr.right),
  };
})()`;
const toolsMob = await ev(TOOLS_AT);
check('375 — 공유 토글은 둘째 줄에서 왼쪽부터 오른쪽 끝까지 채운다',
  !!toolsMob && toolsMob.sameRow === false && Math.abs(toolsMob.leftGap) <= 1 && Math.abs(toolsMob.rightGap) <= 1,
  JSON.stringify(toolsMob));
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 780, deviceScaleFactor: 1, mobile: false });
await sleep(500);
const toolsWide = await ev(TOOLS_AT);
check('1024 — 저장·칩·토글이 한 줄이고 토글이 오른쪽 끝에 선다',
  !!toolsWide && toolsWide.sameRow === true && Math.abs(toolsWide.rightGap) <= 1 && toolsWide.leftGap > 100,
  JSON.stringify(toolsWide));
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await sleep(500);

// 송폼 줄도 375에서 한 열로 서고 넘치지 않는다 — 파일 이름이 길어도 줄 안에서
// 접힌다(min-w-0 + break-words). 이름이 잘려 나가면 어느 파일인지 알 수 없다.
await tabClick('찬양'); await sleep(400);
const mobForm = await ev(`(() => {
  const sec = document.querySelector('.worship-songforms');
  const row = sec?.querySelector('.worship-songform-row');
  if (!row) return null;
  const r = row.getBoundingClientRect();
  const name = row.querySelector('.worship-songform-name');
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    right: Math.round(r.right), vw: innerWidth,
    // 이름·크기가 아이콘 오른쪽에 한 덩이로 쌓인다(줄 자체는 한 줄이다)
    nameFits: name.scrollWidth <= name.clientWidth + 1,
    open: !!row.querySelector('.worship-songform-open'),
  };
})()`);
check('모바일 375px — 송폼 줄이 가로로 넘치지 않고 이름이 잘리지 않는다',
  !!mobForm && mobForm.overflow <= 0 && mobForm.right <= mobForm.vw
  && mobForm.nameFits === true && mobForm.open === true, JSON.stringify(mobForm));
await tabClick('말씀'); await sleep(300);

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

// 새 주보 생성기 — 375px에서는 종류가 한 줄을 통째로 쓰고(잘리지 않게), 이름이 그 아래,
// 날짜와 두 버튼이 **같은 줄**에 선다. 버튼만 따로 한 줄에 남으면 안 된다(사용자 지적
// 2026-09-08: 예전 한 줄 생성기는 375에서 종류가 잘리고 나머지가 흩어져 보였다).
await ev(`document.querySelector('.worship-new-open').click()`); await sleep(500);
const mobProbe = `(() => {
  const box = document.querySelector('.worship-new');
  const opts = [...box.querySelectorAll('.worship-kind-opt')];
  const name = box.querySelector('input[aria-label="예배 이름"]');
  const date = box.querySelector('.worship-new-date button');
  const make = box.querySelector('.worship-new-make');
  const cancel = box.querySelector('.worship-new-cancel');
  const bottom = (e) => Math.round(e.getBoundingClientRect().bottom);
  return {
    kinds: opts.map(o => o.textContent.trim()),
    clipped: opts.filter(o => o.scrollWidth - o.clientWidth > 1).map(o => o.textContent.trim()),
    // 종류 세그먼트는 카드 폭을 다 쓴다(한 칸에 몰아 두면 글자가 잘린다)
    segFull: Math.round(box.querySelector('.worship-kind-seg').getBoundingClientRect().width)
      >= Math.round(box.getBoundingClientRect().width) - 32,
    lastRow: [date, make, cancel].map(bottom),
    nameRow: name ? bottom(name) : null,
    cancelRight: Math.round(box.getBoundingClientRect().right - cancel.getBoundingClientRect().right),
    rows: new Set([...opts.map(bottom), ...(name ? [bottom(name)] : []), bottom(date), bottom(make), bottom(cancel)]).size,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`;
const mobNew = await ev(mobProbe);
check('모바일 375px — 종류 세그먼트가 한 줄을 다 쓰고 라벨이 잘리지 않는다',
  JSON.stringify(mobNew.kinds) === '["주일예배","다른 예배"]' && mobNew.clipped.length === 0
  && mobNew.segFull === true, JSON.stringify(mobNew));
check('모바일 375px — 날짜와 두 버튼이 같은 줄에 선다(버튼만 남는 줄이 없다)',
  new Set(mobNew.lastRow).size === 1 && mobNew.rows === 2 && mobNew.overflow <= 0, JSON.stringify(mobNew));
check('모바일에서도 취소는 그 줄의 오른쪽 끝이다', mobNew.cancelRight <= 16, `${mobNew.cancelRight}px`);
// 이름 칸이 붙으면 한 줄만 늘어난다(종류 / 이름 / 날짜·버튼)
await ev(`[...document.querySelectorAll('.worship-kind-opt')].find(b => b.dataset.kind === 'other').click()`);
await sleep(350);
const mobOther = await ev(mobProbe);
check('모바일 375px — 이름 칸이 붙어도 세 줄이고 가로로 넘치지 않는다',
  mobOther.rows === 3 && new Set(mobOther.lastRow).size === 1 && mobOther.overflow <= 0, JSON.stringify(mobOther));
await ev(`document.querySelector('.worship-new-cancel').click()`); await sleep(300);

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

// 편집 폼이 **폭을 채우는지**도 같은 자리에서 잰다. 46rem 상한이 있던 때는 1440px에서
// 폼이 736px에서 멈춰 오른쪽 672px이 통째로 비었다(사용자 결정 2026-09-05: "다 반응형으로
// 메워야 한다"). 두 가지를 본다:
//   · panelGap — 폼 컨테이너가 탭 판 폭을 다 쓰는가
//   · rowGap — **첫 입력 줄**의 오른쪽 끝이 그 컨테이너 오른쪽에서 24px 이내인가
// 줄 상자(li·grid 칸)는 내용과 상관없이 늘어나므로 **줄 안의 컨트롤**로 잰다 — 그래야
// '상자만 넓고 칸은 왼쪽에 몰린' 상태가 조용히 통과하지 않는다.
const FILLS = `(() => {
  const panel = document.querySelector('.worship-tabpanel');
  const box = panel && panel.firstElementChild;
  if (!box) return null;
  const ctl = [...box.querySelectorAll('input, textarea, button, .worship-song-linkbox')]
    .filter(e => e.getBoundingClientRect().width > 0);
  if (!ctl.length) return null;
  const top = Math.min(...ctl.map(e => Math.round(e.getBoundingClientRect().top)));
  const first = ctl.filter(e => Math.round(e.getBoundingClientRect().top) - top < 10);
  const b = box.getBoundingClientRect();
  return {
    panelGap: Math.round(panel.getBoundingClientRect().right - b.right),
    rowGap: Math.round(b.right - Math.max(...first.map(e => e.getBoundingClientRect().right))),
    n: first.length,
  };
})()`;

const respRows = [];
const fillRows = [];
for (const width of [375, 414, 768, 1024, 1440]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await sleep(450);
  for (const tab of ['말씀', '담당자', '찬양', '광고']) {
    await tabClick(tab); await sleep(320);
    const r = await ev(RESP);
    respRows.push([width, tab, r && r.overflow, r && r.narrow, r && r.outside, r && r.n]);
    const f = await ev(FILLS);
    fillRows.push([width, tab, f && f.panelGap, f && f.rowGap, f && f.n]);
  }
}
const respBad = respRows.filter(r => !(r[2] <= 0 && r[3] >= 60 && r[4] === 0 && r[5] > 0));
check('편집 탭 네 개가 375·414·768·1024·1440에서 넘치지 않고 칸이 짜부라지지 않는다',
  respBad.length === 0, JSON.stringify(respBad.length ? respBad : respRows.filter(r => r[0] === 375)));
const fillBad = fillRows.filter(r => !(r[2] !== null && r[2] <= 1 && r[3] <= 24 && r[4] > 0));
check('편집 폼이 탭 판 폭을 다 쓰고 첫 입력 줄이 오른쪽 끝에 닿는다(빈 곳 없음)',
  fillBad.length === 0, JSON.stringify(fillBad.length ? fillBad : fillRows.filter(r => r[0] === 1440)));

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
    // 탭바 **위에 딱 붙는다**. 상수(4.5rem)로 앉히면 탭바의 실제 높이(안 내용으로 정해진다)와
    // 몇 px 어긋나 그 사이에 얇은 띠가 보인다(사용자 지적 2026-09-08).
    tabBarGap: (() => {
      const nav = document.querySelector('nav[data-tab-bar]');
      return nav ? Math.round(nav.getBoundingClientRect().top - r.bottom) : null;
    })(),
  };
})()`);
check('모바일에서는 저장·삭제가 화면 아래 고정 줄에 있다',
  !!mobBar && mobBar.shown === true && mobBar.fixed === true && mobBar.full === true
  && JSON.stringify(mobBar.buttons) === '["저장","삭제"]', JSON.stringify(mobBar));
check('고정 줄은 하단 탭바 위에 앉고, 머리줄 버튼은 모바일에서 숨는다',
  !!mobBar && mobBar.bottomGap >= 60 && mobBar.headSave === true, JSON.stringify(mobBar));
// **틈 0px** — 탭바가 잰 제 높이(`--mobile-tab-bar-h`)로 앉기 때문이다.
// **되돌리기**: bottom을 `calc(4.5rem + env(safe-area-inset-bottom))`로 되돌리면 4px쯤 벌어진다.
check('375 — 편집 줄이 하단 탭바와 틈 없이 맞닿는다',
  !!mobBar && mobBar.tabBarGap === 0, JSON.stringify(mobBar));

// 송폼은 찬양 탭의 **맨 아래**에 있다 — 끝까지 내렸을 때 그 구역이 고정 도구 줄에
// 가리면 '파일 올리기'를 누를 수 없다(화면 아래 pb-24가 그 자리를 비워 둔다).
await tabClick('찬양'); await sleep(450);
const mobFormBar = await ev(`(() => {
  const sec = document.querySelector('.worship-songforms');
  const bar = document.querySelector('.worship-edit-bar');
  if (!sec || !bar) return null;
  let sc = sec.parentElement;
  while (sc && sc !== document.body && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
  const box = (sc && sc !== document.body) ? sc : document.scrollingElement;
  box.scrollTop = box.scrollHeight;
  const add = sec.querySelector('.worship-songform-add');
  return {
    gap: Math.round(bar.getBoundingClientRect().top - sec.getBoundingClientRect().bottom),
    addGap: add ? Math.round(bar.getBoundingClientRect().top - add.getBoundingClientRect().bottom) : null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`);
check('모바일 편집 — 송폼 구역이 하단 저장 줄에 가리지 않는다',
  !!mobFormBar && mobFormBar.gap >= 0 && mobFormBar.addGap >= 0 && mobFormBar.overflow <= 0,
  JSON.stringify(mobFormBar));

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

// ── 15) 발행본 보기 — 말씀이 어느 폭에서도 넘치지 않고 판 폭을 쓴다 ────────
// 사용자 요청 2026-09-06: "말씀 나오는 부분도 반응형 잘 적용되게". 편집 폼은 회차 9-a에서
// 폭을 채웠는데 **보기 화면의 본문**은 42rem에 묶여 있어 1440에서 오른쪽 726px이 비었다
// (§6-9-k). 지금은 상자가 판 폭을 다 쓰고 넓어지면 두 단으로 흐른다.
const WORD_AT = `(() => {
  const panel = document.querySelector('.worship-tabpanel');
  const body = document.querySelector('.worship-passage');
  const cols = document.querySelector('.worship-passage-cols');
  const verse = document.querySelector('.worship-verse');
  if (!panel || !body || !verse) return null;
  const w = (e) => Math.round(e.getBoundingClientRect().width);
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    outside: [...panel.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length,
    panel: w(panel), body: w(body), verse: w(verse),
    cols: cols ? Number(getComputedStyle(cols).columnCount) || 1 : 0,
  };
})()`;
const wordAt = {};
for (const width of [375, 768, 1024, 1440]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await sleep(450);
  await tabClick('말씀'); await sleep(420);
  wordAt[width] = await ev(WORD_AT);
}
await send('Emulation.clearDeviceMetricsOverride');
await sleep(400);
const wordBad = Object.entries(wordAt).filter(([, v]) => !v || v.overflow > 0 || v.outside > 0
  || Math.abs(v.panel - v.body) > 1);
check('발행본 말씀은 375~1440에서 넘치지 않고 본문이 판 폭을 그대로 쓴다',
  wordBad.length === 0, JSON.stringify(wordBad.length ? wordBad : wordAt));
// 폭을 다 쓰되 **읽는 폭**은 지킨다 — 좁으면 한 단, 넓으면 두 단이고 한 단은 720px 이하다
// 한 단의 상한은 **실측에서 온다**: 768에서 한 단이 726px(≈52자)이고, 1024부터 두 단이
// 되어 471·684px이다. 그보다 넓은 한 줄은 눈이 다음 줄 머리를 잃는다.
const measureBad = Object.entries(wordAt).filter(([w, v]) => !v || v.verse > 730 || v.verse < 300
  || v.cols !== (Number(w) >= 1024 ? 2 : 1));
check('좁으면 한 단 · 1024부터 두 단, 한 단은 읽는 폭 안에 머문다',
  measureBad.length === 0,
  JSON.stringify(Object.entries(wordAt).map(([w, v]) => [w, v && v.cols, v && v.verse])));

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

// ── 16) 줄바꿈 고아 · 큐시트 · 목록 출석 수 (2026-09-07) ────────────────────
// **한 줄에 하나만 서 있는 줄이 고아다.** 유튜브 가져오기 버튼이 좁은 화면에서 둘째 줄
// 오른쪽에 혼자 섰고(사용자 지적), 담당자·찬양 줄의 순서 도구도 같은 모양이었다.
// 재는 것은 '줄마다 몇 개가 서 있나'다 — `items-center`라 가운데선으로 줄을 가른다.
// **되돌리기**: worship-song-import를 `flex-wrap` + `basis-full`로 되돌리면 375에서 [1,1]이 나온다.
const ORPHAN = (sel) => `(() => {
  const rows = [...document.querySelectorAll(${JSON.stringify(sel)})].slice(0, 2);
  return rows.map(row => {
    const lines = new Map();
    for (const k of row.children) {
      const r = k.getBoundingClientRect();
      if (r.width <= 0) continue;
      const key = Math.round((r.top + r.bottom) / 16);
      lines.set(key, (lines.get(key) || 0) + 1);
    }
    return [...lines.values()];
  });
})()`;

await ev(plant(null));
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1400);
await ev(GO); await waitFor(HAS_CARD);
await ev(`document.querySelector('.worship-card').click()`); await waitFor(HAS_DETAIL);
await waitFor(HAS_EDIT);
await ev(`document.querySelector('.worship-edit-open').click()`); await sleep(900);

const orphanRows = [];
for (const width of [375, 414, 768, 1440]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await sleep(420);
  await tabClick('찬양'); await sleep(380);
  orphanRows.push([width, '가져오기', await ev(ORPHAN('.worship-song-import'))]);
  orphanRows.push([width, '찬양 줄', await ev(ORPHAN('.worship-song-row'))]);
  await tabClick('담당자'); await sleep(380);
  orphanRows.push([width, '담당자 줄', await ev(ORPHAN('.worship-role-edit'))]);
}
const orphanBad = orphanRows.filter(([, , rows]) => !rows.length || rows.some(lines => lines.some(n => n < 2)));
check('편집 줄에 혼자 서는 도막이 없다(가져오기 버튼·순서 도구)',
  orphanBad.length === 0, JSON.stringify(orphanBad.length ? orphanBad : orphanRows.filter(r => r[0] === 375)));
// 좁은 화면에서는 라벨이 '가져오기'로 줄고 전체 문구는 title에 남는다(기능을 숨기지 않는다 · §8)
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await sleep(400); await tabClick('찬양'); await sleep(380);
const pullNarrow = await ev(`(() => {
  const b = document.querySelector('.worship-song-pull');
  return { label: b.innerText.replace(/\\s+/g, ' ').trim(), title: b.title };
})()`);
check('좁은 화면의 가져오기 버튼은 라벨만 줄고 전체 문구는 title에 남는다',
  pullNarrow.label === '가져오기' && pullNarrow.title === '유튜브 재생목록에서 가져오기', JSON.stringify(pullNarrow));

// 찬양 줄이 두 줄로 접힐 때(640 미만) **둘째 줄은 번호 칸 밑에서 시작하지 않는다** —
// 링크 칸이 x=12에서 시작해 제목 칸(x=38)과 왼쪽이 어긋났다(실측 2026-09-08).
// **되돌리기**: worship-song-linkbox의 `ml-[1.625rem] sm:ml-0`을 빼면 26px 어긋난다.
const songIndent = await ev(`(() => {
  const row = document.querySelector('.worship-song-row');
  if (!row) return null;
  const t = row.querySelector('input[aria-label="찬양 제목"]');
  const b = row.querySelector('.worship-song-linkbox');
  if (!t || !b) return null;
  const tr = t.getBoundingClientRect(), br = b.getBoundingClientRect();
  return { titleLeft: Math.round(tr.left), boxLeft: Math.round(br.left), wrapped: Math.round(br.top - tr.top) > 8 };
})()`);
check('좁은 화면에서 접힌 찬양 줄의 링크 칸이 제목 칸과 왼쪽을 맞춘다',
  !!songIndent && songIndent.wrapped === true && songIndent.titleLeft === songIndent.boxLeft,
  JSON.stringify(songIndent));

// 큐시트 — 링크 한 칸(0053)과 파일(0054)을 **한 카드**에 세운다.
// **되돌리기**: CueSheetEdit의 docEmbedKind 게이트를 빼면 아무 주소나 담겨 첫 검사가 깨진다.
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400); await tabClick('말씀'); await sleep(420);
await ev(typeIn('input[aria-label="큐시트 링크"]', 'https://example.com/cue'));
await sleep(1500);
const cueBad = await ev(`(() => ({
  msg: document.querySelector('.worship-cue-bad')?.textContent.trim() || '',
  stored: JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.id === 's1').cue_sheet || null,
}))()`);
check('구글 문서·시트 링크가 아니면 그 자리에서 말하고 담지 않는다',
  cueBad.msg === '구글 문서·시트 링크만 붙일 수 있어요' && !cueBad.stored, JSON.stringify(cueBad));

await ev(typeIn('input[aria-label="큐시트 링크"]', 'https://docs.google.com/document/d/abc123/edit'));
await sleep(250);
await ev(typeIn('input[aria-label="큐시트 제목"]', '9월 6일 큐시트'));
await sleep(1600);
const cueOk = await ev(`(() => ({
  msg: !!document.querySelector('.worship-cue-bad'),
  stored: JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.id === 's1').cue_sheet || null,
}))()`);
check('구글 문서 링크와 제목이 주보 행의 한 칸에 담긴다',
  cueOk.msg === false && String(cueOk.stored?.url).includes('docs.google.com')
  && cueOk.stored?.title === '9월 6일 큐시트', JSON.stringify(cueOk));

// 큐시트에는 비밀번호가 없다(사용자 결정 2026-09-08) — 편집 칸도 잠금 표시도 없어야 한다
check('큐시트에는 비밀번호 칸이 없다', await ev(`!document.querySelector('input[aria-label="큐시트 비밀번호"]') && !document.querySelector('.worship-cue-lock')`));

await ev(`${byText('저장')}.click()`); await sleep(1000);
await tabClick('말씀'); await sleep(420);
const cueView = await ev(`(() => {
  const box = document.querySelector('.worship-cue');
  if (!box) return null;
  const fileRow = box.querySelector('.worship-cue-file-row');
  return { label: box.querySelector('.worship-cue-label')?.textContent.trim() || '',
    title: box.querySelector('.worship-cue-title')?.textContent.trim() || '',
    open: box.querySelector('.worship-cue-open')?.textContent.trim() || '',
    files: box.querySelectorAll('.worship-cue-file-row').length,
    fileName: fileRow?.querySelector('.worship-cue-file-name')?.textContent.trim() || '',
    fileMeta: fileRow?.querySelector('.worship-cue-file-meta')?.textContent.trim() || '',
    fileOpen: fileRow?.querySelector('.worship-cue-file-open')?.textContent.trim() || '',
    // 링크 줄과 파일 줄은 **한 카드 안에 세로로** 선다(카드를 갈라 두지 않는다)
    stacked: (() => {
      const link = box.querySelector('.worship-cue-row');
      return !!link && !!fileRow
        && fileRow.getBoundingClientRect().top >= link.getBoundingClientRect().bottom - 1;
    })(),
    overflow: Math.round(box.getBoundingClientRect().right - document.querySelector('.worship-tabpanel').getBoundingClientRect().right) };
})()`);
check('보기 모드에서는 제목과 열기가 한 줄로 선다',
  !!cueView && cueView.label === '큐시트' && cueView.title === '9월 6일 큐시트'
  && cueView.open === '열기' && cueView.overflow <= 0, JSON.stringify(cueView));
// 링크와 파일이 **한 카드**에 같이 선다(사용자 요구 2026-09-08 "링크로도 걸 수 있게
// 해주고, 파일 업로드로도 첨부할 수 있게도"). 파일 줄의 크기 표기는 송폼·업무 첨부와
// 한 벌이다(components/fileRow.jsx).
// **되돌리기**: CueSheetView에 files를 안 넘기면 파일 줄이 사라져 이 검사가 깨진다.
check('큐시트 카드에 링크 줄과 파일 줄이 같이 선다',
  !!cueView && cueView.files === 1 && cueView.fileName === '9월 6일 큐시트.pdf'
  && cueView.fileMeta === '512 KB' && cueView.fileOpen === '보기' && cueView.stacked === true,
  JSON.stringify(cueView));
// 파일 줄은 송폼과 **같은 창**으로 열린다(FilePreviewModal · 첨부와 한 벌)
await ev(`document.querySelector('.worship-cue-file-open').click()`); await sleep(800);
const cuePrev = await ev(`(() => {
  // 미리보기 창은 첨부와 같은 부품이라(FilePreviewModal) 전용 클래스가 없다 —
  // 화면을 덮는 상자 중 그 파일 이름을 머리에 단 것을 찾는다.
  const m = [...document.querySelectorAll('div.fixed.inset-0')]
    .find(d => d.innerText.includes('9월 6일 큐시트.pdf'));
  return { open: !!m, close: !!m && !!m.querySelector('button[title="닫기"]') };
})()`);
check('큐시트 파일 줄을 누르면 송폼과 같은 미리보기 창이 열린다',
  cuePrev.open === true && cuePrev.close === true, JSON.stringify(cuePrev));
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(500);

// 목록 카드의 출석 수 — **지난 발행본에만** 붙는다(오늘·앞으로 올 예배의 '0명'은 뜻이 없다).
// 카드마다 세지 않고 표를 한 번씩 읽어 센다(worship.fetchAttendanceCounts).
await ev(`${byText('목록으로')}.click()`); await sleep(1000);
const listAtt = await ev(`(() => [...document.querySelectorAll('.worship-card')].map(c => [
  c.querySelector('.worship-card-title')?.textContent.trim(),
  c.querySelector('.worship-card-att')?.textContent.trim() || null,
]))()`);
check('지난 발행본 카드에 출석 수가 붙는다',
  JSON.stringify(listAtt) === JSON.stringify([['흔들리지 않는 기쁨', '출석 1명'], ['깨어 기도하라', null]]),
  JSON.stringify(listAtt));

// ── 17) 딥링크 · 썸네일 자리 (2026-09-07) ──────────────────────────────────
// 알림에서 온 `/?p=worship&s=<주보 id>`는 목록이 아니라 **그 주보 상세**를 연다(0053의
// notifications.link). 주소의 나머지 값은 App이 주소를 정리하면서 사라지므로,
// entryQuery가 모듈 로드 때 붙잡아 두고 화면이 마운트되며 가져간다.
// **되돌리기**: worshipView의 takeEntryParam('s') 이펙트를 지우면 목록에서 멈춘다.
await ev(plant(null));
await send('Page.navigate', { url: `${URL_BASE}/?p=worship&s=s2` });
await wait('Page.loadEventFired'); await sleep(1800);
await waitFor(HAS_DETAIL, 8000);
const deep = await ev(`(() => ({
  detail: !!document.querySelector('.worship-detail'),
  title: document.querySelector('.worship-tabpanel h3')?.textContent.trim() || '',
  search: window.location.search,
}))()`);
check('알림 딥링크(?p=worship&s=…)가 그 주보 상세를 연다',
  deep.detail === true && deep.title === '깨어 기도하라', JSON.stringify(deep));
// 같은 주소로 두 번 열리지 않는다 — takeEntryParam이 한 번 읽고 지운다
await ev(`${byText('목록으로')}?.click()`); await sleep(900);
const deepAgain = await ev(`!!document.querySelector('.worship-detail')`);
check('한 번 읽은 딥링크는 목록으로 나온 뒤 다시 열리지 않는다', deepAgain === false, String(deepAgain));

// 썸네일 자리 — 그림이 도착하기 전에도 같은 크기의 상자가 자리를 지키고, 도착하면
// 짧게 밝아진다(뿅 뜨지 않게). **되돌리기**: img를 감싸개 없이 그대로 두면 상자가 없다.
await ev(`document.querySelector('.worship-card')?.click()`); await waitFor(HAS_DETAIL);
await tabClick('찬양'); await sleep(500);
const thumb = await ev(`(() => {
  const box = document.querySelector('.worship-song-thumbbox');
  const img = box && box.querySelector('.worship-song-thumb');
  if (!img) return null;
  const b = box.getBoundingClientRect(), cs = getComputedStyle(img);
  return { w: Math.round(b.width), h: Math.round(b.height),
    fades: cs.transitionProperty.includes('opacity') && parseFloat(cs.transitionDuration) > 0,
    opacity: Number(cs.opacity) };
})()`);
check('썸네일은 같은 크기 상자 안에서 짧게 밝아진다(자리를 먼저 잡는다)',
  !!thumb && thumb.w === 64 && thumb.h === 36 && thumb.fades === true, JSON.stringify(thumb));

// ── 18) 스켈레톤은 목록이 설 자리를 그대로 잡는다 (2026-09-08) ──────────────
// 첫 진입 스켈레톤에 거르기 칩 줄이 없어서, 목록이 도착하는 순간 카드가 통째로 42px쯤
// 아래로 뛰었다. 스켈레톤은 '기다리는 그림'이 아니라 **자리를 지키는 그림**이다
// (홈 카드가 자리마다 따로 서는 것과 같은 판단).
// **읽기만 하는 사람으로 잰다** — '작성 중인 주보 N건' 줄은 자격과 초안 수가 정하는
// 값이라 스켈레톤이 미리 알 수 없다(비워 두면 초안이 없는 사람에게 빈 띠가 남는다).
// **되돌리기**: worshipView의 LOADING에서 `.worship-loading-chips` 줄을 빼면 40px 넘게 어긋난다.
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await ev(plant({ canEdit: false, canCheckAll: false, ledGroupIds: [], canCheck: false }));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1400);
// **재는 것은 카드가 아니라 카드 격자다** — `.worship-card`는 `.dc-card` 등장 연출로
// 5px 내려온 채 그려지는 프레임이 있어서(§4.2) 그 값으로 견주면 늘 5px 어긋난다.
// 스켈레톤은 게스트에서 **한 프레임**만 서 있다(localStorage는 곧바로 답한다) — rAF로 훑으면
// 그 사이에 목록이 끼어들어 못 보는 판이 있다(기계가 느릴 때 실제로 null이 나왔다). 그래서
// 누르기 **전에** MutationObserver를 심어 스켈레톤이 문서에 꽂히는 그 순간 자리를 적는다(tests/home.mjs와 같은 방식).
const skelFit = await ev(`(async () => {
  let skel = null, chips = null, card = null;
  const ob = new MutationObserver(() => {
    if (skel !== null) return;
    const g = document.querySelector('.worship-loading-cards');
    if (g) { skel = Math.round(g.getBoundingClientRect().top); chips = !!document.querySelector('.worship-loading-chips'); }
  });
  ob.observe(document.body, { childList: true, subtree: true });
  ${byText('예배')}.click();
  for (let i = 0; i < 120 && card === null; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const g2 = document.querySelector('.worship-list .grid');
    if (g2 && document.querySelector('.worship-card')) card = Math.round(g2.getBoundingClientRect().top);
  }
  ob.disconnect();
  return { skel, chips, card };
})()`, true);
check('첫 진입 스켈레톤이 목록 카드가 설 자리를 그대로 잡는다(칩 줄 포함)',
  skelFit.chips === true && skelFit.skel !== null && skelFit.card !== null
  && Math.abs(skelFit.skel - skelFit.card) <= 4, JSON.stringify(skelFit));

// ── 19) 출석 메모도 트랙을 다 쓴다 (§6-9-k) ────────────────────────────────
// `max-w-[42rem]`이던 때는 1440에서 이 구역만 672px에서 멈춰 오른쪽 726px이 비었다 —
// 같은 화면의 순 묶음·손님 줄은 이미 폭을 다 쓰고 있었다(주보 편집 폼 46rem · 본문
// 42rem에 이어 세 번째다). **되돌리기**: att-note에 max-w를 다시 붙이면 깨진다.
await ev(plant(null));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1400);
await ev(GO); await waitFor(HAS_CARD);
await ev(`document.querySelector('.worship-card').click()`); await waitFor(HAS_DETAIL);
await waitFor(HAS_ATT); await ev(`document.querySelector('.worship-att-open').click()`); await sleep(800);
const attFill = await ev(`(() => {
  const s = document.querySelector('.att-note'), g = document.querySelector('.att-guests');
  if (!s || !g) return null;
  return { note: Math.round(s.getBoundingClientRect().width), guests: Math.round(g.getBoundingClientRect().width) };
})()`);
check('출석 메모 구역이 출석 화면의 폭을 다 쓴다',
  !!attFill && attFill.note === attFill.guests && attFill.note > 1000, JSON.stringify(attFill));

// ── 20) 본문이 오기 전 자리도 글 덩이 모양이다 (2026-09-08) ────────────────
// 글자 한 줄('본문을 받는 중')로 두면 본문이 도착할 때 아래 것들이 통째로 밀린다 —
// 말씀 화면이 2026-09-01에 같은 지적('출렁임')을 받고 PassageSkeleton으로 고친 자리인데
// 주보 쪽만 옛 모양으로 남아 있었다. **되돌리기**: PassageBody의 대기 갈래를 <p> 한 줄로
// 돌리면 `.worship-passage-wait`이 사라져 이 줄이 깨진다.
await ev(plant(null));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1400);
await ev(GO); await waitFor(HAS_CARD);
const waitBox = await ev(`(async () => {
  document.querySelector('.worship-card').click();
  let seen = null;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const el = document.querySelector('.worship-passage-wait');
    if (el && seen === null) seen = { h: Math.round(el.getBoundingClientRect().height), bones: el.querySelectorAll('.dc-skeleton').length };
    if (document.querySelector('.worship-verse')) break;
  }
  return seen;
})()`, true);
check('본문이 오기 전에는 글 덩이 모양 뼈대가 그 자리를 지킨다',
  !!waitBox && waitBox.bones >= 4 && waitBox.h > 100, JSON.stringify(waitBox));

// ── 21) 찬양 — 재생목록 줄 정렬 · 재생목록 지우기 (사용자 지적 2026-09-09) ──
// 둘 다 s1(발행본 — 재생목록 하나와 곡 둘이 심겨 있다)에서 본다. 앞 절들이 s1의 찬양을
// 건드리지 않고, 여기서 다시 심으므로 시드 그대로다.
await ev(plant(null));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1400);
await ev(GO); await waitFor(HAS_CARD);
await ev(`document.querySelector('.worship-card').click()`); await waitFor(HAS_DETAIL);
await tabClick('찬양'); await sleep(400);

// '재생목록 열기'는 인도자 글자와 **같은 높이에** 선다. 예전에는 줄이 items-baseline이라
// inline-flex인 링크의 기준선이 **아이콘 밑동**이 되어 아이콘과 글자가 통째로 몇 px 위로
// 떠올랐다(사용자 지적 — "'재생목록 열기' 버튼이 옆의 인도자랑 정렬이 안 맞는데").
// **되돌리기**: PraiseHead의 items-center를 items-baseline으로 되돌리면 여기서 잡힌다.
const PRAISE_MID = `(() => {
  const head = document.querySelector('.worship-praise-head');
  const lead = head && head.querySelector('.worship-praise-leader');
  const link = head && head.querySelector('.worship-praise-playlist');
  const icon = link && link.querySelector('svg');
  if (!lead || !link || !icon) return null;
  const mid = (e) => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
  const r10 = (v) => Math.round(v * 10) / 10;
  return {
    link: r10(Math.abs(mid(lead) - mid(link))),
    icon: r10(Math.abs(mid(lead) - mid(icon))),
    sameRow: Math.abs(mid(lead) - mid(link)) < 12,
  };
})()`;
const praiseMidWide = await ev(PRAISE_MID);
check('1440 — 재생목록 링크와 아이콘이 인도자 글자와 세로 가운데가 같다',
  !!praiseMidWide && praiseMidWide.link <= 1 && praiseMidWide.icon <= 1, JSON.stringify(praiseMidWide));
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await sleep(700);
const praiseMidMob = await ev(PRAISE_MID);
check('375 — 재생목록 링크가 인도자와 같은 줄에 서고 가운데도 같다',
  !!praiseMidMob && praiseMidMob.sameRow === true
  && praiseMidMob.link <= 1 && praiseMidMob.icon <= 1, JSON.stringify(praiseMidMob));
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(600);

// 재생목록이 잘못 들어왔으면 **그 주소만** 뗀다(사용자 지시 — "재생목록으로 가져오긴
// 했는데 재생목록이 잘못 되었으면 이를 삭제도 할 수 있는 구조로"). 가져온 곡은 그대로다 —
// 곡은 줄마다 지우는 길이 이미 있다.
// **되돌리기**: SongsEdit의 url 초깃값을 ''로 되돌리면 칸이 비어 × 가 서지 않는다.
await ev(`${byText('수정')}.click()`); await sleep(900);
await tabClick('찬양'); await sleep(400);
const listBefore = await ev(`(() => {
  const box = document.querySelector('.worship-song-urlbox');
  const input = document.querySelector('input[aria-label="유튜브 재생목록 주소"]');
  const row = JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.id === 's1');
  if (!box || !input) return { err: 'no-box' };
  const b = box.getBoundingClientRect();
  const c = document.querySelector('button[aria-label="재생목록 지우기"]');
  return {
    value: input.value,
    clear: !!c,
    // × 는 칸 안 오른쪽 끝이다(칸 밖으로 나가면 도구 줄이 두 덩이로 읽힌다)
    inside: !!c && c.getBoundingClientRect().right <= b.right + 1,
    songs: (row.songs || []).length,
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`);
check('편집 칸에 주보의 재생목록 주소가 그대로 서고 × 가 칸 안에 붙는다',
  !listBefore.err && listBefore.value === 'https://www.youtube.com/playlist?list=PLl2Yb-KJTF0Zq'
  && listBefore.clear === true && listBefore.inside === true && listBefore.songs === 2,
  JSON.stringify(listBefore));
await ev(`document.querySelector('button[aria-label="재생목록 지우기"]').click()`); await sleep(1800);
const listAfter = await ev(`(() => {
  const row = JSON.parse(localStorage.getItem('church_worship_v1')).services.find(s => s.id === 's1');
  return {
    value: document.querySelector('input[aria-label="유튜브 재생목록 주소"]').value,
    clear: !!document.querySelector('button[aria-label="재생목록 지우기"]'),
    saved: row.praise_playlist_url || '',
    songs: (row.songs || []).map(x => x.title),
    pull: document.querySelector('.worship-song-pull').disabled,
  };
})()`);
check('× 를 누르면 재생목록만 지워지고 곡은 그대로 남는다',
  listAfter.value === '' && listAfter.saved === '' && listAfter.clear === false
  && JSON.stringify(listAfter.songs) === JSON.stringify(['주 은혜임을', '나의 반석이신 하나님'])
  && listAfter.pull === true, JSON.stringify(listAfter));
await ev(`${byText('저장')}.click()`); await sleep(1000);
await tabClick('찬양'); await sleep(400);
const listView = await ev(`(() => ({
  playlist: !!document.querySelector('.worship-praise-playlist'),
  songs: document.querySelectorAll('.worship-song-view').length,
  leader: (document.querySelector('.worship-praise-leader') || {}).textContent?.trim() || '',
}))()`);
check('지운 뒤 보기 화면에는 재생목록 줄이 없고 곡과 인도자는 그대로다',
  listView.playlist === false && listView.songs === 2
  && listView.leader === '· 인도 조해리 부장님', JSON.stringify(listView));

check('콘솔 오류 0', logs.length === 0, logs.slice(0, 3).join(' / '));

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
