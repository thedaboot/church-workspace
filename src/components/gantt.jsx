import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { teamPaint } from '../config.js';
import { localDate, mdDot } from '../utils.js';
import { STATUS_DOT_VAR } from '../views/dashboardParts.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { prefersReducedMotion } from '../hooks/useReducedMotion.js';
import {
  ganttRows, ganttRange, placeBars, depLinks, weekStart, addDays, diffDays, WINDOW_DAYS,
} from '../services/projectViews.js';

// ============================================================================
// 프로젝트 '간트' 보기 (시안 mock/b3 · v5 2묶음 '업무 편의')
// ----------------------------------------------------------------------------
// 띠 = 시작일 → 마감일(시작일이 없으면 마감일 하루 — 달력과 같은 규칙 · 상시·날짜 없는 업무는 서지 않는다).
// 띠 색은 팀(달력 띠와 같은 teamPaint) · 앞의 점은 상태. 선행 업무는 옅은 꺾은선(앞 업무 끝 → 이 업무 시작).
// 오늘은 세로 accent 선. 짧은 띠의 제목은 띠 오른쪽에 붙는다(데스크톱). 규칙(범위·창·자리·선)은 services/projectViews.js(순수 · logcheck-dash).
//   데스크톱 — 달 단위로 넓게(하루 28px) · 왼쪽 제목 칸은 붙어 있고 판 **안에서** 가로로 민다 · 처음엔 오늘이 보이게.
//   폰 — **4주 창**(지난주 주일부터)을 판 폭에 맞춘다 · 선행 업무 선은 긋지 않는다 · 판 안에서 좌우로 밀면 주 단위로 넘어간다(페이지는 가로로 안 밀린다 · §8) ·
//        (민 만큼 주 단위로 · 짧게 밀면 제자리) · 위 이전/다음 버튼은 한 주씩(달력 머리와 같은 붙은 쌍). 미는 동안은 앞뒤 4주를 같이 그려 빈칸이 끌려오지 않게 한다.
// ============================================================================

const ROW_H = 34;
const BAR_H = 20;
const DESK_DAY = 28;
const TITLE_W = 232;

// 선행 업무 잇는 선 — 앞 띠 끝(x1, y1) → 6px 나가서 꺾고 → 이 띠 시작(x2, y2)
function linkPath(x1, y1, x2, y2) {
  const out = x1 + 6;
  if (x2 - 6 >= out) return `M${x1} ${y1} H${x2 - 6} V${y2} H${x2}`;
  // 이 업무가 앞 업무 끝보다 먼저 시작한다(겹침) — 띠 사이 줄 틈으로 돌아 들어간다
  const mid = y1 < y2 ? y2 - ROW_H / 2 : y2 + ROW_H / 2;
  return `M${x1} ${y1} H${out} V${mid} H${x2 - 6} V${y2} H${x2}`;
}

function Links({ bars, dayW, rowTop = 0, offset = 0 }) {
  const links = depLinks(bars);
  if (!links.length) return null;
  const yOf = (b) => rowTop + b.row * ROW_H + ROW_H / 2;
  return (
    <svg className="absolute inset-0 pointer-events-none overflow-visible" width="100%" height="100%" aria-hidden data-gantt-links="">
      <defs>
        <marker id="gantt-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L6 3 L0 6 z" fill="var(--app-ink-faint)" />
        </marker>
      </defs>
      {links.map(({ from, to }) => (
        <path key={`${from.task.id}-${to.task.id}`} d={linkPath(offset + (from.left + from.width) * dayW - 1, yOf(from), offset + to.left * dayW + 1, yOf(to))}
          fill="none" stroke="var(--app-ink-faint)" strokeWidth="1.2" strokeOpacity=".75" markerEnd="url(#gantt-arrow)" />
      ))}
    </svg>
  );
}

