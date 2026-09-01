import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { LayoutDashboard, CheckSquare, Search, Plus, X, Hash, ChevronDown, Settings, Undo2, Redo2, Sun, Moon, LogOut, Bell, BellRing, BellOff, Pencil, Users, Archive, CalendarDays, CalendarClock, Smartphone } from 'lucide-react';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin, rectIntersection,
} from '@dnd-kit/core';
import { store, useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsList, selectActiveProjectsList, selectArchivedProjectsList,
  selectProjectsMap, selectMyTasks, selectTasksList, selectMembers
} from '../store/selectors.js';
import { useAuth } from '../services/auth.jsx';
import { formatRelative, projectYear, reorderIds, viewersOf } from '../utils.js';
import { usePresenceViews, presenceMe } from '../services/presence.js';
import { useProjectYear, useYearOptions } from '../hooks/useProjectYear.js';
import { Avatar } from './Avatar.jsx';
import * as cloudSync from '../services/cloudSync.js';
import * as push from '../services/push.js';
import { notifLine, notifText, isSystemNotif } from '../services/notifyText.js';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { CONFIG } from '../config.js';
import logoLight from '../assets/logo-light.png';
import logoDark from '../assets/logo-dark.png';

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================
// 내비는 위쪽 두 줄로 나뉜다 — 1줄은 전역 메뉴(대시보드·내 업무),
// 2줄은 프로젝트 탭. 예전 좌측 사이드바가 두 가지 일을 겹쳐 하던 걸 분리한 것.
// 모바일은 같은 역할을 위(프로젝트 탭)/아래(전역 탭바)로 나눠 가진다.

// 활성 프로젝트는 언제나 탭에 보이게 — 6번째 프로젝트를 열었는데 탭에 아무것도
// 선택돼 있지 않으면 지금 어디 있는지 알 수 없다.
// max는 탭 줄 폭에서 잰 값이다(useTabFit) — 예전에는 고정 5라서 넓은 화면에서
// 자리가 남는데도 '더보기'로 밀어냈다.
function splitProjectTabs(projectsList, activeMenu, max) {
  const shown = projectsList.slice(0, max);
  const active = projectsList.find(p => p.id === activeMenu);
  if (active && !shown.some(p => p.id === active.id)) shown[max - 1] = active;
  const shownIds = new Set(shown.map(p => p.id));
  return { shown, rest: projectsList.filter(p => !shownIds.has(p.id)) };
}

// 탭 줄에 몇 개가 들어가는지 실제 폭으로 잰다. 보이지 않는 측정 줄(measureRef)에
// 전체 탭 + '더보기' + '+ 프로젝트'를 같은 클래스로 그려 두고, 줄 폭 안에서
// "탭 k개 + (남는 게 있으면) 더보기 + '+ 프로젝트'"가 들어가는 최대 k를 고른다.
// 글자 폭 추정(폰트 상수 곱하기)으로 하지 않는 이유: 제목 길이가 제각각이라 반드시 어긋난다.
function useTabFit(tabRowRef, measureRef, count, alwaysMore) {
  const [fit, setFit] = useState(count);
  useLayoutEffect(() => {
    const row = tabRowRef.current;
    if (!row) return;
    const calc = () => {
      const meas = measureRef.current;
      if (!meas) return;
      const kids = [...meas.children];              // [탭들…, 더보기, + 프로젝트]
      const tabW = kids.slice(0, count).map(el => el.offsetWidth);
      const moreW = kids[count]?.offsetWidth || 0;
      const plusW = kids[count + 1]?.offsetWidth || 0;
      const yearW = kids[count + 2]?.offsetWidth || 0;   // 줄 맨 앞의 연도 버튼(항상 있다)
      const cs = getComputedStyle(row);
      // -16: 측정 span과 실제 button 렌더 사이의 미세 오차(서브픽셀·보더) 여유.
      // 딱 맞는 경계(800px에 670px 탭)에서 몇 px 넘쳐 '+ 프로젝트'가 잘렸다.
      // 탭 묶음의 ml-auto(오른쪽 몰기)는 남는 폭만 먹으므로 여기 계산과 무관하다.
      const avail = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - plusW - yearW - 16;
      let used = 0, k = 0;
      for (let i = 0; i < count; i++) {
        const needMore = alwaysMore || i < count - 1;  // 이 뒤에 더보기가 서야 하나
        if (used + tabW[i] + (needMore ? moreW : 0) > avail) break;
        used += tabW[i]; k = i + 1;
      }
      setFit(Math.max(1, k));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(row);
    // 폰트(SUIT)가 늦게 로드되면 탭 폭이 바뀌는데 줄 폭은 그대로라 ResizeObserver가
    // 못 잡는다 — 로드 완료 시 한 번 다시 잰다. window resize도 같이 듣는다
    // (헤드리스 에뮬레이션처럼 RO 콜백이 걸러지는 환경의 안전망).
    document.fonts?.ready?.then(calc);
    window.addEventListener('resize', calc);
    return () => { ro.disconnect(); window.removeEventListener('resize', calc); };
  }, [tabRowRef, measureRef, count, alwaysMore]);
  return fit;
}

// 탭 순서 저장 — 데스크톱 드래그(네이티브 DnD)와 모바일 길게 눌러 끌기(dnd-kit)가
// **같은 경로**를 쓴다(0021의 projects.position). 순서대로 1부터 다시 매긴다.
// 보관된 프로젝트는 탭에 서지 않으므로 목록에 없고, 그래서 position도 안 건드린다 —
// 보관함은 연도·created_at으로 묶는다. 값이 겹쳐도 정렬 2차 키가 가른다.
function saveTabOrder(orderedIds, allProjects, cloudMode) {
  const changed = [];
  orderedIds.forEach((pid, i) => {
    const p = allProjects.find(x => x.id === pid);
    if (p && (p.position ?? 0) !== i + 1) {
      store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: pid, position: i + 1 } });
      changed.push({ id: pid, position: i + 1 });
    }
  });
  if (cloudMode && changed.length) {
    cloudSync.projectOrderCloud(changed).catch(err => {
      console.error('[cloud] 탭 순서 저장 실패:', err);
      showToast('탭 순서를 저장하지 못했어요 · 잠시 후 다시 시도해주세요');
    });
  }
}

// 지금 여기를 보고 있는 사람 얼굴 — 프로젝트 탭과 보드 카드가 같이 쓴다.
// 판정은 `utils.viewersOf`(순수 함수, 본인 제외·사람당 한 번·최대 세 명)가 하고,
// 값은 presence 미니 스토어에서 온다. **아무 데도 남지 않는다**(§7의 '카드별 조회
// 추적'과 다른 점) — 그 사람이 나가면 얼굴도 같이 사라진다.
// 게스트 모드에서는 집합이 언제나 비어 있어 아무것도 그리지 않는다.
export function ViewerFaces({ projectId = null, cardId = null, className = '' }) {
  const views = usePresenceViews();
  const members = useStore(selectMembers);
  const people = useMemo(() => {
    const ids = viewersOf(views, { projectId, cardId }, { meId: presenceMe(), limit: 3 });
    if (!ids.length) return [];
    const byId = new Map(members.map(m => [m.id, m]));
    // 이름을 못 찾은 id는 버린다 — 얼굴도 이름도 없는 동그라미는 그릴 이유가 없다
    return ids.map(id => byId.get(id)).filter(Boolean);
  }, [views, members, projectId, cardId]);
  if (!people.length) return null;
  return (
    <span className={`inline-flex items-center ${className}`}
      title={`${people.map(p => p.name).join(' · ')} 님이 지금 보고 있어요`}>
      {people.map(m => (
        <Avatar key={m.id} name={m.name} url={m.avatarUrl}
          // leading-none: 이 크기(15px 원 · 8.5px 글자)에서는 기본 줄높이가 글자를
          // 위로 밀어 첫 글자가 원의 가운데에서 벗어나 보인다(사용자 지적 2026-08-30)
          className="flex w-[15px] h-[15px] text-[8.5px] leading-none -ml-[5px] first:ml-0 ring-[1.5px] ring-surface" />
      ))}
    </span>
  );
}

