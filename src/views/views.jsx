import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  LayoutDashboard, Plus, Calendar as CalendarIcon,
  ExternalLink, ChevronRight, Check, X, Trash2, Pencil, MoreHorizontal
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { CONFIG, teamColor } from '../config.js';
import { generateId } from '../utils.js';
import { store, useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsMap, selectMyTasks,
  selectDashboardStats, selectTasksList
} from '../store/selectors.js';
import { Board, CalendarBoard } from '../components/boards.jsx';
import { useAuth } from '../services/auth.jsx';
import * as cloudSync from '../services/cloudSync.js';
import { ShareButton } from '../components/ShareButton.jsx';
import { ConfirmPopover, useAnchoredPos } from '../components/ConfirmPopover.jsx';
import { showToast } from '../components/Toast.jsx';

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================
export const DashboardView = React.memo(function DashboardView({ onNavigate }) {
  const { progress, teamStats } = useStore(selectDashboardStats);
  const myTasksCount = useStore(selectMyTasks).filter(t => t.status !== '완료').length;
  const currentUser = useStore(selectCurrentUser);
  const tasksList = useStore(selectTasksList);
  const projectsMap = useStore(selectProjectsMap);
  // 소속 팀이 여럿이면 전부 합쳐서 센다(대표 팀 하나만 세면 겸직한 사람의 업무가 빠진다)
  const myTeams = currentUser.teams?.length ? currentUser.teams : [currentUser.team].filter(Boolean);
  const myTeamKey = myTeams.join(',');
  const myTeamTasks = useMemo(
    () => tasksList.filter(t => (t.teams || []).some(x => myTeams.includes(x)) && t.status !== '완료'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasksList, myTeamKey]
  );

  const done = teamStats.reduce((n, s) => n + s.done, 0);
  const left = teamStats.reduce((n, s) => n + (s.total - s.done), 0);

  // 화면을 채우는 건 장식이 아니라 정보다 — 7일 안에 마감인 업무를 모아 보여준다
  const soon = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const limit = new Date(today); limit.setDate(limit.getDate() + 7);
    const iso = (d) => d.toISOString().slice(0, 10);
    const from = iso(today), to = iso(limit);
    // 완료는 물론 보류 중도 뺀다 — 멈춰 세운 일을 마감으로 재촉할 이유가 없다
    return tasksList
      .filter(t => t.status !== '완료' && t.status !== '보류 중' && t.dueDate && t.dueDate <= to)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 8)
      .map(t => ({ ...t, overdue: t.dueDate < from }));
  }, [tasksList]);
  const overdue = soon.filter(t => t.overdue).length;

  return (
    // 보드와 같은 규칙 — 상자·그림자·아이콘 타일 없이 숫자와 구분선으로만.
    // 폭 제한을 두지 않아 어떤 화면에서도 가로를 꽉 쓴다.
    <div className="pb-6 animate-in fade-in duration-300">
      {/* KPI 4칸을 한 줄로 — 도넛도 다른 칸과 같은 골격(라벨/큰 값/설명)을 쓴다.
          도넛만 한 줄을 따로 먹던 배치는 데스크톱에서 위쪽을 통째로 낭비했다. */}
      <div className="grid grid-cols-4 gap-x-2.5 md:gap-x-6 pb-4 border-b border-line">
        <KpiTile label="전체 진척도" shortLabel="진척도" sub={`${done}건 완료 · ${left}건 남음`} shortSub={`${done}/${done + left}`}>
          <ProgressRing value={progress} />
        </KpiTile>
        <KpiTile
          label="내 남은 업무" shortLabel="내 업무" value={`${myTasksCount}개`}
          sub={myTasksCount ? '눌러서 내 업무로' : '오늘도 화이팅!'} shortSub={myTasksCount ? '눌러서 보기' : '화이팅!'}
          onClick={() => onNavigate('myTasks')}
        />
        <KpiTile
          label="이번 주 마감" shortLabel="이번 주" value={`${soon.length}개`}
          sub={overdue ? `지난 마감 ${overdue}건` : '7일 안 마감'} shortSub={overdue ? `지남 ${overdue}건` : '7일 안'}
          tone={overdue ? 'warn' : undefined}
        />
        <KpiTile
          label="내 팀 업무" shortLabel="내 팀" tag={myTeams.length > 1 ? `${myTeams[0]} 외 ${myTeams.length - 1}` : myTeams[0]}
          value={`${myTeamTasks.length}개`}
          sub={myTeamTasks.length ? `${myTeamTasks[0].title}${myTeamTasks.length > 1 ? ` 외 ${myTeamTasks.length - 1}건` : ''}` : '남은 업무가 없어요'}
          shortSub={myTeamTasks.length ? `${myTeamTasks.length}건 남음` : '없어요'}
          onClick={() => myTeams[0] && onNavigate(`team:${myTeams[0]}`)}
        />
      </div>

      {/* 팀별 현황 + 마감 임박 — 데스크톱은 나란히, 모바일은 위아래 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6 pt-5">
        <section>
          <h3 className="font-bold text-xs text-fg-muted pb-2 border-b border-line">팀별 업무 현황</h3>
          {teamStats.map(stat => (
            <button key={stat.name} onClick={() => onNavigate(`team:${stat.name}`)} className="w-full flex items-center gap-3 py-2.5 border-b border-line hover:bg-fg/[0.02] transition-colors group text-left">
              <span className={`text-[11px] font-bold tracking-[0.03em] shrink-0 w-[68px] ${CONFIG.TEAM_FG[stat.name] || 'text-fg-muted'}`}>{stat.name}</span>
              {/* 막대 색을 팀 색으로 — 전에는 전부 초록/회색이라 우리 팀 색과 어긋났다 */}
              <span className="flex-1 min-w-0 h-1.5 rounded-full bg-line/60 overflow-hidden">
                <span className="block h-full rounded-full transition-all duration-700" style={{ width: `${stat.progress}%`, background: teamColor(stat.name) }} />
              </span>
              <span className="text-[11px] text-fg-muted tabular-nums shrink-0 w-[52px] text-right">{stat.done}/{stat.total}</span>
              <span className="text-[11px] font-bold text-fg tabular-nums shrink-0 w-9 text-right">{stat.progress}%</span>
              <ChevronRight size={14} className="text-fg-faint opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          ))}
          {!teamStats.length && <p className="py-6 text-center text-[11px] text-fg-faint">아직 업무가 없어요</p>}
        </section>

        <section>
          <h3 className="font-bold text-xs text-fg-muted pb-2 border-b border-line">마감이 가까운 업무</h3>
          {soon.map(t => (
            <button key={t.id} onClick={() => onNavigate(t.projectId)} className="w-full flex items-center gap-3 py-2.5 border-b border-line hover:bg-fg/[0.02] transition-colors group text-left">
              <span className={`shrink-0 w-[52px] text-[11px] font-bold tabular-nums ${t.overdue ? 'text-tag-red-fg' : 'text-fg-muted'}`}>
                {new Date(t.dueDate).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold text-fg truncate">{t.title}</span>
                <span className="block text-[10px] text-fg-faint truncate">
                  {projectsMap[t.projectId]?.title || '프로젝트 없음'}{t.teams?.length ? ` · ${t.teams.join(', ')}` : ''}
                </span>
              </span>
              {/* 점만 두니 있는지 없는지도 모를 만큼 흐렸다 → 점 + 상태 글자 */}
              <span className="shrink-0 inline-flex items-center gap-1.5">
                <span className={`w-[7px] h-[7px] rounded-full ${CONFIG.STATUS_DOTS[t.status] || 'bg-fg-faint'}`} />
                <span className="text-[11px] font-semibold text-fg-muted w-[42px]">{t.status}</span>
              </span>
            </button>
          ))}
          {!soon.length && <p className="py-6 text-center text-[11px] text-fg-faint">7일 안에 마감되는 업무가 없어요</p>}
        </section>
      </div>
    </div>
  );
});

