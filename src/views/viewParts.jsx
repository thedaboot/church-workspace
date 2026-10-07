import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { CONFIG, teamColor, teamBgColor } from '../config.js';

// ============================================================================
// 업무 화면들(대시보드 · 프로젝트 · 전체 일정 · 내 업무 · 팀 보드)이 같이 쓰는 작은 셈과 부품.
// views.jsx · dashboardView.jsx · projectView.jsx가 여기서 가져간다 — 화면 파일끼리 서로 import하지
// 않게(2026-10-07 19차에 views.jsx를 셋으로 갈랐다).
// ============================================================================

// ── 두 화면 이상에서 쓰는 셈들 ──────────────────────────────────────────────
// 같은 값을 화면마다 따로 계산해 두면 한쪽만 고쳐져서 두 화면이 다른 말을 한다.
// (실제로 겪은 종류의 어긋남이다 — §4.12 "무엇으로 세우나 = 무엇을 보여주나")

// 남은 날 → 마감 라벨. 대시보드의 프로젝트 진행 줄과 프로젝트 헤더의 메타 줄이 같다.
export const dueLabelOf = (dd) => (dd === null || dd === undefined ? '마감 미정'
  : dd < 0 ? `${-dd}일 지남` : dd === 0 ? '오늘 마감' : `D-${dd}`);

// 팀 → 그 팀이 붙은 업무 수. **무엇을 세는지는 부르는 쪽이 정한다**(프로젝트 화면은
// 보기에 따라 달력에 얹히는 것만, 전체 일정은 언제나 날짜가 있는 것만).
export const teamCountsOf = (list) => {
  const c = {};
  list.forEach(t => (t.teams || []).forEach(x => { c[x] = (c[x] || 0) + 1; }));
  return c;
};
// 칩 순서는 config의 팀 순서를 따른다 — 화면마다 팀 순서가 다르면 헷갈린다
export const teamChipsOf = (counts) => Object.keys(CONFIG.TEAMS).filter(n => counts[n]);

// 칩이 이어지는 줄 — 넘치면 줄을 바꾸지 않고 가로로 스크롤한다(§8 · 같은 종류가
// 이어지는 줄에서는 허용). roster.jsx의 CHIP_ROW와 **같은 한 벌**이다: 끝까지 밀었을 때
// 마지막 칩이 통 끝에 붙지 않게 ::after로 12px을 세운다(스크롤 통의 padding-right는
// 넘친 내용에 안 걸린다 — §6-2와 같은 이유).
export const TEAM_CHIP_ROW = 'flex items-center gap-1.5 flex-nowrap min-w-0 overflow-x-auto scrollbar-hide x-scroll-lock'
  + " after:content-[''] after:shrink-0 after:w-3";

// 모바일 팀 필터 — 칩을 나열하지 않고 한 줄 버튼으로 접고, 누르면 오버레이 카드가 열린다.
// 오버레이라 아래 콘텐츠를 밀지 않는다(핸드오프: position:absolute; z-index:20).
export function TeamFilterBar({ teams, counts, total, shownCount, selected, onToggle, onClear, className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const label = selected.length
    ? `${selected[0]}${selected.length > 1 ? ` 외 ${selected.length - 1}` : ''} · ${shownCount}건`
    : `전체 팀 · ${total}건`;

  return (
    <span ref={rootRef} className={`flex-1 min-w-0 relative ${className}`}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-[7px] pl-[11px] pr-2.5 py-[7px] rounded-full text-xs font-semibold text-fg"
        style={{ background: 'var(--app-surface)', border: `1px solid ${selected.length ? 'var(--app-accent)' : 'var(--app-line)'}` }}>
        <SlidersIcon />
        <span className="flex-1 min-w-0 text-left truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0 text-fg-faint transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <span className="block relative h-0 z-20">
          <span className="dc-pop block absolute left-0 right-0 p-1.5 rounded-[10px]" style={{
            top: -4, transformOrigin: 'top center',
            background: 'var(--app-surface)', border: '1px solid var(--app-line)',
            boxShadow: '0 10px 28px rgba(0,0,0,.14)',
          }}>
            <button onClick={() => { onClear(); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-[7px] text-[13px] text-fg text-left"
              style={{ background: selected.length ? 'transparent' : 'var(--app-surface-hover)', fontWeight: selected.length ? 500 : 700 }}>
              <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: 'var(--app-ink)' }} />
              <span className="flex-1">전체 팀</span>
              <span className="text-[11.5px] text-fg-muted tabular-nums">{total}</span>
            </button>
            {teams.map(name => {
              const on = selected.includes(name);
              return (
                <button key={name} onClick={() => onToggle(name)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-[7px] text-[13px] text-left"
                  style={{ background: on ? teamBgColor(name) : 'transparent', color: on ? teamColor(name) : 'var(--app-ink)', fontWeight: on ? 700 : 500 }}>
                  <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: teamColor(name) }} />
                  <span className="flex-1 truncate">{name}</span>
                  <span className="text-[11.5px] text-fg-muted tabular-nums">{counts[name]}</span>
                  {on && <Check size={13} className="shrink-0 [stroke-width:2.4px]" style={{ color: teamColor(name) }} />}
                </button>
              );
            })}
          </span>
        </span>
      )}
    </span>
  );
}

// 필터 줄 아이콘 (핸드오프의 인라인 SVG를 그대로)
function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--app-ink-muted)" strokeWidth="1.6" strokeLinecap="round" className="w-3.5 h-3.5 shrink-0">
      <path d="M3 5h18M6 12h12M10 19h4" />
    </svg>
  );
}
