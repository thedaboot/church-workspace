import { LEADERS, CUSTOM, isLeaderOnly, isRestricted, leaderCardIdsOf, leaderAudience } from '../src/services/visibility.js';

// ============================================================================
// 리더만 보는 프로젝트(0092) · 보는 사람 직접 선택(0105) — 서버 키 경로의 판정 한 벌(RLS를 안 타는 자리라 코드로 거른다)
// ----------------------------------------------------------------------------
// 부르는 곳: api/push.js(앱 알림의 푸시 · 마감 임박) · api/ics.js(내 달력 구독) · api/_wikiAsk.js(다붓이 답 캐시·짝 —
// leaderCardIds + visibility.leaderCited · 20차 ⑥). 위키 장(api/_wiki/gather.js)은
// 통째로 읽은 원본을 visibility.dropLeaderOnly로 걷고(리더만 ∪ 직접 선택), 공유 카드(api/share.js)는 그 행의 visibility만 본다.
// 업무 잠금(0099)도 여기 — lockedCardIds(서버 키 · 잠긴 것 전부) · lockedHiddenFor(묻는 사람 세션) · lockedOf(푸시 미리보기) ·
// unseenCardIds(리더 ∪ 직접 선택 ∪ 잠긴 — 다붓이 답 캐시·짝·아침 고리·자주 묻는 질문 장 · 20차 ⑩ · 0105).
// 직접 선택(0105) — customCardIds(서버 키 · 그 업무 전부) · hiddenFor(묻는 사람 세션의 hidden_ids) ·
// audienceFor·audienceMap(그 업무·프로젝트를 볼 수 있는 계정 — 푸시 · 마감 임박 · 달력).
// 리더 판정은 DB 함수 leader_profile_ids() 한 벌이다 — 서비스 키는 auth.uid()가 없어 그대로 받는다(0092).
// 볼 수 있는 계정은 DB 함수 project_audiences() 한 벌이다(리더만이면 올해 리더 ∪ 그해 리더 — 0110 지난해 리더 · 직접 선택이면 고른 사람 ∪ 마스터).
// `_`로 시작해 라우트가 아니다.
// ============================================================================

// 리더 계정 id(남긴 계정) Set
export async function leaderIdSet(db) {
  const { data, error } = await db.rpc('leader_profile_ids');
  if (error) throw error;
  return new Set(Array.isArray(data) ? data : []);
}

// 이 업무(또는 프로젝트)의 지금 프로젝트와 보는 사람 → { projectId, visibility } | null. **업무가 있으면 업무의 지금 프로젝트로
// 본다** — 몸통의 projectId는 부르는 쪽이 보낸 값이라 믿지 않는다. 없는 업무·프로젝트면 null(가릴 것이 없다).
export async function projectOf(db, { cardId, projectId } = {}) {
  if (cardId) {
    const { data, error } = await db.from('cards').select('project_id, projects(visibility)').eq('id', cardId).maybeSingle();
    if (error) throw error;
    if (data) return { projectId: data.project_id, visibility: data.projects?.visibility || 'all' };
  }
  if (projectId) {
    const { data, error } = await db.from('projects').select('visibility').eq('id', projectId).maybeSingle();
    if (error) throw error;
    if (data) return { projectId, visibility: data.visibility || 'all' };
  }
  return null;
}

// 이 업무(또는 프로젝트)가 리더만 보는 것인가(0092) — projectOf의 한 갈래
export async function leaderOnlyOf(db, where = {}) {
  return isLeaderOnly(await projectOf(db, where));
}

// 좁혀진 프로젝트마다 볼 수 있는 계정 id(남긴 계정) → Map<프로젝트 id, Set> (project_audiences · 0105). ids를 주면 그 프로젝트만.
// 못 읽으면 던진다 — 부르는 쪽이 닫힌 쪽(아무에게도 안 보냄)으로 받는다.
export async function audienceMap(db, ids = null) {
  const { data, error } = await db.rpc('project_audiences', ids ? { ps: ids } : {});
  if (error) throw error;
  return new Map((Array.isArray(data) ? data : []).map(r => [r.project_id, new Set(r.profile_ids || [])]));
}

// 이 업무(또는 프로젝트)를 볼 수 있는 계정 Set — 공개면 null(거를 것이 없다). 좁혀졌는데 목록에 없으면 빈 Set(닫힌 쪽).
// 리더만은 leader_profile_ids() ∪ 그 프로젝트의 project_audiences 줄(0110부터 그해 리더 — 지난해 리더 프로젝트의 지난해 리더 ·
// 그 줄을 못 읽으면 올해 리더만 · 0110 전과 같다), 직접 선택은 project_audiences(). 리더 목록·직접 선택 몫을 못 읽으면 던진다.
export async function audienceFor(db, where = {}) {
  const p = await projectOf(db, where);
  if (!isRestricted(p)) return null;
  if (isLeaderOnly(p)) {
    const [ids, extra] = await Promise.all([leaderIdSet(db), audienceMap(db, [p.projectId]).then(m => m.get(p.projectId), () => null)]);
    return leaderAudience(ids, extra);
  }
  return (await audienceMap(db, [p.projectId])).get(p.projectId) || new Set();
}

