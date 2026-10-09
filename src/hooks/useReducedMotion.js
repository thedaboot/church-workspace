import { useSyncExternalStore } from 'react';

// '움직임 줄이기'(OS 설정 · prefers-reduced-motion)를 보는 한 벌(§4.2). 레포에 같은 matchMedia 한 줄이
// 일곱 군데 흩어져 있어(19차 진단) 여기로 모았다 — 검색 · 대시보드 · 활동 · 예배 · 말씀 · 다붓이 · 그래프가 쓴다.
//   prefersReducedMotion()  순수 함수 — 지금 값 한 번(이벤트 안·rAF 고리처럼 훅을 못 쓰는 자리)
//   useReducedMotion()      훅 — 설정이 바뀌면 다시 그린다
// matchMedia가 없는 곳(노드·옛 브라우저)에서는 false — 움직임을 줄이라는 말이 없었던 것으로 본다.
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(win = typeof window !== 'undefined' ? window : undefined) {
  return !!win?.matchMedia?.(REDUCED_MOTION_QUERY)?.matches;
}

const subscribe = (cb) => {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(REDUCED_MOTION_QUERY) : null;
  if (!mq?.addEventListener) return () => {};
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, () => prefersReducedMotion(), () => false);
}
