import React from 'react';
import { User, Clock, Folder } from 'lucide-react';
import { CONFIG } from '../config.js';
import { useStore } from '../store/workspaceStore.js';
import { selectProjectsMap, selectTasksByDate } from '../store/selectors.js';

// ============================================================================
// 12. UI Components (순수 프레젠테이션)
// ============================================================================
export const CalendarBoard = React.memo(({ tasks, onTaskClick }) => {
  // O(1) 맵핑 캐싱된 Selector 활용
  const tasksByDateMap = useStore(selectTasksByDate);

  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();

  const days = Array.from({ length: firstDayIndex + daysInMonth }, (_, i) => i < firstDayIndex ? null : i - firstDayIndex + 1);

  return (
    <div className="bg-surface rounded-lg border border-line flex flex-col h-full min-h-[400px]">
      <div className="px-4 py-3 border-b border-line bg-surface-2"><h3 className="font-semibold text-sm text-fg tracking-[-0.25px]">{currentYear}년 {currentMonth + 1}월</h3></div>
      <div className="grid grid-cols-7 border-b border-line">
        {['일', '월', '화', '수', '목', '금', '토'].map(d => <div key={d} className="py-1.5 text-center text-[10px] font-semibold text-fg-muted border-r border-line last:border-0">{d}</div>)}
      </div>
      <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-y-auto">
        {days.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} className="border-b border-r border-line bg-surface-2"></div>;
          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayTasks = tasksByDateMap.get(dateStr) || []; // O(1) Lookup
          const isToday = day === today.getDate();
          return (
            <div key={day} className={`border-b border-r border-line p-1 min-h-[80px] ${isToday ? 'bg-accent-weak' : ''}`}>
              <div className={`text-[10px] font-semibold p-1 ${isToday ? 'text-accent' : 'text-fg-muted'}`}>{day}</div>
              <div className="space-y-1 mt-0.5">
                {dayTasks.map(task => <div key={task.id} onClick={() => onTaskClick(task)} className="text-[9px] truncate px-1.5 py-0.5 rounded bg-accent-weak text-accent border border-line cursor-pointer hover:bg-surface-hover transition-colors">{task.title}</div>)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const Board = React.memo(({ tasks, onStatusChange, onTaskClick, showProjectBadge }) => {
  const projectsMap = useStore(selectProjectsMap);
  const [draggingId, setDraggingId] = React.useState(null);
  const [overStatus, setOverStatus] = React.useState(null);

  const onDragStart = (e, task) => {
    e.dataTransfer.setData('taskJson', JSON.stringify(task));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(task.id);
  };
  const onDragEnd = () => { setDraggingId(null); setOverStatus(null); };
  const onDrop = (e, status) => {
    const json = e.dataTransfer.getData('taskJson');
    if (json) { const task = JSON.parse(json); if (task.status !== status) onStatusChange(task, status); }
    onDragEnd();
  };

  return (
    <div className="flex gap-4 h-full pb-2 overflow-x-auto snap-x snap-mandatory">
      {CONFIG.STATUSES.map(status => {
        const isOver = draggingId && overStatus === status;
        return (
        <div
          key={status}
          className={`flex-1 min-w-[280px] max-w-[350px] flex flex-col rounded-lg p-3 border snap-center h-full transition-colors duration-150 ${isOver ? 'border-accent bg-accent-weak/60' : 'bg-surface border-line'}`}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overStatus !== status) setOverStatus(status); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOverStatus(prev => prev === status ? null : prev); }}
          onDrop={e => onDrop(e, status)}
        >
          <div className="flex items-center justify-between mb-3 px-1 shrink-0">
            <h3 className="font-semibold text-sm text-fg flex items-center gap-2 tracking-[-0.25px]"><div className={`w-2 h-2 rounded-full ${status === '시작 전' ? 'bg-fg-faint' : status === '진행 중' ? 'bg-accent' : 'bg-tag-green'}`}></div>{status} <span className="text-fg-faint text-xs font-normal">{tasks.filter(t => t.status === status).length}</span></h3>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-4">
            {tasks.filter(t => t.status === status).map(task => (
              <div
                key={task.id} draggable
                onDragStart={e => onDragStart(e, task)} onDragEnd={onDragEnd}
                onClick={() => onTaskClick(task)}
                className={`bg-surface p-3.5 rounded-lg border border-line cursor-grab active:cursor-grabbing hover:shadow-soft transition-all group animate-in fade-in zoom-in-95 duration-200 ${draggingId === task.id ? 'opacity-40 rotate-1 scale-[.98] shadow-elevated' : ''}`}
              >
                {showProjectBadge && projectsMap[task.projectId] && <div className="text-[9px] text-fg-faint mb-1.5 flex items-center gap-1"><Folder size={10}/> {projectsMap[task.projectId].title}</div>}
                <div className="flex flex-wrap gap-1 mb-2">{task.teams.map(team => <span key={team} className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold ${CONFIG.TEAMS[team]}`}>{team}</span>)}</div>
                <h4 className="font-semibold text-sm text-fg mb-2 leading-tight group-hover:text-accent transition-colors">{task.title}</h4>
                <div className="flex items-center justify-between text-[10px] text-fg-muted mt-3 border-t border-line pt-2">
                  <div className="flex items-center gap-1 min-w-0"><User size={12} className="text-fg-faint shrink-0" /><span className="truncate">{task.assignees.join(', ') || '미지정'}</span></div>
                  {task.dueDate && <div className="flex items-center gap-1 text-tag-orange-fg bg-tag-orange px-1.5 py-0.5 rounded shrink-0"><Clock size={10} /><span>{new Date(task.dueDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric'})}</span></div>}
                </div>
              </div>
            ))}
            {/* 드래그 중일 때만 드롭 존 안내 표시 */}
            <div className={`h-16 border-2 border-dashed rounded-md flex items-center justify-center text-xs transition-all ${draggingId ? (isOver ? 'opacity-100 border-accent text-accent-text' : 'opacity-100 border-line text-fg-faint') : 'opacity-0 border-transparent text-fg-faint'}`}>여기로 놓기</div>
          </div>
        </div>
        );
      })}
    </div>
  );
});
