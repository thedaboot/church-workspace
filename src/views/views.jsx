import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, ChevronDown, Check, X, Trash2, Pencil } from 'lucide-react';
import { createPortal } from 'react-dom';
import { CONFIG, teamColor, teamBgColor, teamBar } from '../config.js';
import { generateId, avatarColor, groupBy, myScope } from '../utils.js';
import { store, useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsMap, selectActiveProjectsList, selectMyTasks,
  selectDashboardStats, selectTasksList
} from '../store/selectors.js';
import {
  ISO_TODAY, daysLeft, ageDays, groupByDue, KpiCell, Bar, StatusSegments,
  DueGroupList, TeamLeftGrid, PersonLoadGrid, personLoad, SectionHead, Card,
  STATUS_DOT_VAR, STATUS_BAR,
} from './dashboardParts.jsx';
import { Board } from '../components/boards.jsx';
import { CalendarBoard } from '../components/calendar.jsx';
import { useAuth } from '../services/auth.jsx';
import * as cloudSync from '../services/cloudSync.js';
import { ShareButton } from '../components/ShareButton.jsx';
import { LinkIcon } from '../components/linkIcons.jsx';
import { ConfirmPopover, useAnchoredPos } from '../components/ConfirmPopover.jsx';
import { showToast } from '../components/Toast.jsx';

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================

// ── 전체 대시보드 ─────────────────────────────────────────────────────────
// "얼마나 진행됐나"가 아니라 "지금 뭘 해야 하나"를 먼저 보여준다.
// 마감 기준으로 묶은 목록이 주인공이고, 그 자리에서 완료 처리까지 한다.
export const DASH_FILTERS = ['전체', '내 업무', '내 팀'];
export const DASH_FILTER_DEFAULT = DASH_FILTERS[0];

