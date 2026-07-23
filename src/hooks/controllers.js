import { useState, useEffect, useCallback } from 'react';
import { store, useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { TaskService } from '../services/domain.js';
import { generateId } from '../utils.js';
import { CloudRepository } from '../services/cloud.js';

// ============================================================================
// 8. Controllers (비즈니스 로직 훅)
// ============================================================================
export const useWorkspaceController = () => {
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

  const handleAddComment = useCallback((task, text, parentId = null) => {
    const updated = TaskService.addComment(task, text, currentUser.name, parentId);
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

export const usePersistenceController = () => {
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
