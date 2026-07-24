import { generateId, normalize } from '../utils.js';

// ============================================================================
// 4. Domain Services (비즈니스 로직 캡슐화)
// ============================================================================
export const ActivityService = {
  createLog: (action, author) => ({ id: generateId(), action, author, timestamp: new Date().toISOString() }),
  generateStatusLog: (oldStatus, newStatus, author) => ActivityService.createLog(`상태를 '${oldStatus}'에서 '${newStatus}'(으)로 변경했습니다.`, author)
};

export const TaskService = {
  create: (data, author) => ({
    ...data,
    id: generateId(),
    status: data.status || '시작 전',
    assignees: data.assignees || [],
    teams: data.teams || [],
    author,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: [],
    activityLog: [ActivityService.createLog('업무를 생성했습니다.', author)]
  }),
  update: (oldTask, newData, author) => {
    const updated = { ...oldTask, ...newData, updatedAt: new Date().toISOString() };
    if (oldTask.status !== newData.status) {
      updated.activityLog = [...(updated.activityLog || []), ActivityService.generateStatusLog(oldTask.status, newData.status, author)];
    }
    return updated;
  },
  addComment: (task, text, author, parentId = null) => ({
    ...task,
    comments: [...(task.comments || []), { id: generateId(), author, text, timestamp: new Date().toISOString(), parentId }]
  }),
  updateComment: (task, commentId, newText) => ({
    ...task,
    comments: (task.comments || []).map(c => c.id === commentId ? { ...c, text: newText, edited: true, updatedAt: new Date().toISOString() } : c)
  }),
  // 최상위 댓글 삭제 시 그 답글(parentId === commentId)도 함께 제거
  deleteComment: (task, commentId, author) => ({
    ...task,
    comments: (task.comments || []).filter(c => c.id !== commentId && c.parentId !== commentId),
    activityLog: [...(task.activityLog || []), ActivityService.createLog('댓글을 삭제했습니다.', author)]
  }),
  // 임의 활동 로그 추가(첨부 업로드/삭제 등)
  addActivity: (task, action, author) => ({
    ...task,
    activityLog: [...(task.activityLog || []), ActivityService.createLog(action, author)]
  })
};

export const MockFactory = {
  createUser: (name = '홍길동', team = '미디어팀') => ({ name, team }),
  createProject: (title, pinnedLinks = []) => ({ id: generateId(), title, pinnedLinks }),
  createWorkspace: () => {
    const p1 = MockFactory.createProject('2026 여름 수련회 준비', [{ id: generateId(), title: '기획안 원본', url: '#' }]);
    const p2 = MockFactory.createProject('새신자 초청 주일', []);
    const t1 = TaskService.create({ projectId: p1.id, title: '수련회 포스터 디자인', status: '진행 중', assignees: ['홍길동'], teams: ['미디어팀'], content: '여름 수련회 포스터 업무입니다.', dueDate: '2026-07-25' }, '임성빈');
    return {
      currentUser: MockFactory.createUser(),
      projects: normalize([p1, p2]),
      tasks: normalize([t1])
    };
  }
};
