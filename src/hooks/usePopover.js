import { createElement, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPos } from '../components/ConfirmPopover.jsx';
import { useDismiss } from './useDismiss.js';

// 버튼 하나에 붙어 떠 있는 판의 껍데기 한 벌 — 열림 · 앵커 자리(useAnchoredPos) · 바깥 누름/Esc 닫기(useDismiss) ·
// body 포털 · 등장 모션. 상단 내비의 프로필 메뉴 · 프로젝트 더보기 · 연도 고르기 · 알림 종이 쓴다(19차 묶음 D에서
// 네 벌을 모았다). **다른 파일의 팝오버는 아직 각자 들고 있다**(뒤 묶음이 옮긴다).
//
//   const pop = usePopover(224, 200, { gap: 8, measure: true });
//   <span ref={pop.rootRef}><span ref={pop.btnRef}><button onClick={pop.toggle}>…</button></span>
//     {pop.panel('z-[90] bg-surface …', children)}</span>
//
// · toggle은 **열기 전에 자리를 잡는다**(place 먼저) — 첫 프레임이 {0,0}에 그려지면 좌상단에서 날아온다(PITFALLS 17).
// · measure: 판의 실제 높이로 다시 잡는다(위로 뜨는 판이 추정 높이만큼 떠 보이지 않게 · PITFALLS 17).
// · 판 클래스 끝에 POP_MOTION을 **여기서** 붙인다 — 자리를 state(left/top)로 잡는 판에 `transition-none`이
//   없으면 tailwind `duration-150`이 top/left까지 전이시켜 첫 배치에서 미끄러져 들어온다(PITFALLS 17-b).
//   부르는 쪽은 모양 클래스만 넘긴다.
// · 포털로 나간 판도 useDismiss의 '안'에 넣는다(PITFALLS 17-d).
// · portal: false — 판을 앵커 곁(rootRef 안)에 그대로 둔다. 알림 종이 원래 그렇다(옮기면 자리·쌓임이 바뀐다).
export const POP_MOTION = 'transition-none animate-in fade-in zoom-in-95 duration-150';

export function usePopover(width, estHeight, { gap, measure = false, portal = true } = {}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open, width, estHeight, gap, measure ? popRef : null);
  useDismiss(open, () => setOpen(false), [rootRef, popRef]);
  const toggle = () => { place(); setOpen(o => !o); };
  const close = () => setOpen(false);
  const panel = (className, children) => {
    if (!open) return null;
    const el = createElement('div', {
      ref: popRef,
      style: { position: 'fixed', left: pos.left, top: pos.top, width },
      className: `${className} ${POP_MOTION}`,
    }, children);
    return portal ? createPortal(el, document.body) : el;
  };
  return { open, close, toggle, rootRef, btnRef, panel };
}
