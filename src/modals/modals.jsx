import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare, Clock, X, User, Hash, Wand2, Undo2, CalendarRange, Trash2, Check, Pin, ArrowLeftRight, Maximize2, Minimize2, PanelRight, PanelRightClose, Loader2 } from 'lucide-react';
import { CONFIG } from '../config.js';
import { formatDate, formatDay, isMobileViewport, keepVisible, generateId, subtaskProgress, summaryOutdated, byNewest, taskEditDirty, taskChangedKeys, imeComposing } from '../utils.js';
import { store, useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { AiService, isFallbackText } from '../services/ai.js';
import { parseActionItems, matchSubtask, stripActionSection, writeActionSection, namesLabel, formatActionLine } from '../services/actionItems.js';
import { useCoedit, CoeditFaces, VersionPanel, VersionDiffView } from './coedit.jsx';
import { RichText } from '../components/RichText.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { Bar } from '../views/dashboardParts.jsx';
import { DatePicker } from '../components/DatePicker.jsx';
import { AttachmentSection, PendingAttachments, startUploads } from './attachments.jsx';
import { CommentPanel, ActivityPanel, CommentInput } from './comments.jsx';
// TipTap/ProseMirror는 무거워 초기 번들에서 분리한다 (업무 창을 열 때 받는다)
const MarkdownEditor = lazy(() => import('../components/MarkdownEditor.jsx').then(m => ({ default: m.MarkdownEditor })));
// 편집기 조각과 문서(같이 쓰기)를 받는 동안의 뼈대 — 서식 바 자리 + **글줄 모양 막대**가 차례로 숨 쉰다
// (목업 · index.css `.dc-skel-line` — opacity만 움직이고 reduced-motion이면 멈춘다 · §4.2).
// 서식 바 높이(37px)를 그대로 잡아 두어 편집기가 서는 순간 아래가 밀리지 않는다.
const SKEL_LINES = [92, 78, 86, 54];
const EditorSkeleton = () => (
  <div data-editor-skeleton="" aria-hidden className="rounded-md border border-line overflow-hidden">
    <div className="h-[37px] bg-surface-2 border-b border-line" />
    <div className="min-h-40 md:min-h-56 p-3 space-y-3 bg-surface">
      {SKEL_LINES.map((w, i) => (
        <div key={i} className="dc-skel-line h-3 rounded-full bg-surface-hover" style={{ width: `${w}%`, animationDelay: `${i * 140}ms` }} />
      ))}
    </div>
  </div>
);
import { ConfirmPopover, useAnchoredPos } from '../components/ConfirmPopover.jsx';
import { useAuth } from '../services/auth.jsx';
import { isMyUid } from '../services/supabaseClient.js';
import { getMemberNames, loadCardDetail, cardSummaryCloud, cardWritePromise } from '../services/cloudSync.js';
import { ShareButton } from '../components/ShareButton.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { showToast } from '../components/Toast.jsx';

// ============================================================================
// 업무 창 — 연 채로 고치기(TaskLive · 있는 업무) / 만들기 폼(TaskEditor · 새 업무) / 그 껍데기(TaskModalShell)
// ----------------------------------------------------------------------------
// 2026-09-28부터 **수정·저장 버튼이 없다** — 칸마다 저절로 저장한다(TaskModalShell 머리말).
// 같이 뜨는 영역은 파일을 나눠 뒀다:
//   첨부      → attachments.jsx
//   댓글·활동 → comments.jsx
//   같이 쓰기(여는 훅 · 머리줄 얼굴 · 버전 기록 · 고친 곳) → coedit.jsx
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


// ── 업무 창 (2026-09-28 · 저장 버튼 없음 + 같이 쓰기 · 목업 승인) ──────────────────
// **있는 업무는 연 채로 고친다** — 수정·저장 버튼이 없다. 칸마다 그 자리에서 저장한다:
//   · 상태·날짜·팀·담당자·선행 업무·하위 업무 체크/추가/지우기 → 바꾸는 즉시
//   · 제목 · 하위 업무 이름 → 600ms 조용하거나 칸을 떠날 때(Enter는 떠나기 · 조합 중 Enter는 무시)
//   · 본문 → 클라우드는 같이 쓰기(Yjs · 거울이 2초 조용하면 description으로) · 게스트는 800ms 조용할 때
// 저장은 모두 `onSave(새 카드, 지금 스토어 카드)` 하나다 — 컨트롤러가 **바뀐 칸만** 보낸다(taskChangedKeys ·
// PITFALLS 19-e-1). 이전 카드로 창이 들고 있던 사본이 아니라 **지금 스토어의 카드**를 넘기므로, 그 사이
// 남이 바꾼 칸을 내 저장이 되돌리지 않는다(수정 모드가 있던 시절의 19-e가 풀던 문제가 자리째 사라졌다).
//
// 창은 칸마다 **스토어의 지금 값**을 그린다(남이 바꾼 상태·하위 업무가 바로 보인다 · App.jsx가 실시간을
// 더는 미루지 않는다). 창이 들고 있는 것은 **막 치고 있는 것**뿐이다: 초점이 있는 제목 · 하위 업무 이름 ·
// 게스트 본문. 닫을 때(✕·딤·닫기)는 묻지 않고 **밀린 쓰기를 흘린 뒤** 닫는다(flushers) — 페이지를 떠날
// 때도(pagehide) 같다. '저장됨'은 밀린 쓰기가 하나라도 있는 동안 작은 돌기로 바뀐다(hold).
//
// **새 업무(id 없음)는 예전 만들기 폼 그대로**다 — 확정 버튼 `만들기`. 만들면 App이 창을 그 카드로
// 넘기고, 그 자리에서 곧바로 위의 '연 채로 고치기'가 된다(첨부는 예전처럼 카드가 들어간 뒤 올린다).
export function TaskModalShell({ task, onClose, onSave, onContentSession, onAddComment, onUpdateComment, onDeleteComment, onFileActivity, onDelete }) {
  const currentUser = useStore(selectCurrentUser);
  const { enabled, session, isAdmin } = useAuth();
  const cloudMode = enabled && !!session;
  const userId = session?.user?.id;
  const isNew = !task.id;
  const [formData, setFormData] = useState(task);   // 새 업무 폼만 쓴다
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

  // 열려 있는 동안 스토어의 최신 카드를 따라간다 — 댓글·활동·남이 바꾼 칸이 그대로 들어온다
  const liveTask = useStore(s => (task.id ? s.tasks.byId[task.id] : null));
  const source = liveTask || task;

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
  // isMyUid = 세션 uid와 남긴 계정 id를 **둘 다** 내 것으로 본다(0063 · §6-34-i) —
  // 합친 계정에게 자기가 만든 옛 업무의 삭제 버튼이 안 보이던 자리다.
  const canDelete = !!task.id && (cloudMode ? (isMyUid(source.created_by, userId) || isAdmin) : (source.author === currentUser.name));

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

  // ── 칸마다 저장 ─────────────────────────────────────────────────────────
  // 부르는 쪽의 함수는 렌더마다 새로 온다 — 타이머(제목 600ms · 본문 800ms)와 창을 닫은 뒤 끝나는
  // 같이 쓰기(거울·세션 끝)가 **지금** 함수를 부르게 ref로 든다.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onSessionRef = useRef(onContentSession);
  onSessionRef.current = onContentSession;
  // 밀린 쓰기 수 — '저장됨' 자리(SaveMark). hold()가 준 끝내기를 쓰기가 끝나면 부른다(두 번 불러도 한 번).
  const [busy, setBusy] = useState(0);
  const [failed, setFailed] = useState(false);
  const hold = useCallback(() => {
    setBusy(n => n + 1);
    let done = false;
    return (ok = true) => { if (done) return; done = true; setBusy(n => Math.max(0, n - 1)); setFailed(!ok); };
  }, []);
  const cardId = task.id;
  // patch는 칸 몇 개 또는 (지금 카드 → 새 카드) 함수. 바뀐 칸이 없으면 아무것도 보내지 않는다.
  const commit = useCallback((patch, { release, ...opts } = {}) => {
    const done = release || hold();
    const cur = cardId && store.getState().tasks.byId[cardId];
    if (!cur) { done(true); return null; }
    const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
    const keys = taskChangedKeys(next, cur);
    if (!keys || !keys.length) { done(true); return cur; }
    return onSaveRef.current(next, cur, { ...opts, onSettled: done });
  }, [cardId, hold]);
  // 닫을 때 · 페이지를 떠날 때 흘릴 것들(제목 · 하위 업무 이름 · 게스트 본문이 저마다 등록한다)
  const flushers = useRef(new Set());
  const register = useCallback((fn) => { flushers.current.add(fn); return () => flushers.current.delete(fn); }, []);
  const flushAll = useCallback(() => {
    for (const fn of [...flushers.current]) { try { fn(); } catch (e) { console.warn('[task] 밀린 저장을 흘리지 못했어요:', e); } }
  }, []);
  useEffect(() => {
    window.addEventListener('pagehide', flushAll);
    return () => window.removeEventListener('pagehide', flushAll);
  }, [flushAll]);
  const close = useCallback(() => { flushAll(); onClose(); }, [flushAll, onClose]);

  // ── 같이 쓰기(클라우드 · 있는 업무) ───────────────────────────────────────
  // 거울(onMirror)은 **조용한 저장**이다 — 활동·멘션은 세션 끝(onVersion)에 한 번(controllers).
  const { co, failed: coFailed } = useCoedit({
    cardId, enabled: cloudMode && !!cardId, name: currentUser.name,
    onMirror: (md) => commit({ content: md }, { silentContent: true }),
    onVersion: ({ startMd, endMd }) => onSessionRef.current?.(cardId, startMd, endMd),
  });
  // 개발 빌드 전용 — 게스트 검사가 머리줄 얼굴을 그려 보게 가짜 awareness를 끼운다(tests/modalclose).
  // `window.__coeditFake = [[clientID, { user: { id, name, color } }], …]` · 첫 줄이 나다.
  const fakeAwareness = useMemo(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined' || !Array.isArray(window.__coeditFake)) return null;
    const rows = window.__coeditFake;
    return { clientID: rows[0]?.[0], getStates: () => new Map(rows), on() {}, off() {} };
  }, []);
  const awareness = co?.awareness || fakeAwareness;
  // 본문을 치는 동안도 '밀린 쓰기'다 — 거울은 2초 조용해야 가므로 그동안 돌기를 세운다. 거울이 가면 그 저장이
  // 제 hold를 잡고, 글이 제자리로 돌아와 거울이 안 가면(쳤다 지웠다) 조금 뒤 스스로 푼다.
  // 출처가 심볼이면 남의 편집·DB에서 읽은 것이다(core.REMOTE·DB) — 그때는 세우지 않는다.
  useEffect(() => {
    if (!co) return undefined;
    let release = null;
    let timer = null;
    const onUpdate = (_u, origin) => {
      if (typeof origin === 'symbol') return;
      if (!release) release = hold();
      clearTimeout(timer);
      timer = setTimeout(() => { const r = release; release = null; r?.(true); }, 2600);
    };
    co.ydoc.on('update', onUpdate);
    return () => { co.ydoc.off('update', onUpdate); clearTimeout(timer); release?.(true); };
  }, [co, hold]);
  // 버전 기록에서 고른 판 — 본문 자리에 고친 곳을 보인다. 카드가 바뀌면 걷는다.
  const [diffPick, setDiffPick] = useState(null);
  const [versionsKey, setVersionsKey] = useState(0);
  useEffect(() => { setDiffPick(null); }, [cardId]);
  const pickVersion = (p) => { setDiffPick(p); if (isMobile) setMobileTab('detail'); };
  const restoreVersion = () => {
    if (!diffPick || !co) return;
    co.replaceAll(diffPick.version.md);
    setDiffPick(null);
    // 되돌린 것도 한 판이 된다(세션이 끝날 때) — 목록은 다음에 탭을 열 때 다시 읽는다
    setVersionsKey(k => k + 1);
  };
  const showVersions = cloudMode && !!cardId;
  useEffect(() => { if (!showVersions && (activeTab === 'versions' || mobileTab === 'versions')) { setActiveTab('comments'); setMobileTab('detail'); } },
    [showVersions, activeTab, mobileTab]);

  // ── 새 업무 만들기 ──────────────────────────────────────────────────────
  // 만들기는 한 번만 — 두 번 눌리면 같은 카드가 두 벌 생긴다
  const submittingRef = useRef(false);
  // 새 업무에서 골라둔 첨부(File 객체) — 파일은 카드 id가 있어야 올라가므로(files가
  // 카드를 참조) 만든 직후에 올린다. 쓰는 사람에게는 "처음부터 첨부"와 같다.
  const [pendingFiles, setPendingFiles] = useState([]);

  // ── 업무 창에는 링크가 없다 (2026-09-11에 되돌렸다 · §6-35) ────────────────
  // 링크는 **프로젝트 헤더**에만 남는다(views.jsx · `+ 참고 링크`).
  // 새 업무의 첨부도 **업무 창에서 붙일 때와 같은 길**로 올린다(attachments.startUploads).
  // 같은 일을 두 벌로 두면 고칠 때마다 한쪽만 고쳐진다.
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

  // 새 업무 폼이 처음 연 모양 — 닫을 때 물어볼지(고친 것이 있나)의 기준
  const createBaseRef = useRef(task);
  const handleCreate = (e) => {
    e?.preventDefault?.();
    if (submittingRef.current) return;
    // 제목 없이 만들면 DB의 not-null에 막힌다(cards.title). 확정 버튼은 form 밖의
    // type="button"이라 input의 `required`가 걸리지 않아서, 실제로 제목 없는 업무가
    // 저장까지 갔다가 실패했고 그 뒤 첨부도 외래키로 실패했다. 여기서 먼저 막는다.
    if (!String(formData.title || '').trim()) {
      showToast('업무 제목을 먼저 적어주세요');
      titleRef.current?.focus();
      return;
    }
    submittingRef.current = true;
    const saved = onSave(formData, null);
    if (cloudMode && saved?.id && pendingFiles.length) uploadPending(saved);
  };
  const commentCount = (source.comments || []).filter(c => !c.parentId).length;
  const metaLine = [
    source.author && `작성: ${source.author}`,
    source.updatedBy && `수정: ${source.updatedBy}`,
    formatDate(source.updatedBy ? source.updatedAt : source.createdAt),
  ].filter(Boolean).join(' · ');

  // **새 업무 폼만** 닫을 때 묻는다 — 만들지 않은 채 닫으면 적은 것이 통째로 사라진다. 있는 업무는
  // 칸마다 저장되므로 물을 것이 없다(밀린 쓰기는 close가 흘린다).
  const dirty = isNew && taskEditDirty(formData, createBaseRef.current);
  useEffect(() => {
    if (!dirty) return undefined;
    const onBefore = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  // 머리줄 ✕도 푸터의 '닫기'와 **같은 확인**을 거친다(감사 4) — 딤을 누르면 이 ✕의 확인을 연다.
  const closeXRef = useRef(null);
  const confirmClose = (children, className) => (
    <ConfirmPopover
      message="저장하지 않은 내용이 있어요"
      altLabel="만들고 닫기" onAlt={() => handleCreate()}
      confirmLabel="무시하고 닫기" onConfirm={onClose}
      cancelLabel="돌아가기"
      className={className}>
      {children}
    </ConfirmPopover>
  );
  const closeX = <button onClick={dirty ? undefined : close} title="닫기" aria-label="닫기" className="p-1 hover:bg-surface-hover rounded-full text-fg-faint"><X size={18} strokeWidth={1.75}/></button>;

  // ── 공용 조각 (데스크톱/모바일 레이아웃이 재사용) ──
  const headerInner = (
    <>
      <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted min-w-0"><CheckSquare size={14} className="text-accent shrink-0"/> <span className="truncate">{task.id ? '업무 세부 정보' : '새 업무 만들기'}</span></div>
      <div className="flex items-center gap-1 shrink-0">
        {/* 지금 이 본문에 들어와 있는 사람(나 먼저) — 공유·닫기 왼쪽 */}
        {task.id && awareness && <CoeditFaces awareness={awareness} />}
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
        {/* 감싸는 틀은 두 경우 모두 같은 inline-flex 한 겹이다 — 확인이 붙고 떨어져도 ✕의
            자리가 움직이지 않는다 */}
        <span ref={closeXRef} className="inline-flex">
          {dirty ? confirmClose(closeX, 'inline-flex') : closeX}
        </span>
      </div>
    </>
  );

  const closeBtnCls = 'px-4 py-2 text-xs font-medium text-fg-muted bg-surface-hover hover:bg-line rounded-md transition active:scale-95';
  const footerInner = isNew ? (
    <>
      <span />
      {/* 확정(만들기)이 왼쪽, 나가기(닫기)가 오른쪽 — 상시 도구 줄의 자리(§8) */}
      <div className="flex gap-2 shrink-0">
        <button type="button" onClick={handleCreate} className="flex-1 sm:flex-none bg-accent hover:bg-accent-strong text-white px-6 py-2 rounded-md text-xs font-semibold transition active:scale-95">만들기</button>
        {dirty ? confirmClose(<button type="button" className={`w-full ${closeBtnCls}`}>닫기</button>, 'flex-1 sm:flex-none')
          : <button type="button" onClick={onClose} className={`flex-1 sm:flex-none ${closeBtnCls}`}>닫기</button>}
      </div>
    </>
  ) : (
    <>
      <div className="flex items-center gap-2 min-w-0">
        {canDelete && (
          <ConfirmPopover message="이 업무를 삭제할까요?" onConfirm={onDelete}>
            <button type="button" className="p-2 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition active:scale-95 shrink-0" title="업무 삭제"><Trash2 size={16} /></button>
          </ConfirmPopover>
        )}
        {/* 작성자 · (고친 적이 있으면) 마지막으로 고친 사람 · 그 시각 */}
        <div className="text-[10px] text-fg-muted hidden md:block truncate">{metaLine}</div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <SaveMark busy={busy > 0} failed={failed} />
        <button type="button" onClick={close} className={closeBtnCls}>닫기</button>
      </div>
    </>
  );
  const detailBody = isNew
    ? <TaskEditor formData={formData} setFormData={setFormData} members={members} cloudMode={cloudMode} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity}
        pendingFiles={pendingFiles} setPendingFiles={setPendingFiles} titleRef={titleRef} />
    // key로 카드마다 새로 마운트한다 — 요약·본문 초안·제목 초안이 카드 사이에 남지 않게(PITFALLS 18)
    : <TaskLive key={task.id} task={source} commit={commit} register={register} hold={hold}
        onSession={(start, end) => onSessionRef.current?.(task.id, start, end)}
        co={co} coPending={cloudMode && !co && !coFailed} members={members}
        cloudMode={cloudMode} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity}
        diffPick={diffPick} onRestore={restoreVersion} onExitDiff={() => setDiffPick(null)} />;
  const commentsPanel = listsReady
    /* members: 답글 입력창도 댓글 입력창과 같은 @멘션 자동완성을 쓴다 */
    ? <CommentPanel comments={source.comments} onReply={onAddComment} currentUser={currentUser} onUpdate={onUpdateComment} onDelete={onDeleteComment} loading={detailLoading} members={members} />
    : null;
  const activityPanel = listsReady ? <ActivityPanel logs={source.activityLog} loading={detailLoading} /> : null;
  const versionsPanel = showVersions ? <VersionPanel cardId={task.id} pickedId={diffPick?.version.id} onPick={pickVersion} refreshKey={versionsKey} /> : null;
  const commentInputEl = <CommentInput onAdd={onAddComment} members={members} />;

  // ── 모바일: 풀스크린 + 세그먼트 탭 ──
  if (isMobile) {
    const segBtn = (id, label) => (
      <button onClick={() => setMobileTab(id)} className={`flex-1 py-3 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${mobileTab === id ? 'border-accent text-accent-text' : 'border-transparent text-fg-muted'}`}>{label}</button>
    );
    return (
      /* **`inset-0`이 아니라 `--app-vh`다**(2026-09-22 신고 — 댓글 칸이 키보드에 가린다).
         `fixed`는 **레이아웃 뷰포트**에 붙으므로, 키보드가 올라와 앱 뿌리가 줄어도
         이 창의 바닥은 그대로 화면 밖(키보드 밑)에 남는다. 뿌리와 같은 높이를 쓰면
         댓글 입력칸과 아래 도구 줄이 키보드 바로 위에 선다(App.jsx의 --app-vh 주석). */
      <div className="fixed inset-x-0 top-0 h-[var(--app-vh,100dvh)] z-50 bg-surface flex flex-col animate-in slide-in-from-bottom-4 duration-200">
        <div className="shrink-0 px-4 py-3 border-b border-line flex justify-between items-center gap-2 bg-surface">{headerInner}</div>
        {!isNew && (
          <div className="flex border-b border-line bg-surface shrink-0">
            {segBtn('detail', '상세')}
            {segBtn('comments', `댓글 (${commentCount})`)}
            {segBtn('activity', '활동')}
            {showVersions && segBtn('versions', '버전 기록')}
          </div>
        )}
        {isNew ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-5">{detailBody}</div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* 상세는 탭을 옮겨도 **내리지 않는다** — 같이 쓰기 편집기와 치던 초안이 탭마다 새로 서지 않게 */}
            <div className={`flex-1 overflow-y-auto p-5 ${mobileTab === 'detail' ? '' : 'hidden'}`}>{detailBody}</div>
            {mobileTab === 'comments' && <div className="flex-1 overflow-y-auto p-4">{commentsPanel}</div>}
            {mobileTab === 'activity' && <div className="flex-1 overflow-y-auto p-4">{activityPanel}</div>}
            {mobileTab === 'versions' && <div className="flex-1 overflow-y-auto p-4">{versionsPanel}</div>}
            {mobileTab === 'comments' && commentInputEl}
          </div>
        )}
        {/* `data-kb-bar`: 키보드가 올라왔을 때 **이 줄 높이만큼은 쓸 수 없는 자리**라고
            App.jsx의 셈에 알린다(저장·취소가 커서를 가리던 자리 · 2026-09-22). */}
        <div data-kb-bar className="shrink-0 border-t border-line p-3 flex justify-between items-center gap-2 bg-surface-2">{footerInner}</div>
      </div>
    );
  }

  // ── 데스크톱(md+): 기존 좌우 분할 ──
  // 오버레이 blur 제거 — backdrop-filter 안에서 스크롤되는 컨테이너는
  // 사파리에서 프레임마다 재합성돼 스크롤이 끊긴다(노션도 딤만 쓴다)
  const sideTab = (id, label) => (
    <button onClick={() => setActiveTab(id)} className={`flex-1 py-3 text-xs font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap ${activeTab === id ? 'border-accent text-accent-text' : 'border-transparent text-fg-muted hover:bg-surface-hover'}`}>{label}</button>
  );
  return (
    // 바깥(딤) 영역을 누르면 닫힌다. 누른 곳과 뗀 곳이 모두 딤일 때만 —
    // 안에서 글자를 드래그하다 바깥에서 손을 떼는 경우에 닫히면 안 되므로.
    <div
      ref={overlayRef}
      onMouseDown={(e) => { downOnOverlay.current = e.target === overlayRef.current; }}
      onClick={(e) => {
        if (e.target !== overlayRef.current || !downOnOverlay.current) return;
        // 새 업무에 적은 것이 있으면 닫지 않고 ✕의 확인을 연다(감사 4)
        if (dirty) closeXRef.current?.querySelector('button')?.click();
        else close();
      }}
      className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-150 ${expanded ? 'p-0' : 'p-2 md:p-4'}`}
    >
      {/* 전체 화면이면 창이 뷰포트를 다 쓴다 — 딤·모서리·최대 폭이 전부 사라져야
          "확대된 창"이 아니라 "전체 화면"으로 읽힌다. 복귀 버튼은 헤더의 같은 자리. */}
      <div className={`bg-surface shadow-elevated border border-line w-full flex flex-col md:flex-row overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${expanded ? 'max-w-none h-full rounded-none border-0' : 'max-w-5xl h-[100dvh] md:h-[85dvh] rounded-lg'}`}>
        <div className="flex-1 min-w-0 flex flex-col border-r-0 md:border-r border-line overflow-y-auto">
          {/* sticky 헤더·푸터에 backdrop-blur를 쓰면 스크롤 프레임마다 뒤 내용을
              다시 블러링해서 창 스크롤이 눌린다 → 불투명 배경으로 */}
          <div className="sticky top-0 bg-surface z-10 px-4 py-3 border-b border-line flex justify-between items-center gap-2">{headerInner}</div>
          <div className="p-5 md:p-8 flex-1">{detailBody}</div>
          <div className="sticky bottom-0 border-t border-line p-3 md:p-4 flex justify-between items-center gap-2 z-10 bg-surface-2">{footerInner}</div>
        </div>
        {/* 접을 때 언마운트하지 않는다 — 쓰다 만 댓글이 날아간다. 폭만 0으로 줄이고
            overflow-hidden으로 가린다. 모션은 이 앱의 이징 하나(--ease-out-quint)로
            폭만 움직인다(§4.2 — transform/opacity 원칙의 예외는 여기뿐이고, 폭이
            줄어드는 것 자체가 이 조작의 뜻이라 대체할 방법이 없다). 새 카드만 없다. */}
        {task.id && (
          <div
            style={{ transition: 'width .28s var(--ease-out-quint)' }}
            className={`h-[40dvh] md:h-auto bg-surface-2 flex flex-col shrink-0 overflow-hidden ${
              sideOpen ? 'w-full md:w-80 border-t md:border-t-0 md:border-l border-line' : 'w-full md:w-0 h-0 md:h-auto'}`}>
          {/* 안쪽은 폭을 지킨다 — 감싸개만 줄이면 내용이 눌리면서 글자가 뭉개진다.
              감싸개가 잘라 내니 밖에서 보면 옆으로 밀려 사라지는 모양이 된다. */}
          <div className="w-full md:w-80 h-full flex flex-col shrink-0">
            <div className="flex border-b border-line bg-surface shrink-0">
              {sideTab('comments', `댓글 (${commentCount})`)}
              {sideTab('activity', '활동')}
              {showVersions && sideTab('versions', '버전 기록')}
            </div>
            <div className="flex-1 overflow-y-auto p-4">{activeTab === 'comments' ? commentsPanel : activeTab === 'activity' ? activityPanel : versionsPanel}</div>
            {activeTab === 'comments' && commentInputEl}
          </div>
          </div>
        )}
      </div>
    </div>
  );
}

// '저장됨' — 밀린 쓰기가 없으면 작은 체크 + 글자, 있으면 돌기 하나(새 글자 없음 · 목업).
// 실패는 토스트가 두 줄로 말한다(controllers.reportCloudError) — 여기서는 '저장됨'을 거두기만 한다(거짓이 되니까).
function SaveMark({ busy, failed }) {
  if (busy) {
    return (
      <span data-save-state="saving" aria-label="저장하는 중" className="inline-flex items-center justify-center w-4 h-4 text-fg-muted">
        <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
      </span>
    );
  }
  if (failed) return <span data-save-state="failed" />;
  return (
    <span data-save-state="saved" className="inline-flex items-center gap-1 text-[11px] font-medium text-fg-muted whitespace-nowrap">
      <Check size={12} strokeWidth={2.5} className="text-tag-green-fg" />저장됨
    </span>
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
          <select value="" onChange={(e) => add(e.target.value)} aria-label="선행 업무"
            className="text-[11px] text-fg-muted bg-surface border border-line rounded-full px-2 py-1 outline-none focus:border-accent max-w-[200px]">
            <option value="">{chosen.length ? '+ 더 추가' : '+ 먼저 끝나야 하는 업무'}</option>
            {options.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        )}
        {!options.length && !chosen.length && (
          <span className="text-[11px] text-fg-muted">이 프로젝트에 다른 업무가 생기면 고를 수 있어요</span>
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
  const popRef = useRef(null);   // 포털로 나간 목록(또는 '없는 이름' 줄) — 바깥 누름 판정에 같이 넣는다

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    const uniq = [...new Set(members.filter(Boolean))].filter(m => !value.includes(m))
      .sort((a, b) => a.localeCompare(b, 'ko')); // 가나다순
    // 전원을 보여준다 — 6명에서 자르면 뒷순번 사람은 목록에 없는 것처럼 보였다
    // (목록에 max-h + 스크롤이 있어 길어도 화면을 밀지 않는다)
    return q ? uniq.filter(m => m.toLowerCase().includes(q)) : uniq;
  }, [input, members, value]);

  // 목록은 **body 포털**이다(HANDOFF §8 '떠 있는 것') — 업무 창은 overflow 있는 상자라
  // absolute 목록이 잘리거나 좁은 폭에서 화면 밖으로 나갔다. 칸 상자의 왼쪽 끝에서 연다.
  const listOpen = open && (suggestions.length > 0 || !!input.trim());
  const [pos, place] = useAnchoredPos(rootRef, listOpen, 160, 200, 8, popRef, { align: 'start' });
  // 거르면 줄 수가 바뀐다 — 위로 뒤집혀 선 목록이 칸에서 떨어져 뜨지 않게 다시 잰다
  useLayoutEffect(() => { if (listOpen) place(); }, [listOpen, suggestions.length, place]);

  useEffect(() => {
    if (!open) return;
    // 목록이 포털이라 rootRef의 자손이 아니다 — **목록도 '안'으로 센다**(useDismiss 머리말과 같은 이유)
    const onDown = (e) => {
      if (rootRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
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
    if (imeComposing(e)) return;   // 조합을 끝내는 Enter로 고르지 않는다
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
            <button type="button" onClick={() => remove(name)} className="relative before:absolute before:-inset-x-1 before:-inset-y-[5px] hover:bg-accent/20 rounded-full p-0.5 transition active:scale-95" title="제거"><X size={11} /></button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); setActiveIdx(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? '추가…' : '멤버 이름으로 찾기'} aria-label="담당자"
          className="flex-1 min-w-[8rem] bg-transparent text-xs text-fg placeholder:text-fg-faint outline-none py-0.5"
        />
      </div>
      {/* 찾는 이름이 목록에 없을 때 — 왜 안 들어가는지 알려준다.
          아무 안내 없이 Enter가 먹히지 않으면 입력이 씹힌 것처럼 보인다. */}
      {open && input.trim() && suggestions.length === 0 && createPortal(
        <p ref={popRef} style={{ position: 'fixed', left: pos.left, top: pos.top }}
          className="z-[90] px-2.5 py-2 text-[11px] text-fg-muted bg-surface border border-line rounded-lg shadow-elevated">
          등록된 멤버에 없는 이름이에요
        </p>, document.body)}
      {open && suggestions.length > 0 && createPortal(
        <div ref={popRef} style={{ position: 'fixed', left: pos.left, top: pos.top }}
          className="z-[90] w-max min-w-[10rem] max-w-[min(18rem,90vw)] max-h-48 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 transition-none animate-in fade-in zoom-in-95 duration-150">
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
        </div>, document.body)}
    </div>
  );
};

// ── 담당자 고르기 ────────────────────────────────────────────────────────
// 담당자 칸(AssigneePicker)과 달리 **한 줄 안에 들어가야** 해서 칩 하나를 누르면
// 목록이 뜨는 모양이다. 목록에 없는 이름은 넣지 않는다(그쪽과 같은 규칙) — 다만
// 이미 적혀 있는 팀 이름(`엔지니어팀`)은 그대로 두고 지울 수만 있다.
function OwnerPicker({ names = [], members = [], onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const [pos] = useAnchoredPos(triggerRef, open, 210, 260);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = (n) => onChange(names.includes(n) ? names.filter(x => x !== n) : [...names, n]);
  const list = useMemo(
    () => [...new Set([...names, ...members.filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'ko')),
    [names, members],
  );

  const pop = open ? createPortal(
    <div ref={popRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: 210 }}
      className="z-[90] max-h-60 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 transition-none animate-in fade-in zoom-in-95 duration-150">
      {list.map(n => (
        <button key={n} type="button" onClick={() => toggle(n)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[12.5px] transition-colors ${names.includes(n) ? 'bg-accent-weak text-accent-text font-semibold' : 'text-fg-muted hover:bg-surface-hover'}`}>
          <Avatar name={n} className="flex w-5 h-5 text-[10px] shrink-0" />
          <span className="truncate">{n}</span>
          {names.includes(n) && <Check size={13} strokeWidth={3} className="ml-auto shrink-0" />}
        </button>
      ))}
    </div>, document.body) : null;

  return (
    <span className="inline-flex shrink-0" ref={rootRef}>
      <button ref={triggerRef} type="button" onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 h-[30px] rounded-full border text-[12px] transition active:scale-95 ${names.length ? 'pl-1 pr-2.5 border-line bg-surface text-fg' : 'px-2.5 border-dashed border-line bg-surface text-fg-muted'}`}>
        {names.length > 0 && (
          <span className="flex items-center">
            {names.slice(0, 3).map((n, i) => (
              <Avatar key={n} name={n}
                className={`flex w-[21px] h-[21px] text-[10px] ${i ? '-ml-1.5 ring-[1.5px] ring-surface' : ''}`} />
            ))}
          </span>
        )}
        <span className="truncate max-w-[9rem]">{names.length ? namesLabel(names) : '담당자'}</span>
      </button>
      {pop}
    </span>
  );
}

// ── 청년별 담당 업무 (2026-09-21 요청 · 2026-09-22 그릴링으로 다시 짰다) ──────
// 다듬기가 회의록·기획안에서 "누가 · 무엇을 · 언제까지"를 뽑아 두는데, 그게 본문 글자로만
// 남아서 손으로 하위 업무를 만들지 않으면 그대로 사라졌다.
//
// **저장 자리는 본문 그 도막 하나다**(새 칸을 만들지 않았다 · §3-1). 부품은 그것을 읽고
// (parseActionItems) 고친 결과를 도로 적는다(writeActionSection). 편집기 본문에서는 그
// 도막을 감춘다 — 고치는 길이 둘이면 두 글이 어긋난다.
//
// **줄은 빈 것도 들고 있어야 한다.** writeActionSection은 할 일이 빈 줄을 버리므로(본문에
// `- ` 껍데기를 남기지 않는다), 부모가 준 items만 그리면 `＋ 항목 추가`가 만든 빈 줄이
// 그 자리에서 사라진다 — 실제로 "항목 추가가 되지도 않는다"로 보였다(2026-09-22).
// 그래서 **여기서 줄을 들고 있고**, 바깥 글이 정말 달라졌을 때만 다시 읽는다.
//
// 줄 짜임(사용자 요청 "데스크톱·모바일 모두 잘 들어와야 한다"):
//   좁은 화면 → 첫 줄 [체크][사람] … [✕] · 둘째 줄 [할 일][날짜]
//   넓은 화면 → 한 줄 [체크][사람][할 일][날짜][✕]
// order와 basis로 가른다 — 같은 마크업 한 벌이라 두 폭이 어긋날 자리가 없다.
//
// **내린 줄은 여기 없다**(2026-09-24 그릴링 — "체크해서 내린 것만 하위에 쌓이고, 위에는
// 안 내린 것만"). '하위 업무로'는 그 줄을 **본문 도막에서 지우고** cards.subtasks로 옮긴다
// (onCreate(만든 것, 남은 줄)). 그 뒤로 사람·기한은 아래 SubtaskList가 고친다 — 본문에
// 옛 이름이 남아 AI 요약이 그걸 읽는 일이 없게. 다듬기를 다시 돌려 같은 제목이 또
// 뽑히면 matchSubtask로 거른다(그 줄도 다음에 내릴 때 같이 걷힌다).
// `ops`(같이 쓰기 · 업무 창) — 줄을 Yjs 배열에서 읽고 줄 단위로 고친다(add·update·remove). 그때는 items가
// 곧 원본이고 빈 줄도 배열에 그대로 있어서 이 부품이 줄을 따로 들 까닭이 없다(위 '빈 줄' 문제가 없다).
function ActionItems({ items = [], subtasks = [], members = [], editable = false, onChange, onCreate, ops = null }) {
  const [rows, setRows] = useState(items);
  // 내가 적어 보낸 것이 그대로 돌아왔으면 그냥 둔다(빈 줄이 살아남는다).
  // 다듬기·되돌리기처럼 **바깥에서 글이 바뀌었을 때만** 다시 읽는다.
  const sameAsMine = useMemo(() => {
    const sig = (rs) => rs.filter(r => String(r?.what || '').trim()).map(formatActionLine).join('\n');
    return sig(rows) === sig(items);
  }, [rows, items]);
  useEffect(() => { if (!sameAsMine) setRows(items); }, [items]);   // eslint-disable-line react-hooks/exhaustive-deps

  const shown = ops ? items : (editable ? rows : items);
  const pending = useMemo(() => shown.filter(it => !matchSubtask(it, subtasks)), [shown, subtasks]);
  // 고른 것 — 열 때는 아직 업무가 아닌 것이 전부 골라져 있다(대개 다 만든다).
  const [off, setOff] = useState(() => new Set());
  const keyOf = (it, i) => (ops ? it.id : it.raw) || `row-${i}`;
  const picked = pending.filter((it, i) => String(it?.what || '').trim() && !off.has(keyOf(it, i)));

  if (!pending.length) return null;

  const push = (next) => { setRows(next); onChange?.(next); };
  const toggle = (k) => setOff(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const setAt = (i, patch) => (ops ? ops.update(shown[i].id, patch) : push(shown.map((it, k) => (k === i ? { ...it, ...patch } : it))));
  const removeAt = (i) => (ops ? ops.remove(shown[i].id) : push(shown.filter((_, k) => k !== i)));
  const addRow = () => {
    const row = { names: [], name: '', what: '', dueText: '', dueDate: '', raw: ops ? '' : `새 줄 ${Date.now()}` };
    if (ops) ops.add(row); else push([...shown, row]);
  };
  const make = () => {
    if (!picked.length) return;
    // 남는 줄 = 안 고른 것 중 아직 업무가 아닌 것(이미 하위 업무인 줄도 이참에 걷는다)
    const rest = shown.filter(it => !picked.includes(it) && !matchSubtask(it, subtasks));
    onCreate?.(picked.map(it => ({
      id: generateId(), title: it.what, done: false,
      // 이름·기한을 같이 옮긴다(2026-09-22) — 없는 줄은 그냥 비어 있다
      ...(it.names?.length ? { assignee: it.names.join(', ') } : {}),
      ...(it.dueDate ? { due: it.dueDate } : {}),
    })), rest);
    if (!ops) setRows(rest);
    setOff(new Set());
  };

  return (
    <div className="action-items mt-4">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <label className="block text-xs text-fg-muted shrink-0">청년별 담당 업무</label>
        {picked.length > 0 && (
          <span className="inline-flex items-center h-[22px] px-2.5 rounded-full bg-tag-blue text-tag-blue-fg text-[11px] font-semibold">
            선택된 하위 업무 {picked.length}개
          </span>
        )}
      </div>
      <div className="divide-y divide-line/60 border-y border-line">
        {shown.map((it, i) => {
          // 내린 줄은 그리지 않는다 — i는 shown의 자리 그대로라 setAt·removeAt이 안 어긋난다
          if (matchSubtask(it, subtasks)) return null;
          const k = keyOf(it, i);
          const on = !!String(it?.what || '').trim() && !off.has(k);
          return (
            <div key={k} className="flex flex-wrap items-center gap-2 py-2">

              {/* ① 체크 + 담당자 — 두 폭 모두 맨 앞 */}
              <span className="order-1 flex items-center gap-2 min-w-0">
                <input type="checkbox" checked={on} onChange={() => toggle(k)}
                  disabled={!String(it?.what || '').trim()}
                  aria-label={`${it.what || '이 줄'} 고르기`}
                  className="action-check shrink-0 disabled:opacity-40" />
                {editable ? (
                  <OwnerPicker names={it.names || []} members={members}
                    onChange={(names) => setAt(i, { names, name: names[0] || '' })} />
                ) : (it.names?.length ? (
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="flex items-center shrink-0">
                      {it.names.slice(0, 3).map((n, j) => (
                        <Avatar key={n} name={n} className={`flex w-[22px] h-[22px] text-[10px] ${j ? '-ml-1.5 ring-[1.5px] ring-surface' : ''}`} />
                      ))}
                    </span>
                    <span className="text-xs font-semibold text-fg truncate">{namesLabel(it.names)}</span>
                  </span>
                ) : null)}
              </span>

              {/* ③ 지우기 — 좁을 때는 첫 줄 오른쪽 끝, 넓을 때는 줄의 맨 끝 */}
              <span className="order-2 sm:order-3 ml-auto sm:ml-0 flex items-center gap-1 shrink-0">
                {editable && (
                  <button type="button" onClick={() => removeAt(i)} aria-label="이 줄 지우기"
                    className="p-1 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition active:scale-95">
                    <X size={13} />
                  </button>
                )}
              </span>

              {/* ② 할 일 + 기한 — 좁을 때는 **둘째 줄 통째로**, 넓을 때는 가운데를 채운다 */}
              <span className="order-3 sm:order-2 basis-full sm:basis-auto sm:flex-1 flex items-center gap-2 min-w-0">
                {editable ? (
                  <input value={it.what} onChange={(e) => setAt(i, { what: e.target.value })}
                    aria-label="할 일" placeholder="할 일"
                    className="flex-1 min-w-0 h-[34px] px-2.5 text-xs text-fg bg-surface border border-line rounded-md focus:border-accent outline-none transition-colors" />
                ) : (
                  <span className="flex-1 min-w-0 text-xs text-fg-secondary break-words">{it.what}</span>
                )}
                {editable ? (
                  <DatePicker value={it.dueDate || ''}
                    onChange={(v) => setAt(i, { dueDate: v, dueText: '' })}
                    ariaLabel="기한"
                    triggerClassName="shrink-0 inline-flex items-center gap-1 h-[34px] px-2.5 text-[11.5px] text-fg-muted bg-surface border border-line rounded-md hover:bg-surface-hover transition-colors whitespace-nowrap">
                    <span>{it.dueDate ? formatDay(it.dueDate) : '기한'}</span>
                  </DatePicker>
                ) : (it.dueText && <span className="shrink-0 text-[11px] text-fg-muted tabular-nums">{it.dueText}</span>)}
              </span>

            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 pt-2">
        {editable && (
          <button type="button" onClick={addRow}
            className="h-8 px-3 rounded-md border border-dashed border-line text-fg-muted text-xs font-semibold hover:bg-surface-hover transition active:scale-95">
            ＋ 항목 추가
          </button>
        )}
        <span className="flex-1" />
        {picked.length > 0 && (
          // 골랐을 때만 서는 버튼이라 불쑥 튀어나온다 — 아래에서 살짝 올라오며 든다
          <button type="button" onClick={make}
            className="h-9 px-4 rounded-md bg-accent hover:bg-accent-strong text-white text-xs font-semibold transition active:scale-95 animate-in fade-in slide-in-from-bottom-1 duration-200">
            하위 업무로
          </button>
        )}
      </div>
    </div>
  );
}

// ── 하위 업무 (체크리스트) ────────────────────────────────────────────────
// 사역 업무는 대개 여러 단계인데, 본문 마크다운 불릿으로 적으면 진척에 안 잡힌다.
// cards.subtasks(jsonb) 컬럼 하나로 둔다 — 카드와 언제나 같이 읽고 쓰므로 조인
// 테이블이 필요 없고, 컬럼 통째 쓰기라 저장이 겹쳐도 깨지지 않는다(0013에서
// 담당자를 조인으로 옮겼다가 겹친 저장이 duplicate key로 깨졌던 것과 반대 성질).
//
// 맡은 사람·기한(2026-09-24 그릴링): 담당 업무에서 내려온 줄은 이 둘을 들고 온다. 내린 뒤로는
// **여기가 기준이다** — 위와 같은 OwnerPicker·DatePicker로 고친다(모든 카드).
// assignee는 `'노준석, 박지호'` 글자로 둔다(0013 이후 jsonb 모양 그대로 — 칸을 늘리지 않았다).
// 줄 짜임은 ActionItems와 같은 order/basis 한 벌이다:
//   좁은 화면 → 첫 줄 [체크][사람] … [🗑] · 둘째 줄 [할 일][기한]
//   넓은 화면 → 한 줄 [체크][사람][할 일][기한][🗑]
//
// `onChange(fn, opts)` — fn은 (지금 목록 → 새 목록). **목록을 값으로 넘기지 않는다**: 업무 창(live)은
// 이름을 600ms 뒤에 저장하는데, 그때 이 부품이 들고 있던 목록으로 보내면 그 사이 남이 체크한 줄이 풀린다.
// 부르는 쪽이 지금 카드(스토어)에 fn을 건다. 새 업무 폼은 폼 state에 건다.
//
// `live`(업무 창 · 2026-09-28) — 체크·추가·지우기·사람·기한은 **바로** 저장되고, 이름은 SubtaskTitle이
// 초안을 들고 있다가 600ms 조용하거나 칸을 떠날 때 저장한다(글자마다 쓰지 않는다).
// **끝낸 줄의 이름은 글자(span)로 선다** — 방금 체크한 줄의 취소선을 긋는 자리가 그 글자다(PITFALLS 9-ch ·
// 입력칸에는 그릴 곳이 없다). 그 글자를 누르면 입력칸이 되어 고칠 수 있다.
const ownersOf = (s) => String(s?.assignee || '').split(',').map(x => x.trim()).filter(Boolean);
export const NAME_IDLE_MS = 600;

function SubtaskList({ value = [], onChange, members = [], live = false, register, hold }) {
  const [draft, setDraft] = useState('');
  const { total, done } = subtaskProgress(value);

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange(list => [...list, { id: generateId(), title: t, done: false }]);
    setDraft('');
  };
  // 작은 완료의 손맛(2026-09-25 · index.css `.dc-check-now`·`.dc-strike-now`) — **방금 체크한 줄만** 체크를
  // 선으로 그리고 취소선을 왼쪽에서 긋는다. 실시간으로 남이 체크한 줄·다시 연 창에는 이 값이 없어 그대로
  // 선다. 되돌리면 바로 지운다(움직임 없음). 취소선이 다 그어지면(animationend) 떼어 line-through로 돌아간다.
  const [justDone, setJustDone] = useState(null);
  const toggle = (id) => {
    const cur = value.find(s => s.id === id);
    setJustDone(cur && !cur.done ? id : null);
    onChange(list => list.map(s => (s.id === id ? { ...s, done: !s.done } : s)));
  };
  const rename = (id, title, opts) => onChange(list => list.map(s => (s.id === id ? { ...s, title } : s)), opts);
  // 비우면 키를 뺀다 — 손으로 더한 줄과 같은 모양({id,title,done})으로 돌아간다
  const patch = (id, key, v) => onChange(list => list.map(s => {
    if (s.id !== id) return s;
    const { [key]: _drop, ...rest } = s;
    return v ? { ...rest, [key]: v } : rest;
  }));
  const remove = (id) => onChange(list => list.filter(s => s.id !== id));

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-1.5">
        <label className="block text-xs text-fg-muted shrink-0">하위 업무</label>
        {total > 0 && (
          <span className="text-[11px] font-semibold text-fg-muted tabular-nums">{done}/{total}</span>
        )}
        <span className="flex-1 min-w-[40px]"><Bar ratio={total ? done / total : 0} color="var(--p-blue)" height={3} /></span>
      </div>
      <div className="divide-y divide-line/60 border-y border-line">
        {value.map(s => {
          const owners = ownersOf(s);
          return (
            <div key={s.id} className="subtask-row flex flex-wrap items-center gap-2 py-2">

              {/* ① 체크 + 맡은 사람 — 두 폭 모두 맨 앞 */}
              <span className="order-1 flex items-center gap-2 min-w-0">
                {/* 체크는 한 번에 눌린다 — 하위 업무를 끝낼 때마다 다른 조작을 거치게 하면 아무도 쓰지 않는다 */}
                <button
                  type="button" onClick={() => toggle(s.id)}
                  className="w-[18px] h-[18px] rounded-sm shrink-0 flex items-center justify-center transition-colors duration-[120ms]"
                  style={s.done
                    ? { background: 'var(--app-tag-green-fg)' }
                    : { border: '1.5px solid var(--app-line)' }}
                  aria-pressed={s.done} aria-label={`${s.title} ${s.done ? '완료 취소' : '완료'}`}
                >
                  {/* lucide Check와 같은 선이지만 pathLength=1이 있어야 선으로 그릴 수 있다 */}
                  {s.done && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                      aria-hidden className={`w-[11px] h-[11px] text-white${justDone === s.id ? ' dc-check-now' : ''}`}>
                      <path pathLength="1" d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
                <OwnerPicker names={owners} members={members}
                  onChange={(names) => patch(s.id, 'assignee', names.join(', '))} />
              </span>

              {/* ③ 지우기 — 좁을 때는 첫 줄 오른쪽 끝, 넓을 때는 줄의 맨 끝 */}
              <span className="order-2 sm:order-3 ml-auto sm:ml-0 flex items-center gap-1 shrink-0">
                {/* 한 번 누르면 바로 지워졌다 — 체크박스 옆 작은 휴지통이라 잘못 누르기 쉽고,
                    하위 업무는 실행 취소가 없다. 삭제 확인은 §7대로 ConfirmPopover로 통일한다. */}
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
              </span>

              {/* ② 할 일 + 기한 칩 — 좁을 때는 둘째 줄을 체크 폭만큼 들여서, 넓을 때는 가운데 */}
              <span className="order-3 basis-full pl-[26px] sm:order-2 sm:basis-auto sm:flex-1 sm:pl-0 flex items-center gap-2 min-w-0">
                {live ? (
                  <SubtaskTitle s={s} justDone={justDone === s.id} onStrikeEnd={() => setJustDone(null)}
                    onCommit={(title, release) => rename(s.id, title, { release })} register={register} hold={hold} />
                ) : (
                  // 새 업무 폼은 언제나 입력칸이다 — '눌러서 고치기'로 감추면 고칠 수 있다는 것 자체가 안 보인다
                  <input
                    value={s.title}
                    onChange={e => rename(s.id, e.target.value)}
                    placeholder="예: 포스터 시안 만들기" aria-label="하위 업무"
                    className={`flex-1 min-w-0 text-[13px] bg-transparent border border-transparent rounded-xs px-1.5 py-1 outline-none transition-colors hover:border-line focus:border-accent focus:bg-surface ${s.done ? 'text-fg-faint line-through' : 'text-fg'} placeholder:text-fg-faint`}
                  />
                )}
                <DatePicker value={s.due || ''} onChange={(v) => patch(s.id, 'due', v)} ariaLabel="기한"
                  triggerClassName={`shrink-0 inline-flex items-center gap-1 h-[30px] px-2.5 text-[11.5px] text-fg-muted bg-surface border border-line rounded-md hover:bg-surface-hover transition-colors whitespace-nowrap ${s.due ? '' : 'border-dashed'}`}>
                  <span>{s.due ? formatDay(s.due) : '기한'}</span>
                </DatePicker>
              </span>
            </div>
          );
        })}
        {!total && (
          <p className="py-2.5 text-[11px] text-fg-muted">업무를 여러 개로 나누면 하나씩 체크할 수 있어요</p>
        )}
      </div>
      <input
        value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add}
        // '입력하고 Enter'라고만 적혀 있었는데 onBlur로도 추가된다. 방법을 설명하는
        // 대신 예시를 두는 쪽이 낫다 — '하위 업무'가 무엇인지 모르는 사람에게는
        // 방법보다 "여기에 무엇을 적는 칸인지"가 먼저다.
        placeholder="예: 포스터 시안 만들기" aria-label="하위 업무"
        // px-3 — 글이 위 상세 내용 편집기(p-3)와 같은 x에서 시작한다(사용자 결정 2026-09-25 · 목업 B2)
        className="w-full mt-2 text-[13px] px-3 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint"
      />
    </div>
  );
}

// 초점이 있거나 저장이 밀린 동안만 초안을 든다 — 그 밖에는 스토어의 지금 값(남이 고친 이름)을 그린다.
// 빈 이름은 저장하지 않는다(칸을 떠나면 원래 이름으로 돌아간다). flush는 창을 닫을 때도 불린다(register).
function useNameDraft({ value, onCommit, register, hold, idleMs = NAME_IDLE_MS }) {
  const [draft, setDraft] = useState(null);
  const ref = useRef({ draft: null, timer: null, release: null, focused: false });
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const flush = useCallback(() => {
    const r = ref.current;
    clearTimeout(r.timer); r.timer = null;
    const release = r.release; r.release = null;
    if (!release) return;
    const d = r.draft;
    if (d != null && d.trim()) commitRef.current(d, release);
    else release(true);
  }, []);
  useEffect(() => register?.(flush), [register, flush]);
  useEffect(() => () => flush(), [flush]);
  const change = (v) => {
    const r = ref.current;
    r.draft = v; setDraft(v);
    if (!r.release) r.release = hold ? hold() : () => {};
    clearTimeout(r.timer);
    r.timer = setTimeout(flush, idleMs);
  };
  const focus = () => { ref.current.focused = true; };
  const blur = () => {
    flush();
    ref.current.focused = false; ref.current.draft = null; setDraft(null);
  };
  return { shown: draft ?? value ?? '', change, focus, blur };
}

function SubtaskTitle({ s, justDone, onStrikeEnd, onCommit, register, hold }) {
  const [editing, setEditing] = useState(false);
  const name = useNameDraft({ value: s.title, onCommit, register, hold });
  const inputRef = useRef(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  if (s.done && !editing) {
    // 바깥은 자리(flex-1), 안은 **글자만큼인 인라인**이다 — 취소선을 그리는 요소가 줄 폭이면 줄 끝까지
    // 그었다가 끝나는 순간 글자 폭으로 되돌아왔다(2026-09-28 사용자 지적). 인라인이라 여러 줄도 줄마다 글자 끝까지.
    return (
      <span className="flex-1 min-w-0 text-[13px] break-words px-1.5 py-1 cursor-text" onClick={() => setEditing(true)}>
        <span data-subtask-title=""
          onAnimationEnd={(e) => { if (e.animationName === 'dc-strike' && justDone) onStrikeEnd(); }}
          className={`text-fg-faint line-through${justDone ? ' dc-strike-now' : ''}`}>{s.title}</span>
      </span>
    );
  }
  return (
    <input ref={inputRef} data-subtask-title=""
      value={name.shown}
      onChange={e => name.change(e.target.value)}
      onFocus={name.focus}
      onBlur={() => { name.blur(); setEditing(false); }}
      onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      placeholder="예: 포스터 시안 만들기" aria-label="하위 업무"
      className={`flex-1 min-w-0 text-[13px] bg-transparent border border-transparent rounded-xs px-1.5 py-1 outline-none transition-colors hover:border-line focus:border-accent focus:bg-surface ${s.done ? 'text-fg-faint line-through' : 'text-fg'} placeholder:text-fg-faint`}
    />
  );
}

// ── 새 업무 만들기 폼 ─────────────────────────────────────────────────────
// 폼 state(formData)에 모았다가 창 아래 `만들기`로 한 번에 만든다(TaskModalShell handleCreate).
// 만들고 나면 창이 그 카드의 '연 채로 고치기'(TaskLive)로 넘어간다.
const TaskEditor = React.memo(({ formData, setFormData, members = [], cloudMode, userId, isAdmin, onFileActivity, pendingFiles = [], setPendingFiles, titleRef }) => {
  const [isAiLoading, setIsAiLoading] = useState(false);
  // 다듬기 직전 본문. 있으면 '되돌리기'가 보인다. 창을 닫으면 잊는다 —
  // "방금 다듬었는데 마음에 안 든다"가 실제 상황이고, 그 이상은 편집 이력 관리다.
  // ponytail: 직전 하나만 기억한다. 두 번 다듬고 두 번 되돌릴 일은 아직 없었다.
  const [beforePolish, setBeforePolish] = useState(null);

  const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  const set = useCallback((fn) => setFormData(prev => fn(prev)), [setFormData]);

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
    if (!polished || isFallbackText(polished)) { showToast(polished || '다듬지 못했어요\n잠시 후 다시 시도해주세요'); return; }
    setBeforePolish(before);
    setFormData(prev => ({ ...prev, content: polished }));
  };
  const undoPolish = () => {
    setFormData(prev => ({ ...prev, content: beforePolish }));
    setBeforePolish(null);
  };

  return (
    <form className="space-y-4" onSubmit={e => e.preventDefault()}>
      {/* 모바일은 autoFocus 금지 — 열자마자 키보드가 화면 절반을 덮는다 */}
      <input ref={titleRef} type="text" name="title" value={formData.title || ''} onChange={handleChange} placeholder="업무 제목 입력" aria-label="업무 제목 입력" className="w-full text-xl md:text-2xl font-bold tracking-[-0.25px] text-fg placeholder:text-fg-faint bg-transparent border-none outline-none focus:ring-0 p-0" required autoFocus={!isMobileViewport()} />

      <TaskProps data={formData} set={set} members={members} />

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
        {/* **편집기는 그 도막을 감춘 글만 본다**(2026-09-22). 도막은 아래 부품이 소유하고,
            고칠 때마다 `writeActionSection`이 본문 맨 아래에 도로 적는다 — 고치는 길이
            둘이면 두 글이 어긋난다. 저장 자리는 여전히 본문 하나다(새 칸을 안 만들었다). */}
        <Suspense fallback={<EditorSkeleton />}>
          <MarkdownEditor
            value={stripActionSection(formData.content || '')}
            onChange={(val) => setFormData(prev => ({
              ...prev, content: writeActionSection(val, parseActionItems(prev.content)),
            }))}
            members={members} cloudMode={cloudMode}
            placeholder={cloudMode ? '내용을 입력하세요. @이름 멘션, 이미지 붙여넣기(Ctrl/⌘+V)도 돼요.' : '내용을 입력하세요. @이름 멘션을 쓸 수 있어요.'}
            className="min-h-40 md:min-h-56 border border-line rounded-md rounded-t-none p-3 bg-surface focus-within:border-accent focus-within:shadow-soft transition-all"
          />
        </Suspense>
        {/* 다듬기가 뽑아 둔 줄은 **여기서 바로 고친다** — 저장해야 부품이 뜨던 것을
            고쳤다(사용자 지적 2026-09-22 "왜 갑자기 체크박스가 생기지?"). */}
        <ActionItems
          items={parseActionItems(formData.content)}
          subtasks={formData.subtasks || []}
          members={members}
          editable
          onChange={(next) => setFormData(prev => ({
            ...prev, content: writeActionSection(stripActionSection(prev.content), next),
          }))}
          // 내린 줄은 본문 도막에서 빠진다 — 남은 줄만 도로 적는다
          onCreate={(made, rest) => setFormData(prev => ({
            ...prev,
            subtasks: [...(prev.subtasks || []), ...made],
            content: writeActionSection(stripActionSection(prev.content), rest),
          }))}
        />
      </div>

      <SubtaskList
        value={formData.subtasks || []}
        members={members}
        onChange={(fn) => setFormData(prev => ({ ...prev, subtasks: fn(prev.subtasks || []) }))}
      />

      {/* 새 업무도 처음부터 첨부를 고를 수 있다 — 실제 업로드는 만든 직후(카드 id가 생긴 뒤) */}
      {cloudMode && <PendingAttachments files={pendingFiles} onChange={setPendingFiles} />}
    </form>
  );
});

// ── 속성 칸 한 벌 — 새 업무 폼과 업무 창(연 채로 고치기)이 같이 쓴다 ─────────────
// `set(fn)` — fn은 (지금 카드 → 새 카드). 새 업무 폼은 폼 state에, 업무 창은 스토어의 지금 카드에 걸고
// **곧바로 저장**한다(TaskModalShell commit — 바뀐 칸만).
function TaskProps({ data, set, members }) {
  const toggleTeam = (team) => set(prev => ({ ...prev, teams: (prev.teams || []).includes(team) ? prev.teams.filter(t => t !== team) : [...(prev.teams || []), team] }));
  return (
    <div className="border-y border-line divide-y divide-line/60">
      <PropertyRow icon={<CheckSquare size={13} className="text-fg-faint" />} label="상태">
        <div className="flex flex-wrap gap-1.5">
          {/* 상시는 맨 아래(config STATUS_PICK). 상시로 고르는 순간 날짜 두 칸을 비운다 —
              상시는 마감이 없는 업무이고, 칸을 숨기기만 하면 옛 날짜가 남아 달력·마감 셈에 선다.
              저장 쪽(domain.updateWithLogs)도 같은 일을 한 번 더 한다. */}
          {CONFIG.STATUS_PICK.map(s => (
            <button key={s} type="button" onClick={() => set(prev => (s === CONFIG.STATUS_ONGOING
              ? { ...prev, status: s, startDate: '', dueDate: '' }
              : { ...prev, status: s }))}
              aria-pressed={(data.status || '시작 전') === s}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all active:scale-95 ${(data.status || '시작 전') === s ? CONFIG.STATUS_STYLES[s] + ' border-transparent shadow-soft' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
              {s}
            </button>
          ))}
        </div>
      </PropertyRow>
      {data.status !== CONFIG.STATUS_ONGOING && (
        <>
          <PropertyRow icon={<CalendarRange size={13} className="text-fg-faint" />} label="시작일">
            <DatePicker value={data.startDate || ''} onChange={(v) => set(prev => ({ ...prev, startDate: v }))} />
          </PropertyRow>
          <PropertyRow icon={<Clock size={13} className="text-fg-faint" />} label="마감일">
            <DatePicker value={data.dueDate || ''} onChange={(v) => set(prev => ({ ...prev, dueDate: v }))} />
          </PropertyRow>
        </>
      )}
      <PropertyRow icon={<Hash size={13} className="text-fg-faint" />} label="담당 팀">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(CONFIG.TEAMS).map(([team, colorClass]) => {
            const selected = (data.teams || []).includes(team);
            return (
              <button key={team} type="button" onClick={() => toggleTeam(team)} aria-pressed={selected}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all active:scale-95 ${selected ? colorClass + ' border-transparent shadow-soft' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
                {team}
              </button>
            );
          })}
        </div>
      </PropertyRow>
      <PropertyRow icon={<User size={13} className="text-fg-faint" />} label="담당자">
        <AssigneePicker value={data.assignees || []} onChange={(next) => set(prev => ({ ...prev, assignees: next }))} members={members} />
      </PropertyRow>
      {/* 선행 업무(0020) — 이 업무보다 먼저 끝나야 하는 것. 같은 프로젝트 안에서만 고른다
          (프로젝트를 건너 잇기 시작하면 그래프가 화면 하나에 안 담긴다).
          네이티브 <select>다: 목록이 길어도 모바일에서 OS가 알아서 잘 굴려 준다. */}
      <DependsRow formData={data} setFormData={set} />
    </div>
  );
}

// 제목 칸 — 초점이 있거나 저장이 밀린 동안만 초안(useNameDraft), 600ms 조용하거나 떠날 때 저장.
// Enter는 칸을 떠난다(조합을 끝내는 Enter는 무시 · utils.imeComposing). 빈 제목은 저장하지 않고
// 떠나면 원래 제목으로 돌아간다(cards.title not null).
function TitleField({ value, onCommit, register, hold }) {
  const name = useNameDraft({ value, onCommit, register, hold });
  return (
    <input type="text" name="title" value={name.shown}
      onChange={e => name.change(e.target.value)} onFocus={name.focus} onBlur={name.blur}
      onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      placeholder="업무 제목 입력" aria-label="업무 제목 입력"
      className="w-full text-xl md:text-2xl font-bold tracking-[-0.25px] text-fg placeholder:text-fg-faint bg-transparent border-none outline-none focus:ring-0 p-0" />
  );
}

// ── 3줄 요약 (예전 보기 화면에서 옮겼다) ─────────────────────────────────────
// 버튼은 '상세 내용' 줄의 AI 다듬기 옆, 요약은 그 줄 위에 선다. 규칙은 그대로다(PITFALLS 19 · §4.4).
function useTaskSummary(formData, cloudMode) {
  const [summary, setSummary] = useState('');      // 이번에 AI가 만든 것(고정 전)
  const [revealed, setRevealed] = useState(false); // 고정된 요약을 펼쳤는지
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // 고정된 요약은 카드에 남아 있어서(0015의 cards.ai_summary) 다른 사람도 본다.
  // **열자마자 펼치지는 않는다** — 버튼을 눌러서 나오는 편이, 요약이라는 기능이
  // 있다는 것과 자기가 그걸 불렀다는 것을 같이 알려준다.
  const pinned = formData.aiSummary || '';
  // 이번에 만든 것이 있으면 그것이 먼저다(`pinned || summary`로 쓰면 '다시 만들기'가 죽는다)
  const shown = summary || (revealed ? pinned : '');
  const showingPinned = !!pinned && shown === pinned;
  // AI 기능(요약 고정·고치기)은 **마스터만**(0028) — AI는 돈이 들고 워크스페이스 전체에 남는 글을 만든다.
  const { isMaster } = useAuth();
  const canPin = cloudMode && isMaster && !!formData.id;

  const runAi = async () => {
    setIsAiLoading(true);
    const result = await AiService.summarizeTask(formData);
    setSummary(result);
    setIsAiLoading(false);
  };
  // 고정된 요약도 '분석하는 중'을 한 번 지나서 나온다 — 같은 버튼이 사람마다 다르게 동작하지 않게.
  // 일부러 넣은 지연이다(성능 문제가 아니다).
  const REVEAL_MS = 2000;
  const revealPinned = async () => {
    setIsAiLoading(true);
    await new Promise(r => setTimeout(r, REVEAL_MS));
    setRevealed(true);
    setIsAiLoading(false);
  };
  const handleSummarize = () => (pinned ? revealPinned() : runAi());

  // 고정/해제 — 카드 저장과 분리된 경로다(요약 세 칸만 건드린다)
  const setPinnedSummary = async (text) => {
    setPinning(true);
    store.dispatch({ type: 'SYNC_TASK', payload: { id: formData.id, aiSummary: text, aiSummaryBy: text ? '나' : '', aiSummaryAt: text ? new Date().toISOString() : '' } });
    try {
      await cardSummaryCloud(formData.id, text);
      setSummary('');
      setRevealed(!!text);
    } catch (e) {
      console.error('[cloud] 요약 고정 실패:', e);
      showToast('요약을 고정하지 못했어요\n잠시 후 다시 시도해주세요');
    }
    setPinning(false);
  };
  const startEdit = () => { setDraft(shown); setEditing(true); };
  const saveEdit = async () => {
    const text = draft.trim();
    if (!text) return;
    setEditing(false);
    await setPinnedSummary(text);
  };

  // 요약 버튼은 hover로 숨기지 않는다 — 터치 기기에는 hover가 없다. 고정된 게 있어도 이 버튼이 먼저다.
  const button = !shown && (formData.content || pinned) ? (
    <button type="button" onClick={handleSummarize} disabled={isAiLoading}
      className="flex items-center gap-1 px-2 py-1 bg-tag-purple text-tag-purple-fg hover:opacity-80 rounded-full text-[10px] font-bold transition active:scale-95 disabled:opacity-40">
      {isAiLoading ? <span className="animate-pulse">요약하는 중...</span> : <><Wand2 size={12} /> 3줄 요약</>}
    </button>
  ) : null;

  // 요약 — ✨를 빼고 왼쪽 선으로 "본문이 아닌 덧말"임을 표시
  const block = (shown || isAiLoading) ? (
    <div className="pl-3 border-l-2 border-tag-purple-fg/40 animate-in fade-in duration-200">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-bold text-tag-purple-fg">3줄 요약</span>
        {/* '고정' 배지는 지금 보고 있는 것이 저장된 요약이고 고정할 수 있는 사람일 때만 */}
        {showingPinned && canPin && (
          <span className="inline-flex items-center gap-1 text-[10px] text-fg-muted"><Pin size={9} />고정</span>
        )}
        {/* 고정한 뒤에 카드가 바뀌었으면 마스터에게만 알려준다(문구는 사용자가 정했다 · 2026-08-29) */}
        {showingPinned && canPin && summaryOutdated(formData.updatedAt, formData.aiSummaryAt) && (
          <span className="text-[10px] text-fg-muted">· 고정한 뒤로 업무가 바뀌었어요</span>
        )}
      </div>
      {isAiLoading
        ? <div className="text-xs text-fg-muted animate-pulse">업무 내용과 댓글을 분석하고 있습니다...</div>
        : editing
          ? <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={5} autoFocus aria-label="3줄 요약"
              className="w-full text-xs leading-relaxed text-fg bg-surface border border-line rounded-xs px-2 py-1.5 outline-none focus:border-accent resize-y" />
          : <div className="text-xs text-fg-secondary whitespace-pre-wrap"><RichText content={shown} /></div>}
      {/* 고정·고치기는 마스터만 — 아무나 덮어쓰면 마지막 사람 것만 남는다 */}
      {canPin && !isAiLoading && (
        <div className="flex gap-2 mt-1.5">
          {/* 저장이 왼쪽, 취소가 오른쪽 — '고치기'를 누른 자리에 '저장'이 와야 손가락 밑의 뜻이 안 바뀐다 */}
          {editing ? (
            <>
              <button type="button" onClick={saveEdit} disabled={pinning || !draft.trim()}
                className="text-[10px] font-semibold text-accent-text hover:underline transition-colors disabled:opacity-40">
                {pinning ? '저장하는 중...' : '저장'}
              </button>
              <button type="button" onClick={() => setEditing(false)} disabled={pinning}
                className="text-[10px] text-fg-muted hover:text-fg transition-colors disabled:opacity-40">취소</button>
            </>
          ) : showingPinned ? (
            <>
              <button type="button" onClick={startEdit} disabled={pinning}
                className="text-[10px] font-semibold text-accent-text hover:underline transition-colors disabled:opacity-40">고치기</button>
              <button type="button" onClick={runAi} disabled={pinning}
                className="text-[10px] text-accent-text hover:underline transition-colors disabled:opacity-40">다시 만들기</button>
              <button type="button" onClick={() => setPinnedSummary('')} disabled={pinning}
                className="text-[10px] text-fg-muted hover:text-fg transition-colors disabled:opacity-40">고정 해제</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setPinnedSummary(shown)} disabled={pinning || !shown}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent-text hover:underline transition-colors disabled:opacity-40">
                <Pin size={9} />{pinning ? '고정하는 중...' : (pinned ? '이 요약으로 바꾸기' : '이 요약 고정')}
              </button>
              <button type="button" onClick={startEdit} disabled={pinning || !shown}
                className="text-[10px] text-accent-text hover:underline transition-colors disabled:opacity-40">고쳐서 고정</button>
            </>
          )}
        </div>
      )}
    </div>
  ) : null;
  return { button, block };
}

// ── 업무 창 — 연 채로 고치기 (있는 업무) ─────────────────────────────────────
// task는 **스토어의 지금 카드**다(창이 사본을 들지 않는다). 무엇이 언제 저장되는지는 TaskModalShell 머리말.
// 본문은 셋 중 하나다:
//   · co(같이 쓰기가 섰다)      편집기에 collab을 넘긴다 — 원본은 Yjs 문서, 저장은 거울(조용히)
//   · coPending(아직 여는 중)   뼈대(EditorSkeleton) — 편집기 조각과 문서를 받는 동안
//   · 그 밖(게스트 · 못 열었다) 이 부품이 마크다운을 들고 있다가 800ms 조용하면 조용히 저장하고,
//                               닫을 때 세션 한 번(onSession → 활동 한 줄 · 새 멘션)
export const BODY_IDLE_MS = 800;
function TaskLive({ task, commit, register, hold, onSession, co, coPending, members, cloudMode, userId, isAdmin, onFileActivity, diffPick, onRestore, onExitDiff }) {
  const set = useCallback((fn) => commit(cur => fn(cur)), [commit]);
  const summary = useTaskSummary(task, cloudMode);

  // ── 본문(같이 쓰기가 아닐 때) ──
  const [body, setBody] = useState(() => task.content || '');
  const b = useRef({ md: task.content || '', start: task.content || '', timer: null, release: null, touched: false });
  const flushBody = useCallback(() => {
    const r = b.current;
    clearTimeout(r.timer); r.timer = null;
    const release = r.release; r.release = null;
    if (release) commit({ content: r.md }, { silentContent: true, release });
  }, [commit]);
  const setBodyNow = useCallback((md) => {
    const r = b.current;
    r.md = md; r.touched = true; setBody(md);
    if (!r.release) r.release = hold();
    clearTimeout(r.timer);
    r.timer = setTimeout(flushBody, BODY_IDLE_MS);
  }, [hold, flushBody]);
  useEffect(() => register(flushBody), [register, flushBody]);
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;
  // 닫힐 때(다른 업무로 넘어갈 때도) — 밀린 본문을 흘리고, 고쳤으면 세션 한 번
  useEffect(() => () => {
    flushBody();
    const r = b.current;
    if (r.touched) onSessionRef.current?.(r.start, r.md);
  }, [flushBody]);

  // ── AI 문맥 다듬기 ──
  // 같이 쓰기면 **통째로 갈기**(replaceAll — 한 트랜잭션이라 남에게는 편집 한 번 · 되돌리기 한 걸음),
  // 아니면 이 부품의 마크다운을 바꾼다(편집기가 바깥 값으로 문서를 갈아 끼운다).
  const [isAiLoading, setIsAiLoading] = useState(false);
  // 다듬기 직전 본문. 있으면 '되돌리기'가 보인다. 창을 닫으면 잊는다.
  // ponytail: 직전 하나만 기억한다. 두 번 다듬고 두 번 되돌릴 일은 아직 없었다.
  const [beforePolish, setBeforePolish] = useState(null);
  const currentMd = () => (co ? co.markdown() : b.current.md);
  const handleAiPolish = async () => {
    const before = currentMd();
    if (!String(before || '').trim()) return;
    setIsAiLoading(true);
    const polished = await AiService.polishText(before, { ...task, content: before });
    setIsAiLoading(false);
    // **안내 문구를 본문에 넣지 않는다** — 게스트·세션 만료에서 쓰던 글이 안내 한 줄로 갈아치워졌다
    if (!polished || isFallbackText(polished)) { showToast(polished || '다듬지 못했어요\n잠시 후 다시 시도해주세요'); return; }
    setBeforePolish(before);
    if (co) co.replaceAll(polished); else setBodyNow(polished);
  };
  const undoPolish = () => {
    if (co) co.replaceAll(beforePolish); else setBodyNow(beforePolish);
    setBeforePolish(null);
  };

  // ── 청년별 담당 업무 ──
  // 같이 쓰기면 줄을 Yjs 배열에서 읽고 줄 단위로 고친다(co.actions — 본문 마크다운 꼬리를 다시 쓰지 않는다 ·
  // 남이 다른 줄을 고친 것이 살아남는다). 아니면 예전처럼 본문 도막을 읽고 도로 적는다.
  const [coItems, setCoItems] = useState(() => (co ? co.actions.read() : []));
  useEffect(() => {
    if (!co) return undefined;
    setCoItems(co.actions.read());
    return co.actions.observe(setCoItems);
  }, [co]);
  const actionOps = useMemo(() => (co ? {
    add: (item) => co.actions.add(item),
    update: (id, patch) => co.actions.update(id, patch),
    remove: (id) => co.actions.remove(id),
  } : null), [co]);
  // 내린 줄 → 하위 업무(바로 저장) · 남은 줄만 담당 업무에
  const onCreateSubtasks = (made, rest) => {
    if (co) {
      co.actions.replace(rest);
      commit(cur => ({ ...cur, subtasks: [...(cur.subtasks || []), ...made] }));
      return;
    }
    const md = writeActionSection(stripActionSection(b.current.md), rest);
    const r = b.current;
    r.md = md; r.touched = true; setBody(md);
    clearTimeout(r.timer); r.timer = null;
    const release = r.release; r.release = null;
    commit(cur => ({ ...cur, subtasks: [...(cur.subtasks || []), ...made], content: md }), { silentContent: true, release });
  };

  const editorClass = 'min-h-40 md:min-h-56 border border-line rounded-md rounded-t-none p-3 bg-surface focus-within:border-accent focus-within:shadow-soft transition-all';
  const placeholder = cloudMode ? '내용을 입력하세요. @이름 멘션, 이미지 붙여넣기(Ctrl/⌘+V)도 돼요.' : '내용을 입력하세요. @이름 멘션을 쓸 수 있어요.';
  let editor;
  if (co) {
    // 같이 쓰기 — value는 보지 않는다(원본은 Yjs 문서 · MarkdownEditor collab 머리말)
    editor = (
      <Suspense fallback={<EditorSkeleton />}>
        <MarkdownEditor key="coedit" collab={co.collab} value="" onChange={NOOP}
          members={members} cloudMode={cloudMode} placeholder={placeholder} className={editorClass} />
      </Suspense>
    );
  } else if (coPending) {
    editor = <EditorSkeleton />;
  } else {
    editor = (
      <Suspense fallback={<EditorSkeleton />}>
        {/* **편집기는 그 도막을 감춘 글만 본다**(2026-09-22) — 도막은 아래 부품이 소유한다 */}
        <MarkdownEditor key="plain" value={stripActionSection(body)}
          onChange={(val) => setBodyNow(writeActionSection(val, parseActionItems(b.current.md)))}
          members={members} cloudMode={cloudMode} placeholder={placeholder} className={editorClass} />
      </Suspense>
    );
  }

  return (
    <div className="space-y-4">
      <TitleField value={task.title} onCommit={(title, release) => commit({ title }, { release })} register={register} hold={hold} />
      <TaskProps data={task} set={set} members={members} />

      {summary.block}
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
            {summary.button}
            <button type="button" onClick={handleAiPolish} disabled={isAiLoading || coPending || (!co && !body)} className="flex items-center gap-1 px-2 py-1 bg-tag-purple text-tag-purple-fg hover:opacity-80 rounded-full text-[10px] font-bold transition active:scale-95 disabled:opacity-40">
              {isAiLoading ? <span className="animate-pulse">다듬는 중...</span> : <><Wand2 size={12} /> AI 문맥 다듬기</>}
            </button>
          </div>
        </div>
        {/* 버전 기록에서 판을 고르면 본문 자리에 그 판의 고친 곳이 선다 — 편집기는 **내리지 않고** 숨긴다
            (같이 쓰기의 되돌리기 기록·커서가 그대로 남는다) */}
        {diffPick && <VersionDiffView pick={diffPick} onRestore={onRestore} onExit={onExitDiff} />}
        <div className={diffPick ? 'hidden' : ''}>{editor}</div>
        {/* 다듬기가 뽑아 둔 줄은 **여기서 바로 고친다** */}
        <ActionItems
          items={co ? coItems : parseActionItems(body)}
          ops={actionOps}
          subtasks={task.subtasks || []}
          members={members}
          editable
          onChange={(next) => setBodyNow(writeActionSection(stripActionSection(b.current.md), next))}
          onCreate={onCreateSubtasks}
        />
      </div>

      <SubtaskList live value={task.subtasks || []} members={members} register={register} hold={hold}
        onChange={(fn, opts) => commit(cur => ({ ...cur, subtasks: fn(cur.subtasks || []) }), opts)} />

      {cloudMode && <AttachmentSection task={task} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity} />}
    </div>
  );
}
const NOOP = () => {};

