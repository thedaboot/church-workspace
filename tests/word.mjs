// 말씀 화면 — QT(본문·묵상·나눔·잔디) · 성경 읽기(목차·리더·검색·북마크·형광펜)
//   node tests/word.mjs http://localhost:4598
// 앞부분은 서버가 필요 없는 순수 로직(날짜 셈), 뒷부분이 브라우저다.
// QT의 클라우드 데이터는 게스트에 없다 — services/word.js가 게스트에서 localStorage로
// 떨어지므로, 여기서 가짜 일정·묵상을 심어 화면을 검사한다(word.js 머리말).
//
// 2026-09-01 회차에서 바뀐 것(사용자 피드백 13~21):
//   · 본문표 붙여넣기 도구·파서가 통째로 없어졌다(읽기표는 0038 시드) → 없음을 검사한다
//   · 세그먼트 이름 '매일성경' → 'QT'
//   · 묵상 칸이 textarea → 업무 본문과 같은 MarkdownEditor(TipTap)
//   · 나만 보기/나누기는 두 쪽짜리 — 이미 그 상태인 쪽을 눌러도 저장이 안 켜진다
//   · 기다리는 자리는 글자가 아니라 스켈레톤, 화면 전환은 [data-swap]이 물고 있다
//   · 성경 읽기에 형광펜 + '내 기록'(북마크·형광펜 모아보기)
//
// 2026-09-02 회차에서 바뀐 것(2차 피드백 3~4):
//   · '나누기' → '더다붓에 공유하기'(토글·저장 토스트) · '오늘로' → '오늘'
//   · 장 전환 슬라이드가 실제로 프레임을 돈다 → transform 값을 rAF로 훑어 확인
//   · 절을 눌러도 바로 안 칠해진다 — 그 절 옆 선택 팝오버(긋기/지우기)를 거친다
//   · '내 기록'이 책별로 묶이고, 펼친 책의 파일만 그때 받는다(리소스 타이밍으로 확인)
//
// 2026-09-02 4차 피드백(7~12)에서 바뀐 것:
//   · QT 상단 날짜가 데이트피커 트리거다(이전/다음 화살표는 그대로)
//   · 날짜를 넘길 때 본문 자리를 **넘기기 직전 높이로 붙잡아** 둔다 — 묵상 칸이
//     위로 올라왔다 내려가지 않고, 묵상 에디터도 언마운트되지 않는다
//   · 공유 토글은 dirty를 건드리지 않고 shared 칸만 즉시 저장한다(칩으로 표시)
//   · 나눔 줄의 지우기 = **공유 해제**(2026-09-05에 폐기 — 아래) · 진짜 삭제는 '내 묵상' 칸
//   · 잔디 칸 13px(날짜 숫자 대신 요일 머리글·월·title)
//   · 성경 읽기: [본문 | 북마크 | 형광펜] 세그먼트 · 리더 되돌아가기는 '목차'(2026-09-05)
//   · 형광펜은 절 상자가 아니라 **글자에만** 칠해진다(인라인 mark + box-decoration-break)
//   · 형광펜 팝오버는 다른 절을 눌러도 그 절을 따라간다(절마다 key로 새로 마운트)
//   · '형광펜 긋기' → '형광펜 칠하기'
//
// 2026-09-03 피드백에서 바뀐 것:
//   · 폭 상한(46rem)을 없앴다 — 어느 폭에서도 칸이 자기 자리를 다 쓴다([data-col])
//   · 형광펜 도구 줄은 포털 팝오버가 아니라 **눌린 절 다음 형제**(문서 흐름 안)
//   · 대상 절에 표시(dc-verse-picked) · 도구 줄에 색 칩
//   · 예외 문구: 못 읽은 것과 없는 것을 갈라 말하고, 이유를 한 문장에 붙인다
//
// 2026-09-05 피드백에서 바뀐 것:
//   · 나눔 줄의 **눈 가리기(공유 해제)가 없어졌다** — 공유는 토글로만 조절한다
//   · **조작 가능한 공유 토글은 화면에 한 벌**(내 묵상 칸) — 나눔 줄의 토글·칩을 뺐다.
//     그 줄은 상태만 말한다: 비공개면 잠금 표시, 표시가 없으면 공유 중이라는 뜻
//   · **마스터는 남의 나눔 줄을 지운다**(0045) — 공유 해제가 아니라 그 사람의 그날 묵상
//     행이 없어진다. 게스트에는 남이 없어서 word.js가 게스트 자리를 하나 더 본다
//     (word_qt_shared) — 거기 한 줄 심어 버튼·문구·삭제를 실제로 눌러 본다(11-c)
//
// 3차 점검에서 본 것:
//   · 형광펜 선택 팝오버가 **첫 프레임부터** 그 절 옆에 선다 — 자리를 잡기 전 한 번
//     그려지면 화면 구석에서 날아온다. 열자마자 rAF로 top·left를 훑어 확인한다
//   · 빈 상태는 남는 자리의 세로·가로 가운데에 마크와 함께 선다(§8) — 자리와 상자의
//     가운데가 같은지, 마크(.dc-draw)가 있는지를 실제 좌표로 잰다
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const URL_BASE = process.argv[2] || 'http://localhost:4174';
const CHROME = (process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const PORT = 9452;
const ROOT = new URL('..', import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (n, p, d = '') => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

// ── 1. 날짜 셈 (순수 함수 — 브라우저 없이) ──────────────────────────────────
// aictx와 같은 방식: supabaseClient import만 우리 것으로 바꿔치기해서 노드로 끌어온다.
const wordSrc = readFileSync(new URL('src/services/word.js', ROOT), 'utf8')
  .replace(/import \{ supabase \} from '\.\/supabaseClient\.js';/, 'export const supabase = null;');
const tmp = mkdtempSync(join(tmpdir(), 'word-'));
const wordFile = join(tmp, 'word.mjs');
writeFileSync(wordFile, wordSrc);
const word = await import(pathToFileURL(wordFile).href);

check('날짜 이동은 달을 넘어간다', word.shiftDay('2026-09-01', -1) === '2026-08-31',
  word.shiftDay('2026-09-01', -1));
check('요일 라벨', word.dayLabel('2026-09-01') === '2026년 9월 1일 (화)', word.dayLabel('2026-09-01'));
check('그 달의 날 수와 1일의 요일', word.monthDays('2026-09-10').days.length === 30
  && word.monthDays('2026-09-10').lead === 2, JSON.stringify(word.monthDays('2026-09-10').lead));
check('주는 일요일에 시작한다', JSON.stringify(word.weekRange('2026-09-01')) === JSON.stringify(['2026-08-30', '2026-09-05']),
  JSON.stringify(word.weekRange('2026-09-01')));
check('장 열쇠는 그대로 되읽힌다', JSON.stringify(word.parseChapterKey(word.chapterKey('gen', 3)))
  === JSON.stringify({ bookId: 'gen', chapter: 3 }), word.chapterKey('gen', 3));
// 형광펜은 절까지 적는다 — 장 열쇠 파서가 절 열쇠를 먹으면 'gen 1'과 'gen 1:3'이 섞인다
check('절 열쇠는 장 열쇠와 갈린다',
  JSON.stringify(word.parseVerseKey(word.verseKey('gen', 1, 3))) === JSON.stringify({ bookId: 'gen', chapter: 1, verse: 3 })
  && word.parseChapterKey('gen 1:3') === null, word.verseKey('gen', 1, 3));
// 붙여넣기 도구는 사라졌다 — 읽기표 730일은 0038 마이그레이션이 넣는다
check('본문표 파서·저장 함수가 남아 있지 않다',
  !word.parseQtTable && !word.saveSchedule && !word.dedupeByDate);

// ── 2. 브라우저 ─────────────────────────────────────────────────────────────
const prof = mkdtempSync(join(tmpdir(), 'cword-'));
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
const reload = async () => {
  evs.length = 0;
  await send('Page.navigate', { url: URL_BASE });
  await wait('Page.loadEventFired');
  await sleep(300);
};
const ev = async (e, a = false) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };

// 화면에서 글자로 버튼을 찾는다 — 못 찾으면 던지지 말고 false를 돌려준다(§6-40)
const clickText = (label) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return false; b.click(); return true;
})()`);
// 자리(data-*)로 누른다 — 글자로 찾는 clickText와 같은 규칙으로, 없으면 던지지 말고
// false를 돌려준다(§6-40). 하나가 없다고 뒤의 검사가 통째로 날아가면 안 된다.
const clickSel = (sel) => ev(`(() => {
  const b = document.querySelector(${JSON.stringify(sel)});
  if (!b) return false; b.click(); return true;
})()`);
// 무언가 나타날 때까지 기다린다 — 차가운 dev 서버에서는 lazy 청크(TipTap)가 몇 초 늦다
const waitFor = async (expr, ms = 12000) => {
  const s0 = Date.now();
  while (Date.now() - s0 < ms) {
    if (await ev(`!!(${expr})`)) return true;
    await sleep(200);
  }
  return false;
};
const saveDisabled = () => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '저장');
  return b ? b.disabled : null;
})()`);

// 기다리는 자리를 스켈레톤이 지키는지 — 잠깐 떴다 사라지므로 관찰자로 잡는다
const watchSkeleton = () => ev(`(() => {
  window.__skel = 0;
  window.__obs?.disconnect();
  window.__obs = new MutationObserver(() => { if (document.querySelector('.dc-skeleton')) window.__skel++; });
  window.__obs.observe(document.body, { childList: true, subtree: true });
})()`);

