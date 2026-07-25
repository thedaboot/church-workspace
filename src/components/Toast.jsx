import React, { useState, useEffect } from 'react';

// ============================================================================
// 초경량 토스트 — 전역 showToast(message)로 호출
// ----------------------------------------------------------------------------
// iOS Safari에서 window.alert은 화면 전체를 막는 모달이라 UX가 파괴적이므로
// 클라우드 오류 알림 등은 모두 이 토스트로 표시한다. 동시 1개, 4초 자동 소멸.
// ============================================================================
let emit = null;

export function showToast(message) {
  if (!message) return;
  if (emit) emit(String(message));
  else console.warn('[toast] 아직 마운트되지 않음:', message);
}

export function ToastHost() {
  const [toast, setToast] = useState(null); // { id, message }

  useEffect(() => {
    emit = (message) => setToast({ id: Date.now(), message });
    return () => { emit = null; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] pointer-events-none px-4 w-full flex justify-center">
      <div
        key={toast.id} role="status"
        className="bg-fg text-canvas rounded-lg shadow-elevated px-4 py-2.5 text-xs max-w-[calc(100vw-2rem)] text-center leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        {toast.message}
      </div>
    </div>
  );
}