// 바깥 클릭 / Esc 로 닫히는 팝오버 (프로필 메뉴·프로젝트 더보기 공용)
function useDismiss(open, close, refs) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!refs.some(r => r.current?.contains(e.target))) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

// 프로필 아바타 → 내 정보·테마·로그아웃.
// 사이드바 하단에 있던 것들이 전부 여기로 들어왔다(모바일 '내 정보' 탭도 이걸 쓴다).
function ProfileMenu({ onOpenProfile, className = 'inline-flex shrink-0', children , onOpenMembers }) {
  const currentUser = useStore(selectCurrentUser);
  const { enabled, session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const { isAdmin } = useAuth();
  // popRef를 넘겨 실제 높이로 위치를 다시 잡는다 — 추정 높이로만 잡으면
  // 아래에서 위로 뜨는 모바일 탭바 메뉴가 탭바에서 한참 떨어져 떠 보였다
  const [pos, place] = useAnchoredPos(btnRef, open, 224, 200, 8, popRef);
  useDismiss(open, () => setOpen(false), [rootRef, popRef]);

  const item = 'w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-md text-[13px] text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors text-left';
  const go = (fn) => () => { setOpen(false); fn(); };

  return (
    <span ref={rootRef} className={className}>
      <span ref={btnRef} className="inline-flex flex-1">
        {/* 열기 전에 위치를 잡는다 — 첫 프레임이 {0,0}에 그려지면 좌상단에서 날아온다 */}
        <button onClick={() => { place(); setOpen(o => !o); }} className="inline-flex flex-1 justify-center transition active:scale-95" title="설정">
          {children || (
            /* 내 동그라미의 글자 배경만 대표 팀 색이다(남들은 이름 해시 색) — 사진이 있으면
               사진이 이기지만, 없을 때의 색은 그대로 둔다 */
            <Avatar name={currentUser.name} url={currentUser.avatarUrl}
              fallbackClass={CONFIG.TEAMS[currentUser.team] || undefined}
              className="flex w-7 h-7 text-xs" />
          )}
        </button>
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: 224 }}
          className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-1.5 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="px-2.5 py-2 mb-1 border-b border-line">
            <p className="text-[13px] font-semibold text-fg truncate">{currentUser.name}</p>
            <p className="text-[11px] text-fg-muted truncate">{(currentUser.teams?.length ? currentUser.teams : [currentUser.team]).filter(Boolean).join(' · ') || '팀 미지정'}</p>
          </div>
          <button className={item} onClick={go(onOpenProfile)}><Settings size={15} /> 설정</button>
          {/* 멤버는 관리자에게만. 하단 탭 네 자리는 핸드오프 규격이라 다섯 번째를
              끼우지 않는다 — 설정·전체 일정과 같은 처리다(§4.6). */}
          {isAdmin && enabled && session && onOpenMembers && (
            <button className={item} onClick={go(onOpenMembers)}><Users size={15} /> 멤버 관리</button>
          )}
          <ThemeMenuItem className={item} />
          {enabled && session && (
            <button className={`${item} hover:text-tag-red-fg`} onClick={go(signOut)}><LogOut size={15} /> 로그아웃</button>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}

// 프로필 메뉴 안의 테마 전환 줄 (아이콘 버튼 하나를 따로 두지 않는다)
function ThemeMenuItem({ className }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.setAttribute('data-seed-user-color-scheme', next);
    localStorage.setItem('theme', next);
    setTheme(next);
  };
  return (
    <button className={className} onClick={toggle}>
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      {theme === 'dark' ? '라이트 모드' : '다크 모드'}
    </button>
  );
}

// 데스크톱 상단 2줄 내비
export const TopNav = React.memo(({
  activeMenu, setActiveMenu, onSearchSelect, onOpenTask, onOpenProfile, onOpenProject, onOpenMembers,
  undo, redo, canUndo, canRedo, cloudMode,
}) => {
  // 탭에는 보관하지 않은 프로젝트만. 보관된 것은 아래 '더보기' 안 보관함에서 연도별로 본다
  // (활성 프로젝트가 보관돼 있으면 splitProjectTabs가 탭에 끌어올려 준다 — 지금 어디
  //  있는지 알 수 없게 되면 안 되므로 보관된 것을 열어 둔 경우도 탭에 보인다)
  const projectsList = useStore(selectActiveProjectsList);
  const archived = useStore(selectArchivedProjectsList);
  const allProjects = useStore(selectProjectsList);
  const activeProject = allProjects.find(p => p.id === activeMenu);
  // 연도 고르기 — 고른 해의 프로젝트만 탭에. 지금 보고 있는 것은 해가 달라도 남긴다
  // (splitProjectTabs가 끌어올리지만, 애초에 목록에 없으면 끌어올릴 것도 없다).
  const { year, setYear, years, yearCounts } = useTabYear(allProjects, activeMenu);
  const yearList = projectsList.filter(p => projectYear(p) === year);
  // 지금 보고 있는 것은 해가 달라도, 보관됐어도 탭에 남는다 — 어디 있는지 표시가
  // 화면에서 사라지면 안 된다. 갈래를 둘로 나눠 쓰면 **보관된 것을 다른 해에서
  // 열었을 때 같은 탭이 두 번 들어간다**(navsmoke가 잡았다) — 한 번만 더한다.
  const tabSource = activeProject && !yearList.some(p => p.id === activeMenu)
    ? [...yearList, activeProject] : yearList;
  // 보관된 것을 열어 두면 위 줄이 그걸 탭으로 끌어올린다 — 그때 보관함 목록에도 그대로
  // 두면 **같은 프로젝트가 탭과 더보기에 동시에** 보인다(실제로 그렇게 보였다).
  // 지금 보고 있는 것은 이미 탭에 있으니 목록에서 뺀다.
  const archivedForMore = archived.filter(p => p.id !== activeMenu);
  // 더보기의 연도 폴더에는 **모든 해**의 진행 중 프로젝트가 들어간다 — 연도로 거른
  // 탭에서 빠진 것들이 갈 곳이 여기뿐이다(rest에는 고른 해의 나머지만 있다).
  const otherYears = projectsList.filter(p => projectYear(p) !== year && p.id !== activeMenu);
  const myTasksCount = useStore(selectMyTasks).filter(t => t.status !== '완료').length;
  // 몇 개까지 탭으로 보일지는 화면 폭이 정한다(useTabFit). 보관함이 있으면 탭이 다
  // 들어가도 '더보기'는 남아야 하므로 그 폭까지 계산에 넣는다.
  const tabRowRef = useRef(null);
  const measureRef = useRef(null);
  const tabFit = useTabFit(tabRowRef, measureRef, tabSource.length, archivedForMore.length > 0 || otherYears.length > 0);
  const { shown, rest } = splitProjectTabs(tabSource, activeMenu, tabFit);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRootRef = useRef(null);
  const moreBtnRef = useRef(null);
  const morePopRef = useRef(null);
  const [morePos, placeMore] = useAnchoredPos(moreBtnRef, moreOpen, 224, 260);
  useDismiss(moreOpen, () => setMoreOpen(false), [moreRootRef, morePopRef]);

  // 탭 드래그로 순서 바꾸기(0021) — 네이티브 HTML5 DnD. dnd-kit sortable을 새로
  // 들이지 않는 이유: 데스크톱 탭 한 줄에는 draggable 속성이면 충분하다.
  // 모바일은 가로 스크롤과 부딪히지 않게 **길게 눌러** 시작한다(MobileTopBar) —
  // 끼워 넣는 규칙(utils.reorderIds)과 저장(saveTabOrder)은 양쪽이 같은 것을 쓴다.
  const [dragTabId, setDragTabId] = useState(null);
  const dropTab = (targetId) => {
    if (!dragTabId || dragTabId === targetId) return;
    const next = reorderIds(tabSource.map(p => p.id), dragTabId, targetId);
    if (next) saveTabOrder(next, allProjects, cloudMode);
  };

  const gnav = (menu, label, badge) => (
    <button
      onClick={() => setActiveMenu(menu)}
      className={`px-3 py-1.5 rounded-md text-[13.5px] font-semibold transition-colors whitespace-nowrap ${activeMenu === menu ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:text-fg hover:bg-surface-hover'}`}
    >
      {label}{badge > 0 && <span className="text-fg-faint font-medium"> · {badge}</span>}
    </button>
  );

  return (
    <div className="hidden md:block shrink-0 border-b border-line/70 z-20">
      <div className="flex items-center gap-5 px-6 h-[52px]">
        <button onClick={() => setActiveMenu('dashboard')} className="shrink-0 transition active:scale-95" title="홈(대시보드)으로">
          <img src={logoLight} alt="더다붓" className="h-7 w-auto dark:hidden" />
          <img src={logoDark} alt="더다붓" className="h-7 w-auto hidden dark:block" />
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {gnav('dashboard', '전체 대시보드')}
          {gnav('myTasks', '내 업무', myTasksCount)}
          {gnav('schedule', '전체 일정')}
        </div>
        <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
          {/* Undo / Redo — 클라우드 모드에선 다른 사람과 상태가 어긋나므로 숨김 */}
          {!cloudMode && (
            <div className="flex items-center rounded-md p-0.5 shrink-0">
              <button onClick={undo} disabled={!canUndo} className={`p-1.5 rounded text-fg-muted transition active:scale-95 ${canUndo ? 'hover:bg-surface-hover' : 'opacity-30 cursor-not-allowed'}`} title="실행 취소 (Ctrl+Z)"><Undo2 size={16} /></button>
              <button onClick={redo} disabled={!canRedo} className={`p-1.5 rounded text-fg-muted transition active:scale-95 ${canRedo ? 'hover:bg-surface-hover' : 'opacity-30 cursor-not-allowed'}`} title="다시 실행"><Redo2 size={16} /></button>
            </div>
          )}
          <SearchBox onSearchSelect={onSearchSelect} variant="inline" />
          {cloudMode && <NotificationBell onOpenTask={onOpenTask} />}
          <ProfileMenu onOpenProfile={onOpenProfile} onOpenMembers={onOpenMembers} />
        </div>
      </div>

      <div ref={tabRowRef} className="relative flex items-end px-6 border-t border-line/70 overflow-hidden">
        {/* 측정 전용 줄 — 화면 밖(invisible)에 전체 탭을 실제 클래스로 그려 폭을 잰다.
            aria-hidden + pointer-events-none: 보조기기·클릭에 잡히지 않는다. */}
        {/* w-max + shrink-0: absolute 컨테이너는 조상 폭에 맞춰 줄어들고(shrink-to-fit)
            그 안의 flex 항목도 같이 눌린다 — 눌린 폭을 재면 "다 들어간다"고 거짓말을 해서
            좁은 화면에서 탭이 줄지 않았다. 실제 폭(max-content)으로 잰다. */}
        {/* right-full: 왼쪽 바깥에 둔다 — left-0에 두면 이 줄의 폭(전체 탭 합)이 row의
            scrollWidth를 늘려서 "탭 줄이 넘쳤다"로 잘못 측정된다(왼쪽 넘침은 안 잡힌다) */}
        <div ref={measureRef} aria-hidden className="invisible absolute right-full top-0 w-max flex items-end pointer-events-none whitespace-nowrap">
          {tabSource.map(p => (
            <span key={p.id} className="shrink-0 inline-block px-3.5 pt-2.5 pb-2 text-[13px] font-semibold whitespace-nowrap max-w-[220px] truncate">{p.title}</span>
          ))}
          <span className="shrink-0 inline-flex items-center gap-1 px-3 pt-2.5 pb-2 text-[13px] font-semibold">더보기 <ChevronDown size={13} /></span>
          <span className="shrink-0 inline-block px-3 pt-2.5 pb-2 text-[13px] font-semibold whitespace-nowrap">+ 프로젝트</span>
          {/* 연도 버튼도 같은 줄을 쓴다 — 폭 계산에 안 넣으면 탭이 한 칸씩 넘친다.
              **맨 뒤**에 둔다: 앞에 끼우면 useTabFit의 kids 인덱스가 통째로 밀려
              탭 폭이 엉뚱하게 잡힌다(800px에서 8개가 다 들어간다고 나왔다). */}
          <span className="shrink-0 inline-flex items-center gap-1 pr-3 pt-2.5 pb-2 text-[13px] font-semibold tabular-nums">{year} <ChevronDown size={13} /></span>
        </div>
        <YearPicker year={year} years={years} yearCounts={yearCounts} onPick={setYear} />
        {shown.map((p, i) => (
          <button
            key={p.id} onClick={() => setActiveMenu(p.id)}
            draggable
            onDragStart={() => setDragTabId(p.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); dropTab(p.id); }}
            onDragEnd={() => setDragTabId(null)}
            // truncate(overflow-hidden)를 버튼에 직접 주면 **경계에 걸친 얼굴이 잘린다**
            // (실제로 반이 잘려 나갔다 — 2026-08-30). 말줄임은 안쪽 span이 맡고
            // 버튼은 클리핑하지 않는다.
            // 첫 탭의 ml-auto: 탭 묶음(탭·더보기·+ 프로젝트)을 통째로 오른쪽 끝에
            // 몰고, 남는 폭은 연도와 탭 사이에 둔다(사용자 요청 2026-09-01 — "더보기와
            // 프로젝트도 그만큼"). 줄이 꽉 차면 남는 폭이 0이라 지금까지와 같다.
            // 탭이 하나도 없으면 이 자리가 없으므로 더보기·+ 프로젝트가 이어받는다.
            className={`relative px-3.5 pt-2.5 pb-2 -mb-px text-[13px] font-semibold border-b-2 transition-colors whitespace-nowrap max-w-[220px] ${i === 0 ? 'ml-auto' : ''} ${activeMenu === p.id ? 'text-fg border-fg' : 'text-fg-muted border-transparent hover:text-fg'} ${dragTabId === p.id ? 'opacity-50' : ''}`}
          >
            <span className="block max-w-full truncate">{p.title}</span>
            {/* 지금 이 프로젝트를 보고 있는 사람. **자리를 차지하지 않게 얹는다** —
                얼굴이 붙고 떨어질 때마다 탭 폭이 바뀌면 useTabFit이 다시 재서 탭이
                옆으로 튀고, 누르려던 탭이 손가락 밑에서 빠져나간다.
                오른쪽 경계에 **살짝 걸쳐** 세운다(-right-1) — 탭 안쪽(right-1)에
                두면 제목 끝 글자를 가리고(사용자 지적 2026-08-30), 더 빼면(-right-2.5)
                탭에서 떨어져 남의 것처럼 보인다(같은 날 두 번째 지적). 탭 사이에는
                좌우 패딩 28px의 빈 땅이 있어 얼굴 한둘은 글자에 닿지 않는다.
                z-[1]: 뒤 형제 탭이 나중에 그려져 걸친 부분을 덮는 것을 막는다. */}
            <ViewerFaces projectId={p.id} className="absolute top-1 -right-1 z-[1]" />
          </button>
        ))}
        {(rest.length > 0 || archivedForMore.length > 0 || otherYears.length > 0) && (
          <span ref={moreRootRef} className={`inline-flex ${shown.length === 0 ? 'ml-auto' : ''}`}>
            <span ref={moreBtnRef} className="inline-flex">
              <button onClick={() => { placeMore(); setMoreOpen(o => !o); }} className="px-3 pt-2.5 pb-2 -mb-px inline-flex items-center gap-1 text-[13px] font-semibold text-fg-muted hover:text-fg border-b-2 border-transparent transition-colors">
                더보기 <ChevronDown size={13} />
              </button>
            </span>
            {moreOpen && createPortal(
              <div ref={morePopRef} style={{ position: 'fixed', left: morePos.left, top: morePos.top, width: 224 }} className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-1.5 max-h-72 overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
                <YearFolders active={[...rest, ...otherYears]} archived={archivedForMore} onPick={(id) => { setMoreOpen(false); setActiveMenu(id); }} />
              </div>,
              document.body
            )}
          </span>
        )}
        {/* border-b-2 border-transparent: 줄이 items-end라 **아래 테두리 두께만큼**
            글자 자리가 정해진다. 탭·더보기·연도는 전부 투명 2px을 깔고 있는데 이 버튼만
            없어서 글자가 2px 내려앉아 보였다(사용자 지적 2026-08-29). 폭에는 영향이
            없어서 useTabFit의 측정 줄은 그대로 둔다. */}
        {/* 오른쪽 몰기(ml-auto)는 묶음의 **첫 항목 하나**만 가진다 — 둘 이상이 가지면
            남는 폭이 auto 마진들에 나눠져 묶음이 갈라진다. 보통은 첫 탭이,
            탭이 없으면 더보기가, 그마저 없으면 이 버튼이 이어받는다. */}
        <button onClick={onOpenProject} className={`px-3 pt-2.5 pb-2 -mb-px border-b-2 border-transparent text-[13px] font-semibold text-fg-faint hover:text-fg-muted transition-colors whitespace-nowrap ${shown.length === 0 && !(rest.length > 0 || archivedForMore.length > 0 || otherYears.length > 0) ? 'ml-auto' : ''}`}>+ 프로젝트</button>
      </div>
    </div>
  );
});

