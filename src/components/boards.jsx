import React from 'react';
import { createPortal } from 'react-dom';
import { User, Clock, Folder, ChevronLeft, ChevronRight, ArrowLeftRight, Check } from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from '@dnd-kit/core';
import { CONFIG } from '../config.js';
import { avatarColor } from '../utils.js';
import { useStore } from '../store/workspaceStore.js';
import { selectProjectsMap, selectTasksByDate } from '../store/selectors.js';
import { useAnchoredPos } from './ConfirmPopover.jsx';

const CAL_MIN_YEAR = new Date().getFullYear();
const CAL_MAX_YEAR = 2030;

// ============================================================================
// 12. UI Components (순수 프레젠테이션)
// ============================================================================
export const CalendarBoard = React.memo(({ tasks, onTaskClick }) => {
  // O(1) 맵핑 캐싱된 Selector 활용
  const tasksByDateMap = useStore(selectTasksByDate);

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
        {['일', '월', '화', '수', '목', '금', '토'].map(d => <div key={d} className="py-1.5 text-center text-[10px] font-semibold text-fg-muted border-r border-line last:border-0">{d}</div>)}
      </div>
      <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-y-auto">
        {days.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} className="border-b border-r border-line bg-surface-2"></div>;
          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayEntries = tasksByDateMap.get(dateStr) || []; // O(1) Lookup — [{ task, kind }]
          const isToday = showingCurrentMonth && day === today.getDate();
          // 주의 첫 칸(일요일)에서는 이어지는 기간 띠에 제목을 다시 표시
          const isWeekStart = (firstDayIndex + day - 1) % 7 === 0;
          return (
            <div key={day} className={`border-b border-r border-line p-1 min-h-[80px] ${isToday ? 'bg-accent-weak' : ''}`}>
              <div className={`text-[10px] font-semibold p-1 ${isToday ? 'text-accent' : 'text-fg-muted'}`}>{day}</div>
              <div className="space-y-1 mt-0.5">
                {dayEntries.map(({ task, kind }, i) => {
                  // 여러 날에 걸친 띠는 제목이 셀 경계를 넘어 띠 위로 이어져 보이게
                  // (overflow-visible + nowrap, 띠 색이 같아 자연스럽게 얹힘)
                  const base = 'flex items-center h-[18px] text-[9px] cursor-pointer hover:opacity-80 transition-opacity';
                  const flow = 'overflow-visible relative z-[5] whitespace-nowrap';
                  const label = <span className={`${flow} pointer-events-none`}>{task.title}</span>;
                  let cls, content, prefix;
                  if (kind === 'mid') {
                    cls = 'bg-tag-blue rounded-none -mx-1 overflow-visible';
                    content = isWeekStart ? <span className="text-tag-blue-fg px-1.5">{label}</span> : null;
                    prefix = '진행';
                  } else if (kind === 'start') {
                    cls = 'bg-tag-blue text-tag-blue-fg rounded-l-sm rounded-r-none -mr-1 px-1.5 overflow-visible';
                    content = label; prefix = '시작';
                  } else if (kind === 'due') {
                    cls = 'bg-tag-blue text-tag-blue-fg rounded-r-sm rounded-l-none -ml-1 px-1.5 justify-end overflow-hidden';
                    content = isWeekStart
                      ? <span className="truncate">{task.title}</span>
                      : <span className="text-[8px] opacity-70">마감</span>;
                    prefix = '마감';
                  } else if (kind === 'single') {
                    // 하루짜리는 셀 안에서 truncate (넘칠 곳이 없음)
                    cls = 'bg-tag-blue text-tag-blue-fg rounded-sm px-1.5 overflow-hidden';
                    content = <span className="truncate">{task.title}</span>; prefix = '기간';
                  } else { // due-only
                    cls = 'bg-tag-orange text-tag-orange-fg rounded-sm px-1.5 overflow-hidden';
                    content = <span className="truncate">{task.title}</span>; prefix = '마감';
                  }
                  return (
                    <div key={`${task.id}-${kind}-${i}`} onClick={() => onTaskClick(task)} title={`${prefix}: ${task.title}`} className={`${base} ${cls}`}>
                      {content}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// 카드 내부 프레젠테이션 (실제 카드 + DragOverlay 미리보기 공용)
const TaskCardInner = React.memo(({ task, projectsMap, showProjectBadge, action = null }) => (
  <>
    {showProjectBadge && projectsMap[task.projectId] && <div className="text-[9px] text-fg-faint mb-1.5 flex items-center gap-1"><Folder size={10}/> {projectsMap[task.projectId].title}</div>}
    <div className="flex flex-wrap gap-1 mb-2">{task.teams.map(team => <span key={team} className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold ${CONFIG.TEAMS[team]}`}>{team}</span>)}</div>
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
      {action}
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

  // PointerSensor: 마우스/펜은 6px 이동해야 드래그 시작(짧은 클릭은 모달 열기로).
  // TouchSensor: 250ms 꾹 눌러야 시작하고, 그 사이 6px 이상 움직이면 취소 → 스크롤.
  // 스크롤이 드래그로 잘못 잡히는 쪽을 줄였다(끌기 대신 카드의 '상태 옮기기' 버튼도 있으므로).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  const handleDragStart = (e) => setActiveId(e.active.id);
  const handleDragCancel = () => setActiveId(null);
  const handleDragEnd = (e) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;
    const task = tasks.find(t => t.id === active.id);
    if (task && task.status !== over.id) onStatusChange(task, over.id);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div className="h-full flex flex-col min-h-0">
        {/* 모바일 전용 상태 요약·이동 칩 */}
        <div className="md:hidden flex gap-1.5 mb-2 overflow-x-auto scrollbar-hide shrink-0">
          {CONFIG.STATUSES.map((status, i) => (
            <button
              key={status} type="button" onClick={() => goCol(i)}
              className={`shrink-0 inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-[11px] font-semibold transition active:scale-95 ${i === visibleCol ? 'bg-surface border-accent text-fg shadow-soft' : 'bg-surface-2 border-line text-fg-muted'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CONFIG.STATUS_DOTS[status] || 'bg-fg-faint'}`} />
              {status}
              <span className="text-fg-faint font-normal">{(byStatus[status] || []).length}</span>
            </button>
          ))}
        </div>
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
