import { readJson, requireApprovedUser, bearer, adminClient, geminiFetch, isTimeout } from './_lib.js';

// ============================================================================
// /api/ai — Gemini 프록시. 클라이언트에 API 키를 노출하지 않는다.
//   요구: Authorization: Bearer <supabase access token> · **승인된 사람만**(_lib.js)
//   몸통 두 갈래:
//     { prompt, systemInstruction } → { text }   gemini-3.1-flash-lite (글 만들기)
//     { embed: '<질문>' }            → { vec }    gemini-embedding-001 (질문 임베딩 · 0073)
//     { ask: '<질문>', prev? }        → { id, status, sentences, files, nudge? }   다붓이에게 물어보기(0088 · api/_wikiAsk.js · nudge 20차 ⑧)
//     { ask, prev?, stream: 1 }       → 단계 줄들(`{"stage":"gather"}` …) + 마지막 줄에 위와 같은 JSON(NDJSON · 20차 ②)
//     { feedback: { id, v } }         → { ok }     답에 '도움이 됐어요/안 됐어요'(v: good|bad|null)
//     { tell: { questionId, text } }  → { ok, status }   👎 뒤에 알려 준 말(0098 dabooti_facts · 마스터 말이면 바로 반영 · 20차 ⑧)
//     { learn: { op, id?, text?, questionId? } } → { ok, status, resolved }   마스터만 — ✓ approve · ✗ reject · 연필 edit ·
//                                       '+ 직접 알려 주기' add · '답을 알려 주기' answer(반영되면 닮은 열린 질문을 그 자리에서 다시 답한다)
//   임베딩을 따로 라우트로 두지 않은 이유: 인증 머리·키·시간 상한이 같고, Vercel 함수가
//   하나 늘면 vercel.json·dev 서버·tests/push의 다섯 라우트 목록을 같이 고쳐야 한다.
// ============================================================================
const TEXT_MODEL = 'gemini-3.1-flash-lite';

// ── 임베딩 (배치 E · 0073 bible_vec) ────────────────────────────────────────
// **절 쪽(scripts/embed-bible.mjs)과 질문 쪽이 이 값 한 벌을 쓴다** — 스크립트가 여기서
// import한다. 모델이나 차원이 둘로 갈리면 벡터끼리 견줄 수 없는데, 오류 없이 엉뚱한 절만
// 나온다(차원이 같으면 DB도 모른다).
// gemini-embedding-2도 있지만 001로 둔다(재 본 근거가 없다 — NOTES-E.md). 바꾸면 31k절을
// 전부 다시 만들어야 한다.
export const EMBED_MODEL = 'gemini-embedding-001';
export const EMBED_DIM = 768;                 // 0073의 halfvec(768)과 같아야 한다
export const MAX_EMBED_QUERY = 500;           // 질문 글자 상한 — 넘는 뒤쪽은 잘라 버린다

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

