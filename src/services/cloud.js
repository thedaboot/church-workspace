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
// 다녀갔다고 찍기 — 대시보드의 '오늘 다녀간 사람'이 보는 값(0019).
// 실패를 삼킨다: 이건 화면에 얼굴 하나가 덜 뜨는 일이고, 그것 때문에 앱을 못 쓰게 하지 않는다.
// update로 둔다(upsert 아님) — 행이 없다면 그건 프로필 자가 복구가 할 일이고,
// 여기서 만들면 display_name 없는 빈 행이 생겨 '알 수 없음'이 하나 늘어난다.
export async function touchLastSeen() {
  try {
    const { data: { user } } = await client().auth.getUser();
    if (!user) return;
    await client().from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id);
  } catch (e) {
    console.warn('[cloud] 접속 시각 기록 생략:', e.message);
  }
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
// 프로젝트를 지우면 DB는 카드까지 cascade로 지우지만 files.card_id는 set null이라
// **드라이브에 폴더·파일이 고아로 남았다**(업무 삭제에서 이미 겪은 일 — deleteCard 주석).
// 프로젝트 폴더 하나를 휴지통에 넣으면 안의 업무 폴더·파일이 전부 따라간다.
// 정리에 실패해도 프로젝트 삭제는 진행한다 — 파일 때문에 삭제가 막히면 안 된다.
export async function deleteProject(id) {
  const c = client();
  // 준비물 먼저 읽고 → 행 삭제(cascade가 카드까지) → 실체 정리. 순서 이유는 deleteCard와 같다.
  let proj = null, cards = [], files = [];
  try {
    proj = unwrap(await c.from('projects').select('drive_folder_id').eq('id', id).single());
    cards = unwrap(await c.from('cards').select('id, drive_folder_id').eq('project_id', id)) || [];
    const cardIds = cards.map(x => x.id);
    files = cardIds.length
      ? unwrap(await c.from('files').select('*').in('card_id', cardIds)) || []
      : [];
  } catch (e) {
    console.error('[cloud] 프로젝트 삭제 준비(폴더·파일 조회) 실패:', e);
  }
  const { error } = await c.from('projects').delete().eq('id', id);
  if (error) throw error;
  if (files.length) {
    const { error: fe } = await c.from('files').delete().in('id', files.map(f => f.id));
    if (fe) console.error('[cloud] 첨부 행 정리 실패:', fe);
  }
  // 프로젝트 폴더째 휴지통 — 안의 업무 폴더·파일이 한 번에 간다. 실패하면 업무 단위로.
  let projectTrashed = false;
  if (proj?.drive_folder_id) {
    try { await trashDriveId(proj.drive_folder_id); projectTrashed = true; }
    catch (e) { console.error('[cloud] 프로젝트 폴더 휴지통 이동 실패(업무 단위로 전환):', e); }
  }
  if (!projectTrashed) {
    const trashedCards = new Set();
    for (const card of cards) {
      if (!card.drive_folder_id) continue;
      try { await trashDriveId(card.drive_folder_id); trashedCards.add(card.id); }
      catch (e) { console.error('[cloud] 업무 폴더 휴지통 이동 실패:', e); }
    }
    for (const f of files) {
      if (f.source === 'drive' && f.drive_file_id && !trashedCards.has(f.card_id)) {
        try { await driveCall({ action: 'trash', fileId: f.drive_file_id }); }
        catch (e) { console.error('[drive] 휴지통 이동 실패:', f.name, e); }
      }
    }
  }
  // Storage(레거시) 실체는 드라이브 밖이라 언제나 따로 지운다
  for (const f of files) {
    if (!f.storage_path) continue;
    try { await c.storage.from(ATTACH_BUCKET).remove([f.storage_path]); }
    catch (e) { console.error('[cloud] Storage 정리 실패:', f.name, e); }
  }
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

// 업무를 지우면 **그 업무의 첨부도 같이 정리한다.**
// files.card_id는 `on delete set null`이라, 카드만 지우면 파일 행이 주인 없이 남고
// 드라이브에는 실체가 그대로 남는다. 실제로 그렇게 남은 4건이 이관 때 '기타'
// 폴더로 들어갔다(사용자 지적 — "드라이브와 워크스페이스 싱크를 맞춰야 한다").
// 드라이브 파일은 휴지통으로(30일 복구), Storage 객체는 삭제, 행은 삭제.
// 실패해도 카드 삭제는 진행한다 — 파일 정리 때문에 지우기가 막히면 안 된다.
// 드라이브 정리는 **폴더째**가 기본이다 — 폴더 하나를 휴지통에 넣으면 안의 파일이
// 전부 따라간다(파일마다 Apps Script 왕복을 하면 사진 열 장짜리 업무 삭제가 십수 초다).
// 폴더 휴지통은 스크립트 v4부터다(docs/DRIVE.md) — 옛 스크립트면 실패하므로
// 그때는 파일 단위로 되돌아간다. 실패를 조용히 넘기면 드라이브에 고아가 남는다.
async function trashDriveId(driveId) {
  await driveCall({ action: 'trash', fileId: driveId });
}

export async function deleteCard(id) {
  const c = client();
  // 정리에 필요한 것(폴더 id·파일 목록)을 **먼저 읽고**, 행을 지우고, 실체는 마지막에.
  // 첨부 삭제(deleteAttachment)와 같은 순서 원칙이다 — 드라이브 왕복이 끝나기를
  // 기다렸다 행을 지우면, 그 사이 재조회가 지운 업무를 화면에 되살린다.
  let folderId = null, files = [];
  try {
    const row = unwrap(await c.from('cards').select('drive_folder_id').eq('id', id).single());
    folderId = row?.drive_folder_id || null;
    files = unwrap(await c.from('files').select('*').eq('card_id', id)) || [];
  } catch (e) {
    console.error('[cloud] 업무 삭제 준비(폴더·파일 조회) 실패:', e);
  }
  const { error: delErr } = await c.from('cards').delete().eq('id', id);
  if (delErr) throw delErr;
  // 파일 행 정리 — 카드 삭제로 card_id가 null이 됐으므로 모아둔 id로 지운다
  if (files.length) {
    const { error } = await c.from('files').delete().in('id', files.map(f => f.id));
    if (error) console.error('[cloud] 첨부 행 정리 실패:', error);
  }
  // 실체 정리는 최선으로 — 폴더째 휴지통(안의 파일이 전부 따라간다), 실패하면 파일 단위
  let folderTrashed = false;
  if (folderId) {
    try { await trashDriveId(folderId); folderTrashed = true; }
    catch (e) { console.error('[cloud] 업무 폴더 휴지통 이동 실패(파일 단위로 전환):', e); }
  }
  for (const f of files) {
    if (folderTrashed && f.source === 'drive') continue;
    if (f.source === 'drive' && f.drive_file_id) {
      try { await driveCall({ action: 'trash', fileId: f.drive_file_id }); }
      catch (e) { console.error('[drive] 휴지통 이동 실패:', f.name, e); }
    }
    if (f.storage_path) {
      try { await c.storage.from(ATTACH_BUCKET).remove([f.storage_path]); }
      catch (e) { console.error('[cloud] Storage 정리 실패:', f.name, e); }
    }
  }
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

// ── 개인 구글 드라이브 (docs/DRIVE.md) ──────────────────────────────────────
// 첨부의 실체를 드라이브로 옮기고 DB에는 참조만 남긴다. 브라우저는 스크립트 URL을
// 모르고 /api/drive가 대신 부른다. 드라이브가 설정되지 않은 환경(로컬·프리뷰)은
// 501을 돌려주므로 부르는 쪽이 Storage로 되돌린다.
async function driveCall(payload) {
  // **`getSession()`은 supabase의 `{ data }`를 이미 벗겨서 `{ session, user }`를
  // 돌려준다.** 여기서 `.access_token`을 바로 꺼내면 언제나 undefined였고, 그래서
  // 앱에서 올리는 첨부가 **한 번도 드라이브로 가지 못했다**(§6-29와 같은 함정을
  // 그대로 다시 밟았다 — 그 항목이 "한 겹 더 벗기면 조용히 undefined가 되고,
  // 그 자리가 아무도 안 걸리는 필터가 된다"고 적어 둔 바로 그것이다).
  const token = (await getSession())?.session?.access_token;
  if (!token) { const e = new Error('로그인이 필요해요'); e.human = '로그인이 풀렸어요 · 새로고침하고 다시 로그인해주세요'; throw e; }
  const r = await fetch('/api/drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const out = await r.json().catch(() => ({}));
  if (r.status === 501) { const e = new Error('드라이브 미설정'); e.notConfigured = true; throw e; }
  if (!r.ok) {
    // 서버가 한국어로 이유를 준다 — 그대로 화면에 실어야 무엇이 막혔는지 보인다.
    // status도 같이 남긴다(로그에서 401/403/413/502를 가르기 위해).
    const e = new Error(out.error || `드라이브 오류 (${r.status})`);
    e.human = out.error || `드라이브가 응답하지 않았어요 (${r.status})`;
    e.status = r.status;
    console.error('[drive] 실패:', r.status, out);
    throw e;
  }
  return out;
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onerror = () => {
    const e = fr.error || new Error('파일을 읽지 못했어요');
    e.human = '파일을 읽지 못했어요 · 다른 파일로 해보시거나 다시 시도해주세요';
    reject(e);
  };
  // data:...;base64,XXXX → 앞머리를 떼고 보낸다
  fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
  fr.readAsDataURL(file);
});

// 드라이브 파일의 그림 주소. 구글 이미지 CDN이 **줄여서** 내주므로 우리 대역폭이 0이다
// (스크립트가 올릴 때 '링크를 아는 사람은 보기'로 열어 둔다 — 사용자 결정 2026-08-25).
export const driveImageUrl = (fileId, size = 200) =>
  `https://lh3.googleusercontent.com/d/${fileId}=w${size}-h${size}-c`;
// 미리보기용 — 자르지 않고(=s: 긴 변 기준) 크게. 주소가 고정이라 브라우저가 캐싱한다
// (서명 URL은 발급마다 달라서 캐시가 통째로 빗나갔다 — §1.3 Egress에서 겪은 함정).
export const driveImageFullUrl = (fileId, size = 1600) =>
  `https://lh3.googleusercontent.com/d/${fileId}=s${size}`;

// 파일 업로드: 드라이브가 설정돼 있으면 드라이브로, 아니면 Storage로.
// 읽기 경로는 files.source로 이미 갈라져 있어(getFileOpenUrl) 둘이 섞여 있어도 된다.
// 드라이브 구조는 `프로젝트 / 업무 / 파일`이다(v3 스크립트).
//  · 업무 폴더 id를 이미 아는 경우 → 그 폴더에 바로 넣는다(cardTitle을 **보내지
//    않는다** — 보내면 그 안에 또 같은 이름 폴더를 판다)
//  · 모르는 경우 → 프로젝트 폴더 + 업무 제목으로 만들게 하고, 돌려받은 folderId를
//    부르는 쪽이 cards.drive_folder_id에 적는다(0026)
// id로 잡는 이유는 프로젝트와 같다 — 제목으로만 찾으면 제목을 바꾼 순간 한 업무의
// 파일이 두 폴더로 갈라진다(사용자 지적).
export async function uploadAttachment(file, { projectId, cardId, projectName, driveFolderId, cardTitle, cardFolderId }) {
  const c = client();
  try {
    const up = await driveCall({
      action: 'upload',
      projectName: projectName || '기타',
      folderId: cardFolderId || driveFolderId || undefined,
      cardTitle: cardFolderId ? undefined : (cardTitle || undefined),
      name: file.name, mimeType: file.type || undefined,
      dataBase64: await fileToBase64(file),
    });
    let row;
    try {
      row = unwrap(await c.from('files').insert({
      project_id: projectId,
      card_id: cardId,
      name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size ?? null,
      source: 'drive',
      drive_file_id: up.id,
      web_view_link: up.url,
      }).select().single());
    } catch (e) {
      // 드라이브에는 올라갔는데 DB 행을 못 만든 경우다. 어디서 막혔는지 말해 준다 —
      // 여기가 조용하면 "드라이브에는 있는데 앱에는 없는" 상태를 아무도 설명 못 한다.
      console.error('[drive] 올라갔지만 files 행 생성 실패:', e);
      e.human = e.human || `파일은 드라이브에 올라갔는데 목록에 넣지 못했어요 · ${e.message || e}`;
      throw e;
    }
    // 이 업무의 폴더를 처음 만든 경우 id를 적어 둔다(다음 업로드부터 id로 넣는다)
    if (!cardFolderId && up.folderId) {
      try { await c.from('cards').update({ drive_folder_id: up.folderId }).eq('id', cardId); }
      catch (e) { console.error('[drive] 업무 폴더 id 저장 실패:', e); }
    }
    // 부르는 쪽(병렬 업로드)이 나머지 파일을 이 폴더 id로 바로 넣을 수 있게 실어 보낸다
    // — files 컬럼이 아니라 임시 속성이다(DB에는 cards.drive_folder_id가 원본).
    return Object.assign(row, { _driveFolderId: up.folderId });
  } catch (e) {
    if (!e.notConfigured) throw e;
    // 드라이브가 없는 환경 — 예전 경로 그대로
    return uploadAttachmentToStorage(file, { projectId, cardId });
  }
}

// 드라이브 파일 바이트 — PDF를 앱 안 pdf.js로 그릴 때 쓴다(/api/drive-file 주석).
// 브라우저는 drive.google.com에 CORS로 막히므로 서버가 얇게 중계한다.
export async function fetchDriveFileBlob(fileId) {
  const { session } = await getSession();
  const token = session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');
  const r = await fetch(`/api/drive-file?id=${encodeURIComponent(fileId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const out = await r.json().catch(() => ({}));
    const e = new Error(out.error || `파일을 받아오지 못했어요 (${r.status})`);
    e.human = out.error;
    throw e;
  }
  return r.blob();
}

// 드라이브 폴더 확보 — 프로젝트 하나에 폴더 하나(projects.drive_folder_id)
export async function ensureDriveFolder(projectName, folderId) {
  return driveCall({ action: 'ensureFolder', projectName, folderId: folderId || undefined });
}
export async function renameDriveFolder(folderId, newName) {
  return driveCall({ action: 'renameFolder', folderId, newName });
}

// 예전 경로(Supabase Storage). 드라이브 이전 파일과 미설정 환경이 쓴다.
async function uploadAttachmentToStorage(file, { projectId, cardId }) {
  const c = client();
  const safe = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${projectId}/${cardId}/${crypto.randomUUID()}-${safe}`;
  // cacheControl: 경로에 uuid가 박혀 있어 **같은 주소가 다른 그림이 될 수 없다.**
  // 기본값은 1시간이라, 한 시간 뒤 다시 열면 (주소가 같아도) 되묻는 왕복이 생긴다.
  // 30일로 두면 그 왕복도 사라진다. 이미 올라간 파일은 그대로 3600이고, 그쪽은
  // ETag 덕에 304(본문 0바이트)로 끝난다.
  const up = await c.storage.from(ATTACH_BUCKET).upload(path, file, {
    contentType: file.type || undefined, upsert: false, cacheControl: '2592000',
  });
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
//
// **같은 파일은 같은 URL을 다시 쓴다(50분).** 매번 새로 발급하면 토큰이 달라서 주소가
// 바뀌고, 브라우저 캐시가 통째로 빗나가 같은 이미지를 열 때마다 다시 내려받았다 —
// 업무 창을 여닫을 때마다 첨부 썸네일 전체가 다시 왔다(Storage Egress의 큰 몫).
// 탭이 살아 있는 동안만 유효한 메모리 캐시라 권한 회수 걱정은 만료(1시간)와 같다.
// ── 서명 URL 캐시 ──────────────────────────────────────────────────────────
// 브라우저 캐시는 **주소가 같을 때만** 맞는다. 매번 새 토큰을 발급하면 같은 그림도
// 남남이 되어 통째로 다시 내려온다 — 느린 것도 Egress도 여기서 나왔다.
//
// 실측(2026-08-25): Storage 응답은 `cache-control: public, max-age=3600` + ETag이고
// 앞에 Cloudflare가 있다. 즉 주소만 유지되면 1시간 뒤에도 304(본문 0바이트)로 끝난다.
// 그래서 **주소를 오래 유지하는 것**이 이 캐시의 전부다.
//
// 파일 열기(미리보기·내려받기)는 1시간이면 충분하다. 썸네일은 다르다 — 목록을 열
// 때마다 보이고, 파일이 바뀌지 않으며(경로에 uuid가 박힌다), 한 장이 원본 1.5MB짜리
// 사진이다. 그래서 썸네일만 7일로 길게 서명하고 6일까지 재사용한다.
//
// 저장소는 localStorage다 — sessionStorage는 탭을 닫으면 사라져서, 다음에 열 때
// 주소가 바뀌고 캐시가 다시 빗나간다. 서명 URL은 유효기간이 지나면 스스로 죽고,
// 만료 검사도 여기서 한다.
const SIGNED_TTL_S = 3600;                       // 파일 열기
const SIGNED_REUSE_MS = 50 * 60 * 1000;
const THUMB_TTL_S = 7 * 24 * 3600;               // 썸네일(바뀌지 않는 그림)
const THUMB_REUSE_MS = 6 * 24 * 60 * 60 * 1000;
const SIGNED_STORE_KEY = 'church_signed_urls';

const signedUrlCache = new Map(); // key → { url, at, ttl }
const isThumbKey = (key) => key.startsWith('thumb:');
const reuseMsFor = (key) => (isThumbKey(key) ? THUMB_REUSE_MS : SIGNED_REUSE_MS);

try {
  const saved = JSON.parse(localStorage.getItem(SIGNED_STORE_KEY) || '{}');
  const now = Date.now();
  for (const [key, hit] of Object.entries(saved)) {
    if (hit?.url && now - hit.at < reuseMsFor(key)) signedUrlCache.set(key, hit);
  }
} catch { /* 사파리 프라이빗 등 — 캐시 없이 그냥 돈다 */ }

let signedFlush = null;
const rememberSigned = (key, url) => {
  signedUrlCache.set(key, { url, at: Date.now() });
  // 한 번에 여러 건이 들어오므로 쓰기는 한 프레임 뒤에 몰아서 한 번만.
  // 만료된 것은 이때 걷어낸다 — 안 그러면 지운 파일의 주소가 영영 쌓인다.
  clearTimeout(signedFlush);
  signedFlush = setTimeout(() => {
    const now = Date.now();
    for (const [k, v] of signedUrlCache) if (now - v.at >= reuseMsFor(k)) signedUrlCache.delete(k);
    try { localStorage.setItem(SIGNED_STORE_KEY, JSON.stringify(Object.fromEntries(signedUrlCache))); }
    catch { /* 용량 초과 등 — 메모리 캐시만으로도 동작한다 */ }
  }, 0);
};

const cachedSigned = (key) => {
  const hit = signedUrlCache.get(key);
  return hit && Date.now() - hit.at < reuseMsFor(key) ? hit.url : null;
};

// 썸네일은 **원본을 받지 않는다.** 80px 상자에 1.5MB 원본을 그리고 있었고,
// 사진 열 장짜리 업무를 LTE에서 열면 15MB가 내려와 스켈레톤이 끝나지 않았다
// (사용자 지적 — "스켈레톤이 적용이 안 된 것 같다"의 진짜 원인).
// 이 프로젝트는 Storage 이미지 변환이 켜져 있다(확인함: 9.5KB → 4.3KB).
// 200px인 이유: 화면 상자가 80px이고 고해상도 화면은 2배로 그린다.
// 변환은 서명 요청의 **본문**에 실려서 토큰에 묶이므로 묶음 발급(createSignedUrls)을
// 쓸 수 없다 — 파일마다 한 번씩 서명한다(토큰 발급뿐이라 가볍고, 동시에 보낸다).
const THUMB = { width: 200, height: 200, resize: 'cover' };

export async function getAttachmentThumbUrls(storagePaths) {
  const map = {};
  const need = [];
  for (const p of storagePaths.filter(Boolean)) {
    const hit = cachedSigned(`thumb:${p}`);
    if (hit) map[p] = hit; else need.push(p);
  }
  if (!need.length) return map;
  await Promise.all(need.map(async (p) => {
    try {
      const { data, error } = await client().storage.from(ATTACH_BUCKET)
        .createSignedUrl(p, THUMB_TTL_S, { transform: THUMB });
      if (error) throw error;
      map[p] = data.signedUrl;
      rememberSigned(`thumb:${p}`, data.signedUrl);
    } catch (e) {
      // 변환이 꺼지면(요금제 변경 등) 여기서 걸린다 — 부르는 쪽이 원본으로 되돌린다
      console.error('[cloud] 썸네일 서명 실패:', p, e);
    }
  }));
  return map;
}

export async function getAttachmentUrl(storagePath) {
  const hit = cachedSigned(storagePath);
  if (hit) return hit;
  const { data, error } = await client().storage.from(ATTACH_BUCKET).createSignedUrl(storagePath, SIGNED_TTL_S);
  if (error) throw error;
  rememberSigned(storagePath, data.signedUrl);
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
// 캐시에 있는 것은 빼고 발급한다 — 위 getAttachmentUrl과 같은 이유(브라우저 캐시 유지).
export async function getAttachmentUrls(storagePaths = []) {
  const map = {};
  const need = [];
  for (const p of storagePaths.filter(Boolean)) {
    const hit = cachedSigned(p);
    if (hit) map[p] = hit; else need.push(p);
  }
  if (!need.length) return map;
  // 40개씩 나눠 보낸다 — 한 요청에 전부 실으면 그 요청이 실패할 때 그 업무의 썸네일이
  // **통째로** 죽고, 첫 장이 그려지기까지 마지막 장을 기다린다(사진이 많은 업무에서
  // 실제로 "이미지가 안 뜬다"로 보였다).
  const CHUNK = 40;
  for (let i = 0; i < need.length; i += CHUNK) {
    const slice = need.slice(i, i + CHUNK);
    const { data, error } = await client().storage.from(ATTACH_BUCKET).createSignedUrls(slice, SIGNED_TTL_S);
    if (error) {
      console.error('[cloud] 서명 URL 묶음 실패:', error);
      continue;                                   // 나머지 묶음은 계속 시도한다
    }
    (data || []).forEach(d => {
      if (d?.path && d.signedUrl) {
        map[d.path] = d.signedUrl;
        rememberSigned(d.path, d.signedUrl);
      }
    });
  }
  return map;
}

// 삭제 — **DB 행부터 지운다.** 화면의 진실은 DB다: 드라이브 휴지통 왕복(1~2초)을
// 먼저 하면, 그 사이 다른 조회(저장 직후 보기 화면의 listCardFiles)가 아직 남아 있는
// 행을 읽어 와 **지운 파일이 화면에 되살아났다**(사용자 지적 — 엑셀 지우고 저장했더니
// 그대로 있었다). 행이 먼저 사라지면 어떤 조회가 언제 다녀가도 그 파일은 없다.
// 실체 정리(드라이브 휴지통·Storage)는 그 뒤 최선으로 — 실패해도 던지지 않는다.
// 드라이브는 30일 복구가 되고(사용자 결정), 남은 실체는 소유자가 정리할 수 있다.
export async function deleteAttachment(fileRow) {
  const c = client();
  const { error } = await c.from('files').delete().eq('id', fileRow.id);
  if (error) throw error;
  if (fileRow.storage_path) {
    try { await c.storage.from(ATTACH_BUCKET).remove([fileRow.storage_path]); }
    catch (e) { console.error('[cloud] Storage 정리 실패:', e); }
  }
  if (fileRow.source === 'drive' && fileRow.drive_file_id) {
    try { await driveCall({ action: 'trash', fileId: fileRow.drive_file_id }); }
    catch (e) { console.error('[drive] 휴지통 이동 실패:', e); }
  }
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
// 지금 접속해 있는 사람 — Supabase Realtime presence. DB에 아무것도 쓰지 않는다.
// last_seen_at으로 판정하지 않는 이유: 그건 앱을 열 때 한 번 찍는 값이라, 4분 전에 탭을
// 닫은 사람도 "지금 접속"으로 보인다. presence는 연결이 끊기면 서버가 바로 지운다.
// onChange는 접속 중인 profile id 배열을 받는다(나 포함).
export function subscribePresence(onChange) {
  const c = client();
  let channel = null;
  let stopped = false;
  (async () => {
    const { data: { user } } = await c.auth.getUser();
    if (!user || stopped) return;
    channel = c.channel('presence-workspace', { config: { presence: { key: user.id } } });
    channel.on('presence', { event: 'sync' }, () => onChange(Object.keys(channel.presenceState())));
    channel.subscribe((status) => { if (status === 'SUBSCRIBED') channel.track({}); });
  })();
  return () => { stopped = true; if (channel) c.removeChannel(channel); };
}

// 최근 활동 — 대시보드 피드용. 표시는 이름·카드 제목으로 하므로 여기서는 행만 가져온다
// (이름은 profileIdToName, 제목은 스토어의 tasks가 이미 안다 — 조인이 필요 없다).
export async function listRecentActivity(limit = 30) {
  return unwrap(await client().from('activity')
    .select('id, actor_id, action, card_id, project_id, created_at')
    .order('created_at', { ascending: false }).limit(limit));
}

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
    // 대시보드 '최근 활동' 피드(0020). 라우팅은 전체 재조회가 아니라 피드만 다시 읽기다
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activity' }, onChange)
    .subscribe();
  return () => c.removeChannel(channel);
}


// ── 첨부 비밀번호 (0023) ────────────────────────────────────────────────────
// **화면을 가리는 잠금이다. 파일 자체를 잠그지 않는다.** 주소를 직접 아는 사람은
// 그대로 열 수 있다 — 같이 일하는 사람들 사이에서 실수로 여는 것을 막는 수준이고,
// 그 이상으로 읽히게 만들면 안 된다(0023 주석에 이유가 있다). 화면 문구에
// '암호화'라는 말을 쓰지 않는 이유다.
// 해시는 브라우저의 WebCrypto로 만든다(서버 왕복 없음). 소금은 파일마다 다르다.
const sha256Hex = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
};

export async function setFilePassword(fileId, password) {
  const c = client();
  if (!password) {
    return unwrap(await c.from('files')
      .update({ view_pw: null, view_pw_salt: null, view_pw_by: null })
      .eq('id', fileId).select().single());
  }
  const salt = crypto.randomUUID();
  const me = (await getSession())?.user?.id ?? null;
  return unwrap(await c.from('files')
    .update({ view_pw: await sha256Hex(salt + password), view_pw_salt: salt, view_pw_by: me })
    .eq('id', fileId).select().single());
}

export async function checkFilePassword(row, password) {
  if (!row?.view_pw) return true;
  return (await sha256Hex((row.view_pw_salt || '') + password)) === row.view_pw;
}

// 카드 순서만 쓴다 — 카드 폼 전체를 실어 보내면 순서를 바꾸는 사람이 남의 편집을
// 같이 덮는다(요약 고정이 cardSummaryCloud로 세 칸만 쓰는 것과 같은 이유).
export async function setCardPosition(id, position) {
  return unwrap(await client().from('cards').update({ position }).eq('id', id).select('id').single());
}

// ── 멤버 관리 (0022) ────────────────────────────────────────────────────────
// 전역 '멤버' 화면이 쓴다. 관리자만 의미가 있지만 정책이 DB에서 막으므로
// 화면에서 감추는 것과 이중으로 걸린다(§4.5의 요약 고정과 다른 점이다).
export async function listMembersAdmin() {
  return unwrap(await client().from('profiles')
    .select('id, display_name, email, avatar_url, approved, approved_at, removed_at, created_at, last_seen_at, birthday')
    .order('created_at', { ascending: true }));
}

// 승인·승인 취소(=내보내기). 내보내면 접근만 끊기고 지난 기록의 이름은 남는다.
// 환송(approved=false)은 `removed_at`을 같이 찍는다 — 그래야 '승인을 기다리는
// 사람'으로 다시 올라오지 않는다(0027). 다시 부르면 지운다.
export async function setApproved(profileId, approved) {
  const me = (await getSession())?.user?.id ?? null;
  const now = new Date().toISOString();
  return unwrap(await client().from('profiles')
    .update(approved
      ? { approved: true, approved_at: now, approved_by: me, removed_at: null, removed_by: null }
      : { approved: false, removed_at: now, removed_by: me })
    .eq('id', profileId).select('id, approved, removed_at').single());
}

// 관리자 목록·지정·해제. admins는 이메일이 원본이고 profiles에는 email이 없어서
// 화면은 auth 쪽 이메일을 손으로 넣는다(가입자 목록에서 고르는 길은 profiles에
// 이메일이 없어 막혀 있다 — 0022 주석 참고).
export async function listAdmins() {
  return unwrap(await client().from('admins').select('email, is_master').order('email'));
}
export async function addAdmin(email) {
  return unwrap(await client().from('admins').insert({ email: String(email).trim().toLowerCase() }).select('email').single());
}
export async function removeAdmin(email) {
  const { error } = await client().from('admins').delete().eq('email', String(email).trim().toLowerCase());
  if (error) throw error;
}
