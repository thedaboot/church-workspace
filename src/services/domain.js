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

// 본문을 고친 기록 한 줄 — 저장 길(generateFieldLogs)과 같이 쓰기의 세션 끝(controllers
// handleContentSession)이 같은 글자를 남긴다
export const CONTENT_LOG = '상세 내용을 수정했습니다.';
export const contentDiffers = (a, b) => normContent(a) !== normContent(b);

export const ActivityService = {
  createLog: (action, author) => ({ id: generateId(), action, author, timestamp: new Date().toISOString() }),
  generateStatusLog: (oldStatus, newStatus, author) => ActivityService.createLog(`상태를 '${oldStatus}'에서 '${newStatus}'(으)로 변경했습니다.`, author),

  // 상태 외 필드 변경도 활동 기록에 남긴다 (바뀐 항목만, 항목별로 1건)
  // skipContent — 본문을 조용히 저장할 때(같이 쓰기의 거울 · 게스트 본문 자동 저장). 그때 본문 기록은
  // 편집 세션이 끝날 때 한 줄만 남는다(controllers.handleContentSession) — 글자마다 한 줄씩 쌓이지 않게.
  generateFieldLogs: (oldTask, newData, author, { skipContent = false } = {}) => {
    const logs = [];
    const add = (msg) => logs.push(ActivityService.createLog(msg, author));

    if ((oldTask.title || '') !== (newData.title || '')) add(`제목을 '${newData.title || ''}'(으)로 변경했습니다.`);
    if (!skipContent && contentDiffers(oldTask.content, newData.content)) add(CONTENT_LOG);

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
    // 선행 업무(0020)는 id 배열이라 제목을 여기서 모른다 — 개수만 적는다.
    // 제목을 적으려고 전체 목록을 이 계층까지 끌고 오면 순수 로직이 스토어에 물린다.
    if (!sameItems(oldTask.dependsOn || [], newData.dependsOn || [])) {
      const n = (newData.dependsOn || []).length;
      add(n ? `선행 업무를 ${n}건으로 변경했습니다.` : '선행 업무를 모두 비웠습니다.');
    }
    return logs;
  },
};

// 상시면 날짜 두 칸을 비운다(앱 안의 빈 날짜는 '' — cloudSync.cardPatch가 null로 보낸다)
const ONGOING = '상시';
export const withoutDatesIfOngoing = (data) => (data?.status === ONGOING && (data.startDate || data.dueDate)
  ? { ...data, startDate: '', dueDate: '' }
  : data);

