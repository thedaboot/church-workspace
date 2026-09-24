import { readJson, requireApprovedUser } from './_lib.js';

// ============================================================================
// /api/ai — Gemini 프록시. 클라이언트에 API 키를 노출하지 않는다.
//   요구: Authorization: Bearer <supabase access token> · **승인된 사람만**(_lib.js)
//   몸통 두 갈래:
//     { prompt, systemInstruction } → { text }   gemini-3.1-flash-lite (글 만들기)
//     { embed: '<질문>' }            → { vec }    gemini-embedding-001 (질문 임베딩 · 0073)
//   임베딩을 따로 라우트로 두지 않은 이유: 인증 머리·키·시간 상한이 같고, Vercel 함수가
//   하나 늘면 vercel.json·dev 서버·tests/push의 다섯 라우트 목록을 같이 고쳐야 한다.
// ============================================================================
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

// ── 임베딩 (배치 E · 0073 bible_vec) ────────────────────────────────────────
// **절 쪽(scripts/embed-bible.mjs)과 질문 쪽이 이 값 한 벌을 쓴다** — 스크립트가 여기서
// import한다. 모델이나 차원이 둘로 갈리면 벡터끼리 견줄 수 없는데, 오류 없이 엉뚱한 절만
// 나온다(차원이 같으면 DB도 모른다).
// gemini-embedding-2도 있지만 001로 둔다(재 본 근거가 없다 — NOTES-E.md). 바꾸면 31k절을
// 전부 다시 만들어야 한다.
export const EMBED_MODEL = 'gemini-embedding-001';
export const EMBED_DIM = 768;                 // 0073의 halfvec(768)과 같아야 한다
export const MAX_EMBED_QUERY = 500;           // 질문 글자 상한 — 넘는 뒤쪽은 잘라 버린다
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;

// 단위 길이로 맞춘다. 768차원으로 줄여 받은 출력은 **정규화되어 오지 않는다**(재 보니 길이
// 약 0.58) — 절 쪽과 질문 쪽을 같은 방식으로 맞춰야 코사인 거리가 제 뜻이 된다.
// 길이가 0이거나 숫자가 아닌 값이 끼면 던진다(그런 벡터를 저장하면 모든 거리가 NaN이다).
export function unitVec(values) {
  if (!Array.isArray(values) || !values.length) throw new Error('빈 벡터');
  let sum = 0;
  for (const x of values) {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('숫자가 아닌 성분');
    sum += x * x;
  }
  const n = Math.sqrt(sum);
  if (!(n > 0)) throw new Error('길이가 0인 벡터');
  return values.map(x => x / n);
}

// 질문 하나 → embedContent 몸통. 절 쪽은 RETRIEVAL_DOCUMENT, 질문 쪽은 RETRIEVAL_QUERY다
// (같은 모델이 둘을 서로 가깝게 놓도록 학습되어 있다).
export function embedQueryPayload(text) {
  return {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text: String(text).slice(0, MAX_EMBED_QUERY) }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: EMBED_DIM,
  };
}

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

  const body = await readJson(req);
  // 임베딩 갈래 — 인증은 위에서 이미 봤다(두 갈래가 같은 머리를 지난다)
  if (body.embed != null) { await handleEmbed(body.embed, geminiKey, res); return; }

  const { prompt, systemInstruction } = body;
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

// { embed } → { vec: number[768] } (단위 길이). 실패 갈래와 문구는 위 글 만들기와 같다.
// 인증은 부르는 handler가 먼저 본다 — 내보내는 것은 tests/push가 가짜 fetch로 돌려 보려는 것이다.
export async function handleEmbed(raw, geminiKey, res) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) { res.status(400).json({ error: 'embed는 비어 있지 않은 글자여야 합니다.' }); return; }

  const ctl = new AbortController();
  const killer = setTimeout(() => ctl.abort(), GEMINI_BUDGET_MS);
  try {
    const r = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify(embedQueryPayload(text)),
      signal: ctl.signal,
    });
    const result = await r.json();
    if (!r.ok) { console.error('[ai] 임베딩 오류:', result); res.status(502).json({ error: 'Gemini 호출 실패' }); return; }
    const values = result.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBED_DIM) {
      console.error('[ai] 임베딩 차원이 다르다:', values?.length);
      res.status(502).json({ error: 'Gemini 호출 실패' });
      return;
    }
    res.status(200).json({ vec: unitVec(values) });
  } catch (e) {
    if (e?.name === 'AbortError') {
      console.error('[ai] 임베딩 시간 초과');
      res.status(504).json({ error: '요청이 제때 끝나지 않았어요\n잠시 후 다시 시도해주세요' });
      return;
    }
    console.error('[ai] 임베딩 요청 실패:', e);
    res.status(502).json({ error: 'Gemini 요청 실패' });
  } finally {
    clearTimeout(killer);
  }
}
