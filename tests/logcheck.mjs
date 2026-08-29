import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TaskService, ActivityService } from 'file:///C:/Users/%EB%85%B8%EC%A4%80%EC%84%9D/Desktop/church_workspace/src/services/domain.js';

const base = { id: 't1', projectId: 'p1', title: '수련회 준비', content: '내용', status: '시작 전',
  assignees: ['노준석'], teams: ['미디어팀'], startDate: '2026-08-01', dueDate: '2026-08-10', activityLog: [], comments: [] };
const msgs = (old, next) => ActivityService.generateFieldLogs(old, { ...old, ...next }, '노준석').map(l => l.action);

// 변경 없음 → 기록 없음
assert.deepStrictEqual(msgs(base, {}), []);
// 순서만 바뀐 배열은 변경 아님
assert.deepStrictEqual(msgs({ ...base, teams: ['미디어팀', '워십팀'] }, { teams: ['워십팀', '미디어팀'] }), []);
// 항목별 문구
assert.deepStrictEqual(msgs(base, { title: '수련회 최종 준비' }), ["제목을 '수련회 최종 준비'(으)로 변경했습니다."]);
assert.deepStrictEqual(msgs(base, { content: '바뀐 내용' }), ['상세 내용을 수정했습니다.']);
assert.deepStrictEqual(msgs(base, { dueDate: '2026-08-15' }), ['마감일을 2026년 8월 15일로 변경했습니다.']);
assert.deepStrictEqual(msgs(base, { startDate: '' }), ['시작일을 지웠습니다.']);
assert.deepStrictEqual(msgs(base, { assignees: ['노준석', '홍길동'] }), ['담당자를 노준석, 홍길동(으)로 변경했습니다.']);
assert.deepStrictEqual(msgs(base, { assignees: [] }), ['담당자를 모두 비웠습니다.']);
assert.deepStrictEqual(msgs(base, { teams: ['워십팀'] }), ['담당 팀을 워십팀(으)로 변경했습니다.']);
assert.deepStrictEqual(msgs(base, { teams: [] }), ['담당 팀을 모두 비웠습니다.']);
// 여러 항목 동시 변경 → 항목별로 1건씩
assert.strictEqual(msgs(base, { title: 'A', dueDate: '2026-09-01', teams: [] }).length, 3);

// update(): 상태 로그가 먼저, 그다음 필드 로그
const upd = TaskService.update(base, { ...base, status: '보류 중', title: '보류된 업무' }, '노준석');
assert.deepStrictEqual(upd.activityLog.map(l => l.action), [
  "상태를 '시작 전'에서 '보류 중'(으)로 변경했습니다.",
  "제목을 '보류된 업무'(으)로 변경했습니다.",
]);
// 상태만 바꾸는 드래그 → 1건만
assert.strictEqual(TaskService.update(base, { ...base, status: '완료' }, '노준석').activityLog.length, 1);
// 아무것도 안 바뀐 저장 → 기록 없음
assert.strictEqual(TaskService.update(base, { ...base }, '노준석').activityLog.length, 0);

// 댓글·답글·수정
assert.deepStrictEqual(TaskService.addComment(base, '안녕', '노준석').activityLog.map(l => l.action), ['댓글을 남겼습니다.']);
assert.deepStrictEqual(TaskService.addComment(base, '답', '노준석', 'c1').activityLog.map(l => l.action), ['답글을 남겼습니다.']);
const withC = TaskService.addComment(base, '원문', '노준석');
const edited = TaskService.updateComment(withC, withC.comments[0].id, '고침', '노준석');
assert.deepStrictEqual(edited.activityLog.map(l => l.action), ['댓글을 남겼습니다.', '댓글을 수정했습니다.']);
assert.strictEqual(edited.comments[0].text, '고침');
assert.strictEqual(edited.comments[0].edited, true);
// 삭제도 기존대로 기록
assert.ok(TaskService.deleteComment(withC, withC.comments[0].id, '노준석').activityLog.some(l => l.action === '댓글을 삭제했습니다.'));
// 모든 로그에 작성자·시간·id
for (const l of edited.activityLog) { assert.ok(l.id && l.author === '노준석' && l.timestamp); }

console.log('활동 기록 로직 자체검증 통과 (22 asserts)');

