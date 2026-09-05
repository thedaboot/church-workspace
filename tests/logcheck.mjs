import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

  // ── 엑셀 미리보기 주소 (utils.sheetPreviewUrl) ──
  // 구글은 .xlsx를 열어볼 때 게을리 변환해서 갓 올린 파일은 시트 미리보기가 오류를 냈다.
  // 올릴 때 스크립트가 네이티브 시트 사본을 만들어 두면 기다릴 것이 없다(0031).
  // 사본이 없으면 **null**이어야 한다 — 부르는 쪽이 그걸 보고 예전 길로 떨어진다.
  const { sheetPreviewUrl } = await import(pathToFileURL(f2).href);
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
  const { snapCols } = await import(pathToFileURL(f2).href);
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
  assert.strictEqual(failText('업무를 저장하지 못했어요', notNull), '업무를 저장하지 못했어요\n제목을 먼저 적어주세요');
  assert.strictEqual(errorReason({ code: '23502', message: 'null value in column "zzz" of relation "cards"' }), '아직 채우지 않은 칸이 있어요');
  assert.strictEqual(errorReason({ code: '23503', message: 'violates foreign key constraint "files_card_id_fkey"' }), '연결된 항목이 이미 지워졌어요\n새로고침해주세요');
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
  assert.strictEqual(failText('저장 실패', { human: '다시 시도해주세요' }), '저장 실패\n다시 시도해주세요');
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

// ── 탭 순서 바꾸기 (utils.reorderIds) ──────────────────────────────────────
// 데스크톱 드래그와 모바일 길게 눌러 끌기가 같이 쓴다. **뒤로 끄는 경우**가 핵심이다 —
// 언제나 '앞'에 끼우면 나를 뺀 만큼 뒤가 당겨져 제자리로 돌아온다(§6-12-a).
// 되돌리기 검사: reorderIds에서 splice를 `next.splice(to, 0, list[from])` 식으로
// (먼저 빼지 않고) 쓰면 '뒤로 한 칸' 단정이 바로 깨진다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'ord-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { reorderIds } = await import(pathToFileURL(f).href);

  const ids = ['a', 'b', 'c', 'd'];
  // 뒤로 끌기 — 놓은 것 **뒤**에 들어간다(앞에 넣으면 a가 제자리로 돌아온다)
  assert.deepStrictEqual(reorderIds(ids, 'a', 'c'), ['b', 'c', 'a', 'd'], '뒤로 끌면 놓은 것 뒤');
  assert.deepStrictEqual(reorderIds(ids, 'a', 'b'), ['b', 'a', 'c', 'd'], '뒤로 한 칸도 실제로 움직인다');
  assert.deepStrictEqual(reorderIds(ids, 'a', 'd'), ['b', 'c', 'd', 'a'], '맨 뒤로');
  // 앞으로 끌기 — 놓은 것 **앞**에 들어간다
  assert.deepStrictEqual(reorderIds(ids, 'd', 'b'), ['a', 'd', 'b', 'c'], '앞으로 끌면 놓은 것 앞');
  assert.deepStrictEqual(reorderIds(ids, 'c', 'a'), ['c', 'a', 'b', 'd'], '맨 앞으로');
  // 원본은 건드리지 않는다(스토어 상태를 제자리에서 고치면 안 된다)
  assert.deepStrictEqual(ids, ['a', 'b', 'c', 'd'], '원본 배열은 그대로');
  // 옮길 수 없으면 null — 부르는 쪽이 저장을 건너뛴다(없는 자리에 놓으면 전체를 다시
  // 번호 매기는 저장이 헛돌아 남의 순서까지 흔든다)
  assert.strictEqual(reorderIds(ids, 'a', 'a'), null, '제자리에 놓으면 아무 일도 없다');
  assert.strictEqual(reorderIds(ids, 'a', 'z'), null, '목록에 없는 자리');
  assert.strictEqual(reorderIds(ids, 'z', 'a'), null, '목록에 없는 것을 끌었다');
  assert.strictEqual(reorderIds([], 'a', 'b'), null, '빈 목록도 안전하다');
  console.log('PASS  탭 순서 바꾸기 10가지');
}

// ── 지금 여기를 보고 있는 사람 (utils.viewersOf) ───────────────────────────
// 프로젝트 탭 옆·업무 줄 오른쪽 얼굴이 보는 판정. 게스트 스위트는 presence 집합이
// 언제나 비어 있어 화면으로는 못 보므로(§1.1) 여기서 지킨다.
// 되돌리기 검사: viewersOf에서 `e.id === meId` 걸러내기를 빼면 '본인 제외' 단정이,
// limit를 안 보면 '최대 세 명' 단정이, **at으로 하나만 남기는 부분**을 빼면
// '한 사람은 한 곳에만'·'옮기면 옛 자리에서 즉시 빠진다' 단정이 깨진다.
// 거르기(match)를 최신 meta 고르기보다 **먼저** 하도록 순서를 바꿔도 마찬가지다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'vwr-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { viewersOf } = await import(pathToFileURL(f).href);

  const me = 'u-me';
  const entries = [
    { id: me, projectId: 'p1', cardId: 'c1', at: 500 },   // 나 — 언제나 빠진다
    { id: 'u1', projectId: 'p1', cardId: 'c1', at: 300 },
    { id: 'u2', projectId: 'p1', cardId: null, at: 100 },
    { id: 'u3', projectId: 'p2', cardId: 'c9', at: 100 },
  ];
  const opts = { meId: me, limit: 3 };
  // 프로젝트: 업무 창을 연 사람도 그 프로젝트를 보고 있는 것이 맞다
  assert.deepStrictEqual(viewersOf(entries, { projectId: 'p1' }, opts), ['u1', 'u2'], '프로젝트를 보는 사람');
  // 업무: 그 창을 지금 열어 둔 사람만
  assert.deepStrictEqual(viewersOf(entries, { cardId: 'c1' }, opts), ['u1'], '그 업무 창을 연 사람');
  assert.deepStrictEqual(viewersOf(entries, { projectId: 'p1', cardId: 'c1' }, opts), ['u1'], '업무를 물으면 업무로 본다');
  // 본인 제외 — 나만 보고 있으면 아무 얼굴도 안 뜬다
  assert.deepStrictEqual(viewersOf([{ id: me, projectId: 'p1' }], { projectId: 'p1' }, opts), [], '나만 있으면 빈 목록');

  // ── 한 사람은 최신 한 곳에만 (사용자 지적 2026-08-30) ──────────────────────
  // 기기 두 대·탭 두 개면 meta가 그 수만큼 온다. 전부 그리면 같은 얼굴이 두 프로젝트
  // 탭에, 또 두 업무 카드에 동시에 떴다. at이 가장 큰 것 하나만 그 사람의 자리다.
  const twoTabs = [
    { id: 'u1', projectId: 'p1', cardId: 'c1', at: 100 },   // 노트북 — 옛 자리
    { id: 'u1', projectId: 'p2', cardId: 'c9', at: 900 },   // 폰 — 지금 자리
  ];
  assert.deepStrictEqual(viewersOf(twoTabs, { projectId: 'p2' }, opts), ['u1'], '최신 자리에는 뜬다');
  assert.deepStrictEqual(viewersOf(twoTabs, { projectId: 'p1' }, opts), [], '옛 자리 프로젝트 탭에는 안 뜬다');
  assert.deepStrictEqual(viewersOf(twoTabs, { cardId: 'c9' }, opts), ['u1'], '카드 판정도 최신 meta 기준');
  assert.deepStrictEqual(viewersOf(twoTabs, { cardId: 'c1' }, opts), [], '옛 업무 카드에는 안 뜬다');
  // 순서가 뒤집혀 와도(sync 스냅샷의 순서는 보장되지 않는다) 결과가 같아야 한다
  assert.deepStrictEqual(viewersOf([...twoTabs].reverse(), { projectId: 'p1' }, opts), [], '들어온 순서와 무관하다');

  // 업무 창을 닫으면 그 카드에서 **즉시** 빠진다 — 닫을 때 새 at으로 track이 나가므로
  // 그 meta가 이긴다(사용자 요구: "다른 데로 가면 바로 아이콘이 빠지게").
  const closed = [
    { id: 'u1', projectId: 'p1', cardId: 'c1', at: 100 },
    { id: 'u1', projectId: 'p1', cardId: null, at: 200 },
  ];
  assert.deepStrictEqual(viewersOf(closed, { cardId: 'c1' }, opts), [], '업무를 닫으면 그 카드에서 빠진다');
  assert.deepStrictEqual(viewersOf(closed, { projectId: 'p1' }, opts), ['u1'], '프로젝트에는 그대로 남는다');
  // 프로젝트를 떠나면(대시보드로 가면 projectId가 null) 옛 프로젝트 탭에서 빠진다
  const left = [
    { id: 'u1', projectId: 'p1', cardId: null, at: 100 },
    { id: 'u1', projectId: null, cardId: null, at: 200 },
  ];
  assert.deepStrictEqual(viewersOf(left, { projectId: 'p1' }, opts), [], '프로젝트를 떠나면 그 탭에서 빠진다');
  // at이 없는 옛 meta는 0으로 본다(배포 전환기 — 새 코드와 옛 탭이 섞인다)
  const mixed = [
    { id: 'u1', projectId: 'p1', cardId: null },            // 옛 탭 = 0
    { id: 'u1', projectId: 'p2', cardId: null, at: 1 },
  ];
  assert.deepStrictEqual(viewersOf(mixed, { projectId: 'p2' }, opts), ['u1'], 'at 없는 옛 meta는 0');
  assert.deepStrictEqual(viewersOf(mixed, { projectId: 'p1' }, opts), [], 'at 없는 옛 meta는 밀린다');

  // ── 재접속한 백그라운드 탭이 지금 보는 탭을 이기면 안 된다 (2026-09-05 사용자 지적) ──
  // presence 열쇠가 user.id라 한 사람의 탭·기기 meta가 한 열쇠에 같이 산다. 예전에는
  // 재접속(SUBSCRIBED가 다시 불림)마다 at을 새로 찍어서, **자리를 안 옮긴** 옛 탭이
  // 가장 큰 at을 갖고 이겼다 — "임원진 회의를 보고 있는데 가을 체육대회로 나온다".
  // 지금 규칙은 at이 '자리를 옮긴 시각'이라 재접속으로는 안 바뀐다(nextWhereMeta).
  const reconnected = [
    { id: 'u1', projectId: '가을체육대회', cardId: null, at: 100, seq: 1 },  // 켜 둔 채 재접속한 탭
    { id: 'u1', projectId: '임원진회의', cardId: null, at: 900, seq: 1 },    // 지금 보는 탭
  ];
  assert.deepStrictEqual(viewersOf(reconnected, { projectId: '임원진회의' }, opts), ['u1'],
    '재접속해도 지금 보고 있는 자리에 뜬다');
  assert.deepStrictEqual(viewersOf(reconnected, { projectId: '가을체육대회' }, opts), [],
    '켜 두기만 한 옛 탭에는 안 뜬다');
  // 같은 밀리초에 두 번 옮기면 seq가 순서를 정한다(한 클라이언트 안에서만 뜻이 있다)
  const sameMs = [
    { id: 'u1', projectId: 'p1', cardId: null, at: 500, seq: 7 },
    { id: 'u1', projectId: 'p2', cardId: null, at: 500, seq: 8 },
  ];
  assert.deepStrictEqual(viewersOf(sameMs, { projectId: 'p2' }, opts), ['u1'], '같은 at이면 seq가 큰 쪽');
  assert.deepStrictEqual(viewersOf(sameMs, { projectId: 'p1' }, opts), [], '같은 at이면 seq가 작은 쪽은 밀린다');
  assert.deepStrictEqual(viewersOf([...sameMs].reverse(), { projectId: 'p2' }, opts), ['u1'],
    'seq 판정도 들어온 순서와 무관하다');

  // 최대 세 명
  const many = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, projectId: 'p1', cardId: null, at: 1 }));
  assert.deepStrictEqual(viewersOf(many, { projectId: 'p1' }, opts), ['a', 'b', 'c'], '최대 세 명');
  assert.strictEqual(viewersOf(many, { projectId: 'p1' }, { meId: me, limit: 0 }).length, 5, 'limit 0이면 전부');
  // 게스트·초기 상태 — 집합이 비어 있어도 죽지 않는다
  assert.deepStrictEqual(viewersOf([], { projectId: 'p1' }, opts), [], '빈 집합');
  assert.deepStrictEqual(viewersOf(null, { projectId: 'p1' }, opts), [], 'null도 안전하다');
  assert.deepStrictEqual(viewersOf(entries, {}, opts), [], '물은 곳이 없으면 아무도 아니다');
  assert.deepStrictEqual(viewersOf(entries, { projectId: 'p1' }, {}), ['u-me', 'u1', 'u2'], '내 id를 모르면 아무도 안 뺀다');
  console.log('PASS  지금 보고 있는 사람 25가지');
}

