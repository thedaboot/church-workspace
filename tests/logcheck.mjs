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
