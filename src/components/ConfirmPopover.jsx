import React, { useState, useRef, useEffect } from 'react';

// ============================================================================
// 삭제 확인 팝오버 (프로젝트·업무·댓글 공용)
// ----------------------------------------------------------------------------
// - 트리거 버튼을 children으로 받고, 클릭하면 앵커 아래(공간 부족 시 위)에 팝오버
// - 바깥 클릭 / Esc 닫기, 화면 폭 클램프(max-w-[calc(100vw-2rem)])
// - 확인 버튼은 위험(bg-red-500) 스타일
// ============================================================================
export function ConfirmPopover({ message, confirmLabel = '삭제', cancelLabel = '취소', onConfirm, children, align = 'right', title }) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = (e) => {
    e.stopPropagation();
    // 트리거 하단 여유가 부족하면 위로 띄움
    const el = triggerRef.current;
    if (el) { const r = el.getBoundingClientRect(); setDropUp(window.innerHeight - r.bottom < 180); }
    setOpen(o => !o);
  };

  return (
    <span className="relative inline-flex" ref={rootRef}>
      <span ref={triggerRef} onClick={toggle} className="inline-flex" title={title}>{children}</span>
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          className={`absolute z-50 w-max min-w-[12rem] max-w-[calc(100vw-2rem)] bg-surface border border-line rounded-lg shadow-elevated p-3 animate-in fade-in zoom-in-95 duration-150 ${align === 'left' ? 'left-0' : 'right-0'} ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}
        >
          <p className="text-xs text-fg-secondary leading-relaxed mb-2.5 whitespace-normal">{message}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="text-xs px-2.5 py-1.5 text-fg-muted hover:bg-surface-hover rounded-md transition active:scale-95">{cancelLabel}</button>
            <button type="button" onClick={() => { setOpen(false); onConfirm?.(); }} className="text-xs px-2.5 py-1.5 bg-red-500 text-white hover:bg-red-600 rounded-md transition active:scale-95 font-semibold">{confirmLabel}</button>
          </div>
        </div>
      )}
    </span>
  );
}
