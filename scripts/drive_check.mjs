// ============================================================================
// 드라이브 ↔ 앱(DB) 맞춰보기
// ----------------------------------------------------------------------------
//   node scripts/drive_check.mjs           # 어긋난 것만 보여준다 (아무것도 안 고침)
//   node scripts/drive_check.mjs --fix     # 고칠 수 있는 것을 고친다
//   node scripts/drive_check.mjs --fix --yes   # 확인 없이
//
// 왜 필요한가: 2026-08-28에 업로드 경로를 손봐서 **앞으로는** 어긋나지 않게 했지만,
// 그 전에 생긴 어긋남은 그대로 남아 있다. 그것을 찾아 맞추는 도구가 없으면
// "드라이브와 워크스페이스 싱크를 맞춰야 한다"는 요구는 절반만 이룬 것이다.
//
// 무엇을 보는가 (업무 폴더 id가 있는 카드만 — 그게 있어야 어디를 볼지 안다):
//   ① 행은 있는데 드라이브에 파일이 없다  → 앱에서 눌러도 안 열리는 유령 첨부
//   ② 드라이브에는 있는데 행이 없다        → 앱에 안 보이는 고아 파일
//   ③ 같은 열쇠(key)를 가진 파일이 둘 이상 → 재시도가 만든 중복
//
// 무엇을 고치는가 (--fix):
//   ① 유령 첨부 → files 행을 지운다 (드라이브에 실체가 없으니 행이 거짓말이다)
//   ③ 중복 → 행이 가리키는 것만 남기고 나머지를 휴지통으로
//   ② 고아 파일은 **건드리지 않는다.** 사람이 손으로 넣어 둔 참고 자료일 수 있고,
//      지우는 쪽이 유실이다. 목록으로만 알린다.
//
// **읽기가 기본이고 --fix는 명시해야 한다.** 지우는 것은 휴지통이라 30일 복구된다.
// 스크립트 v5(list 액션)가 필요하다 — v4면 안내하고 멈춘다.
// ============================================================================
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline/promises';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const need = ['VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'DRIVE_WEBAPP_URL', 'DRIVE_WEBAPP_TOKEN'];
const missing = need.filter(k => !env[k]);
if (missing.length) { console.error(`.env에 없는 값: ${missing.join(', ')}`); process.exit(1); }

const FIX = process.argv.includes('--fix');
const YES = process.argv.includes('--yes');
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

async function drive(body) {
  const r = await fetch(env.DRIVE_WEBAPP_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token: env.DRIVE_WEBAPP_TOKEN }), redirect: 'follow',
  });
  const text = await r.text();
  let out; try { out = JSON.parse(text); } catch { throw new Error(`드라이브 응답을 읽지 못했어요: ${text.slice(0, 120)}`); }
  if (out.error) throw new Error(out.error);
  return out;
}

// ── 스크립트 버전 확인 ──────────────────────────────────────────────────────
// v4에는 list가 없다. 없는 채로 진행하면 "드라이브에 아무것도 없다"고 오판해
// 멀쩡한 행을 지우려 들 수 있다 — 그건 유실이다.
try {
  await drive({ action: 'list', folderId: 'this-id-does-not-exist' });
} catch (e) {
  if (/unknown action/i.test(e.message)) {
    console.error('드라이브 스크립트가 아직 v4입니다 — list 액션이 없어요.');
    console.error('docs/DRIVE.md의 v5 코드로 바꾸고 [배포 관리 → 편집 → 새 버전]으로 다시 배포해주세요.');
    process.exit(1);
  }
  // 없는 폴더 id는 v5가 { files: [] }로 돌려주므로 여기 오지 않는다. 다른 오류면 알린다.
  console.error('드라이브에 닿지 못했어요:', e.message);
  process.exit(1);
}

// ── 자료 모으기 ─────────────────────────────────────────────────────────────
const { data: cards, error: ce } = await db
  .from('cards').select('id, title, project_id, drive_folder_id')
  .not('drive_folder_id', 'is', null);
if (ce) { console.error('업무 조회 실패:', ce.message); process.exit(1); }

const { data: files, error: fe } = await db
  .from('files').select('id, name, card_id, drive_file_id, preview_file_id, source');
if (fe) { console.error('첨부 조회 실패:', fe.message); process.exit(1); }

const byCard = new Map();
for (const f of files) {
  if (f.source !== 'drive' || !f.drive_file_id) continue;
  if (!byCard.has(f.card_id)) byCard.set(f.card_id, []);
  byCard.get(f.card_id).push(f);
}

// 폴더 id가 없는 카드의 드라이브 첨부 — 어디를 봐야 할지 모른다(점검 밖)
const cardIds = new Set(cards.map(c => c.id));
const unknown = [...byCard.entries()].filter(([id]) => !cardIds.has(id));

