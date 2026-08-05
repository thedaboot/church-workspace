import React from 'react';
import { CONFIG, teamPaint } from '../config.js';
import { depLayers } from '../utils.js';
import { STATUS_DOT_VAR } from '../views/dashboardParts.jsx';

// ============================================================================
// 프로젝트 '그래프' 보기 — 업무 선후관계 (0020의 cards.depends_on)
// ----------------------------------------------------------------------------
// 선행 업무보다 오른쪽 열에 오도록 배치한다(utils.depLayers). 열·행이 고정 크기라
// 좌표를 렌더와 같은 상수로 계산한다 — force 시뮬레이션도, 측정도 없다.
// 캔버스가 화면보다 크면 양방향 스크롤이다(보드가 가로로 밀리는 것과 같은 취급).
// ============================================================================

const G = { COL_W: 210, GAP_X: 56, ROW_H: 64, NODE_W: 190, NODE_H: 52, PAD: 14 };

export function DepGraph({ tasks, onTaskClick }) {
  const cols = depLayers(tasks || []);
  const hasEdges = (tasks || []).some(t => (t.dependsOn || []).length);
  // 좌표: pos[id] = {x, y} (노드 왼쪽 위)
  const pos = new Map();
  cols.forEach((col, ci) => col.forEach((t, ri) => {
    pos.set(t.id, { x: G.PAD + ci * (G.COL_W + G.GAP_X), y: G.PAD + ri * G.ROW_H });
  }));
  const W = G.PAD * 2 + Math.max(1, cols.length) * G.COL_W + Math.max(0, cols.length - 1) * G.GAP_X;
  const H = G.PAD * 2 + Math.max(1, ...cols.map(c => c.length)) * G.ROW_H;
  const byId = new Map((tasks || []).map(t => [t.id, t]));

  if (!(tasks || []).length) {
    return <p className="py-16 text-center text-[11px] text-fg-faint">아직 업무가 없어요</p>;
  }
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 아직 아무도 선후를 정하지 않았으면 사용법이 곧 빈 상태 안내다 */}
      {!hasEdges && (
        <p className="pb-2 text-[11px] text-fg-faint shrink-0">
          업무를 열어 '선행 업무'를 정하면 여기에 순서가 이어져요
        </p>
      )}
      <div className="flex-1 min-h-0 overflow-auto rounded-[10px] shadow-soft"
        style={{ border: '1px solid var(--app-line)', background: 'var(--app-surface)', overscrollBehaviorX: 'none' }}>
        <div className="relative" style={{ width: W, height: H }}>
          <svg className="absolute inset-0 pointer-events-none" width={W} height={H} aria-hidden>
            {(tasks || []).flatMap(t => (t.dependsOn || [])
              .filter(d => pos.has(d) && d !== t.id)
              .map(d => {
                const from = pos.get(d), to = pos.get(t.id);
                const x1 = from.x + G.NODE_W, y1 = from.y + G.NODE_H / 2;
                const x2 = to.x, y2 = to.y + G.NODE_H / 2;
                // 선행이 끝났으면 초록 실선, 아직이면 회색 — "여기가 막혀 있다"가 색으로 보인다
                const done = byId.get(d)?.status === '완료';
                return (
                  <g key={`${d}-${t.id}`}>
                    <path d={`M ${x1} ${y1} C ${x1 + G.GAP_X / 2} ${y1}, ${x2 - G.GAP_X / 2} ${y2}, ${x2} ${y2}`}
                      fill="none" strokeWidth="1.3"
                      stroke={done ? 'var(--app-tag-green-fg)' : 'var(--app-ink-faint)'}
                      opacity={done ? 0.75 : 0.55} />
                    <circle cx={x2} cy={y2} r="2.4" fill={done ? 'var(--app-tag-green-fg)' : 'var(--app-ink-faint)'} />
                  </g>
                );
              }))}
          </svg>
          {cols.flatMap(col => col.map(t => {
            const p = pos.get(t.id);
            return (
              <button key={t.id} type="button" onClick={() => onTaskClick(t)}
                className="absolute flex items-center gap-2 px-2.5 text-left rounded-[8px] hover:bg-surface-hover transition-colors"
                style={{ left: p.x, top: p.y, width: G.NODE_W, height: G.NODE_H,
                  border: '1px solid var(--app-line)', background: 'var(--app-surface)' }}>
                <span className="shrink-0 w-[3px] h-7 rounded-full" style={teamPaint(t.teams, true)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold text-fg truncate"
                    style={{ opacity: t.status === '완료' ? 0.55 : 1 }}>{t.title}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-fg-faint">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ background: STATUS_DOT_VAR[t.status] }} />
                    {t.status}{t.assignees?.[0] ? ` · ${t.assignees[0]}` : ''}
                  </span>
                </span>
              </button>
            );
          }))}
        </div>
      </div>
    </div>
  );
}
