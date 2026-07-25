import React, { useState, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import {
  LayoutDashboard, CheckSquare, Search, Plus, X, Hash, Menu,
  Settings, Undo2, Redo2, Sun, Moon, LogOut, Bell
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

// 라이트/다크 수동 전환 (기본값은 시스템 설정, 선택은 localStorage에 기억)
function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.setAttribute('data-seed-user-color-scheme', next);
    localStorage.setItem('theme', next);
    setTheme(next);
  };
  return (
    <button onClick={toggle} className="group p-2 rounded-md hover:bg-surface-hover text-fg-muted transition active:scale-95" title={theme === 'dark' ? '라이트 모드' : '다크 모드'}>
      {theme === 'dark'
        ? <Sun size={18} strokeWidth={1.75} className="transition-transform duration-300 group-hover:rotate-12" />
        : <Moon size={18} strokeWidth={1.75} className="transition-transform duration-300 group-hover:rotate-12" />}
    </button>
  );
}

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================
export const Sidebar = React.memo(({ activeMenu, setActiveMenu, isSidebarOpen, closeSidebar, onOpenProfile, onOpenProject }) => {
  const currentUser = useStore(selectCurrentUser);
  const projectsList = useStore(selectProjectsList);
  const myTasksCount = useStore(selectMyTasks).filter(t => t.status !== '완료').length;

  return (
    <div className={`fixed md:static inset-y-0 left-0 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-300 ease-in-out w-64 bg-surface-2 border-r border-line flex flex-col shadow-xl md:shadow-none z-30`}>
      {/* h-14: 헤더와 하단 라인 정렬 */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-line shrink-0">
        <button onClick={() => setActiveMenu('dashboard')} className="flex items-center gap-2 min-w-0 transition active:scale-95" title="홈(대시보드)으로">
          <img src={logoLight} alt="더다붓" className="h-8 w-auto dark:hidden" />
          <img src={logoDark} alt="더다붓" className="h-8 w-auto hidden dark:block" />
        </button>
        <button className="md:hidden p-1 text-fg-muted transition active:scale-95" onClick={closeSidebar}><X size={20} /></button>
      </div>
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1 scrollbar-hide">
        <NavItem icon={<LayoutDashboard size={15} strokeWidth={1.75} />} tile="bg-tag-blue text-tag-blue-fg" label="전체 대시보드" active={activeMenu === 'dashboard'} onClick={() => setActiveMenu('dashboard')} />
        <NavItem icon={<CheckSquare size={15} strokeWidth={1.75} />} tile="bg-tag-green text-tag-green-fg" label="내 업무" active={activeMenu === 'myTasks'} onClick={() => setActiveMenu('myTasks')} badge={myTasksCount} />
        <div className="mt-6 mb-2 px-2 text-[10px] font-bold text-fg-faint uppercase tracking-wider flex justify-between items-center">
          프로젝트 리스트 <Plus size={14} className="cursor-pointer hover:text-fg p-0.5 rounded hover:bg-surface-hover transition active:scale-95" onClick={onOpenProject} />
        </div>
        {projectsList.map(p => <NavItem key={p.id} icon={<Hash size={15} strokeWidth={1.75} />} tile="bg-tag-purple text-tag-purple-fg" label={p.title} active={activeMenu === p.id} onClick={() => setActiveMenu(p.id)} />)}
        {projectsList.length === 0 && <p className="px-2 pt-1 text-[10px] text-fg-faint leading-relaxed">위 <span className="font-semibold">+</span> 버튼으로 첫 프로젝트를 만들어보세요.</p>}
      </div>
      <SidebarProfile currentUser={currentUser} onOpenProfile={onOpenProfile} />
    </div>
  );
});

function SidebarProfile({ currentUser, onOpenProfile }) {
  const { enabled, session, signOut } = useAuth();
  return (
    <div className="p-4 border-t border-line flex items-center gap-3 hover:bg-surface-hover transition-colors group">
      <div onClick={onOpenProfile} className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
        {/* 프로필 아바타는 소속 팀 색을 따른다 (팀 미지정 시 이름 해시 색) */}
        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold shrink-0 transition-colors ${CONFIG.TEAMS[currentUser.team] || avatarColor(currentUser.name)}`}>{currentUser.name[0]}</div>
        <div className="flex-1 min-w-0"><p className="text-sm font-medium text-fg truncate">{currentUser.name}</p><p className="text-xs text-fg-muted truncate">{currentUser.team}</p></div>
        <Settings size={14} className="text-fg-faint group-hover:text-fg-muted shrink-0" />
      </div>
      {enabled && session && (
        <button onClick={signOut} className="p-1.5 rounded-md hover:bg-line text-fg-faint hover:text-fg-muted transition active:scale-95 shrink-0" title="로그아웃"><LogOut size={14} /></button>
      )}
    </div>
  );
}

const NavItem = React.memo(({ icon, label, active, onClick, badge, tile }) => (
  <button onClick={onClick} className={`group w-full flex items-center justify-between px-2.5 py-2 rounded-md text-sm transition-colors transition active:scale-95 ${active ? 'bg-surface-hover text-fg font-medium' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'}`}>
    <div className="flex items-center gap-2.5 truncate min-w-0">
      <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${tile || ''} ${active ? 'shadow-soft' : ''}`}>{icon}</span>
      <span className="truncate">{label}</span>
    </div>
    {badge > 0 && <span className="bg-surface-hover text-accent-text py-0.5 px-2 rounded-full text-[10px] font-bold shrink-0">{badge}</span>}
  </button>
));

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
function SearchBox({ onSearchSelect }) {
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

  return (
    <>
      {/* 데스크톱 인라인 검색창 + 드롭다운 */}
      <div className="relative hidden sm:block flex-1 max-w-2xl" ref={rootRef}>
        <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-fg-faint" strokeWidth={1.75} />
        <input
          type="text" value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="프로젝트나 업무를 검색해봐요!"
          className="pl-9 pr-4 py-1.5 text-sm bg-surface border border-line rounded-xs focus:border-accent focus:ring-2 focus:ring-accent-weak focus:shadow-soft outline-none w-full transition-all"
        />
        {open && active && (
          <div className="absolute left-0 top-full z-50 mt-1 w-full max-h-80 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1.5 animate-in fade-in zoom-in-95 duration-150">
            <SearchResults query={query} onPick={pick} />
          </div>
        )}
      </div>

      {/* 모바일 검색 아이콘 */}
      <button className="sm:hidden p-2 rounded-md hover:bg-surface-hover text-fg-muted transition active:scale-95 shrink-0" onClick={() => setMobileOpen(true)} title="검색"><Search size={18} strokeWidth={1.75} /></button>

      {/* 모바일 전체폭 오버레이 (불투명 배경 — 모바일 GPU 비용 큰 blur 미사용) */}
      {mobileOpen && (
        <div className="sm:hidden fixed inset-0 z-50 bg-black/40 animate-in fade-in duration-150" onClick={closeMobile}>
          <div className="absolute inset-x-0 top-0 bg-surface border-b border-line shadow-elevated p-3 animate-in slide-in-from-top-2 duration-150" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" strokeWidth={1.75} />
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

// ── @멘션 알림 (클라우드 모드 전용) ────────────────────────────────────────
// 알림은 전역 스토어에 넣지 않는다(워크스페이스 데이터와 수명·성격이 다름).
// 헤더 컴포넌트 로컬 state + realtime 구독으로 충분.
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
      showToast(`${row.actor_name}님이 나를 멘션했어요`);
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
            <span className="absolute top-1.5 right-1.5 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
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
                      <span className="font-semibold text-fg">{n.actor_name}</span>님이 나를 멘션했어요
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

export const Header = React.memo(({ activeMenu, openSidebar, onSearchSelect, onOpenTask, undo, redo, canUndo, canRedo, cloudMode }) => {
  const projectsMap = useStore(selectProjectsMap);
  let title = '워크스페이스';
  if (activeMenu === 'dashboard') title = '전체 대시보드';
  else if (activeMenu === 'myTasks') title = '내 업무';
  else if (activeMenu === 'guide') title = '사용 가이드';
  else if (activeMenu.startsWith('team:')) title = `${activeMenu.split(':')[1]} 보드`;
  else if (projectsMap[activeMenu]) title = projectsMap[activeMenu].title;

  return (
    <header className="h-14 bg-surface border-b border-line flex items-center px-4 md:px-6 shrink-0 gap-2 md:gap-4 z-10">
      <div className="flex items-center gap-3 min-w-0 shrink">
        <button className="md:hidden p-1 text-fg-muted hover:bg-surface-hover rounded-md transition active:scale-95" onClick={openSidebar}><Menu size={20} strokeWidth={1.75} /></button>
        <h2 className="font-semibold text-base md:text-lg text-fg truncate tracking-[-0.25px]">{title}</h2>
      </div>
      <div className="flex items-center gap-1 md:gap-3 flex-1 justify-end min-w-0">
        {/* Undo / Redo — 클라우드 모드에선 다른 사람과 상태가 어긋나므로 숨김 */}
        {!cloudMode && (
          <div className="flex items-center bg-surface-2 rounded-md p-0.5 shrink-0">
            <button onClick={undo} disabled={!canUndo} className={`p-1.5 rounded text-fg-muted transition active:scale-95 ${canUndo ? 'hover:bg-surface hover:shadow-soft' : 'opacity-30 cursor-not-allowed'}`} title="실행 취소 (Ctrl+Z)"><Undo2 size={16} strokeWidth={1.75}/></button>
            <button onClick={redo} disabled={!canRedo} className={`p-1.5 rounded text-fg-muted transition active:scale-95 ${canRedo ? 'hover:bg-surface hover:shadow-soft' : 'opacity-30 cursor-not-allowed'}`} title="다시 실행"><Redo2 size={16} strokeWidth={1.75}/></button>
          </div>
        )}
        <SearchBox onSearchSelect={onSearchSelect} />
        {cloudMode && <NotificationBell onOpenTask={onOpenTask} />}
        <ThemeToggle />
      </div>
    </header>
  );
});
