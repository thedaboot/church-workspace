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
function colorOf(tag, theme) {
  if (!tag) return null;
  const rgb = attr(tag, 'rgb');
  if (rgb) return `#${rgb.length === 8 ? rgb.slice(2) : rgb}`;   // ARGB → RGB
  const th = attr(tag, 'theme');
  if (th !== null) {
    const idx = THEME_ORDER[Number(th)] ?? Number(th);
    const base = theme[idx];
    if (base) return `#${applyTint(base, Number(attr(tag, 'tint') || 0))}`;
  }
  return null;
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

  const theme = themeColors(thXml);

  // 스타일: numFmt · font(굵게) · fill(배경) 을 cellXfs 인덱스로 모은다
  const numFmts = { ...BUILTIN };
  for (const { open } of blocks(stXml, 'numFmt')) {
    numFmts[Number(attr(open, 'numFmtId'))] = unesc(attr(open, 'formatCode') || '');
  }
  const fontsXml = (stXml.match(/<fonts[\s\S]*?<\/fonts>/) || [''])[0];
  const bolds = [...blocks(fontsXml, 'font')].map(({ inner }) => /<b\s*\/>|<b val="(?:1|true)"/.test(inner));
  const fillsXml = (stXml.match(/<fills[\s\S]*?<\/fills>/) || [''])[0];
  const fills = [...blocks(fillsXml, 'fill')].map(({ inner }) => {
    // solid가 아닌 무늬(none·gray125)는 "칠하지 않음"으로 본다
    if (!/patternType="solid"/.test(inner)) return null;
    const fg = (inner.match(/<fgColor[^>]*>/) || [null])[0];
    return colorOf(fg, theme);
  });
  const xfsXml = (stXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
  const xfs = [...blocks(xfsXml, 'xf')].map(({ open, inner }) => ({
    fmt: numFmts[Number(attr(open, 'numFmtId') || 0)] ?? 'General',
    bold: bolds[Number(attr(open, 'fontId') || 0)] || false,
    // applyFill이 없어도 fillId가 가리키는 칠이 있으면 엑셀은 칠해서 보여준다
    bg: fills[Number(attr(open, 'fillId') || 0)] || null,
    align: attr(inner.match(/<alignment[^>]*>/)?.[0] || '', 'horizontal'),
  }));

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
    sheets.push(readSheet(await readEntry(entries, def.path), def.name, shared, xfs));
  }
  return { sheets };
}

function readSheet(xml, name, shared, xfs) {
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
      // 값도 없고 칠하지도 않은 칸은 담지 않는다(빈 칸까지 담으면 표가 헛돈다).
      // 순백으로만 칠한 빈 칸도 버린다 — 엑셀 서식은 쓰지도 않는 넓은 구역을
      // 통째로 흰색으로 칠해 두는 일이 흔하고, 그걸 담으면 표 오른쪽에 빈 격자가
      // 수십 칸 딸려 나온다(실물 명단이 그랬다).
      if ((v === null || v === '') && (!st.bg || st.bg.toUpperCase() === '#FFFFFF')) continue;
      if (!grid.has(r)) grid.set(r, new Map());
      grid.get(r).set(rc.c, { v: v ?? '', num, bold: !!st.bold, align: st.align || null, bg: st.bg || null });
      if (r > maxR) maxR = r;
      if (rc.c > maxC) maxC = rc.c;
    }
  }

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
