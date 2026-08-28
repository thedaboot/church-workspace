// ============================================================================
// xlsx 읽기 — 의존성 없이. zip은 네이티브 DecompressionStream, XML은 평문 스캔.
// ----------------------------------------------------------------------------
// 왜 직접 읽나: 구글 뷰어는 **갓 올린 파일을 못 그린다**(편집기 preview가
// "Google Docs에 오류가 발생했습니다"를 띄운다). 그래서 예전에는 파일 나이 30분으로
// 뷰어를 갈랐고, "올리고 바로 펼쳐보기"는 언제나 못생긴 쪽으로 떨어졌다.
// 바이트는 이미 /api/drive-file이 중계하고 있으므로, 그 바이트를 우리가 읽으면
// 기다릴 것이 없다 — 올린 그 순간부터 그린다.
//
// 왜 라이브러리를 안 쓰나: SheetJS 계열은 gzip 수백 KB인데, 우리가 쓰는 것은
// "값 + 서식 조금"이다. zip 풀기는 브라우저에 이미 있고(DecompressionStream),
// xlsx의 XML은 기계가 뱉은 납작한 문서라 평문 스캔으로 충분하다.
//
// DOM을 쓰지 않는다 — 순수 함수라 노드에서 그대로 검사한다(tests/sheet.mjs, §2-5).
// ============================================================================

import { compile, evalRule, BLANK } from './formula.js';

const u16 = (d, p) => d[p] | (d[p + 1] << 8);
const u32 = (d, p) => (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24)) >>> 0;

// ── zip ─────────────────────────────────────────────────────────────────────
// 중앙 디렉터리를 걸어 항목을 모은다. 데이터 시작 위치는 **로컬 헤더에서 다시**
// 읽는다 — 중앙 디렉터리와 로컬 헤더의 extra 길이가 다른 경우가 실제로 있다.
function zipEntries(buf) {
  const d = new Uint8Array(buf);
  let eo = -1;
  for (let i = d.length - 22; i >= Math.max(0, d.length - 65557); i--) {
    if (u32(d, i) === 0x06054b50) { eo = i; break; }
  }
  if (eo < 0) throw new Error('엑셀 파일이 아니에요');
  const count = u16(d, eo + 10);
  let p = u32(d, eo + 16);
  const out = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= d.length; n++) {
    if (u32(d, p) !== 0x02014b50) break;
    const method = u16(d, p + 10);
    const csize = u32(d, p + 20);
    const fnLen = u16(d, p + 28);
    const exLen = u16(d, p + 30);
    const cmLen = u16(d, p + 32);
    const lho = u32(d, p + 42);
    const name = dec.decode(d.subarray(p + 46, p + 46 + fnLen));
    const start = lho + 30 + u16(d, lho + 26) + u16(d, lho + 28);
    out.set(name, { method, raw: d.subarray(start, start + csize) });
    p += 46 + fnLen + exLen + cmLen;
  }
  return out;
}

