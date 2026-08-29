import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { attrs, blocks, parseXlsx, colToNum, refToRC } from '../src/services/xlsx.js';
import { zipOf } from './zip.mjs';

// ============================================================================
// 엑셀 파서 검사 — 브라우저가 필요 없다(순수 함수 + 네이티브 DecompressionStream).
// 게스트 스위트와 달리 서버도 필요 없어서 그냥 `node tests/sheet.mjs`로 돈다.
//
// **2026-08-30부터 이 파일은 글자 뽑기만 지킨다.** 표를 그리는 것은 구글이고
// (files.preview_file_id · utils.sheetPreviewUrl), 우리 렌더러(SheetView)와 xlsx.js의
// 화면용 코드는 그날 지웠다. 그래서 색·테두리·조건부 서식·그림·틀 고정·열 너비를
// 보던 단정들도 같이 빠졌다 — 지킬 코드가 없는 검사는 다음 사람을 헷갈리게만 한다.
//
// 지금 이 파서의 유일한 사용처는 **첨부 내용 검색**(services/fileText.js)이다.
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
});

check('셀 주소', () => {
  assert.strictEqual(colToNum('A'), 1);
  assert.strictEqual(colToNum('Z'), 26);
  assert.strictEqual(colToNum('AA'), 27);
  assert.deepStrictEqual(refToRC('B3'), { r: 3, c: 2 });
  assert.deepStrictEqual(refToRC('AA12'), { r: 12, c: 27 });
  assert.strictEqual(refToRC('x'), null);
});

// ── 실물 모양의 최소 xlsx ────────────────────────────────────────────────────
// 손으로 만든 것을 zip으로 싸서 넣는다. 실제 드라이브 파일을 레포에 두면 명단·
// 연락처가 커밋에 들어간다(그 파일에 주민등록번호 칸이 있다).
// 압축 없이(stored) 담는다 — 검사에 zip 라이브러리를 들이지 않으려는 것이고,
// 파서의 stored 경로도 같이 지난다.
const book = await parseXlsx(zipOf([
  ['xl/workbook.xml',
    '<workbook><sheets>'
    + '<sheet name="표" sheetId="1" r:id="rId1"/>'
    + '<sheet name="보이는 시트" sheetId="2" state="visible" r:id="rId2"/>'
    + '<sheet name="숨긴 시트" sheetId="3" state="hidden" r:id="rId3"/>'
    + '</sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels',
    '<Relationships>'
    + '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>'
    + '<Relationship Id="rId3" Target="worksheets/sheet3.xml"/>'
    + '</Relationships>'],
  // <rPh>는 한글·일본어 음차 덧말이다 — 안 걷으면 "합ㅎ계"처럼 같은 말이 두 번 붙는다
  ['xl/sharedStrings.xml',
    '<sst><si><t>수입</t></si>'
    + '<si><t>합<rPh sb="0"><t>ㅎ</t></rPh>계</t></si>'
    // 서식 있는 글자(run)는 이어 붙인 전체만 쓴다 — 구간별 색은 이제 안 본다
    + '<si><r><t>(다과) 132,320 / </t></r><r><t>(야식) 365,800 찬조</t></r></si></sst>'],
  ['xl/styles.xml',
    '<styleSheet><numFmts>'
    + '<numFmt numFmtId="176" formatCode="&quot;₩&quot;#,##0_);[Red]\\(&quot;₩&quot;#,##0\\)"/>'
    + '<numFmt numFmtId="177" formatCode="_-* #,##0_-;\\-* #,##0_-;_-* &quot;-&quot;_-;_-@"/>'
    + '<numFmt numFmtId="178" formatCode="mm&quot;/&quot;dd&quot; &quot;ddd"/>'
    + '<numFmt numFmtId="179" formatCode="#,##0"/>'
    + '</numFmts>'
    + '<cellXfs>'
    + '<xf numFmtId="0"/>'      // s=0 General
    + '<xf numFmtId="179"/>'    // s=1 #,##0
    + '<xf numFmtId="176"/>'    // s=2 ₩ · [Red] 괄호 음수
    + '<xf numFmtId="177"/>'    // s=3 회계식(0은 "-")
    + '<xf numFmtId="58"/>'     // s=4 한국어 내장 날짜(m월 d일)
    + '<xf numFmtId="178"/>'    // s=5 요일(ddd)
    + '<xf numFmtId="20"/>'     // s=6 h:mm — 분/월 가르기
    + '<xf numFmtId="49"/>'     // s=7 @ (텍스트 서식이 걸린 숫자)
    + '</cellXfs></styleSheet>'],
  ['xl/worksheets/sheet1.xml',
    '<worksheet><sheetData>'
    + '<row r="2"><c r="A2"/><c r="B2" t="s"><v>0</v></c></row>'
    + '<row r="3"><c r="B3" t="s"><v>1</v></c><c r="C3" s="1"><v>1234567</v></c></row>'
    + '<row r="4"><c r="A4" s="2"><v>9000000</v></c><c r="B4" s="2"><v>-1234</v></c><c r="C4" s="3"><v>0</v></c></row>'
    + '<row r="5"><c r="A5" s="4"><v>46054</v></c><c r="B5" s="5"><v>46054</v></c></row>'
    + '<row r="6"><c r="A6" s="6"><v>46054.5639</v></c><c r="B6" s="7"><v>1235</v></c></row>'
    + '<row r="7"><c r="A7" t="inlineStr"><is><t>줄 안에 쓴 글</t></is></c>'
    +   '<c r="B7" t="b"><v>1</v></c><c r="C7" t="e"><v>#DIV/0!</v></c></row>'
    + '<row r="8" hidden="1"><c r="A8" t="s"><v>0</v></c></row>'
    + '<row r="9"><c r="A9" t="s"><v>2</v></c></row>'
    + '</sheetData></worksheet>'],
  ['xl/worksheets/sheet2.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>'],
  ['xl/worksheets/sheet3.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c></row></sheetData></worksheet>'],
]));
const sheet = book.sheets[0];
// 파서는 원본 열 번호를 그대로 쓴다(A=0) — 검색은 좌표를 안 보므로 당길 이유가 없다
const at = (r, c) => sheet.rows[r]?.[c];
const textOf = (s) => s.rows.flat().filter(Boolean).map(x => x.text).join(' ');

