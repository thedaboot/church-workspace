// ============================================================================
// 공유 링크로 들어온 로그인 — 카카오 인앱 판정 · 돌아갈 자리 · OAuth 실패 판정 (auth.jsx · LoginScreen.jsx)
// ----------------------------------------------------------------------------
// import 0개 — 노드 검사가 베껴 들인다(tests/_load.mjs). 부르는 쪽은 utils.js(바렐)를 문다.
// ============================================================================

// ── 공유 링크로 들어온 로그인 (auth.jsx · LoginScreen.jsx) ─────────────────────
// 순수 함수라 utils에 둔다(브라우저 없이 검사할 수 있게 — tests/logcheck.mjs).

// 카카오톡 인앱 브라우저인가. 카카오톡으로 공유한 링크는 대부분 여기서 열리는데,
// 세션이 없어 로그인 화면이 뜬다 — 그 자리에서는 카카오 로그인을 자동으로 시작한다
// (구글은 인앱 웹뷰에서 OAuth를 막는다 — disallowed_useragent). UA 표식은 'KAKAOTALK'.
export const isKakaoInApp = (ua = '') => /KAKAOTALK/i.test(String(ua || ''));

// 로그인 뒤 돌아갈 자리. 딥링크는 쿼리(?p=&t=&f=)에만 실리므로 pathname+search만 본다 —
// hash는 OAuth가 토큰·오류를 싣는 자리라 저장하면 안 된다. 홈('/')이면 null(기억할 것이 없다).
export const returnToOf = (loc) => {
  const path = String(loc?.pathname || '/');
  const search = String(loc?.search || '');
  const to = path + search;
  return to === '/' || to === '' ? null : to;
};

// OAuth가 실패해서 돌아왔나. Supabase는 오류를 hash(#error=…&error_description=…)에 싣고
// (auth-js는 오류일 때 hash를 지우지 않는다), 쿼리(?error=)로 오는 제공자도 있어 둘 다 본다.
// 참이면 자동 로그인을 다시 시작하지 않는다 — 안 그러면 실패 → 자동 시작 → 실패의 고리다.
export function authErrorInUrl(href = '') {
  let u;
  try { u = new URL(String(href), 'http://x'); } catch { return false; }
  const keys = ['error', 'error_description', 'error_code'];
  const has = (qs) => { const p = new URLSearchParams(qs); return keys.some(k => p.has(k)); };
  return has(u.search) || has(u.hash.replace(/^#/, ''));
}
