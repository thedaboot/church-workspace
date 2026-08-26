import React, { useState, useCallback, useEffect, useRef } from 'react';
import { store, useCanUndo, useCanRedo } from './store/workspaceStore.js';
import { useWorkspaceController } from './hooks/controllers.js';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { TopNav, MobileTopBar, MobileTabBar } from './components/layout.jsx';
import { useIsMobile } from './hooks/useIsMobile.js';
import { DashboardView, ProjectView, MyTasksView, TeamView, ScheduleView, DASH_FILTERS, DASH_FILTER_DEFAULT } from './views/views.jsx';
import { TaskModalShell } from './modals/modals.jsx';
import { ProfileModal, ProjectModal } from './modals/settings.jsx';
import { AuthProvider, useAuth } from './services/auth.jsx';
import { LoginScreen } from './components/LoginScreen.jsx';
import { MembersView } from './views/membersView.jsx';
import { ToastHost, showToast } from './components/Toast.jsx';
import * as cloudSync from './services/cloudSync.js';
import { setOnline } from './services/presence.js';
import logoLight from './assets/logo-light.png';
import logoDark from './assets/logo-dark.png';

// activeMenu에는 화면 이름이나 프로젝트 id가 들어간다 — 여기 없는 값은 프로젝트로 본다.
// 새 전역 화면을 만들면 이 목록에도 넣어야 그 이름이 프로젝트 id로 오해되지 않는다
// (오해되면 '없는 프로젝트'로 판정돼 대시보드로 튕긴다).
// 새 전역 화면을 만들면 여기에도 넣는다 — 없으면 프로젝트 id로 오해돼
// '없는 프로젝트'로 판정되고 대시보드로 튕긴다(§3).
const GLOBAL_MENUS = ['dashboard', 'myTasks', 'schedule', 'members'];

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
  const { enabled, session, loading, approved } = useAuth();
  if (loading) return <div className="h-dvh bg-canvas" />;
  if (enabled && !session) return <LoginScreen />;
  // 승인 전에는 워크스페이스를 아예 마운트하지 않는다 — DB도 막혀 있어서(0022)
  // 들여보내 봐야 빈 화면에 오류만 뜬다. 무엇을 기다리는지 말해 주는 편이 맞다.
  if (enabled && !approved) return <LoginScreen waiting />;
  return <WorkspaceShell />;
}

