import React, { useState, useMemo } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { formatDate, isMobileViewport } from '../utils.js';
import { Avatar } from '../components/Avatar.jsx';
import { RichText } from '../components/RichText.jsx';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { MentionInput } from '../components/MentionInput.jsx';

// ============================================================================
// 업무 창의 댓글 · 활동 기록 패널
// ----------------------------------------------------------------------------
// 둘 다 목록 화면에는 나오지 않는다 — 창을 열 때 그 카드 것만 읽어 온다
// (cloudSync.loadCardDetail). 그래서 여기 오는 comments/logs는 이미 채워진 배열이다.
// ============================================================================

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
      <Avatar name={c.author || ''} className="flex w-6 h-6 text-[10px] mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="font-semibold text-[11px] text-fg">{c.author}</span>
          <span className="text-[9px] text-fg-faint">{formatDate(c.timestamp)}</span>
          {c.edited && <span className="text-[9px] text-fg-faint">(수정됨)</span>}
          {isOwner && !editing && (
            <span className="ml-auto flex items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover/comment:opacity-100 transition-opacity">
              <button onClick={() => { setEditText(c.text); setEditing(true); }} className="text-fg-faint hover:text-fg-muted transition-colors" title="수정"><Pencil size={11} /></button>
              <ConfirmPopover message={hasReplies ? '댓글을 삭제할까요? 답글도 함께 삭제돼요.' : '댓글을 삭제할까요?'} onConfirm={() => onDelete(c.id)}>
                <button type="button" className="text-fg-faint hover:text-tag-red-fg transition-colors" title="삭제"><Trash2 size={11} /></button>
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

export const CommentPanel = React.memo(({ comments, onReply, currentUser, onUpdate, onDelete }) => {
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

export const ActivityPanel = React.memo(({ logs }) => {
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

export const CommentInput = ({ onAdd, members = [] }) => {
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
