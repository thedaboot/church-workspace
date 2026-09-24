// ============================================================================
// pdf.js 6이 **확인 없이 그냥 쓰는** 최신 표준 메서드 채우기 (2026-09-13)
// ----------------------------------------------------------------------------
// 없으면 PDF가 한 장도 안 그려지고 "a.toHex is not a function"·"…getOrInsertComputed
// is not a function"으로 끝난다(크롬 131에서 실제로 재현·확인했다).
//
// 무엇이 언제부터 있나 — **가장 늦은 것이 이 앱의 PDF 하한선**이다:
//   Uint8Array toHex·toBase64·fromBase64   크롬 140 · 사파리 18.2 · 파이어폭스 133
//   Map/WeakMap getOrInsertComputed        크롬 138 · 사파리 26 · 파이어폭스 139
//   Response/Blob bytes()                  크롬 133 · 사파리 18.2 · 파이어폭스 133
// 즉 **iOS 18(사파리 18.x)에서는 첨부 PDF가 통째로 막혀 있었다** — 업데이트가 멈춘
// 안드로이드 크롬·삼성 인터넷·낡은 시스템 웹뷰도 마찬가지다. 화면에는 "미리보기를
// 그릴 수 없어요"만 뜨므로 쓰는 사람은 파일이 잘못된 줄 안다.
// (pdf.js가 쓰는 나머지 최신 API — `Promise.withResolvers`·`Object.hasOwn`·
//  `Set.intersection`·`Array.findLast`·`.at`·`replaceAll` — 는 그 하한선 아래에서도
//  이미 있다. 크롬 131에서 하나씩 확인했다.)
//
// **앱 쪽과 워커 쪽 두 군데서 먼저 실행돼야 한다** — pdf.worker는 다른 전역이라
// 여기서 채운 것이 저절로 따라가지 않는다. 그래서 워커 껍데기(pdfWorkerEntry.js)가
// 이 파일을 먼저 import한다. 앱 쪽은 PdfView.jsx가 import한다.
//
// 이미 있는 브라우저에서는 아무것도 하지 않는다(네이티브가 언제나 더 빠르다).
// 새 판으로 올린 뒤 PDF가 안 열리면 **여기에 빠진 메서드가 또 있는지부터** 보세요.
//
// **6.3(2026-09-24 보안 업그레이드)에서 하나가 더 늘었다 — 이번 것은 모듈을 통째로 죽인다.**
// pdf.mjs·pdf.worker.mjs가 **모듈 맨 위에서** `typeof Iterator.prototype.join`을 본다. `Iterator`
// 전역이 없는 브라우저(크롬 122 · 사파리 18.4 · 파이어폭스 131 미만)에서는 그 줄이 ReferenceError라
// PDF 모듈이 불러와지지도 않는다. 그래서 `Iterator` 전역을 세우고(모든 내장 이터레이터가 이미
// 물려받는 %IteratorPrototype%을 가리키게 — 새 객체를 만들면 Map·Set의 이터레이터가 못 본다),
// pdf.js가 이터레이터에 부르는 도우미(filter·some·find·map·forEach·toArray·join)를 채운다.
// 같은 김에 6.x가 확인 없이 쓰는 둘도 채운다 — `Promise.try`(워커 메시지 처리가 전부 이것이다 ·
// 크롬 128 · 사파리 18.2 미만에 없다)와 `Math.sumPrecise`(워커 글자 배치 · 아직 없는 브라우저가
// 많다. 여기 것은 그냥 더하기라 아주 큰 수의 끝자리 정밀도만 다르다).
// ============================================================================
const U8 = Uint8Array.prototype;

if (typeof U8.toHex !== 'function') {
  const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
  Object.defineProperty(U8, 'toHex', {
    configurable: true, writable: true,
    value() { let s = ''; for (let i = 0; i < this.length; i++) s += HEX[this[i]]; return s; },
  });
}

// 큰 배열을 `String.fromCharCode(...arr)`로 한 번에 펴면 인자 개수 상한에 걸려 던진다
// (PDF 안의 그림은 몇 MB다). 조각으로 나눠 잇는다.
if (typeof U8.toBase64 !== 'function') {
  Object.defineProperty(U8, 'toBase64', {
    configurable: true, writable: true,
    value() {
      let s = '';
      for (let i = 0; i < this.length; i += 0x8000) s += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000));
      return btoa(s);
    },
  });
}

if (typeof Uint8Array.fromBase64 !== 'function') {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    configurable: true, writable: true,
    value(str) {
      const bin = atob(String(str));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
  });
}