async function readEntry(entries, name) {
  const e = entries.get(name);
  if (!e) return '';
  if (e.method === 0) return new TextDecoder().decode(e.raw);
  // deflate-raw는 브라우저·노드 모두 전역에 있다
  const stream = new Blob([e.raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

// ── XML 조각 ─────────────────────────────────────────────────────────────────
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unesc = (s) => s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, k) => {
  if (k[0] === '#') return String.fromCodePoint(parseInt(k[1] === 'x' ? k.slice(2) : k.slice(1), k[1] === 'x' ? 16 : 10));
  return ENT[k] ?? m;
});
// 여는 태그의 속성을 한 번에 훑어 객체로 만든다.
// 예전에는 이름마다 `new RegExp('\\b'+name+'="…"')`를 만들어 찾았는데, 그 방식이
// **t 속성을 못 찾아서** 공유 문자열이 전부 인덱스 숫자로 나왔다(셀에 '156'처럼
// 보였다). 이름을 문자열로 이어 붙여 정규식을 만드는 길은 이런 식으로 조용히
// 어긋난다 — 한 번 훑어 담는 쪽이 빠르기도 하다(셀마다 정규식을 여러 번 만들지 않는다).
const ATTR_RE = /([\w:.-]+)="([^"]*)"/g;
export function attrs(tag) {
  const o = {};
  for (const m of tag.matchAll(ATTR_RE)) o[m[1]] = m[2];
  return o;
}
// 한 번만 보는 자리(스타일·시트 목록 등)용 편의 함수. 셀처럼 여러 번 보는 자리는
// attrs()로 한 번에 받아 쓴다 — 셀마다 태그를 다시 훑으면 큰 표에서 값을 치른다.
const attr = (tag, name) => attrs(tag)[name] ?? null;
// <이름 …>안</이름> 과 <이름 …/> 을 모두 훑는다. 자기 닫는 태그는 안이 빈 문자열.
//
// 함정: 자기 닫는 태그를 정규식의 `(/)?` 그룹으로 잡으려 하면 안 된다. 앞의
// `[^>]*`가 탐욕적이라 **끝 슬래시까지 먹어버려서** 그 그룹이 언제나 비고, 태그가
// "열린 것"으로 판정된다. 그러면 `</c>`를 찾아 **다음 셀을 통째로 안쪽 내용으로
// 삼킨다** — 값이 한 칸 왼쪽으로 밀리고 t="s"를 잃어 공유 문자열이 인덱스 숫자로
// 보였다(셀에 '156'). 닫힌 태그가 아예 없는 곳(<col/>·<mergeCell/>)에서는 우연히
// 맞게 돌아서 더 늦게 드러났다. 문자열 끝을 보는 쪽이 정직하다.
export function* blocks(xml, name) {
  // `/?`가 있어야 **속성 없는 자기 닫는 태그**(<font/>)도 잡힌다. 속성이 있으면
  // 앞의 [^>]*가 슬래시를 먹어서 우연히 맞지만, <font/>는 통째로 건너뛰어져
  // 글꼴 목록이 한 칸 밀렸다(굵기가 엉뚱한 셀에 붙는다 — tests/sheet.mjs가 잡았다).
  const re = new RegExp(`<${name}(\\s[^>]*)?/?>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    const open = m[0];
    if (open.endsWith('/>')) { yield { open, inner: '' }; continue; }
    const close = xml.indexOf(`</${name}>`, re.lastIndex);
    if (close < 0) { yield { open, inner: '' }; continue; }
    yield { open, inner: xml.slice(re.lastIndex, close) };
    re.lastIndex = close + name.length + 3;
  }
}

// ── 색 ──────────────────────────────────────────────────────────────────────
// rgb="FFFFFF00"(ARGB) · theme="4" tint="-0.2" · indexed=… 세 갈래.
// theme은 theme1.xml의 clrScheme을 쓰는데, 엑셀은 **앞의 두 개를 뒤집어** 쓴다
// (0=lt1, 1=dk1). 이걸 안 뒤집으면 흰 배경이 검게 나온다.
const THEME_ORDER = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11];
function themeColors(xml) {
  const scheme = (xml.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/) || [''])[0];
  const out = [];
  // 자식 하나가 색 하나다(dk1·lt1·dk2·lt2·accent1~6·hlink·folHlink 순서).
  // 이름을 일일이 세지 않고 순서대로 담는다 — THEME_ORDER가 그 순서를 전제한다.
  const re = /<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>([\s\S]*?)<\/a:\1>/g;
  let m;
  while ((m = re.exec(scheme))) {
    const srgb = m[2].match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/);
    const sys = m[2].match(/<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/);
    out.push(srgb ? srgb[1] : sys ? sys[1] : '000000');
  }
  return out;
}
// tint: 음수면 어둡게, 양수면 밝게(OOXML 규칙 — HSL의 L을 당긴다)
function applyTint(hex, tint) {
  if (!tint) return hex;
  const n = parseInt(hex, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const x = v / 255;
    const y = tint < 0 ? x * (1 + tint) : x * (1 - tint) + tint;
    return Math.round(Math.max(0, Math.min(1, y)) * 255);
  });
  return ch.map(v => v.toString(16).padStart(2, '0')).join('');
}
// 옛 색 지정 방식(`<fgColor indexed="9"/>`). 엑셀 2003 시절의 고정 56색 팔레트이고,
// **지금도 이 방식으로 쓰는 파일이 있다** — 실제로 워크스페이스의 결산안 하나가
// 통째로 indexed였고, 이걸 몰라서 그 파일만 **배경색이 하나도 안 나왔다**(사용자 지적).
// 0~7이 8~15에 그대로 한 번 더 나온다(스펙이 그렇다). 64·65는 자동(시스템) 색이라
// 우리가 정할 값이 아니므로 null로 둔다.
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];
// 파일이 팔레트를 스스로 정해 두면 그것을 쓴다(<indexedColors>는 드물지만 스펙에 있고,
// 실제로 워크스페이스의 결산안이 그렇다 — 그 표가 기본 팔레트와 다른 색을 쓴다).
// **모듈 전역에 두지 않는다** — 파일 두 개를 동시에 열면 서로 덮는다.
function readIndexedPalette(stXml) {
  const block = (stXml.match(/<indexedColors>[\s\S]*?<\/indexedColors>/) || [''])[0];
  const list = [...block.matchAll(/<rgbColor rgb="([0-9A-Fa-f]{6,8})"/g)].map(m => m[1].slice(-6));
  return list.length ? list : INDEXED;
}

// theme = { scheme: [테마색…], indexed: [팔레트…] } — 파일 하나마다 만들어 넘긴다
function colorOf(tag, theme) {
  if (!tag) return null;
  if (attr(tag, 'auto') === '1') return null;            // 시스템 기본색 — 우리 토큰에 맡긴다
  const rgb = attr(tag, 'rgb');
  if (rgb) return `#${rgb.length === 8 ? rgb.slice(2) : rgb}`;   // ARGB → RGB
  const th = attr(tag, 'theme');
  if (th !== null) {
    const idx = THEME_ORDER[Number(th)] ?? Number(th);
    const base = theme?.scheme?.[idx];
    if (base) return `#${applyTint(base, Number(attr(tag, 'tint') || 0))}`;
  }
  const ix = attr(tag, 'indexed');
  if (ix !== null) {
    const hex = (theme?.indexed || INDEXED)[Number(ix)];
    // 64(전경)·65(배경)는 자동이라 팔레트에 없다 — 그때는 null이 맞다
    if (hex) return `#${applyTint(hex, Number(attr(tag, 'tint') || 0))}`;
  }
  return null;
}

// 상대 밝기(sRGB). 화면(SheetView)도 같은 함수를 써야 '종이 판정'과 글자색 판정이
// 두 벌로 갈라지지 않는다.
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
// 작성자가 **뜻을 담아 고른 색**만 남긴다. 검정·흰색은 엑셀의 기본값이라
// 그대로 쓰면 다크 모드에서 검은 테두리·검은 글자가 사라진다 — 그런 건 null로
// 돌려서 화면이 우리 토큰으로 그리게 한다(칠에 쓰는 '종이 판정'과 같은 생각).
export const chromatic = (hex) => {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const l = luminance(hex);
  return (l < 0.06 || l > 0.9) ? null : hex;
};

// 글꼴 한 벌. <font>과 조건부 서식의 <dxf><font>이 같은 모양이라 둘이 같이 쓴다.
// `<b/>`(값 없음)와 `<b val="1"/>` 둘 다 참이고, `val="0"`이면 거짓이다.
const onFlag = (xml, tag) => new RegExp(`<${tag}(\\s*/>|\\s+val="(1|true)")`).test(xml);
function readFont(xml, theme) {
  const src = xml || '';
  return {
    bold: onFlag(src, 'b'),
    italic: onFlag(src, 'i'),
    strike: onFlag(src, 'strike'),
    under: /<u(\s*\/>|\s+val="(?!none))/.test(src),
    color: colorOf((src.match(/<color[^>]*\/?>/) || [null])[0], theme),
  };
}

// ── 테두리 ──────────────────────────────────────────────────────────────────
// 굵기와 모양만 옮긴다. 색은 chromatic()을 지나서, 기본 검정이면 우리 선 색이 된다.
const BORDER_W = {
  hair: 1, thin: 1, dashed: 1, dotted: 1, dashDot: 1, dashDotDot: 1,
  medium: 2, mediumDashed: 2, mediumDashDot: 2, mediumDashDotDot: 2, slantDashDot: 2,
  thick: 3, double: 3,
};
const BORDER_S = {
  double: 'double', dotted: 'dotted', hair: 'dotted',
  dashed: 'dashed', mediumDashed: 'dashed', dashDot: 'dashed', dashDotDot: 'dashed',
  mediumDashDot: 'dashed', mediumDashDotDot: 'dashed', slantDashDot: 'dashed',
};
function sideOf(borderXml, name, theme) {
  const blk = [...blocks(borderXml, name)][0];
  if (!blk) return null;
  const st = attrs(blk.open).style;
  if (!st || st === 'none') return null;
  const tag = (blk.inner.match(/<color[^>]*\/?>/) || [null])[0];
  return { w: BORDER_W[st] || 1, s: BORDER_S[st] || 'solid', c: chromatic(colorOf(tag, theme)) };
}

// ── 숫자 형식 ────────────────────────────────────────────────────────────────
// ponytail: 전체 numFmt 엔진을 만들지 않는다. 실제로 쓰이는 것은 날짜·천단위·
// 퍼센트·소수 자릿수 넷이다. 모르는 형식은 값을 그대로 보여준다 —
// 틀린 형식으로 보여주는 것보다 안 꾸민 값이 낫다.
const BUILTIN = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  9: '0%', 10: '0.00%', 11: '0.00E+00',
  14: 'yyyy-mm-dd', 15: 'yyyy-mm-dd', 16: 'mm-dd', 17: 'yyyy-mm', 18: 'h:mm', 19: 'h:mm:ss',
  20: 'h:mm', 21: 'h:mm:ss', 22: 'yyyy-mm-dd h:mm',
  37: '#,##0', 38: '#,##0', 39: '#,##0.00', 40: '#,##0.00',
  45: 'h:mm', 46: 'h:mm:ss', 47: 'yyyy-mm-dd h:mm', 48: '0.0E+0', 49: '@',
};
// 따옴표 밖의 서식 문자만 본다("년"처럼 따옴표 안에 든 글자를 형식으로 읽지 않게)
const bare = (code) => code.replace(/"[^"]*"/g, '').replace(/\\./g, '');
const isDateFmt = (code) => /[ymdhs]/.test(bare(code).toLowerCase()) && !/[#?]/.test(bare(code));

// 엑셀 날짜 일련번호 → ISO. 1900 윤년 버그(60번이 존재하지 않는 1900-02-29)를 반영한다.
function serialToDate(n) {
  const days = Math.floor(n) - (n > 59 ? 25569 : 25568);
  const ms = Math.round((n - Math.floor(n)) * 86400) * 1000;
  return new Date(days * 86400000 + ms);
}
const pad = (v) => String(v).padStart(2, '0');
function formatNumber(raw, code) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  if (!code || code === 'General') return String(raw);
  if (isDateFmt(code)) {
    const d = serialToDate(n);
    if (Number.isNaN(d.getTime())) return String(raw);
    const b = bare(code).toLowerCase();
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    if (!/[yd]/.test(b)) return time;
    return /h/.test(b) ? `${date} ${time}` : date;
  }
  const pct = code.includes('%');
  const val = pct ? n * 100 : n;
  const dm = bare(code).match(/\.(0+)/);
  const digits = dm ? dm[1].length : 0;
  let s = Math.abs(val).toFixed(digits);
  if (code.includes('#,##') || code.includes('#,#')) {
    const [i, f] = s.split('.');
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
  }
  return `${val < 0 ? '-' : ''}${s}${pct ? '%' : ''}`;
}

// ── 셀 주소 ─────────────────────────────────────────────────────────────────
export function colToNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export const refToRC = (ref) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { c: colToNum(m[1]), r: Number(m[2]) } : null;
};

