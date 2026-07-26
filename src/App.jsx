import React, { useState, useCallback, useEffect, useRef } from 'react';
import { store } from './store/workspaceStore.js';
import { useWorkspaceController } from './hooks/controllers.js';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { TopNav, MobileTopBar, MobileTabBar } from './components/layout.jsx';
import { useIsMobile } from './hooks/useIsMobile.js';
import { DashboardView, ProjectView, MyTasksView, TeamView } from './views/views.jsx';
import { TaskModalShell, ProfileModal, ProjectModal } from './modals/modals.jsx';
import { AuthProvider, useAuth } from './services/auth.jsx';
import { LoginScreen } from './components/LoginScreen.jsx';
import { ToastHost } from './components/Toast.jsx';
import * as cloudSync from './services/cloudSync.js';
import logoLight from './assets/logo-light.png';
import logoDark from './assets/logo-dark.png';

// 클라우드 초기 로드 중 미니멀 스플래시 (로고 + 살짝 pulse)
function CloudSplash() {
  return (
    <div className="h-dvh bg-canvas flex items-center justify-center">
      <img src={logoLight} alt="더다붓" className="h-12 w-auto animate-pulse dark:hidden" />
      <img src={logoDark} alt="더다붓" className="h-12 w-auto animate-pulse hidden dark:block" />
    </div>
  );
}

// 클라우드 로드 실패 화면 — 스테일 로컬 데이터를 절대 보여주지 않는다
function CloudErrorScreen({ reason, onRetry, retrying }) {
  return (
    <div className="h-dvh bg-canvas flex flex-col items-center justify-center px-6 text-center">
      <img src={logoLight} alt="더다붓" className="h-12 w-auto mb-6 dark:hidden" />
      <img src={logoDark} alt="더다붓" className="h-12 w-auto mb-6 hidden dark:block" />
      <h1 className="text-base font-bold text-fg tracking-[-0.25px] mb-1.5">데이터를 불러오지 못했어요</h1>
      <p className="text-xs text-fg-muted leading-relaxed max-w-sm mb-6 break-words">{reason}</p>
      <button
        onClick={onRetry} disabled={retrying}
        className="bg-accent hover:bg-accent-strong disabled:bg-line text-white px-5 py-2.5 rounded-md text-xs font-medium transition active:scale-95"
      >
        {retrying ? '다시 시도 중...' : '다시 시도'}
      </button>
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
        <ToastHost />
      </AuthProvider>
    </ErrorBoundary>
  );
}

// Supabase 설정 시에만 로그인 요구, 미설정이면 게스트 모드
function AuthGate() {
  const { enabled, session, loading } = useAuth();
  if (loading) return <div className="h-dvh bg-canvas" />;
  if (enabled && !session) return <LoginScreen />;
  return <WorkspaceShell />;
}