// ── 하위 업무 진척 (utils.subtaskProgress) ──
// 보드 카드와 업무 창이 같은 함수를 쓴다. 0/0에서 NaN이 나오면 카드가 통째로 깨진다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir2 = mkdtempSync(join(tmpdir(), 'sub-'));
  const f2 = join(dir2, 'utils.mjs');
  writeFileSync(f2, src);
  const { subtaskProgress } = await import(pathToFileURL(f2).href);
  assert.deepStrictEqual(subtaskProgress([]), { total: 0, done: 0, ratio: 0 }, '빈 목록은 0/0 · 비율 0(NaN 금지)');
  assert.deepStrictEqual(subtaskProgress(), { total: 0, done: 0, ratio: 0 }, '인자가 없어도 안전하다');
  assert.deepStrictEqual(
    subtaskProgress([{ done: true }, { done: false }, { done: true }]),
    { total: 3, done: 2, ratio: 2 / 3 });
  assert.deepStrictEqual(subtaskProgress([{ done: true }]), { total: 1, done: 1, ratio: 1 }, '전부 끝나면 1');
  console.log('PASS  하위 업무 진척 4가지');

  // ── 고정 요약이 낡았나 (utils.summaryOutdated) ──
  // 고정 쓰기 자체가 updated_at을 올린다(트리거·서버 시계) — ai_summary_at은 클라이언트
  // 시계라 방금 고정한 것이 시계 어긋남만큼 낡음으로 보일 수 있어 1분 여유를 둔다.
  const { summaryOutdated } = await import(pathToFileURL(f2).href);
  assert.strictEqual(summaryOutdated('2026-08-29T10:05:00Z', '2026-08-29T10:00:00Z'), true, '고정 뒤에 바뀌면 낡음');
  assert.strictEqual(summaryOutdated('2026-08-29T10:00:30Z', '2026-08-29T10:00:00Z'), false, '1분 안(시계 어긋남)은 낡음이 아니다');
  assert.strictEqual(summaryOutdated('2026-08-29T09:00:00Z', '2026-08-29T10:00:00Z'), false, '고정이 더 나중이면 낡음이 아니다');
  assert.strictEqual(summaryOutdated('', '2026-08-29T10:00:00Z'), false, '시각이 없으면 조용히 거짓');
  assert.strictEqual(summaryOutdated('2026-08-29T10:05:00Z', ''), false);
  console.log('PASS  고정 요약 낡음 판정 5가지');

  // ── 업무 줄의 팀 표시 (utils.teamsLabel) ──
  // 원래 버그: teams[0] 하나만 그려서 여러 팀이 붙은 업무는 나머지가 화면 어디에도
  // 없었다 — "9월 월례회는 웰컴팀 일"로 읽혔다(사용자 지적 2026-08-29).
  const { teamsLabel } = await import(pathToFileURL(f2).href);
  assert.deepStrictEqual(teamsLabel(['웰컴팀']), { lead: '웰컴팀', more: 0 }, '한 팀이면 외 N팀이 없다');
  assert.deepStrictEqual(teamsLabel(['웰컴팀', '찬양팀', '미디어팀']), { lead: '웰컴팀', more: 2 }, '세 팀이면 외 2팀');
  // 같은 팀이 두 번 들어가면 '외 1팀'이 뜨는데, 화면에는 팀이 하나뿐이라 거짓말이 된다
  assert.deepStrictEqual(teamsLabel(['웰컴팀', '웰컴팀']), { lead: '웰컴팀', more: 0 }, '중복은 한 팀으로 센다');
  assert.deepStrictEqual(teamsLabel(['', '찬양팀']), { lead: '찬양팀', more: 0 }, '빈 값은 팀이 아니다');
  assert.strictEqual(teamsLabel([]), null, '팀이 없으면 줄을 그리지 않는다');
  assert.strictEqual(teamsLabel(undefined), null, '값이 없어도 안전하다');
  console.log('PASS  업무 줄 팀 표시 6가지');

  // ── 대시보드 '프로젝트 진행'의 연도 (utils.projectYear · projectsOfYear) ──
  // 원래 버그: selectActiveProjectsList가 **보관 여부만** 걸러서, 보관하지 않은
  // 프로젝트가 해마다 쌓이면 이 칸만 끝없이 길어졌다(사용자 지적 2026-08-29).
  // 규칙은 탭 줄과 **한 벌**이어야 한다 — 두 벌이면 탭에는 있는데 대시보드에는 없는 해가 생긴다.
  const { projectYear, projectsOfYear } = await import(pathToFileURL(f2).href);
  const thisYear = String(new Date().getFullYear());
  assert.strictEqual(projectYear({ year: 2027 }), '2027', '숫자 연도도 문자열로');
  assert.strictEqual(projectYear({ year: '2027', createdAt: '2026-01-02T00:00:00Z' }), '2027', '사람이 정한 값이 만든 해를 이긴다');
  assert.strictEqual(projectYear({ createdAt: '2025-03-04T00:00:00Z' }), '2025', '값이 없으면 만든 해로');
  assert.strictEqual(projectYear({}), thisYear, '둘 다 없으면 올해로 — 목록에서 사라지지 않는다');
  // 연도를 못 박은 것들만 — 해가 바뀌어도 이 단정은 안 흔들린다
  const P = [
    { id: 'p1', title: '9월 월례회', year: 2026 },
    { id: 'p2', title: '2027 신년 감사예배', year: 2027 },
    { id: 'p3', title: '옛 프로젝트', createdAt: '2025-05-05T00:00:00Z' },
  ];
  assert.deepStrictEqual(projectsOfYear(P, 2026).map(p => p.id), ['p1'], '숫자로 물어도 걸린다');
  assert.deepStrictEqual(projectsOfYear(P, '2026').map(p => p.id), ['p1'], '문자열로 물어도 같다');
  assert.deepStrictEqual(projectsOfYear(P, '2025').map(p => p.id), ['p3'], '만든 해로 떨어진 것도 걸린다');
  assert.deepStrictEqual(projectsOfYear(P, '2099'), [], '그 해에 없으면 빈 목록');
  assert.deepStrictEqual(projectsOfYear(undefined, '2026'), [], '인자가 없어도 안전하다');
  // 연도도 만든 날짜도 없는 행은 **올해**에 선다 — 거르면 게스트 모드에서 목록이 통째로 빈다
  const orphan = [{ id: 'p4', title: '연도가 아예 없는 것' }];
  assert.deepStrictEqual(projectsOfYear(orphan, thisYear).map(p => p.id), ['p4'], '연도가 없는 것은 올해에 선다');
  assert.deepStrictEqual(projectsOfYear(orphan, '2099'), [], '다른 해에는 서지 않는다');
  console.log('PASS  프로젝트 연도 11가지');

  // ── 달력에 얹히는 업무 (utils.datedTasks) ──
  // 원래 버그: 팀 칩이 전부를 세서 `웰컴팀 7`이라 해놓고 달력에는 띠가 3개만 떴다.
  // 실데이터에서 7건 중 4건이 마감 미정(9·10·11·12월 월례회)이었다 — 달력이 빠뜨린 것이
  // 아니라 같은 화면에 셈의 기준이 둘이었다(사용자 지적 2026-08-29).
  const { datedTasks } = await import(pathToFileURL(f2).href);
  const S = [
    { id: 'a', title: '8월 월례회', dueDate: '2026-08-30' },
    { id: 'b', title: '수련회 홍보용 슈링클스', startDate: '2026-07-10', dueDate: '' },
    { id: 'c', title: '9월 월례회' },                                  // 마감 미정
    { id: 'd', title: '10월 월례회', startDate: '', dueDate: '' },      // 빈 문자열도 미정이다
    { id: 'e', title: '피드백 및 강평회', dueDate: '2026-08-31' },
  ];
  assert.deepStrictEqual(datedTasks(S).map(t => t.id), ['a', 'b', 'e'], '날짜가 하나라도 있어야 달력에 선다');
  assert.strictEqual(datedTasks(S).length, 3, '실데이터와 같은 모양 — 7건 중 3건');
  assert.deepStrictEqual(datedTasks([]), [], '빈 목록');
  assert.deepStrictEqual(datedTasks(undefined), [], '인자가 없어도 안전하다');
  assert.deepStrictEqual(datedTasks([null, { id: 'z', dueDate: '2026-01-01' }]).map(t => t.id), ['z'], '빈 칸이 섞여도 안 던진다');
  console.log('PASS  달력에 얹히는 업무 5가지');

  // ── 대시보드 인사말이 세는 범위 (utils.myScope) ──
  // 원래 버그: 인사말이 세그먼트를 따라가는 목록을 세서, 미디어팀 박지호의 지연 한 건이
  // "노준석님, 밀린 업무부터 정리해봐요"로 떴다. 남의 지연을 내 이름으로 나무라는 문장.
  const { myScope } = await import(pathToFileURL(f2).href);
  const T = [
    { id: 'a', title: '찬양 송폼 제작', assignees: ['노준석'] },
    { id: 'b', title: '홍보 영상 편집', assignees: ['박지호'] },       // 남의 것
    { id: 'c', title: '수련회 현수막', assignees: [] },                 // 담당자 없음 = 공통
    { id: 'd', title: '차량 배차', assignees: ['노준석', '조준환'] },   // 같이 맡음
    { id: 'e', title: '간식 준비' },                                    // assignees 자체가 없음
  ];
  const ids = myScope(T, '노준석').map(t => t.id);
  assert.deepStrictEqual(ids, ['a', 'c', 'd', 'e'], '내 것 + 담당자 없는 것');
  assert.ok(!ids.includes('b'), '남의 업무는 인사말에서 세지 않는다');
  assert.deepStrictEqual(myScope(T, '박지호').map(t => t.id), ['b', 'c', 'e'], '사람이 바뀌면 따라온다');
  assert.deepStrictEqual(myScope([], '노준석'), [], '빈 목록');
  assert.deepStrictEqual(myScope(undefined, '노준석'), [], '인자가 없어도 안전하다');
  // 이름이 비면 담당자 없는 것만 남는다(로그인 직후 이름이 흔들릴 때 남의 것이 섞이면 안 된다)
  assert.deepStrictEqual(myScope(T, '').map(t => t.id), ['c', 'e'], '이름이 비면 공통만');
  console.log('PASS  인사말 범위 6가지');
}

