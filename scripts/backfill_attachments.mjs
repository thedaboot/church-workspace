// ============================================================================
// 옛 첨부에 **글자 발췌**를 붙인다 (files.text_excerpt · 0030 · 2026-09-24에 256건 채움)
// ----------------------------------------------------------------------------
//   node scripts/backfill_attachments.mjs                   # 읽기만 — 무엇을 할지 세어 보여준다
//   node scripts/backfill_attachments.mjs --fix             # 실제로 뽑아 DB에 적는다
//   node scripts/backfill_attachments.mjs --fix --limit 5   # 앞 5건만
//   node scripts/backfill_attachments.mjs --fix --redo      # 이미 있는 발췌도 다시
//   node scripts/backfill_attachments.mjs --only doc|photo  # 문서만 · 사진만
//
// .env에서 읽는 값: VITE_SUPABASE_URL + SUPABASE_SECRET_KEY(RLS를 우회해 모든 행을 읽고 쓴다),
// GEMINI_API_KEY(사진·글자 없는 PDF를 읽힌다).
//
// 새로 올리는 파일은 올리는 순간 브라우저가 뽑는다(services/fileText.js). 이 스크립트는
// 그전에 올라간 것, 그리고 브라우저가 뽑을 수 없는 것(사진 · 글자 없는 PDF)만 훑는다.
//   문서(xlsx·docx·pptx·pdf·txt·html) → 앱과 같은 파서로 앞 2000자
//   글자가 안 나온 PDF · 사진          → Gemini가 본 것을 한국어로(보이는 글자는 그대로 옮긴다)
// **사진 캡션은 이 스크립트만 만든다** — 앱은 새로 올리는 사진에 캡션을 만들지 않는다.
// 캡션에는 `[사진] ` 접두가 붙는다(AI 프롬프트가 문서 발췌를 먼저 싣는 데 쓴다 · services/ai.js).
//
// '글인가'(읽히는 글자 60% 이상 · 이상한 기호 5% 이하)는 앱과 같은 services/textQuality.js다.
// 여기서만 더 거는 것: 20자 이상 · **한글 30자 이상**. 이 워크스페이스 문서는 한국어라, 화음
// 글자만 남은 콘티 PDF를 Gemini로 넘기는 기준이다(앱에는 걸지 않는다 — 영어 문서를 비운다).
//
// 바이트는 드라이브 공개 주소(uc?export=download)에서 받는다 — api/drive-file.js와 같은 길.
// 되돌리기: update files set text_excerpt = null where text_excerpt like '[사진] %';
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { textStats, looksLikeText, htmlToText } from '../src/services/textQuality.js';

const FIX = process.argv.includes('--fix');
const REDO = process.argv.includes('--redo');
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity;
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null; // 'doc' | 'photo'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
for (const k of ['VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GEMINI_API_KEY']) {
  if (!env[k]) { console.error(`.env에 ${k}가 없습니다.`); process.exit(1); }
}
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const EXCERPT_MAX = 2000;      // fileText.js와 같은 상한
const PDF_PAGES = 10;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';
const MAX_INLINE = 19 * 1024 * 1024;   // Gemini inline 상한 20MB 아래

// 파서가 뽑은 것을 그대로 쓸까, Gemini에게 보일까. 비율 규칙은 앱과 한 벌(textQuality)이고
// 20자·한글 30자는 이 스크립트만의 기준이다(위 머리말).
const HANGUL_MIN = 30;
const readableDoc = (t) => looksLikeText(t, { minLength: 20 }) && textStats(t).hangul >= HANGUL_MIN;
const extOf = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

