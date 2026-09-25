// 흔적과 움직임 (2026-09-25 · 목업 mockup-traces 3·4·5 · front-nudge N1 · mockup-grace 4)
//   node tests/traces.mjs http://localhost:4598
// 앞 칸 넛지(데스크톱 hover·누른 채 움직임·뒤쪽 탭을 앞 칸 위로 · 폰 길게 누르기) · 지난 방문 이후 남이
// 움직인 탭·활동 줄의 옅은 점 · 최근 활동 '더보기'(열 줄씩)·'접기'와 업무 밖 움직임(주보 발행·동아리 모임) ·
// 내 업무·팀 보드의 '완료한 업무(최근 7일)' · 완료 손맛(마감 목록 완료 원 · 하위 업무 체크).
// 게스트의 '지난 방문'은 브라우저 한 칸(seen_base_v1)이다 — 앱을 열 때마다 지금으로 바뀌므로 **이동할
// 때마다 다시 심는다**(go). 순수 규칙은 logcheck('흔적과 움직임')가 본다.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = 9611;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'ctrace-'));
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
const check = (n, p, d = '') => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
const poll = async (expr, to = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await ev(expr)) return true; await sleep(80); } return false; };

// ── 시드 ─────────────────────────────────────────────────────────────────────
const H = 3600000;
const ago = (h) => new Date(Date.now() - h * H).toISOString();
const pad = (n) => String(n).padStart(2, '0');
const localDay = (offDays) => { const d = new Date(Date.now() - offDays * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const THIS_YEAR = new Date().getFullYear();
const MEMBERS = ['노준석', '조해리', '임재훈', '문진혁', '김승찬'];
const projects = {}; const pids = [];
for (let i = 1; i <= 6; i++) {
  const pid = 'p' + i; pids.push(pid);
  projects[pid] = { id: pid, title: `프로젝트 ${i}`, pinnedLinks: [], createdAt: new Date().toISOString(), year: THIS_YEAR, position: i };
}
const byId = {}; const allIds = [];
const task = (tid, extra) => {
  byId[tid] = { id: tid, projectId: 'p1', title: tid, content: '', status: '시작 전', assignees: ['조해리'], teams: ['찬양팀'],
    startDate: '', dueDate: '', position: allIds.length, author: '노준석', createdAt: ago(24 * 20), updatedAt: ago(24 * 20),
    comments: [], activityLog: [], attachments: [], ...extra };
  allIds.push(tid);
};
const log = (author, h) => ({ id: `l${Math.random().toString(36).slice(2)}`, action: '상태를 진행 중으로 변경했습니다.', author, timestamp: ago(h) });
// 탭 앞 칸·점: p3·p6은 두 사람이 움직였다(앞 칸) · 지난 방문(12시간 전) 뒤에 남이 움직였다(점)
task('f1', { projectId: 'p3', title: '앞칸 셋', activityLog: [log('노준석', 5), log('조해리', 4)] });
task('f2', { projectId: 'p6', title: '앞칸 여섯', activityLog: [log('노준석', 2), log('임재훈', 1)] });
task('f3', { projectId: 'p4', title: '나만 넷', activityLog: [log('노준석', 1.2)] });          // 내 움직임뿐 — 점 없음
task('f4', { projectId: 'p5', title: '오래된 다섯', activityLog: [log('조해리', 20)] });      // 지난 방문 전 — 점 없음
task('f5', { projectId: 'p2', title: '보는 중 둘', activityLog: [log('문진혁', 1.1)] });      // 보고 있는 프로젝트 — 탭 점 없음
// 피드를 길게 — 지난 방문 전의 남의 움직임(점 없음)
for (let i = 0; i < 15; i++) task(`g${i}`, { title: `묵은 업무 ${i}`, activityLog: [log(MEMBERS[i % 5], 30 + i)] });
// 내 업무: 완료한 업무(최근 7일) — 오늘 · 사흘 전은 서고 열흘 전은 빠진다
const mine = { assignees: ['노준석'], teams: ['찬양팀'] };
task('d1', { ...mine, title: '오늘 끝낸 일', status: '완료', completedAt: ago(0.5) });
task('d2', { ...mine, title: '사흘 전 끝낸 일', status: '완료', completedAt: ago(72) });
task('d3', { ...mine, title: '열흘 전 끝낸 일', status: '완료', completedAt: ago(240) });
task('o1', { ...mine, title: '남은 일', status: '진행 중', dueDate: localDay(-1) });
task('o2', { ...mine, title: '끝낼 일', status: '시작 전', dueDate: localDay(-2) });
// 하위 업무
task('s1', { ...mine, title: '하위 업무 있는 일', status: '진행 중', subtasks: [{ id: 'st1', title: '첫 단계', done: false }, { id: 'st2', title: '둘째 단계', done: true }] });
const st = {
  currentUser: { name: '노준석', team: '찬양팀' },
  members: MEMBERS.map(n => ({ id: n, name: n, team: '찬양팀' })),
  projects: { byId: projects, allIds: pids },
  tasks: { byId, allIds },
};
const worship = { services: [{ id: 'sv1', status: 'published', title: '포도주 틀에서', service_date: localDay(-2), published_at: ago(3) }] };
const groupsSeed = { groups: [{ id: 'gA', type: 'club', name: '통통', year: THIS_YEAR, leader_person_id: null, removed_at: null }],
  group_meetings: [{ id: 'mA', group_id: 'gA', meeting_date: '2026-09-27', title: '합주', attendance: [], note: null, created_at: ago(6) }] };

const plant = (extra = '') => ev(`(() => {
  localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))});
  localStorage.setItem('church_worship_v1', ${JSON.stringify(JSON.stringify(worship))});
  localStorage.setItem('church_groups_v1', ${JSON.stringify(JSON.stringify(groupsSeed))});
  localStorage.setItem('theme', 'light');
  localStorage.removeItem('tab_year');
  ${extra}
})()`);
// 지난 방문을 12시간 전으로 심고 연다(앱이 열면서 지금으로 바꾼다)
const go = async (path, ms = 1500) => {
  await ev(`localStorage.setItem('seen_base_v1', ${JSON.stringify(ago(12))})`);
  await send('Page.navigate', { url: URL_BASE + path });
  await wait('Page.loadEventFired'); await sleep(ms);
};
const deskRow = `[...document.querySelectorAll('div')].find(d => /hidden md:block/.test(d.className) && d.querySelector('button[title="설정"]'))?.querySelector('[class*="items-end"][class*="border-t"]')`;
const tabBtn = (row, n) => `[...(${row})?.querySelectorAll('button') || []].find(b => b.textContent.trim() === '프로젝트 ${n}')`;
const center = async (expr) => ev(`(() => { const r = (${expr})?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
const nudge = `(() => { const b = document.querySelector('[data-front-nudge]'); if (!b) return null; const r = b.getBoundingClientRect();
  return { kind: b.getAttribute('data-front-nudge'), text: b.innerText, parent: b.parentElement === document.body,
    inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; })()`;
const divider = (row) => `(() => { const d = (${row})?.querySelector('[data-tab-divider]'); return d ? d.className : ''; })()`;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
await plant(`localStorage.removeItem('front_nudge_seen')`);

// ── 1) 탭 점 ─────────────────────────────────────────────────────────────────
await go('/?p=p2');
const dots = await ev(`(() => {
  const row = ${deskRow}; if (!row) return null;
  const out = {};
  for (const b of row.querySelectorAll('button')) {
    const t = b.textContent.trim(); if (!/^프로젝트 [0-9]$/.test(t)) continue;
    const d = b.querySelector('[data-fresh-dot]');
    const txt = b.querySelector('span.truncate');
    out[t.slice(-1)] = d ? { pos: getComputedStyle(d).position, left: Math.round(d.getBoundingClientRect().right - txt.getBoundingClientRect().left) } : null;
  }
  return out;
})()`);
check('지난 방문 이후 남이 움직인 탭에만 점 — 내 움직임·지난 방문 전·보고 있는 탭은 없다',
  !!dots?.['3'] && !!dots?.['6'] && !dots['2'] && !dots['4'] && !dots['5'] && !dots['1'], JSON.stringify(dots));
check('점은 절대 위치이고 글자 왼쪽에 선다(탭 폭을 바꾸지 않는다)',
  dots?.['3']?.pos === 'absolute' && dots['3'].left <= 0, JSON.stringify(dots?.['3']));

// ── 2) 앞 칸 넛지 — 데스크톱 hover(처음 한 번) ─────────────────────────────────
const c6 = await center(tabBtn(deskRow, 6));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c6.x, y: c6.y });
await poll(`!!document.querySelector('[data-front-nudge]')`, 1500);
const hover1 = await ev(nudge);
const hot = await ev(divider(deskRow));
check("앞 칸 탭 hover에 '최근 활발한 프로젝트' 말풍선 · 사람 수",
  hover1?.kind === 'front' && hover1.text.includes('최근 활발한 프로젝트') && hover1.text.includes('최근 7일 동안 2명이 보고 있어요'), JSON.stringify(hover1));
check('말풍선은 body 포털이고 화면 안이다', hover1?.parent === true && hover1.inView === true, JSON.stringify(hover1));
check('말풍선이 떠 있는 동안 구분선이 accent', /bg-accent/.test(hot) && !/bg-line/.test(hot), hot);
check('한 번 보면 브라우저에 남긴다', (await ev(`localStorage.getItem('front_nudge_seen')`)) === '1');
await sleep(2800);
check('말풍선은 2.5초 뒤 사라지고 구분선이 돌아온다',
  (await ev(nudge)) === null && /bg-line/.test(await ev(divider(deskRow))));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 600 });
const c3 = await center(tabBtn(deskRow, 3));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c3.x, y: c3.y });
await sleep(400);
check('본 브라우저에서는 hover로 다시 뜨지 않는다', (await ev(nudge)) === null);

// ── 3) 앞 칸 탭을 끌려고 하면(누른 채 움직임) 본 뒤에도 뜬다 ─────────────────────
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c3.x, y: c3.y, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c3.x + 24, y: c3.y + 2, button: 'left', buttons: 1 });
await poll(`!!document.querySelector('[data-front-nudge]')`, 1500);
const pressed = await ev(nudge);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c3.x + 24, y: c3.y + 2, button: 'left', buttons: 0, clickCount: 1 });
check('앞 칸 탭을 누른 채 움직이면 말풍선', pressed?.kind === 'front' && pressed.text.includes('2명'), JSON.stringify(pressed));
await sleep(2800);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 600 });

// ── 4) 뒤쪽 탭을 앞 칸 위로 가져가면 ─────────────────────────────────────────
await ev(`(async () => {
  const row = ${deskRow};
  const dt = new DataTransfer();
  const back = ${tabBtn(deskRow, 4)}, front = ${tabBtn(deskRow, 6)};
  back.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  await new Promise(r => setTimeout(r, 60));
  front.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  await new Promise(r => setTimeout(r, 60));
  front.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
})()`, true);
await poll(`!!document.querySelector('[data-front-nudge]')`, 1500);
const backNudge = await ev(nudge);
check('뒤쪽 탭을 앞 칸 위로 가져가면 자동 조정 말풍선(두 줄)',
  backNudge?.kind === 'back' && backNudge.text.includes('앞에 있는 프로젝트는 자동으로 조정돼요.')
  && backNudge.text.includes('이 프로젝트는 구분선 뒤에서 움직일 수 있어요.'), JSON.stringify(backNudge));
await ev(`(${tabBtn(deskRow, 4)}).dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: new DataTransfer() }))`);
await sleep(2700);

// ── 5) 탭 점은 그 프로젝트를 열면 지운다 ─────────────────────────────────────
await ev(`(${tabBtn(deskRow, 3)}).click()`); await sleep(400);
await ev(`(${tabBtn(deskRow, 4)}).click()`); await sleep(400);
const cleared = await ev(`(() => { const b = ${tabBtn(deskRow, 3)}; const b6 = ${tabBtn(deskRow, 6)};
  return { p3: !!b?.querySelector('[data-fresh-dot]'), p6: !!b6?.querySelector('[data-fresh-dot]') }; })()`);
check('연 프로젝트의 점은 지워지고 다른 탭의 점은 남는다', cleared.p3 === false && cleared.p6 === true, JSON.stringify(cleared));

// ── 6) 최근 활동 — 다섯 줄 · 더보기(열 줄씩) · 업무 밖 움직임 · 점 · 접기 ──────────
await go('/?p=dashboard', 1800);
const feedRows = `[...document.querySelectorAll('[data-feed-row]')]`;
const feed1 = await ev(`(() => ({
  n: ${feedRows}.length,
  more: !!document.querySelector('[data-feed-more]'), fold: !!document.querySelector('[data-feed-fold]'),
  rows: ${feedRows}.map(r => ({ kind: r.getAttribute('data-feed-row'), text: r.innerText.replace(/\\n+/g, ' | '), dot: !!r.querySelector('[data-fresh-dot]') })),
}))()`);
check('처음에는 다섯 줄 + 더보기', feed1.n === 5 && feed1.more && !feed1.fold, JSON.stringify({ n: feed1.n, more: feed1.more }));
const svcRow = feed1.rows.find(r => r.kind === 'service');
check('주보 발행이 같은 줄 모양으로 시간순에 선다(알림 문구)',
  !!svcRow && svcRow.text.includes('포도주 틀에서') && svcRow.text.includes('노준석님이 이번 주 주보를 발행했어요'), JSON.stringify(feed1.rows));
const dotted = feed1.rows.filter(r => r.dot).map(r => r.text.split(' | ')[1]).sort();
check('활동 줄의 점 — 지난 방문 이후 남이 움직인 카드만(내 발행·내 움직임은 없다)',
  JSON.stringify(dotted) === JSON.stringify(['보는 중 둘', '앞칸 셋', '앞칸 여섯']), JSON.stringify(dotted));
await ev(`document.querySelector('[data-feed-more]').click()`); await sleep(120);
const feed2 = await ev(`(() => ({
  n: ${feedRows}.length, anim: getComputedStyle(document.querySelector('.dc-feed-chunk')).animationName,
  meet: ${feedRows}.map(r => r.innerText.replace(/\\n+/g, ' | ')).find(t => t.includes('동아리 모임')) || '',
  more: !!document.querySelector('[data-feed-more]'), fold: !!document.querySelector('[data-feed-fold]'),
}))()`);
check('더보기를 누르면 그 자리에서 열 줄 더(창 없음)', feed2.n === 15 && feed2.fold && feed2.more, JSON.stringify(feed2));
check('펴는 줄은 높이 애니메이션으로 들어온다', feed2.anim === 'dc-feed-open', feed2.anim);
check('동아리 모임 일정 줄(알림 문구 · 동아리 이름과 날짜)',
  feed2.meet.includes('통통 · 26. 9. 27.') && feed2.meet.includes('노준석님이 동아리 모임 일정을 잡았어요'), feed2.meet);
await ev(`document.querySelector('[data-feed-more]').click()`); await sleep(300);
const feed3 = await ev(`({ n: ${feedRows}.length, more: !!document.querySelector('[data-feed-more]'), fold: !!document.querySelector('[data-feed-fold]') })`);
check('끝까지 펴면 더보기는 없고 접기만', feed3.n === 22 && !feed3.more && feed3.fold, JSON.stringify(feed3));
await ev(`document.querySelector('[data-feed-fold]').click()`); await sleep(80);
const folding = await ev(`({ closing: document.querySelector('.dc-feed-fold')?.getAttribute('data-closing'), n: ${feedRows}.length })`);
await sleep(600);
const feed4 = await ev(`({ n: ${feedRows}.length, more: !!document.querySelector('[data-feed-more]'), fold: !!document.querySelector('[data-feed-fold]') })`);
check('접기는 줄어든 뒤에 다섯 줄로 돌아간다', folding.closing === 'true' && folding.n === 22 && feed4.n === 5 && feed4.more && !feed4.fold,
  JSON.stringify({ folding, feed4 }));

// ── 7) 마감 목록 완료 원 — 그 자리에서 그린 뒤 저장 ─────────────────────────────
const doneBtn = `[...document.querySelectorAll('[role="button"][aria-label$=" 완료로 옮기기"]')].find(b => b.getAttribute('aria-label').startsWith('남은 일 '))`;
await ev(`(${doneBtn}).click()`); await sleep(250);
await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '완료' && b.closest('[role="dialog"], .fixed, [style*="fixed"]'))?.click()`);
await sleep(60);
const drawing = await ev(`(() => { const d = document.querySelector('[data-done-drawing]');
  return { d: !!d, ring: d?.classList.contains('dc-ring-now'), check: !!d?.querySelector('svg.dc-check-now'),
    anim: d ? getComputedStyle(d).animationName : '',
    stored: JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId.o1.status }; })()`);
