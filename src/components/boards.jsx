import React from 'react';
import { createPortal } from 'react-dom';
import { User, Clock, Folder, ChevronLeft, ChevronRight, ArrowLeftRight, Check, X } from 'lucide-react';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin, rectIntersection,
} from '@dnd-kit/core';
import { CONFIG, teamPaint } from '../config.js';
import { avatarColor } from '../utils.js';
import { useStore } from '../store/workspaceStore.js';
import { selectProjectsMap, selectTasksByDate } from '../store/selectors.js';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';

const CAL_MIN_YEAR = new Date().getFullYear();
const CAL_MAX_YEAR = 2030;

// 놓을 곳은 "손가락/커서가 있는 곳" 기준으로 판단한다.
// 기본값(rectIntersection)은 끌고 있는 카드의 사각형이 가장 많이 겹친 대상을 고르는데,
// 카드 폭이 상태 칩보다 훨씬 넓어서 엉뚱한 칩에 놓이곤 했다(실측: 완료에 놓았는데 보류 중).
// 포인터가 어떤 대상 안에도 없을 때만 기존 방식으로 되돌린다.
const dropCollision = (args) => {
  const hit = pointerWithin(args);
  return hit.length ? hit : rectIntersection(args);
};

// ============================================================================
// 12. UI Components (순수 프레젠테이션)
// ============================================================================
// 하루 셀에 보여줄 최대 줄 수(데스크톱) / 점 개수(모바일). 넘치면 +N으로 접는다.
const CAL_MAX_ROWS = 3;
const CAL_MAX_DOTS = 3;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const CalendarBoard = React.memo(({ tasks, onTaskClick }) => {
  // O(1) 맵핑 캐싱된 Selector 활용
  const tasksByDateMap = useStore(selectTasksByDate);
  const isMobile = useIsMobile();
  const [selected, setSelected] = React.useState(null); // 'YYYY-MM-DD' — 아래 목록 패널

  // 이 캘린더가 보여줄 업무만 남긴다(프로젝트 캘린더는 그 프로젝트 업무만).
  // 전역 selector를 그대로 쓰면 다른 프로젝트 업무까지 달력에 섞여 나온다.
  const allowed = React.useMemo(() => new Set((tasks || []).map(t => t.id)), [tasks]);
  const entriesOf = React.useCallback(
    (dateStr) => (tasksByDateMap.get(dateStr) || []).filter(e => allowed.has(e.task.id)),
    [tasksByDateMap, allowed]
  );

  const today = new Date();
  // 표시 중인 연/월 상태 (초기값은 오늘, 범위로 클램프)
  const [view, setView] = React.useState(() => ({
    y: Math.max(CAL_MIN_YEAR, Math.min(CAL_MAX_YEAR, today.getFullYear())),
    m: today.getMonth(),
  }));

  const currentYear = view.y;
  const currentMonth = view.m;
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();

  const canPrev = !(currentYear === CAL_MIN_YEAR && currentMonth === 0);
  const canNext = !(currentYear === CAL_MAX_YEAR && currentMonth === 11);
  const goPrev = () => { if (canPrev) setView(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }); };
  const goNext = () => { if (canNext) setView(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }); };
  const goToday = () => setView({ y: Math.max(CAL_MIN_YEAR, Math.min(CAL_MAX_YEAR, today.getFullYear())), m: today.getMonth() });

  // 실제 오늘이 표시 중인 달일 때만 isToday 강조
  const showingCurrentMonth = currentYear === today.getFullYear() && currentMonth === today.getMonth();

  const days = Array.from({ length: firstDayIndex + daysInMonth }, (_, i) => i < firstDayIndex ? null : i - firstDayIndex + 1);

  return (
    <div className="bg-surface rounded-lg border border-line flex flex-col h-full min-h-[400px]">
      <div className="px-4 py-3 border-b border-line bg-surface-2 flex items-center justify-between">
        <h3 className="font-semibold text-sm text-fg tracking-[-0.25px]">{currentYear}년 {currentMonth + 1}월</h3>
        <div className="flex items-center gap-1">
          <button onClick={goPrev} disabled={!canPrev} className={`p-1 rounded-md text-fg-muted transition active:scale-95 ${canPrev ? 'hover:bg-surface-hover' : 'opacity-30 cursor-not-allowed'}`}><ChevronLeft size={16} strokeWidth={1.75} /></button>
          <button onClick={goToday} className="px-2 py-1 rounded-md text-xs font-medium text-fg-muted hover:bg-surface-hover transition active:scale-95">오늘</button>
          <button onClick={goNext} disabled={!canNext} className={`p-1 rounded-md text-fg-muted transition active:scale-95 ${canNext ? 'hover:bg-surface-hover' : 'opacity-30 cursor-not-allowed'}`}><ChevronRight size={16} strokeWidth={1.75} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map(d => <div key={d} className="py-1.5 text-center text-[10px] font-semibold text-fg-muted border-r border-line last:border-0">{d}</div>)}
      </div>
      <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-y-auto">
        {days.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} className="border-b border-r border-line bg-surface-2"></div>;
          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayEntries = entriesOf(dateStr); // [{ task, kind }] — 시작일 빠른 순
          const isToday = showingCurrentMonth && day === today.getDate();
          const isSelected = selected === dateStr;
          const limit = isMobile ? CAL_MAX_DOTS : CAL_MAX_ROWS;
          const shown = dayEntries.slice(0, limit);
          const more = dayEntries.length - shown.length;
          return (
            <div
              key={day}
              onClick={() => setSelected(dayEntries.length ? dateStr : null)}
              className={`border-b border-r border-line p-1 ${isMobile ? 'min-h-[58px]' : 'min-h-[84px]'} ${dayEntries.length ? 'cursor-pointer' : ''} ${isSelected ? 'bg-accent-weak/70 ring-1 ring-inset ring-accent' : isToday ? 'bg-accent-weak' : ''}`}
            >
              <div className={`text-[10px] font-semibold px-1 ${isToday ? 'text-accent' : 'text-fg-muted'}`}>{day}</div>
              {isMobile ? (
                // 모바일: 53px 남짓한 칸에 제목을 넣으면 아무것도 안 읽힌다 →
                // 팀 색 점으로만 표시하고, 날짜를 누르면 아래 목록에서 제대로 읽는다.
                <div className="flex flex-wrap items-center gap-1 px-1 mt-1.5">
                  {shown.map(({ task }) => (
                    <span key={task.id} className="w-2 h-2 rounded-full shrink-0" style={teamPaint(task.teams, true)} />
                  ))}
                  {more > 0 && <span className="text-[9px] font-semibold text-fg-faint leading-none">+{more}</span>}
                </div>
              ) : (
                <div className="space-y-1 mt-0.5">
                  {shown.map(({ task, kind }) => (
                    <CalendarBand key={task.id} task={task} kind={kind} onClick={onTaskClick} />
                  ))}
                  {more > 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setSelected(dateStr); }}
                      className="w-full text-left text-[9px] font-semibold text-fg-muted hover:text-accent-text px-1.5 py-0.5 rounded-sm hover:bg-surface-hover transition"
                    >+{more}개 더</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {selected && <CalendarDayPanel dateStr={selected} entries={entriesOf(selected)} onTaskClick={onTaskClick} onClose={() => setSelected(null)} />}
    </div>
  );
});

