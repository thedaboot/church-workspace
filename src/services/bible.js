import { parseRef, versesInRef } from './bibleRef.js';

// ============================================================================
// 성경 본문 로더 — public/bible/*.json(개역한글, 책 단위 청크)을 캐시하며 읽는다
// ----------------------------------------------------------------------------
// 데이터는 정적 파일이라 게스트 모드에서도 전부 동작한다(브라우저 스위트가 리더를
// 그대로 검사할 수 있다). 정합은 scripts/bible_check.mjs가 본다.
// '(없음)' 같은 괄호 표기는 개역한글의 편집 표기라 데이터에 그대로 있다 —
// 지우면 절 번호가 밀리므로 **거르려면 화면에서** 거른다(public/bible/README.md).
// ============================================================================

let indexPromise = null;
const bookCache = new Map();

export function loadBibleIndex() {
  if (!indexPromise) {
    indexPromise = fetch('/bible/index.json').then(r => {
      if (!r.ok) throw new Error(`bible index ${r.status}`);
      return r.json();
    }).catch(err => { indexPromise = null; throw err; });
  }
  return indexPromise;
}

export function loadBook(id) {
  if (!bookCache.has(id)) {
    const p = fetch(`/bible/${id}.json`).then(r => {
      if (!r.ok) throw new Error(`bible book ${id} ${r.status}`);
      return r.json();
    }).catch(err => { bookCache.delete(id); throw err; });
    bookCache.set(id, p);
  }
  return bookCache.get(id);
}

// 참조 문자열 하나로 본문까지 — { ref, book, verses } 또는 null(못 읽는 참조)
export async function loadPassage(refStr) {
  const books = await loadBibleIndex();
  const ref = parseRef(refStr, books);
  if (!ref) return null;
  const book = await loadBook(ref.bookId);
  return { ref, book, verses: versesInRef(book, ref) };
}
