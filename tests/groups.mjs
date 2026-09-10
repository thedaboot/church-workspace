// 모임 줄기 — 내 순(구성원·예배 출석·공유된 노트) · 동아리(목록·가입 신청·리더 도구·
// 모임 출석) · 순 편성(자격 분기·순원 추가/이동/빼기·새 순)
//
// 게스트 모드에는 클라우드가 없어서 화면이 비어 있는 것이 정상이다. 그래서 모임 서비스
// 계층(services/groups.js)이 게스트에서 보는 자리(localStorage 'church_groups_v1')에
// 가짜 순·동아리·신청을 심고, 화면을 실제로 눌러 본다. 자격(일반·동아리장·마스터·
// 리더순장)은 시드의 me가 말한다 — 클라우드에서는 RLS가 같은 경계를 긋는다(0035).
//
// 예배 출석은 **예배 줄기의 저장 자리**를 그대로 본다(services/worship.js의
// 'church_worship_v1'). 두 키에 같은 표를 심는 이유가 그것이다 — 클라우드에서는
// 한 DB의 같은 표다.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = 9581;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cgrp-'));
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
const check = (n, p, d = '') => {
  const line = `${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`;
  results.push(line);
  // 고치는 중에는 한 줄씩 바로 본다 — 중간에 넘어지면 어디까지 갔는지 알 수 있다
  if (process.env.LIVE) console.log(line);
};

// ── 0) 공유 카드 · 딥링크 (api/share.js type 'c') ────────────────────────────
// 동아리 가입 신청 QR이 가리키는 자리다. 크롤러가 읽는 OG 메타이자 **사람이 실제로
// 가는 주소**를 만든다 — 조회가 실패하면 제목이 기본값으로 떨어지고 appUrl이 '/'로
// 남아 딥링크가 통째로 사라지는데, 크롤러 말고는 아무도 안 보는 화면이라 증상이
// 밖으로 안 난다(HANDOFF §6-31-d — projects.description에서 실제로 그랬다).
// 그래서 브라우저와 무관하게 handler를 직접 부른다. 게스트 스위트에는 supabase가
// 없으므로 PostgREST 응답을 fetch에서 가로챈다(로그인 키가 필요 없다).
// 되돌리기 확인: select('name')을 없는 칸('name, description')으로 되돌리면 아래
// '조회가 막히면 …'만 남고 나머지 셋이 깨진다.
{
  const CLUB_ID = '11111111-2222-3333-4444-555555555555';
  const env = { url: process.env.VITE_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  process.env.VITE_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'stub-key';
  const realFetch = globalThis.fetch;
  const realErr = console.error;
  const errs = [];
  let reply = () => new Response(JSON.stringify({ name: '통통' }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, init) => {
    const u = String(input?.url || input);
    if (u.includes('/rest/v1/')) return reply(u);
    return realFetch(input, init);
  };
  console.error = (...a) => { errs.push(a.map(String).join(' ')); };
  const { default: shareHandler } = await import(new URL('../api/share.js', import.meta.url).href);
  const share = async (query) => {
    let html = '';
    const res = { setHeader() {}, status() { return res; }, send(body) { html = body; } };
    await shareHandler({ query, headers: { host: 'doda.test', 'x-forwarded-proto': 'https' } }, res);
    return html;
  };
  const withApply = await share({ type: 'c', id: CLUB_ID, apply: '1' });
  const noApply = await share({ type: 'c', id: CLUB_ID });
  reply = () => new Response(JSON.stringify({ code: '42703', message: 'column does not exist' }),
    { status: 400, headers: { 'content-type': 'application/json' } });
  const broken = await share({ type: 'c', id: CLUB_ID });
  globalThis.fetch = realFetch;
  console.error = realErr;
  if (env.url === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = env.url;
  if (env.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = env.key;

  check('공유 카드 — 동아리 이름이 제목이고 설명은 신청 안내다',
    withApply.includes('<meta property="og:title" content="더다붓 · 통통"/>')
    && withApply.includes('content="가입 신청은 이 링크에서 할 수 있어요."'),
    withApply.slice(withApply.indexOf('<title>'), withApply.indexOf('<title>') + 60));
  // 사람이 가는 자리 — `?apply=1`이 붙어 오면 앱 주소에도 그대로 실린다
  check('공유 카드 — apply=1이면 딥링크에도 신청이 실린다',
    withApply.includes(`location.replace("/?p=groups&g=${CLUB_ID}&apply=1")`),
    (withApply.match(/location\.replace\((.*)\)/) || [])[1]);
  check('공유 카드 — apply가 없으면 상세만 연다',
    noApply.includes(`location.replace("/?p=groups&g=${CLUB_ID}")`) && !noApply.includes('apply=1'),
    (noApply.match(/location\.replace\((.*)\)/) || [])[1]);
  check('공유 카드 — 조회가 막히면 로그에 남는다(빈 딥링크로 둔갑하지 않게)',
    errs.some(e => e.includes('[share] 동아리 조회 실패')) && broken.includes('location.replace("/")'),
    errs.join(' / ').slice(0, 80));
}

// ── 가짜 명단 · 순 · 동아리 ─────────────────────────────────────────────────
const Y = new Date().getFullYear();

// 주일 주보의 날짜는 **오늘을 기준으로** 잡는다. 출석을 셀 기준 예배가
// '오늘까지 온 주일 중 출석이 들어온 것'이라(services/groups.js attendanceSunday)
// 날짜를 못 박아 두면 그 날이 오기 전에 돌릴 때 검사가 헛으로 넘어진다 —
// `${Y}-08-30`으로 박혀 있던 것을 이 규칙이 들어오면서 걷었다(2026-09-08).
const KST_TODAY = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const dayShift = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dateLabel = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${+m}월 ${+d}일`; };
const SUN_OLD = dayShift(KST_TODAY, -14);    // s0 — 지지난 주일
const SUN_LAST = dayShift(KST_TODAY, -7);    // s1 — 출석이 들어온 가장 최근 주일
const FRI_LAST = dayShift(KST_TODAY, -3);    // s2 — 주일이 아닌 예배
const SUN_DRAFT = dayShift(KST_TODAY, 1);    // s3 — 아직 작성 중
const SUN_AHEAD = dayShift(KST_TODAY, 5);    // 앞으로 올 주일(발행만 된 것 — mut로 심는다)
const seed = {
  people: [
    { id: 'p1', name: '김윤주', profile_id: 'u1' },
    { id: 'p2', name: '천진영', profile_id: null },
    { id: 'p3', name: '김승찬', profile_id: 'u3' },
    { id: 'p4', name: '배현민', profile_id: null },
    // 계정이 이어진 사람은 **계정 표시명**으로 부른다(사용자 결정 2026-09-03) —
    // services/people.js가 name을 표시명으로 덮고 명단 이름을 roster_name에 남긴다.
    // 게스트 시드는 그 '덮은 뒤'의 모양이다(클라우드에서 화면이 받는 것과 같다).
    { id: 'p5', name: '말감이', roster_name: '임재훈', profile_id: 'u5' },
    { id: 'p6', name: '노준석', profile_id: 'u2' },
    { id: 'p7', name: '조해리', profile_id: null },
    { id: 'p8', name: '양민혁', profile_id: null },
    // 순 편성 대상이 아닌 사역자(0040 sun_exempt) — 명단에는 있고 순 후보에는 없다
    { id: 'p9', name: '신효진', profile_id: null, sun_exempt: true },
  ],
  groups: [
    { id: 'g1', type: 'sun', name: '꼬순', year: Y, leader_person_id: 'p1' },
    { id: 'g2', type: 'sun', name: 'TT순', year: Y, leader_person_id: 'p6' },
    { id: 'g0', type: 'sun', name: '지난 순', year: Y - 1, leader_person_id: 'p1' },
    { id: 'gc1', type: 'club', name: '통통', year: null, leader_person_id: 'p6', note: '통기타 동아리' },
    { id: 'gc2', type: 'club', name: '말씀읽기', year: null, leader_person_id: 'p3', note: null },
    { id: 'gc3', type: 'club', name: '서부버튼', year: null, leader_person_id: 'p5', note: '보드게임 동아리' },
  ],
  group_members: [
    { group_id: 'g1', person_id: 'p1' }, { group_id: 'g1', person_id: 'p2' }, { group_id: 'g1', person_id: 'p3' },
    { group_id: 'g2', person_id: 'p6' }, { group_id: 'g2', person_id: 'p4' }, { group_id: 'g2', person_id: 'p5' },
    { group_id: 'g0', person_id: 'p1' },
    { group_id: 'gc1', person_id: 'p6' }, { group_id: 'gc1', person_id: 'p2' },
    { group_id: 'gc2', person_id: 'p3' }, { group_id: 'gc2', person_id: 'p1' },
    { group_id: 'gc3', person_id: 'p5' },
  ],
  club_applications: [
    { id: 'a1', group_id: 'gc1', person_id: 'p1', status: 'pending', created_at: `${Y}-08-20T00:00:00Z` },
  ],
  group_meetings: [
    { id: 'mt1', group_id: 'gc1', meeting_date: `${Y}-08-25`, title: '여름 합주', attendance: ['p6'], note: null },
  ],
  // 출석을 셀 **주일** 예배는 s1이다 — s2는 종류가 다르고 s3은 작성 중이며,
  // s0에도 출석이 있지만 s1이 더 최근이다(attendanceSunday).
  services: [
    { id: 's0', kind: 'sunday', service_date: SUN_OLD, status: 'published', title: '지난 주일' },
    { id: 's1', kind: 'sunday', service_date: SUN_LAST, status: 'published', title: '흔들리지 않는 기쁨' },
    { id: 's2', kind: '금요 열정 예배', service_date: FRI_LAST, status: 'published', title: '깨어 기도하라' },
    { id: 's3', kind: 'sunday', service_date: SUN_DRAFT, status: 'draft', title: '' },
  ],
  attendance: [
    { service_id: 's1', person_id: 'p1' }, { service_id: 's1', person_id: 'p2' },
    { service_id: 's0', person_id: 'p3' },
  ],
  service_notes: [
    // 노트는 마크다운으로 쓴다 — 뷰어가 원문을 글자로 흘리지 않는지 함께 본다
    { id: 'n1', service_id: 's1', profile_id: 'u9', shared_to_sun: true, author_name: '천진영',
      body: '## 오늘 남은 말씀\n**기쁨**은 상황이 아니라 붙드시는 손에서 온다\n- 빌립보서 4:4' },
    { id: 'n2', service_id: 's1', profile_id: 'u8', shared_to_sun: false, author_name: '양민혁',
      body: '이 줄은 비공개라 모임 화면에 오면 안 된다' },
    // **내 비공개 노트도 오면 안 된다**(사용자 지시 2026-09-07 — 예전에는 잠금 표시를
    // 달고 이 목록에 섰다). p1의 계정이 u1이다.
    { id: 'n3', service_id: 's1', profile_id: 'u1', shared_to_sun: false, author_name: '김윤주',
      body: '아직 나만 보는 묵상' },
    // 내가 **공유한** 노트 — 이 줄에는 토글이 남고, 끄면 목록에서 사라진다
    { id: 'n4', service_id: 's0', profile_id: 'u1', shared_to_sun: true, author_name: '김윤주',
      body: '지난 주일에 나눈 노트' },
  ],
};

// 순모임 가이드는 **다른 키에 산다**(church_sunguide_v1 — components/sunGuide.jsx의
// 저장 자리 계약). 한 벌은 주보 한 건에 붙고, body는 화면이 한 덩이로 읽고 쓴다.
// 2026-09-08 템플릿에는 줄글 요약이 없고 질문이 넷이며 마지막에 예시 한 줄이 붙는다.
const GUIDE = {
  passage: { ref: '빌립보서 4:4-7', title: '항상 기뻐하라' },
  points: [
    { title: '기뻐하라', body: '명령이자 **약속**이다' },
    { title: '염려하지 말라', body: '기도로 옮겨 놓는다' },
    { title: '지키시는 평강', body: '이해를 넘어선다' },
  ],
  questions: [
    '지난 한 주 어떻게 지내셨는지 나눠 주세요',
    '이번 주 가장 염려한 일은 무엇이었나요',
    '그 염려를 기도로 옮겨 보았나요',
    '오늘 감사한 한 가지를 나눠 주세요',
  ],
  questionNote: '고단한 한 주를 보낸 순원이 있다면 다같이 카페에 가서 달달한 것 먹기',
};
// 줄글 요약을 들고 있던 지난 판 — **그대로 열려야 한다**(sunGuide.js의 선택 필드).
const OLD_GUIDE = {
  passage: { ref: '빌립보서 4:1-3', title: '주 안에 서라' },
  summaryRef: '빌립보서 3:17~21',
  summary: '바울은 시민권이 하늘에 있다고 말합니다',
  points: GUIDE.points,
  questions: GUIDE.questions.slice(0, 3),
};
// 심을 수 있는 벌들. **고정된 한 벌은 지난 주일(s0)에 붙인다** — 기본으로 여는 것이
// '가장 최근 주일'이 아니라 '고정된 것'인지 보려면 둘이 달라야 한다(0055).
const GUIDE_ROWS = {
  one: [{ service_id: 's1', body: GUIDE }],
  pinned: [{ service_id: 's0', body: OLD_GUIDE, pinned: true }, { service_id: 's1', body: GUIDE }],
};

// mut은 심기 직전에 시드를 손보는 한 줄이다 — '동아리가 하나도 없는 화면' 같은
// 빈 상태를 보려면 시드에서 그 종류를 덜어내야 한다.
// guide는 순모임 가이드를 심는다(true = 최근 주일에 한 벌 · 'pinned' = 지난 주일 것이
// 고정). **끄면 빈 벌로 덮는다** — 앞 회차에서 심은 것이 남아 다음 화면에 끼면 그
// 검사가 무엇을 봤는지 알 수 없다.
const guideRows = (guide) => (guide === true ? GUIDE_ROWS.one : (GUIDE_ROWS[guide] || []));
const plant = (me, theme = 'light', mut = '', guide = false) => `(() => {
  const g = JSON.parse(${JSON.stringify(JSON.stringify(seed))});
  ${me ? `g.me = ${JSON.stringify(me)};` : ''}
  ${mut}
  localStorage.setItem('church_groups_v1', JSON.stringify(g));
  localStorage.setItem('church_worship_v1', JSON.stringify({
    people: g.people, groups: g.groups, group_members: g.group_members,
    services: g.services, attendance: g.attendance, service_notes: [],
  }));
  localStorage.setItem('church_sunguide_v1', JSON.stringify({
    sun_guides: ${JSON.stringify(guideRows(guide))},
  }));
  localStorage.setItem('theme', ${JSON.stringify(theme)});
})()`;

// 데스크톱 상단 '모임'으로 들어간다(회차 3 IA 재편 전의 임시 진입로 — docs/V2.md §3)
const GO = `(() => {
  const b = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === '모임')[0];
  if (!b) return false; b.click(); return true;
})()`;
const byText = (t) => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(t)})`;
const store = (table) => `JSON.parse(localStorage.getItem('church_groups_v1')).${table}`;
const tab = (label) => ev(`[...document.querySelectorAll('.groups-tab')].find(t => t.textContent.trim() === ${JSON.stringify(label)}).click()`);
const openClub = (name) => ev(`[...document.querySelectorAll('.club-card')].find(c => c.querySelector('.club-name').textContent.trim() === ${JSON.stringify(name)}).click()`);
const setText = (sel, v) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
// 토스트는 [data-toast]로 잡는다 — 동아리 목록의 dnd-kit이 role="status" 라이브 리전을 먼저 세운다
// ── 네이티브 select를 걷어낸 뒤의 조작 도구들 ───────────────────────────────
// 사람 고르기: 칸에 포커스를 주면 자동완성이 열리고, 뜬 줄을 누르면 골라진다.
// 줄 글자는 '아바타 첫 글자 + 이름'이라 endsWith로 본다('조' + '조해리').
// **목록은 body 포털이라 칸의 자손이 아니다**(§6-1) — document에서 찾는다. 한 번에
// 하나만 열리므로 클래스만으로 충분하다.
const sel = (tag, label) => `${tag}[aria-label=` + JSON.stringify(label) + ']';
const pickPerson = (label, name) => ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const input = document.querySelector(${JSON.stringify(sel('input', label))});
  if (!input) return 'no-input';
  // 이미 포커스가 있으면 focus()는 아무 이벤트도 내지 않는다 — 한 번 떼고 다시 준다
  input.blur(); await w(60); input.focus();
  await w(220);
  const o = [...document.querySelectorAll('.person-pick-option')]
    .find(b => b.textContent.trim().endsWith(${JSON.stringify(name)}));
  if (!o) return 'no-option';
  o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await w(150);
  return 'ok';
})()`, true);
// 그 피커가 지금 올려 두는 후보들 (읽고 나서 닫는다)
const pickOptions = (label) => ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const input = document.querySelector(${JSON.stringify(sel('input', label))});
  if (!input) return null;
  input.blur(); await w(60); input.focus();
  await w(220);
  // 줄은 '아바타 + 이름'이라 이름은 마지막 칸이다
  const names = [...document.querySelectorAll('.person-pick-option')]
    .map(b => b.lastElementChild.textContent.trim());
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await w(120);
  return names;
})()`, true);
// 짧은 목록 고르기(순 옮기기)
const pickMenu = (label, text) => ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const btn = document.querySelector(${JSON.stringify(sel('button', label))});
  if (!btn) return 'no-btn';
  btn.click();
  await w(220);
  const o = [...document.querySelectorAll('.menu-pick-option')]
    .find(b => b.textContent.trim() === ${JSON.stringify(text)});
  if (!o) return 'no-option';
  o.click();
  await w(150);
  return 'ok';
})()`, true);
// 연도 고르기(layout.jsx YearPicker — 팝오버는 body 포털이라 #root 밖에서 찾는다)
const pickYear = async (y) => {
  await ev(`document.querySelector('.sun-year button').click()`);
  await sleep(250);
  return ev(`(() => {
    const b = [...document.querySelectorAll('button')]
      .filter(x => !document.getElementById('root').contains(x))
      .find(x => x.textContent.trim() === ${JSON.stringify(`${y}년`)});
    if (!b) return 'no-year'; b.click(); return 'ok';
  })()`);
};
const yearOpen = async () => {
  await ev(`document.querySelector('.sun-year button').click()`);
  await sleep(250);
  const list = await ev(`[...document.querySelectorAll('button')]
    .filter(x => !document.getElementById('root').contains(x)).map(x => x.textContent.trim())`);
  await ev(`document.querySelector('.sun-year button').click()`);
  return list;
};
// 날짜 고르기(DatePicker — 업무 날짜와 같은 부품). 달을 옮겨 그 날을 누른다.
const pickDate = (root, y, m, d) => ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const box = document.querySelector(${JSON.stringify(root)})?.firstElementChild;
  if (!box) return 'no-picker';
  box.querySelector('button').click();
  await w(220);
  for (let i = 0; i < 40; i++) {
    const pop = box.children[1];
    if (!pop) return 'no-pop';
    const head = pop.querySelector('span').textContent.trim();
    if (head === ${JSON.stringify(`${y}년 ${m}월`)}) break;
    const [hy, hm] = head.replace(/[년월]/g, '').trim().split(/\\s+/).map(Number);
    const nav = pop.querySelectorAll('button');
    (hy * 12 + hm < ${y} * 12 + ${m} ? nav[1] : nav[0]).click();
    await w(110);
  }
  const pop = box.children[1];
  const day = [...pop.querySelectorAll('button')]
    .find(b => b.className.includes('w-8') && b.textContent.trim() === String(${d}));
  if (!day) return 'no-day';
  day.click();
  await w(160);
  return 'ok';
})()`, true);

// 열려 있는 팝오버가 **온전히 보이는가**(§6-1 body 포털). rect만 재면 덮인 것을 놓친다 —
// 네 변과 가운데를 실제로 눌렀을 때 그 점에 잡히는 요소가 팝오버 자신이어야 한다.
// absolute로 두면 `.dc-row`의 등장 애니메이션이 남긴 identity transform 때문에 카드마다
// 쌓임 맥락이 생겨서, 바로 아래 순 카드가 목록을 덮는다(사용자 지적 2026-09-02).
// 모서리 안쪽 3px 같은 점은 쓰지 않는다 — 목록의 `rounded-lg`가 12px이라 그 점은
// 둥근 모서리 **밖**이고, 가려지지 않았는데도 아래 것이 잡힌다(처음에 그렇게 짰다가
// 멀쩡한 화면에서 FAIL이 났다). 변 위의 점만 쓰고 모서리는 반지름만큼 비켜 간다.
const uncovered = (q) => ev(`(() => {
  const m = document.querySelector(${JSON.stringify(q)});
  if (!m) return 'no-menu';
  const r = m.getBoundingClientRect();
  if (r.width < 40 || r.height < 32) return 'too-small';
  const R = 14, E = 4;
  const pts = [
    [r.left + R, r.top + E], [r.right - R, r.top + E],
    [r.left + E, r.top + R], [r.right - E, r.top + R],
    [r.left + R, r.bottom - E], [r.right - R, r.bottom - E],
    [r.left + E, r.bottom - R], [r.right - E, r.bottom - R],
    [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
  ];
  const bad = [];
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) { bad.push('화면 밖'); continue; }
    const el = document.elementFromPoint(x, y);
    if (!m.contains(el)) bad.push((el?.className || el?.tagName || '?').split(' ')[0]);
  }
  return bad.length ? bad.join(',') : 'ok';
})()`);

