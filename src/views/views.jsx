import React, { useState, useMemo } from 'react';
import {
  LayoutDashboard, Plus, Calendar as CalendarIcon,
  Pin, ListTodo, ExternalLink, ChevronRight, Undo2, Check, X
} from 'lucide-react';
import { CONFIG } from '../config.js';
import { generateId } from '../utils.js';
import { store, useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsMap, selectMyTasks,
  selectDashboardStats, selectTasksList
} from '../store/selectors.js';
import { Board, CalendarBoard } from '../components/boards.jsx';

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================
export function DashboardView({ onNavigate }) {
  const { progress, teamStats } = useStore(selectDashboardStats);
  const myTasksCount = useStore(selectMyTasks).filter(t => t.status !== '완료').length;

  return (
    <div className="max-w-6xl mx-auto space-y-4 md:space-y-6 animate-in fade-in duration-300">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-surface p-5 md:p-6 rounded-lg border border-line">
          <h3 className="text-fg-muted text-xs md:text-sm font-medium mb-2">전체 프로젝트 진척도</h3>
          <div className="flex items-end gap-2"><span className="text-3xl md:text-4xl font-bold text-fg">{progress}%</span><span className="text-fg-muted text-xs mb-1">완료</span></div>
          <div className="w-full bg-surface-2 rounded-full h-2 mt-4"><div className="bg-accent h-2 rounded-full transition-all duration-1000" style={{ width: `${progress}%` }}></div></div>
        </div>
        <div onClick={() => onNavigate('myTasks')} className="bg-surface p-5 md:p-6 rounded-lg border border-line flex flex-col justify-between hover:bg-surface-hover transition-colors cursor-pointer group">
          <div><h3 className="text-fg-muted text-xs md:text-sm font-medium mb-2 group-hover:text-accent transition-colors">내 남은 업무</h3><div className="text-3xl md:text-4xl font-bold text-fg group-hover:text-accent transition-colors">{myTasksCount}개</div></div>
          <p className="text-xs text-fg-muted mt-2 flex justify-between items-center">오늘도 화이팅입니다! <span className="text-accent-text font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">확인하기 <ChevronRight size={12}/></span></p>
        </div>
        <div className="bg-night text-white p-5 md:p-6 rounded-lg flex flex-col justify-center sm:col-span-2 lg:col-span-1 relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white opacity-10 rounded-full blur-xl"></div>
          <h3 className="text-base md:text-lg font-bold mb-1 text-white tracking-[-0.25px]">엔터프라이즈 워크스페이스</h3>
          <p className="text-xs text-white/70 mb-4 leading-relaxed">상단 헤더의 '실행 취소(Undo)' 버튼을 눌러 상태 롤백을 경험해보세요.</p>
          {/* 밤하늘 카드는 항상 어두우므로 글자색을 테마와 무관한 잉크색으로 고정 */}
          <button onClick={() => onNavigate('guide')} className="bg-white text-[#31302e] hover:bg-white/90 text-xs py-2 px-4 rounded-full shadow-soft transition active:scale-95 self-start font-medium whitespace-nowrap">사용 가이드 보기</button>
        </div>
      </div>
      <div className="bg-surface rounded-lg border border-line overflow-hidden">
        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-line flex justify-between items-center bg-surface-2">
          <h3 className="font-bold text-sm md:text-base text-fg flex items-center gap-2 tracking-[-0.25px]"><ListTodo size={18} className="text-accent"/> 팀별 업무 현황</h3>
        </div>
        <div className="p-4 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {teamStats.map(stat => (
            <div key={stat.name} onClick={() => onNavigate(`team:${stat.name}`)} className="border border-line rounded-lg p-3 md:p-4 cursor-pointer hover:border-accent transition-all bg-surface group">
              <div className="flex justify-between items-center mb-2 md:mb-3">
                <span className={`px-2 py-1 rounded-sm text-[10px] md:text-xs font-bold ${CONFIG.TEAMS[stat.name]}`}>{stat.name}</span>
                <span className="text-xs font-medium text-fg-muted group-hover:text-accent transition-colors">{stat.done} / {stat.total} 완료 <ChevronRight size={12} className="inline opacity-0 group-hover:opacity-100 transition-opacity" /></span>
              </div>
              <div className="w-full bg-surface-2 rounded-full h-1.5 md:h-2 mb-2 md:mb-3 overflow-hidden"><div className="bg-accent h-full rounded-full transition-all duration-700" style={{ width: `${stat.progress}%` }}></div></div>
              <div>
                <p className="text-[10px] text-fg-faint mb-1.5">진행 중인 프로젝트:</p>
                <div className="flex flex-wrap gap-1">
                  {stat.projects.length > 0 ? stat.projects.map((p, i) => <span key={i} className="text-[9px] md:text-[10px] bg-surface-2 border border-line text-fg-muted px-1.5 py-0.5 rounded-md truncate max-w-full">{p}</span>) : <span className="text-[10px] text-fg-faint italic">없음</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProjectView({ projectId, onTaskClick, onStatusChange, onNewTask }) {
  const projectsMap = useStore(selectProjectsMap);
  const tasksList = useStore(selectTasksList);
  // 특정 프로젝트의 Task만 필터링 (해당 View 내부에서만 필요한 연산)
  const projectTasks = useMemo(() => tasksList.filter(t => t.projectId === projectId), [tasksList, projectId]);
  const project = projectsMap[projectId];

  const [viewMode, setViewMode] = useState('kanban');
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState({ title: '', url: '' });

  const toggleTeam = (team) => setSelectedTeams(prev => prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team]);
  const filteredTasks = useMemo(() => selectedTeams.length === 0 ? projectTasks : projectTasks.filter(task => task.teams.some(t => selectedTeams.includes(t))), [projectTasks, selectedTeams]);

  if (!project) return null;

  const saveLink = () => {
    if (!linkDraft.title.trim() || !linkDraft.url.trim()) return;
    const url = /^https?:\/\//.test(linkDraft.url) ? linkDraft.url : `https://${linkDraft.url}`;
    store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: project.id, pinnedLinks: [...(project.pinnedLinks || []), { id: generateId(), title: linkDraft.title.trim(), url }] } });
    setLinkDraft({ title: '', url: '' });
    setIsAddingLink(false);
  };
  const removeLink = (linkId) => store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: project.id, pinnedLinks: (project.pinnedLinks || []).filter(l => l.id !== linkId) } });

  return (
    <div className="h-full flex flex-col min-w-0 animate-in fade-in">
      <div className="bg-surface p-3 md:p-4 rounded-lg border border-line mb-3 md:mb-4 flex flex-col md:flex-row gap-3 md:gap-4 justify-between items-start md:items-center shrink-0">
        <div className="w-full md:w-auto">
          <h2 className="text-lg md:text-xl font-bold text-fg mb-2 tracking-[-0.25px]">{project.title}</h2>
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            <span className="text-[10px] md:text-xs font-semibold text-fg-muted uppercase flex items-center gap-1"><Pin size={12} /> 리소스:</span>
            {project.pinnedLinks?.map(link => (
              <span key={link.id} className="group/link inline-flex items-center gap-1 text-[10px] md:text-xs pl-1.5 pr-1 py-1 bg-accent-weak text-accent-text rounded-md transition-colors">
                <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><ExternalLink size={10} /> {link.title}</a>
                <button onClick={() => removeLink(link.id)} className="opacity-0 group-hover/link:opacity-100 hover:text-fg rounded-full p-0.5 transition-opacity" title="링크 삭제"><X size={10} /></button>
              </span>
            ))}
            {isAddingLink ? (
              <span className="inline-flex items-center gap-1 animate-in fade-in duration-150">
                <input autoFocus value={linkDraft.title} onChange={e => setLinkDraft(p => ({ ...p, title: e.target.value }))} placeholder="이름" className="w-20 text-[10px] md:text-xs px-1.5 py-1 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint" />
                <input value={linkDraft.url} onChange={e => setLinkDraft(p => ({ ...p, url: e.target.value }))} placeholder="https://..." onKeyDown={e => { if (e.key === 'Enter') saveLink(); if (e.key === 'Escape') setIsAddingLink(false); }} className="w-36 text-[10px] md:text-xs px-1.5 py-1 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint" />
                <button onClick={saveLink} disabled={!linkDraft.title.trim() || !linkDraft.url.trim()} className="text-[10px] md:text-xs px-2 py-1 bg-accent hover:bg-accent-strong disabled:bg-line text-white rounded-md transition active:scale-95">추가</button>
                <button onClick={() => setIsAddingLink(false)} className="p-1 text-fg-faint hover:text-fg-muted transition"><X size={12} /></button>
              </span>
            ) : (
              <button onClick={() => setIsAddingLink(true)} className="text-[10px] md:text-xs text-fg-faint hover:text-fg-muted hover:bg-surface-hover px-1.5 py-1 border border-dashed border-line rounded-md transition active:scale-95">+ 추가</button>
            )}
          </div>
        </div>
        <div className="flex bg-surface-2 p-1 rounded-md w-full md:w-auto shrink-0">
          <button onClick={() => setViewMode('kanban')} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex justify-center items-center gap-1.5 whitespace-nowrap ${viewMode === 'kanban' ? 'bg-surface shadow-soft text-fg' : 'text-fg-muted hover:text-fg'}`}><LayoutDashboard size={14} className="shrink-0"/> 보드</button>
          <button onClick={() => setViewMode('calendar')} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex justify-center items-center gap-1.5 whitespace-nowrap ${viewMode === 'calendar' ? 'bg-surface shadow-soft text-fg' : 'text-fg-muted hover:text-fg'}`}><CalendarIcon size={14} className="shrink-0"/> 캘린더</button>
        </div>
      </div>
      {viewMode === 'kanban' && (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-3 shrink-0">
          <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1 w-full scrollbar-hide">
            <span className="text-xs font-medium text-fg-muted flex items-center mr-1 shrink-0">필터:</span>
            {Object.entries(CONFIG.TEAMS).map(([team, colorClass]) => {
              const selected = selectedTeams.includes(team);
              return (
                <button key={team} onClick={() => toggleTeam(team)} className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold border whitespace-nowrap transition-all active:scale-95 ${selected ? colorClass + ' border-transparent shadow-soft' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
                  {selected && <Check size={10} className="shrink-0" />}{team}
                </button>
              );
            })}
          </div>
          <button onClick={onNewTask} className="w-full md:w-auto shrink-0 bg-accent hover:bg-accent-strong text-white pl-3 pr-4 py-1.5 rounded-full text-xs font-medium shadow-soft transition active:scale-95 flex justify-center items-center gap-1.5 whitespace-nowrap"><Plus size={14} className="shrink-0" /> 새 작업</button>
        </div>
      )}
      <div className="flex-1 min-h-0">
        {viewMode === 'kanban' ? <Board tasks={filteredTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} /> : <CalendarBoard tasks={projectTasks} onTaskClick={onTaskClick} />}
      </div>
    </div>
  );
}

