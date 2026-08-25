// 라이트/다크 × 모바일/데스크톱 전수 훑기
// ----------------------------------------------------------------------------
// 지금까지 테마·반응형은 "사람이 눈으로" 봤다. 화면이 늘면서 그게 안 되어 만든다.
// 네 조합(라이트·다크 × 390px·1440px)에서 주요 화면을 돌며 세 가지를 본다.
//
//   ① 글자가 배경에 묻히지 않는가 (대비 2.0 미만 = 사실상 안 보임)
//      다크에서만 깨지는 하드코딩 색을 잡는 유일하게 자동화 가능한 검사다.
//      "예쁜가"를 판정하지 않는다 — **읽을 수 있는가**만 본다.
//   ② Tailwind 기본 팔레트를 쓰지 않는가 (§8 — 테마를 따라가지 않아 다크에서 튄다)
//   ③ 가로로 넘치지 않는가 (모바일 375~390px에서 반복해서 났던 문제)
//
// 대비 기준을 4.5(WCAG AA)가 아니라 2.0으로 둔 이유: 이 검사는 **깨진 것**을 잡는
// 그물이지 디자인 심사가 아니다. 4.5로 두면 의도한 흐린 글자(fg-faint)가 전부
// 걸려서 아무도 안 보게 된다.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4173';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9397;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'theme-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
async function tg() { for (let i = 0; i < 40; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find(x => x.type === 'page'); if (p?.webSocketDebuggerUrl) return p; } catch {} await sleep(250); } throw new Error('no target'); }
const page = await tg(); const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const evs = []; const logs = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value || a.description).join(' ')); else if (m.method) evs.push(m); });
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const wait = async (m, to = 25000) => { const s = Date.now(); while (Date.now() - s < to) { const i = evs.findIndex(e => e.method === m); if (i >= 0) return evs.splice(i, 1)[0]; await sleep(50); } throw new Error(m); };
const ev = async (e, a = false) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const results = []; const check = (n, p, d = '') => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

// ── 시드 ────────────────────────────────────────────────────────────────────
const mk = (id, title, teams, s, e, status) => ({ id, projectId: 'p1', title, content: '본문 글자입니다.\n- [ ] 체크 항목', status, assignees: ['노준석'], teams, startDate: s, dueDate: e, position: 0, author: '노준석', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', comments: [], activityLog: [], attachments: [], subtasks: [{ id: 's1', title: '하위 하나', done: false }] });
const list = [
  mk('t1', '수련회 포스터', ['미디어팀'], '2026-08-01', '2026-08-10', '진행 중'),
  mk('t2', '버스 견적', ['웰컴팀'], '2026-08-05', '2026-08-20', '시작 전'),
  mk('t3', '찬양 콘티', ['찬양팀'], '2026-08-02', '2026-08-08', '완료'),
];
const byId = {}; list.forEach(t => { byId[t.id] = t; });
const st = {
  currentUser: { name: '노준석', team: '임원진' },
  projects: { byId: { p1: { id: 'p1', title: '2026 여름 수련회', pinnedLinks: [] } }, allIds: ['p1'] },
  tasks: { byId, allIds: list.map(t => t.id) },
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))})`);

// ── 검사 본체 ───────────────────────────────────────────────────────────────
// 배경은 조상으로 올라가며 투명이 아닌 첫 색을 쓴다(그게 눈에 보이는 배경이다).
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
  // Tailwind 기본 팔레트 중 이 앱이 실수로 쓰기 쉬운 것들(§8)
  const BANNED = {
    'rgb(239, 68, 68)': 'red-500', 'rgb(220, 38, 38)': 'red-600',
    'rgb(34, 197, 94)': 'green-500', 'rgb(22, 163, 74)': 'green-600',
    'rgb(59, 130, 246)': 'blue-500', 'rgb(37, 99, 235)': 'blue-600',
    'rgb(234, 179, 8)': 'yellow-500', 'rgb(249, 115, 22)': 'orange-500',
  };
  const low = [], banned = [];
  for (const el of document.querySelectorAll('main *, header *, nav *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.15) continue;
    for (const [prop, key] of [[cs.color, 'color'], [cs.backgroundColor, 'bg'], [cs.borderTopColor, 'border']]) {
      const hit = BANNED[prop];
      if (hit && !(key === 'border' && cs.borderTopWidth === '0px')) {
        banned.push({ name: hit, prop: key, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 16) });
      }
    }
    // 글자가 있는 잎 노드만 대비를 본다(껍데기는 자기 글자가 없다)
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.4) continue;
    const cr = ratio(fg, bgOf(el));
    if (cr < 2.0) low.push({ text: (el.textContent || '').trim().slice(0, 20), ratio: Math.round(cr * 100) / 100, color: cs.color });
  }
  const de = document.documentElement;
  return {
    low: low.slice(0, 6), lowCount: low.length,
    banned: banned.slice(0, 6), bannedCount: banned.length,
    xOverflow: Math.max(0, de.scrollWidth - de.clientWidth),
    theme: de.getAttribute('data-theme'),
  };
})()`;

