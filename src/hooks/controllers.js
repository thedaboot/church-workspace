import { useEffect, useCallback } from 'react';
import { store, useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { TaskService } from '../services/domain.js';
import { generateId } from '../utils.js';
import { useAuth } from '../services/auth.jsx';
import * as cloudSync from '../services/cloudSync.js';
import { showToast } from '../components/Toast.jsx';
import { failText } from '../services/errorText.js';

// 클라우드 쓰기 실패 공통 처리.
// 화면에는 사람이 읽을 두 도막(`무엇을 못했다 · 무엇을 하면 된다`)만, 원문은 콘솔에만.
// `what`은 이미 완결된 문장입니다 — 라벨을 괄호로 붙이면 "저장에 실패했어요 (업무 저장)"
// 처럼 같은 말이 두 번 나옵니다(예전 문구).
const reportCloudError = (what) => (err) => {
  console.error(`[cloud] ${what}:`, cloudSync.formatCloudError(err), err);
  showToast(failText(what, err));
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
    // 새 기록은 만든 자리에서 같이 받는다 — 나중에 스냅샷 두 개를 비교해 되계산하면
    // 그 둘이 어긋날 때 서버에 이미 있는 기록을 다시 넣게 된다(domain.js 주석 참고)
    const { task, logs } = isNew
      ? { task: TaskService.create(newData, currentUser.name), logs: null }
      : TaskService.updateWithLogs(oldData, newData, currentUser.name);

    if (isNew) {
      store.dispatch({ type: 'UPSERT_TASK', payload: task });
    } else {
      // **수정 폼이 들고 있는 댓글·활동·첨부로 스토어를 덮지 않는다.**
      // 폼(formData)은 '수정'을 누른 순간의 스냅샷이라, 그때 아직 안 왔거나 그 뒤에
      // 도착한 목록을 모른다. 클라우드에서는 댓글·활동을 창을 열 때 따로 읽으므로
      // (§6-20) 폼에는 빈 배열이 실려 있기 십상이고, 통째로 교체하면 **저장하는
      // 순간 댓글과 활동 기록이 화면에서 사라진다**(사용자 지적. 다시 들어가면
      // loadCardDetail이 다시 읽어 와서 "나갔다 오면 보인다"가 된다).
      // §6-22가 경고한 그 자리다 — 목록 세 가지는 스토어의 것이 원본이다.
      const { comments, activityLog, attachments, ...patch } = task;
      store.dispatch({ type: 'SYNC_TASK', payload: patch });
      // 이번에 생긴 활동 기록만 살아 있는 목록 **뒤에** 붙인다
      if (logs?.length) {
        const live = store.getState().tasks.byId[task.id];
        store.dispatch({ type: 'SYNC_TASK', payload: { id: task.id, activityLog: [...(live?.activityLog || []), ...logs] } });
      }
    }
    if (cloudOn) {
      // 새 카드는 생성 기록 하나가 전부다
      const addedLogs = logs ?? (task.activityLog || []);
      // 상세 내용이 바뀐 경우, 이전 본문에 없던 새 멘션만 알림
      const contentChanged = (oldData?.content || '') !== (task.content || '');
      const mentionIds = contentChanged
        ? cloudSync.newMentionsOnly(task.content, oldData?.content, currentUser.name)
        : [];
      // 담당자로 새로 붙은 사람에게만 — 새 카드면 담당자 전원이 '새로 붙은' 것이다
      const assignIds = cloudSync.newAssigneesOnly(task.assignees, oldData?.assignees, currentUser.name);
      // 업무 제목이 바뀌면 드라이브 폴더 이름도 따라간다(0026). 폴더가 아직 없으면
      // 아무 일도 하지 않는다 — 파일을 한 번도 안 올린 업무에 빈 폴더를 만들 이유가
      // 없다. 실패해도 저장 자체는 성공이다(드라이브 미설정 환경도 있다).
      const folderId = oldData?.driveFolderId;
      if (folderId && oldData?.title !== task.title) {
        cloudSync.renameCardFolder(folderId, task.title);
      }
      cloudSync.cardUpsertCloud(task, isNew)
        .then(() => addedLogs.length && cloudSync.activityAddCloud(addedLogs, task.projectId, task.id))
        .then(() => mentionIds.length && cloudSync.notifyMentions(task.content, {
          actorName: currentUser.name, cardId: task.id, projectId: task.projectId, recipientIds: mentionIds,
        }))
        .then(() => assignIds.length && cloudSync.notifyAssignees(assignIds, {
          actorName: currentUser.name, cardId: task.id, projectId: task.projectId, preview: task.title,
        }))
        .catch(reportCloudError('업무를 저장하지 못했어요'));
    }
    // 창에 돌려주는 것도 **스토어의 살아 있는 카드**다. task를 그대로 주면
    // 폼의 빈 목록이 그대로 화면에 실린다(스토어는 위에서 지켰는데 화면만 비는 꼴).
    return store.getState().tasks.byId[task.id] || task;
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
        .catch(reportCloudError('댓글을 남기지 못했어요'));
    }
    return updated;
  }, [currentUser.name, cloudOn]);

  const handleUpdateComment = useCallback((task, commentId, newText) => {
    const updated = TaskService.updateComment(task, commentId, newText, currentUser.name);
    if (updated === task) return task; // 내용이 그대로 → 아무 것도 기록·저장하지 않는다
    store.dispatch({ type: 'UPSERT_TASK', payload: updated });
    if (cloudOn) {
      const addedLogs = (updated.activityLog || []).slice((task.activityLog || []).length);
      cloudSync.commentUpdateCloud(commentId, newText)
        .then(() => addedLogs.length && cloudSync.activityAddCloud(addedLogs, task.projectId, task.id))
        .catch(reportCloudError('댓글을 고치지 못했어요'));
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
      cloudSync.activityAddCloud([entry], task.projectId, task.id).catch(reportCloudError('활동 기록을 남기지 못했어요'));
    }
    return updated;
  }, [currentUser.name, cloudOn]);

  const handleDeleteTask = useCallback((task) => {
    if (!task?.id) return;
    store.dispatch({ type: 'DELETE_TASK', payload: task.id });
    if (cloudOn) cloudSync.cardDeleteCloud(task.id).catch(reportCloudError('업무를 삭제하지 못했어요'));
  }, [cloudOn]);

  // 보드 컬럼 안 순서(0024). 바뀐 카드만 넘어온다 — 화면은 바로 바꾸고 클라우드는 뒤따른다.
  // SYNC_TASK로 병합한다(UPSERT_TASK로 바꾸면 담아둔 댓글·활동·첨부가 날아간다 — §6-22).
  const handleReorderTasks = useCallback((orders) => {
    const changed = orders.filter(({ id, position }) => {
      const t = store.getState().tasks.byId[id];
      return t && (t.position ?? 0) !== position;
    });
    if (!changed.length) return;
    changed.forEach(({ id, position }) => store.dispatch({ type: 'SYNC_TASK', payload: { id, position } }));
    if (cloudOn) cloudSync.cardOrderCloud(changed).catch(reportCloudError('업무 순서를 저장하지 못했어요'));
  }, [cloudOn]);

  const handleAddProject = useCallback((title, year) => {
    // position: 맨 뒤(가장 큰 값 + 1). createdAt은 활동 기록·정렬 2차 키가 쓴다.
    // year는 **만든 날짜에서 뽑지 않는다**(0025) — 해가 바뀌기 전에 미리 만드는
    // 프로젝트가 엉뚱한 해에 들어갔다. 창이 이름 앞 네 자리를 따라 채워 준다.
    const positions = Object.values(store.getState().projects.byId).map(p => p.position ?? 0);
    const newProject = {
      id: generateId(), title, pinnedLinks: [],
      position: (positions.length ? Math.max(...positions) : 0) + 1,
      createdAt: new Date().toISOString(),
      year: year || new Date().getFullYear(),
    };
    store.dispatch({ type: 'ADD_PROJECT', payload: newProject });
    if (cloudOn) cloudSync.projectCreateCloud(newProject).catch(reportCloudError('프로젝트를 만들지 못했어요'));
    return newProject.id;
  }, [cloudOn]);

  const handleRenameProject = useCallback((id, title, year) => {
    const next = String(title || '').trim();
    if (!next) return;
    const patch = { id, title: next, ...(year ? { year } : {}) };
    store.dispatch({ type: 'UPDATE_PROJECT', payload: patch });
    if (cloudOn) cloudSync.projectRenameCloud(id, next, year).catch(reportCloudError('프로젝트를 저장하지 못했어요'));
  }, [cloudOn]);

  // 프로젝트 보관/해제 — 지우는 것이 아니라 탭·대시보드에서만 빼는 것이다.
  // 안에 있는 업무는 그대로 남고 검색·보관함으로 계속 닿는다.
  const handleArchiveProject = useCallback((id, archived) => {
    store.dispatch({ type: 'UPDATE_PROJECT', payload: { id, archived } });
    if (cloudOn) cloudSync.projectArchiveCloud(id, archived).catch(reportCloudError(archived ? '프로젝트를 보관하지 못했어요' : '보관을 풀지 못했어요'));
  }, [cloudOn]);

  const handleUpdateUser = useCallback((profile) => {
    store.dispatch({ type: 'UPDATE_USER', payload: profile });
    if (cloudOn) cloudSync.profileUpdateCloud(profile).catch(reportCloudError('내 정보를 저장하지 못했어요'));
  }, [cloudOn]);

  return { handleSaveTask, handleReorderTasks, handleDeleteTask, handleAddComment, handleUpdateComment, handleDeleteComment, handleFileActivity, handleAddProject, handleRenameProject, handleArchiveProject, handleUpdateUser, undo: store.undo, redo: store.redo };
};

