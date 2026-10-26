// ============================================================================
// 화면 네 조합 촬영(UI 다듬기 회차용 · 2026-10-26)
// ----------------------------------------------------------------------------
//   node scripts/ui-shots.mjs                       # 실데이터(운영 · 마스터 임시 세션 · 읽기만) — 모든 화면 × 데스크톱·폰 × 라이트·다크
//   node scripts/ui-shots.mjs --guest               # 게스트 미리보기(npx vite --mode guest --port 4598 --strictPort 를 먼저 띄운다 · 시연 데이터)
//   node scripts/ui-shots.mjs --only home,club --sizes phone --themes dark --out shots/b1
//   node scripts/ui-shots.mjs --path "?p=<프로젝트 id>" --name board   # 목록에 없는 화면 하나
//
// 결과: <out>/<화면>-<폭>-<테마>.png + <out>/index.html(한 장에 모아 보기). 기본 out은 shots/<날짜-시각>(git 밖).
//
// 실데이터 모드는 운영 DB를 **읽기만** 한다:
//   · 세션 — 서버 키로 마스터 매직링크를 만들어 받은 세션을 페이지에 넣는다(메일이 가지 않는다) · 끝나면 signOut으로 회수.
//   · 쓰기 차단 — Supabase REST의 GET 아닌 요청 · Storage 쓰기 · /api POST(제목 조회 /api/link-title·/api/yt만 통과)는
//     브라우저 안에서 가짜 성공으로 끝낸다. 읽기 RPC(/rest/v1/rpc/*)와 /auth는 통과 · 실시간 소켓은 막는다(접속 표시가 남지 않게).
//   · 아무것도 누르지 않는다 — 화면을 열고 찍기만. 창·시트를 찍고 싶으면 --click "선택자"(그 화면에서 한 번 누른다 · 쓰기는 위에서 막힌다).
// 크롬 경로는 CHROME 환경변수(기본 Program Files) · 검사 묶음(tests/themefit)과 같은 CDP 방식.
// ============================================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);
const GUEST = has('guest');
const APP = arg('app', GUEST ? 'http://localhost:4598' : 'https://church-workspace.vercel.app');
const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/[: ]/g, '-').slice(0, 16);
const OUT = arg('out', `shots/${stamp}${GUEST ? '-guest' : ''}`);
const SIZES = { desk: [1440, 900, 1, false], phone: [390, 844, 2, true] };
const sizes = (arg('sizes', 'desk,phone')).split(',');
const themes = (arg('themes', 'light,dark')).split(',');
const CLICK = arg('click');
const DEEP = has('deep');     // 첫 화면 대신 상세·창·탭(업무 창 · 주보 상세/수정 · 가이드 · 동아리 · 위키 장 · 인수인계 · 알림 · 검색 …)
const MOTION = has('motion'); // 마지막 누름을 애니메이션 1/10 속도로 틀고 0.25초마다 찍는다(실제 25ms 간격 · <화면>-<폭>-f<N>.png · 지금 테마 하나)

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').map(l => l.trim())
  .filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const db = GUEST ? null : createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// 화면 — 이름 · 주소 · (있으면) 연 뒤 누를 버튼 글자(주소로 못 여는 탭 — 모임 '동아리'). 프로젝트 보드는 실데이터면 가장 최근에 고친 진행 중 프로젝트로 채운다.
