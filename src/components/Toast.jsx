import { useState, useEffect, useRef } from 'react';
import { usePresence } from '../hooks/useExit.js';

// ============================================================================
// 초경량 토스트 — 전역 showToast(message)로 호출
// ----------------------------------------------------------------------------
// iOS Safari에서 window.alert은 화면 전체를 막는 모달이라 UX가 파괴적이므로
// 클라우드 오류 알림 등은 모두 이 토스트로 표시한다. 4초 자동 소멸.
//
// 동작 버튼이 하나 붙을 수 있다: showToast('옮겼어요', { label: '되돌리기', onAction })
// 그 경우에만 토스트가 클릭을 받는다(그 외에는 pointer-events-none이라 아래 화면을
// 가리지 않는다).
//
// **자리는 둘이다**(UX 다듬기 α · 2026-10-15 · PITFALLS 54-a) — 동작 토스트 하나와 그냥 토스트 하나. 예전에는 한 자리라
// '되돌리기'가 떠 있는 동안 아무 토스트(저장 실패 · 다른 안내)가 오면 되돌리기가 그 자리에서 사라졌다. 그냥 토스트는 동작
// 토스트를 밀어내지 않고 **그 위에** 선다(아래 자리는 늘 동작 토스트 — 누르려던 버튼이 옮겨 가지 않는다).
// 같은 갈래끼리는 예전처럼 새것이 옛것을 갈아 낀다.
// ============================================================================
let emit = null;

export function showToast(message, action = null) {
  if (!message) return;
  if (emit) emit(String(message), action && action.label && action.onAction ? action : null);
  else console.warn('[toast] 아직 마운트되지 않음:', message);
}

// 동작 버튼이 있는 토스트는 조금 더 오래 둔다 — 4초 안에 읽고 누르기는 짧다.
// 업무 삭제의 되돌리기는 이 시간 동안 서버 삭제를 미룬다(controllers.handleDeleteTask).
const HOLD_MS = 4000;
export const HOLD_MS_ACTION = 7000;

let seq = 0;
// 한 자리의 수명 — 뜬 뒤 hold만큼 있다가 걷힌다
function useSlot(hold) {
  const [toast, setToast] = useState(null); // { id, message, action }
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), hold);
    return () => clearTimeout(t);
  }, [toast, hold]);
  return [toast, setToast];
}

export function ToastHost() {
  const [act, setAct] = useSlot(HOLD_MS_ACTION);
  const [plain, setPlain] = useSlot(HOLD_MS);

  useEffect(() => {
    emit = (message, action) => {
      const t = { id: ++seq, message, action };
      if (action) setAct(t); else setPlain(t);
    };
    return () => { emit = null; };
  }, [setAct, setPlain]);

  // 모바일 하단 탭바(약 4.5rem + safe-area) 위로 띄운다 — 그냥 bottom-6이면
  // 되돌리기 버튼이 탭바에 가려 눌리지 않는다.
  // z는 body 포털 창들(첨부 미리보기·문서 창 z-100 · 공유 시트 z-120)보다 위다 — 이 토스트는
  // #root 안에 있고 포털은 body 끝에 붙어 문서 순서가 뒤라, 같은 z면 창이 토스트를 덮는다.
  // 둘이 함께면 세로로 쌓는다 — 묶음의 아래끝이 그대로라 동작 토스트(아래)는 자리를 지킨다.
  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-[130] pointer-events-none px-4 w-full flex flex-col items-center gap-2 bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6">
      <ToastSlot toast={plain} />
      <ToastSlot toast={act} onAction={() => { const fn = act.action.onAction; setAct(null); fn(); }} />
    </div>
  );
}

// 한 자리 — 사라질 때도 걷히는 것을 그린다(.dc-toast.dc-out · hooks/useExit.js). 그동안 마지막 토스트를 그대로 든다.
// 새 토스트는 key가 바뀌어 처음부터 다시 들어온다.
function ToastSlot({ toast, onAction }) {
  const lastRef = useRef(null);
  if (toast) lastRef.current = toast;
  const { shown, leaving } = usePresence(!!toast);
  const t = toast || lastRef.current;
  if (!shown || !t) return null;
  return <ToastBox key={t.id} toast={t} leaving={leaving} onAction={toast ? onAction : undefined} />;
}

function ToastBox({ toast, leaving, onAction }) {
  return (
    <div
      role="status" data-toast={toast.action ? 'action' : ''}
      // 폭을 묶는다 — max-w를 화면 폭으로 두면 데스크톱에서 긴 문구가 한 줄로
      // 화면을 가로질러 한눈에 안 들어온다(사용자 지적). 28rem에서 접히고,
      // 모바일에서는 화면 폭이 먼저 걸린다.
      className={`bg-fg text-canvas rounded-lg shadow-elevated px-4 py-2.5 text-xs max-w-[min(28rem,calc(100vw-2rem))] leading-relaxed dc-toast${leaving ? ' dc-out' : ''} ${toast.action ? 'pointer-events-auto flex items-center gap-3 text-left' : 'text-center'}`}
    >
      {/* 문구에 든 줄바꿈을 그대로 그린다 — 두 마디짜리 안내를 한 줄로 붙여 놓으면
          길어져서 읽히지 않는다(failText가 긴 것만 줄을 나눈다) */}
      <span className="min-w-0 whitespace-pre-line">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 font-bold underline underline-offset-2 transition active:scale-95"
        >{toast.action.label}</button>
      )}
    </div>
  );
}
