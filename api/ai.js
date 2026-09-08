import { createClient } from '@supabase/supabase-js';

// ============================================================================
// /api/ai — Gemini 프록시. 클라이언트에 API 키를 노출하지 않는다.
//   요구: Authorization: Bearer <supabase access token> (getUser로 검증)
//   모델: gemini-3.1-flash-lite
// ============================================================================
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

// 제미나이가 이 시간 안에 답하지 않으면 **우리가 먼저 끊는다**(api/drive.js·api/yt.js와
// 같은 규칙). 안 끊으면 vercel.json의 maxDuration(30초)에 함수가 죽고, 그때 브라우저가
// 받는 것은 JSON이 아니라 플랫폼 오류 페이지라 부르는 쪽이 이유를 읽지 못한다.
// 플랫폼보다 우리가 먼저 잡아야 하므로 그보다 짧게 잡는다.
const GEMINI_BUDGET_MS = 25 * 1000;

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) { res.status(501).json({ error: 'AI가 아직 설정되지 않았습니다 (GEMINI_API_KEY 필요).' }); return; }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) { res.status(401).json({ error: '인증이 필요합니다.' }); return; }

  // 세션(access token) 검증 — 로그인 사용자만 프록시 이용
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) { res.status(401).json({ error: '유효하지 않은 세션입니다.' }); return; }

  const { prompt, systemInstruction } = await readJson(req);
  if (!prompt) { res.status(400).json({ error: 'prompt가 필요합니다.' }); return; }

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
