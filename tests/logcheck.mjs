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

// ── 멘션 꼬리 (utils.splitMention) — 뽑는 쪽과 그리는 쪽이 같은 규칙 ──
// "(@박지호)"의 닫는 괄호가 칩 안에 들어갔다(2026-09-08). RichText가 `@\S+`를 통째로
// 칩에 넣었기 때문이다 — 이제 splitMention 한 벌을 쓴다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const d = mkdtempSync(join(tmpdir(), 'mention-'));
  const f = join(d, 'utils.mjs');
  writeFileSync(f, src);
  const { splitMention, extractMentions } = await import(pathToFileURL(f).href);
  assert.deepStrictEqual(splitMention('@박지호)'), { name: '박지호', tail: ')' });
  assert.deepStrictEqual(splitMention('@민수,'), { name: '민수', tail: ',' });
  assert.deepStrictEqual(splitMention('@시온'), { name: '시온', tail: '' });
  assert.deepStrictEqual(splitMention('@노준석)."'), { name: '노준석', tail: ')."' });
  assert.deepStrictEqual(splitMention('@)'), { name: '', tail: ')' }, '이름이 비면 칩을 만들지 않는다');
  assert.deepStrictEqual(extractMentions('웰컴팀 ( @박지호) · @시온.'), ['박지호', '시온'], '뽑는 쪽도 같은 꼬리 규칙');
  // 서식 안의 멘션(2026-09-25 · 라이브 카드 3장) — 굵게·형광펜·밑줄·취소선 기호도 꼬리다.
  // 되돌리기 검사: MENTION_TAIL에서 `*=_~` 를 빼면 이 줄이 깨진다.
  assert.deepStrictEqual(extractMentions('**@양민혁** 확인 · 담당(@박지호)** · ==@시온== · __@조해리__ · ~~@김윤주~~ · @노준석_서브'),
    ['양민혁', '박지호', '시온', '조해리', '김윤주', '노준석_서브'], '서식 기호는 이름이 아니다(가운데 _는 이름이다)');
  const rich = readFileSync(new URL('../src/components/RichText.jsx', import.meta.url), 'utf8');
  assert.ok(rich.includes('splitMention(p)'), 'RichText가 splitMention으로 칩과 꼬리를 가른다');
  assert.ok(!/\/\^@\\S\+\$\//.test(rich), 'RichText가 `@\\S+` 통째로 칩을 만들지 않는다');
  console.log('PASS  멘션 꼬리 8가지');
}

// ── 기호 보조 글꼴 (◡̈ — src/assets/fonts/symbols.css) ──
// SUIT에 없는 결합 부호·기하 도형은 한 글꼴에서 나와야 제자리에 붙는다(2026-09-08).
{
  const css = readFileSync(new URL('../src/assets/fonts/symbols.css', import.meta.url), 'utf8');
  const range = (css.match(/unicode-range:\s*([^;]+);/) || [])[1] || '';
  const covers = (cp) => range.split(',').some(part => {
    const m = /U\+([0-9A-F]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m) return false;
    const a = parseInt(m[1], 16), b = m[2] ? parseInt(m[2], 16) : a;
    return cp >= a && cp <= b;
  });
  assert.ok(covers(0x25E1) && covers(0x0308), '◡(U+25E1)와 결합 점(U+0308)이 보조 글꼴 범위에 있다');
  assert.ok(!covers(0xAC00) && !covers(0x41), '한글·라틴은 보조 글꼴이 맡지 않는다(SUIT 그대로)');
  const index = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const stack = (index.match(/--font-sans:\s*([^;]+);/) || [])[1] || '';
  assert.ok(stack.indexOf("'SUIT Variable'") >= 0 && stack.indexOf("'Daboot Symbols'") > stack.indexOf("'SUIT Variable'"),
    "보조 글꼴은 SUIT 바로 뒤에 선다");
  assert.ok(index.includes("@import './assets/fonts/symbols.css'"), 'index.css가 symbols.css를 import한다');
  const { statSync } = await import('node:fs');
  assert.ok(statSync(new URL('../src/assets/fonts/symbols.woff2', import.meta.url)).size > 1000, 'symbols.woff2가 있다');
  console.log('PASS  기호 보조 글꼴 5가지');
}