export const DashboardView = React.memo(function DashboardView({ onNavigate, onTaskClick, onStatusChange, filter, setFilter }) {
  const { teamStats } = useStore(selectDashboardStats);
  const currentUser = useStore(selectCurrentUser);
  const tasksList = useStore(selectTasksList);
  const projectsMap = useStore(selectProjectsMap);
  // '프로젝트 진행'은 지금 굴러가는 것만 — 끝나서 보관한 프로젝트가 계속 100%로
  // 남아 있으면 목록만 길어진다(업무는 여전히 세어져 KPI·마감 목록에는 들어간다)
  const projectsList = useStore(selectActiveProjectsList);
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

  // 지난 7일 간 끝낸 건수 — 이 화면은 앞만 보기 때문에 정리한 성과가 바로 사라진다.
  // ponytail: 완료 시각을 따로 저장하지 않으므로 updatedAt을 대신 쓴다. 끝낸 뒤에
  // 그 카드를 또 고치면 날짜가 밀린다 — 정확한 완료 시각이 필요해지면
  // cards.completed_at을 두고 그때 이 줄만 바꾸면 된다.
  const doneRecent = useMemo(
    () => tasksList.filter(t => t.status === '완료' && t.updatedAt && ageDays(t.updatedAt, today) <= 7).length,
    [tasksList, today]);

  // 청년별 남은 업무 — 담당자별 집계. 팀별과 같은 기준(필터와 무관한 전체)으로 센다
  const people = useMemo(() => personLoad(open, today), [open, today]);

  // 프로젝트별 상태 분포 — 4색 세그먼트 바.
  // 프로젝트마다 목록 전체를 다시 훑지 않도록 한 번 묶고(groupBy) 한 번만 센다.
  const tasksByProject = useMemo(() => groupBy(tasksList, t => t.projectId), [tasksList]);
  const projectStats = useMemo(() => projectsList.map(p => {
    const list = tasksByProject.get(p.id) || [];
    const counts = {};
    CONFIG.STATUSES.forEach(s => { counts[s] = 0; });
    let nearest = null;
    for (const t of list) {
      counts[t.status] = (counts[t.status] || 0) + 1;
      if (t.dueDate && t.status !== '완료' && (nearest === null || t.dueDate < nearest)) nearest = t.dueDate;
    }
    const dd = nearest ? daysLeft(nearest, today) : null;
    return {
      ...p, counts, total: list.length,
      dueLabel: nearest ? (dd < 0 ? `${-dd}일 지남` : dd === 0 ? '오늘 마감' : `D-${dd}`) : '마감 미정',
      urgent: dd !== null && dd <= 2,
      summary: CONFIG.STATUSES.map(s => `${s === '시작 전' ? '시작 전' : s} ${counts[s]}`).join(' · '),
    };
  }), [projectsList, tasksByProject, today]);

  // 인사말이 세는 범위는 '내 것 + 담당자 없는 것'이다 — 이유는 utils.myScope 주석에.
  const myOpen = useMemo(() => myScope(open, myName), [open, myName]);
  const myOverdue = myOpen.filter(t => t.dueDate && t.dueDate < today).length;
  const myToday = myOpen.filter(t => t.dueDate === today).length;

  // 지금 상태를 그대로 말한다 — 지연이 0인데 "오늘 할 일만 남았어요"라고 하면
  // 남은 게 없는 날에도 할 일이 있는 것처럼 읽힌다
  const greeting = myOverdue ? `${myName}님, 밀린 업무부터 정리해봐요`
    : myToday ? `${myName}님, 오늘 마감되는 업무만 남았어요`
    : myOpen.length ? `${myName}님, 당장 급한 업무는 없어요`
    : `${myName}님, 남은 업무가 없어요`;
  // 내 지연은 없는데 KPI의 '지연'에는 숫자가 있는 경우가 있다(남의 것). 그때
  // "지연된 업무가 없네요"라고 하면 바로 아래 칸과 어긋나 보이므로 누구 것인지 밝힌다.
  const headline = myOverdue ? `지연된 업무 ${myOverdue}건이 남아 있어요`
    : myToday ? `오늘 마감되는 업무 ${myToday}건만 정리하면 돼요`
    : overdueCount ? '내가 맡은 업무에는 지연이 없네요 :)'
    : '지연된 업무가 없네요 :)';
  const todayText = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  const counts = { '전체': open.length, '내 업무': mine.length, '내 팀': teamOpen.length };

  const complete = (t, next) => onStatusChange(t, next);

  // 데스크톱(3+1)과 모바일(2×2)이 같은 칸을 재사용한다
  const kpiCells = (
    <>
      <KpiCell
        label="지연" value={overdueCount} note={overdueCount ? '마감이 지난 업무' : '전부 기한 내'} delay={0}
        dot="var(--app-tag-red-fg)" bar="var(--p-red)" alert={overdueCount > 0}
        ratio={shown.length ? overdueCount / shown.length : 0}
      />
      <KpiCell
        label="오늘 마감" value={todayCount} note={`남은 업무 ${shown.length}건 중`} delay={40}
        dot="var(--app-accent)" bar="var(--p-blue)" ratio={shown.length ? todayCount / shown.length : 0}
      />
      <KpiCell
        label="이번 주" value={weekCount} note="앞으로 일주일 내" delay={80}
        dot="var(--app-status-hold)" bar="var(--p-yellow)" ratio={shown.length ? weekCount / shown.length : 0}
      />
    </>
  );
  const progressCell = (
    <>
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
    </>
  );

  return (
    <div className="dc-screen pb-6">
      {/* 인사말 + 전체/내 업무/내 팀 세그먼트 */}
      <div className="flex items-end justify-between gap-5 flex-wrap pb-3.5">
        <div className="min-w-0">
          <h2 className="text-[19px] md:text-[23px] font-extrabold text-fg mb-[3px]" style={{ letterSpacing: '-0.7px' }}>{greeting}</h2>
          <p className="text-[12.5px] text-fg-muted">{todayText} 기준 · {headline}</p>
          {/* 0건이면 줄을 아예 두지 않는다 — 없는 것을 굳이 말하지 않는다 */}
          {doneRecent > 0 && (
            <p className="text-[12.5px] mt-[2px] tabular-nums" style={{ color: 'var(--app-tag-green-fg)' }}>
              지난 7일 간 {doneRecent}건 끝냈어요
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 p-[3px] rounded-[8px]" style={{ background: 'var(--app-surface-hover)' }}>
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

      {/* KPI — 데스크톱은 좌 3칸(1px 격자) + 우 진척도로 아래 본문 2열과 경계가 맞고,
          모바일은 네 칸이 2×2로 접힌다(핸드오프 규격) */}
      <div className="hidden lg:grid gap-x-8 gap-y-3 items-stretch dash-grid">
        <div className="grid grid-cols-3 rounded-[10px] overflow-hidden shadow-soft"
          style={{ gap: 1, background: 'var(--app-line)', border: '1px solid var(--app-line)' }}>
          {kpiCells}
        </div>
        <Card className="flex flex-col gap-[9px] justify-center px-4 pt-3.5 pb-[13px]">{progressCell}</Card>
      </div>
      <div className="grid lg:hidden kpi-grid rounded-[10px] overflow-hidden shadow-soft"
        style={{ gap: 1, background: 'var(--app-line)', border: '1px solid var(--app-line)' }}>
        {kpiCells}
        <div className="flex flex-col gap-[9px] justify-center px-4 pt-3.5 pb-[13px]" style={{ background: 'var(--app-surface)' }}>{progressCell}</div>
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

          <div>
            <SectionHead>청년별 남은 업무</SectionHead>
            <PersonLoadGrid people={people} />
          </div>
        </div>
      </div>
    </div>
  );
});

// 모바일 프로젝트 화면의 접히는 조작은 팀 필터 하나뿐이다(→ TeamFilterBar).
// '⋯' 메뉴와 그 안의 팀 필터 팝오버는 없앴다 — 공유·삭제·참고 링크를 메타 줄에
// 그대로 두는 쪽이 숨겨진 메뉴보다 찾기 쉬웠다.

// NewTaskButton은 지웠다 — 아무도 부르지 않는 죽은 코드였고, 실제 '새 업무' 버튼과
// 다른 스타일(bg-fg 반전)이라 남겨두면 어느 쪽이 기준인지 헷갈린다. 지금 쓰는 것은
// ProjectView 헤더 안의 accent 채움 버튼 하나뿐이다.

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
  const linkPopRef = useRef(null);   // 앵커(헤더 안의 span)
  const linkBodyRef = useRef(null);  // 팝오버 본체 (포털로 body에 나가 있다)
  const linkBtnRef = useRef(null);
  const [linkPos, placeLink] = useAnchoredPos(linkBtnRef, isAddingLink, 256, 150);

  // 리소스 추가 팝오버: 바깥 클릭 / Escape 닫기
  //
  // **팝오버 본체도 '안'으로 세어야 한다.** 본체는 createPortal로 body에 나가 있어서
  // 앵커 span의 자손이 아니다. 앵커만 보면 팝오버 안을 누르는 것이 '바깥'으로 잡히고,
  // mousedown에서 팝오버가 언마운트되니 그 뒤의 click이 사라진 '추가' 버튼에 닿지
  // 않는다 → 참고 링크가 한 건도 저장되지 않았다(URL 칸을 누르는 순간부터 닫혔다).
  // ConfirmPopover가 같은 함정을 이미 이렇게 고쳐 두었다.
  useEffect(() => {
    if (!isAddingLink) return;
    const onDown = (e) => {
      const inside = linkPopRef.current?.contains(e.target) || linkBodyRef.current?.contains(e.target);
      if (!inside) setIsAddingLink(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setIsAddingLink(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [isAddingLink]);

  const toggleTeam = (team) => setSelectedTeams(prev => prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team]);
  const filteredTasks = useMemo(() => selectedTeams.length === 0 ? projectTasks : projectTasks.filter(task => task.teams.some(t => selectedTeams.includes(t))), [projectTasks, selectedTeams]);

  // 없는 프로젝트(잘못된 ?p= 딥링크 / 다른 사람이 방금 삭제)일 때 그냥 null을 돌려주면
  // 내비만 남고 본문이 빈 화면이 됐다. 대시보드로 되돌린다.
  // ponytail: 토스트는 띄우지 않는다 — 직접 삭제한 사람에게도 같이 떠서 "못 찾았다"는
  // 엉뚱한 안내가 된다. 화면이 대시보드로 돌아가는 것으로 충분하다.
  useEffect(() => { if (!project) onNavigate?.('dashboard'); }, [project, onNavigate]);

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

  // 업무가 있는 팀만 칩으로 — 0건 팀을 늘어놓으면 줄만 길어진다
  const teamCounts = {};
  projectTasks.forEach(t => (t.teams || []).forEach(x => { teamCounts[x] = (teamCounts[x] || 0) + 1; }));
  const teamChips = Object.keys(CONFIG.TEAMS).filter(n => teamCounts[n]);
  const doneCount = projectTasks.filter(t => t.status === '완료').length;
  const openDues = projectTasks.filter(t => t.dueDate && t.status !== '완료').map(t => t.dueDate).sort();
  const dd = openDues[0] ? daysLeft(openDues[0], ISO_TODAY()) : null;
  const projectMeta = [
    `${projectTasks.length}건`,
    `완료 ${doneCount}건`,
    dd === null ? '마감 미정' : dd < 0 ? `${-dd}일 지남` : dd === 0 ? '오늘 마감' : `D-${dd}`,
  ].join(' · ');

  const shareBtn = <ShareButton url={`${window.location.origin}/s/p/${project.id}`} what="프로젝트" />;
  const deleteBtn = isAdmin ? (
    <ConfirmPopover message="프로젝트와 안의 모든 업무가 삭제돼요. 되돌릴 수 없어요." onConfirm={deleteProject}>
      <button type="button" className="p-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition active:scale-95 shrink-0" title="프로젝트 삭제"><Trash2 size={16} /></button>
    </ConfirmPopover>
  ) : null;

  return (
    <div className="dc-screen h-full flex flex-col min-w-0">
      {/* ── 헤더: 제목 + 메타(건수·완료·D-day) + 링크 / 우측은 '새 업무'만 ── */}
      {/* 예전에는 이 줄에 flex-wrap이 걸려 있어서, 참고 링크를 하나 달면 메타 줄이
          길어지고 '새 업무'가 아래로 떨어져 혼자 한 줄을 차지했다(모바일에서 특히
          어색했다 — 제목은 상단바에 있으니 왼쪽에 메타 줄만 남는다). 지금은 감싸지
          않고, 좁으면 메타 줄이 가로로 밀린다. */}
      {/* 모바일은 위 줄에 '새 업무'가 붙어야 하므로 items-start(제목이 없으니 첫 줄이
          값 줄이다). 데스크톱은 제목이 위에 있어서 예전처럼 아래(메타 줄)에 맞춘다. */}
      <div className="flex items-start md:items-end justify-between gap-3 md:gap-4 pb-3" style={{ borderBottom: '1px solid var(--app-line)' }}>
        <div className="min-w-0 flex-1">
          {/* 모바일은 상단바에 같은 제목(과 수정 연필)이 이미 있다 — 한 줄을 두 번 쓰지 않는다 */}
          <button onClick={() => onRenameProject?.(project)} className="group/title hidden md:inline-flex items-baseline gap-1.5 mb-[5px] text-left" title="프로젝트 이름 수정">
            <span className="text-[19px] md:text-[23px] font-extrabold text-fg" style={{ letterSpacing: '-0.7px' }}>{project.title}</span>
            <Pencil size={12} className="text-fg-faint md:opacity-0 md:group-hover/title:opacity-100 transition-opacity shrink-0" />
          </button>
          {/* 개수가 변하는 것(참고 링크)과 하나로 고정된 것(공유·삭제)을 같은 스크롤 칸에
              두면, 링크가 늘 때마다 삭제가 화면 밖으로 밀려난다. 밀어야 나오는 삭제는
              '기능을 숨기지 않는다'(§7)를 가로 스크롤로 어기는 것이다.
              그래서 링크는 미는 칸 **안**, 공유·삭제는 그 칸 **밖**에 둔다.
              모바일은 두 줄(값+새 업무 / 링크+액션), 데스크톱은 md:contents로 감싸개를
              지워서 예전처럼 한 줄로 흐른다. */}
          <div className="flex flex-col gap-[6px] md:flex-row md:items-center md:gap-[7px]">
            {/* min-h는 '새 업무' 버튼 높이 — 모바일에서 값 줄이 버튼 가운데에 맞게 */}
            <div className="flex items-center gap-2.5 min-w-0 min-h-[34px] md:min-h-0 md:gap-[7px] md:flex-none">
              <span className="text-[11px] text-fg-muted tabular-nums whitespace-nowrap">{projectMeta}</span>
              {/* 값만 있는 줄이 비어 보여서 진척 바로 채운다 — 대시보드가 쓰는 부품 그대로 */}
              <span className="flex-1 max-w-[130px] md:w-14 md:flex-none">
                <Bar ratio={projectTasks.length ? doneCount / projectTasks.length : 0} color="var(--p-blue)" height={3} />
              </span>
            </div>
            <div className="flex items-center gap-2 min-w-0 md:contents">
          <div className="flex items-center gap-[7px] flex-nowrap min-w-0 flex-1 overflow-x-auto scrollbar-hide x-scroll-lock md:flex-none md:flex-wrap md:overflow-x-visible">
            {project.pinnedLinks?.map(l => (
              <span key={l.id} className="group/link inline-flex items-center gap-1 shrink-0">
                {/* 아는 서비스면 이름 앞에 글자만 한 표시가 붙는다(linkIcons.jsx) */}
                {/* gap은 공백 한 칸만큼(11px 글자에서 5px) — 3px로 붙였더니 표시가
                    글자에 눌어붙어 보였다 */}
                <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-[5px] text-[11px] font-semibold text-accent-text hover:underline whitespace-nowrap">
                  <LinkIcon url={l.url} />{l.title}
                </a>
                <button onClick={() => removeLink(l.id)} className="md:opacity-0 md:group-hover/link:opacity-100 transition-opacity text-fg-faint shrink-0" title="링크 삭제"><X size={10} /></button>
              </span>
            ))}
            <span className="inline-flex shrink-0" ref={linkPopRef}>
              <span ref={linkBtnRef} className="inline-flex">
                {/* 열기 전에 위치를 먼저 잡는다 — 안 그러면 첫 프레임이 {0,0}에 그려진다 */}
                <button onClick={() => { placeLink(); setIsAddingLink(v => !v); }}
                  className="text-[11px] text-fg-faint px-1.5 py-px rounded-[4px] transition-colors hover:text-fg-muted"
                  style={{ border: '1px dashed var(--app-line)' }}>+ 참고 링크</button>
              </span>
              {isAddingLink && createPortal(
                <div ref={linkBodyRef} style={{ position: 'fixed', left: linkPos.left, top: linkPos.top, width: 256 }} className="dc-pop bg-surface border border-line rounded-lg shadow-elevated p-3 z-[90]">
                  {linkForm}
                </div>, document.body)}
            </span>
          </div>
              {/* 스크롤 칸 밖. 링크가 몇 개든 제자리다. 왼쪽 실선이 "여기가 끝"을 알려
                  준다 — 미는 줄에서 끝을 못 보면 뭐가 더 있는지 짐작할 수 없다. */}
              <span className="inline-flex items-center gap-0.5 shrink-0 pl-1.5 border-l border-line md:border-l-0 md:pl-0 md:ml-1">{shareBtn}{deleteBtn}</span>
            </div>
          </div>
        </div>
        <button onClick={onNewTask}
          className="dc-press inline-flex items-center gap-1.5 pl-[11px] pr-3.5 py-[7px] rounded-[8px] text-[12.5px] font-bold text-white whitespace-nowrap shrink-0 hover:brightness-[1.07] transition-[filter]"
          style={{ background: 'var(--app-accent)', boxShadow: '0 1px 2px rgba(25,23,32,.18), inset 0 1px 0 rgba(255,255,255,.22)' }}>
          <Plus size={13} className="shrink-0 [stroke-width:2.2px]" />새 업무
        </button>
      </div>

      {/* ── 필터 줄: 보기 전환 + 팀 칩(데스크톱) / 한 줄 필터 버튼(모바일) ── */}
      <div className="flex items-center gap-2.5 py-[11px] flex-wrap shrink-0">
        <span className="flex p-[3px] rounded-[8px] shrink-0" style={{ background: 'var(--app-surface-hover)' }}>
          {[['kanban', '보드'], ['calendar', '캘린더']].map(([v, label]) => (
            <button key={v} onClick={() => setViewMode(v)}
              className="px-3 py-[5px] rounded-[5px] text-[12.5px] font-semibold transition-colors"
              style={{
                background: viewMode === v ? 'var(--app-surface)' : 'transparent',
                color: viewMode === v ? 'var(--app-ink)' : 'var(--app-ink-muted)',
              }}>{label}</button>
          ))}
        </span>

        {/* 데스크톱: 전체 칩 + 업무가 있는 팀만 */}
        <span className="hidden md:block w-px h-5 shrink-0" style={{ background: 'var(--app-line)' }} />
        <div className="hidden md:flex flex-wrap items-center gap-1.5 min-w-0">
          <button onClick={() => setSelectedTeams([])}
            className="px-[11px] py-[5px] rounded-full text-[11.5px] whitespace-nowrap transition-colors"
            style={{
              background: selectedTeams.length ? 'var(--app-surface-hover)' : 'var(--app-ink)',
              color: selectedTeams.length ? 'var(--app-ink-muted)' : 'var(--app-canvas)',
              fontWeight: selectedTeams.length ? 500 : 700,
            }}>전체 {projectTasks.length}</button>
          {teamChips.map(name => {
            const on = selectedTeams.includes(name);
            return (
              <button key={name} onClick={() => toggleTeam(name)}
                className="inline-flex items-center gap-1.5 pl-[9px] pr-[11px] py-[5px] rounded-full text-[11.5px] whitespace-nowrap transition-colors"
                style={{
                  background: on ? teamBgColor(name) : 'var(--app-surface-hover)',
                  color: on ? teamColor(name) : 'var(--app-ink-muted)',
                  fontWeight: on ? 700 : 500,
                }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: teamColor(name) }} />
                {name}
                <span className="text-[10.5px] tabular-nums" style={{ color: on ? teamColor(name) : 'var(--app-ink-faint)' }}>{teamCounts[name]}</span>
              </button>
            );
          })}
        </div>

        {/* 모바일: 한 줄 필터 버튼 → 오버레이 카드 */}
        <TeamFilterBar
          className="md:hidden"
          teams={teamChips} counts={teamCounts} total={projectTasks.length}
          shownCount={filteredTasks.length} selected={selectedTeams}
          onToggle={toggleTeam} onClear={() => setSelectedTeams([])}
        />
      </div>

      <div className="flex-1 min-h-0">
        {viewMode === 'kanban'
          ? <Board tasks={filteredTasks} onStatusChange={onStatusChange} onTaskClick={onTaskClick} />
          : <CalendarBoard tasks={filteredTasks} onTaskClick={onTaskClick} />}
      </div>
    </div>
  );
});

// ── 전체 일정 ─────────────────────────────────────────────────────────────
// 캘린더가 프로젝트 안에만 있어서, 한 주일에 여러 팀·여러 프로젝트 업무가 겹치는 것을
// 보려면 프로젝트를 하나씩 들어가야 했다. 여기서는 워크스페이스 전체를 한 판에 본다.
// 보관한 프로젝트의 업무도 나온다 — 지난 일정도 달력에서는 보여야 한다.
//
// 팀 필터는 TeamFilterBar 하나로 두 폭 모두 처리한다. 프로젝트 화면처럼 데스크톱용
// 칩 줄을 따로 두지 않는 이유: 전체 일정은 팀이 일곱 개 다 나올 수 있어서 칩 줄이
// 길고, 이 화면의 주인공은 달력이지 필터가 아니다.
export const ScheduleView = React.memo(function ScheduleView({ onTaskClick }) {
  const tasksList = useStore(selectTasksList);
  const projectsMap = useStore(selectProjectsMap);
  const [selectedTeams, setSelectedTeams] = useState([]);

  const teamCounts = {};
  tasksList.forEach(t => (t.teams || []).forEach(x => { teamCounts[x] = (teamCounts[x] || 0) + 1; }));
  const teamChips = Object.keys(CONFIG.TEAMS).filter(n => teamCounts[n]);

  const toggleTeam = (team) => setSelectedTeams(prev => prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team]);
  const shown = useMemo(
    () => (selectedTeams.length ? tasksList.filter(t => (t.teams || []).some(x => selectedTeams.includes(x))) : tasksList),
    [tasksList, selectedTeams]);

  // 달력에 실제로 얹히는 것은 날짜가 있는 업무뿐 — 머리글 숫자도 그 기준으로 센다.
  // 전체 건수를 쓰면 "84건"이라 해놓고 달력에는 12개만 보이는 화면이 된다.
  const dated = shown.filter(t => t.startDate || t.dueDate);
  const projectCount = new Set(dated.map(t => t.projectId).filter(id => projectsMap[id])).size;

  return (
    <div className="dc-screen h-full flex flex-col min-w-0">
      <div className="flex items-end justify-between gap-4 flex-wrap pb-3" style={{ borderBottom: '1px solid var(--app-line)' }}>
        <div className="min-w-0">
          <h2 className="hidden md:block text-[23px] font-extrabold text-fg mb-[3px]" style={{ letterSpacing: '-0.7px' }}>전체 일정</h2>
          <p className="text-[11px] text-fg-muted tabular-nums">
            {dated.length}건이 달력에 있어요 · {projectCount}개 프로젝트
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 py-[11px] shrink-0">
        <TeamFilterBar
          teams={teamChips} counts={teamCounts} total={tasksList.length}
          shownCount={shown.length} selected={selectedTeams}
          onToggle={toggleTeam} onClear={() => setSelectedTeams([])}
        />
      </div>

      <div className="flex-1 min-h-0">
        <CalendarBoard tasks={shown} onTaskClick={onTaskClick} />
      </div>
    </div>
  );
});

// 모바일 팀 필터 — 칩을 나열하지 않고 한 줄 버튼으로 접고, 누르면 오버레이 카드가 열린다.
// 오버레이라 아래 콘텐츠를 밀지 않는다(핸드오프: position:absolute; z-index:20).
function TeamFilterBar({ teams, counts, total, shownCount, selected, onToggle, onClear, className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const label = selected.length
    ? `${selected[0]}${selected.length > 1 ? ` 외 ${selected.length - 1}` : ''} · ${shownCount}건`
    : `전체 팀 · ${total}건`;

  return (
    <span ref={rootRef} className={`flex-1 min-w-0 relative ${className}`}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-[7px] pl-[11px] pr-2.5 py-[7px] rounded-full text-xs font-semibold text-fg"
        style={{ background: 'var(--app-surface)', border: `1px solid ${selected.length ? 'var(--app-accent)' : 'var(--app-line)'}` }}>
        <SlidersIcon />
        <span className="flex-1 min-w-0 text-left truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0 text-fg-faint transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <span className="block relative h-0 z-20">
          <span className="dc-pop block absolute left-0 right-0 p-1.5 rounded-[10px]" style={{
            top: -4, transformOrigin: 'top center',
            background: 'var(--app-surface)', border: '1px solid var(--app-line)',
            boxShadow: '0 10px 28px rgba(0,0,0,.14)',
          }}>
            <button onClick={() => { onClear(); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-[7px] text-[13px] text-fg text-left"
              style={{ background: selected.length ? 'transparent' : 'var(--app-surface-hover)', fontWeight: selected.length ? 500 : 700 }}>
              <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: 'var(--app-ink)' }} />
              <span className="flex-1">전체 팀</span>
              <span className="text-[11.5px] text-fg-faint tabular-nums">{total}</span>
            </button>
            {teams.map(name => {
              const on = selected.includes(name);
              return (
                <button key={name} onClick={() => onToggle(name)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-[7px] text-[13px] text-left"
                  style={{ background: on ? teamBgColor(name) : 'transparent', color: on ? teamColor(name) : 'var(--app-ink)', fontWeight: on ? 700 : 500 }}>
                  <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: teamColor(name) }} />
                  <span className="flex-1 truncate">{name}</span>
                  <span className="text-[11.5px] text-fg-faint tabular-nums">{counts[name]}</span>
                  {on && <Check size={13} className="shrink-0 [stroke-width:2.4px]" style={{ color: teamColor(name) }} />}
                </button>
              );
            })}
          </span>
        </span>
      )}
    </span>
  );
}

