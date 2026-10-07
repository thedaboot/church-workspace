import React, { useState, useMemo } from 'react';
import { CONFIG } from '../config.js';
import { usePresenceLeft } from '../services/presence.js';
import { groupBy, myScope, seenToday, birthdaysWithin, joinedWithin, projectsOfYear, mergeActivitySeen, completedTime } from '../utils.js';
import { isDone, isOpen, isRunning, dueCounts, progressOf, teamLeftStats, inProjects, recentDoneCount } from '../services/taskCounts.js';
import { useProjectYear, useYearOptions } from '../hooks/useProjectYear.js';
import { YearPicker } from '../components/layout.jsx';
import { useStore } from '../store/workspaceStore.js';
import {
  selectCurrentUser, selectProjectsMap, selectActiveProjectsList,
  selectTasksList, selectMembers, selectActivityFeed, selectTasks, selectProjectsList
} from '../store/selectors.js';
import {
  ISO_TODAY, daysLeft, groupByDue, KpiCell, KPI_SOLO, Bar, StatusSegments,
  DueGroupList, TeamLeftGrid, PersonLoadGrid, personLoad, SectionHead, Card,
} from './dashboardParts.jsx';
import { PeopleStrip, MembersModal } from '../components/peopleStrip.jsx';
import { ActivityFeed } from '../components/activityFeed.jsx';
import { NetworkMap } from '../components/networkMap.jsx';
import { Segmented } from '../components/segmented.jsx';
import { dueLabelOf } from './viewParts.jsx';

// ── 전체 대시보드 ─────────────────────────────────────────────────────────
// "얼마나 진행됐나"가 아니라 "지금 뭘 해야 하나"를 먼저 보여준다.
// 마감 기준으로 묶은 목록이 주인공이고, 그 자리에서 완료 처리까지 한다.
export const DASH_FILTERS = ['전체', '내 업무', '내 팀'];
// 모바일 대시보드의 세 탭. 이름은 앱이 이미 쓰는 말로 맞추었다 — UI에서는 '작업'이
// 아니라 **업무**이고(§8), 사람 칸은 '청년별 남은 업무'와 같은 **청년**이다.
// 데스크톱은 이 탭을 쓰지 않는다 — 2열이 그대로다.
const DASH_TABS = ['업무', '청년', '연결'];
export const DASH_FILTER_DEFAULT = DASH_FILTERS[0];

