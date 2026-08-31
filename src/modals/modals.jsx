import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { CheckSquare, Clock, X, User, Hash, Wand2, Undo2, CalendarRange, Trash2, Check, Pin, ArrowLeftRight, Maximize2, Minimize2, PanelRight, PanelRightClose } from 'lucide-react';
import { CONFIG } from '../config.js';
import { formatDate, isMobileViewport, keepVisible, generateId, subtaskProgress, summaryOutdated, toggleTodoLine, byNewest } from '../utils.js';
import { store, useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { AiService, isFallbackText } from '../services/ai.js';
import { RichText } from '../components/RichText.jsx';
import { Bar } from '../views/dashboardParts.jsx';
import { DatePicker } from '../components/DatePicker.jsx';
import { AttachmentSection, PendingAttachments, startUploads } from './attachments.jsx';
import { CommentPanel, ActivityPanel, CommentInput } from './comments.jsx';
// TipTap/ProseMirror는 무거워 초기 번들에서 분리한다 (업무 수정 모드에서만 필요)
const MarkdownEditor = lazy(() => import('../components/MarkdownEditor.jsx').then(m => ({ default: m.MarkdownEditor })));
const EditorSkeleton = () => <div className="min-h-40 md:min-h-56 border border-line rounded-md rounded-t-none dc-skeleton" />;
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { useAuth } from '../services/auth.jsx';
import { getMemberNames, loadCardDetail, cardSummaryCloud, cardWritePromise } from '../services/cloudSync.js';
import { ShareButton } from '../components/ShareButton.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { showToast } from '../components/Toast.jsx';

// ============================================================================
// 업무 창 — 상세 보기 / 수정 폼 / 그 껍데기(TaskModalShell)
// ----------------------------------------------------------------------------
// 같이 뜨는 영역은 파일을 나눠 뒀다:
//   첨부      → attachments.jsx
//   댓글·활동 → comments.jsx
//   내 정보·프로젝트 창 → settings.jsx
// ============================================================================

// 첫 페인트가 끝난 뒤 true — 목록(댓글·활동)처럼 무거운 영역을 첫 커밋에서 빼낸다.
// 마운트 직후 1회만 false→true로 바뀌고 이후 계속 true(탭 전환 시 지연 없음).
function useAfterPaint() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => setReady(true)); });
    return () => cancelAnimationFrame(raf);
  }, []);
  return ready;
}