// 진척도 도넛 — 라이브러리 없이 SVG 원 하나. stroke-dasharray로 채운 만큼만 그린다.
// 숫자는 SVG <text>가 아니라 위에 겹친 HTML로 넣는다. <text>에 CSS 회전(rotate-90 +
// origin-center)을 걸었더니 iOS 사파리에서 transform-box 해석이 달라 숫자가 링 밖으로
// 튀어나갔다(크롬에서는 정상이라 데스크톱에서 안 보였다).
// 크기는 viewBox로 스케일 — 좁은 화면에서는 다른 칸의 숫자와 비슷한 덩치로 줄어든다.
const RING_VB = 76, RING_STROKE = 7;
function ProgressRing({ value }) {
  const r = (RING_VB - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-[42px] h-[42px] md:w-[62px] md:h-[62px]">
      <svg viewBox={`0 0 ${RING_VB} ${RING_VB}`} className="w-full h-full -rotate-90 block">
        <circle cx={RING_VB / 2} cy={RING_VB / 2} r={r} fill="none" stroke="var(--app-line)" strokeWidth={RING_STROKE} />
        <circle
          cx={RING_VB / 2} cy={RING_VB / 2} r={r} fill="none" stroke="var(--app-accent)" strokeWidth={RING_STROKE}
          strokeLinecap="round" strokeDasharray={`${(c * value) / 100} ${c}`}
          className="transition-[stroke-dasharray] duration-1000"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] md:text-[15px] font-extrabold text-fg tracking-[-0.5px] tabular-nums">{value}%</span>
    </div>
  );
}

