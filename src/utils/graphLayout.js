// ============================================================================
// 그래프 배치 — 선후관계 열(depLayers · depgraph) · 그래프 자리 짜기(depGraphLayout · depgraph) · 힘 한 스텝과 상자 충돌(forceStep · useForceGraph)
//   · 라벨 떼어놓기(spreadLabels · 사람 덩어리는 spreadBoxes · networkMap) · 이동 범위(forceBounds)
// ----------------------------------------------------------------------------
// import 0개 — 노드 검사가 베껴 들인다(tests/_load.mjs). 부르는 쪽은 utils.js(바렐)를 문다.
// ============================================================================

// 선후관계 그래프의 열 배치 — 각 업무를 "선행 업무보다 오른쪽 열"에 둔다.
// 반환: [[depth 0 업무들], [depth 1 업무들], ...] (열 안은 마감일순 — byDue와 같은 규칙).
// 지워진 카드를 가리키는 id는 무시하고, 순환(A→B→A)은 그 자리에서 끊는다 —
// 화면이 던지며 죽는 것보다 한 칸 어긋난 배치가 낫다.
export function depLayers(tasks = []) {
  const byId = new Map((tasks || []).map(t => [t.id, t]));
  const memo = new Map();
  const visiting = new Set();
  const depthOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 0;               // 순환 — 여기서 끊는다
    visiting.add(id);
    const deps = (byId.get(id)?.dependsOn || []).filter(d => byId.has(d) && d !== id);
    const d = deps.length ? Math.max(...deps.map(depthOf)) + 1 : 0;
    visiting.delete(id);
    memo.set(id, d);
    return d;
  };
  const cols = [];
  for (const t of tasks || []) {
    const d = depthOf(t.id);
    (cols[d] = cols[d] || []).push(t);
  }
  // 순환을 끊으면 중간 깊이가 빌 수 있다(A→B→A에서 A=2, B=1, 0층이 빔) → 빈 열을 걷어낸다.
  // 걷어내지 않으면 희소 배열 구멍에서 sort가 던지고, 화면에는 빈 열이 남는다.
  const packed = cols.filter(Boolean);
  for (const col of packed) col.sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
  return packed;
}

