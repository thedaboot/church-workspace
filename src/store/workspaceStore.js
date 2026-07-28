import { useSyncExternalStore } from 'react';
import { MockFactory } from '../services/domain.js';
import { isCloudEnabled } from '../services/supabaseClient.js';

// ============================================================================
// 5. State Management: Custom Store (Zustand/Redux 아키텍처)
// ============================================================================
// 순수 React Context의 한계(전체 리렌더링)를 극복하고 Undo/Redo 기능을 탑재한 커스텀 Store
// 되돌리기 기록에 남기지 않는 액션 —
//   LOAD_STATE   : 서버가 원본이므로 그 이전 상태로 되돌리면 유령 데이터가 살아난다 → 기록 초기화
//   HYDRATE_TASK : 서버에서 상세(댓글·활동)를 채워 넣는 것뿐이라 조작이 아니다 → 기록 그대로
// 예전에는 둘 다 past에 전체 상태 스냅샷을 쌓아서, 실시간 재조회가 잦은 탭에서
// 메모리가 계속 늘어났다(클라우드 모드는 실행 취소 버튼 자체를 숨기는데도).
const HISTORY_LIMIT = 20;

export class WorkspaceStore {
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
      // 서버에서 온 부분 갱신 — 이미 있는 카드에 필드만 덮어쓴다.
      // UPSERT_TASK로 하면 통째로 교체돼서 그 카드에 담아둔 댓글·활동·첨부가 날아간다.
      case 'HYDRATE_TASK': {
        const patch = action.payload;
        const prev = currentState.tasks.byId[patch.id];
        if (!prev) return;
        nextState = {
          ...currentState,
          tasks: { ...currentState.tasks, byId: { ...currentState.tasks.byId, [patch.id]: { ...prev, ...patch } } }
        };
        break;
      }
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
      case 'DELETE_TASK': {
        const id = action.payload;
        if (!currentState.tasks.byId[id]) return;
        const { [id]: _removedTask, ...remainingTasksById } = currentState.tasks.byId;
        nextState = {
          ...currentState,
          tasks: {
            byId: remainingTasksById,
            allIds: currentState.tasks.allIds.filter(x => x !== id)
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
      case 'DELETE_PROJECT': {
        const projectId = action.payload;
        if (!currentState.projects.byId[projectId]) return;
        const { [projectId]: _removedProject, ...remainingProjects } = currentState.projects.byId;
        // 해당 프로젝트에 속한 Task도 함께 제거
        const remainingTaskIds = currentState.tasks.allIds.filter(id => currentState.tasks.byId[id].projectId !== projectId);
        const remainingTasksById = {};
        remainingTaskIds.forEach(id => { remainingTasksById[id] = currentState.tasks.byId[id]; });
        nextState = {
          ...currentState,
          projects: {
            byId: remainingProjects,
            allIds: currentState.projects.allIds.filter(id => id !== projectId)
          },
          tasks: {
            byId: remainingTasksById,
            allIds: remainingTaskIds
          }
        };
        break;
      }
      case 'UPDATE_PROJECT': {
        const { id, ...patch } = action.payload;
        if (!currentState.projects.byId[id]) return;
        nextState = {
          ...currentState,
          projects: {
            ...currentState.projects,
            byId: { ...currentState.projects.byId, [id]: { ...currentState.projects.byId[id], ...patch } }
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

    if (nextState === currentState) return;

    // 상태가 실제로 바뀐 경우에만 History(과거) 저장 (위 HISTORY_LIMIT 주석 참고)
    if (action.type === 'LOAD_STATE') {
      this.state = { past: [], present: nextState, future: [] };
    } else if (action.type === 'HYDRATE_TASK') {
      this.state = { ...this.state, present: nextState };
    } else {
      this.state = {
        past: [...this.state.past, currentState].slice(-HISTORY_LIMIT),
        present: nextState,
        future: [] // 새로운 액션이 발생하면 미래(Redo)는 소멸
      };
    }
    this._notify();
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

// 빈 워크스페이스 (클라우드 모드 초기값 — 스테일 로컬/Mock 노출 방지)
export const emptyWorkspace = () => ({
  currentUser: { name: '', team: '' },
  projects: { byId: {}, allIds: [] },
  tasks: { byId: {}, allIds: [] },
});

// 글로벌 Store 인스턴스 (단일 파일 제약상 싱글톤 활용)
// 클라우드 모드에서는 localStorage(church_app_v4)/Mock을 절대 읽지 않는다.
// 로그인 세션이 있으면 서버가 유일한 원본이고, 스테일 로컬 데이터를 보여주면
// 그 '유령' 업무를 저장하려다 PGRST116(0 rows) 같은 오류로 이어진다.
const initialData = (() => {
  if (isCloudEnabled()) return emptyWorkspace();
  try {
    const saved = localStorage.getItem('church_app_v4');
    if (saved) return JSON.parse(saved);
  } catch (e) { console.error(e); }
  return MockFactory.createWorkspace();
})();
export const store = new WorkspaceStore(initialData);

// 컴포넌트가 자신이 필요한 데이터만 구독하도록 만드는 마법의 Hook (useSyncExternalStore 활용)
export function useStore(selector) {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

// 되돌리기 가능 여부도 구독해야 한다 — store.canUndo()를 렌더 중에 그냥 부르면
// 스토어가 바뀌어도 그 컴포넌트가 리렌더되지 않아서, 카드를 옮긴 뒤에도 실행 취소
// 버튼이 계속 비활성으로 남았다.
export const useCanUndo = () => useSyncExternalStore(store.subscribe, store.canUndo);
export const useCanRedo = () => useSyncExternalStore(store.subscribe, store.canRedo);