// KPI 한 칸 — 라벨 / 큰 값(숫자 또는 children) / 설명 한 줄.
// 좁은 화면에서는 short* 를 대신 쓴다(4칸이 한 줄에 들어가야 하므로).
function KpiTile({ label, shortLabel, value, sub, shortSub, tag, tone, onClick, children }) {
  const Tag = onClick ? 'button' : 'div';
  const twoText = (long, short) => short && short !== long
    ? <><span className="md:hidden">{short}</span><span className="hidden md:inline">{long}</span></>
    : long;
  return (
    // block: <button>은 기본으로 내용을 세로 가운데 정렬해서, 같은 줄의 div 칸과
    // 라벨 높이가 8px씩 어긋났다. 팀 이름표는 좁은 칸에서 라벨을 두 줄로
    // 밀어내므로 데스크톱에서만 붙인다.
    <Tag onClick={onClick} className={`block text-left min-w-0 group ${onClick ? 'cursor-pointer' : ''}`}>
      <h3 className="text-fg-muted text-[11px] md:text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap">
        {twoText(label, shortLabel)}
        {tag && <span className={`hidden md:inline font-bold ${CONFIG.TEAM_FG[tag] || 'text-fg-muted'}`}>{tag}</span>}
        {onClick && <ChevronRight size={12} className="text-fg-faint opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />}
      </h3>
      {/* 도넛과 숫자가 한 줄에 섞여도 위아래 여백이 같게 — 높이를 맞춘 상자에 담는다 */}
      <div className="h-[42px] md:h-[62px] flex items-center mt-1">
        {children || <span className={`text-[23px] md:text-[30px] font-extrabold tracking-[-1.5px] leading-none ${tone === 'warn' ? 'text-tag-red-fg' : 'text-fg'}`}>{value}</span>}
      </div>
      <p className="text-[10.5px] md:text-[11px] text-fg-faint truncate">{twoText(sub, shortSub)}</p>
    </Tag>
  );
}

// ── 모바일 프로젝트 화면의 접히는 조작들 ──────────────────────────────────
// 좁은 화면에서 버튼을 다 펼치면 정작 업무가 안 보인다. 자주 쓰는 것만 남기고
// 나머지는 이 두 팝오버로 접는다.

// 바깥 클릭/Esc로 닫히는 팝오버 껍데기 (필터·더보기 공용)
function MobilePopover({ label, badge, width = 240, title, children }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open, width, 240, 8, popRef);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <span ref={rootRef} className="inline-flex shrink-0">
      <span ref={btnRef} className="inline-flex">
        <button
          type="button" title={title}
          onClick={() => { place(); setOpen(o => !o); }}
          className={`inline-flex items-center gap-1 px-2 h-[30px] rounded-xs text-[11px] font-semibold border transition active:scale-95 ${badge > 0 ? 'bg-accent-weak border-accent text-accent-text' : 'bg-surface/70 border-line text-fg-muted'}`}
        >
          {label}{badge > 0 && <span className="font-bold">{badge}</span>}
        </button>
      </span>
      {open && createPortal(
        <div ref={popRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width }} className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-2 animate-in fade-in zoom-in-95 duration-150">
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>,
        document.body
      )}
    </span>
  );
}

