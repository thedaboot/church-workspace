import React from 'react';

// ============================================================================
// 회색 토글(세그먼트) — 회색 통(surface-hover) 안에서 고른 칸만 흰 바탕(surface)에 진한 글자다.
// 앱의 회색 토글은 전부 이것이다 — 새로 손으로 그리지 않는다(보드·캘린더·그래프 · 대시보드 필터·폰 탭 · 아래 여덟 자리).
// 통과 칸의 여백·글자는 자리마다 달라 클래스를 그대로 받는다(값을 여기서 정하면 자리마다 모양이 바뀐다).
//   items       [값, 보일 것] 쌍의 배열
//   className   통 클래스 · btnClassName 칸 클래스 · as 통의 태그(기본 span)
//   tabs        칸이 role="tab" + aria-selected(통에는 role="tablist"를 넘긴다)
// 나머지 props는 통에 붙는다(role · aria-label).
//   items의 셋째 값은 그 칸 버튼에 붙는 속성이다(data-* · title · aria-label · style — style은 고른 색 위에 얹는다).
//   tabs가 아니면 칸마다 aria-pressed(색만으로 고른 것을 말하면 화면을 읽어 주는 기기에는 아무 표시도 안 남는다).
//   disabled는 칸 전부.
// 19차(2026-10-07)에 views.jsx 세 자리를, 2026-10-14에 명단·말씀·성경·모임·멤버·예배·공유 토글·글자 크기 여덟 자리를 모았다.
// ============================================================================
export const segStyle = (on) => ({
  background: on ? 'var(--app-surface)' : 'transparent',
  color: on ? 'var(--app-ink)' : 'var(--app-ink-muted)',
});

export function Segmented({ items, value, onPick, as: Box = 'span', className, btnClassName, tabs = false, disabled, style, ...boxProps }) {
  return (
    <Box className={className} style={{ background: 'var(--app-surface-hover)', ...style }} {...boxProps}>
      {items.map(([v, label, extra]) => (
        <button
          key={String(v)} type="button" onClick={() => onPick(v)} disabled={disabled}
          {...(tabs ? { role: 'tab', 'aria-selected': value === v } : { 'aria-pressed': value === v })}
          className={btnClassName}
          {...extra}
          style={{ ...segStyle(value === v), ...extra?.style }}
        >
          {label}
        </button>
      ))}
    </Box>
  );
}
