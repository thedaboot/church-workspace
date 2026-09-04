// 청년 명단 관리 — 멤버 화면의 '청년 명단' 탭 (docs/V2.md 결정 1·13 · 권한 표 = 마스터+관리자)
//   node tests/roster.mjs http://localhost:4598
// 앞부분은 서버가 필요 없는 순수 로직(생일 형식·검색·연결 후보·배지), 뒷부분이 브라우저다.
// 명단의 클라우드 데이터는 게스트에 없다 — services/roster.js가 게스트에서
// localStorage('church_roster_v1')로 떨어지므로 여기서 가짜 명단을 심어 검사한다
// (services/word·worship과 같은 방식 · roster.js 머리말).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const URL_BASE = process.argv[2] || 'http://localhost:4174';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = 9458;
const ROOT = new URL('..', import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (n, p, d = '') => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

// ── 1. 순수 로직 (브라우저 없이) ────────────────────────────────────────────
// word.mjs와 같은 방식: supabaseClient·people.js import만 우리 것으로 바꿔치기한다.
const tmp = mkdtempSync(join(tmpdir(), 'roster-'));
writeFileSync(join(tmp, 'people.mjs'), [
  'export const fetchPeople = async () => [];',
  'export const fetchRoles = async () => [];',
  'export const fetchGroups = async () => [];',
  'export const fetchGroupMembers = async () => [];',
  'export const guestStore = () => ({ all: () => ({}), rows: () => [], set: () => {} });',
].join('\n'));
const rosterSrc = readFileSync(new URL('src/services/roster.js', ROOT), 'utf8')
  .replace("import { supabase } from './supabaseClient.js';", 'const supabase = null;')
  .replace("from './people.js';", "from './people.mjs';")
  .replace("from '../utils.js';", `from '${new URL('src/utils.js', ROOT).href}';`);
writeFileSync(join(tmp, 'roster.mjs'), rosterSrc);
const R = await import(pathToFileURL(join(tmp, 'roster.mjs')).href);

// 화면이 거르는 식과 DB(0035 people_birthday_mmdd)가 **같아야** 한다 —
// 어긋나면 화면은 받아 놓고 저장만 조용히 막힌다.
const sql = readFileSync(new URL('supabase/migrations/0035_people_and_groups.sql', ROOT), 'utf8');
const dbRe = (/check \(birthday is null or birthday ~ '([^']+)'\)/.exec(sql) || [])[1];
check('생일 형식이 DB 체크와 같은 식', R.MMDD.source === dbRe, `${R.MMDD.source} / ${dbRe}`);

// 직분 값이 DB(0043의 role 체크)와 **같은 집합**이어야 한다 — 화면에만 있는 값은
// 저장이 조용히 막히고, DB에만 있는 값은 배지가 안 붙는다.
const roleSql = readFileSync(new URL('supabase/migrations/0043_people_roles_split.sql', ROOT), 'utf8');
const dbRoles = [...(/add constraint people_roles_role_check\s*\n?\s*check \(role in \(([^)]+)\)\)/.exec(roleSql) || [, ''])[1]
  .matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
check('직분 값이 DB 체크와 같은 집합',
  [...R.YEAR_ROLES].sort().join(',') === [...dbRoles].sort().join(','),
  `${R.YEAR_ROLES.join(',')} / ${dbRoles.join(',')}`);
check('직분 라벨 여섯 — 교역자·부장·회장·총무·리더순장·리더팀장',
  R.PASTOR_LABEL === '교역자'
  && R.YEAR_ROLES.map(r => R.ROLE_LABEL[r]).join('·') === '부장·회장·총무·리더순장·리더팀장',
  R.YEAR_ROLES.map(r => R.ROLE_LABEL[r]).join('·'));
check("'임원'은 더 이상 없다(0043이 부장·총무·리더팀장으로 갈랐다)",
  !('officer' in R.ROLE_LABEL) && !dbRoles.includes('officer'), JSON.stringify(dbRoles));

const bd = (v) => R.parseBirthday(v);
check('생일 05-26', bd('05-26').ok && bd('05-26').value === '05-26', JSON.stringify(bd('05-26')));
check('생일 5-26 → 05-26', bd('5-26').value === '05-26', JSON.stringify(bd('5-26')));
check('생일 0526 → 05-26', bd('0526').value === '05-26', JSON.stringify(bd('0526')));
check('생일은 비워도 된다', bd('').ok && bd('').value === null, JSON.stringify(bd('')));
check('13월은 받지 않는다', bd('13-01').ok === false);
check('32일은 받지 않는다', bd('05-32').ok === false);
check('세 자리는 받지 않는다(1월 26일인지 5월 26일인지 모른다)', bd('526').ok === false);
check('글자는 받지 않는다', bd('오월').ok === false);

const people = [
  { id: 'p1', name: '김윤주', profile_id: 'u1', is_pastor: false },
  { id: 'p2', name: '박 시현', profile_id: null, is_pastor: false },
  { id: 'p3', name: '임재훈', profile_id: 'u2', is_pastor: true },
];
check('이름 검색은 공백을 지우고 본다',
  R.searchPeople(people, '박시현').length === 1 && R.searchPeople(people, '박시현')[0].id === 'p2');
check('일부만 쳐도 잡힌다', R.searchPeople(people, '윤주').length === 1);
check('빈 검색어는 전부', R.searchPeople(people, '').length === 3);

const profiles = [
  { id: 'u1', display_name: '김윤주', approved: true, removed_at: null },
  { id: 'u2', display_name: '임재훈', approved: true, removed_at: null },
  { id: 'u4', display_name: '조해리', approved: true, removed_at: null },
  { id: 'u5', display_name: '신효진', approved: true, removed_at: '2026-08-01T00:00:00Z' },
  { id: 'u6', display_name: '대기중', approved: false, removed_at: null },
];
const cand = R.unlinkedProfiles(profiles, people).map(p => p.id);
check('연결 후보에서 이미 연결된 계정이 빠진다', !cand.includes('u1') && !cand.includes('u2'), JSON.stringify(cand));
check('환송·승인 대기 계정도 후보가 아니다', !cand.includes('u5') && !cand.includes('u6'), JSON.stringify(cand));
check('남는 후보는 조해리 하나', JSON.stringify(cand) === '["u4"]', JSON.stringify(cand));

// **"후보가 없다"를 "모두 연결됐다"로 읽으면 거짓이 된다**(사용자 지적 2026-09-05).
// 승인 대기·환송한 계정은 후보가 아니면서 명단에 연결되어 있지도 않다 — 라이브에 실제로
// 그런 계정이 있었다. 그리고 계정 목록을 아직 못 받았을 때도 빈 배열이라 같은 문장이 떴다.
const linkState = (opts) => R.accountLinkState(opts);
check('계정 목록을 아직 못 받았으면 후보 없음이 아니라 받는 중이다',
  linkState({ profiles: [], people, ready: false }).status === 'loading',
  linkState({ profiles: [], people, ready: false }).status);
check('후보가 있으면 고르는 자리다',
  linkState({ profiles, people, ready: true }).status === 'pick'
  && linkState({ profiles, people, ready: true }).candidates.length === 1);
check('환송·대기 계정만 남았으면 후보 없음이다(모두 연결됐다는 뜻이 아니다)',
  linkState({ profiles: profiles.filter(pr => pr.id !== 'u4'), people, ready: true }).status === 'none');

const sunMap = R.sunNames(
  [{ id: 'g1', name: 'TT순' }, { id: 'g2', name: '꼬순' }],
  [{ group_id: 'g1', person_id: 'p1' }, { group_id: 'g2', person_id: 'p2' }, { group_id: 'gX', person_id: 'p3' }],
);
check('사람마다 올해 순이 붙는다', sunMap.get('p1')[0] === 'TT순' && sunMap.get('p2')[0] === '꼬순');
check('그 해에 없는 순은 안 붙는다', sunMap.get('p3') === undefined);

const roleMap = R.rolesByPerson([
  { person_id: 'p1', year: 2026, role: 'lead_team' },
  { person_id: 'p3', year: 2026, role: 'president' },
]);
check('갈라진 직분도 배지가 된다', R.personBadges(people[0], roleMap.get('p1')).join() === '리더팀장',
  JSON.stringify(R.personBadges(people[0], roleMap.get('p1'))));
check('교역자 배지가 먼저 온다',
  JSON.stringify(R.personBadges(people[2], roleMap.get('p3'))) === '["교역자","회장"]',
  JSON.stringify(R.personBadges(people[2], roleMap.get('p3'))));
check('직분이 없으면 배지도 없다', R.personBadges(people[1], roleMap.get('p2')).length === 0);

// 명단 한 벌은 **캐시를 먼저 그린다**(services/cache.js). 게스트에서는 조회가 즉시
// 끝나 브라우저로는 이 차이를 볼 수 없으므로(스켈레톤이 한 프레임도 안 뜬다) 화면
// 소스로 지킨다: 탭을 누를 때마다 `setBook(null)`로 되돌리면 클라우드에서 매 진입마다
// 스켈레톤이다(사용자 지적 2026-09-05 — "명단이 계속 스켈레톤으로 나온다").
const viewSrc = readFileSync(new URL('src/views/membersView.jsx', ROOT), 'utf8');
// 주석은 걷어낸다 — 이 파일의 주석이 왜 그렇게 하지 않는지를 설명하며 같은 글자를 쓴다
const viewCode = viewSrc.replace(/^\s*\/\/.*$/gm, '');
check('멤버 화면이 명단 캐시를 읽고 쓴다',
  /import \{[^}]*readCache[^}]*writeCache[^}]*\} from '\.\.\/services\/cache\.js'/.test(viewCode));
