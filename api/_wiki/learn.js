import { kstDate, mdLabel, normQ, prefilter, LEARNED_ID, FAQ_SOURCE } from '../../src/services/wikiCore.js';
import { unseenCardIds } from '../_leaders.js';
import { readAll } from '../_lib.js';
import { sha } from './const.js';
import { faqPage } from './faq.js';

// ============================================================================
// 다붓이가 배운 것 (20차 ⑧ · 0098 dabooti_facts · 사용자 결정 2026-10-13 · 정본 docs/AI.md §5)
// ----------------------------------------------------------------------------
// 사람이 알려 준 사실 한 줄씩. 들어오는 길은 넷 — 👎 뒤 대화로 알려 준 말(/api/ai { tell }) · 알려 주는 말 갈래(talkKind statement) ·
// 마스터의 '+ 직접 알려 주기' · 자주 묻는 질문 장의 '답을 알려 주기'(/api/ai { learn }).
//   · 마스터가 알려 주면 바로 approved, 다른 사람은 pending(마스터가 ✓ 반영 / ✗ 버리기). 단 prefilter가 거르는 종류
//     (비밀 값 · 기도제목 · 한 사람의 사정 · 연락처 · 노트 · 평가 · 규칙 바꾸기)가 들면 마스터 말이어도 pending(factStatus).
//   · 같은 말(normQ)이 또 오면 줄을 늘리지 않고 count만 올린다(마스터가 pending인 말을 또 알려 주면 그때 approved).
//   · approved만 다붓이 근거가 된다 — 늘 싣는다(통째·검색 모드 둘 다 · factEvidence · 서버 키로 읽는다).
//   · 알려 준 사람(told_by)은 마스터만 읽는다(표 RLS · 장도 마스터만). 질문 글(dabooti_questions)은 그대로 익명이다.
// 장 '다붓이가 배운 것'(id learned · 마스터만 · 0098 RLS)은 아침 빌드와 마스터가 손댈 때 그 자리에서 다시 쓴다(rebuildLearned).
// ============================================================================