// 엑셀 열 너비(글자 수) → px. 기본 글꼴에서 한 글자가 대략 7px이고 여백이 5px이다.
export const widthToPx = (w) => Math.round(w * 7 + 5);

// ── 조건부 서식 ──────────────────────────────────────────────────────────────
// 규칙을 **파서에서 미리 적용**해서 화면에는 이미 칠해진 셀만 넘긴다. 색눈금·중복처럼
// 범위 전체를 봐야 하는 규칙이 있어서, 값을 다 들고 있는 이쪽이 제자리다.
//
// ponytail: 수식 규칙(type="expression")과 아이콘 집합은 **적용하지 않는다.** 앞의 것은
// 엑셀 수식 엔진이 필요하고(=우리가 만들 것이 아니다), 뒤의 것은 아이콘 세트를 통째로
// 들여야 한다. 못 하는 규칙은 조용히 건너뛴다 — 틀린 색을 칠하는 것보다 안 칠하는 쪽이 낫다.
const cmp = {
  greaterThan: (v, a) => v > a,
  lessThan: (v, a) => v < a,
  greaterThanOrEqual: (v, a) => v >= a,
  lessThanOrEqual: (v, a) => v <= a,
  equal: (v, a) => v === a,
  notEqual: (v, a) => v !== a,
  between: (v, a, b) => v >= Math.min(a, b) && v <= Math.max(a, b),
  notBetween: (v, a, b) => v < Math.min(a, b) || v > Math.max(a, b),
};
// "C4:C30 E4:E30" → [{r1,c1,r2,c2}, …]
function parseSqref(s) {
  const out = [];
  for (const part of String(s || '').trim().split(/\s+/)) {
    if (!part) continue;
    const [a, b] = part.split(':');
    const p = refToRC(a), q = refToRC(b || a);
    if (p && q) out.push({ r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) });
  }
  return out;
}
const numOf = (cell) => (cell && cell.n !== undefined && cell.n !== null ? cell.n : null);
// cfvo(기준점) → 실제 숫자. min·max·percent·percentile·num을 안다.
function cfvoValue(v, nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const t = v.type;
  if (t === 'min') return lo;
  if (t === 'max') return hi;
  const val = Number(v.val);
  if (t === 'percent') return lo + (hi - lo) * (val / 100);
  if (t === 'percentile') {
    const i = (sorted.length - 1) * (val / 100);
    const f = Math.floor(i);
    return sorted[f] + (sorted[Math.min(f + 1, sorted.length - 1)] - sorted[f]) * (i - f);
  }
  return Number.isFinite(val) ? val : lo;
}
const mixHex = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = [16, 8, 0].map(sh => Math.round((((pa >> sh) & 255) * (1 - t)) + (((pb >> sh) & 255) * t)));
  return `#${ch.map(x => x.toString(16).padStart(2, '0')).join('')}`;
};

