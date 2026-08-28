import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { attrs, blocks, parseXlsx, parseCsv, colToNum, refToRC, widthToPx, viewColPx, COL_MAX_PX, VIEW_FONT_PX } from '../src/services/xlsx.js';
import { compile, evalRule, BLANK } from '../src/services/formula.js';
import { zipOf } from './zip.mjs';

// ============================================================================
// 엑셀 파서 검사 — 브라우저가 필요 없다(순수 함수 + 네이티브 DecompressionStream).
// 게스트 스위트와 달리 서버도 필요 없어서 그냥 `node tests/sheet.mjs`로 돈다.
// ============================================================================
let fails = 0;
// 러너(tests/run.mjs)는 **줄 맨 앞의** PASS/FAIL만 센다 — 들여쓰면 0 pass로 잡힌다
const check = (name, fn) => {
  try { fn(); console.log(`PASS  ${name}`); }
  catch (e) { fails++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

// ── 이 파일이 지키는 함정 ────────────────────────────────────────────────────
// 자기 닫는 태그(<c r="A4"/>)를 정규식의 (/)? 그룹으로 잡으려 하면 앞의 [^>]*가
// 끝 슬래시까지 먹어서 "열린 태그"로 판정되고, </c>를 찾아 **다음 셀을 통째로
// 삼킨다**. 그러면 값이 한 칸 왼쪽으로 밀리고 t="s"를 잃어 공유 문자열이 인덱스
// 숫자로 보였다. 이 검사를 일부러 되돌려 실패하는 것을 확인했다(§2-5).
check('blocks: 자기 닫는 태그가 다음 태그를 삼키지 않는다', () => {
  const row = '<row r="4"><c r="A4" s="19"/><c r="B4" s="23" t="s"><v>165</v></c><c r="C4"><v>8</v></c></row>';
  const got = [...blocks(row, 'c')];
  assert.strictEqual(got.length, 3, `셀 3개여야 하는데 ${got.length}개`);
  assert.strictEqual(got[0].inner, '');
  assert.strictEqual(attrs(got[1].open).t, 's');
  assert.strictEqual(got[1].inner, '<v>165</v>');
  assert.strictEqual(got[2].inner, '<v>8</v>');
});

check('blocks: 비슷한 이름의 태그를 잘못 잡지 않는다', () => {
  // <c>를 찾을 때 <col>·<cols>가 걸리면 열 정보가 셀로 새어 들어온다
  assert.strictEqual([...blocks('<cols><col min="1" max="1"/></cols>', 'c')].length, 0);
  assert.strictEqual([...blocks('<sheets><sheet name="가"/></sheets>', 'sheet')].length, 1);
});

check('attrs: 속성을 순서와 무관하게 읽는다', () => {
  assert.deepStrictEqual(attrs('<c t="s" r="B2" s="157">'), { t: 's', r: 'B2', s: '157' });
  assert.strictEqual(attrs('<sheet name="가" r:id="rId1"/>')['r:id'], 'rId1');
});

check('셀 주소', () => {
  assert.strictEqual(colToNum('A'), 1);
  assert.strictEqual(colToNum('Z'), 26);
  assert.strictEqual(colToNum('AA'), 27);
  assert.deepStrictEqual(refToRC('B12'), { c: 2, r: 12 });
  assert.strictEqual(refToRC('없음'), null);
  assert.strictEqual(widthToPx(8.43), 64);
});

check('csv: 따옴표 안의 쉼표·줄바꿈·두 겹 따옴표', () => {
  const { sheets } = parseCsv('이름,메모\n노준석,"가, 나"\n조해리,"큰 ""따옴표"""');
  const [r0, r1, r2] = sheets[0].rows;
  assert.strictEqual(r0[0].v, '이름');
  assert.strictEqual(r0[0].bold, true);        // 첫 줄은 머리글로 본다
  assert.strictEqual(r1[1].v, '가, 나');
  assert.strictEqual(r2[1].v, '큰 "따옴표"');
});

// ── 실물 xlsx ────────────────────────────────────────────────────────────────
// 손으로 만든 최소 xlsx를 zip으로 싸서 넣는다. 실제 드라이브 파일을 레포에 두면
// 명단·연락처가 커밋에 들어간다(그 파일에 주민등록번호 칸이 있다).
function miniXlsx() {
  // 압축 없이(stored) 담는다 — 검사에 zip 라이브러리를 들이지 않으려는 것이고,
  // 파서의 stored 경로도 같이 지난다.
  const files = [
    ['xl/workbook.xml', '<workbook><sheets><sheet name="표" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', '<sst count="2" uniqueCount="2"><si><t>수입</t></si><si><t>합<rPh sb="0"><t>ㅎ</t></rPh>계</t></si></sst>'],
    ['xl/styles.xml',
      '<styleSheet>'
      + '<numFmts><numFmt numFmtId="176" formatCode="#,##0"/></numFmts>'
      + '<fonts><font/><font><b/></font>'
      + '<font><i/><strike/><color rgb="FF00B050"/></font></fonts>'
      + '<fills><fill><patternFill patternType="none"/></fill>'
      + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>'
      + '<borders><border/>'
      + '<border><left style="medium"><color rgb="FFFF0000"/></left><bottom style="thin"/></border>'
      + '</borders>'
      // 조건부 서식이 쓰는 서식 조각 — 칠이 bgColor에 있다(셀 칠과 반대)
      + '<dxfs><dxf><font><b/><color rgb="FF9C0006"/></font>'
      + '<fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>'
      + '<dxf><font><i/></font></dxf></dxfs>'
      + '<cellXfs><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'
      + '<xf numFmtId="176" fontId="1" fillId="1" borderId="1"/>'
      + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0"/></cellXfs>'
      + '</styleSheet>'],
    ['xl/worksheets/sheet1.xml',
      '<worksheet><dimension ref="B2:C3"/>'
      + '<cols><col min="2" max="2" width="8.43" customWidth="1"/><col min="4" max="4" width="0" hidden="1"/></cols>'
      + '<mergeCells count="1"><mergeCell ref="B2:C2"/></mergeCells>'
      + '<sheetData>'
      + '<row r="2"><c r="A2"/><c r="B2" s="0" t="s"><v>0</v></c></row>'
      + '<row r="3"><c r="A3"/><c r="B3" s="0" t="s"><v>1</v></c><c r="C3" s="1"><v>1234567</v></c><c r="D3" s="0"><v>9</v></c></row>'
      + '<row r="4"><c r="B4" s="2" t="s"><v>0</v></c><c r="C4" s="0"><v>5000</v></c></row>'
      + '<row r="5"><c r="B5" s="0"><v>10</v></c><c r="C5" s="0"><v>20</v></c></row>'
      + '<row r="6"><c r="B6" s="0"><v>0</v></c><c r="C6" s="0"><v>100</v></c></row>'
      + '</sheetData>'
      // C4만 1000을 넘으니 dxf가 붙어야 한다. B5:C5는 두 색 눈금.
      + '<conditionalFormatting sqref="C4:C4">'
      + '<cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>1000</formula></cfRule>'
      + '</conditionalFormatting>'
      + '<conditionalFormatting sqref="B5:C5"><cfRule type="colorScale" priority="2"><colorScale>'
      + '<cfvo type="min"/><cfvo type="max"/><color rgb="FF0000FF"/><color rgb="FF00FF00"/>'
      + '</colorScale></cfRule></conditionalFormatting>'
      // 수식 규칙 — B5 기준으로 =B5>5. dxfId 1(기울임)을 쓴다.
      + '<conditionalFormatting sqref="B5:B5">'
      + '<cfRule type="expression" dxfId="1" priority="3"><formula>B5&gt;5</formula></cfRule>'
      + '</conditionalFormatting>'
      // 아이콘 집합 — 세 갈래 화살표
      + '<conditionalFormatting sqref="B6:C6"><cfRule type="iconSet" priority="4">'
      + '<iconSet iconSet="3Arrows" showValue="1">'
      + '<cfvo type="percent" val="0"/><cfvo type="percent" val="33"/><cfvo type="percent" val="67"/>'
      + '</iconSet></cfRule></conditionalFormatting>'
      + '</worksheet>'],
  ];
  return zipOf(files);
}


const book = await parseXlsx(miniXlsx());
const sheet = book.sheets[0];

check('xlsx: 시트 이름 · 여백 걷어내기', () => {
  assert.strictEqual(sheet.name, '표');
  // B열에서 시작하므로 A열(빈 칸)은 걷어내고 B가 0번 열이 된다
  assert.strictEqual(sheet.rows.length, 5);
  assert.strictEqual(sheet.rows[0][0].v, '수입');
});

check('xlsx: 공유 문자열의 rPh(덧말)를 걷어낸다', () => {
  // 안 걷으면 '합ㅎ계'가 된다
  assert.strictEqual(sheet.rows[1][0].v, '합계');
});

check('xlsx: 숫자 형식(#,##0) · 굵기 · 칠', () => {
  const c = sheet.rows[1][1];
  assert.strictEqual(c.v, '1,234,567');
  assert.strictEqual(c.num, true);
  assert.strictEqual(c.bold, true);
  assert.strictEqual(c.bg, '#FFFF00');
});

check('xlsx: 숨긴 열은 빼고, 병합은 표 좌표로 옮긴다', () => {
  // D열은 hidden이라 값(9)이 들어오면 안 된다
  const flat = sheet.rows.flat().filter(Boolean).map(c => c.v);
  assert.ok(!flat.includes('9'), `숨긴 열이 새어 들어왔다: ${flat.join(',')}`);
  assert.deepStrictEqual(sheet.merges, [{ r: 0, c: 0, rs: 1, cs: 2 }]);
});

check('xlsx: state="visible"를 숨긴 시트로 보지 않는다', () => {
  // 엑셀은 보이는 시트에 state를 안 적지만 다른 도구(openpyxl·LibreOffice·구글
  // 스프레드시트 내보내기)는 visible을 적어 넣는다. "비어 있지 않으면 숨김"으로 보면
  // 그런 파일은 시트가 **한 장도 없는** 것이 되어 미리보기가 빈 화면이었다.
  const hiddenOf = (state) => ['hidden', 'veryHidden'].includes(state);
  assert.strictEqual(hiddenOf('visible'), false, 'visible을 숨김으로 본다');
  assert.strictEqual(hiddenOf(''), false, 'state가 없으면 보이는 시트다');
  assert.strictEqual(hiddenOf('hidden'), true);
  assert.strictEqual(hiddenOf('veryHidden'), true);
  // 소스도 같이 본다 — 위 표는 규칙을 적은 것뿐이라 구현이 어긋나면 못 잡는다
  const src = readFileSync(new URL('../src/services/xlsx.js', import.meta.url), 'utf8');
  assert.ok(src.includes("hidden: ['hidden', 'veryHidden'].includes(attr(open, 'state') || '')"),
    '숨김 판정이 값 두 개를 보지 않는다');
});

check('xlsx: 500줄을 채우면 거기서 멈춘다', () => {
  // 끝까지 읽고 나서 자르면 안 그릴 줄까지 칸마다 서식을 붙인다. 실측: 6.4MB
  // (6만 줄)짜리가 3.3초 → 0.36초.
  const src = readFileSync(new URL('../src/services/xlsx.js', import.meta.url), 'utf8');
  assert.ok(src.includes('if (grid.size >= MAX_ROWS) { cutShort = true; break; }'), '줄 수 상한에서 안 멈춘다');
  assert.ok(src.includes('const truncated = cutShort ||'), '끊고서 잘렸다고 알리지 않는다');
});
check('xlsx: 열 너비를 px로 옮긴다', () => {
  assert.strictEqual(sheet.cols[0], 64);   // 8.43자 → 64px
});

// 가독성 규칙(SheetView 머리 주석). 원본을 그대로 따르지 않기로 한 자리라, 되돌리면
// 실물 결산안의 '비고' 열이 다시 744px가 되어 표가 가로로 세 화면이 된다.
check('view: 열 너비는 글자 크기만큼 넓히고 상한에서 자른다', () => {
  assert.strictEqual(viewColPx(64), Math.round(64 * (VIEW_FONT_PX / 11.5)));  // 글자를 키운 만큼 넓다
  assert.ok(viewColPx(64) > 64, '엑셀 폭 그대로면 글자만 커져 줄바꿈이 는다');
  assert.strictEqual(viewColPx(744), COL_MAX_PX, '화면보다 넓은 열은 상한에서 잘려야 한다');
  assert.strictEqual(viewColPx(null), viewColPx(64), '너비를 안 적은 열은 엑셀 기본값(8.43자)이다');
});

check('xlsx: 테두리 — 굵기·모양은 원본, 지정한 색만 남긴다', () => {
  const bd = sheet.rows[1][1].bd;
  assert.ok(bd, '테두리를 못 읽었다');
  assert.deepStrictEqual(bd.l, { w: 2, s: 'solid', c: '#FF0000' });   // medium + 빨강
  assert.deepStrictEqual(bd.b, { w: 1, s: 'solid', c: null });        // thin + 기본색 → null
  assert.strictEqual(bd.t, null);
  // 테두리가 없는 칸은 bd 자체가 null이라 화면이 옅은 격자선을 쓴다
  assert.strictEqual(sheet.rows[0][0].bd, null);
});

check('xlsx: 기울임 · 취소선 · 글자색', () => {
  const c = sheet.rows[2][0];
  assert.strictEqual(c.italic, true);
  assert.strictEqual(c.strike, true);
  assert.strictEqual(c.fg, '#00B050');
});

check('조건부 서식: cellIs가 dxf의 칠·글자색·굵기를 입힌다', () => {
  const hit = sheet.rows[2][1];          // C4 = 5000 > 1000
  assert.strictEqual(hit.bg, '#FFC7CE', 'dxf의 칠은 fgColor가 아니라 bgColor에 있다');
  assert.strictEqual(hit.fg, '#9C0006');
  assert.strictEqual(hit.bold, true);
  assert.strictEqual(hit.cf, true);
  // 규칙 밖의 칸은 그대로여야 한다
  assert.strictEqual(sheet.rows[1][1].bg, '#FFFF00');
});

check('조건부 서식: 색눈금이 최소·최대에 각 끝 색을 준다', () => {
  const [lo, hi] = [sheet.rows[3][0], sheet.rows[3][1]];   // B5=10, C5=20
  assert.strictEqual(lo.bg, '#0000ff');
  assert.strictEqual(hi.bg, '#00ff00');
});

// ── 수식 계산기 ──────────────────────────────────────────────────────────────
// 표: A1=10 B1=  (빈 칸)  C1='사과'
//     A2=20 B2=5 C2='사과'
//     A3=30 B3=7 C3='배'
const GRID = {
  '1,1': 10, '1,3': '사과',
  '2,1': 20, '2,2': 5, '2,3': '사과',
  '3,1': 30, '3,2': 7, '3,3': '배',
};
const ctxAt = (r, c, anchorR = 1, anchorC = 1) => ({
  get: (rr, cc) => (GRID[`${rr},${cc}`] ?? BLANK),
  bounds: { r1: 1, r2: 3, c1: 1, c2: 3 },
  here: { r, c },
  dr: r - anchorR, dc: c - anchorC,
  today: new Date(Date.UTC(2026, 7, 27)),
});
const run = (src, r, c, aR = 1, aC = 1) => evalRule(compile(src), ctxAt(r, c, aR, aC));

check('수식: 비교 · 상대 참조가 칸마다 옮겨간다', () => {
  // 규칙은 A1 자리 기준으로 =A1>15 . 1행은 거짓, 2·3행은 참이어야 한다.
  assert.strictEqual(run('=A1>15', 1, 1), false);
  assert.strictEqual(run('=A1>15', 2, 1), true);
  assert.strictEqual(run('=A1>15', 3, 1), true);
});

check('수식: $는 고정, 없는 쪽만 따라 움직인다', () => {
  // $A1 은 열 고정 → 2열에서 판정해도 A열을 본다
  assert.strictEqual(run('=$A1>15', 2, 2), true);
  // A$1 은 행 고정 → 3행에서 판정해도 1행(10)을 본다
  assert.strictEqual(run('=A$1>15', 3, 1), false);
});

check('수식: 빈 칸은 ""와 같고 0으로도 센다', () => {
  // 규칙이 B1 자리에 적혀 있고 B1에서 판정 → 옮길 것이 없다(dr=dc=0)
  assert.strictEqual(run('=B1=""', 1, 2, 1, 2), true);
  assert.strictEqual(run('=B2=""', 2, 2, 2, 2), false);
  assert.strictEqual(run('=ISBLANK(B1)', 1, 2, 1, 2), true);
  // 앵커가 어긋나면 참조도 그만큼 밀린다 — 이게 상대 참조의 뜻이다.
  // B1 기준 규칙을 C1에서 보면 C1('사과')을 읽으므로 빈 칸이 아니다.
  assert.strictEqual(run('=B1=""', 1, 3, 1, 2), false);
  assert.strictEqual(run('=B1+0=0', 1, 2, 1, 2), true);   // 빈 칸은 0으로도 센다
});

check('수식: AND · OR · NOT · IF', () => {
  assert.strictEqual(run('=AND(A2>15,C2="사과")', 2, 1, 2, 1), true);
  assert.strictEqual(run('=AND(A2>25,C2="사과")', 2, 1, 2, 1), false);
  assert.strictEqual(run('=OR(A2>25,C2="사과")', 2, 1, 2, 1), true);
  assert.strictEqual(run('=NOT(A2>25)', 2, 1, 2, 1), true);
  assert.strictEqual(run('=IF(A2>15,TRUE,FALSE)', 2, 1, 2, 1), true);
});

check('수식: 범위 함수 · 열 전체 · COUNTIF', () => {
  assert.strictEqual(run('=SUM(A1:A3)=60', 1, 1), true);
  assert.strictEqual(run('=MAX(A1:A3)=30', 1, 1), true);
  assert.strictEqual(run('=COUNTIF(C1:C3,"사과")=2', 1, 1), true);
  assert.strictEqual(run('=COUNTIF($C:$C,"사과")>1', 1, 1), true);   // 열 전체
  assert.strictEqual(run('=COUNTA(B1:B3)=2', 1, 1), true);           // 빈 칸은 안 센다
});

check('수식: MOD(ROW(),2) 같은 줄무늬 규칙', () => {
  assert.strictEqual(run('=MOD(ROW(),2)=0', 2, 1), true);
  assert.strictEqual(run('=MOD(ROW(),2)=0', 3, 1), false);
});

check('수식: 못 읽는 것은 null이고, 판정은 거짓이다', () => {
  assert.strictEqual(compile('=Sheet2!A1>1'), null, '다른 시트 참조는 못 읽는다');
  assert.strictEqual(compile('=VLOOKUP(A1,B:C,2,0)') && run('=VLOOKUP(A1,B:C,2,0)', 1, 1), false);
  assert.strictEqual(compile('=((('), null);
  assert.strictEqual(evalRule(null, ctxAt(1, 1)), false);
});

check('조건부 서식: 수식 규칙이 실제 셀에 적용된다', () => {
  const hit = sheet.rows[3][0];      // B5 = 10 → 수식 규칙(=B5>5)이 참
  assert.strictEqual(hit.italic, true, '수식 규칙의 dxf가 안 붙었다');
});

check('조건부 서식: 아이콘 집합이 구간을 나눈다', () => {
  const [lo, hi] = [sheet.rows[4][0], sheet.rows[4][1]];   // B6=0, C6=100
  assert.ok(lo.icon && hi.icon, '아이콘이 없다');
  assert.strictEqual(lo.icon.n, 3);
  assert.strictEqual(lo.icon.set, '3Arrows');
  assert.strictEqual(lo.icon.idx, 0, '최솟값은 맨 아래 구간이어야 한다');
  assert.strictEqual(hi.icon.idx, 2, '최댓값은 맨 위 구간이어야 한다');
  assert.strictEqual(lo.icon.showValue, true);
});

check('조건부 서식: 규칙 없는 칸은 건드리지 않는다', () => {
  // 수식 규칙(expression)·아이콘 집합은 적용하지 않는다 — 틀린 색을 칠하는 것보다
  // 안 칠하는 쪽이 낫다. 규칙이 안 닿은 칸에 cf 표시가 붙으면 여기서 걸린다.
  assert.strictEqual(sheet.rows[0][0].cf, undefined);
});

// ── 옛 방식(indexed) 색 ─────────────────────────────────────────────────────
// 워크스페이스의 결산안 하나가 통째로 indexed였고, 이걸 몰라서 그 파일만
// **배경색이 하나도 안 나왔다**(사용자 지적 2026-08-28 — "우리 톤에 맞게 조정을
// 하지 않았었나"). rgb·theme만 읽고 있었다.
const idxBook = await parseXlsx(zipOf([
  ['xl/workbook.xml', '<workbook><sheets><sheet name="색" sheetId="1" r:id="rId1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/styles.xml',
    '<styleSheet>'
    // 파일이 팔레트를 스스로 정해 둔다 — 12번만 바꾼다(나머지는 기본 팔레트)
    + '<colors><indexedColors>'
    + Array.from({ length: 64 }, (_, i) => `<rgbColor rgb="00${i === 12 ? '123456' : (i === 10 ? 'FF0000' : '000000')}"/>`).join('')
    + '</indexedColors></colors>'
    + '<fonts><font/></fonts>'
    + '<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor indexed="10"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor indexed="12"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor auto="1"/></patternFill></fill></fills>'
    + '<borders><border/></borders>'
    + '<cellXfs><xf fillId="0"/><xf fillId="2"/><xf fillId="3"/><xf fillId="4"/></cellXfs>'
    + '</styleSheet>'],
  ['xl/worksheets/sheet1.xml',
    '<worksheet><sheetData><row r="1">'
    + '<c r="A1" s="1"><v>1</v></c><c r="B1" s="2"><v>2</v></c><c r="C1" s="3"><v>3</v></c>'
    + '</row></sheetData></worksheet>'],
]));

check('색: 옛 방식(indexed)도 읽는다', () => {
  const s2 = idxBook.sheets[0];
  assert.strictEqual(s2.rows[0][0].bg, '#FF0000', 'indexed="10"을 못 읽었다');
  // <indexedColors>로 팔레트를 바꿔 두면 그것을 따라야 한다
  assert.strictEqual(s2.rows[0][1].bg, '#123456', '파일이 정한 팔레트를 안 봤다');
  // auto="1"은 시스템 기본색 — 우리 토큰에 맡겨야 한다(칠하면 안 된다)
  assert.strictEqual(s2.rows[0][2].bg, null, 'auto 색을 그대로 칠했다');
});

// ── 2026-08-29 회차: 원본과 같게 (실물 결산안 4개 대조에서 나온 격차들) ──────
// 실물 파일은 레포에 못 둔다(명단·연락처) — 격차마다 같은 무늬의 최소 픽스처를 만든다.
const fidBook = await parseXlsx(zipOf([
  ['xl/workbook.xml', '<workbook><sheets><sheet name="결산" sheetId="1" r:id="rId1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
  // A1 셀: 부분 서식 — "(야식) 365,800 찬조" 구간만 주황(실물 결산안의 비고와 같은 무늬)
  ['xl/sharedStrings.xml',
    '<sst><si>'
    + '<r><rPr><sz val="10"/><color rgb="FF000000"/></rPr><t xml:space="preserve">(다과) 132,320 / </t></r>'
    + '<r><rPr><sz val="10"/><color rgb="FFC65911"/></rPr><t>(야식) 365,800 찬조</t></r>'
    + '</si><si><t>서식 없는 런 아님</t></si></sst>'],
  ['xl/styles.xml',
    '<styleSheet>'
    + '<numFmts>'
    + '<numFmt numFmtId="176" formatCode="&quot;₩&quot;#,##0_);[Red]\\(&quot;₩&quot;#,##0\\)"/>'
    + '<numFmt numFmtId="177" formatCode="_-* #,##0_-;\\-* #,##0_-;_-* &quot;-&quot;_-;_-@"/>'
    + '<numFmt numFmtId="178" formatCode="mm&quot;/&quot;dd&quot; &quot;ddd"/>'
    + '</numFmts>'
    + '<fonts><font/><font><b/><sz val="24"/></font></fonts>'
    + '<fills><fill><patternFill patternType="none"/></fill></fills>'
    + '<borders><border/><border><right style="thin"/></border><border><bottom style="medium"/></border></borders>'
    + '<cellXfs>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'
    + '<xf numFmtId="176" fontId="0"/>'          // s=1 ₩ · [Red] 괄호
    + '<xf numFmtId="177" fontId="0"/>'          // s=2 회계식(0은 "-")
    + '<xf numFmtId="58" fontId="0"/>'           // s=3 한국어 내장 날짜(m월 d일)
    + '<xf numFmtId="178" fontId="0"/>'          // s=4 요일(ddd)
    + '<xf numFmtId="0" fontId="1"/>'            // s=5 24pt 제목
    + '<xf numFmtId="0" fontId="0" borderId="1"/>'  // s=6 right 테두리만
    + '<xf numFmtId="0" fontId="0" borderId="2"/>'  // s=7 bottom 테두리만
    + '<xf numFmtId="20" fontId="0"/>'              // s=8 h:mm (분/월 가르기)
    + '<xf numFmtId="49" fontId="0"/>'              // s=9 @ (텍스트 서식이 걸린 숫자)
    + '</cellXfs>'
    + '</styleSheet>'],
  ['xl/worksheets/sheet1.xml',
    '<worksheet>'
    + '<sheetFormatPr defaultColWidth="14.42578125" defaultRowHeight="15"/>'
    + '<cols><col min="3" max="3" width="0" hidden="1"/></cols>'
    // A7:B8 병합 — right는 B7에만, bottom은 A8에만(OOXML이 실제로 쓰는 나눠 적기)
    + '<mergeCells count="2"><mergeCell ref="A7:B8"/><mergeCell ref="A1:E1"/></mergeCells>'
    + '<sheetData>'
    + '<row r="1" ht="32.25"><c r="A1" s="5" t="s"><v>0</v></c></row>'
    // C2(99)는 숨긴 C열에 있다 — 값째 사라지고 자리도 남으면 안 된다
    + '<row r="2"><c r="A2" s="1"><v>9000000</v></c><c r="B2" s="1"><v>-1234</v></c>'
    +   '<c r="C2"><v>99</v></c><c r="D2" s="2"><v>0</v></c></row>'
    + '<row r="3"><c r="A3" s="3"><v>46054</v></c><c r="B3" s="4"><v>46054</v></c><c r="D3" t="s"><v>1</v></c></row>'
    + '<row r="4"><c r="A4" s="8"><v>46054.5639</v></c><c r="B4" s="9"><v>1235</v></c></row>'
    + '<row r="7"><c r="A7" t="s"><v>1</v></c><c r="B7" s="6"/><c r="D7" s="6"/></row>'
    + '<row r="8"><c r="A8" s="7"/></row>'
    // 값 영역 밖(H20)의 테두리-only 칸은 예전대로 버려진다
    + '<row r="20"><c r="H20" s="6"/></row>'
    + '</sheetData>'
    + '<autoFilter ref="A2:D2"/>'
    + '<drawing r:id="rId9"/>'
    + '</worksheet>'],
  ['xl/worksheets/_rels/sheet1.xml.rels',
    '<Relationships><Relationship Id="rId9" Target="../drawings/drawing1.xml"/></Relationships>'],
  ['xl/drawings/drawing1.xml',
    '<xdr:wsDr><xdr:twoCellAnchor>'
    + '<xdr:from><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:from>'
    + '<xdr:to><xdr:col>3</xdr:col><xdr:row>2</xdr:row></xdr:to>'
    + '<xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic>'
    + '</xdr:twoCellAnchor></xdr:wsDr>'],
  ['xl/drawings/_rels/drawing1.xml.rels',
    '<Relationships><Relationship Id="rId1" Target="../media/image1.png"/></Relationships>'],
  ['xl/media/image1.png', 'PNG-BYTES'],
]));
const fid = fidBook.sheets[0];
const cellAt = (r, c) => fid.rows[r]?.[c];
// 숨긴 C열이 자리째 빠지므로 화면 열은 A,B,D,E… — D는 2번이 된다
check('부분 서식: 구간별 색이 살아 있다', () => {
  const c = cellAt(0, 0);
  assert.ok(c.runs, 'runs가 없다 — 이어붙이기만 했다');
  assert.strictEqual(c.runs.length, 2);
  assert.strictEqual(c.runs[0].color, null, '검정 구간은 기본색(null)이어야 한다');
  assert.strictEqual(c.runs[1].color, '#C65911', '찬조 구간의 주황이 사라졌다');
  assert.ok(c.runs[1].t.includes('야식'));
  // 서식 없는 문자열은 runs를 들고 다니지 않는다(대부분의 셀이 이 경로)
  assert.strictEqual(cellAt(2, 2).runs, null);
});
check('숫자 서식: ₩ 접두 · [Red] 괄호 음수 · 회계식 0은 "-"', () => {
  assert.strictEqual(cellAt(1, 0).v, '₩9,000,000', `₩가 사라졌다: ${cellAt(1, 0).v}`);
  assert.strictEqual(cellAt(1, 1).v, '(₩1,234)', `음수 괄호가 아니다: ${cellAt(1, 1).v}`);
  assert.strictEqual(cellAt(1, 1).fg, '#C00000', '[Red]가 글자색으로 안 옮았다');
  assert.strictEqual(cellAt(1, 2).v, '-', `회계식 0이 "-"가 아니다: ${cellAt(1, 2)?.v}`);
});
check('날짜: 한국어 내장 서식(58)과 요일(ddd)', () => {
  assert.strictEqual(cellAt(2, 0).v, '2월 1일', `일련번호가 날짜로 안 바뀌었다: ${cellAt(2, 0).v}`);
  assert.strictEqual(cellAt(2, 1).v, '02/01 일', `요일이 없다: ${cellAt(2, 1).v}`);
  // 'h:mm'의 mm은 분이다 — 콜론(리터럴)이 h를 잊게 하면 분이 월로 나온다
  // (46054.5639 = 2026-02-01 13:32). 시간 서식은 이 파일들에 없지만 옛 코드가 맞던 자리다.
  assert.strictEqual(cellAt(3, 0).v, '13:32', `분이 월로 나온다: ${cellAt(3, 0).v}`);
  // 숫자 셀에 텍스트 서식('@' · 내장 49)이 걸리면 값을 그대로 보여준다 — 빈 문자열을
  // 돌리면 셀이 통째로 사라진다
  assert.strictEqual(cellAt(3, 1).v, '1235', `'@' 서식 셀이 사라졌다: ${cellAt(3, 1)?.v}`);
});
check('시트 기본 열 너비를 읽는다', () => {
  assert.strictEqual(fid.defaultColPx, 106, '14.43자 = 106px이어야 한다');
});
check('글자 크기: 24pt 제목이 커진다', () => {
  assert.strictEqual(cellAt(0, 0).szPx, 27, '24pt → 27px');
});
check('숨긴 열은 자리째 빠진다(유령 열 없음)', () => {
  // A,B,(C숨김),D → 화면은 A,B,D 세 자리. 숨긴 C의 값(99)은 사라지고,
  // D2가 2번 자리로 당겨진다 — 예전에는 C 자리가 기본 너비의 빈 열로 남았다.
  const vals = fid.rows[1].map(x => x?.v);
  assert.ok(!vals.includes('99'), `숨긴 열의 값이 새어 나왔다: ${JSON.stringify(vals)}`);
  assert.strictEqual(cellAt(1, 2)?.v, '-', `숨긴 열이 자리를 차지한다: ${JSON.stringify(vals)}`);
});
check('병합 테두리: 끝 셀의 선이 앵커로 합쳐진다', () => {
  const anchor = fid.rows[6]?.[0];   // A7
  assert.ok(anchor?.v === '서식 없는 런 아님', '병합 앵커(A7)를 못 찾았다');
  assert.ok(anchor.bd?.r, 'B7의 right가 앵커로 안 왔다');
  assert.ok(anchor.bd?.b, 'A8의 bottom이 앵커로 안 왔다');
});
check('테두리만 있는 빈 칸: 값 영역 안은 살고 밖은 버려진다', () => {
  // D7(값 영역 안) — 화면 좌표로 6행 2열
  const d7 = fid.rows[fid.rows.length >= 7 ? 6 : 0]?.[2];
  assert.ok(d7?.bd?.r, '값 영역 안의 테두리 칸이 버려졌다(전표 폼이 무너진다)');
  // H20(값 영역 밖) — 표가 20행·H열까지 늘어나면 안 된다
  assert.ok(fid.rows.length < 15, `밖의 장식 테두리가 표를 늘렸다: ${fid.rows.length}행`);
});
check('병합이 표 크기를 넘지 않는다(colSpan 클램프)', () => {
  const width = fid.rows[0].length;
  for (const g of fid.merges) {
    assert.ok(g.c + g.cs <= width, `병합이 표 폭을 넘는다: c=${g.c} cs=${g.cs} 폭=${width}`);
    assert.ok(g.r + g.rs <= fid.rows.length, `병합이 표 높이를 넘는다`);
  }
});
check('행 높이(ht)가 최소 높이로 실린다', () => {
  assert.strictEqual(fid.rowPx[0], Math.round(32.25 * (4 / 3) * (VIEW_FONT_PX / 11.5)), `제목 행 높이: ${fid.rowPx[0]}`);
  assert.strictEqual(fid.rowPx[1], null, 'ht 없는 행은 null(내용대로)');
});
check('자동 필터 자리가 실린다', () => {
  assert.ok(fid.filter, 'filter가 없다');
  assert.strictEqual(fid.filter.r, 1, `머리행: ${fid.filter?.r}`);
});
check('시트 위 그림: 앵커 셀과 걸친 범위', () => {
  assert.strictEqual(fid.images.length, 1, `그림 수: ${fid.images.length}`);
  const im = fid.images[0];
  assert.ok(im.src.startsWith('data:image/png;base64,'), '그림이 data URL이 아니다');
  assert.strictEqual(im.r, 1, `앵커 행: ${im.r}`);
  assert.strictEqual(im.c, 1, `앵커 열: ${im.c}`);
  assert.ok(im.c2 >= 2, 'to 열(폭 어림용)이 없다');
});
// 렌더러 쪽은 JSX라 노드에서 못 돌린다 — 파서가 준 것을 실제로 쓰는지 소스로 못 박는다
check('렌더러가 새 값들을 실제로 쓴다(소스 단정)', () => {
  const src = readFileSync(new URL('../src/components/SheetView.jsx', import.meta.url), 'utf8');
  assert.ok(src.includes('cell?.runs'), '부분 서식(runs)을 안 그린다');
  assert.ok(src.includes('sheet.defaultColPx'), '시트 기본 열 너비를 안 쓴다');
  assert.ok(src.includes('cell?.szPx || VIEW_FONT_PX'), '글자 크기를 안 쓴다');
  assert.ok(src.includes('sheet.rowPx'), '행 높이를 안 쓴다');
  assert.ok(src.includes("cell?.valign === 'top' ? 'top' : 'bottom'"), '엑셀 기본 세로 정렬(bottom)이 아니다');
  assert.ok(src.includes('sheet.filter'), '필터 표시가 없다');
  assert.ok(src.includes('imagesAt'), '그림을 안 그린다');
});

console.log(fails ? `\n${fails} FAIL` : '\nall pass');
process.exit(fails ? 1 : 0);
