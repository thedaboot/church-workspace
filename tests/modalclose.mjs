// 업무 상세 모달: 바깥 클릭으로 닫히는지 / 안쪽 클릭·드래그로는 안 닫히는지
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4173';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = 9401;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cmc-'));
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

// **`inset-0`으로 찾지 않는다**(2026-09-22). 폰의 업무 창은 키보드에 가리지 않으려고
// `inset-0` 대신 앱 뿌리와 같은 높이(--app-vh)를 쓴다 — 클래스 글자로 붙잡으면 화면이
// 나아질 때마다 이 검사가 헛으로 깨진다(tests/handoff도 같은 이유로 고쳤다).
const isOpen = () => ev(`!!document.querySelector('.fixed.z-50')`);
const openCard = async () => { await ev(`document.querySelector('.board-card').click()`); await sleep(700); };
const geom = () => ev(`(() => {
  const ov = document.querySelector('.fixed.z-50');
  const panel = ov.firstElementChild;
  const o = ov.getBoundingClientRect(), p = panel.getBoundingClientRect();
  return { dim: { x: Math.round(o.left + 12), y: Math.round(o.top + o.height / 2) },
           inside: { x: Math.round(p.left + p.width / 2), y: Math.round(p.top + 60) } };
})()`);
const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
await ev(readFileSync(join(import.meta.dirname, 'seed.js'), 'utf8'));
await send('Page.navigate', { url: URL_BASE + '/?p=p1' });
await wait('Page.loadEventFired');
await sleep(1300);

// 1) 바깥(딤) 클릭 → 닫힘
await openCard();
check('업무 상세 열림', await isOpen());
let g = await geom();
await mouse('mousePressed', g.dim.x, g.dim.y);
await mouse('mouseReleased', g.dim.x, g.dim.y);
await sleep(500);
check('바깥을 누르면 닫힌다', (await isOpen()) === false);

// 2) 안쪽 클릭 → 안 닫힘
await openCard();
g = await geom();
await mouse('mousePressed', g.inside.x, g.inside.y);
await mouse('mouseReleased', g.inside.x, g.inside.y);
await sleep(400);
check('안쪽을 눌러도 닫히지 않는다', (await isOpen()) === true);

// 3) 안 → 바깥 드래그(글자 선택하다 손 떼기) → 안 닫힘
await mouse('mousePressed', g.inside.x, g.inside.y);
await mouse('mouseMoved', g.dim.x, g.dim.y);
await mouse('mouseReleased', g.dim.x, g.dim.y);
await sleep(400);
check('안에서 바깥으로 드래그해도 닫히지 않는다', (await isOpen()) === true);

// 4) X 버튼은 그대로
await ev(`[...document.querySelectorAll('.fixed.z-50 button')].find(b => b.querySelector('svg'))?.click()`);
await sleep(400);
const stillOpen = await isOpen();
// 푸터: 할 일(수정)이 왼쪽, 나가기(닫기)가 오른쪽. 색도 달라야 한다 —
// 예전에는 둘 다 surface-hover라 어느 쪽이 할 일인지 구분되지 않았다.
const footer = await ev(`(() => {
  const btns=[...document.querySelectorAll('button')].filter(b=>/^(수정|저장|닫기)$/.test(b.textContent.trim()));
  const get=t=>btns.find(b=>b.textContent.trim()===t);
  const edit=get('수정'), close=get('닫기');
  if(!edit||!close) return { edit:!!edit, close:!!close };
  const er=edit.getBoundingClientRect(), cr=close.getBoundingClientRect();
  const bg=e=>getComputedStyle(e).backgroundColor;
  return { editLeftOfClose: er.left < cr.left, sameRow: Math.abs(er.top-cr.top) < 4,
           differentColor: bg(edit) !== bg(close), editBg: bg(edit), closeBg: bg(close) };
})()`);
check('업무 창 푸터: 수정이 닫기보다 왼쪽', footer.editLeftOfClose === true && footer.sameRow === true, JSON.stringify(footer));
check('업무 창 푸터: 수정과 닫기 색이 다르다', footer.differentColor === true, `${footer.editBg} vs ${footer.closeBg}`);

