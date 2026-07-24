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
  memberNames = [...new Set(profiles.map(p => p.display_name).filter(Boolean))];
};

// 멘션·담당자 자동완성용 멤버 표시명 목록(클라우드 로드 후 프라이밍됨)
export function getMemberNames() { return memberNames.slice(); }

// 팀 매핑만 필요할 때(마이그레이션 등) 최소 프라이밍
async function ensureTeamMap() {
  if (teamNameToId.size) return;
  const teams = await cloud.listTeams();
  teamIdToName = new Map(teams.map(t => [t.id, t.name]));
  teamNameToId = new Map(teams.map(t => [t.name, t.id]));
}

// ── DB → 앱 매핑 ─────────────────────────────────────────────────────────────
const cardToTask = (card) => ({
  id: card.id,
  projectId: card.project_id,
  title: card.title,
  content: card.description || '',
  status: statusFromDb(card.status),
  assignees: card.assignees || [],
  teams: (card.card_teams || []).map(ct => teamIdToName.get(ct.team_id)).filter(Boolean),
  startDate: card.start_date || '',
  dueDate: card.due_date || '',
  position: card.position ?? 0,
  author: profileIdToName.get(card.created_by) || '',
  created_by: card.created_by || null,
  createdAt: card.created_at,
  updatedAt: card.updated_at,
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
  pinnedLinks: (linksByProject.get(p.id) || []).map(l => ({ id: l.id, title: l.title, url: l.url })),
});

// ── 초기 로드: 전체를 병렬 조회 → 앱 스토어 모양으로 정규화 ──────────────────
export async function loadCloudState() {
  const [teams, profiles, projects, cards, links, comments, activity, files, initialProfile, sessionRes] = await Promise.all([
    cloud.listTeams(), cloud.listProfiles(), cloud.listProjects(), cloud.listAllCards(),
    cloud.listAllLinks(), cloud.listAllComments(), cloud.listAllActivity(), cloud.listAllFiles(), cloud.getMyProfile(),
    cloud.getSession(),
  ]);

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

  const commentsByCard = new Map();
  comments.forEach(c => { if (!commentsByCard.has(c.card_id)) commentsByCard.set(c.card_id, []); commentsByCard.get(c.card_id).push(commentToApp(c)); });

  const activityByCard = new Map();
  activity.forEach(a => { if (!a.card_id) return; if (!activityByCard.has(a.card_id)) activityByCard.set(a.card_id, []); activityByCard.get(a.card_id).push(activityToApp(a)); });

  const filesByCard = new Map();
  files.forEach(f => { if (!f.card_id) return; if (!filesByCard.has(f.card_id)) filesByCard.set(f.card_id, []); filesByCard.get(f.card_id).push(f); });

  const tasks = cards.map(card => {
    const t = cardToTask(card);
    t.comments = commentsByCard.get(card.id) || [];
    t.activityLog = activityByCard.get(card.id) || [];
    t.attachments = filesByCard.get(card.id) || [];
    return t;
  });

  const projectsApp = projects.map(p => projectToApp(p, linksByProject));

  const currentUser = myProfile
    ? { name: myProfile.display_name || '', team: myProfile.team_id ? (teamIdToName.get(myProfile.team_id) || '') : '' }
    : { name: '', team: '' };

  return {
    state: { currentUser, projects: normalize(projectsApp), tasks: normalize(tasks) },
    profile: myProfile,
  };
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

export async function cardUpsertCloud(task, isNew) {
  const teamIds = (task.teams || []).map(n => teamNameToId.get(n)).filter(Boolean);
  if (isNew) return cloud.createCard({ id: task.id, ...cardPatch(task) }, teamIds);
  return cloud.updateCard(task.id, cardPatch(task), teamIds);
}
export async function cardDeleteCloud(id) { return cloud.deleteCard(id); }

export async function activityAddCloud(entries, projectId, cardId) {
  for (const e of entries) {
    await cloud.insertActivity({ id: e.id, project_id: projectId, card_id: cardId, action: e.action });
  }
}

export async function commentAddCloud(comment, cardId) {
  return cloud.addComment(cardId, comment.text, comment.parentId || null, comment.id);
}
export async function commentUpdateCloud(commentId, text) { return cloud.updateComment(commentId, text); }
export async function commentDeleteCloud(commentId) { return cloud.deleteComment(commentId); }

export async function projectCreateCloud(project) {
  return cloud.createProject({ id: project.id, name: project.title, description: '' });
}
export async function projectDeleteCloud(id) { return cloud.deleteProject(id); }

export async function linkAddCloud(projectId, link) { return cloud.addLink(projectId, link.title, link.url, link.id); }
export async function linkRemoveCloud(id) { return cloud.removeLink(id); }

export async function profileUpdateCloud({ name, team }) {
  const patch = { display_name: name };
  const teamId = team ? teamNameToId.get(team) : null;
  if (teamId) patch.team_id = teamId;
  return cloud.updateMyProfile(patch);
}

// ── 로컬 → 클라우드 1회 이관 ─────────────────────────────────────────────────
export async function migrateLocalToCloud(localState) {
  await ensureTeamMap();
  const projects = (localState.projects?.allIds || []).map(id => localState.projects.byId[id]);
  const tasks = (localState.tasks?.allIds || []).map(id => localState.tasks.byId[id]);

  for (const p of projects) {
    await cloud.createProject({ id: p.id, name: p.title, description: '' });
    for (const link of (p.pinnedLinks || [])) {
      if (!link.title || !link.url) continue;
      const url = link.url === '#' ? 'https://example.com' : link.url;
      await cloud.addLink(p.id, link.title, url, link.id);
    }
  }
  for (const t of tasks) {
    const teamIds = (t.teams || []).map(n => teamNameToId.get(n)).filter(Boolean);
    await cloud.createCard({
      id: t.id, project_id: t.projectId, title: t.title, description: t.content || null,
      status: statusToDb(t.status), start_date: t.startDate || null, due_date: t.dueDate || null,
      assignees: t.assignees || [], position: t.position ?? 0,
    }, teamIds);
    for (const c of (t.comments || [])) {
      await cloud.addComment(t.id, c.text, c.parentId || null, c.id);
    }
    for (const a of (t.activityLog || [])) {
      await cloud.insertActivity({ id: a.id, project_id: t.projectId, card_id: t.id, action: a.action });
    }
  }
}

// 재조회 트리거용 전역 구독 재노출
export const subscribeAll = cloud.subscribeAll;

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
