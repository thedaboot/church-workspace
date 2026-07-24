import { supabase } from './supabaseClient.js';
import { CONFIG } from '../config.js';

// ============================================================================
// 6. Persistence Layer — Supabase 클라우드 영속 계층
// ----------------------------------------------------------------------------
// 도메인별 async 함수. 모두 supabaseClient의 단일 인스턴스를 사용하며,
// 미설정(게스트 모드) 상태에서 호출되면 명확한 Error를 던진다.
// ============================================================================

const client = () => {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 확인하세요.');
  return supabase;
};

// { data, error } 언래핑 헬퍼
const unwrap = ({ data, error }) => { if (error) throw error; return data; };

// ── 상태 매핑: DB 'todo'|'doing'|'done' ↔ 앱 '시작 전'|'진행 중'|'완료' ──
// CONFIG.STATUSES 순서(['시작 전','진행 중','완료'])와 1:1 대응
const DB_STATUSES = ['todo', 'doing', 'done'];
export const statusToDb = (appStatus) => {
  const i = CONFIG.STATUSES.indexOf(appStatus);
  return i >= 0 ? DB_STATUSES[i] : DB_STATUSES[0];
};
export const statusFromDb = (dbStatus) => {
  const i = DB_STATUSES.indexOf(dbStatus);
  return i >= 0 ? CONFIG.STATUSES[i] : CONFIG.STATUSES[0];
};

// ── 인증 ──────────────────────────────────────────────────────────────────
// (auth.jsx와 일부 중복되지만 영속 계층 완결성을 위해 export)
export async function signInWithGoogle() {
  return unwrap(await client().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }));
}
export async function signInWithKakao() {
  return unwrap(await client().auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: window.location.origin } }));
}
export async function signOutCloud() {
  const { error } = await client().auth.signOut();
  if (error) throw error;
}
export function onAuthChange(cb) {
  const { data } = client().auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

// ── profiles / teams ────────────────────────────────────────────────────────
export async function getMyProfile() {
  const { data: { user } } = await client().auth.getUser();
  if (!user) return null;
  return unwrap(await client().from('profiles').select('*').eq('id', user.id).single());
}
export async function updateMyProfile(patch) {
  const { data: { user } } = await client().auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  return unwrap(await client().from('profiles').update(patch).eq('id', user.id).select().single());
}
export async function listTeams() {
  return unwrap(await client().from('teams').select('*').order('name', { ascending: true }));
}

// ── projects ─────────────────────────────────────────────────────────────────
export async function listProjects() {
  return unwrap(await client().from('projects').select('*').order('created_at', { ascending: true }));
}
export async function createProject(data) {
  return unwrap(await client().from('projects').insert(data).select().single());
}
export async function updateProject(id, patch) {
  return unwrap(await client().from('projects').update(patch).eq('id', id).select().single());
}
export async function deleteProject(id) {
  const { error } = await client().from('projects').delete().eq('id', id);
  if (error) throw error;
}

// ── cards ─────────────────────────────────────────────────────────────────────
export async function listCards(projectId) {
  // card_teams 조인 포함 → 각 card에 card_teams: [{ team_id }]
  return unwrap(await client()
    .from('cards')
    .select('*, card_teams(team_id)')
    .eq('project_id', projectId)
    .order('position', { ascending: true }));
}
export async function createCard(data, teamIds = []) {
  const card = unwrap(await client().from('cards').insert(data).select().single());
  if (teamIds.length) {
    const { error } = await client().from('card_teams').insert(teamIds.map(team_id => ({ card_id: card.id, team_id })));
    if (error) throw error;
  }
  return card;
}
export async function updateCard(id, patch, teamIds) {
  const card = unwrap(await client().from('cards').update(patch).eq('id', id).select().single());
  // teamIds가 명시적으로 주어졌을 때만 팀 매핑을 재설정
  if (teamIds !== undefined) {
    const del = await client().from('card_teams').delete().eq('card_id', id);
    if (del.error) throw del.error;
    if (teamIds.length) {
      const ins = await client().from('card_teams').insert(teamIds.map(team_id => ({ card_id: id, team_id })));
      if (ins.error) throw ins.error;
    }
  }
  return card;
}
// status는 DB 값('todo'|'doing'|'done')을 기대 — 호출부에서 statusToDb로 변환
export async function moveCard(id, status, position) {
  return unwrap(await client().from('cards').update({ status, position }).eq('id', id).select().single());
}
export async function deleteCard(id) {
  const { error } = await client().from('cards').delete().eq('id', id);
  if (error) throw error;
}

// ── comments (parent_id로 답글 지원) ────────────────────────────────────────
export async function listComments(cardId) {
  return unwrap(await client().from('comments').select('*').eq('card_id', cardId).order('created_at', { ascending: true }));
}
export async function addComment(cardId, body, parentId = null) {
  return unwrap(await client().from('comments').insert({ card_id: cardId, body, parent_id: parentId }).select().single());
}
export async function updateComment(id, body) {
  return unwrap(await client().from('comments').update({ body, edited: true }).eq('id', id).select().single());
}
export async function deleteComment(id) {
  const { error } = await client().from('comments').delete().eq('id', id);
  if (error) throw error;
}

// ── resource_links ──────────────────────────────────────────────────────────
export async function listLinks(projectId) {
  return unwrap(await client().from('resource_links').select('*').eq('project_id', projectId).order('created_at', { ascending: true }));
}
export async function addLink(projectId, title, url) {
  return unwrap(await client().from('resource_links').insert({ project_id: projectId, title, url }).select().single());
}
export async function removeLink(id) {
  const { error } = await client().from('resource_links').delete().eq('id', id);
  if (error) throw error;
}

// ── files (드라이브 참조만 DB에 보관) ───────────────────────────────────────
export async function linkDriveFile(meta) {
  // meta: { project_id, card_id?, drive_file_id, name, mime_type?, web_view_link? }
  return unwrap(await client().from('files').insert(meta).select().single());
}
export async function listFiles(projectId) {
  return unwrap(await client().from('files').select('*').eq('project_id', projectId).order('created_at', { ascending: true }));
}
export async function unlinkFile(id) {
  const { error } = await client().from('files').delete().eq('id', id);
  if (error) throw error;
}

// ── 실시간 구독 ────────────────────────────────────────────────────────────
// 해당 프로젝트의 cards / resource_links / files 변경 + comments 전체 변경을 구독.
// (comments엔 project_id가 없어 카드 단위 필터가 불가 → 전체 구독 후 onChange에서 재조회)
// 반환값: 구독 해제 함수
export function subscribeProject(projectId, onChange) {
  const c = client();
  const channel = c.channel(`project:${projectId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cards', filter: `project_id=eq.${projectId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_links', filter: `project_id=eq.${projectId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'files', filter: `project_id=eq.${projectId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, onChange)
    .subscribe();
  return () => c.removeChannel(channel);
}

// ============================================================================
// ── 레거시: Google Apps Script 동기화 (Supabase 전환 완료 후 제거 예정) ──
// ----------------------------------------------------------------------------
// 아직 usePersistenceController / SyncModal 이 사용 중이므로 유지한다.
// ============================================================================
export const CloudRepository = {
  save: async (url, data) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(data), redirect: 'follow' });
    if (!response.ok) throw new Error('Network response was not ok');
  },
  load: async (url) => {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error('Network response was not ok');
    return await response.json();
  }
};
