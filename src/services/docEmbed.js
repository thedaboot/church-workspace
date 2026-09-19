// ============================================================================
// 구글 문서·시트·슬라이드 주소 판정과 임베드 주소 (2026-09-07)
// ----------------------------------------------------------------------------
// 순수 함수만 둔다 — 그리는 쪽은 `components/DocEmbed.jsx`이고, 그 파일이 이 두 함수를
// 그대로 다시 내보낸다(부르는 쪽은 컴포넌트 파일 하나만 import하면 된다).
// 여기 따로 둔 이유는 **브라우저 없이 검사하기 위해서다** — JSX가 섞이면 노드가 못 읽는다
// (`tests/three.mjs` 앞부분이 이 파일을 그대로 import한다 · HANDOFF §3-5).
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
//
// **`mobile`이면 보기 주소를 주고 `authuser`를 붙이지 않는다**(사용자 신고 2026-09-20 ·
// §6-34-h-3). 폰에서 본문 링크를 열면 첨부와 똑같이 **'액세스 권한 필요'** 가 떴다 —
// 아이폰이 iframe 안 구글 쿠키를 분할해서, 계정 목록은 읽히는데 그 계정으로 문서를 열
// 자격은 오지 않는다. 같은 문서를 로그인 없이 받으면 `/preview`도 `/edit?rm=minimal`도
// 멀쩡히 200이다(실측) — 주소·공유 설정은 문제가 없다. **보기 주소는 로그인을 아예 쓰지
// 않아** 링크가 공유돼 있으면 폰에서도 그냥 뜬다. 폰에서 *고치는* 길은 창 머리줄의
// '새 탭에서 열기'(1차 쿠키) 하나다.
//   · `document`     → `/preview`
//   · `spreadsheets` → `/preview` + `widget=true&rm=minimal`(머리줄·탭 줄을 줄인 모양 ·
//                      previewKind의 사본 보기 주소와 같은 인자다). `#gid=`는 그대로 남는다.
//   · `presentation` → `/preview`지만 **부르는 쪽이 먼저 가른다** — 폰에서 슬라이드는
//     iframe을 아예 만들지 않는다(components/DocEmbed.jsx · §6-29-y-2로 앱이 죽는다).
//     여기 값은 그 갈래를 빠뜨렸을 때를 위한 방어다.
// 구글 문서 주소가 아니면 원문을 그대로 돌려준다(부르는 쪽이 docEmbedKind로 먼저 가른다).
export function docEmbedSrc(url, { email = '', mobile = false } = {}) {
  const raw = String(url || '');
  if (!docEmbedKind(raw)) return raw;
  let u;
  try { u = new URL(raw); } catch { return raw; }
  u.protocol = 'https:';
  const m = /^\/(document|spreadsheets|presentation)\/d\/(e\/)?([^/]+)/.exec(u.pathname);
  const editable = !!(m && !m[2]);
  if (mobile) {
    // 게시본(`/d/e/…/pubhtml`)은 이미 보기 전용이라 손댈 것이 없다 — 경로도 인자도 그대로.
    if (editable) {
      u.pathname = `/${m[1]}/d/${m[3]}/preview`;
      if (m[1] === 'spreadsheets') { u.searchParams.set('widget', 'true'); u.searchParams.set('rm', 'minimal'); }
    }
    return u.toString();
  }
  if (editable) u.pathname = `/${m[1]}/d/${m[3]}/edit`;
  u.searchParams.set('rm', 'minimal');
  if (email) u.searchParams.set('authuser', email);
  return u.toString();
}

// 링크가 가리키는 **파일 id**. `docEmbedKind`와 같은 정규식이고, 웹에 게시한 사본
// (`/d/e/<긴 id>`)은 드라이브 파일 id가 아니므로 null이다.
export function docEmbedId(url) {
  const m = /^https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/(e\/)?([^/?#]+)/i
    .exec(String(url || ''));
  return (!m || m[1]) ? null : m[2];
}

// 그 문서의 **첫 장 그림**. 구글이 이미지 CDN(lh3)으로 로그인 없이 내준다(실측: 200 ·
// image/png · 269KB). 폰에서 슬라이드를 iframe 없이 한 장만 세우는 갈래가 쓴다.
// `previewKind.slideThumbUrl`과 **같은 결의 주소**인데 여기 따로 두는 이유는 이 파일도
// **순수 모듈**이기 때문이다 — `tests/three.mjs`가 노드로 그대로 import한다(서비스 import 금지).
export function docThumbUrl(url, w = 1200) {
  const id = docEmbedId(url);
  return id ? `https://lh3.googleusercontent.com/d/${id}=w${w}` : null;
}
