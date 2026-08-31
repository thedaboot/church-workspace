import { useEffect, useRef, useState, useCallback } from 'react';
import { forceStep, forceBounds } from '../utils.js';

// ============================================================================
// 힘 기반 그래프 훅 — 연결 지도(dashboardParts)와 프로젝트 그래프 뷰(depgraph)가 쓴다
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
// ============================================================================
const ALPHA_DECAY = 0.0228;   // ≈300틱에 수렴(d3 기본)
const ALPHA_MIN = 0.002;      // 이보다 식으면 정착 — 루프 종료
// 만질 때의 온기도 낮췄다(2026-08-31 · forceStep의 상수와 같은 이유) — 노드를 잡으면
// 이웃이 우르르 튀어 오르는 것이 "탄성"으로 읽혔다. 이웃은 따라오지만 느리게 온다.
const ALPHA_DRAG = 0.14;      // 드래그 중 유지할 온기
const ALPHA_WAKE = 0.2;       // 깨울 때 — 너무 높으면 튄다
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

export function useForceGraph({ nodes, edges, W, H, wrapRef, offX = 0, compact = false }) {
  const pRef = useRef([]);
  const velRef = useRef([]);
  const posById = useRef(new Map());     // 데이터가 바뀔 때 자리를 물려주기 위한 기억
  const pinnedIds = useRef(new Set());   // 손으로 놓아둔 노드 — 다시 움직이지 않는다
  const alphaRef = useRef(1);
  const rafRef = useRef(0);
  const framesRef = useRef(0);
  const dragRef = useRef(null);          // { i, sx, sy, moved }
  const swallowClickRef = useRef(false);
  const [, bump] = useState(0);          // pos는 ref에 있고, 이걸로만 다시 그린다

  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

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
      for (let k = 0; k < 3; k++) {
        forceStep(pRef.current, velRef.current, nodes, edges, W, H, { alpha: alphaRef.current, skip });
        // 냉각 — 드래그 중에는 온기를 유지해 이웃이 계속 따라온다
        alphaRef.current += ((dragRef.current ? ALPHA_DRAG : 0) - alphaRef.current) * ALPHA_DECAY;
      }
      bump(x => x + 1);
      framesRef.current++;
      if ((alphaRef.current > ALPHA_MIN || dragRef.current) && framesRef.current < MAX_FRAMES) {
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
    const remembered = posById.current;
    pRef.current = nodes.map((n, i) => {
      if (n.fixed) return { x: n.fixed.x, y: n.fixed.y };
      const old = remembered.get(n.id);
      if (old) {
        const b = forceBounds(n, W, H);
        return { x: Math.min(b.x1, Math.max(b.x0, old.x)), y: Math.min(b.y1, Math.max(b.y0, old.y)) };
      }
      return {
        x: W * (n.ax ?? 0.5) + ((i * 37) % 13) - 6,
        y: 24 + (n.iy ?? ((i * 61) % 97) / 97) * (H - 48),
      };
    });
    velRef.current = nodes.map(() => ({ x: 0, y: 0 }));
    alphaRef.current = 1;
    if (reduce) {
      const skip = skipSet();
      for (let i = 0; i < 600 && alphaRef.current > ALPHA_MIN; i++) {
        forceStep(pRef.current, velRef.current, nodes, edges, W, H, { alpha: alphaRef.current, skip });
        alphaRef.current -= alphaRef.current * ALPHA_DECAY;
      }
      bump(x => x + 1);
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
