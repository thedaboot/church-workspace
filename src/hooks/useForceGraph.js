import { useEffect, useRef, useState, useCallback } from 'react';
import { forceStep, forceBounds } from '../utils.js';
import { prefersReducedMotion } from './useReducedMotion.js';

// ============================================================================
// 힘 기반 그래프 훅 — 연결 지도(components/networkMap)와 프로젝트 그래프 뷰(depgraph)가 쓴다
// ----------------------------------------------------------------------------
// · **alpha 냉각**(utils.forceStep 주석): 마운트 때 1에서 시작해 매 틱 식는다.
//   식으면 루프가 스스로 멈추고, 드래그가 살짝 데운다(0.3) — 이웃이 따라오되
//   출렁이지 않는다. 시간제한이 아니라 에너지로 멈추므로 "탱글"이 없다(사용자 지적).
// · **놓은 노드는 그 자리에 고정된다**(사용자 결정 — 다시 제자리로 돌아가지 않는다).
//   고정돼도 남을 밀어내는 데는 참여한다. 데이터가 바뀌어도 id로 자리·고정을 지킨다.
// · 드래그도 시뮬과 같은 이동 범위(forceBounds)를 본다 — 사람·프로젝트는 각자의
//   영역(zx) 밖으로 끌어낼 수 없다.
// · 4px 이상 움직였으면 그 노드의 click은 삼킨다(끌기 끝에 업무 창이 열리면 안 된다).
// · prefers-reduced-motion이면 동기로 수렴시켜 정착 상태를 바로 그린다.
// · 상자(node.box)가 겹쳐 있는 동안은 식었어도 루프를 잇는다(PUSH_MIN · PITFALLS 50-a).
// · 이미 그려진 자리에서 다시 짤 때(업무 추가 · 폭·높이 변경)는 미리 돌리지 않고 미끄러진다(50-c).
// · glideMs를 주면(그래프 뷰 · G18 · PITFALLS 80-c) 다시 짤 때 힘으로 미끄러지지 않고 **도착 자리를 먼저 풀어 두고**
//   그 시간(quint) 동안 옛 자리 → 새 자리로 옮긴다. 선도 매 프레임 자리를 따라가 알약에 붙어 있다. 끌기를 시작하면 그 자리에서 멈춘다.
// · 글자 폭 재기(textPx · appFont)도 여기 — 알약·이름 상자의 크기를 두 화면이 같은 식으로 잰다.
// ============================================================================
const ALPHA_DECAY = 0.0228;   // ≈300틱에 수렴(d3 기본)
const ALPHA_MIN = 0.002;      // 이보다 식으면 정착 — 루프 종료
// 만질 때의 온기도 낮췄다(2026-08-31 · forceStep의 상수와 같은 이유) — 노드를 잡으면
// 이웃이 우르르 튀어 오르는 것이 "탄성"으로 읽혔다. 이웃은 따라오지만 느리게 온다.
const ALPHA_DRAG = 0.14;      // 드래그 중 유지할 온기
const ALPHA_WAKE = 0.2;       // 깨울 때 — 너무 높으면 튄다
const ALPHA_RESUME = 0.4;     // 그려진 자리에서 다시 짤 때(데이터·폭·높이가 바뀜) — 새 앵커까지 갈 만큼만
const MAX_FRAMES = 900;       // 무한 rAF 방지 백스톱

// **첫 페인트 전에 조용히 미리 돌린다**(2026-08-31 · 사용자 지적 "모바일에서 갑자기
// 촥 펼쳐지는 느낌, 탄성이 엄청 느껴진다"). 상수를 부드럽게 잡은 뒤에도 남아 있던
// 것은 **초기 폭발**이었다 — 노드가 거의 같은 x에 쌓여 시작하니 척력이 30프레임쯤
// 옆으로 밀어내고, 그 구간이 "펼쳐짐"으로 읽혔다. 실측(사람 15·팀 7·프로젝트 15):
//   보이는 첫 20프레임 이동 57px/노드 → (미리 0.3까지) 6px · 최고 18 → 3.7px/프레임
// alpha가 이 값까지 식을 동안은 안 그리고, **잦아드는 꼬리만** 애니메이션으로 보인다.
// 그래서 "자리 잡는 모션"은 남고(사용자가 좋다고 한 것) 폭발만 사라진다.
// 모바일을 더 낮게 두는 이유: 폭이 좁아 같은 힘에도 노드가 더 크게 흔들려 보인다.
const SETTLE_DESK = 0.55;
const SETTLE_MOBILE = 0.3;
const PRE_GUARD = 400;        // 미리 돌리는 루프의 백스톱
// 상자 충돌(forceStep의 node.box)이 이만큼(px/프레임) 넘게 밀고 있으면 식었어도 루프를 잇는다 —
// alpha만 보고 멈추면 겹침이 반쯤 풀린 채 굳는다(2026-10-14 · PITFALLS 50-a).
const PUSH_MIN = 0.05;

