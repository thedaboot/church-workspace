import { zipEntries, readBytes, readEntry, blocks, attrs, unesc, relTargets, relsPathOf } from './ooxml.js';
import { zipStore } from './zipWrite.js';

// ============================================================================
// xlsx 쓰기 (v5 3묶음 · 시안 mock/b4) — 두 갈래
// ----------------------------------------------------------------------------
//   fillClubReport(template, form)  동아리 활동 보고서 **양식 그대로** 칸을 채운다(src/assets/club-report-template.xlsx ·
//                                    사용자 양식 `동아리_활동보고서.xlsx`). 양식의 글꼴·테두리·칸 폭은 손대지 않고 값 칸만
//                                    바꾼다 — 양식 칸 자리(B3 · D3 · B4~B7 · B8 · C8)는 아래 CELLS 한 곳. 사진·영수증은
//                                    '활동결과물 및 지원비영수증 첨부'(9행) 아래에 두 장씩 놓는다(양식에 이미 이어진 빈 그림판 drawing1).
//   readClubReport(buf)             거꾸로 — 올린 보고서 엑셀에서 칸 넷과 그림을 읽는다(작성 화면 채우기 · 사용자 요청 2026-10-22).
//                                    칸은 자리가 아니라 **A열 이름**으로 찾는다(손으로 쓴 양식은 행이 밀린다) · 보고서가 아니면 null.
//   buildWorkbook(sheets)           연말 보고처럼 표 여러 장을 새로 만든다(머리 줄 굵게 · 칸 폭 · 숫자는 숫자 칸).
// 보고서의 원본은 앱의 작성 화면이다(사용자 결정 2026-10-21) — 저장할 때마다 이 파일을 새로 만들어 보고서 칸을 덮는다.
// DOM을 쓰지 않는다(사진 크기는 부르는 쪽이 재서 넘긴다) — 노드에서 그대로 검사한다(§3-5).
// ============================================================================

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// XML 1.0에 못 드는 제어 문자는 뺀다(붙여 넣은 글에 섞여 오면 엑셀이 파일을 '복구'한다)
const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const inlineCell = (ref, s, text) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(clean(text))}</t></is></c>`;
const numCell = (ref, s, n) => `<c r="${ref}"${s != null ? ` s="${s}"` : ''}><v>${Number(n) || 0}</v></c>`;

// 'YYYY-MM-DD' → 엑셀 날짜 일련번호(1899-12-30 기준 · 양식의 D3는 'yyyy년 mm월 dd일' 서식이라 숫자로 넣는다)
export function excelDate(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
}

// 칸 높이 — 줄바꿈 칸(B4~B7 · 병합 B:D)에 든 글이 몇 줄이 될지 어림한다(한글 2 · 그 밖 1 단위 · 한 줄 76단위 ≈ 한글 38자)
const LINE_UNITS = 76;
export function lineCount(text) {
  return clean(text).split('\n').reduce((n, para) => {
    let u = 0;
    for (const ch of para) u += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 2 : 1;
    return n + Math.max(1, Math.ceil(u / LINE_UNITS));
  }, 0);
}
const rowHeight = (base, text) => Math.max(base, lineCount(text) * 16 + 10);

// 양식의 값 칸(시트 XML의 그 칸을 통째로 바꾼다 · s는 양식의 칸 모양 번호 — 11은 줄바꿈 켠 B5·B6과 같은 모양)
const CELLS = {
  club: ['B3', 4], date: ['D3', 6], attendees: ['B4', 11], activity: ['B5', 11], plan: ['B6', 11], usage: ['B7', 11],
  amount: ['B8', 14], account: ['C8', 15],
};
const BASE_HT = { 4: 24, 5: 34.5, 6: 34.5, 7: 22.5 };

// 참석자 칸 — 양식의 'O명 / OOO, OOO, ...' 모양
export const attendeesText = (names = []) => `${names.length}명 / ${names.join(', ')}`;
// 지원금액 칸 — 양식의 'OOO원 (5,000원/1인)' 모양
export const SUPPORT_PER_PERSON = 5000;
export const amountText = (n) => `${(Number(n) || 0).toLocaleString('ko-KR')}원 (${SUPPORT_PER_PERSON.toLocaleString('ko-KR')}원/1인)`;

// ── 그림 ────────────────────────────────────────────────────────────────────
const EMU = 9525;                 // 1px
const ROW_PX = 32;                // 10행부터 양식의 행 높이(24pt)
const PIC_W = 340;                // 한 장 최대 폭(두 장이 A~D 폭 약 708px에 나란히)
const PIC_H = 300;
const RIGHT_COL_OFF = 191;        // 오른쪽 장 = B열 시작(169px) + 191px → 360px
const fit = (w, h) => {
  const k = Math.min(1, PIC_W / (w || PIC_W), PIC_H / (h || PIC_H));
  return [Math.max(1, Math.round((w || PIC_W) * k)), Math.max(1, Math.round((h || PIC_H) * k))];
};
const anchor = (id, rel, col, colOff, row, w, h) => `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${colOff * EMU}</xdr:colOff>`
  + `<xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${w * EMU}" cy="${h * EMU}"/>`
  + `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Picture ${id}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>`
  + `<xdr:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
  + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;

// 사진 자리 — 묶음(활동 사진 · 영수증)마다 이름 한 줄 + 두 장씩. 돌려주는 것: 그림 줄 · 이름 칸(행 번호 1부터)
export function layoutPictures(groups, startRow = 10) {
  const pics = [];
  const labels = [];
  let row = startRow;            // 1부터 센 행
  for (const g of groups) {
    if (!g.items?.length) continue;
    labels.push({ row, text: g.label });
    row += 1;
    for (let i = 0; i < g.items.length; i += 2) {
      const pair = g.items.slice(i, i + 2).map(it => ({ it, size: fit(it.w, it.h) }));
      pair.forEach(({ it, size }, k) => pics.push({ it, row, col: k ? 1 : 0, colOff: k ? RIGHT_COL_OFF : 0, w: size[0], h: size[1] }));
      row += Math.ceil(Math.max(...pair.map(p => p.size[1])) / ROW_PX) + 1;
    }
  }
  return { pics, labels, endRow: row };
}

const EXT_TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

// form: { club, date('YYYY-MM-DD'), attendees[이름], activity, plan, usage, amount(원), account,
//         photos[{ bytes, ext, w, h }], receipts[같은 모양] }
export async function fillClubReport(template, form) {
  const entries = zipEntries(template, '보고서 양식');
  const out = new Map();
  for (const name of entries.keys()) out.set(name, await readBytes(entries, name));
  const dec = new TextDecoder();
  let sheet = dec.decode(out.get('xl/worksheets/sheet1.xml'));

  const values = {
    club: form.club, attendees: attendeesText(form.attendees || []), activity: form.activity, plan: form.plan, usage: form.usage,
    amount: amountText(form.amount), account: form.account,
  };
  const put = (ref, xml) => {
    const re = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
    sheet = re.test(sheet) ? sheet.replace(re, xml) : sheet;
  };
  for (const [k, [ref, s]] of Object.entries(CELLS)) {
    if (k === 'date') { const n = excelDate(form.date); if (n != null) put(ref, numCell(ref, s, n)); continue; }
    put(ref, inlineCell(ref, s, values[k] || ''));
  }
  // 글이 길면 그 행을 늘린다(양식 높이보다 낮추지는 않는다)
  for (const [r, base] of Object.entries(BASE_HT)) {
    const text = { 4: values.attendees, 5: values.activity, 6: values.plan, 7: values.usage }[r];
    sheet = sheet.replace(new RegExp(`<row r="${r}" ht="[^"]*"`), `<row r="${r}" ht="${rowHeight(base, text)}"`);
  }

  // 사진·영수증
  const { pics, labels } = layoutPictures([
    { label: '활동 사진', items: form.photos || [] },
    { label: '지원비 영수증', items: form.receipts || [] },
  ]);
  for (const l of labels) put(`A${l.row}`, inlineCell(`A${l.row}`, 2, l.text));
  if (pics.length) {
    const rels = [];
    const exts = new Set();
    const body = pics.map((p, i) => {
      const ext = String(p.it.ext || 'jpg').toLowerCase().replace('jpeg', 'jpg');
      exts.add(ext);
      const file = `image${i + 1}.${ext}`;
      out.set(`xl/media/${file}`, p.it.bytes);
      rels.push(`<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${file}"/>`);
      return anchor(i + 2, `rIdImg${i + 1}`, p.col, p.colOff, p.row - 1, p.w, p.h);
    }).join('');
    let drawing = dec.decode(out.get('xl/drawings/drawing1.xml'));
    drawing = drawing.replace(/<xdr:wsDr([^>]*)\/>/, '<xdr:wsDr$1></xdr:wsDr>').replace('</xdr:wsDr>', `${body}</xdr:wsDr>`);
    out.set('xl/drawings/drawing1.xml', drawing);
    out.set('xl/drawings/_rels/drawing1.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
    let types = dec.decode(out.get('[Content_Types].xml'));
    for (const ext of exts) {
      if (!new RegExp(`Extension="${ext}"`, 'i').test(types)) {
        types = types.replace('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
          `$&<Default ContentType="${EXT_TYPE[ext] || 'image/jpeg'}" Extension="${ext}"/>`);
      }
    }
    out.set('[Content_Types].xml', types);
  }
  out.set('xl/worksheets/sheet1.xml', sheet);
  return zipStore([...out.entries()].map(([name, data]) => ({ name, data })));
}

