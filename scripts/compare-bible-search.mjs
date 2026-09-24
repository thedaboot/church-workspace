// ============================================================================
// 뜻 검색 두 길을 질의 30개로 나란히 잰다 (배치 E3 · 한 번 쓰고 말 도구)
// ----------------------------------------------------------------------------
//   node scripts/compare-bible-search.mjs                   # 30개 전부
//   node scripts/compare-bible-search.mjs --only 두려움      # 하나만
//   node scripts/compare-bible-search.mjs --out r.json      # 결과(양쪽 top-30)를 JSON으로도
//
// (a) 지금 길 — services/bibleSearch.js가 만드는 **그 프롬프트 그대로**를 제미나이
//     (gemini-3.1-flash-lite · api/ai.js와 같은 모델)에 보내고, 같은 파서·같은 해석기로 줄을 만든다.
//     공유 캐시(0057 bible_search_cache)는 **보지 않는다** — 매번 새로 물어야 모델의 답을 잰다.
// (b) 새 길 — 질문을 api/ai.js의 embedQueryPayload(RETRIEVAL_QUERY · 768)로 임베딩해 단위 길이로
//     맞춘 뒤 match_bible(0073) top-30. **0073 적용 + scripts/embed-bible.mjs 적재 뒤에만** 돈다 —
//     표·함수가 없거나 비어 있으면 (b)는 건너뛰고 그렇다고 말한다.
//
// 표: 질의 | AI 줄 수 | 벡터 줄 수 | 겹침 | 메모(사람이 채운다). 아래에 질의마다 양쪽 top-5를 찍어
// 메모를 쓸 근거로 삼는다. 겹침은 AI 줄(최대 3절 범위)의 절 하나라도 벡터 top-30에 있으면 1이다.
//
// .env: GEMINI_API_KEY · VITE_SUPABASE_URL + SUPABASE_SECRET_KEY((b)만 — 서비스 키라 RLS를 넘는다).
// 화면(bibleSearch.js·wordBible)은 건드리지 않는다. 폴백으로 내릴지는 이 숫자를 본 뒤에 정한다.
// ============================================================================
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { EMBED_MODEL, EMBED_DIM, embedQueryPayload, unitVec } from '../api/ai.js';

// 청년부에서 실제로 칠 만한 말 — 감정 · 상황 · 주제어를 섞었다. 본문에 그 낱말이 그대로 있는 것
// (용서·인내)과 없는 것(진로 고민·외로울 때)을 같이 둬야 두 길의 차이가 보인다.
export const QUERIES = [
  '두려움', '불안할 때', '위로가 필요해요', '형제 사랑', '재물과 돈',
  '기도 응답', '용서', '인내', '소명과 부르심', '결혼',
  '슬픔', '외로울 때', '감사', '시험과 유혹', '진로 고민',
  '믿음이 흔들릴 때', '겸손', '화가 날 때', '친구 관계', '섬김',
  '부모 공경', '죽음과 부활의 소망', '하나님의 사랑', '성령의 열매', '쉼과 안식',
  '정직', '말조심', '새로운 시작', '교회 공동체', '전도와 증인',
];

const ROOT = new URL('../', import.meta.url);
const GEN_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;
const K = 30;

