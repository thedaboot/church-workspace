import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Smartphone, Monitor, ImagePlus } from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { useLeave } from '../hooks/useExit.js';
import { BTN_CONFIRM, BTN_CONFIRM_QUIET } from './buttons.js';
import { FIELD } from './groupsParts.jsx';
import { Skeleton } from './media.jsx';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import { isBlankCanvas, corsImageUrl } from '../services/shareImage.js';
import { deviceOf, screenOf, shotScale } from '../services/opsCore.js';
import { sendFeedback } from '../services/ops.js';
import { buildId } from '../services/errorReport.js';
import { prefersReducedMotion } from '../hooks/useReducedMotion.js';

// ============================================================================
// 피드백 전송(v5 2묶음 · 사용자 승인 시안 mock/b3 · 0113 · 모든 사람 · 입구는 프로필 메뉴 '피드백 전송' · 업무 창 안에는 두지 않는다)
// ----------------------------------------------------------------------------
// 폰은 아래 시트, 데스크톱은 가운데 대화창 — `.dc-sheet-dialog` 한 클래스가 둘을 가른다(index.css · 768부터 대화창).
// 시트는 **보이는 창(--app-vh)** 안에 선다(leaderOnly 보는 사람 시트와 같은 길 — 키보드가 올라와도 '보내기'가 가리지 않게).
//   · 글 칸 하나 + 자동으로 붙는 것 둘: 지금 보이는 화면 사진(아래 captureViewport — 창이 뜨는 모션이 끝난 뒤 굽는다 ·
//     뺄 수 있다) · 기기 정보 한 줄(기기 · 브라우저 · 화면 크기 · 화면 이름).
//   · 굽지 못하면 사진 자리를 지우고 보낸다(사진 없이도 보낼 수 있어야 한다 · 원문은 콘솔).
//   · 보내기는 services/ops.sendFeedback — 클라우드는 사진을 Storage 'feedback'(비공개 · 본인 폴더 · 마스터만 읽기)에 올리고
//     feedback 표에 한 줄(본인만 넣기 · 0113). 사진을 못 올리면 사진 없이 간다 · 행을 못 넣으면 창을 둔 채 토스트(`피드백을 보내지 못했어요` + 이유).
//     게스트는 관리자 메뉴의 피드백 목록 맨 위에 바로 선다(opsDemo.addFeedback).
//   · 사진을 지우면(×) 그 자리가 줄어들며 걷힌다(.ops-shot-out · quint · 움직임 줄이기면 바로).
// ============================================================================