export function MyTasksView({ onTaskClick, onStatusChange }) {
  const currentUser = useStore(selectCurrentUser);
  const myTasks = useStore(selectMyTasks);
  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col animate-in fade-in">
      <div className="mb-4 shrink-0"><h2 className="text-xl font-bold text-fg tracking-[-0.25px]">👋 {currentUser.name}님의 작업</h2><p className="text-xs text-fg-muted mt-1">할당된 모든 프로젝트의 업무가 이곳에 모입니다.</p></div>
      <div className="flex-1 min-h-0"><Board tasks={myTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} showProjectBadge /></div>
    </div>
  );
}

export function TeamView({ teamName, onTaskClick, onStatusChange }) {
  const tasksList = useStore(selectTasksList);
  const teamTasks = useMemo(() => tasksList.filter(t => t.teams.includes(teamName)), [tasksList, teamName]);
  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col animate-in fade-in">
      <div className="mb-4 shrink-0 flex items-center gap-3"><h2 className="text-xl font-bold text-fg tracking-[-0.25px]">{teamName} 보드</h2><span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold ${CONFIG.TEAMS[teamName]}`}>TEAM</span></div>
      <div className="flex-1 min-h-0"><Board tasks={teamTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} showProjectBadge /></div>
    </div>
  );
}

export function GuideView() {
  return (
    <div className="max-w-3xl mx-auto bg-surface p-6 md:p-10 rounded-lg border border-line animate-in fade-in">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2 tracking-[-0.25px]"><LayoutDashboard className="text-accent"/> 사용 가이드</h1>
      <div className="space-y-6 text-sm text-fg-muted leading-relaxed">
        <section>
          <h2 className="font-bold text-lg mb-2 text-fg border-b border-line pb-2 tracking-[-0.25px]">1. 단일 파일 & 엔터프라이즈 아키텍처</h2>
          <p>이 어플리케이션은 물리적으로 단 하나의 파일(`.jsx`)로 이루어져 있지만, 내부적으로는 <strong>Redux/Zustand 수준의 상태 관리(Store), O(1) 캐싱(Selectors), 낙관적 업데이트, Undo/Redo 기능</strong>을 순수 React만으로 100% 구현한 최적화의 결정체입니다.</p>
        </section>
        <section>
          <h2 className="font-bold text-lg mb-2 text-fg border-b border-line pb-2 tracking-[-0.25px]">2. 상태 롤백 (Undo / Redo) 기능</h2>
          <p>상단 헤더 좌측에 있는 <Undo2 className="inline w-4 h-4 text-fg-muted mx-1"/> 버튼을 눌러보세요! 칸반 보드에서 카드를 옮기거나 내용을 잘못 수정한 경우, 언제든 이전 상태로 즉시 되돌릴 수 있습니다. Command 패턴과 Memento 패턴이 결합된 강력한 기능입니다.</p>
        </section>
        <section>
          <h2 className="font-bold text-lg mb-2 text-fg border-b border-line pb-2 tracking-[-0.25px]">3. 빠른 성능 (O(1) 캐싱)</h2>
          <p>수천 개의 Task가 쌓여도 달력(캘린더 뷰)이나 대시보드를 렌더링할 때 버벅이지 않습니다. 백그라운드에서 모든 데이터가 <strong>Map 구조로 정규화(Normalization)</strong>되어 있어 최적의 속도를 보장합니다.</p>
        </section>
      </div>
    </div>
  );
}
