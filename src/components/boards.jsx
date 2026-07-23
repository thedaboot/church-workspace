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
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col h-full min-h-[400px]">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="font-bold text-sm text-gray-800">{currentYear}년 {currentMonth + 1}월</h3></div>
      <div className="grid grid-cols-7 border-b border-gray-200">
        {['일', '월', '화', '수', '목', '금', '토'].map(d => <div key={d} className="py-1.5 text-center text-[10px] font-semibold text-gray-500 border-r border-gray-100 last:border-0">{d}</div>)}
      </div>
      <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-y-auto">
        {days.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} className="border-b border-r border-gray-100 bg-gray-50/30"></div>;
          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayTasks = tasksByDateMap.get(dateStr) || []; // O(1) Lookup
          const isToday = day === today.getDate();
          return (
            <div key={day} className={`border-b border-r border-gray-100 p-1 min-h-[80px] ${isToday ? 'bg-blue-50/20' : ''}`}>
              <div className={`text-[10px] font-semibold p-1 ${isToday ? 'text-blue-600' : 'text-gray-500'}`}>{day}</div>
              <div className="space-y-1 mt-0.5">
                {dayTasks.map(task => <div key={task.id} onClick={() => onTaskClick(task)} className="text-[9px] truncate px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 cursor-pointer hover:bg-indigo-100 transition-colors">{task.title}</div>)}
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
  const onDragStart = (e, taskJson) => e.dataTransfer.setData('taskJson', taskJson);
  const onDrop = (e, status) => { const json = e.dataTransfer.getData('taskJson'); if (json) { const task = JSON.parse(json); if (task.status !== status) onStatusChange(task, status); } };

  return (
    <div className="flex gap-4 h-full pb-2 overflow-x-auto snap-x snap-mandatory">
      {CONFIG.STATUSES.map(status => (
        <div key={status} className="flex-1 min-w-[280px] max-w-[350px] flex flex-col bg-gray-100/60 rounded-xl p-3 border border-gray-200 snap-center h-full" onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e, status)}>
          <div className="flex items-center justify-between mb-3 px-1 shrink-0">
            <h3 className="font-semibold text-sm text-gray-700 flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${status === '시작 전' ? 'bg-gray-400' : status === '진행 중' ? 'bg-blue-500' : 'bg-green-500'}`}></div>{status} <span className="text-gray-400 text-xs font-normal">{tasks.filter(t => t.status === status).length}</span></h3>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-4">
            {tasks.filter(t => t.status === status).map(task => (
              <div key={task.id} draggable onDragStart={e => onDragStart(e, JSON.stringify(task))} onClick={() => onTaskClick(task)} className="bg-white p-3.5 rounded-xl shadow-sm border border-gray-200 cursor-pointer hover:border-blue-300 hover:shadow-md transition-all group">
                {showProjectBadge && projectsMap[task.projectId] && <div className="text-[9px] text-gray-400 mb-1.5 flex items-center gap-1"><Folder size={10}/> {projectsMap[task.projectId].title}</div>}
                <div className="flex flex-wrap gap-1 mb-2">{task.teams.map(team => <span key={team} className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold ${CONFIG.TEAMS[team]}`}>{team}</span>)}</div>
                <h4 className="font-semibold text-sm text-gray-800 mb-2 leading-tight group-hover:text-blue-600 transition-colors">{task.title}</h4>
                <div className="flex items-center justify-between text-[10px] text-gray-500 mt-3 border-t border-gray-50 pt-2">
                  <div className="flex items-center gap-1 min-w-0"><User size={12} className="text-gray-400 shrink-0" /><span className="truncate">{task.assignees.join(', ') || '미지정'}</span></div>
                  {task.dueDate && <div className="flex items-center gap-1 text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded shrink-0"><Clock size={10} /><span>{new Date(task.dueDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric'})}</span></div>}
                </div>
              </div>
            ))}
            <div className="h-16 border-2 border-dashed border-transparent rounded-xl flex items-center justify-center text-xs text-gray-400 opacity-0 hover:opacity-100 hover:border-gray-300 transition-all">여기로 드래그</div>
          </div>
        </div>
      ))}
    </div>
  );
});
