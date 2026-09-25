// 실시간 채널이 **끊겼다가 다시 붙었는지** 가리는 판정(2026-09-25).
// 폰이 잠들었다 깨면 소켓이 끊겼다가 라이브러리가 다시 붙이는데, 끊겨 있던 동안의 변경은
// 오지 않는다 — 다시 붙는 순간 한 번 읽어야 한다. v2 채널(liveV2.js)이 같은 규칙이다:
//   · 처음 SUBSCRIBED는 무시한다(방금 앱이 전부 읽었다)
//   · CHANNEL_ERROR · TIMED_OUT · CLOSED면 '끊겼었다'만 기억한다(되살리는 일은 라이브러리가 한다)
//   · 그 뒤 SUBSCRIBED가 오면 onReconnect 한 번
// 순수 함수(import 0) — 게스트 스위트는 이 길을 못 타므로 logcheck가 본다.
const DOWN = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

export function reconnectWatcher(onReconnect) {
  let wasDown = false;
  return (status) => {
    if (status === 'SUBSCRIBED') {
      if (wasDown) { wasDown = false; onReconnect?.(); }
      return;
    }
    if (DOWN.has(status)) wasDown = true;
  };
}
