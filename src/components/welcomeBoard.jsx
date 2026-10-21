import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, X, Check, Phone, Loader2 } from 'lucide-react';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable,
} from '@dnd-kit/core';
import { dropCollision } from './dropCollision.js';
import { Avatar } from './Avatar.jsx';
import { useAnchoredPos, popMotion } from './ConfirmPopover.jsx';
import { useEnterStagger } from '../hooks/useEnterStagger.js';
import { useLeave } from '../hooks/useExit.js';
import { BTN_CONFIRM, BTN_CONFIRM_QUIET } from './buttons.js';
import { showToast } from './Toast.jsx';
import * as W from '../services/welcome.js';

// ============================================================================
// 새가족 정착 보드 — 모임 > '새가족' 탭(시안 · v5 4묶음 · mock/b5 · 게스트 시연만)
// ----------------------------------------------------------------------------
// **업무 보드(components/boards.jsx)와 한 벌의 짜임이다**(사용자 2026-10-21 — "업무 옮기는 방식·모달·디자인 시스템에 맞게"):
//   · 끌기: dnd-kit · MouseSensor 6px / TouchSensor 200ms 꾹 · 놓을 곳은 손가락 기준(dropCollision) · 가로 자동 스크롤 끔
//   · 카드: 흰 상자가 아니라 목록 한 줄(얇은 구분선) · 왼쪽 3px 레일(단계 색) · 오른쪽 위 '단계 옮기기' 버튼 → 150px 판(StatusMenu와 같은 모양)
//   · 칸: 점 + 이름 + 개수 + 44×3 비중 바 · 끄는 동안 '여기로 놓기' · 빈 칸은 선 그림
//   · 폰: 칸은 82vw 스냅, 위에 단계 칩 — 끄는 동안 칩이 놓을 곳이 된다 · 보류는 보드 위 한 줄(상시 줄과 같은 자리)
//   · 창: 업무 창과 같은 껍데기(딤 + 가운데 창 · 머리줄/본문/바닥 줄 · 바닥 줄 bg-surface-2)
// 단계·사람·순의 규칙은 services/welcome.js 머리말(등록 = 명단 한 줄 · 순 = group_members — 순 편성과 같은 길).
// 문구는 시안 — 사용자 확정 전.
// ============================================================================
W.loadCards();   // 시연 씨앗 — 동아리 씨앗(groups.js) 다음이다(모임 화면이 groups.js를 먼저 싣는다)

const HOLD_DROP = 'hold-row';
const md = (ymd) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(ymd || '')); return m ? `${+m[1]}월 ${+m[2]}일` : ''; };

function useCards() {
  const cache = React.useRef(null);
  return React.useSyncExternalStore(
    (f) => W.onWelcomeChange(() => { cache.current = null; f(); }),
    () => { cache.current = cache.current || W.loadCards(); return cache.current; });
}

// ── 카드 ────────────────────────────────────────────────────────────────────
const CardInner = React.memo(({ c, sunName, action = null }) => (
  <div className="flex gap-2.5">
    <span className="shrink-0 w-[3px] rounded-full my-0.5" style={{ background: W.STAGE_DOT[c.stage] }} />
    <span className="flex-1 min-w-0">
      <span className="flex items-center gap-1.5 mb-[3px] min-w-0">
        <span className="flex-1 min-w-0 text-[10px] font-bold text-fg-muted tabular-nums truncate" style={{ letterSpacing: '.02em' }}>첫 방문 {md(c.visits[0])}</span>
        {action}
      </span>
      <span className="block text-sm font-semibold text-fg" style={{ lineHeight: 1.4, letterSpacing: '-0.2px' }}>{c.name}</span>
      <span className="flex items-center justify-between gap-2 mt-2">
        <span className="min-w-0 truncate text-[11px] text-fg-muted">{W.nextStep(c, sunName)}</span>
        {c.owner && <Avatar name={c.owner} className="flex w-[18px] h-[18px] text-[9.5px] shrink-0" />}
      </span>
    </span>
  </div>
));

