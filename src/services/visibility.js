// ============================================================================
// 리더만 보는 프로젝트(0092) — 판정 한 벌(import 0 · 앱·서버·노드 검사가 같이 문다)
// ----------------------------------------------------------------------------
// 실제 경계는 DB다(0092 정책 · hidden_ids). 여기는 **RLS를 안 타는 자리**가 같은 규칙을 쓰게 모은 것이다:
//   앱   — 알림 받는 사람·멘션 후보 거르기(cloudSync) · 자물쇠·칩을 세울지(projectView·mobileNav·업무 창)
//   서버 — 서비스 키 경로(api/_wiki/gather.js 위키 장 · api/share.js 공유 카드 · api/push.js 알림 · api/ics.js 달력 ·
//          api/_wikiAsk.js 다붓이 답 캐시·짝 — leaderCited)
// 리더 = 마스터·관리자·교역자·그 해 임원진(leader_profile_ids()와 같은 판정 · 순장은 아니다).
// 게스트(localStorage)에는 리더 판정이 없다 — 자물쇠를 숨기지 않고 로컬 값으로 돈다(스위트가 게스트로 돈다).
// ============================================================================

export const LEADERS = 'leaders';

// 프로젝트 행(앱 모양이든 DB 모양이든) — visibility가 없으면(0092 전 · 게스트의 옛 저장) 공개다
export const isLeaderOnly = (project) => project?.visibility === LEADERS;

// 자물쇠를 세울까 — 클라우드는 리더에게만, 게스트는 언제나(로컬 값)
export const canSetVisibility = ({ cloudOn, amLeader }) => (cloudOn ? amLeader === true : true);

// 알림 받는 사람 — 리더 프로젝트의 업무면 리더에게만. 리더 목록을 못 읽었으면(빈 Set) **아무에게도** 안 간다
// (통과가 기본값인 거르개는 깨져도 소리가 안 난다 — PITFALLS §6-29 · 여기서는 닫힌 쪽이 기본이다).
export function visibleRecipients(ids, { leaderOnly = false, leaderIds = new Set() } = {}) {
  const list = (ids || []).filter(Boolean);
  return leaderOnly ? list.filter(id => leaderIds.has(id)) : list;
}

// 서버 키로 통째로 읽은 원본에서 리더 프로젝트 몫을 걷는다(위키 장). 업무가 원본이다 — 댓글·첨부는 업무로 가른다.
// 주보 첨부(card_id 없음)는 그대로 둔다. 업무를 못 찾는 댓글·첨부(지운 업무의 흔적)도 그대로다(예전 그대로).
export function dropLeaderOnly({ projects = [], cards = [], comments = [], files = [] } = {}) {
  const hiddenProjects = new Set(projects.filter(isLeaderOnly).map(p => p.id));
  if (!hiddenProjects.size) return { projects, cards, comments, files };
  const hiddenCards = new Set(cards.filter(c => hiddenProjects.has(c.project_id)).map(c => c.id));
  return {
    projects: projects.filter(p => !hiddenProjects.has(p.id)),
    cards: cards.filter(c => !hiddenCards.has(c.id)),
    comments: comments.filter(c => !hiddenCards.has(c.card_id)),
    files: files.filter(f => !(f.card_id && hiddenCards.has(f.card_id))),
  };
}

// 리더 프로젝트의 업무 id Set — dropLeaderOnly가 걷는 업무와 같다(위키 장 gather · api/_leaders.leaderCardIds)
export function leaderCardIdsOf({ projects = [], cards = [] } = {}) {
  const kept = new Set(dropLeaderOnly({ projects, cards }).cards.map(c => c.id));
  return new Set(cards.filter(c => !kept.has(c.id)).map(c => c.id));
}

// 다붓이 답(answer jsonb · 화면에 준 답)이 리더 프로젝트 기록에 기댔나 — 문장 근거의 업무 · 첨부(cardId)와 파일 카드(card_id).
// 댓글은 업무 기록 안에 실리고 뜻 찾기 조각도 그 업무로 묶이므로(card cite) 업무로 갈린다. 저장된 옛 답에도 같은 판정이다(20차 ⑥).
export function leaderCited(answer, hiddenCards) {
  if (!answer || !hiddenCards?.size) return false;
  const cites = (answer.sentences || []).flatMap(s => s.cites || []);
  return cites.some(c => (c.t === 'card' && hiddenCards.has(c.id)) || (c.t === 'file' && hiddenCards.has(c.cardId)))
    || (answer.files || []).some(f => hiddenCards.has(f.card_id));
}
