// 첨부 실측 — 로컬 vite(클라우드 모드 · 라이브 Supabase · /api/drive는 dev 미들웨어) + 헤드리스 크롬 하나.
//   npx vite --config scripts/attach-live/vite.isolated.config.mjs --port 4614 --strictPort     (dev 서버 — 캐시를 따로 · §6-29-z-21)
//   python scripts/attach-live/make_samples.py <samples dir>
//   node --env-file=.env scripts/attach-live/setup.mjs <state.json>
//   LH3_NOREF=1 node --env-file=.env scripts/attach-live/e2e.mjs <state.json> <origin> <samples dir> [shots dir]
//   node --env-file=.env scripts/attach-live/teardown.mjs <state.json>
// 환경: ONLY=task|worship(한쪽만) · FILES=<정규식>(샘플 고르기) · LH3_NOREF=1(localhost Referer의 lh3 429를 피한다 · §6-29-z-20)
// 확장자마다: 올리기(업무 창 '수정' → 파일 칸) → files 행(card_id·mime·source) → 드라이브 자리(업무 폴더 ⊂ 프로젝트 폴더) →
// 변환 사본(같은 폴더 · wsrole) → 미리보기 갈래·그려짐 → 확대(ctrl+휠)·창 넓히기·폭 바꾸기 → '구글 문서에서 편집'(grantEditors)
// → 비밀번호(엑셀) → 삭제(행 · 원본 · 사본이 폴더에서 빠지는지). 주보: 큐시트 docx · 송폼 pdf · 표지 png 같은 차례.
// 지우는 것은 teardown.mjs. 이 스크립트는 레포 파일을 고치지 않는다.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const STATE = process.argv[2];
const st = JSON.parse(readFileSync(STATE, 'utf8'));
const ORIGIN = process.argv[3] || 'http://localhost:4614';
const SAMPLES = process.argv[4];
const SHOTS = process.argv[5] || null; if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ONLY = process.env.ONLY || '';   // 'task' | 'worship' | '' (둘 다)
const REF = new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0];
const KEY = `sb-${REF}-auth-token`;
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const errors = [];
const table = {};   // 파일 이름 → { 업로드, 폴더, 행, 미리보기, 확대, 구글편집, 비번, 삭제, note }
const cell = (name, k, v) => { (table[name] ||= {})[k] = v; };
const note = (name, s) => { const t = (table[name] ||= {}); t.note = [t.note, s].filter(Boolean).join(' · '); };
const saveState = () => writeFileSync(STATE, JSON.stringify(st, null, 2));

async function drive(body) {
  const r = await fetch(process.env.DRIVE_WEBAPP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token: process.env.DRIVE_WEBAPP_TOKEN }), redirect: 'follow' });
  const j = JSON.parse(await r.text()); if (j.error) throw new Error(j.error); return j;
}

// fetch를 감싸 /api/drive 왕복을 페이지 안에 적어 둔다(액션 · 상태 · 답의 앞부분)
const FETCH_SPY = `(() => {
  if (window.__spy) return; window.__spy = 1; window.__drive = [];
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.includes('/api/drive')) return orig(input, init);
    let action = ''; try { const b = JSON.parse(init?.body || '{}'); action = b.action || 'upload'; var meta = { name: b.name, fileId: b.fileId, folderId: b.folderId, convertTo: b.convertTo, cue: b.cueEditors, editors: Array.isArray(b.editors) ? b.editors.length : null }; } catch {}
    const t0 = Date.now();
    const res = await orig(input, init);
    let body = ''; try { body = (await res.clone().text()).slice(0, 300); } catch {}
    window.__drive.push({ url: url.split('?')[0], action, status: res.status, ms: Date.now() - t0, meta, body });
    return res;
  };
  const op = window.open; window.__opened = [];
  window.open = (u, ...rest) => { window.__opened.push(String(u)); return null; };
})()`;