// ── 힘 기반 그래프 한 스텝 (연결 지도·프로젝트 그래프 뷰가 같이 쓴다) ────────────
// 순수 함수라 utils에 둔다(브라우저 없이 검사할 수 있게 — tests/logcheck.mjs).
// pos·vel을 제자리에서 고친다(매 프레임 3번 돌므로 새 배열을 만들면 GC가 튄다).
//
// **alpha 냉각(d3-force식 — Injoy 그래프에서 가져온 판단):** 힘을 전부 alpha로
// 스케일한다. 부르는 쪽이 alpha를 매 틱 줄이면 에너지가 잦아들며 출렁임 없이
// 멈춘다. 상수 감쇠만으로는 깨울 때마다 풀 에너지로 진동했다(사용자 지적 — "탱글").
//
//  node: { ax?: 0..1 x 앵커 비율 · ay?: 0..1 · fixed?: {x,y} 고정 노드 ·
//          repel?: 반발 배수 · pl/pr/pt/pb?: 경계 여유 ·
//          zx?: [0..1, 0..1] — x를 이 영역(비율) 안에만 가둔다(사람은 왼쪽,
//          프로젝트는 오른쪽 — 끌어도 남의 영역으로 못 나간다) }
//  edge: [aIdx, bIdx, 목표 길이(기본 90)]
//  opts: { alpha=1 · skip: 끌고 있거나 손으로 놓아둔(고정) 노드 index Set —
//          힘을 받지 않지만 남을 밀어내는 데는 참여한다 }
//  node.ak?: 앵커 배수(기본 1 — 그래프 뷰는 짜 둔 자리를 세게 지킨다)
//  node.box?: [반폭, 반높이] — **둘 다 상자가 있으면 겹치지 않게 민다**(2026-10-14 · PITFALLS 50-a).
//    척력은 점과 점 사이라 알약(글자 폭)·얼굴+이름 덩어리의 모양을 모른다 — 그래서 겹쳤다.
//    충돌은 alpha로 줄이지 않는다(d3 forceCollide와 같다): 식은 뒤에도 겹침은 풀린다.
//    덜 겹친 축으로 밀고, 그쪽이 벽에 막혔으면 다른 축으로 민다(좁은 층에서 옆으로 못 비키면 위아래로).
// 반환: 이 스텝에서 충돌로 민 양(px) — useForceGraph가 0이 될 때까지 루프를 이어 간다.
// ponytail: d3-force 대신 손 시뮬 — 노드 수십 개라 O(n²) 반발도 공짜다.
export function forceStep(pos, vel, nodes, edges, W, H, opts = {}) {
  const alpha = opts.alpha ?? 1;
  const skipSet = opts.skip;
  // **부드럽게**(사용자 지적 2026-08-31 — "모바일에서 탄성이 엄청난 그래프처럼 된다").
  // 같은 실행 안에서 상수만 바꿔 재고 골랐다(HANDOFF §2 '성능은 측정하지 않았다'의 A/B 규칙). 사람 15·팀 7·프로젝트 15,
  // 옛 상수(SPRING .02 · DAMP .8 · MAX_V 18) → 지금:
  //   최고 속도  52~54 → 18 px/프레임   (초기 폭발이 "탄성"으로 읽힌 주범)
  //   방향 반전  3.5~4.9 → 1.0~1.3 회/노드 (= 출렁임)
  //   총 이동    87~168 → 52~66 px/노드
  // 세 개가 각자 하는 일: DAMP(마찰)가 오버슈트를 먹고, MAX_V가 초기 폭발의 상한을
  // 낮추고, SPRING이 약해져 진동이 줄어든다. **냉각(alpha)은 그대로다** — 그건
  // 2026-08-27에 이미 고른 방식이고 여기서 바꾸는 것은 '한 틱이 얼마나 세냐'뿐이다.
  // REPEL은 안 낮췄다: 낮추면 라벨 겹침이 늘어난다(겹침은 지금 9 → 4로 줄었다).
  // 재보는 스크립트는 커밋하지 않았다 — 다시 재려면 그 A/B 규칙대로 상수만 바꿔 한 실행 안에서.
  const REPEL = 2400, SPRING = 0.013, ANCHOR_X = 0.022, ANCHOR_Y = 0.014, DAMP = 0.66, MAX_V = 6;
  const skip = (i) => nodes[i].fixed || (skipSet ? skipSet.has(i) : false);
  for (let i = 0; i < nodes.length; i++) {
    if (skip(i)) continue;
    let fx = 0, fy = 0;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
      const d2 = Math.max(120, dx * dx + dy * dy);
      const f = (REPEL * (nodes[i].repel || 1) * (nodes[j].repel || 1) * alpha) / d2;
      const d = Math.sqrt(d2);
      fx += (dx / d) * f; fy += (dy / d) * f;
    }
    const ak = nodes[i].ak ?? 1;
    fx += (W * (nodes[i].ax ?? 0.5) - pos[i].x) * ANCHOR_X * alpha * ak;
    fy += (H * (nodes[i].ay ?? 0.5) - pos[i].y) * ANCHOR_Y * alpha * ak;
    vel[i].x = (vel[i].x + fx) * DAMP; vel[i].y = (vel[i].y + fy) * DAMP;
  }
  for (const [a, b, L] of edges) {
    const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const f = (d - (L || 90)) * SPRING * alpha;
    const ux = dx / d, uy = dy / d;
    if (!skip(a)) { vel[a].x += ux * f; vel[a].y += uy * f; }
    if (!skip(b)) { vel[b].x -= ux * f; vel[b].y -= uy * f; }
  }
  const push = collide(pos, vel, nodes, W, H, skip);
  for (let i = 0; i < nodes.length; i++) {
    if (skip(i)) continue;
    // 속도 상한 — 가까운 두 점의 척력 스파이크에 튕겨 나가지 않게(Injoy와 같은 이유)
    const sp = Math.hypot(vel[i].x, vel[i].y);
    if (sp > MAX_V) { vel[i].x *= MAX_V / sp; vel[i].y *= MAX_V / sp; }
    const b = forceBounds(nodes[i], W, H);
    let nx = pos[i].x + vel[i].x, ny = pos[i].y + vel[i].y;
    // 벽에 닿으면 그 방향 속도를 죽인다 — 안 그러면 미는 힘에 눌려 가장자리에서 영영 떤다
    if (nx <= b.x0 || nx >= b.x1) vel[i].x = 0;
    if (ny <= b.y0 || ny >= b.y1) vel[i].y = 0;
    pos[i].x = Math.min(b.x1, Math.max(b.x0, nx));
    pos[i].y = Math.min(b.y1, Math.max(b.y0, ny));
  }
  return push;
}