check('명단을 다시 받을 때 스켈레톤으로 되돌리지 않는다', !/setBook\(null\)/.test(viewCode));

// ── 2. 브라우저 ─────────────────────────────────────────────────────────────
const prof = mkdtempSync(join(tmpdir(), 'croster-'));
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

// 글자로 버튼을 찾는다 — 못 찾으면 던지지 말고 false를 돌려준다(§6-40)
const clickText = (label, scope = 'document') => ev(`(() => {
  const root = ${scope}; if (!root) return false;
  const b = [...root.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return false; b.click(); return true;
})()`);
const inRow = (pid) => `document.querySelector('[data-person="${pid}"]')`;
// 연도는 세그먼트 컨트롤이다(네이티브 select가 아니다)
const pickYear = (y) => ev(`(() => {
  const b = document.querySelector('[data-year="${y}"]'); if (!b) return false; b.click(); return true;
})()`);
// 생일은 우리 데이트피커로 고른다(글자로 받지 않는다 — 연도 없는 모드).
// 달 머리글이 원하는 달이 될 때까지 ◀를 누르고 날을 누른다.
const pickBirthday = (month, day, scope = 'document') => ev(`(async () => {
  const root = ${scope}; if (!root) return 'no-scope';
  const trg = root.querySelector('button[aria-label="생일"]');
  if (!trg) return 'no-trigger';
  if (!root.querySelector('[data-datepicker]')) trg.click();
  await new Promise(r => setTimeout(r, 150));
  const head = () => (root.querySelector('[data-datepicker] span.font-semibold') || {}).textContent?.trim();
  for (let i = 0; i < 24 && head() !== '${month}월'; i++) {
    const prev = root.querySelectorAll('[data-datepicker] button')[0];
    if (!prev) return 'no-prev';
    prev.click();
    await new Promise(r => setTimeout(r, 60));
  }
  if (head() !== '${month}월') return 'month:' + head();
  const cell = [...root.querySelectorAll('[data-datepicker] button')]
    .find(b => b.textContent.trim() === '${day}');
  if (!cell) return 'no-day';
  cell.click();
  await new Promise(r => setTimeout(r, 120));
  return 'ok';
})()`, true);
const fill = (sel, value) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement : (el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement);
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(String(value))});
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  return true;
})()`);
const stored = (table) => ev(`(JSON.parse(localStorage.getItem('church_roster_v1') || '{}')['${table}'] || [])`);

const YEAR = new Date().getFullYear();
const person = (id, name, extra = {}) => ({
  id, name, birthday: null, teams: [], is_pastor: false, profile_id: null,
  note: null, removed_at: null, created_at: '2026-01-01T00:00:00Z', ...extra,
});
const seed = {
  people: [
    person('p1', '김윤주', { birthday: '02-13', teams: ['엔지니어팀'], profile_id: 'u1' }),
    person('p2', '천진영', { birthday: '03-05' }),
    person('p3', '강예은', { birthday: '10-02' }),
    person('p4', '임재훈', { teams: ['찬양팀'], profile_id: 'u2', is_pastor: true }),
    person('p5', '노준석', { birthday: '05-26', teams: ['찬양팀'], profile_id: 'u3' }),
    person('p6', '박 시현', { birthday: '11-06' }),
    person('p7', '남다율', { removed_at: '2026-08-20T00:00:00Z' }),
  ],
  people_roles: [
    { person_id: 'p5', year: YEAR, role: 'president' },
    { person_id: 'p2', year: YEAR, role: 'lead_sunjang' },
    { person_id: 'p1', year: YEAR, role: 'lead_team' },
  ],
  groups: [
    { id: 'g1', type: 'sun', name: 'TT순', year: YEAR, leader_person_id: 'p5', removed_at: null },
    { id: 'g2', type: 'sun', name: '꼬순', year: YEAR, leader_person_id: 'p1', removed_at: null },
  ],
  group_members: [
    { group_id: 'g1', person_id: 'p5' }, { group_id: 'g2', person_id: 'p1' },
  ],
  profiles: [
    { id: 'u1', display_name: '김윤주', email: 'a@x.com', avatar_url: null, approved: true, removed_at: null, created_at: '2026-01-01T00:00:00Z', last_seen_at: null },
    { id: 'u2', display_name: '임재훈', email: 'b@x.com', avatar_url: null, approved: true, removed_at: null, created_at: '2026-01-02T00:00:00Z', last_seen_at: null },
    { id: 'u3', display_name: '노준석', email: 'c@x.com', avatar_url: null, approved: true, removed_at: null, created_at: '2026-01-03T00:00:00Z', last_seen_at: null },
    { id: 'u4', display_name: '조해리', email: 'd@x.com', avatar_url: null, approved: true, removed_at: null, created_at: '2026-01-04T00:00:00Z', last_seen_at: null },
    // 환송한 계정(approved=false + removed_at)과 승인 대기 계정 — 둘 다 연결 후보가 아니다
    { id: 'u5', display_name: '신효진', email: 'e@x.com', avatar_url: null, approved: false, removed_at: '2026-08-01T00:00:00Z', created_at: '2026-01-05T00:00:00Z', last_seen_at: null },
    { id: 'u6', display_name: '대기중', email: 'f@x.com', avatar_url: null, approved: false, removed_at: null, created_at: '2026-01-06T00:00:00Z', last_seen_at: null },
  ],
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
await ev(`(() => {
  localStorage.setItem('theme', 'light');
  localStorage.setItem('church_roster_v1', ${JSON.stringify(JSON.stringify(seed))});
})()`);
// '멤버' 화면은 전역 메뉴다(App.jsx GLOBAL_MENUS) — 주소로 바로 연다.
// 게스트 모드에서는 프로필 메뉴의 '멤버 관리' 줄이 안 보인다(로그인 세션이 없다).
await send('Page.navigate', { url: `${URL_BASE}/?p=members` });
await wait('Page.loadEventFired');
await sleep(1400);

// 1) 기존 '가입자' 구역이 그대로다 — 명단을 붙이면서 깨뜨리면 안 되는 자리
const account = await ev(`(() => {
  const t = document.body.innerText;
  const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  return { head: t.includes('멤버 관리'), together: t.includes('함께하는 사람'),
           admins: t.includes('관리자'), waiting: t.includes('승인을 기다리는 사람'),
           farewell: btns.includes('환송해주기'), invite: btns.includes('다시 초대하기'),
           tabs: btns.includes('가입자') && btns.includes('청년 명단') };
})()`);
check('멤버 화면이 열린다', account.head === true);
check("'가입자' 구역이 그대로다(함께하는 사람 · 관리자 · 환송해주기)",
  account.together && account.admins && account.farewell, JSON.stringify(account));
check('승인 대기·환송한 사람 구역도 그대로다', account.waiting && account.invite, JSON.stringify(account));
check('[가입자 | 청년 명단] 탭', account.tabs === true, JSON.stringify(account));

// ── '몇 분 전 다녀감'이 대시보드와 같은 값인가 (2026-09-05 사용자 지적) ──────
// 이 화면의 계정 목록은 열 때 한 번 받는 스냅샷이라(cloud.listMembersAdmin) 다녀간
// 시각이 굳는다 — 열어 둔 동안 대시보드와 벌어졌다. 그래서 그 칸만 **대시보드가 보는
// 스토어**에서 겹쳐 쓴다(같은 값·같은 실시간 경로). 게스트에는 클라우드가 없으니
// 스토어를 localStorage로 심어, 그 겹쳐 쓰기가 화면까지 오는지 본다.
// 심는 값은 u1(김윤주)뿐이고 그 사람의 created_at은 가장 **오래된** 값이다 —
// 겹쳐 쓰지 않으면 u1이 목록 맨 아래이므로, 순서만 봐도 어느 값을 쓰는지 갈린다.
const seenIso = new Date(Date.now() - 7 * 60000).toISOString();
await ev(`(() => {
  localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify({
    currentUser: { name: '노준석', team: '찬양팀' },
    members: [{ id: 'u1', name: '김윤주', avatarUrl: '', birthday: '', team: '', teams: [] }],
    activityFeed: [], projects: { byId: {}, allIds: [] }, tasks: { byId: {}, allIds: [] },
  }))});
  const s = JSON.parse(localStorage.getItem('church_app_v4'));
  s.members[0].lastSeenAt = ${JSON.stringify(seenIso)};
  localStorage.setItem('church_app_v4', JSON.stringify(s));
})()`);
await send('Page.navigate', { url: `${URL_BASE}/?p=members` });
await wait('Page.loadEventFired');
await sleep(1400);
const seenRow = await ev(`(() => {
  const sec = [...document.querySelectorAll('section')]
    .find(s => (s.querySelector('h3')?.textContent || '').includes('함께하는 사람'));
  if (!sec) return { ok: false };
  const names = [...sec.querySelectorAll('p.font-semibold')].map(p => p.textContent.trim());
  const metas = [...sec.querySelectorAll('p.truncate:not(.font-semibold)')].map(p => p.textContent.trim());
  return { ok: true, names, first: names[0], meta: metas[0], body: document.body.innerText.includes('7분 전 다녀감') };
})()`);
check('멤버 화면의 다녀간 시각이 스토어(대시보드와 같은 값)를 따른다',
  seenRow.body === true && /7분 전 다녀감/.test(seenRow.meta || ''), JSON.stringify(seenRow));
check('그 값으로 정렬까지 한다(가입순이면 맨 아래였을 사람이 맨 위)',
  seenRow.first === '김윤주', JSON.stringify(seenRow.names));
// 심은 스토어를 걷어내고 원래 자리로 — 뒤 검사들이 이 페이지에서 이어진다
await ev(`localStorage.removeItem('church_app_v4')`);
await send('Page.navigate', { url: `${URL_BASE}/?p=members` });
await wait('Page.loadEventFired');
await sleep(1400);

// 2) 명단 목록 — 이름 · 생일 · 팀 · 순 · 직분 배지 · 계정 연결
check("'청년 명단' 탭으로 간다", await clickText('청년 명단'));
await sleep(700);
const read = () => ev(`(() => {
  const rows = [...document.querySelectorAll('[data-person]')].map(r => ({
    id: r.dataset.person,
    text: r.innerText.replace(/\\s+/g, ' ').trim(),
    badges: [...r.querySelectorAll('[data-badge]')].map(b => b.dataset.badge),
    sun: (r.querySelector('[data-sun]') || {}).textContent || '',
    linked: !!r.querySelector('[aria-label="계정 연결됨"]'),
  }));
  const sec = document.querySelector('[data-removed-section]');
  const goneIds = sec ? [...sec.querySelectorAll('[data-person]')].map(r => r.dataset.person) : [];
  return { rows, goneIds };
})()`);
let list = await read();
const rowOf = (l, pid) => l.rows.find(r => r.id === pid) || {};
check('청년 명단이 뜬다(함께하는 6명 · 환송 1명)',
  list.rows.length === 7 && list.goneIds.length === 1 && list.goneIds[0] === 'p7',
  JSON.stringify({ n: list.rows.length, gone: list.goneIds }));
check('이름·생일·팀이 한 줄에',
  rowOf(list, 'p1').text.includes('김윤주') && rowOf(list, 'p1').text.includes('2월 13일')
  && rowOf(list, 'p1').text.includes('엔지니어팀'), rowOf(list, 'p1').text);
check('올해 순이 붙는다', rowOf(list, 'p1').sun === '꼬순' && rowOf(list, 'p5').sun === 'TT순',
  JSON.stringify([rowOf(list, 'p1').sun, rowOf(list, 'p5').sun]));
check('직분 배지 — 교역자·회장·리더순장·리더팀장',
  JSON.stringify(rowOf(list, 'p4').badges) === '["교역자"]'
  && JSON.stringify(rowOf(list, 'p5').badges) === '["회장"]'
  && JSON.stringify(rowOf(list, 'p2').badges) === '["리더순장"]'
  && JSON.stringify(rowOf(list, 'p1').badges) === '["리더팀장"]',
  JSON.stringify(list.rows.map(r => [r.id, r.badges])));
check('계정이 연결된 사람에만 연결 표시',
  rowOf(list, 'p1').linked && rowOf(list, 'p4').linked && !rowOf(list, 'p3').linked,
  JSON.stringify(list.rows.map(r => [r.id, r.linked])));

// 3) 이름 검색 — 공백을 지우고 본다
await fill('input[aria-label="이름으로 찾기"]', '박시현');
await sleep(350);
list = await read();
check('이름으로 찾는다(공백 무시 · 환송한 사람도 같이 걸린다)',
  list.rows.length === 1 && list.rows[0].id === 'p6' && list.goneIds.length === 0,
  JSON.stringify(list.rows.map(r => r.id)));
await fill('input[aria-label="이름으로 찾기"]', '');
await sleep(300);

// 4) 사람 추가 — 이름 필수 · **생일은 데이트피커로 고른다**(글자로 받지 않는다.
//    사용자 지시 2026-09-05 — 틀린 값이 아예 만들어지지 않으니 '예: 05-26' 안내와
//    '생일은 05-26처럼 적어주세요' 오류 줄도 같이 없어졌다).
check("'사람 추가'", await clickText('사람 추가'));
await sleep(300);
const emptyForm = await ev(`(() => ({
  off: [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '추가')?.disabled,
  typed: !!document.querySelector('input[aria-label="생일"]'),
  picker: !!document.querySelector('button[aria-label="생일"]'),
  hint: document.body.innerText.includes('05-26'),
}))()`);
check('이름이 비면 추가할 수 없다', emptyForm.off === true, JSON.stringify(emptyForm));
check('생일은 글자칸이 아니라 데이트피커다',
  emptyForm.typed === false && emptyForm.picker === true && emptyForm.hint === false,
  JSON.stringify(emptyForm));
await fill('input[aria-label="이름"]', '주재영');
await sleep(250);
const picked = await pickBirthday(6, 28);
check('생일을 데이트피커로 고른다(6월 28일)', picked === 'ok', String(picked));
check('고른 생일이 버튼에 그대로 보인다',
  await ev(`(document.querySelector('button[aria-label="생일"]') || {}).innerText?.trim()`) === '6월 28일');
const okForm = await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '추가')?.disabled`);
check('이름을 채우면 추가할 수 있다', okForm === false, String(okForm));
check('추가', await clickText('추가'));
await sleep(700);
const added = (await stored('people')).find(p => p.name === '주재영');
check('추가한 사람이 청년 명단에 남는다(생일은 MM-DD로 맞춰서)',
  !!added && added.birthday === '06-28', JSON.stringify(added));
