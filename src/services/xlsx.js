// ============================================================================
// xlsx 읽기 — 의존성 없이. zip은 네이티브 DecompressionStream, XML은 평문 스캔.
// ----------------------------------------------------------------------------
// **이 파일은 이제 글자만 뽑는다.** 첨부 내용 검색(services/fileText.js)이 유일한
// 사용처다. 2026-08-30에 화면용 코드를 전부 걷어냈다 — 표를 그리는 것은 구글이고
// (files.preview_file_id · utils.sheetPreviewUrl), 우리가 두 번째 표를 그릴 이유가
// 없어졌다. 걷어낸 것: 색·테두리·조건부 서식(formula.js 통째)·그림·도형·열 너비·
// 행 높이·틀 고정·자동 필터·부분 서식(run)·csv 파서.
//
// 남긴 것과 이유:
// · **숫자 서식**(numFmt) — 검색어는 사람이 보는 모양이다. 46054가 아니라 "2월 1일",
//   16500000이 아니라 "16,500,000"으로 찾는다.
// · **500줄 상한** — 6.4MB(6만 줄)짜리가 3.3초 걸렸다. 발췌는 앞부분이면 충분하다.
// · **숨긴 시트 판정** — state="visible"을 적는 도구가 있어서 "비어 있지 않으면 숨김"으로
//   보면 시트가 한 장도 없는 파일이 된다.
//
// 왜 라이브러리를 안 쓰나: SheetJS 계열은 gzip 수백 KB인데 우리가 쓰는 것은 값뿐이다.
// zip 풀기는 브라우저에 이미 있고(DecompressionStream), xlsx의 XML은 기계가 뱉은
// 납작한 문서라 평문 스캔으로 충분하다.
//
// DOM을 쓰지 않는다 — 순수 함수라 노드에서 그대로 검사한다(tests/sheet.mjs, §2-5).
// ============================================================================

// zip 풀기와 XML 훑기는 docx·pptx와 **같은 기계**다 — services/ooxml.js로 옮겼다.
// 여기서 다시 내보내는 것은 검사(tests/sheet.mjs)가 이 이름으로 들여오기 때문이다.
import { zipEntries, readEntry, unesc, attrs, attr, blocks } from './ooxml.js';
export { attrs, blocks };

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

export const MAX_ROWS = 500;      // 발췌는 앞부분이면 충분하다 — 6만 줄을 읽으면 3.3초다
const MAX_COLS = 60;

export async function parseXlsx(buf) {
  const entries = zipEntries(buf, '엑셀 파일');
  const [wbXml, ssXml, stXml, relXml] = await Promise.all([
    readEntry(entries, 'xl/workbook.xml'),
    readEntry(entries, 'xl/sharedStrings.xml'),
    readEntry(entries, 'xl/styles.xml'),
    readEntry(entries, 'xl/_rels/workbook.xml.rels'),
  ]);

  // 공유 문자열. <rPh>(한글·일본어 음차 덧말)는 걷어낸다 — 안 걷으면 "노준석노준석"처럼
  // 같은 말이 두 번 붙는다. 서식 있는 글자(<r><rPr>…<t>)는 이어 붙인 전체만 쓴다.
  const shared = [];
  for (const { inner } of blocks(ssXml, 'si')) {
    const body = inner.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    shared.push(unesc([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')));
  }

  // 스타일에서 **숫자 서식만** 꺼낸다 — 글꼴·칠·테두리는 이제 아무도 안 본다
  const numFmts = { ...BUILTIN };
  for (const { open } of blocks(stXml, 'numFmt')) {
    numFmts[Number(attr(open, 'numFmtId'))] = unesc(attr(open, 'formatCode') || '');
  }
  const xfsXml = (stXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
  const xfs = [...blocks(xfsXml, 'xf')].map(({ open }) =>
    numFmts[Number(attrs(open).numFmtId || 0)] ?? 'General');

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
    // 것이 되어 발췌가 통째로 비었다. 숨김을 뜻하는 값은 둘뿐이다.
    hidden: ['hidden', 'veryHidden'].includes(attr(open, 'state') || ''),
  })).filter(s => s.path && !s.hidden);

  const sheets = [];
  for (const def of sheetDefs) {
    sheets.push(readSheet(await readEntry(entries, def.path), def.name, shared, xfs));
  }
  return { sheets };
}

// 시트 하나 → { name, rows }. rows는 `{ text }` 칸의 2차원 배열이고 빈 칸은 null이다
// (fileText.harvest가 `text`만 걷는다). 좌표를 당기거나 열을 맞추지 않는다 —
// 검색에는 "무슨 글자가 들어 있나"만 필요하다.
function readSheet(xml, name, shared, xfs) {
  const data = (xml.match(/<sheetData[\s\S]*?<\/sheetData>/) || [''])[0];
  const rows = [];
  for (const { open: rowTag, inner: rowXml } of blocks(data, 'row')) {
    const ra = attrs(rowTag);
    if (!Number(ra.r || 0) || ra.hidden === '1') continue;
    if (rows.length >= MAX_ROWS) break;
    const row = [];
    for (const { open: cTag, inner: cXml } of blocks(rowXml, 'c')) {
      const ca = attrs(cTag);
      const rc = refToRC(ca.r || '');
      if (!rc || rc.c > MAX_COLS) continue;
      const t = ca.t;
      const vRaw = (cXml.match(/<v>([\s\S]*?)<\/v>/) || [null, null])[1];
      let v = null;
      if (t === 'inlineStr') {
        v = unesc([...cXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));
      } else if (vRaw === null) {
        v = null;
      } else if (t === 's') {
        v = shared[Number(vRaw)] ?? '';
      } else if (t === 'str' || t === 'e') {
        v = unesc(vRaw);                       // 수식이 돌려준 글자 · #DIV/0! 같은 오류
      } else if (t === 'b') {
        v = vRaw === '1' ? 'TRUE' : 'FALSE';
      } else {
        // 사람이 보는 모양으로 — 검색어는 "2월 1일"이지 46054가 아니다
        v = formatNumber(vRaw, xfs[Number(ca.s || 0)] || 'General');
      }
      if (v === null || v === '') continue;
      row[rc.c - 1] = { text: v };
    }
    if (row.length) rows.push([...row].map(c => c ?? null));
  }
  return { name, rows };
}
