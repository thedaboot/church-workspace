// ============================================================================
// 승인 대기 → 승인 전환 판정 — 순수 모듈(React·supabase 없음 · tests/logcheck가 검사)
// ----------------------------------------------------------------------------
// 예전에는 승인 여부를 **세션이 바뀔 때만**(토큰 갱신 = 약 한 시간) 다시 물어서, 관리자가
// 수락해도 기다리는 사람은 새로고침하거나 한 시간을 기다려야 들어왔다. 지금은 승인 대기
// 화면이 떠 있는 동안 세 갈래로 다시 묻는다(services/auth.jsx):
//   · 실시간 — 내 profiles 행(0018 발행 · 0022 RLS가 승인 전에도 자기 행은 읽게 둔다)
//   · 앱이 다시 보일 때 — 폰이 잠들면 실시간 소켓이 끊긴다
//   · 가벼운 주기(APPROVAL_POLL_MS) — 소켓이 조용히 죽은 경우의 마지막 방어선
// 묻는 것은 늘 같은 rpc 세 개(is_admin·is_master·is_approved)이고, 답을 읽는 것이 permFromRpc
// 한 벌이다 — 처음 물을 때와 다시 물을 때가 같은 판정을 쓴다.
// ============================================================================

export const APPROVAL_POLL_MS = 30000;

// rpc 세 개의 결과 → 자격. **하나라도 실패면 null**(모름)이다 — 못 물어본 것을 '아니오'로
// 바꾸면 신호가 잠깐 끊긴 사람이 승인 대기 화면으로 떨어진다(2026-09-22 신고).
export function permFromRpc(results) {
  if (!Array.isArray(results) || results.length !== 3) return null;
  if (results.some(r => !r || r.error)) return null;
  const [a, m, ap] = results;
  return { isAdmin: !!a.data, isMaster: !!m.data, approved: !!ap.data };
}

// 승인을 지켜봐야 하는가 — 클라우드 · 로그인 · 승인이 **'아니오'로 확정**됐을 때만.
// 아직 모름(null)이면 지켜보지 않는다(첫 물음이 아직 돌고 있다).
export function shouldWatchApproval({ enabled, hasSession, approved }) {
  return !!enabled && !!hasSession && approved === false;
}

// 실시간으로 받은 내 profiles 행이 다시 물을 이유인가. 이름·사진을 채우는 쓰기(ensureMyProfile)도
// 같은 행을 건드리므로 승인 칸이 참이 된 것만 본다. 판정 자체는 is_approved()가 한다 —
// 여기서 행만 보고 들여보내지 않는다(관리자 통과·합친 계정 같은 규칙이 그 함수에 있다).
export function approvalRowPassed(row) {
  return !!row && row.approved === true && !row.removed_at;
}