// 상자 충돌(forceStep 안에서만) — 다음 자리(pos + vel)를 보고 속도로 민다. 자리를 바로
// 옮기면 다음 스텝의 속도가 도로 밀어 넣어 떤다(d3 forceCollide가 속도를 고치는 이유).
const COLLIDE = 0.5;
function collide(pos, vel, nodes, W, H, skip) {
  let push = 0;
  const at = (k, i) => pos[i][k] + (skip(i) ? 0 : vel[i][k]);
  for (let i = 0; i < nodes.length; i++) {
    const bi = nodes[i].box;
    if (!bi) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const bj = nodes[j].box;
      if (!bj || (skip(i) && skip(j))) continue;
      const dx = at('x', j) - at('x', i), dy = at('y', j) - at('y', i);
      const ox = bi[0] + bj[0] - Math.abs(dx), oy = bi[1] + bj[1] - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      // 벽에 막혔나 — i는 -dir, j는 +dir로 간다
      const blocked = (k, n, dir) => {
        const b = forceBounds(nodes[n], W, H);
        const lo = k === 'x' ? b.x0 : b.y0, hi = k === 'x' ? b.x1 : b.y1;
        return dir > 0 ? pos[n][k] >= hi - 0.5 : pos[n][k] <= lo + 0.5;
      };
      const tryAxis = (k) => {
        const d = k === 'x' ? dx : dy;
        const dir = d > 0 ? 1 : d < 0 ? -1 : (i % 2 ? -1 : 1);   // 딱 같은 자리면 번호로 갈라 선다
        let mi = skip(i) || blocked(k, i, -dir) ? 0 : 1;
        let mj = skip(j) || blocked(k, j, dir) ? 0 : 1;
        if (!mi && !mj) return false;
        const sum = mi + mj;
        const amt = COLLIDE * (k === 'x' ? ox : oy);
        vel[i][k] -= dir * amt * (mi / sum);
        vel[j][k] += dir * amt * (mj / sum);
        push += amt;
        return true;
      };
      const first = ox < oy ? 'x' : 'y';
      if (!tryAxis(first)) tryAxis(first === 'x' ? 'y' : 'x');
      // 위아래로만 밀면 꽉 찬 한 줄이 서로 밀고 당기며 굳는다(가운데 것은 위아래에서 같이 밀린다 —
      // 실측 지도 사람 14쌍이 그대로 멈췄다). 옆으로도 조금(¼) 비껴 줘서 옆 줄로 빠질 길을 연다.
      else if (first === 'y') {
        const dir = dx > 0 ? 1 : dx < 0 ? -1 : (i % 2 ? -1 : 1);
        const amt = COLLIDE * 0.25 * oy;
        const mi = skip(i) || blocked('x', i, -dir) ? 0 : 1, mj = skip(j) || blocked('x', j, dir) ? 0 : 1;
        if (mi + mj) { vel[i].x -= dir * amt * (mi / (mi + mj)); vel[j].x += dir * amt * (mj / (mi + mj)); }
      }
    }
  }
  return push;
}

// ── 같은 층 라벨을 세로로 떼어놓기 (연결 지도가 그릴 때만 쓴다) ────────────────
// **힘 배치는 겹치지 않음을 보장할 수 없다.** 척력을 세게 하면 노드가 영역 밖으로
// 밀리고, 약하면 라벨이 겹친다 — 실측으로 15개 프로젝트에서 4~9건이 겹쳤다
// (사용자 스크린샷의 그 상태). 그래서 **그릴 때** 한 번 떼어놓는다: 시뮬의 좌표는
// 그대로 두고(끌기가 어긋나지 않게) 화면에 앉히는 y만 최소 간격을 지키게 민다.
//
// 방법은 한 방향 훑기 두 번이다 — 위에서 아래로 밀어 간격을 벌리고, 아래가 넘치면
// 위로 되민다. 순서를 바꾸지 않으므로 팀별로 묶어 둔 배치가 흐트러지지 않는다.
// items: [{ i, y }] (y 오름차순일 필요 없음) → Map(i → 새 y)
export function spreadLabels(items, minGap, y0, y1) {
  const list = items.slice().sort((a, b) => a.y - b.y);
  const out = new Map();
  const n = list.length;
  if (!n) return out;
  const room = Math.max(0, y1 - y0);
  // 자리가 모자라면 균등 분배가 최선이다 — 간격을 줄여서라도 겹치지 않게 한다
  if ((n - 1) * minGap > room) {
    const g = n > 1 ? room / (n - 1) : 0;
    list.forEach((it, k) => out.set(it.i, y0 + k * g));
    return out;
  }
  const y = list.map(it => it.y);
  // ① 위 → 아래: 간격을 벌린다
  y[0] = Math.max(y[0], y0);
  for (let k = 1; k < n; k++) y[k] = Math.max(y[k], y[k - 1] + minGap);
  // ② 아래 → 위: 아래 경계를 넘긴 만큼 되민다. **간격을 지키면서** 되밀어야 한다 —
  //    예전에는 넘친 양을 한꺼번에 빼고 y0로 클램프했더니 **위 두 개가 경계에 뭉쳤다**
  //    (실측으로 '2026 워크스페이스 개선'과 '2026 월례회'가 같은 y였다).
  //    ①에서 자리가 충분함을 이미 걸렀으므로 이 패스가 y0 아래로 내려갈 수 없다.
  y[n - 1] = Math.min(y[n - 1], y1);
  for (let k = n - 2; k >= 0; k--) y[k] = Math.min(y[k], y[k + 1] - minGap);
  for (let k = 0; k < n; k++) out.set(list[k].i, Math.max(y0, y[k]));
  return out;
}

