import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, CheckSquare, MessageSquare, Paperclip } from 'lucide-react';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin, rectIntersection,
} from '@dnd-kit/core';
import { CONFIG, teamPaint, teamColor } from '../config.js';
import { avatarColor, subtaskProgress } from '../utils.js';
import { STATUS_BAR, STATUS_DOT_VAR, byDue } from '../views/dashboardParts.jsx';
import { useStore } from '../store/workspaceStore.js';
import { selectProjectsMap } from '../store/selectors.js';
import { useAnchoredPos } from './ConfirmPopover.jsx';

// ============================================================================
// 칸반 보드 (dnd-kit) — 카드 · 상태 칩 · 컬럼
// 캘린더는 같은 자리에 놓이는 다른 보기라 calendar.jsx로 나눠 뒀다.
// ============================================================================

// 놓을 곳은 "손가락/커서가 있는 곳" 기준으로 판단한다.
// 기본값(rectIntersection)은 끌고 있는 카드의 사각형이 가장 많이 겹친 대상을 고르는데,
// 카드 폭이 상태 칩보다 훨씬 넓어서 엉뚱한 칩에 놓이곤 했다(실측: 완료에 놓았는데 보류 중).
// 포인터가 어떤 대상 안에도 없을 때만 기존 방식으로 되돌린다.
const dropCollision = (args) => {
  const hit = pointerWithin(args);
  return hit.length ? hit : rectIntersection(args);
};
// 남은 날 → 라벨. 완료는 날짜만, 지난 건은 "N일 지남"으로 눈에 걸리게.
const ddLabel = (task) => {
  if (!task.dueDate) return '';
  const d = Math.round((new Date(`${task.dueDate}T00:00:00`) - new Date(new Date().toDateString())) / 86400000);
  if (task.status === '완료') return `${Number(task.dueDate.slice(5, 7))}. ${Number(task.dueDate.slice(8, 10))}.`;
  if (d < 0) return `${-d}일 지남`;
  return d === 0 ? '오늘' : `D-${d}`;
};
const isLate = (task) => !!task.dueDate && task.status !== '완료'
  && new Date(`${task.dueDate}T00:00:00`) < new Date(new Date().toDateString());

