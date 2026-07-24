import { useState, useEffect, useCallback } from 'react';
import { store, useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { TaskService } from '../services/domain.js';
import { generateId } from '../utils.js';
import { CloudRepository } from '../services/cloud.js';
import { useAuth } from '../services/auth.jsx';
import * as cloudSync from '../services/cloudSync.js';

// 클라우드 쓰기 실패 공통 처리(콘솔 + 간단 알림)
const reportCloudError = (label) => (err) => {
  console.error(`[cloud] ${label} 실패:`, err);
  if (typeof window !== 'undefined') window.alert(`클라우드 저장에 실패했어요 (${label}). 잠시 후 다시 시도해 주세요.`);
};

// ============================================================================
// 8. Controllers (비즈니스 로직 훅)
// ============================================================================
export const useWorkspaceController = () => {
  const currentUser = useStore(selectCurrentUser);
  const { enabled, session } = useAuth();
  const cloudOn = enabled && !!session;

  // 로컬 스토리지 자동 저장 (게스트 모드에서만 — 클라우드 모드에선 서버가 원본,
  // 로컬 church_app_v4는 이관 소스로 보존해야 하므로 덮어쓰지 않는다)
  useEffect(() => {
    if (cloudOn) return;
    const timer = setTimeout(() => {
      localStorage.setItem('church_app_v4', JSON.stringify(store.getState()));
    }, 500);
    return () => clearTimeout(timer);
  });

  const handleSaveTask = useCallback((newData, oldData = null) => {
    const isNew = !oldData;
    const task = isNew ? TaskService.create(newData, currentUser.name) : TaskService.update(oldData, newData, currentUser.name);
    store.dispatch({ type: 'UPSERT_TASK', payload: task });
    if (cloudOn) {
      const addedLogs = (task.activityLog || []).slice((oldData?.activityLog || []).length);
      cloudSync.cardUpsertCloud(task, isNew)
        .then(() => addedLogs.length && cloudSync.activityAddCloud(addedLogs, task.projectId, task.id))
        .catch(reportCloudError('작업 저장'));
    }
    return task;
  }, [currentUser.name, cloudOn]);

  const handleAddComment = useCallback((task, text, parentId = null) => {
    const updated = TaskService.addComment(task, text, currentUser.name, parentId);
    store.dispatch({ type: 'UPSERT_TASK', payload: updated });
    if (cloudOn) {
      const newComment = updated.comments[updated.comments.length - 1];
      cloudSync.commentAddCloud(newComment, task.id).catch(reportCloudError('댓글 등록'));
    }
    return updated;
  }, [currentUser.name, cloudOn]);

  const handleUpdateComment = useCallback((task, commentId, newText) => {
    const updated = TaskService.updateComment(task, commentId, newText);
    store.dispatch({ type: 'UPSERT_TASK', payload: updated });
    if (cloudOn) cloudSync.commentUpdateCloud(commentId, newText).catch(reportCloudError('댓글 수정'));
    return updated;
  }, [cloudOn]);

  const handleDeleteComment = useCallback((task, commentId) => {
    const updated = TaskService.deleteComment(task, commentId, currentUser.name);
    store.dispatch({ type: 'UPSERT_TASK', payload: updated });
    if (cloudOn) {
      const addedLogs = (updated.activityLog || []).slice((task.activityLog || []).length);
      cloudSync.commentDeleteCloud(commentId)
        .then(() => addedLogs.length && cloudSync.activityAddCloud(addedLogs, task.projectId, task.id))
        .catch(reportCloudError('댓글 삭제'));
    }
    return updated;
  }, [currentUser.name, cloudOn]);

  const handleAddProject = useCallback((title) => {
    const newProject = { id: generateId(), title, pinnedLinks: [] };
    store.dispatch({ type: 'ADD_PROJECT', payload: newProject });
    if (cloudOn) cloudSync.projectCreateCloud(newProject).catch(reportCloudError('프로젝트 생성'));
    return newProject.id;
  }, [cloudOn]);

  const handleUpdateUser = useCallback((profile) => {
    store.dispatch({ type: 'UPDATE_USER', payload: profile });
    if (cloudOn) cloudSync.profileUpdateCloud(profile).catch(reportCloudError('프로필 저장'));
  }, [cloudOn]);

  return { handleSaveTask, handleAddComment, handleUpdateComment, handleDeleteComment, handleAddProject, handleUpdateUser, undo: store.undo, redo: store.redo };
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
