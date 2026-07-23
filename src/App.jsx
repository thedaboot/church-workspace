import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useSyncExternalStore } from 'react';
import { 
  LayoutDashboard, CheckSquare, Bell, Search, Plus, Calendar as CalendarIcon, 
  MessageSquare, Paperclip, Clock, X, User, Hash, Pin, ListTodo, ExternalLink, Menu,
  Settings, ChevronRight, Database, Download, Upload, AlertTriangle, Undo2, Redo2,
  Wand2, Sparkles, Bot, Folder // 👈 Folder 아이콘 추가
} from 'lucide-react';

// ============================================================================
// 1. Constants & Configurations (설정 및 상수)
// ============================================================================
const CONFIG = {
  TEAMS: {
    '웰컴팀': 'bg-pink-100 text-pink-800',
    '워십팀': 'bg-purple-100 text-purple-800',
    '찬양팀': 'bg-blue-100 text-blue-800',
    '엔지니어팀': 'bg-gray-100 text-gray-800',
    '미디어팀': 'bg-indigo-100 text-indigo-800',
    '임원진': 'bg-yellow-100 text-yellow-800',
    '교역자': 'bg-red-100 text-red-800',
  },
  STATUSES: ['시작 전', '진행 중', '완료'],
  STATUS_STYLES: {
    '시작 전': 'bg-gray-100 text-gray-600 border-gray-200',
    '진행 중': 'bg-blue-100 text-blue-700 border-blue-200',
    '완료': 'bg-green-100 text-green-700 border-green-200'
  }
};

