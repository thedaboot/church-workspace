// ============================================================================
// 성경 본문 데이터 맞춰보기 (개역한글)
// ----------------------------------------------------------------------------
//   node scripts/bible_check.mjs        # 어긋난 것을 보여준다 (아무것도 안 고침)
//
// 왜 필요한가: public/bible/*.json은 밖에서 받아 한 번 변환해 넣은 정적 데이터라
// 코드 검사가 닿지 않는다. 변환이 어긋나거나 파일이 하나 빠져도 앱은 조용히
// 빈 장을 그린다. 그것을 푸시 전에 잡는다.
//
// 무엇을 보는가:
//   ① index.json에 66권이 정경 순서로 있고 파일이 다 있는가
//   ② 각 권의 장 수가 정경 장 수표(아래 BOOKS)와 같은가
//   ③ 빈 절·빈 장이 없는가 (절은 문자열, 장은 절 배열)
//   ④ 총 절 수가 31,000~31,200인가 (개역한글 31,103절)
//   ⑤ 스팟 체크 — 창 1:1 전문, 요 3:16의 "독생자",
//      그리고 개역한글인지(창 1:3 "가라사대"). 개역개정은 "이르시되"라
//      저작권이 살아 있는 판을 잘못 넣으면 여기서 걸린다.
//
// 절 번호는 배열 인덱스+1이다. (없음)·(N절에 포함되어 있음)은 대한성서공회의
// 편집 표기라 본문으로 친다 — 지우면 그 뒤 절 번호가 통째로 밀린다.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = fileURLToPath(new URL('../public/bible/', import.meta.url));

// 정경 순서 · 장 수: [id, 이름, 장 수]
const BOOKS = [
  ['gen', '창세기', 50], ['exo', '출애굽기', 40], ['lev', '레위기', 27],
  ['num', '민수기', 36], ['deu', '신명기', 34], ['jos', '여호수아', 24],
  ['jdg', '사사기', 21], ['rut', '룻기', 4], ['1sa', '사무엘상', 31],
  ['2sa', '사무엘하', 24], ['1ki', '열왕기상', 22], ['2ki', '열왕기하', 25],
  ['1ch', '역대상', 29], ['2ch', '역대하', 36], ['ezr', '에스라', 10],
  ['neh', '느헤미야', 13], ['est', '에스더', 10], ['job', '욥기', 42],
  ['psa', '시편', 150], ['pro', '잠언', 31], ['ecc', '전도서', 12],
  ['sng', '아가', 8], ['isa', '이사야', 66], ['jer', '예레미야', 52],
  ['lam', '예레미야애가', 5], ['ezk', '에스겔', 48], ['dan', '다니엘', 12],
  ['hos', '호세아', 14], ['jol', '요엘', 3], ['amo', '아모스', 9],
  ['oba', '오바댜', 1], ['jon', '요나', 4], ['mic', '미가', 7],
  ['nam', '나훔', 3], ['hab', '하박국', 3], ['zep', '스바냐', 3],
  ['hag', '학개', 2], ['zec', '스가랴', 14], ['mal', '말라기', 4],
  ['mat', '마태복음', 28], ['mrk', '마가복음', 16], ['luk', '누가복음', 24],
  ['jhn', '요한복음', 21], ['act', '사도행전', 28], ['rom', '로마서', 16],
  ['1co', '고린도전서', 16], ['2co', '고린도후서', 13], ['gal', '갈라디아서', 6],
  ['eph', '에베소서', 6], ['php', '빌립보서', 4], ['col', '골로새서', 4],
  ['1th', '데살로니가전서', 5], ['2th', '데살로니가후서', 3], ['1ti', '디모데전서', 6],
  ['2ti', '디모데후서', 4], ['tit', '디도서', 3], ['phm', '빌레몬서', 1],
  ['heb', '히브리서', 13], ['jas', '야고보서', 5], ['1pe', '베드로전서', 5],
  ['2pe', '베드로후서', 3], ['1jn', '요한일서', 5], ['2jn', '요한이서', 1],
  ['3jn', '요한삼서', 1], ['jud', '유다서', 1], ['rev', '요한계시록', 22],
];

const VERSE_MIN = 31000;
const VERSE_MAX = 31200;

const problems = [];
const bad = (msg) => problems.push(msg);

