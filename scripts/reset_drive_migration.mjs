// ============================================================================
// 드라이브로 옮긴 것을 되돌린다 (폴더 구조를 바꿀 때만 쓴다)
// ----------------------------------------------------------------------------
//   node scripts/reset_drive_migration.mjs          # 무엇을 되돌릴지만 보여준다
//   node scripts/reset_drive_migration.mjs --go     # 실제로 되돌린다
//
// 하는 일: 드라이브 파일을 **휴지통으로** 보내고, files 행을 source='storage'로
// 돌려 놓는다. Storage 원본(storage_path)을 지우지 않았기 때문에 가능하다 —
// 이관 스크립트가 원본을 남겨 두는 이유가 이것이다.
//
// 언제 쓰나: 폴더 구조를 바꿔서 이미 옮긴 것을 다시 넣어야 할 때.
// 실제로 `프로젝트 / 파일` → `프로젝트 / 업무 / 파일`로 바꾸면서 한 번 썼다
// (드라이브에서 000001.JPG 같은 이름만 잔뜩이라 구분이 안 된다는 지적).
//
// **storage_path가 없는 행은 건드리지 않는다** — 되돌릴 원본이 없다는 뜻이고,
// 그건 이미 Storage를 비운 뒤라는 의미다. 그때는 되돌리면 파일을 잃는다.
// ============================================================================
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const need = ['VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'DRIVE_WEBAPP_URL', 'DRIVE_WEBAPP_TOKEN'];
const missing = need.filter(k => !env[k]);
if (missing.length) { console.error(`.env에 없는 값: ${missing.join(', ')}`); process.exit(1); }

const GO = process.argv.includes('--go');
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const drive = async (payload) => {
  const r = await fetch(env.DRIVE_WEBAPP_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, token: env.DRIVE_WEBAPP_TOKEN }),
  });
  const out = await r.json();
  if (out.error) throw new Error(out.error);
  return out;
};

const { data: rows, error } = await db.from('files')
  .select('id, name, drive_file_id, storage_path')
  .eq('source', 'drive')
  .not('storage_path', 'is', null);
if (error) { console.error('조회 실패:', error); process.exit(1); }

console.log(`되돌릴 파일 ${rows.length}건 (Storage 원본이 남아 있는 것만)`);
if (!GO) { console.log('\n--go 를 붙이면 실제로 되돌립니다.'); process.exit(0); }

let done = 0, failed = 0;
for (const row of rows) {
  try {
    if (row.drive_file_id) {
      // 휴지통으로 — 완전 삭제가 아니라 30일 안에 복구할 수 있다
      try { await drive({ action: 'trash', fileId: row.drive_file_id }); }
      catch (e) { console.error(`  휴지통 이동 실패(계속): ${row.name} — ${e.message || e}`); }
    }
    const { error: upErr } = await db.from('files')
      .update({ source: 'storage', drive_file_id: null, web_view_link: null })
      .eq('id', row.id);
    if (upErr) throw upErr;
    done++;
    if (done % 20 === 0) console.log(`  ${done}/${rows.length}`);
  } catch (e) {
    failed++;
    console.error(`  실패: ${row.name} — ${e.message || e}`);
  }
}
// 프로젝트 폴더 id도 지운다 — 다음 이관이 새 구조로 다시 잡게
await db.from('projects').update({ drive_folder_id: null }).not('drive_folder_id', 'is', null);
await db.from('cards').update({ drive_folder_id: null }).not('drive_folder_id', 'is', null);
console.log(`\n되돌렸습니다 — 성공 ${done}건 · 실패 ${failed}건`);
console.log('이제 node scripts/migrate_to_drive.mjs --go 로 다시 옮기면 됩니다.');