// 단계 고르기 판 — 업무 보드 StatusMenu와 같은 모양(150px · body 포털 · useAnchoredPos · 바깥 누름·Esc로 닫힘)
function StageMenu({ anchorRef, rootRef, open, onClose, current, onPick }) {
  const popRef = React.useRef(null);
  const [pos] = useAnchoredPos(anchorRef, open, 150, 300, 8, popRef);
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef?.current?.contains(e.target) && !popRef.current?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, rootRef]);
  if (!open) return null;
  return createPortal(
    <div ref={popRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: 150, ...popMotion(pos) }}
      className="dc-pop transition-none z-[90] bg-surface border border-line rounded-md shadow-soft p-[5px]" data-stage-menu="">
      {[...W.STAGES, [W.HOLD, W.HOLD_LABEL]].map(([k, label]) => (
        <button key={k} type="button" onClick={(e) => { e.stopPropagation(); onClose(); if (k !== current) onPick(k); }}
          className="w-full flex items-center gap-2 px-2 py-[7px] rounded-sm text-left text-[12.5px] transition-colors hover:bg-surface-hover"
          style={{ background: k === current ? 'var(--app-surface-hover)' : 'transparent', color: k === current ? 'var(--app-ink)' : 'var(--app-ink-muted)' }}>
          <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: W.STAGE_DOT[k] }} />
          <span className="flex-1 truncate">{label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

function StageMoveButton({ c, onMove }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const btnRef = React.useRef(null);
  const close = React.useCallback(() => setOpen(false), []);
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };   // dnd-kit이 끌기 시작으로 보지 않게
  return (
    <span ref={rootRef} className="inline-flex shrink-0">
      <span ref={btnRef} className="inline-flex">
        <button type="button" title="단계 옮기기" aria-label="단계 옮기기" data-stage-move=""
          onPointerDown={stop} onTouchStart={stop} onMouseDown={stop}
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          className="w-6 h-6 -mr-1 -mt-0.5 rounded-md flex items-center justify-center text-fg-faint hover:text-accent-text hover:bg-surface-hover transition-colors">
          <ArrowLeftRight size={13} />
        </button>
      </span>
      <StageMenu anchorRef={btnRef} rootRef={rootRef} open={open} onClose={close} current={c.stage} onPick={(k) => onMove(c, k)} />
    </span>
  );
}

function DraggableCard({ c, index, sunName, onOpen, onMove }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `card:${c.id}` });
  const setRefs = React.useCallback((el) => { setNodeRef(el); setDropRef(el); }, [setNodeRef, setDropRef]);
  const action = React.useMemo(() => <StageMoveButton c={c} onMove={onMove} />, [c, onMove]);
  return (
    <div ref={setRefs} {...attributes} {...listeners} onClick={() => onOpen(c.id)} data-welcome-card={c.id}
      style={{ animationDelay: `${Math.min(index ?? 0, 10) * 24}ms`, borderBottom: '1px solid var(--app-line)' }}
      className={`welcome-card dc-card relative pr-2 pt-[11px] pb-3 cursor-grab active:cursor-grabbing hover:bg-surface-hover transition-colors ${isDragging ? 'opacity-40' : ''} ${isOver && !isDragging ? 'shadow-[inset_0_2px_0_0_var(--app-accent)]' : ''}`}>
      <CardInner c={c} sunName={sunName} action={action} />
    </div>
  );
}

// ── 칸 · 폰 단계 칩 · 보류 줄 ──────────────────────────────────────────────
function EmptyColumnMark() {
  return (
    <svg viewBox="0 0 40 40" className="w-9 h-9 mx-auto mb-1.5" aria-hidden="true" fill="none" stroke="var(--app-line)" strokeWidth="1.6" strokeLinecap="round">
      <path className="dc-draw" pathLength="1" d="M8 9.5h24a2.5 2.5 0 0 1 2.5 2.5v16a2.5 2.5 0 0 1-2.5 2.5H8a2.5 2.5 0 0 1-2.5-2.5V12A2.5 2.5 0 0 1 8 9.5Z" />
      <path className="dc-draw dc-draw-2" pathLength="1" d="M11 17.5h13" />
      <path className="dc-draw dc-draw-3" pathLength="1" d="M11 23.5h8" />
    </svg>
  );
}

