// ============================================================================
// 참고 링크 이름 — 이름을 비우고 추가하면 주소에서 이름을 지어 준다(2026-10-15 · UX 다듬기 2차 C10 · PITFALLS 60).
// ----------------------------------------------------------------------------
// **순수 모듈이다(import 0)** — 앱(components/links.jsx)과 서버(api/link-title.js)가 같이 쓴다. titleText.js와 같은 자리.
//   domainOf(url)        제목을 받는 동안 줄에 옅게 서는 글자(www. 뗀 호스트)
//   fallbackTitle(url)   못 받았을 때의 이름 — '도메인 · 마지막 경로 한 토막'(편집·보기 같은 동작 토막과 긴 문서 id는 건너뛴다)
//   pageTitle(html, url) 받은 HTML의 <title>(없으면 og:title) — 구글 문서·시트·슬라이드·설문지는 ' - Google Docs' 꼬리를 떼고,
//                        로그인 화면 제목('Google Docs: Sign-in')이면 빈 값(그 문서는 못 읽은 것이다)
//   isYoutube(url)       유튜브는 페이지를 긁지 않고 oEmbed로 받는다(영상·재생목록 둘 다 된다)
//   linkUrlProblem(url)  서버가 받으러 가도 되는 주소인가 — http/https · 기본 포트 · 계정 정보 없음 · 내부 이름·사설 IP 글자 아님
//   isPrivateAddress(ip) DNS로 푼 주소가 우리 안쪽(사설·루프백·링크 로컬·메타데이터 169.254…)인가 — 서버의 lookup이 연결 직전에 본다
// SSRF 방어는 **두 겹**이다: 주소 글자(linkUrlProblem)와 연결할 IP(isPrivateAddress). 글자만 보면 공개 이름이 사설 IP로
// 풀리는 경우(DNS 재바인딩 포함)를 못 막는다 — 그래서 서버는 연결 소켓의 lookup에서 IP를 다시 본다(api/link-title.js).
// ============================================================================

const hostOf = (url) => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
};

export const domainOf = (url) => hostOf(url).replace(/^www\./, '');

// 마지막 경로 토막 — 문서 주소의 '/edit'·'/view'처럼 동작을 뜻하는 꼬리와 긴 id(구글 문서 44자)는 이름이 못 된다
const ACTION_SEG = new Set(['edit', 'view', 'viewform', 'preview', 'pub', 'htmlview', 'present', 'copy', 'u', 'd', 'e', 'index.html', 'index.htm', 'index.php']);
const OPAQUE = /^[A-Za-z0-9_-]{20,}$/;
export function fallbackTitle(url) {
  const domain = domainOf(url);
  if (!domain) return String(url || '').trim();
  let segs = [];
  try { segs = new URL(url).pathname.split('/').filter(Boolean); } catch { segs = []; }
  for (let i = segs.length - 1; i >= 0; i--) {
    let s = segs[i];
    try { s = decodeURIComponent(s); } catch { /* 깨진 퍼센트 글자는 그대로 */ }
    s = s.replace(/[-_+]+/g, ' ').trim();
    if (!s || ACTION_SEG.has(s.toLowerCase()) || OPAQUE.test(segs[i]) || /^\d+$/.test(s) && s.length > 6) continue;
    return `${domain} · ${s.length > 40 ? `${s.slice(0, 39)}…` : s}`;
  }
  return domain;
}

export const isYoutube = (url) => /(^|\.)(youtube\.com|youtu\.be)$/.test(hostOf(url));

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', ndash: '–', mdash: '—' };
export const decodeEntities = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return Number.isFinite(n) ? String.fromCodePoint(n) : m; } catch { return m; }
  }
  return ENTITY[e.toLowerCase()] ?? m;
});

// 구글 문서 계열 제목 꼬리(영문·한국어 화면) — 떼면 문서 이름만 남는다
const GOOGLE_TAIL = / [-–] (Google (Docs|Sheets|Slides|Forms|Drive)|Google (문서|스프레드시트|프레젠테이션|설문지|드라이브)|Google ドキュメント)$/;
const GOOGLE_HOST = /(^|\.)google\.com$/;
// 공개가 아닌 문서는 로그인 화면이 온다 — 그 제목을 이름으로 앉히면 화면이 거짓말한다
const SIGN_IN = /sign[\s-]?in|로그인|Google 계정|Google Account|^Google (Docs|Sheets|Slides|Forms|Drive|문서|스프레드시트|프레젠테이션|설문지|드라이브)$/i;

export function pageTitle(html, url = '') {
  const text = String(html || '');
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]
    ?? /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(text)?.[1]
    ?? /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i.exec(text)?.[1]
    ?? '';
  let title = decodeEntities(t).replace(/\s+/g, ' ').trim();
  if (GOOGLE_HOST.test(hostOf(url))) {
    if (SIGN_IN.test(title)) return '';
    title = title.replace(GOOGLE_TAIL, '').trim();
  }
  return title.length > 200 ? `${title.slice(0, 199)}…` : title;
}

// ── 서버가 받으러 가도 되는 주소인가 (SSRF) ──────────────────────────────────
// 돌려주는 값: 문제가 없으면 null, 있으면 이유(로그용 짧은 영어 낱말 — 화면에는 안 나간다).
const INTERNAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa|localdomain)$/;
export function linkUrlProblem(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'parse'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'scheme';
  if (u.username || u.password) return 'userinfo';
  if (u.port && u.port !== '80' && u.port !== '443') return 'port';
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return 'host';
  if (isIpLiteral(host)) return isPrivateAddress(host) ? 'private-ip' : null;
  if (!host.includes('.') || INTERNAL_NAME.test(host)) return 'internal-name';
  return null;
}

const isIpLiteral = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');

const v4parts = (ip) => {
  const p = ip.split('.').map(Number);
  return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
};
function privateV4([a, b, c]) {
  return a === 0 || a === 10 || a === 127 || a >= 224                 // 이 망 · 사설 · 루프백 · 멀티캐스트 · 예약
    || (a === 100 && b >= 64 && b <= 127)                              // CGNAT
    || (a === 169 && b === 254)                                        // 링크 로컬(클라우드 메타데이터 169.254.169.254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))                  // IETF · 문서용
    || (a === 198 && (b === 18 || b === 19))                           // 벤치마크
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}
// IPv6 → 16바이트(줄임 :: · 끝의 v4 표기 둘 다). 못 읽으면 null
function v6bytes(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const tail = /(\d{1,3}(\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const p = v4parts(tail[1]); if (!p) return null;
    s = s.slice(0, -tail[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  const groups = rest ? [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest] : head;
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap(g => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
}
export function isPrivateAddress(ip) {
  const s = String(ip || '').trim().replace(/^\[|\]$/g, '');
  const v4 = v4parts(s);
  if (v4) return privateV4(v4);
  const b = v6bytes(s);
  if (!b) return true;                                                   // 못 읽는 주소는 막는다
  const zero = (from, to) => b.slice(from, to).every(x => x === 0);
  if (zero(0, 16)) return true;                                          // ::
  if (zero(0, 15) && b[15] === 1) return true;                           // ::1
  if (zero(0, 10) && b[10] === 255 && b[11] === 255) return privateV4(b.slice(12));   // ::ffff:a.b.c.d
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return privateV4(b.slice(12)); // 64:ff9b:: NAT64
  if ((b[0] & 0xfe) === 0xfc) return true;                               // fc00::/7 고유 로컬
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;              // fe80::/10 링크 로컬
  if (b[0] === 0xff) return true;                                        // 멀티캐스트
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;  // 2001:db8:: 문서용
  return false;
}
