// 자주 보는 것일수록 덜 움직인다(UI 다듬기 2차 D4 빈도 사다리 · PITFALLS 72-a).
// 이 접속에서 **이미 들어가 본 화면으로 돌아오면** 화면·줄·카드 등장을 짧게(--dur-quick · 150ms) · 순번 지연 없이 바꾼다.
// 처음 들어갈 때는 그대로(.26~.32s + 줄마다 22~70ms 순번) — 탭을 오가는 일은 하루 수십 번이라 매번 0.5초씩 차례로 들어오면 느려 보인다.
// - CSS 클래스는 그대로 두고, 화면이 선 뒤 잠깐(WINDOW_MS) 그 안에 걸린 등장 애니메이션만 Web Animations로 고쳐 쓴다.
//   화면이 선 순간 한 번만 고치면 조금 늦게 붙는 칸(홈 쇼케이스 · Suspense 안 카드)이 옛 순번으로 들어온다.
//   CSS로 `[data-again] .dc-row { animation-delay: 0 }`를 걸면 한참 뒤 붙는 줄(다붓이 답의 근거 칩 등)까지 바뀌고,
//   그 표시를 도중에 떼면 남은 지연이 되살아나 끝난 줄이 다시 들어온다.
// - 움직임 줄이기면 애니메이션이 없어 할 일이 없다.
const ENTER = new Set(['dc-screen-in', 'dc-screen-fade', 'dc-row-in', 'dc-card-in', 'dc-fade-in', 'dc-nav-fwd', 'dc-nav-back']);
const WINDOW_MS = 600;

// 고친 뒤 멈추는 함수를 돌려준다(useLayoutEffect의 정리로 쓴다 — 그사이 다른 화면으로 가면 멈춘다).
export function quickEnter(el) {
  if (!el?.getAnimations) return undefined;
  const ms = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-quick')) || 0.15) * 1000;
  const t0 = performance.now();
  let raf = 0;
  const fix = () => {
    for (const a of el.getAnimations({ subtree: true })) {
      if (!ENTER.has(a.animationName)) continue;
      const t = a.effect?.getTiming?.();
      if (t && (t.duration !== ms || t.delay !== 0)) a.effect.updateTiming({ delay: 0, duration: ms });
    }
    if (performance.now() - t0 < WINDOW_MS) raf = requestAnimationFrame(fix);
  };
  fix();
  return () => cancelAnimationFrame(raf);
}
