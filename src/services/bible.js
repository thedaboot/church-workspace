import { parseRef, versesInRef } from './bibleRef.js';

// ============================================================================
// 성경 본문 로더 — public/bible/*.json(개역한글, 책 단위 청크)을 캐시하며 읽는다
// ----------------------------------------------------------------------------
// 데이터는 정적 파일이라 게스트 모드에서도 전부 동작한다(브라우저 스위트가 리더를
// 그대로 검사할 수 있다). 정합은 scripts/bible_check.mjs가 본다.
// '(없음)' 같은 괄호 표기는 개역한글의 편집 표기라 데이터에 그대로 있다 —
// 지우면 절 번호가 밀리므로 **거르려면 화면에서** 거른다(public/bible/README.md).
//
// 캐시는 두 겹이다(사용자 요청 2026-09-08 — "검색 속도 개선, 첫 검색에서 모든 권을 다
// 훑고 있음"):
//   ① 메모리(bookCache) — 이 탭이 사는 동안. 같은 장을 오가는 데 쓰인다.
//   ② Cache Storage — **새로고침·다음 방문까지 남는다.** 전권이 4.5MB라 첫 검색이 곧
//      4.5MB 내려받기였고, 그 값이 새로고침 한 번에 통째로 날아갔다. 응답을 그대로
//      담아 두면 두 번째부터는 네트워크가 없다.
//      비공개 모드·http 같은 자리에는 `caches`가 아예 없거나 열다가 던지므로 **전부
//      try/catch로 감싸고 없으면 그냥 fetch한다** — 캐시는 빠르라고 있는 것이지
//      없으면 안 도는 것이 아니다.
// ============================================================================

// 캐시 통 이름 — **본문 데이터를 갈아 끼우면 이 숫자를 올린다.** 안 올리면 옛 파일을
// 들고 있는 기기가 새 본문을 영영 못 본다(Cache Storage에는 만료가 없다).
const CACHE_NAME = 'bible-v1';
// 동시에 띄우는 요청 수. 66권을 하나씩 기다리면 왕복이 66번 줄줄이 선다(첫 검색이
// 수십 초였던 진짜 이유). 브라우저의 호스트당 동시 연결이 6이라 그보다 크게 잡아도
// 줄만 서고, 작게 잡으면 그만큼 놀린다.
export const POOL = 6;
// 리더에 들어온 뒤 이만큼 지나면 남은 책을 미리 받아 둔다(warmBooks)
const WARM_DELAY = 2000;

let indexPromise = null;
const bookCache = new Map();

// 캐시 통 — 없거나 못 열면 null이다. 한 번 정해지면 그대로 쓴다.
let boxPromise;
function cacheBox() {
  if (boxPromise === undefined) {
    try {
      boxPromise = typeof caches !== 'undefined' && caches?.open
        ? caches.open(CACHE_NAME).catch(() => null)
        : Promise.resolve(null);
    } catch { boxPromise = Promise.resolve(null); }
  }
  return boxPromise;
}

// 캐시를 먼저 보고, 없으면 받아서 담는다. 담기는 실패해도 조용히 넘어간다
// (자리가 꽉 찼거나 통이 사라진 경우 — 그래도 값은 돌려줘야 화면이 그려진다).
async function fetchJson(url, what) {
  const box = await cacheBox();
  if (box) {
    try {
      const hit = await box.match(url);
      if (hit) return await hit.json();
    } catch { /* 캐시가 이상하면 그냥 받는다 */ }
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${what} ${r.status}`);
  // **읽기 전에 복제한다** — 응답 본문은 한 번만 읽을 수 있다
  const copy = box ? r.clone() : null;
  const data = await r.json();
  if (copy) { try { box.put(url, copy); } catch { /* 무시 */ } }
  return data;
}

export function loadBibleIndex() {
  if (!indexPromise) {
    indexPromise = fetchJson('/bible/index.json', 'bible index')
      .catch(err => { indexPromise = null; throw err; });
  }
  return indexPromise;
}

export function loadBook(id) {
  if (!bookCache.has(id)) {
    const p = fetchJson(`/bible/${id}.json`, `bible book ${id}`)
      .catch(err => { bookCache.delete(id); throw err; });
    bookCache.set(id, p);
  }
  return bookCache.get(id);
}

// ── 여럿을 동시에, 결과는 순서대로 ──────────────────────────────────────────
// load(item, i)를 최대 limit개까지 **동시에** 돌리되, use(값, item, i)는 **들어온
// 차례대로** 딱 한 번씩 부른다. 검색이 이걸 쓴다 — 받는 것은 겹치게 하고 훑는 것은
// 정경 순으로 남겨야 결과 줄과 50건에서 잘리는 자리가 뒤섞이지 않는다(화면 문구는 `N건`뿐 — 2026-09-09).
// use가 false를 돌려주면 거기서 멈춘다(결과 상한·검색어가 바뀐 경우).
// 실패한 항목은 null로 온다 — 한 권을 못 받아도 나머지는 훑어야 한다.
export async function forEachPool(items, limit, load, use) {
  const list = items || [];
  const n = list.length;
  const cap = Math.max(1, Math.min(limit || 1, n));
  const jobs = new Array(n);
  const kick = (i) => {
    if (i >= n || jobs[i]) return;
    jobs[i] = Promise.resolve().then(() => load(list[i], i)).catch(() => null);
  };
  for (let i = 0; i < cap; i++) kick(i);
  for (let i = 0; i < n; i++) {
    const value = await jobs[i];
    // 하나가 끝났으니 창을 한 칸 민다 — 이 자리가 아니면 동시 수가 줄어든다
    kick(i + cap);
    if ((await use(value, list[i], i)) === false) return;
  }
}

// 리더에 들어오면 남은 책을 조용히 받아 둔다 — 첫 검색이 곧 4.5MB 내려받기였다.
// **한 번만 돈다**(모듈 수준 표식). 데이터 아끼기(saveData)를 켠 기기에서는 하지 않는다.
// 돌려주는 함수를 언마운트에서 부르면 아직 안 시작한 예약은 취소되고, 도는 중이면
// 다음 책부터 멈춘다.
let warmed = false;
export function warmBooks(books) {
  if (warmed || !books?.length) return () => {};
  try {
    if (typeof navigator !== 'undefined' && navigator.connection?.saveData) return () => {};
  } catch { /* 무시 */ }
  let alive = true;
  const timer = setTimeout(() => {
    if (!alive) return;
    warmed = true;
    forEachPool(books, POOL, b => loadBook(b.id).catch(() => null), () => (alive ? undefined : false));
  }, WARM_DELAY);
  return () => { alive = false; clearTimeout(timer); };
}

// 참조 문자열 하나로 본문까지 — { ref, book, verses } 또는 null(못 읽는 참조)
export async function loadPassage(refStr) {
  const books = await loadBibleIndex();
  const ref = parseRef(refStr, books);
  if (!ref) return null;
  const book = await loadBook(ref.bookId);
  return { ref, book, verses: versesInRef(book, ref) };
}