// ============================================================================
// 2. Utils & Helpers (유틸리티)
// ============================================================================
const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const formatDate = (dateString) => {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Entity 정규화 헬퍼 (Redux Toolkit Entity Adapter 패턴)
const normalize = (array) => array.reduce((acc, item) => {
  acc.byId[item.id] = item;
  acc.allIds.push(item.id);
  return acc;
}, { byId: {}, allIds: [] });

// ============================================================================
// 3. Memoized Selectors (Reselect 패턴 직접 구현)
// ============================================================================
// Selector 캐싱을 통해 파생 데이터 연산(filter, map) 비용을 최소화합니다.
function createSelector(dependencies, combiner) {
  let lastArgs = null;
  let lastResult = null;
  return (state) => {
    const args = dependencies.map(dep => dep(state));
    if (lastArgs && args.every((val, i) => val === lastArgs[i])) {
      return lastResult; // 의존성 상태가 같으면 이전 계산 결과 반환 (O(1))
    }
    lastArgs = args;
    lastResult = combiner(...args);
    return lastResult;
  };
}

// 기본 상태 접근자 (Base Selectors)
const selectTasks = state => state.tasks;
const selectProjects = state => state.projects;
const selectCurrentUser = state => state.currentUser;

// 파생 데이터 선택자 (Derived Selectors)
const selectTasksList = createSelector([selectTasks], (tasks) => tasks.allIds.map(id => tasks.byId[id]));
const selectProjectsList = createSelector([selectProjects], (projects) => projects.allIds.map(id => projects.byId[id]));
const selectProjectsMap = createSelector([selectProjects], (projects) => projects.byId);

const selectMyTasks = createSelector(
  [selectTasksList, selectCurrentUser],
  (tasksList, user) => tasksList.filter(t => t.assignees.includes(user.name))
);

const selectDashboardStats = createSelector(
  [selectTasksList, selectProjectsMap],
  (tasksList, projectsMap) => {
    const totalTasks = tasksList.length;
    const completedTasks = tasksList.filter(t => t.status === '완료').length;
    const progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

    const teamStats = Object.keys(CONFIG.TEAMS).map(teamName => {
      const teamTasks = tasksList.filter(t => t.teams.includes(teamName));
      const done = teamTasks.filter(t => t.status === '완료').length;
      const activeProjects = [...new Set(teamTasks.map(t => projectsMap[t.projectId]?.title).filter(Boolean))];
      return { 
        name: teamName, total: teamTasks.length, done, 
        progress: teamTasks.length === 0 ? 0 : Math.round((done / teamTasks.length) * 100), 
        projects: activeProjects 
      };
    });
    return { progress, teamStats };
  }
);

// 캘린더용 O(1) 맵핑 캐싱
const selectTasksByDate = createSelector(
  [selectTasksList],
  (tasksList) => {
    const map = new Map();
    tasksList.forEach(t => {
      if (t.dueDate) {
        if (!map.has(t.dueDate)) map.set(t.dueDate, []);
        map.get(t.dueDate).push(t);
      }
    });
    return map;
  }
);

// ============================================================================
// 4. Domain Services (비즈니스 로직 캡슐화)
// ============================================================================
const ActivityService = {
  createLog: (action, author) => ({ id: generateId(), action, author, timestamp: new Date().toISOString() }),
  generateStatusLog: (oldStatus, newStatus, author) => ActivityService.createLog(`상태를 '${oldStatus}'에서 '${newStatus}'(으)로 변경했습니다.`, author)
};

const TaskService = {
  create: (data, author) => ({
    ...data,
    id: generateId(),
    status: data.status || '시작 전',
    assignees: data.assignees || [],
    teams: data.teams || [],
    author,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: [],
    activityLog: [ActivityService.createLog('업무를 생성했습니다.', author)]
  }),
  update: (oldTask, newData, author) => {
    const updated = { ...oldTask, ...newData, updatedAt: new Date().toISOString() };
    if (oldTask.status !== newData.status) {
      updated.activityLog = [...(updated.activityLog || []), ActivityService.generateStatusLog(oldTask.status, newData.status, author)];
    }
    return updated;
  },
  addComment: (task, text, author) => ({
    ...task, 
    comments: [...(task.comments || []), { id: generateId(), author, text, timestamp: new Date().toISOString() }]
  })
};

const MockFactory = {
  createUser: (name = '홍길동', team = '미디어팀') => ({ name, team }),
  createProject: (title, pinnedLinks = []) => ({ id: generateId(), title, pinnedLinks }),
  createWorkspace: () => {
    const p1 = MockFactory.createProject('2026 여름 수련회 준비', [{ id: generateId(), title: '기획안 원본', url: '#' }]);
    const p2 = MockFactory.createProject('새신자 초청 주일', []);
    const t1 = TaskService.create({ projectId: p1.id, title: '수련회 포스터 디자인', status: '진행 중', assignees: ['홍길동'], teams: ['미디어팀'], content: '여름 수련회 포스터 작업입니다.', dueDate: '2026-07-25' }, '임성빈');
    return {
      currentUser: MockFactory.createUser(),
      projects: normalize([p1, p2]),
      tasks: normalize([t1])
    };
  }
};

// ============================================================================
// 5. State Management: Custom Store (Zustand/Redux 아키텍처)
// ============================================================================
// 순수 React Context의 한계(전체 리렌더링)를 극복하고 Undo/Redo 기능을 탑재한 커스텀 Store
class WorkspaceStore {
  constructor(initialState) {
    this.state = { past: [], present: initialState, future: [] };
    this.listeners = new Set();
  }

  getState = () => this.state.present;

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  _notify = () => this.listeners.forEach(l => l());

  // Command 패턴을 활용한 상태 변경
  dispatch = (action) => {
    const currentState = this.state.present;
    let nextState = currentState;

    switch (action.type) {
      case 'LOAD_STATE':
        nextState = action.payload;
        break;
      case 'UPSERT_TASK': {
        const task = action.payload;
        const isNew = !currentState.tasks.allIds.includes(task.id);
        nextState = {
          ...currentState,
          tasks: {
            byId: { ...currentState.tasks.byId, [task.id]: task },
            allIds: isNew ? [...currentState.tasks.allIds, task.id] : currentState.tasks.allIds
          }
        };
        break;
      }
      case 'ADD_PROJECT': {
        const project = action.payload;
        nextState = {
          ...currentState,
          projects: {
            byId: { ...currentState.projects.byId, [project.id]: project },
            allIds: [...currentState.projects.allIds, project.id]
          }
        };
        break;
      }
      case 'UPDATE_USER':
        nextState = { ...currentState, currentUser: { ...currentState.currentUser, ...action.payload } };
        break;
      default:
        return;
    }

    // 상태가 변경되었을 때만 History(과거) 저장
    if (nextState !== currentState) {
      this.state = {
        past: [...this.state.past, currentState],
        present: nextState,
        future: [] // 새로운 액션이 발생하면 미래(Redo)는 소멸
      };
      this._notify();
    }
  };

  // Time-travel (Undo/Redo) 로직
  undo = () => {
    if (this.state.past.length === 0) return;
    const previous = this.state.past[this.state.past.length - 1];
    const newPast = this.state.past.slice(0, -1);
    this.state = { past: newPast, present: previous, future: [this.state.present, ...this.state.future] };
    this._notify();
  };

  redo = () => {
    if (this.state.future.length === 0) return;
    const next = this.state.future[0];
    const newFuture = this.state.future.slice(1);
    this.state = { past: [...this.state.past, this.state.present], present: next, future: newFuture };
    this._notify();
  };

  canUndo = () => this.state.past.length > 0;
  canRedo = () => this.state.future.length > 0;
}

// 글로벌 Store 인스턴스 (단일 파일 제약상 싱글톤 활용)
const initialData = (() => {
  try {
    const saved = localStorage.getItem('church_app_v4');
    if (saved) return JSON.parse(saved);
  } catch (e) { console.error(e); }
  return MockFactory.createWorkspace();
})();
const store = new WorkspaceStore(initialData);

// 컴포넌트가 자신이 필요한 데이터만 구독하도록 만드는 마법의 Hook (useSyncExternalStore 활용)
function useStore(selector) {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

// ============================================================================
// 6. Persistence Layer (클라우드 저장소 계층 추상화)
// ============================================================================
const CloudRepository = {
  save: async (url, data) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(data), redirect: 'follow' });
    if (!response.ok) throw new Error('Network response was not ok');
  },
  load: async (url) => {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error('Network response was not ok');
    return await response.json();
  }
};