// 카드 내부 프레젠테이션 (실제 카드 + DragOverlay 미리보기 공용)
// 좌측 3px 팀 컬러 레일 → 팀명(10px) → 제목(14px) → 담당자·D-day (핸드오프 규격)
const TaskCardInner = React.memo(({ task, projectsMap, showProjectBadge, action = null }) => {
  const late = isLate(task);
  const rail = teamPaint(task.teams, true);
  const sub = subtaskProgress(task.subtasks || []);
  // 클라우드에서는 트리거가 유지하는 개수 컬럼을, 게스트 모드에서는 실제 배열을 센다
  // (게스트에는 서버가 없어 컬럼이 없다). 창을 연 카드는 배열이 더 최신일 수 있으니
  // 둘 중 큰 값을 쓴다 — 방금 남긴 댓글이 카드에서 0으로 보이면 이상하다.
  const counts = {
    comments: Math.max(task.commentCount ?? 0, (task.comments || []).filter(c => !c.parentId).length),
    files: Math.max(task.fileCount ?? 0, (task.attachments || []).length),
  };
  return (
    <div className="flex gap-2.5">
      <span className="shrink-0 w-[3px] rounded-full my-0.5" style={rail} />
      <span className="flex-1 min-w-0">
        {showProjectBadge && projectsMap[task.projectId] && (
          <span className="block text-[10px] text-fg-faint mb-0.5 truncate">{projectsMap[task.projectId].title}</span>
        )}
        <span className="flex items-center gap-1.5 mb-[3px] min-w-0">
          <span className="flex-1 min-w-0 flex flex-wrap gap-x-1.5">
            {task.teams.map(t => (
              <span key={t} className="text-[10px] font-bold" style={{ letterSpacing: '.02em', color: teamColor(t) }}>{t}</span>
            ))}
          </span>
          {action}
        </span>
        <span className="block text-sm font-semibold text-fg" style={{ lineHeight: 1.4, letterSpacing: '-0.2px' }}>{task.title}</span>
        <span className="flex items-center justify-between gap-2 mt-2">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            {task.assignees.length > 0 ? (
              <>
                <span className={`w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9.5px] font-bold shrink-0 ${avatarColor(task.assignees[0])}`}>{task.assignees[0][0]}</span>
                <span className="text-[11px] text-fg-muted truncate">{task.assignees[0]}{task.assignees.length > 1 ? ` +${task.assignees.length - 1}` : ''}</span>
              </>
            ) : <span className="text-[11px] text-fg-faint truncate">담당자 미지정</span>}
          </span>
          <span className="shrink-0 inline-flex items-center gap-2">
            {/* 하위 업무 진척 — 카드를 열지 않아도 몇 단계 남았는지 보인다.
                subtasks는 cards 컬럼이라 목록 로드에 이미 들어와 있다.
                항목이 없으면 아무것도 안 그린다. */}
            {sub.total > 0 && (
              <span className="inline-flex items-center gap-1 text-[10.5px] tabular-nums"
                style={{ color: sub.done === sub.total ? 'var(--app-tag-green-fg)' : 'var(--app-ink-faint)' }}
                title={`하위 업무 ${sub.done}/${sub.total}`}>
                <CheckSquare size={10} strokeWidth={2} />{sub.done}/{sub.total}
              </span>
            )}
            {/* 댓글·첨부는 업무 창을 열어야 보이는 데이터라, 개수만 카드가 들고 있다
                (0016의 comment_count·file_count — 트리거가 DB에서 유지한다).
                0이면 그리지 않는다: 대화가 없다는 것을 굳이 말할 필요가 없다. */}
            {counts.comments > 0 && (
              <span className="inline-flex items-center gap-1 text-[10.5px] tabular-nums text-fg-faint"
                title={`댓글 ${counts.comments}`}>
                <MessageSquare size={10} strokeWidth={2} />{counts.comments}
              </span>
            )}
            {counts.files > 0 && (
              <span className="inline-flex items-center gap-1 text-[10.5px] tabular-nums text-fg-faint"
                title={`첨부 ${counts.files}`}>
                <Paperclip size={10} strokeWidth={2} />{counts.files}
              </span>
            )}
            {task.dueDate && (
              <span className="text-[11px] font-bold tabular-nums px-1.5 py-px rounded-[4px]"
                style={{ background: late ? 'var(--app-tag-red)' : 'transparent', color: late ? 'var(--app-tag-red-fg)' : 'var(--app-ink-muted)' }}>
                {ddLabel(task)}
              </span>
            )}
          </span>
        </span>
      </span>
    </div>
  );
});

// 모바일에서 끌지 않고 상태를 옮기는 버튼 — 카드마다 하나(모바일 전용).
// 길게 눌러 끌기는 그대로 두고, "탭 → 상태 고르기"라는 확실한 길을 하나 더 준다.
// 팝오버는 반드시 포털로 띄운다: 카드에 content-visibility가 걸려 있어 카드 안의
// position:fixed는 뷰포트가 아니라 카드를 기준으로 잡힌다.
function StatusMoveButton({ task, onStatusChange }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const btnRef = React.useRef(null);
  const popRef = React.useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open, 150, 160, 8, popRef);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      const inside = rootRef.current?.contains(e.target) || popRef.current?.contains(e.target);
      if (!inside) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // pointerDown까지 막아야 dnd-kit이 이 버튼을 드래그 시작으로 보지 않는다
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };

  // 카드 우상단 24×24 버튼 → 150px 팝오버 (핸드오프 규격). 데스크톱에도 둔다 —
  // 드래그를 못 하는 상황(터치패드·확대 상태)에서도 상태를 옮길 길이 있어야 한다.
  return (
    <span ref={rootRef} className="inline-flex shrink-0">
      <span ref={btnRef} className="inline-flex">
        <button
          type="button" title="상태 옮기기" aria-label="상태 옮기기"
          onPointerDown={stop} onTouchStart={stop} onMouseDown={stop}
          onClick={(e) => { e.stopPropagation(); place(); setOpen(o => !o); }}
          className="w-6 h-6 -mr-1 -mt-0.5 rounded-md flex items-center justify-center text-fg-faint hover:text-accent-text hover:bg-surface-hover transition-colors"
        >
          <ArrowLeftRight size={13} />
        </button>
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: 150 }}
          className="dc-pop z-[90] bg-surface border border-line rounded-[8px] shadow-soft p-[5px]"
        >
          {CONFIG.STATUSES.map(s => (
            <button
              key={s} type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); if (s !== task.status) onStatusChange(task, s); }}
              className="w-full flex items-center gap-2 px-2 py-[7px] rounded-[5px] text-left text-[12.5px] transition-colors hover:bg-surface-hover"
              style={{
                background: s === task.status ? 'var(--app-surface-hover)' : 'transparent',
                color: s === task.status ? 'var(--app-ink)' : 'var(--app-ink-muted)',
              }}
            >
              <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: STATUS_DOT_VAR[s] }} />
              <span className="flex-1 truncate">{s}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </span>
  );
}