export const TaskService = {
  create: (rawData, author) => { const data = withoutDatesIfOngoing(rawData); return {
    ...data,
    id: generateId(),
    status: data.status || '시작 전',
    assignees: data.assignees || [],
    teams: data.teams || [],
    author,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // 만들자마자 '완료'인 업무도 있다(가져오기·이미 끝난 일 기록). DB는 0033의
    // insert 트리거가 같은 일을 한다.
    completedAt: (data.status || '시작 전') === '완료' ? new Date().toISOString() : '',
    comments: [],
    activityLog: [ActivityService.createLog('업무를 생성했습니다.', author)]
  }; },
  // 바뀐 업무와 **이번에 생긴 활동 기록**을 같이 돌려준다.
  //
  // 호출부가 나중에 "새 기록이 뭐였지"를 되계산하게 두면 안 된다. 예전에는 컨트롤러가
  // `task.activityLog.slice(oldData.activityLog.length)`로 잘라냈는데, oldData(업무 창을
  // 열 때의 스냅샷)와 newData(스토어를 따라가는 폼)가 **다른 스냅샷**이었다. 창을 열면
  // 상세 로드가 스토어에만 활동을 채우므로 oldData.activityLog는 빈 배열이고, 그래서
  // slice(0)이 되어 서버에 이미 있는 기록까지 새 것으로 보고 다시 넣었다
  // → activity_pkey 중복 → 카드는 저장됐는데 "저장에 실패했어요"가 떴다.
  // 만든 자리에서 같이 돌려주면 그 계산 자체가 사라진다.
  // 끝낸 시각 — 클라우드는 DB 트리거가 채우고(0033/0034), 게스트는 여기서 채운다.
  // 규칙이 같아야 한다: 완료로 **들어올 때만** 찍고, 완료에서 나가면 비우고,
  // 완료 → 완료(제목·첨부 수정)는 손대지 않는다(끝낸 날은 그날이다).
  completedAtFor: (oldStatus, newStatus, before) => {
    if (newStatus === '완료' && oldStatus !== '완료') return new Date().toISOString();
    if (newStatus !== '완료' && oldStatus === '완료') return '';
    return before || '';
  },
  updateWithLogs: (oldTask, rawData, author, { skipContent = false } = {}) => {
    // 상시(0075)는 마감이 없는 업무다 — **상시로 들어가거나 상시인 채로 저장될 때 시작일·마감일을 지운다**.
    // 저장 경로(업무 창 · 보드 끌기 · 상태 옮기기 · 목록 완료 되돌리기)가 모두 여기를 지나므로 한 곳에서 한다.
    // 아래 generateFieldLogs가 '마감일을 지웠습니다'를 남긴다(무엇이 사라졌는지 활동에 보인다).
    const newData = withoutDatesIfOngoing(rawData);
    // updatedBy — 작성자와 마지막으로 고친 사람이 다를 때 창에서 구분해 보여준다.
    // 클라우드에서는 트리거(cards.updated_by)가 채운 값을 다시 받지만, 저장 직후에도
    // 바로 보이려면 여기서도 넣어야 한다. newData 뒤에 둬서 폼에 실려온 옛 값을 덮는다.
    const updated = {
      ...oldTask, ...newData,
      updatedAt: new Date().toISOString(), updatedBy: author,
      completedAt: TaskService.completedAtFor(oldTask.status, newData.status, oldTask.completedAt),
    };
    const logs = [];
    if (oldTask.status !== newData.status) logs.push(ActivityService.generateStatusLog(oldTask.status, newData.status, author));
    logs.push(...ActivityService.generateFieldLogs(oldTask, newData, author, { skipContent }));
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
  // 처음 연 게스트(저장된 것이 없을 때)의 시연 데이터 — 시안 2026-10-16(보는 사람 직접 고르기 · 비밀번호를 까먹었어요 · 업무 링크 카드)이
  // 손을 대지 않고도 보이게 짰다. 스위트는 저마다 church_app_v4를 심고 들어오므로 여기를 타지 않는다.
  //   p2  직접 고른 사람만(웰컴팀 칩 + 교역자 한 사람 · 웰컴팀의 정하늘은 뺐다) — 사람은 data/guestPeople.js
  //   t3  김은지가 잠근 업무(비밀번호 1234 — viewPw와 같은 해시) · 나(홍길동)에게는 잠금 판이다
  //   t1  댓글에 공유 주소(`/s/t/…`) 셋 — 열리는 업무 · 잠긴 업무 · 스토어에 없는 업무(카드 없이 링크만)
  createWorkspace: () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const p1 = MockFactory.createProject('2026 여름 수련회 준비', [{ id: generateId(), title: '기획안 원본', url: '#' }]);
    const p2 = {
      ...MockFactory.createProject('새신자 초청 주일', []),
      visibility: 'custom', viewerTeams: ['웰컴팀'], visibilityBy: '홍길동',
      viewers: ['홍길동', '김은지', '이수빈', '최다은', '조은혜'],
    };
    const t2 = TaskService.create({ projectId: p1.id, title: '수련회 장소 답사', status: '진행 중', assignees: ['김은지', '박지훈', '홍길동', '임성빈'], teams: ['임원진'],
      content: '## 답사 일정\n- 7월 12일 토요일 오전에 출발해요\n- 숙소·식당·강당을 같이 봐요', startDate: '2026-07-01', dueDate: '2026-07-12' }, '홍길동');
    const t3 = {
      ...TaskService.create({ projectId: p1.id, title: '수련회 회비 정산', status: '시작 전', assignees: ['김은지'], teams: ['임원진'],
        content: '## 회비 내역\n- 1인 8만 원', dueDate: '2026-07-30' }, '김은지'),
      locked: true, lockedOpen: false,
      lockPw: { view_pw: '3266bab95f769e008ab30ddde7200901e0a8fef887f44002ff1daaff3aac22c8', view_pw_salt: 'demo-salt-0001' },
    };
    const t4 = TaskService.create({ projectId: p2.id, title: '새신자 환영 선물 준비', status: '시작 전', assignees: ['이수빈', '최다은'], teams: ['웰컴팀'],
      content: '', dueDate: '2026-08-09' }, '홍길동');
    const at = (d) => `2026-07-0${d}T09:00:00.000Z`;
    const cmt = (author, text, d) => ({ id: generateId(), author, text, timestamp: at(d), parentId: null, edited: false });
    const t1 = {
      ...TaskService.create({ projectId: p1.id, title: '수련회 포스터 디자인', status: '진행 중', assignees: ['홍길동'], teams: ['미디어팀'],
        content: `여름 수련회 포스터 업무입니다.\n장소는 답사 뒤에 정해져요 ${origin}/s/t/${t2.id}`, dueDate: '2026-07-25' }, '임성빈'),
      comments: [
        cmt('임성빈', `장소가 정해지면 포스터에 넣어 주세요\n${origin}/s/t/${t2.id}`, 2),
        cmt('김은지', `회비 금액은 여기 정리해 둘게요\n${origin}/s/t/${t3.id}`, 3),
        cmt('박지훈', `작년 포스터는 여기 있어요\n${origin}/s/t/${generateId()}`, 4),
      ],
    };
    return {
      // 시안 표시 — 이 시연 데이터로 뜬 게스트에서만 시안 화면(보는 사람 직접 고르기 · 비밀번호를 까먹었어요)이 선다.
      // 스위트가 심는 상태에는 없어서 기존 화면(리더만 보기 토글 · 잠금 판)을 그대로 본다.
      demo: true,
      currentUser: MockFactory.createUser(),
      projects: normalize([p1, p2]),
      tasks: normalize([t1, t2, t3, t4])
    };
  }
};