function WorkspaceShell() {
  const controller = useWorkspaceController();
  const isMobile = useIsMobile();
  const { enabled: authEnabled, session, isAdmin } = useAuth();
  const cloudMode = authEnabled && !!session;
  // 딥링크: /?p=<projectId>&t=<taskId>
  const [activeMenu, setActiveMenu] = useState(() => new URLSearchParams(window.location.search).get('p') || 'dashboard');
  const pendingTaskIdRef = useRef(new URLSearchParams(window.location.search).get('t'));
  const [modalState, setModalState] = useState({ isOpen: false, task: null, isEditMode: false });
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null); // 이름 수정할 프로젝트
  // 보드/캘린더 선택은 프로젝트를 옮겨도 유지한다(ProjectView는 프로젝트마다 리마운트됨)
  const [projectViewMode, setProjectViewMode] = useState('kanban');
  const [cloudReady, setCloudReady] = useState(!cloudMode);
  const [loadError, setLoadError] = useState(null);
  const [retrying, setRetrying] = useState(false);

  // 클라우드 상태를 다시 읽어 스토어에 반영
  const reloadCloud = useCallback(async () => {
    const { state, profile } = await cloudSync.loadCloudState();
    store.dispatch({ type: 'LOAD_STATE', payload: state });
    return profile;
  }, []);

  // 초기 클라우드 로드 + 온보딩(프로필 display_name 없으면 프로필 창)
  // 실패 시 cloudReady를 올리지 않고 오류 화면을 띄운다(스테일 데이터 노출 금지)
  const initialLoad = useCallback(async () => {
    try {
      setLoadError(null);
      const profile = await reloadCloud();
      if (!profile || !profile.display_name) setIsProfileModalOpen(true);
      setCloudReady(true);
    } catch (e) {
      console.error('[cloud] 초기 로드 실패:', e);
      setLoadError(cloudSync.formatCloudError(e));
      setCloudReady(false);
    }
  }, [reloadCloud]);

  useEffect(() => {
    if (!cloudMode) { setCloudReady(true); return; }
    initialLoad();
  }, [cloudMode, initialLoad]);

  const retryLoad = useCallback(async () => {
    setRetrying(true);
    await initialLoad();
    setRetrying(false);
  }, [initialLoad]);

  // 실시간: 변경 감지 → 300ms debounce 재조회
  // 편집 중에는 LOAD_STATE가 폼을 갈아치우며 타이핑 렉·입력 유실을 일으키므로
  // 재조회를 보류하고, 편집이 끝나면 밀린 변경을 1회 반영한다.
  const isEditing = modalState.isOpen && modalState.isEditMode;
  const isEditingRef = useRef(isEditing);
  const pendingReloadRef = useRef(false);
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);

  useEffect(() => {
    if (!cloudMode) return;
    let timer = null;
    const unsub = cloudSync.subscribeAll(() => {
      if (isEditingRef.current) { pendingReloadRef.current = true; return; }
      clearTimeout(timer);
      timer = setTimeout(() => { reloadCloud().catch(e => console.error('[cloud] 재조회 실패:', e)); }, 300);
    });
    return () => { clearTimeout(timer); unsub(); };
  }, [cloudMode, reloadCloud]);

  // 편집 종료 시 보류된 재조회 1회 실행
  useEffect(() => {
    if (!cloudMode || isEditing || !pendingReloadRef.current) return;
    pendingReloadRef.current = false;
    reloadCloud().catch(e => console.error('[cloud] 재조회 실패:', e));
  }, [cloudMode, isEditing, reloadCloud]);

  const openTaskModal = useCallback((task, isEditMode = false) => {
    setModalState({ isOpen: true, task, isEditMode });
  }, []);

  // ── 뷰·셸에 내려주는 핸들러는 전부 useCallback으로 고정 ──
  // 인라인 화살표로 내려주면 매 렌더마다 새 함수가 되어 React.memo가 무력해지고,
  // 모달을 열 때(setModalState) 활성 뷰의 카드 전체가 다시 렌더된다(150장 = 150회).
  const openProfile = useCallback(() => setIsProfileModalOpen(true), []);
  const openProjectModal = useCallback(() => setIsProjectModalOpen(true), []);
  const openRenameProject = useCallback((project) => setRenameTarget(project), []);
  const selectMenu = useCallback((menu) => setActiveMenu(menu), []);
  const handleTaskClick = useCallback((t) => openTaskModal(t), [openTaskModal]);
  const saveTask = controller.handleSaveTask;
  const handleStatusChange = useCallback((t, status) => saveTask({ ...t, status }, t), [saveTask]);
  const handleNewTask = useCallback(() => {
    openTaskModal({ projectId: activeMenu, status: '시작 전', assignees: [], teams: [] }, true);
  }, [openTaskModal, activeMenu]);

  // 통합 검색 선택: 프로젝트 → 이동 / 업무 → 이동 + 모달 오픈
  const handleSearchSelect = useCallback((kind, item) => {
    if (kind === 'project') { setActiveMenu(item.id); }
    else if (kind === 'task') { setActiveMenu(item.projectId); openTaskModal(item); }
  }, [openTaskModal]);

  // 알림에서 열기: 해당 업무의 프로젝트로 이동 후 모달
  const handleOpenTaskFromNotification = useCallback((task) => handleSearchSelect('task', task), [handleSearchSelect]);

  // 문자열이라 값 비교 → memo에 안전
  const teamName = activeMenu.startsWith('team:') ? activeMenu.split(':')[1] : '';

  // 딥링크의 taskId → 데이터 준비 후 해당 업무 모달 오픈(존재 검증)
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
    const isProject = !['dashboard', 'myTasks'].includes(activeMenu) && !activeMenu.startsWith('team:');
    if (isProject) params.set('p', activeMenu);
    if (modalState.isOpen && modalState.task?.id) {
      if (modalState.task.projectId) params.set('p', modalState.task.projectId);
      params.set('t', modalState.task.id);
    }
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [activeMenu, modalState]);

  if (cloudMode && loadError) return <CloudErrorScreen reason={loadError} onRetry={retryLoad} retrying={retrying} />;
  if (cloudMode && !cloudReady) return <CloudSplash />;

  return (
    // bg-canvas는 body가 이미 깔아준다 — 여기에 또 칠하면 -z-10 글로우가 가려진다
    <div className="flex flex-col h-dvh text-fg font-sans overflow-hidden">
      {/* 배경 파스텔 글로우 (장식 전용 · 상호작용 차단 · 스크롤 고정)
          blur 필터 대신 radial-gradient — index.css의 .app-glow 참고 */}
      <div className="pointer-events-none fixed inset-0 -z-10 app-glow" aria-hidden="true" />

      {/* CSS(hidden/md:hidden)로만 감추면 양쪽 내비가 동시에 '마운트'된다 →
          알림 종이 둘 다 살아서 같은 Supabase 실시간 채널
          (notifications:<userId>)에 두 번 붙는다. 그래서 폭에 맞는 쪽만 마운트한다. */}
      {isMobile ? (
        <MobileTopBar
          activeMenu={activeMenu} setActiveMenu={selectMenu}
          onSearchSelect={handleSearchSelect} onOpenTask={handleOpenTaskFromNotification}
          onOpenProject={openProjectModal} onRenameProject={openRenameProject} cloudMode={cloudMode}
        />
      ) : (
        <TopNav
          activeMenu={activeMenu} setActiveMenu={selectMenu}
          onSearchSelect={handleSearchSelect} onOpenTask={handleOpenTaskFromNotification}
          onOpenProfile={openProfile} onOpenProject={openProjectModal}
          undo={controller.undo} redo={controller.redo} canUndo={store.canUndo()} canRedo={store.canRedo()} cloudMode={cloudMode}
        />
      )}

      {/* 화면을 꽉 쓴다 — 여백은 내용이 벽에 붙지 않을 만큼만.
          모바일 pb-20은 하단 탭바 높이(마지막 카드가 탭바에 가리지 않게) */}
      <main className="flex-1 overflow-auto px-3 pt-2.5 pb-20 md:px-4 md:pt-3.5 md:pb-3 relative">
        <ErrorBoundary>
          {/* key로 뷰 전환 시 리마운트 → 각 뷰의 등장 애니메이션 재생 */}
          <div key={activeMenu} className="h-full">
          {activeMenu === 'dashboard' && <DashboardView onNavigate={setActiveMenu} />}
          {activeMenu === 'myTasks' && <MyTasksView onTaskClick={handleTaskClick} onStatusChange={handleStatusChange} />}
          {activeMenu.startsWith('team:') && <TeamView teamName={teamName} onTaskClick={handleTaskClick} onStatusChange={handleStatusChange} />}
          {(!['dashboard', 'myTasks'].includes(activeMenu) && !activeMenu.startsWith('team:')) && (
             <ProjectView projectId={activeMenu} onNavigate={setActiveMenu} onTaskClick={handleTaskClick} onStatusChange={handleStatusChange} onNewTask={handleNewTask} onRenameProject={openRenameProject} viewMode={projectViewMode} setViewMode={setProjectViewMode} />
          )}
          </div>
        </ErrorBoundary>
      </main>

      {isMobile && (
        <MobileTabBar
          activeMenu={activeMenu} setActiveMenu={selectMenu}
          onOpenProfile={openProfile} onOpenProject={openProjectModal}
        />
      )}

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
            onDelete={() => { controller.handleDeleteTask(modalState.task); setModalState({ isOpen: false, task: null, isEditMode: false }); }}
          />
        </ErrorBoundary>
      )}

      {isProfileModalOpen && <ProfileModal onClose={() => setIsProfileModalOpen(false)} onSave={(p) => { controller.handleUpdateUser(p); localStorage.setItem('daboot_profile_done', '1'); }} />}
      {/* 창 하나로 '새로 만들기'와 '이름 수정'을 겸한다 — renameTarget이 있으면 수정 */}
      {(isProjectModalOpen || renameTarget) && (
        <ProjectModal
          project={renameTarget}
          onClose={() => { setIsProjectModalOpen(false); setRenameTarget(null); }}
          onSave={(title) => {
            if (renameTarget) { controller.handleRenameProject(renameTarget.id, title); setRenameTarget(null); }
            else { const newId = controller.handleAddProject(title); setActiveMenu(newId); setIsProjectModalOpen(false); }
          }}
        />
      )}
    </div>
  );
}
