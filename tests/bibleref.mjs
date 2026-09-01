// 구절 참조 파서 검사 — 서버 불필요(순수 로직 + 커밋된 데이터만 읽는다)
// 실행: node tests/bibleref.mjs
import { readFileSync } from 'node:fs';
import { parseRef, versesInRef, formatRef } from '../src/services/bibleRef.js';

const books = JSON.parse(readFileSync(new URL('../public/bible/index.json', import.meta.url)));
const book = (id) => JSON.parse(readFileSync(new URL(`../public/bible/${id}.json`, import.meta.url)));

let fails = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}\n  got  ${g}\n  want ${w}`); fails++; }
};

check('절 범위', parseRef('이사야 32:9-20', books),
  { bookId: 'isa', start: { chapter: 32, verse: 9 }, end: { chapter: 32, verse: 20 } });
check('장 전체(편)', parseRef('시편 121편', books),
  { bookId: 'psa', start: { chapter: 121, verse: null }, end: { chapter: 121, verse: null } });
check('약칭 한 절', parseRef('요 3:16', books),
  { bookId: 'jhn', start: { chapter: 3, verse: 16 }, end: { chapter: 3, verse: 16 } });
check('장을 건너는 범위', parseRef('여호수아 3:14-4:24', books),
  { bookId: 'jos', start: { chapter: 3, verse: 14 }, end: { chapter: 4, verse: 24 } });
check('장 범위', parseRef('창 1-2장', books),
  { bookId: 'gen', start: { chapter: 1, verse: null }, end: { chapter: 2, verse: null } });
check('절 접미', parseRef('시편 121편은 없고 이건 못 읽는다', books), null);
check('아가가 아모스를 밟지 않는다', parseRef('아모스 5:24', books).bookId, 'amo');
check('요한일서와 요한복음', parseRef('요일 1:9', books).bookId, '1jn');
check('공백 무시', parseRef('여호수아4:1-14', books),
  parseRef('여호수아 4 : 1 - 14', books));
check('모르는 책은 null', parseRef('도마복음 1:1', books), null);

const gen = book('gen');
check('장 전체 절 수', versesInRef(gen, parseRef('창세기 1', books)).length, 31);
check('절 범위 절 수', versesInRef(gen, parseRef('창세기 1:1-3', books)).length, 3);
const cross = versesInRef(book('jos'), parseRef('여호수아 3:14-4:24', books));
check('건너는 범위 양끝', [cross[0].chapter, cross[0].verse, cross.at(-1).chapter, cross.at(-1).verse],
  [3, 14, 4, 24]);
check('범위를 벗어나면 잘린다', versesInRef(gen, parseRef('창세기 1:29-40', books)).length, 3);
check('formatRef 왕복', formatRef(parseRef('이사야 32:9-20', books), books), '이사야 32:9-20');

if (fails) { console.log(`\n${fails}개 실패`); process.exit(1); }
console.log('\n구절 파서 이상 없음');