list = await read();
check('추가한 사람이 목록에 선다',
  list.rows.some(r => r.text.includes('주재영') && r.text.includes('6월 28일')),
  JSON.stringify(list.rows.map(r => r.text).slice(0, 3)));

// 5) 직분 지정 — 연도별(부장·회장·총무·리더순장·리더팀장) + 교역자(연도 무관)
//    패널의 짜임도 같이 본다: 칩 한 줄 · 이름·생일·메모 한 줄 · 환송은 머리줄(맨 아래가 아니다).
check('강예은 줄을 편다', await clickText('수정하기', inRow('p3')));
await sleep(350);
const panel = await ev(`(() => {
  const r = ${inRow('p3')}; if (!r) return null;
  const chips = [...r.querySelectorAll('[aria-pressed]')].map(b => b.textContent.trim());
  const btns = [...r.querySelectorAll('button')].map(b => b.textContent.trim());
  // 생일만 데이트피커(버튼)이고 나머지 둘은 글자칸이다
  const labels = [
    r.querySelector('input[aria-label="이름"]') ? '이름' : null,
    r.querySelector('button[aria-label="생일"]') ? '생일' : null,
    r.querySelector('input[aria-label="메모"]') ? '메모' : null,
  ].filter(Boolean);
  return { chips, labels, farewell: btns.indexOf('환송해주기'), save: btns.indexOf('저장'),
           cancel: btns.indexOf('취소') };
})()`);
check('직분 칩이 교역자·부장·회장·총무·리더순장·리더팀장 한 줄',
  JSON.stringify((panel.chips || []).slice(-6))
    === JSON.stringify(['교역자', '부장', '회장', '총무', '리더순장', '리더팀장']),
  JSON.stringify(panel.chips));
