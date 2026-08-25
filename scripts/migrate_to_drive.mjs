// ============================================================================
// 기존 첨부를 Supabase Storage → 개인 구글 드라이브로 옮긴다 (1회 실행)
// ----------------------------------------------------------------------------
//   node scripts/migrate_to_drive.mjs            # 무엇을 옮길지만 보여준다
//   node scripts/migrate_to_drive.mjs --go       # 실제로 옮긴다
//   node scripts/migrate_to_drive.mjs --go --limit 5   # 몇 건만 먼저
//
// .env에서 읽는 값: SUPABASE_DB_URL 대신 VITE_SUPABASE_URL + SUPABASE_SECRET_KEY
// (RLS를 우회해야 하고, Storage에서 내려받아야 한다), DRIVE_WEBAPP_URL/TOKEN.
//
// 한 건씩 처리하고 **행을 즉시 갱신한다.** 중간에 끊겨도 다시 돌리면 남은 것만
// 이어서 한다(source='storage'인 행만 고른다). 이관 중에도 서비스는 정상이다 —
// 읽기 경로가 행 단위로 갈라지므로 절반은 Storage, 절반은 드라이브여도 된다.
//
// **Storage 객체는 지우지 않는다.** 사용자가 눈으로 확인한 뒤 따로 지우는 편이
// 안전하다(맨 아래 안내 참고). 이 스크립트가 지우면 되돌릴 방법이 없다.
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
if (missing.length) {
  console.error(`.env에 없는 값: ${missing.join(', ')}`);
  process.exit(1);
}

const GO = process.argv.includes('--go');
const li = process.argv.indexOf('--limit');
const LIMIT = li >= 0 ? Number(process.argv[li + 1]) || 0 : 0;

const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const BUCKET = 'attachments';

const drive = async (payload) => {
  const r = await fetch(env.DRIVE_WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, token: env.DRIVE_WEBAPP_TOKEN }),
  });
  const out = await r.json();
  if (out.error) throw new Error(out.error);
  return out;
};

// ── 옮길 것 모으기 ──────────────────────────────────────────────────────────
const { data: rows, error } = await db
  .from('files')
  .select('id, name, mime_type, size_bytes, storage_path, project_id, card_id, source')
  .eq('source', 'storage')
  .not('storage_path', 'is', null)
  .order('created_at', { ascending: true });
if (error) { console.error('files 조회 실패:', error); process.exit(1); }

const { data: projects } = await db.from('projects').select('id, name, drive_folder_id');
const projById = new Map((projects || []).map(p => [p.id, p]));
// 업무 제목 — 드라이브에서 `프로젝트 / 업무 / 파일`로 훑어보기 위해서다.
// 파일 이름이 000001.JPG 같아서 구분이 안 된다는 지적에서 나왔다.
const { data: cards } = await db.from('cards').select('id, title, drive_folder_id');
const cardById = new Map((cards || []).map(c => [c.id, c]));

const targets = LIMIT ? rows.slice(0, LIMIT) : rows;
const totalMB = targets.reduce((a, r) => a + (r.size_bytes || 0), 0) / 1024 / 1024;

console.log(`옮길 파일 ${targets.length}건 · 합계 ${totalMB.toFixed(1)}MB`);
const byProject = new Map();
for (const r of targets) {
  const key = projById.get(r.project_id)?.name || '기타';
  byProject.set(key, (byProject.get(key) || 0) + 1);
}
for (const [name, n] of [...byProject].sort((a, b) => b[1] - a[1])) console.log(`  ${name}: ${n}건`);

if (!GO) {
  console.log('\n--go 를 붙이면 실제로 옮깁니다. 몇 건만 먼저 해보려면 --go --limit 5');
  process.exit(0);
}

// ── 한 건씩 ─────────────────────────────────────────────────────────────────
// 프로젝트 폴더는 처음 한 번만 만든다. 같은 프로젝트의 다음 파일부터는 id로 넣어야
// 이름이 같은 폴더가 여러 개 생기지 않는다.
const folderCache = new Map();
const cardFolderCache = new Map();
let done = 0, failed = 0;

for (const row of targets) {
  const proj = projById.get(row.project_id);
  const projectName = proj?.name || '기타';
  try {
    let folderId = folderCache.get(row.project_id) || proj?.drive_folder_id || null;

    const dl = await db.storage.from(BUCKET).download(row.storage_path);
    if (!dl.data && !dl.error) throw new Error('Storage에서 파일을 받지 못했습니다');
    if (dl.error) throw dl.error;
    const buf = Buffer.from(await dl.data.arrayBuffer());

    // 업무 폴더를 이미 안다면 그 폴더에 바로 넣는다(cardTitle을 보내면 그 안에
    // 또 같은 이름 폴더를 판다). 모르면 만들게 하고 id를 적어 둔다(0026).
    const card = cardById.get(row.card_id);
    const cardFolderId = cardFolderCache.get(row.card_id) || card?.drive_folder_id || null;
    const up = await drive({
      action: 'upload', projectName,
      folderId: cardFolderId || folderId || undefined,
      cardTitle: cardFolderId ? undefined : (card?.title || '기타'),
      name: row.name, mimeType: row.mime_type || undefined,
      dataBase64: buf.toString('base64'),
    });
    if (!cardFolderId && up.folderId) {
      cardFolderCache.set(row.card_id, up.folderId);
      await db.from('cards').update({ drive_folder_id: up.folderId }).eq('id', row.card_id);
    }

    // up.folderId는 이제 **업무 폴더**다. 프로젝트 폴더는 따로 확보해 둔다 —
    // 안 그러면 프로젝트마다 이름으로 다시 찾게 되고, 이름이 바뀌면 갈라진다.
    if (!folderId) {
      const ef = await drive({ action: 'ensureFolder', projectName });
      if (ef.folderId) {
        folderId = ef.folderId;
        folderCache.set(row.project_id, folderId);
        await db.from('projects').update({ drive_folder_id: folderId }).eq('id', row.project_id);
      }
    }

    // 행을 즉시 갱신한다 — 여기서 끊겨도 다음 실행이 이어서 한다.
    // storage_path는 **남겨 둔다**: 확인이 끝나기 전에 지우면 되돌릴 길이 없다.
    const { error: upErr } = await db.from('files')
      .update({ source: 'drive', drive_file_id: up.id, web_view_link: up.url })
      .eq('id', row.id);
    if (upErr) throw upErr;

    done++;
    console.log(`  [${done}/${targets.length}] ${projectName} / ${row.name}`);
  } catch (e) {
    failed++;
    console.error(`  실패: ${projectName} / ${row.name} — ${e.message || e}`);
  }
}

console.log(`\n끝났습니다 — 성공 ${done}건 · 실패 ${failed}건`);
console.log(`
남은 일 (사용자 확인 후):
  1. 앱에서 첨부가 제대로 열리는지·썸네일이 뜨는지 본다
  2. 괜찮으면 Storage 객체를 지운다. files.storage_path는 그때 같이 비운다:
       update files set storage_path = null where source = 'drive';
     (Storage 객체 삭제는 Supabase 대시보드 또는 별도 스크립트로)
  3. 실패한 건이 있으면 다시 돌린다 — source='storage'인 것만 다시 시도한다`);