// 아이콘이 든 버튼 전수 점검(사용자 지적 — "+와 글자가 안 맞는 곳이 있다").
// · 아이콘만 든 버튼: svg가 글자 baseline에 앉지 않고 상자 한가운데 서야 한다
// · 아이콘 + 글자: flex 가운데 정렬 + 글자 앞 공백이 남아 있지 않아야 한다
//   (공백이 남으면 gap 위에 3~4px이 더 붙어 버튼마다 사이가 제각각이 된다)
// 세로 판정은 svg의 rect가 아니라 **getBBox() 잉크 상자**로 잰다(§6-9-b).
const ICON_AUDIT = `(() => {
  const bad = [];
  for (const b of document.querySelectorAll('.groups-screen button')) {
    const svg = b.querySelector('svg');
    if (!svg) continue;
    // 날짜 픽커는 업무 화면과 함께 쓰는 부품이라 여기서 판정하지 않는다(DatePicker.jsx)
    if (b.closest('.club-meet-date')) continue;
    const cs = getComputedStyle(b);
    const bb = svg.getBBox(), m = svg.getScreenCTM(), r = b.getBoundingClientRect();
    if (!m || !r.height) continue;
    const inkMid = m.f + (bb.y + bb.height / 2) * m.d;
    const name = (b.getAttribute('aria-label') || b.textContent.trim() || b.className.split(' ')[0]);
    const dy = inkMid - (r.top + r.bottom) / 2;
    if (!/flex/.test(cs.display)) { bad.push(name + ' display=' + cs.display); continue; }
    if (Math.abs(dy) > 1.2) { bad.push(name + ' dy=' + dy.toFixed(2)); continue; }
    if (b.textContent.trim()) {
      if (cs.alignItems !== 'center') { bad.push(name + ' align=' + cs.alignItems); continue; }
      const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (n.textContent.trim() && /^\\s/.test(n.textContent)) { bad.push(name + ' 글자 앞 공백'); break; }
      }
    }
  }
  return bad;
})()`;
// 들어가서 **화면이 실제로 설 때까지 기다린다.** 한 번 누르고 정해진 시간만 쉬면,
// 첫 페인트가 늦은 판(모바일 폭 전환 직후·다른 에이전트가 저장해서 HMR이 도는 중)에서
// 진입로를 못 눌러 뒤따르는 검사가 통째로 넘어졌다 — 실제로 두 번 그랬다.
const enter = async (me, theme, mut, guide) => {
  await ev(plant(me, theme, mut, guide));
  await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1200);
  for (let i = 0; i < 30; i++) {
    await ev(GO);
    await sleep(i ? 300 : 1400);
    if (await ev(`!!document.querySelector('.groups-screen')`)) return;
  }
  throw new Error('모임 화면이 열리지 않았어요');
};
// 지금 서 있는 탭 줄 — 자격에 따라 '순 편성'이 붙거나 안 붙는다
const TABS = `[...document.querySelectorAll('.groups-tab')].map(t => t.textContent.trim()).join(',')`;
// 지금 떠 있는 토스트 한 줄(Toast.jsx는 role=status 하나만 세운다)
const toast = () => ev(`(document.querySelector('[data-toast]') || {}).innerText || ''`);
// 순모임 가이드가 **내 순 카드와 같은 열**에 서는가(사용자 지적 2026-09-03 —
// "중앙으로 딱 정렬돼서 보이게"). 좌우 끝이 카드와 같고, 종이는 그 안에서 가운데다.
const guideBox = () => ev(`(() => {
  const card = document.querySelector('.mysun-card');
  const sec = document.querySelector('.sun-guide');
  const page = document.querySelector('.sun-guide-page');
  if (!card || !sec) return { err: 'no-el' };
  const c = card.getBoundingClientRect(), s = sec.getBoundingClientRect();
  const out = { dl: Math.round(s.left - c.left), dr: Math.round(s.right - c.right),
    below: Math.round(s.top - c.bottom) };
  if (page) {
    const p = page.getBoundingClientRect();
    out.pad = Math.round((p.left - s.left) - (s.right - p.right));
  }
  return out;
})()`);
// 한 줄인가 — 세로 가운데가 같은 것끼리 묶어 줄 수를 센다(상자 높이가 저마다 다르다)
const rowsOf = (box, sels) => ev(`(() => {
  const root = document.querySelector(${JSON.stringify(box)});
  if (!root) return { err: 'no-box' };
  const parts = ${JSON.stringify(sels)}.flatMap(q => [...root.querySelectorAll(q)]);
  if (parts.length < 3) return { err: '부품 ' + parts.length + '개' };
  const mids = parts.map(e => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; });
  return { rows: mids.reduce((a, y) => (a.some(v => Math.abs(v - y) < 6) ? a : [...a, y]), []).length,
    parts: parts.length,
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`);
// 모임 생성기가 한 줄인가 — 세로 가운데가 같은 것끼리 묶어 줄 수를 센다. 상자 높이가
// 저마다 달라(날짜 버튼 28px · 칸 30px) top으로 재면 한 줄도 여러 줄로 잡힌다.
const meetRows = () => ev(`(() => {
  const box = document.querySelector('.club-meet-new');
  if (!box) return { err: 'no-form' };
  // 날짜 픽커의 팝업 속 버튼은 세지 않는다(닫혀 있으면 트리거 하나뿐이다)
  const parts = [...box.querySelectorAll('input, button')].filter(e => !e.closest('[data-datepicker]'));
  if (parts.length < 4) return { err: '부품 ' + parts.length + '개' };
  const mids = parts.map(p => { const r = p.getBoundingClientRect(); return (r.top + r.bottom) / 2; });
  const rows = mids.reduce((acc, y) => (acc.some(v => Math.abs(v - y) < 6) ? acc : [...acc, y]), []).length;
  return { rows, parts: parts.length,
    date: box.querySelector('.club-meet-date button').textContent.trim(),
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`);
// 오늘(한국 시간)의 DatePicker 라벨 앞머리 — '2026. 9. 2. (수)'의 '2026. 9. 2.'
const TODAY_LABEL = (() => {
  const [y, m, d] = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).split('-').map(Number);
  return `${y}. ${m}. ${d}.`;
})();

// ── 팝오버가 첫 프레임부터 제자리인가 (사용자 지적 2026-09-02) ───────────────
// "피커가 처음 열릴 때 위에서 뚝 떨어진다." 원인은 위치를 열고 나서 잡은 것이다 —
// 첫 렌더가 {0,0}에 놓였다가 제자리로 옮겨지는데, 그 이동이 **transition을 탔다**:
// `duration-150`은 `--tw-duration`(등장 애니메이션 길이)만이 아니라
// `transition-duration`도 같이 놓고, CSS에서 `transition-property`의 초깃값은 `all`이라
// 위치까지 전이 대상이 된다(실측 2 → 33 → 104 → 305 → 307px).
// 그래서 두 가지를 본다: 열자마자의 rAF 프레임이 자리 잡은 뒤와 같은가, 그리고
// 위치가 전이 대상이 아닌가(우리 목록만 — 확인 팝오버·연도 목록은 남의 파일이다).
//
// **자리는 getBoundingClientRect가 아니라 계산된 `top`으로 잰다.** 등장 확대
// (zoom-in-95)는 transform이라 상자의 rect를 최대 5px 흔든다(높이 208px의 5%의 절반) —
// 그건 의도한 등장이고 우리가 찾는 '떨어짐'이 아니다. 반대로 전이 중인 속성의
// 계산값은 **지금 보간된 값**이라, transition을 타는 top은 여기서 그대로 드러난다.
//
// 프레임만으로는 부족하다 — 위치를 열고 나서 잡아도 리액트가 그리기 전에 한 번 더
// 그려서 rAF에는 이미 제자리로 보인다. 그러니 **붙는 순간의 자리가 곧 최종 자리인가**를
// 같이 본다: 목록이 body에 붙은 뒤에 top을 다시 쓰면 그 사이에 {0,0}이 있었다는 뜻이고,
// 전이 클래스 하나가 다시 붙는 순간 '위에서 떨어지는' 모양이 그대로 되살아난다.
// (left는 보지 않는다 — MenuPick의 폭은 내용이 정해서 그린 뒤에야 알 수 있다.)
//
// **둘을 한 번의 열기에서 잰다.** 한 번 열었던 피커는 자리를 기억하므로 두 번째
// 열기로 재면 고치기 전에도 통과한다.
const DRIFT_OK = 1;
const drift = (openExpr, findExpr, cls, n = 12) => ev(`(async () => {
  const find = () => (${findExpr});
  const hit = (x) => x && x.nodeType === 1 && typeof x.className === 'string'
    && x.className.includes(${JSON.stringify(cls || '')});
  const recs = [];
  const obs = new MutationObserver(rs => recs.push(...rs));
  obs.observe(document.body, { childList: true, subtree: true,
    attributes: true, attributeFilter: ['style'], attributeOldValue: true });
  ${openExpr};
  const tops = [];
  for (let i = 0; i < ${n}; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const m = find();
    tops.push(m ? parseFloat(getComputedStyle(m).top) : null);
  }
  obs.disconnect();
  const seen = tops.filter(t => t !== null && !Number.isNaN(t));
  if (!seen.length) return { err: '안 열림' };
  const settled = seen[seen.length - 1];
  const m = find();
  return {
    first: Math.round(seen[0]), settled: Math.round(settled),
    gap: Math.round(Math.max(...seen.map(t => Math.abs(t - settled)))),
    trans: m ? getComputedStyle(m).transitionDuration : '',
    born: recs.some(r => r.type === 'childList' && [...r.addedNodes].some(hit)),
    moved: recs.filter(r => r.type === 'attributes' && hit(r.target)).map(r => {
      const before = (String(r.oldValue || '').match(/top:\\s*([^;]+)/) || [, ''])[1].trim();
      const after = String(r.target.style.top || '').trim();
      return before === after ? null : (before || '없음') + ' → ' + after;
    }).filter(Boolean),
  };
})()`, true);
// 클래스가 없는 body 포털 팝오버(확인 팝오버·연도 목록) — 포털은 body의 바로 아래 자식이다
const POPOVER = `[...document.body.children].find(el => el.tagName === 'DIV'
  && typeof el.className === 'string' && el.className.includes('z-[90]'))`;
const shut = async () => {
  await ev(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();`);
  await sleep(320);
};
// 우리 목록(PersonPick·MenuPick)은 '위치가 전이 대상이 아니다'와 '붙는 순간이 곧
// 최종 자리다'까지 못 박는다. 확인 팝오버·연도 목록은 남의 파일이라 눈에 보이는 것만.
const noJump = async (name, openExpr, findExpr, ours = true) => {
  const cls = ours ? (findExpr.includes('menu-pick') ? 'menu-pick-menu' : 'person-pick-menu') : '';
  const d = await drift(openExpr, findExpr, cls);
  check(`${name} — 첫 프레임부터 제자리`,
    !d.err && d.gap <= DRIFT_OK && (!ours || d.trans === '0s'), JSON.stringify(d));
  if (ours) {
    check(`${name} — 붙는 순간이 곧 최종 자리(열기 전에 place)`,
      d.born === true && d.moved.length === 0, JSON.stringify({ born: d.born, moved: d.moved }));
  }
  await shut();
};

// ── 빈 자리가 마크와 함께 남는 공간의 가운데인가(§8) ────────────────────────
// 마크(SVG 선 그리기)가 있고, 안의 내용이 그 구역의 세로·가로 정가운데에 서고,
// 구역이 남는 공간을 실제로 쓰는가. 위쪽에 붙어 있으면 아래가 통째로 비어 보인다.
const centered = (sel) => ev(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return { err: 'no-el' };
  const kids = [...e.children];
  if (!kids.length) return { err: 'no-kids' };
  const r = e.getBoundingClientRect();
  const b = kids.map(k => k.getBoundingClientRect());
  const top = Math.min(...b.map(x => x.top)), bottom = Math.max(...b.map(x => x.bottom));
  const left = Math.min(...b.map(x => x.left)), right = Math.max(...b.map(x => x.right));
  return {
    // 빈 자리의 그림은 **SVG 선 그리기 마크**다(§8) — 캐릭터 컷을 잠깐 썼다가
    // 되돌렸다(사용자 결정 2026-09-03 "홈 제외하고는 캐릭터를 넣지 말라").
    mark: !!e.querySelector('svg'),
    img: !!e.querySelector('img'),
    h: Math.round(r.height),
    dy: Math.round((top + bottom) / 2 - (r.top + r.bottom) / 2),
    dx: Math.round((left + right) / 2 - (r.left + r.right) / 2),
    text: e.innerText.replace(/\\n+/g, ' | ').trim(),
  };
})()`);
const isCentered = (name, c, minH = 180) => check(`${name} — 마크와 함께 남는 공간의 가운데`,
  !c.err && c.mark === true && Math.abs(c.dy) <= 2 && Math.abs(c.dx) <= 2 && c.h >= minH,
  JSON.stringify(c));

await send('Page.enable'); await send('Runtime.enable');
// 헤드리스는 창에 포커스가 없어서 focus()·blur()가 이벤트를 안 낸다(activeElement만 바뀐다).
// 순 이름은 칸을 떠날 때 저장하므로 이 줄이 없으면 그 검사가 헛으로 실패한다.
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');

// ── 0) 순수 로직 — 화면 없이도 맞아야 하는 것들 ─────────────────────────────
const pure = await ev(`(async () => {
  const m = await import('/src/services/groups.js');
  const perms = (o) => { const p = m.groupPerms(o); return [p.canManageSun, p.canCreateClub]; };
  const led = { isMaster: false, ledClubIds: ['gc1'] };
  const sunOnly = [{ id: 'g', leader_person_id: 'b' }];
  return {
    plain: perms({}),
    master: perms({ isMaster: true }),
    admin: perms({ isAdmin: true }),
    pastor: perms({ myPerson: { is_pastor: true } }),
    lead: perms({ myRoles: ['lead_sunjang'] }),
    treasurer: perms({ myRoles: ['treasurer'] }),
    // 멤버 추가·제거(0045 group_members_write) — 관리자(마스터 포함) 또는 **그** 동아리장.
    // 자격 한 벌은 groupPerms가 만든다(마스터는 거기서 isAdmin이 켜진다 — 0028).
    club: [m.canManageClub(led, 'gc1'), m.canManageClub(led, 'gc2'),
      m.canManageClub(m.groupPerms({ isMaster: true }), 'gc2'),
      m.canManageClub(m.groupPerms({ isAdmin: true }), 'gc2'),
      m.canManageClub(m.groupPerms({}), 'gc2')],
    // 이름·설명 고치기(0039 groups_update) — 관리자 또는 **그** 동아리장. 0045부터
    // 명단 자격(canManageClub)과 같은 경계다.
    editClub: (() => {
      const c1 = { id: 'gc1', leader_person_id: 'p6' };
      const c2 = { id: 'gc2', leader_person_id: 'p3' };
      const leader = m.groupPerms({ myPerson: { id: 'p6' } });
      const member = m.groupPerms({ myPerson: { id: 'p9' } });
      const admin = m.groupPerms({ isAdmin: true, myPerson: { id: 'p9' } });
      // 자격 한 벌은 캐시(JSON)를 거치므로 메서드가 아니라 **바깥 함수**로 판정한다
      return [m.canEditClub(leader, c1), m.canEditClub(leader, c2),
        m.canEditClub(member, c1), m.canEditClub(admin, c2)];
    })(),
    // 리더가 맨 앞, 나머지는 **가나다순**(들어온 차례가 아니다) · 겹치는 사람은 하나로
    people: m.groupPeople({
      people: [{ id: 'a', name: '가' }, { id: 'b', name: '나' }, { id: 'c', name: '다' }],
      group: { id: 'g', leader_person_id: 'b' },
      members: [{ group_id: 'g', person_id: 'c' }, { group_id: 'g', person_id: 'a' }, { group_id: 'g', person_id: 'b' }],
    }).map(p => p.name),
    // 한글은 localeCompare('ko')라야 ㄱㄴㄷ으로 선다(코드포인트 정렬이 아니다)
    sorted: m.groupPeople({
      people: [{ id: 'a', name: '천진영' }, { id: 'b', name: '김승찬' }, { id: 'c', name: '양민혁' }, { id: 'd', name: '노준석' }],
      group: { id: 'g', leader_person_id: 'a' },
      members: [{ group_id: 'g', person_id: 'c' }, { group_id: 'g', person_id: 'b' }, { group_id: 'g', person_id: 'd' }],
    }).map(p => p.name),
    sunLeader: m.mySun({ id: 'b' }, sunOnly, [])?.id || null,
    sunMember: m.mySun({ id: 'a' }, sunOnly, [{ group_id: 'g', person_id: 'a' }])?.id || null,
    sunNone: m.mySun({ id: 'z' }, sunOnly, []),
    latest: m.latestSunday([
      { id: 'a', kind: 'sunday', status: 'published', service_date: '2026-08-23' },
      { id: 'b', kind: 'sunday', status: 'published', service_date: '2026-08-30' },
      { id: 'c', kind: '금요 열정 예배', status: 'published', service_date: '2026-09-04' },
      { id: 'd', kind: 'sunday', status: 'draft', service_date: '2026-09-06' },
    ])?.id || null,
    // 출석을 셀 기준 예배(사용자 결정 2026-09-08) — **오늘까지 온 주일** 가운데
    // **출석이 실제로 들어온** 가장 최근 한 건. 목요일에 이번 주일 주보를 발행해 두어도
    // 그 예배의 0/N을 세지 않는다. counts는 worship.fetchAttendanceCounts()의 모양이다.
    att: (() => {
      const svc = [
        { id: 'a', kind: 'sunday', status: 'published', service_date: '2026-08-30' },
        { id: 'b', kind: 'sunday', status: 'published', service_date: '2026-09-06' },
        { id: 'c', kind: 'sunday', status: 'published', service_date: '2026-09-13' },
        { id: 'd', kind: 'sunday', status: 'draft', service_date: '2026-09-06' },
        { id: 'e', kind: '금요 열정 예배', status: 'published', service_date: '2026-09-11' },
        { id: 'f', kind: 'sunday', status: 'published', service_date: '' },
      ];
      const at = (counts, today) => m.attendanceSunday(svc, counts, today)?.id || null;
      return {
        future: at({ a: 3, c: 5 }, '2026-09-10'),        // 발행만 된 앞으로의 주일은 세지 않는다
        todayEmpty: at({ b: 4 }, '2026-09-13'),          // 주일 당일, 아직 출석 0 → 앞 주일
        todayFilled: at({ b: 4, c: 1 }, '2026-09-13'),   // 출석이 들어오면 그 순간 오늘 것
        none: at({}, '2026-09-13'),                      // 아무 데도 없으면 null(부르는 쪽이 지난 주일로)
        skip: at({ d: 9, e: 9, f: 9 }, '2026-09-13'),    // 작성 중·다른 예배·날짜 없는 행
      };
    })(),
    present: m.presentCount([{ id: 'a' }, { id: 'b' }, { id: 'c' }], new Set(['a', 'c'])),
    on: m.toggleAttendance(['a'], 'b'),
    off: m.toggleAttendance(['a', 'b'], 'a'),
    years: m.yearOptions([{ year: 2024 }, { year: 2026 }, { year: null }], 2026),
    // 동아리 순서 — position 순, 값이 없는 것은 원래 차례를 지키며 뒤로
    order: m.sortClubs([
      { id: 'c', position: 3 }, { id: 'x', position: null }, { id: 'a', position: 1 },
      { id: 'y' }, { id: 'b', position: 2 },
    ]).map(g => g.id),
    // 순 편성 제외(0040) — 순 후보에서만 빠지고 동아리는 그대로다
    exempt: m.sunCandidates([{ id: 'a' }, { id: 'b', sun_exempt: true }]).map(p => p.id),
    exemptSun: m.notInGroup([{ id: 'a' }, { id: 'b', sun_exempt: true }], { id: 'g', type: 'sun' }, []).map(p => p.id),
    exemptClub: m.notInGroup([{ id: 'a' }, { id: 'b', sun_exempt: true }], { id: 'gc', type: 'club' }, []).map(p => p.id),
    // 순장 지정 네 갈래(사용자 지시 2026-09-03). 꼬순: p1(순장)·p2, TT순: p6(순장)·p4
    leader: (() => {
      const people = [{ id: 'p1', name: '김윤주' }, { id: 'p2', name: '천진영' },
        { id: 'p4', name: '배현민' }, { id: 'p6', name: '노준석' }, { id: 'p7', name: '조해리' },
        { id: 'p9', name: '신효진', sun_exempt: true }];
      const suns = [{ id: 'g1', name: '꼬순', leader_person_id: 'p1' },
        { id: 'g2', name: 'TT순', leader_person_id: 'p6' }];
      const members = [{ group_id: 'g1', person_id: 'p1' }, { group_id: 'g1', person_id: 'p2' },
        { group_id: 'g2', person_id: 'p6' }, { group_id: 'g2', person_id: 'p4' }];
      const plan = (personId) => m.leaderPlan({ group: suns[0], personId, people, suns, members });
      const one = (r) => (r.ok ? 'ok:' + r.addMember : r.why);
      return {
        otherLeader: one(plan('p6')), hereMember: one(plan('p2')),
        elsewhere: one(plan('p4')), free: one(plan('p7')),
        exempt: one(plan('p9')), clear: one(plan('')),
      };
    })(),
    // 같은 이름(0041) — 순은 같은 해 안에서만, 동아리는 전체에서 유일하다
    dupName: (() => {
      const groups = [
        { id: 'g1', type: 'sun', name: '꼬순', year: 2026 },
        { id: 'g0', type: 'sun', name: '지난 순', year: 2025 },
        { id: 'gx', type: 'sun', name: '없어진 순', year: 2026, removed_at: '2026-01-01' },
        { id: 'gc1', type: 'club', name: '통통', year: null },
      ];
      const d = (o) => m.duplicateName({ groups, ...o }) || null;
      return {
        sameYear: d({ type: 'sun', name: '꼬순', year: 2026 }),
        otherYear: d({ type: 'sun', name: '꼬순', year: 2027 }),
        self: d({ type: 'sun', name: '꼬순', year: 2026, exceptId: 'g1' }),
        removed: d({ type: 'sun', name: '없어진 순', year: 2026 }),
        club: d({ type: 'club', name: '통통' }),
        clubSelf: d({ type: 'club', name: '통통', exceptId: 'gc1' }),
        clubNew: d({ type: 'club', name: '달리기' }),
        trimmed: d({ type: 'club', name: '  통통  ' }),
      };
    })(),
    // 유니크 위반만 부르는 쪽의 이유로 갈아 끼운다 — 다른 오류는 그대로 둔다
    dup: [
      m.dupReason({ code: '23505', message: 'dup' }, '이미 신청해 두었어요').human || '',
      m.dupReason({ code: '23502', message: 'null' }, '이미 신청해 두었어요').human || '없음',
      m.dupReason({ code: '23505', message: 'dup' }, '').code || '',
    ],
    // 이미 든 사람(리더 포함)은 '멤버 추가' 후보가 아니다
    left: m.notInGroup(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      { id: 'g', leader_person_id: 'b' },
      [{ group_id: 'g', person_id: 'a' }, { group_id: 'h', person_id: 'd' }],
    ).map(p => p.id),
  };
})()`, true);
check('일반 멤버는 순 편성도 동아리 개설도 못 한다', JSON.stringify(pure.plain) === '[false,false]', JSON.stringify(pure.plain));
check('마스터는 순 편성 + 동아리 개설', JSON.stringify(pure.master) === '[true,true]', JSON.stringify(pure.master));
check('관리자는 순 편성만(동아리 개설은 마스터만)', JSON.stringify(pure.admin) === '[true,false]', JSON.stringify(pure.admin));
// 0039에서 교역자가 빠졌다 — 사용자 결정 2026-09-02 "마스터/관리자/리더순장만 우선"
// 0045가 교역자를 되돌렸다(0035에 있었고 0039가 뺐다 — 사용자 결정 2026-09-05)
check('교역자는 순 편성만(동아리 개설은 아니다)', JSON.stringify(pure.pastor) === '[true,false]', JSON.stringify(pure.pastor));
check('리더순장은 순 편성만', JSON.stringify(pure.lead) === '[true,false]', JSON.stringify(pure.lead));
check('총무·리더팀장 줄만으로는 순 편성 자격이 아니다(0043)', JSON.stringify(pure.treasurer) === '[false,false]', JSON.stringify(pure.treasurer));
// 0045 — 예전에는 마스터 + 그 리더라, 관리자가 이름·설명은 고치면서 사람은 못 넣었다
check('동아리 멤버 추가·제거는 그 동아리장 + 관리자(마스터 포함)',
  JSON.stringify(pure.club) === '[true,false,true,true,false]', JSON.stringify(pure.club));
check('동아리 이름·설명은 그 동아리장 또는 관리자만 고친다',
  JSON.stringify(pure.editClub) === '[true,false,false,true]', JSON.stringify(pure.editClub));
check('리더가 맨 앞에 서고 겹치는 사람은 하나로, 나머지는 가나다순',
  JSON.stringify(pure.people) === '["나","가","다"]', JSON.stringify(pure.people));
check('사람 목록은 리더 먼저 · 나머지 ㄱㄴㄷ(localeCompare ko)',
  JSON.stringify(pure.sorted) === '["천진영","김승찬","노준석","양민혁"]', JSON.stringify(pure.sorted));
check('내 순 — 순장도 순원도 자기 순을 찾는다', pure.sunLeader === 'g' && pure.sunMember === 'g', `${pure.sunLeader}/${pure.sunMember}`);
check('어느 순에도 없으면 내 순이 없다', pure.sunNone === null, String(pure.sunNone));
// latestSunday는 이제 **순모임 가이드 몫**이다 — 앞으로 올 주일까지 센다(그 주 예배로
// 무엇을 나눌지는 예배 전에 준비한다). 출석 줄은 아래 attendanceSunday가 고른다.
check('가이드 기준은 발행된 주일 예배 중 가장 최근 한 건', pure.latest === 'b', String(pure.latest));
check('출석 기준 — 발행만 된 앞으로의 주일은 세지 않는다', pure.att.future === 'a', JSON.stringify(pure.att));
check('출석 기준 — 주일 당일이라도 출석이 들어오기 전에는 앞 주일이다',
  pure.att.todayEmpty === 'b', JSON.stringify(pure.att));
check('출석 기준 — 출석이 입력되면 그 주일로 바뀐다', pure.att.todayFilled === 'c', JSON.stringify(pure.att));
check('출석 기준 — 출석이 아무 주일에도 없으면 null(부르는 쪽이 지난 주일로 떨어진다)',
  pure.att.none === null && pure.att.skip === null, JSON.stringify(pure.att));
check('출석 셈은 그 순 사람만 센다', pure.present === 2, String(pure.present));
check('모임 출석은 눌러서 켜고 끈다',
  JSON.stringify(pure.on) === '["a","b"]' && JSON.stringify(pure.off) === '["b"]', `${JSON.stringify(pure.on)}/${JSON.stringify(pure.off)}`);
check('편성 연도 후보 — 편성이 있는 해 + 올해 + 다음 해', JSON.stringify(pure.years) === '[2027,2026,2024]', JSON.stringify(pure.years));
check('동아리는 손으로 정한 순서대로, 값이 없는 것은 차례를 지키며 뒤로',
  JSON.stringify(pure.order) === '["a","b","c","x","y"]', JSON.stringify(pure.order));
check('멤버 추가 후보에서 이미 든 사람과 리더는 빠진다',
  JSON.stringify(pure.left) === '["c","d"]', JSON.stringify(pure.left));
// 0041 — 순은 같은 해 안에서만 유일하다(26년 오순도순과 27년 오순도순은 공존)
check('같은 해 같은 이름의 순은 막고, 다른 해는 통과한다',
  pure.dupName.sameYear === '2026년에 같은 이름의 순이 이미 있어요'
  && pure.dupName.otherYear === null && pure.dupName.self === null
  && pure.dupName.removed === null, JSON.stringify(pure.dupName));
check('동아리는 해가 없어 전체에서 유일하다',
  pure.dupName.club === '같은 이름의 동아리가 이미 있어요' && pure.dupName.clubSelf === null
  && pure.dupName.clubNew === null && pure.dupName.trimmed === '같은 이름의 동아리가 이미 있어요',
  JSON.stringify(pure.dupName));
check("유니크 위반에만 '무엇이 이미 있는지'를 넣는다",
  JSON.stringify(pure.dup) === '["이미 신청해 두었어요","없음","23505"]', JSON.stringify(pure.dup));
// 0040 — 부장님·전도사님은 순 후보에서만 빠진다(동아리 가입은 그대로)
check('순 편성 제외자는 순 후보에서 빠지고 동아리 후보에는 남는다',
  JSON.stringify(pure.exempt) === '["a"]' && JSON.stringify(pure.exemptSun) === '["a"]'
  && JSON.stringify(pure.exemptClub) === '["a","b"]',
  `${JSON.stringify(pure.exemptSun)} / ${JSON.stringify(pure.exemptClub)}`);
// 순장 지정 네 갈래 — 문구까지 못 박는다(사용자가 정한 정책 2026-09-03)
check('① 이미 다른 순의 순장이면 세우지 않고 어느 순인지 말한다',
  pure.leader.otherLeader === '노준석님은 이미 TT순의 순장이에요', pure.leader.otherLeader);
check('② 이 순의 순원이면 그대로 세운다(구성원 추가는 건너뛴다)',
  pure.leader.hereMember === 'ok:false', pure.leader.hereMember);
check('③ 다른 순의 순원이면 먼저 옮기라고 말한다',
  pure.leader.elsewhere === '배현민님은 TT순 순원이라, 먼저 이 순으로 순원 추가(이동)를 해 주세요',
  pure.leader.elsewhere);
check('④ 아무 순에도 없으면 세우고 구성원으로 넣는다',
  pure.leader.free === 'ok:true', pure.leader.free);
check('순 편성 제외자는 순장으로도 세우지 않는다',
  pure.leader.exempt === '신효진님은 순 편성 대상이 아니에요', pure.leader.exempt);
check('순장 비우기는 언제나 되고 구성원은 건드리지 않는다',
  pure.leader.clear === 'ok:false', pure.leader.clear);

// ── 1) 내 순 (일반 순원 · 꼬순) ─────────────────────────────────────────────
// 여기만 enter()를 안 쓴다 — '상단에 진입로가 있는가'를 그 자리에서 재기 때문이다.
// 다만 **화면이 설 때까지 다시 누르는 것은 같다**: 정해진 시간만 쉬면 첫 페인트가 늦은
// 판(다른 에이전트가 저장해서 HMR이 도는 중)에서 진입로를 못 눌러 뒤따르는 검사가
// 통째로 넘어진다 — 실측 1.9초까지 늦은 적이 있다(enter() 머리 주석과 같은 이유).
await ev(plant({ personId: 'p1', isMaster: false, roles: [] }));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1200);
let entryFound = false;
for (let i = 0; i < 20; i++) {
  if (await ev(GO)) entryFound = true;
  await sleep(i ? 300 : 1400);
  if (await ev(`!!document.querySelector('.groups-screen')`)) break;
}
check('데스크톱 상단에 모임 진입로가 있다', entryFound === true);

