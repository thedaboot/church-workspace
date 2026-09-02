// 명단 관리 — 멤버 화면의 '명단' 탭 (docs/V2.md 결정 1·13 · 권한 표 = 마스터+관리자)
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
check('연결 후보에서 이미 이어진 계정이 빠진다', !cand.includes('u1') && !cand.includes('u2'), JSON.stringify(cand));
check('환송·승인 대기 계정도 후보가 아니다', !cand.includes('u5') && !cand.includes('u6'), JSON.stringify(cand));
check('남는 후보는 조해리 하나', JSON.stringify(cand) === '["u4"]', JSON.stringify(cand));

const sunMap = R.sunNames(
  [{ id: 'g1', name: 'TT순' }, { id: 'g2', name: '꼬순' }],
  [{ group_id: 'g1', person_id: 'p1' }, { group_id: 'g2', person_id: 'p2' }, { group_id: 'gX', person_id: 'p3' }],
);
check('사람마다 올해 순이 붙는다', sunMap.get('p1')[0] === 'TT순' && sunMap.get('p2')[0] === '꼬순');
check('그 해에 없는 순은 안 붙는다', sunMap.get('p3') === undefined);

const roleMap = R.rolesByPerson([
  { person_id: 'p1', year: 2026, role: 'officer' },
  { person_id: 'p3', year: 2026, role: 'president' },
]);
check('교역자 배지가 먼저 온다',
  JSON.stringify(R.personBadges(people[2], roleMap.get('p3'))) === '["교역자","회장"]',
  JSON.stringify(R.personBadges(people[2], roleMap.get('p3'))));
check('직분이 없으면 배지도 없다', R.personBadges(people[1], roleMap.get('p2')).length === 0);

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
    { person_id: 'p1', year: YEAR, role: 'officer' },
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

// 1) 기존 '계정' 구역이 그대로다 — 명단을 붙이면서 깨뜨리면 안 되는 자리
const account = await ev(`(() => {
  const t = document.body.innerText;
  const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  return { head: t.includes('멤버 관리'), together: t.includes('함께하는 사람'),
           admins: t.includes('관리자'), waiting: t.includes('승인을 기다리는 사람'),
           farewell: btns.includes('환송해주기'), invite: btns.includes('다시 초대하기'),
           tabs: btns.includes('계정') && btns.includes('명단') };
})()`);
check('멤버 화면이 열린다', account.head === true);
check("'계정' 구역이 그대로다(함께하는 사람 · 관리자 · 환송해주기)",
  account.together && account.admins && account.farewell, JSON.stringify(account));
check('승인 대기·환송한 사람 구역도 그대로다', account.waiting && account.invite, JSON.stringify(account));
check('[계정 | 명단] 탭', account.tabs === true, JSON.stringify(account));

// 2) 명단 목록 — 이름 · 생일 · 팀 · 순 · 직분 배지 · 계정 연결
check("'명단' 탭으로 간다", await clickText('명단'));
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
check('명단이 뜬다(함께하는 6명 · 환송 1명)',
  list.rows.length === 7 && list.goneIds.length === 1 && list.goneIds[0] === 'p7',
  JSON.stringify({ n: list.rows.length, gone: list.goneIds }));
check('이름·생일·팀이 한 줄에',
  rowOf(list, 'p1').text.includes('김윤주') && rowOf(list, 'p1').text.includes('2월 13일')
  && rowOf(list, 'p1').text.includes('엔지니어팀'), rowOf(list, 'p1').text);
check('올해 순이 붙는다', rowOf(list, 'p1').sun === '꼬순' && rowOf(list, 'p5').sun === 'TT순',
  JSON.stringify([rowOf(list, 'p1').sun, rowOf(list, 'p5').sun]));
check('직분 배지 — 교역자·회장·리더순장·임원',
  JSON.stringify(rowOf(list, 'p4').badges) === '["교역자"]'
  && JSON.stringify(rowOf(list, 'p5').badges) === '["회장"]'
  && JSON.stringify(rowOf(list, 'p2').badges) === '["리더순장"]'
  && JSON.stringify(rowOf(list, 'p1').badges) === '["임원"]',
  JSON.stringify(list.rows.map(r => [r.id, r.badges])));
