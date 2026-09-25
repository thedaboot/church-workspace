import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoveVertical, X } from 'lucide-react';
import { BTN_CONFIRM, BTN_CONFIRM_QUIET } from './buttons.js';
import { coverImage, coverPosition, coverFrame, dragFocus, clampFocus, COVER_RATIO } from '../services/serviceView.js';

// ============================================================================
// 주보 표지 사진 (0081 · 사용자 결정 2026-09-26 · 목업 mockup-followup 2 · mockup-grace 2)
// ----------------------------------------------------------------------------
// 부품 셋(+ 수정 중 도구 줄 CoverTools는 worshipDetail.jsx에 있다 — 이 파일은 **supabase를 물지 않는다**:
// 공개 보기(src/serviceViewMain.jsx)가 스토리를 통해 CoverImg를 부른다):
//   CoverImg     — 카드·상세 머리·스토리 표지 밑에 깔리는 사진 한 장(`.cover-img` · 덮개는 부모의
//                  `.has-cover::before` — index.css). lh3가 아직 없거나 깨지면 **스스로 빠진다**
//                  (부모는 onFail로 알고 절기 색으로 돌아간다 — 깨진 그림 아이콘을 세우지 않는다).
//   CoverTools   — 주보 **수정 중** 머리 아래 도구 줄: `표지 사진`(올리기) · `표지 위치` · `표지 사진 제거`
//                  (사용자 문구 그대로 · 편집 자격자만 — 부르는 쪽이 가린다).
//   CoverDialog  — `표지 위치` 창. 사진 전체 위에 목록 카드 비율(343:76) 틀이 서고 **위아래로만** 끌린다
//                  (↑↓ 5% · role=slider). 값은 cover_focus_y 하나. 폰은 아래에서 올라오는 창, 데스크톱은
//                  가운데 창(뒤판 50% · HANDOFF §8 D9). 틀을 끌면 카드·상세 머리 미리보기가 따라온다.
//                  새 사진을 올리면 부르는 쪽이 .5로 이 창을 **자동으로** 연다.
// 계산(틀 자리·끌기·주소·object-position)은 전부 services/serviceView.js의 순수 함수다(logcheck).
// 주보 종이(PDF)에는 싣지 않는다 — 종이 부품은 이 파일을 모른다.
// ============================================================================

export function CoverImg({ cover, focus = 0.5, onFail, className = '' }) {
  const img = coverImage(cover);
  const [bad, setBad] = useState(null);
  if (!img || bad === img.src) return null;
  return (
    <img className={`cover-img ${className}`} alt="" aria-hidden="true" decoding="async" draggable={false}
      src={img.src} srcSet={img.srcSet} style={{ objectPosition: coverPosition(focus) }}
      onError={() => { setBad(img.src); onFail?.(); }} />
  );
}

// 사진이 **실제로 그려질 수 있나** — 부모가 has-cover(덮개·흰 글자)를 걸지 정한다. 깨지면 false로 돌아간다.
export function useCoverShown(cover) {
  const img = coverImage(cover);
  const [failed, setFailed] = useState(null);
  const shown = !!img && failed !== img.src;
  return { shown, onFail: () => setFailed(img?.src || null) };
}