// generateContent 답 → { text } 또는 { error }. 글은 **모든 조각을 잇는다** — 첫 조각만 읽으면 답이 여러
// part로 쪼개져 올 때 뒤가 잘린다. 생각 조각(thought)은 싣지 않는다. finishReason이 있고 STOP이 아니면
// (MAX_TOKENS · SAFETY · RECITATION …) 끝나지 않은 답이라 실패다. 이유가 없으면(옛 모양) 그대로 받는다.
export function geminiText(result) {
  const cand = result?.candidates?.[0];
  const reason = cand?.finishReason;
  if (reason && reason !== 'STOP') return { text: '', error: reason };
  const text = (cand?.content?.parts || []).filter(p => p && !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  return { text };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) { res.status(501).json({ error: 'AI가 아직 설정되지 않았습니다 (GEMINI_API_KEY 필요).' }); return; }

  // 승인된 사람만 — 예전에는 로그인만 봐서 승인 전 계정도 우리 키를 쓸 수 있었다
  if (!(await requireApprovedUser(req, res))) return;

  const body = await readJson(req);
  // 임베딩 갈래 — 인증은 위에서 이미 봤다(두 갈래가 같은 머리를 지난다)
  if (body.embed != null) { await handleEmbed(body.embed, geminiKey, res); return; }
  if (body.ask != null || body.feedback != null || body.tell != null || body.learn != null) { await handleAsk(req, body, res); return; }

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

  try {
    const { r, j: result } = await geminiFetch(TEXT_MODEL, 'generateContent', payload, { key: geminiKey, ms: GEMINI_BUDGET_MS });
    if (!r.ok) { console.error('[ai] Gemini 오류:', result); res.status(502).json({ error: 'Gemini 호출 실패' }); return; }
    const { text, error } = geminiText(result);
    // 중간에 끊긴 답(MAX_TOKENS · SAFETY 등)은 실패로 돌려준다 — 잘린 글이 요약·본문에 그대로 들어가면 안 된다.
    // 클라이언트는 404·501이 아닌 non-OK를 전부 '답을 받지 못했어요'(MSG.failed)로 보인다.
    if (error) { console.error('[ai] Gemini 답이 끝나지 않았다:', error); res.status(502).json({ error: 'Gemini 호출 실패' }); return; }
    res.status(200).json({ text });
  } catch (e) {
    // 시간 초과는 504로 가른다 — 부르는 쪽이 "다시 해볼 만한 실패"를 알 수 있어야 한다
    // (api/drive.js와 같은 판단). 몇 초 걸렸는지는 이 서버 로그에만 남긴다.
    if (isTimeout(e)) {
      console.error('[ai] Gemini 시간 초과');
      res.status(504).json({ error: '요청이 제때 끝나지 않았어요\n잠시 후 다시 시도해주세요' });
      return;
    }
    console.error('[ai] Gemini 요청 실패:', e);
    res.status(502).json({ error: 'Gemini 요청 실패' });
  }
}

// { embed } → { vec: number[768] } (단위 길이). 실패 갈래와 문구는 위 글 만들기와 같다.
// 인증은 부르는 handler가 먼저 본다 — 내보내는 것은 tests/push가 가짜 fetch로 돌려 보려는 것이다.
export async function handleEmbed(raw, geminiKey, res) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) { res.status(400).json({ error: 'embed는 비어 있지 않은 글자여야 합니다.' }); return; }

  try {
    const { r, j: result } = await geminiFetch(EMBED_MODEL, 'embedContent', embedQueryPayload(text), { key: geminiKey, ms: GEMINI_BUDGET_MS });
    if (!r.ok) { console.error('[ai] 임베딩 오류:', result); res.status(502).json({ error: 'Gemini 호출 실패' }); return; }
    const values = result.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBED_DIM) {
      console.error('[ai] 임베딩 차원이 다르다:', values?.length);
      res.status(502).json({ error: 'Gemini 호출 실패' });
      return;
    }
    res.status(200).json({ vec: unitVec(values) });
  } catch (e) {
    if (isTimeout(e)) {
      console.error('[ai] 임베딩 시간 초과');
      res.status(504).json({ error: '요청이 제때 끝나지 않았어요\n잠시 후 다시 시도해주세요' });
      return;
    }
    console.error('[ai] 임베딩 요청 실패:', e);
    res.status(502).json({ error: 'Gemini 요청 실패' });
  }
}