// 가짜 QT 데이터 — 게스트에서는 word.js가 localStorage를 본다
const today = word.kstToday();
const monthOf = today.slice(0, 7);
const seedDates = [...new Set([`${monthOf}-01`, `${monthOf}-15`, today])].sort();
const [wStart, wEnd] = word.weekRange(today);
const expWeek = seedDates.filter(d => d >= wStart && d <= wEnd).length;
const expMonth = seedDates.length;
const seed = {
  schedule: {
    [today]: { passage_ref: '여호수아 4:1-14', label: '사귐의 기도' },
    [word.shiftDay(today, -1)]: { passage_ref: '시편 121편', label: '' },
  },
  entries: Object.fromEntries(seedDates.map(d => [d, { body: `${d} 묵상 한 줄`, shared: d === today }])),
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await reload();
await ev(`(() => {
  localStorage.setItem('theme', 'light');
  localStorage.setItem('word_qt_schedule', ${JSON.stringify(JSON.stringify(seed.schedule))});
  localStorage.setItem('word_qt_entries', ${JSON.stringify(JSON.stringify(seed.entries))});
  localStorage.removeItem('word_bible_state');
  localStorage.removeItem('word_bible_font');
})()`);
await reload();
await sleep(1400);

// 1) 말씀 화면 진입 (데스크톱 상단 '말씀')
check('데스크톱 상단에 말씀 버튼', await clickText('말씀'));
await sleep(1400);
const seg = await ev(`(() => {
  const t = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  return { qt: t.includes('QT'), old: t.includes('매일성경'), read: t.includes('성경 읽기') };
})()`);
check('세그먼트 [QT | 성경 읽기]', seg.qt && seg.read, JSON.stringify(seg));
check("'매일성경'이라는 이름은 남아 있지 않다", seg.old === false);

// 2) QT — 그날 본문 · 제목 · 절 번호
const qt = await ev(`(() => {
  const vs = [...document.querySelectorAll('p[data-verse]')];
  return {
    date: (document.body.innerText.match(/\\d+년 \\d+월 \\d+일 \\([일월화수목금토]\\)/) || [])[0] || '',
    label: [...document.querySelectorAll('h3')].map(h => h.textContent.trim()),
    verses: vs.length,
    first: vs[0] ? vs[0].textContent : '',
    ref: document.body.innerText.includes('여호수아 4:1-14'),
  };
})()`);
check('오늘 날짜(한국 시간)로 연다', qt.date === word.dayLabel(today), `${qt.date} / ${word.dayLabel(today)}`);
check('일정의 제목이 제목으로 선다', qt.label.includes('사귐의 기도'), JSON.stringify(qt.label));
check('구절이 본문으로 펼쳐진다(절 14개)', qt.verses === 14 && qt.ref, JSON.stringify(qt));
check('절 번호가 붙는다', qt.first.startsWith('1온 백성이'), qt.first.slice(0, 20));

// 2b) QT 본문 형광펜(사용자 결정 2026-09-05) — 범위로 칠하고, **그날의 것**으로만 남는다
// (모아보기에 오르지 않는다 — ref가 'qt:<날짜> 책 장:절'이라 parseVerseKey가 못 읽는다)
const qtHl = await ev(`(async () => {
  const tap = (k) => { const p = document.querySelector('p[data-verse="' + k + '"]');
    p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); p.click(); };
  tap('4:2'); await new Promise(r => setTimeout(r, 200));
  tap('4:4'); await new Promise(r => setTimeout(r, 200));
  const picked = [...document.querySelectorAll('p[data-picked="1"]')].map(x => x.dataset.verse);
  const t = document.querySelector('[data-verse-tool]');
  const label = t ? t.dataset.verseTool : '';
  const chip = document.querySelector('[data-verse-tool] [data-hl-color="green"]');
  if (chip) chip.click();
  await new Promise(r => setTimeout(r, 250));
  const lit = [...document.querySelectorAll('p[data-mark="1"]')].map(x => x.dataset.verse);
  const st = JSON.parse(localStorage.getItem('word_bible_state') || '{}');
  return { picked, label, lit, refs: (st.highlights || []).map(h => h.ref), closed: !document.querySelector('[data-verse-tool]') };
})()`, true);
check('QT 본문에서 절 둘을 누르면 범위가 된다', qtHl.picked.join(',') === '4:2,4:3,4:4' && qtHl.label === '여호수아 4:2~4',
  JSON.stringify(qtHl));
check('초록 칩으로 칠하면 세 절이 켜지고 도구 줄이 닫힌다', qtHl.lit.join(',') === '4:2,4:3,4:4' && qtHl.closed,
  JSON.stringify(qtHl));
check('QT 형광펜은 그날 열쇠로 남고 모아보기용 열쇠가 아니다',
  qtHl.refs.length === 3 && qtHl.refs.every(r => r === `qt:${today} jos ` + r.split(' ').at(-1) && word.parseVerseKey(r) === null),
  JSON.stringify(qtHl.refs));

// 지우기도 리더와 같은 훅을 탄다 — 같은 범위를 다시 골라 [형광펜 지우기].
// **이 검사가 상태를 원복하는 몫도 한다.** qt: 항목을 남겨 두면 word_bible_state를
// 그대로 세는 뒤의 리더 검사(형광펜이 절 단위로 남는다 · 고른 색 · 범위 전체 지우기)가
// 셋씩 더 세어 깨진다(2026-09-05 — 실제로 그렇게 넷이 빨개졌다).
const qtOff = await ev(`(async () => {
  const tap = (k) => { const p = document.querySelector('p[data-verse="' + k + '"]');
    p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); p.click(); };
  tap('4:2'); await new Promise(r => setTimeout(r, 200));
  tap('4:4'); await new Promise(r => setTimeout(r, 200));
  const btn = [...document.querySelectorAll('[data-verse-tool] button')]
    .find(b => b.textContent.trim() === '형광펜 지우기');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 300));
  const st = JSON.parse(localStorage.getItem('word_bible_state') || '{}');
  return { had: !!btn, lit: document.querySelectorAll('p[data-mark="1"]').length,
           refs: (st.highlights || []).map(h => h.ref) };
})()`, true);
check('QT에서도 범위를 다시 골라 형광펜을 지운다',
  qtOff.had === true && qtOff.lit === 0 && qtOff.refs.length === 0, JSON.stringify(qtOff));

// 3) 나눔 — '나누기'를 켠 글만. 본문은 업무 본문과 같은 마크다운 뷰어가 그린다
const feed = await ev(`(() => document.body.innerText.includes(${JSON.stringify(seed.entries[today].body)}))()`);
check('나누기를 켠 묵상이 나눔에 오른다', feed === true);

// 4) 잔디 — 개인 집계. 남과 견주는 말·연속 일수는 화면에 없어야 한다
const grass = await ev(`(() => {
  const t = document.body.innerText;
  return {
    line: (t.match(/이번 주 \\d+번, 이번 달 \\d+번 기록했어요/) || [])[0] || '',
    streak: /연속/.test(t) || /배지/.test(t) || /순위/.test(t),
  };
})()`);
check('잔디 집계 문구', grass.line === `이번 주 ${expWeek}번, 이번 달 ${expMonth}번 기록했어요`,
  `${grass.line} / 기대 이번 주 ${expWeek} · 이번 달 ${expMonth}`);
check("'연속'·배지·순위는 화면에 없다", grass.streak === false);
// 칸 크기(4차 피드백 9) — 12~14px 정사각. 숫자는 안 들어가므로 날짜는 title·요일 머리글·월이 말한다
await waitFor(`[...document.querySelectorAll('button[title]')].some(b => b.title.indexOf('일 (') > 0)`);
const cells = await ev(`(() => {
  const list = [...document.querySelectorAll('button[title]')].filter(b => /^\\d+월 \\d+일 \\([일월화수목금토]\\)$/.test(b.title));
  if (!list.length) return null;
  const r = list[0].getBoundingClientRect();
  return { n: list.length, w: Math.round(r.width), h: Math.round(r.height),
    numbers: list.map(b => b.textContent.trim()),
    gridW: Math.round(list[0].parentElement.getBoundingClientRect().width),
    labelled: list.every(b => (b.getAttribute('aria-label') || '') === b.title),
    week: [...document.querySelectorAll('span')].filter(s => ['일','월','화','수','목','금','토'].includes(s.textContent.trim())).length };
})()`);
const monthLen = word.monthDays(today).days.length;
const month31 = word.monthDays(today).days.map(d => String(+d.slice(8))).join(',');
// 20px(사용자 결정 2026-09-03 — "숫자가 있어도 좋겠다, 살짝만") · 예전 41px의 절반이다
check('잔디 칸이 18~20px이다', !!cells && cells.w >= 18 && cells.w <= 20 && cells.h === cells.w,
  JSON.stringify(cells));
check('잔디는 그 달의 날 수만큼 서고 칸마다 날짜가 붙는다',
  !!cells && cells.n === monthLen && cells.labelled, JSON.stringify(cells));
check('칸 안에 날짜 숫자가 보인다',
  !!cells && cells.numbers.join(',') === month31, JSON.stringify(cells && cells.numbers.slice(0, 5)));
check('한 달이 좁은 화면 폭에도 든다(그리드 200px 이하)',
  !!cells && cells.gridW > 0 && cells.gridW <= 200, JSON.stringify(cells));
check('요일 머리글과 연·월이 함께 보인다',
  !!cells && cells.week >= 7 && (await ev(`document.body.innerText.includes(${JSON.stringify(`${word.monthDays(today).year}년 ${word.monthDays(today).month}월`)})`)) === true,
  JSON.stringify(cells));

// 5) 본문표 붙여넣기 도구는 없다(0038 시드로 대체) — 마스터에게도 안 보인다
const noPaste = await ev(`(() => ({
  box: !!document.querySelector('textarea[aria-label="본문표"]'),
  head: document.body.innerText.includes('본문표'),
}))()`);
check('본문표 붙여넣기 도구가 화면에 없다', noPaste.box === false && noPaste.head === false,
  JSON.stringify(noPaste));

// 6) 묵상 칸은 업무 본문과 같은 에디터(TipTap)다
await waitFor(`document.querySelector('.tiptap')`);
const editor = await ev(`(() => ({
  tiptap: !!document.querySelector('.tiptap'),
  textarea: !!document.querySelector('textarea[aria-label="내 묵상"]'),
  bar: [...document.querySelectorAll('button[title]')].map(b => b.title).filter(t => ['굵게','형광펜','제목 1','체크리스트'].includes(t)).length,
}))()`);
check('묵상 칸이 마크다운 에디터로 바뀌었다', editor.tiptap && !editor.textarea, JSON.stringify(editor));
check('서식 바가 같이 온다(굵게·형광펜·제목·체크리스트)', editor.bar === 4, String(editor.bar));
// **빈 공간을 눌러도 입력된다**(사용자 피드백 2026-09-03). 자리를 잡는 일은
// MarkdownEditor의 focusEnd가 하고(`.tiptap` 밖을 누르면 문서 끝으로), 상자 크기는
// 업무 수정 창과 같은 한 벌이다 — 데스크톱에서 누를 빈 자리가 그만큼 넓다.
await ev(`(() => { const t = document.querySelector('.tiptap'); t && t.scrollIntoView({ block: 'center' }); })()`);
await sleep(500);
const boxAt = await ev(`(() => {
  const t = document.querySelector('.tiptap');
  const box = t && t.parentElement.parentElement;   // className을 받은 감싸개
  if (!box) return null;
  const r = box.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 10),
           blank: Math.round(r.height - t.getBoundingClientRect().height), h: Math.round(r.height) };
})()`);
// **진짜 마우스로 누른다** — 합성 MouseEvent로는 ProseMirror가 커서를 잡지 않는다
if (boxAt) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: boxAt.x, y: boxAt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: boxAt.x, y: boxAt.y, button: 'left', clickCount: 1 });
  await sleep(300);
}
const boxFocused = await ev(`!!document.activeElement && !!document.activeElement.closest('.tiptap')`);
check('묵상 상자의 빈 자리를 눌러도 커서가 잡힌다', boxFocused === true, JSON.stringify(boxAt));
check('묵상 상자가 업무 수정 창만큼 넉넉하다', !!boxAt && boxAt.h >= 220 && boxAt.blank >= 150,
  JSON.stringify(boxAt));

// 7) 날짜 이동 — 어제 / 오늘. 기다리는 자리는 스켈레톤이 지킨다.
// **넘기는 동안 아래 칸이 위로 올라오면 안 된다**(4차 피드백 7). 본문 자리를 넘기기
// 직전 높이로 붙잡아 두므로, 본문이 도착하기 전(절이 0개인 프레임들) 동안 '내 묵상'
// 머리글의 y는 그대로여야 한다. 예전에는 자리가 320px로 줄어 300px쯤 위로 뛰었다.
// 에디터가 그 사이 언마운트되지 않는지도 같이 본다(표식을 심어 두고 살아 있는지 확인).
await watchSkeleton();
await waitFor(`[...document.querySelectorAll('h3')].some(h => h.textContent.trim() === '내 묵상')`);
const steady = await ev(`(async () => {
  const head = () => [...document.querySelectorAll('h3')].find(h => h.textContent.trim() === '내 묵상');
  const tip = document.querySelector('.tiptap');
  if (tip) tip.dataset.probe = '1';
  if (!head()) return { before: -1, frames: 0, waited: 0, up: -1, kept: false };
  const before = head().getBoundingClientRect().top;
  const seen = [];
  let stop = false;
  const tick = () => {
    const h = head();
    if (h) seen.push([h.getBoundingClientRect().top, document.querySelectorAll('p[data-verse]').length]);
    if (!stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const b = [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '어제');
  if (!b) return { before, frames: 0, waited: 0, up: -1, kept: false };
  b.click();
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 16));
    if (document.querySelectorAll('p[data-verse]').length) break;
  }
  stop = true;
  const waiting = seen.filter(([, n]) => n === 0).map(([t]) => t);
  return { before, frames: seen.length, waited: waiting.length,
    up: waiting.length ? +(before - Math.min(...waiting)).toFixed(1) : -1,
    kept: (document.querySelector('.tiptap') || {}).dataset?.probe === '1' };
})()`, true);
// 기다리는 프레임이 하나도 없을 수도 있다 — 캐시가 있으면 스켈레톤 없이 바로 그린다
// (그때는 애초에 튈 자리가 없다). 기다리는 동안 자리가 줄면 300px 가까이 뛰므로 걸린다.
check('날짜를 넘기는 동안 묵상 칸이 위로 올라오지 않는다',
  steady.before > 0 && steady.up <= 8, JSON.stringify(steady));
check('날짜가 바뀌어도 묵상 에디터는 그대로 서 있는다', steady.kept === true, JSON.stringify(steady));
await sleep(900);
const yest = await ev(`(() => ({
  date: (document.body.innerText.match(/\\d+년 \\d+월 \\d+일 \\([일월화수목금토]\\)/) || [])[0] || '',
  psalm: document.body.innerText.includes('시편 121편'),
  hasToday: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '오늘'),
  oldLabel: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '오늘로'),
  skel: window.__skel,
  swaps: [...document.querySelectorAll('[data-swap]')].map(e => e.dataset.swap),
  moves: [...document.querySelectorAll('[data-swap]')].every(e => getComputedStyle(e).transitionProperty.includes('transform')),
  waiting: document.body.innerText.includes('본문을 여는 중'),
}))()`);
check('어제로 이동하면 그날 본문이 뜬다', yest.date === word.dayLabel(word.shiftDay(today, -1)) && yest.psalm,
  JSON.stringify({ date: yest.date, psalm: yest.psalm }));
check("오늘이 아니면 '오늘'이 생긴다", yest.hasToday === true);
check("'오늘로'라는 이름은 남아 있지 않다", yest.oldLabel === false);
check('날짜를 바꾸면 같은 자리에 스켈레톤이 선다', yest.skel > 0, String(yest.skel));
check("'본문을 여는 중' 같은 글자 자리표는 없다", yest.waiting === false);
check('화면 전환이 날짜를 물고 있다', yest.swaps.includes(word.shiftDay(today, -1)), JSON.stringify(yest.swaps));
check('전환은 transform으로 한다(§4.2)', yest.moves === true);
await clickText('오늘');
await sleep(900);
check("'오늘'이 오늘로 되돌린다",
  (await ev(`(document.body.innerText.match(/\\d+년 \\d+월 \\d+일 \\([일월화수목금토]\\)/)||[''])[0]`)) === word.dayLabel(today));

// 7-b) 상단 날짜가 데이트피커다(4차 피드백 10) — 화살표는 그대로 남아 있다
await waitFor(`document.querySelector('button[aria-label="QT 날짜 고르기"]')`);
const openedPicker = await clickSel('button[aria-label="QT 날짜 고르기"]');
await waitFor(`document.querySelector('[data-datepicker]')`, 4000);
await sleep(300);
const picker = await ev(`(() => {
  const p = document.querySelector('[data-datepicker]');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return {
    days: [...p.querySelectorAll('button')].filter(b => /^\\d+$/.test(b.textContent.trim())).length,
    clear: p.innerText.includes('지우기'),
    inView: r.left >= -1 && r.right <= innerWidth + 1,
    arrows: [...document.querySelectorAll('button[aria-label]')]
      .filter(b => ['어제', '내일'].includes(b.getAttribute('aria-label'))).length,
  };
})()`);
check('상단 날짜를 누르면 데이트피커가 뜬다', openedPicker === true && !!picker && picker.days >= 28,
  JSON.stringify(picker));
check('QT 데이트피커에는 지우기가 없다', !!picker && picker.clear === false, JSON.stringify(picker));
check('데이트피커가 화면 안에 든다', !!picker && picker.inView === true, JSON.stringify(picker));
check('이전·다음 화살표는 그대로 있다', !!picker && picker.arrows === 2, JSON.stringify(picker));
const picked15 = await ev(`(() => {
  const p = document.querySelector('[data-datepicker]');
  if (!p) return false;
  const b = [...p.querySelectorAll('button')].find(x => x.textContent.trim() === '15');
  if (!b) return false; b.click(); return true;
})()`);
await sleep(1000);
check('데이트피커에서 고른 날로 간다', picked15 === true
  && (await ev(`(document.body.innerText.match(/\\d+년 \\d+월 \\d+일 \\([일월화수목금토]\\)/)||[''])[0]`)) === word.dayLabel(`${monthOf}-15`),
  word.dayLabel(`${monthOf}-15`));
await clickText('오늘');
await sleep(900);