// 창 안의 사진 상자 — 사진 비율 그대로, 폭은 창을 다 쓰되 높이는 화면의 절반쯤에서 멈춘다
function useStage(wrapRef, natural) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || !natural) return undefined;
    const fit = () => {
      const cw = el.clientWidth;
      const a = natural.h / natural.w;
      const maxH = Math.max(160, Math.round(window.innerHeight * 0.46));
      const w = Math.min(cw, maxH / a);
      setBox({ w: Math.round(w), h: Math.round(w * a) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [wrapRef, natural]);
  return box;
}

export function CoverDialog({ src, focus = 0.5, title = '', dateLabel = '', kindLabel = '', onCancel, onSave }) {
  const [y, setY] = useState(() => clampFocus(focus));
  const [natural, setNatural] = useState(null);
  const [busy, setBusy] = useState(false);
  const wrap = useRef(null);
  const stageRef = useRef(null);
  const box = useStage(wrap, natural);
  const frame = coverFrame(box.w, box.h, y);
  const thin = coverFrame(box.w, box.h, y, 1 / 10.8);   // 가장 얇은 데스크톱 머리 띠(점선)
  const drag = useRef(null);

  useEffect(() => { try { stageRef.current?.focus({ preventScroll: true }); } catch { /* 옛 브라우저 */ } }, [natural]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const onDown = (e) => {
    drag.current = { y0: e.clientY, f0: y };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
  };
  const onMove = (e) => {
    if (!drag.current) return;
    setY(dragFocus(drag.current.f0, e.clientY - drag.current.y0, box.w, box.h));
  };
  const onUp = () => { drag.current = null; };
  const onKey = (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); setY(v => clampFocus(Math.round((v - 0.05) * 100) / 100)); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setY(v => clampFocus(Math.round((v + 0.05) * 100) / 100)); }
  };
  const save = useCallback(async () => {
    setBusy(true);
    const ok = await onSave(Math.round(y * 1000) / 1000);
    setBusy(false);
    if (ok !== false) onCancel();
  }, [y, onSave, onCancel]);

  const cover = { _src: src };
  return createPortal(
    <div className="worship-cover-back fixed inset-0 z-[95] flex items-end md:items-center justify-center md:p-4 bg-black/50 motion-safe:animate-in motion-safe:fade-in duration-150 transition-none"
      role="dialog" aria-modal="true" aria-label="표지 위치"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="worship-cover-dialog w-full md:max-w-[35rem] max-h-[92dvh] overflow-y-auto p-3.5 md:p-4 rounded-t-2xl md:rounded-xl shadow-elevated motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 md:motion-safe:slide-in-from-bottom-0 md:motion-safe:zoom-in-95 duration-150 transition-none"
        style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center gap-2 mb-2.5">
          <b className="flex-1 text-[14px] font-extrabold tracking-[-0.2px] text-fg">표지 위치</b>
          <button type="button" onClick={onCancel} aria-label="닫기"
            className="relative before:absolute before:-inset-2 hidden md:grid place-items-center w-7 h-7 rounded-md text-fg-muted hover:bg-surface-hover">
            <X size={16} />
          </button>
        </div>
        <div ref={wrap} className="w-full">
          <div ref={stageRef} tabIndex={0} role="slider" aria-label="표지 위치"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(y * 100)} aria-orientation="vertical"
            className="worship-cover-stage relative mx-auto rounded-lg overflow-hidden select-none cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ width: box.w || '100%', height: box.h || 200, touchAction: 'none', background: '#223' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
            <img src={src} alt="" draggable={false} className="absolute inset-0 w-full h-full block pointer-events-none"
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 4, h: e.currentTarget.naturalHeight || 3 })} />
            {box.h > 0 && (
              <>
                <div className="worship-cover-frame absolute left-0 right-0 rounded-md pointer-events-none"
                  style={{ top: frame.top, height: frame.height, border: '2px solid #fff', boxShadow: '0 0 0 999px rgba(10,12,20,.52)' }}>
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center w-[30px] h-[30px] rounded-full"
                    style={{ background: 'rgba(255,255,255,.92)', color: '#191720', boxShadow: '0 1px 4px rgba(0,0,0,.3)' }}>
                    <MoveVertical size={16} />
                  </span>
                </div>
                <div className="absolute left-0 right-0 pointer-events-none"
                  style={{ top: thin.top, height: thin.height, borderTop: '1px dashed rgba(255,255,255,.9)', borderBottom: '1px dashed rgba(255,255,255,.9)' }} />
              </>
            )}
          </div>
        </div>

        {/* 미리보기 — 목록 카드(실선 틀) · 상세 머리. 같은 값 하나로 둘 다 맞는다 */}
        <div className="grid gap-2.5 mt-3 md:grid-cols-2">
          <div className="worship-cover-preview-card has-cover relative rounded-[10px] px-3.5 py-3" style={{ aspectRatio: `${1 / COVER_RATIO}` }}>
            <CoverImg cover={cover} focus={y} />
            <p className="text-[14px] font-bold tracking-[-0.2px] truncate" style={{ color: '#fff' }}>{title || '설교 제목 미정'}</p>
            <p className="mt-1 text-[12.5px] truncate" style={{ color: 'rgba(255,255,255,.88)' }}>{dateLabel}</p>
          </div>
          <div className="worship-cover-preview-head has-cover has-cover-head relative hidden md:flex items-end rounded-[10px] p-3" style={{ aspectRatio: '343 / 92' }}>
            <CoverImg cover={cover} focus={y} />
            <span className="flex flex-wrap items-baseline gap-1.5 min-w-0">
              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold" style={{ background: 'rgba(255,255,255,.2)', color: '#fff' }}>{kindLabel}</span>
              <span className="text-[12.5px] font-bold" style={{ color: '#fff' }}>{dateLabel}</span>
            </span>
          </div>
        </div>

        <div className="flex gap-2 mt-3.5 md:justify-end">
          <button type="button" onClick={onCancel} className={`worship-cover-cancel flex-1 md:flex-none md:w-24 ${BTN_CONFIRM_QUIET}`}>취소</button>
          <button type="button" onClick={save} disabled={busy} className={`worship-cover-save flex-1 md:flex-none md:w-24 ${BTN_CONFIRM}`}>저장</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