// 기간 띠 한 조각. 제목은 시작 칸에서 한 번만 쓴다 —
// 주가 바뀔 때마다 다시 쓰면 같은 업무가 여러 번 적힌 것처럼 보인다.
function CalendarBand({ task, kind, onClick }) {
  const paint = teamPaint(task.teams);
  const base = 'flex items-center h-[18px] text-[9px] cursor-pointer hover:opacity-80 transition-opacity';
  const label = <span className="overflow-visible relative z-[5] whitespace-nowrap pointer-events-none">{task.title}</span>;
  let cls = '', content = null;
  if (kind === 'mid') {
    cls = 'rounded-none -mx-1';                     // 셀 사이를 끊김 없이 이어 붙인다
  } else if (kind === 'start') {
    cls = 'rounded-l-sm -mr-1 px-1.5 overflow-visible';
    content = label;
  } else if (kind === 'due') {
    cls = 'rounded-r-sm -ml-1 px-1.5';              // 마감 칸은 띠만(제목은 시작 칸에 있음)
  } else {
    cls = 'rounded-sm px-1.5 overflow-hidden';      // single / due-only
    content = <span className="truncate">{task.title}</span>;
  }
  const period = task.startDate && task.dueDate && task.startDate !== task.dueDate
    ? `${task.startDate} ~ ${task.dueDate}` : (task.dueDate || task.startDate || '');
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(task); }}
      title={`${task.title}${period ? ` (${period})` : ''}${task.teams?.length ? ` · ${task.teams.join(', ')}` : ''}`}
      className={`${base} ${cls}`} style={paint}
    >
      {content}
    </div>
  );
}

