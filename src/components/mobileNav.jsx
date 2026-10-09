import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { LayoutDashboard, CheckSquare, Hash, Pencil, Users, Archive, CalendarDays, Church, BookOpen, HeartHandshake, Home, Briefcase } from 'lucide-react';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from '@dnd-kit/core';
import { dropCollision } from './dropCollision.js';
import { useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsList, selectActiveProjectsList, selectProjectsMap, selectMyTasks,
} from '../store/selectors.js';
import { projectYear, reorderIds } from '../utils.js';
import { useProjectYear } from '../hooks/useProjectYear.js';
import { pickProjectToOpen } from '../services/tabRank.js';
import { useTabFrontStats } from '../services/tabFront.js';
import { isOpen } from '../services/taskCounts.js';
import { DaboutiFace } from './dabooti.jsx';
import { showToast } from './Toast.jsx';
import { CHURCH_MENUS, ProfileMenu, ViewerFaces } from './layout.jsx';
import { tabDividerCls, FreshDot, useFreshProjects, useFrontNudge, FrontNudge, saveTabOrder, useYearTabs, YearPicker } from './navParts.jsx';
import { SearchBox } from './searchBox.jsx';
import { NotificationBell } from './notificationBell.jsx';

// ============================================================================
// 폰 내비 — 상단바(MobileTopBar: 화면 이름 + 아이콘 줄 + 프로젝트 탭 줄)와 하단 바(MobileTabBar: 교회 층 ↔ 업무 층).
// 19차 묶음 D에서 layout.jsx에서 갈라 왔다(동작·모양은 그대로). 데스크톱 TopNav는 layout.jsx에 있다.
//   · 탭 계산(고른 해 · 앞 칸 · 보관 탭)은 데스크톱과 한 벌(navParts.useYearTabs) · 폰은 전부 그리므로 더보기가 없다
//   · 탭 순서는 길게 눌러 끈다(dnd-kit TouchSensor 300ms · PITFALLS 12-g) · 저장은 데스크톱과 같은 saveTabOrder
//   · 상단바는 flex 항목 z-20이라 쌓임 맥락을 만든다 — **안에 fixed 판을 새로 두지 말 것**(검색 판은 body 포털 · PITFALLS 9-cb)
//   · 하단 바는 두 층을 겹쳐 그리고 업무 층의 왼쪽 끝만 움직인다(index.css `.tab-bar-work`) · 실제 높이를 --mobile-tab-bar-h로
// ============================================================================

