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

// ── PGRST303 (JWT issued at future) 자동 재시도 ─────────────────────────────
// 기기 시계가 서버보다 앞서 있으면 발급 시각이 미래인 JWT가 되어 거부된다.
// 잠깐 기다리면 서버 시각이 따라잡으므로 대기 후 재시도하고, 한 번은 세션도 갱신한다.
const isClockSkewError = (err) => {
  const code = err?.code || '';
  const msg = `${err?.message || ''} ${err?.details || ''}`.toLowerCase();
  return code === 'PGRST303' || (msg.includes('jwt') && msg.includes('future'));
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 클라우드 호출을 감싸 시계 오차 오류에 한해 재시도 (최대 2회 추가 시도)
export async function withClockSkewRetry(fn, { retries = 2, delay = 1500 } = {}) {
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isClockSkewError(err) || attempt >= retries) throw err;
      console.warn(`[cloud] JWT 시각 오차 감지 — ${delay}ms 후 재시도 (${attempt + 1}/${retries})`);
      if (!refreshed) {
        refreshed = true;
        try { await supabase?.auth.refreshSession(); } catch (e) { console.warn('[cloud] 세션 갱신 실패:', e); }
      }
      await sleep(delay);
    }
  }
}

// ── 상태 매핑: DB 'todo'|'doing'|'hold'|'done' ↔ 앱 '시작 전'|'진행 중'|'보류 중'|'완료' ──
// 이름 기준 매핑(CONFIG.STATUS_DB) — 보드 컬럼 순서를 바꿔도 DB 값이 어긋나지 않는다.
const APP_BY_DB = Object.fromEntries(Object.entries(CONFIG.STATUS_DB).map(([app, db]) => [db, app]));
export const statusToDb = (appStatus) => CONFIG.STATUS_DB[appStatus] || 'todo';
export const statusFromDb = (dbStatus) => APP_BY_DB[dbStatus] || CONFIG.STATUSES[0];

// ── 인증 ──────────────────────────────────────────────────────────────────
// (auth.jsx와 일부 중복되지만 영속 계층 완결성을 위해 export)
export async function signInWithGoogle() {
  return unwrap(await client().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } } }));
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
export async function getSession() {
  const { data } = await client().auth.getSession();
  return { session: data.session, user: data.session?.user || null };
}

