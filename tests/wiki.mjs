// 위키 · 다붓이에게 물어보기 (0088 · 16차 · 목업 v12) — 게스트 모드 브라우저 검사
// ----------------------------------------------------------------------------
// 게스트에는 클라우드가 없어 window.__wikiFixture로 장 묶음을 넣는다(services/wiki.loadWiki) — 블록 모양 전부를 그린다.
//   ① 입구: 데스크톱 알약은 찾기 바로 앞 · 폰 얼굴은 아이콘 줄 맨 앞 · 갸웃(dab-tilt) · 위키 안 칸은 무지개(dab-ring)
//      · 모션 최소화면 멈춘다 · 위키에 들어가도 폰 하단 바의 층이 그대로다
//   ② 물어보기: 처음 칩·자리표 → 거른 질문은 모델 없이 답 → 자리표가 '다붓이에게 더 물어보기'
//   ③ 장: 블록 모양 전부(설교 카드·행·시간표·팀 카드·기록 전·다붓했던 일·자주 묻는 질문) · 고친 줄(초록 줄 + 사람) · '수정한 곳 N'
//   ④ 고치기: ✎ 수정 → 글 칸 → 저장 → 그 줄이 고친 줄이 된다 · 취소는 그대로
//   ⑤ 폰·다크: 가로로 넘치지 않는다 · ‹ 위키로 돌아온다
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4598';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9633;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wiki-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
async function tg() { for (let i = 0; i < 40; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find(x => x.type === 'page'); if (p?.webSocketDebuggerUrl) return p; } catch {} await sleep(250); } throw new Error('no target'); }
const ws = new WebSocket((await tg()).webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || 'exception'); });
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const results = []; const check = (n, p, d = '') => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
const until = async (expr, to = 15000) => { const s = Date.now(); while (Date.now() - s < to) { if (await ev(expr)) return true; await sleep(120); } return false; };
const click = (sel, text = '') => ev(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.textContent.includes(${JSON.stringify(text)}));if(!el)return false;el.click();return true})()`);

// ── 장 묶음(지은 이름 · 지은 업무) ─────────────────────────────────────────────
const it = (key, text, extra = {}) => ({ key, text, by: 'model', ...extra });
const card = (id, label) => ({ t: 'card', id, label });
const FIX = { pages: [
  { id: 'intro', grp: '함께 쓰는 글', title: '더다붓 소개', kind: 'human', position: 0, source: null, source_count: 0, built_at: null, blocks: [
    { key: 'hero', type: 'hero', title: '더다붓', items: [it('hero1', "'다붓하다'는 매우 가깝게 붙어 있다는 뜻이에요.", { by: 'seed' })] },
    { key: 'us', type: 'list', title: '우리 청년부', bullets: false, items: [it('us1', '청년부는 약 55명이에요.', { by: 'seed' })] },
    { key: 'teams', type: 'teams', title: '팀', items: [it('team1', '콘티와 송폼을 만들어요.', { by: 'seed', meta: { team: '찬양팀' } }), it('team2', '안무를 해요.', { by: 'seed', meta: { team: '워십팀' } })] },
    { key: 'flow', type: 'timeline', items: [it('flow1', '임원진 모임', { by: 'seed', meta: { time: '11:30', sub: true } }), it('flow2', '찬양', { by: 'seed', meta: { time: '13:30' } })] },
  ] },
  { id: 'faq', grp: '함께 쓰는 글', title: '자주 묻는 질문', kind: 'auto', position: 2, source: '다붓이에게 물어본 질문', source_count: 2, built_at: '2026-10-03T00:00:00Z', blocks: [
    { key: 'known', type: 'faq', title: '자주 묻는 질문', items: [it('q:a', '그 전주 금요일까지 나와요.', { meta: { q: '송폼은 언제까지 나와요?', n: 3 } })] },
    { key: 'unknown', type: 'faq', title: '다붓이가 아직 모르는 질문', items: [it('q:b', '', { meta: { q: '리더 MT 어디서 해요?', n: 1 } })] },
  ] },
  { id: 'p:wol', grp: '행사', title: '월례회', kind: 'auto', position: 0, source: '업무', source_count: 5, built_at: '2026-10-03T00:00:00Z', blocks: [
    { key: 'lead', type: 'plain', items: [it('lead:x.0', '달마다 한 번 모여요.', { cites: [card('c8', '8월 월례회')] })] },
    { key: 'c:c8', type: 'section', title: '8월 월례회', meta: { status: '완료', cardId: 'c8', when: '업무 날짜 8월 23일' }, cites: [card('c8', '8월 월례회')], items: [
      it('c:c8:a.0', '수련회를 돌아봤어요.', { cites: [card('c8', '8월 월례회')] }), it('c:c8:b.0', '하반기 일정을 맞춰 봤어요.', { cites: [card('c8', '8월 월례회')] })] },
    { key: 'c:c9', type: 'section', title: '9월 월례회 · 9월 13일', meta: { status: '진행 중', cardId: 'c9' }, cites: [card('c9', '9월 월례회')], items: [] },
    { key: 'together', type: 'chips', title: '다붓했던 일', items: [it('t:c1', '찬양 콘티 결정', { by: 'code', cites: [card('c1', '찬양 콘티 결정')], meta: { date: '2026-07-12', teams: ['워십팀'] } })] },
    { key: 'gap', type: 'gap', title: '기록 전', items: [it('g:c10', '10월 월례회', { by: 'code', cites: [card('c10', '10월 월례회')] })] },
  ] },
  { id: 'sermon', grp: '예배', title: '2026 설교 본문', kind: 'auto', position: 0, source: '주보', source_count: 1, built_at: '2026-10-03T00:00:00Z', blocks: [
    { key: 's:s1', type: 'sermon', meta: { date: '2026-09-20', label: '', title: '당신은 기름을 들고 있습니다', passage: '사사기 9:7-15', points: ['사명을 지키는 나무들', '본분', '가시나무의 협박'] },
      cites: [{ t: 'service', id: 's1', label: '주보 · 가이드' }], items: [it('s:s1:a.0', '나무 비유 이야기예요.')] },
  ] },
  { id: 'songs', grp: '예배', title: '예배 찬양', kind: 'auto', position: 1, source: '주보', source_count: 1, built_at: '2026-10-03T00:00:00Z', blocks: [
    { key: 's:s1', type: 'songs', meta: { date: '2026-09-27', label: 'Q예배', sermon: 'Qusetion Day!' }, cites: [{ t: 'service', id: 's1', label: '9월 27일 주보' }], items: [],
      songs: [{ title: '주를 바라보며', by: 'GIFTED' }, { title: '샬롬', by: '' }] },
  ] },
  { id: 'qt', grp: '말씀', title: 'QT 본문 일정', kind: 'auto', position: 0, source: '말씀', source_count: 3, built_at: '2026-10-03T00:00:00Z', blocks: [
    { key: 'm:2026-10', type: 'qt', title: '10월', days: [{ date: '2026-10-01', ref: '삿 15:1-20', label: '' }, { date: '2026-10-03', ref: '삿 16:15-31', label: '' }, { date: '2026-10-04', ref: '삿 17:1-13', label: '' }] },
  ] },
  { id: 'weekly:bulletin', grp: '매주 하는 일', title: '주보 만들기', kind: 'auto', position: 1, source: '주보', source_count: 1, built_at: '2026-10-03T00:00:00Z', blocks: [
    { key: 'rows', type: 'rows', title: '발행된 주보', head: ['주일', '설교', '송폼', '큐시트'], rows: [{ cells: ['9월 20일(일)', '아주 긴 설교 제목이 들어가도 폰에서 줄이 넘치지 않아야 해요', '9월 18일(금) 올림', '미등록'], cite: { t: 'service', id: 's1', label: '9월 20일 주보' } }] },
  ] },
], edits: [
  { page_id: 'intro', item_key: 'hero1', block_key: 'hero', text: '첫 줄이에요.\n둘째 줄이에요.', before: '다붓하다는 뜻이에요.', edited_by: null, edited_at: '2026-10-03T01:00:00Z' },
  { page_id: 'p:wol', item_key: 'c:c8:b.0', block_key: 'c:c8', text: '하반기 일정과 임원 선출 준비를 이야기했어요.', before: '하반기 일정을 맞춰 봤어요.', edited_by: null, edited_at: '2026-10-02T03:00:00Z' },
] };
const ANSWER = { id: 'q-test', status: 'answered', sentences: [{ text: '월례회는 둘째 주 순모임 뒤에 해요.', cites: [{ t: 'page', id: 'intro', label: '더다붓 소개' }] }], files: [] };
const INIT = (theme, reduce = false) => `window.__wikiFixture=${JSON.stringify(FIX)};window.__dabootiAnswer=${JSON.stringify(ANSWER)};try{localStorage.setItem('theme','${theme}')}catch{}${reduce ? '' : ''}`;

await send('Page.enable'); await send('Runtime.enable');
const open = async ({ mobile, theme = 'light', reduce = false, path = '/?p=wiki' }) => {
  await send('Emulation.setDeviceMetricsOverride', mobile ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
  const s = await send('Page.addScriptToEvaluateOnNewDocument', { source: INIT(theme, reduce) });
  await send('Page.navigate', { url: URL_BASE + path });
  await sleep(600);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: s.identifier });
};

try {
  // ── ① 입구 · 데스크톱 ──────────────────────────────────────────────────────
  await open({ mobile: false, path: '/?p=home' });
  check('데스크톱 상단 바에 다붓이 알약', await until(`!!document.querySelector('.dab-pill')`));
  const order = await ev(`(()=>{const p=document.querySelector('.dab-pill');const n=p&&p.nextElementSibling;return {label:p?.textContent.trim(),nextHasSearch:!!n&&!!n.querySelector('input,button')&&!n.classList.contains('dab-pill'), tilt:getComputedStyle(p.querySelector('.dab-face')).animationName}})()`);
  check('알약 문구 · 찾기 바로 앞 · 갸웃', order.label === '다붓이에게 물어보기' && order.nextHasSearch && order.tilt === 'dab-tilt', JSON.stringify(order));
  await click('.dab-pill');
  check('알약 → 위키 첫 화면(왼쪽 목록 · 가운데 물어보기)', await until(`!!document.querySelector('.wiki-desk .wiki-list') && !!document.querySelector('.dab-home')`));
  check('위키 안 물어보기 칸은 무지개 테두리', await ev(`getComputedStyle(document.querySelector('.wiki-side .dab-ring')).animationName === 'dab-ring'`));
  check('프로젝트 탭 줄은 접힌다', await ev(`(()=>{const g=[...document.querySelectorAll('div')].find(d=>d.style&&d.style.gridTemplateRows);return !g||g.style.gridTemplateRows==='0fr'})()`));

  // ── ② 물어보기 ────────────────────────────────────────────────────────────
  const home = await ev(`({chips:document.querySelectorAll('.dab-chip').length, ph:document.querySelector('.dab-input input').placeholder})`);
  check('처음 화면: 질문 칩 · 자리표', home.chips >= 3 && home.ph === '예: 수련회 준비는 언제부터 해요?', JSON.stringify(home));
  await ev(`(()=>{const i=document.querySelector('.dab-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'지난주에 누가 출석 안 했어요?');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
  check('거른 질문은 모델 없이 답한다', await until(`document.querySelector('.dab-answer')?.dataset.status === 'refused'`)
    && await ev(`document.querySelector('.dab-answer').textContent.includes('한 사람 한 사람의 기록은 다붓이가 다루지 않아요')`));
  check("물어본 뒤 자리표는 '다붓이에게 더 물어보기'", await ev(`document.querySelector('.dab-input input').placeholder === '다붓이에게 더 물어보기'`));
  check('거른 답에는 피드백 버튼이 없다', await ev(`!document.querySelector('.dab-answer [aria-label="도움이 됐어요"]')`));
  // 대화가 시작되면 입력 칸은 화면(main 안쪽) 바닥에 붙는다
  check('대화 중 입력 칸은 화면 아래', await ev(`(()=>{const m=document.querySelector('main');const pb=parseFloat(getComputedStyle(m).paddingBottom);const b=document.querySelector('.dab-input').getBoundingClientRect().bottom;return Math.abs((m.getBoundingClientRect().bottom-pb)-b)<16})()`));
  // 좋아요 — 채움 · 손이 튐 · 빛 조각 · 다붓이 폴짝 / 싫어요 — 좋아요가 풀리고 흔들림 · 고개 숙임
  await ev(`(()=>{const i=document.querySelector('.dab-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'월례회는 언제 해요?');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
  // 두 번째 답과 그 👍 버튼이 그려질 때까지 기다린다(한 번 그리기 전에 눌러 null이 났다)
  await until(`document.querySelectorAll('.dab-answer').length === 2 && !![...document.querySelectorAll('.dab-answer')].pop().querySelector('[aria-label="도움이 됐어요"]')`);
  await ev(`[...document.querySelectorAll('.dab-answer')].pop().querySelector('[aria-label="도움이 됐어요"]').click()`);
  const good = await ev(`(()=>{const a=[...document.querySelectorAll('.dab-answer')].pop();const b=a.querySelector('[aria-label="도움이 됐어요"]');return {pressed:b.getAttribute('aria-pressed'),pop:!!b.querySelector('.dab-thumb-pop'),burst:b.querySelectorAll('.dab-burst i').length,fill:b.querySelector('svg').getAttribute('fill'),hop:!!document.querySelector('.dab-hop')}})()`);
  check('좋아요: 채움 · 튐 · 빛 조각 여덟 · 다붓이 폴짝', good.pressed === 'true' && good.pop && good.burst === 8 && good.fill === 'currentColor' && good.hop, JSON.stringify(good));
  await ev(`[...document.querySelectorAll('.dab-answer')].pop().querySelector('[aria-label="도움이 안 됐어요"]').click()`);
  const bad = await ev(`(()=>{const a=[...document.querySelectorAll('.dab-answer')].pop();return {bad:a.querySelector('[aria-label="도움이 안 됐어요"]').getAttribute('aria-pressed'),good:a.querySelector('[aria-label="도움이 됐어요"]').getAttribute('aria-pressed'),shake:!!a.querySelector('.dab-thumb-shake'),droop:!!document.querySelector('.dab-droop')}})()`);
  check('싫어요: 좋아요가 풀리고 흔들림 · 고개 숙임', bad.bad === 'true' && bad.good === 'false' && bad.shake && bad.droop, JSON.stringify(bad));

  // ── ③ 장 ──────────────────────────────────────────────────────────────────
  await click('.wiki-item', '월례회');
  check('장: 출처 표시 · 기록 수 · 수정한 곳', await until(`!!document.querySelector('.wiki-page[data-page="p:wol"]')`)
    && await ev(`(()=>{const t=document.querySelector('.wiki-page').textContent;return t.includes('업무에서 자동으로 수집')&&t.includes('업무 5건')&&t.includes('수정한 곳 1')})()`));
  const wol = await ev(`(()=>{const p=document.querySelector('.wiki-page');return {fixed:p.querySelectorAll('.wiki-fixed').length, fixedText:p.querySelector('.wiki-fixed')?.textContent||'', gap:p.textContent.includes('기록 전'), chips:p.querySelectorAll('.wiki-cite').length, status:p.textContent.includes('진행 중'), together:p.textContent.includes('다붓했던 일'), emptySectionChip:[...p.querySelectorAll('h3')].some(h=>h.textContent.includes('9월 월례회')), headWho:!!p.querySelector(':scope > div .wiki-who') && p.querySelectorAll('.wiki-who').length===1}})()`);
  check('고친 줄은 초록 줄 + 고친 글(다시 모은 글을 덮지 않는다) · 고친 사람은 문장이 아니라 장 머리에', wol.fixed === 1 && wol.fixedText.includes('임원 선출 준비') && !wol.fixedText.includes('수정') && wol.headWho, JSON.stringify(wol));
  check('업무 날짜는 제목이 아니라 옆에 \'업무 날짜\'로', await ev(`(()=>{const h=[...document.querySelectorAll('.wiki-page h3')].find(x=>x.textContent.includes('8월 월례회'));return !!h&&h.querySelector('.wiki-when')?.textContent==='업무 날짜 8월 23일'})()`));
  check('근거 칩 · 기록 전 · 다붓했던 일 · 상태 칩', wol.chips >= 4 && wol.gap && wol.together && wol.status && wol.emptySectionChip, JSON.stringify(wol));
  await click('.wiki-item', '설교 본문');
  check('설교 카드: 날짜 → 제목 → 본문 → 요약 → 가이드 세 마디', await until(`!!document.querySelector('.wiki-sermon')`)
    && await ev(`(()=>{const c=document.querySelector('.wiki-sermon');return c.textContent.includes('당신은 기름을 들고 있습니다')&&c.textContent.includes('사사기 9:7-15')&&c.querySelectorAll('ol li').length===3})()`));
  await click('.wiki-item', '더다붓 소개');
  check('함께 쓰는 글: 우산 컷 · 팀 색 카드 · 시간표', await until(`!!document.querySelector('.wiki-page[data-page="intro"]')`)
    && await ev(`(()=>{const p=document.querySelector('.wiki-page');return !!p.querySelector('img[src*="umbrella"]')&&p.querySelectorAll('.wiki-time').length===2&&p.textContent.includes('함께 작성')&&getComputedStyle([...p.querySelectorAll('li')].find(l=>l.textContent.includes('콘티와 송폼'))).backgroundColor!=='rgba(0, 0, 0, 0)'})()`));
  await click('.wiki-item', '자주 묻는 질문');
  check("자주 묻는 질문: 답 없는 질문은 '기록 전'", await until(`!!document.querySelector('.wiki-faq')`)
    && await ev(`(()=>{const f=[...document.querySelectorAll('.wiki-faq')];return f.length===2&&f[1].textContent.includes('리더 MT 어디서 해요?')&&f[1].textContent.includes('기록 전')&&f[0].textContent.includes('3번')})()`));

  // 줄바꿈 그대로 · 고친 표시는 글 아래 한 줄(옆에 붙이면 글과 줄이 맞지 않았다)
  await click('.wiki-item', '더다붓 소개');
  await until(`!!document.querySelector('.wiki-page[data-page="intro"]')`);
  const hero = await ev(`(()=>{const f=document.querySelector('.wiki-page[data-page="intro"] .wiki-fixed');const t=f.querySelector('.whitespace-pre-line');return {lines:Math.round(t.getBoundingClientRect().height/parseFloat(getComputedStyle(t).lineHeight)), inline:!!f.querySelector('.wiki-who'), head:!!document.querySelector('.wiki-page[data-page="intro"] .wiki-who')}})()`);
  check('줄바꿈은 그대로 · 고친 사람은 함께 작성 옆에만', hero.lines >= 2 && !hero.inline && hero.head, JSON.stringify(hero));
  const dot = await ev(`(()=>{const row=document.querySelector('.wiki-time');const a=getComputedStyle(row,'::after');const d=getComputedStyle(row,'::before');const lx=row.getBoundingClientRect().left+parseFloat(a.left)+parseFloat(a.width)/2;const cx=row.getBoundingClientRect().left+parseFloat(d.left)+parseFloat(d.width)/2;return Math.abs(lx-cx)})()`);
  check('시간표 점은 선 가운데', dot <= 1, String(dot));
  check('흰 판 없음(앱 바탕 위에 바로)', await ev(`(()=>{const w=getComputedStyle(document.querySelector('.wiki-desk'));return w.borderTopWidth==='0px' && (w.backgroundColor==='rgba(0, 0, 0, 0)'||w.backgroundColor==='transparent')})()`));
  await click('.wiki-item', '자주 묻는 질문');
  check('자주 묻는 질문 출처 문구', await until(`!!document.querySelector('.wiki-page[data-page="faq"]')?.textContent.includes('다붓이에게 물어본 질문에서 수집')`));
  // 예배 찬양: 주일 한 장 · 곡 번호 목록(곡 진하게 · 부른 사람 옅게) / QT: 데스크톱 7칸 달력 · 책 이름 전체
  await click('.wiki-item', '예배 찬양');
  check('예배 찬양: 주일 카드 · 번호 목록 · 부른 사람', await until(`!!document.querySelector('.wiki-songs')`)
    && await ev(`(()=>{const c=document.querySelector('.wiki-songs');return c.textContent.includes('Q예배')&&c.textContent.includes('설교 · Qusetion Day!')&&c.querySelectorAll('ol li').length===2&&c.querySelector('ol li').textContent.includes('GIFTED')})()`));
  await click('.wiki-item', 'QT 본문 일정');
  check('QT: 책 이름 전체 · 요일 칸 · 주가 바뀌면 새 줄', await until(`document.querySelector('.wiki-qt-day')?.textContent.includes('사사기 15:1-20')`)
    && await ev(`(()=>{const d=[...document.querySelectorAll('.wiki-qt-day')];const col=e=>getComputedStyle(e).gridColumnStart;return col(d[0])==='5'&&col(d[1])==='7'&&col(d[2])==='1'&&d[0].parentElement!==d[2].parentElement})()`));
  // 마스터(게스트는 마스터)는 장 제목·소제목도 그 자리에서 고친다
  await click('.wiki-item', '월례회');
  await until(`!!document.querySelector('.wiki-page[data-page="p:wol"]')`);
  await click('.wiki-edit', '수정');
  await until(`!!document.querySelector('.wiki-title-draft')`);
  await ev(`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const [t,h]=[...document.querySelectorAll('.wiki-title-draft')];set.call(t,'월례회 기록');t.dispatchEvent(new Event('input',{bubbles:true}));set.call(h,'8월 월례회(토)');h.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click('button', '저장');
  check('마스터: 장 제목·소제목 고치기 → 목록 이름도 바뀐다', await until(`document.querySelector('.wiki-page h2')?.textContent==='월례회 기록'`)
    && await ev(`[...document.querySelectorAll('.wiki-item')].some(b=>b.textContent.includes('월례회 기록')) && document.querySelector('.wiki-page').textContent.includes('8월 월례회(토)')`));
  // ── ④ 고치기 ──────────────────────────────────────────────────────────────
  await click('.wiki-item', '월례회 기록');
  await until(`!!document.querySelector('.wiki-page[data-page="p:wol"]')`);
  await click('.wiki-edit', '수정');
  check('✎ 수정 → 글 칸 · 수정 중', await until(`document.querySelectorAll('.wiki-draft').length >= 3`) && await ev(`document.querySelector('.wiki-page').textContent.includes('월례회 기록 · 수정 중')`));
  await ev(`(()=>{const t=document.querySelector('textarea.wiki-draft');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(t,'한 달에 한 번 모여 지난달을 돌아봐요.');t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click('button', '저장');
  check('저장 → 그 줄이 고친 줄 · 수정한 곳 2', await until(`document.querySelectorAll('.wiki-page .wiki-fixed').length === 2`)
    && await ev(`(()=>{const t=document.querySelector('.wiki-page').textContent;return t.includes('한 달에 한 번 모여 지난달을 돌아봐요.')&&t.includes('수정한 곳 2')&&!document.querySelector('.wiki-draft')})()`));
  await click('.wiki-edit', '수정');
  await until(`document.querySelectorAll('.wiki-draft').length >= 3`);
  await ev(`(()=>{const t=document.querySelector('textarea.wiki-draft');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(t,'취소할 글');t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click('button', '취소');
  check('취소는 그대로', await until(`!document.querySelector('.wiki-draft')`) && await ev(`!document.querySelector('.wiki-page').textContent.includes('취소할 글')`));

  // ── ① 폰 입구 · 하단 바 층 · ⑤ 넘침 ──────────────────────────────────────
  for (const theme of ['light', 'dark']) {
    await open({ mobile: true, theme, path: '/?p=home' });
    await until(`!!document.querySelector('nav[data-tab-bar]')`);
    const first = await ev(`(()=>{const row=document.querySelector('.md\\\\:hidden .ml-auto');const b=row&&row.querySelector('button');return {face:!!b?.querySelector('.dab-face'), label:b?.getAttribute('aria-label')}})()`);
    check(`폰(${theme}): 아이콘 줄 맨 앞이 다붓이 얼굴`, first.face && first.label === '다붓이에게 물어보기', JSON.stringify(first));
    await ev(`document.querySelector('.md\\\\:hidden .ml-auto button').click()`);
    check(`폰(${theme}): 위키 첫 화면(물어보기 칸 + 목록)`, await until(`!!document.querySelector('.wiki-mobile .dab-ring') && !!document.querySelector('.wiki-mobile .wiki-list')`));
    check(`폰(${theme}): 하단 바 층은 들어오기 전 그대로(교회)`, await ev(`document.querySelector('nav[data-tab-bar]').dataset.tabBar === 'church'`));
    // 장 넘김(0.32초 미끄러짐)이 끝난 뒤에 잰다 — 도는 중에는 28px만큼 오른쪽으로 나가 있다
    const over = async () => { await sleep(450); return ev(`document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('main *')].every(e=>e.getBoundingClientRect().right <= innerWidth + 1)`); };
    check(`폰(${theme}): 첫 화면 가로 넘침 없음`, await over());
    // 물어보기 첫 화면은 남은 높이의 가운데 · 장 넘김은 미끄러져 들어온다
    await click('.dab-ring');
    await until(`!!document.querySelector('.dab-home')`);
    const mid = await ev(`(()=>{const h=document.querySelector('.dab-home');const kids=[...h.children];const top=kids[0].getBoundingClientRect().top, bot=kids[kids.length-1].getBoundingClientRect().bottom;const r=h.getBoundingClientRect();return Math.abs((top-r.top)-(r.bottom-bot))})()`);
    check(`폰(${theme}): 물어보기 첫 화면은 가운데`, mid < 24, String(mid));
    check(`폰(${theme}): 들어가면 오른쪽에서`, await ev(`!!document.querySelector('.wiki-mobile .wiki-in-fwd')`));
    await click('button', '위키');
    check(`폰(${theme}): 돌아오면 왼쪽에서`, await until(`!!document.querySelector('.wiki-mobile .wiki-in-back')`));
    await click('.wiki-item', '주보 만들기');
    check(`폰(${theme}): 행 블록 넘침 없음`, await until(`!!document.querySelector('.wiki-page[data-page="weekly:bulletin"]')`) && await over());
    await click('.wiki-item', '월례회').catch(() => false);
    await click('button', '위키');
    await click('.wiki-item', '월례회');
    check(`폰(${theme}): 장 넘침 없음 · ‹ 위키`, await until(`!!document.querySelector('.wiki-page[data-page="p:wol"]')`) && await over());
    await click('button', '위키');
    check(`폰(${theme}): ‹ 위키 → 첫 화면`, await until(`!!document.querySelector('.wiki-mobile .wiki-list') && !document.querySelector('.wiki-page')`));
  }

  // ── 모션 최소화 ───────────────────────────────────────────────────────────
  await open({ mobile: false, reduce: true });
  await until(`!!document.querySelector('.wiki-side .dab-ring')`);
  check('모션 최소화: 갸웃·무지개가 멈춘다', await ev(`getComputedStyle(document.querySelector('.dab-pill .dab-face')).animationName === 'none' && getComputedStyle(document.querySelector('.wiki-side .dab-ring')).animationName === 'none'`));
  check('예외 없음', errs.length === 0, errs.slice(0, 2).join(' | '));
} catch (e) {
  check('실행', false, e.message);
} finally {
  for (const r of results) console.log(r);
  ws.close(); chrome.kill();
  if (results.some(r => r.startsWith('FAIL'))) process.exitCode = 1;
}