// 7-c) **한 번 본 날짜로 되돌아오면 스켈레톤이 없다**(사용자 요청 2026-09-03 —
// "매번 스켈레톤이 아니라 캐시된 값이 먼저"). 어제로 갔다가 오늘로 돌아오는 길에서
// 관찰자를 다시 켜고, 그 사이 .dc-skeleton이 한 번도 안 붙는지 본다.
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='어제'); b && b.click(); })()`);
await sleep(1000);
await watchSkeleton();
await clickText('오늘');
await sleep(1000);
const cached = await ev(`(() => ({ skel: window.__skel,
  date: (document.body.innerText.match(/\\d+년 \\d+월 \\d+일 \\([일월화수목금토]\\)/) || [])[0] || '',
  verses: document.querySelectorAll('p[data-verse]').length }))()`);
check('본 날짜로 돌아오면 스켈레톤 없이 바로 그린다',
  cached.skel === 0 && cached.date === word.dayLabel(today) && cached.verses > 0,
  JSON.stringify(cached));

// 8) 등록 없는 날 — 빈 상태
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='내일'); b && b.click(); })()`);
await sleep(900);
const empty = await ev(`(() => ({
  msg: document.body.innerText.includes('이 날짜의 본문이 아직 올라오지 않았어요'),
  mark: !!document.querySelector('svg path.dc-draw'),
  verses: document.querySelectorAll('p[data-verse]').length,
}))()`);
// 표식은 SVG 선 그리기다 — 캐릭터 컷은 홈에만 둔다(사용자 결정 2026-09-03)
check('본문이 없는 날은 빈 상태 + 표식', empty.msg && empty.mark && empty.verses === 0,
  JSON.stringify(empty));
// 빈 상태는 **본문이 쓰던 자리를 그대로 받아** 그 한가운데에 선다(§8 · 3차 점검).
// 예전에는 자리가 320px인데 빈 상태만 220px이라 마크가 위로 붙고 아래가 비어 보였다.
const emptyFit = await ev(`(() => {
  const p = [...document.querySelectorAll('p')].find(x => x.textContent.includes('본문이 아직 올라오지'));
  const box = p && p.parentElement;
  const swap = box && box.closest('[data-swap]');
  const slot = swap && swap.parentElement;
  if (!slot) return null;
  const b = box.getBoundingClientRect(), s = slot.getBoundingClientRect();
  return { gap: Math.round(s.height - b.height),
           off: Math.round((b.top + b.height / 2) - (s.top + s.height / 2)) };
})()`);
check('빈 상태가 본문 자리의 세로 가운데에 선다', !!emptyFit && emptyFit.gap === 0 && emptyFit.off === 0,
  JSON.stringify(emptyFit));
await clickText('오늘');
await sleep(900);

// 8-b) 나눔 피드 합치기(mergeFeed) — 공유 목록과 '지금 내 묵상 상태'는 **다른 시각의
// 값**이다. 토글은 내 상태를 먼저 바꾸고 목록은 그 다음에 다시 읽어 오므로, 그냥 이어
// 붙이면 사이의 한 프레임에서 같은 글이 두 줄로 섰다(사용자 관찰 2026-09-05 — "공유하기
// 에서 나만 보기로 넘길 때 잠깐 두 개로 보였다가 하나로"). 게스트에서는 목록이 즉시
// 돌아와 그 프레임이 아예 안 나므로, 화면을 흔들지 말고 **합치는 함수에 그 상태를 직접**
// 넣어 본다(homeView.pickService를 페이지 안에서 부르는 것과 같은 방식).
const merged = await ev(`(async () => {
  const m = await import('/src/views/wordView.jsx');
  const a = { id: 'o1', profile_id: 'p2', name: '가', body: '남의 묵상', mine: false };
  const b = { id: 'o2', profile_id: 'p3', name: '나', body: '남의 묵상 2', mine: false };
  const dbMine = { id: 'db1', profile_id: 'p1', name: '노준석', avatarUrl: 'me.png', body: '내 묵상', mine: true };
  const on = { id: 'mine', profile_id: 'p1', body: '내 묵상', mine: true, private: false };
  const off = { id: 'mine', profile_id: 'p1', body: '내 묵상', mine: true, private: true };
  // 되돌아간 코드에서는 내 줄이 아예 없을 수도 있다 — 던지지 말고 답을 돌려준다(§6-40)
  const at = (rows) => rows.findIndex(r => r.mine);
  const mines = (rows) => rows.filter(r => r.mine).length;
  const my = (rows) => rows[at(rows)] || {};
  const stale = m.mergeFeed([a, dbMine, b], off);   // 공유 → 나만 보기 직후(목록이 아직 옛것)
  const back = m.mergeFeed([a, b], on);             // 나만 보기 → 공유 직후(목록에 내 글이 없다)
  const rest = m.mergeFeed([a, dbMine, b], on);     // 목록이 따라온 뒤
  return {
    staleN: stale.length, staleMine: mines(stale), staleAt: at(stale),
    stalePrivate: !!my(stale).private, staleName: my(stale).name, staleAvatar: my(stale).avatarUrl,
    staleId: my(stale).id,
    backN: back.length, backMine: mines(back), backAt: at(back), backId: my(back).id,
    restN: rest.length, restMine: mines(rest), restAt: at(rest), restId: my(rest).id,
    unknown: m.mergeFeed([a, dbMine], undefined).map(r => r.id).join(','),
    removed: m.mergeFeed([a, dbMine], null).map(r => r.id).join(','),
  };
})()`, true);
check('공유를 내린 직후에도 내 묵상은 한 줄이다',
  merged.staleN === 3 && merged.staleMine === 1 && merged.stalePrivate === true,
  JSON.stringify(merged));
check('그 한 줄은 맨 위에 서고 이름·사진을 그대로 이어받는다',
  merged.staleAt === 0 && merged.staleName === '노준석' && merged.staleAvatar === 'me.png',
  JSON.stringify(merged));
check('공유를 켠 직후에도 한 줄이다(목록이 늦어도 사라지지 않는다)',
  merged.backN === 3 && merged.backMine === 1 && merged.backAt === 2, JSON.stringify(merged));
// 목록이 따라오면 자리는 목록이 정한 그대로다 — 새 목록이 왔다고 줄이 움직이지 않는다
check('목록이 따라와도 내 줄의 자리는 그대로다',
  merged.restN === 3 && merged.restMine === 1 && merged.restAt === 1, JSON.stringify(merged));
// 열쇠가 공개 범위를 타면 같은 줄이 언마운트됐다 다시 붙는다(그 자리가 깜빡인다)
check('내 줄의 열쇠는 공개 범위와 상관없이 하나다',
  merged.staleId === 'mine' && merged.backId === 'mine' && merged.restId === 'mine',
  JSON.stringify(merged));
check('아직 내 묵상을 못 읽었으면 목록을 그대로 둔다', merged.unknown === 'o1,db1', merged.unknown);
check('지운 뒤에는 목록에 남은 내 줄도 걷어낸다', merged.removed === 'o1', merged.removed);

// 9) 내 나눔 줄 — 고치기는 '내 묵상' 칸으로, **공유를 조작하는 칸은 그 줄에 없다**
// (사용자 결정 2026-09-05 — "굳이 이 날의 나눔은 눈 표시가 없어도 되지 않을까?" ·
// "토글이 위랑 아래랑 두 번 나온다"). 눈 가리기(공유 해제)와 줄의 토글이 같이 없어졌고,
// 그 줄은 상태만 말한다(비공개면 잠금 표시). 회차 5의 '나눔 지우기 = 공유 해제' 폐기.
const seedBody = seed.entries[today].body;
const mineRow = await ev(`(() => {
  const row = document.querySelector('[data-feed-row="mine"]');
  return {
    row: !!row,
    edit: !!document.querySelector('button[aria-label="내 나눔 고치기"]'),
    eye: !!document.querySelector('button[aria-label="내 나눔 지우기"]'),
    rowToggle: row ? row.querySelectorAll('button[aria-pressed]').length : 0,
    rowChip: row ? row.querySelectorAll('[data-share-chip]').length : 0,
  };
})()`);
check('내 나눔 줄에 고치기가 붙는다', mineRow.row && mineRow.edit, JSON.stringify(mineRow));
check('내 나눔 줄에 눈 가리기(공유 해제)가 없다', mineRow.eye === false, JSON.stringify(mineRow));
check('내 나눔 줄에는 공유 토글·칩이 없다',
  mineRow.rowToggle === 0 && mineRow.rowChip === 0, JSON.stringify(mineRow));
// **조작 가능한 공유 토글은 이 화면에 한 벌뿐이다**(같은 결정) — '내 묵상' 칸의 것.
// 한 벌은 두 쪽(나만 보기·더다붓에 공유하기)이라 벌 수로 센다.
const onlyToggle = await ev(`(() => {
  const bs = [...document.querySelectorAll('button[aria-pressed]')]
    .filter(b => ['나만 보기', '더다붓에 공유하기'].includes(b.textContent.trim()));
  const sets = [...new Set(bs.map(b => b.parentElement))];
  return { buttons: bs.length, sets: sets.length,
    inFeed: sets.filter(s => s.closest('[data-feed-row]')).length,
    inEditor: sets.filter(s => !!s.closest('[data-col="qt"]') && !s.closest('[data-feed-row]')).length };
})()`);
check('조작 가능한 공유 토글은 화면에 한 벌뿐이다',
  onlyToggle.sets === 1 && onlyToggle.buttons === 2
  && onlyToggle.inFeed === 0 && onlyToggle.inEditor === 1, JSON.stringify(onlyToggle));
// 고치기는 같은 글을 두 자리에서 고치지 않는다 — 위의 '내 묵상' 칸으로 데려간다
await waitFor(`document.querySelector('button[aria-label="내 나눔 고치기"]')`);
await clickSel('button[aria-label="내 나눔 고치기"]');
await sleep(600);
check('고치기는 내 묵상 칸에 커서를 준다',
  await ev(`!!document.activeElement && !!document.activeElement.closest('.tiptap')`));
// 공유를 내리는 길도 그 토글 하나다 — 나눔 줄에서 내리는 버튼은 없어졌다
check("편집기 토글의 '나만 보기'를 누른다", (await clickText('나만 보기')) === true);
await sleep(1000);
const afterUnshare = await ev(`(() => {
  const row = document.querySelector('[data-feed-row="mine-private"]');
  const chip = document.querySelector('[data-share-chip]');
  return {
    stored: JSON.parse(localStorage.getItem('word_qt_entries') || '{}')[${JSON.stringify(today)}] || null,
    inEditor: (document.querySelector('.tiptap') || {}).innerText || '',
    // 비공개가 된 내 묵상은 **내 피드에는 남는다**(사용자 결정 2026-09-03)
    privateRow: !!row,
    badge: row ? !!row.querySelector('[data-private]') : false,
    badgeText: row ? row.textContent.includes('나만 보기') : false,
    body: row ? row.textContent.includes(${JSON.stringify(seed.entries[today].body)}) : false,
    others: document.querySelectorAll('[data-feed-row="other"]').length,
    mineRows: document.querySelectorAll('[data-feed-row^="mine"]').length,
    toggle: row ? row.querySelectorAll('button[aria-pressed]').length : 0,
    chips: document.querySelectorAll('[data-share-chip]').length,
    chipText: chip ? chip.textContent : '',
    chipInFeed: chip ? !!chip.closest('[data-feed-row]') : false,
  };
})()`);
check('편집기 토글로 공유만 내린다(묵상은 남는다)',
  !!afterUnshare.stored && afterUnshare.stored.shared === false
  && afterUnshare.stored.body === seedBody,
  JSON.stringify(afterUnshare));
// ② 비공개 묵상도 내 피드에 선다 — '나만 보기' 표시까지(사용자 결정 2026-09-03)
check('비공개 묵상이 내 나눔 피드에 남는다',
  afterUnshare.privateRow && afterUnshare.body && afterUnshare.others === 0,
  JSON.stringify(afterUnshare));
// 두 줄로 보였다가 하나로 합쳐지던 자리다(8-b) — 넘긴 뒤에도 내 줄은 하나뿐이다
check('공유를 내려도 내 줄은 하나뿐이다', afterUnshare.mineRows === 1,
  String(afterUnshare.mineRows));
check("그 줄에 '나만 보기' 표시가 붙는다",
  afterUnshare.badge && afterUnshare.badgeText, JSON.stringify(afterUnshare));
check('비공개가 된 줄에도 공유 토글은 없다', afterUnshare.toggle === 0,
  String(afterUnshare.toggle));
check('내 묵상 칸의 글은 그대로다', afterUnshare.inEditor.includes(seedBody), afterUnshare.inEditor);
// 칩은 **한 자리에서만** 말한다 — 토글 옆(편집기)이다
check("칩이 편집기 옆에서 '나만 볼게요'라고 말한다",
  afterUnshare.chips === 1 && afterUnshare.chipInFeed === false
  && afterUnshare.chipText.includes('나만 볼게요'), JSON.stringify(afterUnshare));
check('공유를 내려도 저장 버튼은 꺼져 있다', (await saveDisabled()) === true);

// 10) 나만 보기 / 더다붓에 공유하기 — **토글은 편집 상태를 건드리지 않는다**(4차 피드백 8)
// 이름은 '나누기'에서 바뀌었다(2026-09-02) — 어디로 나가는지가 이름에 있어야 한다
const shareLabels = await ev(`(() => {
  const t = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  return { now: t.includes('더다붓에 공유하기'), old: t.includes('나누기') };
})()`);
check("공유 토글은 '더다붓에 공유하기'다", shareLabels.now === true, JSON.stringify(shareLabels));
check("'나누기'라는 이름은 남아 있지 않다", shareLabels.old === false);
// **고른 쪽은 확정형**이다(사용자 결정 2026-09-03) — 지금은 '나만 보기'가 골라져 있다
const labelsBefore = await ev(`(() => {
  const bs = [...document.querySelectorAll('button[aria-pressed]')]
    .filter(b => /나만|더다붓/.test(b.textContent));
  return { texts: [...new Set(bs.map(b => b.textContent.trim()))],
           pressed: bs.map(b => b.getAttribute('aria-pressed')), n: bs.length };
})()`);
// **세그먼트 라벨은 고정이다**(사용자 정정 2026-09-03 — 확정형은 칩이 말한다)
check('세그먼트 라벨은 상태와 무관하게 고정이다',
  labelsBefore.texts.sort().join('|') === '나만 보기|더다붓에 공유하기'
  && labelsBefore.pressed.slice(0, 2).join('|') === 'true|false', JSON.stringify(labelsBefore));
check('이미 그 상태인 쪽을 눌러도 저장이 안 켜진다',
  (await clickText('나만 보기')) === true && (await saveDisabled()) === true);
