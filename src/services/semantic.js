import { supabase } from './supabaseClient.js';
import { vecParam, relatedKey, RELATED_K, BIBLE_VEC_K } from './vecSearch.js';

// ============================================================================
// 뜻 검색 통신 — 질문 임베딩(/api/ai { embed }) → match_docs(0074) · match_bible(0073)
// ----------------------------------------------------------------------------
// 모양을 바꾸는 일은 services/vecSearch.js(순수)가 한다. 여기는 왕복만 한다.
// **게스트 모드(클라우드 없음)에서는 아무것도 하지 않는다** — semanticOn()이 false이고 부르는 쪽은
// 그 구역을 아예 세우지 않는다(네트워크 0 · 사용자 결정 2026-09-25).
// 두 rpc 모두 security invoker라 승인된 사람만 행이 온다(미승인은 빈 결과).
//
// 캐시: 같은 물음은 탭이 살아 있는 동안 한 번만 묻는다(메모리 — 값이 DB 내용에 따라 달라지므로
// localStorage에는 두지 않는다). 실패는 캐시하지 않는다. 늦게 온 옛 물음은 signal로 끊는다.
// ============================================================================

export const semanticOn = () => !!supabase;

const EMBED_TIMEOUT_MS = 15000;   // 이보다 늦으면 이 구역은 포기한다(글자 결과는 이미 서 있다)

export async function embedQuery(text, { signal } = {}) {
  if (!supabase) throw new Error('클라우드 모드가 아니에요');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('로그인이 필요해요');
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, EMBED_TIMEOUT_MS);
  try {
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ embed: String(text || '').trim() }),
      signal: ctl.signal,
    });
    if (!r.ok) { const e = new Error(`임베딩 ${r.status}`); e.status = r.status; throw e; }
    const { vec } = await r.json();
    if (!Array.isArray(vec) || !vec.length) throw new Error('임베딩이 비어 있어요');
    return vec;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

const docsMemo = new Map();
// 이미 물어본 물음이면 그 행을 바로 — 부르는 쪽이 기다림(뼈대) 없이 그린다
export const peekDocs = (query) => docsMemo.get(relatedKey(query));
// 물음 → match_docs 행(가까운 순). 업무 줄로 묶는 것은 vecSearch.relatedTasks.
export async function matchDocs(query, { signal, k = RELATED_K } = {}) {
  const key = relatedKey(query);
  if (docsMemo.has(key)) return docsMemo.get(key);
  const vec = await embedQuery(query, { signal });
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  let q = supabase.rpc('match_docs', { q: vecParam(vec), k });
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data || [];
  docsMemo.set(key, rows);
  return rows;
}

const bibleMemo = new Map();
// 물음 → match_bible 행(가까운 순). 줄 모양은 vecSearch.bibleVecHits.
export async function matchBible(query, { signal, k = BIBLE_VEC_K } = {}) {
  const key = relatedKey(query);
  if (bibleMemo.has(key)) return bibleMemo.get(key);
  const vec = await embedQuery(query, { signal });
  let q = supabase.rpc('match_bible', { q: vecParam(vec), k });
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data || [];
  bibleMemo.set(key, rows);
  return rows;
}
