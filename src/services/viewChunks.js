// ============================================================================
// 늦게 싣는 화면 조각을 미리 받기 (2026-10-15 · UX 다듬기 β)
// ----------------------------------------------------------------------------
// 예배·말씀·모임·청년 명단·위키는 첫 번들에 없다(App.jsx의 lazy · 폴백 null). 그래서 그 탭을 **처음** 누르면
// 조각이 오는 동안 화면이 비었다. 두 갈래로 미리 받는다:
//   · 첫 화면이 선 뒤(cloudReady) 브라우저가 한가할 때 하나씩(prefetchViewsIdle — requestIdleCallback, 없으면 setTimeout)
//   · 폰 하단 탭을 누르는 순간(pointerdown — 손가락이 떨어지기 전에 요청이 나간다 · 위키 입구가 하던 것과 같다)
// import() 주소는 App.jsx의 lazy와 **같은 파일**이라 같은 조각이다(모듈 캐시 — 두 번 받지 않는다).
// 실패는 삼킨다 — 미리 받기는 덤이고, 진짜로 열 때 lazy가 다시 받는다(오프라인이면 main.jsx가 연결을 기다린다).
// ============================================================================

export const VIEW_CHUNKS = {
  worship: () => import('../views/worshipView.jsx'),
  word: () => import('../views/wordView.jsx'),
  groups: () => import('../views/groupsView.jsx'),
  members: () => import('../views/membersView.jsx'),
  wiki: () => import('../views/wikiView.jsx'),
};

export function prefetchView(menu) {
  const load = VIEW_CHUNKS[menu];
  if (load) load().catch(() => {});
}

// 한가할 때 하나씩 — 한꺼번에 다섯 개를 쏘면 첫 화면의 다른 요청(사진·실시간)과 겨룬다. 돌려주는 함수로 멈춘다.
export function prefetchViewsIdle(menus = Object.keys(VIEW_CHUNKS)) {
  const idle = window.requestIdleCallback
    ? (cb) => window.requestIdleCallback(cb, { timeout: 4000 })
    : (cb) => window.setTimeout(cb, 1200);
  const stop = window.requestIdleCallback ? (h) => window.cancelIdleCallback(h) : (h) => window.clearTimeout(h);
  let i = 0;
  let id = 0;
  const next = () => {
    if (i >= menus.length) return;
    prefetchView(menus[i++]);
    id = idle(next);
  };
  id = idle(next);
  return () => stop(id);
}
