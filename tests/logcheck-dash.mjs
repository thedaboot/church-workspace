// logcheck-dash — 대시보드·연결 지도(그래프)·업무 셈. 노드 스위트(브라우저·서버 없음 · tests/README.md).
// logcheck 묶음의 하나다 — `npm run verify -- logcheck`가 logcheck와 logcheck-* 전부를 돈다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { loadSource, readSplit } from './_load.mjs';

const { TaskService } = await import(new URL('../src/services/domain.js', import.meta.url).href);

// ── 대시보드 사람 칸 (utils.seenToday / birthdaysWithin / joinedWithin) ──
// 생일은 'MM-DD'만 저장하므로 연도를 빌려 비교한다 → 연말연시가 조용히 깨지기 쉽다.
{
  const { seenToday, birthdaysWithin, joinedWithin, localDate } = await loadSource('src/utils.js');

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
  const { visitOrder, agoLabel, joinedWithin, lastVisitOf } = await loadSource('src/utils.js');

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
  const { depLayers } = await loadSource('src/utils.js');

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
  const { birthdayMap, birthdaysOn } = await loadSource('src/utils.js');

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

// ── 힘 기반 그래프 한 스텝 (utils.forceStep) ──
// 연결 지도·프로젝트 그래프 뷰가 같이 쓴다. 고정·skip(끌거나 놓아둔) 노드는 힘을
// 받지 않아야 하고, 영역(zx) 밖으로 못 나가야 하고, alpha가 식으면 멈춰야 한다 —
// 이게 깨지면 팀이 떠다니거나, 사람이 프로젝트 영역으로 넘어가거나, 그래프가
// 영원히 출렁인다(사용자 지적 — "탱글").
{
  const { forceStep, forceBounds } = await loadSource('src/utils.js');

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
  const { reorderIds } = await loadSource('src/utils.js');

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

// ── 최신순 정렬 (utils.byNewest / byCompleted) ─────────────────────────────────
// 사용자 결정 2026-08-31: 선행 업무 후보와 '끝낸 업무' 목록은 맨 위가 가장 최신이어야
// 한다. 예전에는 후보가 allIds 순서(만든 순 오름차순)라 맨 위가 가장 오래된 업무였고,
// 완료를 누르면 그 줄이 몇 년 전 업무들 아래로 사라졌다.
// 되돌리기 검사: byNewest/byRecent의 a·b를 뒤집으면 첫 단정이, 호출부에서 .sort를
// 빼면 마지막 두 단정이 깨진다.
{
  const src = readSplit('src/utils.js');
  const { byNewest, byCompleted, completedTime } = await loadSource('src/utils.js');

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
  assert.ok(/rowDate = \(t, bucketKey\)/.test(parts) && /mdDot\(rowDate\(t, g\.key\)\)/.test(parts),
    "날짜 칸이 rowDate를 쓴다 — '끝낸 업무'는 마감일이 아니라 끝낸 날이다");
  const fields = readFileSync(new URL('../src/modals/taskFields.jsx', import.meta.url), 'utf8');   // DependsRow(19차 묶음 E에서 옮김)
  assert.ok(/\.sort\(byNewest\)/.test(fields), '선행 업무 후보가 byNewest로 정렬된다');
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


// ── 그래프가 부드러운지 (utils.forceStep 상수) ────────────────────────────────
// 사용자 지적 2026-08-31 — "모바일에서 탄성이 엄청난 그래프처럼 된다".
// 실제 규모(사람 15·팀 7·프로젝트 15)로 돌려서 **초기 폭발**과 **방향 반전**을 잰다.
// 옛 상수(SPRING .02 · DAMP .8 · MAX_V 18)에서는 최고 52px/프레임 · 반전 3.5회였다.
// 되돌리기 검사: utils.js의 DAMP를 0.8, MAX_V를 18로 되돌리면 앞 두 단정이 깨진다.
{
  const src = readSplit('src/utils.js');
  const { forceStep } = await loadSource('src/utils.js');

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
  const parts = readFileSync(new URL('../src/components/networkMap.jsx', import.meta.url), 'utf8');
  assert.ok(/const EDGE_OF = \(a, b, W\)/.test(parts) && /EDGE_OF\(AX\.m, AX\.t, W\)/.test(parts),
    '연결 지도의 선 길이 = 앵커 간격');
  // 1400 상한도 1858px 카드에서 좌우 229px씩 남겼다 → 상한을 없애고 카드 폭을 그대로 쓴다
  assert.ok(/const W = cw;/.test(parts), '데스크톱은 카드 폭을 다 쓴다(좌우 여백 낭비를 줄인 자리)');
  assert.ok(/const L = FM\[compact \? 'mob' : 'desk'\];/.test(parts) && /rows \* L\.ROW \+ 60/.test(parts), '높이가 줄 수를 따라간다(라벨 겹침의 원인 · 폭 갈래는 FM에서 한 번 고른다)');
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
  const src = readSplit('src/utils.js');
  const { spreadLabels } = await loadSource('src/utils.js');

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
  const parts = readFileSync(new URL('../src/components/networkMap.jsx', import.meta.url), 'utf8');
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
  const parts = readFileSync(new URL('../src/components/networkMap.jsx', import.meta.url), 'utf8');
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

  const src = readSplit('src/utils.js');
  const { forceBounds } = await loadSource('src/utils.js');
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
  for (const f of ['../src/components/networkMap.jsx', '../src/components/depgraph.jsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const who = f.includes('depgraph') ? '그래프 뷰' : '연결 지도';
    assert.ok(/const hoverOn = hoverProps\(setHiId\);/.test(src) && /\{\.\.\.hoverOn\(n\.id\)\}/.test(src),
      who + ': 노드 호버는 공용 공장(hoverProps)을 쓴다');
    assert.ok(!/onMouseEnter=/.test(src), who + ': onMouseEnter를 안 쓴다(터치에서 흉내로 발생한다)');
    assert.ok(/nodes\.findIndex\(n => n\.id === /.test(src),
      who + ': 고른 노드를 id로 찾는다(인덱스로 들고 있으면 딴 노드를 가리킨다)');
    assert.ok(/setHiId\(null\); \}\}>/.test(src), who + ': 지도 밖으로 마우스가 빠지면 강조를 끈다');
  }
  const parts = readFileSync(new URL('../src/components/networkMap.jsx', import.meta.url), 'utf8');
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
  const views = readFileSync(new URL('../src/views/dashboardView.jsx', import.meta.url), 'utf8');
  assert.ok(/projects=\{projectsList\}/.test(views),
    '지도가 고른 해의 프로젝트만 받는다(activeProjects 전체가 아니다)');
  assert.ok(/year=\{year\} years=\{years\} yearCounts=\{yearCounts\} onPickYear=\{setYear\}/.test(views),
    '지도에 연도 고르기를 넘긴다 — 값은 프로젝트 진행·탭 줄과 같은 하나다');
  assert.ok(/if \(!yearProjectIds\.has\(t\.projectId\)\) continue;/.test(views),
    '팀 목록·팀별 남은 수·선 굵기도 그 해 업무만 센다(딴 해 팀이 빈 줄로 남지 않게)');
  assert.ok(!/연결 지도는 해로 거르지 않는다/.test(views), '뒤집힌 옛 주석이 남아 있지 않다');

  const parts = readFileSync(new URL('../src/components/networkMap.jsx', import.meta.url), 'utf8');
  assert.ok(/import \{ YearPicker \} from '\.\/layout\.jsx';/.test(parts),
    "'프로젝트 진행' 칸과 **같은 부품**을 쓴다(연도 고르기를 두 벌 만들지 않는다)");
  // 2026-08-31: onPick은 스크롤 보정을 거치는 pickYear다(그 아래 블록)
  assert.ok(/onPick=\{pickYear\} compact \/>/.test(parts), '지도 머리줄에 연도 고르기가 있다');
  assert.ok(/\{year\}년에 프로젝트는 아직 없어요/.test(parts),
    "그 해에 프로젝트가 없으면 그림 대신 한 줄('아직'이라고 하지 않는다)");

  // 몇 개까지 겹치지 않나 — 상한을 바꿀 때 이 계산을 다시 하라.
  // room = (H - 16) - 38, 라벨 높이 27~28px. 균등 분배 간격이 라벨보다 좁아지면 겹친다.
  const { spreadLabels } = await loadSource('src/utils.js');
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
  const parts = readFileSync(new URL('../src/components/networkMap.jsx', import.meta.url), 'utf8');
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

  const utils = readSplit('src/utils.js');
  assert.ok(/export function scrollParentOf\(el\)/.test(utils), '스크롤러를 찾는 헬퍼가 있다');
  assert.ok(/이 앱은 창이 아니라 `main`이 스크롤한다/.test(utils),
    'window.scrollBy로는 아무 일도 안 일어난다는 것을 적어 둔다');
  console.log('PASS  연도 바꿀 때 스크롤 보정 8가지');
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
  const { isoTime, seenOnlyChange, LEAVE_STAMP_MS, dueForHeartbeat, visitOrder } =
    await loadSource('src/utils.js');

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

// ── 팀 보드 상단 사람 칩 (utils.teamChips) ──────────────────────────────────
// 예전에는 **그 팀 업무의 담당자**를 세어 칩을 세웠다 — 교역자 팀 보드에 교역자가
// 아닌 청년이 떴다(교역자 팀 업무 한 건을 맡고 있었다 · 사용자 지적 2026-09-07).
// 기준은 사람 프로필의 소속 팀이고, 숫자는 그 사람이 맡은 **이 팀의 남은 업무**다.
{
  const src = readSplit('src/utils.js');
  const { teamChips } = await loadSource('src/utils.js');

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
  const vparts = readFileSync(new URL('../src/views/viewParts.jsx', import.meta.url), 'utf8');
  assert.ok(/import \{[^}]*\bTEAM_CHIP_ROW\b[^}]*\} from '\.\/viewParts\.jsx';/.test(views) && /className=\{`\$\{TEAM_CHIP_ROW\} mt-2\.5`\}/.test(views),
    '팀 보드가 칩 줄 클래스를 viewParts에서 가져다 쓴다');
  assert.ok(/TEAM_CHIP_ROW[\s\S]{0,200}overflow-x-auto/.test(vparts),
    '칩이 넘치면 줄바꿈이 아니라 가로 스크롤이다');
  assert.ok(/TEAM_CHIP_ROW[\s\S]{0,200}after:w-3/.test(vparts),
    '끝까지 밀면 마지막 칩 뒤에 여백이 남는다');
  assert.ok(!/members\.slice\(0, 5\)/.test(views), '5명 상한은 없앴다(전원이 선다)');

  console.log('PASS  팀 보드 사람 칩 12가지');
}

// ── 업무의 '이번 주' = 주일에 시작하는 달력의 주 (utils.weekEndOf) ──
// 사용자 지시 2026-09-08 "업무 이번 주 - 주일을 시작으로 하기 무조건".
// 예전에는 '오늘부터 6일'이라 화면의 '이번 주'가 달력의 이번 주와 달랐다.
{
  const { weekEndOf } = await loadSource('src/utils.js');

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

  // 화면 두 곳이 실제로 이 규칙을 쓰는가 — 구간 판정은 services/taskCounts.bucketOf 한 벌이다(2026-09-25).
  const parts = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
  const views = ['views', 'dashboardView', 'projectView', 'viewParts'].map(n => readFileSync(new URL(`../src/views/${n}.jsx`, import.meta.url), 'utf8')).join('\n');
  const tc = readFileSync(new URL('../src/services/taskCounts.js', import.meta.url), 'utf8');
  assert.ok(/function bucketOf[\s\S]{0,800}?weekEndOf\(today\)/.test(tc),
    '마감 구간의 이번 주는 weekEndOf로 자른다');
  assert.ok(!/daysLeft\([^)]*\)\s*<=\s*6/.test(parts) && !/daysLeft\([^)]*\)\s*<=\s*6/.test(views),
    "굴러가는 '6일 내' 창은 어디에도 남아 있지 않다");
  assert.ok(/const due = dueCounts\(shown, today\);[\s\S]{0,200}?const weekCount = due\.week;/.test(views),
    "KPI '이번 주'도 같은 기준(아래 목록의 구간)으로 센다(숫자와 아래 목록이 어긋나면 안 된다)");
  assert.ok(/note="이번 주 토요일까지"/.test(views) && !/앞으로 일주일 내/.test(views),
    "KPI 밑줄은 그 숫자가 무엇인지 말한다 — '앞으로 일주일 내'는 이제 거짓이다");

  console.log('PASS  업무 이번 주(주일~토요일) 16가지');
}

