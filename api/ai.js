import { readJson, requireApprovedUser } from './_lib.js';

// ============================================================================
// /api/ai — Gemini 프록시. 클라이언트에 API 키를 노출하지 않는다.
//   요구: Authorization: Bearer <supabase access token> · **승인된 사람만**(_lib.js)
//   모델: gemini-3.1-flash-lite
// ============================================================================
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

// 제미나이가 이 시간 안에 답하지 않으면 **우리가 먼저 끊는다**(api/drive.js·api/yt.js와
// 같은 규칙). 안 끊으면 vercel.json의 maxDuration(30초)에 함수가 죽고, 그때 브라우저가
// 받는 것은 JSON이 아니라 플랫폼 오류 페이지라 부르는 쪽이 이유를 읽지 못한다.
// 플랫폼보다 우리가 먼저 잡아야 하므로 그보다 짧게 잡는다.
const GEMINI_BUDGET_MS = 25 * 1000;

// 글자 수 상한(보안 감사 2026-09-24) — 없으면 승인된 한 사람이 우리 키로 아무 크기나 보낼 수
// 있다. 넉넉히 잡았다: 라이브에서 가장 긴 업무 본문이 2,812자 + 첨부 발췌 3,000자이고,
// 시스템 지시는 docs/AI.md 배경 지식(약 14.7kB)이 실린다(services/ai.js).
const MAX_PROMPT = 60000;
const MAX_SYSTEM = 20000;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) { res.status(501).json({ error: 'AI가 아직 설정되지 않았습니다 (GEMINI_API_KEY 필요).' }); return; }

  // 승인된 사람만 — 예전에는 로그인만 봐서 승인 전 계정도 우리 키를 쓸 수 있었다
  if (!(await requireApprovedUser(req, res))) return;

  const { prompt, systemInstruction } = await readJson(req);
  if (!prompt || typeof prompt !== 'string') { res.status(400).json({ error: 'prompt가 필요합니다.' }); return; }
  if (systemInstruction != null && typeof systemInstruction !== 'string') { res.status(400).json({ error: 'systemInstruction은 글자여야 합니다.' }); return; }
  if (prompt.length > MAX_PROMPT || (systemInstruction || '').length > MAX_SYSTEM) {
    console.error('[ai] 상한 초과:', prompt.length, (systemInstruction || '').length);
    res.status(413).json({ error: '보낸 글이 너무 길어요' });
    return;
  }

  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };

  const ctl = new AbortController();
  const killer = setTimeout(() => ctl.abort(), GEMINI_BUDGET_MS);
  try {
    const r = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    const result = await r.json();
    if (!r.ok) { console.error('[ai] Gemini 오류:', result); res.status(502).json({ error: 'Gemini 호출 실패' }); return; }
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.status(200).json({ text });
  } catch (e) {
    // 시간 초과는 504로 가른다 — 부르는 쪽이 "다시 해볼 만한 실패"를 알 수 있어야 한다
    // (api/drive.js와 같은 판단). 몇 초 걸렸는지는 이 서버 로그에만 남긴다.
    if (e?.name === 'AbortError') {
      console.error('[ai] Gemini 시간 초과');
      res.status(504).json({ error: '요청이 제때 끝나지 않았어요\n잠시 후 다시 시도해주세요' });
      return;
    }
    console.error('[ai] Gemini 요청 실패:', e);
    res.status(502).json({ error: 'Gemini 요청 실패' });
  } finally {
    clearTimeout(killer);
  }
}