function GanttBar({ bar, dayW, offset = 0, onTaskClick, showTitle = true }) {
  const { task, left, width, clipL, clipR } = bar;
  const done = task.status === '완료';
  return (
    <button type="button" onClick={() => onTaskClick(task)} data-gantt-bar={task.id}
      title={`${task.title} (${mdDot(bar.start)} ~ ${mdDot(bar.end)})`}
      className="absolute flex items-center gap-1 px-1.5 min-w-0 overflow-hidden text-left hover:brightness-95 transition-[filter]"
      style={{
        left: offset + left * dayW + 1, width: Math.max(6, width * dayW - 2), top: bar.row * ROW_H + (ROW_H - BAR_H) / 2, height: BAR_H,
        ...teamPaint(task.teams), opacity: done ? 0.55 : 1,
        borderTopLeftRadius: clipL ? 2 : 5, borderBottomLeftRadius: clipL ? 2 : 5,
        borderTopRightRadius: clipR ? 2 : 5, borderBottomRightRadius: clipR ? 2 : 5,
      }}>
      {width * dayW >= 14 && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT_VAR[task.status] }} />}
      {showTitle && width * dayW >= 44 && <span className="text-[11px] font-semibold truncate">{task.title}</span>}
    </button>
  );
}

// 짧은 띠(이틀 남짓)는 안에 제목이 안 들어간다 — 띠 오른쪽에 글자로 붙인다(누르면 같은 업무)
function OuterTitle({ bar, dayW, onTaskClick }) {
  if (bar.width * dayW >= 44 || bar.clipR) return null;
  return (
    <button type="button" onClick={() => onTaskClick(bar.task)}
      className="absolute flex items-center text-[11px] font-semibold text-fg-secondary whitespace-nowrap hover:text-fg"
      style={{ left: (bar.left + bar.width) * dayW + 5, top: bar.row * ROW_H + (ROW_H - BAR_H) / 2, height: BAR_H }}>
      {bar.task.title}
    </button>
  );
}

const Empty = ({ text }) => <p className="py-16 text-center text-[12px] text-fg-muted">{text}</p>;