// ── 연도 고르기 ────────────────────────────────────────────────────────────
// 프로젝트 탭 줄 앞의 `2026 ▾`. 고른 해의 프로젝트만 탭에 선다 — 해가 쌓일수록
// 탭 줄이 넘쳐서 '더보기'로 밀려나기만 하던 문제까지 같이 푼다.
// 연도는 projects.created_at에서 파생한다(연도 컬럼을 따로 두지 않는다 — 0014의 판단).
// 연도 규칙(값이 없는 옛 행은 만든 해로)은 **utils.projectYear 하나**다 — 대시보드의
// '프로젝트 진행'도 같은 값을 봐야 해서 옮겼다. 규칙이 두 벌이면 탭에는 있는
// 프로젝트가 대시보드에는 없는 해가 생긴다.
// 폴백이 원래 규칙이었고, 해가 바뀌기 전에 미리 만드는 프로젝트를 못 견뎌서 컬럼을
// 두게 됐다(2027 프로젝트 둘이 2026 폴더에 들어가 있었다 — 사용자 지적).

// 고른 해는 사람마다 다르고 서버가 알 필요가 없다 → useProjectYear(localStorage).
// 다른 해의 프로젝트를 열면(검색·알림·링크로) 그 해로 따라간다 — 안 그러면 지금
// 보고 있는 프로젝트가 탭 줄 어디에도 없어서 "어디 있는지" 표시가 사라진다.
function useTabYear(allProjects, activeMenu) {
  const { years, yearCounts } = useYearOptions(allProjects);
  const [year, pick] = useProjectYear();
  const activeYear = allProjects.find(p => p.id === activeMenu) ? projectYear(allProjects.find(p => p.id === activeMenu)) : null;
  useEffect(() => { if (activeYear && activeYear !== year) pick(activeYear); }, [activeYear]); // eslint-disable-line react-hooks/exhaustive-deps
  // 고른 해가 목록에 없으면(그 해 프로젝트를 다 지웠다) 가장 최근 해로 떨어진다.
  // **고쳐서 스토어에 되돌려 놓는다** — 예전에는 여기서만 갈아 끼웠는데, 지금은
  // 대시보드가 같은 스토어를 보므로 되돌리지 않으면 탭과 대시보드가 다른 해를 본다.
  // years에는 올해가 언제나 들어 있어서(위 set.add) 이 되돌림은 한 번에 멎는다.
  useEffect(() => { if (!years.includes(year)) pick(years[0]); }, [years, year, pick]);
  const safeYear = years.includes(year) ? year : years[0];
  return { year: safeYear, setYear: pick, years, yearCounts };
}

