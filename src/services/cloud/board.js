// ============================================================================
// 업무 보드 — 프로젝트 · 카드(담당 팀·담당자 조인) · 요약 고정 · 순서 · 댓글 · 댓글 반응(0032) · 참고 링크
// ----------------------------------------------------------------------------
// 프로젝트·업무를 지우면 첨부 실체 정리는 drive.js의 trashFolder·trashFileBodies 한 벌로 간다(§6-29-e).
// ============================================================================
import { myUid } from '../supabaseClient.js';
import { client, unwrap } from './core.js';
import { trashFolder, trashFileBodies } from './drive.js';

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
  unwrap(await c.from('projects').delete().eq('id', id));
  await dropFileRows(files);
  // 프로젝트 폴더째 휴지통 — 안의 업무 폴더·파일이 한 번에 간다. 실패하면 업무 단위로.
  const projectTrashed = await trashFolder(proj?.drive_folder_id, '프로젝트 폴더', '업무 단위로 전환');
  const trashedCards = new Set();
  if (!projectTrashed) {
    for (const card of cards) {
      if (await trashFolder(card.drive_folder_id, '업무 폴더')) trashedCards.add(card.id);
    }
  }
  // Storage(레거시) 실체는 드라이브 밖이라 언제나 따로 지운다 — trashFileBodies가 폴더와 상관없이 지운다
  await trashFileBodies(files, { inTrashedFolder: (f) => projectTrashed || trashedCards.has(f.card_id) });
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
    unwrap(await client().from('card_teams').insert(teamIds.map(team_id => ({ card_id: card.id, team_id }))));
  }
  if (assigneeIds.length) {
    unwrap(await client().from('card_assignees').insert(assigneeIds.map(profile_id => ({ card_id: card.id, profile_id }))));
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
  // **카드 행에 보낼 칸이 없으면**(담당 팀만 바꿨다 — 팀은 조인 표뿐) 빈 update를 보내지 않는다(2026-10-02 사용자 제보 —
  // '임원진으로 담당 팀을 바꾸면 저장이 안 된다 · 제목을 먼저 적어주세요'). PostgREST는 빈 몸통 update에 0행(PGRST116)을
  // 돌려주고, 그걸 아래 '행이 없다' 폴백이 받아 `{ id }`만으로 upsert해 title not-null(23502)로 깨졌다.
  // 조인을 **먼저** 쓰고 그다음 updated_at만 올린다 — 남의 화면은 cards UPDATE 신호로 그 카드를 다시 읽으므로
  // (card_teams는 실시간 구독에 없다) 순서가 거꾸로면 옛 팀을 읽는다. 카드가 정말 없으면 이 update가 PGRST116을 던진다.
  if (!Object.keys(patch || {}).length) {
    if (teamIds !== undefined) await resetCardJoin('card_teams', 'team_id', id, teamIds);
    if (assigneeIds !== undefined) await resetCardJoin('card_assignees', 'profile_id', id, assigneeIds);
    return unwrap(await client().from('cards').update({ updated_at: new Date().toISOString() }).eq('id', id).select().single());
  }
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
// 드라이브 정리는 **폴더째**가 기본이다(drive.js trashFolder 머리말 — 실패하면 파일 단위로 되돌아간다).
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
  unwrap(await c.from('cards').delete().eq('id', id));
  await dropFileRows(files);
  // 실체 정리는 최선으로 — 폴더째 휴지통(안의 파일이 전부 따라간다), 실패하면 파일 단위.
  // 폴더가 들어갔으면 드라이브 행은 통째로 건너뛴다(그 행에 남은 옛 Storage 사본까지 — 예전 그대로).
  const folderTrashed = await trashFolder(folderId, '업무 폴더', '파일 단위로 전환');
  await trashFileBodies(folderTrashed ? files.filter(f => f.source !== 'drive') : files);
}

// 주인을 지운 뒤 남은 첨부 행 — 카드 삭제로 card_id가 null이 됐으므로 모아 둔 id로 지운다.
// 실패는 기록만 한다(주인 삭제는 이미 끝났다).
async function dropFileRows(files) {
  if (!files.length) return;
  const { error } = await client().from('files').delete().in('id', files.map(f => f.id));
  if (error) console.error('[cloud] 첨부 행 정리 실패:', error);
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
  unwrap(await client().from('comments').delete().eq('id', id));
}

// ── comment_reactions (0032 · 하트·따봉·체크) ───────────────────────────────
// 카드 하나의 반응을 한 번에 읽는다. comment_reactions에는 card_id가 없으므로
// comments를 inner join해 그 카드의 댓글에 달린 것만 가져온다(왕복 한 번 —
// 댓글을 먼저 읽고 id 목록으로 다시 묻는 길은 업무 창 열림이 그만큼 늦어진다).
// **부르는 쪽이 실패를 삼킨다** — 마이그레이션이 아직 안 나간 환경에서 이 조회가
// 던지면 댓글·활동까지 통째로 못 읽는다(loadCardDetail이 Promise.all이다).
export async function listCardReactions(cardId) {
  return unwrap(await client().from('comment_reactions')
    .select('comment_id, user_id, kind, comments!inner(card_id)')
    .eq('comments.card_id', cardId));
}

// 켜기. user_id는 DB가 컬럼 기본값으로 채운다(0032 · 0063부터 effective_uid()) —
// 클라이언트가 주인을 못 정한다.
// 이미 눌러 둔 것(23505)은 성공으로 본다: 토글이 겹쳐 도착해도 화면이 오류를
// 띄울 이유가 없다. .select()는 붙이지 않는다(§6-25와 같은 습관).
export async function addCommentReaction(commentId, kind) {
  const { error } = await client().from('comment_reactions')
    .insert({ comment_id: commentId, kind });
  if (error && error.code !== '23505') throw error;
}

// 끄기. RLS(0032)가 이미 자기 행만 지우게 막지만 여기서도 못 박는다 —
// 조건이 하나 빠진 delete는 조용히 남의 것까지 지운다(§6-29의 반대편).
export async function removeCommentReaction(commentId, kind) {
  const uid = await myUid();                  // 켤 때 DB가 적는 주인과 같은 값(0063)
  let q = client().from('comment_reactions').delete()
    .eq('comment_id', commentId).eq('kind', kind);
  if (uid) q = q.eq('user_id', uid);
  unwrap(await q);
}

// ── resource_links ──────────────────────────────────────────────────────────
export async function listAllLinks() {
  return unwrap(await client().from('resource_links').select('*').order('created_at', { ascending: true }));
}
// 주인은 **프로젝트이거나 카드**다(0058의 배타 CHECK). 둘 다 넘기면 DB가 23514로 막는다 —
// 여기서 미리 가르지 않는 이유는 그 판정이 한 곳(DB)에만 있어야 하기 때문이다.
export async function addLink({ projectId = null, cardId = null }, title, url, id) {
  const row = cardId ? { card_id: cardId, title, url } : { project_id: projectId, title, url };
  if (id) row.id = id;
  return unwrap(await client().from('resource_links').insert(row).select().single());
}
export async function removeLink(id) {
  unwrap(await client().from('resource_links').delete().eq('id', id));
}

// 카드 순서만 쓴다 — 카드 폼 전체를 실어 보내면 순서를 바꾸는 사람이 남의 편집을
// 같이 덮는다(요약 고정이 cardSummaryCloud로 세 칸만 쓰는 것과 같은 이유).
export async function setCardPosition(id, position) {
  return unwrap(await client().from('cards').update({ position }).eq('id', id).select('id').single());
}