// 모바일 상단: 현재 화면 이름 + 검색·알림, 그 아래 프로젝트 탭(가로 스크롤)
export const MobileTopBar = React.memo(({ activeMenu, setActiveMenu, onSearchSelect, onOpenTask, onOpenLink, onOpenProject, onRenameProject, onOpenProfile, onOpenMembers, cloudMode }) => {
  // 보관된 프로젝트도 **같은 탭 줄**에 선다(사용자 결정 2026-09-14) — 데스크톱은
  // '더보기 → 연도 폴더'에 보관함이 있는데 여기에는 그 입구가 아예 없어서, 폰에서는
  // 보관한 프로젝트를 여는 길이 없었다(사용자 신고). 활성 탭을 다 세운 **뒤**에
  // 이어 붙이고 흐린 글자 + Archive 아이콘으로 가른다(데스크톱 YearFolders와 같은 결).
  const projectsMap = useStore(selectProjectsMap);
  // 지금 보고 있는 프로젝트(아니면 null). **이 한 값이 두 가지 일을 한다** — 탭 줄에
  // 끌어올릴지 정하고, 제목 줄과 탭 줄이 설지 정한다. 예전에는 같은 조회가 두 벌이었다.
  // 프로젝트 탭 줄은 프로젝트를 보고 있을 때만 — 내 업무·대시보드에서는 쓸 일이 없고
  // 좁은 화면에서 한 줄이 그대로 낭비된다(다른 프로젝트로는 하단 '프로젝트' 탭으로 간다)
  // 앞 칸(데스크톱 TopNav와 같은 규칙 · services/tabRank.js) — 계산은 한 벌(navParts.useYearTabs).
  // 폰은 보관된 지금 프로젝트를 posBase에 끌어올리지 않는다(liftArchived: false) — 아래에서 보관 탭 앞에 한 번 넣는다.
  // 그 해의 보관 프로젝트(archivedTail)는 지금 열어 둔 것을 빼고 온다 — **빼지 않으면 같은 프로젝트가 두 번 선다**
  // (보관된 것을 열어 두면 아래 줄이 이미 탭으로 끌어올리기 때문이다 · 데스크톱 archivedForMore가 같은 함정 · navsmoke가 잡았다).
  const {
    allProjects: allForYear, project, year, setYear, years, yearCounts,
    posSource: posBase, tabSource: base, frontIds, frontStats, archivedForYear: archivedTail,
  } = useYearTabs(activeMenu, { liftArchived: false });
  const projectsList = project?.archived ? [...base, project, ...archivedTail] : [...base, ...archivedTail];
  const currentUser = useStore(selectCurrentUser);
  const title = menuTitle(activeMenu, projectsMap, currentUser);
  const freshIds = useFreshProjects(activeMenu, !!project);
  return (
    <div className="md:hidden shrink-0 border-b border-line/70 z-20">
      <div className="flex items-center gap-1 px-3.5 h-12">
        {/* 프로젝트를 보고 있으면 제목을 눌러 이름을 바꾼다 */}
        {project ? (
          <button onClick={() => onRenameProject?.(project)} className="flex-1 min-w-0 flex items-baseline gap-1.5 text-left transition active:scale-[0.98]" title="프로젝트 이름 수정">
            <span className="min-w-0 truncate text-base font-extrabold text-fg tracking-[-0.4px]">{title}</span>
            <Pencil size={12} className="text-fg-faint shrink-0" />
          </button>
        ) : (
          <h2 className="flex-1 min-w-0 truncate text-base font-extrabold text-fg tracking-[-0.4px]">{title}</h2>
        )}
        {/* 전체 일정도 헤더로 — 하단 탭 네 자리(프로젝트·내 업무·대시보드·팀)는
            핸드오프 규격이라 다섯 번째를 끼우지 않는다. 설정과 같은 처리다. */}
        {/* 오른쪽 아이콘 넷은 **같은 36px 칸**에 앉힌다(사용자 지적 2026-09-03 — 버튼마다 패딩·flex-1이
            달라 간격이 들쭉날쭉했다). 칸이 크기를 정하니 안의 버튼 패딩은 상관없다. */}
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          {/* 다붓이 얼굴 — 아이콘 줄 맨 앞(옅은 파란 고리로 다른 아이콘과 가른다 · 목업 v12) */}
          <span className="w-9 h-9 flex items-center justify-center"><DaboutiFace active={activeMenu === 'wiki'} onClick={() => setActiveMenu('wiki')} /></span>
          <span className="w-9 h-9 flex items-center justify-center">
            <button
              onClick={() => setActiveMenu('schedule')} title="전체 일정"
              className={`w-9 h-9 flex items-center justify-center rounded-md transition active:scale-95 ${activeMenu === 'schedule' ? 'text-accent-text bg-accent-weak' : 'text-fg-muted'}`}
            ><CalendarDays size={19} strokeWidth={1.75} /></button>
          </span>
          <span className="w-9 h-9 flex items-center justify-center"><SearchBox onSearchSelect={onSearchSelect} variant="icon" /></span>
          {cloudMode && <span className="w-9 h-9 flex items-center justify-center"><NotificationBell onOpenTask={onOpenTask} onOpenLink={onOpenLink} /></span>}
          {/* 설정은 상단 헤더로 — 하단 탭 네 자리는 프로젝트·내 업무·대시보드·팀이 쓴다 */}
          <span className="w-9 h-9 flex items-center justify-center"><ProfileMenu onOpenProfile={onOpenProfile} onOpenMembers={onOpenMembers} /></span>
        </div>
      </div>
      {project && (
        <MobileProjectTabs
          projectsList={projectsList} activeMenu={activeMenu} setActiveMenu={setActiveMenu}
          onOpenProject={onOpenProject} allProjects={allForYear} cloudMode={cloudMode}
          year={year} setYear={setYear} years={years} yearCounts={yearCounts}
          frontIds={frontIds} orderIds={posBase.map(p => p.id)} frontStats={frontStats} freshIds={freshIds}
        />
      )}
    </div>
  );
});

// 놓을 곳은 "손가락이 있는 곳" 기준이다(dropCollision.js — 보드와 한 벌). 포인터가 어떤
// 탭에도 안 걸치면(탭 사이 여백) 기본 방식으로 되돌린다.

