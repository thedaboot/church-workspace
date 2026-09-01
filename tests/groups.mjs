// 모임 줄기 — 내 순(구성원·예배 출석·공유된 노트) · 동아리(목록·가입 신청·리더 도구·
// 모임 출석) · 순 편성(자격 분기·순원 추가/이동/빼기·새 순)
//
// 게스트 모드에는 클라우드가 없어서 화면이 비어 있는 것이 정상이다. 그래서 모임 서비스
// 계층(services/groups.js)이 게스트에서 보는 자리(localStorage 'church_groups_v1')에
// 가짜 순·동아리·신청을 심고, 화면을 실제로 눌러 본다. 자격(일반·동아리장·마스터·
// 리더순장)은 시드의 me가 말한다 — 클라우드에서는 RLS가 같은 경계를 긋는다(0035).
//
// 예배 출석은 **예배 줄기의 저장 자리**를 그대로 본다(services/worship.js의
// 'church_worship_v1'). 두 키에 같은 표를 심는 이유가 그것이다 — 클라우드에서는
// 한 DB의 같은 표다.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = 9581;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cgrp-'));
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
  // 고치는 중에는 한 줄씩 바로 본다 — 중간에 넘어지면 어디까지 갔는지 알 수 있다
  if (process.env.LIVE) console.log(line);
};

// ── 가짜 명단 · 순 · 동아리 ─────────────────────────────────────────────────
const Y = new Date().getFullYear();
const seed = {
  people: [
    { id: 'p1', name: '김윤주', profile_id: 'u1' },
    { id: 'p2', name: '천진영', profile_id: null },
    { id: 'p3', name: '김승찬', profile_id: 'u3' },
    { id: 'p4', name: '배현민', profile_id: null },
    { id: 'p5', name: '임재훈', profile_id: null },
    { id: 'p6', name: '노준석', profile_id: 'u2' },
    { id: 'p7', name: '조해리', profile_id: null },
    { id: 'p8', name: '양민혁', profile_id: null },
  ],
  groups: [
    { id: 'g1', type: 'sun', name: '꼬순', year: Y, leader_person_id: 'p1' },
    { id: 'g2', type: 'sun', name: 'TT순', year: Y, leader_person_id: 'p6' },
    { id: 'g0', type: 'sun', name: '지난 순', year: Y - 1, leader_person_id: 'p1' },
    { id: 'gc1', type: 'club', name: '통통', year: null, leader_person_id: 'p6', note: '통기타 동아리' },
    { id: 'gc2', type: 'club', name: '말씀읽기', year: null, leader_person_id: 'p3', note: null },
    { id: 'gc3', type: 'club', name: '서부버튼', year: null, leader_person_id: 'p5', note: '보드게임 동아리' },
  ],
  group_members: [
    { group_id: 'g1', person_id: 'p1' }, { group_id: 'g1', person_id: 'p2' }, { group_id: 'g1', person_id: 'p3' },
    { group_id: 'g2', person_id: 'p6' }, { group_id: 'g2', person_id: 'p4' }, { group_id: 'g2', person_id: 'p5' },
    { group_id: 'g0', person_id: 'p1' },
    { group_id: 'gc1', person_id: 'p6' }, { group_id: 'gc1', person_id: 'p2' },
    { group_id: 'gc2', person_id: 'p3' }, { group_id: 'gc2', person_id: 'p1' },
    { group_id: 'gc3', person_id: 'p5' },
  ],
  club_applications: [
    { id: 'a1', group_id: 'gc1', person_id: 'p1', status: 'pending', created_at: `${Y}-08-20T00:00:00Z` },
  ],
  group_meetings: [
    { id: 'mt1', group_id: 'gc1', meeting_date: `${Y}-08-25`, title: '여름 합주', attendance: ['p6'], note: null },
  ],
  // 가장 최근 발행 **주일** 예배는 s1이다 — s2는 종류가 다르고 s3은 작성 중이다
  services: [
    { id: 's0', kind: 'sunday', service_date: `${Y}-08-23`, status: 'published', title: '지난 주일' },
    { id: 's1', kind: 'sunday', service_date: `${Y}-08-30`, status: 'published', title: '흔들리지 않는 기쁨' },
    { id: 's2', kind: '금요 열정 예배', service_date: `${Y}-09-04`, status: 'published', title: '깨어 기도하라' },
    { id: 's3', kind: 'sunday', service_date: `${Y}-09-06`, status: 'draft', title: '' },
  ],
  attendance: [
    { service_id: 's1', person_id: 'p1' }, { service_id: 's1', person_id: 'p2' },
    { service_id: 's0', person_id: 'p3' },
  ],
  service_notes: [
    { id: 'n1', service_id: 's1', profile_id: 'u9', shared_to_sun: true, author_name: '천진영',
      body: '기쁨은 상황이 아니라 붙드시는 손에서 온다' },
    { id: 'n2', service_id: 's1', profile_id: 'u8', shared_to_sun: false, author_name: '양민혁',
      body: '이 줄은 비공개라 모임 화면에 오면 안 된다' },
  ],
};

const plant = (me, theme = 'light') => `(() => {
  const g = JSON.parse(${JSON.stringify(JSON.stringify(seed))});
  ${me ? `g.me = ${JSON.stringify(me)};` : ''}
  localStorage.setItem('church_groups_v1', JSON.stringify(g));
  localStorage.setItem('church_worship_v1', JSON.stringify({
    people: g.people, groups: g.groups, group_members: g.group_members,
    services: g.services, attendance: g.attendance, service_notes: [],
  }));
  localStorage.setItem('theme', ${JSON.stringify(theme)});
})()`;