function Column({ stage, label, count, share, dragging, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div ref={setNodeRef} data-stage={stage}
      className={`flex-1 basis-0 min-w-[82vw] md:min-w-[170px] flex flex-col snap-start rounded-sm transition-colors duration-150 ${isOver ? 'bg-accent-weak/70' : ''}`}>
      <div className="flex items-center gap-[7px] pb-2 shrink-0" style={{ borderBottom: '1px solid var(--app-line)' }}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: W.STAGE_DOT[stage] }} />
        <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap">{label}</h3>
        <span className="text-[11.5px] font-semibold text-fg-muted tabular-nums">{count}</span>
        <span className="flex-1" />
        <span className="block w-11 rounded-full overflow-hidden shrink-0" style={{ height: 3, background: 'var(--p-track)' }}>
          <span className="dc-bar-fill block h-full rounded-full"
            style={{ background: W.STAGE_DOT[stage], transform: `scaleX(${(share || 0).toFixed(3)})`, transitionDuration: '.45s' }} />
        </span>
      </div>
      <div className="pt-0.5">
        {children}
        {!count && !dragging && (
          <div className="py-[22px] text-center">
            <EmptyColumnMark />
            <p className="text-[11px] text-fg-muted">아직 없어요</p>
          </div>
        )}
        <div className={`h-16 border border-dashed rounded-sm flex items-center justify-center text-xs transition-all ${dragging ? (isOver ? 'opacity-100 border-accent text-accent-text' : 'opacity-100 border-line text-fg-faint') : 'opacity-0 border-transparent text-fg-faint'}`}>여기로 놓기</div>
      </div>
    </div>
  );
}

function StageChip({ stage, label, count, current, dragging, isDraggedStage, onClick }) {
  const { setNodeRef, isOver } = useDroppable({ id: `chip:${stage}` });
  const base = 'shrink-0 inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-[11px] font-semibold transition active:scale-95';
  let tone;
  if (dragging) {
    if (isOver) tone = 'bg-accent-weak border-accent text-accent-text scale-105';
    else if (isDraggedStage) tone = 'bg-surface-2 border-line border-dashed text-fg-muted';
    else tone = 'bg-surface border-accent border-dashed text-fg-muted';
  } else tone = current ? 'bg-surface border-accent text-fg' : 'bg-surface-2 border-line text-fg-muted';
  return (
    <button ref={setNodeRef} type="button" onClick={onClick} className={`${base} ${tone}`}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: W.STAGE_DOT[stage] }} />
      {label}
      <span className="text-fg-muted font-normal">{count}</span>
    </button>
  );
}

// 보류 — 업무 보드의 상시 줄과 같은 자리·모양(칩 = 이름 · 누르면 창 · 끌면 칸으로). 카드가 없어도 끄는 동안은 선다(놓을 곳).
function HoldChip({ c, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={() => onOpen(c.id)} data-welcome-card={c.id}
      className={`inline-flex max-w-full min-w-0 items-center gap-1.5 px-2.5 py-[3px] rounded-full border border-line bg-surface cursor-grab active:cursor-grabbing hover:bg-surface-hover transition-colors ${isDragging ? 'opacity-40' : ''}`}>
      <span className="min-w-0 truncate text-[12px] font-semibold text-fg">{c.name}</span>
    </div>
  );
}
function HoldRow({ cards, dragging, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id: HOLD_DROP });
  if (!cards.length && !dragging) return null;
  return (
    <div ref={setNodeRef} data-hold-row=""
      className={`flex flex-wrap items-center gap-1.5 mb-3 p-1 -m-1 rounded-md transition-colors duration-150 ${isOver ? 'bg-accent-weak/70 outline outline-1 outline-dashed outline-accent' : dragging ? 'outline outline-1 outline-dashed outline-line' : ''}`}>
      <span className="shrink-0 inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[11px] font-bold tabular-nums"
        style={{ background: 'var(--app-tag-gray)', color: 'var(--app-tag-gray-fg)' }}>{W.HOLD_LABEL} {cards.length}</span>
      {cards.map(c => <HoldChip key={c.id} c={c} onOpen={onOpen} />)}
    </div>
  );
}