// 날짜를 누르면 그 날의 업무를 제대로 읽을 수 있는 목록 (모바일·데스크톱 공용)
function CalendarDayPanel({ dateStr, entries, onTaskClick, onClose }) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const KIND_LABEL = { start: '시작', mid: '진행', due: '마감', single: '하루', 'due-only': '마감' };
  return (
    <div className="border-t border-line bg-surface-2/60 shrink-0 max-h-[38%] overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2 sticky top-0 bg-surface-2">
        <span className="text-xs font-bold text-fg">{m}월 {d}일 ({weekday}) · {entries.length}건</span>
        <button type="button" onClick={onClose} className="p-1 rounded-md text-fg-faint hover:bg-surface-hover transition active:scale-95"><X size={14} /></button>
      </div>
      <div className="divide-y divide-line/60">
        {entries.map(({ task, kind }) => (
          <button
            key={task.id} type="button" onClick={() => onTaskClick(task)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-hover transition-colors"
          >
            <span className="w-1.5 h-7 rounded-full shrink-0" style={teamPaint(task.teams, true)} />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] text-fg truncate">{task.title}</span>
              <span className="block text-[10px] text-fg-faint truncate mt-0.5">
                {KIND_LABEL[kind] || ''}{task.teams?.length ? ` · ${task.teams.join(', ')}` : ''}
              </span>
            </span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${CONFIG.STATUS_STYLES[task.status] || ''}`}>{task.status}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 카드 내부 프레젠테이션 (실제 카드 + DragOverlay 미리보기 공용)
const TaskCardInner = React.memo(({ task, projectsMap, showProjectBadge, action = null }) => (
  <>
    {showProjectBadge && projectsMap[task.projectId] && <div className="text-[9px] text-fg-faint mb-1.5 flex items-center gap-1"><Folder size={10}/> {projectsMap[task.projectId].title}</div>}
    {/* 팀 배지와 같은 줄의 오른쪽 끝에 액션(모바일 상태 옮기기)을 둔다.
        푸터에 넣으면 담당자↔마감일 좌우 균형이 깨져 마감일이 가운데 떠 보였다. */}
    {(task.teams.length > 0 || action) && (
      <div className="flex items-start gap-2 mb-2">
        <div className="flex flex-wrap gap-1 min-w-0 flex-1">
          {task.teams.map(team => <span key={team} className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold ${CONFIG.TEAMS[team]}`}>{team}</span>)}
        </div>
        {action}
      </div>
    )}
    <h4 className="font-semibold text-sm text-fg mb-2 leading-tight group-hover:text-accent transition-colors">{task.title}</h4>
    <div className="flex items-center justify-between text-[10px] text-fg-muted mt-3 border-t border-line pt-2 gap-2">
      <div className="flex items-center gap-1 min-w-0">
        {task.assignees.length > 0 ? (
          <><span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0 ${avatarColor(task.assignees[0])}`}>{task.assignees[0][0]}</span><span className="truncate">{task.assignees[0]}{task.assignees.length > 1 ? ` +${task.assignees.length - 1}` : ''}</span></>
        ) : (
          <><User size={12} className="text-fg-faint shrink-0" /><span className="truncate text-fg-faint">미지정</span></>
        )}
      </div>
      {task.dueDate && <div className="flex items-center gap-1 text-tag-orange-fg bg-tag-orange px-1.5 py-0.5 rounded shrink-0"><Clock size={10} /><span>{new Date(task.dueDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric'})}</span></div>}
    </div>
  </>
));

// 모바일에서 끌지 않고 상태를 옮기는 버튼 — 카드마다 하나(모바일 전용).
// 길게 눌러 끌기는 그대로 두고, "탭 → 상태 고르기"라는 확실한 길을 하나 더 준다.
// 팝오버는 반드시 포털로 띄운다: 카드에 content-visibility가 걸려 있어 카드 안의
// position:fixed는 뷰포트가 아니라 카드를 기준으로 잡힌다.
function StatusMoveButton({ task, onStatusChange }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const btnRef = React.useRef(null);
  const popRef = React.useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open, 176, 200);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      const inside = rootRef.current?.contains(e.target) || popRef.current?.contains(e.target);
      if (!inside) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // pointerDown까지 막아야 dnd-kit이 이 버튼을 드래그 시작으로 보지 않는다
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };

  return (
    <span ref={rootRef} className="md:hidden inline-flex shrink-0">
      <span ref={btnRef} className="inline-flex">
        <button
          type="button" title="상태 옮기기" aria-label="상태 옮기기"
          onPointerDown={stop} onTouchStart={stop} onMouseDown={stop}
          onClick={(e) => { e.stopPropagation(); place(); setOpen(o => !o); }}
          className="p-1.5 -m-0.5 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95"
        >
          <ArrowLeftRight size={13} strokeWidth={1.75} />
        </button>
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: 176 }}
          className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-1 animate-in fade-in zoom-in-95 duration-150"
        >
          <p className="px-2 pt-1 pb-1.5 text-[10px] font-bold text-fg-faint">상태 옮기기</p>
          {CONFIG.STATUSES.map(s => (
            <button
              key={s} type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); if (s !== task.status) onStatusChange(task, s); }}
              className={`w-full flex items-center gap-2 px-2 py-2.5 rounded-md text-left text-[13px] transition-colors ${s === task.status ? 'text-fg font-semibold bg-surface-hover' : 'text-fg-muted hover:bg-surface-hover'}`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${CONFIG.STATUS_DOTS[s] || 'bg-fg-faint'}`} />
              <span className="flex-1 truncate">{s}</span>
              {s === task.status && <Check size={13} className="text-accent-text shrink-0" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </span>
  );
}