// 데스크톱 상단 '모임'으로 들어간다(회차 3 IA 재편 전의 임시 진입로 — docs/V2.md §3)
const GO = `(() => {
  const b = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === '모임')[0];
  if (!b) return false; b.click(); return true;
})()`;
const byText = (t) => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(t)})`;
const store = (table) => `JSON.parse(localStorage.getItem('church_groups_v1')).${table}`;
const tab = (label) => ev(`[...document.querySelectorAll('.groups-tab')].find(t => t.textContent.trim() === ${JSON.stringify(label)}).click()`);
const openClub = (name) => ev(`[...document.querySelectorAll('.club-card')].find(c => c.querySelector('.club-name').textContent.trim() === ${JSON.stringify(name)}).click()`);
const setText = (sel, v) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
// ── 네이티브 select를 걷어낸 뒤의 조작 도구들 ───────────────────────────────
// 사람 고르기: 칸에 포커스를 주면 자동완성이 열리고, 뜬 줄을 누르면 골라진다.
// 줄 글자는 '아바타 첫 글자 + 이름'이라 endsWith로 본다('조' + '조해리').
const sel = (tag, label) => `${tag}[aria-label=` + JSON.stringify(label) + ']';
const pickPerson = (label, name) => ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const input = document.querySelector(${JSON.stringify(sel('input', label))});
  if (!input) return 'no-input';
  // 이미 포커스가 있으면 focus()는 아무 이벤트도 내지 않는다 — 한 번 떼고 다시 준다
  input.blur(); await w(60); input.focus();
  await w(220);
  const o = [...input.closest('.person-pick').querySelectorAll('.person-pick-option')]
    .find(b => b.textContent.trim().endsWith(${JSON.stringify(name)}));
  if (!o) return 'no-option';
  o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await w(150);
  return 'ok';
})()`, true);
// 그 피커가 지금 올려 두는 후보들 (읽고 나서 닫는다)
const pickOptions = (label) => ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const input = document.querySelector(${JSON.stringify(sel('input', label))});
  if (!input) return null;
  input.blur(); await w(60); input.focus();
  await w(220);
  // 줄은 '아바타 + 이름'이라 이름은 마지막 칸이다
  const names = [...input.closest('.person-pick').querySelectorAll('.person-pick-option')]
    .map(b => b.lastElementChild.textContent.trim());
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await w(120);
  return names;
})()`, true);
// 짧은 목록 고르기(순 옮기기)
const pickMenu = (label, text) => ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const btn = document.querySelector(${JSON.stringify(sel('button', label))});
  if (!btn) return 'no-btn';
  btn.click();
  await w(220);
  const o = [...btn.parentElement.querySelectorAll('.menu-pick-option')]
    .find(b => b.textContent.trim() === ${JSON.stringify(text)});
  if (!o) return 'no-option';
  o.click();
  await w(150);
  return 'ok';
})()`, true);
// 연도 고르기(layout.jsx YearPicker — 팝오버는 body 포털이라 #root 밖에서 찾는다)
const pickYear = async (y) => {
  await ev(`document.querySelector('.sun-year button').click()`);
  await sleep(250);
  return ev(`(() => {
    const b = [...document.querySelectorAll('button')]
      .filter(x => !document.getElementById('root').contains(x))
      .find(x => x.textContent.trim() === ${JSON.stringify(`${y}년`)});
    if (!b) return 'no-year'; b.click(); return 'ok';
  })()`);
};
const yearOpen = async () => {
  await ev(`document.querySelector('.sun-year button').click()`);
  await sleep(250);
  const list = await ev(`[...document.querySelectorAll('button')]
    .filter(x => !document.getElementById('root').contains(x)).map(x => x.textContent.trim())`);
  await ev(`document.querySelector('.sun-year button').click()`);
  return list;
};
// 날짜 고르기(DatePicker — 업무 날짜와 같은 부품). 달을 옮겨 그 날을 누른다.
const pickDate = (root, y, m, d) => ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const box = document.querySelector(${JSON.stringify(root)})?.firstElementChild;
  if (!box) return 'no-picker';
  box.querySelector('button').click();
  await w(220);
  for (let i = 0; i < 40; i++) {
    const pop = box.children[1];
    if (!pop) return 'no-pop';
    const head = pop.querySelector('span').textContent.trim();
    if (head === ${JSON.stringify(`${y}년 ${m}월`)}) break;
    const [hy, hm] = head.replace(/[년월]/g, '').trim().split(/\\s+/).map(Number);
    const nav = pop.querySelectorAll('button');
    (hy * 12 + hm < ${y} * 12 + ${m} ? nav[1] : nav[0]).click();
    await w(110);
  }
  const pop = box.children[1];
  const day = [...pop.querySelectorAll('button')]
    .find(b => b.className.includes('w-8') && b.textContent.trim() === String(${d}));
  if (!day) return 'no-day';
  day.click();
  await w(160);
  return 'ok';
})()`, true);

// 아이콘이 든 버튼 전수 점검(사용자 지적 — "+와 글자가 안 맞는 곳이 있다").
// · 아이콘만 든 버튼: svg가 글자 baseline에 앉지 않고 상자 한가운데 서야 한다
// · 아이콘 + 글자: flex 가운데 정렬 + 글자 앞 공백이 남아 있지 않아야 한다
//   (공백이 남으면 gap 위에 3~4px이 더 붙어 버튼마다 사이가 제각각이 된다)
// 세로 판정은 svg의 rect가 아니라 **getBBox() 잉크 상자**로 잰다(§6-9-b).
const ICON_AUDIT = `(() => {
  const bad = [];
  for (const b of document.querySelectorAll('.groups-screen button')) {
    const svg = b.querySelector('svg');
    if (!svg) continue;
    // 날짜 픽커는 업무 화면과 함께 쓰는 부품이라 여기서 판정하지 않는다(DatePicker.jsx)
    if (b.closest('.club-meet-date')) continue;
    const cs = getComputedStyle(b);
    const bb = svg.getBBox(), m = svg.getScreenCTM(), r = b.getBoundingClientRect();
    if (!m || !r.height) continue;
    const inkMid = m.f + (bb.y + bb.height / 2) * m.d;
    const name = (b.getAttribute('aria-label') || b.textContent.trim() || b.className.split(' ')[0]);
    const dy = inkMid - (r.top + r.bottom) / 2;
    if (!/flex/.test(cs.display)) { bad.push(name + ' display=' + cs.display); continue; }
    if (Math.abs(dy) > 1.2) { bad.push(name + ' dy=' + dy.toFixed(2)); continue; }
    if (b.textContent.trim()) {
      if (cs.alignItems !== 'center') { bad.push(name + ' align=' + cs.alignItems); continue; }
      const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (n.textContent.trim() && /^\\s/.test(n.textContent)) { bad.push(name + ' 글자 앞 공백'); break; }
      }
    }
  }
  return bad;
})()`;
const enter = async (me, theme) => {
  await ev(plant(me, theme));
  await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1500);
  await ev(GO); await sleep(1200);
};

await send('Page.enable'); await send('Runtime.enable');
// 헤드리스는 창에 포커스가 없어서 focus()·blur()가 이벤트를 안 낸다(activeElement만 바뀐다).
// 순 이름은 칸을 떠날 때 저장하므로 이 줄이 없으면 그 검사가 헛으로 실패한다.
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');

// ── 0) 순수 로직 — 화면 없이도 맞아야 하는 것들 ─────────────────────────────
const pure = await ev(`(async () => {
  const m = await import('/src/services/groups.js');
  const perms = (o) => { const p = m.groupPerms(o); return [p.canManageSun, p.canCreateClub]; };
  const led = { isMaster: false, ledClubIds: ['gc1'] };
  const sunOnly = [{ id: 'g', leader_person_id: 'b' }];
  return {
    plain: perms({}),
    master: perms({ isMaster: true }),
    pastor: perms({ myPerson: { is_pastor: true } }),
    lead: perms({ myRoles: ['lead_sunjang'] }),
    officer: perms({ myRoles: ['officer'] }),
    club: [m.canManageClub(led, 'gc1'), m.canManageClub(led, 'gc2'), m.canManageClub({ isMaster: true, ledClubIds: [] }, 'gc2')],
    people: m.groupPeople({
      people: [{ id: 'a', name: '가' }, { id: 'b', name: '나' }, { id: 'c', name: '다' }],
      group: { id: 'g', leader_person_id: 'b' },
      members: [{ group_id: 'g', person_id: 'a' }, { group_id: 'g', person_id: 'b' }],
    }).map(p => p.name),
    sunLeader: m.mySun({ id: 'b' }, sunOnly, [])?.id || null,
    sunMember: m.mySun({ id: 'a' }, sunOnly, [{ group_id: 'g', person_id: 'a' }])?.id || null,
    sunNone: m.mySun({ id: 'z' }, sunOnly, []),
    latest: m.latestSunday([
      { id: 'a', kind: 'sunday', status: 'published', service_date: '2026-08-23' },
      { id: 'b', kind: 'sunday', status: 'published', service_date: '2026-08-30' },
      { id: 'c', kind: '금요 열정 예배', status: 'published', service_date: '2026-09-04' },
      { id: 'd', kind: 'sunday', status: 'draft', service_date: '2026-09-06' },
    ])?.id || null,
    present: m.presentCount([{ id: 'a' }, { id: 'b' }, { id: 'c' }], new Set(['a', 'c'])),
    on: m.toggleAttendance(['a'], 'b'),
    off: m.toggleAttendance(['a', 'b'], 'a'),
    years: m.yearOptions([{ year: 2024 }, { year: 2026 }, { year: null }], 2026),
    // 동아리 순서 — position 순, 값이 없는 것은 원래 차례를 지키며 뒤로
    order: m.sortClubs([
      { id: 'c', position: 3 }, { id: 'x', position: null }, { id: 'a', position: 1 },
      { id: 'y' }, { id: 'b', position: 2 },
    ]).map(g => g.id),
    // 이미 든 사람(리더 포함)은 '멤버 추가' 후보가 아니다
    left: m.notInGroup(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      { id: 'g', leader_person_id: 'b' },
      [{ group_id: 'g', person_id: 'a' }, { group_id: 'h', person_id: 'd' }],
    ).map(p => p.id),
  };
})()`, true);
check('일반 멤버는 순 편성도 동아리 개설도 못 한다', JSON.stringify(pure.plain) === '[false,false]', JSON.stringify(pure.plain));
check('마스터는 순 편성 + 동아리 개설', JSON.stringify(pure.master) === '[true,true]', JSON.stringify(pure.master));
check('교역자는 순 편성만(동아리 개설은 마스터만)', JSON.stringify(pure.pastor) === '[true,false]', JSON.stringify(pure.pastor));
check('리더순장은 순 편성만', JSON.stringify(pure.lead) === '[true,false]', JSON.stringify(pure.lead));
check('임원 줄만으로는 순 편성 자격이 아니다', JSON.stringify(pure.officer) === '[false,false]', JSON.stringify(pure.officer));
check('동아리 관리는 그 동아리 리더 또는 마스터', JSON.stringify(pure.club) === '[true,false,true]', JSON.stringify(pure.club));
check('리더가 맨 앞에 서고 겹치는 사람은 하나로', JSON.stringify(pure.people) === '["나","가"]', JSON.stringify(pure.people));
check('내 순 — 순장도 순원도 자기 순을 찾는다', pure.sunLeader === 'g' && pure.sunMember === 'g', `${pure.sunLeader}/${pure.sunMember}`);
check('어느 순에도 없으면 내 순이 없다', pure.sunNone === null, String(pure.sunNone));
check('출석 기준은 발행된 주일 예배 중 가장 최근 한 건', pure.latest === 'b', String(pure.latest));
check('출석 셈은 그 순 사람만 센다', pure.present === 2, String(pure.present));
check('모임 출석은 눌러서 켜고 끈다',
  JSON.stringify(pure.on) === '["a","b"]' && JSON.stringify(pure.off) === '["b"]', `${JSON.stringify(pure.on)}/${JSON.stringify(pure.off)}`);
check('편성 연도 후보 — 편성이 있는 해 + 올해 + 다음 해', JSON.stringify(pure.years) === '[2027,2026,2024]', JSON.stringify(pure.years));
check('동아리는 손으로 정한 순서대로, 값이 없는 것은 차례를 지키며 뒤로',
  JSON.stringify(pure.order) === '["a","b","c","x","y"]', JSON.stringify(pure.order));
check('멤버 추가 후보에서 이미 든 사람과 리더는 빠진다',
  JSON.stringify(pure.left) === '["c","d"]', JSON.stringify(pure.left));

// ── 1) 내 순 (일반 순원 · 꼬순) ─────────────────────────────────────────────
await ev(plant({ personId: 'p1', isMaster: false, roles: [] }));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1500);
check('데스크톱 상단에 모임 진입로가 있다', (await ev(GO)) === true);
await sleep(1400);

const mine = await ev(`(() => ({
  open: !!document.querySelector('.groups-screen'),
  tabs: [...document.querySelectorAll('.groups-tab')].map(t => t.textContent.trim()),
  name: document.querySelector('.mysun-name')?.textContent.trim() || '',
  leader: document.querySelector('.mysun-leader')?.textContent.trim() || '',
  members: [...document.querySelectorAll('.mysun-member')].map(m => m.textContent.trim()),
  att: document.querySelector('.mysun-att')?.textContent.trim() || '',
  notes: [...document.querySelectorAll('.mysun-note')].map(n => n.innerText.replace(/\\n+/g, ' | ')),
  hidden: document.body.innerText.includes('비공개라 모임 화면에'),
}))()`);
check('모임 화면이 열린다', mine.open === true);
check('일반 순원에게는 탭이 둘', JSON.stringify(mine.tabs) === '["내 순","동아리"]', JSON.stringify(mine.tabs));
check('내 순 카드에 순 이름과 순장', mine.name === '꼬순' && mine.leader === '순장 김윤주', `${mine.name}/${mine.leader}`);
// 아바타가 글자 원이라 텍스트 맨 앞에 첫 글자가 한 번 더 들어간다('김' + '김윤주')
check('구성원은 순장이 맨 앞이고 순장 표시가 붙는다',
  mine.members.length === 3 && mine.members[0].includes('김윤주') && mine.members[0].includes('순장')
  && mine.members[1].includes('천진영'), JSON.stringify(mine.members));
check('최근 주일 예배 출석 n/m', mine.att === '8월 30일 (일) 예배 출석 2/3', mine.att);
check('내 순에 공유된 예배 노트가 뜬다',
  mine.notes.length === 1 && mine.notes[0].includes('천진영') && mine.notes[0].includes('기쁨은 상황이 아니라'), JSON.stringify(mine.notes));
check('공유하지 않은 남의 노트는 오지 않는다', mine.hidden === false);

// ── 2) 동아리 목록 · 가입 신청 ──────────────────────────────────────────────
await tab('동아리'); await sleep(600);
const list = await ev(`(() => ({
  cards: [...document.querySelectorAll('.club-card')].map(c => c.innerText.replace(/\\n+/g, ' | ')),
  newBtn: !!document.querySelector('.club-new-open'),
  mine: [...document.querySelectorAll('.club-card')].filter(c => c.querySelector('.club-mine-badge')).map(c => c.querySelector('.club-name').textContent.trim()),
  pending: [...document.querySelectorAll('.club-card')].filter(c => c.querySelector('.club-pending-badge')).map(c => c.querySelector('.club-name').textContent.trim()),
}))()`);
check('동아리 카드에 이름·설명·동아리장·인원',
  list.cards.length === 3 && list.cards[0].includes('통통') && list.cards[0].includes('통기타 동아리')
  && list.cards[0].includes('동아리장 노준석') && list.cards[0].includes('2명'), JSON.stringify(list.cards[0]));
check('내가 든 동아리에 참여 중 표시', JSON.stringify(list.mine) === '["말씀읽기"]', JSON.stringify(list.mine));
check('신청해 둔 동아리에 대기 표시', JSON.stringify(list.pending) === '["통통"]', JSON.stringify(list.pending));
check('마스터가 아니면 새 동아리 버튼이 없다', list.newBtn === false);

await openClub('서부버튼'); await sleep(700);
const before = await ev(`(() => ({
  detail: !!document.querySelector('.club-detail'),
  apply: !!document.querySelector('.club-apply'),
  cancel: !!document.querySelector('.club-cancel'),
  tools: !!document.querySelector('.club-leader-tools'),
  members: [...document.querySelectorAll('.club-member')].map(m => m.textContent.trim()),
}))()`);
check('동아리 상세가 열리고 구성원에 동아리장 표시',
  before.detail === true && before.members.length === 1 && before.members[0].includes('동아리장'), JSON.stringify(before.members));
check('내가 안 든 동아리에는 가입 신청 버튼', before.apply === true && before.cancel === false);
check('리더가 아니면 리더 도구가 없다', before.tools === false);

await ev(`document.querySelector('.club-apply').click()`); await sleep(900);
const applied = await ev(`(() => ({
  apply: !!document.querySelector('.club-apply'),
  cancel: !!document.querySelector('.club-cancel'),
  waiting: !!document.querySelector('.club-waiting'),
  rows: ${store('club_applications')}.filter(a => a.status === 'pending').length,
}))()`);
check('가입 신청을 보내면 대기 표시와 취소가 선다',
  applied.apply === false && applied.cancel === true && applied.waiting === true, JSON.stringify(applied));
check('신청이 저장된다', applied.rows === 2, String(applied.rows));

await ev(`${byText('목록으로')}.click()`); await sleep(700);
const badge = await ev(`[...document.querySelectorAll('.club-card')].filter(c => c.querySelector('.club-pending-badge')).map(c => c.querySelector('.club-name').textContent.trim())`);
check('목록에도 신청 대기가 같이 보인다', JSON.stringify(badge) === '["통통","서부버튼"]', JSON.stringify(badge));

await openClub('서부버튼'); await sleep(700);
await ev(`document.querySelector('.club-cancel').click()`); await sleep(900);
const cancelled = await ev(`(() => ({
  apply: !!document.querySelector('.club-apply'),
  cancel: !!document.querySelector('.club-cancel'),
  rows: ${store('club_applications')}.filter(a => a.status === 'pending').length,
}))()`);
check('신청을 취소하면 다시 가입 신청으로 돌아온다',
  cancelled.apply === true && cancelled.cancel === false && cancelled.rows === 1, JSON.stringify(cancelled));

await ev(`${byText('목록으로')}.click()`); await sleep(600);

// ── 2-1) 동아리 카드 순서 조정 (끌어서 — 프로젝트 탭·보드와 같은 공유 순서) ──
// 순서 저장은 0038의 reorder_clubs()로 승인 멤버 전체에게 열려 있다. 그래서 이
// 검사는 **일반 멤버**로 돈다.
const cardBox = (name) => ev(`(() => {
  const c = [...document.querySelectorAll('.club-card')]
    .find(x => x.querySelector('.club-name').textContent.trim() === ${JSON.stringify(name)});
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
const dragCard = async (from, to) => {
  const a = await cardBox(from), b = await cardBox(to);
  if (!a || !b) return false;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 14; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left',
      x: a.x + (b.x - a.x) * (i / 14), y: a.y + (b.y - a.y) * (i / 14) });
    await sleep(25);
  }
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  await sleep(700);
  return true;
};
const cardOrder = () => ev(`[...document.querySelectorAll('.club-card')].map(c => c.querySelector('.club-name').textContent.trim())`);
const order0 = await cardOrder();
check('처음에는 만든 차례 그대로', JSON.stringify(order0) === '["통통","말씀읽기","서부버튼"]', JSON.stringify(order0));

