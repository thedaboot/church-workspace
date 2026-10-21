// 새가족 정착 보드 · 새가족 정보 입력 · 가입 QR (v5 4묶음 · 0120 · 사용자 승인 시안 mock/b5)
//   node tests/welcome.mjs http://localhost:4598
// 게스트 모드(localStorage)에 카드·명단·순을 심어 놓고 눌러 본다 — 클라우드 쪽(RLS·정의자 함수)은 0120 리허설이 본다.
// 앞부분은 순수 갈래(services/welcome.js · groups.groupPerms)를 페이지 안에서 불러 본다(vite가 모듈을 그대로 준다).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.argv[2] || 'http://localhost:4598';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9461;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, p, d = '') => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cwel-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let page; for (let i = 0; i < 40 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {} await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const logs = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || 'exception');
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value || a.description).join(' '));
});
const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r?.result?.value; };
const go = async (q) => { await send('Page.navigate', { url: `${URL_BASE}/${q}` }); await sleep(1700); };

const YEAR = Number(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 4));
const TODAY = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 10);
const P = (id, name, extra = {}) => ({ id, name, birthday: null, teams: [], gender: null, is_pastor: false, profile_id: null, removed_at: null, ...extra });
const card = (id, name, stage, extra = {}) => ({ id, name, phone: '010-0000-0000', how: '친구 소개', note: '', stage, created_at: '2026-09-01', visits: ['2026-09-01'],
  contact: null, registered_at: null, meets: [], settled_at: null, owner: null, person_id: null, position: 0, ...extra });
// me: 기본은 총무(리더진) — 탭이 서는 쪽
const seed = (me = { isMaster: false, isAdmin: false, personId: 'p0', roles: ['treasurer'] }, people = []) => ({
  groups: {
    people: [P('p0', '노준석'), P('p1', '천진영'), P('p2', '김윤주'), P('pr', '문가온', { newcomer_at: '2026-10-01' }), P('ps', '윤채원'), ...people],
    groups: [
      { id: 's1', type: 'sun', name: '새싹순', year: YEAR, leader_person_id: 'p1', removed_at: null },
      { id: 's2', type: 'sun', name: '꼬순', year: YEAR, leader_person_id: 'p2', removed_at: null },
    ],
    group_members: [{ group_id: 's1', person_id: 'p1' }, { group_id: 's2', person_id: 'p2' }, { group_id: 's2', person_id: 'ps' }],
    group_meetings: [], files: [], people_roles: [], club_applications: [], me,
  },
  cards: [
    card('c1', '박도현', 'visit1'),
    card('c2', '정우진', 'visit2', { visits: ['2026-09-01', '2026-09-08'] }),
    card('c3', '한서아', 'contact', { contact: { by: '김유나', at: '2026-09-10' }, owner: '김유나' }),
    card('c4', '문가온', 'meet', { person_id: 'pr', registered_at: '2026-10-01', meets: ['2026-10-05', '2026-10-12'] }),
    card('c5', '윤채원', 'settled', { person_id: 'ps', registered_at: '2026-08-01', settled_at: '2026-10-01' }),
  ],
});
const plant = async (s) => ev(`(() => {
  localStorage.clear(); localStorage.setItem('theme', 'light');
  localStorage.setItem('church_groups_v1', ${JSON.stringify(JSON.stringify(s.groups))});
  localStorage.setItem('church_welcome_v1', ${JSON.stringify(JSON.stringify(s.cards))});
  localStorage.setItem('church_welcome_seeded', '1');
  return true;
})()`);
const openTab = async () => { await go('?p=groups'); return ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '새가족'); if (!b) return false; b.click(); return true; })()`); };
const stored = (cid) => ev(`(JSON.parse(localStorage.getItem('church_welcome_v1')) || []).find(c => c.id === '${cid}')`);
const gstore = () => ev(`JSON.parse(localStorage.getItem('church_groups_v1'))`);
const cardAt = (cid) => ev(`(() => { const el = [...document.querySelectorAll('[data-welcome-card="${cid}"]')].find(x => x.offsetParent); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; })()`);
const at = (sel) => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.offsetParent); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 20) }; })()`);
async function mouseDrag(from, to) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 16; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 16, y: from.y + (to.y - from.y) * i / 16, button: 'left', buttons: 1 }); await sleep(20); }
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  await sleep(700);
}
async function touchDrag(from, to) {
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) });
  await sleep(320);
  for (let i = 1; i <= 14; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + (to.x - from.x) * i / 14, from.y + (to.y - from.y) * i / 14) }); await sleep(28); }
  await sleep(180);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
}

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await go('');

