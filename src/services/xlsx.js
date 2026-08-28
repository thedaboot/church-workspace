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

// zip 풀기와 XML 훑기는 docx·pptx와 **같은 기계**다 — services/ooxml.js로 옮겼다.
// 여기서 다시 내보내는 것은 검사(tests/sheet.mjs)가 이 이름으로 들여오기 때문이다.
import { zipEntries, readEntry, readBytes, unesc, attrs, attr, blocks, relTargets, relsPathOf, emuToPx, dataUrl } from './ooxml.js';
export { attrs, blocks };

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
    // 글자 크기(pt). 실물 결산안이 8~24pt를 다 쓴다 — 없으면 24pt 제목이 본문 크기로
    // 나와 위계가 사라진다. rPr(부분 서식)도 같은 모양이라 이 함수를 같이 쓴다.
    sz: Number((src.match(/<sz val="([\d.]+)"/) || [])[1]) || null,
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
  // 27~36·50~58은 동아시아 로케일 내장 날짜 서식이다 — 코드가 파일에 안 적히고 ID만
  // 온다. 이 대역이 없으면 **날짜가 46054 같은 생 숫자로** 나온다(실물 결산안의
  // 순지원금 머리행이 그랬다 — numFmtId 58). 로케일별로 조금씩 다른데 한국어 모양으로
  // 통일한다 — 어차피 읽는 사람이 한국어다.
  27: 'yyyy"년" m"월"', 28: 'm"월" d"일"', 29: 'm"월" d"일"', 30: 'yyyy-mm-dd',
  31: 'yyyy"년" m"월" d"일"', 32: 'h:mm', 33: 'h:mm:ss', 34: 'h:mm', 35: 'h:mm:ss',
  36: 'yyyy"년" m"월"',
  37: '#,##0', 38: '#,##0', 39: '#,##0.00', 40: '#,##0.00',
  45: 'h:mm', 46: 'h:mm:ss', 47: 'yyyy-mm-dd h:mm', 48: '0.0E+0', 49: '@',
  50: 'yyyy"년" m"월" d"일"', 51: 'm"월" d"일"', 52: 'yyyy"년" m"월"', 53: 'm"월" d"일"',
  54: 'm"월" d"일"', 55: 'yyyy"년" m"월"', 56: 'm"월" d"일"', 57: 'yyyy"년" m"월"',
  58: 'm"월" d"일"',
};
// 따옴표 밖의 서식 문자만 본다("년"처럼 따옴표 안에 든 글자를 형식으로 읽지 않게).
// [Red]·[$-411] 같은 대괄호 지시자와 _x(자리 띄움)·*x(채움)도 서식 문자가 아니다.
const bare = (code) => code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/[_*]./g, '').replace(/\\./g, '');
const isDateFmt = (code) => /[ymdhs]/.test(bare(code).toLowerCase()) && !/[#?0]/.test(bare(code));

// 엑셀 날짜 일련번호 → ISO. 1900 윤년 버그(60번이 존재하지 않는 1900-02-29)를 반영한다.
function serialToDate(n) {
  const days = Math.floor(n) - (n > 59 ? 25569 : 25568);
  const ms = Math.round((n - Math.floor(n)) * 86400) * 1000;
  return new Date(days * 86400000 + ms);
}
const pad = (v) => String(v).padStart(2, '0');

// 날짜를 서식 코드 모양대로 그린다 — 따옴표 리터럴("년"·"월")을 지키고 yyyy·m·d·
// h·s·요일(ddd/aaa) 토큰을 치환한다. 예전에는 코드 모양을 무시하고 무조건
// yyyy-mm-dd로 그려서 "1월 27일"이 "2026-01-27"이 됐다.
const KDOW = ['일', '월', '화', '수', '목', '금', '토'];
function renderDate(d, code) {
  let out = '';
  let prev = '';                        // m이 분(minute)인지 월(month)인지 가르는 근거
  for (let i = 0; i < code.length; ) {
    const ch = code[i];
    if (ch === '"') { const j = code.indexOf('"', i + 1); out += code.slice(i + 1, j === -1 ? code.length : j); i = j === -1 ? code.length : j + 1; continue; }
    if (ch === '\\') { out += code[i + 1] || ''; i += 2; continue; }
    if (ch === '[') { const j = code.indexOf(']', i); i = j === -1 ? code.length : j + 1; continue; }
    if (ch === '_' || ch === '*') { i += 2; continue; }
    const rest = code.slice(i).toLowerCase();
    const eat = (t, s) => { out += s; prev = t[0]; i += t.length; };
    if (rest.startsWith('yyyy')) { eat('yyyy', String(d.getUTCFullYear())); continue; }
    if (rest.startsWith('yy')) { eat('yy', String(d.getUTCFullYear()).slice(-2)); continue; }
    // dddd/aaaa = 요일 긴 이름, ddd/aaa = 요일. dd/d(날짜)보다 먼저 봐야 한다.
    if (/^(dddd|aaaa)/.test(rest)) { eat('dddd', `${KDOW[d.getUTCDay()]}요일`); continue; }
    if (/^(ddd|aaa)/.test(rest)) { eat('ddd', KDOW[d.getUTCDay()]); continue; }
    if (rest.startsWith('dd')) { eat('dd', pad(d.getUTCDate())); continue; }
    if (rest.startsWith('d')) { eat('d', String(d.getUTCDate())); continue; }
    if (rest.startsWith('hh')) { eat('hh', pad(d.getUTCHours())); continue; }
    if (rest.startsWith('h')) { eat('h', String(d.getUTCHours())); continue; }
    if (rest.startsWith('ss')) { eat('ss', pad(d.getUTCSeconds())); continue; }
    if (rest.startsWith('s')) { eat('s', String(d.getUTCSeconds())); continue; }
    if (rest.startsWith('mm') || rest.startsWith('m')) {
      const two = rest.startsWith('mm');
      // 앞선 토큰이 시(h)면 분이다 — 'h:mm'의 mm은 월이 아니다
      const minute = prev === 'h';
      const v = minute ? d.getUTCMinutes() : d.getUTCMonth() + 1;
      eat(two ? 'mm' : 'm', two ? pad(v) : String(v));
      continue;
    }
    // 리터럴(콜론·공백 등)은 prev를 지우지 않는다 — 지우면 'h:mm'에서 콜론이
    // h를 잊게 해 분이 월로 나온다("13:32"가 "13:02"가 됐다 — Fable 검증 R1)
    out += ch; i += 1;
  }
  return out;
}

// 구간(;) 나누기 — 따옴표 안의 ;는 구분자가 아니다. 엑셀 서식은
// `양수;음수;0;문자` 네 구간까지 갖는다.
function splitSections(code) {
  const parts = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') { q = !q; cur += ch; continue; }
    if (ch === '\\') { cur += ch + (code[i + 1] || ''); i++; continue; }
    if (ch === ';' && !q) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

// 구간 하나에서 따옴표 리터럴을 숫자 앞/뒤로 나눠 걷는다 — `"₩"#,##0`의 ₩,
// `0"명"`의 명. 괄호는 음수 표기(회계식)라 따로 알린다.
function sectionParts(sec) {
  let pre = '', post = '', seenNum = false, parens = false;
  for (let i = 0; i < sec.length; i++) {
    const ch = sec[i];
    if (ch === '"') { const j = sec.indexOf('"', i + 1); const lit = sec.slice(i + 1, j === -1 ? sec.length : j); if (seenNum) post += lit; else pre += lit; i = j === -1 ? sec.length : j; continue; }
    if (ch === '\\') { const lit = sec[i + 1] || ''; if (lit === '(' || lit === ')') { parens = true; } else if (seenNum) post += lit; else pre += lit; i++; continue; }
    if (ch === '[') { const j = sec.indexOf(']', i); i = j === -1 ? sec.length : j; continue; }
    if (ch === '_' || ch === '*') { i++; continue; }
    if (ch === '(' || ch === ')') { parens = true; continue; }
    if (/[0#?]/.test(ch)) seenNum = true;
  }
  return { pre, post, parens };
}

// 값 하나를 서식대로. red는 [Red](음수 빨강)가 걸렸다는 뜻 — 부르는 쪽이 글자색을 정한다.
function formatNumberEx(raw, code) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return { text: String(raw), red: false };
  if (!code || code === 'General') return { text: String(raw), red: false };
  // 구간 고르기: 음수 구간이 있으면 음수는 그쪽(부호는 구간이 정한다), 0 구간이 있으면 0은 그쪽
  const secs = splitSections(code);
  let sec = secs[0];
  let negSection = false;
  if (n < 0 && secs.length >= 2) { sec = secs[1]; negSection = true; }
  else if (n === 0 && secs.length >= 3) sec = secs[2];
  const red = /\[Red\]/i.test(sec);
  if (isDateFmt(sec)) {
    const d = serialToDate(n);
    return { text: Number.isNaN(d.getTime()) ? String(raw) : renderDate(d, sec), red };
  }
  const b = bare(sec);
  const { pre, post, parens } = sectionParts(sec);
  // 숫자 자리가 아예 없는 구간은 리터럴만 보여준다 — 회계식의 0 구간("-")이 이 모양이다.
  // 단 @(텍스트 자리)가 있으면 값을 그 자리에 넣는다 — 숫자 셀에 텍스트 서식('@',
  // 내장 49)이 걸린 경우, 빈 문자열을 돌리면 셀이 통째로 사라진다(Fable 검증 R2).
  if (!/[0#]/.test(b)) return { text: b.includes('@') ? pre + String(raw) + post : pre + post, red };
  const pct = b.includes('%');
  const val = (pct ? n * 100 : n);
  const dm = b.match(/\.(0+)/);
  const digits = dm ? dm[1].length : 0;
  let s = Math.abs(val).toFixed(digits);
  if (b.includes('#,#') || b.includes('0,0')) {
    const [i, f] = s.split('.');
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
  }
  // 부호: 음수 구간을 골랐으면 부호는 구간 표기가 정한다(괄호거나, 아무것도 없거나).
  // 구간이 하나뿐이면 평범하게 -를 붙인다.
  const body = pre + s + (pct ? '%' : '') + post;
  if (val < 0 && !negSection) return { text: `-${body}`, red };
  if (negSection && parens) return { text: `(${body})`, red };
  if (negSection && /-/.test(b)) return { text: `-${body}`, red };
  return { text: body, red };
}
const formatNumber = (raw, code) => formatNumberEx(raw, code).text;

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

// 화면에 **실제로 줄** 열 너비. widthToPx는 엑셀 기준(11pt 글꼴)이라 그대로 쓰면 두 군데서 어긋난다.
//  · 우리 표 글자는 12.5px라 같은 폭에 글자가 덜 들어간다 → 키운 비율만큼 열도 넓힌다.
//    안 넓히면 글자만 키운 대가로 줄바꿈이 늘어 표가 세로로 길어진다.
//  · 우리는 넘치는 글자를 **접는다**(SheetView 주석). 엑셀은 안 접으므로 작성자는 긴 비고를
//    한 줄에 담으려고 열을 화면보다 넓게 벌려 둔다 — 실물 결산안의 '비고'가 744px였다.
//    접는 우리에게 그 폭은 의미가 없고, 표만 가로로 세 화면이 된다. 상한에서 자른다.
//    (열 너비만 자른다. 글자는 그대로 다 보인다 — 줄이 늘어날 뿐이다.)
// ponytail: 상한·글자 크기는 상수 두 개다. 좁다·넓다는 판단이 바뀌면 여기만 고친다.
export const VIEW_FONT_PX = 12.5;
export const COL_MAX_PX = 320;
// 글자 크기(pt) → 화면 px. 엑셀 기본 11pt가 우리 기준 12.5px이므로 그 비율로 옮긴다.
// 8pt 잔글씨(9px)부터 24pt 제목(27px)까지 위계가 살아난다. 상한은 두지 않는다 —
// 실물에서 최대가 24pt고, 그보다 큰 제목이 있다면 그것도 작성자의 뜻이다.
export const szToPx = (pt) => Math.round(pt * (VIEW_FONT_PX / 11));
// 행 높이(pt) → 화면 px. 1pt = 4/3px에 열 너비와 같은 확대 비율을 곱한다(viewColPx의
// 11.5 기준과 동일). 최소 높이로만 쓰므로(내용이 더 크면 행이 알아서 늘어난다) 안전하다.
export const rowHtToPx = (pt) => Math.round(pt * (4 / 3) * (VIEW_FONT_PX / 11.5));
const DEFAULT_COL_PX = widthToPx(8.43);          // 엑셀 기본 열 너비(8.43자) = 64px
export const viewColPx = (px) =>
  Math.min(Math.round((px || DEFAULT_COL_PX) * (VIEW_FONT_PX / 11.5)), COL_MAX_PX);

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

// ── 부분 서식(rich text run) ─────────────────────────────────────────────────
// <si>(공유 문자열)나 <is>(인라인 문자열) 안의 <r> 구간들을 서식과 함께 걷는다.
// 구간마다 색·굵기·크기가 다를 수 있다. 아무 구간에도 눈에 보이는 서식이 없으면
// null을 돌려서 지금까지의 "글자 하나" 경로를 그대로 탄다(대부분의 셀이 이쪽이다).
export function readRuns(body, theme) {
  if (!/<r[ >]/.test(body)) return null;
  const runs = [];
  for (const { inner } of blocks(body, 'r')) {
    const rPr = (inner.match(/<rPr>[\s\S]*?<\/rPr>/) || [''])[0];
    const f = readFont(rPr, theme);
    runs.push({
      t: unesc([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')),
      // 검정·흰색은 기본값이라 버린다(chromatic) — 셀 글자색과 같은 판단.
      color: chromatic(f.color),
      bold: f.bold, italic: f.italic, strike: f.strike, under: f.under,
      szPx: f.sz ? szToPx(f.sz) : null,
    });
  }
  // 서식이 하나도 없으면 구간을 들고 다닐 이유가 없다
  const plain = runs.every(r => !r.color && !r.bold && !r.italic && !r.strike && !r.under && !r.szPx);
  return plain ? null : runs.filter(r => r.t);
}

// ── 시트 위 그림 ─────────────────────────────────────────────────────────────
// <drawing r:id>를 따라 xl/drawings/*.xml → xl/media/*를 읽는다. 전표의 도장·서명
// 스캔이 여기 있다(실물 3.8MB 중 3.6MB가 그림). 좌표는 앵커 셀(왼쪽 위)만 쓴다 —
// 행 높이를 원본대로 다 그리지 않는 이상 픽셀 좌표는 어차피 안 맞으므로,
// "그 자리(셀)에 그림이 있다"를 보여주는 것이 1단계다. 도형(sp)은 건너뛴다.
const IMG_MAX_BYTES = 3_000_000;   // 이보다 큰 그림은 접는다 — data URL로 들면 메모리가 그림의 ~1.4배
async function readDrawings(sheetXml, sheetPath, entries) {
  const rid = attr((sheetXml.match(/<drawing[^>]*\/?>/) || [''])[0] || '', 'r:id');
  if (!rid) return [];
  const baseDir = sheetPath.replace(/\/[^/]+$/, '');
  const sheetRels = relTargets(await readEntry(entries, relsPathOf(sheetPath)), baseDir);
  const drawPath = sheetRels[rid];
  if (!drawPath) return [];
  const dXml = await readEntry(entries, drawPath);
  if (!dXml) return [];
  const dRels = relTargets(await readEntry(entries, relsPathOf(drawPath)), drawPath.replace(/\/[^/]+$/, ''));
  const out = [];
  for (const kind of ['xdr:twoCellAnchor', 'xdr:oneCellAnchor']) {
    for (const { inner } of blocks(dXml, kind)) {
      const from = (inner.match(/<xdr:from>[\s\S]*?<\/xdr:from>/) || [''])[0];
      // xdr 좌표는 0부터 센다 → 우리 격자(1부터)로 옮긴다
      const r = Number((from.match(/<xdr:row>(\d+)<\/xdr:row>/) || [])[1] || 0) + 1;
      const c = Number((from.match(/<xdr:col>(\d+)<\/xdr:col>/) || [])[1] || 0) + 1;
      const embed = (inner.match(/<a:blip[^>]*r:embed="([^"]+)"/) || [])[1];
      if (!embed) continue;                        // 그림 없는 앵커(도형)다
      const media = dRels[embed];
      if (!media) continue;
      const bytes = await readBytes(entries, media);
      if (!bytes || bytes.length > IMG_MAX_BYTES) continue;
      const src = dataUrl(bytes, media);
      if (!src) continue;
      const ext = inner.match(/<(?:a|xdr):ext[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
      // twoCellAnchor에는 크기(ext)가 없는 파일이 있다(실물 전표의 도장 스캔이 0x0으로
      // 왔다) — 그때는 끝 셀(to)을 실어 보내서 화면이 열 너비 합으로 폭을 어림한다.
      const to = (inner.match(/<xdr:to>[\s\S]*?<\/xdr:to>/) || [''])[0];
      const r2 = Number((to.match(/<xdr:row>(\d+)<\/xdr:row>/) || [])[1] ?? -1) + 1;
      const c2 = Number((to.match(/<xdr:col>(\d+)<\/xdr:col>/) || [])[1] ?? -1) + 1;
      out.push({
        r, c, src,
        wPx: ext ? emuToPx(ext[1]) : null, hPx: ext ? emuToPx(ext[2]) : null,
        r2: r2 > r ? r2 : null, c2: c2 > c ? c2 : null,
      });
    }
  }
  return out;
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
  const entries = zipEntries(buf, '엑셀 파일');
  const [wbXml, ssXml, stXml, thXml, relXml] = await Promise.all([
    readEntry(entries, 'xl/workbook.xml'),
    readEntry(entries, 'xl/sharedStrings.xml'),
    readEntry(entries, 'xl/styles.xml'),
    readEntry(entries, 'xl/theme/theme1.xml'),
    readEntry(entries, 'xl/_rels/workbook.xml.rels'),
  ]);

  // 색을 푸는 데 필요한 것 두 벌 — 테마색과 옛 방식(indexed) 팔레트.
  // 파일마다 만들어 넘긴다(전역에 두면 동시에 두 파일을 열 때 서로 덮는다).
  // **공유 문자열보다 먼저** 만든다 — 부분 서식(run)의 색이 이걸 쓴다.
  const theme = { scheme: themeColors(thXml), indexed: readIndexedPalette(stXml) };

  // 공유 문자열. <rPh>(한글·일본어 음차 덧말)는 걷어낸다 — 안 걷으면 "노준석노준석"처럼
  // 같은 말이 두 번 붙는다. 서식 있는 글자(<r><rPr>…<t>)는 이어 붙인 전체 글과 함께
  // **구간(run)별 서식도 남긴다** — 실물 결산안의 '비고'가 한 셀 안에서 찬조 구간만
  // 주황인데, 이어 붙이기만 하면 그 구분이 통째로 사라진다(사용자 지적 2026-08-28).
  const shared = [];
  for (const { inner } of blocks(ssXml, 'si')) {
    const body = inner.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    shared.push({
      text: unesc([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')),
      runs: readRuns(body, theme),
    });
  }

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
      sz: f.sz || null,
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
    // **state가 있다고 숨긴 시트가 아니다.** 엑셀은 보이는 시트에 state를 아예 안 적지만
    // 다른 도구(openpyxl·LibreOffice·구글 스프레드시트 내보내기)는 state="visible"을
    // 적어 넣는다. "비어 있지 않으면 숨김"으로 보면 그런 파일은 시트가 **한 장도 없는**
    // 것이 되어 미리보기가 빈 화면이었다. 숨김을 뜻하는 값은 둘뿐이다.
    hidden: ['hidden', 'veryHidden'].includes(attr(open, 'state') || ''),
  })).filter(s => s.path && !s.hidden);

  const sheets = [];
  for (const def of sheetDefs) {
    const xml = await readEntry(entries, def.path);
    // 그림은 비동기(zip 풀기)라 여기서 미리 읽어 넘긴다 — readSheet는 순수 동기다.
    // 못 읽는 그림(깨진 rels·너무 큰 파일)은 조용히 빠진다. 표가 그림 때문에 죽으면 안 된다.
    let images = [];
    try { images = await readDrawings(xml, def.path, entries); }
    catch (e) { console.warn('[xlsx] 시트 그림을 읽지 못했다:', def.name, e?.message || e); }
    sheets.push(readSheet(xml, def.name, shared, xfs, dxfs, theme, images));
  }
  return { sheets };
}

function readSheet(xml, name, shared, xfs, dxfs = [], theme = [], images = []) {
  // 시트 기본값 — <col>이 없는 열의 너비가 여기 적혀 있다. 실물 결산안이 14.43자
  // (106px)인데 이걸 안 읽으면 전부 공장 기본 8.43자(64px)로 그려져 표 비례가 무너진다.
  const fmtPr = attrs((xml.match(/<sheetFormatPr[^>]*\/?>/) || [''])[0] || '');
  const defColW = Number(fmtPr.defaultColWidth || 0);
  const defaultColPx = defColW ? widthToPx(defColW) : null;

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
  const pending = [];              // 테두리만 있는 빈 칸 — 값 영역 안이면 나중에 살린다
  const bdMap = new Map();         // `r,c` → bd — 병합 테두리 합성용(끝 셀의 선을 앵커로)
  const rowHt = new Map();         // r → 높이(pt) — 제목·간격 행이 납작해지지 않게
  let cutShort = false;            // 500줄에서 끊었나(뒤에 더 있다는 뜻)
  let maxR = 0, maxC = 0;
  for (const { open: rowTag, inner: rowXml } of blocks(data, 'row')) {
    const ra = attrs(rowTag);
    const r = Number(ra.r || 0);
    if (!r || ra.hidden === '1') continue;
    if (ra.ht) rowHt.set(r, Number(ra.ht));
    // **500줄을 채우면 거기서 멈춘다.** 예전에는 시트를 끝까지 읽고 나서 잘랐다 —
    // 어차피 안 그릴 줄까지 칸마다 서식을 붙였다는 뜻이다. 실측(2026-08-28): 6.4MB
    // (6만 줄 × 12열)짜리가 **3.3초**였고 그동안 탭이 멎었다. 멈추면 60ms다.
    if (grid.size >= MAX_ROWS) { cutShort = true; break; }
    for (const { open: cTag, inner: cXml } of blocks(rowXml, 'c')) {
      const ca = attrs(cTag);
      const rc = refToRC(ca.r || '');
      if (!rc || hiddenCols.has(rc.c) || rc.c > MAX_COLS) continue;
      const st = xfs[Number(ca.s || 0)] || {};
      const t = ca.t;
      const vRaw = (cXml.match(/<v>([\s\S]*?)<\/v>/) || [null, null])[1];
      let v = null;
      let num = false;
      let runs = null;
      let fmtRed = false;                      // [Red] — 음수를 빨갛게(서식이 정한 색)
      if (t === 'inlineStr') {
        v = unesc([...cXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));
        runs = readRuns(cXml, theme);
      } else if (vRaw === null) {
        v = null;
      } else if (t === 's') {
        const sh = shared[Number(vRaw)];
        v = sh?.text ?? '';
        runs = sh?.runs || null;
      } else if (t === 'str') {
        v = unesc(vRaw);                       // 수식이 돌려준 글자
      } else if (t === 'b') {
        v = vRaw === '1' ? 'TRUE' : 'FALSE';
      } else if (t === 'e') {
        v = unesc(vRaw);                       // #DIV/0! 같은 오류는 그대로 보여준다
      } else {
        const fx = formatNumberEx(vRaw, st.fmt);
        v = fx.text;
        fmtRed = fx.red;
        num = true;
      }
      // 조건부 서식이 크기를 비교하려면 꾸미기 전 숫자가 필요하다
      const n = num && Number.isFinite(Number(vRaw)) ? Number(vRaw) : null;
      const cell = {
        v: v ?? '', n, num, runs,
        bold: !!st.bold, italic: !!st.italic, strike: !!st.strike, under: !!st.under,
        szPx: st.sz ? szToPx(st.sz) : null,
        align: st.align || null, valign: st.valign || null, wrap: !!st.wrap,
        bg: st.bg || null,
        // 서식의 [Red](음수 빨강)는 글자색 지정이 따로 없을 때만 — 지정색이 이긴다
        fg: chromatic(st.fg) || (fmtRed ? '#C00000' : null),
        bd: st.bd || null,
      };
      if (st.bd) bdMap.set(`${r},${rc.c}`, st.bd);
      // 값도 없고 칠하지도 않은 칸은 바로 담지 않는다(빈 칸까지 담으면 표가 헛돈다).
      // 순백으로만 칠한 빈 칸도 버린다 — 엑셀 서식은 쓰지도 않는 넓은 구역을
      // 통째로 흰색으로 칠해 두는 일이 흔하고, 그걸 담으면 표 오른쪽에 빈 격자가
      // 수십 칸 딸려 나온다(실물 명단이 그랬다).
      // **테두리만 있는 빈 칸은 버리지 않고 옆에 모아 둔다** — 값 영역(경계 상자)
      // 안이면 나중에 살린다. 지출전표 같은 폼은 상자 선 대부분이 빈 칸에 걸려
      // 있어서, 통째로 버리면 폼이 옅은 격자선으로 무너진다(2026-08-29 분석).
      // 값 영역 **밖**의 장식 테두리는 예전대로 버려진다.
      if ((v === null || v === '') && (!st.bg || st.bg.toUpperCase() === '#FFFFFF')) {
        if (st.bd) pending.push({ r, c: rc.c, cell });
        continue;
      }
      if (!grid.has(r)) grid.set(r, new Map());
      grid.get(r).set(rc.c, cell);
      if (r > maxR) maxR = r;
      if (rc.c > maxC) maxC = rc.c;
    }
  }

  // 값·칠 있는 칸의 경계를 **먼저** 잰다 — 이 상자가 "표 안"의 기준이다.
  // 위·왼쪽의 빈 여백은 걷어낸다 — 실제 파일은 B2에서 시작하는 일이 흔하고,
  // 그대로 두면 빈 행·빈 열이 표 앞에 붙는다.
  const rowNums = [...grid.keys()].sort((a, b) => a - b);
  const firstR = rowNums[0] ?? 1;
  let firstC = maxC;
  for (const m of grid.values()) for (const c of m.keys()) if (c < firstC) firstC = c;
  if (!rowNums.length) firstC = 1;
  let lastC = firstC - 1;
  for (const m of grid.values()) for (const c of m.keys()) if (c > lastC) lastC = c;
  maxC = Math.max(lastC, firstC);
  const truncated = cutShort || maxR - firstR + 1 > MAX_ROWS;
  const lastR = Math.min(maxR, firstR + MAX_ROWS - 1);

  // 테두리만 있는 빈 칸을 **경계 상자 안에서만** 살린다 — 전표류 폼의 상자 선.
  // 상자 밖(오른쪽·아래의 장식 테두리)은 예전대로 버린다 — 그게 이 버리기의 원 목적이다.
  for (const p of pending) {
    if (p.r < firstR || p.r > lastR || p.c < firstC || p.c > maxC) continue;
    if (!grid.has(p.r)) grid.set(p.r, new Map());
    if (!grid.get(p.r).has(p.c)) grid.get(p.r).set(p.c, p.cell);
  }

  // 병합 칸의 테두리 합성 — OOXML은 병합 상자의 선을 구성 셀 각각에 나눠 적는다
  // (앵커에 left/top, 오른쪽 끝 셀에 right, 아래 끝 셀에 bottom). 화면은 앵커 셀
  // 하나만 그리므로, 끝 셀들의 선을 앵커로 모아 와야 상자가 닫힌다(실물 지출전표의
  // 병합 53개 중 21개가 이 모양이었다).
  for (const g of merges) {
    const anchor = grid.get(g.r)?.get(g.c);
    if (!anchor) continue;
    const r2 = g.r + g.rs - 1, c2 = g.c + g.cs - 1;
    const bd = { t: anchor.bd?.t || null, r: anchor.bd?.r || null, b: anchor.bd?.b || null, l: anchor.bd?.l || null };
    const scan = (side, cells) => {
      if (bd[side]) return;
      for (const [rr, cc] of cells) {
        const s = bdMap.get(`${rr},${cc}`);
        if (s?.[side]) { bd[side] = s[side]; return; }
      }
    };
    scan('r', Array.from({ length: g.rs }, (_, i) => [g.r + i, c2]));
    scan('b', Array.from({ length: g.cs }, (_, i) => [r2, g.c + i]));
    scan('l', Array.from({ length: g.rs }, (_, i) => [g.r + i, g.c]));
    scan('t', Array.from({ length: g.cs }, (_, i) => [g.r, g.c + i]));
    if (bd.t || bd.r || bd.b || bd.l) anchor.bd = bd;
  }

  // 조건부 서식은 좌표를 당기기 **전에** 적용한다 — sqref가 원본 좌표계다
  const cfRules = readCfRules(xml, theme);
  if (cfRules.length) applyCf(grid, cfRules, dxfs);

  // 화면에 보일 열 목록 — **숨긴 열은 자리도 없앤다.** 예전에는 셀만 버려서 숨긴
  // 열이 기본 너비의 텅 빈 유령 열로 남았다(실물 명단의 J열). 좌표를 여기서 한 번에
  // 당기므로 병합·필터·그림도 같은 매핑을 쓴다.
  const visCols = [];
  const colIdx = new Map();          // 원본 열 번호 → 화면 열 번호(숨긴 열은 다음 보이는 자리)
  for (let c = firstC; c <= maxC; c++) {
    colIdx.set(c, visCols.length);
    if (!hiddenCols.has(c)) visCols.push(c);
  }
  const mapC = (c) => (c < firstC ? 0 : c > maxC ? visCols.length : colIdx.get(c) ?? visCols.length);

  const rows = [];
  const rowPx = [];                  // 행 최소 높이(px) — 내용이 크면 알아서 더 늘어난다
  for (let r = firstR; r <= lastR; r++) {
    const m = grid.get(r);
    rows.push(visCols.map(c => m?.get(c) ?? null));
    rowPx.push(rowHt.has(r) ? rowHtToPx(rowHt.get(r)) : null);
  }

  // 자동 필터 — 조건은 이미 행 hidden으로 반영돼 있으므로(엑셀이 적어 둔다) 여기서는
  // 버튼 자리(머리행 범위)만 알려 준다. 화면은 아이콘만 붙인다 — 문구 없이.
  const afRef = attr((xml.match(/<autoFilter[^>]*>/) || [''])[0] || '', 'ref');
  let filter = null;
  if (afRef) {
    const [a, b] = afRef.split(':');
    const p = refToRC(a), q = refToRC(b || a);
    if (p && q && p.r >= firstR && p.r <= lastR) {
      filter = { r: p.r - firstR, c1: mapC(Math.min(p.c, q.c)), c2: Math.min(mapC(Math.max(p.c, q.c)), visCols.length - 1) };
    }
  }

  return {
    name,
    cols: visCols.map(c => cols[c - 1] ?? null),
    defaultColPx,
    // 병합도 같은 매핑으로 당긴다. 잘려나간 밖의 병합은 버리고, 표 크기를 넘는
    // rs·cs는 자른다 — colSpan이 colgroup을 넘으면 브라우저가 폭 없는 유령 열을
    // 만든다(실물 예산신청서의 제목 병합이 데이터보다 오른쪽까지 걸쳐 있었다).
    merges: merges
      .filter(g => g.r >= firstR && g.r <= lastR && g.c >= firstC && g.c <= maxC)
      .map(g => {
        const r = g.r - firstR, c = mapC(g.c);
        return {
          r, c,
          rs: Math.max(1, Math.min(g.rs, rows.length - r)),
          cs: Math.max(1, Math.min(mapC(g.c + g.cs) - c, visCols.length - c)),
        };
      })
      .filter(g => g.c < visCols.length),
    rows,
    rowPx,
    filter,
    // 그림 — 앵커 셀 좌표를 화면 좌표로. 값 영역을 걷어낸 뒤 표 **밖**에 걸린 그림은
    // 마지막 칸으로 끌어다 붙인다(실물 양육비 시트의 스캔이 표 오른쪽 K열에 떠 있었다).
    // 자리를 잃는 것보다 "그 시트에 이 그림이 있다"가 먼저다.
    images: rows.length ? (images || [])
      .map(im => ({
        ...im,
        r: Math.max(0, Math.min(im.r - firstR, rows.length - 1)),
        c: Math.max(0, Math.min(mapC(im.c), visCols.length - 1)),
        c2: im.c2 ? Math.min(mapC(im.c2), visCols.length) : null,
      })) : [],
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
