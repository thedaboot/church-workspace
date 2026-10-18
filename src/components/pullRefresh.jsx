import { useEffect, useRef } from 'react';
import { PULL, rubber, pullPhase, gestureVerdict, peek } from '../services/pullMath.js';
import { prefersReducedMotion } from '../hooks/useReducedMotion.js';

// ============================================================================
// 당겨서 새로 고침(폰 · v5 2묶음 시안 · mock/b3) — App의 스크롤 통(main) 하나에 붙는다(뷰는 자기 안에서 스크롤하지 않는다 · §6-2).
// ----------------------------------------------------------------------------
// 셈은 services/pullMath.js 한 벌(고무줄 · 놓기 문턱 · 손짓 가르기 — 노드 검사가 문다).
//   당기는 동안  화면(.app-screen)이 고무줄로 따라 내려오고, 벌어진 틈으로 다붓이(물음표 컷)가 위에서 갸웃하며 내려온다.
//               문턱을 넘으면 한 번 폴짝(놓으면 새로 고친다는 표시) · 다시 올리면 도로 갸웃.
//   놓으면      문턱 전: 제자리로(260ms quint) · 문턱 뒤: 머무는 높이에서 다붓이가 고개를 흔들며 기다리고(최소 0.7초)
//               끝나면 손 흔드는 컷으로 바뀌어 한 번 튀고 화면이 제자리로(380ms quint — 폰 시트와 같은 길이).
//   움직임 줄이기  화면은 움직이지 않고 다붓이만 나타났다 사라진다(흔들기·튀기 없음).
// 받지 않는 손짓: 맨 위가 아닐 때(통 또는 손 아래 굴러 있는 상자) · 가로로 미는 것(보드 칸 넘기기) · 길게 누른 뒤의 움직임
// (dnd-kit 끌기 200ms) · 열린 창(업무 창 · 대화창) · 입력 칸 · `data-no-pull` 안. 받은 손짓만 touchmove를 막는다
// (그래야 아이폰 고무줄·안드로이드 크롬 당겨서 새로 고침과 싸우지 않는다 — html/body는 이미 overscroll none).
// 손을 대는 동안은 transform을 직접 쓴다(프레임마다 리액트를 다시 그리지 않는다) · 끝나면 transform을 걷는다
// (남겨 두면 화면 안의 fixed 판이 그 상자를 기준으로 선다).
// ============================================================================

const cutSet = (src) => `${src} 1x, ${src.replace(/\.webp$/, '@2x.webp')} 2x`;   // showcase.cutSet과 같은 꼴
const Q_CUT = { src: '/chars/question.webp', w: 85, h: 85 };
const WAVE_CUT = { src: '/chars/sparkle-wave.webp', w: 203, h: 168 };
const FACE = 58;   // 다붓이 컷 높이(px)
const EASE = 'cubic-bezier(.16, 1, .3, 1)';   // index.css --ease-out-quint
const BUSY_LABEL = '새로 고치는 중';            // 화면 읽기 프로그램용(자리표 — 문구 표)

const modalOpen = () => !!document.querySelector('[data-task-modal], [role="dialog"], [aria-modal="true"], [data-sheet-open]');

// 손 아래부터 main까지 굴러 가는 상자가 전부 맨 위인가(보드 칸 안 목록처럼 안에서 구르는 상자도 본다)
function allAtTop(target, main) {
  if (main.scrollTop > 0) return false;
  for (let n = target instanceof Element ? target : null; n && n !== main; n = n.parentElement) {
    if (n.scrollTop > 0) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') return false;
    }
  }
  return true;
}

