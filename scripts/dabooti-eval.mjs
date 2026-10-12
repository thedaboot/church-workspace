// 다붓이 회귀 묶음 돌리기 (18차 2회) — dabooti_evals(0091)의 질문을 실제 모델로 물어 정답·지어냄·비용·지연을 잰다.
//   node scripts/dabooti-eval.mjs                          지금 다붓이(기록 통째로 + gemini-3.8-flash · 느리면 flash-lite)
//   node scripts/dabooti-eval.mjs --model=gemini-3.1-flash-lite   같은 길에 다른 모델(비교용)
//   --only=낱말   질문에 그 낱말이 든 문항만 · --save  문항마다 last 칸에 결과를 쓴다 · --out=파일  결과 JSON
//   --retrieve    검색 모드(20차 ② · DABOOTI_RETRIEVE=1과 같은 길 — 질문 임베딩 → match_docs → 고른 기록만)
//   --local-index=파일   match_docs 대신 로컬 벡터로 찾는다 — 0096·크론 전에 위키 장·주보까지 넣은 검색을 재 볼 때.
//                 doc_vec과 같은 조각(_docsync.buildDocs)을 임베딩해 그 파일에 캐시한다(조각 해시별 · 실명이 있어 레포 밖 스크래치로).
//                 DB에는 아무것도 쓰지 않는다. 임베딩 값은 1센트 아래(조각 약 500개).
//   --dry         모델을 부르지 않는다(답 호출만 가로챈다 · 임베딩은 실제) — 실릴 기록의 크기와, 꼭 들어갈 말(must)이
//                 실린 기록에 있는지만 본다(--retrieve와 같이 쓰면 검색이 정답 기록을 놓치는지 돈 안 들이고 본다).
// 모델을 부르니 돈이 든다 — 돌리기 전에 문항 수 × 문항당 비용을 사용자에게 먼저 말한다(HANDOFF §2).
// 정답에 실명이 있어 결과는 레포 밖에 둔다(--out은 스크래치로). 묻는 사람은 서버 키(마스터와 같은 범위)다.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// .env — 레포의 것이 있으면 읽는다(worktree처럼 없으면 이미 넣어 둔 환경변수로)
const envFile = new URL('../.env', import.meta.url);
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').replace(/\r/g, '').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const arg = (k, d = '') => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || (process.argv.includes(`--${k}`) ? true : d);
const { answerQuestion, ASK_MODEL } = await import('../api/_wikiAsk.js');
const { WIKI_MODEL } = await import('../api/_wikiBuild.js');

// 100만 토큰당 달러(입력 · 출력) — 2026-10 공개 가격. 캐시된 입력은 입력값의 10%로 어림한다.
const PRICE = { 'gemini-3.1-flash-lite': [0.25, 1.5], 'gemini-3.5-flash-lite': [0.30, 2.5], 'gemini-3.8-flash': [0.75, 3.75], 'gemini-3.5-flash': [1.5, 9] };
const costOf = (log) => log.reduce((a, u) => {
  const [i, o] = PRICE[u.model] || PRICE[WIKI_MODEL];
  return a + ((u.input - u.cached) * i + u.cached * i * 0.1 + u.output * o) / 1e6;
}, 0);

// 판정 — 결과(답함/모름/거절)가 맞고, 320자를 넘지 않고, must가 전부 있고('A|B'는 하나만), never가 하나도 없어야 정답.
// 지어냄 — 답했는데 never가 들었거나, 모름이어야 하는데 답했다.
export function judge(ev, out) {
  const text = (out.sentences || []).map(s => s.text).join(' ');
  const why = [];
  if (out.status !== ev.expect) why.push(`결과 ${out.status}(기대 ${ev.expect})`);
  for (const m of ev.must || []) if (!String(m).split('|').some(x => text.includes(x))) why.push(`빠짐 '${m}'`);
  if (text.length > 320) why.push(`너무 김 ${text.length}자`);   // 묻는 것만 짧게(사용자 '묻는 거에 대답만')
  const bad = (ev.never || []).filter(x => text.includes(x));
  for (const x of bad) why.push(`나오면 안 됨 '${x}'`);
  const made = out.status === 'answered' && (bad.length > 0 || ev.expect === 'unknown');
  return { ok: !why.length, made, why: why.join(' · '), text };
}

// 로컬 벡터 찾기 — match_docs와 같은 모양의 행(kind · card_id(댓글·첨부는 그 업무) · file_id · page_id · service_id · score)
async function localSearch(db, file) {
  const D = await import('../api/_docsync.js');
  const src = await D.loadSources(db, D.KINDS);
  const docs = D.buildDocs(src, D.KINDS);
  const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const todo = docs.filter(d => !cache[d.body_hash]);
  for (let i = 0; i < todo.length; i += D.EMBED_BATCH) {
    const batch = todo.slice(i, i + D.EMBED_BATCH);
    const vecs = await D.embedTexts(batch.map(d => d.body), process.env.GEMINI_API_KEY);
    batch.forEach((d, n) => { cache[d.body_hash] = vecs[n].map(x => Math.round(x * 1e6) / 1e6); });
  }
  if (todo.length) fs.writeFileSync(file, JSON.stringify(cache));
  const cardOf = new Map([...src.comments.map(c => [c.id, c.card_id]), ...src.files.map(f => [f.id, f.card_id])]);
  const rows = docs.map(d => ({ kind: d.kind, card_id: d.card_id || cardOf.get(d.comment_id || d.file_id) || null, comment_id: d.comment_id, file_id: d.file_id, page_id: d.page_id || null, service_id: d.service_id || null, vec: cache[d.body_hash] }));
  console.log(`로컬 벡터 ${rows.length}조각(새로 임베딩 ${todo.length})`);
  return async (q, k) => rows.map(r => ({ ...r, score: r.vec.reduce((a, x, i) => a + x * q[i], 0) })).sort((a, b) => b.score - a.score).slice(0, k).map(({ vec, ...r }) => r);
}

