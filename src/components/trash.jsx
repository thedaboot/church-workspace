import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Hash, X, CheckSquare } from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { useAuth } from '../services/auth.jsx';
import { useTrashItems, useTrashRefresh, restoreTrash, canRestore } from '../services/trash.js';
import { myUidSync } from '../services/supabaseClient.js';
import { failText } from '../services/errorText.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLeave } from '../hooks/useExit.js';
import { BTN_SOFT } from './buttons.js';
import { showToast } from './Toast.jsx';
import { teamColor } from '../config.js';

// ============================================================================
// 휴지통(0104 · 사용자 승인 시안 2026-10-17) — 지운 업무·프로젝트를 30일 동안 보고 '복원'한다. 저장 자리는 services/trash.js
// (클라우드는 DB · 게스트는 브라우저), 규칙은 services/trashItems.js.
//   · 입구(TrashEntry): 데스크톱 프로젝트 탭 줄 '더보기'(연도 폴더) 맨 아래 · 폰은 더보기가 없어 연도 고르기 목록 맨 아래.
//     휴지통이 비면 입구도 서지 않는다(더보기를 휴지통 하나 때문에 세우지 않는다 — 넓은 화면에서 더보기가 없는 것이 지금 모양).
//   · 창(TrashDialog): 데스크톱은 가운데 대화창(.dc-dialog), 폰은 화면 높이 아래 시트(.dc-sheet-up) · 뒤판 .dc-scrim ·
//     닫힘은 useLeave(.dc-out · PITFALLS 57-d) · body 포털(z-[95] — 떠 있는 목록 z-90 위, 공유 시트 z-120 아래).
//   · 줄: 제목 · (업무) 프로젝트 / (프로젝트) 업무 수 · 지운 날 · 지운 사람 · '복원'(지운 사람과 마스터만 — DB restore_*가 다시 본다 ·
//     게스트는 마스터). 클라우드 복원 실패는 이유 한 줄만(앞도막 문구는 아직 정하지 않았다 — HANDOFF 남은 일).
//   · 프로젝트 칩으로 거른다(같은 종류가 이어지는 줄이라 폰에서는 옆으로 민다 · §8).
// ============================================================================

const dayLabel = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

// 입구 한 줄 — 연도 폴더 줄(YearFolders)과 같은 결 · 위에 가는 선
// line — 위에 다른 줄(연도 폴더·연도 목록)이 있을 때만 가는 선
export function TrashEntry({ count, onOpen, line = true }) {
  if (!count) return null;
  return (
    <div className={line ? 'mt-1 pt-1 border-t border-line' : ''}>
      <button type="button" onClick={onOpen} data-trash-entry=""
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[13px] text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors text-left">
        <Trash2 size={14} className="shrink-0 text-fg-faint" />
        <span className="flex-1">휴지통</span>
        <span className="text-[10.5px] text-fg-muted tabular-nums">{count}</span>
      </button>
    </div>
  );
}