async function launch(port) {
  const prof = mkdtempSync(join(tmpdir(), 'attach-e2e-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); } catch {} if (!target) await sleep(250); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); return; }
    if (d.method === 'Fetch.requestPaused') {
      // lh3에 localhost Referer가 실리면 구글이 429(HTML)로 막는다 — 크롬은 ORB로 끊고 그림이 '불러오지 못했어요'가 된다.
      // 배포 주소 Referer·Referer 없음은 60/60 200이었다(2026-10-02 실측). 배포에서 일어나지 않는 일이라 실측에서는 Referer만 걷는다.
      const h = Object.entries(d.params.request.headers || {}).filter(([k]) => k.toLowerCase() !== 'referer').map(([name, value]) => ({ name, value }));
      ws.send(JSON.stringify({ id: ++id, method: 'Fetch.continueRequest', params: { requestId: d.params.requestId, headers: h } }));
      return;
    }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description?.split('\n')[0] || d.params.exceptionDetails?.text);
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) errors.push(`console.${d.params.type} ` + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const obj = async (expr) => (await send('Runtime.evaluate', { expression: expr })).result.objectId;
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FETCH_SPY });
  // Fetch로 머리줄을 걷어도 크롬이 Referer를 다시 싣는 경우가 있어, 문서 전체의 리퍼러 정책을 같이 끈다(실측 전용)
  if (process.env.LH3_NOREF) await send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('readystatechange', () => { if (!document.querySelector('meta[name=referrer]')) { const m = document.createElement('meta'); m.name = 'referrer'; m.content = 'no-referrer'; document.head.prepend(m); } })` });
  const size = async (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await size(1280, 900);
  const waitFor = async (expr, timeout = 8000, every = 100) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(every); }
    return null;
  };
  const shot = async (name) => { if (!SHOTS) return; const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, name.replace(/[\\/:*?"<>|]/g, '_') + '.png'), Buffer.from(data, 'base64')); };
  return { send, ev, obj, waitFor, size, shot, kill: () => { try { ws.close(); } catch {} try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} } };
}

const clickText = (label, scope = 'document') => `(() => { const b = [...${scope}.querySelectorAll('button, a')].filter(b => b.textContent.trim() === ${JSON.stringify(label)} && b.offsetParent); if (!b.length) return false; b[b.length - 1].click(); return true; })()`;
const MODAL = `document.querySelector('.fixed.inset-0.z-\\\\[100\\\\]')`;

async function login(p) {
  await p.send('Page.navigate', { url: ORIGIN + '/' });
  await p.waitFor(`document.readyState === 'complete'`, 20000);
  await p.ev(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(st.users[0].session))}); true`);
}
async function openTask(p, edit = true) {
  await p.send('Page.navigate', { url: `${ORIGIN}/?p=${st.projectId}&t=${st.cardId}` });
  const ok = await p.waitFor(`[...document.querySelectorAll('button')].some(b => ['수정','수정 완료'].includes(b.textContent.trim()) && b.offsetParent)`, 30000);
  if (!ok) throw new Error('업무 창이 안 열렸다');
  await sleep(600);
  if (edit) {
    await p.ev(clickText('수정'));
    await p.waitFor(`!!document.querySelector('input[type=file][multiple]') && [...document.querySelectorAll('p')].some(x => x.textContent.includes('파일을 끌어다 놓거나'))`, 10000);
  }
  // 목록이 다녀올 때까지
  await sleep(1500);
}
const rowExpr = (name) => `[...document.querySelectorAll('p.text-xs.truncate')].find(x => x.textContent === ${JSON.stringify(name)})?.closest('.flex.items-center')`;

// 미리보기 창이 무엇을 그리고 있나(한 번 재기)
const PROBE = `(() => {
  const m = ${MODAL}; if (!m) return { open: false };
  const panel = m.firstElementChild;
  const img = m.querySelector('[data-zoom-layer] img');
  const canvases = [...m.querySelectorAll('canvas')];
  const video = m.querySelector('video'), audio = m.querySelector('audio');
  const pre = m.querySelector('pre');
  const frames = [...m.querySelectorAll('iframe')];
  const edit = [...m.querySelectorAll('a')].find(a => a.textContent.includes('구글 문서에서 편집'));
  const txt = m.innerText;
  return {
    open: true, panelW: panel?.offsetWidth || 0,
    img: img ? { w: img.naturalWidth, layerW: img.parentElement?.parentElement?.offsetWidth || 0, complete: img.complete } : null,
    canvas: canvases.length ? { n: canvases.length, w: canvases[0].offsetWidth, h: canvases[0].offsetHeight, px: canvases[0].width } : null,
    video: video ? { rs: video.readyState, dur: video.duration, src: (video.src || '').slice(0, 5), err: video.error?.code || 0 } : null,
    audio: audio ? { rs: audio.readyState, dur: audio.duration, src: (audio.src || '').slice(0, 5), err: audio.error?.code || 0 } : null,
    pre: pre ? pre.textContent.slice(0, 80) : null,
    md: m.querySelector('.max-w-3xl') && !pre ? m.querySelector('.max-w-3xl').textContent.slice(0, 80) : null,
    frames: frames.map(f => ({ src: f.getAttribute('src') || '', sandbox: f.getAttribute('sandbox'), srcdoc: (f.getAttribute('srcdoc') || '').slice(0, 120), w: f.offsetWidth, op: getComputedStyle(f).opacity })),
    edit: edit ? edit.getAttribute('href') : null,
    fallback: txt.includes('미리보기를 지원하지 않아요') || txt.includes('표로 볼 수 없어요') || txt.includes('준비하지 못했어요'),
    preparing: txt.includes('미리보기를 준비하고 있어요'), stalled: txt.includes('응답하지 않아요'),
    text: txt.slice(0, 200),
  };
})()`;

const EXPECT = {   // 확장자 → 기대하는 미리보기 갈래
  pdf: 'pdf', png: 'image', jpg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', avif: 'image',
  mp4: 'video', mov: 'video', webm: 'video', mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio',
  txt: 'text', md: 'text', tsv: 'text', json: 'text', html: 'html', csv: 'sheet', xlsx: 'sheet', xlsm: 'sheet',
  docx: 'gdoc', pptx: 'gdoc', zip: 'drive', hwp: 'drive',
};
const COPY_EXT = { docx: 'document', xlsx: 'spreadsheets', xlsm: 'spreadsheets', csv: 'spreadsheets', pptx: 'presentation' };
const ext = (n) => n.split('.').pop().toLowerCase();

