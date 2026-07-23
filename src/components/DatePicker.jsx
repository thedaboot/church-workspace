import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

// 노션 톤 커스텀 데이트피커
// - value: 'YYYY-MM-DD' 문자열 또는 ''
// - onChange(nextValue): 선택/지우기 시 호출
// - 선택 가능 범위: 올해 1월 ~ 2030년 12월
const MIN_YEAR = new Date().getFullYear();
const MAX_YEAR = 2030;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 'YYYY-MM-DD' → { y, m(0-index), d } 또는 null
const parseValue = (v) => {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
};
const pad = (n) => String(n).padStart(2, '0');
const toValue = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function DatePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const parsed = parseValue(value);
  const today = new Date();

  // 표시 중인 연/월 (0-index month)
  const [view, setView] = useState(() => {
    const base = parsed || { y: Math.max(MIN_YEAR, Math.min(MAX_YEAR, today.getFullYear())), m: today.getMonth() };
    return { y: base.y, m: base.m };
  });

  const rootRef = useRef(null);

  // 열 때마다 선택값(없으면 오늘) 기준으로 뷰 동기화
  useEffect(() => {
    if (!open) return;
    const base = parseValue(value) || { y: Math.max(MIN_YEAR, Math.min(MAX_YEAR, today.getFullYear())), m: today.getMonth() };
    setView({ y: base.y, m: base.m });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 바깥 클릭 / Escape 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const label = useMemo(() => {
    if (!parsed) return null;
    const wd = new Date(parsed.y, parsed.m, parsed.d).toLocaleDateString('ko-KR', { weekday: 'short' });
    return `${parsed.y}. ${parsed.m + 1}. ${parsed.d}. (${wd})`;
  }, [value]);

  const canPrev = !(view.y === MIN_YEAR && view.m === 0);
  const canNext = !(view.y === MAX_YEAR && view.m === 11);
  const goPrev = () => { if (canPrev) setView(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }); };
  const goNext = () => { if (canNext) setView(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }); };

  const firstDayIndex = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells = Array.from({ length: firstDayIndex + daysInMonth }, (_, i) => i < firstDayIndex ? null : i - firstDayIndex + 1);

  const pick = (day) => { onChange(toValue(view.y, view.m, day)); setOpen(false); };
  const clear = () => { onChange(''); setOpen(false); };
  const jumpToday = () => {
    const y = Math.max(MIN_YEAR, Math.min(MAX_YEAR, today.getFullYear()));
    setView({ y, m: y === today.getFullYear() ? today.getMonth() : 0 });
  };

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 border border-line rounded-xs bg-surface px-2 py-1.5 text-xs text-fg hover:bg-surface-hover focus:border-accent focus:shadow-soft outline-none transition-all"
      >
        <Calendar size={13} className="text-fg-faint shrink-0" />
        {label ? <span>{label}</span> : <span className="text-fg-faint">날짜 선택</span>}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 bg-surface border border-line rounded-lg shadow-elevated p-3 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={goPrev} disabled={!canPrev} className={`p-1 rounded-md text-fg-muted transition active:scale-95 ${canPrev ? 'hover:bg-surface-hover' : 'opacity-30 cursor-not-allowed'}`}><ChevronLeft size={16} /></button>
            <span className="text-xs font-semibold text-fg tracking-[-0.25px]">{view.y}년 {view.m + 1}월</span>
            <button type="button" onClick={goNext} disabled={!canNext} className={`p-1 rounded-md text-fg-muted transition active:scale-95 ${canNext ? 'hover:bg-surface-hover' : 'opacity-30 cursor-not-allowed'}`}><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map(d => <div key={d} className="w-8 h-6 flex items-center justify-center text-[10px] text-fg-faint">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              if (!day) return <div key={`e-${idx}`} className="w-8 h-8" />;
              const isToday = view.y === today.getFullYear() && view.m === today.getMonth() && day === today.getDate();
              const isSelected = parsed && parsed.y === view.y && parsed.m === view.m && parsed.d === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pick(day)}
                  className={`w-8 h-8 rounded-md text-xs flex items-center justify-center transition-colors ${
                    isSelected ? 'bg-accent text-white font-semibold'
                    : isToday ? 'text-accent-text font-bold hover:bg-surface-hover'
                    : 'text-fg hover:bg-surface-hover'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-line">
            <button type="button" onClick={clear} className="text-[11px] text-fg-faint hover:text-fg-muted px-1.5 py-1 rounded-md hover:bg-surface-hover transition active:scale-95">지우기</button>
            <button type="button" onClick={jumpToday} className="text-[11px] text-accent-text hover:bg-surface-hover px-1.5 py-1 rounded-md transition active:scale-95">오늘</button>
          </div>
        </div>
      )}
    </div>
  );
}
