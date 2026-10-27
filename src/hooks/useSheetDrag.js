import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './useReducedMotion.js';
import { rub } from './useSwipeAway.js';

// 폰 업무 창을 손잡이(머리줄)로 끌어 내려 닫기(UI 다듬기 2차 M10 · 시안 값 그대로 · PITFALLS 75-a).
//   · **손가락만**(마우스는 아무것도 안 한다 — ✕·닫기 버튼으로 닫는다). 머리줄 안의 버튼·글 칸에서 시작한 누름은 끌기가 아니다.
//   · 아래로: 손을 그대로 따라간다. 위로: 점점 무거워진다(rub · 40px 쪽으로 붙는다 — 쓸어 닫기와 같은 함수).
//   · 놓을 때 **창 높이의 절반을 넘었거나, 10px 넘게 내리면서 빠르기가 0.45px/ms 넘으면**(최근 120ms) 닫는다 —
//     onFling()이 false를 돌려주면(저장 안 한 새 업무 등) 닫지 않고 제자리로.
//   · 닫을 때는 창이 화면 아래로 마저 내려가고, 돌아올 때는 제자리로 — 둘 다 아이폰 시트 곡선 500ms(M12 · --ease-sheet).
//   · 손잡이에는 `touch-action: none`(.dc-sheet-grab)을 준다 — 없으면 브라우저가 당겨서 새로고침·스크롤로 손을 가져간다.
//   · 포인터를 잡지 않는다(74-b와 같은 판단) — 손가락은 처음 누른 요소에 저절로 잡혀 밖으로 나가도 move가 온다.
export const SHEET = { flick: 0.45, flickMin: 10, rubber: 40, window: 120, ms: 500, ease: 'var(--ease-sheet)' };

// 놓을 때 닫을지 — dy(px · 아래가 +) · v(px/ms) · h(창 높이)
export const sheetFling = (dy, v, h) => dy > h / 2 || (v > SHEET.flick && dy > SHEET.flickMin);

const NOT_GRAB = 'button, a, input, textarea, select, label, [contenteditable="true"], [role="button"]';

export function useSheetDrag(handleRef, sheetRef, onFling, { enabled = true } = {}) {
  const cb = useRef(onFling);
  cb.current = onFling;
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !enabled) return undefined;
    let id = null, y0 = 0, pts = [], moved = false, gone = false;
    const ms = () => (prefersReducedMotion() ? 0 : SHEET.ms);
    const sheet = () => sheetRef.current;
    const down = (e) => {
      if (e.pointerType === 'mouse' || id !== null || gone || e.target?.closest?.(NOT_GRAB)) return;
      const s = sheet();
      if (!s) return;
      id = e.pointerId; y0 = e.clientY; pts = []; moved = false;
      s.style.transition = 'none';
    };
    const move = (e) => {
      if (e.pointerId !== id) return;
      const t = performance.now();
      pts.push({ y: e.clientY, t }); pts = pts.filter(p => t - p.t < SHEET.window);
      const dy = e.clientY - y0;
      if (Math.abs(dy) > 4) moved = true;
      sheet().style.transform = `translateY(${dy >= 0 ? dy : -rub(-dy, SHEET.rubber)}px)`;
    };
    const velocity = () => {
      const now = performance.now(); const p = pts.filter(q => now - q.t < SHEET.window);
      if (p.length < 2) return 0;
      const a = p[0], b = p[p.length - 1];
      return (b.y - a.y) / Math.max(1, b.t - a.t);
    };
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      const s = sheet();
      if (!s) return;
      const dy = e.type === 'pointercancel' ? 0 : e.clientY - y0;
      s.style.transition = `transform ${ms()}ms ${SHEET.ease}`;
      if (moved && sheetFling(dy, velocity(), s.offsetHeight) && cb.current?.() !== false) {
        gone = true;
        s.style.transform = `translateY(${s.offsetHeight + 12}px)`;
        return;
      }
      s.style.transform = '';
      setTimeout(() => { if (id === null && !gone) s.style.transition = ''; }, ms());
    };
    // 끌었으면 손을 뗀 뒤 오는 click 한 번은 누름이 아니다
    const click = (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } };
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    handle.addEventListener('click', click, true);
    return () => {
      handle.removeEventListener('pointerdown', down);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.removeEventListener('click', click, true);
    };
  }, [handleRef, sheetRef, enabled]);
}