// ── presence가 자리와 함께 시각을 실어 보내는지 (services/presence.js 소스 단정) ──
// viewersOf가 '최신 한 곳'을 고르려면 meta에 at이 있어야 한다. 이 파일은 supabase
// 클라이언트를 import해서 노드에서 실행할 수 없으므로 소스로 지킨다(§6-31과 같은 방식).
//
// **`at`은 "자리를 옮긴 시각"이지 "연결이 살아 있다고 알린 시각"이 아니다**(2026-09-06).
// 예전에는 track할 때마다 `Date.now()`를 새로 찍었고 **재접속에서도** 그랬다 — 옛
// 프로젝트를 켜 둔 백그라운드 탭이 재접속하는 것만으로 지금 보고 있는 탭을 이겼다
// (사용자 지적 2026-09-05 — "임원진 회의를 보고 있는데 가을 체육대회로 나온다").
// 되돌리기 검사: `ch.track(meta)`를 `ch.track({ ...meta, at: Date.now() })`로 되돌리면
// 세 번째 단정이 깨진다. teardown에 `meta = {`를 되살리면 네 번째가 깨진다.
{
  const src = readFileSync(new URL('../src/services/presence.js', import.meta.url), 'utf8');
  assert.ok(/nextWhereMeta\(meta, next\)/.test(src),
    'trackWhere가 자리 판정·meta 만들기를 순수 함수(utils.nextWhereMeta)에 맡긴다');
  assert.ok(/at:\s*Number\(m\.at\)\s*\|\|\s*0/.test(src) && /seq:\s*Number\(m\.seq\)\s*\|\|\s*0/.test(src),
    'entriesOf가 meta의 at·seq를 넘긴다(없으면 0)');
  assert.ok(!/track\([^)]*Date\.now\(\)/.test(src),
    'track에 그 자리에서 찍은 시각을 실지 않는다 — 재접속이 옛 자리를 되살린다');
  // 구독을 떼면서 자리를 지우면, 다시 붙었을 때 App의 trackWhere effect는 자리가
  // 그대로라 다시 불리지 않아 `{null, null}`이 나간다 → 얼굴이 통째로 사라진다.
  const teardown = src.slice(src.lastIndexOf('return () => {'));
  assert.ok(!/^\s*meta = \{/m.test(teardown) && !/^\s*where = \{/m.test(teardown),
    '구독을 뗄 때 보고 있는 자리를 지우지 않는다(연결만 소유한다)');
  console.log('PASS  presence가 자리와 시각을 실어 보낸다 4가지');
}

// ── 자리를 옮겼나 · 옮겼으면 어떤 meta인가 (utils.nextWhereMeta) ─────────────
// presence.js에서 떼어낸 순수 판정. 재접속 때는 이 함수를 **부르지 않고** 마지막 meta를
// 그대로 다시 보내는 것이 규칙이라, at은 오직 여기서만 새로 찍힌다.
// 되돌리기 검사: 같은 자리에서 null을 안 돌려주면 두 번째 단정이(track 한 번이 접속한
// 모두에게 sync를 만든다), seq를 안 올리면 마지막 단정이 깨진다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'nwm-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { nextWhereMeta } = await import(pathToFileURL(f).href);

  const first = nextWhereMeta(null, { projectId: 'p1', cardId: null }, 100);
  assert.deepStrictEqual(first, { projectId: 'p1', cardId: null, at: 100, seq: 1 }, '첫 자리');
  assert.strictEqual(nextWhereMeta(first, { projectId: 'p1' }, 200), null, '같은 자리면 아무것도 안 보낸다');
  assert.strictEqual(nextWhereMeta(first, { projectId: 'p1', cardId: null }, 200), null, 'null과 undefined는 같은 자리');
  const moved = nextWhereMeta(first, { projectId: 'p2', cardId: 'c9' }, 300);
  assert.deepStrictEqual(moved, { projectId: 'p2', cardId: 'c9', at: 300, seq: 2 }, '옮기면 새 at·다음 seq');
  const leftAll = nextWhereMeta(moved, { projectId: null, cardId: null }, 400);
  assert.deepStrictEqual(leftAll, { projectId: null, cardId: null, at: 400, seq: 3 },
    '교회 화면(홈·예배·말씀·모임)으로 가면 자리가 비고, 그것도 이동이다');
  assert.strictEqual(nextWhereMeta(leftAll, {}, 500), null, '빈 자리에서 빈 자리로는 안 보낸다');
  assert.strictEqual(nextWhereMeta(leftAll, undefined, 500), null, '인자가 없어도 안전하다');
  console.log('PASS  자리 이동 판정 7가지');
}

// ── presence 연결 수명 (services/presence.js 소스 단정) ──────────────────────
// 실제 동작은 노드 하네스로 실측했다(2026-08-30). 여기서는 그 결론이 코드에서 빠지지
// 않게 배선만 지킨다 — 셋 중 하나라도 사라지면 '새로고침해야 반영되는' 자리로 돌아간다.
// 되돌리기 검사: healRefs 두 줄 중 하나를 지우면 첫 단정이, joined를 안 내리면 두 번째가,
// visibilitychange를 지우면 세 번째가 깨진다.
{
  const src = readFileSync(new URL('../src/services/presence.js', import.meta.url), 'utf8');
  // 라이브러리가 지운 phx_ref를 되살리지 않으면 leave가 영영 안 먹어서 나간 사람이 안 사라진다.
  // join·leave 둘 다 걸어야 한다 — 같은 diff 안에서 join이 먼저 처리되기 때문이다.
  assert.ok(/m\.phx_ref = m\.presence_ref/.test(src), '지워진 phx_ref를 되살린다');
  assert.ok(/event: 'join' \}, healRefs/.test(src) && /event: 'leave' \}, healRefs/.test(src),
    'join과 leave 둘 다에서 되살린다');
  assert.ok(/if \(status !== 'SUBSCRIBED'\) \{ joined = false; return; \}/.test(src),
    '끊기면 joined를 내린다(다시 붙을 때 최신 where가 한 번에 나간다)');
  assert.ok(/addEventListener\('visibilitychange'/.test(src) && /removeEventListener\('visibilitychange'/.test(src),
    '탭이 다시 보일 때 연결을 확인하고, 떼어낼 때 리스너도 뗀다');
  console.log('PASS  presence 연결 수명 4가지');
}

// ── 다녀간 시각 심장박동 간격 (utils.dueForHeartbeat) ────────────────────────
// 앱을 열 때 한 번만 찍던 것을 '보이는 동안 5분마다'로 바꿨다(사용자 지적 2026-08-30).
// 쓰기 비용이 걸린 판정이라 경계를 못으로 박는다 — 5분에 UPDATE 한 번을 넘기면 안 된다.
// 되돌리기 검사: HEARTBEAT_MS를 1분으로 줄이면 두 번째 단정이, `>=`를 `>`로 바꾸면
// 세 번째 단정이 깨진다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'beat-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { dueForHeartbeat, HEARTBEAT_MS } = await import(pathToFileURL(f).href);
  const NOW = 1_000_000_000;
  assert.strictEqual(HEARTBEAT_MS, 5 * 60 * 1000, '간격은 5분(사용자와 정한 값)');
  assert.strictEqual(dueForHeartbeat(NOW - 4 * 60e3, NOW), false, '4분 전이면 아직 안 찍는다');
  assert.strictEqual(dueForHeartbeat(NOW - 5 * 60e3, NOW), true, '딱 5분이면 찍는다(경계 포함)');
  assert.strictEqual(dueForHeartbeat(NOW - 60 * 60e3, NOW), true, '한참 지났으면 당연히 찍는다');
  assert.strictEqual(dueForHeartbeat(0, NOW), true, '한 번도 안 찍었으면 찍는다');
  assert.strictEqual(dueForHeartbeat(null, NOW), true, '값이 없어도 안전하다');
  console.log('PASS  심장박동 간격 6가지');
}

// ── 쓰기는 곧 '지금'이다 (utils.WRITE_STAMP_MS · mergeActivitySeen) ──────────
// 증상(사용자 2026-09-05): "1분 전에 업무를 수정했다고 뜨는데, 그 사람 현황을 보면
// 4분 전에 떠났다고 뜬다." 라이브에서 실제로 activity가 last_seen_at보다 **225초 뒤**였다.
// 5분 박동은 *아무것도 안 하는 사람*의 상한이라 그 사이의 쓰기가 통째로 안 보였다.
// 고친 규칙 한 줄: **presence(접속 중) > max(last_seen_at, 그 사람의 최근 활동)**.
// 되돌리기 검사: mergeActivitySeen에서 `at <= (m.lastSeenAt || '')` 비교를 지우면 첫
// 단정이, 바뀐 것이 없을 때 같은 배열을 안 돌려주면 '같은 배열' 단정이 깨진다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'wrote-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { WRITE_STAMP_MS, dueForHeartbeat, mergeActivitySeen, lastVisitOf, visitOrder } =
    await import(pathToFileURL(f).href);

  // 쓰기 스탬프는 1분에 한 번 — 저장 한 번이 카드·팀·담당자 쓰기를 여러 번 만든다.
  assert.strictEqual(WRITE_STAMP_MS, 60 * 1000, '쓰기 스탬프는 1분에 한 번');
  const T = 1_000_000_000;
  assert.strictEqual(dueForHeartbeat(T - 59e3, T, WRITE_STAMP_MS), false, '59초면 아직 안 찍는다');
  assert.strictEqual(dueForHeartbeat(T - 60e3, T, WRITE_STAMP_MS), true, '딱 1분이면 찍는다');

  // 사용자가 본 그 장면을 그대로 — 다녀감은 15:54, 그런데 15:58에 업무를 고쳤다.
  const M = [
    { id: 'u1', name: '박지호', lastSeenAt: '2026-09-05T15:54:49.293Z' },
    { id: 'u2', name: '조해리', lastSeenAt: '2026-09-05T14:15:01.243Z' },
    { id: 'u3', name: '기록없음' },
  ];
  const feed = [
    { id: 'a1', actorId: 'u1', at: '2026-09-05T15:58:34.026269+00:00', action: '상세 내용을 수정했습니다.' },
    { id: 'a2', actorId: 'u2', at: '2026-09-01T02:47:41.040559+00:00', action: '댓글을 남겼습니다.' },
  ];
  const merged = mergeActivitySeen(M, feed);
  assert.strictEqual(lastVisitOf(merged[0]), '2026-09-05T15:58:34.026Z',
    '활동이 더 최근이면 그 시각이 다녀간 시각이 된다');
  assert.strictEqual(lastVisitOf(merged[1]), '2026-09-05T14:15:01.243Z',
    '다녀간 시각이 더 최근이면 그대로 둔다(옛 활동이 시간을 되돌리면 안 된다)');
  assert.strictEqual(merged[2].lastSeenAt, undefined, '활동이 없는 사람은 손대지 않는다');
  // 그리고 그 값이 목록 순서에도 그대로 먹는다(두 화면이 같은 함수를 쓴다)
  assert.deepStrictEqual(visitOrder(merged).map(m => m.name), ['박지호', '조해리', '기록없음']);

  // **바뀐 것이 없으면 받은 배열 그대로** — 아니면 남이 저장할 때마다 연결 지도가 다시 배치된다
  assert.strictEqual(mergeActivitySeen(M, []), M, '피드가 비면 그대로');
  assert.strictEqual(mergeActivitySeen(M, feed.slice(1)), M, '옛 활동뿐이면 그대로');
  assert.strictEqual(mergeActivitySeen(M, [{ id: 'g1', actorName: '노준석', at: '2027-01-01T00:00:00Z' }]), M,
    '게스트 피드(id 없이 이름뿐)는 아무도 안 밀어낸다');
  assert.notStrictEqual(mergeActivitySeen(M, feed), M, '실제로 밀린 사람이 있으면 새 배열');
  assert.deepStrictEqual(mergeActivitySeen([], feed), [], '멤버가 없어도 안전하다');
  assert.deepStrictEqual(mergeActivitySeen(undefined, undefined), [], '인자가 없어도 안전하다');
  console.log('PASS  쓰기는 곧 지금 12가지');
}

