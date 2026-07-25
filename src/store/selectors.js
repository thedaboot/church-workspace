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

// 로컬 기준 날짜 유틸 (UTC 시프트 없이 하루씩 증가)
const parseYMD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const toYMD = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const MS_DAY = 86400000;

// 캘린더용 O(1) 맵핑 캐싱 — 날짜별로 [{ task, kind }] 반환
// kind: 'start' | 'mid' | 'due' | 'single' (기간 띠) / 'due-only' (마감만)
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
      if (t.startDate && t.dueDate) {
        const start = parseYMD(t.startDate);
        const end = parseYMD(t.dueDate);
        const span = Math.round((end - start) / MS_DAY);
        if (span < 0 || span > 180) {
          // 구간이 뒤집혔거나 비정상적으로 길면 마감만 표시로 폴백
          push(t.dueDate, t, 'due-only');
        } else if (span === 0) {
          push(t.startDate, t, 'single');
        } else {
          const cur = new Date(start);
          for (let i = 0; i <= span; i++) {
            const kind = i === 0 ? 'start' : i === span ? 'due' : 'mid';
            push(toYMD(cur), t, kind);
            cur.setDate(cur.getDate() + 1);
          }
        }
      } else if (t.dueDate) {
        push(t.dueDate, t, 'due-only');
      } else if (t.startDate) {
        push(t.startDate, t, 'single');
      }
    });
    // 하루 안에서는 시작일이 빠른 업무가 위로 — 셀이 넘쳐 +N으로 접힐 때
    // 먼저 시작한 업무가 먼저 보이도록. 같은 날 시작이면 마감일, 그다음 제목 순.
    const key = (t) => `${t.startDate || t.dueDate || '9999-99-99'}|${t.dueDate || '9999-99-99'}|${t.title || ''}`;
    for (const entries of map.values()) {
      entries.sort((a, b) => (key(a.task) < key(b.task) ? -1 : key(a.task) > key(b.task) ? 1 : 0));
    }
    return map;
  }
);
