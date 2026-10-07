import React, { useState, useMemo } from 'react';
import { CONFIG, teamColor, teamBar } from '../config.js';
import { groupBy, projectsOfYear, datedTasks, teamChips as teamMemberChips, completedTime } from '../utils.js';
import { isDone, isOpen, isOngoing, isOverdue, progressOf, isRecentlyDone } from '../services/taskCounts.js';
import { useProjectYear } from '../hooks/useProjectYear.js';
import { Avatar } from '../components/Avatar.jsx';
import { useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsMap, selectActiveProjectsList, selectMyTasks,
  selectTasksList, selectMembers,
} from '../store/selectors.js';
import {
  ISO_TODAY, groupByDue, KpiCell, KPI_SOLO, Bar, DueGroupList, SectionHead,
  STATUS_DOT_VAR, STATUS_BAR,
} from './dashboardParts.jsx';
import { CalendarBoard } from '../components/calendar.jsx';
import { teamCountsOf, teamChipsOf, TEAM_CHIP_ROW, TeamFilterBar } from './viewParts.jsx';

// 대시보드와 프로젝트 화면은 제 파일로 갈랐다(2026-10-07 19차) — App이 이 파일 하나에서 가져가므로 이어서 내보낸다.
export { DashboardView, DASH_FILTERS, DASH_FILTER_DEFAULT } from './dashboardView.jsx';
export { ProjectView } from './projectView.jsx';

// ============================================================================
// 11. UI Views (데이터를 구독하는 프레젠테이션 컴포넌트)
// ============================================================================
// 이 파일: 전체 일정 · 내 업무 · 팀 보드. 대시보드 → dashboardView.jsx · 프로젝트 → projectView.jsx ·
// 화면끼리 같이 쓰는 셈과 팀 필터 → viewParts.jsx.

// 업무 목록 → 프로젝트별 진척. '내 업무'와 팀 보드의 옆 칸이 같은 셈을 쓴다.
// **고른 해의 보관 안 한 프로젝트만**(ids) — 대시보드 '프로젝트 진행'과 같은 기준이다(2026-09-25 셈 감사).
// 예전에는 모든 해·보관 프로젝트가 섞여 이 칸만 해마다 길어졌다(대시보드가 2026-08-29에 고친 그 증상).
// 진척은 taskCounts.progressOf — 상시는 끝나지 않는 일이라 분모에서 빠지고, 상시만 있는 프로젝트는 줄이 없다.
const progressByProject = (list, projectsMap, ids) => [...groupBy(list, t => t.projectId).entries()]
  .filter(([id]) => ids.has(id))
  .map(([id, rows]) => ({ id, title: projectsMap[id]?.title || '프로젝트 미지정', ...progressOf(rows) }))
  .filter(p => p.total > 0);

// 고른 해의 보관 안 한 프로젝트 id — 대시보드 '프로젝트 진행'·연결 지도·팀별/청년별과 내 업무·팀 보드의
// 프로젝트 칸이 같은 값을 본다(useProjectYear 모듈 스토어 하나).
function useYearProjectIds() {
  const [year] = useProjectYear();
  const activeProjects = useStore(selectActiveProjectsList);
  return useMemo(() => new Set(projectsOfYear(activeProjects, year).map(p => p.id)), [activeProjects, year]);
}

