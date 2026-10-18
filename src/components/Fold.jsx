import React, { useEffect, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion.js';

// ============================================================================
// 그 자리에서 접고 펴기 (v5 2묶음 · 2026-10-18 — 사용자 지적 "뚝 바뀌지 않게")
// ----------------------------------------------------------------------------
// 높이 0 ↔ 제 높이 + 투명도를 quint로(index.css `.dc-fold` · PITFALLS 57). 높이를 추정하지 않는다(grid 0fr ↔ 1fr — max-height
// 방식은 끝에서 뚝 끊긴다 · 최근 활동 '더보기'와 같은 판단). 움직임 줄이기면 바로 바뀐다(CSS가 transition: none).
// 단계는 넷 — closed(안을 그리지 않는다) · opening · open(다 펴짐) · closing. 끝은 transitionend **또는 시간**(FOLD_MS + 여유)으로 낸다:
//   · transitionend는 안 올 때가 있다 — 펴기 첫 프레임 전에 다시 접으면 전이가 아예 안 돌고, 탭이 가려지거나 전이가 끊겨도
//     안 온다. 그 끝을 기다리던 옛 판은 접힌 뒤에도 안을 쥔 채 남았고, 폰에서 접은 댓글의 얼굴·이름 한 토막이 해결됨 줄 밑에
//     잘려 남았다(사용자 지적 2026-10-18 · PITFALLS 68-c). 그래서 시간으로도 끝낸다 — 접힌 끝은 늘 '안을 떼고 visibility:hidden'.
//   · 빨리 다시 누르면 앞 단계의 rAF·시계를 걷고 새 방향에서 이어 간다(전이는 그 자리에서 되돈다).
//   · 다 펴진 뒤에만 안쪽의 overflow를 푼다 — 안의 초점 테두리·밝히기 그림자(댓글 flash)·얼굴이 잘리지 않게(움직이는 동안만 자른다).
//   · 열은 minmax(0,1fr)·안쪽은 min-w-0 — 그냥 grid면 열이 안의 한 줄 글(truncate) 전체 폭으로 늘어 판이 가로로 밀렸다(68-c).
// 쓰는 자리: 표 정렬의 오름/내림 · 해결한 댓글 펼치기.
// ============================================================================
export const FOLD_MS = 280;   // index.css .dc-fold의 전이 길이와 같다

export function Fold({ open, children, className = '', ...rest }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(open ? 'open' : 'closed');
  // 펴는 첫 프레임은 0fr에서 시작해야 전이가 돈다 — 안을 붙인 다음 프레임에 data-open을 켠다
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (reduced) { setShown(open); setPhase(open ? 'open' : 'closed'); return undefined; }
    let alive = true, r1 = 0, r2 = 0;
    if (open) {
      setPhase(p => (p === 'open' ? p : 'opening'));
      r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => { if (alive) setShown(true); }); });
    } else {
      setShown(false);
      setPhase(p => (p === 'closed' ? p : 'closing'));
    }
    // transitionend가 안 와도 끝낸다(위 머리말) — 펴기는 rAF 두 번 뒤에 시작하니 그만큼 더 기다린다
    const t = setTimeout(() => { if (alive) setPhase(open ? 'open' : 'closed'); }, FOLD_MS + 120);
    return () => { alive = false; cancelAnimationFrame(r1); cancelAnimationFrame(r2); clearTimeout(t); };
  }, [open, reduced]);
  const end = (e) => {
    if (e.target !== e.currentTarget || e.propertyName !== 'grid-template-rows') return;
    setPhase(open ? 'open' : 'closed');
  };
  return (
    <div {...rest} className={`dc-fold ${className}`} data-open={shown ? 'true' : 'false'} data-fold={phase} inert={!open} onTransitionEnd={end}>
      <div className={phase === 'open' ? 'min-h-0 min-w-0' : 'min-h-0 min-w-0 overflow-hidden'}>{phase !== 'closed' ? children : null}</div>
    </div>
  );
}
