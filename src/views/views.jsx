import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  LayoutDashboard, Plus, Calendar as CalendarIcon,
  ExternalLink, ChevronRight, Check, X, Trash2, CheckSquare
} from 'lucide-react';
import { CONFIG } from '../config.js';
import { generateId } from '../utils.js';
import { store, useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsMap, selectMyTasks,
  selectDashboardStats, selectTasksList
} from '../store/selectors.js';
import { Board, CalendarBoard } from '../components/boards.jsx';
import { useAuth } from '../services/auth.jsx';
import * as cloudSync from '../services/cloudSync.js';
import { ShareButton } from '../components/ShareButton.jsx';
import { ConfirmPopover, useAnchoredPos } from '../components/ConfirmPopover.jsx';
import { showToast } from '../components/Toast.jsx';

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================
export const DashboardView = React.memo(function DashboardView({ onNavigate }) {
  const { progress, teamStats } = useStore(selectDashboardStats);
  const myTasksCount = useStore(selectMyTasks).filter(t => t.status !== '완료').length;
  const currentUser = useStore(selectCurrentUser);
  const tasksList = useStore(selectTasksList);
  const myTeamTasks = useMemo(
    () => tasksList.filter(t => (t.teams || []).includes(currentUser.team) && t.status !== '완료'),
    [tasksList, currentUser.team]
  );

  return (
    // 보드와 같은 규칙 — 상자·그림자·아이콘 타일 없이 숫자와 구분선으로만
    <div className="max-w-6xl mx-auto pb-8 md:pb-10 animate-in fade-in duration-300">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 sm:gap-8 border-b border-line pb-5 mb-6">
        <div className="py-3 sm:py-0 border-b border-line sm:border-0">
          <h3 className="text-fg-muted text-xs font-semibold mb-1.5">전체 프로젝트 진척도</h3>
          <div className="flex items-end gap-1.5"><span className="text-3xl md:text-4xl font-extrabold text-fg tracking-[-1.5px]">{progress}%</span><span className="text-fg-faint text-xs mb-1.5">완료</span></div>
          <div className="w-full max-w-[220px] bg-line/70 rounded-full h-1 mt-3"><div className="bg-fg h-1 rounded-full transition-all duration-1000" style={{ width: `${progress}%` }}></div></div>
        </div>
        <button onClick={() => onNavigate('myTasks')} className="py-3 sm:py-0 border-b border-line sm:border-0 text-left group">
          <h3 className="text-fg-muted text-xs font-semibold mb-1.5 group-hover:text-fg transition-colors">내 남은 업무</h3>
          <div className="text-3xl md:text-4xl font-extrabold text-fg tracking-[-1.5px]">{myTasksCount}개</div>
          <p className="text-xs text-fg-faint mt-3 flex items-center gap-0.5">오늘도 화이팅입니다!<ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity"/></p>
        </button>
        <button onClick={() => onNavigate(`team:${currentUser.team}`)} className="py-3 sm:py-0 text-left group">
          <h3 className="text-fg-muted text-xs font-semibold mb-1.5 flex items-center gap-1.5 group-hover:text-fg transition-colors">
            내 팀 업무 <span className={`font-bold ${CONFIG.TEAM_FG[currentUser.team] || 'text-fg-muted'}`}>{currentUser.team}</span>
          </h3>
          <div className="text-3xl md:text-4xl font-extrabold text-fg tracking-[-1.5px]">{myTeamTasks.length}개</div>
          <p className="text-xs text-fg-faint mt-3 truncate">
            {myTeamTasks.length > 0 ? `${myTeamTasks[0].title}${myTeamTasks.length > 1 ? ` 외 ${myTeamTasks.length - 1}건` : ''}` : '남은 팀 업무가 없어요. 수고했어요!'}
          </p>
        </button>
      </div>
      <div>
        <h3 className="font-bold text-xs text-fg-muted mb-1.5 pb-2 border-b border-line">팀별 업무 현황</h3>
        <div>
          {teamStats.map(stat => (
            <div key={stat.name} onClick={() => onNavigate(`team:${stat.name}`)} className="flex items-center gap-3 py-3 border-b border-line hover:bg-fg/[0.02] cursor-pointer transition-colors group">
              <span className={`text-[11px] font-bold tracking-[0.03em] shrink-0 w-16 ${CONFIG.TEAM_FG[stat.name] || 'text-fg-muted'}`}>{stat.name}</span>
              <div className="hidden sm:flex flex-1 min-w-0 flex-wrap items-center gap-2">
                {stat.projects.length > 0 ? (
                  <>
                    {stat.projects.slice(0, 2).map((p, i) => <span key={i} className="text-[11px] text-fg-muted truncate max-w-[200px]">{p}</span>)}
                    {stat.projects.length > 2 && (
                      <span className="relative group/more" onClick={e => e.stopPropagation()}>
                        <span className="text-[11px] text-fg-faint cursor-default hover:text-fg-muted transition-colors">+{stat.projects.length - 2}</span>
                        <div className="absolute left-0 top-full mt-1 z-40 hidden group-hover/more:block bg-surface border border-line rounded-md shadow-elevated p-2 w-max max-w-[240px] animate-in fade-in duration-150">
                          {stat.projects.slice(2).map((p, i) => <div key={i} className="text-[11px] text-fg-muted truncate">{p}</div>)}
                        </div>
                      </span>
                    )}
                  </>
                ) : <span className="text-[11px] text-fg-faint">진행 중인 프로젝트 없음</span>}
              </div>
              <div className="flex items-center gap-3 ml-auto shrink-0">
                <div className="w-24 md:w-32 bg-line/70 rounded-full h-1 overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${stat.progress >= 100 ? 'bg-tag-green-fg' : 'bg-fg-muted'}`} style={{ width: `${stat.progress}%` }}></div></div>
                <span className="text-[11px] text-fg-muted text-right w-20 tabular-nums">{stat.done} / {stat.total} 완료</span>
                <ChevronRight size={15} className="text-fg-faint opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// 아이콘 좌우에 투명 여백(약 2.4px)이 있어서 pl-3/pr-4로는 왼쪽이 2px 좁아 보였다.
// 실측 기준으로 시각적 여백을 맞춘다(왼 14+2.4 ≒ 오른 16).
// 흰 글자 옆 13px 아이콘은 1.4획이면 사라져 보여서 여기만 2로 되돌린다.
function NewTaskButton({ onClick, className = '' }) {
  return (
    // display 유틸(inline-flex/hidden)은 호출부가 지정한다 — 여기서 같이 주면
    // Tailwind가 같은 계층의 display 규칙끼리 충돌해 md:hidden이 안 먹는다
    <button onClick={onClick} className={`shrink-0 bg-fg hover:opacity-90 text-canvas pl-3 pr-3.5 py-2 rounded-xs text-xs font-bold transition active:scale-95 justify-center items-center gap-1.5 leading-none whitespace-nowrap ${className}`}>
      <Plus size={13} className="shrink-0 [stroke-width:2px]" /><span className="leading-none">새 업무</span>
    </button>
  );
}

export const ProjectView = React.memo(function ProjectView({ projectId, onTaskClick, onStatusChange, onNewTask, onNavigate }) {
  const projectsMap = useStore(selectProjectsMap);
  const tasksList = useStore(selectTasksList);
  const { isAdmin, enabled, session } = useAuth();
  const cloudOn = enabled && !!session;
  // 특정 프로젝트의 Task만 필터링 (해당 View 내부에서만 필요한 연산)
  const projectTasks = useMemo(() => tasksList.filter(t => t.projectId === projectId), [tasksList, projectId]);
  const project = projectsMap[projectId];

  const [viewMode, setViewMode] = useState('kanban');
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState({ title: '', url: '' });
  const linkPopRef = useRef(null);
  const linkBtnRef = useRef(null);
  const [linkPos, placeLink] = useAnchoredPos(linkBtnRef, isAddingLink, 256, 150);

  // 리소스 추가 팝오버: 바깥 클릭 / Escape 닫기
  useEffect(() => {
    if (!isAddingLink) return;
    const onDown = (e) => { if (linkPopRef.current && !linkPopRef.current.contains(e.target)) setIsAddingLink(false); };
    const onKey = (e) => { if (e.key === 'Escape') setIsAddingLink(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [isAddingLink]);

  const toggleTeam = (team) => setSelectedTeams(prev => prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team]);
  const filteredTasks = useMemo(() => selectedTeams.length === 0 ? projectTasks : projectTasks.filter(task => task.teams.some(t => selectedTeams.includes(t))), [projectTasks, selectedTeams]);

  if (!project) return null;

  const cloudErr = (label) => (err) => { console.error(`[cloud] ${label} 실패:`, err); showToast(`저장에 실패했어요 (${label}) · ${cloudSync.formatCloudError(err)}`); };

  const saveLink = () => {
    if (!linkDraft.title.trim() || !linkDraft.url.trim()) return;
    const url = /^https?:\/\//.test(linkDraft.url) ? linkDraft.url : `https://${linkDraft.url}`;
    const newLink = { id: generateId(), title: linkDraft.title.trim(), url };
    store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: project.id, pinnedLinks: [...(project.pinnedLinks || []), newLink] } });
    if (cloudOn) cloudSync.linkAddCloud(project.id, newLink).catch(cloudErr('리소스 추가'));
    setLinkDraft({ title: '', url: '' });
    setIsAddingLink(false);
  };
  const removeLink = (linkId) => {
    store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: project.id, pinnedLinks: (project.pinnedLinks || []).filter(l => l.id !== linkId) } });
    if (cloudOn) cloudSync.linkRemoveCloud(linkId).catch(cloudErr('리소스 삭제'));
  };

  const deleteProject = () => {
    store.dispatch({ type: 'DELETE_PROJECT', payload: project.id });
    if (cloudOn) cloudSync.projectDeleteCloud(project.id).catch(cloudErr('프로젝트 삭제'));
    onNavigate?.('dashboard');
  };

  return (
    <div className="h-full flex flex-col min-w-0 animate-in fade-in">
      {/* 흰 카드로 감싸지 않는다 — 제목은 페이지의 제목이지 카드의 내용이 아니다.
          모바일은 상단바에 이미 프로젝트 이름이 있어 제목을 반복하지 않는다. */}
      <div className="pb-2.5 mb-3.5 flex flex-col md:flex-row gap-2.5 md:gap-4 justify-between items-start md:items-center shrink-0">
        <div className="w-full md:w-auto min-w-0">
          <h2 className="hidden md:block text-2xl font-extrabold text-fg mb-1.5 tracking-[-0.7px]">{project.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-fg-faint shrink-0">리소스</span>
            {project.pinnedLinks?.map(link => (
              <span key={link.id} className="group/link inline-flex items-center gap-1 text-[10px] md:text-xs pl-1.5 pr-1 py-1 bg-accent-weak text-accent-text rounded-md transition-colors">
                <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><ExternalLink size={10} /> {link.title}</a>
                <button onClick={() => removeLink(link.id)} className="opacity-0 group-hover/link:opacity-100 hover:text-fg rounded-full p-0.5 transition-opacity" title="링크 삭제"><X size={10} /></button>
              </span>
            ))}
            <div className="inline-flex" ref={linkPopRef}>
              <span ref={linkBtnRef} className="inline-flex">
                {/* 열기 전에 위치를 먼저 잡는다 — 안 그러면 첫 프레임이 {0,0}에
                    그려져서 팝오버가 화면 좌상단에서 날아오는 것처럼 보인다 */}
                <button onClick={() => { placeLink(); setIsAddingLink(v => !v); }} className="text-[10px] md:text-xs text-fg-faint hover:text-fg-muted hover:bg-surface-hover px-1.5 py-1 border border-dashed border-line rounded-md transition active:scale-95">+ 추가</button>
              </span>
              {isAddingLink && (
                <div style={{ position: 'fixed', left: linkPos.left, top: linkPos.top, width: 256 }} className="bg-surface border border-line rounded-lg shadow-elevated p-3 z-[90] animate-in fade-in zoom-in-95 duration-150">
                  <div className="space-y-2">
                    <input autoFocus value={linkDraft.title} onChange={e => setLinkDraft(p => ({ ...p, title: e.target.value }))} placeholder="이름" className="w-full text-xs px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint" />
                    <input value={linkDraft.url} onChange={e => setLinkDraft(p => ({ ...p, url: e.target.value }))} placeholder="https://..." onKeyDown={e => { if (e.key === 'Enter') saveLink(); }} className="w-full text-xs px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint" />
                  </div>
                  <div className="flex justify-end gap-2 mt-3">
                    <button onClick={() => setIsAddingLink(false)} className="text-xs px-2.5 py-1 text-fg-muted hover:bg-surface-hover rounded-md transition active:scale-95">취소</button>
                    <button onClick={saveLink} disabled={!linkDraft.title.trim() || !linkDraft.url.trim()} className="text-xs px-2.5 py-1 bg-accent hover:bg-accent-strong disabled:bg-line text-white rounded-md transition active:scale-95">추가</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* 모바일은 이 한 줄에 액션을 다 몰아넣는다 — 보기 전환/공유/삭제/새 업무를
            각자 한 줄씩 차지하면 정작 업무 목록이 화면 밖으로 밀린다 */}
        <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
          {/* 아이콘은 라벨을 거들 뿐 — 13px로 줄이고 톤을 낮춰 글자가 먼저 읽히게 */}
          <div className="flex bg-surface-hover/70 p-0.5 rounded-sm shrink-0">
            <button onClick={() => setViewMode('kanban')} className={`px-2.5 md:px-3 py-1.5 text-xs font-semibold rounded-xs transition-colors flex justify-center items-center gap-1.5 whitespace-nowrap ${viewMode === 'kanban' ? 'bg-surface text-fg' : 'text-fg-muted hover:text-fg'}`}><LayoutDashboard size={13} className="shrink-0 opacity-55"/> 보드</button>
            <button onClick={() => setViewMode('calendar')} className={`px-2.5 md:px-3 py-1.5 text-xs font-semibold rounded-xs transition-colors flex justify-center items-center gap-1.5 whitespace-nowrap ${viewMode === 'calendar' ? 'bg-surface text-fg' : 'text-fg-muted hover:text-fg'}`}><CalendarIcon size={13} className="shrink-0 opacity-55"/> 캘린더</button>
          </div>
          <span className="flex-1 md:hidden" />
          <ShareButton url={`${window.location.origin}/s/p/${project.id}`} what="프로젝트" />
          {isAdmin && (
            <ConfirmPopover message="프로젝트와 안의 모든 업무가 삭제돼요. 되돌릴 수 없어요." onConfirm={deleteProject}>
              <button type="button" className="p-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition active:scale-95 shrink-0" title="프로젝트 삭제"><Trash2 size={16} /></button>
            </ConfirmPopover>
          )}
          {viewMode === 'kanban' && <NewTaskButton onClick={onNewTask} className="inline-flex md:hidden" />}
        </div>
      </div>
      {viewMode === 'kanban' && (
        <div className="flex flex-row justify-between items-center gap-3 mb-3 shrink-0">
          <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1 min-w-0 flex-1 scrollbar-hide">
            <span className="text-[11px] font-medium text-fg-faint mr-1 shrink-0">필터</span>
            {Object.entries(CONFIG.TEAMS).map(([team, colorClass]) => {
              const selected = selectedTeams.includes(team);
              return (
                <button key={team} onClick={() => toggleTeam(team)} className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-xs text-[11px] font-semibold border whitespace-nowrap transition-all active:scale-95 ${selected ? colorClass + ' border-transparent' : 'bg-surface/70 text-fg-muted border-line hover:bg-surface'}`}>
                  {selected && <Check size={11} className="shrink-0" />}{team}
                </button>
              );
            })}
          </div>
          <NewTaskButton onClick={onNewTask} className="hidden md:inline-flex" />
        </div>
      )}
      <div className="flex-1 min-h-0">
        {viewMode === 'kanban' ? <Board tasks={filteredTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} /> : <CalendarBoard tasks={projectTasks} onTaskClick={onTaskClick} />}
      </div>
    </div>
  );
});

export const MyTasksView = React.memo(function MyTasksView({ onTaskClick, onStatusChange }) {
  const currentUser = useStore(selectCurrentUser);
  const myTasks = useStore(selectMyTasks);
  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col animate-in fade-in">
      {/* 모바일은 상단바에 같은 제목이 있으니 여기서는 숨긴다 */}
      <div className="mb-4 shrink-0 hidden md:block">
        {/* 아이콘은 ✨(AI 상징) 대신 뜻이 맞는 체크박스로. 눈에 띄는 역할은 분홍 타일이 한다 */}
        <h2 className="text-2xl font-extrabold text-fg tracking-[-0.7px] flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-md bg-tag-pink text-tag-pink-fg flex items-center justify-center shrink-0"><CheckSquare size={17} /></span>
          {currentUser.name}님의 업무
        </h2>
        <p className="text-xs text-fg-muted mt-1.5">할당된 모든 프로젝트의 업무가 이곳에 모입니다.</p>
      </div>
      <div className="flex-1 min-h-0"><Board tasks={myTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} showProjectBadge /></div>
    </div>
  );
});

export const TeamView = React.memo(function TeamView({ teamName, onTaskClick, onStatusChange }) {
  const tasksList = useStore(selectTasksList);
  const teamTasks = useMemo(() => tasksList.filter(t => t.teams.includes(teamName)), [tasksList, teamName]);
  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col animate-in fade-in">
      <div className="mb-4 shrink-0 hidden md:flex items-baseline gap-2.5"><h2 className="text-2xl font-extrabold text-fg tracking-[-0.7px]">{teamName}</h2><span className={`text-[11px] font-bold tracking-[0.03em] ${CONFIG.TEAM_FG[teamName] || 'text-fg-muted'}`}>팀 보드</span></div>
      <div className="flex-1 min-h-0"><Board tasks={teamTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} showProjectBadge /></div>
    </div>
  );
});
