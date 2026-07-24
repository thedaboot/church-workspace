import React, { useState, useCallback, useEffect, useRef } from 'react';
import { store } from './store/workspaceStore.js';
import { useWorkspaceController, usePersistenceController } from './hooks/controllers.js';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { Sidebar, Header } from './components/layout.jsx';
import { DashboardView, ProjectView, MyTasksView, TeamView, GuideView } from './views/views.jsx';
import { TaskModalShell, ProfileModal, SyncModal, ProjectModal } from './modals/modals.jsx';
import { AuthProvider, useAuth } from './services/auth.jsx';
import { LoginScreen } from './components/LoginScreen.jsx';
import * as cloudSync from './services/cloudSync.js';
import logoLight from './assets/logo-light.png';
import logoDark from './assets/logo-dark.png';

// 클라우드 초기 로드 중 미니멀 스플래시 (로고 + 살짝 pulse)
function CloudSplash() {
  return (
    <div className="h-screen bg-canvas flex items-center justify-center">
      <img src={logoLight} alt="더다붓" className="h-12 w-auto animate-pulse dark:hidden" />
      <img src={logoDark} alt="더다붓" className="h-12 w-auto animate-pulse hidden dark:block" />
    </div>
  );
}

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
  const { enabled: authEnabled, session, isAdmin } = useAuth();
  const cloudMode = authEnabled && !!session;
  // 딥링크: /?p=<projectId>&t=<taskId>
  const [activeMenu, setActiveMenu] = useState(() => new URLSearchParams(window.location.search).get('p') || 'dashboard');
  const pendingTaskIdRef = useRef(new URLSearchParams(window.location.search).get('t'));
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [modalState, setModalState] = useState({ isOpen: false, task: null, isEditMode: false });
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [cloudReady, setCloudReady] = useState(!cloudMode);
  const [migrating, setMigrating] = useState(false);

  // 클라우드 상태를 다시 읽어 스토어에 반영
  const reloadCloud = useCallback(async () => {
    const { state, profile } = await cloudSync.loadCloudState();
    store.dispatch({ type: 'LOAD_STATE', payload: state });
    return profile;
  }, []);

  // 초기 클라우드 로드 + 온보딩(프로필 display_name 없으면 프로필 창)
  useEffect(() => {
    if (!cloudMode) { setCloudReady(true); return; }
    let alive = true;
    (async () => {
      try {
        const profile = await reloadCloud();
        if (alive && (!profile || !profile.display_name)) setIsProfileModalOpen(true);
      } catch (e) {
        console.error('[cloud] 초기 로드 실패:', e);
        if (alive) window.alert(`클라우드 데이터를 불러오지 못했어요. 새로고침 해주세요.\n원인: ${cloudSync.formatCloudError(e)}`);
      } finally {
        if (alive) setCloudReady(true);
      }
    })();
    return () => { alive = false; };
  }, [cloudMode, reloadCloud]);

  // 실시간: 변경 감지 → 300ms debounce 재조회
  useEffect(() => {
    if (!cloudMode) return;
    let timer = null;
    const unsub = cloudSync.subscribeAll(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { reloadCloud().catch(e => console.error('[cloud] 재조회 실패:', e)); }, 300);
    });
    return () => { clearTimeout(timer); unsub(); };
  }, [cloudMode, reloadCloud]);

  const openTaskModal = useCallback((task, isEditMode = false) => {
    setModalState({ isOpen: true, task, isEditMode });
  }, []);

  // 딥링크의 taskId → 데이터 준비 후 해당 작업 모달 오픈(존재 검증)
  useEffect(() => {
    const tid = pendingTaskIdRef.current;
    if (!tid) return;
    if (cloudMode && !cloudReady) return; // 클라우드 로드 완료 대기
    const task = store.getState().tasks.byId[tid];
    if (task) { setActiveMenu(task.projectId); openTaskModal(task); }
    pendingTaskIdRef.current = null;
  }, [cloudMode, cloudReady, openTaskModal]);

  // activeMenu/모달 상태 → URL(search params) 동기화 (대시보드/일반 뷰는 파라미터 제거)
  useEffect(() => {
    const params = new URLSearchParams();
    const isProject = !['dashboard', 'myTasks', 'guide'].includes(activeMenu) && !activeMenu.startsWith('team:');
    if (isProject) params.set('p', activeMenu);
    if (modalState.isOpen && modalState.task?.id) {
      if (modalState.task.projectId) params.set('p', modalState.task.projectId);
      params.set('t', modalState.task.id);
    }
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [activeMenu, modalState]);

  // 로컬 → 클라우드 1회 이관
  const handleMigrate = useCallback(async () => {
    try {
      setMigrating(true);
      const raw = localStorage.getItem('church_app_v4');
      if (!raw) { window.alert('가져올 로컬 데이터가 없어요.'); return; }
      await cloudSync.migrateLocalToCloud(JSON.parse(raw));
      await reloadCloud();
      window.alert('이 브라우저의 로컬 데이터를 클라우드로 가져왔어요.');
      setIsSyncModalOpen(false);
    } catch (e) {
      console.error('[cloud] 이관 실패:', e);
      window.alert(`이관 중 오류가 발생했어요.\n원인: ${cloudSync.formatCloudError(e)}`);
    } finally {
      setMigrating(false);
    }
  }, [reloadCloud]);

  if (cloudMode && !cloudReady) return <CloudSplash />;

  return (
    <div className="flex h-screen bg-canvas text-fg font-sans overflow-hidden">
      {/* 배경 파스텔 글로우 (장식 전용 · 상호작용 차단 · 스크롤 고정) */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 -left-32 w-[36rem] h-[36rem] rounded-full bg-[#62aef0] opacity-[0.12] blur-[140px] dark:opacity-[0.07]" />
        <div className="absolute -bottom-48 -right-32 w-[40rem] h-[40rem] rounded-full bg-[#d6b6f6] opacity-[0.14] blur-[150px] dark:opacity-[0.07]" />
        <div className="absolute -top-10 right-1/4 w-[26rem] h-[26rem] rounded-full bg-[#ffb6dd] opacity-[0.10] blur-[130px] dark:opacity-[0.05]" />
      </div>
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
          undo={controller.undo} redo={controller.redo} canUndo={store.canUndo()} canRedo={store.canRedo()} cloudMode={cloudMode}
        />
        <main className="flex-1 overflow-auto p-4 md:p-6 relative">
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
            onFileActivity={(action) => { const updated = controller.handleFileActivity(modalState.task, action); setModalState(prev => ({ ...prev, task: updated })); }}
          />
        </ErrorBoundary>
      )}

      {isProfileModalOpen && <ProfileModal onClose={() => setIsProfileModalOpen(false)} onSave={(p) => { controller.handleUpdateUser(p); localStorage.setItem('daboot_profile_done', '1'); }} />}
      {isProjectModalOpen && <ProjectModal onClose={() => setIsProjectModalOpen(false)} onSave={(title) => { const newId = controller.handleAddProject(title); setActiveMenu(newId); setIsProjectModalOpen(false); }} />}
      {isSyncModalOpen && <SyncModal onClose={() => setIsSyncModalOpen(false)} persistence={persistence} cloudMode={cloudMode} isAdmin={isAdmin} onMigrate={handleMigrate} migrating={migrating} />}
    </div>
  );
}