// ── 하위 업무 진척 (utils.subtaskProgress) ──
// 보드 카드와 업무 창이 같은 함수를 쓴다. 0/0에서 NaN이 나오면 카드가 통째로 깨진다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir2 = mkdtempSync(join(tmpdir(), 'sub-'));
  const f2 = join(dir2, 'utils.mjs');
  writeFileSync(f2, src);
  const { subtaskProgress, subtasksForDb } = await import(pathToFileURL(f2).href);
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
  assert.strictEqual(errorReason({ code: '23502', message: 'null value in column "zzz" of relation "cards"' }), '아직 채우지 않은 부분이 있어요');
  assert.strictEqual(errorReason({ code: '23503', message: 'violates foreign key constraint "files_card_id_fkey"' }), '연결된 항목이 이미 지워졌어요\n새로고침해주세요');
  assert.strictEqual(errorReason({ code: '42501' }), '권한이 있어야 할 수 있는 일이에요');
  assert.strictEqual(errorReason({ message: 'new row violates row-level security policy' }), '권한이 있어야 할 수 있는 일이에요');
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
// 언제나 비어 있어 화면으로는 못 보므로(HANDOFF §1-4) 여기서 지킨다.
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
  // 멤버 화면(가입자 목록·청년 명단)도 같은 규칙이다 — 검색으로 목록이 갈릴 때
  // 순번을 계속 주면 새로 걸린 줄만 뒤늦게 나타난다(2026-09-07).
  const mem = readFileSync(new URL('../src/views/membersView.jsx', import.meta.url), 'utf8');
  // rowDelay는 roster.jsx 한 벌을 가져다 쓴다(2026-09-24)
  assert.ok(/const stagger = useEnterStagger\(\);/.test(mem)
    && /import \{[^}]*\browDelay\b[^}]*\} from '\.\.\/components\/roster\.jsx'/.test(mem)
    && /delay=\{rowDelay\(i, stagger\)\}/.test(mem)
    && /className="dc-row flex items-center gap-2\.5 py-2\.5"/.test(mem),
    '가입자 목록 줄이 첫 렌더에서만 순번 지연을 준다');
  const ros = readFileSync(new URL('../src/components/roster.jsx', import.meta.url), 'utf8');
  assert.ok(/const stagger = useEnterStagger\(\);/.test(ros)
    && /export const rowDelay = \(i, stagger\) => \(stagger \? Math\.min\(i, 12\) \* 30 : 0\);/.test(ros)
    && /delay=\{rowDelay\(i, stagger\)\}/.test(ros)
    && /className="dc-row py-2\.5"/.test(ros),
    '청년 명단 줄도 첫 렌더에서만 순번 지연을 준다');
  console.log('PASS  순차 등장 배선 5가지');
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
// 끝난 뒤에 열려서 그 순간을 못 봤다 — 숫자로 못 재는 것에 숫자를 대지 않는다(HANDOFF §2 '성능은 측정하지 않았다').
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
  // 호버 핸들러는 useForceGraph.js의 공장 한 벌이다(2026-09-24 — 두 파일에 같은 것이 있었다)
  const forceHook = readFileSync(new URL('../src/hooks/useForceGraph.js', import.meta.url), 'utf8');
  assert.ok(/onPointerEnter: \(e\) => \{ if \(e\.pointerType === 'mouse'\) setHiId\(id\); \}/.test(forceHook),
    '호버는 진짜 마우스에만 켠다');
  assert.ok(/onPointerLeave: \(e\) => \{ if \(e\.pointerType === 'mouse'\) setHiId\(null\); \}/.test(forceHook),
    '호버를 끄는 것도 마우스에만');
  for (const f of ['../src/views/dashboardParts.jsx', '../src/components/depgraph.jsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const who = f.includes('depgraph') ? '그래프 뷰' : '연결 지도';
    assert.ok(/const hoverOn = hoverProps\(setHiId\);/.test(src) && /\{\.\.\.hoverOn\(n\.id\)\}/.test(src),
      who + ': 노드 호버는 공용 공장(hoverProps)을 쓴다');
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
  assert.ok(/\{year\}년에 프로젝트는 아직 없어요/.test(parts),
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
  assert.ok(/absolute inset-0 flex items-center justify-center text-\[11px\] text-fg-muted/.test(parts),
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

// ── 로그인 화면 로고가 깨져 보이던 것 (2026-09-06 · 사용자 신고) ─────────────
// 카카오톡으로 공유 링크(/s/p/<id>)를 열면 로그인 화면에서 로고가 **깨진 이미지
// 아이콘**으로 보였다. 리소스는 전부 200이다(경로 문제가 아니다) — 순서 문제다:
//   ① 로고는 번들(1MB) 안의 import라, 번들이 다 와서 React가 그릴 때 **그제서야**
//      65KB PNG 요청이 나간다. 인앱 브라우저는 그 직후 카카오 로그인으로 떠나므로
//      (auth.jsx autoSignInKakao) 요청이 취소되고 깨진 아이콘이 남는다.
//   ② Vercel이 /assets/… 를 'max-age=0, must-revalidate'로 내보내고 있었다 —
//      인앱 웹뷰는 열 때마다 빈 캐시라 매번 그 왕복을 처음부터 한다.
//   ③ img에 width/height가 없어서, 안 들어온 동안 `w-auto`가 칸을 가로 전체로 벌린다
//      (깨진 아이콘이 왼쪽 끝, alt 글자만 가운데 — 실제로 그 모양이었다).
// 되돌리기 검사(실제로 해 봤다): index.html의 preload 줄을 지우거나 href를 손으로
// 적은 /assets/logo-light.webp로 바꾸면, vercel.json의 /assets/ 규칙을 빼면,
// LoginScreen의 width/height를 지우면 아래가 각각 깨진다.
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const preload = /<link rel="preload"[^>]*>/.exec(html)?.[0] || '';
  assert.ok(/as="image"/.test(preload), '로고 preload가 없다 — 번들이 다 온 뒤에야 요청이 나간다');
  // 2026-09-24: 로고는 표시 크기의 3배(328×240) WebP다 — preload도 같은 파일·같은 형식을 가리킨다
  assert.ok(/href="\/src\/assets\/logo-light\.webp"/.test(preload) && /type="image\/webp"/.test(preload),
    'preload는 **소스 경로**를 가리켜야 vite가 해시 붙은 /assets/… 로 바꿔 준다(손으로 적으면 다음 빌드에 죽은 preload가 된다)');

  const login = readFileSync(new URL('../src/components/LoginScreen.jsx', import.meta.url), 'utf8');
  const img = /<img src=\{logoLight\}[^]*?\/>/.exec(login)?.[0] || '';
  assert.ok(/width="328" height="240"/.test(img),
    '로고 img에 원본 크기가 없다 — 안 들어온 동안 칸이 가로 전체로 벌어진다');

  const vc = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const assets = (vc.headers || []).find(h => h.source === '/assets/(.*)');
  assert.ok(assets, 'vercel.json에 /assets/ 캐시 규칙이 없다 — Vercel 기본값이 max-age=0, must-revalidate다');
  assert.ok(/immutable/.test(assets.headers.find(h => h.key === 'Cache-Control')?.value || ''),
    '해시 붙은 산출물이니 immutable이어야 한다(이름이 바뀌면 다른 파일이다)');

  // 공유 페이지는 **/s/p/<id> 에서** 열린다. 그 HTML이 상대 경로를 하나라도 쓰면
  // /s/p/assets/… 로 풀려 404가 난다(지금은 이미지가 없지만, 붙이는 순간 그 함정이다).
  const share = readFileSync(new URL('../api/share.js', import.meta.url), 'utf8');
  const body = share.slice(share.indexOf('<!doctype html>'));
  const urls = [...body.matchAll(/(?:src|href|content|url)=(?:"([^"]*)"|([^"\s>]+))/g)]
    .map(m => (m[1] ?? m[2]).trim())
    .filter(v => !/^(width=|height=|initial-scale|website$|summary)/.test(v));
  assert.ok(urls.length >= 4, '공유 HTML에서 주소를 하나도 못 찾았다 — 정규식이 늙었다');
  for (const u of urls) {
    assert.ok(/^(\/|https?:\/\/|\$\{|0; url=[/$])/.test(u),
      `공유 HTML의 상대 경로: ${u} — /s/p/<id> 밑으로 풀려 404가 난다`);
  }
  console.log('PASS  로그인 로고 · 공유 HTML 경로 8가지');
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
  // 줄의 모양이 아니라 **같은 함수를 쓰는가**만 본다 — 라벨을 그리는 자리가 변수든
  // rowProps든 상관없다(2026-09-08에 그 자리가 rowProps로 묶이면서 한 번 어긋났다)
  assert.ok(/lastSeenAt: seenAt\(/.test(mv) && /\bat: seenAt\(/.test(mv),
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
  const { prefixesOf, kindsOf, V2_TABLES, ALL_KINDS, createSignalQueue, createGate, refreshTouched } =
    await import(pathToFileURL(f).href);

  // ① 표 → 캐시 접두 · kind는 접두의 첫 마디
  // 홈은 카드마다 접두를 쪼갠다(2026-09-24) — 주보 저장 한 번에 홈 조회 14개가 통째로 돌지 않게
  assert.deepStrictEqual(prefixesOf('services'), ['worship', 'home:services', 'home:present']);
  assert.deepStrictEqual(kindsOf('services'), ['worship', 'home']);
  assert.deepStrictEqual(kindsOf('qt_entries'), ['word', 'home'],
    '나눔은 말씀 화면과 홈 카드를 같이 흔든다');
  assert.ok(V2_TABLES.every(t => !prefixesOf(t).includes('home')),
    "맨 'home' 접두를 쓰지 않는다 — 쓰면 상관없는 카드 캐시까지 지워진다");
  assert.deepStrictEqual(prefixesOf('qt_entries'), ['word:qt', 'home:qt'], '묵상은 오늘의 QT 카드만');
  assert.ok(prefixesOf('attendance').includes('groups:mine'),
    '출석은 모임 화면의 내 순 소식(참석 수)도 낡게 한다');
  assert.deepStrictEqual(kindsOf('people'), ['groups', 'roster', 'worship', 'home'],
    '명단이 바뀌면 출석 명단도 바뀐다 — 주보 상세까지 같이 다시 읽는다');
  assert.deepStrictEqual(prefixesOf('cards'), [], 'v1 표는 이 채널이 손대지 않는다');
  assert.strictEqual(V2_TABLES.length, 11, '0049가 발행에 넣은 표 아홉 + 0056의 둘(sun_guides · attendance_guests)');
  // 모임 접두는 셋으로 나눠 적는다 — 'groups' 하나면 가이드 캐시(groups:guide:*)가 딸려 지워진다(2026-09-09)
  assert.ok(V2_TABLES.every(t => !prefixesOf(t).includes('groups')), "맨 'groups' 접두를 쓰지 않는다");
  assert.deepStrictEqual(prefixesOf('sun_guides'), ['groups:guide', 'groups:mine'], '가이드가 바뀌면 본문과 고정 id가 같이 낡는다');
  assert.ok(prefixesOf('attendance_guests').includes('home:services') && prefixesOf('attendance_guests').includes('groups:mine'),
    '손님 출석도 참석 수를 세는 자리를 낡게 한다');
  assert.deepStrictEqual([...ALL_KINDS].sort(), ['groups', 'home', 'roster', 'word', 'worship']);

  // ② 디바운스 — 연속 이벤트가 한 번의 알림으로 합쳐진다(주보 저장 한 번이 UPDATE 여러 건)
  {
    const dropped = [];
    const calls = [];
    const q = createSignalQueue({ drop: p => dropped.push(p), notify: (ks, ts) => calls.push(Object.assign([...ks], { tables: ts })), delay: 5 });
    assert.strictEqual(q.push('cards'), false, '모르는 표는 아무 일도 하지 않는다');
    assert.strictEqual(q.push('services'), true);
    q.push('attendance'); q.push('qt_entries');
    assert.deepStrictEqual(calls, [], '디바운스가 끝나기 전에는 알리지 않는다');
    assert.ok(dropped.includes('worship') && dropped.includes('word:qt'),
      '캐시는 화면이 떠 있든 아니든 바로 비운다(다음 진입의 첫 프레임이 옛 값이면 안 된다)');
    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(calls.length, 1, '세 이벤트가 재조회 한 번으로 합쳐진다');
    assert.deepStrictEqual([...calls[0]].sort(), ['groups', 'home', 'word', 'worship']);
    assert.deepStrictEqual([...calls[0].tables].sort(), ['attendance', 'qt_entries', 'services'],
      '알림에 그동안 바뀐 표 목록이 같이 실린다(화면이 해당 조회만 고른다)');
    // 재접속 — 끊겨 있던 동안의 이벤트는 오지 않았으니 전부 한 번 다시 읽는다
    q.pushAll();
    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual([...calls[1]].sort(), [...ALL_KINDS].sort());
    assert.deepStrictEqual([...calls[1].tables].sort(), [...V2_TABLES].sort(), '재접속이면 표도 전부다');
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
    // 막혀 있던 동안 바뀐 표는 합쳐서 넘긴다 — 마지막 신호의 표만 넘기면 앞의 조회가 빠진다
    const got = [];
    const g2 = createGate((ts) => got.push(ts));
    g2.signal(true, ['qt_entries']);
    g2.signal(false, ['services']); g2.signal(false, ['people']);
    g2.enable(true);
    assert.deepStrictEqual(got[0], ['qt_entries'], '켜져 있으면 받은 표 그대로');
    assert.deepStrictEqual([...got[1]].sort(), ['people', 'services'], '막힌 동안의 표를 합친다');
  }

  // ③-b 홈은 바뀐 표에 딸린 카드만 다시 읽는다(2026-09-24 · 주보가 바뀌면 예배 목록 + 참석 수만)
  // 되돌리기 검사: TABLE_CACHE의 services를 'home' 하나로 되돌리면 첫 단정이, homeView 표에서
  // 한 줄을 빼면 '빠짐없이 든다'가 깨진다.
  {
    const HOME = ['home:qt', 'home:services', 'home:sun', 'home:present'];
    const route = (tables) => refreshTouched(tables, Object.fromEntries(HOME.map(p => [p, () => {}])));
    assert.deepStrictEqual(route(['services']), ['home:services', 'home:present'],
      '주보가 바뀌면 예배 카드와 참석 수만 — 오늘의 QT·내 순은 그대로');
    assert.deepStrictEqual(route(['qt_entries']), ['home:qt'], '묵상은 QT 카드만');
    assert.deepStrictEqual(route(['service_notes']), ['home:sun'], '예배 노트 공유는 내 순(공유된 노트 수)만');
    assert.deepStrictEqual(route(['attendance']), ['home:services', 'home:present'], '출석은 세는 주일과 참석 수');
    assert.deepStrictEqual(route(['sun_guides']), [], '가이드는 홈과 무관하다');
    assert.deepStrictEqual(route(['group_members', 'qt_entries']), ['home:qt', 'home:sun', 'home:present']);
    assert.deepStrictEqual(route([]), HOME, '어디서 왔는지 모르는 신호면 전부 읽는다');
    assert.deepStrictEqual(route(undefined), HOME);
    // 세 자리가 같은 접두 넷을 쓰는지 — TABLE_CACHE의 home 접두 · homeView의 useCached 열쇠 ·
    // homeView의 refreshTouched 표. 어긋나면 비우기만 하고 안 읽는 칸이 생긴다(다음 진입 스켈레톤).
    const homeSrc = readFileSync(new URL('../src/views/homeView.jsx', import.meta.url), 'utf8');
    const tablePrefixes = [...new Set(V2_TABLES.flatMap(prefixesOf).filter(p => p.startsWith('home')))].sort();
    assert.deepStrictEqual(tablePrefixes, [...HOME].sort(), 'liveV2가 비우는 홈 접두는 이 넷뿐이다');
    const keys = [...homeSrc.matchAll(/useCached\(`(home:\w+):/g)].map(m => m[1]).sort();
    assert.deepStrictEqual(keys, [...HOME].sort(), '홈의 useCached 열쇠 앞 두 도막이 그 넷과 같다');
    const block = (homeSrc.match(/useLiveRefresh\('home', \(tables\) => refreshTouched\(tables, \{([\s\S]*?)\}\)\);/) || [])[1] || '';
    const routed = [...block.matchAll(/'(home:\w+)': (\w+)\.refresh/g)];
    assert.deepStrictEqual(routed.map(m => m[1]).sort(), [...HOME].sort(), '홈의 신호 표가 접두 넷을 빠짐없이 든다');
    const cachedNames = [...homeSrc.matchAll(/const (\w+) = useCached\(`(home:\w+):/g)]
      .map(m => `${m[2]}=${m[1]}`).sort();
    assert.deepStrictEqual(routed.map(m => `${m[1]}=${m[2]}`).sort(), cachedNames,
      '접두마다 그 열쇠를 쓰는 조회를 다시 읽는다(열쇠와 refresh의 짝이 맞다)');
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
  assert.ok(/useLiveRefresh\('worship', liveInvalidate, screen === 'list'\)/.test(worship),
    '예배 목록은 실시간으로 갱신하되 상세·출석 화면에서는 건너뛴다');
  assert.ok(/const liveInvalidate = useCallback\(\(\) => \{\s*dropCache\('worship:list'\); cached\.refresh\(\);/.test(worship),
    "신호 길에서는 홈을 통째로 비우지 않는다 — liveV2가 바뀐 표의 홈 접두만 이미 비웠다");
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
  // 홈은 한 줄이 아니라 refreshTouched 표다 — 빠짐없이 드는지는 위 ③-b가 본다
  const members = view('../src/views/membersView.jsx');
  assert.ok(/const rosterTick = useLiveTick\('roster'\)/.test(members)
    && /\[isAdmin, tab, year, rosterTick(, bookRetry)?\]/.test(members),
    '명단은 effect가 읽으므로 틱을 deps에 얹는다');
  console.log('PASS  v2 실시간 라우팅 48가지');
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
  const src =
    // supabaseClient에서 오던 것을 가짜로 세운다. setStorageRelief는 **세션 토큰 쓰기가
    // 한도에 걸렸을 때 캐시가 자리를 내주는 길**이라(2026-09-21), 등록된 함수를 붙잡아
    // 여기서 실제로 불러 본다 — 소스만 보면 '등록했다'까지밖에 못 본다.
    'let __relief = null; const setStorageRelief = (fn) => { __relief = fn; }; export const __relieve = () => __relief && __relief(); '
    + raw
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

  const { setCacheScope, readCache, writeCache, dropCache, __relieve } = await import(pathToFileURL(f).href);
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

  // ②-b 세션 토큰이 자리를 못 찾으면 **캐시를 통째로** 비운다(2026-09-21).
  // 그 순간 필요한 것은 몇 킬로바이트가 아니라 토큰 한 줄이 들어갈 자리이고, 캐시는
  // 다시 읽으면 그만이지만 토큰은 못 쓰면 로그인이 풀린다(아이패드 PWA 제보).
  // **지금 scope만 비우면 안 된다** — 남의 scope가 자리를 잡고 있으면 그대로다.
  // 되돌리기 검사: cache.js의 setStorageRelief 등록을 지우면 둘째가, 지금 scope만
  // 비우게 바꾸면(`${PREFIX}:${scope}:`) 첫째가 깨진다.
  localStorage.setItem('church_cache_v1:u-남:worship:list:2026', '{"x":1}');
  localStorage.setItem('남의 것이 아닌 열쇠', 'ㄱ');
  writeCache('worship:list:2026', { g: 7 });
  __relieve();
  assert.deepStrictEqual(keys(), ['남의 것이 아닌 열쇠'],
    '토큰이 자리를 못 찾으면 scope를 가리지 않고 우리 캐시를 전부 비운다');
  assert.deepStrictEqual(readCache('worship:list:2026'), { g: 7 },
    '메모리 캐시는 그대로다 — 자리를 내주려고 비운 것이지 화면을 비우려는 게 아니다');
  localStorage.removeItem('남의 것이 아닌 열쇠');

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
    // 0061부터 myUid도 같이 가져온다 — 노드에서는 둘 다 세운다(supabaseClient는
    // import.meta.env를 읽어서 그대로 들이면 던진다)
    .replace(/import \{ supabase, myUid \} from '\.\/supabaseClient\.js';/,
      'const supabase = null; const myUid = async () => null;');
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
  // 저장되는 글은 **도막을 되살린 것**이다(2026-09-09 · ensureNoteSections) — 기준도
  // 그 글이어야 한다. `body`로 두면 다음 도착값 판정이 되살린 제목을 '남이 고친 것'으로
  // 읽어 편집기를 덮는다.
  // 2026-09-14: 옮기는 일을 `putBody` 한 벌이 맡는다(초안을 지우는 자리와 같은 곳).
  // 편집기의 글과 기준이 한 줄에서 같이 가야 **도막 제목이 되살아난 직후에도 dirty가
  // 아니다** — 예전에는 기준만 옮겨서 저장 직후 방금 지운 초안이 곧바로 다시 쓰였다.
  assert.ok(/const putBody = \(b\) => \{ const v = bodyOrTemplate\(b, tpl\); setBody\(v\); syncedBody\.current = v; \};/.test(view),
    'putBody가 편집기의 글과 기준을 같이 옮긴다');
  assert.ok(/const kept = ensureNoteSections\(body, QT_SECTIONS\);/.test(view)
    && /putBody\(kept\);/.test(view), '저장하면 기준도 저장된 그 글로 옮긴다');
  // 재조회 실패가 캐시 화면을 '묵상 없음'으로 만들지 않는다
  assert.ok(/if \(!qt \|\| qt\.date !== date\) \{\s*\n\s*setEntry\(\{ date, body: '', title: '', shared: false, exists: false \}\)/.test(view),
    '캐시가 있으면 빈 칸을 세우지 않고 토스트만 한다');
  assert.ok(/if \(qtError && !ref\) \{ setDay\(/.test(view),
    '본문도 같다 — 캐시된 구절이 있으면 그것을 그린다');

  // 형광펜: 로딩 중에 칠한 것을 도착값이 덮지 않는다(ref 플래그). 그릇은 **useStateBox 한 벌**이다
  // (2026-09-09 — 예전에는 useBibleState·BibleTab이 같은 코드를 두 벌 들고 있었다): update가 표식을
  // 놓고, adopt가 표식을 보고 도착값을 버린다. 읽는 이펙트 둘(QT 본문 · 리더)은 그 adopt를 부른다.
  const bible = readFileSync(new URL('../src/components/wordBible.jsx', import.meta.url), 'utf8');
  assert.strictEqual((bible.match(/edited\.current = true;/g) || []).length, 1,
    '표식을 놓는 자리는 useStateBox.update 하나다(두 벌로 갈리면 한쪽만 고쳐진다)');
  assert.ok(/const adopt = \(saved\) => \{ if \(edited\.current\) return; setState\(saved\); writeCache\(STATE_KEY, saved\); \};/.test(bible),
    'adopt: 내가 고쳤으면 도착값을 버린다');
  assert.strictEqual((bible.match(/adopt\(saved\)/g) || []).length, 2,
    '읽는 이펙트 둘(useBibleState · BibleTab)이 모두 adopt를 거친다');
  assert.ok(/const STATE_KEY = 'bible:state';/.test(bible),
    "성경 상태 열쇠는 'bible:'로 시작한다 — dropCache('word')에 쓸려가지 않게");
  console.log('PASS  묵상 본문 동기화 · 성경 상태 14가지');
}

// ── 호칭 · '지난 주일' · 출석 메모 자리 (2026-09-06) ─────────────────────────
// 셋 다 사용자 결정이고, 규칙은 순수 함수 하나씩이다. 화면은 그것을 부르기만 한다 —
// 그래서 여기서 함수를 직접 돌리고, **배선**(어느 화면이 그 함수를 쓰는가)은 소스로 못 박는다.
// 되돌려서 깨뜨린 것(§3-5): honorific의 is_pastor 가지를 지우면 ①, pastSunday의
// `< today`를 `<=`로 바꾸면 ③, worship.js의 rpc 호출을 saveService로 되돌리면 ④가 깨진다.
{
  // 서비스 계층은 supabase·react를 import한다 — 순수 부분만 노드에서 부르기 위해
  // import 줄을 걷어낸다(liveV2 블록과 같은 방식). people.js의 guestStore는 worship.js가
  // **모듈 최상단에서** 부르므로 그 자리만 빈 저장소로 세워 준다.
  const strip = (t) => t
    // 여러 줄 import도 걷는다(worship.js의 cloud import가 2026-09-07부터 두 줄) — 중괄호 안에는 }가 없어
    // 다음 import까지 삼키지 않는다
    .replace(/^import \{[^}]*\} from '\.\/(supabaseClient|cloud|image)\.js';\s*$/gm, '')
    // localDate·byName은 2026-09-24부터 utils·people에서 온다(한 벌로 모았다)
    .replace(/^import .*from '\.\.\/utils\.js';\s*$/gm, 'const generateId = () => "id"; const localDate = (d) => new Date(d).toLocaleDateString("sv-SE");')
    .replace(/^import .*from '\.\/people\.js';\s*$/gm,
      'const guestStore = () => ({ all: () => ({}), rows: () => [], set: () => {} }); const byName = (a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "ko");');
  const dir = mkdtempSync(join(tmpdir(), 'v2hon-'));
  const pf = join(dir, 'people.mjs');
  // titleText.js는 순수 모듈이라 그대로 옆에 둔다(2026-09-08 — 유튜브 제목 NFKC 정규화)
  writeFileSync(join(dir, 'titleText.js'), readFileSync(new URL('../src/services/titleText.js', import.meta.url), 'utf8'));
  const wf = join(dir, 'worship.mjs');
  writeFileSync(pf, strip(readFileSync(new URL('../src/services/people.js', import.meta.url), 'utf8')));
  writeFileSync(wf, strip(readFileSync(new URL('../src/services/worship.js', import.meta.url), 'utf8')));
  const { honorific, honorificsOf } = await import(pathToFileURL(pf).href);
  const { pastSunday, recentSongs, weeksAgoOf, songKey, prefillRoles, PREFILL_ROLES } = await import(pathToFileURL(wf).href);

  // ① 세 갈래 + 객원 — 교역자 '전도사님' · 그 해 부장 '부장님' · 나머지 '청년'
  assert.strictEqual(honorific('임성빈', { isPastor: true }), '임성빈 전도사님');
  assert.strictEqual(honorific('신효진', { roles: ['director'] }), '신효진 부장님');
  assert.strictEqual(honorific('노준석', { roles: [] }), '노준석 청년');
  assert.strictEqual(honorific('조준환', { roles: ['lead_team'] }), '조준환 청년',
    '부장 말고 다른 직분은 호칭을 바꾸지 않는다');
  assert.strictEqual(honorific('한상록 강사님', null), '한상록 강사님',
    '명단에 없는 객원은 적은 글자 그대로 — 아는 것이 없으니 청년이라고 부르지 않는다');
  assert.strictEqual(honorific('', { isPastor: true }), '', '이름이 없으면 붙일 것도 없다');
  assert.strictEqual(honorific('임성빈', { isPastor: true, roles: ['director'] }), '임성빈 전도사님',
    '겸직이면 교역자가 먼저다');

  // ② 이름·id로 찾는 한 벌 — 계정 표시명으로 덮인 이름과 명단의 이름 둘 다 열쇠다
  const nameOf = honorificsOf(
    [{ id: 'p1', name: '임성빈', is_pastor: true },
      { id: 'p2', name: '신효진' },
      { id: 'p3', name: '말감이', roster_name: '임재훈' }],
    [{ person_id: 'p2', year: 2026, role: 'director' }, { person_id: 'p3', year: 2026, role: 'lead_team' }],
  );
  assert.strictEqual(nameOf('임성빈'), '임성빈 전도사님');
  assert.strictEqual(nameOf('신효진'), '신효진 부장님');
  assert.strictEqual(nameOf('말감이'), '말감이 청년');
  assert.strictEqual(nameOf('임재훈'), '임재훈 청년', '명단에 적힌 이름으로도 찾는다(roster_name)');
  assert.strictEqual(nameOf('한상록 강사님'), '한상록 강사님');
  assert.strictEqual(nameOf('아무개', 'p1'), '아무개 전도사님', 'id가 있으면 id가 먼저다');
  assert.strictEqual(honorificsOf()('누구'), '누구', '재료가 없으면 이름 그대로');

  // ③ 홈의 '지난 주일' — **오늘보다 앞선** 발행 주일 주보. 오늘 것은 세지 않는다
  const svc = [
    { id: 'a', kind: 'sunday', status: 'published', service_date: '2026-08-30' },
    { id: 'b', kind: 'sunday', status: 'published', service_date: '2026-09-06' },
    { id: 'c', kind: 'sunday', status: 'draft', service_date: '2026-09-05' },
    { id: 'd', kind: '금요 열정 예배', status: 'published', service_date: '2026-09-04' },
    { id: 'e', kind: 'sunday', status: 'published', service_date: '' },
  ];
  assert.strictEqual(pastSunday(svc, '2026-09-06')?.id, 'a',
    "오늘이 주일이면 오늘 주보를 '지난 주일'이라 부르지 않는다(사용자 지적 2026-09-06)");
  assert.strictEqual(pastSunday(svc, '2026-09-09')?.id, 'b', '평일이면 바로 앞 주일');
  assert.strictEqual(pastSunday(svc, '2026-08-30'), null,
    '앞선 발행 주일이 없으면 null — 홈은 그 도막을 아예 그리지 않는다');
  assert.strictEqual(pastSunday([], '2026-09-09'), null);
  assert.strictEqual(pastSunday(svc, '2026-09-07')?.id, 'b', '작성 중·금요 예배·날짜 없는 행은 세지 않는다');

  // ④ 배선 — 함수가 맞아도 화면이 안 부르면 그대로다
  const src = (u) => readFileSync(new URL(u, import.meta.url), 'utf8');
  const worship = src('../src/services/worship.js');
  assert.ok(/supabase\.rpc\('set_attendance_note', \{ p_service_id: serviceId, p_note: text \}\)/.test(worship),
    '출석 메모는 0052의 rpc로 간다 — services 업데이트(services_write)가 아니다');
  const wview = src('../src/views/worshipView.jsx');
  assert.ok(/await saveAttendanceNoteRow\(openId, text\)/.test(wview), '예배 화면이 그 rpc 경로를 부른다');
  assert.ok(!/save\(\{ attendance_note/.test(wview), '주보 저장 경로로는 더 이상 보내지 않는다');
  const att = src('../src/components/worshipAttendance.jsx');
  assert.ok(/\{perms\.canCheck && \(/.test(att), '메모 칸은 출석 자격(canCheck)일 때 선다 — canEdit이 아니다');
  const detail = src('../src/components/worshipDetail.jsx');
  assert.ok(/honorificsOf\(people, personRoles\)/.test(detail), '주보 상세가 명단+직분으로 호칭 한 벌을 만든다');
  assert.ok(/<Avatar name=\{name\}/.test(detail), '아바타 글자 원은 호칭이 아니라 이름에서 뽑는다');
  const home = src('../src/views/homeView.jsx');
  assert.ok(/pastSunday\(list, day\)/.test(home), "홈의 '지난 주일'은 오늘보다 앞선 주보다");
  // 인도자는 **홈에서 뺐다**(사용자 결정 2026-09-06). 주보 상세에는 그대로 있다 —
  // 호칭 규칙(honorificsOf)이 홈에서 쓰이지 않게 됐으니 그 재료도 같이 사라져야 한다.
  assert.ok(!/praise_leader/.test(home), '홈 예배 카드는 인도자를 싣지 않는다');
  assert.ok(!/honorificsOf/.test(home), '홈에서 안 쓰는 호칭 한 벌은 만들지 않는다');
  assert.ok(/worship-praise-leader/.test(detail), '주보 상세는 인도자를 그대로 보여 준다');
  // 홈 캐릭터 — **그림이 도착한 뒤에** 등장 연출이 걸린다(모바일에서 모션이 빈 자리에서
  // 먼저 끝나던 자리 · 사용자 2026-09-06). 히어로는 우선순위까지 올려 먼저 받는다.
  assert.ok(/\$\{shown \? 'dc-card' : 'opacity-0'\}/.test(home),
    '컷은 도착 전에는 숨어 있다가 도착한 뒤에 등장한다');
  assert.ok(/fetchPriority: 'high'/.test(home), '히어로 컷은 fetchpriority=high로 먼저 받는다');
  assert.ok(/pre\.srcset = cutSet\(HERO_CUT\.src\)/.test(home),
    '히어로 컷은 번들이 읽히는 순간부터 받기 시작한다(index.html의 preload 대신)');
  const mig = src('../supabase/migrations/0052_attendance_note_rpc.sql');
  assert.ok(/security definer/.test(mig) && /set attendance_note = p_note/.test(mig),
    '0052는 security definer로 그 한 칸만 쓴다');
  assert.ok(/can_check_all_attendance\(\) or public\.leads_any_sun\(\)/.test(mig),
    '자격은 전체 출석 자격자 + 순장이다');
  assert.ok(/status = 'published'/.test(mig), '발행된 주보만');
  assert.ok(/grant execute on function public\.set_attendance_note\(uuid, text\) to authenticated/.test(mig)
    && /revoke execute on function public\.set_attendance_note\(uuid, text\) from anon/.test(mig),
    '실행 권한은 로그인 사용자만(0048과 같은 마무리)');

  // ── 최근에 부른 곡 (2026-09-21) ──────────────────────────────────────────
  // 새 표 없이 services.songs(jsonb)만 거꾸로 훑는다. 되돌리기 검사: 발행본 거르기를
  // 빼면 둘째가, `at >= on` 거르기를 빼면 셋째가, weeksAgo의 Math.max(1, …)를 빼면
  // 넷째가, 겹친 곡 추리기를 빼면 다섯째가 깨진다.
  const SVCS = [
    { status: 'published', service_date: '2026-09-13', songs: [{ title: '살아계신 주' }, { title: '주 은혜임을' }] },
    { status: 'published', service_date: '2026-09-06', songs: [{ title: '살아계신 주' }, { title: '오직 예수' }] },
    { status: 'draft',     service_date: '2026-09-19', songs: [{ title: '아직 안 부른 곡' }] },
    { status: 'published', service_date: '2026-09-18', songs: [{ title: '금요에 부른 곡' }] },   // 금요 예배
    { status: 'published', service_date: '2026-06-07', songs: [{ title: '오래전 곡' }] },        // 8주 밖
    { status: 'published', service_date: '2026-09-20', songs: [{ title: '같은 날 곡' }] },        // 자기 날짜
  ];
  const recent = recentSongs(SVCS, { onDate: '2026-09-20', weeks: 8 });
  assert.deepStrictEqual(recent.map(r => `${r.title}/${r.weeksAgo}`),
    ['금요에 부른 곡/1', '살아계신 주/1', '주 은혜임을/1', '오직 예수/2'],
    '최신이 앞 · 같은 곡은 가장 최근 한 번만');
  assert.ok(!recent.some(r => r.title === '아직 안 부른 곡'),
    '작성 중 주보의 곡은 아직 부른 곡이 아니다');
  assert.ok(!recent.some(r => r.title === '같은 날 곡'),
    '같은 날짜(지금 짜는 콘티)는 되돌아오지 않는다');
  assert.ok(recent.every(r => r.weeksAgo >= 1),
    '주중에 낀 예배도 0주 전이 되지 않는다 — "0주 전에 했던 곡"이라는 말은 없다');
  assert.ok(!recent.some(r => r.title === '오래전 곡'), '창 밖(8주)은 빠진다');
  assert.deepStrictEqual(recentSongs(SVCS, { onDate: '' }), [], '날짜를 모르면 빈 목록이다');

  // 제목 맞추기는 띄어쓰기·대소문자를 접는다(손으로 적은 것과 유튜브에서 온 것이 섞인다)
  assert.strictEqual(songKey(' 주  은혜임을 '), songKey('주은혜임을'));
  assert.strictEqual(weeksAgoOf(recent, ' 살아계신주 '), 1, '띄어쓰기가 달라도 같은 곡이다');
  assert.strictEqual(weeksAgoOf(recent, '처음 부르는 곡'), 0, '없으면 0 — 표를 안 붙인다');
  // 링크도 같이 물려준다(2026-09-22) — 칩으로 넣고 같은 영상을 다시 찾게 하지 않는다.
  // 되돌리기 검사: recentSongs의 link를 빼면 이 단정이 깨진다.
  assert.strictEqual(
    recentSongs([{ status: 'published', service_date: '2026-09-13',
      songs: [{ title: '오직 예수', link: 'https://youtu.be/abc' }] }], { onDate: '2026-09-20' })[0].link,
    'https://youtu.be/abc', '곡 이력이 유튜브 링크를 함께 들고 온다');
  console.log('PASS  최근에 부른 곡 10가지');

  // ── 다음 주 예배 위원 물려받기 (2026-09-22에 재료를 바꿨다) ───────────────
  // 처음에는 **지난 주보의 roles**를 물려줬는데, 라이브를 보니 그건 '그 날 섬긴 사람'이라
  // 언제나 한 주 밀린 이름이 앉았다. 다음 주 담당자는 지난 주보 **광고**의
  // `다음 주 예배 위원`에 적혀 있다(사용자 지적 · 9/20 주보로 확인).
  // 되돌리기 검사: 광고 대신 roles를 읽게 하면 첫째가, 종류 거르기를 빼면 다섯째가,
  // 호칭 떼기를 빼면 첫째가, 차례대로 세우기를 빼면 둘째가 깨진다.
  assert.deepStrictEqual(PREFILL_ROLES, ['대표기도', '헌금봉헌'], '물려받는 자리는 둘뿐이다');
  const RSVCS = [
    { kind: 'sunday', status: 'published', service_date: '2026-09-20',
      // roles는 **그 날 섬긴 사람**이다 — 여기서 가져오면 안 된다
      roles: [{ role: '대표기도', name: '이하랑' }, { role: '헌금봉헌', name: '꽃님' }],
      notices: [
        { title: '교우동정', body: '생일자: 조현재 형제 9/20' },
        { title: '다음 주 예배 위원', body: ['헌금봉헌: 윤현서 자매', '대표기도: 이수빈 형제'].join('\n') },
      ] },
    { kind: 'sunday', status: 'published', service_date: '2026-09-13',
      notices: [{ title: '다음 주 예배 위원', body: ['대표 기도: 강서윤 자매', '헌금 봉헌: 옛사람 자매'].join('\n') }] },
    { kind: 'sunday', status: 'draft', service_date: '2026-09-25',
      notices: [{ title: '다음 주 예배 위원', body: '대표기도: 작성중 형제' }] },
  ];
  const PEOPLE = [{ id: 'p-su', name: '이수빈' }];
  assert.deepStrictEqual(prefillRoles(RSVCS, { onDate: '2026-09-27', people: PEOPLE }),
    [{ role: '대표기도', name: '이수빈', personId: 'p-su' },
     { role: '헌금봉헌', name: '윤현서', personId: null }],
    '지난 주보 광고에서 · 호칭을 떼고 · 명단에 있으면 personId까지 잇는다');
  assert.deepStrictEqual(prefillRoles(RSVCS, { onDate: '2026-09-27' }).map(r => r.role),
    ['대표기도', '헌금봉헌'],
    '광고에 적힌 순서와 상관없이 늘 같은 차례로 세운다');
  assert.strictEqual(prefillRoles(RSVCS, { onDate: '2026-09-20' })[0].name, '강서윤',
    '띄어 적은 역할(대표 기도)도 같은 자리로 본다');
  assert.ok(!prefillRoles(RSVCS, { onDate: '2026-09-27' }).some(r => r.name === '작성중'),
    '작성 중 주보의 광고는 보지 않는다');
  assert.deepStrictEqual(prefillRoles(RSVCS, { onDate: '2026-09-27', kind: '성탄절 예배' }), [],
    '이벤트 예배는 주일 4부의 위원을 물려받지 않는다');
  assert.deepStrictEqual(prefillRoles(RSVCS, { onDate: '2026-09-10' }), [],
    '앞선 발행본이 없으면 빈 배열이다(화면도 조용하다)');
  assert.deepStrictEqual(
    prefillRoles([{ kind: 'sunday', status: 'published', service_date: '2026-09-20',
      notices: [{ title: '교우동정', body: '없음' }] }], { onDate: '2026-09-27' }), [],
    '광고에 위원이 안 적혀 있으면 지어내지 않는다');
  // 호칭은 넉넉히 뗀다(2026-09-22 사용자 요청 — "OOO 청년"으로 적어도 잡히게).
  // **띄어쓰기 한 칸은 반드시 있어야 한다**: 붙여 쓴 것까지 떼면 '강꽃님'처럼 호칭으로
  // 끝나는 진짜 이름을 잘라 먹는다(우리 명단에 있는 이름이다).
  // 되돌리기 검사: HONORIFICS의 `\s+`를 `\s*`로 되돌리면 마지막 단정이 깨진다.
  const said = (body) => prefillRoles(
    [{ kind: 'sunday', status: 'published', service_date: '2026-09-20',
       notices: [{ title: '다음 주 예배 위원', body }] }], { onDate: '2026-09-27' })[0]?.name;
  for (const [body, want] of [
    ['대표기도: 이수빈 형제', '이수빈'],
    ['대표기도: 이수빈 자매', '이수빈'],
    ['대표기도: 이수빈 청년', '이수빈'],
    ['대표기도: 이수빈 부장님', '이수빈'],
    ['대표기도: 이수빈 전도사님', '이수빈'],
    ['대표기도: 이수빈 순장', '이수빈'],
    ['대표기도: 이수빈 팀장님', '이수빈'],
    ['대표기도: 이수빈 회장', '이수빈'],
    ['대표기도: 이수빈', '이수빈'],
    ['대표기도 : 이수빈 형제', '이수빈'],
    ['- 대표기도: 이수빈 형제', '이수빈'],
  ]) assert.strictEqual(said(body), want, `"${body}" → ${want}`);
  assert.strictEqual(said('대표기도: 강꽃님'), '강꽃님',
    '호칭으로 끝나는 진짜 이름은 자르지 않는다(띄어쓰기가 없으면 호칭이 아니다)');
  console.log('PASS  다음 주 예배 위원 물려받기 20가지');

  console.log('PASS  호칭 · 지난 주일 · 출석 메모 33가지');
}

// ── 참고 링크 카드 축(0058) · 계정 합치기(0059) ─────────────────────────────
// SQL이라 브라우저 없이 **글자로** 본다(0052·0017을 보는 방식 그대로). 라이브 적용은
// psql로 하고 눈으로 확인했다(HANDOFF §5) — 여기서 보는 것은 "다음 사람이 이 파일을
// 고칠 때 무엇을 지키면 되는가"다.
{
  const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const m58 = src('../supabase/migrations/0058_card_resource_links.sql');
  assert.ok(/add column if not exists card_id uuid references public\.cards\(id\) on delete cascade/.test(m58),
    '0058은 카드 축을 cascade로 더한다(카드를 지우면 링크도 사라진다)');
  // 배타 CHECK — 한 링크는 프로젝트의 것이거나 카드의 것이다. 0047의 files와 같은 모양이다.
  assert.ok(/check \(\(project_id is null\) <> \(card_id is null\)\)/.test(m58),
    '주인은 정확히 하나다(0047 files_owner_exactly_one과 같은 모양)');
  assert.ok(/idx_resource_links_card_id/.test(m58), '카드 축에 인덱스가 있다');

  // **업무 창에는 링크가 없다**(2026-09-11에 되돌렸다 · §6-35). 2026-09-10에 첨부 구역
  // 안 한 목록('+ 파일'·'+ 링크')으로 옮겼던 것을 사용자가 판단해서 걷었다 —
  // "링크 첨부 방식을 넣지 말고 기존처럼 돌리되". 브라우저 검사(tests/handoff)가 화면을
  // 보고, 여기서는 **부품이 다시 살아나지 않는지**를 글자로 본다.
  // **주석은 걷고 본다** — 이 절이 무엇을 되돌렸는지 적어 둔 주석에 그 글자가 그대로
  // 들어 있다(§6-34-e가 SQL에서 가르쳐 준 것과 같다).
  const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const att = noComments(src('../src/modals/attachments.jsx'));
  const modals = noComments(src('../src/modals/modals.jsx'));
  const links = src('../src/components/links.jsx');
  assert.ok(!/LinkRow|LinkAddPopover|onLinkAdd/.test(att),
    '첨부 구역에 링크 부품이 다시 들어왔다');
  assert.ok(!/\+ 링크|참고 링크/.test(att + modals), "업무 창에 '+ 링크'·'참고 링크'가 있다");
  assert.ok(!/export function LinkRow/.test(links), '첨부 구역용 링크 줄(LinkRow)이 남아 있다');
  // 첨부 구역은 예전 모양 그대로다 — 점선 상자 안에 끌어다 놓기·붙여넣기 안내 두 줄
  const dropBox = att.slice(att.indexOf('border-2 border-dashed'), att.indexOf('{!readOnly && rejected.length > 0'));
  assert.ok(/파일을 끌어다 놓거나 클릭해서 선택하세요/.test(dropBox)
    && /이미지는 붙여넣기\(Ctrl\/⌘\+V\)도 돼요/.test(dropBox), '첨부 구역의 점선 상자가 예전 모양이 아니다');
  // 프로젝트 헤더는 그대로다(§8 — 거기 버튼은 '+ 참고 링크')
  assert.ok(/export function PinnedLinkChip/.test(links) && /export function LinkAddPopover/.test(links),
    '프로젝트 헤더가 쓰는 부품까지 지웠다');
  assert.ok(/\+ 참고 링크<\/button>/.test(links), "헤더 버튼 글자가 '+ 참고 링크'가 아니다");

  const m59 = src('../supabase/migrations/0059_merge_profiles.sql');
  assert.ok(/security definer/.test(m59) && /is_master\(\)/.test(m59),
    '0059는 security definer이고 마스터만 부른다');
  // **profiles 행을 지우지 않는다** — 지우면 다시 로그인해 새 프로필이 생기고(0001
  // handle_new_user) 합친 일이 헛일이 된다. 환송 처리로 남긴다.
  assert.ok(!/delete from public\.profiles/.test(m59), '합친 계정의 profiles 행을 지우지 않는다');
  assert.ok(/set approved = false, removed_at = now\(\)/.test(m59), '합친 계정은 환송 처리된다');
  // 겹치는 행이 있는 표는 **먼저 지우고** 옮긴다 — 안 그러면 유니크 제약에 걸려 통째로 실패한다
  for (const t of ['profile_teams', 'card_assignees', 'comment_reactions', 'service_notes', 'qt_entries']) {
    assert.ok(new RegExp(`delete from public\.${t} d`).test(m59), `${t}는 겹치는 행을 먼저 버린다`);
  }
  assert.ok(/update public\.bible_state set profile_id = p_keep/.test(m59), '성경 상태도 옮긴다(PK 한 줄)');
  assert.ok(/update public\.activity set actor_id = p_keep/.test(m59), '활동 기록의 행위자도 옮긴다(FK가 없는 칸이다)');
  assert.ok(/grant execute on function public\.merge_profiles\(uuid, uuid\) to authenticated/.test(m59)
    && /revoke all on function public\.merge_profiles\(uuid, uuid\) from public, anon/.test(m59),
    '실행 권한은 로그인 사용자만(자격은 함수 안에서 본다)');
  // 명단 연결은 UNIQUE라 갈래가 둘이다 — 남기는 쪽이 이미 붙어 있으면 그것을 남긴다
  assert.ok(/people_kept_existing/.test(m59) && /people_relinked/.test(m59),
    '명단 연결은 두 갈래를 돌려준다(이미 붙어 있었나 / 새로 이었나)');

  // 0060 — 합쳐진 계정에 표를 남긴다. 이 칸이 없으면 '환송한 사람'의 '다시 초대하기'가
  // 그 계정을 **빈 중복**으로 되살려 합친 일이 헛일이 된다(0059가 데이터를 다 옮겼다).
  const m60 = src('../supabase/migrations/0060_merged_into.sql');
  assert.ok(/add column if not exists merged_into uuid references public\.profiles\(id\) on delete set null/.test(m60),
    '0060은 merged_into를 자기 참조로 더한다(남은 계정이 지워져도 삭제가 막히지 않게)');
  assert.ok(/removed_by = auth\.uid\(\), merged_into = p_keep/.test(m60),
    '합칠 때 그 표를 같이 남긴다');
  assert.ok(/이미 다른 계정으로 합쳐진 계정은 남길 수 없습니다/.test(m60),
    '이미 합쳐진 계정을 남길 쪽으로 고르지 못하게 막는다(옮긴 것이 다시 갈린다)');
  assert.ok(/update public\.profiles set merged_into = p_keep where merged_into = p_drop/.test(m60),
    '합치기를 두 번 하면 옛 표도 새 주인을 가리킨다');
  // 화면 — 합친 계정은 **환송한 사람과 따로 선다**(사용자 요구 2026-09-10 "아예 구분해서")
  const mv = src('../src/views/membersView.jsx');
  assert.ok(/const mergedRows = \(rows \|\| \[\]\)\.filter\(r => !r\.approved && r\.merged_into\);/.test(mv),
    '합친 계정을 따로 센다');
  assert.ok(/r\.removed_at && !r\.merged_into/.test(mv), '환송한 사람에서는 그것을 뺀다');
  assert.ok(/title="합친 계정"/.test(mv), '제 구역 이름이 있다');
  assert.ok(/합쳤어요/.test(mv) && !/mergedRows[\s\S]{0,900}다시 초대하기/.test(mv),
    '그 구역에는 다시 초대하기가 없다');
  assert.ok(/merged_into/.test(src('../src/services/cloud.js')),
    '목록 조회가 그 칸을 실어 온다(없으면 화면이 가를 수 없다)');

  // 0061 — 합친 계정으로 들어와도 **그 사람**이다(사용자 요구 2026-09-10 "그 계정으로
  // 해도 합쳐진 계정으로 남을 수 있게끔"). 판정 자리에서 auth.uid() 대신 effective_uid().
  const m61 = src('../supabase/migrations/0061_effective_uid.sql');
  assert.ok(/create or replace function public\.effective_uid\(\)/.test(m61)
    && /coalesce\(\(select p\.merged_into from public\.profiles p where p\.id = auth\.uid\(\)\), auth\.uid\(\)\)/.test(m61),
    'effective_uid는 합쳐 들어간 계정이 있으면 그것을 준다');
  // 로그인이 막히지 않아야 한다 — 합친 계정은 환송 처리라 is_approved가 거짓이었다
  assert.ok(/function public\.is_approved[\s\S]{0,400}effective_uid\(\)/.test(m61),
    'is_approved가 그 값을 본다(합친 계정도 통과)');
  // 순 소속·순장 자격·출석이 그대로여야 한다(0035의 헬퍼 아홉이 이 함수를 본다)
  assert.ok(/function public\.my_person_id[\s\S]{0,400}effective_uid\(\)/.test(m61),
    'my_person_id가 그 값을 본다(명단 축으로 이어진다)');
  // 개인 표 셋 — 노트·묵상·성경 상태가 두 벌로 갈리지 않아야 한다.
  // **정책 구역 안에 auth.uid()가 하나도 남아 있지 않은지**로 본다 — 표별로 '어딘가에
  // effective_uid가 있나'만 보면 다섯 중 하나만 고쳐도 통과한다(실제로 그랬다).
  // **주석 줄은 걷는다** — 이 파일의 주석이 'auth.uid() → effective_uid()'라고 적고 있어서
  // 그대로 보면 늘 실패한다(처음에 그렇게 걸렸다)
  const pol = m61.slice(m61.indexOf('drop policy if exists service_notes_select'), m61.indexOf('comment on function'))
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.ok(pol.length > 500, '정책 구역을 찾았다');
  assert.ok(!/auth\.uid\(\)/.test(pol), '개인 표 정책에 auth.uid()가 남아 있지 않다');
  // using 5 + with check 3 = 8 (select 정책 둘에는 with check가 없다)
  assert.ok((pol.match(/effective_uid/g) || []).length >= 8, '다섯 정책이 모두 그 값을 본다');
  for (const t of ['service_notes', 'qt_entries', 'bible_state']) {
    assert.ok(pol.includes(`policy ${t}`), `${t} 정책을 다시 만든다`);
  }
  // 클라이언트도 같은 값을 봐야 한다 — 자기 uid로 걸면 노트가 한 줄도 안 나온다
  const sc = src('../src/services/supabaseClient.js');
  assert.ok(/rpc\('effective_uid'\)/.test(sc) && /export function resetMyUid/.test(sc),
    '클라이언트가 그 값을 묻고 세션이 바뀌면 버린다');
  assert.ok(/resetMyUid\(\)/.test(src('../src/services/auth.jsx')), '세션이 바뀌면 실제로 버린다');
  for (const f of ['word.js', 'worship.js', 'groups.js', 'people.js']) {
    assert.ok(/myUid/.test(src(`../src/services/${f}`)), `${f}가 그 값을 쓴다`);
  }
  // 화면에 보이는 이름도 남긴 계정의 것이다
  assert.ok(/p\.merged_into && nameOfId\.get\(p\.merged_into\)/.test(src('../src/services/cloudSync.js')),
    '합친 계정의 이름은 남긴 계정의 것으로 풀린다');

  // 0063 — 0061이 **남겨 둔 나머지 자리**(읽기 전용 감사 2026-09-11). 합친 계정으로
  // 로그인하면 알림 벨이 비고, '내 순에 공유된 노트'가 0건이고, 옛 댓글·업무·첨부·링크
  // 삭제와 반응 토글과 다녀간 시각이 조용히 실패했다.
  const m63 = src('../supabase/migrations/0063_effective_uid_rest.sql');
  // **주석과 `comment on` 줄을 걷고 본문만 본다**(§6-34-e) — 이 파일의 주석에도
  // 되돌리기 SQL이 통째로 적혀 있어서 그대로 보면 auth.uid()가 잔뜩 잡힌다.
  const body63 = m63.slice(m63.indexOf('begin;'), m63.indexOf('commit;'))
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.ok(body63.length > 1500, '0063 본문을 찾았다');
  // **정책을 새로 만들지 않는다** — permissive는 OR라 하나 더 만들면 옛 조건이 그대로
  // 살아 남아 아무것도 안 바뀐다(§6-31-a). 전부 alter policy로 본문만 바꾼다.
  assert.ok(!/create policy/.test(body63) && !/drop policy/.test(body63),
    '0063이 정책을 새로 만든다 — 이름이 같아도 수가 늘면 OR로 합쳐진다(§6-31-a)');
  // effective_uid()는 0061이 만든다. 여기서 다시 만들면 두 벌이 된다.
  assert.ok(!/function public\.effective_uid/.test(body63), '0063이 effective_uid를 다시 만든다');
  // 사람 판정 함수 셋 — 각각 본문에 auth.uid()가 남아 있지 않아야 한다
  for (const fn of ['same_sun', 'is_pastor', 'touch_last_seen']) {
    const at = body63.indexOf(`function public.${fn}`);
    assert.ok(at > 0, `${fn}을 다시 만들지 않는다`);
    const fnBody = body63.slice(at, body63.indexOf('$$;', at));
    assert.ok(/effective_uid\(\)/.test(fnBody), `${fn}이 effective_uid를 안 본다`);
    assert.ok(!/= auth\.uid\(\)/.test(fnBody), `${fn}에 auth.uid() 판정이 남아 있다`);
  }
  // 정책 열넷 — 이름별로 그 alter 문 안에 effective_uid가 있는지 본다.
  // (`alter policy X on public.Y` 부터 다음 `alter ` 까지가 한 문장이다)
  const stmt63 = (name) => {
    const at = body63.indexOf(`alter policy ${name} on `);
    assert.ok(at > 0, `${name} 정책을 못 찾았다`);
    const next = body63.indexOf('\nalter ', at + 1);
    return body63.slice(at, next < 0 ? body63.length : next);
  };
  for (const p of ['"notifications_select_own"', '"notifications_update_own"', '"notifications_delete_own"',
                   'comments_delete', 'cards_delete', 'files_delete', 'resource_links_delete',
                   'comment_reactions_insert', 'comment_reactions_delete',
                   'push_subscriptions_select_own', 'push_subscriptions_insert_own',
                   'push_subscriptions_update_own', 'push_subscriptions_delete_own',
                   'profiles_update', '"profile_teams write own"']) {
    assert.ok(/public\.effective_uid\(\)/.test(stmt63(p)), `${p}가 effective_uid를 안 본다`);
  }
  // **profiles_insert는 손대지 않는다** — 가입 순간 자기 행을 만드는 자리라
  // auth.uid() = id가 아니면 아무도 첫 행을 못 만든다(0001 그대로).
  assert.ok(!/profiles_insert/.test(body63), '0063이 profiles_insert를 건드린다 — 가입이 막힌다');
  assert.ok(/auth\.uid\(\) = id/.test(src('../supabase/migrations/0001_init.sql')),
    'profiles_insert는 0001의 auth.uid() = id 그대로다');
  // 반응은 **컬럼 기본값도** 같이 옮겨야 한다 — 클라이언트가 주인을 안 보내므로
  // 기본값이 auth.uid()인 채로 정책만 올리면 합친 계정은 반응을 아예 못 남긴다.
  assert.ok(/alter table public\.comment_reactions alter column user_id set default public\.effective_uid\(\)/.test(body63),
    '반응의 주인 기본값이 아직 auth.uid()다 — 정책만 올리면 insert가 통째로 막힌다');

  // 클라이언트도 같은 값을 봐야 한다(§6-34-d) — 정책만 고치면 화면은 자기 uid로 묻는다
  const cl = src('../src/services/cloud.js');
  for (const fn of ['listMyNotifications', 'markAllNotificationsRead', 'savePushSubscription',
                    'updateMyProfile', 'setMyTeams', 'removeCommentReaction']) {
    const at = cl.indexOf(`function ${fn}(`);
    assert.ok(at > 0, `${fn}을 못 찾았다`);
    const fnSrc = cl.slice(at, at + 600);
    assert.ok(/await myUid\(\)/.test(fnSrc), `${fn}이 세션 uid로 묻는다 — 합친 계정에게는 빈 목록이다`);
  }
  assert.ok(/myUid\(\)\.then/.test(src('../src/components/layout.jsx')),
    '알림 실시간 구독 필터가 세션 uid다 — 합친 계정에게는 새 알림이 안 들어온다');
  assert.ok(/presence: \{ key: uid \}/.test(src('../src/services/presence.js')),
    '접속 표시 열쇠가 세션 uid다 — 합친 계정은 접속해도 얼굴이 안 밝는다');
  assert.ok(/export function myUidSync/.test(sc) && /export function isMyUid/.test(sc),
    '자격 판정이 쓸 동기 접근이 없다');
  assert.ok(/isMyUid\(task\.created_by, userId\)/.test(src('../src/modals/modals.jsx')),
    '업무 삭제 자격이 세션 uid만 본다');

  console.log('PASS  링크 카드 축·자리 · 계정 합치기 38가지 · 0063 나머지 자리 40가지');
  console.log('PASS  링크 카드 축 · 업무 창에는 링크 없음 · 계정 합치기 40가지');
}

// ── 노트 도막 (이름·고정·옛 이름 옮기기) ───────────────────────────────────
// 사용자 결정 2026-09-09: "본문, 말씀 요약, 나의 묵상, 결단, 기도 는 아예 지울 수 없게
// 고정" → "중제목들 안 지워지게 해달라니까". 편집기에서 지웠어도 **저장되는 글**에는
// 도막이 그 순서로 서 있다(저장 자리 하나에서 보장한다 — 그 파일 머리말).
// 잃는 것이 없어야 한다: 사람이 쓴 글 · 제목 앞의 글 · 새로 만든 도막.
//
// 2026-09-10에 **이름이 한 번 더 바뀌었다** — '나의 묵상'을 빼고 '결단'을 '나의 결단'으로.
// 2026-09-12에는 **'본문'을 뺐다**(예배 노트 셋 · QT 둘) — 종이 머리(paper.jsx
// PaperNoteHead)에 구절이 이미 서기 때문이다. 옛 이름은 LEGACY_SECTIONS에 **쌓는다**
// (갈아치우면 옛 빈 노트가 '사람이 쓴 글'이 되어 나눔·잔디에 오른다 — docs/PITFALLS.md §6-9-as).
{
  const dir = mkdtempSync(join(tmpdir(), 'note-'));
  const f = join(dir, 'noteTemplate.mjs');
  writeFileSync(f, readFileSync(new URL('../src/services/noteTemplate.js', import.meta.url), 'utf8'));
  const nt = await import(pathToFileURL(f).href);

  // 도막 이름·순서 (사용자 결정 2026-09-12 — '본문'을 뺐다)
  assert.deepStrictEqual(nt.WORSHIP_SECTIONS, ['말씀 요약', '나의 결단', '기도'],
    '예배 노트는 세 도막이다');
  assert.deepStrictEqual(nt.QT_SECTIONS, ['나의 결단', '기도'],
    'QT는 두 도막이다(말씀 요약이 없다)');

  const kept = nt.ensureNoteSections('### 말씀 요약\n들은 것\n### 나의 결단\n음', nt.WORSHIP_SECTIONS);
  assert.deepStrictEqual(nt.splitNoteSections(kept).map(x => x.title), ['말씀 요약', '나의 결단'],
    '글이 있는 도막만 갈리지만');
  for (const t of nt.WORSHIP_SECTIONS) {
    assert.ok(kept.includes(`### ${t}`), `${t} 제목이 되살아난다`);
  }
  assert.ok(kept.indexOf('### 말씀 요약') < kept.indexOf('### 나의 결단')
    && kept.indexOf('### 나의 결단') < kept.indexOf('### 기도'), '순서는 템플릿 순서다');
  assert.ok(kept.includes('들은 것') && kept.includes('음'), '쓴 글은 그대로 얹힌다');

  // 제목을 다 지운 글 — 맨 위에 그대로 남는다(잃지 않는다)
  const lead = nt.ensureNoteSections('그냥 쓴 글', nt.QT_SECTIONS);
  assert.ok(lead.startsWith('그냥 쓴 글'), '제목 앞의 글은 맨 위에 남는다');
  assert.strictEqual((lead.match(/^### /gm) || []).length, 2, 'QT는 두 도막이다');

  // 사람이 새로 만든 도막은 **뒤에** 붙는다
  const extra = nt.ensureNoteSections('### 나의 결단\n가\n### 내가 만든 칸\n나', nt.QT_SECTIONS);
  assert.ok(extra.indexOf('### 내가 만든 칸') > extra.indexOf('### 기도'), '새 도막은 뒤에 붙는다');
  assert.ok(extra.includes('나'), '새 도막의 글도 남는다');

  // **되살린 템플릿은 여전히 빈 노트다** — 아니면 아무도 쓰지 않은 제목이 나눔에 오른다
  assert.strictEqual(
    nt.isTemplateOnly(nt.ensureNoteSections(nt.worshipNoteTemplate(), nt.WORSHIP_SECTIONS)),
    true, '되살린 템플릿은 빈 노트로 남는다');

  // ── 옛 이름으로 저장된 노트를 열어 저장하면 (2026-09-10) ──────────────────
  // 옛 도막('나의 묵상'·'결단')은 이제 템플릿에 없다. 그래도 **글이 사라지면 안 된다** —
  // 새 도막이 그 순서로 서고 옛 도막은 사람이 만든 칸처럼 뒤에 붙는다. 사람이 그 글을
  // 새 도막으로 옮길 수 있게 편집기의 고정 목록에서도 옛 이름은 빠져 있다.
  // **되돌리기**: ensureNoteSections가 아는 이름만 남기게(extra를 버리게) 만들면 깨진다.
  const old = '### 본문\n요 3:16\n### 말씀 요약\n들은 것\n### 나의 묵상\n생각한 것\n### 결단\n하기로 한 것\n### 기도\n빈다';
  const moved = nt.ensureNoteSections(old, nt.WORSHIP_SECTIONS);
  for (const t of nt.WORSHIP_SECTIONS) {
    assert.ok(moved.includes(`### ${t}`), `옛 노트를 저장해도 ${t} 도막이 선다`);
  }
  // '요 3:16'은 2026-09-14에 빠졌다 — 아래 '본문 도막을 걷는다' 묶음이 그 자리다.
  for (const line of ['들은 것', '생각한 것', '하기로 한 것', '빈다']) {
    assert.ok(moved.includes(line), `옛 노트의 '${line}'이 남는다`);
  }
  assert.ok(moved.indexOf('### 기도') < moved.indexOf('### 나의 묵상')
    && moved.indexOf('### 나의 묵상') < moved.indexOf('### 결단'),
    '옛 도막은 새 도막 **뒤에** 그 순서대로 붙는다');
  // 옛 이름만 있는 빈 노트는 아직 빈 노트다(LEGACY_SECTIONS에 쌓았다)
  assert.strictEqual(
    nt.isTemplateOnly('### 본문\n요 3:16\n### 말씀 요약\n\n### 나의 묵상\n\n### 결단\n\n### 기도\n', '요 3:16'),
    true, '옛 이름으로 저장된 빈 노트도 빈 노트다');

  // ── '본문' 도막은 2026-09-12에 뺐다 (사용자 결정) ─────────────────────────
  // "제목 밑에 본문이 나오니까, 그 아래 실제 섹션에서 본문 섹션은 빼자" — 종이 머리
  // (paper.jsx PaperNoteHead)에 구절이 이미 서므로 도막으로 한 번 더 두지 않는다.
  // **새 템플릿에는 없지만 LEGACY_SECTIONS에는 쌓았다** — 옛 노트의 `### 본문`은 저장된
  // 글이라 읽기 종이에 그대로 서고, 빈 템플릿 판정에서도 제목으로 읽혀야 한다.
  // **되돌리기**: LEGACY_SECTIONS에서 '본문'을 빼면 바로 아래 빈 노트 판정이 깨진다(옛
  // 빈 노트가 '사람이 쓴 글'이 되어 나눔 피드·잔디에 오른다).
  assert.ok(!nt.WORSHIP_SECTIONS.includes('본문') && !nt.QT_SECTIONS.includes('본문'),
    "'본문'은 새 템플릿에 없다");
  assert.strictEqual(
    nt.isTemplateOnly('### 본문\n삿 4:11-24\n### 말씀 요약\n\n### 나의 결단\n\n### 기도\n', '삿 4:11-24'),
    true, "'본문'은 LEGACY라 그 도막이 든 옛 빈 노트도 빈 노트다");
  // ── 2026-09-14: 그 도막을 **어디에도 세우지 않는다** (사용자 결정) ────────
  // "그 밑에 구절 또 사용자로부터 입력받을 수 있는 섹션이 있는데 거기! 그거 완벽하게
  // 제거해줬으면 해서." 2026-09-12에는 템플릿에서만 뺐던 터라, 옛 노트에 저장된 도막이
  // **편집 종이에서 여전히 쓸 수 있는 칸**으로 서 있었다. 이제 걷는 자리는
  // noteTemplate.dropLegacySections 한 곳이고 편집기로 들어가는 글·종이·저장이 그것을 지난다.
  // 머리 구절은 주보의 값 하나다(paper.jsx NoteSheet의 끌어올리기도 같이 걷었다).
  // **되돌리기**: dropLegacySections를 빼면 아래 넷이 바로 깨진다.
  const withRef = nt.ensureNoteSections('### 본문\n삿 4:11-24\n### 나의 결단\n음', nt.WORSHIP_SECTIONS);
  assert.deepStrictEqual(nt.splitNoteSections(withRef).map(x => x.title), ['나의 결단'],
    "옛 '본문' 도막은 종이에 서지 않는다");
  assert.ok(!withRef.includes('삿 4:11-24') && !withRef.includes('### 본문'),
    "'본문' 도막은 저장될 때 다시 쓰이지 않는다");
  assert.strictEqual(nt.dropLegacySections('앞 글\n### 본문\n구절\n### 기도\n빈다'), '앞 글\n### 기도\n빈다',
    '걷는 것은 그 도막뿐이고 나머지 줄은 한 글자도 안 건드린다');
  assert.strictEqual(nt.bodyOrTemplate('### 본문\n삿 3:1-11\n', nt.worshipNoteTemplate()),
    nt.worshipNoteTemplate(), "'본문'만 있던 옛 노트는 손대지 않은 템플릿이 된다");

  // 초안 관례 — 자리는 브라우저이고 열쇠는 노트마다 하나다(사용자 결정 2026-09-14)
  assert.strictEqual(nt.noteDraftKey('qt', '2026-09-14'), 'draft:note:qt:2026-09-14');
  // 열쇠의 첫 도막이 화면 캐시(word:·worship:·home)와 겹치면 저장 한 번에 초안이 같이 지워진다
  assert.ok(nt.noteDraftKey('worship', 's1').startsWith('draft:'), '초안 열쇠는 화면 캐시와 갈린다');
  assert.strictEqual(nt.hasDraft({ body: 'a' }, 'a'), false, '저장된 글과 같으면 되살릴 것이 없다');
  assert.strictEqual(nt.hasDraft({ body: 'b' }, 'a'), true);
  assert.strictEqual(nt.hasDraft({ body: 'a', title: '제목' }, 'a', ''), true, '제목만 달라도 초안이다');
  assert.strictEqual(nt.hasDraft(null, 'a'), false);

  // 편집기에서도 고정된다(사용자 결정 2026-09-10 — "아예 수정 창에서부터")
  const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const ed = src('../src/components/MarkdownEditor.jsx');
  const worship = src('../src/components/worshipDetail.jsx');
  const word = src('../src/views/wordView.jsx');
  assert.ok(/name: 'lockedHeadings'/.test(ed) && /filterTransaction/.test(ed),
    '편집기가 정해진 중제목을 지우는 트랜잭션을 물린다');
  assert.ok(/bypass\(\)/.test(ed) && /replacingRef\.current = true/.test(ed),
    '문서를 통째로 교체할 때는 통과시킨다(옛 노트가 안 들어오는 것을 막는다)');
  assert.ok(/lockedHeadings=\{WORSHIP_SECTIONS\}/.test(worship), '예배 노트가 세 도막을 잠근다');
  assert.ok(/lockedHeadings=\{QT_SECTIONS\}/.test(word), '묵상 노트가 두 도막을 잠근다');

  // ── 편집도 종이 안에서 한다 (사용자 요청 2026-09-10) ─────────────────────
  // 읽기와 **같은 부품**을 써야 한다(마크업을 한 벌 더 적으면 한쪽만 고쳐진다).
  // **되돌리기**: 두 화면 중 하나에서 frame/NotePaper를 떼면 이 줄이 깨진다.
  const paper = src('../src/components/paper.jsx');
  for (const name of ['PaperMast', 'PaperNoteHead', 'PaperSheet', 'NotePaper']) {
    assert.ok(new RegExp(`export function ${name}`).test(paper),
      `종이의 ${name}이 읽기·편집 둘 다에 열려 있다`);
  }
  assert.ok(/<PaperNoteHead /.test(paper) && /<PaperMast /.test(paper),
    '읽기 종이도 그 부품을 쓴다(중복 마크업 금지)');
  assert.ok(/frame = null/.test(ed) && /frame \? frame\(<EditorContent editor=\{editor\} \/>\)/.test(ed),
    '편집기가 틀을 받아 편집 칸을 그 안에 넣는다');
  for (const [name, s] of [['예배 노트', worship], ['묵상 노트', word]]) {
    assert.ok(/frame=\{\(content\) => \(/.test(s) && /<NotePaper /.test(s),
      `${name} 편집기가 종이 안에 선다`);
    assert.ok(/note-paper/.test(s), `${name} 편집기에 종이 격자 클래스가 붙는다`);
    assert.ok(/tools="note"/.test(s), `${name} 서식 바에 제목·구분선·링크 버튼이 없다(tools="note")`);
  }
  // 격자는 index.css 한 자리다 — h3은 1열, 그 밖은 2열
  const css = src('../src/index.css');
  assert.ok(/\.note-paper \.tiptap \{[^}]*display: grid/.test(css)
    && /grid-template-columns: 58px minmax\(0, 1fr\)/.test(css),
    '종이 격자는 라벨 58px + 남는 폭이다(읽기 줄과 같은 값)');
  assert.ok(/\.note-paper \.tiptap > :is\(h1, h2, h3, h4\) \{[^}]*grid-column: 1/.test(css),
    '제목은 1열(라벨 칸)로 간다');
  assert.ok(/\.note-paper \.tiptap > \* \{[^}]*grid-column: 2/.test(css),
    '그 밖의 블록은 2열(쓰는 칸)로 간다');
  // 종이는 다크를 안 따라간다(§6-32-i) — 색은 PaperSheet가 흘려 준 --paper-* 한 벌이다
  assert.ok(/'--paper-line': PAPER\.line/.test(paper) && /'--paper-ink2': PAPER\.ink2/.test(paper),
    'PAPER 한 벌이 CSS 변수로 내려간다');
  const paperCss = css.slice(css.indexOf('.note-paper .tiptap {'), css.indexOf('/* 입력 요소의'));
  assert.ok(paperCss.length > 500 && !paperCss.includes('var(--app-'),
    '종이 안 글자에 앱 토큰(다크를 따라가는 색)을 쓰지 않는다');

  console.log('PASS  노트 도막 이름·고정·종이 편집 46가지');
}

// ── 팀 보드 상단 사람 칩 (utils.teamChips) ──────────────────────────────────
// 예전에는 **그 팀 업무의 담당자**를 세어 칩을 세웠다 — 교역자 팀 보드에 교역자가
// 아닌 청년이 떴다(교역자 팀 업무 한 건을 맡고 있었다 · 사용자 지적 2026-09-07).
// 기준은 사람 프로필의 소속 팀이고, 숫자는 그 사람이 맡은 **이 팀의 남은 업무**다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'chips-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { teamChips } = await import(pathToFileURL(f).href);

  const members = [
    { id: 'u1', name: '임재훈', team: '교역자', teams: ['교역자'] },
    { id: 'u2', name: '김윤주', team: '교역자', teams: ['교역자', '찬양팀'] },   // 겸직
    { id: 'u3', name: '조해리', team: '임원진', teams: ['임원진'] },
    { id: 'u4', name: '강예은', team: '찬양팀', teams: ['찬양팀'] },
  ];
  const T = (over) => ({ status: '진행 중', teams: ['교역자'], assignees: [], ...over });
  const tasks = [
    T({ assignees: ['임재훈'] }),
    T({ assignees: ['임재훈'] }),
    T({ assignees: ['조해리'] }),                       // 팀 소속이 아닌 사람이 맡은 건
    T({ assignees: ['김윤주'], status: '완료' }),        // 끝난 것은 안 센다
    T({ assignees: ['강예은'], teams: ['찬양팀'] }),      // 다른 팀 건
  ];

  const chips = teamChips(members, tasks, '교역자');
  assert.deepStrictEqual(chips.map(c => c.name), ['임재훈', '김윤주'],
    '교역자 팀 칩은 교역자로 등록된 사람뿐이다(업무를 맡았어도 소속이 아니면 안 선다)');
  assert.ok(!chips.some(c => c.name === '조해리'),
    '팀 소속이 없는데 이 팀 업무를 맡은 사람은 칩에서 빠진다(사용자 결정 2026-09-07)');
  assert.strictEqual(chips[0].left, 2, '숫자는 그 사람이 맡은 이 팀의 남은 업무 수');
  assert.strictEqual(chips[1].left, 0, '이 팀 업무가 없어도 소속이면 칩은 선다(0)');
  assert.ok(!chips.some(c => c.left === 1 && c.name === '김윤주'),
    '완료된 업무는 남은 수에 들어가지 않는다');
  // 겸직은 두 보드에 다 선다
  assert.deepStrictEqual(teamChips(members, tasks, '찬양팀').map(c => [c.name, c.left]),
    [['강예은', 1], ['김윤주', 0]], '남은 건수 내림차순 → 그다음 가나다');

  // 동명이인이 둘 다 등록돼 있어도 칩은 하나다(같은 key가 두 번 서면 리액트가 경고한다)
  assert.strictEqual(
    teamChips([...members, { id: 'u5', name: '임재훈', team: '교역자', teams: ['교역자'] }], tasks, '교역자').length,
    2, '같은 이름은 한 번만 센다');

  // 게스트 모드(members가 비어 있다)에서는 예전처럼 담당자 기준으로 떨어진다 —
  // 그러지 않으면 이 줄이 통째로 비어 화면이 빈 것처럼 보인다.
  assert.deepStrictEqual(teamChips([], tasks, '교역자').map(c => [c.name, c.left]),
    [['임재훈', 2], ['조해리', 1]], 'members가 없으면 담당자 기준 폴백');
  assert.deepStrictEqual(teamChips(null, null, '교역자'), [], '인자가 없어도 안전하다');

  // 화면이 실제로 이 함수를 쓰는지 · 칩 줄이 제목 아래 **가로 스크롤 한 줄**인지
  const views = readFileSync(new URL('../src/views/views.jsx', import.meta.url), 'utf8');
  // 이 파일에는 팀 **필터** 칩을 담은 지역 변수 teamChips가 따로 있어 들여올 때 이름을 가른다
  assert.ok(/teamChips as teamMemberChips/.test(views)
    && /teamMemberChips\(storeMembers, tasksList, teamName\)/.test(views),
    '팀 보드가 스토어의 멤버로 칩을 세운다');
  assert.ok(/TEAM_CHIP_ROW[\s\S]{0,200}overflow-x-auto/.test(views),
    '칩이 넘치면 줄바꿈이 아니라 가로 스크롤이다');
  assert.ok(/TEAM_CHIP_ROW[\s\S]{0,200}after:w-3/.test(views),
    '끝까지 밀면 마지막 칩 뒤에 여백이 남는다');
  assert.ok(!/members\.slice\(0, 5\)/.test(views), '5명 상한은 없앴다(전원이 선다)');

  console.log('PASS  팀 보드 사람 칩 12가지');
}

// ── 업무의 '이번 주' = 주일에 시작하는 달력의 주 (utils.weekEndOf) ──
// 사용자 지시 2026-09-08 "업무 이번 주 - 주일을 시작으로 하기 무조건".
// 예전에는 '오늘부터 6일'이라 화면의 '이번 주'가 달력의 이번 주와 달랐다.
{
  const dir = mkdtempSync(join(tmpdir(), 'wk-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8'));
  const { weekEndOf } = await import(pathToFileURL(f).href);

  assert.strictEqual(weekEndOf('2026-09-06'), '2026-09-12', '주일이면 엿새 뒤 토요일');
  assert.strictEqual(weekEndOf('2026-09-09'), '2026-09-12', '수요일도 같은 주 토요일');
  assert.strictEqual(weekEndOf('2026-09-12'), '2026-09-12', '토요일이면 오늘이 그 주의 끝');
  assert.strictEqual(weekEndOf('2026-12-30'), '2027-01-02', '해를 넘겨도 토요일까지 간다');
  assert.strictEqual(weekEndOf('2026-02-25'), '2026-02-28', '달을 넘나드는 주도 맞다');
  // 한 주 안의 어느 날에서 봐도 끝나는 날은 하나다 — 이것이 '굴러가는 6일'과 다른 점이다
  const week = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
  assert.strictEqual(new Set(week.map(weekEndOf)).size, 1, '같은 주는 어느 날에서 봐도 끝이 같다');
  // 주일은 새 주의 시작이다 — 토요일과 그다음 날의 끝이 달라야 한다
  assert.notStrictEqual(weekEndOf('2026-09-12'), weekEndOf('2026-09-13'), '주일에 새 주가 시작한다');
  assert.strictEqual(weekEndOf('2026-09-13'), '2026-09-19');
  // 타임스탬프도 앞 10자만 본다 · 값이 없으면 조용히 빈 문자열(구간 판정이 터지지 않게)
  assert.strictEqual(weekEndOf('2026-09-09T23:30:00+09:00'), '2026-09-12', '타임스탬프는 앞 10자만');
  assert.strictEqual(weekEndOf(''), '', '값이 없으면 빈 문자열');
  assert.strictEqual(weekEndOf(), '', '인자가 없어도 안전하다');
  assert.strictEqual(weekEndOf('아무거나'), '', '날짜가 아니면 빈 문자열');

  // 화면 두 곳이 실제로 이 규칙을 쓰는가 — bucketOf는 JSX 안이라 노드가 못 부른다.
  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  const views = readFileSync(new URL('../src/views/views.jsx', import.meta.url), 'utf8');
  assert.ok(/function bucketOf[\s\S]{0,600}?weekEndOf\(today\)/.test(parts),
    '마감 구간의 이번 주는 weekEndOf로 자른다');
  assert.ok(!/daysLeft\([^)]*\)\s*<=\s*6/.test(parts) && !/daysLeft\([^)]*\)\s*<=\s*6/.test(views),
    "굴러가는 '6일 내' 창은 어디에도 남아 있지 않다");
  assert.ok(/weekEndOf\(today\)[\s\S]{0,300}?weekCount[\s\S]{0,200}?dueDate <= weekEnd/.test(views),
    "KPI '이번 주'도 같은 기준으로 센다(숫자와 아래 목록이 어긋나면 안 된다)");
  assert.ok(/note="이번 주 토요일까지"/.test(views) && !/앞으로 일주일 내/.test(views),
    "KPI 밑줄은 그 숫자가 무엇인지 말한다 — '앞으로 일주일 내'는 이제 거짓이다");

  console.log('PASS  업무 이번 주(주일~토요일) 16가지');
}

// ── 한 벌로 모은 것들 (2026-09-08 정리 회차) ───────────────────────────────
// 같은 규칙이 두 파일에 각각 적혀 있으면 반드시 한쪽만 고쳐진다. 이번에 셋을 모았고,
// 여기서는 **정말 한 벌인지**를 지킨다.
//
// 되돌리기 검사(실제로 해서 깨지는 것을 확인했다):
//   · cloud.js에 `const OPEN_EDITOR = {`를 되살리면 첫 묶음이 깨진다
//   · cloud.js에 `const sha256Hex =`를 되살리면 둘째 묶음이 깨진다
//   · App.jsx의 CHURCH_ORDER를 배열 리터럴로 되돌리면 셋째 묶음이 깨진다
{
  const utilsSrc = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const cloudSrc = readFileSync(new URL('../src/services/cloud.js', import.meta.url), 'utf8');
  const layoutSrc = readFileSync(new URL('../src/components/layout.jsx', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

  // ① 확장자 → 구글 편집기 표. 앱 안 미리보기(utils.driveSrc)와 새 탭에서 열기
  //    (cloud.getFileOpenUrl)가 같은 표를 봐야 "앱에서는 구글 화면인데 새 탭은 어두운
  //    파일 뷰어"인 파일이 안 생긴다.
  const d = mkdtempSync(join(tmpdir(), 'oneset-'));
  const uf = join(d, 'utils.mjs');
  writeFileSync(uf, utilsSrc);
  const { GOOGLE_EDITOR } = await import(pathToFileURL(uf).href);
  assert.deepStrictEqual(
    Object.entries(GOOGLE_EDITOR).sort(),
    [['csv', 'spreadsheets'], ['doc', 'document'], ['docx', 'document'],
     ['ppt', 'presentation'], ['pptx', 'presentation'],
     ['xls', 'spreadsheets'], ['xlsx', 'spreadsheets']].sort(),
    '구글 편집기 표는 엑셀·워드·PPT 일곱 확장자');
  assert.ok(/import \{ GOOGLE_EDITOR \} from '\.\.\/utils\.js'/.test(cloudSrc),
    'cloud.js가 그 표를 가져다 쓴다');
  assert.ok(!/const (OPEN_EDITOR|DRIVE_EDITOR) = \{/.test(cloudSrc),
    'cloud.js에 같은 표가 다시 적혀 있지 않다');

  // ② 화면 가림 비밀번호 계산은 services/viewPw.js 한 벌.
  //    cloud.js가 자기 sha256Hex를 들고 있으면 한쪽을 고쳤을 때 걸어 둔 비밀번호가
  //    다른 쪽에서 안 풀린다(첨부·참고 링크·큐시트가 같은 세 칸을 쓴다).
  const { makeViewPw, verifyViewPw, isLocked } = await import(new URL('../src/services/viewPw.js', import.meta.url).href);
  const locked = await makeViewPw('daboot');
  assert.ok(locked.view_pw && locked.view_pw_salt, '비밀번호를 걸면 해시와 소금이 생긴다');
  assert.strictEqual(await verifyViewPw(locked, 'daboot'), true, '같은 비밀번호는 열린다');
  assert.strictEqual(await verifyViewPw(locked, 'daboo'), false, '다른 비밀번호는 안 열린다');
  assert.deepStrictEqual(await makeViewPw(''), { view_pw: null, view_pw_salt: null },
    '빈 값이면 두 칸을 다 비운다(소금만 남기면 예전 비밀번호가 살아난다)');
  assert.strictEqual(isLocked({ view_pw: null }), false);
  assert.ok(!/const sha256Hex/.test(cloudSrc), 'cloud.js에 같은 해시 계산이 다시 적혀 있지 않다');
  assert.ok(/import \{ makeViewPw, verifyViewPw \} from '\.\/viewPw\.js'/.test(cloudSrc),
    'cloud.js가 viewPw.js를 가져다 쓴다');
  assert.ok(/setViewPassword\('files'/.test(cloudSrc) && /setViewPassword\('resource_links'/.test(cloudSrc),
    '첨부와 참고 링크가 같은 쓰기 한 벌을 쓴다');
  // 방향은 한쪽뿐 — viewPw.js가 cloud.js를 물면 supabase가 딸려 와서 이 검사가 못 돈다
  const pwSrc = readFileSync(new URL('../src/services/viewPw.js', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/cloud\.js'/.test(pwSrc), 'viewPw.js는 cloud.js를 import하지 않는다');

  // ③ 교회 축 화면 목록. 하단 바에 서는 순서 = 화면 전환 방향의 기준이라,
  //    두 벌이면 탭을 눌렀는데 반대쪽에서 들어오는 화면이 생긴다.
  assert.ok(/export const CHURCH_MENUS = \['home', 'worship', 'word', 'groups'\]/.test(layoutSrc),
    '교회 축 목록은 layout.jsx가 소유한다');
  assert.ok(/CHURCH_MENUS \} from '\.\/components\/layout\.jsx'/.test(appSrc)
    && /const CHURCH_ORDER = CHURCH_MENUS;/.test(appSrc),
    'App이 그 목록을 그대로 전환 방향의 차례로 쓴다');
  assert.ok(!/\['home', 'worship', 'word', 'groups'\]/.test(appSrc),
    'App에 같은 배열이 다시 적혀 있지 않다');
  assert.ok((layoutSrc.match(/\['home', 'worship', 'word', 'groups'\]/g) || []).length === 1,
    'layout에도 한 번만 적혀 있다');

  console.log('PASS  한 벌로 모은 규칙 셋 15가지');
}

// ── 구절을 책 이름 전체로 (services/bibleRef.js fullRef · 2026-09-11) ────────
// QT 읽기표(qt_schedule.passage_ref · 0038 시드)는 '삿 5:19-31'처럼 **약자**로 저장되어
// 있고 주보의 구절은 사람이 이름 전체로 적는다 — 같은 모양의 노트 종이인데 묵상 쪽
// 머리만 약자였다(사용자 지적 2026-09-11). 저장값은 그대로 두고 **보여줄 때만** 푼다.
// **되돌리기**: fullRef가 받은 글을 그대로 돌려주게 만들면 아래 첫 줄이 깨진다.
{
  const { fullRef, parseRef, formatRef } = await import(new URL('../src/services/bibleRef.js', import.meta.url).href);
  const books = JSON.parse(readFileSync(new URL('../public/bible/index.json', import.meta.url), 'utf8'));

  assert.strictEqual(fullRef('삿 5:19-31', books), '사사기 5:19-31', '약자가 책 이름 전체로 풀린다');
  assert.strictEqual(fullRef('수 4:1-14', books), '여호수아 4:1-14', '읽기표의 약자 표기');
  // 장 전체는 formatRef의 규칙대로 'N장'이다(주보의 구절과 같은 한 벌) — 읽기표 730일은
  // 전부 절 범위라('시 2:1-12') 이 갈래로 오지 않는다
  assert.strictEqual(fullRef('시 121편', books), '시편 121장', '장 전체는 formatRef 규칙을 따른다');
  assert.strictEqual(fullRef('시 2:1-12', books), '시편 2:1-12', '읽기표의 시편 표기');
  // 이미 이름 전체인 글은 **그 모양 그대로** 나와야 한다 — 주보의 구절이 여기를 지난다
  assert.strictEqual(fullRef('이사야 32:9-20', books), '이사야 32:9-20', '이름 전체는 그대로다');
  // 못 읽는 글은 삼키지 않고 그대로 돌려준다(parseRef와 같은 안전한 실패) — 화면에
  // 빈 칸이 서면 그 노트가 무엇에 대한 글인지 말하는 줄이 통째로 사라진다
  assert.strictEqual(fullRef('도마복음 1:1', books), '도마복음 1:1', '못 읽는 글은 그대로');
  assert.strictEqual(fullRef('', books), '', '빈 글은 빈 글');
  assert.strictEqual(fullRef('삿 5:19-31', null), '삿 5:19-31', '책 목록이 없으면 그대로');
  // formatRef와 **같은 답**이어야 한다(두 벌이 되면 한쪽만 고쳐진다)
  assert.strictEqual(fullRef('삿 5:19-31', books), formatRef(parseRef('삿 5:19-31', books), books),
    'fullRef는 parseRef+formatRef 한 벌이다');

  console.log('PASS  구절 표기 풀기 9가지');
}

// ── 묵상 제목 (0062 · 2026-09-11) ───────────────────────────────────────────
// 예배 노트 종이의 머리에는 주보의 설교 제목이 서는데 묵상 노트는 그 자리가 늘 비어
// 구절만 올라왔다. 사용자 요청으로 쓰는 사람이 직접 제목을 단다 — 저장 자리는 컬럼이다
// (HANDOFF §3-1: 묵상과 언제나 같이 읽고 쓰고 값이 하나뿐이다).
// SQL이라 브라우저 없이 **글자로** 본다(0054·0058을 보는 방식 그대로).
{
  const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const m62 = src('../supabase/migrations/0062_qt_title.sql');
  assert.ok(/add column if not exists title text not null default ''/.test(m62),
    "0062는 qt_entries에 title을 not null default ''로 더한다");
  assert.ok(/alter table public\.qt_entries/.test(m62), '표는 qt_entries다');
  assert.ok(/comment on column public\.qt_entries\.title is/.test(m62), '칸에 설명이 붙는다');
  // 되돌리는 SQL은 파일 맨 아래 주석(HANDOFF §5)
  assert.ok(/--\s*alter table public\.qt_entries drop column if exists title;/.test(m62),
    '되돌리는 SQL이 맨 아래 주석에 있다');
  // 정책은 **행 단위**라 바꿀 것이 없다 — 이 파일이 정책을 건드리면 0061의 경계가 흔들린다
  assert.ok(!/create policy|drop policy/.test(m62), '정책은 건드리지 않는다(행 단위라 그대로다)');

  // 저장 계층이 그 칸을 읽고 쓴다 — 셋 중 하나만 빠져도 제목이 어디선가 사라진다
  const wordSrc = src('../src/services/word.js');
  assert.ok(/\.select\('id, qt_date, body, title, shared'\)/.test(wordSrc), '내 묵상 조회가 title을 읽는다');
  assert.ok(/title: t, shared: !!shared, updated_at/.test(wordSrc), 'upsert가 title을 쓴다');
  assert.ok(/\.select\('id, profile_id, body, title, updated_at, profiles/.test(wordSrc),
    '나눔 피드 조회도 title을 싣는다');
  // 0062를 아직 안 넣은 판에서 온 행에도 안 죽어야 한다
  assert.ok(/const entryTitle = \(row\) => String\(row\?\.title \?\? ''\);/.test(wordSrc),
    'title이 없는 행은 빈 글자로 받는다');

  // 화면 — 제목 칸은 **편집 종이 위**에 있고(테두리 없는 입력), 자리표는 '제목 미정'이다
  const paperSrc = src('../src/components/paper.jsx');
  assert.ok(/placeholder="제목 미정"/.test(paperSrc), "자리표는 '제목 미정' 하나다");
  assert.ok(/paper-title-input[\s\S]{0,120}border-0 bg-transparent outline-none/.test(paperSrc),
    '제목 칸에는 테두리·배경이 없다(종이 위에 바로 쓴다)');
  assert.ok(/const TITLE_TYPE = /.test(paperSrc) && (paperSrc.match(/\$\{TITLE_TYPE\}/g) || []).length >= 3,
    '읽기 문단과 입력 칸이 같은 글자 규격을 쓴다');
  // 빈 묵상 판정은 **본문만** 본다(사용자 결정 2026-09-11 — 제목만 적은 날은 빈 노트다)
  const viewSrc = src('../src/views/wordView.jsx');
  assert.ok(/const hasText = !isTemplateOnly\(body, passageRef\);/.test(viewSrc),
    '제목은 빈 노트 판정에 들어오지 않는다');
  // 다만 제목만 고쳐도 저장은 열린다(고친 것이 있다는 뜻이다) — 본문이 비어 있으면
  // hasText가 거짓이라 여전히 저장되지 않는다
  assert.ok(/const dirty = ready && \(body !== base \|\| title\.trim\(\) !== baseTitle\);/.test(viewSrc),
    '제목만 고쳐도 저장 버튼이 열린다');
  // 실시간으로 남이 고친 글이 편집기를 덮지 않게, 제목도 **제 판정**으로 간다(§6-24-c)
  assert.ok(/shouldAdoptBody\(\{ dateChanged, body: titleRef\.current, lastSynced: syncedTitle\.current, next: next\.title \}\)/.test(viewSrc),
    '제목은 제 shouldAdoptBody로 갈아 끼운다');

  console.log('PASS  묵상 제목 저장 자리와 화면 15가지');
}

// ── 홈 예배 카드 · 형제/자매 호칭 (사용자 결정 2026-09-14) ───────────────────
// 셋 다 순수 함수 하나씩이고 화면은 부르기만 한다 — 함수를 직접 돌리고 **배선**은
// 소스로 못 박는다(위 호칭 블록과 같은 짜임).
// 되돌려서 깨뜨린 것(§3-5): pickService의 `status === 'published'`를 빼면 ①,
// homeWorshipLabel의 `date === base` 갈래를 빼면 ②,
// honorific의 BY_GENDER 줄을 HONORIFIC.youth로 되돌리면 ③이 깨진다.
{
  const src = (u) => readFileSync(new URL(u, import.meta.url), 'utf8');
  const home = src('../src/views/homeView.jsx');

  // homeView는 JSX라 통째로는 노드에서 못 읽는다 — **순수 함수 둘만** 오려 낸다.
  // (닫는 `}`가 열 0에 서는 것이 이 오려내기의 전제다 — 그 관례가 깨지면 여기서 드러난다.)
  const cutFn = (name) => {
    const m = new RegExp(String.raw`^export function ${name}\([\s\S]*?\n\}`, 'm').exec(home);
    assert.ok(m, `homeView.jsx가 ${name}를 export 한다`);
    return m[0];
  };
  const dir = mkdtempSync(join(tmpdir(), 'v2home-'));
  const hf = join(dir, 'home.mjs');
  writeFileSync(hf, `const kstToday = () => '2026-09-14';\n${cutFn('pickService')}\n${cutFn('homeWorshipLabel')}\n`);
  const { pickService, homeWorshipLabel } = await import(pathToFileURL(hf).href);

  // ① 홈에 서는 주보 — **발행본 중 가장 최근 날짜**(앞으로 올 것도 고른다)
  const list = [
    { id: 'a', status: 'published', service_date: '2026-08-30' },
    { id: 'b', status: 'published', service_date: '2026-09-06' },
    { id: 'c', status: 'draft', service_date: '2026-09-20' },
    { id: 'd', status: 'published', service_date: '2026-09-20' },
    { id: 'e', status: 'published', service_date: '' },
  ];
  assert.strictEqual(pickService(list)?.id, 'd', '앞으로 올 발행본이 있으면 그것이 가장 최근이다');
  assert.strictEqual(pickService(list.filter(s => s.id !== 'd'))?.id, 'b',
    '앞으로 올 발행본이 없으면 지난 발행본 중 가장 최근');
  assert.strictEqual(pickService([list[2]]), null,
    '작성 중인 주보는 홈에 오르지 않는다(사용자 결정 2026-09-14) — 카드가 아예 서지 않는다');
  assert.strictEqual(pickService([list[4]]), null, '날짜가 없거나 모양이 깨진 행은 세지 않는다');
  assert.strictEqual(pickService([]), null);
  assert.strictEqual(pickService(), null);

  // ② 카드 라벨 셋 — **주를 보지 않는다**(사용자 결정 2026-09-18). 오늘과 주보 날짜만
  // 견준다. 주 경계로 갈랐을 때 어느 시작을 골라도 한쪽이 틀렸던 자리를 다 짚는다.
  const L = (iso, today) => homeWorshipLabel(iso, today);
  assert.strictEqual(L('2026-09-20', '2026-09-18'), '다가오는 예배',
    '금요일에 보는 다가오는 주일 — 월요일 시작이면 여기가 이번 주로 나왔다(사용자 신고)');
  assert.strictEqual(L('2026-09-20', '2026-09-20'), '오늘 예배', '예배 당일');
  assert.strictEqual(L('2026-09-20', '2026-09-21'), '지난 예배',
    '월요일이 되면 어제 주일은 지난 예배 — 주일 시작이면 여기가 이번 주로 남았다');
  assert.strictEqual(L('2026-09-18', '2026-09-16'), '다가오는 예배',
    '금요 예배도 같은 잣대다 — 주 단위 말이 애초에 안 맞는 자리(§7 · 예배는 주일과 금요 둘)');
  assert.strictEqual(L('2026-10-04', '2026-09-16'), '다가오는 예배', '두 주 뒤라도 아직 안 온 예배다');
  assert.strictEqual(L('2026-09-13', '2026-09-16'), '지난 예배', '지난 주일');
  assert.strictEqual(L('bad', '2026-09-16'), '', '못 읽는 날짜에는 아무 말도 하지 않는다');
  assert.strictEqual(L('2026-09-16', 'bad'), '');

  // ③ 호칭 여섯 갈래 — 교역자 · 부장 · 형제 · 자매 · 아직 비어 있음 · 명단 밖
  const strip = (t) => t.replace(/^import \{[^}]*\} from '\.\/(supabaseClient|cloud|image)\.js';\s*$/gm, '');
  const pf = join(dir, 'people.mjs');
  writeFileSync(pf, strip(src('../src/services/people.js')));
  const { honorific, honorificsOf, HONORIFIC } = await import(pathToFileURL(pf).href);
  assert.deepStrictEqual(HONORIFIC,
    { pastor: '전도사님', director: '부장님', brother: '형제', sister: '자매', youth: '청년' });
  assert.strictEqual(honorific('임성빈', { isPastor: true, gender: 'f' }), '임성빈 전도사님',
    '교역자가 성별보다 먼저다');
  assert.strictEqual(honorific('신효진', { roles: ['director'], gender: 'f' }), '신효진 부장님',
    '그 해 부장이 성별보다 먼저다');
  assert.strictEqual(honorific('문진우', { gender: 'm' }), '문진우 형제');
  assert.strictEqual(honorific('신효진', { gender: 'f' }), '신효진 자매');
  assert.strictEqual(honorific('노준석', { gender: null, roles: [] }), '노준석 청년',
    '성별이 아직 비어 있으면 예전처럼 청년이다(0064는 nullable — 53명을 손으로 채우는 중)');
  assert.strictEqual(honorific('한상록 강사님', null), '한상록 강사님',
    '명단에 없는 객원은 적은 글자 그대로');
  assert.strictEqual(honorific('조준환', { roles: ['lead_team'], gender: 'm' }), '조준환 형제',
    '부장 말고 다른 직분은 성별 호칭을 막지 않는다');
  // 한 벌(honorificsOf)도 gender를 싣는다 — 안 실으면 조용히 전부 '청년'이 된다
  const nameOf = honorificsOf(
    [{ id: 'p1', name: '임성빈', is_pastor: true, gender: 'm' },
      { id: 'p2', name: '신효진', gender: 'f' },
      { id: 'p3', name: '말감이', roster_name: '임재훈', gender: 'm' },
      { id: 'p4', name: '아직' }],
    [{ person_id: 'p2', year: 2026, role: 'director' }],
  );
  assert.strictEqual(nameOf('임성빈'), '임성빈 전도사님');
  assert.strictEqual(nameOf('신효진'), '신효진 부장님');
  assert.strictEqual(nameOf('임재훈'), '임재훈 형제', '명단에 적힌 이름으로 찾아도 성별이 붙는다');
  assert.strictEqual(nameOf('아직'), '아직 청년');

  // ④ 배선 — 함수가 맞아도 화면이 안 부르면 그대로다
  assert.ok(/gender/.test(/\.select\('id, name[^']*'\)/.exec(src('../src/services/people.js'))?.[0] || ''),
    'fetchPeople의 select에 gender가 있다 — 빠지면 화면이 조용히 전부 청년이 된다');
  assert.ok(/label=\{homeWorshipLabel\(church\.service\.service_date, day\)\}/.test(home),
    '홈 예배 카드의 머리 글자는 주보 날짜가 정한다');
  assert.ok(!/label="돌아오는 주 예배"/.test(home), "'돌아오는 주 예배' 고정 문구는 사라졌다");
  assert.ok(!/home-worship-draft/.test(home),
    '발행본만 오르므로 카드 안의 작성 중 표시는 죽은 코드다 — 같이 걷었다');
  assert.ok(/church\.service\.preacher/.test(home), '메타 줄 끝은 설교자다');
  assert.ok(!/담당자 \$\{church\.service\.roles/.test(home) && !/찬양 \$\{church\.service\.songs/.test(home),
    '담당자 수·찬양 수 도막은 홈에서 뺐다(사용자 결정 2026-09-14)');
  const ros = src('../src/components/roster.jsx');
  assert.ok(/on\.gender\(person, person\.gender === g \? null : g\)/.test(ros),
    '켠 성별 칩을 다시 누르면 비운다(null) — 잘못 눌렀을 때 돌아갈 길');
  assert.ok(/<PanelRow label="성별">/.test(ros) && /GENDER_STYLE\[g\]/.test(ros),
    '성별은 직분과 같은 Chip·같은 줄 모양이고 색은 토큰이다');
  assert.ok(!/bg-(red|blue|pink|green)-\d{3}/.test(ros), '색은 토큰만 쓴다(Tailwind 기본 팔레트 금지)');
  assert.ok(/소속 <span/.test(ros) && !/소속 팀 </.test(ros), "명단 폼의 라벨은 '소속'이다");
  const rsvc = src('../src/services/roster.js');
  assert.ok(/export async function setGender/.test(rsvc) && /gender: value/.test(rsvc),
    'roster.js가 성별 쓰기 길을 가진다');
  assert.ok(/const COLS = 'id, name, birthday, teams, gender,/.test(rsvc),
    '쓰고 돌려받는 칸에도 gender가 있다');
  const mem = src('../src/views/membersView.jsx');
  assert.ok(/gender: \(p, next\) => write\(p\.id, \(\) => roster\.setGender\(p\.id, next\)/.test(mem),
    '멤버 화면의 쓰기 껍데기(write)를 그대로 탄다 — busy·실패 토스트가 직분과 같다');
  assert.ok(/patchPerson\(p\.id, \{ gender: next \}\)/.test(mem),
    '성공하면 그 줄만 갈아 끼운다(putBook이 예배·모임 캐시를 비운다)');
  console.log('PASS  홈 예배 카드 · 형제/자매 호칭 43가지');
}

// ── 성경 읽기의 최근 검색어 (word.pushRecentSearch · removeRecentSearch · 0065) ──
// 사용자 요구(2026-09-14): "검색어 클릭 시 바로 검색 실행, 삭제 기능 포함. 사용자당 최대
// 30개 노출, 가장 최근 검색어가 최상단, 30개 넘어가면 가장 오래된 것 자동으로 삭제."
// 상한·중복 제거·자르기는 **클라이언트가 한다**(0065 머리말) — 그 규칙이 한 함수에 있는지,
// 그리고 화면이 그 함수를 부르는지를 못 박는다.
// 되돌리기 검사(§3-5): `...rows.filter(r => r.q !== text)`를 `...rows`로 바꾸면 ①이,
// `.slice(0, RECENT_SEARCH_MAX)`를 지우면 ③이, `if (!text) return rows;`를 지우면 ④가,
// `.trim()`을 지우면 ④-b가, removeRecentSearch의 filter를 지우면 ⑤가 깨진다(다섯 다 확인).
{
  const src = readFileSync(new URL('../src/services/word.js', import.meta.url), 'utf8')
    .replace(/import \{ supabase, myUid \} from '\.\/supabaseClient\.js';/,
      'const supabase = null; const myUid = async () => null;');
  const dir = mkdtempSync(join(tmpdir(), 'wordrec-'));
  const f = join(dir, 'word.mjs');
  writeFileSync(f, src);
  const { pushRecentSearch, removeRecentSearch, RECENT_SEARCH_MAX } = await import(pathToFileURL(f).href);

  assert.strictEqual(RECENT_SEARCH_MAX, 30, '사용자당 30개');

  // ① 같은 검색어를 다시 치면 줄이 쌓이지 않고 맨 위로 올라간다(시각만 새로)
  let list = pushRecentSearch([], '사사기', 't1');
  list = pushRecentSearch(list, '사랑', 't2');
  list = pushRecentSearch(list, '사사기', 't3');
  assert.strictEqual(list.length, 2, '같은 검색어가 두 줄이 되지 않는다');
  assert.deepStrictEqual(list.map(r => r.q), ['사사기', '사랑'], '가장 최근 검색어가 최상단');
  assert.strictEqual(list[0].at, 't3', '줄을 새로 쌓지 않고 시각만 간다');

  // ② 새 검색어는 언제나 맨 앞
  assert.strictEqual(pushRecentSearch(list, '요나', 't4')[0].q, '요나', '새 검색어는 언제나 맨 앞');

  // ③ 31번째에서 가장 오래된 것이 빠진다
  let many = [];
  for (let i = 1; i <= 31; i++) many = pushRecentSearch(many, `말${i}`, `t${i}`);
  assert.strictEqual(many.length, 30, '상한 30을 넘지 않는다');
  assert.strictEqual(many[0].q, '말31', '맨 위는 방금 친 것');
  assert.strictEqual(many[29].q, '말2', '가장 오래된 말1이 뒤에서 빠졌다');
  assert.ok(!many.some(r => r.q === '말1'), '빠진 것은 목록에 없다');

  // ④ 빈 글자 · 앞뒤 공백
  assert.deepStrictEqual(pushRecentSearch(list, '   ', 't5'), list, '공백뿐인 검색어는 남기지 않는다');
  assert.deepStrictEqual(pushRecentSearch(list, '', 't5'), list, '빈 글자는 남기지 않는다');
  const trimmed = pushRecentSearch(list, '  사랑  ', 't6');
  assert.strictEqual(trimmed[0].q, '사랑', '앞뒤 공백은 다듬는다');
  assert.strictEqual(trimmed.length, 2, '다듬은 뒤 같은 말이면 쌓이지 않고 올라간다');

  // ⑤ 삭제도 순수 함수 — 견주는 기준은 남길 때와 같다
  assert.deepStrictEqual(removeRecentSearch(list, ' 사랑 ').map(r => r.q), ['사사기'],
    '삭제도 다듬은 글자로 견준다');
  assert.deepStrictEqual(removeRecentSearch(list, '없는말').map(r => r.q), ['사사기', '사랑'],
    '없는 것을 지워도 목록은 그대로');

  // ⑥ 모양이 깨진 옛 값은 걸러진다(화면이 빈 줄을 그리지 않게)
  assert.deepStrictEqual(pushRecentSearch([{ q: '  ' }, null, 'x', { q: '요한', at: 5 }], '눅', 'z'),
    [{ q: '눅', at: 'z' }, { q: '요한', at: '5' }], '모양이 깨진 옛 값은 걸러진다');

  // 배선 — 순수 함수만 맞아도 화면이 안 부르면 그대로다
  const bible = readFileSync(new URL('../src/components/wordBible.jsx', import.meta.url), 'utf8');
  assert.strictEqual((bible.match(/pushRecentSearch\(/g) || []).length, 1,
    '검색어를 남기는 자리는 runSearch 하나다(글자를 칠 때마다 남기면 세 줄이 쌓인다)');
  assert.ok(/const pickRecent = \(q\) => \{[^}]*runSearch\(q\);/.test(bible),
    '최근 검색어를 누르면 지금 검색을 시작하는 그 길로 간다');
  assert.ok(/removeRecentSearch\(state\.recentSearches, q\)/.test(bible), '줄마다 지울 수 있다');
  assert.ok(/const recentOpen = focused && !typed && recent\.length > 0;/.test(bible),
    '검색어를 비운 채 칸에 들어왔을 때만 목록이 선다');
  // 판이 떠 있는 동안 칸 안 안내 문구는 첫 줄에 멎는다(사용자 결정 2026-09-14) —
  // 같은 `recentOpen` 하나를 봐야 판이 열린 순간과 문구가 멎는 순간이 어긋나지 않는다
  assert.ok(/hints=\{recentOpen \? hints\.slice\(0, 1\) : hints\}/.test(bible),
    '판이 떠 있는 동안 안내 문구가 계속 갈아탄다');
  assert.ok(/onMouseDown=\{e => e\.preventDefault\(\)\}/.test(bible),
    '누르는 순간 칸이 포커스를 잃어 목록이 사라지지 않는다');

  // 저장 자리는 bible_state 한 행이다(0065) — 새 왕복을 만들지 않는다
  assert.ok(/\.select\('last_ref, bookmarks, highlights, recent_searches'\)/.test(src),
    '읽기는 bible_state를 읽던 그 한 벌에 얹혀 있다');
  assert.ok(/recent_searches: recentRows\(next\.recentSearches\)/.test(src),
    '쓰기도 그 upsert 한 벌이다');
  assert.strictEqual((src.match(/from\('bible_state'\)/g) || []).length, 2,
    'bible_state를 오가는 왕복은 읽기·쓰기 둘뿐이다');

  console.log('PASS  성경 읽기 최근 검색어 (0065) 21가지');
}

// ── 9차 개선의 마이그레이션 셋 (0064 · 0065 · 0066) ─────────────────────────
// 파일이 무엇을 하는지, 무엇을 **안 하는지**, 되돌리는 SQL이 맨 아래 주석에 있는지를
// 본다(0062 묶음과 같은 짜임 · HANDOFF §5). 라이브 DB는 검사가 못 보므로 여기서는
// 파일만 본다 — 적용 결과는 사람이 psql로 눈으로 확인한다(§3-3).
{
  const mig = (n) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8');

  // 0064 — people.gender. **nullable이어야 한다**: not null + 기본값 '형제'로 백필하면
  // 고치기 전까지 자매를 형제라고 부른다(사용자 결정 2026-09-14는 '미입력 = 청년'이다).
  const m64 = mig('0064_people_gender.sql');
  assert.ok(/alter table public\.people add column if not exists gender text;/.test(m64),
    '0064는 people에 gender를 더한다');
  // 주석에는 'not null'이 말로 나온다(왜 안 쓰는지 적어 뒀다) — **SQL 줄만** 본다
  const ddl = (t) => t.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.ok(!/not null/i.test(ddl(m64)), "0064의 gender는 nullable이다(미입력이 '청년'으로 남는 근거)");
  assert.ok(/check \(gender is null or gender in \('m', 'f'\)\)/.test(m64),
    "값은 'm'·'f' 둘뿐이다(화면 글자는 services/people.js의 HONORIFIC이 정한다)");
  assert.ok(!/create policy|drop policy/.test(m64), '0064는 정책을 건드리지 않는다(행 단위라 그대로다)');
  assert.ok(/--\s*alter table public\.people drop column if exists gender;/.test(m64),
    '0064의 되돌리는 SQL이 맨 아래 주석에 있다');

  // 0065 — bible_state.recent_searches. 상한 30·중복 제거는 **클라이언트가** 한다
  // (위 '최근 검색어' 묶음이 그 규칙을 본다) — 여기에 트리거를 두면 규칙이 두 곳으로 갈린다.
  const m65 = mig('0065_bible_recent_searches.sql');
  assert.ok(/add column if not exists recent_searches jsonb not null default '\[\]'/.test(m65),
    '0065는 bible_state에 recent_searches를 더한다');
  assert.ok(!/create trigger|create policy|drop policy/.test(m65),
    '0065는 트리거도 정책도 만들지 않는다(자르는 규칙은 services/word.js 한 곳)');
  assert.ok(/--\s*alter table public\.bible_state drop column if exists recent_searches;/.test(m65),
    '0065의 되돌리는 SQL이 맨 아래 주석에 있다');

  // 0066 — 개인 표 셋의 기본값을 정책과 같은 함수로. **'누가 했나' 칸은 건드리지 않는다**
  // (0059가 일부러 안 옮긴 자리다 — 그 순간 그 계정이 한 일은 사실이다).
  const m66 = mig('0066_personal_tables_default_effective_uid.sql');
  for (const t of ['service_notes', 'qt_entries', 'bible_state']) {
    assert.ok(new RegExp(`alter table public\\.${t}\\s+alter column profile_id set default public\\.effective_uid\\(\\);`).test(m66),
      `0066이 ${t}.profile_id의 기본값을 옮긴다`);
  }
  for (const t of ['activity', 'comments', 'files', 'cards', 'resource_links', 'sun_guides', 'projects']) {
    assert.ok(!new RegExp(`alter table public\\.${t} `).test(m66),
      `0066은 ${t}을 건드리지 않는다('누가 했나' 칸은 auth.uid() 그대로다 — 0059·0063)`);
  }
  assert.ok(!/create policy|drop policy/.test(m66), '0066은 정책을 건드리지 않는다');
  assert.ok(/--\s*alter table public\.bible_state\s+alter column profile_id set default auth\.uid\(\);/.test(m66),
    '0066의 되돌리는 SQL이 맨 아래 주석에 있다');

  console.log('PASS  9차 마이그레이션 0064·0065·0066 20가지');
}

// ── 로그아웃이 이 기기만 끊는지 (services/auth.jsx 소스 단정) ────────────────
// auth-js의 `signOut()` 기본 scope는 `'global'`이라, 옵션을 비우면 **그 사람의 모든
// 기기**의 리프레시 토큰이 서버에서 폐기된다. 폰에서 한 번 로그아웃하면 아이패드는
// 그 자리에서 안 튕기고 **다음 토큰 갱신 때** 조용히 풀려서, 원인을 알기 어려운
// "가끔 로그인하라고 뜬다"로 나타났다(사용자 신고 2026-09-21 · 아이패드 PWA).
// 이 파일은 supabase 클라이언트를 import해서 노드에서 돌릴 수 없으므로 소스로 지킨다
// (presence.js·§6-31과 같은 방식).
// 되돌리기 검사: `signOut({ scope: 'local' })`을 `signOut()`으로 되돌리면 첫 단정이 깨진다.
{
  const src = readFileSync(new URL('../src/services/auth.jsx', import.meta.url), 'utf8');
  assert.ok(/auth\.signOut\(\{\s*scope:\s*'local'\s*\}\)/.test(src),
    "로그아웃은 scope: 'local' — 기본값 global은 다른 기기의 세션까지 끊는다");
  assert.ok(!/auth\.signOut\(\s*\)/.test(src),
    'scope 없는 signOut()이 남아 있지 않다');
  console.log('PASS  로그아웃이 이 기기만 끊는다 2가지');
}

// ── 세션 토큰 쓰기가 한도에 걸려도 살아남는지 (소스 단정) ────────────────────
// 아이패드 PWA에서 한 시간마다 로그인이 풀리던 자리(제보 2026-09-21 · 조해리).
// 토큰은 갱신마다 다시 저장돼야 하는데 localStorage가 5MB에 닿으면 그 쓰기가 조용히
// 실패하고, 기기에는 이미 폐기된 옛 토큰이 남아 다음 갱신에서 끊긴다.
// cache.js는 자기 키가 걸릴 때만 스스로 비우므로 토큰은 그 보호 밖이었다.
// 되돌리기 검사: supabaseClient의 `storage: authStorage`를 빼면 첫 단정이, setItem의
// 두 번째 시도를 지우면 둘째가, cache.js의 setStorageRelief 등록을 지우면 넷째가 깨진다.
{
  const sc = readFileSync(new URL('../src/services/supabaseClient.js', import.meta.url), 'utf8');
  assert.ok(/storage:\s*authStorage/.test(sc),
    '세션을 우리 저장 자리(authStorage)에 담는다 — 기본 localStorage면 한도에서 조용히 진다');
  const setItem = sc.slice(sc.indexOf('setItem:'), sc.indexOf('};', sc.indexOf('setItem:')));
  assert.strictEqual((setItem.match(/localStorage\.setItem/g) || []).length, 2,
    '한도에 걸리면 자리를 내주고 **한 번만** 다시 쓴다(무한히 다시 쓰지 않는다)');
  assert.ok(/console\.error\(/.test(setItem),
    '그래도 못 쓰면 조용히 넘기지 않는다 — 다음 갱신에서 로그인이 풀리는 자리다');

  const cache = readFileSync(new URL('../src/services/cache.js', import.meta.url), 'utf8');
  assert.ok(/setStorageRelief\(\s*\(\)\s*=>\s*purgeKeys\(/.test(cache),
    '캐시가 자리 내주는 길을 등록한다(접두를 아는 쪽이 지운다)');
  assert.ok(!/church_cache_v1/.test(sc),
    'supabaseClient는 캐시 접두를 모른다 — 두 벌로 적으면 한쪽만 바뀌는 날 안 지워진다');
  console.log('PASS  세션 토큰이 저장소 한도를 견딘다 5가지');
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

// ── 키보드가 올라와도 쓰던 칸이 보이는지 (소스 단정) ─────────────────────────
// 폰에서 댓글 칸이 키보드에 가리고, 업무 수정에서는 손으로 다시 내려야 했다
// (사용자 신고 2026-09-22 · 실기기 두 대). 원인 둘:
//   ① 모바일 업무 창이 `fixed inset-0`이라 **레이아웃 뷰포트**에 붙어 있었다 —
//      키보드가 올라와 앱 뿌리(--app-vh)가 줄어도 그 창의 바닥은 키보드 밑에 남는다.
//   ② 모달 안 스크롤 상자에서는 브라우저가 focus된 칸을 알아서 끌어오지 못한다.
// 키보드는 헤드리스에서 못 띄우므로 소스로 지킨다(presence.js·§6-31과 같은 방식).
// 되돌리기 검사: 모달의 `h-[var(--app-vh,100dvh)]`를 `inset-0`으로 되돌리면 첫 단정이,
// App.jsx의 scrollIntoView를 지우면 셋째가 깨진다.
{
  const modals = readFileSync(new URL('../src/modals/modals.jsx', import.meta.url), 'utf8');
  const mobileOpen = modals.slice(modals.indexOf('if (isMobile) {'));
  assert.ok(/fixed inset-x-0 top-0 h-\[var\(--app-vh,100dvh\)\][^"]*z-50 bg-surface/.test(mobileOpen),
    '모바일 업무 창은 앱 뿌리와 같은 높이를 쓴다(fixed inset-0이면 키보드 밑에 남는다)');
  assert.ok(!/className="fixed inset-0 z-50 bg-surface/.test(modals),
    'inset-0으로 되돌아간 자리가 없다');

  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const vv = app.slice(app.indexOf('const vv = window.visualViewport;'));
  assert.ok(/requestAnimationFrame\(keepCaretVisibleSettled\)/.test(vv),
    '창이 줄면 커서를 보이는 자리로 끌어온다(새 높이가 잡힌 다음 프레임에)');
  // 키보드가 올라오는 동안 **매 프레임 따라간다**(2026-09-22 실기기 — 시각마다 툭툭
  // 밀었더니 "뚜두둑" 끊겨 보였다). 비율로 좁히면 움직임이 이어지고, 목표가 계속
  // 바뀌어도 그때그때 다시 잰다. 되돌리기 검사: rAF 되풀이를 setTimeout 몇 개로
  // 바꾸면 첫 단정이, 2px 스냅을 빼면 셋째가 깨진다(비율로만 좁히면 영영 안 닿는다).
  assert.ok(/followId = requestAnimationFrame\(step\)/.test(app),
    '키보드가 올라오는 동안 프레임마다 따라간다');
  assert.ok(/dy \* FOLLOW_EASE/.test(app), '한 프레임에 남은 거리의 일부만 좁힌다');
  assert.ok(/Math\.abs\(dy\) < 2 \? dy :/.test(app), '2px 안쪽은 한 번에 붙인다');
  assert.ok(/cancelAnimationFrame\(followId\)/.test(app),
    '다시 부르면 앞의 따라가기를 멈춘다 — 둘이 겹치면 서로 민다');
  // 업무 창은 창 전체가 한 번, 그 안의 상세 칸이 또 한 번 구르는 겹 구조다.
  assert.ok(/left -= \(n\.scrollTop - was\)/.test(app),
    '한 상자로 모자라면 바깥 상자를 이어서 민다');
  assert.ok(!/behavior: 'smooth'/.test(app),
    '커서 맞추기는 바로 민다 — 부드럽게 하면 여러 번 부르는 것과 서로 싸운다');
  assert.ok(/vv\.height < lastH - 80/.test(vv),
    '키보드와 주소창 여닫힘을 가른다 — 주소창은 이보다 적게 움직인다');
  assert.ok(/selectionchange/.test(vv) && /setTimeout\(keepCaretVisible, 120\)/.test(vv),
    '글을 쓰는 동안 커서가 내려가도 따라간다(글자마다 굴리지 않게 한 박자 묶는다)');
  // 주석에는 그 이름이 남아 있다(왜 안 쓰는지를 적어 뒀다) — **부르는 자리**만 본다.
  assert.ok(!new RegExp('\\.scrollIntoView\\(').test(app.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')),
    'scrollIntoView로 돌아가지 않았다 — 그건 칸 전체를 가운데로 보내서 커서와 무관하다');
  assert.ok(/data-kb-bar/.test(app) && /data-kb-bar/.test(modals),
    '아래 도구 줄(저장·취소) 높이를 셈이 안다 — 그 줄이 커서를 가리던 자리다');
  assert.ok(/isContentEditable/.test(app),
    '본문 편집기(contenteditable)도 같이 본다 — 업무 수정이 그 자리다');
  console.log('PASS  키보드가 올라와도 커서가 보인다 14가지');
}

// ── '승인을 기다려주세요'가 헛뜨지 않는지 (소스 단정) ────────────────────────
// 신고 2026-09-22(조해리·노준석): 잘 쓰다가 가끔 승인 대기 화면으로 떨어진다.
// 원인이 둘이었다.
//   ① AuthGate가 `!approved` 하나로 봐서 **아직 물어보기 전(null)** 에도 그 화면을 띄웠다.
//   ② 자격을 묻는 rpc가 실패하면 `!!null`이 false가 되어 **true였던 값이 false로 떨어졌다.**
//      이 물음은 토큰이 갱신될 때마다(한 시간) 다시 던져지므로, 폰에서 신호가 잠깐
//      끊기면 멀쩡히 쓰던 사람이 그 화면을 봤다.
// 되돌리기 검사: AuthGate의 `approved === null` 줄을 지우면 첫 단정이, auth.jsx의
// 실패 시 조기 반환을 지우면 셋째가 깨진다.
{
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(/approved === null\) return <div className="h-dvh bg-canvas"/.test(app),
    '아직 모르는 동안에는 승인 대기가 아니라 빈 화면이다');
  assert.ok(app.indexOf('approved === null') < app.indexOf('enabled && !approved'),
    '모름 판정이 먼저다 — 뒤에 두면 !approved가 null을 먼저 삼킨다');

  const auth = readFileSync(new URL('../src/services/auth.jsx', import.meta.url), 'utf8');
  const perm = auth.slice(auth.indexOf("resetMyUid();"));
  assert.ok(/if \(!res\) \{[\s\S]*?return;/.test(perm),
    '자격을 못 물어봤으면 알던 값을 그대로 둔다(아니오로 바꾸지 않는다)');
  assert.ok(/r\.some\(x => x\.error\) \? null :/.test(perm),
    'rpc 셋 중 하나라도 실패하면 그 회차는 통째로 버린다 — 반만 믿으면 더 나쁘다');
  assert.ok(/setTimeout\(r, 1500\)/.test(perm), '한 번은 다시 물어본다');
  assert.ok(perm.indexOf('if (!res)') < perm.indexOf('approved: !!ap.data'),
    '값을 덮어쓰는 줄은 실패 관문 **뒤**에 있다 — 앞에 있으면 관문이 아무 일도 안 한다');
  console.log('PASS  승인 대기 화면이 헛뜨지 않는다 6가지');
}

// ── 커서를 얼마나 굴려야 하나 (utils.caretShift) ────────────────────────────
// 위 소스 단정이 '배선'을 보는 것이라면, 이건 **셈 자체**를 본다. 순수 함수라 그냥 부른다.
// 되돌리기 검사: `caret.bottom > bottom` 갈래를 지우면 첫 단정이, 띠가 없을 때의
// 조기 반환을 지우면 마지막이 깨진다.
{
  const U = await import(new URL('../src/utils.js', import.meta.url).href);
  const view = { top: 0, bottom: 400 };   // 보이는 띠: 0~400 (그 아래는 저장·취소 바)
  assert.strictEqual(U.caretShift({ top: 380, bottom: 400 }, view), 12,
    '커서가 바에 닿으면 그만큼 굴린다(여백 12px)');
  assert.strictEqual(U.caretShift({ top: 100, bottom: 120 }, view), 0,
    '띠 안에 있으면 안 굴린다 — 글자마다 화면이 움직이면 멀미가 난다');
  assert.strictEqual(U.caretShift({ top: 0, bottom: 20 }, view), -12,
    '위로 숨었으면 음수 — 내려서 보여 준다');
  assert.strictEqual(U.caretShift({ top: 500, bottom: 520 }, view), 132,
    '한참 아래면 그만큼 크게 굴린다');
  assert.strictEqual(U.caretShift(null, view), 0, '커서를 못 재면 가만히 둔다');
  assert.strictEqual(U.caretShift({ top: 10, bottom: 30 }, { top: 0, bottom: 10 }), 0,
    '키보드가 띠를 다 먹었으면 굴리지 않는다(굴려 봐야 보일 자리가 없다)');
  console.log('PASS  커서를 얼마나 굴리나 6가지');
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

// ── 수정한 칸만 내 것으로 저장한다 (utils.mergeTaskEdit · 2026-09-25 감사 S3) ──────
// 수정 폼은 '수정'을 누른 순간의 카드(base)를 들고 있다가 저장 때 통째로 보냈다 — 그 사이
// 남이 체크한 하위 업무가 내 저장으로 풀렸다. 게스트 모드는 클라우드 저장(cardPatch)을 안
// 타지만 보내는 값은 이 함수가 정한다(§3-5). 되돌리기 검사: `editChanged(...) ? mine[k] : live[k]`를
// `mine[k]`로 바꾸면(= 예전처럼 통째로) 첫 단정이, live 대신 mine을 펼치면 넷째가 깨진다.
{
  const U = await import(new URL('../src/utils.js', import.meta.url).href);
  const base = { id: 'c1', title: '포스터', content: '본문', status: '진행 중', assignees: ['노준석'],
    subtasks: [{ id: 'a', title: '시안', done: false }], position: 3, aiSummary: '' };
  const live = { ...base, subtasks: [{ id: 'a', title: '시안', done: true }], status: '검토', position: 7, aiSummary: '요약' };
  const mine = { ...base, title: '포스터 (고침)' };
  const m = U.mergeTaskEdit(mine, base, live);
  assert.strictEqual(m.subtasks[0].done, true, '남이 체크한 하위 업무가 내 저장으로 풀리지 않는다');
  assert.strictEqual(m.status, '검토', '남이 바꾼 상태도 그대로다');
  assert.strictEqual(m.title, '포스터 (고침)', '내가 고친 칸은 내 값이다');
  assert.strictEqual(m.position, 7, '수정 폼이 안 고치는 칸(순서)은 지금 카드의 값이다');
  assert.strictEqual(m.aiSummary, '요약', '고정 요약도 지금 카드의 값이다');
  const mine2 = { ...base, subtasks: [...base.subtasks, { id: 'b', title: '인쇄', done: false }] };
  assert.strictEqual(U.mergeTaskEdit(mine2, base, live).subtasks.length, 2, '내가 하위 업무를 고쳤으면 내 목록이다(칸 단위)');
  assert.strictEqual(U.mergeTaskEdit(mine, null, live), mine, '기준이 없으면(새 업무) 그대로 보낸다');
  // dirty는 스냅숏과 견준다 — 남이 바꾼 칸은 '내가 고친 것'이 아니다
  assert.strictEqual(U.taskEditDirty(base, base), false);
  assert.strictEqual(U.taskEditDirty(base, live), true, '(참고) 살아 있는 카드와 견주면 안 고쳐도 고친 것이 된다');
  console.log('PASS  수정한 칸만 내 것으로 9가지');
}

// ── 한글 조합 중의 Enter는 확정이 아니다 (utils.imeComposing · 2026-09-25 감사 S6) ──────
// 맥·아이폰은 조합 중인 마지막 글자를 끝내는 Enter를 칸에 그대로 보낸다 — 그 Enter로 등록이
// 한 번 돌고, 끝난 글자가 칸에 남았다. **Enter로 무언가를 하는 칸은 전부** 이 가드를 먼저 본다:
// 소스에서 `e.key === 'Enter'`가 나오는 핸들러마다 같은 핸들러 안에 imeComposing이 있어야 한다.
// 되돌리기 검사: 한 곳에서 `if (imeComposing(e)) return;`을 지우면 둘째 단정이 그 파일을 짚는다.
{
  const U = await import(new URL('../src/utils.js', import.meta.url).href);
  assert.strictEqual(U.imeComposing({ nativeEvent: { isComposing: true } }), true, 'React 이벤트의 조합');
  assert.strictEqual(U.imeComposing({ isComposing: true }), true, 'DOM 이벤트의 조합');
  assert.strictEqual(U.imeComposing({ keyCode: 229 }), true, '옛 브라우저(keyCode 229)');
  assert.strictEqual(U.imeComposing({ key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 }, keyCode: 13 }), false, '보통 Enter');
  const { readdirSync, readFileSync: rf, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../src/', import.meta.url);
  const walk = (dir) => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : (/\.(jsx?|mjs)$/.test(n) ? [p] : []);
  });
  const missing = [];
  let seen = 0;
  const { fileURLToPath } = await import('node:url');
  for (const file of walk(fileURLToPath(root))) {
    const lines = rf(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/\b(e|event)\.key === 'Enter'/.test(line)) return;
      // 성경 절 고르기(wordBible)는 글 칸이 아니다 — Enter·Space로 누르는 줄이다
      if (/e\.key !== 'Enter'/.test(line)) return;
      seen++;
      // 같은 줄, 아니면 그 핸들러의 앞 8줄 안에 가드가 있어야 한다
      const near = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
      if (!/imeComposing\((e|event)\)/.test(near)) missing.push(`${file.split(/[\\/]src[\\/]/)[1]}:${i + 1}`);
    });
  }
  assert.ok(seen >= 20, `Enter 핸들러를 못 찾는다(${seen})`);
  assert.deepStrictEqual(missing, [], `조합 가드가 없는 Enter 핸들러: ${missing.join(', ')}`);
  console.log(`PASS  한글 조합 중 Enter 가드(핸들러 ${seen}곳) 6가지`);
}

// ── 0071 보안 조이기의 모양 (보안 감사 2026-09-24) ──────────────────────────
// 라이브 DB는 검사가 못 보므로 파일만 본다(적용 결과는 psql로 눈으로 · §3-3). 핵심은 셋:
// 프로필 가드가 **예외 없이 되돌리기만** 하는지(내 정보 저장 upsert가 행을 통째로 보낼 수 있다),
// 그 트리거가 이메일 트리거보다 **이름순 앞**인지, 정책을 **더하지 않고** alter만 하는지(§6-31-a).
// 되돌리기 검사: 가드에서 `new.merged_into := old.merged_into`를 지우면 첫 묶음이 깨진다.
{
  const m71 = readFileSync(new URL('../supabase/migrations/0071_rls_hardening.sql', import.meta.url), 'utf8');
  const sql = m71.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  let n = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

  // ① 프로필 가드 — 관리자·서버 문맥(auth.uid() 없음)은 통과, 나머지는 일곱 칸을 옛 값으로
  ok(/create or replace function public\.guard_profile_columns\(\)/.test(sql), '0071에 guard_profile_columns가 있다');
  ok(/if auth\.uid\(\) is null or public\.is_admin\(\) then\s+return new;/.test(sql),
    '가드는 서버 문맥·관리자(merge_profiles 포함)를 그대로 둔다');
  for (const c of ['approved', 'approved_at', 'approved_by', 'removed_at', 'removed_by', 'merged_into', 'email']) {
    ok(new RegExp(`new\\.${c}\\s*:=\\s*old\\.${c};`).test(sql), `비관리자 UPDATE는 ${c}를 옛 값으로 되돌린다`);
  }
  ok(/if tg_op = 'INSERT' then[\s\S]*?new\.approved := false;[\s\S]*?new\.merged_into := null;[\s\S]*?return new;/.test(sql),
    '행이 없을 때의 INSERT로도 스스로 승인할 수 없다');
  ok(!/raise exception/i.test(sql), '0071은 예외를 던지지 않는다 — 되돌리기만(내 정보 저장이 실패하면 안 된다)');
  const guard = sql.match(/create trigger (\w+) before insert or update on public\.profiles/);
  ok(guard && guard[1] < 'trg_sync_profile_email',
    '프로필 가드 트리거가 trg_sync_profile_email보다 이름순 앞이다(비운 email을 그 트리거가 채운다)');
  ok(/alter policy profiles_insert on public\.profiles\s+with check \(id = any \(array\[auth\.uid\(\), public\.effective_uid\(\)\]\)\);/.test(sql),
    'profiles_insert가 남긴 계정 id도 받는다(합친 계정의 내 정보 upsert)');

  // ② 작성자 칸 — 트리거 넷 + insert with check 넷
  for (const [t, c] of [['cards', 'created_by'], ['files', 'uploaded_by'], ['comments', 'author_id']]) {
    ok(new RegExp(`create trigger trg_${t}_guard_author before insert or update of ${c} on public\\.${t}\\s+for each row execute function public\\.guard_author_column\\('${c}'\\);`).test(sql),
      `${t}.${c}에 작성자 가드(INSERT·UPDATE)가 있다`);
  }
  ok(/create trigger trg_activity_guard_author before insert on public\.activity\s+for each row execute function public\.guard_author_column\('actor_id'\);/.test(sql),
    'activity.actor_id에 작성자 가드(INSERT)가 있다');
  for (const [t, c] of [['cards', 'created_by'], ['files', 'uploaded_by'], ['comments', 'author_id'], ['activity', 'actor_id']]) {
    ok(new RegExp(`alter policy ${t}_insert on public\\.${t}\\s+with check \\([\\s\\S]*?public\\.is_approved\\(\\)[\\s\\S]*?${c} = any \\(array\\[auth\\.uid\\(\\), public\\.effective_uid\\(\\)\\]\\)[\\s\\S]*?\\);`).test(sql),
      `${t}_insert가 승인 게이트를 유지하고 ${c}를 내 id(두 id)로 묶는다`);
  }
  ok(/alter policy files_insert[\s\S]*?\(service_id is null or public\.can_edit_service\(\)\)/.test(sql),
    'files_insert는 0047의 주보 송폼 갈래를 그대로 둔다');

  // ③ 댓글 고치기 · ④ 명단 추가
  ok(/alter policy comments_update on public\.comments\s+using \(public\.is_approved\(\) and \(author_id = any[^\n]*\)\s+with check \(public\.is_approved\(\) and \(author_id = any/.test(sql),
    'comments_update는 쓴 사람(두 id)·관리자만 — using과 with check 둘 다');
  ok(/alter policy people_insert[\s\S]*?not is_pastor[\s\S]*?profile_id is null/.test(sql),
    '비관리자의 명단 추가는 교역자·계정 연결 없이만(0069 트리거가 계정 권한을 올린다)');

  // ⑤ 알림 — 보낸 사람 이름 트리거 · 딥링크 CHECK
  ok(/create trigger trg_notifications_actor_name before insert on public\.notifications/.test(sql),
    '알림 INSERT에 actor_name 트리거가 있다');
  ok(/if auth\.uid\(\) is null then\s+return new;[\s\S]*?where p\.id = public\.effective_uid\(\)/.test(sql),
    '서버 배치는 그대로, 로그인 문맥은 effective_uid의 표시 이름으로');
  ok(sql.includes("link like '/%' and link not like '//%' and link !~ '[\\s\\\\]'"),
    "딥링크 CHECK가 공백류·역슬래시를 막는다('/\\t/evil.com')");

  // ⑥ 함수 둘 · ⑦ storage
  for (const f of ['recount_card', 'fix_profile_team_id']) {
    ok(new RegExp(`revoke execute on function public\\.${f}\\(uuid\\) from public, anon, authenticated;`).test(sql),
      `${f}의 바깥 실행 권한을 public·anon·authenticated에서 걷는다`);
  }
  for (const p of ['attachments_select_authenticated', 'attachments_insert_authenticated', 'content_images_insert_own']) {
    ok(new RegExp(`alter policy "${p}" on storage\\.objects[\\s\\S]*?public\\.is_approved\\(\\)\\s*\\);`).test(sql),
      `storage 정책 ${p}에 승인 게이트가 있다`);
  }

  // 정책 수를 늘리지 않는다 · 되돌리는 SQL
  ok(!/create policy|drop policy/i.test(sql), '0071은 정책을 만들거나 지우지 않는다 — alter만(§6-31-a)');
  ok(!/projects_delete/.test(sql), 'projects_delete(0021 전원 삭제)는 사용자 결정이라 건드리지 않는다');
  for (const line of ['drop trigger if exists trg_profiles_guard on public.profiles;',
    'drop function if exists public.guard_author_column();',
    'alter policy people_insert on public.people with check (public.is_admin() or public.can_check_all_attendance() or public.leads_any_sun());',
    'grant execute on function public.recount_card(uuid) to public, anon, authenticated;']) {
    ok(m71.includes(`--   ${line}`), `0071의 되돌리는 SQL에 '${line.slice(0, 40)}…'이 있다`);
  }
  console.log(`PASS  0071 보안 조이기의 모양 ${n}가지`);
}

// ── pdf.js 6.3이 옛 브라우저에서 모듈째 죽지 않는다 (services/pdfPolyfill.js) ──
// 6.3은 모듈 맨 위에서 `Iterator.prototype.join`을 본다 — `Iterator` 전역이 없으면(사파리 18.4 ·
// 크롬 122 미만) ReferenceError로 PDF가 통째로 안 열린다. 노드에는 다 있으므로 **새 전역 칸(vm)을
// 만들어 그 셋을 지운 뒤** 폴리필을 돌리고, 설치된 pdf.mjs의 그 첫 줄과 pdf.js가 실제로 쓰는
// 모양(`keys().filter().toArray()` 등)을 그대로 부른다.
// 되돌리기 검사: 폴리필의 `globalThis.Iterator` 세우기를 지우면 첫 단정이 ReferenceError로 깨진다.
{
  const vm = await import('node:vm');
  const poly = readFileSync(new URL('../src/services/pdfPolyfill.js', import.meta.url), 'utf8');
  const pdfSrc = readFileSync(new URL('../node_modules/pdfjs-dist/build/pdf.mjs', import.meta.url), 'utf8');
  const head = pdfSrc.slice(pdfSrc.indexOf('if (typeof Iterator.prototype.join'), pdfSrc.indexOf('\n}\n', pdfSrc.indexOf('if (typeof Iterator.prototype.join')) + 3);
  assert.ok(head.includes('Iterator.prototype.join = function'), '설치된 pdf.mjs에서 Iterator 첫 줄을 못 찾았다(판이 바뀌었나?)');
  const old = vm.createContext({});
  vm.runInContext(`
    const P = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
    for (const k of ['map', 'filter', 'some', 'every', 'find', 'forEach', 'toArray', 'reduce', 'take', 'drop', 'flatMap']) delete P[k];
    delete globalThis.Iterator; delete Promise.try; delete Math.sumPrecise;`, old);
  assert.strictEqual(vm.runInContext('typeof Iterator', old), 'undefined', '옛 브라우저 흉내가 안 됐다');
  vm.runInContext(poly, old);
  vm.runInContext(head, old);                     // pdf.js 6.3의 모듈 첫 줄 — 여기서 죽으면 PDF가 통째로 안 열린다
  const r = vm.runInContext(`({
    filt: new Set([3, 1, 2]).keys().filter(x => x > 1).toArray(),
    find: new Map([['a', 1], ['b', 2]]).keys().find(k => k === 'b'),
    some: new Map([['a', { n: 1 }]]).values().some(v => v.n === 1),
    join: new Map([['x', 'A'], ['y', 'B']]).values().join(''),
    map: [1, 2].values().map((v, i) => v * 10 + i).toArray(),
    each: (() => { let s = 0; [1, 2, 3].values().forEach(v => { s += v; }); return s; })(),
    every: [2, 4].values().every(v => v % 2 === 0),
    sum: Math.sumPrecise([0.5, 1.5, 2]),
    iterIsProto: Iterator.prototype === Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())),
  })`, old);
  assert.deepStrictEqual([...r.filt], [3, 2], 'Set.keys().filter().toArray() (pdf.js 텍스트 레이어)');
  assert.strictEqual(r.find, 'b', 'Map.keys().find() (pdf.js 범위 읽기)');
  assert.strictEqual(r.some, true, 'Map.values().some() (편집기 · 폼)');
  assert.strictEqual(r.join, 'AB', 'values().join() (XFA)');
  assert.deepStrictEqual([...r.map], [10, 21], 'map은 순번을 둘째 인자로 준다');
  assert.strictEqual(r.each, 6);
  assert.strictEqual(r.every, true);
  assert.strictEqual(r.sum, 4, 'Math.sumPrecise');
  assert.strictEqual(r.iterIsProto, true, 'Iterator.prototype이 내장 이터레이터들이 물려받는 그 객체가 아니다');
  const tried = await vm.runInContext(`Promise.try(() => { throw new Error('동기 오류'); }).then(() => 'ok', e => e.message)`, old);
  assert.strictEqual(tried, '동기 오류', 'Promise.try가 동기 오류를 거절로 바꾸지 않는다(워커 메시지 처리)');
  assert.strictEqual(await vm.runInContext(`Promise.try((a, b) => a + b, 2, 3)`, old), 5, 'Promise.try가 인자를 넘기지 않는다');

  // 이미 있는 브라우저(노드 그대로)에서는 아무것도 바꾸지 않는다 — 네이티브가 언제나 더 빠르다
  const now = vm.createContext({});
  const before = vm.runInContext('[Iterator, Iterator.prototype.map, Iterator.prototype.toArray, Promise.try, Math.sumPrecise]', now);
  vm.runInContext(poly, now);
  const after = vm.runInContext('[Iterator, Iterator.prototype.map, Iterator.prototype.toArray, Promise.try, Math.sumPrecise]', now);
  before.forEach((f, i) => { if (typeof f === 'function') assert.strictEqual(after[i], f, `네이티브를 덮었다(${i})`); });
  console.log('PASS  pdf.js 6.3 옛 브라우저 폴리필 15가지');
}

// ── 홈·모임은 주보를 가볍게 읽는다 (worship.fetchServices columns · fetchAttendanceCounts since · 2026-09-24) ──
// 홈·모임은 '출석이 든 가장 최근 주일' 하나를 찾으려고 출석 표 두 개를 통째로 읽고, 주보는
// 찬양·광고·임사자 jsonb까지 받았다. 이제 출석은 최근 여덟 주 주보 것만, 주보는 그 화면이 읽는
// 칸만이다. **칸을 빼면 그 칸을 읽는 소비자가 조용히 빈 값을 본다** — 그래서 소비자가 읽는 칸이
// 전부 들어 있는지를 소스에서 맞대 본다. 예배 목록은 지난 주보마다 '출석 N명'이라 전체를 센다.
// 되돌리기 검사: GUIDE_SERVICE_COLS에서 songs를 빼면 '가이드 프롬프트가 읽는 칸'이, 게스트
// 갈래의 since 거르기를 지우면 '게스트도 같은 창'이 깨진다.
{
  const raw = readFileSync(new URL('../src/services/worship.js', import.meta.url), 'utf8');
  const seed = {
    services: [{ id: 'old', service_date: '2026-06-01' }, { id: 'new', service_date: '2026-09-20' }],
    attendance: [{ service_id: 'old' }, { service_id: 'new' }, { service_id: 'new' }],
    attendance_guests: [{ service_id: 'old' }, { service_id: 'new' }],
  };
  const src = 'const supabase = null; const myUid = () => null;\n' + raw
    .replace(/^import \{[^}]*\} from '\.\/(supabaseClient|cloud|image)\.js';\s*$/gm, '')
    // localDate·byName은 2026-09-24부터 utils·people에서 온다(한 벌로 모았다)
    .replace(/^import .*from '\.\.\/utils\.js';\s*$/gm, 'const generateId = () => "id"; const localDate = (d) => new Date(d).toLocaleDateString("sv-SE");')
    .replace(/^import .*from '\.\/people\.js';\s*$/gm,
      `const guestStore = () => ({ all: () => ({}), rows: (t) => (${JSON.stringify(seed)})[t] || [], set: () => {} }); const byName = (a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "ko");`);
  const dir = mkdtempSync(join(tmpdir(), 'b2svc-'));
  writeFileSync(join(dir, 'titleText.js'), readFileSync(new URL('../src/services/titleText.js', import.meta.url), 'utf8'));
  const wf = join(dir, 'worship.mjs');
  writeFileSync(wf, src);
  const W = await import(pathToFileURL(wf).href);

  // ① 창 — 오늘(KST 날짜 글자)에서 56일 전. 달·해를 넘어도 글자로만 셈한다
  assert.strictEqual(W.COUNT_WINDOW_DAYS, 56, '여덟 주');
  assert.strictEqual(W.countsSince('2026-09-24'), '2026-07-30');
  assert.strictEqual(W.countsSince('2026-01-10'), '2025-11-15', '해를 넘는다');
  assert.strictEqual(W.countsSince('2024-03-01', 1), '2024-02-29', '윤년');
  assert.strictEqual(W.countsSince('nope'), '', '못 읽는 날짜면 빈 글자 — 그러면 전체를 센다');

  // ② 게스트 갈래도 같은 창으로 센다(명단 출석 + 손님)
  assert.deepStrictEqual(await W.fetchAttendanceCounts(), { old: 2, new: 3 }, 'since 없으면 전체');
  assert.deepStrictEqual(await W.fetchAttendanceCounts({ since: '2026-07-30' }), { new: 3 },
    'since가 있으면 그 날짜 이후 주보만 — 게스트도 같은 창');

  // ③ 클라우드 갈래 — 주보 날짜로 붙여 거른다(왕복 하나 · 두 표 모두)
  assert.ok(/select\('service_id, services!inner\(service_date\)'\)\.gte\('services\.service_date', since\)/.test(raw),
    '출석 수의 창은 services!inner로 붙여 주보 날짜로 거른다');
  assert.ok(/count\('attendance'\), count\('attendance_guests'\)/.test(raw), '명단 출석과 손님 둘 다 같은 창');

  // ④ 배선 — 홈·모임은 창과 가벼운 열, 예배 목록은 전체
  const view = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const home = view('../src/views/homeView.jsx');
  const groups = view('../src/views/groupsView.jsx');
  const worshipV = view('../src/views/worshipView.jsx');
  assert.ok(/fetchServices\(\{ columns: HOME_SERVICE_COLS \}\)/.test(home)
    && /fetchAttendanceCounts\(\{ since: countsSince\(day\) \}\)/.test(home), '홈은 가벼운 열 + 여덟 주');
  assert.ok(/fetchServices\(\{ columns: GUIDE_SERVICE_COLS \}\)/.test(groups)
    && /fetchAttendanceCounts\(\{ since: countsSince\(\) \}\)/.test(groups), '모임은 가이드 열 + 여덟 주');
  assert.ok(/fetchServices\(\), fetchAttendanceCounts\(\)\]/.test(worshipV),
    '예배 목록은 전체 열·전체 출석 — 지난 주보마다 출석 N명 · 최근 곡 · 임사자 물려받기');

  // ⑤ 소비자가 읽는 칸이 전부 들어 있나
  const cols = (s) => new Set(s.split(',').map(c => c.trim()));
  const homeCols = cols(W.HOME_SERVICE_COLS);
  const guideCols = cols(W.GUIDE_SERVICE_COLS);
  // 홈 카드가 읽는 칸(church.service.X) + 고르는 함수 셋(pickService·pastSunday·attendanceSunday)이 보는 칸
  const cardReads = [...new Set([...home.matchAll(/church\.service\.(\w+)/g)].map(m => m[1]))];
  assert.ok(cardReads.length >= 4, `홈 카드가 읽는 칸을 찾았다(${cardReads})`);
  for (const c of [...cardReads, 'id', 'kind', 'status', 'service_date']) {
    assert.ok(homeCols.has(c), `홈 주보 열에 ${c}가 있다`);
  }
  // 모임은 홈 칸 전부 + 가이드 프롬프트가 읽는 칸(sunGuide.songLine · buildGuidePrompt · generateGuide)
  // 작업 사본이 CRLF일 수 있다(autocrlf) — 함수 끝('\n}\n')을 찾기 전에 줄끝을 맞춘다
  const guideSrc = view('../src/services/sunGuide.js').replace(/\r\n/g, '\n');
  const body = (sig) => {
    const at = guideSrc.indexOf(sig);
    return at < 0 ? '' : guideSrc.slice(at, guideSrc.indexOf('\n}\n', at));
  };
  const promptSrc = ['export function songLine(', 'export function buildGuidePrompt(', 'export async function generateGuide(']
    .map(body).join('\n');
  const guideReads = [...new Set([...promptSrc.matchAll(/\b(?:s|service)\??\.(\w+)/g)].map(m => m[1]))];
  assert.ok(guideReads.includes('songs') && guideReads.includes('praise_leader') && guideReads.includes('passage_ref'),
    `가이드가 읽는 칸을 찾았다(${guideReads})`);
  for (const c of guideReads) assert.ok(guideCols.has(c), `모임 주보 열에 가이드 프롬프트가 읽는 ${c}가 있다`);
  for (const c of homeCols) assert.ok(guideCols.has(c), `모임 열은 홈 열을 다 담는다(${c})`);
  console.log('PASS  홈·모임 주보 가볍게 읽기 14가지');
}

// ── 워크스페이스 실시간을 덜 읽는다 — 카드 모으기 · 활동 한 줄 얹기 (2026-09-24) ──────────
// 카드 저장 한 번이 cards 이벤트를 여러 건 만들어 같은 카드를 서너 번 읽었고(늦은 옛 응답이 새
// 값을 덮는 경합까지), 활동 INSERT 한 건마다 피드 30줄을 통째로 다시 읽었다. 이제 카드는 200ms
// 모아 id마다 한 번, 활동 INSERT는 payload.new를 피드 앞에 얹는다(쿼리 0개).
// 게스트 모드는 이 길을 안 탄다(구독이 없다) — 그래서 여기서 순수 조각과 배선을 본다.
// 되돌리기 검사: prependActivity의 id 거르기를 지우면 '같은 id는 한 번'이, createIdBatcher의
// `if (!timer)`를 지우고 매번 타이머를 걸면 '첫 id부터 잰다'가 깨진다.
{
  // ① 활동 한 줄 얹기 — 스토어의 순수 함수(1665줄 블록과 같은 방식으로 import를 걷는다)
  const src = readFileSync(new URL('../src/store/workspaceStore.js', import.meta.url), 'utf8')
    .replace(/import \{ useSyncExternalStore \} from 'react';/, 'const useSyncExternalStore = () => {};')
    .replace(/import \{ isCloudEnabled \} from '\.\.\/services\/supabaseClient\.js';/,
      'const isCloudEnabled = () => false;')
    .replace("'../services/domain.js'", JSON.stringify(new URL('../src/services/domain.js', import.meta.url).href));
  const d = mkdtempSync(join(tmpdir(), 'b3store-'));
  const f = join(d, 'store.mjs');
  writeFileSync(f, src);
  globalThis.localStorage = { getItem: () => null };
  const S = await import(pathToFileURL(f).href);
  delete globalThis.localStorage;
  const row = (id, min) => ({ id, action: `a${id}`, at: `2026-09-24T01:${String(min).padStart(2, '0')}:00.000+00:00` });
  const feed = Array.from({ length: 30 }, (_, i) => row(`r${i}`, 59 - i));   // 최신이 앞
  const fresh = row('new', 59);
  const next = S.prependActivity(feed, { ...fresh, at: '2026-09-24T02:00:00.000+00:00' });
  assert.strictEqual(next[0].id, 'new', '새 줄이 맨 앞');
  assert.strictEqual(next.length, 30, '30줄을 넘지 않는다(서버 조회와 같은 상한)');
  assert.ok(!next.some(e => e.id === 'r29'), '가장 오래된 줄이 밀려난다');
  assert.notStrictEqual(next, feed, '새 배열이다(스토어가 바뀐 것을 안다)');
  assert.strictEqual(feed.length, 30, '원래 피드는 그대로');
  const twice = S.prependActivity(next, { ...next[0], action: '고친 값' });
  assert.strictEqual(twice.filter(e => e.id === 'new').length, 1, '같은 id는 한 번만');
  assert.strictEqual(twice[0].action, '고친 값', '겹치면 새 값이 이긴다');
  // 늦게 도착한 옛 이벤트는 제 시각 자리에 선다(서버 순서 = created_at 내림차순)
  const late = S.prependActivity([row('b', 30), row('a', 10)], row('mid', 20));
  assert.deepStrictEqual(late.map(e => e.id), ['b', 'mid', 'a'], '시각 순서로 끼어든다');
  assert.strictEqual(S.prependActivity(feed, null), feed, '줄이 없으면 그대로');
  assert.strictEqual(S.ACTIVITY_FEED_LIMIT, 30);
  assert.ok(/listRecentActivity\(limit = 30\)/.test(readFileSync(new URL('../src/services/cloud.js', import.meta.url), 'utf8')),
    '서버 조회의 상한과 같은 값');
  // 액션이 되돌리기 기록에 쌓이지 않는다(SET_ACTIVITY_FEED와 같은 이유 — 내 조작이 아니다)
  S.store.dispatch({ type: 'LOAD_STATE', payload: { currentUser: {}, members: [], activityFeed: [row('x', 1)],
    projects: { byId: {}, allIds: [] }, tasks: { byId: {}, allIds: [] } } });
  S.store.dispatch({ type: 'PREPEND_ACTIVITY', payload: row('y', 2) });
  assert.deepStrictEqual(S.store.getState().activityFeed.map(e => e.id), ['y', 'x'], 'PREPEND_ACTIVITY가 앞에 얹는다');
  assert.strictEqual(S.store.canUndo(), false, 'PREPEND_ACTIVITY는 past에 쌓이지 않는다');

  // ② 카드 id 모으기 — 창은 첫 id부터, id마다 한 번
  const { createIdBatcher } = await import(new URL('../src/services/realtimeBatch.js', import.meta.url).href);
  const flushed = [];
  const b = createIdBatcher((ids) => flushed.push(ids), 20);
  b.add('c1'); b.add('c2'); b.add('c1'); b.add(null);
  assert.deepStrictEqual(flushed, [], '창이 닫히기 전에는 흘리지 않는다');
  await new Promise(r => setTimeout(r, 12));
  b.add('c3');                                  // 창 안 — 타이머를 다시 걸지 않는다
  await new Promise(r => setTimeout(r, 14));
  assert.deepStrictEqual(flushed, [['c1', 'c2', 'c3']], '첫 id부터 잰 창에 id마다 한 번');
  b.add('c9'); b.cancel();
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(flushed.length, 1, '걷으면 모아 둔 것을 버린다');

  // ③ 배선 — 라우팅과 App
  const sync = readFileSync(new URL('../src/services/cloudSync.js', import.meta.url), 'utf8');
  assert.ok(/eventType === 'INSERT' && row\.id \? activityFeedToApp\(row\) : null;\s*onActivityFeed\?\.\(entry\)/.test(sync),
    'activity INSERT는 피드 줄 모양으로 넘기고, 그 밖은 null(다시 읽기)');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(/onActivityFeed: \(entry\) => \{\s*if \(entry\) \{ store\.dispatch\(\{ type: 'PREPEND_ACTIVITY', payload: entry \}\); return; \}/.test(app),
    '새 기록은 읽지 않고 얹는다');
  assert.ok(/loadActivityFeed\(\)[\s\S]{0,120}SET_ACTIVITY_FEED/.test(app), '지움·고침은 예전처럼 다시 읽는다');
  assert.ok(/createIdBatcher\(\(ids\) => \{\s*if \(isEditingRef\.current\) \{ ids\.forEach\(id => pendingCardsRef\.current\.add\(id\)\); return; \}\s*ids\.forEach\(id => syncCard\(id\)\);\s*\}, 200\)/.test(app),
    '카드는 200ms 모아 id마다 한 번 · 모으는 사이 편집이 시작되면 편집 뒤로 미룬다');
  assert.ok(/onCard: \(id\) => \{[\s\S]{0,160}cards\.add\(id\);/.test(app), 'onCard는 곧장 읽지 않고 모은다');
  assert.ok(/cards\.cancel\(\); unsub\(\);/.test(app), '구독을 걷을 때 모아 둔 것도 걷는다');
  console.log('PASS  워크스페이스 실시간 덜 읽기 22가지');
}

// ── 첨부 발췌가 글인가 · HTML은 글만 (services/textQuality.js · fileText.js · 2026-09-24) ──
// 악보·콘티 PDF에서 pdf.js가 뽑는 것은 화음 글자와 기호 부스러기다 — 그게 발췌로 들어가면 AI
// 요약이 읽을 것 없는 기호 2천 자를 싣는다. HTML 첨부는 원문이 그대로 들어가 태그가 자리를
// 먼저 채웠다. 앱은 **PDF에만** 글 판정을 걸고, 한글 수는 보지 않는다(영어 문서를 비우면 안 된다).
// 되돌리기 검사: WEIRD에서 굽은 따옴표를 빼면 '인쇄물 따옴표·글머리표'가, fileText에서
// looksLikeText 거르기를 지우면 'PDF에만 건다'가 깨진다.
{
  const T = await import(new URL('../src/services/textQuality.js', import.meta.url).href);
  const ko = '하나님이 그 아이의 소리를 들으셨나니 하나님의 사자가 하늘에서부터 하갈을 불러 가라사대 하갈아 무슨 일이냐 두려워 말라.';
  assert.strictEqual(T.looksLikeText(ko), true, '한국어 본문은 글이다');
  assert.strictEqual(T.looksLikeText('The Lord is my shepherd; I shall not want. He makes me lie down in green pastures.'), true,
    '영어 문서도 글이다 — 앱은 한글 수를 보지 않는다');
  assert.strictEqual(T.looksLikeText('“은혜” — 2부 순서 • 찬양 • 기도 • 말씀 ‘아멘’ 「광고」 <공지> 10:30~12:00'), true,
    '워드 PDF의 인쇄물 따옴표·줄표·글머리표는 기호 부스러기가 아니다');
  const debris = 'G D/F# ¤ Em ☆ C □ ⇌ 十 ♩ ♪ ¤ ☆ □ ⇌ 十 Am7 ¤ ☆ □ ♩ ♪ ¤ ☆ □';
  assert.strictEqual(T.looksLikeText(debris), false, '악보 부스러기는 글이 아니다');
  assert.strictEqual(T.looksLikeText('����� ��� ������ �� ���'), false, '깨진 글자(U+FFFD)는 글이 아니다');
  assert.strictEqual(T.looksLikeText(''), false, '빈 글은 글이 아니다');
  assert.strictEqual(T.looksLikeText('   \n '), false);
  assert.strictEqual(T.looksLikeText('A-1'), true, '짧아도 글이면 글이다(앱은 글자 수 하한이 없다)');
  // 백필 스크립트가 쓰는 더 엄한 문턱(사진·스캔 PDF를 Gemini로 넘길지)
  assert.strictEqual(T.looksLikeText('Am7 G C D Em F G Am C D G Em', { minHangul: 30 }), false, '백필 문턱: 한글 30자');
  assert.strictEqual(T.looksLikeText(ko, { minLength: 20, minHangul: 30 }), true);
  const st = T.textStats('가나 다 ¤');
  assert.deepStrictEqual([st.length, st.readable, st.weird, st.hangul], [4, 3, 1, 3], '공백을 뺀 몸통으로 센다');
  // 경계값 — 60%·5%
  assert.strictEqual(T.looksLikeText('가'.repeat(19) + '¤'), true, '기호 5%는 글');
  assert.strictEqual(T.looksLikeText('가'.repeat(18) + '¤¤'), false, '기호 10%는 글이 아니다');
  assert.strictEqual(T.looksLikeText('가'.repeat(6) + '....'), true, '읽히는 글자 60%는 글');
  assert.strictEqual(T.looksLikeText('가'.repeat(5) + '.....'), false, '읽히는 글자 50%는 글이 아니다');

  // HTML → 글
  const html = `<!doctype html><html><head><title>t</title><style>body{color:red}</style>
    <script>alert("x<y")</script></head><body><!-- 주석 --><h1>주보</h1><p>하나&nbsp;&amp;&#32;둘 &lt;셋&gt; &#xAC00;</p>
    <noscript>켜 주세요</noscript><ul><li>찬양</li><li>기도</li></ul><svg><text>그림</text></svg></body></html>`;
  const got = T.htmlToText(html);
  assert.strictEqual(got, '주보\n하나 & 둘 <셋> 가\n찬양\n기도', `태그·스타일·스크립트를 걷고 글만(${JSON.stringify(got)})`);
  assert.ok(!/alert|color:red|주석|켜 주세요|그림/.test(got), '스크립트·스타일·주석·noscript·svg 내용은 버린다');
  assert.strictEqual(T.htmlToText(''), '');

  // 배선 — fileText
  const ft = readFileSync(new URL('../src/services/fileText.js', import.meta.url), 'utf8');
  const firstImport = ft.search(/^import /m);
  assert.ok(firstImport >= 0 && ft.slice(firstImport).startsWith("import './pdfPolyfill.js';"),
    '폴리필이 맨 먼저 실린다(pdf.js보다 앞)');
  assert.ok(/await import\('\.\/pdfWorkerEntry\.js\?worker&url'\)/.test(ft), 'PdfView와 같은 워커 껍데기');
  assert.ok(!/pdf\.worker\.min\.mjs/.test(ft), '폴리필 없는 워커를 따로 가리키지 않는다(전역 workerSrc를 덮는다)');
  assert.ok(/getDocument\(\{ \.\.\.PDF_TEXT_ASSETS,/.test(ft) && /cMapUrl: '\/pdfjs\/cmaps\/'/.test(ft),
    '한글 CID 글꼴을 풀 cmaps를 싣는다');
  assert.strictEqual((ft.match(/looksLikeText\(/g) || []).length, 1, '글 판정은 한 자리(PDF)에만');
  assert.ok(/return looksLikeText\(text\) \? text : '';\s*\}/.test(ft), 'PDF에 글 판정을 건다');
  assert.ok(/HTML\.includes\(ext\) \|\| type === 'text\/html'\) \{\s*return htmlToText\(/.test(ft),
    'HTML은 태그를 걷는다(일반 텍스트보다 먼저 본다)');
  console.log('PASS  첨부 발췌 글 판정·HTML 25가지');
}

// ── 조건부로 뜨는 무거운 부품은 열 때만 받는다 (2026-09-24) ─────────────────────────────
// 미리보기 창(+PdfView) · 순모임 가이드 패널 · 선후관계 그래프 · 동아리 QR 창은 누르거나 자격이
// 있을 때만 뜨는데 첫 번들에 실려 있었다. **한 곳이라도 정적 import가 남으면 그 파일은 도로 첫
// 번들로 끌려 들어간다** — 그래서 모든 사용처를 본다. 가이드 패널은 React.lazy가 아니라 미리
// 받아 두고 딸린 섹션의 스켈레톤 한 덩이로 기다린다(Suspense 폴백이 두 번째 스켈레톤이 된다 —
// tests/groups '딸린 두 섹션의 스켈레톤은 하나다').
// 되돌리기 검사: attachments.jsx의 import를 정적으로 되돌리면 첫 단정이 깨진다.
{
  const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const all = ['modals/attachments.jsx', 'components/worshipDetail.jsx', 'components/groupsClub.jsx',
    'views/views.jsx', 'views/groupsView.jsx'];
  const lazyOf = { FilePreviewModal: 'FilePreviewModal.jsx', ClubQrModal: 'ClubQr.jsx', DepGraph: 'depgraph.jsx' };
  for (const p of all) {
    const s = src(p);
    for (const [name, file] of Object.entries(lazyOf)) {
      assert.ok(!new RegExp(`^import \\{[^}]*\\b${name}\\b[^}]*\\} from '[^']*${file.replace('.', '\\.')}';`, 'm').test(s),
        `${p}가 ${name}을 정적으로 import한다 — 첫 번들로 끌려 들어간다`);
    }
    assert.ok(!/^import [^;]*from '[^']*components\/sunGuide\.jsx';/m.test(s) && !/^import [^;]*from '\.\/sunGuide\.jsx';/m.test(s),
      `${p}가 가이드 패널을 정적으로 import한다`);
  }
  assert.ok(/const FilePreviewModal = lazy\(\(\) => import\('\.\.\/components\/FilePreviewModal\.jsx'\)/.test(src('modals/attachments.jsx')),
    '업무 첨부의 미리보기 창은 lazy');
  assert.ok(/const FilePreviewModal = lazy\(\(\) => import\('\.\/FilePreviewModal\.jsx'\)/.test(src('components/worshipDetail.jsx')),
    '송폼·큐시트의 미리보기 창은 lazy');
  assert.ok(/<Suspense fallback=\{null\}><ClubQrModal/.test(src('components/groupsClub.jsx')), 'QR 창은 lazy · 폴백 없음');
  assert.ok(/<Suspense fallback=\{null\}><DepGraph/.test(src('views/views.jsx')), '그래프는 lazy · 폴백 없음');
  const gv = src('views/groupsView.jsx');
  assert.ok(/import\('\.\.\/components\/sunGuide\.jsx'\)/.test(gv), '가이드 패널은 동적으로 받는다');
  assert.ok(/if \(!canViewGuide \|\| GuidePanel \|\| guideFailed\) return undefined;/.test(gv), '볼 자격이 있을 때만 받는다');
  assert.ok(/\{mineSettled && !guideWait \? \(/.test(gv), '받는 동안은 딸린 섹션 스켈레톤 한 덩이가 선다');
  console.log('PASS  무거운 부품은 열 때만 7가지');
}

// ── 방금 읽은 화면은 15초 안에 다시 읽지 않는다 · 날짜 열쇠 정리 (services/cache.js · 2026-09-24) ──
// 홈 → 예배 → 홈을 오가면 홈 카드 넷이 조회 14개를 그때마다 또 쏘았다. 이제 재마운트가 15초 안이고
// 클라우드면 캐시 값을 **새 값(stale:false)으로** 세우고 끝낸다 — stale로 두면 새로 읽은 한 벌을
// 기다리는 groupsView의 QR 딥링크 판정(bundleFresh)이 영영 멈춘다. 실시간 신호·쓰기 뒤의 dropCache와
// 계정 전환(setCacheScope)은 그 표시를 같이 지운다. 홈의 날짜 열쇠는 오늘 것만 남긴다.
// 되돌리기 검사: dropCache의 loadedAt 지우기를 빼면 '비우면 다시 읽는다'가, 건너뛸 때 stale:false를
// stale:true로 바꾸면 '새 값으로 세운다'가 깨진다.
{
  const raw = readFileSync(new URL('../src/services/cache.js', import.meta.url), 'utf8');
  const mk = (persist) => 'const setStorageRelief = () => {}; '
    + raw.replace(/^import[^\n]*\n/gm, '')
      .replace('const persist = () => !!supabase;', `const persist = () => ${persist};`);
  const dir = mkdtempSync(join(tmpdir(), 'b9cache-'));
  writeFileSync(join(dir, 'cloud.mjs'), mk('true'));
  writeFileSync(join(dir, 'guest.mjs'), mk('false'));
  const store = new Map();
  globalThis.localStorage = {
    get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const C = await import(pathToFileURL(join(dir, 'cloud.mjs')).href);
  const G = await import(pathToFileURL(join(dir, 'guest.mjs')).href);

  C.setCacheScope('u1');
  const t0 = 1_000_000;
  C.writeCache('home:qt:2026-09-24', { a: 1 });
  assert.strictEqual(C.cacheFresh('home:qt:2026-09-24', t0), false, '쓰기만 한 값은 "방금 읽은 값"이 아니다(읽기가 성공해야)');
  C.noteLoaded('home:qt:2026-09-24', t0);
  assert.strictEqual(C.FRESH_MS, 15000);
  assert.strictEqual(C.cacheFresh('home:qt:2026-09-24', t0 + 14_999), true, '15초 안이면 다시 읽지 않는다');
  assert.strictEqual(C.cacheFresh('home:qt:2026-09-24', t0 + 15_000), false, '15초가 지나면 읽는다');
  C.noteLoaded('home:qt:2026-09-24', t0);
  C.dropCache('home:qt');
  assert.strictEqual(C.cacheFresh('home:qt:2026-09-24', t0 + 1), false, '비우면(실시간·쓰기 뒤) 다시 읽는다');
  C.writeCache('home:qt:2026-09-24', { a: 2 });   // 비운 뒤 누가 손으로 써 넣어도 '방금 읽은 값'은 아니다
  assert.strictEqual(C.cacheFresh('home:qt:2026-09-24', t0 + 2), false, '비우면 "방금 읽었다" 표시도 같이 지운다');
  C.writeCache('home:sun:2026', { b: 1 }); C.noteLoaded('home:sun:2026', t0);
  C.setCacheScope('u2');
  C.writeCache('home:sun:2026', { b: 2 });
  assert.strictEqual(C.cacheFresh('home:sun:2026', t0 + 1), false, '계정을 바꾸면 표시도 지운다');
  G.writeCache('x', 1); G.noteLoaded('x', t0);
  assert.strictEqual(G.cacheFresh('x', t0 + 1), false, '게스트는 언제나 다시 읽는다(검사 스위트가 시드를 바꾼다)');

  // 날짜 열쇠 정리 — 오늘 것만 남긴다(이웃 갈래는 그대로)
  C.writeCache('home:qt:2026-09-22', 1); C.writeCache('home:qt:2026-09-23', 2); C.writeCache('home:qt:2026-09-24', 3);
  C.writeCache('home:services:2026-09-23', 4);
  C.noteLoaded('home:qt:2026-09-23', t0);
  C.pruneCache('home:qt:', 'home:qt:2026-09-24');
  const left = [...store.keys()].filter(k => k.startsWith('church_cache_v1:u2:home:')).sort();
  assert.deepStrictEqual(left, ['church_cache_v1:u2:home:qt:2026-09-24', 'church_cache_v1:u2:home:services:2026-09-23',
    'church_cache_v1:u2:home:sun:2026'], '어제·그제 QT 열쇠만 치운다');
  assert.strictEqual(C.readCache('home:qt:2026-09-23'), undefined, '메모리에서도 치운다');
  assert.deepStrictEqual(C.readCache('home:qt:2026-09-24'), 3, '오늘 것은 남는다');
  delete globalThis.localStorage;

  // 훅 배선(소스) — 건너뛰면 stale:false · 마운트/열쇠 바뀜에서만 · refresh는 언제나
  assert.ok(/const skip = \(!mounted\.current \|\| keyChanged\) && cacheFresh\(key\);/.test(raw),
    '건너뛰는 것은 마운트·열쇠가 바뀐 때뿐(deps만 바뀌면 loader가 달라졌으니 읽는다)');
  assert.ok(/if \(skip\) \{[\s\S]{0,200}setState\(s => \(s\.stale \|\| s\.loading \? \{ data: readCache\(key\), loading: false, stale: false, error: null \} : s\)\);\s*return;/.test(raw),
    '건너뛸 때는 캐시 값을 새 값(stale:false)으로 세운다');
  assert.ok(/writeCache\(k, v\);\s*noteLoaded\(k\);/.test(raw), '읽기가 성공해야 "방금 읽었다"가 선다');
  assert.ok(/const refresh = useCallback\(\(\) => run\(keyRef\.current\), \[run\]\);/.test(raw), 'refresh()는 언제나 읽는다');
  const home = readFileSync(new URL('../src/views/homeView.jsx', import.meta.url), 'utf8');
  assert.ok(/pruneCache\('home:qt:', `home:qt:\$\{day\}`\)/.test(home) && /pruneCache\('home:services:', `home:services:\$\{day\}`\)/.test(home),
    '홈은 날짜 열쇠 둘을 오늘 것만 남긴다');
  console.log('PASS  15초 재조회 생략·날짜 열쇠 정리 17가지');
}

// ── 순모임 가이드 굽기 열쇠는 글의 해시 (components/sunGuide.jsx · 2026-09-24) ─────────────
// 열쇠가 JSON 길이였을 때는 같은 글자 수로 고치면(오타 하나) 열쇠가 그대로라 **옛 그림이 나갔다**.
// 되돌리기 검사: 열쇠를 `.length`로 되돌리면 마지막 단정이 깨진다.
{
  const src = readFileSync(new URL('../src/components/sunGuide.jsx', import.meta.url), 'utf8');
  const fn = /const textHash = (\(str\) => \{[\s\S]*?\n\};)/.exec(src.replace(/\r\n/g, '\n'))?.[1];
  assert.ok(fn, 'textHash를 찾지 못했다');
  const textHash = (0, eval)(fn.slice(0, -1));
  const a = JSON.stringify({ points: [{ body: '하나님이 들으셨다' }] });
  const b = JSON.stringify({ points: [{ body: '하나님이 들으셨나' }] });   // 같은 길이, 한 글자만 다르다
  assert.strictEqual(a.length, b.length);
  assert.notStrictEqual(textHash(a), textHash(b), '같은 글자 수라도 글이 다르면 열쇠가 다르다');
  assert.strictEqual(textHash(a), textHash(String(a)), '같은 글이면 같은 열쇠');
  assert.ok(/key: `\$\{selectedId \|\| ''\}:\$\{guide \? textHash\(JSON\.stringify\(guide\)\) : 0\}`/.test(src),
    '굽기 열쇠가 글의 해시를 쓴다(길이가 아니라)');
  console.log('PASS  가이드 굽기 열쇠 4가지');
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
  const lay = readFileSync(new URL('../src/components/layout.jsx', import.meta.url), 'utf8');
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

// ── 성경 임베딩 뒷단 (0073 bible_vec · scripts/embed-bible.mjs · api/ai.js embed · 배치 E) ──────
// 절 쪽(스크립트)과 질문 쪽(api/ai.js)이 모델·차원·정규화를 한 벌로 써야 벡터끼리 견줄 수 있다 —
// 갈려도 오류 없이 엉뚱한 절만 나온다. 0073은 인덱스 없이 · 읽기만 승인된 사람 · RPC는 invoker.
// 되돌리기 검사: embedRows의 unitVec(v)를 v로 되돌리면 '맞춘 벡터를 넣는다'가, 0073에 create index를
// 더하면 '인덱스 없이'가, 정책의 is_approved()를 true로 바꾸면 '읽기 정책 하나'가 깨진다.
{
  const mig = readFileSync(new URL('../supabase/migrations/0073_bible_vec.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = mig.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');   // 주석(되돌리기 SQL)은 빼고 본다
  assert.ok(/create extension if not exists vector with schema extensions;/.test(body), '0073이 vector를 extensions 스키마에 두지 않는다');
  assert.ok(/vec\s+extensions\.halfvec\(768\) not null/.test(body), 'bible_vec.vec이 halfvec(768) not null이 아니다');
  assert.ok(/ref\s+text primary key/.test(body) && /body\s+text not null/.test(body), 'bible_vec의 ref·body 칸 모양이 다르다');
  assert.ok(!/create\s+(unique\s+)?index/i.test(body) && !/using\s+(hnsw|ivfflat)/i.test(body), '0073은 인덱스 없이다(전수 비교 · 무료 500MB)');
  assert.ok(/alter table public\.bible_vec enable row level security;/.test(body), 'bible_vec에 RLS가 없다');
  const pols = [...body.matchAll(/create policy (\w+) on public\.bible_vec\s+for (\w+) using \(([^;]*)\);/g)];
  assert.deepStrictEqual(pols.map(m => [m[2], m[3]]), [['select', 'public.is_approved()']], '읽기 정책 하나(승인된 사람)만 있어야 한다 — 쓰기는 서비스 키만');
  assert.ok(/revoke insert, update, delete, truncate on public\.bible_vec from anon, authenticated;/.test(body), '클라이언트 쓰기 권한을 빼지 않았다');
  assert.ok(/create or replace function public\.match_bible\(q extensions\.halfvec\(768\), k int default 30\)\nreturns table \(ref text, book text, chapter int, verse int, body text, score real\)\nlanguage sql stable security invoker\nset search_path = public, extensions, pg_temp/.test(body),
    'match_bible 서명·invoker·search_path가 다르다');
  assert.ok(/order by b\.vec <=> q/.test(body) && /\(1 - \(b\.vec <=> q\)\)::real as score/.test(body), 'match_bible이 코사인 거리로 세우지 않는다');
  assert.ok(/revoke execute on function public\.match_bible\(extensions\.halfvec, int\) from public, anon;/.test(body), 'anon이 match_bible을 부를 수 있다');
  assert.ok(/-- drop table if exists public\.bible_vec;/.test(mig), '0073 맨 아래에 되돌리는 SQL이 없다');

  const ai = await import(new URL('../api/ai.js', import.meta.url).href);
  const E = await import(new URL('../scripts/embed-bible.mjs', import.meta.url).href);
  assert.strictEqual(ai.EMBED_MODEL, 'gemini-embedding-001');
  assert.strictEqual(ai.EMBED_DIM, 768);
  assert.strictEqual(Number(/halfvec\((\d+)\) not null/.exec(body)[1]), ai.EMBED_DIM, '0073의 차원과 api/ai.js의 EMBED_DIM이 다르다');
  assert.strictEqual(E.TASK_TYPE, 'RETRIEVAL_DOCUMENT');
  assert.strictEqual(E.EMBED_BATCH, 100, 'batchEmbedContents 한 번의 상한은 100이다');
  // 정규화 — 단위 길이 · 방향 유지 · 0·NaN은 던진다
  assert.deepStrictEqual(ai.unitVec([3, 4]), [0.6, 0.8]);
  const u = ai.unitVec(Array.from({ length: 768 }, (_, i) => Math.sin(i) * 0.02));
  assert.ok(Math.abs(Math.hypot(...u) - 1) < 1e-9, 'unitVec이 단위 길이를 만들지 않는다');
  assert.throws(() => ai.unitVec([0, 0]), /길이가 0/);
  assert.throws(() => ai.unitVec([1, NaN]), /숫자가 아닌/);
  const es = readFileSync(new URL('../scripts/embed-bible.mjs', import.meta.url), 'utf8');
  assert.ok(/import \{ EMBED_MODEL, EMBED_DIM, unitVec \} from '\.\.\/api\/ai\.js';/.test(es), '스크립트가 모델·차원·정규화를 api/ai.js에서 가져오지 않는다(두 벌이 된다)');
  assert.ok(/return \{ raw: Math\.hypot\(\.\.\.v\), vec: unitVec\(v\) \};/.test(es), '스크립트가 맞춘 벡터를 넣지 않는다(768차원 출력은 정규화되어 오지 않는다)');
  assert.ok(/v\.length !== EMBED_DIM/.test(es), '스크립트가 차원을 확인하지 않는다');
  // 요청 모양 — 절 쪽 DOCUMENT · 질문 쪽 QUERY · 둘 다 768
  const [req] = E.docRequests([{ ref: '요한복음 3:16', body: '하나님이 세상을' }]);
  assert.deepStrictEqual(req, { model: 'models/gemini-embedding-001', content: { parts: [{ text: '요한복음 3:16 하나님이 세상을' }] },
    taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 });
  const q = ai.embedQueryPayload('가'.repeat(600));
  assert.strictEqual(q.taskType, 'RETRIEVAL_QUERY');
  assert.strictEqual(q.outputDimensionality, 768);
  assert.strictEqual(q.content.parts[0].text.length, ai.MAX_EMBED_QUERY, '질문을 500자로 자르지 않는다');
  // 절 목록 — 편집 표기 36절을 뺀 31,067절 · ref는 formatRef 모양이고 parseRef가 다시 읽는다
  const verses = E.loadVerses();
  assert.strictEqual(verses.length, 31067);
  assert.deepStrictEqual(verses[0], { book: 'gen', chapter: 1, verse: 1, ref: '창세기 1:1', body: '태초에 하나님이 천지를 창조하시니라' });
  assert.ok(!verses.some(v => E.PLACEHOLDER_RE.test(v.body)), '편집 표기뿐인 절이 들어갔다');
  assert.ok(verses.some(v => v.ref === '신명기 3:9'), '괄호로 감싼 진짜 본문(신 3:9)까지 뺐다');
  assert.strictEqual(new Set(verses.map(v => v.ref)).size, verses.length, 'ref가 겹친다(primary key)');
  const { parseRef } = await import(new URL('../src/services/bibleRef.js', import.meta.url).href);
  const books = JSON.parse(readFileSync(new URL('../public/bible/index.json', import.meta.url), 'utf8'));
  for (const v of E.spreadSample(verses, 50)) {
    const p = parseRef(v.ref, books);
    assert.deepStrictEqual([p?.bookId, p?.start.chapter, p?.start.verse], [v.book, v.chapter, v.verse], `parseRef가 ${v.ref}를 못 읽는다`);
  }
  assert.strictEqual(E.loadVerses({ book: 'jud' }).length, 25);
  assert.strictEqual(E.vecLiteral([0.1, -0.25]), '[0.100000,-0.250000]');
  console.log('PASS  성경 임베딩 뒷단(0073 모양 · 모델·차원·정규화 한 벌 · 절 목록) 35가지');
}

// ── 주보 편집 줄의 열쇠 (utils.stableRowKeys · 2026-09-24) ─────────────────────────────
// 줄에 id가 없어 key={i}였다 — 옮기기·지우기에서 한 줄의 상태가 옆 줄로 넘어갔다. 열쇠는
// 저장하지 않는다(jsonb 모양 그대로). 되돌리기 검사: 함수가 자리 번호를 돌려주게 바꾸면
// 옮기기·지우기 단정이 깨지고, ②(같은 자리 이어 쓰기)를 빼면 고치기 단정이 깨진다.
{
  const U = await import(new URL('../src/utils.js', import.meta.url).href);
  let n = 0; const mint = () => `n${++n}`;
  const a = { role: '대표기도', name: '김' }, b = { role: '광고', name: '이' }, c = { role: '헌금', name: '박' };
  const k0 = U.stableRowKeys([], [], [a, b, c], mint);
  assert.deepStrictEqual(k0, ['n1', 'n2', 'n3'], '처음에는 줄마다 새 열쇠');
  assert.deepStrictEqual(U.stableRowKeys([a, b, c], k0, [b, a, c], mint), ['n2', 'n1', 'n3'], '옮기면 열쇠가 줄을 따라간다');
  assert.deepStrictEqual(U.stableRowKeys([a, b, c], k0, [a, c], mint), ['n1', 'n3'], '지우면 남은 줄의 열쇠가 그대로다');
  const b2 = { ...b, name: '이수' };
  assert.deepStrictEqual(U.stableRowKeys([a, b, c], k0, [a, b2, c], mint), ['n1', 'n2', 'n3'],
    '그 자리에서 고친 줄(새 객체)은 열쇠를 이어 쓴다 — 칠 때마다 칸이 새로 마운트되지 않게');
  const d = { role: '', name: '' };
  const kAdd = U.stableRowKeys([a, b, c], k0, [a, b, c, d], mint);
  assert.ok(kAdd.slice(0, 3).join() === 'n1,n2,n3' && !k0.includes(kAdd[3]), '더한 줄은 새 열쇠');
  const fresh = [{ ...a }, { ...b }, { ...c }];
  assert.deepStrictEqual(U.stableRowKeys([a, b, c], k0, fresh, mint), ['n1', 'n2', 'n3'], '통째로 다시 읽으면 자리대로 잇는다');
  const twice = U.stableRowKeys([a, b], ['x', 'y'], [a, a], mint);
  assert.ok(twice[0] === 'x' && twice[1] !== 'x' && new Set(twice).size === 2, '한 열쇠를 두 줄에 주지 않는다');
  console.log('PASS  주보 편집 줄 열쇠 7가지');
}

// ── 업무·댓글·첨부 임베딩 뒷단 (0074 doc_vec · api/_docsync.js · scripts/embed-docs.mjs · 배치 E4) ──
// 0074는 원본 FK 셋 중 정확히 하나 · cascade · (kind, source_id, chunk) 유일 · 벡터 인덱스 없음 ·
// 읽기만 승인된 사람 · RPC는 invoker. 동기화의 열쇠는 **임베딩한 글의 해시**다(updated_at 아님).
// 되돌리기 검사: chunkText의 `<= max`를 `<= max + 500`으로 바꾸면 '조각은 max 이하'가, buildDocs의
// service_id 거르기를 지우면 '주보 첨부는 넣지 않는다'가, 0074에 create index를 더하면 '인덱스 없이'가,
// 정책의 is_approved()를 true로 바꾸면 '읽기 정책 하나'가 깨진다.
{
  const mig = readFileSync(new URL('../supabase/migrations/0074_doc_vec.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = mig.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  for (const [col, tbl] of [['card_id', 'cards'], ['comment_id', 'comments'], ['file_id', 'files']]) {
    assert.ok(new RegExp(`${col}\\s+uuid references public\\.${tbl}\\(id\\) on delete cascade,`).test(body), `doc_vec.${col}가 ${tbl}를 cascade로 잇지 않는다(지운 원본의 벡터가 남는다)`);
  }
  assert.ok(/kind\s+text not null check \(kind in \('card', 'comment', 'file'\)\)/.test(body), 'doc_vec.kind 목록이 다르다');
  assert.ok(/source_id\s+uuid generated always as \(coalesce\(card_id, comment_id, file_id\)\) stored/.test(body), 'source_id 생성 칸이 없다');
  assert.ok(/num_nonnulls\(card_id, comment_id, file_id\) = 1/.test(body), '원본이 정확히 하나라는 제약이 없다');
  for (const k of ['card', 'comment', 'file']) assert.ok(new RegExp(`kind <> '${k}'\\s+or ${k}_id\\s+is not null`).test(body), `kind='${k}'가 ${k}_id를 가리킨다는 제약이 없다`);
  assert.ok(/constraint doc_vec_source_chunk unique \(kind, source_id, chunk\)/.test(body), '(kind, source_id, chunk) 유일 제약이 없다 — upsert 열쇠');
  assert.ok(/vec\s+extensions\.halfvec\(768\) not null/.test(body) && /body_hash\s+text not null/.test(body), 'vec·body_hash 칸 모양이 다르다');
  assert.ok(!/create\s+(unique\s+)?index/i.test(body) && !/using\s+(hnsw|ivfflat)/i.test(body), '0074는 벡터 인덱스 없이다(전수 비교 · 무료 500MB)');
  assert.ok(/alter table public\.doc_vec enable row level security;/.test(body), 'doc_vec에 RLS가 없다');
  const pols = [...body.matchAll(/create policy (\w+) on public\.doc_vec\s+for (\w+) using \(([^;]*)\);/g)];
  assert.deepStrictEqual(pols.map(m => [m[2], m[3]]), [['select', 'public.is_approved()']], '읽기 정책 하나(승인된 사람)만 있어야 한다 — 쓰기는 서버 키만');
  assert.ok(/revoke insert, update, delete, truncate on public\.doc_vec from anon, authenticated;/.test(body), '클라이언트 쓰기 권한을 빼지 않았다');
  assert.ok(!/alter publication/i.test(body), 'doc_vec을 실시간 발행에 넣었다');
  assert.ok(/create or replace function public\.match_docs\(q extensions\.halfvec\(768\), k int default 20, kinds text\[\] default null\)\nreturns table \(kind text, card_id uuid, comment_id uuid, file_id uuid, project_id uuid, chunk int, body text, score real\)\nlanguage sql stable security invoker\nset search_path = public, extensions, pg_temp/.test(body),
    'match_docs 서명·invoker·search_path가 다르다');
  assert.ok(/order by d\.vec <=> q/.test(body) && /\(1 - \(d\.vec <=> q\)\)::real as score/.test(body), 'match_docs가 코사인 거리로 세우지 않는다');
  assert.ok(/coalesce\(t\.card_id, c\.card_id, f\.card_id\)/.test(body), '댓글·첨부 조각에 그 업무 id를 붙이지 않는다');
  assert.ok(/revoke execute on function public\.match_docs\(extensions\.halfvec, int, text\[\]\) from public, anon;/.test(body), 'anon이 match_docs를 부를 수 있다');
  assert.ok(/-- drop table if exists public\.doc_vec;/.test(mig) && /-- drop function if exists public\.match_docs/.test(mig), '0074 맨 아래에 되돌리는 SQL이 없다');

  const ai = await import(new URL('../api/ai.js', import.meta.url).href);
  const D = await import(new URL('../api/_docsync.js', import.meta.url).href);
  assert.strictEqual(Number(/halfvec\((\d+)\) not null/.exec(body)[1]), ai.EMBED_DIM, '0074의 차원과 api/ai.js의 EMBED_DIM이 다르다');
  const ds = readFileSync(new URL('../api/_docsync.js', import.meta.url), 'utf8');
  assert.ok(/import \{ EMBED_MODEL, EMBED_DIM, unitVec \} from '\.\/ai\.js';/.test(ds), '_docsync가 모델·차원·정규화를 api/ai.js에서 가져오지 않는다(두 벌이 된다)');
  assert.ok(/return unitVec\(v\);/.test(ds) && /v\.length !== EMBED_DIM/.test(ds), '_docsync가 차원 확인·단위 길이 맞추기를 안 한다');
  assert.ok(/from '\.\.\/api\/_docsync\.js'/.test(readFileSync(new URL('../scripts/embed-docs.mjs', import.meta.url), 'utf8')), '스크립트가 크론과 같은 동기화(_docsync)를 쓰지 않는다');
  assert.deepStrictEqual(D.docRequests(['가']), [{ model: 'models/gemini-embedding-001', content: { parts: [{ text: '가' }] }, taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 }]);

  // 해시 — 임베딩한 글의 sha256
  assert.strictEqual(D.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  // 조각 — 짧으면 그대로 · 비면 없음 · 길면 max 이하로 문단 경계 · 앞 조각 끝이 다음 조각 앞에 겹친다
  assert.deepStrictEqual(D.chunkText('  짧은 글  '), ['짧은 글']);
  assert.deepStrictEqual(D.chunkText(''), []);
  const paras = Array.from({ length: 14 }, (_, i) => `## 문단 ${i}\n- 할 일 ${i}: ${'준비 '.repeat(30 + i * 4)}끝${i}`);
  const long = paras.join('\n\n');
  const ch = D.chunkText(long);
  assert.ok(ch.length >= 3, '긴 글을 여러 조각으로 나누지 않는다');
  assert.ok(ch.every(c => c.length <= D.CHUNK_MAX), `조각은 max(${D.CHUNK_MAX}) 이하 — ${ch.map(c => c.length)}`);
  for (let i = 0; i < paras.length; i++) assert.ok(ch.some(c => c.includes(`끝${i}`)), `문단 ${i}가 어느 조각에도 없다`);
  assert.ok(ch.slice(1).every(c => /^## 문단|^- 할 일|^준비/.test(c)), '조각이 문단·줄 경계가 아닌 자리에서 시작한다');
  for (let i = 1; i < ch.length; i++) {
    const head = ch[i].split('\n')[0];
    assert.ok(ch[i - 1].endsWith(head) && head.length <= D.CHUNK_OVERLAP, `조각 ${i}가 앞 조각 끝과 겹치지 않는다`);
  }
  assert.deepStrictEqual(D.chunkText(long), ch, '같은 글인데 조각이 달라진다(해시가 흔들린다)');
  const flat = D.chunkText('셀 '.repeat(2000));          // 엑셀 발췌처럼 줄바꿈 없는 통짜
  assert.ok(flat.length > 1 && flat.every(c => c.length <= D.CHUNK_MAX), '줄바꿈 없는 긴 발췌를 max 이하로 자르지 않는다');

  // 글 만들기 — 카드 · 댓글 · 첨부(사진 캡션 그대로 · 주보 첨부·빈 발췌·업무 없는 댓글은 뺀다)
  const P = 'p-1', C1 = 'c-1', C2 = 'c-2';
  const src = {
    projects: [{ id: P, name: '2026 하계 수련회' }],
    cards: [
      { id: C1, project_id: P, title: '피드백 및 강평회', updated_at: '2026-09-01',
        description: '[회의록](https://docs.google.com/x) ==정한 것== **39명**\n\n### 청년별 담당 업무\n- @임성빈 · 결산안 · 9월 30일까지' },
      { id: C2, project_id: P, title: '숙소', description: '' },
    ],
    comments: [{ id: 'm-1', card_id: C1, body: '결산 공유해주세요' }, { id: 'm-2', card_id: 'gone', body: '고아' }, { id: 'm-3', card_id: C2, body: '  ' }],
    files: [
      { id: 'f-1', card_id: C1, name: '결산안.xlsx', text_excerpt: '교회지원 3,500,000' },
      { id: 'f-2', card_id: C1, name: 'IMG.JPG', text_excerpt: '[사진] 제주 해안에서 청년 두 명' },
      { id: 'f-3', card_id: C1, name: '빈.pdf', text_excerpt: '' },
      { id: 'f-4', card_id: null, service_id: 's-1', name: '큐시트.pdf', text_excerpt: '작성 중 주보' },
      { id: 'f-5', card_id: C1, service_id: 's-1', name: '콘티.pdf', text_excerpt: '작성 중 주보' },
    ],
  };
  const docs = D.buildDocs(src);
  const byId = (id) => docs.filter(d => d.source_id === id);
  assert.strictEqual(byId(C1)[0].body, '2026 하계 수련회 / 피드백 및 강평회\n회의록 정한 것 39명\n\n### 청년별 담당 업무\n- @임성빈 · 결산안 · 9월 30일까지',
    '카드 글 모양이 다르다(링크 주소·강조는 걷고 담당 업무 도막·@이름은 그대로)');
  assert.strictEqual(byId(C2)[0].body, '2026 하계 수련회 / 숙소', '본문이 빈 업무는 머리줄만으로 한 조각');
  assert.strictEqual(byId('m-1')[0].body, '피드백 및 강평회 · 댓글: 결산 공유해주세요');
  assert.strictEqual(byId('m-1')[0].project_id, P, '댓글 조각에 업무의 프로젝트가 안 붙는다');
  assert.strictEqual(byId('f-1')[0].body, '피드백 및 강평회 · 첨부: 결산안.xlsx\n교회지원 3,500,000');
  assert.strictEqual(byId('f-2')[0].body, '피드백 및 강평회 · 첨부: IMG.JPG\n[사진] 제주 해안에서 청년 두 명', '사진 캡션의 [사진] 접두를 잃었다');
  for (const gone of ['m-2', 'm-3', 'f-3', 'f-4']) assert.strictEqual(byId(gone).length, 0, `${gone}는 넣지 않아야 한다`);
  assert.strictEqual(byId('f-5').length, 0, '주보 첨부는 넣지 않는다(작성 중 주보의 발췌가 전원에게 샌다)');
  for (const d of docs) {
    const ids = [d.card_id, d.comment_id, d.file_id].filter(Boolean);
    assert.deepStrictEqual(ids, [d.source_id], '조각 행의 원본 칸이 정확히 하나가 아니다(0074 제약)');
    assert.strictEqual(d[`${d.kind}_id`], d.source_id, 'kind와 원본 칸이 어긋난다');
    assert.strictEqual(d.body_hash, D.sha256(d.body), '해시가 임베딩한 글의 sha256이 아니다');
  }
  const touched = D.buildDocs({ ...src, cards: src.cards.map(c => ({ ...c, updated_at: '2030-01-01', status: 'done' })) });
  assert.deepStrictEqual(touched.map(d => d.body_hash), docs.map(d => d.body_hash), 'updated_at·상태만 바뀌었는데 해시가 달라진다(매일 다시 임베딩한다)');
  assert.deepStrictEqual(D.buildDocs(src, ['comment']).map(d => d.kind), ['comment'], 'kinds로 한 종류만 고르지 않는다');

  // 증분 계획 — 같으면 0 · 글이 바뀌면 embed · 프로젝트만 옮기면 move · 조각이 줄면 drop · 다른 종류는 안 건드림
  const existing = docs.map((d, i) => ({ id: i + 1, kind: d.kind, source_id: d.source_id, chunk: d.chunk, body_hash: d.body_hash, project_id: d.project_id }));
  assert.deepStrictEqual(D.planSync(docs, existing), { embed: [], move: [], drop: [] }, '바뀐 것이 없는데 할 일이 생긴다');
  const edited = D.buildDocs({ ...src, comments: [{ ...src.comments[0], body: '결산 올렸어요' }] });
  const p1 = D.planSync(edited, existing);
  assert.deepStrictEqual(p1.embed.map(d => d.source_id), ['m-1'], '고친 댓글만 다시 임베딩해야 한다');
  const moved = D.buildDocs({ ...src, projects: [...src.projects, { id: 'p-2', name: '2026 하계 수련회' }], cards: src.cards.map(c => c.id === C2 ? { ...c, project_id: 'p-2' } : c) });
  const p2 = D.planSync(moved, existing);
  assert.strictEqual(p2.embed.length, 0, '이름이 같은 프로젝트로 옮겼을 뿐인데 다시 임베딩한다');
  assert.deepStrictEqual(p2.move, [{ id: existing.find(r => r.source_id === C2).id, project_id: 'p-2' }], '옮긴 업무의 project_id를 고치지 않는다');
  const extra = [...existing, { id: 99, kind: 'card', source_id: C1, chunk: 5, body_hash: 'old', project_id: P }];
  assert.deepStrictEqual(D.planSync(docs, extra).drop, [99], '줄어든 조각을 지우지 않는다');
  assert.deepStrictEqual(D.planSync(D.buildDocs(src, ['file']), extra, ['file']), { embed: [], move: [], drop: [] }, '--kind file이 카드 조각을 지운다');
  console.log('PASS  문서 임베딩 뒷단(0074 모양 · 조각·해시 · 글 모양 · 증분 계획)');
}

// ── AI가 사람을 부르는 말 · 글에 나온 사람 (services/aiPeople.js · 2026-09-25 AI 감사 결정 1·3·6·7·9·13) ──
// 순수 모듈이라 여기서 바로 부른다. 프롬프트에 실리는 모양은 tests/aictx가 본다.
{
  const P = await import(new URL('../src/services/aiPeople.js', import.meta.url).href);
  // role_note → 직함 / 맡은 일. 끝이 ~장·총무·회계·전도사인 두 낱말까지가 직함이다.
  assert.deepStrictEqual(P.splitRoleNote('순장 · 찬양팀장'), { titles: ['순장', '찬양팀장'], notes: [] });
  assert.deepStrictEqual(P.splitRoleNote('예배팀장 · 찬양팀 남자 싱어'), { titles: ['예배팀장'], notes: ['찬양팀 남자 싱어'] });
  assert.deepStrictEqual(P.splitRoleNote('총무 · 회계 · 찬양팀 여자 싱어').titles, ['총무', '회계']);
  assert.deepStrictEqual(P.splitRoleNote('청년부 회장 · 여러 팀을 섬기는 팀원'), { titles: ['청년부 회장'], notes: ['여러 팀을 섬기는 팀원'] });
  assert.deepStrictEqual(P.splitRoleNote('전도사 · 담당 교역자').titles, ['전도사'], "'교역자'를 직함으로 읽었다(결정 6 — 전도사님으로 부른다)");
  assert.deepStrictEqual(P.splitRoleNote('담당 교역자(전도사님)').titles, ['전도사'], '괄호 속 옛 직함을 못 읽었다');
  assert.deepStrictEqual(P.splitRoleNote('부장님').titles, ['부장'], "뒤에 붙은 '님'을 안 뗐다(부장님님)");
  assert.deepStrictEqual(P.splitRoleNote('순장 · 찬양팀 일렉(팀에서 유일)'), { titles: ['순장'], notes: ['찬양팀 일렉(팀에서 유일)'] });
  // 결정 1 — role_note가 이긴다. 연도 직분·교역자는 role_note에 직함이 없을 때만 채운다
  const info = { isPastor: false, roles: ['lead_team'] };
  assert.deepStrictEqual(P.titlesOf({ role: '예배팀장 · 찬양팀 남자 싱어' }, info).titles, ['예배팀장'], '연도 직분(리더팀장)이 role_note를 밀어냈다');
  assert.deepStrictEqual(P.titlesOf({ role: '' }, info).titles, ['리더팀장'], 'role_note가 비었는데 연도 직분이 안 채운다');
  assert.deepStrictEqual(P.titlesOf({ role: '' }, { isPastor: true, roles: ['director'] }).titles, ['전도사', '부장']);
  // 결정 3 — 업무가 고른다
  const both = ['순장', '찬양팀장'];
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '찬양 콘티 결정', teams: ['찬양팀'] })), '찬양팀장');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '순모임 준비', teams: ['임원진'] })), '순장');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '양육', teams: ['순원'] })), '순장', '담당 팀이 순원이면 순 일이다');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '대림절 TF', teams: ['임원진'] })), '찬양팀장', '순 아닌 첫 직함이어야 한다');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '선착순 20명 모집', teams: ['웰컴팀'] })), '찬양팀장', "'선착순'을 순 일로 읽었다");
  assert.strictEqual(P.pickTitle(['리더순장'], P.taskScope({ title: '월례회', content: '리더순장님 참석' })), '리더순장');
  assert.strictEqual(P.isSunText({ text: '리더순장님 참석 · 리더순장 보고 · 리더 순장' }), false, "'리더순장'이라는 직함 글자를 순 일로 읽었다");
  // 본문만 순을 말할 때는 약한 신호 — 세 번 이상이어야 하고, 업무 팀의 직함이 있으면 그쪽이 이긴다
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '피드백', teams: ['찬양팀'], content: '## 순장 피드백' })), '찬양팀장', '본문의 순 한 번으로 순장을 골랐다');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '나눔', teams: ['임원진'], content: '각 순 순원 출석 · 순모임 장소' })), '순장', '본문이 순 이야기인데 순장을 안 골랐다');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '개선', teams: ['찬양팀'], content: '순장 권한 · 순원 목록 · 순 편성 화면' })), '찬양팀장', '업무 팀 직함이 약한 순 신호보다 먼저다');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '나눔', teams: ['임원진'], content: '순장 한 번' })), '찬양팀장', '본문의 순 한 번은 순 일이 아니다');
  assert.strictEqual(P.pickTitle(['리더팀장', '웰컴팀장'], P.taskScope({ title: '조 편성', teams: ['웰컴팀'] })), '웰컴팀장');
  assert.strictEqual(P.pickTitle(['찬양팀장', '예배팀장'], P.taskScope({ title: '10월 찬양 예배', teams: ['찬양팀', '엔지니어팀'] })), '찬양팀장', '팀이 맞는 직함이 예배팀장보다 먼저다');
  assert.strictEqual(P.pickTitle(['리더팀장', '예배팀장'], P.taskScope({ title: '10월 찬양 예배', teams: ['임원진'] })), '예배팀장', '예배 전반의 일인데 예배팀장을 안 골랐다');
  assert.strictEqual(P.pickTitle(['순장'], P.taskScope({ title: 'PPT 제작', teams: ['엔지니어팀'] })), '순장', '직함이 하나면 그 직함이다');
  assert.strictEqual(P.callName('신효진', '부장'), '신효진 부장님');
  assert.strictEqual(P.callName('강희라', ''), '강희라 청년');
  // 결정 13 — 글에 나온 가입자(열쇠: 표시명 · 명단 이름 · 이름 두 글자)
  const members = [
    { id: 'a', name: '노준석' }, { id: 'b', name: '시온' }, { id: 'c', name: '꽃님' }, { id: 'd', name: '현민스' }, { id: 'e', name: '이하랑Alex' },
  ];
  const idx = P.rosterIndex({
    people: [{ id: 'p1', name: '노준석', roster_name: '노준석', profile_id: 'a' }, { id: 'p2', name: '시온', roster_name: '이시온', profile_id: 'b' },
      { id: 'p3', name: '꽃님', roster_name: '강꽃님', profile_id: 'c' }, { id: 'p4', name: '현민스', roster_name: '배현민', profile_id: 'd' },
      { id: 'p5', name: '이하랑Alex', roster_name: '이하랑', profile_id: 'e' }],
    groups: [{ id: 'g', type: 'sun', name: 'TT순', leader_person_id: 'p1' }], members: [{ group_id: 'g', person_id: 'p3' }], roles: [],
  }, members);
  assert.strictEqual(idx.get('노준석').sun, 'TT순 순장');
  assert.strictEqual(idx.get('꽃님').sun, 'TT순 순원');
  const found = (s) => [...P.mentionedMembers(s, members, idx)].sort();
  assert.deepStrictEqual(found('### 준석\n- 좋았다'), ['노준석'], '줄 끝의 이름 두 글자를 못 찾았다');
  assert.deepStrictEqual(found('운전자(준석)가 고생'), ['노준석']);
  assert.deepStrictEqual(found('준석순(TT순)'), ['노준석'], "'OO순'을 못 찾았다");
  assert.deepStrictEqual(found('강꽃님 자매'), ['꽃님'], '명단 이름으로 표시명을 못 찾았다');
  assert.deepStrictEqual(found('현민순 모임'), ['현민스'], '명단 이름의 두 글자로 별명 표시명을 못 찾았다');
  assert.deepStrictEqual(found('하랑 의견'), ['이하랑Alex']);
  assert.deepStrictEqual(found('이시온 자매 · 시온 형제 · (시온)'), ['시온']);
  assert.deepStrictEqual(found('시온의 영광이 비치는 아침 · 주의 시온 성'), [], "찬양 가사의 '시온'을 사람으로 읽었다");
  assert.deepStrictEqual(found('노준석님'), ['노준석']);
  assert.deepStrictEqual(found('민스 · 이하랑의 · 선착순'), ['이하랑Alex'], "별명에서 뗀 두 글자('민스')를 열쇠로 썼다");
  assert.deepStrictEqual(found('현준석 형제'), [], '다른 사람 이름 안의 두 글자를 잡았다');
  // 한 줄 — 순 자리는 팀과 따로(결정 9)
  const line = P.personLine({ name: '노준석', teams: ['찬양팀', '순장'], role: '순장 · 찬양팀장' },
    { info: idx.get('노준석'), scope: P.taskScope({ title: '콘티', teams: ['찬양팀'] }), withMention: true });
  assert.strictEqual(line, '노준석 | 팀: 찬양팀 | 순: TT순 순장 | 부를 때: 노준석 찬양팀장님 | 멘션은 @노준석');
  assert.strictEqual(P.personLine({ name: '현민스', teams: ['순장'], role: '순장' }, { info: idx.get('현민스') }),
    '현민스(명단 이름 배현민) | 팀: 미지정 | 순: 순장 | 부를 때: 현민스 순장님');
  console.log('PASS  AI 사람 줄(aiPeople — 직함 고르기 · 순 칸 · 글에 나온 가입자)');
}

// ── 뜻 검색 결과를 줄로 (services/vecSearch.js · 사용자 결정 G-a · S-a 2026-09-25) ──────────
// 화면(상단 검색의 '관련된 업무 내용' · 성경 검색의 AI 실패 대체)은 게스트 모드에서 안 돈다(네트워크 0) —
// 그래서 모양을 바꾸는 순수 로직은 여기서 본다. **되돌리기**: andParticle의 `% 28 ? '과' : '와'`를
// 뒤집거나, relatedTasks의 exclude 검사·같은 업무 묶기를 지우면 깨진다.
{
  const V = await import(new URL('../src/services/vecSearch.js', import.meta.url).href);
  // 와/과 — 받침으로 가른다(사용자 문구 '{검색어}과 관련된 성경 구절')
  assert.strictEqual(V.withAnd('두려움'), '두려움과');
  assert.strictEqual(V.withAnd('사랑'), '사랑과');
  assert.strictEqual(V.withAnd('믿음 소망'), '믿음 소망과');
  assert.strictEqual(V.withAnd('평화'), '평화와');
  assert.strictEqual(V.withAnd('재물과 돈'), '재물과 돈과');
  assert.strictEqual(V.withAnd('진로 고민'), '진로 고민과');
  assert.strictEqual(V.withAnd('기도'), '기도와');
  assert.strictEqual(V.andParticle('걱정?'), '과', '끝의 문장부호는 건너뛴다');
  assert.strictEqual(V.andParticle('요한복음 3'), '과', '숫자는 읽는 소리로(삼)');
  assert.strictEqual(V.andParticle('시편 23:2'), '와', '숫자는 읽는 소리로(이)');
  assert.strictEqual(V.andParticle('love'), '와', '한글이 아니면 와');
  assert.strictEqual(V.andParticle(''), '와');
  // 조각 → 발췌 한 줄 (api/_docsync.js buildDocs의 모양)
  assert.strictEqual(V.docExcerpt({ kind: 'comment', body: '수련회 차량 대절 견적 · 댓글: 버스 두 대\n견적 받았어요' }), '버스 두 대 견적 받았어요');
  assert.strictEqual(V.docExcerpt({ kind: 'file', body: '청년부 2분기 결산 · 첨부: 결산안.xlsx\n수련회 숙소비,\n차량 대절비' }), '결산안.xlsx · 수련회 숙소비, 차량 대절비');
  assert.strictEqual(V.docExcerpt({ kind: 'file', body: '업무 · 첨부: 사진.jpg' }), '사진.jpg', '발췌가 없으면 파일명만');
  assert.strictEqual(V.docExcerpt({ kind: 'card', body: '2026 여름 수련회 / 장소 답사\n숙소 1인당   비용' }), '숙소 1인당 비용');
  assert.strictEqual(V.docExcerpt({ kind: 'card', body: '프로젝트 / 제목만' }), '', '본문 없는 업무는 빈 발췌');
  // 조각들 → 업무 줄: 가까운 순 · 업무 하나에 한 줄 · 위에 선 업무 빼기 · 모르는 업무 빼기 · 다섯까지
  const tasksById = { a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' }, c: { id: 'c', title: 'C' },
    d: { id: 'd', title: 'D' }, e: { id: 'e', title: 'E' }, f: { id: 'f', title: 'F' }, g: { id: 'g', title: 'G' } };
  const rows = [
    { kind: 'card', card_id: 'a', body: 'P / A', score: 0.9 },                    // 머리줄만 — 발췌를 빌린다
    { kind: 'comment', card_id: 'b', body: 'B · 댓글: 비', score: 0.85 },
    { kind: 'comment', card_id: 'a', body: 'A · 댓글: 에이 댓글', score: 0.8 },
    { kind: 'file', card_id: 'x', body: 'X · 첨부: 없는.pdf\n글', score: 0.79 },   // 스토어에 없는 업무
    { kind: 'file', card_id: 'c', body: 'C · 첨부: 씨.pdf\n씨 발췌', score: 0.7 },
    { kind: 'card', card_id: 'd', body: 'P / D\n디', score: 0.6 },
    { kind: 'card', card_id: 'e', body: 'P / E\n이', score: 0.5 },
    { kind: 'card', card_id: 'f', body: 'P / F\n에프', score: 0.4 },
    { kind: 'card', card_id: 'g', body: 'P / G\n지', score: 0.3 },
  ];
  const got = V.relatedTasks(rows, { tasksById, exclude: new Set(['d']) });
  assert.deepStrictEqual(got.map(r => r.task.id), ['a', 'b', 'c', 'e', 'f'], '가까운 순 · 한 업무 한 줄 · 위의 업무·모르는 업무 빼고 다섯');
  assert.deepStrictEqual([got[0].kind, got[0].excerpt], ['comment', '에이 댓글'], '빈 발췌는 같은 업무의 다음 조각에서 빌린다');
  assert.deepStrictEqual([got[2].kind, got[2].excerpt], ['file', '씨.pdf · 씨 발췌']);
  assert.strictEqual(V.relatedTasks(rows, { tasksById: new Map(Object.entries(tasksById)), limit: 2 }).length, 2, 'Map도 받는다 · limit');
  assert.deepStrictEqual(V.relatedTasks(null, { tasksById }), []);
  assert.deepStrictEqual(V.RELATED_KIND_LABEL, { comment: '댓글', file: '첨부', card: '상세 내용' });
  assert.ok(V.RELATED_LIMIT === 5 && V.RELATED_DEBOUNCE_MS >= 350 && V.RELATED_K >= 10, '다섯 줄 · 350ms 이상 기다린다 · k 10 이상');
  assert.ok(!V.relatedReady('가') && !V.relatedReady(' 가 ') && V.relatedReady('가나') && V.relatedReady('가 나'), '공백을 뺀 두 글자부터');
  assert.strictEqual(V.relatedKey('  찬양   기획 '), '찬양 기획');
  assert.strictEqual(V.vecParam([0.5, -1]), '[0.5,-1]');
  // 성경 대체 줄 — match_bible 행 → AI 줄과 같은 모양 · 모르는 책·겹친 절 버림
  const books = [{ id: 'isa', name: '이사야' }, { id: 'psa', name: '시편' }];
  const bh = V.bibleVecHits([
    { ref: '이사야 41:10', book: 'isa', chapter: 41, verse: 10, body: '두려워 말라' },
    { ref: '이사야 41:10', book: 'isa', chapter: 41, verse: 10, body: '두려워 말라' },
    { ref: '??', book: 'zzz', chapter: 1, verse: 1, body: 'x' },
    { ref: '시편 23:4', book: 'psa', chapter: 23, verse: 4, body: '사망의' },
  ], books);
  assert.deepStrictEqual(bh, [
    { bookId: 'isa', name: '이사야', chapter: 41, verse: 10, to: 10, text: '두려워 말라' },
    { bookId: 'psa', name: '시편', chapter: 23, verse: 4, to: 4, text: '사망의' },
  ]);
  // 게스트에서는 네트워크 0 — semanticOn이 클라우드 클라이언트를 보고, 상단 검색이 그것으로 구역을 가른다
  const semSrc = readFileSync(new URL('../src/services/semantic.js', import.meta.url), 'utf8');
  const laySrc = readFileSync(new URL('../src/components/layout.jsx', import.meta.url), 'utf8');
  assert.ok(/export const semanticOn = \(\) => !!supabase;/.test(semSrc), 'semanticOn은 클라우드 클라이언트가 있을 때만 참');
  assert.ok(/const ready = semanticOn\(\) && relatedReady\(query\);/.test(laySrc), '상단 검색의 뜻 결과는 semanticOn일 때만 묻는다');
  assert.ok(/>관련된 업무 내용</.test(laySrc), "구역 머리는 사용자 문구 '관련된 업무 내용'");
  assert.ok(/max-h-\[360px\]/.test(laySrc), '데스크톱 결과 판은 360px까지');
  console.log('PASS  뜻 검색 결과를 줄로(vecSearch — 와/과 · 발췌 · 업무 묶기 · 성경 대체 줄 · 게스트 네트워크 0)');
}