if (stillOpen) { await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '닫기').click()`); await sleep(400); }
check('닫기 버튼도 그대로 동작', (await isOpen()) === false);

// 5) 하위 업무 삭제는 확인을 거친다
// 예전에는 휴지통을 한 번 누르면 바로 지워졌다. 체크박스 옆 13px 아이콘이라 잘못
// 누르기 쉽고, 하위 업무에는 실행 취소가 없다(클라우드 모드에서는 Undo를 감춘다).
// 팝오버는 '삭제할까요'가 든 z-[90]로 좁힌다 — 하위 업무 줄의 담당자 칩(OwnerPicker)도
// z-[90] 팝오버를 띄운다(d00f818). 아무 z-[90]나 잡으면 엉뚱한 팝오버를 읽는다.
const POP_JS = `[...document.querySelectorAll('div')]
    .find(x => typeof x.className === 'string' && x.className.includes('z-[90]') && /삭제할까요/.test(x.textContent))`;
const popover = () => ev(`(() => {
  const d = ${POP_JS};
  if (!d) return null;
  return { buttons: [...d.querySelectorAll('button')].map(b => b.textContent.trim()) };
})()`);
// 하위 업무 체크박스는 aria-label이 '완료'/'완료 취소'로 끝난다.
// [aria-pressed]만으로 세면 안 된다 — 댓글 반응 토글(0032)도 aria-pressed를 쓴다
// (실제로 이 검사 넷이 그렇게 깨졌다. "유일한 요소"라는 전제는 낡는다).
const SUB_CB = `[...document.querySelectorAll('[aria-pressed]')]
  .filter(b => /완료( 취소)?$/.test(b.getAttribute('aria-label') || ''))`;
const subCount = () => ev(`${SUB_CB}.length`);
const clickTrash = async () => {
  const r = await ev(`(() => {
    const cb = ${SUB_CB}[0];
    if (!cb) return null;
    // 줄이 [span: 체크+담당자 칩][span: 휴지통]으로 갈렸다(d00f818) — 체크의 형제 중
    // 아무 버튼이나 고르면 담당자 칩을 누른다. 줄 안에서 aria-label '… 삭제'로 찾는다.
    const trash = cb.closest('.subtask-row')?.querySelector('button[aria-label$=" 삭제"]');
    if (!trash) return null;
    trash.scrollIntoView({ block: 'center' });
    trash.click();
    return true;
  })()`);
  await sleep(350);
  return r;
};
const popClick = async (label) => {
  const found = await ev(`(() => {
    const d = ${POP_JS};
    if (!d) return false;
    [...d.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click();
    return true;
  })()`);
  // 팝오버가 없으면 던지지 않고 FAIL 한 줄로 남긴다(§6-40)
  if (!found) check(`삭제 확인 팝오버에서 '${label}'을 누른다`, false, '팝오버 없음');
  await sleep(350);
};

await openCard();
await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '수정').click()`);
await sleep(700);

// 하위 업무 한 건 추가. 입력칸은 '예:'로 시작하는 placeholder로 찾는다 —
// 문구가 '단계를 입력하고 Enter'에서 예시로 바뀐 자리다.
const subBox = await ev(`(() => {
  const i = [...document.querySelectorAll('input')].find(x => (x.placeholder || '').startsWith('예:'));
  if (!i) return null;
  i.scrollIntoView({ block: 'center' });
  const r = i.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
check('수정 화면에 하위 업무 입력칸이 있다(예시 placeholder)', !!subBox);

await mouse('mousePressed', subBox.x, subBox.y);
await mouse('mouseReleased', subBox.x, subBox.y);
await send('Input.insertText', { text: '포스터 시안 만들기' });
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(400);
check('Enter로 하위 업무가 추가된다', (await subCount()) === 1);

// 휴지통 → 확인 팝오버가 뜨고, 이 시점에는 아직 지워지지 않아야 한다
check('휴지통 버튼을 찾았다', (await clickTrash()) === true);
const pop = await popover();
check('하위 업무 삭제는 확인을 먼저 묻는다',
  !!pop && pop.buttons.includes('삭제') && pop.buttons.includes('취소'), JSON.stringify(pop));
check('확인하기 전에는 지워지지 않는다', (await subCount()) === 1);

await popClick('취소');
check('취소하면 하위 업무가 남는다', (await subCount()) === 1);

await clickTrash();
await popClick('삭제');
check('확인하면 지워진다', (await subCount()) === 0);

// 저장하지 않고 닫는다 — 다음 절(모바일)이 깨끗한 상태에서 시작하도록
await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '닫기').click()`);
await sleep(400);

