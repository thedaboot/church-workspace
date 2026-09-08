// 옛 오피스 첨부에 **구글 변환 사본**을 붙인다(0031 · files.preview_file_id).
// 엑셀은 구글 시트로, 워드는 구글 문서로, PPT는 구글 슬라이드로.
//
// 왜 필요한가: 구글은 오피스 파일을 **사람이 열 때** 변환한다. 아무도 안 열어 본 파일은
// 몇 달이 지나도 docs.google.com/…/preview 가 오류를 낸다(실측 2026-08-29: 같은 날 올린
// 두 파일 중 열어 본 것만 떴다). 시간으로 가르던 옛 규칙(utils.SHEET_READY_MS 30분)은
// 전제부터 틀렸다.
//
// 새로 올리는 파일은 앱이 올린 직후 스스로 사본을 만든다(cloud.attachPreviewCopy).
// 이 스크립트는 **그전에 올라간 것**만 훑는다.
//
//   node scripts/backfill_sheet_preview.mjs           읽기만 (무엇을 할지 보여준다)
//   node scripts/backfill_sheet_preview.mjs --fix     실제로 사본을 만들고 DB에 적는다
//
// **스크립트가 v8 미만이면 워드·PPT는 건너뛴다.** v7의 convert 액션은 종류를 안 보고
// 시트 사본을 만들어서, 워드를 보내면 글자가 표 칸에 흩어진 사본이 생기고 그게
// preview_file_id에 박혀 첨부가 그 꼴로 열린다. 되돌리려면 사본을 지우고 칸을 비워야
// 하므로, 아예 안 만드는 쪽이 맞다. 버전은 스크립트가 **답마다 실어 보낸다**(v8부터).
//
// 되돌리기: 만들어진 사본을 드라이브 휴지통으로 보내고
//   update files set preview_file_id = null where preview_file_id is not null;
// 사본이 없으면 앱은 예전 길(우리 렌더러)로 떨어지므로 화면이 깨지지는 않는다.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
// 어떤 확장자에 어떤 사본을 만드는지는 **앱과 한 벌**이다 — 여기 따로 목록을 들면
// 새 확장자를 붙일 때 한쪽만 고쳐진다.
import { previewCopyOf } from '../src/services/previewKind.js';

const FIX = process.argv.includes('--fix');
const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));

for (const k of ['VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'DRIVE_WEBAPP_URL', 'DRIVE_WEBAPP_TOKEN']) {
  if (!env[k]) { console.error(`.env에 ${k}가 없습니다.`); process.exit(1); }
}

const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const call = async (payload) => {
  const r = await fetch(env.DRIVE_WEBAPP_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: env.DRIVE_WEBAPP_TOKEN, ...payload }),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { error: `JSON 아님 (${r.status}): ${t.slice(0, 160)}` }; }
};

// ── 스크립트 버전부터 읽는다 ────────────────────────────────────────────────
// 버전을 물어보는 액션은 따로 없다(액션을 늘리면 api/drive.js의 허용 목록까지
// 넓혀야 한다). v8부터는 **모든 답**에 version이 실려 오므로 아무 읽기 요청이나
// 하나 던져서 본다. 없는 폴더 id를 주면 v7·v8 둘 다 { files: [] }로 답한다.
const probe = await call({ action: 'list', folderId: 'this-id-does-not-exist' });
if (probe.error) { console.error('드라이브에 닿지 못했어요:', probe.error); process.exit(1); }
const VERSION = Number(probe.version || 0);   // v7 이하는 이 칸이 없다
console.log(`드라이브 스크립트 v${VERSION || '7 이하'}`);

const { data: rows, error } = await db
  .from('files').select('id, name, drive_file_id, preview_file_id')
  .eq('source', 'drive').is('preview_file_id', null);
if (error) { console.error('DB 조회 실패:', error.message); process.exit(1); }

const KIND_LABEL = { spreadsheet: '표', document: '문서', presentation: '슬라이드' };
const all = (rows || [])
  .filter(r => r.drive_file_id)
  .map(r => ({ ...r, kind: previewCopyOf(r.name) }))
  .filter(r => r.kind);

// v8 미만에서는 엑셀만. 워드·PPT는 세어서 알리기만 한다.
const targets = all.filter(r => r.kind === 'spreadsheet' || VERSION >= 8);
const held = all.length - targets.length;

console.log(`사본이 없는 첨부 ${targets.length}건${FIX ? '' : ' (읽기만 — 실제로 만들려면 --fix)'}`);
if (held) {
  console.log(`워드·PPT ${held}건은 건너뜁니다 — 스크립트를 v8로 올린 뒤 다시 돌려주세요.`);
  console.log('(v7에 보내면 글자가 표 칸에 흩어진 시트 사본이 생깁니다. docs/APPS_SCRIPT_v8.md)');
}
if (!targets.length) process.exit(0);

let made = 0, failed = 0;
for (const r of targets) {
  if (!FIX) { console.log(`  · [${KIND_LABEL[r.kind]}] ${r.name}`); continue; }
  // name을 같이 보내면 스크립트가 파일을 다시 묻지 않는다. 폴더는 우리가 모르므로
  // 스크립트가 원본의 부모를 찾아 쓴다(사본은 언제나 원본과 같은 폴더에 만든다).
  const out = await call({ action: 'convert', fileId: r.drive_file_id, name: r.name, convertTo: r.kind });
  if (out.error || !out.previewId) {
    failed++;
    console.log(`  실패  ${r.name} — ${out.error || '사본을 못 만들었어요'}`);
    continue;
  }
  const { error: upErr } = await db.from('files').update({ preview_file_id: out.previewId }).eq('id', r.id);
  if (upErr) {
    // 드라이브에는 사본이 생겼는데 DB에 못 적었다 — 다음 실행이 또 만들면 사본이 둘이 된다.
    // 그래서 **id를 남긴다**. 손으로 적어 넣거나 그 사본을 지우면 된다.
    failed++;
    console.log(`  DB 실패  ${r.name} — 사본 ${out.previewId} 가 드라이브에 남았습니다: ${upErr.message}`);
    continue;
  }
  made++;
  console.log(`  됨  [${KIND_LABEL[r.kind]}] ${r.name} → ${out.previewId}`);
}
console.log(FIX ? `\n만든 사본 ${made}건 · 실패 ${failed}건` : '\n--fix 를 붙이면 실제로 만듭니다.');
process.exit(failed ? 1 : 0);