// `getOrInsertComputed(key, fn)` — 있으면 그 값, 없으면 fn(key)를 넣고 그 값.
// pdf.js가 캐시에 쓴다(27자리). `getOrInsert(key, value)`는 그 값 판이다.
for (const Ctor of [Map, WeakMap]) {
  const proto = Ctor.prototype;
  if (typeof proto.getOrInsertComputed !== 'function') {
    Object.defineProperty(proto, 'getOrInsertComputed', {
      configurable: true, writable: true,
      value(key, callback) {
        if (this.has(key)) return this.get(key);
        const v = callback(key);
        this.set(key, v);
        return v;
      },
    });
  }
  if (typeof proto.getOrInsert !== 'function') {
    Object.defineProperty(proto, 'getOrInsert', {
      configurable: true, writable: true,
      value(key, value) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      },
    });
  }
}

// `Response.bytes()` / `Blob.bytes()` — 받은 것을 Uint8Array로 바로 준다.
// **cmaps·standard_fonts를 받아오는 길이 이것 하나다**(2026-09-13에 그 자료를 내주기
// 시작했다 — vite.config.js의 pdfjsAssets). 없으면 "t.bytes is not a function"만 남기고
// **그 글꼴을 조용히 버려서**, 한글이 빠진 그 증상이 옛 브라우저에서 그대로 재현된다.
for (const Ctor of [typeof Response === 'function' ? Response : null, typeof Blob === 'function' ? Blob : null]) {
  if (Ctor && typeof Ctor.prototype.bytes !== 'function') {
    Object.defineProperty(Ctor.prototype, 'bytes', {
      configurable: true, writable: true,
      async value() { return new Uint8Array(await this.arrayBuffer()); },
    });
  }
}

// ── `Iterator` 전역과 도우미 (6.3 · 머리말 마지막 문단) ─────────────────────
// %IteratorPrototype% — 배열·Map·Set·제너레이터의 이터레이터가 모두 물려받는 그 객체다.
// 여기에 붙여야 `map.keys().filter(…)`가 된다(pdf.js가 실제로 그렇게 쓴다).
const ITER_PROTO = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
if (typeof globalThis.Iterator !== 'function') {
  // 추상 생성자 — 직접 new 할 일은 없다. pdf.js는 `Iterator.prototype`만 본다.
  const Iterator = function Iterator() {};
  Iterator.prototype = ITER_PROTO;
  Object.defineProperty(globalThis, 'Iterator', { configurable: true, writable: true, value: Iterator });
}
// 걸러 내는 둘(map·filter)은 제너레이터로 돌려준다 — 제너레이터도 %IteratorPrototype%을
// 물려받으므로 `.filter(…).toArray()`처럼 이어 부를 수 있다. 콜백의 둘째 인자는 순번(표준과 같다).
const ITER_HELPERS = {
  *map(fn) { let i = 0; for (const v of this) yield fn(v, i++); },
  *filter(fn) { let i = 0; for (const v of this) if (fn(v, i++)) yield v; },
  some(fn) { let i = 0; for (const v of this) if (fn(v, i++)) return true; return false; },
  every(fn) { let i = 0; for (const v of this) if (!fn(v, i++)) return false; return true; },
  find(fn) { let i = 0; for (const v of this) if (fn(v, i++)) return v; return undefined; },
  forEach(fn) { let i = 0; for (const v of this) fn(v, i++); },
  toArray() { return [...this]; },
  // 표준 도우미가 아니다 — pdf.js가 스스로 붙이는 것과 같은 모양(그쪽은 없을 때만 붙인다)
  join(separator) { return [...this].join(separator); },
};
for (const [name, value] of Object.entries(ITER_HELPERS)) {
  if (typeof ITER_PROTO[name] !== 'function') {
    Object.defineProperty(ITER_PROTO, name, { configurable: true, writable: true, value });
  }
}

// `Promise.try(fn, ...args)` — fn이 동기로 던져도 거절된 약속이 된다.
if (typeof Promise.try !== 'function') {
  Object.defineProperty(Promise, 'try', {
    configurable: true, writable: true,
    value(fn, ...args) { return new Promise((resolve) => resolve(fn(...args))); },
  });
}

// `Math.sumPrecise(iterable)` — 여기서는 보통 더하기다(머리말).
if (typeof Math.sumPrecise !== 'function') {
  Object.defineProperty(Math, 'sumPrecise', {
    configurable: true, writable: true,
    value(items) { let s = 0; for (const x of items) s += x; return s; },
  });
}