await dragCard('서부버튼', '통통');
const up = await cardOrder();
const upStored = await ev(`${store('groups')}.filter(g => g.type === 'club').map(g => [g.name, g.position])`);
check('위로 끌면 놓은 카드 앞에 선다',
  JSON.stringify(up) === '["서부버튼","통통","말씀읽기"]', JSON.stringify(up));
check('바뀐 순서가 저장된다(모임 화면을 벗어나도 남는다)',
  JSON.stringify(upStored.sort((a, b) => a[1] - b[1]).map(x => x[0])) === '["서부버튼","통통","말씀읽기"]',
  JSON.stringify(upStored));

// **아래로 끄는 경우**(§6-12-a) — 언제나 '앞'에 끼우면 나를 뺀 만큼 자리가 당겨져
// 제자리로 돌아온다. 눈으로는 "안 움직인다"로만 보여서 검사가 잡아야 한다.
await dragCard('서부버튼', '말씀읽기');
const down = await cardOrder();
check('아래로 끌면 놓은 카드 뒤에 선다(제자리로 돌아오지 않는다)',
  JSON.stringify(down) === '["통통","말씀읽기","서부버튼"]', JSON.stringify(down));

check('네이티브 select는 모임 화면에 하나도 없다',
  (await ev(`document.querySelectorAll('.groups-screen select').length`)) === 0);

