import { useLayoutEffect, useRef } from 'react';
import { prefersReducedMotion } from './useReducedMotion.js';

// 줄이 새 자리로 미끄러진다(UI 다듬기 2차 M2 · PITFALLS 71-e) — FLIP: 그린 뒤 각 줄의 새 자리를 재고, 지난번 자리에서
// 새 자리로 transform만 움직인다. 상태를 바꿔 업무가 다른 구간·다른 순서로 가거나 끝낸 줄이 빠져 아래 줄이 올라올 때
// 순간이동 대신 따라갈 수 있게. 줄에 `data-flip="<업무 id>"`를 달고, 목록을 감싼 칸의 ref와 바뀌는 값(deps)을 넘긴다.
// - 자리는 감싼 칸 기준(+ 그 칸의 scrollTop)으로 잰다 — 사용자가 스크롤한 만큼 모든 줄이 움직이지 않게.
// - 처음 그릴 때는 재기만 한다(등장은 .dc-row가 맡는다). 새로 생긴 줄은 건드리지 않는다.
// - 움직임 줄이기면 재기만 한다.
// - 곡선은 '옮기기' 곡선(--ease-move · M23 · PITFALLS 78-b)이다 — 등장(.dc-row의 quint)과 다른 곡선이라 들어온 줄과 자리를 옮긴 줄이 구별된다.

// 자리를 옮기는 움직임의 곡선(index.css --ease-move) — 등장·퇴장은 --ease-out-quint 그대로. morph.js도 쓴다.
const MOVE_FALLBACK = 'cubic-bezier(.65, 0, .35, 1)';
export const easeMove = () =>
  (typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--ease-move').trim()) || MOVE_FALLBACK;

export function useFlip(boxRef, deps) {
  const last = useRef(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const top0 = box.getBoundingClientRect().top - box.scrollTop;
    const next = new Map();
    for (const el of box.querySelectorAll('[data-flip]')) next.set(el.dataset.flip, el.getBoundingClientRect().top - top0);
    const prev = last.current;
    last.current = next;
    if (!prev || prefersReducedMotion()) return;
    const ease = easeMove();
    for (const el of box.querySelectorAll('[data-flip]')) {
      const was = prev.get(el.dataset.flip);
      const dy = was == null ? 0 : was - next.get(el.dataset.flip);
      if (Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 360, easing: ease });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
