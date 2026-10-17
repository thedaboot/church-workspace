// ============================================================================
// 리더만 보는 프로젝트(0092) · 보는 사람 직접 선택(0105) — 판정 한 벌(import 0 · 앱·서버·노드 검사가 같이 문다)
// ----------------------------------------------------------------------------
// 실제 경계는 DB다(0092·0105 정책 · hidden_ids). 여기는 **RLS를 안 타는 자리**가 같은 규칙을 쓰게 모은 것이다:
//   앱   — 알림 받는 사람·멘션 후보 거르기(cloudSync) · 자물쇠·칩을 세울지(projectView·mobileNav·업무 창)
//   서버 — 서비스 키 경로(api/_wiki/gather.js 위키 장 · api/share.js 공유 카드 · api/push.js 알림 · api/ics.js 달력 ·
//          api/_wikiAsk.js 다붓이 답 캐시·짝 — leaderCited)
// 리더 = 마스터·관리자·교역자·그 해 임원진·그 해 팀장·예배팀장(leader_profile_ids()와 같은 판정 · 순장은 아니다 · 0107). 지난해 리더 프로젝트는 그해 리더도(0110 · leaderAudience).
// 직접 선택(custom) = 고른 사람(project_viewers) + 마스터(project_audiences()가 그 id 배열을 준다).
// 서버 키에는 '좁혀진 프로젝트'(리더만 · 직접 선택)가 다 '안 보이는 프로젝트'다 — 누구 몫인지 모르는 자리(위키 장 · 공유 카드 ·
// 다붓이 캐시를 남기기)는 둘을 같이 걷고, 받는 사람이 정해진 자리(푸시 · 달력)는 그 사람이 audience에 드는지 본다.
// 게스트(localStorage)에는 리더 판정이 없다 — 자물쇠를 숨기지 않고 로컬 값으로 돈다(스위트가 게스트로 돈다).
// ============================================================================

export const LEADERS = 'leaders';
export const CUSTOM = 'custom';

// 프로젝트 행(앱 모양이든 DB 모양이든) — visibility가 없으면(0092 전 · 게스트의 옛 저장) 공개다
export const isLeaderOnly = (project) => project?.visibility === LEADERS;
// 고른 사람만(0105)
export const isCustomOnly = (project) => project?.visibility === CUSTOM;
// 누가 보나가 좁혀진 프로젝트(리더만 · 고른 사람만) — 탭 자물쇠·폰 제목 자물쇠 · 서버 키 경로의 '안 보이는 프로젝트'
export const isRestricted = (project) => isLeaderOnly(project) || isCustomOnly(project);
// DB 칸 값 → 앱 값(모르는 값·없는 칸은 공개)
export const visibilityOf = (project) => (isRestricted(project) ? project.visibility : 'all');

// 팀 칩을 켜고 끌 때 고른 사람(이름 배열)을 고친다(순수 · people = [{ name, teams }] · 시안 승인 2026-10-17).
// 켜면 그 팀 사람을 **전부 넣고**(골라 뺄 수 있게 기본은 다 체크) 칩을 뒤에 붙인다.
// 끄면 그 팀에만 걸려 있던 사람을 뺀다 — 다른 켜진 팀에도 있는 사람·팀 밖에서 따로 더한 사람·나(keep)는 남긴다.
// 팀 칩은 사람을 한 번에 넣는 손잡이일 뿐이고 보는 사람은 viewers 하나가 정한다(DB도 project_viewers 하나).
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

// 이 프로젝트가 나에게 보이나(앱 화면 — 업무 링크 카드·멘션 칩 · RichText) — 스토어에 있나 하나다. 클라우드는 RLS(hidden_ids ·
// 리더만 0092 · 직접 선택 0105 · 휴지통 0104 · 지난해 리더 0110)가 안 보이는 행을 애초에 안 주고, 게스트에는 보는 사람 판정이 없다.
// 판정을 바꿀 일이 생기면 여기 한 곳을 고친다(합치기 2026-10-17 — A 묶음의 지역 seeable을 옮겼다).
export const canSeeProject = (project) => !!project;

// 리더만 보는 프로젝트를 볼 수 있는 계정 — 올해 리더(leader_profile_ids) ∪ 그 프로젝트 몫(project_audiences 줄 · 0110부터 그해 리더가
// 들어 있다 — 지난해 리더 프로젝트의 지난해 리더). 몫을 못 읽었으면 올해 리더만(0110 전과 같다).
export function leaderAudience(leaderIds = new Set(), projectAud = null) {
  if (!projectAud || !projectAud.size) return leaderIds;
  return new Set([...leaderIds, ...projectAud]);
}

// 자물쇠를 세울까 — 클라우드는 리더에게만, 게스트는 언제나(로컬 값)
export const canSetVisibility = ({ cloudOn, amLeader }) => (cloudOn ? amLeader === true : true);

// 알림 받는 사람 — 좁혀진 프로젝트의 업무면 볼 수 있는 사람(leaderIds — 리더 목록이거나 직접 선택의 audience)에게만.
// 그 목록을 못 읽었으면(빈 Set) **아무에게도** 안 간다
// (통과가 기본값인 거르개는 깨져도 소리가 안 난다 — PITFALLS §6-29 · 여기서는 닫힌 쪽이 기본이다).
export function visibleRecipients(ids, { leaderOnly = false, leaderIds = new Set() } = {}) {
  const list = (ids || []).filter(Boolean);
  return leaderOnly ? list.filter(id => leaderIds.has(id)) : list;
}

// 서버 키로 통째로 읽은 원본에서 좁혀진 프로젝트(리더만 · 직접 선택 · 0105) 몫을 걷는다(위키 장). 업무가 원본이다 — 댓글·첨부는 업무로 가른다.
// 주보 첨부(card_id 없음)는 그대로 둔다. 업무를 못 찾는 댓글·첨부(지운 업무의 흔적)도 그대로다(예전 그대로).
// 이름은 0092 때 것 그대로 둔다(위키 장·검사가 이 이름으로 문다) — 뜻은 '리더만 ∪ 직접 선택'이다.
export function dropLeaderOnly({ projects = [], cards = [], comments = [], files = [] } = {}) {
  const hiddenProjects = new Set(projects.filter(isRestricted).map(p => p.id));
  if (!hiddenProjects.size) return { projects, cards, comments, files };
  const hiddenCards = new Set(cards.filter(c => hiddenProjects.has(c.project_id)).map(c => c.id));
  return {
    projects: projects.filter(p => !hiddenProjects.has(p.id)),
    cards: cards.filter(c => !hiddenCards.has(c.id)),
    comments: comments.filter(c => !hiddenCards.has(c.card_id)),
    files: files.filter(f => !(f.card_id && hiddenCards.has(f.card_id))),
  };
}

// 좁혀진 프로젝트(리더만 · 직접 선택)의 업무 id Set — dropLeaderOnly가 걷는 업무와 같다(위키 장 gather · api/_leaders.leaderCardIds·customCardIds)
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