await clickText('더다붓에 공유하기');
await sleep(900);
const shared = await ev(`(() => ({
  stored: JSON.parse(localStorage.getItem('word_qt_entries') || '{}')[${JSON.stringify(today)}] || null,
  chip: (document.querySelector('[data-share-chip]') || {}).textContent || '',
  feed: document.body.innerText.includes(${JSON.stringify(seedBody)}),
  mineRows: document.querySelectorAll('[data-feed-row^="mine"]').length,
}))()`);
check('공유 토글은 저장 버튼을 켜지 않는다', (await saveDisabled()) === true);
check('공유 토글이 그 자리에서 shared만 저장한다',
  !!shared.stored && shared.stored.shared === true && shared.stored.body === seedBody,
  JSON.stringify(shared.stored));
// 칩이 확정형으로 말한다(사용자 정정 2026-09-03) — '공유했어요'가 아니라 '공유할게요'
check("공유하면 칩이 '더다붓에 공유할게요'라고 말한다",
  shared.chip.includes('더다붓에 공유할게요') && !shared.chip.includes('공유했어요'), shared.chip);
const labelsAfter = await ev(`(() => {
  const bs = [...document.querySelectorAll('button[aria-pressed]')]
    .filter(b => /나만|더다붓/.test(b.textContent));
  return { texts: [...new Set(bs.map(b => b.textContent.trim()))] };
})()`);
check('공유를 골라도 라벨은 그대로다',
  labelsAfter.texts.sort().join('|') === '나만 보기|더다붓에 공유하기', JSON.stringify(labelsAfter));
check('공유를 켜면 나눔에 다시 오른다', shared.feed === true);
check('공유를 켜도 내 줄은 하나뿐이다', shared.mineRows === 1, String(shared.mineRows));

