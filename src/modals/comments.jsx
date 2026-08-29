import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2, Heart, ThumbsUp, Check } from 'lucide-react';
import { formatDate, isMobileViewport } from '../utils.js';
import { Avatar } from '../components/Avatar.jsx';
import { RichText } from '../components/RichText.jsx';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { MentionInput } from '../components/MentionInput.jsx';
import { useAuth } from '../services/auth.jsx';
import { store } from '../store/workspaceStore.js';
import { showToast } from '../components/Toast.jsx';
import { reactionSummary, toggleReaction, commentReactionCloud, notifyReaction } from '../services/cloudSync.js';

// ============================================================================
// 업무 창의 댓글 · 활동 기록 패널
// ----------------------------------------------------------------------------
// 둘 다 목록 화면에는 나오지 않는다 — 창을 열 때 그 카드 것만 읽어 온다
// (cloudSync.loadCardDetail). 그래서 여기 오는 comments/logs는 이미 채워진 배열이다.
// 댓글 반응(0032)도 같은 길로 실려 온다(comment.reactions).
// ============================================================================

// ── 댓글 반응 (0032) ────────────────────────────────────────────────────────
// 세 종류뿐이고 **이모지가 아니라 lucide 아이콘**이다(§4.2 — 이모지 아이콘 금지).
// 색은 토큰만 쓴다(Tailwind 기본 팔레트는 다크 모드에서 그대로 튄다 — §8).
// 문구는 담백하게: 화면에 '따봉' 같은 말을 쓰지 않는다.
// 라벨(2026-08-30 사용자 지적): 하트는 **'좋아요'** 다 — 모달 머리줄이 "하트 1명"으로
// 떴는데 "좋아요 1명"을 기대했다. 그래서 thumbsup은 겹치지 않게 **'최고'** 로 옮겼다.
// fill: 눌렀을 때 속을 채우는 아이콘. **체크는 채우지 않는다** — 선으로만 그린 모양이라
// 채우면 갈고리가 뭉개져 딴 도형처럼 보인다(실제로 그렇게 보였다).
const REACTIONS = [
  { kind: 'heart', Icon: Heart, label: '좋아요', fill: true, on: 'bg-tag-red text-tag-red-fg border-tag-red' },
  { kind: 'thumbsup', Icon: ThumbsUp, label: '최고', fill: true, on: 'bg-tag-blue text-tag-blue-fg border-tag-blue' },
  { kind: 'check', Icon: Check, label: '확인', fill: false, on: 'bg-tag-green text-tag-green-fg border-tag-green' },
];
const reactionMeta = (kind) => REACTIONS.find(r => r.kind === kind) || REACTIONS[0];

// 칩에 얼굴을 몇 개까지 세울지. 넘치면 +N이고 **그때만** 전체 목록 모달이 열린다 —
// 세 명 이하는 얼굴이 곧 목록이라 창을 하나 더 띄울 이유가 없다.
const FACES_MAX = 3;

// 게스트 모드의 저장 자리. 게스트 댓글은 스토어(→ localStorage)에 남으므로 반응도
// 같은 방식으로 브라우저에만 둔다. 클라우드에서는 이 표를 쓰지 않는다.
const GUEST_KEY = 'guest_comment_reactions';
const readGuestReactions = () => {
  try { return JSON.parse(localStorage.getItem(GUEST_KEY) || '{}') || {}; } catch { return {}; }
};
const writeGuestReactions = (map) => {
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(map)); } catch { /* 프라이빗 모드 */ }
};

// 이 댓글이 실린 카드. 알림에 붙일 cardId·projectId를 찾는 자리다 —
// 댓글은 창을 열 때 **그 카드 것만** 스토어에 채워지므로(§6-20) 후보가 하나뿐이다.
const cardOfComment = (commentId) => {
  const st = store.getState();
  for (const id of st.tasks.allIds) {
    const t = st.tasks.byId[id];
    if ((t?.comments || []).some(c => c.id === commentId)) return t;
  }
  return null;
};

