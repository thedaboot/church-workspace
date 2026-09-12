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
// 2026-09-13 사용자 결정에서 바뀐 것:
//   · 나눔이 **사람 칩 한 줄 + 종이 하나**가 됐다 — 사람마다 줄로 쌓고 도막을 라벨|글
//     두 칸으로 접던 요약(NoteDigest)은 통째로 없어졌다. 칩을 누르면 그 사람의 묵상
//     종이가 '내 묵상' 칸의 읽기 종이와 **같은 부품·같은 폭**으로 선다(9)
//   · '나만 보기' 잠금 표시는 줄이 아니라 **내 칩**에 붙는다
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
  // 0061부터 myUid도 같이 가져온다 — 노드에서는 둘 다 세운다
  .replace(/import \{ supabase, myUid \} from '\.\/supabaseClient\.js';/,
    'export const supabase = null; const myUid = async () => null;');
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
// 잔디의 이전·다음 달(2026-09-07). 1일로 맞춰 돌려주지 않으면 31일에서 한 달을 건너뛴다
check('달 이동은 해를 넘고 1일로 맞춘다',
  word.shiftMonth('2026-01-31', -1) === '2025-12-01'
  && word.shiftMonth('2026-12-15', 1) === '2027-01-01'
  && word.shiftMonth('2026-03-31', -1) === '2026-02-01'
  && word.shiftMonth('2026-09-07', 0) === '2026-09-01',
  [word.shiftMonth('2026-01-31', -1), word.shiftMonth('2026-12-15', 1), word.shiftMonth('2026-03-31', -1)].join(' / '));
check('장 열쇠는 그대로 되읽힌다', JSON.stringify(word.parseChapterKey(word.chapterKey('gen', 3)))
  === JSON.stringify({ bookId: 'gen', chapter: 3 }), word.chapterKey('gen', 3));
// 형광펜은 절까지 적는다 — 장 열쇠 파서가 절 열쇠를 먹으면 'gen 1'과 'gen 1:3'이 섞인다
check('절 열쇠는 장 열쇠와 갈린다',
  JSON.stringify(word.parseVerseKey(word.verseKey('gen', 1, 3))) === JSON.stringify({ bookId: 'gen', chapter: 1, verse: 3 })
  && word.parseChapterKey('gen 1:3') === null, word.verseKey('gen', 1, 3));
// 붙여넣기 도구는 사라졌다 — 읽기표 730일은 0038 마이그레이션이 넣는다
check('본문표 파서·저장 함수가 남아 있지 않다',
  !word.parseQtTable && !word.saveSchedule && !word.dedupeByDate);