// 리더 프로젝트의 업무 id Set — 다붓이 답이 그 기록에 기댔는지(visibility.leaderCited) 가를 재료. 리더 프로젝트가 없으면 한 번만 읽는다.
// 못 읽으면 던진다 — 부르는 쪽이 닫힌 쪽(캐시에 안 남김 · 캐시를 안 줌 · 짝을 안 씀)으로 받는다.
export async function leaderCardIds(db) {
  const { data: projects, error } = await db.from('projects').select('id, visibility').eq('visibility', LEADERS);
  if (error) throw error;
  if (!projects?.length) return new Set();
  const { data: cards, error: e2 } = await db.from('cards').select('id, project_id').in('project_id', projects.map(p => p.id));
  if (e2) throw e2;
  return leaderCardIdsOf({ projects, cards: cards || [] });
}

// 직접 선택(0105) 프로젝트의 업무 id Set — leaderCardIds와 같은 약속(못 읽으면 던진다 · 그런 프로젝트가 없으면 빈 Set).
export async function customCardIds(db) {
  const { data: projects, error } = await db.from('projects').select('id, visibility').eq('visibility', CUSTOM);
  if (error) throw error;
  if (!projects?.length) return new Set();
  const { data: cards, error: e2 } = await db.from('cards').select('id, project_id').in('project_id', projects.map(p => p.id));
  if (e2) throw e2;
  return leaderCardIdsOf({ projects, cards: cards || [] });
}

// 묻는 사람에게 가려진 id(리더 프로젝트 · 고르지 않은 직접 선택 프로젝트 · 그 업무·댓글·첨부) — **그 사람 세션 클라이언트로** 부른다
// (hidden_ids · 0092·0105). 배열이 아니면(모르는 답) 던진다 — 부르는 쪽이 닫힌 쪽으로 받는다.
export async function hiddenFor(db) {
  const { data, error } = await db.rpc('hidden_ids');
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('hidden_ids: 배열이 아니다');
  return new Set(data);
}

// ── 업무 잠금(0099) — 서버 키에는 잠긴 업무가 **전부** '안 보이는 업무'다(맞힌 계정·만든 사람의 열림은 그 사람 세션의 일) ──
// 잠긴 업무 id Set — 다붓이 답 캐시·짝·아침 고리·자주 묻는 질문이 leaderCardIds와 **합쳐서** 쓴다(visibility.leaderCited에 넘기는 Set).
// 칸이 없으면(0099 전) 던진다 — 부르는 쪽이 닫힌 쪽으로 받는다(leaderCardIds와 같은 약속).
export async function lockedCardIds(db) {
  const { data, error } = await db.from('cards').select('id').eq('locked', true);
  if (error) throw error;
  return new Set((data || []).map(c => c.id));
}

// 서버 키에 '안 보이는 업무' 전부 — 리더 프로젝트의 업무 ∪ 직접 선택(0105)의 업무 ∪ 잠긴 업무(20차 ⑩ · visibility.leaderCited에 넘기는 Set).
// 하나라도 못 읽으면 던진다 — 부르는 쪽이 닫힌 쪽으로 받는다.
export async function unseenCardIds(db) {
  const [leaders, custom, locked] = await Promise.all([leaderCardIds(db), customCardIds(db), lockedCardIds(db)]);
  return new Set([...leaders, ...custom, ...locked]);
}

// 묻는 사람에게 가려진 id(잠긴 업무 · 그 댓글 · 그 첨부) — **그 사람 세션 클라이언트로** 부른다(locked_hidden_ids · 0099).
// 맞힌 계정·만든 사람·마스터에게는 그 업무가 빠진다. 서버 키로 부르면 잠긴 것 전부다.
export async function lockedHiddenFor(db) {
  const { data, error } = await db.rpc('locked_hidden_ids');
  if (error) throw error;
  return new Set(Array.isArray(data) ? data : []);
}

// 이 업무가 잠겼나(앱 알림의 푸시 미리보기 — 본문·댓글 글을 싣지 않는다). 없는 업무면 false.
export async function lockedOf(db, cardId) {
  if (!cardId) return false;
  const { data, error } = await db.from('cards').select('locked').eq('id', cardId).maybeSingle();
  if (error) throw error;
  return !!data?.locked;
}
