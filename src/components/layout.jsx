import React from 'react';
import {
  LayoutDashboard, CheckSquare, Search, Plus, X, Hash, Menu,
  Settings, Database, Undo2, Redo2
} from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsList, selectProjectsMap, selectMyTasks
} from '../store/selectors.js';

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================
export const Sidebar = React.memo(({ activeMenu, setActiveMenu, isSidebarOpen, closeSidebar, onOpenProfile, onOpenProject }) => {
  const currentUser = useStore(selectCurrentUser);
  const projectsList = useStore(selectProjectsList);
  const myTasksCount = useStore(selectMyTasks).filter(t => t.status !== '완료').length;

  return (
    <div className={`fixed md:static inset-y-0 left-0 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-300 ease-in-out w-64 bg-white border-r border-gray-200 flex flex-col shadow-xl md:shadow-sm z-30`}>
      <div className="p-4 flex items-center justify-between border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-sm shrink-0">C</div>
          <h1 className="font-bold text-base tracking-tight truncate text-gray-800">청년부 워크스페이스</h1>
        </div>
        <button className="md:hidden p-1 text-gray-500" onClick={closeSidebar}><X size={20} /></button>
      </div>
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1 scrollbar-hide">
        <NavItem icon={<LayoutDashboard size={18} />} label="전체 대시보드" active={activeMenu === 'dashboard'} onClick={() => setActiveMenu('dashboard')} />
        <NavItem icon={<CheckSquare size={18} />} label="내 작업" active={activeMenu === 'myTasks'} onClick={() => setActiveMenu('myTasks')} badge={myTasksCount} />
        <div className="mt-6 mb-2 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider flex justify-between items-center">
          프로젝트 리스트 <Plus size={14} className="cursor-pointer hover:text-gray-800 p-0.5 rounded hover:bg-gray-100" onClick={onOpenProject} />
        </div>
        {projectsList.map(p => <NavItem key={p.id} icon={<Hash size={16} className="text-gray-400"/>} label={p.title} active={activeMenu === p.id} onClick={() => setActiveMenu(p.id)} />)}
      </div>
      <div onClick={onOpenProfile} className="p-4 border-t border-gray-200 flex items-center gap-3 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors group">
        <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold shrink-0 group-hover:bg-indigo-200 transition-colors">{currentUser.name[0]}</div>
        <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-900 truncate">{currentUser.name}</p><p className="text-xs text-gray-500 truncate">{currentUser.team}</p></div>
        <Settings size={14} className="text-gray-400 group-hover:text-gray-600" />
      </div>
    </div>
  );
});

const NavItem = React.memo(({ icon, label, active, onClick, badge }) => (
  <button onClick={onClick} className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
    <div className="flex items-center gap-2 truncate">{icon}<span className="truncate">{label}</span></div>
    {badge > 0 && <span className="bg-gray-200 text-gray-700 py-0.5 px-2 rounded-full text-[10px] font-bold">{badge}</span>}
  </button>
));

export const Header = React.memo(({ activeMenu, openSidebar, onOpenSync, undo, redo, canUndo, canRedo }) => {
  const projectsMap = useStore(selectProjectsMap);
  let title = '워크스페이스';
  if (activeMenu === 'dashboard') title = '전체 대시보드';
  else if (activeMenu === 'myTasks') title = '내 작업';
  else if (activeMenu === 'guide') title = '사용 가이드';
  else if (activeMenu.startsWith('team:')) title = `${activeMenu.split(':')[1]} 보드`;
  else if (projectsMap[activeMenu]) title = projectsMap[activeMenu].title;

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 shrink-0 gap-2 shadow-sm z-10">
      <div className="flex items-center gap-3 min-w-0">
        <button className="md:hidden p-1 text-gray-600 hover:bg-gray-100 rounded-md" onClick={openSidebar}><Menu size={20} /></button>
        <h2 className="font-semibold text-base md:text-lg text-gray-800 truncate">{title}</h2>
      </div>
      <div className="flex items-center gap-1 md:gap-3">
        {/* Undo / Redo Controllers */}
        <div className="flex items-center bg-gray-100 rounded-md p-0.5 mr-2">
          <button onClick={undo} disabled={!canUndo} className={`p-1.5 rounded text-gray-600 transition-colors ${canUndo ? 'hover:bg-white hover:shadow-sm' : 'opacity-30 cursor-not-allowed'}`} title="실행 취소 (Ctrl+Z)"><Undo2 size={16}/></button>
          <button onClick={redo} disabled={!canRedo} className={`p-1.5 rounded text-gray-600 transition-colors ${canRedo ? 'hover:bg-white hover:shadow-sm' : 'opacity-30 cursor-not-allowed'}`} title="다시 실행"><Redo2 size={16}/></button>
        </div>
        <div className="relative hidden sm:block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="검색..." className="pl-9 pr-4 py-1.5 text-sm bg-gray-100 border-transparent rounded-md focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none w-48 transition-all" />
        </div>
        <button onClick={onOpenSync} className="p-2 rounded-full hover:bg-gray-100 text-gray-600 transition-colors"><Database size={18} /></button>
      </div>
    </header>
  );
});