// 11) 묵상 저장 — 마크다운 에디터에 쳐 넣고 저장한다(그때만 저장이 켜진다)
await ev(`(() => { const el = document.querySelector('.tiptap'); el.focus(); })()`);
await send('Input.insertText', { text: ' 그리고 한 줄 더' });
await sleep(400);
check('글을 고치면 저장이 켜진다', (await saveDisabled()) === false);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='저장'); b && b.click(); })()`);
await sleep(900);
const mine = await ev(`JSON.parse(localStorage.getItem('word_qt_entries') || '{}')[${JSON.stringify(today)}]`);
check('묵상과 공유 상태가 같이 저장된다',
  mine && mine.body.includes('그리고 한 줄 더') && mine.shared === true, JSON.stringify(mine));
check('저장하고 나면 저장이 다시 꺼진다', (await saveDisabled()) === true);
// 토스트도 토글과 같은 말을 쓴다 — '나눔에 올렸어요'가 아니다
const toast = await ev(`(document.querySelector('[role="status"]') || {}).textContent || ''`);
check('저장 토스트가 토글과 같은 말을 쓴다', toast.includes('더다붓에 공유했어요'), toast);

// 11-b) 진짜 삭제는 '내 묵상' 칸에서만(4차 피드백 8) — 지운 뒤에는 공유할 것이 없다
await ev(`(() => { const b=document.querySelector('button[aria-label="내 묵상 지우기"]'); b && b.click(); })()`);
await sleep(350);
check('내 묵상 지우기는 무엇이 없어지는지 묻는다',
  (await ev(`document.body.innerText.includes('이 날 묵상을 지울까요? 나눔에서도 내려가고 내 기록에서도 빠져요.')`)) === true);
await clickText('삭제');
await sleep(900);
const gone = await ev(`(() => ({
  stored: JSON.parse(localStorage.getItem('word_qt_entries') || '{}')[${JSON.stringify(today)}] || null,
  feedEmpty: document.body.innerText.includes('이 날짜에 올라온 나눔이 아직 없어요'),
  editor: (document.querySelector('.tiptap') || {}).innerText || '',
  toggleOff: [...document.querySelectorAll('button')]
    .filter(b => ['나만 보기', '더다붓에 공유하기'].includes(b.textContent.trim())).every(b => b.disabled),
  trash: !!document.querySelector('button[aria-label="내 묵상 지우기"]'),
}))()`);
check('진짜 삭제는 그 날 묵상을 없앤다', gone.stored === null && gone.feedEmpty && !gone.editor.trim(),
  JSON.stringify(gone));
check('나눔이 비면 한 줄로 말한다',
  (await ev(`(() => { const p=[...document.querySelectorAll('p')].find(x=>x.textContent.includes('올라온 나눔이 아직 없어요')); return !!p && !p.parentElement.querySelector('img[src*="/chars/"]'); })()`)) === true);
check('저장된 글이 없으면 공유 토글은 꺼져 있다', gone.toggleOff === true, JSON.stringify(gone));
check('지울 것이 없으면 휴지통도 없다', gone.trash === false, JSON.stringify(gone));

// 11-c) 남의 나눔은 **마스터만** 지운다(사용자 결정 2026-09-05 · 0045
// qt_entries_delete_master). 공유 해제가 아니라 그 사람의 그날 묵상 행이 없어지므로
// 문구도 그걸 말해야 한다.
// 게스트에는 로그인이 없어 언제나 마스터다(auth.jsx `isMaster = !enabled || …`) — 그래서
// **마스터가 아닌 화면은 만들 수 없다.** 그 갈래는 판정 함수로 보고, 버튼·팝오버·실제
// 삭제는 아래에서 눌러 본다.
const delWho = await ev(`(async () => {
  const m = await import('/src/views/wordView.jsx');
  const other = { id: 'o1', mine: false };
  const mineRow = { id: 'mine', mine: true };
  return [m.canDeleteShared(other, true), m.canDeleteShared(other, false), m.canDeleteShared(mineRow, true)];
})()`, true);
check('남의 나눔 삭제는 마스터에게만, 내 줄에는 안 붙는다',
  JSON.stringify(delWho) === '[true,false,false]', JSON.stringify(delWho));

// 남의 줄을 하나 심는다 — 게스트의 나눔 피드는 여태 내 글 하나뿐이었다(word.js LS.shared)
await ev(`localStorage.setItem('word_qt_shared', ${JSON.stringify(JSON.stringify({ [word.kstToday()]: [{ id: 'other-1', name: '조해리', body: '남이 공유한 묵상 한 줄' }] }))})`);
await reload();
await sleep(1200);
check('다시 말씀으로', await clickText('말씀'));
await sleep(1400);
const otherRow = await ev(`(() => {
  const row = document.querySelector('[data-feed-row="other"]');
  return {
    row: !!row,
    body: row ? row.textContent.includes('남이 공유한 묵상 한 줄') : false,
    del: !!document.querySelector('button[aria-label="이 나눔 지우기"]'),
    // 내 줄에는 안 붙는다 — 그 자리는 '내 묵상' 칸의 휴지통이 맡는다
    mineRows: document.querySelectorAll('[data-feed-row^="mine"]').length,
    edit: !!document.querySelector('button[aria-label="내 나눔 고치기"]'),
  };
})()`);
check('남이 공유한 묵상이 나눔에 선다', otherRow.row && otherRow.body, JSON.stringify(otherRow));
check('마스터에게 남의 줄 삭제 버튼이 붙는다', otherRow.del === true, JSON.stringify(otherRow));
await clickSel('button[aria-label="이 나눔 지우기"]');
await sleep(350);
// 공유 해제가 아니라 그 사람의 묵상이 지워진다는 것을 문구가 말한다
check('남의 나눔 삭제는 무엇이 없어지는지 묻는다',
  (await ev(`document.body.innerText.includes('이 나눔을 지울까요? 공유만 내려가는 게 아니라 그 사람의 이 날 묵상이 지워져요.')`)) === true);
await clickText('삭제');
await sleep(900);
const otherGone = await ev(`(() => ({
  stored: (JSON.parse(localStorage.getItem('word_qt_shared') || '{}')[${JSON.stringify(word.kstToday())}] || []).length,
  rows: document.querySelectorAll('[data-feed-row]').length,
  empty: document.body.innerText.includes('이 날짜에 올라온 나눔이 아직 없어요'),
}))()`);
check('마스터가 지우면 그 줄이 사라진다',
  otherGone.stored === 0 && otherGone.rows === 0 && otherGone.empty, JSON.stringify(otherGone));
await ev(`localStorage.removeItem('word_qt_shared')`);

// ── 성경 읽기 ───────────────────────────────────────────────────────────────
check('세그먼트 전환', await clickText('성경 읽기'));
await sleep(1000);
const toc = await ev(`(() => {
  const t = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  const heads = [...document.querySelectorAll('h3')].map(h => h.textContent.trim());
  return { ot: heads.includes('구약'), nt: heads.includes('신약'),
           gen: t.includes('창세기'), rev: t.includes('요한계시록'), aa: t.filter(x => x === 'Aa').length,
           panes: [...document.querySelectorAll('[data-pane]')].map(b => b.textContent.trim()),
           active: (document.querySelector('[data-pane][aria-pressed="true"]') || {}).dataset?.pane || '',
           marks: heads.includes('북마크') || heads.includes('형광펜'),
           text: document.body.innerText,
           hint: (document.querySelector('input[aria-label="본문 검색"]') || {}).placeholder || '' };
})()`);
check('목차가 구약·신약으로 갈린다', toc.ot && toc.nt && toc.gen && toc.rev, JSON.stringify(toc));
check('글자 크기 Aa 3단계', toc.aa === 3, String(toc.aa));
check("검색 자리표는 '본문 검색'", toc.hint === '본문 검색', toc.hint);
// 4차 피드백 12 — 목차 · 북마크 · 형광펜은 세그먼트로 갈린다. 목차 화면에 두 목록이
// 같이 서 있으면 안 된다(예전에는 좁은 폭에서 목차 위에, 넓은 폭에서 옆 칸에 있었다)
check('목차·북마크·형광펜 세그먼트로 갈린다',
  toc.panes.join('|') === '본문|북마크|형광펜' && toc.active === 'toc', JSON.stringify(toc.panes));
check('목차 화면에는 북마크·형광펜 목록이 없다', toc.marks === false,
  JSON.stringify({ marks: toc.marks }));

// 빈 상태 문구(2026-09-02) — '여기 모입니다'가 아니라 '여기서 볼 수 있어요'.
// 각 칸은 자기 세그먼트에서 본다.
// 빈 상태는 마크와 함께 남는 자리의 가운데에 선다(§8 · 3차 점검) — 지금 보이는 칸만 잰다
const markEmptyFit = (needle) => ev(`(() => {
  const p = [...document.querySelectorAll('p')].filter(x => x.textContent.includes(${JSON.stringify(needle)}))
    .find(x => x.offsetParent !== null);
  if (!p) return null;
  const box = p.parentElement, svg = box.querySelector('svg');
  const b = box.getBoundingClientRect();
  return {
    mark: !!(svg && svg.querySelector('path.dc-draw')),
    align: getComputedStyle(p).textAlign,
    dx: svg ? Math.round((svg.getBoundingClientRect().left + svg.getBoundingClientRect().width / 2) - (b.left + b.width / 2)) : null,
    dy: svg ? Math.round((svg.getBoundingClientRect().top - b.top) - (b.bottom - p.getBoundingClientRect().bottom)) : null,
  };
})()`);
// 마크는 상자의 가로 한가운데 · 위아래 여백이 같아야 한다
const centered = v => !!v && v.mark && v.align === 'center' && Math.abs(v.dx) <= 1 && Math.abs(v.dy) <= 1;

check('북마크 칸으로 간다', await clickSel('[data-pane="bookmark"]'));
await sleep(500);
const bmEmpty = await ev(`document.body.innerText`);
const bmFit = await markEmptyFit('북마크한 장을');
check("북마크 빈 상태 문구", bmEmpty.includes('북마크한 장을 여기서 볼 수 있어요')
  && !bmEmpty.includes('북마크한 장이 여기 모입니다'));
check('북마크 칸에는 형광펜 목록이 없다', !bmEmpty.includes('형광펜을 칠한 절은 여기서'));
check('형광펜 칸으로 간다', await clickSel('[data-pane="highlight"]'));
await sleep(500);
const hlEmpty = await ev(`document.body.innerText`);
check("형광펜 빈 상태 문구", hlEmpty.includes('형광펜을 칠한 절은 여기서 볼 수 있어요')
  && !hlEmpty.includes('형광펜을 그은 절이 여기 모입니다'));
check('형광펜 칸에는 북마크 목록이 없다', !hlEmpty.includes('북마크한 장을 여기서'));
const hlFit = await markEmptyFit('형광펜을 칠한 절은');
check('북마크·형광펜 빈 상태가 마크와 함께 가운데에 선다',
  centered(bmFit) && centered(hlFit), JSON.stringify({ bmFit, hlFit }));
// 말씀 화면에는 캐릭터 컷을 두지 않는다(사용자 결정 2026-09-03 — 홈만 쓴다)
check('말씀 화면에 캐릭터 컷이 없다',
  (await ev(`document.querySelectorAll('img[src*="/chars/"]').length`)) === 0);

check('목차 칸으로 돌아간다', await clickSel('[data-pane="toc"]'));
await sleep(500);
check('창세기', await clickText('창세기'));
await sleep(500);
check('1장', await clickText('1'));
await sleep(1000);
const reader = await ev(`(() => {
  const vs = [...document.querySelectorAll('p[data-verse]')];
  return { head: (document.querySelector('h3') || {}).textContent || '', n: vs.length,
           first: vs[0] ? vs[0].textContent : '' };
})()`);
check('창세기 1장이 열린다', reader.head === '창세기 1장' && reader.n === 31, JSON.stringify(reader));

// ── 장 넘기기: 데스크톱은 따라다니는 화살표(사용자 피드백 2026-09-03) ───────
// 예전에는 이전/다음 장이 본문 **맨 아래**에만 있어서 스크롤을 다 내려야 넘길 수 있었다.
// 이제 본문 양옆 칸에 44px 원형 버튼이 sticky로 서서, 스크롤을 내려도 눈높이에 남는다.
// 성경의 처음(창세기 1장)에는 ◀가 아예 없다.
const scrollTo = (px) => ev(`(() => {
  const el = [...document.querySelectorAll('*')].find(e => {
    const o = getComputedStyle(e).overflowY;
    return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 40;
  });
  const s = el || document.scrollingElement;
  s.scrollTop = ${px};
  return Math.round(s.scrollTop);
})()`);
const navBox = () => ev(`(() => {
  const one = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
             right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height),
             sticky: getComputedStyle(e).position };
  };
  const card = document.querySelector('[data-chap-swipe] > div:nth-child(2)');
  const cr = card ? card.getBoundingClientRect() : null;
  return { prev: one('[data-chap-nav="prev"]'), next: one('[data-chap-nav="next"]'),
           card: cr ? { left: Math.round(cr.left), right: Math.round(cr.right) } : null,
           vh: innerHeight, scroll: Math.round((document.scrollingElement || {}).scrollTop || 0) };
})()`);
await waitFor(`document.querySelector('[data-chap-nav="next"]')`);
const navAt1 = await navBox();
check('창세기 1장에는 이전 장 화살표가 없다', navAt1.prev === null, JSON.stringify(navAt1.prev));
check('다음 장 화살표는 44px이고 본문 오른쪽 밖에 선다',
  !!navAt1.next && navAt1.next.w >= 44 && navAt1.next.h >= 44 && navAt1.next.sticky === 'sticky'
  && !!navAt1.card && navAt1.next.left >= navAt1.card.right - 2,
  JSON.stringify(navAt1));
await scrollTo(700);
await sleep(400);
const navScrolled = await navBox();
check('스크롤을 내려도 화살표가 눈높이에 남는다',
  !!navScrolled.next && navScrolled.next.top >= 0 && navScrolled.next.bottom <= navScrolled.vh + 1,
  JSON.stringify(navScrolled.next));
// **넘기는 동안 자리가 줄지 않는다**(사용자 피드백 2026-09-03 — 본문이 비었다가 채워지며
// 높이가 튀고 스크롤이 점프했다). 스켈레톤이 이전 높이를 붙잡으므로 문서 높이가 아래로
// 꺼지지 않고, sticky 화살표도 제자리에 있어야 한다.
const jump = await ev(`(async () => {
  const card = document.querySelector('[data-chap-swipe] > div:nth-child(2)');
  const arrow = () => document.querySelector('[data-chap-nav="next"]');
  if (!card || !arrow()) return null;
  const doc = () => Math.round(document.documentElement.scrollHeight);
  const before = { h: doc(), card: Math.round(card.getBoundingClientRect().height),
                   arrow: Math.round(arrow().getBoundingClientRect().top) };
  const seen = [];
  let stop = false;
  const tick = () => {
    const a = arrow();
    seen.push({ h: doc(), verses: document.querySelectorAll('p[data-verse]').length,
                arrow: a ? Math.round(a.getBoundingClientRect().top) : -1 });
    if (!stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  arrow().click();
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 16));
    if (document.querySelectorAll('p[data-verse]').length) break;
  }
  stop = true;
  const waiting = seen.filter(x => x.verses === 0);
  return {
    before,
    waited: waiting.length,
    minH: waiting.length ? Math.min(...waiting.map(x => x.h)) : -1,
    arrowDrift: waiting.length ? Math.max(...waiting.map(x => Math.abs(x.arrow - before.arrow))) : -1,
  };
})()`, true);
// 책 파일이 이미 캐시에 있으면 기다리는 프레임이 없다(그때는 꺼질 자리도 없다)
check('넘기는 동안 문서 높이가 꺼지지 않는다',
  !!jump && (jump.waited === 0 || jump.minH >= jump.before.h - 8), JSON.stringify(jump));
check('넘기는 동안 화살표가 제자리에 있다',
  !!jump && (jump.waited === 0 || jump.arrowDrift <= 2), JSON.stringify(jump));
await sleep(1200);
const afterArrow = await ev(`(() => {
  const first = document.querySelector('p[data-verse]');
  const headRow = document.querySelector('[data-chap-head]');
  return { head: (document.querySelector('h3') || {}).textContent || '',
           firstTop: first ? Math.round(first.getBoundingClientRect().top) : -1,
           headTop: headRow ? Math.round(headRow.getBoundingClientRect().top) : -1,
           place: !!document.querySelector('[data-chap-head] .bible-place'),
           prev: !!document.querySelector('[data-chap-nav="prev"]') };
})()`);
check('화살표로 넘기면 그 장이 열린다', afterArrow.head === '창세기 2장', JSON.stringify(afterArrow));
// 넘긴 뒤 눈이 닿는 자리는 **장 제목 줄**이다(사용자 피드백 2026-09-03 — 1절이 아니다).
// 화면 위에 붙은 내비 밑으로 들어가지 않게 여유를 두므로 0~80px 안에 선다.
check('넘긴 뒤 장 제목 줄이 화면 위쪽에 선다',
  afterArrow.headTop >= 0 && afterArrow.headTop <= 80, JSON.stringify(afterArrow));
check('본문 첫 절도 화면 안에 있다', afterArrow.firstTop > 0 && afterArrow.firstTop < 400,
  JSON.stringify(afterArrow));
check('첫 장이 아니면 이전 장 화살표가 생긴다', afterArrow.prev === true);
check('이전 장 화살표로 되돌아온다', await clickSel('[data-chap-nav="prev"]'));
await sleep(1200);
check('되돌아오면 창세기 1장이다',
  (await ev(`(document.querySelector('h3')||{}).textContent || ''`)) === '창세기 1장');
await scrollTo(0);
await sleep(300);
check("창세기 1:1에 '태초에 하나님이'", reader.first.includes('태초에 하나님이 천지를 창조하시니라'), reader.first);

// 글자 크기 3단계 — 실제 font-size가 바뀌고 기기에 남는다
const fonts = await ev(`(async () => {
  const size = () => getComputedStyle(document.querySelector('p[data-verse]')).fontSize;
  const aa = [...document.querySelectorAll('button[aria-label]')].filter(b => b.getAttribute('aria-label').startsWith('글자'));
  if (aa.length < 3) return { mid: '0px', big: '0px', small: '0px', stored: '' };
  const out = { mid: size() };
  aa[2].click(); await new Promise(r => setTimeout(r, 150)); out.big = size();
  aa[0].click(); await new Promise(r => setTimeout(r, 150)); out.small = size();
  out.stored = localStorage.getItem('word_bible_font');
  aa[1].click(); await new Promise(r => setTimeout(r, 100));
  return out;
})()`, true);
check('Aa 3단계가 본문 크기를 바꾼다',
  parseFloat(fonts.small) < parseFloat(fonts.mid) && parseFloat(fonts.mid) < parseFloat(fonts.big),
  JSON.stringify(fonts));
check('고른 글자 크기가 기기에 남는다', fonts.stored === '0', String(fonts.stored));

// 형광펜 — **절을 눌러도 바로 칠해지지 않는다**(2026-09-02). 그 절 **바로 아래**에 도구
// 줄이 붙고, 거기서 고를 때 칠해진다. 취소는 바깥 누름과 Esc.
//
// **도구 줄은 좌표를 재지 않는다**(2026-09-03 — "형광펜 칠하기 버튼이 아직도 엉뚱한 곳에
// 뜬다"). 포털+useAnchoredPos를 버리고 눌린 절의 다음 형제로 문서 흐름 안에 그린다.
// 그래서 검사도 "절의 bottom과 도구 줄의 top이 8px 안"인지를 잰다 — 어긋나면 그 자리에
// 없는 것이다. 대상 절에는 표시(dc-verse-picked · data-picked)가 붙는다.
const tool = await ev(`(async () => {
  const p0 = document.querySelector('p[data-verse="1:3"]');
  if (!p0) return null;
  p0.click();
  await new Promise(r => setTimeout(r, 250));   // 리액트가 도구 줄을 그릴 틈
  const p = document.querySelector('p[data-verse="1:3"]');   // 그린 뒤의 그 절을 다시 잡는다
  const t = document.querySelector('[data-verse-tool]');
  if (!t) return null;
  const b = t.getBoundingClientRect(), r = p.getBoundingClientRect();
  const st = JSON.parse(localStorage.getItem('word_bible_state') || '{}');
  return {
    label: t.dataset.verseTool || '',
    text: t.textContent.trim(),
    gap: Math.round(b.top - r.bottom),
    inFlow: t.parentElement && t.parentElement.parentElement === p.parentElement,
    sameLeft: Math.round(b.left - r.left),
    fixed: getComputedStyle(t).position,
    chips: [...t.querySelectorAll('[data-hl-color]')].map(c => c.dataset.hlColor),
    chipTag: [...t.querySelectorAll('[data-hl-color]')].map(c => c.tagName),
    chipPad: (() => {
      const cs = [...t.querySelectorAll('[data-hl-color]')];
      const last = cs[cs.length - 1];
      return last ? Math.round(t.getBoundingClientRect().right - last.getBoundingClientRect().right) : 0;
    })(),
    picked: p.dataset.picked === '1' && p.className.includes('dc-verse-picked'),
    expanded: p.getAttribute('aria-expanded'),
    painted: p.dataset.mark === '1', stored: (st.highlights || []).length,
  };
})()`, true);
check('절을 눌러도 바로 칠해지지 않는다', !!tool && tool.painted === false && tool.stored === 0,
  JSON.stringify(tool));
check('도구 줄이 눌린 절 바로 아래에 붙는다',
  !!tool && tool.gap >= 0 && tool.gap <= 8 && tool.inFlow === true && tool.fixed === 'static',
  JSON.stringify(tool));
check('도구 줄은 절과 같은 왼쪽에서 시작한다', !!tool && Math.abs(tool.sameLeft) <= 8, JSON.stringify(tool));
check('대상 절에 표시가 붙는다', !!tool && tool.picked === true && tool.expanded === 'true',
  JSON.stringify(tool));
// 색 네 가지(빨·파·노·초)가 **누르면 칠하는 버튼**이고, 오른쪽에 여백이 있다
check('도구 줄에 색 칩 네 개가 버튼으로 있다',
  !!tool && tool.chips.join(',') === 'red,blue,yellow,green' && tool.chipTag.every(t => t === 'BUTTON'),
  JSON.stringify({ chips: tool && tool.chips, tag: tool && tool.chipTag }));
check('마지막 칩 오른쪽에 여백이 있다', !!tool && tool.chipPad >= 6, String(tool && tool.chipPad));
check("'형광펜 긋기'라는 이름은 남아 있지 않다", !!tool && tool.text.includes('긋기') === false, tool && tool.text);
check('도구 줄이 어느 절의 것인지 이름에 있다', !!tool && tool.label.includes('1:3'), tool && tool.label);

// **다른 절을 누르면 범위가 된다**(사용자 결정 2026-09-03 — 앵커 방식). 도구 줄은 범위의
// 마지막 절 아래로 옮겨 가고, 좌표를 안 재므로 어긋날 자리가 없다.
const moved = await ev(`(async () => {
  const p1 = document.querySelector('p[data-verse="1:5"]');
  if (!p1) return null;
  p1.click();
  await new Promise(r => setTimeout(r, 300));
  const p = document.querySelector('p[data-verse="1:5"]');
  const t = document.querySelector('[data-verse-tool]');
  if (!t) return null;
  const b = t.getBoundingClientRect(), r = p.getBoundingClientRect();
  return {
    label: t.dataset.verseTool || '',
    gap: Math.round(b.top - r.bottom),
    only: document.querySelectorAll('[data-verse-tool]').length,
    marked: [...document.querySelectorAll('p[data-picked="1"]')].map(x => x.dataset.verse),
  };
})()`, true);
check('다른 절을 누르면 범위가 되고 도구 줄이 그 끝으로 간다',
  !!moved && moved.label.includes('1:3~5') && moved.gap >= 0 && moved.gap <= 8
  && moved.only === 1 && moved.marked.join(',') === '1:3,1:4,1:5',
  JSON.stringify(moved));

// 바깥을 누르면 닫힌다(도구 줄은 document의 mousedown을 듣는다)
await ev(`(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))()`);
await sleep(250);
check('바깥 누름으로 도구 줄이 닫힌다', (await ev(`!document.querySelector('[data-verse-tool]')`)) === true);

// Esc로도 닫힌다 — 그래도 아무것도 안 칠해져 있다
await clickSel('p[data-verse="1:3"]');
await sleep(250);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(250);
const escaped = await ev(`(() => ({ open: !!document.querySelector('[data-verse-tool]'),
  painted: document.querySelector('p[data-verse="1:3"]').dataset.mark === '1' }))()`);
check('Esc로 취소된다', escaped.open === false && escaped.painted === false, JSON.stringify(escaped));

// [형광펜 칠하기]를 눌러야 그때 칠해진다
await clickSel('p[data-verse="1:3"]');
await sleep(250);
check('노랑 칩을 눌러 칠한다', await clickSel('[data-verse-tool] [data-hl-color="yellow"]'));
await sleep(600);
// **글자가 있는 자리만 칠해진다**(4차 피드백 11). 절 상자의 배경은 투명하고, 색은 절 안의
// 인라인 mark가 든다 — 짧은 절이면 그 폭이 상자보다 확실히 좁다(예전에는 상자째 노랬다).
const lit = await ev(`(() => {
  const p = document.querySelector('p[data-verse="1:3"]');
  const st = JSON.parse(localStorage.getItem('word_bible_state') || '{}');
  const m = p.querySelector('mark[data-lit]');
  const box = p.getBoundingClientRect();
  const cs = m ? getComputedStyle(m) : null;
  return { on: p.dataset.mark === '1', bg: getComputedStyle(p).backgroundColor,
           inline: !!m, markBg: cs ? cs.backgroundColor : '',
           clone: cs ? (cs.boxDecorationBreak || cs.webkitBoxDecorationBreak || '') : '',
           narrower: m ? Math.round(box.width - m.getBoundingClientRect().width) : -1,
           refs: (st.highlights || []).map(h => h.ref),
           colors: (st.highlights || []).map(h => h.color || ''),
           markColor: m ? m.dataset.lit : '',
           closed: !document.querySelector('[data-verse-tool]') };
})()`);
check('고를 때 비로소 형광펜이 켜진다', lit.on === true, JSON.stringify(lit));
check('고르고 나면 팝오버는 닫힌다', lit.closed === true);
check("형광펜은 절 단위로 남는다('gen 1:3')", JSON.stringify(lit.refs) === JSON.stringify(['gen 1:3']),
  JSON.stringify(lit.refs));
check('고른 색이 함께 남는다', lit.colors.join(',') === 'yellow' && lit.markColor === 'yellow',
  JSON.stringify({ colors: lit.colors, mark: lit.markColor }));
check('형광펜은 절 상자가 아니라 글자에 칠해진다',
  lit.inline === true && /rgba\(0, 0, 0, 0\)|transparent/.test(lit.bg) && lit.narrower > 40,
  JSON.stringify({ bg: lit.bg, markBg: lit.markBg, narrower: lit.narrower }));
check('여러 줄로 감겨도 줄마다 글자 폭만 칠해진다(box-decoration-break)',
  lit.clone === 'clone', lit.clone);

// '내 기록'은 형광펜 칸에서 본다(세그먼트) — 책이 한 권이면 기본은 펼침
check('형광펜 칸으로 간다', await clickSel('[data-pane="highlight"]'));
await sleep(900);
const litRow = await ev(`(() => {
  const g = document.querySelector('[data-book-group="highlight:gen"]');
  const row = document.querySelector('[data-goto="gen 1:3"]');
  return { row: !!row, groupOpen: g ? g.getAttribute('aria-expanded') : '',
           colored: !!(row && row.querySelector('mark[data-lit]')) };
})()`);
check("형광펜 칸에 그 절이 선다", litRow.row === true, JSON.stringify(litRow));
// 책이 두 권까지면 접힌 껍데기가 오히려 손이 더 간다 — 기본 펼침
check('책이 두 권까지면 기본은 펼침', litRow.groupOpen === 'true', String(litRow.groupOpen));
check('형광펜 줄의 발췌에 색이 보인다', litRow.colored === true, JSON.stringify(litRow));
check('목차 칸으로 돌아간다', await clickSel('[data-pane="toc"]'));
await sleep(700);

// ── 범위 고르기(사용자 결정 2026-09-03) ────────────────────────────────────
// 앵커 방식: 첫 클릭이 앵커, 다음 클릭이 그 사이를 범위로 만든다. 늘리기와 줄이기가
// 같은 손짓이고(1~6에서 5를 누르면 1~5), 앵커를 다시 누르면 해제다.
const clickVerses = (list) => ev(`(async () => {
  for (const v of ${JSON.stringify(list)}) {
    const p = document.querySelector('p[data-verse="1:' + v + '"]');
    // 실제 손처럼 mousedown을 먼저 보낸다 — 바깥 누름 감지가 절을 '바깥'으로 알아듣던
    // 버그(2026-09-05)는 click()만으로는 안 보였다
    if (p) { p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); p.click(); }
    await new Promise(r => setTimeout(r, 220));
  }
  const marked = [...document.querySelectorAll('p[data-picked="1"]')].map(x => x.dataset.verse);
  const t = document.querySelector('[data-verse-tool]');
  const at = t ? t.parentElement.previousElementSibling : null;
  return { marked, label: t ? t.dataset.verseTool : '', toolAfter: at ? at.dataset.verse : '' };
})()`, true);
const esc = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(250);
};
// 4 → 1: 앵커가 4라도 범위는 1~4
const r41 = await clickVerses([4, 1]);
check('4를 누른 뒤 1을 누르면 1~4가 된다',
  r41.marked.join(',') === '1:1,1:2,1:3,1:4' && r41.label.includes('1:1~4'), JSON.stringify(r41));
check('도구 줄은 범위의 마지막 절 아래에 선다', r41.toolAfter === '1:4', JSON.stringify(r41));
await esc();
check('Esc로 범위가 해제된다',
  (await ev(`document.querySelectorAll('p[data-picked="1"]').length`)) === 0);
// 1 → 4: 같은 범위
const r14 = await clickVerses([1, 4]);
check('1을 누른 뒤 4를 누르면 1~4가 된다',
  r14.marked.join(',') === '1:1,1:2,1:3,1:4' && r14.label.includes('1:1~4'), JSON.stringify(r14));
// 1~4에서 6을 누르면 1~6으로 늘어난다
const r6 = await clickVerses([6]);
check('범위 밖을 누르면 그만큼 늘어난다',
  r6.marked.length === 6 && r6.label.includes('1:1~6'), JSON.stringify(r6));
// 1~6에서 5를 누르면 1~5로 줄어든다(역으로 취소)
const r5 = await clickVerses([5]);
check('범위 안을 누르면 그만큼 줄어든다',
  r5.marked.join(',') === '1:1,1:2,1:3,1:4,1:5' && r5.label.includes('1:1~5'), JSON.stringify(r5));
// 앵커(1)를 다시 누르면 해제
const rOff = await clickVerses([1]);
check('앵커를 다시 누르면 해제된다', rOff.marked.length === 0 && rOff.label === '',
  JSON.stringify(rOff));

// 범위 전체를 한 번에 칠하고 지운다 — 색은 파랑으로
const r24 = await clickVerses([2, 4]);
check('2~4를 고른다', r24.marked.length === 3, JSON.stringify(r24));
check('파랑 칩으로 범위를 칠한다', await clickSel('[data-verse-tool] [data-hl-color="blue"]'));
await sleep(800);
const painted = await ev(`(() => {
  const st = JSON.parse(localStorage.getItem('word_bible_state') || '{}');
  const marks = [...document.querySelectorAll('p[data-verse] mark[data-lit]')]
    .map(m => m.closest('p').dataset.verse + ':' + m.dataset.lit);
  return { stored: (st.highlights || []).filter(h => /1:[234]$/.test(h.ref)).map(h => h.ref + '=' + (h.color || '')),
           marks, closed: !document.querySelector('[data-verse-tool]'),
           picked: document.querySelectorAll('p[data-picked="1"]').length };
})()`);
check('범위 전체가 그 색으로 칠해진다',
  painted.stored.join(',') === 'gen 1:2=blue,gen 1:3=blue,gen 1:4=blue', JSON.stringify(painted.stored));
check('덧칠하면 같은 절이 두 번 남지 않는다',
  painted.marks.filter(m => m.startsWith('1:3')).length === 1, JSON.stringify(painted.marks));
check('칠한 뒤에는 선택과 도구 줄이 사라진다', painted.closed && painted.picked === 0,
  JSON.stringify(painted));

// ── 모아보기에는 범위가 한 줄이다(사용자 지시 2026-09-05) ──────────────────
// 저장은 절 단위지만 paintRange가 범위의 모든 절에 같은 at을 찍으므로 이어진 절은 한 줄로
// 묶인다(wordBible mergeRuns). 그 줄의 X는 범위 전체를 지운다. 지운 뒤에는 뒤 검사가 볼
// 상태를 되돌려 놓는다(리더에서 같은 범위를 다시 칠한다).
check('범위를 칠한 뒤 형광펜 칸으로 간다', await clickSel('[data-pane="highlight"]'));
await sleep(900);
const runRow = await ev(`(() => {
  const rows = [...document.querySelectorAll('[data-goto]')];
  const g = document.querySelector('[data-book-group="highlight:gen"]');
  const x = rows[0] ? rows[0].parentElement.querySelector('button[aria-label]') : null;
  return { n: rows.length, goto: rows[0] ? rows[0].dataset.goto : '',
           num: rows[0] ? (rows[0].querySelector('span.tabular-nums') || {}).textContent : '',
           head: g ? g.textContent.trim() : '',
           x: x ? x.getAttribute('aria-label') : '' };
})()`);
check('범위로 칠한 것은 형광펜 칸에 한 줄로 선다', runRow.n === 1 && runRow.goto === 'gen 1:2',
  JSON.stringify(runRow));
check('그 줄의 이름이 범위다(1:2~4)',
  runRow.num === '1:2~4' && runRow.x === '창세기 1:2~4 형광펜 지우기', JSON.stringify(runRow));
check('머리글 개수는 줄이 아니라 절로 센다', runRow.n === 1 && runRow.head === '창세기3절',
  JSON.stringify(runRow));
check('범위 줄의 X를 누른다', (await ev(`(() => {
  const row = document.querySelector('[data-goto="gen 1:2"]');
  const x = row && row.parentElement.querySelector('button[aria-label]');
  if (!x) return false;
  x.click(); return true;
})()`)) === true);
await sleep(900);
const runGone = await ev(`(() => ({
  left: (JSON.parse(localStorage.getItem('word_bible_state') || '{}').highlights || []).map(h => h.ref),
  rows: document.querySelectorAll('[data-goto]').length,
}))()`);
check('범위 줄을 지우면 그 범위의 절이 다 사라진다',
  runGone.left.length === 0 && runGone.rows === 0, JSON.stringify(runGone));
// 뒤 검사(지우기도 범위 전체다)가 볼 상태로 되돌린다
check('리더로 돌아간다', await clickSel('[data-pane="toc"]'));
await sleep(700);
const again = await clickVerses([2, 4]);
check('같은 범위를 다시 고른다', again.marked.length === 3, JSON.stringify(again));
check('파랑으로 다시 칠한다', await clickSel('[data-verse-tool] [data-hl-color="blue"]'));
await sleep(800);

// 지우기도 범위 전체다
const rErase = await clickVerses([2, 4]);
check('다시 2~4를 고르면 [형광펜 지우기]가 뜬다',
  rErase.marked.length === 3
  && (await ev(`((document.querySelector('[data-verse-tool]')||{}).textContent||'').includes('형광펜 지우기')`)) === true,
  JSON.stringify(rErase));
check('지금 색이 칩에 표시된다',
  (await ev(`(document.querySelector('[data-verse-tool] [data-hl-color="blue"]')||{}).getAttribute?.('aria-pressed')`)) === 'true');
await clickText('형광펜 지우기');
await sleep(800);
const erased = await ev(`(() => {
  const st = JSON.parse(localStorage.getItem('word_bible_state') || '{}');
  return { left: (st.highlights || []).map(h => h.ref),
           marks: document.querySelectorAll('p[data-verse] mark[data-lit]').length };
})()`);
check('범위 전체의 형광펜이 지워진다', erased.left.length === 0 && erased.marks === 0,
  JSON.stringify(erased));

// 색 칸이 없는 예전 항목은 노랑으로 읽는다(0038로 들어간 항목에는 색이 없다)
await ev(`(() => {
  const st = JSON.parse(localStorage.getItem('word_bible_state') || '{}');
  st.highlights = [{ ref: 'gen 1:3', at: '2026-09-01T00:00:00Z' }];
  localStorage.setItem('word_bible_state', JSON.stringify(st));
})()`);
await reload();
await sleep(1500);
await clickText('말씀'); await sleep(1400);
await clickText('성경 읽기'); await sleep(1800);
await waitFor(`document.querySelector('p[data-verse="1:3"]')`);
check('색이 없는 예전 형광펜은 노랑으로 보인다',
  (await ev(`(document.querySelector('p[data-verse="1:3"] mark[data-lit]')||{}).dataset?.lit`)) === 'yellow');

// 이미 그어져 있으면 지우는 쪽을 준다 · 같은 절을 다시 누르면 닫힌다
await waitFor(`document.querySelector('p[data-verse="1:3"]')`);
await clickSel('p[data-verse="1:3"]');
await sleep(300);
check('이미 그어져 있으면 [형광펜 지우기]가 뜬다',
  (await ev(`((document.querySelector('[data-verse-tool]')||{}).textContent || '').trim()`)) === '형광펜 지우기');
await clickSel('p[data-verse="1:3"]');
await sleep(300);
check('같은 절을 다시 누르면 닫힌다', (await ev(`!document.querySelector('[data-verse-tool]')`)) === true);

// 북마크 · 이어읽기
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'').includes('북마크')); b && b.click(); })()`);
await sleep(500);
const state = await ev(`JSON.parse(localStorage.getItem('word_bible_state') || '{}')`);
check('북마크는 장 단위로 잡힌다',
  state.bookmarks?.length === 1 && state.bookmarks[0].ref === 'gen 1' && state.bookmarks[0].label === '창세기 1장',
  JSON.stringify(state.bookmarks));
