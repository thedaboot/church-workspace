// 순모임 가이드의 순수 로직 검사 — 서버 불필요(네트워크 0).
// 실행: node tests/sunguide.mjs
//
// 무엇을 보나: 프롬프트에 주보와 **본문 텍스트**가 실리는지 · 모델의 답을 읽는지
// (코드펜스·잡문·잘못된 모양) · 글자수 상한을 문장 경계에서 맞추는지 · 굵게 마커를
// 가르는지. 화면(내 순 탭에서 카드가 보이는지)은 tests/groups.mjs가 본다.
//
// sunGuide.js는 supabase·ai·bible·worship을 부르므로 노드에서 그대로 못 읽는다 —
// tests/aictx.mjs와 같은 방식으로 **import 줄만** 가짜로 바꿔 임시 모듈로 돌린다.
// 가짜는 그 함수들의 계약만 흉내낸다(모델의 답은 globalThis.__AI, 본문은 __PASSAGE).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 경로에 한글이 있어서 URL로 읽는다 — `new URL(...).pathname`은 퍼센트 인코딩된
// 글자를 그대로 주고, 그걸 파일 경로로 쓰면 없는 파일이 된다(tests/bibleref.mjs와 같은 방식).
const src = readFileSync(new URL('../src/services/sunGuide.js', import.meta.url), 'utf8');
const patched = src
  .replace(/import \{ supabase \} from '\.\/supabaseClient\.js';/, 'const supabase = null;')
  .replace(/import \{ guestStore \} from '\.\/people\.js';/,
    'const guestStore = () => ({ all: () => ({}), rows: () => globalThis.__ROWS || [], set: (t, l) => { globalThis.__SET = [t, l]; } });')
  .replace(/import \{ AiService, isFallbackText \} from '\.\/ai\.js';/,
    `const AiService = { callGemini: async (p, s) => { globalThis.__CALL = { p, s }; return globalThis.__AI ?? ''; } };
const isFallbackText = (t) => t === 'AI 기능은 로그인 후 사용할 수 있어요.';`)
  .replace(/import \{ loadPassage \} from '\.\/bible\.js';/,
    'const loadPassage = async () => globalThis.__PASSAGE ?? null;')
  .replace(/import \{ kindLabel, formatServiceDate \} from '\.\/worship\.js';/,
    `const kindLabel = (k) => (k === 'sunday' ? '주일 4부 젊은이 예배' : (k || '예배'));
const formatServiceDate = (iso) => String(iso || '');`);
if (patched === src) { console.log('FAIL  import 줄을 못 바꿨어요 (sunGuide.js의 import가 바뀌었나요)'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'sunguide-'));
const file = join(dir, 'sunGuide.mjs');
writeFileSync(file, patched);
const G = await import(pathToFileURL(file).href);

