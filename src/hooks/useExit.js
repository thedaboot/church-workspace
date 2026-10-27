import { useState, useEffect, useRef, useCallback } from 'react';
import { prefersReducedMotion } from './useReducedMotion.js';

// 떠 있는 것의 **닫힘**을 그리는 동안만 살려 두는 한 벌(2026-10-15 · index.css '떠 있는 것 모션' · PITFALLS 57).
// 닫히는 판에는 `dc-out`을 붙인다 — 같은 모양 클래스(.dc-pop · .dc-dialog …)와 짝이 되어 거꾸로 짧게 걷힌다.
// 움직임 줄이기에서는 기다리지 않는다(바로 내린다 — 그 CSS는 animation: none이라 기다리면 판이 멈춰 서 있다).
//
//   usePresence(open)  열림 값을 밖에서 받는 판(팝오버) — { shown, leaving }. 닫혀도 EXIT_MS 동안 shown.
//   useLeave()         닫기를 스스로 부르는 창(대화창·업무 창) — [leaving, leave]. leave(fn)은 걷는 것을 그린 뒤 fn.
//                      두 번 불러도 한 번만 닫는다(걷히는 동안 딤을 또 누르는 일).
//                      leave(fn, wait) — 그 한 번만 기다리는 길이를 바꾼다(폰 업무 창을 끌어 내려 닫을 때 500ms · useSheetDrag).
export const EXIT_MS = 180;   // index.css --dur-exit와 같은 값

export function usePresence(open, ms = EXIT_MS) {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) { setShown(true); return undefined; }
    if (prefersReducedMotion()) { setShown(false); return undefined; }
    const t = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { shown: open || shown, leaving: !open && shown };
}

export function useLeave(ms = EXIT_MS) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const leave = useCallback((fn, wait = ms) => {
    if (prefersReducedMotion()) { fn?.(); return; }
    if (timer.current) return;
    setLeaving(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setLeaving(false);   // 부르는 쪽이 닫지 않았으면(거절) 다시 선다
      fn?.();
    }, wait);
  }, [ms]);
  return [leaving, leave];
}
