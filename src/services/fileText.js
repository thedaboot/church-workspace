// ============================================================================
// 첨부 파일에서 글자만 뽑는다 (files.text_excerpt · 0030)
// ----------------------------------------------------------------------------
// **업로드하는 순간에 부른다.** 그때 브라우저가 파일 바이트를 이미 쥐고 있어서
// 추가 다운로드가 없다. 뽑은 글은 AI 요약 프롬프트와 검색이 같이 읽는다.
//
// 파서(xlsx·docx·pptx)와 pdf.js는 **동적으로만** 불러온다 — 메인 번들에 얹히면
// 첨부를 한 번도 안 올리는 사람까지 그 무게를 내려받는다(미리보기가 이미 그렇게 한다).
//
// 그리는 것이 아니라 읽는 것이므로 서식·색·좌표는 버린다. 화면에 그리는 쪽은
// components/SheetView·OfficeView이고 그쪽이 원본이다.
// ============================================================================

export const EXCERPT_MAX = 2000;   // DB에 넣는 상한. 프롬프트 예산과 같은 판단이다.
const PDF_PAGES = 10;              // PDF는 앞 10쪽까지만 훑는다

const extOf = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const PLAIN = ['txt', 'md', 'csv', 'json', 'log'];

// 파서가 돌려준 구조에서 글자만 걷는다. `text`와 `v`(엑셀 셀의 표시값)만 본다 —
// 통째로 훑으면 스타일 이름·경로 같은 것까지 딸려 온다.
function harvest(node, out, seenDepth = 0) {
  if (node == null || seenDepth > 12 || out.len >= EXCERPT_MAX) return;
  if (Array.isArray(node)) { for (const x of node) harvest(x, out, seenDepth + 1); return; }
  if (typeof node !== 'object') return;
  for (const key of ['text', 'v']) {
    const val = node[key];
    if (typeof val === 'string' && val.trim()) {
      out.parts.push(val.trim());
      out.len += val.length + 1;
      if (out.len >= EXCERPT_MAX) return;
    }
  }
  for (const [k, val] of Object.entries(node)) {
    if (k === 'text' || k === 'v' || k === 'images' || k === 'src') continue;
    if (val && typeof val === 'object') harvest(val, out, seenDepth + 1);
  }
}

const collect = (root) => {
  const out = { parts: [], len: 0 };
  harvest(root, out);
  return out.parts.join(' ').slice(0, EXCERPT_MAX);
};

// 뽑지 못하면 빈 문자열을 돌려준다. **절대 던지지 않는다** — 이 값 때문에 업로드가
// 막히면 안 된다(첨부는 되는데 발췌만 없는 편이 낫다).
export async function extractFileText(file) {
  const ext = extOf(file?.name);
  const type = String(file?.type || '');
  try {
    if (PLAIN.includes(ext) || type.startsWith('text/')) {
      return (await file.text()).slice(0, EXCERPT_MAX);
    }
    if (ext === 'xlsx' || ext === 'xlsm') {
      const { parseXlsx } = await import('./xlsx.js');
      const { sheets } = await parseXlsx(await file.arrayBuffer());
      // 시트 이름도 단서다 — "수입/지출"처럼 시트 이름이 곧 항목인 파일이 많다
      return collect(sheets.map(s => ({ text: s.name, rows: s.rows })));
    }
    if (ext === 'docx') {
      const { parseDocx } = await import('./docx.js');
      return collect(await parseDocx(await file.arrayBuffer()));
    }
    if (ext === 'pptx') {
      const { parsePptx } = await import('./pptx.js');
      return collect(await parsePptx(await file.arrayBuffer()));
    }
    if (ext === 'pdf' || type === 'application/pdf') {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const parts = [];
      let len = 0;
      for (let p = 1; p <= Math.min(doc.numPages, PDF_PAGES) && len < EXCERPT_MAX; p++) {
        const content = await (await doc.getPage(p)).getTextContent();
        const line = content.items.map(i => i.str).join(' ').trim();
        if (line) { parts.push(line); len += line.length + 1; }
      }
      return parts.join('\n').slice(0, EXCERPT_MAX);
    }
  } catch (e) {
    // 사진·암호 걸린 문서·깨진 파일은 여기로 온다. 흔한 일이라 조용히 넘긴다.
    console.warn('[fileText] 글자를 뽑지 못했다:', file?.name, e?.message || e);
  }
  return '';   // 사진을 비롯해 뽑을 게 없는 것은 전부 여기
}
