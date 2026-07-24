import { useSyncExternalStore } from 'react';
import { MockFactory } from '../services/domain.js';

// ============================================================================
// 5. State Management: Custom Store (Zustand/Redux 아키텍처)
// ============================================================================
// 순수 React Context의 한계(전체 리렌더링)를 극복하고 Undo/Redo 기능을 탑재한 커스텀 Store
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
export const store = new WorkspaceStore(initialData);

// 컴포넌트가 자신이 필요한 데이터만 구독하도록 만드는 마법의 Hook (useSyncExternalStore 활용)
export function useStore(selector) {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