// 그 결과를 그리는 옆 칸. 제목·막대 색·빈 줄 문구만 화면마다 다르다.
function ProjectProgressList({ title, items, color, empty, onNavigate }) {
  return (
    <div className="min-w-0">
      <SectionHead>{title}</SectionHead>
      <div className="flex flex-col gap-3">
        {items.map(p => (
          <button key={p.id} onClick={() => onNavigate?.(p.id)} className="min-w-0 text-left hover:opacity-60 transition-opacity">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-semibold text-fg truncate">{p.title}</span>
              <span className="text-[11px] font-semibold text-fg-muted tabular-nums shrink-0">{p.done}/{p.total}건</span>
            </span>
            <span className="block mt-[5px]"><Bar ratio={p.total ? p.done / p.total : 0} color={color} /></span>
          </button>
        ))}
        {!items.length && <p className="text-[11px] text-fg-muted">{empty}</p>}
      </div>
    </div>
  );
}

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

  // 이 화면은 통째로 달력이다 — 칩 숫자도 **달력에 얹히는 것만** 센다.
  // 머리글은 이미 그 기준이었는데(`N건이 달력에 있어요`) 칩만 전부를 세고 있어서,
  // 같은 화면에 기준이 다른 숫자가 둘이었다(사용자 지적 2026-08-29).
  const datable = useMemo(() => datedTasks(tasksList), [tasksList]);
  const teamCounts = useMemo(() => teamCountsOf(datable), [datable]);
  const teamChips = useMemo(() => teamChipsOf(teamCounts), [teamCounts]);

  const toggleTeam = (team) => setSelectedTeams(prev => prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team]);
  // 상시는 달력에 얹히지 않는다(ProjectView의 calendarTasks와 같은 이유)
  const shown = useMemo(
    () => (selectedTeams.length ? tasksList.filter(t => (t.teams || []).some(x => selectedTeams.includes(x))) : tasksList)
      .filter(t => !isOngoing(t)),
    [tasksList, selectedTeams]);

  // 달력에 실제로 얹히는 것은 날짜가 있는 업무뿐 — 머리글 숫자도 그 기준으로 센다.
  // 전체 건수를 쓰면 "84건"이라 해놓고 달력에는 12개만 보이는 화면이 된다.
  const dated = useMemo(() => datedTasks(shown), [shown]);
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
          teams={teamChips} counts={teamCounts} total={datable.length}
          shownCount={dated.length} selected={selectedTeams}
          onToggle={toggleTeam} onClear={() => setSelectedTeams([])}
        />
      </div>

      <div className="flex-1 min-h-0">
        <CalendarBoard tasks={shown} onTaskClick={onTaskClick} />
      </div>
    </div>
  );
});

