import React, { useState, useRef, useMemo } from 'react';
import { ChevronDown, Settings, Undo2, Redo2, Sun, Moon, LogOut, Pencil, Users } from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import { selectCurrentUser, selectMyTasks, selectMembers } from '../store/selectors.js';
import { useAuth } from '../services/auth.jsx';
import { reorderIds, viewersOf } from '../utils.js';
import { usePresenceViews, presenceMe } from '../services/presence.js';
import { userColor } from '../services/coedit/view.js';
import { isOpen } from '../services/taskCounts.js';
import { Avatar } from './Avatar.jsx';
import { DaboutiPill } from './dabooti.jsx';
import { CONFIG } from '../config.js';
// 바깥 클릭 / Esc 로 닫히는 팝오버(프로필 메뉴·프로젝트 더보기·연도·알림) 껍데기 한 벌
import { usePopover } from '../hooks/usePopover.js';
import {
  splitProjectTabs, TAB_DIVIDER, tabDividerCls, FreshDot, useFreshProjects, nudgeSeen, finePointer,
  useFrontNudge, FrontNudge, useTabFit, saveTabOrder, useYearTabs, YearPicker, YearFolders,
} from './navParts.jsx';
import { SearchBox } from './searchBox.jsx';
import { NotificationBell } from './notificationBell.jsx';
import logoLight from '../assets/logo-light.webp';
import logoDark from '../assets/logo-dark.webp';

// 다른 화면이 이 파일에서 들이던 부품 — 옮긴 뒤에도 그쪽 import 줄은 그대로 둔다
// (대시보드·모임·프로젝트 진행의 YearPicker · 성경 검색 칸의 SearchHint)
export { YearPicker } from './navParts.jsx';
export { SearchHint } from './searchBox.jsx';

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================
// 내비는 위쪽 두 줄로 나뉜다 — 1줄은 전역 메뉴(대시보드·내 업무),
// 2줄은 프로젝트 탭. 예전 좌측 사이드바가 두 가지 일을 겹쳐 하던 걸 분리한 것.
// 모바일은 같은 역할을 위(프로젝트 탭)/아래(전역 탭바)로 나눠 가진다.
//
// 이 파일이 맡는 것: 데스크톱 상단 TopNav · 프로필 메뉴(ProfileMenu — 폰 상단바도 쓴다) · 보고 있는 사람 얼굴
// (ViewerFaces — 보드 카드도 쓴다) · 교회 축 목록(CHURCH_MENUS). 나머지는 갈라 두었다(19차 묶음 D):
//   navParts.jsx          탭 줄 공용(고른 해의 탭 · 연도 · 더보기 폴더 · 폭 재기 · 순서 저장 · 앞 칸 넛지 · 점)
//   mobileNav.jsx         폰 상단바 · 프로젝트 탭 줄(길게 눌러 끌기) · 하단 바 두 층 · 화면 이름
//   searchBox.jsx         통합 검색(인라인 · 폰 전체 판) · 돌아가는 안내 문구 · 관련된 업무 내용
//   notificationBell.jsx  알림 종 · 알림 받기 줄 · 안드로이드 설치 줄

// 교회 생활 축의 화면들 — **차례가 곧 화면에 서는 순서**다(하단 바 · 데스크톱 첫 묶음).
// 세 곳이 이 목록을 본다: 하단 바의 모드 판정 · 데스크톱 탭 줄 접기 · App의 전환 방향
// (App.jsx가 이것을 CHURCH_ORDER로 가져다 쓴다). 예전에는 같은 배열이 세 벌이라 화면을
// 하나 늘리면 어느 하나가 조용히 낡았다.
export const CHURCH_MENUS = ['home', 'worship', 'word', 'groups'];

