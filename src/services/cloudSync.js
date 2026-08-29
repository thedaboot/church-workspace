import * as cloud from './cloud.js';
import { statusToDb, statusFromDb } from './cloud.js';
import { normalize, httpsImage, extractMentions } from '../utils.js';

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
let nameToAvatar = new Map();
let memberNames = [];

const primeMaps = (teams, profiles) => {
  teamIdToName = new Map(teams.map(t => [t.id, t.name]));
  teamNameToId = new Map(teams.map(t => [t.name, t.id]));
  profileIdToName = new Map(profiles.map(p => [p.id, p.display_name || '']));
  // 앱 안에서 사람은 표시명으로 다닌다(담당자·댓글 작성자·활동 기록 전부 이름) —
  // 사진도 같은 열쇠로 찾게 둔다. 동명이인이 있으면 먼저 온 사람의 사진이 남는다.
  nameToAvatar = new Map(profiles
    .filter(p => p.display_name && p.avatar_url)
    .map(p => [p.display_name, httpsImage(p.avatar_url)]));
  // 담당자·멘션 자동완성은 가나다순으로 보여준다(호출부 전체가 이 순서를 물려받음)
  memberNames = [...new Set(profiles.map(p => p.display_name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
};

// 멘션·담당자 자동완성용 멤버 표시명 목록(클라우드 로드 후 프라이밍됨)
export function getMemberNames() { return memberNames.slice(); }

// 표시명 → 프로필 사진 주소. 없으면 빈 문자열 → 화면은 이름 첫 글자 원으로 떨어진다.
// 게스트 모드에서는 표가 비어 있어 언제나 글자 원이다.
// 이 표는 loadCloudState에서만 다시 만들어진다 — profiles를 실시간 구독하는 이유(§6-21-a).
export function getAvatar(name) { return nameToAvatar.get(name) || ''; }

// ── @멘션 추출 · 수신자 매핑 ────────────────────────────────────────────────
// 뽑는 규칙은 utils.js가 원본이다 — AI가 쓴 멘션을 검사하는 쪽(services/ai.js)도
// 같은 규칙을 써야 하는데, ai.js는 노드에서 검사할 수 있어야 해서 이 파일(supabase를
// 물고 있다)을 물면 안 된다. 여기서는 그대로 다시 내보내 부르는 쪽을 안 건드린다.
export { extractMentions };

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
function resolveNameRecipients(name) {
  if (!name) return [];
  return [...new Set(nameToIdsMap().get(name) || [])];
}

// 현재 로그인 사용자 id (실패 시 null — 알림 생성을 막지는 않는다)
//
// 여기는 한동안 `const { data } = await cloud.getSession()`으로 한 겹을 더 벗기고
// 있었다. cloud.getSession()은 supabase의 { data } 를 이미 벗겨서 { session, user }를
// 돌려주므로 data가 언제나 undefined였고, **본인 제외가 한 번도 걸리지 않았다.**
// 멘션은 이름으로도 한 번 걸러서(resolveMentionRecipients) 증상이 가려졌지만,
// 내 댓글에 내가 답글을 달면 나에게 알림이 왔다. 담당자 알림을 붙이면서 드러났다.
async function myUserId() {
  try {
    const { user } = await cloud.getSession();
    return user?.id || null;
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

// 업무 저장 시: 이전에 없던 담당자만 알림 대상. 하위 업무 체크처럼 저장이 자주
// 불리는 경로가 있어서, 담당자 목록 전체로 알리면 같은 사람에게 매번 다시 간다
// (새 멘션만 고르는 newMentionsOnly와 같은 이유).
export function newAssigneesOnly(nextNames, prevNames, excludeName) {
  const before = new Set(prevNames || []);
  const added = (nextNames || []).filter(n => n && !before.has(n));
  if (!added.length) return [];
  const nameToIds = nameToIdsMap();
  const ids = [];
  for (const name of added) {
    if (excludeName && name === excludeName) continue;
    ids.push(...(nameToIds.get(name) || []));
  }
  return [...new Set(ids)];
}

// 담당자 지정 알림 (실패는 조용히 삼킨다 — 본 저장 흐름을 막지 않는다)
// 본인 제외는 여기서 auth user id로 최종 차단한다 — 내가 나를 담당자로 넣어도 알림 없음.
export async function notifyAssignees(recipientIds, { actorName, cardId, projectId, preview }) {
  let ids = recipientIds || [];
  const myId = await myUserId();
  if (myId) ids = ids.filter(id => id !== myId);
  if (!ids.length) return;
  try {
    await cloud.insertNotifications(ids, { kind: 'assign', actorName, cardId, projectId, preview });
  } catch (e) {
    console.error('[cloud] 담당자 알림 생성 실패:', e);
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

// 댓글 반응 알림 (0032). 받는 사람은 그 **댓글을 쓴 사람 한 명**이고, 답글 알림이
// replyToName으로 사람을 찾는 것과 같은 길이다(표시명 정확 일치 → 프로필 id).
// 본인 제외는 여기서 auth user id로 최종 차단한다 — 내 댓글에 내가 눌러도 알림 없음.
// 취소(다시 누르기)는 아무에게도 알리지 않는다: 부르는 쪽이 켤 때만 부른다.
export async function notifyReaction(authorName, { actorName, cardId, projectId, preview }) {
  const myId = await myUserId();
  let ids = resolveNameRecipients(authorName);
  if (myId) ids = ids.filter(id => id !== myId);
  if (!ids.length) return;
  try {
    await cloud.insertNotifications(ids, { kind: 'reaction', actorName, cardId, projectId, preview });
  } catch (e) {
    console.error('[cloud] 반응 알림 생성 실패:', e);
  }
}

export const touchLastSeen = cloud.touchLastSeen;
export const subscribePresence = cloud.subscribePresence;
export const savePushSubscription = cloud.savePushSubscription;
export const deletePushSubscription = cloud.deletePushSubscription;
export const listMyNotifications = cloud.listMyNotifications;
export const markNotificationRead = cloud.markNotificationRead;
export const deleteNotification = cloud.deleteNotification;
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
  driveFolderId: card.drive_folder_id || null,   // 드라이브의 이 업무 폴더(0026)
  // 하위 업무는 컬럼(jsonb) 하나다 — 카드와 언제나 같이 읽고 쓴다. 배열이 아닌 값은
  // DB 제약이 막지만, 예전 카드에는 컬럼이 없을 수 있으므로 여기서도 배열로 못 박는다.
  subtasks: Array.isArray(card.subtasks) ? card.subtasks : [],
  // 선행 업무 id들(0020). 지워진 카드를 가리키는 id가 남아 있어도 여기서 거르지 않는다 —
  // 화면(depLayers)이 무시하고, 저장할 때 그대로 두면 나중에 그 카드가 복구돼도 이어진다.
  dependsOn: Array.isArray(card.depends_on) ? card.depends_on : [],
  // 댓글·첨부 개수 — 0016 트리거가 DB에서 유지한다. 목록에서 카드를 열지 않고도
  // 대화·파일이 있는지 보여주려고 둔 것이고, 개수를 세려고 댓글을 다시 읽지 않는다.
  commentCount: card.comment_count ?? 0,
  fileCount: card.file_count ?? (card.files?.length ?? 0),
  // 고정한 AI 요약 (관리자가 '이 요약 고정'을 누른 것)
  aiSummary: card.ai_summary || '',
  aiSummaryAt: card.ai_summary_at || '',
  aiSummaryBy: card.ai_summary_by ? (profileIdToName.get(card.ai_summary_by) || '') : '',
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

const commentToApp = (c, reactionsBy) => ({
  id: c.id,
  author: profileIdToName.get(c.author_id) || '알 수 없음',
  text: c.body,
  timestamp: c.created_at,
  parentId: c.parent_id || null,
  edited: !!c.edited,
  // 반응(0032). 담당자와 같은 판단이다 — DB는 id로 가리키고 **표시명은 읽을 때
  // profiles에서 파생한다**(§6-26). 개수 컬럼을 두지 않으므로 화면이 이 배열을 센다.
  reactions: (reactionsBy?.get(c.id) || []).map(r => ({
    kind: r.kind,
    userId: r.user_id,
    name: profileIdToName.get(r.user_id) || '알 수 없음',
  })),
});

// ── 댓글 반응 (0032) ────────────────────────────────────────────────────────
// 세 종류뿐이고 순서도 화면 순서다. 여기가 원본이라 화면·검사가 같은 목록을 본다.
export const REACTION_KINDS = ['heart', 'thumbsup', 'check'];

// 반응 배열 → 종류별 요약. myKey는 클라우드면 auth user id, 게스트면 'guest'다.
// **이름으로 판정하지 않는다** — 표시명은 로그인 직후 흔들릴 수 있고, 동명이인이면
// 남이 누른 것을 내가 누른 것으로 읽는다(§6-26과 같은 이유).
export function reactionSummary(reactions = [], myKey = '') {
  return REACTION_KINDS.map(kind => {
    const people = reactions.filter(r => r && r.kind === kind);
    return {
      kind,
      count: people.length,
      mine: !!myKey && people.some(r => r.userId === myKey),
      people,
    };
  });
}

// 다시 누르면 취소, 다른 종류는 각각 따로 쌓인다(한 사람이 셋 다 누를 수 있다).
// 낙관적 반영과 서버 쓰기가 같은 판정을 보게 순수 함수 하나로 둔다.
export function toggleReaction(reactions = [], kind, me) {
  if (!me?.userId || !REACTION_KINDS.includes(kind)) return reactions;
  const mine = (r) => r && r.kind === kind && r.userId === me.userId;
  return reactions.some(mine)
    ? reactions.filter(r => !mine(r))
    : [...reactions, { kind, userId: me.userId, name: me.name || '' }];
}

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
  // createdAt은 보관함·더보기의 연도 묶음에 쓴다 — 연도 컬럼을 따로 두지 않는 이유다.
  archived: !!p.archived,
  createdAt: p.created_at,
  // 탭 순서(0021, 드래그로 정한 전원 공유 순서). 마이그레이션 전 행은 0 → 만든 순.
  position: p.position ?? 0,
  // 연도는 사람이 정한다(0025). 값이 없는 옛 행은 만든 해로 떨어진다.
  driveFolderId: p.drive_folder_id || null,
  year: p.year ?? (p.created_at ? Number(String(p.created_at).slice(0, 4)) : new Date().getFullYear()),
  pinnedLinks: (linksByProject.get(p.id) || []).map(l => ({ id: l.id, title: l.title, url: l.url })),
});

// ── 초기 로드: 전체를 병렬 조회 → 앱 스토어 모양으로 정규화 ──────────────────
// 댓글·활동은 여기서 읽지 않는다 — 업무 창 안에서만 보이는 데이터라, 창을 열 때
// 그 카드 것만 읽는다(loadCardDetail). 워크스페이스 전체를 읽으면 업무 100건
// 기준으로도 댓글 수백 행·활동 수천 행이 되고, 그걸 실시간 변경마다 모든 접속자가
// 다시 읽고 있었다.
export async function loadCloudState() {
  const [teams, profiles, projects, cards, links, files, initialProfile, sessionRes, profileTeams, activityRows] = await cloud.withClockSkewRetry(() => Promise.all([
    cloud.listTeams(), cloud.listProfiles(), cloud.listProjects(), cloud.listAllCards(),
    cloud.listAllLinks(), cloud.listAllFiles(), cloud.getMyProfile(),
    cloud.getSession(), cloud.listProfileTeams(), cloud.listRecentActivity(),
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
    ? { name: myProfile.display_name || '', team: primaryTeam || allTeams[0] || '', teams: allTeams,
        avatarUrl: httpsImage(myProfile.avatar_url || '') }
    : { name: '', team: '', teams: [] };

  // 대시보드가 사람을 세우려면 프로필 목록이 화면까지 와야 한다(0019의 생일·다녀간 시각).
  // 모듈 캐시(profileIdToName 같은 것)로 두지 않고 스토어에 담는 이유: 모듈 변수는 반응형이
  // 아니라 값이 바뀌어도 다시 그려지지 않는다 — 그게 §6-21-a의 '알 수 없음'을 만든 구조다.
  // 소속 팀 전체 — 가입한 사람 목록이 대표 팀만 보여주면 겸직(찬양팀+임원진)이 안 보인다
  const teamsByProfile = new Map();
  (profileTeams || []).forEach(r => {
    const name = teamIdToName.get(r.team_id);
    if (!name) return;
    const list = teamsByProfile.get(r.profile_id);
    if (list) list.push(name); else teamsByProfile.set(r.profile_id, [name]);
  });

  const members = profiles
    // 환송한 사람은 워크스페이스의 '사람'이 아니다(0027) — 대시보드 얼굴 줄·생일·
    // '새로 온 사람'·담당자 선택기·멘션 후보에서 모두 빠진다. 환송했는데
    // "OOO님이 함께하게 되었어요"가 그대로 떠 있었다(사용자 지적).
    .filter(p => !p.removed_at)
    .filter(p => p.display_name)
    .map(p => {
      const primary = p.team_id ? (teamIdToName.get(p.team_id) || '') : '';
      return {
        id: p.id,
        name: p.display_name,
        avatarUrl: httpsImage(p.avatar_url || ''),
        birthday: p.birthday || '',            // 'MM-DD' (연도는 저장하지 않는다)
        lastSeenAt: p.last_seen_at || '',
        joinedAt: p.created_at || '',
        // 직함·역할(0030). AI가 "OOO 청년" 대신 "조해리 총무님"이라고 부르는 근거다.
        // 화면은 쓰지 않는다 — 사람 목록에 직함을 붙이면 누가 위인지가 먼저 보인다(§8).
        role: p.role_note || '',
        team: primary,
        // 대표 팀이 먼저 오게 — 그래야 목록의 첫 팀이 아바타 색 규칙과 어긋나지 않는다
        teams: [...new Set([primary, ...(teamsByProfile.get(p.id) || [])].filter(Boolean))],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  return {
    state: {
      currentUser, members,
      activityFeed: (activityRows || []).map(activityFeedToApp),
      projects: normalize(projectsApp), tasks: normalize(tasks),
    },
    profile: myProfile,
  };
}

// 활동 한 건 → 피드 줄. 카드 제목은 여기서 붙이지 않는다 — 스토어의 tasks가 이미 알고,
// 제목이 바뀌면 피드도 따라와야 하므로 화면에서 찾는 쪽이 맞다.
const activityFeedToApp = (a) => ({
  id: a.id,
  actorName: profileIdToName.get(a.actor_id) || '알 수 없음',
  action: a.action,
  cardId: a.card_id || null,
  projectId: a.project_id || null,
  at: a.created_at,
});

// 피드만 다시 읽기 — activity 실시간 이벤트가 이걸 부른다(전체 재조회가 아니다, §6-21)
export async function loadActivityFeed() {
  const rows = await cloud.listRecentActivity();
  return (rows || []).map(activityFeedToApp);
}

// ── 카드 1건 읽기 ────────────────────────────────────────────────────────────
// 업무 창을 열 때의 상세(댓글·활동). 초기 로드에서 빠진 것을 여기서 채운다.
export async function loadCardDetail(cardId) {
  const [comments, activity, reactions] = await cloud.withClockSkewRetry(() => Promise.all([
    cloud.listComments(cardId), cloud.listCardActivity(cardId),
    // 반응은 **없어도 되는 값**이라 실패를 여기서 삼킨다 — 마이그레이션(0032)이
    // 아직 안 나간 환경에서 이 조회가 던지면 Promise.all이 통째로 깨져서
    // 댓글·활동까지 안 보인다(업무 창이 빈 채로 열린다).
    cloud.listCardReactions(cardId).catch(() => []),
  ]));
  const reactionsBy = new Map();
  for (const r of reactions || []) {
    const list = reactionsBy.get(r.comment_id);
    if (list) list.push(r); else reactionsBy.set(r.comment_id, [r]);
  }
  return {
    comments: (comments || []).map(c => commentToApp(c, reactionsBy)),
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
  // 이름이 빈 줄은 저장하지 않는다 — 수정 중에 잠깐 비우는 것은 막지 않지만
  // 그대로 저장되면 아무 뜻 없는 체크박스가 남는다
  subtasks: (Array.isArray(task.subtasks) ? task.subtasks : [])
    .filter(s => s && String(s.title || '').trim())
    .map(s => ({ id: s.id, title: String(s.title).trim(), done: !!s.done })),
  depends_on: Array.isArray(task.dependsOn) ? task.dependsOn : [],
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

// 카드 쓰기가 끝났는지 기다릴 수 있게 약속을 담아 둔다.
// 컨트롤러는 화면을 먼저 그리려고 이 쓰기를 기다리지 않는데(handleSaveTask),
// 새 업무의 첨부는 files.card_id가 cards를 참조하므로 **카드 행이 먼저 있어야** 한다.
// 기다리지 않고 올리면 외래키 위반으로 첨부가 통째로 실패한다.
const cardWrites = new Map();
// 성공이면 true, 실패면 false로 끝난다 — 기다리는 쪽이 "카드가 저장되지 않았다"를
// 자기 문구로 말할 수 있어야 한다(예전에는 첨부가 files_card_id_fkey 원문을 그대로 띄웠다).
export function cardWritePromise(id) { return cardWrites.get(id) || Promise.resolve(true); }

export async function cardUpsertCloud(task, isNew) {
  const teamIds = (task.teams || []).map(n => teamNameToId.get(n)).filter(Boolean);
  // 프로필 맵이 비어 있으면(=아직 로드되지 않았다) 이름을 id로 바꿀 수 없다.
  // 그때 빈 배열을 넘기면 updateCard가 담당자 조인 행을 통째로 지운다 → undefined를
  // 넘겨 "건드리지 말라"로 둔다. 지금 흐름에서는 로드 후에만 저장하지만,
  // 조용히 데이터가 지워지는 모양은 남겨두지 않는다.
  const assigneeIds = profileIdToName.size ? assigneeIdsOf(task.assignees) : undefined;
  const p = isNew
    ? write(() => cloud.createCard({ id: task.id, ...cardPatch(task) }, teamIds, assigneeIds))
    : write(() => cloud.updateCard(task.id, cardPatch(task), teamIds, assigneeIds));
  // 실패도 '끝남'으로 본다 — 기다리는 쪽(첨부 업로드)이 영영 매달리면 안 된다.
  // 카드가 없으면 업로드가 자기 오류로 실패하고 그 문구가 화면에 뜬다.
  cardWrites.set(task.id, p.then(() => true, () => false));
  return p;
}
export async function cardDeleteCloud(id) { return write(() => cloud.deleteCard(id)); }
export async function cardSummaryCloud(id, text) { return write(() => cloud.setCardSummary(id, text)); }

export async function activityAddCloud(entries, projectId, cardId) {
  for (const e of entries) {
    await write(() => cloud.insertActivity({ id: e.id, project_id: projectId, card_id: cardId, action: e.action }));
  }
}

export async function commentAddCloud(comment, cardId) {
  return write(() => cloud.addComment(cardId, comment.text, comment.parentId || null, comment.id));
}
export async function commentUpdateCloud(commentId, text) { return write(() => cloud.updateComment(commentId, text)); }
// 반응 켜기·끄기(0032). 화면은 먼저 그려 두고 이걸 부른다 — 실패하면 부르는 쪽이 되돌린다.
export async function commentReactionCloud(commentId, kind, on) {
  return write(() => (on ? cloud.addCommentReaction(commentId, kind) : cloud.removeCommentReaction(commentId, kind)));
}
export async function commentDeleteCloud(commentId) { return write(() => cloud.deleteComment(commentId)); }

export async function projectCreateCloud(project) {
  return write(() => cloud.createProject({
    id: project.id, name: project.title, position: project.position ?? 0,
    year: project.year ?? new Date().getFullYear(),
  }));
}
// DB 컬럼명은 name (앱에서는 title로 부른다)
export async function projectRenameCloud(id, title, year) {
  const saved = await write(() => cloud.updateProject(id, { name: title, ...(year ? { year } : {}) }));
  // 드라이브 폴더 이름도 따라간다(CRUD 싱크). 폴더가 아직 없으면 만들지 않는다 —
  // 파일을 한 번도 안 올린 프로젝트에 빈 폴더를 만들 이유가 없다.
  // 실패해도 이름 변경 자체는 성공이다(드라이브 미설정 환경도 있다).
  if (saved?.drive_folder_id) {
    cloud.renameDriveFolder(saved.drive_folder_id, title)
      .catch(e => { if (!e.notConfigured) console.error('[drive] 폴더 이름 변경 실패:', e); });
  }
  return saved;
}

// 업무 폴더 이름을 제목에 맞춘다(0026). 조용히 실패한다 — 이름이 안 맞는 것보다
// 저장이 막히는 쪽이 훨씬 나쁘다.
export function renameCardFolder(folderId, title) {
  cloud.renameDriveFolder(folderId, title)
    .catch(e => { if (!e.notConfigured) console.error('[drive] 업무 폴더 이름 변경 실패:', e); });
}

// 이 프로젝트의 드라이브 폴더를 확보하고 projects.drive_folder_id에 적어 둔다.
// 첫 업로드 때 한 번만 돌면 되고, 그 뒤로는 id로 바로 올린다(이름을 바꿔도 안 갈라진다).
export async function ensureProjectFolder(project) {
  if (project?.driveFolderId) return project.driveFolderId;
  try {
    const { folderId } = await cloud.ensureDriveFolder(project.title, null);
    if (!folderId) return null;
    await write(() => cloud.updateProject(project.id, { drive_folder_id: folderId }));
    // 스토어는 여기서 건드리지 않는다. cloudSync는 `cloud.js`만 가짜로 바꿔치고
    // 노드에서 도는 검사(assignees·push)가 있어서, 스토어를 import하면 그 경로가
    // 통째로 깨진다(실제로 깨져서 이 주석이 생겼다). projects는 실시간 구독이
    // 전체 재조회로 받으므로 값은 곧 스토어에 들어오고, 이번 업로드는 방금 받은
    // folderId를 지역 변수로 그대로 쓴다.
    return folderId;
  } catch (e) {
    if (!e.notConfigured) console.error('[drive] 폴더 확보 실패:', e);
    return null;
  }
}
// 업무 폴더를 **파일 바이트가 오가기 전에** 확보하고 cards.drive_folder_id에 적어 둔다.
//
// 왜 따로 빼나: 예전에는 업로드 한 번이 "업무 폴더 만들기 + 파일 쓰기"를 같이 했다.
// 실측(2026-08-28)으로 폴더 만들기만 3.5초, 3MB 파일 쓰기가 8.5초다 — 둘을 한 호출에
// 묶으면 가장 흔한 경로(새 프로젝트 → 새 업무 → 첫 첨부)가 제일 오래 걸리고, 그때
// 시간 제한에 걸려 "드라이브가 응답하지 않아요"가 떴다(사용자 신고).
// 나눠 두면 무거운 호출이 파일 쓰기 하나만 하고, 폴더 id가 **파일보다 먼저** 저장돼
// 다음 업로드가 같은 이름 폴더를 또 만드는 일도 없어진다.
//
// 실패해도 null을 돌려주고 업로드는 진행한다 — 스크립트가 이름으로 폴더를 찾는
// 폴백이 있어서 파일은 제자리에 간다. 폴더 id를 못 적는 것뿐이다.
export async function ensureCardFolder(project, card) {
  if (card?.driveFolderId) return card.driveFolderId;
  if (!card?.id || !card?.title) return null;
  try {
    // path로 프로젝트/업무 두 겹을 한 번에 만든다(ensureFolder는 folderId를 주면
    // 그 폴더 자체를 돌려주므로, 그 아래 한 겹을 더 파려면 path여야 한다).
    const { folderId } = await cloud.ensureDriveFolder(
      project?.name || project?.title, null,
      [project?.name || project?.title || '기타', card.title],
    );
    if (!folderId) return null;
    await write(() => cloud.setCardFolder(card.id, folderId));
    return folderId;
  } catch (e) {
    if (!e.notConfigured) console.error('[drive] 업무 폴더 확보 실패:', e);
    return null;
  }
}

export async function projectArchiveCloud(id, archived) { return write(() => cloud.updateProject(id, { archived })); }
export async function projectDeleteCloud(id) { return write(() => cloud.deleteProject(id)); }

// 탭 드래그가 정한 순서 저장 — 바뀐 행만 넘어온다(몇 건 안 된다).
// 컬럼 하나짜리 갱신이라 겹쳐 써도 마지막 것이 남을 뿐 깨지지 않는다(§6-27과 같은 성질).
export async function projectOrderCloud(orders) {
  for (const { id, position } of orders) {
    await write(() => cloud.updateProject(id, { position }));
  }
}

// 보드 컬럼 안 순서(0024). 바뀐 카드만 넘어온다.
export async function cardOrderCloud(orders) {
  for (const { id, position } of orders) {
    await write(() => cloud.setCardPosition(id, position));
  }
}

export async function linkAddCloud(projectId, link) { return write(() => cloud.addLink(projectId, link.title, link.url, link.id)); }
export async function linkRemoveCloud(id) { return write(() => cloud.removeLink(id)); }

// teams(여러 팀)를 주면 profile_teams까지 갱신한다. 대표 팀은 그 중 첫 번째.
export async function profileUpdateCloud({ name, team, teams, avatarUrl }) {
  const list = (teams && teams.length ? teams : [team]).filter(Boolean);
  const patch = { display_name: name };
  // undefined = 사진을 안 건드림. '기본으로'는 빈 문자열을 보내 null로 지운다
  // (그러면 다시 이름 첫 글자 원이 된다).
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl || null;
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
//   comments/files/comment_reactions → 목록 화면에 안 나오는 데이터
//                → 열려 있는 업무 창일 때만 상세 갱신
//   그 외(projects·resource_links) → 전체 재조회 (드문 변경)
// comments의 DELETE payload에는 card_id가 없다(replica identity가 PK뿐) → cardId가
// 비면 "지금 열려 있는 카드"로 본다. 호출부가 그렇게 처리한다.
export function subscribeWorkspace({ onCard, onCardDelete, onCardDetail, onActivityFeed, onFullReload }) {
  return cloud.subscribeAll((payload) => {
    const table = payload?.table;
    const row = payload?.new || {};
    const old = payload?.old || {};
    if (table === 'cards') {
      if (payload.eventType === 'DELETE') onCardDelete(old.id);
      else onCard(row.id || old.id);
      return;
    }
    // comment_reactions에는 card_id가 아예 없다(INSERT·DELETE 둘 다) — comments의
    // DELETE와 같은 처리로 떨어진다: cardId가 비면 "지금 열려 있는 카드"다.
    if (table === 'comments' || table === 'files' || table === 'comment_reactions') {
      onCardDetail(row.card_id || old.card_id || null);
      return;
    }
    // 활동은 대시보드 피드만 다시 읽는다(쿼리 1개). 전체 재조회로 흘리면 저장 한 번에
    // 기록이 여러 건이라 모든 접속자가 그때마다 워크스페이스를 다시 읽게 된다.
    if (table === 'activity') {
      onActivityFeed?.();
      return;
    }
    // 나머지(projects · resource_links · profiles)는 전체 재조회.
    // profiles가 여기로 오는 것이 중요하다 — primeMaps가 다시 돌아야 새로 가입한 사람의
    // id→이름이 이 탭에 생긴다(0018). 카드 1건만 다시 읽는 경로로 옮기면 안 된다.
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