export function PullRefresh({ mainRef, enabled, onRefresh }) {
  const boxRef = useRef(null);
  const faceRef = useRef(null);
  const imgRef = useRef(null);
  const live = useRef({ onRefresh });
  live.current.onRefresh = onRefresh;

  useEffect(() => {
    const main = mainRef.current;
    if (!enabled || !main) return undefined;
    const g = { mode: 'none', x: 0, y: 0, t: 0, d: 0, phase: 'idle', busy: false };
    const reduced = () => prefersReducedMotion();
    const screen = () => main.querySelector('.app-screen');
    const setCut = (cut) => {
      const img = imgRef.current;
      if (!img || img.dataset.cut === cut.src) return;
      img.dataset.cut = cut.src;
      img.src = cut.src; img.srcset = cutSet(cut.src);
      img.width = Math.round(FACE * cut.w / cut.h); img.height = FACE;
      img.style.width = `${img.width}px`;
    };
    // d만큼 내려온 모양을 그린다(손을 대는 동안 · 전환 없음)
    const paint = (d, { anim = 0 } = {}) => {
      const box = boxRef.current; const face = faceRef.current; const sc = screen();
      if (!box || !face) return;
      const rm = reduced();
      const tr = anim ? `transform ${anim}ms ${EASE}, opacity ${anim}ms ${EASE}` : 'none';
      if (sc) {
        sc.style.transition = rm ? 'none' : (anim ? `transform ${anim}ms ${EASE}` : 'none');
        sc.style.transform = rm || d <= 0 ? '' : `translateY(${d}px)`;
        sc.style.willChange = d > 0 ? 'transform' : '';
      }
      const { p, tilt } = peek(d);
      box.style.visibility = d > 0.5 || g.busy ? 'visible' : 'hidden';
      face.style.transition = tr;
      if (rm) { face.style.transform = `translateY(${PULL.hold / 2 - FACE / 2}px)`; face.style.opacity = String(p); return; }
      // 컷의 아래끝이 틈의 아래끝을 따라온다 — 틈이 작을 때는 위(앱 상단 바 아래)에 숨어 있다가 내려온다
      const y = Math.min(d, PULL.hold + 6) - FACE - 4;
      face.style.transform = `translateY(${y}px) rotate(${tilt}deg)`;
      face.style.opacity = String(Math.min(1, 0.25 + p));
    };
    const clear = () => {
      const sc = screen();
      if (sc) { sc.style.transition = ''; sc.style.transform = ''; sc.style.willChange = ''; }
      if (boxRef.current) boxRef.current.style.visibility = 'hidden';
      imgRef.current?.classList.remove('dc-pull-wait');
      boxRef.current?.removeAttribute('aria-busy');
      setCut(Q_CUT);
      g.d = 0; g.phase = 'idle';
    };
    const hop = () => { if (!reduced()) imgRef.current?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.12) translateY(-3px)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 320, easing: EASE }); };

    const start = (e) => {
      if (g.busy || e.touches.length !== 1) { g.mode = 'skip'; return; }
      const t = e.touches[0];
      const blocked = modalOpen() || !!e.target?.closest?.('input, textarea, select, [contenteditable="true"], [data-no-pull]');
      g.mode = blocked || !allAtTop(e.target, main) ? 'skip' : 'wait';
      g.x = t.clientX; g.y = t.clientY; g.t = performance.now(); g.d = 0;
    };
    const move = (e) => {
      if (g.mode === 'skip' || g.mode === 'none') return;
      const t = e.touches[0];
      const dx = t.clientX - g.x; const dy = t.clientY - g.y;
      if (g.mode === 'wait') {
        const v = gestureVerdict({ dx, dy, ms: performance.now() - g.t, atTop: main.scrollTop <= 0 });
        if (v === 'wait') return;
        if (v === 'skip') { g.mode = 'skip'; return; }
        g.mode = 'pull'; g.y = t.clientY - PULL.slop;   // 문턱만큼은 이미 당긴 것으로
      }
      if (e.cancelable) e.preventDefault();
      const d = rubber(t.clientY - g.y);
      const ph = pullPhase(d);
      if (ph === 'armed' && g.phase !== 'armed') hop();
      g.d = d; g.phase = ph;
      paint(d);
    };
    const end = async () => {
      if (g.mode !== 'pull') { g.mode = 'none'; return; }
      g.mode = 'none';
      if (g.phase !== 'armed') { paint(0, { anim: PULL.back }); setTimeout(() => { if (!g.busy) clear(); }, PULL.back); return; }
      g.busy = true;
      boxRef.current?.setAttribute('aria-busy', 'true');
      paint(PULL.hold, { anim: PULL.back });
      if (!reduced()) imgRef.current?.classList.add('dc-pull-wait');
      const t0 = performance.now();
      try { await live.current.onRefresh?.(); } catch (err) { console.error('[pull] 새로 고침 실패:', err); }
      const left = PULL.minSpin - (performance.now() - t0);
      if (left > 0) await new Promise(r => setTimeout(r, left));
      imgRef.current?.classList.remove('dc-pull-wait');
      if (!reduced()) {
        setCut(WAVE_CUT); hop();
        await new Promise(r => setTimeout(r, 420));
      }
      paint(0, { anim: PULL.settle });
      if (faceRef.current) faceRef.current.style.opacity = '0';
      await new Promise(r => setTimeout(r, PULL.settle));
      g.busy = false;
      clear();
    };
    main.addEventListener('touchstart', start, { passive: true });
    main.addEventListener('touchmove', move, { passive: false });
    main.addEventListener('touchend', end, { passive: true });
    main.addEventListener('touchcancel', end, { passive: true });
    return () => {
      main.removeEventListener('touchstart', start);
      main.removeEventListener('touchmove', move);
      main.removeEventListener('touchend', end);
      main.removeEventListener('touchcancel', end);
      clear();
    };
  }, [enabled, mainRef]);

  if (!enabled) return null;
  return (
    // 통(main)의 맨 위 — 높이 0 · 아래로 넘쳐 그린다. 컷은 위(상단 바 쪽)를 넘지 않게 잘린다(clip-path)
    <div ref={boxRef} data-pull="" role="status" aria-label={BUSY_LABEL} className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-0 flex justify-center"
      style={{ visibility: 'hidden' }}>
      <div className="absolute inset-x-0 top-0 flex justify-center" style={{ height: PULL.max, clipPath: 'inset(0 0 0 0)' }}>
        <div ref={faceRef} className="dc-pull-face origin-bottom" style={{ height: FACE, opacity: 0 }}>
          <img ref={imgRef} src={Q_CUT.src} srcSet={cutSet(Q_CUT.src)} data-cut={Q_CUT.src} width={FACE} height={FACE} alt="" aria-hidden="true" draggable="false"
            className="block h-full w-auto select-none" />
        </div>
      </div>
    </div>
  );
}