// 연도 버튼 + 목록. 팝오버는 body 포털이 기본이다(§6-1).
export function YearPicker({ year, years, yearCounts = {}, onPick, compact = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open, 112, 40 + years.length * 34);
  useDismiss(open, () => setOpen(false), [rootRef, popRef]);
  return (
    <span ref={rootRef} className="inline-flex shrink-0">
      <span ref={btnRef} className="inline-flex">
        <button onClick={() => { place(); setOpen(o => !o); }} title="연도 고르기"
          className={`inline-flex items-center gap-1 -mb-px border-b-2 border-transparent text-[13px] font-semibold text-fg-muted hover:text-fg transition-colors tabular-nums ${compact ? 'px-2 pt-2.5 pb-2' : 'pl-0 pr-3 pt-2.5 pb-2'}`}>
          {year} <ChevronDown size={13} />
        </button>
      </span>
      {open && createPortal(
        <div ref={popRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: 112 }}
          className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-1.5 max-h-72 overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
          {years.map(y => (
            <button key={y} onClick={() => { setOpen(false); onPick(y); }}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[13px] text-left tabular-nums transition-colors hover:bg-surface-hover ${y === year ? 'text-fg font-bold' : 'text-fg-muted'}`}>
              <span className="flex-1">{y}년</span>
              {/* 그 해 프로젝트 수 — 빈 해를 열어보고서야 아는 일이 없게 */}
              {yearCounts[y] > 0 && <span className="text-[10.5px] text-fg-faint">{yearCounts[y]}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}

// 더보기 = 연도 폴더 (사용자 결정 2026-08-24). 탭에 못 들어간 진행 중 프로젝트와
// 보관된 프로젝트를 같은 연도 아래에서 함께 본다 — 예전에는 '보관'해야만 연도로
// 묶여서, 지난 해 프로젝트를 찾으려면 먼저 보관부터 해야 했다.
// 연도는 projects.created_at에서 파생한다(연도 컬럼을 따로 두지 않는다).
// 보관된 것은 Archive 아이콘 + 흐린 글자로 가른다. 보관 해제는 열어서 이름 수정 창에서.
function YearFolders({ active, archived, onPick }) {
  const yearOf = (p) => projectYear(p) || '연도 모름';
  const byYear = new Map();
  const put = (p, isArchived) => {
    const y = yearOf(p);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push({ p, isArchived });
  };
  active.forEach(p => put(p, false));
  archived.forEach(p => put(p, true));
  // 최신 연도 먼저, '연도 모름'은 맨 뒤(글자라 숫자보다 크게 정렬되는 것을 손으로 뺀다)
  const years = [...byYear.keys()].filter(y => y !== '연도 모름').sort((a, b) => b.localeCompare(a));
  if (byYear.has('연도 모름')) years.push('연도 모름');
  return (
    <>
      {years.map(year => (
        <div key={year}>
          <p className="px-2.5 pt-2 pb-0.5 text-[10px] font-bold text-fg-faint tabular-nums first:pt-1">{year}</p>
          {byYear.get(year).map(({ p, isArchived }) => (
            <button key={p.id} onClick={() => onPick(p.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[13px] transition-colors text-left ${isArchived ? 'text-fg-faint hover:text-fg-muted' : 'text-fg-muted hover:text-fg'} hover:bg-surface-hover`}>
              {isArchived
                ? <Archive size={13} className="shrink-0" />
                : <Hash size={14} className="shrink-0 text-fg-faint" />}
              <span className="truncate">{p.title}</span>
              {isArchived && <span className="ml-auto shrink-0 text-[10px] text-fg-faint">보관됨</span>}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

// 모바일 상단: 현재 화면 이름 + 검색·알림, 그 아래 프로젝트 탭(가로 스크롤)
export const MobileTopBar = React.memo(({ activeMenu, setActiveMenu, onSearchSelect, onOpenTask, onOpenProject, onRenameProject, onOpenProfile, onOpenMembers, cloudMode }) => {
  // 보관된 프로젝트는 탭 줄에서 빠진다. 다만 보관된 것을 열어 둔 상태라면 그 탭은
  // 보여야 한다 — 안 그러면 지금 어디 있는지 표시가 아무 데도 없다.
  const activeList = useStore(selectActiveProjectsList);
  const projectsMap = useStore(selectProjectsMap);
  const current = projectsMap[activeMenu];
  const allForYear = useStore(selectProjectsList);
  const { year, setYear, years, yearCounts } = useTabYear(allForYear, activeMenu);
  const yearList = activeList.filter(p => projectYear(p) === year);
  const base = current && !current.archived && !yearList.some(p => p.id === activeMenu) ? [...yearList, current] : yearList;
  const projectsList = current?.archived ? [...base, current] : base;
  const currentUser = useStore(selectCurrentUser);
  // 프로젝트 탭 줄은 프로젝트를 보고 있을 때만 — 내 업무·대시보드에서는 쓸 일이 없고
  // 좁은 화면에서 한 줄이 그대로 낭비된다(다른 프로젝트로는 하단 '프로젝트' 탭으로 간다)
  const project = projectsMap[activeMenu] || null;
  const title = menuTitle(activeMenu, projectsMap, currentUser);
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
        <button
          onClick={() => setActiveMenu('schedule')} title="전체 일정"
          className={`p-2 rounded-md transition active:scale-95 shrink-0 ${activeMenu === 'schedule' ? 'text-accent-text bg-accent-weak' : 'text-fg-muted'}`}
        ><CalendarDays size={19} strokeWidth={1.75} /></button>
        <SearchBox onSearchSelect={onSearchSelect} variant="icon" />
        {cloudMode && <NotificationBell onOpenTask={onOpenTask} />}
        {/* 설정은 상단 헤더로 — 하단 탭 네 자리는 프로젝트·내 업무·대시보드·팀이 쓴다 */}
        <ProfileMenu onOpenProfile={onOpenProfile} onOpenMembers={onOpenMembers} />
      </div>
      {project && (
        <MobileProjectTabs
          projectsList={projectsList} activeMenu={activeMenu} setActiveMenu={setActiveMenu}
          onOpenProject={onOpenProject} allProjects={allForYear} cloudMode={cloudMode}
          year={year} setYear={setYear} years={years} yearCounts={yearCounts}
        />
      )}
    </div>
  );
});

// 놓을 곳은 "손가락이 있는 곳" 기준이다. 포인터가 어떤 탭에도 안 걸치면(탭 사이 여백)
// 기본 방식으로 되돌린다 — 그러지 않으면 끌던 것이 조용히 제자리로 돌아간다.
const tabCollision = (args) => {
  const hit = pointerWithin(args);
  return hit.length ? hit : rectIntersection(args);
};

// 모바일 프로젝트 탭 한 개 — 끌 수도 있고(길게 누르기) 놓을 수도 있다.
// dnd-kit은 ref를 하나만 받으므로 두 훅의 ref를 손으로 합친다(보드 카드와 같은 방식).
// 'tab:' 접두사로 끌고 있는 것(active.id = 프로젝트 id)과 놓는 자리를 가른다.
function MobileProjectTab({ project, active, onSelect }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: project.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `tab:${project.id}` });
  const nodeRef = useRef(null);
  // **ref 콜백에 조건을 넣지 않는다** — 콜백 신원이 바뀌면 React가 ref를 떼었다 다시
  // 붙이는데, 끄는 도중이면 dnd-kit이 들고 있던 노드가 그 순간 사라진다.
  const setRefs = useCallback((el) => { nodeRef.current = el; setNodeRef(el); setDropRef(el); }, [setNodeRef, setDropRef]);
  // 활성 탭이 화면 밖이면 끌어온다 — 여기는 데스크톱과 달리 프로젝트를 전부 그려서
  // (가로 스크롤), 프로젝트가 늘면 지금 보고 있는 탭이 오른쪽 밖에 있어도 아무 표시가
  // 없었다. 활성 탭이 바뀔 때만 — 끄는 중에는 활성 탭이 바뀌지 않는다.
  useEffect(() => { if (active) nodeRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }, [active]);
  return (
    <button
      ref={setRefs} {...attributes} {...listeners}
      onClick={() => onSelect(project.id)}
      className={`relative shrink-0 px-3 pt-2.5 pb-2 -mb-px text-[13px] font-semibold border-b-2 transition-colors whitespace-nowrap ${active ? 'text-fg border-fg' : 'text-fg-muted border-transparent'} ${isDragging ? 'opacity-40' : ''} ${isOver && !isDragging ? 'bg-accent-weak rounded-t-md' : ''}`}
    >
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
  year, setYear, years, yearCounts,
}) => {
  const [dragId, setDragId] = useState(null);
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
    const next = reorderIds(projectsList.map(p => p.id), String(active.id), targetId);
    if (next) saveTabOrder(next, allProjects, cloudMode);
  };
  return (
    <DndContext
      sensors={sensors} collisionDetection={tabCollision}
      // 자동 스크롤을 통째로 끈다 — 손가락이 줄 끝에 가면 줄이 옆으로 밀려서, 놓으려던
      // 탭이 손가락 밑에서 빠져나간다(§6-10에서 상태 칩에 실제로 그랬다). 화면 밖의
      // 탭으로 옮기려면 먼저 줄을 밀어 그 탭을 보이게 하면 된다.
      autoScroll={false}
      onDragStart={(e) => setDragId(String(e.active.id))}
      onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}
    >
      {/* x-scroll-lock: 가로로 밀 때 세로 스크롤이 같이 딸려가지 않게 (index.css) */}
      <div className="flex items-end gap-0 px-2 overflow-x-auto scrollbar-hide x-scroll-lock border-t border-line/70">
        {/* 연도는 미는 칸 **안**에 둔다 — 같은 종류가 이어지는 줄이고(§8), 밖으로
            빼면 좁은 화면에서 탭이 시작하는 자리가 그만큼 밀린다 */}
        <YearPicker year={year} years={years} yearCounts={yearCounts} onPick={setYear} compact />
        {projectsList.map(p => (
          <MobileProjectTab key={p.id} project={p} active={activeMenu === p.id} onSelect={setActiveMenu} />
        ))}
        {/* 데스크톱과 같은 이유로 투명 2px을 깐다(§6의 항목 참고) */}
        <button onClick={onOpenProject} className="shrink-0 px-3 pt-2.5 pb-2 -mb-px border-b-2 border-transparent text-[13px] font-semibold text-fg-faint whitespace-nowrap">+ 프로젝트</button>
      </div>
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
// 설정은 상단 헤더로 올라갔다.
export const MobileTabBar = React.memo(({ activeMenu, setActiveMenu, onOpenProject }) => {
  // '프로젝트' 탭이 새로 골라 주는 것은 보관하지 않은 것 중 첫 번째.
  // 하지만 지금 보고 있는 것이 보관된 프로젝트여도 탭은 켜져 있어야 한다(전체로 판정).
  const projectsList = useStore(selectActiveProjectsList);
  const allProjects = useStore(selectProjectsList);
  const currentUser = useStore(selectCurrentUser);
  const myTasksCount = useStore(selectMyTasks).filter(t => t.status !== '완료').length;
  const isProject = allProjects.some(p => p.id === activeMenu);
  const myTeam = (currentUser.teams?.length ? currentUser.teams : [currentUser.team]).filter(Boolean)[0];
  // '프로젝트' 탭: 보던 프로젝트가 없으면 첫 프로젝트, 그것도 없으면 새로 만들기
  const goProject = () => {
    if (isProject) return;
    if (projectsList.length) setActiveMenu(projectsList[0].id);
    else onOpenProject();
  };
  // 팀이 없는 사람은 팀 보드로 갈 곳이 없으니 프로필 설정으로 안내한다
  const goTeam = () => { if (myTeam) setActiveMenu(`team:${myTeam}`); else showToast('설정에서 소속 팀을 먼저 정해주세요'); };
  const tab = (on, icon, label, onClick, badge) => (
    <button onClick={onClick} className={`flex-1 flex flex-col items-center gap-1 py-1 transition-colors ${on ? 'text-fg' : 'text-fg-faint'}`}>
      <span className="relative">{icon}{badge > 0 && <span className="absolute -top-0.5 -right-1.5 w-1.5 h-1.5 rounded-full bg-accent" />}</span>
      <span className="text-[10.5px] font-semibold">{label}</span>
    </button>
  );
  return (
    <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 flex bg-surface border-t border-line pt-2 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
      {tab(isProject, <Hash size={20} />, '프로젝트', goProject)}
      {tab(activeMenu === 'myTasks', <CheckSquare size={20} />, '내 업무', () => setActiveMenu('myTasks'), myTasksCount)}
      {tab(activeMenu === 'dashboard', <LayoutDashboard size={20} />, '대시보드', () => setActiveMenu('dashboard'))}
      {tab(activeMenu.startsWith('team:'), <Users size={20} />, '팀', goTeam)}
    </nav>
  );
});

// 화면 이름 (모바일 상단 제목) — 뷰 안의 제목은 모바일에서 숨기고 여기 하나만 쓴다
function menuTitle(activeMenu, projectsMap, currentUser) {
  if (activeMenu === 'dashboard') return '전체 대시보드';
  if (activeMenu === 'myTasks') return `${currentUser?.name || '내'}님의 업무`;
  if (activeMenu === 'schedule') return '전체 일정';
  if (activeMenu === 'members') return '멤버 관리';
  if (activeMenu.startsWith('team:')) return `${activeMenu.split(':')[1]} 보드`;
  return projectsMap[activeMenu]?.title || '워크스페이스';
}

// 매치 부분을 <mark>로 강조(첫 등장 위치 기준)
const highlight = (text, q) => {
  if (!text) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>{text.slice(0, idx)}<mark className="bg-tag-yellow text-tag-yellow-fg rounded-[2px] px-0.5">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>
  );
};

const SEARCH_LIMIT = 8; // 그룹당 최대 표시 수

// ── 검색창 안내 문구 (사용자 결정 2026-08-31) ────────────────────────────────
// 셋을 2초씩 돌린다. 첫 줄만으로는 **첨부 안 글자와 댓글까지 찾는다는 걸 아무도
// 모르는** 상태였다(그게 이 검색의 숨은 값이다). 셋을 한 줄에 이어 붙이면 320px
// 칸에서 잘리므로 돌린다.
const SEARCH_HINTS = [
  '프로젝트나 업무를 검색해봐요!',
  '댓글이나 첨부 파일도 검색 가능해요',
  '무엇을 찾고 계신가요?',
];
const HINT_HOLD_MS = 2000;   // 떠 있는 시간
const HINT_FADE_MS = 700;    // 사라지고 나타나는 시간 — 천천히(사용자 결정 2026-08-31)

// 돌아가는 문구. **input의 placeholder 속성은 첫 줄로 고정**하고(스크린 리더와
// 검사가 그걸 본다) 눈에 보이는 글자는 겹쳐 놓은 span이 그린다 — placeholder
// 가상 요소는 브라우저마다 전환이 제각각이라 opacity를 믿을 수 없다.
// `on`이 false면(글자를 쳤거나 reduced-motion) 첫 줄에서 멈춘다.
function useRotatingHint(on) {
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!on) { setI(0); setVisible(true); return; }
    let t;
    const fadeOut = () => { setVisible(false); t = setTimeout(swap, HINT_FADE_MS); };
    const swap = () => { setI(n => (n + 1) % SEARCH_HINTS.length); setVisible(true); t = setTimeout(fadeOut, HINT_HOLD_MS); };
    t = setTimeout(fadeOut, HINT_HOLD_MS);
    return () => clearTimeout(t);
  }, [on]);
  return { text: SEARCH_HINTS[i], visible };
}