let fails = 0;
const check = (name, pass, detail = '') => {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}${detail ? `\n  ${detail}` : ''}`); fails++; }
};

// ── 재료 ────────────────────────────────────────────────────────────────────
const SERVICE = {
  id: 'svc-1', kind: 'sunday', service_date: '2026-03-01', status: 'published',
  title: '세상의 빛으로 오신 예수님', passage_ref: '요한복음 8:12-20', preacher: '김승찬',
};
const VERSES = [
  { chapter: 8, verse: 12, text: '예수께서 또 일러 가라사대 나는 세상의 빛이니' },
  { chapter: 8, verse: 13, text: '바리새인들이 가로되 네가 너를 위하여 증거하니' },
  { chapter: 8, verse: 14, text: '예수께서 대답하여 가라사대 내가 나를 위하여 증거할지라도' },
];
const GUIDE = {
  passage: { ref: '요한복음 8:12-20', title: '세상의 빛으로 오신 예수님' },
  summaryRef: '요한복음 8:1~11',
  summary: '예수님은 성전에서 사람들을 가르치셨습니다. 바리새인들은 예수님을 시험하려 했습니다.',
  points: [
    { title: '생명의 빛', body: '예수님은 **나는 세상의 빛이니**라고 말씀하셨습니다.' },
    { title: '육체의 시선 VS 하나님의 증언', body: '바리새인들은 눈에 보이는 것으로 판단했습니다.' },
    { title: '하나님을 아는 유일한 통로', body: '예수님을 아는 것이 아버지를 아는 길입니다.' },
  ],
  questions: ['지난 한 주 어떻게 지내셨나요', '빛으로 걷는다는 것은 무엇일까요', '어디에 시선을 두고 있나요'],
};
const json = (v) => JSON.stringify(v);

// ── 1) 프롬프트에 무엇이 실리나 ─────────────────────────────────────────────
const passageText = G.passageLines(VERSES);
const { prompt, system } = G.buildGuidePrompt({ service: SERVICE, passageText });
check('프롬프트에 설교 제목이 실린다', prompt.includes('세상의 빛으로 오신 예수님'));
check('프롬프트에 본문 구절이 실린다', prompt.includes('요한복음 8:12-20'));
check('프롬프트에 설교자와 예배 이름이 실린다',
  prompt.includes('김승찬') && prompt.includes('주일 4부 젊은이 예배'), prompt.slice(0, 140));
check('프롬프트에 개역한글 본문 텍스트가 절 번호와 함께 실린다',
  prompt.includes('12 예수께서 또 일러 가라사대 나는 세상의 빛이니') && prompt.includes('개역한글'));
check('프롬프트가 JSON 한 벌만 내라고 지시한다',
  prompt.includes('JSON') && prompt.includes('"summary"') && prompt.includes('"questions"'));
check('프롬프트가 글자수 상한을 숫자로 말한다',
  prompt.includes(String(G.LIMITS.summary)) && prompt.includes(String(G.LIMITS.pointBody))
  && prompt.includes(String(G.LIMITS.question)));
check('프롬프트가 번호·Q.를 붙이지 말라고 말한다', prompt.includes('"Q."를 붙이지 마라'));
// 요약이 다루는 구절 범위 — 템플릿 1장의 빨간 소제목('[요한복음 8:1~11 배경 요약]').
// 주일 본문의 앞 문맥일 때가 많아서 모델에게 따로 물어야 한다.
check('프롬프트가 요약이 다루는 구절 범위를 따로 묻는다',
  prompt.includes('"summaryRef"') && prompt.includes('앞 문맥')
  && prompt.includes(String(G.LIMITS.summaryRef)));
check('시스템 프롬프트가 §8 문구 톤을 싣는다',
  system.includes('견주는') && system.includes('핵심') && system.includes('지어내지 마라'), system.slice(0, 120));
check('시스템 프롬프트가 코드펜스를 금지한다', system.includes('코드펜스'));
// 본문을 못 읽어도 프롬프트는 만들어진다 — 주보에 구절이 아직 없을 수 있다
check('본문 텍스트가 없어도 프롬프트가 선다',
  G.buildGuidePrompt({ service: SERVICE }).prompt.includes('본문 텍스트를 받지 못했습니다'));

// 절 줄 만들기
check('장을 건너는 범위는 장:절로 적는다',
  G.passageLines([{ chapter: 3, verse: 14, text: 'ㄱ' }, { chapter: 4, verse: 1, text: 'ㄴ' }])
    === '3:14 ㄱ\n4:1 ㄴ');
const long = Array.from({ length: 80 }, (_, i) => ({ chapter: 119, verse: i + 1, text: '주의 말씀' }));
const cutLines = G.passageLines(long).split('\n');
check('본문이 길면 60절에서 자르고 그렇다고 적는다',
  cutLines.length === G.VERSE_LIMIT + 1 && cutLines.at(-1).includes('60절만'),
  `${cutLines.length}줄 / ${cutLines.at(-1)}`);

// ── 2) 모델의 답 읽기 ───────────────────────────────────────────────────────
check('코드펜스로 감싼 JSON을 읽는다',
  G.parseGuide('```json\n' + json(GUIDE) + '\n```')?.passage.ref === '요한복음 8:12-20');
check('앞뒤 잡문이 있어도 읽는다',
  G.parseGuide(`알겠습니다. 아래와 같이 만들었습니다.\n${json(GUIDE)}\n도움이 되었길 바랍니다.`)?.points.length === 3);
check('JSON이 아니면 null', G.parseGuide('가이드를 만들었습니다.') === null);
check('빈 답은 null', G.parseGuide('') === null && G.parseGuide(null) === null);
check('AI 안내 문구는 null (§6-43)',
  G.parseGuide('AI 기능은 로그인 후 사용할 수 있어요.') === null);
check('summary가 없으면 null', G.parseGuide(json({ ...GUIDE, summary: '' })) === null);
check('points가 배열이 아니면 null', G.parseGuide(json({ ...GUIDE, points: '셋' })) === null);
check('passage.ref가 없으면 null', G.parseGuide(json({ ...GUIDE, passage: {} })) === null);
check('questions에 문자열이 아닌 것이 섞이면 null',
  G.parseGuide(json({ ...GUIDE, questions: ['ㄱ', 3, 'ㄴ'] })) === null);
check('빈 객체(0039의 기본값)는 가이드가 아니다', G.isGuideShape({}) === false);
// summaryRef는 **선택 필드**다 — 이 필드가 없는 지난 가이드도, C가 심는 게스트 시드도
// 그대로 열려야 한다. 있으면 문자열이어야 한다.
const { summaryRef: _drop, ...NO_REF } = GUIDE;
check('summaryRef가 없어도 가이드로 읽힌다',
  G.isGuideShape(NO_REF) === true && G.parseGuide(json(NO_REF))?.summaryRef === '',
  JSON.stringify(G.parseGuide(json(NO_REF))?.summaryRef));
check('summaryRef가 문자열이 아니면 가이드가 아니다',
  G.isGuideShape({ ...GUIDE, summaryRef: 8 }) === false);
check('summaryRef를 읽어 들인다',
  G.parseGuide(json(GUIDE))?.summaryRef === '요한복음 8:1~11');
check('summaryRef도 상한에 맞춰 잘린다',
  G.fitGuide({ ...GUIDE, summaryRef: '가'.repeat(60) }).summaryRef.length <= G.LIMITS.summaryRef,
  String(G.fitGuide({ ...GUIDE, summaryRef: '가'.repeat(60) }).summaryRef.length));

// ── 3) 글자수 — 문장 경계에서 자른다 ───────────────────────────────────────
const SENT = '예수님은 세상의 빛이라고 말씀하셨습니다. ';
const over = SENT.repeat(30);            // 상한을 훨씬 넘는 글
const fitted = G.fitText(over, G.LIMITS.summary);
check('상한을 넘는 글은 상한 안으로 들어온다',
  fitted.length <= G.LIMITS.summary, `${fitted.length}자`);
check('자른 자리가 문장 끝이다',
  fitted.endsWith('다.'), `…${fitted.slice(-14)}`);
check('너무 이르게 자르지 않는다(마지막 문장 하나만 버린다)',
  fitted.length > G.LIMITS.summary - SENT.length - 2, `${fitted.length}자`);
check('상한 안의 글은 그대로 둔다', G.fitText('짧은 글입니다.', 80) === '짧은 글입니다.');
// 문장 부호가 하나도 없으면 마지막 공백에서 자른다 — 단어 중간에서 끊지 않는다
const noDot = '가나다 '.repeat(40);
const spaceCut = G.fitText(noDot, 80);
check('문장 부호가 없으면 낱말 사이에서 자른다',
  spaceCut.length <= 80 && noDot.startsWith(spaceCut) && noDot[spaceCut.length] === ' ',
  `${spaceCut.length}자 / 다음 글자 '${noDot[spaceCut.length]}'`);
// 물음표·느낌표도 문장 끝이다(나눔 질문)
check('물음표도 문장 끝으로 본다',
  G.fitText('첫 질문인가요? 둘째 질문은 이렇게 길게 이어지는 문장입니다.', 20).endsWith('?'));
// 굵게 마커 한가운데서 잘리면 짝 없는 마커를 뗀다
check('짝 없는 굵게 마커는 떼어 낸다',
  !G.fitText(`${SENT.repeat(3)}**아주 긴 강조 구절이 여기서 잘립니다`, 90).includes('**'),
  G.fitText(`${SENT.repeat(3)}**아주 긴 강조 구절이 여기서 잘립니다`, 90));

// 배열은 언제나 셋
const short = G.fitGuide({ ...GUIDE, points: [GUIDE.points[0]], questions: ['하나'] });
check('점이 모자라면 빈 칸으로 셋을 채운다',
  short.points.length === 3 && short.points[2].title === '' && short.points[2].body === '');
check('질문이 모자라면 빈 칸으로 셋을 채운다',
  short.questions.length === 3 && short.questions[1] === '' && short.questions[2] === '');
const many = G.fitGuide({ ...GUIDE, points: [...GUIDE.points, { title: '넷', body: '넷' }], questions: [...GUIDE.questions, '넷'] });
check('넷째부터는 버린다',
  many.points.length === 3 && many.questions.length === 3
  && !many.points.some(p => p.title === '넷') && !many.questions.includes('넷'));
check('모양이 아닌 값을 넣어도 빈 가이드가 나온다(화면이 깨지지 않는다)',
  json(G.fitGuide(null)) === json(G.fitGuide('가이드'))
  && G.fitGuide(null).summaryRef === '', json(G.fitGuide(null)));
const capped = G.parseGuide(json({ ...GUIDE, summary: over, points: GUIDE.points.map(p => ({ ...p, body: over })) }));
check('읽어 들일 때 상한이 걸린다',
  capped.summary.length <= G.LIMITS.summary && capped.points.every(p => p.body.length <= G.LIMITS.pointBody),
  `${capped.summary.length} / ${capped.points.map(p => p.body.length).join(',')}`);

// ── 4) 굵게 마커 파서 ───────────────────────────────────────────────────────
check('**…**를 굵은 조각으로 가른다',
  json(G.splitBold('예수님은 **세상의 빛**입니다'))
  === json([{ bold: false, text: '예수님은 ' }, { bold: true, text: '세상의 빛' }, { bold: false, text: '입니다' }]),
  json(G.splitBold('예수님은 **세상의 빛**입니다')));
check('마커가 없으면 한 조각',
  json(G.splitBold('그냥 글입니다')) === json([{ bold: false, text: '그냥 글입니다' }]));
check('마커가 여럿이면 여럿으로 가른다', G.splitBold('**ㄱ**와 **ㄴ**').filter(p => p.bold).length === 2);
check('짝이 안 맞는 마커는 글자로 남는다',
  json(G.splitBold('**열었지만 안 닫음')) === json([{ bold: false, text: '**열었지만 안 닫음' }]));
check('빈 글은 빈 목록', json(G.splitBold('')) === json([]) && json(G.splitBold(null)) === json([]));

// ── 5) 템플릿 머리의 날짜 ───────────────────────────────────────────────────
check("날짜는 'YY년 M월 D일'", G.guideDateLabel('2026-03-01') === '26년 3월 1일', G.guideDateLabel('2026-03-01'));
check('한 자리 월·일에 0을 붙이지 않는다', G.guideDateLabel('2026-12-25') === '26년 12월 25일');
check('날짜가 없으면 빈 글', G.guideDateLabel('') === '' && G.guideDateLabel(null) === '');

// ── 6) 한 판 돌리기 (가짜 모델 · 가짜 본문) ─────────────────────────────────
globalThis.__PASSAGE = { verses: VERSES };
globalThis.__AI = '```json\n' + json({ ...GUIDE, passage: { ref: '요한복음 9:1-2', title: '틀린 구절' } }) + '\n```';
const made = await G.generateGuide(SERVICE);
check('한 판 돌리면 본문이 나온다', made?.points.length === 3 && made.questions.length === 3);
check('본문 구절은 주보가 진실이다(모델이 틀려도 주보 값으로)',
  made.passage.ref === '요한복음 8:12-20', made?.passage.ref);
check('본문 텍스트가 프롬프트에 실려 모델에 간다',
  globalThis.__CALL.p.includes('12 예수께서'), '(callGemini에 간 프롬프트)');
globalThis.__AI = 'AI 기능은 로그인 후 사용할 수 있어요.';
check('게스트·로그인 없음이면 null (화면이 토스트를 띄운다)', (await G.generateGuide(SERVICE)) === null);
globalThis.__AI = '{ "summary": "모양이 아닙니다" }';
check('모양이 깨진 답도 null', (await G.generateGuide(SERVICE)) === null);
check('주보가 없으면 부르지도 않는다', (await G.generateGuide(null)) === null);

// 게스트 저장 — 키 하나에 sun_guides 표를 둔다(people.guestStore와 같은 방식)
globalThis.__ROWS = [];
await G.saveGuide('svc-1', GUIDE);
const [table, rows] = globalThis.__SET;
check("게스트 저장은 'sun_guides' 표에 service_id로 한 행",
  table === 'sun_guides' && rows.length === 1 && rows[0].service_id === 'svc-1' && !!rows[0].updated_at,
  json(globalThis.__SET));
check('게스트 저장도 상한을 맞춘 본문을 넣는다', rows[0].body.points.length === 3);
globalThis.__ROWS = rows;
check('게스트에서 저장한 것을 다시 읽는다', (await G.loadGuide('svc-1'))?.passage.title === '세상의 빛으로 오신 예수님');
check('없는 주보를 읽으면 null', (await G.loadGuide('svc-9')) === null);

if (fails) { console.log(`\n${fails}개 실패`); process.exit(1); }
console.log('\n순모임 가이드 로직 이상 없음');
