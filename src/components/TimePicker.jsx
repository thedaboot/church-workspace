import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';
import { useAnchoredPos, popMotion } from './ConfirmPopover.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { prefersReducedMotion } from '../hooks/useReducedMotion.js';
import { koTime } from '../services/events.js';
import { imeComposing } from '../utils.js';

// ============================================================================
// 시간 픽커 — 데이트피커(DatePicker.jsx)와 한 벌(사용자 승인 목업 ①-b 2026-10-19 · 행사 일정 시각 0116)
// ----------------------------------------------------------------------------
// value 'HH:MM'(KST 24시) 또는 '' · onChange(next) · 판은 데이트피커와 같은 껍데기(포털 · 버튼 왼쪽 끝 · .dc-pop).
//   · 위 오전/오후(흰 알약이 옆으로 미끄러진다) · 아래 시(12·1…11) · 분(10분 단위) 두 줄.
//   · 열면 고른 값이 줄 가운데로 굴러온다(quint 380ms · 움직임 줄이기면 바로). 값이 없으면 openAt(종료는 시작 + 1시간)에서 연다.
//   · 시를 누르면 값이 바뀌고 분 줄로 초점 · 분을 누르면 닫힌다. 오전/오후도 값이 있으면 바로 바꾼다.
//   · minHM — 같은 날 종료처럼 그보다 같거나 앞인 칸은 흐리고 못 누른다.
//   · 키보드: ↑↓ 한 칸 · ←→ 시/분 줄 · Enter 닫기 · Esc 닫기.
//   · 폰은 같은 판(칸 40px) — 기기 시간 휠을 쓰지 않아 아이폰·갤럭시가 같은 모양이다.
// ============================================================================
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINS = [0, 10, 20, 30, 40, 50];
const POP_W = 236;
const POP_H = 300;
const pad = (n) => String(n).padStart(2, '0');
const parse = (v) => {
  const m = /^(\d{2}):(\d{2})/.exec(String(v || ''));
  return m ? { h: Number(m[1]), mi: Number(m[2]) } : null;
};
const to24 = (h12, pm) => (h12 % 12) + (pm ? 12 : 0);
const hm = (h, mi) => `${pad(h)}:${pad(mi)}`;

const TRIGGER = 'inline-flex items-center gap-1.5 border border-line rounded-xs bg-surface px-2 py-1.5 text-xs text-fg hover:bg-surface-hover focus:border-accent focus:shadow-soft outline-none transition-all';