check('계정이 이어진 사람에만 연결 표시',
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

// 4) 사람 추가 — 이름 필수 · 생일은 MM-DD
check("'사람 추가'", await clickText('사람 추가'));
await sleep(300);
await fill('input[aria-label="이름"]', '주재영');
await fill('input[aria-label="생일"]', '13-40');
await sleep(250);
const badForm = await ev(`(() => ({
  msg: document.body.innerText.includes('생일은 05-26처럼 적어주세요'),
  off: [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '추가')?.disabled,
}))()`);
check('생일 형식이 어긋나면 추가할 수 없다', badForm.off === true && badForm.msg === true, JSON.stringify(badForm));
await fill('input[aria-label="생일"]', '6-28');
await sleep(250);
const okForm = await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '추가')?.disabled`);
check('형식을 맞추면 추가할 수 있다', okForm === false, String(okForm));
check('추가', await clickText('추가'));
await sleep(700);
const added = (await stored('people')).find(p => p.name === '주재영');
check('추가한 사람이 명단에 남는다(생일은 MM-DD로 맞춰서)',
  !!added && added.birthday === '06-28', JSON.stringify(added));
list = await read();
check('추가한 사람이 목록에 선다',
  list.rows.some(r => r.text.includes('주재영') && r.text.includes('6월 28일')),
  JSON.stringify(list.rows.map(r => r.text).slice(0, 3)));

// 5) 직분 지정 — 연도별(회장·리더순장·임원) + 교역자(연도 무관)
check('강예은 줄을 편다', await clickText('고치기', inRow('p3')));
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

// 6) 연도 — 직분은 그 해의 것만 보인다(교역자는 연도와 무관하다)
await fill('select[aria-label="연도"]', String(YEAR + 1));
await sleep(800);
list = await read();
check('연도를 바꾸면 그 해 직분만 보인다',
  rowOf(list, 'p5').badges.length === 0 && rowOf(list, 'p1').badges.length === 0,
  JSON.stringify(list.rows.map(r => [r.id, r.badges])));
check('교역자 배지는 연도를 타지 않는다',
  JSON.stringify(rowOf(list, 'p4').badges) === '["교역자"]', JSON.stringify(rowOf(list, 'p4').badges));
await fill('select[aria-label="연도"]', String(YEAR));
await sleep(800);
list = await read();
check('연도를 되돌리면 직분이 돌아온다', rowOf(list, 'p5').badges.includes('회장'),
  JSON.stringify(rowOf(list, 'p5').badges));

// 7) 계정 연결 — 이어진 계정은 후보에서 빠진다(이름이 같아도 자동 연결은 없다)
check('강예은 줄을 편다', await clickText('고치기', inRow('p3')));
await sleep(400);
check("'계정 잇기'", await clickText('계정 잇기', inRow('p3')));
await sleep(350);
const cands = await ev(`(() => {
  const r = ${inRow('p3')}; if (!r) return null;
  const box = r.querySelector('.overflow-y-auto');
  return box ? [...box.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t !== '닫기') : null;
})()`);
check('연결 후보는 아직 안 이어진 계정뿐',
  Array.isArray(cands) && cands.length === 1 && cands[0].includes('조해리'), JSON.stringify(cands));
await ev(`(() => { const r=${inRow('p3')}; const box=r.querySelector('.overflow-y-auto');
  box.querySelector('button').click(); })()`);
await sleep(700);
check('고른 계정이 이어진다',
  (await stored('people')).find(p => p.id === 'p3')?.profile_id === 'u4');
list = await read();
check('연결 표시가 바로 붙는다', rowOf(list, 'p3').linked === true);
check("'연결 해제'", await clickText('연결 해제', inRow('p3')));
await sleep(700);
check('연결을 해제하면 비워진다',
  (await stored('people')).find(p => p.id === 'p3')?.profile_id === null);

// 8) 환송 · 되돌리기 — 행은 지우지 않는다(출석이 매달려 있다)
check('천진영 줄을 편다', await clickText('고치기', inRow('p2')));
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
check('되돌리면 명단으로 돌아온다',
  !list.goneIds.includes('p2') && (await stored('people')).find(p => p.id === 'p2').removed_at === null,
  JSON.stringify(list.goneIds));

// ── 모바일 375px ────────────────────────────────────────────────────────────
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `${URL_BASE}/?p=members` });
await wait('Page.loadEventFired');
await sleep(1400);
check('모바일에서도 명단 탭', await clickText('명단'));
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
