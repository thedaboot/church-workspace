// ============================================================================
// 뽑은 글이 **글인가** · HTML에서 글만 걷기 (2026-09-24) — 순수 모듈(import 0)
// ----------------------------------------------------------------------------
// 첨부 발췌(files.text_excerpt · services/fileText.js)가 쓰고, 첨부 백필 스크립트도 같은 규칙을
// 쓴다(한 곳에 둔다 — 둘이 따로 두면 어느 쪽이 '글'로 보는지가 갈린다). tests/logcheck가 노드에서
// 그대로 부른다.
//
// 왜 필요한가: 악보·콘티 PDF에서 pdf.js가 뽑는 것은 화음 글자와 음표 기호 부스러기
// (`¤ 十 ☆ □ ⇌ …`)다. 그 부스러기가 그대로 발췌에 들어가면 AI 요약 프롬프트가 읽을 것 없는
// 기호 2천 자를 싣는다. 이런 PDF는 발췌를 비워 두는 편이 낫다(첨부는 되고 발췌만 없다 —
// fileText의 "절대 던지지 않는다"와 같은 판단).
// ============================================================================

// 읽히는 글자 — 한글 음절·로마자·숫자
const READABLE = /[가-힣A-Za-z0-9]/g;
// 글에 흔히 끼는 문장부호(여기 없으면 '이상한 기호'로 센다). 백필 스크립트의 목록에 인쇄물
// 문장부호(곧은·굽은 따옴표, 줄표, 가운뎃점·글머리표, 겹낫표·꺾쇠)를 더했다 — 워드에서 만든
// PDF는 따옴표·글머리표를 거의 늘 이 모양으로 품는다. 악보 부스러기(¤ 十 ☆ □ ⇌ ♩)는 빠진다.
const WEIRD = /[^가-힣A-Za-z0-9.,:;!?()[\]\-·/'"…%+&#*~“”‘’–—•「」『』〈〉《》【】<>=@_]/g;

// 공백을 뺀 몸통 기준 비율 — { length, readable, weird, hangul }
export function textStats(text) {
  const body = String(text || '').replace(/\s+/g, '');
  const count = (re) => (body.match(re) || []).length;
  return {
    length: body.length,
    readable: count(READABLE),
    weird: count(WEIRD),
    hangul: count(/[가-힣]/g),
  };
}

// 이게 글인가 — 읽히는 글자가 60% 이상이고 이상한 기호가 5% 이하.
// 앱(첨부 PDF)은 **글자 수·한글 수를 보지 않는다** — 영어 문서나 한 줄짜리 PDF를 비우면 안 된다.
// 백필 스크립트는 그 둘을 더 걸어(minLength 20 · minHangul 30) 사진·스캔 PDF를 Gemini로 넘길지
// 정한다(이 워크스페이스 문서는 한국어라, 화음 글자만 남은 콘티를 거기서 한 번 더 거른다).
export function looksLikeText(text, { minLength = 1, minHangul = 0 } = {}) {
  const s = textStats(text);
  if (!s.length || s.length < minLength || s.hangul < minHangul) return false;
  return s.readable / s.length >= 0.6 && s.weird / s.length <= 0.05;
}

// ── HTML → 글 ───────────────────────────────────────────────────────────────
// HTML 첨부의 원문을 그대로 발췌에 넣으면 태그·스타일·스크립트가 2천 자를 먼저 채운다.
// 태그를 걷고 글만 남긴다. 화면에 그리는 것이 아니라 읽을 글을 뽑는 것이라 정규식이면 충분하다
// (DOM을 만들지 않는다 — 노드에서 검사되고, 스크립트가 도는 일도 없다).
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…' };

export function htmlToText(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // 내용까지 버리는 자리 — 글이 아니다
    .replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    // 줄이 나뉘는 태그는 줄바꿈으로(문단이 한 덩어리로 붙지 않게)
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}