function kindOf(pr) {
  if (!pr?.open) return 'closed';
  if (pr.img && pr.img.w > 0) return 'image';
  if (pr.canvas) return 'pdf';
  if (pr.video) return 'video';
  if (pr.audio) return 'audio';
  if (pr.pre || pr.md) return 'text';
  const f = pr.frames[0];
  if (f?.sandbox != null && f.srcdoc) return 'html';
  if (f && /docs\.google\.com\/spreadsheets/.test(f.src)) return 'sheet';
  if (f && /docs\.google\.com\/(document|presentation)/.test(f.src)) return 'gdoc';
  if (f && /drive\.google\.com\/file/.test(f.src)) return 'drive';
  if (pr.fallback) return 'fallback';
  return pr.preparing ? 'preparing' : 'unknown';
}
function rendered(k, pr, name) {
  const e = ext(name);
  if (k === 'image') return pr.img.w > 0;
  if (k === 'pdf') return pr.canvas.w > 50 && pr.canvas.px > 50;
  if (k === 'video') return pr.video.rs >= 1 && pr.video.dur > 0 && pr.video.src === 'blob:';
  if (k === 'audio') return pr.audio.rs >= 1 && pr.audio.dur > 0 && pr.audio.src === 'blob:';
  if (k === 'text') return /MARK/.test(pr.pre || pr.md || '') || (e === 'json' && /JSON-MARK/.test(pr.pre || ''));
  if (k === 'html') return /HTML-MARK/.test(pr.frames[0].srcdoc) && pr.frames[0].sandbox === 'allow-scripts';
  if (k === 'sheet' || k === 'gdoc' || k === 'drive') return pr.frames[0].op === '1';
  return false;
}

// 구글 사본이 로그인 없이 보이는가(링크를 아는 사람은 보기) — 앱 안 iframe이 남의 화면에서도 그려지는 조건
async function publicView(kindSeg, id) {
  const u = `https://docs.google.com/${kindSeg}/d/${id}/${kindSeg === 'presentation' ? 'embed' : 'preview'}`;
  try { const r = await fetch(u, { redirect: 'follow' }); const t = await r.text(); return { status: r.status, title: (t.match(/<title>([^<]*)<\/title>/) || [])[1] || '', login: /accounts\.google\.com/.test(r.url) }; }
  catch (e) { return { status: 0, title: e.message }; }
}