const SCREENS = [
  ['대시보드', '/'],
  ['프로젝트 보드', '/?p=p1'],
];

for (const [theme, themeLabel] of [['light', '라이트'], ['dark', '다크']]) {
  for (const [w, h, sizeLabel] of [[390, 844, '모바일'], [1440, 900, '데스크톱']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
    for (const [screenLabel, path] of SCREENS) {
      await send('Page.navigate', { url: URL_BASE + path });
      await wait('Page.loadEventFired');
      // 테마는 로드 직후에 박는다(index.html 스크립트가 시스템 설정으로 정해 둔 것을 덮는다)
      await ev(`document.documentElement.setAttribute('data-theme', '${theme}')`);
      await sleep(900);
      const tag = `${themeLabel}·${sizeLabel}·${screenLabel}`;
      const r = await ev(PROBE);
      check(`${tag} — 글자가 배경에 묻히지 않는다`, r.lowCount === 0, `${r.lowCount}건 ${JSON.stringify(r.low)}`);
      check(`${tag} — Tailwind 기본 팔레트를 쓰지 않는다`, r.bannedCount === 0, `${r.bannedCount}건 ${JSON.stringify(r.banned)}`);
      check(`${tag} — 가로로 넘치지 않는다`, r.xOverflow === 0, `${r.xOverflow}px`);
    }
    // 업무 창도 같은 조건에서 한 번 (댓글·활동·본문 체크리스트가 여기 있다)
    await send('Page.navigate', { url: URL_BASE + '/?p=p1' });
    await wait('Page.loadEventFired');
    await ev(`document.documentElement.setAttribute('data-theme', '${theme}')`);
    await sleep(900);
    // 보드 카드는 .board-card다(modalclose와 같은 길) — textContent로 찾으면
    // 목록·달력 등 같은 제목을 쓰는 다른 줄이 먼저 잡힌다
    const opened = await ev(`(() => {
      const c = document.querySelector('.board-card');
      if (!c) return false; c.click(); return true;
    })()`);
    await sleep(700);
    const tag = `${themeLabel}·${sizeLabel}·업무 창`;
    check(`${tag} — 창이 열린다`, opened === true);
    if (opened) {
      const r = await ev(PROBE);
      check(`${tag} — 글자가 배경에 묻히지 않는다`, r.lowCount === 0, `${r.lowCount}건 ${JSON.stringify(r.low)}`);
      check(`${tag} — Tailwind 기본 팔레트를 쓰지 않는다`, r.bannedCount === 0, `${r.bannedCount}건 ${JSON.stringify(r.banned)}`);
      // 본문 체크리스트 체크박스는 직접 그린다(브라우저 기본을 쓰면 다크에서 새까맣다)
      const cb = await ev(`(() => {
        const i = document.querySelector('.tiptap input[type="checkbox"], main input[type="checkbox"]');
        if (!i) return { found: false };
        const cs = getComputedStyle(i);
        return { found: true, appearance: cs.appearance || cs.webkitAppearance, w: Math.round(i.getBoundingClientRect().width) };
      })()`);
      if (cb.found) check(`${tag} — 체크박스를 직접 그린다`, cb.appearance === 'none', JSON.stringify(cb));
    }
  }
}
await send('Emulation.clearDeviceMetricsOverride');

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