// ── 다녀간 시각을 찍는 자리가 하나인가 (services/cloudSync.js · App.jsx 소스 단정) ──
// 넷이 같은 값을 찍는다(앱 열 때 · 5분 박동 · 떠날 때 · 쓰기). 마지막으로 찍은 시각을
// 한 곳에서 들고 있지 않으면 방금 저장한 사람에게 박동이 또 쓰고, 어느 쪽이 진짜인지 모른다.
// 되돌리기 검사: setWriteObserver 등록을 지우면 첫 단정이, App이 다시 자기 lastAt을
// 들면 마지막 단정이 깨진다.
{
  const sync = readFileSync(new URL('../src/services/cloudSync.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../src/services/supabaseClient.js', import.meta.url), 'utf8');
  assert.ok(/^setWriteObserver\(\(\) => markSeen\(WRITE_STAMP_MS\)\);/m.test(sync),
    '쓰기 한 번마다 다녀간 시각을 찍는다(1분 스로틀)');
  assert.ok(/global: \{ fetch: observedFetch \}/.test(client),
    '쓰기를 보는 자리는 클라이언트가 실제로 내보내는 요청 하나다');
  assert.ok(client.includes('is_admin|is_master|is_approved|touch_last_seen'),
    '자격 확인·다녀간 시각 자신은 쓰기로 세지 않는다(스탬프가 스스로를 부른다)');
  assert.ok(/lastSeenStampAt/.test(sync) && !/let lastAt = Date\.now\(\)/.test(app),
    '마지막으로 찍은 시각은 cloudSync 한 곳만 들고 있다');
  console.log('PASS  다녀간 시각을 찍는 자리 4가지');
}