check('이름·생일·메모가 한 줄에 셋', JSON.stringify(panel.labels) === '["이름","생일","메모"]',
  JSON.stringify(panel.labels));
check('환송해주기는 패널 맨 아래가 아니라 머리줄이다(저장보다 먼저 나온다)',
  panel.farewell >= 0 && panel.save >= 0 && panel.farewell < panel.save,
  JSON.stringify({ farewell: panel.farewell, save: panel.save }));
check('도구 줄은 저장 왼쪽 · 취소 오른쪽 끝(§8)',
  panel.save >= 0 && panel.cancel === panel.save + 1,
  JSON.stringify({ save: panel.save, cancel: panel.cancel }));
// 데이트피커를 열면 **그 사람의 생일 달**이 떠야 한다(강예은은 10월 2일).
// 이번 달이 뜨면 그 사람의 생일을 보러 온 사람이 달을 다시 찾아야 한다.
const openedAt = await ev(`(() => {
  const r = ${inRow('p3')}; if (!r) return null;
  r.querySelector('button[aria-label="생일"]')?.click();
  return true;
})()`);
await sleep(400);
const dpick = await ev(`(() => {
  const box = ${inRow('p3')}?.querySelector('[data-datepicker]');
  if (!box) return null;
  return { head: box.querySelector('span.font-semibold')?.textContent.trim(),
           weekday: box.innerText.includes('월 화 수'),
           picked: [...box.querySelectorAll('button')].find(b => /bg-accent/.test(b.className))?.textContent.trim() };
})()`);
check('생일 피커는 그 사람의 생일 달로 열린다(연도·요일 줄 없이)',
  !!openedAt && dpick?.head === '10월' && dpick?.picked === '2' && dpick?.weekday === false,
  JSON.stringify(dpick));