// ── 1. 순수 갈래 ────────────────────────────────────────────────────────────
// **되돌리기**: meetRemovePatch의 `stage: 'register'` 갈래를 빼면 첫 셋째가, contactPatch의 `owner: by`를 `owner: c.owner || by`처럼
// 처음 사람으로 묶으면 넷째가 깨진다.
const pure = await ev(`(async () => {
  const W = await import('/src/services/welcome.js');
  const G = await import('/src/services/groups.js');
  const c = { stage: 'visit1', visits: ['2026-09-01'], meets: ['2026-10-05', '2026-10-12'], settled_at: null, owner: '김유나' };
  const perms = (o) => G.groupPerms(o).canSeeWelcome;
  return {
    v2: W.stagePatch(c, 'visit2', '2026-09-08').visits,
    v2again: !('visits' in W.stagePatch({ ...c, visits: ['a', 'b'] }, 'visit2', 'x')),
    settled: W.stagePatch(c, 'settled', '2026-10-20').settled_at,
    removeOne: W.meetRemovePatch({ ...c, stage: 'meet' }, 0),
    removeLast: W.meetRemovePatch({ ...c, stage: 'meet', meets: ['2026-10-05'] }, 0),
    dateSort: W.meetDatePatch({ ...c }, 1, '2026-10-01').meets,
    owner: W.contactPatch('노준석', '2026-10-21').owner,
    addFromRegister: W.meetAddPatch({ ...c, stage: 'register', meets: [] }, '2026-10-21').stage,
    needs: [W.needsPerson('contact'), W.needsPerson('register'), W.needsPerson('settled'), W.needsPerson('hold')],
    labels: W.STAGES.map(s => s[1]),
    see: {
      plain: perms({ myPerson: { teams: [] }, myRoles: [] }),
      welcome: perms({ myPerson: { teams: ['웰컴팀'] }, myRoles: [] }),
      officer: perms({ myPerson: { teams: [] }, myRoles: ['treasurer'] }),
      visionOnly: perms({ myPerson: { teams: [] }, myRoles: ['vision_maker'] }),
      pastor: perms({ myPerson: { teams: [], is_pastor: true }, myRoles: [] }),
      admin: perms({ isAdmin: true }),
    },
  };
})()`);
check('재방문 완료로 옮기면 방문 날짜가 하나 붙는다(이미 둘이면 그대로)', JSON.stringify(pure.v2) === '["2026-09-01","2026-09-08"]' && pure.v2again === true, JSON.stringify([pure.v2, pure.v2again]));
check('정착 완료로 옮기면 정착 날짜가 선다', pure.settled === '2026-10-20');
check('교육 기록을 다 지우면 등록 완료 칸으로 돌아간다(하나 남으면 그대로)', pure.removeLast.stage === 'register' && !('stage' in pure.removeOne) && pure.removeOne.meets.length === 1, JSON.stringify([pure.removeOne, pure.removeLast]));
check('컨택 완료를 누른 사람이 담당이 된다(먼저 사람이 있어도)', pure.owner === '노준석', pure.owner);
check('교육 날짜를 고치면 날짜순으로 다시 센다', JSON.stringify(pure.dateSort) === '["2026-10-01","2026-10-05"]', JSON.stringify(pure.dateSort));
check('등록 완료 칸에서 교육 완료를 누르면 교육 완료 칸으로', pure.addFromRegister === 'meet');
check('명단이 있어야 하는 칸은 등록 완료부터(보류 아님)', JSON.stringify(pure.needs) === '[false,true,true,false]', JSON.stringify(pure.needs));
check('칸 이름 = 버튼 이름(OO 완료 · 사용자 결정)', pure.labels.join() === '첫 방문 완료,재방문 완료,컨택 완료,등록 완료,교육 완료,배정 완료,정착 완료', pure.labels.join());
check('새가족 탭 자격 — 웰컴팀·리더진·교역자·관리자만(비전 메이커만은 아님 · 0120 can_see_welcome과 같은 판정)',
  !pure.see.plain && pure.see.welcome && pure.see.officer && !pure.see.visionOnly && pure.see.pastor && pure.see.admin, JSON.stringify(pure.see));

