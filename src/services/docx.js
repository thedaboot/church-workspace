// ============================================================================
// docx 읽기 — 의존성 없이. zip·XML 기계는 services/ooxml.js가 준다.
// ----------------------------------------------------------------------------
// 왜 직접 읽나: 엑셀과 **같은 이유**다(xlsx.js 머리 주석). 구글 편집기 미리보기는
// 갓 올린 파일에 오류를 뱉어서 파일 나이 30분으로 갈라야 했고, 그 30분이 "올리고
// 바로 열어 보는" 가장 흔한 순간이다. 바이트는 /api/drive-file이 이미 중계하므로
// 우리가 읽으면 기다릴 것이 없고, 라이트·다크도 따라간다.
//
// 가져오는 것: 문단(제목 수준·정렬·들여쓰기) · 글자 서식(굵기·기울임·밑줄·취소선·
//   글자색·크기·형광펜) · 목록(불릿/번호, 수준) · 표(칸 병합·너비·테두리 유무) ·
//   그림(본문 안 그림 · data URL) · 쪽 나눔 · 하이퍼링크.
// 안 가져오는 것: 머리글/바닥글 · 각주 · 도형/글상자 · 단 나눔 · 목차 필드 ·
//   변경 내용 추적 표시(원문 글자는 그대로 나온다).
//
// DOM을 쓰지 않는다 — 순수 함수라 노드에서 그대로 검사한다(tests/office.mjs, §2-5).
// ============================================================================

import {
  zipEntries, readEntry, readBytes, unesc, attr, blocks, topLevel,
  relTargets, relsPathOf, halfPtToPx, emuToPx, dataUrl,
} from './ooxml.js';

const MAX_BLOCKS = 1200;   // 이보다 길면 앞부분만 그린다(엑셀의 500줄과 같은 판단)

// 워드는 켜짐을 <w:b/> 또는 <w:b w:val="1"/>로 적고, **끔**을 w:val="0"으로 적는다.
// 그냥 태그 유무만 보면 "굵게 껐다"가 굵게로 뒤집힌다(스타일에서 물려받은 굵기를
// 문단에서 끄는 문서가 실제로 흔하다).
const onOff = (xml, tag) => {
  const m = new RegExp(`<${tag}(\\s[^>]*)?/?>`).exec(xml);
  if (!m) return false;
  const v = attr(m[0], 'w:val');
  return v === null || v === '1' || v === 'true' || v === 'on';
};