await ev(`document.body.click()`);
await sleep(250);
await sleep(350);
check('회장으로 지정', await clickText('회장', inRow('p3')));
await sleep(600);
let roles = await stored('people_roles');
check('연도별 직분이 저장된다',
  roles.some(r => r.person_id === 'p3' && r.year === YEAR && r.role === 'president'), JSON.stringify(roles));
list = await read();
check('배지가 바로 붙는다', rowOf(list, 'p3').badges.includes('회장'), JSON.stringify(rowOf(list, 'p3').badges));
check('교역자 토글', await clickText('교역자', inRow('p3')));
await sleep(600);
check('교역자는 명단 속성이다(is_pastor)',
  (await stored('people')).find(p => p.id === 'p3')?.is_pastor === true);
check('다시 누르면 직분이 풀린다', await clickText('회장', inRow('p3')));
await sleep(600);
roles = await stored('people_roles');
check('직분 지정이 해제된다',
  !roles.some(r => r.person_id === 'p3' && r.role === 'president'), JSON.stringify(roles));
check('펼친 줄을 닫는다', await clickText('닫기', inRow('p3')));
await sleep(300);

// 6) 연도 — 세그먼트 컨트롤이다(값이 셋뿐이라 네이티브 select를 걷어냈다).
//    직분은 그 해의 것만 보인다(교역자는 연도와 무관하다).
const years = await ev(`[...document.querySelectorAll('[data-year]')].map(b => b.dataset.year)`);
check('연도는 올해와 다음 두 해 세 칸',
  JSON.stringify(years) === JSON.stringify([YEAR, YEAR + 1, YEAR + 2].map(String)), JSON.stringify(years));
