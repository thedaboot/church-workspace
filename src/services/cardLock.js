// ============================================================================
// 업무 잠금(0099) — 판정 한 벌(import 0 · 앱·서버·노드 검사가 같이 문다)
// ----------------------------------------------------------------------------
// **진짜 잠금이다** — 경계는 DB다(0099 정책 · locked_hidden_ids · card_secrets). 첨부·참고 링크의 비밀번호(viewPw.js ·
// 화면 가림)와 다르다. 여기는 RLS를 안 타는 자리가 같은 규칙을 쓰게 모은 것이다:
//   앱   — 업무 창을 잠금 판으로 그릴지 · 자물쇠 버튼을 세울지 · 검색이 본문을 볼지 · 게스트(localStorage)의 같은 흐름
//   서버 — 서비스 키 경로(api/_wiki/gather.js 위키 장 · api/_docsync.js 문서 임베딩 · api/share.js 공유 카드 · api/_leaders.js)
//
// 앱 업무 모양의 칸(cloudSync.cardToTask · 게스트 저장도 같은 이름):
//   locked      잠겼나
//   lockedOpen  나에게 열려 있나 — 클라우드는 card_secrets 행이 왔는지(여는 사람에게만 온다 · 만든 사람·맞힌 계정·마스터),
//               게스트는 만든 사람이거나 맞혔는지
//   lockPw      게스트만 — { view_pw, view_pw_salt }(viewPw.js와 같은 해시). 클라우드의 해시는 브라우저로 안 온다
// ============================================================================

export const LOCK_MOTION_MS = 420;   // 잠글 때·열 때 판이 접히고 걷히는 시간(앱 quint 토큰 · index.css .dc-lock-*)
export const LOCK_TRY_LIMIT = 5;     // 같은 사람 같은 업무 1분에 — 0099 unlock_card와 같은 값
export const LOCK_TRY_WINDOW_MS = 60_000;

// 이 업무를 지금 나에게 잠금 판으로 그리나
export const isCardClosed = (task) => !!task?.locked && !task?.lockedOpen;

// 자물쇠 버튼(잠그기 · 다시 설정 · 잠금 해제)은 **만든 사람에게만**(사용자 결정 2026-10-13).
// 클라우드는 created_by(남긴 계정까지 — isMine이 가른다), 게스트는 작성자 이름.
export const canLockCard = ({ cloudOn, isMine = false, author = '', me = '' } = {}) => (cloudOn ? !!isMine : !!author && author === me);

// 잠그기 팝오버의 두 칸 — 비었거나 다르면 어느 칸이 틀렸는지(흔들 칸). 맞으면 null.
export function lockFormError(pw, confirm) {
  if (!String(pw ?? '')) return 'pw';
  if (String(pw) !== String(confirm ?? '')) return 'confirm';
  return null;
}

// 시도 제한(게스트가 서버와 같은 흐름을 돌게) — 지난 1분 안의 시도 시각들 → 더 해도 되나
export function allowTry(times = [], now = Date.now()) {
  return times.filter(t => now - t < LOCK_TRY_WINDOW_MS).length < LOCK_TRY_LIMIT;
}

// 클라우드 card_secrets 행을 업무에 얹는다 — 행이 왔으면 열 수 있는 사람이다(본문 · 고정 요약). 안 잠겼으면 그대로.
export function withSecret(task, secret) {
  if (!task?.locked) return { ...task, lockedOpen: false };
  if (!secret) return { ...task, lockedOpen: false, content: '', aiSummary: '' };
  return { ...task, lockedOpen: true, content: secret.description || '', aiSummary: secret.ai_summary || '' };
}

// 서버 키로 통째로 읽은 원본에서 잠긴 업무 몫(업무·댓글·첨부)을 걷는다 — 위키 장(gather) · 문서 임베딩(_docsync).
// 칸이 없는 행(0099 전)은 안 잠긴 것이다. 주보·모임 첨부(card_id 없음)는 그대로.
export function dropLocked({ cards = [], comments = [], files = [] } = {}) {
  const locked = new Set(cards.filter(c => c?.locked).map(c => c.id));
  if (!locked.size) return { cards, comments, files, locked };
  return {
    cards: cards.filter(c => !locked.has(c.id)),
    comments: comments.filter(c => !locked.has(c.card_id)),
    files: files.filter(f => !(f.card_id && locked.has(f.card_id))),
    locked,
  };
}
