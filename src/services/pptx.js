// ============================================================================
// pptx 읽기 — 의존성 없이. zip·XML 기계는 services/ooxml.js가 준다.
// ----------------------------------------------------------------------------
// 왜 직접 읽나: 워드·엑셀과 같은 이유다(docx.js 머리 주석). 구글 편집기 미리보기는
// 갓 올린 파일에 오류를 뱉어서 30분을 기다려야 했다.
//
// **슬라이드는 흐르는 글이 아니라 좌표판이다.** 도형마다 EMU 좌표가 박혀 있고,
// 우리는 그것을 슬라이드 크기 대비 **퍼센트**로 바꿔 넘긴다 — 그래야 화면이 어떤
// 폭이든 원본 배치가 그대로 유지된다(px로 넘기면 창을 줄일 때 글자가 겹친다).
//
// 자리 표시자(제목·본문)는 슬라이드에 좌표가 **없는 것이 보통**이고 레이아웃에서
// 물려받는다. 그것을 안 따라가면 제목이 전부 좌상단(0,0)에 겹쳐 쌓인다 — 이 파일
// 코드의 절반이 그 상속을 따라가는 일이다.
//
// 가져오는 것: 슬라이드 크기·순서 · 도형 위치/크기 · 글상자(문단 수준·정렬·굵기·
//   기울임·밑줄·글자 크기·글자색·불릿) · 그림 · 도형 단색 채우기 · 발표자 노트 제외.
// 안 가져오는 것: 애니메이션 · 전환 · 차트 · 스마트아트 · 그라데이션/그림 채우기 ·
//   도형 윤곽선의 점선 모양 · 표(슬라이드 안 표는 글자만 나온다) · 테마 글꼴.
//
// DOM을 쓰지 않는다 — 순수 함수라 노드에서 그대로 검사한다(tests/office.mjs, §2-5).
// ============================================================================

import {
  zipEntries, readEntry, readBytes, unesc, attr, blocks, topLevel,
  relTargets, relsPathOf, hundredthPtToPx, emuToPx, dataUrl,
} from './ooxml.js';

const MAX_SLIDES = 60;     // 이보다 많으면 앞부분만 그린다

const DEFAULT_W = 9144000;        // 4:3 기본값(10인치 × 7.5인치)
const DEFAULT_H = 6858000;

const ALIGN = { ctr: 'center', r: 'right', just: 'justify' };