// 드래그 가능한 카드 — 클릭(모달)과 드래그는 센서 activationConstraint(distance/delay)로 구분
function DraggableCard({ task, index, projectsMap, showProjectBadge, onTaskClick, onStatusChange }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef} {...attributes} {...listeners}
      onClick={() => onTaskClick(task)}
      // 카드를 흰 상자로 세우지 않고 목록의 한 줄로 둔다 — 얇은 구분선만.
      // 상자 + 그림자 + 라운드를 카드마다 반복하면 화면이 자동 생성된 것처럼 읽힌다.
      style={{ animationDelay: `${Math.min(index ?? 0, 10) * 24}ms`, borderBottom: '1px solid var(--app-line)' }}
      className={`board-card dc-card relative pr-2 pt-[11px] pb-3 cursor-grab active:cursor-grabbing hover:bg-surface-hover transition-colors ${isDragging ? 'opacity-40' : ''}`}
    >
      <TaskCardInner
        task={task} projectsMap={projectsMap} showProjectBadge={showProjectBadge}
        action={<StatusMoveButton task={task} onStatusChange={onStatusChange} />}
      />
    </div>
  );
}

// 모바일 상태 칩 — 탭하면 그 컬럼으로 이동, 드래그 중에는 드롭 타깃.
// 컬럼과 id가 겹치지 않게 'chip:' 접두사를 쓰고 handleDragEnd에서 벗겨낸다.
function StatusChip({ status, count, current, dragging, isDraggedStatus, onClick }) {
  const { setNodeRef, isOver } = useDroppable({ id: `chip:${status}` });
  const base = 'shrink-0 inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-[11px] font-semibold transition active:scale-95';
  let tone;
  if (dragging) {
    if (isOver) tone = 'bg-accent-weak border-accent text-accent-text shadow-soft scale-105';
    else if (isDraggedStatus) tone = 'bg-surface-2 border-line border-dashed text-fg-faint';
    else tone = 'bg-surface border-accent border-dashed text-fg-muted';
  } else {
    tone = current ? 'bg-surface border-accent text-fg shadow-soft' : 'bg-surface-2 border-line text-fg-muted';
  }
  return (
    <button ref={setNodeRef} type="button" onClick={onClick} className={`${base} ${tone}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CONFIG.STATUS_DOTS[status] || 'bg-fg-faint'}`} />
      {status}
      <span className="text-fg-faint font-normal">{count}</span>
    </button>
  );
}

// 드롭 대상 컬럼(status) — dnd-kit useDroppable의 isOver로 강조
function ColumnDroppable({ status, count, share, dragging, empty, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      // 모바일: 82vw로 다음 컬럼이 살짝 보이게(더 있다는 신호) + 스냅
      // 데스크톱: 최소 210px, 4개 상태가 한 화면에 들어온다
      className={`flex-1 basis-0 min-w-[82vw] md:min-w-[210px] flex flex-col min-h-0 snap-start h-full rounded-sm transition-colors duration-150 ${isOver ? 'bg-accent-weak/70' : ''}`}
    >
      {/* 컬럼 헤더: 상태 점 + 이름 + 건수 + 우측 44×3px 비중 바 */}
      <div className="flex items-center gap-[7px] pb-2 shrink-0" style={{ borderBottom: '1px solid var(--app-line)' }}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT_VAR[status] }} />
        <h3 className="text-[12.5px] font-bold text-fg">{status}</h3>
        <span className="text-[11.5px] font-semibold text-fg-faint tabular-nums">{count}</span>
        <span className="flex-1" />
        <span className="block w-11 rounded-full overflow-hidden shrink-0" style={{ height: 3, background: 'var(--p-track)' }}>
          <span className="dc-bar-fill block h-full rounded-full"
            style={{ background: STATUS_BAR[status], transform: `scaleX(${(share || 0).toFixed(3)})`, transitionDuration: '.45s' }} />
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pt-0.5">
        {children}
        {empty && !dragging && (
          <div className="py-[22px] text-center">
            <EmptyColumnMark />
            <p className="text-[11px] text-fg-faint">아직 업무가 없어요</p>
          </div>
        )}
        {/* 드래그 중일 때만 드롭 존 안내 표시 */}
        <div className={`h-16 border border-dashed rounded-sm flex items-center justify-center text-xs transition-all ${dragging ? (isOver ? 'opacity-100 border-accent text-accent-text' : 'opacity-100 border-line text-fg-faint') : 'opacity-0 border-transparent text-fg-faint'}`}>여기로 놓기</div>
      </div>
    </div>
  );
}

