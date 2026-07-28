import * as cloud from './cloud.js';
import { statusToDb, statusFromDb } from './cloud.js';
import { normalize } from '../utils.js';

// ============================================================================
// 7. Cloud Sync Adapter — 클라우드(DB) ↔ 앱 스토어 모양 변환 + 쓰기 오케스트레이션
// ----------------------------------------------------------------------------
// UI 컴포넌트는 기존 앱 데이터 모양을 그대로 쓰고, 여기서만 DB 컬럼과 매핑한다.
//   task.teams(팀명 배열) ↔ card_teams(team_id)
//   task.status('시작 전'…) ↔ cards.status('todo'…)  (statusToDb/FromDb)
//   comment.author(표시명) ↔ comments.author_id       (profiles 맵)
// ============================================================================

// 모듈 캐시: 로드 시 프라이밍되어 쓰기 매핑에 재사용
let teamIdToName = new Map();
let teamNameToId = new Map();
let profileIdToName = new Map();
let memberNames = [];

const primeMaps = (teams, profiles) => {
  teamIdToName = new Map(teams.map(t => [t.id, t.name]));
  teamNameToId = new Map(teams.map(t => [t.name, t.id]));
  profileIdToName = new Map(profiles.map(p => [p.id, p.display_name || '']));
  // 담당자·멘션 자동완성은 가나다순으로 보여준다(호출부 전체가 이 순서를 물려받음)
  memberNames = [...new Set(profiles.map(p => p.display_name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
};

// 멘션·담당자 자동완성용 멤버 표시명 목록(클라우드 로드 후 프라이밍됨)
export function getMemberNames() { return memberNames.slice(); }

// ── @멘션 추출 · 수신자 매핑 ────────────────────────────────────────────────
// 텍스트에서 @이름을 뽑아 표시명 정확 일치로 profiles.id를 찾는다.
// 표시명에 공백이 있는 경우는 다루지 않는다(@뒤 공백 없는 토큰만).
export function extractMentions(text) {
  const found = String(text || '').match(/@([^\s@]+)/g) || [];
  // 앞의 '@' 제거 + 문장부호로 끝나는 경우 보정( "@민수," → "민수" )
  const names = found.map(t => t.slice(1).replace(/[.,!?;:)\]}'"]+$/, '')).filter(Boolean);
  return [...new Set(names)];
}

// 표시명 → 프로필 id들 (정확 일치). 동명 프로필이 여럿이면 전원 매핑.
// 본인 제외는 이름이 아니라 auth user id 기준으로 notifyMentions에서 최종 수행한다
// (표시 이름은 로그인 직후 구글 이름 ↔ 프로필 이름 사이에서 흔들릴 수 있어 신뢰 불가).
function nameToIdsMap() {
  const nameToIds = new Map();
  for (const [id, name] of profileIdToName.entries()) {
    if (!name) continue;
    if (!nameToIds.has(name)) nameToIds.set(name, []);
    nameToIds.get(name).push(id);
  }
  return nameToIds;
}

export function resolveMentionRecipients(text, excludeName) {
  const nameToIds = nameToIdsMap();
  const ids = [];
  for (const name of extractMentions(text)) {
    if (excludeName && name === excludeName) continue;
    ids.push(...(nameToIds.get(name) || []));
  }
  return [...new Set(ids)];
}

// 표시명 하나 → 프로필 id들 (동명이면 전원). 답글 알림 대상 찾기용.
export function resolveNameRecipients(name) {
  if (!name) return [];
  return [...new Set(nameToIdsMap().get(name) || [])];
}

// 현재 로그인 사용자 id (실패 시 null — 알림 생성을 막지는 않는다)
async function myUserId() {
  try {
    const { data } = await cloud.getSession();
    return data?.session?.user?.id || null;
  } catch {
    return null;
  }
}

// 업무 상세 내용 저장 시: 이전 본문에 없던 새 멘션만 알림 대상
export function newMentionsOnly(nextText, prevText, excludeName) {
  const before = new Set(extractMentions(prevText));
  const added = extractMentions(nextText).filter(n => !before.has(n));
  if (!added.length) return [];
  return resolveMentionRecipients(added.map(n => `@${n}`).join(' '), excludeName);
}

// 멘션 알림 생성 (실패는 조용히 삼킨다 — 본 저장 흐름을 막지 않는다)
// 본인 제외는 여기서 auth user id로 최종 차단한다 — 자기 자신에게는 절대 알림이 가지 않는다.
export async function notifyMentions(text, { actorName, cardId, projectId, recipientIds }) {
  let ids = recipientIds ?? resolveMentionRecipients(text, actorName);
  const myId = await myUserId();
  if (myId) ids = ids.filter(id => id !== myId);
  if (!ids.length) return;
  try {
    await cloud.insertNotifications(ids, { kind: 'mention', actorName, cardId, projectId, preview: String(text || '').slice(0, 80) });
  } catch (e) {
    console.error('[cloud] 멘션 알림 생성 실패:', e);
  }
}

// 댓글/답글 1건에 대한 알림 — 멘션 알림 + (답글이면) 원 댓글 작성자 알림.
// 같은 사람이 양쪽에 걸리면 멘션 쪽만 보낸다(중복 알림 방지).
// 본인 제외는 auth user id 기준 — 자기 댓글에 자기가 답글 달면 알림 없음.
export async function notifyComment(text, { actorName, cardId, projectId, replyToName }) {
  const myId = await myUserId();
  const notMe = (id) => id !== myId;
  const mentionIds = resolveMentionRecipients(text, actorName).filter(notMe);
  const mentioned = new Set(mentionIds);
  const replyIds = replyToName
    ? resolveNameRecipients(replyToName).filter(id => notMe(id) && !mentioned.has(id))
    : [];
  const preview = String(text || '').slice(0, 80);
  const meta = { actorName, cardId, projectId, preview };
  try {
    if (mentionIds.length) await cloud.insertNotifications(mentionIds, { ...meta, kind: 'mention' });
    if (replyIds.length) await cloud.insertNotifications(replyIds, { ...meta, kind: 'reply' });
  } catch (e) {
    console.error('[cloud] 댓글 알림 생성 실패:', e);
  }
}

export const listMyNotifications = cloud.listMyNotifications;
export const markNotificationRead = cloud.markNotificationRead;
export const markAllNotificationsRead = cloud.markAllNotificationsRead;
export const subscribeMyNotifications = cloud.subscribeMyNotifications;

// ── DB → 앱 매핑 ─────────────────────────────────────────────────────────────
// 담당자: card_assignees(profile_id)가 원본이고 표시명은 여기서 파생한다 —
// 그래서 프로필 이름을 바꾸면 담당자 이름이 따라온다(예전에는 cards.assignees에
// 박힌 옛 이름이 그대로 남아 그 사람의 '내 업무'에서 카드가 사라졌다).
// 조인 행이 없으면 cards.assignees 컬럼으로 폴백한다 — 0013 적용 전 코드로 만든
// 카드, 그리고 프로필과 이름이 안 맞아 백필되지 않은 담당자(오타·미가입자)를
// 화면에서 지우지 않기 위해서다.
const assigneeNames = (card) => {
  const joined = (card.card_assignees || []).map(ca => profileIdToName.get(ca.profile_id)).filter(Boolean);
  return joined.length ? joined : (card.assignees || []);
};

const cardToTask = (card) => ({
  id: card.id,
  projectId: card.project_id,
  title: card.title,
  content: card.description || '',
  status: statusFromDb(card.status),
  assignees: assigneeNames(card),
  teams: (card.card_teams || []).map(ct => teamIdToName.get(ct.team_id)).filter(Boolean),
  startDate: card.start_date || '',
  dueDate: card.due_date || '',
  position: card.position ?? 0,
  author: profileIdToName.get(card.created_by) || '',
  created_by: card.created_by || null,
  createdAt: card.created_at,
  updatedAt: card.updated_at,
  // 마지막으로 고친 사람 (0010 트리거가 채운다). 한 번도 수정되지 않았으면 빈 값
  updatedBy: card.updated_by ? (profileIdToName.get(card.updated_by) || '') : '',
  comments: [],
  activityLog: [],
  attachments: [],
});

const commentToApp = (c) => ({
  id: c.id,
  author: profileIdToName.get(c.author_id) || '알 수 없음',
  text: c.body,
  timestamp: c.created_at,
  parentId: c.parent_id || null,
  edited: !!c.edited,
});

const activityToApp = (a) => ({
  id: a.id,
  action: a.action,
  author: profileIdToName.get(a.actor_id) || '알 수 없음',
  timestamp: a.created_at,
});

const projectToApp = (p, linksByProject) => ({
  id: p.id,
  title: p.name,
  // 보관된 프로젝트는 탭·대시보드에서 빠지지만 지워진 것은 아니다(보관함에서 본다).
  // createdAt은 보관함의 연도 묶음에 쓴다 — 연도 컬럼을 따로 두지 않는 이유다.
  archived: !!p.archived,
  createdAt: p.created_at,
  pinnedLinks: (linksByProject.get(p.id) || []).map(l => ({ id: l.id, title: l.title, url: l.url })),
});

// ── 초기 로드: 전체를 병렬 조회 → 앱 스토어 모양으로 정규화 ──────────────────
// 댓글·활동은 여기서 읽지 않는다 — 업무 창 안에서만 보이는 데이터라, 창을 열 때
// 그 카드 것만 읽는다(loadCardDetail). 워크스페이스 전체를 읽으면 업무 100건
// 기준으로도 댓글 수백 행·활동 수천 행이 되고, 그걸 실시간 변경마다 모든 접속자가
// 다시 읽고 있었다.
export async function loadCloudState() {
  const [teams, profiles, projects, cards, links, files, initialProfile, sessionRes, profileTeams] = await cloud.withClockSkewRetry(() => Promise.all([
    cloud.listTeams(), cloud.listProfiles(), cloud.listProjects(), cloud.listAllCards(),
    cloud.listAllLinks(), cloud.listAllFiles(), cloud.getMyProfile(),
    cloud.getSession(), cloud.listProfileTeams(),
  ]));

  // 가입 트리거가 프로필 행을 못 만든 경우 클라이언트가 직접 자기 행을 생성(자가 복구)
  let myProfile = initialProfile;
  const sessionUser = sessionRes?.user;
  if (!myProfile && sessionUser) {
    try {
      myProfile = await cloud.ensureMyProfile(sessionUser);
      if (myProfile && !profiles.some(p => p.id === myProfile.id)) profiles.push(myProfile);
    } catch (e) {
      console.error('[cloud] 프로필 자가 복구 실패:', e);
    }
  }

  primeMaps(teams, profiles);

  const linksByProject = new Map();
  links.forEach(l => { if (!linksByProject.has(l.project_id)) linksByProject.set(l.project_id, []); linksByProject.get(l.project_id).push(l); });

  const filesByCard = new Map();
  files.forEach(f => { if (!f.card_id) return; if (!filesByCard.has(f.card_id)) filesByCard.set(f.card_id, []); filesByCard.get(f.card_id).push(f); });

  const tasks = cards.map(card => {
    const t = cardToTask(card);
    t.attachments = filesByCard.get(card.id) || [];
    return t;   // comments·activityLog는 창을 열 때 채운다(loadCardDetail)
  });

  const projectsApp = projects.map(p => projectToApp(p, linksByProject));

  // 소속 팀 여럿 (profile_teams). 테이블이 없으면 빈 배열이라 대표 팀만 남는다.
  // team(대표) = 아바타 색·기본 팀 보드, teams(전체) = '내 팀 업무' 집계
  const myTeamNames = (profileTeams || [])
    .filter(r => myProfile && r.profile_id === myProfile.id)
    .map(r => teamIdToName.get(r.team_id))
    .filter(Boolean);
  const primaryTeam = myProfile?.team_id ? (teamIdToName.get(myProfile.team_id) || '') : '';
  const allTeams = [...new Set([primaryTeam, ...myTeamNames].filter(Boolean))];
  const currentUser = myProfile
    ? { name: myProfile.display_name || '', team: primaryTeam || allTeams[0] || '', teams: allTeams }
    : { name: '', team: '', teams: [] };

  return {
    state: { currentUser, projects: normalize(projectsApp), tasks: normalize(tasks) },
    profile: myProfile,
  };
}

// ── 카드 1건 읽기 ────────────────────────────────────────────────────────────
// 업무 창을 열 때의 상세(댓글·활동). 초기 로드에서 빠진 것을 여기서 채운다.
export async function loadCardDetail(cardId) {
  const [comments, activity] = await cloud.withClockSkewRetry(() => Promise.all([
    cloud.listComments(cardId), cloud.listCardActivity(cardId),
  ]));
  return {
    comments: (comments || []).map(commentToApp),
    activityLog: (activity || []).map(activityToApp),
  };
}

// 실시간으로 카드가 바뀌었을 때 그 한 건만 다시 읽어 덮어쓸 필드.
// 댓글·활동·첨부는 넘기지 않는다 — 스토어에 이미 담아둔 것을 지우지 않기 위해.
// 이미 지워진 카드면 null.
export async function loadCardPatch(cardId) {
  const card = await cloud.withClockSkewRetry(() => cloud.getCard(cardId));
  if (!card) return null;
  const { comments, activityLog, attachments, ...patch } = cardToTask(card);
  return patch;
}

// ── 앱 → DB 쓰기 (컨트롤러가 로컬 반영 후 호출; id는 로컬 uuid 재사용) ───────
const cardPatch = (task) => ({
  project_id: task.projectId,
  title: task.title,
  description: task.content || null,
  status: statusToDb(task.status),
  start_date: task.startDate || null,
  due_date: task.dueDate || null,
  assignees: task.assignees || [],
  position: task.position ?? 0,
});

// 모든 쓰기 경로도 시계 오차(PGRST303) 재시도로 감싼다
const write = cloud.withClockSkewRetry;

// 표시명 → 프로필 id. 담당자 선택기는 등록된 멤버만 고를 수 있으므로 여기서
// 못 찾는 이름은 프로필이 사라진 경우뿐이고, 그때는 조인 행 없이 cards.assignees
// 컬럼에만 남는다(cardToTask가 폴백으로 읽는다).
// ponytail: 표시명이 같은 사람이 둘이면 첫 번째로 붙는다. 이 앱은 담당자·멘션·
// 아바타가 전부 이름 기준이라 어차피 두 사람을 구분하지 못한다 — 구분이 필요해지면
// 선택기가 id를 다루도록 고쳐야 하고, 그때 여기도 같이 고친다.
const assigneeIdsOf = (names = []) => {
  const nameToIds = nameToIdsMap();
  return [...new Set(names.map(n => nameToIds.get(n)?.[0]).filter(Boolean))];
};

export async function cardUpsertCloud(task, isNew) {
  const teamIds = (task.teams || []).map(n => teamNameToId.get(n)).filter(Boolean);
  // 프로필 맵이 비어 있으면(=아직 로드되지 않았다) 이름을 id로 바꿀 수 없다.
  // 그때 빈 배열을 넘기면 updateCard가 담당자 조인 행을 통째로 지운다 → undefined를
  // 넘겨 "건드리지 말라"로 둔다. 지금 흐름에서는 로드 후에만 저장하지만,
  // 조용히 데이터가 지워지는 모양은 남겨두지 않는다.
  const assigneeIds = profileIdToName.size ? assigneeIdsOf(task.assignees) : undefined;
  if (isNew) return write(() => cloud.createCard({ id: task.id, ...cardPatch(task) }, teamIds, assigneeIds));
  return write(() => cloud.updateCard(task.id, cardPatch(task), teamIds, assigneeIds));
}
export async function cardDeleteCloud(id) { return write(() => cloud.deleteCard(id)); }

export async function activityAddCloud(entries, projectId, cardId) {
  for (const e of entries) {
    await write(() => cloud.insertActivity({ id: e.id, project_id: projectId, card_id: cardId, action: e.action }));
  }
}

export async function commentAddCloud(comment, cardId) {
  return write(() => cloud.addComment(cardId, comment.text, comment.parentId || null, comment.id));
}
export async function commentUpdateCloud(commentId, text) { return write(() => cloud.updateComment(commentId, text)); }
export async function commentDeleteCloud(commentId) { return write(() => cloud.deleteComment(commentId)); }

export async function projectCreateCloud(project) {
  return write(() => cloud.createProject({ id: project.id, name: project.title }));
}
// DB 컬럼명은 name (앱에서는 title로 부른다)
export async function projectRenameCloud(id, title) { return write(() => cloud.updateProject(id, { name: title })); }
export async function projectArchiveCloud(id, archived) { return write(() => cloud.updateProject(id, { archived })); }
export async function projectDeleteCloud(id) { return write(() => cloud.deleteProject(id)); }

export async function linkAddCloud(projectId, link) { return write(() => cloud.addLink(projectId, link.title, link.url, link.id)); }
export async function linkRemoveCloud(id) { return write(() => cloud.removeLink(id)); }

// teams(여러 팀)를 주면 profile_teams까지 갱신한다. 대표 팀은 그 중 첫 번째.
export async function profileUpdateCloud({ name, team, teams }) {
  const list = (teams && teams.length ? teams : [team]).filter(Boolean);
  const patch = { display_name: name };
  const teamId = list[0] ? teamNameToId.get(list[0]) : null;
  if (teamId) patch.team_id = teamId;
  return write(async () => {
    const saved = await cloud.updateMyProfile(patch);
    await cloud.setMyTeams(list.map(t => teamNameToId.get(t)).filter(Boolean));
    return saved;
  });
}

// ── 실시간 구독 라우팅 ───────────────────────────────────────────────────────
// 예전에는 어떤 변경이든 "워크스페이스 전체 재조회" 하나로 처리했다. 카드 한 장을
// 드래그하면 접속한 모든 사람이 전체를 다시 읽었다(쿼리 11개). 표에 따라 갈라
// 필요한 만큼만 읽는다.
//   cards        → 그 카드 1건만 다시 읽기 (삭제는 바로 제거)
//   comments/files → 목록 화면에 안 나오는 데이터 → 열려 있는 업무 창일 때만 상세 갱신
//   그 외(projects·resource_links) → 전체 재조회 (드문 변경)
// comments의 DELETE payload에는 card_id가 없다(replica identity가 PK뿐) → cardId가
// 비면 "지금 열려 있는 카드"로 본다. 호출부가 그렇게 처리한다.
export function subscribeWorkspace({ onCard, onCardDelete, onCardDetail, onFullReload }) {
  return cloud.subscribeAll((payload) => {
    const table = payload?.table;
    const row = payload?.new || {};
    const old = payload?.old || {};
    if (table === 'cards') {
      if (payload.eventType === 'DELETE') onCardDelete(old.id);
      else onCard(row.id || old.id);
      return;
    }
    if (table === 'comments' || table === 'files') {
      onCardDetail(row.card_id || old.card_id || null);
      return;
    }
    onFullReload();
  });
}

// Supabase 에러를 사람이 읽을 한 줄로 (message + code + details)
export function formatCloudError(err) {
  if (!err) return '알 수 없는 오류';
  const parts = [];
  if (err.message) parts.push(err.message);
  if (err.code) parts.push(`code ${err.code}`);
  if (err.details) parts.push(err.details);
  if (err.hint) parts.push(err.hint);
  return parts.length ? parts.join(' · ') : String(err);
}