// ── 상자 떼어놓기 (연결 지도의 사람 층이 그릴 때만 · 2026-10-14) ───────────────
// spreadLabels는 y 한 줄로만 벌린다 — 사람은 좁은 층 안에 두 줄로도 서는데, 옆에 선
// 사람까지 위아래로 밀어 자리가 모자라면 균등 분배로 내려앉아 **이름이 남의 얼굴 밑에
// 깔렸다**(사용자 시안 2026-10-14). 여기서는 가로로 겹치는 상자끼리만 위아래로 민다.
// 시뮬(forceStep의 box)이 이미 겹침을 풀므로 보통은 아무것도 안 옮긴다 — 안전망이다.
// items: [{ i, x, y, hw, hh }] → Map(i → 새 y). 아래 경계를 넘으면 아래에서 위로 한 번 되민다.
export function spreadBoxes(items, y0, y1) {
  const out = new Map();
  if (!items.length) return out;
  // 1px 미만 겹침은 겹침이 아니다 — 시뮬이 남긴 소수점 겹침을 밀기 시작하면 한 줄 전체가 0.1px씩
  // 밀려 아래 경계를 넘고, 되밀기가 판 전체를 다시 세워 사람이 50px씩 튀었다(실측 2026-10-14).
  const hit = (a, b) => Math.abs(a.x - b.x) < a.hw + b.hw - 1 && Math.abs(a.y - b.y) < a.hh + b.hh - 1;
  const sweep = (list, down) => {
    const placed = [];
    for (const it of list) {
      const me = { ...it };
      for (let guard = 0; guard < list.length + 1; guard++) {
        const p = placed.find(q => hit(q, me));
        if (!p) break;
        me.y = down ? p.y + p.hh + me.hh : p.y - p.hh - me.hh;
      }
      placed.push(me);
    }
    return placed;
  };
  let list = items.map(it => ({ ...it, y: Math.max(y0, Math.min(y1, it.y)) })).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  list = sweep(list, true);
  if (list.some(it => it.y > y1 + 1)) {
    list = list.map(it => ({ ...it, y: Math.min(y1, it.y) })).sort((a, b) => (b.y - a.y) || (a.x - b.x));
    list = sweep(list, false);
  }
  for (const it of list) out.set(it.i, Math.max(y0, it.y));
  return out;
}

