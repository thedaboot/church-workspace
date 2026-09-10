// ============================================================================
// 알림 문구 — 앱 안 알림 목록(layout.jsx)과 웹 푸시(api/push.js)가 같은 문구를 본다.
// ----------------------------------------------------------------------------
// 갈라 두면 같은 알림이 종 팝오버에서 다르게, 잠금화면에서 또 다르게 읽힌다.
// React도 import.meta.env도 쓰지 않는 순수 모듈이라 서버리스 함수에서 그냥 import된다.
//
// 두 갈래다.
//  · 사람이 만든 알림(actor 있음): "○○님이 {문구}" — NOTIF_TEXT
//  · 시스템 알림(actor 없음):     문구 그대로 — SYSTEM_TEXT. due_soon은 배치가 만들고,
//    worship_today는 예배 당일 11:30 배치, club_accepted는 동아리장이 눌렀지만 받는 사람에게
//    중요한 것은 "누가"가 아니라 "수락됐다"라서 시스템 갈래로 둔다(0053).
// preview는 문구 아래 한 줄(주보 제목·동아리 이름 등) — 종 팝오버가 그대로 보여 준다.
// ============================================================================
const NOTIF_TEXT = {
  mention: '나를 멘션했어요',
  reply: '내 댓글에 답글을 남겼어요',
  assign: '나를 담당자로 지정했어요',
  // 하트·따봉·체크 세 종류가 있지만 문구는 하나다(0032). 종류를 문구에 넣으면
  // 알림 목록이 "따봉을 눌렀어요"처럼 읽히고, 어느 것을 눌렀는지는 댓글을 열면 보인다.
  reaction: '내 댓글에 반응을 남겼어요',
  // 가입 요청(0022 트리거) — 예전에는 이 열쇠가 없어서 fallback으로 떨어져
  // **'문진혁님이 나를 멘션했어요'** 로 떴다(사용자 지적 2026-09-09). 트리거는
  // kind와 actor_name만 넘기므로 문구는 여기 한 줄이 전부다.
  approval: '가입을 요청했어요',
  // v2 (0053)
  service_published: '이번 주 주보를 발행했어요',
  note_shared: '예배 노트를 우리 순에 공유했어요',
  club_apply: '동아리 가입을 신청했어요',
  meeting_new: '동아리 모임 일정을 잡았어요',
};

const SYSTEM_TEXT = {
  due_soon: '마감이 다가왔어요',
  worship_today: '오늘 예배가 있어요',
  club_accepted: '동아리 가입이 수락되었어요',
};

export const isSystemNotif = (kind) => kind in SYSTEM_TEXT;

export const notifText = (kind) => NOTIF_TEXT[kind] || NOTIF_TEXT.mention;

// 알림 한 줄 (토스트·푸시 제목에 그대로 쓴다)
export const notifLine = (kind, actorName) => (
  isSystemNotif(kind) ? SYSTEM_TEXT[kind] : `${actorName || '누군가'}님이 ${notifText(kind)}`
);

// 어느 화면 갈래의 알림인가 — 종 팝오버가 아이콘을 고를 때 쓴다(업무 알림은 아바타).
//   'task'(업무) · 'worship'(예배) · 'group'(모임)
export const notifArea = (kind) => {
  if (kind === 'worship_today' || kind === 'service_published' || kind === 'note_shared') return 'worship';
  if (kind === 'club_apply' || kind === 'club_accepted' || kind === 'meeting_new') return 'group';
  return 'task';
};