// 6) 모바일은 풀스크린이라 바깥이 없다 — 닫기 버튼으로 닫힌다
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL_BASE + '/?p=p1' });
await wait('Page.loadEventFired');
await sleep(1300);
await openCard();
check('모바일에서도 상세가 열린다', await isOpen());
await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '닫기').click()`);
await sleep(400);
check('모바일 닫기 동작', (await isOpen()) === false);


// ── 댓글·활동 사이드바 접기 (데스크톱) ──────────────────────────────────────
// 되돌리기 검사: 헤더의 toggleSide 버튼을 지우거나 감싸개의 md:w-0을 빼면
// 아래 단정이 깨진다. 접을 때 **언마운트하지 않는다**(쓰다 만 댓글이 날아간다).
// 위 6)에서 모바일로 바꿔 두었으니 데스크톱으로 되돌리고 카드를 다시 연다
await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE + '/?p=p1' });
await wait('Page.loadEventFired');
await sleep(1300);
await openCard();
const sideProbe = () => ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /댓글·활동/.test(b.title || ''));
  if (!btn) return { found:false };
  const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('댓글 ('));
  const wrap = tab ? tab.closest('div').parentElement.parentElement : null;
  return { found:true, title: btn.title, width: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
           tabMounted: !!tab };
})()`);
const before = await sideProbe();
check('업무 창에 댓글·활동 접기 버튼이 있다', before.found === true, JSON.stringify(before));
check('처음에는 펼쳐져 있다', before.found && before.width > 100, JSON.stringify(before));
await ev(`[...document.querySelectorAll('button')].find(b => /댓글·활동/.test(b.title || '')).click()`);
await sleep(500);
const after = await sideProbe();
check('접으면 폭이 0이 된다', after.found && after.width === 0, JSON.stringify(after));
check('접어도 언마운트하지 않는다(쓰던 댓글 보존)', after.tabMounted === true, JSON.stringify(after));
await ev(`[...document.querySelectorAll('button')].find(b => /댓글·활동/.test(b.title || '')).click()`);
await sleep(500);
const reopened = await sideProbe();
check('다시 펴진다', reopened.found && reopened.width > 100, JSON.stringify(reopened));


// ── 업무를 수정·저장해도 댓글·활동이 비지 않는다 (§6-22) ───────────────────
// 클라우드는 댓글·활동을 창을 열 때 따로 읽으므로(§6-20) 수정 폼에는 빈 배열이
// 실려 있기 십상이다. 저장이 카드를 통째로 교체하면 **그 순간 화면에서 사라지고**,
// 다시 들어가면 loadCardDetail이 읽어 와서 "나갔다 오면 보인다"가 된다(사용자 지적).
// 게스트 모드에는 loadCardDetail이 없으므로, 그 도착을 스토어 디스패치로 흉내낸다.
// 되돌리기 검사: controllers.js의 저장을 UPSERT_TASK 하나로 되돌리면 깨진다.
{
  const t = { id: 'w1', projectId: 'p1', title: '댓글 보존 확인', content: '본문', status: '진행 중',
    assignees: ['노준석'], teams: ['찬양팀'], startDate: '', dueDate: '2026-09-01', position: 1,
    author: '노준석', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    comments: [], activityLog: [], attachments: [] };
  const st = { currentUser: { name: '노준석', team: '임원진' },
    projects: { byId: { p1: { id: 'p1', title: '보존 프로젝트', pinnedLinks: [], year: 2026 } }, allIds: ['p1'] },
    tasks: { byId: { w1: t }, allIds: ['w1'] } };
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))})`);
  await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired');
  await sleep(1300);
  await ev(`document.querySelector('.board-card').click()`); await sleep(700);
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '수정').click()`); await sleep(500);
  const seeded = await ev(`(() => {
    if (!window.__store) return false;
    window.__store.dispatch({ type: 'SYNC_TASK', payload: { id: 'w1',
      comments: [{ id: 'c1', author: '조해리', text: '보존되어야 하는 댓글', timestamp: '2026-08-02T00:00:00Z', parentId: null }],
      activityLog: [{ id: 'a1', action: '업무를 생성했습니다.', author: '노준석', timestamp: '2026-08-01T00:00:00Z' }] } });
    return true;
  })()`);
  check('스토어를 통해 상세 도착을 흉내낼 수 있다', seeded === true, '개발 빌드에서 window.__store');
  await sleep(400);
  await ev(`(() => {
    const i = document.querySelector('input[name="title"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, '댓글 보존 확인 (고침)');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '저장').click()`);
  await sleep(1200);
  const after = await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('church_app_v4'));
    const t = s.tasks.byId.w1;
    const shown = [...document.querySelectorAll('*')].some(e => e.children.length === 0 && /보존되어야 하는 댓글/.test(e.textContent || ''));
    return { title: t.title, comments: (t.comments || []).length, activity: (t.activityLog || []).length, shown };
  })()`);
  check('저장해도 댓글이 남는다', after.comments === 1, JSON.stringify(after));
  check('저장해도 활동 기록이 남고 이번 기록이 붙는다', after.activity >= 2, JSON.stringify(after));
  check('저장 직후 화면에도 댓글이 보인다', after.shown === true, JSON.stringify(after));
  check('제목은 실제로 바뀐다', /고침/.test(after.title), after.title);

  // **기록이 새로 안 생기는 수정**이 더 위험하다 — 붙일 것조차 없어서 활동이
  // 통째로 0이 된다(사용자가 본 것이 이 경우다). 아무것도 안 바꾸고 저장해 본다.
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '수정').click()`);
  await sleep(500);
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '저장').click()`);
  await sleep(1200);
  const after2 = await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('church_app_v4'));
    const t = s.tasks.byId.w1;
    const shown = [...document.querySelectorAll('*')].some(e => e.children.length === 0 && /보존되어야 하는 댓글/.test(e.textContent || ''));
    return { comments: (t.comments || []).length, activity: (t.activityLog || []).length, shown };
  })()`);
  check('기록이 안 생기는 저장에도 활동이 남는다', after2.activity >= 2, JSON.stringify(after2));
  check('기록이 안 생기는 저장에도 댓글이 남는다', after2.comments === 1 && after2.shown === true, JSON.stringify(after2));
}