function readCfRules(xml, theme) {
  const out = [];
  for (const { open, inner } of blocks(xml, 'conditionalFormatting')) {
    const ranges = parseSqref(attrs(open).sqref);
    if (!ranges.length) continue;
    for (const r of blocks(inner, 'cfRule')) {
      const a = attrs(r.open);
      const formulas = [...blocks(r.inner, 'formula')].map(f => unesc(f.inner));
      const cfvo = [...blocks(r.inner, 'cfvo')].map(c => attrs(c.open));
      const iset = attrs((r.inner.match(/<iconSet[^>]*\/?>/) || [''])[0]);
      const colors = [...r.inner.matchAll(/<color[^>]*\/?>/g)].map(m => colorOf(m[0], theme)).filter(Boolean);
      out.push({
        ranges,
        type: a.type, op: a.operator, text: a.text,
        dxfId: a.dxfId !== undefined ? Number(a.dxfId) : null,
        priority: Number(a.priority || 9999),
        stopIfTrue: a.stopIfTrue === '1',
        rank: Number(a.rank || 10), percent: a.percent === '1', bottom: a.bottom === '1',
        aboveAverage: a.aboveAverage !== '0', equalAverage: a.equalAverage === '1',
        formulas, cfvo, colors,
        iconSet: iset.iconSet || '3TrafficLights1',
        showValue: iset.showValue !== '0',
        reverse: iset.reverse === '1',
      });
    }
  }
  return out.sort((x, y) => x.priority - y.priority);
}

