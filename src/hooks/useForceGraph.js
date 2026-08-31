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

export function useForceGraph({ nodes, edges, W, H, wrapRef, offX = 0 }) {
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
      kick(1);
    }
    return () => {
      nodes.forEach((n, i) => { if (!n.fixed && pRef.current[i]) posById.current.set(n.id, pRef.current[i]); });
      cancelAnimationFrame(rafRef.current); rafRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, W, H]);

  // 노드에 펼쳐 붙이는 드래그 핸들러. fixed 노드는 빈 객체(끌 수 없다).
  const bindDrag = (i) => {
    if (nodes[i]?.fixed) return {};
    return {
      style: { touchAction: 'none' },   // 터치에서 스크롤이 드래그를 뺏지 않게
      onPointerDown: (e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragRef.current = { i, sx: e.clientX, sy: e.clientY, moved: false };
        kick(ALPHA_DRAG);
      },
      onPointerMove: (e) => {
        const d = dragRef.current;
        if (!d || d.i !== i) return;
        if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
        if (!d.moved || !wrapRef.current) return;
        const rect = wrapRef.current.getBoundingClientRect();
        const b = forceBounds(nodes[i], W, H);
        pRef.current[i].x = Math.min(b.x1, Math.max(b.x0, e.clientX - rect.left - offX));
        pRef.current[i].y = Math.min(b.y1, Math.max(b.y0, e.clientY - rect.top));
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