// ── 이번에 생긴 활동 기록만 저장한다 (TaskService.updateWithLogs) ──
// 업무 저장이 여기서 깨졌었다. 컨트롤러가 task.activityLog.slice(oldData.activityLog.length)로
// 새 기록을 되계산했는데, oldData(업무 창을 열 때의 스냅샷)는 activityLog가 비어 있고
// newData(스토어를 따라가는 폼)는 서버에서 읽은 기록으로 차 있다. 그래서 slice(0)이 되어
// 서버에 이미 있는 기록까지 다시 넣었다 → activity_pkey 중복 → "저장에 실패했어요".
{
  const L = (id) => ({ id, action: '예전 기록', author: '노준석', timestamp: '2026-07-01' });
  // 창을 열 때의 스냅샷: 상세 로드는 스토어에만 반영되므로 활동이 비어 있다
  const opened = { ...base, activityLog: [] };
  // 폼: 스토어를 따라가므로 서버에서 읽은 기록 3건이 들어 있다
  const form = { ...base, activityLog: [L('a'), L('b'), L('c')], title: '수련회 준비 (수정)' };

  const { task, logs } = TaskService.updateWithLogs(opened, form, '노준석');
  assert.strictEqual(logs.length, 1, '이번에 바꾼 것은 제목 하나 → 새 기록도 하나여야 한다');
  assert.match(logs[0].action, /제목을/);
  assert.ok(!logs.some(l => ['a','b','c'].includes(l.id)), '서버에 이미 있는 기록이 섞이면 안 된다');
  assert.strictEqual(task.activityLog.length, 4, '스토어에는 기존 3건 + 새 1건이 남는다');

  // 옛 방식이었다면 4건 전부를 '새 기록'으로 보냈다 — 그게 중복의 원인이었다
  const oldWay = task.activityLog.slice((opened.activityLog || []).length);
  assert.strictEqual(oldWay.length, 4, '(참고) 개수로 자르면 4건이 되어 이미 있는 3건을 다시 넣는다');

  // 바뀐 것이 없으면 기록도 없다
  assert.deepStrictEqual(TaskService.updateWithLogs(opened, { ...form, title: base.title }, '노준석').logs, []);
  console.log('PASS  새 활동 기록만 저장 5가지');
}

