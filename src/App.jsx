import React, { useState, useCallback, useEffect } from 'react';
import { store } from './store/workspaceStore.js';
import { useWorkspaceController, usePersistenceController } from './hooks/controllers.js';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { Sidebar, Header } from './components/layout.jsx';
import { DashboardView, ProjectView, MyTasksView, TeamView, GuideView } from './views/views.jsx';
import { TaskModalShell, ProfileModal, SyncModal, ProjectModal } from './modals/modals.jsx';
import { AuthProvider, useAuth } from './services/auth.jsx';
import { LoginScreen } from './components/LoginScreen.jsx';

// ============================================================================
// 10. Shell & Layout (프레젠테이션 최상위 계층)
// ============================================================================
export default function ChurchApp() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ErrorBoundary>
  );
}

// Supabase 설정 시에만 로그인 요구, 미설정이면 게스트 모드
function AuthGate() {
  const { enabled, session, loading } = useAuth();
  if (loading) return <div className="h-screen bg-canvas" />;
  if (enabled && !session) return <LoginScreen />;
  return <WorkspaceShell />;
}

function WorkspaceShell() {
  const controller = useWorkspaceController();
  const persistence = usePersistenceController();
  const { enabled: authEnabled, session } = useAuth();
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [modalState, setModalState] = useState({ isOpen: false, task: null, isEditMode: false });
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  // 첫 로그인 온보딩: 표시 이름·소속 팀을 설정하도록 프로필 창을 자동으로 연다
  useEffect(() => {
    if (authEnabled && session && !localStorage.getItem('daboot_profile_done')) setIsProfileModalOpen(true);
  }, [authEnabled, session]);

  // 리렌더링 감지용 (개발자도구로 확인해보면 해당 뷰만 리렌더링됨을 알 수 있습니다)
  // console.log("WorkspaceShell Renders");

  const openTaskModal = useCallback((task, isEditMode = false) => {
    setModalState({ isOpen: true, task, isEditMode });
  }, []);

  return (
    <div className="flex h-screen bg-canvas text-fg font-sans overflow-hidden">
      {isSidebarOpen && <div className="md:hidden fixed inset-0 bg-black/50 z-20" onClick={() => setIsSidebarOpen(false)} />}

      <Sidebar
        activeMenu={activeMenu} setActiveMenu={(menu) => { setActiveMenu(menu); setIsSidebarOpen(false); }}
        isSidebarOpen={isSidebarOpen} closeSidebar={() => setIsSidebarOpen(false)}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        onOpenProject={() => setIsProjectModalOpen(true)}
      />

      <div className="flex-1 flex flex-col w-full min-w-0">
        <Header
          activeMenu={activeMenu} openSidebar={() => setIsSidebarOpen(true)} onOpenSync={() => setIsSyncModalOpen(true)}
          undo={controller.undo} redo={controller.redo} canUndo={store.canUndo()} canRedo={store.canRedo()}
        />
        <main className="flex-1 overflow-auto bg-canvas p-4 md:p-6 relative">
          <ErrorBoundary>
            {/* key로 뷰 전환 시 리마운트 → 각 뷰의 등장 애니메이션 재생 */}
            <div key={activeMenu} className="h-full">
            {activeMenu === 'dashboard' && <DashboardView onNavigate={setActiveMenu} />}
            {activeMenu === 'myTasks' && <MyTasksView onTaskClick={(t) => openTaskModal(t)} onStatusChange={(t, status) => controller.handleSaveTask({ ...t, status }, t)} />}
            {activeMenu === 'guide' && <GuideView />}
            {activeMenu.startsWith('team:') && <TeamView teamName={activeMenu.split(':')[1]} onTaskClick={(t) => openTaskModal(t)} onStatusChange={(t, status) => controller.handleSaveTask({ ...t, status }, t)} />}
            {(!['dashboard', 'myTasks', 'guide'].includes(activeMenu) && !activeMenu.startsWith('team:')) && (
               <ProjectView projectId={activeMenu} onNavigate={setActiveMenu} onTaskClick={(t) => openTaskModal(t)} onStatusChange={(t, status) => controller.handleSaveTask({ ...t, status }, t)} onNewTask={() => openTaskModal({ projectId: activeMenu, status: '시작 전', assignees: [], teams: [] }, true)} />
            )}
            </div>
          </ErrorBoundary>
        </main>
      </div>

      {modalState.isOpen && (
        <ErrorBoundary>
          <TaskModalShell
            task={modalState.task} isEditMode={modalState.isEditMode}
            onClose={() => setModalState({ isOpen: false, task: null, isEditMode: false })}
            onEdit={() => setModalState(prev => ({ ...prev, isEditMode: true }))}
            onSave={(newData) => { const saved = controller.handleSaveTask(newData, modalState.task.id ? modalState.task : null); setModalState({ isOpen: true, task: saved, isEditMode: false }); }}
            onAddComment={(text, parentId = null) => { const updated = controller.handleAddComment(modalState.task, text, parentId); setModalState(prev => ({ ...prev, task: updated })); }}
            onUpdateComment={(commentId, newText) => { const updated = controller.handleUpdateComment(modalState.task, commentId, newText); setModalState(prev => ({ ...prev, task: updated })); }}
            onDeleteComment={(commentId) => { const updated = controller.handleDeleteComment(modalState.task, commentId); setModalState(prev => ({ ...prev, task: updated })); }}
          />
        </ErrorBoundary>
      )}

      {isProfileModalOpen && <ProfileModal onClose={() => setIsProfileModalOpen(false)} onSave={(p) => { controller.handleUpdateUser(p); localStorage.setItem('daboot_profile_done', '1'); }} />}
      {isProjectModalOpen && <ProjectModal onClose={() => setIsProjectModalOpen(false)} onSave={(title) => { const newId = controller.handleAddProject(title); setActiveMenu(newId); setIsProjectModalOpen(false); }} />}
      {isSyncModalOpen && <SyncModal onClose={() => setIsSyncModalOpen(false)} persistence={persistence} />}
    </div>
  );
}