// 팀 필터 — 모바일에서는 칩 줄을 통째로 접어 버튼 하나로 만든다(선택 수를 배지로)
function TeamFilterButton({ selectedTeams, toggleTeam, onClear }) {
  return (
    <MobilePopover label="필터" badge={selectedTeams.length} title="팀 필터" width={248}>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(CONFIG.TEAMS).map(([team, colorClass]) => {
          const selected = selectedTeams.includes(team);
          return (
            <button key={team} onClick={() => toggleTeam(team)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xs text-[11px] font-semibold border transition active:scale-95 ${selected ? colorClass + ' border-transparent' : 'bg-surface text-fg-muted border-line'}`}>
              {selected && <Check size={11} className="shrink-0" />}{team}
            </button>
          );
        })}
      </div>
      {selectedTeams.length > 0 && (
        <button onClick={onClear} className="mt-2 w-full py-1.5 text-[11px] font-semibold text-fg-muted hover:bg-surface-hover rounded-xs transition active:scale-95">필터 지우기</button>
      )}
    </MobilePopover>
  );
}

// 그 외 조작 — 리소스 링크, 공유, 프로젝트 삭제
function ProjectMoreMenu({ project, onRemoveLink, isAddingLink, setIsAddingLink, linkForm, shareBtn, deleteBtn }) {
  const links = project.pinnedLinks || [];
  return (
    <MobilePopover label={<MoreHorizontal size={15} />} title="그 외" width={252}>
      {(close) => (
        <div>
          <p className="px-1 pb-1.5 text-[10px] font-bold text-fg-faint">리소스</p>
          {links.map(l => (
            <div key={l.id} className="flex items-center gap-1 px-1 py-1.5">
              <a href={l.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 inline-flex items-center gap-1.5 text-[13px] text-accent-text truncate"><ExternalLink size={12} className="shrink-0" />{l.title}</a>
              <button onClick={() => onRemoveLink(l.id)} className="p-1 text-fg-faint rounded-md transition active:scale-95" title="링크 삭제"><X size={12} /></button>
            </div>
          ))}
          {!links.length && !isAddingLink && <p className="px-1 pb-1 text-[11px] text-fg-faint">아직 링크가 없어요</p>}
          {/* 중첩 팝오버 대신 이 안에서 펼친다 — 팝오버 안 팝오버는 위치 잡기가 불안하다 */}
          {isAddingLink
            ? <div className="pt-1">{linkForm}</div>
            : <button onClick={() => setIsAddingLink(true)} className="mt-1 w-full py-1.5 text-[11px] font-semibold text-fg-muted border border-dashed border-line rounded-xs transition active:scale-95">+ 링크 추가</button>}
          <div className="mt-2 pt-1.5 border-t border-line" onClick={close}>
            <span className="flex items-center gap-1.5 px-0.5 py-0.5 text-[13px] text-fg-muted">{shareBtn} 공유하기</span>
            {deleteBtn && <span className="flex items-center gap-1.5 px-0.5 py-0.5 text-[13px] text-fg-muted">{deleteBtn} 프로젝트 삭제</span>}
          </div>
        </div>
      )}
    </MobilePopover>
  );
}

// 아이콘 좌우에 투명 여백(약 2.4px)이 있어서 pl-3/pr-4로는 왼쪽이 2px 좁아 보였다.
// 실측 기준으로 시각적 여백을 맞춘다(왼 14+2.4 ≒ 오른 16).
// 흰 글자 옆 13px 아이콘은 1.4획이면 사라져 보여서 여기만 2로 되돌린다.
function NewTaskButton({ onClick, className = '' }) {
  return (
    // display 유틸(inline-flex/hidden)은 호출부가 지정한다 — 여기서 같이 주면
    // Tailwind가 같은 계층의 display 규칙끼리 충돌해 md:hidden이 안 먹는다
    <button onClick={onClick} className={`shrink-0 bg-fg hover:opacity-90 text-canvas pl-3 pr-3.5 py-2 rounded-xs text-xs font-bold transition active:scale-95 justify-center items-center gap-1.5 leading-none whitespace-nowrap ${className}`}>
      <Plus size={13} className="shrink-0 [stroke-width:2px]" /><span className="leading-none">새 업무</span>
    </button>
  );
}

// viewMode(보드/캘린더)는 App이 들고 있다 — 프로젝트를 옮기면 이 컴포넌트가 리마운트되므로
// 여기서 state로 두면 캘린더를 보다가 다른 프로젝트로 넘어갈 때마다 보드로 되돌아갔다.
export const ProjectView = React.memo(function ProjectView({ projectId, onTaskClick, onStatusChange, onNewTask, onNavigate, onRenameProject, viewMode, setViewMode }) {
  const projectsMap = useStore(selectProjectsMap);
  const tasksList = useStore(selectTasksList);
  const { isAdmin, enabled, session } = useAuth();
  const cloudOn = enabled && !!session;
  // 특정 프로젝트의 Task만 필터링 (해당 View 내부에서만 필요한 연산)
  const projectTasks = useMemo(() => tasksList.filter(t => t.projectId === projectId), [tasksList, projectId]);
  const project = projectsMap[projectId];

  const [selectedTeams, setSelectedTeams] = useState([]);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState({ title: '', url: '' });
  const linkPopRef = useRef(null);
  const linkBtnRef = useRef(null);
  const [linkPos, placeLink] = useAnchoredPos(linkBtnRef, isAddingLink, 256, 150);

  // 리소스 추가 팝오버: 바깥 클릭 / Escape 닫기
  useEffect(() => {
    if (!isAddingLink) return;
    const onDown = (e) => { if (linkPopRef.current && !linkPopRef.current.contains(e.target)) setIsAddingLink(false); };
    const onKey = (e) => { if (e.key === 'Escape') setIsAddingLink(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [isAddingLink]);

  const toggleTeam = (team) => setSelectedTeams(prev => prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team]);
  const filteredTasks = useMemo(() => selectedTeams.length === 0 ? projectTasks : projectTasks.filter(task => task.teams.some(t => selectedTeams.includes(t))), [projectTasks, selectedTeams]);

  if (!project) return null;

  const cloudErr = (label) => (err) => { console.error(`[cloud] ${label} 실패:`, err); showToast(`저장에 실패했어요 (${label}) · ${cloudSync.formatCloudError(err)}`); };

  const saveLink = () => {
    if (!linkDraft.title.trim() || !linkDraft.url.trim()) return;
    const url = /^https?:\/\//.test(linkDraft.url) ? linkDraft.url : `https://${linkDraft.url}`;
    const newLink = { id: generateId(), title: linkDraft.title.trim(), url };
    store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: project.id, pinnedLinks: [...(project.pinnedLinks || []), newLink] } });
    if (cloudOn) cloudSync.linkAddCloud(project.id, newLink).catch(cloudErr('리소스 추가'));
    setLinkDraft({ title: '', url: '' });
    setIsAddingLink(false);
  };
  const removeLink = (linkId) => {
    store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: project.id, pinnedLinks: (project.pinnedLinks || []).filter(l => l.id !== linkId) } });
    if (cloudOn) cloudSync.linkRemoveCloud(linkId).catch(cloudErr('리소스 삭제'));
  };

  const deleteProject = () => {
    store.dispatch({ type: 'DELETE_PROJECT', payload: project.id });
    if (cloudOn) cloudSync.projectDeleteCloud(project.id).catch(cloudErr('프로젝트 삭제'));
    onNavigate?.('dashboard');
  };

  const linkForm = (
    <div className="space-y-2">
      <input autoFocus value={linkDraft.title} onChange={e => setLinkDraft(p => ({ ...p, title: e.target.value }))} placeholder="이름" className="w-full text-xs px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint" />
      <input value={linkDraft.url} onChange={e => setLinkDraft(p => ({ ...p, url: e.target.value }))} placeholder="https://..." onKeyDown={e => { if (e.key === 'Enter') saveLink(); }} className="w-full text-xs px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint" />
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={() => setIsAddingLink(false)} className="text-xs px-2.5 py-1 text-fg-muted hover:bg-surface-hover rounded-md transition active:scale-95">취소</button>
        <button onClick={saveLink} disabled={!linkDraft.title.trim() || !linkDraft.url.trim()} className="text-xs px-2.5 py-1 bg-accent hover:bg-accent-strong disabled:bg-line text-white rounded-md transition active:scale-95">추가</button>
      </div>
    </div>
  );
  const shareBtn = <ShareButton url={`${window.location.origin}/s/p/${project.id}`} what="프로젝트" />;
  const deleteBtn = isAdmin ? (
    <ConfirmPopover message="프로젝트와 안의 모든 업무가 삭제돼요. 되돌릴 수 없어요." onConfirm={deleteProject}>
      <button type="button" className="p-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition active:scale-95 shrink-0" title="프로젝트 삭제"><Trash2 size={16} /></button>
    </ConfirmPopover>
  ) : null;
  const viewToggle = (
    // 아이콘은 라벨을 거들 뿐 — 13px로 줄이고 톤을 낮춰 글자가 먼저 읽히게
    <div className="flex bg-surface-hover/70 p-0.5 rounded-sm shrink-0">
      <button onClick={() => setViewMode('kanban')} className={`px-2.5 md:px-3 py-1.5 text-xs font-semibold rounded-xs transition-colors flex justify-center items-center gap-1.5 whitespace-nowrap ${viewMode === 'kanban' ? 'bg-surface text-fg' : 'text-fg-muted hover:text-fg'}`}><LayoutDashboard size={13} className="shrink-0 opacity-55"/> 보드</button>
      <button onClick={() => setViewMode('calendar')} className={`px-2.5 md:px-3 py-1.5 text-xs font-semibold rounded-xs transition-colors flex justify-center items-center gap-1.5 whitespace-nowrap ${viewMode === 'calendar' ? 'bg-surface text-fg' : 'text-fg-muted hover:text-fg'}`}><CalendarIcon size={13} className="shrink-0 opacity-55"/> 캘린더</button>
    </div>
  );

  return (
    <div className="h-full flex flex-col min-w-0 animate-in fade-in">
      {/* ── 모바일: 액션을 한 줄로 ────────────────────────────────────────────
          보기 전환 / 필터 / 그 외(리소스·공유·삭제) / 새 업무.
          전에는 리소스·액션·필터가 각자 한 줄씩 먹어서 업무가 화면 밖으로 밀렸다. */}
      <div className="md:hidden flex items-center gap-1.5 mb-3 shrink-0">
        {viewToggle}
        <span className="flex-1" />
        {viewMode === 'kanban' && (
          <TeamFilterButton selectedTeams={selectedTeams} toggleTeam={toggleTeam} onClear={() => setSelectedTeams([])} />
        )}
        <ProjectMoreMenu
          project={project} onRemoveLink={removeLink}
          isAddingLink={isAddingLink} setIsAddingLink={setIsAddingLink} linkForm={linkForm}
          shareBtn={shareBtn} deleteBtn={deleteBtn}
        />
        {viewMode === 'kanban' && <NewTaskButton onClick={onNewTask} className="inline-flex" />}
      </div>

      {/* ── 데스크톱: 제목·리소스 / 보기 전환·공유·삭제 ───────────────────── */}
      <div className="hidden md:flex pb-2.5 mb-3.5 gap-4 justify-between items-center shrink-0">
        <div className="min-w-0">
          {/* 제목을 누르면 이름 수정 (모바일은 상단바 제목을 누른다) */}
          <button
            onClick={() => onRenameProject?.(project)}
            className="inline-flex items-baseline gap-1.5 mb-1.5 group/title text-left"
            title="프로젝트 이름 수정"
          >
            <span className="text-2xl font-extrabold text-fg tracking-[-0.7px]">{project.title}</span>
            <Pencil size={13} className="text-fg-faint opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0 mb-0.5" />
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-fg-faint shrink-0">리소스</span>
            {project.pinnedLinks?.map(link => (
              <span key={link.id} className="group/link inline-flex items-center gap-1 text-xs pl-1.5 pr-1 py-1 bg-accent-weak text-accent-text rounded-md transition-colors">
                <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><ExternalLink size={10} /> {link.title}</a>
                <button onClick={() => removeLink(link.id)} className="opacity-0 group-hover/link:opacity-100 hover:text-fg rounded-full p-0.5 transition-opacity" title="링크 삭제"><X size={10} /></button>
              </span>
            ))}
            <div className="inline-flex" ref={linkPopRef}>
              <span ref={linkBtnRef} className="inline-flex">
                {/* 열기 전에 위치를 먼저 잡는다 — 안 그러면 첫 프레임이 {0,0}에
                    그려져서 팝오버가 화면 좌상단에서 날아오는 것처럼 보인다 */}
                <button onClick={() => { placeLink(); setIsAddingLink(v => !v); }} className="text-xs text-fg-faint hover:text-fg-muted hover:bg-surface-hover px-1.5 py-1 border border-dashed border-line rounded-md transition active:scale-95">+ 추가</button>
              </span>
              {isAddingLink && (
                <div style={{ position: 'fixed', left: linkPos.left, top: linkPos.top, width: 256 }} className="bg-surface border border-line rounded-lg shadow-elevated p-3 z-[90] animate-in fade-in zoom-in-95 duration-150">
                  {linkForm}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {viewToggle}
          {shareBtn}
          {deleteBtn}
        </div>
      </div>

      {viewMode === 'kanban' && (
        // items-center: '필터' 라벨과 팀 칩의 세로 중심을 맞춘다(칩에 테두리가 있어 라벨이 떠 보였다)
        <div className="hidden md:flex flex-row justify-between items-center gap-3 mb-3 shrink-0">
          <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 min-w-0 flex-1 scrollbar-hide x-scroll-lock">
            <span className="text-[11px] font-medium text-fg-faint mr-1 shrink-0 leading-none">필터</span>
            {Object.entries(CONFIG.TEAMS).map(([team, colorClass]) => {
              const selected = selectedTeams.includes(team);
              return (
                <button key={team} onClick={() => toggleTeam(team)} className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-xs text-[11px] font-semibold border whitespace-nowrap leading-none h-[26px] transition-all active:scale-95 ${selected ? colorClass + ' border-transparent' : 'bg-surface/70 text-fg-muted border-line hover:bg-surface'}`}>
                  {selected && <Check size={11} className="shrink-0" />}{team}
                </button>
              );
            })}
          </div>
          <NewTaskButton onClick={onNewTask} className="hidden md:inline-flex" />
        </div>
      )}
      <div className="flex-1 min-h-0">
        {viewMode === 'kanban' ? <Board tasks={filteredTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} /> : <CalendarBoard tasks={projectTasks} onTaskClick={onTaskClick} />}
      </div>
    </div>
  );
});

export const MyTasksView = React.memo(function MyTasksView({ onTaskClick, onStatusChange }) {
  const currentUser = useStore(selectCurrentUser);
  const myTasks = useStore(selectMyTasks);
  return (
    <div className="h-full flex flex-col animate-in fade-in">
      {/* 모바일은 상단바에 같은 제목이 있으니 여기서는 숨긴다.
          아이콘 타일은 뺐다 — 다른 화면 제목은 다 글자만인데 여기만 분홍 상자가 붙어 톤이 어긋났다 */}
      <div className="mb-3 shrink-0 hidden md:flex items-baseline gap-2.5">
        <h2 className="text-2xl font-extrabold text-fg tracking-[-0.7px]">{currentUser.name}님의 업무</h2>
        <p className="text-xs text-fg-muted">할당된 모든 프로젝트의 업무가 모입니다</p>
      </div>
      <div className="flex-1 min-h-0"><Board tasks={myTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} showProjectBadge /></div>
    </div>
  );
});

export const TeamView = React.memo(function TeamView({ teamName, onTaskClick, onStatusChange }) {
  const tasksList = useStore(selectTasksList);
  const teamTasks = useMemo(() => tasksList.filter(t => t.teams.includes(teamName)), [tasksList, teamName]);
  return (
    <div className="h-full flex flex-col animate-in fade-in">
      <div className="mb-3 shrink-0 hidden md:flex items-baseline gap-2.5"><h2 className="text-2xl font-extrabold text-fg tracking-[-0.7px]">{teamName}</h2><span className={`text-[11px] font-bold tracking-[0.03em] ${CONFIG.TEAM_FG[teamName] || 'text-fg-muted'}`}>팀 보드</span></div>
      <div className="flex-1 min-h-0"><Board tasks={teamTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} showProjectBadge /></div>
    </div>
  );
});