// ── 고친 채로 닫기: ✕·딤도 묻는다 · 남이 바꾼 것은 '고친 것'이 아니다 (2026-09-25 감사 4·S3·S8) ──
// 예전에는 푸터 '닫기'만 물었고 머리줄 ✕와 딤은 고친 것을 말없이 버렸다. dirty는 실시간으로
// 바뀌는 카드와 견줘서 남이 하위 업무를 체크하기만 해도 안 고친 사람에게 창이 떴고, 저장은
// 폼 전체를 보내 그 체크를 되돌렸다. 고친 것이 있는 동안에는 새로고침도 묻는다(beforeunload).
// 되돌리기 검사: ✕를 예전 버튼으로 두면 ①이, 딤의 dirty 갈래를 빼면 ②가, dirty를
// `taskEditDirty(formData, source)`로 되돌리면 ④가, 저장을 `onSave(formData)`로 되돌리면 ⑤가 깨진다.
{
  const t = { id: 'x1', projectId: 'p1', title: '닫기 확인', content: '본문', status: '진행 중',
    assignees: ['노준석'], teams: ['찬양팀'], startDate: '', dueDate: '2026-09-01', position: 1,
    subtasks: [{ id: 's1', title: '시안', done: false }],
    author: '노준석', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    comments: [], activityLog: [], attachments: [] };
  const st = { currentUser: { name: '노준석', team: '임원진' },
    projects: { byId: { p1: { id: 'p1', title: '닫기 프로젝트', pinnedLinks: [], year: 2026 } }, allIds: ['p1'] },
    tasks: { byId: { x1: t }, allIds: ['x1'] } };
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))})`);
  await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired');
  await sleep(1300);
  const byLabel = (l) => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(l)})`;
  const ASK = `[...document.querySelectorAll('div')].find(x => typeof x.className === 'string' && x.className.includes('z-[90]') && /저장하지 않은 내용이 있어요/.test(x.textContent))`;
  const setTitle = (v) => ev(`(() => { const i = document.querySelector('input[name="title"]'); if (!i) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)});
    i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const xBtn = `document.querySelector('.fixed.z-50 button[aria-label="닫기"]')`;
  await ev(`document.querySelector('.board-card').click()`); await sleep(700);
  await ev(`${byLabel('수정')}.click()`); await sleep(600);
  const xBefore = await ev(`(() => { const r = ${xBtn}?.getBoundingClientRect(); return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width)] : null; })()`);
  await setTitle('닫기 확인 (고침)'); await sleep(300);
  const xAfter = await ev(`(() => { const r = ${xBtn}?.getBoundingClientRect(); return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width)] : null; })()`);
  check('고쳐도 머리줄 ✕의 자리는 그대로다', !!xBefore && JSON.stringify(xBefore) === JSON.stringify(xAfter), JSON.stringify([xBefore, xAfter]));
  // ① ✕ → 확인이 뜨고 창은 그대로
  await ev(`${xBtn}?.click()`); await sleep(350);
  const ask1 = await ev(`(() => { const d = ${ASK}; return d ? [...d.querySelectorAll('button')].map(b => b.textContent.trim()) : null; })()`);
  check('① 고친 채로 ✕를 누르면 같은 확인이 뜬다', JSON.stringify(ask1) === JSON.stringify(['저장하고 닫기', '무시하고 닫기', '돌아가기']) && (await isOpen()), JSON.stringify(ask1));
  if (ask1) { await ev(`[...(${ASK}).querySelectorAll('button')].find(b => b.textContent.trim() === '돌아가기').click()`); await sleep(300); }
  // ①이 깨져 창이 닫혔으면 다시 열어 고친 상태로 만든다 — 뒤 단정이 던지지 않게(§6-40)
  if (!(await isOpen())) {
    await ev(`document.querySelector('.board-card').click()`); await sleep(700);
    await ev(`${byLabel('수정')}?.click()`); await sleep(600);
    await setTitle('닫기 확인 (고침)'); await sleep(300);
  }
  // ② 딤 → 같은 확인
  g = await geom();
  await mouse('mousePressed', g.dim.x, g.dim.y); await mouse('mouseReleased', g.dim.x, g.dim.y); await sleep(400);
  const ask2 = await ev(`!!(${ASK})`);
  check('② 고친 채로 딤을 눌러도 닫히지 않고 확인이 뜬다', ask2 === true && (await isOpen()), String(ask2));
  // ③ 새로고침도 묻는다 — beforeunload가 막힌다
  const blocked = await ev(`(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`);
  check('③ 고친 것이 있으면 새로고침·창 닫기를 브라우저가 묻는다', blocked === true, String(blocked));
  if (ask2) { await ev(`[...(${ASK}).querySelectorAll('button')].find(b => b.textContent.trim() === '무시하고 닫기').click()`); await sleep(400); }
  check('무시하고 닫기로 닫힌다', (await isOpen()) === false);
  const free = await ev(`(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`);
  check('닫고 나면 새로고침을 막지 않는다', free === false, String(free));
  // ④ 남이 하위 업무를 체크한 것은 내가 고친 것이 아니다 → 딤으로 그냥 닫힌다
  await ev(`document.querySelector('.board-card').click()`); await sleep(700);
  await ev(`${byLabel('수정')}.click()`); await sleep(600);
  await ev(`window.__store?.dispatch({ type: 'SYNC_TASK', payload: { id: 'x1', subtasks: [{ id: 's1', title: '시안', done: true }] } })`);
  await sleep(300);
  await ev(`${byLabel('닫기')}.click()`); await sleep(400);
  check('④ 남이 체크한 것만으로는 묻지 않는다(수정을 누른 순간과 견준다)', (await isOpen()) === false && !(await ev(`!!(${ASK})`)));
  // ⑤ 그 사이 남이 체크했고 나는 제목만 고쳐 저장 → 체크가 살아 있다
  await ev(`window.__store?.dispatch({ type: 'SYNC_TASK', payload: { id: 'x1', subtasks: [{ id: 's1', title: '시안', done: false }] } })`);
  await ev(`document.querySelector('.board-card').click()`); await sleep(700);
  await ev(`${byLabel('수정')}.click()`); await sleep(600);
  await setTitle('닫기 확인 (다시 고침)'); await sleep(200);
  await ev(`window.__store?.dispatch({ type: 'SYNC_TASK', payload: { id: 'x1', subtasks: [{ id: 's1', title: '시안', done: true }] } })`);
  await sleep(300);
  await ev(`${byLabel('저장')}.click()`); await sleep(1200);
  const saved = await ev(`(() => { const s = JSON.parse(localStorage.getItem('church_app_v4')); const x = s.tasks.byId.x1;
    return { title: x.title, done: x.subtasks?.[0]?.done }; })()`);
  check('⑤ 제목만 고쳐 저장해도 그 사이 남이 한 체크가 풀리지 않는다', saved.title === '닫기 확인 (다시 고침)' && saved.done === true, JSON.stringify(saved));
}

// ── 답글 UX (2026-08-31 사용자 요청 — "댓글은 좋은데 답글도 챙겨줘") ──────────
// 예전에는 답글 입력이 맨 <input> 한 줄이었다. 이 스위트가 지키는 것:
//  ① '답글' 버튼이 hover 없이 **언제나 보이고** 답글 수를 같이 적는다
//  ② 열면 누구에게 다는 답글인지 이름이 뜬다
//  ③ 입력은 textarea + @멘션 자동완성(댓글 입력과 같은 MentionInput)이라 Shift+Enter로
//     줄바꿈이 되고 이름을 손으로 안 쳐도 된다 — 표시명이 어긋나면 멘션 알림이
//     **조용히** 빗나갔던 자리다(notifyComment는 정확 일치로 사람을 찾는다)
//  ④ **취소·답글 버튼이 있다** — 모바일에는 Enter/Esc가 없어서 조작 자체가 없었다
//  ⑤ 접어도 쓰던 글이 남는다(초안이 댓글별이다)
// 되돌리기 검사: comments.jsx의 MentionInput을 <input>으로 되돌리면 ③이,
// replyDrafts를 replyText 하나로 되돌리면 ⑤가 깨진다.
{
  const t = { id: 'r1', projectId: 'p1', title: '답글 UX 확인', content: '본문', status: '진행 중',
    assignees: ['노준석'], teams: ['찬양팀'], startDate: '', dueDate: '2026-09-01', position: 1,
    author: '노준석', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    comments: [
      { id: 'p1c', author: '조해리', text: '첫 댓글', timestamp: '2026-08-02T00:00:00Z', parentId: null },
      { id: 'p2c', author: '조준환', text: '둘째 댓글', timestamp: '2026-08-03T00:00:00Z', parentId: null },
      { id: 'p1r', author: '노준석', text: '이미 달린 답글', timestamp: '2026-08-04T00:00:00Z', parentId: 'p1c' },
    ],
    activityLog: [], attachments: [] };
  const st = { currentUser: { name: '노준석', team: '임원진' },
    projects: { byId: { p1: { id: 'p1', title: '답글 프로젝트', pinnedLinks: [], year: 2026 } }, allIds: ['p1'] },
    tasks: { byId: { r1: t }, allIds: ['r1'] } };
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))})`);
  await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired');
  await sleep(1300);
  await ev(`document.querySelector('.board-card').click()`); await sleep(800);

  // 답글 여닫기 버튼·작성칸을 찾는 헬퍼. 작성칸은 '○○님에게 답글' 줄의 형제들이다 —
  // 등록 버튼도 글자가 '답글'이라 문서 전체에서 찾으면 여는 버튼과 헷갈린다.
  const OPEN = `[...document.querySelectorAll('button')].filter(b => /^답글( [0-9]+)?( · 작성 중)?$/.test(b.textContent.trim()))`;
  const BOX = `(() => { const p = [...document.querySelectorAll('p')].find(x => /님에게 답글$/.test(x.textContent.trim()));
    return p ? { head: p, box: p.parentElement } : null; })()`;

  const btns = await ev(`(() => {
    const bs = ${OPEN};
    return { n: bs.length, labels: bs.map(b => b.textContent.trim()),
             visible: bs.every(b => { const c = getComputedStyle(b); return c.opacity === '1' && c.display !== 'none'; }) };
  })()`);
  check('답글 버튼이 댓글마다 있다', btns.n === 2, JSON.stringify(btns));
  check('답글 버튼은 hover 없이 보인다', btns.visible === true, JSON.stringify(btns));
  check('답글이 있으면 개수를 적는다', btns.labels.includes('답글 1'), JSON.stringify(btns.labels));

  const openReply = (label) => ev(`(() => { const b = ${OPEN}.find(x => x.textContent.trim() === ${JSON.stringify('')} + ${JSON.stringify(label)}); if (b) b.click(); return !!b; })()`);
  // 셀렉터를 못 찾으면 **던지지 말고 false**다(§4.1 — 던지면 CRASH가 되어 어느
  // 단정에서 어긋났는지 안 보인다. 실제로 되돌리기 검사에서 이 함수가 터졌다).
  const setBox = (text) => ev(`(() => { const r = ${BOX}; if (!r) return false;
    const ta = r.box.querySelector('textarea');
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify('')} + ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const boxAct = (label) => ev(`(() => { const r = ${BOX}; if (!r) return false;
    const b = [...r.box.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify('')} + ${JSON.stringify(label)});
    if (b) b.click(); return !!b; })()`);

  check('답글 열기가 눌린다', (await openReply('답글 1')) === true);
  await sleep(400);
  const open1 = await ev(`(() => { const r = ${BOX}; if (!r) return null;
    const ta = r.box.querySelector('textarea');
    return { to: r.head.textContent.trim(), textarea: !!ta, ph: ta ? ta.placeholder : null,
             acts: [...r.box.querySelectorAll('button')].map(b => b.textContent.trim()) }; })()`);
  check('누구에게 다는 답글인지 보인다', open1?.to === '조해리님에게 답글', JSON.stringify(open1));
  check('답글 입력은 textarea다(Shift+Enter 줄바꿈)', open1?.textarea === true, JSON.stringify(open1));
  check('멘션 안내가 댓글 입력과 같다', /@이름/.test(open1?.ph || ''), String(open1?.ph));
  check('취소·답글 버튼이 있다(모바일에도 조작이 있다)',
    !!open1 && open1.acts.includes('취소') && open1.acts.includes('답글'), JSON.stringify(open1?.acts));

  // @을 치면 멤버 제안이 뜬다
  check('답글 작성칸에 글을 넣을 수 있다', (await setBox('@노')) === true, 'textarea가 없으면 false');
  await sleep(400);
  // 멘션 목록은 body 포털이다(MentionInput · HANDOFF §8) — 작성칸 안이 아니라 **문서에서**,
  // 이 작성칸의 왼쪽 끝에 붙어 선 판을 찾는다(댓글 입력칸의 목록과 헷갈리지 않게).
  const sug = await ev(`(() => { const r = ${BOX}; if (!r) return [];
    const ta = r.box.querySelector('textarea'); if (!ta) return [];
    const x = ta.parentElement.getBoundingClientRect().left;
    const list = [...document.body.children].find(c => /max-h-48/.test(c.className || '')
      && Math.abs(c.getBoundingClientRect().left - x) < 2);
    if (!list) return [];
    return [...list.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0)
      .map(b => b.textContent.trim()).filter(s => /^@/.test(s)); })()`);
  check('@을 치면 멤버 제안이 뜬다', sug.some(s => /노준석/.test(s)), JSON.stringify(sug));

  // 접어도 초안이 남는다 — 예전에는 replyText 하나였고 접거나 다른 댓글로 옮기면 날아갔다
  await setBox('쓰다가 만 답글'); await sleep(250);
  check('취소가 눌린다', (await boxAct('취소')) === true);
  await sleep(350);
  const mark = await ev(`${OPEN}.map(b => b.textContent.trim())`);
  check('접으면 작성 중임을 알려준다', mark.includes('답글 1 · 작성 중'), JSON.stringify(mark));
  await openReply('답글 1 · 작성 중'); await sleep(400);
  const kept = await ev(`(() => { const r = ${BOX}; return r ? r.box.querySelector('textarea').value : null; })()`);
  check('다시 열면 쓰던 글이 그대로 있다', kept === '쓰다가 만 답글', String(kept));

  // 등록
  await setBox('등록되는 답글'); await sleep(250);
  check('답글 등록이 눌린다', (await boxAct('답글')) === true);
  await sleep(900);
  const after = await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('church_app_v4'));
    const replies = (s.tasks.byId.r1.comments || []).filter(c => c.parentId === 'p1c');
    return { n: replies.length, last: replies[replies.length - 1]?.text, box: !!${BOX} }; })()`);
  check('답글이 실제로 등록된다', after.n === 2 && after.last === '등록되는 답글', JSON.stringify(after));
  check('등록하면 입력창이 닫힌다', after.box === false, JSON.stringify(after));
}

