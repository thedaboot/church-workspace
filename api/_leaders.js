import { isLeaderOnly } from '../src/services/visibility.js';

// ============================================================================
// 리더만 보는 프로젝트(0092) — 서버 키 경로의 판정 한 벌(RLS를 안 타는 자리라 코드로 거른다)
// ----------------------------------------------------------------------------
// 부르는 곳: api/push.js(앱 알림의 푸시 · 마감 임박) · api/ics.js(내 달력 구독). 위키 장(api/_wiki/gather.js)은
// 통째로 읽은 원본을 visibility.dropLeaderOnly로 걷고, 공유 카드(api/share.js)는 그 행의 visibility만 본다.
// 리더 판정은 DB 함수 leader_profile_ids() 한 벌이다 — 서비스 키는 auth.uid()가 없어 그대로 받는다(0092).
// `_`로 시작해 라우트가 아니다.
// ============================================================================

// 리더 계정 id(남긴 계정) Set
export async function leaderIdSet(db) {
  const { data, error } = await db.rpc('leader_profile_ids');
  if (error) throw error;
  return new Set(Array.isArray(data) ? data : []);
}

// 이 업무(또는 프로젝트)가 리더만 보는 것인가. **업무가 있으면 업무의 지금 프로젝트로 본다** — 몸통의
// projectId는 부르는 쪽이 보낸 값이라 믿지 않는다. 없는 업무·프로젝트면 false(가릴 것이 없다).
export async function leaderOnlyOf(db, { cardId, projectId } = {}) {
  if (cardId) {
    const { data, error } = await db.from('cards').select('project_id, projects(visibility)').eq('id', cardId).maybeSingle();
    if (error) throw error;
    if (data) return isLeaderOnly(data.projects);
  }
  if (projectId) {
    const { data, error } = await db.from('projects').select('visibility').eq('id', projectId).maybeSingle();
    if (error) throw error;
    return isLeaderOnly(data);
  }
  return false;
}
