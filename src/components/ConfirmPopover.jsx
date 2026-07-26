import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ============================================================================
// 삭제 확인 팝오버 (프로젝트·업무·댓글·첨부 공용)
// ----------------------------------------------------------------------------
// - 트리거 버튼을 children으로 받고, 클릭하면 앵커 근처에 팝오버
// - position: fixed + getBoundingClientRect로 좌우/상하를 뷰포트 안에 클램프
//   (모바일에서 좌하단 휴지통 기준 팝오버가 화면 밖으로 잘리던 문제 해결)
// - 바깥 클릭 / Esc 닫기, 스크롤·리사이즈 시 위치 재계산
// ============================================================================
const W = 240;     // 팝오버 고정 폭
const GAP = 8;     // 화면 가장자리 최소 여백
const EST_H = 110; // 높이 추정치(위/아래 배치 판단용)

// 앵커 기준 fixed 위치를 뷰포트 안으로 클램프해 돌려주는 공용 훅
// (트리거가 화면 좌·우·하단에 붙어 있어도 팝오버가 잘리지 않게)
// measuredRef를 주면 팝오버가 그려진 뒤 실제 높이로 위치를 다시 잡는다.
// estHeight는 추정치라 실제보다 크면(예: 250 추정 / 150 실제) 위로 뜨는 팝오버가
// 트리거에서 100px 떨어져 붕 떠 보였다. 같은 레이아웃 패스에서 고치니 깜빡임은 없다.
export function useAnchoredPos(triggerRef, open, width, estHeight, gap = GAP, measuredRef = null) {
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const h = measuredRef?.current?.offsetHeight || estHeight;
    const maxLeft = Math.max(gap, vw - width - gap);
    const left = Math.min(Math.max(r.right - width, gap), maxLeft);
    const below = vh - r.bottom;
    const top = below < h + gap ? Math.max(gap, r.top - h - 4) : r.bottom + 4;
    setPos({ left, top });
  }, [triggerRef, width, estHeight, gap, measuredRef]);

  // useLayoutEffect: 브라우저가 그리기 전에 위치를 확정한다.
  // useEffect였을 때는 첫 프레임이 {0,0}에 그려지고 그 다음 프레임에 제자리로
  // 튀어서, 팝오버가 "어디 갔다 오는" 것처럼 보였다(알림·리소스 추가 등 전부).
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, place]);

  return [pos, place];
}

export function ConfirmPopover({ message, confirmLabel = '삭제', cancelLabel = '취소', onConfirm, children, title }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const [pos, place] = useAnchoredPos(triggerRef, open, W, EST_H);

  useEffect(() => {
    if (!open) return;
    // 팝오버가 포털로 나가 있으므로 바깥 클릭 판정에 팝오버 자신도 포함해야 한다
    const onDown = (e) => {
      const inside = rootRef.current?.contains(e.target) || popRef.current?.contains(e.target);
      if (!inside) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = (e) => { e.stopPropagation(); place(); setOpen(o => !o); };

  // 포털로 body에 띄운다 — 트리거가 hover에서만 보이는 영역(댓글의 수정·삭제 아이콘)
  // 안에 있으면, 마우스가 벗어날 때 부모의 opacity-0이 팝오버까지 같이 숨겨서
  // 확인창이 사라졌다 나타났다 했다.
  const popover = open ? createPortal(
    <div
      ref={popRef}
      onClick={e => e.stopPropagation()}
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: W }}
      className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-3 animate-in fade-in zoom-in-95 duration-150"
    >
      <p className="text-xs text-fg-secondary leading-relaxed mb-2.5 whitespace-normal break-words">{message}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-xs px-2.5 py-1.5 text-fg-muted hover:bg-surface-hover rounded-md transition active:scale-95">{cancelLabel}</button>
        <button type="button" onClick={() => { setOpen(false); onConfirm?.(); }} className="text-xs px-2.5 py-1.5 bg-red-500 text-white hover:bg-red-600 rounded-md transition active:scale-95 font-semibold">{confirmLabel}</button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <span className="inline-flex" ref={rootRef}>
      <span ref={triggerRef} onClick={toggle} className="inline-flex" title={title}>{children}</span>
      {popover}
    </span>
  );
}