// ── 손가락 기기에서는 Enter가 줄바꿈 · 조합 중 Enter는 등록이 아니다 (2026-09-25 감사 9·S6) ──
// 폰 키보드에는 Shift+Enter가 없어서 Enter가 곧 등록이면 댓글에서 줄을 바꿀 길이 없었다.
// 등록은 옆 '등록' 버튼이 한다. 마우스 기기는 예전처럼 Enter가 등록이다.
// 한글 조합을 끝내는 Enter(isComposing)는 어느 기기에서도 등록이 아니다.
// 되돌리기 검사: CommentInput의 `!coarsePointer()`를 빼면 ①이, `imeComposing(e)` 가드를
// 빼면 ③이 깨진다.
{
  const countComments = () => ev(`(JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId.r1.comments || []).filter(c => !c.parentId).length`);
  const enterKey = async () => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await sleep(300);
  };
  const INPUT = `[...document.querySelectorAll('textarea')].find(t => /@이름/.test(t.placeholder) && !t.closest('.ml-8'))`;
  const focusInput = () => ev(`(() => { const t = ${INPUT}; if (!t) return false; t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true; })()`);
  // ① 폰(터치): Enter는 줄바꿈
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired');
  await sleep(1300);
  const coarse = await ev(`matchMedia('(pointer: coarse)').matches`);
  await openCard();
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('댓글 ('))?.click()`); await sleep(500);
  const before = await countComments();
  const focused = await focusInput();
  await send('Input.insertText', { text: '첫 줄' });
  await enterKey();
  await send('Input.insertText', { text: '둘째 줄' });
  await sleep(200);
  const phone = await ev(`(() => { const t = ${INPUT}; return t ? t.value : null; })()`);
  check('① 폰에서는 댓글 칸의 Enter가 줄바꿈이다(등록되지 않는다)',
    coarse === true && focused === true && phone === '첫 줄\n둘째 줄' && (await countComments()) === before,
    JSON.stringify({ coarse, focused, phone }));
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '등록')?.click()`); await sleep(600);
  const posted = await ev(`(() => { const cs = JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId.r1.comments || []; return cs[cs.length - 1]?.text; })()`);
  check('② 폰에서는 등록 버튼으로 두 줄 댓글이 올라간다', posted === '첫 줄\n둘째 줄', JSON.stringify(posted));
  // ③ 데스크톱: 조합 중 Enter는 등록이 아니고, 보통 Enter는 예전처럼 등록이다
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired');
  await sleep(1300);
  await openCard();
  await sleep(400);
  const n0 = await countComments();
  await focusInput();
  await send('Input.insertText', { text: '조합 중인 글' });
  await sleep(200);
  await ev(`(() => { const t = ${INPUT}; t && t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true })); })()`);
  await sleep(400);
  const n1 = await countComments();
  check('③ 한글 조합을 끝내는 Enter로는 등록되지 않는다', n1 === n0, JSON.stringify({ n0, n1 }));
  await focusInput();
  await enterKey();
  const n2 = await countComments();
  check('④ 데스크톱에서는 Enter가 예전처럼 등록이다', n2 === n0 + 1, JSON.stringify({ n0, n2 }));

  // ── D9(2026-09-25): 댓글 등록은 작은 단(11.5px · 600 · 29px · 비활성 opacity .4) ·
  // 업무 창 뒤판은 검정 50% · 뒤판과 창 모두 150ms · 댓글 시각·(수정됨)은 10px muted.
  // **되돌리기**: comments.jsx 등록을 옛 `text-[10px] font-bold … disabled:bg-line`으로 두면 첫 검사가,
  // modals.jsx 뒤판을 `bg-black/60 … duration-200`으로 두면 둘째 검사가 깨진다.
  const d9 = await ev(`(() => {
    const t = ${INPUT}; if (!t) return null;
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '등록');
    const back = [...document.querySelectorAll('div')].find(d => /fixed inset-0/.test(d.className || '') && /z-50/.test(d.className || '') && d.querySelector('textarea'));
    const panel = back?.firstElementChild;
    const accent = (() => { const d = document.createElement('i'); d.style.color = 'var(--app-accent)'; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; })();
    const muted = (() => { const d = document.createElement('i'); d.style.color = 'var(--app-ink-muted)'; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; })();
    const stamp = document.querySelector('.comment-stamp');
    const cs = b && getComputedStyle(b);
    return b && back ? { px: cs.fontSize, w: cs.fontWeight, h: b.offsetHeight, off: b.disabled,
      opacity: cs.opacity, bgIsAccent: cs.backgroundColor === accent,
      back: getComputedStyle(back).backgroundColor, backMs: getComputedStyle(back).animationDuration,
      panelMs: panel && getComputedStyle(panel).animationDuration,
      stamp: stamp ? { px: getComputedStyle(stamp).fontSize, muted: getComputedStyle(stamp).color === muted } : null } : null;
  })()`);
  check('D9: 댓글 등록은 작은 단 — 11.5px · 600 · 29px, 빈 칸이면 accent 그대로 opacity .4',
    !!d9 && d9.px === '11.5px' && d9.w === '600' && d9.h === 29 && d9.off === true && d9.opacity === '0.4' && d9.bgIsAccent, JSON.stringify(d9));
  check('D9: 업무 창 뒤판은 검정 50% · 뒤판과 창 150ms', !!d9 && /^(rgba\(0, 0, 0, 0\.5\)|oklab\(0 0 0 \/ 0\.5\))$/.test(d9.back) && d9.backMs === '0.15s' && d9.panelMs === '0.15s', JSON.stringify(d9));
  check('D9: 댓글 시각은 10px muted', !!d9 && !!d9.stamp && d9.stamp.px === '10px' && d9.stamp.muted, JSON.stringify(d9?.stamp));
}

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
