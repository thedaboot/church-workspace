// ============================================================================
// 시연 씨앗(시안 mock/b3 · v5 2묶음 '업무 편의' — 표 · 간트 · 댓글 고정·해결 · 이번 주 일정 한 번에 추가)
// ----------------------------------------------------------------------------
// **미리보기(vercel.app 등 localhost 밖) 게스트에서만**, 그리고 저장 자리가 **비어 있을 때만** 한 번 심는다.
// 로컬(검사 스위트)은 건드리지 않는다 — 스위트는 빈 저장소에서 시작하는 것을 단정한다. 로컬에서 보려면 `?demo`.
// main.jsx의 **첫 import**라 스토어(workspaceStore — 모듈을 읽는 순간 church_app_v4를 읽는다)보다 먼저 돈다.
// 날짜는 오늘을 기준으로 앞뒤에 놓는다(간트의 오늘 선·4주 창이 언제 열어도 차 있게).
// 실제 앱에는 들어가지 않는다(시안 브랜치에만).
// ============================================================================
const want = (() => {
  try {
    if (typeof window === 'undefined' || import.meta.env.VITE_SUPABASE_URL) return false;
    const h = window.location.hostname;
    return /[?&]demo\b/.test(window.location.search) || !(h === 'localhost' || h === '127.0.0.1');
  } catch { return false; }
})();

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };
const at = (n, h = 10) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };

function workspace() {
  const P = 'demo-p1';
  const T = (id, title, status, teams, assignees, s, e, extra = {}) => ({
    id, projectId: P, title, status, teams, assignees,
    startDate: s == null ? '' : day(s), dueDate: e == null ? '' : day(e),
    content: '', author: '홍길동', createdAt: at(-30), updatedAt: at(-1), completedAt: status === '완료' ? at(-3) : '',
    comments: [], activityLog: [], attachments: [], dependsOn: [], subtasks: [], ...extra,
  });
  const sub = (id, list) => list.map(([title, done], i) => ({ id: `${id}-s${i}`, title, done }));
  const c = (id, author, text, ago, extra = {}) => ({ id, author, text, timestamp: at(-ago, 9 + (ago % 8)), parentId: null, ...extra });
  const tasks = [
    T('demo-t1', '축제 기획안 확정', '완료', ['임원진'], ['홍길동'], -24, -17, { subtasks: sub('t1', [['예산 초안', true], ['장소 후보 정리', true], ['교역자 검토', true]]) }),
    T('demo-t2', '장소 대관 신청', '완료', ['임원진'], ['김윤주'], -16, -12, { dependsOn: ['demo-t1'] }),
    T('demo-t3', '포스터 디자인', '진행 중', ['미디어팀'], ['박지호'], -9, 3, {
      dependsOn: ['demo-t1'],
      subtasks: sub('t3', [['시안 두 가지', true], ['문구 확정', true], ['인쇄용 파일', false], ['SNS용 크기', false]]),
      comments: [
        c('demo-c1', '김윤주', '포스터 날짜는 행사 당일 기준으로 넣어 주세요. 장소 약도도 아래에 작게 넣어 주시면 좋겠어요.', 6, { pinnedAt: at(-5), pinnedBy: '김윤주' }),
        c('demo-c2', '박지호', '시안 A·B 올렸어요. 어느 쪽이 좋을까요?', 4, { resolvedAt: at(-2), resolvedBy: '박지호' }),
        { id: 'demo-c2r1', author: '홍길동', text: 'A가 좋아 보여요! 색만 조금 밝게요.', timestamp: at(-3, 14), parentId: 'demo-c2' },
        { id: 'demo-c2r2', author: '박지호', text: '네, A로 갈게요.', timestamp: at(-3, 18), parentId: 'demo-c2' },
        c('demo-c3', '조해리', '인쇄소는 어디로 할까요? 지난번 그 인쇄소 연락처 아시는 분 계신가요?', 1),
        c('demo-c4', '홍길동', '인쇄용 파일 나오면 바로 넘길게요.', 0),
      ],
    }),
    T('demo-t4', '초청 영상 촬영', '진행 중', ['미디어팀', '찬양팀'], ['이하랑', '박지호'], -4, 8, { dependsOn: ['demo-t1'], subtasks: sub('t4', [['콘티', true], ['촬영', false], ['편집', false]]) }),
    T('demo-t5', '찬양 콘티 정하기', '시작 전', ['찬양팀'], ['이하랑'], 2, 10),
    T('demo-t6', '음향 장비 점검', '시작 전', ['엔지니어팀'], ['정민수'], 8, 13, { dependsOn: ['demo-t2'] }),
    T('demo-t7', '안내 봉사자 모집', '보류 중', ['웰컴팀'], ['조해리'], -2, 12),
    T('demo-t8', '새가족 선물 준비', '시작 전', ['웰컴팀'], ['조해리', '김윤주'], 12, 19, { subtasks: sub('t8', [['품목 고르기', false], ['주문', false]]) }),
    T('demo-t9', '홍보 SNS 게시', '시작 전', ['미디어팀'], ['박지호'], 4, 16, { dependsOn: ['demo-t3'] }),
    T('demo-t10', '리허설', '시작 전', ['찬양팀', '엔지니어팀'], ['이하랑', '정민수'], 19, 20, { dependsOn: ['demo-t5', 'demo-t6'] }),
    T('demo-t11', '축제 당일 진행', '시작 전', ['임원진'], ['홍길동'], 21, 21, { dependsOn: ['demo-t10'] }),
    T('demo-t12', '정산·감사 인사', '시작 전', ['임원진'], ['김윤주'], 22, 28, { dependsOn: ['demo-t11'] }),
    T('demo-t13', '예배 순번표', '상시', ['임원진'], ['홍길동'], null, null),
    T('demo-t14', '현수막 문구', '시작 전', ['미디어팀'], [], null, null),
  ].map((t, i) => ({ ...t, position: i }));
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  return {
    currentUser: { name: '홍길동', team: '미디어팀' },
    projects: { byId: {
      [P]: { id: P, title: '2026 가을 전도 축제', pinnedLinks: [] },
      'demo-p2': { id: 'demo-p2', title: '새신자 초청 주일', pinnedLinks: [] },
    }, allIds: [P, 'demo-p2'] },
    tasks: { byId, allIds: tasks.map(t => t.id) },
  };
}