// 지금 여기를 보고 있는 사람 얼굴 — 프로젝트 탭과 보드 카드가 같이 쓴다.
// 판정은 `utils.viewersOf`(순수 함수, 본인 제외·사람당 한 번·최대 세 명)가 하고,
// 값은 presence 미니 스토어에서 온다. **아무 데도 남지 않는다**(§7의 '카드별 조회
// 추적'과 다른 점) — 그 사람이 나가면 얼굴도 같이 사라진다.
// 게스트 모드에서는 집합이 언제나 비어 있어 아무것도 그리지 않는다.
//
// **업무 카드에서는 '수정 중'을 가른다**(2026-09-30 · 사용자 요청 — 업무 창 안과 똑같이): 그 사람 색(userColor —
// 같이 쓰기 이름표와 같은 색) 1.5px 고리 + 오른쪽 아래 작은 연필 · 사진은 그대로. 고리 선 얼굴 곁은 덜 겹친다
// (업무 창 머리줄과 같은 까닭 — 5px 겹치면 고리가 이웃에 가린다). 프로젝트 탭은 가르지 않는다.
export function ViewerFaces({ projectId = null, cardId = null, className = '' }) {
  const views = usePresenceViews();
  const members = useStore(selectMembers);
  const people = useMemo(() => {
    const list = viewersOf(views, { projectId, cardId }, { meId: presenceMe(), limit: 3, entries: true });
    if (!list.length) return [];
    const byId = new Map(members.map(m => [m.id, m]));
    // 이름을 못 찾은 id는 버린다 — 얼굴도 이름도 없는 동그라미는 그릴 이유가 없다
    return list.map(e => ({ m: byId.get(e.id), editing: !!cardId && e.editing })).filter(p => p.m);
  }, [views, members, projectId, cardId]);
  if (!people.length) return null;
  const allEditing = people.every(p => p.editing);
  return (
    <span className={`inline-flex items-center ${className}`}
      title={`${people.map(p => p.editing ? `${p.m.name} · 수정 중` : p.m.name).join(', ')} 님이 지금 ${allEditing ? '수정하고' : '보고'} 있어요`}>
      {people.map(({ m, editing }, i) => {
        const tight = i > 0 && (editing || people[i - 1].editing);
        const color = editing ? userColor(m.id) : null;
        return (
          <span key={m.id} data-viewer-face={m.name} data-editing={editing ? '' : undefined}
            className={`relative inline-flex rounded-full shrink-0 ${i ? (tight ? '-ml-[2px]' : '-ml-[5px]') : ''}`}
            style={{ zIndex: 5 - i, boxShadow: editing ? `0 0 0 1.5px ${color}, 0 0 0 3px var(--app-surface)` : '0 0 0 1.5px var(--app-surface)' }}>
            {/* leading-none: 이 크기(15px 원 · 8.5px 글자)에서는 기본 줄높이가 글자를
                위로 밀어 첫 글자가 원의 가운데에서 벗어나 보인다(사용자 지적 2026-08-30) */}
            <Avatar name={m.name} url={m.avatarUrl} title=""
              className="flex w-[15px] h-[15px] text-[8.5px] leading-none" />
            {editing && (
              <span aria-hidden data-pencil=""
                className="absolute -right-[3px] -bottom-[3px] w-2 h-2 rounded-full inline-flex items-center justify-center"
                style={{ background: color, boxShadow: '0 0 0 1.2px var(--app-surface)' }}>
                <Pencil size={5} strokeWidth={3.5} color="#fff" />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

// 프로필 아바타 → 내 정보·테마·로그아웃.
// 사이드바 하단에 있던 것들이 전부 여기로 들어왔다(모바일 '내 정보' 탭도 이걸 쓴다).
export function ProfileMenu({ onOpenProfile, className = 'inline-flex shrink-0', children , onOpenMembers }) {
  const currentUser = useStore(selectCurrentUser);
  // 한 번만 부른다 — 같은 컨텍스트를 두 번 읽던 자리였다(값이 갈릴 수는 없지만 읽는 곳이
  // 둘이면 나중에 조건이 붙을 때 한쪽만 고쳐진다)
  const { enabled, session, signOut, isAdmin } = useAuth();
  // measure: 판의 실제 높이로 위치를 다시 잡는다 — 추정 높이로만 잡으면
  // 아래에서 위로 뜨는 모바일 탭바 메뉴가 탭바에서 한참 떨어져 떠 보였다
  const pop = usePopover(224, 200, { gap: 8, measure: true });

  const item = 'w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-md text-[13px] text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors text-left';
  const go = (fn) => () => { pop.close(); fn(); };

  return (
    <span ref={pop.rootRef} className={className}>
      <span ref={pop.btnRef} className="inline-flex flex-1">
        {/* 열기 전에 위치를 잡는다(pop.toggle) — 첫 프레임이 {0,0}에 그려지면 좌상단에서 날아온다 */}
        <button onClick={pop.toggle} className="inline-flex flex-1 justify-center transition active:scale-95" title="설정">
          {children || (
            /* 내 동그라미의 글자 배경만 대표 팀 색이다(남들은 이름 해시 색) — 사진이 있으면
               사진이 이기지만, 없을 때의 색은 그대로 둔다 */
            <Avatar name={currentUser.name} url={currentUser.avatarUrl}
              fallbackClass={CONFIG.TEAMS[currentUser.team] || undefined}
              className="flex w-7 h-7 text-xs" />
          )}
        </button>
      </span>
      {pop.panel('z-[90] bg-surface border border-line rounded-lg shadow-elevated p-1.5', <>
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
        </>)}
    </span>
  );
}

// 프로필 메뉴 안의 테마 전환 줄 (아이콘 버튼 하나를 따로 두지 않는다)
function ThemeMenuItem({ className }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    // 저장이 막힌 브라우저(사생활 보호 창·저장 공간 가득)에서 setItem이 던지면 토글째 죽었다 —
    // 그때는 이번 화면에서만 바뀐다.
    try { localStorage.setItem('theme', next); } catch { /* 기억만 못 한다 */ }
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
  activeMenu, setActiveMenu, onSearchSelect, onOpenTask, onOpenLink, onOpenProfile, onOpenProject, onOpenMembers,
  undo, redo, canUndo, canRedo, cloudMode,
}) => {
  // 탭에는 보관하지 않은 프로젝트만. 보관된 것은 아래 '더보기' 안 보관함에서 연도별로 본다
  // (활성 프로젝트가 보관돼 있으면 splitProjectTabs가 탭에 끌어올려 준다 — 지금 어디
  //  있는지 알 수 없게 되면 안 되므로 보관된 것을 열어 둔 경우도 탭에 보인다)
  // 연도 고르기 — 고른 해의 프로젝트만 탭에. 지금 보고 있는 것은 해가 달라도, 보관됐어도 남긴다.
  // 앞 칸 · 끌어올리기 · 그 해 보관함 계산은 폰 상단바와 한 벌이다(navParts.useYearTabs 머리말).
  // 더보기에는 **고른 해의 것만** 들어간다 — 보관된 프로젝트도 그 해 것만
  // (사용자 결정 2026-09-01, 2026-08-24의 "모든 해" 결정을 대체). 다른 해는
  // 연도 버튼으로 바꿔 보고, 검색·알림으로 열면 useTabYear가 그 해로 따라간다.
  const {
    allProjects, project: activeProject, year, setYear, years, yearCounts,
    posSource, tabSource, front, frontIds, frontStats, archivedForYear: archivedForMore,
  } = useYearTabs(activeMenu);
  const myTasksCount = useStore(selectMyTasks).filter(isOpen).length;
  // 몇 개까지 탭으로 보일지는 화면 폭이 정한다(useTabFit). 보관함이 있으면 탭이 다
  // 들어가도 '더보기'는 남아야 하므로 그 폭까지 계산에 넣는다.
  const tabRowRef = useRef(null);
  const measureRef = useRef(null);
  const tabFit = useTabFit(tabRowRef, measureRef, tabSource.length, archivedForMore.length > 0, front.length > 0);
  const { shown, rest } = splitProjectTabs(tabSource, activeMenu, tabFit);
  const showMore = rest.length > 0 || archivedForMore.length > 0;
  // 세로선은 **마지막 앞 칸 탭 바로 뒤**에 한 번 — 뒤에 무언가(뒤쪽 탭이나 더보기)가 설 때만.
  // 폭이 좁아 지금 보는 탭이 마지막 칸에 끌어올려지면(splitProjectTabs) 그 탭이 '뒤'라 선이 그 앞에 선다.
  const lastFrontIdx = shown.reduce((k, p, i) => (frontIds.has(p.id) ? i : k), -1);
  const dividerAfter = lastFrontIdx >= 0 && (lastFrontIdx < shown.length - 1 || showMore) ? lastFrontIdx : -1;
  const freshIds = useFreshProjects(activeMenu, !!activeProject);
  // 앞 칸 넛지 — 앞 칸 탭을 누른 채 6px 넘게 움직이면 '끌려는 것'으로 본다(앞 칸 탭은 draggable이 아니라
  // dragstart가 오지 않는다). 마우스만 — 터치 기기의 데스크톱 폭은 폰 줄(길게 누르기)과 같은 일을 하지 않는다.
  const [nudge, showNudge] = useFrontNudge();
  const press = useRef(null);
  const peopleOf = (pid) => frontStats?.[pid]?.people || 0;
  const frontProps = (p) => (!frontIds.has(p.id) ? {} : {
    onMouseEnter: (e) => { if (finePointer() && !nudgeSeen()) showNudge(e.currentTarget, 'front', peopleOf(p.id)); },
    onPointerDown: (e) => { if (e.pointerType === 'mouse' && e.button === 0) press.current = { x: e.clientX, y: e.clientY }; },
    onPointerMove: (e) => {
      const s = press.current;
      if (!s || Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
      press.current = null;
      showNudge(e.currentTarget, 'front', peopleOf(p.id));
    },
    onPointerUp: () => { press.current = null; },
    onPointerLeave: () => { press.current = null; },
  });
  // 프로젝트 탭 줄은 업무 축 화면에서만 — 교회 생활 화면(홈·예배·말씀·모임)에서는 접힌다
  const showProjectRow = !CHURCH_MENUS.includes(activeMenu) && activeMenu !== 'wiki';
  const more = usePopover(224, 260);

  // 탭 드래그로 순서 바꾸기(0021) — 네이티브 HTML5 DnD. dnd-kit sortable을 새로
  // 들이지 않는 이유: 데스크톱 탭 한 줄에는 draggable 속성이면 충분하다.
  // 모바일은 가로 스크롤과 부딪히지 않게 **길게 눌러** 시작한다(MobileTopBar) —
  // 끼워 넣는 규칙(utils.reorderIds)과 저장(saveTabOrder)은 양쪽이 같은 것을 쓴다.
  const [dragTabId, setDragTabId] = useState(null);
  // 앞 칸 탭은 끌 수도, 놓을 자리도 될 수 없다 — 그 자리는 활동이 정하지 position이 아니다.
  // 번호는 **position 순 전체**(posSource)로 매긴다: 앞 칸 것도 그 안의 제자리를 지켜야, 앞 칸에서
  // 내려올 때 원래 자리로 돌아간다(앞 칸을 빼고 다시 매기면 엉뚱한 자리에 선다).
  const dropTab = (targetId) => {
    if (!dragTabId || dragTabId === targetId || frontIds.has(dragTabId) || frontIds.has(targetId)) return;
    const next = reorderIds(posSource.map(p => p.id), dragTabId, targetId);
    if (next) saveTabOrder(next, allProjects, cloudMode);
  };

  // 교회 생활(홈·예배·말씀·모임) | 업무(대시보드·내 업무·일정) — 두 축을 구분선으로 가른다
  // (docs/V2.md §3 A안 데스크톱 그림). 차례가 곧 화면에 서는 순서다.
  const gnavGroups = [
    [['home', '홈'], ['worship', '예배'], ['word', '말씀'], ['groups', '모임']],
    [['dashboard', '업무 대시보드'], ['myTasks', '내 업무', myTasksCount], ['schedule', '전체 일정']],
  ];
  const gnav = (menu, label, badge) => (
    <button
      key={menu}
      onClick={() => setActiveMenu(menu)}
      className={`px-3 py-1.5 rounded-md text-[13.5px] font-semibold transition-colors whitespace-nowrap ${activeMenu === menu ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:text-fg hover:bg-surface-hover'}`}
    >
      {label}{badge > 0 && <span className="text-fg-faint font-medium"> · {badge}</span>}
    </button>
  );

  return (
    <div className="hidden md:block shrink-0 border-b border-line/70 z-20">
      <div className="flex items-center gap-5 px-6 h-[52px]">
        <button onClick={() => setActiveMenu('home')} className="shrink-0 transition active:scale-95" title="홈으로">
          <img src={logoLight} alt="더다붓" className="h-7 w-auto dark:hidden" />
          <img src={logoDark} alt="더다붓" className="h-7 w-auto hidden dark:block" />
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {gnavGroups.map((group, gi) => (
            <React.Fragment key={gi}>
              {gi > 0 && <span aria-hidden className="w-px h-4 bg-line mx-1.5 shrink-0" />}
              {group.map(([menu, label, badge]) => gnav(menu, label, badge))}
            </React.Fragment>
          ))}
        </div>
        <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
          {/* Undo / Redo — 클라우드 모드에선 다른 사람과 상태가 어긋나므로 숨김 */}
          {!cloudMode && (
            <div className="flex items-center rounded-md p-0.5 shrink-0">
              <button onClick={undo} disabled={!canUndo} className={`p-1.5 rounded text-fg-muted transition active:scale-95 ${canUndo ? 'hover:bg-surface-hover' : 'opacity-30 cursor-not-allowed'}`} title="실행 취소 (Ctrl+Z)"><Undo2 size={16} /></button>
              <button onClick={redo} disabled={!canRedo} className={`p-1.5 rounded text-fg-muted transition active:scale-95 ${canRedo ? 'hover:bg-surface-hover' : 'opacity-30 cursor-not-allowed'}`} title="다시 실행"><Redo2 size={16} /></button>
            </div>
          )}
          {/* 다붓이 — 두 묶음 밖, 찾기 바로 앞(사용자 결정 2026-10-02 · 목업 v12) */}
          <DaboutiPill active={activeMenu === 'wiki'} onClick={() => setActiveMenu('wiki')} />
          <SearchBox onSearchSelect={onSearchSelect} variant="inline" />
          {cloudMode && <NotificationBell onOpenTask={onOpenTask} onOpenLink={onOpenLink} />}
          <ProfileMenu onOpenProfile={onOpenProfile} onOpenMembers={onOpenMembers} />
        </div>
      </div>

      {/* 예배·말씀·모임에서는 프로젝트 탭 줄이 서지 않는다 — 업무 축의 물건이다
          (사용자 요청 2026-09-01). grid-rows 0fr↔1fr 전환으로 자연스럽게 접고 편다 —
          max-height 방식은 값을 추정해야 해서 끝에서 뚝 끊긴다. 모션 최소화 설정은 뺀다. */}
      <div className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        data-project-row style={{ gridTemplateRows: showProjectRow ? '1fr' : '0fr' }}>
      <div className="min-h-0 overflow-hidden">
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
          <span className="shrink-0 inline-flex items-center gap-1 pr-1.5 pt-2.5 pb-2 text-[13px] font-semibold tabular-nums">{year} <ChevronDown size={13} /></span>
          {/* 앞 칸 세로선 — 연도 **뒤**에 둔다(kids 인덱스를 밀지 않게) */}
          <span className={TAB_DIVIDER} />
        </div>
        <YearPicker year={year} years={years} yearCounts={yearCounts} onPick={setYear} />
        {shown.map((p, i) => (
          <React.Fragment key={p.id}>
          <button
            onClick={() => setActiveMenu(p.id)}
            data-front={frontIds.has(p.id) ? '' : undefined}
            draggable={!frontIds.has(p.id)}
            onDragStart={() => setDragTabId(p.id)}
            onDragOver={(e) => {
              if (!frontIds.has(p.id)) { e.preventDefault(); return; }
              // 뒤쪽 탭을 앞 칸 위로 가져왔다 — 놓을 자리가 아니라고 말해 준다
              if (dragTabId && !frontIds.has(dragTabId)) showNudge(e.currentTarget, 'back');
            }}
            {...frontProps(p)}
            onDrop={(e) => { e.preventDefault(); dropTab(p.id); }}
            onDragEnd={() => setDragTabId(null)}
            // truncate(overflow-hidden)를 버튼에 직접 주면 **경계에 걸친 얼굴이 잘린다**
            // (실제로 반이 잘려 나갔다 — 2026-08-30). 말줄임은 안쪽 span이 맡고
            // 버튼은 클리핑하지 않는다.
            // 탭은 **왼쪽 정렬** — 들어가는 만큼 최대한 세운 뒤 넘칠 것만 더보기로
            // 접고, 공백은 더보기와 + 프로젝트 사이에 남는다(사용자 확정 2026-09-01).
            // 연도와 첫 탭 사이 간격은 YearPicker의 pr-1.5 + 탭 px-3.5가 전부다 —
            // 더 벌리고 싶으면 마진이 아니라 그 둘을 만져야 measure와 안 어긋난다.
            className={`relative px-3.5 pt-2.5 pb-2 -mb-px text-[13px] font-semibold border-b-2 transition-colors whitespace-nowrap max-w-[220px] ${activeMenu === p.id ? 'text-fg border-fg' : 'text-fg-muted border-transparent hover:text-fg'} ${dragTabId === p.id ? 'opacity-50' : ''}`}
          >
            {freshIds.has(p.id) && <FreshDot />}
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
          {i === dividerAfter && <span aria-hidden data-tab-divider className={tabDividerCls(!!nudge)} />}
          </React.Fragment>
        ))}
        <FrontNudge nudge={nudge} />
        {showMore && (
          <span ref={more.rootRef} className="inline-flex">
            <span ref={more.btnRef} className="inline-flex">
              <button onClick={more.toggle} className="px-3 pt-2.5 pb-2 -mb-px inline-flex items-center gap-1 text-[13px] font-semibold text-fg-muted hover:text-fg border-b-2 border-transparent transition-colors">
                더보기 <ChevronDown size={13} />
              </button>
            </span>
            {more.panel('z-[90] bg-surface border border-line rounded-lg shadow-elevated p-1.5 max-h-72 overflow-y-auto',
              <YearFolders active={rest} archived={archivedForMore} onPick={(id) => { more.close(); setActiveMenu(id); }} />)}
          </span>
        )}
        {/* border-b-2 border-transparent: 줄이 items-end라 **아래 테두리 두께만큼**
            글자 자리가 정해진다. 탭·더보기·연도는 전부 투명 2px을 깔고 있는데 이 버튼만
            없어서 글자가 2px 내려앉아 보였다(사용자 지적 2026-08-29). 폭에는 영향이
            없어서 useTabFit의 측정 줄은 그대로 둔다. */}
        {/* ml-auto: 이 버튼만 오른쪽 끝에 붙인다. 탭·더보기는 왼쪽 정렬 그대로라
            남는 폭은 더보기와 이 버튼 사이에 선다(사용자 확정 2026-09-01).
            폭 계산(avail)이 이 버튼 폭을 빼고 있어 탭과 겹칠 일은 없다. */}
        <button onClick={onOpenProject} className="ml-auto px-3 pt-2.5 pb-2 -mb-px border-b-2 border-transparent text-[13px] font-semibold text-fg-faint hover:text-fg-muted transition-colors whitespace-nowrap">+ 프로젝트</button>
      </div>
      </div>
      </div>
    </div>
  );
});
