import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Supabase 단일 클라이언트 인스턴스
// - VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 미설정 시 null
//   → 앱은 로그인 없는 게스트(로컬) 모드로 동작
// ============================================================================
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 다른 파일이 직접 REST를 부를 때 쓴다 — 지금은 `cloud.stampLeaveBeacon` 하나다
// (탭을 닫는 순간의 요청은 supabase-js로는 취소돼서 keepalive fetch로 직접 보낸다).
export const SUPABASE_URL = url || '';
export const SUPABASE_ANON_KEY = anonKey || '';

// ── 쓰기 한 번 = 다녀간 시각 한 번 ───────────────────────────────────────────
// **쓰기는 곧 '지금'이다**(2026-09-06). 5분 심장박동은 *아무것도 안 하는 사람*의
// 상한이라, 그 사이에 업무를 고친 사람은 남들 화면에서 "1분 전 수정 · 4분 전 다녀감"이라는
// 모순으로 보였다(사용자 지적 2026-09-05).
//
// 쓰기 함수마다 한 줄씩 넣지 않고 **여기 한 군데**서 보는 이유: 쓰기가 cloud.js만이
// 아니라 worship·groups·bible·roster에도 흩어져 있고, 앞으로 생길 것까지 빠짐없이
// 덮으려면 클라이언트가 실제로 내보내는 요청을 보는 자리가 유일하게 안전하다.
// 실제로 무엇을 할지는 부르는 쪽이 정한다(cloudSync.markSeen — 1분 스로틀).
let onWrite = null;
export const setWriteObserver = (fn) => { onWrite = fn; };

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
// POST지만 쓰기가 아닌 것들 — 로그인 직후 자격 확인(auth.jsx)과 다녀간 시각 그 자체.
// 다녀간 시각 함수를 빼지 않으면 스탬프가 스스로를 부른다.
const NOT_A_WRITE = /\/rest\/v1\/rpc\/(is_admin|is_master|is_approved|touch_last_seen)\b/;

// storage는 안 본다 — 이 앱의 파일 업로드는 언제나 `files` 행 쓰기(/rest/v1/)를 같이
// 하므로 두 번 셀 이유가 없고, 서명 주소 발급(POST)은 **보기**라 쓰기로 세면 거짓이 된다.
function observedFetch(input, init) {
  const method = String(init?.method || input?.method || 'GET').toUpperCase();
  if (onWrite && WRITE_METHODS.has(method)) {
    const href = String(typeof input === 'string' ? input : (input?.url || ''));
    if (href.includes('/rest/v1/') && !NOT_A_WRITE.test(href)) {
      try { onWrite(); } catch { /* 다녀간 시각 한 칸 때문에 쓰기를 막지 않는다 */ }
    }
  }
  return globalThis.fetch(input, init);
}

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      // 세션 지속성 명시 (기본값이지만 의도를 분명히 — 새로고침 후 로그인 유지)
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: observedFetch },
    })
  : null;

export const isCloudEnabled = () => !!supabase;
