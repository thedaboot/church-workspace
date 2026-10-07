import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { CheckSquare, X, Trash2, Check, Maximize2, Minimize2, PanelRight, PanelRightClose, Loader2 } from 'lucide-react';
import { CONFIG } from '../config.js';
import { formatDate, isMobileViewport, taskEditDirty, taskChangedKeys, toggleTodoLine } from '../utils.js';
import { store, useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { parseActionItems, stripActionSection, writeActionSection } from '../services/actionItems.js';
import { useCoedit, CoeditFaces, VersionPanel, VersionDiffView, useCoeditFaces, PresencePill, PresenceMarks, useLiveMarkdown, docSource, useDevFake } from './coedit.jsx';
import { RichText } from '../components/RichText.jsx';
import { AttachmentSection, PendingAttachments, startUploads } from './attachments.jsx';
import { CommentPanel, ActivityPanel, CommentInput } from './comments.jsx';
import { DependsViewRow, TaskProps, TitleField } from './taskFields.jsx';
import { ActionItems, SubtaskList } from './taskLists.jsx';
import { useTaskSummary, usePolish, BodyHead } from './taskSummary.jsx';
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
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { useAuth } from '../services/auth.jsx';
import { isMyUid } from '../services/supabaseClient.js';
import { getMemberNames, loadCardDetail, cardWritePromise } from '../services/cloudSync.js';
import { ShareButton } from '../components/ShareButton.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { showToast } from '../components/Toast.jsx';
import { trackEditing } from '../services/presence.js';

// ============================================================================
// 업무 창 — 보기(TaskView · 기본) / 수정(TaskLive · 칸마다 저절로 저장) / 만들기 폼(TaskEditor · 새 업무) /
// 그 껍데기(TaskModalShell)
// ----------------------------------------------------------------------------
// 2026-09-29부터 **보기가 기본이고 `수정`을 누르면 그 자리에서 수정 화면**이 된다(목업 승인). 수정 화면에는
// 저장 버튼이 없다 — 칸마다 저절로 저장하고 `수정 완료`가 밀린 쓰기를 흘린 뒤 보기로 돌아온다(TaskModalShell 머리말).
// 같이 뜨는 영역은 파일을 나눠 뒀다:
//   속성 칸·담당자 고르기·제목 칸 → taskFields.jsx
//   청년별 담당 업무·하위 업무 → taskLists.jsx
//   3줄 요약·AI 문맥 다듬기 → taskSummary.jsx
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


// ── 업무 창 (2026-09-28 · 저장 버튼 없음 + 같이 쓰기 · 2026-09-29 보기/수정 나눔 · 목업 승인) ──────
// **있는 업무는 보기 화면으로 연다**(TaskView — 상태 점 + 제목 · 담당자·기간 줄 · 그린 본문 · 3줄 요약 · 담당 업무 ·
// 하위 업무 · 첨부). 보기에서도 가벼운 조작은 그대로 된다 — 하위 업무 체크 · 본문 체크리스트 · 담당 업무 내리기는
// 누르는 즉시 아래와 같은 저장 길(바뀐 칸만)로 간다. 아래 줄: 삭제 · 메타 · `수정`(연한 accent) · `닫기`.
// `수정`을 누르면 그 자리에서 **수정 화면**(TaskLive)이 된다 — 수정·저장 버튼이 없다. 칸마다 그 자리에서 저장한다:
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
// 수정 화면 아래 줄: 삭제 · 메타 · '저장됨' · `수정 완료`(진한 accent — 밀린 쓰기를 흘리고 같이 쓰기 세션을 끝낸 뒤
// 보기로) · `닫기`. 저장하지 않은 것이 없으니 묻는 창도 없다.
//
// **같이 쓰기(클라우드)는 보기 화면에서도 열려 있다** — 문서에 보는 사람으로 들어가 머리줄 얼굴에 선다. awareness에
// `editing`(수정 화면일 때만 true)을 싣고, 보기 화면은 남이 수정 중이면 본문 위 알약 + 그 사람이 있는 줄 표시를,
// 본문은 문서의 마크다운을 그린다(남이 치는 글이 따라온다 · coedit.jsx 머리말).
//
// **새 업무(id 없음)는 예전 만들기 폼 그대로**다 — 확정 버튼 `만들기`. 만들면 App이 창을 그 카드로
// 넘기고, 그 자리에서 그 업무의 보기 화면이 된다(첨부는 예전처럼 카드가 들어간 뒤 올린다).
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
  // 보기(기본) ↔ 수정. 다른 업무로 넘어가면(만들기 뒤 포함) 보기로 연다.
  // 카드가 바뀐 그 렌더에서 곧바로 보기로 돌린다(효과로 돌리면 앞 카드의 수정 화면이 한 번 그려진다).
  const [mode, setMode] = useState('view');
  const [modeCard, setModeCard] = useState(cardId);
  if (modeCard !== cardId) { setModeCard(cardId); setMode('view'); }
  const editing = !isNew && mode === 'edit';
  // 개발 빌드 전용 가짜(얼굴 · 문서 마크다운 · 버전 기록) — 게스트 검사가 그려 본다(coedit.jsx useDevFake · tests/modalclose)
  const fake = useDevFake();
  const awareness = co?.awareness || fake?.awareness || null;
  const faces = useCoeditFaces(awareness);
  // 나 말고 수정 화면에 있는 사람 — 보기 화면의 알약·줄 표시
  const editors = useMemo(() => faces.filter(f => !f.me && f.editing), [faces]);
  // 내가 수정 화면인지 남에게 알린다(awareness `editing`)
  useEffect(() => { awareness?.setLocalStateField('editing', editing); }, [awareness, editing]);
  // 보드 카드 얼굴에도 — 같이 쓰기 문서 밖(presence)이라 창을 열지 않은 사람도 본다
  useEffect(() => { trackEditing(editing); return () => trackEditing(false); }, [editing]);
  // 보기 화면의 본문 — 문서의 마크다운(남이 치는 글이 150ms 안에 따라온다). 문서가 없으면(게스트 · 여는 중 · 실패) null →
  // 스토어의 본문을 그린다.
  const liveSrc = useMemo(() => docSource(co) || fake?.doc || null, [co, fake]);
  const liveMd = useLiveMarkdown(liveSrc);
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
  // 같이 쓰기를 못 열었으면(실패) 되돌리기는 보통 저장이다 — 수정 화면이 들고 있던 본문은 새로 세운다(bodyEpoch).
  const [bodyEpoch, setBodyEpoch] = useState(0);
  const restoreVersion = () => {
    if (!diffPick) return;
    if (co) co.replaceAll(diffPick.version.md);
    else { flushAll(); commit({ content: diffPick.version.md }); setBodyEpoch(n => n + 1); }
    setDiffPick(null);
    // 되돌린 것도 한 판이 된다(세션이 끝날 때) — 목록은 다음에 탭을 열 때 다시 읽는다
    setVersionsKey(k => k + 1);
  };
  const showVersions = (cloudMode && !!cardId) || (!!cardId && !!fake?.versions);
  useEffect(() => { if (!showVersions && (activeTab === 'versions' || mobileTab === 'versions')) { setActiveTab('comments'); setMobileTab('detail'); } },
    [showVersions, activeTab, mobileTab]);

  // ── 보기 ↔ 수정 ───────────────────────────────────────────────────────
  const enterEdit = () => { setMode('edit'); if (isMobile) setMobileTab('detail'); };
  // 수정 완료 — 밀린 쓰기(제목 · 하위 업무 이름 · 게스트 본문)를 흘리고, 같이 쓰기는 세션을 지금 끝낸다(거울 · 판 한 줄 ·
  // 활동 한 줄 — 60초를 기다리지 않는다). 그 뒤 보기로. 수정 화면이 내려가며 게스트 본문의 활동 한 줄도 선다.
  const finishEdit = () => {
    flushAll();
    co?.flush?.()?.catch?.(() => {});
    setMode('view');
  };

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
        {task.id && <CoeditFaces faces={faces} />}
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
      {/* 할 일이 왼쪽, 나가기(닫기)가 오른쪽 — 두 화면에서 닫기 자리가 같다(§8 상시 도구 줄).
          색은 행동에만: 수정 = 편집으로 들어가기(연한 accent) · 수정 완료 = 확정(진한 accent) · 닫기 = 무채색 */}
      <div className="flex items-center gap-2 shrink-0">
        {editing ? (
          <>
            <span className="mr-1 inline-flex"><SaveMark busy={busy > 0} failed={failed} /></span>
            <button type="button" onClick={finishEdit} className="bg-accent hover:bg-accent-strong text-white px-5 py-2 rounded-md text-xs font-semibold transition active:scale-95 whitespace-nowrap">수정 완료</button>
          </>
        ) : (
          <button type="button" onClick={enterEdit} className="bg-accent-weak hover:brightness-95 text-accent-text px-6 py-2 rounded-md text-xs font-semibold transition active:scale-95 whitespace-nowrap">수정</button>
        )}
        <button type="button" onClick={close} className={`${closeBtnCls} whitespace-nowrap`}>닫기</button>
      </div>
    </>
  );
  const detailBody = isNew
    ? <TaskEditor formData={formData} setFormData={setFormData} members={members} cloudMode={cloudMode}
        pendingFiles={pendingFiles} setPendingFiles={setPendingFiles} titleRef={titleRef} />
    // key로 카드마다 새로 마운트한다 — 요약·본문 초안·제목 초안이 카드 사이에 남지 않게(PITFALLS 18)
    : editing
      ? <TaskLive key={`${task.id}:${bodyEpoch}`} task={source} commit={commit} register={register} hold={hold}
          onSession={(start, end) => onSessionRef.current?.(task.id, start, end)}
          co={co} coPending={cloudMode && !co && !coFailed} members={members}
          cloudMode={cloudMode} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity}
          diffPick={diffPick} onRestore={restoreVersion} onExitDiff={() => setDiffPick(null)} />
      : <TaskView key={task.id} task={source} commit={commit} co={co} coPending={cloudMode && !co && !coFailed}
          liveMd={liveMd} editors={editors}
          cloudMode={cloudMode} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity}
          diffPick={diffPick} onRestore={restoreVersion} onExitDiff={() => setDiffPick(null)} />;
  const commentsPanel = listsReady
    /* members: 답글 입력창도 댓글 입력창과 같은 @멘션 자동완성을 쓴다 */
    ? <CommentPanel comments={source.comments} onReply={onAddComment} currentUser={currentUser} onUpdate={onUpdateComment} onDelete={onDeleteComment} loading={detailLoading} members={members} />
    : null;
  const activityPanel = listsReady ? <ActivityPanel logs={source.activityLog} loading={detailLoading} /> : null;
  const versionsPanel = showVersions ? <VersionPanel cardId={task.id} pickedId={diffPick?.version.id} onPick={pickVersion} refreshKey={versionsKey} load={cloudMode ? null : fake?.versions} /> : null;
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
      // 높이는 보이는 창(--app-vh · inset-0과 같이 두면 height가 이긴다 — 여러 검사가 .fixed.inset-0.z-50으로 찾는다) — 아이패드는 이 넓은 창을 쓰는데 키보드가 레이아웃 뷰포트를 줄이지 않아
      // 창 아래의 댓글 칸이 키보드 밑에 남았다(사용자 지적 2026-10-05 · 폰 창의 2026-09-22 고침과 같은 길 · PITFALLS 33-v)
      className={`fixed inset-0 h-[var(--app-vh,100dvh)] bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-150 ${expanded ? 'p-0' : 'p-2 md:p-4'}`}
    >
      {/* 전체 화면이면 창이 뷰포트를 다 쓴다 — 딤·모서리·최대 폭이 전부 사라져야
          "확대된 창"이 아니라 "전체 화면"으로 읽힌다. 복귀 버튼은 헤더의 같은 자리. */}
      <div className={`bg-surface shadow-elevated border border-line w-full flex flex-col md:flex-row overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${expanded ? 'max-w-none h-full rounded-none border-0' : 'max-w-5xl h-[100dvh] md:h-[min(85dvh,calc(var(--app-vh,100dvh)-2rem))] rounded-lg'}`}>
        {/* 스크롤 막대 자리를 늘 잡아 둔다 — 보기(짧다)와 수정(길다)을 오갈 때 막대가 생겼다 없어지며 닫기·본문이 옆으로 뛰었다 */}
        <div className="flex-1 min-w-0 flex flex-col border-r-0 md:border-r border-line overflow-y-auto [scrollbar-gutter:stable]">
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

