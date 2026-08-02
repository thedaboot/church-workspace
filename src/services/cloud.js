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
// 로그인·로그아웃은 auth.jsx가 supabase 클라이언트로 직접 한다(여기 있던 래퍼는
// 아무도 쓰지 않아 지웠다). 세션 조회만 여러 곳에서 필요하다.
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
// ── 여러 팀 소속 (profile_teams) ─────────────────────────────────────────────
// 0008 마이그레이션이 아직 적용되지 않은 환경에서도 앱이 죽지 않아야 한다.
// 테이블이 없으면 빈 배열/무시로 떨어지고, 대표 팀(profiles.team_id)만으로 동작한다.
export async function listProfileTeams() {
  const { data, error } = await client().from('profile_teams').select('profile_id, team_id');
  if (error) { console.warn('[cloud] profile_teams 조회 생략:', error.message); return []; }
  return data || [];
}
export async function setMyTeams(teamIds) {
  const { data: { user } } = await client().auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  const del = await client().from('profile_teams').delete().eq('profile_id', user.id);
  if (del.error) { console.warn('[cloud] profile_teams 저장 생략:', del.error.message); return; }
  if (!teamIds.length) return;
  const rows = teamIds.map(team_id => ({ profile_id: user.id, team_id }));
  const ins = await client().from('profile_teams').insert(rows);
  if (ins.error) console.warn('[cloud] profile_teams 저장 실패:', ins.error.message);
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
// 전체 카드 (초기 로드용, card_teams 조인)
// 만든 순 — 그냥 "결정적인 순서"를 위한 것이고, 화면에 보이는 컬럼 안 순서는
// 보드가 정한다(boards.jsx의 byDue: 마감일 순, 마감 미정은 아래).
// 예전에는 position으로 정렬했는데 그 값을 아무도 채우지 않아 전부 0이었고, 정렬 키가
// 모두 같으면 Postgres가 순서를 보장하지 않아서(내부 저장 순서) 카드를 한 번 수정할
// 때마다 순서가 뒤바뀌어 보였다. position 컬럼은 수동 정렬을 붙일 때를 위해 남겨둔다.
// 담당자는 0013부터 card_assignees(profile_id)가 원본이다 — 표시명으로 붙여 두면
// 이름을 바꿀 때 담당자가 남의 것이 됐다. cards.assignees 컬럼도 계속 쓰지만
// 읽기는 조인을 먼저 본다(cloudSync.cardToTask).
const CARD_SELECT = '*, card_teams(team_id), card_assignees(profile_id)';

export async function listAllCards() {
  return unwrap(await client().from('cards').select(CARD_SELECT).order('created_at', { ascending: true }));
}
// 카드 1건 (실시간 변경 반영용 — 전체를 다시 읽지 않는다)
// 이미 지워진 카드면 null.
export async function getCard(id) {
  return unwrap(await client().from('cards').select(CARD_SELECT).eq('id', id).maybeSingle());
}
export async function createCard(data, teamIds = [], assigneeIds = []) {
  const card = unwrap(await client().from('cards').insert(data).select().single());
  if (teamIds.length) {
    const { error } = await client().from('card_teams').insert(teamIds.map(team_id => ({ card_id: card.id, team_id })));
    if (error) throw error;
  }
  if (assigneeIds.length) {
    const { error } = await client().from('card_assignees').insert(assigneeIds.map(profile_id => ({ card_id: card.id, profile_id })));
    if (error) throw error;
  }
  return card;
}
// 0 rows(PGRST116)는 대상 행이 없다는 뜻 — upsert로 폴백해 카드를 생성한다.
// (스테일 로컬 데이터나 다른 기기에서의 삭제로 행이 사라진 경우 자연 복구)
const isNoRowsError = (err) => err?.code === 'PGRST116';

// 조인 테이블 하나를 '주어진 id 집합'으로 맞춘다.
//
// 처음에는 "전부 지우고 전부 넣기"로 썼는데, 그건 왕복이 두 번이라 **멱등이 아니다.**
// 저장 두 개가 겹치면(저장 버튼 두 번 눌림, 두 기기, 곧바로 이어진 수정) 문장이
// D1 → D2 → I1 → I2 순으로 도착하고, D2는 지울 것이 없는 상태로 지나가서 I2가 I1이
// 넣은 행과 부딪힌다:
//   ERROR: duplicate key value violates unique constraint "card_assignees_pkey"
// 라이브 DB에 같은 역할·같은 JWT 클레임으로 그 순서를 흘려 재현했다(rollback).
// 0013 전에는 담당자가 cards.assignees 컬럼 하나였고 컬럼 UPDATE는 몇 번 겹쳐도
// 결과가 같아서(멱등) 이 문제가 없었다 — 담당자를 조인 테이블로 옮기면서 생긴 것이다.
//
// 그래서 순서에 상관없이 같은 결과가 되게 바꿨다:
//   ① 집합에 **없는 것만** 지운다 (남길 행은 건드리지 않는다)
//   ② 넣기는 on conflict do nothing (이미 있으면 조용히 넘어간다)
// 두 저장이 겹쳐도 둘 다 성공하고 최종 상태는 같다.
async function resetCardJoin(table, column, cardId, ids) {
  let del = client().from(table).delete().eq('card_id', cardId);
  // uuid에는 콤마가 없지만 따옴표로 감싸 PostgREST의 목록 파싱에 맡긴다
  if (ids.length) del = del.not(column, 'in', `("${ids.join('","')}")`);
  const d = await del;
  if (d.error) throw d.error;
  if (!ids.length) return;
  const ins = await client().from(table).upsert(
    ids.map(v => ({ card_id: cardId, [column]: v })),
    { onConflict: `card_id,${column}`, ignoreDuplicates: true },
  );
  if (ins.error) throw ins.error;
}

export async function updateCard(id, patch, teamIds, assigneeIds) {
  let card;
  try {
    card = unwrap(await client().from('cards').update(patch).eq('id', id).select().single());
  } catch (e) {
    if (!isNoRowsError(e)) throw e;
    console.warn('[cloud] 업무 행이 없어 upsert로 생성합니다:', id);
    card = unwrap(await client().from('cards').upsert({ id, ...patch }, { onConflict: 'id' }).select().single());
  }
  // 명시적으로 주어졌을 때만 재설정 (undefined는 "건드리지 말라"는 뜻)
  if (teamIds !== undefined) await resetCardJoin('card_teams', 'team_id', id, teamIds);
  if (assigneeIds !== undefined) await resetCardJoin('card_assignees', 'profile_id', id, assigneeIds);
  return card;
}
// '이 요약 고정' — 폼 저장과 분리한다. 카드 폼에 실어 보내면 요약을 만든 사람이
// 남의 편집을 같이 덮어쓰고, 반대로 아무나 카드를 저장할 때마다 요약이 따라 움직인다.
// 여기서는 요약 세 칸만 건드린다. text가 비면 고정을 푼다.
export async function setCardSummary(id, text) {
  const { data: { user } } = await client().auth.getUser();
  const patch = text
    ? { ai_summary: text, ai_summary_at: new Date().toISOString(), ai_summary_by: user?.id || null }
    : { ai_summary: null, ai_summary_at: null, ai_summary_by: null };
  return unwrap(await client().from('cards').update(patch).eq('id', id).select().single());
}

export async function deleteCard(id) {
  const { error } = await client().from('cards').delete().eq('id', id);
  if (error) throw error;
}

// ── comments (parent_id로 답글 지원) ────────────────────────────────────────
export async function listComments(cardId) {
  return unwrap(await client().from('comments').select('*').eq('card_id', cardId).order('created_at', { ascending: true }));
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

// ── push_subscriptions (웹 푸시 구독) ───────────────────────────────────────
// 기기당 한 행. endpoint가 unique이고 upsert로 넣으므로 같은 기기가 다시 구독해도
// 깨지지 않는다(권한 재요청·키 갱신·앱 재설치 때 실제로 그렇게 된다).
// 공용 기기에서 주인이 바뀔 수 있으므로 갱신 시 profile_id도 같이 덮는다.
// `.select()`를 붙이지 않는다 — 본인 행이라 정책상 읽을 수는 있지만 돌려받을 이유가 없다.
export async function savePushSubscription(sub) {
  const { data: { user } } = await client().auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  const { endpoint, keys } = sub || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Error('구독 정보가 올바르지 않습니다.');
  const { error } = await client().from('push_subscriptions').upsert({
    profile_id: user.id,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: navigator.userAgent.slice(0, 300),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function deletePushSubscription(endpoint) {
  const { error } = await client().from('push_subscriptions').delete().eq('endpoint', endpoint);
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
//
// **.select()를 붙이면 안 된다.** notifications의 SELECT 정책은 본인 수신 행만
// (recipient_id = auth.uid()) 허용하는데, 여기서 넣는 행은 '남에게 보내는' 알림이다.
// insert().select()는 SQL의 INSERT ... RETURNING이라 넣은 행을 읽으려 하고, 정책에
// 막혀 42501(new row violates row-level security policy)로 **insert까지 롤백된다.**
// 그래서 멘션 알림이 한 번도 생성되지 않았다(호출부가 실패를 조용히 삼켜 화면에도
// 아무 표시가 없었다). 넣기만 하고 돌려받지 않는다.
export async function insertNotifications(recipientIds, { actorName, cardId, projectId, preview, kind = 'mention' }) {
  const ids = [...new Set((recipientIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  const rows = ids.map(recipient_id => ({
    recipient_id,
    actor_name: actorName || '누군가',
    kind,
    card_id: cardId || null,
    project_id: projectId || null,
    preview: (preview || '').slice(0, 200) || null,
  }));
  const { error } = await client().from('notifications').insert(rows);
  if (error) throw error;
  // 앱 안 알림과 웹 푸시를 같은 자리에서 보낸다 — 이 함수가 모든 알림의 관문이므로
  // 여기 붙이면 종류가 늘어도 푸시가 따라온다. 갈라 두면 한쪽만 도는 경로가 생긴다.
  // 기다리지 않는다: 발송이 늦어도 저장 흐름을 붙잡지 않아야 하고, 실패는 삼킨다
  // (앱 안 알림은 이미 들어갔다).
  void requestPush(ids, { actorName, cardId, projectId, preview, kind });
  return rows.length;
}

// /api/push에 발송을 부탁한다. VAPID 개인키는 서버에만 있으므로 브라우저가 직접
// 보낼 수는 없다. 배포 전(라우트 없음)·미설정(501)에서도 조용히 지나간다.
async function requestPush(recipientIds, payload) {
  try {
    const { data } = await client().auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ recipientIds, ...payload }),
    });
  } catch (e) {
    console.warn('[push] 발송 요청 실패:', e);
  }
}

export async function markNotificationRead(id) {
  return unwrap(await client().from('notifications').update({ read: true }).eq('id', id).select().maybeSingle());
}

// 알림 1건 지우기. 0005의 delete 정책이 본인 수신 행만 허용하므로 남의 알림은 못 지운다.
export async function deleteNotification(id) {
  const { error } = await client().from('notifications').delete().eq('id', id);
  if (error) throw error;
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
// 카드 1건의 활동 기록 — 활동은 업무 창 안에서만 보이므로 창을 열 때 그 카드 것만 읽는다.
// (예전에는 워크스페이스 전체 활동을 초기 로드와 매 재조회마다 읽었다. 활동은 쌓이기만
//  하는 테이블이라 오래 쓰면 카드보다 훨씬 커진다.)
export async function listCardActivity(cardId) {
  return unwrap(await client().from('activity').select('*').eq('card_id', cardId).order('created_at', { ascending: true }));
}
export async function insertActivity(row) {
  // row: { id?, project_id?, card_id?, action, payload? }
  // 같은 id가 이미 있으면 조용히 넘어간다. 활동은 덧붙이기만 하는 기록이고 id는
  // 클라이언트가 만든다 — 같은 기록을 두 번 보내는 것은 '이미 적혔다'는 뜻이지
  // 저장을 실패시킬 일이 아니다. 예전에는 여기서 activity_pkey 중복이 나면
  // 업무 저장 전체가 "저장에 실패했어요"로 보였다(카드 자체는 이미 저장된 뒤인데도).
  const { error } = await client().from('activity').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}

// ── 실시간 구독 ────────────────────────────────────────────────────────────
// 워크스페이스 전역 구독. onChange는 payload를 그대로 받는다 —
// 표(payload.table)에 따라 "그 카드만 다시 읽기 / 전체 재조회"로 갈라진다
// (cloudSync.subscribeWorkspace).
export function subscribeAll(onChange) {
  const c = client();
  const channel = c.channel('workspace-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_links' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'files' }, onChange)
    // 새로 가입한 사람·이름 수정. 이걸 안 들으면 그 전에 열어 둔 화면은 그 사람을 영영
    // 모르고, 활동 기록이 '알 수 없음'이 되는 것을 넘어 담당자까지 어긋난다(0018 참고)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onChange)
    .subscribe();
  return () => c.removeChannel(channel);
}