// 끌기와 열기는 다른 조작이다 — 짧게 누르면 그대로 상세가 열린다
await openClub('통통'); await sleep(800);
const plainMeet = await ev(`(() => ({
  tools: !!document.querySelector('.club-leader-tools'),
  drop: document.querySelectorAll('.club-drop').length,
  meetings: [...document.querySelectorAll('.club-meeting')].map(m => m.innerText.replace(/\\n+/g, ' | ')),
  locked: [...document.querySelectorAll('.club-meet-chip')].every(c => c.disabled),
}))()`);
check('리더가 아니면 내보내기·모임 만들기가 없다', plainMeet.tools === false && plainMeet.drop === 0, JSON.stringify(plainMeet));
check('모임은 누구나 보되 출석은 만지지 못한다',
  plainMeet.meetings.length === 1 && plainMeet.meetings[0].includes('8월 25일') && plainMeet.meetings[0].includes('여름 합주')
  && plainMeet.meetings[0].includes('1/2') && plainMeet.locked === true, JSON.stringify(plainMeet.meetings));

// ── 3) 동아리장 도구 ────────────────────────────────────────────────────────
await enter({ personId: 'p6', isMaster: false, roles: [] });
await tab('동아리'); await sleep(600);
check('동아리장이어도 새 동아리는 마스터만', (await ev(`!!document.querySelector('.club-new-open')`)) === false);
await openClub('통통'); await sleep(800);
const leader = await ev(`(() => ({
  tools: !!document.querySelector('.club-leader-tools'),
  apps: [...document.querySelectorAll('.club-app-row')].map(r => r.innerText.replace(/\\n+/g, ' | ')),
  drop: document.querySelectorAll('.club-drop').length,
  chips: [...document.querySelectorAll('.club-meet-chip')].map(c => [c.textContent.trim(), c.getAttribute('aria-pressed'), c.disabled]),
  newMeet: !!document.querySelector('.club-meet-new-open'),
}))()`);
check('그 동아리 리더에게 리더 도구가 선다', leader.tools === true && leader.newMeet === true);
check('대기 중인 가입 신청이 보인다', leader.apps.length === 1 && leader.apps[0].includes('김윤주'), JSON.stringify(leader.apps));
check('동아리장 자신은 내보내기 대상이 아니다', leader.drop === 1, String(leader.drop));
check('리더에게는 모임 출석 칩이 열린다',
  leader.chips.length === 2 && leader.chips.every(c => c[2] === false)
  && leader.chips.find(c => c[0] === '노준석')[1] === 'true', JSON.stringify(leader.chips));