// ── 드라이브에서 바이트 받기 ──────────────────────────────────────────────────
async function download(id) {
  const r = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, { redirect: 'follow' });
  if (!r.ok) throw new Error(`drive ${r.status}`);
  const type = r.headers.get('content-type') || '';
  const disp = r.headers.get('content-disposition') || '';
  if (type.startsWith('text/html') && !/attachment/i.test(disp)) {
    // 큰 파일의 바이러스 검사 경고 페이지 — confirm 토큰을 따라간다
    const html = await r.text();
    const m = html.match(/confirm=([0-9A-Za-z_-]+)/) || html.match(/name="confirm" value="([^"]+)"/);
    const uuid = html.match(/name="uuid" value="([^"]+)"/)?.[1];
    if (!m) throw new Error('drive: 경고 페이지에서 confirm을 찾지 못함');
    const url = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=${m[1]}${uuid ? `&uuid=${uuid}` : ''}`;
    const r2 = await fetch(url, { redirect: 'follow' });
    if (!r2.ok) throw new Error(`drive confirm ${r2.status}`);
    return Buffer.from(await r2.arrayBuffer());
  }
  return Buffer.from(await r.arrayBuffer());
}

// ── 문서 파서 (앱과 같은 모듈) ──────────────────────────────────────────────
function harvest(node, out, depth = 0) {
  if (node == null || depth > 12 || out.len >= EXCERPT_MAX) return;
  if (Array.isArray(node)) { for (const x of node) harvest(x, out, depth + 1); return; }
  if (typeof node !== 'object') return;
  for (const key of ['text', 'v']) {
    const val = node[key];
    if (typeof val === 'string' && val.trim()) { out.parts.push(val.trim()); out.len += val.length + 1; if (out.len >= EXCERPT_MAX) return; }
  }
  for (const [k, val] of Object.entries(node)) {
    if (k === 'text' || k === 'v' || k === 'images' || k === 'src') continue;
    if (val && typeof val === 'object') harvest(val, out, depth + 1);
  }
}
const collect = (root) => { const out = { parts: [], len: 0 }; harvest(root, out); return out.parts.join(' ').slice(0, EXCERPT_MAX); };

async function extractDoc(name, buf) {
  const ext = extOf(name);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (['txt', 'md', 'csv', 'json', 'log', 'html', 'htm'].includes(ext)) {
    const t = buf.toString('utf8');
    // HTML은 앱과 같은 걷기(textQuality.htmlToText) — 태그·스타일·스크립트가 발췌를 먼저 채우지 않게
    return (ext === 'html' || ext === 'htm' ? htmlToText(t) : t).slice(0, EXCERPT_MAX);
  }
  if (ext === 'xlsx' || ext === 'xlsm') {
    const { parseXlsx } = await import('../src/services/xlsx.js');
    const { sheets } = await parseXlsx(ab);
    return collect(sheets.map(s => ({ text: s.name, rows: s.rows })));
  }
  if (ext === 'docx') { const { parseDocx } = await import('../src/services/docx.js'); return collect(await parseDocx(ab)); }
  if (ext === 'pptx') { const { parsePptx } = await import('../src/services/pptx.js'); return collect(await parsePptx(ab)); }
  if (ext === 'pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    // 노드의 pdf.js는 cMapUrl을 **파일 경로**로 읽고(fs.readFile) 끝이 '/'여야 한다 —
    // 윈도 경로의 역슬래시는 받지 않아 슬래시로 바꾼다(한글 PDF에 필요)
    const cMapUrl = fileURLToPath(new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url)).replace(/\\/g, '/');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(ab), useSystemFonts: true, isEvalSupported: false, cMapUrl, cMapPacked: true }).promise;
    const parts = []; let len = 0;
    for (let p = 1; p <= Math.min(doc.numPages, PDF_PAGES) && len < EXCERPT_MAX; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      const line = content.items.map(i => i.str).join(' ').trim();
      if (line) { parts.push(line); len += line.length + 1; }
    }
    return parts.join('\n').slice(0, EXCERPT_MAX);
  }
  return '';
}

// ── Gemini가 보는 길 (사진 · 글자 없는 PDF) ──────────────────────────────────
const PHOTO_PROMPT = [
  '이 파일은 교회 청년부 워크스페이스의 업무 첨부다. 나중에 검색하고 AI가 업무 맥락으로 읽을 수 있게 내용을 한국어로 적어라.',
  '- 사진이면: 무엇을 찍은 것인지(장소·행사·물건·장면), 사람은 대략 몇 명인지, 화면·현수막·자막·문서에 보이는 글자는 그대로 옮겨 적는다. 2~4문장.',
  '- 문서(PDF)면: 제목과 담긴 내용을 요약하고, 곡 제목·순서·일정·이름처럼 검색될 만한 낱말은 그대로 남긴다. 최대 600자.',
  '- 사람 이름은 짓지 말고, 보이는 글자에 있을 때만 적는다. 추측은 "~로 보인다"라고 쓴다.',
  '- 문장 안에서 엠 대시(—)나 엔 대시(–)는 절대 쓰지 마라. 필요하면 일반 하이픈(-)을 써라.',
  '- 머리말·설명 없이 본문만 답한다.',
].join('\n');

async function describeWithGemini(mime, buf, attempt = 0) {
  if (buf.length > MAX_INLINE) return '';
  const payload = {
    contents: [{ parts: [{ inline_data: { mime_type: mime, data: buf.toString('base64') } }, { text: PHOTO_PROMPT }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 700 },
  };
  const r = await fetch(GEMINI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(payload) });
  if (r.status === 429 || r.status >= 500) {
    if (attempt >= 5) throw new Error(`gemini ${r.status}`);
    const wait = 3000 * 2 ** attempt;
    await new Promise(res => setTimeout(res, wait));
    return describeWithGemini(mime, buf, attempt + 1);
  }
  const j = await r.json();
  if (!r.ok) throw new Error(`gemini ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return (j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '').trim().replace(/[—–]/g, '-');
}