// ── 상대 시간 라벨이 스스로 늙는가 (hooks/useMinuteTick.js) ──────────────────
// 멤버 모달·대시보드를 열어 두면 'N분 전'이 그릴 때 값으로 굳었다(사용자 지적 2026-08-30).
// 틱 값은 **숫자 하나**여야 한다 — 매번 새 객체를 state로 두면 §4.9의 무한 리렌더가 된다.
// 되돌리기 검사: minuteOf의 60000을 1000으로 바꾸면 경계 단정이, 화면에서
// useMinuteTick()을 빼면 그 자리 단정이 깨진다.
{
  const raw = readFileSync(new URL('../src/hooks/useMinuteTick.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'tick-'));
  const f = join(dir, 'tick.mjs');
  // react import만 걷어내면 순수 부분(minuteOf)을 노드에서 그대로 부를 수 있다
  writeFileSync(f, raw.replace(/^import .*from 'react';\s*$/m, ''));
  const { minuteOf } = await import(pathToFileURL(f).href);
  assert.strictEqual(minuteOf(0), 0);
  assert.strictEqual(minuteOf(59_999), 0, '1분 안에서는 값이 그대로다(헛렌더가 없다)');
  assert.strictEqual(minuteOf(60_000), 1, '1분이 지나면 값이 바뀐다 → 라벨이 다시 그려진다');
  assert.strictEqual(typeof minuteOf(), 'number', '틱은 숫자 하나다(새 객체가 아니다)');
  assert.ok(/setInterval\(\(\) => setMinute\(minuteOf\(\)\), 60000\)/.test(raw), '1분 간격이다');
  assert.ok(/clearInterval/.test(raw), '언마운트하면 타이머를 끈다');

  // 훅이 붙어 있어야 하는 자리 — 빠지면 그 화면의 'N분 전'이 다시 굳는다
  const members = readFileSync(new URL('../src/views/membersView.jsx', import.meta.url), 'utf8');
  assert.ok(/useMinuteTick\(\)/.test(members), '멤버 관리 화면이 1분 틱을 쓴다');
  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  assert.strictEqual((parts.match(/useMinuteTick\(\)/g) || []).length, 2,
    '가입한 사람 모달과 최근 활동 피드 둘 다 1분 틱을 쓴다');
  console.log('PASS  1분 틱 8가지');
}

// ── 본문 링크로 연 업무에서 뒤로가기 (App.jsx 소스 단정) ──────────────────────
// 주소 쓰기는 기본이 replaceState라 history가 안 쌓이고, 본문 링크로 건너뛸 때만
// 한 번 pushState라 뒤로가기가 보던 자리로 돌아온다. popstate는 주소를 다시 읽는다.
// 되돌리기 검사: pushNextUrlRef를 안 올리면 첫 단정이, popstate 리스너를 지우면
// 마지막 단정이 깨진다. (실제 동작은 브라우저로 확인한다 — 여기서는 배선만 지킨다.)
{
  const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(/pushNextUrlRef\.current = true; setActiveMenu\(task\.projectId\); openTaskModal\(task\)/.test(src),
    '본문 링크로 업무를 열 때 다음 주소를 push로 남긴다');
  assert.ok(/window\.history\.pushState\(null, '', next\)[\s\S]{0,40}window\.history\.replaceState\(null, '', next\)/.test(src),
    '주소 동기화는 push 한 번을 빼면 replaceState다');
  assert.ok(/addEventListener\('popstate'/.test(src) && /removeEventListener\('popstate'/.test(src),
    'popstate를 듣고 떼어낸다');
  // 업무 창이 열려 있으면 프로젝트는 그 업무의 것 — 내 업무·대시보드·검색에서 연
  // 사람은 isProjectScreen이 false라 projectId가 null로 나가서, 카드에는 얼굴이
  // 붙는데 프로젝트 탭 집계에서는 빠졌다(2026-08-30 — "업무는 3명인데 탭은 1명").
  assert.ok(/modalState\.isOpen && modalState\.task\?\.projectId\)\s*\|\|\s*\(isProjectScreen \? activeMenu : null\)/.test(src),
    '업무 창이 열려 있으면 그 업무의 프로젝트로 track한다(탭·카드 집계가 어긋나지 않게)');
  console.log('PASS  뒤로가기·트래킹 배선 4가지');
}

// ── 최신순 정렬 (utils.byNewest / byCompleted) ─────────────────────────────────
// 사용자 결정 2026-08-31: 선행 업무 후보와 '끝낸 업무' 목록은 맨 위가 가장 최신이어야
// 한다. 예전에는 후보가 allIds 순서(만든 순 오름차순)라 맨 위가 가장 오래된 업무였고,
// 완료를 누르면 그 줄이 몇 년 전 업무들 아래로 사라졌다.
// 되돌리기 검사: byNewest/byRecent의 a·b를 뒤집으면 첫 단정이, 호출부에서 .sort를
// 빼면 마지막 두 단정이 깨진다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'recent-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { byNewest, byCompleted, completedTime } = await import(pathToFileURL(f).href);

  const mk = (id, createdAt, updatedAt, completedAt) => ({ id, createdAt, updatedAt, completedAt });
  const L = [
    mk('old', '2026-01-02T00:00:00Z', '2026-08-30T00:00:00Z', '2026-02-01T00:00:00Z'),
    mk('new', '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z'),
    mk('mid', '2026-05-05T00:00:00Z', '2026-05-05T00:00:00Z', '2026-05-05T00:00:00Z'),
  ];
  assert.deepStrictEqual([...L].sort(byNewest).map(t => t.id), ['new', 'mid', 'old'],
    '후보 목록은 만든 순 내림차순 — 남이 옛 업무를 고쳐도 순서가 흔들리지 않는다');
  // 'old'는 어제 손댔지만(updatedAt) 끝낸 건 2월이다 → 맨 아래여야 한다.
  // updatedAt으로 정렬하면 맨 위로 올라온다 — 그게 화면에 보이는 날짜와 어긋난 버그였다.
  assert.deepStrictEqual([...L].sort(byCompleted).map(t => t.id), ['new', 'mid', 'old'],
    "'끝낸 업무'는 끝낸 순 내림차순 — 완료 뒤에 손댄 것이 위로 올라오지 않는다");
  assert.strictEqual(completedTime(L[0]).slice(0, 10), '2026-02-01',
    '날짜 칸이 쓰는 값도 같은 함수에서 나온다(정렬 기준 = 보이는 날짜)');
  // 폴백: completedAt이 없는 옛 데이터는 updatedAt → createdAt 순으로 떨어진다
  assert.strictEqual(completedTime({ updatedAt: 'u', createdAt: 'c' }), 'u');
  assert.strictEqual(completedTime({ createdAt: 'c' }), 'c');
  assert.strictEqual(completedTime({}), '', '아무것도 없으면 빈 문자열(뒤로 간다)');
  assert.strictEqual(byNewest(undefined, undefined), 0, '빈 칸이 섞여도 안 던진다');
  assert.strictEqual(byCompleted(undefined, undefined), 0, '빈 칸이 섞여도 안 던진다');

  // 호출부 배선 — 순수 함수만 맞아도 화면이 안 쓰면 아무 일도 일어나지 않는다
  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  assert.ok(/\.sort\(b\.key === 'done' \? byCompleted : byDue\)/.test(parts),
    "groupByDue가 '끝낸 업무' 구간만 byCompleted로 정렬한다");
  assert.ok(/rowDate = \(t, bucketKey\)/.test(parts) && /mdLabel\(rowDate\(t, g\.key\)\)/.test(parts),
    "날짜 칸이 rowDate를 쓴다 — '끝낸 업무'는 마감일이 아니라 끝낸 날이다");
  const modals = readFileSync(new URL('../src/modals/modals.jsx', import.meta.url), 'utf8');
  assert.ok(/\.sort\(byNewest\)/.test(modals), '선행 업무 후보가 byNewest로 정렬된다');
  console.log('PASS  최신순 정렬 10가지');
}

// ── 등장 순차 애니메이션은 첫 마운트에서만 (hooks/useEnterStagger) ─────────────
// 원래 버그(사용자 지적 2026-08-31 — "순차 애니메이션 순서가 종종 이상하다"):
// `.dc-row`/`.dc-card`는 fill-mode가 both라 animationDelay 동안 투명하다. 목록이 뜬
// 뒤에 새로 붙는 줄(완료로 옮긴 업무, 컬럼을 옮긴 카드)에도 순번 지연을 주면 그 줄만
// 수백 ms 뒤에 혼자 나타나서 지각으로 읽혔다. 순번은 첫 렌더에서만 준다.
// 되돌리기 검사: 훅에서 useEffect를 빼면 첫 단정이, 호출부의 삼항을 지우면 뒤 두 개가 깨진다.
{
  const hook = readFileSync(new URL('../src/hooks/useEnterStagger.js', import.meta.url), 'utf8');
  assert.ok(/useRef\(true\)/.test(hook) && /useEffect\(\(\) => \{ first\.current = false; \}, \[\]\)/.test(hook),
    '첫 렌더에서만 true — 마운트 뒤에는 false다');
  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  assert.ok(/const stagger = useEnterStagger\(\);/.test(parts)
    && /stagger \? `\$\{Math\.min\(seen\+\+, 12\) \* 22\}ms` : '0ms'/.test(parts),
    '마감 목록은 첫 렌더에서만 순번 지연을 준다');
  const boards = readFileSync(new URL('../src/components/boards.jsx', import.meta.url), 'utf8');
  assert.ok(/const stagger = useEnterStagger\(\);/.test(boards) && /index=\{stagger \? i : 0\}/.test(boards),
    '보드 카드도 첫 렌더에서만 순번 지연을 준다');
  console.log('PASS  순차 등장 배선 3가지');
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

// ── 그래프가 부드러운지 (utils.forceStep 상수) ────────────────────────────────
// 사용자 지적 2026-08-31 — "모바일에서 탄성이 엄청난 그래프처럼 된다".
// 실제 규모(사람 15·팀 7·프로젝트 15)로 돌려서 **초기 폭발**과 **방향 반전**을 잰다.
// 옛 상수(SPRING .02 · DAMP .8 · MAX_V 18)에서는 최고 52px/프레임 · 반전 3.5회였다.
// 되돌리기 검사: utils.js의 DAMP를 0.8, MAX_V를 18로 되돌리면 앞 두 단정이 깨진다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'soft-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { forceStep } = await import(pathToFileURL(f).href);

  const W = 340, H = 460, M = 15, T = 7, P = 15;   // 모바일 · 지금 워크스페이스 규모
  const nodes = [], edges = [];
  for (let k = 0; k < M; k++) nodes.push({ id: `m${k}`, ax: 0.16, iy: (k + 0.5) / M, zx: [0.02, 0.36] });
  for (let k = 0; k < T; k++) nodes.push({ id: `t${k}`, fixed: { x: W * 0.44, y: 26 + ((k + 0.5) / T) * (H - 52) } });
  for (let k = 0; k < P; k++) nodes.push({ id: `p${k}`, ax: 0.8, iy: (k + 0.5) / P, zx: [0.56, 0.98], repel: 1.7 });
  const lenMT = (0.44 - 0.16) * W, lenTP = (0.8 - 0.44) * W;
  for (let k = 0; k < M; k++) edges.push([k, M + (k % T), lenMT]);
  for (let k = 0; k < P; k++) edges.push([M + (k % T), M + T + k, lenTP]);
  const pos = nodes.map((n, i) => n.fixed ? { ...n.fixed }
    : { x: W * n.ax + ((i * 37) % 13) - 6, y: 24 + n.iy * (H - 48) });
  const vel = nodes.map(() => ({ x: 0, y: 0 }));

  let alpha = 1, maxStep = 0, reversals = 0, frames = 0;
  const sign = nodes.map(() => ({ x: 0, y: 0 }));
  while (alpha > 0.002 && frames < 900) {
    const was = pos.map(p => ({ ...p }));
    for (let k = 0; k < 3; k++) { forceStep(pos, vel, nodes, edges, W, H, { alpha }); alpha -= alpha * 0.0228; }
    frames++;
    nodes.forEach((n, i) => {
      if (n.fixed) return;
      const dx = pos[i].x - was[i].x, dy = pos[i].y - was[i].y, sp = Math.hypot(dx, dy);
      if (sp > maxStep) maxStep = sp;
      if (sp > 0.5) {
        if (sign[i].x && Math.sign(dx) && Math.sign(dx) !== sign[i].x) reversals++;
        if (sign[i].y && Math.sign(dy) && Math.sign(dy) !== sign[i].y) reversals++;
        sign[i].x = Math.sign(dx); sign[i].y = Math.sign(dy);
      }
    });
  }
  // **눈에 보이는 것은 첫 프레임들이다.** 상수를 부드럽게 잡은 뒤에도 남아 있던
  // "촥 펼쳐지는" 느낌의 정체가 그것이었다(사용자 지적 2026-08-31 2차) — 노드가 거의
  // 같은 x에 쌓여 시작하니 척력이 30프레임쯤 옆으로 밀어낸다. useForceGraph가 그 구간을
  // **첫 페인트 전에** 흘려보낸다. 여기서는 같은 방식으로 재서 효과를 못 박는다.
  const visibleMove = (settle) => {
    const p2 = nodes.map((n, i) => n.fixed ? { ...n.fixed }
      : { x: W * n.ax + ((i * 37) % 13) - 6, y: 24 + n.iy * (H - 48) });
    const v2 = nodes.map(() => ({ x: 0, y: 0 }));
    let a = 1, guard = 0;
    while (a > settle && guard++ < 400) {
      for (let k = 0; k < 3; k++) { forceStep(p2, v2, nodes, edges, W, H, { alpha: a }); a -= a * 0.0228; }
    }
    let moved = 0, top = 0;
    for (let fr = 0; fr < 20 && a > 0.002; fr++) {
      const was = p2.map(q => ({ ...q }));
      for (let k = 0; k < 3; k++) { forceStep(p2, v2, nodes, edges, W, H, { alpha: a }); a -= a * 0.0228; }
      nodes.forEach((n, i) => {
        if (n.fixed) return;
        const sp = Math.hypot(p2[i].x - was[i].x, p2[i].y - was[i].y);
        moved += sp; if (sp > top) top = sp;
      });
    }
    return { per: moved / (M + P), top };
  };
  const raw = visibleMove(1);      // 미리 안 돌린 것 = 예전 동작
  const pre = visibleMove(0.3);    // 모바일 SETTLE_MOBILE
  assert.ok(raw.per > 40, `미리 안 돌리면 첫 20프레임이 요란하다 (${Math.round(raw.per)}px/노드)`);
  assert.ok(pre.per < raw.per / 5,
    `미리 돌리면 보이는 폭발이 5분의 1 미만 (${Math.round(raw.per)} → ${Math.round(pre.per)}px/노드)`);
  assert.ok(pre.top < 4, `보이는 최고 속도가 낮다 (${pre.top.toFixed(1)}px/프레임)`);
  const hook = readFileSync(new URL('../src/hooks/useForceGraph.js', import.meta.url), 'utf8');
  assert.ok(/while \(alphaRef\.current > settle/.test(hook) && /kick\(alphaRef\.current\)/.test(hook),
    '첫 페인트 전에 미리 돌리고 남은 온기로만 애니메이션한다');
  assert.ok(/SETTLE_MOBILE = 0\.3/.test(hook) && /SETTLE_DESK = 0\.55/.test(hook),
    '모바일을 더 낮게 둔다 — 폭이 좁아 같은 힘에도 더 크게 흔들려 보인다');

  const perNode = reversals / (M + P);
  assert.ok(maxStep <= 26, `초기 폭발이 잦다 — 최고 ${maxStep.toFixed(1)}px/프레임 (옛 상수 52)`);
  assert.ok(perNode <= 2.2, `출렁임이 적다 — 방향 반전 ${perNode.toFixed(1)}회/노드 (옛 상수 3.5)`);
  assert.ok(frames <= 200, `그래도 멈춘다 — ${frames}프레임`);

  // 선의 목표 길이가 앵커 간격에서 나오는지(화면 코드) — 고정값이면 스프링이 앵커와 싸운다
  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  assert.ok(/const EDGE_OF = \(a, b, W\)/.test(parts) && /EDGE_OF\(AX\.m, AX\.t, W\)/.test(parts),
    '연결 지도의 선 길이 = 앵커 간격');
  // 1400 상한도 1858px 카드에서 좌우 229px씩 남겼다 → 상한을 없애고 카드 폭을 그대로 쓴다
  assert.ok(/const W = cw;/.test(parts), '데스크톱은 카드 폭을 다 쓴다(좌우 여백 낭비를 줄인 자리)');
  assert.ok(/rows \* FM\.ROW_DESK \+ 60/.test(parts), '높이가 줄 수를 따라간다(라벨 겹침의 원인)');
  const dep = readFileSync(new URL('../src/components/depgraph.jsx', import.meta.url), 'utf8');
  assert.ok(/colGap \* span/.test(dep), '프로젝트 그래프 뷰도 열 간격으로 선 길이를 잡는다');
  console.log('PASS  그래프 부드러움 12가지');
}

// ── 같은 층 라벨 떼어놓기 (utils.spreadLabels) ─────────────────────────────────
// 연결 지도가 **그릴 때** 쓴다. 힘 배치는 겹치지 않음을 보장할 수 없어서(척력을
// 세게 하면 노드가 영역 밖으로 밀린다) 화면 y만 최소 간격을 지키게 민다.
// 첫판은 아래로 넘칠 때 "넘친 양을 빼고 y0로 클램프"였는데 **위 두 개가 경계에
// 뭉쳤다** — 실제로 브라우저에서 '2026 워크스페이스 개선'과 '2026 월례회'가 같은
// y에 겹쳐 있었다. 지금은 위→아래, 아래→위 두 방향 훑기다.
// 되돌리기 검사: 아래→위 패스를 지우면 "아래 경계를 안 넘는다"가 깨진다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'lbl-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { spreadLabels } = await import(pathToFileURL(f).href);

  const ys = (m, items) => items.map(it => Math.round(m.get(it.i)));
  // 같은 y에 몰린 둘 — 최소 간격만큼 벌어져야 한다
  const two = [{ i: 'a', y: 58 }, { i: 'b', y: 58 }];
  const r2 = spreadLabels(two, 30, 20, 500);
  assert.deepStrictEqual(ys(r2, two), [58, 88], '같은 y에 몰린 둘을 벌린다');

  // 자연스러운 자리가 넓게 퍼져 아래로 넘치는 경우 — 되밀어도 뭉치지 않아야 한다
  const wide = [40, 60, 200, 260, 330, 400, 470, 495].map((y, k) => ({ i: k, y }));
  const rw = spreadLabels(wide, 60, 20, 500);
  const got = ys(rw, wide);
  for (let k = 1; k < got.length; k++) {
    assert.ok(got[k] - got[k - 1] >= 59.9, `간격 유지 (${got.join(',')})`);
  }
  assert.ok(Math.max(...got) <= 500.1, `아래 경계를 안 넘는다 (${Math.max(...got)})`);
  assert.ok(Math.min(...got) >= 19.9, `위 경계를 안 넘는다 (${Math.min(...got)})`);

  // 자리가 정말 모자라면 균등 분배(겹치더라도 같은 간격) — 뭉치지는 않는다
  const many = Array.from({ length: 20 }, (_, k) => ({ i: k, y: 100 }));
  const rm = spreadLabels(many, 40, 0, 100);   // 19*40=760 > 100
  const gm = ys(rm, many);
  assert.deepStrictEqual([...new Set(gm)].length, 20, '모자라도 같은 y에 뭉치지 않는다');
  assert.ok(Math.max(...gm) <= 100.1 && Math.min(...gm) >= -0.1, '경계 안에 있다');

  assert.strictEqual(spreadLabels([], 30, 0, 100).size, 0, '빈 목록');
  assert.strictEqual(spreadLabels([{ i: 'x', y: 5 }], 30, 20, 100).get('x'), 20, '하나면 위 경계로');

  // 화면이 실제로 쓰는지 — 순수 함수만 맞아도 안 쓰면 아무 일도 안 일어난다
  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  assert.ok(/spreadLabels\(items, GAP\[key\], 38, H - 16\)/.test(parts),
    '연결 지도가 층별로 라벨을 떼어놓는다(위 경계는 열 머리글 아래다)');
  assert.ok(/top: yOf\(i\)/.test(parts) && /const yOf = \(i\)/.test(parts),
    '노드와 선이 떼어놓은 y로 그려진다(시뮬 좌표는 안 건드린다 — 끌기가 어긋나지 않게)');
  assert.ok(/const W = cw;/.test(parts), '데스크톱이 카드 폭을 다 쓴다');
  console.log('PASS  라벨 떼어놓기 12가지');
}

// ── 지도가 한 번만 배치되나 · 끌기 손맛 · 빈 그래프 (소스 단정) ───────────────
// 앞의 셋은 **소스로만** 지킨다. 브라우저로 재보려 했지만 측정 창이 이미 두 배치가
// 끝난 뒤에 열려서 그 순간을 못 봤다 — 숫자로 못 재는 것에 숫자를 대지 않는다(§1.3).
// 되돌리기 검사: 각 단정은 그 줄을 되돌리면 깨진다.
{
  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  // ① 폭을 재기 전에는 배치하지 않는다 — 짐작한 폭으로 배치하면 진짜 폭이 들어올 때
  //    처음부터 다시 배치되고, 그 두 번째가 눈에 보이는 "뚜둑"이다(사용자 지적).
  assert.ok(/const \[cw, setCw\] = useState\(0\);/.test(parts),
    '폭은 0에서 시작한다(짐작한 폭으로 배치하지 않는다)');
  assert.ok(/if \(!W\) return \{ nodes: \[\], edges: \[\], bands: \[\] \};/.test(parts),
    '폭을 모르면 노드를 만들지 않는다(자리가 posById에 기억되면 다시 움직인다)');
  assert.ok(/setCw\(w < 200 \? 0 : Math\.round\(w \/ 8\) \* 8\)/.test(parts),
    '숨어 있는 동안은 0이고 폭은 8px 단위다(몇 px 흔들림에 다시 배치되지 않게)');

  const hook = readFileSync(new URL('../src/hooks/useForceGraph.js', import.meta.url), 'utf8');
  // ② 잡은 지점과 노드 중심의 차이를 유지한다 — 예전에는 중심이 손가락으로 순간이동했다
  assert.ok(/gx: rect && p \? \(e\.clientX - rect\.left - offX\) - p\.x : 0/.test(hook),
    '끌기가 잡은 지점을 기억한다(노드 중심이 손가락으로 순간이동하지 않는다)');
  assert.ok(/- d\.gx\)\)/.test(hook) && /- d\.gy\)\)/.test(hook), '움직일 때 그 차이를 그대로 쓴다');
  // ③ 끌 때는 넓은 범위를 본다(시뮬 범위로 끌면 몇십 px에서 벽에 부딪힌다)
  assert.ok(/forceBounds\(nodes\[i\], W, H, true\)/.test(hook), '끌기는 넓은 범위를 본다');
  assert.ok(/zxDrag: ZXD\.m/.test(parts) && /zxDrag: ZXD\.p/.test(parts),
    '층마다 끌기용 넓은 범위가 있다');

  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'fb-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { forceBounds } = await import(pathToFileURL(f).href);
  const n = { zx: [0.76, 0.99], zxDrag: [0.52, 0.99], pl: 56, pr: 66 };
  const sim = forceBounds(n, 400, 300);
  const drg = forceBounds(n, 400, 300, true);
  assert.strictEqual(Math.round(sim.x0), 304, '시뮬은 좁은 범위');
  assert.strictEqual(Math.round(drg.x0), 208, '끌기는 넓은 범위');
  assert.ok(drg.x0 < sim.x0, '끌 때 왼쪽으로 더 갈 수 있다');
  assert.strictEqual(drg.x1, sim.x1, '오른쪽 끝(카드 경계)은 같다 — 층 밖으로는 못 나간다');
  assert.strictEqual(forceBounds({ pl: 10, pr: 10 }, 400, 300, true).x0, 10, 'zx가 없으면 여백만 본다');

  // ④ 빈 그래프 뷰는 표식과 함께 가운데에 선다(사용자 요청 2026-08-31)
  const dep = readFileSync(new URL('../src/components/depgraph.jsx', import.meta.url), 'utf8');
  assert.ok(/function GraphEmptyMark\(\)/.test(dep) && /items-center justify-center/.test(dep),
    '업무가 없을 때 표식 + 가운데 정렬');
  assert.ok(/animationDelay: '\.28s'/.test(dep) && /animationDelay: '\.72s'/.test(dep),
    '표식도 순서대로 그려진다(원 → 선 → 원, §4.2)');
  console.log('PASS  지도 한 번 배치·끌기 손맛·빈 그래프 12가지');
}
// ── 강조가 엉뚱한 노드로 옮겨가지 않나 (연결 지도 · 그래프 뷰) ────────────────
// 사용자 지적 2026-08-31 — "가끔 다른 프로젝트가 갑자기 강조가 된다". 원인이 둘이었다:
//  ① 고른 노드를 **인덱스**로 들고 있었다. 목록이 다시 만들어지면(사람 가입 ·
//     실시간 재조회 · 폭 변경) 같은 번호가 딴 노드를 가리킨다 → id로 바꿨다.
//  ② 터치에서도 브라우저가 onMouseEnter를 흉내내 발생시키는데 onMouseLeave는
//     안 오는 경우가 있어서 강조가 그대로 남았다 → pointerType으로 걸렀다.
// 되돌리기 검사: 어느 한 줄을 되돌리면 그 단정이 깨진다.
{
  for (const f of ['../src/views/dashboardParts.jsx', '../src/components/depgraph.jsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const who = f.includes('depgraph') ? '그래프 뷰' : '연결 지도';
    assert.ok(/onPointerEnter: \(e\) => \{ if \(e\.pointerType === 'mouse'\) setHiId\(id\); \}/.test(src),
      who + ': 호버는 진짜 마우스에만 켠다');
    assert.ok(/onPointerLeave: \(e\) => \{ if \(e\.pointerType === 'mouse'\) setHiId\(null\); \}/.test(src),
      who + ': 호버를 끄는 것도 마우스에만');
    assert.ok(!/onMouseEnter=/.test(src), who + ': onMouseEnter를 안 쓴다(터치에서 흉내로 발생한다)');
    assert.ok(/nodes\.findIndex\(n => n\.id === /.test(src),
      who + ': 고른 노드를 id로 찾는다(인덱스로 들고 있으면 딴 노드를 가리킨다)');
    assert.ok(/setHiId\(null\); \}\}>/.test(src), who + ': 지도 밖으로 마우스가 빠지면 강조를 끈다');
  }
  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  assert.ok(/const picked = pinId === n\.id;/.test(parts), '탭해 둔 사람도 id로 판정한다');
  assert.ok(/setPinId\(picked \? null : n\.id\)/.test(parts), '다시 누르면 풀린다');
  assert.ok(/if \(e\.target === e\.currentTarget\) setPinId\(null\)/.test(parts), '빈 데를 누르면 풀린다');
  const dep = readFileSync(new URL('../src/components/depgraph.jsx', import.meta.url), 'utf8');
  assert.ok(/여기서 순서를 볼 수 있어요/.test(dep) && !/여기에 순서가 이어져요/.test(dep),
    "문구는 '여기서 순서를 볼 수 있어요'다(사용자 결정 2026-08-31)");
  console.log('PASS  강조가 안 튀는지 13가지');
}
// ── 연결 지도의 연도 고르기 (전체 대시보드) ───────────────────────────────────
// 사용자 결정 2026-08-31 — 해가 쌓이면 프로젝트 층이 넘쳐 라벨이 겹치므로 지도도
// 고른 해만 본다. 값은 '프로젝트 진행'·탭 줄과 **같은 하나**(useProjectYear 모듈
// 스토어)여서 한 곳에서 바꾸면 셋 다 따라간다.
// 예전 주석에는 "연결 지도는 해로 거르지 않는다"고 적혀 있었다 — 뒤집힌 결정이다.
// 되돌리기 검사: 아래 각 줄을 되돌리면 그 단정이 깨진다.
{
  const views = readFileSync(new URL('../src/views/views.jsx', import.meta.url), 'utf8');
  assert.ok(/projects=\{projectsList\}/.test(views),
    '지도가 고른 해의 프로젝트만 받는다(activeProjects 전체가 아니다)');
  assert.ok(/year=\{year\} years=\{years\} yearCounts=\{yearCounts\} onPickYear=\{setYear\}/.test(views),
    '지도에 연도 고르기를 넘긴다 — 값은 프로젝트 진행·탭 줄과 같은 하나다');
  assert.ok(/if \(!yearProjectIds\.has\(t\.projectId\)\) continue;/.test(views),
    '팀 목록·팀별 남은 수·선 굵기도 그 해 업무만 센다(딴 해 팀이 빈 줄로 남지 않게)');
  assert.ok(!/연결 지도는 해로 거르지 않는다/.test(views), '뒤집힌 옛 주석이 남아 있지 않다');

  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  assert.ok(/import \{ YearPicker \} from '\.\.\/components\/layout\.jsx';/.test(parts),
    "'프로젝트 진행' 칸과 **같은 부품**을 쓴다(연도 고르기를 두 벌 만들지 않는다)");
  // 2026-08-31: onPick은 스크롤 보정을 거치는 pickYear다(그 아래 블록)
  assert.ok(/onPick=\{pickYear\} compact \/>/.test(parts), '지도 머리줄에 연도 고르기가 있다');
  assert.ok(/\{year\}년에는 프로젝트가 없어요/.test(parts),
    "그 해에 프로젝트가 없으면 그림 대신 한 줄('아직'이라고 하지 않는다)");

  // 몇 개까지 겹치지 않나 — 상한을 바꿀 때 이 계산을 다시 하라.
  // room = (H - 16) - 38, 라벨 높이 27~28px. 균등 분배 간격이 라벨보다 좁아지면 겹친다.
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'cap-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { spreadLabels } = await import(pathToFileURL(f).href);
  const fits = (n, H) => {
    const items = Array.from({ length: n }, (_, k) => ({ i: k, y: 38 + k * 4 }));
    const m = spreadLabels(items, 30, 38, H - 16);
    const ys = items.map(it => m.get(it.i)).sort((a, b) => a - b);
    let min = Infinity;
    for (let k = 1; k < ys.length; k++) min = Math.min(min, ys[k] - ys[k - 1]);
    return min;
  };
  assert.ok(fits(15, 580) >= 30, '모바일 상한(580)에서 15개는 넉넉하다');
  assert.ok(fits(19, 580) >= 27, '19개까지는 라벨이 안 닿는다');
  assert.ok(fits(30, 580) < 27, '30개면 좁아진다 — 겹치기 시작하는 자리(터지지는 않는다)');
  assert.ok(fits(30, 580) > 0, '자리가 모자라도 같은 y에 뭉치지 않는다(균등 분배)');
  console.log('PASS  지도 연도 고르기 11가지');
}
// ── 연도를 바꿔도 지도가 제자리인가 (스크롤 보정) ─────────────────────────────
// 사용자 지적 2026-08-31 — "2027로 바꿨을 때 갑자기 위로 스크롤이 올라간다".
// 원인: 연도를 바꾸면 위쪽 칸('프로젝트 진행')이 크게 줄어 페이지가 짧아진다.
// 지도를 보려고 끝까지 내려온 상태면 스크롤이 잘려서 튄다 — 브라우저의 scroll
// anchoring은 스크롤 끝에서 잘리는 이 경우를 못 잡는다.
// 브라우저 실측(사람 15 · 프로젝트 13→2): 보정 전 지도가 24px 움직이고 스크롤이
// 720px 줄었다(스크롤 높이는 696px만 줄었으니 24px이 여분의 튐이다).
// 보정 뒤 **지도는 0px** 움직이고 스크롤 감소가 높이 감소와 정확히 같다(696=696).
// 되돌아오는 방향(2027→2026)도 0px이다.
// 되돌리기 검사: onPick을 pickYear에서 onPickYear로 되돌리면 다시 24px 튄다.
{
  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  assert.ok(/const pickYear = \(y\) => \{/.test(parts), '연도 고르기를 감싸는 보정이 있다');
  assert.ok(/const before = el\?\.getBoundingClientRect\(\)\.top;/.test(parts),
    '바꾸기 전 지도 카드의 화면 위치를 재둔다');
  assert.ok(/scrollParentOf\(now\)\?\.scrollBy\(\{ top: d, behavior: 'instant' \}\)/.test(parts),
    '다음 프레임에 그만큼 되돌린다(창이 아니라 실제 스크롤러를 잡는다)');
  assert.ok(/onPick=\{pickYear\}/.test(parts) && !/onPick=\{onPickYear\}/.test(parts),
    '지도의 연도 고르기가 보정을 거친다');
  // 그 해에 프로젝트가 없어도 칸이 통째로 접히지 않는다 — 접히면 위 보정으로도 못 막는다
  assert.ok(/className="relative select-none" style=\{\{ height: H \}\}/.test(parts),
    '지도 칸의 높이는 프로젝트가 없어도 그대로다');
  assert.ok(/absolute inset-0 flex items-center justify-center text-\[11px\] text-fg-faint/.test(parts),
    '빈 줄은 그 높이 안 가운데에 선다');

  const utils = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  assert.ok(/export function scrollParentOf\(el\)/.test(utils), '스크롤러를 찾는 헬퍼가 있다');
  assert.ok(/이 앱은 창이 아니라 `main`이 스크롤한다/.test(utils),
    'window.scrollBy로는 아무 일도 안 일어난다는 것을 적어 둔다');
  console.log('PASS  연도 바꿀 때 스크롤 보정 8가지');
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

// ── 공유 링크로 들어온 로그인 (utils.isKakaoInApp · returnToOf · authErrorInUrl) ──
// 카카오톡으로 공유한 링크를 인앱 브라우저에서 열면 로그인 화면이 뜨고, OAuth가 origin으로
// 돌려보내 가려던 자리를 잃었다(2026-09-05). 자리는 sessionStorage에 적어 두고(auth.jsx),
// 인앱 브라우저면 카카오 로그인을 한 번 자동으로 시작한다.
// 되돌리기 검사: returnToOf가 hash까지 붙이면 '#access_token' 케이스가, authErrorInUrl이
// hash를 안 보면 '#error=' 케이스가 깨진다. 배선 단정은 auth.jsx가 signInWithOAuth 앞에서
// 자리를 적는지 · 세션을 넣기 전에 복원하는지 · 로그인 화면이 waiting을 걸러 자동 시작하는지.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'kakao-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { isKakaoInApp, returnToOf, authErrorInUrl } = await import(pathToFileURL(f).href);
  const KAKAO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0';
  const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
  assert.strictEqual(isKakaoInApp(KAKAO_UA), true, '카카오톡 인앱 UA');
  assert.strictEqual(isKakaoInApp(CHROME_UA), false, '일반 크롬은 아니다');
  assert.strictEqual(isKakaoInApp(''), false, '빈 값도 안전하다');
  assert.strictEqual(isKakaoInApp(undefined), false, '값이 없어도 안전하다');

  assert.strictEqual(returnToOf({ pathname: '/', search: '?p=p1&t=t1' }), '/?p=p1&t=t1', '딥링크는 그대로');
  assert.strictEqual(returnToOf({ pathname: '/', search: '' }), null, '홈이면 기억할 것이 없다');
  assert.strictEqual(returnToOf({ pathname: '/', search: '?p=p1', hash: '#access_token=abc' }), '/?p=p1', 'hash는 싣지 않는다 — 토큰 자리다');
  assert.strictEqual(returnToOf(null), null, '값이 없어도 안전하다');

  assert.strictEqual(authErrorInUrl('https://x.app/#error=access_denied&error_description=user+cancelled'), true, 'hash의 오류');
  assert.strictEqual(authErrorInUrl('https://x.app/?error=server_error'), true, '쿼리의 오류');
  assert.strictEqual(authErrorInUrl('https://x.app/#error_code=400'), true, 'error_code만 있어도');
  assert.strictEqual(authErrorInUrl('https://x.app/?p=p1&t=t1'), false, '딥링크는 오류가 아니다');
  assert.strictEqual(authErrorInUrl('https://x.app/#access_token=a&refresh_token=b'), false, '토큰은 오류가 아니다');
  assert.strictEqual(authErrorInUrl(''), false, '빈 값도 안전하다');

  const auth = readFileSync(new URL('../src/services/auth.jsx', import.meta.url), 'utf8');
  assert.ok(/rememberReturnTo\(\);\s*\n\s*return supabase\.auth\.signInWithOAuth\(/.test(auth), '떠나기 전에 자리를 적는다');
  assert.ok(/if \(data\.session\) consumeReturnTo\(\);\s*\n\s*setSession\(data\.session\)/.test(auth), '세션을 넣기 전에 자리를 복원한다(WorkspaceShell이 주소를 한 번만 읽는다)');
  assert.ok(/if \(event === 'SIGNED_IN' && newSession\) consumeReturnTo\(\);/.test(auth), 'SIGNED_IN에서도 복원한다');
  assert.ok(/if \(ss\.get\(AUTO_KAKAO_KEY\)\) return false;\s*\n\s*ss\.set\(AUTO_KAKAO_KEY, '1'\);\s*\n\s*signIn\('kakao'\)/.test(auth), '자동 시작은 표식을 먼저 놓고 한 번만');
  assert.ok(/if \(authErrorInUrl\(window\.location\.href\)\) return false;/.test(auth), '오류로 돌아온 뒤에는 자동으로 다시 시작하지 않는다');
  assert.ok(!/sessionStorage\.removeItem\(AUTO_KAKAO_KEY\)|ss\.del\(AUTO_KAKAO_KEY\)/.test(auth), '표식을 지우는 길이 생겼다 — 로그아웃 → 자동 로그인 고리');
  const login = readFileSync(new URL('../src/components/LoginScreen.jsx', import.meta.url), 'utf8');
  assert.ok(/useEffect\(\(\) => \{ if \(!waiting && autoSignInKakao\(\)\) setAuto\(true\); \}/.test(login), '로그인 화면이 마운트될 때 한 번, 승인 대기 화면은 제외');
  console.log('PASS  공유 링크 로그인 21가지');
}

// ── 두 화면의 '몇 분 전 다녀감'을 한 값으로 (2026-09-05) ─────────────────────
// 대시보드 사람 칸과 멤버 관리 화면이 다른 값을 보여 줬다(사용자 지적). 원인이 둘이다:
//   ① 멤버 화면은 열 때 한 번 받은 스냅샷을 쓰고 실시간을 안 들었다(굳은 값을
//      useMinuteTick이 늙히기까지 해서 열어 둔 만큼 벌어졌다) → 스토어의 members를 겹쳐 쓴다.
//   ② 실시간 payload의 timestamptz는 PostgREST와 글자 모양이 다르다 → isoTime으로 한 모양.
// 되돌리기 검사(실제로 해 봤다): isoTime을 그냥 `raw`를 돌려주게 바꾸면 '두 모양이 같은
// 값이 된다'가 깨지고, seenOnlyChange에서 `updated_at`을 무시 목록에서 빼면 '심장박동은
// 다녀간 시각만 바뀐 것'이 깨지고, membersView에서 online을 안 넘기면 정렬 단정이 깨진다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'seen-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { isoTime, seenOnlyChange, LEAVE_STAMP_MS, dueForHeartbeat, visitOrder } =
    await import(pathToFileURL(f).href);

  // ① 글자 모양 — 실시간(공백·'+00')과 PostgREST('T'·'+00:00')가 같은 값이 된다
  const RT = '2026-09-04 15:27:43.769+00';        // realtime-js는 timestamptz를 손대지 않는다
  const PG = '2026-09-04T15:27:43.769+00:00';     // PostgREST
  assert.strictEqual(isoTime(RT), isoTime(PG), '같은 시각이면 같은 글자가 된다');
  assert.strictEqual(isoTime(RT), '2026-09-04T15:27:43.769Z');
  assert.strictEqual(isoTime('2026-09-04T15:27:43.769456+00:00'), '2026-09-04T15:27:43.769Z',
    '마이크로초는 밀리초로 자른다(그래도 두 경로가 같은 값이다)');
  assert.strictEqual(isoTime(''), '', '값이 없으면 빈 문자열 — agoLabel이 그걸 안다');
  assert.strictEqual(isoTime(null), '');
  assert.strictEqual(isoTime('어제'), '', '못 읽는 값도 빈 문자열(던지지 않는다)');
  // 왜 굳이 맞추나: visitOrder는 ISO 문자열을 그대로 비교한다. 날짜가 같으면 그다음
  // 글자에서 갈리는데 공백이 'T'보다 작아서, 손대지 않고 섞으면 **같은 날 방금 다녀간
  // 사람이 오전에 다녀간 사람보다 아래로 간다**.
  const EARLIER = '2026-09-04T09:00:00.000+00:00';   // 같은 날 오전(PostgREST 모양)
  const raw = visitOrder([{ id: 'a', name: '방금', lastSeenAt: RT },
    { id: 'b', name: '오전', lastSeenAt: EARLIER }]);
  assert.deepStrictEqual(raw.map(m => m.name), ['오전', '방금'], '섞으면 순서가 뒤집힌다(고치는 이유)');
  const fixed = visitOrder([{ id: 'a', name: '방금', lastSeenAt: isoTime(RT) },
    { id: 'b', name: '오전', lastSeenAt: isoTime(EARLIER) }]);
  assert.deepStrictEqual(fixed.map(m => m.name), ['방금', '오전'], 'isoTime을 지나면 제대로 선다');

  // ② 심장박동인가 — 다녀간 시각 말고는 아무것도 안 바뀌었나
  const row = {
    id: 'u1', display_name: '노준석', avatar_url: null, team_id: 't1', birthday: '05-26',
    approved: true, removed_at: null, email: 'a@x.com', role_note: '',
    created_at: '2026-07-24T13:45:33.771182+00:00',
    updated_at: '2026-09-04T15:22:00.000+00:00', last_seen_at: '2026-09-04T15:22:00.000+00:00',
  };
  // 실제 심장박동: last_seen_at과 updated_at(트리거)이 같이 올라간다
  const beat = { ...row, last_seen_at: RT, updated_at: '2026-09-04 15:27:43.808+00' };
  assert.strictEqual(seenOnlyChange(row, beat), true, '심장박동은 다녀간 시각만 바뀐 것');
  assert.strictEqual(seenOnlyChange(row, { ...beat, display_name: '노준석1' }), false,
    '이름이 같이 바뀌면 전체 재조회로 보낸다(§6-21-a)');
  assert.strictEqual(seenOnlyChange(row, { ...beat, avatar_url: 'https://x/y.jpg' }), false, '사진도');
  assert.strictEqual(seenOnlyChange(row, { ...beat, approved: false }), false, '승인도');
  assert.strictEqual(seenOnlyChange(row, { ...beat, removed_at: RT }), false, '환송도');
  assert.strictEqual(seenOnlyChange(row, row), false, '안 바뀌었으면 얹을 것도 없다');
  assert.strictEqual(seenOnlyChange(row, { ...row, last_seen_at: null }), false, '값이 비면 아니다');
  assert.strictEqual(seenOnlyChange(null, beat), false, '직전 행을 모르면 아니다(전체 재조회)');
  // 컬럼이 늘면(모르는 키) 안전한 쪽 — 느린 쪽으로 실패한다
  assert.strictEqual(seenOnlyChange(row, { ...beat, phone: '010' }), false, '모르는 키가 생기면 아니다');
  // 같은 시각이 다른 모양으로 온 다른 칸은 '바뀐 것'이 아니다
  assert.strictEqual(seenOnlyChange(row, { ...beat, created_at: '2026-07-24 13:45:33.771182+00' }), true,
    '같은 시각의 다른 글자 모양은 변경이 아니다');

  // ③ 떠날 때 한 번 더 찍기 — 간격만 바꿔 dueForHeartbeat를 그대로 쓴다
  const NOW = 1_000_000_000;
  assert.strictEqual(LEAVE_STAMP_MS, 60 * 1000, '떠날 때의 하한은 1분');
  assert.strictEqual(dueForHeartbeat(NOW - 30e3, NOW, LEAVE_STAMP_MS), false, '30초 전에 찍었으면 안 찍는다');
  assert.strictEqual(dueForHeartbeat(NOW - 90e3, NOW, LEAVE_STAMP_MS), true, '1분을 넘겼으면 찍는다');
  console.log('PASS  다녀간 시각 한 값으로 22가지');
}

// ── 공유 카드 메타 (api/share.js) ───────────────────────────────────────────
// 크롤러가 읽는 OG 메타이자 **사람이 눌렀을 때 가는 주소**를 만드는 자리다. 조회가
// 실패하면 제목이 기본값으로 떨어지고 appUrl이 '/'로 남아 딥링크가 통째로 사라지는데,
// 크롤러 말고는 아무도 안 보는 화면이라 증상이 밖으로 안 난다. 실제로 없는 컬럼
// (projects.description — 0009에서 지웠다)을 고르고 있어서 42703으로 늘 실패했다.
// 되돌리기 검사: select('name')을 select('name, description')으로 되돌리거나
// STATUS_KO에서 hold를 빼면 아래가 깨진다.
{
  const src = readFileSync(new URL('../api/share.js', import.meta.url), 'utf8');
  assert.ok(/from\('projects'\)\.select\('name'\)/.test(src),
    "projects에 없는 컬럼을 고르고 있다(description은 0009에서 지웠다)");
  assert.ok(!/select\('name, description'\)/.test(src), 'description이 다시 들어왔다');
  // 조회 오류를 버리면 같은 고장이 또 조용히 지나간다
  assert.ok((src.match(/console\.error\('\[share\]/g) || []).length >= 3,
    '조회 실패를 로그로 남기지 않는 갈래가 있다');

  // 상태 라벨은 앱과 같은 글자여야 한다 — DB는 todo/doing/hold/done 네 가지다(0006).
  const { CONFIG } = await import(new URL('../src/config.js', import.meta.url).href);
  const ko = Object.fromEntries(
    [...src.matchAll(/(todo|doing|hold|done): '([^']+)'/g)].map(m => [m[1], m[2]]));
  const want = Object.fromEntries(Object.entries(CONFIG.STATUS_DB).map(([k, v]) => [v, k]));
  assert.deepStrictEqual(ko, want, '공유 카드의 상태 글자가 config.js의 STATUSES와 다르다');
  console.log('PASS  공유 카드 메타 5가지');
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
  const d = mkdtempSync(join(tmpdir(), 'store-'));
  const f = join(d, 'store.mjs');
  writeFileSync(f, src);
  // 게스트 초기값은 localStorage를 읽는다 — 노드에는 없어서 스토어가 console.error를
  // 한 줄 뱉는다(동작은 멀쩡하다). 그 소음만 막고 바로 걷는다.
  globalThis.localStorage = { getItem: () => null };
  const { store } = await import(pathToFileURL(f).href);
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

// ── 그 값이 화면까지 오는 배선 (스토어 · 실시간 라우팅 · 두 화면) ────────────
// 순수 함수만 맞아도 배선이 빠지면 다시 '새로고침해야 보이는' 자리로 돌아간다.
// 되돌리기 검사: 아래 단정마다 해당 줄을 지우면 그 단정이 깨진다(하나씩 확인했다).
{
  const store = readFileSync(new URL('../src/store/workspaceStore.js', import.meta.url), 'utf8');
  assert.ok(/case 'SYNC_MEMBER_SEEN'/.test(store), '스토어가 사람 한 칸만 고치는 액션을 안다');
  assert.ok(/action\.type === 'SYNC_MEMBER_SEEN'/.test(store),
    '되돌리기 기록에 남기지 않는다(내 조작이 아니다)');
  assert.ok(/if \(i < 0 \|\| list\[i\]\.lastSeenAt === lastSeenAt\) return;/.test(store),
    '모르는 사람이거나 값이 같으면 아무것도 안 한다(헛렌더 금지)');

  const sync = readFileSync(new URL('../src/services/cloudSync.js', import.meta.url), 'utf8');
  assert.ok(/profileRows = new Map\(profiles\.map\(p => \[p\.id, p\]\)\)/.test(sync),
    '직전 profiles 행을 들고 있다(payload.old에는 id밖에 없다)');
  assert.ok(/table === 'profiles' && payload\.eventType === 'UPDATE' && onMemberSeen/.test(sync)
    && /seenOnlyChange\(prev, row\)/.test(sync),
    '다녀간 시각만 바뀐 UPDATE는 전체 재조회로 안 간다');
  assert.ok(/lastSeenAt: isoTime\(/.test(sync), '스토어에 담기 전에 글자 모양을 맞춘다');

  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(/onMemberSeen: \(patch\) => store\.dispatch\(\{ type: 'SYNC_MEMBER_SEEN'/.test(app),
    '실시간 라우팅이 스토어까지 이어져 있다');
  assert.ok(/dueForHeartbeat\(lastSeenStampAt, now, LEAVE_STAMP_MS\)/.test(sync),
    '떠날 때의 판정은 같은 함수에 간격만 바꿔 넘긴다(자리는 cloudSync 하나)');
  assert.ok(/cloud\.stampLeaveBeacon\(\)/.test(sync),
    '떠나는 한 번만 다른 길로 나간다 — 평범한 fetch는 탭이 닫히며 취소된다');
  assert.ok(/document\.hidden \? stampLeave\(\) : beat\(\)/.test(app), '탭이 숨겨지는 순간 한 번 찍는다');
  assert.ok(/addEventListener\('pagehide', stampLeave\)/.test(app)
    && /removeEventListener\('pagehide', stampLeave\)/.test(app), 'pagehide도 듣고 뗀다');

  const mv = readFileSync(new URL('../src/views/membersView.jsx', import.meta.url), 'utf8');
  assert.ok(/useStore\(selectMembers\)/.test(mv), '멤버 화면이 스토어의 members를 같이 본다');
  assert.ok(/lastSeenAt: seenAt\(r\)/.test(mv) && /const at = seenAt\(row\)/.test(mv),
    '정렬과 라벨이 같은 값을 쓴다');
  assert.ok(/\)\s*,\s*\n\s*online,\s*\n\s*\);/.test(mv) || /visitOrder\([\s\S]{0,400}?online,/.test(mv),
    '접속 중인 사람이 맨 위 — MembersModal과 같은 순서');
  assert.ok(!/agoLabel\(row\.last_seen_at\)/.test(mv), '스냅샷 값을 그대로 그리는 자리가 남아 있다');
  console.log('PASS  다녀간 시각 배선 14가지');
}

// ── v2 실시간 라우팅 (services/liveV2.js · 0049) ─────────────────────────────
// 0049 전까지 v2 표는 발행에도 구독에도 없어서, 남이 주보를 발행해도 나눔을 올려도
// 그 화면에 머무는 동안은 영영 몰랐다. liveV2는 행 단위 리듀서를 만들지 않고
// "표 → 캐시 접두를 비우고 → 그 화면이 떠 있으면 재조회"만 한다.
// 되돌리기 검사(하나씩 실제로 돌려 확인했다): TABLE_CACHE에서 attendance의
// 'groups:mine'을 빼면 첫 묶음이, arm() 대신 그 자리에서 notify하면 디바운스 단정이,
// createGate.signal의 else 가지를 지우면 enabled 단정이, subscribe 콜백의 pushAll을
// 지우면 재접속 단정이, 아래 뷰의 훅 호출 줄을 지우면 배선 단정이 깨진다.
{
  const raw = readFileSync(new URL('../src/services/liveV2.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'live2-'));
  const f = join(dir, 'liveV2.mjs');
  // react·supabase·cache import만 걷어내면 순수 부분을 노드에서 그대로 부를 수 있다
  // (supabaseClient는 import.meta.env를 읽어서 노드에서 던진다)
  writeFileSync(f, raw.replace(/^import .*from '(react|\.\/supabaseClient\.js|\.\/cache\.js)';\s*$/gm, ''));
  const { prefixesOf, kindsOf, V2_TABLES, ALL_KINDS, createSignalQueue, createGate } =
    await import(pathToFileURL(f).href);

  // ① 표 → 캐시 접두 · kind는 접두의 첫 마디
  assert.deepStrictEqual(prefixesOf('services'), ['worship', 'home']);
  assert.deepStrictEqual(kindsOf('services'), ['worship', 'home']);
  assert.deepStrictEqual(kindsOf('qt_entries'), ['word', 'home'],
    '나눔은 말씀 화면과 홈 카드를 같이 흔든다');
  assert.ok(V2_TABLES.every(t => !prefixesOf(t).some(p => p.startsWith('home:'))),
    '홈은 접두를 쪼개지 않는다 — 카드 열쇠 이름이 바뀌어도 낡지 않게');
  assert.ok(prefixesOf('attendance').includes('groups:mine'),
    '출석은 모임 화면의 내 순 소식(참석 수)도 낡게 한다');
  assert.deepStrictEqual(kindsOf('people'), ['groups', 'roster', 'worship', 'home'],
    '명단이 바뀌면 출석 명단도 바뀐다 — 주보 상세까지 같이 다시 읽는다');
  assert.deepStrictEqual(prefixesOf('cards'), [], 'v1 표는 이 채널이 손대지 않는다');
  assert.strictEqual(V2_TABLES.length, 9, '0049가 발행에 넣은 표 아홉 개');
  assert.deepStrictEqual([...ALL_KINDS].sort(), ['groups', 'home', 'roster', 'word', 'worship']);

  // ② 디바운스 — 연속 이벤트가 한 번의 알림으로 합쳐진다(주보 저장 한 번이 UPDATE 여러 건)
  {
    const dropped = [];
    const calls = [];
    const q = createSignalQueue({ drop: p => dropped.push(p), notify: ks => calls.push(ks), delay: 5 });
    assert.strictEqual(q.push('cards'), false, '모르는 표는 아무 일도 하지 않는다');
    assert.strictEqual(q.push('services'), true);
    q.push('attendance'); q.push('qt_entries');
    assert.deepStrictEqual(calls, [], '디바운스가 끝나기 전에는 알리지 않는다');
    assert.ok(dropped.includes('worship') && dropped.includes('word:qt'),
      '캐시는 화면이 떠 있든 아니든 바로 비운다(다음 진입의 첫 프레임이 옛 값이면 안 된다)');
    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(calls.length, 1, '세 이벤트가 재조회 한 번으로 합쳐진다');
    assert.deepStrictEqual([...calls[0]].sort(), ['groups', 'home', 'word', 'worship']);
    // 재접속 — 끊겨 있던 동안의 이벤트는 오지 않았으니 전부 한 번 다시 읽는다
    q.pushAll();
    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual([...calls[1]].sort(), [...ALL_KINDS].sort());
  }

  // ③ enabled가 false면 건너뛰고, 다시 켜질 때 한 번만 흘린다(편집 중인 주보 보호)
  {
    let n = 0;
    const g = createGate(() => { n += 1; });
    g.signal(true);
    assert.strictEqual(n, 1, '켜져 있으면 바로 재조회');
    g.signal(false); g.signal(false);
    assert.strictEqual(n, 1, '편집 중에는 재조회로 덮지 않는다');
    assert.strictEqual(g.missed(), true, '대신 기억해 둔다');
    g.enable(true);
    assert.strictEqual(n, 2, '나오면 한 번만 흐른다(두 번 왔어도 한 번)');
    g.enable(true);
    assert.strictEqual(n, 2, '기억이 없으면 아무 일도 없다');
  }

  // ④ 채널 규칙 — 게스트 no-op · 로그인 뒤에만 · 같은 topic 걷어내기(§6-3)
  assert.ok(/if \(!c \|\| channel \|\| opening\) return;/.test(raw), '게스트 모드에서는 채널을 열지 않는다');
  assert.ok(/if \(!data\?\.session/.test(raw), '로그인 전에는 열지 않는다(RLS가 아무것도 안 준다)');
  assert.ok(/getChannels\(\)[\s\S]{0,160}removeChannel/.test(raw),
    '같은 topic 채널을 먼저 걷어낸다 — 이미 subscribe된 채널에 .on을 붙이면 예외다');
  assert.ok(/if \(wasDown\) \{ wasDown = false; queue\.pushAll\(\); \}/.test(raw),
    '다시 붙으면 끊겨 있던 동안을 메운다');

  // ⑤ 뷰 배선 — 빠지면 다시 '나갔다 들어와야 보이는' 자리로 돌아간다
  const view = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const worship = view('../src/views/worshipView.jsx');
  assert.ok(/useLiveRefresh\('worship', invalidate, screen === 'list'\)/.test(worship),
    '예배 목록은 실시간으로 갱신하되 상세·출석 화면에서는 건너뛴다');
  assert.ok(/useLiveRefresh\('word', refreshQt\)/.test(view('../src/views/wordView.jsx')),
    '그날 나눔 피드가 실시간이다');
  // **그 화면의 useCached를 하나도 빠뜨리지 않는지**를 소스에서 센다 — 카드를 하나 더
  // 붙이고 여기에 안 적으면 그 칸만 낡은 채 남는다(이름을 못 박으면 검사가 먼저 낡는다).
  const allRefreshed = (src, kind) => {
    const line = (src.split('\n').find(l => l.includes(`useLiveRefresh('${kind}',`)) || '');
    const names = [...src.matchAll(/const (\w+) = useCached\(/g)].map(m => m[1]);
    return names.length > 1 && names.every(n => line.includes(`${n}.refresh()`));
  };
  assert.ok(allRefreshed(view('../src/views/groupsView.jsx'), 'groups'),
    '모임 화면의 useCached 묶음이 하나도 빠짐없이 다시 읽는다');
  assert.ok(allRefreshed(view('../src/views/homeView.jsx'), 'home'),
    '홈 카드가 하나도 빠짐없이 다시 읽는다');
  const members = view('../src/views/membersView.jsx');
  assert.ok(/const rosterTick = useLiveTick\('roster'\)/.test(members)
    && /\[isAdmin, tab, year, rosterTick\]/.test(members),
    '명단은 effect가 읽으므로 틱을 deps에 얹는다');
  console.log('PASS  v2 실시간 라우팅 31가지');
}

// ── 화면 데이터 캐시의 계약 (services/cache.js · 2026-09-06) ─────────────────
// 이 파일에는 검사가 하나도 없었다. 캐시는 "빨리 보이게" 하는 곁가지 같지만, 열쇠
// 네임스페이스가 어긋나면 **남의 계정 값이 보이고**, 접두를 짧게 주면 **엉뚱한 갈래가
// 같이 지워지고**, 한도에 걸리면 **모든 쓰기가 조용히 실패해 캐시가 옛 값에 굳는다.**
// 셋 다 화면에서는 "가끔 이상하다"로만 보여서 눈으로는 못 잡는다.
//
// 노드에는 localStorage도 supabase도 없다 — import 두 줄을 걷어 내고(순수 계약만 본다)
// persist()를 켠 다음, 브라우저 저장소를 흉내 낸 스텁을 전역에 놓는다.
// 되돌리기 검사(실제로 해 봤다): setCacheScope의 purgeKeys 줄을 지우면 '옛 scope 키를
// 치운다'가 깨지고, writeCache의 재시도를 지우면 '한도에 걸려도 다음 쓰기가 산다'가 깨진다.
{
  const raw = readFileSync(new URL('../src/services/cache.js', import.meta.url), 'utf8');
  const src = raw
    .replace(/^import[^\n]*\n/gm, '')                                 // react · supabaseClient
    .replace('const persist = () => !!supabase;', 'const persist = () => true;');
  const dir = mkdtempSync(join(tmpdir(), 'cache-'));
  const f = join(dir, 'cache.mjs');
  writeFileSync(f, src);

  // localStorage 스텁 — quota를 켜면 setItem이 브라우저처럼 던진다
  const store = new Map();
  let quota = Infinity;
  globalThis.localStorage = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (store.size >= quota && !store.has(k)) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      store.set(k, String(v));
    },
    removeItem: (k) => { store.delete(k); },
  };

  const { setCacheScope, readCache, writeCache, dropCache } = await import(pathToFileURL(f).href);
  const keys = () => [...store.keys()].sort();

  // ① 열쇠는 사용자별 네임스페이스 안에 있다
  setCacheScope('u1');
  writeCache('worship:list:2026', { a: 1 });
  assert.deepStrictEqual(keys(), ['church_cache_v1:u1:worship:list:2026'], 'scope가 열쇠에 박힌다');
  assert.deepStrictEqual(readCache('worship:list:2026'), { a: 1 }, '넣은 값이 그대로 나온다');

  // ② scope를 바꾸면 남의 값은 보이지도 남지도 않는다
  writeCache('groups:all:2026', { b: 2 });
  setCacheScope('u2');
  assert.strictEqual(readCache('worship:list:2026'), undefined, '계정을 바꾸면 앞사람 값이 안 보인다');
  assert.deepStrictEqual(keys(), [], '옛 scope 키는 저장소에서도 치운다(무한 증가 방지)');
  writeCache('worship:list:2026', { c: 3 });
  setCacheScope('u2');   // 같은 scope면 아무 일도 하지 않는다
  assert.deepStrictEqual(readCache('worship:list:2026'), { c: 3 }, '같은 scope는 비우지 않는다');

  // ③ dropCache는 접두다 — 짧게 주면 이웃까지 간다(그래서 갈래마다 첫 도막이 다르다)
  writeCache('worship:svc:s1', { d: 4 });
  writeCache('word:qt:2026-09-06', { e: 5 });
  writeCache('bible:state', { f: 6 });
  dropCache('worship:list');
  assert.strictEqual(readCache('worship:list:2026'), undefined, '접두로 지운다');
  assert.deepStrictEqual(readCache('worship:svc:s1'), { d: 4 }, '옆 갈래(상세)는 남는다');
  dropCache('word');
  assert.strictEqual(readCache('word:qt:2026-09-06'), undefined, "dropCache('word')는 묵상을 지우고");
  assert.deepStrictEqual(readCache('bible:state'), { f: 6 }, "성경 상태는 'bible:'이라 살아남는다");

  // ④ 한도에 걸려도 다음 쓰기가 산다 — 이 scope를 비우고 한 번만 다시 넣는다
  dropCache('');
  quota = 2;
  writeCache('a', 1); writeCache('b', 2);
  assert.strictEqual(store.size, 2, '한도까지는 그대로 쌓인다');
  writeCache('c', 3);
  assert.ok(store.has('church_cache_v1:u2:c'), '한도를 넘어도 방금 쓴 값은 저장소까지 들어간다');
  assert.strictEqual(store.size, 1, '한도에 걸리면 이 scope를 비우고 다시 넣는다');
  quota = Infinity;

  // ⑤ 담을 수 없는 값·깨진 값은 '값'이 아니다
  dropCache('');
  const circular = {}; circular.self = circular;
  writeCache('bad', circular);                       // JSON.stringify가 던진다 — 삼킨다
  assert.deepStrictEqual(keys(), [], '직렬화 못 하는 값은 저장소에 안 들어간다');
  store.set('church_cache_v1:u2:broken', '{oops');
  assert.strictEqual(readCache('broken'), undefined, '깨진 JSON은 undefined다(던지지 않는다)');

  // ⑥ 실패한 조회 결과는 캐시에 들어가지 않는다 — 들어가면 다음 진입의 첫 화면이 빈 값이다
  assert.ok(/const v = await loader\(\);[\s\S]{0,120}writeCache\(k, v\);/.test(raw),
    '성공한 값만 캐시에 넣는다');
  assert.ok(/catch \(e\) \{\s*\n\s*if \(my !== token\.current\) return;\s*\n\s*setState\(s => \(\{ \.\.\.s, loading: false, error: e \}\)\);/.test(raw),
    '실패는 error만 담고 캐시에는 손대지 않는다');

  delete globalThis.localStorage;
  console.log('PASS  화면 데이터 캐시 계약 17가지');
}

// ── 새로 읽어 온 묵상을 에디터에 넣어도 되나 (word.shouldAdoptBody · §6-9-n) ──
// 캐시가 낡아 있으면 옛 글이 에디터에 남고, 그 상태로 저장하면 **서버의 새 글을 덮는다**
// (2026-09-06 지적). 그렇다고 도착할 때마다 넣으면 쓰던 글을 뺏는다.
// 되돌리기 검사: `return body === lastSynced`를 `return false`로 바꾸면 '안 고쳤으면
// 신선한 값으로 간다'가 깨지고, `true`로 바꾸면 '고치던 글은 지킨다'가 깨진다.
{
  const src = readFileSync(new URL('../src/services/word.js', import.meta.url), 'utf8')
    .replace(/import \{ supabase \} from '\.\/supabaseClient\.js';/, 'const supabase = null;');
  const dir = mkdtempSync(join(tmpdir(), 'wordad-'));
  const f = join(dir, 'word.mjs');
  writeFileSync(f, src);
  const { shouldAdoptBody } = await import(pathToFileURL(f).href);

  assert.strictEqual(shouldAdoptBody({ dateChanged: true, body: '쓰던 글', lastSynced: '', next: '' }), true,
    '날짜가 바뀌면 언제나 갈아 끼운다(다른 날의 글이다)');
  assert.strictEqual(shouldAdoptBody({ body: '옛 글', lastSynced: '옛 글', next: '새 글' }), true,
    '캐시로 넣어 준 글 그대로면 신선한 값으로 간다(stale이 새 글을 덮던 자리)');
  assert.strictEqual(shouldAdoptBody({ body: '고치던 글', lastSynced: '옛 글', next: '새 글' }), false,
    '한 글자라도 고쳤으면 그대로 둔다');
  assert.strictEqual(shouldAdoptBody({ body: '같은 글', lastSynced: '아무거나', next: '같은 글' }), false,
    '넣어 봐야 같은 글이면 건드리지 않는다(헛렌더 금지)');
  assert.strictEqual(shouldAdoptBody({ body: '', lastSynced: '', next: '남이 쓴 새 글' }), true,
    '빈 칸이면 도착한 글로 채운다');
  assert.strictEqual(shouldAdoptBody(), false, '아무것도 안 주면 아무 일도 안 한다');

  // 화면이 실제로 그 판정을 쓰고 있나(순수 함수만 맞아도 배선이 빠지면 그대로다)
  const view = readFileSync(new URL('../src/views/wordView.jsx', import.meta.url), 'utf8');
  assert.ok(/shouldAdoptBody\(\{ dateChanged, body: bodyRef\.current, lastSynced: syncedBody\.current, next: next\.body \}\)/.test(view),
    'wordView가 그 판정으로 body를 갈아 끼운다');
  assert.ok(/syncedBody\.current = body;/.test(view), '저장하면 기준도 그 글로 옮긴다');
  // 재조회 실패가 캐시 화면을 '묵상 없음'으로 만들지 않는다
  assert.ok(/if \(!qt \|\| qt\.date !== date\) \{\s*\n\s*setEntry\(\{ date, body: '', shared: false, exists: false \}\)/.test(view),
    '캐시가 있으면 빈 칸을 세우지 않고 토스트만 한다');
  assert.ok(/if \(qtError && !ref\) \{ setDay\(/.test(view),
    '본문도 같다 — 캐시된 구절이 있으면 그것을 그린다');

  // 형광펜: 로딩 중에 칠한 것을 도착값이 덮지 않는다(ref 플래그)
  const bible = readFileSync(new URL('../src/components/wordBible.jsx', import.meta.url), 'utf8');
  assert.strictEqual((bible.match(/edited\.current = true;/g) || []).length, 2,
    'update 둘(useBibleState · BibleTab)이 모두 표식을 놓는다');
  assert.ok(/if \(!alive \|\| edited\.current\) return;/.test(bible),
    'useBibleState: 내가 고쳤으면 도착값을 버린다');
  assert.ok(/if \(!edited\.current\) \{ setState\(saved\); writeCache\(STATE_KEY, saved\); \}/.test(bible),
    'BibleTab: 첫 진입 이펙트도 같은 판단');
  assert.ok(/const STATE_KEY = 'bible:state';/.test(bible),
    "성경 상태 열쇠는 'bible:'로 시작한다 — dropCache('word')에 쓸려가지 않게");
  console.log('PASS  묵상 본문 동기화 · 성경 상태 14가지');
}