function readJson(name) {
  const file = path.join(DIR, name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    bad(`${name}을 읽지 못했어요: ${e.message}`);
    return null;
  }
}

// ── ① 목록 ────────────────────────────────────────────────────────────────
const index = readJson('index.json');
if (!Array.isArray(index)) {
  bad('index.json이 없거나 배열이 아니에요.');
} else if (index.length !== 66) {
  bad(`index.json에 ${index.length}권이 있어요. 66권이어야 해요.`);
} else {
  BOOKS.forEach(([id, name, chapters], i) => {
    const row = index[i];
    if (!row || typeof row !== 'object') return bad(`index.json ${i + 1}번째 항목이 비었어요.`);
    if (row.id !== id) bad(`index.json ${i + 1}번째 id가 "${row.id}"예요. "${id}"여야 해요 (정경 순서).`);
    if (row.name !== name) bad(`${id}: index.json 이름이 "${row.name}"예요. "${name}"이어야 해요.`);
    if (!row.abbr) bad(`${id}: index.json에 약자(abbr)가 없어요.`);
    if (row.chapters !== chapters) bad(`${id}: index.json 장 수가 ${row.chapters}예요. ${chapters}여야 해요.`);
  });
}

// ── ②③ 책마다 ────────────────────────────────────────────────────────────
let totalVerses = 0;
let totalChapters = 0;

for (const [id, name, chapters] of BOOKS) {
  const book = readJson(`${id}.json`);
  if (!book) { bad(`${id}.json이 없어요 (${name}).`); continue; }

  if (book.id !== id) bad(`${id}.json의 id가 "${book.id}"예요.`);
  if (book.name !== name) bad(`${id}.json의 이름이 "${book.name}"예요. "${name}"이어야 해요.`);

  if (!Array.isArray(book.chapters)) { bad(`${id}.json의 chapters가 배열이 아니에요.`); continue; }
  if (book.chapters.length !== chapters) {
    bad(`${name}(${id}): ${book.chapters.length}장이 있어요. 정경은 ${chapters}장이에요.`);
  }
  totalChapters += book.chapters.length;

  book.chapters.forEach((verses, ci) => {
    if (!Array.isArray(verses) || verses.length === 0) {
      return bad(`${name} ${ci + 1}장이 비었어요.`);
    }
    totalVerses += verses.length;
    verses.forEach((t, vi) => {
      if (typeof t !== 'string') bad(`${name} ${ci + 1}:${vi + 1}이 문자열이 아니에요.`);
      else if (!t.trim()) bad(`${name} ${ci + 1}:${vi + 1}이 빈 절이에요.`);
    });
  });
}

// ── ④ 총 절 수 ────────────────────────────────────────────────────────────
if (totalVerses < VERSE_MIN || totalVerses > VERSE_MAX) {
  bad(`총 ${totalVerses.toLocaleString()}절이에요. ${VERSE_MIN.toLocaleString()}~${VERSE_MAX.toLocaleString()} 사이여야 해요 (개역한글 약 31,100절).`);
}

// ── ⑤ 스팟 체크 ───────────────────────────────────────────────────────────
const verse = (id, c, v) => readJson(`${id}.json`)?.chapters?.[c - 1]?.[v - 1];

const gen11 = verse('gen', 1, 1);
if (gen11 !== '태초에 하나님이 천지를 창조하시니라') {
  bad(`창세기 1:1이 "${gen11}"예요. "태초에 하나님이 천지를 창조하시니라"여야 해요.`);
}

const jhn316 = verse('jhn', 3, 16);
if (!jhn316?.includes('독생자')) {
  bad(`요한복음 3:16에 "독생자"가 없어요: "${jhn316}"`);
}

// 개역한글은 "가라사대", 개역개정은 "이르시되" — 판을 가른다.
const gen13 = verse('gen', 1, 3);
if (!gen13?.includes('가라사대')) {
  bad(`창세기 1:3에 "가라사대"가 없어요. 개역한글이 아닌 판일 수 있어요: "${gen13}"`);
}

// ── 결과 ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ ${problems.length}건 어긋났어요.\n`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

console.log('✓ 성경 본문 데이터 이상 없어요.');
console.log(`  66권 · ${totalChapters.toLocaleString()}장 · ${totalVerses.toLocaleString()}절`);