const p = await launch(9731);
const closeModal = async () => { await p.ev(`${MODAL}?.querySelector('button[title="닫기"]')?.click()`); await p.waitFor(`!${MODAL}`, 3000); };
// 확인 팝오버 — 누르기 전에 같은 글자 버튼 수를 세고, 하나 늘면(포털로 뜬 확인 버튼) 그 마지막을 누른다
const CONFIRM_BTNS = (label) => `[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.title && !b.getAttribute('aria-label') && b.offsetParent)`;
async function confirmVia(openExpr, label = '삭제') {
  const n0 = await p.ev(`${CONFIRM_BTNS(label)}.length`);
  await p.ev(openExpr);
  const ok = await p.waitFor(`${CONFIRM_BTNS(label)}.length > ${n0}`, 3000);
  if (!ok) return false;
  await p.ev(`${CONFIRM_BTNS(label)}.pop().click()`);
  return true;
}
try {
  await login(p);
  // **vite가 늦게 묶는 의존성을 미리 부른다.** 첫 실행에서 발췌(fileText → pdf.js 워커)를 처음 import하는 순간
  // vite가 'optimized dependencies changed. reloading'으로 페이지를 새로 고쳐, 올리던 파일 다섯이 드라이브에만
  // 남거나(행을 못 만듦) 아예 안 갔다 — 배포에는 없는 dev 서버의 일이다. 여기서 한 번 불러 새로 고침을 먼저 치른다.
  const pdfB64 = readFileSync(join(SAMPLES, 'songform.pdf')).toString('base64');
  for (let round = 0; round < 3; round++) {
    await p.ev(`(async () => { window.__warm = 1;
      const mods = ['/src/services/fileText.js', '/src/components/FilePreviewModal.jsx', '/src/components/PdfView.jsx', '/src/components/OfficeView.jsx',
        '/src/services/xlsx.js', '/src/services/docx.js', '/src/services/pptx.js', '/src/views/worshipView.jsx', '/src/components/worshipDetail.jsx', '/src/services/image.js'];
      await Promise.all(mods.map(u => import(u).catch(() => null)));
      const ft = await import('/src/services/fileText.js');
      const bytes = Uint8Array.from(atob(${JSON.stringify(pdfB64)}), c => c.charCodeAt(0));
      try { await ft.extractFileText(new File([bytes], 'w.pdf', { type: 'application/pdf' })); } catch {}
      return true; })()`).catch(() => null);
    await sleep(6000);
    const kept = await p.ev(`window.__warm === 1`).catch(() => false);
    if (kept) break;
    await p.waitFor(`document.readyState === 'complete'`, 20000);
  }
  const files = readdirSync(SAMPLES).filter(f => !/^20991227_|^songform/.test(f)).filter(f => !process.env.FILES || new RegExp(process.env.FILES).test(f)).sort();
  // ════════════════ 업무 첨부 ════════════════
  if (ONLY !== 'worship') {
    await openTask(p, true);
    const input = await p.obj(`[...document.querySelectorAll('input[type=file][multiple]')].find(i => i.parentElement?.textContent.includes('파일을 끌어다 놓거나'))`);
    await p.send('DOM.setFileInputFiles', { objectId: input, files: files.map(f => join(SAMPLES, f)) });
    const t0 = Date.now();
    // 올리는 중 줄이 바로 서는가
    const staged = await p.waitFor(`[...document.querySelectorAll('p')].filter(x => x.textContent.startsWith('드라이브에 올리는 중')).length`, 5000);
    check('고르자마자 올리는 중 줄', staged > 0, `${staged}줄`);
    // 행이 전부 생길 때까지(큰 파일 둘은 Storage를 거친다)
    let rows = [];
    let lastN = -1, lastAt = Date.now();
    for (let i = 0; i < 300; i++) {
      rows = (await db.from('files').select('*').eq('card_id', st.cardId)).data || [];
      if (rows.length >= files.length) break;
      if (rows.length !== lastN) { lastN = rows.length; lastAt = Date.now(); }
      const pend = await p.ev(`[...document.querySelectorAll('p')].filter(x => x.textContent.startsWith('드라이브에 올리는 중')).length`).catch(() => 0);
      if (!pend && Date.now() - lastAt > 60000) break;   // 올리는 줄도 없고 1분째 그대로 — 더 기다릴 것이 없다
      await sleep(2000);
    }
    check('files 행 전부', rows.length === files.length, `${rows.length}/${files.length} · ${Math.round((Date.now() - t0) / 1000)}초`);
    st.fileIds = rows.map(r => r.id); st.driveIds = rows.flatMap(r => [r.drive_file_id, r.preview_file_id]).filter(Boolean); saveState();
    // 사본이 붙을 때까지
    const needCopy = rows.filter(r => COPY_EXT[ext(r.name)]);
    for (let i = 0; i < 60; i++) {
      rows = (await db.from('files').select('*').eq('card_id', st.cardId)).data || [];
      if (needCopy.every(n => rows.find(r => r.id === n.id)?.preview_file_id)) break;
      await sleep(2000);
    }
    st.driveIds = rows.flatMap(r => [r.drive_file_id, r.preview_file_id]).filter(Boolean); saveState();
    const card = (await db.from('cards').select('drive_folder_id').eq('id', st.cardId).single()).data;
    const proj = (await db.from('projects').select('drive_folder_id, name').eq('id', st.projectId).single()).data;
    st.cardFolderId = card.drive_folder_id; st.projectFolderId = proj.drive_folder_id; saveState();
    const inProj = await drive({ action: 'list', folderId: proj.drive_folder_id });
    const byPath = await drive({ action: 'list', path: [proj.name] });
    check('프로젝트 폴더 = 워크스페이스/프로젝트 이름', byPath.folderId === proj.drive_folder_id, `${byPath.folderId} vs ${proj.drive_folder_id}`);
    check('업무 폴더 ⊂ 프로젝트 폴더', (inProj.files || []).some(f => f.id === card.drive_folder_id && f.name === '첨부 검증 업무'), (inProj.files || []).map(f => f.name).join(','));
    const inCard = (await drive({ action: 'list', folderId: card.drive_folder_id })).files || [];
    for (const f of files) {
      const r = rows.find(x => x.name === f.normalize('NFC'));
      cell(f, '업로드', !!r);
      if (!r) { note(f, '행 없음'); continue; }
      const okRow = r.card_id === st.cardId && r.project_id === st.projectId && !r.service_id && r.source === 'drive' && !!r.drive_file_id && r.size_bytes > 0;
      cell(f, '행', okRow);
      note(f, `mime=${r.mime_type || 'null'}`);
      const d = inCard.find(x => x.id === r.drive_file_id);
      cell(f, '폴더', !!d && !d.role);
      if (COPY_EXT[ext(f)]) {
        const c = inCard.find(x => x.id === r.preview_file_id);
        const okC = !!r.preview_file_id && !!c && c.role === 'sheetpreview' && !c.key;
        cell(f, '사본', okC);
        if (!okC) note(f, `사본 ${r.preview_file_id ? (c ? `role=${c.role}` : '업무 폴더에 없음') : '없음'}`);
        if (r.preview_file_id) {
          const pv = await publicView(COPY_EXT[ext(f)], r.preview_file_id);
          if (!(pv.status === 200 && !pv.login)) note(f, `사본 공개보기 ${pv.status} ${pv.login ? '로그인 요구' : ''}`);
        }
      }
    }
    const strays = inCard.filter(x => !rows.some(r => r.drive_file_id === x.id || r.preview_file_id === x.id));
    check('업무 폴더에 행 없는 파일 없음', strays.length === 0, strays.map(s => s.name).join(','));
    // 드라이브 왕복 기록(올리기 쪽)
    const log1 = await p.ev(`window.__drive || []`);
    const converts = log1.filter(x => x.action === 'convert');
    check('convert 호출 = 사본 대상 수', converts.length === needCopy.length, converts.map(c => `${c.meta?.name}:${c.status}:${c.meta?.convertTo}:editors=${c.meta?.editors}`).join(' | '));
    check('convert가 원본 폴더 id를 싣는다', converts.every(c => c.meta?.folderId === card.drive_folder_id), converts.map(c => c.meta?.folderId).join(','));
    const failsUp = log1.filter(x => x.status !== 200);
    check('업로드 중 /api/drive 실패 없음', failsUp.length === 0, failsUp.map(f => `${f.action} ${f.status} ${f.body}`).join(' | '));

    // ── 미리보기 ──
    await openTask(p, true);   // 새로 읽어 사본 id를 가진 행으로
    for (const f of files) {
      const name = f.normalize('NFC');
      const has = await p.waitFor(`!!${rowExpr(name)}`, 8000);
      if (!has) { cell(f, '미리보기', false); note(f, '목록에 줄 없음'); continue; }
      await p.ev(`${rowExpr(name)}.querySelector('button[title="미리보기"]').click()`);
      const want = EXPECT[ext(f)] || '?';
      let pr = null, k = '';
      const t1 = Date.now();
      while (Date.now() - t1 < 25000) {
        pr = await p.ev(PROBE); k = kindOf(pr);
        if (k === want && rendered(k, pr, f)) break;
        if (k === 'fallback') break;
        await sleep(400);
      }
      const ok = k === want && rendered(k, pr, f);
      cell(f, '미리보기', ok);
      note(f, `갈래=${k}${k !== want ? `(기대 ${want})` : ''}${pr?.frames?.[0]?.src ? ' ' + pr.frames[0].src.replace(/\/d\/[^/]+/, '/d/…').slice(0, 90) : ''}`);
      if (!ok) note(f, `probe ${JSON.stringify(pr).slice(0, 300)}`);
      await sleep(k === 'gdoc' || k === 'sheet' || k === 'drive' ? 2500 : 300);
      await p.shot('task-' + f);
      // 확대 — 사진·PDF만 우리 배율이 있다
      if (k === 'image' || k === 'pdf') {
        const before = k === 'image' ? pr.img.layerW : pr.canvas.w;
        const box = await p.ev(`(() => { const m = ${MODAL}; const el = m.querySelector('[data-zoom-layer]')?.parentElement || m.querySelector('canvas')?.closest('.overflow-auto, .overflow-y-auto, [class*=overflow]'); const r = (el || m).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        for (let i = 0; i < 3; i++) { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -200, modifiers: 2 }); await sleep(120); }
        await sleep(k === 'pdf' ? 1500 : 400);
        const after = await p.ev(PROBE);
        const a = k === 'image' ? after.img?.layerW : after.canvas?.w;
        // 맞춤으로 되돌리기 — 두 번 누르기
        await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 2000, modifiers: 2 }); await sleep(k === 'pdf' ? 1500 : 400);
        const back = await p.ev(PROBE);
        const b = k === 'image' ? back.img?.layerW : back.canvas?.w;
        const zOk = a > before * 1.3 && Math.abs(b - before) <= 2;
        cell(f, '확대', zOk);
        note(f, `확대 ${before}→${a}→${b}`);
        if (k === 'pdf') {
          // 창 넓히기 + 폭이 바뀌면 다시 그린다(§6-29-z-9)
          const w0 = (await p.ev(PROBE)).panelW;
          await p.ev(`${MODAL}.querySelector('button[title="화면 가득"]').click()`); await sleep(1200);
          const wide = await p.ev(PROBE);
          await p.ev(`${MODAL}.querySelector('button[title="창 크기로"]').click()`); await sleep(800);
          await p.size(900, 900); await sleep(1500);
          const narrow = await p.ev(PROBE);
          await p.size(1280, 900); await sleep(1200);
          const rOk = wide.panelW === 1280 && wide.panelW > w0 && narrow.canvas && narrow.canvas.w < pr.canvas.w;
          check(`PDF 창 넓히기·폭 바꾸기 (${f})`, rOk, `창 ${w0}→${wide.panelW} · 캔버스 ${pr.canvas.w}→(900폭)${narrow.canvas?.w}`);
          note(f, `넓히기 ${w0}→${wide.panelW}, 900폭 캔버스 ${narrow.canvas?.w}`);
          cell(f, '확대', zOk && rOk);
        }
      } else cell(f, '확대', '해당없음');
      // 구글 문서에서 편집
      if (COPY_EXT[ext(f)]) {
        const href = pr?.edit || '';
        const r = rows.find(x => x.name === name);
        const hrefOk = href.includes(`/d/${r?.preview_file_id}/edit`) && href.includes('authuser=') && !href.includes('rm=minimal');
        const before = (await p.ev(`window.__drive.length`));
        await p.ev(`[...${MODAL}.querySelectorAll('a')].find(a => a.textContent.includes('구글 문서에서 편집'))?.click()`);
        const g = await p.waitFor(`window.__drive.slice(${before}).find(x => x.action === 'grantEditors')`, 20000);
        const opened = await p.ev(`window.__opened.slice(-1)[0] || ''`);
        const okG = hrefOk && g && g.status === 200 && opened === href;
        cell(f, '구글편집', okG);
        note(f, `편집 ${hrefOk ? 'href ok' : 'href ' + href.slice(0, 80)} · grant ${g ? g.status + ' ' + g.body.slice(0, 60) : '없음'}`);
        if (k === 'gdoc') note(f, `앱 안 틀 ${/\/edit\?/.test(pr.frames[0].src) ? '편집 주소' : '보기 주소'}`);
      } else cell(f, '구글편집', pr?.edit ? false : '해당없음');
      await closeModal();
    }

    if (files.some(f => ext(f) === 'xlsx')) {
    // ── 비밀번호(엑셀 · csv만 자물쇠가 선다) ──
    for (const f of files) if (!['xlsx', 'xlsm', 'csv'].includes(ext(f))) cell(f, '비번', '해당없음');
    const lockable = await p.ev(`[...document.querySelectorAll('button[title="비밀번호 설정"]')].map(b => b.closest('.flex.items-center').querySelector('p.text-xs.truncate')?.textContent)`);
    check('자물쇠는 표 파일에만', lockable.length === files.filter(f => ['xlsx', 'xlsm', 'csv'].includes(ext(f))).length && lockable.every(n => /\.(xlsx|xlsm|csv)$/.test(n)), lockable.join(','));
    const X = files.find(f => ext(f) === 'xlsx').normalize('NFC');
    await p.ev(`${rowExpr(X)}.querySelector('button[title="비밀번호 설정"]').click()`);
    await p.waitFor(`!!document.querySelector('input[placeholder="비밀번호를 정해주세요"]')`, 3000);
    const pwIn = await p.obj(`document.querySelector('input[placeholder="비밀번호를 정해주세요"]')`);
    await p.send('DOM.focus', { objectId: pwIn });
    await p.send('Input.insertText', { text: 'pw-1234' });
    await sleep(200);
    await p.ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '설정' && !b.disabled)?.click()`);
    await sleep(2500);
    const locked = (await db.from('files').select('view_pw, view_pw_salt, view_pw_by').eq('name', X).eq('card_id', st.cardId).single()).data;
    const hashOk = !!locked?.view_pw && locked.view_pw !== 'pw-1234' && /^[0-9a-f]{64}$/.test(locked.view_pw) && !!locked.view_pw_salt;
    // 다시 열면 잠겨 있다(보기 화면)
    await openTask(p, false);
    const lockIcon = await p.waitFor(`!!${rowExpr(X)}?.querySelector('[aria-label="비밀번호가 걸린 파일"]')`, 8000);
    await p.ev(`${rowExpr(X)}.querySelector('button[title="비밀번호를 넣어야 열려요"]')?.click()`);
    const gate = await p.waitFor(`!!document.querySelector('input[type=password][placeholder="비밀번호"]')`, 3000);
    const modalWhileLocked = await p.ev(`!!${MODAL}`);
    const gIn = await p.obj(`document.querySelector('input[type=password][placeholder="비밀번호"]')`);
    await p.send('DOM.focus', { objectId: gIn }); await p.send('Input.insertText', { text: 'wrong' });
    await p.ev(clickText('열기')); await sleep(600);
    const wrongMsg = await p.ev(`document.body.innerText.includes('비밀번호가 맞지 않아요')`);
    const embedWrong = await p.ev(`!!${rowExpr(X)}?.parentElement?.querySelector('iframe')`);
    await p.ev(`(() => { const i = document.querySelector('input[type=password][placeholder="비밀번호"]'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await p.send('DOM.focus', { objectId: gIn }); await p.send('Input.insertText', { text: 'pw-1234' });
    await p.ev(clickText('열기'));
    const embedded = await p.waitFor(`!!${rowExpr(X)}?.parentElement?.querySelector('iframe[src*="spreadsheets"]')`, 6000);
    await sleep(2500); await p.shot('task-password-unlocked');
    const pwOk = hashOk && lockIcon && gate && !modalWhileLocked && wrongMsg && !embedWrong && embedded;
    cell(files.find(f => ext(f) === 'xlsx'), '비번', pwOk);
    check('엑셀 비밀번호 잠금·해제', pwOk, `hash ${hashOk} · 자물쇠 ${!!lockIcon} · 물음 ${!!gate} · 잠긴 채 창 ${modalWhileLocked} · 틀린 말 ${wrongMsg} · 틀린 뒤 펼침 ${embedWrong} · 맞춘 뒤 펼침 ${!!embedded}`);
    const C = files.find(f => ext(f) === 'csv'); if (C) cell(C, '비번', '자물쇠 있음(미실측)');
    }

    // ── 삭제 ──
    await openTask(p, true);
    rows = (await db.from('files').select('*').eq('card_id', st.cardId)).data || [];
    for (const f of files) {
      const name = f.normalize('NFC');
      const has = await p.waitFor(`!!${rowExpr(name)}?.querySelector('button[title="삭제"]')`, 5000);
      if (!has) { cell(f, '삭제', false); note(f, '삭제 버튼 없음'); continue; }
      const okc = await confirmVia(`${rowExpr(name)}.querySelector('button[title="삭제"]').click()`);
      if (!okc) note(f, '삭제 확인 팝오버 안 뜸');
      await sleep(700);
    }
    for (let i = 0; i < 90; i++) { const left = (await db.from('files').select('id').eq('card_id', st.cardId)).data || []; if (!left.length) break; await sleep(2000); }
    // 휴지통 왕복이 끝나기를 기다린다(행이 먼저 지워지고 실체는 뒤에서 간다)
    await p.waitFor(`window.__drive.filter(x => x.action === 'trash').length >= ${rows.length + rows.filter(r => r.preview_file_id).length}`, 240000, 1000);
    await sleep(2000);
    const afterDel = (await drive({ action: 'list', folderId: st.cardFolderId })).files || [];
    const trashLog = await p.ev(`window.__drive.filter(x => x.action === 'trash')`);
    for (const f of files) {
      const r = rows.find(x => x.name === f.normalize('NFC')); if (!r) continue;
      const rowGone = !((await db.from('files').select('id').eq('id', r.id)).data || []).length;
      const origGone = !afterDel.some(x => x.id === r.drive_file_id);
      const copyGone = !r.preview_file_id || !afterDel.some(x => x.id === r.preview_file_id);
      const ok = rowGone && origGone && copyGone;
      cell(f, '삭제', ok);
      if (!ok) note(f, `삭제: 행 ${rowGone} 원본 ${origGone} 사본 ${copyGone}`);
    }
    check('삭제 뒤 업무 폴더가 빈다', afterDel.length === 0, afterDel.map(x => x.name).join(','));
    check('휴지통 왕복 실패 없음', trashLog.every(t => t.status === 200), trashLog.filter(t => t.status !== 200).map(t => `${t.status} ${t.body}`).join(' | '));
  }

  // ════════════════ 주보 파일 ════════════════
  if (ONLY !== 'task') {
    const CUE = readdirSync(SAMPLES).find(f => /^20991227_/.test(f)), SONG = 'songform.pdf', COVER = '검증 사진.png';
    const openSvc = async () => {
      await p.send('Page.navigate', { url: `${ORIGIN}/?p=worship&s=${st.serviceId}` });
      const ok = await p.waitFor(`!!document.querySelector('.worship-detail')`, 30000);
      if (!ok) throw new Error('주보 상세가 안 열렸다');
      await sleep(1500);
    };
    const tab = (label) => p.ev(`[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
    await openSvc();
    await p.ev(`document.querySelector('.worship-edit-open').click()`);
    await p.waitFor(`!!document.querySelector('.worship-cover-tools')`, 8000);
    await tab('말씀'); await p.waitFor(`!!document.querySelector('.worship-cue-files input[type=file]')`, 5000);
    const cueAccept = await p.ev(`document.querySelector('.worship-cue-files input[type=file]').accept`);
    await p.send('DOM.setFileInputFiles', { objectId: await p.obj(`document.querySelector('.worship-cue-files input[type=file]')`), files: [join(SAMPLES, CUE)] });
    await sleep(500);
    await tab('찬양'); await p.waitFor(`!!document.querySelector('.worship-songforms input[type=file]')`, 5000);
    const songAccept = await p.ev(`document.querySelector('.worship-songforms input[type=file]').accept`);
    await p.send('DOM.setFileInputFiles', { objectId: await p.obj(`document.querySelector('.worship-songforms input[type=file]')`), files: [join(SAMPLES, SONG)] });
    await sleep(500);
    await p.send('DOM.setFileInputFiles', { objectId: await p.obj(`document.querySelector('.worship-cover-tools input[type=file]')`), files: [join(SAMPLES, COVER)] });
    const dlg = await p.waitFor(`!!document.querySelector('.worship-cover-save')`, 5000);
    check('표지 올리자마자 표지 위치 창', !!dlg);
    await sleep(800);
    await p.ev(`document.querySelector('.worship-cover-save')?.click()`);
    note(CUE, `accept="${cueAccept}"`); note(SONG, `accept="${songAccept || '(없음 — 아무 파일)'}"`);
    let srows = [];
    for (let i = 0; i < 90; i++) {
      srows = (await db.from('files').select('*').eq('service_id', st.serviceId)).data || [];
      const cue = srows.find(r => r.kind === 'cuesheet');
      if (srows.length >= 3 && cue?.preview_file_id) break;
      await sleep(2000);
    }
    st.fileIds = [...(st.fileIds || []), ...srows.map(r => r.id)]; st.driveIds = [...(st.driveIds || []), ...srows.flatMap(r => [r.drive_file_id, r.preview_file_id]).filter(Boolean)];
    const svc = (await db.from('services').select('drive_folder_id').eq('id', st.serviceId).single()).data;
    st.serviceFolderId = svc.drive_folder_id; saveState();
    const byPath = await drive({ action: 'list', path: ['예배', '2099-12-27'] });
    check('주보 폴더 = 워크스페이스/예배/2099-12-27', byPath.folderId === svc.drive_folder_id, `${byPath.folderId} vs ${svc.drive_folder_id}`);
    const inSvc = byPath.files || [];
    for (const [f, kind] of [[CUE, 'cuesheet'], [SONG, 'songform'], [COVER, 'cover']]) {
      const r = srows.find(x => x.kind === kind);
      const key = `주보 ${kind} (${f})`;
      cell(key, '업로드', !!r);
      if (!r) { note(key, '행 없음'); continue; }
      cell(key, '행', r.service_id === st.serviceId && !r.card_id && r.kind === kind && r.source === 'drive' && !!r.drive_file_id);
      note(key, `mime=${r.mime_type}`);
      cell(key, '폴더', inSvc.some(x => x.id === r.drive_file_id));
      if (kind === 'cuesheet') {
        const c = inSvc.find(x => x.id === r.preview_file_id);
        cell(key, '사본', !!c && c.role === 'sheetpreview');
        const conv = (await p.ev(`window.__drive.filter(x => x.action === 'convert')`)).pop();
        note(key, `convert cue=${conv?.meta?.cue} editors=${conv?.meta?.editors} folder=${conv?.meta?.folderId === svc.drive_folder_id ? '주보 폴더' : conv?.meta?.folderId}`);
      }
    }
    // ── 미리보기 ──
    await openSvc();
    await tab('말씀'); await p.waitFor(`!!document.querySelector('.worship-cue-file-open')`, 8000);
    await p.ev(`document.querySelector('.worship-cue-file-open').click()`);
    let pr = null; for (let i = 0; i < 50; i++) { pr = await p.ev(PROBE); if (pr.frames?.[0]?.op === '1') break; await sleep(400); }
    const ck = kindOf(pr); const cueRow = srows.find(x => x.kind === 'cuesheet');
    const cueKey = `주보 cuesheet (${CUE})`;
    cell(cueKey, '미리보기', ck === 'gdoc' && rendered(ck, pr, CUE));
    cell(cueKey, '확대', '해당없음');
    const inAppEdit = /\/edit\?/.test(pr.frames?.[0]?.src || '');
    note(cueKey, `앱 안 틀=${inAppEdit ? '편집 주소(/edit?rm=minimal&authuser)' : '보기 주소'} · 머리줄 편집=${pr.edit ? '있음' : '없음'}`);
    cell(cueKey, '구글편집', !!pr.edit && pr.edit.includes(`/d/${cueRow?.preview_file_id}/edit`));
    cell(cueKey, '비번', '해당없음(사용자 결정)');
    await sleep(2500); await p.shot('worship-cuesheet-preview');
    await closeModal();
    await tab('찬양'); await p.waitFor(`!!document.querySelector('.worship-songform-open')`, 8000);
    await p.ev(`document.querySelector('.worship-songform-open').click()`);
    for (let i = 0; i < 50; i++) { pr = await p.ev(PROBE); if (pr.canvas) break; await sleep(400); }
    const songKey = `주보 songform (${SONG})`;
    cell(songKey, '미리보기', kindOf(pr) === 'pdf' && rendered('pdf', pr, SONG));
    cell(songKey, '구글편집', pr.edit ? false : '해당없음'); cell(songKey, '비번', '해당없음');
    await p.shot('worship-songform-preview');
    {
      const box = await p.ev(`(() => { const r = ${MODAL}.querySelector('canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      const before = pr.canvas.w;
      for (let i = 0; i < 3; i++) { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -200, modifiers: 2 }); await sleep(120); }
      await sleep(1500); const a = (await p.ev(PROBE)).canvas?.w;
      cell(songKey, '확대', a > before * 1.3); note(songKey, `확대 ${before}→${a}`);
    }
    await closeModal();
    const coverKey = `주보 cover (${COVER})`;
    const coverImg = await p.waitFor(`(() => { const i = document.querySelector('.worship-head img'); return i && i.naturalWidth > 0 ? i.src.slice(0, 60) : null; })()`, 15000);
    cell(coverKey, '미리보기', !!coverImg); note(coverKey, `머리 사진 ${coverImg || '없음'}`);
    cell(coverKey, '확대', '해당없음'); cell(coverKey, '구글편집', '해당없음'); cell(coverKey, '비번', '해당없음');
    // ── 삭제 ──
    const before = await p.ev(`window.__drive.length`);
    await p.ev(`document.querySelector('.worship-edit-open').click()`); await sleep(800);
    await tab('말씀'); await sleep(500);
    check('큐시트 삭제 확인', await confirmVia(`document.querySelector('.worship-cue-files button[aria-label$=" 삭제"]').click()`)); await sleep(800);
    await tab('찬양'); await sleep(500);
    check('송폼 삭제 확인', await confirmVia(`document.querySelector('.worship-songforms button[aria-label$=" 삭제"]').click()`)); await sleep(800);
    check('표지 제거 확인', await confirmVia(`document.querySelector('.worship-cover-remove').click()`, '제거'));
    const needTrash = srows.length + srows.filter(r => r.preview_file_id).length;
    await p.waitFor(`window.__drive.slice(${before}).filter(x => x.action === 'trash').length >= ${needTrash}`, 120000, 1000);
    await sleep(2000);
    const leftRows = (await db.from('files').select('id').eq('service_id', st.serviceId)).data || [];
    const leftDrive = (await drive({ action: 'list', folderId: st.serviceFolderId })).files || [];
    for (const [f, kind] of [[CUE, 'cuesheet'], [SONG, 'songform'], [COVER, 'cover']]) {
      const r = srows.find(x => x.kind === kind); const key = `주보 ${kind} (${f})`;
      if (!r) continue;
      const ok = !leftRows.some(x => x.id === r.id) && !leftDrive.some(x => x.id === r.drive_file_id) && (!r.preview_file_id || !leftDrive.some(x => x.id === r.preview_file_id));
      cell(key, '삭제', ok);
    }
    check('주보 파일 지운 뒤 폴더가 빈다', leftDrive.length === 0, leftDrive.map(x => x.name).join(','));
  }
} catch (e) {
  check('실행', false, e.stack?.split('\n').slice(0, 3).join(' / '));
} finally {
  const all = await p.ev(`window.__drive || []`).catch(() => []);
  writeFileSync(join(SHOTS || tmpdir(), 'drive-log.json'), JSON.stringify(all, null, 2));
  writeFileSync(join(SHOTS || tmpdir(), 'table.json'), JSON.stringify(table, null, 2));
  p.kill();
}
console.log('\n── 표 ──');
for (const [k, v] of Object.entries(table)) console.log(k, JSON.stringify(v));
console.log('\n── 콘솔 오류·경고(앞 40) ──'); console.log(errors.slice(0, 40).join('\n'));
const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