// ── 데스크톱 ────────────────────────────────────────────────────────────────
function DeskGantt({ rows, today, onTaskClick }) {
  const range = useMemo(() => ganttRange(rows, today), [rows, today]);
  const bars = useMemo(() => placeBars(rows, range.from, range.days), [rows, range]);
  const days = useMemo(() => Array.from({ length: range.days }, (_, i) => addDays(range.from, i)), [range]);
  const months = useMemo(() => {
    const out = [];
    days.forEach((d, i) => { const k = d.slice(0, 7); if (!out.length || out[out.length - 1].k !== k) out.push({ k, i, n: 0 }); out[out.length - 1].n++; });
    return out;
  }, [days]);
  const scrollRef = useRef(null);
  const todayX = diffDays(range.from, today) * DESK_DAY;
  // 처음엔 오늘이 판의 왼쪽 1/4쯤에 오게
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, todayX - (el.clientWidth - TITLE_W) / 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from]);
  const W = range.days * DESK_DAY;
  const H = rows.length * ROW_H;
  const goToday = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, todayX - (el.clientWidth - TITLE_W) / 4), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <div className="h-full min-h-0 flex flex-col" data-gantt="desk">
      <div className="flex items-center gap-2.5 pb-2.5 shrink-0">
        <button type="button" onClick={goToday}
          className="h-7 px-2.5 rounded-md text-[12px] font-bold border border-line text-fg-muted hover:bg-surface-hover transition-colors">오늘</button>
        <span className="text-[11.5px] text-fg-muted tabular-nums">{rows.length}건</span>
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto rounded-[10px] border border-line bg-surface shadow-soft">
        <div className="relative" style={{ width: TITLE_W + W, minHeight: '100%' }}>
          {/* 머리 — 달 줄 + 날 줄(위에 붙는다) */}
          <div className="sticky top-0 z-[3] flex bg-surface border-b border-line">
            <div className="sticky left-0 z-[4] shrink-0 bg-surface border-r border-line" style={{ width: TITLE_W }} />
            <div className="relative" style={{ width: W, height: 44 }}>
              {months.map(m => (
                <span key={m.k} className="absolute top-0 h-[22px] flex items-center px-2 text-[11.5px] font-bold text-fg border-l border-line first:border-l-0"
                  style={{ left: m.i * DESK_DAY, width: m.n * DESK_DAY }}>
                  <span className="sticky left-[240px]">{Number(m.k.slice(0, 4))}년 {Number(m.k.slice(5, 7))}월</span>
                </span>
              ))}
              {days.map((d, i) => {
                const wd = new Date(`${d}T00:00:00`).getDay();
                const isT = d === today;
                return (
                  <span key={d} className="absolute top-[22px] h-[22px] flex items-center justify-center"
                    style={{ left: i * DESK_DAY, width: DESK_DAY }}>
                    <span className={`w-[20px] h-[18px] rounded-[5px] flex items-center justify-center text-[10.5px] tabular-nums ${isT ? 'bg-accent text-white font-bold' : 'font-semibold'}`}
                      style={isT ? undefined : { color: wd === 0 ? 'var(--app-tag-red-fg)' : 'var(--app-ink-muted)' }}>
                      {Number(d.slice(8, 10))}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
          {/* 몸 — 왼쪽 제목 칸(붙어 있다) + 띠 판 */}
          <div className="flex">
            <div className="sticky left-0 z-[2] shrink-0 bg-surface border-r border-line" style={{ width: TITLE_W }}>
              {rows.map(r => (
                <button key={r.task.id} type="button" onClick={() => onTaskClick(r.task)}
                  className="w-full flex items-center gap-2 px-3 text-left hover:bg-surface-hover transition-colors border-b border-line/50"
                  style={{ height: ROW_H }}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT_VAR[r.task.status] }} />
                  <span className="text-[12.5px] font-semibold text-fg truncate">{r.task.title}</span>
                </button>
              ))}
            </div>
            <div className="relative" style={{ width: W, height: H }}>
              {/* 주일 칸 · 달 경계 · 줄 선 */}
              {days.map((d, i) => (new Date(`${d}T00:00:00`).getDay() === 0 || d.endsWith('-01')) && (
                <span key={d} className="absolute top-0 bottom-0"
                  style={{ left: i * DESK_DAY, width: d.endsWith('-01') ? 1 : DESK_DAY,
                    background: d.endsWith('-01') ? 'var(--app-line)' : 'color-mix(in srgb, var(--app-surface-hover) 70%, transparent)' }} />
              ))}
              {rows.map((r, i) => <span key={r.task.id} className="absolute left-0 right-0 border-b border-line/50" style={{ top: i * ROW_H, height: ROW_H }} />)}
              <span className="absolute top-0 bottom-0 w-[2px] -ml-px z-[1] bg-accent" style={{ left: todayX + DESK_DAY / 2 }} data-gantt-today="" />
              <Links bars={bars} dayW={DESK_DAY} />
              {bars.map(b => <GanttBar key={b.task.id} bar={b} dayW={DESK_DAY} onTaskClick={onTaskClick} />)}
              {bars.map(b => <OuterTitle key={`t-${b.task.id}`} bar={b} dayW={DESK_DAY} onTaskClick={onTaskClick} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 폰: 4주 창 ──────────────────────────────────────────────────────────────
function PhoneGantt({ rows, today, onTaskClick }) {
  // 창은 지난주 주일부터 — 이번 주가 판 왼쪽 끝에 붙으면 오늘 선이 가장자리에 선다
  const home = addDays(weekStart(today), -7);
  const [start, setStart] = useState(home);
  const boxRef = useRef(null);
  const [w, setW] = useState(0);
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(false);
  const drag = useRef(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const read = () => setW(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dayW = w / WINDOW_DAYS;
  // 줄은 지금 창(4주)에 걸치는 것만 · 띠는 앞뒤 4주까지 같이 그린다(미는 동안 옆 주가 비어 끌려오지 않게)
  const winRows = useMemo(() => placeBars(rows, start, WINDOW_DAYS).map(b => ({ task: b.task, start: b.start, end: b.end })), [rows, start]);
  const wideFrom = addDays(start, -WINDOW_DAYS);
  const bars = useMemo(() => placeBars(winRows, wideFrom, WINDOW_DAYS * 3), [winRows, wideFrom]);
  const end = addDays(start, WINDOW_DAYS - 1);
  const label = `${mdDot(start)} – ${mdDot(end)}`;
  const shift = (weeks) => setStart(s => addDays(s, weeks * 7));

  // 판 안 좌우 밀기 — touch-action: pan-y라 세로 스크롤은 브라우저가 그대로 한다
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, on: false, id: e.pointerId };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x, my = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(mx) < 8 || Math.abs(mx) < Math.abs(my)) { if (Math.abs(my) > 10) drag.current = null; return; }
      d.on = true;
      try { e.currentTarget.setPointerCapture(d.id); } catch { /* 이미 놓았다 */ }
    }
    setAnim(false);
    setDx(Math.max(-w, Math.min(w, mx)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.on) return;
    const weeks = Math.abs(dx) < 36 ? 0 : -Math.sign(dx) * Math.max(1, Math.round(Math.abs(dx) / (dayW * 7)));
    if (!weeks || prefersReducedMotion()) { setAnim(!prefersReducedMotion()); setDx(0); if (weeks) shift(weeks); return; }
    setAnim(true);
    setDx(-weeks * 7 * dayW);
    setTimeout(() => { setAnim(false); setDx(0); shift(weeks); }, 260);
  };
  // 미는 중에 누른 띠가 열리지 않게(끈 뒤의 click)
  const swallow = useRef(false);
  useEffect(() => { if (dx) swallow.current = true; }, [dx]);
  const onClickCapture = (e) => { if (swallow.current) { e.stopPropagation(); e.preventDefault(); swallow.current = false; } };

  const offset = -WINDOW_DAYS * dayW;
  const H = Math.max(winRows.length, 1) * ROW_H;
  const todayIdx = diffDays(wideFrom, today);
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(wideFrom, i * 7));

  return (
    <div className="h-full min-h-0 flex flex-col" data-gantt="phone">
      <div className="flex items-center gap-2 pb-2 shrink-0">
        <span className="flex rounded-md overflow-hidden shrink-0" style={{ border: '1px solid var(--app-line)' }}>
          <button type="button" onClick={() => shift(-1)} title="이전 주" aria-label="이전 주"
            className="w-8 h-8 flex items-center justify-center text-fg-muted active:bg-surface-hover"><ChevronLeft size={16} /></button>
          <span className="w-px" style={{ background: 'var(--app-line)' }} />
          <button type="button" onClick={() => shift(1)} title="다음 주" aria-label="다음 주"
            className="w-8 h-8 flex items-center justify-center text-fg-muted active:bg-surface-hover"><ChevronRight size={16} /></button>
        </span>
        <h3 className="text-[13.5px] font-extrabold text-fg tabular-nums" data-gantt-window="">{label}</h3>
        <span className="flex-1" />
        {start !== home && (
          <button type="button" onClick={() => setStart(home)}
            className="h-8 px-2.5 rounded-md text-[12px] font-bold border border-line text-fg-muted">오늘</button>
        )}
      </div>
      <div ref={boxRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-[10px] border border-line bg-surface select-none"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClickCapture={onClickCapture}>
        {w > 0 && (
          <div style={{ transform: `translateX(${dx}px)`, transition: anim ? 'transform .26s var(--ease-out-quint)' : 'none' }}>
            {/* 머리 — 주마다 주일 날짜 · 날 눈금 */}
            <div className="relative h-[30px] border-b border-line" style={{ width: w }}>
              {weeks.map((ws, i) => (
                <span key={ws} className="absolute top-0 h-full flex items-center pl-1.5 text-[10.5px] font-semibold text-fg-muted tabular-nums border-l border-line"
                  style={{ left: offset + i * 7 * dayW, width: 7 * dayW }}>
                  {mdDot(ws)}
                </span>
              ))}
              {todayIdx >= 0 && (
                <span className="absolute bottom-0 h-[6px] w-[2px] -ml-px bg-accent" style={{ left: offset + (todayIdx + 0.5) * dayW }} />
              )}
            </div>
            {/* 몸 — 줄마다 위에 제목, 아래 띠 */}
            <div className="relative" style={{ width: w, height: winRows.length ? H + winRows.length * 16 : 0 }}>
              {weeks.map((ws, i) => (
                <span key={ws} className="absolute top-0 bottom-0"
                  style={{ left: offset + i * 7 * dayW, width: dayW, background: 'color-mix(in srgb, var(--app-surface-hover) 70%, transparent)' }} />
              ))}
              {todayIdx >= 0 && <span className="absolute top-0 bottom-0 w-[2px] -ml-px z-[1] bg-accent" style={{ left: offset + (todayIdx + 0.5) * dayW }} data-gantt-today="" />}
              {winRows.map((r, i) => (
                <button key={r.task.id} type="button" onClick={() => onTaskClick(r.task)}
                  className="absolute left-0 flex items-center gap-1.5 px-2.5 min-w-0 text-left z-[2]"
                  style={{ top: i * (ROW_H + 16), height: 18, width: w, transform: `translateX(${-dx}px)` }}>
                  {/* 글자 뒤를 판 바탕으로 덮는다 — 오늘 선·주일 칸이 제목 글자를 가로지르지 않게 */}
                  <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full pr-1.5 rounded-sm bg-surface">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT_VAR[r.task.status] }} />
                    <span className="text-[11.5px] font-semibold text-fg truncate">{r.task.title}</span>
                    <span className="text-[10.5px] text-fg-muted tabular-nums shrink-0">{r.start === r.end ? mdDot(r.end) : `${mdDot(r.start)} – ${mdDot(r.end)}`}</span>
                  </span>
                </button>
              ))}
              <div className="absolute left-0 right-0" style={{ top: 14 }}>
                <PhoneBars bars={bars} dayW={dayW} offset={offset} onTaskClick={onTaskClick} />
              </div>
            </div>
            {!winRows.length && <Empty text="이 기간에는 업무가 없어요" />}
          </div>
        )}
      </div>
    </div>
  );
}

// 폰 띠 — 줄 높이가 제목 줄(16)만큼 더 크다 · 띠 안에는 글자를 두지 않는다(제목은 위 줄).
// 선행 업무 선은 폰에는 긋지 않는다 — 좁은 판에서 제목 글자를 가로질러 읽기를 방해했다(데스크톱만).
function PhoneBars({ bars, dayW, offset, onTaskClick }) {
  const stride = ROW_H + 16;
  return bars.map(b => (
    <button key={b.task.id} type="button" onClick={() => onTaskClick(b.task)} data-gantt-bar={b.task.id} aria-label={b.task.title}
      className="absolute"
      style={{
        left: offset + b.left * dayW + 1, width: Math.max(6, b.width * dayW - 2), top: b.row * stride + (ROW_H - 14) / 2, height: 14,
        ...teamPaint(b.task.teams), opacity: b.task.status === '완료' ? 0.55 : 1,
        borderRadius: `${b.clipL ? 2 : 4}px ${b.clipR ? 2 : 4}px ${b.clipR ? 2 : 4}px ${b.clipL ? 2 : 4}px`,
      }} />
  ));
}

export const GanttBoard = React.memo(function GanttBoard({ tasks, onTaskClick }) {
  const isMobile = useIsMobile();
  const today = localDate(new Date());
  const rows = useMemo(() => ganttRows(tasks), [tasks]);
  if (!rows.length) return <Empty text="날짜가 있는 업무가 없어요" />;
  return isMobile
    ? <PhoneGantt rows={rows} today={today} onTaskClick={onTaskClick} />
    : <DeskGantt rows={rows} today={today} onTaskClick={onTaskClick} />;
});