const mine = await ev(`(() => ({
  open: !!document.querySelector('.groups-screen'),
  tabs: [...document.querySelectorAll('.groups-tab')].map(t => t.textContent.trim()),
  name: document.querySelector('.mysun-name')?.textContent.trim() || '',
  leader: document.querySelector('.mysun-leader')?.textContent.trim() || '',
  members: [...document.querySelectorAll('.mysun-member')].map(m => m.textContent.trim()),
  att: document.querySelector('.mysun-att')?.textContent.trim() || '',
  notes: [...document.querySelectorAll('.mysun-note')].map(n => n.innerText.replace(/\\n+/g, ' | ')),
  hidden: document.body.innerText.includes('비공개라 모임 화면에'),
}))()`);
check('모임 화면이 열린다', mine.open === true);
check('일반 순원에게는 탭이 둘', JSON.stringify(mine.tabs) === '["내 순","동아리"]', JSON.stringify(mine.tabs));
check('내 순 카드에 순 이름과 순장', mine.name === '꼬순' && mine.leader === '순장 김윤주', `${mine.name}/${mine.leader}`);
// 아바타가 글자 원이라 텍스트 맨 앞에 첫 글자가 한 번 더 들어간다('김' + '김윤주')
// 순장(김윤주) 다음은 **가나다순**이다 — 편성에 들어온 차례(천진영 → 김승찬)가 아니다
check('구성원은 순장이 맨 앞이고 순장 표시가 붙는다',
  mine.members.length === 3 && mine.members[0].includes('김윤주') && mine.members[0].includes('순장')
  && mine.members[1].includes('김승찬'), JSON.stringify(mine.members));
check('순 구성원은 순장 다음이 ㄱㄴㄷ',
  mine.members[1].includes('김승찬') && mine.members[2].includes('천진영'), JSON.stringify(mine.members));
// 날짜 표기는 예배 줄기의 formatServiceDate 한 벌이 정한다(해가 붙기도 한다) —
// 그 모양까지 여기서 못 박으면 그쪽이 바뀔 때마다 이 검사가 헛으로 넘어진다.
check('최근 주일 예배 출석 n/m',
  mine.att.includes(dateLabel(SUN_LAST)) && mine.att.endsWith('예배 출석 2/3'), mine.att);
// 그 예배에 온 순원에게는 초록 '출석'이 하나 더 붙는다(사용자 요청 2026-09-08).
// s1에 온 사람은 p1(김윤주)·p2(천진영)이고 p3(김승찬)은 오지 않았다.
const attTag = await ev(`(() => {
  const rows = [...document.querySelectorAll('.mysun-member')]
    .map(m => ({ t: m.textContent.trim(), on: !!m.querySelector('.person-tag-mark') }));
  const lead = [...document.querySelectorAll('.mysun-member')].find(m => m.textContent.includes('김윤주'));
  const leadBadge = [...(lead?.querySelectorAll('span') || [])].find(s => s.textContent.trim() === '순장');
  const attBadge = lead?.querySelector('.person-tag-mark');
  const kids = [...(lead?.children || [])];
  const box = (e) => e.getBoundingClientRect();
  return {
    marks: rows.filter(r => r.on).map(r => r.t),
    plain: rows.filter(r => !r.on).map(r => r.t),
    label: attBadge?.textContent.trim() || '',
    // 자리('순장')가 먼저, 그날의 사실('출석')이 뒤 · 색은 다르고 크기는 같다
    order: !!leadBadge && !!attBadge && kids.indexOf(leadBadge) < kids.indexOf(attBadge),
    sameColor: !!leadBadge && !!attBadge
      && getComputedStyle(leadBadge).backgroundColor === getComputedStyle(attBadge).backgroundColor,
    dh: (leadBadge && attBadge) ? Math.abs(box(leadBadge).height - box(attBadge).height) : 99,
  };
})()`);
check('그 예배에 온 순원에게만 출석 표시가 붙는다',
  attTag.marks.length === 2 && attTag.label === '출석'
  && attTag.marks.every(t => t.includes('김윤주') || t.includes('천진영'))
  && attTag.plain.length === 1 && attTag.plain[0].includes('김승찬'), JSON.stringify(attTag));
check('출석 표시는 순장 표시 뒤에 · 다른 색 · 같은 크기',
  attTag.order === true && attTag.sameColor === false && attTag.dh <= 1, JSON.stringify(attTag));
// **한 주보씩 본다**(사용자 요구 2026-09-09 — "주보별로 볼 수 있게끔"). 기본은 가장
// 최근 주보이고, 머리줄 고르개로 바꾼다. 전부 이어 세우면 종이가 사람 수만큼 길어진다.
// 시드는 s1(최근)에 천진영의 노트, s0(지난주)에 내 노트를 두었다.
check('내 순에 공유된 예배 노트가 뜬다(기본은 최근 주보 한 건)',
  mine.notes.length === 1 && mine.notes[0].includes('천진영') && mine.notes[0].includes('기쁨은 상황이 아니라'), JSON.stringify(mine.notes));
// **공유하지 않은 노트는 내 것이어도 오지 않는다**(사용자 지시 2026-09-07 — 예전에는
// 잠금 표시를 달고 이 목록에 섰다). 이 구역의 이름이 '내 순에 공유된 예배 노트'라서,
// 공유하지 않은 글이 서면 이름과 내용이 어긋난다.
// 내가 공유한 줄에는 토글이 남는다 — **공유 칸은 말씀·예배와 같은 한 부품이고**
// (components/ShareToggle.jsx · 회차 8) 두 쪽이 나란히 서며 **라벨은 상태와 무관하게
// 고정**이다(사용자 결정 2026-09-05). 이 화면에는 노트 편집기가 없으므로 조작은 이
// 줄에 남는다(말씀 나눔 피드에서는 편집기 것만 남기고 뺐다).
// 지난 주보로 바꿔야 내 노트가 선다 — 고르개가 그 일을 한다.
const notePick = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const t = document.querySelector('.mysun-note-pick .menu-pick');
  if (!t) return { err: 'no-pick' };
  const label = t.textContent.trim();
  t.click(); await w(350);
  const opts = [...document.querySelectorAll('.menu-pick-option')].map(b => b.textContent.trim());
  const old = [...document.querySelectorAll('.menu-pick-option')].find(b => !b.textContent.includes(label.split(' ')[0]))
    || [...document.querySelectorAll('.menu-pick-option')][1];
  old?.click(); await w(500);
  return { label, opts, after: [...document.querySelectorAll('.mysun-note')].map(n => n.innerText.replace(/\\n+/g, ' | ')) };
})()`, true);
// 칩 글자는 `26.09.06 예배`다(사용자 결정 2026-09-09) — 버튼 무리 안에 서므로 짧아야 한다
check('노트 목록에도 주보 고르개가 서고 짧은 글자를 쓴다',
  !notePick.err && /^\d{2}\.\d{2}\.\d{2} 예배$/.test(notePick.label) && notePick.opts.length === 2,
  JSON.stringify({ label: notePick.label, opts: notePick.opts }));
check('지난 주보로 바꾸면 그 주보의 노트가 선다',
  notePick.after.length === 1 && notePick.after[0].includes('지난 주일에 나눈 노트'),
  JSON.stringify(notePick.after));

const myNote = await ev(`(() => {
  const rows = [...document.querySelectorAll('.mysun-note')];
  const mineRow = rows.find(r => r.innerText.includes('지난 주일에 나눈 노트'));
  const segs = [...(mineRow?.querySelectorAll('.mysun-note-share button[aria-pressed]') || [])];
  return { rows: rows.length,
    priv: document.body.innerText.includes('아직 나만 보는 묵상'),
    lock: !!document.querySelector('.mysun-note-lock'),
    segs: segs.map(b => b.textContent.trim() + ':' + b.getAttribute('aria-pressed')).join('|'),
    withToggle: rows.filter(r => r.querySelector('.mysun-note-share')).length };
})()`);
check('공유하지 않은 내 노트는 이 목록에 오지 않는다',
  myNote.rows === 1 && myNote.priv === false && myNote.lock === false, JSON.stringify(myNote));
check('내가 공유한 줄에만 두 쪽짜리 토글이 서고 지금은 공유 쪽이다',
  myNote.withToggle === 1 && myNote.segs === '나만 보기:false|순에 공유하기:true', myNote.segs);
// 공유를 끄면 그 줄은 목록에서 사라진다(조회가 shared_to_sun만 본다) — 저장은 그대로 된다
await ev(`(() => { const r = [...document.querySelectorAll('.mysun-note')]
  .find(x => x.innerText.includes('지난 주일에 나눈 노트'));
  r.querySelector('.mysun-note-share button[aria-pressed="false"]').click(); })()`);
await sleep(1200);
const shared = await ev(`(() => ({
  rows: document.querySelectorAll('.mysun-note').length,
  still: document.body.innerText.includes('지난 주일에 나눈 노트'),
  stored: (${store('service_notes')}.find(n => n.id === 'n4') || {}).shared_to_sun,
}))()`);
check('내 줄에서 공유를 끄면 저장되고 그 줄이 목록에서 빠진다',
  shared.stored === false && shared.still === false && shared.rows === 1, JSON.stringify(shared));
// **목록도 종이다**(사용자 요구 2026-09-09 — "해당 노트 템플릿 그대로 공유될 수 있도록").
// 노트는 마크다운으로 쓰므로 종이도 굵게·목록을 그려야 한다 — 원문 기호가 글자로 남으면
// 안 되고, 도막 제목은 왼쪽 라벨로 올라간다(paper.jsx PaperText·PaperRow).
// **되돌리기**: PaperText를 `whitespace-pre-line` 한 줄로 되돌리면 `**`가 글자로 남아 깨진다.
await ev(`(() => { const t = document.querySelector('.mysun-note-pick .menu-pick'); t && t.click(); })()`);
await sleep(300);
await ev(`(() => { const o = [...document.querySelectorAll('.menu-pick-option')][0]; o && o.click(); })()`);
await sleep(600);
const noteMd = await ev(`(() => {
  const b = document.querySelector('.mysun-note-sheet');
  if (!b) return { err: 'no-sheet' };
  return { mast: !!b.querySelector('.paper-mast'), labels: [...b.querySelectorAll('.paper-row-label')].map(x => x.textContent.trim()),
    strong: b.querySelectorAll('strong').length, bullet: b.querySelectorAll('.paper-bullet').length, raw: b.innerText };
})()`);
check('공유된 노트가 종이로 서고 원문 기호가 글자로 남지 않는다',
  !noteMd.err && noteMd.mast === true && noteMd.labels.includes('오늘 남은 말씀')
  && noteMd.strong >= 1 && noteMd.bullet >= 1
  && !noteMd.raw.includes('**') && !noteMd.raw.includes('## '), JSON.stringify(noteMd));
check('공유하지 않은 남의 노트는 오지 않는다', mine.hidden === false);

// ── 1-0) useSettled는 state다 (components/groupsParts.jsx) ─────────────────
// ref로 두면 값이 도착해 loading이 false가 된 프레임에 false를 돌려주고, 효과에서 ref를 고쳐도
// 다시 그리지 않아 **다른 상태가 바뀌기 전까지 스켈레톤이 그대로** 섰다("내 순에 공유된 예배
// 노트가 계속 스켈레톤" — 사용자 보고 2026-09-07). 재현 조건(명단은 캐시, 노트 캐시만 비움)은
// 게스트에서 못 만들어 소스로 못 박는다.
{
  const src = readFileSync(new URL('../src/components/groupsParts.jsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function useSettled'), src.indexOf('export const CARD'));
  check('useSettled는 useState로 자리를 기억한다(ref면 도착 프레임에 다시 그리지 않는다)',
    /const \[at, setAt\] = useState\(/.test(body) && /setAt\(key\)/.test(body) && !/useRef\(/.test(body));
}

// ── 1-0-b) 출석 줄은 **자리를 먼저 잡는다** (사용자 요청 2026-09-08) ─────────
// 첫 진입(캐시 없음)에는 명단(baseQ)이 먼저 서고 출석 한 벌(mineQ)이 뒤따라 온다.
// 그 사이에 아무것도 안 그리면 값이 도착하는 순간 이름 격자가 한 줄만큼 아래로 튄다.
// 스켈레톤이 그 자리를 같은 높이로 잡고, **도착하면 곧바로 풀린다**(§6-9-ad).
await ev(plant({ personId: 'p1', isMaster: false, isAdmin: false, roles: [] }));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1200);
// **프레임을 훑지 않고 DOM 삽입을 본다**(1-2-b와 같은 이유) — 게스트는 읽는 곳이
// localStorage라 중간 상태가 한 프레임도 안 그려질 수 있는데, 그래도 DOM에는 한 번
// 꽂힌다. 프레임만 세면 같은 코드가 돌 때마다 붙었다 떨어졌다 한다(실제로 그랬다).
const attPaint = await ev(`(async () => {
  const raf = () => new Promise(r => requestAnimationFrame(r));
  const hit = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
  for (let i = 0; i < 20 && !hit('모임'); i++) await new Promise(r => setTimeout(r, 200));
  let sk = 0, both = 0;
  const mark = (n) => {
    if (n.nodeType !== 1) return;
    const c = typeof n.className === 'string' ? n.className : '';
    if (c.includes('mysun-att-loading') || n.querySelector?.('.mysun-att-loading')) sk += 1;
  };
  const obs = new MutationObserver(rs => rs.forEach(r => r.addedNodes.forEach(mark)));
  obs.observe(document.body, { childList: true, subtree: true });
  hit('모임').click();
  for (let i = 0; i < 40; i++) {
    await raf();
    if (document.querySelector('.mysun-att-loading') && document.querySelector('.mysun-att')) both += 1;
  }
  obs.disconnect();
  await new Promise(r => setTimeout(r, 700));
  const p = document.querySelector('.mysun-att');
  return { sk, both,
    lineH: p ? Math.round(p.getBoundingClientRect().height) : 0,
    stuck: !!document.querySelector('.mysun-att-loading'), ended: !!p };
})()`, true);
// 스켈레톤의 높이는 소스에 못 박혀 있다 — 게스트에서는 그것이 그려지는 프레임을
// 붙잡을 수 없어서, 적어 둔 값과 실제 줄 높이를 견준다.
const attSkelH = Number((readFileSync(new URL('../src/components/groupsSun.jsx', import.meta.url), 'utf8')
  .match(/mysun-att-loading[^]{0,120}?h-\[(\d+)px\]/) || [])[1] || 0);
check('첫 진입 — 출석 줄 자리를 스켈레톤이 먼저 잡는다(자리가 튀지 않게)',
  attPaint.sk === 1 && attPaint.both === 0, JSON.stringify(attPaint));
check('출석 스켈레톤은 그 줄과 같은 높이다',
  attSkelH > 0 && Math.abs(attSkelH - attPaint.lineH) <= 1, `${attSkelH} ← ${attPaint.lineH}`);
check('출석 스켈레톤은 값이 오면 풀린다(굳지 않는다)',
  attPaint.stuck === false && attPaint.ended === true, JSON.stringify(attPaint));

// 발행만 되고 **아직 오지 않은** 주일 주보는 출석 줄을 가져가지 않는다 —
// 목요일에 이번 주일 주보를 발행하면 카드가 그 예배의 `0/N`을 세던 자리다.
await enter({ personId: 'p1', isMaster: false, isAdmin: false, roles: [] }, 'light',
  `g.services.push({ id: 's9', kind: 'sunday', service_date: '${SUN_AHEAD}', status: 'published', title: '앞으로 올 주일' });`);
const aheadAtt = await ev(`document.querySelector('.mysun-att')?.textContent.trim() || ''`);
check('앞으로 올 주일 주보가 발행돼 있어도 출석 줄은 지난 주일 그대로다',
  aheadAtt.includes(dateLabel(SUN_LAST)) && aheadAtt.endsWith('예배 출석 2/3')
  && !aheadAtt.includes(dateLabel(SUN_AHEAD)), aheadAtt);

// ── 1-1) 순모임 가이드 (components/sunGuide.jsx · services/sunGuide.js · 0055) ──
// 가이드는 스위치 하나로 켜고 끈다(SUN_GUIDE_ON — 2026-09-05에 껐다가 2026-09-08에
// 사용자 스펙과 함께 다시 켰다). 꺼져 있으면 "아무에게도 안 보인다"만 보고, 켜면
// 아래가 그대로 살아난다.
const GUIDE_ON = /export const SUN_GUIDE_ON = true;/.test(readFileSync(new URL('../src/services/sunGuide.js', import.meta.url), 'utf8'));
// 종이 머리의 날짜('26년 9월 1일')와 고르는 줄의 한 줄('26년 9월 1일 (일) · 제목')
const guideDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${String(y).slice(2)}년 ${m}월 ${d}일`; };
// 고르개 칩의 짧은 글자 — `26.09.06 예배`(사용자 결정 2026-09-09 · sunGuide.guidePickLabel).
// 종이 머리·목록 줄의 긴 날짜와 다른 글자다: 칩은 버튼 무리 안에 서므로 짧아야 한다.
const pickLabel = (iso) => `${iso.slice(2).replace(/-/g, '.')} 예배`;
const svcLabel = (iso, title) => {
  const [y, m, d] = iso.split('-').map(Number);
  const w = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
  return `${guideDate(iso)} (${w})${title ? ` · ${title}` : ''}`;
};
// **보는 사람이 갈린다**(0039 sun_guides_select — leads_any_sun 또는 can_manage_sun):
// 순장은 보고 일반 순원은 못 본다. 순원의 나눔 질문을 미리 보여주면 모임에서 처음 듣는
// 말이 없어진다. 가이드 한 벌은 church_sunguide_v1에 심는다(그 파일의 저장 자리 계약).
await enter({ personId: 'p1', isMaster: false, isAdmin: false, roles: [] }, 'light', '', true);
const guideLeader = await ev(`!!document.querySelector('.sun-guide')`);
if (!GUIDE_ON) {
  check('가이드 스위치가 꺼져 있으면 순장에게도 안 보인다', guideLeader === false, String(guideLeader));
} else {
// 자리와 정렬 — 처음에는 섹션 전체가 max-w-560 + mx-auto라 제목과 버튼이 순 카드의
// 어느 선과도 맞지 않고 화면 가운데에 떠 있었다(사용자 지적 2026-09-03, 두 번).
const gDesk = await guideBox();
// 종이의 짜임 — 사용자가 준 템플릿 그대로다: 머리 줄(왼쪽 날짜 · 세로선 · 오른쪽
// '순모임 가이드') → 위가 돔인 흰 카드(로고 · ♥ 세 구역) → THE DABOOT MINISTRY.
const gSheet = await ev(`(() => {
  const t = (s) => (document.querySelector(s) || {}).textContent?.trim() ?? null;
  const logo = document.querySelector('.sun-guide-logo');
  const page = document.querySelector('.sun-guide-page');
  const heads = [...document.querySelectorAll('.sun-guide-head')].map(e => e.textContent.trim());
  return {
    date: t('.sun-guide-head-date'), name: t('.sun-guide-head-name'),
    logo: !!logo && logo.naturalWidth > 0,
    dome: page ? getComputedStyle(page).borderTopLeftRadius : null,
    heads,
    ref: t('.sun-guide-ref'),
    subs: [...document.querySelectorAll('.sun-guide-sub')].map(e => e.textContent.trim()),
    bold: !!document.querySelector('.sun-guide-body strong'),
    qs: [...document.querySelectorAll('.sun-guide-q')].map(e => e.textContent.trim()),
    note: t('.sun-guide-q-note'),
    mark: t('.sun-guide-mark'),
  };
})()`);
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await sleep(600);
const gMob = await guideBox();
const gMobOver = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);
await enter({ personId: 'p2', isMaster: false, isAdmin: false, roles: [] }, 'light', '', true);
const guidePlain = await ev(`!!document.querySelector('.sun-guide')`);
check('순모임 가이드는 순장에게 보이고 일반 순원에게는 안 보인다',
  guideLeader === true && guidePlain === false, `순장 ${guideLeader} / 순원 ${guidePlain}`);