// 필터 줄 아이콘 (핸드오프의 인라인 SVG를 그대로)
function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--app-ink-muted)" strokeWidth="1.6" strokeLinecap="round" className="w-3.5 h-3.5 shrink-0">
      <path d="M3 5h18M6 12h12M10 19h4" />
    </svg>
  );
}

// ── 내 업무 ───────────────────────────────────────────────────────────────
// 상태 칩은 다중 선택. 아무것도 고르지 않으면 미완료 전체를 보여준다.
export const MyTasksView = React.memo(function MyTasksView({ onTaskClick, onStatusChange, onNavigate }) {
  const currentUser = useStore(selectCurrentUser);
  const myTasks = useStore(selectMyTasks);
  const projectsMap = useStore(selectProjectsMap);
  const [statusFilter, setStatusFilter] = useState([]);
  const today = ISO_TODAY();

  const toggle = (s) => setStatusFilter(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
  const shown = statusFilter.length
    ? myTasks.filter(t => statusFilter.includes(t.status))
    : myTasks.filter(t => t.status !== '완료');
  const groups = useMemo(() => groupByDue(shown, today), [shown, today]);

  const openCount = myTasks.filter(t => t.status !== '완료').length;
  const lateCount = myTasks.filter(t => t.status !== '완료' && t.dueDate && t.dueDate < today).length;

  // 내가 맡은 프로젝트별 진행 (프로젝트마다 다시 filter하지 않고 한 번 묶는다)
  const myProjects = useMemo(() => [...groupBy(myTasks, t => t.projectId).entries()].map(([id, list]) => ({
    id,
    title: projectsMap[id]?.title || '프로젝트 없음',
    done: list.reduce((n, t) => n + (t.status === '완료' ? 1 : 0), 0),
    total: list.length,
  })), [myTasks, projectsMap]);

  return (
    <div className="dc-screen pb-6">
      <div className="flex items-end justify-between gap-4 flex-wrap pb-3.5">
        {/* 모바일은 상단바에 같은 제목이 있으니 여기서는 숨긴다 */}
        <div className="min-w-0 hidden md:block">
          <h2 className="text-[23px] font-extrabold text-fg mb-[3px]" style={{ letterSpacing: '-0.7px' }}>{currentUser.name}님의 업무</h2>
          <p className="text-[12.5px] text-fg-muted tabular-nums">{openCount}건 남음{lateCount ? ` · 지난 마감 ${lateCount}건` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {CONFIG.STATUSES.map(s => {
            const on = statusFilter.includes(s);
            return (
              <button key={s} onClick={() => toggle(s)}
                className="inline-flex items-center gap-1.5 pl-[9px] pr-[11px] py-[5px] rounded-full text-[11.5px] transition-colors"
                style={{
                  background: on ? CONFIG.STATUS_BG_VAR[s] : 'var(--app-surface-hover)',
                  color: on ? CONFIG.STATUS_FG_VAR[s] : 'var(--app-ink-muted)',
                  fontWeight: on ? 700 : 500,
                }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT_VAR[s] }} />{s}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-x-7 gap-y-6 items-start side-grid">
        <DueGroupList
          groups={groups} projectsMap={projectsMap} today={today} showTeam={false}
          onComplete={(t, next) => onStatusChange(t, next)} onOpen={onTaskClick}
          emptyHint={statusFilter.length ? '고른 상태에 해당하는 업무가 없어요' : '새로 맡은 일이 생기면 여기에 쌓여요'}
        />
        <div className="min-w-0">
          <SectionHead>내가 맡은 프로젝트</SectionHead>
          <div className="flex flex-col gap-3">
            {myProjects.map(p => (
              <button key={p.id} onClick={() => onNavigate?.(p.id)} className="min-w-0 text-left hover:opacity-60 transition-opacity">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-fg truncate">{p.title}</span>
                  <span className="text-[11px] font-semibold text-fg-muted tabular-nums shrink-0">{p.done}/{p.total}건</span>
                </span>
                <span className="block mt-[5px]"><Bar ratio={p.total ? p.done / p.total : 0} color="var(--p-blue)" /></span>
              </button>
            ))}
            {!myProjects.length && <p className="text-[11px] text-fg-faint">아직 맡은 업무가 없어요</p>}
          </div>
        </div>
      </div>
    </div>
  );
});

// ── 팀 보드 ───────────────────────────────────────────────────────────────
export const TeamView = React.memo(function TeamView({ teamName, onTaskClick, onStatusChange, onNavigate }) {
  const tasksList = useStore(selectTasksList);
  const projectsMap = useStore(selectProjectsMap);
  const today = ISO_TODAY();
  const teamTasks = useMemo(() => tasksList.filter(t => (t.teams || []).includes(teamName)), [tasksList, teamName]);
  const openTasks = teamTasks.filter(t => t.status !== '완료');

  // 상태별 건수 — 상태마다 다시 filter하지 않고 한 번만 센다
  const counts = useMemo(() => {
    const c = {};
    CONFIG.STATUSES.forEach(s => { c[s] = 0; });
    for (const t of teamTasks) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [teamTasks]);

  // 멤버 칩 — 이 팀 업무의 담당자별 남은 건수
  const members = useMemo(() => {
    const m = new Map();
    openTasks.forEach(t => (t.assignees || []).forEach(a => m.set(a, (m.get(a) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, left]) => ({ name, left }));
  }, [openTasks]);

  const teamProjects = useMemo(() => [...groupBy(teamTasks, t => t.projectId).entries()].map(([id, list]) => ({
    id,
    title: projectsMap[id]?.title || '프로젝트 없음',
    done: list.reduce((n, t) => n + (t.status === '완료' ? 1 : 0), 0),
    total: list.length,
  })), [teamTasks, projectsMap]);

  const groups = useMemo(() => groupByDue(openTasks, today), [openTasks, today]);

  return (
    <div className="dc-screen pb-6">
      <div className="flex items-end justify-between gap-4 flex-wrap pb-3.5">
        <div className="min-w-0">
          <h2 className="text-[19px] md:text-[23px] font-extrabold text-fg mb-[3px] flex items-center gap-2" style={{ letterSpacing: '-0.7px' }}>
            <span className="w-[9px] h-[9px] rounded-[2px] shrink-0" style={{ background: teamColor(teamName) }} />
            {teamName}
          </h2>
          <p className="text-[12.5px] text-fg-muted tabular-nums">{openTasks.length}건 남음 · {teamProjects.length}개 프로젝트 참여</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {members.slice(0, 5).map(m => (
            <span key={m.name} className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full"
              style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${avatarColor(m.name)}`}>{m.name[0]}</span>
              <span className="text-[11.5px] font-semibold text-fg">{m.name}</span>
              <span className="text-[11px] text-fg-faint tabular-nums">{m.left}</span>
            </span>
          ))}
          {!members.length && <span className="text-[11.5px] text-fg-faint">남은 업무를 맡은 사람이 없어요</span>}
        </div>
      </div>

      {/* 상태 4칸 — 대시보드 KPI와 같은 규격. 시작 전·진행 중·보류 중 3칸(좌) + 완료(우) */}
      <div className="grid gap-x-7 gap-y-3 items-stretch side-grid">
        <div className="grid grid-cols-3 rounded-[10px] overflow-hidden shadow-soft"
          style={{ gap: 1, background: 'var(--app-line)', border: '1px solid var(--app-line)' }}>
          {['시작 전', '진행 중', '보류 중'].map((s, i) => (
            <KpiCell key={s} label={s} value={counts[s]} note="" delay={i * 40}
              dot={STATUS_DOT_VAR[s]} bar={STATUS_BAR[s]} ratio={teamTasks.length ? counts[s] / teamTasks.length : 0} />
          ))}
        </div>
        <div className="rounded-[10px] shadow-soft flex flex-col gap-[9px] justify-center px-4 pt-3.5 pb-[13px]"
          style={{ background: 'var(--app-tag-green)', border: '1px solid var(--app-line)' }}>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--app-tag-green-fg)' }} />
            <span className="text-[11.5px] font-semibold whitespace-nowrap" style={{ color: 'var(--app-tag-green-fg)' }}>완료</span>
          </div>
          <div className="flex items-baseline gap-[5px]">
            <span className="text-[34px] font-extrabold leading-none tabular-nums" style={{ letterSpacing: '-1.8px', color: 'var(--app-tag-green-fg)' }}>{counts['완료']}</span>
            <span className="text-xs font-semibold" style={{ color: 'var(--app-tag-green-fg)' }}>건</span>
            <span className="flex-1" />
            <span className="text-[10.5px] tabular-nums whitespace-nowrap" style={{ color: 'var(--app-tag-green-fg)', opacity: .7 }}>전체 {teamTasks.length}건 중</span>
          </div>
          <Bar ratio={teamTasks.length ? counts['완료'] / teamTasks.length : 0} color="var(--p-green)" />
        </div>
      </div>

      <div className="grid gap-x-7 gap-y-6 pt-[22px] items-start side-grid">
        <DueGroupList
          groups={groups} projectsMap={projectsMap} today={today}
          onComplete={(t, next) => onStatusChange(t, next)} onOpen={onTaskClick}
          emptyHint="이 팀이 맡은 일은 다 끝났어요"
        />
        <div className="min-w-0">
          <SectionHead>참여 프로젝트</SectionHead>
          <div className="flex flex-col gap-3">
            {teamProjects.map(p => (
              <button key={p.id} onClick={() => onNavigate?.(p.id)} className="min-w-0 text-left hover:opacity-60 transition-opacity">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-fg truncate">{p.title}</span>
                  <span className="text-[11px] font-semibold text-fg-muted tabular-nums shrink-0">{p.done}/{p.total}건</span>
                </span>
                <span className="block mt-[5px]"><Bar ratio={p.total ? p.done / p.total : 0} color={teamBar(teamName)} /></span>
              </button>
            ))}
            {!teamProjects.length && <p className="text-[11px] text-fg-faint">아직 참여한 프로젝트가 없어요</p>}
          </div>
        </div>
      </div>
    </div>
  );
});