// ── 프로필 사진 주소 https 승격 (utils.httpsImage) ──
// 카카오 로그인이 http 주소를 준다. https 페이지에서 http 이미지는 브라우저가 혼합
// 콘텐츠로 막아 버려서, 카카오로 가입한 사람만 사진이 안 보였다(구글은 이미 https).
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'img-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { httpsImage } = await import(pathToFileURL(f).href);
  assert.strictEqual(httpsImage('http://k.kakaocdn.net/dn/a/b.jpg'), 'https://k.kakaocdn.net/dn/a/b.jpg');
  assert.strictEqual(httpsImage('HTTP://img1.kakaocdn.net/x.png'), 'https://img1.kakaocdn.net/x.png', '대문자도');
  assert.strictEqual(httpsImage('https://lh3.googleusercontent.com/a/x'), 'https://lh3.googleusercontent.com/a/x', '이미 https면 그대로');
  assert.strictEqual(httpsImage(''), '', '빈 값은 빈 값 — 화면은 이름 첫 글자로 떨어진다');
  assert.strictEqual(httpsImage(null), '', 'null도 안전하다');
  assert.strictEqual(httpsImage(undefined), '', 'undefined도 안전하다');
  // 주소 한가운데의 http는 건드리지 않는다(?url=http://... 같은 경우)
  assert.strictEqual(httpsImage('https://x.com/i?u=http://y.com/a.png'), 'https://x.com/i?u=http://y.com/a.png');
  console.log('PASS  프로필 사진 https 승격 7가지');
}

// ── 대시보드 사람 칸 (utils.seenToday / birthdaysWithin / joinedWithin) ──
// 생일은 'MM-DD'만 저장하므로 연도를 빌려 비교한다 → 연말연시가 조용히 깨지기 쉽다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'ppl-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { seenToday, birthdaysWithin, joinedWithin, localDate } = await import(pathToFileURL(f).href);

  // 오늘 다녀간 사람 — 나는 언제나 포함(App이 찍는 값은 방금 읽은 목록에 아직 없다)
  const M = [
    { name: '노준석', lastSeenAt: '' },                                  // 나 — 기록 없어도 포함
    { name: '강희라', lastSeenAt: '2026-08-05T01:00:00Z' },              // 오늘
    { name: '조준환', lastSeenAt: '2026-07-30T10:00:00Z' },              // 지난주
    { name: '김윤주' },                                                   // 값 자체가 없음
  ];
  const names = (a) => a.map(m => m.name);
  assert.deepStrictEqual(names(seenToday(M, '노준석', localDate('2026-08-05T09:00:00'))), ['노준석', '강희라']);
  assert.deepStrictEqual(names(seenToday(M, '', localDate('2026-08-05T09:00:00'))), ['강희라'], '이름이 비면 나를 안 넣는다');
  assert.deepStrictEqual(seenToday([], '노준석'), [], '빈 목록');
  assert.deepStrictEqual(seenToday(undefined, '노준석'), [], '인자가 없어도 안전하다');

  // 이번 주 생일 — 실제 값으로
  const B = [
    { name: '박지호', birthday: '08-07' }, { name: '조해리', birthday: '08-25' },
    { name: '노준석', birthday: '05-26' }, { name: '없는사람', birthday: '' },
    { name: '형식틀림', birthday: '8-7' },
  ];
  const r = birthdaysWithin(B, 7, new Date(2026, 7, 5));   // 2026-08-05
  assert.deepStrictEqual(names(r), ['박지호'], '7일 안은 8월 7일 하나');
  assert.strictEqual(r[0].inDays, 2);
  assert.strictEqual(r[0].month, 8);
  assert.strictEqual(r[0].day, 7);
  // 오늘이 생일이면 0일
  assert.strictEqual(birthdaysWithin(B, 7, new Date(2026, 7, 7))[0].inDays, 0, '오늘 생일은 0');
  // 연말연시를 넘어간다 — 12월 31일에 1월 2일 생일이 보여야 한다(연도를 빌려 비교하므로
  // 올해 것만 보면 이 줄이 통째로 빠진다. 가장 필요한 순간에 빠지는 실패다)
  const NY = [{ name: '새해', birthday: '01-02' }];
  const ny = birthdaysWithin(NY, 7, new Date(2026, 11, 31));
  assert.deepStrictEqual(names(ny), ['새해'], '12/31에 1/2 생일이 보인다');
  assert.strictEqual(ny[0].inDays, 2);
  // 형식이 틀린 값은 조용히 뺀다(체크 제약이 DB에 있지만 옛 행이 섞일 수 있다)
  assert.ok(!names(birthdaysWithin(B, 400, new Date(2026, 7, 5))).includes('형식틀림'));
  assert.deepStrictEqual(birthdaysWithin([], 7), [], '빈 목록');
  assert.deepStrictEqual(birthdaysWithin(undefined, 7), [], '인자가 없어도 안전하다');

  // 새로 온 사람
  const J = [
    { name: '강희라', joinedAt: '2026-08-02T10:35:52Z' },
    { name: '김윤주', joinedAt: '2026-07-26T10:59:33Z' },
    { name: '값없음' },
  ];
  assert.deepStrictEqual(names(joinedWithin(J, 7, '2026-08-05')), ['강희라']);
  assert.deepStrictEqual(joinedWithin(J, 7, '2026-08-20'), [], '2주 지나면 사라진다');
  console.log('PASS  사람 칸 14가지');
}

