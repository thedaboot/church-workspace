// logcheck-task — 업무·활동 기록·하위 업무·첨부·회의록. 노드 스위트(브라우저·서버 없음 · tests/README.md).
// logcheck 묶음의 하나다 — `npm run verify -- logcheck`가 logcheck와 logcheck-* 전부를 돈다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { loadSource } from './_load.mjs';
const { TaskService, ActivityService } = await import(new URL('../src/services/domain.js', import.meta.url).href);

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
  const U = await loadSource('src/utils.js');
  const { subtaskProgress, subtasksForDb } = U;
  // 저장 모양이 맡은 사람·기한을 잘라내지 않는다(2026-09-24 — 체크하면 얼굴·날짜가 사라졌다)
  assert.deepStrictEqual(
    subtasksForDb([{ id: 'a', title: ' 콘티 확정 ', done: 1, assignee: '노준석, 조준환', due: '2026-09-26', x: 9 },
                   { id: 'b', title: '손으로 적은 줄', done: false, assignee: '', due: '' },
                   { id: 'c', title: '  ', done: false }]),
    [{ id: 'a', title: '콘티 확정', done: true, assignee: '노준석, 조준환', due: '2026-09-26' },
     { id: 'b', title: '손으로 적은 줄', done: false }],
    '사람·기한은 싣고, 빈 값은 키째 빼고, 이름 빈 줄은 버린다');
  assert.ok(readFileSync(new URL('../src/services/cloudSync.js', import.meta.url), 'utf8').includes('subtasks: subtasksForDb(task.subtasks)'),
    '클라우드 저장이 subtasksForDb를 쓴다');
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
  const { summaryOutdated } = U;
  assert.strictEqual(summaryOutdated('2026-08-29T10:05:00Z', '2026-08-29T10:00:00Z'), true, '고정 뒤에 바뀌면 낡음');
  assert.strictEqual(summaryOutdated('2026-08-29T10:00:30Z', '2026-08-29T10:00:00Z'), false, '1분 안(시계 어긋남)은 낡음이 아니다');
  assert.strictEqual(summaryOutdated('2026-08-29T09:00:00Z', '2026-08-29T10:00:00Z'), false, '고정이 더 나중이면 낡음이 아니다');
  assert.strictEqual(summaryOutdated('', '2026-08-29T10:00:00Z'), false, '시각이 없으면 조용히 거짓');
  assert.strictEqual(summaryOutdated('2026-08-29T10:05:00Z', ''), false);
  console.log('PASS  고정 요약 낡음 판정 5가지');

  // ── 업무 줄의 팀 표시 (utils.teamsLabel) ──
  // 원래 버그: teams[0] 하나만 그려서 여러 팀이 붙은 업무는 나머지가 화면 어디에도
  // 없었다 — "9월 월례회는 웰컴팀 일"로 읽혔다(사용자 지적 2026-08-29).
  const { teamsLabel } = U;
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
  const { projectYear, projectsOfYear } = U;
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

  // ── 엑셀 미리보기 주소 (utils.sheetPreviewUrl) ──
  // 구글은 .xlsx를 열어볼 때 게을리 변환해서 갓 올린 파일은 시트 미리보기가 오류를 냈다.
  // 올릴 때 스크립트가 네이티브 시트 사본을 만들어 두면 기다릴 것이 없다(0031).
  // 사본이 없으면 **null**이어야 한다 — 부르는 쪽이 그걸 보고 예전 길로 떨어진다.
  const { sheetPreviewUrl } = U;
  const u = sheetPreviewUrl({ preview_file_id: 'abc123', drive_file_id: 'zzz' });
  assert.ok(u.includes('/spreadsheets/d/abc123/preview'), '변환 사본 id로 간다');
  assert.ok(!u.includes('zzz'), '원본 id로 가지 않는다 — 그러면 30분 문제가 그대로다');
  assert.ok(u.includes('rm=minimal'), '구글 머리줄을 걷어낸다');
  assert.ok(u.includes('widget=true'), '시트 탭을 남긴다 — 없으면 첫 장밖에 못 본다');
  assert.strictEqual(sheetPreviewUrl({ drive_file_id: 'zzz' }), null, '사본이 없으면 예전 길로');
  assert.strictEqual(sheetPreviewUrl({ preview_file_id: '' }), null, '빈 문자열도 없는 것이다');
  assert.strictEqual(sheetPreviewUrl(null), null, '값이 없어도 안전하다');
  console.log('PASS  엑셀 미리보기 주소 7가지');


  // ── 달력 열 폭 (utils.snapCols) ──
  // 원래 버그: grid-cols-7 + gap:1px이면 열 폭이 소수가 되고(164.703 · 164.719 …)
  // 1px 선이 장치 픽셀 두 개에 걸쳐 번진다. 걸치는 비율이 선마다 달라서 **어떤 선만
  // 굵어 보였다** — 소수부가 .703 .422 .141 .844 .563 .281이었고, 0.5에 가장 가까운
  // 둘(월|화·목|금)이 사용자가 짚은 자리였다(2026-08-29).
  const { snapCols } = U;
  const edges = (cols, dpr) => {
    let x = 0; const out = [];
    for (let i = 0; i < cols.length - 1; i++) { x += cols[i]; out.push(x * dpr); x += 1; }
    return out;
  };
  for (const [w, dpr] of [[1159, 1], [1086, 1], [1086, 2], [1159, 4]]) {
    const cols = snapCols(w, dpr);
    assert.strictEqual(cols.length, 7, `${w}/${dpr}: 일곱 칸`);
    // 폭 합 + 선 6개 = 통 폭. 안 맞으면 마지막 칸이 삐져나가거나 오른쪽이 빈다
    assert.strictEqual(cols.reduce((a, b) => a + b, 0) + 6, w, `${w}/${dpr}: 폭이 딱 맞는다`);
    for (const e of edges(cols, dpr)) {
      assert.ok(Math.abs(e - Math.round(e)) < 1e-6, `${w}/${dpr}: 선이 장치 픽셀에 붙는다 (${e})`);
    }
  }
  // dpr 1.25는 1px 선 자체가 1.25 장치 픽셀이라 정수가 될 수 없다 — 여섯이 **같은**
  // 소수부를 갖는 것이 목표다(고르지 않은 것이 문제였지 흐린 것이 문제가 아니었다)
  const f = edges(snapCols(1159, 1.25), 1.25).map(e => e - Math.floor(e));
  assert.ok(Math.max(...f) - Math.min(...f) < 0.05, `dpr 1.25에서도 여섯이 고르다 (${f.map(x => x.toFixed(3))})`);
  assert.strictEqual(snapCols(0, 1), null, '못 재면 null — 부르는 쪽이 1fr로 떨어진다');
  assert.strictEqual(snapCols(4, 1), null, '선보다 좁으면 null');
  assert.deepStrictEqual(snapCols(1159, 0), snapCols(1159, 1), 'dpr이 0이면 1로 본다 — 던지지 않는다');
  console.log('PASS  달력 열 폭 (장치 픽셀 정렬)');


  // ── 달력에 얹히는 업무 (utils.datedTasks) ──
  // 원래 버그: 팀 칩이 전부를 세서 `웰컴팀 7`이라 해놓고 달력에는 띠가 3개만 떴다.
  // 실데이터에서 7건 중 4건이 마감 미정(9·10·11·12월 월례회)이었다 — 달력이 빠뜨린 것이
  // 아니라 같은 화면에 셈의 기준이 둘이었다(사용자 지적 2026-08-29).
  const { datedTasks } = U;
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
  const { myScope } = U;
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