// 겹쳐 놓은 안내 글자. 부모가 relative여야 하고, 왼쪽 여백(아이콘 폭)은 부모가 정한다.
const SearchHint = ({ show, left, size }) => {
  // 움직임을 줄이라고 한 사람에게는 돌리지 않는다(§4.2) — 첫 줄만 가만히 보여준다
  const still = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const { text, visible } = useRotatingHint(show && !still);
  if (!show) return null;
  return (
    <span aria-hidden
      className={`pointer-events-none absolute top-1/2 -translate-y-1/2 right-3 truncate text-fg-faint transition-opacity ${size}`}
      style={{ left, opacity: visible ? 1 : 0, transitionDuration: `${HINT_FADE_MS}ms` }}>
      {text}
    </span>
  );
};

// 결과 계산 + 렌더 (검색 중일 때만 마운트 → store 구독·계산도 그때만 발생)
// useDeferredValue로 타이핑 입력과 무거운 결과 렌더를 분리해 렉 방지
function SearchResults({ query, onPick }) {
  const projectsList = useStore(selectProjectsList);
  const tasksList = useStore(selectTasksList);
  const projectsMap = useStore(selectProjectsMap);
  const deferred = useDeferredValue(query);

  const results = useMemo(() => {
    // 공백을 지우고 비교한다 — "버스 견적"이 "전세버스 견적서"를 못 찾던 것(§1.3)이
    // 대부분 띄어쓰기 차이였다. RAG 없이 잡히는 것부터 잡는다.
    const norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, '');
    const q = norm(deferred);
    if (q.length < 2) return null;
    const hit = (x) => norm(x).includes(q);
    const projectHits = projectsList.filter(p => hit(p.title));
    // 첨부 이름·댓글도 본다. 클라우드에서는 열어 본 카드만 채워져 있다(§6-20) —
    // 그래도 없는 것보다 낫고, 게스트·최근에 연 카드에서는 온전히 잡힌다.
    const taskHits = tasksList.filter(t =>
      hit(t.title) || hit(t.content) ||
      (t.assignees || []).some(hit) ||
      (t.teams || []).some(hit) ||
      // 첨부는 이름뿐 아니라 **안에 든 글자**도 본다(files.text_excerpt, 0030).
      // "야식 찬조"로 결산 엑셀이 잡힌다. 사진은 발췌가 없어 이름으로만 잡힌다.
      (t.attachments || []).some(a => (typeof a === 'string' ? hit(a) : (hit(a?.name) || hit(a?.text_excerpt)))) ||
      (t.comments || []).some(c => hit(c?.text))
    );
    return { projectHits, taskHits };
  }, [deferred, projectsList, tasksList]);

  if (!results) return null;
  const empty = results.projectHits.length === 0 && results.taskHits.length === 0;
  if (empty) return <p className="px-3 py-6 text-center text-xs text-fg-faint">검색 결과가 없어요</p>;

  const pShown = results.projectHits.slice(0, SEARCH_LIMIT);
  const tShown = results.taskHits.slice(0, SEARCH_LIMIT);
  const pMore = results.projectHits.length - pShown.length;
  const tMore = results.taskHits.length - tShown.length;
  const q = deferred.trim();

  return (
    <>
      {pShown.length > 0 && (
        <div className="mb-1">
          <p className="px-2 pt-1.5 pb-1 text-[10px] font-bold text-fg-faint uppercase tracking-wider">프로젝트</p>
          {pShown.map(p => (
            <button key={p.id} onClick={() => onPick('project', p)} className="w-full flex items-center gap-2 px-2 py-2.5 rounded-md text-left hover:bg-surface-hover transition-colors">
              <span className="w-6 h-6 rounded-md bg-tag-purple text-tag-purple-fg flex items-center justify-center shrink-0"><Hash size={13} strokeWidth={1.75} /></span>
              <span className="text-sm text-fg truncate min-w-0">{highlight(p.title, q)}</span>
              {/* 보관된 것도 검색에는 나온다(지운 게 아니다) — 대신 그렇다고 표시한다 */}
              {p.archived && <span className="shrink-0 text-[10px] text-fg-faint">보관</span>}
            </button>
          ))}
          {pMore > 0 && <p className="px-2 py-1 text-[10px] text-fg-faint">그 외 {pMore}건 더 있어요</p>}
        </div>
      )}
      {tShown.length > 0 && (
        <div>
          <p className="px-2 pt-1.5 pb-1 text-[10px] font-bold text-fg-faint uppercase tracking-wider">업무</p>
          {tShown.map(t => (
            <button key={t.id} onClick={() => onPick('task', t)} className="w-full flex items-center gap-2 px-2 py-2.5 rounded-md text-left hover:bg-surface-hover transition-colors">
              <span className="w-6 h-6 rounded-md bg-tag-green text-tag-green-fg flex items-center justify-center shrink-0"><CheckSquare size={13} strokeWidth={1.75} /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-fg truncate">{highlight(t.title, q)}</span>
                <span className="block text-[10px] text-fg-faint truncate">{projectsMap[t.projectId]?.title || '프로젝트 없음'}</span>
              </span>
            </button>
          ))}
          {tMore > 0 && <p className="px-2 py-1 text-[10px] text-fg-faint">그 외 {tMore}건 더 있어요</p>}
        </div>
      )}
    </>
  );
}