// 반응 줄. **hover로만 나타나게 두지 않는다**(§8 — 터치 기기에는 hover가 없어서
// 기능이 아예 없는 것처럼 보인다. 수정·삭제에서 실제로 그랬다).
//
// 2026-08-30 재설계(사용자 피드백):
// ① 아이콘 버튼은 **정사각(w-6 h-6) + justify-center**다. 예전에는 `pl-2 pr-1.5`로
//    좌우가 어긋나서, 아무도 안 누른 원형 칩에서 아이콘이 왼쪽으로 치우쳐 보였다.
//    이제 어느 상태(0명/N명 · 내가 누름/안 누름)에서도 아이콘이 자기 칸의 한가운데다.
// ② **숫자 대신 누른 사람 얼굴**을 아이콘 바로 옆에 겹쳐 세운다("좋아요 N명"을 눌러
//    창을 여는 흐름이 번거롭다는 지적). 대시보드 PeopleStrip · 프로젝트 탭의
//    ViewerFaces와 같은 결이다 — 작은 원 겹치기 + ring-surface.
//    셋을 넘으면 +N이고 그 버튼만 전체 목록을 연다. 셋 이하는 얼굴의 title이 이름이다.
// ③ 얼굴이 붙고 떨어져도 **줄 높이가 안 변한다** — 칩 높이는 아이콘 버튼(24px)이
//    정하고 얼굴은 15px + 링이라 그 안에 들어간다. 가로만 늘어난다.
const ReactionRow = ({ reactions, myKey, onToggle, onOpen }) => (
  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
    {reactionSummary(reactions, myKey).map(({ kind, count, mine, people }) => {
      const { Icon, label, on, fill } = reactionMeta(kind);
      const shown = people.slice(0, FACES_MAX);
      const extra = count - shown.length;
      return (
        <span key={kind}
          className={`inline-flex items-center rounded-full border transition-colors ${mine ? on : 'border-line text-fg-faint'}`}>
          <button
            type="button" onClick={() => onToggle(kind)} aria-pressed={mine}
            title={mine ? `${label} 취소` : label} aria-label={mine ? `${label} 취소` : label}
            className="flex items-center justify-center w-6 h-6 rounded-full transition active:scale-95 hover:bg-surface-hover"
          >
            <Icon size={12} {...(mine && fill ? { fill: 'currentColor' } : {})} />
          </button>
          {count > 0 && (
            <span className={`flex items-center pl-0.5 ${extra > 0 ? 'pr-1' : 'pr-2'}`}>
              {shown.map((p, i) => (
                <Avatar key={`${p.userId}-${i}`} name={p.name || '알 수 없음'}
                  className="flex w-[15px] h-[15px] text-[8.5px] -ml-[5px] first:ml-0 ring-[1.5px] ring-surface animate-in fade-in zoom-in-75 duration-200" />
              ))}
              {/* 넘치는 사람만 +N으로 접는다. aria에 조사를 붙이면 '확인를'이 되므로
                  라벨과 숫자를 가운뎃점으로 잇는다 */}
              {extra > 0 && (
                <button
                  type="button" onClick={() => onOpen(kind)}
                  title="누른 사람 보기" aria-label={`${label} ${count}명 · 누른 사람 보기`}
                  className="ml-1 px-1 py-1 text-[10px] font-semibold leading-none tabular-nums rounded-full transition active:scale-95 hover:bg-surface-hover"
                >+{extra}</button>
              )}
            </span>
          )}
        </span>
      );
    })}
  </div>
);

