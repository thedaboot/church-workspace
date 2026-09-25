// ============================================================================
// 3. Memoized Selectors (Reselect 패턴 직접 구현)
// ============================================================================
// Selector 캐싱을 통해 파생 데이터 연산(filter, map) 비용을 최소화합니다.
function createSelector(dependencies, combiner) {
  let lastArgs = null;
  let lastResult = null;
  return (state) => {
    const args = dependencies.map(dep => dep(state));
    if (lastArgs && args.every((val, i) => val === lastArgs[i])) {
      return lastResult; // 의존성 상태가 같으면 이전 계산 결과 반환 (O(1))
    }
    lastArgs = args;
    lastResult = combiner(...args);
    return lastResult;
  };
}

// 기본 상태 접근자 (Base Selectors)
export const selectTasks = state => state.tasks;
const selectProjects = state => state.projects;
export const selectCurrentUser = state => state.currentUser;
// 워크스페이스 멤버(프로필) — 이름·사진·생일·다녀간 시각. 클라우드에서만 채워진다.
// useSyncExternalStore는 반환값을 ===로 비교하므로 **매번 새 배열을 만들면 안 된다**
// (`state.members || []`로 두면 게스트 모드에서 렌더마다 새 배열이 되어 무한 루프가 된다).
const NO_MEMBERS = [];
export const selectMembers = state => state.members || NO_MEMBERS;

// 최근 활동 피드 — 클라우드는 loadCloudState가 채운 activityFeed를, 게스트는 tasks에
// 담긴 activityLog에서 파생한다(게스트에는 서버 피드가 없다). 클라우드에서 파생 쪽으로
// 폴백하지 않는 이유: 클라우드의 task.activityLog는 창을 연 카드만 차 있어서(§6-20)
// "열어 본 카드의 활동만 나오는" 반쪽짜리 피드가 된다.
const selectRawFeed = state => state.activityFeed;
export const selectActivityFeed = createSelector(
  [selectRawFeed, selectTasks],
  (feed, tasks) => {
    if (feed && feed.length) return feed;
    return tasks.allIds
      .flatMap(id => (tasks.byId[id].activityLog || []).map(l => ({
        id: l.id, actorName: l.author, action: l.action, cardId: id,
        projectId: tasks.byId[id].projectId, at: l.timestamp,
      })))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 30);
  }
);

// 파생 데이터 선택자 (Derived Selectors)
export const selectTasksList = createSelector([selectTasks], (tasks) => tasks.allIds.map(id => tasks.byId[id]));
// 프로젝트는 탭 드래그가 정한 순서(position, 0021)로 선다. 같은 값이면 만든 순 —
// position만 보면 옛 행(전부 0)에서 Postgres·객체 순회가 순서를 보장하지 않는다(§6-24).
export const selectProjectsList = createSelector([selectProjects], (projects) =>
  projects.allIds.map(id => projects.byId[id])
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)
      || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
export const selectProjectsMap = createSelector([selectProjects], (projects) => projects.byId);

// 보관하지 않은 프로젝트 — 상단 탭·대시보드처럼 "지금 굴러가는 것"만 보여야 하는 곳.
// 보관된 것도 지워진 것은 아니므로 검색·보관함·이미 열어 둔 화면은
// selectProjectsList(전체)를 그대로 쓴다.
export const selectActiveProjectsList = createSelector([selectProjectsList], (list) => list.filter(p => !p.archived));
// 보관된 것만, 최근에 만든 것부터 (보관함의 연도 묶음용)
export const selectArchivedProjectsList = createSelector([selectProjectsList], (list) =>
  list.filter(p => p.archived).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));

// 담당자 칸이 비어 있는 카드에서도 던지지 않는다 — 이 값은 상단 내비·하단 탭바가
// 매 렌더 보는 것이라, 여기서 던지면 껍데기가 통째로 하얘진다(SYNC_TASK가 넣는
// 새 카드의 기본값에 assignees는 없다).
export const selectMyTasks = createSelector(
  [selectTasksList, selectCurrentUser],
  (tasksList, user) => tasksList.filter(t => (t.assignees || []).includes(user.name))
);

// 팀별 남은 업무(예전 selectDashboardStats)는 services/taskCounts.teamLeftStats로 옮겼다(2026-09-25 셈 감사) —
// 스토어 전체(모든 해·보관 프로젝트)를 세서 대시보드의 연결 지도(고른 해)와 같은 팀의 숫자가 달랐다.
// 고른 해는 스토어 밖(useProjectYear 모듈 스토어)이라 셀렉터가 아니라 화면이 자른다.

// 날짜별 업무 맵은 캘린더가 자기 안에서 만든다(boards.jsx의 tasksByDate) —
// 캘린더가 보는 목록은 프로젝트·팀 필터를 거친 것이라, 스토어 전체로 만든 맵을
// 쓰면 필터가 무시된다. 여기 있던 selectTasksByDate는 그래서 아무도 쓰지 않았다.