// 지금 보이는 화면 그대로(스크롤한 자리 · 떠 있는 창·시트 포함 · 이 창만 뺀다) — body를 보이는 창 크기로 굽는다.
//   · 배율은 기기 화소 비(최소 2배 — 글자가 또렷하게) · 긴 변 2560px 상한(데스크톱 1440×900은 1.78배로 깎인다)
//   · restoreScrollPosition: 안에서 구르는 칸(main · 창 안 목록)이 구른 자리 그대로 그려진다(modern-screenshot)
//   · 카카오 프로필 사진(CORS 없음)은 fetchFn이 썸네일 주소로 받는다 — 빠지면 얼굴 자리가 빈다(사용자 지적 2026-10-19)
//   · WebP 0.9(사파리처럼 WebP로 못 굽는 브라우저는 JPEG 0.9) · 한 색뿐인 그림은 실패로 본다(shareImage.isBlankCanvas)
//   · 사파리 다시 그리기는 세 번까지(SAFARI_REDRAWS) — 라이브러리는 사파리에서 화면의 그림(img·CSS 그림)마다 한 번씩 0.1초 쉬고 화면 전체를
//     다시 그린다(그림을 늦게 푸는 사파리 대비). 얼굴·아이콘이 수십 개인 화면은 그것만 몇 초였다(사용자 지적 2026-10-22 '엄청 오래 걸린다').
//     맥락을 직접 만들어 SVG가 다 서고 그리기 직전(onCreateForeignObjectSvg)에 횟수를 깎는다.
//   · 보이는 창 밖에 통째로 있는 요소는 베끼지 않는다(offscreen) — 라이브러리가 요소마다 계산된 스타일을 통째로 베껴서, 스크롤 아래 긴 목록·
//     연결 지도 같은 큰 화면은 그 베끼기가 대부분이었다(사용자 지적 2026-10-22). 크기가 0인 요소는 안의 것이 밖으로 나올 수 있어 남긴다.
//     **아래·오른쪽 밖만** 뺀다 — 위·왼쪽으로 지나간 것을 빼면 스크롤 칸의 앞이 비어 같은 스크롤 자리에 다음 것이 그려졌다
//     (보드 '진행 중'에서 보냈는데 '보류 중'이 찍혔다 · 사용자 지적 2026-10-22).
const offscreen = (n, w, h) => {
  const r = n.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && (r.top > h || r.left > w);
};
//   · 베끼는 스타일은 그림에 보이는 것만(SHOT_PROPS · 약 150개 · 빠뜨리면 그 모양만 빠진다 — 스크롤 막대·흐린 가장자리가 그랬다) — 라이브러리 기본은 요소마다 계산된 스타일 400여 개 전부라,
//     실데이터 프로젝트 보드(요소 959 · 사진 31)가 그림 설명(SVG) 5.4MB였다. 아이폰 사파리는 이만큼 큰 그림을 못 그려 빈 그림이 되고
//     '스크린샷 미첨부'로 떨어졌다(사용자 지적 2026-10-22). 연결 지도 실측(크롬 · 사파리 갈래) 2.7초 → 1.6초.
//   · 사진은 화면에 그려진 크기 × 배율로 줄여 싣는다(smallImage) — 얼굴은 24px로 보이는데 640px 원본을 통째로 실었다. 줄인 것은
//     창을 다시 열어도 쓴다(shrunk · 주소@폭).
//   · 첫 시도가 실패하거나 빈 그림이면 한 번 더 가볍게(배율 1 · 글꼴 안 싣기) — 그래도 안 되면 사진 없이.
const SHOT_MAX = 2560;
const SAFARI_REDRAWS = 3;
const SHOT_PROPS = ["display","position","top","right","bottom","left","z-index","float","clear","box-sizing","overflow","overflow-x","overflow-y","visibility","opacity","width","height","min-width","min-height","max-width","max-height","aspect-ratio","margin-top","margin-right","margin-bottom","margin-left","padding-top","padding-right","padding-bottom","padding-left","flex-direction","flex-wrap","flex-grow","flex-shrink","flex-basis","justify-content","align-items","align-self","align-content","justify-items","justify-self","order","row-gap","column-gap","grid-template-columns","grid-template-rows","grid-template-areas","grid-auto-flow","grid-auto-columns","grid-auto-rows","grid-column-start","grid-column-end","grid-row-start","grid-row-end","grid-area","border-top-width","border-right-width","border-bottom-width","border-left-width","border-top-style","border-right-style","border-bottom-style","border-left-style","border-top-color","border-right-color","border-bottom-color","border-left-color","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius","outline-width","outline-style","outline-color","outline-offset","background-color","background-image","background-size","background-position","background-repeat","background-clip","box-shadow","color","font-family","font-size","font-weight","font-style","font-variant-numeric","font-feature-settings","line-height","letter-spacing","text-align","text-decoration-line","text-decoration-color","text-transform","text-overflow","white-space","word-break","overflow-wrap","text-indent","vertical-align","-webkit-line-clamp","-webkit-box-orient","line-clamp","text-shadow","transform","transform-origin","filter","backdrop-filter","clip-path","mask-image","object-fit","object-position","fill","stroke","stroke-width","stroke-dasharray","stroke-linecap","stroke-linejoin","stroke-opacity","fill-opacity","r","cx","cy","x","y","rx","ry","list-style-type","table-layout","border-collapse","cursor","isolation","mix-blend-mode","scrollbar-width","scrollbar-color","-webkit-mask-image","mask-size","mask-position","mask-repeat","-webkit-mask-size","-webkit-mask-position","-webkit-mask-repeat","translate","scale","rotate","text-decoration-thickness","text-underline-offset","text-decoration-style","background-origin","background-attachment","-webkit-text-fill-color","-webkit-background-clip","caret-color","accent-color","direction","writing-mode","column-count","object-view-box","inset"];
const shrunk = new Map();
function smallImage(url, want) {
  if (!/^https?:/.test(url)) return Promise.resolve(false);
  // CORS 없는 카카오 프로필 사진은 썸네일 주소로 받는다(shareImage.corsImageUrl · 빠지면 얼굴 자리가 빈다 — 사용자 지적 2026-10-19)
  const via = corsImageUrl(url);
  const key = `${via}@${want}`;
  if (!shrunk.has(key)) {
    shrunk.set(key, (async () => {
      try {
        const res = await fetch(via, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) return false;
        const bmp = await createImageBitmap(await res.blob());
        const k = Math.min(1, want / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * k));
        c.height = Math.max(1, Math.round(bmp.height * k));
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close?.();
        return c.toDataURL('image/png');
      } catch {
        shrunk.delete(key);   // 못 받은 것은 다음에 다시
        return false;
      }
    })());
  }
  return shrunk.get(key);
}
async function captureOnce(scale, light) {
  const { createContext, destroyContext, domToCanvas } = await import('modern-screenshot');
  const w = window.innerWidth;
  const h = window.innerHeight;
  const drawn = new Map();   // 주소 → 화면에 그려진 긴 변(px)
  for (const img of document.images) {
    const r = img.getBoundingClientRect();
    const src = img.currentSrc || img.src;
    drawn.set(src, Math.max(drawn.get(src) || 0, r.width, r.height));
  }
  let ctx = null;
  ctx = await createContext(document.body, {
    width: w, height: h, scale,
    onCreateForeignObjectSvg: () => { if (ctx) ctx.drawImageCount = Math.min(ctx.drawImageCount, SAFARI_REDRAWS); },
    // body 사본에 브라우저 기본 여백(8px)이 되살아나 그림이 오른쪽 아래로 밀렸다(2026-10-18 시안 점검) — 뿌리에서 0으로 박는다
    style: { margin: '0' },
    backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
    filter: (n) => !(n instanceof Element && (n.hasAttribute('data-feedback-scrim') || offscreen(n, w, h))),
    features: { restoreScrollPosition: true },
    includeStyleProperties: SHOT_PROPS,
    ...(light ? { font: false } : {}),
    fetchFn: (url) => smallImage(url, Math.max(16, Math.ceil((drawn.get(url) || 160) * scale))),
  });
  let canvas;
  try { canvas = await domToCanvas(ctx); } finally { destroyContext(ctx); }
  if (!canvas || isBlankCanvas(canvas)) throw new Error('빈 그림');
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.9);
}
// 폰에서 고른 스크린샷 — 긴 변 2560px로 줄여 굽는 것과 같은 모양(dataUrl · WebP, 안 되면 JPEG 0.9)으로
async function fileShot(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, SHOT_MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const webp = c.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', 0.9);
}
async function captureViewport() {
  try { return await captureOnce(shotScale(window.innerWidth, window.innerHeight, window.devicePixelRatio, SHOT_MAX), false); }
  catch (e) {
    console.warn('[feedback] 화면 사진 첫 시도 실패 — 가볍게 다시:', e?.message || e);
    return captureOnce(1, true);
  }
}