// 모바일 프로젝트 탭 한 개 — 끌 수도 있고(길게 누르기) 놓을 수도 있다.
// dnd-kit은 ref를 하나만 받으므로 두 훅의 ref를 손으로 합친다(보드 카드와 같은 방식).
// 'tab:' 접두사로 끌고 있는 것(active.id = 프로젝트 id)과 놓는 자리를 가른다.
// **보관된 탭은 끌 수도, 놓을 자리도 될 수 없다**(disabled) — 순서는 projects.position에
// 저장되는데 보관된 것은 그 순서에 끼지 않기로 되어 있다(saveTabOrder 주석).
// **앞 칸 탭(front)도 같다** — 그 자리는 활동이 정하므로 끌어도 position이 바뀌면 안 된다.
// 앞 칸 탭은 **놓을 자리로는 켜 둔다**(끌기만 막는다 · PITFALLS 12-g) — 뒤쪽 탭을 그 위로 가져왔을 때 넛지를 띄우려면
// dnd-kit이 over로 알려 줘야 한다. 놓아도 순서는 안 바뀐다(MobileProjectTabs.onDragEnd가 거른다).
// fresh — 지난 방문 이후 남이 움직였다(왼쪽 점) · onLongPress — 앞 칸 탭을 길게 눌렀다(넛지)
function MobileProjectTab({ project, active, archived = false, front = false, fresh = false, onSelect, onLongPress }) {
  const locked = archived || front;
  const nodeRef = useRef(null);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: project.id, disabled: locked });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `tab:${project.id}`, disabled: archived, data: { el: nodeRef } });
  // 앞 칸 탭 길게 누르기 — 끌기 센서와 같은 300ms · 8px(아래 MobileProjectTabs 주석). 눌러 둔 뒤 손을
  // 떼면 click이 한 번 오는데, 그건 여는 뜻이 아니라서 한 번 삼킨다.
  const hold = useRef(null);
  const held = useRef(false);
  const holdProps = front && onLongPress ? {
    onTouchStart: (e) => {
      const t = e.touches[0];
      held.current = false;
      clearTimeout(hold.current?.timer);
      hold.current = { x: t.clientX, y: t.clientY, timer: setTimeout(() => { held.current = true; onLongPress(nodeRef.current, project.id); }, 300) };
    },
    onTouchMove: (e) => {
      const s = hold.current; const t = e.touches[0];
      if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 8) { clearTimeout(s.timer); hold.current = null; }
    },
    onTouchEnd: () => { clearTimeout(hold.current?.timer); hold.current = null; },
    onTouchCancel: () => { clearTimeout(hold.current?.timer); hold.current = null; },
  } : {};
  useEffect(() => () => clearTimeout(hold.current?.timer), []);
  // **ref 콜백에 조건을 넣지 않는다** — 콜백 신원이 바뀌면 React가 ref를 떼었다 다시
  // 붙이는데, 끄는 도중이면 dnd-kit이 들고 있던 노드가 그 순간 사라진다.
  const setRefs = useCallback((el) => { nodeRef.current = el; setNodeRef(el); setDropRef(el); }, [setNodeRef, setDropRef]);
  // 활성 탭이 화면 밖이면 끌어온다 — 여기는 데스크톱과 달리 프로젝트를 전부 그려서
  // (가로 스크롤), 프로젝트가 늘면 지금 보고 있는 탭이 오른쪽 밖에 있어도 아무 표시가
  // 없었다. 활성 탭이 바뀔 때만 — 끄는 중에는 활성 탭이 바뀌지 않는다.
  useEffect(() => { if (active) nodeRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }, [active]);
  // 보관 탭에는 dnd 속성을 아예 얹지 않는다 — disabled면 dnd-kit이 `aria-disabled="true"`를
  // 붙이는데, 눌러서 열 수 있는 버튼을 보조기기에 "못 쓰는 버튼"으로 알리게 된다.
  const dragProps = locked ? {} : { ...attributes, ...listeners };
  return (
    <button
      ref={setRefs} {...dragProps} {...holdProps}
      data-front={front ? '' : undefined}
      onClick={() => { if (held.current) { held.current = false; return; } onSelect(project.id); }}
      className={`relative shrink-0 px-3 pt-2.5 pb-2 -mb-px text-[13px] font-semibold border-b-2 transition-colors whitespace-nowrap ${active ? 'text-fg border-fg' : archived ? 'text-fg-faint border-transparent' : 'text-fg-muted border-transparent'} ${isDragging ? 'opacity-40' : ''} ${isOver && !isDragging && !front ? 'bg-accent-weak rounded-t-md' : ''} ${front ? 'select-none [-webkit-touch-callout:none]' : ''}`}
    >
      {fresh && <FreshDot className="left-[4px]" />}
      {/* 보관 표시는 데스크톱 연도 폴더와 같다 — 흐린 글자 + Archive 아이콘.
          아이콘은 **글자 줄 안의 inline-block**이다(감싸는 inline-flex를 두지 않는다):
          이 줄은 items-end라 탭 높이가 곧 글자 자리라서, 줄 상자 높이를 바꾸는 순간
          보관 탭의 글자만 이웃보다 떠 보인다(§6-9-bu와 같은 결). */}
      {archived && <Archive size={12} className="inline-block align-[-2px] mr-1" />}
      {project.title}
      {/* 지금 이 프로젝트를 보고 있는 사람 — 데스크톱과 같은 이유로 얹기만 하고,
          같은 이유로 오른쪽 경계에 반쯤 걸친다(제목 끝 글자를 가리지 않게 —
          사용자 지적 2026-08-30). z-[1]은 뒤 형제 탭에 덮이지 않게. */}
      <ViewerFaces projectId={project.id} className="absolute top-1 -right-1 z-[1]" />
    </button>
  );
}

