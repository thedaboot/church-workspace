import { generateId, normalize } from '../utils.js';
import { mdToDoc, docToMd } from './markdown.js';

// ============================================================================
// 4. Domain Services (비즈니스 로직 캡슐화)
// ============================================================================
// 같은 항목들인지(순서 무시) — 담당자·담당 팀은 순서가 바뀌어도 변경이 아니다
const sameItems = (a = [], b = []) => a.length === b.length && a.every(x => b.includes(x));
const listOrNone = (a = []) => (a.length ? a.join(', ') : null);
// 상세 내용은 에디터를 열기만 해도 마크다운이 정규화된다(빈 줄 3개 이상 축약,
// 줄 끝 공백 제거, '**==x==**'→'==**x**==' 등). 그래서 손대지 않고 저장해도
// 문자열이 달라져 "상세 내용을 수정했습니다"가 잘못 남았다 → 같은 정규화를 거친
// 값끼리 비교해 '진짜 바뀐 경우'만 기록한다.
const normContent = (s) => {
  try { return docToMd(mdToDoc(s || '')); }
  catch { return String(s || ''); }
};

// '2026-08-01' → '2026년 8월 1일' (활동 기록에 그대로 읽히게)
const ymdKo = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : s;
};

export const ActivityService = {
  createLog: (action, author) => ({ id: generateId(), action, author, timestamp: new Date().toISOString() }),
  generateStatusLog: (oldStatus, newStatus, author) => ActivityService.createLog(`상태를 '${oldStatus}'에서 '${newStatus}'(으)로 변경했습니다.`, author),

  // 상태 외 필드 변경도 활동 기록에 남긴다 (바뀐 항목만, 항목별로 1건)
  generateFieldLogs: (oldTask, newData, author) => {
    const logs = [];
    const add = (msg) => logs.push(ActivityService.createLog(msg, author));

    if ((oldTask.title || '') !== (newData.title || '')) add(`제목을 '${newData.title || ''}'(으)로 변경했습니다.`);
    if (normContent(oldTask.content) !== normContent(newData.content)) add('상세 내용을 수정했습니다.');

    for (const [key, label] of [['startDate', '시작일'], ['dueDate', '마감일']]) {
      const before = oldTask[key] || '';
      const after = newData[key] || '';
      if (before === after) continue;
      add(after ? `${label}을 ${ymdKo(after)}로 변경했습니다.` : `${label}을 지웠습니다.`);
    }

    // 조사가 달라서(담당자'를' / 담당 팀'을') 항목마다 같이 적어둔다
    for (const [key, label, particle] of [['assignees', '담당자', '를'], ['teams', '담당 팀', '을']]) {
      if (sameItems(oldTask[key] || [], newData[key] || [])) continue;
      const next = listOrNone(newData[key] || []);
      add(next ? `${label}${particle} ${next}(으)로 변경했습니다.` : `${label}${particle} 모두 비웠습니다.`);
    }
    return logs;
  },
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
  // 바뀐 업무와 **이번에 생긴 활동 기록**을 같이 돌려준다.
  //
  // 호출부가 나중에 "새 기록이 뭐였지"를 되계산하게 두면 안 된다. 예전에는 컨트롤러가
  // `task.activityLog.slice(oldData.activityLog.length)`로 잘라냈는데, oldData(업무 창을
  // 열 때의 스냅샷)와 newData(스토어를 따라가는 폼)가 **다른 스냅샷**이었다. 창을 열면
  // 상세 로드가 스토어에만 활동을 채우므로 oldData.activityLog는 빈 배열이고, 그래서
  // slice(0)이 되어 서버에 이미 있는 기록까지 새 것으로 보고 다시 넣었다
  // → activity_pkey 중복 → 카드는 저장됐는데 "저장에 실패했어요"가 떴다.
  // 만든 자리에서 같이 돌려주면 그 계산 자체가 사라진다.
  updateWithLogs: (oldTask, newData, author) => {
    // updatedBy — 작성자와 마지막으로 고친 사람이 다를 때 창에서 구분해 보여준다.
    // 클라우드에서는 트리거(cards.updated_by)가 채운 값을 다시 받지만, 저장 직후에도
    // 바로 보이려면 여기서도 넣어야 한다. newData 뒤에 둬서 폼에 실려온 옛 값을 덮는다.
    const updated = { ...oldTask, ...newData, updatedAt: new Date().toISOString(), updatedBy: author };
    const logs = [];
    if (oldTask.status !== newData.status) logs.push(ActivityService.generateStatusLog(oldTask.status, newData.status, author));
    logs.push(...ActivityService.generateFieldLogs(oldTask, newData, author));
    if (logs.length) updated.activityLog = [...(updated.activityLog || []), ...logs];
    return { task: updated, logs };
  },
  update: (oldTask, newData, author) => TaskService.updateWithLogs(oldTask, newData, author).task,
  addComment: (task, text, author, parentId = null) => ({
    ...task,
    comments: [...(task.comments || []), { id: generateId(), author, text, timestamp: new Date().toISOString(), parentId }],
    activityLog: [...(task.activityLog || []), ActivityService.createLog(parentId ? '답글을 남겼습니다.' : '댓글을 남겼습니다.', author)]
  }),
  // 내용이 실제로 달라지지 않으면 task를 그대로(같은 참조로) 돌려준다
  // → (수정됨) 표시도, 활동 기록도, 서버 쓰기도 일어나지 않는다.
  updateComment: (task, commentId, newText, author) => {
    const target = (task.comments || []).find(c => c.id === commentId);
    if (!target || (target.text || '').trim() === (newText || '').trim()) return task;
    return {
      ...task,
      comments: (task.comments || []).map(c => c.id === commentId ? { ...c, text: newText, edited: true, updatedAt: new Date().toISOString() } : c),
      activityLog: [...(task.activityLog || []), ActivityService.createLog('댓글을 수정했습니다.', author)]
    };
  },
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
