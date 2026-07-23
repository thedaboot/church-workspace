import { CONFIG } from '../config.js';

// ============================================================================
// 3. Memoized Selectors (Reselect 패턴 직접 구현)
// ============================================================================
// Selector 캐싱을 통해 파생 데이터 연산(filter, map) 비용을 최소화합니다.
export function createSelector(dependencies, combiner) {
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
export const selectProjects = state => state.projects;
export const selectCurrentUser = state => state.currentUser;

// 파생 데이터 선택자 (Derived Selectors)
export const selectTasksList = createSelector([selectTasks], (tasks) => tasks.allIds.map(id => tasks.byId[id]));
export const selectProjectsList = createSelector([selectProjects], (projects) => projects.allIds.map(id => projects.byId[id]));
export const selectProjectsMap = createSelector([selectProjects], (projects) => projects.byId);

export const selectMyTasks = createSelector(
  [selectTasksList, selectCurrentUser],
  (tasksList, user) => tasksList.filter(t => t.assignees.includes(user.name))
);

export const selectDashboardStats = createSelector(
  [selectTasksList, selectProjectsMap],
  (tasksList, projectsMap) => {
    const totalTasks = tasksList.length;
    const completedTasks = tasksList.filter(t => t.status === '완료').length;
    const progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

    const teamStats = Object.keys(CONFIG.TEAMS).map(teamName => {
      const teamTasks = tasksList.filter(t => t.teams.includes(teamName));
      const done = teamTasks.filter(t => t.status === '완료').length;
      const activeProjects = [...new Set(teamTasks.map(t => projectsMap[t.projectId]?.title).filter(Boolean))];
      return {
        name: teamName, total: teamTasks.length, done,
        progress: teamTasks.length === 0 ? 0 : Math.round((done / teamTasks.length) * 100),
        projects: activeProjects
      };
    });
    return { progress, teamStats };
  }
);

// 캘린더용 O(1) 맵핑 캐싱 — 날짜별로 [{ task, kind: 'start' | 'due' }] 반환 (시작일·마감일 모두 추적)
export const selectTasksByDate = createSelector(
  [selectTasksList],
  (tasksList) => {
    const map = new Map();
    const push = (date, task, kind) => {
      if (!date) return;
      if (!map.has(date)) map.set(date, []);
      map.get(date).push({ task, kind });
    };
    tasksList.forEach(t => {
      push(t.startDate, t, 'start');
      push(t.dueDate, t, 'due');
    });
    return map;
  }
);