// 모바일 프로젝트 탭 줄 — 가로로 밀어 넘기고, **길게 눌러** 순서를 바꾼다.
// 데스크톱처럼 누르는 즉시 끌기로 두면 줄을 밀 수가 없다: 손이 닿는 자리가 곧 탭이라
// 스크롤과 드래그가 같은 제스처를 두고 싸운다. 그래서 TouchSensor의 delay로 가른다.
const MobileProjectTabs = React.memo(({
  projectsList, activeMenu, setActiveMenu, onOpenProject, allProjects, cloudMode,
  year, setYear, years, yearCounts, frontIds, orderIds, frontStats = null, freshIds = null,
}) => {
  const [dragId, setDragId] = useState(null);
  const [nudge, showNudge] = useFrontNudge();
  // 터치와 마우스는 센서를 분리한다(§6-12) — 하나로 합치면 모바일에서 드래그가 아예
  // 시작되지 않거나 스크롤과 싸운다. 터치는 **300ms**로 보드(200ms)보다 길게 잡는다:
  // 이 줄의 기본 동작이 가로로 미는 것이라, 짧으면 넘기려던 손이 탭을 집어 든다.
  // tolerance 8: 그 사이에 8px 넘게 움직이면 "미는 중"으로 보고 드래그를 접는다.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );
  const dragProject = dragId ? projectsList.find(p => p.id === dragId) : null;
  const onDragEnd = ({ active, over }) => {
    setDragId(null);
    if (!over) return;
    const targetId = String(over.id).replace(/^tab:/, '');
    // 순서를 매기는 목록은 **position 순 전체**(orderIds — 보관된 탭은 없다)다. 보관된 탭은
    // 줄 끝에 이어 세울 뿐 position에 끼지 않고(saveTabOrder 주석), 앞 칸 탭은 position 안의
    // 제자리를 지킨다(데스크톱 dropTab과 같은 이유). 둘 다 끌기·놓기가 막혀 있다(disabled).
    if (frontIds?.has(String(active.id)) || frontIds?.has(targetId)) return;
    const next = reorderIds(orderIds, String(active.id), targetId);
    if (next) saveTabOrder(next, allProjects, cloudMode);
  };
  return (
    <DndContext
      sensors={sensors} collisionDetection={dropCollision}
      // 자동 스크롤을 통째로 끈다 — 손가락이 줄 끝에 가면 줄이 옆으로 밀려서, 놓으려던
      // 탭이 손가락 밑에서 빠져나간다(§6-10에서 상태 칩에 실제로 그랬다). 화면 밖의
      // 탭으로 옮기려면 먼저 줄을 밀어 그 탭을 보이게 하면 된다.
      autoScroll={false}
      onDragStart={(e) => setDragId(String(e.active.id))}
      // 뒤쪽 탭을 앞 칸 위로 가져왔다 — 놓을 자리가 아니라고 말해 준다(앞 칸 넛지)
      onDragOver={({ over }) => {
        const target = over ? String(over.id).replace(/^tab:/, '') : '';
        if (target && frontIds?.has(target)) showNudge(over.data?.current?.el?.current, 'back');
      }}
      onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}
    >
      {/* x-scroll-lock: 가로로 밀 때 세로 스크롤이 같이 딸려가지 않게 (index.css) */}
      <div className="flex items-end gap-0 px-2 overflow-x-auto scrollbar-hide x-scroll-lock border-t border-line/70">
        {/* 연도는 미는 칸 **안**에 둔다 — 같은 종류가 이어지는 줄이고(§8), 밖으로
            빼면 좁은 화면에서 탭이 시작하는 자리가 그만큼 밀린다 */}
        <YearPicker year={year} years={years} yearCounts={yearCounts} onPick={setYear} compact />
        {projectsList.map((p, i) => (
          <React.Fragment key={p.id}>
            <MobileProjectTab project={p} active={activeMenu === p.id} archived={!!p.archived} front={!!frontIds?.has(p.id)}
              fresh={!!freshIds?.has(p.id)} onSelect={setActiveMenu}
              onLongPress={(el, pid) => showNudge(el, 'front', frontStats?.[pid]?.people || 0)} />
            {/* 앞 칸 뒤 세로선 — 마지막 앞 칸 탭 바로 뒤, 뒤에 탭이 더 있을 때만 */}
            {frontIds?.has(p.id) && i < projectsList.length - 1 && !frontIds.has(projectsList[i + 1].id) && (
              <span aria-hidden data-tab-divider className={tabDividerCls(!!nudge)} />
            )}
          </React.Fragment>
        ))}
        {/* 데스크톱과 같은 이유로 투명 2px을 깐다(§6의 항목 참고) */}
        <button onClick={onOpenProject} className="shrink-0 px-3 pt-2.5 pb-2 -mb-px border-b-2 border-transparent text-[13px] font-semibold text-fg-faint whitespace-nowrap">+ 프로젝트</button>
      </div>
      <FrontNudge nudge={nudge} />
      {/* 들어 올린 탭이 손가락을 따라온다. body 포털이 기본이다(§6-1) — 조상에 걸린
          transform이 fixed의 기준 박스가 되면 미리보기가 엉뚱한 자리에 뜬다. */}
      {createPortal(
        <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {dragProject ? (
            <span className="inline-flex items-center px-3 py-1.5 rounded-md bg-surface border border-line shadow-elevated text-[13px] font-semibold text-fg whitespace-nowrap">
              {dragProject.title}
            </span>
          ) : null}
        </DragOverlay>,
        document.body
      )}
    </DndContext>
  );
});

