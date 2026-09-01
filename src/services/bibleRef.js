// ============================================================================
// 구절 참조 파서 — '이사야 32:9-20' 같은 글을 {bookId, start, end}로 (docs/V2.md §2)
// ----------------------------------------------------------------------------
// 주보의 본문 구절·QT 본문표·성경 읽기 이동이 전부 이 한 벌을 쓴다.
// 순수 함수(.js) — 책 목록(public/bible/index.json)을 인자로 받아서 브라우저 없이
// 노드에서 바로 검사한다(tests/bibleref.mjs). 못 읽는 문자열은 null(안전한 실패) —
// 화면은 그냥 글자로 보여주면 된다.
// ============================================================================

// 받는 형태(공백은 전부 무시한다 — 검색 공백 무시와 같은 정신, §6-20):
//   '이사야 32:9-20' · '창세기 1' · '시편 121편' · '요 3:16' · '여호수아 3:14-4:24'
//   · '시편 121편 1-3절' · '창 1-2장'
export function parseRef(input, books) {
  if (!input || !books || !books.length) return null;
  const s = String(input).replace(/\s+/g, '');
  // 책 — 이름·약칭 중 문자열 머리와 일치하는 **가장 긴 것**('아가'가 '아'를 이긴다)
  let bookId = null, keyLen = 0;
  for (const b of books) {
    for (const key of [b.name, b.abbr]) {
      if (key && key.length > keyLen && s.startsWith(key)) { bookId = b.id; keyLen = key.length; }
    }
  }
  if (!bookId) return null;
  const m = s.slice(keyLen).match(
    /^(\d+)(?:장|편)?(?::(\d+))?(?:[-~–—](\d+)(?::(\d+))?(?:장|편)?)?(?:절)?$/
  );
  if (!m) return null;
  const c1 = +m[1];
  const v1 = m[2] ? +m[2] : null;
  let c2 = c1, v2 = v1;
  if (m[3] != null) {
    if (m[4] != null) { c2 = +m[3]; v2 = +m[4]; }   // 3:14-4:24 (장을 건너는 범위)
    else if (v1 != null) { v2 = +m[3]; }             // 4:1-14   (같은 장 절 범위)
    else { c2 = +m[3]; v2 = null; }                  // 1-2장    (장 범위)
  }
  return { bookId, start: { chapter: c1, verse: v1 }, end: { chapter: c2, verse: v2 } };
}

// 참조가 가리키는 절들 — [{chapter, verse, text}]. verse가 null이면 그 장 전체.
// 범위를 벗어난 장·절은 조용히 잘린다(데이터가 진실이다).
export function versesInRef(book, ref) {
  if (!book?.chapters || !ref) return [];
  const out = [];
  const last = book.chapters.length;
  const cFrom = Math.max(1, ref.start.chapter);
  const cTo = Math.min(last, ref.end.chapter);
  for (let c = cFrom; c <= cTo; c++) {
    const verses = book.chapters[c - 1] || [];
    let vFrom = 1, vTo = verses.length;
    if (c === ref.start.chapter && ref.start.verse) vFrom = ref.start.verse;
    if (c === ref.end.chapter && ref.end.verse) vTo = Math.min(vTo, ref.end.verse);
    for (let v = vFrom; v <= vTo; v++) {
      if (verses[v - 1] != null) out.push({ chapter: c, verse: v, text: verses[v - 1] });
    }
  }
  return out;
}

// 참조를 사람이 읽는 글로 — '이사야 32:9-20' (주보·북마크 라벨용)
export function formatRef(ref, books) {
  const b = books?.find(x => x.id === ref?.bookId);
  if (!b) return '';
  const { start: s, end: e } = ref;
  if (s.verse == null && e.verse == null)
    return s.chapter === e.chapter ? `${b.name} ${s.chapter}장` : `${b.name} ${s.chapter}-${e.chapter}장`;
  if (s.chapter === e.chapter)
    return s.verse === e.verse ? `${b.name} ${s.chapter}:${s.verse}` : `${b.name} ${s.chapter}:${s.verse}-${e.verse}`;
  return `${b.name} ${s.chapter}:${s.verse ?? 1}-${e.chapter}:${e.verse ?? ''}`.replace(/-$/, '');
}