// ── 본체 ─────────────────────────────────────────────────────────────────────
let q = db.from('files').select('id, name, mime_type, size_bytes, drive_file_id, text_excerpt, card_id, service_id').eq('source', 'drive').order('created_at');
if (!REDO) q = q.is('text_excerpt', null);
const { data: rows, error } = await q;
if (error) { console.error('DB 조회 실패:', error.message); process.exit(1); }

const isPhoto = (r) => String(r.mime_type || '').startsWith('image/');
let targets = (rows || []).filter(r => r.drive_file_id).filter(r => !ONLY || (ONLY === 'photo' ? isPhoto(r) : !isPhoto(r)));
// 문서를 먼저 — 수가 적고 값이 크다
targets.sort((a, b) => Number(isPhoto(a)) - Number(isPhoto(b)));
targets = targets.slice(0, LIMIT);

const nDoc = targets.filter(r => !isPhoto(r)).length, nPhoto = targets.length - nDoc;
console.log(`발췌가 없는 첨부 ${targets.length}건 (문서 ${nDoc} · 사진 ${nPhoto})${FIX ? '' : ' — 읽기만. 실제로 적으려면 --fix'}`);
if (!FIX) { for (const r of targets) console.log(`  ${isPhoto(r) ? '사진' : '문서'}  ${(r.size_bytes / 1024 / 1024).toFixed(1)}MB  ${r.name}`); process.exit(0); }

let done = 0, failed = 0, empty = 0;
const CONCURRENCY = 3;
async function one(r) {
  const tag = `${isPhoto(r) ? '사진' : '문서'} ${r.name}`;
  try {
    const buf = await download(r.drive_file_id);
    let text = '';
    let how = 'parser';
    if (!isPhoto(r)) text = await extractDoc(r.name, buf).catch(e => { console.warn(`  [파서 실패] ${r.name}: ${e.message}`); return ''; });
    // 파서가 뽑은 것이 글이 아니면(콘티 PDF처럼 악보·그림에서 나온 부스러기) Gemini가 본다
    if (!readableDoc(text) && (isPhoto(r) || extOf(r.name) === 'pdf')) {
      const mime = isPhoto(r) ? (r.mime_type || 'image/jpeg') : 'application/pdf';
      text = await describeWithGemini(mime, buf);
      how = 'gemini';
      if (text) text = (isPhoto(r) ? '[사진] ' : '') + text;
    }
    text = text.slice(0, EXCERPT_MAX);
    if (!text) { empty++; console.log(`  (빈) ${tag}`); return; }
    const { error: e2 } = await db.from('files').update({ text_excerpt: text }).eq('id', r.id);
    if (e2) throw e2;
    done++;
    console.log(`  ✓ ${tag}  [${how}] ${text.slice(0, 70).replace(/\n/g, ' ')}${text.length > 70 ? '…' : ''}`);
  } catch (e) {
    failed++;
    console.warn(`  ✗ ${tag}: ${e.message || e}`);
  }
}
const queue = [...targets];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await one(queue.shift()); }));
console.log(`\n적음 ${done} · 빈 ${empty} · 실패 ${failed}`);
