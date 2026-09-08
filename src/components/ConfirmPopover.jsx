import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ============================================================================
// 삭제 확인 팝오버 (프로젝트·업무·댓글·첨부 공용)
// ----------------------------------------------------------------------------
// - 트리거 버튼을 children으로 받고, 클릭하면 앵커 근처에 팝오버
// - position: fixed + getBoundingClientRect로 좌우/상하를 뷰포트 안에 클램프
//   (모바일에서 좌하단 휴지통 기준 팝오버가 화면 밖으로 잘리던 문제 해결)
// - 바깥 클릭 / Esc 닫기, 스크롤·리사이즈 시 위치 재계산
// ============================================================================
const W = 240;     // 팝오버 고정 폭
const GAP = 8;     // 화면 가장자리 최소 여백
const EST_H = 110; // 높이 추정치(위/아래 배치 판단용)

// 앵커 기준 fixed 위치를 뷰포트 안으로 클램프해 돌려주는 공용 훅
// (트리거가 화면 좌·우·하단에 붙어 있어도 팝오버가 잘리지 않게)
// measuredRef를 주면 팝오버가 그려진 뒤 실제 높이로 위치를 다시 잡는다.
// estHeight는 추정치라 실제보다 크면(예: 250 추정 / 150 실제) 위로 뜨는 팝오버가
// 트리거에서 100px 떨어져 붕 떠 보였다. 같은 레이아웃 패스에서 고치니 깜빡임은 없다.
//
// opts.matchWidth를 주면 **폭도 앵커에서 잰다**(width 인자는 첫 배치용 대비값이 된다) —
// 부르는 쪽이 폭을 따로 state로 들고 있으면 그 값이 낡는다(모바일에서 칸 폭이 바뀌는데
// 목록은 옛 폭으로 서 있었다). 잰 폭은 pos.width로 돌려준다.
//
// ── 모바일 키보드 (사용자 보고 2026-09-08 · 아이폰) ─────────────────────────
// "멤버 추가·순원 추가·순장 지정에서 목록이 밀려 뜬다 — 아마 키 입력 때문에."
// 칸에 포커스가 가면 iOS는 키보드를 올리면서 **보이는 뷰포트(visualViewport)를 줄이고
// 화면을 밀어 올리는데**, 그 이동에 `scroll`도 `resize`도 오지 않는 경우가 있다.
// 그러면 열릴 때 잰 자리에 목록만 남아 위 칸을 덮거나 옆으로 밀린 것처럼 보인다.
// 그래서 세 가지를 함께 한다:
//   · 화면 크기는 window가 아니라 **visualViewport**에서 읽고 offsetLeft/Top만큼 민다
//     (fixed는 레이아웃 뷰포트 좌표라, 보이는 영역은 그 안에서 이만큼 떠 있다)
//   · visualViewport의 resize·scroll도 듣는다
//   · 열려 있는 동안 **프레임마다 앵커 상자를 견주고, 실제로 움직였을 때만** 다시 잡는다
//     (rect 읽기 한 번뿐이고 값이 같으면 상태도 안 바꾼다 — 다시 그리지 않는다)
export function useAnchoredPos(triggerRef, open, width, estHeight, gap = GAP, measuredRef = null, opts = null) {
  const matchWidth = !!opts?.matchWidth;
  const [pos, setPos] = useState({ left: 0, top: 0, width: width || 0 });
  const seen = useRef(null);   // 마지막으로 자리를 잡을 때의 앵커 상자(아래 rAF 고리가 견준다)
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    seen.current = { left: r.left, top: r.top, width: r.width, height: r.height };
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const vw = vv?.width || window.innerWidth;
    const vh = vv?.height || window.innerHeight;
    const ox = vv?.offsetLeft || 0;
    const oy = vv?.offsetTop || 0;
    const w = (matchWidth && r.width) ? r.width : width;
    const h = measuredRef?.current?.offsetHeight || estHeight;
    const minLeft = ox + gap;
    const maxLeft = Math.max(minLeft, ox + vw - w - gap);
    const left = Math.min(Math.max(r.right - w, minLeft), maxLeft);
    // 아래가 기본이다. **아래가 짧을 때만** 위로 뒤집고, 위가 더 짧으면 그대로 아래에
    // 둔다 — 키보드가 올라오면 위아래가 다 짧아서, 그때 뒤집으면 칸을 덮을 뿐이다.
    const below = (oy + vh) - r.bottom;
    const above = r.top - oy;
    const top = (below < h + gap && above > below) ? Math.max(oy + gap, r.top - h - 4) : r.bottom + 4;
    // 같은 자리면 상태를 바꾸지 않는다 — 아래 rAF 고리가 헛되이 다시 그리지 않게.
    setPos(p => ((p.left === left && p.top === top && p.width === w) ? p : { left, top, width: w }));
  }, [triggerRef, width, estHeight, gap, measuredRef, matchWidth]);

  // useLayoutEffect: 브라우저가 그리기 전에 위치를 확정한다.
  // useEffect였을 때는 첫 프레임이 {0,0}에 그려지고 그 다음 프레임에 제자리로
  // 튀어서, 팝오버가 "어디 갔다 오는" 것처럼 보였다(알림·리소스 추가 등 전부).
  useLayoutEffect(() => {
    if (!open) { seen.current = null; return undefined; }
    place();
    const vv = window.visualViewport || null;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    let raf = requestAnimationFrame(function follow() {
      raf = requestAnimationFrame(follow);
      const r = triggerRef.current?.getBoundingClientRect();
      const was = seen.current;
      if (!r) return;
      if (!was || Math.abs(r.left - was.left) > 0.5 || Math.abs(r.top - was.top) > 0.5
        || Math.abs(r.width - was.width) > 0.5 || Math.abs(r.height - was.height) > 0.5) place();
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
    };
  }, [open, place, triggerRef]);

  return [pos, place];
}

