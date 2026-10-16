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

// ── 직접 고른 사람만(시안 2026-10-16 · **게스트에서만** — DB 칸·정책이 없다. 클라우드는 이 값을 쓰지도 읽지도 않는다) ──
// 프로젝트 행에 visibility 'custom' + viewers(이름 배열 — 고른 사람 전부) + viewerTeams(펼친 팀 칩 · 고른 차례).
// 정한 사람(visibilityBy)은 늘 본다. 팀 칩은 그 팀 사람을 한 번에 넣는 손잡이일 뿐이고 보는 사람은 viewers 하나가 정한다.
export const CUSTOM = 'custom';
export const isCustomOnly = (project) => project?.visibility === CUSTOM;
// 누가 보나가 좁혀진 프로젝트(리더만 · 직접 고른 사람만) — 탭 자물쇠·폰 제목 자물쇠
export const isRestricted = (project) => isLeaderOnly(project) || isCustomOnly(project);
// 이 사람(이름)에게 보이나 — 직접 고른 사람만일 때만 가른다(리더만은 DB가 행을 안 줘서 애초에 스토어에 없다)
export const canSeeProject = (project, me) => !isCustomOnly(project)
  || (project.viewers || []).includes(me) || (!!me && project.visibilityBy === me);

// 팀 칩을 켜고 끌 때 viewers를 고친다(순수 · people = [{ name, teams }]).
// 켜면 그 팀 사람을 **전부 넣고**(골라 뺄 수 있게 기본은 다 체크) 칩을 뒤에 붙인다.
// 끄면 그 팀에만 걸려 있던 사람을 뺀다 — 다른 켜진 팀에도 있는 사람·팀 밖에서 따로 더한 사람·나(keep)는 남긴다.
export function toggleViewerTeam({ viewers = [], viewerTeams = [] }, team, people = [], keep = '') {
  const inTeam = (p, t) => (p.teams || []).includes(t);
  if (!viewerTeams.includes(team)) {
    const add = people.filter(p => inTeam(p, team)).map(p => p.name);
    return { viewers: [...new Set([...viewers, ...add])], viewerTeams: [...viewerTeams, team] };
  }
  const rest = viewerTeams.filter(t => t !== team);
  const drop = new Set(people.filter(p => inTeam(p, team) && !rest.some(t => inTeam(p, t))).map(p => p.name));
  drop.delete(keep);
  return { viewers: viewers.filter(n => !drop.has(n)), viewerTeams: rest };
}

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
// 위키 장 근거(page cite)는 장 id뿐이라 그 장의 실린 블록이 가리킨 업무(answer.wikiCards · api/_wikiAsk.js)로 본다(20차 ⑦).
export function leaderCited(answer, hiddenCards) {
  if (!answer || !hiddenCards?.size) return false;
  const cites = (answer.sentences || []).flatMap(s => s.cites || []);
  return cites.some(c => (c.t === 'card' && hiddenCards.has(c.id)) || (c.t === 'file' && hiddenCards.has(c.cardId)))
    || (answer.files || []).some(f => hiddenCards.has(f.card_id))
    || (answer.wikiCards || []).some(id => hiddenCards.has(id));
}
