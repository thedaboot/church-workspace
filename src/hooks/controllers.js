import { useEffect, useCallback } from 'react';
import { store, useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { TaskService, CONTENT_LOG, contentDiffers } from '../services/domain.js';
import { generateId, taskChangedKeys } from '../utils.js';
import { useAuth } from '../services/auth.jsx';
import * as cloudSync from '../services/cloudSync.js';
import { showToast, HOLD_MS_ACTION } from '../components/Toast.jsx';
import { failText } from '../services/errorText.js';
import { rollbackPatch, createDeleteHold, failedComments, pendingCardFields } from '../services/optimistic.js';
import { openTaskId } from '../modals/taskFocus.js';
import { trashTask } from '../services/trash.js';
import { copyTasks } from '../services/projectCopy.js';
import { LEADERS, CUSTOM, isLeaderOnly, isCustomOnly } from '../services/visibility.js';

// 개발 빌드의 게스트 검사만(tests/modalclose) — `window.__devFail = { task: true, comment: true }`면 그 쓰기를 실패로 본다.
// 게스트는 서버가 없어 실패하는 길이 아예 없다. 배포 빌드에서는 import.meta.env.DEV가 거짓이라 늘 false다(homeView `__kstNow`와 같은 관례).
const devFail = (what) => !!(import.meta.env?.DEV && typeof window !== 'undefined' && window.__devFail?.[what]);

// 클라우드 쓰기 실패 공통 처리.
// 화면에는 사람이 읽을 두 도막(`무엇을 못했다 · 무엇을 하면 된다`)만, 원문은 콘솔에만.
// `what`은 이미 완결된 문장입니다 — 라벨을 괄호로 붙이면 "저장에 실패했어요 (업무 저장)"
// 처럼 같은 말이 두 번 나옵니다(예전 문구).
const reportCloudError = (what) => (err) => {
  console.error(`[cloud] ${what}:`, cloudSync.formatCloudError(err), err);
  showToast(failText(what, err));
};

// ── 업무 삭제 되돌리기 (UX 다듬기 α · 2026-10-15 · PITFALLS 54-b) ─────────────────────────────
// 지우면 화면에서는 바로 빠지고 '되돌리기' 토스트가 뜬다. **클라우드의 서버 삭제는 그 토스트가 걷힐 때까지 붙든다** —
// 되돌리면 아무것도 보내지 않은 셈이다. 붙든 동안 실시간 재조회가 그 업무를 되살리지 않게 하는 것·페이지를 떠날 때 바로 보내는 것은
// services/optimistic.js createDeleteHold. 서버 삭제가 실패하면 지우기 전 모습(댓글·활동·첨부까지)으로 되살리고 토스트로 말한다.
// 0104부터 '서버 삭제'는 휴지통에 넣기다(cloudSync.cardTrashCloud — DB 함수가 없으면 예전 행 삭제로 되돌아간다).
// 게스트는 브라우저 휴지통(services/trash.js)에 지운 순간의 모습을 넣는다.
const deleteHold = createDeleteHold({ store, ms: HOLD_MS_ACTION + 300 });   // 토스트가 걷힌 뒤에 보낸다

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
    // 저장 공간이 가득하거나 막힌 브라우저에서 setItem이 던진다 — 타이머 안이라 잡지 않으면
    // 잡히지 않은 오류로 콘솔에만 남는다. 화면 상태는 그대로 두고 경고만 남긴다.
    const save = () => {
      timer = null;
      try {
        localStorage.setItem('church_app_v4', JSON.stringify(store.getState()));
      } catch (e) {
        console.warn('[guest] 로컬 저장 실패:', e?.message);
      }
    };
    const unsub = store.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(save, 300);
    });
    // 고친 뒤 300ms 안에 탭을 닫으면 그 수정을 잃었다 — 기다리던 저장을 그 자리에서 한다
    const flush = () => { if (timer) { clearTimeout(timer); save(); } };
    window.addEventListener('pagehide', flush);
    return () => { clearTimeout(timer); unsub(); window.removeEventListener('pagehide', flush); };
  }, [cloudOn]);

  // opts.silentContent — 본문을 **조용히** 저장한다(업무 창의 자동 저장 · 같이 쓰기의 거울). 본문 활동
  //   기록과 새 멘션 알림을 여기서 만들지 않는다 — 글자마다 저장되는 길이라 그대로 두면 활동이
  //   글자 수만큼 쌓이고 멘션이 반쯤 친 이름으로 간다. 그 둘은 편집 세션이 끝날 때 한 번
  //   handleContentSession이 한다. 본문 밖의 칸(담당자 등)은 그대로 기록·알림이 간다.
  // opts.onSettled(ok) — 클라우드 쓰기가 끝나면(게스트는 곧바로) 부른다. 업무 창의 '저장됨'이 이것을 본다.
  const handleSaveTask = useCallback((newData, oldData = null, opts = {}) => {
    const { silentContent = false, onSettled } = opts;
    const isNew = !oldData;
    // 새 기록은 만든 자리에서 같이 받는다 — 나중에 스냅샷 두 개를 비교해 되계산하면
    // 그 둘이 어긋날 때 서버에 이미 있는 기록을 다시 넣게 된다(domain.js 주석 참고)
    const { task, logs } = isNew
      ? { task: TaskService.create(newData, currentUser.name), logs: null }
      : TaskService.updateWithLogs(oldData, newData, currentUser.name, { skipContent: silentContent });

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
      const contentChanged = !silentContent && (oldData?.content || '') !== (task.content || '');
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
      // **바뀐 칸만** 보낸다(utils.taskChangedKeys) — 수정 모드 동안 멈춰 있던 스토어 값으로 남이 바꾼
      // 칸을 되돌리지 않게. 견주는 것은 부르는 쪽이 준 이전 카드(oldData)다.
      // 카드 쓰기 자체가 실패했을 때만 화면을 되돌린다(cardOk) — 뒤따르는 활동·알림이 실패한 것은 카드가 이미 저장된 것이다.
      // 되돌리는 칸은 상태·순서뿐이다(services/optimistic.js 머리말 — 제목·본문은 창의 초안이 원본).
      let cardOk = false;
      const changed = taskChangedKeys(task, oldData);
      // 쓰는 동안 이 칸은 실시간 재조회가 옛 값으로 덮지 않는다(services/optimistic.pendingCardFields · PITFALLS 70-a)
      const endPending = isNew ? () => {} : pendingCardFields.begin(task.id, changed || []);
      cloudSync.cardUpsertCloud(task, isNew, { changed, base: oldData })
        .finally(endPending)
        // 활동 줄이 실패해도 멘션·담당자 알림은 보낸다(감사 2026-10-23 — 한 줄로 이어져 있어 알림까지 건너뛰었다)
        .then(() => { cardOk = true; return addedLogs.length && cloudSync.activityAddCloud(addedLogs, task.projectId, task.id).catch(reportCloudError('활동 기록을 남기지 못했어요')); })
        .then(() => mentionIds.length && cloudSync.notifyMentions(task.content, {
          actorName: currentUser.name, cardId: task.id, projectId: task.projectId, recipientIds: mentionIds,
        }))
        .then(() => assignIds.length && cloudSync.notifyAssignees(assignIds, {
          actorName: currentUser.name, cardId: task.id, projectId: task.projectId, preview: task.title,
        }))
        .then(() => onSettled?.(true), (e) => {
          // onSettled(false)는 **카드 쓰기가 실패했을 때만** — 업무 창이 그 칸을 '못 간 칸'으로 기억했다가 다시 보낸다
          // (services/optimistic.createSaveRetry). 뒤따른 활동·알림만 실패했으면 카드는 이미 저장됐다.
          onSettled?.(cardOk);
          if (!cardOk && !isNew) {
            const live = store.getState().tasks.byId[task.id];
            const back = rollbackPatch({ wrote: task, prev: oldData, live });
            if (back) store.dispatch({ type: 'SYNC_TASK', payload: back });
            // 이 저장이 붙인 활동 줄도 걷는다 — 서버에 안 갔고, 다시 보낼 때 그 저장이 같은 줄을 새로 만든다(두 줄이 서지 않게)
            if (logs?.length && live?.activityLog) {
              const drop = new Set(logs.map(l => l.id));
              store.dispatch({ type: 'SYNC_TASK', payload: { id: task.id, activityLog: live.activityLog.filter(l => !drop.has(l.id)) } });
            }
          }
          reportCloudError('업무를 저장하지 못했어요')(e);
        });
    } else {
      onSettled?.(!devFail('task'));
    }
    // 창에 돌려주는 것도 **스토어의 살아 있는 카드**다. task를 그대로 주면
    // 폼의 빈 목록이 그대로 화면에 실린다(스토어는 위에서 지켰는데 화면만 비는 꼴).
    return store.getState().tasks.byId[task.id] || task;
  }, [currentUser.name, cloudOn]);

  // 본문 편집 세션 하나가 끝났다(같이 쓰기의 onVersion · 게스트는 창을 닫을 때) — 본문 기록 **한 줄**과
  // 이 세션에서 새로 생긴 멘션의 알림. 저장 자체는 이미 조용히 끝났다(handleSaveTask의 silentContent).
  // 카드는 스토어의 지금 것을 쓴다 — 창이 닫힌 뒤에 불려도 된다(같이 쓰기는 닫을 때 세션을 끝낸다).
  const handleContentSession = useCallback((cardId, startMd, endMd) => {
    const task = store.getState().tasks.byId[cardId];
    if (!task || !contentDiffers(startMd, endMd)) return;
    const updated = TaskService.addActivity(task, CONTENT_LOG, currentUser.name);
    const entry = updated.activityLog[updated.activityLog.length - 1];
    // 목록만 붙인다(SYNC_TASK) — 카드 통째로 넣으면 그 사이 온 칸을 옛 값으로 덮는다(§6-22)
    store.dispatch({ type: 'SYNC_TASK', payload: { id: cardId, activityLog: updated.activityLog } });
    if (!cloudOn) return;
    const mentionIds = cloudSync.newMentionsOnly(endMd, startMd, currentUser.name);
    cloudSync.activityAddCloud([entry], task.projectId, cardId)
      .then(() => mentionIds.length && cloudSync.notifyMentions(endMd, {
        actorName: currentUser.name, cardId, projectId: task.projectId, recipientIds: mentionIds,
      }))
      .catch(reportCloudError('활동 기록을 남기지 못했어요'));
  }, [currentUser.name, cloudOn]);

  // 댓글 — 화면에 먼저 세우고 서버가 뒤따른다. **댓글 행 쓰기가 실패하면** 그 댓글을 '못 보낸 댓글'로 적는다
  // (services/optimistic.failedComments · UX 다듬기 2차 A1) — 목록이 그 자리에 흐리게 세우고 '다시 보내기'를 단다. 다시 보내기는
  // 아래 send를 그대로 다시 부른다(같은 id · 활동 줄 · 알림까지). 그 업무 창이 닫혀 있을 때만 토스트로도 말한다.
  // 뒤따르는 활동·알림이 실패한 것은 댓글이 이미 들어간 것이다 — 활동 쪽 토스트만.
  const handleAddComment = useCallback((task, text, parentId = null) => {
    const updated = TaskService.addComment(task, text, currentUser.name, parentId);
    store.dispatch({ type: 'UPSERT_TASK', payload: updated });
    const newComment = updated.comments[updated.comments.length - 1];
    const addedLogs = (updated.activityLog || []).slice((task.activityLog || []).length);
    // 답글이면 원 댓글 작성자에게도 알림 (본인 댓글에 본인이 답글 단 경우는 제외 — notifyComment가 처리)
    const parent = parentId ? (task.comments || []).find(c => c.id === parentId) : null;
    // 활동 줄이 실패해도 댓글 알림(멘션·답글·담당자)은 보낸다(감사 2026-10-23)
    const after = () => (addedLogs.length ? cloudSync.activityAddCloud(addedLogs, task.projectId, task.id).catch(reportCloudError('활동 기록을 남기지 못했어요')) : Promise.resolve())
      .then(() => cloudSync.notifyComment(text, {
        actorName: currentUser.name, cardId: task.id, projectId: task.projectId,
        replyToName: parent?.author, assignees: task.assignees,
      }))
      .catch(reportCloudError('활동 기록을 남기지 못했어요'));
    const send = () => (cloudOn ? cloudSync.commentAddCloud(newComment, task.id)
      : devFail('comment') ? Promise.reject(new Error('dev: comment')) : Promise.resolve())
      .then(() => {
        // 다시 보낸 사이 실시간 재조회가 목록을 갈아 끼웠으면 그 댓글을 다시 붙인다(곧 올 실시간이 서버 것으로 맞춘다)
        const live = store.getState().tasks.byId[task.id];
        if (live && !(live.comments || []).some(c => c.id === newComment.id)) {
          store.dispatch({ type: 'SYNC_TASK', payload: { id: task.id, comments: [...(live.comments || []), newComment] } });
        }
        if (cloudOn) after();
      });
    send().catch((e) => {
      console.error('[cloud] 댓글을 남기지 못했어요:', cloudSync.formatCloudError(e), e);
      failedComments.add(task.id, newComment, send);
      if (openTaskId() !== task.id) showToast(failText('댓글을 남기지 못했어요', e));
    });
    return updated;
  }, [currentUser.name, cloudOn]);

  const handleUpdateComment = useCallback((task, commentId, newText) => {
    const updated = TaskService.updateComment(task, commentId, newText, currentUser.name);
    if (updated === task) return task; // 내용이 그대로 → 아무 것도 기록·저장하지 않는다
    store.dispatch({ type: 'UPSERT_TASK', payload: updated });
    if (cloudOn) {
      const addedLogs = (updated.activityLog || []).slice((task.activityLog || []).length);
      // 고치며 새로 부른 사람에게만 멘션 알림(본문 저장과 같은 newMentionsOnly — 이미 부른 사람에게 다시 가지 않는다 · 감사 2026-10-23)
      const before = (task.comments || []).find(c => c.id === commentId)?.text || '';
      const mentionIds = cloudSync.newMentionsOnly(newText, before, currentUser.name);
      cloudSync.commentUpdateCloud(commentId, newText)
        .then(() => addedLogs.length && cloudSync.activityAddCloud(addedLogs, task.projectId, task.id).catch(reportCloudError('활동 기록을 남기지 못했어요')))
        .then(() => mentionIds.length && cloudSync.notifyMentions(newText, { actorName: currentUser.name, cardId: task.id, projectId: task.projectId, recipientIds: mentionIds }))
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
        .catch(reportCloudError('댓글을 지우지 못했어요'));
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

  // 지우기 — 화면에서 바로 빼고 '되돌리기' 토스트(머리의 '업무 삭제 되돌리기'). 게스트는 서버가 없어 되살리기만 한다.
  const handleDeleteTask = useCallback((task) => {
    if (!task?.id) return;
    const id = task.id;
    // 되살릴 모습은 스토어의 지금 카드다 — 창을 연 뒤에 채워진 댓글·활동·첨부까지(§6-22)
    const snap = store.getState().tasks.byId[id] || task;
    store.dispatch({ type: 'DELETE_TASK', payload: id });
    if (!cloudOn) trashTask(snap, currentUser.name);
    const restore = () => { if (!store.getState().tasks.byId[id]) store.dispatch({ type: 'UPSERT_TASK', payload: snap }); };
    if (cloudOn) {
      deleteHold.hold(id, () => cloudSync.cardTrashCloud(id).catch((e) => { restore(); reportCloudError('업무를 삭제하지 못했어요')(e); }));
    }
    showToast(`'${snap.title}'을(를) 삭제했어요`, {
      label: '되돌리기',
      onAction: () => {
        if (cloudOn) {
          if (!deleteHold.cancel(id)) { showToast('이미 삭제되어 되돌릴 수 없어요'); return; }
          restore();
          // 붙든 동안 남이 바꾼 칸이 있으면 받아 온다(그동안 온 실시간은 deleteHold가 버렸다)
          cloudSync.loadCardPatch(id).then(p => p && store.dispatch({ type: 'SYNC_TASK', payload: p }))
            .catch(e => console.warn('[cloud] 되살린 업무 다시 읽기 실패:', e));
          return;
        }
        restore();
      },
    });
  }, [cloudOn, currentUser.name]);

  // 보드 컬럼 안 순서(0024). 바뀐 카드만 넘어온다 — 화면은 바로 바꾸고 클라우드는 뒤따른다.
  // SYNC_TASK로 병합한다(UPSERT_TASK로 바꾸면 담아둔 댓글·활동·첨부가 날아간다 — §6-22).
  // 실패하면 그 사이 다시 옮기지 않은 카드만 옛 자리로(services/optimistic.js).
  const handleReorderTasks = useCallback((orders) => {
    const byId = store.getState().tasks.byId;
    const changed = orders.filter(({ id, position }) => {
      const t = byId[id];
      return t && (t.position ?? 0) !== position;
    });
    if (!changed.length) return;
    const before = changed.map(({ id }) => ({ id, position: byId[id].position }));
    changed.forEach(({ id, position }) => store.dispatch({ type: 'SYNC_TASK', payload: { id, position } }));
    if (!cloudOn) return;
    // 순서를 다 쓸 때까지 그 카드들의 자리는 실시간 재조회가 옛 값으로 덮지 않는다 — 끌어 놓으면 상태 저장의 에코(+200ms)가
    // 옛 position을 들고 와 카드가 옛 칸으로 튀었다가 돌아왔다(services/optimistic.pendingCardFields · PITFALLS 70-a)
    const ends = changed.map(({ id }) => pendingCardFields.begin(id, ['position']));
    cloudSync.cardOrderCloud(changed).finally(() => ends.forEach(end => end())).catch((e) => {
      changed.forEach((wrote, i) => {
        const back = rollbackPatch({ wrote, prev: before[i], live: store.getState().tasks.byId[wrote.id], keys: ['position'] });
        if (back) store.dispatch({ type: 'SYNC_TASK', payload: back });
      });
      reportCloudError('업무 순서를 저장하지 못했어요')(e);
    });
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
    // 못 만들었으면 스토어에서도 뺀다 — 그 화면(ProjectView)은 프로젝트가 없어지면 대시보드로 나간다
    if (cloudOn) cloudSync.projectCreateCloud(newProject).catch((e) => {
      store.dispatch({ type: 'DELETE_PROJECT', payload: newProject.id });
      reportCloudError('프로젝트를 만들지 못했어요')(e);
    });
    return newProject.id;
  }, [cloudOn]);

  // 프로젝트 복제(사용자 승인 시안 2026-10-17 · 규칙은 services/projectCopy.js) — 새 프로젝트를 고른 해에 만들고 업무의 짜임새만 옮긴다.
  // 만든 사람·생성 기록은 복제한 사람으로 새로 붙는다(TaskService.create). id는 copyTasks가 미리 정한 것을 지킨다 — create가 새로
  // 뽑으면 선후관계(dependsOn)가 옛 id를 가리킨다. **리더만 보는 원본이면 새 프로젝트도 리더만**(0092 · 아니면 리더 업무의 본문이
  // 공개 프로젝트로 옮겨 간다 — 리더가 아니면 DB 트리거가 'all'로 되돌리지만 리더 프로젝트는 애초에 리더만 연다).
  // 직접 선택 원본은 새 프로젝트도 같은 고른 사람으로(리더가 아니면 클라우드는 만들지 않고 실패 토스트 · projectCreateCloud).
  // 클라우드: 프로젝트가 먼저 서야 업무가 들어간다. 프로젝트를 못 만들면 스토어에서 통째로 빼고, 업무 일부를 못 넣으면 그 업무만 뺀다.
  const handleDuplicateProject = useCallback((srcId, title, year) => {
    const st = store.getState();
    const src = st.projects.byId[srcId];
    if (!src) return null;
    // 새 프로젝트 — handleAddProject와 같은 모양(맨 뒤 position · 고른 해)
    const positions = Object.values(st.projects.byId).map(p => p.position ?? 0);
    const newProject = {
      id: generateId(), title, pinnedLinks: [],
      position: (positions.length ? Math.max(...positions) : 0) + 1,
      createdAt: new Date().toISOString(),
      year: year || new Date().getFullYear(),
      ...(isLeaderOnly(src) ? { visibility: LEADERS } : {}),
      // 직접 선택(0105) 원본은 같은 고른 사람·팀 칩으로(합치기 2026-10-17 — 'all'로 베끼면 고른 사람만 보던 업무가 모두에게 간다)
      ...(isCustomOnly(src) ? { visibility: CUSTOM, viewers: [...(src.viewers || [])], viewerTeams: [...(src.viewerTeams || [])] } : {}),
    };
    store.dispatch({ type: 'ADD_PROJECT', payload: newProject });
    const tasks = st.tasks.allIds.map(id => st.tasks.byId[id]).filter(t => t.projectId === srcId);
    const made = copyTasks(tasks, newProject.id, generateId).map(d => ({ ...TaskService.create(d, currentUser.name), id: d.id }));
    made.forEach(t => store.dispatch({ type: 'UPSERT_TASK', payload: t }));
    if (cloudOn) {
      cloudSync.projectCreateCloud(newProject)
        .then(() => Promise.allSettled(made.map(t => cloudSync.cardUpsertCloud(t, true)
          .then(() => cloudSync.activityAddCloud(t.activityLog || [], t.projectId, t.id)))))
        .then((results) => {
          const failed = results.map((r, i) => (r.status === 'rejected' ? made[i].id : null)).filter(Boolean);
          if (!failed.length) return;
          failed.forEach(id => store.dispatch({ type: 'DELETE_TASK', payload: id }));
          reportCloudError('프로젝트를 복제하지 못했어요')(results.find(r => r.status === 'rejected').reason);
        }, (e) => {
          store.dispatch({ type: 'DELETE_PROJECT', payload: newProject.id });
          reportCloudError('프로젝트를 복제하지 못했어요')(e);
        });
    }
    return newProject.id;
  }, [cloudOn, currentUser.name]);

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
    // 실패하면 그 사이 다시 누르지 않았을 때만 되돌린다
    if (cloudOn) cloudSync.projectArchiveCloud(id, archived).catch((e) => {
      if (!!store.getState().projects.byId[id]?.archived === !!archived) store.dispatch({ type: 'UPDATE_PROJECT', payload: { id, archived: !archived } });
      reportCloudError(archived ? '프로젝트를 보관하지 못했어요' : '보관을 풀지 못했어요')(e);
    });
  }, [cloudOn]);

  const handleUpdateUser = useCallback((profile) => {
    store.dispatch({ type: 'UPDATE_USER', payload: profile });
    if (cloudOn) cloudSync.profileUpdateCloud(profile).catch(reportCloudError('내 정보를 저장하지 못했어요'));
  }, [cloudOn]);

  return { handleSaveTask, handleContentSession, handleReorderTasks, handleDeleteTask, handleAddComment, handleUpdateComment, handleDeleteComment, handleFileActivity, handleAddProject, handleDuplicateProject, handleRenameProject, handleArchiveProject, handleUpdateUser, undo: store.undo, redo: store.redo };
};