// ── 1-b. 노트 템플릿 (순수 — services/noteTemplate.js) ──────────────────────
// 예배 노트·QT 묵상은 빈 칸이 아니라 도막 제목으로 시작한다(사용자 요청 2026-09-08 —
// "기존 순 노트 템플릿 가져와서 최대한 우리 디자인 시스템에 맞춰 재구성하기").
// 도막 이름은 2026-09-10에 사용자가 다시 정했다 — '나의 묵상'을 빼고 '결단'을
// '나의 결단'으로. 그리고 2026-09-12에 **'본문'도 뺐다**(예배 노트 셋 · QT 둘) —
// 종이 머리(paper.jsx PaperNoteHead)에 구절이 이미 서기 때문이다.
// **되돌리기**: isTemplateOnly가 늘 false를 돌려주게 만들면 아래 둘이 깨진다 — 그러면
// 아무도 쓰지 않은 제목 줄이 노트로 저장되고 나눔 피드·잔디에까지 오른다.
const tplMod = await import(new URL('src/services/noteTemplate.js', ROOT).href);
const wTpl = tplMod.worshipNoteTemplate();
const qTpl = tplMod.qtNoteTemplate();
check('예배 노트 템플릿은 세 도막이다',
  JSON.stringify(wTpl.match(/^### .*/gm) || []) === JSON.stringify(['### 말씀 요약', '### 나의 결단', '### 기도']),
  JSON.stringify(wTpl));
// QT는 혼자 본문을 읽는 자리라 '말씀 요약'이 없다(설교 요약과 묵상이 같은 글이 된다)
check('QT 템플릿은 두 도막(말씀 요약이 없다)',
  JSON.stringify(qTpl.match(/^### .*/gm) || []) === JSON.stringify(['### 나의 결단', '### 기도']),
  JSON.stringify(qTpl.match(/^### .*/gm) || []));
// '나의 묵상'은 2026-09-10에 뺐다 — 요약과 묵상이 같은 글이 되는 자리였다
check("새 템플릿에 '나의 묵상'이 없다",
  !wTpl.includes('나의 묵상') && !qTpl.includes('나의 묵상'), JSON.stringify([wTpl, qTpl]));
// '본문'은 2026-09-12에 뺐다 — 구절은 종이 머리(PaperNoteHead)에 한 번만 선다(사용자 결정)
check("새 템플릿에 '본문' 도막이 없다",
  !wTpl.includes('### 본문') && !qTpl.includes('### 본문'), JSON.stringify([wTpl, qTpl]));
check('제목마다 그 아래 빈 줄이 하나 있다(커서가 제목 밑에 떨어진다)',
  qTpl.split('\n').length === 4 && qTpl.split('\n')[1] === '', JSON.stringify(qTpl.split('\n')));
check('손대지 않은 템플릿은 빈 노트다',
  tplMod.isTemplateOnly(wTpl) === true && tplMod.isTemplateOnly('') === true);
// 편집기를 한 바퀴 돌면 끝의 빈 줄이 정리된다(markdown.js docToMd) — 그래도 빈 노트다
check('끝의 빈 줄이 정리돼도 빈 노트다', tplMod.isTemplateOnly(qTpl.replace(/\s+$/, '')) === true);
check('한 줄이라도 쓰면 빈 노트가 아니다',
  tplMod.isTemplateOnly(qTpl + '오늘 이 말씀이 마음에 남았다') === false
  && tplMod.isTemplateOnly('그냥 한 줄') === false);
// 도막 이름이 바뀌기 전에 저장된 빈 노트 — 2026-09-09 이전('묵상 노트·결단하기·기도하기'),
// 2026-09-10 이전('나의 묵상'·'결단'), 2026-09-12 이전('본문') 셋 다.
// **되돌리기**: LEGACY_SECTIONS를 SECTION_RE에서 빼면 이 줄이 깨진다. 그러면 예전에
// 손도 안 댄 템플릿들이 하루아침에 '사람이 쓴 글'이 되어 나눔 피드·잔디에 오른다.
const oldTpl = '### 본문\n요한복음 3:16\n### 말씀 요약\n\n### 묵상 노트\n\n### 결단하기\n\n### 기도하기\n';
const oldTpl2 = '### 본문\n요한복음 3:16\n### 말씀 요약\n\n### 나의 묵상\n\n### 결단\n\n### 기도\n';
check('옛 이름으로 저장된 템플릿도 빈 노트다',
  tplMod.isTemplateOnly(oldTpl, '요한복음 3:16') === true
  && tplMod.isTemplateOnly(oldTpl2, '요한복음 3:16') === true
  && tplMod.isTemplateOnly(oldTpl + '한 줄 썼다', '요한복음 3:16') === false);
// 옛 노트의 '본문' 도막에 든 구절 줄은 **그 구절을 알 때에만** 템플릿으로 친다 —
// 모르면 사람이 쓴 한 줄로 본다(isTemplateOnly의 prefill 갈래).
check('구절 줄은 그 구절을 알 때에만 템플릿으로 친다',
  tplMod.isTemplateOnly(oldTpl2, '') === false);

// ── 1-c. 뜻으로 찾는 본문 검색 (순수 — services/bibleSearch.js) ─────────────
// 임베딩·색인을 만들지 않는다 — 모델에게 **참조만** 받고 본문은 우리 파일에서 읽는다.
// ai.js는 supabase·store를 물고 있어 aictx와 같은 방법으로 갈아 끼운다.
const aiSrcForSearch = readFileSync(new URL('src/services/ai.js', ROOT), 'utf8')
  .replace(/import \{ supabase(, myUid)? \} from '\.\/supabaseClient\.js';/,
    'export const supabase = null; const myUid = async () => null;')
  .replace(/from '\.\.\/utils\.js';/, "from '" + new URL('src/utils.js', ROOT).href + "';")
  .replace(/import \{ store \} from '\.\.\/store\/workspaceStore\.js';/,
    'export const store = { getState: () => ({ tasks: { byId: {} }, projects: { byId: {}, allIds: [] }, members: [] }) };');
const aiFile = join(tmp, 'ai.mjs');
writeFileSync(aiFile, aiSrcForSearch);
const bsSrc = readFileSync(new URL('src/services/bibleSearch.js', ROOT), 'utf8')
  .replace("from './ai.js'", "from '" + pathToFileURL(aiFile).href + "'")
  .replace("from './bibleRef.js'", "from '" + new URL('src/services/bibleRef.js', ROOT).href + "'");
const bsFile = join(tmp, 'bibleSearch.mjs');
writeFileSync(bsFile, bsSrc);
const bs = await import(pathToFileURL(bsFile).href);

const bibleBooks = JSON.parse(readFileSync(new URL('public/bible/index.json', ROOT), 'utf8'));
const fakeLoadBook = async (id) => JSON.parse(readFileSync(new URL('public/bible/' + id + '.json', ROOT), 'utf8'));

const askAi = bs.buildBibleSearchPrompt('불안할 때', bibleBooks);
check('AI 검색 프롬프트에 물음이 실린다', askAi.prompt.includes('불안할 때'), askAi.prompt.slice(0, 60));
// 책 이름을 안 실으면 모델이 제 표기를 쓰고 그때마다 parseRef가 못 읽는다
check('AI 검색 프롬프트에 우리 책 이름 목록이 실린다',
  askAi.system.includes('창세기') && askAi.system.includes('요한계시록'));
// AI가 만든 문장의 대시 금지는 ai.js의 DASH_RULE 한 벌이다(§8) — 여기서도 그 줄을 쓴다
check('AI 검색도 ai.js의 대시 규칙을 그대로 싣는다', askAi.system.includes('엠 대시'));
check('AI 검색은 JSON 배열만 받는다고 못 박는다',
  askAi.system.includes('JSON 배열') && askAi.system.includes('12'));

check('코드 울타리와 잡담이 붙어 와도 읽는다',
  JSON.stringify(bs.parseBibleSearchJson('네, 찾았어요.\n```json\n["요 3:16"]\n```\n도움이 되길!'))
  === JSON.stringify(['요 3:16']));
// **근거 문장(why)은 사용자가 뺐다**(2026-09-09 · §7). 모델이 옛 모양으로 답해도
// 참조만 건져 쓰고 why는 어디에도 남지 않아야 한다 — 잎처럼 되살아나는 것을 막는 줄이다.
check('옛 모양({ref, why})으로 와도 참조만 건진다',
  JSON.stringify(bs.parseBibleSearchJson('[{"ref":"요 3:16","why":"사랑"}]')) === JSON.stringify(['요 3:16']));
check('못 읽는 답은 빈 배열이다',
  JSON.stringify(bs.parseBibleSearchJson('그런 구절은 모르겠어요')) === '[]'
  && JSON.stringify(bs.parseBibleSearchJson('[{oops}]')) === '[]'
  && JSON.stringify(bs.parseBibleSearchJson('')) === '[]');

const aiHits = await bs.resolveBibleHits([
  '요한복음 3:16', '도마복음 1:1', '요 3:16', '빌립보서 4:6-7', '이건 참조가 아니다',
], bibleBooks, fakeLoadBook);
check('AI가 준 참조는 우리 본문으로 확인해서 그린다',
  aiHits.length === 2 && aiHits[0].name === '요한복음'
  && aiHits[0].text.includes('하나님이 세상을 이처럼 사랑하사'), JSON.stringify(aiHits.map(h => h.name)));
check('모르는 책·못 읽는 참조는 버린다', !aiHits.some(h => h.name === '도마복음'),
  JSON.stringify(aiHits.map(h => h.name)));
check('화면에 세울 줄에 근거 문장이 없다', aiHits.every(h => !('why' in h)),
  JSON.stringify(Object.keys(aiHits[0] || {})));
check('같은 절을 두 번 내면 한 줄만 남는다',
  aiHits.filter(h => h.chapter === 3 && h.verse === 16).length === 1);
check('짧은 범위는 절을 이어 붙이고 라벨에 범위가 남는다',
  aiHits[1].to === 7 && bs.hitLabel(aiHits[1]) === '빌립보서 4:6-7', JSON.stringify(aiHits[1]));
// 장 전체를 가리켜도 한 줄이 통째로 한 장이 되지 않는다(앞 세 절만)
const wholeChapter = await bs.resolveBibleHits(['시편 23편'], bibleBooks, fakeLoadBook);
check('장 전체를 가리켜도 앞 세 절만 쓴다',
  wholeChapter.length === 1 && wholeChapter[0].verse === 1 && wholeChapter[0].to === 3,
  JSON.stringify(wholeChapter[0]));
const manyHits = await bs.resolveBibleHits(
  Array.from({ length: 20 }, (_, i) => '시편 ' + (i + 1) + ':1'), bibleBooks, fakeLoadBook);
check('AI 결과는 열두 줄에서 끊는다', manyHits.length === 12, String(manyHits.length));

// ── 1-d. 검색이 책을 받는 방법 (순수 — services/bible.js) ───────────────────
// 예전에는 for 안에서 `await loadBook`을 한 권씩 기다려서 왕복이 66번 줄줄이 섰다
// (사용자 지적 2026-09-08 — "검색 속도 개선. 현재 첫 검색에서 모든 권을 다 훑고 있음").
// **되돌리기**: forEachPool의 kick(i + cap) 한 줄을 지우면 동시 수가 1로 떨어져 첫 검사가 깨진다.
const bible = await import(new URL('src/services/bible.js', ROOT).href);
const poolSeen = { now: 0, max: 0, order: [] };
await bible.forEachPool(Array.from({ length: 20 }, (_, i) => i), 6, async (n) => {
  poolSeen.now++; poolSeen.max = Math.max(poolSeen.max, poolSeen.now);
  await new Promise(r => setTimeout(r, 5 + ((n * 7) % 13)));   // 끝나는 차례를 일부러 섞는다
  poolSeen.now--;
  return n;
}, (v) => { poolSeen.order.push(v); });
check('여러 권을 동시에 받는다(한 권씩 기다리지 않는다)',
  poolSeen.max > 1 && poolSeen.max <= 6, String(poolSeen.max));
check('훑는 차례는 도착 순서가 아니라 정경 순이다',
  poolSeen.order.join() === Array.from({ length: 20 }, (_, i) => i).join(), poolSeen.order.join());
const poolStop = [];
await bible.forEachPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async n => n, (v) => { poolStop.push(v); return v < 3; });
check('결과 상한에 닿으면 거기서 멈춘다', poolStop.join() === '1,2,3', poolStop.join());
// 화면이 실제로 그 풀을 쓰는지 · 받은 책이 새로고침 뒤에도 남는지는 소스로 지킨다
const bibleSrcPure = readFileSync(new URL('src/services/bible.js', ROOT), 'utf8');
check('책 파일은 Cache Storage에 남는다(새로고침 뒤에도)',
  bibleSrcPure.includes('caches.open') && bibleSrcPure.includes('box.put'));
const wbSrcPure = readFileSync(new URL('src/components/wordBible.jsx', ROOT), 'utf8');
check('검색이 풀로 받는다(for 안에서 한 권씩 기다리지 않는다)',
  wbSrcPure.includes('forEachPool(books, POOL') && !/for \(let i = 0; i < books\.length/.test(wbSrcPure));
check('리더에 들어오면 남은 책을 미리 받아 둔다', wbSrcPure.includes('warmBooks(books)'));

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
// 읽기표(0038 시드 730일)는 **약자로 저장되어 있다**('수 4:1-14') — 화면·종이는 책 이름
// 전체로 편 값을 쓴다(사용자 요청 2026-09-11 · services/bibleRef.js fullRef).
// 그래서 여기 심는 값도 저장 자리의 모양 그대로 약자다.
const REF_FULL = '여호수아 4:1-14';
const REF_FULL_YEST = '시편 121:1-8';
const seed = {
  schedule: {
    [today]: { passage_ref: '수 4:1-14', label: '사귐의 기도' },
    [word.shiftDay(today, -1)]: { passage_ref: '시 121:1-8', label: '' },
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
  const pressed = [...document.querySelectorAll('button')]
    .filter(b => ['QT', '성경 읽기'].includes(b.textContent.trim()))
    .map(b => b.textContent.trim() + '=' + b.getAttribute('aria-pressed'));
  return { qt: t.includes('QT'), old: t.includes('매일성경'), read: t.includes('성경 읽기'), pressed };
})()`);
check('세그먼트 [QT | 성경 읽기]', seg.qt && seg.read, JSON.stringify(seg));
check("'매일성경'이라는 이름은 남아 있지 않다", seg.old === false);
// 고른 것을 색으로만 말하면 화면을 읽어 주는 기기에는 아무 표시도 안 남는다 —
// 성경 읽기의 [본문|북마크|형광펜]과 같은 한 벌로 aria-pressed를 단다
check('세그먼트가 고른 것을 aria로도 말한다',
  seg.pressed.join('|') === 'QT=true|성경 읽기=false', JSON.stringify(seg.pressed));

// 2) QT — 그날 본문 · 제목 · 절 번호
const qt = await ev(`(() => {
  const vs = [...document.querySelectorAll('p[data-verse]')];
  return {
    date: (document.body.innerText.match(/\\d+년 \\d+월 \\d+일 \\([일월화수목금토]\\)/) || [])[0] || '',
    label: [...document.querySelectorAll('h3')].map(h => h.textContent.trim()),
    verses: vs.length,
    first: vs[0] ? vs[0].textContent : '',
    ref: document.body.innerText.includes(${JSON.stringify(REF_FULL)}),
    abbr: document.body.innerText.includes('수 4:1-14'),
  };
})()`);
check('오늘 날짜(한국 시간)로 연다', qt.date === word.dayLabel(today), `${qt.date} / ${word.dayLabel(today)}`);
check('일정의 제목이 제목으로 선다', qt.label.includes('사귐의 기도'), JSON.stringify(qt.label));
check('구절이 본문으로 펼쳐진다(절 14개)', qt.verses === 14 && qt.ref, JSON.stringify(qt));
// **구절은 책 이름 전체로 적는다**(사용자 요청 2026-09-11). 읽기표에는 약자로 저장되어
// 있고(0038) 예배 노트의 구절은 이름 전체라, 같은 모양의 종이인데 묵상 쪽만 약자였다.
// **되돌리기**: wordView가 `qt.refFull` 대신 `qt.schedule.passage_ref`를 쓰게 하면 깨진다.
check('구절을 책 이름 전체로 적는다(약자가 남지 않는다)',
  qt.ref === true && qt.abbr === false, JSON.stringify({ ref: qt.ref, abbr: qt.abbr }));
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

// 4-b) 이전·다음 달 (2026-09-07) — 이번 달만 보이면 지난 기록을 볼 길이 없었다.
// 넘긴 달의 문구는 '이번 달'이 아니라 그 달 이름이고, 앞날의 기록은 있을 수 없으므로
// 이번 달에서는 '다음 달'이 잠긴다. 격자는 5주 ↔ 6주로 달라져도 높이가 그대로여야 한다.
const grassGrid = () => ev(`(() => {
  const c = [...document.querySelectorAll('button[title]')].find(b => /^\\d+월 \\d+일 \\([일월화수목금토]\\)$/.test(b.title));
  const g = c && c.parentElement;
  const prev = document.querySelector('button[aria-label="지난 달"]');
  const next = document.querySelector('button[aria-label="다음 달"]');
  const r = prev ? prev.getBoundingClientRect() : null;
  const line = (document.body.innerText.match(/[^\\n]*기록했어요/) || [''])[0];
  // 연·월은 **잔디 머리줄의 것**만 본다 — 화면 위쪽 QT 날짜도 '2026년 9월 …'이라 본문
  // 전체에서 찾으면 그쪽이 먼저 잡힌다
  return {
    h: g ? Math.round(g.getBoundingClientRect().height) : 0,
    label: prev && prev.nextElementSibling ? prev.nextElementSibling.textContent.trim() : '',
    line, prev: !!prev, next: !!next, nextOff: next ? next.disabled : null,
    today: [...document.querySelectorAll('button')].some(x => x.textContent.trim() === '오늘'),
    w: r ? Math.round(r.width) : 0, hh: r ? Math.round(r.height) : 0,
  };
})()`);
const nowGrass = await grassGrid();
check('잔디에 이전·다음 달 버튼이 있다',
  nowGrass.prev && nowGrass.next && nowGrass.w >= 32 && nowGrass.w <= 40 && nowGrass.hh >= 26 && nowGrass.hh <= 32,
  JSON.stringify(nowGrass));
check('이번 달에서는 다음 달이 잠긴다', nowGrass.nextOff === true, JSON.stringify(nowGrass));
// 이 시점의 QT 날짜는 오늘이라 날짜 줄에도 '오늘' 버튼이 없다 — 잔디 쪽도 없어야 한다
check("이번 달을 보고 있으면 '오늘' 버튼이 없다", nowGrass.today === false, JSON.stringify(nowGrass));

const prevIso = word.shiftMonth(today, -1);
const prevMonth = word.monthDays(prevIso);
check('지난 달로 넘긴다', await clickSel('button[aria-label="지난 달"]'));
await sleep(700);
const back1 = await grassGrid();
check('넘긴 달의 연·월이 머리줄에 선다', back1.label === `${prevMonth.year}년 ${prevMonth.month}월`,
  JSON.stringify(back1));
// 씨앗은 이번 달에만 심었다 — 지난 달은 0번이고, 문구는 '이번 달'이 아니라 그 달 이름이다
check("다른 달의 문구는 '이번 달'이 아니라 그 달 이름이다",
  back1.line.trim() === `${prevMonth.month}월 0번 기록했어요`, JSON.stringify(back1));
check('다른 달을 보면 다음 달이 열리고 오늘 버튼이 생긴다',
  back1.nextOff === false && back1.today === true, JSON.stringify(back1));
// 5주 달과 6주 달의 높이가 다르면 아래 문구·카드가 오르내린다
check('달을 넘겨도 격자 높이가 그대로다', back1.h === nowGrass.h && back1.h > 0,
  JSON.stringify({ now: nowGrass.h, prev: back1.h }));
// 칸을 누르면 그 날짜로 간다 — 지난 기록을 보러 가는 길이 이것 하나다
const pick15 = await ev(`(() => {
  const b = [...document.querySelectorAll('button[title]')]
    .find(x => x.title === ${JSON.stringify(word.shortDayLabel(`${prevIso.slice(0, 7)}-15`))});
  if (!b) return false; b.click(); return true;
})()`);
await sleep(1000);
check('지난 달 잔디 칸을 누르면 그 날짜로 간다', pick15 === true
  && (await ev(`(document.body.innerText.match(/\\d+년 \\d+월 \\d+일 \\([일월화수목금토]\\)/)||[''])[0]`))
     === word.dayLabel(`${prevIso.slice(0, 7)}-15`),
  word.dayLabel(`${prevIso.slice(0, 7)}-15`));
// 원래 자리로 — 잔디는 '다음 달'로, 날짜는 '오늘'로(날짜 줄의 것이 문서에서 먼저 온다)
await clickSel('button[aria-label="다음 달"]');
await sleep(500);
await clickText('오늘');
await sleep(1000);
check('잔디와 날짜가 이번 달·오늘로 돌아온다',
  (await ev(`(document.body.innerText.match(/\\d+년 \\d+월 \\d+일 \\([일월화수목금토]\\)/)||[''])[0]`)) === word.dayLabel(today)
  && (await grassGrid()).label === `${word.monthDays(today).year}년 ${word.monthDays(today).month}월`);

// 5) 본문표 붙여넣기 도구는 없다(0038 시드로 대체) — 마스터에게도 안 보인다
const noPaste = await ev(`(() => ({
  box: !!document.querySelector('textarea[aria-label="본문표"]'),
  head: document.body.innerText.includes('본문표'),
}))()`);
check('본문표 붙여넣기 도구가 화면에 없다', noPaste.box === false && noPaste.head === false,
  JSON.stringify(noPaste));

// 6-a) 쓴 상태 · 수정 상태 (2026-09-07) — 저장된 묵상이 있으면 **읽기 모드**다.
// 예전에는 편집기가 늘 열려 있어 이미 쓴 글인지 고치는 중인지 화면이 말해 주지 않았다.
// 편집기는 그래도 언마운트하지 않는다(날짜를 넘길 때 자리가 줄면 아래가 튄다) —
// 감추기만 하고, 읽기 상자가 그 자리를 같은 높이로 받는다.
await waitFor(`document.querySelector('[data-note]')`);
// 읽기 모드에서도 편집기는 붙어 있다(감춘 것뿐) — lazy 청크가 도착할 때까지 기다린다
await waitFor(`document.querySelector('.tiptap')`);
await sleep(400);
const noteState = () => ev(`(() => {
  const box = document.querySelector('[data-note]');
  const read = document.querySelector('[data-note-read]');
  const tip = document.querySelector('.tiptap');
  const txt = (l) => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === l);
  return {
    mode: box ? box.dataset.note : '',
    readShown: !!(read && read.offsetParent),
    readBody: read ? read.innerText.trim() : '',
    readH: read ? Math.round(read.getBoundingClientRect().height) : 0,
    tipShown: !!(tip && tip.offsetParent),
    tipAlive: !!tip,
    edit: txt('수정'), save: txt('저장'), cancel: txt('취소'),
    // '내 묵상' 칸 통째의 높이 — 이것이 모드마다 다르면 아래 칸들이 오르내린다.
    // 위쪽(본문 카드)은 전환 연출 중일 수 있어 절대 좌표 대신 이 높이로 잰다.
    noteH: box ? Math.round(box.getBoundingClientRect().height) : 0,
    // 지금 보이는 종이의 폭·왼쪽 자리(두 모드가 같은 종이여야 한다 — 2026-09-10)
    sheet: (() => {
      const s = [...document.querySelectorAll('.paper-sheet')].find(x => x.offsetParent);
      const col = document.querySelector('[data-col="qt"]');
      if (!s || !col) return null;
      const r = s.getBoundingClientRect(), c = col.getBoundingClientRect();
      return { w: Math.round(r.width), left: Math.round(r.left - c.left) };
    })(),
    toggle: [...document.querySelectorAll('button[aria-pressed]')]
      .filter(b => ['나만 보기', '더다붓에 공유하기'].includes(b.textContent.trim())).length,
    trash: !!document.querySelector('button[aria-label="내 묵상 지우기"]'),
  };
})()`);
const readMode = await noteState();
check('저장된 묵상은 읽기 모드로 선다',
  readMode.mode === 'read' && readMode.readShown === true && readMode.tipShown === false,
  JSON.stringify(readMode));
check('읽기 모드에 저장된 글이 그대로 그려진다',
  readMode.readBody.includes(seed.entries[today].body), JSON.stringify(readMode.readBody));
check("읽기 모드의 버튼은 '수정' 하나다(저장·취소는 없다)",
  readMode.edit === true && readMode.save === false && readMode.cancel === false, JSON.stringify(readMode));
// 공유 토글·지우기는 두 모드에서 그대로 있다 — 공유는 고치는 일이 아니다
check('읽기 모드에도 공유 토글과 지우기가 있다',
  readMode.toggle === 2 && readMode.trash === true, JSON.stringify(readMode));
// 편집기는 살아 있다(감춘 것뿐) — 언마운트하면 날짜를 넘길 때 자리가 줄어 아래가 튄다
check('읽기 모드에서도 편집기는 언마운트되지 않는다', readMode.tipAlive === true, JSON.stringify(readMode));

check("'수정'을 누른다", await clickText('수정'));
await sleep(500);
const editMode = await noteState();
check("'수정'을 누르면 편집기가 서고 저장·취소가 붙는다",
  editMode.mode === 'edit' && editMode.tipShown === true && editMode.readShown === false
  && editMode.save === true && editMode.cancel === true && editMode.edit === false,
  JSON.stringify(editMode));
check('수정으로 들어가면 커서가 묵상 칸에 있다',
  (await ev(`!!document.activeElement && !!document.activeElement.closest('.tiptap')`)) === true);
// **편집도 종이 안에서 한다**(사용자 요청 2026-09-10 — "세련되고 기쁘게 자발적으로
// 작성할 수 있는 공간으로"). 예전에는 서식 바 아래 흰 상자에 제목이 큰 여백으로 벌어진
// 문서 편집기였고, 저장하면 갑자기 다른 물건(종이)이 됐다. 지금은 두 모드가 **같은
// 부품**을 쓴다(paper.jsx `NotePaper`) — 띠·머리 구절·캐릭터 컷·밑단이 어긋날 수 없다.
// **되돌리기**: wordView의 `frame`을 떼면 띠·구절이 사라져 아래 셋이 깨진다.
const paperEdit = await ev(`(() => {
  const box = document.querySelector('.qt-note-editor');
  const sheet = box && box.querySelector('.paper-sheet');
  const mast = sheet && sheet.querySelector('.paper-mast');
  const tip = box && box.querySelector('.tiptap');
  const read = document.querySelector('[data-note-read] .paper-sheet');
  return {
    kind: mast ? mast.querySelector('.paper-mast-kind').textContent.trim() : '',
    date: mast ? mast.querySelector('.paper-mast-date').textContent.trim() : '',
    ref: sheet ? (sheet.querySelector('.paper-ref') || {}).textContent : null,
    cut: !!(sheet && sheet.querySelector('.paper-cut')),
    tail: !!(sheet && sheet.querySelector('.paper-tail')),
    // 편집기가 종이 **안**에 있다(같은 부품을 쓴다는 뜻이다)
    inside: !!(sheet && tip && sheet.contains(tip)),
    // 읽기 종이의 머리와 **같은 글자**여야 한다("이 모양으로 나간다"가 참이 되게)
    readKind: read ? read.querySelector('.paper-mast-kind').textContent.trim() : '',
    readRef: read ? (read.querySelector('.paper-ref') || {}).textContent : null,
    // 종이는 언제나 밝다(§6-32-i) — 편집 화면도 그렇다
    bg: sheet ? getComputedStyle(sheet).backgroundColor : '',
  };
})()`);
check('편집 화면도 종이다(띠·컷·밑단이 읽기와 같은 부품)',
  paperEdit.kind === '묵상 노트' && paperEdit.cut === true && paperEdit.tail === true
  && paperEdit.inside === true, JSON.stringify(paperEdit));
check('편집 화면 머리의 날짜·구절이 읽기 종이와 같다',
  /^\d{4}\. \d{2}\. \d{2}$/.test(paperEdit.date)
  && (paperEdit.ref || '').includes(REF_FULL)
  && paperEdit.kind === paperEdit.readKind && paperEdit.ref === paperEdit.readRef,
  JSON.stringify(paperEdit));
check('종이는 편집 중에도 밝다(다크를 따라가지 않는다)',
  paperEdit.bg === 'rgb(255, 253, 252)', paperEdit.bg);
// 2026-09-07에는 두 모드의 **높이**를 1px까지 묶어 두었다 — 그때 편집 상자가 고정
// 높이(min-h-40 md:min-h-56)였기 때문이다. 2026-09-10부터 편집 화면이 **종이**가
// 되면서 그 묶음이 풀렸다: 편집 종이에는 서식 바와 쓸 빈 자리가 더 있고, 읽기 종이는
// 저장된 글만큼만 길다. 지금 지키는 것은 **종이의 폭과 왼쪽 자리**다 — 그 둘이 같아야
// 수정·취소를 눌렀을 때 종이가 옆으로 흔들리지 않는다.
// 남은 높이 차이는 HANDOFF §2에 적어 두었다(사용자 판단 대기).
// **되돌리기**: 두 모드 중 한쪽의 max-w를 바꾸면 이 줄이 깨진다.
check('모드를 바꿔도 종이의 폭과 왼쪽 자리가 그대로다',
  !!readMode.sheet && !!editMode.sheet
  // 560은 종이 폭 상한이고, 테두리 1px씩을 뺀 558이 종이 자신의 폭이다
  && readMode.sheet.w === editMode.sheet.w && Math.abs(readMode.sheet.w - 560) <= 2
  && Math.abs(readMode.sheet.left - editMode.sheet.left) <= 1,
  JSON.stringify({ read: readMode.sheet, edit: editMode.sheet,
    높이: { read: readMode.noteH, edit: editMode.noteH } }));
// 취소는 고치던 글을 버리고 저장된 글로 되돌린다
await ev(`(() => { const el = document.querySelector('.tiptap'); el && el.focus(); })()`);
await send('Input.insertText', { text: ' 고치는 중' });
await sleep(300);
check("'취소'를 누른다", await clickText('취소'));
await sleep(500);
const backToRead = await noteState();
check('취소하면 읽기 모드로 돌아가고 고치던 글은 버린다',
  backToRead.mode === 'read'
  && backToRead.readBody.includes(seed.entries[today].body)
  && !backToRead.readBody.includes('고치는 중')
  && (await ev(`(document.querySelector('.tiptap') || {}).textContent || ''`)).includes('고치는 중') === false,
  JSON.stringify(backToRead));
// 아래 검사들은 편집기를 직접 만진다 — 다시 열어 둔다
check("다시 '수정'으로 편집기를 연다", await clickText('수정'));
await sleep(500);

// 6) 묵상 칸은 업무 본문과 같은 에디터(TipTap)다
await waitFor(`document.querySelector('.tiptap')`);
const editor = await ev(`(() => ({
  tiptap: !!document.querySelector('.tiptap'),
  textarea: !!document.querySelector('textarea[aria-label="내 묵상"]'),
  bar: [...document.querySelectorAll('button[title]')].map(b => b.title).filter(t => ['굵게','형광펜','불릿 목록','체크리스트'].includes(t)).length,
}))()`);
check('묵상 칸이 마크다운 에디터로 바뀌었다', editor.tiptap && !editor.textarea, JSON.stringify(editor));
// 제목 버튼은 노트에 **없다**(사용자 결정 2026-09-10 · 8-a-2가 그것을 단정한다) —
// 여기서는 그 밖의 서식이 그대로 오는지만 본다
check('서식 바가 같이 온다(굵게·형광펜·목록·체크리스트)', editor.bar === 4, String(editor.bar));
// **빈 공간을 눌러도 입력된다**(사용자 피드백 2026-09-03). 자리를 잡는 일은
// MarkdownEditor의 focusEnd가 하고(`.tiptap` 밖을 누르면 문서 끝으로), 그 빈 자리는
// 종이 안 도막 칸의 남는 높이다(index.css `.note-paper .paper-rows` — 예전 편집
// 상자와 같은 `min-h-40 md:min-h-56` 값을 그대로 쓴다).
// **되돌리기**: 그 min-height를 지우면 누를 자리가 사라져 아래 두 번째 줄이 깨진다.
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
  psalm: document.body.innerText.includes(${JSON.stringify(REF_FULL_YEST)}),
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

// 8-a) 아직 아무것도 안 쓴 날은 **템플릿**으로 시작한다(사용자 요청 2026-09-08 —
// "기존 순 노트 템플릿 가져와서 최대한 우리 디자인 시스템에 맞춰 재구성하기").
// 도막은 둘이다(2026-09-12 · 나의 결단 · 기도) — QT에는 '말씀 요약'이 없고,
// '본문'은 종이 머리에 구절이 서므로 뺐다.
// **손대지 않은 템플릿은 빈 묵상이다** — 제목 줄이 있다는 이유로 저장이 열리면
// 아무도 쓰지 않은 제목 두 줄이 그대로 저장되고 잔디에까지 찍힌다.
await waitFor(`(() => { const t = document.querySelector('.tiptap'); return t && t.offsetParent; })()`, 8000);
await sleep(400);
const tplNote = await ev(`(() => {
  const t = document.querySelector('.tiptap');
  const h = t && t.querySelector('h3');
  const cs = h ? getComputedStyle(h, '::before') : null;
  return { heads: t ? [...t.querySelectorAll('h3')].map(x => x.textContent.trim()) : [],
           leaf: cs ? String(cs.maskImage || cs.webkitMaskImage || '') : '' };
})()`);
check('묵상을 처음 쓰는 날은 템플릿 두 도막으로 시작한다',
  tplNote.heads.join('|') === '나의 결단|기도', JSON.stringify(tplNote.heads));
// **잎 표시는 사용자가 뺐다**(2026-09-09 — "잎사귀가 추가되었는데 이건 지울 것" · §7).
// 다시 붙이면 이 줄이 실패한다.
check('도막 제목에 잎 표시가 없다', !/svg/.test(tplNote.leaf), tplNote.leaf.slice(0, 48));

// ── 8-a-2) 편집 칸이 종이의 두 칸 격자다 (사용자 요청 2026-09-10) ───────────
// 데스크톱(1440)에서는 라벨이 그 도막 **첫 줄과 나란히** 선다 — 격자 자동 배치가
// h3(1열) 다음 블록(2열)을 같은 행에 앉히기 때문이다(index.css `.note-paper` 머리말).
// **되돌리기**: `.note-paper .tiptap`의 `display: grid`를 지우면 라벨이 위로 올라가
// 아래 둘이 깨진다(모바일 기대값과 같아진다).
const labelRow = await ev(`(() => {
  const t = document.querySelector('.qt-note-editor .tiptap');
  const h = t && t.querySelector('h3');
  const next = h && h.nextElementSibling;
  if (!h || !next) return null;
  const cs = getComputedStyle(t);
  const a = h.getBoundingClientRect(), b = next.getBoundingClientRect();
  return { grid: cs.display, cols: cs.gridTemplateColumns,
           dTop: Math.round(b.top - a.top), rightOf: Math.round(b.left - a.right),
           labelW: Math.round(a.width) };
})()`);
check('편집 칸이 왼쪽 라벨 · 오른쪽 글 두 칸 격자다',
  !!labelRow && labelRow.grid === 'grid' && /^58px /.test(labelRow.cols), JSON.stringify(labelRow));
check('1440: 라벨과 그 도막 첫 줄이 같은 행이다(±2px)',
  !!labelRow && Math.abs(labelRow.dTop) <= 2 && labelRow.rightOf >= 0, JSON.stringify(labelRow));

// ── 8-a-3) 종이 위 제목 칸을 누르면 **거기에** 커서가 간다 (2026-09-11) ─────
// 감싸개의 onMouseDown(MarkdownEditor의 focusEnd)은 `.tiptap` 밖을 누르면 preventDefault로
// 막고 커서를 편집기 끝으로 보낸다. 틀(frame)이 들어오면서 그 감싸개 안에 **제목 입력
// 칸**이 생겼는데(paper.jsx PaperNoteHead · 0062) 그것까지 같이 막혀서, 실기기에서 제목을
// 눌러도 커서가 안 잡혔다(사용자 지적 2026-09-11 — "제목 미정 글자만 있고 못 고친다").
// **되돌리기**: focusEnd의 `SELF_FOCUS` 갈래를 빼면 포커스가 다시 `.tiptap`으로 끌려가
// 아래 첫 줄이 깨진다.
// **합성 MouseEvent로는 브라우저가 포커스를 안 옮긴다** — 진짜 마우스를 보내야 한다.
const titleAt = await ev(`(() => {
  const inp = document.querySelector('.qt-note-editor .paper-title-input');
  if (!inp) return null;
  inp.scrollIntoView({ block: 'center' });
  const r = inp.getBoundingClientRect();
  const cs = getComputedStyle(inp);
  return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2),
           caret: cs.caretColor, color: cs.color };
})()`);
if (titleAt) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: titleAt.x, y: titleAt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: titleAt.x, y: titleAt.y, button: 'left', clickCount: 1 });
  await sleep(350);
}
const titleFocus = await ev(`(() => {
  const a = document.activeElement;
  return { 제목칸: !!(a && a.classList && a.classList.contains('paper-title-input')),
           tiptap: !!(a && a.closest && a.closest('.tiptap')) };
})()`);
check('묵상 제목 칸을 누르면 그 칸에 커서가 간다',
  !!titleAt && titleFocus.제목칸 === true && titleFocus.tiptap === false,
  JSON.stringify([titleAt, titleFocus]));
// 커서·글자가 종이 잉크 색이라야 '쓸 수 있는 칸'으로 보인다(종이는 다크를 안 따라간다)
check('제목 칸의 커서·글자가 종이 잉크 색이다',
  !!titleAt && titleAt.caret === 'rgb(25, 23, 32)' && titleAt.color === 'rgb(25, 23, 32)',
  JSON.stringify(titleAt));

// 서식 바에 **제목·구분선·링크가 없다** — 제목은 2026-09-10, 구분선·링크는 2026-09-11의
// 사용자 결정이다("불렛과 번호, 체크박스는 남겨두고 구분선이랑 링크 서식은 제거").
// 도막 제목이 고정이라 제목을 만들 일이 없고, 종이에는 선을 긋지 않는다.
// 불릿·번호·체크는 그대로 남는다(§8 '기능을 숨기지 않습니다').
// **되돌리기**: `tools="note"`를 떼면 그 셋이 다시 나타나 첫 줄이 깨진다.
const noteBar = await ev(`(() => {
  const box = document.querySelector('.qt-note-editor');
  const titles = [...box.querySelectorAll('button[title]')].map(b => b.title);
  return { heads: titles.filter(t => t.indexOf('제목 ') === 0),
           rule: titles.includes('구분선'),
           link: titles.some(t => t.indexOf('링크') >= 0),
           lists: ['불릿 목록', '번호 목록', '체크리스트'].filter(t => titles.includes(t)),
           keep: ['굵게', '형광펜', '불릿 목록', '체크리스트'].filter(t => titles.includes(t)) };
})()`);
check('노트 서식 바에 제목·구분선·링크가 없다',
  noteBar.heads.length === 0 && noteBar.rule === false && noteBar.link === false, JSON.stringify(noteBar));
check('굵게·형광펜·목록 셋은 그대로 있다',
  noteBar.keep.length === 4 && noteBar.lists.length === 3, JSON.stringify(noteBar));

check('손대지 않은 템플릿으로는 저장할 수 없다', (await saveDisabled()) === true);
await ev(`(() => { const el = document.querySelector('.tiptap'); el && el.focus(); })()`);
await send('Input.insertText', { text: '오늘은 이 말씀이 마음에 남았어요' });
await sleep(400);
check('한 줄이라도 쓰면 저장이 열린다', (await saveDisabled()) === false);
// **중제목은 수정 창에서부터 지워지지 않는다**(사용자 결정 2026-09-10 — "아예 수정
// 창에서부터 그 중제목은 고정해달라는거야"). 전체를 골라 글자를 넣어도 도막 제목은
// 그대로다 — 그 트랜잭션이 물린다(MarkdownEditor의 LockedHeadings).
// **되돌리기**: 그 확장을 extensions 목록에서 빼면 제목이 통째로 사라져 이 줄이 깨진다.
await ev(`(() => {
  const t = document.querySelector('.tiptap');
  t.focus();
  const r = document.createRange(); r.selectNodeContents(t);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
})()`);
await send('Input.insertText', { text: '전부 지워질까' });
await sleep(400);
const lockedHeads = await ev(`(() => {
  const t = document.querySelector('.tiptap');
  return { heads: [...t.querySelectorAll('h1, h2, h3, h4')].map(h => h.textContent.trim()),
    hasTyped: t.innerText.includes('전부 지워질까') };
})()`);
check('중제목은 전체 선택 후 입력에도 지워지지 않는다',
  JSON.stringify(lockedHeads.heads) === JSON.stringify(['나의 결단', '기도'])
  && lockedHeads.hasTyped === false, JSON.stringify(lockedHeads));

// **목록 글머리는 글 칸 안에 선다**(사용자 지적 2026-09-11 — `1.`·`•`가 종이 왼쪽 끝까지
// 밀려 나갔다). 도막 칸의 `padding-left: 12px`이 `.tiptap ul`의 들여쓰기를 덮어써서, 칸
// 밖에 그려지는 글머리가 라벨 칸(58px)으로 넘어간 것이다. 글머리가 설 자리를 글 칸 안에
// 만든다 — 글 칸이 시작하는 자리는 읽기 종이의 `- 목록`과 같다.
// **되돌리기**: index.css의 `.note-paper .tiptap > :is(ul, ol)` 들여쓰기를 지우면 깨진다.
await ev(`(() => {
  const t = document.querySelector('.qt-note-editor .tiptap');
  const p = [...t.children].filter(el => el.tagName === 'P').pop();
  t.focus();
  const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
})()`);
await sleep(250);
await ev(`(() => { const b = document.querySelector('.qt-note-editor button[title="불릿 목록"]'); b && b.click(); })()`);
await sleep(500);
const 글머리 = await ev(`(() => {
  const t = document.querySelector('.qt-note-editor .tiptap');
  const ul = t && t.querySelector(':scope > ul:not([data-type="taskList"])');
  const p = t && [...t.children].find(el => el.tagName === 'P');
  if (!ul || !p) return null;
  const upad = parseFloat(getComputedStyle(ul).paddingLeft) || 0;
  const ppad = parseFloat(getComputedStyle(p).paddingLeft) || 0;
  const ur = ul.getBoundingClientRect(), pr = p.getBoundingClientRect();
  // 글머리는 목록 상자의 padding 안(글 칸 시작 자리 ~ 글자 시작 자리)에 그려진다 —
  // 그 자리가 글 칸 안이려면 목록의 들여쓰기가 문단의 것보다 글머리 폭만큼 넉넉해야 한다.
  return { 목록들여쓰기: Math.round(upad), 문단들여쓰기: Math.round(ppad),
           같은칸: Math.abs(ur.left - pr.left) <= 1, 여유: Math.round(upad - ppad) };
})()`);
check('노트 목록의 글머리가 라벨 칸으로 넘어가지 않는다',
  !!글머리 && 글머리.같은칸 === true && 글머리.여유 >= 16, JSON.stringify(글머리));

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

// 9) 나눔은 **사람 칩 한 줄 + 종이 하나**다(사용자 결정 2026-09-13 — "더다붓에 공유할
// 때도 묵상 제목이 아니라 그 종이 전체를 보여줘야지 … 쌓이는 구조는 아니고, 사람마다 볼
// 수 있게 피커를 둔다든지"). 예전에는 사람마다 한 줄씩 쌓고 도막을 라벨|글 두 칸으로 접어
// 요약(NoteDigest)했다 — 그 줄·요약은 통째로 없어졌다.
// **되돌리기**: wordView의 ShareFeed가 다시 줄을 map으로 쌓게 하면 아래 '종이는 하나다' ·
// '줄로 쌓지 않는다' · '칩을 누르면 종이가 그 사람 것으로 바뀐다'가 같이 깨진다.
//
// 고치기는 여전히 '내 묵상' 칸으로 데려가고, **공유를 조작하는 칸은 여기 없다**(사용자
// 결정 2026-09-05). 상태(잠금)는 이제 **줄이 아니라 내 칩**이 말한다.
const seedBody = seed.entries[today].body;
// 남의 나눔을 다섯 심는다 — 게스트의 나눔은 여태 내 글 하나뿐이었다(word.js LS.shared).
// 이름이 길수록 375에서 칩 줄이 실제로 넘쳐서 '줄 안에서 민다'를 잴 수 있다.
const crowd = [
  { id: 'other-1', name: '조해리', title: '해리의 묵상 제목', body: '## 나의 묵상\n해리가 쓴 묵상 한 줄\n\n## 나의 결단\n해리의 결단 한 줄' },
  { id: 'other-2', name: '박은총', title: '은총의 묵상 제목', body: '## 나의 묵상\n은총이 쓴 묵상 한 줄' },
  { id: 'other-3', name: '김다니엘', title: '다니엘의 묵상 제목', body: '도막 없이 쓴 옛 나눔 한 줄' },
  { id: 'other-4', name: '이하늘', title: '', body: '## 나의 묵상\n하늘이 쓴 묵상 한 줄' },
  { id: 'other-5', name: '정소망', title: '소망의 묵상 제목', body: '## 나의 묵상\n소망이 쓴 묵상 한 줄' },
];
await ev(`localStorage.setItem('word_qt_shared', ${JSON.stringify(JSON.stringify({ [today]: crowd }))})`);
await reload();
await sleep(1200);
check('다시 말씀으로(사람 다섯을 심고)', await clickText('말씀'));
await sleep(1600);
await waitFor(`document.querySelector('[data-share-feed]')`);
const readPaper = (sel) => `(() => {
  const box = document.querySelector(${JSON.stringify(sel)});
  if (!box) return null;
  const t = box.querySelector('.paper-ref-title');
  return { title: t ? t.textContent.trim() : '',
           ref: (box.querySelector('.paper-ref') || {}).textContent || '',
           labels: [...box.querySelectorAll('.paper-row-label')].map(x => x.textContent.trim()),
           body: (box.querySelector('.paper-body') || {}).innerText || '',
           w: Math.round(box.getBoundingClientRect().width) };
})()`;
const chipRow = await ev(`(() => {
  const feed = document.querySelector('[data-share-feed]');
  const chips = [...document.querySelectorAll('[data-share-person]')];
  return {
    chips: chips.length,
    kinds: chips.map(c => c.dataset.sharePerson).join(','),
    names: chips.map(c => c.textContent.trim()),
    pressed: chips.map(c => c.getAttribute('aria-pressed')).join(','),
    // **종이는 언제나 하나**다 — 쌓이지 않는다(사용자 결정의 핵심)
    papers: feed ? feed.querySelectorAll('.paper-sheet').length : -1,
    rows: document.querySelectorAll('[data-feed-row]').length,
    digest: document.querySelectorAll('.qt-digest').length,
  };
})()`);
check('공유한 사람 수만큼 칩이 선다', chipRow.chips === 6 && chipRow.kinds === 'other,other,other,other,other,mine',
  JSON.stringify(chipRow));
check('나눔 종이는 언제나 하나다', chipRow.papers === 1, JSON.stringify(chipRow));
check('사람마다 줄로 쌓지 않는다(접힌 요약도 없다)', chipRow.rows === 0 && chipRow.digest === 0,
  JSON.stringify(chipRow));
check('처음에는 목록의 첫 사람이 골라져 있다', chipRow.pressed === 'true,false,false,false,false,false',
  JSON.stringify(chipRow));
// 종이는 '내 묵상' 칸의 읽기 종이와 **같은 부품·같은 폭**이다(QT_SHEET_BOX)
const firstPaper = await ev(readPaper('[data-share-paper]'));
const minePaper = await ev(readPaper('[data-note-read="1"]'));
check('나눔 종이가 내 묵상 종이와 같은 폭이다',
  !!firstPaper && !!minePaper && Math.abs(firstPaper.w - minePaper.w) <= 1,
  JSON.stringify({ share: firstPaper?.w, mine: minePaper?.w }));
check('나눔 종이가 그 사람의 제목·구절·도막을 그대로 세운다',
  firstPaper.title === '해리의 묵상 제목' && firstPaper.ref.includes(REF_FULL)
  && firstPaper.labels.join('|') === '나의 묵상|나의 결단'
  && firstPaper.body.includes('해리가 쓴 묵상 한 줄'), JSON.stringify(firstPaper));
// 칩을 누르면 **그 종이의 내용만** 바뀐다
await clickSel('[data-share-person="other"]:nth-of-type(3)');
await sleep(400);
const swapped = await ev(`(() => ({
  paper: ${readPaper('[data-share-paper]')},
  papers: document.querySelectorAll('[data-share-feed] .paper-sheet').length,
  pressed: [...document.querySelectorAll('[data-share-person]')].map(c => c.getAttribute('aria-pressed')).join(','),
}))()`);
check('칩을 누르면 종이가 그 사람 것으로 바뀐다',
  swapped.paper.title === '다니엘의 묵상 제목' && swapped.paper.body.includes('도막 없이 쓴 옛 나눔 한 줄')
  && !swapped.paper.body.includes('해리가 쓴 묵상 한 줄'), JSON.stringify(swapped.paper));
check('칩을 눌러도 종이는 여전히 하나다', swapped.papers === 1, String(swapped.papers));
check('고른 칩만 눌린 상태다', swapped.pressed === 'false,false,true,false,false,false', swapped.pressed);
// 도막 없이 쓴 옛 나눔도 라벨 없는 도막 하나로 종이에 선다(splitNoteSections)
check('도막 없이 쓴 옛 나눔도 종이로 선다', swapped.paper.labels.length === 1, JSON.stringify(swapped.paper.labels));
// 도구 줄 — 남의 종이에는 마스터의 지우기만, 내 종이에는 고치기만(§8 자리: 고치기 왼쪽 ·
// 지우기 오른쪽 끝). 게스트에는 로그인이 없어 언제나 마스터다(auth.jsx).
const onOther = await ev(`(() => {
  const tools = document.querySelector('[data-share-tools]');
  const del = document.querySelector('button[aria-label="이 나눔 지우기"]');
  const edit = document.querySelector('button[aria-label="내 나눔 고치기"]');
  const t = tools ? tools.getBoundingClientRect() : null;
  return { del: !!del, edit: !!edit,
    rightGap: del && t ? Math.round(t.right - del.getBoundingClientRect().right) : -1 };
})()`);
check('남의 종이에는 마스터의 지우기가 붙는다', onOther.del === true && onOther.edit === false,
  JSON.stringify(onOther));
check('지우기는 도구 줄의 오른쪽 끝이다', onOther.rightGap >= 0 && onOther.rightGap <= 2,
  JSON.stringify(onOther));
await clickSel('[data-share-person="mine"]');
await sleep(400);
const onMine = await ev(`(() => {
  const tools = document.querySelector('[data-share-tools]');
  const edit = document.querySelector('button[aria-label="내 나눔 고치기"]');
  const t = tools ? tools.getBoundingClientRect() : null;
  return { edit: !!edit, del: !!document.querySelector('button[aria-label="이 나눔 지우기"]'),
    paper: (document.querySelector('[data-share-paper]') || {}).dataset?.sharePaper || '',
    leftGap: edit && t ? Math.round(edit.getBoundingClientRect().left - t.left) : -1,
    toggle: document.querySelectorAll('[data-share-feed] button[aria-pressed]').length,
    chip: document.querySelectorAll('[data-share-feed] [data-share-chip]').length };
})()`);
check('내 종이에는 고치기가 붙고 지우기는 안 붙는다',
  onMine.edit === true && onMine.del === false && onMine.paper === 'mine', JSON.stringify(onMine));
check('고치기는 도구 줄의 왼쪽이다', onMine.leftGap >= 0 && onMine.leftGap <= 2, JSON.stringify(onMine));
// 공유를 조작하는 칸은 여기 없다 — 칩의 aria-pressed는 사람 피커고, 토글·칩은 '내 묵상' 칸이다
check('나눔 쪽에는 공유 토글·칩이 없다',
  onMine.toggle === 6 && onMine.chip === 0, JSON.stringify(onMine));

// 375 — 칩 줄은 **줄 안에서** 민다(§8 가로 스크롤 허용). 화면이 넘치면 안 된다.
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await sleep(800);
const chipFit = await ev(`(() => {
  const d = document.documentElement;
  const first = document.querySelector('[data-share-person]');
  const row = first ? first.parentElement : null;
  const paper = document.querySelector('[data-share-paper] .paper-sheet');
  return {
    over: d.scrollWidth > d.clientWidth + 1,
    // 미는 줄 **안**은 세어도 소용없다 — 넘쳐 있어야 밀 수 있다(x-scroll-lock).
    // 그 줄 자신과 줄 밖의 것들만 센다.
    wide: [...document.querySelectorAll('[data-share-feed] *')]
      .filter(e => !(row && row !== e && row.contains(e)))
      .filter(e => e.getBoundingClientRect().right > d.clientWidth + 1).length,
    scrolls: row ? row.scrollWidth > row.clientWidth + 1 : false,
    fits: row ? Math.round(row.getBoundingClientRect().right) <= d.clientWidth + 1 : false,
    paperFits: paper ? Math.round(paper.getBoundingClientRect().right) <= d.clientWidth + 1 : false,
  };
})()`);
check('375에서 나눔이 가로로 넘치지 않는다',
  chipFit.over === false && chipFit.wide === 0 && chipFit.fits && chipFit.paperFits,
  JSON.stringify(chipFit));
check('375에서 칩 줄은 줄 안에서 민다', chipFit.scrolls === true, JSON.stringify(chipFit));
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
// 심어 둔 남의 나눔은 걷는다 — 아래 검사들은 내 글 하나만 있는 화면을 본다
await ev(`localStorage.removeItem('word_qt_shared')`);
await reload();
await sleep(1200);
check('다시 말씀으로(심은 것을 걷고)', await clickText('말씀'));
await sleep(1600);
// **조작 가능한 공유 토글은 이 화면에 한 벌뿐이다**(같은 결정) — '내 묵상' 칸의 것.
// 한 벌은 두 쪽(나만 보기·더다붓에 공유하기)이라 벌 수로 센다.
const onlyToggle = await ev(`(() => {
  const bs = [...document.querySelectorAll('button[aria-pressed]')]
    .filter(b => ['나만 보기', '더다붓에 공유하기'].includes(b.textContent.trim()));
  const sets = [...new Set(bs.map(b => b.parentElement))];
  return { buttons: bs.length, sets: sets.length,
    inFeed: sets.filter(s => s.closest('[data-share-feed]')).length,
    inEditor: sets.filter(s => !!s.closest('[data-col="qt"]') && !s.closest('[data-share-feed]')).length };
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
// 공유를 내리는 길도 그 토글 하나다 — 나눔 쪽에서 내리는 버튼은 없어졌다
check("편집기 토글의 '나만 보기'를 누른다", (await clickText('나만 보기')) === true);
await sleep(1000);
const afterUnshare = await ev(`(() => {
  const person = document.querySelector('[data-share-person="mine-private"]');
  const paper = document.querySelector('[data-share-paper]');
  const chip = document.querySelector('[data-share-chip]');
  return {
    stored: JSON.parse(localStorage.getItem('word_qt_entries') || '{}')[${JSON.stringify(today)}] || null,
    inEditor: (document.querySelector('.tiptap') || {}).innerText || '',
    // 비공개가 된 내 묵상은 **내 피드에는 남는다**(사용자 결정 2026-09-03)
    privateRow: !!person,
    // '나만 보기' 표시는 이제 **줄이 아니라 칩**에 붙는다(2026-09-13)
    badge: person ? !!person.querySelector('[data-private]') : false,
    badgeText: person ? person.querySelector('[data-private]')?.getAttribute('aria-label') === '나만 보기' : false,
    body: paper ? paper.textContent.includes(${JSON.stringify(seed.entries[today].body)}) : false,
    others: document.querySelectorAll('[data-share-person="other"]').length,
    mineRows: document.querySelectorAll('[data-share-person^="mine"]').length,
    papers: document.querySelectorAll('[data-share-feed] .paper-sheet').length,
    toggle: person ? person.querySelectorAll('[data-share-chip]').length : 0,
    chips: document.querySelectorAll('[data-share-chip]').length,
    chipText: chip ? chip.textContent : '',
    chipInFeed: chip ? !!chip.closest('[data-share-feed]') : false,
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
// 두 줄로 보였다가 하나로 합쳐지던 자리다(8-b) — 넘긴 뒤에도 내 칩은 하나뿐이고
// 종이도 하나다(2026-09-13 — 쌓지 않는다)
check('공유를 내려도 내 칩은 하나뿐이다', afterUnshare.mineRows === 1 && afterUnshare.papers === 1,
  JSON.stringify({ mine: afterUnshare.mineRows, papers: afterUnshare.papers }));
check("내 칩에 '나만 보기' 잠금 표시가 붙는다",
  afterUnshare.badge && afterUnshare.badgeText, JSON.stringify(afterUnshare));
check('비공개가 된 칩에도 공유 칩은 없다', afterUnshare.toggle === 0,
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
  mineRows: document.querySelectorAll('[data-share-person^="mine"]').length,
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
check('공유를 켜도 내 칩은 하나뿐이다', shared.mineRows === 1, String(shared.mineRows));

// 11) 묵상 저장 — 마크다운 에디터에 쳐 넣고 저장한다(그때만 저장이 켜진다)
// 편집기가 서 있을 때만 글을 칠 수 있다 — 찬 서버에서는 lazy 청크가 늦고, 저장된 글이
// 있는 날은 '수정'을 눌러야 상자가 드러난다(§6-40 — 없으면 던지지 말고 넘어간다)
if (!await waitFor(`(() => { const t = document.querySelector('.tiptap'); return t && t.offsetParent; })()`, 8000)) {
  await clickText('수정');
  await waitFor(`(() => { const t = document.querySelector('.tiptap'); return t && t.offsetParent; })()`, 8000);
}
await ev(`(() => { const el = document.querySelector('.tiptap'); el && el.focus(); })()`);
await send('Input.insertText', { text: ' 그리고 한 줄 더' });
await sleep(400);
check('글을 고치면 저장이 켜진다', (await saveDisabled()) === false);

// 11-a) 묵상 제목 — **종이 위의 입력 칸**(0062 · 사용자 요청 2026-09-11). 예배 노트
// 종이의 머리에는 주보의 설교 제목이 서는데 묵상은 그 자리가 늘 비어 구절만 올라왔다.
// 읽기 문단과 같은 글자 크기·굵기이고 테두리·배경이 없어 종이 위에 바로 쓰는 모양이다.
// **되돌리기**: wordView의 `onTitleChange`를 떼면 칸이 문단으로 돌아가 아래 셋이 깨진다.
const NOTE_TITLE = '오늘 붙잡은 한 줄';
const titleBox = await ev(`(() => {
  const i = document.querySelector('.qt-note-editor .paper-title-input');
  if (!i) return null;
  const cs = getComputedStyle(i);
  const head = i.closest('.paper-hero');
  return { tag: i.tagName, placeholder: i.placeholder, value: i.value,
    size: cs.fontSize, weight: cs.fontWeight, border: cs.borderTopWidth, bg: cs.backgroundColor,
    // 구절은 그 칸 **아래**에 그대로 선다(제목 → 구절 순 · 예배 노트와 같다)
    ref: head ? (head.querySelector('.paper-ref') || {}).textContent : null,
    refBelow: head ? head.querySelector('.paper-ref').compareDocumentPosition(i) === 2 : false };
})()`);
check("빈 제목 칸의 자리표는 '제목 미정' 하나다",
  !!titleBox && titleBox.tag === 'INPUT' && titleBox.placeholder === '제목 미정' && titleBox.value === '',
  JSON.stringify(titleBox));
check('제목 칸은 테두리·배경 없이 종이 위에 바로 쓴다(읽기 제목과 같은 글자)',
  !!titleBox && titleBox.border === '0px' && titleBox.bg === 'rgba(0, 0, 0, 0)'
  && titleBox.size === '21px' && titleBox.weight === '200', JSON.stringify(titleBox));
check('편집 종이도 제목 위 · 구절 아래다',
  !!titleBox && titleBox.ref === REF_FULL && titleBox.refBelow === true, JSON.stringify(titleBox));
await ev(`(() => { const i = document.querySelector('.qt-note-editor .paper-title-input'); i && i.focus(); })()`);
await send('Input.insertText', { text: NOTE_TITLE });
await sleep(300);
check('제목 칸에 친 글이 그대로 남는다',
  (await ev(`(document.querySelector('.qt-note-editor .paper-title-input') || {}).value`)) === NOTE_TITLE);

await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='저장'); b && b.click(); })()`);
await sleep(900);
const mine = await ev(`JSON.parse(localStorage.getItem('word_qt_entries') || '{}')[${JSON.stringify(today)}]`);
check('묵상과 공유 상태가 같이 저장된다',
  mine && mine.body.includes('그리고 한 줄 더') && mine.shared === true, JSON.stringify(mine));
check('제목도 글과 같이 저장된다', mine && mine.title === NOTE_TITLE, JSON.stringify(mine));
// 제목이 있으면 읽기 종이의 머리가 **제목 → 구절** 순이다(예배 노트와 같은 부품).
// 없으면 지금처럼 구절만 큰 글자로 올라온다(위 5절이 그것을 본다).
const savedHead = await ev(`(() => {
  const read = document.querySelector('[data-note-read] .paper-sheet .paper-hero');
  if (!read) return null;
  return {
    title: (read.querySelector('.paper-ref-title') || {}).textContent || '',
    ref: (read.querySelector('.paper-ref') || {}).textContent || '',
    order: [...read.querySelectorAll('.paper-ref-title, .paper-ref')].map(e => e.className.split(' ')[0]).join('|'),
    input: !!read.querySelector('input'),
  };
})()`);
check('제목이 있으면 읽기 종이 머리가 제목 → 구절 순이다',
  !!savedHead && savedHead.title === NOTE_TITLE && savedHead.ref === REF_FULL
  && savedHead.order === 'paper-ref-title|paper-ref', JSON.stringify(savedHead));
check('읽기 종이에는 입력 칸이 없다(그림으로 나가는 종이다)',
  !!savedHead && savedHead.input === false, JSON.stringify(savedHead));
// 저장하면 **읽기 모드로 돌아간다**(2026-09-07) — 저장 버튼은 그 자리에 없고 '수정'이 선다
const savedMode = await noteState();
check('저장하면 읽기 모드로 돌아간다',
  savedMode.mode === 'read' && savedMode.save === false && savedMode.cancel === false
  && savedMode.edit === true && savedMode.readBody.includes('그리고 한 줄 더'),
  JSON.stringify(savedMode));
// 토스트도 토글과 같은 말을 쓴다 — '나눔에 올렸어요'가 아니다
const toast = await ev(`(document.querySelector('[role="status"]') || {}).textContent || ''`);
check('저장 토스트가 토글과 같은 말을 쓴다', toast.includes('더다붓에 공유했어요'), toast);

// 11-b) 진짜 삭제는 '내 묵상' 칸에서만(4차 피드백 8) — 지운 뒤에는 공유할 것이 없다
await ev(`(() => { const b=document.querySelector('button[aria-label="내 묵상 지우기"]'); b && b.click(); })()`);
await sleep(350);
check('내 묵상 지우기는 무엇이 없어지는지 묻는다',
  (await ev(`document.body.innerText.includes('이 날의 묵상을 지울까요?') && document.body.innerText.includes('내 기록에서도 제거돼요.')`)) === true);
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
check('진짜 삭제는 그 날 묵상을 없앤다', gone.stored === null && gone.feedEmpty
  && !gone.editor.includes(seedBody), JSON.stringify(gone));
// 지운 뒤에는 다시 '아직 아무것도 안 쓴 날'이라 템플릿이 선다(빈 칸이 아니다)
check('지우고 나면 템플릿이 다시 선다', gone.editor.includes('나의 결단'), JSON.stringify(gone.editor));
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
check('남의 나눔 삭제는 마스터에게만, 내 것에는 안 붙는다',
  JSON.stringify(delWho) === '[true,false,false]', JSON.stringify(delWho));

// 남의 것을 하나 심는다 — 게스트의 나눔은 여태 내 글 하나뿐이었다(word.js LS.shared)
await ev(`localStorage.setItem('word_qt_shared', ${JSON.stringify(JSON.stringify({ [word.kstToday()]: [{ id: 'other-1', name: '조해리', body: '남이 공유한 묵상 한 줄' }] }))})`);
await reload();
await sleep(1200);
check('다시 말씀으로', await clickText('말씀'));
await sleep(1400);
const otherRow = await ev(`(() => {
  const person = document.querySelector('[data-share-person="other"]');
  const paper = document.querySelector('[data-share-paper]');
  return {
    person: !!person,
    paper: paper ? paper.dataset.sharePaper : '',
    body: paper ? paper.textContent.includes('남이 공유한 묵상 한 줄') : false,
    del: !!document.querySelector('button[aria-label="이 나눔 지우기"]'),
    // 내 것에는 안 붙는다 — 그 자리는 '내 묵상' 칸의 휴지통이 맡는다
    mineRows: document.querySelectorAll('[data-share-person^="mine"]').length,
    edit: !!document.querySelector('button[aria-label="내 나눔 고치기"]'),
  };
})()`);
check('남이 공유한 묵상이 나눔의 종이로 선다',
  otherRow.person && otherRow.body && otherRow.paper === 'other', JSON.stringify(otherRow));
check('마스터에게 남의 종이 삭제 버튼이 붙는다',
  otherRow.del === true && otherRow.edit === false && otherRow.mineRows === 0, JSON.stringify(otherRow));
await clickSel('button[aria-label="이 나눔 지우기"]');
await sleep(350);
// 공유 해제가 아니라 그 사람의 묵상이 지워진다는 것을 문구가 말한다
check('남의 나눔 삭제는 무엇이 없어지는지 묻는다',
  (await ev(`document.body.innerText.includes('이 나눔을 지울까요? 공유만 내려가는 게 아니라 그 사람의 이 날 묵상이 지워져요.')`)) === true);
await clickText('삭제');
await sleep(900);
const otherGone = await ev(`(() => ({
  stored: (JSON.parse(localStorage.getItem('word_qt_shared') || '{}')[${JSON.stringify(word.kstToday())}] || []).length,
  chips: document.querySelectorAll('[data-share-person]').length,
  papers: document.querySelectorAll('[data-share-feed] .paper-sheet').length,
  empty: document.body.innerText.includes('이 날짜에 올라온 나눔이 아직 없어요'),
}))()`);
check('마스터가 지우면 그 칩과 종이가 사라진다',
  otherGone.stored === 0 && otherGone.chips === 0 && otherGone.papers === 0 && otherGone.empty,
  JSON.stringify(otherGone));
await ev(`localStorage.removeItem('word_qt_shared')`);

// ── 성경 읽기 ───────────────────────────────────────────────────────────────
check('세그먼트 전환', await clickText('성경 읽기'));
await sleep(1000);
const toc = await ev(`(() => {
  const t = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  const heads = [...document.querySelectorAll('h3')].map(h => h.textContent.trim());
  return { ot: heads.includes('구약'), nt: heads.includes('신약'),
           gen: t.includes('창세기'), rev: t.includes('요한계시록'), aa: t.filter(x => x === 'Aa').length,
           aaPressed: [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Aa')
             .map(b => b.getAttribute('aria-pressed')).join(','),
           panes: [...document.querySelectorAll('[data-pane]')].map(b => b.textContent.trim()),
           active: (document.querySelector('[data-pane][aria-pressed="true"]') || {}).dataset?.pane || '',
           marks: heads.includes('북마크') || heads.includes('형광펜'),
           text: document.body.innerText,
           hint: (document.querySelector('input[aria-label="어떤 본문을 찾으시나요?"]') || {}).placeholder || '' };
})()`);
check('목차가 구약·신약으로 갈린다', toc.ot && toc.nt && toc.gen && toc.rev, JSON.stringify(toc));
check('글자 크기 Aa 3단계', toc.aa === 3, String(toc.aa));
// 세 칸 중 지금 쓰는 것이 어느 것인지도 aria로 남긴다(세그먼트와 같은 한 벌)
check('지금 글자 크기가 aria로 남는다', toc.aaPressed === 'false,true,false', toc.aaPressed);
// 낱말만 찾던 칸이 아니다 — 뜻으로도 찾는다(사용자 문구 2026-09-08)
check("검색 자리표는 '어떤 본문을 찾으시나요?'", toc.hint === '어떤 본문을 찾으시나요?', toc.hint);

// **리더에 들어오면 남은 책을 미리 받아 둔다**(사용자 지적 2026-09-08 — "첫 검색에서
// 모든 권을 다 훑고 있음"). 2초 뒤에 시작하고, 받은 책은 Cache Storage에 남아
// 새로고침 뒤에도 그대로다 — 여기서는 그 통이 실제로 채워지는지를 본다.
// **되돌리기**: BibleTab의 warmBooks 이펙트를 빼면 통이 한두 권에서 멈춘다.
const warmedBooks = await ev(`(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const n = (await (await caches.open('bible-v1')).keys()).length;
      if (n > 40) return n;
    } catch (e) { return -1; }
    await new Promise(r => setTimeout(r, 300));
  }
  try { return (await (await caches.open('bible-v1')).keys()).length; } catch (e) { return -1; }
})()`, true);
check('리더에 들어오면 남은 책을 미리 받아 캐시에 담는다', warmedBooks > 40, String(warmedBooks));
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
  painted: (document.querySelector('p[data-verse="1:3"]') || {}).dataset?.mark === '1' }))()`);
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

// 검색 칸 안내 문구 — **메인 검색창과 같은 한 벌**을 돌린다(사용자 요청 2026-09-09 —
// "'어떤 본문을 찾으시나요?' 다음에 'AI가 본문을 같이 찾아줄게요'를 fade in/out으로").
// placeholder 속성은 첫 줄로 고정하고(스크린 리더·검사가 그걸 본다) 눈에 보이는 글자는
// 겹쳐 놓은 span이 그린다. 게스트에는 AI가 없어 **둘째 줄이 배열에 들어가지도 않는다**.
// **되돌리기**: BIBLE_HINTS를 aiEnabled와 상관없이 통째로 넘기면 마지막 줄이 깨진다 —
// 게스트에게 없는 것을 약속하는 말이 된다.
const hintBar = await ev(`(() => {
  const i = document.querySelector('input[aria-label="어떤 본문을 찾으시나요?"]');
  const span = i && i.parentElement.querySelector('span[data-hint]');
  const cs = span ? getComputedStyle(span) : null;
  return { ph: i ? i.getAttribute('placeholder') : '',
           text: span ? span.textContent.trim() : '',
           opacity: cs ? Number(cs.opacity) : -1, left: cs ? cs.left : '',
           // ::placeholder는 getComputedStyle이 크롬에서 늘 투명으로 답한다(못 믿는다) —
           // 진짜 글자를 감추는 것은 이 클래스라, 그 클래스가 붙었는지를 본다
           phHidden: i ? i.className.includes('placeholder:text-transparent') : false };
})()`);
check('검색 칸의 placeholder 속성은 첫 줄로 고정한다',
  hintBar.ph === '어떤 본문을 찾으시나요?', JSON.stringify(hintBar));
check('보이는 안내 글자는 겹쳐 놓은 span이 그린다',
  hintBar.text === '어떤 본문을 찾으시나요?' && hintBar.opacity === 1 && hintBar.phHidden === true,
  JSON.stringify(hintBar));
const hintList = await ev(`(async () => {
  const w = await import('/src/components/wordBible.jsx');
  const a = await import('/src/services/ai.js');
  return { ai: a.aiEnabled(), here: w.searchHints(a.aiEnabled()), on: w.searchHints(true) };
})()`, true);
check('AI가 없으면 둘째 줄은 문구 배열에 들어가지도 않는다',
  hintList.ai === false && hintList.here.length === 1
  && hintList.on.length === 2 && hintList.on[1] === 'AI가 본문을 같이 찾아줄게요',
  JSON.stringify(hintList));
// 회전 자체는 메인 검색창의 것을 그대로 쓴다 — 여기에 두 벌째를 만들지 않는다
const hintSrcBible = readFileSync(new URL('src/components/wordBible.jsx', ROOT), 'utf8');
const hintSrcLayout = readFileSync(new URL('src/components/layout.jsx', ROOT), 'utf8');
check('안내 문구 회전은 메인 검색창과 한 벌이다',
  hintSrcBible.includes("import { SearchHint } from './layout.jsx'")
  && /export function useRotatingHint\(on, hints = SEARCH_HINTS\)/.test(hintSrcLayout)
  && !/HINT_(HOLD|FADE)_MS/.test(hintSrcBible));

// 본문 검색 — 전권을 훑어 includes 매치
await ev(`(() => {
  const i = document.querySelector('input[aria-label="어떤 본문을 찾으시나요?"]');
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
// 결과는 두 도막이다(사용자 요청 2026-09-08) — 낱말이 그대로 나오는 절, 그리고 뜻으로
// 찾은 구절. 게스트 모드에는 로그인이 없어 AI에게 **묻지도 않으므로** 아래 도막은
// 아예 서지 않는다(왜 없는지 설명하는 줄도 붙이지 않는다 · §8).
//
// 낱말 도막의 머리줄은 **검색어와 건수뿐**이다(사용자 피드백 2026-09-09 — 예전에는
// 검색어 줄 밑에 '본문에 그대로 나오는 절'이 한 줄 더 있어 같은 말을 두 번 했다).
const headSpans = (sel) => `(() => {
  const box = document.querySelector(${JSON.stringify(sel)});
  if (!box) return [];
  return [...box.firstElementChild.querySelectorAll('span')].map(s => s.textContent.trim()).filter(Boolean);
})()`;
const hitSections = await ev(`(() => ({
  keyword: !!document.querySelector('[data-hits="keyword"]'),
  ai: !!document.querySelector('[data-hits="ai"]'),
  head: ${headSpans('[data-hits="keyword"]')},
  col: (document.querySelector('[data-col="search"]') || {}).innerText || '',
}))()`);
check('낱말 도막 머리줄은 검색어와 건수뿐이다',
  hitSections.keyword === true && hitSections.head.length === 2
  && hitSections.head[0] === '태초에' && /^\d+건$/.test(hitSections.head[1] || ''),
  JSON.stringify(hitSections.head));
check('결과에 딴 이름의 도막 제목이 없다',
  !hitSections.col.includes('본문에 그대로 나오는 절'), hitSections.col.slice(0, 80));
check('AI가 못 도는 자리에서는 그 도막이 아예 없다', hitSections.ai === false, JSON.stringify(hitSections.ai));
// 게스트에는 로그인이 없어 **모델에게 실제로 물을 수는 없다.** 대신 모델 답을 흉내 내어
// 브라우저에서 그 길을 그대로 태운다: 답 → 파싱 → 참조 해석 → **우리 개역한글 본문**.
// 지어낸 참조(도마복음)가 걸러지는지, 같은 물음을 두 번 물으면 한 번만 나가는지도 본다.
// 화면 도막 자체는 로그인 뒤에만 서므로 여기서 그리지는 못한다.
const aiPipe = await ev(`(async () => {
  const m = await import('/src/services/bibleSearch.js');
  const b = await import('/src/services/bible.js');
  const books = await b.loadBibleIndex();
  let asked = 0;
  const fake = async () => { asked++;
    return '네 아래와 같아요 [{"ref":"빌립보서 4:6","why":"염려 대신 기도"},{"ref":"도마복음 1:1","why":"없는 책"}] 도움이 되길!'; };
  const first = await m.aiBibleSearch('불안할 때 어떻게 하나요', books, b.loadBook, fake);
  const again = await m.aiBibleSearch('  불안할 때  어떻게 하나요  ', books, b.loadBook, fake);
  // 공유 캐시(0057)를 흉내 낸 그릇 — 남이 이미 물어본 말이면 AI를 부르지 않아야 한다
  const shared = new Map([['감사란 무엇인가', ['시편 100:4']]]);
  const store = { get: async (k) => shared.get(k) || null, set: async (k, refs) => { shared.set(k, refs); } };
  let asked2 = 0;
  const fake2 = async () => { asked2++; return '["빌립보서 4:6"]'; };
  const hit = await m.aiBibleSearch('  감사란   무엇인가 ', books, b.loadBook, fake2, store);
  const miss = await m.aiBibleSearch('낙심할 때', books, b.loadBook, fake2, store);
  return { n: first.length, label: m.hitLabel(first[0] || null), hasWhy: ('why' in (first[0] || {})),
           text: ((first[0] || {}).text || '').slice(0, 10), asked, cachedN: again.length,
           cachedLabel: m.hitLabel(hit[0] || null), askedAfterCache: asked2,
           storedMiss: (shared.get('낙심할 때') || []).length, missN: miss.length };
})()`, true);
check('AI가 준 참조를 우리 본문으로 확인해 한 줄로 만든다',
  aiPipe.n === 1 && aiPipe.label === '빌립보서 4:6' && !aiPipe.hasWhy
  && aiPipe.text === '아무 것도 염려하지', JSON.stringify(aiPipe));
check('지어낸 참조는 화면까지 오지 않는다', aiPipe.n === 1, JSON.stringify(aiPipe));
check('같은 물음은 한 번만 묻는다', aiPipe.asked === 1 && aiPipe.cachedN === 1, JSON.stringify(aiPipe));
// 0057 — 캐시는 사람들 사이에 공유된다. 열쇠는 normalizeQuery이므로 공백·대소문자가
// 달라도 같은 행을 맞힌다. 없는 물음은 AI에 한 번 나가고 그 답이 캐시에 남는다.
check('남이 물어본 말이면 AI를 부르지 않는다',
  aiPipe.cachedLabel === '시편 100:4' && aiPipe.askedAfterCache === 1 && aiPipe.missN === 1,
  JSON.stringify(aiPipe));
check('새로 물어본 답은 캐시에 남긴다', aiPipe.storedMiss === 1, JSON.stringify(aiPipe));

// AI 도막의 머리줄(사용자 피드백 2026-09-09 — "'감사와 찬양 / 0건 / AI가 찾은 구절'로
// 나오는데 '감사와 찬양에 대해 AI가 찾은 구절 N건'으로"). 화면 도막은 로그인 뒤에만 서므로
// 여기서는 **머리줄을 정하는 순수 함수**(wordBible.searchHeads)에 흉내 낸 모델 답의
// 결과를 그대로 넣어 본다 — 낱말 0건인데 AI가 답을 들고 있으면 '0건' 줄이 없어야 한다.
// **되돌리기**: keyword를 늘 세우게 만들면 첫 줄이, 제목에서 검색어를 빼면 둘째 줄이 깨진다.
const aiHead = await ev(`(async () => {
  const s = await import('/src/services/bibleSearch.js');
  const b = await import('/src/services/bible.js');
  const w = await import('/src/components/wordBible.jsx');
  const books = await b.loadBibleIndex();
  const fake = async () => '[{"ref":"빌립보서 4:6","why":"염려 대신 기도"},{"ref":"시편 23:1","why":"목자 되심"}]';
  const hits = await s.aiBibleSearch('감사와 찬양', books, b.loadBook, fake);
  const done = { done: 66, total: 66 };
  return { n: hits.length,
    zero: w.searchHeads({ query: '감사와 찬양', count: 0, progress: done, aiCount: hits.length }),
    wait: w.searchHeads({ query: '감사와 찬양', count: 0, progress: done, aiWait: true }),
    both: w.searchHeads({ query: '감사와 찬양', count: 3, progress: done, aiCount: hits.length }) };
})()`, true);
check('낱말이 0건인데 AI가 찾았으면 그 줄을 아예 안 세운다',
  aiHead.zero.keyword === null && aiHead.zero.empty === false, JSON.stringify(aiHead.zero));
check('AI 도막 머리줄이 검색어를 안고 건수까지 말한다',
  aiHead.n === 2 && aiHead.zero.ai.title === '감사와 찬양에 대해 AI가 찾은 구절'
  && aiHead.zero.ai.count === '2건', JSON.stringify(aiHead));
check('AI를 기다리는 동안에는 건수가 없다',
  aiHead.wait.ai.title === '감사와 찬양에 대해 AI가 찾은 구절' && aiHead.wait.ai.count === '',
  JSON.stringify(aiHead.wait));
check('낱말 결과가 있으면 두 머리줄이 다 선다',
  aiHead.both.keyword.title === '감사와 찬양' && aiHead.both.keyword.count === '3건' && !!aiHead.both.ai,
  JSON.stringify(aiHead.both));
await clickSel('button[data-hit]');
await sleep(1000);
const jumped = await ev(`(() => ({ head: (document.querySelector('h3')||{}).textContent || '',
  focus: (document.querySelector('[data-focus="1"]')||{}).textContent || '' }))()`);
check('결과를 누르면 그 장으로 간다', jumped.head === '창세기 1장' && jumped.focus.includes('태초에'),
  JSON.stringify(jumped));
// **강조는 3초 뒤에 꺼진다**(사용자 요청 2026-09-08 — 데려다주는 것이 목적이고, 그 뒤로도
// 테두리가 남아 있으면 그 절만 다른 글처럼 읽힌다). 여기까지 1초가 지났다.
check('도착 강조는 3초 뒤에 사라진다',
  (await ev(`(async () => { await new Promise(r => setTimeout(r, 2600));
    return !document.querySelector('[data-focus="1"]'); })()`, true)) === true);

// 못 찾았을 때의 빈 자리 — question 컷(사용자 결정 2026-09-03). 책 파일은 이미 받아 둔
// 것이라 두 번째 검색은 훑기만 한다.
await ev(`(() => {
  const i = document.querySelector('input[aria-label="어떤 본문을 찾으시나요?"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '없는말없는말');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
})()`);
const noHit = await ev(`(async () => {
  for (let i = 0; i < 90; i++) {
    if (!document.body.innerText.includes('훑는 중')) {
      const p = [...document.querySelectorAll('p')].find(x => x.textContent.includes('해당 단어는 찾지 못했어요'));
      if (p) {
        const svg = p.parentElement.querySelector('svg path.dc-draw');
        return { said: true, mark: !!svg };
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return { said: false, mark: false };
})()`, true);
check('둘 다 못 찾으면 한 줄로 말한다', noHit.said === true, JSON.stringify(noHit));
check('검색 빈 자리도 마크로 그린다', noHit.mark === true, JSON.stringify(noHit));

// **한 절에 여러 번 나오는 말은 다 표시한다.** 앞의 하나만 칠하면 뒤의 것은 안 찾은
// 글자처럼 읽힌다 — 창세기 1:27이 '하나님'을 두 번 담고 있다. 줄마다 글자에 실제로
// 몇 번 나오는지와 <mark> 개수를 견준다.
await ev(`(() => {
  const i = document.querySelector('input[aria-label="어떤 본문을 찾으시나요?"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '하나님');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
})()`);
const marksPerRow = await ev(`(async () => {
  for (let i = 0; i < 90; i++) {
    const rows = [...document.querySelectorAll('button[data-hit]')];
    if (rows.length >= 20) {
      const got = rows.map(r => {
        const txt = r.querySelectorAll('span')[1]?.textContent || '';
        return { want: txt.split('하나님').length - 1, got: r.querySelectorAll('mark').length };
      });
      return { rows: got.length, wrong: got.filter(x => x.want !== x.got).length,
               many: got.filter(x => x.want > 1).length };
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return { rows: 0, wrong: -1, many: 0 };
})()`, true);
check('한 절에 두 번 나오는 말은 두 번 다 표시된다',
  marksPerRow.rows > 0 && marksPerRow.many > 0 && marksPerRow.wrong === 0, JSON.stringify(marksPerRow));

// 상한(50건)에 걸린 자리 — 예전에는 '앞에서부터 50건'이었다. 훑기가 정경 순이라는 건
// 우리 사정이지 읽는 사람의 일이 아니어서 그냥 '50건'이다(사용자 피드백 2026-09-09).
const capHead = await ev(`(async () => {
  for (let i = 0; i < 60; i++) {
    const head = ${headSpans('[data-hits="keyword"]')};
    if (head[1] && !head[1].includes('훑는 중')) {
      return { head, rows: document.querySelectorAll('button[data-hit]').length,
               col: (document.querySelector('[data-col="search"]') || {}).innerText || '' };
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return { head: [], rows: 0, col: '' };
})()`, true);
check('상한에 걸려도 그냥 50건이라고 말한다',
  capHead.rows === 50 && capHead.head[1] === '50건' && !capHead.col.includes('앞에서부터'),
  JSON.stringify({ head: capHead.head, rows: capHead.rows }));

await clickSel('button[aria-label="검색어 지우기"]');
await sleep(600);

// ── 북마크·형광펜이 쌓였을 때 (2026-09-02) ─────────────────────────────────
// 여러 권에 걸쳐 심어 두고 다시 연다. 책으로 묶이는지 · 정경 순인지 ·
// 세 권부터는 접혀 있는지 · **펼친 책의 파일만 그때 받는지**를 본다.
// 두 목록은 이제 각자의 세그먼트에 있으므로 칸을 옮겨 가며 본다(4차 피드백 12).
// 리소스 타이밍은 새로 연 문서마다 비어 있으므로 앞의 전권 검색은 섞이지 않는다.
//
// **여기서는 미리 받기(warmBooks)를 끈다.** 안 끄면 리더에 들어온 2초 뒤에 66권이
// 통째로 날아와서 '펼친 책만 받는다'를 잴 수가 없다. 끄는 방법은 제품에 이미 있는
// 갈래다 — 데이터 아끼기(navigator.connection.saveData)를 켠 기기로 흉내 낸다.
// 그러니 이 두 줄이 그 갈래의 검사이기도 하다(saveData면 미리 받지 않는다).
// 앞에서 받아 둔 책은 Cache Storage에 남아 있으므로 통도 비운다 — 안 그러면 파일이
// 네트워크로 오지 않아 리소스 타이밍이 비어 있다.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: "Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });",
});
await ev(`(async () => { try { await caches.delete('bible-v1'); } catch (e) {} })()`, true);
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

// **펼침은 칸마다 따로다.** 북마크와 형광펜은 같은 자리에 그려지는 같은 부품이라
// 리액트가 칸을 옮겨도 state를 그대로 물려준다(§6-18과 같은 함정) — 열쇠에 칸 이름을
// 넣기 전에는 형광펜에서 편 창세기가 북마크에서도 펼쳐져 있었다. 창세기는 양쪽에 다
// 있으므로 이 책으로 잰다. 그리고 되돌아왔을 때 **내가 편 것은 그대로 남아야 한다**.
check('형광펜에서 창세기 묶음도 편다', await clickSel('[data-book-group="highlight:gen"]'));
await sleep(900);
await clickSel('[data-pane="bookmark"]');
await sleep(800);
const paneCarry = await ev(`(() => ({
  gen: (document.querySelector('[data-book-group="bookmark:gen"]') || {}).getAttribute?.('aria-expanded'),
  rows: [...document.querySelectorAll('[data-goto]')].length,
}))()`);
check('한 칸에서 편 책이 다른 칸까지 펼쳐지지 않는다',
  paneCarry.gen === 'false' && paneCarry.rows === 0, JSON.stringify(paneCarry));
await clickSel('[data-pane="highlight"]');
await sleep(800);
const paneBack = await ev(`(() => [...document.querySelectorAll('[data-book-group]')]
  .map(b => b.dataset.bookGroup + '=' + b.getAttribute('aria-expanded')).join(','))()`);
check('제 칸으로 돌아오면 펴 둔 책이 그대로다',
  paneBack === 'highlight:gen=true,highlight:exo=false,highlight:jhn=true', paneBack);

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
// 데이터 아끼기를 켠 기기에서는 미리 받기가 아예 안 돈다 — 위 두 검사가 그것에 기대고 있다
check('데이터 아끼기를 켜면 미리 받지 않는다',
  !bmOpen.files.includes('exo.json') && !bmOpen.files.includes('rev.json'), JSON.stringify(bmOpen.files));

// **북마크 줄은 눌리는 판이 보인다**(사용자 지적 2026-09-08 — "북마크 쪽에 여백이 너무
// 커서 어딜 눌러야 해당 북마크된 장으로 넘어갈 수 있을지가 안 잡힌다"). 형광펜 줄은
// 절 미리보기가 줄을 채우는데 북마크 줄은 '23장' 넉 자뿐이라 오른쪽이 통째로 비었다.
const bmChip = await ev(`(() => {
  const b = document.querySelector('[data-goto="psa 23"]');
  if (!b) return null;
  const cs = getComputedStyle(b);
  const row = b.parentElement.getBoundingClientRect(), me = b.getBoundingClientRect();
  return { bg: cs.backgroundColor, radius: cs.borderRadius, rest: Math.round(row.width - me.width) };
})()`);
check('북마크 줄에 옅은 판이 깔린다',
  !!bmChip && bmChip.bg !== 'rgba(0, 0, 0, 0)' && bmChip.bg !== 'transparent', JSON.stringify(bmChip));
check('줄 전체가 그 장으로 가는 버튼이다(오른쪽 × 자리만 뺀다)',
  !!bmChip && bmChip.rest > 0 && bmChip.rest <= 34, JSON.stringify(bmChip));

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
             .every(b => b.getBoundingClientRect().right <= d.clientWidth + 1),
           tool: (() => {
             const left = document.querySelector('[data-note-tools="left"]');
             const right = document.querySelector('[data-note-tools="right"]');
             const col = document.querySelector('[data-col="qt"]');
             if (!left || !right || !col) return null;
             const l = left.getBoundingClientRect(), r = right.getBoundingClientRect(), c = col.getBoundingClientRect();
             return { sameRow: Math.abs(l.top - r.top) < 6, below: Math.round(r.top - l.bottom),
                      leftGap: Math.round(r.left - c.left), rightGap: Math.round(c.right - r.right) };
           })() };
})()`);
check('모바일 375px에서 가로로 넘치지 않는다', mob.over === false, JSON.stringify(mob));
check('모바일에서도 본문과 묵상 칸이 뜬다', mob.verses > 0 && mob.seg && mob.tiptap, JSON.stringify(mob));
check('모바일에서 날짜 줄과 공유 토글이 화면 안에 든다',
  mob.dateFits === true && mob.share === true, JSON.stringify(mob));
// C2(2026-09-07) — 375px에서 토글만 다음 줄로 떨어져 오른쪽에 혼자 서던 자리.
// 이제 640 미만에서는 토글 묶음이 **한 줄을 통째로** 받고 열의 좌우 선에 맞는다.
check('375px에서 공유 토글 묶음이 다음 줄에서 열 폭을 받는다',
  !!mob.tool && mob.tool.sameRow === false && mob.tool.below >= 2 && mob.tool.below <= 16
  && Math.abs(mob.tool.leftGap) <= 1 && Math.abs(mob.tool.rightGap) <= 1,
  JSON.stringify(mob.tool));
// 종이 안에서 쓰는 노트 — **375에서는 라벨이 칸 위에 선다**(사용자 결정 2026-09-10).
// 58px을 떼고 나면 글 칸에 한 줄 대여섯 글자가 들어간다(index.css `.note-paper` 아래
// 미디어 쿼리). 데스크톱에서는 같은 행이다(8-a-2).
// **되돌리기**: 그 미디어 쿼리를 지우면 라벨이 다시 옆으로 붙어 이 줄이 깨진다.
const mobLabel = await ev(`(() => {
  const t = document.querySelector('.qt-note-editor .tiptap');
  const h = t && t.querySelector('h3');
  const next = h && h.nextElementSibling;
  if (!h || !next) return null;
  const a = h.getBoundingClientRect(), b = next.getBoundingClientRect();
  return { below: Math.round(b.top - a.bottom), sameLeft: Math.abs(b.left - a.left) <= 1,
           cols: getComputedStyle(t).gridTemplateColumns };
})()`);
check('375px에서 도막 라벨이 쓰는 칸 위에 선다',
  !!mobLabel && mobLabel.below >= 0 && mobLabel.sameLeft === true && !/^58px /.test(mobLabel.cols),
  JSON.stringify(mobLabel));
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
  // 640 위에서는 도구 줄이 한 줄이고 토글 묶음이 열의 오른쪽 선에 붙는다(C2)
  const tool = await ev(`(() => {
    const left = document.querySelector('[data-note-tools="left"]');
    const right = document.querySelector('[data-note-tools="right"]');
    const col = document.querySelector('[data-col="qt"]');
    if (!left || !right || !col) return null;
    const l = left.getBoundingClientRect(), r = right.getBoundingClientRect(), c = col.getBoundingClientRect();
    return { sameRow: Math.abs(l.top - r.top) < 6, rightGap: Math.round(c.right - r.right),
             leftGap: Math.round(l.left - c.left) };
  })()`);
  check(`${w}px 도구 줄이 한 줄에 서고 좌우 선에 맞는다`,
    !!tool && tool.sameRow === true && Math.abs(tool.rightGap) <= 1 && Math.abs(tool.leftGap) <= 1,
    JSON.stringify(tool));
  // 잔디 칸도 자기 트랙을 다 쓴다 — 1024부터는 옆 칸(300px), 그 아래에서는 한 열이다
  const grassFit = await colFit('[data-col="grass"]');
  check(`${w}px 내 기록 칸이 자리를 다 쓴다`, fits(grassFit), JSON.stringify(grassFit));

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
// **캐시 통을 먼저 비운다** — 안 비우면 앞에서 받아 둔 책이 Cache Storage에서 나와
// fetch를 막아도 본문이 그려진다(services/bible.js). 새로고침 **전에** 비워야 한다 —
// 뒤에 비우면 앱이 뜨자마자 이어읽기 장을 캐시에서 꺼내 가는 것과 경주가 된다.
// 미리 받기는 위에서 심어 둔 데이터 아끼기 흉내가 여전히 막고 있다.
await ev(`(async () => { try { await caches.delete('bible-v1'); } catch (e) {} })()`, true);
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
