import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Smartphone, Monitor } from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { useLeave } from '../hooks/useExit.js';
import { BTN_CONFIRM, BTN_CONFIRM_QUIET } from './buttons.js';
import { FIELD } from './groupsParts.jsx';
import { Skeleton } from './media.jsx';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import { isBlankCanvas, corsImageUrl, toDataUrl } from '../services/shareImage.js';
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
const offscreen = (n, w, h) => {
  const r = n.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && (r.bottom < 0 || r.right < 0 || r.top > h || r.left > w);
};
const SHOT_MAX = 2560;
const SAFARI_REDRAWS = 3;
async function captureViewport() {
  const { createContext, destroyContext, domToCanvas } = await import('modern-screenshot');
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scale = shotScale(w, h, window.devicePixelRatio, SHOT_MAX);
  let ctx = null;
  ctx = await createContext(document.body, {
    width: w, height: h, scale,
    onCreateForeignObjectSvg: () => { if (ctx) ctx.drawImageCount = Math.min(ctx.drawImageCount, SAFARI_REDRAWS); },
    // body 사본에 브라우저 기본 여백(8px)이 되살아나 그림이 오른쪽 아래로 밀렸다(2026-10-18 시안 점검) — 뿌리에서 0으로 박는다
    style: { margin: '0' },
    backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
    filter: (n) => !(n instanceof Element && (n.hasAttribute('data-feedback-scrim') || offscreen(n, w, h))),
    features: { restoreScrollPosition: true },
    // CORS 없는 카카오 프로필 사진은 썸네일 주소로 받는다(shareImage.corsImageUrl) — 그 밖은 false로 기본 길에 맡긴다
    fetchFn: async (url) => {
      const via = corsImageUrl(url);
      if (via === url) return false;
      try {
        const res = await fetch(via, { mode: 'cors', credentials: 'omit' });
        return res.ok ? await toDataUrl(await res.blob()) : false;
      } catch { return false; }
    },
  });
  let canvas;
  try { canvas = await domToCanvas(ctx); } finally { destroyContext(ctx); }
  if (!canvas || isBlankCanvas(canvas)) throw new Error('빈 그림');
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.9);
}

export function FeedbackSend({ onClose }) {
  const me = useStore(selectCurrentUser).name;
  const projects = useStore(s => s.projects?.byId);
  const [leaving, leave] = useLeave();
  const close = useCallback(() => leave(onClose), [leave, onClose]);
  const [text, setText] = useState('');
  const [shot, setShot] = useState(undefined);   // undefined = 굽는 중 · null = 없음(뺐거나 못 구움)
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

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      captureViewport().then(url => { if (alive) setShot(url || null); })
        .catch((e) => { console.warn('[feedback] 화면 사진을 굽지 못했어요:', e?.message || e); if (alive) setShot(null); });
    }, 420);   // 시트 모션(380ms)이 끝난 뒤 — 굽는 동안 모션이 끊기지 않게
    return () => { alive = false; clearTimeout(t); };
  }, []);
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
      await sendFeedback({ user: me, text: text.trim(), shot: (!dropping && shot) || null, ...info.current });
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
            ) : null}
            <span className="flex-1 min-w-0 pt-0.5">
              {shot !== null && <span className={`block text-[12px] font-semibold text-fg ops-ease${dropping ? ' opacity-0' : ''}`}>화면 스크린샷</span>}
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
