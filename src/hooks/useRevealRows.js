import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './useReducedMotion.js';

// 긴 목록은 보일 때 들어온다(UI 다듬기 2차 M16 · 시안 값 그대로 · PITFALLS 75-e) — 명단 · 위키 목록 · 알림 판.
//   · **첫 화면 안의 줄은 움직이지 않는다.** 처음 잴 때 한 픽셀도 안 보이는 줄(그 통 밖 · 화면 밖)만 숨겨 두었다가,
//     15% 넘게 보이는 순간 10px 아래에서 떠오른다(opacity .4s ease-out · transform .55s quint). 한 번 들어온 줄은 다시 숨지 않는다.
//   · 바깥이 화면이든 줄을 품은 스크롤 통(알림 판 · 위키 옆 목록)이든 IntersectionObserver(root 없음)가 조상의 자름까지 보고 잰다.
//   · **인라인 style로 건다**(animation: none 포함). 줄에 `.dc-row` 같은 등장 애니메이션(fill both)이 있으면 클래스의 opacity가 그
//     애니메이션에 덮이고, className으로 걸면 React가 줄의 className을 다시 쓸 때 등장 애니메이션이 처음부터 다시 돈다.
//   · 움직임 줄이기 · IntersectionObserver 없는 브라우저면 아무것도 안 한다(지금처럼 다 보인다).
// key: 목록이 바뀌면(거르기·더 받기) 그 값을 바꿔 준다 — 새 줄을 다시 잰다(이미 들어온 줄은 그대로).
export const REVEAL = { threshold: 0.15, dy: 10, fade: 400, rise: 550 };

const hide = (el) => {
  el.style.animation = 'none';
  el.style.opacity = '0';
  el.style.transform = `translate3d(0, ${REVEAL.dy}px, 0)`;
  el.dataset.reveal = 'wait';
};
const show = (el) => {
  el.style.transition = `opacity ${REVEAL.fade}ms ease-out, transform ${REVEAL.rise}ms var(--ease-out-quint)`;
  el.style.opacity = '';
  el.style.transform = '';
  el.dataset.reveal = 'in';
  setTimeout(() => { if (el.dataset.reveal === 'in') { el.style.transition = ''; delete el.dataset.reveal; } }, REVEAL.rise);
};

export function useRevealRows(ref, selector, key) {
  const done = useRef(new WeakSet());
  useEffect(() => {
    const box = ref.current;
    if (!box || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return undefined;
    const rows = [...box.querySelectorAll(selector)].filter(r => !done.current.has(r));
    if (!rows.length) return undefined;
    const measured = new WeakSet();
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      const el = e.target;
      if (!measured.has(el)) {
        measured.add(el);
        if (e.intersectionRatio > 0) { done.current.add(el); io.unobserve(el); } else hide(el);
        return;
      }
      if (e.intersectionRatio >= REVEAL.threshold) { done.current.add(el); io.unobserve(el); show(el); }
    }), { threshold: [0, REVEAL.threshold] });
    rows.forEach(r => io.observe(r));
    return () => {
      io.disconnect();
      // 다시 재기 전에(목록이 바뀜 · 화면을 떠남) 숨겨 둔 줄을 풀어 둔다 — 숨은 채로 남는 줄이 없게
      rows.forEach((r) => { if (r.dataset.reveal === 'wait') { r.style.opacity = ''; r.style.transform = ''; delete r.dataset.reveal; } });
    };
  }, [ref, selector, key]);
}
