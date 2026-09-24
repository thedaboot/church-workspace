// ============================================================================
// 성경 전체를 절 단위로 임베딩해 bible_vec(0073)에 넣는다 — **로컬에서 한 번만** (배치 E2)
// ----------------------------------------------------------------------------
//   node scripts/embed-bible.mjs --dry-run            # 고르게 뽑은 200절만 임베딩 · 아무것도 안 쓴다
//   node scripts/embed-bible.mjs                      # 전부(이미 들어간 ref는 건너뛴다 — 이어하기)
//   node scripts/embed-bible.mjs --limit 500          # 새로 넣을 것 중 앞 500절만
//   node scripts/embed-bible.mjs --book gen           # 한 권만(index.json의 id)
//
// .env에서 읽는 값: GEMINI_API_KEY(전부) · VITE_SUPABASE_URL + SUPABASE_SECRET_KEY(실제 넣을 때만 —
// 서비스 키라 RLS를 우회한다. bible_vec에는 클라이언트 쓰기 정책이 없다).
//
// 왜 로컬인가: 크론·서버 함수는 시간 제한(30~60초)을 넘는다. 성경 본문은 바뀌지 않으므로
// 한 번 채우면 끝이다. 본문 데이터를 갈아 끼우면(public/bible · bible.js의 CACHE_NAME을 올릴 때)
// `truncate public.bible_vec;` 뒤 다시 돌린다.
//
// 넣는 것
//   · ref  = bibleRef.formatRef — '창세기 1:1'(화면 라벨과 같은 모양이고 parseRef가 다시 읽는다)
//   · 임베딩할 글 = '<책 이름> <장>:<절> <본문>' = `${ref} ${body}` — 책·장 이름이 벡터에 들어가야
//     '시편에서 위로'처럼 책을 부르는 질문이 걸린다.
//   · '(없음)'·'(N절에 포함되어 있음)'처럼 편집 표기뿐인 36절은 뺀다 — 내용이 없어 어느 질문에도
//     엉뚱하게 가까워질 수 있다. 괄호로 감싼 **진짜 본문**(신 3:9 같은)은 넣는다.
//   · 벡터는 **단위 길이로 맞춰서** 넣는다(api/ai.js unitVec · 질문 쪽과 한 벌). 모델·차원도
//     api/ai.js의 EMBED_MODEL·EMBED_DIM을 그대로 가져온다.
//
// 비용·시간(2026-09-24 --dry-run으로 잰 값은 NOTES-E.md):
//   31,067절 · 2,054,191자 → 토큰 약 1.52M(글자당 0.74 · countTokens로 잰 비율) × $0.15/1M ≈ **$0.23 한 번**.
//   요청은 100절씩 311번. 한 번에 2.5초 안팎(초당 약 38절)이라 **15분 남짓**(429가 나면 기다렸다 다시 한다).
//
// 되돌리기: truncate public.bible_vec;   (표까지 지우려면 0073 맨 아래 주석)
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatRef } from '../src/services/bibleRef.js';
import { EMBED_MODEL, EMBED_DIM, unitVec } from '../api/ai.js';