// 빈 칸 표식 — 카드 한 장이 선으로 그려진다(로티 파일 없이 선 애니메이션 하나로).
function EmptyColumnMark() {
  return (
    <svg viewBox="0 0 40 40" className="w-9 h-9 mx-auto mb-1.5" aria-hidden="true"
      fill="none" stroke="var(--app-line)" strokeWidth="1.6" strokeLinecap="round">
      <path className="dc-draw" pathLength="1"
        d="M8 9.5h24a2.5 2.5 0 0 1 2.5 2.5v16a2.5 2.5 0 0 1-2.5 2.5H8a2.5 2.5 0 0 1-2.5-2.5V12A2.5 2.5 0 0 1 8 9.5Z" />
      <path className="dc-draw dc-draw-2" pathLength="1" d="M11 17.5h13" />
      <path className="dc-draw dc-draw-3" pathLength="1" d="M11 23.5h8" />
    </svg>
  );
}

export const Board = React.memo(({ tasks, onStatusChange, onTaskClick, showProjectBadge }) => {
  const projectsMap = useStore(selectProjectsMap);
  const [activeId, setActiveId] = React.useState(null);
  const scrollRef = React.useRef(null);
  const [visibleCol, setVisibleCol] = React.useState(0);

  // 상태별 그룹핑을 한 번만 — 컬럼마다 filter를 두 번씩 돌지 않게.
  // 컬럼 안 순서는 마감일 순(마감 미정은 아래) — 마감 그룹 목록과 같은 비교 함수를 쓴다.
  const byStatus = React.useMemo(() => {
    const m = {};
    CONFIG.STATUSES.forEach(s => { m[s] = []; });
    tasks.forEach(t => { (m[t.status] || (m[t.status] = [])).push(t); });
    Object.values(m).forEach(list => list.sort(byDue));
    return m;
  }, [tasks]);

  // 모바일은 컬럼이 80vw라 4개를 동시에 못 보여준다 → 상단에 상태 칩으로
  // 4개 상태와 건수를 한눈에 보여주고, 누르면 그 컬럼으로 스크롤한다.
  const goCol = (i) => {
    const el = scrollRef.current;
    const col = el?.children?.[i];
    if (col) el.scrollTo({ left: col.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  };
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const per = el.scrollWidth / CONFIG.STATUSES.length;
    setVisibleCol(Math.min(CONFIG.STATUSES.length - 1, Math.round(el.scrollLeft / per)));
  };

  // MouseSensor + TouchSensor로 입력 종류를 완전히 분리한다.
  // PointerSensor를 쓰면 터치에서도 pointerdown이 잡혀 6px 이동하는 순간 드래그가
  // 시작되고, 동시에 브라우저는 스크롤을 시작해 pointercancel을 던진다 → 드래그가
  // 매번 취소돼서 모바일에서 카드가 아예 안 옮겨졌다(실측 확인).
  // 터치는 TouchSensor만 담당: 200ms 꾹 누르면 시작하고, 그때부터 dnd-kit이
  // touchmove를 preventDefault해서 스크롤과 싸우지 않는다.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  const handleDragStart = (e) => setActiveId(e.active.id);
  const handleDragCancel = () => setActiveId(null);
  const handleDragEnd = (e) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;
    // 드롭 타깃은 컬럼('시작 전') 또는 모바일 상태 칩('chip:시작 전')
    const raw = String(over.id);
    const target = raw.startsWith('chip:') ? raw.slice(5) : raw;
    const task = tasks.find(t => t.id === active.id);
    if (task && task.status !== target) onStatusChange(task, target);
  };

  return (
    <DndContext
      sensors={sensors} collisionDetection={dropCollision}
      // 가로 자동 스크롤만 끈다(threshold.x=0). 켜져 있으면 손가락이 화면 오른쪽
      // 20% 안에 들어간 순간 화면이 옆으로 밀려서, 놓으려던 상태 칩이 손가락 밑에서
      // 빠져나간다(실측: 완료 칩에 놓았는데 진행 중으로 저장됨).
      // 세로(threshold.y)는 그대로 — 카드가 많은 컬럼에서 아래로 끌 때 필요하다.
      autoScroll={{ threshold: { x: 0, y: 0.2 } }}
      onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}
    >
      <div className="h-full flex flex-col min-h-0">
        {/* 모바일 전용 상태 칩 — 평소엔 요약·이동, 드래그 중에는 드롭 타깃이 된다.
            (화면에 컬럼 하나만 보이는 모바일에서 옆 컬럼까지 끌고 갈 필요가 없도록) */}
        <div className="md:hidden flex gap-1.5 mb-2.5 overflow-x-auto scrollbar-hide x-scroll-lock shrink-0">
          {CONFIG.STATUSES.map((status, i) => (
            <StatusChip
              key={status} status={status} count={(byStatus[status] || []).length}
              current={i === visibleCol} dragging={!!activeId}
              isDraggedStatus={activeTask?.status === status}
              onClick={() => goCol(i)}
            />
          ))}
        </div>
        {activeId && (
          <p className="md:hidden text-center text-[10px] text-fg-faint mb-1.5 -mt-0.5">위 상태 칩에 놓으면 바로 옮겨져요</p>
        )}
        <div
          ref={scrollRef} onScroll={onScroll}
          // overscroll-behavior-x만 건다 — touch-action:pan-x를 걸면 컬럼 안 카드 목록의
          // 세로 스크롤까지 막힌다(자손 전체에 적용되므로).
          // contain이 아니라 none: contain은 부모로 스크롤이 넘어가는 것만 막고 자기
          // 고무줄(바운스)은 남겨서, '완료' 오른쪽으로 더 넘어갈 것처럼 밀렸다.
          className={`flex-1 min-h-0 flex gap-[14px] md:gap-[22px] pb-1.5 overflow-x-auto [overscroll-behavior-x:none] ${activeId ? '' : 'snap-x snap-mandatory md:snap-none'}`}
        >
          {CONFIG.STATUSES.map(status => (
            <ColumnDroppable key={status} status={status} dragging={!!activeId} count={(byStatus[status] || []).length} share={tasks.length ? (byStatus[status] || []).length / tasks.length : 0} empty={(byStatus[status] || []).length === 0}>
              {(byStatus[status] || []).map((task, i) => (
                <DraggableCard key={task.id} task={task} index={i} projectsMap={projectsMap} showProjectBadge={showProjectBadge} onTaskClick={onTaskClick} onStatusChange={onStatusChange} />
              ))}
            </ColumnDroppable>
          ))}
        </div>
      </div>
      {/* 드래그 중 미리보기(기존 스타일 유지). 원래 카드는 opacity-40.
          body로 포털을 내보내야 한다: DragOverlay는 position:fixed로 카드 좌표에
          맞춰 뜨는데, 조상(.dc-screen/.dc-card)에 transform 애니메이션이 걸려 있으면
          그 조상이 fixed의 기준 박스가 돼서 미리보기가 헤더+여백만큼(약 100px)
          아래로 밀려 떴다. body 밑이면 기준이 항상 뷰포트다. */}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            // 끌고 있는 동안만 상자로 세운다 — 손에 들린 게 무엇인지 보여야 하니까
            <div className="bg-surface px-3.5 py-3 rounded-sm border border-line shadow-elevated rotate-1 scale-[.98] opacity-95 cursor-grabbing">
              <TaskCardInner task={activeTask} projectsMap={projectsMap} showProjectBadge={showProjectBadge} />
            </div>
          ) : null}
        </DragOverlay>,
        document.body
      )}
    </DndContext>
  );
});