// 누가 눌렀는지 — 대시보드의 '가입한 사람'(MembersModal)과 같은 결이다.
// **+N을 눌렀을 때만 연다.** 세 명 이하는 칩에 얼굴이 다 서 있어서 창을 띄울 이유가 없다.
// **body 포털이 기본**(§6-1): 업무 창은 transform 애니메이션이 걸린 조상이라
// 그냥 fixed로 두면 뷰포트가 아니라 그 안쪽을 기준으로 박힌다.
function ReactionPeopleModal({ kind, people, onClose }) {
  const { Icon, label, on, fill } = reactionMeta(kind);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    // 업무 창이 z-50이라 그 위로 올린다
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface rounded-lg shadow-elevated border border-line w-full max-w-xs max-h-[80dvh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 pt-5 pb-3 shrink-0 flex items-center gap-2">
          <span className={`inline-flex w-6 h-6 rounded-full border items-center justify-center shrink-0 ${on}`}>
            <Icon size={12} {...(fill ? { fill: 'currentColor' } : {})} />
          </span>
          <h3 className="font-bold text-fg tracking-[-0.25px]">{label} {people.length}명</h3>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 divide-y divide-line/60">
          {people.map((p, i) => (
            <div key={`${p.userId}-${i}`} className="flex items-center gap-2.5 py-2.5">
              <Avatar name={p.name || ''} className="flex w-7 h-7 text-xs" />
              <span className="text-[13px] font-semibold text-fg truncate">{p.name || '알 수 없음'}</span>
            </div>
          ))}
        </div>
        <div className="px-5 py-4 shrink-0">
          <button onClick={onClose}
            className="w-full bg-surface-hover hover:bg-line text-fg-muted py-2.5 rounded-md text-sm font-medium transition active:scale-95">닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// 노션 스타일 플랫 댓글: 아바타 + 이름·시간 + 본문, 카드 대신 헤어라인 구분
// 작성자 본인일 때만 수정(인라인 textarea)·삭제(인라인 확인) 노출
const CommentBody = ({ c, currentUser, onUpdate, onDelete, hasReplies, reactions, myKey, onToggleReaction, onOpenReaction }) => {
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
        {!editing && (
          <ReactionRow
            reactions={reactions} myKey={myKey}
            onToggle={(kind) => onToggleReaction(c, kind)}
            onOpen={(kind) => onOpenReaction(c, kind)}
          />
        )}
      </div>
    </div>
  );
};

// 상세(댓글·활동)를 읽어 오는 동안의 자리 — 아무것도 안 그리면 "첫 댓글을 남겨보세요!"
// 같은 빈 상태가 먼저 번쩍였다가 내용이 나타난다. 빈 상태는 "정말 없다"를 뜻해야 한다.
const ListSkeleton = ({ rows = 3 }) => (
  <div className="space-y-4 py-1" aria-hidden>
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="flex items-start gap-2.5">
        <div className="w-6 h-6 rounded-full dc-skeleton shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5 pt-0.5">
          <div className="h-2.5 w-24 rounded dc-skeleton" />
          <div className="h-2.5 max-w-[210px] rounded dc-skeleton" style={{ width: `${86 - i * 18}%` }} />
        </div>
      </div>
    ))}
  </div>
);

// 처음에는 최근 댓글만 그린다 — 60개짜리 업무를 열 때 모달 첫 페인트가
// 1초 넘게 밀리던 원인(댓글 1건당 RichText 파싱 + 노드 수십 개)을 잘라낸다.
const INITIAL_COMMENTS = 10;

