// ============================================================================
// 옛 업무 본문을 같이 쓰기 스냅샷으로 채운다 (0084 card_docs)
// ----------------------------------------------------------------------------
//   node scripts/seed-card-docs.mjs --dry-run    # 읽기만 — 채울 카드 수·글자 수를 센다
//   node scripts/seed-card-docs.mjs              # 본문이 있고 card_docs 줄이 없는 카드마다 스냅샷 한 줄
//
// 하지 않아도 앱은 돈다 — 처음 여는 사람이 그 자리에서 심는다(core.loadDoc). 미리 채우는 까닭은
// 처음 여는 순간의 심기 경주(두 사람이 동시에)를 아예 없애고, 여는 속도를 한 번 줄이기 위해서다.
// 심는 식은 앱과 **같은 함수·같은 스키마**다(core.seedState · editorSchema.bodySchema) — 다르면
// 편집기가 심은 노드를 버린다.
//
// 넣기는 `on conflict do nothing`이다 — 도는 사이에 누가 그 카드를 열어 먼저 심었으면 그쪽이 이긴다.
// 서버 키라 RLS 밖이고, 그래서 심기 함수(card_doc_seed · is_approved() 확인)를 거치지 않고 표에 바로 넣는다.
//
// .env에서 읽는 값: VITE_SUPABASE_URL + SUPABASE_SECRET_KEY(서버 키)
// 되돌리기: delete from public.card_docs where upto = 0 and card_id not in (select card_id from public.card_doc_updates);
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seedState, toB64 } from '../src/services/coedit/core.js';
import { bodySchema } from '../src/services/editorSchema.js';

const ROOT = new URL('../', import.meta.url);

function readEnv() {
  const file = fileURLToPath(new URL('.env', ROOT));
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
}

// 채울 줄 — 본문이 있고 아직 스냅샷이 없는 카드만(순수 · tests/coedit가 본다)
export function seedRows(cards, haveIds, schema = bodySchema()) {
  const have = new Set(haveIds);
  return cards
    .filter(c => c.description && String(c.description).trim() && !have.has(c.id))
    .map(c => ({ card_id: c.id, state: toB64(seedState(c.description, schema)), upto: 0 }));
}

async function readAll(db, table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function main() {
  const DRY = process.argv.includes('--dry-run');
  const env = readEnv();
  for (const k of ['VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!env[k]) { console.error(`.env에 ${k}가 없습니다.`); process.exit(1); }
  }
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

  const cards = await readAll(db, 'cards', 'id, description');
  let docs;
  try { docs = await readAll(db, 'card_docs', 'card_id'); }
  catch (e) {
    console.error(e.message);
    console.error('0084를 먼저 적용하세요: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0084_card_coedit.sql');
    process.exit(1);
  }
  const rows = seedRows(cards, docs.map(d => d.card_id));
  const chars = rows.reduce((s, r) => s + r.state.length, 0);
  console.log(`카드 ${cards.length} · 이미 스냅샷 ${docs.length} · 채울 것 ${rows.length} (base64 ${chars.toLocaleString()}자)`);
  if (DRY || !rows.length) { if (DRY) console.log('(--dry-run — 아무것도 쓰지 않았습니다)'); return; }

  let put = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { data, error } = await db.from('card_docs')
      .upsert(chunk, { onConflict: 'card_id', ignoreDuplicates: true }).select('card_id');
    if (error) throw error;
    put += data.length;
  }
  console.log(`넣음 ${put} · 그사이 누가 먼저 심어 건너뜀 ${rows.length - put}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
