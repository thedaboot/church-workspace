import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import {
  CheckSquare, Clock, X, User, Hash, RefreshCw, Download, Upload,
  Wand2, CalendarRange, Pencil, Trash2,
  FileText, File, FileSpreadsheet, Presentation, Paperclip, UploadCloud, Loader2, ExternalLink, Check, AlertTriangle, Eye
} from 'lucide-react';
import { CONFIG } from '../config.js';
import { formatDate, avatarColor, isMobileViewport, keepVisible } from '../utils.js';
import { store, useStore } from '../store/workspaceStore.js';
import { selectCurrentUser, selectProjectsList } from '../store/selectors.js';
import { AiService } from '../services/ai.js';
import { RichText } from '../components/RichText.jsx';
import { DatePicker } from '../components/DatePicker.jsx';
import { MentionInput } from '../components/MentionInput.jsx';
// TipTap/ProseMirror는 무거워 초기 번들에서 분리한다 (업무 수정 모드에서만 필요)
const MarkdownEditor = lazy(() => import('../components/MarkdownEditor.jsx').then(m => ({ default: m.MarkdownEditor })));
const EditorSkeleton = () => <div className="min-h-40 md:min-h-56 border border-line rounded-md rounded-t-none bg-surface-2/50 animate-pulse" />;
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { showToast } from '../components/Toast.jsx';
import { useAuth } from '../services/auth.jsx';
import { supabase } from '../services/supabaseClient.js';
import { uploadAttachment, getFileOpenUrl, getAttachmentUrls, deleteAttachment, listCardFiles } from '../services/cloud.js';
import { getMemberNames } from '../services/cloudSync.js';
import { ShareButton } from '../components/ShareButton.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { FilePreviewModal } from '../components/FilePreviewModal.jsx';
import { SmartImage } from '../components/media.jsx';

// ============================================================================
// 13. Modals (완벽한 SRP 분리)
// ============================================================================
// 첫 페인트 이후(유휴)로 작업을 미루는 헬퍼 — requestIdleCallback 미지원 시 타이머 폴백
const whenIdle = (fn) => (typeof requestIdleCallback === 'function'
  ? requestIdleCallback(fn, { timeout: 800 })
  : setTimeout(fn, 0));
const cancelIdle = (h) => {
  if (h == null) return;
  if (typeof cancelIdleCallback === 'function') { try { cancelIdleCallback(h); return; } catch { /* 타이머 핸들일 수 있음 */ } }
  clearTimeout(h);
};

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

  const handleSubmit = (e) => { e.preventDefault(); onSave(formData); };
  const commentCount = (formData.comments || []).filter(c => !c.parentId).length;

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
        <div className="text-[10px] text-fg-faint hidden md:block truncate">작성: {formData.author} • 최근: {formatDate(formData.updatedAt)}</div>
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

// 담당자 멤버 칩 선택기 — 목록에서 선택하거나 직접 타이핑+Enter로 임의 이름 추가
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
      if (open && suggestions.length && input.trim()) add(suggestions[activeIdx]);
      else if (input.trim()) add(input);
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
          placeholder={value.length ? '추가…' : '이름 입력 후 Enter 또는 목록에서 선택'}
          className="flex-1 min-w-[8rem] bg-transparent text-xs text-fg placeholder:text-fg-faint outline-none py-0.5"
        />
      </div>
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
    const polished = await AiService.polishText(formData.content);
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

// ── 첨부 파일 (클라우드 모드 전용) ──────────────────────────────────────────
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // Supabase Storage 버킷 제한과 동일
const formatBytes = (b) => {
  if (b === null || b === undefined) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};
