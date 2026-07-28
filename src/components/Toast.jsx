import React, { useState, useEffect } from 'react';

// ============================================================================
// 초경량 토스트 — 전역 showToast(message)로 호출
// ----------------------------------------------------------------------------
// iOS Safari에서 window.alert은 화면 전체를 막는 모달이라 UX가 파괴적이므로
// 클라우드 오류 알림 등은 모두 이 토스트로 표시한다. 동시 1개, 4초 자동 소멸.
//
// 동작 버튼이 하나 붙을 수 있다: showToast('옮겼어요', { label: '되돌리기', onAction })
// 그 경우에만 토스트가 클릭을 받는다(그 외에는 pointer-events-none이라 아래 화면을
// 가리지 않는다).
// ============================================================================
let emit = null;

export function showToast(message, action = null) {
  if (!message) return;
  if (emit) emit(String(message), action && action.label && action.onAction ? action : null);
  else console.warn('[toast] 아직 마운트되지 않음:', message);
}

// 동작 버튼이 있는 토스트는 조금 더 오래 둔다 — 4초 안에 읽고 누르기는 짧다
const HOLD_MS = 4000;
const HOLD_MS_ACTION = 7000;

export function ToastHost() {
  const [toast, setToast] = useState(null); // { id, message, action }

  useEffect(() => {
    emit = (message, action) => setToast({ id: Date.now(), message, action });
    return () => { emit = null; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.action ? HOLD_MS_ACTION : HOLD_MS);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  // 모바일 하단 탭바(약 4.5rem + safe-area) 위로 띄운다 — 그냥 bottom-6이면
  // 되돌리기 버튼이 탭바에 가려 눌리지 않는다
  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-[100] pointer-events-none px-4 w-full flex justify-center bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6">
      <div
        key={toast.id} role="status"
        className={`bg-fg text-canvas rounded-lg shadow-elevated px-4 py-2.5 text-xs max-w-[calc(100vw-2rem)] leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-200 ${toast.action ? 'pointer-events-auto flex items-center gap-3 text-left' : 'text-center'}`}
      >
        <span className="min-w-0">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            onClick={() => { const fn = toast.action.onAction; setToast(null); fn(); }}
            className="shrink-0 font-bold underline underline-offset-2 transition active:scale-95"
          >{toast.action.label}</button>
        )}
      </div>
    </div>
  );
}
