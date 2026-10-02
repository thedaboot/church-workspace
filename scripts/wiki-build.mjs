// 더다붓 위키 만들기 — 로컬에서 한 번 돌린다(크론과 같은 한 벌 · api/_wikiBuild.js · 0088)
//   node scripts/wiki-build.mjs              바뀐 장만(원본 해시가 다른 것) + 자주 묻는 질문 + 밤 다시 묻기
//   node scripts/wiki-build.mjs --force      해시를 보지 않고 전부 다시
//   node scripts/wiki-build.mjs --only=sermon,p:<id>   그 장만
//   node scripts/wiki-build.mjs --dry        모델을 부르지 않고 장 뼈대와 조각 수만 본다(DB에 쓰지 않는다)
// .env의 VITE_SUPABASE_URL · SUPABASE_SECRET_KEY · GEMINI_API_KEY를 쓴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').replace(/\r/g, '').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const { buildWiki, gather, skeletons, srcHashOf } = await import('../api/_wikiBuild.js');

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const arg = (k) => process.argv.find(a => a.startsWith(`--${k}`));
const only = arg('only')?.split('=')[1]?.split(',').filter(Boolean) || null;

if (arg('dry')) {
  const D = await gather(db);
  for (const p of skeletons(D)) {
    const snips = p.blocks.reduce((n, b) => n + (b.snips || []).length, 0);
    console.log(`${p.grp} · ${p.title} (${p.id}) — 블록 ${p.blocks.length} · 조각 ${snips} · 기록 ${p.source_count} · ${srcHashOf(p).slice(0, 8)}`);
    for (const b of p.blocks) console.log(`   [${b.type}] ${b.title || b.key}${b.snips ? ` · 조각 ${b.snips.length}` : ''}${b.items?.length ? ` · 줄 ${b.items.length}` : ''}${b.rows ? ` · 행 ${b.rows.length}` : ''}`);
  }
} else {
  const out = await buildWiki(db, { force: !!arg('force'), only, budgetMs: 15 * 60 * 1000 });
  console.log(JSON.stringify({ ...out, dropped: Object.fromEntries(Object.entries(out.dropped).map(([k, v]) => [k, v.length])) }, null, 1));
  const dumped = path.join(os.tmpdir(), 'wiki-dropped.json');   // 걸러 낸 문장(레포 밖) — 프롬프트를 고칠 때 본다
  fs.writeFileSync(dumped, JSON.stringify(out.dropped, null, 2));
  console.log('걸러 낸 문장:', dumped);
  const { reaskUnknown } = await import('../api/_wikiAsk.js');
  if (!only) console.log('다시 묻기', JSON.stringify(await reaskUnknown(db, { budgetMs: 5 * 60 * 1000 })));
}
