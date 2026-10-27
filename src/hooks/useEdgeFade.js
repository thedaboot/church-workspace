import { createElement, useLayoutEffect, useRef } from 'react';

// ============================================================================
// 더 있을 때만 끝이 흐려짐(S8 · UI 다듬기 2차 2026-10-27) — 가로로 미는 줄(칩 줄 · 폰 탭 줄 · 상태 칩 줄)
// ----------------------------------------------------------------------------
// 줄이 넘칠 때만 `data-x-fade`를 달고(넘치지 않으면 마스크 층 자체가 없다 · PITFALLS 50-d와 같은 까닭),
// 왼쪽에 더 있으면 `data-fade-l`, 오른쪽에 더 있으면 `data-fade-r`. 모양·전이는 index.css `[data-x-fade]`.
// **class가 아니라 data 속성이다** — 리액트가 그 줄의 className을 다시 쓰면 훅이 붙인 class가 지워진다(PITFALLS 73-d).
// 넘기는 동안(scroll) · 줄 폭이 바뀔 때(ResizeObserver) · 칩이 늘고 줄 때(MutationObserver) 다시 잰다.
// 안내 문구 없이 '옆에 더 있다'를 알린다.
// ============================================================================

// 순수 판정 — 노드에서 검사한다(tests/logcheck). 1px 여유는 소수점 폭 반올림 몫이다.
export function edgeFadeState(scrollLeft, scrollWidth, clientWidth) {
  const max = scrollWidth - clientWidth;
  if (max <= 1) return { over: false, l: false, r: false };
  return { over: true, l: scrollLeft > 1, r: scrollLeft < max - 1 };
}

const flag = (el, name, on) => { if (on) el.setAttribute(name, ''); else el.removeAttribute(name); };

export function useEdgeFade(ref, enabled = true) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;
    let raf = 0;
    const read = () => {
      raf = 0;
      const s = edgeFadeState(el.scrollLeft, el.scrollWidth, el.clientWidth);
      flag(el, 'data-x-fade', s.over);
      flag(el, 'data-fade-l', s.l);
      flag(el, 'data-fade-r', s.r);
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    el.addEventListener('scroll', soon, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
    ro?.observe(el);
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(soon) : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener('scroll', soon);
      ro?.disconnect(); mo?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      for (const n of ['data-x-fade', 'data-fade-l', 'data-fade-r']) el.removeAttribute(n);
    };
  }, [ref, enabled]);
}

// 그냥 줄 하나 — ref를 따로 둘 일이 없는 자리(칩 줄)는 이것으로 감싼다. 받은 속성은 그대로 div에 간다.
export function FadeRow(props) {
  const ref = useRef(null);
  useEdgeFade(ref);
  return createElement('div', { ...props, ref });
}
