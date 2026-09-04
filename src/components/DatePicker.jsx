import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

// 노션 톤 커스텀 데이트피커
// - value: 'YYYY-MM-DD' 문자열 또는 ''
// - onChange(nextValue): 선택/지우기 시 호출
// - 선택 가능 범위: 작년 1월 ~ 2030년 12월
//   (작년까지 내려두는 이유: 이미 시작한 업무를 나중에 등록하면 시작일이 작년이다)
//
// 여는 버튼의 모양은 부르는 쪽이 바꿔 쓸 수 있다(children · triggerClassName) —
// 말씀 화면의 QT는 **상단 날짜 글자 자체가 트리거**다(사용자 피드백 2026-09-02).
// 넘기지 않으면 지금까지 쓰던 [달력 아이콘 + 날짜] 버튼 그대로다.
// allowClear=false면 '지우기'가 없다 — QT처럼 날짜가 비어 있을 수 없는 자리를 위해서다.
//
// yearless=true는 **연도가 없는 날짜**다(value/onChange가 'MM-DD'). 생일이 그렇다 —
// 청년 명단은 태어난 해를 저장하지 않는다(0019·0035의 관례. 나이가 화면에 서지 않는다).
// 그 모드에서는 연도 글자와 연도 이동이 없고, 달만 1월 ↔ 12월로 돈다. **요일 줄도 없다** —
// 연도를 모르면 요일도 모르는데 요일을 그리면 없는 사실을 말하는 것이 된다. 2월은 29일까지
// 둔다(윤년을 기준으로 삼는다 — 2월 29일에 태어난 사람이 고를 칸이 있어야 한다).
const MIN_YEAR = new Date().getFullYear() - 1;
const MAX_YEAR = 2030;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const LEAP_YEAR = 2024;   // 연도 없는 모드에서 날 수를 셀 때만 쓴다(2월 29일)

// 'YYYY-MM-DD' → { y, m(0-index), d } 또는 null
const parseValue = (v) => {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
};
// 'MM-DD' → { m(0-index), d } 또는 null (yearless)
const parseMonthDay = (v) => {
  const hit = /^(\d{1,2})-(\d{1,2})$/.exec(String(v || ''));
  if (!hit) return null;
  const m = Number(hit[1]) - 1;
  const d = Number(hit[2]);
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  return { y: null, m, d };
};
const pad = (n) => String(n).padStart(2, '0');
const toValue = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

const TRIGGER = 'inline-flex items-center gap-1.5 border border-line rounded-xs bg-surface px-2 py-1.5 text-xs text-fg hover:bg-surface-hover focus:border-accent focus:shadow-soft outline-none transition-all';

