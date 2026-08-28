// ============================================================================
// OOXML 공용 기계 — zip 풀기 + XML 평문 스캔.
// ----------------------------------------------------------------------------
// xlsx·docx·pptx는 전부 같은 포장이다: zip 안에 XML 몇 장. 그래서 zip을 걸어 항목을
// 꺼내는 일과 태그를 훑는 일은 셋이 똑같다 — 원래 xlsx.js 안에만 있던 것을 여기로
// 옮겼다. 세 파서가 각자 복사해 두면 §6-29-c-2 같은 함정을 세 번 고치게 된다.
//
// 의존성을 늘리지 않는다: zip 풀기는 브라우저에 이미 있고(DecompressionStream),
// OOXML의 XML은 기계가 뱉은 납작한 문서라 평문 스캔으로 충분하다.
// DOM을 쓰지 않는다 — 순수 함수라 노드에서 그대로 검사한다(§2-5).
// ============================================================================

const u16 = (d, p) => d[p] | (d[p + 1] << 8);
const u32 = (d, p) => (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24)) >>> 0;

// ── zip ─────────────────────────────────────────────────────────────────────
// 중앙 디렉터리를 걸어 항목을 모은다. 데이터 시작 위치는 **로컬 헤더에서 다시**
// 읽는다 — 중앙 디렉터리와 로컬 헤더의 extra 길이가 다른 경우가 실제로 있다.
export function zipEntries(buf, what = '파일') {
  const d = new Uint8Array(buf);
  let eo = -1;
  for (let i = d.length - 22; i >= Math.max(0, d.length - 65557); i--) {
    if (u32(d, i) === 0x06054b50) { eo = i; break; }
  }
  if (eo < 0) throw new Error(`${what}이 아니에요`);
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

// 항목 하나를 바이트로. 없으면 null.
export async function readBytes(entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  if (e.method === 0) return e.raw;
  // deflate-raw는 브라우저·노드 모두 전역에 있다
  const stream = new Blob([e.raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 항목 하나를 글자로. 없으면 빈 문자열(부르는 쪽이 매번 없는지 확인하지 않게).
export async function readEntry(entries, name) {
  const bytes = await readBytes(entries, name);
  return bytes ? new TextDecoder().decode(bytes) : '';
}

// ── XML 조각 ─────────────────────────────────────────────────────────────────
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export const unesc = (s) => s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, k) => {
  if (k[0] === '#') return String.fromCodePoint(parseInt(k[1] === 'x' ? k.slice(2) : k.slice(1), k[1] === 'x' ? 16 : 10));
  return ENT[k] ?? m;
});

// 여는 태그의 속성을 한 번에 훑어 객체로 만든다.
// 예전에는 이름마다 `new RegExp('\\b'+name+'="…"')`를 만들어 찾았는데, 그 방식이
// **t 속성을 못 찾아서** 공유 문자열이 전부 인덱스 숫자로 나왔다(셀에 '156'처럼
// 보였다). 이름을 문자열로 이어 붙여 정규식을 만드는 길은 이런 식으로 조용히
// 어긋난다 — 한 번 훑어 담는 쪽이 빠르기도 하다.
const ATTR_RE = /([\w:.-]+)="([^"]*)"/g;
export function attrs(tag) {
  const o = {};
  for (const m of tag.matchAll(ATTR_RE)) o[m[1]] = m[2];
  return o;
}
// 한 번만 보는 자리(스타일·시트 목록 등)용 편의 함수. 셀처럼 여러 번 보는 자리는
// attrs()로 한 번에 받아 쓴다 — 셀마다 태그를 다시 훑으면 큰 표에서 값을 치른다.
export const attr = (tag, name) => attrs(tag)[name] ?? null;

// <이름 …>안</이름> 과 <이름 …/> 을 모두 훑는다. 자기 닫는 태그는 안이 빈 문자열.
//
// 함정: 자기 닫는 태그를 정규식의 `(/)?` 그룹으로 잡으려 하면 안 된다. 앞의
// `[^>]*`가 탐욕적이라 **끝 슬래시까지 먹어버려서** 그 그룹이 언제나 비고, 태그가
// "열린 것"으로 판정된다. 그러면 `</c>`를 찾아 **다음 셀을 통째로 안쪽 내용으로
// 삼킨다** — 값이 한 칸 왼쪽으로 밀리고 t="s"를 잃어 공유 문자열이 인덱스 숫자로
// 보였다(셀에 '156'). 닫힌 태그가 아예 없는 곳(<col/>·<mergeCell/>)에서는 우연히
// 맞게 돌아서 더 늦게 드러났다. 문자열 끝을 보는 쪽이 정직하다.
//
// **같은 이름이 안에 또 나오는 경우는 보지 않는다**(표 안의 표 같은 것) — 그건
// topLevel()이 한다. 셀·글꼴처럼 안 겹치는 자리에서만 쓴다.
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