// 모바일 하단 탭바 — 프로젝트 / 내 업무 / 대시보드 / 팀 (핸드오프 규격).
// 설정은 상단 헤더로 올라갔다. 교회 축 목록(CHURCH_MENUS)은 이 파일 맨 위에 있다.
export const MobileTabBar = React.memo(({ activeMenu, setActiveMenu, onOpenProject }) => {
  // '프로젝트' 탭이 새로 골라 주는 것은 보관하지 않은 것 중 첫 번째.
  // 하지만 지금 보고 있는 것이 보관된 프로젝트여도 탭은 켜져 있어야 한다(전체로 판정).
  const projectsList = useStore(selectActiveProjectsList);
  const allProjects = useStore(selectProjectsList);
  const currentUser = useStore(selectCurrentUser);
  const myTasksCount = useStore(selectMyTasks).filter(isOpen).length;
  const isProject = allProjects.some(p => p.id === activeMenu);
  const [year] = useProjectYear();
  const frontStats = useTabFrontStats();
  // 마지막으로 본 프로젝트 — 아래 '업무' 탭의 lastWork와 같은 결(이번 세션 동안만 기억한다)
  const lastProject = useRef(null);
  useEffect(() => { if (isProject) lastProject.current = activeMenu; }, [activeMenu, isProject]);
  const myTeam = (currentUser.teams?.length ? currentUser.teams : [currentUser.team]).filter(Boolean)[0];
  // '프로젝트' 탭(2026-09-25 · tabRank.pickProjectToOpen): 마지막으로 본 것이 고른 해에 있으면 그것,
  // 아니면 **고른 해의 탭 순서 첫 프로젝트**(앞 칸 → position — 위 탭 줄과 같은 순서), 그 해가 비면
  // 가장 최근 해의 첫 것, 아무것도 없으면 새로 만들기. 예전에는 해를 안 보고 position 첫 것을 열어서
  // 작년 프로젝트가 앞이면 그걸 열고 연도 선택까지 작년으로 끌려갔다.
  const goProject = () => {
    if (isProject) return;
    const id = pickProjectToOpen({ active: projectsList, all: allProjects, year, lastId: lastProject.current, stats: frontStats, yearOf: projectYear });
    if (id) setActiveMenu(id);
    else onOpenProject();
  };
  // 소속이 없는 사람은 팀 보드로 갈 곳이 없으니 프로필 설정으로 안내한다
  const goTeam = () => { if (myTeam) setActiveMenu(`team:${myTeam}`); else showToast('설정에서 소속을 먼저 골라주세요'); };

  // ── 두 벌의 바 (docs/V2.md §3 A안 — 사용자가 목업으로 확정) ──────────────
  // 교회 생활(홈·예배·말씀·모임·업무)과 업무(홈·프로젝트·내 업무·대시보드·팀).
  // '업무'에 들어가면 바가 통째로 기존 네 칸(+홈)으로 바뀌어 손 습관이 남고,
  // 겹(상단 줄 수)은 늘지 않는다. '홈'으로 돌아온다.
  // 위키는 어느 층에도 속하지 않는다 — 들어오기 전 층을 그대로 둔다(다붓이 얼굴은 두 층 어디서나 누른다 · 0088)
  const lastLayer = useRef(true);
  const inChurch = activeMenu === 'wiki' ? lastLayer.current : CHURCH_MENUS.includes(activeMenu);
  useEffect(() => { if (activeMenu !== 'wiki') lastLayer.current = CHURCH_MENUS.includes(activeMenu); }, [activeMenu]);
  // 업무 모드에서 마지막으로 보던 화면 — '업무' 탭이 여기로 돌려보낸다
  const lastWork = useRef('dashboard');
  useEffect(() => { if (!inChurch && activeMenu !== 'wiki') lastWork.current = activeMenu; }, [activeMenu, inChurch]);

  // 두 벌이 **동시에 그려져 있다**(아래 nav) — 지금 쓰는 층이 아니면 초점도 안 받게
  // `live=false`를 준다. 안 그러면 탭 키가 안 보이는 다섯 개를 먼저 지난다.
  // 배지 원 색은 층이 정한다(`--tab-dot`) — 남색 위에서는 accent 원이 그대로 사라진다.
  const tab = (on, icon, label, onClick, badge, live = true) => (
    <button
      key={label} onClick={onClick} tabIndex={live ? 0 : -1}
      className={`relative flex-1 flex flex-col items-center gap-1 py-1 transition-colors ${on ? 'text-[color:var(--tab-on)]' : 'text-[color:var(--tab-off)]'}`}
    >
      <span className="relative">{icon}{badge > 0 && <span className="absolute -top-0.5 -right-1.5 w-1.5 h-1.5 rounded-full bg-[color:var(--tab-dot)]" />}</span>
      <span className="text-[10.5px] font-semibold" style={on ? { fontWeight: 'var(--tab-on-w, 600)' } : undefined}>{label}</span>
      {on && <span aria-hidden="true" className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-1 h-1 rounded-full bg-[color:var(--tab-mark,transparent)]" />}
    </button>
  );
  // 층 하나가 쓰는 자리 — 패딩이 nav가 아니라 **층마다** 있어야 겹친 두 층이 같은 자리에
  // 선다(업무 층은 absolute inset-0이라 nav의 패딩 안으로 들어가지 않는다).
  // 위 선도 층이 그린다 — nav가 그리면 남색이 찼을 때 그 위에 회색 실선이 남는다.
  const LAYER = 'flex pt-2 pb-[calc(0.875rem+env(safe-area-inset-bottom))] border-t';
  // 층마다 칸 다섯 — [켜졌나, 아이콘, 글자, 누르면, 배지]. 차례가 곧 바에 서는 순서다.
  const go = (menu) => () => setActiveMenu(menu);
  const churchTabs = [
    [activeMenu === 'home', Home, '홈', go('home'), 0],
    [activeMenu === 'worship', Church, '예배', go('worship'), 0],
    [activeMenu === 'word', BookOpen, '말씀', go('word'), 0],
    [activeMenu === 'groups', HeartHandshake, '모임', go('groups'), 0],
    [false, Briefcase, '업무', () => setActiveMenu(lastWork.current || 'dashboard'), myTasksCount],
  ];
  const workTabs = [
    [false, Home, '홈', go('home'), 0],
    [isProject, Hash, '프로젝트', goProject, 0],
    [activeMenu === 'myTasks', CheckSquare, '내 업무', go('myTasks'), myTasksCount],
    [activeMenu === 'dashboard', LayoutDashboard, '대시보드', go('dashboard'), 0],
    [activeMenu.startsWith('team:'), Users, '팀', goTeam, 0],
  ];
  const tabs = (rows, live) => rows.map(([on, Icon, label, onClick, badge]) => tab(on, <Icon size={20} />, label, onClick, badge, live));
  // 탭바의 **실제 높이**를 `--mobile-tab-bar-h`로 내보낸다. 이 바는 안 내용으로 높이가 정해져서
  // (pt-2 + 아이콘 + 글자 + pb + safe-area) 4.5rem 같은 상수와 몇 px 어긋난다 — 주보 편집의
  // 하단 저장 줄이 그 상수로 앉아 탭바 위에 **얇은 틈**이 남았다(사용자 지적 2026-09-08).
  // 위에 얹는 것(worshipDetail의 worship-edit-bar)은 이 변수를 bottom으로 쓴다.
  const navRef = useRef(null);
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--mobile-tab-bar-h', `${el.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--mobile-tab-bar-h'); };
  }, []);
  // ── 넘어온 것을 바가 말한다 (사용자 결정 2026-09-18 · 목업 넷 중 '딥 인디고 채움') ──
  // 두 벌을 **겹쳐 두고** 업무 층의 왼쪽 끝만 움직인다(`.tab-bar-work` · index.css에
  // 왜 그 한 값이 두 방향을 다 만드는지 적어 두었다). 그래서 여기 JSX는 조건부가
  // 아니라 **둘 다 그린다** — 글자가 바뀌는 순간이 색이 지나가는 자리와 맞으려면
  // 두 벌이 동시에 있어야 한다. `data-tab-bar`가 어느 층이 위인지를 정한다.
  return (
    <nav ref={navRef} data-tab-bar={inChurch ? 'church' : 'work'} className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-surface">
      <div aria-hidden={!inChurch} className={`tab-bar-base ${LAYER} border-line [--tab-on:var(--app-ink)] [--tab-off:var(--app-ink-muted)] [--tab-dot:var(--app-accent)]`}>
        {tabs(churchTabs, inChurch)}
      </div>
      {/* 업무 층 — **색과 위선은 index.css의 `.tab-bar-work`가 준다**(`--app-work-bar`).
          여기 클래스로 박으면 다크에서 따라가 버려서 흰 글자 대비가 무너진다.
          배지 원은 흰색이다(그 바탕에서 accent 원은 그대로 사라진다). 아래
          safe-area까지 같이 찬다 — 거기서 색이 끊기면 바가 떠 보인다. */}
      <div aria-hidden={inChurch} className={`tab-bar-work absolute inset-0 ${LAYER} [--tab-on:#fff] [--tab-off:rgb(255_255_255/0.85)] [--tab-dot:#fff] [--tab-on-w:700] [--tab-mark:#fff]`}>
        {tabs(workTabs, !inChurch)}
      </div>
    </nav>
  );
});

// 화면 이름 (모바일 상단 제목) — 뷰 안의 제목은 모바일에서 숨기고 여기 하나만 쓴다
const MENU_TITLES = {
  home: '홈',
  dashboard: '업무 대시보드',
  schedule: '전체 일정',
  members: '멤버 관리',
  worship: '예배',
  word: '말씀',
  groups: '모임',
  wiki: '위키',
};
function menuTitle(activeMenu, projectsMap, currentUser) {
  if (Object.prototype.hasOwnProperty.call(MENU_TITLES, activeMenu)) return MENU_TITLES[activeMenu];
  if (activeMenu === 'myTasks') return `${currentUser?.name || '내'}님의 업무`;
  if (activeMenu.startsWith('team:')) return `${activeMenu.split(':')[1]} 보드`;
  return projectsMap[activeMenu]?.title || '워크스페이스';
}