// 드래그 가능한 카드 — 클릭(모달)과 드래그는 센서 activationConstraint(distance/delay)로 구분
function DraggableCard({ task, projectsMap, showProjectBadge, onTaskClick, onStatusChange }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef} {...attributes} {...listeners}
      onClick={() => onTaskClick(task)}
      className={`board-card bg-surface p-3.5 rounded-lg border border-line cursor-grab active:cursor-grabbing hover:shadow-soft hover:-translate-y-0.5 transition-all group animate-in fade-in zoom-in-95 duration-200 ${isDragging ? 'opacity-40' : ''}`}
    >
      <TaskCardInner
        task={task} projectsMap={projectsMap} showProjectBadge={showProjectBadge}
        action={<StatusMoveButton task={task} onStatusChange={onStatusChange} />}
      />
    </div>
  );
}

// 모바일 상태 칩 — 탭하면 그 컬럼으로 이동, 드래그 중에는 드롭 타깃.
// 컬럼과 id가 겹치지 않게 'chip:' 접두사를 쓰고 handleDragEnd에서 벗겨낸다.
function StatusChip({ status, count, current, dragging, isDraggedStatus, onClick }) {
  const { setNodeRef, isOver } = useDroppable({ id: `chip:${status}` });
  const base = 'shrink-0 inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-[11px] font-semibold transition active:scale-95';
  let tone;
  if (dragging) {
    if (isOver) tone = 'bg-accent-weak border-accent text-accent-text shadow-soft scale-105';
    else if (isDraggedStatus) tone = 'bg-surface-2 border-line border-dashed text-fg-faint';
    else tone = 'bg-surface border-accent border-dashed text-fg-muted';
  } else {
    tone = current ? 'bg-surface border-accent text-fg shadow-soft' : 'bg-surface-2 border-line text-fg-muted';
  }
  return (
    <button ref={setNodeRef} type="button" onClick={onClick} className={`${base} ${tone}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CONFIG.STATUS_DOTS[status] || 'bg-fg-faint'}`} />
      {status}
      <span className="text-fg-faint font-normal">{count}</span>
    </button>
  );
}

// 드롭 대상 컬럼(status) — dnd-kit useDroppable의 isOver로 강조
function ColumnDroppable({ status, count, dragging, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      // 모바일: 80vw로 다음 컬럼이 살짝 보이게(더 있다는 신호) + 스냅
      // 데스크톱: flex-1로 4개 상태가 가로 스크롤 없이 한 화면에 들어온다
      className={`flex-1 basis-0 min-w-[80vw] md:min-w-[180px] flex flex-col rounded-lg p-3 border snap-start h-full transition-colors duration-150 ${isOver ? 'border-accent bg-accent-weak/60' : 'bg-surface border-line'}`}
    >
      <div className="flex items-center justify-between mb-3 px-1 shrink-0">
        <h3 className="font-semibold text-[13px] md:text-sm text-fg flex items-center gap-1.5 tracking-[-0.25px] min-w-0"><div className={`w-2 h-2 rounded-full shrink-0 ${CONFIG.STATUS_DOTS[status] || 'bg-fg-faint'}`}></div><span className="leading-none truncate">{status}</span><span className="text-fg-faint text-xs font-normal leading-none mt-px shrink-0">{count}</span></h3>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-4">
        {children}
        {/* 드래그 중일 때만 드롭 존 안내 표시 */}
        <div className={`h-16 border-2 border-dashed rounded-md flex items-center justify-center text-xs transition-all ${dragging ? (isOver ? 'opacity-100 border-accent text-accent-text' : 'opacity-100 border-line text-fg-faint') : 'opacity-0 border-transparent text-fg-faint'}`}>여기로 놓기</div>
      </div>
    </div>
  );
}

