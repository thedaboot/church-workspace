// v5 1묶음 A(사용자 승인 시안 2026-10-17) — 휴지통·복원 · 프로젝트 복제 · 업무 링크 칩·카드. 게스트 화면(브라우저 휴지통)을 본다.
// 클라우드 길(DB 함수 0104 · 함수 없는 DB의 되돌아갈 길 · 남에게 알리기)은 tests/logcheck-live가 소스·순수 규칙으로 본다.
// 되돌리기 검사(§3-5):
//   · controllers.handleDeleteTask의 trashTask 줄을 빼면 '업무를 지우면 휴지통에'가,
//   · layout.jsx의 TrashEntry를 빼면 '더보기 맨 아래 입구'가, trash.restoreTrash의 ADD_PROJECT를 빼면 '프로젝트 복원'이,
//   · projectCopy.keptOf의 locked 갈래를 빼면 '잠긴 업무는 본문을 옮기지 않는다'가,
//   · RichText InlineLink의 AppMention 갈래를 지우면 '멘션'·'중립 칩'·'복사'가 깨진다.
// 크롬 디버깅 포트는 CDP_PORT로 바꿀 수 있다(기본 9645).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4173';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = Number(process.env.CDP_PORT) || 9645;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'v5a-'));
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
  else if (m.method) evs.push(m);
});
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const wait = async (m, to = 25000) => { const s = Date.now(); while (Date.now() - s < to) { const i = evs.findIndex(e => e.method === m); if (i >= 0) return evs.splice(i, 1)[0]; await sleep(50); } throw new Error(m); };
const ev = async (e, a = false) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const results = [];
const check = (n, p, d = '') => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
const go = async (path) => { await send('Page.navigate', { url: URL_BASE + path }); await wait('Page.loadEventFired'); await sleep(1300); };
const byText = (sel, t) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent.trim() === ${JSON.stringify(t)})`;
const saved = () => ev(`JSON.parse(localStorage.getItem('church_app_v4') || '{}')`);
// 확인 팝오버의 '삭제'는 body 포털 맨 뒤의 것
const confirmDelete = async () => { await ev(`[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '삭제').pop()?.click()`); await sleep(600); };

const U = (id) => `${URL_BASE}/s/t/${id}`;
const T = (id, title, extra = {}) => ({ id, projectId: 'p1', title, content: '', status: '진행 중', assignees: ['노준석'], teams: ['찬양팀'],
  startDate: '', dueDate: '2026-09-01', position: 1, author: '노준석', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
  comments: [], activityLog: [], attachments: [], ...extra });
const st = { currentUser: { name: '노준석', team: '임원진' },
  projects: { byId: {
    p1: { id: 'p1', title: '2026 하계 수련회', pinnedLinks: [], year: 2026, position: 1 },
    p2: { id: 'p2', title: '2026 새신자 초청', pinnedLinks: [], year: 2026, position: 2 } }, allIds: ['p1', 'p2'] },
  tasks: { byId: {
    w1: T('w1', '링크 단 업무', { position: 0, content: `답사 결과는 ${U('w2')} 에 있어요\n[직접 쓴 글자](${U('w2')})\n없는 업무 ${U('zz9')}\n닫힌 ${U('w3')}\n연 ${U('w4')}\n없는 프로젝트 ${URL_BASE}/s/p/pp0\n화면 ${URL_BASE}/?p=worship` }),
    w2: T('w2', '답사 업무', { position: 1, content: '첫 줄 본문' }),
    w3: T('w3', '닫힌 잠긴 일', { position: 2, author: '조해리', locked: true, lockedOpen: false, content: '', lockPw: { view_pw: 'x', view_pw_salt: 'y' } }),
    w4: T('w4', '연 잠긴 일', { position: 3, author: '조해리', locked: true, lockedOpen: true, content: '연 사람만 보는 본문', subtasks: [{ id: 'ws', title: '비밀 단계', done: false }], lockPw: { view_pw: 'x', view_pw_salt: 'y' } }),
    x1: T('x1', '초청 문자', { projectId: 'p2', position: 0 }),
  }, allIds: ['w1', 'w2', 'w3', 'w4', 'x1'] } };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
await ev(`localStorage.clear(); localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','light')`);