// ── 보드 ────────────────────────────────────────────────────────────────────
// suns·members·people = 모임 화면이 이미 읽어 둔 그 해 순 편성 한 벌(groupsView adminData) — 순 배정은 그 길로 쓴다.
export function WelcomeBoard({ suns = [], members = [], people = [], meName = '', onAssignSun, onMoveSun, onChanged }) {
  const cards = useCards();
  const [activeId, setActiveId] = React.useState(null);
  const [openId, setOpenId] = React.useState(null);
  const [pickFor, setPickFor] = React.useState(null);   // { id, stage } — 순이 없는데 순 배정·정착으로 옮기려 할 때
  const scrollRef = React.useRef(null);
  const [visibleCol, setVisibleCol] = React.useState(0);
  const stagger = useEnterStagger();

  const sunOf = React.useCallback((personId) => {
    if (!personId) return null;
    const ids = new Set(members.filter(m => m.person_id === personId).map(m => m.group_id));
    return suns.find(s => ids.has(s.id)) || null;
  }, [suns, members]);

  const byStage = React.useMemo(() => {
    const m = Object.fromEntries([...W.STAGES.map(([k]) => [k, []]), [W.HOLD, []]]);
    cards.forEach(c => (m[c.stage] || (m[c.stage] = [])).push(c));
    Object.values(m).forEach(list => list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.created_at).localeCompare(String(b.created_at))));
    return m;
  }, [cards]);
  const active = cards.length - byStage[W.HOLD].length;

  // 옮기기 한 벌 — 끌기·단계 판·창의 단계 줄이 모두 여기로 온다
  const move = React.useCallback((c, stage) => {
    if (stage === c.stage) return;
    let card = c;
    if (W.needsPerson(stage) && !c.person_id) {
      card = W.register(c.id);
      showToast(`${c.name}님을 청년 명단에 새신자로 추가했어요`);
      onChanged?.();
    }
    if ((stage === 'sun' || stage === 'settled') && !sunOf(card.person_id)) {
      setOpenId(c.id); setPickFor({ id: c.id, stage });   // 순을 고르면 그때 옮긴다
      return;
    }
    W.setStage(c.id, stage);
  }, [sunOf, onChanged]);

  const goCol = (i) => {
    const el = scrollRef.current;
    const col = el?.children?.[i];
    if (col) el.scrollTo({ left: col.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  };
  const [over, setOver] = React.useState(false);
  const [fadeR, setFadeR] = React.useState(false);
  const readFade = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setOver(el.scrollWidth - el.clientWidth > 1);
    setFadeR(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
  }, []);
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    readFade();
    const ro = new ResizeObserver(readFade);
    ro.observe(el);
    return () => ro.disconnect();
  }, [readFade]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setVisibleCol(Math.min(W.STAGES.length - 1, Math.round(el.scrollLeft / (el.scrollWidth / W.STAGES.length))));
    readFade();
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const activeCard = activeId ? cards.find(c => c.id === activeId) : null;
  const handleDragEnd = (e) => {
    const { active: a, over: o } = e;
    setActiveId(null);
    if (!o) return;
    const raw = String(o.id);
    const c = cards.find(x => x.id === a.id);
    if (!c) return;
    if (raw === HOLD_DROP) { move(c, W.HOLD); return; }
    if (raw.startsWith('card:')) {
      const overId = raw.slice(5);
      if (overId === c.id) return;
      const overCard = cards.find(x => x.id === overId);
      if (!overCard) return;
      const dest = overCard.stage;
      const orig = byStage[dest] || [];
      const fromIdx = orig.findIndex(x => x.id === c.id);
      const overIdx = orig.findIndex(x => x.id === overId);
      const col = orig.filter(x => x.id !== c.id);
      let at = col.findIndex(x => x.id === overId);
      if (at < 0) at = col.length;
      if (fromIdx > -1 && fromIdx < overIdx) at += 1;   // 아래로 끌었으면 뒤, 위로 끌었으면 앞(업무 보드와 같다)
      col.splice(at, 0, c);
      W.reorder(col.map((x, i) => ({ id: x.id, position: i + 1 })));
      if (c.stage !== dest) move(c, dest);
      return;
    }
    const isChip = raw.startsWith('chip:');
    const target = isChip ? raw.slice(5) : raw;
    if (c.stage === target) {
      if (isChip) return;
      W.reorder([...(byStage[target] || []).filter(x => x.id !== c.id), c].map((x, i) => ({ id: x.id, position: i + 1 })));
      return;
    }
    W.reorder([...(byStage[target] || []), c].map((x, i) => ({ id: x.id, position: i + 1 })));
    move(c, target);
  };

  const open = cards.find(c => c.id === openId) || null;

  return (
    <DndContext sensors={sensors} collisionDetection={dropCollision} autoScroll={{ threshold: { x: 0, y: 0.2 } }}
      onDragStart={(e) => setActiveId(e.active.id)} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
      <section className="welcome-board dc-screen" data-welcome-board="">
        <HoldRow cards={byStage[W.HOLD]} dragging={!!activeId} onOpen={setOpenId} />
        <div className="md:hidden flex gap-1.5 mb-2.5 overflow-x-auto scrollbar-hide x-scroll-lock">
          {W.STAGES.map(([k, label], i) => (
            <StageChip key={k} stage={k} label={label} count={byStage[k].length} current={i === visibleCol}
              dragging={!!activeId} isDraggedStage={activeCard?.stage === k} onClick={() => goCol(i)} />
          ))}
        </div>
        {activeId && <p className="md:hidden text-center text-[10px] text-fg-muted mb-1.5 -mt-0.5">위 단계 칩에 놓으면 바로 옮겨져요</p>}
        <div ref={scrollRef} onScroll={onScroll} data-fade-r={fadeR ? '' : undefined}
          className={`${over ? 'x-fade-edge ' : ''}flex gap-[14px] md:gap-[18px] pb-1.5 overflow-x-auto overflow-y-hidden max-md:scrollbar-hide [overscroll-behavior-x:none] ${activeId ? '' : 'snap-x snap-mandatory md:snap-none'}`}>
          {W.STAGES.map(([k, label]) => (
            <Column key={k} stage={k} label={label} count={byStage[k].length} share={active ? byStage[k].length / active : 0} dragging={!!activeId}>
              {byStage[k].map((c, i) => (
                <DraggableCard key={c.id} c={c} index={stagger ? i : 0} sunName={sunOf(c.person_id)?.name} onOpen={setOpenId} onMove={move} />
              ))}
            </Column>
          ))}
        </div>
      </section>
      {createPortal(
        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {activeCard ? (
            <div className="bg-surface px-3.5 py-3 rounded-sm border border-line shadow-elevated rotate-1 scale-[.98] opacity-95 cursor-grabbing w-[220px]">
              <CardInner c={activeCard} sunName={sunOf(activeCard.person_id)?.name} />
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
      {open && (
        <CardModal c={open} sun={sunOf(open.person_id)} suns={suns} members={members} people={people} meName={meName}
          pickFor={pickFor?.id === open.id ? pickFor.stage : null} onMove={move}
          onAssign={async (group) => {
            const cur = sunOf(open.person_id);
            const ok = cur ? await onMoveSun?.(cur, group.id, { id: open.person_id, name: open.name }) : await onAssignSun?.(group, open.person_id);
            if (ok === false) return;
            const to = pickFor?.id === open.id ? pickFor.stage : (W.STAGE_INDEX[open.stage] < W.STAGE_INDEX.sun ? 'sun' : null);
            if (to) W.setStage(open.id, to);
            setPickFor(null);
          }}
          onClose={() => { setOpenId(null); setPickFor(null); }} />
      )}
    </DndContext>
  );
}

// ── 카드 창 — 업무 창과 같은 껍데기 ───────────────────────────────────────
function CardModal({ c, sun, suns, members, people, meName, pickFor, onMove, onAssign, onClose }) {
  const [leaving, leave] = useLeave();
  const close = React.useCallback(() => leave(onClose), [leave, onClose]);
  const [busy, setBusy] = React.useState(null);
  const downOnOverlay = React.useRef(false);
  const overlayRef = React.useRef(null);
  const sunRef = React.useRef(null);
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);
  const showSuns = !!pickFor || ['meet', 'sun', 'settled'].includes(c.stage);
  React.useEffect(() => { if (pickFor) sunRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [pickFor]);

  const at = W.STAGE_INDEX[c.stage] ?? -1;
  const doneText = {
    visit1: md(c.visits[0]), visit2: md(c.visits[1]),
    contact: c.contact ? `${md(c.contact.at)} · ${c.contact.by}` : '',
    register: md(c.registered_at), meet: c.meets.length ? `${c.meets.length}번 · ${md(c.meets[c.meets.length - 1])}` : '',
    sun: sun?.name || '', settled: md(c.settled_at),
  };
  const leaderName = (g) => people.find(p => p.id === g.leader_person_id)?.name || '';
  const countOf = (g) => members.filter(m => m.group_id === g.id).length;
  const pick = async (g) => { setBusy(g.id); try { await onAssign(g); } finally { setBusy(null); } };
  const Info = ({ label, children }) => (children ? (
    <div className="flex items-baseline gap-3 py-1">
      <span className="w-[4.5rem] shrink-0 text-[12px] font-semibold text-fg-muted">{label}</span>
      <span className="min-w-0 flex-1 text-[13px] text-fg break-words">{children}</span>
    </div>
  ) : null);

  // 그 단계에서 할 일(바닥 줄 오른쪽 · 주 버튼은 하나)
  const primary = () => {
    switch (c.stage) {
      case 'visit1': return <button type="button" className={BTN_CONFIRM} onClick={() => onMove(c, 'visit2')}>두 번째 방문 기록</button>;
      case 'visit2': return <button type="button" className={BTN_CONFIRM} onClick={() => W.markContacted(c.id, meName || '나')}>컨택했어요</button>;
      case 'contact': return <button type="button" className={BTN_CONFIRM} onClick={() => onMove(c, 'register')} data-welcome-register="">새신자로 등록</button>;
      case 'register': return <button type="button" className={BTN_CONFIRM} onClick={() => W.addMeet(c.id)}>리더 모임 기록</button>;
      case 'meet': return (<>
        <button type="button" className={BTN_CONFIRM_QUIET} onClick={() => W.addMeet(c.id)}>리더 모임 기록</button>
        <button type="button" className={BTN_CONFIRM} onClick={() => onMove(c, 'sun')}>순 배정</button>
      </>);
      case 'sun': return <button type="button" className={BTN_CONFIRM} onClick={() => onMove(c, 'settled')}>정착으로</button>;
      case W.HOLD: return <button type="button" className={BTN_CONFIRM} onClick={() => W.setStage(c.id, c.person_id ? 'register' : 'contact')}>다시 진행</button>;
      default: return null;
    }
  };
  const out = leaving ? ' dc-out' : '';

  return createPortal(
    <div ref={overlayRef}
      onMouseDown={(e) => { downOnOverlay.current = e.target === overlayRef.current; }}
      onClick={(e) => { if (e.target === overlayRef.current && downOnOverlay.current) close(); }}
      className={`fixed inset-0 h-[var(--app-vh,100dvh)] bg-black/50 flex items-end md:items-center justify-center z-50 dc-scrim${out} duration-150 p-0 md:p-4`}>
      <div role="dialog" aria-label={`${c.name} 정착 카드`} data-welcome-modal=""
        className={`bg-surface shadow-elevated border border-line w-full md:max-w-lg flex flex-col overflow-hidden dc-dialog${out} duration-150 max-h-[92dvh] md:max-h-[min(85dvh,calc(var(--app-vh,100dvh)-2rem))] rounded-t-lg md:rounded-lg`}>
        <div className="shrink-0 bg-surface px-4 py-3 border-b border-line flex justify-between items-center gap-2">
          <div className="min-w-0 flex items-center gap-2">
            <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: W.STAGE_DOT[c.stage] }} />
            <span className="text-[12px] font-semibold text-fg-muted shrink-0">{c.stage === W.HOLD ? W.HOLD_LABEL : W.STAGE_LABEL[c.stage]}</span>
          </div>
          <button type="button" onClick={close} aria-label="닫기" className="p-1.5 rounded-md text-fg-muted hover:bg-surface-hover transition-colors"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable]">
          <div className="p-5 md:p-6">
            <h2 className="text-xl font-bold text-fg tracking-[-0.4px]">{c.name}</h2>
            <p className="mt-1 text-[12px] text-fg-muted">{[`첫 방문 ${md(c.visits[0])}`, c.owner && `담당 ${c.owner}`].filter(Boolean).join(' · ')}</p>

            <div className="mt-4 rounded-md bg-canvas px-3 py-1.5">
              <Info label="연락처">{c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-accent-text"><Phone size={12} />{c.phone}</a>}</Info>
              <Info label="태어난 해">{c.birth_year ? `${c.birth_year}년` : ''}</Info>
              <Info label="어떻게">{c.how}</Info>
              <Info label="하고 싶은 말">{c.note}</Info>
            </div>

            <h4 className="mt-5 mb-1.5 text-[12px] font-bold text-fg-muted">단계</h4>
            <ol data-welcome-steps="">
              {W.STAGES.map(([k, label], i) => {
                const done = c.stage !== W.HOLD && i < at;
                const cur = i === at;
                return (
                  <li key={k}>
                    <button type="button" onClick={() => onMove(c, k)} aria-current={cur ? 'step' : undefined}
                      className={`w-full flex items-center gap-2.5 px-2 h-9 rounded-md text-left transition-colors hover:bg-surface-hover ${cur ? 'bg-accent-weak' : ''}`}>
                      <span className={`w-[18px] h-[18px] shrink-0 rounded-full flex items-center justify-center border ${done ? 'bg-accent border-transparent text-white' : cur ? 'border-accent' : 'border-line'}`}>
                        {done && <Check size={11} strokeWidth={3} />}
                        {cur && <span className="w-2 h-2 rounded-full bg-accent" />}
                      </span>
                      <span className={`text-[13px] ${cur ? 'font-bold text-fg' : done ? 'text-fg-secondary' : 'text-fg-muted'}`}>{label}</span>
                      <span className="ml-auto text-[11px] text-fg-muted tabular-nums truncate">{(done || cur) ? doneText[k] : ''}</span>
                    </button>
                  </li>
                );
              })}
            </ol>

            {showSuns && (
              <div ref={sunRef} data-welcome-suns="">
                <h4 className="mt-5 mb-1.5 text-[12px] font-bold text-fg-muted">순</h4>
                <div className="border border-line rounded-lg p-1.5">
                  {suns.map(g => {
                    const on = sun?.id === g.id;
                    return (
                      <button key={g.id} type="button" disabled={!!busy || on} onClick={() => pick(g)} data-sun-pick={g.id}
                        className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left transition-colors hover:bg-surface-hover disabled:hover:bg-transparent ${on ? 'bg-accent-weak' : ''}`}>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[12.5px] font-semibold text-fg truncate">{g.name}</span>
                          <span className="block text-[10.5px] text-fg-muted truncate">{[leaderName(g) && `순장 ${leaderName(g)}`, `${countOf(g)}명`].filter(Boolean).join(' · ')}</span>
                        </span>
                        {busy === g.id ? <Loader2 size={14} className="animate-spin text-fg-muted" /> : on && <Check size={14} className="text-accent-text" />}
                      </button>
                    );
                  })}
                  {!suns.length && <p className="px-2 py-2 text-[12px] text-fg-muted">올해 순이 아직 없어요</p>}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0 border-t border-line p-3 md:p-4 flex justify-between items-center gap-2 bg-surface-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          {c.stage !== W.HOLD && c.stage !== 'settled'
            ? <button type="button" className={BTN_CONFIRM_QUIET} onClick={() => onMove(c, W.HOLD)}>{W.HOLD_LABEL}</button>
            : <span />}
          <span className="flex items-center gap-2">{primary()}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