export const Board = React.memo(({ tasks, onStatusChange, onTaskClick, showProjectBadge }) => {
  const projectsMap = useStore(selectProjectsMap);
  const [activeId, setActiveId] = React.useState(null);
  const scrollRef = React.useRef(null);
  const [visibleCol, setVisibleCol] = React.useState(0);

  // 상태별 그룹핑을 한 번만 — 컬럼마다 filter를 두 번씩 돌지 않게
  const byStatus = React.useMemo(() => {
    const m = {};
    CONFIG.STATUSES.forEach(s => { m[s] = []; });
    tasks.forEach(t => { (m[t.status] || (m[t.status] = [])).push(t); });
    return m;
  }, [tasks]);

  // 모바일은 컬럼이 80vw라 4개를 동시에 못 보여준다 → 상단에 상태 칩으로
  // 4개 상태와 건수를 한눈에 보여주고, 누르면 그 컬럼으로 스크롤한다.
  const goCol = (i) => {
    const el = scrollRef.current;
    const col = el?.children?.[i];
    if (col) el.scrollTo({ left: col.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  };
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const per = el.scrollWidth / CONFIG.STATUSES.length;
    setVisibleCol(Math.min(CONFIG.STATUSES.length - 1, Math.round(el.scrollLeft / per)));
  };

  // MouseSensor + TouchSensor로 입력 종류를 완전히 분리한다.
  // PointerSensor를 쓰면 터치에서도 pointerdown이 잡혀 6px 이동하는 순간 드래그가
  // 시작되고, 동시에 브라우저는 스크롤을 시작해 pointercancel을 던진다 → 드래그가
  // 매번 취소돼서 모바일에서 카드가 아예 안 옮겨졌다(실측 확인).
  // 터치는 TouchSensor만 담당: 200ms 꾹 누르면 시작하고, 그때부터 dnd-kit이
  // touchmove를 preventDefault해서 스크롤과 싸우지 않는다.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  const handleDragStart = (e) => setActiveId(e.active.id);
  const handleDragCancel = () => setActiveId(null);
  const handleDragEnd = (e) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;
    // 드롭 타깃은 컬럼('시작 전') 또는 모바일 상태 칩('chip:시작 전')
    const raw = String(over.id);
    const target = raw.startsWith('chip:') ? raw.slice(5) : raw;
    const task = tasks.find(t => t.id === active.id);
    if (task && task.status !== target) onStatusChange(task, target);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={dropCollision} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div className="h-full flex flex-col min-h-0">
        {/* 모바일 전용 상태 칩 — 평소엔 요약·이동, 드래그 중에는 드롭 타깃이 된다.
            (화면에 컬럼 하나만 보이는 모바일에서 옆 컬럼까지 끌고 갈 필요가 없도록) */}
        <div className="md:hidden flex gap-1.5 mb-2 overflow-x-auto scrollbar-hide shrink-0">
          {CONFIG.STATUSES.map((status, i) => (
            <StatusChip
              key={status} status={status} count={(byStatus[status] || []).length}
              current={i === visibleCol} dragging={!!activeId}
              isDraggedStatus={activeTask?.status === status}
              onClick={() => goCol(i)}
            />
          ))}
        </div>
        {activeId && (
          <p className="md:hidden text-center text-[10px] text-fg-faint mb-1.5 -mt-0.5">위 상태 칩에 놓으면 바로 옮겨져요</p>
        )}
        <div
          ref={scrollRef} onScroll={onScroll}
          className={`flex-1 min-h-0 flex gap-3 md:gap-4 pb-2 overflow-x-auto ${activeId ? '' : 'snap-x snap-mandatory md:snap-none'}`}
        >
          {CONFIG.STATUSES.map(status => (
            <ColumnDroppable key={status} status={status} dragging={!!activeId} count={(byStatus[status] || []).length}>
              {(byStatus[status] || []).map(task => (
                <DraggableCard key={task.id} task={task} projectsMap={projectsMap} showProjectBadge={showProjectBadge} onTaskClick={onTaskClick} onStatusChange={onStatusChange} />
              ))}
            </ColumnDroppable>
          ))}
        </div>
      </div>
      {/* 드래그 중 미리보기(기존 스타일 유지). 원래 카드는 opacity-40 */}
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="bg-surface p-3.5 rounded-lg border border-line shadow-elevated rotate-1 scale-[.98] opacity-90 cursor-grabbing">
            <TaskCardInner task={activeTask} projectsMap={projectsMap} showProjectBadge={showProjectBadge} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});