// ── 가입한 사람 전체 목록 (utils.visitOrder / agoLabel) ──
// 머리줄 'N명'을 누르면 열리는 모달이 쓴다. 최근에 방문한 사람이 위, 접속 중이면 맨 위,
// 목록 수는 머리줄 숫자와 **같아야** 한다 — 기록 없는 사람을 빼면 눌러 놓고 세어 봤을 때
// 화면이 서로 다른 말을 한다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'ord-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { visitOrder, agoLabel, joinedWithin, lastVisitOf } = await import(pathToFileURL(f).href);

  const M = [
    { id: 'a', name: '어제옴', lastSeenAt: '2026-08-04T10:00:00Z' },
    { id: 'b', name: '방금옴', lastSeenAt: '2026-08-05T09:00:00Z' },
    { id: 'c', name: '접속중', lastSeenAt: '2026-08-01T00:00:00Z' },   // 옛 기록이어도 접속 중이면 맨 위
    { id: 'd', name: '기록없음' },
  ];
  const o = visitOrder(M, new Set(['c']));
  assert.deepStrictEqual(o.map(m => m.name), ['접속중', '방금옴', '어제옴', '기록없음'],
    '접속 중 → 최근 방문 → 기록 없음 순');
  assert.strictEqual(o.length, M.length, '아무도 빠지지 않는다(머리줄 숫자와 같아야 한다)');
  assert.deepStrictEqual(visitOrder(M).map(m => m.name), ['방금옴', '어제옴', '접속중', '기록없음'],
    '접속 정보가 없으면(게스트) 순수 방문순');
  assert.deepStrictEqual(visitOrder([]), []);
  assert.deepStrictEqual(visitOrder(undefined), [], '인자가 없어도 안전하다');

  // 초 → 분 → 시간 → 일 → 개월 → 년 (사용자가 정한 단위 사다리)
  const NOW = new Date('2026-08-05T12:00:00Z').getTime();
  const at = (ms) => new Date(NOW - ms).toISOString();
  assert.strictEqual(agoLabel(at(30e3), NOW), '30초 전');
  assert.strictEqual(agoLabel(at(0), NOW), '1초 전', '0초는 1초로 올린다(0초 전은 이상하다)');
  assert.strictEqual(agoLabel(at(5 * 60e3), NOW), '5분 전');
  assert.strictEqual(agoLabel(at(3 * 3600e3), NOW), '3시간 전');
  assert.strictEqual(agoLabel(at(2 * 86400e3), NOW), '2일 전');
  assert.strictEqual(agoLabel(at(10 * 86400e3), NOW), '1주 전', '7일부터는 주 단위(사용자 추가)');
  assert.strictEqual(agoLabel(at(45 * 86400e3), NOW), '1개월 전');
  assert.strictEqual(agoLabel(at(400 * 86400e3), NOW), '1년 전');
  assert.strictEqual(agoLabel('', NOW), '', '값이 없으면 빈 문자열 → 화면이 "아직 방문 전"으로 받는다');
  assert.strictEqual(agoLabel(at(-60e3), NOW), '', '미래 시각은 빈 문자열(시계가 어긋난 기기)');

  // 환영은 사흘만(사용자 판단) — 나흘 전은 빠진다
  const J = [
    { name: '사흘', joinedAt: '2026-08-02T00:00:00Z' },
    { name: '나흘', joinedAt: '2026-08-01T00:00:00Z' },
  ];
  assert.deepStrictEqual(joinedWithin(J, 3, '2026-08-05').map(m => m.name), ['사흘']);

  // 방문 기록이 없으면 가입 시각으로 대신한다 — 가입하던 순간에도 앱에 있었다.
  // 0019 이전 가입자에게 '아직 방문 전'이라고 하던 것이 틀린 말이었다(사용자 지적).
  assert.strictEqual(lastVisitOf({ lastSeenAt: 'A', joinedAt: 'B' }), 'A');
  assert.strictEqual(lastVisitOf({ joinedAt: 'B' }), 'B', '기록이 없으면 가입 시각');
  assert.strictEqual(lastVisitOf({}), '');
  const F = [
    { id: 'x', name: '가입만', joinedAt: '2026-08-04T00:00:00Z' },
    { id: 'y', name: '방문함', lastSeenAt: '2026-08-01T00:00:00Z' },
  ];
  assert.deepStrictEqual(visitOrder(F).map(m => m.name), ['가입만', '방문함'],
    '가입 시각도 방문으로 세서 최근 순에 낀다');
  console.log('PASS  방문 순서·시간 단위 20가지');
}

// ── 선후관계 열 배치 (utils.depLayers) ──
// 프로젝트 '그래프' 보기가 쓴다. 선행 업무보다 오른쪽 열에 와야 하고, 지워진 카드를
// 가리키는 id와 순환은 화면을 죽이지 말고 조용히 넘겨야 한다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'dep-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { depLayers } = await import(pathToFileURL(f).href);

  const T = (id, deps = [], dueDate = '') => ({ id, title: id, dependsOn: deps, dueDate });
  // 사슬: a → b → c (b는 a 뒤, c는 b 뒤)
  const chain = depLayers([T('c', ['b']), T('a'), T('b', ['a'])]);
  assert.deepStrictEqual(chain.map(col => col.map(t => t.id)), [['a'], ['b'], ['c']]);
  // 갈래: d는 a·b 둘 다 끝나야 → 둘 중 깊은 쪽 + 1
  const merge = depLayers([T('a'), T('b', ['a']), T('d', ['a', 'b'])]);
  assert.deepStrictEqual(merge.map(col => col.map(t => t.id)), [['a'], ['b'], ['d']]);
  // 지워진 카드를 가리키는 id는 무시한다
  assert.strictEqual(depLayers([T('a', ['ghost'])]).length, 1, '없는 id는 깊이에 안 들어간다');
  // 순환 — 던지지 않고 배치가 나온다
  const cyc = depLayers([T('a', ['b']), T('b', ['a'])]);
  assert.strictEqual(cyc.flat().length, 2, '순환이어도 두 업무 다 나온다');
  // 자기 자신을 가리켜도 안전
  assert.strictEqual(depLayers([T('a', ['a'])]).flat().length, 1);
  // 열 안 정렬은 마감일순
  const sorted = depLayers([T('x', [], '2026-09-01'), T('y', [], '2026-08-01')]);
  assert.deepStrictEqual(sorted[0].map(t => t.id), ['y', 'x']);
  assert.deepStrictEqual(depLayers([]), [], '빈 목록');
  assert.deepStrictEqual(depLayers(undefined), [], '인자가 없어도 안전하다');
  console.log('PASS  선후관계 배치 8가지');
}

