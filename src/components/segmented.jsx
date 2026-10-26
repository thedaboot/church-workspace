import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
// **고른 칸은 미끄러진다**(UI 다듬기 2026-10-26 — 관리자 메뉴·보고서 현황에만 있던 SlideSeg를 모든 회색 토글로).
//   흰 칸(.ops-seg-thumb)은 고른 버튼의 offset·모서리를 재서 그 뒤에 깔린다 · 첫 자리에는 전이가 없다(.ops-seg-live는 잰 뒤에).
//   통이 보이지 않아 잴 수 없을 때(hidden lg:flex)는 버튼이 스스로 흰 바탕을 칠한다 — 보이는 순간 ResizeObserver가 다시 잰다.
//   흰 칸 색은 --app-seg-on(다크에서는 통보다 한 단 밝다 — 예전처럼 surface면 고른 칸이 통보다 어두워 꺼진 칸으로 읽혔다).
// ============================================================================
export const segStyle = (on) => ({
  background: on ? 'var(--app-seg-on)' : 'transparent',
  color: on ? 'var(--app-ink)' : 'var(--app-ink-muted)',
});

export function Segmented({ items, value, onPick, as: Box = 'span', className = '', btnClassName = '', tabs = false, disabled, style, ...boxProps }) {
  const box = useRef(null);
  const [thumb, setThumb] = useState(null);
  const [live, setLive] = useState(false);
  useLayoutEffect(() => {
    const el = box.current?.querySelector('[data-seg-on="true"]');
    if (!el) { setThumb(null); return undefined; }
    const read = () => setThumb(el.offsetWidth
      ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, r: getComputedStyle(el).borderRadius }
      : null);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(box.current);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, items.length]);
  useEffect(() => { if (thumb && !live) { const t = requestAnimationFrame(() => setLive(true)); return () => cancelAnimationFrame(t); } return undefined; }, [thumb, live]);
  return (
    <Box ref={box} className={`relative ${className}`} style={{ background: 'var(--app-surface-hover)', ...style }} {...boxProps}>
      {thumb && (
        <span aria-hidden="true" className={`ops-seg-thumb absolute${live ? ' ops-seg-live' : ''}`}
          style={{ width: thumb.w, height: thumb.h, borderRadius: thumb.r, transform: `translate(${thumb.x}px, ${thumb.y}px)` }} />
      )}
      {items.map(([v, label, extra]) => {
        const on = value === v;
        return (
          <button
            key={String(v)} type="button" onClick={() => onPick(v)} disabled={disabled} data-seg-on={on}
            {...(tabs ? { role: 'tab', 'aria-selected': on } : { 'aria-pressed': on })}
            className={`relative ${btnClassName}`}
            {...extra}
            style={{ color: segStyle(on).color, background: thumb ? 'transparent' : segStyle(on).background, ...extra?.style }}
          >
            {label}
          </button>
        );
      })}
    </Box>
  );
}

// 관리자 메뉴·보고서 현황이 부르던 이름 — 이제 모든 회색 토글이 미끄러지므로 같은 부품이다.
export const SlideSeg = Segmented;