function TrashRow({ item, who }) {
  const allowed = canRestore(item, who);
  const [busy, setBusy] = useState(false);
  const isProject = item.kind === 'project';
  const teams = isProject ? [] : (item.teams || []);
  const meta = [
    isProject ? `업무 ${item.taskCount || 0}건` : item.projectTitle,
    dayLabel(item.deletedAt),
    item.deletedBy ? `${item.deletedBy}님이 삭제` : '',
  ].filter(Boolean).join(' · ');
  const restore = async () => {
    setBusy(true);
    try {
      const r = await restoreTrash(item);
      if (r === 'no-project') { showToast('프로젝트가 휴지통에 있어요\n프로젝트를 먼저 복원해주세요'); return; }
      showToast(`'${item.title}'을(를) 복원했어요`);
    } catch (e) {
      // 클라우드 복원 실패 — 다른 실패 토스트와 같은 두 도막(failText · 앞도막은 사용자 결정 2026-10-17 · 원문은 콘솔)
      console.error('[trash] 복원 실패:', e);
      showToast(failText('복원하지 못했어요', e));
    } finally { setBusy(false); }
  };
  return (
    <li className="flex items-center gap-3 px-1 py-2.5 border-b border-line/70 last:border-b-0" data-trash-row={item.kind}>
      <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${isProject ? 'bg-accent-weak text-accent-text' : 'bg-surface-hover text-fg-muted'}`}>
        {isProject ? <Hash size={14} /> : <CheckSquare size={14} />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-[13px] font-semibold text-fg">{item.title || '제목 없음'}</span>
          {isProject && <span className="shrink-0 px-1.5 py-px rounded-xs bg-surface-hover text-[10.5px] font-semibold text-fg-muted">프로젝트</span>}
          {teams.slice(0, 2).map(t => (
            <span key={t} className="shrink-0 inline-flex items-center gap-1 text-[10.5px] text-fg-muted">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: teamColor(t) }} />{t}
            </span>
          ))}
        </span>
        <span className="block truncate text-[11px] text-fg-muted mt-0.5">{meta}</span>
      </span>
      <button type="button" onClick={restore} disabled={!allowed || busy} className={`${BTN_SOFT} shrink-0`}>복원</button>
    </li>
  );
}

export function TrashDialog({ onClose }) {
  const items = useTrashItems();
  useTrashRefresh();
  const me = useStore(selectCurrentUser).name;
  const { isMaster, session } = useAuth();
  // 복원 판정 재료 — 게스트는 이름, 클라우드는 계정 id 둘(합친 계정 · supabaseClient.isMyUid와 같은 규칙)
  const who = useMemo(() => ({ me, myIds: [session?.user?.id, myUidSync()], isMaster: !!isMaster }), [me, session, isMaster]);
  const isMobile = useIsMobile();
  const [leaving, leave] = useLeave();
  const close = useCallback(() => leave(onClose), [leave, onClose]);
  const [filter, setFilter] = useState(null);   // 프로젝트 id · null = 전체
  const downOnScrim = useRef(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);
  // 칩은 휴지통에 걸린 프로젝트만(지운 프로젝트 자신도) — 지운 차례가 아니라 이름 차례
  const chips = useMemo(() => {
    const m = new Map();
    items.forEach(it => { if (it.projectId) m.set(it.projectId, { title: it.projectTitle, n: (m.get(it.projectId)?.n || 0) + 1 }); });
    return [...m.entries()].sort((a, b) => a[1].title.localeCompare(b[1].title, 'ko'));
  }, [items]);
  // 고른 프로젝트가 비면(다 복원) 전체로 돌아간다
  useEffect(() => { if (filter && !chips.some(([id]) => id === filter)) setFilter(null); }, [chips, filter]);
  const shown = filter ? items.filter(it => it.projectId === filter) : items;
  const out = leaving ? ' dc-out' : '';

  const chip = (on, label, n, onClick, key) => (
    <button key={key} type="button" onClick={onClick}
      className="shrink-0 px-[11px] py-[5px] rounded-full text-[11.5px] whitespace-nowrap transition-colors"
      style={{ background: on ? 'var(--app-ink)' : 'var(--app-surface-hover)', color: on ? 'var(--app-canvas)' : 'var(--app-ink-muted)', fontWeight: on ? 700 : 500 }}>
      {label} <span className="tabular-nums">{n}</span>
    </button>
  );

  const body = (
    <>
      <div className="flex items-center gap-2 shrink-0">
        <h3 className="flex-1 font-bold text-fg tracking-[-0.25px] flex items-center gap-2"><Trash2 size={17} className="text-fg-muted" />휴지통</h3>
        <button type="button" onClick={close} title="닫기" aria-label="닫기" className="p-1 rounded-full text-fg-faint hover:bg-surface-hover"><X size={18} strokeWidth={1.75} /></button>
      </div>
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 mt-3 -mx-5 px-5 md:mx-0 md:px-0 md:flex-wrap overflow-x-auto md:overflow-visible scrollbar-hide x-scroll-lock shrink-0">
          {chip(!filter, '전체', items.length, () => setFilter(null), 'all')}
          {chips.map(([id, c]) => chip(filter === id, c.title, c.n, () => setFilter(id), id))}
        </div>
      )}
      {/* 비면 남은 높이의 가운데(폰 시트는 화면 높이라 위에 붙으면 빈 판처럼 보인다 · 데스크톱은 py-10만큼) */}
      {shown.length ? (
        <ul className="mt-2 flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1 px-1">
          {shown.map(it => <TrashRow key={it.id} item={it} who={who} />)}
        </ul>
      ) : (
        <p data-trash-empty="" className="flex-1 flex items-center justify-center py-10 text-center text-[13px] text-fg-muted">휴지통이 비어 있어요</p>
      )}
    </>
  );

  const scrimProps = {
    onMouseDown: (e) => { downOnScrim.current = e.target === e.currentTarget; },
    onClick: (e) => { if (e.target === e.currentTarget && downOnScrim.current) close(); },
  };
  return createPortal(isMobile ? (
    <div {...scrimProps} className={`fixed inset-0 z-[95] flex items-end bg-black/50 dc-scrim${out}`}>
      <div role="dialog" aria-label="휴지통" data-trash-dialog=""
        className={`w-full flex flex-col px-5 pt-2.5 rounded-t-2xl bg-surface dc-sheet-up${out}`}
        style={{ height: 'calc(100dvh - max(12px, env(safe-area-inset-top)))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <span className="self-center w-9 h-1 rounded-full bg-line mb-3 shrink-0" />
        {body}
      </div>
    </div>
  ) : (
    <div {...scrimProps} className={`fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-4 dc-scrim${out}`}>
      <div role="dialog" aria-label="휴지통" data-trash-dialog=""
        className={`bg-surface p-5 md:p-6 rounded-lg shadow-elevated border border-line w-full max-w-[520px] max-h-[min(640px,85dvh)] flex flex-col dc-dialog${out}`}>
        {body}
      </div>
    </div>
  ), document.body);
}
