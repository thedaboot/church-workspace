// ============================================================================
// 구글 문서·시트·슬라이드 주소 판정과 임베드 주소 (2026-09-07)
// ----------------------------------------------------------------------------
// 순수 함수만 둔다 — 그리는 쪽은 `components/DocEmbed.jsx`이고, 그 파일이 이 두 함수를
// 그대로 다시 내보낸다(부르는 쪽은 컴포넌트 파일 하나만 import하면 된다).
// 여기 따로 둔 이유는 **브라우저 없이 검사하기 위해서다** — JSX가 섞이면 노드가 못 읽는다
// (`tests/three.mjs` 앞부분이 이 파일을 그대로 import한다 · HANDOFF §2-5).
// ============================================================================

const KIND_OF = { document: 'doc', spreadsheets: 'sheet', presentation: 'slide' };

export const DOC_KIND_LABEL = { doc: '구글 문서', sheet: '구글 스프레드시트', slide: '구글 슬라이드' };

// 구글 문서 주소인가, 어느 종류인가. 아니면 null.
// 호스트 바로 뒤에 `/`가 오도록 묶여 있어서 `docs.google.com.남의도메인.com`은 걸리지 않는다.
export function docEmbedKind(url) {
  const m = /^https?:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\//i.exec(String(url || ''));
  if (!m) return null;
  return KIND_OF[m[1].toLowerCase()] || null;
}

// 앱 안 iframe에 실을 주소.
//   · `http` → `https` (섞인 내용은 브라우저가 막는다)
//   · 끝을 `/edit`으로 맞춘다 — `/view`·`/preview`·`/htmlview`로 온 링크를 그대로 실으면
//     편집 권한이 있어도 읽기 화면이 뜬다. 아무것도 없는 `/d/<id>`도 마찬가지다.
//   · `?rm=minimal` — 구글 편집기의 도구 줄을 줄인 모양. 앱 안 창은 폭이 좁다.
//   · **원 주소의 나머지는 건드리지 않는다**: `#gid=`(시트의 어느 탭인지)·`usp=`가 그대로 간다.
//     `#gid=`를 잃으면 링크로 가리킨 탭이 아니라 첫 탭이 열린다.
//   · `/d/e/<긴 id>/pubhtml`(웹에 게시한 사본)은 **경로를 그대로 둔다** — 그건 편집할 수
//     있는 문서가 아니고, `/edit`으로 바꾸면 있지도 않은 주소가 된다.
//   · `email`을 주면 `authuser=<이메일>` — 브라우저에 구글 계정이 여럿 로그인돼 있으면
//     구글은 **기본 계정**으로 열고, 그 계정에 편집 권한이 없으면 읽기 화면이 뜬다
//     (§6-34-h · previewKind.copyEditUrl과 같은 사정이다). 앱에 로그인한 supabase 세션의
//     user.email을 넘긴다. 값이 없으면 아무것도 붙이지 않는다(지금까지와 같은 주소).
// 구글 문서 주소가 아니면 원문을 그대로 돌려준다(부르는 쪽이 docEmbedKind로 먼저 가른다).
export function docEmbedSrc(url, { email = '' } = {}) {
  const raw = String(url || '');
  if (!docEmbedKind(raw)) return raw;
  let u;
  try { u = new URL(raw); } catch { return raw; }
  u.protocol = 'https:';
  const m = /^\/(document|spreadsheets|presentation)\/d\/(e\/)?([^/]+)/.exec(u.pathname);
  if (m && !m[2]) u.pathname = `/${m[1]}/d/${m[3]}/edit`;
  u.searchParams.set('rm', 'minimal');
  if (email) u.searchParams.set('authuser', email);
  return u.toString();
}
