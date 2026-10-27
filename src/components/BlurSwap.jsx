import { useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../hooks/useReducedMotion.js';

// 상태가 바뀔 때 아주 살짝 흐림(UI 다듬기 2차 M25 · 시안 값 그대로 · 규칙 밖 filter — 승인 · PITFALLS 78-c).
// value가 바뀌면 옛 내용은 제자리에서 흐려지며(2px) 빠지고 새 내용은 흐림에서 또렷해지며 선다 — 300ms ease-in-out 둘이 겹쳐
// 두 상태 사이 빈틈이 안 보인다. **작은 칸에만**(상태 칩 글자 · 숫자처럼 몇 글자) — filter는 칸 전체를 따로 그리므로 넓은 판에 걸면 무겁다.
// - 처음 그릴 때와 같은 값으로 다시 그릴 때는 가만히 있다. 옛 내용은 absolute라 자리를 차지하지 않는다(폭은 곧바로 새 값의 폭).
// - 움직임 줄이기면 옛 내용을 남기지 않고 그냥 바뀐다.
// inner: 안쪽 두 겹(옛·새)에 같이 주는 class — 점+글자처럼 여럿을 감쌀 때 간격(gap)을 여기에 준다.
export function BlurSwap({ value, inner = '', children }) {
  const last = useRef({ value, kids: children });
  const n = useRef(0);
  const [out, setOut] = useState(null);   // { kids, n } — 빠지는 옛 내용
  useLayoutEffect(() => {
    if (last.current.value !== value && !prefersReducedMotion()) {
      n.current += 1;
      setOut({ kids: last.current.kids, n: n.current });
    }
    last.current = { value, kids: children };
  });
  // animationend가 오지 않는 경우(애니메이션이 취소됨 · 리액트에는 onAnimationCancel이 없다)에도 옛 내용이 남지 않게 — 300ms + 여유
  useLayoutEffect(() => {
    if (!out) return undefined;
    const t = setTimeout(() => setOut(o => (o?.n === out.n ? null : o)), 400);
    return () => clearTimeout(t);
  }, [out]);
  return (
    <span className="relative inline-flex" data-blur-swap="">
      {out && (
        <span key={`o${out.n}`} aria-hidden="true" className={`dc-swap-out ${inner}`}
          onAnimationEnd={() => setOut(o => (o?.n === out.n ? null : o))}>{out.kids}</span>
      )}
      <span key={`n${n.current}`} className={`${n.current ? 'dc-swap-in ' : ''}${inner}`}>{children}</span>
    </span>
  );
}
