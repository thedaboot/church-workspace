// ============================================================================
// 알림 문구 — 앱 안 알림 목록(layout.jsx)과 웹 푸시(api/push.js)가 같은 문구를 본다.
// ----------------------------------------------------------------------------
// 갈라 두면 같은 알림이 종 팝오버에서 다르게, 잠금화면에서 또 다르게 읽힌다.
// React도 import.meta.env도 쓰지 않는 순수 모듈이라 서버리스 함수에서 그냥 import된다.
//
// due_soon은 사람이 만드는 게 아니라 하루 한 번 도는 배치가 만든다 → '누가'가 없으므로
// 이름을 붙이지 않는다.
// ============================================================================
const NOTIF_TEXT = {
  mention: '나를 멘션했어요',
  reply: '내 댓글에 답글을 남겼어요',
  assign: '나를 담당자로 지정했어요',
};

export const isSystemNotif = (kind) => kind === 'due_soon';

export const notifText = (kind) => NOTIF_TEXT[kind] || NOTIF_TEXT.mention;

// 알림 한 줄 (토스트·푸시 제목에 그대로 쓴다)
export const notifLine = (kind, actorName) => (
  isSystemNotif(kind) ? '마감이 다가왔어요' : `${actorName || '누군가'}님이 ${notifText(kind)}`
);
