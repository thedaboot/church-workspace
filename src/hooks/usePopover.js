import { createElement, useState, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPos, popMotion } from '../components/ConfirmPopover.jsx';
import { useDismiss } from './useDismiss.js';
import { usePresence } from './useExit.js';

// 버튼 하나에 붙어 떠 있는 판의 껍데기 한 벌 — 열림 · 앵커 자리(useAnchoredPos) · 바깥 누름/Esc 닫기(useDismiss) ·
// body 포털 · 등장 모션. 상단 내비의 프로필 메뉴 · 프로젝트 더보기 · 연도 고르기 · 알림 종이 쓴다(19차 묶음 D에서
// 네 벌을 모았다). **다른 파일의 팝오버는 아직 각자 들고 있다.**
//
//   const pop = usePopover(224, 200, { gap: 8, measure: true });
//   <span ref={pop.rootRef}><span ref={pop.btnRef}><button onClick={pop.toggle}>…</button></span>
//     {pop.panel('z-[90] bg-surface …', children)}</span>
//
// · toggle은 **열기 전에 자리를 잡는다**(place 먼저) — 첫 프레임이 {0,0}에 그려지면 좌상단에서 날아온다(PITFALLS 17).
// · measure: 판의 실제 높이로 다시 잡는다(위로 뜨는 판이 추정 높이만큼 떠 보이지 않게 · PITFALLS 17).
// · 판 클래스 끝에 POP_MOTION을 **여기서** 붙인다 — 앱의 '떠 있는 것 모션' 한 벌(index.css `.dc-pop` · 앵커 쪽에서
//   자란다 — popMotion(pos)). 자리를 state(left/top)로 잡는 판이라 `transition-none`을 같이 둔다(PITFALLS 17-b).
//   부르는 쪽은 모양 클래스만 넘긴다.
// · 닫힐 때는 걷히는 동안(EXIT_MS) 판을 그려 두고 `dc-out`을 붙인다(hooks/useExit.js · 누름은 바로 놓는다).
//   `open`은 그 사이에도 false다 — 부르는 쪽의 '열렸나'는 바로 바뀐다.
// · 포털로 나간 판도 useDismiss의 '안'에 넣는다(PITFALLS 17-d).
// · portal: false — 판을 앵커 곁(rootRef 안)에 그대로 둔다. 알림 종이 원래 그렇다(옮기면 자리·쌓임이 바뀐다).
// · fit: 고른 쪽(아래가 기본)에 남은 높이를 pos.maxHeight로 준다(useAnchoredPos fitHeight · estHeight가 위 한계).
//   panel의 셋째 인자(style)로 그 높이를 판에 걸면, 안이 늘어도 판이 위로 밀려 올라가지 않고 판 안의 한 칸만 구른다
//   (보는 사람 고르기 · 시안 2026-10-16).
// · native: 브라우저 기본 팝오버(UI 다듬기 2차 D9 · PITFALLS 79-a) — 판을 `popover="manual"`로 맨 위 층에 올리고 등장·퇴장을
//   CSS(`.dc-pop-native` · @starting-style · allow-discrete)가 그린다. 브라우저가 셋 다 알 때만(nativePopover()) — 모르면 위 길 그대로.
//   manual이라 바깥 누름·Esc는 지금처럼 useDismiss가 정하고(브라우저의 가벼운 닫기(auto)를 쓰면 종을 다시 누를 때 누름에 닫히고 클릭에 곧 다시 열린다),
//   자리도 지금처럼 인라인 left/top이다. 닫힌 판을 걷는 때(EXIT_MS)도 같다 — 걷기 전에 hidePopover로 퇴장 전이를 건다.
//   **지금은 알림 판 하나만 켠다**(폰 사파리·카카오 인앱 실기기 확인 뒤 넓힌다).
export const POP_MOTION = 'transition-none dc-pop';

// 브라우저가 popover · allow-discrete 전이 · @starting-style을 다 아는가. @starting-style은 CSS.supports로 못 물어서
// 규칙 하나를 넣어 보고 버려지는지 본다(모르는 @규칙은 cssRules에 남지 않는다) — 한 번만 잰다. showPopover는 부를 때마다 본다(검사가 지운다).
let startingStyle;
export function nativePopover() {
  if (typeof HTMLElement === 'undefined' || typeof HTMLElement.prototype.showPopover !== 'function') return false;
  if (typeof CSS === 'undefined' || !CSS.supports?.('transition-behavior', 'allow-discrete')) return false;
  if (startingStyle === undefined) {
    try {
      const s = document.createElement('style');
      s.textContent = '@starting-style{.x{opacity:0}}';
      document.head.appendChild(s);
      startingStyle = !!s.sheet && s.sheet.cssRules.length > 0;
      s.remove();
    } catch { startingStyle = false; }
  }
  return startingStyle;
}

export function usePopover(width, estHeight, { gap, measure = false, portal = true, fit = false, native: wantNative = false } = {}) {
  const [native] = useState(() => wantNative && nativePopover());
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open, width, estHeight, gap, measure ? popRef : null, fit ? { fitHeight: true } : null);
  useDismiss(open, () => setOpen(false), [rootRef, popRef]);
  const toggle = () => { place(); setOpen(o => !o); };
  const close = () => setOpen(false);
  const { shown, leaving } = usePresence(open);
  // native: 붙는 순간 띄운다(ref — 아래 레이아웃 효과·rAF의 measure보다 먼저). 판 **안** 자식의 레이아웃 효과는 이보다 먼저 돌아
  // 아직 숨은(display: none) 판을 재게 된다 — 자식이 자기를 재면 안 보일 때는 건너뛰어야 한다(알림 판 useSmoothHeight · 79-a).
  // 닫히면 hidePopover로 퇴장 전이를 걸고, 걷히는 사이에 다시 열면 다시 띄운다.
  const setPop = useCallback((el) => {
    popRef.current = el;
    if (native && el && !el.matches(':popover-open')) el.showPopover();
  }, [native]);
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!native || !el) return;
    const on = el.matches(':popover-open');
    if (open && !on) el.showPopover();
    else if (!open && on) el.hidePopover();
  }, [native, open, shown]);
  const panel = (className, children, style = null) => {
    if (!shown) return null;
    const el = createElement('div', {
      ref: native ? setPop : popRef,
      popover: native ? 'manual' : undefined,
      style: { position: 'fixed', left: pos.left, top: pos.top, width, ...style, ...popMotion(pos) },
      className: native ? `${className} dc-pop-native` : `${className} ${POP_MOTION}${leaving ? ' dc-out' : ''}`,
      'aria-hidden': leaving || undefined,
    }, children);
    return portal ? createPortal(el, document.body) : el;
  };
  return { open, close, toggle, rootRef, btnRef, panel, pos, native };
}