// grid: Map(r → Map(c → cell)). 규칙이 맞는 칸의 bg·fg·bold·bar를 채운다.
function applyCf(grid, rules, dxfs) {
  for (const rule of rules) {
    // 이 규칙이 덮는 칸을 한 번 모은다 — 범위 전체를 봐야 하는 규칙이 있다
    const spots = [];
    for (const rg of rule.ranges) {
      for (let r = rg.r1; r <= rg.r2; r++) {
        const row = grid.get(r);
        if (!row) continue;
        for (let c = rg.c1; c <= rg.c2; c++) {
          const cell = row.get(c);
          if (cell) spots.push({ cell, r, c });
        }
      }
    }
    if (!spots.length) continue;
    const cells = spots.map(s => s.cell);
    const nums = cells.map(numOf).filter(n => n !== null);
    const dxf = rule.dxfId !== null ? dxfs[rule.dxfId] : null;

    // 색눈금 · 데이터 막대는 dxf가 아니라 자기 색을 쓴다
    if (rule.type === 'colorScale' && rule.colors.length >= 2 && nums.length) {
      const stops = rule.cfvo.map(v => cfvoValue(v, nums));
      for (const cell of cells) {
        const n = numOf(cell);
        if (n === null) continue;
        cell.bg = scaleColor(n, stops, rule.colors);
        cell.cf = true;
      }
      continue;
    }
    if (rule.type === 'dataBar' && rule.colors.length && nums.length) {
      const [lo, hi] = [cfvoValue(rule.cfvo[0] || { type: 'min' }, nums), cfvoValue(rule.cfvo[1] || { type: 'max' }, nums)];
      for (const cell of cells) {
        const n = numOf(cell);
        if (n === null || hi === lo) continue;
        cell.bar = { ratio: Math.max(0, Math.min(1, (n - lo) / (hi - lo))), color: rule.colors[0] };
      }
      continue;
    }
    // 아이콘 집합 — 값이 어느 구간에 드는지만 정하고, 무엇을 그릴지는 화면이 정한다
    // (엑셀의 초록/노랑/빨강을 그대로 쓰지 않고 우리 태그 색을 쓴다 — 다크 모드 때문).
    if (rule.type === 'iconSet' && nums.length) {
      const n = Number(String(rule.iconSet)[0]) || 3;
      const stops = rule.cfvo.slice(0, n).map(v => cfvoValue(v, nums));
      const gte = rule.cfvo.map(v => v.gte !== '0');
      for (const { cell } of spots) {
        const v = numOf(cell);
        if (v === null) continue;
        let idx = 0;
        for (let i = 0; i < stops.length; i++) if (gte[i] ? v >= stops[i] : v > stops[i]) idx = i;
        cell.icon = { set: rule.iconSet, idx: rule.reverse ? (n - 1 - idx) : idx, n, showValue: rule.showValue };
      }
      continue;
    }

    // 수식 규칙 — 규칙은 **범위의 왼쪽 위 칸 기준**으로 적혀 있고, 상대 참조는 칸마다
    // 옮겨서 본다($가 붙은 쪽은 고정). 못 읽는 수식은 compile이 null이라 그냥 넘어간다.
    if (rule.type === 'expression') {
      const ast = compile(rule.formulas[0]);
      if (!ast || !dxf) continue;
      const anchor = rule.ranges[0];
      const bounds = gridBounds(grid);
      const get = (r, c) => {
        const cell = grid.get(r)?.get(c);
        if (!cell) return BLANK;
        if (cell.n !== null && cell.n !== undefined) return cell.n;
        return cell.v === '' ? BLANK : cell.v;
      };
      for (const { cell, r, c } of spots) {
        if (cell.cfDone) continue;
        const ok = evalRule(ast, { get, bounds, here: { r, c }, dr: r - anchor.r1, dc: c - anchor.c1 });
        if (!ok) continue;
        paintDxf(cell, dxf);
        if (rule.stopIfTrue) cell.cfDone = true;
      }
      continue;
    }

    if (!dxf) continue;   // 나머지 규칙은 dxf가 있어야 칠할 것이 있다

    const seen = new Map();
    if (rule.type === 'duplicateValues' || rule.type === 'uniqueValues') {
      for (const cell of cells) seen.set(cell.v, (seen.get(cell.v) || 0) + 1);
    }
    const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    let cutoff = null;
    if (rule.type === 'top10' && nums.length) {
      const sorted = [...nums].sort((a, b) => (rule.bottom ? a - b : b - a));
      const k = Math.max(1, Math.min(sorted.length, rule.percent ? Math.ceil(sorted.length * rule.rank / 100) : rule.rank));
      cutoff = sorted[k - 1];
    }

    for (const cell of cells) {
      if (cell.cfDone) continue;                 // 앞선(우선순위 높은) 규칙이 이미 칠했다
      if (matches(rule, cell, { seen, avg, cutoff })) {
        paintDxf(cell, dxf);
        if (rule.stopIfTrue) cell.cfDone = true;
      }
    }
  }
  // 화면에 안 쓰는 표시는 걷어낸다
  for (const row of grid.values()) for (const cell of row.values()) delete cell.cfDone;
}

function paintDxf(cell, dxf) {
  if (dxf.bg) cell.bg = dxf.bg;
  if (dxf.fg) cell.fg = dxf.fg;
  if (dxf.bold) cell.bold = true;
  if (dxf.italic) cell.italic = true;
  if (dxf.strike) cell.strike = true;
  cell.cf = true;
}

