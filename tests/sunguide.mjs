// 순모임 가이드의 순수 로직 검사 — 서버 불필요(네트워크 0).
// 실행: node tests/sunguide.mjs
//
// 무엇을 보나: 프롬프트에 주보와 **본문 텍스트**가 실리는지 · 모델의 답을 읽는지
// (코드펜스·잡문·잘못된 모양) · 글자수 상한을 문장 경계에서 맞추는지 · 굵게 마커를
// 가르는지 · 고를 수 있는 주보 목록(guideServices) · 게스트 저장 자리의 고정 깃발(0055).
// 화면(내 순 탭에서 종이가 보이는지)은 tests/groups.mjs가 본다.
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
    'const guestStore = () => ({ all: () => ({}), rows: () => globalThis.__ROWS || [], set: (t, l) => { globalThis.__SET = [t, l]; globalThis.__ROWS = l; } });')
  .replace(/import \{ AiService, isFallbackText \} from '\.\/ai\.js';/,
    `const AiService = { callGemini: async (p, s) => { globalThis.__CALL = { p, s }; return globalThis.__AI ?? ''; } };
const isFallbackText = (t) => t === 'AI 기능은 로그인 후 사용할 수 있어요.';`)
  .replace(/import \{ loadPassage \} from '\.\/bible\.js';/,
    'const loadPassage = async () => globalThis.__PASSAGE ?? null;')
  .replace(/import \{ kindLabel, formatServiceDate, SUNDAY_KIND \} from '\.\/worship\.js';/,
    `const SUNDAY_KIND = 'sunday';
const kindLabel = (k) => (k === 'sunday' ? '주일 4부 젊은이 예배' : (k || '예배'));
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
// 2026-09-08 템플릿 — 줄글 요약이 없고 질문이 넷이며 마지막에 예시 한 줄이 붙는다.
const GUIDE = {
  passage: { ref: '요한복음 8:12-20', title: '세상의 빛으로 오신 예수님' },
  points: [
    { title: '생명의 빛', body: '예수님은 **나는 세상의 빛이니**라고 말씀하셨습니다.' },
    { title: '육체의 시선 VS 하나님의 증언', body: '바리새인들은 눈에 보이는 것으로 판단했습니다.' },
    { title: '하나님을 아는 유일한 통로', body: '예수님을 아는 것이 아버지를 아는 길입니다.' },
  ],
  questions: [
    '지난 한 주 어떻게 지내셨나요',
    '빛으로 걷는다는 것은 무엇일까요',
    '어디에 시선을 두고 있나요',
    '이번 한 주 어디에 빛을 비춰 볼까요',
  ],
  questionNote: '고단한 한 주를 보낸 순원이 있다면 다같이 카페에 가서 달달한 것 먹기',
};
// 지난 가이드 — 줄글 요약 두 칸을 들고 있고 질문이 셋뿐이다. **그대로 열려야 한다.**
const OLD_GUIDE = {
  passage: { ref: '요한복음 8:12-20', title: '세상의 빛' },
  summaryRef: '요한복음 8:1~11',
  summary: '예수님은 성전에서 사람들을 가르치셨습니다. 바리새인들은 예수님을 시험하려 했습니다.',
  points: GUIDE.points,
  questions: GUIDE.questions.slice(0, 3),
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
  prompt.includes('JSON') && prompt.includes('"points"') && prompt.includes('"questions"'));
check('프롬프트가 글자수 상한을 숫자로 말한다',
  prompt.includes(String(G.LIMITS.pointTitle)) && prompt.includes(String(G.LIMITS.pointBody))
  && prompt.includes(String(G.LIMITS.question)));
check('프롬프트가 번호·Q.를 붙이지 말라고 말한다', prompt.includes('"Q."를 붙이지 마라'));
// 2026-09-08 템플릿에는 줄글 요약 단락이 없다 — '말씀 요약'은 소제목 셋이 전부다.
// 물어 두면 모델이 쓰고, 쓴 글은 종이에 자리가 없어 버려진다.
check('프롬프트가 줄글 요약을 더 이상 묻지 않는다',
  !prompt.includes('"summary"') && !prompt.includes('"summaryRef"')
  && prompt.includes("이 셋이 '말씀 요약'의 전부다"));
// 설교 제목도 묻지 않는다(사용자 지시 2026-09-09 — "'본문 한 마디'가 아니라 설교 제목으로").
// 물어 두면 모델이 지은 말이 주보 제목을 밀어낸다 — 그 칸은 generateGuide가 주보로 채운다.
check('프롬프트가 본문을 한 마디로 지어 달라고 하지 않는다',
  !prompt.includes('본문을 한 마디로')
  && prompt.includes('"passage": { "ref": "본문 구절을 그대로" },'),
  (prompt.match(/"passage".*/) || [])[0]);
// 질문은 넷이고 **첫 질문은 지난 한 주 일상**이다(템플릿의 첫 줄이 늘 그 질문이다)
check('프롬프트가 질문 넷을 시키고 첫 질문은 지난 한 주 일상이다',
  prompt.includes(`questions는 반드시 ${G.QUESTIONS_MAX}개`)
  && prompt.includes('첫 질문은 본문 이야기가 아니라 지난 한 주 일상'),
  String(G.QUESTIONS_MAX));
check('프롬프트가 질문 칸을 넷 그려 준다',
  (prompt.match(/자 이내\)",?\n/g) || []).length >= 4
  && prompt.includes(`"questionNote"`));
check("프롬프트가 예시 줄에 'EX.'와 괄호를 붙이지 말라고 말한다",
  prompt.includes('"EX."나 괄호를 붙이지 마라') && prompt.includes(String(G.LIMITS.questionNote)));
check('시스템 프롬프트가 §8 문구 톤을 싣는다',
  system.includes('견주는') && system.includes('핵심') && system.includes('지어내지 마라'), system.slice(0, 120));
check('시스템 프롬프트가 코드펜스를 금지한다', system.includes('코드펜스'));
check('시스템 프롬프트가 엠 대시를 금지한다', system.includes('엠 대시'));
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
check('points가 배열이 아니면 null', G.parseGuide(json({ ...GUIDE, points: '셋' })) === null);
check('passage.ref가 없으면 null', G.parseGuide(json({ ...GUIDE, passage: {} })) === null);
check('questions에 문자열이 아닌 것이 섞이면 null',
  G.parseGuide(json({ ...GUIDE, questions: ['ㄱ', 3, 'ㄴ'] })) === null);
check('빈 객체(0039의 기본값)는 가이드가 아니다', G.isGuideShape({}) === false);
check('줄글 하나만 온 답도 가이드가 아니다',
  G.parseGuide('{ "summary": "모양이 아닙니다" }') === null);

// 줄글 요약 두 칸은 **선택 필드**다(2026-09-08 템플릿에는 없다) — 새 가이드도, 그 칸을
// 들고 있는 지난 가이드도 같이 열려야 한다.
check('줄글 요약이 없어도 가이드로 읽힌다',
  G.isGuideShape(GUIDE) === true && G.parseGuide(json(GUIDE))?.summary === '',
  json(G.parseGuide(json(GUIDE))?.summary));
check('줄글 요약을 들고 있는 지난 가이드도 그대로 열린다',
  G.isGuideShape(OLD_GUIDE) === true
  && G.parseGuide(json(OLD_GUIDE))?.summaryRef === '요한복음 8:1~11'
  && G.parseGuide(json(OLD_GUIDE))?.summary.startsWith('예수님은 성전에서'));
check('summaryRef가 문자열이 아니면 가이드가 아니다',
  G.isGuideShape({ ...OLD_GUIDE, summaryRef: 8 }) === false);
// 제목은 이제 주보에서 오지만, **지난 가이드가 들고 있는 말은 그대로 남는다**
// (마이그레이션 없음 — 사용자 결정 2026-09-09).
check('지난 가이드의 제목은 그대로 남는다',
  G.fitGuide(OLD_GUIDE).passage.title === '세상의 빛', G.fitGuide(OLD_GUIDE).passage.title);
check('summaryRef도 상한에 맞춰 잘린다',
  G.fitGuide({ ...OLD_GUIDE, summaryRef: '가'.repeat(60) }).summaryRef.length <= G.LIMITS.summaryRef,
  String(G.fitGuide({ ...OLD_GUIDE, summaryRef: '가'.repeat(60) }).summaryRef.length));

// 예시 줄(questionNote) — 선택이고 상한이 있다. 괄호·'EX.'는 화면이 붙이므로 값에는 없다.
check('예시 줄을 읽어 들인다',
  G.parseGuide(json(GUIDE))?.questionNote.startsWith('고단한 한 주를'),
  G.parseGuide(json(GUIDE))?.questionNote);
check('예시 줄이 없어도 가이드로 읽힌다',
  G.isGuideShape({ ...GUIDE, questionNote: undefined }) === true
  && G.fitGuide({ ...GUIDE, questionNote: undefined }).questionNote === '');
check('예시 줄이 문자열이 아니면 가이드가 아니다',
  G.isGuideShape({ ...GUIDE, questionNote: ['ㄱ'] }) === false);
check('예시 줄도 상한에 맞춰 잘린다',
  G.fitGuide({ ...GUIDE, questionNote: '가'.repeat(200) }).questionNote.length <= G.LIMITS.questionNote,
  String(G.fitGuide({ ...GUIDE, questionNote: '가'.repeat(200) }).questionNote.length));

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

// points는 언제나 셋, questions는 셋~넷
const short = G.fitGuide({ ...GUIDE, points: [GUIDE.points[0]], questions: ['하나'] });
check('점이 모자라면 빈 칸으로 셋을 채운다',
  short.points.length === G.POINTS && short.points[2].title === '' && short.points[2].body === '');
check('질문이 모자라면 빈 칸으로 셋을 채운다',
  short.questions.length === G.QUESTIONS_MIN && short.questions[1] === '' && short.questions[2] === '');
check('질문 넷은 넷 그대로 남는다',
  G.fitGuide(GUIDE).questions.length === 4
  && G.fitGuide(GUIDE).questions[3] === '이번 한 주 어디에 빛을 비춰 볼까요',
  json(G.fitGuide(GUIDE).questions));
check('질문 셋뿐인 지난 가이드도 셋 그대로다',
  G.fitGuide(OLD_GUIDE).questions.length === 3, json(G.fitGuide(OLD_GUIDE).questions));
const many = G.fitGuide({
  ...GUIDE,
  points: [...GUIDE.points, { title: '넷', body: '넷' }],
  questions: [...GUIDE.questions, '다섯'],
});
check('점은 넷째부터, 질문은 다섯째부터 버린다',
  many.points.length === 3 && many.questions.length === G.QUESTIONS_MAX
  && !many.points.some(p => p.title === '넷') && !many.questions.includes('다섯'),
  `${many.points.length} / ${many.questions.length}`);
check('모양이 아닌 값을 넣어도 빈 가이드가 나온다(화면이 깨지지 않는다)',
  json(G.fitGuide(null)) === json(G.fitGuide('가이드'))
  && G.fitGuide(null).summaryRef === '' && G.fitGuide(null).questionNote === '',
  json(G.fitGuide(null)));
const capped = G.parseGuide(json({ ...GUIDE, points: GUIDE.points.map(p => ({ ...p, body: over })) }));
check('읽어 들일 때 상한이 걸린다',
  capped.points.every(p => p.body.length <= G.LIMITS.pointBody),
  capped.points.map(p => p.body.length).join(','));

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

// ── 6) 어떤 주보로 만들 것인가 (사용자 스펙 2026-09-08) ─────────────────────
// 고를 수 있는 것은 **발행된 주일 예배**다. 앞으로 올 주일도 넣는다(예배 전에 준비한다).
const SVCS = [
  { id: 'a', kind: 'sunday', service_date: '2026-03-08', status: 'published', title: '앞으로 올 주일' },
  { id: 'b', kind: 'sunday', service_date: '2026-03-01', status: 'published', title: '세상의 빛' },
  { id: 'c', kind: 'sunday', service_date: '2026-02-22', status: 'draft', title: '작성 중' },
  { id: 'd', kind: '금요 열정 예배', service_date: '2026-02-27', status: 'published', title: '깨어 기도하라' },
  { id: 'e', kind: 'sunday', service_date: '2026-02-15', status: 'published', title: '' },
];
const picks = G.guideServices(SVCS);
check('고를 수 있는 것은 발행된 주일 예배뿐이다',
  json(picks.map(s => s.id)) === json(['a', 'b', 'e']), json(picks.map(s => s.id)));
check('최근순이고 앞으로 올 주일도 들어온다', picks[0].id === 'a', picks[0]?.id);
const manySvcs = Array.from({ length: 14 }, (_, i) => ({
  id: `s${i}`, kind: 'sunday', status: 'published',
  service_date: `2026-01-${String(i + 1).padStart(2, '0')}`, title: '',
}));
check('여덟 건에서 끊는다', G.guideServices(manySvcs).length === G.GUIDE_SERVICE_LIMIT,
  String(G.guideServices(manySvcs).length));
// 고정된 가이드의 주보는 여덟 건 밖으로 밀려나도 **목록에 남는다** — 기본으로 여는
// 한 벌이 정작 고를 수 없는 자리에 있으면 안 된다.
const kept = G.guideServices(manySvcs, 's0');
check('고정된 주보는 여덟 건 밖이어도 목록에 남는다',
  kept.length === G.GUIDE_SERVICE_LIMIT + 1 && kept.at(-1).id === 's0',
  json(kept.map(s => s.id)));
check('고정된 주보가 이미 목록 안이면 두 번 넣지 않는다',
  G.guideServices(manySvcs, 's13').length === G.GUIDE_SERVICE_LIMIT,
  json(G.guideServices(manySvcs, 's13').map(s => s.id)));
check('고르는 줄은 날짜와 설교 제목이다',
  G.guideServiceLabel(SVCS[1]) === '2026-03-01 · 세상의 빛', G.guideServiceLabel(SVCS[1]));
check('설교 제목이 없으면 날짜만', G.guideServiceLabel(SVCS[4]) === '2026-02-15',
  G.guideServiceLabel(SVCS[4]));
// 고르는 목록은 날짜와 제목을 따로 세운다(왼쪽 날짜 · 그 옆 제목) — 날짜만 주는 한 벌
check('날짜만 주는 한 벌도 있다(고르는 줄의 왼쪽 칸)',
  G.guideServiceDate(SVCS[1]) === '2026-03-01' && G.guideServiceDate(null) === '',
  G.guideServiceDate(SVCS[1]));

// ── 7) 한 판 돌리기 (가짜 모델 · 가짜 본문) ─────────────────────────────────
globalThis.__PASSAGE = { verses: VERSES };
globalThis.__AI = '```json\n' + json({ ...GUIDE, passage: { ref: '요한복음 9:1-2', title: '틀린 구절' } }) + '\n```';
const made = await G.generateGuide(SERVICE);
check('한 판 돌리면 본문이 나온다', made?.points.length === 3 && made.questions.length === 4,
  `${made?.points.length} / ${made?.questions.length}`);
check('본문 구절은 주보가 진실이다(모델이 틀려도 주보 값으로)',
  made.passage.ref === '요한복음 8:12-20', made?.passage.ref);
// 설교 제목도 그렇다(2026-09-09) — 모델이 무엇을 적어 보내든 주보의 제목이 들어간다.
// 종이의 '주일 본문' 줄이 `<구절> [<설교 제목>]`이고 순장이 그걸 읽어 준다.
check('설교 제목은 주보가 진실이다(모델이 지은 말을 쓰지 않는다)',
  made.passage.title === '세상의 빛으로 오신 예수님', made?.passage.title);
// 주보에 제목이 아직 없으면 빈 글이다 — 화면은 빈 글이면 대괄호째 그리지 않는다
globalThis.__AI = '```json\n' + json(GUIDE) + '\n```';
const noTitle = await G.generateGuide({ ...SERVICE, title: '' });
check('주보에 설교 제목이 없으면 빈 글이다(화면이 대괄호를 안 그린다)',
  noTitle?.passage.title === '', json(noTitle?.passage));
check('본문 텍스트가 프롬프트에 실려 모델에 간다',
  globalThis.__CALL.p.includes('12 예수께서'), '(callGemini에 간 프롬프트)');
globalThis.__AI = 'AI 기능은 로그인 후 사용할 수 있어요.';
check('게스트·로그인 없음이면 null (화면이 토스트를 띄운다)', (await G.generateGuide(SERVICE)) === null);
globalThis.__AI = '{ "summary": "모양이 아닙니다" }';
check('모양이 깨진 답도 null', (await G.generateGuide(SERVICE)) === null);
check('주보가 없으면 부르지도 않는다', (await G.generateGuide(null)) === null);

// ── 8) 게스트 저장 자리 — 고정 깃발까지 (0055) ──────────────────────────────
// 키 하나에 sun_guides 표를 둔다(people.guestStore와 같은 방식).
globalThis.__ROWS = [];
await G.saveGuide('svc-1', GUIDE);
const [table, rows] = globalThis.__SET;
check("게스트 저장은 'sun_guides' 표에 service_id로 한 행",
  table === 'sun_guides' && rows.length === 1 && rows[0].service_id === 'svc-1' && !!rows[0].updated_at,
  json(globalThis.__SET));
check('게스트 저장도 상한을 맞춘 본문을 넣는다', rows[0].body.points.length === 3);
const loaded = await G.loadGuide('svc-1');
check('읽기는 한 벌과 고정 여부를 같이 준다',
  loaded?.body?.passage.title === '세상의 빛으로 오신 예수님' && loaded.pinned === false,
  json({ title: loaded?.body?.passage.title, pinned: loaded?.pinned }));
check('없는 주보를 읽으면 null', (await G.loadGuide('svc-9')) === null);
check('아직 고정된 것이 없으면 null', (await G.pinnedGuideId()) === null);

// 어느 주보에 이미 가이드가 있나 — 고르는 줄의 '가이드 있음' 꼬리표 몫이다(2026-09-09).
// 0039의 기본값 `{}`가 든 행은 **가이드가 아니다**(loadGuide도 그 행을 null로 준다) —
// 모양까지 보지 않으면 꼬리표만 붙고 눌러 보면 빈 자리가 나온다.
globalThis.__ROWS = [...globalThis.__ROWS, { service_id: 'svc-8', body: {} }];
check("'가이드 있음'은 모양을 갖춘 행만 센다",
  json(await G.guidedServiceIds(['svc-1', 'svc-8', 'svc-none'])) === json(['svc-1']),
  json(await G.guidedServiceIds(['svc-1', 'svc-8', 'svc-none'])));
check('물어본 주보가 없으면 빈 목록이고 조회도 안 한다',
  json(await G.guidedServiceIds([])) === json([]) && json(await G.guidedServiceIds()) === json([]));

await G.saveGuide('svc-2', GUIDE);
await G.pinGuide('svc-1', true);
check('고정하면 그 주보가 고정된 주보다',
  (await G.pinnedGuideId()) === 'svc-1' && (await G.loadGuide('svc-1')).pinned === true,
  await G.pinnedGuideId());
await G.pinGuide('svc-2', true);
check('고정은 한 번에 하나다(앞엣것이 풀린다)',
  (await G.pinnedGuideId()) === 'svc-2' && (await G.loadGuide('svc-1')).pinned === false,
  json((globalThis.__ROWS || []).map(r => [r.service_id, !!r.pinned])));
// 저장은 body만 갈아 끼운다 — 마스터가 고정해 둔 행을 저장 한 번으로 풀면 안 된다
await G.saveGuide('svc-2', { ...GUIDE, passage: { ref: '요한복음 8:12-20', title: '고쳐 쓴 제목' } });
check('저장해도 고정은 그대로다',
  (await G.pinnedGuideId()) === 'svc-2'
  && (await G.loadGuide('svc-2')).body.passage.title === '고쳐 쓴 제목',
  json((globalThis.__ROWS || []).map(r => [r.service_id, !!r.pinned])));
await G.pinGuide('svc-2', false);
check('고정을 풀면 아무것도 고정되지 않는다', (await G.pinnedGuideId()) === null);

if (fails) { console.log(`\n${fails}개 실패`); process.exit(1); }
console.log('\n순모임 가이드 로직 이상 없음');
