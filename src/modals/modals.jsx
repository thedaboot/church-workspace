import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { CheckSquare, Clock, X, User, Hash, Wand2, CalendarRange, Trash2, Paperclip } from 'lucide-react';
import { CONFIG } from '../config.js';
import { formatDate, isMobileViewport, keepVisible } from '../utils.js';
import { store, useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { AiService } from '../services/ai.js';
import { RichText } from '../components/RichText.jsx';
import { DatePicker } from '../components/DatePicker.jsx';
import { AttachmentSection } from './attachments.jsx';
import { CommentPanel, ActivityPanel, CommentInput } from './comments.jsx';
// TipTap/ProseMirror는 무거워 초기 번들에서 분리한다 (업무 수정 모드에서만 필요)
const MarkdownEditor = lazy(() => import('../components/MarkdownEditor.jsx').then(m => ({ default: m.MarkdownEditor })));
const EditorSkeleton = () => <div className="min-h-40 md:min-h-56 border border-line rounded-md rounded-t-none bg-surface-2/50 animate-pulse" />;
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { useAuth } from '../services/auth.jsx';
import { getMemberNames, loadCardDetail } from '../services/cloudSync.js';
import { ShareButton } from '../components/ShareButton.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';

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
  useEffect(() => {
    if (!cloudMode || !task.id) return;
    let alive = true;
    loadCardDetail(task.id)
      .then(detail => { if (alive) store.dispatch({ type: 'SYNC_TASK', payload: { id: task.id, ...detail } }); })
      .catch(e => console.error('[cloud] 업무 상세 로드 실패:', e));
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
  useEffect(() => { if (isEditMode) submittingRef.current = false; }, [isEditMode]);
  const handleSubmit = (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    onSave(formData);
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
        <button onClick={onClose} className="p-1 hover:bg-surface-hover rounded-full text-fg-faint"><X size={18} strokeWidth={1.75}/></button>
      </div>
    </>
  );
  const footerInner = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        {!isEditMode && canDelete && (
          <ConfirmPopover message="이 업무를 삭제할까요?" onConfirm={onDelete}>
            <button type="button" className="p-2 rounded-md text-fg-faint hover:text-red-500 hover:bg-surface-hover transition active:scale-95 shrink-0" title="업무 삭제"><Trash2 size={16} /></button>
          </ConfirmPopover>
        )}
        {/* 작성자 · (고친 적이 있으면) 마지막으로 고친 사람 · 그 시각.
            한 번도 고치지 않았으면 만든 시각을 보여준다 — 예전에는 수정한 사람이
            안 나와서, 작성자와 수정자가 다를 때 누가 손댔는지 알 수 없었다. */}
        <div className="text-[10px] text-fg-faint hidden md:block truncate">{metaLine}</div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button onClick={onClose} className="flex-1 sm:flex-none px-4 py-2 text-xs font-medium text-fg-muted bg-surface-hover hover:bg-line rounded-md transition active:scale-95">닫기</button>
        {isEditMode ? <button type="button" onClick={handleSubmit} className="flex-1 sm:flex-none bg-accent hover:bg-accent-strong text-white px-6 py-2 rounded-md text-xs font-medium transition active:scale-95">저장</button>
                    : <button type="button" onClick={onEdit} className="flex-1 sm:flex-none bg-surface-hover hover:bg-line text-fg border border-line px-6 py-2 rounded-md text-xs font-medium transition active:scale-95">수정</button>}
      </div>
    </>
  );
  const detailBody = isEditMode
    ? <TaskEditor formData={formData} setFormData={setFormData} members={members} cloudMode={cloudMode} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity} />
    : <TaskViewer formData={formData} cloudMode={cloudMode} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity} />;
  const commentsPanel = listsReady
    ? <CommentPanel comments={formData.comments} onReply={onAddComment} currentUser={currentUser} onUpdate={onUpdateComment} onDelete={onDeleteComment} />
    : null;
  const activityPanel = listsReady ? <ActivityPanel logs={formData.activityLog} /> : null;
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
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 md:p-4 animate-in fade-in duration-200"
    >
      <div className="bg-surface rounded-lg shadow-elevated border border-line w-full max-w-5xl h-[100dvh] md:h-[85dvh] flex flex-col md:flex-row overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex-1 flex flex-col border-r-0 md:border-r border-line overflow-y-auto">
          {/* sticky 헤더·푸터에 backdrop-blur를 쓰면 스크롤 프레임마다 뒤 내용을
              다시 블러링해서 새 업무/수정 창 스크롤이 눌린다 → 불투명 배경으로 */}
          <div className="sticky top-0 bg-surface z-10 px-4 py-3 border-b border-line flex justify-between items-center">{headerInner}</div>
          <div className="p-5 md:p-8 flex-1">{detailBody}</div>
          <div className="sticky bottom-0 border-t border-line p-3 md:p-4 flex justify-between items-center gap-2 z-10 bg-surface-2">{footerInner}</div>
        </div>
        {!isEditMode && task.id && (
          <div className="w-full md:w-80 h-[40dvh] md:h-auto bg-surface-2 flex flex-col border-t md:border-t-0 md:border-l border-line shrink-0">
            <div className="flex border-b border-line bg-surface shrink-0">
              <button onClick={() => setActiveTab('comments')} className={`flex-1 py-3 text-xs font-semibold transition-colors border-b-2 -mb-px ${activeTab === 'comments' ? 'border-accent text-accent-text' : 'border-transparent text-fg-muted hover:bg-surface-hover'}`}>댓글 ({commentCount})</button>
              <button onClick={() => setActiveTab('activity')} className={`flex-1 py-3 text-xs font-semibold transition-colors border-b-2 -mb-px ${activeTab === 'activity' ? 'border-accent text-accent-text' : 'border-transparent text-fg-muted hover:bg-surface-hover'}`}>활동 기록</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{activeTab === 'comments' ? commentsPanel : activityPanel}</div>
            {activeTab === 'comments' && commentInputEl}
          </div>
        )}
      </div>
    </div>
  );
}