const SCREENS = [
  ['home', ''], ['worship', '?p=worship'], ['word', '?p=word'],
  ['groups', '?p=groups'], ['club', '?p=groups', '동아리'], ['welcome', '?p=groups&tab=welcome'],
  ['dashboard', '?p=dashboard'], ['mytasks', '?p=myTasks'], ['schedule', '?p=schedule'], ['members', '?p=members'], ['wiki', '?p=wiki'],
];
if (arg('path')) SCREENS.splice(0, SCREENS.length, [arg('name', 'screen'), arg('path')]);
else if (db) {
  // 업무가 가장 많은 살아 있는 프로젝트(빈 보드는 다듬을 것이 안 보인다)
  const { data: ps } = await db.from('projects').select('id').eq('archived', false).is('deleted_at', null);
  const { data: cs } = await db.from('cards').select('project_id').is('deleted_at', null).limit(5000);
  const n = new Map();
  for (const c of cs || []) n.set(c.project_id, (n.get(c.project_id) || 0) + 1);
  const best = (ps || []).map(p => p.id).sort((a, b) => (n.get(b) || 0) - (n.get(a) || 0))[0];
  if (best) SCREENS.push(['board', `?p=${best}`]);
}
if (DEEP && db && !arg('path')) {
  // 상세는 실데이터에서 내용이 가장 많은 것(빈 상세는 다듬을 것이 안 보인다)
  const board = SCREENS.find(([n]) => n === 'board')?.[1];
  const one = async (q) => { try { return (await q).data?.[0] || null; } catch { return null; } };
  const talk = await one(db.from('cards').select('id,project_id').is('deleted_at', null).order('comment_count', { ascending: false }).limit(1));
  const files = await one(db.from('cards').select('id,project_id').is('deleted_at', null).order('file_count', { ascending: false }).limit(1));
  const svc = await one(db.from('services').select('id').not('published_at', 'is', null).order('service_date', { ascending: false }).limit(1));
  const guide = await one(db.from('sun_guides').select('service_id').order('created_at', { ascending: false }).limit(1));
  const { data: gm } = await db.from('group_meetings').select('group_id').limit(2000);
  const gn = new Map();
  for (const m of gm || []) gn.set(m.group_id, (gn.get(m.group_id) || 0) + 1);
  const club = [...gn].sort((a, b) => b[1] - a[1])[0]?.[0];
  const event = await one(db.from('events').select('id').order('start_date', { ascending: false }).limit(1));
  const wiki = await one(db.from('wiki_pages').select('id').order('source_count', { ascending: false }).limit(1));
  const task = (c) => `?p=${c.project_id}&t=${c.id}`;
  const s = svc && `?p=worship&s=${svc.id}`;
  SCREENS.splice(0, SCREENS.length,
    ...(talk ? [['task', task(talk)], ['task-edit', task(talk), '수정']] : []),
    ...(files ? [['task-files', task(files)]] : []),
    ...(board ? [['task-new', board, '새 업무'], ['board-table', board, '표'], ['board-cal', board, '캘린더'], ['board-graph', board, '그래프']] : []),
    ...(s ? [['bulletin', s], ['bulletin-word', s, '말씀'], ['bulletin-songs', s, '찬양'], ['bulletin-notices', s, '광고'], ['bulletin-edit', s, '수정'], ['story', s, '넘기면서 보기']] : []),
    ['mynotes', '?p=worship', '내 예배 노트'],
    ...(guide ? [['guide', `?p=groups&guide=${guide.service_id}`]] : []),
    ...(club ? [['club-detail', `?p=groups&g=${club}`]] : []),
    ['sunplan', '?p=groups', '순 편성'], ['bible', '?p=word', '성경 읽기'],
    ...(wiki ? [['wiki-page', `?p=wiki&wiki=${wiki.id}`]] : []),
    ...(event ? [['event', `?p=schedule&ev=${event.id}`]] : []),
    ['roster', '?p=members', '청년 명단'], ['handover', '?p=members', '인수인계'],
    ['dash-people', '?p=dashboard', '청년'], ['dash-map', '?p=dashboard', '연결'],
    ['bell', '', '알림'], ['search', '', '검색'], ['dabooti', '', '다붓이에게 물어보기'],
  );
}
const only = arg('only')?.split(',');
const screens = only ? SCREENS.filter(([n]) => only.includes(n)) : SCREENS;

