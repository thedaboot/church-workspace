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

// ── 가입한 사람 전체 목록 (utils.joinedOrder / daysAgoLabel) ──
// 머리줄 'N명'을 누르면 열리는 모달이 쓴다. 먼저 온 사람이 위여야 하고, 목록 수가
// 머리줄 숫자와 **같아야** 한다 — 가입일이 없는 사람을 빼면 눌러 놓고 세어 봤을 때
// 화면이 서로 다른 말을 한다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'ord-'));
  const f = join(dir, 'utils.mjs');
  writeFileSync(f, src);
  const { joinedOrder, daysAgoLabel, joinedWithin } = await import(pathToFileURL(f).href);

  const M = [
    { name: '나중', joinedAt: '2026-08-04T00:00:00Z' },
    { name: '처음', joinedAt: '2026-07-01T00:00:00Z' },
    { name: '오늘', joinedAt: '2026-08-05T00:00:00Z' },
    { name: '날짜없음' },
  ];
  const o = joinedOrder(M, '2026-08-05');
  assert.deepStrictEqual(o.map(m => m.name), ['처음', '나중', '오늘', '날짜없음'], '먼저 온 순 · 날짜 없는 사람은 맨 뒤');
  assert.strictEqual(o.length, M.length, '아무도 빠지지 않는다(머리줄 숫자와 같아야 한다)');
  assert.strictEqual(o[0].daysAgo, 35);
  assert.strictEqual(o[2].daysAgo, 0);
  assert.strictEqual(o[3].daysAgo, null);

  assert.strictEqual(daysAgoLabel(0), '오늘');
  assert.strictEqual(daysAgoLabel(1), '어제');
  assert.strictEqual(daysAgoLabel(5), '5일 전');
  assert.strictEqual(daysAgoLabel(null), '', '날짜를 모르면 빈 문자열 → 화면이 "가입일 모름"으로 받는다');

  // 환영은 사흘만(사용자 판단) — 나흘 전은 빠진다
  const J = [
    { name: '사흘', joinedAt: '2026-08-02T00:00:00Z' },
    { name: '나흘', joinedAt: '2026-08-01T00:00:00Z' },
  ];
  assert.deepStrictEqual(joinedWithin(J, 3, '2026-08-05').map(m => m.name), ['사흘']);
  console.log('PASS  가입 순서·며칠 전 9가지');
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
