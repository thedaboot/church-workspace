import React, { useEffect, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion.js';

// ============================================================================
// 그 자리에서 접고 펴기 (v5 2묶음 · 2026-10-18 — 사용자 지적 "뚝 바뀌지 않게")
// ----------------------------------------------------------------------------
// 높이 0 ↔ 제 높이 + 투명도를 quint로(index.css `.dc-fold` · PITFALLS 57). 높이를 추정하지 않는다(grid 0fr ↔ 1fr — max-height
// 방식은 끝에서 뚝 끊긴다 · 최근 활동 '더보기'와 같은 판단). 움직임 줄이기면 바로 바뀐다(CSS가 transition: none).
//   · 접힌 동안에는 안을 그리지 않는다 — 접히는 전이가 끝난 뒤에 뗀다(그 사이에는 inert라 눌리지 않는다).
//   · 다 펴진 뒤에는 안쪽의 overflow를 푼다 — 안의 초점 테두리·밝히기 그림자(댓글 flash)가 잘리지 않게.
// 쓰는 자리: 표 정렬의 오름/내림 · 해결한 댓글 펼치기.
// ============================================================================
export function Fold({ open, children, className = '', ...rest }) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [settled, setSettled] = useState(open);
  // 펴는 첫 프레임은 0fr에서 시작해야 전이가 돈다 — 그리고 다음 프레임에 data-open을 켠다
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      if (reduced) { setShown(true); setSettled(true); return undefined; }
      let alive = true;
      const id = requestAnimationFrame(() => requestAnimationFrame(() => { if (alive) setShown(true); }));
      return () => { alive = false; cancelAnimationFrame(id); };
    }
    setShown(false);
    setSettled(false);
    if (reduced) setMounted(false);
    return undefined;
  }, [open, reduced]);
  const end = (e) => {
    if (e.target !== e.currentTarget || e.propertyName !== 'grid-template-rows') return;
    if (open) setSettled(true);
    else setMounted(false);
  };
  return (
    <div {...rest} className={`dc-fold ${className}`} data-open={shown ? 'true' : 'false'} inert={!open} onTransitionEnd={end}>
      <div className={settled && open ? 'min-h-0' : 'min-h-0 overflow-hidden'}>{mounted ? children : null}</div>
    </div>
  );
}