// 줄을 고른 칸이 가운데 오게 굴린다 — quint(데이트피커·앱 모션과 같은 곡선)
function rollTo(col, el, instant) {
  if (!col || !el) return;
  const target = Math.max(0, el.offsetTop - (col.clientHeight - el.offsetHeight) / 2);
  if (instant || prefersReducedMotion()) { col.scrollTop = target; return; }
  const from = col.scrollTop, dist = target - from, t0 = performance.now(), ms = 380;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    col.scrollTop = from + dist * (1 - (1 - k) ** 5);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function TimePicker({ value, onChange, ariaLabel = '시간 선택', triggerClassName = TRIGGER, allowClear = true, openAt = '10:00', minHM = '' }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const cur = parse(value);
  const base = cur || parse(openAt) || { h: 10, mi: 0 };
  const [pm, setPm] = useState(base.h >= 12);
  const [focusCol, setFocusCol] = useState(0);   // 0 시 · 1 분
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const hourCol = useRef(null);
  const minCol = useRef(null);
  const [pos] = useAnchoredPos(triggerRef, open, POP_W, POP_H, 8, popRef, { align: 'start' });

  // 열 때 오전/오후를 값(없으면 openAt)에 맞추고 두 줄을 가운데로 굴린다 — 첫 프레임은 바로, 그 뒤 값이 바뀌면 굴러간다
  useLayoutEffect(() => {
    if (!open) return;
    setPm(base.h >= 12);
    setFocusCol(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const shownH = cur ? cur.h : base.h;
  const shownMi = cur ? cur.mi : base.mi;
  const first = useRef(true);
  useEffect(() => { if (!open) first.current = true; }, [open]);
  useEffect(() => {
    if (!open) return;
    const instant = first.current;
    first.current = false;
    rollTo(hourCol.current, hourCol.current?.querySelector('[data-on="true"]'), instant);
    rollTo(minCol.current, minCol.current?.querySelector('[data-on="true"]'), instant);
  }, [open, shownH, shownMi, pm]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!(rootRef.current?.contains(e.target) || popRef.current?.contains(e.target))) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [open]);

  const blocked = (h24, mi) => !!minHM && hm(h24, mi) <= minHM;
  const commit = (h24, mi) => { if (!blocked(h24, mi)) onChange(hm(h24, mi)); };
  const pickHour = (h12) => { commit(to24(h12, pm), shownMi); setFocusCol(1); };
  const pickMin = (mi) => { commit(cur ? cur.h : to24(base.h % 12 || 12, pm), mi); setOpen(false); };
  const flip = (next) => { setPm(next); if (cur) commit(to24(cur.h % 12 || 12, next), cur.mi); };
  const now = () => {
    const d = new Date();
    const mi = Math.min(50, Math.round(d.getMinutes() / 10) * 10);
    onChange(hm(d.getHours(), mi));
    setOpen(false);
  };

  // 키보드 — 판 안에서만(일정 창의 Esc 닫기보다 먼저 · 캡처)
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (imeComposing(e)) return;
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setFocusCol(c => (e.key === 'ArrowLeft' ? 0 : 1)); return; }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const d = e.key === 'ArrowUp' ? -1 : 1;
      if (focusCol === 0) {
        const i = HOURS.indexOf(shownH % 12 || 12);
        const h12 = HOURS[(i + d + HOURS.length) % HOURS.length];
        commit(to24(h12, pm), shownMi);
      } else {
        const i = MINS.indexOf(shownMi);
        commit(cur ? cur.h : to24(base.h % 12 || 12, pm), MINS[Math.min(MINS.length - 1, Math.max(0, (i < 0 ? 0 : i) + d))]);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const cell = isMobile ? 'h-10 text-[14px]' : 'h-8 text-[12.5px]';
  const nowH = new Date().getHours();
  const col = (ref, items, isOn, isNow, isOff, onPick, label, active) => (
    <div ref={ref} role="listbox" aria-label={label}
      className={`relative flex-1 ${isMobile ? 'h-[208px]' : 'h-[196px]'} overflow-y-auto overscroll-contain scrollbar-hide flex flex-col gap-0.5 rounded-md`} data-active={active ? 'true' : undefined}>
      {items.map(it => {
        const on = isOn(it), off = isOff(it);
        return (
          <button key={it} type="button" role="option" aria-selected={on} data-on={on ? 'true' : 'false'} disabled={off}
            onClick={() => onPick(it)}
            className={`shrink-0 ${cell} rounded-md flex items-center justify-center tabular-nums transition-colors
              ${on ? 'bg-accent text-white font-bold' : isNow(it) ? 'text-accent-text font-bold hover:bg-surface-hover' : 'text-fg hover:bg-surface-hover'}
              ${off ? 'opacity-30 cursor-not-allowed' : ''}`}>
            {label === '분' ? pad(it) : it}
          </button>
        );
      })}
    </div>
  );

  const pop = open ? createPortal(
    <div ref={popRef} data-timepicker="" role="dialog" aria-label={ariaLabel}
      style={{ position: 'fixed', left: pos.left, top: pos.top, ...popMotion(pos) }}
      className={`z-[90] ${isMobile ? 'w-[260px]' : 'w-[236px]'} bg-surface border border-line rounded-lg shadow-elevated p-3 transition-none dc-pop`}>
      {/* 오전/오후 — 흰 알약이 옆으로 미끄러진다(quint · 움직임 줄이기면 바로) */}
      <div role="radiogroup" aria-label="오전 오후" className="relative flex p-[3px] rounded-md bg-surface-hover">
        <span aria-hidden className="absolute top-[3px] bottom-[3px] w-[calc(50%-3px)] rounded-[5px] bg-surface shadow-soft motion-reduce:transition-none"
          style={{ left: pm ? '50%' : 3, transition: 'left .32s var(--ease-out-quint)' }} />
        {[false, true].map(p => (
          <button key={String(p)} type="button" role="radio" aria-checked={pm === p} onClick={() => flip(p)}
            className={`relative flex-1 ${isMobile ? 'h-9' : 'h-7'} rounded-[5px] text-[12px] font-semibold transition-colors ${pm === p ? 'text-fg' : 'text-fg-muted'}`}>
            {p ? '오후' : '오전'}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 mt-2">
        {col(hourCol, HOURS,
          (h12) => !!cur && cur.h >= 12 === pm && (cur.h % 12 || 12) === h12,
          (h12) => to24(h12, pm) === nowH,
          (h12) => MINS.every(mi => blocked(to24(h12, pm), mi)),
          pickHour, '시', focusCol === 0)}
        <span className="w-px bg-line shrink-0" />
        {col(minCol, MINS,
          (mi) => !!cur && cur.mi === mi,
          () => false,
          (mi) => blocked(cur ? cur.h : to24(base.h % 12 || 12, pm), mi),
          pickMin, '분', focusCol === 1)}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-line">
        {allowClear
          ? <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="text-[11px] text-fg-muted hover:text-fg px-1.5 py-1 rounded-md hover:bg-surface-hover transition active:scale-95">지우기</button>
          : <span />}
        <button type="button" onClick={now} className="text-[11px] text-accent-text hover:bg-surface-hover px-1.5 py-1 rounded-md transition active:scale-95">지금</button>
      </div>
    </div>, document.body) : null;

  return (
    <div className="relative inline-flex" ref={rootRef}>
      <button ref={triggerRef} type="button" onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel} aria-expanded={open} aria-haspopup="dialog" className={triggerClassName}>
        <Clock size={13} className="text-fg-faint shrink-0" />
        {cur ? <span>{koTime(value)}</span> : <span className="text-fg-faint">시간 선택</span>}
      </button>
      {pop}
    </div>
  );
}
