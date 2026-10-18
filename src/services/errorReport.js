// ============================================================================
// 앱 내 오류 보내기(v5 2묶음 · 0113 report_client_error) — 관리자 메뉴 '앱 내 오류'의 원본
// ----------------------------------------------------------------------------
// 받는 자리 셋: window 'error' · 'unhandledrejection'(installErrorCapture — main.jsx가 한 번) · ErrorBoundary(componentDidCatch → reportError).
//   · **한 세션에 지문 하나는 한 번**(sent Set) — 같은 오류가 고리로 나도 한 번만 보낸다. 셈은 DB가 (지문·사람·빌드·화면·기기·날짜)
//     한 줄에 count로 모은다(다른 세션·다른 날은 또 센다).
//   · 지문은 opsCore.errorFingerprint(문구의 숫자·id·주소를 걷은 글 + 스택 맨 위의 함수@파일 — 빌드 해시·줄 번호 없음).
//   · 보내기는 **새 Vercel 함수 없이** DB 함수 하나(security definer · 승인된 사람만 · 사람마다 10분 20줄 · 하루 3000줄 상한 —
//     Vercel Hobby 함수 자리가 9/12다). 로그인 전(세션 없음)에는 보내지 않는다 — 함수가 받지 않는다.
//   · 브라우저가 내는 무해한 소리(ResizeObserver loop)와 확장 프로그램 스크립트(chrome-extension:)는 받지 않는다.
//   · 보내기가 실패해도 아무것도 하지 않는다(콘솔 한 줄) — 오류를 보내다 오류를 내면 고리다.
//   · 게스트 시연(opsDemo.demoOn)은 브라우저 목록에 넣는다(opsDemo.captureErrors — 같은 모양).
// 빌드 표식은 vite define `__BUILD_ID__`(vite.config.js — Vercel 커밋 해시 앞 일곱 자 · 로컬 'dev').
// ============================================================================
import { supabase } from './supabaseClient.js';
import { errorFingerprint, topFrame } from './opsCore.js';

export const buildId = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

const sent = new Set();
const IGNORE = /ResizeObserver loop|^Script error\.?$/;

export function reportError(error, extra = '') {
  if (!supabase) return;
  const message = String(error?.message || error || '').slice(0, 300);
  const stack = String(error?.stack || extra || '').slice(0, 2000);
  if (!message || IGNORE.test(message) || /chrome-extension:|moz-extension:|safari-web-extension:/.test(stack)) return;
  const ev = { message, stack };
  const fp = errorFingerprint(ev);
  if (sent.has(fp)) return;
  sent.add(fp);
  void (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { sent.delete(fp); return; }   // 로그인한 뒤 다시 나면 그때 보낸다
      const { error: e } = await supabase.rpc('report_client_error', {
        fp, msg: message, frame: topFrame(stack), stk: stack,
        rt: (location.pathname + location.search).slice(0, 300), agent: navigator.userAgent.slice(0, 300), bld: buildId,
      });
      if (e) throw e;
    } catch (e) {
      console.warn('[errors] 오류를 보내지 못했어요:', e?.message || e);
    }
  })();
}

let installed = false;
export function installErrorCapture() {
  if (installed || typeof window === 'undefined' || !supabase) return;
  installed = true;
  window.addEventListener('error', (e) => reportError(e.error || e.message, e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : ''));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason));
}
