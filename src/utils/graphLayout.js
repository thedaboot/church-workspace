// ============================================================================
// 그래프 배치 — 선후관계 열(depLayers · depgraph) · 힘 한 스텝(forceStep · useForceGraph) · 라벨 떼어놓기(spreadLabels · networkMap) · 이동 범위(forceBounds)
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
    fx += (W * (nodes[i].ax ?? 0.5) - pos[i].x) * ANCHOR_X * alpha;
    fy += (H * (nodes[i].ay ?? 0.5) - pos[i].y) * ANCHOR_Y * alpha;
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