// 여러 이름을 **문서 순서대로**, 그리고 **같은 이름의 중첩을 세면서** 훑는다.
// 워드 본문은 문단(<w:p>)과 표(<w:tbl>)가 섞여 있고 표 안에는 또 문단이 있다.
// blocks()로 각각 훑으면 순서가 무너지고(문단을 다 그린 뒤 표를 그린다) 표 안의
// 문단이 본문에도 한 번 더 나온다. 그래서 이 함수가 따로 있다.
export function* topLevel(xml, names) {
  const open = new RegExp(`<(${names.join('|')})(\\s[^>]*)?/?>`, 'g');
  let m;
  while ((m = open.exec(xml))) {
    const name = m[1];
    if (m[0].endsWith('/>')) { yield { name, open: m[0], inner: '' }; continue; }
    // 같은 이름이 안에서 다시 열리면 그만큼 더 닫아야 한다
    const step = new RegExp(`<${name}(\\s[^>]*)?/?>|</${name}>`, 'g');
    step.lastIndex = open.lastIndex;
    let depth = 1;
    let end = -1;
    let s;
    while ((s = step.exec(xml))) {
      if (s[0].endsWith('/>')) continue;              // 자기 닫는 태그는 깊이가 안 변한다
      depth += s[0][1] === '/' ? -1 : 1;
      if (depth === 0) { end = s.index; break; }
    }
    if (end < 0) { yield { name, open: m[0], inner: '' }; return; }
    yield { name, open: m[0], inner: xml.slice(open.lastIndex, end) };
    open.lastIndex = end + name.length + 3;
  }
}

// ── 관계(rels) ──────────────────────────────────────────────────────────────
// rId → zip 안의 실제 경로.
// Target은 세 모양으로 온다: 절대(/xl/…) · 상대(worksheets/…) · **거슬러 올라가는
// 상대**(../slideLayouts/…). 마지막 것이 파워포인트에서 기본이다.
//
// 처음에는 `/../`를 `/`로 바꾸는 것으로 때웠는데, 그러면 앞 칸을 안 지워서
// ppt/slides/../slideLayouts/x.xml 이 ppt/slides/slideLayouts/x.xml 이 됐다.
// 그 경로에 파일이 없으니 **레이아웃을 통째로 못 찾았고**, 자리 표시자(제목·본문)의
// 좌표를 물려받지 못해 표지 슬라이드가 **도형 0개**로 나왔다(실물 pptx로 확인).
// 칸 단위로 걸어야 한다.
export function resolvePath(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = String(baseDir || '').split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export function relTargets(relXml, baseDir) {
  const out = {};
  for (const { open } of blocks(relXml, 'Relationship')) {
    const t = attr(open, 'Target') || '';
    if (!t || /^https?:/i.test(t)) continue;          // 바깥 링크는 파일이 아니다
    out[attr(open, 'Id')] = resolvePath(baseDir, t);
  }
  return out;
}

// 그 파일의 rels 경로 — word/document.xml → word/_rels/document.xml.rels
export const relsPathOf = (path) => path.replace(/([^/]+)$/, '_rels/$1.rels');

// ── 단위 ────────────────────────────────────────────────────────────────────
// OOXML의 그림·도형 좌표는 EMU다(914400 EMU = 1인치 = 96px).
export const emuToPx = (v) => Math.round((Number(v) || 0) / 914400 * 96);
// 워드의 글자 크기는 half-point, 파워포인트는 1/100 point다.
export const halfPtToPx = (v) => (Number(v) || 0) / 2 * (96 / 72);
export const hundredthPtToPx = (v) => (Number(v) || 0) / 100 * (96 / 72);

// 그림 바이트 → 브라우저가 그릴 수 있는 data URL.
// blob URL이 아니라 data URL을 쓴다 — 미리보기를 닫을 때 되돌려줄 것이 없고,
// 문서 한 장에 그림이 몇 개뿐이라 크기도 문제가 안 된다.
const IMG_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', emf: null, wmf: null,
};
export function dataUrl(bytes, name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  const mime = IMG_MIME[ext];
  if (!mime || !bytes) return null;                   // emf·wmf는 브라우저가 못 그린다
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
}