check('완료를 확정하면 그 자리에서 원이 튀고 체크가 그려진다(저장 전)',
  drawing.d && drawing.ring && drawing.check && drawing.anim === 'dc-pop-86' && drawing.stored !== '완료', JSON.stringify(drawing));
await sleep(700);
check('그린 뒤 저장된다', (await ev(`JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId.o1.status`)) === '완료');

// ── 8) 내 업무 · 팀 보드 — 완료한 업무(최근 7일) ──────────────────────────────
const groupsJs = `[...document.querySelectorAll('span.text-xs.font-bold')].map(h => {
    const box = h.closest('.pb-4'); return { label: h.textContent.trim(), note: box?.querySelector('[data-group-note]')?.textContent.trim() || '',
      rows: [...(box?.querySelectorAll('.dc-row') || [])].map(r => r.querySelector('span.block.truncate')?.textContent.trim()) }; }).filter(g => g.rows.length)`;
await go('/?p=myTasks', 1400);
const myG = await ev(`(() => { const g = (${groupsJs}); return { groups: g, left: [...document.querySelectorAll('p')].map(p => p.textContent.trim()).find(t => /건 남음/.test(t)) || '' }; })()`);
const doneG = myG.groups.find(g => g.label === '완료한 업무');
check("내 업무 기본 목록 맨 아래 '완료한 업무' + '최근 7일' — 오늘 포함 7일 · 끝낸 날 최근순",
  !!doneG && doneG.note === '최근 7일' && myG.groups[myG.groups.length - 1].label === '완료한 업무'
  && JSON.stringify(doneG.rows) === JSON.stringify(['남은 일', '오늘 끝낸 일', '사흘 전 끝낸 일']), JSON.stringify(myG.groups));