function WorkspaceShell() {
  const controller = useWorkspaceController();
  const isMobile = useIsMobile();
  const { enabled: authEnabled, session, isAdmin, isMaster } = useAuth();
  const cloudMode = authEnabled && !!session;
  // 딥링크: /?p=<projectId>&t=<taskId>
  const [activeMenu, setActiveMenu] = useState(() => new URLSearchParams(window.location.search).get('p') || 'dashboard');
  // 대시보드 필터는 URL과 맞물리므로 App이 들고 있다(프로젝트 viewMode와 같은 이유).
  // 알 수 없는 값이 주소로 들어오면 기본값으로 떨어진다.
  const [dashFilter, setDashFilter] = useState(() => {
    const f = new URLSearchParams(window.location.search).get('f');
    return DASH_FILTERS.includes(f) ? f : DASH_FILTER_DEFAULT;
  });
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
  // 스토어 구독 — 렌더 중 store.canUndo()를 부르면 값이 갱신되지 않는다
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  // 클라우드 상태를 다시 읽어 스토어에 반영
  // 열려 있는 업무 창의 카드 id — 댓글·첨부 변경은 이 카드일 때만 상세를 다시 읽는다
  const openCardIdRef = useRef(null);
  useEffect(() => { openCardIdRef.current = modalState.isOpen ? (modalState.task?.id || null) : null; }, [modalState]);
  const reloadCloud = useCallback(async () => {
    const { state, profile } = await cloudSync.loadCloudState();
    store.dispatch({ type: 'LOAD_STATE', payload: state });
    // **전체 재조회는 모든 카드의 댓글·활동을 빈 배열로 되돌린다**(초기 로드가 읽지
    // 않는 값이다 — §6-20). 업무 창이 열려 있으면 그 카드만 다시 읽어 채워 준다.
    // 이게 없으면 창은 열려 있는데 카드 id가 그대로라 상세 효과가 다시 돌지 않아서,
    // **댓글과 활동 기록이 빈 채로 남는다**(닫았다 열면 보인다 — 사용자 지적).
    // 저장 직후에 특히 잘 났다: 내 저장이 실시간 cards 이벤트로 돌아오고, 편집
    // 중이라 미뤄 둔 전체 재조회가 편집이 끝나는 순간 실행된다.
    // 남이 프로젝트 이름을 바꿔도 같은 일이 난다 — 그쪽도 이 한 줄이 막는다.
    const openId = openCardIdRef.current;
    if (openId) {
      try {
        const detail = await cloudSync.loadCardDetail(openId);
        store.dispatch({ type: 'SYNC_TASK', payload: { id: openId, ...detail } });
      } catch (e) {
        console.error('[cloud] 재조회 후 상세 복구 실패:', e);
      }
    }
    return profile;
  }, []);

  // 초기 클라우드 로드 + 온보딩(프로필 display_name 없으면 프로필 창)
  // 실패 시 cloudReady를 올리지 않고 오류 화면을 띄운다(스테일 데이터 노출 금지)
  const initialLoad = useCallback(async () => {
    try {
      setLoadError(null);
      const profile = await reloadCloud();
      // 다녀갔다고 찍는다(0019) — 대시보드의 '오늘 다녀간 사람'이 보는 값.
      // 기다리지 않고 실패도 삼킨다: 얼굴 하나가 덜 뜨는 일이라 로드를 막을 이유가 없다.
      // 방금 읽은 목록에는 이 값이 없다(로드가 먼저 끝났다) — 그래서 화면은 **나를 언제나
      // 다녀간 사람으로 센다**. 지금 이 화면을 보고 있는 사람이 나이기 때문이다.
      // 기다렸다가 로드하는 쪽으로 바꾸면 첫 화면이 그만큼 늦어진다.
      cloudSync.touchLastSeen();
      // 첫 설정이 안 끝난 사람에게만 띄운다 — 이름과 팀이 둘 다 있으면 다시 뜨지 않는다.
      // 팀까지 보는 이유: 이름만 있고 팀이 비면 팀 보드·'내 팀 업무'가 계속 빈다.
      const me = store.getState().currentUser;
      const needsSetup = !profile || !me.name || !(me.teams?.length || me.team);
      if (needsSetup) setIsProfileModalOpen(true);
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
  const pendingCardsRef = useRef(new Set());   // 편집 중에 바뀐 카드들(그 카드만 다시 읽는다)
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);

  // 카드 1건만 다시 읽어 반영한다 — 예전에는 카드 한 장이 바뀌어도 워크스페이스
  // 전체를 다시 읽었다(쿼리 11개). 서버에서 사라진 카드면 로컬에서도 지운다.
  const syncCard = useCallback(async (cardId) => {
    if (!cardId) return;
    try {
      const patch = await cloudSync.loadCardPatch(cardId);
      if (patch) store.dispatch({ type: 'SYNC_TASK', payload: patch });
      else store.dispatch({ type: 'DELETE_TASK', payload: cardId });
    } catch (e) { console.error('[cloud] 카드 갱신 실패:', e); }
  }, []);

  // 댓글·첨부는 업무 창 안에서만 보인다 → 지금 열려 있는 카드일 때만 상세를 다시 읽는다
  const syncCardDetail = useCallback(async (cardId) => {
    const id = cardId || openCardIdRef.current;
    if (!id || id !== openCardIdRef.current) return;
    try {
      const detail = await cloudSync.loadCardDetail(id);
      store.dispatch({ type: 'SYNC_TASK', payload: { id, ...detail } });
    } catch (e) { console.error('[cloud] 업무 상세 갱신 실패:', e); }
  }, []);

  useEffect(() => {
    if (!cloudMode) return;
    let timer = null;
    let feedTimer = null;
    const unsub = cloudSync.subscribeWorkspace({
      // 편집 중이면 미뤘다가 **그 카드만** 다시 읽는다. 예전에는 전체 재조회를
      // 예약했는데, 그러면 저장 한 번에 워크스페이스를 통째로 다시 읽고 그 과정에서
      // 열려 있는 창의 댓글·활동이 비었다(위 reloadCloud 주석).
      onCard: (id) => {
        if (isEditingRef.current) { if (id) pendingCardsRef.current.add(id); return; }
        syncCard(id);
      },
      onCardDelete: (id) => { if (id) store.dispatch({ type: 'DELETE_TASK', payload: id }); },
      onCardDetail: (id) => { if (!isEditingRef.current) syncCardDetail(id); },
      // 최근 활동 피드만 다시 읽는다(쿼리 1개). 저장 한 번에 기록이 여러 건 생기므로
      // 500ms 모아서 한 번만. 편집 중에도 막지 않는다 — 폼을 건드리는 갱신이 아니다.
      onActivityFeed: () => {
        clearTimeout(feedTimer);
        feedTimer = setTimeout(() => {
          cloudSync.loadActivityFeed()
            .then(feed => store.dispatch({ type: 'SET_ACTIVITY_FEED', payload: feed }))
            .catch(e => console.error('[cloud] 활동 피드 갱신 실패:', e));
        }, 500);
      },
      onFullReload: () => {
        if (isEditingRef.current) { pendingReloadRef.current = true; return; }
        clearTimeout(timer);
        timer = setTimeout(() => { reloadCloud().catch(e => console.error('[cloud] 재조회 실패:', e)); }, 300);
      },
    });
    return () => { clearTimeout(timer); clearTimeout(feedTimer); unsub(); };
  }, [cloudMode, reloadCloud, syncCard, syncCardDetail]);

  // 지금 접속해 있는 사람(presence) — DB에 아무것도 쓰지 않고, 연결이 끊기면 서버가
  // 바로 지운다. 값은 전용 미니 스토어로 흐른다(LOAD_STATE가 상태를 통째로 갈아치우는
  // 워크스페이스 스토어에 섞으면 재조회마다 사라진다).
  useEffect(() => {
    if (!cloudMode) return;
    const unsub = cloudSync.subscribePresence(setOnline);
    return () => { unsub(); setOnline([]); };
  }, [cloudMode]);

  // 편집 종료 시 보류된 재조회 1회 실행
  useEffect(() => {
    if (!cloudMode || isEditing) return;
    const cards = pendingCardsRef.current;
    if (cards.size) {
      const ids = [...cards];
      cards.clear();
      ids.forEach(id => syncCard(id));
    }
    if (!pendingReloadRef.current) return;
    pendingReloadRef.current = false;
    reloadCloud().catch(e => console.error('[cloud] 재조회 실패:', e));
  }, [cloudMode, isEditing, reloadCloud, syncCard]);

  // Ctrl/⌘+Z · Shift+Ctrl/⌘+Z — 버튼 툴팁이 예전부터 이 단축키를 안내하고 있었는데
  // 정작 핸들러가 없었다. 버튼과 같은 조건(게스트 모드)에서만 받고,
  // 글자를 입력하는 중이거나 창이 열려 있으면 넘긴다(입력 되돌리기를 가로채면 안 된다).
  useEffect(() => {
    if (cloudMode) return;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      if (modalState.isOpen || isProfileModalOpen || isProjectModalOpen || renameTarget) return;
      const el = e.target;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || '')) return;
      e.preventDefault();
      if (e.shiftKey) store.redo(); else store.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cloudMode, modalState.isOpen, isProfileModalOpen, isProjectModalOpen, renameTarget]);

  const openTaskModal = useCallback((task, isEditMode = false) => {
    setModalState({ isOpen: true, task, isEditMode });
  }, []);

  // 업무 창 핸들러의 기준 카드는 모달을 연 시점의 스냅샷(modalState.task)이 아니라
  // 스토어의 최신 카드여야 한다. 댓글·활동은 창을 연 **뒤에** 스토어로만 채워지므로
  // (loadCardDetail·실시간), 스냅샷 위에서 댓글을 추가하면 방금 로드된 댓글들이 통째로
  // 덮여 사라지고 실시간 재조회가 돌아와야 복구됐다 — "댓글이 나갔다 와야 보인다"의 원인.
  const liveModalTask = () => {
    const t = modalState.task;
    return (t?.id && store.getState().tasks.byId[t.id]) || t;
  };

  // ── 뷰·셸에 내려주는 핸들러는 전부 useCallback으로 고정 ──
  // 인라인 화살표로 내려주면 매 렌더마다 새 함수가 되어 React.memo가 무력해지고,
  // 모달을 열 때(setModalState) 활성 뷰의 카드 전체가 다시 렌더된다(150장 = 150회).
  const openProfile = useCallback(() => setIsProfileModalOpen(true), []);
  const openProjectModal = useCallback(() => setIsProjectModalOpen(true), []);
  const openRenameProject = useCallback((project) => setRenameTarget(project), []);
  const selectMenu = useCallback((menu) => setActiveMenu(menu), []);
  const handleTaskClick = useCallback((t) => openTaskModal(t), [openTaskModal]);
  const saveTask = controller.handleSaveTask;

  // 「이거 제가 할게요」(§1.2) — 담당자 없는 업무에 나를 넣는다. 기존 담당자를
  // 덮지 않도록 비어 있을 때만 부른다(버튼 자체가 그때만 뜬다). 활동 기록·알림은
  // saveTask(TaskService.update)가 담당자 변경으로 처리한다.
  const handleClaim = useCallback((t) => {
    const me = store.getState().currentUser?.name;
    if (!me) return;
    saveTask({ ...t, assignees: [me] }, t);
    showToast(`'${t.title}'의 담당자로 들어갔어요`);
  }, [saveTask]);

  // 목록·보드에서 상태를 바꾸면 되돌리기 토스트를 띄운다.
  // 클라우드 모드에는 전역 실행 취소가 없다(다른 사람과 상태가 어긋나므로 숨겼다).
  // 그래서 실수로 옮긴 카드를 되돌릴 길이 손으로 다시 옮기기뿐이었다.
  //
  // 되돌리기는 로컬만 고치면 안 되고 DB까지 같이 돌려야 한다(saveTask가 둘 다 한다).
  // 다만 그 사이에 다른 사람이 같은 카드를 건드렸으면 남의 변경을 덮게 된다 →
  // 되돌리기 직전에 서버 상태를 다시 읽어, 내가 저장한 그 상태가 그대로인지 확인한다.
  // 시각(updated_at) 대신 상태값을 보는 이유: 되돌리려는 것이 상태이므로 "그 상태가
  // 아직 내가 만든 그대로인가"가 정확히 물어야 할 질문이다(제목만 고친 사람의
  // 변경을 이유로 되돌리기를 막을 필요는 없다).
  const handleStatusChange = useCallback((t, status) => {
    const prev = t.status;
    saveTask({ ...t, status }, t);
    if (prev === status) return;
    showToast(`'${t.title}'을 ${status}로 옮겼어요`, {
      label: '되돌리기',
      onAction: async () => {
        const live = store.getState().tasks.byId[t.id];
        if (!live) { showToast('업무가 이미 삭제되었어요'); return; }
        if (cloudMode) {
          try {
            const fresh = await cloudSync.loadCardPatch(t.id);
            if (!fresh) { showToast('업무가 이미 삭제되었어요'); return; }
            if (fresh.status !== status) { showToast(`다른 사람이 이미 ${fresh.status}로 바꿨어요`); return; }
          } catch (e) {
            console.error('[cloud] 되돌리기 전 확인 실패:', e);
            showToast('지금은 되돌릴 수 없어요 · 잠시 후 다시 시도해주세요');
            return;
          }
        }
        saveTask({ ...live, status: prev }, live);
        showToast(`${prev}로 되돌렸어요`);
      },
    });
  }, [saveTask, cloudMode]);
  // dueDate: 캘린더의 날짜별 '+ 새 업무'가 그 날짜를 마감일로 넘긴다.
  // 문자열만 받는 이유: 헤더 버튼의 onClick이 이벤트 객체를 첫 인자로 넘기기 때문.
  const handleNewTask = useCallback((dueDate) => {
    openTaskModal({
      projectId: activeMenu, status: '시작 전', assignees: [], teams: [],
      ...(typeof dueDate === 'string' ? { dueDate } : {}),
    }, true);
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
  const isProjectScreen = !GLOBAL_MENUS.includes(activeMenu) && !activeMenu.startsWith('team:');
  // 안에서 스크롤하는 화면(보드·캘린더)은 높이가 확정돼야 한다 — 전체 일정도 달력이라
  // 같은 처리가 필요하다(h-full이 없으면 달력이 화면 밖으로 흘러 띠가 잘린다)
  const needsFullHeight = isProjectScreen || activeMenu === 'schedule';

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
    const isProject = !GLOBAL_MENUS.includes(activeMenu) && !activeMenu.startsWith('team:');
    if (isProject) params.set('p', activeMenu);
    // 대시보드 필터도 URL에 — 예전에는 '내 팀'을 골라놓고 새로고침하면 '전체'로
    // 돌아갔다. 화면과 열린 업무는 URL에 있는데 필터만 빠져 있었다.
    // '전체'는 기본값이라 적지 않는다(주소가 길어질 뿐이다).
    if (activeMenu === 'dashboard' && dashFilter !== DASH_FILTER_DEFAULT) params.set('f', dashFilter);
    if (modalState.isOpen && modalState.task?.id) {
      if (modalState.task.projectId) params.set('p', modalState.task.projectId);
      params.set('t', modalState.task.id);
    }
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [activeMenu, modalState, dashFilter]);

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
          onOpenProject={openProjectModal} onRenameProject={openRenameProject}
          onOpenProfile={openProfile} onOpenMembers={() => setActiveMenu('members')} cloudMode={cloudMode}
        />
      ) : (
        <TopNav
          activeMenu={activeMenu} setActiveMenu={selectMenu}
          onSearchSelect={handleSearchSelect} onOpenTask={handleOpenTaskFromNotification}
          onOpenProfile={openProfile} onOpenMembers={() => setActiveMenu('members')} onOpenProject={openProjectModal}
          undo={controller.undo} redo={controller.redo} canUndo={canUndo} canRedo={canRedo} cloudMode={cloudMode}
        />
      )}

      {/* 화면을 꽉 쓴다 — 여백은 내용이 벽에 붙지 않을 만큼만.
          모바일 아래 여백 = 탭바 높이 + 홈 인디케이터(safe-area) + 숨 쉴 틈.
          고정값(pb-20)으로 두면 아이폰에서 마지막 카드가 탭바에 잘렸다 */}
      <main className="flex-1 overflow-auto px-3 pt-2.5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-4 md:pt-3.5 md:pb-3 relative">
        <ErrorBoundary>
          {/* key로 뷰 전환 시 리마운트 → 각 뷰의 등장 애니메이션 재생.
              h-full은 프로젝트 화면에만 — 보드/캘린더가 안에서 스크롤하려면 높이가
              확정돼야 한다. 나머지 화면에 h-full을 걸면 내용이 이 박스를 넘쳐
              흐르고, 넘친 부분에는 main의 padding-bottom이 적용되지 않아서
              마지막 줄이 하단 탭바에 가렸다(대시보드 '팀별 남은 업무', 팀 보드
              '참여 프로젝트'). */}
          <div key={activeMenu} className={needsFullHeight ? 'h-full' : ''}>
          {activeMenu === 'dashboard' && <DashboardView onNavigate={setActiveMenu} onTaskClick={handleTaskClick} onStatusChange={handleStatusChange} onClaim={handleClaim} filter={dashFilter} setFilter={setDashFilter} />}
          {activeMenu === 'schedule' && <ScheduleView onTaskClick={handleTaskClick} />}
          {activeMenu === 'members' && <MembersView isAdmin={isAdmin} isMaster={isMaster} />}
          {activeMenu === "myTasks" && <MyTasksView onTaskClick={handleTaskClick} onStatusChange={handleStatusChange} onNavigate={setActiveMenu} />}
          {activeMenu.startsWith('team:') && <TeamView teamName={teamName} onTaskClick={handleTaskClick} onStatusChange={handleStatusChange} onNavigate={setActiveMenu} />}
          {isProjectScreen && (
             <ProjectView projectId={activeMenu} onNavigate={setActiveMenu} onTaskClick={handleTaskClick} onStatusChange={handleStatusChange} onReorder={controller.handleReorderTasks} onNewTask={handleNewTask} onRenameProject={openRenameProject} viewMode={projectViewMode} setViewMode={setProjectViewMode} />
          )}
          </div>
        </ErrorBoundary>
      </main>

      {isMobile && (
        <MobileTabBar
          activeMenu={activeMenu} setActiveMenu={selectMenu}
          onOpenProject={openProjectModal}
        />
      )}

      {modalState.isOpen && (
        <ErrorBoundary>
          <TaskModalShell
            task={modalState.task} isEditMode={modalState.isEditMode}
            onClose={() => setModalState({ isOpen: false, task: null, isEditMode: false })}
            onEdit={() => setModalState(prev => ({ ...prev, isEditMode: true }))}
            onSave={(newData) => { const saved = controller.handleSaveTask(newData, modalState.task.id ? liveModalTask() : null); setModalState({ isOpen: true, task: saved, isEditMode: false }); return saved; }}
            onAddComment={(text, parentId = null) => { const updated = controller.handleAddComment(liveModalTask(), text, parentId); setModalState(prev => ({ ...prev, task: updated })); }}
            onUpdateComment={(commentId, newText) => { const updated = controller.handleUpdateComment(liveModalTask(), commentId, newText); setModalState(prev => ({ ...prev, task: updated })); }}
            onDeleteComment={(commentId) => { const updated = controller.handleDeleteComment(liveModalTask(), commentId); setModalState(prev => ({ ...prev, task: updated })); }}
            onFileActivity={(action) => { const updated = controller.handleFileActivity(liveModalTask(), action); setModalState(prev => ({ ...prev, task: updated })); }}
            onDelete={() => { controller.handleDeleteTask(modalState.task); setModalState({ isOpen: false, task: null, isEditMode: false }); }}
          />
        </ErrorBoundary>
      )}

      {isProfileModalOpen && <ProfileModal onClose={() => setIsProfileModalOpen(false)} onSave={(p) => controller.handleUpdateUser(p)} />}
      {/* 창 하나로 '새로 만들기'와 '이름 수정'을 겸한다 — renameTarget이 있으면 수정 */}
      {(isProjectModalOpen || renameTarget) && (
        <ProjectModal
          project={renameTarget}
          /* 보관하면 보고 있던 그 화면에서 나간다 — 안 그러면 방금 보관한 프로젝트가
             탭에 그대로 남아서 "보관함으로 들어갔다"는 것이 화면에 아무 데도 안 보인다
             (보관된 것을 열어 두면 탭에 끌어올리는 규칙 때문이다). 보관 해제는 그 반대라
             그 자리에 그대로 둔다 — 방금 되살린 것을 왜 떠나야 하는지 알 수 없다. */
          onArchive={(id, archived) => {
            controller.handleArchiveProject(id, archived);
            if (archived && activeMenu === id) setActiveMenu('dashboard');
          }}
          onClose={() => { setIsProjectModalOpen(false); setRenameTarget(null); }}
          onSave={(title, year) => {
            if (renameTarget) { controller.handleRenameProject(renameTarget.id, title, year); setRenameTarget(null); }
            else { const newId = controller.handleAddProject(title, year); setActiveMenu(newId); setIsProjectModalOpen(false); }
          }}
        />
      )}
    </div>
  );
}