check('가이드는 내 순 카드 아래에, 카드와 같은 좌우 끝에 선다',
  !gDesk.err && Math.abs(gDesk.dl) <= 1 && Math.abs(gDesk.dr) <= 1 && gDesk.below > 0,
  JSON.stringify(gDesk));
check('가이드 종이는 그 안에서 좌우 여백이 같다(가운데)',
  !gDesk.err && Math.abs(gDesk.pad) <= 1, JSON.stringify(gDesk));
check('모바일 375px에서도 카드와 같은 열에 서고 종이가 가운데다',
  !gMob.err && Math.abs(gMob.dl) <= 1 && Math.abs(gMob.dr) <= 1 && gMob.below > 0
  && Math.abs(gMob.pad) <= 1, JSON.stringify(gMob));
check('모바일 375px에서 가로로 넘치지 않는다', gMobOver <= 0, String(gMobOver));
check('종이 머리는 왼쪽 날짜 · 오른쪽 순모임 가이드다',
  gSheet.date === guideDate(SUN_LAST) && gSheet.name === '순모임 가이드',
  JSON.stringify({ date: gSheet.date, name: gSheet.name }));
check('카드 위에 로고가 그려진다', gSheet.logo === true, String(gSheet.logo));
// 위가 **넓은 돔**이다: 가로 반지름은 폭의 비율(46%)이라 375px에서도 1440px에서도
// 같은 모양이고, 세로 반지름만 고정(px)이라 돔 높이가 폭을 따라 늘어나지 않는다.
const [domeX, domeY] = String(gSheet.dome).split(' ');
check('카드 위는 넓은 돔이다(가로는 비율 · 세로는 고정)',
  domeX?.endsWith('%') && parseFloat(domeX) >= 40
  && domeY?.endsWith('px') && parseFloat(domeY) >= 60, gSheet.dome);
check('구역은 주일 본문 · 말씀 요약 · 오늘의 나눔 질문 셋이다',
  JSON.stringify(gSheet.heads) === JSON.stringify(['주일 본문', '말씀 요약', '오늘의 나눔 질문']),
  JSON.stringify(gSheet.heads));
check('주일 본문은 구절 + [한 마디]다',
  gSheet.ref === '빌립보서 4:4-7 [항상 기뻐하라]', gSheet.ref);
// 번호('1.')와 'Q.'와 '(EX. …)'는 **화면이 붙인다** — 저장된 글에는 없다
check('말씀 요약의 소제목에는 화면이 번호를 붙인다',
  JSON.stringify(gSheet.subs) === JSON.stringify(['1. 기뻐하라', '2. 염려하지 말라', '3. 지키시는 평강']),
  JSON.stringify(gSheet.subs));
check('굵게 마커는 굵은 글씨가 된다(별표가 글자로 남지 않는다)',
  gSheet.bold === true && !gSheet.subs.join('').includes('**'));
check('나눔 질문 넷에 화면이 Q.를 붙인다',
  gSheet.qs.length === 4 && gSheet.qs.every(q => q.startsWith('Q.'))
  && gSheet.qs[0].includes('지난 한 주'), JSON.stringify(gSheet.qs));
check('마지막 질문 아래에 예시 한 줄이 괄호로 붙는다',
  gSheet.note === '(EX. 고단한 한 주를 보낸 순원이 있다면 다같이 카페에 가서 달달한 것 먹기)',
  gSheet.note);
check('종이 아래에는 THE DABOOT MINISTRY가 있다',
  gSheet.mark === 'THE DABOOT MINISTRY', gSheet.mark);

// 어떤 주보로 만들 것인가 — 고르는 자리(사용자 스펙 2026-09-08). 발행된 주일만,
// 최근순이다. 고정이 없으면 기본은 가장 최근 주일이다.
// (바로 위에서 일반 순원으로 들어갔으므로 순장으로 다시 들어온다)
await enter({ personId: 'p1', isMaster: false, isAdmin: false, roles: [] }, 'light', '', true);
const pickOpen = () => ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const t = document.querySelector('.sun-guide-pick .menu-pick');
  if (!t) return { err: 'no-pick' };
  const label = t.textContent.trim();
  t.click(); await w(350);
  const opts = [...document.querySelectorAll('.menu-pick-option')].map(b => b.textContent.trim());
  return { label, opts };
})()`, true);
const gPick = await pickOpen();
check('고르는 줄은 발행된 주일 주보만 최근순으로 세운다',
  !gPick.err && JSON.stringify(gPick.opts)
    === JSON.stringify([svcLabel(SUN_LAST, '흔들리지 않는 기쁨'), svcLabel(SUN_OLD, '지난 주일')]),
  JSON.stringify(gPick));
// 칩 글자에 **'주보'가 붙는다**(2026-09-09) — 날짜만 있으면 버튼 무리 속에서 무엇을
// 고르는 자리인지 읽히지 않았다(사용자 지적: "주보 선택해서 만드는 기능이 없어보임")
check('고정이 없으면 기본은 가장 최근 주일이고 칩이 짧은 글자를 쓴다',
  gPick.label === pickLabel(SUN_LAST), `${gPick.label} / ${pickLabel(SUN_LAST)}`);
// 지난 주일을 고르면 그 주보의 가이드를 연다 — 거기엔 아직 없으므로 **고르는 줄**이
// 펴진다(2026-09-09). 그때 머리줄의 피커는 사라진다: 같은 일을 하는 조작기를 두 벌
// 세우면 어느 쪽이 진짜인지 알 수 없다.
const gSwitch = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const o = [...document.querySelectorAll('.menu-pick-option')].at(-1);
  if (!o) return { err: 'no-option' };
  o.click(); await w(900);
  const on = document.querySelector('.sun-guide-choice[aria-pressed="true"]');
  const dateOf = (b) => b.querySelector('.sun-guide-choice-date').textContent.trim();
  return {
    pick: !!document.querySelector('.sun-guide-pick'),
    sheet: !!document.querySelector('.sun-guide-sheet'),
    on: on ? dateOf(on) : '',
    tagged: [...document.querySelectorAll('.sun-guide-choice')]
      .filter(b => b.querySelector('.sun-guide-choice-tag')).map(dateOf),
    create: (document.querySelector('.sun-guide-create') || {}).textContent?.trim() || '',
  };
})()`, true);
check('다른 주보를 고르면 그 주보의 가이드를 연다',
  gSwitch.sheet === false && gSwitch.on === svcLabel(SUN_OLD, '') && gSwitch.pick === false,
  JSON.stringify(gSwitch));
// 이미 가이드가 있는 주보에는 꼬리표가 붙는다 — 시드는 최근 주일(s1)에만 한 벌을 두었다
check("이미 가이드가 있는 주보에만 '가이드 있음'이 붙는다",
  JSON.stringify(gSwitch.tagged) === JSON.stringify([svcLabel(SUN_LAST, '')]),
  JSON.stringify(gSwitch.tagged));
check('만들기 버튼에 고른 주보의 날짜가 적힌다',
  gSwitch.create === `${guideDate(SUN_OLD)} 주보로 만들기`, gSwitch.create);

// 이미지로 저장 — 화면에 선 종이를 그대로 2배로 굽는다(html2canvas는 누를 때 받는다).
// 공유 시트가 없는 데스크톱에서는 내려받기로 떨어지므로 그 blob을 가로채 픽셀을 본다.
await enter({ personId: 'p1', isMaster: false, isAdmin: false, roles: [] }, 'light', '', true);
const gImg = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const real = URL.createObjectURL.bind(URL);
  window.__png = null;
  URL.createObjectURL = (b) => { window.__png = b; return real(b); };
  try { Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true }); } catch (e) {}
  const btn = document.querySelector('.sun-guide-image');
  if (!btn) { URL.createObjectURL = real; return { err: 'no-btn' }; }
  btn.click();
  for (let i = 0; i < 150 && !window.__png; i++) await w(100);
  URL.createObjectURL = real;
  if (!window.__png) return { err: 'no-blob' };
  const img = new Image();
  img.src = real(window.__png);
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const all = x.getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 0; i < all.length; i += 4 * 41) if (all[i] < 200 && all[i + 1] < 200) ink++;
  // 로고가 그려졌는가 — 화면의 로고 자리를 그대로 그림 위의 자리로 옮겨 재 본다
  const sheet = document.querySelector('.sun-guide-sheet').getBoundingClientRect();
  const logo = document.querySelector('.sun-guide-logo').getBoundingClientRect();
  const k = c.width / sheet.width;
  const box = x.getImageData(Math.round((logo.left - sheet.left) * k), Math.round((logo.top - sheet.top) * k),
    Math.max(1, Math.round(logo.width * k)), Math.max(1, Math.round(logo.height * k))).data;
  let mark = 0;
  for (let i = 0; i < box.length; i += 4) if (box[i] < 150 && box[i + 1] < 150 && box[i + 2] < 150) mark++;
  return { type: window.__png.type, size: window.__png.size, w: c.width, h: c.height, ink, mark };
})()`, true);
check('이미지로 저장은 종이를 2배 크기 PNG로 굽는다',
  !gImg.err && gImg.type === 'image/png' && gImg.size > 10000
  && gImg.w >= 1000 && gImg.w <= 1160 && gImg.h > gImg.w, JSON.stringify(gImg));
check('구운 그림이 백지가 아니고 로고도 들어 있다',
  !gImg.err && gImg.ink > 200 && gImg.mark > 200, JSON.stringify(gImg));

// 순장(리더순장이 아닌)도 만든다 — 2026-09-08부터 **보는 사람 = 만드는 사람**이다.
// 가이드가 하나도 없으면 **고를 주보부터 편다**(사용자 지시 2026-09-09 — "주보를 일단
// 먼저 사용자가 선택을 하고 나서 해당 주보에 대해서 만들 수 있게끔"). 예전에는 머리줄
// 오른쪽 끝에 'AI로 만들기' 하나뿐이라, 무엇으로 만드는지가 작은 피커 안에만 있었다.
await enter({ personId: 'p1', isMaster: false, isAdmin: false, roles: [] });
const gNone = await ev(`(() => {
  const sec = document.querySelector('.sun-guide');
  const wrap = document.querySelector('.sun-guide-body-wrap');
  const rows = [...document.querySelectorAll('.sun-guide-choice')];
  const btn = document.querySelector('.sun-guide-create');
  if (!sec || !wrap || !rows.length || !btn) return { err: 'no-el' };
  const w = wrap.getBoundingClientRect(), b = btn.getBoundingClientRect();
  return {
    head: sec.querySelector('h3').textContent.trim(),
    pick: !!document.querySelector('.sun-guide-pick'),
    dates: rows.map(r => r.querySelector('.sun-guide-choice-date').textContent.trim()),
    titles: rows.map(r => r.querySelector('.sun-guide-choice-title').textContent.trim()),
    on: rows.map(r => r.getAttribute('aria-pressed')),
    tags: rows.filter(r => r.querySelector('.sun-guide-choice-tag')).length,
    label: btn.textContent.trim(),
    // 줄은 목록 폭을 다 쓴다 · 목록은 종이와 같은 상한(560px) 안이다
    fullWidth: rows.every(r => Math.abs(r.getBoundingClientRect().width - w.width) <= 1),
    wrapW: Math.round(w.width),
    // 만들기는 줄 밑, 왼쪽 끝이다(상시 도구 줄 — 확정 왼쪽, §8)
    below: Math.round(b.top - rows.at(-1).getBoundingClientRect().bottom),
    left: Math.round(b.left - w.left),
  };
})()`);
check('가이드가 없으면 고를 주보를 줄로 펴고 머리줄 피커는 걷는다',
  !gNone.err && gNone.head === '순모임 가이드' && gNone.pick === false
  && JSON.stringify(gNone.dates) === JSON.stringify([svcLabel(SUN_LAST, ''), svcLabel(SUN_OLD, '')]),
  JSON.stringify(gNone));
check('줄에는 날짜와 설교 제목이 같이 서고, 가이드가 없으니 꼬리표는 없다',
  !gNone.err && JSON.stringify(gNone.titles) === JSON.stringify(['흔들리지 않는 기쁨', '지난 주일'])
  && gNone.tags === 0, JSON.stringify(gNone));
check('고른 줄만 강조된다(기본은 가장 최근 주일)',
  !gNone.err && JSON.stringify(gNone.on) === JSON.stringify(['true', 'false']), JSON.stringify(gNone));
check('만들기는 줄 밑 왼쪽에 서고 버튼 글자에 그 주보 날짜가 있다',
  !gNone.err && gNone.label === `${guideDate(SUN_LAST)} 주보로 만들기`
  && gNone.below >= 0 && Math.abs(gNone.left) <= 1, JSON.stringify(gNone));
check('고르는 줄은 목록 폭을 다 쓰고 목록은 종이와 같은 상한 안이다',
  !gNone.err && gNone.fullWidth === true && gNone.wrapW <= 560, JSON.stringify(gNone));

// 375에서도 줄이 폭을 다 쓰고 가로로 넘치지 않는다
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await sleep(600);
const gNoneMob = await ev(`(() => {
  const wrap = document.querySelector('.sun-guide-body-wrap');
  const rows = [...document.querySelectorAll('.sun-guide-choice')];
  if (!wrap || !rows.length) return { err: 'no-el' };
  const w = wrap.getBoundingClientRect();
  return {
    fullWidth: rows.every(r => Math.abs(r.getBoundingClientRect().width - w.width) <= 1),
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clipped: rows.some(r => { const t = r.querySelector('.sun-guide-choice-date'); return t.scrollWidth - t.clientWidth > 1; }),
  };
})()`);
check('모바일 375px에서도 고르는 줄이 폭을 다 쓰고 날짜가 잘리지 않는다',
  !gNoneMob.err && gNoneMob.fullWidth === true && gNoneMob.over <= 0 && gNoneMob.clipped === false,
  JSON.stringify(gNoneMob));
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);

// 줄을 누르면 그 주보로 갈리고 만들기 버튼의 날짜도 따라간다
const gChoose = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const rows = [...document.querySelectorAll('.sun-guide-choice')];
  if (rows.length < 2) return { err: 'no-rows' };
  rows[1].click(); await w(900);
  return {
    on: [...document.querySelectorAll('.sun-guide-choice')].map(r => r.getAttribute('aria-pressed')),
    label: document.querySelector('.sun-guide-create').textContent.trim(),
  };
})()`, true);
check('줄을 누르면 그 주보로 갈리고 버튼 글자도 따라간다',
  !gChoose.err && JSON.stringify(gChoose.on) === JSON.stringify(['false', 'true'])
  && gChoose.label === `${guideDate(SUN_OLD)} 주보로 만들기`, JSON.stringify(gChoose));

// **누르면 편집 화면이 열리거나 왜 못 만드는지 말한다**(사용자 물음 2026-09-03 —
// 예전에는 이유 없이 '만들 수 없어요'만 떴다). 그리고 저장은 **고른 주보 밑**에 남는다.
await ev(`document.querySelector('.sun-guide-create').click()`); await sleep(2200);
const gMake = await ev(`(() => ({
  edit: !!document.querySelector('.sun-guide-edit'),
  toast: (document.querySelector('[data-toast]') || {}).innerText || '',
}))()`);
check('만들기는 편집 화면을 열거나, 왜 못 만드는지 말한다',
  gMake.edit === true || /만들 수 없어요|만들지 못했어요/.test(gMake.toast), JSON.stringify(gMake));
if (gMake.edit) {
  await ev(`document.querySelector('.sun-guide-save').click()`); await sleep(1200);
  const gSaved = await ev(`(() => {
    const rows = (JSON.parse(localStorage.getItem('church_sunguide_v1')) || {}).sun_guides || [];
    return {
      sheet: !!document.querySelector('.sun-guide-sheet'),
      ids: rows.map(r => r.service_id),
      // 종이 머리의 날짜 = 고른 주보의 날짜
      date: (document.querySelector('.sun-guide-head-date') || {}).textContent?.trim() || '',
      toast: (document.querySelector('[data-toast]') || {}).innerText || '',
    };
  })()`);
  check('만든 가이드는 고른 주보 밑에 저장되고 그 종이가 선다',
    gSaved.sheet === true && JSON.stringify(gSaved.ids) === JSON.stringify(['s0'])
    && gSaved.date === guideDate(SUN_OLD) && gSaved.toast.includes('저장했어요'),
    JSON.stringify(gSaved));
}

// ── 고정 (0055 — §4.4 '3줄 요약 고정'과 같은 뜻) ────────────────────────────
// 고정된 한 벌이 **모두가 기본으로 여는 것**이고, 그 행은 마스터 말고는 못 고친다.
// 시드는 지난 주일(s0)에 고정된 한 벌을 두었다 — 가장 최근 주일(s1)에도 한 벌이 있어서
// '기본은 최근'이 아니라 '기본은 고정'인지가 갈린다.
await enter({ personId: 'p1', isMaster: false, isAdmin: false, roles: [] }, 'light', '', 'pinned');
const gPinnedLeader = await ev(`(() => ({
  label: (document.querySelector('.sun-guide-pick .menu-pick') || {}).textContent?.trim() || '',
  ref: (document.querySelector('.sun-guide-ref') || {}).textContent?.trim() || '',
  edit: !!document.querySelector('.sun-guide-editbtn'),
  regen: !!document.querySelector('.sun-guide-regen'),
  image: !!document.querySelector('.sun-guide-image'),
  badge: !!document.querySelector('.sun-guide-pinned'),
  pin: !!document.querySelector('.sun-guide-pin'),
}))()`);
check('고정된 가이드가 있으면 모두 그것부터 연다',
  gPinnedLeader.label === pickLabel(SUN_OLD) && gPinnedLeader.ref.startsWith('빌립보서 4:1-3'),
  JSON.stringify(gPinnedLeader));
check('고정된 가이드는 마스터가 아니면 수정·다시 만들기가 없다',
  gPinnedLeader.edit === false && gPinnedLeader.regen === false && gPinnedLeader.image === true,
  JSON.stringify(gPinnedLeader));
// 고정 버튼은 마스터만이지만 **배지는 반대다**(2026-09-09에 조건을 뒤집었다) —
// 순장에게는 고정된 가이드의 수정·다시 만들기가 아무 설명 없이 사라져 있었고,
// 이 배지가 그 이유를 말하는 유일한 자리다.
check('고정을 못 푸는 사람에게는 배지가 왜 못 고치는지 말해 준다',
  gPinnedLeader.badge === true && gPinnedLeader.pin === false, JSON.stringify(gPinnedLeader));
// 줄글 요약을 들고 있는 지난 판도 그대로 열린다(선택 필드)
const gOld = await ev(`(() => ({
  sub: (document.querySelector('.sun-guide-sub') || {}).textContent?.trim() || '',
  qs: document.querySelectorAll('.sun-guide-q').length,
  note: !!document.querySelector('.sun-guide-q-note'),
}))()`);
check('줄글 요약을 들고 있는 지난 가이드도 그대로 열린다',
  gOld.sub === '[빌립보서 3:17~21 배경 요약]' && gOld.qs === 3 && gOld.note === false,
  JSON.stringify(gOld));

await enter({ personId: 'p6', isMaster: true, isAdmin: true, roles: [] }, 'light', '', 'pinned');
const gPinnedMaster = await ev(`(() => ({
  badge: (document.querySelector('.sun-guide-pinned') || {}).textContent?.trim() || '',
  pin: (document.querySelector('.sun-guide-pin') || {}).textContent?.trim() || '',
  edit: !!document.querySelector('.sun-guide-editbtn'),
}))()`);
// 마스터에게는 '고정 해제' 버튼이 이미 그 사실을 말하므로 배지를 겹쳐 붙이지 않는다
// (375에서 머리줄이 두 줄로 접히는 원인이기도 했다 — 사용자 지적 2026-09-09)
check('마스터에게는 고정 해제만 있고 배지를 겹쳐 붙이지 않는다',
  gPinnedMaster.badge === '' && gPinnedMaster.pin === '고정 해제' && gPinnedMaster.edit === true,
  JSON.stringify(gPinnedMaster));