// ── 프로젝트 그래프 선 곡선 (depgraph의 edgeGeom이 그리고, depGraphLayout의 세로 흐름이 '알약 밑을 지나나'를 잰다) ──
// 흐름 방향 S곡선: 두 알약이 옆으로 떨어져 있으면(틈 10px 넘게) 가로로 나가 가로로 들어가고, 아니면 세로로.
// 끝점은 알약 가장자리(나가는 쪽 1px · 들어가는 쪽 1.5px 밖) · 선은 화살촉(길이 5) 뒤 4px에서 멈춘다(PITFALLS 80-a).
// A·B: { x, y, w } → { horiz, P: 3차 곡선 점 넷, tip: 화살촉 끝, dir }
export function edgeCurve(A, B, PH) {
  const horiz = Math.abs(B.x - A.x) - (A.w + B.w) / 2 > 10;
  let x1, y1, x2, y2, dir;
  if (horiz) {
    const sx = Math.sign(B.x - A.x) || 1;
    x1 = A.x + sx * (A.w / 2 + 1); x2 = B.x - sx * (B.w / 2 + 1.5); y1 = A.y; y2 = B.y; dir = [sx, 0];
  } else {
    const sy = Math.sign(B.y - A.y) || 1;
    y1 = A.y + sy * (PH / 2 + 1); y2 = B.y - sy * (PH / 2 + 1.5); x1 = A.x; x2 = B.x; dir = [0, sy];
  }
  const tip = [x2, y2];
  x2 -= dir[0] * 4; y2 -= dir[1] * 4;
  const k = horiz ? Math.max(16, Math.abs(x2 - x1) * 0.5) : Math.max(12, Math.abs(y2 - y1) * 0.5);
  const P = horiz
    ? [[x1, y1], [x1 + dir[0] * k, y1], [x2 - dir[0] * k, y2], [x2, y2]]
    : [[x1, y1], [x1, y1 + dir[1] * k], [x2, y2 - dir[1] * k], [x2, y2]];
  return { horiz, P, tip, dir };
}
// 곡선이 상자({ l, r, t, b })를 지나가나 — 24점으로 훑는다(1px 안쪽만 · 가장자리 스침은 겹침이 아니다)
export function curveHits(P, q) {
  for (let s = 0; s <= 24; s++) {
    const u = s / 24, v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
    const x = a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], y = a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1];
    if (x > q.l + 1 && x < q.r - 1 && y > q.t + 1 && y < q.b - 1) return true;
  }
  return false;
}

// 두 곡선이 서로 엇갈리나 — 8토막 꺾은선끼리 맞대 본다
export function curvesCross(P, Q) {
  const pts = (A) => Array.from({ length: 9 }, (_, s) => {
    const u = s / 8, v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
    return [a * A[0][0] + b * A[1][0] + c * A[2][0] + d * A[3][0], a * A[0][1] + b * A[1][1] + c * A[2][1] + d * A[3][1]];
  });
  const ccw = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const a = pts(P), b = pts(Q);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++)
    if (ccw(a[i], a[i + 1], b[j]) * ccw(a[i], a[i + 1], b[j + 1]) < 0 && ccw(b[j], b[j + 1], a[i]) * ccw(b[j], b[j + 1], a[i + 1]) < 0) return true;
  return false;
}

