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
const ev = async (e, a = false) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };

// 화면에서 글자로 버튼을 찾는다 — 못 찾으면 던지지 말고 false를 돌려준다(§6-40)
const clickText = (label) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return false; b.click(); return true;
})()`);
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
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
await ev(`(() => {
  localStorage.setItem('theme', 'light');
  localStorage.setItem('word_qt_schedule', ${JSON.stringify(JSON.stringify(seed.schedule))});
  localStorage.setItem('word_qt_entries', ${JSON.stringify(JSON.stringify(seed.entries))});
  localStorage.removeItem('word_bible_state');
  localStorage.removeItem('word_bible_font');
})()`);
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
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

// 5) 본문표 붙여넣기 도구는 없다(0038 시드로 대체) — 마스터에게도 안 보인다
const noPaste = await ev(`(() => ({
  box: !!document.querySelector('textarea[aria-label="본문표"]'),
  head: document.body.innerText.includes('본문표'),
}))()`);
check('본문표 붙여넣기 도구가 화면에 없다', noPaste.box === false && noPaste.head === false,
  JSON.stringify(noPaste));

// 6) 묵상 칸은 업무 본문과 같은 에디터(TipTap)다
const editor = await ev(`(() => ({
  tiptap: !!document.querySelector('.tiptap'),
  textarea: !!document.querySelector('textarea[aria-label="내 묵상"]'),
  bar: [...document.querySelectorAll('button[title]')].map(b => b.title).filter(t => ['굵게','형광펜','제목 1','체크리스트'].includes(t)).length,
}))()`);
check('묵상 칸이 마크다운 에디터로 바뀌었다', editor.tiptap && !editor.textarea, JSON.stringify(editor));
check('서식 바가 같이 온다(굵게·형광펜·제목·체크리스트)', editor.bar === 4, String(editor.bar));

// 7) 날짜 이동 — 어제 / 오늘로. 기다리는 자리는 스켈레톤이 지킨다
await watchSkeleton();
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='어제'); b && b.click(); })()`);
await sleep(900);
const yest = await ev(`(() => ({
  date: (document.body.innerText.match(/\\d+년 \\d+월 \\d+일 \\([일월화수목금토]\\)/) || [])[0] || '',
  psalm: document.body.innerText.includes('시편 121편'),
  hasToday: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '오늘로'),
  skel: window.__skel,
  swaps: [...document.querySelectorAll('[data-swap]')].map(e => e.dataset.swap),
  moves: [...document.querySelectorAll('[data-swap]')].every(e => getComputedStyle(e).transitionProperty.includes('transform')),
  waiting: document.body.innerText.includes('본문을 여는 중'),
}))()`);
check('어제로 이동하면 그날 본문이 뜬다', yest.date === word.dayLabel(word.shiftDay(today, -1)) && yest.psalm,
  JSON.stringify({ date: yest.date, psalm: yest.psalm }));
check("오늘이 아니면 '오늘로'가 생긴다", yest.hasToday === true);
check('날짜를 바꾸면 같은 자리에 스켈레톤이 선다', yest.skel > 0, String(yest.skel));
check("'본문을 여는 중' 같은 글자 자리표는 없다", yest.waiting === false);
check('화면 전환이 날짜를 물고 있다', yest.swaps.includes(word.shiftDay(today, -1)), JSON.stringify(yest.swaps));
check('전환은 transform으로 한다(§4.2)', yest.moves === true);
await clickText('오늘로');
await sleep(900);
check("'오늘로'가 오늘로 되돌린다",
  (await ev(`(document.body.innerText.match(/\\d+년 \\d+월 \\d+일 \\([일월화수목금토]\\)/)||[''])[0]`)) === word.dayLabel(today));

