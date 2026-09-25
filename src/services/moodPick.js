// ============================================================================
// "이런 마음일 때" 칩 고르기 — 순수 판정(import 0 · 후보 풀은 src/data/moods.js)
// ----------------------------------------------------------------------------
// 성경 검색칸을 비운 채 누르면 뜨는 판 맨 위의 칩 줄(목업 '은혜와 리듬' 5번 · 사용자 결정 2026-09-25):
//   · **무조건 한 줄**이다(데스크톱도). 칩을 자르지 않고 **개수를 줄인다** — 실제로 그린 칩 폭을 재서
//     (components/wordBible.jsx MoodChips의 보이지 않는 줄) 섞인 차례대로 넣어 보고, 안 들어가는 칩은
//     건너뛰고 다음 칩을 본다. 그래서 긴 칩이 앞에 와도 짧은 칩으로 줄이 찬다.
//   · 폰(줄 폭 480px 미만)은 **넷까지**(사용자 결정 — 폰은 3~4개). 데스크톱은 폭에 들어가는 만큼.
//   · 판을 닫고 **1분이 지나** 다시 열면 새로 섞고, **방금 보였던 칩은 뒤로 민다**(연달아 나오지 않게).
//     1분 안이면 같은 칩이다(손이 방금 본 자리를 찾는다 · 사용자 확정 2026-09-25).
//   · 기억은 이 브라우저에 `{ order, shownAt, last }` 한 벌(localStorage · 계정 간 공유 없음 — wordBible이 읽고 쓴다).
// ============================================================================

export const MOOD_PHONE_MAX = 4;
export const MOOD_PHONE_W = 480;
export const MOOD_RESHUFFLE_MS = 60000;
export const MOOD_GAP = 6;   // 칩 사이(px) — MoodChips 줄의 gap-1.5와 같아야 한다
// 칩 모양 한 벌 — 화면(wordBible)과 검사(tests/word의 실제 폭 재기)가 같은 클래스를 쓴다
export const MOOD_CHIP = 'shrink-0 whitespace-nowrap px-[11px] py-1.5 rounded-full text-[12px] font-semibold bg-surface-hover text-fg-secondary hover:bg-line transition-colors';

// 0..n-1을 섞은 차례(Fisher–Yates). rand는 검사가 넣는다(기본 Math.random).
export function shuffledOrder(n, rand = Math.random) {
  const a = Array.from({ length: Math.max(0, n | 0) }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// order: 후보 번호의 차례 · widths[번호]: 그 칩의 실제 폭(px) · avail: 줄 폭(px)
// → 한 줄에 들어가는 번호들(차례 그대로). 폭을 모르는 칩(0·NaN)은 넣지 않는다.
// 폰은 **셋은 채운다**(사용자 결정 — 폰은 3~4개): 긴 칩 둘이 먼저 와서 남은 자리에 아무것도 안 들어가는 일이
// 없게, 칩을 넣을 때 '아직 채워야 할 개수만큼 가장 짧은 칩이 들어갈 자리'를 남겨 둔다. 그래도 안 되면(폭이 아주
// 좁으면) 들어가는 만큼만.
export const MOOD_PHONE_MIN = 3;
export function fitMoods(order, widths, avail, gap = MOOD_GAP) {
  const phone = avail < MOOD_PHONE_W;
  const max = phone ? MOOD_PHONE_MAX : Infinity;
  const min = phone ? MOOD_PHONE_MIN : 0;
  const ids = (order || []).filter(i => Number(widths?.[i]) > 0);
  const out = [];
  let used = 0;
  // 남은 후보 중 가장 짧은 k개가 차지할 폭(사이 틈 포함)
  const reserveFor = (k, skip) => {
    if (k <= 0) return 0;
    const small = ids.filter(i => !skip.has(i)).map(i => Number(widths[i])).sort((a, b) => a - b).slice(0, k);
    return small.length < k ? Infinity : small.reduce((s, w) => s + w + gap, 0);
  };
  for (const strict of [true, false]) {
    for (const i of ids) {
      if (out.length >= max) break;
      if (out.includes(i)) continue;
      const w = Number(widths[i]);
      const need = out.length ? used + gap + w : w;
      if (need > avail) continue;
      if (strict && need + reserveFor(min - out.length - 1, new Set([...out, i])) > avail) continue;
      out.push(i); used = need;
    }
    if (!strict || out.length >= min) break;
    out.length = 0; used = 0;   // 셋을 못 채웠다 — 자리 남기기 없이 다시(들어가는 만큼만)
  }
  return out;
}

// 판이 열릴 때 새로 섞을까 — 처음이거나, 닫힌 지 1분이 지났으면
export const shouldReshuffle = (closedAt, now = Date.now()) => !closedAt || now - closedAt >= MOOD_RESHUFFLE_MS;

// 새로 섞되 **방금 보였던 칩(last)은 맨 뒤로** — 섞은 차례는 그대로 두고 그 칩들만 뒤에 붙인다.
export function reshuffle(n, last = [], rand = Math.random) {
  const back = new Set((last || []).filter(i => Number.isInteger(i) && i >= 0 && i < n));
  const order = shuffledOrder(n, rand);
  return [...order.filter(i => !back.has(i)), ...order.filter(i => back.has(i))];
}

// 기억해 둔 값을 믿지 않는다 — 후보 수가 바뀌었거나(데이터 파일을 고쳤다) 모양이 깨졌으면 버린다.
export function validMemo(memo, n) {
  const o = memo?.order;
  if (!Array.isArray(o) || o.length !== n) return null;
  const set = new Set(o);
  if (set.size !== n || o.some(i => !Number.isInteger(i) || i < 0 || i >= n)) return null;
  return { order: o, shownAt: Number(memo.shownAt) || 0, last: Array.isArray(memo.last) ? memo.last : [] };
}

// 판이 열릴 때의 차례 — 1분 안이면 기억한 차례 그대로, 지났으면(또는 처음이면) 새로 섞고 방금 본 칩은 뒤로.
export function orderOnOpen(memo, n, now = Date.now(), rand = Math.random) {
  const m = validMemo(memo, n);
  if (m && !shouldReshuffle(m.shownAt, now)) return m.order;
  return reshuffle(n, m?.last || [], rand);
}