check(`${YEAR + 1}년으로`, await pickYear(YEAR + 1));
await sleep(800);
list = await read();
check('연도를 바꾸면 그 해 직분만 보인다',
  rowOf(list, 'p5').badges.length === 0 && rowOf(list, 'p1').badges.length === 0,
  JSON.stringify(list.rows.map(r => [r.id, r.badges])));
check('교역자 배지는 연도를 타지 않는다',
  JSON.stringify(rowOf(list, 'p4').badges) === '["교역자"]', JSON.stringify(rowOf(list, 'p4').badges));
check(`${YEAR}년으로 되돌린다`, await pickYear(YEAR));
await sleep(800);
list = await read();
check('연도를 되돌리면 직분이 돌아온다', rowOf(list, 'p5').badges.includes('회장'),
  JSON.stringify(rowOf(list, 'p5').badges));

// 7) 계정 연결 — 연결된 계정은 후보에서 빠진다(이름이 같아도 자동 연결은 없다)
check('강예은 줄을 편다', await clickText('수정하기', inRow('p3')));
await sleep(400);
check("'계정 연결'", await clickText('계정 연결', inRow('p3')));
await sleep(350);
const cands = await ev(`(() => {
  const r = ${inRow('p3')}; if (!r) return null;
  const box = r.querySelector('.overflow-y-auto');
  return box ? [...box.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t !== '닫기') : null;
})()`);
check('연결 후보는 아직 연결되지 않은 계정뿐',
  Array.isArray(cands) && cands.length === 1 && cands[0].includes('조해리'), JSON.stringify(cands));
