// 위키 · 다붓이에게 물어보기 (0088 · 16차 · 목업 v12) — 게스트 모드 브라우저 검사
// ----------------------------------------------------------------------------
// 게스트에는 클라우드가 없어 window.__wikiFixture로 장 묶음을 넣는다(services/wiki.loadWiki) — 블록 모양 전부를 그린다.
//   ① 입구: 데스크톱 알약은 찾기 바로 앞 · 폰 얼굴은 아이콘 줄 맨 앞 · 갸웃(dab-tilt) · 위키 안 칸은 무지개(dab-ring)
//      · 모션 최소화면 멈춘다 · 위키에 들어가도 폰 하단 바의 층이 그대로다
//   ② 물어보기: 처음 칩·자리표 → 거른 질문은 모델 없이 답 → 자리표가 '다붓이에게 더 물어보기'
//   ③ 장: 블록 모양 전부(설교 카드·행·시간표·팀 카드·기록 전·다붓했던 일·자주 묻는 질문) · 고친 줄(초록 줄 + 사람) · '수정한 곳 N'
//   ④ 고치기: ✎ 수정 → 글 칸 → 저장 → 그 줄이 고친 줄이 된다 · 취소는 그대로
//   ⑤ 폰·다크: 가로로 넘치지 않는다 · ‹ 위키로 돌아온다
//   ⑥ 2026-10-04: 장 머리에 고친 사람 없음 · **굵게**(읽기 · B 버튼) · 고치기 칸이 겹치지·넘치지 않는다 · QT 날 → 말씀 QT의 그 날 ·
//      마스터가 아니면(장 묶음 member) ✎ 수정·자주 묻는 질문 장·그 장 링크가 없다(0090)
//   ⑦ 20차 ⑦: 보는 사람에게 없는 업무(장 묶음 live.cards 밖 — 리더 프로젝트)를 가리키는 블록은 고친 줄째, 그런 블록만 남은 장은 목록째 그리지 않는다
//   ⑧ 20차 ⑧: 권유 줄(nudge) · 👎 → 다붓이가 묻고 → 다음 말이 알려 준 말 → 고마움(window.__tellCalls) · 자주 묻는 질문 칩·열린 질문 ·
//      다붓이가 배운 것(✓ · 연필 · + 직접 알려 주기 → window.__learnCalls) · 마스터가 아니면 그 장이 없다
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
ws.send(JSON.stringify({ id: 0, method: 'Browser.setDownloadBehavior', params: { behavior: 'deny' } }));   // 누른 내려받기(.ics·공유 이미지)가 사용자 다운로드 폴더에 쌓이지 않게(2026-10-22)
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
  // 20차 ⑧ — 답 스냅샷 대신 '아직 답하지 못한 질문'(답을 알려 주기)만(답이 나온 질문의 칩은 2026-10-13에 걷었다 · id는 faq 그대로)
  { id: 'faq', grp: '함께 쓰는 글', title: '아직 답하지 못한 질문', kind: 'auto', position: 3, source: '다붓이에게 물어본 질문', source_count: 2, built_at: '2026-10-03T00:00:00Z', blocks: [
    { key: 'open', type: 'open', title: '아직 답하지 못한 질문', items: [it('q:b', '', { meta: { q: '리더 MT 어디서 해요?', n: 1, day: '2026-10-05', why: 'none', qid: 'qid-b' } }), it('q:c', '', { meta: { q: '예배자학교 어디까지 했어?', n: 1, day: '2026-10-04', why: 'bad', qid: 'qid-c' } })] },
  ] },
  // 다붓이가 배운 것(20차 ⑧ · 마스터만) — 확인을 기다리는 말 · 다붓이가 배운 것(리더 관련은 자물쇠)
  { id: 'learned', grp: '함께 쓰는 글', title: '다붓이가 배운 것', kind: 'auto', position: 3, source: null, source_count: 2, built_at: '2026-10-13T00:00:00Z', blocks: [
    { key: 'pending', type: 'facts', title: '확인을 기다리는 말', items: [it('f:p1', '천진영도 순장이야', { by: 'human', meta: { id: 'fid-p1', day: '2026-10-11', who: '라마바', q: '순장 명단 알려줘' } })] },
    { key: 'learned', type: 'facts', title: '다붓이가 배운 것', items: [it('f:a1', '예배자학교는 3주차까지 했어', { by: 'human', meta: { id: 'fid-a1', day: '2026-10-07', who: '가나다', q: '' } }), it('f:a2', '리더 숙소는 양평이에요', { by: 'human', meta: { id: 'fid-a2', day: '2026-10-08', who: '가나다', q: '', leader: true } })] },
  ] },
  { id: 'p:wol', grp: '행사', title: '월례회', kind: 'auto', position: 0, source: '업무', source_count: 5, built_at: '2026-10-03T00:00:00Z', blocks: [
    { key: 'lead', type: 'plain', items: [it('lead:x.0', '달마다 한 번 모여요.', { cites: [card('c8', '8월 월례회')] })] },
    { key: 'c:c8', type: 'section', title: '8월 월례회', meta: { status: '완료', cardId: 'c8', when: '업무 날짜 8월 23일' }, cites: [card('c8', '8월 월례회')], items: [
      it('c:c8:a.0', '수련회를 돌아봤어요.', { cites: [card('c8', '8월 월례회')] }), it('c:c8:b.0', '하반기 일정을 맞춰 봤어요.', { cites: [card('c8', '8월 월례회')] })] },
    { key: 'c:c9', type: 'section', title: '9월 월례회 · 9월 13일', meta: { status: '진행 중', cardId: 'c9' }, cites: [card('c9', '9월 월례회')], items: [] },
    // 잠그기 전에 구운 리더 프로젝트 업무 블록(20차 ⑦) — lx는 live.cards에 없다(비리더 스토어에 없는 업무) → 고친 줄째 안 그린다
    { key: 'c:lx', type: 'section', title: '리더숙소 계약', meta: { status: '진행 중', cardId: 'lx' }, cites: [card('lx', '리더숙소 계약')], items: [
      it('c:lx:a.0', '리더숙소 보증금을 냈어요.', { cites: [card('lx', '리더숙소 계약')] })] },
    // 행사 장: 행사 기록 뒤에 '준비' 묶음 머리 · 준비 업무 · 순장은 팀이 아니라 보는 사람 표시(2026-10-04)
    { key: 'prep', type: 'head', title: '준비', items: [] },
    { key: 'c:c11', type: 'section', title: '월례회 포스터 제작', meta: { status: '완료', cardId: 'c11', when: '업무 날짜 8월 1일', prep: true, note: '순장도 함께 봐요' }, cites: [card('c11', '월례회 포스터 제작')], items: [
      it('c:c11:a.0', '월례회를 앞두고 포스터를 만들었어요.', { cites: [card('c11', '월례회 포스터 제작')] })] },
    { key: 'together', type: 'chips', title: '다른 팀과 했던 일', items: [it('t:c1', '찬양 콘티 결정', { by: 'code', cites: [card('c1', '찬양 콘티 결정')], meta: { date: '2026-07-12', teams: ['워십팀'], note: '순장도 함께 봐요' } })] },
    { key: 'gap', type: 'gap', title: '기록 전', items: [it('g:c10', '10월 월례회', { by: 'code', cites: [card('c10', '10월 월례회')] })] },
  ] },
  // 팀 장 — 맨 위 소개 줄은 옛 글로 저장돼 있어도 더다붓 소개 › 팀 카드의 지금 글로 선다(wikiCore.withTeamCards)
  { id: 'team:찬양팀', grp: '팀', title: '찬양팀', kind: 'auto', position: 0, source: '업무', source_count: 1, built_at: '2026-10-03T00:00:00Z', blocks: [
    { key: 'about', type: 'plain', items: [it('about1', '옛 소개 글이에요.', { by: 'code', cites: [{ t: 'page', id: 'intro', label: '더다붓 소개' }] })] },
    { key: 'c:k1', type: 'section', title: '찬양 송폼 제작', meta: { status: '완료', cardId: 'k1', when: '업무 날짜 9월 1일' }, cites: [card('k1', '찬양 송폼 제작')], items: [it('c:k1:a.0', '송폼은 콘티 곡의 진행표예요. 콘티와 함께 나와요.', { cites: [card('k1', '찬양 송폼 제작')] }), it('c:k1:b.0', '콘티는 목요일에 나와요.', { cites: [card('k1', '찬양 송폼 제작')] })] },
    { key: 'together', type: 'chips', title: '다른 팀과 했던 일', items: [it('t:c8', '8월 월례회', { by: 'code', cites: [card('c8', '8월 월례회')], meta: { date: '2026-08-23', teams: ['교역자'] } })] },
  ] },
  // 행사 장(17차) — 정보 상자 줄 · 정해지기까지(바뀌기 전 · 지금 정해진 내용) · 준비(지금 업무)
  { id: 'p:sports', grp: '행사', title: '가을 체육대회', kind: 'auto', position: 1, source: '업무', source_count: 1, built_at: '2026-10-03T00:00:00Z', blocks: [
    { key: 'info', type: 'info', items: [], rows: [{ k: '날짜', v: '10월 31일(토) 14:00~18:00' }, { k: '장소', v: '한강공원' }, { k: '맡은 곳', v: '임원진' }] },
    { key: 'lead', type: 'plain', items: [it('lead:s.0', '10월 31일에 한강공원에서 월례회 뒤 정한 대로 열어요.', { cites: [card('c9', '9월 월례회')] })] },
    { key: 'decide', type: 'decisions', title: '정해지기까지', items: [], steps: [
      { key: 'd1', text: '날짜를 10월 25일로 바꾸는 것을 고민했어요.', date: '2026-09-20', state: 'old', cites: [card('m20', '9월 20일 리더십 회의')] },
      { key: 'd2', text: '10월 31일로 확정했어요.', date: '2026-09-27', state: 'now', cites: [card('m27', '9월 27일 리더십 회의')] },
    ] },
    { key: 'c:e1', type: 'section', title: '가을 체육대회 개요', meta: { status: '시작 전', cardId: 'e1', when: '업무 날짜 10월 25일', date: '2026-10-25' }, cites: [card('e1', '가을 체육대회 개요')], items: [it('c:e1:a.0', '구급함을 준비해요.', { cites: [card('e1', '가을 체육대회 개요')] })] },
  ] },
  { id: 'terms', grp: '함께 쓰는 글', title: '자주 쓰는 말', kind: 'human', position: 1, source: null, source_count: 0, built_at: null, blocks: [
    { key: 'words', type: 'list', title: '자주 쓰는 말', items: [it('w7', '콘티 · 예배 찬양 순서예요. 예배 전주 목요일 저녁에 나와요.', { by: 'seed' }), it('w5', '월례회 · 둘째 주 순모임 뒤에 모여요.', { by: 'seed' })] },
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
  { page_id: 'intro', item_key: 'hero1', block_key: 'hero', text: '**첫 줄**이에요.\n둘째 줄이에요.', before: '다붓하다는 뜻이에요.', edited_by: null, edited_at: '2026-10-03T01:00:00Z' },
  { page_id: 'intro', item_key: 'team1', block_key: 'teams', text: '싱어와 연주자가 함께해요.\n콘티와 송폼으로 찬양해요.', before: '콘티와 송폼을 만들어요.', edited_by: null, edited_at: '2026-10-03T02:00:00Z' },
  { page_id: 'team:찬양팀', item_key: 'u:a1', block_key: 'about', text: '찬양팀 이름은 따로 있어요.', before: '', edited_by: null, edited_at: '2026-10-03T02:00:00Z' },
  { page_id: 'p:wol', item_key: 'c:c8:b.0', block_key: 'c:c8', text: '하반기 일정과 임원 선출 준비를 이야기했어요.', before: '하반기 일정을 맞춰 봤어요.', edited_by: null, edited_at: '2026-10-02T03:00:00Z' },
  { page_id: 'p:wol', item_key: 'c:lx:a.0', block_key: 'c:lx', text: '리더숙소고친줄이에요.', before: '리더숙소 보증금을 냈어요.', edited_by: null, edited_at: '2026-10-02T04:00:00Z' },
] };
// 리더 프로젝트의 행사 장(20차 ⑦) — 업무 블록이 모두 안 보이는 업무라 장째(정보 상자째) 목록에도 없다
FIX.pages.push({ id: 'p:lmt', grp: '행사', title: '리더숨은장', kind: 'auto', position: 3, source: '업무', source_count: 1, built_at: '2026-10-03T00:00:00Z', blocks: [
  { key: 'info', type: 'info', items: [], rows: [{ k: '장소', v: '양평' }] },
  { key: 'c:lx', type: 'section', title: '리더숙소 계약', meta: { status: '진행 중', cardId: 'lx' }, cites: [card('lx', '리더숙소 계약')], items: [it('c:lx:b.0', '숨은 장의 줄이에요.', { cites: [card('lx', '리더숙소 계약')] })] },
] });
// 되풀이 모임 장(월례회 꼴 · 개요는 뜻 + 다음 날짜 · 업무 마디 이름은 '업무')
FIX.pages.push({ id: 'p:monthly', grp: '행사', title: '리더 모임', kind: 'auto', position: 2, source: '업무', source_count: 2, built_at: '2026-10-03T00:00:00Z', blocks: [
  { key: 'lead', type: 'plain', meta: { recurring: true }, items: [it('def', '리더 모임은 둘째 주에 모여요.', { by: 'code' }), it('next', '다음 리더 모임은 10월 11일(일)이에요.', { by: 'code', cites: [card('r10', '10월 리더 모임')] })] },
  { key: 'gap', type: 'gap', title: '기록 전', items: [it('g:r10', '10월 리더 모임', { by: 'code', cites: [card('r10', '10월 리더 모임')] }), it('g:r11', '11월 리더 모임', { by: 'code', cites: [card('r11', '11월 리더 모임')] })] },
] });
// QT — 오늘(KST) 앞뒤 사흘 블록을 하나 더(오늘 강조 · 지난 날 옅게를 본다)
const kst = (d) => new Date(Date.now() + 9 * 3600e3 + d * 864e5).toISOString().slice(0, 10);
const TODAY = kst(0);
FIX.pages.find(p => p.id === 'qt').blocks.push({ key: 'm:rel', type: 'qt', title: '이번 주', days: [{ date: kst(-1), ref: '약 1:1-11', label: '' }, { date: TODAY, ref: '약 1:12-18', label: '' }, { date: kst(1), ref: '시 4:13-5:6', label: '' }] });
// 지금 마디의 재료(게스트는 스토어 대신 장 묶음의 live) — 가입자 · 업무 · 프로젝트
FIX.live = {
  members: [
    { id: 'u1', name: '가나다', role: '찬양팀장 · 순장', teams: ['찬양팀', '순장'] },
    { id: 'u2', name: '라마바', role: '찬양팀 베이스 · 미디어팀 편집', teams: ['찬양팀', '미디어팀'] },
    { id: 'u3', name: '사아자', role: '', teams: ['찬양팀'] },
    { id: 'u4', name: '차카타', role: '워십팀장', teams: ['워십팀'] },
  ],
  projects: [{ id: 'P1', title: '2026 예배' }, { id: 'PX', title: '2026 워크스페이스 개선' }],
  tasks: [
    { id: 'k1', projectId: 'P1', title: '찬양 송폼 제작', status: '완료', teams: ['찬양팀', '워십팀'], startDate: '2026-09-01', dueDate: '2026-09-01', completedAt: '2026-09-01T03:00:00Z', subtasks: [{ title: 'a', done: true }, { title: 'b', done: false }] },
    { id: 'k2', projectId: 'P1', title: '10월 콘티', status: '진행 중', teams: ['찬양팀'], startDate: TODAY, dueDate: kst(3), subtasks: [] },
    { id: 'k3', projectId: 'P1', title: '지난 연습 정리', status: '시작 전', teams: ['찬양팀'], dueDate: kst(-2), subtasks: [] },
    { id: 'kx', projectId: 'PX', title: '위키 개발', status: '진행 중', teams: ['찬양팀'], subtasks: [] },
    { id: 'e1', projectId: 'P1', title: '가을 체육대회 개요', status: '진행 중', teams: ['임원진'], dueDate: '2026-10-25', subtasks: [{ title: 'x', done: false }, { title: 'y', done: false }] },
  ],
  // 보는 사람에게 있는 업무 id 전부(클라우드에서는 스토어의 업무 전부 · 20차 ⑦) — lx(리더 프로젝트)는 없다
  cards: ['c1', 'c8', 'c9', 'c10', 'c11', 'e1', 'k1', 'k2', 'k3', 'kx', 'm20', 'm27', 'r10', 'r11'],
};
const ANSWER = { id: 'q-test', status: 'answered', sentences: [{ text: '월례회는 둘째 주 순모임 뒤에 해요.', cites: [{ t: 'page', id: 'intro', label: '더다붓 소개' }] }], files: [] };
const UNKNOWN = { id: 'q-unk', status: 'unknown', sentences: [{ text: '워크스페이스에서는 그런 내용을 찾을 수가 없어서, 해당 질문은 보완해서 내일 아침에 학습해 둘게요.', cites: [] }], files: [] };
const INIT = (theme, reduce = false, member = false) => `window.__wikiFixture=${JSON.stringify(member ? { ...FIX, member: true } : FIX)};window.__dabootiAnswer=${JSON.stringify(member ? UNKNOWN : ANSWER)};try{localStorage.setItem('theme','${theme}')}catch{}${reduce ? '' : ''}`;

