// ============================================================================
// 업무·댓글·첨부를 조각마다 임베딩해 doc_vec(0074)에 맞춘다 — 전체·증분 한 벌 (배치 E4)
// ----------------------------------------------------------------------------
//   node scripts/embed-docs.mjs --dry-run              # 읽기만 — 조각 수·글자·토큰·비용을 센다
//   node scripts/embed-docs.mjs                        # 바뀐 조각만 임베딩해 넣고, 줄어든 조각은 지운다
//   node scripts/embed-docs.mjs --kind file            # 한 종류만(card | comment | file)
//
// 하는 일은 api/_docsync.js의 syncDocVectors 그대로다 — 8시 크론(api/push.js)과 `?job=embed`가 같은 것을
// 시간 예산(40초) 안에서 돌리고, 이 스크립트는 예산 없이 끝까지 돈다(처음 채울 때 · 크론이 밀렸을 때).
// 조각 글의 sha256이 열쇠라 두 번 돌려도 두 번째는 할 일이 0이다. 지운 원본은 FK cascade가 따라 지운다.
//
// .env에서 읽는 값: VITE_SUPABASE_URL + SUPABASE_SECRET_KEY(서버 키 — doc_vec에는 클라이언트 쓰기
// 권한이 없다) · GEMINI_API_KEY(임베딩 · 드라이런에서는 토큰 세기만).
//
// 되돌리기: truncate public.doc_vec;   (표까지 지우려면 0074 맨 아래 주석)
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EMBED_MODEL } from '../api/ai.js';
import { syncDocVectors, KINDS, PRICE_PER_M_TOKENS, EMBED_BATCH } from '../api/_docsync.js';

const ROOT = new URL('../', import.meta.url);
const COUNT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:countTokens`;
const TOKEN_SAMPLE = 100;

function readEnv() {
  const file = fileURLToPath(new URL('.env', ROOT));
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
}

// 표본 조각의 실제 토큰 수로 글자당 토큰을 잰다(countTokens는 과금되지 않는다)
async function tokensPerChar(texts, key) {
  const sample = texts.slice(0, TOKEN_SAMPLE);
  if (!sample.length || !key) return null;
  const r = await fetch(COUNT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: sample.map(text => ({ parts: [{ text }] })) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.totalTokens) return null;
  return j.totalTokens / sample.reduce((s, t) => s + t.length, 0);
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const DRY = argv.includes('--dry-run');
  const KIND = opt('--kind');
  if (KIND && !KINDS.includes(KIND)) { console.error(`--kind는 ${KINDS.join(' | ')} 중 하나입니다.`); process.exit(1); }
  const kinds = KIND ? [KIND] : KINDS;

  const env = readEnv();
  for (const k of ['VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY', ...(DRY ? [] : ['GEMINI_API_KEY'])]) {
    if (!env[k]) { console.error(`.env에 ${k}가 없습니다.`); process.exit(1); }
  }
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

  let s;
  try {
    s = await syncDocVectors(db, { geminiKey: env.GEMINI_API_KEY, budgetMs: Infinity, dryRun: DRY, kinds, log: console.log });
  } catch (e) {
    console.error(e.message);
    if (/doc_vec/.test(e.message)) console.error('0074를 먼저 적용하세요: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0074_doc_vec.sql');
    process.exit(1);
  }

  console.log(`${DRY ? '드라이런 — DB에 아무것도 쓰지 않는다' : '끝'} · ${kinds.join(', ')}${s.missingTable ? ' · (doc_vec이 아직 없어 빈 표로 셈)' : ''}`);
  for (const [k, b] of Object.entries(s.byKind)) {
    console.log(`  ${k.padEnd(7)} 원본 ${String(b.sources).padStart(4)} · 조각 ${String(b.chunks).padStart(4)} · ${b.chars.toLocaleString().padStart(7)}자 · 새로 임베딩 ${b.embed}`);
  }
  console.log(`  합계 조각 ${s.docs} · doc_vec에 있던 행 ${s.existing} · 임베딩할 것 ${s.embed}(${s.chars.toLocaleString()}자 · 요청 ${Math.ceil(s.embed / EMBED_BATCH)}번)`);

  if (DRY) {
    const texts = s.plan.embed.map(d => d.body);
    const perChar = await tokensPerChar(texts, env.GEMINI_API_KEY);
    const allChars = Object.values(s.byKind).reduce((n, b) => n + b.chars, 0);
    if (perChar) {
      const tok = Math.round(s.chars * perChar), all = Math.round(allChars * perChar);
      console.log(`  토큰: 표본 ${Math.min(texts.length, TOKEN_SAMPLE)}조각에서 글자당 ${perChar.toFixed(3)}`);
      console.log(`  이번 임베딩 약 ${tok.toLocaleString()}토큰 ≈ $${(tok / 1e6 * PRICE_PER_M_TOKENS).toFixed(4)} · 전체를 새로 하면 약 ${all.toLocaleString()}토큰 ≈ $${(all / 1e6 * PRICE_PER_M_TOKENS).toFixed(4)}`);
    } else {
      console.log('  토큰: 세지 못했다(GEMINI_API_KEY 없음 또는 오류)');
    }
    console.log(`  지울 조각 ${s.plan.drop.length} · 프로젝트만 고칠 조각 ${s.plan.move.length}`);
    const longest = [...s.plan.embed].sort((a, b) => b.body.length - a.body.length)[0];
    if (longest) console.log(`  가장 긴 조각 ${longest.body.length}자: ${longest.body.slice(0, 60).replace(/\n/g, ' ⏎ ')}…`);
  } else {
    console.log(`  넣음 ${s.embedded} · 지움 ${s.dropped} · 프로젝트 고침 ${s.moved} · 남음 ${s.remaining} · ${(s.ms / 1000).toFixed(1)}초${s.stopped ? ` · 멈춤: ${s.stopped}` : ''}`);
    const { count } = await db.from('doc_vec').select('id', { count: 'exact', head: true });
    console.log(`  doc_vec ${count ?? '(세지 못함)'}행`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
