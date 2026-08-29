// 옛 엑셀 첨부에 **구글 시트 변환 사본**을 붙인다(0031 · files.preview_file_id).
//
// 왜 필요한가: 구글은 .xlsx를 **사람이 열 때** 변환한다. 아무도 안 열어 본 파일은
// 몇 달이 지나도 docs.google.com/spreadsheets/<id>/preview 가 오류를 낸다
// (실측 2026-08-29: 같은 날 올린 두 파일 중 열어 본 것만 떴다). 시간으로 가르던
// 옛 규칙(utils.SHEET_READY_MS 30분)은 전제부터 틀렸다.
//
// 새로 올리는 파일은 Apps Script가 업로드하면서 사본을 만든다. 이 스크립트는
// **그전에 올라간 것**만 훑는다.
//
//   node scripts/backfill_sheet_preview.mjs           읽기만 (무엇을 할지 보여준다)
//   node scripts/backfill_sheet_preview.mjs --fix     실제로 사본을 만들고 DB에 적는다
//
// 되돌리기: 만들어진 사본을 드라이브 휴지통으로 보내고
//   update files set preview_file_id = null where preview_file_id is not null;
// 사본이 없으면 앱은 예전 길(SheetView)로 떨어지므로 화면이 깨지지는 않는다.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

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

// 시트로 그릴 수 있는 것만. 앱의 cloud.js SHEET_EXT와 **같은 목록이어야 한다**
const SHEET_EXT = new Set(['xlsx', 'xlsm', 'csv']);
const extOf = (n) => String(n || '').split('.').pop().toLowerCase();

const { data: rows, error } = await db
  .from('files').select('id, name, drive_file_id, preview_file_id')
  .eq('source', 'drive').is('preview_file_id', null);
if (error) { console.error('DB 조회 실패:', error.message); process.exit(1); }

const targets = (rows || []).filter(r => r.drive_file_id && SHEET_EXT.has(extOf(r.name)));
console.log(`사본이 없는 엑셀·csv 첨부 ${targets.length}건${FIX ? '' : ' (읽기만 — 실제로 만들려면 --fix)'}`);
if (!targets.length) process.exit(0);

let made = 0, failed = 0;
for (const r of targets) {
  if (!FIX) { console.log(`  · ${r.name}`); continue; }
  const out = await call({ action: 'convert', fileId: r.drive_file_id });
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
  console.log(`  됨  ${r.name} → ${out.previewId}`);
}
console.log(FIX ? `\n만든 사본 ${made}건 · 실패 ${failed}건` : '\n--fix 를 붙이면 실제로 만듭니다.');
process.exit(failed ? 1 : 0);