// ── 새 업무 만들기 폼 ─────────────────────────────────────────────────────
// 폼 state(formData)에 모았다가 창 아래 `만들기`로 한 번에 만든다(TaskModalShell handleCreate).
// 만들고 나면 창이 그 카드의 '연 채로 고치기'(TaskLive)로 넘어간다.
const TaskEditor = React.memo(({ formData, setFormData, members = [], cloudMode, pendingFiles = [], setPendingFiles, titleRef }) => {
  const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  const set = useCallback((fn) => setFormData(prev => fn(prev)), [setFormData]);

  // AI 결과(마크다운)는 content로 넣으면 MarkdownEditor가 파서를 거쳐 문서로 반영한다(taskSummary.usePolish)
  const polish = usePolish({
    read: () => formData.content || null,
    write: (md) => setFormData(prev => ({ ...prev, content: md })),
    context: () => formData,
  });

  return (
    <form className="space-y-4" onSubmit={e => e.preventDefault()}>
      {/* 모바일은 autoFocus 금지 — 열자마자 키보드가 화면 절반을 덮는다 */}
      <input ref={titleRef} type="text" name="title" value={formData.title || ''} onChange={handleChange} placeholder="업무 제목 입력" aria-label="업무 제목 입력" className="w-full text-xl md:text-2xl font-bold tracking-[-0.25px] text-fg placeholder:text-fg-faint bg-transparent border-none outline-none focus:ring-0 p-0" required autoFocus={!isMobileViewport()} />

      <TaskProps data={formData} set={set} members={members} />

      <div>
        <BodyHead polish={polish} disabled={polish.loading || !formData.content} />
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

// 같이 쓰기의 담당 업무 줄(Y.Array) — 보기·수정 화면이 같이 쓴다. 줄 단위로 고친다(co.actions · 본문 꼬리를
// 다시 쓰지 않는다 — 남이 다른 줄을 고친 것이 살아남는다).
function useCoActions(co) {
  const [items, setItems] = useState(() => (co ? co.actions.read() : []));
  useEffect(() => {
    if (!co) return undefined;
    setItems(co.actions.read());
    return co.actions.observe(setItems);
  }, [co]);
  const ops = useMemo(() => (co ? {
    add: (item) => co.actions.add(item),
    update: (id, patch) => co.actions.update(id, patch),
    remove: (id) => co.actions.remove(id),
  } : null), [co]);
  return { items, ops };
}

// ── 업무 창 — 보기 (있는 업무의 기본 화면 · 2026-09-29 되살렸다) ──────────────────
// 2026-09-28 이전 보기 화면의 짜임 그대로다: 상태 점 + 팀 · 제목 · 담당자/시작일/마감일/선행 업무 줄 · 3줄 요약 ·
// 그린 본문(RichText — 체크리스트는 눌린다) · 청년별 담당 업무(고르고 '하위 업무로') · 하위 업무(체크만) · 첨부(읽기).
// 가벼운 조작은 모두 **바로 저장**이다(commit — 바뀐 칸만). 본문을 고치는 것(체크리스트 · 담당 업무 내리기)은
// 같이 쓰기가 열려 있으면 문서에서 고친다 — description에 곧장 쓰면 문서가 모르고 다음 거울이 되돌린다(32-zq와 같은 까닭).
// 문서를 여는 동안(coPending)은 본문 체크를 잠깐 막는다(같은 까닭).
//
// 본문은 liveMd(문서의 마크다운 · 남이 치는 글이 따라온다)가 있으면 그것, 없으면 스토어의 본문이다.
// editors(나 말고 수정 화면에 있는 사람)가 있으면 본문 위 알약과 그 사람이 있는 줄 표시(coedit.jsx)가 선다.
// **본문 통은 오른쪽 28px(pr-7)을 늘 비워 둔다** — 줄 표시 얼굴이 그 안에 서서 잘리지 않고, 누가 들어와도 글줄이 다시 흐르지 않는다.
function TaskView({ task, commit, co, coPending, liveMd, editors = [], cloudMode, userId, isAdmin, onFileActivity, diffPick, onRestore, onExitDiff }) {
  const summary = useTaskSummary(task, cloudMode);
  const md = liveMd ?? task.content ?? '';
  const [bodyEl, setBodyEl] = useState(null);   // 줄 표시가 재는 통(coedit.jsx PresenceMarks)
  const { items: coItems, ops: actionOps } = useCoActions(co);

  const toggleTodo = (idx) => {
    if (co) { co.replaceAll(toggleTodoLine(co.markdown(), idx)); return; }
    commit(cur => ({ ...cur, content: toggleTodoLine(cur.content, idx) }));
  };
  // 담당 업무를 내릴 때 — 하위 업무와 본문 도막이 한 번에 바뀐다(저장도 한 번)
  const onCreateSubtasks = (made, rest) => {
    if (co) {
      co.actions.replace(rest);
      commit(cur => ({ ...cur, subtasks: [...(cur.subtasks || []), ...made] }));
      return;
    }
    commit(cur => ({
      ...cur,
      subtasks: [...(cur.subtasks || []), ...made],
      content: writeActionSection(stripActionSection(cur.content), rest),
    }));
  };

  const fullDate = (d) => new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  const ongoing = task.status === CONFIG.STATUS_ONGOING;
  return (
    <div data-task-view="">
      {/* 상태는 점, 팀은 팀 색 글자 — 카드와 같은 표기법을 쓴다(배지 남발 금지) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5 text-[11px] font-bold">
        <span className="inline-flex items-center gap-1.5 text-fg-muted"><span className={`w-[5px] h-[5px] rounded-full ${CONFIG.STATUS_DOTS[task.status] || 'bg-fg-faint'}`} />{task.status}</span>
        {task.teams?.map(t => <span key={t} className={`tracking-[0.03em] ${CONFIG.TEAM_FG[t] || 'text-fg-muted'}`}>{t}</span>)}
      </div>
      <h2 className="text-xl md:text-2xl font-extrabold text-fg leading-tight tracking-[-0.6px] break-words">{task.title}</h2>
      <div className="mt-4 border-y border-line divide-y divide-line/60 text-xs">
        <div className="flex items-center gap-0 py-2.5"><span className="w-24 shrink-0 text-fg-muted">담당자</span><span className="font-medium text-fg min-w-0 break-words">{task.assignees?.join(', ') || '미지정'}</span></div>
        {task.startDate && !ongoing && <div className="flex items-center gap-0 py-2.5"><span className="w-24 shrink-0 text-fg-muted">시작일</span><span className="font-semibold text-fg">{fullDate(task.startDate)}</span></div>}
        {task.dueDate && !ongoing && <div className="flex items-center gap-0 py-2.5"><span className="w-24 shrink-0 text-fg-muted">마감일</span><span className="font-semibold text-fg">{fullDate(task.dueDate)}</span></div>}
        <DependsViewRow dependsOn={task.dependsOn} />
      </div>

      {summary.block && <div className="mt-4">{summary.block}</div>}
      {/* 본문 위 한 줄 — 왼쪽은 '○○○님이 수정 중'(남이 수정 화면일 때만), 오른쪽은 3줄 요약 버튼(hover로 숨기지 않는다) */}
      {((editors.length > 0 && !diffPick) || summary.button) && (
        <div className="flex flex-wrap items-center gap-2 mt-4 -mb-1 min-w-0">
          {!diffPick && <PresencePill editors={editors} />}
          {summary.button && <span className="ml-auto shrink-0">{summary.button}</span>}
        </div>
      )}
      {diffPick ? (
        <div className="mt-3"><VersionDiffView pick={diffPick} onRestore={onRestore} onExit={onExitDiff} /></div>
      ) : (
        // text-sm: RichText는 크기를 강제하지 않는다 — 본문의 기준 크기는 이 통이 준다.
        // relative isolate: 줄 표시(물 z -1 · 얼굴)가 이 통 안에 겹쳐 선다
        <div ref={setBodyEl} data-view-body="" className="prose prose-sm max-w-none mt-3 min-h-[120px] text-sm relative isolate pr-7">
          {/* 청년별 담당 업무 도막은 **여기서 그리지 않는다** — 바로 아래 부품이 얼굴과 체크칸까지 붙여 보여 준다 */}
          <RichText content={stripActionSection(md)} onToggleTodo={coPending ? undefined : toggleTodo} lineAttrs />
          <PresenceMarks box={bodyEl} editors={editors} content={md} />
        </div>
      )}

      {/* 회의록이면 다듬기가 뽑아 둔 담당 업무 줄이 여기 선다 — 하위 업무 **바로 위**다 */}
      <ActionItems items={co ? coItems : parseActionItems(md)} ops={actionOps} subtasks={task.subtasks || []}
        onCreate={coPending ? undefined : onCreateSubtasks} />

      {/* 보기에서도 체크는 눌린다 — 하위 업무를 끝낼 때마다 수정 화면으로 들어갔다 나오게 하면 아무도 쓰지 않는다 */}
      <SubtaskList readOnly value={task.subtasks || []}
        onChange={(fn, opts) => commit(cur => ({ ...cur, subtasks: fn(cur.subtasks || []) }), opts)} />

      {cloudMode && <AttachmentSection task={task} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity} readOnly />}
    </div>
  );
}

// ── 업무 창 — 수정 화면 (있는 업무 · 칸마다 저절로 저장) ───────────────────────────
// task는 **스토어의 지금 카드**다(창이 사본을 들지 않는다). 무엇이 언제 저장되는지는 TaskModalShell 머리말.
// 본문은 셋 중 하나다:
//   · co(같이 쓰기가 섰다)      편집기에 collab을 넘긴다 — 원본은 Yjs 문서, 저장은 거울(조용히)
//   · coPending(아직 여는 중)   뼈대(EditorSkeleton) — 편집기 조각과 문서를 받는 동안
//   · 그 밖(게스트 · 못 열었다) 이 부품이 마크다운을 들고 있다가 800ms 조용하면 조용히 저장하고,
//                               내려갈 때(수정 완료 · 닫기) 세션 한 번(onSession → 활동 한 줄 · 새 멘션)
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
  // 다듬기 직전 본문은 usePolish가 든다(taskSummary · 새 업무 폼과 한 벌).
  const polish = usePolish({
    read: () => { const md = co ? co.markdown() : b.current.md; return String(md || '').trim() ? md : null; },
    write: (md) => (co ? co.replaceAll(md) : setBodyNow(md)),
    context: (before) => ({ ...task, content: before }),
  });

  // ── 청년별 담당 업무 ──
  // 같이 쓰기면 줄을 Yjs 배열에서 읽고 줄 단위로 고친다(co.actions — 본문 마크다운 꼬리를 다시 쓰지 않는다 ·
  // 남이 다른 줄을 고친 것이 살아남는다). 아니면 예전처럼 본문 도막을 읽고 도로 적는다.
  const { items: coItems, ops: actionOps } = useCoActions(co);
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
        <BodyHead polish={polish} disabled={polish.loading || coPending || (!co && !body)}>{summary.button}</BodyHead>
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