const gUnpin = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  document.querySelector('.sun-guide-pin').click(); await w(1200);
  const rows = (JSON.parse(localStorage.getItem('church_sunguide_v1')) || {}).sun_guides || [];
  return {
    pinned: rows.filter(r => r.pinned).length,
    label: document.querySelector('.sun-guide-pick .menu-pick').textContent.trim(),
    btn: document.querySelector('.sun-guide-pin').textContent.trim(),
    toast: (document.querySelector('[data-toast]') || {}).innerText || '',
  };
})()`, true);
check('마스터가 고정을 풀면 저장 자리에서도 풀린다',
  gUnpin.pinned === 0 && gUnpin.btn === '고정' && gUnpin.toast.includes('고정을 풀었어요'),
  JSON.stringify(gUnpin));

// **종이는 늘 밝다**(인쇄물 — 그림으로 나가는 그 종이다). 테마를 바꿔도 종이 색은
// 그대로이고, 종이를 감싸는 화면(머리줄·바탕)만 따라간다.
const guidePaint = () => ev(`(() => {
  const c = (s, p) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[p] : null; };
  return { sheet: c('.sun-guide-sheet', 'backgroundColor'), page: c('.sun-guide-page', 'backgroundColor'),
    ink: c('.sun-guide-ref', 'color'), head: c('.sun-guide h3', 'color'),
    body: getComputedStyle(document.body).backgroundColor };
})()`);
await enter({ personId: 'p1', isMaster: false, isAdmin: false, roles: [] }, 'light', '', true);
const gLight = await guidePaint();
await enter({ personId: 'p1', isMaster: false, isAdmin: false, roles: [] }, 'dark', '', true);
const gDark = await guidePaint();
check('다크에서도 종이는 밝은 채로 남는다(그림으로 굽는 인쇄물이다)',
  gLight.sheet === gDark.sheet && gLight.page === gDark.page && gLight.ink === gDark.ink,
  `${gLight.sheet} → ${gDark.sheet} / ${gLight.page} → ${gDark.page}`);
check('종이를 감싸는 화면은 테마를 따라간다',
  gLight.head !== gDark.head && gLight.body !== gDark.body,
  `${gLight.head} → ${gDark.head} / ${gLight.body} → ${gDark.body}`);
}

// ── 1-2) 순 편성 탭은 마스터·관리자·리더순장·교역자 (0045 can_manage_sun) ──
// 교역자는 0035에 있었고 0039가 뺐다가 0045가 되돌렸다(사용자 결정 2026-09-05).
// 교역자 여부는 명단 속성이라(people.is_pastor) 시드의 한 사람을 교역자로 세워 본다.
await enter({ personId: 'p3', isMaster: false, isAdmin: true, roles: [] });
const adminTabs = await ev(TABS);
check('관리자에게는 순 편성 탭이 보인다', adminTabs === '내 순,동아리,순 편성', adminTabs);
// 0045부터 이름·설명과 명단이 같은 경계다 — 관리자는 남의 동아리에 사람을 넣고 뺀다.
// **신청 수락만 아직 마스터·동아리장이다**(0035 club_applications_update) — p3은 통통의
// 리더가 아니므로 리더 도구는 서되 가입 신청 구역은 없어야 한다.
await tab('동아리'); await sleep(600);
await openClub('통통'); await sleep(700);
const adminClub = await ev(`(() => ({
  edit: !!document.querySelector('.club-edit'),
  tools: !!document.querySelector('.club-leader-tools'),
  add: !!document.querySelector('.club-add'),
  drop: !!document.querySelector('.club-drop'),
  // '가입 신청'이라는 글자는 신청 버튼에도 있다 — 수락 구역은 자리(class)로 잰다
  apps: !!document.querySelector('.club-app-empty, .club-app-row'),
}))()`);
check('관리자는 남의 동아리 이름도 명단도 만진다(0045)',
  adminClub.edit === true && adminClub.tools === true && adminClub.add === true,
  JSON.stringify(adminClub));
check('그래도 가입 신청 수락은 관리자에게 안 열린다(마스터·동아리장)',
  adminClub.apps === false, JSON.stringify(adminClub));
await enter({ personId: 'p2', isMaster: false, isAdmin: false, roles: [] }, 'light',
  `g.people = g.people.map(p => (p.id === 'p2' ? { ...p, is_pastor: true } : p));`);
const pastorTabs = await ev(TABS);
check('교역자에게 순 편성 탭이 보인다(0045에서 돌아왔다)',
  pastorTabs === '내 순,동아리,순 편성', pastorTabs);

// ── 1-2-b) 딸린 섹션도 자리를 잡고 나온다 (사용자 지적 2026-09-03) ─────────
// "공유된 노트·순모임 가이드가 뒤늦게 뚝 나타난다." 첫 진입에는 그 자리에 스켈레톤을
// 두고(레이아웃이 밀리지 않게), 다음 진입에는 캐시가 있어 스켈레톤을 거치지 않는다.
await ev(plant({ personId: 'p1', isMaster: false, isAdmin: false, roles: [] }, 'light', '', true));
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1500);
// **게스트에서는 스켈레톤이 한 프레임도 안 보이는 것이 정상이다** — 읽는 곳이
// localStorage라 한 마이크로태스크에 끝나서 React가 같은 프레임에 최종 화면을 그린다.
// 그래서 여기서 보는 것은 '스켈레톤이 떴는가'가 아니라 **틀린 상태가 스쳤는가**다:
// 노트가 있는데 '없어요'가 한 프레임이라도 보이면 그것이 사용자가 본 그 증상이다.
// (스켈레톤 자체는 클라우드처럼 읽기가 늦을 때만 보인다 — 사람이 확인할 몫이다.)
// **프레임을 훑지 않고 DOM 삽입을 본다.** 게스트에서는 읽는 곳이 localStorage라
// 중간 상태가 한 프레임도 그려지지 않을 수 있는데(React가 같은 프레임에 최종 화면을
// 만든다) 그래도 DOM에는 한 번 꽂힌다 — MutationObserver는 그것까지 잡는다.
// 프레임만 훑으면 같은 코드가 돌 때마다 붙었다 떨어졌다 한다(실제로 그랬다).
const firstPaint = await ev(`(async () => {
  const rAF = () => new Promise(r => requestAnimationFrame(r));
  const hits = { skel: 0, empty: 0, note: 0 };
  const mark = (n) => {
    if (n.nodeType !== 1) return;
    const c = typeof n.className === 'string' ? n.className : '';
    if (c.includes('mine-skeleton')) hits.skel += 1;
    if (c.includes('mysun-note-empty') || n.querySelector?.('.mysun-note-empty')) hits.empty += 1;
    if (c.includes('mysun-note') || n.querySelector?.('.mysun-note')) hits.note += 1;
  };
  const obs = new MutationObserver(rs => rs.forEach(r => r.addedNodes.forEach(mark)));
  obs.observe(document.body, { childList: true, subtree: true });
  [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === '모임')[0].click();
  for (let i = 0; i < 25; i++) await rAF();
  obs.disconnect();
  return { wrongEmpty: hits.empty > 0, note: hits.note > 0, skelInserts: hits.skel };
})()`, true);
await sleep(1200);
check('첫 진입에 노트 자리가 빈 상태로 스치지 않는다(자리를 잡고 나온다)',
  firstPaint.wrongEmpty === false && firstPaint.note === true, JSON.stringify(firstPaint));
// 노트와 가이드는 **한 덩이**로 뜬다 — 스켈레톤이 둘로 갈리면 자리가 두 번 흔들린다
check('딸린 두 섹션의 스켈레톤은 하나다(두 벌로 갈리지 않는다)',
  firstPaint.skelInserts === 1, JSON.stringify(firstPaint));
const settled = await ev(`(() => ({
  note: !!document.querySelector('.mysun-note'),
  skel: document.querySelectorAll('.mine-skeleton').length,
  left: document.querySelectorAll('.groups-screen .dc-skeleton').length,
  guide: !!document.querySelector('.sun-guide'),
}))()`);
check('내용이 뜬 뒤 남는 스켈레톤은 0이다',
  settled.note === true && settled.guide === GUIDE_ON && settled.skel === 0 && settled.left === 0,
  JSON.stringify(settled));

// ── 1-3) 다시 들어올 때 스켈레톤이 아니라 캐시된 값 (사용자 요청 2026-09-03) ──
// "매번 스켈레톤이 아니라 캐시된 값이 먼저 보이게." 화면을 떠나면 GroupsView는
// 언마운트되지만 services/cache.js가 마지막 한 벌을 들고 있어서, 돌아올 때 첫 프레임에
// 이미 순 카드가 서 있어야 한다(스켈레톤 `.groups-loading`이 한 번도 뜨지 않는다).
// 게스트에서는 메모리만 캐시라 새로고침하면 초기화된다 — 그래서 **한 세션 안에서** 본다.
const revisit = await ev(`(async () => {
  const hit = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
  const rAF = () => new Promise(r => requestAnimationFrame(r));
  hit('홈').click();
  await new Promise(r => setTimeout(r, 800));
  const left = !document.querySelector('.groups-screen');
  hit('모임').click();
  let skeleton = false, painted = false;
  for (let i = 0; i < 15; i++) {
    await rAF();
    if (document.querySelector('.groups-loading')) skeleton = true;
    if (document.querySelector('.mine-skeleton')) skeleton = true;
    if (document.querySelector('.mysun-card')) painted = true;
  }
  return { left, skeleton, painted, name: document.querySelector('.mysun-name')?.textContent.trim() || '' };
})()`, true);
check('모임을 다시 열 때 스켈레톤 없이 캐시된 값이 먼저 그려진다',
  revisit.left === true && revisit.skeleton === false && revisit.painted === true
  && revisit.name === '꼬순', JSON.stringify(revisit));

// ── 1-4) 만들기 칸이 뚝 나타나지 않는가 (사용자 지적 2026-09-03) ───────────
// 등장은 화면의 카드 등장 토큰(dc-card)을 그대로 타고, 닫을 때는 짧게 접힌다(EXIT).
// 애니메이션 이름·길이를 계산값에서 본다 — 클래스만 보면 CSS가 빠졌을 때를 놓친다.
await enter({ personId: 'p6', isMaster: true, isAdmin: true, roles: ['lead_sunjang'] });
await tab('동아리'); await sleep(700);
await ev(`document.querySelector('.club-new-open').click()`);
await sleep(60);
const openMotion = await ev(`(() => {
  const box = document.querySelector('.club-new');
  if (!box) return { err: 'no-box' };
  const cs = getComputedStyle(box);
  return { cls: box.className.includes('dc-card'), name: cs.animationName,
    ms: Math.round(parseFloat(cs.animationDuration) * 1000) };
})()`);
check('새 동아리 칸은 카드 등장 애니메이션을 타고 나온다',
  openMotion.cls === true && openMotion.name === 'dc-card-in' && openMotion.ms >= 150,
  JSON.stringify(openMotion));
await sleep(500);
await ev(`[...document.querySelectorAll('.club-new button')].find(b => b.textContent.trim() === '취소').click()`);
await sleep(60);
const closeMotion = await ev(`(() => {
  const box = document.querySelector('.club-new');
  if (!box) return { gone: true };
  const cs = getComputedStyle(box);
  return { gone: false, exit: box.className.includes('animate-out'), name: cs.animationName };
})()`);
check('닫을 때는 곧 사라지지 않고 짧게 접힌다',
  closeMotion.gone === false && closeMotion.exit === true, JSON.stringify(closeMotion));
await sleep(400);
check('접힘이 끝나면 칸이 사라진다', (await ev(`!document.querySelector('.club-new')`)) === true);

// 순 편성의 새 순 칸도 같은 결이다
await tab('순 편성'); await sleep(800);
await ev(`document.querySelector('.sun-new-open').click()`); await sleep(60);
const sunMotion = await ev(`(() => {
  const box = document.querySelector('.sun-new');
  return box ? { name: getComputedStyle(box).animationName } : { err: 'no-box' };
})()`);
check('새 순 칸도 같은 등장을 탄다', sunMotion.name === 'dc-card-in', JSON.stringify(sunMotion));

// ── 2) 동아리 목록 · 가입 신청 ──────────────────────────────────────────────
await enter({ personId: 'p1', isMaster: false, roles: [] });
await tab('동아리'); await sleep(600);
const list = await ev(`(() => ({
  cards: [...document.querySelectorAll('.club-card')].map(c => c.innerText.replace(/\\n+/g, ' | ')),
  newBtn: !!document.querySelector('.club-new-open'),
  mine: [...document.querySelectorAll('.club-card')].filter(c => c.querySelector('.club-mine-badge')).map(c => c.querySelector('.club-name').textContent.trim()),
  pending: [...document.querySelectorAll('.club-card')].filter(c => c.querySelector('.club-pending-badge')).map(c => c.querySelector('.club-name').textContent.trim()),
}))()`);
check('동아리 카드에 이름·설명·동아리장·인원',
  list.cards.length === 3 && list.cards[0].includes('통통') && list.cards[0].includes('통기타 동아리')
  && list.cards[0].includes('동아리장 노준석') && list.cards[0].includes('2명'), JSON.stringify(list.cards[0]));
check('내가 든 동아리에 참여 중 표시', JSON.stringify(list.mine) === '["말씀읽기"]', JSON.stringify(list.mine));
// 계정이 이어진 사람은 표시명으로 부른다 — 리더 라벨도 같은 필드(people.name)를 쓴다
const shownName = await ev(`(() => {
  const card = [...document.querySelectorAll('.club-card')]
    .find(c => c.querySelector('.club-name').textContent.trim() === '서부버튼');
  return { leader: card ? card.innerText : '',
    roster: document.querySelector('.groups-screen').innerText.includes('임재훈') };
})()`);
check('리더 라벨은 계정 표시명으로 나온다(명단 이름은 새지 않는다)',
  shownName.leader.includes('동아리장 말감이') && shownName.roster === false,
  JSON.stringify(shownName));
check('신청해 둔 동아리에 대기 표시', JSON.stringify(list.pending) === '["통통"]', JSON.stringify(list.pending));
check('마스터가 아니면 새 동아리 버튼이 없다', list.newBtn === false);

await openClub('서부버튼'); await sleep(700);
const before = await ev(`(() => ({
  detail: !!document.querySelector('.club-detail'),
  apply: !!document.querySelector('.club-apply'),
  cancel: !!document.querySelector('.club-cancel'),
  tools: !!document.querySelector('.club-leader-tools'),
  edit: !!document.querySelector('.club-edit'),
  members: [...document.querySelectorAll('.club-member')].map(m => m.textContent.trim()),
}))()`);
check('동아리 상세가 열리고 구성원에 동아리장 표시',
  before.detail === true && before.members.length === 1 && before.members[0].includes('동아리장'), JSON.stringify(before.members));
check('내가 안 든 동아리에는 가입 신청 버튼', before.apply === true && before.cancel === false);
check('리더가 아니면 리더 도구가 없다', before.tools === false);
check('일반 멤버에게는 이름 고치기 연필이 없다', before.edit === false);

await ev(`document.querySelector('.club-apply').click()`); await sleep(900);
const applied = await ev(`(() => ({
  apply: !!document.querySelector('.club-apply'),
  cancel: !!document.querySelector('.club-cancel'),
  waiting: !!document.querySelector('.club-waiting'),
  rows: ${store('club_applications')}.filter(a => a.status === 'pending').length,
}))()`);
check('가입 신청을 보내면 대기 표시와 취소가 선다',
  applied.apply === false && applied.cancel === true && applied.waiting === true, JSON.stringify(applied));
check('신청이 저장된다', applied.rows === 2, String(applied.rows));

await ev(`${byText('목록으로')}.click()`); await sleep(700);
const badge = await ev(`[...document.querySelectorAll('.club-card')].filter(c => c.querySelector('.club-pending-badge')).map(c => c.querySelector('.club-name').textContent.trim())`);
check('목록에도 신청 대기가 같이 보인다', JSON.stringify(badge) === '["통통","서부버튼"]', JSON.stringify(badge));

await openClub('서부버튼'); await sleep(700);
await ev(`document.querySelector('.club-cancel').click()`); await sleep(900);
const cancelled = await ev(`(() => ({
  apply: !!document.querySelector('.club-apply'),
  cancel: !!document.querySelector('.club-cancel'),
  rows: ${store('club_applications')}.filter(a => a.status === 'pending').length,
}))()`);
check('신청을 취소하면 다시 가입 신청으로 돌아온다',
  cancelled.apply === true && cancelled.cancel === false && cancelled.rows === 1, JSON.stringify(cancelled));

// ── 2-0) 목록 ↔ 상세에 방향이 붙는다 (사용자 요청 2026-09-08) ───────────────
// "동아리 상세 들어갈 때에도 애니메이션 추가되도록." 상세에 `dc-screen`이 있는데도
// 아무 움직임이 없어 보인 이유는 이 화면을 감싼 App 껍데기가 `dc-nav`를 계속 달고
// 있어서다 — index.css의 `.dc-nav .dc-screen`이 그 안의 등장을 **페이드만** 남긴다.
// 그래서 겉 한 겹(dc-nav-fwd/back)을 모임 화면 안에서 다시 만든다.
const navOf = (sel) => ev(`(() => {
  const box = document.querySelector(${JSON.stringify(sel)})?.parentElement;
  if (!box) return { err: 'no-box' };
  const cs = getComputedStyle(box);
  const inner = document.querySelector(${JSON.stringify(sel)});
  return { name: cs.animationName, ms: Math.round(parseFloat(cs.animationDuration) * 1000),
    moved: cs.transform !== 'none', innerName: getComputedStyle(inner).animationName };
})()`);
await ev(`${byText('목록으로')}.click()`); await sleep(700);
const navIn = await ev(`(async () => {
  const raf = () => new Promise(r => requestAnimationFrame(r));
  document.querySelectorAll('.club-card')[0].click();
  await raf(); await raf();
  return true;
})()`, true);
const fwd = await navOf('.club-detail');
check('동아리 상세는 앞으로 미끄러져 들어온다',
  navIn === true && fwd.name === 'dc-nav-fwd' && fwd.ms === 260 && fwd.moved === true,
  JSON.stringify(fwd));
// 겉이 가로로 미는 동안 속은 **밝아지기만** 한다 — 둘 다 세로로 뜨면 대각선이 된다
check('상세 안쪽은 페이드만(가로+세로가 겹쳐 대각선이 되지 않게)',
  fwd.innerName === 'dc-screen-fade', String(fwd.innerName));
await sleep(500);
await ev(`(async () => {
  const raf = () => new Promise(r => requestAnimationFrame(r));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '목록으로').click();
  await raf(); await raf();
  return true;
})()`, true);
const back = await navOf('.club-list');
check('목록으로 돌아갈 때는 뒤로 미끄러진다',
  back.name === 'dc-nav-back' && back.moved === true, JSON.stringify(back));
await sleep(500);

// ── 2-1) 동아리 카드 순서 조정 (끌어서 — 프로젝트 탭·보드와 같은 공유 순서) ──
// 순서 저장은 0038의 reorder_clubs()로 승인 멤버 전체에게 열려 있다. 그래서 이
// 검사는 **일반 멤버**로 돈다.
const cardBox = (name) => ev(`(() => {
  const c = [...document.querySelectorAll('.club-card')]
    .find(x => x.querySelector('.club-name').textContent.trim() === ${JSON.stringify(name)});
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
const dragCard = async (from, to) => {
  const a = await cardBox(from), b = await cardBox(to);
  if (!a || !b) return false;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 14; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left',
      x: a.x + (b.x - a.x) * (i / 14), y: a.y + (b.y - a.y) * (i / 14) });
    await sleep(25);
  }
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  await sleep(700);
  return true;
};
const cardOrder = () => ev(`[...document.querySelectorAll('.club-card')].map(c => c.querySelector('.club-name').textContent.trim())`);
const order0 = await cardOrder();
check('처음에는 만든 차례 그대로', JSON.stringify(order0) === '["통통","말씀읽기","서부버튼"]', JSON.stringify(order0));

await dragCard('서부버튼', '통통');
const up = await cardOrder();
const upStored = await ev(`${store('groups')}.filter(g => g.type === 'club').map(g => [g.name, g.position])`);
check('위로 끌면 놓은 카드 앞에 선다',
  JSON.stringify(up) === '["서부버튼","통통","말씀읽기"]', JSON.stringify(up));
check('바뀐 순서가 저장된다(모임 화면을 벗어나도 남는다)',
  JSON.stringify(upStored.sort((a, b) => a[1] - b[1]).map(x => x[0])) === '["서부버튼","통통","말씀읽기"]',
  JSON.stringify(upStored));

// **아래로 끄는 경우**(§6-12-a) — 언제나 '앞'에 끼우면 나를 뺀 만큼 자리가 당겨져
// 제자리로 돌아온다. 눈으로는 "안 움직인다"로만 보여서 검사가 잡아야 한다.
await dragCard('서부버튼', '말씀읽기');
const down = await cardOrder();
check('아래로 끌면 놓은 카드 뒤에 선다(제자리로 돌아오지 않는다)',
  JSON.stringify(down) === '["통통","말씀읽기","서부버튼"]', JSON.stringify(down));

check('네이티브 select는 모임 화면에 하나도 없다',
  (await ev(`document.querySelectorAll('.groups-screen select').length`)) === 0);

// 끌기와 열기는 다른 조작이다 — 짧게 누르면 그대로 상세가 열린다
await openClub('통통'); await sleep(800);
const plainMeet = await ev(`(() => ({
  tools: !!document.querySelector('.club-leader-tools'),
  drop: document.querySelectorAll('.club-drop').length,
  meetings: [...document.querySelectorAll('.club-meeting')].map(m => m.innerText.replace(/\\n+/g, ' | ')),
  locked: [...document.querySelectorAll('.club-meet-chip')].every(c => c.disabled),
}))()`);
check('리더가 아니면 내보내기·모임 만들기가 없다', plainMeet.tools === false && plainMeet.drop === 0, JSON.stringify(plainMeet));
check('모임은 누구나 보되 출석은 만지지 못한다',
  plainMeet.meetings.length === 1 && plainMeet.meetings[0].includes('8월 25일') && plainMeet.meetings[0].includes('여름 합주')
  && plainMeet.meetings[0].includes('1/2') && plainMeet.locked === true, JSON.stringify(plainMeet.meetings));

// ── 3) 동아리장 도구 ────────────────────────────────────────────────────────
await enter({ personId: 'p6', isMaster: false, roles: [] });
await tab('동아리'); await sleep(600);
check('동아리장이어도 새 동아리는 마스터만', (await ev(`!!document.querySelector('.club-new-open')`)) === false);
await openClub('통통'); await sleep(800);
const leader = await ev(`(() => ({
  tools: !!document.querySelector('.club-leader-tools'),
  apps: [...document.querySelectorAll('.club-app-row')].map(r => r.innerText.replace(/\\n+/g, ' | ')),
  drop: document.querySelectorAll('.club-drop').length,
  chips: [...document.querySelectorAll('.club-meet-chip')].map(c => [c.textContent.trim(), c.getAttribute('aria-pressed'), c.disabled]),
  newMeet: !!document.querySelector('.club-meet-new-open'),
}))()`);
check('그 동아리 리더에게 리더 도구가 선다', leader.tools === true && leader.newMeet === true);
check('대기 중인 가입 신청이 보인다', leader.apps.length === 1 && leader.apps[0].includes('김윤주'), JSON.stringify(leader.apps));
check('동아리장 자신은 내보내기 대상이 아니다', leader.drop === 1, String(leader.drop));
check('리더에게는 모임 출석 칩이 열린다',
  leader.chips.length === 2 && leader.chips.every(c => c[2] === false)
  && leader.chips.find(c => c[0] === '노준석')[1] === 'true', JSON.stringify(leader.chips));

await ev(`[...document.querySelectorAll('.club-meet-chip')].find(c => c.textContent.trim() === '천진영').click()`);
await sleep(700);
const toggled = await ev(`(() => ({
  pressed: [...document.querySelectorAll('.club-meet-chip')].find(c => c.textContent.trim() === '천진영').getAttribute('aria-pressed'),
  count: document.querySelector('.club-meeting-count').textContent.trim(),
  stored: ${store('group_meetings')}.find(m => m.id === 'mt1').attendance,
}))()`);
check('모임 출석을 누르면 켜지고 그 자리에서 저장된다',
  toggled.pressed === 'true' && toggled.count === '2/2' && toggled.stored.length === 2, JSON.stringify(toggled));
await ev(`[...document.querySelectorAll('.club-meet-chip')].find(c => c.textContent.trim() === '천진영').click()`);
await sleep(700);
const untoggled = await ev(`(() => ({ count: document.querySelector('.club-meeting-count').textContent.trim(), stored: ${store('group_meetings')}.find(m => m.id === 'mt1').attendance.length }))()`);
check('다시 누르면 출석이 취소된다', untoggled.count === '1/2' && untoggled.stored === 1, JSON.stringify(untoggled));

// 날짜는 업무 날짜와 같은 DatePicker다 — 네이티브 date 입력이 아니다
await ev(`document.querySelector('.club-meet-new-open').click()`); await sleep(350);
check('모임 날짜는 네이티브 date 입력이 아니다',
  (await ev(`!document.querySelector('.club-meet-new input[type="date"]') && !!document.querySelector('.club-meet-date button')`)) === true);

// 한 줄짜리 컴팩트 생성기 — 채울 것은 제목(선택) 하나뿐이라 날짜·제목·버튼이 같은
// 줄에 서고 오늘 날짜가 이미 채워져 있다(사용자 지적 2026-09-02 — 세 줄로 줄바꿈됐다).
const meetDesk = await meetRows();
check('모임 생성기는 데스크톱에서 한 줄이다', meetDesk.rows === 1, JSON.stringify(meetDesk));
check('모임 날짜는 오늘이 미리 채워져 있다',
  typeof meetDesk.date === 'string' && meetDesk.date.startsWith(TODAY_LABEL), `${meetDesk.date} ← ${TODAY_LABEL}`);
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await sleep(450);
const meetMob = await meetRows();
check('모바일 375px — 모임 생성기는 최대 두 줄이고 넘치지 않는다',
  meetMob.rows <= 2 && meetMob.over <= 0, JSON.stringify(meetMob));
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(450);

// 생성기 카드의 등장 transform이 쌓임 맥락을 만들어서, 안의 날짜 패널이 아래 모임
// 카드에 덮인 적이 있다(예배 화면에서 먼저 발견 — 생성기에 relative z-20을 준다).
await ev(`document.querySelector('.club-meet-date button').click()`); await sleep(300);
const datePop = await uncovered('.club-meet-new [data-datepicker]');
check('날짜 패널이 아래 카드에 덮이지 않는다', datePop === 'ok', datePop);
await ev(`document.querySelector('.club-meet-date button').click()`); await sleep(250);

check('모임 날짜를 달력에서 고른다', (await pickDate('.club-meet-date', Y, 9, 8)) === 'ok');
await setText('input[aria-label="모임 제목"]', '9월 첫 모임');
await sleep(200);
await ev(`${byText('만들기')}.click()`); await sleep(900);
const madeMeet = await ev(`(() => ({
  rows: [...document.querySelectorAll('.club-meeting')].map(m => m.innerText.split('\\n')[0]),
  stored: ${store('group_meetings')}.length,
  date: ${store('group_meetings')}.map(m => m.meeting_date).sort().join(','),
}))()`);
check('모임을 만들면 최신 날짜가 위로 온다',
  madeMeet.rows.length === 2 && madeMeet.rows[0].includes('9월 8일') && madeMeet.stored === 2, JSON.stringify(madeMeet));
check('고른 날짜 그대로 저장된다', madeMeet.date === `${Y}-08-25,${Y}-09-08`, madeMeet.date);

await ev(`document.querySelector('.club-accept').click()`); await sleep(1000);
const accepted = await ev(`(() => ({
  apps: document.querySelectorAll('.club-app-row').length,
  members: [...document.querySelectorAll('.club-member')].map(m => m.textContent.trim().replace(/\\s+/g, '')),
  joined: ${store('group_members')}.some(m => m.group_id === 'gc1' && m.person_id === 'p1'),
  status: ${store('club_applications')}.find(a => a.id === 'a1').status,
}))()`);
check('가입 신청을 수락하면 그 자리에서 동아리 명단에 들어간다',
  accepted.joined === true && accepted.members.length === 3 && accepted.apps === 0, JSON.stringify(accepted));