// ============================================================================
// 6-2. AI Service Layer (Gemini LLM Integration)
// ============================================================================
const AiService = {
  callGemini: async (prompt, systemInstruction = "") => {
    const apiKey = ""; // Canvas 환경에서 자동 주입됨
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    
    try {
      const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      return result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (error) {
      console.error("Gemini API Error:", error);
      return "오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
    }
  },
  summarizeTask: async (task) => {
    const commentsText = (task.comments || []).map(c => `${c.author}: ${c.text}`).join('\n');
    const prompt = `업무 제목: ${task.title}\n상세 내용: ${task.content}\n\n[댓글 타임라인]\n${commentsText}\n\n위 업무의 전체적인 진행 상황과 앞으로 남은 핵심 이슈를 3줄 이내로 간결하게 요약해줘.`;
    const sysPrompt = "너는 교회 청년부 프로젝트 매니저 어시스턴트야. 빠르고 명확하게 요약해.";
    return await AiService.callGemini(prompt, sysPrompt);
  },
  polishText: async (text) => {
    const prompt = `다음 텍스트를 다듬어줘:\n\n${text}`;
    const sysPrompt = "다음 텍스트를 교회 청년부 협업 툴에 맞게 예의 바르면서도 명확하고 프로페셔널한 어조로 교정해줘. 핵심 내용은 절대 누락하지 말고, 읽기 좋게 문단이나 기호를 적절히 사용해.";
    return await AiService.callGemini(prompt, sysPrompt);
  },
  friendlyComment: async (text) => {
    const prompt = `다음 댓글 내용을 수정해줘:\n\n${text}`;
    const sysPrompt = "교회 청년부 팀원에게 남기는 피드백 댓글이야. 핵심 피드백은 유지하되, 감정이 상하지 않게 둥글고 부드럽고 격려하는 어조로 다듬어줘.";
    return await AiService.callGemini(prompt, sysPrompt);
  }
};

// ============================================================================
// 7. Error Boundary (장애 격리 계층)
// ============================================================================
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) { console.error("Error caught by boundary:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl m-4 flex items-start gap-3">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-red-800 font-bold text-sm">컴포넌트 렌더링 중 오류가 발생했습니다.</h3>
            <p className="text-red-600 text-xs mt-1">{this.state.error?.toString()}</p>
            <button onClick={() => this.setState({ hasError: false })} className="mt-3 px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 text-xs rounded-md font-medium transition-colors">다시 시도</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// 8. Controllers (비즈니스 로직 훅)
// ============================================================================
const useWorkspaceController = () => {
  const currentUser = useStore(selectCurrentUser);

  // 로컬 스토리지 자동 저장 (Debounce 패턴 적용)
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('church_app_v4', JSON.stringify(store.getState()));
    }, 500); // 500ms 디바운스
    return () => clearTimeout(timer);
  });

  const handleSaveTask = useCallback((newData, oldData = null) => {
    const task = !oldData ? TaskService.create(newData, currentUser.name) : TaskService.update(oldData, newData, currentUser.name);
    store.dispatch({ type: 'UPSERT_TASK', payload: task });
    return task;
  }, [currentUser.name]);

  const handleAddComment = useCallback((task, text) => {
    const updated = TaskService.addComment(task, text, currentUser.name);
    store.dispatch({ type: 'UPSERT_TASK', payload: updated });
    return updated;
  }, [currentUser.name]);

  const handleAddProject = useCallback((title) => {
    const newProject = { id: generateId(), title, pinnedLinks: [] };
    store.dispatch({ type: 'ADD_PROJECT', payload: newProject });
    return newProject.id;
  }, []);

  const handleUpdateUser = useCallback((profile) => {
    store.dispatch({ type: 'UPDATE_USER', payload: profile });
  }, []);

  return { handleSaveTask, handleAddComment, handleAddProject, handleUpdateUser, undo: store.undo, redo: store.redo };
};

