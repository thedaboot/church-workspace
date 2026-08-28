import assert from 'node:assert';
import { zipOf } from './zip.mjs';
import { resolvePath, topLevel } from '../src/services/ooxml.js';
import { parseDocx, headingLevel, styleList } from '../src/services/docx.js';
import { parsePptx } from '../src/services/pptx.js';

// ============================================================================
// 워드·파워포인트 파서 검사 — 브라우저도 서버도 필요 없다(`node tests/office.mjs`).
// ----------------------------------------------------------------------------
// 여기 있는 항목은 전부 **실물 파일로 한 번씩 겪은 것**이다(2026-08-28에 만든
// docx·pptx로 돌려 보며 고쳤다). 손으로 만든 최소 파일을 zip으로 싸서 넣는다 —
// 실제 첨부를 레포에 두지 않으려는 것이다.
// ============================================================================
let fails = 0;
// 러너(tests/run.mjs)는 **줄 맨 앞의** PASS/FAIL만 센다 — 들여쓰면 0 pass로 잡힌다
const check = (name, fn) => {
  try { fn(); console.log(`PASS  ${name}`); }
  catch (e) { fails++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};
const acheck = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); }
  catch (e) { fails++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

// ── 공용 기계 ───────────────────────────────────────────────────────────────
// 이 둘이 어긋나면 워드·PPT가 통째로 빈 화면이 된다.
check('resolvePath: ../를 칸 단위로 거슬러 올라간다', () => {
  // 파워포인트의 슬라이드 → 레이아웃 관계가 언제나 이 모양이다. 처음에는 '/../'를
  // '/'로 바꾸는 것으로 때웠는데 앞 칸이 안 지워져서 레이아웃을 못 찾았고,
  // 자리 표시자 좌표를 물려받지 못해 **표지 슬라이드가 도형 0개**로 나왔다.
  assert.strictEqual(resolvePath('ppt/slides', '../slideLayouts/slideLayout1.xml'), 'ppt/slideLayouts/slideLayout1.xml');
  assert.strictEqual(resolvePath('word', 'media/image1.png'), 'word/media/image1.png');
  assert.strictEqual(resolvePath('xl', '/xl/worksheets/sheet1.xml'), 'xl/worksheets/sheet1.xml');
  assert.strictEqual(resolvePath('ppt/slides', './slide2.xml'), 'ppt/slides/slide2.xml');
});

check('topLevel: 같은 이름의 중첩을 세면서 문서 순서대로 준다', () => {
  // 워드 본문은 문단과 표가 섞여 있고 표 안에 또 문단이 있다. blocks()로 각각 훑으면
  // 순서가 무너지고(문단을 다 그린 뒤 표) 표 안의 문단이 본문에 한 번 더 나온다.
  const xml = '<b><w:p>1</w:p><w:tbl><w:tbl>안쪽</w:tbl><w:p>표안</w:p></w:tbl><w:p>2</w:p></b>';
  const got = [...topLevel(xml, ['w:p', 'w:tbl'])].map(x => `${x.name}:${x.inner}`);
  assert.strictEqual(got.length, 3, `셋이어야 하는데 ${got.length}개`);
  assert.strictEqual(got[0], 'w:p:1');
  assert.ok(got[1].startsWith('w:tbl:<w:tbl>'), '중첩된 표를 안쪽까지 통째로 잡아야 한다');
  assert.strictEqual(got[2], 'w:p:2');
});

// ── 워드 ────────────────────────────────────────────────────────────────────
check('docx: 문서 제목(Title·제목)도 제목이다', () => {
  // 숫자를 요구했더니 표지 제목이 본문 문단으로 떨어졌다(실물 docx에서 실제로).
  assert.strictEqual(headingLevel('Title'), 1);
  assert.strictEqual(headingLevel('제목'), 1);
  assert.strictEqual(headingLevel('Heading 2'), 2);
  assert.strictEqual(headingLevel('제목 3'), 3);
  assert.strictEqual(headingLevel('Normal'), 0);
  assert.strictEqual(headingLevel('ListBullet'), 0);
});

check('docx: 스타일에만 걸린 목록도 목록이다', () => {
  // 문단에 <w:numPr>를 안 적고 스타일(List Bullet)에만 거는 문서가 있다 — 실물
  // docx가 그랬고, 그러면 목록이 통째로 맨문단이 됐다.
  assert.strictEqual(styleList('ListBullet'), 'bullet');
  assert.strictEqual(styleList('List Number 2'), 'number');
  assert.strictEqual(styleList('Normal'), null);
});

const RELS = '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="x" Target="numbering.xml"/></Relationships>';
const docxOf = (bodyXml) => zipOf([
  ['[Content_Types].xml', '<Types/>'],
  ['word/_rels/document.xml.rels', RELS],
  ['word/document.xml', `<?xml version="1.0"?><w:document><w:body>${bodyXml}</w:body></w:document>`],
]);

await acheck('docx: 문단·표가 문서 순서대로, 표 안 글자는 표 안에만', async () => {
  const { blocks } = await parseDocx(docxOf(
    '<w:p><w:r><w:t>앞</w:t></w:r></w:p>'
    + '<w:tbl><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="2880"/></w:tblGrid>'
    + '<w:tr><w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc>'
    + '<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="DAE3F3"/></w:tcPr><w:p><w:r><w:t>예산</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:p><w:r><w:t>뒤</w:t></w:r></w:p>'));
  assert.strictEqual(blocks.length, 3, `문단2+표1이어야 하는데 ${blocks.length}개`);
  assert.strictEqual(blocks[0].runs[0].text, '앞');
  assert.strictEqual(blocks[1].t, 'table');
  assert.strictEqual(blocks[2].runs[0].text, '뒤', '표 뒤 문단이 사라졌다');
  const [c0, c1] = blocks[1].rows[0];
  assert.strictEqual(c0.paras[0].runs[0].text, '항목');
  assert.strictEqual(c1.span, 2, '가로 병합을 안 읽었다');
  assert.strictEqual(c1.bg, '#DAE3F3', '칸 칠을 안 읽었다');
  assert.deepStrictEqual(blocks[1].widths, [96, 192], '열 너비(twip→px)가 어긋난다');
});

await acheck('docx: w:val="0"은 굵기를 끈다', async () => {
  // 태그 유무만 보면 "스타일에서 물려받은 굵기를 문단에서 끈" 문서가 뒤집힌다.
  const { blocks } = await parseDocx(docxOf(
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>굵게</w:t></w:r>'
    + '<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>보통</w:t></w:r>'
    + '<w:r><w:rPr><w:i/><w:color w:val="C00000"/><w:sz w:val="28"/></w:rPr><w:t>빨강기울임</w:t></w:r></w:p>'));
  const [a, b, c] = blocks[0].runs;
  assert.strictEqual(a.b, true);
  assert.strictEqual(b.b, false, 'w:val="0"인데 굵게로 읽었다');
  assert.strictEqual(c.i, true);
  assert.strictEqual(c.color, '#C00000');
  assert.strictEqual(Math.round(c.sizePx), 19, 'half-point(28)이 14pt=18.67px여야 한다');
});

await acheck('docx: 탭·줄바꿈·쪽나눔이 글자 흐름에 남는다', async () => {
  const { blocks } = await parseDocx(docxOf(
    '<w:p><w:r><w:t>가</w:t><w:tab/><w:t>나</w:t><w:br/><w:t>다</w:t></w:r></w:p>'
    + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'));
  assert.strictEqual(blocks[0].runs[0].text, '가\t나\n다');
  assert.strictEqual(blocks[1].pageBreak, true, '쪽 나눔을 못 읽었다');
});

// ── 파워포인트 ──────────────────────────────────────────────────────────────
const LAYOUT = '<p:sldLayout><p:cSld><p:spTree>'
  + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="685800" y="2130425"/><a:ext cx="7772400" cy="1470025"/></a:xfrm></p:spPr></p:sp>'
  + '</p:spTree></p:cSld></p:sldLayout>';
const slideXml = (sp) => `<p:sld><p:cSld><p:spTree>${sp}</p:spTree></p:cSld></p:sld>`;
const pptxOf = (slides) => zipOf([
  ['[Content_Types].xml', '<Types/>'],
  ['ppt/_rels/presentation.xml.rels', '<Relationships>'
    + slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="slides/slide${i + 1}.xml"/>`).join('')
    + '</Relationships>'],
  ['ppt/presentation.xml', '<p:presentation><p:sldIdLst>'
    // **일부러 거꾸로 적는다** — 순서를 sldIdLst가 정하는지 보려는 것이다
    + slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${slides.length - i}"/>`).join('')
    + '</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>'],
  ['ppt/slideLayouts/slideLayout1.xml', LAYOUT],
  ...slides.flatMap((sp, i) => [
    [`ppt/slides/slide${i + 1}.xml`, slideXml(sp)],
    [`ppt/slides/_rels/slide${i + 1}.xml.rels`,
      '<Relationships><Relationship Id="rId1" Type="x" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'],
  ]),
]);

await acheck('pptx: 좌표 없는 자리 표시자는 레이아웃에서 물려받는다', async () => {
  // 슬라이드에 <a:xfrm>이 없는 것이 보통이다. 상속을 못 따라가면 그 도형이 통째로
  // 사라진다(우리는 어디에 둘지 모르는 도형을 그리지 않는다).
  const deck = await parsePptx(pptxOf([
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/>'
    + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>표지 제목</a:t></a:r></a:p></p:txBody></p:sp>',
  ]));
  assert.strictEqual(deck.slides.length, 1);
  const [sh] = deck.slides[0].shapes;
  assert.ok(sh, '자리 표시자가 통째로 빠졌다 — 레이아웃을 못 찾은 것이다');
  assert.strictEqual(sh.paras[0].runs[0].text, '표지 제목');
  assert.strictEqual(Math.round(sh.pos.x), 8, '레이아웃 좌표(EMU)를 퍼센트로 옮기지 못했다');
  assert.strictEqual(Math.round(sh.pos.w), 85);
});

await acheck('pptx: 제목에는 점을 찍지 않고, 본문에는 찍는다', async () => {
  const deck = await parsePptx(pptxOf([
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>'
    + '<p:txBody><a:p><a:r><a:t>제목</a:t></a:r></a:p></p:txBody></p:sp>'
    + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>'
    + '<p:txBody><a:p><a:r><a:t>본문</a:t></a:r></a:p></p:txBody></p:sp>'
    + '<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>'
    + '<p:txBody><a:p><a:r><a:t>글상자</a:t></a:r></a:p></p:txBody></p:sp>',
  ]));
  const [title, body, box] = deck.slides[0].shapes;
  assert.strictEqual(title.paras[0].bullet, false, '표지 제목에 없던 점이 생겼다');
  assert.strictEqual(body.paras[0].bullet, true, '본문 목록의 점이 사라졌다');
  assert.strictEqual(box.paras[0].bullet, false, '그냥 글상자에 점이 생겼다');
  // 크기를 안 적은 문단이 흔하다 — 자리 종류별 기본값이 없으면 제목과 본문이 같아진다
  assert.ok(title.paras[0].runs[0].sizePx > body.paras[0].runs[0].sizePx, '제목이 본문보다 커야 한다');
});

await acheck('pptx: 순서는 sldIdLst가 정한다', async () => {
  // rels를 훑는 순서로 그리면 slide10이 slide2 앞에 온다. 위 pptxOf가 일부러
  // r:id를 거꾸로 물려 두었으므로, 순서를 지키면 두 번째 슬라이드가 먼저 나온다.
  const deck = await parsePptx(pptxOf([
    '<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>첫째</a:t></a:r></a:p></p:txBody></p:sp>',
    '<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>둘째</a:t></a:r></a:p></p:txBody></p:sp>',
  ]));
  assert.strictEqual(deck.slides[0].shapes[0].paras[0].runs[0].text, '둘째', 'sldIdLst 순서를 안 따랐다');
  assert.strictEqual(deck.ratio.toFixed(3), '1.333');
  assert.strictEqual(deck.wPx, 960, '슬라이드 폭(px)이 있어야 글자 크기를 줄일 수 있다');
});

console.log(fails ? `\n${fails} FAIL` : '\nall pass');
process.exit(fails ? 1 : 0);