await send('Page.enable'); await send('Runtime.enable');
const open = async ({ mobile, theme = 'light', reduce = false, path = '/?p=wiki', member = false }) => {
  await send('Emulation.setDeviceMetricsOverride', mobile ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
  const s = await send('Page.addScriptToEvaluateOnNewDocument', { source: INIT(theme, reduce, member) });
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
  // 바뀌는 칩(사용자 결정 2026-10-04) — 셋 · 4초마다 한 칸 · 칩 위에 손이 있으면 멈춘다
  const chipText = `[...document.querySelectorAll('.dab-chip')].map(b=>b.textContent).join('|')`;
  // 바뀜 하나가 끝난 직후에 첫 값을 읽는다 — 바뀜이 두 박자(빠짐 0.2초 → 들어옴)라 아무 때나 읽으면 4.6초 사이에 두 번 바뀔 수 있다
  await until(`!!document.querySelector('.dab-chip-out')`, 6000);
  await until(`!document.querySelector('.dab-chip-out')`, 2000);
  const c0 = await ev(chipText);
  // 칩이 바뀐 바로 그때 다붓이가 갸웃한다 — 5초 고리(CSS)는 없고 칩 박자의 한 번(사용자 지적 2026-10-05)
  const tilt = await ev(`(()=>{const f=document.querySelector('.dab-home .dab-face');return {css:getComputedStyle(f).animationName, now:f.getAnimations().length}})()`);
  check('질문 칩: 흐려지며 빠지고, 바뀌는 순간 다붓이가 갸웃(5초 고리 없음)', tilt.css === 'none' && tilt.now >= 1, JSON.stringify(tilt));
  await sleep(4600);
  const c1 = await ev(chipText);
  check('질문 칩: 셋 · 4초 뒤 한 칸만 바뀜', c1.split('|').length === 3 && c0.split('|').filter((c, i) => c !== c1.split('|')[i]).length === 1, `${c0} → ${c1}`);
  await ev(`document.querySelector('.dab-chips').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}))`);
  await sleep(4600);
  check('질문 칩: 손을 올리면 멈춤', await ev(chipText) === c1);
  await ev(`document.querySelector('.dab-chips').dispatchEvent(new PointerEvent('pointerout',{bubbles:true,pointerType:'mouse',relatedTarget:document.body}))`);
  await ev(`(()=>{const i=document.querySelector('.dab-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'내 묵상 노트 보여줘');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
  check('거른 질문은 모델 없이 답한다', await until(`document.querySelector('.dab-answer')?.dataset.status === 'refused'`)
    && await ev(`document.querySelector('.dab-answer').textContent.includes('개인 묵상 노트는 본인만 보는 글이라 다붓이가 열어 보지 않아요.')`));
  check("물어본 뒤 자리표는 '다붓이에게 더 물어보기'", await ev(`document.querySelector('.dab-input input').placeholder === '다붓이에게 더 물어보기'`));
  check('거른 답에는 피드백 버튼이 없다', await ev(`!document.querySelector('.dab-answer [aria-label="도움이 됐어요"]')`));
  // 대화는 앱이 떠 있는 동안 남는다 — 다른 탭(홈)에 갔다 다붓이로 돌아와도 그대로(사용자 결정 2026-10-04 · useDabootiChat)
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '홈')?.click()`);
  check('홈으로 가면 위키가 닫힌다', await until(`!document.querySelector('.wiki-desk')`));
  await click('.dab-pill');
  check('다른 탭에 갔다 와도 다붓이 대화가 남는다', await until(`!!document.querySelector('.wiki-desk') && document.querySelectorAll('.dab-answer').length >= 1`));
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
  // 20차 ⑧ — 모든 👎 뒤에 다붓이가 묻는다(따로 입력 칸 없음) · 그 뒤 전혀 다른 말(아래 성경 구절)은 새 질문으로 간다
  check("👎 → '다붓이가 어떻게 말해야 할까요?' 말풍선", await until(`[...document.querySelectorAll('.dab-tell')].pop()?.textContent.includes('다붓이가 어떻게 말해야 할까요?')`)
    && await ev(`document.querySelectorAll('.dab-input input').length === 1`));
  // 성경 구절 답 — 어느 말씀인지 한 줄 · 절마다 한 줄 · 말씀 탭 안내(2026-10-04)
  await ev(`window.__dabootiAnswer=${JSON.stringify({ id: null, status: 'answered', sentences: [{ text: '시편 119편 말씀이에요(개역한글).', cites: [] }, { text: '119편 전체는 말씀 탭에서 볼 수 있어요.', cites: [] }], verses: Array.from({ length: 8 }, (_, i) => ({ n: `119:${i + 1}`, text: `절 ${i + 1}` })), files: [] })}`);
  await ev(`(()=>{const i=document.querySelector('.dab-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'시편 119편 보여줘');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
  await until(`document.querySelectorAll('.dab-answer').length === 3`);
  const verse = await ev(`(()=>{const a=[...document.querySelectorAll('.dab-answer')].pop();const v=a.querySelector('.dab-verses');return {lines:v?v.children.length:0, tail:a.textContent.includes('119편 전체는 말씀 탭에서 볼 수 있어요.'), head:a.textContent.indexOf('시편 119편 말씀이에요')<a.textContent.indexOf('119:1')}})()`);
  check('성경 구절: 절마다 한 줄 · 안내는 아래', verse.lines === 8 && verse.tail && verse.head, JSON.stringify(verse));
  await ev(`window.__dabootiAnswer=${JSON.stringify(ANSWER)}`);
  // ── 20차 ⑧ 학습 고리 — 권유 줄(nudge) · 👎 → 다붓이가 묻고 → 평소 입력창의 다음 말이 알려 준 말 → 고마움 ──
  const askIn = (q) => ev(`(()=>{const i=document.querySelector('.dab-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(q)});i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
  await ev(`window.__dabootiAnswer=${JSON.stringify({ ...UNKNOWN, id: 'q-nudge', nudge: true })}`);
  await askIn('예배자학교는 어디까지 진행됐어?');
  await until(`document.querySelectorAll('.dab-answer').length === 4`);
  // 되돌리기: dabooti.jsx의 권유 줄을 지우거나 아이콘 색을 바꾸면 깨진다
  const nudge = await ev(`(()=>{const a=[...document.querySelectorAll('.dab-answer')].pop();const n=a.querySelector('.dab-nudge');if(!n)return null;const svg=n.querySelector('svg');const btn=a.querySelector('[aria-label="도움이 안 됐어요"] svg');
    return {text:n.textContent, fw:getComputedStyle(n).fontWeight, color:getComputedStyle(n).color, accent:getComputedStyle(a.querySelector('.text-accent-text')).color, icon:svg?.getAttribute('fill'), iconColor:getComputedStyle(svg).color, btnColor:getComputedStyle(btn).color, lucide:svg?.classList.contains('lucide-thumbs-down'), inBubble:a.contains(n)}})()`);
  check('권유 줄: 말풍선 끝 · accent 600 · 가운데 👎는 답 줄 버튼과 같은 회색 선 아이콘', !!nudge && nudge.text === '맞는 답을 아신다면 를 눌러서 직접 알려주세요!' && nudge.fw === '600' && nudge.color === nudge.accent && nudge.icon === 'none' && nudge.lucide && nudge.iconColor === nudge.btnColor && nudge.inBubble, JSON.stringify(nudge));
  await ev(`window.__dabootiAnswer=${JSON.stringify({ ...ANSWER, id: 'q-tell' })}`);
  await askIn('체육대회 장소 어디야?');
  await until(`document.querySelectorAll('.dab-answer').length === 5`);
  check('권유가 없는 답에는 그 줄이 없다', await ev(`![...document.querySelectorAll('.dab-answer')].pop().querySelector('.dab-nudge')`));
  const lastBtn = (label) => `[...document.querySelectorAll('.dab-answer')].pop().querySelector('[aria-label="${label}"]')`;
  await ev(`${lastBtn('도움이 안 됐어요')}.click()`);
  await until(`document.querySelectorAll('.dab-tell').length === 2`);
  // 👎 뒤 👍 — 마지막 것만(아직 답하지 않은 말풍선은 걷는다) · 다시 👎면 다시 묻는다
  await ev(`${lastBtn('도움이 됐어요')}.click()`);
  const afterGood = await until(`document.querySelectorAll('.dab-tell').length === 1`, 3000);
  await ev(`${lastBtn('도움이 안 됐어요')}.click()`);
  check('👎 뒤 👍면 묻는 말풍선이 걷히고, 다시 👎면 다시 묻는다(마지막 것만)', afterGood && await until(`document.querySelectorAll('.dab-tell').length === 2`, 3000));
  await askIn('체육대회 장소는 성내 체육관이야');
  check("다음 말이 원래 물음과 이어지면 알려 준 말 → '알려주셔서 고마워요 ! 내일까지 확실하게 공부해올게요 !'(서버 { tell })",
    await until(`[...document.querySelectorAll('.dab-answer')].pop()?.textContent.includes('알려주셔서 고마워요 ! 내일까지 확실하게 공부해올게요 !')`)
    && await ev(`JSON.stringify(window.__tellCalls)===${JSON.stringify(JSON.stringify([{ questionId: 'q-tell', text: '체육대회 장소는 성내 체육관이야' }]))} && ![...document.querySelectorAll('.dab-answer')].pop().querySelector('[aria-label="도움이 안 됐어요"]')`),
    await ev(`JSON.stringify(window.__tellCalls)`));
  await ev(`window.__dabootiAnswer=${JSON.stringify(ANSWER)}`);

  // ── ③ 장 ──────────────────────────────────────────────────────────────────
  await click('.wiki-item', '월례회');
  check('장: 출처 표시 · 기록 수 · 수정한 곳', await until(`!!document.querySelector('.wiki-page[data-page="p:wol"]')`)
    && await ev(`(()=>{const t=document.querySelector('.wiki-page').textContent;return t.includes('업무에서 자동으로 수집')&&t.includes('업무 5건')&&t.includes('수정한 곳 1')})()`));
  // 20차 ⑦ — 안 보이는 업무(lx)를 가리키는 블록은 고친 줄째 안 그리고 · 업무 블록이 다 빠진 장은 목록에도 없다. 장 숫자(업무 5건)는 그대로.
  // 되돌리기: wikiView의 hideUnseenBlocks를 빼면 깨진다(겹치기 전에 거르면 고친 줄이 다른 블록 끝으로 옮겨 붙어 깨진다)
  const unseen = await ev(`(()=>{const t=document.querySelector('.wiki-page').textContent;const l=document.querySelector('.wiki-list').textContent;return {block:t.includes('리더숙소'),page:l.includes('리더숨은장'),shown:l.includes('월례회')&&l.includes('가을 체육대회')}})()`);
  check('안 보이는 업무를 가리키는 블록(고친 줄째)과 그런 장은 그리지 않는다(20차 ⑦)', !unseen.block && !unseen.page && unseen.shown, JSON.stringify(unseen));
  const wol = await ev(`(()=>{const p=document.querySelector('.wiki-page');return {fixed:p.querySelectorAll('.wiki-fixed').length, fixedText:p.querySelector('.wiki-fixed')?.textContent||'', gap:!!p.querySelector('.wiki-prep')?.textContent.includes('10월 월례회'), chips:p.querySelectorAll('.wiki-cite').length, status:p.textContent.includes('진행 중'), together:p.textContent.includes('다른 팀과 했던 일'), emptySectionChip:[...p.querySelectorAll('h3')].some(h=>h.textContent.includes('9월 월례회')), who:p.querySelectorAll('.wiki-who').length}})()`);
  // 고친 사람(사진 · 'OOO · 날짜 수정')은 어디에도 없다 — 장 머리에서도 걷었다(사용자 결정 2026-10-04)
  check('고친 줄은 고친 글(다시 모은 글을 덮지 않는다) · 고친 사람 표시는 어디에도 없다', wol.fixed === 1 && wol.fixedText.includes('임원 선출 준비') && !wol.fixedText.includes('수정') && wol.who === 0 && !/· \d+월 \d+일 수정/.test(await ev(`document.querySelector('.wiki-page').textContent`)), JSON.stringify(wol));
  check('업무 날짜는 제목이 아니라 옆에 \'업무 날짜\'로', await ev(`(()=>{const h=[...document.querySelectorAll('.wiki-page h3')].find(x=>x.textContent.includes('8월 월례회'));return !!h&&h.querySelector('.wiki-when')?.textContent==='업무 날짜 8월 23일'})()`));
  check('근거 칩 · 기록 전 업무(준비 목록) · 다른 팀과 했던 일 · 상태 칩', wol.chips >= 4 && wol.gap && wol.together && wol.status && wol.emptySectionChip, JSON.stringify(wol));
  // '준비'는 큰 마디(행사 기록 뒤) — 준비 업무는 그 아래 작은 마디 · 보는 사람 표시는 블록 머리와 칩에 작은 글로(2026-10-04 · 17차 마디)
  const prep = await ev(`(()=>{const p=document.querySelector('.wiki-page');const h2=[...p.querySelectorAll('h2.wiki-h2')];const g=h2.find(h=>h.textContent.includes('준비'));const pos=(t)=>[...p.querySelectorAll('h2,h3')].findIndex(h=>h.textContent.includes(t));const gi=pos('준비');
    return {g:g?.querySelector('.wiki-live-label')?.textContent||'', order:gi>pos('8월 월례회')&&gi<pos('월례회 포스터 제작'), notes:p.querySelectorAll('.wiki-note').length, old:p.textContent.includes('다붓했던 일')}})()`);
  check("행사 장: '준비' 마디(현재 업무 기준) · 순장은 보는 사람 표시 · 옛 이름 '다붓했던 일' 없음", prep.g === '현재 업무 기준' && prep.order && prep.notes === 2 && !prep.old, JSON.stringify(prep));
  await click('.wiki-item', '찬양팀');
  const about = await ev(`(async()=>{for(let i=0;i<40&&!document.querySelector('.wiki-page[data-page="team:찬양팀"]');i++)await new Promise(r=>setTimeout(r,50));const lis=[...document.querySelectorAll('.wiki-page li')].map(l=>l.textContent);return lis})()`);
  check('팀 장 소개 줄 = 더다붓 소개 팀 카드의 지금 글(한 줄로) · 팀 장에 더한 줄은 그 아래', about[0]?.startsWith('싱어와 연주자가 함께해요. 콘티와 송폼으로 찬양해요.') && !about.some(t => t.includes('옛 소개 글')) && about[1]?.includes('찬양팀 이름은 따로 있어요.'), JSON.stringify(about));
  await click('.wiki-item', '설교 본문');
  check('설교 카드: 날짜 → 제목 → 본문 → 요약 → 가이드 세 마디', await until(`!!document.querySelector('.wiki-sermon')`)
    && await ev(`(()=>{const c=document.querySelector('.wiki-sermon');return c.textContent.includes('당신은 기름을 들고 있습니다')&&c.textContent.includes('사사기 9:7-15')&&c.querySelectorAll('ol li').length===3})()`));
  await click('.wiki-item', '더다붓 소개');
  check('함께 쓰는 글: 우산 컷 · 팀 색 카드 · 시간표 · 함께 작성 꼬리표 없음', await until(`!!document.querySelector('.wiki-page[data-page="intro"]')`)
    && await ev(`(()=>{const p=document.querySelector('.wiki-page');return !!p.querySelector('img[src*="umbrella"]')&&p.querySelectorAll('.wiki-time').length===2&&!p.textContent.includes('함께 작성')&&getComputedStyle([...p.querySelectorAll('li')].find(l=>l.textContent.includes('콘티와 송폼'))).backgroundColor!=='rgba(0, 0, 0, 0)'})()`));
  // 20차 ⑧ — '아직 답하지 못한 질문' 장(id faq): 열린 질문(날짜 · 못 찾음/👎 · 답을 알려 주기)만 · 답이 나온 질문의 칩 없음(2026-10-13) · ✎ 수정 없음
  await click('.wiki-item', '아직 답하지 못한 질문');
  check('아직 답하지 못한 질문: 열린 질문 줄 · 칩 없음 · 소제목 문구', await until(`!!document.querySelector('.wiki-page[data-page="faq"] .wiki-open')`)
    && await ev(`(()=>{const p=document.querySelector('.wiki-page[data-page="faq"]');const c=[...p.querySelectorAll('.wiki-askchip')];const o=[...p.querySelectorAll('.wiki-open')];const h=[...p.querySelectorAll('h2,h3')].map(x=>x.textContent).join('|');
      return c.length===0&&o.length===2&&o[0].textContent.includes('리더 MT 어디서 해요?')&&o[0].textContent.includes('10월 5일 · 못 찾음')&&!!o[1].querySelector('svg.lucide-thumbs-down')
        &&!h.includes('많이 물어본 질문')&&h.includes('아직 답하지 못한 질문')&&!p.querySelector('.wiki-edit')&&!p.textContent.includes('그 전주 금요일')})()`));
  await click('.wiki-open-tell', '답을 알려 주기');
  await until(`!!document.querySelector('.wiki-open .wiki-oneline input')`);
  await ev(`(()=>{const i=document.querySelector('.wiki-open .wiki-oneline input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'리더 MT는 양평 펜션이에요');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
  check("'답을 알려 주기' → 한 줄 → 서버 { learn: answer } · 칸이 닫힌다", await until(`(window.__learnCalls||[]).some(c=>c.op==='answer'&&c.questionId==='qid-b'&&c.text==='리더 MT는 양평 펜션이에요') && !document.querySelector('.wiki-open .wiki-oneline')`), await ev(`JSON.stringify(window.__learnCalls)`));
  // 다붓이가 배운 것(마스터만) — 장 목록의 점(확인을 기다리는 말) · ✓ 반영 · 연필 고치기 · 자물쇠 · '+ 직접 알려 주기'
  const learnedItem = await ev(`(()=>{const b=[...document.querySelectorAll('.wiki-item')].find(x=>x.textContent.includes('다붓이가 배운 것'));return b?{n:b.querySelector('small')?.textContent,dot:!!b.querySelector('.wiki-waiting')}:null})()`);
  check('장 목록: 다붓이가 배운 것 · 숫자 옆 점(확인을 기다리는 말)', learnedItem?.n === '2' && learnedItem.dot, JSON.stringify(learnedItem));
  await click('.wiki-item', '다붓이가 배운 것');
  check('다붓이가 배운 것: 확인을 기다리는 말(누가 · 날짜 · 물음) · 다붓이가 배운 것 · 자물쇠 · 출처 줄 없음', await until(`!!document.querySelector('.wiki-page[data-page="learned"] .wiki-fact')`)
    && await ev(`(()=>{const p=document.querySelector('.wiki-page[data-page="learned"]');const w=p.querySelector('.wiki-facts.is-pending');const l=p.querySelector('.wiki-facts.is-learned');const h=[...p.querySelectorAll('h2,h3')].map(x=>x.textContent).join('|');
      return !!w&&w.textContent.includes('천진영도 순장이야')&&w.textContent.includes('10월 11일 · 라마바 · 물음: "순장 명단 알려줘"')&&!!w.querySelector('[aria-label="반영"]')&&!!w.querySelector('[aria-label="버리기"]')
        &&l.querySelectorAll('.wiki-fact').length===2&&!!l.querySelector('[aria-label="리더만"]')&&h.includes('확인을 기다리는 말')&&h.includes('다붓이가 배운 것')&&!p.textContent.includes('자동으로 수집')&&!p.querySelector('.wiki-edit')})()`));
  await ev(`document.querySelector('.wiki-facts.is-pending [aria-label="반영"]').click()`);
  check('✓ 반영 → 서버 { learn: approve }', await until(`(window.__learnCalls||[]).some(c=>c.op==='approve'&&c.id==='fid-p1')`));
  await ev(`document.querySelector('.wiki-facts.is-learned [aria-label="고치기"]').click()`);
  await until(`!!document.querySelector('.wiki-facts.is-learned .wiki-oneline input')`);
  check('연필 → 그 줄이 한 줄 칸(지금 글)', await ev(`document.querySelector('.wiki-facts.is-learned .wiki-oneline input').value === '예배자학교는 3주차까지 했어'`));
  await ev(`(()=>{const i=document.querySelector('.wiki-facts.is-learned .wiki-oneline input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'예배자학교는 4주차까지 했어');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
  check('고치기 → 서버 { learn: edit }', await until(`(window.__learnCalls||[]).some(c=>c.op==='edit'&&c.id==='fid-a1'&&c.text==='예배자학교는 4주차까지 했어')`));
  await click('.wiki-fact-add', '직접 알려 주기');
  await until(`!!document.querySelector('.wiki-facts.is-learned .wiki-oneline input')`);
  await ev(`(()=>{const i=document.querySelector('.wiki-facts.is-learned .wiki-oneline input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'체육대회는 성내 체육관이에요');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
  check("'+ 직접 알려 주기' → 서버 { learn: add }", await until(`(window.__learnCalls||[]).some(c=>c.op==='add'&&c.text==='체육대회는 성내 체육관이에요')`));

  // 줄바꿈 그대로 · 고친 표시는 글 아래 한 줄(옆에 붙이면 글과 줄이 맞지 않았다)
  await click('.wiki-item', '더다붓 소개');
  await until(`!!document.querySelector('.wiki-page[data-page="intro"]')`);
  const hero = await ev(`(()=>{const f=document.querySelector('.wiki-page[data-page="intro"] .wiki-fixed');const t=f.querySelector('.whitespace-pre-line');return {lines:Math.round(t.getBoundingClientRect().height/parseFloat(getComputedStyle(t).lineHeight)), inline:!!f.querySelector('.wiki-who'), head:!!document.querySelector('.wiki-page[data-page="intro"] .wiki-who'), bold:[...f.querySelectorAll('strong')].map(b=>b.textContent), stars:f.textContent.includes('**')}})()`);
  check('줄바꿈은 그대로 · **굵게**는 굵게(별표 없이) · 고친 사람 없음', hero.lines >= 2 && !hero.inline && !hero.head && hero.bold.join('|') === '첫 줄' && !hero.stars, JSON.stringify(hero));
  // 고치기 칸은 제 자리 안에 — 더다붓 머리의 제목 칸과 글 칸이 겹치지 않고, 칸이 블록·팀 카드 밖으로 나가지 않는다(사용자 지적 2026-10-04)
  await click('.wiki-edit', '수정');
  await until(`document.querySelectorAll('.wiki-page[data-page="intro"] textarea.wiki-draft').length >= 3`);
  const fit = await ev(`(()=>{const p=document.querySelector('.wiki-page');const hero=p.querySelector('.dc-row');const [t]=hero.querySelectorAll('.wiki-title-draft');const a=hero.querySelector('textarea.wiki-draft');
    const gap=Math.round(a.getBoundingClientRect().top-t.getBoundingClientRect().bottom);
    const out=[...p.querySelectorAll('.dc-row .wiki-draft')].filter(d=>{const box=(d.closest('li[style]')||d.closest('.dc-row')).getBoundingClientRect();const r=d.getBoundingClientRect();return r.left<box.left-0.5||r.right>box.right+0.5}).length;
    const team=[...p.querySelectorAll('li[style] textarea.wiki-draft')].every(d=>{const li=d.closest('li').getBoundingClientRect();const r=d.getBoundingClientRect();return r.left-li.left>=8&&li.right-r.right>=8});
    return {gap,out,team}})()`);
  check('고치기 칸: 머리 제목과 글 사이가 벌어진다 · 블록·카드 밖으로 안 나간다', fit.gap >= 4 && fit.out === 0 && fit.team, JSON.stringify(fit));
  await click('button', '취소');
  await until(`!document.querySelector('.wiki-draft')`);
  const dot = await ev(`(()=>{const row=document.querySelector('.wiki-time');const a=getComputedStyle(row,'::after');const d=getComputedStyle(row,'::before');const lx=row.getBoundingClientRect().left+parseFloat(a.left)+parseFloat(a.width)/2;const cx=row.getBoundingClientRect().left+parseFloat(d.left)+parseFloat(d.width)/2;return Math.abs(lx-cx)})()`);
  check('시간표 점은 선 가운데', dot <= 1, String(dot));
  check('흰 판 없음(앱 바탕 위에 바로)', await ev(`(()=>{const w=getComputedStyle(document.querySelector('.wiki-desk'));return w.borderTopWidth==='0px' && (w.backgroundColor==='rgba(0, 0, 0, 0)'||w.backgroundColor==='transparent')})()`));
  await click('.wiki-item', '아직 답하지 못한 질문');
  check('아직 답하지 못한 질문 출처 문구', await until(`!!document.querySelector('.wiki-page[data-page="faq"]')?.textContent.includes('다붓이에게 물어본 질문에서 수집')`));
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
  check('마스터: 장 제목·소제목 고치기 → 목록 이름도 바뀐다', await until(`document.querySelector('.wiki-page h1')?.textContent==='월례회 기록'`)
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
  // 고친 줄은 글에 표시를 달지 않는다 — 왼쪽 초록 줄이 글을 해쳤다(사용자 결정 2026-10-04)
  check('고친 줄에 왼쪽 줄이 없다', await ev(`[...document.querySelectorAll('.wiki-page .wiki-fixed')].every(f=>{const c=getComputedStyle(f);return parseFloat(c.borderLeftWidth)===0&&parseFloat(c.paddingLeft)===0&&parseFloat(c.marginLeft)===0})`));
  await click('.wiki-edit', '수정');
  await until(`document.querySelectorAll('.wiki-draft').length >= 3`);
  await ev(`(()=>{const t=document.querySelector('textarea.wiki-draft');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(t,'취소할 글');t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click('button', '취소');
  check('취소는 그대로', await until(`!document.querySelector('.wiki-draft')`) && await ev(`!document.querySelector('.wiki-page').textContent.includes('취소할 글')`));
  // B — 고른 글을 **로 감싸고, 다시 누르면 푼다 · 저장하면 읽기에서 굵게
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });   // 헤드리스는 창에 초점이 없어 칸에 초점이 안 선다
  await click('.wiki-edit', '수정');
  await until(`!!document.querySelector('textarea.wiki-draft')`);
  const pickWord = `(()=>{const t=document.querySelector('textarea.wiki-draft');t.focus();const i=t.value.indexOf('지난달');t.setSelectionRange(i,i+3);t.dispatchEvent(new Event('select',{bubbles:true}));return i})()`;
  await ev(pickWord);
  await ev(`document.querySelector('.wiki-bold').click()`); await sleep(100);
  const on = await ev(`document.querySelector('textarea.wiki-draft').value`);
  await ev(`document.querySelector('.wiki-bold').click()`); await sleep(100);
  const off = await ev(`document.querySelector('textarea.wiki-draft').value`);
  await ev(`document.querySelector('.wiki-bold').click()`); await sleep(100);
  await click('button', '저장');
  await until(`!document.querySelector('.wiki-draft')`);
  const strong = await ev(`[...document.querySelectorAll('.wiki-page strong')].map(b=>b.textContent)`);
  check('B: 고른 글을 **로 감싸고 다시 누르면 푼다 · 저장하면 굵게', on.includes('**지난달**') && !off.includes('**') && strong.includes('지난달'), JSON.stringify({ on, off, strong }));
  // QT 날을 누르면 말씀 탭 QT의 그 날로(딥링크 값 qt)
  await click('.wiki-item', 'QT 본문 일정');
  await until(`!!document.querySelector('.wiki-qt-day button')`);
  await ev(`[...document.querySelectorAll('.wiki-qt-day button')].find(b=>b.textContent.includes('15:1-20')).click()`);
  check('QT 날 → 말씀 탭 QT의 그 날', await until(`!document.querySelector('.wiki-page') && /2026년 10월 1일 \\(/.test(document.querySelector('main')?.innerText||'')`), await ev(`(document.querySelector('main')?.innerText||'').replace(/\\s+/g,' ').slice(0,60)`));

  // ── ⑦ 17차 나무위키식 장(목업 승인 2026-10-04) ────────────────────────────
  await open({ mobile: false, path: '/?p=wiki' });
  await until(`!!document.querySelector('.wiki-item')`);
  const openPage = async (t, id) => { await click('.wiki-item', t); return until(`!!document.querySelector('.wiki-page[data-page="${id}"]')`); };
  // 목차 번호 = 마디 머리 번호(차례 · 글 그대로) — 장마다
  const tocOk = `(()=>{const p=document.querySelector('.wiki-page');const toc=[...p.querySelectorAll('.wiki-toc-item')].map(b=>b.textContent.replace(/\\s+/g,' ').trim());const hs=[...p.querySelectorAll('.wiki-h2, .wiki-sub .wiki-h3')].filter(h=>h.querySelector('.wiki-no')).map(h=>(h.querySelector('.wiki-no').textContent+' '+h.querySelector('.wiki-no').nextElementSibling.textContent).replace(/\\s+/g,' ').trim());let top=0,sub=0;const seq=toc.every(x=>{const n=x.split(' ')[0];if(/^\\d+\\.$/.test(n)){top++;sub=0;return n===top+'.'}sub++;return n===top+'.'+sub+'.'});return {toc,hs,ok:toc.length>=2&&seq&&toc.join('|')===hs.join('|')}})()`;
  for (const [t, id] of [['찬양팀', 'team:찬양팀'], ['가을 체육대회', 'p:sports'], ['월례회', 'p:wol'], ['QT 본문 일정', 'qt'], ['더다붓 소개', 'intro']]) {
    await openPage(t, id);
    const r = await ev(tocOk);
    check(`목차 번호 = 마디 머리(${t})`, r.ok, JSON.stringify(r).slice(0, 300));
  }
  // M15 읽은 만큼 차는 막대(UI 다듬기 2차 · 시안 값 · PITFALLS 75-f): 장 맨 위에 붙는 2px 바탕 빛 그라데이션 · 자리를 차지하지 않음 ·
  // main을 굴리는 만큼 찬다(CSS 스크롤 타임라인). **되돌리기**: index.css .dc-read-bar의 animation-timeline 줄을 지우면 '굴린 만큼'이 깨진다.
  {
    await openPage('월례회', 'p:wol');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 420, deviceScaleFactor: 1, mobile: false }); await sleep(400);
    const bar = (top) => ev(`(async () => { const m = document.querySelector('main'); m.scrollTop = ${top}; await new Promise(r => setTimeout(r, 120));
      const b = document.querySelector('.wiki-page > .dc-read-bar'); if (!b) return null; const i = b.firstElementChild, s = getComputedStyle(b), si = getComputedStyle(i);
      const mt = si.transform.match(/matrix\\(([^,]+)/); return { h: b.offsetHeight, mb: s.marginBottom, sticky: s.position, top: Math.round(b.getBoundingClientRect().top - m.getBoundingClientRect().top),
        sx: mt ? +(+mt[1]).toFixed(2) : (si.transform === 'none' ? 1 : null), grad: /gradient/.test(si.backgroundImage), max: m.scrollHeight - m.clientHeight }; })()`, true);
    const b0 = await bar(0), bMid = await bar(Math.round((b0?.max || 0) / 2)), bEnd = await bar(99999);
    check('M15 위키 장 머리에 읽은 만큼 차는 막대(2px · 바탕 빛 · 자리 0 · 굴린 만큼 · 맨 위에 붙음)',
      !!b0 && b0.h === 2 && b0.mb === '-2px' && b0.sticky === 'sticky' && b0.grad && b0.max > 200 && b0.sx === 0
      && Math.abs(bMid.sx - 0.5) < 0.06 && bEnd.sx === 1 && Math.abs(bEnd.top) <= 1, JSON.stringify({ b0, bMid, bEnd }));
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(300);
    await ev(`document.querySelector('main').scrollTop = 0`);
  }
  // 목차 → 그 마디: main만 앱 곡선(quint)으로 옮기고 마디 위 12px에 세운다 · 움직임 줄이기면 즉시(2026-10-15 · hooks/scrollGlide · 56-g).
  // 화면을 낮춰 장이 스크롤되게 한다. **되돌리기**: wikiView의 tocJump를 예전 scrollIntoView(smooth)로 두면 움직임 줄이기 단정이 깨진다.
  {
    await openPage('월례회', 'p:wol');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 420, deviceScaleFactor: 1, mobile: false }); await sleep(400);
    const tocLast = `(()=>{const b=[...document.querySelectorAll('.wiki-toc-item')].pop();if(!b)return null;const no=b.querySelector('span').textContent.trim();const sec=[...document.querySelectorAll('.wiki-sec, .wiki-sub')].find(x=>x.querySelector('.wiki-no')?.textContent.trim()===no);b.click();return sec?sec.id:null})()`;
    const gap = (id) => `(()=>{const m=document.querySelector('main');const e=document.getElementById(${JSON.stringify(id)});return {gap:Math.round(e.getBoundingClientRect().top-m.getBoundingClientRect().top), top:m.scrollTop, max:m.scrollHeight-m.clientHeight, page:document.scrollingElement.scrollTop}})()`;
    await ev(`document.querySelector('main').scrollTop=0`); await sleep(200);
    const idA = await ev(tocLast);
    await sleep(60);
    const mid = await ev(`document.querySelector('main').scrollTop`);
    await sleep(700);
    const end = idA ? await ev(gap(idA)) : null;
    // 끝까지 못 가는(맨 아래에 붙는) 마디면 gap이 12보다 클 수 있다 — 그때는 맨 아래에 닿았는지를 본다
    check('목차 → 그 마디: main이 움직여 마디 위 12px(또는 맨 아래)에 · 페이지는 그대로',
      !!end && end.page === 0 && end.top > 0 && (Math.abs(end.gap - 12) <= 3 || end.top >= end.max - 1), JSON.stringify({ idA, mid, end }));
    check('목차 → 그 마디: 한 번에 뛰지 않고 미끄러진다(움직임 줄이기가 아닐 때)', !!end && mid > 0 && mid < end.top, JSON.stringify({ mid, end }));
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await ev(`document.querySelector('main').scrollTop=0`); await sleep(200);
    const idB = await ev(tocLast);
    await sleep(40);
    const now = idB ? await ev(gap(idB)) : null;
    check('목차 → 그 마디: 움직임 줄이기면 즉시', !!now && !!end && Math.abs(now.top - end.top) <= 2, JSON.stringify({ now, end }));
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(400);
  }
  // 팀 장: 정보 상자(팀장 · 이름 · 가입자) · 구성원(현재 명단 기준 · 팀 몫 · 기록 전) · 지금 하는 일(현재 업무 기준 · 개발 프로젝트 뺌) · 날짜 붙은 칩 · 관련 문서 · 글 안 링크
  await openPage('찬양팀', 'team:찬양팀');
  const team = await ev(`(()=>{const p=document.querySelector('.wiki-page');const info=p.querySelector('.wiki-info');const rows=info?[...info.querySelectorAll('.grid')].map(r=>r.textContent):[];const labels=[...p.querySelectorAll('.wiki-live-label')].map(x=>x.textContent);
    const mem=[...p.querySelectorAll('.wiki-members li')].map(l=>l.textContent);const pills=[...p.querySelectorAll('.wiki-pill')].map(x=>x.textContent);const done=[...p.querySelectorAll('.wiki-done button')].map(b=>b.textContent);
    const chip=p.querySelector('.wiki-chip')?.textContent||'';const rel=[...p.querySelectorAll('.wiki-related button')].map(b=>b.textContent);const links=[...p.querySelectorAll('.wiki-link')].map(a=>a.textContent);
    const rowsH=[...p.querySelectorAll('.wiki-done button')].every(b=>b.getBoundingClientRect().height>=44);
    return {rows,labels,count:p.querySelector('.wiki-count')?.textContent,mem,pills,done,chip,rel,links,rowsH,side:info&&info.getBoundingClientRect().left>p.querySelector('.wiki-main').getBoundingClientRect().right}})()`);
  check('팀 장: 정보 상자(팀장 · 가입자) 오른쪽 칸', team.rows.some(r => r.includes('팀장') && r.includes('가나다')) && team.rows.some(r => r.includes('가입자') && r.includes('3명')) && team.side, JSON.stringify(team.rows));
  check("팀 장: 구성원 '현재 명단 기준' · 팀 몫만 · '맡은 일 기록 전'", team.labels.join('|') === '현재 명단 기준|현재 업무 기준' && team.count === '워크스페이스 가입자 3명이에요.'
    && team.mem[0].includes('가나다') && team.mem.some(m => m === '라마바베이스') && team.mem.some(m => m === '사아자맡은 일 기록 전') && !team.mem.some(m => m.includes('편집')), JSON.stringify(team));
  check('팀 장: 지금 하는 일 — 진행 중 · 마감 지남 · 최근에 끝낸 일(하위 업무 · 함께한 팀) · 개발 프로젝트 뺌 · 줄 44px', team.pills[0] === '진행 중 1건' && team.pills[1] === '마감 지남 · 보류 1건'
    && team.done.length === 1 && team.done[0].includes('찬양 송폼 제작') && team.done[0].includes('1/2') && team.done[0].includes('워십팀') && team.rowsH, JSON.stringify({ pills: team.pills, done: team.done }));
  check('팀 장: 다른 팀과 했던 일 칩에 날짜 · 관련 문서 · 글 안 링크(장 제목 · 자주 쓰는 말 · 마디마다 처음 한 번)', team.chip.startsWith('8월 23일') && team.rel.includes('월례회')
    && team.links.filter(l => l === '콘티').length === 2 && team.links.includes('월례회') === false, JSON.stringify({ chip: team.chip, rel: team.rel, links: team.links }));
  await click('.wiki-link', '콘티');
  check('글 안 링크 → 그 장', await until(`!!document.querySelector('.wiki-page[data-page="terms"]')`));
  // 행사 장: 정보 상자(장을 만들 때 뽑은 줄 + 지금 준비 업무) · 정해지기까지(바뀌기 전 · 지금 정해진 내용) · 준비(현재 업무 기준 · 지금 상태)
  await openPage('가을 체육대회', 'p:sports');
  const ev1 = await ev(`(()=>{const p=document.querySelector('.wiki-page');const rows=[...p.querySelectorAll('.wiki-info .grid')].map(r=>r.textContent);const st=[...p.querySelectorAll('.wiki-steps li')].map(l=>({s:l.dataset.state||'',t:l.textContent,strike:getComputedStyle(l.querySelector('span.text-\\\\[15px\\\\]')).textDecorationLine}));
    const prep=[...p.querySelectorAll('.wiki-prep button')].map(b=>b.textContent);return {rows,st,prep,h:[...p.querySelectorAll('h2.wiki-h2')].map(h=>h.textContent)}})()`);
  check('행사 장: 정보 상자 — 날짜 · 장소 · 맡은 곳 · 준비 업무(지금 상태)', ev1.rows.join('|') === '날짜10월 31일(토) 14:00~18:00|장소한강공원|맡은 곳임원진|준비 업무1건 · 진행 중', JSON.stringify(ev1.rows));
  check("행사 장: 정해지기까지 — 바뀌기 전(줄 그음) · 지금 정해진 내용", ev1.st.length === 2 && ev1.st[0].s === 'old' && ev1.st[0].t.includes('바뀌기 전') && ev1.st[0].strike === 'line-through' && ev1.st[1].s === 'now' && ev1.st[1].t.includes('지금 정해진 내용') && ev1.st[1].strike === 'none', JSON.stringify(ev1.st));
  check("행사 장: 마디 차례(개요 · 정해지기까지 · 기록 · 준비 · 관련 문서) · 준비 줄은 지금 상태와 하위 업무", ev1.h.map(h => h.replace(/현재 업무 기준$/, '')).join('|') === '1.개요|2.정해지기까지|3.기록|4.준비|5.관련 문서'
    && ev1.prep.length === 1 && ev1.prep[0].includes('진행 중') && ev1.prep[0].includes('임원진 · 마감 10월 25일 · 하위 업무 2개'), JSON.stringify(ev1));
  // 되풀이 모임: 개요는 뜻 + 다음 날짜 · 업무 마디 이름은 '업무'
  await openPage('리더 모임', 'p:monthly');
  const rec = await ev(`(()=>{const p=document.querySelector('.wiki-page');return {h:[...p.querySelectorAll('h2.wiki-h2')].map(h=>h.textContent),lead:p.querySelector('.wiki-sec')?.textContent||'',info:[...p.querySelectorAll('.wiki-info .grid')].map(r=>r.textContent)}})()`);
  check("되풀이 모임: 개요 = 뜻 + 다음 날짜 · '업무' 마디(현재 업무 기준) · 정보 상자 '업무'", rec.lead.includes('리더 모임은 둘째 주에 모여요.') && rec.lead.includes('다음 리더 모임은 10월 11일(일)이에요.') && rec.h.some(h => h === '2.업무현재 업무 기준') && rec.info.includes('업무2건'), JSON.stringify(rec));
  // QT 달력: 7칸 · 주일 강조색 · 책 점 + 범례 · 장:절 한 줄 · 오늘(강조 테두리 + '오늘') · 지난 날 옅게 · 칸 44px 넘게
  await openPage('QT 본문 일정', 'qt');
  await until(`[...document.querySelectorAll('.wiki-qt-day')].some(d=>d.textContent.includes('야고보서'))`, 6000);
  const qd = await ev(`(()=>{const cells=[...document.querySelectorAll('.wiki-qt-cell')];const t=cells.find(c=>c.getAttribute('aria-current')==='date');const past=cells.find(c=>c.getAttribute('aria-label').includes('${Number(kst(-1).slice(5, 7))}월 ${Number(kst(-1).slice(8))}일'));
    const refOne=cells.every(c=>{const b=c.querySelector('b.text-\\\\[14px\\\\]');return b&&b.getBoundingClientRect().height<26});
    return {today:!!t&&t.textContent.includes('오늘')&&getComputedStyle(t).borderTopWidth==='2px', past:past?getComputedStyle(past).opacity:'', refOne, legend:document.querySelectorAll('.wiki-qt-legend i').length, h:Math.min(...cells.map(c=>c.getBoundingClientRect().height)), dots:cells.every(c=>!!c.querySelector('i'))}})()`);
  check("QT 달력: 오늘 강조 + '오늘' · 지난 날 옅게 · 장:절 한 줄 · 책 점 · 범례 · 칸 높이", qd.today && qd.past === '0.5' && qd.refOne && qd.legend >= 2 && qd.dots && qd.h >= 44, JSON.stringify(qd));

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
    // 물어보고 👍 → 위키 목록 → 다시 물어보기: 페이지가 밀리지 않고 반응이 다시 돌지 않는다(사용자 지적 2026-10-03)
    if (theme === 'light') {
      await ev(`(()=>{const i=document.querySelector('.dab-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'월례회는 언제 해요?');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
      await until(`!!document.querySelector('.dab-answer [aria-label="도움이 됐어요"]')`);
      await ev(`document.querySelector('.dab-answer [aria-label="도움이 됐어요"]').click()`);
      await sleep(1200);
      await click('button', '위키');
      await until(`!!document.querySelector('.wiki-mobile .wiki-list')`);
      await click('.dab-ring');
      await until(`!!document.querySelector('.dab-answer')`);
      const back = await ev(`({pageY: document.scrollingElement.scrollTop, pageX: document.scrollingElement.scrollLeft, anim: !!document.querySelector('.dab-hop, .dab-droop, .dab-thumb-pop, .dab-thumb-shake, .dab-burst'), pressed: document.querySelector('.dab-answer [aria-label="도움이 됐어요"]').getAttribute('aria-pressed')})`);
      check(`폰: 물어보기로 돌아와도 페이지가 밀리지 않고 반응이 다시 돌지 않는다(누른 상태는 그대로)`, back.pageY === 0 && back.pageX === 0 && !back.anim && back.pressed === 'true', JSON.stringify(back));
      // 칸에 치는 동안은 키보드가 하단 바를 덮는다 — main의 하단 바 몫 여백을 걷고 칸이 바닥에 · 안 칸에 네모 포커스 테두리가 없다(사용자 지적 2026-10-04)
      await send('Emulation.setFocusEmulationEnabled', { enabled: true });   // 헤드리스는 창에 초점이 없어 :focus가 안 선다
      await ev(`document.querySelector('.dab-input input').focus()`);
      await sleep(150);
      const kbState = `(()=>{const m=document.querySelector('main');const i=document.querySelector('.dab-input input');return {pb:parseFloat(getComputedStyle(m).paddingBottom), gap:Math.round(m.getBoundingClientRect().bottom-document.querySelector('.dab-input').getBoundingClientRect().bottom), outline:getComputedStyle(i).outlineStyle}})()`;
      // 아이폰은 키보드가 뜨는 순간 보이는 창을 아래로 옮긴다(offsetTop 299 · 실기기 기록 2026-10-04) — 같은 이벤트에서 뿌리를 같이 내려 안 움직여 보이게
      const panTop = async (off) => ev(`(()=>{const vv=visualViewport;Object.defineProperty(vv,'offsetTop',{configurable:true,get:()=>${off}});vv.dispatchEvent(new Event('scroll'));const r=document.querySelector('main').parentElement.getBoundingClientRect().top;delete vv.offsetTop;return Math.round(r)})()`);
      const panned = await panTop(299), settled = await panTop(0);
      check(`폰: 아이폰이 보이는 창을 옮기면 뿌리도 같은 거리만큼(되돌아오면 0)`, panned === 299 && settled === 0, JSON.stringify({ panned, settled }));
      // 창 옮김 사이에 문서 스크롤(window scroll)만 따로 올 때도 맞춘다
      const viaWin = await ev(`(()=>{const vv=visualViewport;Object.defineProperty(vv,'offsetTop',{configurable:true,get:()=>76});window.dispatchEvent(new Event('scroll'));const r=document.querySelector('main').parentElement.getBoundingClientRect().top;delete vv.offsetTop;vv.dispatchEvent(new Event('scroll'));return Math.round(r)})()`);
      check(`폰: 문서 스크롤 이벤트만 와도 뿌리 위치를 맞춘다`, viaWin === 76, String(viaWin));
      await ev(`document.querySelector('.dab-input input').focus()`);
      await sleep(150);
      const noKb = await ev(kbState);
      check(`폰: 키보드 없이 초점만 있으면 칸은 하단 바 위 그대로 · 네모 테두리 없음`, noKb.pb >= 80 && noKb.outline === 'none', JSON.stringify(noKb));
      // 키보드 흉내 — 아이폰처럼 보이는 창과 innerHeight가 **같이** 준다(innerHeight와 견주던 판은 여기서 표시가 안 섰다 · 2026-10-04 실기기)
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 500, deviceScaleFactor: 2, mobile: true }); await sleep(400);
      const kb = await ev(`(()=>{const s=${kbState};s.kb=document.documentElement.hasAttribute('data-kb');return s})()`);
      check(`폰: 키보드가 뜨면 하단 바 몫 여백이 걷혀 칸이 바닥에`, kb.kb && kb.pb <= 10 && kb.gap <= 24, JSON.stringify(kb));
      await ev(`document.activeElement.blur()`);
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(400);
      check(`폰: 키보드가 내려가면 표시가 걷힌다`, await ev(`!document.documentElement.hasAttribute('data-kb')`));
      // 대화가 길 때 키보드를 열어도 칸이 화면 안 · 맨 아래를 보고 있었으면 맨 아래 그대로(사용자 지적 2026-10-05 · PITFALLS 33-u —
      // 위키 판의 overflow-x-hidden이 세로도 스크롤 통이 되어 sticky가 main 대신 거기에 붙었다)
      for (let k = 0; k < 3; k++) {
        const before = await ev(`document.querySelectorAll('.dab-answer').length`);
        await ev(`(()=>{const i=document.querySelector('.dab-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'질문 ${k} 월례회는 언제 해요?');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
        await until(`document.querySelectorAll('.dab-answer').length > ${before}`);
      }
      await sleep(900);
      await ev(`document.querySelector('.dab-input input').focus()`);
      await sleep(150);
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 480, deviceScaleFactor: 2, mobile: true }); await sleep(700);
      const longKb = await ev(`(()=>{const m=document.querySelector('main');const b=document.querySelector('.dab-input').getBoundingClientRect().bottom;return {inputBottom:Math.round(b), mainBottom:Math.round(m.getBoundingClientRect().bottom), left:m.scrollHeight-m.clientHeight-m.scrollTop, wikiOverflowY:getComputedStyle(document.querySelector('.wiki-mobile')).overflowY}})()`);
      check(`폰: 대화가 길어도 키보드를 열면 칸이 화면 안 · 맨 아래 그대로`, longKb.inputBottom <= longKb.mainBottom && longKb.left <= 2 && longKb.wikiOverflowY !== 'auto', JSON.stringify(longKb));
      await ev(`document.activeElement.blur()`);
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(400);
      // 입력 줄 아래 띠(칸 ~ 하단 바)도 페이지 바탕으로 덮인다 — sticky는 main 아래 여백 위에 서서 그 띠로 말풍선이 비쳤다(사용자 지적
      // 2026-10-18 아이폰 · PITFALLS 68-b) · 맨 아래로 내리면 마지막 답이 칸 위에 다 선다.
      // **되돌리기**: dabooti.jsx 입력 줄의 dab-dock(또는 index.css의 그 규칙)을 지우면 덮는 끝(cover)이 하단 바 위에서 멈춰 깨진다.
      {
        const dock = await ev(`(()=>{const main=document.querySelector('main');main.scrollTop=main.scrollHeight;const d=document.querySelector('.dab-input').parentElement;const r=d.getBoundingClientRect();const nav=document.querySelector('nav[data-tab-bar]').getBoundingClientRect();const cs=getComputedStyle(d);const m=cs.boxShadow.match(/(-?[\\d.]+)px (-?[\\d.]+)px (-?[\\d.]+)px (-?[\\d.]+)px/);const turns=[...document.querySelectorAll('[data-turn]')];return {gap:Math.round(nav.top-r.bottom), cover:Math.round(m?r.bottom+parseFloat(m[2])+parseFloat(m[4]):r.bottom), navTop:Math.round(nav.top), same:cs.boxShadow.startsWith(getComputedStyle(document.body).backgroundColor), lastBottom:Math.round(turns[turns.length-1].getBoundingClientRect().bottom), inputTop:Math.round(document.querySelector('.dab-input').getBoundingClientRect().top)}})()`);
        check(`폰: 대화 입력 줄 아래 띠(하단 바까지)도 페이지 바탕 · 마지막 답은 칸 위에 다 선다`, dock.gap > 0 && dock.cover >= dock.navTop && dock.same && dock.lastBottom <= dock.inputTop, JSON.stringify(dock));
      }
      // 띄어쓰기 없는 긴 낱말·주소 — 질문·답 말풍선이 둘 다 화면 안에서 줄을 바꾼다(2026-10-14 점검 · PITFALLS 49-a ·
      // **되돌리기**: dabooti.jsx 대화 grid들의 minmax(0,1fr)와 말풍선의 overflow-wrap:anywhere를 옛 모양(grid gap-3 · 34px_1fr ·
      // break-words)으로 두면 둘 다 오른쪽 밖(right 746 · 폭 390)으로 밀려 깨진다 — 둘 중 하나만 남아도 막힌다(겹쳐 막은 것))
      {
        const LONG = '띄어쓰기없이아주길게이어지는질문이에요https://example.com/averylongpathsegmentwithoutanybreakopportunity/andmore';
        await ev(`window.__dabootiAnswer=${JSON.stringify({ id: 'q-long', status: 'answered', sentences: [{ text: '워크스페이스에서는 그런 내용을 찾을 수가 없어서, 해당 질문은 보완해서 내일 아침에 학습해 둘게요. https://example.com/averylongpathsegmentwithoutanybreakopportunity/andmore', cites: [] }], files: [] })}`);
        const before = await ev(`document.querySelectorAll('.dab-answer').length`);
        await ev(`(()=>{const i=document.querySelector('.dab-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(LONG)});i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
        await until(`document.querySelectorAll('.dab-answer').length > ${before}`);
        await sleep(500);
        const wrap = await ev(`(()=>{const q=[...document.querySelectorAll('.dab-q')].pop().getBoundingClientRect();const a=[...document.querySelectorAll('.dab-answer')].pop().getBoundingClientRect();return {qRight:Math.round(q.right), aRight:Math.round(a.right), aH:Math.round(a.height), w:innerWidth, sw:document.documentElement.scrollWidth}})()`);
        check(`폰: 긴 낱말·주소도 질문·답 말풍선이 화면 안에서 줄을 바꾼다`, wrap.qRight <= wrap.w && wrap.aRight <= wrap.w && wrap.sw <= wrap.w + 1 && wrap.aH > 80, JSON.stringify(wrap));
        await ev(`window.__dabootiAnswer=${JSON.stringify(ANSWER)}`);
      }
      // 화면보다 긴 답은 끝이 아니라 그 질문부터 보인다 — 질문 말풍선이 main 맨 위에 선다(2026-10-15 · 56-g).
      // 짧은 답은 예전처럼 맨 아래. **되돌리기**: dabooti.jsx의 질문 맨 위 갈래를 빼면(늘 맨 아래) 깨진다.
      {
        const ask1 = (q) => ev(`(()=>{const i=document.querySelector('.dab-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(q)});i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
        const LONG_A = { id: 'q-longans', status: 'answered', sentences: Array.from({ length: 28 }, (_, i) => ({ text: `${i + 1}번째 문장. 월례회는 둘째 주 순모임 뒤에 모여서 한 달을 돌아보고 다음 달을 맞춰 봐요.`, cites: [] })), files: [] };
        await ev(`window.__dabootiAnswer=${JSON.stringify(LONG_A)}`);
        const before = await ev(`document.querySelectorAll('.dab-answer').length`);
        await ask1('월례회 처음부터 다 알려줘');
        await until(`document.querySelectorAll('.dab-answer').length > ${before}`);
        await sleep(900);
        const longTop = await ev(`(()=>{const m=document.querySelector('main');const q=[...document.querySelectorAll('.dab-q')].pop();const a=[...document.querySelectorAll('.dab-answer')].pop();const mt=m.getBoundingClientRect().top;return {q:Math.round(q.getBoundingClientRect().top-mt), aBottom:Math.round(a.getBoundingClientRect().bottom-mt), h:m.clientHeight, left:Math.round(m.scrollHeight-m.clientHeight-m.scrollTop)}})()`);
        check('폰: 화면보다 긴 답은 그 질문이 맨 위에 선다(끝이 아니라 처음부터)', longTop.q >= 0 && longTop.q <= 40 && longTop.aBottom > longTop.h && longTop.left > 40, JSON.stringify(longTop));
        await ev(`window.__dabootiAnswer=${JSON.stringify(ANSWER)}`);
        await ask1('월례회는 언제 해요?');
        await until(`document.querySelectorAll('.dab-answer').length > ${before + 1}`);
        await sleep(900);
        const shortEnd = await ev(`(()=>{const m=document.querySelector('main');return Math.round(m.scrollHeight-m.clientHeight-m.scrollTop)})()`);
        check('폰: 짧은 답은 예전처럼 맨 아래', shortEnd <= 2, String(shortEnd));
      }
    }

    await click('button', '위키');
    check(`폰(${theme}): 돌아오면 왼쪽에서`, await until(`!!document.querySelector('.wiki-mobile .wiki-in-back')`));
    // 장 목록 → 장 → ‹ 위키면 목록 자리 그대로 · 장은 맨 위에서(2026-10-15 · hooks/useScrollMemory · 56-h).
    // **되돌리기**: wikiView의 useScrollMemory를 빼고 go()가 늘 맨 위로 올리면 깨진다.
    if (theme === 'light') {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 520, deviceScaleFactor: 2, mobile: true }); await sleep(500);
      const listTop = await ev(`(()=>{const m=document.querySelector('main');m.scrollTop=m.scrollHeight;return m.scrollTop})()`);
      await sleep(300);
      await ev(`[...document.querySelectorAll('.wiki-item')].pop().click()`);
      await until(`!!document.querySelector('.wiki-page')`); await sleep(500);
      const inPage = await ev(`document.querySelector('main').scrollTop`);
      await click('button', '위키');
      await until(`!!document.querySelector('.wiki-mobile .wiki-list')`); await sleep(500);
      const back = await ev(`document.querySelector('main').scrollTop`);
      check('폰: 위키 목록 → 장은 맨 위에서 · ‹ 위키면 목록 자리 그대로', listTop > 40 && inPage === 0 && Math.abs(back - listTop) <= 2, JSON.stringify({ listTop, inPage, back }));
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(400);
    }
    await click('.wiki-item', '주보 만들기');
    check(`폰(${theme}): 행 블록 넘침 없음`, await until(`!!document.querySelector('.wiki-page[data-page="weekly:bulletin"]')`) && await over());
    await click('.wiki-item', '월례회').catch(() => false);
    await click('button', '위키');
    await click('.wiki-item', '월례회');
    check(`폰(${theme}): 장 넘침 없음 · ‹ 위키`, await until(`!!document.querySelector('.wiki-page[data-page="p:wol"]')`) && await over());
    // 고치기 칸은 글 밖으로 6px 나온다 — 넘김 때문에 가로를 자르는 판에 왼쪽 테두리가 잘리지 않는다(사용자 지적 2026-10-04)
    await click('.wiki-edit', '수정');
    await until(`document.querySelectorAll('.wiki-draft').length >= 3`);
    const clip = await ev(`(()=>{const w=document.querySelector('.wiki-mobile').getBoundingClientRect();return [...document.querySelectorAll('.wiki-draft')].every(d=>{const r=d.getBoundingClientRect();return r.left-2>=w.left&&r.right+2<=w.right})})()`);
    check(`폰(${theme}): 고치기 칸 테두리가 잘리지 않는다`, clip);
    await click('button', '취소');
    await until(`!document.querySelector('.wiki-draft')`);
    await click('button', '위키');
    check(`폰(${theme}): ‹ 위키 → 첫 화면`, await until(`!!document.querySelector('.wiki-mobile .wiki-list') && !document.querySelector('.wiki-page')`));
  }

  // ── ⑧ 폰 390 · 라이트/다크: 모든 장 가로 넘침 없음 · 정보 상자는 맨 위 한 줄 너비 · QT는 주마다 줄(44px 넘게) ──
  for (const theme of ['light', 'dark']) {
    await open({ mobile: true, theme, path: '/?p=wiki' });
    await until(`!!document.querySelector('.wiki-mobile .wiki-list')`);
    const bad = [];
    for (const p of FIX.pages.filter(x => x.id !== 'faq')) {
      await click('.wiki-item', p.title);
      await until(`!!document.querySelector('.wiki-page[data-page="${p.id}"]')`);
      await sleep(450);
      const r = await ev(`(()=>{const over=document.documentElement.scrollWidth>innerWidth+1||[...document.querySelectorAll('main *')].some(e=>e.getBoundingClientRect().right>innerWidth+1);const i=document.querySelector('.wiki-info');const m=document.querySelector('.wiki-main');
        return {over, info: i ? (i.getBoundingClientRect().bottom<=m.getBoundingClientRect().top+1 && Math.abs(i.getBoundingClientRect().width-m.getBoundingClientRect().width)<2) : true}})()`);
      if (r.over || !r.info) bad.push(`${p.title}:${JSON.stringify(r)}`);
      if (p.id === 'qt') {
        const q = await ev(`(()=>{const rows=[...document.querySelectorAll('.wiki-qt-day button')];const t=rows.find(b=>b.getAttribute('aria-current')==='date');return {n:rows.length,h:Math.min(...rows.map(b=>b.getBoundingClientRect().height)),today:t?.textContent.endsWith('오늘'),week:document.querySelector('.wiki-qt p')?.textContent||''}})()`);
        check(`폰(${theme}): QT는 주마다 묶은 줄 · 줄 44px 넘게 · 오늘 표시`, q.n >= 6 && q.h >= 44 && q.today && /^10월 1일 ~ 3일$/.test(q.week), JSON.stringify(q));
      }
      await click('button', '위키');
      await until(`!!document.querySelector('.wiki-mobile .wiki-list')`);
    }
    check(`폰(${theme}): 모든 장 가로 넘침 없음 · 정보 상자는 맨 위 한 줄 너비`, bad.length === 0, bad.join(' / '));
  }

  // ── 마스터 알림의 딥링크(2026-10-04) — /?p=wiki&wiki=faq가 자주 묻는 질문 장을 연다 ──
  await open({ mobile: false, path: '/?p=wiki&wiki=faq' });
  check('딥링크 wiki=faq → 아직 답하지 못한 질문 장', await until(`!!document.querySelector('.wiki-page[data-page="faq"]')`));
  // ── 마스터가 아닌 사람(0090) — ✎ 수정 없음 · 자주 묻는 질문 장 없음 · 모르는 답에 그 장 칩 없음 · 수정한 곳 없음 ──
  await open({ mobile: false, member: true });
  await until(`!!document.querySelector('.wiki-item')`);
  const mem = await ev(`[...document.querySelectorAll('.wiki-item')].map(b=>b.textContent)`);
  await click('.wiki-item', '월례회');
  await until(`!!document.querySelector('.wiki-page[data-page="p:wol"]')`);
  const memPage = await ev(`({edit:!!document.querySelector('.wiki-edit'), fixedTag:document.querySelector('.wiki-page').textContent.includes('수정한 곳'), source:document.querySelector('.wiki-page').textContent.includes('업무에서 자동으로 수집')})`);
  check('마스터 아님: 자주 묻는 질문 장 없음 · ✎ 수정 없음 · 수정한 곳 없음(출처는 그대로)', mem.length >= 5 && !mem.some(t => t.includes('아직 답하지 못한 질문')) && !memPage.edit && !memPage.fixedTag && memPage.source, JSON.stringify({ mem, memPage }));
  // 20차 ⑧ — 다붓이가 배운 것 장도 마스터만(목록 · 딥링크). 되돌리기: wikiCore.MASTER_PAGES에서 LEARNED_ID를 빼면 깨진다
  check('마스터 아님: 다붓이가 배운 것 장 없음', !mem.some(t => t.includes('다붓이가 배운 것')), JSON.stringify(mem));
  await open({ mobile: false, member: true, path: '/?p=wiki&wiki=learned' });
  await until(`!!document.querySelector('.wiki-item')`);
  await sleep(400);
  check('마스터 아님: 딥링크 wiki=learned도 열리지 않는다', await ev(`!document.querySelector('.wiki-page[data-page="learned"]')`));
  await open({ mobile: false, member: true });
  await until(`!!document.querySelector('.wiki-item')`);
  await click('.dab-ring');
  await until(`!!document.querySelector('.dab-input input')`);
  await ev(`(()=>{const i=document.querySelector('.dab-input input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'리더 MT 어디서 해요?');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
  await until(`document.querySelector('.dab-answer')?.dataset.status === 'unknown'`);
  check('마스터 아님: 모르는 질문 답에 자주 묻는 질문 칩이 없다', await ev(`!document.querySelector('.dab-answer').querySelector('.wiki-cite')`));

  // ── 모션 최소화 ───────────────────────────────────────────────────────────
  await open({ mobile: false, reduce: true });
  await until(`!!document.querySelector('.wiki-side .dab-ring')`);
  check('모션 최소화: 갸웃·무지개가 멈춘다', await ev(`getComputedStyle(document.querySelector('.dab-pill .dab-face')).animationName === 'none' && getComputedStyle(document.querySelector('.wiki-side .dab-ring')).animationName === 'none'`));
  if (await until(`document.querySelectorAll('.dab-chip').length === 3`, 3000)) {
    const r0 = await ev(`[...document.querySelectorAll('.dab-chip')].map(b=>b.textContent).join('|')`);
    await sleep(4600);
    check('모션 최소화: 질문 칩이 바뀌지 않는다', await ev(`[...document.querySelectorAll('.dab-chip')].map(b=>b.textContent).join('|')`) === r0);
  } else check('모션 최소화: 질문 칩이 바뀌지 않는다', false, '칩이 안 보임');
  // ── 위키 읽기 실패(시안 E6 · 사용자 승인 2026-10-15) ───────────────────────────────
  // 실패 글 위에 다붓이 물음표 컷(64px)이 서고, 컷 + 글 + 버튼 묶음이 위키 판의 정가운데에 선다 —
  // 폰은 물어보기 줄 아래부터 하단 탭바 위까지, 데스크톱은 옆 목록과 같은 높이의 본문 칸. 실패는 장 묶음 getter가 던져서 만든다.
  // **되돌리기**: WikiFail의 컷 <img>를 지우면 '컷'이, minHeight(폰 잰 값 · 데스크톱 --wiki-h)를 지우면 '가운데'가 깨진다.
  for (const mobile of [true, false]) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await send('Emulation.setDeviceMetricsOverride', mobile ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const s = await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__wikiFixture = { get pages() { throw new Error('위키 읽기 실패(검사)'); } };` });
    await send('Page.navigate', { url: URL_BASE + '/?p=wiki' });
    await sleep(600);
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: s.identifier });
    await until(`!!document.querySelector('.wiki-load-failed')`);
    await sleep(500);
    const f = await ev(`(() => {
      const p = document.querySelector('.wiki-load-failed'); if (!p) return { none: true };
      const kids = [...p.children]; const a = kids[0].getBoundingClientRect(), z = kids[kids.length - 1].getBoundingClientRect(), r = p.getBoundingClientRect();
      const bar = document.querySelector('[data-tab-bar]');
      const aside = document.querySelector('.wiki-side'); const sec = p.closest('section');
      const img = p.querySelector('img');
      return { cut: img ? (img.getAttribute('src') + ' ' + Math.round(img.getBoundingClientRect().width)) : '', first: kids[0].tagName,
        title: p.querySelector('.load-fail-title')?.textContent, retry: !!p.querySelector('.load-fail-retry'),
        groupMid: Math.round((a.top + z.bottom) / 2), groupX: Math.round((Math.min(a.left, z.left) + Math.max(a.right, z.right)) / 2),
        want: ${mobile} ? Math.round((r.top + (bar ? bar.getBoundingClientRect().top : innerHeight)) / 2) : Math.round((aside.getBoundingClientRect().top + aside.getBoundingClientRect().bottom) / 2),
        wantX: Math.round(${mobile} ? (r.left + r.right) / 2 : (sec.getBoundingClientRect().left + parseFloat(getComputedStyle(sec).paddingLeft) + sec.getBoundingClientRect().right - parseFloat(getComputedStyle(sec).paddingRight)) / 2) };
    })()`);
    const tag = mobile ? '폰 390' : '데스크톱 1440';
    check(`위키 읽기 실패 — 글 위에 다붓이 물음표 컷 64px(${tag})`, f.first === 'IMG' && f.cut === '/chars/question.webp 64' && f.title === '위키를 불러오지 못했어요' && f.retry, JSON.stringify(f));
    check(`위키 읽기 실패 묶음은 판의 정가운데에 선다(${tag})`, Math.abs(f.groupMid - f.want) <= 3 && Math.abs(f.groupX - f.wantX) <= 2, JSON.stringify(f));
    if (!mobile) {
      // 데스크톱은 처음 자리가 물어보기다 — 실패가 그 자리에 서고, 물어보기 칸을 누르면 그때는 물어보기다
      await ev(`document.querySelector('.wiki-side .dab-ring, .wiki-side button')?.click(); true`);
      await sleep(400);
      check('데스크톱 위키 실패 중에도 물어보기 칸을 누르면 물어보기가 열린다', await ev(`!!document.querySelector('.dab-home') && document.querySelector('.dab-home').offsetParent !== null && !document.querySelector('.wiki-load-failed')`));
    }
  }
  check('예외 없음', errs.length === 0, errs.slice(0, 2).join(' | '));
} catch (e) {
  check('실행', false, e.message);
} finally {
  for (const r of results) console.log(r);
  ws.close(); chrome.kill();
  if (results.some(r => r.startsWith('FAIL'))) process.exitCode = 1;
}
