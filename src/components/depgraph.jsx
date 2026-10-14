import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CONFIG, teamPaint } from '../config.js';
import { depGraphLayout } from '../utils.js';
import { useForceGraph, hoverProps, textPx, appFont } from '../hooks/useForceGraph.js';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import { STATUS_DOT_VAR } from '../views/dashboardParts.jsx';

// ============================================================================
// 프로젝트 '그래프' 보기 — 업무 선후관계 (0020의 cards.depends_on)
// ----------------------------------------------------------------------------
// 예전에는 고정 열·행 배치라 **선행을 아무도 안 정하면 전부 0열에 세로로만
// 쌓였다**(사용자 지적 — 업무가 늘수록 높이만 늘었다). 그 뒤 연결 지도와 같은
// 힘 배치(useForceGraph 공용)로 바꿨는데, 점끼리만 밀어내고 높이가 고정이라 알약이
// 겹치고 판 위아래 끝에 줄지어 눌렸다(2026-10-14 시안 'Graph' · PITFALLS 50-a·50-b).
// 지금은 **자리를 먼저 짠다**(utils.depGraphLayout — 넓은 판은 깊이 = 열(왼쪽이 먼저),
// 좁은 판은 깊이 = 줄(위가 먼저) · 선 없는 업무는 격자). 판 높이는 업무 수를 따라가고
// (폰 최소 360), 힘 배치는 그 자리를 앵커로 끌기·자리 잡는 모션·상자 충돌만 맡는다.
// 노드는 [팀 레일 | 상태 점 | 제목] 알약이다 — 폭 = 잰 글자 폭. 상세는 클릭해서 업무 창으로.
// ============================================================================
// 판 최소 높이(폰 360 · 넓은 판 440)와 알약 높이. 판 높이는 업무 수를 따라 늘어난다(depGraphLayout).
const DG = { H_DESK: 440, H_MOBILE: 360, PH: 28 };
// 알약에서 글자 밖 폭 — pl 6 · 레일 3 · 틈 6 · 점 8 · 틈 6 · pr 10 · 테두리 2 · 반올림 여유 2
const PILL_CHROME = 43;

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
  const reduce = useReducedMotion();
  const wrapRef = useRef(null);
  // **폭을 재기 전에는 짜지 않는다**(연결 지도와 같은 판단 — 짐작한 폭으로 짜 두면 진짜 폭이
  // 들어올 때 다시 짜여 한 번 더 움직인다). 레이아웃 이펙트라 첫 페인트 전에 잰다.
  const [cw, setCw] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => setCw(el.clientWidth < 200 ? 0 : el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list.length > 0]);
  // 짜는 폭은 8px 단위로 끊는다 — 몇 px 흔들림에 다시 짜이지 않게. 남는 몇 px은 좌우 여백(offX).
  const W = Math.floor(cw / 8) * 8;
  const offX = (cw - W) / 2;

  const { nodes, edges, byId, H } = useMemo(() => {
    const minH = compact ? DG.H_MOBILE : DG.H_DESK;
    if (!W) return { nodes: [], edges: [], byId: new Map(), H: minH };
    // 알약 폭 = 글자 폭 + 레일·점·여백(PILL_CHROME). 글자는 168px까지 — 폰은 두 알약이 한 줄에
    // 나란히 들어갈 만큼까지만(최소 88px). 이 폭이 그대로 알약 width가 된다 —
    // 짠 자리와 그려진 크기가 어긋나 겹치는 일이 없다.
    const textMax = compact ? Math.max(88, Math.min(168, Math.floor((W - 44) / 2) - PILL_CHROME)) : 168;
    const font = `600 12px ${appFont()}`;
    const widths = new Map(list.map(t => [t.id, Math.ceil(Math.min(textMax, textPx(t.title, font))) + PILL_CHROME]));
    const { at, H } = depGraphLayout(list, W, { widthOf: t => widths.get(t.id), PH: DG.PH, minH });
    const nodes = list.map((t, i) => {
      const p = at.get(t.id);
      const w = widths.get(t.id);
      return {
        id: t.id, t, w,
        // 짠 자리가 앵커다(세게 · ak) — 척력은 끌 때 이웃이 비켜서는 정도만 남긴다.
        ax: p.x / W, ay: p.y / H, ak: 4, repel: 0.3,
        // 상자(반폭·반높이)로 서로 밀어낸다 — 짠 간격(16 · 12)보다 조금 작게 잡아 제자리에서는 안 민다
        box: [w / 2 + 6, DG.PH / 2 + 4],
        pl: w / 2 + 4, pr: w / 2 + 4, pt: DG.PH / 2 + 4, pb: DG.PH / 2 + 4,
        // 짠 자리 곁(±6·±4px)에서 시작해 살짝 자리 잡는다 — 펼쳐지는 폭발 없이 모션만 남는다
        start: { x: p.x + ((i * 37) % 13) - 6, y: p.y + ((i * 23) % 9) - 4 },
      };
    });
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const edges = [];
    // 선의 목표 길이 = **두 앵커 사이 거리**. 스프링이 짠 자리와 싸우지 않아 가만히 있고,
    // 끌 때만 이웃을 당긴다(예전에 열 간격으로 잡던 것과 같은 이유 — 고정값이면 출렁였다).
    list.forEach(t => (t.dependsOn || []).forEach(d => {
      if (!idx.has(d) || d === t.id) return;
      const a = at.get(d), b = at.get(t.id);
      edges.push([idx.get(d), idx.get(t.id), Math.max(24, Math.hypot(b.x - a.x, b.y - a.y))]);
    }));
    return { nodes, edges, byId: new Map(list.map(t => [t.id, t])), H };
    // W가 들어온 이유: 자리를 폭에 맞춰 짠다
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
  // **호버는 진짜 마우스에만**(hooks/useForceGraph.js의 hoverProps — 연결 지도와 한 벌).
  // 터치에서 강조를 보는 길은 업무를 눌러 창을 여는 것이고, 이 화면은 강조 자체가
  // 마우스용 보조다.
  const hoverOn = hoverProps(setHiId);

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
          <p className="text-[11px] text-fg-muted min-w-0">업무를 열어 '선행 업무'를 정하면 여기서 순서를 볼 수 있어요</p>
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
        {/* 판 높이는 업무 수를 따라간다 — 바뀔 때 툭 늘지 않게 높이도 같은 곡선으로(움직임 줄이기면 즉시) */}
        <div ref={wrapRef} className="relative"
          style={{ height: H, transition: reduce ? 'none' : 'height .42s var(--ease-out-quint)' }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHiId(null); }}>
          <svg className="absolute inset-0 pointer-events-none overflow-visible" width={cw} height={H} aria-hidden>
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
                {...hoverOn(n.id)}
                title={`${t.title}${t.assignees?.length ? ` · ${t.assignees.join(', ')}` : ''} · ${t.status}`}
                // 연결 지도의 필과 같은 시각 언어 — [팀 레일 | 상태 점 | 제목].
                // 맨 점 + 밑 글자는 허전하고 무엇을 누르는지도 흐렸다(사용자 지적).
                className="absolute flex items-center gap-1.5 pl-1.5 pr-2.5 rounded-full bg-surface border border-line shadow-soft hover:shadow-elevated transition"
                style={{
                  left: offX + P.x, top: P.y, width: n.w, height: DG.PH, transform: 'translate(-50%, -50%)', cursor: 'grab',
                  opacity: dim ? 0.2 : 1, transition: 'opacity 200ms, box-shadow 150ms', ...drag.style,
                }}>
                {/* 끝낸 업무는 **안쪽만** 흐리게 — 필째 반투명이면 뒤를 지나는 선이 제목 위로 비친다(2026-10-15 실화면 확인) */}
                <span className="flex flex-1 min-w-0 items-center gap-1.5 pointer-events-none" style={{ opacity: done ? 0.55 : 1 }}>
                  <span className="shrink-0 w-[3px] h-3.5 rounded-full" style={teamPaint(t.teams, true)} />
                  <span className="shrink-0 w-2 h-2 rounded-full" style={{ background: STATUS_DOT_VAR[t.status] }} />
                  <span className="flex-1 min-w-0 text-[12px] font-semibold leading-none text-fg truncate">
                    {t.title}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