// ── 본문 체크리스트 토글 (utils.toggleTodoLine) ──
// 뷰어(RichText)의 체크박스가 n번째 체크 줄만 뒤집는지 — 다른 줄·불릿·본문은 그대로.
{
  const { toggleTodoLine } = await loadSource('src/utils.js');
  const md = '설명\n- [ ] 하나\n- 그냥 불릿\n- [x] 둘';
  assert.strictEqual(toggleTodoLine(md, 0), '설명\n- [x] 하나\n- 그냥 불릿\n- [x] 둘');
  assert.strictEqual(toggleTodoLine(md, 1), '설명\n- [ ] 하나\n- 그냥 불릿\n- [ ] 둘');
  assert.strictEqual(toggleTodoLine(md, 9), md, '없는 순번은 그대로');
  assert.strictEqual(toggleTodoLine('', 0), '');
  console.log('PASS  본문 체크리스트 토글 4가지');
}

// ── 드라이브 엑셀 미리보기 뷰어 고르기 (utils.driveSrc) ──
// 갓 올린 파일은 스프레드시트 미리보기가 "Google Docs에 오류가 발생했습니다"를
// 띄운다(구글이 준비하는 데 시간이 걸린다). 그때는 파일 뷰어가 표를 그린다.
// 조건을 반대로 쓰면 **올리자마자 펼쳐본 사람이 오류 화면을 본다** — 그 회귀를 잡는다.
{
  const { driveSrc, SHEET_READY_MS } = await loadSource('src/utils.js');

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

// ── 끝낸 시각 (domain.completedAtFor + DB 0033/0034) ──────────────────────────
// 게스트와 클라우드가 **같은 규칙**이어야 한다: 완료로 들어올 때만 찍고, 완료에서
// 나가면 비우고, 완료 → 완료(제목·첨부 수정)는 그대로 둔다.
// 0033의 첫 트리거는 마지막 갈래를 `new.completed_at = old.completed_at`으로 써서
// **백필 UPDATE를 스스로 덮었다**(0034가 그 else를 뺐다).
// 되돌리기 검사: completedAtFor의 두 if를 지우면 첫 두 단정이 깨진다.
{
  const f = TaskService.completedAtFor;
  assert.ok(f('진행 중', '완료', '').length > 0, '완료로 들어오면 시각을 찍는다');
  assert.strictEqual(f('완료', '진행 중', '2026-08-01T00:00:00Z'), '', '완료에서 나가면 비운다');
  assert.strictEqual(f('완료', '완료', '2026-08-01T00:00:00Z'), '2026-08-01T00:00:00Z',
    '완료 → 완료는 그대로 — 끝낸 업무의 제목을 고쳐도 끝낸 날은 그날이다');
  assert.strictEqual(f('시작 전', '진행 중', ''), '', '완료와 무관한 전환은 빈 값 그대로');

  const b2 = { id: 'x', status: '진행 중', title: 'T', assignees: [], teams: [], activityLog: [], comments: [] };
  const done = TaskService.update(b2, { ...b2, status: '완료' }, '노준석');
  assert.ok(done.completedAt, '완료로 저장하면 completedAt이 채워진다');
  assert.strictEqual(TaskService.update(done, { ...done, status: '진행 중' }, '노준석').completedAt, '',
    '되돌리면 비워진다');
  assert.strictEqual(TaskService.update(done, { ...done, title: 'T2' }, '노준석').completedAt, done.completedAt,
    '완료된 업무 제목만 고치면 안 바뀐다');
  assert.ok(TaskService.create({ projectId: 'p', title: 'A', status: '완료' }, '노준석').completedAt,
    '만들 때부터 완료면 그때가 끝낸 날이다(DB는 0033의 insert 트리거)');
  assert.strictEqual(TaskService.create({ projectId: 'p', title: 'B' }, '노준석').completedAt, '',
    '완료가 아니면 비어 있다');

  // 마이그레이션이 같은 규칙을 담고 있는지 — 트리거가 앱과 갈라지면 클라우드만 어긋난다
  const mig = readFileSync(new URL('../supabase/migrations/0034_fix_completed_at_backfill.sql', import.meta.url), 'utf8');
  assert.ok(/new\.status = 'done' and old\.status <> 'done' then\s+new\.completed_at = now\(\)/.test(mig),
    'DB도 완료로 들어올 때만 찍는다');
  // 주석에는 "예전에 이렇게 썼다"로 그 줄이 인용돼 있다 → **주석을 걷어내고** 본다
  const migCode = mig.split(/\r?\n/).filter(l => !l.trim().startsWith('--')).join(' ; ');
  assert.ok(!/else\s+new\.completed_at = old\.completed_at/.test(migCode),
    '0033이 백필을 덮었던 else 갈래가 없다(0034가 뺀 자리)');
  assert.ok(/disable trigger trg_cards_updated_meta/.test(mig) && /enable trigger trg_cards_updated_meta/.test(mig),
    '값을 손보는 UPDATE는 트리거를 끄고 돌린다(안 끄면 updated_at이 오늘로 밀린다)');
  console.log('PASS  끝낸 시각 12가지');
}

// ── 첨부 미리보기 종류 (services/previewKind.js) ────────────────────────────
// 2026-09-05에 FilePreviewModal에서 순수 모듈로 옮겼다 — 그 전에는 JSX 안에 있어 노드에서
// 부를 수 없었고 소스 문자열 단정(tests/drivesync.mjs)만 있었다. HTML 첨부가 그 계기다:
// 'html'이 TEXT_EXT에 들어 있어 소스가 <pre>로 떴고, mime 'text/html'은 text/*에 먹혔다.
// 되돌리기 검사: html 판정 줄을 text 뒤로 내리면 mime 케이스가, TEXT_EXT에 'html'을 되넣으면
// 확장자 케이스가 깨진다.
{
  const { previewKind } = await import(new URL('../src/services/previewKind.js', import.meta.url).href);
  const drive = (name, mime_type = '') => ({ name, mime_type, source: 'drive', drive_file_id: 'f1' });
  assert.strictEqual(previewKind(drive('주보.html')), 'html', '드라이브 .html은 html');
  // 실물 기준 파일 — 이름에 공백·한글이 있고 드라이브 중계로 내려온다
  assert.strictEqual(previewKind({ name: '2026 대림절 예배 기획 킥오프 워크북.html', mime_type: 'text/html', source: 'drive', drive_file_id: 'f1', size_bytes: 180000 }), 'html', '공백·한글 이름의 실물 파일');
  assert.strictEqual(previewKind(drive('안내.htm', 'text/html')), 'html', '.htm도 html');
  assert.strictEqual(previewKind(drive('page.HTML')), 'html', '대문자 확장자도');
  assert.strictEqual(previewKind(drive('index', 'text/html')), 'html', '확장자가 없어도 mime이 html이면 html');
  assert.strictEqual(previewKind({ name: 'page.html', mime_type: 'text/html', source: 'local' }), 'html', '올리는 중인 로컬 파일도 html');
  assert.strictEqual(previewKind({ name: 'page.html' }), 'html', 'Storage 행도 html');
  // 글자로 남는 것들 — html을 앞에 끼워 넣어도 text가 그대로다
  assert.strictEqual(previewKind(drive('README.md')), 'text', 'md는 text(RichText)');
  assert.strictEqual(previewKind(drive('log.txt', 'text/plain')), 'text', 'text/plain은 text');
  assert.strictEqual(previewKind(drive('a.xml', 'text/xml')), 'text', 'text/xml은 text');
  // 다른 종류가 밀리지 않았는지
  assert.strictEqual(previewKind(drive('사진.jpg', 'image/jpeg')), 'image');
  assert.strictEqual(previewKind(drive('결산.pdf', 'application/pdf')), 'pdf');
  assert.strictEqual(previewKind(drive('명단.xlsx')), 'sheet');
  assert.strictEqual(previewKind(drive('문서.docx')), 'doc');
  assert.strictEqual(previewKind(drive('발표.pptx')), 'slide');
  assert.strictEqual(previewKind(drive('옛문서.doc')), 'drive', '옛 형식은 구글 편집기 미리보기');
  assert.strictEqual(previewKind(drive('영상.mp4', 'video/mp4')), 'video');
  assert.strictEqual(previewKind(drive('묶음.zip')), 'drive', '드라이브의 모르는 형식은 파일 뷰어');
  assert.strictEqual(previewKind({ name: '묶음.zip' }), 'none', 'Storage의 모르는 형식은 none');
  assert.strictEqual(previewKind({ name: '옛문서.doc', source: 'local' }), 'none', '올리는 중인 옛 형식은 주소가 없어 none');
  assert.strictEqual(previewKind(null), 'none', '값이 없어도 안전하다');
  console.log('PASS  첨부 미리보기 종류 21가지');
}

// ── 되돌리기 기록에 안 쌓이는 액션 (store/workspaceStore.js) ────────────────
// 서버가 보내 준 카드 1건(SYNC_TASK)은 내 조작이 아니라 past에 남으면 안 된다.
// 머리 주석은 처음부터 SYNC_TASK라고 적혀 있었는데 분기가 'HYDRATE_TASK'(없는 액션)를
// 보고 있어서, 실시간 재조회가 잦은 탭에서 past가 계속 늘었다 — 화면에는 아무 표시가
// 없는 종류의 고장이다(클라우드 모드는 실행 취소 버튼 자체를 숨긴다).
// 스토어는 supabaseClient(import.meta.env)와 react를 물기 때문에 노드에서 그대로
// import할 수 없다 — 그 두 줄만 바꿔 임시 파일로 돌린다(errorText·utils와 같은 방식).
// react 훅은 렌더에서만 불리므로 여기서는 자리만 채운다.
// 되돌리기 검사: 분기를 'HYDRATE_TASK'로 되돌리면 첫 단정이 깨진다.
{
  const src = readFileSync(new URL('../src/store/workspaceStore.js', import.meta.url), 'utf8')
    .replace(/import \{ useSyncExternalStore \} from 'react';/, 'const useSyncExternalStore = () => {};')
    .replace(/import \{ isCloudEnabled \} from '\.\.\/services\/supabaseClient\.js';/,
      'const isCloudEnabled = () => false;')
    .replace("'../services/domain.js'", JSON.stringify(new URL('../src/services/domain.js', import.meta.url).href));
  // 게스트 초기값은 localStorage를 읽는다 — 노드에는 없어서 스토어가 console.error를
  // 한 줄 뱉는다(동작은 멀쩡하다). 그 소음만 막고 바로 걷는다.
  globalThis.localStorage = { getItem: () => null };
  const { store } = await loadSource('src/store/workspaceStore.js', { src, as: 'store.mjs' });
  delete globalThis.localStorage;

  const blank = { currentUser: { name: '나' }, members: [], activityFeed: [],
    projects: { byId: {}, allIds: [] }, tasks: { byId: { t1: { id: 't1', title: '가' } }, allIds: ['t1'] } };
  store.dispatch({ type: 'LOAD_STATE', payload: blank });   // 기록 비움
  assert.strictEqual(store.canUndo(), false, 'LOAD_STATE 뒤에는 되돌릴 것이 없다');

  store.dispatch({ type: 'SYNC_TASK', payload: { id: 't1', title: '나' } });
  assert.strictEqual(store.getState().tasks.byId.t1.title, '나', 'SYNC_TASK가 카드를 못 고쳤다');
  assert.strictEqual(store.canUndo(), false, 'SYNC_TASK가 past에 쌓였다');

  store.dispatch({ type: 'SET_ACTIVITY_FEED', payload: [{ id: 'a1' }] });
  assert.strictEqual(store.canUndo(), false, 'SET_ACTIVITY_FEED가 past에 쌓였다');

  // 내 조작은 그대로 쌓인다 — 위 분기가 넓어지면 실행 취소가 통째로 죽는다
  store.dispatch({ type: 'UPSERT_TASK', payload: { id: 't2', title: '내가 만든 업무' } });
  assert.strictEqual(store.canUndo(), true, '내 조작까지 기록에서 빠졌다');
  store.undo();
  assert.ok(!store.getState().tasks.byId.t2, '되돌리기가 안 먹었다');
  console.log('PASS  SYNC_TASK는 past에 쌓이지 않는다 6가지');
}

// ── 회의록의 "누가 · 무엇을 · 언제까지" 읽기 (services/actionItems.js) ───────
// 다듬기가 만든 그 도막이 본문 글자로만 남아 사라지던 자리(사용자 요청 2026-09-21).
// 이 모듈은 import가 없어 **그대로 불러 돌린다**(패치가 필요 없다).
// 되돌리기 검사: 도막 제목 찾기를 지우면 첫 단정이, 다음 도막에서 멈추는 줄을 빼면
// 둘째가, 날짜 채우기(isoOf)를 지우면 넷째가, titleKey의 공백 접기를 빼면 마지막이 깨진다.
{
  const A = await import(new URL('../src/services/actionItems.js', import.meta.url).href);
  const MD = [
    '### 9월 피드백 및 강평회',
    '- 참석: 정민경 리더순장님, 박지호 리더팀장님',
    '',
    '### 정한 것',
    '- 수련회는 ==11월 둘째 주 금·토==로 하기로 했어요',
    '',
    `### ${A.ACTION_HEADING}`,
    '- @양민혁 · 수련회 장소 3곳 견적 받기 · 10월 5일까지',
    '- 조해리 · 찬양팀 콘티 템플릿 정리 · 9월 30일',
    '- 날짜 없이 적은 일',
    '- 한 문장으로 적어 버린 경우라 이름을 못 가른다',
    '',
    '### 아직 정하지 못한 것',
    '- 회비 금액은 못 정했어요',
    '- 이 줄은 액션이 아니다',
  ].join('\n');
  const now = new Date('2026-09-21T00:00:00Z');
  const items = A.parseActionItems(MD, { now });

  assert.strictEqual(items.length, 4, '그 도막의 불릿만 읽는다');
  assert.ok(!items.some(x => /회비 금액|이 줄은 액션이 아니다/.test(x.what)),
    '다음 도막에서 멈춘다 — 아래 항목을 끌고 오지 않는다');
  assert.deepStrictEqual(
    { name: items[0].name, what: items[0].what, dueDate: items[0].dueDate },
    { name: '양민혁', what: '수련회 장소 3곳 견적 받기', dueDate: '2026-10-05' },
    '@표기를 걷어 이름만 · 날짜는 ISO로');
  assert.strictEqual(items[1].dueDate, '2026-09-30', '@ 없이 이름만 적어도 가른다');
  assert.strictEqual(items[2].name, '', '이름이 없으면 비운다(지어내지 않는다)');
  assert.strictEqual(items[2].dueDate, '', '날짜가 없으면 비운다');
  assert.strictEqual(items[3].name, '', '한 문장이면 통째로 할 일이다');
  assert.deepStrictEqual(A.parseActionItems('### 정한 것\n- 아무것도'), [],
    '그 도막이 없으면 빈 배열이다(회의록이 아니거나 아직 안 다듬었다)');
  // 12월 회의에서 "1월 5일"은 지난 1월이 아니라 다음 해다
  assert.strictEqual(
    A.parseActionItems(`### ${A.ACTION_HEADING}\n- 노준석 · 예산안 정리 · 1월 5일까지`,
      { now: new Date('2026-12-20T00:00:00Z') })[0].dueDate, '2027-01-05',
    '해를 안 적으면 기준일에서 가장 가까운 앞날로 본다');

  // 하위 업무가 되었나 — 제목 글자로 견준다
  const subs = [{ id: 't1', title: '찬양팀  콘티 템플릿 정리' }];
  assert.strictEqual(A.matchSubtask(items[1], subs)?.id, 't1', '띄어쓰기가 달라도 같은 업무다');
  assert.strictEqual(A.matchSubtask(items[0], subs), null, '없으면 null — 아직 업무가 아니다');

  // 도막 이름을 2026-09-22에 '청년별 업무'로 바꿨다(사용자 결정). **옛 이름도 읽는다** —
  // 이미 옛 제목으로 다듬어 저장된 회의록이 있고, 이름을 바꿨다고 그 줄이 사라지면 안 된다.
  // 되돌리기 검사: ACTION_HEADINGS에서 옛 이름을 빼면 둘째가 깨진다.
  assert.strictEqual(A.ACTION_HEADING, '청년별 담당 업무',
    '새로 쓰는 도막 이름 — 화면 라벨과 같은 글자다');
  for (const old of ['누가 무엇을 언제까지', '청년별 업무']) {
    assert.strictEqual(
      A.parseActionItems([`### ${old}`, '- @노준석 · 옛 회의록의 줄'].join('\n')).length, 1,
      `옛 이름(${old})으로 저장된 회의록도 계속 읽는다`);
  }
  // 본문에서 그 도막을 걷어낸 글 — 화면은 이걸 그리고 도막은 부품이 보여 준다
  // (2026-09-22 · 같은 내용이 본문에도 부품에도 떠서 겹쳤다).
  // 되돌리기 검사: stripActionSection이 다음 도막에서 멈추지 않으면 둘째가 깨진다.
  const stripped = A.stripActionSection(MD);
  assert.ok(!stripped.includes('수련회 장소 3곳 견적'), '그 도막의 줄은 본문에서 걷힌다');
  assert.ok(stripped.includes('아직 정하지 못한 것') && stripped.includes('회비 금액'),
    '뒤에 오는 도막은 그대로 남는다 — 통째로 잘라 먹지 않는다');
  assert.ok(stripped.includes('정한 것') && stripped.includes('수련회는'),
    '앞에 오는 도막도 그대로 남는다');
  assert.ok(!/\n{3}/.test(stripped), '걷어낸 자리에 빈 줄이 겹쳐 남지 않는다');
  assert.strictEqual(A.stripActionSection('### 정한 것\n- 아무것도'),
    '### 정한 것\n- 아무것도', '그 도막이 없으면 글을 건드리지 않는다');
  // **팀도 맡는 쪽이 된다**(프롬프트 예시 4) — 이름이 없으면 팀으로 보낸다
  assert.strictEqual(
    A.parseActionItems(['### 청년별 담당 업무', '- @찬양팀 · 10월 콘티 확정 · 9월 26일까지']
      .join('\n'), { now })[0].name, '찬양팀', '팀 이름도 맡는 쪽으로 읽는다');

  // **한 줄에 여럿**(2026-09-22 그릴링 결정) — 같은 팀 사람이 둘이면 줄은 하나다.
  // 되돌리기 검사: peopleOf가 @로 안 가르면 첫 단정이, 통째로 하나로 안 보면 셋째가 깨진다.
  const many = A.parseActionItems(
    ['### 청년별 담당 업무', '- @조해리 @김승찬 · 10월 콘티 확정 · 9월 26일까지'].join('\n'), { now })[0];
  assert.deepStrictEqual(many.names, ['조해리', '김승찬'], '@가 여럿이면 다 읽는다');
  assert.strictEqual(many.what, '10월 콘티 확정', '이름 도막은 할 일에 섞이지 않는다');
  assert.strictEqual(many.name, '조해리', 'name은 첫 사람(한 사람일 때의 편의값)');
  assert.deepStrictEqual(
    A.parseActionItems(['### 청년별 담당 업무', '- @엔지니어팀 · PPT 완료 일정 잡기 · 9월 26일까지']
      .join('\n'), { now })[0].names, ['엔지니어팀'],
    '@가 하나면 그 하나 — 팀 이름도 같은 자리다');
  assert.deepStrictEqual(
    A.parseActionItems(['### 청년별 담당 업무', '- 이름 없이 적은 할 일 · 9월 26일까지']
      .join('\n'), { now })[0].names, [], '맡는 쪽이 없으면 빈 배열이다');
  console.log('PASS  회의록 액션 항목 읽기 24가지');
}

// ── 담당 업무를 부품에서 고치기 (2026-09-22 그릴링으로 정한 모양) ────────────
// 저장 자리는 **본문 그 도막 하나**다(새 칸을 안 만들었다). 부품이 그것을 읽고
// 고친 결과를 도로 적으므로, **읽는 모양과 적는 모양이 같아야** 왕복이 닫힌다.
// 되돌리기 검사: writeActionSection이 stripActionSection을 안 거치면 도막이 둘이 되어
// 셋째가 깨지고, formatActionLine의 `@`를 빼면 첫째가 깨진다(이름을 다시 못 읽는다).
{
  const A = await import(new URL('../src/services/actionItems.js', import.meta.url).href);
  const NL = String.fromCharCode(10);
  const md = ['### 정한 것', '- 뭔가', '', `### ${A.ACTION_HEADING}`,
    '- @조해리 @김승찬 · 10월 콘티 확정 · 9월 26일까지',
    '- @엔지니어팀 · PPT 완료 일정 잡기'].join(NL);
  const items = A.parseActionItems(md);
  const back = A.writeActionSection(md, items);
  assert.deepStrictEqual(A.parseActionItems(back), items, '되쓴 글을 그대로 다시 읽는다(왕복)');
  assert.ok(back.includes('### 정한 것') && back.includes('- 뭔가'), '다른 도막은 그대로 남는다');
  assert.strictEqual(back.split(A.ACTION_HEADING).length - 1, 1, '도막은 하나뿐이다');

  // 할 일이 빈 줄은 버린다 — 남기면 다음에 읽을 때 사라져 "지워졌나?" 한다
  assert.strictEqual(
    A.writeActionSection(md, [...items, { names: ['노준석'], what: '  ', dueDate: '' }]).split(NL)
      .filter(l => l.startsWith('- @')).length, 2, '할 일이 빈 줄은 안 적는다');
  // 항목을 다 지우면 도막도 없어진다
  assert.ok(!A.writeActionSection(md, []).includes(A.ACTION_HEADING), '항목이 없으면 도막도 없다');

  // **사람이 친 앞 글은 한 글자도 안 바뀐다**(2026-09-25 감사 3) — 업무 창 편집기의 value는
  // stripActionSection(writeActionSection(친 글, 항목))이다. 둘이 다르면 편집기가 문서를
  // 통째로 갈아 끼워 커서가 끝으로 튄다(맨 앞 빈 줄·들여쓰기·끝 공백을 치는 순간).
  // 되돌리기 검사: stripActionSection 끝에 `.trim()`을 되살리면 셋이, 빈 줄 접기를 되살리면 넷째가 깨진다.
  for (const typed of ['  들여쓴 첫 줄' + NL + '회의 메모', NL + '회의 메모', '회의 메모  ', '가' + NL + NL + NL + '나', '회의 메모']) {
    assert.strictEqual(A.stripActionSection(A.writeActionSection(typed, items)), typed,
      `편집기 value가 친 글과 다르다: ${JSON.stringify(typed)}`);
  }

  // 날짜는 ISO로 들고 다니다가 우리 표기로 적는다
  assert.ok(A.formatActionLine({ names: ['가'], what: '할 일', dueDate: '2026-10-05' })
    .endsWith('10월 5일까지'), 'ISO를 우리 표기로 적는다');
  assert.strictEqual(A.formatActionLine({ names: [], what: '할 일', dueDate: '' }), '- 할 일',
    '맡는 쪽도 기한도 없으면 할 일만 적는다');

  // 이름표 — 세 명까지는 이름, 그보다 많으면 외 N명(사용자 결정 2026-09-22)
  assert.strictEqual(A.namesLabel(['가', '나', '다']), '가 · 나 · 다');
  assert.strictEqual(A.namesLabel(['가', '나', '다', '라', '마']), '가 · 나 · 다 외 2명');
  assert.strictEqual(A.namesLabel([]), '');
  console.log('PASS  담당 업무 되쓰기·이름표 15가지');
}

// ── 업무 창에서 정말 바뀐 게 있나 (utils.taskEditDirty) ──────────────────────
// `닫기`가 물어볼지 정하는 판정이다. 깃발이 아니라 값을 견준다 — 커서만 옮겨도 서는
// 깃발로 물으면 안 고친 사람에게도 창이 떠서 금방 성가신 것이 된다(사용자 요청 2026-09-22).
// 되돌리기 검사: 하위 업무에서 id를 빼고 보는 처리를 지우면 넷째가 깨진다.
{
  const U = await import(new URL('../src/utils.js', import.meta.url).href);
  const base = { title: 'ㄱ', content: '본문', status: '진행 중', dueDate: '2026-10-01',
    startDate: '', assignees: ['노준석'], teams: ['찬양팀'],
    subtasks: [{ id: 'a', title: '하나', done: false }], dependsOn: [] };
  assert.strictEqual(U.taskEditDirty(base, { ...base }), false, '같으면 안 물어본다');
  assert.strictEqual(U.taskEditDirty({ ...base, title: 'ㄴ' }, base), true, '제목이 바뀌면 물어본다');
  assert.strictEqual(U.taskEditDirty({ ...base, assignees: ['노준석', '조해리'] }, base), true,
    '담당자가 늘면 물어본다');
  assert.strictEqual(
    U.taskEditDirty({ ...base, subtasks: [{ id: 'different-id', title: '하나', done: false }] }, base),
    false, '하위 업무 id는 견주지 않는다 — 만들 때마다 새로 생기는 값이다');
  assert.strictEqual(
    U.taskEditDirty({ ...base, subtasks: [{ id: 'a', title: '하나', done: true }] }, base), true,
    '하위 업무를 끝내면 물어본다');
  assert.strictEqual(
    U.taskEditDirty({ ...base, subtasks: [{ id: 'a', title: '하나', done: false, assignee: '노준석' }] }, base),
    true, '하위 업무의 담당자도 견준다(2026-09-22에 는 칸)');
  // 수정 폼 밖에서 바뀌는 것은 안 본다 — 남이 댓글을 달았다고 "고쳤다"가 되면 안 된다
  assert.strictEqual(U.taskEditDirty({ ...base, comments: [{ text: '새 댓글' }] }, base), false,
    '댓글·활동·첨부는 견주지 않는다');
  assert.strictEqual(U.taskEditDirty(null, base), false, '한쪽이 없으면 묻지 않는다');
  console.log('PASS  정말 바뀐 게 있나 8가지');
}

// ── 회의록 날짜의 반년 경계는 로컬 날짜로 잰다 (services/actionItems.js · 2026-09-24) ─────────
// 기준일을 toISOString()(UTC)으로 적어서 한국 시간 오전 9시 전에는 어제가 되었고, 반년 경계에
// 걸린 날짜의 해가 하루 차이로 갈렸다. 검사 기계의 시간대와 상관없이 재려고 **로컬 게터만 한국
// 시간을 돌려주는 Date**를 만든다(UTC 값은 그대로).
// 되돌리기 검사: 기준일을 base.toISOString().slice(0, 10)으로 되돌리면 첫 단정이 깨진다.
{
  const A = await import(new URL('../src/services/actionItems.js', import.meta.url).href);
  const KST = 9 * 3600000;
  class KstDate extends Date {
    getFullYear() { return new Date(this.getTime() + KST).getUTCFullYear(); }
    getMonth() { return new Date(this.getTime() + KST).getUTCMonth(); }
    getDate() { return new Date(this.getTime() + KST).getUTCDate(); }
  }
  // 한국 시간 2026-12-31 00:30 = UTC 2026-12-30 15:30. 7월 1일은 로컬 기준 183일 전 → 다음 해.
  const now = new KstDate('2026-12-30T15:30:00Z');
  assert.strictEqual(now.getDate(), 31);
  const due = (text) => A.parseActionItems(`### ${A.ACTION_HEADING}\n- 노준석 · 예산안 정리 · ${text}`, { now })[0].dueDate;
  assert.strictEqual(due('7월 1일까지'), '2027-07-01', '반년 경계는 로컬 오늘로 잰다(UTC 어제가 아니라)');
  assert.strictEqual(due('7월 2일까지'), '2026-07-02', '182일 전까지는 같은 해다');
  console.log('PASS  회의록 날짜 반년 경계가 로컬 기준 2가지');
}

// ── 첨부 이름은 NFC (cloud.uploadOwnedFile · 검색 norm · 0072 · 2026-09-24) ─────────────────
// 맥에서 고른 파일 이름은 한글이 자모로 풀린 NFD로 와서, 같은 글자를 쳐도 검색에 안 걸렸다.
// 되돌리기 검사: 검색 norm에서 .normalize('NFC')를 빼면 첫 단정이, 업로드의 name 한 벌을
// file.name으로 되돌리면 둘째·셋째가 깨진다.
{
  const lay = readFileSync(new URL('../src/components/searchBox.jsx', import.meta.url), 'utf8');
  const normSrc = /const norm = (\(x\) => [^\n]+);/.exec(lay)?.[1];
  assert.ok(normSrc, '검색의 norm을 찾지 못했다');
  const norm = (0, eval)(normSrc);
  const nfd = '주보 파일.pdf'.normalize('NFD');
  assert.ok(nfd !== '주보 파일.pdf' && norm(nfd).includes(norm('주보파일')),
    '자모로 풀린(NFD) 이름도 같은 글자로 친 검색어에 걸린다');
  const cloud = readFileSync(new URL('../src/services/cloud.js', import.meta.url), 'utf8');
  const up = /async function uploadOwnedFile[\s\S]*?\n}\n/.exec(cloud.replace(/\r\n/g, '\n'))?.[0] || '';
  assert.ok(/const name = String\(file\.name \|\| ''\)\.normalize\('NFC'\);/.test(up),
    '업로드는 이름을 NFC로 한 번 맞춘다');
  assert.ok(up && !/file\.name/.test(up.replace(/const name = String\(file\.name[^\n]*/, '')),
    '업로드 흐름은 맞춘 name만 쓴다(file.name을 다시 읽지 않는다)');
  const mig = readFileSync(new URL('../supabase/migrations/0072_files_name_nfc.sql', import.meta.url), 'utf8');
  assert.ok(/disable trigger trg_cards_updated_meta;[\s\S]*update public\.files set name = normalize\(name, NFC\) where name <> normalize\(name, NFC\);[\s\S]*enable trigger trg_cards_updated_meta;/.test(mig),
    '0072는 카드 시각 트리거를 끄고 옛 행을 NFC로 맞춘 뒤 다시 켠다');
  console.log('PASS  첨부 이름 NFC 4가지');
}

// ── 바뀐 칸만 저장 · 하위 업무 줄 단위 병합 (2026-09-28) ────────────────────────
// 수정 모드 동안에는 실시간 반영을 멈춰 두므로 병합 기준(live)이 '수정을 누른 순간'이다. 예전 저장은
// 모든 칸을 통째로 덮어써서 **A가 제목만 고쳐도 그사이 B가 바꾼 상태가 되돌아갔다**.
// 되돌리기 검사: controllers의 `{ changed: taskChangedKeys(task, oldData), base: oldData }`를 걷으면
// 배선 단정이, utils.mergeSubtasks의 `subSame(m, b) ? t : m`을 `m`으로 바꾸면 ②가 깨진다.
{
  const U = await import(new URL('../src/utils.js', import.meta.url).href);
  const base = { title: '임원 선출', content: '본문', status: '시작 전', dueDate: '2026-10-11', startDate: '', assignees: ['가'], teams: ['웰컴팀'],
    subtasks: [{ id: 's1', title: '공지', done: false }, { id: 's2', title: '투표', done: false }], dependsOn: [], position: 0, projectId: 'p' };
  // ① A는 제목만 고쳤다 — 보낼 칸은 제목 하나(상태·하위 업무는 서버 값을 건드리지 않는다)
  const live = { ...base };                                    // 수정 모드 동안 멈춘 스토어 = base
  const mine = { ...base, title: '임원진 선출' };
  assert.deepStrictEqual(U.taskChangedKeys(mine, live), ['title'], '제목만 고치면 제목만 보낸다');
  assert.strictEqual(U.taskChangedKeys(mine, null), null, '새 업무는 전부 보낸다');
  assert.deepStrictEqual(U.taskChangedKeys({ ...base, position: 3 }, base), ['position'], '순서도 바뀐 칸으로 센다');
  // ② 하위 업무 — 나는 s1을, 서버(B)는 s2를 체크했다 → 둘 다 체크
  const mySubs = [{ id: 's1', title: '공지', done: true }, { id: 's2', title: '투표', done: false }];
  const theirs = [{ id: 's1', title: '공지', done: false }, { id: 's2', title: '투표', done: true }];
  assert.deepStrictEqual(U.mergeSubtasks(base.subtasks, mySubs, theirs).map(s => s.done), [true, true], '서로 다른 줄을 체크하면 둘 다 남는다');
  // ③ 내가 더한 줄 · 서버에만 생긴 줄 · 내가 지운 줄 · 서버가 지운 줄
  const m3 = [{ id: 's2', title: '투표', done: false }, { id: 's3', title: '결과 공지', done: false }];         // s1 지움 · s3 더함
  const t3 = [{ id: 's1', title: '공지', done: false }, { id: 's4', title: '장소', done: false }];             // s2 지움 · s4 더함
  assert.deepStrictEqual(U.mergeSubtasks(base.subtasks, m3, t3).map(s => s.id), ['s3', 's4'], '지운 줄은 양쪽 모두 존중하고 새 줄은 둘 다');
  // ④ 서버가 지운 줄을 내가 고쳤으면 살린다(내 수정이 사라지지 않게)
  assert.deepStrictEqual(U.mergeSubtasks(base.subtasks, [{ id: 's2', title: '투표', done: true }], [{ id: 's1', title: '공지', done: false }]).map(s => s.id), ['s2'],
    '서버가 지운 줄이라도 내가 고쳤으면 남는다 · 내가 지운 s1은 빠진다');
  // 배선
  const ctl = readFileSync(new URL('../src/hooks/controllers.js', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('../src/services/cloudSync.js', import.meta.url), 'utf8');
  assert.ok(/cardUpsertCloud\(task, isNew, \{ changed: taskChangedKeys\(task, oldData\), base: oldData \}\)/.test(ctl), '저장은 바뀐 칸 목록과 이전 카드를 넘긴다');
  assert.ok(/const patch = pickCols\(cardPatch\(task\), changed\)/.test(sync) && /mergeSubtasks\(base\.subtasks, task\.subtasks, now\.subtasks\)/.test(sync),
    '클라우드 쓰기는 바뀐 칸만 · 하위 업무는 서버의 지금 목록과 합친다');
  assert.ok(/changed\.includes\('teams'\) \?/.test(sync) && /changed\.includes\('assignees'\) &&/.test(sync), '팀·담당자 조인도 바뀌었을 때만 다시 쓴다');
  // 담당 팀만 바꾸면 카드 칸은 0개다(CARD_COLS.teams = []) — 빈 update는 PGRST116 → upsert({id}) → title 23502였다(2026-10-02)
  const cloudSrc = readFileSync(new URL('../src/services/cloud.js', import.meta.url), 'utf8');
  const upd = cloudSrc.slice(cloudSrc.indexOf('export async function updateCard'));
  assert.ok(/teams: \[\]/.test(sync), '팀은 카드 칸이 없다(조인 표뿐) — 그래서 아래 갈래가 필요하다');
  const emptyAt = upd.search(/if \(!Object\.keys\(patch \|\| \{\}\)\.length\) \{/);
  assert.ok(emptyAt >= 0 && emptyAt < upd.indexOf(".update(patch)"), '빈 patch는 cards.update(patch)보다 먼저 갈라진다');
  const branch = upd.slice(emptyAt, upd.indexOf(".update(patch)"));
  assert.ok(branch.indexOf("resetCardJoin('card_teams'") < branch.indexOf('updated_at'), '조인을 먼저 쓰고 그다음 updated_at으로 신호를 낸다');
  console.log('PASS  바뀐 칸만 저장 · 하위 업무 줄 단위 병합 · 팀만 바꾼 저장');
}

// ── 첨부 점검 뒤 넷 (2026-10-02 사용자 결정) ────────────────────────────────────────
// ① 지난 주보 큐시트는 앱 안 창을 보기로(inlineEdit) ② 가이드 요지는 편집 사본에서 다시 ③ 투명 PNG는 PNG로 줄인다
// ④ 드라이브 그림(lh3)에 no-referrer. 되돌리기: worshipDetail의 `< kstToday()`를 지우면 ①, sunGuide의 as: 'docx'를
// 지우면 ②, hasTransparency의 `< 255`를 `< 0`으로 바꾸면 ③이 깨진다.
{
  const fpm = readFileSync(new URL('../src/components/FilePreviewModal.jsx', import.meta.url), 'utf8');
  const wdet = readFileSync(new URL('../src/components/worshipDetail.jsx', import.meta.url), 'utf8');
  assert.ok(/canEditCopy && inlineEdit && !isMobile && copyEditUrl/.test(fpm), '앱 안 편집 화면은 inlineEdit일 때만');
  assert.ok(/inlineEdit=\{[^}]*service\.service_date < kstToday\(\)/.test(wdet), '지난 주보 큐시트는 inlineEdit이 꺼진다');
  const sg = readFileSync(new URL('../src/services/sunGuide.js', import.meta.url), 'utf8');
  const dig = sg.slice(sg.indexOf('export async function fetchCueDigest'));
  assert.ok(/fetchDriveFileBlob\(row\.preview_file_id, \{ as \}\)/.test(dig) && /const as = copyExportAs\(row\.name\)/.test(dig) && /kind: 'cuesheet'/.test(dig), '요지는 사본을 원본 종류대로 받아 큐시트 갈래로 뽑는다');
  // 15차 훑기 결함(2026-10-03): 큐시트가 여럿이면 사본·요지가 있는 것 · pptx·xlsx 사본 · 되돌리기는 자리까지
  assert.ok(/\.find\(r => r\.preview_file_id \|\| str\(r\.text_excerpt\)\)/.test(dig) && !/\.limit\(1\)/.test(dig), '큐시트가 여럿이면 사본이나 요지가 있는 최신 것');
  const { copyExportAs } = await import(new URL('../src/services/cueDigest.js', import.meta.url).href);
  assert.deepStrictEqual(['a.docx', 'b.PPTX', 'c.xlsx', 'd.pdf', 'e.hwp'].map(copyExportAs), ['docx', 'pptx', 'xlsx', null, null]);
  const df = readFileSync(new URL('../api/drive-file.js', import.meta.url), 'utf8');
  assert.ok(/presentation\/d\/\$\{id\}\/export\/pptx/.test(df) && /spreadsheets\/d\/\$\{id\}\/export\?format=xlsx/.test(df), 'drive-file: pptx·xlsx 내보내기');
  const appU = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(/saveTask\(\{ \.\.\.live, status: prev, position: t\.position \}, live\)/.test(appU), '상태 되돌리기는 자리(position)까지');
  assert.ok(/return str\(row\.text_excerpt\);\s*\}/.test(dig), '실패하면 저장된 요지로 떨어진다');
  const img = readFileSync(new URL('../src/services/image.js', import.meta.url), 'utf8');
  const { hasTransparency } = await loadSource('src/services/image.js');
  const px = (a) => new Uint8ClampedArray(Array.from({ length: 64 }, (_, i) => [10, 20, 30, a(i)]).flat());
  assert.strictEqual(hasTransparency(px(() => 255)), false, '불투명 그림은 JPEG로 간다');
  assert.strictEqual(hasTransparency(px(i => (i === 8 ? 0 : 255))), true, '투명 화소가 있으면 PNG로 간다');
  assert.ok(/alpha \? 'image\/png' : 'image\/jpeg'/.test(img), '투명이면 PNG로 굽는다');
  for (const f of ['DocEmbed.jsx', 'FilePreviewModal.jsx', 'media.jsx', 'worshipCover.jsx', 'worshipDetail.jsx']) {
    const t = readFileSync(new URL(`../src/components/${f}`, import.meta.url), 'utf8');
    assert.ok(/<img referrerPolicy="no-referrer"/.test(t), `${f}의 드라이브 그림에 no-referrer가 없다(localhost Referer는 429 · PITFALLS 29-z-20)`);
  }
  console.log('PASS  첨부 점검 뒤 넷(보기 창 · 사본 요지 · 투명 PNG · no-referrer)');
}

