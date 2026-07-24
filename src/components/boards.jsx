import React from 'react';
import { User, Clock, Folder, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from '@dnd-kit/core';
import { CONFIG } from '../config.js';
import { avatarColor } from '../utils.js';
import { useStore } from '../store/workspaceStore.js';
import { selectProjectsMap, selectTasksByDate } from '../store/selectors.js';

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
          return (
            <div key={day} className={`border-b border-r border-line p-1 min-h-[80px] ${isToday ? 'bg-accent-weak' : ''}`}>
              <div className={`text-[10px] font-semibold p-1 ${isToday ? 'text-accent' : 'text-fg-muted'}`}>{day}</div>
              <div className="space-y-1 mt-0.5">
                {dayEntries.map(({ task, kind }, i) => {
                  const base = 'flex items-center h-[18px] text-[9px] overflow-hidden cursor-pointer hover:opacity-80 transition-opacity';
                  let cls, content, prefix;
                  if (kind === 'mid') {
                    cls = 'bg-tag-blue rounded-none -mx-1'; content = null; prefix = '진행';
                  } else if (kind === 'start') {
                    cls = 'bg-tag-blue text-tag-blue-fg rounded-l-sm rounded-r-none -mr-1 px-1.5';
                    content = <span className="truncate">{task.title}</span>; prefix = '시작';
                  } else if (kind === 'due') {
                    cls = 'bg-tag-blue text-tag-blue-fg rounded-r-sm rounded-l-none -ml-1 px-1.5 justify-end';
                    content = <span className="text-[8px] opacity-70">마감</span>; prefix = '마감';
                  } else if (kind === 'single') {
                    cls = 'bg-tag-blue text-tag-blue-fg rounded-sm px-1.5';
                    content = <span className="truncate">{task.title}</span>; prefix = '기간';
                  } else { // due-only
                    cls = 'bg-tag-orange text-tag-orange-fg rounded-sm px-1.5';
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
const TaskCardInner = React.memo(({ task, projectsMap, showProjectBadge }) => (
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
    </div>
  </>
));

// 드래그 가능한 카드 — 클릭(모달)과 드래그는 센서 activationConstraint(distance/delay)로 구분
function DraggableCard({ task, projectsMap, showProjectBadge, onTaskClick }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef} {...attributes} {...listeners}
      onClick={() => onTaskClick(task)}
      className={`bg-surface p-3.5 rounded-lg border border-line cursor-grab active:cursor-grabbing hover:shadow-soft hover:-translate-y-0.5 transition-all group animate-in fade-in zoom-in-95 duration-200 ${isDragging ? 'opacity-40' : ''}`}
    >
      <TaskCardInner task={task} projectsMap={projectsMap} showProjectBadge={showProjectBadge} />
    </div>
  );
}

// 드롭 대상 컬럼(status) — dnd-kit useDroppable의 isOver로 강조
function ColumnDroppable({ status, count, dragging, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[280px] max-w-[350px] flex flex-col rounded-lg p-3 border snap-center h-full transition-colors duration-150 ${isOver ? 'border-accent bg-accent-weak/60' : 'bg-surface border-line'}`}
    >
      <div className="flex items-center justify-between mb-3 px-1 shrink-0">
        <h3 className="font-semibold text-sm text-fg flex items-center gap-1.5 tracking-[-0.25px]"><div className={`w-2 h-2 rounded-full shrink-0 ${status === '시작 전' ? 'bg-fg-faint' : status === '진행 중' ? 'bg-accent' : 'bg-tag-green'}`}></div><span className="leading-none">{status}</span><span className="text-fg-faint text-xs font-normal leading-none mt-px">{count}</span></h3>
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

  // PointerSensor: 마우스/펜은 6px 이동해야 드래그 시작(짧은 클릭은 모달 열기로).
  // TouchSensor: 180ms 눌러야 시작 — 그냥 스와이프는 스크롤(가로/세로)로 동작.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
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
      <div className={`flex gap-4 h-full pb-2 overflow-x-auto ${activeId ? '' : 'snap-x snap-mandatory'}`}>
        {CONFIG.STATUSES.map(status => (
          <ColumnDroppable key={status} status={status} dragging={!!activeId} count={tasks.filter(t => t.status === status).length}>
            {tasks.filter(t => t.status === status).map(task => (
              <DraggableCard key={task.id} task={task} projectsMap={projectsMap} showProjectBadge={showProjectBadge} onTaskClick={onTaskClick} />
            ))}
          </ColumnDroppable>
        ))}
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