// ── 업무 링크(멘션 · 중립 칩 · 카드 · 복사) ─────────────────────────────────────────
await go('/?p=p1&t=w1');
const m = await ev(`(() => { const body = document.querySelector('.fixed.z-50 [data-view-body]'); if (!body) return null;
  const ms = [...body.querySelectorAll('[data-app-mention]')];
  const links = [...body.querySelectorAll('a')].filter(a => !a.hasAttribute('data-app-mention') && !a.hasAttribute('data-task-card'));
  return { mentions: ms.map(a => a.dataset.appMention + ':' + a.textContent.trim() + '|' + a.getAttribute('href').split('/s/')[1]),
    own: links.map(a => a.textContent.trim()),
    cards: [...body.querySelectorAll('[data-task-card]')].map(a => a.dataset.taskCard + (a.hasAttribute('data-task-card-locked') ? ':locked' : '') + ':' + !!a.querySelector('.rounded-full.border')) }; })()`);
check('글자 그대로인 업무 주소는 아이콘 + 제목 멘션 · 지은 링크 글자 그대로 · 화면 링크(?p=화면)는 주소 그대로',
  !!m && ['task:답사 업무|t/w2', 'task:닫힌 잠긴 일|t/w3', 'task:연 잠긴 일|t/w4'].every(x => m.mentions.includes(x))
    && m.own.includes('직접 쓴 글자') && m.own.includes(`${URL_BASE}/?p=worship`), JSON.stringify(m));
check("없는 업무·없는 프로젝트 링크는 중립 칩('업무 링크'·'프로젝트 링크')", !!m && ['unknown:업무 링크|t/zz9', 'unknown:프로젝트 링크|p/pp0'].every(x => m.mentions.includes(x))
  && !m.own.includes(U('zz9')), JSON.stringify(m?.mentions));
check('잠긴 업무 카드 — 닫힌 것은 자물쇠 + 제목만, 이미 연 것은 상태 칩까지', !!m && m.cards.includes('w3:locked:false') && m.cards.includes('w4:true') && m.cards.includes('w2:true'), JSON.stringify(m?.cards));
const cp = await ev(`(() => { const out = [];
  const copy = () => { const dt = new DataTransfer(); document.activeElement?.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })); out.push(dt.getData('text/plain')); };
  const sel = getSelection(); const a = document.querySelector('.fixed.z-50 [data-view-body] [data-app-mention]'); if (!a) return out;
  const r1 = document.createRange(); r1.selectNodeContents(a); sel.removeAllRanges(); sel.addRange(r1); copy();
  const u = document.querySelector('.fixed.z-50 [data-view-body] [data-app-mention="unknown"]');
  if (u) { const r3 = document.createRange(); r3.selectNodeContents(u); sel.removeAllRanges(); sel.addRange(r3); copy(); }
  sel.removeAllRanges(); return out; })()`);
check('멘션·중립 칩을 골라 복사하면 주소가 나온다', cp[0] === U('w2') && cp[1] === U('zz9'), JSON.stringify(cp));

// ── 휴지통: 업무 지우기 → 더보기 맨 아래 입구 → 복원 ─────────────────────────────────
await go('/?p=p1&t=w2');
await ev(`document.querySelector('.fixed.z-50 button[title="업무 삭제"]')?.click()`); await sleep(400);
await confirmDelete(); await sleep(400);
const gone = await saved();
check('업무를 지우면 화면에서 빠지고 휴지통에 들어간다', !gone.tasks?.byId?.w2 && await ev(`(JSON.parse(localStorage.getItem('trash_v1') || '[]')).some(i => i.refId === 'w2')`));
await ev(`document.querySelector('.fixed.z-50') && ${byText('button', '닫기')}?.click()`); await sleep(500);
await ev(`${byText('button', '더보기')}?.click()`); await sleep(500);
const entry = await ev(`document.querySelector('[data-trash-entry]')?.textContent.trim() || ''`);
check('더보기 맨 아래 휴지통 입구(개수)', /휴지통\s*1/.test(entry), entry);
await ev(`document.querySelector('[data-trash-entry]')?.click()`); await sleep(600);
const row = await ev(`(() => { const r = document.querySelector('[data-trash-dialog] [data-trash-row="task"]'); return r ? r.textContent : null; })()`);
check('휴지통 창에 지운 업무 줄(프로젝트 · 지운 사람)', !!row && row.includes('답사 업무') && row.includes('2026 하계 수련회') && row.includes('노준석님이 삭제'), row);
await ev(`${byText('[data-trash-dialog] button', '복원')}?.click()`); await sleep(700);
const back = await saved();
check('복원하면 업무가 제자리에 돌아오고 휴지통이 빈다', !!back.tasks?.byId?.w2 && back.tasks.byId.w2.projectId === 'p1'
  && await ev(`!!document.querySelector('[data-trash-empty]')`));
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(500);