export const FACT_COLS = 'id, question, text, told_by, status, from_question_id, created_at, decided_at, leader, count';
const clip = (s, n = 60) => { const t = String(s || '').trim().replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n)}…` : t; };

// 마스터 말이면 바로 반영 — 거르는 말이 들었으면 마스터 말이어도 확인을 기다린다
export const factStatus = (text, { master = false } = {}) => (master && !prefilter(text) ? 'approved' : 'pending');

// 근거 — 승인된 사실을 [배운 것] 묶음(F1…)으로 · 오래된 것부터(같은 주제면 늦게 배운 것이 이긴다 — 프롬프트가 순서로 안다).
// 줄마다 배운 날과 이어진 물음. leader: 묻는 사람이 리더인가 — 아니면 리더 관련 사실은 싣지 않는다(서버 키 아침 고리는 true).
// cite는 화면에 칩으로 세우지 않는다(_wikiAsk가 뗀다) — 리더 관련 사실을 단 답을 캐시에 안 남기는 데만 쓴다.
export function factEvidence(facts = [], { leader = false } = {}) {
  return facts.filter(f => f && f.status === 'approved' && String(f.text || '').trim() && (leader || !f.leader))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((f, i) => ({
      id: `F${i + 1}`,
      text: `(${mdLabel(kstDate(f.created_at))} 배움${f.question ? ` · 물음 '${clip(f.question)}'` : ''}) ${String(f.text).trim()}`,
      cite: { t: 'fact', id: f.id, ...(f.leader ? { leader: true } : {}) },
      tag: 'fact',
    }));
}

// 승인된 사실(서버 키) — 못 읽으면 빈 목록(근거가 하나 덜 실릴 뿐 답은 간다 · 0098 전)
export async function approvedFacts(admin) {
  if (!admin) return [];
  const { data, error } = await admin.from('dabooti_facts').select(FACT_COLS).eq('status', 'approved');
  if (error) { console.error('[dabooti] 배운 것 읽기 실패:', error.message); return []; }
  return data || [];
}

// 장 '다붓이가 배운 것' — 위 '확인을 기다리는 말'(있을 때만) · 아래 '다붓이가 배운 것'. 둘 다 새것부터.
// names: 프로필 id → 이름(알려 준 사람 · 마스터만 보는 장)
export function learnedPage(facts = [], names = new Map()) {
  const item = (f) => ({ key: `f:${f.id}`, text: String(f.text || ''), by: 'human',
    meta: { id: f.id, day: kstDate(f.created_at), who: names.get(f.told_by) || '', q: f.question || '', ...(f.leader ? { leader: true } : {}), ...(f.count > 1 ? { n: f.count } : {}) } });
  const newest = (a, b) => String(b.created_at).localeCompare(String(a.created_at));
  const pending = facts.filter(f => f.status === 'pending').sort(newest).map(item);
  const learned = facts.filter(f => f.status === 'approved').sort(newest).map(item);
  return {
    id: LEARNED_ID, grp: '함께 쓰는 글', title: '다붓이가 배운 것', kind: 'auto', position: 3, source: null, source_count: learned.length,
    blocks: [
      ...(pending.length ? [{ key: 'pending', type: 'facts', title: '확인을 기다리는 말', items: pending }] : []),
      { key: 'learned', type: 'facts', title: '다붓이가 배운 것', items: learned },
    ],
  };
}
// 장 목록의 점 — 확인을 기다리는 말이 있다
export const pendingCount = (page) => ((page?.blocks || []).find(b => b.key === 'pending')?.items || []).length;

// 알려 준 말 하나 저장 → { id, status, approved(이번에 반영됐나) } · 같은 말이면 count만 올린다
export async function saveFact(admin, { text, question = '', toldBy = null, master = false, fromQuestionId = null, leader = false } = {}) {
  const t = String(text || '').trim().slice(0, 500);
  if (!t) return null;
  const want = factStatus(t, { master });
  const { data: had, error } = await admin.from('dabooti_facts').select('id, text, status, count').in('status', ['pending', 'approved']);
  if (error) throw new Error(`dabooti_facts: ${error.message}`);
  const same = (had || []).find(f => normQ(f.text) === normQ(t));
  const now = new Date().toISOString();
  if (same) {
    const lift = same.status === 'pending' && want === 'approved';
    const { error: e2 } = await admin.from('dabooti_facts').update({ count: (same.count || 1) + 1, ...(lift ? { status: 'approved', decided_at: now } : {}) }).eq('id', same.id);
    if (e2) throw new Error(`dabooti_facts: ${e2.message}`);
    return { id: same.id, status: lift ? 'approved' : same.status, approved: lift };
  }
  const row = { text: t, question: String(question || '').trim().slice(0, 500) || null, told_by: toldBy, status: want,
    from_question_id: fromQuestionId, leader: !!leader, ...(want === 'approved' ? { decided_at: now } : {}) };
  const { data, error: e3 } = await admin.from('dabooti_facts').insert(row).select('id').single();
  if (e3) throw new Error(`dabooti_facts: ${e3.message}`);
  return { id: data.id, status: want, approved: want === 'approved' };
}

// 마스터의 ✓ 반영 · ✗ 버리기 · 연필 고치기 → 바뀐 행(없으면 null)
export async function decideFact(admin, { id, op, text = '' } = {}) {
  const now = new Date().toISOString();
  const t = String(text || '').trim().slice(0, 500);
  const patch = op === 'approve' ? { status: 'approved', decided_at: now } : op === 'reject' ? { status: 'rejected', decided_at: now }
    : op === 'edit' && t ? { text: t, decided_at: now } : null;
  if (!patch || !/^[0-9a-f-]{36}$/.test(String(id))) return null;
  const { data, error } = await admin.from('dabooti_facts').update(patch).eq('id', id).select(FACT_COLS).single();
  if (error) throw new Error(`dabooti_facts: ${error.message}`);
  return data;
}

// 두 장을 그 자리에서 다시 쓴다(모델 없음) — 마스터가 ✓/✗/알려 주기 할 때 · 아침 빌드는 _wikiBuild.js가 같은 함수(learnedPage · faqPage)로
export async function rebuildLearned(admin) {
  const [facts, profiles] = await Promise.all([
    readAll(() => admin.from('dabooti_facts').select(FACT_COLS).in('status', ['pending', 'approved']).order('created_at').order('id'), 'dabooti_facts'),
    readAll(() => admin.from('profiles').select('id, display_name').order('id'), 'profiles'),
  ]);
  const lp = learnedPage(facts, new Map(profiles.map(p => [p.id, String(p.display_name || '').trim()])));
  const { error } = await admin.from('wiki_pages').upsert({ ...lp, src_hash: sha(JSON.stringify(lp.blocks)), built_at: new Date().toISOString() });
  if (error) throw new Error(`wiki_pages: ${error.message}`);
  return lp;
}
export async function rebuildFaq(admin) {
  const [questions, pages, edits, leaderCards] = await Promise.all([
    readAll(() => admin.from('dabooti_questions').select('id, question, norm, status, answer, feedback, via, created_at, resolved_at')
      .gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString()).order('created_at').order('id'), 'dabooti_questions'),
    readAll(() => admin.from('wiki_pages').select('id, blocks').order('id'), 'wiki_pages'),
    readAll(() => admin.from('wiki_edits').select('page_id, item_key, text').order('page_id').order('item_key'), 'wiki_edits'),
    unseenCardIds(admin),   // 리더 ∪ 잠긴 업무(20차 ⑩) — 아침 빌드(gather.js leaderCards)와 같은 Set
  ]);
  const fp = faqPage({ questions, pages, edits, leaderCards });
  const { error } = await admin.from('wiki_pages').upsert({ ...fp, source: FAQ_SOURCE, src_hash: sha(JSON.stringify(fp.blocks)), built_at: new Date().toISOString() });
  if (error) throw new Error(`wiki_pages: ${error.message}`);
  return fp;
}
