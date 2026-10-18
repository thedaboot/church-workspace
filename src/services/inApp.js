// ============================================================================
// 카카오톡 인앱 브라우저 — 알아보기 · 외부 브라우저로 넘기기 (v5 2묶음 시안 · mock/b3)
// ----------------------------------------------------------------------------
// 인앱 웹뷰는 웹 푸시·홈 화면 추가·생체 인증(WebAuthn 플랫폼 인증기)이 안 된다. 그 자리는 같은 주소를
// `kakaotalk://web/openExternal?url=…`(아이폰·안드로이드 둘 다 — noticeDate.kakaoExternal과 같은 길)로 기본 브라우저에 넘긴다.
//   inKakao()         지금 카카오 인앱인가 — UA 'KAKAOTALK'(utils/authUrl.isKakaoInApp) 또는 **게스트 시연 표식**
//   openExternalUrl() 넘길 주소(지금 주소 그대로)
// 게스트 시연: 주소에 `?demo=kakao`면 이 탭(sessionStorage) 동안 인앱인 척한다 — 데스크톱·일반 폰 브라우저에서 바뀐 줄을
// 볼 길이다. 클라우드(로그인)에서는 표식을 읽지 않는다(실제 UA만).
// 순수 판정(kakaoDemoFrom · isKakaoUa · externalHref)은 노드 검사가 문다(tests/logcheck-phone).
// ============================================================================

export const DEMO_KEY = 'demo:kakao';

export const isKakaoUa = (ua = '') => /KAKAOTALK/i.test(String(ua || ''));

// 주소의 물음표 뒤 · 저장된 표식 · 클라우드인가 → 시연 표식을 켤까
export function kakaoDemoFrom(search = '', { cloud = false, stored = false } = {}) {
  if (cloud) return false;
  let q = '';
  try { q = new URLSearchParams(String(search || '')).get('demo') || ''; } catch { q = ''; }
  return q === 'kakao' || !!stored;
}

// 기본 브라우저로 넘기는 주소 — 넘길 주소는 절대 주소여야 한다(상대 주소면 카카오가 못 연다)
export function externalHref(absUrl) {
  const u = String(absUrl || '');
  if (!/^https?:\/\//i.test(u)) return null;
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(u)}`;
}

let demo = null;
export function kakaoDemo() {
  if (demo !== null) return demo;
  demo = false;
  if (typeof window === 'undefined') return demo;
  // supabaseClient를 들이지 않는다(이 파일은 노드 검사가 그대로 문다) — 게스트 빌드는 주소 키가 비어 있다
  const cloud = !!(import.meta.env?.VITE_SUPABASE_URL && import.meta.env?.VITE_SUPABASE_ANON_KEY);
  let stored = false;
  try { stored = sessionStorage.getItem(DEMO_KEY) === '1'; } catch { /* 막힌 저장소 */ }
  demo = kakaoDemoFrom(window.location.search, { cloud, stored });
  if (demo) { try { sessionStorage.setItem(DEMO_KEY, '1'); } catch { /* 위와 같다 */ } }
  return demo;
}

export const inKakao = () => kakaoDemo() || (typeof navigator !== 'undefined' && isKakaoUa(navigator.userAgent));

// 지금 화면을 기본 브라우저로. 시연(진짜 인앱 아님)이면 넘기지 않고 주소만 돌려준다(부르는 쪽이 토스트).
export function openExternal() {
  const href = externalHref(window.location.href);
  if (!href) return null;
  if (isKakaoUa(navigator.userAgent)) window.location.href = href;
  return href;
}