console.log(`업무 ${cards.length}개(폴더 id 있음) · 드라이브 첨부 ${[...byCard.values()].flat().length}건을 봅니다.\n`);

const ghosts = [];      // ① 행은 있는데 파일 없음
const orphans = [];     // ② 파일은 있는데 행 없음
const dupes = [];       // ③ 같은 열쇠 중복

for (const card of cards) {
  let listed;
  try { listed = await drive({ action: 'list', folderId: card.drive_folder_id }); }
  catch (e) { console.log(`  ! ${card.title} — 폴더를 못 읽었어요 (${e.message})`); continue; }
  const inDrive = listed.files || [];
  const rows = byCard.get(card.id) || [];
  const driveIds = new Set(inDrive.map(f => f.id));
  // 변환 사본((표) — 0031)도 우리 파일이다. 고아로 세면 엑셀 첨부마다 한 줄씩 뜬다.
  const rowIds = new Set(rows.flatMap(r => [r.drive_file_id, r.preview_file_id]).filter(Boolean));

  for (const r of rows) if (!driveIds.has(r.drive_file_id)) ghosts.push({ card, row: r });
  for (const f of inDrive) if (!rowIds.has(f.id)) orphans.push({ card, file: f });

  // 같은 열쇠가 둘 이상 = 재시도가 만든 중복. 행이 가리키는 것을 남긴다.
  const byKey = new Map();
  for (const f of inDrive) {
    if (!f.key) continue;
    if (!byKey.has(f.key)) byKey.set(f.key, []);
    byKey.get(f.key).push(f);
  }
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const keep = group.find(f => rowIds.has(f.id)) || group[0];
    dupes.push({ card, key, keep, drop: group.filter(f => f.id !== keep.id) });
  }
}

// ── 보고 ────────────────────────────────────────────────────────────────────
const line = (n, label) => `${String(n).padStart(4)}건  ${label}`;
console.log('─'.repeat(58));
console.log(line(ghosts.length, '① 앱에는 있는데 드라이브에 파일이 없음 (유령 첨부)'));
console.log(line(orphans.length, '② 드라이브에는 있는데 앱에 안 보임 (고아 파일)'));
console.log(line(dupes.reduce((a, d) => a + d.drop.length, 0), '③ 같은 열쇠 중복'));
if (unknown.length) console.log(line(unknown.length, '· 폴더 id가 없는 업무 — 점검 밖(파일을 올린 적이 없거나 예전 것)'));
console.log('─'.repeat(58));

for (const g of ghosts) console.log(`  ① ${g.card.title} / ${g.row.name}`);
for (const o of orphans) console.log(`  ② ${o.card.title} / ${o.file.name}  ${o.file.url}`);
for (const d of dupes) console.log(`  ③ ${d.card.title} / ${d.keep.name} — ${d.drop.length}개 남음`);

if (!ghosts.length && !orphans.length && !dupes.length) {
  console.log('\n어긋난 것이 없습니다.');
  process.exit(0);
}

if (!FIX) {
  console.log('\n고치려면 --fix 를 붙여 다시 돌려주세요.');
  console.log('②(고아 파일)는 --fix로도 건드리지 않습니다 — 사람이 넣어 둔 것일 수 있어요.');
  process.exit(0);
}

// ── 고치기 ──────────────────────────────────────────────────────────────────
const willDelete = ghosts.length;
const willTrash = dupes.reduce((a, d) => a + d.drop.length, 0);
if (!YES) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(`\n행 ${willDelete}건을 지우고 파일 ${willTrash}건을 휴지통으로 보냅니다. 진행할까요? (y/N) `);
  rl.close();
  if (ans.trim().toLowerCase() !== 'y') { console.log('그만둡니다.'); process.exit(0); }
}

let done = 0;
for (const g of ghosts) {
  const { error } = await db.from('files').delete().eq('id', g.row.id);
  if (error) console.log(`  ! 행 삭제 실패 ${g.row.name}: ${error.message}`);
  else { done++; console.log(`  ✓ 유령 첨부 행 삭제: ${g.card.title} / ${g.row.name}`); }
}
for (const d of dupes) {
  for (const f of d.drop) {
    try { await drive({ action: 'trash', fileId: f.id }); done++; console.log(`  ✓ 중복 휴지통: ${d.card.title} / ${f.name}`); }
    catch (e) { console.log(`  ! 휴지통 실패 ${f.name}: ${e.message}`); }
  }
}
console.log(`\n${done}건 정리했습니다. 휴지통에 간 파일은 30일 안에 되돌릴 수 있어요.`);
if (orphans.length) console.log(`고아 파일 ${orphans.length}건은 그대로 뒀습니다 — 위 목록을 보고 판단해주세요.`);