// 동아리 구성원도 **동아리장 먼저, 나머지 가나다순**이다(들어온 차례가 아니다)
check('동아리 구성원은 동아리장 먼저 · 나머지 ㄱㄴㄷ',
  accepted.members[0].includes('노준석') && accepted.members[0].includes('동아리장')
  && accepted.members[1].includes('김윤주') && accepted.members[2].includes('천진영'),
  JSON.stringify(accepted.members));
check('수락한 신청은 대기에서 빠진다', accepted.status === 'accepted', accepted.status);

// 멤버 추가 — 그 동아리장(또는 마스터)만. 가입 신청을 기다리지 않고 여기서 바로 넣는다.
const headText = `[...document.querySelectorAll('.club-detail *')]
  .map(e => e.textContent.trim()).find(t => /^구성원 \\d+명$/.test(t)) || ''`;
const beforeAdd = await ev(`(() => ({
  head: ${headText},
  members: document.querySelectorAll('.club-member').length,
  pick: !!document.querySelector('.club-add'),
}))()`);
check('동아리장에게 멤버 추가 칸이 선다', beforeAdd.pick === true);
check("'명단은 동아리장이 채운다' 문구는 화면에 없다",
  (await ev(`document.querySelector('.groups-screen').innerText.includes('명단은 동아리장이')`)) === false);
const addable = await pickOptions('통통 멤버 추가');
check('멤버 추가 후보에서 이미 든 사람은 빠진다',
  Array.isArray(addable) && !addable.includes('천진영') && addable.includes('양민혁'), JSON.stringify(addable));
check('멤버 추가 후보도 가나다순',
  Array.isArray(addable) && JSON.stringify(addable) === JSON.stringify([...addable].sort((a, b) => a.localeCompare(b, 'ko'))),
  JSON.stringify(addable));
check('멤버를 고르면 명단에 들어간다', (await pickPerson('통통 멤버 추가', '양민혁')) === 'ok');
await sleep(900);
const afterAdd = await ev(`(() => ({
  head: ${headText},
  members: document.querySelectorAll('.club-member').length,
  stored: ${store('group_members')}.some(m => m.group_id === 'gc1' && m.person_id === 'p8'),
}))()`);
check('구성원 수가 추가에 맞춰 그 자리에서 늘어난다',
  afterAdd.members === beforeAdd.members + 1 && afterAdd.head === `구성원 ${beforeAdd.members + 1}명`
  && afterAdd.stored === true, `${beforeAdd.head} → ${afterAdd.head}`);

// 아이콘이 든 버튼 전수 점검 — 리더 도구가 다 서 있는 이 화면에서 한 번
const clubBtns = await ev(ICON_AUDIT);
check('동아리 화면의 아이콘 버튼 정렬(잉크 상자 기준)', clubBtns.length === 0, clubBtns.join(' / '));

// 이름·설명 고치기 — 그 동아리장도 한다(0039 groups_update). 이 검사를 마지막에 두는
// 이유: 이름을 바꾸면 뒤따르는 조작의 aria-label('통통 멤버 추가')이 달라진다.
check('동아리장에게 이름 고치기 연필이 선다', (await ev(`!!document.querySelector('.club-edit')`)) === true);
await ev(`document.querySelector('.club-edit').click()`); await sleep(350);
const editRow = await ev(`(() => {
  const box = document.querySelector('.club-edit-form');
  if (!box) return { err: 'no-form' };
  const parts = [...box.querySelectorAll('input, button')];
  const mids = parts.map(p => { const r = p.getBoundingClientRect(); return (r.top + r.bottom) / 2; });
  return { rows: mids.reduce((a, y) => (a.some(v => Math.abs(v - y) < 6) ? a : [...a, y]), []).length,
    name: box.querySelector('input[aria-label="동아리 이름 고치기"]')?.value,
    note: box.querySelector('input[aria-label="동아리 설명 고치기"]')?.value };
})()`);
check('연필을 누르면 지금 값이 담긴 칸이 그 자리에 한 줄로 열린다',
  editRow.rows === 1 && editRow.name === '통통' && editRow.note === '통기타 동아리', JSON.stringify(editRow));
await setText('input[aria-label="동아리 이름 고치기"]', '통통기타');
await setText('input[aria-label="동아리 설명 고치기"]', '통기타 치는 사람들');
await ev(`document.querySelector('.club-edit-save').click()`); await sleep(1100);
const edited = await ev(`(() => {
  const g = ${store('groups')}.find(x => x.id === 'gc1');
  return { title: document.querySelector('.club-title')?.textContent.trim() || '',
    form: !!document.querySelector('.club-edit-form'),
    stored: [g?.name, g?.note] };
})()`);
check('동아리장이 이름·설명을 고치면 그대로 남는다',
  edited.title === '통통기타' && edited.form === false
  && JSON.stringify(edited.stored) === '["통통기타","통기타 치는 사람들"]', JSON.stringify(edited));

await ev(`${byText('목록으로')}.click()`); await sleep(600);
await openClub('말씀읽기'); await sleep(700);
check('남의 동아리에서는 멤버 추가 칸도 없다',
  (await ev(`!!document.querySelector('.club-add')`)) === false);
check('남의 동아리에서는 리더 도구가 서지 않는다',
  (await ev(`!!document.querySelector('.club-leader-tools')`)) === false);
check('동아리장이어도 순 편성 탭은 없다',
  (await ev(`[...document.querySelectorAll('.groups-tab')].map(t => t.textContent.trim()).join(',')`)) === '내 순,동아리');

// ── 3-1) 가입 신청 QR (components/ClubQr.jsx) ───────────────────────────────
// 여는 사람은 **그 동아리를 고칠 수 있는 사람**이다(canEditClub — 마스터·관리자·그
// 동아리장). p6은 통통의 동아리장이고 말씀읽기에는 아무 자격이 없다.
await enter({ personId: 'p6', isMaster: false, isAdmin: false, roles: [] });
await tab('동아리'); await sleep(700);
await openClub('말씀읽기'); await sleep(700);
check('남의 동아리에는 신청 QR 버튼이 없다',
  (await ev(`!!document.querySelector('.club-qr-open')`)) === false);
await ev(`${byText('목록으로')}.click()`); await sleep(600);
await openClub('통통'); await sleep(700);
check('내 동아리에는 신청 QR 버튼이 선다',
  (await ev(`!!document.querySelector('.club-qr-open')`)) === true);
await ev(`document.querySelector('.club-qr-open').click()`); await sleep(1500);
// QR 모듈은 path 하나에 담는다(rect 수백 개 대신) — 'M'의 수가 곧 검은 모듈 수다.
const qr = await ev(`(() => {
  const card = document.querySelector('.club-qr-card');
  if (!card) return { err: 'no-card' };
  const d = card.querySelector('path')?.getAttribute('d') || '';
  const r = card.getBoundingClientRect();
  return {
    texts: [...card.querySelectorAll('text')].map(t => t.textContent.trim()),
    modules: d.split('M').length - 1,
    w: Math.round(r.width),
    tools: [...document.querySelectorAll('.club-qr-tools button')].map(b => b.textContent.trim()),
  };
})()`);
check('QR 카드에 동아리 이름 · 라벨 · 모듈이 그려진다',
  !qr.err && qr.texts[0] === '통통' && qr.texts[1] === '가입 신청 QR'
  && qr.modules > 60 && qr.w >= 200, JSON.stringify(qr));
// 상시 도구 줄 — 확정 왼쪽 / 나가기 오른쪽(§8)
// **'이미지 저장'은 걷었다**(사용자 결정 2026-09-10 — "그냥 카카오톡에 공유 버튼만
// 남겨줘 차라리"). 내려받기가 막힌 폰에서 그 버튼은 공유 시트를 여는 것으로 끝나서
// 왼쪽 버튼과 같은 일을 두 번 하는 자리였다 — 저장은 그 시트 안에 있다.
check('QR 창의 버튼 차례는 공유 · 복사 … 닫기',
  JSON.stringify(qr.tools) === '["카카오톡으로 공유","링크 복사","닫기"]', JSON.stringify(qr.tools));
await ev(`document.querySelector('.club-qr-close').click()`); await sleep(400);
check('닫기를 누르면 QR 창이 사라진다',
  (await ev(`!!document.querySelector('.club-qr-card')`)) === false);

// **QR 카드는 다크에서도 밝다.** 어두운 종이에 밝은 모듈로 그리면 반전 코드가 되어
// 못 읽는 리더가 많다. 카드를 감싸는 창은 여느 화면처럼 테마를 따라간다.
await enter({ personId: 'p6', isMaster: false, isAdmin: false, roles: [] }, 'dark');
await tab('동아리'); await sleep(700);
await openClub('통통'); await sleep(700);
await ev(`document.querySelector('.club-qr-open').click()`); await sleep(1500);
const qrDark = await ev(`(() => {
  const card = document.querySelector('.club-qr-card');
  if (!card) return { err: 'no-card' };
  return { paper: getComputedStyle(card.querySelector('rect')).fill,
    mod: getComputedStyle(card.querySelector('path')).fill,
    box: getComputedStyle(document.querySelector('.club-qr')).backgroundColor };
})()`);
check('다크에서도 QR 종이는 흰색 · 모듈은 진한 남색(반전 코드가 되지 않게)',
  !qrDark.err && qrDark.paper === 'rgb(255, 255, 255)' && qrDark.mod === 'rgb(33, 49, 131)'
  && qrDark.box !== 'rgb(255, 255, 255)', JSON.stringify(qrDark));

// ── 3-2) QR·알림으로 들어온 자리 (딥링크 `?p=groups&g=…&apply=1`) ───────────
// QR을 찍으면 /s/c/<id>?apply=1 → (로그인) → 이 주소다. 화면은 그 동아리 상세를 열고
// 신청까지 한 뒤 '동아리 신청이 완료되었어요!'라고 말한다(사용자 문구).
// 이미 구성원이거나 이미 신청했으면 다시 넣지 않고 그 사정을 말한다.
const enterLink = async (me, query) => {
  await ev(plant(me));
  await send('Page.navigate', { url: `${URL_BASE}/${query}` });
  await wait('Page.loadEventFired');
  await sleep(1500);
  for (let i = 0; i < 25; i++) {
    if (await ev(`!!document.querySelector('.groups-screen')`)) return true;
    await sleep(300);
  }
  return false;
};
// 상세가 실제로 설 때까지 기다렸다 읽는다 — 정해진 시간만 쉬면 dev 서버가 느린 판에서
// 아무것도 없는 화면을 읽고 넘어진다(enter()와 같은 이유).
const readLink = (groupId, personId) => ev(`(() => ({
  title: document.querySelector('.club-title')?.textContent.trim() || '',
  waiting: !!document.querySelector('.club-waiting'),
  toast: (document.querySelector('[data-toast]') || {}).innerText || '',
  stored: ${store('club_applications')}.filter(a => a.group_id === ${JSON.stringify(groupId)}
    && a.person_id === ${JSON.stringify(personId)}).length,
}))()`);
const linkState = async (groupId, personId) => {
  for (let i = 0; i < 24; i++) {
    if ((await readLink(groupId, personId)).title) break;
    await sleep(250);
  }
  await sleep(500);   // 신청 한 번과 토스트가 그 뒤에 온다
  return readLink(groupId, personId);
};
const P1 = { personId: 'p1', isMaster: false, isAdmin: false, roles: [] };

// p1은 서부버튼(gc3)의 구성원도 아니고 신청해 둔 것도 없다 — 새로 들어가는 갈래다
check('딥링크로 모임 화면이 바로 열린다', await enterLink(P1, '?p=groups&g=gc3&apply=1'));
const qrApplied = await linkState('gc3', 'p1');
check('QR을 찍고 들어오면 그 동아리 상세가 열리고 신청이 들어간다',
  qrApplied.title === '서부버튼' && qrApplied.stored === 1 && qrApplied.waiting === true, JSON.stringify(qrApplied));
check("신청이 끝나면 '동아리 신청이 완료되었어요!'",
  qrApplied.toast === '동아리 신청이 완료되었어요!', qrApplied.toast);

// 그리고 그 신청은 **동아리장의 '가입 신청' 목록에 선다**(사용자 보고 2026-09-08 —
// "동아리 페이지까지 이동은 되는데 가입 신청 목록에는 들어가지 않는다"). 방금 만든
// 신청을 그대로 둔 채 시드의 me만 서부버튼 동아리장(p5)으로 바꿔 다시 들어간다 —
// plant를 다시 부르면 저 신청이 씻겨 나간다.
await ev(`(() => {
  const g = JSON.parse(localStorage.getItem('church_groups_v1'));
  g.me = { personId: 'p5', isMaster: false, isAdmin: false, roles: [] };
  localStorage.setItem('church_groups_v1', JSON.stringify(g));
  return g.club_applications.length;
})()`);
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired'); await sleep(1200);
for (let i = 0; i < 20; i++) {
  await ev(GO);
  await sleep(i ? 300 : 1200);
  if (await ev(`!!document.querySelector('.groups-screen')`)) break;
}
await tab('동아리'); await sleep(600);
await openClub('서부버튼'); await sleep(800);
const leaderSees = await ev(`(() => ({
  rows: [...document.querySelectorAll('.club-app-row')].map(r => r.textContent.trim()),
  head: [...document.querySelectorAll('.club-leader-tools *')]
    .filter(e => e.children.length === 0 && e.textContent.trim().startsWith('가입 신청'))
    .map(e => e.textContent.trim())[0] || '',
}))()`);
check('QR로 들어온 신청이 동아리장의 가입 신청 목록에 선다',
  leaderSees.rows.length === 1 && leaderSees.rows[0].includes('김윤주')
  && leaderSees.head === '가입 신청 1건', JSON.stringify(leaderSees));

