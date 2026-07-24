import { createClient } from '@supabase/supabase-js';

// ============================================================================
// /api/ai — Gemini 프록시. 클라이언트에 API 키를 노출하지 않는다.
//   요구: Authorization: Bearer <supabase access token> (getUser로 검증)
//   모델: gemini-3.1-flash-lite
// ============================================================================
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

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

  try {
    const r = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify(payload),
    });
    const result = await r.json();
    if (!r.ok) { console.error('[ai] Gemini 오류:', result); res.status(502).json({ error: 'Gemini 호출 실패' }); return; }
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.status(200).json({ text });
  } catch (e) {
    console.error('[ai] Gemini 요청 실패:', e);
    res.status(502).json({ error: 'Gemini 요청 실패' });
  }
}