const env = Object.fromEntries(readFileSync(new URL('.env', ROOT), 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
if (!env.GEMINI_API_KEY) { console.error('.env에 GEMINI_API_KEY가 없습니다.'); process.exit(1); }

// bibleSearch.js를 **고치지 않고** 노드에서 부른다 — services/ai.js는 supabase 클라이언트를 물고
// 있어 노드에서 못 읽으므로, 그 파일이 가져오는 DASH_RULE 한 줄만 원문에서 떼어 끼운다
// (tests/word.mjs가 같은 이유로 ai.js를 갈아 끼운다).
async function loadBibleSearch() {
  const aiSrc = readFileSync(new URL('src/services/ai.js', ROOT), 'utf8');
  const dash = /export const DASH_RULE = ('[^\n]*');/.exec(aiSrc)?.[1];
  if (!dash) throw new Error('services/ai.js에서 DASH_RULE을 못 찾았다');
  const src = readFileSync(new URL('src/services/bibleSearch.js', ROOT), 'utf8')
    .replace("import { DASH_RULE } from './ai.js';", `const DASH_RULE = ${dash};`)
    .replace("from './bibleRef.js'", `from '${new URL('src/services/bibleRef.js', ROOT).href}'`);
  if (/from '\.\/ai\.js'/.test(src)) throw new Error('bibleSearch.js의 import 모양이 바뀌었다');
  const file = join(mkdtempSync(join(tmpdir(), 'bs-')), 'bibleSearch.mjs');
  writeFileSync(file, src);
  return import(pathToFileURL(file).href);
}

const books = JSON.parse(readFileSync(new URL('public/bible/index.json', ROOT), 'utf8'));
const bookCache = new Map();
const loadBook = async (id) => {
  if (!bookCache.has(id)) bookCache.set(id, JSON.parse(readFileSync(new URL(`public/bible/${id}.json`, ROOT), 'utf8')));
  return bookCache.get(id);
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function post(url, body, tries = 5) {
  for (let i = 1; ; i++) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    if ((r.status === 429 || r.status >= 500) && i < tries) { await sleep(2000 * 2 ** (i - 1)); continue; }
    throw new Error(`HTTP ${r.status} ${j.error?.message?.slice(0, 120) || ''}`);
  }
}

// (a) 앱의 AI 검색과 같은 프롬프트 → 같은 파서 → 같은 해석기
async function aiSearch(bs, query) {
  const { prompt, system } = bs.buildBibleSearchPrompt(query, books);
  const t = Date.now();
  const j = await post(GEN_URL, { contents: [{ parts: [{ text: prompt }] }], systemInstruction: { parts: [{ text: system }] } });
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const refs = bs.parseBibleSearchJson(text);
  const hits = await bs.resolveBibleHits(refs, books, loadBook);
  return { ms: Date.now() - t, asked: refs.length, hits: hits.map(h => ({ label: bs.hitLabel(h), keys: range(h), text: h.text })) };
}
const range = (h) => Array.from({ length: h.to - h.verse + 1 }, (_, i) => `${h.bookId} ${h.chapter}:${h.verse + i}`);

// (b) 질문 임베딩 → match_bible
async function vecSearch(db, query) {
  const t = Date.now();
  const j = await post(EMBED_URL, embedQueryPayload(query));
  const values = j.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBED_DIM) throw new Error(`차원 ${values?.length}`);
  const q = unitVec(values);
  const { data, error } = await db.rpc('match_bible', { q: `[${q.join(',')}]`, k: K });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return { ms: Date.now() - t, hits: data.map(r => ({ label: r.ref, key: `${r.book} ${r.chapter}:${r.verse}`, score: r.score, text: r.body })) };
}

// (b)를 돌릴 수 있는가 — 표·함수가 있고 행이 차 있어야 한다
async function vectorReady() {
  if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return { ok: false, why: '.env에 VITE_SUPABASE_URL·SUPABASE_SECRET_KEY가 없다' };
  const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  // **head 요청으로 있는지 보지 않는다** — 표가 없어도 HEAD는 204 · error null로 온다(재 봤다).
  // 몸통이 있는 GET이어야 PGRST205(표 없음)가 보인다.
  const probe = await db.from('bible_vec').select('ref').limit(1);
  if (probe.error) return { ok: false, why: `bible_vec이 없다(${probe.error.code || probe.error.message}) — 0073을 먼저 적용하세요` };
  if (!probe.data.length) return { ok: false, why: 'bible_vec이 비어 있다 — node scripts/embed-bible.mjs 를 먼저 돌리세요' };
  const { count } = await db.from('bible_vec').select('ref', { count: 'exact', head: true });
  return { ok: true, db, count };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const only = opt('--only');
  const out = opt('--out');
  const queries = only ? [only] : QUERIES;

  const bs = await loadBibleSearch();
  const vr = await vectorReady();
  if (!vr.ok) console.log(`(b) 벡터 검색은 건너뛴다: ${vr.why}\n`);
  else console.log(`(b) bible_vec ${vr.count}행\n`);

  const results = [];
  for (const query of queries) {
    const row = { query, ai: null, vec: null };
    try { row.ai = await aiSearch(bs, query); } catch (e) { row.aiError = e.message; }
    if (vr.ok) { try { row.vec = await vecSearch(vr.db, query); } catch (e) { row.vecError = e.message; } }
    if (row.ai && row.vec) {
      const vk = new Set(row.vec.hits.map(h => h.key));
      row.overlap = row.ai.hits.filter(h => h.keys.some(k => vk.has(k))).length;
    }
    results.push(row);
    process.stderr.write('.');
  }
  process.stderr.write('\n');

  const cell = (x) => (x == null ? '—' : String(x));
  console.log('| 질의 | AI 줄 | 벡터 줄 | 겹침 | 메모 |');
  console.log('|---|---:|---:|---:|---|');
  for (const r of results) {
    const ai = r.ai ? `${r.ai.hits.length}${r.ai.asked !== r.ai.hits.length ? ` (${r.ai.asked}개 중)` : ''}` : `오류 ${r.aiError}`;
    const vec = r.vec ? r.vec.hits.length : (vr.ok ? `오류 ${r.vecError}` : '—');
    console.log(`| ${r.query} | ${ai} | ${cell(vec)} | ${cell(r.overlap)} |  |`);
  }
  const ok = results.filter(r => r.ai);
  const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '—');
  console.log(`\nAI: 평균 ${avg(ok.map(r => r.ai.hits.length))}줄 · 평균 ${avg(ok.map(r => r.ai.ms / 1000))}초 · 빈 답 ${ok.filter(r => !r.ai.hits.length).length}개 · 오류 ${results.length - ok.length}개`
    + ` · 지어낸/못 읽은 참조 ${ok.reduce((s, r) => s + (r.ai.asked - r.ai.hits.length), 0)}개(겹침 제거 포함)`);
  if (vr.ok) {
    const vo = results.filter(r => r.vec);
    console.log(`벡터: 평균 ${avg(vo.map(r => r.vec.ms / 1000))}초 · 겹침 평균 ${avg(vo.filter(r => r.ai).map(r => r.overlap))}줄 · top-1 점수 평균 ${avg(vo.map(r => r.vec.hits[0]?.score || 0))}`);
  }

  console.log('\n── 질의마다 top-5 ──');
  for (const r of results) {
    console.log(`\n[${r.query}]`);
    const a = r.ai?.hits.slice(0, 5) || [];
    const v = r.vec?.hits.slice(0, 5) || [];
    for (let i = 0; i < Math.max(a.length, v.length); i++) {
      const left = a[i] ? `${a[i].label} ${a[i].text.slice(0, 28)}` : '';
      const right = v[i] ? `${v[i].label} (${v[i].score.toFixed(3)}) ${v[i].text.slice(0, 28)}` : '';
      console.log(`  AI  ${left.padEnd(46)} | 벡터 ${right}`);
    }
  }
  if (out) { writeFileSync(out, JSON.stringify(results, null, 2)); console.log(`\n결과 → ${out}`); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
