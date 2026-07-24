import React, { useState } from 'react';
import {
  LayoutDashboard, CheckSquare, Search, Plus, X, Hash, Menu,
  Settings, RefreshCw, Undo2, Redo2, Sun, Moon, LogOut
} from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsList, selectProjectsMap, selectMyTasks
} from '../store/selectors.js';
import { useAuth } from '../services/auth.jsx';
import { avatarColor } from '../utils.js';
import logoLight from '../assets/logo-light.png';
import logoDark from '../assets/logo-dark.png';

// 라이트/다크 수동 전환 (기본값은 시스템 설정, 선택은 localStorage에 기억)
function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.setAttribute('data-seed-user-color-scheme', next);
    localStorage.setItem('theme', next);
    setTheme(next);
  };
  return (
    <button onClick={toggle} className="group p-2 rounded-md hover:bg-surface-hover text-fg-muted transition active:scale-95" title={theme === 'dark' ? '라이트 모드' : '다크 모드'}>
      {theme === 'dark'
        ? <Sun size={18} strokeWidth={1.75} className="transition-transform duration-300 group-hover:rotate-12" />
        : <Moon size={18} strokeWidth={1.75} className="transition-transform duration-300 group-hover:rotate-12" />}
    </button>
  );
}

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================
export const Sidebar = React.memo(({ activeMenu, setActiveMenu, isSidebarOpen, closeSidebar, onOpenProfile, onOpenProject }) => {
  const currentUser = useStore(selectCurrentUser);
  const projectsList = useStore(selectProjectsList);
  const myTasksCount = useStore(selectMyTasks).filter(t => t.status !== '완료').length;

  return (
    <div className={`fixed md:static inset-y-0 left-0 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-300 ease-in-out w-64 bg-surface-2 border-r border-line flex flex-col shadow-xl md:shadow-none z-30`}>
      {/* h-14: 헤더와 하단 라인 정렬 */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-line shrink-0">
        <button onClick={() => setActiveMenu('dashboard')} className="flex items-center gap-2 min-w-0 transition active:scale-95" title="홈(대시보드)으로">
          <img src={logoLight} alt="The 다붓" className="h-8 w-auto dark:hidden" />
          <img src={logoDark} alt="The 다붓" className="h-8 w-auto hidden dark:block" />
        </button>
        <button className="md:hidden p-1 text-fg-muted transition active:scale-95" onClick={closeSidebar}><X size={20} /></button>
      </div>
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1 scrollbar-hide">
        <NavItem icon={<LayoutDashboard size={15} strokeWidth={1.75} />} tile="bg-tag-blue text-tag-blue-fg" label="전체 대시보드" active={activeMenu === 'dashboard'} onClick={() => setActiveMenu('dashboard')} />
        <NavItem icon={<CheckSquare size={15} strokeWidth={1.75} />} tile="bg-tag-green text-tag-green-fg" label="내 작업" active={activeMenu === 'myTasks'} onClick={() => setActiveMenu('myTasks')} badge={myTasksCount} />
        <div className="mt-6 mb-2 px-2 text-[10px] font-bold text-fg-faint uppercase tracking-wider flex justify-between items-center">
          프로젝트 리스트 <Plus size={14} className="cursor-pointer hover:text-fg p-0.5 rounded hover:bg-surface-hover transition active:scale-95" onClick={onOpenProject} />
        </div>
        {projectsList.map(p => <NavItem key={p.id} icon={<Hash size={15} strokeWidth={1.75} />} tile="bg-tag-purple text-tag-purple-fg" label={p.title} active={activeMenu === p.id} onClick={() => setActiveMenu(p.id)} />)}
        {projectsList.length === 0 && <p className="px-2 pt-1 text-[10px] text-fg-faint leading-relaxed">위 <span className="font-semibold">+</span> 버튼으로 첫 프로젝트를 만들어보세요.</p>}
      </div>
      <SidebarProfile currentUser={currentUser} onOpenProfile={onOpenProfile} />
    </div>
  );
});

function SidebarProfile({ currentUser, onOpenProfile }) {
  const { enabled, session, signOut } = useAuth();
  return (
    <div className="p-4 border-t border-line flex items-center gap-3 hover:bg-surface-hover transition-colors group">
      <div onClick={onOpenProfile} className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold shrink-0 transition-colors ${avatarColor(currentUser.name)}`}>{currentUser.name[0]}</div>
        <div className="flex-1 min-w-0"><p className="text-sm font-medium text-fg truncate">{currentUser.name}</p><p className="text-xs text-fg-muted truncate">{currentUser.team}</p></div>
        <Settings size={14} className="text-fg-faint group-hover:text-fg-muted shrink-0" />
      </div>
      {enabled && session && (
        <button onClick={signOut} className="p-1.5 rounded-md hover:bg-line text-fg-faint hover:text-fg-muted transition active:scale-95 shrink-0" title="로그아웃"><LogOut size={14} /></button>
      )}
    </div>
  );
}

const NavItem = React.memo(({ icon, label, active, onClick, badge, tile }) => (
  <button onClick={onClick} className={`group w-full flex items-center justify-between px-2.5 py-2 rounded-md text-sm transition-colors transition active:scale-95 ${active ? 'bg-surface-hover text-fg font-medium' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'}`}>
    <div className="flex items-center gap-2.5 truncate min-w-0">
      <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${tile || ''} ${active ? 'shadow-soft' : ''}`}>{icon}</span>
      <span className="truncate">{label}</span>
    </div>
    {badge > 0 && <span className="bg-surface-hover text-accent-text py-0.5 px-2 rounded-full text-[10px] font-bold shrink-0">{badge}</span>}
  </button>
));

export const Header = React.memo(({ activeMenu, openSidebar, onOpenSync, undo, redo, canUndo, canRedo, cloudMode }) => {
  const projectsMap = useStore(selectProjectsMap);
  let title = '워크스페이스';
  if (activeMenu === 'dashboard') title = '전체 대시보드';
  else if (activeMenu === 'myTasks') title = '내 작업';
  else if (activeMenu === 'guide') title = '사용 가이드';
  else if (activeMenu.startsWith('team:')) title = `${activeMenu.split(':')[1]} 보드`;
  else if (projectsMap[activeMenu]) title = projectsMap[activeMenu].title;

  return (
    <header className="h-14 bg-surface border-b border-line flex items-center px-4 md:px-6 shrink-0 gap-2 md:gap-4 z-10">
      <div className="flex items-center gap-3 min-w-0 shrink">
        <button className="md:hidden p-1 text-fg-muted hover:bg-surface-hover rounded-md transition active:scale-95" onClick={openSidebar}><Menu size={20} strokeWidth={1.75} /></button>
        <h2 className="font-semibold text-base md:text-lg text-fg truncate tracking-[-0.25px]">{title}</h2>
      </div>
      <div className="flex items-center gap-1 md:gap-3 flex-1 justify-end min-w-0">
        {/* Undo / Redo — 클라우드 모드에선 다른 사람과 상태가 어긋나므로 숨김 */}
        {!cloudMode && (
          <div className="flex items-center bg-surface-2 rounded-md p-0.5 shrink-0">
            <button onClick={undo} disabled={!canUndo} className={`p-1.5 rounded text-fg-muted transition active:scale-95 ${canUndo ? 'hover:bg-surface hover:shadow-soft' : 'opacity-30 cursor-not-allowed'}`} title="실행 취소 (Ctrl+Z)"><Undo2 size={16} strokeWidth={1.75}/></button>
            <button onClick={redo} disabled={!canRedo} className={`p-1.5 rounded text-fg-muted transition active:scale-95 ${canRedo ? 'hover:bg-surface hover:shadow-soft' : 'opacity-30 cursor-not-allowed'}`} title="다시 실행"><Redo2 size={16} strokeWidth={1.75}/></button>
          </div>
        )}
        <div className="relative hidden sm:block flex-1 max-w-2xl">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-fg-faint" strokeWidth={1.75} />
          <input type="text" placeholder="검색..." className="pl-9 pr-4 py-1.5 text-sm bg-surface border border-line rounded-xs focus:border-accent focus:ring-2 focus:ring-accent-weak focus:shadow-soft outline-none w-full transition-all" />
        </div>
        <ThemeToggle />
        <button onClick={onOpenSync} className="group p-2 rounded-md hover:bg-surface-hover text-fg-muted transition active:scale-95 shrink-0" title="데이터 연동"><RefreshCw size={18} strokeWidth={1.75} className="transition-transform duration-300 group-hover:rotate-90" /></button>
      </div>
    </header>
  );
});