// ── 휴지통: 프로젝트 지우기(안의 업무까지) → 복원 ──────────────────────────────────
await go('/?p=p2');
await ev(`document.querySelector('button[title="프로젝트 삭제"]')?.click()`); await sleep(400);
const msg = await ev(`document.body.innerText.includes('프로젝트와 안의 모든 업무가 휴지통으로 이동해요. 30일 안에 복원할 수 있어요.')`);
check('프로젝트 삭제 확인은 휴지통 문구(사용자 승인)', msg);
await confirmDelete(); await sleep(400);
const pg = await saved();
check('프로젝트를 지우면 안의 업무까지 빠진다', !pg.projects?.byId?.p2 && !pg.tasks?.byId?.x1);
await go('/?p=p1');
await ev(`${byText('button', '더보기')}?.click()`); await sleep(500);
await ev(`document.querySelector('[data-trash-entry]')?.click()`); await sleep(600);
const prow = await ev(`document.querySelector('[data-trash-dialog] [data-trash-row="project"]')?.textContent || ''`);
check('휴지통 창에 프로젝트 줄(업무 N건)', prow.includes('2026 새신자 초청') && prow.includes('업무 1건'), prow);
await ev(`${byText('[data-trash-dialog] button', '복원')}?.click()`); await sleep(700);
const pb = await saved();
check('프로젝트를 복원하면 안의 업무도 돌아온다', !!pb.projects?.byId?.p2 && pb.tasks?.byId?.x1?.projectId === 'p2');
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(500);

// ── 프로젝트 복제 ──────────────────────────────────────────────────────────────
await go('/?p=p1');
await ev(`document.querySelector('button[title="프로젝트 이름 수정"]')?.click()`); await sleep(500);
await ev(`document.querySelector('[data-project-copy-open]')?.click()`); await sleep(700);
const pv = await ev(`(() => { const d = document.querySelector('[data-project-copy]'); if (!d) return null;
  const items = [...d.querySelectorAll('[data-copy-preview] li')];
  const name = d.querySelector('input[aria-label="프로젝트 이름"]')?.value;
  const locked = items.find(li => li.textContent.includes('연 잠긴 일'))?.textContent || '';
  return { n: items.length, name, lockedShows: /상세 내용|하위 업무/.test(locked) }; })()`);
check('복제 단계 — 한 창 안 · 다음 해 이름 · 옮겨질 업무 넷 · 잠긴 업무는 본문·하위 업무를 안 보여 준다',
  !!pv && pv.n === 4 && pv.name === '2027 하계 수련회' && !pv.lockedShows, JSON.stringify(pv));
await ev(`${byText('[data-project-copy] button', '복제하기')}?.click()`); await sleep(900);
const dup = await saved();
const np = Object.values(dup.projects?.byId || {}).find(p => p.title === '2027 하계 수련회');
const nt = np ? Object.values(dup.tasks.byId).filter(t => t.projectId === np.id) : [];
const lockedCopy = nt.find(t => t.title === '연 잠긴 일');
check('복제하면 그 해의 새 프로젝트에 업무 넷(담당자·날짜 비움 · 잠긴 업무는 본문·하위 업무 없이 · 잠금 없이)',
  !!np && np.year === 2027 && nt.length === 4 && nt.every(t => !t.assignees.length && !t.dueDate)
    && !!lockedCopy && lockedCopy.content === '' && !lockedCopy.subtasks?.length && !lockedCopy.locked
    && await ev(`location.search.includes(${JSON.stringify(np?.id || '-')})`), JSON.stringify({ np, n: nt.length, lockedCopy }));

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) || logs.length ? 1 : 0);