// ── 상시(0075)와 업무 셈 한 벌 (services/taskCounts · 2026-09-25 셈 감사) ─────────
// 지연 · 마감 구간 · 남은 업무 · 2주 방치 · 진척이 화면마다 따로 적혀 있어서 보류 중인 업무가
// 대시보드 KPI에서는 '지연'이고 보드 카드도 빨갰다. 상시(마감 없이 계속 쓰는 업무)를 더하면서
// 판정을 taskCounts 한 곳에 모았다 — 여기서는 그 판정과 화면의 배선을 같이 본다.
// 되돌리기 검사(실제로 해서 깨지는 것을 확인했다): isRunning에서 `&& t.status !== HOLD`를 빼면
// '보류 중은 지연이 아니다'가, isStaleNoDue의 `t.updatedAt ||`를 빼면 '2주 방치는 고친 날로'가,
// domain.withoutDatesIfOngoing을 `(data) => data`로 바꾸면 '상시로 바꾸면 날짜를 지운다'가 깨진다.
{
  const { CONFIG } = await import(new URL('../src/config.js', import.meta.url).href);
  const TC = await import(new URL('../src/services/taskCounts.js', import.meta.url).href);
  const { datedTasks, teamChips } = await import(new URL('../src/utils.js', import.meta.url).href);

  // config — 상시는 보드 칸 배열에 없고 고르기 목록의 맨 아래다
  assert.deepStrictEqual(CONFIG.STATUSES, ['시작 전', '진행 중', '보류 중', '완료'], '보드 칸은 넷 그대로(상시는 칸이 아니다)');
  assert.strictEqual(CONFIG.STATUS_PICK.at(-1), '상시', '상태 고르기에서 상시는 맨 아래');
  assert.strictEqual(CONFIG.STATUS_DB['상시'], 'ongoing');
  for (const s of CONFIG.STATUS_PICK) {
    assert.ok(CONFIG.STATUS_STYLES[s] && CONFIG.STATUS_DOTS[s] && CONFIG.STATUS_BG_VAR[s] && CONFIG.STATUS_FG_VAR[s], `${s}의 색이 네 표에 다 있다`);
  }
  assert.ok(/tag-purple/.test(CONFIG.STATUS_STYLES['상시']) && /tag-purple/.test(CONFIG.STATUS_BG_VAR['상시']), '상시는 보라 태그');

  // 0075 — 체크 제약에 ongoing · 되돌리는 SQL
  const mig = readFileSync(new URL('../supabase/migrations/0075_card_status_ongoing.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = mig.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(/check \(status in \('todo', 'doing', 'hold', 'done', 'ongoing'\)\)/.test(body), '0075가 ongoing을 허용한다');
  assert.ok(/-- update public\.cards set status = 'todo' where status = 'ongoing';/.test(mig), '0075 맨 아래에 되돌리는 SQL이 있다');

  // 상시로 바꾸면 날짜를 지운다(활동 기록도 남는다) · 다른 상태는 날짜를 그대로
  const b = { id: 't', title: '순번표', status: '진행 중', assignees: [], teams: [], startDate: '2026-09-01', dueDate: '2026-12-31', activityLog: [], comments: [] };
  const on = TaskService.updateWithLogs(b, { ...b, status: '상시' }, '노준석');
  assert.deepStrictEqual([on.task.startDate, on.task.dueDate], ['', ''], '상시로 바꾸면 시작일·마감일이 빈다');
  assert.deepStrictEqual(on.logs.map(l => l.action), [
    "상태를 '진행 중'에서 '상시'(으)로 변경했습니다.", '시작일을 지웠습니다.', '마감일을 지웠습니다.',
  ], '지운 날짜가 활동에 남는다');
  assert.strictEqual(TaskService.update(b, { ...b, status: '보류 중' }, '노준석').dueDate, '2026-12-31', '보류 중은 날짜를 그대로 둔다');
  assert.strictEqual(TaskService.create({ ...b, status: '상시' }, '노준석').dueDate, '', '만들 때부터 상시여도 날짜가 없다');

  // 판정 — 오늘은 2026-09-23(수) · 그 주 토요일은 26일
  const today = '2026-09-23';
  const T = (status, dueDate = '', extra = {}) => ({ status, dueDate, assignees: [], teams: [], ...extra });
  assert.ok(TC.isOverdue(T('시작 전', '2026-09-20'), today) && TC.isOverdue(T('진행 중', '2026-09-22'), today), '돌아가는 일의 지난 마감은 지연');
  assert.ok(!TC.isOverdue(T('보류 중', '2026-09-01'), today), '보류 중은 지연이 아니다');
  assert.ok(!TC.isOverdue(T('완료', '2026-09-01'), today) && !TC.isOverdue(T('상시', '2026-09-01'), today), '완료·상시는 지연이 아니다');
  assert.ok(!TC.isOverdue(T('진행 중', today), today), '오늘 마감은 아직 지연이 아니다');
  const cases = [
    [T('진행 중', '2026-09-22'), 'overdue'], [T('진행 중', today), 'today'], [T('시작 전', '2026-09-24'), 'week'],
    [T('시작 전', '2026-09-26'), 'week'], [T('시작 전', '2026-09-27'), 'later'], [T('시작 전'), 'nodue'],
    [T('상시'), 'ongoing'], [T('상시', '2026-09-22'), 'ongoing'], [T('보류 중', today), 'hold'], [T('보류 중', '2026-09-01'), 'hold'],
    [T('완료', '2026-09-01'), 'done'],
  ];
  for (const [t, k] of cases) assert.strictEqual(TC.bucketOf(t, today), k, `${t.status} ${t.dueDate || '(없음)'} → ${k}`);
  assert.strictEqual(TC.bucketOf(T('시작 전', '2026-09-27'), '2026-09-27'), 'today', '주일은 새 주의 시작(오늘)');
  assert.strictEqual(TC.bucketOf(T('시작 전', '2026-10-03'), '2026-09-27'), 'week', '주일에 보면 그 주 토요일까지가 이번 주');
  const dc = TC.dueCounts(cases.map(c => c[0]), today);
  assert.deepStrictEqual([dc.overdue, dc.today, dc.week, dc.later, dc.nodue, dc.ongoing, dc.hold, dc.done], [1, 1, 2, 1, 1, 2, 2, 1],
    'KPI가 세는 수 = 목록의 구간 수');

  // 2주 방치 — 마지막으로 고친 날 기준 · 보류·상시는 빠진다
  const old = '2026-08-01T03:00:00Z';
  assert.ok(!TC.isStaleNoDue(T('시작 전', '', { createdAt: old, updatedAt: '2026-09-20T03:00:00Z' }), today), '만든 지 오래여도 최근에 고쳤으면 방치가 아니다');
  assert.ok(TC.isStaleNoDue(T('진행 중', '', { createdAt: old, updatedAt: '2026-09-05T03:00:00Z' }), today), '2주 넘게 손대지 않은 마감 미정');
  assert.ok(TC.isStaleNoDue(T('시작 전', '', { createdAt: old }), today), '고친 날이 없으면 만든 날로');
  assert.ok(!TC.isStaleNoDue(T('보류 중', '', { createdAt: old, updatedAt: old }), today), '보류 중은 방치 표시에서 뺀다');
  assert.ok(!TC.isStaleNoDue(T('상시', '', { createdAt: old, updatedAt: old }), today), '상시는 방치 표시에서 뺀다');
  assert.ok(!TC.isStaleNoDue(T('시작 전', '2026-12-01', { createdAt: old, updatedAt: old }), today), '마감이 있으면 방치 표시가 아니다');

  // 날짜는 로컬 — 로컬 23일 0시 30분에 만든 것은 오늘 나이 0(UTC 앞 10자로 자르면 서울에서는 1이 된다)
  assert.strictEqual(TC.ageDays(new Date(2026, 8, 23, 0, 30).toISOString(), today), 0, '타임스탬프는 로컬 날짜로 센다');
  assert.strictEqual(TC.ageDays('2026-09-20', today), 3, "'YYYY-MM-DD'는 그대로");
  // 지난 7일 = 오늘 포함 7일
  const ago = (n) => new Date(2026, 8, 23 - n, 12).toISOString();
  const done = [0, 6, 7].map(n => ({ status: '완료', completedAt: ago(n) }));
  assert.strictEqual(TC.recentDoneCount(done, t => t.completedAt, today), 2, '엿새 전까지 · 이레 전은 빠진다(예전에는 8일을 셌다)');

  // 남은 업무·진척·팀별·청년별 — 상시는 끝낼 일이 아니다
  const L = [
    T('완료', '', { teams: ['웰컴팀'], assignees: ['가'] }), T('진행 중', '2026-09-01', { teams: ['웰컴팀'], assignees: ['가'] }),
    T('보류 중', '2026-09-01', { teams: ['웰컴팀'], assignees: ['나'] }), T('상시', '', { teams: ['웰컴팀', '찬양팀'], assignees: ['가', '나'] }),
  ];
  assert.deepStrictEqual(TC.progressOf(L), { done: 1, total: 3 }, '진척 분모에서 상시를 뺀다');
  const tl = TC.teamLeftStats(L);
  assert.deepStrictEqual(tl.map(s => s.name), Object.keys(CONFIG.TEAMS), '팀 순서는 config');
  assert.deepStrictEqual(tl.find(s => s.name === '웰컴팀'), { name: '웰컴팀', total: 3, done: 1 });
  assert.deepStrictEqual(tl.find(s => s.name === '찬양팀'), { name: '찬양팀', total: 0, done: 0 }, '상시만 있는 팀은 0');
  assert.deepStrictEqual(TC.personLoad(L), [{ name: '가', left: 1 }, { name: '나', left: 1 }], '청년별: 완료·상시 빼고 · 지연 수는 없다');
  assert.deepStrictEqual(TC.inProjects([{ projectId: 'a' }, { projectId: 'b' }, null], new Set(['a'])), [{ projectId: 'a' }], '고른 해 프로젝트만');
  // 달력·팀 칩도 상시를 세지 않는다
  assert.deepStrictEqual(datedTasks([{ status: '상시', dueDate: '2026-09-30' }, { status: '시작 전', dueDate: '2026-09-30' }]).length, 1, '상시는 날짜가 남아도 달력에 없다');
  assert.deepStrictEqual(teamChips([], [T('상시', '', { teams: ['웰컴팀'], assignees: ['가'] })], '웰컴팀'), [], '팀 칩 남은 수에 상시가 없다');

  // 배선 — 화면이 이 판정을 쓰는가
  const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const views = ['views', 'dashboardView', 'projectView', 'viewParts'].map(n => readFileSync(new URL(`../src/views/${n}.jsx`, import.meta.url), 'utf8')).join('\n'), parts = src('../src/views/dashboardParts.jsx'), boards = src('../src/components/boards.jsx'), modals = src('../src/modals/taskFields.jsx');   // TaskProps는 taskFields(19차 묶음 E)
  assert.ok(/const due = dueCounts\(shown, today\);/.test(views) && /const myDue = dueCounts\(myOpen, today\);/.test(views), 'KPI·인사말이 구간 셈을 쓴다');
  assert.ok(!/dueDate < today/.test(views), 'views에 손으로 적은 지연 판정이 남아 있지 않다');
  assert.ok(/teamLeftStats\(yearTasks\)/.test(views) && /personLoad\(yearTasks\)/.test(views), '팀별·청년별은 고른 해 업무만 센다(연결 지도와 같은 값)');
  assert.ok(/progressByProject\(myTasks, projectsMap, yearIds\)/.test(views) && /progressByProject\(teamTasks, projectsMap, yearIds\)/.test(views), "'내가 맡은 프로젝트'·'참여 프로젝트'도 고른 해만");
  assert.ok(!/p\.late/.test(parts), "청년별 남은 업무에 사람마다 '지연 N건'이 없다(견주는 구조 · §8)");
  assert.ok(/key: 'ongoing', label: '상시'/.test(parts) && /key: 'hold', label: '보류 중'/.test(parts), '마감 목록에 상시·보류 중 구간이 따로 있다');
  // 2026-09-27 — 대시보드·내 업무·팀 업무 목록에서 상시는 기본으로 빠지고, 내 업무의 '상시' 칩을 고를 때만 선다
  assert.ok(/ongoing = false \} = \{\}\) \{\s*return BUCKETS\.filter\(b => ongoing \|\| b\.key !== 'ongoing'\)/.test(parts), '목록은 기본으로 상시 구간을 뺀다');
  assert.ok(/ongoing: statusFilter\.includes\(CONFIG\.STATUS_ONGOING\)/.test(views) && (views.match(/groupByDue\([^)]*ongoing/g) || []).length === 1, "상시 구간은 내 업무의 '상시' 칩에서만");
  assert.ok(/const isLate = \(task\) => isOverdue\(/.test(boards), '보드 카드의 빨간 마감도 isOverdue 하나');
  assert.ok(/raw === ONGOING_DROP/.test(boards) && /onStatusChange\(task, ONGOING(, \{ keepPosition: true \})?\)/.test(boards), '상시 줄에 놓으면 상시가 된다');
  // 상태 버튼·상단 칩으로 옮기면 그 상태 맨 위(2026-10-02) — 직접 끌어 놓은 자리(⓪①·컬럼 빈 자리)는 보드가 순서를 매긴다
  const { topPosition } = await import(new URL('../src/utils.js', import.meta.url).href);
  const TP = [{ id: 'a', status: '진행 중', position: 3 }, { id: 'b', status: '진행 중', position: -2 }, { id: 'c', status: '완료', position: -9 }];
  assert.strictEqual(topPosition(TP, '진행 중', 'x'), -3, '그 상태의 가장 작은 값보다 하나 작다(다른 상태는 안 본다)');
  assert.strictEqual(topPosition(TP, '진행 중', 'b'), 2, '자기 자신은 빼고 센다');
  assert.strictEqual(topPosition(TP, '보류 중'), 0, '빈 상태면 0');
  const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(/topPosition\(Object\.values\(store\.getState\(\)\.tasks\.byId\), status, t\.id\)/.test(appSrc), '상태 바꾸기가 맨 위 position을 같이 싣는다');
  assert.ok(/if \(isChip\) \{ onStatusChange\(task, target\); return; \}/.test(boards), '상단 칩은 맨 아래로 다시 매기지 않는다(상태 바꾸기의 맨 위를 덮는다)');
  assert.ok(/ongoing\.length > 0 && <OngoingRow/.test(boards), '상시가 0건이면 줄이 서지 않는다');
  assert.ok(/s === CONFIG\.STATUS_ONGOING\s*\?\s*\{ \.\.\.prev, status: s, startDate: '', dueDate: '' \}/.test(modals), '업무 창에서 상시를 고르는 순간 날짜를 비운다');
  // 속성 칸은 새 업무 폼과 업무 창이 한 벌(TaskProps · data)이다(2026-09-28)
  assert.ok(/\bdata\.status !== CONFIG\.STATUS_ONGOING && \(/.test(modals), '상시면 시작일·마감일 칸이 없다');
  console.log('PASS  상시(0075)와 업무 셈 한 벌(taskCounts — 지연 · 구간 · 방치 · 진척 · 고른 해)');
}

// ── 흔적과 움직임(2026-09-25 · 목업 mockup-traces 3~7 · 완료 손맛 · 앞 칸 넛지) ─────────────
// 순수 규칙은 services/traces.js 한 벌 — 여기서는 규칙과 화면 배선을 같이 본다.
{
  const T = await import(new URL('../src/services/traces.js', import.meta.url).href);
  const TC = await import(new URL('../src/services/taskCounts.js', import.meta.url).href);
  const H = 3600000;
  const now = Date.parse('2026-09-25T12:00:00Z');
  const base = { at: now - 10 * H, me: new Set(['me', 'me-merged']) };

  // 지난 방문 이후 남이 움직였나 — 내 것(합친 계정 포함)·기준 이전·기준이 없으면 아니다
  assert.strictEqual(T.isFreshMove(now - H, 'other', base), true);
  assert.strictEqual(T.isFreshMove(now - H, 'me', base), false, '내 움직임에는 점이 없다');
  assert.strictEqual(T.isFreshMove(now - H, 'me-merged', base), false, '합친 계정도 나다');
  assert.strictEqual(T.isFreshMove(now - 11 * H, 'other', base), false, '지난 방문 전의 움직임');
  assert.strictEqual(T.isFreshMove(now - H, 'other', null), false, '처음 온 사람(기준 없음)에게는 점이 없다');
  assert.strictEqual(T.isFreshMove(new Date(now - H).toISOString(), 'other', base), true, 'ISO 글자도 받는다');

  // 탭 점 — 연 뒤의 움직임만 · 보고 있는 프로젝트에는 없다
  const rows = [
    { projectId: 'p1', actor: 'other', at: now - 2 * H },
    { projectId: 'p2', actor: 'me', at: now - 2 * H },
    { projectId: 'p3', actor: 'other', at: now - 20 * H },
    { projectId: 'p4', actor: 'other', at: now - 5 * H },
    { projectId: 'p5', actor: 'other', at: now - H },
  ];
  const fresh = T.freshProjectIds(rows, base, { p4: now - 3 * H }, 'p5');
  assert.deepStrictEqual([...fresh].sort(), ['p1'], '남의 움직임 · 기준 뒤 · 연 뒤 · 보는 중 아님');
  assert.strictEqual(T.freshProjectIds(rows, null).size, 0);

  // 최근 활동 묶기 — 맨 윗줄이 내 것이어도 그 아래 남의 새 줄이 있으면 점
  const feed = [
    { id: 'a1', cardId: 'c1', actorId: 'me', at: new Date(now - H).toISOString() },
    { id: 'a2', cardId: 'c1', actorId: 'other', at: new Date(now - 2 * H).toISOString() },
    { id: 'a3', cardId: 'c2', actorId: 'other', at: new Date(now - 30 * H).toISOString() },
    { id: 'a4', cardId: 'c3', actorName: '조해리', at: new Date(now - 3 * H).toISOString() },
  ];
  const g = T.groupFeed(feed, base);
  assert.deepStrictEqual(g.map(r => [r.cardId, r.more, r.fresh]), [['c1', 1, true], ['c2', 0, false], ['c3', 0, true]],
    '카드별 한 줄 + 외 N건 · 점은 묶음 안의 남의 새 줄 · 게스트는 이름이 열쇠');
  assert.deepStrictEqual(T.groupFeed(feed).map(r => r.fresh), [false, false, false], '기준이 없으면 점 없음');

  // 업무 밖 줄 — 알림 문구 그대로 · 사람을 모르면 세우지 않는다 · 묵상 문구
  const names = { u1: '임성빈', u2: '노준석', u3: '김승찬' };
  const ex = T.extraFeedRows({
    services: [
      { id: 's1', title: '포도주 틀에서', published_at: '2026-09-11T07:06:41Z', published_by: 'u1' },
      { id: 's2', title: '옛 주보', published_at: '2026-09-01T00:00:00Z', published_by: null },
    ],
    meetings: [
      { id: 'm1', group_id: 'g1', meeting_date: '2026-09-27', created_at: '2026-09-14T11:00:15Z', created_by: 'u2' },
      { id: 'm2', group_id: 'gone', meeting_date: '2026-09-28', created_at: '2026-09-15T00:00:00Z', created_by: 'u2' },
    ],
    qts: [{ id: 'q1', profile_id: 'u3', qt_date: '2026-09-20', title: '', updated_at: '2026-09-20T01:00:00Z' }],
    nameOf: (id) => names[id] || '',
    groupName: (id) => (id === 'g1' ? '통통' : ''),
    passageOf: (d) => (d === '2026-09-20' ? '사사기 11:12-28' : ''),
  });
  assert.deepStrictEqual(ex.map(r => [r.kind, r.head, r.text]), [
    ['service', '포도주 틀에서', '임성빈님이 이번 주 주보를 발행했어요'],
    ['meeting', '통통 · 26. 9. 27.', '노준석님이 동아리 모임 일정을 잡았어요'],
    ['qt', '사사기 11:12-28', '김승찬님이 오늘 QT 묵상을 나눴어요'],
  ], '발행한 사람을 모르는 주보 · 지워진 동아리의 모임은 서지 않는다');
  assert.deepStrictEqual(ex.map(r => r.link), ['/?p=worship&s=s1', '/?p=groups&g=g1', '/?p=word']);

  // 섞기 — 시간순(최근 먼저) · 업무 밖 줄에도 점
  const mixed = T.mixFeed(
    [{ id: 'x', at: '2026-09-20T00:00:00Z' }, { id: 'y', at: '2026-09-10T00:00:00Z' }],
    [{ id: 'svc:1', actorId: 'other', at: '2026-09-15T00:00:00Z' }, { id: 'svc:2', actorId: 'me', at: '2026-09-25T11:00:00Z' }],
    base);
  assert.deepStrictEqual(mixed.map(r => r.id), ['svc:2', 'x', 'svc:1', 'y']);
  assert.deepStrictEqual(mixed.filter(r => r.id.startsWith('svc')).map(r => r.fresh), [false, false], '내 발행·기준 전 발행에는 점이 없다');
  assert.strictEqual(T.FEED_FIRST, 5); assert.strictEqual(T.FEED_STEP, 10);

  // 동아리 모임 — 오늘은 다가오는 쪽 · 가까운 날부터 / 지난 것은 최근부터
  const ms = [
    { id: 'a', meeting_date: '2026-09-12' }, { id: 'b', meeting_date: '2026-09-27' },
    { id: 'c', meeting_date: '2026-09-25' }, { id: 'd', meeting_date: '2026-09-01' }, { id: 'e', meeting_date: '2026-10-04' },
  ];
  const sp = T.splitMeetings(ms, '2026-09-25');
  assert.deepStrictEqual(sp.upcoming.map(m => m.id), ['c', 'b', 'e'], '오늘 포함 · 가까운 날부터');
  assert.deepStrictEqual(sp.past.map(m => m.id), ['a', 'd'], '지난 모임은 최근부터');
  assert.strictEqual(T.PAST_MEETINGS_SHOWN, 3);

  // 완료한 업무(최근 7일) — 오늘 포함 7일 · 로컬 날짜 · 끝낸 시각을 모르면 넣지 않는다
  const when = (t) => t.completedAt;
  const today = '2026-09-25';
  const done = (d) => ({ status: '완료', completedAt: d });
  assert.strictEqual(TC.isRecentlyDone(done('2026-09-25'), when, today), true);
  assert.strictEqual(TC.isRecentlyDone(done('2026-09-19'), when, today), true, '오늘 포함 7일째(9/19)');
  assert.strictEqual(TC.isRecentlyDone(done('2026-09-18'), when, today), false, '8일째는 빠진다');
  assert.strictEqual(TC.isRecentlyDone(done(''), when, today), false, '끝낸 시각을 모름');
  assert.strictEqual(TC.isRecentlyDone({ status: '진행 중', completedAt: '2026-09-25' }, when, today), false);
  assert.strictEqual(TC.recentDoneCount([done('2026-09-25'), done('2026-09-18')], when, today), 1, '지난 7일 셈도 같은 판정');

  // 배선 — 화면이 이 규칙을 쓰는가
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  const views = src('views/views.jsx');
  assert.ok(/isRecentlyDone\(t, completedTime, today\)/.test(views) && (views.match(/recentDone: /g) || []).length >= 2,
    '내 업무·팀 보드의 기본 목록이 최근 7일 완료를 넣고 머리를 바꾼다');
  const dp = src('views/dashboardParts.jsx') + src('components/activityFeed.jsx');
  assert.ok(/label: '완료한 업무', note: `최근 \$\{RECENT_DONE_DAYS\}일`/.test(dp), "구간 머리 '완료한 업무' + '최근 7일'");
  assert.ok(/mixFeed\(groupFeed\(act, base\), ex, base\)/.test(dp) && /FEED_STEP/.test(dp), '피드는 섞고 열 줄씩 편다');
  assert.ok(/dc-ring-now/.test(dp) && /COMPLETE_DRAW_MS/.test(dp), '마감 목록 완료 원은 그리고 나서 저장한다');
  const fx = src('services/feedExtras.js');
  assert.ok(/\.eq\('status', 'published'\)/.test(fx), '주보는 발행된 것만 읽는다(편집 자격자에게 초안이 오지 않게)');
  assert.ok(/\.eq\('shared', true\)/.test(fx), '묵상은 나눈 것만 — 비공개 묵상을 섞지 않는다');
  const app = src('App.jsx');
  const cap = app.indexOf('captureSeenBase({ at: profile?.last_seen_at');
  const stamp = app.indexOf('cloudSync.markSeen(0)');
  assert.ok(cap > 0 && stamp > cap, '지난 방문 기준 시각은 첫 찍기(markSeen(0)) 전에 붙잡는다');
  const lay = src('components/navParts.jsx');
  assert.ok(/최근 활발한 프로젝트/.test(lay) && /최근 7일 동안 \{nudge\.people\}명이 보고 있어요/.test(lay)
    && /앞에 있는 프로젝트는 자동으로 조정돼요\./.test(lay) && /이 프로젝트는 구분선 뒤에서 움직일 수 있어요\./.test(lay),
    '앞 칸 넛지 문구(사용자 확정)');
  assert.ok(/NUDGE_MS = 2500/.test(lay) && /front_nudge_seen/.test(lay), '넛지는 2.5초 · 본 브라우저는 hover로 안 뜬다');
  const mod = src('modals/taskLists.jsx');   // SubtaskList(19차 묶음 E에서 옮김)
  assert.ok(/dc-check-now/.test(mod) && /dc-strike-now/.test(mod), '하위 업무 체크의 선 그리기·취소선');
  const css = src('index.css');
  assert.ok(/\.dc-check-now path \{ stroke-dasharray: 1; animation: dc-draw \.24s var\(--ease-out-quint\) \.06s both; \}/.test(css), '체크 240ms · 60ms 지연');
  assert.ok(/animation: dc-strike \.22s var\(--ease-out-quint\) \.12s both/.test(css), '취소선 220ms · 120ms 지연');
  assert.ok(/\.dc-ring-now \{ animation: dc-pop-86 \.2s/.test(css) && /from \{ transform: scale\(\.86\); \}/.test(css), '원 .86 → 1 · 200ms');

  // 0079 — 발행 시각·사람 · 모임을 잡은 사람
  const mig = readFileSync(new URL('../supabase/migrations/0079_feed_published_at.sql', import.meta.url), 'utf8');
  assert.ok(/add column if not exists published_at timestamptz/.test(mig) && /add column if not exists published_by uuid/.test(mig));
  assert.ok(/group_meetings add column if not exists created_by uuid[\s\S]*default public\.effective_uid\(\)/.test(mig));
  assert.ok(/old\.status is distinct from 'published'/.test(mig), '발행으로 바뀌는 순간에만 찍는다');
  assert.ok(/elsif tg_op = 'UPDATE' and auth\.uid\(\) is not null then/.test(mig), '되돌리기는 로그인한 사람에게만(백필은 통과)');
  assert.ok(/n\.kind = 'service_published'/.test(mig) && /to_char\(m\.meeting_date, 'YY\. FMMM\. FMDD\.'\)/.test(mig), '백필은 알림에서');
  console.log('PASS  흔적과 움직임(점 판정 · 피드 묶기·섞기·업무 밖 줄 · 모임 나누기 · 최근 7일 완료 · 넛지·손맛 배선 · 0079)');
}

// ── 19차 리팩토링(2026-10-07)에서 한 벌로 모은 것 — 달력 날짜 칸 바탕 · 화면 파일 가르기 배선 ─────────
// 달력 날짜 칸 바탕은 데스크톱 격자와 모바일 달력이 같은 cellStyle 하나다(예전에는 두 자리에 같은 삼항이 있었다).
// 되돌리기 검사: cellStyle의 `isSel && !isToday`를 `isSel`로 바꾸면 '오늘이면 고른 날이어도 테두리 없음'이,
// 모바일 칸을 옛 인라인 삼항으로 되돌리면 '두 자리 다 cellStyle'이 깨진다.
{
  const cal = readFileSync(new URL('../src/components/calendar.jsx', import.meta.url), 'utf8');
  const m = /^export function cellStyle\([\s\S]*?\n\}/m.exec(cal);
  assert.ok(m, 'calendar.jsx에 cellStyle이 있다');
  const { cellStyle } = await loadSource('src/components/calendar.jsx', { as: 'cell.mjs', src: m[0] });
  const ctx = { month: 9, todayIso: '2026-10-07', selected: '2026-10-09' };   // 10월(0부터 9)
  assert.deepStrictEqual(cellStyle('2026-10-07', ctx), { background: 'var(--app-accent-weak)', boxShadow: 'none' }, '오늘');
  assert.deepStrictEqual(cellStyle('2026-10-09', ctx), { background: 'var(--app-surface-hover)', boxShadow: 'inset 0 0 0 1.5px var(--app-accent)' }, '고른 날');
  assert.deepStrictEqual(cellStyle('2026-10-15', ctx), { background: 'var(--app-surface)', boxShadow: 'none' }, '달 안');
  assert.deepStrictEqual(cellStyle('2026-11-01', ctx), { background: 'var(--app-canvas)', boxShadow: 'none' }, '달 밖');
  assert.deepStrictEqual(cellStyle('2026-10-07', { ...ctx, selected: '2026-10-07' }),
    { background: 'var(--app-accent-weak)', boxShadow: 'none' }, '오늘이면 고른 날이어도 테두리 없음');
  assert.strictEqual((cal.match(/style=\{cellStyle\(iso, \{ month(: view\.m)?, todayIso, selected \}\)\}/g) || []).length, 2,
    '두 자리 다 cellStyle(데스크톱 view.m · 모바일 month)');
  assert.ok(!/background: isToday \?/.test(cal.replace(m[0], '')), 'cellStyle 밖에 날짜 칸 삼항이 남아 있지 않다');
  // 열 폭은 useSnapCols 한 벌이고, 데스크톱은 다시 재는 조건(주 수 · 폭 갈래)을 넘긴다
  assert.ok(/const colStyle = useSnapCols\(gridRef, \[weekCount, isMobile\]\);/.test(cal)
    && /function useSnapCols\(ref, deps = \[\]\)/.test(cal) && (cal.match(/snapCols\(el\.clientWidth/g) || []).length === 1,
    '달력 열 폭은 useSnapCols 하나(데스크톱은 [weekCount, isMobile]에 다시 잰다)');

  // views.jsx를 가른 배선 — App은 views.jsx 하나에서 가져가고, 화면 파일끼리는 서로 import하지 않는다
  const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const views = src('views/views.jsx');
  assert.ok(/export \{ DashboardView, DASH_FILTERS, DASH_FILTER_DEFAULT \} from '\.\/dashboardView\.jsx';/.test(views)
    && /export \{ ProjectView \} from '\.\/projectView\.jsx';/.test(views), 'views.jsx가 대시보드·프로젝트를 이어서 내보낸다');
  for (const f of ['views/dashboardView.jsx', 'views/projectView.jsx', 'views/viewParts.jsx']) {
    assert.ok(!/from '\.\/(views|dashboardView|projectView)\.jsx'/.test(src(f)), `${f}가 다른 화면 파일을 import하지 않는다`);
  }
  // 회색 토글 세 자리가 한 부품 · 칩 줄 클래스 한 벌
  assert.strictEqual((src('views/dashboardView.jsx').match(/<Segmented /g) || []).length, 3, '대시보드의 토글 셋(필터 두 자리 · 폰 탭)');
  assert.strictEqual((src('views/projectView.jsx').match(/<Segmented /g) || []).length, 1, '프로젝트 보기 토글');
  assert.ok(!/'var\(--app-surface\)' : 'transparent'/.test(src('views/dashboardView.jsx') + src('views/projectView.jsx')),
    '화면 파일에 토글 바탕 삼항이 남아 있지 않다(segmented.jsx 한 벌)');
  // KPI 칸 — 혼자 선 칸(진척도 · 팀 보드 완료)도 KpiCell이다
  assert.ok(/<KpiCell[\s\S]{0,200}phoneNote[\s\S]{0,200}label="전체 진척도"/.test(src('views/dashboardView.jsx')), '진척도 칸은 KpiCell(폰에서도 메모)');
  assert.ok(/<KpiCell[\s\S]{0,200}tone="green" phoneNote[\s\S]{0,100}label="완료"/.test(views), "팀 보드 '완료' 칸은 KpiCell(초록 · 폰에서도 메모)");
  // 움직임 줄이기 판정은 hooks/useReducedMotion.js 한 벌
  for (const f of ['views/dashboardParts.jsx', 'hooks/useForceGraph.js', 'components/activityFeed.jsx']) {
    assert.ok(!/matchMedia/.test(src(f)), `${f}가 matchMedia를 직접 부르지 않는다`);
  }
  assert.ok(!/export \{ prefersReducedMotion \}/.test(src('views/dashboardParts.jsx')), 'dashboardParts는 모션 판정을 다시 내보내지 않는다(가져가는 곳이 없다)');
  console.log('PASS  19차 한 벌(달력 칸 바탕 · 열 폭 · 화면 파일 배선 · 토글 · KPI 칸 · 모션 판정)');
}

// ── 짧은 날짜 'M. D.' 한 벌(utils.mdDot · 19차 묶음 J) ──────────────────────────
// 대시보드 마감 목록 · 달력 · 칸반 카드(완료·보류의 마감) · 홈 '작년 이맘때'가 같은 표기를 따로 들고 있었다.
// 되돌리기 검사: mdDot에서 Number(…)를 빼면('09. 06.') 첫 단정이, 네 자리 중 하나가 제 사본을 다시 들면 둘째가 깨진다.
{
  const { mdDot } = await loadSource('src/utils.js');
  assert.deepStrictEqual(['2026-09-06', '2026-12-31', '2027-01-01', '2026-10-07T09:00:00'].map(mdDot),
    ['9. 6.', '12. 31.', '1. 1.', '10. 7.'], '앞 0을 떼고 점 뒤에 한 칸 — 시각이 붙어도 날짜만');
  const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  for (const f of ['views/dashboardParts.jsx', 'components/calendar.jsx', 'components/boards.jsx', 'views/homeView.jsx']) {
    const s = src(f);
    assert.ok(/import \{[^}]*\bmdDot\b[^}]*\} from '\.\.\/utils\.js';/.test(s) && !/slice\(5, 7\)\)?\}\. \$\{/.test(s),
      `${f}가 utils.mdDot 한 벌을 쓴다(제 사본 없음)`);
  }
  console.log('PASS  짧은 날짜 한 벌(mdDot) 5가지');
}

// 2026-10-09 — 본문에 붙인 사진이 첨부로 또 올라가지 않는다 · 움직임 줄이기가 tw-animate 등장도 끈다
{
  const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const att = src('modals/attachments.jsx');
  assert.ok(/const onPaste = \(e\) => \{ if \(e\.defaultPrevented\) return;/.test(att), '편집기가 받은 붙여넣기(defaultPrevented)는 첨부가 건너뛴다');
  const css = src('index.css');
  const reduce = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  assert.ok(/\.animate-in \{ animation: none !important; \}/.test(reduce), '움직임 줄이기에서 .animate-in도 멈춘다');
  console.log('PASS  붙여넣기 한 번 · animate-in 움직임 줄이기');
}

// 2026-10-09 — 색 대비(시안 승인): 다크 accent 위 흰 글씨 4.5 넘게 · accent 테두리는 다크 바탕들 위 3 넘게 · 업무 바 꺼진 탭 4 넘게
{
  const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const lum = (h) => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => p - q); return (y + 0.05) / (x + 0.05); };
  const css = src('index.css');
  const dark = css.match(/--app-canvas: (#[0-9a-f]{6}); --app-surface: (#[0-9a-f]{6}); --app-surface-hover: (#[0-9a-f]{6});/);
  const acc = css.match(/\n\s*--app-accent: (#[0-9a-f]{6}); --app-accent-strong/);
  assert.ok(dark && acc, '다크 토큰을 읽는다');
  assert.ok(ratio('#ffffff', acc[1]) >= 4.5, `다크 accent 위 흰 글씨 ${ratio('#ffffff', acc[1]).toFixed(2)}`);
  for (const bg of dark.slice(1)) assert.ok(ratio(acc[1], bg) >= 3, `다크 accent 테두리 · ${bg} 위 ${ratio(acc[1], bg).toFixed(2)}`);
  const bar = css.match(/--app-work-bar: (#[0-9a-f]{6})/)[1];
  const nav = src('components/mobileNav.jsx');
  const a = Number(nav.match(/tab-bar-work[^`]*\[--tab-off:rgb\(255_255_255\/([0-9.]+)\)\]/)[1]);
  const mix = '#' + [1, 3, 5].map(i => Math.round(255 * a + parseInt(bar.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
  assert.ok(ratio(mix, bar) >= 4, `업무 바 꺼진 탭 ${ratio(mix, bar).toFixed(2)}`);
  assert.ok(/tab-bar-work[^`]*\[--tab-on-w:700\] \[--tab-mark:#fff\]/.test(nav) && /bg-\[color:var\(--tab-mark,transparent\)\]/.test(nav), '업무 바 켜진 탭은 굵기와 점으로 가른다(색 차이가 작다)');
  console.log('PASS  색 대비(다크 accent · 업무 바 꺼진 탭)');
}