// ── 2. 탭 자격 ─────────────────────────────────────────────────────────────
await plant(seed({ isMaster: false, isAdmin: false, personId: 'p0', roles: [] }));
check('직분도 웰컴팀도 아니면 새가족 탭이 없다', (await openTab()) === false);
await plant(seed({ isMaster: false, isAdmin: false, personId: 'pw', roles: [] }, [P('pw', '김유나', { teams: ['웰컴팀'] })]));
check('웰컴팀 소속이면 새가족 탭이 선다', (await openTab()) === true);

// ── 3. 데스크톱 보드 ────────────────────────────────────────────────────────
await plant(seed());
check('리더진이면 새가족 탭이 선다', (await openTab()) === true);
await sleep(600);
const heads = await ev(`[...document.querySelectorAll('[data-stage] h3')].filter(h => h.offsetParent).map(h => h.textContent)`);
check('데스크톱: 일곱 칸 머리', heads.length === 7 && heads[0] === '첫 방문 완료', JSON.stringify(heads));
await mouseDrag(await cardAt('c1'), await at('[data-stage="visit2"] h3'));
check('끌어서 재방문 완료 칸으로', (await stored('c1'))?.stage === 'visit2', (await stored('c1'))?.stage);
await mouseDrag(await cardAt('c2'), await at('[data-hold-row]'));
check('보류 줄에 놓으면 보류', (await stored('c2'))?.stage === 'hold', (await stored('c2'))?.stage);
// 등록 전 카드를 교육 완료 칸으로 → 먼저 명단에 새신자로
await mouseDrag(await cardAt('c3'), await at('[data-stage="meet"] h3'));
const c3 = await stored('c3');
const g1 = await gstore();
const p3 = (g1.people || []).find(p => p.id === c3?.person_id);
check('등록 전 카드를 교육 완료 칸으로 끌면 명단에 새신자로 먼저 들어간다(newcomer_at = 오늘)', c3?.stage === 'meet' && p3?.newcomer_at === TODAY, JSON.stringify({ stage: c3?.stage, p3 }));
// 순 없이 배정 완료 칸으로 → 창이 열리고 순을 골라 [배정 완료]
await mouseDrag(await cardAt('c4'), await at('[data-stage="sun"] h3'));
const sunModal = { modal: await ev(`new Promise(res => { const t0 = performance.now(); const tick = () => { if (document.querySelector('[data-welcome-suns]')) return res(Math.round(performance.now() - t0)); if (performance.now() - t0 > 3000) return res(false); requestAnimationFrame(tick); }; tick(); })`), stage: (await stored('c4'))?.stage };
check('순 없이 배정 완료 칸으로 끌면 순 고르기 창(아직 안 옮긴다)', sunModal.modal !== false && sunModal.stage === 'meet', JSON.stringify(sunModal));
await ev(`document.querySelector('[data-sun-pick="s1"]').click(); true`); await sleep(200);
check('순을 고르기만 하면 그대로', (await stored('c4'))?.stage === 'meet');
await ev(`document.querySelector('[data-sun-assign]').click(); true`); await sleep(1200);
let g2 = await gstore();
check('[배정 완료] — 순 편성과 같은 칸(group_members)에 들어가고 배정 완료 칸으로', (await stored('c4'))?.stage === 'sun' && g2.group_members.some(m => m.group_id === 's1' && m.person_id === 'pr'),
  JSON.stringify(g2.group_members.filter(m => m.person_id === 'pr')));
// 다른 순으로 옮기기
await ev(`document.querySelector('[data-sun-pick="s2"]').click(); true`); await sleep(200);
await ev(`document.querySelector('[data-sun-assign]').click(); true`); await sleep(1200);
g2 = await gstore();
const prSuns = g2.group_members.filter(m => m.person_id === 'pr').map(m => m.group_id);
check('다른 순을 고르면 옮긴다(그 해 순은 하나)', JSON.stringify(prSuns) === '["s2"]', JSON.stringify(prSuns));
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`); await sleep(500);

// 컨택 완료 = 누른 사람이 담당(c1은 지금 재방문 완료 칸)
await ev(`document.querySelector('[data-welcome-card="c1"]').click(); true`); await sleep(600);
// 바닥 줄의 버튼(단계 줄에도 같은 이름이 있다 — 그쪽은 단계만 옮긴다)
await ev(`[...document.querySelectorAll('[data-welcome-modal] .bg-surface-2 button')].find(b => b.textContent.trim() === '컨택 완료').click(); true`); await sleep(500);
const c1 = await stored('c1');
check('컨택 완료를 누르면 누른 사람(노준석)이 담당 · 컨택 완료 칸', c1?.stage === 'contact' && c1?.owner === '노준석' && c1?.contact?.by === '노준석', JSON.stringify(c1));
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`); await sleep(500);