// 가장 가까운 지난 주일(오늘이 주일이면 오늘)의 발행 주보 하나 — 광고 여섯 중 날짜가 읽히는 것 넷
function worship() {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay());
  const sun = iso(d);
  const md = (n, wd = true) => { const x = new Date(d); x.setDate(x.getDate() + n); const W = '일월화수목금토'[x.getDay()]; return `${x.getMonth() + 1}월 ${x.getDate()}일${wd ? ` (${W === '일' ? '주일' : W})` : ''}`; };
  return {
    services: [{
      id: 'demo-s1', kind: 'sunday', service_date: sun, status: 'published', title: '두려워하지 말라', passage_ref: '이사야 41:10',
      preacher: '김사랑 전도사', praise_leader: '이하랑', praise_playlist_url: '', attendance_note: '', created_at: at(-7),
      roles: [{ role: '대표기도', name: '김윤주' }, { role: '헌금봉헌', name: '박지호' }],
      songs: [{ title: '주 은혜임을' }, { title: '나의 반석이신 하나님' }],
      notices: [
        { title: '가을 전도 축제', body: `${md(6)} 오후 2시 본당에서 가을 전도 축제가 있어요. 친구와 함께 와 주세요.` },
        { title: '청년부 리더 모임', body: `${md(3)} 오후 7시 30분 소예배실` },
        { title: '새가족 환영회', body: `${md(7)} 예배 후 카페에서 새가족 환영회가 있어요.` },
        { title: '가을 야유회 신청 마감', body: `${md(5, false)}까지 순장에게 신청해 주세요.` },
        { title: '다음 주 예배 위원', body: '대표기도: 이수빈 형제\n헌금봉헌: 조해리 자매' },
        { title: '생일 축하', body: '이번 주 생일: 박지호 형제' },
      ],
    }],
  };
}

if (want) {
  try {
    if (!localStorage.getItem('church_app_v4')) localStorage.setItem('church_app_v4', JSON.stringify(workspace()));
    if (!localStorage.getItem('church_worship_v1')) localStorage.setItem('church_worship_v1', JSON.stringify(worship()));
  } catch { /* 저장소가 막힌 브라우저 — 빈 채로 */ }
}