export function FeedbackSend({ onClose }) {
  const me = useStore(selectCurrentUser).name;
  const projects = useStore(s => s.projects?.byId);
  const [leaving, leave] = useLeave();
  const close = useCallback(() => leave(onClose), [leave, onClose]);
  const [text, setText] = useState('');
  // 폰·태블릿은 자동으로 굽지 않고 폰 스크린샷을 고른다(사용자 결정 2026-10-22 — 사파리는 굽기가 몇 초였다 · 폰 스크린샷은 바로 찍힌다)
  const [manual] = useState(() => /iPhone|iPad|안드로이드|갤럭시|태블릿/.test(deviceOf(navigator.userAgent).device));
  const [shot, setShot] = useState(manual ? null : undefined);   // undefined = 굽는 중 · null = 없음(뺐거나 못 구움 · 폰은 아직 안 고름)
  const pickRef = useRef(null);
  const pickShot = async (file) => {
    if (!file || !(file.type || '').startsWith('image/')) return;
    setShot(undefined);
    try { setShot(await fileShot(file)); } catch (e) {
      console.warn('[feedback] 고른 사진을 읽지 못했어요:', e?.message || e);
      showToast('스크린샷을 넣지 못했어요');   // 사용자 문구 2026-10-22
      setShot(null);
    }
  };
  const downOnScrim = useRef(false);
  // 보낼 때 그대로 싣는 값 — 창을 연 그 순간의 화면
  const info = useRef(null);
  if (!info.current) {
    const route = window.location.pathname + window.location.search;
    const p = new URLSearchParams(window.location.search).get('p');
    info.current = {
      route,
      screenName: screenOf(route, projects?.[p]?.title || null),
      ua: navigator.userAgent,
      size: `${window.innerWidth}×${window.innerHeight}`,
      build: buildId,
    };
  }
  const { device, browser } = deviceOf(info.current.ua);
  const phone = /iPhone|안드로이드|갤럭시/.test(device);

  // 굽기는 약속 하나(shotJob) — 다 굽기 전에 '보내기'를 눌러도 기다리지 않고 보낸다(글 먼저 · 사진은 다 구운 뒤 뒤에서 · ops.sendFeedback).
  // 보내지 않고 닫으면 아직 시작 전인 굽기는 건너뛴다.
  const shotJob = useRef(null);
  const sent = useRef(false);
  useEffect(() => {
    if (manual) return undefined;
    let alive = true;
    shotJob.current = new Promise(r => setTimeout(r, 420))   // 시트 모션(380ms)이 끝난 뒤 — 굽는 동안 모션이 끊기지 않게
      .then(() => ((alive || sent.current) ? captureViewport() : null))
      .catch((e) => { console.warn('[feedback] 화면 사진을 굽지 못했어요:', e?.message || e); return null; });
    shotJob.current.then(url => { if (alive) setShot(url || null); });
    return () => { alive = false; };
  }, [manual]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const [sending, setSending] = useState(false);
  const [dropping, setDropping] = useState(false);   // 사진을 지우는 중(줄어드는 모션 뒤에 걷는다)
  const dropShot = () => {
    if (prefersReducedMotion()) { setShot(null); return; }
    setDropping(true);
  };
  const canSend = text.trim().length > 0 && !sending;
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      sent.current = true;
      // 아직 굽는 중이면 그 약속을 넘긴다 — 다 구워지면 뒤에서 올라간다
      const photo = dropping || shot === null ? null : (shot !== undefined ? shot : shotJob.current);
      await sendFeedback({ user: me, text: text.trim(), shot: photo, ...info.current });
      showToast('피드백을 보냈어요');
      close();
    } catch (e) {
      console.error('[feedback] 보내지 못했어요:', e);
      showToast(failText('피드백을 보내지 못했어요', e));
      setSending(false);
    }
  };
  const out = leaving ? ' dc-out' : '';

  return createPortal(
    <div onMouseDown={(e) => { downOnScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnScrim.current) close(); }}
      data-feedback-scrim=""
      className={`fixed inset-x-0 top-[var(--vv-top,0px)] h-[var(--app-vh,100dvh)] z-[95] flex items-end md:items-center md:justify-center md:p-4 bg-black/50 dc-scrim${out}`}>
      <div role="dialog" aria-label="피드백 전송" data-feedback-send=""
        className={`w-full md:max-w-[440px] max-h-[88%] md:max-h-[85dvh] flex flex-col overflow-hidden bg-surface rounded-t-2xl md:rounded-lg md:border md:border-line md:shadow-elevated dc-sheet-dialog${out}`}>
        <span className="md:hidden shrink-0 self-center w-9 h-1 mt-2.5 rounded-full bg-line" />
        <div className="flex items-center gap-2 px-5 pt-3 md:pt-5 shrink-0">
          <h3 className="flex-1 font-bold text-fg tracking-[-0.25px]">피드백 전송</h3>
          <button type="button" onClick={close} title="닫기" aria-label="닫기" className="p-1 rounded-full text-fg-faint hover:bg-surface-hover"><X size={18} strokeWidth={1.75} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-3">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5} aria-label="피드백"
            placeholder="어떤 점이 불편했는지 적어 주세요"
            className={`${FIELD} w-full resize-none leading-relaxed py-2`} />
          <div className="mt-3 flex items-start gap-3">
            {shot === undefined ? (
              <Skeleton className="w-16 h-20 rounded-xs shrink-0" />
            ) : shot ? (
              <span className={`relative shrink-0 w-16 ops-shot${dropping ? ' ops-shot-out' : ''}`} data-feedback-shot=""
                onTransitionEnd={(e) => { if (dropping && e.target === e.currentTarget && e.propertyName === 'opacity') { setDropping(false); setShot(null); } }}>
                <img src={shot} alt="화면 스크린샷" className="w-16 h-20 object-cover object-top rounded-xs border border-line bg-canvas dc-fade" />
                <button type="button" onClick={dropShot} disabled={dropping} aria-label="화면 스크린샷 삭제" title="화면 스크린샷 삭제"
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-fg text-surface flex items-center justify-center shadow-elevated before:absolute before:-inset-1.5">
                  <X size={11} strokeWidth={2.5} />
                </button>
              </span>
            ) : manual ? (
              <button type="button" onClick={() => pickRef.current?.click()} data-feedback-pick=""
                className="w-16 h-20 shrink-0 rounded-xs border border-dashed border-line text-fg-muted hover:bg-surface-hover flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold transition active:scale-95">
                <ImagePlus size={16} /><span>사진 추가</span>
              </button>
            ) : null}
            {manual && <input ref={pickRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true"
              onChange={e => { pickShot(e.target.files?.[0]); e.target.value = ''; }} />}
            <span className="flex-1 min-w-0 pt-0.5">
              {(shot !== null || manual) && <span className={`block text-[12px] font-semibold text-fg ops-ease${dropping ? ' opacity-0' : ''}`}>화면 스크린샷</span>}
              {/* 폰에서 고르기 전 — 문구 사용자 확정 2026-10-22 */}
              {manual && !shot && <span className="block mt-0.5 text-[11.5px] text-fg-muted" data-feedback-pick-hint="">문제가 발생한 화면의 스크린샷을 보내주세요</span>}
              <span className="flex items-center gap-1.5 mt-0.5 text-[11.5px] text-fg-muted" data-feedback-device="">
                {phone ? <Smartphone size={12} className="shrink-0" /> : <Monitor size={12} className="shrink-0" />}
                <span className="min-w-0 break-words">{[device, browser, info.current.size, info.current.screenName].join(' · ')}</span>
              </span>
            </span>
          </div>
        </div>
        <div className="flex gap-2 px-5 pt-4 shrink-0" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={close} className={`flex-1 ${BTN_CONFIRM_QUIET}`}>취소</button>
          <button type="button" onClick={send} disabled={!canSend} data-feedback-submit="" className={`flex-1 ${BTN_CONFIRM}`}>보내기</button>
        </div>
      </div>
    </div>,
    document.body);
}