// 정착 완료 창 — 할 일이 없으면 바닥 줄이 없다
await ev(`document.querySelector('[data-welcome-card="c5"]').click(); true`); await sleep(600);
const foot = await ev(`!!document.querySelector('[data-welcome-modal] .bg-surface-2')`);
const c5sun = await ev(`[...document.querySelectorAll('[data-sun-pick]')].find(b => b.getAttribute('aria-pressed') === 'true')?.dataset.sunPick`);
check('정착 완료 창에는 빈 바닥 줄이 없다 · 지금 순(꼬순)이 골라져 있다', foot === false && c5sun === 's2', JSON.stringify({ foot, c5sun }));
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`); await sleep(500);

// 교육 회차 지우기
await plant(seed()); await openTab(); await sleep(600);
await ev(`document.querySelector('[data-welcome-card="c4"]').click(); true`); await sleep(600);
await ev(`document.querySelector('[data-meet-remove="1"]').click(); true`); await sleep(300);
await ev(`document.querySelector('[data-meet-remove="0"]').click(); true`); await sleep(300);
const c4 = await stored('c4');
check('교육 회차를 ✕로 다 지우면 등록 완료 칸으로', c4?.meets.length === 0 && c4?.stage === 'register', JSON.stringify(c4));
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`); await sleep(500);

// ── 4. 폰 ──────────────────────────────────────────────────────────────────
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await plant(seed()); await openTab(); await sleep(700);
await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('재방문 완료')).click(); true`); await sleep(700);
const from = await ev(`(() => { const r = document.querySelector('[data-stage="visit2"] [data-welcome-card="c2"]').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
const chip = await ev(`(() => { const r = [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('첫 방문 완료')).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await touchDrag(from, chip);
check('폰: 길게 눌러 위 라벨에 놓으면 옮겨진다', (await stored('c2'))?.stage === 'visit1', (await stored('c2'))?.stage);
check('폰: 가로로 넘치지 않는다', (await ev(`document.scrollingElement.scrollWidth - innerWidth`)) === 0);

// ── 5. 새가족 정보 입력(로그인 없는 한 장) ────────────────────────────────────
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
await go('?welcome=1');
const how = await ev(`(() => { const row = document.querySelector('[data-how-row]'); const tops = new Set([...row.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().top))); return { lines: tops.size, labels: [...row.querySelectorAll('button')].map(b => b.textContent.trim()) }; })()`);
check('유입 칩은 한 줄(넘치면 옆으로) · 다섯', how.lines === 1 && how.labels.join() === '친구 소개,가족,SNS,교회 탐색,기타', JSON.stringify(how));
check('태어난 해는 묻지 않는다', !(await ev(`!!document.querySelector('input[aria-label="태어난 해"]')`)));
const setv = (sel, v) => ev(`(() => { const el = document.querySelector('${sel}'); Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
check('동의 전에는 보낼 수 없다', await ev(`document.querySelector('[data-newcomer-submit]').disabled`) === true);
await setv('input[aria-label="이름"]', '이하늘'); await setv('input[aria-label="연락처"]', '010-1234-5678');
await ev(`document.querySelector('[data-newcomer-agree]').click(); true`); await sleep(100);
await ev(`document.querySelector('[data-newcomer-submit]').click(); true`); await sleep(1800);
const done = await ev(`document.querySelector('[data-newcomer-done]')?.innerText || ''`);
const sent = await ev(`(JSON.parse(localStorage.getItem('church_welcome_v1')) || []).find(c => c.name === '이하늘')`);
check('정보 전송 뒤 인사 화면 · 카드가 첫 방문 완료 칸에', done.includes('이하늘님, 반가워요!') && done.includes('더다붓 웰컴팀이 곧 연락드릴게요') && sent?.stage === 'visit1', JSON.stringify({ done, stage: sent?.stage }));

check('콘솔 오류 0', logs.length === 0, logs.slice(0, 3).join(' | '));
console.log(results.join('\n'));
const fails = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
chrome.kill();
process.exit(fails ? 1 : 0);
