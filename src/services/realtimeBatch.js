// ============================================================================
// 워크스페이스 실시간 — 카드 이벤트 모으기 (2026-09-24 · App.jsx의 구독이 쓴다)
// ----------------------------------------------------------------------------
// 순수 모듈이다(import 0) — tests/logcheck가 노드에서 그대로 부른다.
//
// id를 잠깐 모았다가 **id마다 한 번씩** 흘린다(cards 실시간 · App.onCard).
// 카드 저장 한 번이 cards UPDATE를 여러 건 만들고(본문·순서·집계 트리거 · 내 저장의 에코),
// 그때마다 그 카드를 다시 읽으면 같은 카드를 서너 번 읽을 뿐 아니라 늦게 온 옛 응답이 새 값을
// 덮는 경합까지 생긴다. 창은 **첫 id가 온 때부터** 잰다 — 이벤트마다 타이머를 다시 걸면
// 이어지는 저장 동안 영영 안 흐를 수 있다.
// ============================================================================
export function createIdBatcher(flush, delay = 200) {
  const ids = new Set();
  let timer = null;
  const run = () => {
    timer = null;
    const list = [...ids];
    ids.clear();
    if (list.length) flush(list);
  };
  return {
    add(id) {
      if (!id) return;
      ids.add(id);
      if (!timer) timer = setTimeout(run, delay);
    },
    // 구독을 걷을 때 — 모아 둔 것은 버린다(화면이 사라졌다)
    cancel() { clearTimeout(timer); timer = null; ids.clear(); },
    pending: () => [...ids],
  };
}
