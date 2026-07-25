import { useState, useEffect, useCallback } from 'react';
import { store, useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { TaskService } from '../services/domain.js';
import { generateId } from '../utils.js';
import { CloudRepository } from '../services/cloud.js';
import { useAuth } from '../services/auth.jsx';
import * as cloudSync from '../services/cloudSync.js';
import { showToast } from '../components/Toast.jsx';

// 클라우드 쓰기 실패 공통 처리(콘솔 전체 에러 + 원인 노출 알림)
const reportCloudError = (label) => (err) => {
  console.error(`[cloud] ${label} 실패:`, err);
  showToast(`저장에 실패했어요 (${label}) · ${cloudSync.formatCloudError(err)}`);
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
  // 리렌더가 아니라 store 구독으로 저장한다 — 뷰가 메모이제이션돼 리렌더 없이
  // 상태만 바뀌는 경우(예: 드래그로 상태 변경)에도 유실 없이 저장되도록.
  useEffect(() => {
    if (cloudOn) return;
    let timer = null;
    const unsub = store.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        localStorage.setItem('church_app_v4', JSON.stringify(store.getState()));
      }, 300);
    });
    return () => { clearTimeout(timer); unsub(); };
  }, [cloudOn]);

  const handleSaveTask = useCallback((newData, oldData = null) => {
    const isNew = !oldData;
    const task = isNew ? TaskService.create(newData, currentUser.name) : TaskService.update(oldData, newData, currentUser.name);
    store.dispatch({ type: 'UPSERT_TASK', payload: task });
    if (cloudOn) {
      const addedLogs = (task.activityLog || []).slice((oldData?.activityLog || []).length);
      // 상세 내용이 바뀐 경우, 이전 본문에 없던 새 멘션만 알림
      const contentChanged = (oldData?.content || '') !== (task.content || '');
      const mentionIds = contentChanged
        ? cloudSync.newMentionsOnly(task.content, oldData?.content, currentUser.name)
        : [];
      cloudSync.cardUpsertCloud(task, isNew)
        .then(() => addedLogs.length && cloudSync.activityAddCloud(addedLogs, task.projectId, task.id))
        .then(() => mentionIds.length && cloudSync.notifyMentions(task.content, {
          actorName: currentUser.name, cardId: task.id, projectId: task.projectId, recipientIds: mentionIds,
        }))
        .catch(reportCloudError('업무 저장'));
    }
    return task;
  }, [currentUser.name, cloudOn]);

  const handleAddComment = useCallback((task, text, parentId = null) => {
    const updated = TaskService.addComment(task, text, currentUser.name, parentId);
    store.dispatch({ type: 'UPSERT_TASK', payload: updated });
    if (cloudOn) {
      const newComment = updated.comments[updated.comments.length - 1];
      const addedLogs = (updated.activityLog || []).slice((task.activityLog || []).length);
      // 답글이면 원 댓글 작성자에게도 알림 (본인 댓글에 본인이 답글 단 경우는 제외 — notifyComment가 처리)
      const parent = parentId ? (task.comments || []).find(c => c.id === parentId) : null;
      cloudSync.commentAddCloud(newComment, task.id)
        .then(() => addedLogs.length && cloudSync.activityAddCloud(addedLogs, task.projectId, task.id))
        .then(() => cloudSync.notifyComment(text, {
          actorName: currentUser.name, cardId: task.id, projectId: task.projectId,
          replyToName: parent?.author,
        }))
        .catch(reportCloudError('댓글 등록'));
    }
    return updated;
  }, [currentUser.name, cloudOn]);

  const handleUpdateComment = useCallback((task, commentId, newText) => {
    const updated = TaskService.updateComment(task, commentId, newText, currentUser.name);
    store.dispatch({ type: 'UPSERT_TASK', payload: updated });
    if (cloudOn) {
      const addedLogs = (updated.activityLog || []).slice((task.activityLog || []).length);
      cloudSync.commentUpdateCloud(commentId, newText)
        .then(() => addedLogs.length && cloudSync.activityAddCloud(addedLogs, task.projectId, task.id))
        .catch(reportCloudError('댓글 수정'));
    }
    return updated;
  }, [currentUser.name, cloudOn]);

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

  // 첨부 업로드/삭제 시 활동 로그(로컬 반영 + 클라우드 activity 미러링)
  const handleFileActivity = useCallback((task, action) => {
    const updated = TaskService.addActivity(task, action, currentUser.name);
    store.dispatch({ type: 'UPSERT_TASK', payload: updated });
    if (cloudOn) {
      const entry = updated.activityLog[updated.activityLog.length - 1];
      cloudSync.activityAddCloud([entry], task.projectId, task.id).catch(reportCloudError('활동 기록'));
    }
    return updated;
  }, [currentUser.name, cloudOn]);

  const handleDeleteTask = useCallback((task) => {
    if (!task?.id) return;
    store.dispatch({ type: 'DELETE_TASK', payload: task.id });
    if (cloudOn) cloudSync.cardDeleteCloud(task.id).catch(reportCloudError('업무 삭제'));
  }, [cloudOn]);

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

  return { handleSaveTask, handleDeleteTask, handleAddComment, handleUpdateComment, handleDeleteComment, handleFileActivity, handleAddProject, handleUpdateUser, undo: store.undo, redo: store.redo };
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