// <a:xfrm><a:off x y/><a:ext cx cy/> → EMU 그대로. 없으면 null(상속해야 한다는 뜻).
function xfrmOf(xml) {
  const off = /<a:off[^>]*x="(-?\d+)"[^>]*y="(-?\d+)"/.exec(xml);
  const ext = /<a:ext[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(xml);
  if (!off || !ext) return null;
  return { x: +off[1], y: +off[2], w: +ext[1], h: +ext[2] };
}

// 단색 채우기·글자색. 테마 색(<a:schemeClr>)은 테마까지 따라가야 정확한데, 슬라이드
// 배경과 겹치면 안 보이는 색을 칠하게 된다 — **srgbClr만 쓴다.** 나머지는 우리 토큰이
// 정하게 두는 쪽이 다크 모드에서도 안전하다(xlsx.chromatic과 같은 판단).
const srgb = (xml) => {
  const m = /<a:srgbClr[^>]*val="([0-9a-fA-F]{6})"/.exec(xml || '');
  return m ? `#${m[1].toUpperCase()}` : null;
};

// 자리 표시자 열쇠 — 종류 + 번호. 레이아웃에서 같은 열쇠를 찾아 좌표를 물려받는다.
const phKeyOf = (spXml) => {
  const m = /<p:ph([^>]*)\/?>/.exec(spXml);
  if (!m) return null;
  const type = attr(`<p:ph${m[1]}>`, 'type') || 'body';
  const idx = attr(`<p:ph${m[1]}>`, 'idx') || '';
  return `${type}:${idx}`;
};

// 레이아웃(또는 마스터)에서 자리 표시자 좌표를 모은다.
function placeholderBoxes(xml) {
  const map = new Map();
  const tree = (xml.match(/<p:spTree>[\s\S]*<\/p:spTree>/) || [''])[0];
  for (const { inner } of topLevel(tree, ['p:sp'])) {
    const key = phKeyOf(inner);
    const box = xfrmOf((inner.match(/<p:spPr>[\s\S]*?<\/p:spPr>/) || [''])[0]);
    if (key && box && !map.has(key)) map.set(key, box);
  }
  return map;
}

// 점을 붙이는 자리는 **본문 자리 표시자뿐**이다. 제목·부제·그냥 글상자에 점을 찍으면
// 원본에 없던 점이 생긴다(표지 제목에 '· 2026 하계 수련회'가 붙었다 — 실물로 확인).
// 정확히 하려면 레이아웃의 lstStyle까지 봐야 하는데, 자리 종류만 보면 실물이 다 맞는다.
const BULLETED = new Set(['body', 'obj']);

// 글자 크기를 안 적은 문단이 아주 흔하다 — 레이아웃·마스터의 lstStyle에서 물려받기
// 때문이다. 거기까지 따라가는 대신 **자리 종류별 파워포인트 기본값**을 쓴다.
// 안 쓰면 모든 글자가 같은 크기로 나와서 제목과 본문이 구분되지 않는다.
const DEFAULT_PT = { ctrTitle: 44, title: 44, subTitle: 24, body: 18, obj: 18 };

// <a:p> 하나 → 문단. 슬라이드의 글자는 문단마다 수준(lvl)이 있고 그게 곧 들여쓰기다.
function paraOf(inner, bulletDefault, defaultPx) {
  const pPr = (inner.match(/<a:pPr[^>]*\/?>|<a:pPr[^>]*>[\s\S]*?<\/a:pPr>/) || [''])[0];
  const level = Number(attr((/<a:pPr[^>]*>/.exec(pPr) || [''])[0], 'lvl') || 0);
  // 문단이 직접 말하면 그것을 따르고(<a:buNone/>·<a:buChar>·<a:buAutoNum>),
  // 아무 말이 없으면 자리 종류가 정한다.
  const bullet = /<a:buNone\s*\/?>/.test(pPr) ? false
    : /<a:bu(Char|AutoNum)/.test(pPr) ? true
    : bulletDefault;
  const runs = [];
  for (const { inner: rIn } of blocks(inner, 'a:r')) {
    const rPr = (rIn.match(/<a:rPr[^>]*\/?>|<a:rPr[^>]*>[\s\S]*?<\/a:rPr>/) || [''])[0];
    const open = (/<a:rPr[^>]*>/.exec(rPr) || [''])[0];
    let text = '';
    for (const m of rIn.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) text += unesc(m[1]);
    if (!text) continue;
    const sz = attr(open, 'sz');
    runs.push({
      text,
      b: attr(open, 'b') === '1',
      i: attr(open, 'i') === '1',
      u: !!attr(open, 'u') && attr(open, 'u') !== 'none',
      strike: !!attr(open, 'strike') && attr(open, 'strike') !== 'noStrike',
      sizePx: sz ? hundredthPtToPx(sz) : defaultPx,
      color: srgb(rPr),
    });
  }
  // 줄 나눔(<a:br/>)만 있는 문단은 빈 줄이다 — 자리를 지키려고 남긴다
  return { level, bullet, align: ALIGN[attr((/<a:pPr[^>]*>/.exec(pPr) || [''])[0], 'algn')] || null, runs };
}

function textBodyOf(xml, bulletDefault, defaultPx) {
  const body = (xml.match(/<p:txBody>[\s\S]*?<\/p:txBody>/) || [''])[0];
  if (!body) return null;
  const paras = [];
  for (const { inner } of topLevel(body, ['a:p'])) paras.push(paraOf(inner, bulletDefault, defaultPx));
  while (paras.length && !paras[paras.length - 1].runs.length) paras.pop();
  if (!paras.length) return null;
  // 세로 정렬 — 표지 제목이 상자 가운데에 놓이는 문서가 흔하다
  const anchor = attr((/<a:bodyPr[^>]*>/.exec(body) || [''])[0], 'anchor');
  return { paras, anchor: anchor === 'ctr' ? 'center' : anchor === 'b' ? 'end' : 'start' };
}

async function slideOf(entries, path, size) {
  const xml = await readEntry(entries, path);
  if (!xml) return null;
  const rels = relTargets(await readEntry(entries, relsPathOf(path)), path.replace(/\/[^/]+$/, ''));

  // 자리 표시자 좌표는 레이아웃 → 마스터 순으로 물려받는다
  let boxes = new Map();
  const layoutPath = Object.values(rels).find(p => /slideLayouts?\//.test(p));
  if (layoutPath) {
    const layoutXml = await readEntry(entries, layoutPath);
    boxes = placeholderBoxes(layoutXml);
    const lRels = relTargets(await readEntry(entries, relsPathOf(layoutPath)), layoutPath.replace(/\/[^/]+$/, ''));
    const masterPath = Object.values(lRels).find(p => /slideMasters?\//.test(p));
    if (masterPath) {
      for (const [k, v] of placeholderBoxes(await readEntry(entries, masterPath))) {
        if (!boxes.has(k)) boxes.set(k, v);
      }
    }
  }

  const tree = (xml.match(/<p:spTree>[\s\S]*<\/p:spTree>/) || [''])[0];
  const shapes = [];
  for (const { name, inner } of topLevel(tree, ['p:sp', 'p:pic'])) {
    const spPr = (inner.match(/<p:spPr>[\s\S]*?<\/p:spPr>/) || [''])[0];
    const box = xfrmOf(spPr) || boxes.get(phKeyOf(inner)) || null;
    if (!box) continue;                       // 어디에 둘지 모르는 도형은 그리지 않는다
    // EMU → 퍼센트. 화면 폭이 얼마든 원본 배치가 그대로다.
    const pos = {
      x: box.x / size.w * 100, y: box.y / size.h * 100,
      w: box.w / size.w * 100, h: box.h / size.h * 100,
    };
    if (name === 'p:pic') {
      const embed = /<a:blip[^>]*r:embed="([^"]+)"/.exec(inner);
      const img = embed ? rels[embed[1]] : null;
      if (img) shapes.push({ kind: 'img', pos, src: img });
      continue;
    }
    const ph = phKeyOf(inner);
    const phType = ph ? ph.split(':')[0] : '';
    const text = textBodyOf(inner, BULLETED.has(phType), (DEFAULT_PT[phType] || 18) * (96 / 72));
    const fill = srgb((spPr.match(/<a:solidFill>[\s\S]*?<\/a:solidFill>/) || [''])[0]);
    if (!text && !fill) continue;             // 빈 자리 표시자는 건너뛴다
    shapes.push({ kind: 'text', pos, fill, ...(text || { paras: [], anchor: 'start' }) });
  }
  // 뒤에 놓인 것이 위에 그려진다 — 원본 순서를 그대로 쓴다
  return { shapes };
}

// ── 바깥에서 쓰는 것 ────────────────────────────────────────────────────────
// { ratio, wPx, slides: [{ shapes }], images: { 경로: dataUrl }, truncated }
export async function parsePptx(buf) {
  const entries = zipEntries(buf, '파워포인트 파일');
  const xml = await readEntry(entries, 'ppt/presentation.xml');
  if (!xml) throw new Error('파워포인트 파일에서 슬라이드를 찾지 못했어요');
  const sz = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(xml);
  const size = { w: sz ? +sz[1] : DEFAULT_W, h: sz ? +sz[2] : DEFAULT_H };
  const rels = relTargets(await readEntry(entries, relsPathOf('ppt/presentation.xml')), 'ppt');

  // **순서는 sldIdLst가 정한다.** rels를 훑는 순서로 그리면 slide10이 slide2 앞에 온다.
  const order = [...blocks((xml.match(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/) || [''])[0], 'p:sldId')]
    .map(({ open }) => rels[attr(open, 'r:id')])
    .filter(p => p && /slides\//.test(p));
  const truncated = order.length > MAX_SLIDES;

  const slides = [];
  for (const path of order.slice(0, MAX_SLIDES)) {
    const s = await slideOf(entries, path, size);
    if (s) slides.push(s);
  }

  // 슬라이드가 쓰는 그림만 data URL로 만든다
  const images = {};
  for (const s of slides) {
    for (const sh of s.shapes) {
      if (sh.kind !== 'img' || images[sh.src]) continue;
      const url = dataUrl(await readBytes(entries, sh.src), sh.src);
      if (url) images[sh.src] = url;
    }
  }
  // wPx는 화면이 글자 크기를 슬라이드 폭에 맞춰 줄이는 데 쓴다 — 원본 좌표가 px라
  // 그대로 쓰면 창을 줄였을 때 글자만 커서 상자를 넘친다(SlideView 주석).
  return { ratio: size.w / size.h, wPx: emuToPx(size.w), slides, images, truncated };
}