// ── 달력에 얹는 생일 (utils.birthdayMap / birthdaysOn) ──
// 'MM-DD'만 저장하므로 ISO 날짜에서 연도를 떼고 견준다 — 자리를 잘못 자르면 조용히
// 아무 날에도 안 뜨거나(4자리 어긋남) 엉뚱한 날에 뜬다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'cal-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { birthdayMap, birthdaysOn } = await import(pathToFileURL(f).href);

  const M = [
    { name: '박지호', birthday: '08-07' },
    { name: '같은날', birthday: '08-07' },
    { name: '조해리', birthday: '08-25' },
    { name: '없음', birthday: '' },
    { name: '형식틀림', birthday: '8-7' },
  ];
  const map = birthdayMap(M);
  assert.strictEqual(map.size, 2, '형식이 맞는 날짜만 · 같은 날은 한 칸에 모인다');
  assert.deepStrictEqual(birthdaysOn(map, '2026-08-07').map(m => m.name), ['박지호', '같은날']);
  assert.deepStrictEqual(birthdaysOn(map, '2030-08-07').map(m => m.name), ['박지호', '같은날'], '연도는 보지 않는다');
  assert.deepStrictEqual(birthdaysOn(map, '2026-08-06'), [], '다른 날은 비어 있다');
  // 없을 때는 **언제나 같은 빈 배열** — 매번 새 배열이면 달력이 렌더마다 다시 그려진다
  assert.strictEqual(birthdaysOn(map, '2026-08-06'), birthdaysOn(map, '2026-09-09'));
  assert.deepStrictEqual(birthdaysOn(map, ''), []);
  assert.deepStrictEqual(birthdaysOn(undefined, '2026-08-07'), [], '표가 없어도 안전하다');
  assert.strictEqual(birthdayMap(undefined).size, 0);
  console.log('PASS  달력 생일 8가지');
}

// ── 선행 업무 변경도 활동 기록에 남는다 (ActivityService) ──
{
  const T = { ...base, dependsOn: ['d1'] };
  assert.deepStrictEqual(msgs(T, { dependsOn: ['d1'] }), [], '같으면 기록 없음');
  assert.deepStrictEqual(msgs(T, { dependsOn: ['d1', 'd2'] }), ['선행 업무를 2건으로 변경했습니다.']);
  assert.deepStrictEqual(msgs(T, { dependsOn: [] }), ['선행 업무를 모두 비웠습니다.']);
  // 순서만 바뀐 배열은 변경 아님(팀·담당자와 같은 규칙)
  assert.deepStrictEqual(msgs({ ...T, dependsOn: ['d1', 'd2'] }, { dependsOn: ['d2', 'd1'] }), []);
  console.log('PASS  선행 업무 활동 기록 4가지');
}


// ── 프로젝트 탭 순서 (selectors.selectProjectsList) ──
// 0021의 position이 1차 키, created_at이 2차 키다. position이 전부 0인 옛 데이터에서
// 만든 순이 유지되는지, 드래그로 바꾼 position이 이기는지를 본다.
{
  const { selectProjectsList } = await import(new URL('../src/store/selectors.js', import.meta.url));
  const mk = (byId) => ({ projects: { byId, allIds: Object.keys(byId) } });
  const s1 = mk({
    b: { id: 'b', title: 'B', position: 0, createdAt: '2026-02-01' },
    a: { id: 'a', title: 'A', position: 0, createdAt: '2026-01-01' },
  });
  assert.deepStrictEqual(selectProjectsList(s1).map(p => p.id), ['a', 'b'], 'position이 같으면 만든 순');
  const s2 = mk({
    a: { id: 'a', title: 'A', position: 2, createdAt: '2026-01-01' },
    b: { id: 'b', title: 'B', position: 1, createdAt: '2026-02-01' },
  });
  assert.deepStrictEqual(selectProjectsList(s2).map(p => p.id), ['b', 'a'], '드래그로 정한 position이 이긴다');
  const s3 = mk({
    old: { id: 'old', title: '옛 행' },                                 // position·createdAt 없음(게스트)
    neo: { id: 'neo', title: '새 행', position: 1, createdAt: '2026-03-01' },
  });
  assert.deepStrictEqual(selectProjectsList(s3).map(p => p.id), ['old', 'neo'], '값이 없어도 안전하다');
  console.log('PASS  프로젝트 탭 순서 3가지');
}

// ── 본문 체크리스트 토글 (utils.toggleTodoLine) ──
// 뷰어(RichText)의 체크박스가 n번째 체크 줄만 뒤집는지 — 다른 줄·불릿·본문은 그대로.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const d = mkdtempSync(join(tmpdir(), 'todo-'));
  const f = join(d, 'utils.mjs');
  writeFileSync(f, src);
  const { toggleTodoLine } = await import(pathToFileURL(f).href);
  const md = '설명\n- [ ] 하나\n- 그냥 불릿\n- [x] 둘';
  assert.strictEqual(toggleTodoLine(md, 0), '설명\n- [x] 하나\n- 그냥 불릿\n- [x] 둘');
  assert.strictEqual(toggleTodoLine(md, 1), '설명\n- [ ] 하나\n- 그냥 불릿\n- [ ] 둘');
  assert.strictEqual(toggleTodoLine(md, 9), md, '없는 순번은 그대로');
  assert.strictEqual(toggleTodoLine('', 0), '');
  console.log('PASS  본문 체크리스트 토글 4가지');
}