// 통합 검색 — 데스크톱 인라인 드롭다운 + 모바일 아이콘 트리거·전체폭 오버레이
// store 구독/결과 계산은 SearchResults(검색어 2자+ 일 때만 마운트)로 분리해 타이핑 렉 제거
function SearchBox({ onSearchSelect, variant = 'inline' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);        // 데스크톱 드롭다운
  const [mobileOpen, setMobileOpen] = useState(false); // 모바일 오버레이
  const rootRef = useRef(null);
  const active = query.trim().length >= 2;

  // 데스크톱: 바깥 클릭 / Escape 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const reset = () => setQuery('');
  const closeMobile = () => { setMobileOpen(false); reset(); };

  // 모바일 오버레이: Escape 닫기
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') { setMobileOpen(false); setQuery(''); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const pick = (kind, item) => { onSearchSelect(kind, item); setOpen(false); setMobileOpen(false); reset(); };

  // 아이콘 트리거 + 전체폭 오버레이 (모바일 상단바)
  if (variant === 'icon') {
    return (
      <>
        <button className="p-2 rounded-md text-fg-muted transition active:scale-95 shrink-0" onClick={() => setMobileOpen(true)} title="검색"><Search size={19} /></button>
        {/* 불투명 배경 — 모바일 GPU 비용 큰 blur 미사용 */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 animate-in fade-in duration-150" onClick={closeMobile}>
            <div className="absolute inset-x-0 top-0 bg-surface border-b border-line shadow-elevated p-3 animate-in slide-in-from-top-2 duration-150" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
                  <input
                    autoFocus type="text" value={query} onChange={e => setQuery(e.target.value)}
                    /* 속성은 첫 줄로 고정하고 보이는 글자는 SearchHint가 그린다 */
                    placeholder={SEARCH_HINTS[0]}
                    className="pl-9 pr-3 py-2 text-sm bg-surface border border-line rounded-xs focus:border-accent focus:ring-2 focus:ring-accent-weak outline-none w-full transition-all placeholder:text-transparent"
                  />
                  <SearchHint show={!query} left="2.25rem" size="text-sm" />
                </div>
                <button onClick={closeMobile} className="p-2 rounded-md hover:bg-surface-hover text-fg-muted transition active:scale-95 shrink-0"><X size={18} /></button>
              </div>
              {active && (
                <div className="mt-2 max-h-[70dvh] overflow-y-auto">
                  <SearchResults query={query} onPick={pick} />
                </div>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  // 데스크톱 인라인 검색창 + 드롭다운
  return (
    <div className="relative w-full max-w-[320px]" ref={rootRef}>
      <Search className="w-[15px] h-[15px] absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
      <input
        type="text" value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={SEARCH_HINTS[0]}
        className="pl-8 pr-3 h-8 text-[12.5px] bg-surface/60 border border-line rounded-sm focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent-weak outline-none w-full transition-all placeholder:text-transparent"
      />
      <SearchHint show={!query} left="2rem" size="text-[12.5px]" />
      {open && active && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full max-h-80 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1.5 animate-in fade-in zoom-in-95 duration-150">
          <SearchResults query={query} onPick={pick} />
        </div>
      )}
    </div>
  );
}

// ── @멘션 알림 (클라우드 모드 전용) ────────────────────────────────────────
// 알림은 전역 스토어에 넣지 않는다(워크스페이스 데이터와 수명·성격이 다름).
// 헤더 컴포넌트 로컬 state + realtime 구독으로 충분.
// 종류별 문구는 services/notifyText.js에 있다 — 웹 푸시(api/push.js)가 같은 문구를 쓴다.

// 안드로이드 설치 안내. **알림과는 별개다** — 안드로이드는 설치하지 않아도 브라우저
// 탭에서 푸시가 온다(iOS만 설치가 전제 조건이라 그쪽은 PushRow의 'needs-pwa' 줄이
// 다른 문구로 안내한다). 설치하고 아이콘으로 열면 display-mode가 standalone이 되어
// 이 줄은 저절로 사라진다 — 닫기 버튼도, 닫았다는 기록도 두지 않는 이유다.
function InstallRow() {
  if (!push.isAndroid() || push.isStandalone()) return null;
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 border-b border-line text-[10px] text-fg-muted">
      <Smartphone size={13} strokeWidth={1.75} className="shrink-0 mt-px" />
      <span>
        크롬 <b className="font-semibold text-fg">⋮ → 앱 설치</b>를 누르면 앱처럼 쓸 수 있어요<br />
        삼성 인터넷은 <b className="font-semibold text-fg">☰ → 현재 페이지 추가</b>
      </span>
    </div>
  );
}

// 알림 종 팝오버 안의 '알림 받기' 줄. 여기서 권한을 묻는다 — 앱을 처음 열 때 물으면
// 무슨 알림인지 모르는 상태에서 거부하기 쉽고, 한 번 거부되면 브라우저 설정에서
// 손으로 되돌려야 한다.
function PushRow() {
  const [state, setState] = useState('unavailable');
  const [busy, setBusy] = useState(false);

  useEffect(() => { let alive = true; push.getPushState().then(s => alive && setState(s)); return () => { alive = false; }; }, []);

  if (state === 'unavailable') return null;

  if (state === 'needs-pwa') {
    return (
      <div className="flex items-start gap-2 px-3 py-2.5 border-b border-line text-[10px] text-fg-muted">
        <Smartphone size={13} strokeWidth={1.75} className="shrink-0 mt-px" />
        <span>홈 화면에 추가하면 알림을 받을 수 있어요</span>
      </div>
    );
  }
  if (state === 'denied') {
    return (
      <div className="flex items-start gap-2 px-3 py-2.5 border-b border-line text-[10px] text-fg-muted">
        <BellOff size={13} strokeWidth={1.75} className="shrink-0 mt-px" />
        <span>브라우저 설정에서 이 사이트의 알림을 허용해 주세요</span>
      </div>
    );
  }

  const on = state === 'on';
  const toggle = async () => {
    setBusy(true);
    try {
      if (on) { await push.disablePush(); showToast('앱을 닫았을 때는 알림이 오지 않아요'); }
      else { await push.enablePush(); showToast('이제 앱을 닫아도 알림이 와요'); }
      setState(await push.getPushState());
    } catch (e) {
      console.error('[push] 설정 실패:', e);
      showToast(failText('알림 설정을 바꾸지 못했어요', e));
      setState(await push.getPushState());
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle} disabled={busy}
      className="w-full flex items-center gap-2 px-3 py-2.5 border-b border-line text-left hover:bg-surface-hover transition-colors disabled:opacity-60"
    >
      {on ? <BellRing size={13} strokeWidth={1.75} className="shrink-0 text-accent-text" />
          : <Bell size={13} strokeWidth={1.75} className="shrink-0 text-fg-muted" />}
      <span className="flex-1 min-w-0">
        <span className="block text-[11px] text-fg">{on ? '이 기기로 알림 받는 중' : '이 기기로 알림 받기'}</span>
        <span className="block text-[9px] text-fg-faint mt-0.5">{on ? '눌러서 끄기' : '앱을 닫아도 알림이 와요'}</span>
      </span>
    </button>
  );
}

function NotificationBell({ onOpenTask }) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open, 320, 240);
  const unread = items.filter(n => !n.read).length;

  // 앱 아이콘 뱃지. **아이폰 홈 화면 웹앱에서만 보인다** — 안드로이드 크롬은 이 API가
  // 아예 없고(대신 알림이 와 있으면 OS가 알아서 점을 붙인다), 데스크톱은 설치한 창에서만
  // 보인다. 지원하지 않는 곳에서 navigator.setAppBadge는 undefined라 호출 전에 본다.
  useEffect(() => {
    if (!navigator.setAppBadge) return;
    // 권한이 없거나 설치 상태가 아니면 거부될 수 있다 — 뱃지 하나 때문에 콘솔을 더럽히지 않는다.
    const p = unread > 0 ? navigator.setAppBadge(unread) : navigator.clearAppBadge();
    p?.catch(() => {});
  }, [unread]);

  // 초기 로드
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    cloudSync.listMyNotifications(30)
      .then(rows => { if (alive) setItems(rows || []); })
      .catch(e => console.error('[cloud] 알림 로드 실패:', e));
    return () => { alive = false; };
  }, [userId]);

  // 실시간: 본인 수신 알림 INSERT
  useEffect(() => {
    if (!userId) return;
    const unsub = cloudSync.subscribeMyNotifications(userId, (row) => {
      setItems(prev => (prev.some(n => n.id === row.id) ? prev : [row, ...prev].slice(0, 30)));
      showToast(notifLine(row.kind, row.actor_name));
    });
    return unsub;
  }, [userId]);

  // 바깥 클릭 / Esc 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const openItem = (n) => {
    setOpen(false);
    if (!n.read) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      cloudSync.markNotificationRead(n.id).catch(e => console.error('[cloud] 알림 읽음 처리 실패:', e));
    }
    if (!n.card_id) return;
    const task = store.getState().tasks.byId[n.card_id];
    if (task) onOpenTask?.(task);
    else showToast('업무를 찾을 수 없어요');
  };

  // 알림 1건 지우기. 확인은 묻지 않는다 — 잃는 것이 알림 한 줄뿐이고, 지우려고
  // 누르는 자리에 또 한 번 물으면 목록을 정리하는 일이 두 배로 는다.
  // 실패하면 되돌린다(토스트만 띄우고 화면에서 지워두면 DB와 어긋난 채로 남는다).
  const dismiss = (n) => {
    setItems(prev => prev.filter(x => x.id !== n.id));
    cloudSync.deleteNotification(n.id).catch(e => {
      console.error('[cloud] 알림 삭제 실패:', e);
      showToast('알림을 지우지 못했어요');
      setItems(prev => (prev.some(x => x.id === n.id) ? prev : [n, ...prev]
        .sort((a, b) => (a.read - b.read) || (new Date(b.created_at) - new Date(a.created_at)))));
    });
  };

  const readAll = () => {
    setItems(prev => prev.map(x => ({ ...x, read: true })));
    cloudSync.markAllNotificationsRead().catch(e => console.error('[cloud] 모두 읽음 실패:', e));
  };

  return (
    <span className="inline-flex shrink-0" ref={rootRef}>
      <span ref={btnRef} className="inline-flex">
        <button
          // 열기 전에 위치 확정 — 첫 프레임이 {0,0}에 그려지면 좌상단에서
          // 날아오는 것처럼 보인다(첫 오픈에서만 나던 증상)
          onClick={() => { place(); setOpen(o => !o); }}
          className="relative p-2 min-w-11 min-h-11 flex items-center justify-center rounded-md hover:bg-surface-hover text-fg-muted transition active:scale-95"
          title="알림"
        >
          <Bell size={18} strokeWidth={1.75} />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 bg-tag-red-fg text-white text-[9px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </span>
      {open && (
        <div
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: 320 }}
          className="z-[90] max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-line sticky top-0 bg-surface">
            <span className="text-xs font-bold text-fg">알림</span>
            {unread > 0 && (
              <button onClick={readAll} className="text-[10px] text-accent-text hover:bg-surface-hover rounded-md px-1.5 py-1 transition active:scale-95">모두 읽음</button>
            )}
          </div>
          <InstallRow />
          <PushRow />
          {items.length === 0 ? (
            <div className="text-center py-8 px-3">
              <span className="inline-flex w-8 h-8 rounded-full bg-tag-yellow text-tag-yellow-fg items-center justify-center mb-2"><Bell size={13} strokeWidth={1.75} /></span>
              <p className="text-xs text-fg-faint">새 알림이 없어요</p>
            </div>
          ) : (
            <div className="divide-y divide-line/60">
              {/* 줄 전체가 button이었는데 지우기 버튼이 그 안에 들어가야 해서 div로 바꿨다
                  (button 안의 button은 유효하지 않다). 여는 영역만 button으로 남긴다. */}
              {items.map(n => (
                <div
                  key={n.id}
                  className={`flex items-start gap-2.5 px-3 py-2.5 hover:bg-surface-hover transition-colors ${n.read ? '' : 'bg-accent-weak/40'}`}
                >
                  <button onClick={() => openItem(n)} className="flex-1 min-w-0 flex items-start gap-2.5 text-left">
                    {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 mt-2" />}
                    {/* 마감 알림은 사람이 만든 게 아니라 배치가 만든다 — 아바타 대신 시계 */}
                    {isSystemNotif(n.kind) ? (
                      <span className="w-6 h-6 rounded-full bg-tag-yellow text-tag-yellow-fg flex items-center justify-center shrink-0"><CalendarClock size={12} strokeWidth={1.75} /></span>
                    ) : (
                      <Avatar name={n.actor_name || ''} className="flex w-6 h-6 text-[10px]" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-[11px] text-fg-secondary leading-snug">
                        {isSystemNotif(n.kind)
                          ? notifLine(n.kind)
                          : <><span className="font-semibold text-fg">{n.actor_name}</span>님이 {notifText(n.kind)}</>}
                      </span>
                      {n.preview && <span className="block text-[10px] text-fg-muted truncate mt-0.5">{n.preview}</span>}
                      <span className="block text-[9px] text-fg-faint mt-0.5">{formatRelative(n.created_at)}</span>
                    </span>
                  </button>
                  {/* hover로 숨기지 않는다 — 터치 기기에는 hover가 없어서 이 기능이 아예
                      없는 것처럼 보인다(§7) */}
                  <button
                    onClick={() => dismiss(n)} title="이 알림 지우기" aria-label="이 알림 지우기"
                    className="shrink-0 -mr-1 p-1 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