// 열 전체 참조($A:$A)를 자를 실제 범위
function gridBounds(grid) {
  let r1 = Infinity, r2 = 0, c1 = Infinity, c2 = 0;
  for (const [r, row] of grid) {
    if (r < r1) r1 = r;
    if (r > r2) r2 = r;
    for (const c of row.keys()) { if (c < c1) c1 = c; if (c > c2) c2 = c; }
  }
  return Number.isFinite(r1) ? { r1, r2, c1, c2 } : { r1: 1, r2: 1, c1: 1, c2: 1 };
}

function scaleColor(n, stops, colors) {
  if (stops.length >= 3 && colors.length >= 3) {
    const [lo, mid, hi] = stops;
    return n <= mid
      ? mixHex(colors[0], colors[1], mid === lo ? 0 : (n - lo) / (mid - lo))
      : mixHex(colors[1], colors[2], hi === mid ? 0 : (n - mid) / (hi - mid));
  }
  const [lo, hi] = stops;
  return mixHex(colors[0], colors[1], hi === lo ? 0 : Math.max(0, Math.min(1, (n - lo) / (hi - lo))));
}

function matches(rule, cell, ctx) {
  const s = String(cell.v ?? '');
  const n = numOf(cell);
  switch (rule.type) {
    case 'cellIs': {
      const f = rule.formulas.map(x => x.replace(/^"|"$/g, ''));
      const asNum = f.map(Number);
      if (n !== null && asNum.every(Number.isFinite)) return cmp[rule.op]?.(n, ...asNum) ?? false;
      return cmp[rule.op]?.(s, ...f) ?? false;
    }
    case 'containsText': return s.includes(rule.text ?? '');
    case 'notContainsText': return !s.includes(rule.text ?? '');
    case 'beginsWith': return s.startsWith(rule.text ?? '');
    case 'endsWith': return s.endsWith(rule.text ?? '');
    case 'containsBlanks': return s.trim() === '';
    case 'notContainsBlanks': return s.trim() !== '';
    case 'containsErrors': return /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!)$/.test(s);
    case 'duplicateValues': return (ctx.seen.get(cell.v) || 0) > 1;
    case 'uniqueValues': return (ctx.seen.get(cell.v) || 0) === 1;
    case 'aboveAverage':
      if (n === null) return false;
      return rule.aboveAverage
        ? (rule.equalAverage ? n >= ctx.avg : n > ctx.avg)
        : (rule.equalAverage ? n <= ctx.avg : n < ctx.avg);
    case 'top10':
      if (n === null || ctx.cutoff === null) return false;
      return rule.bottom ? n <= ctx.cutoff : n >= ctx.cutoff;
    default:
      return false;   // expression · iconSet · timePeriod 등은 건너뛴다
  }
}

// ── 본체 ────────────────────────────────────────────────────────────────────
// 돌려주는 모양:
//   { sheets: [{ name, cols:[px|null], merges:[{r,c,rs,cs}], rows:[[cell|null]], truncated }] }
//   cell = { v: '보여줄 글자', num: bool, bold: bool, align, bg: '#rrggbb'|null }
// bg는 **작성자가 직접 칠한 경우에만** 채운다 — 안 칠한 칸은 화면이 우리 토큰으로
// 그린다(다크 모드가 따라가야 하므로). 자세한 이유는 SheetView 주석에.
export const MAX_ROWS = 500;      // 이 이상은 그리지 않고 잘렸다고 알린다
export const MAX_COLS = 60;

