import { useEffect, useRef } from 'react';

// 읽은 만큼 차는 막대(UI 다듬기 2차 M15 · 시안 값 그대로 · PITFALLS 75-f) — 성경 장 · 위키 장(예배 노트는 넣었다가 뺐다 — 사용자 결정 2026-10-28).
// 머리 아래(스크롤 통의 맨 위)에 붙는 2px 막대가 그 통의 스크롤만큼 바탕 빛 그라데이션(--app-brand-grad)으로 찬다.
// **스크롤 위치를 직접 읽어 칠한다**(scroll 이벤트 → 한 프레임에 한 번 scaleX). 예전에는 CSS 스크롤 타임라인이었는데, 폰에서 관성 스크롤을
// 손가락으로 멈추는 순간 막대가 확 줄었다(사용자 지적 2026-10-28 — 관성 중에는 화면 쪽 스크롤 값으로 그리다가 멈출 때 실제 값으로 다시 맞춘다).
// 실제 scrollTop을 읽으면 그런 엇갈림이 없고, 타임라인을 모르는 옛 사파리에서도 선다.
// 자리를 차지하지 않는다(높이 2px · 아래 여백 -2px) — 아래 글이 밀리지 않게. 부모 안에서 sticky라, 부모(읽는 칸)가 화면에 있는 동안만 선다.
export function ReadBar() {
  const barRef = useRef(null);
  useEffect(() => {
    const bar = barRef.current, fill = bar?.firstElementChild;
    if (!fill) return undefined;
    let sc = bar.parentElement;
    while (sc && sc !== document.documentElement && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    const target = !sc || sc === document.documentElement ? window : sc;
    const el = target === window ? document.scrollingElement : sc;
    let raf = 0;
    const paint = () => {
      raf = 0;
      const max = el.scrollHeight - el.clientHeight;
      fill.style.transform = `scaleX(${max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0})`;
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(paint); };
    paint();
    target.addEventListener('scroll', queue, { passive: true });
    const ro = new ResizeObserver(queue);   // 글이 늘거나 줄면(절 고르기·글자 크기) 비율이 바뀐다
    ro.observe(bar.parentElement);
    return () => { target.removeEventListener('scroll', queue); ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return <div ref={barRef} className="dc-read-bar" aria-hidden="true"><i /></div>;
}
