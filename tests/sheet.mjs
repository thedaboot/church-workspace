import assert from 'node:assert';
import { attrs, blocks, parseXlsx, parseCsv, colToNum, refToRC, widthToPx } from '../src/services/xlsx.js';

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
      + '<fonts><font/><font><b/></font></fonts>'
      + '<fills><fill><patternFill patternType="none"/></fill>'
      + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>'
      + '<cellXfs><xf numFmtId="0" fontId="0" fillId="0"/>'
      + '<xf numFmtId="176" fontId="1" fillId="1"/></cellXfs>'
      + '</styleSheet>'],
    ['xl/worksheets/sheet1.xml',
      '<worksheet><dimension ref="B2:C3"/>'
      + '<cols><col min="2" max="2" width="8.43" customWidth="1"/><col min="4" max="4" width="0" hidden="1"/></cols>'
      + '<mergeCells count="1"><mergeCell ref="B2:C2"/></mergeCells>'
      + '<sheetData>'
      + '<row r="2"><c r="A2"/><c r="B2" s="0" t="s"><v>0</v></c></row>'
      + '<row r="3"><c r="A3"/><c r="B3" s="0" t="s"><v>1</v></c><c r="C3" s="1"><v>1234567</v></c><c r="D3" s="0"><v>9</v></c></row>'
      + '</sheetData></worksheet>'],
  ];
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
  assert.strictEqual(sheet.rows.length, 2);
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

console.log(fails ? `\n${fails} FAIL` : '\nall pass');
process.exit(fails ? 1 : 0);