// ── 내 업무 ───────────────────────────────────────────────────────────────
// 상태 칩은 다중 선택. 아무것도 고르지 않으면 미완료 전체 + 맨 아래 **최근 7일 안에 완료한 업무**
// (사용자 결정 2026-09-25 · 목업 mockup-traces 3 — 완료를 누른 줄이 눈앞에서 사라지지 않게. 7일이 지나면
// 조용히 빠지고, 전부 보려면 '완료' 칩). 머리의 'N건 남음'은 그대로 남은 것만 센다.
export const MyTasksView = React.memo(function MyTasksView({ onTaskClick, onStatusChange, onNavigate }) {
  const currentUser = useStore(selectCurrentUser);
  const myTasks = useStore(selectMyTasks);
  const projectsMap = useStore(selectProjectsMap);
  const [statusFilter, setStatusFilter] = useState([]);
  const today = ISO_TODAY();

  const toggle = (s) => setStatusFilter(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
  // **거른 목록도 묶어 둔다** — 매 렌더마다 새 배열을 만들면 아래 groupByDue의 useMemo가
  // 언제나 빗나가서(의존성이 늘 새 참조다) 상태 칩 하나를 눌러도 목록 전체를 다시 묶었다.
  const shown = useMemo(() => (statusFilter.length
    ? myTasks.filter(t => statusFilter.includes(t.status))
    : myTasks.filter(t => !isDone(t) || isRecentlyDone(t, completedTime, today))), [myTasks, statusFilter, today]);
  const groups = useMemo(() => groupByDue(shown, today, { recentDone: !statusFilter.length, ongoing: statusFilter.includes(CONFIG.STATUS_ONGOING) }), [shown, today, statusFilter]);

  // 남은 수는 상시를 빼고, 지난 마감은 대시보드 KPI의 '지연'과 같은 판정(보류 중 빼고)
  const openCount = myTasks.filter(isOpen).length;
  const lateCount = myTasks.filter(t => isOverdue(t, today)).length;

  // 내가 맡은 프로젝트별 진행 (프로젝트마다 다시 filter하지 않고 한 번 묶는다) — 고른 해만
  const yearIds = useYearProjectIds();
  const myProjects = useMemo(() => progressByProject(myTasks, projectsMap, yearIds), [myTasks, projectsMap, yearIds]);

  return (
    <div className="dc-screen pb-6">
      <div className="flex items-end justify-between gap-4 flex-wrap pb-3.5">
        {/* 모바일은 상단바에 같은 제목이 있으니 여기서는 숨긴다 */}
        <div className="min-w-0 hidden md:block">
          <h2 className="text-[23px] font-extrabold text-fg mb-[3px]" style={{ letterSpacing: '-0.7px' }}>{currentUser.name}님의 업무</h2>
          <p className="text-[12.5px] text-fg-muted tabular-nums">{openCount}건 남음{lateCount ? ` · 지난 마감 ${lateCount}건` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {/* 상시도 고를 수 있다(맨 뒤 · config STATUS_PICK) — 칸이 아니라 걸러 보는 칩이다 */}
          {CONFIG.STATUS_PICK.map(s => {
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
        <ProjectProgressList
          title="내가 맡은 프로젝트" items={myProjects} color="var(--p-blue)"
          empty="맡은 업무가 생기면 여기에 보여요" onNavigate={onNavigate}
        />
      </div>
    </div>
  );
});

// ── 팀 보드 ───────────────────────────────────────────────────────────────
export const TeamView = React.memo(function TeamView({ teamName, onTaskClick, onStatusChange, onNavigate }) {
  const tasksList = useStore(selectTasksList);
  const projectsMap = useStore(selectProjectsMap);
  const storeMembers = useStore(selectMembers);
  const today = ISO_TODAY();
  const teamTasks = useMemo(() => tasksList.filter(t => (t.teams || []).includes(teamName)), [tasksList, teamName]);
  // 묶어 두지 않으면 아래 groupByDue의 useMemo가 매 렌더 빗나간다(새 배열 = 새 참조)
  // 마감 목록은 끝낸 것을 빼되 **최근 7일 안에 완료한 업무**는 맨 아래 구간에 둔다(내 업무와 같다 ·
  // 2026-09-25) · 상시는 목록에 없다(보드 한 줄에만) · 머리의 'N건 남음'은 상시를 뺀 남은 업무다
  const openTasks = useMemo(() => teamTasks.filter(t => !isDone(t) || isRecentlyDone(t, completedTime, today)), [teamTasks, today]);
  const leftCount = useMemo(() => teamTasks.filter(isOpen).length, [teamTasks]);
  // 상태 칸의 막대 분모 — 상시를 뺀 수(상시는 네 칸 어디에도 없다)
  const kpiTotal = useMemo(() => progressOf(teamTasks).total, [teamTasks]);

  // 상태별 건수 — 상태마다 다시 filter하지 않고 한 번만 센다
  const counts = useMemo(() => {
    const c = {};
    CONFIG.STATUSES.forEach(s => { c[s] = 0; });
    for (const t of teamTasks) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [teamTasks]);

  // 멤버 칩 — **이 팀에 속한 사람**과 그 사람이 맡은 이 팀의 남은 건수(utils.teamChips 주석).
  // 이 파일에는 대시보드·일정의 **팀 필터 칩**을 담은 지역 변수 `teamChips`가 이미 둘 있다 —
  // 같은 이름이 다른 뜻으로 서지 않게 들여올 때 이름을 갈라 둔다.
  const members = useMemo(() => teamMemberChips(storeMembers, tasksList, teamName), [storeMembers, tasksList, teamName]);

  const yearIds = useYearProjectIds();
  const teamProjects = useMemo(() => progressByProject(teamTasks, projectsMap, yearIds), [teamTasks, projectsMap, yearIds]);

  const groups = useMemo(() => groupByDue(openTasks, today, { recentDone: true }), [openTasks, today]);

  return (
    <div className="dc-screen pb-6">
      <div className="pb-3.5">
        <div className="min-w-0">
          <h2 className="text-[19px] md:text-[23px] font-extrabold text-fg mb-[3px] flex items-center gap-2" style={{ letterSpacing: '-0.7px' }}>
            <span className="w-[9px] h-[9px] rounded-[2px] shrink-0" style={{ background: teamColor(teamName) }} />
            {teamName}
          </h2>
          <p className="text-[12.5px] text-fg-muted tabular-nums">{leftCount}건 남음 · {teamProjects.length}개 프로젝트 참여</p>
        </div>
        {/* 사람 칩은 **제목 아래 새 줄**에 왼쪽부터 선다(사용자 지적 2026-09-07).
            제목 오른쪽에 붙여 두면 폭에 따라 두 명만 첫 줄에 서고 나머지가 접혔고,
            임원진처럼 사람이 많은 보드에서는 묶음이 통째로 아래로 떨어졌다.
            상한(5명)도 없앴다 — 넘치는 것은 가로 스크롤이 받는다. */}
        <div className={`${TEAM_CHIP_ROW} mt-2.5`} data-team-chips="">
          {members.map(m => (
            <span key={m.name} data-team-chip={m.name} className="inline-flex shrink-0 items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full"
              style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}>
              <Avatar name={m.name} className="flex w-5 h-5 text-[10px]" />
              <span className="text-[11.5px] font-semibold text-fg whitespace-nowrap">{m.name}</span>
              {m.left > 0 && <span className="text-[11px] text-fg-muted tabular-nums">{m.left}</span>}
            </span>
          ))}
          {!members.length && <span className="text-[11.5px] text-fg-muted whitespace-nowrap">아직 이 팀에 속한 청년이 없어요</span>}
        </div>
      </div>

      {/* 상태 4칸 — 대시보드 KPI와 같은 규격. 시작 전·진행 중·보류 중 3칸(좌) + 완료(우) */}
      <div className="grid gap-x-7 gap-y-3 items-stretch side-grid">
        <div className="grid grid-cols-3 rounded-[10px] overflow-hidden shadow-soft"
          style={{ gap: 1, background: 'var(--app-line)', border: '1px solid var(--app-line)' }}>
          {['시작 전', '진행 중', '보류 중'].map((s, i) => (
            <KpiCell key={s} label={s} value={counts[s]} note="" delay={i * 40}
              dot={STATUS_DOT_VAR[s]} bar={STATUS_BAR[s]} ratio={kpiTotal ? counts[s] / kpiTotal : 0} />
          ))}
        </div>
        {/* 대시보드 진척도 칸과 같은 이유로 .dc-kpi + 순번 지연 (앞 3칸 다음) */}
        <KpiCell
          className={`rounded-[10px] shadow-soft ${KPI_SOLO}`} style={{ border: '1px solid var(--app-line)' }}
          tone="green" phoneNote delay={120}
          label="완료" value={counts['완료']} note={`전체 ${kpiTotal}건 중`}
          dot="var(--app-tag-green-fg)" bar="var(--p-green)" ratio={kpiTotal ? counts['완료'] / kpiTotal : 0}
        />
      </div>

      <div className="grid gap-x-7 gap-y-6 pt-[22px] items-start side-grid">
        <DueGroupList
          groups={groups} projectsMap={projectsMap} today={today}
          onComplete={(t, next) => onStatusChange(t, next)} onOpen={onTaskClick}
          emptyHint="이 팀이 맡은 일은 다 끝났어요"
        />
        <ProjectProgressList
          title="참여 프로젝트" items={teamProjects} color={teamBar(teamName)}
          empty="아직 참여한 프로젝트가 없어요" onNavigate={onNavigate}
        />
      </div>
    </div>
  );
});