// --dry: 답 호출만 가로챈다(임베딩은 실제로 보낸다) — 프롬프트를 남기고 '모름'을 돌려준다
let lastPrompt = '';
if (arg('dry')) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!/:generateContent/.test(String(url))) return real(url, init);
    lastPrompt = JSON.parse(init.body).contents[0].parts[0].text;
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"found":false,"sentences":[]}' }] } }] }), { status: 200 });
  };
}

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const model = arg('model', ASK_MODEL);
const only = arg('only', '');
const retrieve = !!arg('retrieve');
const search = arg('local-index') ? await localSearch(db, arg('local-index')) : null;
const { data: evals, error } = await db.from('dabooti_evals').select('*').eq('active', true).order('created_at');
if (error) throw error;
const list = evals.filter(e => !only || e.question.includes(only));
console.log(`${list.length}문항 · ${retrieve ? `검색 모드${search ? '(로컬 벡터)' : ''}` : '기록 통째로'} + ${model}${arg('dry') ? ' · 모델 없이(--dry)' : ''}`);

const rows = [];
for (const ev of list) {
  const log = [];
  const t0 = Date.now();
  lastPrompt = '';
  let out;
  try {
    out = await answerQuestion(ev.question, { db, admin: db, prev: ev.prev, log, cache: false, model, retrieve, search });
  } catch (e) { out = { status: 'failed', sentences: [{ text: String(e?.message || e) }] }; }
  const ms = Date.now() - t0;
  if (arg('dry')) {
    // 꼭 들어갈 말이 실린 기록(프롬프트)에 있나 — 모델이 쓸 재료가 있는지만 본다(표현이 다른 must는 통째로에서도 없다)
    const ev2 = lastPrompt.split('\n\n[질문]')[0];
    const lost = (ev.must || []).filter(m => !String(m).split('|').some(x => ev2.includes(x)));
    const row = { id: ev.id, q: ev.question, prompt: lastPrompt.length, records: (lastPrompt.match(/^R\d+ /gm) || []).length, lost, ms, coded: !lastPrompt };
    rows.push(row);
    console.log(`${row.coded ? '-' : lost.length ? '?' : 'O'} ${String(row.records).padStart(3)}기록 ${String(row.prompt).padStart(6)}자 | ${ev.question}${lost.length ? `  [실린 기록에 없음: ${lost.join(', ')}]` : ''}`);
    continue;
  }
  const j = judge(ev, out);
  const row = { id: ev.id, q: ev.question, ...j, status: out.status, used: out.model, ms, cost: costOf(log), calls: log.length, input: log.reduce((a, u) => a + u.input, 0), cached: log.reduce((a, u) => a + u.cached, 0), dropped: (out.dropped || []).length };
  rows.push(row);
  console.log(`${j.ok ? 'O' : 'X'}${j.made ? '!' : ' '} ${(ms / 1000).toFixed(1)}s $${row.cost.toFixed(4)} ${row.input}tok | ${ev.question} → ${j.text.slice(0, 110)}${j.why ? `  [${j.why}]` : ''}`);
  if (arg('save')) await db.from('dabooti_evals').update({ last: { at: new Date().toISOString(), model: out.model || model, ok: j.ok, status: out.status, text: j.text.slice(0, 500), why: j.why } }).eq('id', ev.id);
}
const n = rows.length || 1;
const ms = rows.map(r => r.ms).sort((a, b) => a - b);
if (arg('dry')) {
  const asked = rows.filter(r => !r.coded);
  const chars = asked.map(r => r.prompt).sort((a, b) => a - b);
  console.log(`\n모델로 가는 ${asked.length}문항 · 기록 중간 ${asked.map(r => r.records).sort((a, b) => a - b)[Math.floor(asked.length / 2)] || 0}개 · 프롬프트 중간 ${chars[Math.floor(chars.length / 2)] || 0}자 최대 ${chars.at(-1) || 0}자 · 꼭 들어갈 말이 실린 기록에 없는 문항 ${asked.filter(r => r.lost.length).length}`);
} else {
  const sum = {
    model, retrieve, n: rows.length, ok: rows.filter(r => r.ok).length, made: rows.filter(r => r.made).length,
    costPer: rows.reduce((a, r) => a + r.cost, 0) / n, msMid: ms[Math.floor(ms.length / 2)] || 0, msMax: ms[ms.length - 1] || 0,
    inputPer: Math.round(rows.reduce((a, r) => a + r.input, 0) / n), cachedPer: Math.round(rows.reduce((a, r) => a + r.cached, 0) / n),
    calls: rows.reduce((a, r) => a + r.calls, 0), cost: rows.reduce((a, r) => a + r.cost, 0),
  };
  console.log(`\n정답 ${sum.ok}/${sum.n} · 지어냄 ${sum.made} · 문항당 $${sum.costPer.toFixed(4)}(합 $${sum.cost.toFixed(3)} · 모델 호출 ${sum.calls}번) · 지연 중간 ${(sum.msMid / 1000).toFixed(1)}s 최대 ${(sum.msMax / 1000).toFixed(1)}s · 입력 ${sum.inputPer}토큰(캐시 ${sum.cachedPer})`);
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify({ sum, rows }, null, 2));
}
if (arg('dry') && arg('out')) fs.writeFileSync(arg('out'), JSON.stringify({ rows }, null, 2));