export const DashboardView = React.memo(function DashboardView({ onNavigate, onTaskClick, onStatusChange, filter, setFilter }) {
  const currentUser = useStore(selectCurrentUser);
  const tasksList = useStore(selectTasksList);
  const projectsMap = useStore(selectProjectsMap);
  // '프로젝트 진행'은 지금 굴러가는 것만 — 끝나서 보관한 프로젝트가 계속 100%로
  // 남아 있으면 목록만 길어진다(업무는 여전히 세어져 KPI·마감 목록에는 들어간다)
  const activeProjects = useStore(selectActiveProjectsList);
  // 그리고 **고른 해의 것만** — 보관은 사람이 챙겨서 하는 일이라 안 하면 해마다 쌓이고,
  // 이 칸만 끝없이 길어진다(사용자 지적 2026-08-29). 탭 줄과 같은 값을 본다.
  const [year, setYear] = useProjectYear();
  // 고를 수 있는 해는 탭 줄과 같은 목록이다(보관된 것까지 세는 것도 같다)
  const allProjectsForYears = useStore(selectProjectsList);
  const { years, yearCounts } = useYearOptions(allProjectsForYears);
  const projectsList = useMemo(() => projectsOfYear(activeProjects, year), [activeProjects, year]);
  const yearProjectIds = useMemo(() => new Set(projectsList.map(p => p.id)), [projectsList]);
  // **연결 지도도 고른 해만 본다**(사용자 결정 2026-08-31 — 해가 쌓이면 프로젝트 층이
  // 넘쳐 라벨이 겹친다). 예전 주석에는 "해로 거르지 않는다 — 해로 자르면 작년까지
  // 이어온 관계가 사라진다"고 적어 두었는데 사용자가 뒤집었습니다: 연도를 바꾸면
  // 그 해가 보이므로 사라지는 것이 아니고, 한 화면에 다 밀어 넣는 쪽이 더 나쁩니다.
  // 값은 '프로젝트 진행'·탭 줄과 **같은 하나**(useProjectYear 모듈 스토어)입니다.
  const today = ISO_TODAY();

  // 소속 팀이 여럿이면 전부 합친다(대표 팀 하나만 보면 겸직한 사람 업무가 빠진다)
  const myTeams = currentUser.teams?.length ? currentUser.teams : [currentUser.team].filter(Boolean);
  const myName = currentUser.name;

  // 전체 · 내 업무 · 내 팀은 **끝난 업무까지 포함해** 먼저 자른다. 예전에는 남은 업무에만
  // 걸려 있어서, '내 업무'를 골라도 KPI의 '전체 진척도'와 프로젝트 진행 바는 워크스페이스
  // 전부를 세고 있었다 — 같은 화면에서 한 필터가 어떤 칸에는 걸리고 어떤 칸에는 안 걸렸다
  // (사용자 지적 2026-08-29). 필터 하나가 이 화면의 숫자 전부를 지배한다.
  const scoped = useMemo(() => {
    if (filter === '내 업무') return tasksList.filter(t => (t.assignees || []).includes(myName));
    if (filter === '내 팀') return tasksList.filter(t => (t.teams || []).some(x => myTeams.includes(x)));
    return tasksList;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksList, filter, myName, myTeams.join(',')]);

  // 필터와 무관한 **남은 업무**(완료·상시 빼고 — taskCounts.isOpen) — 인사말·세그먼트 숫자가 본다
  // (사람은 업무 필터의 대상이 아니다, §6-31). 상시는 끝낼 일이 아니라 '남은 N건'에 섞지 않는다.
  const open = useMemo(() => tasksList.filter(isOpen), [tasksList]);
  // 세그먼트 칩에 붙는 숫자는 **고르기 전에** 알아야 하므로 필터 밖에서 센다
  const mine = useMemo(() => open.filter(t => (t.assignees || []).includes(myName)), [open, myName]);
  const teamOpen = useMemo(() => open.filter(t => (t.teams || []).some(x => myTeams.includes(x))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, myTeams.join(',')]);
  // 아래 마감 목록 — 끝낸 것만 뺀다(상시는 groupByDue가 뺀다 · 2026-09-27)
  const shown = useMemo(() => scoped.filter(t => !isDone(t)), [scoped]);
  // KPI 분모('남은 업무 N건 중')는 상시를 뺀 남은 업무다
  const shownOpen = shown.filter(isOpen).length;

  // KPI 세 칸은 **아래 목록의 구간을 센다**(taskCounts.dueCounts = bucketOf 한 벌) — 따로 셈을 두면
  // 보류 중인 업무가 KPI에서는 '지연'인데 목록에서는 아닌 식으로 둘이 다른 말을 한다.
  // '이번 주'는 주일에 시작해 토요일에 끝나는 달력의 주의 **내일부터** 토요일까지다(오늘은 '오늘 마감').
  const due = dueCounts(shown, today);
  const overdueCount = due.overdue;
  const todayCount = due.today;
  const weekCount = due.week;
  const groups = useMemo(() => groupByDue(shown, today), [shown, today]);

  // 전체 진척도 — 끝낸 수 / (전체 - 상시)
  const { done: doneAll, total: progressTotal } = progressOf(scoped);
  const progress = progressTotal ? Math.round((doneAll / progressTotal) * 100) : 0;

  // 지난 7일 간 끝낸 건수 — 이 화면은 앞만 보기 때문에 정리한 성과가 바로 사라진다.
  // **끝낸 날은 completedTime이다**(cards.completed_at · 0033/0034). 예전 주석은 "완료 시각을
  // 따로 저장하지 않으므로 updatedAt을 대신 쓴다"였는데 그 칸은 그 뒤에 생겼고, updatedAt은
  // 끝낸 날이 아니다 — 끝난 업무에 첨부를 하나 올리기만 해도(0016의 file_count 트리거가
  // 카드를 건드린다) 오늘로 밀려서 **한 달 전에 끝낸 업무가 이 줄에 다시 세어졌다**.
  // 마감 목록의 '끝낸 업무' 구간이 세우고 보여주는 값과 같은 함수다(§4.12).
  // 7일은 오늘 포함 7일이고 날짜는 로컬이다(taskCounts.recentDoneCount — 예전에는 8일 · UTC 날짜였다).
  const doneRecent = useMemo(() => recentDoneCount(tasksList, completedTime, today), [tasksList, today]);

  // 팀별·청년별 남은 업무 — **고른 해의 보관 안 한 프로젝트 업무**만 센다(2026-09-25 셈 감사).
  // 예전에는 모든 해·보관 프로젝트를 세서, 바로 아래 연결 지도(고른 해)의 팀 칩과 같은 팀의
  // 남은 수가 달랐다. 두 칸이 연도 고르기 바로 옆에 있으므로 그 값을 따른다. 필터와는 무관하다.
  const yearTasks = useMemo(() => inProjects(tasksList, yearProjectIds), [tasksList, yearProjectIds]);
  const teamStats = useMemo(() => teamLeftStats(yearTasks), [yearTasks]);
  const people = useMemo(() => personLoad(yearTasks), [yearTasks]);

  // 최근 활동 피드(#3) — 클라우드는 서버 피드, 게스트는 tasks의 activityLog에서 파생
  const feed = useStore(selectActivityFeed);

  // 사람 칸 (0019) — 오늘 다녀간 사람 · 이번 주 생일 · 새로 온 사람.
  // 세 줄 다 필터와 무관하다: 사람은 업무 필터의 대상이 아니다(인사말과 같은 판단, §6-31).
  //
  // **'다녀감'과 '활동'은 같은 시각을 봐야 한다**(사용자 지적 2026-09-05 — "1분 전에
  // 수정했다고 뜨는데 현황은 4분 전에 떠났다고 뜬다"). 그래서 피드에 남은 그 사람의
  // 마지막 움직임을 다녀간 시각에 겹쳐 쓴다 — 서버 왕복이 없고(피드는 이미 여기 있다),
  // 두 값이 어긋난 화면이 구조적으로 안 나온다. 아무도 안 밀렸으면 **같은 배열**이
  // 그대로 나와서 아래 연결 지도가 저장 한 번마다 다시 배치되지 않는다.
  const storeMembers = useStore(selectMembers);
  // 떠난 순간(presence)도 겹친다 — 멤버 관리와 같은 함수·같은 세 값이다
  const left = usePresenceLeft();
  const members = useMemo(() => mergeActivitySeen(storeMembers, feed, left), [storeMembers, feed, left]);
  const seenTodayList = useMemo(() => seenToday(members, myName), [members, myName]);
  // 생일은 일주일 전부터, 환영은 사흘만 — 인사가 오래 걸려 있으면 낡는다(사용자 판단)
  const birthdayList = useMemo(() => birthdaysWithin(members, 7), [members]);
  const joinedList = useMemo(() => joinedWithin(members, 3), [members]);
  // 머리줄의 'N명'을 누르면 열리는 전체 목록(정렬은 모달이 한다 — 접속 상태를 같이 본다)
  const [membersOpen, setMembersOpen] = useState(false);
  const tasksById = useStore(selectTasks).byId;

  // 연결 지도(#28) — 업무가 있는 팀만(0건 팀을 늘어놓으면 선 없는 점만 남는다),
  // 팀→프로젝트 선은 "그 팀 업무가 그 프로젝트에 있다"다. 한 번 훑어 쌍을 모은다.
  // 선 굵기(가중치)와 팀별 남은 수도 같이 센다(사용자 결정 2026-08-31) — 한 번 훑어
  // 다 모은다. 가중치는 **업무 수**다: 팀→프로젝트는 그 프로젝트에 있는 그 팀 업무 수,
  // 사람→팀은 그 사람이 그 팀에서 맡은 업무 수.
  // **사람→팀 선 자체는 프로필의 팀(멤버십)에서 나옵니다** — 업무 수로 선을 만들면
  // 맡은 일이 없는 사람이 팀에서 사라집니다(§8 — 연결이 없는 사람도 그대로 보인다).
  // 업무 수는 굵기로만 씁니다(0건이면 가장 얇은 선).
  // 지도가 쓰는 값들은 **고른 해 프로젝트의 업무만** 훑는다 — 안 그러면 딴 해에만
  // 있는 팀이 빈 줄로 남고, 팀 칩의 남은 수도 딴 해 업무를 같이 센다.
  const { teamsInUse, teamProjects, teamLeft, memberLoad } = useMemo(() => {
    const teamSet = new Set();
    const pairCount = new Map();      // `팀|프로젝트` → 업무 수
    const left = {};                  // 팀 → 남은(미완료) 업무 수
    const load = new Map();           // `이름|팀` → 업무 수
    for (const t of tasksList) {
      if (!yearProjectIds.has(t.projectId)) continue;
      for (const team of (t.teams || [])) {
        teamSet.add(team);
        const key = `${team}|${t.projectId}`;
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
        if (isOpen(t)) left[team] = (left[team] || 0) + 1;
        for (const a of (t.assignees || [])) {
          const k2 = `${a}|${team}`;
          load.set(k2, (load.get(k2) || 0) + 1);
        }
      }
    }
    // 열 순서는 config의 팀 순서를 따른다(화면마다 팀 순서가 다르면 헷갈린다)
    const inUse = Object.keys(CONFIG.TEAMS).filter(n => teamSet.has(n));
    const pairs = [...pairCount.entries()].map(([k, n]) => {
      const i = k.indexOf('|');
      return [k.slice(0, i), k.slice(i + 1), n];
    });
    return { teamsInUse: inUse, teamProjects: pairs, teamLeft: left, memberLoad: load };
  }, [tasksList, yearProjectIds]);

  // 프로젝트별 상태 분포 — 4색 세그먼트 바.
  // 프로젝트마다 목록 전체를 다시 훑지 않도록 한 번 묶고(groupBy) 한 번만 센다.
  // **scoped**를 쓴다 — 상단 필터가 이 칸에도 걸려야 화면의 숫자가 한 벌이 된다
  const tasksByProject = useMemo(() => groupBy(scoped, t => t.projectId), [scoped]);
  const projectStats = useMemo(() => projectsList.map(p => {
    const list = tasksByProject.get(p.id) || [];
    const counts = {};
    CONFIG.STATUSES.forEach(s => { counts[s] = 0; });
    let nearest = null;
    for (const t of list) {
      counts[t.status] = (counts[t.status] || 0) + 1;
      // 가장 가까운 마감은 **돌아가는 일**(시작 전·진행 중)에서만 — 보류 중의 지난 마감으로
      // 'N일 지남'이 빨갛게 서면 KPI의 지연과 다른 말을 한다
      if (t.dueDate && isRunning(t) && (nearest === null || t.dueDate < nearest)) nearest = t.dueDate;
    }
    const dd = nearest ? daysLeft(nearest, today) : null;
    // 막대 분모는 상시를 뺀 수(상시는 네 색 어디에도 없다 — 넣으면 막대가 영영 안 찬다)
    const total = progressOf(list).total;
    return {
      ...p, counts, total,
      dueLabel: dueLabelOf(dd),
      urgent: dd !== null && dd <= 2,
      // 예전에는 `완료 7 · 진행 3 · 보류 0 · 시작 전 2`였다. 바로 위 세그먼트 바가
      // 이미 같은 말을 색으로 하고 있어서, 이 줄은 모바일에서 높이만 먹었다.
      summary: `${total}건 중 ${counts['완료'] || 0}건`,
    };
  }), [projectsList, tasksByProject, today]);

  // 고른 해 전체 진척도 — 이 칸의 머리줄이다. 아래 프로젝트들의 합이고, 상단 필터도
  // 같이 걸려 있다. KPI의 '전체 진척도'와 다른 점은 **해로 한 번 더 자른다**는 것뿐이다.
  const yearDone = useMemo(() => projectStats.reduce((n, p) => n + (p.counts['완료'] || 0), 0), [projectStats]);
  const yearTotal = useMemo(() => projectStats.reduce((n, p) => n + p.total, 0), [projectStats]);

  // 인사말이 세는 범위는 '내 것 + 담당자 없는 것'이다 — 이유는 utils.myScope 주석에.
  const myOpen = useMemo(() => myScope(open, myName), [open, myName]);
  // 지연·오늘은 KPI와 같은 구간 셈이다(보류 중은 지연이 아니다)
  const myDue = dueCounts(myOpen, today);
  const myOverdue = myDue.overdue;
  const myToday = myDue.today;

  // 지금 상태를 그대로 말한다 — 지연이 0인데 "오늘 할 일만 남았어요"라고 하면
  // 남은 게 없는 날에도 할 일이 있는 것처럼 읽힌다
  const greeting = myOverdue ? `${myName}님, 밀린 업무부터 정리해봐요`
    : myToday ? `${myName}님, 오늘 마감되는 업무만 남았어요`
    : myOpen.length ? `${myName}님, 오늘은 여유가 좀 있네요`
    : `${myName}님, 맡은 업무를 다 마쳤어요`;
  // 내 지연은 없는데 KPI의 '지연'에는 숫자가 있는 경우가 있다(남의 것). 그때
  // "지연된 업무가 없네요"라고 하면 바로 아래 칸과 어긋나 보인다.
  // 그렇다고 "내가 맡은 업무에는 없네요"라고 하면 남과 견주는 문장이 된다 — 여기는
  // 같이 사역하는 사람들이 쓰는 화면이고, 누가 밀렸는지 가리키는 자리가 아니다.
  // 내 상태만 말하고 전체 숫자에는 아무 주장을 하지 않는 문장으로 둔다.
  const headline = myOverdue ? `지연된 업무 ${myOverdue}건이 남아 있어요`
    : myToday ? `오늘 마감되는 업무 ${myToday}건만 정리하면 돼요`
    : overdueCount ? '잘하고 있어요!'
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
        ratio={shownOpen ? overdueCount / shownOpen : 0}
      />
      <KpiCell
        label="오늘 마감" value={todayCount} note={`남은 업무 ${shownOpen}건 중`} delay={40}
        dot="var(--app-accent)" bar="var(--p-blue)" ratio={shownOpen ? todayCount / shownOpen : 0}
      />
      <KpiCell
        label="이번 주" value={weekCount} note="이번 주 토요일까지" delay={80}
        dot="var(--app-status-hold)" bar="var(--p-yellow)" ratio={shownOpen ? weekCount / shownOpen : 0}
      />
    </>
  );
  // 모바일 탭. 데스크톱은 이 값을 쓰지 않는다 — 아래 pane()이 lg에서 언제나 contents다.
  const [tab, setTab] = useState(DASH_TABS[0]);
  // 덩이 하나를 그 탭에서만 보이게. **contents**여야 안쪽 칸이 직접 그리드/플렉스 칸이
  // 된다 — 감싸개가 칸을 하나 차지하면 데스크톱 2열 배치가 어긋난다(§6-3과 같은 방법).
  const pane = (name) => (tab === name ? 'contents' : 'hidden lg:contents');
  // 필터 칩은 데스크톱(인사말 옆)과 모바일('업무' 탭 안) 두 자리에서 같은 것을 쓴다
  const filterItems = DASH_FILTERS.map(f => [f, <>{f} {counts[f]}</>]);
  const FILTER_BTN = 'dc-press flex-1 lg:flex-none px-3 py-1.5 rounded-sm text-[12.5px] font-semibold transition-colors';

  // 진척도 칸 — KPI 칸과 같은 부품이고 껍데기만 다르다(격자 밖에 혼자 선다 · 메모는 폰에서도)
  const progressCell = (shell, style) => (
    <KpiCell
      className={shell} style={style} delay={120} phoneNote
      label="전체 진척도" value={`${progress}%`} unit={null} note={`${doneAll}/${progressTotal}건`}
      dot="var(--app-accent)" bar="var(--p-blue)" ratio={progressTotal ? doneAll / progressTotal : 0}
    />
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
        {/* 이 필터가 실제로 건드리는 것은 KPI와 마감 목록뿐이다 — 사람 칸은 필터와
            무관하다(§6-31). 그래서 모바일에서는 '업무' 탭 안으로 내려간다. */}
        <Segmented as="div" className="hidden lg:flex items-center gap-1 shrink-0 p-[3px] rounded-md"
          items={filterItems} value={filter} onPick={setFilter} btnClassName={FILTER_BTN} />
      </div>

      {/* 모바일 탭 — 예전에는 아홉 덩이가 세로로 쌓여서 뒤 네 덩이(팀별·청년별·최근
          활동·연결 지도)는 스크롤이 끝나지 않아 아무도 못 봤다(사용자 지적 2026-08-29).
          §8의 "기능을 숨기지 않습니다"와 부딪히지만, 탭 세 칸은 언제나 보이고 지금
          상태는 이미 숨긴 것과 다름없다는 판단이다(사용자 결정).
          데스크톱은 2열이 그대로라 이 줄이 없다. */}
      <Segmented as="div" role="tablist" aria-label="대시보드" className="flex lg:hidden items-center gap-1 p-[3px] mb-2.5 rounded-md"
        tabs items={DASH_TABS.map(t => [t, t])} value={tab} onPick={setTab}
        btnClassName="dc-press flex-1 py-1.5 rounded-sm text-[12.5px] font-semibold transition-colors" />
      <Segmented as="div" className={`${tab === '업무' ? 'flex' : 'hidden'} lg:hidden items-center gap-1 mb-2.5 p-[3px] rounded-md`}
        items={filterItems} value={filter} onPick={setFilter} btnClassName={FILTER_BTN} />

      {/* KPI — 데스크톱은 좌 3칸(1px 격자) + 우 진척도로 아래 본문 2열과 경계가 맞고,
          모바일은 네 칸이 2×2로 접힌다(핸드오프 규격) */}
      <div className="hidden lg:grid gap-x-8 gap-y-3 items-stretch dash-grid">
        <div className="grid grid-cols-3 rounded-[10px] overflow-hidden shadow-soft"
          style={{ gap: 1, background: 'var(--app-line)', border: '1px solid var(--app-line)' }}>
          {kpiCells}
        </div>
        {/* 진척도도 KPI 칸이다 — .dc-kpi와 순번 지연(앞 3칸 0·40·80 다음)을 같이 준다.
            예전에는 이 칸만 애니메이션이 없어서, 왼쪽 세 칸이 차례로 들어오는 동안
            네 번째 칸은 이미 자리에 있었다(순서가 어긋나 보인 자리 중 하나). */}
        {progressCell(`rounded-[10px] shadow-soft ${KPI_SOLO}`, { border: '1px solid var(--app-line)' })}
      </div>
      <div className={`${tab === '업무' ? 'grid' : 'hidden'} lg:hidden kpi-grid rounded-[10px] overflow-hidden shadow-soft`}
        style={{ gap: 1, background: 'var(--app-line)', border: '1px solid var(--app-line)' }}>
        {kpiCells}
        {progressCell(KPI_SOLO)}
      </div>

      {/* 본문 — 좌: 마감 그룹, 우: 프로젝트 진행 + 팀별 남은 업무 */}
      <div className="grid gap-x-8 gap-y-6 pt-5 items-start dash-grid">
        <div className={pane('업무')}>
          <DueGroupList
            groups={groups} projectsMap={projectsMap} today={today}
            onComplete={complete} onOpen={onTaskClick}
            emptyHint={filter === '전체' ? '새 업무가 들어오면 여기에 쌓여요' : '다른 탭에는 아직 남은 업무가 있어요'}
          />
        </div>
        {/* lg 미만에서는 감싸개를 지워 안쪽 칸이 직접 그리드 칸이 된다 — 그래야 탭이
            고른 덩이만 그 자리에 설 수 있다(§6-3처럼 컴포넌트를 두 벌 두지 않는 방법).
            예전에는 여기서 사람 칸만 order-first로 끌어올렸는데, 지금은 사람 칸이
            '청년' 탭으로 통째로 갔으므로 순서를 뒤집을 일이 없다. */}
        <div className="contents lg:flex lg:flex-col lg:min-w-0 lg:gap-[22px]">
          {/* 사람이 먼저다. 멤버가 없으면(게스트 모드) 아무것도 안 그린다 */}
          <div className={pane('청년')}>
            <div className="min-w-0">
              <PeopleStrip
                members={members} myName={myName}
                seen={seenTodayList} birthdays={birthdayList} joined={joinedList}
                onOpenMembers={() => setMembersOpen(true)}
              />
              {membersOpen && (
                <MembersModal members={members} myName={myName} onClose={() => setMembersOpen(false)} />
              )}
            </div>
          </div>
          <div className={pane('업무')}>
          <Card className="px-4 pt-[15px] pb-[3px]">
            <div className="flex items-baseline justify-between gap-2 pb-3">
              <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">프로젝트 진행</h3>
              {/* 연도를 **여기서 직접** 고른다(사용자 결정 2026-08-29). 탭 줄의 `2026 ▾`와
                  같은 값이라 한쪽을 바꾸면 다른 쪽도 따라간다 — 값이 하나이므로 어느 쪽이
                  참인지 헷갈릴 일은 없다. compact는 탭 줄용 여백이라 여기서는 안 쓴다. */}
              <span className="shrink-0 -my-1">
                <YearPicker year={year} years={years} yearCounts={yearCounts} onPick={setYear} compact />
              </span>
            </div>
            {/* 그 해 전체 — 아래 프로젝트들의 합이다. 프로젝트가 없으면 그리지 않는다
                (0건에 0%를 그리면 "다 안 했다"로 읽힌다). */}
            {yearTotal > 0 && (
              <div className="flex items-center gap-2.5 pb-3 mb-[11px] border-b border-line">
                {/* '올해 전체'라고 못 박으면 2027을 골랐을 때 거짓말이 된다 */}
                <span className="text-[11.5px] font-semibold text-fg-muted whitespace-nowrap shrink-0 tabular-nums">{year}년 전체</span>
                <span className="flex-1 min-w-0"><Bar ratio={yearDone / yearTotal} color="var(--p-blue)" /></span>
                <span className="text-[15px] font-extrabold text-fg tabular-nums shrink-0" style={{ letterSpacing: '-0.6px' }}>
                  {Math.round((yearDone / yearTotal) * 100)}%
                </span>
                <span className="text-[10.5px] text-fg-muted tabular-nums whitespace-nowrap shrink-0">{yearDone}/{yearTotal}건</span>
              </div>
            )}
            {projectStats.map(p => (
              <div key={p.id} className="pb-[13px]">
                <div className="flex items-baseline justify-between gap-2.5 pb-1.5">
                  <button onClick={() => onNavigate(p.id)} className="text-[12.5px] font-semibold text-fg truncate text-left hover:text-accent-text transition-colors">{p.title}</button>
                  <span className="text-[11px] font-semibold shrink-0 tabular-nums"
                    style={{ color: p.urgent ? 'var(--app-tag-red-fg)' : 'var(--app-ink-muted)' }}>{p.dueLabel}</span>
                </div>
                <StatusSegments counts={p.counts} total={p.total} />
                <p className="mt-[5px] text-[10.5px] text-fg-muted tabular-nums">{p.summary}</p>
              </div>
            ))}
            {/* 고른 해에 프로젝트가 없을 수 있다 — 다른 해에는 있다는 뜻이므로
                '아직'이라고 하지 않는다(달력의 `해당 날짜에는 업무가 없어요`와 같은 결). */}
            {!projectStats.length && <p className="pb-4 text-[11px] text-fg-muted">{year}년에 프로젝트는 아직 없어요</p>}
          </Card>
          </div>

          <div className={pane('청년')}>
            <div>
              <SectionHead>팀별 남은 업무</SectionHead>
              <TeamLeftGrid stats={teamStats} onOpenTeam={(name) => onNavigate(`team:${name}`)} />
            </div>
          </div>

          <div className={pane('청년')}>
            <div>
              <SectionHead>청년별 남은 업무</SectionHead>
              <PersonLoadGrid people={people} />
            </div>
          </div>

          {/* 최근 활동 — activity는 쌓이고 있었는데 업무 창 안에만 갇혀 있었다.
              모바일에서는 '청년' 탭 맨 끝이다: 피드는 둘러보는 정보라 '지금 해야
              할 것'(마감 목록)보다 앞설 이유가 없다. */}
          <div className={pane('청년')}>
            <ActivityFeed feed={feed} tasksById={tasksById} onOpenTask={onTaskClick} onNavigate={onNavigate} />
          </div>

        </div>
      </div>

      {/* 연결 지도(#28) — 내가 어디에 붙어 있는지 한 장. 세 열(사람·팀·프로젝트)이 640px을
          쓰므로 사이드 칸(360px)에 넣으면 프로젝트 열이 잘린다 → 본문 아래 전폭으로 둔다.
          클라우드에서만 그린다(멤버가 있어야 사람 열이 있다).
          **고른 해만 본다**(사용자 결정 2026-08-31 — 위 projectsList·yearProjectIds 주석). 예전 주석은
          "해로 거르지 않는다"였는데 코드와 반대였다. */}
      {members.length > 0 && (
        <div className={`${tab === '연결' ? 'block' : 'hidden'} lg:block pt-6`}>
          <NetworkMap
            members={members} teamsInUse={teamsInUse} projects={projectsList}
            teamProjects={teamProjects} teamLeft={teamLeft} memberLoad={memberLoad}
            year={year} years={years} yearCounts={yearCounts} onPickYear={setYear}
            onOpenTeam={(name) => onNavigate(`team:${name}`)} onOpenProject={onNavigate}
          />
        </div>
      )}
    </div>
  );
});