export const TASK_TYPE = 'RETRIEVAL_DOCUMENT';
export const EMBED_BATCH = 100;      // batchEmbedContents 한 번에 담는 요청 수(API 상한 100)
export const UPSERT_BATCH = 500;     // DB에 한 번에 넣는 행 수(한 번에 약 4MB)
export const DRY_SAMPLE = 200;
export const PRICE_PER_M_TOKENS = 0.15;   // gemini-embedding-001 입력 1M 토큰당(유료 등급 · 2026-09)
const BATCH_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;
const COUNT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:countTokens`;

// 편집 표기뿐인 절(public/bible/README.md '남겨 둔 표기')
export const PLACEHOLDER_RE = /^\((없음|\d+절에 포함되어 있음)\)$/;

const ROOT = new URL('../', import.meta.url);

// public/bible → [{ book, chapter, verse, ref, body }] (정경 순서). book을 주면 그 권만.
export function loadVerses({ book = null, root = ROOT } = {}) {
  const books = JSON.parse(readFileSync(new URL('public/bible/index.json', root), 'utf8'));
  const out = [];
  for (const b of books) {
    if (book && b.id !== book) continue;
    const data = JSON.parse(readFileSync(new URL(`public/bible/${b.id}.json`, root), 'utf8'));
    data.chapters.forEach((verses, ci) => verses.forEach((raw, vi) => {
      const body = String(raw || '').trim();
      if (!body || PLACEHOLDER_RE.test(body)) return;
      const chapter = ci + 1, verse = vi + 1;
      const ref = formatRef({ bookId: b.id, start: { chapter, verse }, end: { chapter, verse } }, books);
      out.push({ book: b.id, chapter, verse, ref, body });
    }));
  }
  if (book && !out.length) throw new Error(`모르는 책 id: ${book}`);
  return out;
}

// 임베딩할 글 — '<책 이름> <장>:<절> <본문>'
export const docText = (row) => `${row.ref} ${row.body}`;

export const docRequests = (rows) => rows.map(row => ({
  model: `models/${EMBED_MODEL}`,
  content: { parts: [{ text: docText(row) }] },
  taskType: TASK_TYPE,
  outputDimensionality: EMBED_DIM,
}));

// halfvec 입력 글자 — halfvec은 유효 숫자가 3자리 남짓이라 소수 여섯째 자리면 넉넉하다
export const vecLiteral = (vec) => `[${vec.map(x => x.toFixed(6)).join(',')}]`;

// 고르게 n개 — 창세기만 뽑히지 않게 전체에서 같은 간격으로
export function spreadSample(rows, n) {
  if (rows.length <= n) return rows.slice();
  const step = rows.length / n;
  return Array.from({ length: n }, (_, i) => rows[Math.floor(i * step)]);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 429·5xx·네트워크 오류는 기다렸다 다시. 400대(429 제외)는 요청이 틀린 것이라 바로 던진다.
// 구글이 RetryInfo(retryDelay '23s')를 주면 그만큼 기다린다.
async function withRetry(label, fn, tries = 8) {
  let wait = 2000;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const retryable = e.retryable !== false;
      if (!retryable || i >= tries) throw e;
      const ms = e.retryAfterMs || wait;
      console.warn(`  ${label}: ${e.message} — ${Math.round(ms / 1000)}초 뒤 다시 (${i}/${tries - 1})`);
      await sleep(ms);
      wait = Math.min(wait * 2, 60000);
    }
  }
}

async function postJson(url, key, body) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
  } catch (e) {
    const err = new Error(`네트워크 ${e.message}`); err.retryable = true; throw err;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status} ${j.error?.message?.slice(0, 160) || ''}`);
    err.retryable = r.status === 429 || r.status >= 500;
    const delay = (j.error?.details || []).find(d => d.retryDelay)?.retryDelay;
    if (delay) err.retryAfterMs = Math.ceil(parseFloat(delay) * 1000) + 500;
    throw err;
  }
  return j;
}

// rows(최대 100) → 단위 길이 벡터 배열(같은 순서). 원래 길이도 돌려준다(드라이런 보고용).
export async function embedRows(rows, key) {
  const j = await withRetry('임베딩', () => postJson(BATCH_URL, key, { requests: docRequests(rows) }));
  const embs = j.embeddings || [];
  if (embs.length !== rows.length) throw new Error(`임베딩 개수가 다르다: ${embs.length} ≠ ${rows.length}`);
  return embs.map((e, i) => {
    const v = e.values;
    if (!Array.isArray(v) || v.length !== EMBED_DIM) throw new Error(`${rows[i].ref}: 차원 ${v?.length} ≠ ${EMBED_DIM}`);
    return { raw: Math.hypot(...v), vec: unitVec(v) };
  });
}

function readEnv() {
  const file = fileURLToPath(new URL('.env', ROOT));
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
}