check('시트: 보이는 것만 남고 이름이 실린다', () => {
  // 엑셀은 보이는 시트에 state를 안 적지만 다른 도구(openpyxl·LibreOffice·구글
  // 스프레드시트 내보내기)는 visible을 적어 넣는다. "비어 있지 않으면 숨김"으로 보면
  // 그런 파일은 시트가 **한 장도 없는** 것이 되어 발췌가 통째로 비었다.
  assert.deepStrictEqual(book.sheets.map(s => s.name), ['표', '보이는 시트']);
  const src = readFileSync(new URL('../src/services/xlsx.js', import.meta.url), 'utf8');
  assert.ok(src.includes("hidden: ['hidden', 'veryHidden'].includes(attr(open, 'state') || '')"),
    '숨김 판정이 값 두 개를 보지 않는다');
});

check('공유 문자열: rPh(덧말)를 걷어내고 run은 이어 붙인다', () => {
  assert.strictEqual(at(0, 1).text, '수입');
  assert.strictEqual(at(1, 1).text, '합계', '덧말이 섞여 들어왔다');
  // 숨긴 행(r=8)은 rows에 안 담기므로 그다음 행이 6번이다
  assert.strictEqual(at(6, 0).text, '(다과) 132,320 / (야식) 365,800 찬조');
});

check('숫자 서식: 사람이 보는 모양으로 뽑는다', () => {
  // 검색어는 "16,500,000"이지 16500000이 아니다
  assert.strictEqual(at(1, 2).text, '1,234,567');
  assert.strictEqual(at(2, 0).text, '₩9,000,000', `₩가 사라졌다: ${at(2, 0).text}`);
  assert.strictEqual(at(2, 1).text, '(₩1,234)', `음수 괄호가 아니다: ${at(2, 1).text}`);
  assert.strictEqual(at(2, 2).text, '-', `회계식 0이 "-"가 아니다: ${at(2, 2)?.text}`);
});

check('날짜: 한국어 내장 서식(58)과 요일(ddd)', () => {
  assert.strictEqual(at(3, 0).text, '2월 1일', `일련번호가 날짜로 안 바뀌었다: ${at(3, 0).text}`);
  assert.strictEqual(at(3, 1).text, '02/01 일', `요일이 없다: ${at(3, 1).text}`);
  // 'h:mm'의 mm은 분이다 — 콜론(리터럴)이 h를 잊게 하면 분이 월로 나온다
  // (46054.5639 = 2026-02-01 13:32)
  assert.strictEqual(at(4, 0).text, '13:32', `분이 월로 나온다: ${at(4, 0).text}`);
  // 숫자 셀에 텍스트 서식('@' · 내장 49)이 걸리면 값을 그대로 — 빈 문자열을 돌리면
  // 그 칸이 통째로 사라진다
  assert.strictEqual(at(4, 1).text, '1235', `'@' 서식 셀이 사라졌다: ${at(4, 1)?.text}`);
});

check('셀 종류: inlineStr · 참/거짓 · 오류값', () => {
  assert.strictEqual(at(5, 0).text, '줄 안에 쓴 글');
  assert.strictEqual(at(5, 1).text, 'TRUE');
  assert.strictEqual(at(5, 2).text, '#DIV/0!', '오류값을 버리면 그 칸이 사라진다');
});

check('숨긴 행은 빼고, 빈 칸은 null이다', () => {
  assert.ok(!textOf(sheet).includes('수입 수입'), '숨긴 행이 딸려 왔다');
  assert.strictEqual(at(0, 0), null, '빈 칸은 null이어야 한다(harvest가 건너뛴다)');
});

check('500줄을 채우면 거기서 멈춘다', () => {
  // 끝까지 읽고 나서 자르면 안 읽을 줄까지 훑는다는 뜻이다.
  // 실측(2026-08-28): 6.4MB(6만 줄 × 12열)짜리가 3.3초였다.
  const src = readFileSync(new URL('../src/services/xlsx.js', import.meta.url), 'utf8');
  assert.ok(src.includes('if (rows.length >= MAX_ROWS) break;'), '줄 수 상한에서 안 멈춘다');
});

check('첨부 내용 검색이 이 파서만 쓴다(소스 단정)', () => {
  // 화면용 코드를 지운 뒤 남은 유일한 사용처다. 여기가 바뀌면 이 파일도 같이 봐야 한다.
  const ft = readFileSync(new URL('../src/services/fileText.js', import.meta.url), 'utf8');
  assert.ok(ft.includes("await import('./xlsx.js')"), 'fileText가 파서를 안 부른다');
  const src = readFileSync(new URL('../src/services/xlsx.js', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/formula\.js'/.test(src), '수식 계산기가 아직 붙어 있다(조건부 서식은 지웠다)');
  assert.ok(!/colorOf|sideOf|readDrawings|applyCf/.test(src), '화면용 코드가 남아 있다');
});

console.log(fails ? `\n${fails} FAIL` : '\nall pass');
process.exit(fails ? 1 : 0);