// ── 프로젝트 그래프의 자리 짜기 (depgraph · 2026-10-14 시안 'Graph') ───────────────
// 힘 배치만으로는 알약이 겹치고 판 가장자리에 줄지어 붙었다(점끼리 밀어내니 글자 폭을
// 모르고, 높이 고정이라 자리가 모자라면 벽에 눌린다). 그래서 **겹치지 않는 자리를 먼저
// 짜고** 힘 배치는 그 자리를 앵커로 삼아 끌기·자리 잡는 모션만 맡는다.
//  · 가로 흐름(넓은 판): 선후 깊이 = 열(왼쪽이 먼저). 열 간격이 알약보다 좁으면(s줄 톱니 · 셋까지) 옆 열과
//    실제로 부딪히는 알약만 한 줄 내린다(G16). 같은 열 안 차례는 앞 업무들의 차례를 물려받은 뒤 앞뒤 열 평균
//    자리로 다시 줄 세운다(G14 · 선 엇갈림 줄이기 · PITFALLS 80-c).
//  · 세로 흐름(톱니가 셋을 넘거나 · 폭 480 미만에서 톱니면): 선행보다 아래 줄. 칸(줄 × 갈래)에 하나씩 서고
//    선이 남의 알약 밑을 지나지 않는 칸을 고른다(80-e).
//  · 선이 없는 업무는 아래에 격자로 편다(예전의 '0열에 세로로만 쌓임'으로 돌아가지 않는다).
//  · 판 높이 = 짠 높이(최소 minH). 남는 높이는 줄 간격을 벌려(최대 2.4배) 채우고 가운데에 선다.
// 순수 함수 — 글자 폭은 부르는 쪽이 widthOf로 준다(브라우저 측정). 반환 { at: Map(id → {x, y}), H, mode }
export function depGraphLayout(tasks = [], W, o = {}) {
  const PH = o.PH ?? 28, GX = o.gapX ?? 16, GY = o.gapY ?? 12, PAD = o.pad ?? 14, PADY = o.padY ?? 22;
  const minH = o.minH ?? 360;
  const avail = Math.max(40, W - 2 * PAD);
  const wOf = (t) => Math.min(avail, o.widthOf ? o.widthOf(t) : 120);
  const list = tasks || [];
  const ids = new Set(list.map(t => t.id));
  const deps = (t) => (t.dependsOn || []).filter(d => d !== t.id && ids.has(d));
  const linked = new Set();
  list.forEach(t => deps(t).forEach(d => { linked.add(t.id); linked.add(d); }));
  const L = depLayers(list.filter(t => linked.has(t.id)));
  const loose = list.filter(t => !linked.has(t.id));
  // 뒤로 몇 단이 더 이어지나(사슬의 남은 길이) — 같은 자리를 두 업무가 원하면 사슬을 잇는 쪽이 갖는다
  const after = new Map();
  const tail = (id, seen = new Set()) => {
    if (after.has(id)) return after.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const next = list.filter(t => deps(t).includes(id));
    const v = next.length ? 1 + Math.max(...next.map(t => tail(t.id, seen))) : 0;
    after.set(id, v);
    return v;
  };
  const n = L.length;
  const grid = new Map();   // id → { x, row } (row는 줄 번호 — 엇갈린 칸만 소수)
  let rows = 0, mode = 'loose';
  // 같은 깊이 안에서 앞 업무가 선 자리(띠·x)를 물려받는다 — 사슬이 한 줄(한 길)로 이어져 선이 덜 엇갈린다.
  // 원하는 자리가 같으면 사슬을 더 길게 잇는 업무 → 원래 차례(마감일) 순.
  const wants = (col, place, first) => col.map((t, k) => {
    const p = deps(t).filter(x => place.has(x));
    return { t, k, pref: p.length ? p.reduce((sum, x) => sum + place.get(x), 0) / p.length : first(k), tail: tail(t.id) };
  }).sort((u, v) => (u.pref - v.pref) || (v.tail - u.tail) || (u.k - v.k));
  if (n) {
    const maxW = Math.max(...L.flat().map(wOf));
    let s = 1, colGap = 0;
    if (n > 1) {
      colGap = Math.min((avail - maxW) / (n - 1), maxW + GX + 120);   // 너무 벌리지도 않는다
      s = colGap >= maxW + GX ? 1 : Math.ceil((maxW + GX) / Math.max(1, colGap));
    }
    // 폰 폭(480 미만)에서 톱니면 열이 서로 겹쳐 뒤 업무가 앞 업무보다 위에 섰다 — 그때는 세로 흐름(80-e)
    if (s === 1 || (s <= 3 && W >= 480)) {
      mode = 'across';
      const x0 = PAD + maxW / 2 + (avail - maxW - (n - 1) * colGap) / 2;
      const band = new Map();
      L.forEach((col, d) => {
        const used = new Set(), rest = [];
        for (const it of wants(col, band, k => k)) {
          const b0 = Math.max(0, Math.round(it.pref));
          if (!used.has(b0)) { used.add(b0); band.set(it.t.id, b0); } else rest.push(it);
        }
        for (const it of rest) {   // 가장 가까운 빈 띠(아래 먼저)
          const b0 = Math.max(0, Math.round(it.pref));
          for (let k = 1; ; k++) {
            if (!used.has(b0 + k)) { used.add(b0 + k); band.set(it.t.id, b0 + k); break; }
            if (b0 - k >= 0 && !used.has(b0 - k)) { used.add(b0 - k); band.set(it.t.id, b0 - k); break; }
          }
        }
      });
      // 같은 열 차례를 앞뒤 열의 평균 자리로 네 번 다시 줄 세운다(G14 · barycenter — 앞→뒤로 선행 평균, 뒤→앞으로 후행 평균).
      // 물려받기만으로는 갈래가 갈린 뒤 선이 엇갈렸다. 다시 세운 차례가 곧 띠다(0부터 빈칸 없이).
      {
        const ord = L.map(col => col.map(t => t.id).sort((u, v) => band.get(u) - band.get(v)));
        const idx = new Map();
        const sync = () => ord.forEach(c => c.forEach((id, k) => idx.set(id, k)));
        const byId = new Map(list.map(t => [t.id, t]));
        const preds = (id) => deps(byId.get(id));
        const succs = (id) => list.filter(t => deps(t).includes(id)).map(t => t.id);
        const bary = (col, nb) => col.map((id, k) => {
          const ns = nb(id).filter(x => idx.has(x));
          return { id, k, v: ns.length ? ns.reduce((sum, x) => sum + idx.get(x), 0) / ns.length : k };
        }).sort((u, v) => (u.v - v.v) || (u.k - v.k)).map(x => x.id);
        sync();
        for (let it = 0; it < 4; it++) {
          for (let d = 1; d < n; d++) { ord[d] = bary(ord[d], preds); sync(); }
          for (let d = n - 2; d >= 0; d--) { ord[d] = bary(ord[d], succs); sync(); }
        }
        ord.forEach(c => c.forEach((id, k) => band.set(id, k)));
      }
      if (s > 1) {
        // 톱니(s줄)가 필요한 폭이면 **옆 열과 실제로 부딪히는 알약만** 한 줄 내린다(G16 — 예전에는 열마다 d % s줄씩 내려
        // 넓은 화면에 대각선 계단이 섰다). 띠 높이는 그 띠에서 실제로 쓴 줄 수만큼.
        const nb = Math.max(...band.values()) + 1;
        const off = new Map();
        let start = 0;
        for (let bi = 0; bi < nb; bi++) {
          const placed = [];
          let used = 1;
          L.forEach((col, d) => col.forEach(t => {
            if (band.get(t.id) !== bi) return;
            const x = x0 + d * colGap, w = wOf(t);
            let k = 0;
            while (placed.some(q => q.k === k && Math.abs(q.x - x) < (q.w + w) / 2 + GX)) k++;
            placed.push({ x, w, k });
            off.set(t.id, start + k);
            used = Math.max(used, k + 1);
          }));
          start += used;
        }
        L.forEach((col, d) => col.forEach(t => grid.set(t.id, { x: x0 + d * colGap, row: off.get(t.id) })));
        rows = start;
      } else {
        L.forEach((col, d) => col.forEach(t => grid.set(t.id, { x: x0 + d * colGap, row: band.get(t.id) })));
        rows = Math.max(...band.values()) + 1;
      }
    } else {
      mode = 'down';
      // 세로 흐름은 **칸(줄 × 갈래)**에 하나씩 선다 — 갈래 = 가장 넓은 알약이 한 줄에 몇 개 들어가나(폰은 둘).
      // 업무를 놓을 때마다 빈 칸들을 견줘 **자기 선이 남의 알약 밑을 지나거나, 남의 선이 자기 밑을 지나는** 칸을 피한다
      // (곡선은 그릴 때와 같은 edgeCurve로 잰다 · 그다음은 덜 내려가는 칸 · 선행과 같은 갈래 · PITFALLS 80-e).
      // 예전에는 깊이마다 한 줄(안 들어가면 하나씩 비껴 내려가는 길)이라 선이 사이 줄 알약 밑으로 깔렸다.
      const pitch = PH + GY;
      const lanes = Math.max(1, Math.min(4, Math.floor((avail + GX) / (Math.max(...L.flat().map(wOf)) + GX))));
      const node = (r, l, w) => ({ x: PAD + (avail * (l + 0.5)) / lanes, y: r * pitch, w, r, l });
      const boxOf = (p) => ({ l: p.x - p.w / 2, r: p.x + p.w / 2, t: p.y - PH / 2, b: p.y + PH / 2 });
      const order = L.flat();
      // 한 차례로 놓아 본다 — 선행이 다 놓인 업무 중 rank가 앞선 것부터. 반환 { at, cost }(칸마다 고른 값의 합 + 줄 수)
      const place = (rank) => {
        const at = new Map(), taken = new Set(), curves = [];
        let cost = 0;
        while (at.size < order.length) {
          const t = order.filter(u => !at.has(u.id) && deps(u).every(x => at.has(x) || !order.some(o => o.id === x))).sort(rank)[0]
            || order.find(u => !at.has(u.id));   // 순환이 남았으면 원래 차례로
          const ps = deps(t).filter(x => at.has(x)).map(x => at.get(x));
          const r0 = ps.length ? Math.max(...ps.map(p => p.r)) + 1 : 0;
          const want = ps.length ? ps.reduce((sum, p) => sum + p.l, 0) / ps.length : 0;
          let best = null;
          for (let r = r0; r <= r0 + 6 || !best; r++) for (let l = 0; l < lanes; l++) {
            if (taken.has(`${r},${l}`)) continue;
            const me = node(r, l, wOf(t)), mine = ps.map(p => ({ P: edgeCurve(p, me, PH).P, ends: [p, me] })), box = boxOf(me);
            const under = curves.filter(c => curveHits(c.P, box)).length
              + mine.reduce((sum, c) => sum + [...at.values()].filter(q => q !== c.ends[0] && curveHits(c.P, boxOf(q))).length, 0);
            const tangle = mine.reduce((sum, c) => sum + curves.filter(o => !o.ends.some(e => c.ends.includes(e)) && curvesCross(c.P, o.P)).length, 0);
            const v = under * 100 + tangle * 3 + (r - r0) * 2 + Math.abs(l - want);
            if (!best || v < best.v) best = { me, mine, v };
          }
          at.set(t.id, best.me); taken.add(`${best.me.r},${best.me.l}`); curves.push(...best.mine);
          cost += best.v;
        }
        return { at, cost: cost + Math.max(...[...at.values()].map(p => p.r)) };
      };
      // 차례 셋 중 가장 덜 엉킨 것 — 사슬을 길게 잇는 업무부터 · 깊이 차례 · 끝나는 업무부터. 한 차례만으로는
      // 먼저 놓인 업무가 뒤 업무의 곧은 자리를 막는 판이 남았다(수련회: 주보 PPT가 찬양 콘티 밑에 못 섰다).
      const root = (u) => +!deps(u).length, ix = (u) => order.indexOf(u);
      const { at } = [
        (u, v) => (root(v) - root(u)) || (tail(v.id) - tail(u.id)) || (ix(u) - ix(v)),
        (u, v) => ix(u) - ix(v),
        (u, v) => (root(v) - root(u)) || (tail(u.id) - tail(v.id)) || (ix(u) - ix(v)),
      ].map(place).reduce((m, x) => (x.cost < m.cost ? x : m));
      at.forEach((p, id) => grid.set(id, { x: p.x, row: p.r }));
      rows = Math.max(...[...at.values()].map(p => p.r)) + 1;
    }
  }
  if (loose.length) {
    // 선이 없는 업무는 판 전체에 격자로 편다(예전 격자 앵커와 같은 판단 — 높이가 아니라 면으로).
    // 열 수는 √(1.4·개수)쯤 · 한 줄에 들어가는 만큼까지. 마지막 줄은 가운데. 홀수 칸은 0.35줄 내려
    // 엇갈리게 — 반듯한 표가 아니라 흩어 놓은 쪽지로 읽힌다(옆 칸과는 칸 폭만큼 떨어져 안 겹친다).
    if (rows) rows += 1;   // 사슬 덩어리와 한 줄 띄운다
    const lw = Math.max(...loose.map(wOf));
    const fit = Math.max(1, Math.floor((avail + GX) / (lw + GX)));
    const c = Math.min(fit, loose.length, Math.max(1, Math.ceil(Math.sqrt(loose.length * 1.4))));
    const cell = avail / c;
    for (let r0 = 0; r0 < loose.length; r0 += c) {
      const line = loose.slice(r0, r0 + c);
      const off = ((c - line.length) * cell) / 2;
      line.forEach((t, k) => grid.set(t.id, { x: PAD + off + (k + 0.5) * cell, row: rows + (c > 1 && k % 2 ? 0.35 : 0) }));
      rows += 1;
    }
    if (c > 1 && loose.length > 1) rows += 0.35;
  }
  let pitch = PH + GY;
  const contentH = Math.max(0, rows - 1) * pitch + PH + 2 * PADY;
  const H = Math.max(minH, Math.ceil(contentH));
  if (rows > 1 && H > contentH) pitch = Math.min(pitch * 2.4, (H - 2 * PADY - PH) / (rows - 1));
  const top = (H - ((rows - 1) * pitch + PH)) / 2 + PH / 2;
  const at = new Map();
  grid.forEach((g, id) => at.set(id, { x: g.x, y: top + g.row * pitch }));
  return { at, H, mode };
}

// 노드 하나의 이동 가능 범위 — 시뮬과 드래그가 같은 규칙을 본다
// (드래그만 다른 규칙이면 끌어다 놓은 자리로는 못 가는 자리가 생긴다)
// drag=true면 **넓은 범위**(node.zxDrag)를 본다. 시뮬 범위(zx)는 층이 열로 읽히게
// 좁혀 두었는데 그 값으로 끌면 몇십 px에서 벽에 부딪혀 뻑뻑하다(사용자 지적
// 2026-08-31 — "드래그가 인위적"). 규칙이 둘이어도 안전한 이유: 놓은 노드는
// pinnedIds로 고정되므로 시뮬이 그 자리를 되돌리지 않는다. **층 밖으로는 여전히
// 못 나간다**(사용자 결정 2026-08-27) — 넓어진 것은 자기 층 안에서의 여유뿐이다.
export function forceBounds(node, W, H, drag = false) {
  const zx = (drag ? node.zxDrag : null) || node.zx;
  return {
    x0: Math.max(node.pl ?? 20, zx ? W * zx[0] : 0),
    x1: Math.min(W - (node.pr ?? 20), zx ? W * zx[1] : W),
    y0: node.pt ?? 20,
    y1: H - (node.pb ?? 16),
  };
}