export async function parseXlsx(buf) {
  const entries = zipEntries(buf);
  const [wbXml, ssXml, stXml, thXml, relXml] = await Promise.all([
    readEntry(entries, 'xl/workbook.xml'),
    readEntry(entries, 'xl/sharedStrings.xml'),
    readEntry(entries, 'xl/styles.xml'),
    readEntry(entries, 'xl/theme/theme1.xml'),
    readEntry(entries, 'xl/_rels/workbook.xml.rels'),
  ]);

  // 공유 문자열. <rPh>(한글·일본어 음차 덧말)는 걷어낸다 — 안 걷으면 "노준석노준석"처럼
  // 같은 말이 두 번 붙는다. 서식 있는 글자는 <r><t>가 여럿이라 이어 붙인다.
  const shared = [];
  for (const { inner } of blocks(ssXml, 'si')) {
    const body = inner.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    shared.push(unesc([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')));
  }

  // 색을 푸는 데 필요한 것 두 벌 — 테마색과 옛 방식(indexed) 팔레트.
  // 파일마다 만들어 넘긴다(전역에 두면 동시에 두 파일을 열 때 서로 덮는다).
  const theme = { scheme: themeColors(thXml), indexed: readIndexedPalette(stXml) };

  // 스타일: numFmt · font(굵게) · fill(배경) 을 cellXfs 인덱스로 모은다
  const numFmts = { ...BUILTIN };
  for (const { open } of blocks(stXml, 'numFmt')) {
    numFmts[Number(attr(open, 'numFmtId'))] = unesc(attr(open, 'formatCode') || '');
  }
  const fontsXml = (stXml.match(/<fonts[\s\S]*?<\/fonts>/) || [''])[0];
  const fonts = [...blocks(fontsXml, 'font')].map(({ inner }) => readFont(inner, theme));
  const fillsXml = (stXml.match(/<fills[\s\S]*?<\/fills>/) || [''])[0];
  const fills = [...blocks(fillsXml, 'fill')].map(({ inner }) => {
    // solid가 아닌 무늬(none·gray125)는 "칠하지 않음"으로 본다
    if (!/patternType="solid"/.test(inner)) return null;
    const fg = (inner.match(/<fgColor[^>]*>/) || [null])[0];
    return colorOf(fg, theme);
  });
  const bordersXml = (stXml.match(/<borders[\s\S]*?<\/borders>/) || [''])[0];
  const borders = [...blocks(bordersXml, 'border')].map(({ inner }) => {
    const bd = { t: sideOf(inner, 'top', theme), r: sideOf(inner, 'right', theme),
      b: sideOf(inner, 'bottom', theme), l: sideOf(inner, 'left', theme) };
    return (bd.t || bd.r || bd.b || bd.l) ? bd : null;
  });

  // 조건부 서식이 쓰는 서식 조각. **칠 색이 fgColor가 아니라 bgColor에 있다** —
  // 보통 셀 칠과 반대라 여기서 한 번 걸린다.
  const dxfsXml = (stXml.match(/<dxfs[\s\S]*?<\/dxfs>/) || [''])[0];
  const dxfs = [...blocks(dxfsXml, 'dxf')].map(({ inner }) => {
    const f = readFont((inner.match(/<font[\s\S]*?<\/font>/) || [''])[0], theme);
    const fillXml = (inner.match(/<fill[\s\S]*?<\/fill>/) || [''])[0];
    const tag = (fillXml.match(/<bgColor[^>]*\/?>/) || fillXml.match(/<fgColor[^>]*\/?>/) || [null])[0];
    return { bg: colorOf(tag, theme), fg: f.color, bold: f.bold, italic: f.italic, strike: f.strike };
  });

  const xfsXml = (stXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
  const xfs = [...blocks(xfsXml, 'xf')].map(({ open, inner }) => {
    const a = attrs(open);
    const f = fonts[Number(a.fontId || 0)] || {};
    const al = attrs(inner.match(/<alignment[^>]*\/?>/)?.[0] || '');
    return {
      fmt: numFmts[Number(a.numFmtId || 0)] ?? 'General',
      bold: !!f.bold, italic: !!f.italic, strike: !!f.strike, under: !!f.under,
      fg: f.color || null,
      // applyFill이 없어도 fillId가 가리키는 칠이 있으면 엑셀은 칠해서 보여준다
      bg: fills[Number(a.fillId || 0)] || null,
      bd: borders[Number(a.borderId || 0)] || null,
      align: al.horizontal || null,
      valign: al.vertical || null,
      wrap: al.wrapText === '1',
    };
  });

  // 시트 이름 ↔ 파일 경로. r:id로 rels를 거쳐야 순서가 어긋나지 않는다.
  const relPath = {};
  for (const { open } of blocks(relXml, 'Relationship')) {
    const t = attr(open, 'Target') || '';
    relPath[attr(open, 'Id')] = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
  }
  const sheetDefs = [...blocks(wbXml, 'sheet')].map(({ open }) => ({
    name: unesc(attr(open, 'name') || ''),
    path: relPath[attr(open, 'r:id') || attr(open, 'id')],
    hidden: (attr(open, 'state') || '') !== '',
  })).filter(s => s.path && !s.hidden);

  const sheets = [];
  for (const def of sheetDefs) {
    sheets.push(readSheet(await readEntry(entries, def.path), def.name, shared, xfs, dxfs, theme));
  }
  return { sheets };
}

function readSheet(xml, name, shared, xfs, dxfs = [], theme = []) {
  // 열 너비·숨김. min~max가 구간이라 펼쳐서 담는다.
  const cols = [];
  const hiddenCols = new Set();
  for (const { open } of blocks(xml, 'col')) {
    const from = Number(attr(open, 'min') || 1);
    const to = Math.min(Number(attr(open, 'max') || from), MAX_COLS);
    const w = Number(attr(open, 'width') || 0);
    for (let c = from; c <= to; c++) {
      if (attr(open, 'hidden') === '1' || w === 0) hiddenCols.add(c);
      else cols[c - 1] = widthToPx(w);
    }
  }

  const merges = [];
  for (const { open } of blocks(xml, 'mergeCell')) {
    const [a, b] = (attr(open, 'ref') || '').split(':');
    const p = refToRC(a), q = refToRC(b);
    if (p && q) merges.push({ r: p.r, c: p.c, rs: q.r - p.r + 1, cs: q.c - p.c + 1 });
  }

  const data = (xml.match(/<sheetData[\s\S]*?<\/sheetData>/) || [''])[0];
  const grid = new Map();          // r → Map(c → cell)
  let maxR = 0, maxC = 0;
  for (const { open: rowTag, inner: rowXml } of blocks(data, 'row')) {
    const ra = attrs(rowTag);
    const r = Number(ra.r || 0);
    if (!r || ra.hidden === '1') continue;
    for (const { open: cTag, inner: cXml } of blocks(rowXml, 'c')) {
      const ca = attrs(cTag);
      const rc = refToRC(ca.r || '');
      if (!rc || hiddenCols.has(rc.c) || rc.c > MAX_COLS) continue;
      const st = xfs[Number(ca.s || 0)] || {};
      const t = ca.t;
      const vRaw = (cXml.match(/<v>([\s\S]*?)<\/v>/) || [null, null])[1];
      let v = null;
      let num = false;
      if (t === 'inlineStr') {
        v = unesc([...cXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));
      } else if (vRaw === null) {
        v = null;
      } else if (t === 's') {
        v = shared[Number(vRaw)] ?? '';
      } else if (t === 'str') {
        v = unesc(vRaw);                       // 수식이 돌려준 글자
      } else if (t === 'b') {
        v = vRaw === '1' ? 'TRUE' : 'FALSE';
      } else if (t === 'e') {
        v = unesc(vRaw);                       // #DIV/0! 같은 오류는 그대로 보여준다
      } else {
        v = formatNumber(vRaw, st.fmt);
        num = true;
      }
      // 조건부 서식이 크기를 비교하려면 꾸미기 전 숫자가 필요하다
      const n = num && Number.isFinite(Number(vRaw)) ? Number(vRaw) : null;
      // 값도 없고 칠하지도 않은 칸은 담지 않는다(빈 칸까지 담으면 표가 헛돈다).
      // 순백으로만 칠한 빈 칸도 버린다 — 엑셀 서식은 쓰지도 않는 넓은 구역을
      // 통째로 흰색으로 칠해 두는 일이 흔하고, 그걸 담으면 표 오른쪽에 빈 격자가
      // 수십 칸 딸려 나온다(실물 명단이 그랬다).
      // 테두리만 있고 값이 없는 칸도 버린다 — 표 밖의 장식용 테두리가 격자를 늘린다
      if ((v === null || v === '') && (!st.bg || st.bg.toUpperCase() === '#FFFFFF')) continue;
      if (!grid.has(r)) grid.set(r, new Map());
      grid.get(r).set(rc.c, {
        v: v ?? '', n, num,
        bold: !!st.bold, italic: !!st.italic, strike: !!st.strike, under: !!st.under,
        align: st.align || null, valign: st.valign || null, wrap: !!st.wrap,
        bg: st.bg || null, fg: chromatic(st.fg), bd: st.bd || null,
      });
      if (r > maxR) maxR = r;
      if (rc.c > maxC) maxC = rc.c;
    }
  }

  // 조건부 서식은 여백을 걷어내기 **전에** 적용한다 — sqref가 원본 좌표계다
  const cfRules = readCfRules(xml, theme);
  if (cfRules.length) applyCf(grid, cfRules, dxfs);

  // 위·왼쪽의 빈 여백은 걷어낸다 — 실제 파일은 B2에서 시작하는 일이 흔하고,
  // 그대로 두면 빈 행·빈 열이 표 앞에 붙는다.
  const rowNums = [...grid.keys()].sort((a, b) => a - b);
  const firstR = rowNums[0] ?? 1;
  let firstC = maxC;
  for (const m of grid.values()) for (const c of m.keys()) if (c < firstC) firstC = c;
  if (!rowNums.length) firstC = 1;

  // 오른쪽 끝의 완전히 빈 열은 걷어낸다 — 값이 있는 마지막 열까지만 그린다
  let lastC = firstC - 1;
  for (const m of grid.values()) for (const c of m.keys()) if (c > lastC) lastC = c;
  maxC = Math.max(lastC, firstC);

  const truncated = maxR - firstR + 1 > MAX_ROWS;
  const lastR = Math.min(maxR, firstR + MAX_ROWS - 1);
  const rows = [];
  for (let r = firstR; r <= lastR; r++) {
    const line = [];
    const m = grid.get(r);
    for (let c = firstC; c <= maxC; c++) line.push(m?.get(c) ?? null);
    rows.push(line);
  }

  return {
    name,
    cols: cols.slice(firstC - 1, maxC),
    // 병합도 같은 만큼 당겨서 표의 좌표계와 맞춘다. 잘려나간 밖의 병합은 버린다.
    merges: merges
      .map(g => ({ ...g, r: g.r - firstR, c: g.c - firstC }))
      .filter(g => g.r >= 0 && g.c >= 0 && g.r < rows.length),
    rows,
    truncated,
  };
}

// ── csv ─────────────────────────────────────────────────────────────────────
// 같은 화면으로 그리려고 시트 하나짜리 같은 모양을 돌려준다.
// 따옴표 안의 쉼표·줄바꿈·두 겹 따옴표("")를 지킨다.
export function parseCsv(text, name = 'CSV') {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const truncated = rows.length > MAX_ROWS;
  const body = rows.slice(0, MAX_ROWS).map((r, ri) => r.slice(0, MAX_COLS)
    .map(v => (v === '' ? null : { v, num: v !== '' && !Number.isNaN(Number(v)), bold: ri === 0, align: null, bg: null })));
  return { sheets: [{ name, cols: [], merges: [], rows: body, truncated }] };
}