const fileKind = (name = '', mime = '') => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const has = (m) => (mime || '').includes(m);
  if (ext === 'pdf' || has('pdf')) return { chip: 'bg-tag-red text-tag-red-fg', icon: <FileText size={16} strokeWidth={1.75} /> };
  if (['doc', 'docx'].includes(ext) || has('word')) return { chip: 'bg-tag-blue text-tag-blue-fg', icon: <FileText size={16} strokeWidth={1.75} /> };
  if (['ppt', 'pptx'].includes(ext) || has('presentation')) return { chip: 'bg-tag-orange text-tag-orange-fg', icon: <Presentation size={16} strokeWidth={1.75} /> };
  if (['xls', 'xlsx', 'csv'].includes(ext) || has('sheet') || has('excel') || has('csv')) return { chip: 'bg-tag-green text-tag-green-fg', icon: <FileSpreadsheet size={16} strokeWidth={1.75} /> };
  return { chip: 'bg-tag-gray text-tag-gray-fg', icon: <File size={16} strokeWidth={1.75} /> };
};

// thumb(서명 URL)은 상위에서 일괄 발급받아 주입 — 행마다 개별 요청하지 않는다
const AttachmentRow = ({ row, canDelete, thumb, onOpen, onRemove }) => {
  // 썸네일은 스토리지 파일만(드라이브로 옮긴 파일은 서명 URL이 없으므로 아이콘)
  const isImage = (row.mime_type || '').startsWith('image/') && !!row.storage_path;
  const kind = fileKind(row.name, row.mime_type);
  return (
    <div className="flex items-center gap-2.5 py-2 animate-in fade-in duration-200">
      {isImage
        ? <SmartImage
            src={thumb} alt={row.name} onClick={onOpen} title="미리보기"
            wrapperClassName="h-20 w-20 shrink-0 inline-block"
            className="h-20 w-20 object-cover rounded-md border border-line"
          />
        : <span className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${kind.chip}`}>{kind.icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-fg truncate">{row.name}</p>
        <p className="text-[10px] text-fg-faint mt-0.5">{formatBytes(row.size_bytes)}</p>
      </div>
      <button type="button" onClick={onOpen} className="p-1.5 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95" title="미리보기"><Eye size={14} /></button>
      {canDelete && (
        <ConfirmPopover message={`'${row.name}'을(를) 삭제할까요?`} onConfirm={onRemove}>
          <button type="button" className="p-1.5 rounded-md text-fg-faint hover:text-red-500 hover:bg-surface-hover transition active:scale-95" title="삭제"><Trash2 size={14} /></button>
        </ConfirmPopover>
      )}
    </div>
  );
};

const AttachmentSection = ({ task, userId, isAdmin, onFileActivity, readOnly = false }) => {
  // 이미 받아둔 attachments를 먼저 그리고(즉시 표시) 백그라운드로 갱신
  const [items, setItems] = useState(task.attachments || []);
  const [thumbs, setThumbs] = useState({}); // { storage_path: signedUrl }
  const [dragOver, setDragOver] = useState(false);
  const [uploadingName, setUploadingName] = useState(null);
  const [rejected, setRejected] = useState([]); // 용량 초과로 건너뛴 파일들
  const [preview, setPreview] = useState(null); // 미리보기로 열어둔 files 행
  const inputRef = useRef(null);

  // 첫 페인트 경쟁 방지: 네트워크는 유휴 시점으로 미룬다(모달은 로컬 데이터로 먼저 뜬다)
  useEffect(() => {
    let alive = true;
    const handle = whenIdle(() => {
      listCardFiles(task.id).then(rows => { if (alive) setItems(rows); }).catch(e => console.error('[cloud] 첨부 목록 로드 실패:', e));
    });
    return () => { alive = false; cancelIdle(handle); };
  }, [task.id]);

  // 이미지 썸네일 서명 URL을 한 번에 발급 (이미지 없으면 스토리지 호출 없음)
  useEffect(() => {
    const need = items.filter(r => (r.mime_type || '').startsWith('image/') && r.storage_path && !thumbs[r.storage_path]).map(r => r.storage_path);
    if (!need.length) return;
    let alive = true;
    const handle = whenIdle(() => {
      getAttachmentUrls(need)
        .then(map => { if (alive) setThumbs(prev => ({ ...prev, ...map })); })
        .catch(e => console.error('[cloud] 썸네일 URL 발급 실패:', e));
    });
    return () => { alive = false; cancelIdle(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    // 용량 초과 파일은 토스트로 알리고 + 업로드 영역에 계속 남는 경고로도 보여준다
    // (토스트는 몇 초 뒤 사라져서 "왜 안 올라갔지?"가 남는다)
    const tooBig = files.filter(f => f.size > MAX_UPLOAD_BYTES);
    setRejected(tooBig.map(f => ({ name: f.name, size: f.size })));
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) { showToast(`'${file.name}'은(는) 25MB를 넘어 첨부하지 못했어요.`); continue; }
      try {
        setUploadingName(file.name);
        const row = await uploadAttachment(file, { projectId: task.projectId, cardId: task.id });
        setItems(prev => [...prev, row]);
        onFileActivity?.(`파일 '${row.name}'을(를) 첨부했습니다.`);
      } catch (e) {
        console.error('[cloud] 업로드 실패:', e);
        showToast(`업로드 실패 (${file.name}) · ${e.message || e}`);
      } finally {
        setUploadingName(null);
      }
    }
  };

  // 클립보드 이미지 붙여넣기 (수정 모드에서만; 본문 textarea 붙여넣기는 stopPropagation으로 제외)
  useEffect(() => {
    if (readOnly) return;
    const onPaste = (e) => { const f = e.clipboardData?.files; if (f && f.length) uploadFiles(f); };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, readOnly]);

  // 스토리지 링크를 새 탭으로 던지지 않고 앱 안 미리보기로 연다
  // (모달 안에 '새 탭에서 열기'·'내려받기'가 있다)
  const openFile = (row) => setPreview(row);
  const removeItem = async (row) => {
    try {
      await deleteAttachment(row);
      setItems(prev => prev.filter(x => x.id !== row.id));
      onFileActivity?.(`파일 '${row.name}'을(를) 삭제했습니다.`);
    } catch (e) { console.error('[cloud] 삭제 실패:', e); showToast('삭제 실패 · ' + (e.message || e)); }
  };

  // 읽기 전용(뷰어)에서 첨부가 없으면 섹션 자체를 숨김
  if (readOnly && items.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-fg-muted"><Paperclip size={13} className="text-fg-faint" /> 첨부 파일</div>
      {!readOnly && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${dragOver ? 'border-accent bg-accent-weak/40' : 'border-line hover:bg-surface-2/50'}`}
        >
          <input ref={inputRef} type="file" multiple className="hidden" onChange={e => { uploadFiles(e.target.files); e.target.value = ''; }} />
          <UploadCloud size={20} strokeWidth={1.75} className="mx-auto text-fg-faint mb-1" />
          <p className="text-[11px] text-fg-muted">파일을 끌어다 놓거나 클릭해서 선택하세요</p>
          <p className="text-[10px] text-fg-faint mt-0.5">이미지는 붙여넣기(Ctrl/⌘+V)도 돼요 · 최대 25MB</p>
        </div>
      )}
      {!readOnly && uploadingName && <div className="flex items-center gap-2 mt-2 text-[11px] text-fg-muted"><Loader2 size={13} className="animate-spin" /> 업로드 중: {uploadingName}</div>}
      {!readOnly && rejected.length > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-tag-red-fg/30 bg-tag-red/60 px-2.5 py-2 animate-in fade-in duration-200">
          <AlertTriangle size={14} className="text-tag-red-fg shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-tag-red-fg">한 파일당 25MB까지 올릴 수 있어요</p>
            <ul className="mt-0.5 space-y-0.5">
              {rejected.map(f => (
                <li key={f.name} className="text-[10px] text-tag-red-fg/90 truncate">{f.name} · {formatBytes(f.size)}</li>
              ))}
            </ul>
            <p className="text-[10px] text-tag-red-fg/80 mt-1">용량을 줄이거나 링크(리소스)로 공유해 주세요.</p>
          </div>
          <button type="button" onClick={() => setRejected([])} className="p-0.5 rounded text-tag-red-fg/70 hover:text-tag-red-fg transition shrink-0" title="닫기"><X size={13} /></button>
        </div>
      )}
      {items.length > 0 && (
        <div className="divide-y divide-line/60 mt-1">
          {items.map(row => <AttachmentRow key={row.id} row={row} thumb={thumbs[row.storage_path]} canDelete={!readOnly && (isAdmin || row.uploaded_by === userId)} onOpen={() => openFile(row)} onRemove={() => removeItem(row)} />)}
        </div>
      )}
      {preview && (
        <FilePreviewModal
          row={preview}
          // 목록에서 이미 받아둔 이미지가 있으면 그대로 넘겨 스켈레톤 없이 바로 띄운다
          initialSrc={thumbs[preview.storage_path] || null}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
};

// 노션 스타일 플랫 댓글: 아바타 + 이름·시간 + 본문, 카드 대신 헤어라인 구분
// 작성자 본인일 때만 수정(인라인 textarea)·삭제(인라인 확인) 노출
const CommentBody = ({ c, currentUser, onUpdate, onDelete, hasReplies }) => {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(c.text);
  const isOwner = c.author === currentUser?.name;

  const saveEdit = () => {
    if (!editText.trim()) return;
    onUpdate(c.id, editText.trim());
    setEditing(false);
  };

  return (
    <div className="flex items-start gap-2.5 group/comment">
      <div className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5 ${avatarColor(c.author)}`}>{c.author?.[0]}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="font-semibold text-[11px] text-fg">{c.author}</span>
          <span className="text-[9px] text-fg-faint">{formatDate(c.timestamp)}</span>
          {c.edited && <span className="text-[9px] text-fg-faint">(수정됨)</span>}
          {isOwner && !editing && (
            <span className="ml-auto flex items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover/comment:opacity-100 transition-opacity">
              <button onClick={() => { setEditText(c.text); setEditing(true); }} className="text-fg-faint hover:text-fg-muted transition-colors" title="수정"><Pencil size={11} /></button>
              <ConfirmPopover message={hasReplies ? '댓글을 삭제할까요? 답글도 함께 삭제돼요.' : '댓글을 삭제할까요?'} onConfirm={() => onDelete(c.id)}>
                <button type="button" className="text-fg-faint hover:text-red-500 transition-colors" title="삭제"><Trash2 size={11} /></button>
              </ConfirmPopover>
            </span>
          )}
        </div>
        {editing ? (
          <textarea
            autoFocus value={editText} onChange={e => setEditText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setEditing(false); }}
            className="w-full text-xs border border-line rounded-xs px-2 py-1.5 bg-surface text-fg resize-none h-14 focus:border-accent focus:shadow-soft outline-none transition-all"
          />
        ) : (
          <div className="text-xs text-fg-secondary leading-relaxed"><RichText content={c.text} /></div>
        )}
      </div>
    </div>
  );
};

// 처음에는 최근 댓글만 그린다 — 60개짜리 업무를 열 때 모달 첫 페인트가
// 1초 넘게 밀리던 원인(댓글 1건당 RichText 파싱 + 노드 수십 개)을 잘라낸다.
const INITIAL_COMMENTS = 10;

const CommentPanel = React.memo(({ comments, onReply, currentUser, onUpdate, onDelete }) => {
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [showAll, setShowAll] = useState(false);
  const all = comments || [];
  const allTopLevel = all.filter(c => !c.parentId);
  const repliesByParent = useMemo(() => {
    const m = new Map();
    for (const c of all) if (c.parentId) { if (!m.has(c.parentId)) m.set(c.parentId, []); m.get(c.parentId).push(c); }
    return m;
  }, [all]);
  const getReplies = (id) => repliesByParent.get(id) || [];

  // 최신 댓글이 아래쪽이므로 뒤에서 N개만 노출
  const hiddenCount = showAll ? 0 : Math.max(0, allTopLevel.length - INITIAL_COMMENTS);
  const topLevel = hiddenCount > 0 ? allTopLevel.slice(-INITIAL_COMMENTS) : allTopLevel;

  const submitReply = (parentId) => {
    if (!replyText.trim()) return;
    onReply(replyText, parentId);
    setReplyText('');
    setReplyingTo(null);
  };

  if (all.length === 0) return (
    <p className="text-center mt-8 text-xs text-fg-faint">첫 댓글을 남겨보세요!</p>
  );

  return (
    <div className="divide-y divide-line/60">
      {hiddenCount > 0 && (
        <button
          type="button" onClick={() => setShowAll(true)}
          className="w-full text-[11px] text-accent-text hover:bg-surface-hover rounded-md py-2 mb-1 transition active:scale-95"
        >이전 댓글 {hiddenCount}개 더 보기</button>
      )}
      {topLevel.map(c => (
        <div key={c.id} className="py-3 first:pt-0 group/c animate-in fade-in duration-200">
          <CommentBody c={c} currentUser={currentUser} onUpdate={onUpdate} onDelete={onDelete} hasReplies={getReplies(c.id).length > 0} />
          <div className="pl-8 mt-1">
            <button
              onClick={() => { setReplyingTo(replyingTo === c.id ? null : c.id); setReplyText(''); }}
              className={`text-[10px] text-fg-faint hover:text-accent-text transition-opacity ${replyingTo === c.id ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover/c:opacity-100'}`}
            >답글</button>
          </div>
          {(getReplies(c.id).length > 0 || replyingTo === c.id) && (
            <div className="ml-8 mt-2 border-l border-line pl-3 space-y-3">
              {getReplies(c.id).map(r => <div key={r.id} className="animate-in fade-in duration-200"><CommentBody c={r} currentUser={currentUser} onUpdate={onUpdate} onDelete={onDelete} /></div>)}
              {replyingTo === c.id && (
                <input
                  autoFocus={!isMobileViewport()} value={replyText} onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitReply(c.id); } if (e.key === 'Escape') { setReplyingTo(null); setReplyText(''); } }}
                  placeholder="답글 입력 후 Enter (Esc 취소)"
                  className="w-full text-xs border border-line rounded-xs px-2 py-1.5 bg-surface text-fg placeholder:text-fg-faint focus:border-accent focus:shadow-soft outline-none transition-all"
                />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

// 활동 action 문자열 키워드 → 타임라인 dot 색상 매핑
// 순서 주의: '상태를 …로 변경'처럼 여러 키워드를 동시에 가진 문장이 있어
// 더 구체적인 것부터 검사한다.
const activityDotColor = (action = '') => {
  if (action.includes('생성')) return 'bg-tag-green-fg';
  if (action.includes('상태')) {
    if (action.includes('완료')) return 'bg-tag-green-fg';
    if (action.includes('보류')) return 'bg-status-hold';
    return 'bg-accent';
  }
  if (action.includes('댓글') || action.includes('답글')) return 'bg-tag-purple-fg';
  if (action.includes('파일')) return 'bg-tag-blue-fg';
  // 제목·상세 내용·일정·담당자·담당 팀 변경
  if (action.includes('변경') || action.includes('수정') || action.includes('비웠') || action.includes('지웠')) return 'bg-tag-yellow-fg';
  return 'bg-fg-faint';
};

const INITIAL_LOGS = 20;

const ActivityPanel = React.memo(({ logs }) => {
  const [showAll, setShowAll] = useState(false);
  const all = logs || [];
  // 최신순 + 처음에는 상위 N개만
  const ordered = useMemo(() => all.slice().reverse(), [all]);
  const hiddenCount = showAll ? 0 : Math.max(0, ordered.length - INITIAL_LOGS);
  const shown = hiddenCount > 0 ? ordered.slice(0, INITIAL_LOGS) : ordered;

  if (all.length === 0) return (
    <div className="text-center mt-6">
      <span className="inline-flex w-8 h-8 rounded-full bg-tag-purple text-tag-purple-fg items-center justify-center mb-2"><span className="w-1.5 h-1.5 rounded-full bg-current" /></span>
      <p className="text-xs text-fg-faint">아직 활동 기록이 없어요.</p>
    </div>
  );

  return (
    <div className="space-y-4 relative before:absolute before:inset-y-1 before:left-[3px] before:w-px before:bg-line">
      {shown.map(l => (
        <div key={l.id} className="relative flex items-start gap-3">
          <div className={`mt-1 w-[7px] h-[7px] rounded-full ring-4 ring-surface-2 z-10 shrink-0 ${activityDotColor(l.action)}`}></div>
          <div className="min-w-0">
            <p className="text-[11px] text-fg-secondary leading-snug"><span className="font-semibold text-fg">{l.author}</span>님이 {l.action}</p>
            <p className="text-[9px] text-fg-faint mt-0.5">{formatDate(l.timestamp)}</p>
          </div>
        </div>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button" onClick={() => setShowAll(true)}
          className="relative w-full text-[11px] text-accent-text hover:bg-surface-hover rounded-md py-2 transition active:scale-95"
        >이전 기록 {hiddenCount}개 더 보기</button>
      )}
    </div>
  );
});

const CommentInput = ({ onAdd, members = [] }) => {
  const [val, setVal] = useState('');
  const submit = () => { if (val.trim()) { onAdd(val); setVal(''); } };

  return (
    <div className="p-3 bg-surface border-t border-line shrink-0 relative">
      <MentionInput
        as="textarea" value={val} onChange={setVal} members={members} dropUp
        placeholder="@이름 으로 멘션..."
        className="w-full text-xs border border-line rounded-xs p-2 focus:ring-2 focus:ring-accent outline-none resize-none h-14 bg-surface text-fg placeholder:text-fg-faint"
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
      />
      <div className="flex justify-end mt-2 items-center">
        <button onClick={submit} disabled={!val.trim()} className="bg-accent hover:bg-accent-strong disabled:bg-line text-white px-3 py-1.5 rounded-md text-[10px] font-bold transition active:scale-95">등록</button>
      </div>
    </div>
  );
};

export function ProfileModal({ onClose, onSave }) {
  const user = useStore(selectCurrentUser);
  const { enabled, session } = useAuth();
  const cloudMode = enabled && !!session;
  const [name, setName] = useState(user.name);
  const [team, setTeam] = useState(user.team);
  const [linking, setLinking] = useState(null); // 연결 중인 provider

  const linkedProviders = (session?.user?.identities || []).map(i => i.provider);
  const linkProvider = async (provider) => {
    if (!supabase || linking) return;
    setLinking(provider);
    try {
      const { error } = await supabase.auth.linkIdentity({ provider });
      if (error) showToast(`연결 실패: ${error.message} · Supabase 설정에서 Manual Linking이 켜져 있는지 확인해 주세요.`);
    } catch (e) {
      showToast(`연결 실패: ${e.message} · Supabase 설정에서 Manual Linking이 켜져 있는지 확인해 주세요.`);
    } finally {
      setLinking(null);
    }
  };
  const ACCOUNTS = [
    { provider: 'google', label: '구글', icon: <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.16-3.16A11 11 0 0 0 2.18 7.06L5.84 9.9c.87-2.6 3.3-4.52 6.16-4.52z"/></svg> },
    { provider: 'kakao', label: '카카오', icon: <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#191919" d="M12 3C6.48 3 2 6.54 2 10.9c0 2.8 1.86 5.26 4.66 6.65l-1.19 4.4c-.1.39.34.7.68.47l5.23-3.47c.2.01.41.02.62.02 5.52 0 10-3.54 10-7.9S17.52 3 12 3z"/></svg> },
  ];
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"><div className="bg-surface p-5 md:p-6 rounded-lg shadow-elevated border border-line w-full max-w-sm animate-in fade-in zoom-in-95 duration-200"><h3 className="font-bold text-fg mb-1 tracking-[-0.25px]">프로필 설정</h3><p className="text-xs text-fg-muted mb-4 leading-relaxed">워크스페이스에 표시될 이름(닉네임)과 소속 팀이에요.<br />언제든 여기서 바꿀 수 있어요.</p><label className="block text-xs font-semibold text-fg-muted mb-1.5">이름</label><input type="text" value={name} onChange={e=>setName(e.target.value)} className="w-full border border-line rounded-xs p-2 mb-4 text-sm bg-surface text-fg focus:ring-2 focus:ring-accent outline-none" /><label className="block text-xs font-semibold text-fg-muted mb-1.5">소속 팀</label><select value={team} onChange={e=>setTeam(e.target.value)} className="w-full border border-line rounded-xs p-2 mb-4 text-sm bg-surface text-fg focus:ring-2 focus:ring-accent outline-none">{Object.keys(CONFIG.TEAMS).map(t=><option key={t}>{t}</option>)}</select>{cloudMode && (<div className="mb-6"><label className="block text-xs font-semibold text-fg-muted mb-1.5">연결된 계정</label><div className="border border-line rounded-md divide-y divide-line/60">{ACCOUNTS.map(({ provider, label, icon }) => { const linked = linkedProviders.includes(provider); return (<div key={provider} className="flex items-center gap-2.5 px-3 py-2"><span className="shrink-0">{icon}</span><span className="flex-1 text-sm text-fg">{label}</span>{linked ? <span className="inline-flex items-center gap-1 bg-tag-green text-tag-green-fg rounded-full text-[10px] px-2 py-0.5"><Check size={10} /> 연결됨</span> : <button type="button" onClick={() => linkProvider(provider)} disabled={linking === provider} className="text-accent-text hover:bg-accent-weak rounded-md px-2 py-1 text-xs transition active:scale-95 disabled:opacity-50">{linking === provider ? '연결 중...' : '연결하기'}</button>}</div>); })}</div></div>)}<div className="flex gap-2"><button onClick={onClose} className="flex-1 bg-surface-hover hover:bg-line text-fg-muted py-2.5 rounded-md text-sm font-medium transition active:scale-95">취소</button><button onClick={()=>{onSave({name, team}); onClose();}} className="flex-1 bg-accent hover:bg-accent-strong text-white py-2.5 rounded-md text-sm font-medium transition active:scale-95">저장</button></div></div></div>
  );
}

export function SyncModal({ onClose, persistence, cloudMode, isAdmin, onMigrate, migrating }) {
  const [url, setUrl] = useState(() => localStorage.getItem('church_app_sync_url') || '');
  const cloudProjects = useStore(selectProjectsList);

  // 로컬(church_app_v4)에 이관할 데이터가 있는지
  const localProjectCount = (() => {
    try { const raw = localStorage.getItem('church_app_v4'); return raw ? (JSON.parse(raw).projects?.allIds?.length || 0) : 0; }
    catch { return 0; }
  })();
  const canMigrate = isAdmin && cloudProjects.length === 0 && localProjectCount > 0;

  // ── 클라우드 모드: 자동 동기화 안내 + (조건 충족 시) 로컬 이관 ──
  if (cloudMode) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"><div className="bg-surface p-5 rounded-lg shadow-elevated border border-line w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-4"><h3 className="font-bold text-fg flex items-center gap-2"><RefreshCw size={16} strokeWidth={1.75} className="text-accent"/> 데이터 연동</h3><button onClick={onClose} className="text-fg-faint"><X size={18}/></button></div>
        <div className="bg-accent-weak text-accent-text p-3 rounded-md text-xs leading-relaxed mb-4">클라우드(Supabase)에 연결되어 있어요. 모든 변경사항은 자동으로 저장되고, 팀원과 실시간으로 동기화됩니다.</div>
        {canMigrate ? (
          <>
            <p className="text-xs text-fg-muted leading-relaxed mb-3">이 브라우저에 저장된 로컬 데이터(프로젝트 {localProjectCount}개)를 클라우드로 한 번에 가져올 수 있어요. 클라우드가 비어 있을 때 최초 1회만 권장합니다.</p>
            <button onClick={onMigrate} disabled={migrating} className="w-full bg-accent hover:bg-accent-strong disabled:bg-line text-white py-2.5 rounded-md text-xs font-medium flex justify-center items-center gap-1.5 transition active:scale-95"><Upload size={14}/> {migrating ? '가져오는 중...' : '이 브라우저의 로컬 데이터를 클라우드로 가져오기'}</button>
          </>
        ) : (
          <p className="text-center text-xs text-fg-faint">따로 조작할 것은 없어요. 편하게 사용하세요!</p>
        )}
      </div></div>
    );
  }

  // ── 게스트 모드: 기존 Google Apps Script 동기화 UI ──
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"><div className="bg-surface p-5 rounded-lg shadow-elevated border border-line w-full max-w-md animate-in fade-in zoom-in-95 duration-200"><div className="flex justify-between items-center mb-4"><h3 className="font-bold text-fg flex items-center gap-2"><RefreshCw size={16} strokeWidth={1.75} className="text-accent"/> 데이터 연동</h3><button onClick={onClose} className="text-fg-faint"><X size={18}/></button></div><div className="bg-accent-weak text-accent-text p-3 rounded-md text-xs leading-relaxed mb-4">구글 Apps Script URL을 입력하여 데이터를 동기화합니다.</div><input type="text" value={url} onChange={e=>{setUrl(e.target.value); localStorage.setItem('church_app_sync_url',e.target.value);}} placeholder="https://script.google.com/..." className="w-full border border-line rounded-xs p-2 mb-4 text-xs bg-surface text-fg placeholder:text-fg-faint focus:ring-2 focus:ring-accent outline-none" /><div className="flex gap-2"><button onClick={()=>persistence.loadFromCloud(url)} disabled={!url || persistence.syncStatus === 'syncing'} className="flex-1 bg-surface-hover hover:bg-line text-fg border border-line py-2 rounded-md text-xs font-medium flex justify-center items-center gap-1 transition active:scale-95"><Download size={14}/> 불러오기</button><button onClick={()=>persistence.syncToCloud(url)} disabled={!url || persistence.syncStatus === 'syncing'} className="flex-1 bg-accent hover:bg-accent-strong text-white py-2 rounded-md text-xs font-medium flex justify-center items-center gap-1 transition active:scale-95"><Upload size={14}/> 덮어쓰기</button></div><p className="text-center text-xs font-bold mt-3 h-4 text-accent-text">{persistence.syncStatus === 'syncing' ? '진행 중...' : persistence.syncStatus === 'success' ? '성공!' : <span className="text-red-500">{persistence.errorMsg}</span>}</p></div></div>
  );
}

// project를 넘기면 이름 수정, 없으면 새로 만들기 (창 하나로 둘 다)
export function ProjectModal({ onClose, onSave, project = null }) {
  const renaming = !!project;
  const [title, setTitle] = useState(project?.title || '');
  const clean = title.trim();
  const unchanged = renaming && clean === (project.title || '').trim();
  const submit = () => { if (clean && !unchanged) onSave(clean); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-surface p-5 md:p-6 rounded-lg shadow-elevated border border-line w-full max-w-sm animate-in fade-in zoom-in-95 duration-200">
        <h3 className="font-bold text-fg mb-4 flex items-center gap-2"><Hash size={18} className="text-accent"/> {renaming ? '프로젝트 이름 수정' : '새 프로젝트 생성'}</h3>
        <label className="block text-xs font-semibold text-fg-muted mb-1.5">프로젝트 이름</label>
        <input
          type="text" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="예: 2026 하계 수련회"
          className="w-full border border-line p-2.5 rounded-xs mb-6 text-sm bg-surface text-fg placeholder:text-fg-faint focus:ring-2 focus:ring-accent outline-none"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-surface-hover hover:bg-line text-fg-muted py-2.5 rounded-md text-sm font-medium transition active:scale-95">취소</button>
          <button onClick={submit} disabled={!clean || unchanged} className="flex-1 bg-accent hover:bg-accent-strong disabled:bg-line text-white py-2.5 rounded-md text-sm font-medium transition active:scale-95">{renaming ? '저장' : '생성하기'}</button>
        </div>
      </div>
    </div>
  );
}