// ── 읽기(fillClubReport의 거꾸로) ───────────────────────────────────────────
// 돌려주는 것: { activity, plan, usage, account, photos[{ bytes, ext }], receipts[같은 모양], sorted } | null('활동 내용' 이름이 없으면).
// 그림은 첫 시트의 그림판에서 위→아래 · 왼→오 차례. A열에 '지원비 영수증' 이름 줄(우리가 만든 엑셀)이 있으면 그 아래는 영수증,
// 없으면(손으로 만든 엑셀) 모두 활동 사진이고 sorted=false — 화면이 '영수증 선택' 시트로 사람에게 고르게 한다(사용자 승인 시안 A-1 2026-10-22).
const LABELS = { activity: '활동 내용', plan: '차기 활동계획', usage: '지원비 사용내용', amount: '지원금액 및 계좌번호' };
const squash = (s) => String(s || '').replace(/\s+/g, '');
const tidy = (s) => String(s || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trimEnd()).join('\n').trim();
export async function readClubReport(buf) {
  const entries = zipEntries(buf, '엑셀 파일');
  const wbRels = relTargets(await readEntry(entries, 'xl/_rels/workbook.xml.rels'), 'xl');
  const first = [...blocks(await readEntry(entries, 'xl/workbook.xml'), 'sheet')][0];
  const sheetPath = (first && wbRels[attrs(first.open)['r:id']]) || 'xl/worksheets/sheet1.xml';
  const shared = [...blocks(await readEntry(entries, 'xl/sharedStrings.xml'), 'si')]
    .map(({ inner }) => unesc([...inner.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')));
  const sheet = await readEntry(entries, sheetPath);
  const cell = new Map();   // 'B5' → 글자
  for (const { open, inner } of blocks(sheet, 'c')) {
    const a = attrs(open);
    const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    const text = a.t === 's' ? shared[Number(v)] : a.t === 'inlineStr'
      ? unesc([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')) : v != null ? unesc(v) : '';
    if (a.r && text) cell.set(a.r, text);
  }
  const rowOf = (label) => [...cell].find(([ref, t]) => /^A\d+$/.test(ref) && squash(t) === squash(label))?.[0].slice(1) || null;
  const r = Object.fromEntries(Object.entries(LABELS).map(([k, l]) => [k, rowOf(l)]));
  if (!r.activity) return null;
  const at = (col, row) => (row ? tidy(cell.get(`${col}${row}`)) : '');

  // 그림 — 시트 rels → 그림판 → 그림판 rels → xl/media
  const pics = [];
  const sheetDir = sheetPath.replace(/\/[^/]+$/, '');
  const drawPath = Object.values(relTargets(await readEntry(entries, relsPathOf(sheetPath)), sheetDir)).find(t => /drawings\/[^/]+\.xml$/.test(t));
  if (drawPath) {
    const media = relTargets(await readEntry(entries, relsPathOf(drawPath)), drawPath.replace(/\/[^/]+$/, ''));
    const drawing = await readEntry(entries, drawPath);
    for (const kind of ['oneCellAnchor', 'twoCellAnchor', 'absoluteAnchor']) {
      for (const { inner } of blocks(drawing, `xdr:${kind}`)) {
        const id = (inner.match(/r:embed="([^"]+)"/) || [])[1];
        const path = id && media[id];
        if (!path) continue;
        const from = inner.match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
        const bytes = await readBytes(entries, path);
        if (bytes) pics.push({ bytes, ext: path.split('.').pop().toLowerCase(), row: from ? +from[2] + 1 : 0, col: from ? +from[1] : 0 });
      }
    }
  }
  pics.sort((a, b) => a.row - b.row || a.col - b.col);
  const cut = Number(rowOf('지원비 영수증')) || Infinity;
  const strip = ({ bytes, ext }) => ({ bytes, ext });
  return {
    activity: at('B', r.activity), plan: at('B', r.plan), usage: at('B', r.usage), account: at('C', r.amount),
    photos: pics.filter(p => p.row <= cut).map(strip), receipts: pics.filter(p => p.row > cut).map(strip),
    sorted: cut !== Infinity,   // 영수증이 이미 갈라져 있다(우리 엑셀) — 아니면 부르는 쪽이 사람에게 고르게 한다
  };
}

// ── 새 통합 문서 ────────────────────────────────────────────────────────────
// sheets: [{ name, rows: [[값…]…](첫 줄이 머리), widths?: [글자 폭…] }] — 숫자는 숫자 칸, 나머지는 글 칸
const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const sheetName = (s, i) => (String(s || `시트${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `시트${i + 1}`);

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F6"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left/><right/><top/><bottom style="thin"><color rgb="FFC9CFD9"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

// align: 칸마다 'left' | 'right' — 머리 줄과 값 줄이 같은 쪽에 선다(사용자 지적 2026-10-21 · 숫자 칸은 머리도 오른쪽)
function sheetXml({ rows = [], widths = [], align = [] }) {
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
    const ref = `${colName(c)}${r + 1}`;
    if (v == null || v === '') return '';
    const right = align[c] === 'right';
    if (r === 0) return inlineCell(ref, right ? 4 : 1, v);
    if (typeof v === 'number' && Number.isFinite(v)) return numCell(ref, 2, v);
    return inlineCell(ref, String(v).includes('\n') ? 3 : right ? 5 : 0, v);
  }).join('')}</row>`).join('');
  const freeze = rows.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${body}</sheetData></worksheet>`;
}

export function buildWorkbook(sheets = []) {
  const list = sheets.length ? sheets : [{ name: '시트1', rows: [] }];
  const names = list.map((s, i) => sheetName(s.name, i));
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zipStore(files);
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
