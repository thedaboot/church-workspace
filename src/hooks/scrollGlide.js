import { prefersReducedMotion } from './useReducedMotion.js';

// ============================================================================
// 스크롤 통을 앱 곡선(quint)으로 옮기는 한 벌 (2026-10-15 · PITFALLS 56-g)
// ----------------------------------------------------------------------------
// 브라우저의 `behavior: 'smooth'`는 곡선을 고를 수 없고(크롬·사파리가 저마다 다르다) '움직임 줄이기'도 안 본다 —
// 다붓이 답·위키 목차가 그 길이었다. 여기서는 `--ease-out-quint`(index.css)와 같은 결로 움직이고, 움직임 줄이기면 즉시 간다.
//   glideTo(scroller, top)   scroller: 스크롤하는 요소(main 등 · 문서면 document.scrollingElement)
// 손이 닿으면(휠·터치·키) 그 자리에서 멈춘다 — 읽으려고 잡은 화면을 끝까지 끌고 가지 않는다.
// 같은 통에 새로 부르면 앞의 것은 멈추고 새 목표로 간다.
// ============================================================================
const GLIDE_MS = 420;   // 업무 잠금·그래프 판 높이와 같은 길이(.42s quint)
const easeOutQuint = (t) => 1 - (1 - t) ** 5;
const running = new WeakMap();   // scroller → 멈추기

export function glideTo(scroller, top, { ms = GLIDE_MS } = {}) {
  if (!scroller) return;
  running.get(scroller)?.();
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const to = Math.max(0, Math.min(max, Math.round(top)));
  const from = scroller.scrollTop;
  if (Math.abs(to - from) < 1) return;
  if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    scroller.scrollTop = to;
    return;
  }
  const target = scroller === document.scrollingElement ? window : scroller;
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    running.delete(scroller);
    for (const e of ['wheel', 'touchstart', 'keydown']) target.removeEventListener(e, stop);
  };
  for (const e of ['wheel', 'touchstart', 'keydown']) target.addEventListener(e, stop, { passive: true });
  running.set(scroller, stop);
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    scroller.scrollTop = from + (to - from) * easeOutQuint(t);
    if (t < 1) raf = requestAnimationFrame(step);
    else stop();
  };
  raf = requestAnimationFrame(step);
}