await ev(`[...document.querySelectorAll('.club-meet-chip')].find(c => c.textContent.trim() === '천진영').click()`);
await sleep(700);
const toggled = await ev(`(() => ({
  pressed: [...document.querySelectorAll('.club-meet-chip')].find(c => c.textContent.trim() === '천진영').getAttribute('aria-pressed'),
  count: document.querySelector('.club-meeting-count').textContent.trim(),
  stored: ${store('group_meetings')}.find(m => m.id === 'mt1').attendance,
}))()`);
check('모임 출석을 누르면 켜지고 그 자리에서 저장된다',
  toggled.pressed === 'true' && toggled.count === '2/2' && toggled.stored.length === 2, JSON.stringify(toggled));
await ev(`[...document.querySelectorAll('.club-meet-chip')].find(c => c.textContent.trim() === '천진영').click()`);
await sleep(700);
const untoggled = await ev(`(() => ({ count: document.querySelector('.club-meeting-count').textContent.trim(), stored: ${store('group_meetings')}.find(m => m.id === 'mt1').attendance.length }))()`);
check('다시 누르면 출석이 취소된다', untoggled.count === '1/2' && untoggled.stored === 1, JSON.stringify(untoggled));

// 날짜는 업무 날짜와 같은 DatePicker다 — 네이티브 date 입력이 아니다
await ev(`document.querySelector('.club-meet-new-open').click()`); await sleep(350);
check('모임 날짜는 네이티브 date 입력이 아니다',
  (await ev(`!document.querySelector('.club-meet-new input[type="date"]') && !!document.querySelector('.club-meet-date button')`)) === true);
check('모임 날짜를 달력에서 고른다', (await pickDate('.club-meet-date', Y, 9, 8)) === 'ok');
await setText('input[aria-label="모임 제목"]', '9월 첫 모임');
await sleep(200);
await ev(`${byText('만들기')}.click()`); await sleep(900);
const madeMeet = await ev(`(() => ({
  rows: [...document.querySelectorAll('.club-meeting')].map(m => m.innerText.split('\\n')[0]),
  stored: ${store('group_meetings')}.length,
  date: ${store('group_meetings')}.map(m => m.meeting_date).sort().join(','),
}))()`);
check('모임을 만들면 최신 날짜가 위로 온다',
  madeMeet.rows.length === 2 && madeMeet.rows[0].includes('9월 8일') && madeMeet.stored === 2, JSON.stringify(madeMeet));