// 판정 순서 — 상세는 **한 벌이 오는 즉시** 열고, 신청은 **새로 읽은 한 벌**을 기다린다.
// 게스트에서는 한 벌이 언제나 한 번에·즉시 오므로("캐시로 먼저 그린 옛 perms" 조건을
// 만들 수 없다) 이 순서는 소스로 못 박는다(useSettled 검사와 같은 방식).
// 되돌리기 확인: `if (!bundleFresh && …) return;` 한 줄을 지우면 이 검사가 깨진다.
{
  const src = readFileSync(new URL('../src/views/groupsView.jsx', import.meta.url), 'utf8');
  const from = src.indexOf('const bundleFresh');
  const view = from > 0 ? src.slice(from) : '';
  const opens = view.indexOf('setOpenClubId(club.id)');
  const guard = view.indexOf('if (!bundleFresh &&');
  const consume = view.indexOf('setEntry(null)');
  check('딥링크 — 상세는 먼저 열고, 신청 판정은 새로 읽은 한 벌을 기다린다',
    from > 0 && opens > 0 && guard > opens && consume > guard,
    JSON.stringify({ opens, guard, consume }));
  const home = readFileSync(new URL('../src/views/homeView.jsx', import.meta.url), 'utf8');
  // 한 줄로 묶여 있던 것을 홈이 지역 변수(withAtt)로 나눴다(2026-09-09) — 값은 같다.
  // 그래서 **두 조각을 따로** 본다: 기준은 attendanceSunday, 없을 때만 pastSunday.
  check('홈도 같은 규칙으로 참석 수를 센다(출석이 들어온 주일 · 없으면 지난 주일)',
    /attendanceSunday\(list, counts, day\)/.test(home) && /\|\| pastSunday\(list, day\)/.test(home));

  // **비우는 캐시와 다시 읽는 캐시가 같아야 한다.** `dropCache('groups')`는 글자 비교라
  // 순모임 가이드(`groups:guide:<주보 id>`)까지 가져가는데 이 화면이 다시 읽는 것은 셋뿐이라,
  // 동아리에서 사람 하나 넣을 때마다 가이드가 다음 진입에서 스켈레톤부터 다시 떴다.
  // 게스트는 메모리 캐시라 이 어긋남을 화면으로 못 본다 — 소스로 못 박는다(§6-9-ad와 같은 방식).
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  check("쓰기 뒤에 비우는 캐시는 다시 읽는 셋뿐이다(가이드까지 가져가지 않는다)",
    /GROUP_KEYS\s*=\s*\['groups:all', 'groups:roster', 'groups:mine'\]/.test(code)
    && /GROUP_KEYS\.forEach\(dropCache\)/.test(code)
    && !/dropCache\('groups'\)/.test(code));

  // 자격(fetchGroupPerms)과 한 벌(fetchGroupsRoster)은 나란히 도는데 둘 다 동아리 목록과
  // 그 해 직분을 읽는다 — 묶지 않으면 진입 한 번에 같은 질의가 두 번씩 나간다(모임·홈 둘 다).
  // 게스트에는 supabase가 없어 그 길이 돌지 않으므로 소스로 본다.
  const svc = readFileSync(new URL('../src/services/groups.js', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '');
  check('동아리·직분 조회는 한 틱에 한 번만 나간다(자격과 한 벌이 나눠 쓴다)',
    /function share\(key, run\)/.test(svc) && /return share\('clubs',/.test(svc)
    && (svc.match(/yearRoles\(year\)/g) || []).length >= 2
    && !/fetchRoles\(year\), fetchClubs\(\)/.test(svc));
}

// 이미 구성원(말씀읽기 gc2에 p1이 있다) — 신청을 만들지 않는다
await enterLink(P1, '?p=groups&g=gc2&apply=1');
const already = await linkState('gc2', 'p1');
check('이미 그 동아리에 있으면 신청하지 않고 알려 준다',
  already.title === '말씀읽기' && already.stored === 0 && already.toast === '이미 이 동아리에 있어요',
  JSON.stringify(already));

// 이미 신청해 둔 동아리(통통 gc1에 a1이 있다) — 두 번째 신청을 만들지 않는다
await enterLink(P1, '?p=groups&g=gc1&apply=1');
const dup = await linkState('gc1', 'p1');
check('이미 신청한 동아리면 한 번 더 넣지 않는다',
  dup.title === '통통' && dup.stored === 1 && dup.toast === '이미 신청했어요', JSON.stringify(dup));

// apply가 없으면 상세만 연다
await enterLink(P1, '?p=groups&g=gc3');
const onlyOpen = await linkState('gc3', 'p1');
check('apply가 없으면 상세만 열고 신청하지 않는다',
  onlyOpen.title === '서부버튼' && onlyOpen.stored === 0 && onlyOpen.toast === '', JSON.stringify(onlyOpen));

// 명단에 이어지지 않은 계정 — 신청할 사람(person)이 없다(0035 club_applications RLS와 같은 자리)
await enterLink({ personId: null, isMaster: false, isAdmin: false, roles: [] }, '?p=groups&g=gc3&apply=1');
const orphanLink = await linkState('gc3', 'p1');
check('명단에 이어지지 않은 계정에는 못 한 이유를 말한다',
  orphanLink.title === '서부버튼' && orphanLink.stored === 0
  && orphanLink.toast.includes('가입 신청을 못 했어요')
  && orphanLink.toast.includes('청년 명단과 계정이 아직 연결되지 않았어요'), JSON.stringify(orphanLink));

// ── 4) 마스터 ───────────────────────────────────────────────────────────────
await enter({ personId: 'p6', isMaster: true, roles: [] });
await tab('동아리'); await sleep(700);
check('마스터에게만 새 동아리 버튼', (await ev(`!!document.querySelector('.club-new-open')`)) === true);
await openClub('말씀읽기'); await sleep(700);
check('마스터는 남의 동아리도 관리한다',
  (await ev(`!!document.querySelector('.club-leader-tools')`)) === true);
check('마스터는 남의 동아리 이름도 고친다', (await ev(`!!document.querySelector('.club-edit')`)) === true);
await ev(`${byText('목록으로')}.click()`); await sleep(600);
await ev(`document.querySelector('.club-new-open').click()`); await sleep(450);
// 만들기 카드 — 라벨 붙은 칸 셋, 꼭 채울 둘이 한 행, 설명은 그 아래 한 행,
// 이름에 포커스(사용자 지적 2026-09-03 "+ 새 동아리가 별로 좋지 않다").
const clubNew = await ev(`(() => {
  const box = document.querySelector('.club-new');
  if (!box) return { err: 'no-form' };
  const name = box.querySelector('input[aria-label="동아리 이름"]');
  const leader = box.querySelector('input[aria-label="동아리장"]');
  const note = box.querySelector('input[aria-label="동아리 설명"]');
  if (!name || !leader || !note) return { err: '칸 없음' };
  const mid = (e) => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
  return {
    labels: [...box.querySelectorAll('.labeled-field > span')].map(x => x.textContent.trim()),
    sameRow: Math.abs(mid(name) - mid(leader)) < 6,
    noteBelow: mid(note) > mid(name) + 6,
    focused: document.activeElement === name,
  };
})()`);
check('새 동아리는 라벨 붙은 칸으로, 이름과 동아리장이 한 행에 선다',
  JSON.stringify(clubNew.labels) === '["동아리 이름","동아리장","설명 (선택)"]'
  && clubNew.sameRow === true && clubNew.noteBelow === true, JSON.stringify(clubNew));
check('새 동아리 카드는 이름 칸에 포커스를 두고 열린다', clubNew.focused === true, JSON.stringify(clubNew));
const mobClubNew = await (async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  const r = await rowsOf('.club-new', ['input[aria-label="동아리 이름"]', 'input[aria-label="동아리장"]',
    'input[aria-label="동아리 설명"]', ':scope > div:last-child > button']);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  return r;
})();
check('모바일 375px — 새 동아리 카드는 칸마다 한 줄 + 도구 줄, 넘치지 않는다',
  !mobClubNew.err && mobClubNew.rows <= 4 && mobClubNew.over <= 0, JSON.stringify(mobClubNew));
// 같은 이름은 저장하러 가기 전에 막는다(0041) — 이름 칸만 채워 눌러 본다
await setText('input[aria-label="동아리 이름"]', '통통');
await sleep(150);
await ev(`document.querySelector('.club-new-make').click()`); await sleep(900);
const clubDup = await ev(`(() => ({
  toast: (document.querySelector('[data-toast]') || {}).innerText || '',
  count: ${store('groups')}.filter(g => g.type === 'club' && g.name === '통통').length,
  open: !!document.querySelector('.club-new'),
}))()`);
check('같은 이름의 동아리는 만들어지지 않고 왜인지 말한다',
  clubDup.count === 1 && clubDup.open === true
  && clubDup.toast.includes('동아리를 만들지 못했어요')
  && clubDup.toast.includes('같은 이름의 동아리가 이미 있어요'), JSON.stringify(clubDup));

await setText('input[aria-label="동아리 이름"]', '달리기');
await setText('input[aria-label="동아리 설명"]', '토요일 아침 러닝');
check('동아리장은 자동완성 피커로 고른다', (await pickPerson('동아리장', '조해리')) === 'ok');
await sleep(200);
// Enter로도 만들어진다(프로젝트 만들기 창과 같은 손버릇)
await ev(`(() => { const i = document.querySelector('input[aria-label="동아리 이름"]');
  i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
await sleep(1100);
const madeClub = await ev(`(() => {
  const g = ${store('groups')}.find(x => x.name === '달리기');
  return { made: !!g, leader: g?.leader_person_id,
    member: ${store('group_members')}.some(m => m.group_id === g?.id && m.person_id === 'p7'),
    cards: document.querySelectorAll('.club-card').length };
})()`);
check('마스터가 동아리를 만들고 동아리장을 정한다',
  madeClub.made === true && madeClub.leader === 'p7' && madeClub.cards === 4, JSON.stringify(madeClub));
check('동아리장은 그 동아리의 구성원으로도 들어간다', madeClub.member === true);

// 아직 아무 모임도 안 잡힌 동아리 — 문구는 '예정된 모임이 아직 없어요'(사용자 지시)
await openClub('달리기'); await sleep(800);
const emptyMeet = await ev(`document.querySelector('.club-meet-empty')?.textContent.trim() || ''`);
check('모임이 없을 때 문구', emptyMeet === '예정된 모임이 아직 없어요', emptyMeet);
// 이 자리는 카드 아래에 딸린 구역이라 세로를 줄여 잡는다(minH 28vh) — 화면 한 판이 아니다
const meetEmpty = await centered('.club-meet-empty');
isCentered('예정된 모임이 없는 자리', meetEmpty, 140);
const appEmpty = await centered('.club-app-empty');
isCentered('가입 신청이 없는 자리', appEmpty, 120);
await ev(`${byText('목록으로')}.click()`); await sleep(500);

// ── 5) 순 편성 (리더순장 — 마스터가 아니다) ─────────────────────────────────
await enter({ personId: 'p3', isMaster: false, roles: ['lead_sunjang'] });
const tabs = await ev(`[...document.querySelectorAll('.groups-tab')].map(t => t.textContent.trim())`);
check('리더순장에게는 순 편성 탭이 보인다', JSON.stringify(tabs) === '["내 순","동아리","순 편성"]', JSON.stringify(tabs));
await tab('순 편성'); await sleep(800);
const admin = await ev(`(() => ({
  open: !!document.querySelector('.sun-admin'),
  year: document.querySelector('.sun-year button')?.textContent.trim(),
  rows: [...document.querySelectorAll('.sun-row')].map(r => r.querySelector('.sun-name').value),
  members: [...document.querySelectorAll('.sun-row')].map(r => r.querySelectorAll('.sun-member').length),
}))()`);
const adminYears = await yearOpen();
const adminAdd = await pickOptions('꼬순 순원 추가');
check('순 편성 구역이 열리고 기본은 올해', admin.open === true && admin.year === String(Y), `${admin.year}`);
check('지난 편성이 있는 해도 고를 수 있다', adminYears.includes(`${Y - 1}년`), JSON.stringify(adminYears));
check('올해 순만 줄로 선다', JSON.stringify(admin.rows) === '["꼬순","TT순"]', JSON.stringify(admin.rows));
check('순별 구성원 수', JSON.stringify(admin.members) === '[3,3]', JSON.stringify(admin.members));
const sunShown = await ev(`(() => {
  const rows = [...document.querySelectorAll('.sun-row')];
  const tt = rows.find(r => r.querySelector('.sun-name').value === 'TT순');
  return { members: [...tt.querySelectorAll('.sun-member')].map(m => m.textContent.trim()),
    move: !!document.querySelector('[aria-label="말감이 순 옮기기"]'),
    roster: document.querySelector('.sun-admin').innerText.includes('임재훈') };
})()`);
check('순 편성의 구성원·조작 라벨도 표시명을 쓴다',
  sunShown.members.some(m => m.includes('말감이')) && sunShown.move === true
  && sunShown.roster === false, JSON.stringify(sunShown));
// 후보 목록은 명단이 온 차례가 아니라 **전부 가나다순**이다(사용자 지시 2026-09-02)
check('순원 추가 후보는 어느 순에도 없는 사람뿐, 그리고 가나다순',
  JSON.stringify(adminAdd) === '["양민혁","조해리"]', JSON.stringify(adminAdd));
const leaderRow = await ev(`(() => {
  const rows = [...document.querySelectorAll('.sun-row')[0].querySelectorAll('.sun-member')];
  return rows.map(r => [r.textContent.includes('순장'), !!r.querySelector('.sun-move'), !!r.querySelector('.sun-drop')]);
})()`);
check('순장은 옮기기·빼기 대상이 아니다(순장 칸에서 바꾼다)',
  JSON.stringify(leaderRow[0]) === '[true,false,false]' && JSON.stringify(leaderRow[1]) === '[false,true,true]',
  JSON.stringify(leaderRow));

// 화살표는 눌리는 것이어야 한다 — 예전에는 그냥 놓인 아이콘이라 눌러도 아무 일이 없었다
// (사용자 지적 2026-09-02). 빈 입력으로 명단 전체가 열린다.
const chevron = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const btn = document.querySelector('.sun-leader-pick .person-pick-toggle');
  if (!btn) return 'no-btn';
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await w(300);
  const n = document.querySelectorAll('.person-pick-option').length;
  const expanded = btn.getAttribute('aria-expanded');
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await w(200);
  return n + '/' + expanded;
})()`, true);
check('순장 칸의 화살표를 누르면 명단 전체가 열린다', chevron === '8/true', String(chevron));

check('순원 추가는 이름을 쳐서 고른다', (await pickPerson('꼬순 순원 추가', '조해리')) === 'ok');
await sleep(1000);
const added = await ev(`(() => ({
  count: document.querySelectorAll('.sun-row')[0].querySelectorAll('.sun-member').length,
  stored: ${store('group_members')}.some(m => m.group_id === 'g1' && m.person_id === 'p7'),
}))()`);
const addedLeft = await pickOptions('꼬순 순원 추가');
check('순원을 넣으면 그 줄과 후보 목록이 같이 움직인다',
  added.count === 4 && added.stored === true && JSON.stringify(addedLeft) === '["양민혁"]',
  `${JSON.stringify(added)} ${JSON.stringify(addedLeft)}`);

check('순 옮기기도 우리 목록으로 고른다', (await pickMenu('조해리 순 옮기기', 'TT순')) === 'ok');
await sleep(1000);
const moved = await ev(`(() => ({
  counts: [...document.querySelectorAll('.sun-row')].map(r => r.querySelectorAll('.sun-member').length),
  from: ${store('group_members')}.some(m => m.group_id === 'g1' && m.person_id === 'p7'),
  to: ${store('group_members')}.some(m => m.group_id === 'g2' && m.person_id === 'p7'),
}))()`);
check('순을 옮기면 한쪽에서 빠지고 다른 쪽에 붙는다',
  JSON.stringify(moved.counts) === '[3,4]' && moved.from === false && moved.to === true, JSON.stringify(moved));

await ev(`document.querySelector('[aria-label="조해리 빼기"]').click()`); await sleep(400);
await ev(`${byText('빼기')}.click()`); await sleep(1000);
const dropped = await ev(`(() => ({
  counts: [...document.querySelectorAll('.sun-row')].map(r => r.querySelectorAll('.sun-member').length),
  stored: ${store('group_members')}.some(m => m.group_id === 'g2' && m.person_id === 'p7'),
}))()`);
check('빼기는 확인을 거쳐 지운다', JSON.stringify(dropped.counts) === '[3,3]' && dropped.stored === false, JSON.stringify(dropped));

// ── 5-0) 순장 지정 네 갈래 (사용자 지적 2026-09-03) ────────────────────────
// "순장을 다른 사람으로 바꿨는데 '순장을 정하지 못했어요'라고 하면서 실제로는 이미
// 바뀌어 있다." 지금은 저장하러 가기 전에 판정하고, 되는 경우에는 토스트도 성공이다.
// 이 자리의 편성: 꼬순 = 김윤주(순장)·천진영·김승찬 / TT순 = 노준석(순장)·배현민·말감이
const leaderOf = (id) => ev(`(${store('groups')}.find(g => g.id === ${JSON.stringify(id)}) || {}).leader_person_id || null`);
await pickPerson('꼬순 순장', '노준석'); await sleep(900);
const asLeader = { toast: await toast(), stored: await leaderOf('g1') };
check('① 다른 순의 순장은 세우지 못하고, 어느 순인지 말한다',
  asLeader.stored === 'p1' && asLeader.toast.includes('순장을 지정하지 못했어요')
  && asLeader.toast.includes('노준석님은 이미 TT순의 순장이에요'), JSON.stringify(asLeader));

await pickPerson('꼬순 순장', '배현민'); await sleep(900);
const asMember = { toast: await toast(), stored: await leaderOf('g1') };
check('③ 다른 순의 순원은 세우지 않고 먼저 옮기라고 말한다',
  asMember.stored === 'p1' && asMember.toast.includes('배현민님은 TT순 순원이라'), JSON.stringify(asMember));

await pickPerson('꼬순 순장', '천진영'); await sleep(1100);
const swapped = await ev(`(() => ({
  toast: (document.querySelector('[data-toast]') || {}).innerText || '',
  leader: (${store('groups')}.find(g => g.id === 'g1') || {}).leader_person_id,
  members: ${store('group_members')}.filter(m => m.group_id === 'g1').map(m => m.person_id).sort(),
  badge: [...document.querySelectorAll('.sun-row')[0].querySelectorAll('.sun-member')]
    .filter(r => r.textContent.includes('순장')).map(r => r.textContent.trim()),
}))()`);
check('② 이 순의 순원은 그대로 순장이 되고 실패라고 하지 않는다',
  swapped.leader === 'p2' && swapped.toast.includes('천진영님을 꼬순 순장으로 지정했어요')
  && !swapped.toast.includes('못했'), JSON.stringify(swapped));
check('순장이 바뀌어도 이전 순장은 그 순의 순원으로 남는다',
  JSON.stringify(swapped.members) === '["p1","p2","p3"]'
  && swapped.badge.length === 1 && swapped.badge[0].includes('천진영'), JSON.stringify(swapped));
// 되돌려 둔다 — 뒤따르는 검사들이 '김윤주가 순장인 꼬순'을 본다
await pickPerson('꼬순 순장', '김윤주'); await sleep(1000);
check('되돌리기도 같은 판정을 거쳐 그대로 된다', (await leaderOf('g1')) === 'p1');

// 이름은 칸을 떠날 때 저장한다 — 포커스를 실제로 줬다 뺀다(focus 없이 blur()는 아무 일도 안 한다)
await ev(`document.querySelector('input[aria-label="꼬순 순 이름"]').focus()`);
await setText('input[aria-label="꼬순 순 이름"]', '꼬순이');
await ev(`document.querySelector('input[aria-label="꼬순 순 이름"]').blur()`); await sleep(1000);
const renamed = await ev(`(() => ({
  rows: [...document.querySelectorAll('.sun-row')].map(r => r.querySelector('.sun-name').value),
  stored: ${store('groups')}.find(g => g.id === 'g1').name,
}))()`);
check('순 이름을 바꾸면 그대로 남는다',
  renamed.stored === '꼬순이' && renamed.rows[0] === '꼬순이', JSON.stringify(renamed));

// 이름 수정도 같은 확인을 거친다 — 같은 해의 다른 순 이름으로 바꾸려 하면 막힌다
await ev(`document.querySelector('input[aria-label="꼬순이 순 이름"]').focus()`);
await setText('input[aria-label="꼬순이 순 이름"]', 'TT순');
await ev(`document.querySelector('input[aria-label="꼬순이 순 이름"]').blur()`); await sleep(1000);
const renameDup = await ev(`(() => ({
  toast: (document.querySelector('[data-toast]') || {}).innerText || '',
  stored: (${store('groups')}.find(g => g.id === 'g1') || {}).name,
  shown: document.querySelector('.sun-row .sun-name')?.value,
}))()`);
check('이름 수정도 같은 이름이면 막고, 칸을 되돌린다',
  renameDup.stored === '꼬순이' && renameDup.shown === '꼬순이'
  && renameDup.toast.includes('순 이름을 바꾸지 못했어요')
  && renameDup.toast.includes(`${Y}년에 같은 이름의 순이 이미 있어요`), JSON.stringify(renameDup));

await ev(`document.querySelector('.sun-new-open').click()`); await sleep(450);
// 한 줄 생성기 — 이름과 순장이 같은 줄에 선다(사용자 지적 2026-09-03
// "쓸데없는 줄바꿈으로 나누지 말라")
const sunNewRows = await rowsOf('.sun-new',
  ['input[aria-label="새 순 이름"]', 'input[aria-label="새 순의 순장"]', ':scope > button']);
check('새 순 생성기는 데스크톱에서 한 줄이다', sunNewRows.rows === 1, JSON.stringify(sunNewRows));
const sunNewMob = await (async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  const r = await rowsOf('.sun-new',
    ['input[aria-label="새 순 이름"]', 'input[aria-label="새 순의 순장"]', ':scope > button']);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  return r;
})();
check('모바일 375px — 새 순 생성기는 최대 두 줄이고 넘치지 않는다',
  !sunNewMob.err && sunNewMob.rows <= 2 && sunNewMob.over <= 0, JSON.stringify(sunNewMob));

// 순 카드 머리줄 — [이름][순장] … [N명]이 375에서 두 줄로 접힐 때 **인원 수가 이름 줄에
// 남아야** 한다. flex-wrap에 맡겨 두었더니 순장 칸이 둘째 줄로 내려가면서 'N명'이 그
// 줄 오른쪽 끝에 붙어, 순의 인원이 아니라 순장에 딸린 숫자처럼 읽혔다(§6-9-z).
// 되돌리기 확인: order 유틸을 걷어내면 모바일 판정의 withPick이 참이 된다.
const sunHead = () => ev(`(() => {
  const row = document.querySelector('.sun-row');
  if (!row) return { err: 'no-row' };
  const mid = (s) => { const e = row.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
  const name = mid('.sun-name'), pick = mid('.sun-leader-pick'), count = mid('.sun-count');
  if (name == null || pick == null || count == null) return { err: 'no-part' };
  return { withName: Math.abs(count - name) < 6, withPick: Math.abs(count - pick) < 6,
    oneLine: Math.abs(name - pick) < 6 };
})()`);
const headDesk = await sunHead();
const headMob = await (async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  const r = await sunHead();
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  return r;
})();
check('순 카드 머리줄은 데스크톱에서 한 줄이다(이름 · 순장 · 인원)',
  !headDesk.err && headDesk.oneLine && headDesk.withName, JSON.stringify(headDesk));
check('모바일 375px — 인원 수는 순 이름 줄에 남는다(순장 칸에 딸린 숫자로 읽히지 않게)',
  !headMob.err && !headMob.oneLine && headMob.withName && !headMob.withPick, JSON.stringify(headMob));
const newSunPool = await pickOptions('새 순의 순장');
check('새 순의 순장 후보는 아직 어느 순에도 없는 사람뿐(순 편성 제외자도 빠진다)',
  JSON.stringify(newSunPool) === '["양민혁","조해리"]', JSON.stringify(newSunPool));
// 같은 해에 같은 이름은 막는다(0041) — 순은 해마다 다시 짜므로 해가 다르면 통과다.
// 꼬순은 위에서 '꼬순이'로 바뀌었으니 아직 그대로인 TT순으로 본다.
await setText('input[aria-label="새 순 이름"]', 'TT순');
await sleep(150);
await ev(`document.querySelector('.sun-new-make').click()`); await sleep(900);
const sunDup = await ev(`(() => ({
  toast: (document.querySelector('[data-toast]') || {}).innerText || '',
  count: ${store('groups')}.filter(g => g.type === 'sun' && g.name === 'TT순' && g.year === ${Y}).length,
  open: !!document.querySelector('.sun-new'),
}))()`);
check('같은 해 같은 이름의 순은 만들어지지 않고 어느 해인지 말한다',
  sunDup.count === 1 && sunDup.open === true
  && sunDup.toast.includes('순을 만들지 못했어요')
  && sunDup.toast.includes(`${Y}년에 같은 이름의 순이 이미 있어요`), JSON.stringify(sunDup));

await setText('input[aria-label="새 순 이름"]', '새싹순');
check('새 순의 순장도 자동완성 피커로 고른다', (await pickPerson('새 순의 순장', '양민혁')) === 'ok');
await sleep(200);
await ev(`${byText('만들기')}.click()`); await sleep(1100);
const madeSun = await ev(`(() => {
  const g = ${store('groups')}.find(x => x.name === '새싹순');
  return { made: !!g, year: g?.year, leader: g?.leader_person_id,
    member: ${store('group_members')}.some(m => m.group_id === g?.id && m.person_id === 'p8'),
    rows: document.querySelectorAll('.sun-row').length };
})()`);
check('새 순은 고른 해로 만들어진다', madeSun.made === true && madeSun.year === Y && madeSun.rows === 3, JSON.stringify(madeSun));
check('순장을 정하면 그 순의 구성원으로도 들어간다', madeSun.leader === 'p8' && madeSun.member === true, JSON.stringify(madeSun));

// ── 5-1) 팝오버는 카드 밖으로 온전히 보인다(잘림 0) ─────────────────────────
// 순이 셋이라 맨 위 줄 아래에 카드가 두 장 있다 — 목록은 그 위로 나와야 한다.
await ev(`(() => { const i = document.querySelector('input[aria-label="꼬순이 순원 추가"]');
  i.scrollIntoView({ block: 'center' }); i.focus(); })()`);
await sleep(450);
const addPop = await uncovered('.person-pick-menu');
check('순원 추가 목록이 아래 순 카드에 잘리지 않는다', addPop === 'ok', addPop);
await ev(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(300);

await ev(`(() => { const b = document.querySelector('[aria-label="천진영 순 옮기기"]');
  b.scrollIntoView({ block: 'center' }); b.click(); })()`);
await sleep(400);
const movePop = await uncovered('.menu-pick-menu');
check('순 옮기기 목록도 아래 순 카드에 잘리지 않는다', movePop === 'ok', movePop);
await ev(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(300);

// 아이콘이 든 버튼 전수 점검 — 순 편성 쪽(빼기·순 옮기기)도 같은 기준으로
const sunBtns = await ev(ICON_AUDIT);
check('순 편성 화면의 아이콘 버튼 정렬(잉크 상자 기준)', sunBtns.length === 0, sunBtns.join(' / '));

// 세 구역의 폭은 하나다 — 탭을 옮겨도 카드 왼쪽·오른쪽 선이 움직이지 않는다
const widthOf = (s) => ev(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return null;
  const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; })()`);
const wSun = await widthOf('.sun-admin');
await tab('내 순'); await sleep(600);
const wMine = await widthOf('.mysun');
await tab('동아리'); await sleep(600);
const wClub = await widthOf('.club-list');
const wMain = await widthOf('.groups-screen');
check('내 순·동아리·순 편성이 같은 폭에 선다',
  JSON.stringify(wSun) === JSON.stringify(wMine) && JSON.stringify(wSun) === JSON.stringify(wClub),
  `${JSON.stringify(wMine)} / ${JSON.stringify(wClub)} / ${JSON.stringify(wSun)}`);
check('그 폭은 대시보드 계열과 같은 화면 폭이다(따로 좁히지 않는다)',
  JSON.stringify(wSun) === JSON.stringify(wMain), `${JSON.stringify(wSun)} vs ${JSON.stringify(wMain)}`);

await tab('순 편성'); await sleep(700);

// 연도를 바꾸는 동안 **연도 고르개가 사라지지 않는다.** 예전에는 그 해 편성이 오기
// 전까지 구역째 스켈레톤으로 갈아 끼워서, 방금 누른 고르개가 통째로 없어졌다가 돌아왔다
// (게스트에서도 캐시가 없는 첫 프레임에는 그렇게 된다 — 새 키의 값은 효과 뒤에 온다).
// 되돌리기 확인: groupsView의 `adminData ? … : LOADING`으로 돌리면 gone이 1 이상이 된다.
const yearKeep = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const raf = () => new Promise(r => requestAnimationFrame(r));
  const bar = document.querySelector('.sun-year');
  if (!bar) return { err: 'no-year' };
  bar.querySelector('button').click();
  await w(250);
  const pick = [...document.querySelectorAll('button')]
    .filter(x => !document.getElementById('root').contains(x))
    .find(x => x.textContent.trim() === ${JSON.stringify(`${Y - 1}년`)});
  if (!pick) return { err: 'no-option' };
  let gone = 0, skel = 0;
  const obs = new MutationObserver(rs => rs.forEach(r => {
    r.removedNodes.forEach(n => {
      if (n.nodeType === 1 && (n.matches?.('.sun-year') || n.querySelector?.('.sun-year'))) gone += 1;
    });
    r.addedNodes.forEach(n => {
      if (n.nodeType === 1 && (n.matches?.('.sun-admin-loading') || n.querySelector?.('.sun-admin-loading'))) skel += 1;
    });
  }));
  obs.observe(document.body, { childList: true, subtree: true });
  pick.click();
  for (let i = 0; i < 20; i++) await raf();
  obs.disconnect();
  await w(600);
  return { gone, skel, year: document.querySelector('.sun-year button')?.textContent.trim() || '',
    rows: [...document.querySelectorAll('.sun-row')].map(r => r.querySelector('.sun-name').value) };
})()`, true);
check('연도를 바꿔도 연도 고르개가 사라졌다 돌아오지 않는다',
  !yearKeep.err && yearKeep.gone === 0 && yearKeep.year === String(Y - 1),
  JSON.stringify(yearKeep));
check('그 해 편성이 오는 동안은 순 목록 자리만 스켈레톤이다',
  yearKeep.skel === 1 && JSON.stringify(yearKeep.rows) === '["지난 순"]', JSON.stringify(yearKeep));

check('연도는 우리 연도 피커로 고른다', (await pickYear(Y - 1)) === 'ok');
await sleep(1000);
const lastYear = await ev(`[...document.querySelectorAll('.sun-row')].map(r => r.querySelector('.sun-name').value)`);
check('연도를 바꾸면 그 해 편성을 본다', JSON.stringify(lastYear) === '["지난 순"]', JSON.stringify(lastYear));
check('고른 해가 연도 칸에 남는다',
  (await ev(`document.querySelector('.sun-year button').textContent.trim()`)) === String(Y - 1));

// 아직 아무것도 안 짠 해 — 빈 자리는 마크와 함께 남는 공간의 가운데다(§8)
check('다음 해로 넘어간다', (await pickYear(Y + 1)) === 'ok');
await sleep(1100);
const sunEmpty = await centered('.sun-empty');
isCentered('순 편성이 빈 해', sunEmpty);
check('빈 순 편성 문구에 고른 해가 들어간다',
  sunEmpty.text === `${Y + 1}년 순 편성이 아직 비어 있어요`, sunEmpty.text);

// 다른 해에는 같은 이름의 순이 서도 된다(순은 해마다 다시 짠다 — 0041의 coalesce(year,0))
await ev(`document.querySelector('.sun-new-open').click()`); await sleep(450);
await setText('input[aria-label="새 순 이름"]', 'TT순');
await sleep(150);
await ev(`document.querySelector('.sun-new-make').click()`); await sleep(1200);
const crossYear = await ev(`(() => ({
  rows: [...document.querySelectorAll('.sun-row')].map(r => r.querySelector('.sun-name').value),
  years: ${store('groups')}.filter(g => g.type === 'sun' && g.name === 'TT순').map(g => g.year).sort(),
  toast: (document.querySelector('[data-toast]') || {}).innerText || '',
}))()`);
check('다른 해에는 같은 이름의 순을 만들 수 있다',
  JSON.stringify(crossYear.years) === JSON.stringify([Y, Y + 1])
  && JSON.stringify(crossYear.rows) === '["TT순"]' && !crossYear.toast.includes('못했'),
  JSON.stringify(crossYear));

// ── 5-2) 팝오버 첫 등장 — 위에서 떨어지지 않는다(전수) ──────────────────────
// **한 번 열었던 피커는 자리를 기억한다** — 그래서 이 구역은 새로 들어와서 각 피커를
// 딱 한 번씩만 연다. 두 번째 열기로 재면 고치기 전에도 통과한다.
await enter({ personId: 'p3', isMaster: true, roles: ['lead_sunjang'] });
await tab('순 편성'); await sleep(900);
await noJump('순장 지정 목록',
  `document.querySelector('.sun-leader-pick .person-pick-toggle').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`,
  `document.querySelector('.person-pick-menu')`);
await noJump('순원 추가 목록',
  `document.querySelector('input[aria-label="꼬순 순원 추가"]').focus()`,
  `document.querySelector('.person-pick-menu')`);
await noJump('순 옮기기 목록',
  `document.querySelector('[aria-label="천진영 순 옮기기"]').click()`,
  `document.querySelector('.menu-pick-menu')`);
// 확인 팝오버·연도 목록은 남의 파일(ConfirmPopover·layout.jsx)이라 자리만 본다 —
// 그쪽은 이미 '열기 전에 place()'라서 첫 프레임이 제자리다. 우리가 따라간 패턴이다.
await noJump('빼기 확인 팝오버', `document.querySelector('[aria-label="천진영 빼기"]').click()`, POPOVER, false);
await noJump('연도 목록', `document.querySelector('.sun-year button').click()`, POPOVER, false);
await ev(`document.querySelector('.sun-new-open').click()`); await sleep(350);
await noJump('새 순의 순장 목록',
  `document.querySelector('input[aria-label="새 순의 순장"]').focus()`,
  `document.querySelector('.person-pick-menu')`);