check('이어읽기 자리가 남는다', state.lastRef === 'gen 1', String(state.lastRef));

// 다음 장 → 이어읽기가 따라간다 → 화면 전환이 장을 물고 있다.
// **슬라이드가 실제로 도는지 프레임을 훑어 본다**(2026-09-02 — 12px·전환이 시작조차
// 안 되던 것을 잡는 검사다). rAF로 transform의 X를 모으면, 안 돌 때는 값이 둘뿐이고
// (시작 자리 → none) 돌 때는 여러 값이 이어진다. 최대 이동은 12px보다 확실히 커야 한다.
const slide = await ev(`(async () => {
  const pick = () => document.querySelector('[data-swap^="p:"]');
  const tx = (t) => {
    const m = /matrix(3d)?\\(([^)]+)\\)/.exec(t || '');
    if (!m) return 0;
    const n = m[2].split(',').map(Number);
    return Math.abs(n.length > 6 ? n[12] : n[4]);
  };
  const seen = [];
  let stop = false;
  const tick = () => { const e = pick(); if (e) seen.push(tx(getComputedStyle(e).transform)); if (!stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '다음 장');
  if (!b) return { clicked: false };
  b.click();
  await new Promise(r => setTimeout(r, 800));
  stop = true;
  return { clicked: true, frames: seen.length, max: Math.max(0, ...seen),
           steps: new Set(seen.map(v => v.toFixed(1))).size };
})()`, true);
await sleep(400);
const ch2 = await ev(`(() => ({ head: (document.querySelector('h3')||{}).textContent || '',
  last: JSON.parse(localStorage.getItem('word_bible_state')||'{}').lastRef,
  swaps: [...document.querySelectorAll('[data-swap]')].map(e => e.dataset.swap) }))()`);
check('다음 장', slide.clicked === true);
check('다음 장으로 넘어간다', ch2.head === '창세기 2장' && ch2.last === 'gen 2', JSON.stringify(ch2));
check('장 전환이 화면 전환을 탄다', ch2.swaps.includes('p:gen 2'), JSON.stringify(ch2.swaps));
// 예전 ±12px이면 max가 12를 넘지 못하고, 전환이 안 걸리면 steps가 2다
check('장 전환 슬라이드가 눈에 보일 만큼 움직인다', slide.max >= 16,
  JSON.stringify(slide));
check('슬라이드가 실제로 프레임을 돈다(전환이 시작된다)', slide.steps >= 4,
  JSON.stringify(slide));

