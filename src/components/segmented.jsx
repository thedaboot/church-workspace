import React from 'react';

// ============================================================================
// 회색 토글(세그먼트) — 회색 통(surface-hover) 안에서 고른 칸만 흰 바탕(surface)에 진한 글자다.
// 프로젝트 보기 전환(보드·캘린더·그래프) · 대시보드 필터(전체·내 업무·내 팀) · 대시보드 폰 탭이 쓴다.
// 통과 칸의 여백·글자는 자리마다 달라 클래스를 그대로 받는다(값을 여기서 정하면 자리마다 모양이 바뀐다).
//   items       [값, 보일 것] 쌍의 배열
//   className   통 클래스 · btnClassName 칸 클래스 · as 통의 태그(기본 span)
//   tabs        칸이 role="tab" + aria-selected(통에는 role="tablist"를 넘긴다)
// 나머지 props는 통에 붙는다(role · aria-label).
// 19차(2026-10-07)에 views.jsx 세 자리를 모았다 — 다른 화면(명단·말씀·모임)의 같은 줄은 뒤 묶음이 옮긴다.
// ============================================================================
export const segStyle = (on) => ({
  background: on ? 'var(--app-surface)' : 'transparent',
  color: on ? 'var(--app-ink)' : 'var(--app-ink-muted)',
});

export function Segmented({ items, value, onPick, as: Box = 'span', className, btnClassName, tabs = false, ...boxProps }) {
  return (
    <Box className={className} style={{ background: 'var(--app-surface-hover)' }} {...boxProps}>
      {items.map(([v, label]) => (
        <button
          key={v} onClick={() => onPick(v)}
          {...(tabs ? { role: 'tab', 'aria-selected': value === v } : null)}
          className={btnClassName}
          style={segStyle(value === v)}
        >
          {label}
        </button>
      ))}
    </Box>
  );
}