await ev(`${byText('취소')}.click()`); await sleep(350);

await tab('동아리'); await sleep(800);
await ev(`document.querySelector('.club-new-open').click()`); await sleep(350);
await noJump('새 동아리의 동아리장 목록',
  `document.querySelector('input[aria-label="동아리장"]').focus()`,
  `document.querySelector('.person-pick-menu')`);
await ev(`${byText('취소')}.click()`); await sleep(350);
await openClub('통통'); await sleep(800);
await noJump('멤버 추가 목록',
  `document.querySelector('input[aria-label="통통 멤버 추가"]').focus()`,
  `document.querySelector('.person-pick-menu')`);
await noJump('내보내기 확인 팝오버',
  `document.querySelector('.club-drop').click()`, POPOVER, false);

// 포털 목록이 **칸을 따라간다** (사용자 보고 2026-09-08 · 아이폰 키보드) ─────────
// "멤버 추가·순원 추가·순장 지정에서 목록이 밀려 뜬다 — 아마 키 입력 때문에."
// 칸에 포커스가 가면 iOS는 키보드를 올리며 화면을 밀어 올리고 칸의 폭도 바뀌는데, 그
// 이동에 scroll·resize가 오지 않는 경우가 있다 — 그러면 열 때 잰 자리에 목록만 남아
// 위 칸을 덮거나 옆으로 밀린다. 여기서는 그 상황을 **이벤트 없이** 흉내낸다: 칸의
// 여백과 폭을 인라인으로 바꿔 밀고 좁힌 뒤, 두 프레임 안에 목록이 다시 칸에 맞는지 본다
// (useAnchoredPos의 rAF 추적 · matchWidth).
// **재는 자리는 데스크톱 1440이다**(2026-09-09) — 터치·좁은 화면은 이제 포털을 아예
// 쓰지 않고 보통 흐름에 그리므로(아래 구역), 이 기계장치가 남아 있는 곳이 여기다.
// transform이 아니라 margin으로 미는 이유: `.dc-row`의 등장 애니메이션이 fill-mode
// both로 `transform: none`을 남기는데, 애니메이션은 인라인 스타일을 이긴다(§6-1).
// 되돌리기 확인: ConfirmPopover의 rAF 고리를 지우면 dl이 그대로 남아 이 검사가 깨진다.
await enter({ personId: 'p3', isMaster: true, roles: ['lead_sunjang'] });
await tab('순 편성'); await sleep(900);
const followed = await ev(`(async () => {
  const raf = () => new Promise(r => requestAnimationFrame(r));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const root = document.querySelector('.sun-add');
  if (!root) return { err: 'no-field' };
  const input = root.querySelector('input');
  input.blur(); await wait(60); input.focus();
  await wait(320);
  const menu = document.querySelector('.person-pick-menu');
  if (!menu) return { err: 'no-menu' };
  const read = () => {
    const a = root.getBoundingClientRect(), m = menu.getBoundingClientRect();
    return { dl: Math.round(m.left - a.left), dw: Math.round(m.width - a.width),
      below: Math.round(m.top - a.bottom), above: Math.round(a.top - m.bottom) };
  };
  const before = read();
  root.style.marginLeft = '24px';
  root.style.marginTop = '-48px';
  root.style.width = '190px';
  await raf(); await raf();
  const after = read();
  root.style.marginLeft = ''; root.style.marginTop = ''; root.style.width = '';
  await raf(); await raf();
  const back = read();
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  return { before, after, back };
})()`, true);
const fitsField = (r) => !!r && Math.abs(r.dl) <= 1 && Math.abs(r.dw) <= 1
  && (Math.abs(r.below - 4) <= 1 || Math.abs(r.above - 4) <= 1);
check('피커 목록이 칸을 따라간다(밀리고 폭이 바뀌어도 두 프레임 안에)',
  !followed.err && fitsField(followed.before) && fitsField(followed.after) && fitsField(followed.back),
  JSON.stringify(followed));
await sleep(300);

// ── 5-3) 터치·좁은 화면의 피커는 뜨지 않는다 — 칸 아래 보통 흐름이다 ────────
// 사용자 보고 2026-09-09: "동아리 멤버 추가 쪽도 키보드 상태 피커 쪽 봐줘야해..
// 순장이랑 똑같은 문제야." 2026-09-08에 visualViewport + rAF로 좌표를 고쳤는데도
// 아이폰에서는 여전히 목록이 칸에서 떨어져 있었다 — iOS 사파리는 키보드가 떠 있는
// 동안 `position: fixed`를 우리가 준 좌표에 그려 주지 않는다. 그래서 좌표를 더
// 다듬는 대신 **fixed를 쓰지 않는다**: 목록을 부품 뿌리 안, 칸 바로 아래의 보통
// 흐름에 둔다. 자리는 브라우저가 잡고, 아래 내용은 덮이지 않고 밀린다.
// **입력칸이 있는 피커(PersonPick)만** 이 규칙이다 — 짧은 목록(MenuPick · 순 옮기기 ·
// 주보 고르개)은 2026-09-09에 다시 **떠서** 나오게 했다(아래 flowMenu 주석).
// 되돌리기 확인: PersonPick의 openMenu에서 `isTouchNarrow()`를 `false`로 두면
// 아래 셋이 한꺼번에 깨진다(목록이 다시 body 포털로 나간다).
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await enter({ personId: 'p3', isMaster: true, roles: ['lead_sunjang'] });
await tab('순 편성'); await sleep(900);
// 칸 상자(FIELD)는 뿌리의 첫 자식이고 목록은 그 다음이다. 아래 카드가 얼마나 밀렸는지는
// **칸 아래 ~ 다음 카드 위**로 잰다 — 화면이 스크롤돼도 흔들리지 않는 값이다
// (여는 순간 rootRef.scrollIntoView가 한 번 돈다).
const flowPick = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const root = document.querySelector('.sun-add');
  const rows = [...document.querySelectorAll('.sun-row')];
  if (!root || rows.length < 2) return { err: 'no-field' };
  const field = root.firstElementChild;
  const gapToNext = () => Math.round(rows[1].getBoundingClientRect().top - field.getBoundingClientRect().bottom);
  const shut = gapToNext();
  const input = root.querySelector('input');
  input.blur(); await w(60); input.focus();
  await w(420);
  const menu = document.querySelector('.person-pick-menu');
  if (!menu) return { err: 'no-menu' };
  const f = field.getBoundingClientRect(), m = menu.getBoundingClientRect();
  const out = {
    inRoot: root.contains(menu), portal: menu.parentElement === document.body,
    pos: getComputedStyle(menu).position,
    dl: Math.round(m.left - f.left), dw: Math.round(m.width - f.width),
    below: Math.round(m.top - f.bottom), h: Math.round(m.height),
    pushed: gapToNext() - shut,
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    coarse: matchMedia('(pointer: coarse)').matches,
  };
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await w(200);
  out.closed = !document.querySelector('.person-pick-menu');
  return out;
})()`, true);
check('터치·좁은 화면에서 목록은 body 포털이 아니라 부품 안에 그려진다',
  !flowPick.err && flowPick.inRoot === true && flowPick.portal === false
  && flowPick.pos === 'static' && flowPick.closed === true, JSON.stringify(flowPick));
check('그 목록은 칸 바로 아래에 칸과 같은 폭으로 선다',
  !flowPick.err && Math.abs(flowPick.dl) <= 1 && Math.abs(flowPick.dw) <= 1
  && Math.abs(flowPick.below - 4) <= 2 && flowPick.over <= 0, JSON.stringify(flowPick));
// 덮는 것이 아니라 미는 것이다 — 아래 카드가 목록 높이(+4px 사이)만큼 내려간다
check('아래 카드를 덮지 않고 그만큼 밀어낸다',
  !flowPick.err && Math.abs(flowPick.pushed - (flowPick.h + 4)) <= 2 && flowPick.h > 40,
  JSON.stringify(flowPick));

// 인라인이어도 ↑↓·Enter는 그대로다. 미배정은 양민혁·조해리 둘이고 가나다순이라
// ↓ 한 번이면 둘째 줄(조해리)이다.
const flowKey = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const key = (k) => document.activeElement.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const input = document.querySelector('.sun-add input');
  if (!input) return { err: 'no-field' };
  input.blur(); await w(60); input.focus();
  await w(420);
  const names = [...document.querySelectorAll('.person-pick-option')].map(b => b.lastElementChild.textContent.trim());
  key('ArrowDown'); await w(120);
  key('Enter'); await w(700);
  const g = ${store('groups')}.find(x => x.name === '꼬순');
  return { names,
    added: ${store('group_members')}.filter(m => m.group_id === g?.id).map(m => m.person_id).sort().join(','),
    open: !!document.querySelector('.person-pick-menu') };
})()`, true);
check('인라인 목록도 ↑↓·Enter로 고른다',
  !flowKey.err && JSON.stringify(flowKey.names) === '["양민혁","조해리"]'
  && flowKey.added === 'p1,p2,p3,p7' && flowKey.open === false, JSON.stringify(flowKey));

// **짧은 목록(순 옮기기)은 반대다 — 떠서 나온다**(사용자 지적 2026-09-09: "이렇게 라인
// 밀리게 UI를 두는 게 아니라 해당 선택지는 바로 그 아래에 플로팅되어 나오는 형식으로
// 해줘야지... 왜 밀려" · "순 옮기기 쪽은 또 왜 그래 같이 고쳐줘"). 흐름에 두는 근거는
// **입력칸이 있는 피커**의 사정이고(iOS가 키보드 상태에서 fixed를 제자리에 안 그린다),
// MenuPick에는 입력칸이 없어 키보드가 뜨지 않는다. 밀면 그 줄이 벌어지고 머리줄에서는
// 제목·가로선이 통째로 내려간다.
// 되돌리기 확인: MenuPick의 toggle에 `isTouchNarrow()` 갈래를 되살리면 아래 둘이 깨진다.
const flowMenu = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const btn = document.querySelector('[aria-label="천진영 순 옮기기"]');
  if (!btn) return { err: 'no-btn' };
  btn.click(); await w(350);
  const menu = document.querySelector('.menu-pick-menu');
  if (!menu) return { err: 'no-menu' };
  const row = btn.closest('.group-person');
  const out = { inRoot: !!btn.closest('.sun-move')?.contains(menu),
    portal: menu.parentElement === document.body,
    pos: getComputedStyle(menu).position,
    dr: Math.round(menu.getBoundingClientRect().right - btn.getBoundingClientRect().right),
    // 트리거가 그 사람 줄의 첫 줄에 남아 있는가 — 아래 check의 뜻
    dyTop: Math.round(btn.getBoundingClientRect().top - row.firstElementChild.getBoundingClientRect().top),
    below: Math.round(menu.getBoundingClientRect().top - btn.getBoundingClientRect().bottom),
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  return out;
})()`, true);
check('순 옮기기 목록은 트리거 바로 아래에 떠서 선다(오른쪽 끝을 맞춘다)',
  !flowMenu.err && flowMenu.portal === true && flowMenu.pos === 'fixed'
  && Math.abs(flowMenu.dr) <= 1 && flowMenu.below >= 0 && flowMenu.below <= 12
  && flowMenu.over <= 0, JSON.stringify(flowMenu));
// 목록이 떠 있으므로 줄은 애초에 높아지지 않는다 — 트리거는 그 사람 이름과 같은 줄이다
// (흐름이던 시절에는 PersonTag의 `has-[.menu-pick-menu]:items-start`가 그 일을 했고,
// 지금은 목록이 그 줄의 자손이 아니라서 그 유틸이 걸리지 않는다)
check('목록이 떠도 순 옮기기 버튼은 그 사람 줄에 남는다',
  !flowMenu.err && Math.abs(flowMenu.dyTop) <= 3, JSON.stringify(flowMenu));

// 굵은 포인터면 **폭이 넓어도** 인라인이다(아이패드처럼 손가락으로 쓰는 기기)
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 800, deviceScaleFactor: 2, mobile: true });
await sleep(700);
const coarseWide = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const input = document.querySelector('.sun-add input');
  if (!input) return { err: 'no-field' };
  input.blur(); await w(60); input.focus();
  await w(420);
  const menu = document.querySelector('.person-pick-menu');
  const out = { coarse: matchMedia('(pointer: coarse)').matches,
    narrow: matchMedia('(max-width: 767px)').matches,
    portal: menu ? menu.parentElement === document.body : null,
    pos: menu ? getComputedStyle(menu).position : '' };
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  return out;
})()`, true);
check('굵은 포인터면 1024px에서도 인라인이다',
  !coarseWide.err && coarseWide.coarse === true && coarseWide.narrow === false
  && coarseWide.portal === false && coarseWide.pos === 'static', JSON.stringify(coarseWide));

// 데스크톱(가는 포인터 · 넓은 폭)은 예전 그대로 body 포털 + fixed다(§6-1)
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(700);
const deskPick = await ev(`(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const input = document.querySelector('.sun-add input');
  if (!input) return { err: 'no-field' };
  input.blur(); await w(60); input.focus();
  await w(420);
  const menu = document.querySelector('.person-pick-menu');
  if (!menu) return { err: 'no-menu' };
  const out = { coarse: matchMedia('(pointer: coarse)').matches,
    portal: menu.parentElement === document.body, pos: getComputedStyle(menu).position };
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  return out;
})()`, true);
check('데스크톱은 그대로 body 포털에 fixed로 뜬다',
  !deskPick.err && deskPick.coarse === false && deskPick.portal === true
  && deskPick.pos === 'fixed', JSON.stringify(deskPick));
await sleep(300);

// ── 6) 명단에 안 이어진 계정 · 아무것도 없는 화면 ──────────────────────────
await enter({ personId: null, isMaster: false, roles: [] });
const orphan = await ev(`(() => ({
  empty: document.querySelector('.mysun-empty')?.innerText.replace(/\\n+/g, ' | ') || '',
  card: !!document.querySelector('.mysun-card'),
}))()`);
check('명단에 안 이어진 계정에는 담백한 빈 자리',
  orphan.card === false && orphan.empty.includes('명단에 이어지지 않은') && orphan.empty.includes('관리자에게 알려주세요'), orphan.empty);
const orphanEmpty = await centered('.mysun-empty');
isCentered('명단에 안 이어진 계정', orphanEmpty);

// 동아리가 하나도 없는 화면 — 시드에서 동아리를 덜어내고 본다
await enter({ personId: 'p6', isMaster: true, roles: [] }, 'light', `g.groups = g.groups.filter(x => x.type !== 'club');`);
await tab('동아리'); await sleep(800);
const clubEmpty = await centered('.club-empty');
isCentered('동아리가 하나도 없는 화면', clubEmpty);
check('동아리가 없을 때 문구', clubEmpty.text === '아직 만들어진 동아리가 없어요', clubEmpty.text);

// ── 6-1) 나머지 빈 자리 · 명단에 안 이어진 마스터 ──────────────────────────
// 공유된 노트 없음 · 미배정이 없을 때 · 그리고 마스터가 명단에 이어져 있지 않아도
// 순모임 가이드 자리는 선다(사용자 지적 2026-09-03).
await enter({ personId: 'p1', isMaster: false, isAdmin: false, roles: [] }, 'light',
  `g.service_notes = [];`);
const noteEmpty = await centered('.mysun-note-empty');
isCentered('공유된 노트가 없는 자리', noteEmpty, 120);

await enter({ personId: 'p3', isMaster: false, isAdmin: false, roles: ['lead_sunjang'] }, 'light',
  `g.group_members = [...g.group_members, { group_id: 'g1', person_id: 'p7' }, { group_id: 'g2', person_id: 'p8' }];`);
await tab('순 편성'); await sleep(900);
const placed = await ev(`(() => ({
  block: !!document.querySelector('.sun-placed'),
  pickers: document.querySelectorAll('.sun-add').length,
  said: document.querySelector('.sun-admin').innerText.includes('모두 순에'),
}))()`);
// 미배정이 없을 때 **아무 것도 그리지 않는다**(사용자 결정 2026-09-03 — 잠깐 두었던
// '모두 순에 들어갔어요' 빈 자리를 걷었다). 순원 추가 칸은 그대로 선다.
check('미배정이 없으면 빈 자리 문구를 그리지 않는다',
  placed.block === false && placed.said === false && placed.pickers === 2, JSON.stringify(placed));

await enter({ personId: null, isMaster: true, isAdmin: true, roles: [] }, 'light', '', true);
const orphanMaster = await ev(`(() => ({
  guide: !!document.querySelector('.sun-guide'),
  sheet: !!document.querySelector('.sun-guide-sheet'),
  card: !!document.querySelector('.mysun-card'),
  empty: !!document.querySelector('.mysun-empty svg'),
}))()`);
check('마스터가 명단에 이어져 있지 않아도 순모임 가이드 자리가 보인다',
  orphanMaster.guide === GUIDE_ON && orphanMaster.sheet === GUIDE_ON
  && orphanMaster.card === false && orphanMaster.empty === true, JSON.stringify(orphanMaster));

// ── 7) 모바일 375px ─────────────────────────────────────────────────────────
// 시드에 **내가 공유한 노트**를 하나 더 심는다(p3 = u3) — 공유 토글은 내 줄에만 서는데
// 기본 시드의 공유 노트는 남의 것(u9)과 p1의 것(u1)뿐이다.
await enter({ personId: 'p3', isMaster: false, roles: ['lead_sunjang'] }, 'light',
  `g.service_notes = [...g.service_notes, { id: 'n5', service_id: 's0', profile_id: 'u3',
    shared_to_sun: true, author_name: '김승찬', body: '내가 순에 공유한 노트' }];`);
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await sleep(800);
const mobMine = await ev(`(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  members: document.querySelectorAll('.mysun-member').length,
}))()`);
check('모바일 375px — 내 순이 가로로 넘치지 않는다', mobMine.overflow <= 0, `넘침 ${mobMine.overflow}px`);
check('모바일에서도 구성원이 그대로 선다', mobMine.members === 3, String(mobMine.members));
// 공유 토글 — 좁은 폭에서는 **줄 아래에서 왼쪽부터 폭을 채우고 두 쪽이 반씩**이다
// (사용자 지적 2026-09-07 — 접힌 채 오른쪽 끝에 어긋나 서 있었다).
// 기본으로 서는 주보에는 **남의 노트**뿐이라 토글이 없다 — 내 노트가 있는 지난 주보로
// 바꿔야 그 줄이 선다(주보별로 보게 된 뒤로 필요해진 한 걸음 · 2026-09-09)
await ev(`(() => { const t = document.querySelector('.mysun-note-pick .menu-pick'); t && t.click(); })()`);
await sleep(350);
await ev(`(() => { const o = [...document.querySelectorAll('.menu-pick-option')]; (o[1] || o[0])?.click(); })()`);
await sleep(600);
const mobShare = await ev(`(() => {
  const row = [...document.querySelectorAll('.mysun-note')].find(r => r.querySelector('.mysun-note-share'));
  if (!row) return { err: 'no-row' };
  const box = row.querySelector('.mysun-note-share').getBoundingClientRect();
  const date = row.querySelector('p').getBoundingClientRect();
  const [a, b] = [...row.querySelectorAll('.mysun-note-share button')].map(x => x.getBoundingClientRect().width);
  // 카드에는 테두리가 1px 있다 — rect는 그것을 품고 clientLeft/clientWidth는 뺀다
  const cs = getComputedStyle(row);
  const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
  const r = row.getBoundingClientRect();
  return { left: Math.round(box.left - (r.left + row.clientLeft + padL)),
    fill: Math.round((row.clientWidth - padL - padR) - box.width),
    below: Math.round(box.top - date.bottom),
    half: Math.round(Math.abs(a - b)) };
})()`);
check('모바일 375px — 공유 토글이 줄 아래에서 폭을 채우고 두 쪽이 반씩',
  !mobShare.err && mobShare.left === 0 && Math.abs(mobShare.fill) <= 1
  && mobShare.below > 0 && mobShare.half <= 1, JSON.stringify(mobShare));
await tab('순 편성'); await sleep(800);
const mobSun = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('모바일 375px — 순 편성도 넘치지 않는다', mobSun <= 0, `넘침 ${mobSun}px`);
// 자동완성 목록도 375px 안에 들어와야 한다(네이티브 select를 걷어낸 자리라 우리 몫이다)
await ev(`(() => { const i = document.querySelector('input[aria-label="꼬순 순원 추가"]'); i.scrollIntoView({ block: 'center' }); i.focus(); })()`);
await sleep(400);
const mobPick = await ev(`(() => {
  const m = document.querySelector('.person-pick-menu');
  if (!m) return null;
  const r = m.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(window.innerWidth),
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`);
check('모바일 375px — 자동완성 목록이 화면 안에 선다',
  !!mobPick && mobPick.left >= 0 && mobPick.right <= mobPick.w && mobPick.over <= 0, JSON.stringify(mobPick));
await ev(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(300);
await tab('동아리'); await sleep(700);
const mobList = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('모바일 375px — 동아리 목록도 넘치지 않는다', mobList <= 0, `넘침 ${mobList}px`);
await openClub('통통'); await sleep(800);
const mobClub = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('모바일 375px — 동아리 상세도 넘치지 않는다', mobClub <= 0, `넘침 ${mobClub}px`);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// ── 8) 다크 모드 — 새로 만든 부품이 테마를 따라가는가 ───────────────────────
// 토큰이 아니라 색을 박아 두면 라이트에서만 맞고 다크에서 글자가 배경에 묻힌다(§8).
// "예쁜가"가 아니라 **읽을 수 있는가**만 본다(themefit과 같은 기준 2.0).
const paintOf = (...sels) => ev(`(() => {
  const grab = (s) => { const e = document.querySelector(s); if (!e) return null;
    const c = getComputedStyle(e); return { bg: c.backgroundColor, fg: c.color, bd: c.borderTopColor }; };
  return Object.fromEntries(${JSON.stringify(sels)}.map(([k, s]) => [k, grab(s)]));
})()`);
const lum = (s) => {
  const [r, g, b] = (String(s).match(/[\d.]+/g) || ['0', '0', '0']).slice(0, 3)
    .map(v => { const x = Number(v) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const openPick = async (me, theme) => {
  await enter(me, theme);
  await tab('동아리'); await sleep(700);
  const list = await paintOf(['card', '.club-card'], ['name', '.club-name']);
  await openClub('통통'); await sleep(800);
  await ev(`document.querySelector('input[aria-label="통통 멤버 추가"]').focus()`); await sleep(450);
  const detail = await paintOf(['menu', '.person-pick-menu'], ['option', '.person-pick-option'], ['chip', '.club-meet-chip']);
  return { ...list, ...detail };
};
const lightPaint = await openPick({ personId: 'p6', isMaster: true, roles: [] }, 'light');
const darkPaint = await openPick({ personId: 'p6', isMaster: true, roles: [] }, 'dark');
check('다크에서 카드·자동완성 목록이 색을 바꾼다(색을 박아 두지 않았다)',
  !!darkPaint.card && !!darkPaint.menu
  && darkPaint.card.bg !== lightPaint.card.bg && darkPaint.menu.bg !== lightPaint.menu.bg
  && darkPaint.name.fg !== lightPaint.name.fg,
  `${lightPaint.card?.bg} → ${darkPaint.card?.bg} / ${lightPaint.menu?.bg} → ${darkPaint.menu?.bg}`);
const dc = [
  ['동아리 카드 이름', contrast(darkPaint.name.fg, darkPaint.card.bg)],
  ['자동완성 줄', contrast(darkPaint.option.fg, darkPaint.menu.bg)],
  ['모임 출석 칩', contrast(darkPaint.chip.fg, darkPaint.chip.bg)],
];
check('다크에서도 글자가 배경에 묻히지 않는다', dc.every(([, v]) => v >= 2),
  dc.map(([n, v]) => `${n} ${v.toFixed(1)}`).join(' · '));

await send('Emulation.clearDeviceMetricsOverride');

check('콘솔 오류 0', logs.length === 0, logs.slice(0, 3).join(' / '));

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
