import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { useLeave } from '../hooks/useExit.js';
import { BTN_CONFIRM, BTN_CONFIRM_QUIET } from './buttons.js';

// ============================================================================
// 영수증 선택(사용자 승인 시안 A-1 · 문구 확정 2026-10-22)
// ----------------------------------------------------------------------------
// '파일 올리기'로 손으로 만든 보고서 엑셀을 올리면 그 안 그림 가운데 어느 것이 영수증인지 앱이 모른다 —
// 그림을 찾으면 이 시트를 띄워 사람이 고른다. 고른 것은 영수증, 나머지는 활동 사진. '건너뛰기'·바깥 누르기·Esc는 모두 활동 사진.
// 폰은 아래 시트, 데스크톱은 가운데 창(작성 화면과 같은 틀 · .dc-sheet-dialog). onDone(고른 id 배열).
// ============================================================================

export function ReceiptPicker({ photos = [], onDone }) {
  const [leaving, leave] = useLeave();
  const [picked, setPicked] = useState(() => new Set());
  const downOnScrim = useRef(false);
  const finish = (ids) => leave(() => onDone(ids));
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') finish([]); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  const toggle = (id) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const out = leaving ? ' dc-out' : '';
  return createPortal(
    <div onMouseDown={(e) => { downOnScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnScrim.current) finish([]); }}
      className={`fixed inset-x-0 top-[var(--vv-top,0px)] h-[var(--app-vh,100dvh)] z-[96] flex items-end md:items-center md:justify-center md:p-4 bg-black/50 dc-scrim${out}`}>
      <div role="dialog" aria-label="영수증 선택" data-receipt-picker=""
        className={`w-full md:max-w-[480px] max-h-[88%] flex flex-col overflow-hidden bg-surface rounded-t-2xl md:rounded-lg md:border md:border-line md:shadow-elevated dc-sheet-dialog${out}`}>
        <span className="md:hidden shrink-0 self-center w-9 h-1 mt-2.5 rounded-full bg-line" />
        <div className="px-5 pt-3 md:pt-5 shrink-0">
          <h3 className="font-bold text-fg tracking-[-0.25px]">영수증 선택</h3>
          <p className="mt-1 text-[12px] text-fg-muted leading-relaxed">
            {`엑셀에서 사진 ${photos.length}장을 발견했어요.`}<br />이 중에서 영수증으로 등록할 사진을 골라주세요.
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-3 pb-4">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {photos.map(p => {
              const on = picked.has(p.id);
              return (
                <button key={p.id} type="button" aria-pressed={on} onClick={() => toggle(p.id)} data-receipt-pick={p.id}
                  className="relative aspect-square rounded-xs overflow-hidden border border-line bg-canvas transition active:scale-95">
                  <img src={p.dataUrl || p.url} alt={p.name} className="w-full h-full object-cover" />
                  {/* 고른 테두리는 그림 위 층에 — 안쪽 ring은 그림에 덮였다 */}
                  {on && <span className="absolute inset-0 rounded-xs ring-[3px] ring-inset ring-accent pointer-events-none" />}
                  <span className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${on ? 'bg-accent border-accent text-white' : 'bg-black/25 border-white text-transparent'}`}>
                    <Check size={11} strokeWidth={3} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2 px-5 pt-3 shrink-0 border-t border-line" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={() => finish([])} className={`${BTN_CONFIRM_QUIET} px-3`}>건너뛰기</button>
          <span className="flex-1" />
          <button type="button" onClick={() => finish([...picked])} data-receipt-done="" className={BTN_CONFIRM}>
            {picked.size ? `영수증 ${picked.size}장 선택 완료` : '선택 완료'}
          </button>
        </div>
      </div>
    </div>,
    document.body);
}