// ── profiles / teams ────────────────────────────────────────────────────────
export async function getMyProfile() {
  const { data: { user } } = await client().auth.getUser();
  if (!user) return null;
  return unwrap(await client().from('profiles').select('*').eq('id', user.id).maybeSingle());
}
export async function listProfiles() {
  return unwrap(await client().from('profiles').select('*'));
}
// 가입 트리거가 발화하지 않아 프로필 행이 없을 수 있으므로 update 대신 upsert(행 없어도 성공)
export async function updateMyProfile(patch) {
  const { data: { user } } = await client().auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  return unwrap(await client().from('profiles').upsert({ id: user.id, ...patch }).select().single());
}
// 프로필 행이 없을 때 클라이언트가 직접 자기 행을 생성(RLS상 본인 insert 허용)
export async function ensureMyProfile(user) {
  const meta = user.user_metadata || {};
  const row = {
    id: user.id,
    display_name: meta.full_name || meta.name || null,
    avatar_url: meta.avatar_url || null,
  };
  return unwrap(await client().from('profiles').upsert(row, { onConflict: 'id' }).select().single());
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
// 전체 카드 (초기 로드용, card_teams 조인)
export async function listAllCards() {
  return unwrap(await client().from('cards').select('*, card_teams(team_id)').order('position', { ascending: true }));
}
export async function createCard(data, teamIds = []) {
  const card = unwrap(await client().from('cards').insert(data).select().single());
  if (teamIds.length) {
    const { error } = await client().from('card_teams').insert(teamIds.map(team_id => ({ card_id: card.id, team_id })));
    if (error) throw error;
  }
  return card;
}
// 0 rows(PGRST116)는 대상 행이 없다는 뜻 — upsert로 폴백해 카드를 생성한다.
// (스테일 로컬 데이터나 다른 기기에서의 삭제로 행이 사라진 경우 자연 복구)
const isNoRowsError = (err) => err?.code === 'PGRST116';

export async function updateCard(id, patch, teamIds) {
  let card;
  try {
    card = unwrap(await client().from('cards').update(patch).eq('id', id).select().single());
  } catch (e) {
    if (!isNoRowsError(e)) throw e;
    console.warn('[cloud] 업무 행이 없어 upsert로 생성합니다:', id);
    card = unwrap(await client().from('cards').upsert({ id, ...patch }, { onConflict: 'id' }).select().single());
  }
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
export async function listAllComments() {
  return unwrap(await client().from('comments').select('*').order('created_at', { ascending: true }));
}
// id를 명시하면 로컬에서 만든 uuid를 그대로 사용(로컬↔클라우드 id 일치)
export async function addComment(cardId, body, parentId = null, id) {
  const row = { card_id: cardId, body, parent_id: parentId };
  if (id) row.id = id;
  return unwrap(await client().from('comments').insert(row).select().single());
}
export async function updateComment(id, body) {
  try {
    return unwrap(await client().from('comments').update({ body, edited: true }).eq('id', id).select().single());
  } catch (e) {
    if (!isNoRowsError(e)) throw e;
    console.warn('[cloud] 댓글 행이 없어 수정을 건너뜁니다:', id);
    return null; // 이미 삭제된 댓글 — 로컬 반영만 유지
  }
}
export async function deleteComment(id) {
  const { error } = await client().from('comments').delete().eq('id', id);
  if (error) throw error;
}

// ── resource_links ──────────────────────────────────────────────────────────
export async function listLinks(projectId) {
  return unwrap(await client().from('resource_links').select('*').eq('project_id', projectId).order('created_at', { ascending: true }));
}
export async function listAllLinks() {
  return unwrap(await client().from('resource_links').select('*').order('created_at', { ascending: true }));
}
export async function addLink(projectId, title, url, id) {
  const row = { project_id: projectId, title, url };
  if (id) row.id = id;
  return unwrap(await client().from('resource_links').insert(row).select().single());
}
export async function removeLink(id) {
  const { error } = await client().from('resource_links').delete().eq('id', id);
  if (error) throw error;
}

// ── files / 첨부 파일 (Supabase Storage: private 버킷 'attachments') ──────────
const ATTACH_BUCKET = 'attachments';

export async function listFiles(projectId) {
  return unwrap(await client().from('files').select('*').eq('project_id', projectId).order('created_at', { ascending: true }));
}
export async function listAllFiles() {
  return unwrap(await client().from('files').select('*').order('created_at', { ascending: true }));
}
export async function listCardFiles(cardId) {
  return unwrap(await client().from('files').select('*').eq('card_id', cardId).order('created_at', { ascending: true }));
}

// 파일 업로드: Storage 업로드 → files 테이블 참조 행 insert. DB 실패 시 객체 정리.
export async function uploadAttachment(file, { projectId, cardId }) {
  const c = client();
  const safe = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${projectId}/${cardId}/${crypto.randomUUID()}-${safe}`;
  const up = await c.storage.from(ATTACH_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) throw up.error;
  try {
    return unwrap(await c.from('files').insert({
      project_id: projectId,
      card_id: cardId,
      name: file.name,
      mime_type: file.type || null,
      storage_path: path,
      size_bytes: file.size ?? null,
      source: 'storage',
    }).select().single());
  } catch (e) {
    try { await c.storage.from(ATTACH_BUCKET).remove([path]); } catch (_) { /* 정리 실패는 무시 */ }
    throw e;
  }
}

// 본문 이미지: 공개 버킷 'content-images'에 업로드 → publicUrl 반환
// (RichText가 이미지 URL을 렌더하므로 텍스트에 URL만 삽입하면 됨)
const CONTENT_IMG_BUCKET = 'content-images';
export async function uploadContentImage(file) {
  const c = client();
  const { data: { user } } = await c.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  const ext = (file.type && file.type.split('/')[1]) || (file.name || '').split('.').pop() || 'png';
  const path = `${user.id}/${crypto.randomUUID()}.${ext.toLowerCase()}`;
  const up = await c.storage.from(CONTENT_IMG_BUCKET).upload(path, file, { contentType: file.type || 'image/png', upsert: false });
  if (up.error) throw up.error;
  const { data } = c.storage.from(CONTENT_IMG_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// 1시간 유효 서명 URL (private 버킷이라 직접 URL 불가)
export async function getAttachmentUrl(storagePath) {
  const { data, error } = await client().storage.from(ATTACH_BUCKET).createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// 파일 열기 URL — files.source로 저장소를 분기한다.
// 개인 구글 드라이브로 실체를 옮긴 뒤에는 source='drive'로 바꾸고
// drive_file_id/web_view_link만 채우면 앱 코드는 그대로 동작한다.
export async function getFileOpenUrl(row) {
  if (row.source === 'drive') {
    if (row.web_view_link) return row.web_view_link;
    if (row.drive_file_id) return `https://drive.google.com/file/d/${row.drive_file_id}/view`;
    throw new Error('드라이브 링크가 없는 파일이에요');
  }
  return getAttachmentUrl(row.storage_path);
}

// 복수 서명 URL 일괄 발급 → { [storagePath]: signedUrl }
// (행마다 개별 요청하면 모바일에서 요청 폭주로 느려지므로 한 번에 받는다)
export async function getAttachmentUrls(storagePaths = []) {
  const paths = storagePaths.filter(Boolean);
  if (!paths.length) return {};
  const { data, error } = await client().storage.from(ATTACH_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  const map = {};
  (data || []).forEach(d => { if (d?.path && d.signedUrl) map[d.path] = d.signedUrl; });
  return map;
}

// 삭제: Storage 객체 + files 행
export async function deleteAttachment(fileRow) {
  const c = client();
  if (fileRow.storage_path) {
    const { error } = await c.storage.from(ATTACH_BUCKET).remove([fileRow.storage_path]);
    if (error) throw error;
  }
  const { error } = await c.from('files').delete().eq('id', fileRow.id);
  if (error) throw error;
}

// ── notifications (@멘션 알림) ──────────────────────────────────────────────
// 본인 알림 최근 N개 (읽지 않은 것 우선, 그다음 최신순)
export async function listMyNotifications(limit = 30) {
  const { data: { user } } = await client().auth.getUser();
  if (!user) return [];
  return unwrap(await client()
    .from('notifications')
    .select('*')
    .eq('recipient_id', user.id)
    .order('read', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit));
}

// 멘션 알림 일괄 생성 (recipientIds는 auth.users.id 배열)
// kind: 'mention'(멘션) | 'reply'(내 댓글에 답글) — DB check와 INSERT 정책이 이 둘만 허용
export async function insertNotifications(recipientIds, { actorName, cardId, projectId, preview, kind = 'mention' }) {
  const ids = [...new Set((recipientIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const rows = ids.map(recipient_id => ({
    recipient_id,
    actor_name: actorName || '누군가',
    kind,
    card_id: cardId || null,
    project_id: projectId || null,
    preview: (preview || '').slice(0, 200) || null,
  }));
  return unwrap(await client().from('notifications').insert(rows).select());
}

export async function markNotificationRead(id) {
  return unwrap(await client().from('notifications').update({ read: true }).eq('id', id).select().maybeSingle());
}

export async function markAllNotificationsRead() {
  const { data: { user } } = await client().auth.getUser();
  if (!user) return;
  const { error } = await client().from('notifications').update({ read: true }).eq('recipient_id', user.id).eq('read', false);
  if (error) throw error;
}

// 본인 수신 알림 INSERT만 구독
export function subscribeMyNotifications(userId, onInsert) {
  const c = client();
  const topic = `notifications:${userId}`;
  // supabase-js는 같은 topic으로 channel()을 부르면 기존 인스턴스를 그대로 돌려준다.
  // 그 채널이 이미 subscribe()된 상태면 .on('postgres_changes')가 예외를 던지고
  // (cannot add callbacks after subscribe) 그게 ErrorBoundary까지 올라가 화면이 깨졌다.
  // 남아 있던 같은 topic 채널을 먼저 걷어내고 새로 만든다.
  c.getChannels()
    .filter(ch => ch.topic === topic || ch.topic === `realtime:${topic}`)
    .forEach(ch => c.removeChannel(ch));
  const channel = c.channel(topic)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
      payload => onInsert(payload.new))
    .subscribe();
  return () => c.removeChannel(channel);
}

// ── activity ─────────────────────────────────────────────────────────────────
export async function listAllActivity() {
  return unwrap(await client().from('activity').select('*').order('created_at', { ascending: true }));
}
export async function insertActivity(row) {
  // row: { id?, project_id?, card_id?, action, payload? }
  return unwrap(await client().from('activity').insert(row).select().single());
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

// 워크스페이스 전역 구독(프로젝트/카드/댓글/리소스/팀매핑 변경) — onChange는 재조회 트리거용
export function subscribeAll(onChange) {
  const c = client();
  const channel = c.channel('workspace-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'card_teams' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_links' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'files' }, onChange)
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