export const CommentPanel = React.memo(({ comments, onReply, currentUser, onUpdate, onDelete, loading = false }) => {
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [showAll, setShowAll] = useState(false);
  const all = comments || [];

  // ── 반응 (0032) ──────────────────────────────────────────────────────────
  // 클라우드: 서버가 원본이고 댓글에 실려 온다(loadCardDetail). local은 방금 누른
  //   것을 서버 응답보다 먼저 보여주기 위한 덮개이고, 새 댓글 목록이 오면 버린다.
  // 게스트: local이 곧 원본이고 localStorage에 남는다(댓글과 같은 방식).
  const { enabled, session } = useAuth();
  const cloudMode = enabled && !!session;
  // 열쇠는 auth user id다 — 이름으로 판정하면 동명이인이 서로의 반응을 자기 것으로 본다
  const me = useMemo(() => ({
    userId: cloudMode ? (session?.user?.id || '') : 'guest',
    name: currentUser?.name || '',
  }), [cloudMode, session, currentUser?.name]);
  const [local, setLocal] = useState(() => (cloudMode ? {} : readGuestReactions()));
  const [peekAt, setPeekAt] = useState(null);   // { commentId, kind }

  // 서버에서 새 목록이 오면 덮개를 버린다(서버가 원본이다). 게스트는 서버가 없다.
  useEffect(() => {
    if (!cloudMode) return;
    setLocal(prev => (Object.keys(prev).length ? {} : prev));
  }, [comments, cloudMode]);

  const reactionsOf = (c) => local[c.id] || (cloudMode ? (c.reactions || []) : []);

  const toggleFor = (c, kind) => {
    const before = reactionsOf(c);
    const next = toggleReaction(before, kind, me);
    if (next === before) return;
    const turnedOn = next.length > before.length;
    setLocal(prev => ({ ...prev, [c.id]: next }));
    if (!cloudMode) {
      writeGuestReactions({ ...readGuestReactions(), [c.id]: next });
      return;
    }
    const card = cardOfComment(c.id);
    commentReactionCloud(c.id, kind, turnedOn)
      // 취소는 아무에게도 알리지 않는다. 본인 제외는 notifyReaction이 auth user id로
      // 최종 차단한다 — 이름으로 미리 거르지 않는 이유는 판정이 두 곳으로 갈라지면
      // 한쪽이 조용히 어긋나기 때문이다(§6-29).
      // **알림은 그 댓글의 첫 반응 한 번만**(사용자 피드백 2026-08-30 — "너무 쌓일
      // 것 같다"). 반응이 이미 있던 댓글(before가 비어 있지 않음)에는 보내지 않는다 —
      // 몇 명이 눌렀는지는 댓글을 열면 얼굴로 보인다. before는 이미 화면이 들고 있는
      // 배열이라 왕복이 늘지 않는다.
      .then(() => turnedOn && before.length === 0 && notifyReaction(c.author, {
        actorName: currentUser?.name, cardId: card?.id, projectId: card?.projectId,
        preview: String(c.text || '').slice(0, 80),
      }))
      .catch(e => {
        console.error('[cloud] 반응을 저장하지 못했습니다:', e);
        setLocal(prev => ({ ...prev, [c.id]: before }));   // 화면이 거짓말하지 않게 되돌린다
        showToast('반응을 남기지 못했어요 · 잠시 후 다시 시도해주세요');
      });
  };

  const peekPeople = useMemo(() => {
    if (!peekAt) return [];
    const c = all.find(x => x.id === peekAt.commentId);
    if (!c) return [];
    return reactionSummary(reactionsOf(c), me.userId).find(s => s.kind === peekAt.kind)?.people || [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peekAt, all, local, cloudMode, me.userId]);
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

  // 읽는 중 + 아직 아무것도 없을 때만 스켈레톤 — 이미 담아둔 댓글이 있으면(재열람)
  // 그대로 보여주고 조용히 갱신한다
  if (all.length === 0) {
    if (loading) return <ListSkeleton />;
    return <p className="text-center mt-8 text-xs text-fg-faint">첫 댓글을 남겨보세요!</p>;
  }

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
          <CommentBody c={c} currentUser={currentUser} onUpdate={onUpdate} onDelete={onDelete} hasReplies={getReplies(c.id).length > 0}
            reactions={reactionsOf(c)} myKey={me.userId} onToggleReaction={toggleFor}
            onOpenReaction={(cc, kind) => setPeekAt({ commentId: cc.id, kind })} />
          <div className="pl-8 mt-1">
            <button
              onClick={() => { setReplyingTo(replyingTo === c.id ? null : c.id); setReplyText(''); }}
              className={`text-[10px] text-fg-faint hover:text-accent-text transition-opacity ${replyingTo === c.id ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover/c:opacity-100'}`}
            >답글</button>
          </div>
          {(getReplies(c.id).length > 0 || replyingTo === c.id) && (
            <div className="ml-8 mt-2 border-l border-line pl-3 space-y-3">
              {getReplies(c.id).map(r => (
                <div key={r.id} className="animate-in fade-in duration-200">
                  <CommentBody c={r} currentUser={currentUser} onUpdate={onUpdate} onDelete={onDelete}
                    reactions={reactionsOf(r)} myKey={me.userId} onToggleReaction={toggleFor}
                    onOpenReaction={(cc, kind) => setPeekAt({ commentId: cc.id, kind })} />
                </div>
              ))}
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
      {peekAt && peekPeople.length > 0 && (
        <ReactionPeopleModal kind={peekAt.kind} people={peekPeople} onClose={() => setPeekAt(null)} />
      )}
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

export const ActivityPanel = React.memo(({ logs, loading = false }) => {
  const [showAll, setShowAll] = useState(false);
  const all = logs || [];
  // 최신순 + 처음에는 상위 N개만
  const ordered = useMemo(() => all.slice().reverse(), [all]);
  const hiddenCount = showAll ? 0 : Math.max(0, ordered.length - INITIAL_LOGS);
  const shown = hiddenCount > 0 ? ordered.slice(0, INITIAL_LOGS) : ordered;

  if (all.length === 0 && loading) return <ListSkeleton />;
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