await ev(`(() => { const r=${inRow('p3')}; const box=r.querySelector('.overflow-y-auto');
  box.querySelector('button').click(); })()`);
await sleep(700);
check('고른 계정이 연결된다',
  (await stored('people')).find(p => p.id === 'p3')?.profile_id === 'u4');
list = await read();
check('연결 표시가 바로 붙는다', rowOf(list, 'p3').linked === true);

// 후보가 하나도 없을 때 — **사실만 말한다.** 예전에는 "가입한 계정이 모두 명단에 이어져
// 있어요"였는데, 승인 대기·환송한 계정은 후보가 아니면서 연결되어 있지도 않아 거짓이었다.
check('박 시현 줄을 편다', await clickText('수정하기', inRow('p6')));
await sleep(400);
const noCand = await ev(`(${inRow('p6')} || {}).innerText || ''`);
check('후보가 없으면 "연결할 수 있는 가입자가 없어요"라고만 한다',
  /연결할 수 있는 가입자가 없어요/.test(noCand) && !/모두/.test(noCand),
  noCand.replace(/\s+/g, ' ').slice(0, 140));

check('강예은 줄을 다시 편다', await clickText('수정하기', inRow('p3')));
await sleep(400);
check("'연결 해제'", await clickText('연결 해제', inRow('p3')));
await sleep(700);
check('연결을 해제하면 비워진다',
  (await stored('people')).find(p => p.id === 'p3')?.profile_id === null);