// 형광펜 줄을 누르면 그 절로 돌아간다 — **본문을 읽는 중에도 세그먼트는 그 자리에 있다**
// (4차 피드백 11 — 예전에는 좁은 폭에서 리더에 있는 동안 두 목록에 닿을 길이 없었다)
check('본문을 읽는 중에도 형광펜 칸으로 갈 수 있다', await clickSel('[data-pane="highlight"]'));
await sleep(1000);
check("형광펜 칸에 그 절 줄이 남아 있다", await clickSel('[data-goto="gen 1:3"]'));
await sleep(1200);
const back = await ev(`(() => ({ head: (document.querySelector('h3')||{}).textContent || '',
  focus: (document.querySelector('[data-focus="1"]')||{}).dataset?.verse || '',
  pane: (document.querySelector('[data-pane][aria-pressed="true"]') || {}).dataset?.pane || '' }))()`);
check('형광펜 줄을 누르면 그 절로 간다', back.head === '창세기 1장' && back.focus === '1:3',
  JSON.stringify(back));
check('줄을 누르면 본문 칸으로 돌아온다', back.pane === 'toc', back.pane);

check('북마크 칸에 그 장이 있다', await clickSel('[data-pane="bookmark"]'));
await sleep(700);
check('북마크한 장이 북마크 칸에 선다',
  await ev(`!!document.querySelector('[data-goto="gen 1"]')`));
await clickSel('[data-pane="toc"]');
await sleep(500);
check('책 목록으로', await clickText('목차'));
await sleep(500);

// '(없음)' — 데이터는 그대로 두고 화면에서만 흐리게(public/bible/README.md)
check('마가복음', await clickText('마가복음'));
await sleep(500);
check('9장', await clickText('9'));
await sleep(1000);
const blank = await ev(`(() => {
  const a = document.querySelector('p[data-verse="9:44"]');
  const b = document.querySelector('p[data-verse="9:45"]');
  if (!a || !b) return null;
  return { text: a.textContent, faint: getComputedStyle(a).color !== getComputedStyle(b).color,
           kept: a.textContent.includes('(없음)') };
})()`);
check('막 9:44 (없음) 절이 사라지지 않는다', blank && blank.kept, JSON.stringify(blank));
check('(없음)은 화면에서만 흐리게', blank && blank.faint === true, JSON.stringify(blank));

// 본문 검색 — 전권을 훑어 includes 매치
await ev(`(() => {
  const i = document.querySelector('input[aria-label="본문 검색"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '태초에');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
})()`);
const found = await ev(`(async () => {
  for (let i = 0; i < 90; i++) {
    if (!document.body.innerText.includes('훑는 중')) {
      const rows = [...document.querySelectorAll('button[data-hit]')];
      if (rows.length) return { n: rows.length, first: rows[0].dataset.hit, marks: document.querySelectorAll('mark').length };
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return { n: 0, first: '', marks: 0 };
})()`, true);
check('본문 검색이 절을 찾는다', found.n > 0 && found.first === 'gen 1:1', JSON.stringify(found));
check('찾은 말이 결과에 표시된다', found.marks > 0, String(found.marks));
await clickSel('button[data-hit]');
await sleep(1000);
const jumped = await ev(`(() => ({ head: (document.querySelector('h3')||{}).textContent || '',
  focus: (document.querySelector('[data-focus="1"]')||{}).textContent || '' }))()`);
check('결과를 누르면 그 장으로 간다', jumped.head === '창세기 1장' && jumped.focus.includes('태초에'),
  JSON.stringify(jumped));

// 못 찾았을 때의 빈 자리 — question 컷(사용자 결정 2026-09-03). 책 파일은 이미 받아 둔
// 것이라 두 번째 검색은 훑기만 한다.
await ev(`(() => {
  const i = document.querySelector('input[aria-label="본문 검색"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '없는말없는말');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
})()`);
const noHit = await ev(`(async () => {
  for (let i = 0; i < 90; i++) {
    if (!document.body.innerText.includes('훑는 중')) {
      const p = [...document.querySelectorAll('p')].find(x => x.textContent.includes('그대로 나오는 절을 찾지 못했어요'));
      if (p) {
        const svg = p.parentElement.querySelector('svg path.dc-draw');
        return { said: true, mark: !!svg };
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return { said: false, mark: false };
})()`, true);
check('못 찾으면 왜 못 찾았는지까지 말한다', noHit.said === true, JSON.stringify(noHit));
check('검색 빈 자리도 마크로 그린다', noHit.mark === true, JSON.stringify(noHit));
await clickSel('button[aria-label="검색어 지우기"]');
await sleep(600);

// ── 북마크·형광펜이 쌓였을 때 (2026-09-02) ─────────────────────────────────
// 여러 권에 걸쳐 심어 두고 다시 연다. 책으로 묶이는지 · 정경 순인지 ·
// 세 권부터는 접혀 있는지 · **펼친 책의 파일만 그때 받는지**를 본다.
// 두 목록은 이제 각자의 세그먼트에 있으므로 칸을 옮겨 가며 본다(4차 피드백 12).
// 리소스 타이밍은 새로 연 문서마다 비어 있으므로 앞의 전권 검색은 섞이지 않는다.
await ev(`(() => {
  localStorage.setItem('word_bible_state', JSON.stringify({
    lastRef: 'gen 1',
    bookmarks: [
      { ref: 'gen 1', label: '창세기 1장' },
      { ref: 'exo 3', label: '출애굽기 3장' },
      { ref: 'psa 23', label: '시편 23장' },
    ],
    highlights: [
      { ref: 'gen 1:3', at: '2026-09-01T00:00:00Z' },
      { ref: 'gen 1:1', at: '2026-09-02T00:00:00Z' },
      { ref: 'exo 3:14', at: '2026-09-02T01:00:00Z' },
      { ref: 'jhn 3:16', at: '2026-09-02T02:00:00Z' },
    ],
  }));
})()`);
await reload();
await sleep(1400);
await clickText('말씀');
await sleep(1400);
await clickText('성경 읽기');
await sleep(1600);
const marksOf = () => ev(`(() => {
  const g = [...document.querySelectorAll('[data-book-group]')];
  return {
    books: g.map(b => b.dataset.bookGroup),
    open: g.map(b => b.getAttribute('aria-expanded')),
    heads: g.map(b => b.textContent.trim()),
    rows: [...document.querySelectorAll('[data-goto]')].length,
    files: performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/bible/')).map(n => n.split('/').pop()),
  };
})()`);
await clickSel('[data-pane="bookmark"]');
await sleep(900);
const stackedBm = await marksOf();
await clickSel('[data-pane="highlight"]');
await sleep(900);
const stackedHl = await marksOf();
check('북마크·형광펜이 책으로 묶인다',
  stackedBm.books.length === 3 && stackedHl.books.length === 3,
  JSON.stringify({ bm: stackedBm.books, hl: stackedHl.books }));
check('책은 정경 순으로 선다',
  stackedBm.books.join() === 'bookmark:gen,bookmark:exo,bookmark:psa'
  && stackedHl.books.join() === 'highlight:gen,highlight:exo,highlight:jhn',
  JSON.stringify({ bm: stackedBm.books, hl: stackedHl.books }));
check('책 머리글에 개수가 붙는다', stackedHl.heads.join('|') === '창세기2절|출애굽기1절|요한복음1절',
  JSON.stringify(stackedHl.heads));
check('책이 셋을 넘으면 기본은 접힘',
  [...stackedBm.open, ...stackedHl.open].every(v => v === 'false')
  && stackedBm.rows === 0 && stackedHl.rows === 0,
  JSON.stringify({ open: [...stackedBm.open, ...stackedHl.open], rows: stackedHl.rows }));
check('접혀 있는 동안에는 그 책 파일을 받지 않는다',
  !stackedHl.files.includes('exo.json') && !stackedHl.files.includes('psa.json') && !stackedHl.files.includes('jhn.json'),
  JSON.stringify(stackedHl.files));

// 한 책을 펼치면 그때 그 책만 받고, 절 미리보기가 한 줄 붙는다
check('요한복음 형광펜 묶음을 편다', await clickSel('[data-book-group="highlight:jhn"]'));
await sleep(1600);
const opened = await ev(`(() => ({
  rows: [...document.querySelectorAll('[data-goto]')].map(b => ({ ref: b.dataset.goto, text: b.textContent.trim() })),
  files: performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/bible/')).map(n => n.split('/').pop()),
  others: [...document.querySelectorAll('[data-book-group="highlight:exo"], [data-book-group="highlight:gen"]')]
    .map(b => b.getAttribute('aria-expanded')),
}))()`);
check('펼친 책만 줄이 선다', opened.rows.length === 1 && opened.rows[0].ref === 'jhn 3:16',
  JSON.stringify(opened.rows));
check('형광펜 줄에 절 미리보기가 한 줄 붙는다', opened.rows[0]?.text.includes('하나님이 세상을 이처럼 사랑하사'),
  JSON.stringify(opened.rows[0]));
check('펼친 책의 파일만 그때 받는다',
  opened.files.includes('jhn.json') && !opened.files.includes('exo.json') && !opened.files.includes('psa.json'),
  JSON.stringify(opened.files));
check('펼치지 않은 책은 그대로 접혀 있다', opened.others.every(v => v === 'false'), JSON.stringify(opened.others));

// 북마크는 장 제목이면 되므로 펼쳐도 책 파일을 받지 않는다
await clickSel('[data-pane="bookmark"]');
await sleep(700);
check('시편 북마크 묶음을 편다', await clickSel('[data-book-group="bookmark:psa"]'));
await sleep(1200);
const bmOpen = await ev(`(() => ({
  rows: [...document.querySelectorAll('[data-goto="psa 23"]')].map(b => b.textContent.trim()),
  files: performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/bible/')).map(n => n.split('/').pop()),
}))()`);
check('북마크는 장 제목만 보여준다', bmOpen.rows.join() === '23장', JSON.stringify(bmOpen.rows));
check('북마크를 펼쳐도 책 파일은 받지 않는다', !bmOpen.files.includes('psa.json'), JSON.stringify(bmOpen.files));

// 줄을 누르면 그 자리로 간다(묶여도 그대로다)
check('시편 23장 줄을 누른다', await clickSel('[data-goto="psa 23"]'));
await sleep(1400);
check('묶인 줄을 눌러도 그 자리로 간다',
  (await ev(`(document.querySelector('h3')||{}).textContent || ''`)) === '시편 23장');

// ── 모바일 375px ────────────────────────────────────────────────────────────
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await reload();
await sleep(1400);
await ev(`(() => { const g=document.querySelector('button[title="설정"]'); g && g.click(); })()`);
await sleep(400);
check('모바일에서도 말씀으로 갈 수 있다', await clickText('말씀'));
await sleep(1600);
const mob = await ev(`(() => {
  const d = document.documentElement;
  const picker = document.querySelector('button[aria-label="QT 날짜 고르기"]');
  const row = picker ? picker.parentElement.parentElement : null;
  return { over: d.scrollWidth > d.clientWidth + 1, verses: document.querySelectorAll('p[data-verse]').length,
           seg: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '성경 읽기'),
           tiptap: !!document.querySelector('.tiptap'),
           // 날짜 줄(화살표 · 데이트피커 · 오늘)이 한 줄에 들어간다
           dateRow: row ? Math.round(row.getBoundingClientRect().width) : -1,
           dateFits: !!row && row.getBoundingClientRect().right <= d.clientWidth + 1,
           share: [...document.querySelectorAll('button')].filter(b => ['나만 보기', '더다붓에 공유하기'].includes(b.textContent.trim()))
             .every(b => b.getBoundingClientRect().right <= d.clientWidth + 1) };
})()`);
check('모바일 375px에서 가로로 넘치지 않는다', mob.over === false, JSON.stringify(mob));
check('모바일에서도 본문과 묵상 칸이 뜬다', mob.verses > 0 && mob.seg && mob.tiptap, JSON.stringify(mob));
check('모바일에서 날짜 줄과 공유 토글이 화면 안에 든다',
  mob.dateFits === true && mob.share === true, JSON.stringify(mob));
await clickText('성경 읽기');
await sleep(1600);
// 4차 피드백 11 — **본문을 읽는 중에도** 목차·북마크·형광펜에 닿을 수 있어야 하고,
// 리더 헤더의 버튼(책 목록 · 북마크)이 좁은 폭에서 밀려나지 않아야 한다(44px 터치 타깃).
const mobRead = await ev(`(() => {
  const d = document.documentElement;
  const panes = [...document.querySelectorAll('[data-pane]')].filter(b => b.offsetParent !== null);
  const back = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '목차');
  const bm = [...document.querySelectorAll('button[aria-label]')].find(b => (b.getAttribute('aria-label') || '').includes('북마크'));
  const box = e => (e ? e.getBoundingClientRect() : null);
  const b1 = box(back), b2 = box(bm);
  return { over: d.scrollWidth > d.clientWidth + 1,
           panes: panes.map(b => b.textContent.trim()),
           reader: !!document.querySelector('p[data-verse]'),
           back: b1 ? { h: Math.round(b1.height), inView: b1.left >= 0 } : null,
           bookmark: b2 ? { w: Math.round(b2.width), h: Math.round(b2.height), inView: b2.right <= d.clientWidth + 1 } : null,
           sameRow: b1 && b2 ? Math.abs(b1.top - b2.top) <= 2 : false };
})()`);
check('모바일 성경 읽기도 가로로 안 넘친다', mobRead.over === false, JSON.stringify(mobRead));
check('모바일에서도 목차·북마크·형광펜 세그먼트가 늘 보인다',
  mobRead.panes.join('|') === '본문|북마크|형광펜', JSON.stringify(mobRead.panes));
check('좁은 폭에서도 리더 헤더의 책 목록·북마크가 한 줄에 남는다',
  mobRead.reader === true && !!mobRead.back && !!mobRead.bookmark
  && mobRead.back.inView && mobRead.bookmark.inView && mobRead.sameRow,
  JSON.stringify(mobRead));