async function dryRun(verses, key) {
  const sample = spreadSample(verses, DRY_SAMPLE);
  console.log(`드라이런 — ${verses.length}절 중 ${sample.length}절 (DB에 아무것도 쓰지 않는다)`);
  const t0 = Date.now();
  const got = [];
  for (let i = 0; i < sample.length; i += EMBED_BATCH) got.push(...await embedRows(sample.slice(i, i + EMBED_BATCH), key));
  const sec = (Date.now() - t0) / 1000;
  const raws = got.map(g => g.raw);
  const units = got.map(g => Math.hypot(...g.vec));
  const tok = await withRetry('토큰 세기', () => postJson(COUNT_URL, key, { contents: sample.map(r => ({ parts: [{ text: docText(r) }] })) }));
  const sampleChars = sample.reduce((s, r) => s + docText(r).length, 0);
  const allChars = verses.reduce((s, r) => s + docText(r).length, 0);
  const perChar = tok.totalTokens / sampleChars;
  const allTokens = Math.round(allChars * perChar);
  const rate = sample.length / sec;
  console.log(`  모델 ${EMBED_MODEL} · ${TASK_TYPE} · 차원 ${got[0].vec.length}(전부 ${EMBED_DIM}: ${got.every(g => g.vec.length === EMBED_DIM)})`);
  console.log(`  받은 길이 ${Math.min(...raws).toFixed(3)}~${Math.max(...raws).toFixed(3)} → 맞춘 뒤 ${Math.min(...units).toFixed(6)}~${Math.max(...units).toFixed(6)}`);
  console.log(`  ${sample.length}절 ${sec.toFixed(1)}초 = 초당 ${rate.toFixed(0)}절 (요청 ${Math.ceil(sample.length / EMBED_BATCH)}번)`);
  console.log(`  토큰: 표본 ${tok.totalTokens} / ${sampleChars}자 = 글자당 ${perChar.toFixed(3)}`);
  console.log(`  전체 추정: ${verses.length}절 · ${allChars.toLocaleString()}자 · 토큰 약 ${allTokens.toLocaleString()} · 약 $${(allTokens / 1e6 * PRICE_PER_M_TOKENS).toFixed(2)} · 약 ${Math.ceil(verses.length / rate / 60)}분(429·DB 쓰기 제외)`);
  console.log(`  넣을 한 줄 예: ${sample[0].ref} | ${docText(sample[0]).slice(0, 40)}… | ${vecLiteral(got[0].vec).slice(0, 40)}…`);
}

async function fullRun(verses, env, limit) {
  const { createClient } = await import('@supabase/supabase-js');
  for (const k of ['VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY']) if (!env[k]) { console.error(`.env에 ${k}가 없습니다.`); process.exit(1); }
  const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

  // 이미 들어간 ref — 1000행씩(PostgREST 기본 상한) 끝까지
  const have = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('bible_vec').select('ref').order('ref').range(from, from + 999);
    if (error) {
      console.error(`bible_vec을 읽지 못했습니다(${error.code || ''} ${error.message}).`);
      console.error('0073을 먼저 적용하세요: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0073_bible_vec.sql');
      process.exit(1);
    }
    for (const r of data) have.add(r.ref);
    if (data.length < 1000) break;
  }
  const todo = verses.filter(v => !have.has(v.ref)).slice(0, limit);
  console.log(`대상 ${verses.length}절 · 이미 있음 ${have.size} · 이번에 ${todo.length}절`);
  if (!todo.length) return;

  const t0 = Date.now();
  let done = 0;
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    const rows = buf; buf = [];
    await withRetry('DB 쓰기', async () => {
      const { error } = await db.from('bible_vec').upsert(rows, { onConflict: 'ref' });
      if (error) { const e = new Error(`${error.code || ''} ${error.message}`); e.retryable = true; throw e; }
    }, 5);
    done += rows.length;
    const sec = (Date.now() - t0) / 1000;
    const eta = (todo.length - done) / (done / sec);
    console.log(`  ${done}/${todo.length} · 초당 ${(done / sec).toFixed(0)}절 · 남은 약 ${Math.ceil(eta / 60)}분 · 마지막 ${rows[rows.length - 1].ref}`);
  };
  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const chunk = todo.slice(i, i + EMBED_BATCH);
    const got = await embedRows(chunk, env.GEMINI_API_KEY);
    chunk.forEach((row, j) => buf.push({ ...row, vec: vecLiteral(got[j].vec) }));
    if (buf.length >= UPSERT_BATCH) await flush();
  }
  await flush();

  const { count, error } = await db.from('bible_vec').select('ref', { count: 'exact', head: true });
  console.log(`끝 — ${((Date.now() - t0) / 60000).toFixed(1)}분 · bible_vec ${error ? '(세지 못함)' : count}행 (대상 ${verses.length}절)`);
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const DRY = argv.includes('--dry-run');
  const LIMIT = Number(opt('--limit')) || Infinity;
  const BOOK = opt('--book');

  const env = readEnv();
  if (!env.GEMINI_API_KEY) { console.error('.env에 GEMINI_API_KEY가 없습니다.'); process.exit(1); }
  const verses = loadVerses({ book: BOOK });
  if (DRY) await dryRun(verses, env.GEMINI_API_KEY);
  else await fullRun(verses, env, LIMIT);
}

// 검사(tests/logcheck)는 이 파일을 import해 순수 함수만 부른다 — 직접 돌릴 때만 main
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
