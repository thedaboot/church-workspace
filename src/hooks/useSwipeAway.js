import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './useReducedMotion.js';

// 손가락으로 오른쪽으로 쓸어 닫기(UI 다듬기 2차 M8 · 시안 값 그대로 · PITFALLS 74-b) — 폰 토스트(Toast.jsx) · 알림 판 줄(notificationBell.jsx).
//   · **손가락만**(pointerType이 mouse면 아무것도 안 한다) — 마우스는 원래대로 x 버튼·시간으로 닫는다.
//   · 오른쪽: 손을 따라간다(투명도는 260px에 걸쳐 .2까지). 왼쪽: 점점 무거워진다(rub · 40px 쪽으로 붙는다).
//   · 놓을 때 **90px를 넘었거나, 8px 넘게 밀면서 빠르기가 0.35px/ms 넘으면**(최근 120ms) 화면 밖으로 밀려 나가고 onAway.
//     아니면 제자리로 돌아온다(transform .3s quint · opacity .25s).
//   · 세로로 굴리기는 브라우저 몫이다(`touch-action: pan-y` — 부르는 쪽 CSS) — 굴리기가 시작되면 pointercancel이 와서 제자리로.
//   · 포인터를 잡지 않는다(setPointerCapture 금지) — 잡으면 그냥 누른 탭의 click이 안의 버튼(되돌리기·알림 열기)이 아니라 줄로 간다.
//     손가락은 브라우저가 처음 누른 요소에 저절로 잡아 두므로 밖으로 나가도 move가 온다. 쓸었으면 뒤따르는 click 한 번을 막는다.
export const SWIPE = { away: 90, flick: 0.35, flickMin: 8, fade: 260, rubber: 40, window: 120, back: 300, fadeBack: 250 };

// 점점 무거워짐 — d만큼 당겨도 c 쪽으로만 붙는다
export const rub = (d, c = SWIPE.rubber) => c * (1 - 1 / (d / c + 1));

// 놓을 때 닫을지 — dx(px) · v(px/ms)
export const swipeAway = (dx, v) => dx > SWIPE.away || (v > SWIPE.flick && dx > SWIPE.flickMin);

export function useSwipeAway(ref, onAway, { enabled = true } = {}) {
  const cb = useRef(onAway);
  cb.current = onAway;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;
    let id = null, x0 = 0, pts = [], moved = false, gone = false;
    const ms = (n) => (prefersReducedMotion() ? 0 : n);
    const ease = 'var(--ease-out-quint)';
    const down = (e) => {
      if (e.pointerType === 'mouse' || id !== null || gone) return;
      id = e.pointerId; x0 = e.clientX; pts = []; moved = false;
      el.style.transition = 'none';
    };
    const move = (e) => {
      if (e.pointerId !== id) return;
      const t = performance.now();
      pts.push({ x: e.clientX, t }); pts = pts.filter(p => t - p.t < SWIPE.window);
      const dx = e.clientX - x0;
      if (Math.abs(dx) > SWIPE.flickMin) moved = true;
      el.style.transform = `translateX(${dx >= 0 ? dx : -rub(-dx)}px)`;
      el.style.opacity = String(Math.max(0.2, 1 - Math.max(0, dx) / SWIPE.fade));
    };
    const velocity = () => {
      const now = performance.now(); const p = pts.filter(q => now - q.t < SWIPE.window);
      if (p.length < 2) return 0;
      const a = p[0], b = p[p.length - 1];
      return (b.x - a.x) / Math.max(1, b.t - a.t);
    };
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      const dx = e.type === 'pointercancel' ? 0 : e.clientX - x0;
      el.style.transition = `transform ${ms(SWIPE.back)}ms ${ease}, opacity ${ms(SWIPE.fadeBack)}ms`;
      if (swipeAway(dx, velocity())) {
        gone = true;
        el.style.transform = `translateX(${Math.max(window.innerWidth, el.offsetWidth)}px)`;
        el.style.opacity = '0';
        setTimeout(() => cb.current?.(), ms(SWIPE.back));
      } else {
        el.style.transform = ''; el.style.opacity = '';
        setTimeout(() => { if (id === null) el.style.transition = ''; }, ms(SWIPE.back));
      }
    };
    // 쓸었으면 손을 뗀 뒤 오는 click 한 번은 버튼 누름이 아니다
    const click = (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', click, true);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('click', click, true);
    };
  }, [ref, enabled]);
}