// 노션 속성 행: 좌측 라벨 + 우측 값 레이아웃
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
    return (q ? uniq.filter(m => m.toLowerCase().includes(q)) : uniq).slice(0, 6);
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
              ref={i === activeIdx ? keepVisible : null}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors ${i === activeIdx ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover'}`}>
              <span className="truncate">{name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const TaskEditor = React.memo(({ formData, setFormData, members = [], cloudMode, userId, isAdmin, onFileActivity }) => {
  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  const toggleTeam = (team) => setFormData(prev => ({ ...prev, teams: (prev.teams || []).includes(team) ? prev.teams.filter(t => t !== team) : [...(prev.teams || []), team] }));

  // AI 결과(마크다운)는 content로 넣으면 MarkdownEditor가 파서를 거쳐 문서로 반영한다
  const handleAiPolish = async () => {
    if (!formData.content) return;
    setIsAiLoading(true);
    const polished = await AiService.polishText(formData.content, formData);
    if (polished) setFormData(prev => ({ ...prev, content: polished }));
    setIsAiLoading(false);
  };

  return (
    <form className="space-y-4">
      {/* 모바일은 autoFocus 금지 — 열자마자 키보드가 화면 절반을 덮는다 */}
      <input type="text" name="title" value={formData.title || ''} onChange={handleChange} placeholder="업무 제목 입력" className="w-full text-2xl font-bold tracking-[-0.25px] text-fg placeholder:text-fg-faint bg-transparent border-none outline-none focus:ring-0 p-0" required autoFocus={!isMobileViewport()} />

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
      </div>

      <div>
        <div className="flex justify-between items-center gap-2 mb-1.5">
          <label className="block text-xs text-fg-muted shrink-0">상세 내용</label>
          <button type="button" onClick={handleAiPolish} disabled={isAiLoading || !formData.content} className="flex items-center gap-1 px-2 py-1 bg-tag-purple text-tag-purple-fg hover:opacity-80 rounded-full text-[10px] font-bold transition active:scale-95 disabled:opacity-40 shrink-0">
            {isAiLoading ? <span className="animate-pulse">다듬는 중...</span> : <><Wand2 size={12} /> AI 문맥 다듬기</>}
          </button>
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

      {cloudMode && (formData.id
        ? <AttachmentSection task={formData} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity} />
        : <p className="mt-4 text-[11px] text-fg-faint flex items-center gap-1.5"><Paperclip size={13} className="text-fg-faint" /> 저장 후 첨부할 수 있어요.</p>
      )}
    </form>
  );
});

const TaskViewer = React.memo(({ formData, cloudMode, userId, isAdmin, onFileActivity }) => {
  const [summary, setSummary] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleSummarize = async () => {
    setIsAiLoading(true);
    const result = await AiService.summarizeTask(formData);
    setSummary(result);
    setIsAiLoading(false);
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
      </div>

      {/* 요약 섹션 — ✨(AI 상징)를 빼고 왼쪽 선으로 "본문이 아닌 덧말"임을 표시 */}
      {(summary || isAiLoading) && (
        <div className="mt-4 pl-3 border-l-2 border-tag-purple-fg/40 animate-in fade-in duration-200">
          <div className="text-[10px] font-bold text-tag-purple-fg mb-1">3줄 요약</div>
          {isAiLoading ? <div className="text-xs text-fg-muted animate-pulse">업무 내용과 댓글을 분석하고 있습니다...</div> : <div className="text-xs text-fg-secondary whitespace-pre-wrap"><RichText content={summary} /></div>}
        </div>
      )}

      {/* 요약 버튼은 hover로 숨기지 않는다 — 터치 기기에는 hover가 없어서 모바일에서
          이 기능이 아예 없는 것처럼 보였다. 본문 위 한 줄에 항상 둔다. */}
      {!summary && formData.content && (
        <div className="flex justify-end mt-4 -mb-1">
          <button onClick={handleSummarize} disabled={isAiLoading} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-tag-purple text-tag-purple-fg hover:opacity-80 rounded-xs text-[10px] font-bold transition active:scale-95 disabled:opacity-40">
            {isAiLoading ? <span className="animate-pulse">요약하는 중...</span> : <><Wand2 size={12} /> 3줄 요약</>}
          </button>
        </div>
      )}
      <div className="prose prose-sm max-w-none mt-3 min-h-[120px]">
        <RichText content={formData.content} />
      </div>

      {cloudMode && formData.id && (
        <AttachmentSection task={formData} userId={userId} isAdmin={isAdmin} onFileActivity={onFileActivity} readOnly />
      )}
    </div>
  );
});
