import { geminiFetch, isTimeout } from '../_lib.js';
import { geminiText } from '../ai.js';
import { WIKI_MODEL } from './const.js';

const CALL_BUDGET_MS = 25 * 1000;
// ── 제미나이 한 번 — 온도 0 · JSON 답 ────────────────────────────────────────
// 시범에서 온도를 안 줘 같은 질문에 답이 매번 달랐다(HANDOFF §2 16차). 429·503은 두 번까지 다시 부른다.
// model: 다붓이 답(gemini-3.8-flash · _wikiAsk.ASK_MODEL)처럼 다른 모델 · budgetMs: 한 번의 시간 · tries: 다붓이 답은 1(느리면 flash-lite로 내려간다)
// 시간 초과만 다시 부른다(그 밖의 실패는 바로 던진다 — 마지막 오류가 TimeoutError면 /api/ai가 504로 가른다)
export async function gen(sys, text, { key = process.env.GEMINI_API_KEY, json = true, schema = null, log = null, call = '', model = WIKI_MODEL, budgetMs = CALL_BUDGET_MS, tries = 3 } = {}) {
  const payload = {
    contents: [{ parts: [{ text }] }],
    systemInstruction: { parts: [{ text: sys }] },
    // responseSchema — 모양을 강제한다(검사 답이 `]`를 하나 더 붙여 통째로 못 읽은 적이 있다 · 2026-10-03)
    generationConfig: { temperature: 0, ...(json ? { responseMimeType: 'application/json' } : {}), ...(schema ? { responseSchema: schema } : {}) },
  };
  let lastErr = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const { r, j } = await geminiFetch(model, 'generateContent', payload, { key, ms: budgetMs });
      if (r.status === 429 || r.status === 503) { lastErr = new Error(`gemini ${r.status}`); await new Promise(res => setTimeout(res, 2500 * (attempt + 1))); continue; }
      if (!r.ok) throw new Error(`gemini ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
      const { text: out, error } = geminiText(j);
      if (error) throw new Error(`gemini finish ${error}`);
      const u = j.usageMetadata || {};
      log?.push({ call, model, input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), cached: u.cachedContentTokenCount || 0 });
      return out;
    } catch (e) {
      lastErr = e;
      if (!isTimeout(e)) break;
    }
  }
  throw lastErr || new Error('gemini 실패');
}

// 응답 모양(Gemini responseSchema — OpenAPI 부분집합)
const STR = { type: 'STRING' };
export const SCHEMA = {
  write: { type: 'ARRAY', items: { type: 'OBJECT', properties: { b: STR, s: { type: 'ARRAY', items: STR }, text: STR }, required: ['b', 's', 'text'] } },
  verify: { type: 'OBJECT', properties: { problems: { type: 'ARRAY', items: { type: 'OBJECT', properties: { n: { type: 'INTEGER' }, extra: { type: 'ARRAY', items: STR } }, required: ['n', 'extra'] } } }, required: ['problems'] },
  answer: { type: 'OBJECT', properties: { found: { type: 'BOOLEAN' }, sentences: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: STR, e: { type: 'ARRAY', items: STR } }, required: ['text', 'e'] } } }, required: ['found', 'sentences'] },
};