// ── 실패 문구 (services/errorText.js) ──
// 화면에 Postgres 원문이 새지 않는지 + 흔한 코드마다 사람이 할 일을 말하는지.
// 되돌리기 검사: errorReason의 23502 갈래를 지우면 첫 단정이 바로 깨진다.
{
  const { errorReason, failText, objectParticle } =
    await import(new URL('../src/services/errorText.js', import.meta.url).href);

  const notNull = { code: '23502', message: 'null value in column "title" of relation "cards" violates not-null constraint' };
  assert.strictEqual(errorReason(notNull), '제목을 먼저 적어주세요');
  assert.strictEqual(failText('업무를 저장하지 못했어요', notNull), '업무를 저장하지 못했어요 · 제목을 먼저 적어주세요');
  assert.strictEqual(errorReason({ code: '23502', message: 'null value in column "zzz" of relation "cards"' }), '아직 채우지 않은 칸이 있어요');
  assert.strictEqual(errorReason({ code: '23503', message: 'violates foreign key constraint "files_card_id_fkey"' }), '연결된 항목이 이미 지워졌어요 · 새로고침해주세요');
  assert.strictEqual(errorReason({ code: '42501' }), '권한이 있어야 하는 일이에요');
  assert.strictEqual(errorReason({ message: 'new row violates row-level security policy' }), '권한이 있어야 하는 일이에요');
  assert.strictEqual(errorReason({ message: 'Failed to fetch' }), '인터넷 연결을 확인하고 다시 시도해주세요');
  assert.strictEqual(errorReason({ status: 413, message: 'The object exceeded the maximum allowed size' }), '파일이 너무 커요');
  assert.strictEqual(errorReason(null), '잠시 후 다시 시도해주세요');
  // 아는 코드가 하나도 없으면 **원문이라도** 보여준다. 아무 단서도 없이
  // '잠시 후 다시 시도해주세요'만 남으면 쓰는 사람도 고치는 사람도 원인을 못 본다
  // (첨부가 안 올라가는데 이유를 못 찾아 두 번 헤맸다).
  assert.strictEqual(errorReason({ code: 'ZZZZZ', message: 'boom' }), 'boom');
  assert.strictEqual(errorReason({}), '잠시 후 다시 시도해주세요');
  assert.ok(errorReason({ message: 'x'.repeat(200) }).length <= 91, '길면 잘라서 한 줄을 넘기지 않는다');
  // 우리 서버가 한국어로 이유를 준 경우에는 그것을 그대로 쓴다 — 버리면 화면에
  // '잠시 후 다시 시도해주세요'만 남아서 무엇이 막혔는지 아무도 모른다
  assert.strictEqual(errorReason({ human: '승인된 사용자만 파일을 올릴 수 있습니다.' }), '승인된 사용자만 파일을 올릴 수 있습니다.');
  // failText는 짧으면 한 줄(`무엇 · 왜`), 길면 줄을 나눈다(2026-08-28) — 토스트가
  // 한눈에 읽혀야 하는데 두 마디를 언제나 가운뎃점으로 붙이면 줄이 흘러넘친다.
  // 줄을 나누는 규칙 자체는 tests/drivesync.mjs가 본다.
  assert.strictEqual(failText('저장 실패', { human: '다시 시도해주세요' }), '저장 실패 · 다시 시도해주세요');
  assert.strictEqual(failText('파일을 올리지 못했어요', { human: '25MB를 넘는 파일은 올릴 수 없습니다.' }),
    '파일을 올리지 못했어요\n25MB를 넘는 파일은 올릴 수 없습니다.');

  // 원문이 한 글자도 섞이지 않아야 한다 — 이게 이번 요청의 핵심 단정이다
  const raw = ['null value', 'constraint', 'relation', 'violates', 'code 2'];
  for (const e of [notNull, { code: '23503', message: 'violates foreign key constraint "x"' }, { code: '23505', message: 'duplicate key value violates unique constraint' }]) {
    const line = failText('업무를 저장하지 못했어요', e);
    for (const r of raw) assert.ok(!line.includes(r), `원문이 화면에 샜다: ${line}`);
  }

  assert.strictEqual(objectParticle('제목'), '을');
  assert.strictEqual(objectParticle('프로젝트'), '를');
  assert.strictEqual(objectParticle('file.png'), '를', '한글이 아니면 를');
  console.log('PASS  실패 문구 19가지');
}