// ── 다붓이에게 물어보기 (0088) ──────────────────────────────────────────────
// 답하기는 api/_wikiAsk.js 한 벌(밤 크론의 다시 묻기와 같다). 늦게 불러온다 — 다른 갈래의 첫 실행을 무겁게 하지 않고,
// _wikiAsk가 이 파일의 임베딩 상수를 다시 가져가는 고리를 첫 평가 밖으로 뺀다.
// 찾기는 **묻는 사람의 세션**으로 한다(userClient → RLS). 저장·피드백·상한 확인만 서버 키.
// 누가 물었는지는 저장하지 않는다 — 상한도 사람별이 아니라 전체 1분 30번이다.
const ASK_PER_MINUTE = 30;
async function handleAsk(req, body, res) {
  const mod = await import('./_wikiAsk.js');
  const { answerQuestion, saveAnswer, setFeedback, userClient, askNudge, statementQuestion, tellOp, whoAsks, forgetOp } = mod;
  const admin = adminClient();
  if (body.feedback != null) {
    const ok = await setFeedback(admin, body.feedback?.id, body.feedback?.v ?? null);
    res.status(ok ? 200 : 400).json({ ok });
    return;
  }
  if (body.tell != null || body.learn != null) { await handleLearn(req, body, res, mod, admin); return; }
  const prev = typeof body.prev === 'string' ? body.prev : '';
  const q = typeof body.ask === 'string' ? body.ask.trim() : '';
  if (!q) { res.status(400).json({ error: 'ask는 비어 있지 않은 글자여야 합니다.' }); return; }
  if (q.length > 300) { res.status(413).json({ error: '질문이 너무 길어요\n300자 안으로 줄여 주세요' }); return; }
  // 상한 세기는 기록 읽기와 같이 돈다(2026-10-12 · 왕복 하나 줄임) — 답 찾기는 모델을 부르기 직전에 이 값을 기다리고(gate),
  // 넘었으면 모델 없이 멈춘다. 모델 없는 갈래(인사·캐시 등)도 끝난 뒤 같은 값으로 429 — 넘친 물음은 예전처럼 저장하지 않는다.
  const busy = admin.from('dabooti_questions').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 60e3).toISOString())
    .then(r => (r.count || 0) >= ASK_PER_MINUTE, () => false);
  const reply = askReply(res, !!body.stream);
  const tooMany = () => reply(429, { error: '지금 물어보는 사람이 많아요\n잠시 후 다시 물어봐 주세요' });
  // 답 시간(0113 ai_timings · 관리자 메뉴 '다붓이 답변 속도') — 모델을 부른 순간('answer' 단계)으로 근거 찾기 | 답 쓰기를 가른다
  const t0 = Date.now();
  let tAnswer = 0;
  const onStage = (s) => { if (s === 'answer' && !tAnswer) tAnswer = Date.now(); reply.stage?.(s); };
  try {
    const db = userClient(bearer(req));
    const out = await answerQuestion(q, { db, admin, prev, gate: busy, onStage, onEvidence: reply.evidence });
    if (await busy) { tooMany(); return; }
    const [id] = await Promise.all([saveAnswer(admin, q, out), recordTiming(admin, timingRow(q, out, t0, tAnswer, Date.now()))]);
    // 알려 주는 말(talkKind statement)도 배운 것 저장소로(20차 ⑧ — 마스터 말이면 바로 반영) · 이미 아는 말(save: false)은 남기지 않는다
    if (out.kind === 'statement' && out.save !== false) {
      await whoAsks(db).then(who => tellOp(admin, { text: q, question: statementQuestion(q, prev), who })).catch(e => console.error('[ai] 알려 준 말 저장 실패:', e?.message || e));
    }
    // 학습하지 마(2026-10-17) — 그 말은 저장하지 않았고(save: false) 바로 앞 질문을 목록·아침 고리·배운 것에서 뺀다(forgetOp)
    if (out.kind === 'forget') {
      await whoAsks(db).catch(() => ({})).then(who => forgetOp(admin, { prev, who }));
    }
    const { dropped, wikiCards: _wc, from: _from, ...shown } = out;   // wikiCards · from은 저장용(20차 ⑦ leaderCited · 캐시 나이) — 화면에는 안 간다
    reply(200, { id, ...shown, ...(askNudge(out, q, prev) ? { nudge: true } : {}) });
  } catch (e) {
    if (await busy) { tooMany(); return; }
    console.error('[ai] 다붓이 답 실패:', e?.message || e);
    await saveAnswer(admin, q, { status: 'failed', sentences: [], dropped: [] }).catch(() => {});
    reply(isTimeout(e) ? 504 : 502, { error: '답을 받지 못했어요\n잠시 후 다시 물어봐 주세요' });
  }
}