check('고른 날짜 그대로 저장된다', madeMeet.date === `${Y}-08-25,${Y}-09-08`, madeMeet.date);

await ev(`document.querySelector('.club-accept').click()`); await sleep(1000);
const accepted = await ev(`(() => ({
  apps: document.querySelectorAll('.club-app-row').length,
  members: [...document.querySelectorAll('.club-member')].map(m => m.textContent.trim().replace(/\\s+/g, '')),
  joined: ${store('group_members')}.some(m => m.group_id === 'gc1' && m.person_id === 'p1'),
  status: ${store('club_applications')}.find(a => a.id === 'a1').status,
}))()`);
check('가입 신청을 수락하면 그 자리에서 동아리 명단에 들어간다',
  accepted.joined === true && accepted.members.length === 3 && accepted.apps === 0, JSON.stringify(accepted));
check('수락한 신청은 대기에서 빠진다', accepted.status === 'accepted', accepted.status);

// 멤버 추가 — 그 동아리장(또는 마스터)만. 가입 신청을 기다리지 않고 여기서 바로 넣는다.
const headText = `[...document.querySelectorAll('.club-detail *')]
  .map(e => e.textContent.trim()).find(t => /^구성원 \\d+명$/.test(t)) || ''`;
const beforeAdd = await ev(`(() => ({
  head: ${headText},
  members: document.querySelectorAll('.club-member').length,
  pick: !!document.querySelector('.club-add'),
}))()`);
check('동아리장에게 멤버 추가 칸이 선다', beforeAdd.pick === true);
check("'명단은 동아리장이 채운다' 문구는 화면에 없다",
  (await ev(`document.querySelector('.groups-screen').innerText.includes('명단은 동아리장이')`)) === false);
const addable = await pickOptions('통통 멤버 추가');
check('멤버 추가 후보에서 이미 든 사람은 빠진다',
  Array.isArray(addable) && !addable.includes('천진영') && addable.includes('양민혁'), JSON.stringify(addable));
check('멤버를 고르면 명단에 들어간다', (await pickPerson('통통 멤버 추가', '양민혁')) === 'ok');
await sleep(900);
const afterAdd = await ev(`(() => ({
  head: ${headText},
  members: document.querySelectorAll('.club-member').length,
  stored: ${store('group_members')}.some(m => m.group_id === 'gc1' && m.person_id === 'p8'),
}))()`);
check('구성원 수가 추가에 맞춰 그 자리에서 늘어난다',
  afterAdd.members === beforeAdd.members + 1 && afterAdd.head === `구성원 ${beforeAdd.members + 1}명`
  && afterAdd.stored === true, `${beforeAdd.head} → ${afterAdd.head}`);

// 아이콘이 든 버튼 전수 점검 — 리더 도구가 다 서 있는 이 화면에서 한 번
const clubBtns = await ev(ICON_AUDIT);
check('동아리 화면의 아이콘 버튼 정렬(잉크 상자 기준)', clubBtns.length === 0, clubBtns.join(' / '));

await ev(`${byText('목록으로')}.click()`); await sleep(600);
await openClub('말씀읽기'); await sleep(700);
check('남의 동아리에서는 멤버 추가 칸도 없다',
  (await ev(`!!document.querySelector('.club-add')`)) === false);
check('남의 동아리에서는 리더 도구가 서지 않는다',
  (await ev(`!!document.querySelector('.club-leader-tools')`)) === false);
check('동아리장이어도 순 편성 탭은 없다',
  (await ev(`[...document.querySelectorAll('.groups-tab')].map(t => t.textContent.trim()).join(',')`)) === '내 순,동아리');

// ── 4) 마스터 ───────────────────────────────────────────────────────────────
await enter({ personId: 'p6', isMaster: true, roles: [] });
await tab('동아리'); await sleep(700);
check('마스터에게만 새 동아리 버튼', (await ev(`!!document.querySelector('.club-new-open')`)) === true);
await openClub('말씀읽기'); await sleep(700);
check('마스터는 남의 동아리도 관리한다',
  (await ev(`!!document.querySelector('.club-leader-tools')`)) === true);
await ev(`${byText('목록으로')}.click()`); await sleep(600);
await ev(`document.querySelector('.club-new-open').click()`); await sleep(350);
await setText('input[aria-label="동아리 이름"]', '달리기');
await setText('input[aria-label="동아리 설명"]', '토요일 아침 러닝');
check('동아리장은 자동완성 피커로 고른다', (await pickPerson('동아리장', '조해리')) === 'ok');
await sleep(200);
await ev(`${byText('만들기')}.click()`); await sleep(1100);
const madeClub = await ev(`(() => {
  const g = ${store('groups')}.find(x => x.name === '달리기');
  return { made: !!g, leader: g?.leader_person_id,
    member: ${store('group_members')}.some(m => m.group_id === g?.id && m.person_id === 'p7'),
    cards: document.querySelectorAll('.club-card').length };
})()`);
check('마스터가 동아리를 만들고 동아리장을 정한다',
  madeClub.made === true && madeClub.leader === 'p7' && madeClub.cards === 4, JSON.stringify(madeClub));
check('동아리장은 그 동아리의 구성원으로도 들어간다', madeClub.member === true);

// 아직 아무 모임도 안 잡힌 동아리 — 문구는 '예정된 모임이 아직 없어요'(사용자 지시)
await openClub('달리기'); await sleep(800);
const emptyMeet = await ev(`document.querySelector('.club-meet-empty')?.textContent.trim() || ''`);
check('모임이 없을 때 문구', emptyMeet === '예정된 모임이 아직 없어요', emptyMeet);
await ev(`${byText('목록으로')}.click()`); await sleep(500);