// ── 모바일은 쓸어서 넘긴다(사용자 피드백 2026-09-03) ───────────────────────
// 데스크톱 화살표가 없는 폭에서는 이것이 유일한 '언제나 넘길 수 있는' 길이다.
// 터치 이벤트를 합성해 ① 60px을 넘는 가로 쓸기는 장을 넘기고 ② 짧은 쓸기와
// ③ 세로가 더 큰 쓸기는 아무 일도 하지 않는지 본다. 넘긴 뒤 본문은 맨 위다.
const swipeAt = (dx, dy) => ev(`(async () => {
  const area = document.querySelector('[data-chap-swipe]');
  if (!area) return null;
  const r = area.getBoundingClientRect();
  const x0 = Math.round(r.left + r.width - 30), y0 = Math.round(Math.max(r.top + 40, 80));
  const pt = (x, y) => [new Touch({ identifier: 7, target: area, clientX: x, clientY: y })];
  const send = (type, list) => area.dispatchEvent(new TouchEvent(type, {
    bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : list,
    targetTouches: type === 'touchend' ? [] : list, changedTouches: list,
  }));
  send('touchstart', pt(x0, y0));
  send('touchend', pt(x0 + ${dx}, y0 + ${dy}));
  await new Promise(r2 => setTimeout(r2, 1300));
  const first = document.querySelector('p[data-verse]');
  const headRow = document.querySelector('[data-chap-head]');
  // 스크롤할 자리가 없는 짧은 장에서는 올라갈 수도 없다 — 그건 통이 알려 준다
  let box = headRow && headRow.parentElement;
  while (box && box !== document.body) { const oy = getComputedStyle(box).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && box.scrollHeight > box.clientHeight + 8) break; box = box.parentElement; }
  const sc = (box && box !== document.body) ? box : (document.scrollingElement || document.documentElement);
  return { head: (document.querySelector('h3') || {}).textContent || '',
           firstTop: first ? Math.round(first.getBoundingClientRect().top) : -1,
           headTop: headRow ? Math.round(headRow.getBoundingClientRect().top) : -1,
           roomy: sc.scrollHeight > sc.clientHeight + 120 };
})()`, true);
const headNow = () => ev(`(document.querySelector('h3')||{}).textContent || ''`);
const swipeFrom = await headNow();
const small = await swipeAt(-30, 0);
check('짧게 쓸면 장이 바뀌지 않는다', !!small && small.head === swipeFrom,
  JSON.stringify({ swipeFrom, small }));
const vertical = await swipeAt(-90, -160);
check('세로로 더 많이 움직이면 장이 바뀌지 않는다', !!vertical && vertical.head === swipeFrom,
  JSON.stringify({ swipeFrom, vertical }));
await scrollTo(500);
await sleep(300);
const swiped = await swipeAt(-200, 10);
check('왼쪽으로 쓸면 다음 장으로 넘어간다', !!swiped && swiped.head !== swipeFrom && !!swiped.head,
  JSON.stringify({ swipeFrom, swiped }));
check('쓸어 넘긴 뒤에도 본문 맨 위로 돌아온다',
  !!swiped && swiped.firstTop > 0 && swiped.firstTop < 400, JSON.stringify(swiped));
const swipedBack = await swipeAt(200, -10);
check('오른쪽으로 쓸면 이전 장으로 돌아온다', !!swipedBack && swipedBack.head === swipeFrom,
  JSON.stringify({ swipeFrom, swipedBack }));
// 화살표는 `hidden md:flex`라 좁은 폭에서도 DOM에는 남는다 — **보이는지**로 잰다
// (있는지로 재면 display:none인 것을 '있다'고 세어 이 검사가 늘 실패한다)
// 실제 터치 기기에서도 도는지: ① 핸들러가 **본문 칸**(카드를 감싼 [data-chap-swipe])에
// 걸려 있고 ② 조상 어디에도 세로 스크롤을 막는 touch-action이 없어야 한다(§6-7 —
// touch-action은 자손 전체에 걸린다). 가로 쓸기는 우리가 좌표로 재므로 브라우저의
// 팬 동작과 다투지 않는다(touchmove에 preventDefault를 걸지 않는다).
const touchOk = await ev(`(() => {
  const area = document.querySelector('[data-chap-swipe]');
  if (!area) return null;
  const hasCard = !!area.querySelector('p[data-verse]');
  const chain = [];
  let e = area;
  while (e && e !== document.documentElement) { chain.push(getComputedStyle(e).touchAction); e = e.parentElement; }
  return { hasCard, chain: [...new Set(chain)] };
})()`);
check('쓸기 영역이 본문 칸을 품고 있다', !!touchOk && touchOk.hasCard === true, JSON.stringify(touchOk));
check('세로 스크롤을 막는 touch-action이 없다',
  !!touchOk && !touchOk.chain.includes('none') && !touchOk.chain.includes('pan-x'),
  JSON.stringify(touchOk));
// 쓸어 넘긴 뒤에도 눈이 닿는 자리는 장 제목 줄이다(스크롤할 자리가 있는 장에서)
check('모바일에서 쓸어 넘긴 뒤에도 장 제목 줄이 위쪽에 선다',
  !!swiped && (!swiped.roomy || (swiped.headTop >= 0 && swiped.headTop <= 80)),
  JSON.stringify(swiped));

check('좁은 폭에서는 화살표가 보이지 않는다',
  (await ev(`[...document.querySelectorAll('[data-chap-nav]')].every(e => e.offsetParent === null)`)) === true);

check('리더 헤더 버튼은 44px 터치 타깃이다',
  !!mobRead.bookmark && mobRead.bookmark.w >= 44 && mobRead.bookmark.h >= 44 && mobRead.back.h >= 44,
  JSON.stringify({ back: mobRead.back, bookmark: mobRead.bookmark }));
// 묶인 목록도 모바일에서 그대로 본다
check('모바일에서 형광펜 칸으로 간다', await clickSel('[data-pane="highlight"]'));
await sleep(1200);
const mobMarks = await ev(`(() => {
  const d = document.documentElement;
  const seen = [...document.querySelectorAll('[data-book-group]')].filter(b => b.offsetParent !== null);
  return { over: d.scrollWidth > d.clientWidth + 1, groups: seen.length,
           label: seen[0] ? seen[0].textContent.trim() : '' };
})()`);
check('모바일 형광펜 목록도 가로로 안 넘친다', mobMarks.over === false, JSON.stringify(mobMarks));
check('모바일에서도 책 묶음이 보인다', mobMarks.groups > 0, JSON.stringify(mobMarks));

// ── 폭 채우기 768 · 1024 · 1160 · 1440 (사용자 피드백 2026-09-03) ───────────
// **어느 폭에서도 빈 띠가 없어야 한다.** 사용자 스크린샷(1000px 남짓)에서 본문·묵상·나눔이
// 46rem에서 끊기고 오른쪽 230px이 빈 채 '내 기록'은 그 아래에 있었다. 그래서 칸마다
// `data-col`을 달고 **자기 그리드 트랙(또는 부모 폭)을 다 쓰는지**를 잰다 — 상한이 다시
// 붙으면 그 차이가 200px대로 벌어져 여기서 걸린다. 1024가 lg 경계라 옆 칸이 붙는 첫 폭이다.
const colFit = (sel) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const parent = el.parentElement;
  const gt = getComputedStyle(parent).gridTemplateColumns;
  const avail = gt && gt !== 'none'
    ? parseFloat(gt.split(' ')[0])
    : parent.getBoundingClientRect().width;
  const w = el.getBoundingClientRect().width;
  return { gapRight: Math.round(avail - w), w: Math.round(w) };
})()`);
const fits = (v) => !!v && v.gapRight <= 24 && v.gapRight >= -1;

for (const w of [768, 1024, 1160, 1440]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  await reload();
  await sleep(1500);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '말씀')`);
  await clickText('말씀');
  if (!await waitFor(`document.querySelector('[data-col="qt"]')`, 6000)) {
    await clickText('말씀');                       // 첫 렌더가 늦으면 클릭이 허공에 간다
    await waitFor(`document.querySelector('[data-col="qt"]')`, 8000);
  }
  await sleep(900);
  const qtFit = await colFit('[data-col="qt"]');
  const over = await ev(`(() => {
    const d = document.documentElement;
    return { over: d.scrollWidth > d.clientWidth + 1,
             wide: [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > d.clientWidth + 1).length };
  })()`);
  check(`${w}px QT 열이 자리를 다 쓴다`, fits(qtFit), JSON.stringify({ qtFit, over }));
  check(`${w}px QT가 가로로 넘치지 않는다`, over.over === false && over.wide === 0, JSON.stringify(over));

  await clickText('성경 읽기');
  if (!await waitFor(`document.querySelector('[data-col="read"], [data-col="toc"]')`, 6000)) {
    await clickText('성경 읽기');
    await waitFor(`document.querySelector('[data-col="read"], [data-col="toc"]')`, 8000);
  }
  await sleep(900);
  const barFit = await colFit('[data-col="searchbar"]');
  const readFit = await colFit('[data-col="read"]');
  const inputFill = await ev(`(() => {
    const bar = document.querySelector('[data-col="searchbar"]');
    const form = bar && bar.querySelector('form');
    if (!form) return null;
    return Math.round(bar.getBoundingClientRect().width - form.getBoundingClientRect().width);
  })()`);
  check(`${w}px 검색 줄이 자리를 다 쓴다`, fits(barFit), JSON.stringify(barFit));
  check(`${w}px 검색 입력칸이 글자 크기 버튼만 남기고 채운다`,
    inputFill !== null && inputFill <= 140, String(inputFill));
  check(`${w}px 리더가 자리를 다 쓴다`, fits(readFit), JSON.stringify(readFit));

  await clickSel('[data-pane="bookmark"]');
  await sleep(900);
  const bmFitW = await colFit('[data-col="bookmark"]');
  await clickSel('[data-pane="highlight"]');
  await sleep(900);
  const hlFitW = await colFit('[data-col="highlight"]');
  await clickSel('[data-pane="toc"]');
  await sleep(700);
  await clickText('목차');
  await sleep(700);
  const tocFitW = await colFit('[data-col="toc"]');
  check(`${w}px 북마크·형광펜·목차가 자리를 다 쓴다`,
    fits(bmFitW) && fits(hlFitW) && fits(tocFitW),
    JSON.stringify({ bmFitW, hlFitW, tocFitW }));
  const overRead = await ev(`(() => {
    const d = document.documentElement;
    return { over: d.scrollWidth > d.clientWidth + 1,
             wide: [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > d.clientWidth + 1).length };
  })()`);
  check(`${w}px 성경 읽기가 가로로 넘치지 않는다`, overRead.over === false && overRead.wide === 0,
    JSON.stringify(overRead));
}
await send('Emulation.clearDeviceMetricsOverride');

check('콘솔 오류 0', logs.length === 0, logs.slice(0, 2).join(' | '));
logs.length = 0;   // 아래는 일부러 실패를 만드는 자리다 — 여기서 낸 오류는 세지 않는다

// ── 예외 문구 (사용자 피드백 2026-09-03) ────────────────────────────────────
// **못 한 일과 그 이유가 한 문장에 있어야 한다.** 여기부터는 일부러 실패를 만들므로
// 콘솔 오류 검사보다 뒤에 둔다(우리가 낸 오류가 그 검사를 깨면 안 된다).
//
// ① 책 파일을 못 받았을 때: 예전에는 빈 절 배열로 떨어져 카드 안이 통째로 비고 화면은
//    아무 말도 안 했다. 이제 '…장의 본문을 불러오지 못했어요 · <이유>'가 그 자리에 선다.
await reload();
await ev(`(() => {
  const real = window.fetch;
  window.fetch = (u, ...rest) => {
    const url = String((u && u.url) || u || '');
    // 목차(index.json)는 살려 둔다 — 책 목록이 없으면 리더 자체가 열리지 않는다
    if (url.includes('/bible/') && !url.includes('index.json')) {
      return Promise.reject(new Error('Failed to fetch'));
    }
    return real(u, ...rest);
  };
})()`);
await clickText('말씀');
await sleep(1400);
await clickText('성경 읽기');
await sleep(600);
await waitFor(`document.body.innerText.includes('불러오지 못했어요') || document.querySelector('p[data-verse]')`);
await sleep(600);
const readFail = await ev(`(() => {
  const t = document.body.innerText;
  return { said: /본문을 불러오지 못했어요/.test(t),
           why: /인터넷 연결을 확인하고|잠시 후 다시|Failed to fetch/.test(t),
           lied: /본문이 들어 있지 않아요/.test(t), verses: document.querySelectorAll('p[data-verse]').length };
})()`);
check('책 파일을 못 받으면 못 받았다고 말한다',
  readFail.said === true && readFail.lied === false, JSON.stringify(readFail));
check('실패 문구에 이유가 붙는다', readFail.why === true, JSON.stringify(readFail));

// ①-b 목차(책 목록)를 못 받은 경우: 브라우저에서 이 길을 만들려면 앱이 뜨기 전에
//    fetch를 갈아야 해서(부팅 자체가 흔들린다) **배선을 소스로 지킨다** — 못 받으면
//    '구약 0권'으로 그리지 않고 이유를 말한다. 책 파일(①)은 위에서 실제로 막아 봤다.
const bibleSrc = readFileSync(new URL('src/components/wordBible.jsx', ROOT), 'utf8');
check('목차를 못 받으면 0권이 아니라 이유를 말한다',
  bibleSrc.includes('setLoadErr(err || true)')
  && bibleSrc.includes("failText('성경 목차를 불러오지 못했어요', failed)")
  && bibleSrc.includes('if (!books.length)'));

// ② QT 본문 일정을 못 읽은 경우는 게스트에서 만들 수 없다 — services/word.js가
//    localStorage 예외까지 삼키고 빈 값을 돌려주기 때문이다(사파리 비공개 모드용). 그래서
//    **갈라 말하는 배선이 살아 있는지**를 소스로 지킨다: 실패는 failed로 표시되고, 그때는
//    '아직 올라오지 않았어요'가 아니라 '불러오지 못했어요 + 이유'가 그려져야 한다.
const viewSrc = readFileSync(new URL('src/views/wordView.jsx', ROOT), 'utf8');
check('QT 본문 읽기 실패를 빈 상태와 갈라 표시한다',
  viewSrc.includes('failed: qtError')
  && viewSrc.includes("failText('이 날짜의 본문을 불러오지 못했어요', day.failed)")
  && viewSrc.includes('이 날짜의 본문이 아직 올라오지 않았어요'));
// 실패를 삼키지 않고 부르는 쪽에 넘긴다 — 북마크·형광펜이 안 남았는데 화면만 칠해져
// 있으면 새로 열 때 사라진다. 게스트(supabase 없음)에서는 언제나 ok다.
check('saveBibleState가 성공·실패를 답으로 돌려준다',
  (await word.saveBibleState({ lastRef: 'gen 1', bookmarks: [], highlights: [] }))?.ok === true);

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill();
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
