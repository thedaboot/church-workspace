import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  LayoutDashboard, Plus, Calendar as CalendarIcon,
  ExternalLink, ChevronRight, Check, X, Trash2, Pencil, MoreHorizontal
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { CONFIG, teamColor, teamBgColor } from '../config.js';
import { generateId } from '../utils.js';
import { store, useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsMap, selectProjectsList, selectMyTasks,
  selectDashboardStats, selectTasksList
} from '../store/selectors.js';
import {
  ISO_TODAY, daysLeft, groupByDue, KpiCell, Bar, StatusSegments,
  DueGroupList, TeamLeftGrid, SectionHead, Card, STATUS_DOT_VAR,
} from './dashboardParts.jsx';
import { Board, CalendarBoard } from '../components/boards.jsx';
import { useAuth } from '../services/auth.jsx';
import * as cloudSync from '../services/cloudSync.js';
import { ShareButton } from '../components/ShareButton.jsx';
import { ConfirmPopover, useAnchoredPos } from '../components/ConfirmPopover.jsx';
import { showToast } from '../components/Toast.jsx';

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================

// ── 전체 대시보드 ─────────────────────────────────────────────────────────
// "얼마나 진행됐나"가 아니라 "지금 뭘 해야 하나"를 먼저 보여준다.
// 마감 기준으로 묶은 목록이 주인공이고, 그 자리에서 완료 처리까지 한다.
const DASH_FILTERS = ['전체', '내 업무', '내 팀'];