// ── 5) 순 편성 (리더순장 — 마스터가 아니다) ─────────────────────────────────
await enter({ personId: 'p3', isMaster: false, roles: ['lead_sunjang'] });
const tabs = await ev(`[...document.querySelectorAll('.groups-tab')].map(t => t.textContent.trim())`);
check('리더순장에게는 순 편성 탭이 보인다', JSON.stringify(tabs) === '["내 순","동아리","순 편성"]', JSON.stringify(tabs));
await tab('순 편성'); await sleep(800);
const admin = await ev(`(() => ({
  open: !!document.querySelector('.sun-admin'),
  year: document.querySelector('.sun-year button')?.textContent.trim(),
  rows: [...document.querySelectorAll('.sun-row')].map(r => r.querySelector('.sun-name').value),
  members: [...document.querySelectorAll('.sun-row')].map(r => r.querySelectorAll('.sun-member').length),
}))()`);
const adminYears = await yearOpen();
const adminAdd = await pickOptions('꼬순 순원 추가');
check('순 편성 구역이 열리고 기본은 올해', admin.open === true && admin.year === String(Y), `${admin.year}`);
check('지난 편성이 있는 해도 고를 수 있다', adminYears.includes(`${Y - 1}년`), JSON.stringify(adminYears));
check('올해 순만 줄로 선다', JSON.stringify(admin.rows) === '["꼬순","TT순"]', JSON.stringify(admin.rows));
check('순별 구성원 수', JSON.stringify(admin.members) === '[3,3]', JSON.stringify(admin.members));
check('순원 추가 후보는 어느 순에도 없는 사람뿐',
  JSON.stringify(adminAdd) === '["조해리","양민혁"]', JSON.stringify(adminAdd));
const leaderRow = await ev(`(() => {
  const rows = [...document.querySelectorAll('.sun-row')[0].querySelectorAll('.sun-member')];
  return rows.map(r => [r.textContent.includes('순장'), !!r.querySelector('.sun-move'), !!r.querySelector('.sun-drop')]);
})()`);
check('순장은 옮기기·빼기 대상이 아니다(순장 칸에서 바꾼다)',
  JSON.stringify(leaderRow[0]) === '[true,false,false]' && JSON.stringify(leaderRow[1]) === '[false,true,true]',
  JSON.stringify(leaderRow));

check('순원 추가는 이름을 쳐서 고른다', (await pickPerson('꼬순 순원 추가', '조해리')) === 'ok');
await sleep(1000);
const added = await ev(`(() => ({
  count: document.querySelectorAll('.sun-row')[0].querySelectorAll('.sun-member').length,
  stored: ${store('group_members')}.some(m => m.group_id === 'g1' && m.person_id === 'p7'),
}))()`);
const addedLeft = await pickOptions('꼬순 순원 추가');
check('순원을 넣으면 그 줄과 후보 목록이 같이 움직인다',
  added.count === 4 && added.stored === true && JSON.stringify(addedLeft) === '["양민혁"]',
  `${JSON.stringify(added)} ${JSON.stringify(addedLeft)}`);

check('순 옮기기도 우리 목록으로 고른다', (await pickMenu('조해리 순 옮기기', 'TT순')) === 'ok');
await sleep(1000);
const moved = await ev(`(() => ({
  counts: [...document.querySelectorAll('.sun-row')].map(r => r.querySelectorAll('.sun-member').length),
  from: ${store('group_members')}.some(m => m.group_id === 'g1' && m.person_id === 'p7'),
  to: ${store('group_members')}.some(m => m.group_id === 'g2' && m.person_id === 'p7'),
}))()`);
check('순을 옮기면 한쪽에서 빠지고 다른 쪽에 붙는다',
  JSON.stringify(moved.counts) === '[3,4]' && moved.from === false && moved.to === true, JSON.stringify(moved));

await ev(`document.querySelector('[aria-label="조해리 빼기"]').click()`); await sleep(400);
await ev(`${byText('빼기')}.click()`); await sleep(1000);
const dropped = await ev(`(() => ({
  counts: [...document.querySelectorAll('.sun-row')].map(r => r.querySelectorAll('.sun-member').length),
  stored: ${store('group_members')}.some(m => m.group_id === 'g2' && m.person_id === 'p7'),
}))()`);
check('빼기는 확인을 거쳐 지운다', JSON.stringify(dropped.counts) === '[3,3]' && dropped.stored === false, JSON.stringify(dropped));

// 이름은 칸을 떠날 때 저장한다 — 포커스를 실제로 줬다 뺀다(focus 없이 blur()는 아무 일도 안 한다)
await ev(`document.querySelector('input[aria-label="꼬순 순 이름"]').focus()`);
await setText('input[aria-label="꼬순 순 이름"]', '꼬순이');
await ev(`document.querySelector('input[aria-label="꼬순 순 이름"]').blur()`); await sleep(1000);
const renamed = await ev(`(() => ({
  rows: [...document.querySelectorAll('.sun-row')].map(r => r.querySelector('.sun-name').value),
  stored: ${store('groups')}.find(g => g.id === 'g1').name,
}))()`);
check('순 이름을 바꾸면 그대로 남는다',
  renamed.stored === '꼬순이' && renamed.rows[0] === '꼬순이', JSON.stringify(renamed));

await ev(`document.querySelector('.sun-new-open').click()`); await sleep(350);
await setText('input[aria-label="새 순 이름"]', '새싹순');
check('새 순의 순장도 자동완성 피커로 고른다', (await pickPerson('새 순의 순장', '양민혁')) === 'ok');
await sleep(200);
await ev(`${byText('만들기')}.click()`); await sleep(1100);
const madeSun = await ev(`(() => {
  const g = ${store('groups')}.find(x => x.name === '새싹순');
  return { made: !!g, year: g?.year, leader: g?.leader_person_id,
    member: ${store('group_members')}.some(m => m.group_id === g?.id && m.person_id === 'p8'),
    rows: document.querySelectorAll('.sun-row').length };
})()`);
check('새 순은 고른 해로 만들어진다', madeSun.made === true && madeSun.year === Y && madeSun.rows === 3, JSON.stringify(madeSun));
check('순장을 정하면 그 순의 구성원으로도 들어간다', madeSun.leader === 'p8' && madeSun.member === true, JSON.stringify(madeSun));

// 아이콘이 든 버튼 전수 점검 — 순 편성 쪽(빼기·순 옮기기)도 같은 기준으로
const sunBtns = await ev(ICON_AUDIT);
check('순 편성 화면의 아이콘 버튼 정렬(잉크 상자 기준)', sunBtns.length === 0, sunBtns.join(' / '));

