import { useEffect, useRef, useState, useCallback } from 'react';
import { forceStep } from '../utils.js';

// ============================================================================
// 힘 기반 그래프 훅 — 연결 지도(dashboardParts)와 프로젝트 그래프 뷰(depgraph)가 쓴다
// ----------------------------------------------------------------------------
// · 자리 잡는 모션: 마운트 후 SETTLE 동안 rAF로 시뮬을 돌리고 멈춘다.
//   prefers-reduced-motion이면 동기로 수렴시켜 정착 상태를 바로 그린다.
// · 노드 드래그: fixed가 아닌 노드는 손으로 끌 수 있다(라벨이 겹치면 사용자가
//   직접 편다 — 사용자 요청, Injoy 그래프와 같은 감). 끌리는 동안 이웃이 밀려나고,
//   놓으면 짧게 다시 자리 잡는다. 4px 이상 움직였으면 그 노드의 click은 삼킨다
//   (끌기 끝에 업무 창이 열리면 안 된다).
// · 데이터가 바뀌어도(재조회·연도 전환) 같은 id의 노드는 자리를 지킨다 —
//   안 그러면 저장 한 번에 그래프가 통째로 다시 섞인다.
// ============================================================================
const SETTLE_MS = 2600;

export function useForceGraph({ nodes, edges, W, H, wrapRef, offX = 0 }) {
  const pRef = useRef([]);
  const velRef = useRef([]);
  const posById = useRef(new Map());   // 데이터가 바뀔 때 자리를 물려주기 위한 기억
  const rafRef = useRef(0);
  const deadlineRef = useRef(0);
  const dragRef = useRef(null);        // { i, sx, sy, moved }
  const swallowClickRef = useRef(false);
  const [, bump] = useState(0);        // pos는 ref에 있고, 이걸로만 다시 그린다

  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const kick = useCallback((ms = SETTLE_MS) => {
    deadlineRef.current = Math.max(deadlineRef.current, performance.now() + ms);
    if (rafRef.current) return;
    const tick = () => {
      const drag = dragRef.current;
      for (let k = 0; k < 3; k++) forceStep(pRef.current, velRef.current, nodes, edges, W, H, drag ? drag.i : -1);
      bump(x => x + 1);
      if (performance.now() < deadlineRef.current || dragRef.current) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = 0;
    };
    rafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, W, H]);

  useEffect(() => {
    // 초기 자리 — 같은 id는 이전 자리를 물려받고, 새 노드는 앵커 근처에 결정적으로 선다
    const remembered = posById.current;
    pRef.current = nodes.map((n, i) => {
      if (n.fixed) return { x: n.fixed.x, y: n.fixed.y };
      const old = remembered.get(n.id);
      if (old) return { ...old };
      return {
        x: W * (n.ax ?? 0.5) + ((i * 37) % 13) - 6,
        y: 24 + (n.iy ?? ((i * 61) % 97) / 97) * (H - 48),
      };
    });
    velRef.current = nodes.map(() => ({ x: 0, y: 0 }));
    if (reduce) {
      for (let i = 0; i < 320; i++) forceStep(pRef.current, velRef.current, nodes, edges, W, H);
      bump(x => x + 1);
    } else {
      kick();
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
        kick(800);
      },
      onPointerMove: (e) => {
        const d = dragRef.current;
        if (!d || d.i !== i) return;
        if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
        if (!d.moved || !wrapRef.current) return;
        const rect = wrapRef.current.getBoundingClientRect();
        const n = nodes[i];
        pRef.current[i].x = Math.min(W - (n.pr ?? 20), Math.max(n.pl ?? 20, e.clientX - rect.left - offX));
        pRef.current[i].y = Math.min(H - (n.pb ?? 16), Math.max(n.pt ?? 20, e.clientY - rect.top));
        velRef.current[i].x = 0; velRef.current[i].y = 0;
        if (reduce) bump(x => x + 1); else kick(800);
      },
      onPointerUp: () => {
        const d = dragRef.current;
        if (!d || d.i !== i) return;
        dragRef.current = null;
        swallowClickRef.current = d.moved;   // 끌었으면 곧 오는 click을 삼킨다
        if (!reduce) kick(1200);
      },
      // click은 pointerup 직후에 온다 — 끌기였으면 열지 않는다
      onClickCapture: (e) => {
        if (swallowClickRef.current) { swallowClickRef.current = false; e.preventDefault(); e.stopPropagation(); }
      },
    };
  };

  return { pos: pRef.current, bindDrag };
}
