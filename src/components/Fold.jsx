import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion.js';

// ============================================================================
// 그 자리에서 접고 펴기 (v5 2묶음 · 2026-10-18 — 사용자 지적 "뚝 바뀌지 않게")
// ----------------------------------------------------------------------------
// **높이만** 움직인다 — 지금 높이(px) ↔ 0을 Web Animations로, quint(index.css --ease-out-quint와 같은 곡선). 움직임 줄이기면 바로.
//   · 옛 판은 CSS grid 0fr ↔ 1fr + 투명도 전이였다. 아이폰 Safari에서 접는 도중 투명도가 한 번도 안 움직이고 높이만 줄다가
//     얼굴·이름 한 토막을 쥔 채 멈췄다(사용자 화면 녹화 2026-10-21 · 30fps로 보면 잘 닫힐 때는 흐려지고, 남을 때는 안 흐려진다 —
//     투명도 전이에 쓰는 합성 층이 얼어붙은 것으로 본다 · PITFALLS 68-e). 그래서 투명도·visibility 전이를 걷고,
//     합성 층을 만들지 않는 height만 움직인다(매 프레임 다시 그린다).
// 단계는 넷 — closed(안을 그리지 않고 판째 display:none) · opening · open(높이 auto · 안을 자르지 않는다) · closing.
//   · 끝은 animation.finished **또는 시간**(FOLD_MS + 여유) — 둘 중 먼저(68-c와 같은 이유: 끝 신호를 하나만 믿지 않는다).
//   · 움직이는 도중에 다시 누르면 그 순간의 높이에서 새 방향으로 이어 간다.
//   · 다 펴진 뒤에만 안쪽을 자르지 않는다 — 안의 초점 테두리·밝히기 그림자(댓글 flash)·얼굴이 잘리지 않게(움직이는 동안만 자른다).
//   · 안쪽은 min-w-0 — 한 줄 글(truncate)이 판을 가로로 밀지 않게(68-c).
// 쓰는 자리: 표 정렬의 오름/내림 · 해결한 댓글 펼치기 · 행사 시각 · 인계 카드 · 찬양 더보기.
// ============================================================================
export const FOLD_MS = 280;
const EASE = 'cubic-bezier(.16, 1, .3, 1)';   // index.css --ease-out-quint

export function Fold({ open, children, className = '', ...rest }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(open ? 'open' : 'closed');
  const ref = useRef(null);
  const anim = useRef(null);
  const prev = useRef(open);
  // open이 바뀌면 방향만 정한다(StrictMode에서 두 번 돌아도 같은 값이면 아무것도 안 한다)
  useEffect(() => {
    if (prev.current === open) return;
    prev.current = open;
    setPhase(reduced ? (open ? 'open' : 'closed') : (open ? 'opening' : 'closing'));
  }, [open, reduced]);
  // 단계 → 움직임. 그리기 전에(layout effect) 높이를 잡아 첫 프레임이 튀지 않게 한다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (phase === 'open' || phase === 'closed') { anim.current?.cancel(); anim.current = null; return undefined; }
    const target = phase === 'opening' ? 'open' : 'closed';
    let alive = true;
    const done = () => { if (alive) setPhase(p => (p === phase ? target : p)); };
    if (!el || typeof el.animate !== 'function') { done(); return () => { alive = false; }; }
    // 움직이는 중이면 그 순간 높이에서 · 닫혀 있다 펴면 0에서 · 펴져 있다 접으면 제 높이에서
    const from = anim.current || phase === 'closing' ? el.getBoundingClientRect().height : 0;
    anim.current?.cancel();
    const to = phase === 'opening' ? el.scrollHeight : 0;
    const a = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: FOLD_MS, easing: EASE, fill: 'forwards' });
    anim.current = a;
    a.finished.then(done, () => {});
    const t = setTimeout(done, FOLD_MS + 120);
    return () => { alive = false; clearTimeout(t); };
  }, [phase]);
  const moving = phase === 'opening' || phase === 'closing';
  return (
    <div {...rest} ref={ref} className={`dc-fold ${moving ? 'overflow-hidden' : ''} ${className}`} data-open={open ? 'true' : 'false'} data-fold={phase} inert={!open}>
      <div className="min-w-0">{phase !== 'closed' ? children : null}</div>
    </div>
  );
}