// 세 구역의 폭은 하나다 — 탭을 옮겨도 카드 왼쪽·오른쪽 선이 움직이지 않는다
const widthOf = (s) => ev(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return null;
  const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; })()`);
const wSun = await widthOf('.sun-admin');
await tab('내 순'); await sleep(600);
const wMine = await widthOf('.mysun');
await tab('동아리'); await sleep(600);
const wClub = await widthOf('.club-list');
const wMain = await widthOf('.groups-screen');
check('내 순·동아리·순 편성이 같은 폭에 선다',
  JSON.stringify(wSun) === JSON.stringify(wMine) && JSON.stringify(wSun) === JSON.stringify(wClub),
  `${JSON.stringify(wMine)} / ${JSON.stringify(wClub)} / ${JSON.stringify(wSun)}`);
check('그 폭은 대시보드 계열과 같은 화면 폭이다(따로 좁히지 않는다)',
  JSON.stringify(wSun) === JSON.stringify(wMain), `${JSON.stringify(wSun)} vs ${JSON.stringify(wMain)}`);

await tab('순 편성'); await sleep(700);
check('연도는 우리 연도 피커로 고른다', (await pickYear(Y - 1)) === 'ok');
await sleep(1000);
const lastYear = await ev(`[...document.querySelectorAll('.sun-row')].map(r => r.querySelector('.sun-name').value)`);
check('연도를 바꾸면 그 해 편성을 본다', JSON.stringify(lastYear) === '["지난 순"]', JSON.stringify(lastYear));
check('고른 해가 연도 칸에 남는다',
  (await ev(`document.querySelector('.sun-year button').textContent.trim()`)) === String(Y - 1));

// ── 6) 명단에 안 이어진 계정 ────────────────────────────────────────────────
await enter({ personId: null, isMaster: false, roles: [] });
const orphan = await ev(`(() => ({
  empty: document.querySelector('.mysun-empty')?.innerText.replace(/\\n+/g, ' | ') || '',
  card: !!document.querySelector('.mysun-card'),
}))()`);
check('명단에 안 이어진 계정에는 담백한 빈 자리',
  orphan.card === false && orphan.empty.includes('명단에 이어지지 않은') && orphan.empty.includes('관리자에게 알려주세요'), orphan.empty);

// ── 7) 모바일 375px ─────────────────────────────────────────────────────────
await enter({ personId: 'p3', isMaster: false, roles: ['lead_sunjang'] });
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await sleep(800);
const mobMine = await ev(`(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  members: document.querySelectorAll('.mysun-member').length,
}))()`);
check('모바일 375px — 내 순이 가로로 넘치지 않는다', mobMine.overflow <= 0, `넘침 ${mobMine.overflow}px`);
check('모바일에서도 구성원이 그대로 선다', mobMine.members === 3, String(mobMine.members));
await tab('순 편성'); await sleep(800);
const mobSun = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('모바일 375px — 순 편성도 넘치지 않는다', mobSun <= 0, `넘침 ${mobSun}px`);
// 자동완성 목록도 375px 안에 들어와야 한다(네이티브 select를 걷어낸 자리라 우리 몫이다)
await ev(`(() => { const i = document.querySelector('input[aria-label="꼬순 순원 추가"]'); i.scrollIntoView({ block: 'center' }); i.focus(); })()`);
await sleep(400);
const mobPick = await ev(`(() => {
  const m = document.querySelector('.person-pick-menu');
  if (!m) return null;
  const r = m.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(window.innerWidth),
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`);
check('모바일 375px — 자동완성 목록이 화면 안에 선다',
  !!mobPick && mobPick.left >= 0 && mobPick.right <= mobPick.w && mobPick.over <= 0, JSON.stringify(mobPick));
await ev(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(300);
await tab('동아리'); await sleep(700);
const mobList = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('모바일 375px — 동아리 목록도 넘치지 않는다', mobList <= 0, `넘침 ${mobList}px`);
await openClub('통통'); await sleep(800);
const mobClub = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('모바일 375px — 동아리 상세도 넘치지 않는다', mobClub <= 0, `넘침 ${mobClub}px`);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// ── 8) 다크 모드 — 새로 만든 부품이 테마를 따라가는가 ───────────────────────
// 토큰이 아니라 색을 박아 두면 라이트에서만 맞고 다크에서 글자가 배경에 묻힌다(§8).
// "예쁜가"가 아니라 **읽을 수 있는가**만 본다(themefit과 같은 기준 2.0).
const paintOf = (...sels) => ev(`(() => {
  const grab = (s) => { const e = document.querySelector(s); if (!e) return null;
    const c = getComputedStyle(e); return { bg: c.backgroundColor, fg: c.color, bd: c.borderTopColor }; };
  return Object.fromEntries(${JSON.stringify(sels)}.map(([k, s]) => [k, grab(s)]));
})()`);
const lum = (s) => {
  const [r, g, b] = (String(s).match(/[\d.]+/g) || ['0', '0', '0']).slice(0, 3)
    .map(v => { const x = Number(v) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const openPick = async (me, theme) => {
  await enter(me, theme);
  await tab('동아리'); await sleep(700);
  const list = await paintOf(['card', '.club-card'], ['name', '.club-name']);
  await openClub('통통'); await sleep(800);
  await ev(`document.querySelector('input[aria-label="통통 멤버 추가"]').focus()`); await sleep(450);
  const detail = await paintOf(['menu', '.person-pick-menu'], ['option', '.person-pick-option'], ['chip', '.club-meet-chip']);
  return { ...list, ...detail };
};
const lightPaint = await openPick({ personId: 'p6', isMaster: true, roles: [] }, 'light');
const darkPaint = await openPick({ personId: 'p6', isMaster: true, roles: [] }, 'dark');
check('다크에서 카드·자동완성 목록이 색을 바꾼다(색을 박아 두지 않았다)',
  !!darkPaint.card && !!darkPaint.menu
  && darkPaint.card.bg !== lightPaint.card.bg && darkPaint.menu.bg !== lightPaint.menu.bg
  && darkPaint.name.fg !== lightPaint.name.fg,
  `${lightPaint.card?.bg} → ${darkPaint.card?.bg} / ${lightPaint.menu?.bg} → ${darkPaint.menu?.bg}`);
const dc = [
  ['동아리 카드 이름', contrast(darkPaint.name.fg, darkPaint.card.bg)],
  ['자동완성 줄', contrast(darkPaint.option.fg, darkPaint.menu.bg)],
  ['모임 출석 칩', contrast(darkPaint.chip.fg, darkPaint.chip.bg)],
];
check('다크에서도 글자가 배경에 묻히지 않는다', dc.every(([, v]) => v >= 2),
  dc.map(([n, v]) => `${n} ${v.toFixed(1)}`).join(' · '));

await send('Emulation.clearDeviceMetricsOverride');

check('콘솔 오류 0', logs.length === 0, logs.slice(0, 3).join(' / '));

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
