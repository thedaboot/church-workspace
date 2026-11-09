// 같은 열쇠(업무 id)의 쓰기가 연달아 실패하면 다음 쓰기를 물러나며 보낸다(2026-11-09 장애 보완 · cloudSync.cardUpsertCloud).
// 2026-11-08 17:14 KST 한 기기가 토큰이 만료된 채 '11월 월례회' 카드에 1분 동안 PATCH 112번을 보냈다 — 전부 거절(406)인데
// 쉬지 않고 다시 보내 1초에 23번까지 늘었다. 실패가 n번이면 1초 × 2^(n-1)(최대 30초) 동안 다음 쓰기를 기다리게 하고, 성공하면 바로 푼다.
// 쓰기를 버리지 않는다 — 기다렸다 보낸다(못 간 칸은 업무 창이 '저장하지 못했어요 · 다시 시도'로 들고 있다 · optimistic.createSaveRetry).
// 순수 모듈(import 0) — 시계를 넘겨받아 logcheck-live가 본다. 함정 §6-21-c.
export function createFailBackoff({ baseMs = 1000, maxMs = 30000, now = () => Date.now() } = {}) {
  const fails = new Map();   // 열쇠 → { n, until }
  return {
    // 지금 보내려면 몇 ms 기다려야 하나(0이면 바로)
    wait: (key) => Math.max(0, (fails.get(key)?.until || 0) - now()),
    ok: (key) => { fails.delete(key); },
    fail: (key) => {
      const n = (fails.get(key)?.n || 0) + 1;
      fails.set(key, { n, until: now() + Math.min(maxMs, baseMs * 2 ** (n - 1)) });
    },
  };
}