const hexColor = (v) => (v && /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toUpperCase()}` : null);

// 제목 수준. 영어 문서는 'Heading1'/'Heading 1', 한국어 워드는 '제목 1'로 적는다.
// 문서 제목(Title · 한국어로는 그냥 '제목')은 숫자가 없고 가장 큰 제목이다 —
// 숫자를 요구하면 표지 제목이 **본문 문단으로 떨어진다**(실물 docx에서 실제로 그랬다).
// styles.xml까지 따라가지 않는다 — 이름 규칙이 워드가 만드는 모든 문서에서 같다.
export function headingLevel(styleId = '') {
  const id = String(styleId).replace(/\s+/g, ' ').trim();
  if (/^(title|제목)$/i.test(id)) return 1;
  const m = /^(?:heading|제목)\s*([1-9])$/i.exec(id);
  return m ? Number(m[1]) : 0;
}

// 목록은 보통 문단 안에 <w:numPr>로 들어 있지만, 스타일(List Bullet)에만 걸고
// 문단에는 아무것도 안 적는 문서도 있다 — 그러면 목록이 통째로 맨문단이 된다.
export function styleList(styleId = '') {
  const id = String(styleId).replace(/\s+/g, '').toLowerCase();
  if (/^listbullet/.test(id) || id === '목록글머리기호') return 'bullet';
  if (/^listnumber/.test(id) || id === '목록번호') return 'number';
  return null;
}

// 한 <w:r>(글자 묶음) → 우리 조각. 그림이면 { img }, 글자면 { text }.
function runOf(inner, rels, images) {
  const pr = (inner.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
  const drawing = /<a:blip[^>]*r:embed="([^"]+)"/.exec(inner);
  if (drawing) {
    const ext = /<wp:extent[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(inner);
    return {
      img: images.get(rels[drawing[1]]) || null,
      w: ext ? emuToPx(ext[1]) : null,
      h: ext ? emuToPx(ext[2]) : null,
    };
  }
  // <w:t>는 여럿일 수 있고 xml:space="preserve"면 앞뒤 공백이 뜻이 있다.
  // <w:tab/>·<w:br/>도 글자 흐름의 일부라 같이 옮긴다.
  let text = '';
  for (const m of inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br(?:\s[^>]*)?\/>/g)) {
    if (m[0].startsWith('<w:tab')) text += '\t';
    else if (m[0].startsWith('<w:br')) text += '\n';
    else text += unesc(m[1]);
  }
  if (!text) return null;
  const sz = /<w:sz\s+w:val="(\d+)"/.exec(pr);
  const color = /<w:color\s+w:val="([0-9a-fA-F]{6})"/.exec(pr);
  const hl = /<w:highlight\s+w:val="(\w+)"/.exec(pr);
  return {
    text,
    b: onOff(pr, 'w:b'),
    i: onOff(pr, 'w:i'),
    u: /<w:u\s[^>]*w:val="(?!none)/.test(pr),
    strike: onOff(pr, 'w:strike'),
    color: color ? hexColor(color[1]) : null,
    sizePx: sz ? halfPtToPx(sz[1]) : null,
    mark: hl && hl[1] !== 'none' ? hl[1] : null,
  };
}

const ALIGN = { center: 'center', right: 'right', both: 'justify', end: 'right' };

function paragraphOf(inner, rels, images, numbering) {
  const pr = (inner.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  const styleId = attr((/<w:pStyle[^>]*\/?>/.exec(pr) || [''])[0], 'w:val') || '';
  const runs = [];
  // 하이퍼링크 안의 글자도 본문이다 — <w:hyperlink> 껍데기를 벗기고 같이 훑는다.
  for (const { inner: rIn } of blocks(inner.replace(/<\/?w:hyperlink(\s[^>]*)?>/g, ''), 'w:r')) {
    const r = runOf(rIn, rels, images);
    if (r) runs.push(r);
  }
  const numId = attr((/<w:numId[^>]*\/?>/.exec(pr) || [''])[0], 'w:val');
  const ilvl = Number(attr((/<w:ilvl[^>]*\/?>/.exec(pr) || [''])[0], 'w:val') || 0);
  const indentTwips = Number(attr((/<w:ind[^>]*\/?>/.exec(pr) || [''])[0], 'w:left') || 0);
  return {
    t: 'p',
    level: headingLevel(styleId),
    align: ALIGN[attr((/<w:jc[^>]*\/?>/.exec(pr) || [''])[0], 'w:val')] || null,
    // 번호 매기기는 numbering.xml이 불릿인지 숫자인지 안다. 못 찾으면 불릿이다 —
    // 숫자를 못 알아본 목록을 불릿으로 그리는 쪽이, 불릿을 1.2.3으로 그리는 것보다 낫다.
    list: numId
      ? { kind: numbering.get(`${numId}:${ilvl}`) || 'bullet', level: ilvl }
      : (styleList(styleId) ? { kind: styleList(styleId), level: ilvl } : null),
    indent: indentTwips ? Math.round(indentTwips / 1440 * 96) : 0,
    runs,
    // 쪽 나눔은 문단 안에 <w:br w:type="page"/>로 들어 있다
    pageBreak: /<w:br[^>]*w:type="page"/.test(inner),
  };
}

function tableOf(inner, rels, images, numbering) {
  const widths = [];
  for (const { open } of blocks((inner.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/) || [''])[0], 'w:gridCol')) {
    widths.push(Math.round(Number(attr(open, 'w:w') || 0) / 1440 * 96));
  }
  const rows = [];
  for (const { inner: trIn } of topLevel(inner, ['w:tr'])) {
    const cells = [];
    for (const { inner: tcIn } of topLevel(trIn, ['w:tc'])) {
      const tcPr = (tcIn.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [''])[0];
      const span = Number(attr((/<w:gridSpan[^>]*\/?>/.exec(tcPr) || [''])[0], 'w:val') || 1);
      const merge = /<w:vMerge(?![^>]*w:val="restart")/.test(tcPr);
      const shd = /<w:shd[^>]*w:fill="([0-9a-fA-F]{6})"/.exec(tcPr);
      const paras = [];
      for (const { inner: pIn } of topLevel(tcIn, ['w:p'])) paras.push(paragraphOf(pIn, rels, images, numbering));
      cells.push({ span, merged: merge, bg: shd ? hexColor(shd[1]) : null, paras });
    }
    rows.push(cells);
  }
  return { t: 'table', widths, rows };
}

// numId+수준 → 'bullet' | 'number'
async function readNumbering(entries) {
  const map = new Map();
  const xml = await readEntry(entries, 'word/numbering.xml');
  if (!xml) return map;
  const abstractFmt = new Map();          // abstractNumId → { 수준: 종류 }
  for (const { open, inner } of topLevel(xml, ['w:abstractNum'])) {
    const id = attr(open, 'w:abstractNumId');
    const lv = {};
    for (const { open: lvOpen, inner: lvIn } of topLevel(inner, ['w:lvl'])) {
      const fmt = attr((/<w:numFmt[^>]*\/?>/.exec(lvIn) || [''])[0], 'w:val') || '';
      lv[attr(lvOpen, 'w:ilvl') || '0'] = fmt === 'bullet' || fmt === 'none' ? 'bullet' : 'number';
    }
    abstractFmt.set(id, lv);
  }
  for (const { open, inner } of topLevel(xml, ['w:num'])) {
    const numId = attr(open, 'w:numId');
    const aId = attr((/<w:abstractNumId[^>]*\/?>/.exec(inner) || [''])[0], 'w:val');
    const lv = abstractFmt.get(aId) || {};
    for (const k of Object.keys(lv)) map.set(`${numId}:${k}`, lv[k]);
  }
  return map;
}

// 본문 안 그림을 미리 data URL로 만들어 둔다(경로 → data URL).
async function readImages(entries, rels) {
  const out = new Map();
  for (const path of new Set(Object.values(rels))) {
    if (!/^word\/media\//.test(path)) continue;
    const bytes = await readBytes(entries, path);
    const url = dataUrl(bytes, path);
    if (url) out.set(path, url);
  }
  return out;
}

// ── 바깥에서 쓰는 것 ────────────────────────────────────────────────────────
// { blocks: [문단|표], truncated }
export async function parseDocx(buf) {
  const entries = zipEntries(buf, '워드 파일');
  const xml = await readEntry(entries, 'word/document.xml');
  if (!xml) throw new Error('워드 파일에서 본문을 찾지 못했어요');
  const rels = relTargets(await readEntry(entries, relsPathOf('word/document.xml')), 'word');
  const [numbering, images] = await Promise.all([readNumbering(entries), readImages(entries, rels)]);
  const body = (xml.match(/<w:body>[\s\S]*<\/w:body>/) || [xml])[0];

  const out = [];
  let truncated = false;
  // **문단과 표는 문서 순서대로 섞여 있다.** blocks()로 따로 훑으면 순서가 무너지고
  // 표 안의 문단이 본문에 한 번 더 나온다 — topLevel()이 그래서 있다.
  for (const { name, inner } of topLevel(body, ['w:p', 'w:tbl'])) {
    if (out.length >= MAX_BLOCKS) { truncated = true; break; }
    if (name === 'w:tbl') { out.push(tableOf(inner, rels, images, numbering)); continue; }
    const p = paragraphOf(inner, rels, images, numbering);
    // 빈 문단도 남긴다 — 워드에서 줄을 띄운 자리라 지우면 글이 붙어 버린다.
    // 다만 끝에 줄줄이 붙는 빈 문단은 아래에서 걷어낸다.
    out.push(p);
  }
  while (out.length && out[out.length - 1].t === 'p' && !out[out.length - 1].runs.length) out.pop();
  return { blocks: out, truncated };
}
