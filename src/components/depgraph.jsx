import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CONFIG, teamPaint } from '../config.js';
import { depLayers } from '../utils.js';
import { useForceGraph } from '../hooks/useForceGraph.js';
import { STATUS_DOT_VAR } from '../views/dashboardParts.jsx';

// ============================================================================
// 프로젝트 '그래프' 보기 — 업무 선후관계 (0020의 cards.depends_on)
// ----------------------------------------------------------------------------
// 예전에는 고정 열·행 배치라 **선행을 아무도 안 정하면 전부 0열에 세로로만
// 쌓였다**(사용자 지적 — 업무가 늘수록 높이만 늘었다). 지금은 연결 지도와 같은
// 힘 배치다(useForceGraph 공용): 높이 고정, 노드는 손으로 끌 수 있고,
// 선후 깊이(depLayers)는 x 앵커로만 남아 "왼쪽이 먼저"라는 읽기는 유지된다.
// 노드는 점 + 제목이다 — 카드 상자(190px)를 힘 배치에 그대로 두면 서로 밀어낼
// 자리가 안 나온다. 상세는 클릭해서 업무 창으로.
// ============================================================================
const DG = { H_DESK: 440, H_MOBILE: 360 };

// 업무가 하나도 없을 때 — 남는 공간의 **정가운데**에 표식과 함께 선다(사용자 요청
// 2026-08-31 — "글자만 위에 덩그러니가 아니라 로티 느낌으로 가운데에"). 로티 파일을
// 물리지 않고 SVG 한 장을 선으로 그린다(대시보드 '다 정리되었어요'와 같은 방식).
// 그림은 이 화면의 언어다 — 점 둘과 그 사이를 잇는 선(= 선후관계).
// 순서: 왼쪽 점 → 선 → 오른쪽 점. `.dc-draw-ring`(.28s) 다음에 선(.dc-draw)이
// 그려지고, 오른쪽 점은 선이 끝난 뒤다(§4.2 — 순서가 있는 애니메이션은 앞이 끝난 뒤).
function GraphEmptyMark() {
  return (
    <svg viewBox="0 0 96 48" className="w-24 h-12 mx-auto" aria-hidden="true">
      <circle className="dc-draw-ring" cx="16" cy="24" r="9"
        fill="var(--app-surface-hover)" stroke="var(--app-line)" strokeWidth="1.6"
        style={{ transformOrigin: '16px 24px' }} />
      <path className="dc-draw" pathLength="1" d="M27 24H69" style={{ animationDelay: '.28s' }}
        fill="none" stroke="var(--app-line)" strokeWidth="1.6" strokeLinecap="round" />
      <circle className="dc-draw-ring" cx="80" cy="24" r="9"
        fill="var(--app-surface-hover)" stroke="var(--app-line)" strokeWidth="1.6"
        style={{ transformOrigin: '80px 24px', animationDelay: '.72s' }} />
    </svg>
  );
}

// 빈 화면은 **남는 공간의 정가운데**다 — 위쪽에 붙어 있으면 아래가 통째로 비어
// 보인다(대시보드 마감 목록의 빈 상태와 같은 판단).
function GraphEmpty() {
  return (
    <div className="flex-1 min-h-[46vh] flex flex-col items-center justify-center text-center">
      <GraphEmptyMark />
      <p className="text-[13.5px] font-semibold text-fg mb-1 mt-3">아직 업무가 없어요</p>
      <p className="text-xs text-fg-faint">업무를 만들고 '선행 업무'를 정하면 여기서 순서를 볼 수 있어요</p>
    </div>
  );
}

