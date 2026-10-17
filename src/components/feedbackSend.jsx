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
import { nodeToPng } from '../services/shareImage.js';
import { deviceOf, screenOf } from '../services/opsCore.js';
import { addFeedback } from '../services/opsDemo.js';

// ============================================================================
// 불편 사항 보내기(시안 v5 2묶음 · mock/b3 · 모든 사람 · 입구는 프로필 메뉴 · 게스트 시연에서만 선다)
// ----------------------------------------------------------------------------
// 폰은 아래 시트, 데스크톱은 가운데 대화창 — `.dc-sheet-dialog` 한 클래스가 둘을 가른다(index.css · 768부터 대화창).
// 시트는 **보이는 창(--app-vh)** 안에 선다(leaderOnly 보는 사람 시트와 같은 길 — 키보드가 올라와도 '보내기'가 가리지 않게).
//   · 글 칸 하나 + 자동으로 붙는 것 둘: 지금 화면 사진(`main`을 shareImage.nodeToPng로 굽고 480폭 jpeg로 줄인다 —
//     창이 뜨는 모션이 끝난 뒤 굽는다 · 뺄 수 있다) · 기기 정보 한 줄(기기 · 브라우저 · 화면 크기 · 화면 이름).
//   · 굽지 못하면 사진 자리를 지우고 보낸다(사진 없이도 보낼 수 있어야 한다 · 원문은 콘솔).
//   · 보내면 게스트는 운영 창의 불편 사항 목록 맨 위에 바로 선다(opsDemo.addFeedback).
// 실제 앱: 사진은 Storage(비공개 버킷 · 마스터만 읽기) · 행은 feedback 표(본인만 넣기 · 마스터만 읽기·상태 바꾸기).
// ============================================================================

const SHOT_W = 480;
async function captureScreen() {
  const main = document.querySelector('main');
  if (!main) return null;
  const bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
  const blob = await nodeToPng(main, bg);
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, SHOT_W / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.72);
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
      build: import.meta.env.MODE === 'guest' ? 'guest' : 'dev',
    };
  }
  const { device, browser } = deviceOf(info.current.ua);
  const phone = /iPhone|안드로이드|갤럭시/.test(device);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      captureScreen().then(url => { if (alive) setShot(url || null); })
        .catch((e) => { console.warn('[feedback] 화면 사진을 굽지 못했어요:', e?.message || e); if (alive) setShot(null); });
    }, 420);   // 시트 모션(380ms)이 끝난 뒤 — 굽는 동안 모션이 끊기지 않게
    return () => { alive = false; clearTimeout(t); };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const canSend = text.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    addFeedback({ user: me, text: text.trim(), shot: shot || null, ...info.current });
    showToast('불편 사항을 보냈어요');
    close();
  };
  const out = leaving ? ' dc-out' : '';

  return createPortal(
    <div onMouseDown={(e) => { downOnScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnScrim.current) close(); }}
      className={`fixed inset-x-0 top-0 h-[var(--app-vh,100dvh)] z-[95] flex items-end md:items-center md:justify-center md:p-4 bg-black/50 dc-scrim${out}`}>
      <div role="dialog" aria-label="불편 사항 보내기" data-feedback-send=""
        className={`w-full md:max-w-[440px] max-h-[88%] md:max-h-[85dvh] flex flex-col overflow-hidden bg-surface rounded-t-2xl md:rounded-lg md:border md:border-line md:shadow-elevated dc-sheet-dialog${out}`}>
        <span className="md:hidden shrink-0 self-center w-9 h-1 mt-2.5 rounded-full bg-line" />
        <div className="flex items-center gap-2 px-5 pt-3 md:pt-5 shrink-0">
          <h3 className="flex-1 font-bold text-fg tracking-[-0.25px]">불편 사항 보내기</h3>
          <button type="button" onClick={close} title="닫기" aria-label="닫기" className="p-1 rounded-full text-fg-faint hover:bg-surface-hover"><X size={18} strokeWidth={1.75} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-3">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5} aria-label="불편 사항"
            placeholder="어떤 점이 불편했는지 적어 주세요"
            className={`${FIELD} w-full resize-none leading-relaxed py-2`} />
          <div className="mt-3 flex items-start gap-3">
            {shot === undefined ? (
              <Skeleton className="w-16 h-20 rounded-xs shrink-0" />
            ) : shot ? (
              <span className="relative shrink-0" data-feedback-shot="">
                <img src={shot} alt="화면 사진" className="w-16 h-20 object-cover object-top rounded-xs border border-line bg-canvas" />
                <button type="button" onClick={() => setShot(null)} aria-label="화면 사진 빼기" title="화면 사진 빼기"
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-fg text-surface flex items-center justify-center shadow-elevated before:absolute before:-inset-1.5">
                  <X size={11} strokeWidth={2.5} />
                </button>
              </span>
            ) : null}
            <span className="flex-1 min-w-0 pt-0.5">
              {shot !== null && <span className="block text-[12px] font-semibold text-fg">화면 사진</span>}
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