// 8) 등록 없는 날 — 빈 상태
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='내일'); b && b.click(); })()`);
await sleep(900);
const empty = await ev(`(() => ({
  msg: document.body.innerText.includes('이 날짜의 본문이 아직 올라오지 않았어요'),
  mark: !!document.querySelector('svg path.dc-draw'),
  verses: document.querySelectorAll('p[data-verse]').length,
}))()`);
check('본문이 없는 날은 빈 상태 + 표식', empty.msg && empty.mark && empty.verses === 0, JSON.stringify(empty));
await clickText('오늘로');
await sleep(900);

// 9) 내 나눔 — 수정·삭제는 내 글에만, 삭제는 확인 팝오버를 거친다
const mineRow = await ev(`(() => ({
  edit: !!document.querySelector('button[aria-label="내 나눔 고치기"]'),
  del: !!document.querySelector('button[aria-label="내 나눔 지우기"]'),
}))()`);
check('내 나눔에 고치기·지우기가 붙는다', mineRow.edit && mineRow.del, JSON.stringify(mineRow));
// 고치기는 같은 글을 두 자리에서 고치지 않는다 — 위의 '내 묵상' 칸으로 데려간다
await ev(`(() => { document.querySelector('button[aria-label="내 나눔 고치기"]').click(); })()`);
await sleep(600);
check('고치기는 내 묵상 칸에 커서를 준다',
  await ev(`!!document.activeElement && !!document.activeElement.closest('.tiptap')`));
await ev(`(() => { document.querySelector('button[aria-label="내 나눔 지우기"]').click(); })()`);
await sleep(300);
const confirmSeen = await ev(`document.body.innerText.includes('이 날 묵상을 지울까요')`);
check('지우기는 확인 팝오버를 거친다', confirmSeen === true);
await clickText('삭제');
await sleep(800);
const afterDelete = await ev(`(() => ({
  stored: JSON.parse(localStorage.getItem('word_qt_entries') || '{}')[${JSON.stringify(today)}] || null,
  feedEmpty: document.body.innerText.includes('이 날짜에 올라온 나눔이 아직 없어요'),
}))()`);
check('지우면 그 날 묵상이 사라진다', afterDelete.stored === null && afterDelete.feedEmpty,
  JSON.stringify(afterDelete));

// 10) 나만 보기 / 나누기 — 이미 그 상태인 쪽을 눌러도 저장이 켜지지 않는다
check('고칠 것이 없으면 저장은 꺼져 있다', (await saveDisabled()) === true);
await clickText('나만 보기');       // 지금 이미 '나만 보기'다
await sleep(250);
check("이미 그 상태인 쪽을 눌러도 저장이 안 켜진다", (await saveDisabled()) === true);
await clickText('나누기');
await sleep(250);
check('값이 실제로 달라지면 저장이 켜진다', (await saveDisabled()) === false);

// 11) 묵상 저장 — 마크다운 에디터에 쳐 넣고 저장한다
await ev(`(() => { const el = document.querySelector('.tiptap'); el.focus(); })()`);
await send('Input.insertText', { text: '오늘 남긴 한 줄' });
await sleep(400);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='저장'); b && b.click(); })()`);
await sleep(900);
const mine = await ev(`JSON.parse(localStorage.getItem('word_qt_entries') || '{}')[${JSON.stringify(today)}]`);
check('묵상과 나누기 상태가 같이 저장된다',
  mine && mine.body === '오늘 남긴 한 줄' && mine.shared === true, JSON.stringify(mine));
check('저장하고 나면 저장이 다시 꺼진다', (await saveDisabled()) === true);

// ── 성경 읽기 ───────────────────────────────────────────────────────────────
check('세그먼트 전환', await clickText('성경 읽기'));
await sleep(1000);
const toc = await ev(`(() => {
  const t = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  const heads = [...document.querySelectorAll('h3')].map(h => h.textContent.trim());
  return { ot: heads.includes('구약'), nt: heads.includes('신약'),
           gen: t.includes('창세기'), rev: t.includes('요한계시록'), aa: t.filter(x => x === 'Aa').length,
           marks: heads.includes('북마크') && heads.includes('형광펜'),
           hint: (document.querySelector('input[aria-label="본문 검색"]') || {}).placeholder || '' };
})()`);
check('목차가 구약·신약으로 갈린다', toc.ot && toc.nt && toc.gen && toc.rev, JSON.stringify(toc));
check('글자 크기 Aa 3단계', toc.aa === 3, String(toc.aa));
check("'내 기록'에 북마크·형광펜 칸이 선다", toc.marks === true);
check("검색 자리표는 '본문 검색'", toc.hint === '본문 검색', toc.hint);

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
check("창세기 1:1에 '태초에 하나님이'", reader.first.includes('태초에 하나님이 천지를 창조하시니라'), reader.first);