// tone: 'danger'(기본, 삭제) | 'ok'(완료·되돌리기처럼 잃는 게 없는 확인)
// 확정 버튼 색은 토큰만 쓴다. 예전엔 danger가 Tailwind 기본 red-500(#ef4444)이었는데
// 이 앱의 팔레트에 없는 색이고, 원색이라 다크 모드에서도 그대로 튀었다(토큰은 테마마다
// 값이 다르다). 프로젝트 삭제 버튼은 이미 tag-red-fg를 쓰고 있어서 같은 삭제인데
// 색이 둘이었다.
const TONE = {
  danger: 'bg-tag-red-fg hover:opacity-90 text-white',
  ok: 'bg-accent hover:opacity-90 text-white',
};

export function ConfirmPopover({ message, confirmLabel = '삭제', cancelLabel = '취소', onConfirm, children, title, tone = 'danger', className = 'inline-flex' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const [pos, place] = useAnchoredPos(triggerRef, open, W, EST_H);

  useEffect(() => {
    if (!open) return;
    // 팝오버가 포털로 나가 있으므로 바깥 클릭 판정에 팝오버 자신도 포함해야 한다
    const onDown = (e) => {
      const inside = rootRef.current?.contains(e.target) || popRef.current?.contains(e.target);
      if (!inside) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = (e) => { e.stopPropagation(); place(); setOpen(o => !o); };

  // 포털로 body에 띄운다 — 트리거가 hover에서만 보이는 영역(댓글의 수정·삭제 아이콘)
  // 안에 있으면, 마우스가 벗어날 때 부모의 opacity-0이 팝오버까지 같이 숨겨서
  // 확인창이 사라졌다 나타났다 했다.
  const popover = open ? createPortal(
    <div
      ref={popRef}
      onClick={e => e.stopPropagation()}
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: W }}
      className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-3 animate-in fade-in zoom-in-95 duration-150"
    >
      <p className="text-xs text-fg-secondary leading-relaxed mb-2.5 whitespace-pre-line break-words">{message}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-xs px-2.5 py-1.5 text-fg-muted hover:bg-surface-hover rounded-md transition active:scale-95">{cancelLabel}</button>
        <button type="button" onClick={() => { setOpen(false); onConfirm?.(); }} className={`text-xs px-2.5 py-1.5 rounded-md transition active:scale-95 font-semibold ${TONE[tone] || TONE.danger}`}>{confirmLabel}</button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <span className={className} ref={rootRef}>
      <span ref={triggerRef} onClick={toggle} className="inline-flex" title={title}>{children}</span>
      {popover}
    </span>
  );
}