// 8) 환송 · 되돌리기 — 행은 지우지 않는다(출석이 매달려 있다)
check('천진영 줄을 편다', await clickText('수정하기', inRow('p2')));
await sleep(400);
check('환송해주기', await clickText('환송해주기', inRow('p2')));
await sleep(350);
const confirmed = await ev(`(() => {
  const pop = [...document.body.children].find(c => /z-\\[90\\]/.test(c.className || ''));
  if (!pop) return false;
  const ask = pop.innerText.includes('지난 출석 기록은 그대로 남아요');
  const b = [...pop.querySelectorAll('button')].find(x => x.textContent.trim() === '환송');
  if (!b) return false; b.click(); return ask;
})()`);
check('환송은 확인 팝오버를 거친다', confirmed === true);
await sleep(700);
list = await read();
check('환송하면 환송한 사람으로 옮겨간다', list.goneIds.includes('p2'), JSON.stringify(list.goneIds));
check('행은 지우지 않는다(removed_at만 찍는다)',
  !!(await stored('people')).find(p => p.id === 'p2')?.removed_at);
check('되돌리기', await clickText('되돌리기', inRow('p2')));
await sleep(700);
list = await read();
check('되돌리면 청년 명단으로 돌아온다',
  !list.goneIds.includes('p2') && (await stored('people')).find(p => p.id === 'p2').removed_at === null,
  JSON.stringify(list.goneIds));

// 9) 탭을 나갔다 들어와도 스켈레톤으로 되돌아가지 않는다(캐시가 첫 화면이다)
const reentry = await ev(`(async () => {
  const hit = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
  const acc = hit('가입자'); if (acc) acc.click();
  await new Promise(r => requestAnimationFrame(r));
  const ros = hit('청년 명단'); if (ros) ros.click();
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  return { rows: document.querySelectorAll('[data-person]').length,
           skel: document.querySelectorAll('.dc-skeleton').length };
})()`, true);
check('다시 들어오면 스켈레톤 없이 명단이 바로 선다',
  reentry.rows > 0 && reentry.skel === 0, JSON.stringify(reentry));

// ── 모바일 375px ────────────────────────────────────────────────────────────
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `${URL_BASE}/?p=members` });
await wait('Page.loadEventFired');
await sleep(1400);
check('모바일에서도 청년 명단 탭', await clickText('청년 명단'));
await sleep(900);
const mob = await ev(`(() => {
  const d = document.documentElement;
  return { over: d.scrollWidth > d.clientWidth + 1, rows: document.querySelectorAll('[data-person]').length,
           find: !!document.querySelector('input[aria-label="이름으로 찾기"]') };
})()`);
check('모바일 375px에서 가로로 넘치지 않는다', mob.over === false, JSON.stringify(mob));
check('모바일에서도 명단과 검색이 보인다', mob.rows > 0 && mob.find, JSON.stringify(mob));
await send('Emulation.clearDeviceMetricsOverride');

check('콘솔 오류 0', logs.length === 0, logs.slice(0, 2).join(' | '));
console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill();
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