// 글자 크기 3단계 — 실제 font-size가 바뀌고 기기에 남는다
const fonts = await ev(`(async () => {
  const size = () => getComputedStyle(document.querySelector('p[data-verse]')).fontSize;
  const aa = [...document.querySelectorAll('button[aria-label]')].filter(b => b.getAttribute('aria-label').startsWith('글자'));
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

// 형광펜 — 절을 누르면 켜지고 사람마다 따로 남는다(bible_state.highlights)
await ev(`(() => { document.querySelector('p[data-verse="1:3"]').click(); })()`);
await sleep(500);
const lit = await ev(`(() => {
  const p = document.querySelector('p[data-verse="1:3"]');
  const st = JSON.parse(localStorage.getItem('word_bible_state') || '{}');
  return { on: p.dataset.mark === '1', bg: getComputedStyle(p).backgroundColor,
           refs: (st.highlights || []).map(h => h.ref),
           chip: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '창세기 1:3') };
})()`);
check('절을 누르면 형광펜이 켜진다', lit.on === true, JSON.stringify(lit));
check("형광펜은 절 단위로 남는다('gen 1:3')", JSON.stringify(lit.refs) === JSON.stringify(['gen 1:3']),
  JSON.stringify(lit.refs));
check("'내 기록'에 그 절이 선다", lit.chip === true);

// 북마크 · 이어읽기
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'').includes('북마크')); b && b.click(); })()`);
await sleep(500);
const state = await ev(`JSON.parse(localStorage.getItem('word_bible_state') || '{}')`);
check('북마크는 장 단위로 잡힌다',
  state.bookmarks?.length === 1 && state.bookmarks[0].ref === 'gen 1' && state.bookmarks[0].label === '창세기 1장',
  JSON.stringify(state.bookmarks));
check('이어읽기 자리가 남는다', state.lastRef === 'gen 1', String(state.lastRef));

// 다음 장 → 이어읽기가 따라간다 → 화면 전환이 장을 물고 있다
check('다음 장', await clickText('다음 장'));
await sleep(900);
const ch2 = await ev(`(() => ({ head: (document.querySelector('h3')||{}).textContent || '',
  last: JSON.parse(localStorage.getItem('word_bible_state')||'{}').lastRef,
  swaps: [...document.querySelectorAll('[data-swap]')].map(e => e.dataset.swap) }))()`);
check('다음 장으로 넘어간다', ch2.head === '창세기 2장' && ch2.last === 'gen 2', JSON.stringify(ch2));
check('장 전환이 화면 전환을 탄다', ch2.swaps.includes('p:gen 2'), JSON.stringify(ch2.swaps));

// '내 기록'의 형광펜을 누르면 그 절로 돌아간다
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='창세기 1:3'); b && b.click(); })()`);
await sleep(1000);
const back = await ev(`(() => ({ head: (document.querySelector('h3')||{}).textContent || '',
  focus: (document.querySelector('[data-focus="1"]')||{}).dataset?.verse || '' }))()`);
check("'내 기록'의 형광펜을 누르면 그 절로 간다", back.head === '창세기 1장' && back.focus === '1:3',
  JSON.stringify(back));

check('목차로', await clickText('목차'));
await sleep(500);
check('목차에서도 북마크가 보인다',
  await ev(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '창세기 1장')`));

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
await ev(`(() => { document.querySelector('button[data-hit]').click(); })()`);
await sleep(1000);
const jumped = await ev(`(() => ({ head: (document.querySelector('h3')||{}).textContent || '',
  focus: (document.querySelector('[data-focus="1"]')||{}).textContent || '' }))()`);
check('결과를 누르면 그 장으로 간다', jumped.head === '창세기 1장' && jumped.focus.includes('태초에'),
  JSON.stringify(jumped));

// ── 모바일 375px ────────────────────────────────────────────────────────────
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: URL_BASE });
await wait('Page.loadEventFired');
await sleep(1400);
await ev(`(() => { const g=document.querySelector('button[title="설정"]'); g && g.click(); })()`);
await sleep(400);
check('모바일에서도 말씀으로 갈 수 있다', await clickText('말씀'));
await sleep(1600);
const mob = await ev(`(() => {
  const d = document.documentElement;
  return { over: d.scrollWidth > d.clientWidth + 1, verses: document.querySelectorAll('p[data-verse]').length,
           seg: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '성경 읽기'),
           tiptap: !!document.querySelector('.tiptap') };
})()`);
check('모바일 375px에서 가로로 넘치지 않는다', mob.over === false, JSON.stringify(mob));
check('모바일에서도 본문과 묵상 칸이 뜬다', mob.verses > 0 && mob.seg && mob.tiptap, JSON.stringify(mob));
await clickText('성경 읽기');
await sleep(1200);
const mobRead = await ev(`(() => {
  const d = document.documentElement;
  const heads = [...document.querySelectorAll('h3')].map(h => h.textContent.trim());
  return { over: d.scrollWidth > d.clientWidth + 1, marks: heads.includes('북마크') && heads.includes('형광펜') };
})()`);
check('모바일 성경 읽기도 가로로 안 넘친다', mobRead.over === false, JSON.stringify(mobRead));
check("모바일에서도 '내 기록'을 볼 수 있다", mobRead.marks === true, JSON.stringify(mobRead));
await send('Emulation.clearDeviceMetricsOverride');

check('콘솔 오류 0', logs.length === 0, logs.slice(0, 2).join(' | '));
console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n' + logs.slice(0, 6).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill();
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
