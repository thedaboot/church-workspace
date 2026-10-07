// logcheck-live — 실시간·presence·다녀간 시각·화면 데이터 캐시. 노드 스위트(브라우저·서버 없음 · tests/README.md).
// logcheck 묶음의 하나다 — `npm run verify -- logcheck`가 logcheck와 logcheck-* 전부를 돈다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSource } from './_load.mjs';

// ── 지금 여기를 보고 있는 사람 (utils.viewersOf) ───────────────────────────
// 프로젝트 탭 옆·업무 줄 오른쪽 얼굴이 보는 판정. 게스트 스위트는 presence 집합이
// 언제나 비어 있어 화면으로는 못 보므로(HANDOFF §1-4) 여기서 지킨다.
// 되돌리기 검사: viewersOf에서 `e.id === meId` 걸러내기를 빼면 '본인 제외' 단정이,
// limit를 안 보면 '최대 세 명' 단정이, **at으로 하나만 남기는 부분**을 빼면
// '한 사람은 한 곳에만'·'옮기면 옛 자리에서 즉시 빠진다' 단정이 깨진다.
// 거르기(match)를 최신 meta 고르기보다 **먼저** 하도록 순서를 바꿔도 마찬가지다.
{
  const { viewersOf } = await loadSource('src/utils.js');

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
  // 보드 카드의 '수정 중'(2026-09-30) — entries로 최신 meta를 받고, 수정 중은 **그 사람의 최신 자리**의 값이다
  const editingTabs = [
    { id: 'u1', projectId: 'p1', cardId: 'c1', at: 100, editing: true },
    { id: 'u1', projectId: 'p1', cardId: 'c2', at: 200, editing: false },
    { id: 'u2', projectId: 'p1', cardId: 'c2', at: 150, editing: true },
  ];
  const got = viewersOf(editingTabs, { cardId: 'c2' }, { ...opts, entries: true });
  assert.deepStrictEqual(got.map(e => [e.id, e.editing]), [['u1', false], ['u2', true]], '사람마다 최신 meta의 수정 중');
  assert.deepStrictEqual(viewersOf(editingTabs, { cardId: 'c1' }, { ...opts, entries: true }), [], '옛 탭의 수정 중은 안 뜬다');
  console.log('PASS  지금 보고 있는 사람 27가지');
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
  const tdAt = src.lastIndexOf('return () => {');
  const teardown = src.slice(tdAt, tdAt + src.slice(tdAt).search(/\r?\n\}\r?\n/));   // 그 함수 끝까지만(뒤의 trackEditing은 meta를 고친다)
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
  const { nextWhereMeta } = await loadSource('src/utils.js');

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
  const { dueForHeartbeat, HEARTBEAT_MS } = await loadSource('src/utils.js');
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
  const { WRITE_STAMP_MS, dueForHeartbeat, mergeActivitySeen, lastVisitOf, visitOrder } =
    await loadSource('src/utils.js');

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
  // 떠난 순간(presence.usePresenceLeft · 2026-09-30) — 피드가 비어도 겹친다
  const gone = [{ actorId: 'u2', at: '2026-09-05T16:00:00.000Z' }];
  assert.strictEqual(lastVisitOf(mergeActivitySeen(M, [], gone)[1]), '2026-09-05T16:00:00.000Z',
    '방금 떠난 사람은 그 순간이 다녀간 시각이다');
  assert.strictEqual(lastVisitOf(mergeActivitySeen(M, feed, gone)[0]), '2026-09-05T15:58:34.026Z',
    '떠남과 활동이 같이 와도 사람마다 제 값');
  assert.strictEqual(mergeActivitySeen(M, [], []), M, '떠난 사람이 없으면 그대로');
  console.log('PASS  쓰기는 곧 지금 15가지');
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
  // react import만 걷어내면 순수 부분(minuteOf)을 노드에서 그대로 부를 수 있다
  const { minuteOf } = await loadSource('src/hooks/useMinuteTick.js', { src: raw.replace(/^import .*from 'react';\s*$/m, ''), as: 'tick.mjs' });
  assert.strictEqual(minuteOf(0), 0);
  assert.strictEqual(minuteOf(59_999), 0, '1분 안에서는 값이 그대로다(헛렌더가 없다)');
  assert.strictEqual(minuteOf(60_000), 1, '1분이 지나면 값이 바뀐다 → 라벨이 다시 그려진다');
  assert.strictEqual(typeof minuteOf(), 'number', '틱은 숫자 하나다(새 객체가 아니다)');
  assert.ok(/useMinuteTick\(stepMs = 60000\)/.test(raw) && /setInterval\(.*, stepMs\)/.test(raw), '기본 1분 간격이다');
  assert.ok(/clearInterval/.test(raw), '언마운트하면 타이머를 끈다');

  // 훅이 붙어 있어야 하는 자리 — 빠지면 그 화면의 'N분 전'이 다시 굳는다
  const members = readFileSync(new URL('../src/views/membersView.jsx', import.meta.url), 'utf8');
  assert.ok(/useMinuteTick\(tab === 'account' \? 10000 : 60000\)/.test(members), '멤버 관리 화면이 10초 틱을 쓴다(떠난 순간의 초 단위)');
  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  assert.strictEqual((parts.match(/useMinuteTick\(10000\)/g) || []).length, 1, '가입한 사람 모달은 10초 틱');
  assert.strictEqual((parts.match(/useMinuteTick\(\)/g) || []).length, 1, '최근 활동 피드는 1분 틱');
  console.log('PASS  1분 틱 8가지');
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
  // react·supabase·cache import만 걷어내면 순수 부분을 노드에서 그대로 부를 수 있다
  // (supabaseClient는 import.meta.env를 읽어서 노드에서 던진다)
  const { prefixesOf, kindsOf, V2_TABLES, ALL_KINDS, createSignalQueue, createGate, refreshTouched } =
    await loadSource('src/services/liveV2.js', { src: raw.replace(/^import .*from '(react|\.\/supabaseClient\.js|\.\/cache\.js)';\s*$/gm, '') });

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
    && /\[isAdmin, (tab, )?year, rosterTick(, bookRetry)?\]/.test(members),
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

  const { setCacheScope, readCache, writeCache, dropCache, __relieve } = await loadSource('src/services/cache.js', { src });
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
  globalThis.localStorage = { getItem: () => null };
  const S = await loadSource('src/store/workspaceStore.js', { src, as: 'store.mjs' });
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
  // 2026-09-28 — 업무 창에 수정 모드가 없어져 **편집 중이라고 미루지 않는다**(창이 칸마다 스토어의 지금 값을
  // 그린다). 미루는 갈래가 되살아나면 남이 바꾼 칸이 열린 창에 안 들어온다.
  assert.ok(/createIdBatcher\(\(ids\) => \{ ids\.forEach\(id => syncCard\(id\)\); \}, 200\)/.test(app),
    '카드는 200ms 모아 id마다 한 번');
  assert.ok(!/isEditingRef|pendingCardsRef|pendingReloadRef/.test(app), '편집 중에 카드 반영을 미루는 갈래가 없다');
  assert.ok(/onCard: \(id\) => cards\.add\(id\)/.test(app), 'onCard는 곧장 읽지 않고 모은다');
  assert.ok(/cards\.cancel\(\); unsub\(\);/.test(app), '구독을 걷을 때 모아 둔 것도 걷는다');
  console.log('PASS  워크스페이스 실시간 덜 읽기 22가지');
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
  const store = new Map();
  globalThis.localStorage = {
    get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const C = await loadSource('src/services/cache.js', { src: mk('true'), as: 'cloud.mjs' });
  const G = await loadSource('src/services/cache.js', { src: mk('false'), as: 'guest.mjs' });

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

// ── 프로젝트 탭 줄 앞 칸 · 업무 실시간 재접속 따라잡기 · 폰 '프로젝트' 버튼 (2026-09-25) ──
{
  const R = await import(new URL('../src/services/tabRank.js', import.meta.url).href);
  const S = await import(new URL('../src/services/realtimeStatus.js', import.meta.url).href);
  const now = Date.parse('2026-09-25T12:00:00Z');
  const ago = (h) => new Date(now - h * 3600000).toISOString();
  const rows = [
    // p1: 셋(가장 많음)
    { projectId: 'p1', actor: 'a', at: ago(1) }, { projectId: 'p1', actor: 'b', at: ago(30) }, { projectId: 'p1', actor: 'c', at: ago(50) },
    // p2: 둘 · 마지막 2시간 전 / p3: 둘 · 마지막 1시간 전 → p3이 앞
    { projectId: 'p2', actor: 'a', at: ago(2) }, { projectId: 'p2', actor: 'b', at: ago(5) },
    { projectId: 'p3', actor: 'a', at: ago(1) }, { projectId: 'p3', actor: 'c', at: ago(9) },
    // p4: 한 사람이 여러 번 — 사람 수 1이라 앞 칸에 못 든다
    { projectId: 'p4', actor: 'a', at: ago(1) }, { projectId: 'p4', actor: 'a', at: ago(2) }, { projectId: 'p4', actor: 'a', at: ago(3) },
    // p5: 둘인데 하나가 8일 전 — 창 밖이라 1명
    { projectId: 'p5', actor: 'a', at: ago(3) }, { projectId: 'p5', actor: 'b', at: ago(24 * 8) },
    // 주인·프로젝트 없는 줄은 버린다
    { projectId: null, actor: 'a', at: ago(1) }, { projectId: 'p1', actor: null, at: ago(1) },
  ];
  const st = R.activityStats(rows, now);
  assert.deepStrictEqual(st.p1, { people: 3, lastAt: now - 3600000 });
  assert.strictEqual(st.p4.people, 1, '같은 사람은 한 번');
  assert.strictEqual(st.p5.people, 1, '7일 밖은 세지 않는다');
  assert.strictEqual(R.FRONT_DAYS, 7); assert.strictEqual(R.FRONT_MAX, 5); assert.strictEqual(R.FRONT_MIN_PEOPLE, 2);
  const P = (id) => ({ id, title: id });
  const list = ['p5', 'p4', 'p2', 'p9', 'p3', 'p1'].map(P);   // position 순
  const sp = R.splitFrontTabs(list, st);
  assert.deepStrictEqual(sp.front.map(p => p.id), ['p1', 'p3', 'p2'], '사람 수 많은 순 · 같으면 최근 활동이 앞 · 2명 이상만');
  assert.deepStrictEqual(sp.rest.map(p => p.id), ['p5', 'p4', 'p9'], '나머지는 position 순 그대로 · 앞 칸 것은 빠진다');
  assert.deepStrictEqual(R.splitFrontTabs(list, null).front, [], '숫자가 없으면(게스트 첫 화면 · 못 읽음) 앞 칸 없음');
  assert.deepStrictEqual(R.splitFrontTabs(list, {}).rest.map(p => p.id), list.map(p => p.id), '앞 칸 0개 = 지금 순서 그대로');
  // 다섯까지
  const many = {}; const mlist = [];
  for (let i = 0; i < 7; i++) { many['q' + i] = { people: 2 + i, lastAt: i }; mlist.push(P('q' + i)); }
  const ms = R.splitFrontTabs(mlist, many);
  assert.deepStrictEqual(ms.front.map(p => p.id), ['q6', 'q5', 'q4', 'q3', 'q2'], '다섯까지');
  assert.deepStrictEqual(ms.rest.map(p => p.id), ['q0', 'q1']);
  // 후보는 목록(고른 해·보관 제외) 안에서만 — 목록에 없는 바쁜 프로젝트가 칸을 먹지 않는다
  assert.deepStrictEqual(R.splitFrontTabs([P('p2'), P('p9')], st).front.map(p => p.id), ['p2']);
  // 게스트 — 스토어 업무의 activityLog로 같은 줄
  const gt = { allIds: ['t1', 't2', 't3'], byId: {
    t1: { projectId: 'g1', activityLog: [{ author: '가', timestamp: ago(1) }, { author: '나', timestamp: ago(2) }] },
    t2: { projectId: 'g1', activityLog: [{ author: '가', timestamp: ago(3) }] },
    t3: { projectId: null, activityLog: [{ author: '다', timestamp: ago(1) }] } } };
  const gr = R.guestActivityRows(gt);
  assert.strictEqual(gr.length, 3, '프로젝트 없는 업무는 버린다');
  assert.deepStrictEqual(R.activityStats(gr, now).g1, { people: 2, lastAt: now - 3600000 });
  // 폰 '프로젝트' 버튼이 열 곳
  const yr = (p) => p.year;
  const act = [{ id: 'old1', year: '2026' }, { id: 'n1', year: '2027' }, { id: 'n2', year: '2027' }];
  const all = [...act, { id: 'arch', year: '2027', archived: true }];
  const pick = (o) => R.pickProjectToOpen({ active: act, all, yearOf: yr, stats: null, lastId: null, ...o });
  assert.strictEqual(pick({ year: '2027' }), 'n1', '고른 해의 첫 것 — position 첫 것(작년)이 아니다');
  assert.strictEqual(pick({ year: '2027', stats: { n2: { people: 2, lastAt: 1 } } }), 'n2', '앞 칸이 있으면 그것이 첫 것');
  assert.strictEqual(pick({ year: '2027', lastId: 'n2' }), 'n2', '마지막으로 본 것이 고른 해에 있으면 그것');
  assert.strictEqual(pick({ year: '2027', lastId: 'old1' }), 'n1', '마지막으로 본 것이 다른 해면 고른 해의 첫 것');
  assert.strictEqual(pick({ year: '2027', lastId: 'gone' }), 'n1', '지워진 것은 건너뛴다');
  assert.strictEqual(pick({ year: '2028' }), 'n1', '고른 해가 비면 가장 최근 해의 첫 것');
  assert.strictEqual(R.pickProjectToOpen({ active: [], all: [], year: '2027', yearOf: yr }), null, '아무것도 없으면 새로 만들기');
  // 재접속 판정 — 처음 SUBSCRIBED는 무시, 끊겼다 다시 붙을 때만 한 번
  let n = 0;
  const w = S.reconnectWatcher(() => { n++; });
  w('SUBSCRIBED'); assert.strictEqual(n, 0, '처음 붙을 때는 부르지 않는다');
  w('SUBSCRIBED'); assert.strictEqual(n, 0);
  w('TIMED_OUT'); w('CHANNEL_ERROR'); assert.strictEqual(n, 0, '끊긴 동안은 부르지 않는다');
  w('SUBSCRIBED'); assert.strictEqual(n, 1, '다시 붙으면 한 번');
  w('SUBSCRIBED'); assert.strictEqual(n, 1, '이어서 온 SUBSCRIBED는 또 부르지 않는다');
  w('CLOSED'); w('SUBSCRIBED'); assert.strictEqual(n, 2, 'CLOSED 뒤에도');
  S.reconnectWatcher(undefined)('CLOSED');   // 콜백이 없어도 던지지 않는다
  // 배선: 업무 채널이 상태를 받고 · App이 재접속에 재조회하고 · 앞 칸 숫자는 열 때·보일 때만 잰다
  const cloudSrc = readFileSync(new URL('../src/services/cloud.js', import.meta.url), 'utf8');
  const syncSrc = readFileSync(new URL('../src/services/cloudSync.js', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const laySrc2 = readFileSync(new URL('../src/components/layout.jsx', import.meta.url), 'utf8');
  assert.ok(/\.subscribe\(\(status\) => onStatus\?\.\(status\)\);/.test(cloudSrc), '업무 채널 subscribe가 상태를 넘긴다');
  assert.ok(/\}, reconnectWatcher\(onReconnect\)\);/.test(syncSrc), 'subscribeWorkspace가 재접속 판정을 붙인다');
  assert.ok(/onReconnect: \(\) => \{\s*clearTimeout\(timer\);[\s\S]{0,200}reloadCloud\(\)/.test(appSrc), 'App이 재접속에 재조회(업무 창이 열려 있어도 — 2026-09-28)');
  const calls = appSrc.match(/refreshTabFront\(/g) || [];
  assert.strictEqual(calls.length, 2, '앞 칸 숫자는 첫 로드 뒤 한 번 + 보일 때 한 번 — 실시간 경로에서 부르지 않는다');
  assert.ok(/if \(!document\.hidden\) refreshTabFront\(cloudMode\)/.test(appSrc), '다시 보일 때만');
  assert.ok(/draggable=\{!frontIds\.has\(p\.id\)\}/.test(laySrc2), '데스크톱 앞 칸 탭은 끌 수 없다');
  assert.ok(/const locked = archived \|\| front;/.test(laySrc2), '폰 앞 칸 탭도 끌기·놓기가 막힌다');
  assert.ok(/reorderIds\(posSource\.map\(p => p\.id\), dragTabId, targetId\)/.test(laySrc2), '번호는 position 순 전체로 매긴다');
  console.log('PASS  탭 줄 앞 칸(tabRank — 사람 수·최근·2명 이상·다섯·게스트 줄) · 폰 프로젝트 버튼 · 업무 채널 재접속 따라잡기');
}

