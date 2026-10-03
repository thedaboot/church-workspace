import { supabase } from './supabaseClient.js';
import { SEED_PAGES, prefilter, NOT_FOUND } from './wikiCore.js';

// ============================================================================
// 위키 · 다붓이 — 화면 쪽 읽기·쓰기 (0088 · 16차). 그리는 규칙은 wikiCore.js(순수)에 있다.
//   loadWiki()        장 전부 + 사람이 고친 문장 → { pages, edits }
//   saveWikiEdits()   고친 줄 upsert(wiki_edits · 고친 사람·때는 DB 트리거가 정한다)
//   askDabooti()      /api/ai { ask } — 찾기·답·검증은 서버(api/_wikiAsk.js)가 묻는 사람 권한으로 한다
//   sendFeedback()    답의 '도움이 됐어요/안 됐어요'
// 게스트 모드(수파베이스 없음)는 함께 쓰는 글 초안만 보이고, 고친 것은 이 탭 메모리에만 남는다.
// ============================================================================

const guestEdits = [];

export async function loadWiki() {
  if (!supabase) {
    // 검사(tests/wiki)가 게스트 모드에 장 묶음을 넣는 자리 — 모든 블록 모양을 그려 보려고(클라우드에서는 보지 않는다)
    const fx = typeof window !== 'undefined' ? window.__wikiFixture : null;
    // member: true면 마스터가 아닌 사람으로 그린다(게스트는 늘 마스터라 ✎ 수정·자주 묻는 질문 숨김을 볼 길이 없다)
    if (fx) return { pages: fx.pages, edits: [...(fx.edits || []), ...guestEdits], member: !!fx.member };
    return { pages: SEED_PAGES.map(p => ({ ...p, built_at: null })), edits: [...guestEdits] };
  }
  const [p, e] = await Promise.all([
    supabase.from('wiki_pages').select('id, grp, title, kind, position, source, source_count, blocks, built_at, updated_at'),
    supabase.from('wiki_edits').select('page_id, item_key, block_key, text, before, edited_by, edited_at'),
  ]);
  if (p.error) throw p.error;
  if (e.error) throw e.error;
  return { pages: p.data || [], edits: e.data || [] };
}

export async function saveWikiEdits(rows) {
  if (!rows.length) return;
  if (!supabase) {
    const now = new Date().toISOString();
    for (const r of rows) {
      const i = guestEdits.findIndex(x => x.page_id === r.page_id && x.item_key === r.item_key);
      const row = { ...r, edited_by: null, edited_at: now };
      if (i >= 0) guestEdits[i] = { ...row, before: guestEdits[i].before }; else guestEdits.push(row);
    }
    return;
  }
  // 이미 고친 줄을 또 고치면 before는 **처음 글**을 지킨다(자가 개선 예시는 '모델이 쓴 글 → 사람이 원한 글')
  const { data: had } = await supabase.from('wiki_edits').select('item_key, before').eq('page_id', rows[0].page_id).in('item_key', rows.map(r => r.item_key));
  const firstBefore = new Map((had || []).map(h => [h.item_key, h.before]));
  const out = rows.map(r => (firstBefore.has(r.item_key) ? { ...r, before: firstBefore.get(r.item_key) } : r));
  const { error } = await supabase.from('wiki_edits').upsert(out, { onConflict: 'page_id,item_key' });
  if (error) throw error;
}

// → { id, status, sentences:[{text, cites}], files:[…] } · 실패는 던진다(err.human = 화면 글)
export async function askDabooti(q, prev = '') {
  const pf = prefilter(q);
  // 검사(tests/wiki)가 게스트에 답 하나를 넣는 자리 — 👍/👎·파일 카드를 그려 보려고(클라우드에서는 보지 않는다)
  if (!supabase && !pf && typeof window !== 'undefined' && window.__dabootiAnswer) return { ...window.__dabootiAnswer };
  if (!supabase) return pf ? { id: null, status: 'refused', sentences: [{ text: pf.answer, cites: [] }], files: [] }
    : { id: null, status: 'unknown', sentences: [{ text: NOT_FOUND, cites: [] }], files: [] };
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 55 * 1000);
  try {
    const r = await fetch('/api/ai', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ask: q, prev }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error(j.error || `HTTP ${r.status}`); err.human = j.error || '답을 받지 못했어요\n잠시 후 다시 물어봐 주세요'; throw err; }
    return j;
  } catch (e) {
    if (e?.name === 'AbortError') { const err = new Error('timeout'); err.human = '답이 제때 오지 않았어요\n잠시 후 다시 물어봐 주세요'; throw err; }
    if (!e.human) e.human = '답을 받지 못했어요\n잠시 후 다시 물어봐 주세요';
    throw e;
  } finally { clearTimeout(timer); }
}

export async function sendFeedback(id, v) {
  if (!supabase || !id) return;
  const { data: { session } } = await supabase.auth.getSession();
  await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ feedback: { id, v } }),
  }).catch(() => {});
}

// 지난번에 본 때 — 목록의 점(마지막으로 본 뒤 다시 모인 장). 이 브라우저에만 둔다.
const SEEN_KEY = 'wiki:seen';
export function seenMap() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; } }
export function markSeen(id, at) {
  try { const m = seenMap(); m[id] = at || new Date().toISOString(); localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch { /* 막힌 저장소 */ }
}