// 답 시간 한 줄(순수 · tests/logcheck-sec가 부른다) — **묻는 사람은 싣지 않는다**(누가 물었는지 견주지 않는다 · HANDOFF §8).
// 모델을 안 부른 답(캐시 · 인사 · 출석 같은 바로 오는 답)은 답 쓰기 0 · 전부 근거 찾기 칸. 캐시로 준 답은 cached.
export function timingRow(q, out, t0, tAnswer, tEnd) {
  const total = Math.max(0, Math.round(tEnd - t0));
  const answer = tAnswer ? Math.max(0, Math.round(tEnd - tAnswer)) : 0;
  return { question: String(q || '').slice(0, 300), gather_ms: Math.max(0, total - answer), answer_ms: answer, total_ms: total, cached: !!out?.cached };
}
// 넣기는 서버 키(정책 없음 · 0113) — 실패해도 답은 간다(표가 없으면(0113 전) 콘솔에만)
async function recordTiming(admin, row) {
  try {
    const { error } = await admin.from('ai_timings').insert(row);
    if (error) throw error;
  } catch (e) { console.error('[ai] 답 시간 저장 실패:', e?.message || e); }
}

// 배운 것(20차 ⑧ · 0098) — { tell }은 승인된 누구나(👎 뒤 대화 · 저장은 서버 키 · 알려 준 사람은 세션의 effective_uid),
// { learn }은 마스터만(세션의 is_master() — 표 RLS와 같은 판정). 반영되면 닮은 열린 질문을 그 자리에서 다시 답한다(모델 1~3회 · 60초 함수 안).
async function handleLearn(req, body, res, { tellOp, learnOp, whoAsks, userClient }, admin) {
  const who = await whoAsks(userClient(bearer(req))).catch(() => null);
  if (!who?.uid) { res.status(502).json({ error: '저장하지 못했어요' }); return; }
  try {
    if (body.tell != null) {
      const text = typeof body.tell?.text === 'string' ? body.tell.text.trim() : '';
      if (!text || text.length > 300) { res.status(400).json({ error: '저장하지 못했어요' }); return; }
      const out = await tellOp(admin, { text, questionId: body.tell?.questionId || null, who });
      res.status(out ? 200 : 400).json({ ok: !!out, status: out?.status || null });
      return;
    }
    if (!who.master) { res.status(403).json({ error: '마스터만 할 수 있어요' }); return; }
    const l = body.learn || {};
    const text = typeof l.text === 'string' ? l.text.trim().slice(0, 300) : '';
    const out = await learnOp(admin, { op: l.op, id: l.id || null, text, questionId: l.questionId || null }, { who });
    res.status(out ? 200 : 400).json({ ok: !!out, status: out?.status || null, resolved: out?.resolve?.resolved || 0 });
  } catch (e) {
    console.error('[ai] 배운 것 저장 실패:', e?.message || e);
    res.status(502).json({ error: '저장하지 못했어요' });
  }
}

// 다붓이 답의 단계 신호(20차 ② · 사용자 확정 1-c) — { stream: 1 }이면 단계마다 한 줄(`{"stage":"gather"}\n`)을 흘려보내고
// 마지막 줄에 답(지금과 같은 모양)을 쓴다. 실패도 마지막 줄 `{"error", "status"}`(스트림이 열린 뒤에는 HTTP 코드를 못 바꾼다).
// 단계 신호가 한 번도 없으면(캐시 · 출석 · 생일 · 인사 · 알려 주는 말 — 바로 오는 답) 스트림을 열지 않고 예전처럼 코드 + JSON 한 번.
// 앱(services/wiki.js)은 몸통을 줄 단위로 읽고, 스트림을 못 읽는 웹뷰면 끝에 한 번 읽는다(같은 마지막 줄).
// Vercel Node 함수는 res.write를 그대로 흘려보낸다 — 압축·버퍼링을 막는 머리를 같이 단다.
// 근거 먼저(v5 2묶음): reply.evidence(cites) — 모델을 부르기 전에 `{"evidence":[{t,id,label}]}` 한 줄(_wikiAsk.earlyEvidence가 고른 것 · 키는 evidence 하나뿐 — answerReveal.isEvidenceLine).
export function askReply(res, stream) {
  let open = false;
  const reply = (code, body) => {
    if (!open) { res.status(code).json(body); return; }
    res.end(`${JSON.stringify(code === 200 ? body : { ...body, status: code })}\n`);
  };
  const line = (o) => {
    if (!open) {
      open = true;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
    }
    res.write(`${JSON.stringify(o)}\n`);
  };
  reply.stage = stream ? (s) => line({ stage: s }) : null;
  reply.evidence = stream ? (cites) => line({ evidence: cites }) : null;
  return reply;
}