export function DepGraph({ tasks, onTaskClick }) {
  const list = tasks || [];
  const hasEdges = list.some(t => (t.dependsOn || []).length);
  const compact = typeof window !== 'undefined' && window.innerWidth < 768;
  const H = compact ? DG.H_MOBILE : DG.H_DESK;
  const wrapRef = useRef(null);
  const [cw, setCw] = useState(compact ? 340 : 760);
  // 시뮬 폭은 980까지만 — 전폭(1400px)에 그대로 돌리면 깊이 앵커 사이가 너무 멀어
  // 오른쪽이 통째로 빈다(연결 지도와 같은 판단). 남는 폭은 여백으로 가운데 정렬.
  const W = Math.min(cw, 980);
  const offX = Math.max(0, (cw - W) / 2);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, edges, byId } = useMemo(() => {
    const cols = depLayers(list);
    const depthOf = new Map();
    cols.forEach((col, ci) => col.forEach(t => depthOf.set(t.id, ci)));
    const rowOf = new Map();
    cols.forEach(col => col.forEach((t, ri) => rowOf.set(t.id, (ri + 0.5) / col.length)));
    const nCols = Math.max(1, cols.length);
    // 앵커는 두 부류다 — 이 뷰를 바꾼 이유가 "연결 안 하면 높이만 쌓인다"였다.
    //  · 선이 있는 업무: 깊이(depLayers) → x 앵커. 왼쪽이 먼저라는 읽기.
    //  · 선이 없는 업무: 격자 앵커로 캔버스 전체에 편다(높이가 아니라 면으로).
    const linkedIds = new Set();
    list.forEach(t => (t.dependsOn || []).forEach(d => {
      if (d !== t.id && list.some(x => x.id === d)) { linkedIds.add(t.id); linkedIds.add(d); }
    }));
    const loose = list.filter(t => !linkedIds.has(t.id));
    const looseIdx = new Map(loose.map((t, k) => [t.id, k]));
    const gridCols = Math.max(2, Math.ceil(Math.sqrt(loose.length * 2)));
    const gridRows = Math.max(1, Math.ceil(loose.length / gridCols));
    const nodes = list.map(t => {
      const base = { id: t.id, t, repel: 2.2, pl: 78, pr: 82, pt: 22, pb: 20 };
      if (linkedIds.has(t.id) && nCols > 1) {
        const y = rowOf.get(t.id);
        return { ...base, ax: 0.14 + 0.72 * (depthOf.get(t.id) || 0) / (nCols - 1), ay: y, iy: y };
      }
      const k = looseIdx.get(t.id) ?? 0;
      const y = 0.1 + 0.8 * (Math.floor(k / gridCols) + 0.5) / gridRows;
      return { ...base, ax: 0.12 + 0.76 * ((k % gridCols) + 0.5) / gridCols, ay: y, iy: y };
    });
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const edges = [];
    // 선의 목표 길이는 **깊이 앵커 사이 간격**이다(연결 지도와 같은 수정 2026-08-31).
    // 고정값(180px)이면 열 간격(넓은 화면에서 350px 넘는다)과 싸워서 그래프가 계속
    // 출렁였다 — 실측으로 방향 반전이 노드당 4.9회에서 1회로 줄어든 그 자리다.
    // 두 열 이상 건너뛰는 선은 그만큼 길게 잡는다.
    const colGap = nCols > 1 ? (0.72 * W) / (nCols - 1) : 0;
    list.forEach(t => (t.dependsOn || []).forEach(d => {
      if (!idx.has(d) || d === t.id) return;
      const span = Math.max(1, (depthOf.get(t.id) ?? 0) - (depthOf.get(d) ?? 0));
      edges.push([idx.get(d), idx.get(t.id), Math.max(compact ? 110 : 150, colGap * span)]);
    }));
    return { nodes, edges, byId: new Map(list.map(t => [t.id, t])) };
    // W가 들어온 이유: 선의 목표 길이가 열 간격(폭에 비례)에서 나온다
  }, [list, compact, W]);

  const { pos, bindDrag } = useForceGraph({ nodes, edges, W, H, wrapRef, offX, compact });
  // **고른 노드는 인덱스가 아니라 id로 기억한다.** 인덱스로 들고 있으면 목록이 다시
  // 만들어질 때(사람이 가입하거나 실시간 재조회가 오거나 폭이 바뀔 때) 같은 번호가
  // **딴 노드**를 가리켜서, 아무것도 안 했는데 엉뚱한 프로젝트가 강조됐다
  // (사용자 지적 2026-08-31 — "가끔 다른 프로젝트가 갑자기 강조가 된다").
  // 그 노드가 사라졌으면 강조도 사라진다(찾지 못하면 null).
  const [hiId, setHiId] = useState(null);
  const hiIdx = hiId == null ? -1 : nodes.findIndex(n => n.id === hiId);
  const hi = hiIdx >= 0 ? hiIdx : null;
  // **호버는 진짜 마우스에만.** `onMouseEnter`는 터치에서도 브라우저가 흉내내 발생하고
  // `onMouseLeave`는 안 오는 경우가 있어서, 폰에서 한 번 만진 노드의 강조가 그대로
  // 남았다 — 스크롤하거나 딴 데를 눌러도 "갑자기 다른 프로젝트가 강조되는" 것으로
  // 보였다(사용자 지적 2026-08-31). pointerType으로 걸러서 **터치에는 호버가 아예
  // 없게** 한다. 터치에서 강조를 보는 길은 업무를 눌러 창을 여는 것이고,
  // 이 화면은 강조 자체가 마우스용 보조다(연결 지도와 같은 규칙 — 갈라 두지 말 것).
  const hoverProps = (id) => ({
    onPointerEnter: (e) => { if (e.pointerType === 'mouse') setHiId(id); },
    onPointerLeave: (e) => { if (e.pointerType === 'mouse') setHiId(null); },
  });

  const linked = useMemo(() => {
    if (hi == null) return null;
    const set = new Set([hi]);
    edges.forEach(([a, b]) => { if (a === hi) set.add(b); if (b === hi) set.add(a); });
    return set;
  }, [hi, edges]);

  if (!list.length) {
    return <GraphEmpty />;
  }
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="pb-2 shrink-0 flex items-center gap-2.5 flex-wrap">
        {/* 안내 줄은 빈 상태(연결이 하나도 없을 때)에만 — 그 외에는 붙이지 않는다
            (사용자 결정 2026-08-27). */}
        {!hasEdges && (
          <p className="text-[11px] text-fg-faint min-w-0">업무를 열어 '선행 업무'를 정하면 여기서 순서를 볼 수 있어요</p>
        )}
        <span className="flex-1" />
        <span className="hidden sm:flex items-center gap-2.5">
          {CONFIG.STATUSES.map(st => (
            <span key={st} className="inline-flex items-center gap-1.5 text-[10.5px] text-fg-muted">
              <span className="w-2 h-2 rounded-full" style={{ background: STATUS_DOT_VAR[st] }} />{st}
            </span>
          ))}
        </span>
      </div>
      <div className="rounded-[10px] shadow-soft select-none"
        style={{ border: '1px solid var(--app-line)', background: 'var(--app-surface)' }}>
        <div ref={wrapRef} className="relative" style={{ height: H }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHiId(null); }}>
          <svg className="absolute inset-0 pointer-events-none" width={cw} height={H} aria-hidden>
            {edges.map(([a, b], i) => {
              // 선행이 끝났으면 초록, 아직이면 회색 — "여기가 막혀 있다"가 색으로 보인다
              const done = byId.get(nodes[a].id)?.status === '완료';
              const on = hi != null && (a === hi || b === hi);
              const dim = hi != null && !on;
              const color = done ? 'var(--app-tag-green-fg)' : 'var(--app-ink-faint)';
              return (
                <g key={i} opacity={dim ? 0.12 : on ? 0.9 : done ? 0.75 : 0.5} style={{ transition: 'opacity 200ms' }}>
                  {(() => {
                    const x1 = offX + (pos[a]?.x || 0), y1 = pos[a]?.y || 0;
                    const x2 = offX + (pos[b]?.x || 0), y2 = pos[b]?.y || 0;
                    const bend = Math.min(26, Math.hypot(x2 - x1, y2 - y1) * 0.12);
                    return <path d={`M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 - bend} ${x2} ${y2}`}
                      fill="none" stroke={color} strokeWidth={on ? 1.8 : 1.3} />;
                  })()}
                  <circle cx={offX + (pos[b]?.x || 0)} cy={pos[b]?.y} r="2.6" fill={color} />
                </g>
              );
            })}
          </svg>
          {nodes.map((n, i) => {
            const P = pos[i];
            if (!P) return null;
            const t = n.t;
            const dim = linked && !linked.has(i);
            const drag = bindDrag(i);
            const done = t.status === '완료';
            return (
              <button key={n.id} type="button" {...drag}
                onClick={() => onTaskClick(t)}
                {...hoverProps(n.id)}
                title={`${t.title}${t.assignees?.length ? ` · ${t.assignees.join(', ')}` : ''} · ${t.status}`}
                // 연결 지도의 필과 같은 시각 언어 — [팀 레일 | 상태 점 | 제목].
                // 맨 점 + 밑 글자는 허전하고 무엇을 누르는지도 흐렸다(사용자 지적).
                className="absolute flex items-center gap-1.5 pl-1.5 pr-2.5 py-[5px] rounded-full bg-surface border border-line shadow-soft hover:shadow-elevated transition"
                style={{
                  left: offX + P.x, top: P.y, transform: 'translate(-50%, -50%)', cursor: 'grab',
                  opacity: dim ? 0.2 : done ? 0.55 : 1, transition: 'opacity 200ms, box-shadow 150ms', ...drag.style,
                }}>
                <span className="shrink-0 w-[3px] h-3.5 rounded-full pointer-events-none" style={teamPaint(t.teams, true)} />
                <span className="shrink-0 w-2 h-2 rounded-full pointer-events-none" style={{ background: STATUS_DOT_VAR[t.status] }} />
                <span className={`text-[11px] font-semibold leading-none text-fg truncate pointer-events-none ${compact ? 'max-w-[88px]' : 'max-w-[120px]'}`}>
                  {t.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