export function DatePicker({ value, onChange, children = null, triggerClassName = TRIGGER, allowClear = true, ariaLabel = '날짜 선택', yearless = false }) {
  const [open, setOpen] = useState(false);
  const parsed = yearless ? parseMonthDay(value) : parseValue(value);
  const today = new Date();

  // 표시 중인 연/월 (0-index month). 연도 없는 모드에서는 y가 날 수를 세는 데만 쓰인다.
  const [view, setView] = useState(() => {
    const base = parsed || { y: Math.max(MIN_YEAR, Math.min(MAX_YEAR, today.getFullYear())), m: today.getMonth() };
    return { y: base.y ?? today.getFullYear(), m: base.m };
  });

  const rootRef = useRef(null);

  // 열 때마다 선택값(없으면 오늘) 기준으로 뷰 동기화.
  // **고른 값을 읽는 자와 같은 자로 읽어야 한다** — 연도 없는 모드에서 parseValue로
  // 읽었더니 늘 null이 되어 2월 13일인 사람의 칸을 열어도 이번 달이 떴다.
  useEffect(() => {
    if (!open) return;
    const base = (yearless ? parseMonthDay(value) : parseValue(value))
      || { y: Math.max(MIN_YEAR, Math.min(MAX_YEAR, today.getFullYear())), m: today.getMonth() };
    setView({ y: base.y ?? today.getFullYear(), m: base.m });
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
    if (yearless) return `${parsed.m + 1}월 ${parsed.d}일`;
    const wd = new Date(parsed.y, parsed.m, parsed.d).toLocaleDateString('ko-KR', { weekday: 'short' });
    return `${parsed.y}. ${parsed.m + 1}. ${parsed.d}. (${wd})`;
  }, [value, yearless]);

  // 연도가 없으면 달만 돈다(1월에서 이전을 누르면 12월). 막을 끝이 없다.
  const canPrev = yearless || !(view.y === MIN_YEAR && view.m === 0);
  const canNext = yearless || !(view.y === MAX_YEAR && view.m === 11);
  const goPrev = () => {
    if (!canPrev) return;
    setView(v => (v.m === 0 ? { y: yearless ? v.y : v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  };
  const goNext = () => {
    if (!canNext) return;
    setView(v => (v.m === 11 ? { y: yearless ? v.y : v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));
  };

  const firstDayIndex = yearless ? 0 : new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(yearless ? LEAP_YEAR : view.y, view.m + 1, 0).getDate();
  const cells = Array.from({ length: firstDayIndex + daysInMonth }, (_, i) => i < firstDayIndex ? null : i - firstDayIndex + 1);

  const pick = (day) => {
    onChange(yearless ? `${pad(view.m + 1)}-${pad(day)}` : toValue(view.y, view.m, day));
    setOpen(false);
  };
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
        aria-label={ariaLabel} aria-expanded={open} aria-haspopup="dialog"
        className={triggerClassName}
      >
        {children || (
          <>
            <Calendar size={13} className="text-fg-faint shrink-0" />
            {label ? <span>{label}</span> : <span className="text-fg-faint">날짜 선택</span>}
          </>
        )}
      </button>

      {open && (
        <div data-datepicker="" role="dialog" aria-label={ariaLabel}
          className="absolute left-0 top-full z-50 mt-1 w-max bg-surface border border-line rounded-lg shadow-elevated p-3 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={goPrev} disabled={!canPrev} className={`p-1 rounded-md text-fg-muted transition active:scale-95 ${canPrev ? 'hover:bg-surface-hover' : 'opacity-30 cursor-not-allowed'}`}><ChevronLeft size={16} /></button>
            <span className="text-xs font-semibold text-fg tracking-[-0.25px] whitespace-nowrap px-2">
              {yearless ? `${view.m + 1}월` : `${view.y}년 ${view.m + 1}월`}
            </span>
            <button type="button" onClick={goNext} disabled={!canNext} className={`p-1 rounded-md text-fg-muted transition active:scale-95 ${canNext ? 'hover:bg-surface-hover' : 'opacity-30 cursor-not-allowed'}`}><ChevronRight size={16} /></button>
          </div>
          {!yearless && (
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map(d => <div key={d} className="w-8 h-6 flex items-center justify-center text-[10px] text-fg-faint">{d}</div>)}
            </div>
          )}
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              if (!day) return <div key={`e-${idx}`} className="w-8 h-8" />;
              const isToday = view.m === today.getMonth() && day === today.getDate()
                && (yearless || view.y === today.getFullYear());
              const isSelected = parsed && parsed.m === view.m && parsed.d === day
                && (yearless || parsed.y === view.y);
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
            {allowClear
              ? <button type="button" onClick={clear} className="text-[11px] text-fg-faint hover:text-fg-muted px-1.5 py-1 rounded-md hover:bg-surface-hover transition active:scale-95">지우기</button>
              : <span />}
            <button type="button" onClick={jumpToday} className="text-[11px] text-accent-text hover:bg-surface-hover px-1.5 py-1 rounded-md transition active:scale-95">오늘</button>
          </div>
        </div>
      )}
    </div>
  );
}
