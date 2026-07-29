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

const isOpen = () => ev(`!!document.querySelector('.fixed.inset-0.z-50')`);
const openCard = async () => { await ev(`document.querySelector('.board-card').click()`); await sleep(700); };
const geom = () => ev(`(() => {
  const ov = document.querySelector('.fixed.inset-0.z-50');
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
await ev(`[...document.querySelectorAll('.fixed.inset-0.z-50 button')].find(b => b.querySelector('svg'))?.click()`);
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
const popover = () => ev(`(() => {
  const d = [...document.querySelectorAll('div')]
    .find(x => typeof x.className === 'string' && x.className.includes('z-[90]'));
  if (!d) return null;
  return { buttons: [...d.querySelectorAll('button')].map(b => b.textContent.trim()) };
})()`);
// 하위 업무 체크박스는 앱에서 aria-pressed를 쓰는 유일한 요소다
const subCount = () => ev(`document.querySelectorAll('[aria-pressed]').length`);
const clickTrash = async () => {
  const r = await ev(`(() => {
    const cb = document.querySelector('[aria-pressed]');
    if (!cb) return null;
    const trash = [...cb.parentElement.querySelectorAll('button')].find(b => b !== cb);
    if (!trash) return null;
    trash.scrollIntoView({ block: 'center' });
    trash.click();
    return true;
  })()`);
  await sleep(350);
  return r;
};
const popClick = async (label) => {
  await ev(`(() => {
    const d = [...document.querySelectorAll('div')]
      .find(x => typeof x.className === 'string' && x.className.includes('z-[90]'));
    [...d.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click();
  })()`);
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

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