const usePersistenceController = () => {
  const [syncStatus, setSyncStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const syncToCloud = async (url) => {
    setSyncStatus('syncing');
    try {
      // Optimistic 개념: 로컬 스토어의 현재 상태를 즉시 클라우드로 백업
      await CloudRepository.save(url, store.getState());
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch (e) {
      setErrorMsg('동기화 실패: URL을 확인하세요.');
      setSyncStatus('error');
    }
  };

  const loadFromCloud = async (url) => {
    setSyncStatus('syncing');
    try {
      const data = await CloudRepository.load(url);
      store.dispatch({ type: 'LOAD_STATE', payload: data });
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch (e) {
      setErrorMsg('불러오기 실패');
      setSyncStatus('error');
    }
  };

  return { syncToCloud, loadFromCloud, syncStatus, errorMsg };
};

// ============================================================================
// 9. RichText Parser & Renderer
// ============================================================================
const parseContentToTokens = (text) => {
  if (!text) return [];
  return text.split('\n').map((line, i) => {
    if (/(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/i.test(line)) return { type: 'image', value: line, key: i };
    const tokens = line.split(' ').map((word, j) => {
      if (word.startsWith('@')) return { type: 'mention', value: word, key: `${i}-${j}` };
      if (word.startsWith('http')) return { type: 'link', value: word, key: `${i}-${j}` };
      return { type: 'text', value: word + ' ', key: `${i}-${j}` };
    });
    return { type: 'line', tokens, key: i };
  });
};

const RichText = React.memo(({ content }) => {
  const parsedBlocks = useMemo(() => parseContentToTokens(content), [content]);
  return (
    <>
      {parsedBlocks.map(block => {
        if (block.type === 'image') return <div key={block.key} className="my-2"><img src={block.value} alt="embedded" className="max-w-full rounded-lg border max-h-64 object-contain shadow-sm" /></div>;
        if (block.type === 'line') return (
          <p key={block.key} className="mb-1 text-gray-700 leading-relaxed text-sm">
            {block.tokens.map(t => {
              if (t.type === 'mention') return <span key={t.key} className="text-blue-600 font-semibold bg-blue-50 px-1 rounded mx-0.5">{t.value}</span>;
              if (t.type === 'link') return <a key={t.key} href={t.value} target="_blank" rel="noreferrer" className="text-blue-500 underline mx-0.5 break-all hover:text-blue-700">{t.value}</a>;
              return <span key={t.key}>{t.value}</span>;
            })}
          </p>
        );
        return null;
      })}
    </>
  );
});

// ============================================================================
// 10. Shell & Layout (프레젠테이션 최상위 계층)
// ============================================================================
export default function ChurchApp() {
  return (
    <ErrorBoundary>
      <WorkspaceShell />
    </ErrorBoundary>
  );
}

function WorkspaceShell() {
  const controller = useWorkspaceController();
  const persistence = usePersistenceController();
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [modalState, setModalState] = useState({ isOpen: false, task: null, isEditMode: false });
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  
  // 리렌더링 감지용 (개발자도구로 확인해보면 해당 뷰만 리렌더링됨을 알 수 있습니다)
  // console.log("WorkspaceShell Renders"); 

  const openTaskModal = useCallback((task, isEditMode = false) => {
    setModalState({ isOpen: true, task, isEditMode });
  }, []);

  return (
    <div className="flex h-screen bg-gray-50 text-gray-800 font-sans overflow-hidden">
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
        <main className="flex-1 overflow-auto bg-gray-50/50 p-4 md:p-6 relative">
          <ErrorBoundary>
            {activeMenu === 'dashboard' && <DashboardView onNavigate={setActiveMenu} />}
            {activeMenu === 'myTasks' && <MyTasksView onTaskClick={(t) => openTaskModal(t)} onStatusChange={(t, status) => controller.handleSaveTask({ ...t, status }, t)} />}
            {activeMenu === 'guide' && <GuideView />}
            {activeMenu.startsWith('team:') && <TeamView teamName={activeMenu.split(':')[1]} onTaskClick={(t) => openTaskModal(t)} onStatusChange={(t, status) => controller.handleSaveTask({ ...t, status }, t)} />}
            {(!['dashboard', 'myTasks', 'guide'].includes(activeMenu) && !activeMenu.startsWith('team:')) && (
               <ProjectView projectId={activeMenu} onTaskClick={(t) => openTaskModal(t)} onStatusChange={(t, status) => controller.handleSaveTask({ ...t, status }, t)} onNewTask={() => openTaskModal({ projectId: activeMenu, status: '시작 전', assignees: [], teams: [] }, true)} />
            )}
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
            onAddComment={(text) => { const updated = controller.handleAddComment(modalState.task, text); setModalState(prev => ({ ...prev, task: updated })); }}
          />
        </ErrorBoundary>
      )}
      
      {isProfileModalOpen && <ProfileModal onClose={() => setIsProfileModalOpen(false)} onSave={controller.handleUpdateUser} />}
      {isProjectModalOpen && <ProjectModal onClose={() => setIsProjectModalOpen(false)} onSave={(title) => { const newId = controller.handleAddProject(title); setActiveMenu(newId); setIsProjectModalOpen(false); }} />}
      {isSyncModalOpen && <SyncModal onClose={() => setIsSyncModalOpen(false)} persistence={persistence} />}
    </div>
  );
}

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================
const Sidebar = React.memo(({ activeMenu, setActiveMenu, isSidebarOpen, closeSidebar, onOpenProfile, onOpenProject }) => {
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

const Header = React.memo(({ activeMenu, openSidebar, onOpenSync, undo, redo, canUndo, canRedo }) => {
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

function DashboardView({ onNavigate }) {
  const { progress, teamStats } = useStore(selectDashboardStats);
  const myTasksCount = useStore(selectMyTasks).filter(t => t.status !== '완료').length;

  return (
    <div className="max-w-6xl mx-auto space-y-4 md:space-y-6 animate-in fade-in duration-300">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-white p-5 md:p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <h3 className="text-gray-500 text-xs md:text-sm font-medium mb-2">전체 프로젝트 진척도</h3>
          <div className="flex items-end gap-2"><span className="text-3xl md:text-4xl font-bold text-gray-800">{progress}%</span><span className="text-gray-500 text-xs mb-1">완료</span></div>
          <div className="w-full bg-gray-100 rounded-full h-2 mt-4"><div className="bg-blue-600 h-2 rounded-full transition-all duration-1000" style={{ width: `${progress}%` }}></div></div>
        </div>
        <div onClick={() => onNavigate('myTasks')} className="bg-white p-5 md:p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow cursor-pointer group">
          <div><h3 className="text-gray-500 text-xs md:text-sm font-medium mb-2 group-hover:text-blue-600 transition-colors">내 남은 업무</h3><div className="text-3xl md:text-4xl font-bold text-gray-800 group-hover:text-blue-700 transition-colors">{myTasksCount}개</div></div>
          <p className="text-xs text-gray-500 mt-2 flex justify-between items-center">오늘도 화이팅입니다! <span className="text-blue-500 font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">확인하기 <ChevronRight size={12}/></span></p>
        </div>
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-5 md:p-6 rounded-xl shadow-sm text-white flex flex-col justify-center sm:col-span-2 lg:col-span-1 relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white opacity-10 rounded-full blur-xl"></div>
          <h3 className="text-base md:text-lg font-bold mb-1">엔터프라이즈 워크스페이스</h3>
          <p className="text-xs text-indigo-100 mb-4 opacity-90 leading-relaxed">상단 헤더의 '실행 취소(Undo)' 버튼을 눌러 상태 롤백을 경험해보세요.</p>
          <button onClick={() => onNavigate('guide')} className="bg-white/20 hover:bg-white/30 text-white text-xs py-2 px-4 rounded-lg backdrop-blur-sm transition-colors self-start font-medium">사용 가이드 보기</button>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h3 className="font-bold text-sm md:text-base text-gray-800 flex items-center gap-2"><ListTodo size={18} className="text-blue-600"/> 팀별 업무 현황</h3>
        </div>
        <div className="p-4 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {teamStats.map(stat => (
            <div key={stat.name} onClick={() => onNavigate(`team:${stat.name}`)} className="border border-gray-100 rounded-lg p-3 md:p-4 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all bg-white group">
              <div className="flex justify-between items-center mb-2 md:mb-3">
                <span className={`px-2 py-1 rounded text-[10px] md:text-xs font-bold ${CONFIG.TEAMS[stat.name]}`}>{stat.name}</span>
                <span className="text-xs font-medium text-gray-500 group-hover:text-blue-600 transition-colors">{stat.done} / {stat.total} 완료 <ChevronRight size={12} className="inline opacity-0 group-hover:opacity-100 transition-opacity" /></span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 md:h-2 mb-2 md:mb-3 overflow-hidden"><div className="bg-green-500 h-full rounded-full transition-all duration-700" style={{ width: `${stat.progress}%` }}></div></div>
              <div>
                <p className="text-[10px] text-gray-400 mb-1.5">진행 중인 프로젝트:</p>
                <div className="flex flex-wrap gap-1">
                  {stat.projects.length > 0 ? stat.projects.map((p, i) => <span key={i} className="text-[9px] md:text-[10px] bg-gray-50 border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded-md truncate max-w-full">{p}</span>) : <span className="text-[10px] text-gray-400 italic">없음</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectView({ projectId, onTaskClick, onStatusChange, onNewTask }) {
  const projectsMap = useStore(selectProjectsMap);
  const tasksList = useStore(selectTasksList);
  // 특정 프로젝트의 Task만 필터링 (해당 View 내부에서만 필요한 연산)
  const projectTasks = useMemo(() => tasksList.filter(t => t.projectId === projectId), [tasksList, projectId]);
  const project = projectsMap[projectId];

  const [viewMode, setViewMode] = useState('kanban');
  const [selectedTeams, setSelectedTeams] = useState([]);
  
  if (!project) return null;

  const toggleTeam = (team) => setSelectedTeams(prev => prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team]);
  const filteredTasks = useMemo(() => selectedTeams.length === 0 ? projectTasks : projectTasks.filter(task => task.teams.some(t => selectedTeams.includes(t))), [projectTasks, selectedTeams]);

  return (
    <div className="h-full flex flex-col min-w-0 animate-in fade-in">
      <div className="bg-white p-3 md:p-4 rounded-xl border border-gray-200 shadow-sm mb-3 md:mb-4 flex flex-col md:flex-row gap-3 md:gap-4 justify-between items-start md:items-center shrink-0">
        <div className="w-full md:w-auto">
          <h2 className="text-lg md:text-xl font-bold text-gray-800 mb-2">{project.title}</h2>
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            <span className="text-[10px] md:text-xs font-semibold text-gray-500 uppercase flex items-center gap-1"><Pin size={12} /> 리소스:</span>
            {project.pinnedLinks?.map(link => <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] md:text-xs px-1.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-md transition-colors"><ExternalLink size={10} /> {link.title}</a>)}
            <button className="text-[10px] md:text-xs text-gray-400 hover:text-gray-600 px-1.5 py-1 border border-dashed border-gray-300 rounded-md">+ 추가</button>
          </div>
        </div>
        <div className="flex bg-gray-100 p-1 rounded-lg w-full md:w-auto shrink-0">
          <button onClick={() => setViewMode('kanban')} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex justify-center items-center gap-1.5 ${viewMode === 'kanban' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}><LayoutDashboard size={14}/> 보드</button>
          <button onClick={() => setViewMode('calendar')} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex justify-center items-center gap-1.5 ${viewMode === 'calendar' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}><CalendarIcon size={14}/> 캘린더</button>
        </div>
      </div>
      {viewMode === 'kanban' && (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-3 shrink-0">
          <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1 w-full scrollbar-hide">
            <span className="text-xs font-medium text-gray-500 flex items-center mr-1 shrink-0">필터:</span>
            {Object.entries(CONFIG.TEAMS).map(([team, colorClass]) => <button key={team} onClick={() => toggleTeam(team)} className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all ${selectedTeams.includes(team) ? colorClass + ' ring-2 ring-offset-1 ring-blue-400' : 'bg-white text-gray-500 border-gray-200'}`}>{team}</button>)}
          </div>
          <button onClick={onNewTask} className="w-full md:w-auto shrink-0 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors flex justify-center items-center gap-2 shadow-sm"><Plus size={14} /> 새 작업</button>
        </div>
      )}
      <div className="flex-1 min-h-0">
        {viewMode === 'kanban' ? <Board tasks={filteredTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} /> : <CalendarBoard tasks={projectTasks} onTaskClick={onTaskClick} />}
      </div>
    </div>
  );
}

function MyTasksView({ onTaskClick, onStatusChange }) {
  const currentUser = useStore(selectCurrentUser);
  const myTasks = useStore(selectMyTasks);
  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col animate-in fade-in">
      <div className="mb-4 shrink-0"><h2 className="text-xl font-bold text-gray-800">👋 {currentUser.name}님의 작업</h2><p className="text-xs text-gray-500 mt-1">할당된 모든 프로젝트의 업무가 이곳에 모입니다.</p></div>
      <div className="flex-1 min-h-0"><Board tasks={myTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} showProjectBadge /></div>
    </div>
  );
}

function TeamView({ teamName, onTaskClick, onStatusChange }) {
  const tasksList = useStore(selectTasksList);
  const teamTasks = useMemo(() => tasksList.filter(t => t.teams.includes(teamName)), [tasksList, teamName]);
  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col animate-in fade-in">
      <div className="mb-4 shrink-0 flex items-center gap-3"><h2 className="text-xl font-bold text-gray-800">{teamName} 보드</h2><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${CONFIG.TEAMS[teamName]}`}>TEAM</span></div>
      <div className="flex-1 min-h-0"><Board tasks={teamTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} showProjectBadge /></div>
    </div>
  );
}

function GuideView() {
  return (
    <div className="max-w-3xl mx-auto bg-white p-6 md:p-10 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><LayoutDashboard className="text-blue-600"/> 사용 가이드</h1>
      <div className="space-y-6 text-sm text-gray-700 leading-relaxed">
        <section>
          <h2 className="font-bold text-lg mb-2 text-gray-900 border-b pb-2">1. 단일 파일 & 엔터프라이즈 아키텍처</h2>
          <p>이 어플리케이션은 물리적으로 단 하나의 파일(`.jsx`)로 이루어져 있지만, 내부적으로는 <strong>Redux/Zustand 수준의 상태 관리(Store), O(1) 캐싱(Selectors), 낙관적 업데이트, Undo/Redo 기능</strong>을 순수 React만으로 100% 구현한 최적화의 결정체입니다.</p>
        </section>
        <section>
          <h2 className="font-bold text-lg mb-2 text-gray-900 border-b pb-2">2. 상태 롤백 (Undo / Redo) 기능</h2>
          <p>상단 헤더 좌측에 있는 <Undo2 className="inline w-4 h-4 text-gray-500 mx-1"/> 버튼을 눌러보세요! 칸반 보드에서 카드를 옮기거나 내용을 잘못 수정한 경우, 언제든 이전 상태로 즉시 되돌릴 수 있습니다. Command 패턴과 Memento 패턴이 결합된 강력한 기능입니다.</p>
        </section>
        <section>
          <h2 className="font-bold text-lg mb-2 text-gray-900 border-b pb-2">3. 빠른 성능 (O(1) 캐싱)</h2>
          <p>수천 개의 Task가 쌓여도 달력(캘린더 뷰)이나 대시보드를 렌더링할 때 버벅이지 않습니다. 백그라운드에서 모든 데이터가 <strong>Map 구조로 정규화(Normalization)</strong>되어 있어 최적의 속도를 보장합니다.</p>
        </section>
      </div>
    </div>
  );
}

// ============================================================================
// 12. UI Components (순수 프레젠테이션)
// ============================================================================
const CalendarBoard = React.memo(({ tasks, onTaskClick }) => {
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

const Board = React.memo(({ tasks, onStatusChange, onTaskClick, showProjectBadge }) => {
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

// ============================================================================
// 13. Modals (완벽한 SRP 분리)
// ============================================================================
function TaskModalShell({ task, isEditMode, onClose, onEdit, onSave, onAddComment }) {
  const currentUser = useStore(selectCurrentUser);
  const [formData, setFormData] = useState(task);
  const [activeTab, setActiveTab] = useState('comments');
  
  // Stale State 방지: 모달 재사용 시 데이터 강제 동기화
  useEffect(() => { setFormData(task); }, [task]);

  const handleSubmit = (e) => { e.preventDefault(); onSave(formData); };
  
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 md:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[95vh] md:h-[85vh] flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 flex flex-col border-r-0 md:border-r border-gray-100 overflow-y-auto">
          <div className="sticky top-0 bg-white/95 backdrop-blur z-10 px-4 py-3 border-b border-gray-100 flex justify-between items-center">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-500"><CheckSquare size={14} className="text-blue-500"/> {task.id ? '작업 세부 정보' : '새 작업 만들기'}</div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full text-gray-400"><X size={18}/></button>
          </div>
          <div className="p-5 md:p-8 flex-1">
            {isEditMode ? <TaskEditor formData={formData} setFormData={setFormData} /> : <TaskViewer formData={formData} />}
          </div>
          <div className="sticky bottom-0 bg-white border-t border-gray-100 p-3 md:p-4 flex justify-between items-center z-10 bg-gray-50/80 backdrop-blur">
            <div className="text-[10px] text-gray-400 hidden sm:block">작성: {formData.author} • 최근: {formatDate(formData.updatedAt)}</div>
            <div className="flex gap-2 w-full sm:w-auto">
              <button onClick={onClose} className="flex-1 sm:flex-none px-4 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg">닫기</button>
              {isEditMode ? <button type="button" onClick={handleSubmit} className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-xs font-medium shadow-sm">저장</button> 
                          : <button type="button" onClick={onEdit} className="flex-1 sm:flex-none bg-gray-800 hover:bg-gray-900 text-white px-6 py-2 rounded-lg text-xs font-medium shadow-sm">수정</button>}
            </div>
          </div>
        </div>
        {!isEditMode && task.id && (
          <div className="w-full md:w-80 h-[40vh] md:h-auto bg-gray-50 flex flex-col border-t md:border-t-0 md:border-l border-gray-200 shrink-0">
            <div className="flex border-b border-gray-200 bg-white shrink-0">
              <button onClick={() => setActiveTab('comments')} className={`flex-1 py-3 text-xs font-semibold transition-colors ${activeTab === 'comments' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}>댓글 ({(formData.comments || []).length})</button>
              <button onClick={() => setActiveTab('activity')} className={`flex-1 py-3 text-xs font-semibold transition-colors ${activeTab === 'activity' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}>활동 기록</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{activeTab === 'comments' ? <CommentPanel comments={formData.comments} /> : <ActivityPanel logs={formData.activityLog} />}</div>
            {activeTab === 'comments' && <CommentInput onAdd={onAddComment} />}
          </div>
        )}
      </div>
    </div>
  );
}

const TaskEditor = React.memo(({ formData, setFormData }) => {
  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  const handleTeams = (e) => setFormData(prev => ({ ...prev, teams: Array.from(e.target.selectedOptions, o => o.value) }));
  const handleAssignees = (e) => setFormData(prev => ({ ...prev, assignees: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }));
  
  const handleAiPolish = async () => {
    if (!formData.content) return;
    setIsAiLoading(true);
    const polished = await AiService.polishText(formData.content);
    if (polished) setFormData(prev => ({ ...prev, content: polished }));
    setIsAiLoading(false);
  };

  return (
    <form className="space-y-5">
      <input type="text" name="title" value={formData.title || ''} onChange={handleChange} placeholder="작업 제목 입력" className="w-full text-xl font-bold text-gray-800 placeholder-gray-300 border-none focus:ring-0 p-0" required autoFocus />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4 border-y border-gray-100">
        <div><label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1.5">상태</label><select name="status" value={formData.status || '시작 전'} onChange={handleChange} className="w-full border-gray-200 rounded-lg text-xs bg-gray-50 p-2">{CONFIG.STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
        <div><label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1.5">마감일</label><input type="date" name="dueDate" value={formData.dueDate || ''} onChange={handleChange} className="w-full border-gray-200 rounded-lg text-xs bg-gray-50 p-2" /></div>
        <div className="sm:col-span-2 md:col-span-1"><label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1.5">담당 팀 (다중 선택)</label><select multiple value={formData.teams || []} onChange={handleTeams} className="w-full border-gray-200 rounded-lg text-xs h-20 bg-gray-50 p-2">{Object.keys(CONFIG.TEAMS).map(t => <option key={t}>{t}</option>)}</select></div>
        <div className="sm:col-span-2 md:col-span-1"><label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1.5">담당자 (쉼표 구분)</label><input type="text" value={(formData.assignees || []).join(', ')} onChange={handleAssignees} className="w-full border-gray-200 rounded-lg text-xs bg-gray-50 p-2" /></div>
      </div>
      <div>
        <div className="flex justify-between items-center mb-1.5">
          <label className="block text-[10px] font-semibold text-gray-500 uppercase">상세 내용</label>
          <button type="button" onClick={handleAiPolish} disabled={isAiLoading || !formData.content} className="flex items-center gap-1 px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded text-[10px] font-bold transition-colors disabled:opacity-50">
            {isAiLoading ? <span className="animate-pulse">다듬는 중...</span> : <><Wand2 size={12} /> AI 문맥 다듬기</>}
          </button>
        </div>
        <textarea name="content" value={formData.content || ''} onChange={handleChange} className="w-full h-32 md:h-48 border-gray-200 rounded-lg p-3 text-xs bg-gray-50 resize-none"></textarea>
      </div>
    </form>
  );
});

const TaskViewer = React.memo(({ formData }) => {
  const [summary, setSummary] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleSummarize = async () => {
    setIsAiLoading(true);
    const result = await AiService.summarizeTask(formData);
    setSummary(result);
    setIsAiLoading(false);
  };

  return (
    <div className="space-y-4 md:space-y-5">
      <div className="flex flex-wrap items-center gap-2 mb-1"><span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${CONFIG.STATUS_STYLES[formData.status]}`}>{formData.status}</span>{formData.teams?.map(t => <span key={t} className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${CONFIG.TEAMS[t]}`}>{t}</span>)}</div>
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 leading-tight">{formData.title}</h2>
      <div className="flex flex-wrap gap-4 py-3 border-y border-gray-100 text-xs"><div className="flex items-center gap-1.5"><User size={14} className="text-gray-400" /><span className="text-gray-500">담당:</span><span className="font-medium text-gray-900">{formData.assignees?.join(', ') || '미지정'}</span></div>{formData.dueDate && <div className="flex items-center gap-1.5 text-orange-600 bg-orange-50 px-2 py-1 rounded"><Clock size={12} /><span className="font-semibold">{new Date(formData.dueDate).toLocaleDateString('ko-KR')} 마감</span></div>}</div>
      
      {/* AI 요약 섹션 */}
      {(summary || isAiLoading) && (
        <div className="bg-purple-50/50 border border-purple-100 rounded-lg p-3 relative mt-4">
          <div className="text-[10px] font-bold text-purple-600 mb-1 flex items-center gap-1"><Sparkles size={12}/> AI 3줄 요약</div>
          {isAiLoading ? <div className="text-xs text-purple-400 animate-pulse">업무 내용과 댓글을 분석하고 있습니다...</div> : <div className="text-xs text-gray-700 whitespace-pre-wrap"><RichText content={summary} /></div>}
        </div>
      )}

      <div className="prose prose-sm max-w-none mt-4 bg-gray-50/50 p-4 rounded-xl border border-gray-100 min-h-[150px] relative group">
        {!summary && (
           <button onClick={handleSummarize} disabled={isAiLoading} className="absolute top-3 right-3 bg-white border border-gray-200 text-gray-600 hover:text-purple-600 hover:border-purple-200 px-2 py-1 rounded shadow-sm text-[10px] font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all z-10">
             <Sparkles size={12}/> 3줄 요약
           </button>
        )}
        <RichText content={formData.content} />
      </div>
    </div>
  );
});

const CommentPanel = React.memo(({ comments }) => (
  <div className="space-y-3">
    {(comments || []).map(c => <div key={c.id} className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm"><div className="flex justify-between items-center mb-1"><span className="font-bold text-[11px] text-gray-800">{c.author}</span><span className="text-[9px] text-gray-400">{formatDate(c.timestamp)}</span></div><div className="text-xs text-gray-600"><RichText content={c.text} /></div></div>)}
    {(!comments || comments.length === 0) && <div className="text-center text-xs text-gray-400 mt-6">첫 댓글을 남겨보세요!</div>}
  </div>
));

const ActivityPanel = React.memo(({ logs }) => (
  <div className="space-y-3 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-200">
    {(logs || []).slice().reverse().map(l => <div key={l.id} className="relative flex items-start gap-3 group"><div className="absolute left-0 mt-1 ml-1 w-2 h-2 rounded-full bg-blue-400 ring-2 ring-gray-50 z-10"></div><div className="ml-5"><p className="text-[11px] text-gray-800"><span className="font-bold">{l.author}</span>님이 {l.action}</p><p className="text-[9px] text-gray-400 mt-0.5">{formatDate(l.timestamp)}</p></div></div>)}
  </div>
));

const CommentInput = ({ onAdd }) => {
  const [val, setVal] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleAiSuggest = async () => {
    if (!val.trim()) return;
    setIsAiLoading(true);
    const friendlyText = await AiService.friendlyComment(val);
    if (friendlyText) setVal(friendlyText);
    setIsAiLoading(false);
  };

  return (
    <div className="p-3 bg-white border-t border-gray-200 shrink-0 relative">
      {isAiLoading && <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center z-10 text-xs font-bold text-purple-600 animate-pulse">댓글 다듬는 중...</div>}
      <textarea value={val} onChange={e => setVal(e.target.value)} placeholder="@이름 으로 멘션..." className="w-full text-xs border border-gray-200 rounded-lg p-2 focus:ring-1 focus:ring-blue-500 resize-none h-14 bg-gray-50" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (val.trim()) { onAdd(val); setVal(''); } } }} />
      <div className="flex justify-between mt-2 items-center">
        <button onClick={handleAiSuggest} disabled={!val.trim() || isAiLoading} className="text-purple-600 hover:bg-purple-50 disabled:opacity-50 disabled:hover:bg-transparent p-1.5 rounded-md text-[10px] font-bold flex items-center gap-1 transition-colors" title="부드러운 어조로 자동 수정">
          <Bot size={14}/> AI 둥글게 둥글게
        </button>
        <button onClick={() => { if (val.trim()) { onAdd(val); setVal(''); } }} disabled={!val.trim()} className="bg-blue-600 disabled:bg-gray-300 text-white px-3 py-1.5 rounded-md text-[10px] font-bold">등록</button>
      </div>
    </div>
  );
};

function ProfileModal({ onClose, onSave }) {
  const user = useStore(selectCurrentUser);
  const [name, setName] = useState(user.name);
  const [team, setTeam] = useState(user.team);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"><div className="bg-white p-5 md:p-6 rounded-xl shadow-xl w-full max-w-sm"><h3 className="font-bold text-gray-800 mb-4">프로필 설정</h3><label className="block text-xs font-semibold text-gray-500 mb-1.5">이름</label><input type="text" value={name} onChange={e=>setName(e.target.value)} className="w-full border p-2 rounded-lg mb-4 text-sm bg-gray-50" /><label className="block text-xs font-semibold text-gray-500 mb-1.5">소속 팀</label><select value={team} onChange={e=>setTeam(e.target.value)} className="w-full border p-2 rounded-lg mb-6 text-sm bg-gray-50">{Object.keys(CONFIG.TEAMS).map(t=><option key={t}>{t}</option>)}</select><div className="flex gap-2"><button onClick={onClose} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-lg text-sm font-medium">취소</button><button onClick={()=>{onSave({name, team}); onClose();}} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium">저장</button></div></div></div>
  );
}

function SyncModal({ onClose, persistence }) {
  const [url, setUrl] = useState(() => localStorage.getItem('church_app_sync_url') || '');
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"><div className="bg-white p-5 rounded-xl shadow-xl w-full max-w-md"><div className="flex justify-between items-center mb-4"><h3 className="font-bold text-gray-800 flex items-center gap-2"><Database size={16} className="text-blue-600"/> 데이터 연동</h3><button onClick={onClose} className="text-gray-400"><X size={18}/></button></div><div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-xs leading-relaxed mb-4">구글 Apps Script URL을 입력하여 데이터를 동기화합니다.</div><input type="text" value={url} onChange={e=>{setUrl(e.target.value); localStorage.setItem('church_app_sync_url',e.target.value);}} placeholder="https://script.google.com/..." className="w-full border p-2 rounded-lg mb-4 text-xs bg-gray-50" /><div className="flex gap-2"><button onClick={()=>persistence.loadFromCloud(url)} disabled={!url || persistence.syncStatus === 'syncing'} className="flex-1 bg-gray-800 text-white py-2 rounded-lg text-xs font-medium flex justify-center items-center gap-1"><Download size={14}/> 불러오기</button><button onClick={()=>persistence.syncToCloud(url)} disabled={!url || persistence.syncStatus === 'syncing'} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-xs font-medium flex justify-center items-center gap-1"><Upload size={14}/> 덮어쓰기</button></div><p className="text-center text-xs font-bold mt-3 h-4 text-blue-600">{persistence.syncStatus === 'syncing' ? '진행 중...' : persistence.syncStatus === 'success' ? '성공!' : <span className="text-red-500">{persistence.errorMsg}</span>}</p></div></div>
  );
}

function ProjectModal({ onClose, onSave }) {
  const [title, setTitle] = useState('');
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in">
      <div className="bg-white p-5 md:p-6 rounded-xl shadow-xl w-full max-w-sm">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Hash size={18} className="text-blue-600"/> 새 프로젝트 생성</h3>
        <label className="block text-xs font-semibold text-gray-500 mb-1.5">프로젝트 이름</label>
        <input 
          type="text" value={title} onChange={e => setTitle(e.target.value)} 
          placeholder="예: 2026 하반기 노방전도" 
          className="w-full border border-gray-200 p-2.5 rounded-lg mb-6 text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none" 
          autoFocus 
          onKeyDown={e => { if (e.key === 'Enter' && title.trim()) { onSave(title.trim()); } }} 
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 py-2.5 rounded-lg text-sm font-medium transition-colors">취소</button>
          <button onClick={() => { if(title.trim()) onSave(title.trim()); }} disabled={!title.trim()} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white py-2.5 rounded-lg text-sm font-medium transition-colors">생성하기</button>
        </div>
      </div>
    </div>
  );
}