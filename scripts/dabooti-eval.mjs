// 다붓이 회귀 묶음 돌리기 (18차 2회) — dabooti_evals(0091)의 질문을 실제 모델로 물어 정답·지어냄·비용·지연을 잰다.
//   node scripts/dabooti-eval.mjs                          지금 다붓이(기록 통째로 + gemini-3.8-flash · 느리면 flash-lite)
//   node scripts/dabooti-eval.mjs --model=gemini-3.1-flash-lite   같은 길에 다른 모델(비교용)
//   --only=낱말   질문에 그 낱말이 든 문항만 · --save  문항마다 last 칸에 결과를 쓴다 · --out=파일  결과 JSON
// 모델을 부르니 돈이 든다 — 돌리기 전에 문항 수 × 문항당 비용을 사용자에게 먼저 말한다(HANDOFF §2).
// 정답에 실명이 있어 결과는 레포 밖에 둔다(--out은 스크래치로). 묻는 사람은 서버 키(마스터와 같은 범위)다.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').replace(/\r/g, '').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
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

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const model = arg('model', ASK_MODEL);
const only = arg('only', '');
const { data: evals, error } = await db.from('dabooti_evals').select('*').eq('active', true).order('created_at');
if (error) throw error;
const list = evals.filter(e => !only || e.question.includes(only));
console.log(`${list.length}문항 · 기록 통째로 + ${model}`);

const rows = [];
for (const ev of list) {
  const log = [];
  const t0 = Date.now();
  let out;
  try {
    out = await answerQuestion(ev.question, { db, admin: db, prev: ev.prev, log, cache: false, model });
  } catch (e) { out = { status: 'failed', sentences: [{ text: String(e?.message || e) }] }; }
  const ms = Date.now() - t0;
  const j = judge(ev, out);
  const row = { id: ev.id, q: ev.question, ...j, status: out.status, used: out.model, ms, cost: costOf(log), calls: log.length, input: log.reduce((a, u) => a + u.input, 0), cached: log.reduce((a, u) => a + u.cached, 0), dropped: (out.dropped || []).length };
  rows.push(row);
  console.log(`${j.ok ? 'O' : 'X'}${j.made ? '!' : ' '} ${(ms / 1000).toFixed(1)}s $${row.cost.toFixed(4)} | ${ev.question} → ${j.text.slice(0, 110)}${j.why ? `  [${j.why}]` : ''}`);
  if (arg('save')) await db.from('dabooti_evals').update({ last: { at: new Date().toISOString(), model: out.model || model, ok: j.ok, status: out.status, text: j.text.slice(0, 500), why: j.why } }).eq('id', ev.id);
}
const n = rows.length || 1;
const ms = rows.map(r => r.ms).sort((a, b) => a - b);
const sum = {
  model, n: rows.length, ok: rows.filter(r => r.ok).length, made: rows.filter(r => r.made).length,
  costPer: rows.reduce((a, r) => a + r.cost, 0) / n, msMid: ms[Math.floor(ms.length / 2)] || 0, msMax: ms[ms.length - 1] || 0,
  inputPer: Math.round(rows.reduce((a, r) => a + r.input, 0) / n), cachedPer: Math.round(rows.reduce((a, r) => a + r.cached, 0) / n),
};
console.log(`\n정답 ${sum.ok}/${sum.n} · 지어냄 ${sum.made} · 문항당 $${sum.costPer.toFixed(4)} · 지연 중간 ${(sum.msMid / 1000).toFixed(1)}s 최대 ${(sum.msMax / 1000).toFixed(1)}s · 입력 ${sum.inputPer}토큰(캐시 ${sum.cachedPer})`);
if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify({ sum, rows }, null, 2));