// ── 드라이브 엑셀 미리보기 뷰어 고르기 (utils.driveSrc) ──
// 갓 올린 파일은 스프레드시트 미리보기가 "Google Docs에 오류가 발생했습니다"를
// 띄운다(구글이 준비하는 데 시간이 걸린다). 그때는 파일 뷰어가 표를 그린다.
// 조건을 반대로 쓰면 **올리자마자 펼쳐본 사람이 오류 화면을 본다** — 그 회귀를 잡는다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'drv-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { driveSrc, SHEET_READY_MS } = await import(pathToFileURL(f).href);

  const now = Date.parse('2026-08-26T12:00:00Z');
  const at = (msAgo) => new Date(now - msAgo).toISOString();
  const row = (name, msAgo) => ({ drive_file_id: 'FID', name, created_at: at(msAgo) });
  const sheet = 'https://docs.google.com/spreadsheets/d/FID/preview';
  const docx = 'https://docs.google.com/document/d/FID/preview';
  const slides = 'https://docs.google.com/presentation/d/FID/preview';
  const viewer = 'https://drive.google.com/file/d/FID/preview';

  // 갓 올린 엑셀 → 파일 뷰어(스프레드시트는 아직 오류를 띄운다)
  assert.strictEqual(driveSrc(row('명단.xlsx', 0), now), viewer, '방금 올린 엑셀은 파일 뷰어');
  assert.strictEqual(driveSrc(row('명단.xlsx', 45 * 1000), now), viewer, '45초는 실제로 실패했다');
  assert.strictEqual(driveSrc(row('명단.xlsx', SHEET_READY_MS), now), viewer, '경계에서는 아직 파일 뷰어');
  // 시간이 지난 엑셀 → 스프레드시트(글자가 크고 시트 탭이 진짜 탭이다)
  assert.strictEqual(driveSrc(row('명단.xlsx', SHEET_READY_MS + 1), now), sheet, '지나면 스프레드시트');
  assert.strictEqual(driveSrc(row('명단.XLSX', 3 * 864e5), now), sheet, '확장자 대문자도');
  assert.strictEqual(driveSrc(row('결산.xls', 3 * 864e5), now), sheet, 'xls도');
  assert.strictEqual(driveSrc(row('명단.csv', 3 * 864e5), now), sheet, 'csv도');
  // 오피스류는 전부 제 편집기 미리보기로 — 워드·PPT도 엑셀과 같은 시간 게이트다
  assert.strictEqual(driveSrc(row('회의록.docx', 3 * 864e5), now), docx, '워드는 문서 미리보기');
  assert.strictEqual(driveSrc(row('발표.pptx', 3 * 864e5), now), slides, 'PPT는 프레젠테이션 미리보기');
  assert.strictEqual(driveSrc(row('회의록.docx', 45 * 1000), now), viewer, '갓 올린 워드는 아직 파일 뷰어');
  // 편집기가 없는 형식은 언제나 파일 뷰어 — pdf·이미지를 편집기로 열면 오류다
  assert.strictEqual(driveSrc(row('회의록.pdf', 3 * 864e5), now), viewer, 'pdf는 파일 뷰어');
  assert.strictEqual(driveSrc(row('사진.png', 3 * 864e5), now), viewer, '이미지도 파일 뷰어');
  assert.strictEqual(driveSrc(row('xlsx보고서.zip', 3 * 864e5), now), viewer, '이름에 xlsx가 섞였을 뿐');
  // created_at이 없으면(옛 행) 나이를 모른다 → 1970년으로 읽혀 스프레드시트로 간다
  assert.strictEqual(driveSrc({ drive_file_id: 'FID', name: 'a.xlsx' }, now), sheet, '옛 행은 오래된 것으로 본다');
  // 드라이브 파일이 아니면 주소가 없다
  assert.strictEqual(driveSrc({ name: 'a.xlsx' }, now), null);
  assert.strictEqual(driveSrc(null, now), null, 'null도 안전하다');
  console.log('PASS  드라이브 뷰어 고르기 17가지');
}

// ── 힘 기반 그래프 한 스텝 (utils.forceStep) ──
// 연결 지도·프로젝트 그래프 뷰가 같이 쓴다. 고정·skip(끌거나 놓아둔) 노드는 힘을
// 받지 않아야 하고, 영역(zx) 밖으로 못 나가야 하고, alpha가 식으면 멈춰야 한다 —
// 이게 깨지면 팀이 떠다니거나, 사람이 프로젝트 영역으로 넘어가거나, 그래프가
// 영원히 출렁인다(사용자 지적 — "탱글").
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'fg-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { forceStep, forceBounds } = await import(pathToFileURL(f).href);

  const W = 600, H = 300;
  const nodes = [
    { id: 'a', ax: 0.2, zx: [0.02, 0.42] },      // 사람 — 왼쪽 영역
    { id: 'b', ax: 0.8, zx: [0.58, 0.98] },      // 프로젝트 — 오른쪽 영역
    { id: 'fix', fixed: { x: 300, y: 150 } },    // 팀(가운데 고정)
    { id: 'pin', ax: 0.5 },                      // 끌고 있거나 놓아둔 노드
  ];
  const pos = [{ x: 100, y: 100 }, { x: 500, y: 200 }, { x: 300, y: 150 }, { x: 250, y: 80 }];
  const vel = pos.map(() => ({ x: 0, y: 0 }));
  const edges = [[0, 1, 90]];
  const before = pos.map(p => ({ ...p }));
  let alpha = 1;
  for (let i = 0; i < 300; i++) {
    forceStep(pos, vel, nodes, edges, W, H, { alpha, skip: new Set([3]) });
    alpha -= alpha * 0.0228;
  }

  assert.deepStrictEqual(pos[2], before[2], '고정 노드는 움직이지 않는다');
  assert.deepStrictEqual(pos[3], before[3], 'skip(끌거나 놓아둔) 노드는 시뮬이 못 움직인다');
  assert.notDeepStrictEqual(pos[0], before[0], '떠 있는 노드는 힘을 받아 움직인다');
  // 영역: 사람은 0.42W(=252)를 못 넘고, 프로젝트는 0.58W(=348) 아래로 못 온다.
  // 스프링(목표 90)이 둘을 강하게 당겨도 영역이 이긴다 — 그래서 이 단정이 유효하다.
  assert.ok(pos[0].x <= W * 0.42 + 0.01, `사람은 자기 영역 안 (${Math.round(pos[0].x)})`);
  assert.ok(pos[1].x >= W * 0.58 - 0.01, `프로젝트는 자기 영역 안 (${Math.round(pos[1].x)})`);
  // 냉각: alpha가 식은 뒤에는 힘이 없다 — 한 스텝 더 돌려도 거의 안 움직인다("탱글" 방지)
  const settled = pos.map(p => ({ ...p }));
  for (let i = 0; i < 30; i++) forceStep(pos, vel, nodes, edges, W, H, { alpha: 0.001, skip: new Set([3]) });
  const drift = Math.hypot(pos[0].x - settled[0].x, pos[0].y - settled[0].y);
  assert.ok(drift < 1.5, `식으면 멈춘다 (30스텝 이동 ${drift.toFixed(2)}px)`);
  // 드래그가 보는 이동 범위도 같은 규칙이다
  const b = forceBounds(nodes[0], W, H);
  assert.strictEqual(b.x1, W * 0.42, '드래그 상한 = 영역 상한');
  console.log('PASS  힘 그래프 스텝 8가지');
}