check("'N건 남음'은 남은 것만 센다", myG.left.startsWith('2건 남음'), myG.left);
await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '완료')?.click()`); await sleep(400);
const allDone = await ev(`(${groupsJs})`);
check("'완료' 칩으로 보면 예전 이름('끝낸 업무')으로 전부",
  allDone.length === 1 && allDone[0].label === '끝낸 업무' && !allDone[0].note && allDone[0].rows.includes('열흘 전 끝낸 일'), JSON.stringify(allDone));
await go('/?p=team:찬양팀', 1400);
const teamG = await ev(`(${groupsJs})`);
const teamDone = teamG.find(g => g.label === '완료한 업무');
check('팀 보드에도 같은 구간', !!teamDone && teamDone.note === '최근 7일' && !teamDone.rows.includes('열흘 전 끝낸 일'), JSON.stringify(teamG.map(g => g.label)));

// ── 9) 하위 업무 체크 — 선 그리기 · 취소선 · 되돌리기는 즉시 ─────────────────────
await go('/?p=p1&t=s1', 1800);
const box = (t) => `[...document.querySelectorAll('.subtask-row button[aria-pressed]')].find(b => b.getAttribute('aria-label').startsWith('${t} '))`;
const title = (t) => `[...document.querySelectorAll('[data-subtask-title]')].find(s => s.textContent.trim() === '${t}')`;
const before = await ev(`({ still: !!(${box('둘째 단계')})?.querySelector('svg.dc-check-now'), strike: (${title('둘째 단계')})?.className.includes('dc-strike-now') })`);
check('이미 끝난 줄(다시 연 창)에는 그리지 않는다', before.still === false && before.strike === false, JSON.stringify(before));
await ev(`(${box('첫 단계')}).click()`); await sleep(40);
const drawn = await ev(`(() => { const s = ${title('첫 단계')}; return { check: !!(${box('첫 단계')})?.querySelector('svg.dc-check-now'),
  strike: s?.classList.contains('dc-strike-now'), after: s ? getComputedStyle(s, '::after').animationName : '' }; })()`);
check('방금 체크한 줄 — 체크가 선으로 그려지고 취소선이 지나간다', drawn.check && drawn.strike && drawn.after === 'dc-strike', JSON.stringify(drawn));
await sleep(700);
const settled = await ev(`(() => { const s = ${title('첫 단계')}; return { strike: s?.classList.contains('dc-strike-now'), line: s ? getComputedStyle(s).textDecorationLine : '' }; })()`);
check('다 그어지면 보통 취소선으로 돌아간다', settled.strike === false && settled.line === 'line-through', JSON.stringify(settled));
await ev(`(${box('첫 단계')}).click()`); await sleep(40);
const undone = await ev(`(() => { const s = ${title('첫 단계')}; return { svg: !!(${box('첫 단계')})?.querySelector('svg'), line: s ? getComputedStyle(s).textDecorationLine : '' }; })()`);
check('되돌리면 움직임 없이 바로', undone.svg === false && undone.line === 'none', JSON.stringify(undone));

// ── 10) 폰 — 앞 칸 탭 길게 누르기 · 탭 점 ─────────────────────────────────────
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await go('/?p=p2', 1600);
const mobRow = `[...document.querySelectorAll('div')].find(d => /(^| )md:hidden( |$)/.test(d.className) && d.querySelector('.scrollbar-hide'))?.querySelector('.scrollbar-hide')`;
const mobDots = await ev(`[...(${mobRow})?.querySelectorAll('button') || []].filter(b => b.querySelector('[data-fresh-dot]')).map(b => b.textContent.trim())`);
check('폰 탭 줄에도 같은 점', JSON.stringify(mobDots.sort()) === JSON.stringify(['프로젝트 3', '프로젝트 6']), JSON.stringify(mobDots));
const m6 = await center(tabBtn(mobRow, 6));
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: m6.x, y: m6.y }] });
await sleep(450);
const longPress = await ev(nudge);
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
const still = await ev(`document.querySelector('button[title="프로젝트 이름 수정"]')?.textContent.trim() || ''`);
check('폰에서 앞 칸 탭을 길게 누르면 말풍선', longPress?.kind === 'front' && longPress.text.includes('2명') && longPress.inView, JSON.stringify(longPress));
check('길게 누른 뒤 손을 떼도 그 프로젝트로 넘어가지 않는다', still === '프로젝트 2', still);
await send('Emulation.setTouchEmulationEnabled', { enabled: false });

// ── 11) 움직임을 줄인 사람 — 완료는 기다리지 않고 저장 · 펴는 줄은 애니메이션 없음 ──────
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await plant();
await go('/?p=dashboard', 1600);
await ev(`(${doneBtn}).click()`); await sleep(250);
await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '완료' && b.closest('[role="dialog"], .fixed, [style*="fixed"]'))?.click()`);
await poll(`JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId.o1.status === '완료' || !!document.querySelector('[data-done-drawing]')`, 1500);
const rm = await ev(`({ drawing: !!document.querySelector('[data-done-drawing]'), stored: JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId.o1.status })`);
check('reduced-motion — 그리지 않고 바로 저장', rm.drawing === false && rm.stored === '완료', JSON.stringify(rm));
await ev(`document.querySelector('[data-feed-more]')?.click()`); await sleep(120);
check('reduced-motion — 펴는 줄에 애니메이션이 없다', (await ev(`getComputedStyle(document.querySelector('.dc-feed-chunk')).animationName`)) === 'none');
await ev(`document.querySelector('[data-feed-fold]')?.click()`); await sleep(120);
check('reduced-motion — 접기도 바로', (await ev(`document.querySelectorAll('[data-feed-row]').length`)) === 5);
await send('Emulation.setEmulatedMedia', { features: [] });

check('콘솔 오류 0', logs.length === 0, logs.slice(0, 3).join(' / '));
console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