// 앱 quint(index.css --ease-out-quint = cubic-bezier(.16, 1, .3, 1))를 JS로 — 시간 비율 → 진행 비율(이분법으로 x를 푼다)
const QX1 = 0.16, QY1 = 1, QX2 = 0.3, QY2 = 1;
const bz = (p1, p2, s) => 3 * p1 * s * (1 - s) ** 2 + 3 * p2 * s * s * (1 - s) + s ** 3;
export function easeOutQuint(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let lo = 0, hi = 1, s = t;
  for (let k = 0; k < 24; k++) { s = (lo + hi) / 2; if (bz(QX1, QX2, s) < t) lo = s; else hi = s; }
  return bz(QY1, QY2, s);
}

export function useForceGraph({ nodes, edges, W, H, wrapRef, offX = 0, compact = false, glideMs = 0 }) {
  const pRef = useRef([]);
  const velRef = useRef([]);
  const posById = useRef(new Map());     // 데이터가 바뀔 때 자리를 물려주기 위한 기억
  const pinnedIds = useRef(new Set());   // 손으로 놓아둔 노드 — 다시 움직이지 않는다
  const alphaRef = useRef(1);
  const rafRef = useRef(0);
  const glideRef = useRef(0);            // 다시 짠 자리로 옮기는 rAF(glideMs)
  const framesRef = useRef(0);
  const dragRef = useRef(null);          // { i, sx, sy, moved }
  const swallowClickRef = useRef(false);
  const [, bump] = useState(0);          // pos는 ref에 있고, 이걸로만 다시 그린다

  const reduce = prefersReducedMotion();   // hooks/useReducedMotion.js 한 벌

  const skipSet = useCallback(() => {
    const set = new Set();
    nodes.forEach((n, i) => { if (pinnedIds.current.has(n.id)) set.add(i); });
    if (dragRef.current) set.add(dragRef.current.i);
    return set;
  }, [nodes]);

  const kick = useCallback((warm = ALPHA_WAKE) => {
    alphaRef.current = Math.max(alphaRef.current, warm);
    framesRef.current = 0;
    if (rafRef.current) return;
    const tick = () => {
      const skip = skipSet();
      let push = 0;
      for (let k = 0; k < 3; k++) {
        push += forceStep(pRef.current, velRef.current, nodes, edges, W, H, { alpha: alphaRef.current, skip }) || 0;
        // 냉각 — 드래그 중에는 온기를 유지해 이웃이 계속 따라온다
        alphaRef.current += ((dragRef.current ? ALPHA_DRAG : 0) - alphaRef.current) * ALPHA_DECAY;
      }
      bump(x => x + 1);
      framesRef.current++;
      if ((alphaRef.current > ALPHA_MIN || dragRef.current || push > PUSH_MIN) && framesRef.current < MAX_FRAMES) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = 0;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, W, H, skipSet]);

  useEffect(() => {
    // 초기 자리 — 같은 id는 이전 자리를 물려받고, 새 노드는 앵커 근처에 결정적으로 선다
    // (n.start가 있으면 그 자리 — 그래프 뷰는 짜 둔 자리 곁에서 시작해 살짝만 움직인다)
    const remembered = posById.current;
    let resumed = 0;
    pRef.current = nodes.map((n, i) => {
      if (n.fixed) return { x: n.fixed.x, y: n.fixed.y };
      const old = remembered.get(n.id);
      if (old) {
        resumed++;
        const b = forceBounds(n, W, H);
        return { x: Math.min(b.x1, Math.max(b.x0, old.x)), y: Math.min(b.y1, Math.max(b.y0, old.y)) };
      }
      if (n.start) return { x: n.start.x, y: n.start.y };
      return {
        x: W * (n.ax ?? 0.5) + ((i * 37) % 13) - 6,
        y: 24 + (n.iy ?? ((i * 61) % 97) / 97) * (H - 48),
      };
    });
    velRef.current = nodes.map(() => ({ x: 0, y: 0 }));
    alphaRef.current = 1;
    if (reduce) {
      const skip = skipSet();
      for (let i = 0, push = 1; i < 1200 && (alphaRef.current > ALPHA_MIN || push > PUSH_MIN); i++) {
        push = forceStep(pRef.current, velRef.current, nodes, edges, W, H, { alpha: alphaRef.current, skip }) || 0;
        alphaRef.current -= alphaRef.current * ALPHA_DECAY;
      }
      bump(x => x + 1);
    } else if (resumed && glideMs) {
      // 도착 자리를 동기로 풀어 두고(움직임 줄이기 갈래와 같은 수렴) 옛 자리에서 glideMs 동안 quint로 옮긴다.
      const from = pRef.current.map(p => ({ x: p.x, y: p.y }));
      const skip = skipSet();
      alphaRef.current = ALPHA_RESUME;
      for (let i = 0, push = 1; i < 1200 && (alphaRef.current > ALPHA_MIN || push > PUSH_MIN); i++) {
        push = forceStep(pRef.current, velRef.current, nodes, edges, W, H, { alpha: alphaRef.current, skip }) || 0;
        alphaRef.current -= alphaRef.current * ALPHA_DECAY;
      }
      const to = pRef.current.map(p => ({ x: p.x, y: p.y }));
      pRef.current.forEach((p, i) => { p.x = from[i].x; p.y = from[i].y; });
      velRef.current = nodes.map(() => ({ x: 0, y: 0 }));
      const t0 = performance.now();
      const step = (now) => {
        const e = easeOutQuint(Math.max(0, now - t0) / glideMs);
        pRef.current.forEach((p, i) => { p.x = from[i].x + (to[i].x - from[i].x) * e; p.y = from[i].y + (to[i].y - from[i].y) * e; });
        bump(x => x + 1);
        glideRef.current = e < 1 ? requestAnimationFrame(step) : 0;
      };
      glideRef.current = requestAnimationFrame(step);
    } else if (resumed) {
      // **이미 그려진 자리에서 이어 간다**(2026-10-14 — 업무가 늘거나 폭·높이가 바뀔 때).
      // 미리 돌리기를 하면 첫 페인트 전에 노드가 수십 px 옮겨 앉아 '툭' 튄다 — 여기서는
      // 보이는 채로 새 자리까지 미끄러진다(미리 돌리기는 처음 그릴 때의 폭발만 감춘다).
      alphaRef.current = ALPHA_RESUME;
      kick(ALPHA_RESUME);
    } else {
      // 폭발 구간을 첫 페인트 전에 흘려보낸다(SETTLE_* 주석). 37개 노드로 16프레임쯤
      // 이라 몇 ms다 — rAF 밖에서 돌아도 화면이 밀리지 않는다.
      const settle = compact ? SETTLE_MOBILE : SETTLE_DESK;
      const skip = skipSet();
      let guard = 0;
      while (alphaRef.current > settle && guard++ < PRE_GUARD) {
        for (let k = 0; k < 3; k++) {
          forceStep(pRef.current, velRef.current, nodes, edges, W, H, { alpha: alphaRef.current, skip });
          alphaRef.current -= alphaRef.current * ALPHA_DECAY;
        }
      }
      kick(alphaRef.current);   // 남은 온기로만 애니메이션 — 잦아드는 꼬리다
    }
    return () => {
      nodes.forEach((n, i) => { if (!n.fixed && pRef.current[i]) posById.current.set(n.id, pRef.current[i]); });
      cancelAnimationFrame(rafRef.current); rafRef.current = 0;
      cancelAnimationFrame(glideRef.current); glideRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, W, H, compact]);

  // 노드에 펼쳐 붙이는 드래그 핸들러. fixed 노드는 빈 객체(끌 수 없다).
  const bindDrag = (i) => {
    if (nodes[i]?.fixed) return {};
    return {
      style: { touchAction: 'none' },   // 터치에서 스크롤이 드래그를 뺏지 않게
      onPointerDown: (e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        // 옮기는 중이면 그 자리에서 멈춘다(glideMs) — 그 뒤는 예전처럼 힘 배치가 잇는다
        if (glideRef.current) { cancelAnimationFrame(glideRef.current); glideRef.current = 0; }
        // **잡은 지점과 노드 중심의 차이를 기억한다**(2026-08-31 사용자 지적 — "드래그가
        // 인위적인 느낌"). 예전에는 노드 **중심**을 손가락 좌표에 그대로 앉혀서, 라벨
        // 귀퉁이를 잡으면 라벨이 손가락으로 순간이동했다. 그 텔레포트가 인위적이었다.
        // 차이를 유지하면 잡은 자리가 손가락에 붙어 따라온다.
        const rect = wrapRef.current?.getBoundingClientRect();
        const p = pRef.current[i];
        dragRef.current = {
          i, sx: e.clientX, sy: e.clientY, moved: false,
          gx: rect && p ? (e.clientX - rect.left - offX) - p.x : 0,
          gy: rect && p ? (e.clientY - rect.top) - p.y : 0,
        };
        kick(ALPHA_DRAG);
      },
      onPointerMove: (e) => {
        const d = dragRef.current;
        if (!d || d.i !== i) return;
        if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
        if (!d.moved || !wrapRef.current) return;
        const rect = wrapRef.current.getBoundingClientRect();
        // 끌 때는 **넓은 범위**를 본다(forceBounds의 drag). 시뮬 범위(zx)는 층이 열로
        // 읽히게 좁혀 두었는데, 그 좁은 값으로 끌면 몇십 px에서 벽에 부딪혀 뻑뻑하다.
        // 놓은 노드는 고정되므로(pinnedIds) 시뮬이 되돌리지 않는다 — 규칙이 갈라져도
        // "끌어다 놓은 자리로 못 가는" 옛 문제가 생기지 않는 이유다.
        const b = forceBounds(nodes[i], W, H, true);
        pRef.current[i].x = Math.min(b.x1, Math.max(b.x0, e.clientX - rect.left - offX - d.gx));
        pRef.current[i].y = Math.min(b.y1, Math.max(b.y0, e.clientY - rect.top - d.gy));
        velRef.current[i].x = 0; velRef.current[i].y = 0;
        if (reduce) bump(x => x + 1); else kick(ALPHA_DRAG);
      },
      onPointerUp: () => {
        const d = dragRef.current;
        if (!d || d.i !== i) return;
        dragRef.current = null;
        swallowClickRef.current = d.moved;
        // 놓은 자리에 그대로 둔다(사용자 결정) — 이후 어떤 힘도 이 노드를 못 옮긴다
        if (d.moved) pinnedIds.current.add(nodes[i].id);
        if (!reduce) kick(ALPHA_DRAG);   // 이웃만 마저 자리 잡고 식는다
      },
      onClickCapture: (e) => {
        if (swallowClickRef.current) { swallowClickRef.current = false; e.preventDefault(); e.stopPropagation(); }
      },
    };
  };

  return { pos: pRef.current, bindDrag };
}

// 노드 강조(호버) 핸들러 공장 — 연결 지도와 그래프 뷰가 같은 규칙을 쓴다(갈라 두지 말 것).
// **호버는 진짜 마우스에만.** `onMouseEnter`는 터치에서도 브라우저가 흉내내 발생하고
// `onMouseLeave`는 안 오는 경우가 있어서, 폰에서 한 번 만진 노드의 강조가 그대로
// 남았다 — 스크롤하거나 딴 데를 눌러도 "갑자기 다른 프로젝트가 강조되는" 것으로
// 보였다(사용자 지적 2026-08-31). pointerType으로 걸러서 **터치에는 호버가 아예 없게** 한다.
// 쓰는 법: `const hoverOn = hoverProps(setHiId);` → `<g {...hoverOn(n.id)}>`
export const hoverProps = (setHiId) => (id) => ({
  onPointerEnter: (e) => { if (e.pointerType === 'mouse') setHiId(id); },
  onPointerLeave: (e) => { if (e.pointerType === 'mouse') setHiId(null); },
});

// 글자 폭(px) — 그래프 알약·연결 지도 이름의 상자(forceStep의 box) 크기를 잰다(2026-10-14).
// 캔버스 하나를 돌려 쓴다. 글꼴은 앱 본문 글꼴(--font-sans)이다.
let measureCtx = null;
export function textPx(text, font) {
  const s = String(text || '');
  if (typeof document === 'undefined') return s.length * 11;
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(s).width;
}
export const appFont = () => (typeof document === 'undefined' ? 'sans-serif' : getComputedStyle(document.body).fontFamily);
