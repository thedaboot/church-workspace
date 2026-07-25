import React, { useState, useRef, useEffect, useCallback } from 'react';

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
export function useAnchoredPos(triggerRef, open, width, estHeight, gap = GAP) {
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const maxLeft = Math.max(gap, vw - width - gap);
    const left = Math.min(Math.max(r.right - width, gap), maxLeft);
    const below = vh - r.bottom;
    const top = below < estHeight + gap ? Math.max(gap, r.top - estHeight - 4) : r.bottom + 4;
    setPos({ left, top });
  }, [triggerRef, width, estHeight, gap]);

  useEffect(() => {
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
  const [pos, place] = useAnchoredPos(triggerRef, open, W, EST_H);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = (e) => { e.stopPropagation(); place(); setOpen(o => !o); };

  return (
    <span className="inline-flex" ref={rootRef}>
      <span ref={triggerRef} onClick={toggle} className="inline-flex" title={title}>{children}</span>
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: W }}
          className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-3 animate-in fade-in zoom-in-95 duration-150"
        >
          <p className="text-xs text-fg-secondary leading-relaxed mb-2.5 whitespace-normal break-words">{message}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="text-xs px-2.5 py-1.5 text-fg-muted hover:bg-surface-hover rounded-md transition active:scale-95">{cancelLabel}</button>
            <button type="button" onClick={() => { setOpen(false); onConfirm?.(); }} className="text-xs px-2.5 py-1.5 bg-red-500 text-white hover:bg-red-600 rounded-md transition active:scale-95 font-semibold">{confirmLabel}</button>
          </div>
        </div>
      )}
    </span>
  );
}
