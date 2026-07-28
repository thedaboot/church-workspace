import React, { useState, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutDashboard, CheckSquare, Search, Plus, X, Hash, ChevronDown,
  Settings, Undo2, Redo2, Sun, Moon, LogOut, Bell, Pencil, Users
} from 'lucide-react';
import { store, useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsList, selectProjectsMap, selectMyTasks, selectTasksList
} from '../store/selectors.js';
import { useAuth } from '../services/auth.jsx';
import { avatarColor, formatRelative } from '../utils.js';
import * as cloudSync from '../services/cloudSync.js';
import { showToast } from './Toast.jsx';
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

const PROJECT_TAB_MAX = 5; // 2줄이 넘치지 않는 한계. 나머지는 '더보기'로

// 활성 프로젝트는 언제나 탭에 보이게 — 6번째 프로젝트를 열었는데 탭에 아무것도
// 선택돼 있지 않으면 지금 어디 있는지 알 수 없다.
function splitProjectTabs(projectsList, activeMenu) {
  const shown = projectsList.slice(0, PROJECT_TAB_MAX);
  const active = projectsList.find(p => p.id === activeMenu);
  if (active && !shown.some(p => p.id === active.id)) shown[PROJECT_TAB_MAX - 1] = active;
  const shownIds = new Set(shown.map(p => p.id));
  return { shown, rest: projectsList.filter(p => !shownIds.has(p.id)) };
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
export function ProfileMenu({ onOpenProfile, className = 'inline-flex shrink-0', children }) {
  const currentUser = useStore(selectCurrentUser);
  const { enabled, session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
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
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${CONFIG.TEAMS[currentUser.team] || avatarColor(currentUser.name)}`}>{currentUser.name[0]}</span>
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
  activeMenu, setActiveMenu, onSearchSelect, onOpenTask, onOpenProfile, onOpenProject,
  undo, redo, canUndo, canRedo, cloudMode,
}) => {
  const projectsList = useStore(selectProjectsList);
  const myTasksCount = useStore(selectMyTasks).filter(t => t.status !== '완료').length;
  const { shown, rest } = splitProjectTabs(projectsList, activeMenu);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRootRef = useRef(null);
  const moreBtnRef = useRef(null);
  const morePopRef = useRef(null);
  const [morePos, placeMore] = useAnchoredPos(moreBtnRef, moreOpen, 224, 260);
  useDismiss(moreOpen, () => setMoreOpen(false), [moreRootRef, morePopRef]);

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
          <ProfileMenu onOpenProfile={onOpenProfile} />
        </div>
      </div>

      <div className="flex items-end px-6 border-t border-line/70">
        {shown.map(p => (
          <button
            key={p.id} onClick={() => setActiveMenu(p.id)}
            className={`px-3.5 pt-2.5 pb-2 -mb-px text-[13px] font-semibold border-b-2 transition-colors whitespace-nowrap max-w-[220px] truncate ${activeMenu === p.id ? 'text-fg border-fg' : 'text-fg-muted border-transparent hover:text-fg'}`}
          >
            {p.title}
          </button>
        ))}
        {rest.length > 0 && (
          <span ref={moreRootRef} className="inline-flex">
            <span ref={moreBtnRef} className="inline-flex">
              <button onClick={() => { placeMore(); setMoreOpen(o => !o); }} className="px-3 pt-2.5 pb-2 -mb-px inline-flex items-center gap-1 text-[13px] font-semibold text-fg-muted hover:text-fg border-b-2 border-transparent transition-colors">
                더보기 <ChevronDown size={13} />
              </button>
            </span>
            {moreOpen && createPortal(
              <div ref={morePopRef} style={{ position: 'fixed', left: morePos.left, top: morePos.top, width: 224 }} className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-1.5 max-h-72 overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
                {rest.map(p => (
                  <button key={p.id} onClick={() => { setMoreOpen(false); setActiveMenu(p.id); }} className="w-full flex items-center gap-2 px-2.5 py-2.5 rounded-md text-[13px] text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors text-left">
                    <Hash size={14} className="shrink-0 text-fg-faint" /><span className="truncate">{p.title}</span>
                  </button>
                ))}
              </div>,
              document.body
            )}
          </span>
        )}
        <button onClick={onOpenProject} className="px-3 pt-2.5 pb-2 -mb-px text-[13px] font-semibold text-fg-faint hover:text-fg-muted transition-colors whitespace-nowrap">+ 프로젝트</button>
      </div>
    </div>
  );
});

// 모바일 상단: 현재 화면 이름 + 검색·알림, 그 아래 프로젝트 탭(가로 스크롤)
export const MobileTopBar = React.memo(({ activeMenu, setActiveMenu, onSearchSelect, onOpenTask, onOpenProject, onRenameProject, onOpenProfile, cloudMode }) => {
  const projectsList = useStore(selectProjectsList);
  const projectsMap = useStore(selectProjectsMap);
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
        <SearchBox onSearchSelect={onSearchSelect} variant="icon" />
        {cloudMode && <NotificationBell onOpenTask={onOpenTask} />}
        {/* 설정은 상단 헤더로 — 하단 탭 네 자리는 프로젝트·내 업무·대시보드·팀이 쓴다 */}
        <ProfileMenu onOpenProfile={onOpenProfile} />
      </div>
      {project && (
        // x-scroll-lock: 가로로 밀 때 세로 스크롤이 같이 딸려가지 않게 (index.css)
        <div className="flex items-end gap-0 px-2 overflow-x-auto scrollbar-hide x-scroll-lock border-t border-line/70">
          {projectsList.map(p => (
            <button
              key={p.id} onClick={() => setActiveMenu(p.id)}
              // 활성 탭이 화면 밖이면 끌어온다 — 여기는 데스크톱과 달리 프로젝트를 전부
              // 그려서(가로 스크롤), 프로젝트가 늘면 지금 보고 있는 탭이 오른쪽 밖에
              // 있어도 아무 표시가 없었다. ref 콜백이라 활성 탭이 바뀔 때만 불린다.
              ref={activeMenu === p.id ? (el) => el?.scrollIntoView({ inline: 'nearest', block: 'nearest' }) : null}
              className={`shrink-0 px-3 pt-2.5 pb-2 -mb-px text-[13px] font-semibold border-b-2 transition-colors whitespace-nowrap ${activeMenu === p.id ? 'text-fg border-fg' : 'text-fg-muted border-transparent'}`}
            >
              {p.title}
            </button>
          ))}
          <button onClick={onOpenProject} className="shrink-0 px-3 pt-2.5 pb-2 -mb-px text-[13px] font-semibold text-fg-faint whitespace-nowrap">+ 프로젝트</button>
        </div>
      )}
    </div>
  );
});

// 모바일 하단 탭바 — 프로젝트 / 내 업무 / 대시보드 / 팀 (핸드오프 규격).
// 설정은 상단 헤더로 올라갔다.
export const MobileTabBar = React.memo(({ activeMenu, setActiveMenu, onOpenProject }) => {
  const projectsList = useStore(selectProjectsList);
  const currentUser = useStore(selectCurrentUser);
  const myTasksCount = useStore(selectMyTasks).filter(t => t.status !== '완료').length;
  const isProject = projectsList.some(p => p.id === activeMenu);
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

// 결과 계산 + 렌더 (검색 중일 때만 마운트 → store 구독·계산도 그때만 발생)
// useDeferredValue로 타이핑 입력과 무거운 결과 렌더를 분리해 렉 방지
function SearchResults({ query, onPick }) {
  const projectsList = useStore(selectProjectsList);
  const tasksList = useStore(selectTasksList);
  const projectsMap = useStore(selectProjectsMap);
  const deferred = useDeferredValue(query);

  const results = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    if (q.length < 2) return null;
    const projectHits = projectsList.filter(p => (p.title || '').toLowerCase().includes(q));
    const taskHits = tasksList.filter(t =>
      (t.title || '').toLowerCase().includes(q) ||
      (t.content || '').toLowerCase().includes(q) ||
      (t.assignees || []).some(a => (a || '').toLowerCase().includes(q))
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
                    placeholder="프로젝트나 업무를 검색해봐요!"
                    className="pl-9 pr-3 py-2 text-sm bg-surface border border-line rounded-xs focus:border-accent focus:ring-2 focus:ring-accent-weak outline-none w-full transition-all"
                  />
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
        placeholder="프로젝트나 업무를 검색해봐요!"
        className="pl-8 pr-3 h-8 text-[12.5px] bg-surface/60 border border-line rounded-sm focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent-weak outline-none w-full transition-all"
      />
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
// 알림 종류별 문구 (kind: 'mention' | 'reply')
const notifText = (kind) => (kind === 'reply' ? '내 댓글에 답글을 남겼어요' : '나를 멘션했어요');

function NotificationBell({ onOpenTask }) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open, 320, 240);
  const unread = items.filter(n => !n.read).length;

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
      showToast(`${row.actor_name}님이 ${notifText(row.kind)}`);
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
          {items.length === 0 ? (
            <div className="text-center py-8 px-3">
              <span className="inline-flex w-8 h-8 rounded-full bg-tag-yellow text-tag-yellow-fg items-center justify-center mb-2"><Bell size={13} strokeWidth={1.75} /></span>
              <p className="text-xs text-fg-faint">새 알림이 없어요</p>
            </div>
          ) : (
            <div className="divide-y divide-line/60">
              {items.map(n => (
                <button
                  key={n.id} onClick={() => openItem(n)}
                  className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-surface-hover transition-colors ${n.read ? '' : 'bg-accent-weak/40'}`}
                >
                  {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 mt-2" />}
                  <span className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${avatarColor(n.actor_name)}`}>{n.actor_name?.[0]}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] text-fg-secondary leading-snug">
                      <span className="font-semibold text-fg">{n.actor_name}</span>님이 {notifText(n.kind)}
                    </span>
                    {n.preview && <span className="block text-[10px] text-fg-muted truncate mt-0.5">{n.preview}</span>}
                    <span className="block text-[9px] text-fg-faint mt-0.5">{formatRelative(n.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

