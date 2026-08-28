import assert from 'node:assert';
import { attrs, blocks, parseXlsx, parseCsv, colToNum, refToRC, widthToPx } from '../src/services/xlsx.js';
import { compile, evalRule, BLANK } from '../src/services/formula.js';

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

// 파일 목록 → 압축 없이(stored) 담은 zip. 검사에 zip 라이브러리를 들이지 않으려는
// 것이고, 파서의 stored 경로도 같이 지난다.
function zipOf(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const put = (arr, ...vals) => vals.forEach(v => arr.push(v));
  const w16 = (n) => [n & 255, (n >> 8) & 255];
  const w32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
  for (const [name, body] of files) {
    const nb = enc.encode(name), db = enc.encode(body);
    const local = [];
    put(local, ...w32(0x04034b50), ...w16(20), ...w16(0), ...w16(0), ...w16(0), ...w16(0),
      ...w32(0), ...w32(db.length), ...w32(db.length), ...w16(nb.length), ...w16(0));
    const head = new Uint8Array([...local, ...nb, ...db]);
    chunks.push(head);
    const cen = [];
    put(cen, ...w32(0x02014b50), ...w16(20), ...w16(20), ...w16(0), ...w16(0), ...w16(0), ...w16(0),
      ...w32(0), ...w32(db.length), ...w32(db.length), ...w16(nb.length), ...w16(0), ...w16(0),
      ...w16(0), ...w16(0), ...w32(0), ...w32(offset));
    central.push(new Uint8Array([...cen, ...nb]));
    offset += head.length;
  }
  const cenBytes = central.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array([...w32(0x06054b50), ...w16(0), ...w16(0),
    ...w16(files.length), ...w16(files.length), ...w32(cenBytes), ...w32(offset), ...w16(0)]);
  const all = [...chunks, ...central, eocd];
  const total = all.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out.buffer;
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

check('xlsx: 열 너비를 px로 옮긴다', () => {
  assert.strictEqual(sheet.cols[0], 64);   // 8.43자 → 64px
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

console.log(fails ? `\n${fails} FAIL` : '\nall pass');
process.exit(fails ? 1 : 0);