// ── 실데이터 세션(마스터 · 메일 없이) ──────────────────────────────────────
let session = null;
let storageKey = null;
if (!GUEST) {
  const { data: m } = await db.from('admins').select('email').eq('is_master', true).limit(1);
  const email = m?.[0]?.email;
  const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (e2) throw e2;
  session = s.session;
  storageKey = `sb-${new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
}

// ── 크롬 ────────────────────────────────────────────────────────────────────
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9300 + Math.floor(Math.random() * 400);
const prof = mkdtempSync(join(tmpdir(), 'uishots-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (t) => new Promise(r => setTimeout(r, t));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch { /* 아직 */ }
  if (!target) await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pend = new Map();
const waiters = new Map();
ws.addEventListener('message', async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result); return; }
  if (m.method === 'Fetch.requestPaused') { onPaused(m.params); return; }
  waiters.get(m.method)?.forEach(f => f(m.params));
});
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const once = (method) => new Promise(r => { const list = waiters.get(method) || []; const f = (p) => { waiters.set(method, (waiters.get(method) || []).filter(x => x !== f)); r(p); }; list.push(f); waiters.set(method, list); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

// 쓰기 차단(실데이터만)
const READ_API = ['/api/link-title', '/api/yt'];
let blocked = 0;
function onPaused({ requestId, request }) {
  const u = request.url;
  const read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || u.includes('/auth/v1/') || u.includes('/rest/v1/rpc/') || READ_API.some(p => u.includes(p));
  if (read) { send('Fetch.continueRequest', { requestId }).catch(() => {}); return; }
  blocked++;
  send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from('[]').toString('base64') }).catch(() => {});
}

await send('Page.enable');
await send('Runtime.enable');
if (!GUEST) {
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*realtime*'] });
  await send('Fetch.enable', { patterns: [{ urlPattern: `${env.VITE_SUPABASE_URL}/*` }, { urlPattern: `${APP}/api/*` }] });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `if (location.origin === ${JSON.stringify(new URL(APP).origin)}) { try { localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))}); } catch {} }`,
  });
} else {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('ops_demo', '1'); } catch {}` });
}
// 검사 묶음과 같이 — 헤드리스가 누른 내려받기를 PC 다운로드 폴더에 쌓지 않는다(tests/README 머리)
await send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});

mkdirSync(OUT, { recursive: true });
const shots = [];
for (const size of sizes) {
  const [w, h, dpr, mobile] = SIZES[size];
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
  await send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  for (const [name, path, tap] of screens) {
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: APP + '/' + path });
    await loaded;
    // 뼈대가 걷힐 때까지(최대 10초) — 다 뜬 화면을 찍는다
    for (let i = 0; i < 40; i++) { if (!(await ev(`document.querySelectorAll('.dc-skeleton, [aria-busy="true"]').length`))) break; await sleep(250); }
    await sleep(2000);   // 1.2초였을 때 홈 카드 몇 장이 아직 읽는 중에 찍혔다(2026-10-26)
    // 누름 — ' > '로 이어 누른다 · '@'로 시작하면 선택자 · 아니면 보이는 버튼·탭·링크의 글자/aria-label/title
    const steps = tap ? tap.split(' > ') : [];
    for (const [si, t] of steps.entries()) {
      // 탭은 권한을 읽은 뒤에 선다 — 생길 때까지(최대 10초) 기다렸다 누르고, 다시 뼈대가 걷히길 기다린다
      const find = t.startsWith('@') ? `document.querySelector(${JSON.stringify(t.slice(1))})`
        : `[...document.querySelectorAll('button,[role=tab],a')].find(b => b.offsetParent !== null && [b.textContent.trim(), b.getAttribute('aria-label'), b.getAttribute('title')].includes(${JSON.stringify(t)}))`;
      let found = false;
      for (let i = 0; i < 40 && !(found = await ev(`!!(${find})`)); i++) await sleep(250);
      if (!found) { console.log(`  못 찾음 ${name}-${size} · ${t}`); break; }
      if (MOTION && si === steps.length - 1) {
        await send('Animation.enable');
        await send('Animation.setPlaybackRate', { playbackRate: 0.1 });
        await ev(`(${find})?.click()`);
        for (let k = 0; k < 16; k++) {
          const { data } = await send('Page.captureScreenshot', { format: 'png' });
          const file = `${name}-${size}-f${String(k).padStart(2, '0')}.png`;
          writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
          shots.push({ name, size, theme: `f${k}`, file });
          await sleep(250);
        }
        await send('Animation.setPlaybackRate', { playbackRate: 1 });
        break;
      }
      await ev(`(${find})?.click()`);
      await sleep(600);
      for (let i = 0; i < 40; i++) { if (!(await ev(`document.querySelectorAll('.dc-skeleton, [aria-busy="true"]').length`))) break; await sleep(250); }
      await sleep(900);
    }
    if (MOTION) { console.log('찍음', `${name}-${size} 프레임`); continue; }
    if (CLICK) { await ev(`document.querySelector(${JSON.stringify(CLICK)})?.click()`); await sleep(1200); }
    for (const theme of themes) {
      await ev(`document.documentElement.setAttribute('data-theme', '${theme}')`);
      await sleep(400);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const file = `${name}-${size}-${theme}.png`;
      writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
      shots.push({ name, size, theme, file });
      console.log('찍음', file);
    }
  }
}

// 한 장에 모아 보기 — 화면마다 한 줄(데스크톱 라이트·다크 · 폰 라이트·다크)
const rows = screens.map(([name]) => `<section><h2>${name}</h2><div class="row">${shots.filter(s => s.name === name)
  .map(s => `<figure class="${s.size}"><img src="${s.file}" loading="lazy"><figcaption>${s.size} · ${s.theme}</figcaption></figure>`).join('')}</div></section>`).join('');
writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>화면 ${stamp}</title><style>
body{font:13px system-ui;margin:16px;background:#eee}h2{margin:24px 0 8px}.row{display:flex;gap:12px;align-items:flex-start;overflow-x:auto}
figure{margin:0}figure.desk img{width:560px}figure.phone img{width:200px}img{border:1px solid #ccc;display:block}figcaption{color:#555;margin-top:4px}</style>${rows}`);

if (session) {
  const { error } = await db.auth.admin.signOut(session.access_token, 'local');
  console.log(error ? `세션 회수 실패: ${error.message}` : '세션 회수됨');
}
console.log(`끝 — ${shots.length}장 · ${OUT}/index.html${GUEST ? '' : ` · 막은 쓰기 요청 ${blocked}개`}`);
ws.close();
chrome.kill();
await sleep(300);
try { rmSync(prof, { recursive: true, force: true }); } catch { /* 크롬이 아직 쥐고 있다 */ }
process.exit(0);