export const DashboardView = React.memo(function DashboardView({ onNavigate, onTaskClick, onStatusChange }) {
  const { teamStats } = useStore(selectDashboardStats);
  const currentUser = useStore(selectCurrentUser);
  const tasksList = useStore(selectTasksList);
  const projectsMap = useStore(selectProjectsMap);
  const projectsList = useStore(selectProjectsList);
  const [filter, setFilter] = useState('전체');
  const today = ISO_TODAY();

  // 소속 팀이 여럿이면 전부 합친다(대표 팀 하나만 보면 겸직한 사람 업무가 빠진다)
  const myTeams = currentUser.teams?.length ? currentUser.teams : [currentUser.team].filter(Boolean);
  const myName = currentUser.name;

  const open = useMemo(() => tasksList.filter(t => t.status !== '완료'), [tasksList]);
  const mine = useMemo(() => open.filter(t => (t.assignees || []).includes(myName)), [open, myName]);
  const teamOpen = useMemo(() => open.filter(t => (t.teams || []).some(x => myTeams.includes(x))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, myTeams.join(',')]);
  const shown = filter === '내 업무' ? mine : filter === '내 팀' ? teamOpen : open;

  const overdueCount = shown.filter(t => t.dueDate && t.dueDate < today).length;
  const todayCount = shown.filter(t => t.dueDate === today).length;
  const weekCount = shown.filter(t => t.dueDate && t.dueDate > today && daysLeft(t.dueDate, today) <= 6).length;
  const groups = useMemo(() => groupByDue(shown, today), [shown, today]);

  const doneAll = tasksList.length - open.length;
  const progress = tasksList.length ? Math.round((doneAll / tasksList.length) * 100) : 0;

  // 프로젝트별 상태 분포 — 4색 세그먼트 바
  const projectStats = useMemo(() => projectsList.map(p => {
    const list = tasksList.filter(t => t.projectId === p.id);
    const counts = {};
    CONFIG.STATUSES.forEach(s => { counts[s] = list.filter(t => t.status === s).length; });
    const dues = list.filter(t => t.dueDate && t.status !== '완료').map(t => t.dueDate).sort();
    const nearest = dues[0];
    const dd = nearest ? daysLeft(nearest, today) : null;
    return {
      ...p, counts, total: list.length,
      dueLabel: nearest ? (dd < 0 ? `${-dd}일 지남` : dd === 0 ? '오늘 마감' : `D-${dd}`) : '마감 없음',
      urgent: dd !== null && dd <= 2,
      summary: CONFIG.STATUSES.map(s => `${s === '시작 전' ? '시작 전' : s} ${counts[s]}`).join(' · '),
    };
  }), [projectsList, tasksList, today]);

  const greeting = overdueCount ? `${myName}님, 밀린 것부터 정리해요` : `${myName}님, 오늘 할 일만 남았어요`;
  const headline = overdueCount ? `지난 마감 ${overdueCount}건이 아직 열려 있어요`
    : todayCount ? `오늘 마감 ${todayCount}건만 정리하면 돼요` : '지난 마감 없이 잘 굴러가고 있어요';
  const todayText = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  const counts = { '전체': open.length, '내 업무': mine.length, '내 팀': teamOpen.length };

  const complete = (t) => onStatusChange(t, '완료');

  return (
    <div className="dc-screen pb-6">
      {/* 인사말 + 전체/내 업무/내 팀 세그먼트 */}
      <div className="flex items-end justify-between gap-5 flex-wrap pb-3.5">
        <div className="min-w-0">
          <h2 className="text-[19px] md:text-[23px] font-extrabold text-fg mb-[3px]" style={{ letterSpacing: '-0.7px' }}>{greeting}</h2>
          <p className="text-[12.5px] text-fg-muted">{todayText} 기준 · {headline}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0 p-[3px] rounded-lg" style={{ background: 'var(--app-surface-hover)' }}>
          {DASH_FILTERS.map(f => (
            <button
              key={f} onClick={() => setFilter(f)}
              className="dc-press px-3 py-1.5 rounded-[5px] text-[12.5px] font-semibold transition-colors"
              style={{
                background: filter === f ? 'var(--app-surface)' : 'transparent',
                color: filter === f ? 'var(--app-ink)' : 'var(--app-ink-muted)',
              }}
            >
              {f} {counts[f]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI — 좌 3칸(1px 격자) + 우 진척도. 아래 본문 2열과 경계가 정확히 맞는다 */}
      <div className="grid gap-x-8 gap-y-3 items-stretch dash-grid">
        <div className="grid grid-cols-3 rounded-[10px] overflow-hidden shadow-soft"
          style={{ gap: 1, background: 'var(--app-line)', border: '1px solid var(--app-line)' }}>
          <KpiCell
            label="지연" value={overdueCount} note={overdueCount ? '마감이 지난 업무' : '없어요'} delay={0}
            dot="var(--app-tag-red-fg)" bar="var(--p-red)" alert={overdueCount > 0}
            ratio={shown.length ? overdueCount / shown.length : 0}
          />
          <KpiCell
            label="오늘 마감" value={todayCount} note={`열린 업무 ${shown.length}건 중`} delay={40}
            dot="var(--app-accent)" bar="var(--p-blue)" ratio={shown.length ? todayCount / shown.length : 0}
          />
          <KpiCell
            label="이번 주" value={weekCount} note="오늘 이후 6일" delay={80}
            dot="var(--app-status-hold)" bar="var(--p-yellow)" ratio={shown.length ? weekCount / shown.length : 0}
          />
        </div>
        <Card className="flex flex-col gap-[9px] justify-center px-4 pt-3.5 pb-[13px]">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--app-accent)' }} />
            <span className="text-[11.5px] font-semibold text-fg-muted whitespace-nowrap">전체 진척도</span>
          </div>
          <div className="flex items-baseline gap-[5px]">
            <span className="text-[34px] font-extrabold leading-none tabular-nums text-fg" style={{ letterSpacing: '-1.8px' }}>{progress}%</span>
            <span className="flex-1" />
            <span className="text-[10.5px] text-fg-faint tabular-nums whitespace-nowrap">{doneAll}/{tasksList.length}건</span>
          </div>
          <Bar ratio={tasksList.length ? doneAll / tasksList.length : 0} color="var(--p-blue)" />
        </Card>
      </div>

      {/* 본문 — 좌: 마감 그룹, 우: 프로젝트 진행 + 팀별 남은 업무 */}
      <div className="grid gap-x-8 gap-y-6 pt-5 items-start dash-grid">
        <DueGroupList
          groups={groups} projectsMap={projectsMap} today={today}
          onComplete={complete} onOpen={onTaskClick}
          emptyHint={filter === '전체' ? '새 업무가 들어오면 여기에 쌓여요' : '다른 탭에는 아직 남은 업무가 있어요'}
        />
        <div className="min-w-0 flex flex-col gap-[22px]">
          <Card className="px-4 pt-[15px] pb-[3px]">
            <div className="flex items-baseline justify-between pb-3">
              <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">프로젝트 진행</h3>
              <span className="text-[10.5px] text-fg-faint">완료 · 진행 · 보류 · 시작 전</span>
            </div>
            {projectStats.map(p => (
              <div key={p.id} className="pb-[13px]">
                <div className="flex items-baseline justify-between gap-2.5 pb-1.5">
                  <button onClick={() => onNavigate(p.id)} className="text-[12.5px] font-semibold text-fg truncate text-left hover:text-accent-text transition-colors">{p.title}</button>
                  <span className="text-[11px] font-semibold shrink-0 tabular-nums"
                    style={{ color: p.urgent ? 'var(--app-tag-red-fg)' : 'var(--app-ink-muted)' }}>{p.dueLabel}</span>
                </div>
                <StatusSegments counts={p.counts} total={p.total} />
                <p className="mt-[5px] text-[10.5px] text-fg-faint tabular-nums">{p.summary}</p>
              </div>
            ))}
            {!projectStats.length && <p className="pb-4 text-[11px] text-fg-faint">아직 프로젝트가 없어요</p>}
          </Card>

          <div>
            <SectionHead>팀별 남은 업무</SectionHead>
            <TeamLeftGrid stats={teamStats} onOpenTeam={(name) => onNavigate(`team:${name}`)} />
          </div>
        </div>
      </div>
    </div>
  );
});

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