export function TaskModalShell({ task, isEditMode, onClose, onEdit, onSave, onAddComment, onUpdateComment, onDeleteComment, onFileActivity, onDelete }) {
  const currentUser = useStore(selectCurrentUser);
  const { enabled, session, isAdmin } = useAuth();
  const cloudMode = enabled && !!session;
  const userId = session?.user?.id;
  const [formData, setFormData] = useState(task);
  const [activeTab, setActiveTab] = useState('comments'); // 데스크톱 우측 사이드바 탭
  const [mobileTab, setMobileTab] = useState('detail');    // 모바일 세그먼트 탭
  // 데스크톱 전체 화면 — 본문이 긴 업무를 창 크기(max-w-5xl · 85dvh)에 갇혀 읽는
  // 불편이 있었다. 모바일은 이미 풀스크린이라 버튼을 두지 않는다.
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();
  // 바깥(딤) 클릭으로 닫기 판정용 — 누른 곳도 딤이어야 닫는다
  const overlayRef = useRef(null);
  const downOnOverlay = useRef(false);
  // 댓글·활동 목록은 첫 페인트 이후에 붙인다(열림 체감 속도 우선)
  const listsReady = useAfterPaint();

  // 열려 있는 동안 스토어의 최신 카드를 따라간다 — 다른 사람이 남긴 댓글·활동이
  // 실시간 재조회로 들어와도 모달은 열릴 때의 스냅샷에 갇혀 있어서
  // 새로고침해야 보였다. 수정 모드에서는 입력 중인 폼을 갈아치우면 안 되므로 제외.
  const liveTask = useStore(s => (task.id ? s.tasks.byId[task.id] : null));
  const source = liveTask || task;

  // Stale State 방지: 모달 재사용 시 데이터 강제 동기화
  useEffect(() => { if (!isEditMode) setFormData(source); }, [source, isEditMode]);

  // 댓글·활동은 초기 로드에서 빼두고(목록 화면에는 나오지 않는 데이터다) 창을 열 때
  // 이 카드 것만 읽는다 — 첨부가 이미 쓰고 있던 방식과 같다(AttachmentSection).
  // 읽는 동안은 detailLoading — 패널이 빈 상태("첫 댓글을 남겨보세요!") 대신 스켈레톤을
  // 그린다. 빈 상태가 먼저 번쩍이면 "댓글이 없다"고 잘못 읽힌다.
  const [detailLoading, setDetailLoading] = useState(false);
  useEffect(() => {
    if (!cloudMode || !task.id) return;
    let alive = true;
    setDetailLoading(true);
    loadCardDetail(task.id)
      .then(detail => { if (alive) store.dispatch({ type: 'SYNC_TASK', payload: { id: task.id, ...detail } }); })
      .catch(e => console.error('[cloud] 업무 상세 로드 실패:', e))
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [cloudMode, task.id]);

  // 삭제 노출 조건: 저장된 카드 + (게스트=작성자 본인 / 클라우드=작성자 본인 또는 관리자)
  const canDelete = !!task.id && (cloudMode ? (task.created_by === userId || isAdmin) : (task.author === currentUser.name));

  // 멘션·담당자 자동완성 멤버 소스 (클라우드=프로필 표시명 / 게스트=현재 사용자 + 기존 담당자)
  // 마운트 시 1회만 계산 — selectTasksList를 구독하면 실시간 재조회마다 모달이
  // 리렌더되어 모바일에서 타이핑 렉이 발생한다(멤버 목록은 비반응이어도 충분).
  const members = useMemo(() => {
    if (cloudMode) return getMemberNames();
    const set = new Set();
    const st = store.getState();
    if (st.currentUser?.name) set.add(st.currentUser.name);
    st.tasks.allIds.forEach(id => (st.tasks.byId[id]?.assignees || []).forEach(a => a && set.add(a)));
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudMode]);

  // 저장은 한 번만 — 두 번 눌리면 같은 카드에 저장이 겹쳐서 담당자·팀 조인 쓰기가
  // 서로 부딪혔다(duplicate key). cloud.js의 resetCardJoin을 멱등하게 고쳐 이제
  // 부딪히지 않지만, 애초에 두 번 보낼 이유가 없으니 여기서도 막는다.
  // 다시 '수정'으로 들어오면 풀린다.
  const submittingRef = useRef(false);
  const titleRef = useRef(null);
  // 댓글·활동 사이드바 접기. 본문을 넓게 보고 싶은 사람이 매번 접게 두면 번거로우니
  // 창을 닫았다 열어도 기억한다(localStorage — 사람마다 다르고 서버가 알 필요가 없다).
  // 모바일은 이미 세그먼트 탭으로 갈라져 있어 해당 없다.
  const [sideOpen, setSideOpen] = useState(() => {
    try { return localStorage.getItem('task_side_closed') !== '1'; } catch { return true; }
  });
  const toggleSide = () => setSideOpen(v => {
    try { localStorage.setItem('task_side_closed', v ? '1' : '0'); } catch { /* 프라이빗 모드 */ }
    return !v;
  });
  useEffect(() => { if (isEditMode) submittingRef.current = false; }, [isEditMode]);

  // 새 업무에서 골라둔 첨부(File 객체) — 파일은 카드 id가 있어야 올라가므로(files가
  // 카드를 참조) 저장 직후에 올린다. 쓰는 사람에게는 "처음부터 첨부"와 같다.
  const [pendingFiles, setPendingFiles] = useState([]);
  // 새 업무의 첨부도 **업무 창에서 붙일 때와 같은 길**로 올린다(attachments.startUploads).
  // 예전에는 여기 두 번째 구현이 있었는데 사진을 줄이지 않았고(29-m), 업무 폴더를 미리
  // 확보하지 않았고(29-h), 하나씩 순차로 올렸고, "올리는 중"도 이름만 있는 다른 표시라
  // 창을 닫으면 사라졌다. 같은 일을 두 벌로 두면 고칠 때마다 한쪽만 고쳐진다.
  const uploadPending = async (saved) => {
    const files = pendingFiles;
    setPendingFiles([]);
    // 카드 행이 DB에 들어간 뒤에 올린다 — files.card_id가 cards를 참조하므로
    // 먼저 올리면 외래키 위반으로 통째로 실패한다(handleSaveTask는 기다리지 않는다).
    // 카드 저장 자체가 실패했으면 여기서 멈춘다 — 그대로 올리면 첨부가
    // `files_card_id_fkey` 원문을 화면에 띄우는데, 그건 원인이 아니라 결과다.
    if (!await cardWritePromise(saved.id)) {
      showToast('업무가 저장되지 않아 첨부 파일도 올리지 못했어요');
      return;
    }
    const project = store.getState().projects.byId[saved.projectId];
    await startUploads({ task: saved, project, files, onFileActivity });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    // 제목 없이 저장하면 DB의 not-null에 막힌다(cards.title). 푸터의 '저장'은
    // form 밖의 type="button"이라 input의 `required`가 걸리지 않아서, 실제로
    // 제목 없는 업무가 저장까지 갔다가 실패했고 그 뒤 첨부도 외래키로 실패했다
    // (사용자 스크린샷 두 장이 이 한 가지 원인이었다). 여기서 먼저 막는다.
    if (!String(formData.title || '').trim()) {
      showToast('업무 제목을 먼저 적어주세요');
      titleRef.current?.focus();
      return;
    }
    submittingRef.current = true;
    const saved = onSave(formData);
    if (!task.id && cloudMode && saved?.id && pendingFiles.length) uploadPending(saved);
  };
  const commentCount = (formData.comments || []).filter(c => !c.parentId).length;
  const metaLine = [
    formData.author && `작성: ${formData.author}`,
    formData.updatedBy && `수정: ${formData.updatedBy}`,
    formatDate(formData.updatedBy ? formData.updatedAt : formData.createdAt),
  ].filter(Boolean).join(' · ');

  // ── 공용 조각 (데스크톱/모바일 레이아웃이 재사용) ──
  const headerInner = (
    <>
      <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted"><CheckSquare size={14} className="text-accent"/> {task.id ? '업무 세부 정보' : '새 업무 만들기'}</div>
      <div className="flex items-center gap-1">
        {task.id && <ShareButton url={`${window.location.origin}/s/t/${task.id}`} what="업무" />}
        {!isMobile && task.id && (
          <button onClick={toggleSide} className="p-1 hover:bg-surface-hover rounded-full text-fg-faint"
            title={sideOpen ? '댓글·활동 접기' : '댓글·활동 펴기'} aria-expanded={sideOpen}>
            {sideOpen ? <PanelRightClose size={16} strokeWidth={1.75}/> : <PanelRight size={16} strokeWidth={1.75}/>}
          </button>
        )}
        {!isMobile && (
          <button onClick={() => setExpanded(e => !e)} className="p-1 hover:bg-surface-hover rounded-full text-fg-faint"
            title={expanded ? '원래 크기로' : '전체 화면'}>
            {expanded ? <Minimize2 size={16} strokeWidth={1.75}/> : <Maximize2 size={16} strokeWidth={1.75}/>}
          </button>
        )}
        <button onClick={onClose} className="p-1 hover:bg-surface-hover rounded-full text-fg-faint"><X size={18} strokeWidth={1.75}/></button>
      </div>
    </>
  );
  const footerInner = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        {!isEditMode && canDelete && (
          <ConfirmPopover message="이 업무를 삭제할까요?" onConfirm={onDelete}>
            <button type="button" className="p-2 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition active:scale-95 shrink-0" title="업무 삭제"><Trash2 size={16} /></button>
          </ConfirmPopover>
        )}
        {/* 작성자 · (고친 적이 있으면) 마지막으로 고친 사람 · 그 시각.
            한 번도 고치지 않았으면 만든 시각을 보여준다 — 예전에는 수정한 사람이
            안 나와서, 작성자와 수정자가 다를 때 누가 손댔는지 알 수 없었다. */}
        <div className="text-[10px] text-fg-faint hidden md:block truncate">{metaLine}</div>
      </div>
      {/* 할 일(수정·저장)이 왼쪽, 나가기(닫기)가 오른쪽. 두 모드에서 자리를 같게 둔다 —
          저장이 오른쪽이고 수정이 왼쪽이면, 저장한 순간 손가락 밑의 버튼이 다른 뜻이 된다.
          색: 이 앱의 구조색은 하나뿐이라(--app-accent) 그것을 행동에만 쓴다.
            · 저장  = 되돌리기 어려운 확정 → 진한 accent 채움 ('새 업무'와 같은 급)
            · 수정  = 편집으로 들어가는 것 → 연한 accent(accent-weak + accent 글자)
            · 닫기  = 아무 일도 하지 않음 → 무채색 그대로
          예전에는 수정과 닫기가 둘 다 surface-hover라 어느 쪽이 할 일인지 구분되지 않았다. */}
      <div className="flex gap-2 shrink-0">
        {isEditMode
          ? <button type="button" onClick={handleSubmit} className="flex-1 sm:flex-none bg-accent hover:bg-accent-strong text-white px-6 py-2 rounded-md text-xs font-semibold transition active:scale-95">저장</button>
          : <button type="button" onClick={onEdit} className="flex-1 sm:flex-none bg-accent-weak hover:brightness-95 text-accent-text px-6 py-2 rounded-md text-xs font-semibold transition active:scale-95">수정</button>}
        <button onClick={onClose} className="flex-1 sm:flex-none px-4 py-2 text-xs font-medium text-fg-muted bg-surface-hover hover:bg-line rounded-md transition active:scale-95">닫기</button>
      </div>
    </>
  );
  const detailBody = isEditMode
    ? <TaskEditor formData={formData} setFormData={setFormData} members={members} cloudMode={cloudMode} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity}
        pendingFiles={pendingFiles} setPendingFiles={setPendingFiles} titleRef={titleRef} />
    // key로 카드마다 새로 마운트한다 — 요약 state(펼침·이번에 만든 요약)가 카드
    // 사이에 남으면, 다른 카드를 열었을 때 앞 카드의 요약이 그대로 보인다
    : <TaskViewer key={formData.id} formData={formData} cloudMode={cloudMode} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity}
        // 체크 하나에 카드 전체를 저장한다 — 하위 업무만 따로 쓰는 경로를 만들 만큼
        // 잦은 조작이 아니고, 저장 경로가 둘이면 활동 기록·실시간이 갈라진다
        onSubtasksChange={(next) => onSave({ ...formData, subtasks: next })}
        // 본문 체크리스트도 같은 길 — 보기 모드에서 바로 눌리고 content만 바뀐다
        onTodoToggle={(idx) => onSave({ ...formData, content: toggleTodoLine(formData.content, idx) })}
        />;
  const commentsPanel = listsReady
    /* members: 답글 입력창도 댓글 입력창과 같은 @멘션 자동완성을 쓴다 */
    ? <CommentPanel comments={formData.comments} onReply={onAddComment} currentUser={currentUser} onUpdate={onUpdateComment} onDelete={onDeleteComment} loading={detailLoading} members={members} />
    : null;
  const activityPanel = listsReady ? <ActivityPanel logs={formData.activityLog} loading={detailLoading} /> : null;
  const commentInputEl = <CommentInput onAdd={onAddComment} members={members} />;

  // ── 모바일: 풀스크린 + 세그먼트 탭 ──
  if (isMobile) {
    const segBtn = (id, label) => (
      <button onClick={() => setMobileTab(id)} className={`flex-1 py-3 text-xs font-semibold border-b-2 -mb-px transition-colors ${mobileTab === id ? 'border-accent text-accent-text' : 'border-transparent text-fg-muted'}`}>{label}</button>
    );
    return (
      <div className="fixed inset-0 z-50 bg-surface flex flex-col animate-in slide-in-from-bottom-4 duration-200">
        <div className="shrink-0 px-4 py-3 border-b border-line flex justify-between items-center bg-surface">{headerInner}</div>
        {!isEditMode && task.id && (
          <div className="flex border-b border-line bg-surface shrink-0">
            {segBtn('detail', '상세')}
            {segBtn('comments', `댓글 (${commentCount})`)}
            {segBtn('activity', '활동')}
          </div>
        )}
        {isEditMode ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-5">{detailBody}</div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {mobileTab === 'detail' && <div className="flex-1 overflow-y-auto p-5">{detailBody}</div>}
            {mobileTab === 'comments' && <div className="flex-1 overflow-y-auto p-4">{commentsPanel}</div>}
            {mobileTab === 'activity' && <div className="flex-1 overflow-y-auto p-4">{activityPanel}</div>}
            {mobileTab === 'comments' && commentInputEl}
          </div>
        )}
        <div className="shrink-0 border-t border-line p-3 flex justify-between items-center gap-2 bg-surface-2">{footerInner}</div>
      </div>
    );
  }

  // ── 데스크톱(md+): 기존 좌우 분할 ──
  // 오버레이 blur 제거 — backdrop-filter 안에서 스크롤되는 컨테이너는
  // 사파리에서 프레임마다 재합성돼 스크롤이 끊긴다(노션도 딤만 쓴다)
  return (
    // 바깥(딤) 영역을 누르면 닫힌다. 누른 곳과 뗀 곳이 모두 딤일 때만 —
    // 안에서 글자를 드래그하다 바깥에서 손을 떼는 경우에 닫히면 안 되므로.
    <div
      ref={overlayRef}
      onMouseDown={(e) => { downOnOverlay.current = e.target === overlayRef.current; }}
      onClick={(e) => { if (e.target === overlayRef.current && downOnOverlay.current) onClose(); }}
      className={`fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-in fade-in duration-200 ${expanded ? 'p-0' : 'p-2 md:p-4'}`}
    >
      {/* 전체 화면이면 창이 뷰포트를 다 쓴다 — 딤·모서리·최대 폭이 전부 사라져야
          "확대된 창"이 아니라 "전체 화면"으로 읽힌다. 복귀 버튼은 헤더의 같은 자리. */}
      <div className={`bg-surface shadow-elevated border border-line w-full flex flex-col md:flex-row overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${expanded ? 'max-w-none h-full rounded-none border-0' : 'max-w-5xl h-[100dvh] md:h-[85dvh] rounded-lg'}`}>
        <div className="flex-1 flex flex-col border-r-0 md:border-r border-line overflow-y-auto">
          {/* sticky 헤더·푸터에 backdrop-blur를 쓰면 스크롤 프레임마다 뒤 내용을
              다시 블러링해서 새 업무/수정 창 스크롤이 눌린다 → 불투명 배경으로 */}
          <div className="sticky top-0 bg-surface z-10 px-4 py-3 border-b border-line flex justify-between items-center">{headerInner}</div>
          <div className="p-5 md:p-8 flex-1">{detailBody}</div>
          <div className="sticky bottom-0 border-t border-line p-3 md:p-4 flex justify-between items-center gap-2 z-10 bg-surface-2">{footerInner}</div>
        </div>
        {/* 수정 모드에도 사이드바를 그대로 둔다 — 없애면 본문이 전체 폭으로 늘어나
            오른쪽이 통째로 비어 보이고(실제 지적), 댓글을 참조하면서 고치는 일이 흔하다.
            편집 폼은 로컬 state라 댓글이 새로 와도 갈아치워지지 않는다. 새 카드만 없다. */}
        {/* 접을 때 언마운트하지 않는다 — 쓰다 만 댓글이 날아간다. 폭만 0으로 줄이고
            overflow-hidden으로 가린다. 모션은 이 앱의 이징 하나(--ease-out-quint)로
            폭만 움직인다(§4.2 — transform/opacity 원칙의 예외는 여기뿐이고, 폭이
            줄어드는 것 자체가 이 조작의 뜻이라 대체할 방법이 없다). */}
        {task.id && (
          <div
            style={{ transition: 'width .28s var(--ease-out-quint)' }}
            className={`h-[40dvh] md:h-auto bg-surface-2 flex flex-col shrink-0 overflow-hidden ${
              sideOpen ? 'w-full md:w-80 border-t md:border-t-0 md:border-l border-line' : 'w-full md:w-0 h-0 md:h-auto'}`}>
          {/* 안쪽은 폭을 지킨다 — 감싸개만 줄이면 내용이 눌리면서 글자가 뭉개진다.
              감싸개가 잘라 내니 밖에서 보면 옆으로 밀려 사라지는 모양이 된다. */}
          <div className="w-full md:w-80 h-full flex flex-col shrink-0">
            <div className="flex border-b border-line bg-surface shrink-0">
              <button onClick={() => setActiveTab('comments')} className={`flex-1 py-3 text-xs font-semibold transition-colors border-b-2 -mb-px ${activeTab === 'comments' ? 'border-accent text-accent-text' : 'border-transparent text-fg-muted hover:bg-surface-hover'}`}>댓글 ({commentCount})</button>
              <button onClick={() => setActiveTab('activity')} className={`flex-1 py-3 text-xs font-semibold transition-colors border-b-2 -mb-px ${activeTab === 'activity' ? 'border-accent text-accent-text' : 'border-transparent text-fg-muted hover:bg-surface-hover'}`}>활동 기록</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{activeTab === 'comments' ? commentsPanel : activityPanel}</div>
            {activeTab === 'comments' && commentInputEl}
          </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 노션 속성 행: 좌측 라벨 + 우측 값 레이아웃
// 선행 업무 고르기 — 칩(빼기 X) + 네이티브 <select>(더하기).
// 같은 프로젝트의 다른 업무만 후보다. 자기 자신·이미 고른 것은 목록에서 뺀다.
// 한 단계 순환(A→B이면서 B→A)도 후보에서 뺀다 — depLayers가 끊어 주긴 하지만,
// 만들 수 있게 두면 그래프가 "왜 이 모양이지"가 된다. 긴 순환(A→B→C→A)까지 막는
// 탐색은 두지 않았다: 사람이 그걸 만들 확률보다 코드가 늘어나는 비용이 크다.
function DependsRow({ formData, setFormData }) {
  // 셀렉터가 매번 새 배열을 돌려주면 useSyncExternalStore가 무한 리렌더에 빠진다
  // (selectMembers의 NO_MEMBERS와 같은 함정 — 실제로 여기서 한 번 터졌다).
  // 안정된 참조(s.tasks)만 구독하고 파생은 useMemo로 한다.
  const tasksState = useStore(s => s.tasks);
  // 최근에 만든 업무가 맨 위다(utils.byNewest) — allIds 순서를 그대로 쓰면 맨 위가
  // 가장 오래된 업무여서, 방금 만든 업무를 고르려면 목록 끝까지 내려가야 했다.
  const candidates = useMemo(() => tasksState.allIds
    .map(id => tasksState.byId[id])
    .filter(t => t.projectId === formData.projectId && t.id !== formData.id)
    .sort(byNewest),
    [tasksState, formData.projectId, formData.id]);
  const chosen = formData.dependsOn || [];
  const byId = new Map(candidates.map(t => [t.id, t]));
  const options = candidates.filter(t =>
    !chosen.includes(t.id) && !(t.dependsOn || []).includes(formData.id));
  const add = (id) => { if (id) setFormData(prev => ({ ...prev, dependsOn: [...(prev.dependsOn || []), id] })); };
  const remove = (id) => setFormData(prev => ({ ...prev, dependsOn: (prev.dependsOn || []).filter(x => x !== id) }));
  return (
    <PropertyRow icon={<ArrowLeftRight size={13} className="text-fg-faint" />} label="선행 업무">
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {chosen.map(id => (
          <span key={id} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-[11px] font-semibold bg-surface-hover text-fg max-w-[220px]">
            {/* 지워진 카드를 가리키면 제목이 없다 — 그래도 칩은 남겨서 뺄 수 있게 한다 */}
            <span className="truncate">{byId.get(id)?.title || '(지워진 업무)'}</span>
            <button type="button" onClick={() => remove(id)} title="선행 업무 빼기"
              className="text-fg-faint hover:text-tag-red-fg transition-colors shrink-0"><X size={11} /></button>
          </span>
        ))}
        {options.length > 0 && (
          <select value="" onChange={(e) => add(e.target.value)}
            className="text-[11px] text-fg-muted bg-surface border border-line rounded-full px-2 py-1 outline-none focus:border-accent max-w-[200px]">
            <option value="">{chosen.length ? '+ 더 추가' : '+ 먼저 끝나야 하는 업무'}</option>
            {options.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        )}
        {!options.length && !chosen.length && (
          <span className="text-[11px] text-fg-faint">이 프로젝트에 다른 업무가 생기면 고를 수 있어요</span>
        )}
      </div>
    </PropertyRow>
  );
}

// 보기 모드의 선행 업무 줄 — 있을 때만 그린다. 끝난 선행 업무에는 체크를 붙여서
// "이제 시작해도 되는지"가 제목을 읽지 않아도 보이게 한다.
function DependsViewRow({ dependsOn }) {
  // DependsRow와 같은 이유 — 셀렉터에서 새 배열을 만들지 않는다
  const tasksState = useStore(s => s.tasks);
  const deps = useMemo(() => (dependsOn || []).map(id => tasksState.byId[id]).filter(Boolean),
    [tasksState, dependsOn]);
  if (!deps.length) return null;
  return (
    <div className="flex items-start gap-0 py-2.5">
      <span className="w-24 shrink-0 text-fg-muted">선행 업무</span>
      <span className="flex flex-wrap gap-x-3 gap-y-1 min-w-0">
        {deps.map(d => (
          <span key={d.id} className="inline-flex items-center gap-1 font-medium max-w-full"
            style={{ color: d.status === '완료' ? 'var(--app-tag-green-fg)' : 'var(--app-ink)' }}>
            {d.status === '완료' && <Check size={11} className="shrink-0" />}
            <span className="truncate">{d.title}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

const PropertyRow = ({ icon, label, children }) => (
  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1.5 sm:gap-0 py-2">
    <div className="w-28 shrink-0 flex items-center gap-1.5 text-xs text-fg-muted">{icon}{label}</div>
    <div className="flex-1 min-w-0">{children}</div>
  </div>
);

// 담당자 멤버 칩 선택기 — 등록된 멤버만 고를 수 있다(목록 밖 이름은 넣지 못한다).
// 예전에는 아무 이름이나 타이핑+Enter로 넣을 수 있었는데, 가입하지 않은 사람은
// 업무를 볼 수도 알림을 받을 수도 없고 아무의 '내 업무'에도 안 잡혀서 배정이
// 아니라 메모였다. 오타도 그렇게 유령 담당자가 됐다. 그런 메모는 본문에 적는다.
const AssigneePicker = ({ value = [], onChange, members = [] }) => {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef(null);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    const uniq = [...new Set(members.filter(Boolean))].filter(m => !value.includes(m))
      .sort((a, b) => a.localeCompare(b, 'ko')); // 가나다순
    // 전원을 보여준다 — 6명에서 자르면 뒷순번 사람은 목록에 없는 것처럼 보였다
    // (목록에 max-h + 스크롤이 있어 길어도 화면을 밀지 않는다)
    return q ? uniq.filter(m => m.toLowerCase().includes(q)) : uniq;
  }, [input, members, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const add = (name) => {
    const n = (name || '').trim();
    setInput(''); setActiveIdx(0);
    if (!n || value.includes(n)) return;
    onChange([...value, n]);
  };
  const remove = (name) => onChange(value.filter(v => v !== name));

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // 목록에 있는 것만 넣는다 — 입력한 글자를 그대로 담당자로 만들지 않는다
      if (open && suggestions.length) add(suggestions[activeIdx] ?? suggestions[0]);
    } else if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'Backspace' && !input && value.length) { remove(value[value.length - 1]); }
  };

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex flex-wrap items-center gap-1.5 border border-line rounded-xs bg-surface px-2 py-1.5 focus-within:border-accent focus-within:shadow-soft transition-all">
        {value.map(name => (
          <span key={name} className="inline-flex items-center gap-1 bg-accent-weak text-accent-text rounded-full pl-2 pr-1 py-0.5 text-[11px] font-medium">
            {name}
            <button type="button" onClick={() => remove(name)} className="hover:bg-accent/20 rounded-full p-0.5 transition active:scale-95" title="제거"><X size={11} /></button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); setActiveIdx(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? '추가…' : '멤버 이름으로 찾기'}
          className="flex-1 min-w-[8rem] bg-transparent text-xs text-fg placeholder:text-fg-faint outline-none py-0.5"
        />
      </div>
      {/* 찾는 이름이 목록에 없을 때 — 왜 안 들어가는지 알려준다.
          아무 안내 없이 Enter가 먹히지 않으면 입력이 씹힌 것처럼 보인다. */}
      {open && input.trim() && suggestions.length === 0 && (
        <p className="absolute left-0 top-full z-50 mt-1 px-2.5 py-2 text-[11px] text-fg-muted bg-surface border border-line rounded-lg shadow-elevated">
          등록된 멤버에 없는 이름이에요
        </p>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-max min-w-[10rem] max-w-[min(18rem,90vw)] max-h-48 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 animate-in fade-in zoom-in-95 duration-150">
          {suggestions.map((name, i) => (
            <button key={name} type="button" onMouseDown={e => { e.preventDefault(); add(name); }}
              // 방향키로 목록 밖까지 내려가도 활성 항목이 보이게
              // text-[13px]: 다른 메뉴(더보기·프로필)와 같은 크기 — text-sm(14px)은 12px
              // 입력칸 옆에서 혼자 커 보였다(실제 지적)
              ref={i === activeIdx ? keepVisible : null}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-[13px] transition-colors ${i === activeIdx ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover'}`}>
              <span className="truncate">{name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── 하위 업무 (체크리스트) ────────────────────────────────────────────────
// 사역 업무는 대개 여러 단계인데, 본문 마크다운 불릿으로 적으면 진척에 안 잡힌다.
// cards.subtasks(jsonb) 컬럼 하나로 둔다 — 카드와 언제나 같이 읽고 쓰므로 조인
// 테이블이 필요 없고, 컬럼 통째 쓰기라 저장이 겹쳐도 깨지지 않는다(0013에서
// 담당자를 조인으로 옮겼다가 겹친 저장이 duplicate key로 깨졌던 것과 반대 성질).
function SubtaskList({ value = [], onChange, readOnly = false }) {
  const [draft, setDraft] = useState('');
  const { total, done } = subtaskProgress(value);

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...value, { id: generateId(), title: t, done: false }]);
    setDraft('');
  };
  const toggle = (id) => onChange(value.map(s => (s.id === id ? { ...s, done: !s.done } : s)));
  const rename = (id, title) => onChange(value.map(s => (s.id === id ? { ...s, title } : s)));
  // 빈 이름으로 남은 줄은 저장할 때 걸러낸다(입력 중 잠깐 비는 것은 막지 않는다)
  const remove = (id) => onChange(value.filter(s => s.id !== id));

  // 읽기 전용인데 항목도 없으면 자리만 차지한다
  if (readOnly && !total) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-1.5">
        <label className="block text-xs text-fg-muted shrink-0">하위 업무</label>
        {total > 0 && (
          <span className="text-[11px] font-semibold text-fg-faint tabular-nums">{done}/{total}</span>
        )}
        <span className="flex-1 min-w-[40px]"><Bar ratio={total ? done / total : 0} color="var(--p-blue)" height={3} /></span>
      </div>
      <div className="divide-y divide-line/60 border-y border-line">
        {value.map(s => (
          <div key={s.id} className="flex items-center gap-2.5 py-2">
            {/* 보기 모드에서도 체크는 눌린다 — 하위 업무를 끝낼 때마다 수정 모드로
                들어갔다 나오게 하면 아무도 쓰지 않는다 */}
            <button
              type="button" onClick={() => toggle(s.id)}
              className="w-[18px] h-[18px] rounded-[5px] shrink-0 flex items-center justify-center transition-colors"
              style={s.done
                ? { background: 'var(--app-tag-green-fg)' }
                : { border: '1.5px solid var(--app-line)' }}
              aria-pressed={s.done} aria-label={`${s.title} ${s.done ? '완료 취소' : '완료'}`}
            >
              {s.done && <Check size={11} strokeWidth={3} className="text-white" />}
            </button>
            {/* 수정 모드에서는 언제나 입력칸이다 — '눌러서 고치기'로 감추면 고칠 수
                있다는 것 자체가 안 보인다. 삭제 버튼도 hover로 숨기지 않는다
                (터치 기기에는 hover가 없다). */}
            {readOnly ? (
              <span className={`flex-1 min-w-0 text-[13px] break-words ${s.done ? 'text-fg-faint line-through' : 'text-fg'}`}>{s.title}</span>
            ) : (
              <input
                value={s.title}
                onChange={e => rename(s.id, e.target.value)}
                placeholder="예: 포스터 시안 만들기"
                className={`flex-1 min-w-0 text-[13px] bg-transparent border border-transparent rounded-xs px-1.5 py-1 outline-none transition-colors hover:border-line focus:border-accent focus:bg-surface ${s.done ? 'text-fg-faint line-through' : 'text-fg'} placeholder:text-fg-faint`}
              />
            )}
            {/* 한 번 누르면 바로 지워졌다 — 체크박스 옆 작은 휴지통이라 잘못 누르기 쉽고,
                하위 업무는 실행 취소가 없다(클라우드 모드에서는 Undo를 감춘다).
                삭제 확인은 §7대로 ConfirmPopover로 통일한다. */}
            {!readOnly && (
              <ConfirmPopover
                className="shrink-0 inline-flex"
                title="이 하위 업무 삭제"
                message={s.title.trim() ? `'${s.title.trim()}'을(를) 삭제할까요?` : '이 하위 업무를 삭제할까요?'}
                onConfirm={() => remove(s.id)}
              >
                <button type="button" aria-label={`${s.title || '이름 없는 하위 업무'} 삭제`}
                  className="p-1 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition-colors">
                  <Trash2 size={13} />
                </button>
              </ConfirmPopover>
            )}
          </div>
        ))}
        {/* readOnly + 항목 0개는 위에서 이미 return null이라 여기 오지 않는다 */}
        {!total && (
          <p className="py-2.5 text-[11px] text-fg-faint">업무를 여러 개로 나누면 하나씩 체크할 수 있어요</p>
        )}
      </div>
      {!readOnly && (
        <input
          value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          onBlur={add}
          // '입력하고 Enter'라고만 적혀 있었는데 onBlur로도 추가된다. 방법을 설명하는
          // 대신 예시를 두는 쪽이 낫다 — '하위 업무'가 무엇인지 모르는 사람에게는
          // 방법보다 "여기에 무엇을 적는 칸인지"가 먼저다.
          placeholder="예: 포스터 시안 만들기"
          className="w-full mt-2 text-[13px] px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint"
        />
      )}
    </div>
  );
}

const TaskEditor = React.memo(({ formData, setFormData, members = [], cloudMode, userId, isAdmin, onFileActivity, pendingFiles = [], setPendingFiles, titleRef }) => {
  const [isAiLoading, setIsAiLoading] = useState(false);
  // 다듬기 직전 본문. 있으면 '되돌리기'가 보인다. 창을 닫으면 잊는다 —
  // "방금 다듬었는데 마음에 안 든다"가 실제 상황이고, 그 이상은 편집 이력 관리다.
  // ponytail: 직전 하나만 기억한다. 두 번 다듬고 두 번 되돌릴 일은 아직 없었다.
  const [beforePolish, setBeforePolish] = useState(null);

  const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  const toggleTeam = (team) => setFormData(prev => ({ ...prev, teams: (prev.teams || []).includes(team) ? prev.teams.filter(t => t !== team) : [...(prev.teams || []), team] }));

  // AI 결과(마크다운)는 content로 넣으면 MarkdownEditor가 파서를 거쳐 문서로 반영한다
  const handleAiPolish = async () => {
    if (!formData.content) return;
    setIsAiLoading(true);
    const before = formData.content;
    const polished = await AiService.polishText(before, formData);
    setIsAiLoading(false);
    // **안내 문구를 본문에 넣지 않는다.** 안내 문구도 truthy한 문자열이라 예전에는
    // 그대로 본문을 덮었다 — 게스트·로컬·세션 만료에서 '다듬기'를 누르면 쓰던 글이
    // "AI 기능은 로그인 후 사용할 수 있어요." 한 줄로 갈아치워졌다.
    if (!polished || isFallbackText(polished)) { showToast(polished || '다듬지 못했어요 · 잠시 후 다시 시도해주세요'); return; }
    setBeforePolish(before);
    setFormData(prev => ({ ...prev, content: polished }));
  };
  const undoPolish = () => {
    setFormData(prev => ({ ...prev, content: beforePolish }));
    setBeforePolish(null);
  };

  return (
    <form className="space-y-4">
      {/* 모바일은 autoFocus 금지 — 열자마자 키보드가 화면 절반을 덮는다 */}
      <input ref={titleRef} type="text" name="title" value={formData.title || ''} onChange={handleChange} placeholder="업무 제목 입력" className="w-full text-xl md:text-2xl font-bold tracking-[-0.25px] text-fg placeholder:text-fg-faint bg-transparent border-none outline-none focus:ring-0 p-0" required autoFocus={!isMobileViewport()} />

      <div className="border-y border-line divide-y divide-line/60">
        <PropertyRow icon={<CheckSquare size={13} className="text-fg-faint" />} label="상태">
          <div className="flex flex-wrap gap-1.5">
            {CONFIG.STATUSES.map(s => (
              <button key={s} type="button" onClick={() => setFormData(prev => ({ ...prev, status: s }))}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all active:scale-95 ${(formData.status || '시작 전') === s ? CONFIG.STATUS_STYLES[s] + ' border-transparent shadow-soft' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
                {s}
              </button>
            ))}
          </div>
        </PropertyRow>
        <PropertyRow icon={<CalendarRange size={13} className="text-fg-faint" />} label="시작일">
          <DatePicker value={formData.startDate || ''} onChange={(v) => setFormData(prev => ({ ...prev, startDate: v }))} />
        </PropertyRow>
        <PropertyRow icon={<Clock size={13} className="text-fg-faint" />} label="마감일">
          <DatePicker value={formData.dueDate || ''} onChange={(v) => setFormData(prev => ({ ...prev, dueDate: v }))} />
        </PropertyRow>
        <PropertyRow icon={<Hash size={13} className="text-fg-faint" />} label="담당 팀">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(CONFIG.TEAMS).map(([team, colorClass]) => {
              const selected = (formData.teams || []).includes(team);
              return (
                <button key={team} type="button" onClick={() => toggleTeam(team)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all active:scale-95 ${selected ? colorClass + ' border-transparent shadow-soft' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
                  {team}
                </button>
              );
            })}
          </div>
        </PropertyRow>
        <PropertyRow icon={<User size={13} className="text-fg-faint" />} label="담당자">
          <AssigneePicker value={formData.assignees || []} onChange={(next) => setFormData(prev => ({ ...prev, assignees: next }))} members={members} />
        </PropertyRow>
        {/* 선행 업무(0020) — 이 업무보다 먼저 끝나야 하는 것. 같은 프로젝트 안에서만 고른다
            (프로젝트를 건너 잇기 시작하면 그래프가 화면 하나에 안 담긴다).
            네이티브 <select>다: 목록이 길어도 모바일에서 OS가 알아서 잘 굴려 준다. */}
        <DependsRow formData={formData} setFormData={setFormData} />
      </div>

      <div>
        <div className="flex justify-between items-center gap-2 mb-1.5">
          <label className="block text-xs text-fg-muted shrink-0">상세 내용</label>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 다듬은 직후에만 보인다 — 되돌리면 사라진다 */}
            {beforePolish !== null && !isAiLoading && (
              <button type="button" onClick={undoPolish} className="flex items-center gap-1 px-2 py-1 bg-surface border border-line text-fg-muted hover:bg-surface-hover rounded-full text-[10px] font-bold transition active:scale-95">
                <Undo2 size={12} /> 되돌리기
              </button>
            )}
            <button type="button" onClick={handleAiPolish} disabled={isAiLoading || !formData.content} className="flex items-center gap-1 px-2 py-1 bg-tag-purple text-tag-purple-fg hover:opacity-80 rounded-full text-[10px] font-bold transition active:scale-95 disabled:opacity-40">
              {isAiLoading ? <span className="animate-pulse">다듬는 중...</span> : <><Wand2 size={12} /> AI 문맥 다듬기</>}
            </button>
          </div>
        </div>
        <Suspense fallback={<EditorSkeleton />}>
          <MarkdownEditor
            value={formData.content || ''}
            onChange={(val) => setFormData(prev => ({ ...prev, content: val }))}
            members={members} cloudMode={cloudMode}
            placeholder={cloudMode ? '내용을 입력하세요. @이름 멘션, 이미지 붙여넣기(Ctrl/⌘+V)도 돼요.' : '내용을 입력하세요. @이름 멘션을 쓸 수 있어요.'}
            className="min-h-40 md:min-h-56 border border-line rounded-md rounded-t-none p-3 bg-surface focus-within:border-accent focus-within:shadow-soft transition-all"
          />
        </Suspense>
      </div>

      <SubtaskList
        value={formData.subtasks || []}
        onChange={(next) => setFormData(prev => ({ ...prev, subtasks: next }))}
      />

      {cloudMode && (formData.id
        ? <AttachmentSection task={formData} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity} />
        // 새 업무도 처음부터 첨부를 고를 수 있다 — 실제 업로드는 저장 직후(카드 id가 생긴 뒤)
        : <PendingAttachments files={pendingFiles} onChange={setPendingFiles} />
      )}
    </form>
  );
});

const TaskViewer = React.memo(({ formData, cloudMode, userId, isAdmin, onFileActivity, onSubtasksChange, onTodoToggle }) => {
  const [summary, setSummary] = useState('');      // 이번에 AI가 만든 것(고정 전)
  const [revealed, setRevealed] = useState(false); // 고정된 요약을 펼쳤는지
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // 고정된 요약은 카드에 남아 있어서(0015의 cards.ai_summary) 다른 사람도 본다.
  // **열자마자 펼치지는 않는다** — 버튼을 눌러서 나오는 편이, 요약이라는 기능이
  // 있다는 것과 자기가 그걸 불렀다는 것을 같이 알려준다. 대신 AI를 다시 부르지
  // 않고 저장된 것을 바로 보여준다(값도 안 들고 즉시 뜬다).
  const pinned = formData.aiSummary || '';
  // 이번에 만든 것이 있으면 그것이 먼저다. 예전에는 `pinned || summary`라서
  // 고정된 상태에서 '다시 만들기'를 눌러도 화면이 옛 요약 그대로였다.
  const shown = summary || (revealed ? pinned : '');
  const showingPinned = !!pinned && shown === pinned;
  // AI 기능(요약 고정·고치기)은 **마스터만**(0028). 관리자를 늘려도 이건 안 번진다 —
  // AI는 돈이 들고 워크스페이스 전체에 남는 글을 만든다(사용자 결정).
  const { isMaster } = useAuth();
  const canPin = cloudMode && isMaster && !!formData.id;

  const runAi = async () => {
    setIsAiLoading(true);
    const result = await AiService.summarizeTask(formData);
    setSummary(result);
    setIsAiLoading(false);
  };

  // 고정된 요약도 '분석하는 중'을 한 번 지나서 나온다. 값이 이미 있으니 즉시 띄울 수도
  // 있는데, 그러면 같은 버튼이 사람마다 다르게 동작한다 — 누구는 몇 초 기다리고 누구는
  // 깜빡임도 없이 뜬다. 읽는 사람은 이게 저장된 것인지 알 필요가 없고, 알면 "누가 골라둔
  // 글"로 읽힌다. 일부러 넣은 지연이다(성능 문제가 아니다).
  const REVEAL_MS = 2000;
  const revealPinned = async () => {
    setIsAiLoading(true);
    await new Promise(r => setTimeout(r, REVEAL_MS));
    setRevealed(true);
    setIsAiLoading(false);
  };
  // 버튼 한 번: 고정된 게 있으면 펼치기, 없으면 AI 호출
  const handleSummarize = () => (pinned ? revealPinned() : runAi());

  // 고정/해제 — 카드 폼과 분리된 경로다(요약 세 칸만 건드린다)
  const setPinnedSummary = async (text) => {
    setPinning(true);
    store.dispatch({ type: 'SYNC_TASK', payload: { id: formData.id, aiSummary: text, aiSummaryBy: text ? '나' : '', aiSummaryAt: text ? new Date().toISOString() : '' } });
    try {
      await cardSummaryCloud(formData.id, text);
      // 고정한 것이 화면에 남게 정리한다 — summary가 남아 있으면 그게 계속 이긴다
      setSummary('');
      setRevealed(!!text);
    } catch (e) {
      console.error('[cloud] 요약 고정 실패:', e);
      showToast('요약을 고정하지 못했어요 · 잠시 후 다시 시도해주세요');
    }
    setPinning(false);
  };

  // 고친 요약 저장 — 다시 돌리면 딴 글이 나오므로, 마음에 든 요약의 한 줄만
  // 손보고 싶을 때가 있다. 고정과 같은 자리에 쓰는 일이라 권한도 같다(관리자).
  const startEdit = () => { setDraft(shown); setEditing(true); };
  const saveEdit = async () => {
    const text = draft.trim();
    if (!text) return;
    setEditing(false);
    await setPinnedSummary(text);
  };

  return (
    <div>
      {/* 상태는 점, 팀은 팀 색 글자 — 카드와 같은 표기법을 쓴다(배지 남발 금지) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5 text-[11px] font-bold">
        <span className="inline-flex items-center gap-1.5 text-fg-muted"><span className={`w-[5px] h-[5px] rounded-full ${CONFIG.STATUS_DOTS[formData.status] || 'bg-fg-faint'}`} />{formData.status}</span>
        {formData.teams?.map(t => <span key={t} className={`tracking-[0.03em] ${CONFIG.TEAM_FG[t] || 'text-fg-muted'}`}>{t}</span>)}
      </div>
      <h2 className="text-xl md:text-2xl font-extrabold text-fg leading-tight tracking-[-0.6px]">{formData.title}</h2>
      <div className="mt-4 border-y border-line divide-y divide-line/60 text-xs">
        <div className="flex items-center gap-0 py-2.5"><span className="w-24 shrink-0 text-fg-muted">담당자</span><span className="font-medium text-fg">{formData.assignees?.join(', ') || '미지정'}</span></div>
        {formData.startDate && <div className="flex items-center gap-0 py-2.5"><span className="w-24 shrink-0 text-fg-muted">시작일</span><span className="font-semibold text-fg">{new Date(formData.startDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}</span></div>}
        {formData.dueDate && <div className="flex items-center gap-0 py-2.5"><span className="w-24 shrink-0 text-fg-muted">마감일</span><span className="font-semibold text-fg">{new Date(formData.dueDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}</span></div>}
        <DependsViewRow dependsOn={formData.dependsOn} />
      </div>

      {/* 요약 섹션 — ✨(AI 상징)를 빼고 왼쪽 선으로 "본문이 아닌 덧말"임을 표시 */}
      {(shown || isAiLoading) && (
        <div className="mt-4 pl-3 border-l-2 border-tag-purple-fg/40 animate-in fade-in duration-200">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-bold text-tag-purple-fg">3줄 요약</span>
            {/* '고정' 배지는 지금 보고 있는 것이 저장된 요약일 때만 — 새로 만든 요약을
                보면서 이 배지가 붙어 있으면 이미 저장된 줄로 오해한다.
                그리고 **고정을 할 수 있는 사람(관리자)에게만** 보여준다. 읽는 사람에게는
                이게 저장된 글인지 방금 만든 글인지가 같은 값이고, '고정'이 붙으면 AI가
                요약한 게 아니라 누가 골라둔 글로 읽힌다. 관리자에게는 필요하다 —
                고치기·다시 만들기·고정 해제가 무엇에 걸리는지 알아야 한다.
                누가 고정했는지는 DB에만 남는다(cards.ai_summary_by). */}
            {showingPinned && canPin && (
              <span className="inline-flex items-center gap-1 text-[10px] text-fg-faint">
                <Pin size={9} />고정
              </span>
            )}
            {/* 고정한 뒤에 카드가 바뀌었으면(체크·본문 수정) 마스터에게만 알려준다 —
                이게 없어서 "다시 만들기를 눌러도 똑같다"는 혼선이 있었다(고정본은
                일부러 재생성하지 않으므로, 낡았다는 사실은 눈에 보여야 한다).
                문구는 사용자가 정했다(2026-08-29). */}
            {showingPinned && canPin && summaryOutdated(formData.updatedAt, formData.aiSummaryAt) && (
              <span className="text-[10px] text-fg-faint">· 고정한 뒤로 업무가 바뀌었어요</span>
            )}
          </div>
          {isAiLoading
            ? <div className="text-xs text-fg-muted animate-pulse">업무 내용과 댓글을 분석하고 있습니다...</div>
            : editing
              ? <textarea
                  value={draft} onChange={e => setDraft(e.target.value)} rows={5} autoFocus
                  className="w-full text-xs leading-relaxed text-fg bg-surface border border-line rounded-xs px-2 py-1.5 outline-none focus:border-accent resize-y"
                />
              : <div className="text-xs text-fg-secondary whitespace-pre-wrap"><RichText content={shown} /></div>}
          {/* 고정·고치기는 관리자만 — 아무나 덮어쓰면 마지막 사람 것만 남는다 */}
          {canPin && !isAiLoading && (
            <div className="flex gap-2 mt-1.5">
              {/* 저장이 왼쪽, 취소가 오른쪽 — 업무 창 푸터와 같은 이유다(§7).
                  '고치기'를 누른 자리에 '저장'이 와야 손가락 밑의 뜻이 안 바뀐다. */}
              {editing ? (
                <>
                  <button onClick={saveEdit} disabled={pinning || !draft.trim()}
                    className="text-[10px] font-semibold text-accent-text hover:underline transition-colors disabled:opacity-40">
                    {pinning ? '저장하는 중...' : '저장'}
                  </button>
                  <button onClick={() => setEditing(false)} disabled={pinning}
                    className="text-[10px] text-fg-faint hover:text-fg-muted transition-colors disabled:opacity-40">취소</button>
                </>
              ) : showingPinned ? (
                <>
                  <button onClick={startEdit} disabled={pinning}
                    className="text-[10px] font-semibold text-accent-text hover:underline transition-colors disabled:opacity-40">고치기</button>
                  <button onClick={runAi} disabled={pinning}
                    className="text-[10px] text-accent-text hover:underline transition-colors disabled:opacity-40">다시 만들기</button>
                  <button onClick={() => setPinnedSummary('')} disabled={pinning}
                    className="text-[10px] text-fg-faint hover:text-fg-muted transition-colors disabled:opacity-40">고정 해제</button>
                </>
              ) : (
                <>
                  {/* 고정된 게 이미 있는데 새로 만든 것을 보고 있는 상태 —
                      덮어쓰는 일이므로 문구로 그렇게 말한다 */}
                  <button onClick={() => setPinnedSummary(shown)} disabled={pinning || !shown}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent-text hover:underline transition-colors disabled:opacity-40">
                    <Pin size={9} />{pinning ? '고정하는 중...' : (pinned ? '이 요약으로 바꾸기' : '이 요약 고정')}
                  </button>
                  <button onClick={startEdit} disabled={pinning || !shown}
                    className="text-[10px] text-accent-text hover:underline transition-colors disabled:opacity-40">고쳐서 고정</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* 요약 버튼은 hover로 숨기지 않는다 — 터치 기기에는 hover가 없어서 모바일에서
          이 기능이 아예 없는 것처럼 보였다. 본문 위 한 줄에 항상 둔다. */}
      {/* 고정된 요약이 있어도 이 버튼이 먼저다 — 눌러야 나온다. 본문이 없어도
          고정된 게 있으면 보여줄 것이 있으므로 버튼을 둔다. */}
      {!shown && (formData.content || pinned) && (
        <div className="flex justify-end mt-4 -mb-1">
          <button onClick={handleSummarize} disabled={isAiLoading} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-tag-purple text-tag-purple-fg hover:opacity-80 rounded-xs text-[10px] font-bold transition active:scale-95 disabled:opacity-40">
            {isAiLoading ? <span className="animate-pulse">요약하는 중...</span> : <><Wand2 size={12} /> 3줄 요약</>}
          </button>
        </div>
      )}
      {/* text-sm: RichText는 크기를 강제하지 않는다(댓글·요약은 12px로 써야 해서) —
          본문의 기준 크기는 이 래퍼가 준다 */}
      <div className="prose prose-sm max-w-none mt-3 min-h-[120px] text-sm">
        <RichText content={formData.content} onToggleTodo={onTodoToggle} />
      </div>

      {/* 보기 모드에서도 체크는 눌린다 — 하위 업무를 끝낼 때마다 수정 모드로 들어갔다
          나오게 하면 아무도 쓰지 않는다. 항목 추가·삭제는 수정 모드에서만. */}
      <SubtaskList value={formData.subtasks || []} onChange={onSubtasksChange} readOnly />

      {cloudMode && formData.id && (
        <AttachmentSection task={formData} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity} readOnly />
      )}
    </div>
  );
});
